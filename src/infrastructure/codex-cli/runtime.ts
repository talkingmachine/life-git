import { homedir } from "node:os";
import { types } from "node:util";

import { CodexRuntimeError, createCodexJsonInvocation, type CodexReasoningEffort } from "./contracts";
import { CodexFlightPool } from "./flight-pool";
import { CodexCliModelAdapter, createCodexCliModelAdapterForTest, createReviewedCodexCliModelAdapter } from "./model-adapter";
import {
  preflightCodexCli,
  createClosedCodexEnvironment,
  preflightReviewedCodexCli,
  readDisabledFeatureInventory,
  readReviewedDisabledFeatureInventory,
} from "./preflight";
import type { CodexProcessSpawner } from "./process";
import { scavengeStaleCodexDirectories, validateCodexTempRoot } from "./temp-directory";
import { REVIEWED_CODEX_EXECUTABLE, verifyReviewedLocalCodexInstallation } from "./reviewed-installation";

const NATIVE_ABORTED_GETTER = Object.getOwnPropertyDescriptor(AbortSignal.prototype, "aborted")?.get;
const NATIVE_REASON_GETTER = Object.getOwnPropertyDescriptor(AbortSignal.prototype, "reason")?.get;
const RUNTIME_STATE_KEY = Symbol.for("confirmed-life.codex-cli-runtime@1");

