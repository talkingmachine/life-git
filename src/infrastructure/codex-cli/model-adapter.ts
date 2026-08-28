import { createHash } from "node:crypto";

import {
  CODEX_CLI_COMPATIBILITY_POLICY,
  CODEX_CLI_PROTOCOL_VERSION,
  CODEX_INVOCATION_VERSION,
  CODEX_MODEL,
  CodexRuntimeError,
  type CodexJsonInvocation,
  type CodexJsonResult,
} from "./contracts";
import { runCodexJsonProbe } from "./feasibility-probe";
import { CodexFlightPool } from "./flight-pool";
import { snapshotOwnedJson, type JsonValue } from "./owned-json";
import { codexPolicyFingerprint } from "./policy";
import { createClosedCodexEnvironment, type CodexPreflightResult } from "./preflight";
import type { CodexProcessSpawner } from "./process";
import type { ValidatedCodexTempRoot } from "./temp-directory";

const NATIVE_ABORTED_GETTER = Object.getOwnPropertyDescriptor(AbortSignal.prototype, "aborted")?.get;
const NATIVE_REASON_GETTER = Object.getOwnPropertyDescriptor(AbortSignal.prototype, "reason")?.get;

export interface CodexCliModelAdapterOptions {
  readonly preflight: CodexPreflightResult;
  readonly spawner: CodexProcessSpawner;
  readonly tempRoot: ValidatedCodexTempRoot;
  readonly childEnv: Readonly<Record<string, string>>;
  readonly flightPool?: CodexFlightPool;
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

  constructor(options: CodexCliModelAdapterOptions) {
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
        const probe = await runCodexJsonProbe({
          invocation: Object.freeze({ ...input, signal }),
          preflight: this.#preflight,
          spawner: this.#spawner,
          tempRoot: this.#tempRoot,
          childEnv: this.#childEnv,
          flightKey: key,
        });
        throwIfAborted(signal);
        let value: JsonValue;
        try {
          value = freezeJson(snapshotOwnedJson(JSON.parse(probe.finalMessage) as unknown));
        } catch {
          throw new CodexRuntimeError("codex_json_invalid");
        }
        throwIfAborted(signal);
        const result = Object.freeze({
          value,
          metadata: Object.freeze({
            invocationVersion: CODEX_INVOCATION_VERSION,
            protocolVersion: CODEX_CLI_PROTOCOL_VERSION,
            compatibilityPolicy: CODEX_CLI_COMPATIBILITY_POLICY,
            cliVersion: this.#preflight.cliVersion,
            model: CODEX_MODEL,
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
    model: CODEX_MODEL,
    outputSchemaHash: sha256(canonicalJson(input.outputSchema)),
    policyFingerprint: codexPolicyFingerprint,
    promptHash: sha256(input.prompt),
    reasoningEffort: input.reasoningEffort,
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
