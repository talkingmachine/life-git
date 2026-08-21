import { access, lstat, realpath } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

import { CODEX_CLI_VERSION, CodexRuntimeError } from "./contracts";
import { runBoundedProcess, type CodexProcessSpawner } from "./process";

export const CODEX_PREFLIGHT_LIMITS = Object.freeze({
  timeoutMs: 5_000,
  maxStdoutBytes: 4_096,
  maxStderrBytes: 16_384,
} as const);

export const CODEX_DISABLED_FEATURES = Object.freeze([
  "skill_search",
  "skill_mcp_dependency_install",
] as const);

export const CODEX_FEATURE_INVENTORY_ARGS = Object.freeze(["features", "list"] as const);

const CHATGPT_APP_CODEX = "/Applications/ChatGPT.app/Contents/Resources/codex";

export interface CodexPreflightResult {
  readonly executable: string;
  readonly cliVersion: typeof CODEX_CLI_VERSION;
  readonly authenticatedWith: "ChatGPT";
}

export async function preflightCodexCli(input: {
  readonly configuredExecutable?: string;
  readonly pathValue?: string;
  readonly spawner: CodexProcessSpawner;
  readonly childEnv: Readonly<Record<string, string>>;
  readonly signal: AbortSignal;
}): Promise<CodexPreflightResult> {
  const executable = await resolveCodexExecutable(input.configuredExecutable, input.pathValue);
  if (executable === undefined) throw new CodexRuntimeError("codex_missing");

  const version = await runTextProbe(executable, ["--version"], input);
  if (version !== CODEX_CLI_VERSION) throw new CodexRuntimeError("codex_version_mismatch");

  const loginStatus = await runTextProbe(executable, ["login", "status"], input);
  if (loginStatus !== "Logged in using ChatGPT") throw new CodexRuntimeError("codex_not_authenticated");

  return { executable, cliVersion: CODEX_CLI_VERSION, authenticatedWith: "ChatGPT" };
}

export async function readDisabledFeatureInventory(input: {
  readonly preflight: CodexPreflightResult;
  readonly spawner: CodexProcessSpawner;
  readonly childEnv: Readonly<Record<string, string>>;
  readonly signal: AbortSignal;
}): Promise<Readonly<Record<(typeof CODEX_DISABLED_FEATURES)[number], false>>> {
  const stdout = await runTextProbe(input.preflight.executable, CODEX_FEATURE_INVENTORY_ARGS, input);
  const inventory = parseFeatureInventory(stdout);
  const disabled = Object.create(null) as Record<(typeof CODEX_DISABLED_FEATURES)[number], false>;
  for (const feature of CODEX_DISABLED_FEATURES) {
    if (inventory.get(feature) !== false) throw new CodexRuntimeError("codex_tool_isolation_unproven");
    disabled[feature] = false;
  }
  return Object.freeze(disabled);
}

async function resolveCodexExecutable(
  configuredExecutable: string | undefined,
  pathValue: string | undefined,
): Promise<string | undefined> {
  if (configuredExecutable !== undefined) {
    return await validateExecutable(configuredExecutable) ? resolve(configuredExecutable) : undefined;
  }

  const candidates = [CHATGPT_APP_CODEX, ...pathCandidates(pathValue)];
  for (const candidate of candidates) {
    if (await validateExecutable(candidate)) return resolve(candidate);
  }
  return undefined;
}

function pathCandidates(pathValue: string | undefined): readonly string[] {
  if (pathValue === undefined || pathValue.length === 0) return [];
  return pathValue.split(":").filter((entry) => entry.length > 0).map((entry) => join(resolve(entry), "codex"));
}

async function validateExecutable(path: string): Promise<boolean> {
  if (!isAbsolute(path)) return false;
  try {
    const metadata = await lstat(path);
    if (metadata.isSymbolicLink() || !metadata.isFile()) return false;
    if (await realpath(path) !== resolve(path)) return false;
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function runTextProbe(
  executable: string,
  args: readonly string[],
  input: {
    readonly spawner: CodexProcessSpawner;
    readonly childEnv: Readonly<Record<string, string>>;
    readonly signal: AbortSignal;
  },
): Promise<string> {
  const result = await runBoundedProcess({
    executable,
    args,
    cwd: dirname(executable),
    env: input.childEnv,
    stdin: new Uint8Array(),
    ...CODEX_PREFLIGHT_LIMITS,
    signal: input.signal,
  }, input.spawner);
  return decodeChunks(result.stdout);
}

function decodeChunks(chunks: readonly Uint8Array[]): string {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  try {
    let text = "";
    for (const chunk of chunks) text += decoder.decode(chunk, { stream: true });
    return text + decoder.decode();
  } catch {
    throw new CodexRuntimeError("codex_protocol_invalid");
  }
}

function parseFeatureInventory(stdout: string): ReadonlyMap<string, boolean> {
  const inventory = new Map<string, boolean>();
  const lines = stdout.endsWith("\n") ? stdout.slice(0, -1).split("\n") : [];
  for (const line of lines) {
    const match = /^(\S+)\s+(\S+)\s+(true|false)$/.exec(line);
    if (match === null || match[1] === undefined || match[3] === undefined || inventory.has(match[1])) {
      throw new CodexRuntimeError("codex_tool_isolation_unproven");
    }
    inventory.set(match[1], match[3] === "true");
  }
  return inventory;
}