export interface InitializeCodexCliRuntimeInput {
  readonly configuredExecutable?: string;
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

/** Isolated runtime state for tests; it never reads or writes the production singleton. */
export function createCodexCliRuntimeForTest(): Readonly<{
  initializeCodexCliRuntime(input: InitializeCodexCliRuntimeInput): Promise<void>;
  getCodexCliModelAdapter(): CodexCliModelAdapter;
  verifyCodexCliCapabilities(signal: AbortSignal): Promise<CodexCliCapabilityVerification>;
}> {
  const state: CodexCliRuntimeState = { initialization: undefined, installedAdapter: undefined };
  const getAdapter = (): CodexCliModelAdapter => {
    if (state.installedAdapter === undefined) throw new CodexRuntimeError("codex_process_failed");
    return state.installedAdapter;
  };
  return Object.freeze({
    initializeCodexCliRuntime: (input) => initializeTestRuntime(input, state),
    getCodexCliModelAdapter: getAdapter,
    verifyCodexCliCapabilities: (signal) => verifyCapabilities(getAdapter, signal),
  });
}

export interface CodexCliCapabilityVerification {
  readonly schemaVersion: "codex-runtime-capabilities@1";
  readonly low: Readonly<{ webSearchCount: 0 }>;
  readonly medium: Readonly<{ webSearchCount: 0 }>;
  readonly discovery: Readonly<{
    availability: "available";
    selection: "model-selected";
    webSearchCount: number;
  }>;
}

/** Explicit subscription-consuming gate; startup itself intentionally remains static. */
export async function verifyCodexCliCapabilities(signal: AbortSignal): Promise<CodexCliCapabilityVerification> {
  return verifyCapabilities(getCodexCliModelAdapter, signal);
}

async function verifyCapabilities(
  getAdapter: () => CodexCliModelAdapter,
  signal: AbortSignal,
): Promise<CodexCliCapabilityVerification> {
  const adapter = getAdapter();
  const zeroToolCounts: { low?: 0; medium?: 0 } = {};
  for (const reasoningEffort of ["low", "medium"] as const) {
    const outcome = await adapter.invokeJsonWithEventProof(smokeInvocation(reasoningEffort, signal));
    assertSmokeResult(outcome.result.value);
    if (outcome.eventProof.webSearchCount !== 0) throw new CodexRuntimeError("codex_tool_event");
    zeroToolCounts[reasoningEffort] = 0;
  }
  let discoveryCount = 0;
  try {
    const discovery = await adapter.invokeJsonWithEventProof(createCodexJsonInvocation({
      capability: "source.discover",
      reasoningEffort: "medium",
      toolPolicy: "codex-tools-web-search@2",
      templateVersion: "codex-runtime-discovery-smoke@3",
      schemaVersion: "codex-runtime-smoke@2",
      prompt: "Use native web search only to find the current official OpenAI developer documentation home. Return only the required synthetic status object.",
      outputSchema: smokeOutputSchema(),
      limits: smokeLimits(),
      signal,
    }));
    assertSmokeResult(discovery.result.value);
    if (!isValidSearchCount(discovery.eventProof.webSearchCount, smokeLimits().maxEvents)) throw new CodexRuntimeError("codex_tool_event");
    discoveryCount = discovery.eventProof.webSearchCount;
  } catch (error) {
    if (!isExactNativeSearchNotPerformed(error)) throw error;
  }
  return Object.freeze({ schemaVersion: "codex-runtime-capabilities@1", low: Object.freeze({ webSearchCount: zeroToolCounts.low! }), medium: Object.freeze({ webSearchCount: zeroToolCounts.medium! }), discovery: Object.freeze({ availability: "available", selection: "model-selected", webSearchCount: discoveryCount }) });
}

function initializeTestRuntime(input: InitializeCodexCliRuntimeInput, state: CodexCliRuntimeState): Promise<void> {
  if (state.initialization === undefined) {
    const attempt = initializeTestOnce(snapshotInput(input), state);
    state.initialization = attempt;
    void attempt.catch(() => { if (state.initialization === attempt) state.initialization = undefined; });
  }
  return state.initialization;
}

async function initializeTestOnce(input: OwnedInitializationInput, state: CodexCliRuntimeState): Promise<void> {
  throwIfAborted(input.signal);
  const tempRoot = await validateCodexTempRoot({ path: input.tempRootPath, currentUid: input.currentUid, userHomePath: homedir(), workspacePath: process.cwd() });
  const now = input.clock();
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new CodexRuntimeError("codex_process_failed");
  await scavengeStaleCodexDirectories({ root: tempRoot, now: new Date(now.getTime()), staleAfterMs: 3_600_000 });
  const preflight = await preflightCodexCli({
    configuredExecutable: input.configuredExecutable, spawner: input.spawner, childEnv: input.childEnv, signal: input.signal,
  });
  await readDisabledFeatureInventory({
    preflight, spawner: input.spawner, childEnv: input.childEnv, signal: input.signal,
  });
  state.installedAdapter = createCodexCliModelAdapterForTest({
    preflight, spawner: input.spawner, tempRoot, childEnv: input.childEnv,
  });
}

function isExactNativeSearchNotPerformed(error: unknown): boolean {
  try {
    if (types.isProxy(error) || !types.isNativeError(error) ||
      Object.getPrototypeOf(error) !== CodexRuntimeError.prototype ||
      Object.getOwnPropertySymbols(error).length !== 0) return false;
    const code = Object.getOwnPropertyDescriptor(error, "code");
    const message = Object.getOwnPropertyDescriptor(error, "message");
    const name = Object.getOwnPropertyDescriptor(error, "name");
    return code?.enumerable === true && "value" in code && code.value === "codex_search_not_performed" &&
      message?.enumerable === false && "value" in message && message.value === code.value &&
      name?.enumerable === true && "value" in name && name.value === "CodexRuntimeError";
  } catch {
    return false;
  }
}

function isValidSearchCount(value: unknown, maximum: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1 && value <= maximum;
}

interface OwnedInitializationInput {
  readonly configuredExecutable?: string;
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
  if (input.configuredExecutable !== undefined && input.configuredExecutable !== REVIEWED_CODEX_EXECUTABLE) {
    throw new CodexRuntimeError("codex_version_mismatch");
  }
  await verifyReviewedLocalCodexInstallation();
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

  const preflight = await preflightReviewedCodexCli({
    configuredExecutable: REVIEWED_CODEX_EXECUTABLE,
    spawner: input.spawner,
    childEnv: input.childEnv,
    signal: input.signal,
  });
  await readReviewedDisabledFeatureInventory({
    preflight,
    spawner: input.spawner,
    childEnv: input.childEnv,
    signal: input.signal,
  });
  throwIfAborted(input.signal);

  state.installedAdapter = createReviewedCodexCliModelAdapter({
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
      schemaVersion: { type: "string", enum: ["codex-runtime-smoke@2"] },
      status: { type: "string", enum: ["ok"] },
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
