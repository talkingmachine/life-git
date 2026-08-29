import { access, lstat, realpath } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

import { CodexRuntimeError } from "./contracts";
import { CODEX_DISABLED_FEATURES, parseSupportedCodexCliVersion } from "./policy";
import { runBoundedProcess, type CodexProcessSpawner } from "./process";
import { REVIEWED_CODEX_EXECUTABLE, verifyReviewedLocalCodexInstallation } from "./reviewed-installation";

export const CODEX_PREFLIGHT_LIMITS = Object.freeze({
  timeoutMs: 5_000,
  maxStdoutBytes: 4_096,
  maxStderrBytes: 16_384,
} as const);

const CODEX_FEATURE_INVENTORY_LIMITS = Object.freeze({
  ...CODEX_PREFLIGHT_LIMITS,
  maxStdoutBytes: 16_384,
} as const);

export { CODEX_DISABLED_FEATURES } from "./policy";

export const CODEX_FEATURE_INVENTORY_ARGS = Object.freeze([
  ...CODEX_DISABLED_FEATURES.flatMap((feature) => ["--disable", feature]),
  "features",
  "list",
] as const);

const CHATGPT_APP_CODEX = REVIEWED_CODEX_EXECUTABLE;
const KNOWN_PATH_ALIAS_WARNING =
  "WARNING: proceeding, even though we could not create PATH aliases: Operation not permitted (os error 1)\n";
const CHATGPT_LOGIN_STATUS = "Logged in using ChatGPT\n";

export interface CodexPreflightResult {
  readonly executable: string;
  readonly cliVersion: string;
  readonly authenticatedWith: "ChatGPT";
}

export async function preflightCodexCli(input: {
  readonly configuredExecutable?: string;
  readonly pathValue?: string;
  readonly spawner: CodexProcessSpawner;
  readonly childEnv: Readonly<Record<string, string>>;
  readonly signal: AbortSignal;
}): Promise<CodexPreflightResult> {
  return preflightWithProbe(input, runTextProbe);
}

/** Production-only preflight: every child is re-attested and bound to the reviewed executable. */
export async function preflightReviewedCodexCli(input: {
  readonly configuredExecutable?: string;
  readonly pathValue?: string;
  readonly spawner: CodexProcessSpawner;
  readonly childEnv: Readonly<Record<string, string>>;
  readonly signal: AbortSignal;
}): Promise<CodexPreflightResult> {
  if (input.configuredExecutable !== undefined && input.configuredExecutable !== REVIEWED_CODEX_EXECUTABLE) {
    throw new CodexRuntimeError("codex_version_mismatch");
  }
  return preflightWithProbe({ ...input, configuredExecutable: REVIEWED_CODEX_EXECUTABLE }, createReviewedTextProbe(REVIEWED_CODEX_EXECUTABLE, verifyReviewedLocalCodexInstallation));
}

/** Isolated-only seam for adapter tests; it cannot alter the production reviewed path. */
export async function preflightReviewedCodexCliForTest(input: {
  readonly configuredExecutable?: string;
  readonly pathValue?: string;
  readonly spawner: CodexProcessSpawner;
  readonly childEnv: Readonly<Record<string, string>>;
  readonly signal: AbortSignal;
}, reviewedExecutable: string, verifyInstallation: () => Promise<void>): Promise<CodexPreflightResult> {
  if (input.configuredExecutable !== undefined && input.configuredExecutable !== reviewedExecutable) {
    throw new CodexRuntimeError("codex_version_mismatch");
  }
  return preflightWithProbe({ ...input, configuredExecutable: reviewedExecutable }, createReviewedTextProbe(reviewedExecutable, verifyInstallation));
}

async function preflightWithProbe(
  input: {
    readonly configuredExecutable?: string;
    readonly pathValue?: string;
    readonly spawner: CodexProcessSpawner;
    readonly childEnv: Readonly<Record<string, string>>;
    readonly signal: AbortSignal;
  },
  probe: typeof runTextProbe,
): Promise<CodexPreflightResult> {
  const executable = await resolveCodexExecutable(input.configuredExecutable, input.pathValue);
  if (executable === undefined) throw new CodexRuntimeError("codex_missing");

  const version = await probe(executable, ["--version"], input, { captureStderr: true });
  if (
    (version.stderr !== "" && version.stderr !== KNOWN_PATH_ALIAS_WARNING)
  ) {
    throw new CodexRuntimeError("codex_version_mismatch");
  }
  const cliVersion = parseSupportedCodexCliVersion(version.stdout);

  const loginStatus = await probe(executable, ["login", "status"], input, {
    captureStderr: true,
  });
  if (
    loginStatus.stdout !== "" ||
    (loginStatus.stderr !== CHATGPT_LOGIN_STATUS &&
      loginStatus.stderr !== `${KNOWN_PATH_ALIAS_WARNING}${CHATGPT_LOGIN_STATUS}`)
  ) {
    throw new CodexRuntimeError("codex_not_authenticated");
  }

  return { executable, cliVersion, authenticatedWith: "ChatGPT" };
}

