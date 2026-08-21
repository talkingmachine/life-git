import { homedir } from "node:os";

import { CodexRuntimeError } from "./contracts";
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
  state.initialization ??= initializeOnce(snapshotInput(input), state);
  return state.initialization;
}

export function getCodexCliModelAdapter(): CodexCliModelAdapter {
  const adapter = runtimeState().installedAdapter;
  if (adapter === undefined) throw new CodexRuntimeError("codex_process_failed");
  return adapter;
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
  });
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
