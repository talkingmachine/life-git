import { createHash } from "node:crypto";

import { CodexRuntimeError, MAX_CODEX_EVENTS, MAX_CODEX_STDOUT_BYTES } from "./contracts";

export const CODEX_STARTUP_NOTICES = Object.freeze([
  "approval_policy_never_to_unless_trusted",
  "code_mode_host_disabled",
] as const);

export type CodexStartupNotice = (typeof CODEX_STARTUP_NOTICES)[number];
export type CodexStartupNotices = typeof CODEX_STARTUP_NOTICES;

export interface CodexEventStreamProof {
  readonly finalMessage: string;
  readonly startupNotices: CodexStartupNotices;
  readonly eventTypes: readonly string[];
}

const APPROVAL_POLICY_NOTICE_UTF8_BYTES = 277;
const APPROVAL_POLICY_NOTICE_SHA256 = "dc04a3e848ff580847de6950e6415fe72d1daab7d83336461b55b6fc8355e177";
const CODE_MODE_HOST_NOTICE_UTF8_BYTES = 157;
const CODE_MODE_HOST_DISABLED_MESSAGE =
  "Code Mode is unavailable because code-mode host is disabled. Code mode will fail closed; enable `features.code_mode_host` and install `codex-code-mode-host`.";

export function fingerprintCodexNoticeMessage(message: string): Readonly<{
  readonly utf8ByteLength: number;
  readonly sha256: string;
}> {
  const bytes = new TextEncoder().encode(message);
  return Object.freeze({
    utf8ByteLength: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });
}

function classifyCodexStartupNotice(event: Record<string, unknown>): CodexStartupNotice | null {
  if (!hasExactKeys(event, ["type", "item"]) || event.type !== "item.completed") {
    return null;
  }
  const item = event.item;
  if (!isObject(item) || !hasExactKeys(item, ["type", "id", "message"]) ||
    item.type !== "error" || typeof item.message !== "string") {
    return null;
  }
  if (item.id === "item_0") {
    const fingerprint = fingerprintCodexNoticeMessage(item.message);
    return fingerprint.utf8ByteLength === APPROVAL_POLICY_NOTICE_UTF8_BYTES &&
      fingerprint.sha256 === APPROVAL_POLICY_NOTICE_SHA256
      ? "approval_policy_never_to_unless_trusted"
      : null;
  }
  return item.id === "item_1" && item.message === CODE_MODE_HOST_DISABLED_MESSAGE &&
    fingerprintCodexNoticeMessage(item.message).utf8ByteLength === CODE_MODE_HOST_NOTICE_UTF8_BYTES
    ? "code_mode_host_disabled"
    : null;
}

export async function parseCodexEventStream(
  chunks: AsyncIterable<Uint8Array>,
  limits: {
    readonly maxStdoutBytes: number;
    readonly maxEvents: number;
  },
): Promise<string> {
  return (await parseEventStream(chunks, limits, false)).finalMessage;
}

export async function parseCodexEventStreamWithProof(
  chunks: AsyncIterable<Uint8Array>,
  limits: {
    readonly maxStdoutBytes: number;
    readonly maxEvents: number;
  },
): Promise<CodexEventStreamProof> {
  const parsed = await parseEventStream(chunks, limits, true);
  return Object.freeze({
    ...parsed,
    startupNotices: CODEX_STARTUP_NOTICES,
  });
}

interface ParsedCodexEventStream {
  readonly finalMessage: string;
  readonly eventTypes: readonly string[];
}

async function parseEventStream(
  chunks: AsyncIterable<Uint8Array>,
  limits: {
    readonly maxStdoutBytes: number;
    readonly maxEvents: number;
  },
  requireStartupNotices: boolean,
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
      pending = consumeLines(pending, state, maxEvents, requireStartupNotices);
    }
    pending += decoder.decode();
  } catch (error) {
    if (error instanceof CodexRuntimeError) throw error;
    throw protocolInvalid();
  }

  if (pending.length > 0) throw protocolInvalid();
  if (!state.threadStarted || !state.turnStarted || !state.turnCompleted || state.reasoningId !== undefined ||
    state.message === undefined || (requireStartupNotices && state.startupNoticeCount !== CODEX_STARTUP_NOTICES.length)) {
    throw protocolInvalid();
  }
  return Object.freeze({
    finalMessage: state.message,
    eventTypes: Object.freeze([...state.eventTypes]),
  });
}

interface StreamState {
  threadStarted: boolean;
  turnStarted: boolean;
  turnCompleted: boolean;
  reasoningId: string | undefined;
  eventCount: number;
  message: string | undefined;
  startupNoticeCount: number;
  eventTypes: string[];
}

function createStreamState(): StreamState {
  return {
    threadStarted: false,
    turnStarted: false,
    turnCompleted: false,
    reasoningId: undefined,
    eventCount: 0,
    message: undefined,
    startupNoticeCount: 0,
    eventTypes: [],
  };
}

function consumeLines(
  pending: string,
  state: StreamState,
  maxEvents: number,
  requireStartupNotices: boolean,
): string {
  let lineStart = 0;
  while (true) {
    const newline = pending.indexOf("\n", lineStart);
    if (newline === -1) return pending.slice(lineStart);
    state.eventCount += 1;
    if (state.eventCount > maxEvents) throw new CodexRuntimeError("codex_event_limit");
    parseEvent(pending.slice(lineStart, newline), state, requireStartupNotices);
    lineStart = newline + 1;
  }
}

