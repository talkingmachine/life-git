import { homedir } from "node:os";

import { CodexRuntimeError, createCodexJsonInvocation, type CodexReasoningEffort } from "./contracts";
import { CodexFlightPool } from "./flight-pool";
import { CodexCliModelAdapter } from "./model-adapter";
import {
  createClosedCodexEnvironment,
  preflightCodexCli,
  readDisabledFeatureInventory,
} from "./preflight";
import type { CodexProcessSpawner } from "./process";
import { scavengeStaleCodexDirectories, validateCodexTempRoot } from "./temp-directory";

const NATIVE_ABORTED_GETTER = Object.getOwnPropertyDescriptor(AbortSignal.prototype, "aborted")?.get;
const NATIVE_REASON_GETTER = Object.getOwnPropertyDescriptor(AbortSignal.prototype, "reason")?.get;
const RUNTIME_STATE_KEY = Symbol.for("confirmed-life.codex-cli-runtime@1");

export interface InitializeCodexCliRuntimeInput {
  readonly configuredExecutable?: string;
  readonly pathValue?: string;
  readonly tempRootPath: string;
  readonly currentUid: number;
  readonly childEnv: Readonly<Record<string, string>>;
  readonly spawner: CodexProcessSpawner;
  readonly clock: () => Date;
  readonly signal: AbortSignal;
}

interface CodexCliRuntimeState {
  initialization: Promise<void> | undefined;
  installedAdapter: CodexCliModelAdapter | undefined;
}

export function initializeCodexCliRuntime(input: InitializeCodexCliRuntimeInput): Promise<void> {
  const state = runtimeState();
  if (state.initialization === undefined) {
    const attempt = initializeOnce(snapshotInput(input), state);
    state.initialization = attempt;
    void attempt.catch(() => {
      if (state.initialization === attempt) state.initialization = undefined;
    });
  }
  return state.initialization;
}

export function getCodexCliModelAdapter(): CodexCliModelAdapter {
  const adapter = runtimeState().installedAdapter;
  if (adapter === undefined) throw new CodexRuntimeError("codex_process_failed");
  return adapter;
}

export interface CodexCliCapabilityVerification {
  readonly schemaVersion: "codex-runtime-smoke@2";
  readonly low: Readonly<{ webSearchCount: 0 }>;
  readonly medium: Readonly<{ webSearchCount: 0 }>;
  readonly discovery: Readonly<{ webSearchCount: number }>;
}

/** Explicit subscription-consuming gate; startup itself intentionally remains static. */
export async function verifyCodexCliCapabilities(signal: AbortSignal): Promise<CodexCliCapabilityVerification> {
  const adapter = getCodexCliModelAdapter();
  const zeroToolCounts: { low?: 0; medium?: 0 } = {};
  for (const reasoningEffort of ["low", "medium"] as const) {
    const outcome = await adapter.invokeJsonForRuntimeCapabilityVerification(smokeInvocation(reasoningEffort, signal));
    assertSmokeResult(outcome.result.value);
    if (outcome.eventProof.webSearchCount !== 0) throw new CodexRuntimeError("codex_tool_event");
    zeroToolCounts[reasoningEffort] = 0;
  }
  const discovery = await adapter.invokeJsonForRuntimeCapabilityVerification(createCodexJsonInvocation({
    capability: "source.discover",
    reasoningEffort: "medium",
    toolPolicy: "codex-tools-web-search@1",
    templateVersion: "codex-runtime-discovery-smoke@2",
    schemaVersion: "codex-runtime-smoke@2",
    prompt: "Use native web search only to find the current official OpenAI developer documentation home. Return only the required synthetic status object.",
    outputSchema: smokeOutputSchema(),
    limits: smokeLimits(),
    signal,
  }));
  assertSmokeResult(discovery.result.value);
  if (discovery.eventProof.webSearchCount < 1 || discovery.eventProof.webSearchCount > smokeLimits().maxEvents) throw new CodexRuntimeError("codex_tool_event");
  return Object.freeze({ schemaVersion: "codex-runtime-smoke@2", low: Object.freeze({ webSearchCount: zeroToolCounts.low! }), medium: Object.freeze({ webSearchCount: zeroToolCounts.medium! }), discovery: Object.freeze({ webSearchCount: discovery.eventProof.webSearchCount }) });
}

interface OwnedInitializationInput {
  readonly configuredExecutable?: string;
  readonly pathValue?: string;
  readonly tempRootPath: string;
  readonly currentUid: number;
  readonly childEnv: Readonly<Record<string, string>>;
  readonly spawner: CodexProcessSpawner;
  readonly clock: () => Date;
  readonly signal: AbortSignal;
}

