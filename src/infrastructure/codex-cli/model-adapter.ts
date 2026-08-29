import { createHash } from "node:crypto";
import { types } from "node:util";

import {
  CODEX_CLI_COMPATIBILITY_POLICY,
  CODEX_CLI_PROTOCOL_VERSION,
  CODEX_INVOCATION_VERSION,
  CodexRuntimeError,
  type CodexJsonInvocation,
  type CodexJsonResult,
} from "./contracts";
import { runCodexJsonProbe } from "./feasibility-probe";
import { CodexFlightPool } from "./flight-pool";
import { snapshotOwnedJson, type JsonValue } from "./owned-json";
import { codexPolicyFingerprint, modelForCodexCapability } from "./policy";
import { createClosedCodexEnvironment, type CodexPreflightResult } from "./preflight";
import type { CodexProcessSpawner } from "./process";
import type { ValidatedCodexTempRoot } from "./temp-directory";

const NATIVE_ABORTED_GETTER = Object.getOwnPropertyDescriptor(AbortSignal.prototype, "aborted")?.get;
const NATIVE_REASON_GETTER = Object.getOwnPropertyDescriptor(AbortSignal.prototype, "reason")?.get;
const DISCOVERY_RETRY_POLICY_REVISION = "missing-native-search-once-shared-deadline@1" as const;

type CodexProbeResult = Awaited<ReturnType<typeof runCodexJsonProbe>>;

type DiscoveryDeadline = {
  readonly deadlineMs: number;
  readonly monotonicNowMs: () => number;
  lastObservedMs: number;
};

export interface CodexCliModelAdapterOptions {
  readonly preflight: CodexPreflightResult;
  readonly spawner: CodexProcessSpawner;
  readonly tempRoot: ValidatedCodexTempRoot;
  readonly childEnv: Readonly<Record<string, string>>;
  readonly flightPool?: CodexFlightPool;
  /** Internal deterministic-test seam; never crosses a runtime DTO boundary. */
  readonly monotonicNowMs?: () => number;
}

export interface CodexCliInvocationOutcome {
  readonly result: CodexJsonResult;
  readonly eventProof: Readonly<{ webSearchCount: number }>;
}

export class CodexCliModelAdapter {
  readonly #preflight: CodexPreflightResult;
  readonly #spawner: CodexProcessSpawner;
  readonly #tempRoot: ValidatedCodexTempRoot;
  readonly #childEnv: Readonly<Record<string, string>>;
  readonly #flightPool: CodexFlightPool;
  readonly #monotonicNowMs: () => number;

