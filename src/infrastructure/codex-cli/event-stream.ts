import { CodexRuntimeError, MAX_CODEX_EVENTS, MAX_CODEX_STDOUT_BYTES } from "./contracts";

export async function parseCodexEventStream(
  chunks: AsyncIterable<Uint8Array>,
  limits: {
    readonly maxStdoutBytes: number;
    readonly maxEvents: number;
  },
): Promise<string> {
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
      pending = consumeLines(pending, state, maxEvents);
    }
    pending += decoder.decode();
  } catch (error) {
    if (error instanceof CodexRuntimeError) throw error;
    throw protocolInvalid();
  }

  if (pending.length > 0) throw protocolInvalid();
  if (!state.threadStarted || !state.turnStarted || !state.turnCompleted || state.reasoningId !== undefined ||
    state.message === undefined) {
    throw protocolInvalid();
  }
  return state.message;
}

interface StreamState {
  threadStarted: boolean;
  turnStarted: boolean;
  turnCompleted: boolean;
  reasoningId: string | undefined;
  eventCount: number;
  message: string | undefined;
}

function createStreamState(): StreamState {
  return {
    threadStarted: false,
    turnStarted: false,
    turnCompleted: false,
    reasoningId: undefined,
    eventCount: 0,
    message: undefined,
  };
}

function consumeLines(pending: string, state: StreamState, maxEvents: number): string {
  let lineStart = 0;
  while (true) {
    const newline = pending.indexOf("\n", lineStart);
    if (newline === -1) return pending.slice(lineStart);
    state.eventCount += 1;
    if (state.eventCount > maxEvents) throw new CodexRuntimeError("codex_event_limit");
    parseEvent(pending.slice(lineStart, newline), state);
    lineStart = newline + 1;
  }
}

function parseEvent(line: string, state: StreamState): void {
  if (state.turnCompleted) throw protocolInvalid();

  let event: unknown;
  try {
    event = JSON.parse(line);
  } catch {
    throw protocolInvalid();
  }
  if (!isObject(event) || typeof event.type !== "string") throw protocolInvalid();

  switch (event.type) {
    case "thread.started":
      if (state.threadStarted || state.turnStarted) throw protocolInvalid();
      state.threadStarted = true;
      return;
    case "turn.started":
      if (!state.threadStarted || state.turnStarted) throw protocolInvalid();
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