export async function readDisabledFeatureInventory(input: {
  readonly preflight: CodexPreflightResult;
  readonly spawner: CodexProcessSpawner;
  readonly childEnv: Readonly<Record<string, string>>;
  readonly signal: AbortSignal;
}): Promise<Readonly<Record<(typeof CODEX_DISABLED_FEATURES)[number], false>>> {
  return readFeatureInventoryWithProbe(input, runTextProbe);
}

/** Production-only feature gate: it never probes a caller-selected binary. */
export async function readReviewedDisabledFeatureInventory(input: {
  readonly preflight: CodexPreflightResult;
  readonly spawner: CodexProcessSpawner;
  readonly childEnv: Readonly<Record<string, string>>;
  readonly signal: AbortSignal;
}): Promise<Readonly<Record<(typeof CODEX_DISABLED_FEATURES)[number], false>>> {
  if (input.preflight.executable !== REVIEWED_CODEX_EXECUTABLE) throw new CodexRuntimeError("codex_version_mismatch");
  return readFeatureInventoryWithProbe(input, createReviewedTextProbe(REVIEWED_CODEX_EXECUTABLE, verifyReviewedLocalCodexInstallation));
}

/** Isolated-only seam for adapter tests; it cannot alter the production reviewed path. */
export async function readReviewedDisabledFeatureInventoryForTest(input: {
  readonly preflight: CodexPreflightResult;
  readonly spawner: CodexProcessSpawner;
  readonly childEnv: Readonly<Record<string, string>>;
  readonly signal: AbortSignal;
}, reviewedExecutable: string, verifyInstallation: () => Promise<void>): Promise<Readonly<Record<(typeof CODEX_DISABLED_FEATURES)[number], false>>> {
  if (input.preflight.executable !== reviewedExecutable) throw new CodexRuntimeError("codex_version_mismatch");
  return readFeatureInventoryWithProbe(input, createReviewedTextProbe(reviewedExecutable, verifyInstallation));
}

async function readFeatureInventoryWithProbe(
  input: {
    readonly preflight: CodexPreflightResult;
    readonly spawner: CodexProcessSpawner;
    readonly childEnv: Readonly<Record<string, string>>;
    readonly signal: AbortSignal;
  },
  probe: typeof runTextProbe,
): Promise<Readonly<Record<(typeof CODEX_DISABLED_FEATURES)[number], false>>> {
  const { stdout } = await probe(input.preflight.executable, CODEX_FEATURE_INVENTORY_ARGS, input, {
    limits: CODEX_FEATURE_INVENTORY_LIMITS,
  });
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
  options: {
    readonly captureStderr?: boolean;
    readonly limits?: {
      readonly timeoutMs: number;
      readonly maxStdoutBytes: number;
      readonly maxStderrBytes: number;
    };
  } = {},
): Promise<{ readonly stdout: string; readonly stderr?: string }> {
  const result = await runBoundedProcess({
    executable,
    args,
    cwd: dirname(executable),
    env: createClosedCodexEnvironment(input.childEnv),
    stdin: new Uint8Array(),
    ...(options.limits ?? CODEX_PREFLIGHT_LIMITS),
    signal: input.signal,
    captureStderr: options.captureStderr,
  }, input.spawner);
  return {
    stdout: decodeChunks(result.stdout),
    ...(result.stderr === undefined ? {} : { stderr: decodeChunks(result.stderr) }),
  };
}

function createReviewedTextProbe(reviewedExecutable: string, verifyInstallation: () => Promise<void>): typeof runTextProbe {
  return async (executable, args, input, options = {}) => {
    if (executable !== reviewedExecutable) throw new CodexRuntimeError("codex_version_mismatch");
    await verifyInstallation();
    return runTextProbe(executable, args, input, options);
  };
}

export function createClosedCodexEnvironment(
  source: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  const environment: Record<string, string> = {};
  for (const name of ["CODEX_HOME", "TMPDIR", "LANG", "LC_ALL"] as const) {
    const value = source[name];
    if (value !== undefined) environment[name] = value;
  }
  return environment;
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
    const match = /^(\S+)\s+(.+?)\s+(true|false)$/.exec(line);
    if (match === null || match[1] === undefined || match[3] === undefined || inventory.has(match[1])) {
      throw new CodexRuntimeError("codex_tool_isolation_unproven");
    }
    inventory.set(match[1], match[3] === "true");
  }
  return inventory;
}