  constructor(options: CodexCliModelAdapterOptions) {
    this.#monotonicNowMs = readConfiguredMonotonicClock(options);
    this.#preflight = Object.freeze({
      executable: options.preflight.executable,
      cliVersion: options.preflight.cliVersion,
      authenticatedWith: options.preflight.authenticatedWith,
    });
    this.#spawner = options.spawner;
    this.#tempRoot = Object.freeze({ path: options.tempRoot.path, uid: options.tempRoot.uid });
    this.#childEnv = Object.freeze(createClosedCodexEnvironment(options.childEnv));
    this.#flightPool = options.flightPool ?? new CodexFlightPool({
      maximumConcurrency: 5,
      cooldownMs: 60_000,
      now: Date.now,
      classifyPressure,
    });
  }

  async invokeJson(input: CodexJsonInvocation): Promise<CodexJsonResult> {
    return (await this.invokeFlightOutcome(input)).result;
  }

  /** Runtime-only path: preserves public result shape while retaining reviewed event proof. */
  async invokeJsonWithEventProof(input: CodexJsonInvocation): Promise<CodexCliInvocationOutcome> {
    return this.invokeFlightOutcome(input);
  }

  /**
   * Operational-only pool state for the Stage A gate.  It deliberately has no
   * request identity or process information, so callers cannot turn it into a
   * side channel for prompts, keys, or child process state.
   */
  runtimeDiagnostics(): Readonly<{ activeLeaders: number; queuedFlights: number; effectiveCeiling: 1 | 3 | 5 }> {
    return this.#flightPool.diagnostics();
  }

  private invokeFlightOutcome(input: CodexJsonInvocation): Promise<CodexCliInvocationOutcome> {
    const key = deriveCodexFlightKey(input);
    return this.#flightPool.run({
      key,
      signal: input.signal,
      operation: async (signal) => {
        let probe: CodexProbeResult;
        let deadline: DiscoveryDeadline | undefined;
        if (isZeroSearchRetryEligible(input)) {
          deadline = createDiscoveryDeadline(this.#monotonicNowMs, input.limits.timeoutMs);
          let invocation = createLeaderInvocation(input, signal, input.limits);
          let acceptedProbe: CodexProbeResult | undefined;
          for (let attempt = 0; attempt < 2; attempt += 1) {
            throwIfAborted(signal);
            const candidate = await runCodexJsonProbe({
              invocation,
              preflight: this.#preflight,
              spawner: this.#spawner,
              tempRoot: this.#tempRoot,
              childEnv: this.#childEnv,
              flightKey: key,
            });
            throwIfAborted(signal);
            const remainingMs = requireDiscoveryDeadlineOpen(deadline);
            if (candidate.webSearchCount === 0) {
              if (attempt === 1) throw new CodexRuntimeError("codex_search_not_performed");
              throwIfAborted(signal);
              invocation = createLeaderInvocation(
                input,
                signal,
                remainingDiscoveryLimits(remainingMs, input.limits),
              );
              continue;
            }
            if (!isValidSearchCount(candidate.webSearchCount, input.limits.maxEvents)) {
              throw new CodexRuntimeError("codex_tool_event");
            }
            acceptedProbe = candidate;
            break;
          }
          if (acceptedProbe === undefined) throw new CodexRuntimeError("codex_search_not_performed");
          probe = acceptedProbe;
        } else {
          probe = await runCodexJsonProbe({
            invocation: createLeaderInvocation(input, signal, input.limits),
            preflight: this.#preflight,
            spawner: this.#spawner,
            tempRoot: this.#tempRoot,
            childEnv: this.#childEnv,
            flightKey: key,
          });
          if (input.toolPolicy === "codex-tools-web-search@2" &&
            !isValidSearchCount(probe.webSearchCount, input.limits.maxEvents)) {
            throw new CodexRuntimeError("codex_tool_event");
          }
        }
        throwIfAborted(signal);
        let value: JsonValue;
        try {
          value = freezeJson(snapshotOwnedJson(JSON.parse(probe.finalMessage) as unknown));
        } catch {
          throw new CodexRuntimeError("codex_json_invalid");
        }
        throwIfAborted(signal);
        if (deadline !== undefined) requireDiscoveryDeadlineOpen(deadline);
        throwIfAborted(signal);
        const result = Object.freeze({
          value,
          metadata: Object.freeze({
            invocationVersion: CODEX_INVOCATION_VERSION,
            protocolVersion: CODEX_CLI_PROTOCOL_VERSION,
            compatibilityPolicy: CODEX_CLI_COMPATIBILITY_POLICY,
            cliVersion: this.#preflight.cliVersion,
            model: modelForCodexCapability(input.capability),
            reasoningEffort: input.reasoningEffort,
            toolPolicy: input.toolPolicy,
            templateVersion: input.templateVersion,
            schemaVersion: input.schemaVersion,
          }),
        });
        return Object.freeze({
          result,
          eventProof: Object.freeze({ webSearchCount: probe.webSearchCount }),
        });
      },
    });
  }
}

/** Hash-only identity for requests which may share one owned child process. */
export function deriveCodexFlightKey(input: CodexJsonInvocation): string {
  const payload = canonicalJson({
    capability: input.capability,
    limits: input.limits,
    model: modelForCodexCapability(input.capability),
    outputSchemaHash: sha256(canonicalJson(input.outputSchema)),
    policyFingerprint: codexPolicyFingerprint,
    promptHash: sha256(input.prompt),
    reasoningEffort: input.reasoningEffort,
    retryPolicyRevision: DISCOVERY_RETRY_POLICY_REVISION,
    schemaVersion: input.schemaVersion,
    templateVersion: input.templateVersion,
    toolPolicy: input.toolPolicy,
  });
  return sha256(payload);
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function canonicalJson(value: JsonValue | Record<string, unknown>): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  const object = value as Record<string, JsonValue>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key] as JsonValue)}`).join(",")}}`;
}