function parseEvent(line: string, state: StreamState, requireStartupNotices: boolean): void {
  if (state.turnCompleted) throw protocolInvalid();

  let event: unknown;
  try {
    event = JSON.parse(line);
  } catch {
    throw protocolInvalid();
  }
  if (!isObject(event) || typeof event.type !== "string") throw protocolInvalid();
  state.eventTypes.push(event.type);

  if (requireStartupNotices && !state.turnStarted && event.type === "item.completed" && itemType(event) === "error") {
    const notice = classifyCodexStartupNotice(event);
    if (!state.threadStarted || notice !== CODEX_STARTUP_NOTICES[state.startupNoticeCount]) {
      throw protocolInvalid();
    }
    state.startupNoticeCount += 1;
    return;
  }

  switch (event.type) {
    case "thread.started":
      if (state.threadStarted || state.turnStarted) throw protocolInvalid();
      state.threadStarted = true;
      return;
    case "turn.started":
      if (!state.threadStarted || state.turnStarted ||
        (requireStartupNotices && state.startupNoticeCount !== CODEX_STARTUP_NOTICES.length)) {
        throw protocolInvalid();
      }
      state.turnStarted = true;
      return;
    case "item.started":
      requireActiveTurn(state);
      if (state.reasoningId !== undefined || itemType(event) !== "reasoning") throwItemError(event);
      state.reasoningId = requireItemId(event);
      return;
    case "item.completed":
      requireActiveTurn(state);
      completeItem(event, state);
      return;
    case "turn.completed":
      if (!state.turnStarted || state.reasoningId !== undefined || state.message === undefined) throw protocolInvalid();
      state.turnCompleted = true;
      return;
    case "turn.failed":
      throw protocolInvalid();
    default:
      throw protocolInvalid();
  }
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Reflect.ownKeys(value);
  return keys.length === expected.length && expected.every((key) => keys.includes(key));
}

function completeItem(event: Record<string, unknown>, state: StreamState): void {
  const type = itemType(event);
  if (type === "reasoning") {
    if (state.reasoningId === undefined || requireItemId(event) !== state.reasoningId) throw protocolInvalid();
    state.reasoningId = undefined;
    return;
  }
  if (type !== "agent_message" || state.reasoningId !== undefined || state.message !== undefined) throwItemError(event);

  const item = event.item;
  if (!isObject(item) || typeof item.text !== "string") throw protocolInvalid();
  state.message = item.text;
}

function requireActiveTurn(state: StreamState): void {
  if (!state.threadStarted || !state.turnStarted || state.turnCompleted || state.message !== undefined) throw protocolInvalid();
}

function itemType(event: Record<string, unknown>): string | undefined {
  return isObject(event.item) && typeof event.item.type === "string" ? event.item.type : undefined;
}

function requireItemId(event: Record<string, unknown>): string {
  const item = event.item;
  if (!isObject(item) || typeof item.id !== "string" || item.id.length === 0) throw protocolInvalid();
  return item.id;
}

function throwItemError(event: Record<string, unknown>): never {
  if (isToolItemType(itemType(event))) throw new CodexRuntimeError("codex_tool_event");
  throw protocolInvalid();
}

function isToolItemType(type: string | undefined): boolean {
  return type === "command_execution" || type === "command" || type === "shell" || type === "web_search" ||
    type === "browser" || type === "mcp_tool_call" || type === "mcp" || type === "app" || type === "plugin" ||
    type === "skill" || type === "image" || type === "image_generation" || type === "tool_call" ||
    type === "tool_result" || type === "function_call" || type === "function_call_output";
}

function readLimits(value: unknown): { maxStdoutBytes: number; maxEvents: number } {
  if (!isObject(value) || Object.getPrototypeOf(value) !== Object.prototype) throw protocolInvalid();
  const keys = Reflect.ownKeys(value);
  if (keys.length !== 2 || !keys.includes("maxStdoutBytes") || !keys.includes("maxEvents")) throw protocolInvalid();
  const stdout = Object.getOwnPropertyDescriptor(value, "maxStdoutBytes");
  const events = Object.getOwnPropertyDescriptor(value, "maxEvents");
  if (!isEnumerableDataDescriptor(stdout) || !isEnumerableDataDescriptor(events)) throw protocolInvalid();
  if (!isPositiveInteger(stdout.value) || !isPositiveInteger(events.value) ||
    stdout.value > MAX_CODEX_STDOUT_BYTES || events.value > MAX_CODEX_EVENTS) {
    throw protocolInvalid();
  }
  return { maxStdoutBytes: stdout.value, maxEvents: events.value };
}

function copyExactUint8Array(value: unknown): Uint8Array {
  if (!ArrayBuffer.isView(value) || Object.getPrototypeOf(value) !== Uint8Array.prototype) {
    throw protocolInvalid();
  }
  const exact = value as Uint8Array;
  const byteLength = trustedUint8ByteLength(exact);
  const keys = Reflect.ownKeys(exact);
  if (keys.length !== byteLength) throw protocolInvalid();
  for (let index = 0; index < byteLength; index += 1) {
    if (!keys.includes(String(index))) throw protocolInvalid();
  }
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

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isEnumerableDataDescriptor(
  descriptor: PropertyDescriptor | undefined,
): descriptor is PropertyDescriptor & { value: unknown } {
  return descriptor?.enumerable === true && "value" in descriptor;
}

function protocolInvalid(): CodexRuntimeError {
  return new CodexRuntimeError("codex_protocol_invalid");
}
