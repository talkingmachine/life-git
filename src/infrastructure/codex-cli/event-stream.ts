import {
  CodexRuntimeError,
  MAX_CODEX_EVENTS,
  MAX_CODEX_PROMPT_BYTES,
  MAX_CODEX_STDOUT_BYTES,
  type CodexToolPolicyId,
} from "./contracts";

export type CodexEventStreamProof = Readonly<{
  finalMessage: string;
  eventTypes: readonly string[];
  webSearchCount: number;
  toolPolicyProven: true;
}>;

/** Reviewed Codex CLI alpha.4 no-tool pre-turn protocol revision. */
export const CODEX_PROTOCOL_NOTICE_REVISION = "alpha.4-reviewed-web-search@5";

const REVIEWED_PRE_TURN_NOTICES = Object.freeze([
  Object.freeze({
    id: "item_0",
    message: "Configured value for `approval_policy` is disallowed by requirements; falling back to required value UnlessTrusted. Details: invalid value for `approval_policy`: `Never` is not in the allowed set [UnlessTrusted, OnRequest] (set by MDM com.openai.codex:requirements_toml_base64)",
  }),
  Object.freeze({
    id: "item_1",
    message: "Code Mode is unavailable because code-mode host is disabled. Code mode will fail closed; enable `features.code_mode_host` and install `codex-code-mode-host`.",
  }),
] as const);

export async function parseCodexEventStream(
  chunks: AsyncIterable<Uint8Array>,
  limits: StreamLimits,
): Promise<string> {
  return (await parseEventStream(chunks, limits, "codex-tools-none@2", false)).finalMessage;
}

export async function parseCodexEventStreamWithProof(
  chunks: AsyncIterable<Uint8Array>,
  limits: StreamLimits,
  toolPolicy: CodexToolPolicyId,
): Promise<CodexEventStreamProof> {
  const parsed = await parseEventStream(chunks, limits, readToolPolicy(toolPolicy), true);
  return Object.freeze({
    finalMessage: parsed.finalMessage,
    eventTypes: Object.freeze([...parsed.eventTypes]),
    webSearchCount: parsed.webSearchCount,
    toolPolicyProven: true,
  });
}

interface StreamLimits {
  readonly maxStdoutBytes: number;
  readonly maxEvents: number;
}

interface ParsedCodexEventStream {
  readonly finalMessage: string;
  readonly eventTypes: readonly string[];
  readonly webSearchCount: number;
}

interface StreamState {
  threadStarted: boolean;
  turnStarted: boolean;
  turnCompleted: boolean;
  reasoningId: string | undefined;
  webSearchId: string | undefined;
  seenItemIds: Set<string>;
  webSearchCount: number;
  eventCount: number;
  message: string | undefined;
  webCandidate: string | undefined;
  eventTypes: string[];
  reviewedNoticeIndex: number;
}

async function parseEventStream(
  chunks: AsyncIterable<Uint8Array>,
  limits: StreamLimits,
  toolPolicy: CodexToolPolicyId,
  requireReviewedNotices: boolean,
): Promise<ParsedCodexEventStream> {
  const { maxStdoutBytes, maxEvents } = readLimits(limits);
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const state = createStreamState();
  let stdoutBytes = 0;
  let pending = "";

  try {
    for await (const chunk of chunks) {
      const ownedChunk = copyExactUint8Array(chunk);
      stdoutBytes += ownedChunk.byteLength;
      if (stdoutBytes > maxStdoutBytes) throw new CodexRuntimeError("codex_output_too_large");
      pending += decoder.decode(ownedChunk, { stream: true });
      pending = consumeLines(pending, state, maxEvents, toolPolicy, requireReviewedNotices);
    }
    pending += decoder.decode();
  } catch (error) {
    if (error instanceof CodexRuntimeError) throw error;
    throw protocolInvalid();
  }

  if (pending.length > 0 || !state.threadStarted || !state.turnStarted || !state.turnCompleted ||
    state.reasoningId !== undefined || state.webSearchId !== undefined || state.message === undefined) {
    throw protocolInvalid();
  }
  if (requireReviewedNotices && state.reviewedNoticeIndex !== reviewedNotices(toolPolicy).length) throw protocolInvalid();
  return Object.freeze({
    finalMessage: state.message,
    eventTypes: Object.freeze([...state.eventTypes]),
    webSearchCount: state.webSearchCount,
  });
}