function classifyPressure(error: unknown): "rate_limited" | "provider_transient" | "timeout" | undefined {
  if (!(error instanceof CodexRuntimeError)) return undefined;
  if (error.code === "codex_rate_limited") return "rate_limited";
  if (error.code === "codex_provider_transient") return "provider_transient";
  if (error.code === "codex_timeout") return "timeout";
  return undefined;
}

function isZeroSearchRetryEligible(input: CodexJsonInvocation): boolean {
  return input.capability === "source.discover" &&
    input.reasoningEffort === "medium" &&
    input.toolPolicy === "codex-tools-web-search@2";
}

function isValidSearchCount(value: number, maximum: number): boolean {
  return Number.isSafeInteger(value) && value >= 1 && value <= maximum;
}

function createLeaderInvocation(
  input: CodexJsonInvocation,
  signal: AbortSignal,
  limits: CodexJsonInvocation["limits"],
): CodexJsonInvocation {
  return Object.freeze({ ...input, limits, signal });
}

function createDiscoveryDeadline(
  monotonicNowMs: () => number,
  timeoutMs: number,
): DiscoveryDeadline {
  const startedAt = readMonotonicNow(monotonicNowMs);
  if (startedAt > Number.MAX_SAFE_INTEGER - timeoutMs) throw clockIntegrityInvalid();
  return {
    deadlineMs: startedAt + timeoutMs,
    monotonicNowMs,
    lastObservedMs: startedAt,
  };
}

function remainingDiscoveryLimits(
  remainingMs: number,
  original: CodexJsonInvocation["limits"],
): CodexJsonInvocation["limits"] {
  return Object.freeze({ ...original, timeoutMs: remainingMs });
}

function requireDiscoveryDeadlineOpen(deadline: DiscoveryDeadline): number {
  const remainingMs = Math.floor(deadline.deadlineMs - observeDiscoveryClock(deadline));
  if (remainingMs < 1) throw new CodexRuntimeError("codex_timeout");
  return remainingMs;
}

function observeDiscoveryClock(deadline: DiscoveryDeadline): number {
  const observed = readMonotonicNow(deadline.monotonicNowMs);
  if (observed < deadline.lastObservedMs) throw clockIntegrityInvalid();
  deadline.lastObservedMs = observed;
  return observed;
}

function readConfiguredMonotonicClock(options: CodexCliModelAdapterOptions): () => number {
  try {
    if (types.isProxy(options)) throw clockIntegrityInvalid();
    const descriptor = Object.getOwnPropertyDescriptor(options, "monotonicNowMs");
    if (descriptor === undefined) return defaultMonotonicNowMs;
    if (!("value" in descriptor) || typeof descriptor.value !== "function" || types.isProxy(descriptor.value)) {
      throw clockIntegrityInvalid();
    }
    return descriptor.value;
  } catch {
    throw clockIntegrityInvalid();
  }
}

function readMonotonicNow(monotonicNowMs: () => number): number {
  let observed: unknown;
  try {
    if (typeof monotonicNowMs !== "function" || types.isProxy(monotonicNowMs)) throw clockIntegrityInvalid();
    observed = Reflect.apply(monotonicNowMs, undefined, []);
  } catch {
    throw clockIntegrityInvalid();
  }
  if (typeof observed !== "number" || !Number.isFinite(observed) || observed < 0 ||
    observed > Number.MAX_SAFE_INTEGER) {
    throw clockIntegrityInvalid();
  }
  return observed;
}

function defaultMonotonicNowMs(): number {
  return performance.now();
}

function clockIntegrityInvalid(): CodexRuntimeError {
  return new CodexRuntimeError("codex_process_failed");
}

export function createCodexCliModelAdapterForTest(
  options: CodexCliModelAdapterOptions,
): CodexCliModelAdapter {
  return new CodexCliModelAdapter(options);
}

function freezeJson(value: JsonValue): JsonValue {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    for (const entry of value) freezeJson(entry);
    return Object.freeze(value);
  }
  const object = value as { readonly [key: string]: JsonValue };
  for (const key of Object.keys(object)) freezeJson(object[key] as JsonValue);
  return Object.freeze(object);
}

function throwIfAborted(signal: AbortSignal): void {
  if (NATIVE_ABORTED_GETTER?.call(signal) !== true) return;
  throw NATIVE_REASON_GETTER?.call(signal) ?? new DOMException("Aborted", "AbortError");
}
