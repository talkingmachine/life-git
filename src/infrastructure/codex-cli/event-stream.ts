import { CodexRuntimeError } from "./contracts";

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
      if (!(chunk instanceof Uint8Array)) throw protocolInvalid();
      stdoutBytes += chunk.byteLength;
      if (stdoutBytes > maxStdoutBytes) throw new CodexRuntimeError("codex_output_too_large");
      pending += decoder.decode(chunk, { stream: true });
      pending = consumeLines(pending, state, maxEvents);
    }
    pending += decoder.decode();
  } catch (error) {
    if (error instanceof CodexRuntimeError) throw error;
    throw protocolInvalid();
  }

  if (pending.length > 0) throw protocolInvalid();
  if (!state.threadStarted || !state.turnStarted || !state.turnCompleted || state.reasoningOpen || state.message === undefined) {
    throw protocolInvalid();
  }
  return state.message;
}

interface StreamState {
  threadStarted: boolean;
  turnStarted: boolean;
  turnCompleted: boolean;
  reasoningOpen: boolean;
  eventCount: number;
  message: string | undefined;
}

function createStreamState(): StreamState {
  return {
    threadStarted: false,
    turnStarted: false,
    turnCompleted: false,
    reasoningOpen: false,
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
      if (state.reasoningOpen || itemType(event) !== "reasoning") throwItemError(event);
      state.reasoningOpen = true;
      return;
    case "item.completed":
      requireActiveTurn(state);
      completeItem(event, state);
      return;
    case "turn.completed":
      if (!state.turnStarted || state.reasoningOpen || state.message === undefined) throw protocolInvalid();
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
    if (!state.reasoningOpen) throw protocolInvalid();
    state.reasoningOpen = false;
    return;
  }
  if (type !== "agent_message" || state.reasoningOpen || state.message !== undefined) throwItemError(event);

  const item = event.item;
  if (!isObject(item) || typeof item.text !== "string") throw protocolInvalid();
  state.message = item.text;
}

function requireActiveTurn(state: StreamState): void {
  if (!state.threadStarted || !state.turnStarted || state.turnCompleted) throw protocolInvalid();
}

function itemType(event: Record<string, unknown>): string | undefined {
  return isObject(event.item) && typeof event.item.type === "string" ? event.item.type : undefined;
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
  if (!isPositiveInteger(stdout.value) || !isPositiveInteger(events.value)) throw protocolInvalid();
  return { maxStdoutBytes: stdout.value, maxEvents: events.value };
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