function snapshotInput(input: InitializeCodexCliRuntimeInput): OwnedInitializationInput {
  return Object.freeze({
    ...(input.configuredExecutable === undefined ? {} : { configuredExecutable: input.configuredExecutable }),
    ...(input.pathValue === undefined ? {} : { pathValue: input.pathValue }),
    tempRootPath: input.tempRootPath,
    currentUid: input.currentUid,
    childEnv: Object.freeze(createClosedCodexEnvironment(input.childEnv)),
    spawner: input.spawner,
    clock: input.clock,
    signal: input.signal,
  });
}

async function initializeOnce(
  input: OwnedInitializationInput,
  state: CodexCliRuntimeState,
): Promise<void> {
  throwIfAborted(input.signal);
  const tempRoot = await validateCodexTempRoot({
    path: input.tempRootPath,
    currentUid: input.currentUid,
    userHomePath: homedir(),
    workspacePath: process.cwd(),
  });
  throwIfAborted(input.signal);

  const now = input.clock();
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new CodexRuntimeError("codex_process_failed");
  }
  await scavengeStaleCodexDirectories({
    root: tempRoot,
    now: new Date(now.getTime()),
    staleAfterMs: 3_600_000,
  });
  throwIfAborted(input.signal);

  const preflight = await preflightCodexCli({
    ...(input.configuredExecutable === undefined ? {} : { configuredExecutable: input.configuredExecutable }),
    ...(input.pathValue === undefined ? {} : { pathValue: input.pathValue }),
    spawner: input.spawner,
    childEnv: input.childEnv,
    signal: input.signal,
  });
  await readDisabledFeatureInventory({
    preflight,
    spawner: input.spawner,
    childEnv: input.childEnv,
    signal: input.signal,
  });
  throwIfAborted(input.signal);

  state.installedAdapter = new CodexCliModelAdapter({
    preflight,
    spawner: input.spawner,
    tempRoot,
    childEnv: input.childEnv,
    flightPool: new CodexFlightPool({
      maximumConcurrency: 5,
      cooldownMs: 60_000,
      now: Date.now,
      classifyPressure: (error) => {
        if (!(error instanceof CodexRuntimeError)) return undefined;
        if (error.code === "codex_rate_limited") return "rate_limited";
        if (error.code === "codex_provider_transient") return "provider_transient";
        if (error.code === "codex_timeout") return "timeout";
        return undefined;
      },
    }),
  });
}

function smokeInvocation(reasoningEffort: CodexReasoningEffort, signal: AbortSignal) {
  return createCodexJsonInvocation({
    capability: "onboarding.extract",
    reasoningEffort,
    toolPolicy: "codex-tools-none@2",
    templateVersion: "codex-runtime-smoke@2",
    schemaVersion: "codex-runtime-smoke@2",
    prompt: "Return only the required synthetic status object.",
    outputSchema: smokeOutputSchema(),
    limits: smokeLimits(),
    signal,
  });
}

function smokeOutputSchema() {
  return Object.freeze({
    type: "object",
    additionalProperties: false,
    required: ["schemaVersion", "status"],
    properties: {
      schemaVersion: { const: "codex-runtime-smoke@2" },
      status: { const: "ok" },
    },
  });
}

function smokeLimits() {
  return Object.freeze({ timeoutMs: 30_000, maxStdoutBytes: 131_072, maxStderrBytes: 16_384, maxEvents: 128 });
}

function assertSmokeResult(value: unknown): void {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new CodexRuntimeError("codex_json_invalid");
  const object = value as Record<string, unknown>;
  if (Object.keys(object).length !== 2 || object.schemaVersion !== "codex-runtime-smoke@2" || object.status !== "ok") {
    throw new CodexRuntimeError("codex_json_invalid");
  }
}

function runtimeState(): CodexCliRuntimeState {
  const target = globalThis as typeof globalThis & { [key: symbol]: unknown };
  const existing = target[RUNTIME_STATE_KEY];
  if (existing !== undefined) return existing as CodexCliRuntimeState;
  const created: CodexCliRuntimeState = {
    initialization: undefined,
    installedAdapter: undefined,
  };
  target[RUNTIME_STATE_KEY] = created;
  return created;
}

function throwIfAborted(signal: AbortSignal): void {
  if (NATIVE_ABORTED_GETTER?.call(signal) !== true) return;
  throw NATIVE_REASON_GETTER?.call(signal) ?? new DOMException("Aborted", "AbortError");
}
