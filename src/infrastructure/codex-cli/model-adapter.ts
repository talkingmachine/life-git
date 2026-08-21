import {
  CODEX_CLI_VERSION,
  CODEX_INVOCATION_VERSION,
  CodexRuntimeError,
  type CodexJsonInvocation,
  type CodexJsonResult,
} from "./contracts";
import { runCodexJsonProbe } from "./feasibility-probe";
import { snapshotOwnedJson, type JsonValue } from "./owned-json";
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
}

export class CodexCliModelAdapter {
  readonly #preflight: CodexPreflightResult;
  readonly #spawner: CodexProcessSpawner;
  readonly #tempRoot: ValidatedCodexTempRoot;
  readonly #childEnv: Readonly<Record<string, string>>;

  constructor(options: CodexCliModelAdapterOptions) {
    this.#preflight = Object.freeze({
      executable: options.preflight.executable,
      cliVersion: options.preflight.cliVersion,
      authenticatedWith: options.preflight.authenticatedWith,
    });
    this.#spawner = options.spawner;
    this.#tempRoot = Object.freeze({ path: options.tempRoot.path, uid: options.tempRoot.uid });
    this.#childEnv = Object.freeze(createClosedCodexEnvironment(options.childEnv));
  }

  async invokeJson(input: CodexJsonInvocation): Promise<CodexJsonResult> {
    const templateVersion = input.templateVersion;
    const schemaVersion = input.schemaVersion;
    const probe = await runCodexJsonProbe({
      invocation: input,
      preflight: this.#preflight,
      spawner: this.#spawner,
      tempRoot: this.#tempRoot,
      childEnv: this.#childEnv,
    });
    throwIfAborted(input.signal);

    let value: JsonValue;
    try {
      value = freezeJson(snapshotOwnedJson(JSON.parse(probe.finalMessage) as unknown));
    } catch {
      throw new CodexRuntimeError("codex_json_invalid");
    }
    throwIfAborted(input.signal);

    const metadata = Object.freeze({
      invocationVersion: CODEX_INVOCATION_VERSION,
      cliVersion: CODEX_CLI_VERSION,
      templateVersion,
      schemaVersion,
    });
    return Object.freeze({ value, metadata });
  }
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