function createStreamState(): StreamState {
  return {
    threadStarted: false,
    turnStarted: false,
    turnCompleted: false,
    reasoningId: undefined,
    webSearchId: undefined,
    seenItemIds: new Set(),
    webSearchCount: 0,
    eventCount: 0,
    message: undefined,
    webCandidate: undefined,
    eventTypes: [],
    reviewedNoticeIndex: 0,
  };
}

function consumeLines(
  pending: string,
  state: StreamState,
  maxEvents: number,
  toolPolicy: CodexToolPolicyId,
  requireReviewedNotices: boolean,
): string {
  let lineStart = 0;
  while (true) {
    const newline = pending.indexOf("\n", lineStart);
    if (newline === -1) return pending.slice(lineStart);
    state.eventCount += 1;
    if (state.eventCount > maxEvents) throw new CodexRuntimeError("codex_event_limit");
    parseEvent(pending.slice(lineStart, newline), state, toolPolicy, requireReviewedNotices);
    lineStart = newline + 1;
  }
}

function parseEvent(
  line: string,
  state: StreamState,
  toolPolicy: CodexToolPolicyId,
  requireReviewedNotices: boolean,
): void {
  if (state.turnCompleted) throw protocolInvalid();
  const event = parseJsonEvent(line);
  state.eventTypes.push(event.type);

  switch (event.type) {
    case "thread.started":
      if (!hasExactKeys(event, ["type", "thread_id"]) || typeof event.thread_id !== "string" ||
        !isBoundedText(event.thread_id) || state.threadStarted || state.turnStarted) throw protocolInvalid();
      state.threadStarted = true;
      return;
    case "turn.started":
      if (!hasExactKeys(event, ["type"]) || !state.threadStarted || state.turnStarted ||
        (requireReviewedNotices && state.reviewedNoticeIndex !== reviewedNotices(toolPolicy).length)) throw protocolInvalid();
      state.turnStarted = true;
      return;
    case "item.started":
      requireActiveTurn(state);
      startItem(event, state, toolPolicy);
      return;
    case "item.completed":
      if (requireReviewedNotices && !state.turnStarted && state.threadStarted) {
        completeReviewedPreTurnNotice(event, state, toolPolicy);
        return;
      }
      requireActiveTurn(state);
      completeItem(event, state, toolPolicy, requireReviewedNotices);
      return;
    case "turn.completed":
      if ((!requireReviewedNotices && !hasExactKeys(event, ["type"])) ||
        (requireReviewedNotices && !hasReviewedUsageShape(event)) || !state.turnStarted || state.reasoningId !== undefined ||
        state.webSearchId !== undefined || (toolPolicy === "codex-tools-none@2" && state.message === undefined) ||
        (isWebSearchPolicy(toolPolicy) && state.webCandidate === undefined)) throw protocolInvalid();
      if (isWebSearchPolicy(toolPolicy)) state.message = state.webCandidate;
      state.turnCompleted = true;
      return;
    case "turn.failed":
    default:
      throw protocolInvalid();
  }
}

function completeReviewedPreTurnNotice(
  event: Record<string, unknown>, state: StreamState, toolPolicy: CodexToolPolicyId,
): void {
  const expected = reviewedNotices(toolPolicy)[state.reviewedNoticeIndex];
  if (expected === undefined || !hasExactItemKeys(event, ["id", "type", "message"])) throw protocolInvalid();
  const item = event.item;
  if (!isObject(item) || item.id !== expected.id || item.type !== "error" || item.message !== expected.message ||
    state.seenItemIds.has(expected.id)) throw protocolInvalid();
  state.seenItemIds.add(expected.id);
  state.reviewedNoticeIndex += 1;
}

function reviewedNotices(toolPolicy: CodexToolPolicyId): readonly (typeof REVIEWED_PRE_TURN_NOTICES)[number][] {
  return isWebSearchPolicy(toolPolicy) ? REVIEWED_PRE_TURN_NOTICES.slice(0, 1) : REVIEWED_PRE_TURN_NOTICES;
}

