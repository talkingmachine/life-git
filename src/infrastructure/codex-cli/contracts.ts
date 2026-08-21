import { snapshotOwnedJson, type JsonObject, type JsonValue } from "./owned-json";

export const CODEX_CLI_VERSION = "codex-cli 0.148.0-alpha.15" as const;
export const CODEX_INVOCATION_VERSION = "codex-cli-invocation@1" as const;
export const MAX_CODEX_TIMEOUT_MS = 120_000;
export const MAX_CODEX_STDOUT_BYTES = 1_048_576;
export const MAX_CODEX_STDERR_BYTES = 65_536;
export const MAX_CODEX_EVENTS = 256;
export const MAX_CODEX_PROMPT_BYTES = 262_144;

const NATIVE_ABORT_SIGNAL_OWN_KEYS = new Set([
  ...Reflect.ownKeys(new AbortController().signal),
  ...Reflect.ownKeys(AbortSignal.timeout(1)),
  ...Reflect.ownKeys(AbortSignal.any([new AbortController().signal])),
]);

export type CodexCapabilityId =
  | "onboarding_extract"
  | "onboarding_review"
  | "full_life_film";

export interface CodexInvocationLimits {
  readonly timeoutMs: number;
  readonly maxStdoutBytes: number;
  readonly maxStderrBytes: number;
  readonly maxEvents: number;
}

export interface CodexJsonInvocation {
  readonly capability: CodexCapabilityId;
  readonly templateVersion: string;
  readonly schemaVersion: string;
  readonly prompt: string;
  readonly outputSchema: JsonObject;
  readonly limits: CodexInvocationLimits;
  readonly signal: AbortSignal;
}

export interface CodexInvocationMetadata {
  readonly invocationVersion: typeof CODEX_INVOCATION_VERSION;
  readonly cliVersion: typeof CODEX_CLI_VERSION;
  readonly templateVersion: string;
  readonly schemaVersion: string;
}

export interface CodexJsonResult {
  readonly value: JsonValue;
  readonly metadata: CodexInvocationMetadata;
}

export type CodexRuntimeErrorCode =
  | "codex_missing"
  | "codex_version_mismatch"
  | "codex_not_authenticated"
  | "codex_protocol_invalid"
  | "codex_tool_event"
  | "codex_output_too_large"
  | "codex_event_limit"
  | "codex_timeout"
  | "codex_aborted"
  | "codex_process_failed"
  | "codex_json_invalid"
  | "codex_temp_root_invalid"
  | "codex_tool_isolation_unproven";

export class CodexRuntimeError extends Error {
  constructor(readonly code: CodexRuntimeErrorCode) {
    super(code);
    this.name = "CodexRuntimeError";
  }
}

export function createCodexJsonInvocation(input: {
  readonly capability: CodexCapabilityId;
  readonly templateVersion: string;
  readonly schemaVersion: string;
  readonly prompt: string;
  readonly outputSchema: unknown;
  readonly limits: CodexInvocationLimits;
  readonly signal: AbortSignal;
}): CodexJsonInvocation {
  try {
    const values = readExactPlainObject(input, [
      "capability",
      "templateVersion",
      "schemaVersion",
      "prompt",
      "outputSchema",
      "limits",
      "signal",
    ]);
    const capability = requireCapability(values.capability);
    const templateVersion = requireBoundedText(values.templateVersion, true);
    const schemaVersion = requireBoundedText(values.schemaVersion, true);
    const prompt = requireBoundedText(values.prompt, false);
    const outputSchema = snapshotOwnedJson(values.outputSchema);
    if (!isJsonObject(outputSchema)) throw protocolInvalid();
    const limits = readLimits(values.limits);
    const signal = requireSignal(values.signal);

    return Object.freeze({
      capability,
      templateVersion,
      schemaVersion,
      prompt,
      outputSchema,
      limits,
      signal,
    });
  } catch (error) {
    if (error instanceof CodexRuntimeError) throw error;
    throw protocolInvalid();
  }
}

function readExactPlainObject(value: unknown, expectedKeys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== "object") throw protocolInvalid();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw protocolInvalid();

  const keys = Reflect.ownKeys(value);
  if (keys.length !== expectedKeys.length) throw protocolInvalid();

  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of expectedKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !isEnumerableDataDescriptor(descriptor)) throw protocolInvalid();
    result[key] = descriptor.value;
  }
  return result;
}

function requireCapability(value: unknown): CodexCapabilityId {
  if (value === "onboarding_extract" || value === "onboarding_review" || value === "full_life_film") {
    return value;
  }
  throw protocolInvalid();
}

function requireBoundedText(value: unknown, mustNotBeEmpty: boolean): string {
  if (typeof value !== "string" || (mustNotBeEmpty && value.length === 0) ||
    utf8Bytes(value) > MAX_CODEX_PROMPT_BYTES) {
    throw protocolInvalid();
  }
  return value;
}

function readLimits(value: unknown): CodexInvocationLimits {
  const limits = readExactPlainObject(value, ["timeoutMs", "maxStdoutBytes", "maxStderrBytes", "maxEvents"]);
  return Object.freeze({
    timeoutMs: requireBoundedInteger(limits.timeoutMs, MAX_CODEX_TIMEOUT_MS),
    maxStdoutBytes: requireBoundedInteger(limits.maxStdoutBytes, MAX_CODEX_STDOUT_BYTES),
    maxStderrBytes: requireBoundedInteger(limits.maxStderrBytes, MAX_CODEX_STDERR_BYTES),
    maxEvents: requireBoundedInteger(limits.maxEvents, MAX_CODEX_EVENTS),
  });
}

function requireBoundedInteger(value: unknown, maximum: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > maximum) {
    throw protocolInvalid();
  }
  return value;
}

function requireSignal(value: unknown): AbortSignal {
  if (!(value instanceof AbortSignal) || Object.getPrototypeOf(value) !== AbortSignal.prototype ||
    Reflect.ownKeys(value).some((key) => !NATIVE_ABORT_SIGNAL_OWN_KEYS.has(key))) {
    throw protocolInvalid();
  }
  const descriptor = Object.getOwnPropertyDescriptor(AbortSignal.prototype, "aborted");
  if (descriptor?.get?.call(value) === true) throw protocolInvalid();
  return value;
}

function isJsonObject(value: JsonValue): value is JsonObject {
  return value !== null && !Array.isArray(value) && typeof value === "object";
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function isEnumerableDataDescriptor(descriptor: PropertyDescriptor): descriptor is PropertyDescriptor & { value: unknown } {
  return descriptor.enumerable === true && "value" in descriptor;
}

function protocolInvalid(): CodexRuntimeError {
  return new CodexRuntimeError("codex_protocol_invalid");
}
