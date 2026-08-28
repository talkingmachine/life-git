import { readFile, readdir, realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const STATIC_AUDIT_SCHEMA_VERSION = "codex-runtime-static-audit@1" as const;
const EMPTY_MATCHES = Object.freeze([]) as readonly [];
const RUNTIME_SOURCE_EXTENSIONS = new Set([".cjs", ".cts", ".js", ".jsx", ".mjs", ".mts", ".ts", ".tsx"]);
const ROOT_RUNTIME_FILES = ["src/instrumentation.ts", "src/instrumentation-node.ts"] as const;
const ENVIRONMENT_TEMPLATE_NAME = /^\.env(?:\.[^.]+)*\.(?:defaults|example|sample|template)$/;

const LOCAL_MODEL_SURFACE = /(?:^|[^a-z0-9])(?:qwen|gguf|ollama|lm[\s_-]*studio|node-llama-cpp)(?:$|[^a-z0-9])/i;
const OPENAI_SDK_IMPORT = /(?:\bfrom\s*|\bimport\s*(?:\(\s*)?|\brequire\s*\()\s*["'](?:openai(?:\/[^"']*)?|@openai\/[^"']+)["']/;
const API_KEY_HANDLING = /\bOPENAI_API_KEY\b|\b(?:apiKey|api_key)\b|\b(?:store|save|persist|bill|charge)\w*\s*\([^)]*api[\s_-]*key/i;
const MODEL_DOWNLOAD_SURFACE = /\b(?:downloadModel|downloadWeights|modelWeights|model_weights|weightsPath|weights_path|huggingface|hf_hub)\b/i;
const FORBIDDEN_RUNTIME_METHOD = /--model\b|\bresume\s*\(|\bretry\s*\(|\bsetInterval\s*\(|\b(?:sessionId|session_id)\b|\b(?:retry|fallback)(?:Codex|Model|Provider|Invocation|Request)\b|\b(?:providerRegistry|modelProvider|switchProvider)\b|\b(?:start|spawn|create)?Background(?:Worker|Job|Queue)\b/;
const FIXED_TERRA_MODEL_ARGV = /["']--model["']\s*,\s*["']gpt-5\.6-terra["'](?=\s*(?:,|\]))/g;
const FIXED_TERRA_MODEL_GRAMMAR = /--model gpt-5\.6-terra\b/g;
const FIXED_MODEL_POLICY_PATH = join("src", "infrastructure", "codex-cli", "policy.ts");

export interface CodexRuntimeStaticAudit {
  readonly schemaVersion: typeof STATIC_AUDIT_SCHEMA_VERSION;
  readonly forbiddenDependencyMatches: readonly [];
  readonly apiKeyHandlingMatches: readonly [];
  readonly modelDownloadMatches: readonly [];
  readonly forbiddenRuntimeMethodMatches: readonly [];
}

export async function auditCodexRuntime(input: {
  readonly rootPath: string;
}): Promise<CodexRuntimeStaticAudit> {
  const rootPath = resolve(input.rootPath);
  await auditProductionDependencies(rootPath);
  auditBroadProductionSource(await readFile(join(rootPath, "package.json"), "utf8"));
  const productionPaths = await productionSourcePaths(rootPath);
  for (const filePath of productionPaths) auditBroadProductionSource(await readFile(filePath, "utf8"));
  for (const filePath of await codexRuntimeSourcePaths(rootPath)) {
    auditForbiddenRuntimeMethods(filePath, rootPath, await readFile(filePath, "utf8"));
  }
  return Object.freeze({
    schemaVersion: STATIC_AUDIT_SCHEMA_VERSION,
    forbiddenDependencyMatches: EMPTY_MATCHES,
    apiKeyHandlingMatches: EMPTY_MATCHES,
    modelDownloadMatches: EMPTY_MATCHES,
    forbiddenRuntimeMethodMatches: EMPTY_MATCHES,
  });
}

async function auditProductionDependencies(rootPath: string): Promise<void> {
  const rootManifestPath = join(rootPath, "package.json");
  const rootManifest = await readPackageManifest(rootManifestPath);
  const queue = dependencyEdges(rootManifest).map((edge) => ({ ...edge, ownerManifestPath: rootManifestPath }));
  const visited = new Set<string>();

  while (queue.length > 0) {
    const dependency = queue.shift();
    if (dependency === undefined) break;
    assertAllowedDependency(dependency.name, dependency.specifier);
    const manifestPath = await resolveDependencyManifest(
      rootPath,
      dependency.ownerManifestPath,
      dependency.name,
      dependency.mayBeAbsent,
    );
    if (manifestPath === undefined) continue;
    const canonicalManifestPath = await realpath(manifestPath);
    if (visited.has(canonicalManifestPath)) continue;
    visited.add(canonicalManifestPath);
    const manifest = await readPackageManifest(manifestPath);
    if (!isObject(manifest) || manifest.name !== dependency.name) throw auditFailed();
    assertAllowedDependencyName(manifest.name);
    for (const edge of dependencyEdges(manifest)) queue.push({ ...edge, ownerManifestPath: canonicalManifestPath });
  }
}

async function resolveDependencyManifest(
  rootPath: string,
  ownerManifestPath: string,
  dependencyName: string,
  mayBeAbsent: boolean,
): Promise<string | undefined> {
  try {
    const canonicalOwner = await realpath(ownerManifestPath);
    const resolvedEntry = createRequire(canonicalOwner).resolve(dependencyName);
    const manifestPath = await findOwningManifest(resolvedEntry);
    if (manifestPath !== undefined) return manifestPath;
  } catch {
    // The direct manifest fallback below supports packages without a resolvable entrypoint.
  }
  const candidates = await dependencyManifestCandidates(rootPath, ownerManifestPath, dependencyName);
  for (const candidate of candidates) {
    try {
      await readFile(candidate, "utf8");
      return candidate;
    } catch {
      // Optional or platform-specific production dependencies may be absent.
    }
  }
  if (mayBeAbsent) return undefined;
  throw auditFailed();
}

async function dependencyManifestCandidates(
  rootPath: string,
  ownerManifestPath: string,
  dependencyName: string,
): Promise<readonly string[]> {
  const packagePath = dependencyName.split("/");
  const candidates = new Set<string>();
  let directory = dirname(await realpath(ownerManifestPath));
  while (true) {
    candidates.add(basename(directory) === "node_modules"
      ? join(directory, ...packagePath, "package.json")
      : join(directory, "node_modules", ...packagePath, "package.json"));
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  candidates.add(join(rootPath, "node_modules", ...packagePath, "package.json"));
  return [...candidates];
}

async function findOwningManifest(resolvedEntry: string): Promise<string | undefined> {
  let directory = dirname(resolvedEntry);
  while (true) {
    const candidate = join(directory, "package.json");
    try {
      const manifest = JSON.parse(await readFile(candidate, "utf8")) as unknown;
      if (isObject(manifest) && typeof manifest.name === "string") return candidate;
    } catch {
      // Continue toward the package root when an intermediate manifest is absent or private.
    }
    const parent = dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
}

interface DependencyEdge {
  readonly name: string;
  readonly specifier: string;
  readonly mayBeAbsent: boolean;
}

function dependencyEdges(manifest: unknown): readonly DependencyEdge[] {
  if (!isObject(manifest)) throw auditFailed();
  const edges = new Map<string, DependencyEdge>();
  for (const [key, mayBeAbsent] of [["dependencies", false], ["optionalDependencies", true]] as const) {
    const record = manifest[key];
    if (record === undefined) continue;
    if (!isObject(record)) throw auditFailed();
    for (const [name, specifier] of Object.entries(record)) {
      if (typeof specifier !== "string") throw auditFailed();
      edges.set(name, { name, specifier, mayBeAbsent });
    }
  }
  const peerDependencies = manifest.peerDependencies;
  if (peerDependencies === undefined) return [...edges.values()];
  if (!isObject(peerDependencies)) throw auditFailed();
  const peerEdges = Object.entries(peerDependencies).map(([name, specifier]) => {
    if (typeof specifier !== "string") throw auditFailed();
    return { name, specifier, mayBeAbsent: true } as const;
  });
  return [...edges.values(), ...peerEdges];
}

function assertAllowedDependency(name: string, specifier: string): void {
  assertAllowedDependencyName(name);
  const alias = npmAliasTarget(specifier);
  if (alias !== undefined) assertAllowedDependencyName(alias);
}

function npmAliasTarget(specifier: string): string | undefined {
  if (!specifier.startsWith("npm:")) return undefined;
  const target = specifier.slice(4);
  if (target.startsWith("@")) {
    const slash = target.indexOf("/");
    const version = slash < 0 ? -1 : target.indexOf("@", slash);
    return version < 0 ? target : target.slice(0, version);
  }
  const version = target.indexOf("@");
  return version < 0 ? target : target.slice(0, version);
}

function assertAllowedDependencyName(name: string): void {
  const normalized = name.toLowerCase();
  if (LOCAL_MODEL_SURFACE.test(normalized) || normalized === "openai" || normalized.startsWith("@openai/")) {
    throw auditFailed();
  }
}

async function productionSourcePaths(rootPath: string): Promise<readonly string[]> {
  const paths: string[] = [];
  await collectRuntimeSources(join(rootPath, "src"), paths);
  for (const relativePath of ["next.config.ts"] as const) {
    const path = join(rootPath, relativePath);
    try {
      await readFile(path, "utf8");
      paths.push(path);
    } catch {
      // Optional production config files need no placeholder in focused fixtures.
    }
  }
  let rootEntries;
  try {
    rootEntries = await readdir(rootPath, { withFileTypes: true });
  } catch {
    throw auditFailed();
  }
  for (const entry of rootEntries) {
    if (entry.isFile() && ENVIRONMENT_TEMPLATE_NAME.test(entry.name)) {
      paths.push(join(rootPath, entry.name));
    }
  }
  if (paths.length === 0) throw auditFailed();
  return [...new Set(paths)].sort();
}

async function codexRuntimeSourcePaths(rootPath: string): Promise<readonly string[]> {
  const paths: string[] = [];
  for (const relativePath of ROOT_RUNTIME_FILES) {
    const path = join(rootPath, relativePath);
    try {
      await readFile(path, "utf8");
      paths.push(path);
    } catch {
      // Some focused fixtures contain only the Codex runtime directory.
    }
  }
  await collectRuntimeSources(join(rootPath, "src", "infrastructure", "codex-cli"), paths);
  if (paths.length === 0) throw auditFailed();
  return paths.sort();
}

async function collectRuntimeSources(directoryPath: string, paths: string[]): Promise<void> {
  let entries;
  try {
    entries = await readdir(directoryPath, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const path = join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      await collectRuntimeSources(path, paths);
    } else if (entry.isFile() && RUNTIME_SOURCE_EXTENSIONS.has(extname(entry.name))) {
      paths.push(path);
    }
  }
}

function auditBroadProductionSource(source: string): void {
  if (LOCAL_MODEL_SURFACE.test(source) || OPENAI_SDK_IMPORT.test(source)) throw auditFailed();
  if (API_KEY_HANDLING.test(source)) throw auditFailed();
  if (MODEL_DOWNLOAD_SURFACE.test(source)) throw auditFailed();
}

function auditForbiddenRuntimeMethods(filePath: string, rootPath: string, source: string): void {
  const auditedSource = filePath === join(rootPath, FIXED_MODEL_POLICY_PATH)
    ? source.replace(FIXED_TERRA_MODEL_ARGV, "").replace(FIXED_TERRA_MODEL_GRAMMAR, "")
    : source;
  if (FORBIDDEN_RUNTIME_METHOD.test(auditedSource)) throw auditFailed();
}

async function readPackageManifest(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch {
    throw auditFailed();
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function auditFailed(): Error {
  return new Error("codex_runtime_audit_failed");
}

async function main(): Promise<void> {
  const result = await auditCodexRuntime({ rootPath: process.cwd() });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().catch(() => {
    process.stderr.write("codex_runtime_audit_failed\n");
    process.exitCode = 1;
  });
}