function startItem(event: Record<string, unknown>, state: StreamState, toolPolicy: CodexToolPolicyId): void {
  const type = itemType(event);
  if (type === "reasoning") {
    if (!hasExactItemKeys(event, ["type", "id"]) || state.reasoningId !== undefined || state.webSearchId !== undefined) {
      throw protocolInvalid();
    }
    const id = requireItemId(event);
    if (state.seenItemIds.has(id)) throw protocolInvalid();
    state.reasoningId = id;
    state.seenItemIds.add(id);
    return;
  }
  if (type === "web_search") {
    if (toolPolicy === "codex-tools-none@2") throw new CodexRuntimeError("codex_tool_event");
    if (!hasExactItemKeys(event, ["type", "id", "query", "action"]) || !hasReviewedWebSearchStartShape(event)) {
      throw new CodexRuntimeError("codex_tool_event");
    }
    const id = requireItemId(event);
    if (state.reasoningId !== undefined || state.webSearchId !== undefined || state.seenItemIds.has(id)) {
      throw protocolInvalid();
    }
    state.webSearchId = id;
    state.webCandidate = undefined;
    state.seenItemIds.add(id);
    return;
  }
  throwItemError(type);
}

function completeItem(
  event: Record<string, unknown>,
  state: StreamState,
  toolPolicy: CodexToolPolicyId,
  requireReviewedTerminalShape: boolean,
): void {
  const type = itemType(event);
  if (type === "reasoning") {
    if (!hasExactItemKeys(event, ["type", "id"]) || state.reasoningId === undefined ||
      requireItemId(event) !== state.reasoningId) throw protocolInvalid();
    state.reasoningId = undefined;
    return;
  }
  if (type === "web_search") {
    if (toolPolicy === "codex-tools-none@2") throw new CodexRuntimeError("codex_tool_event");
    if (!hasExactItemKeys(event, ["type", "id", "query", "action"]) || !hasReviewedWebSearchCompletionShape(event)) {
      throw new CodexRuntimeError("codex_tool_event");
    }
    if (state.webSearchId === undefined || requireItemId(event) !== state.webSearchId) throw protocolInvalid();
    const item = event.item as Record<string, unknown>;
    if (isSearchAction(item.action)) state.webSearchCount += 1;
    state.webSearchId = undefined;
    return;
  }
  const agentKeys = requireReviewedTerminalShape ? ["type", "id", "text"] : ["type", "text"];
  if (type !== "agent_message" || !hasExactItemKeys(event, agentKeys) || state.reasoningId !== undefined ||
    state.webSearchId !== undefined || (toolPolicy === "codex-tools-none@2" && state.message !== undefined)) {
    throwItemError(type);
  }
  const item = event.item;
  if (!isObject(item) || typeof item.text !== "string") throw protocolInvalid();
  if (requireReviewedTerminalShape) {
    const id = requireItemId(event);
    if (state.seenItemIds.has(id)) throw protocolInvalid();
    state.seenItemIds.add(id);
  }
  if (isWebSearchPolicy(toolPolicy)) state.webCandidate = item.text;
  else state.message = item.text;
}

function hasReviewedUsageShape(event: Record<string, unknown>): boolean {
  if (!hasExactKeys(event, ["type", "usage"]) || !isObject(event.usage)) return false;
  const usage = event.usage;
  const keys = [
    "input_tokens",
    "cached_input_tokens",
    "cache_write_input_tokens",
    "output_tokens",
    "reasoning_output_tokens",
  ];
  return hasExactKeys(usage, keys) && keys.every((key) => isNonNegativeSafeInteger(usage[key]));
}

function hasReviewedWebSearchStartShape(event: Record<string, unknown>): boolean {
  const item = event.item;
  return isObject(item) && item.query === "" && isOtherAction(item.action);
}

function hasReviewedWebSearchCompletionShape(event: Record<string, unknown>): boolean {
  const item = event.item;
  if (!isObject(item) || typeof item.query !== "string") return false;
  return (item.query === "" && isOtherAction(item.action)) ||
    (isBoundedText(item.query) && isSearchAction(item.action) && item.action.query === item.query);
}

function isOtherAction(value: unknown): boolean {
  return isObject(value) && hasExactKeys(value, ["type"]) && value.type === "other";
}

function isSearchAction(value: unknown): value is Record<string, unknown> & { query: string; queries: readonly string[] } {
  return isObject(value) && hasExactKeys(value, ["type", "query", "queries"]) && value.type === "search" &&
    typeof value.query === "string" && isBoundedText(value.query) && Array.isArray(value.queries) &&
    value.queries.length >= 1 && value.queries.length <= 3 &&
    value.queries.every((query) => typeof query === "string" && isBoundedText(query)) &&
    new Set(value.queries).size === value.queries.length && value.queries.includes(value.query);
}

function requireActiveTurn(state: StreamState): void {
  if (!state.threadStarted || !state.turnStarted || state.turnCompleted || state.message !== undefined) throw protocolInvalid();
}

function parseJsonEvent(line: string): Record<string, unknown> & { type: string } {
  let event: unknown;
  try {
    event = JSON.parse(line);
  } catch {
    throw protocolInvalid();
  }
  if (!isObject(event) || typeof event.type !== "string") throw protocolInvalid();
  return event as Record<string, unknown> & { type: string };
}

function itemType(event: Record<string, unknown>): string | undefined {
  return isObject(event.item) && typeof event.item.type === "string" ? event.item.type : undefined;
}

function requireItemId(event: Record<string, unknown>): string {
  const item = event.item;
  if (!isObject(item) || typeof item.id !== "string" || !isBoundedText(item.id)) throw protocolInvalid();
  return item.id;
}

function hasExactItemKeys(event: Record<string, unknown>, expected: readonly string[]): boolean {
  return isObject(event.item) && hasExactKeys(event, ["type", "item"]) && hasExactKeys(event.item, expected);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Reflect.ownKeys(value);
  return keys.length === expected.length && expected.every((key) => keys.includes(key));
}

function throwItemError(type: string | undefined): never {
  if (isToolItemType(type)) throw new CodexRuntimeError("codex_tool_event");
  throw protocolInvalid();
}

function isToolItemType(type: string | undefined): boolean {
  return type === "command_execution" || type === "command" || type === "shell" || type === "web_search" ||
    type === "browser" || type === "computer" || type === "mcp_tool_call" || type === "mcp" || type === "app" ||
    type === "plugin" || type === "skill" || type === "image" || type === "image_generation" ||
    type === "file_change" || type === "tool_call" || type === "tool_result" || type === "function_call" ||
    type === "function_call_output" || type === "code" || type === "program" || type === "program_output" ||
    type === "code_mode" || type === "exec" || type === "wait" || type === "request_user_input" || type === "update_plan";
}

function readToolPolicy(value: unknown): CodexToolPolicyId {
  if (value === "codex-tools-none@2" || value === "codex-tools-web-search@2") return value;
  throw protocolInvalid();
}

function readLimits(value: unknown): StreamLimits {
  if (!isObject(value) || Object.getPrototypeOf(value) !== Object.prototype) throw protocolInvalid();
  const keys = Reflect.ownKeys(value);
  if (keys.length !== 2 || !keys.includes("maxStdoutBytes") || !keys.includes("maxEvents")) throw protocolInvalid();
  const stdout = Object.getOwnPropertyDescriptor(value, "maxStdoutBytes");
  const events = Object.getOwnPropertyDescriptor(value, "maxEvents");
  if (!isEnumerableDataDescriptor(stdout) || !isEnumerableDataDescriptor(events) ||
    !isPositiveInteger(stdout.value) || !isPositiveInteger(events.value) ||
    stdout.value > MAX_CODEX_STDOUT_BYTES || events.value > MAX_CODEX_EVENTS) throw protocolInvalid();
  return { maxStdoutBytes: stdout.value, maxEvents: events.value };
}

function copyExactUint8Array(value: unknown): Uint8Array {
  if (!ArrayBuffer.isView(value) || Object.getPrototypeOf(value) !== Uint8Array.prototype) throw protocolInvalid();
  const exact = value as Uint8Array;
  const byteLength = trustedUint8ByteLength(exact);
  const keys = Reflect.ownKeys(exact);
  if (keys.length !== byteLength) throw protocolInvalid();
  for (let index = 0; index < byteLength; index += 1) if (!keys.includes(String(index))) throw protocolInvalid();
  const copy = new Uint8Array(byteLength);
  Uint8Array.prototype.set.call(copy, exact);
  return copy;
}

function trustedUint8ByteLength(value: ArrayBufferView): number {
  const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
  const descriptor = Object.getOwnPropertyDescriptor(typedArrayPrototype, "byteLength");
  const byteLength = descriptor?.get?.call(value);
  if (!isPositiveInteger(byteLength) && byteLength !== 0) throw protocolInvalid();
  return byteLength;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isBoundedText(value: string): boolean {
  return value.length > 0 && new TextEncoder().encode(value).byteLength <= MAX_CODEX_PROMPT_BYTES;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isWebSearchPolicy(value: CodexToolPolicyId): boolean {
  return value === "codex-tools-web-search@2";
}

function isEnumerableDataDescriptor(
  descriptor: PropertyDescriptor | undefined,
): descriptor is PropertyDescriptor & { value: unknown } {
  return descriptor?.enumerable === true && "value" in descriptor;
}

function protocolInvalid(): CodexRuntimeError {
  return new CodexRuntimeError("codex_protocol_invalid");
}
