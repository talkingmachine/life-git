import { chmod, lstat, mkdir, open, rename, rm, unlink } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { dirname, relative, resolve } from "node:path";
import { types } from "node:util";

import { CODEX_DISCOVERY_MODEL } from "../src/infrastructure/codex-cli/contracts";
import { getCodexCliModelAdapter } from "../src/infrastructure/codex-cli/runtime";
import { verifyReviewedLocalCodexInstallation } from "../src/infrastructure/codex-cli/reviewed-installation";
import { createCodexOfficialSourceDiscovery } from "../src/infrastructure/codex-cli/official-source-discovery";
import { parseSupportedCodexCliVersion } from "../src/infrastructure/codex-cli/policy";
import { registerNodeCodexRuntime } from "../src/instrumentation-node";
import { canonicalHttpsUrl, reconstructOfficialSourceDiscoveryRequest, type OfficialSourceDiscoveryPort, type OfficialSourceDiscoveryResult } from "../src/application/official-source-discovery";

const STAGING_PATH = "data/evals/prepare-slovenia-demo-package/result.json";
const STAGING_SCHEMA = "si-demo-package-acquisition-staging@1" as const;
const OPT_IN_ERROR = "local_codex_live_opt_in_required\n";

export type PrepareSloveniaDemoPackageArguments = Readonly<{ live: true }>;
export type PrepareSloveniaDemoPackageResult = Readonly<{ exitCode: 0 | 1; stderr: string }>;

type StagingRecord = Readonly<{
  schemaVersion: typeof STAGING_SCHEMA;
  mode: "native_discovery_hints";
  stagingOnly: true;
  policyLockWritten: false;
  discovery: Readonly<{
    invocationVersion: "codex-cli-invocation@2";
    protocolVersion: "codex-cli-protocol@2";
    compatibilityPolicy: "codex-cli-0.149.0-alpha.4-plus@2";
    cliVersion: string;
    model: typeof CODEX_DISCOVERY_MODEL;
    reasoningEffort: "medium";
    toolPolicy: "codex-tools-web-search@2";
    templateVersion: "official-source-discover@4";
    schemaVersion: "official-source-candidates@1";
    output: "untrusted_hints_only";
  }>;
  jobs: readonly Readonly<{
    jobId: "ljubljana_safety" | "ljubljana_population" | "ljubljana_identity_geometry";
    candidates: readonly Readonly<{ url: string; urlSha256: string; host: string; hostSha256: string }>[];
  }>[];
}>;

type Dependencies = Readonly<{
  verifyInstallation: () => Promise<void>;
  registerRuntime: () => Promise<void>;
  discovery: OfficialSourceDiscoveryPort;
  createDiscovery: () => OfficialSourceDiscoveryPort;
  store: StagingStore;
}>;

/**
 * This intentionally accepts no model, artifact, URL, publisher, or environment
 * override. Actual official-material acquisition is a later reviewed operation.
 */
export function parsePrepareSloveniaDemoPackageArgs(argv: readonly string[]): PrepareSloveniaDemoPackageArguments {
  if (!Array.isArray(argv) || types.isProxy(argv)) invalidArguments();
  let index = 0;
  const first = Object.getOwnPropertyDescriptor(argv, "0");
  if (first?.enumerable === true && "value" in first && first.value === "--") index = 1;
  const values = argv.slice(index);
  if (values.length !== 1 || values[0] !== "--live-local-subscription") invalidArguments();
  return Object.freeze({ live: true });
}

export async function runPrepareSloveniaDemoPackage(
  args: PrepareSloveniaDemoPackageArguments,
  supplied: Partial<Dependencies> = {},
): Promise<PrepareSloveniaDemoPackageResult> {
  if (args === null || typeof args !== "object" || types.isProxy(args) || args.live !== true || Object.keys(args).length !== 1) {
    invalidArguments();
  }
  const verifyInstallation = supplied.verifyInstallation ?? verifyReviewedLocalCodexInstallation;
  const registerRuntime = supplied.registerRuntime ?? registerNodeCodexRuntime;
  const createDiscovery = supplied.createDiscovery ?? (() => createCodexOfficialSourceDiscovery(getCodexCliModelAdapter()));
  const store = supplied.store ?? createStagingStore({ workspaceRoot: process.cwd() });
  if (typeof verifyInstallation !== "function" || typeof registerRuntime !== "function" || typeof createDiscovery !== "function" || store === null || typeof store !== "object" ||
    typeof store.prepare !== "function" || typeof store.cleanup !== "function" || typeof store.write !== "function") {
    invalidArguments();
  }
  let prepared = false;
  try {
    await store.prepare(STAGING_PATH);
    prepared = true;
    await verifyInstallation();
    await registerRuntime();
    const discovery = supplied.discovery ?? createDiscovery();
    if (discovery === null || typeof discovery !== "object" || types.isProxy(discovery) || typeof discovery.discover !== "function") invalidArguments();
    const results: OfficialSourceDiscoveryResult[] = [];
    for (const job of fixedDiscoveryJobs()) results.push(await discovery.discover(job));
    await store.write(STAGING_PATH, stagingRecord(results));
    return Object.freeze({ exitCode: 0, stderr: "" });
  } catch (error) {
    if (prepared) await store.cleanup(STAGING_PATH);
    throw error;
  }
}

export async function runPrepareSloveniaDemoPackageEntrypoint(
  argv: readonly string[],
  supplied: Partial<Dependencies> = {},
): Promise<PrepareSloveniaDemoPackageResult> {
  try {
    return await runPrepareSloveniaDemoPackage(parsePrepareSloveniaDemoPackageArgs(argv), supplied);
  } catch (error) {
    if (error instanceof PrepareSloveniaDemoPackageArgumentError && hasNoOption(argv)) {
      return Object.freeze({ exitCode: 1, stderr: OPT_IN_ERROR });
    }
    return Object.freeze({ exitCode: 1, stderr: "prepare_slovenia_demo_package_failed\n" });
  }
}

function stagingRecord(results: readonly OfficialSourceDiscoveryResult[]): StagingRecord {
  if (results.length !== 3) invalidArguments();
  const metadata = results.map(readDiscoveryMetadata);
  if (metadata.some((entry) => !sameMetadata(entry, metadata[0]!))) invalidArguments();
  return Object.freeze({
    schemaVersion: STAGING_SCHEMA,
    mode: "native_discovery_hints",
    stagingOnly: true,
    policyLockWritten: false,
    discovery: Object.freeze({ ...metadata[0]!, output: "untrusted_hints_only" }),
    jobs: Object.freeze(results.map((result, index) => Object.freeze({
      jobId: ["ljubljana_safety", "ljubljana_population", "ljubljana_identity_geometry"][index]! as StagingRecord["jobs"][number]["jobId"],
      candidates: Object.freeze(sanitizeCandidates(result.candidates)),
    }))),
  });
}

function fixedDiscoveryJobs(): readonly Parameters<OfficialSourceDiscoveryPort["discover"]>[0][] {
  const signal = new AbortController().signal;
  const base = { schemaVersion: "official-source-discovery-request@1" as const, entity: { entityId: "ljubljana", kind: "city" as const, countryCode: "SI", displayName: "Ljubljana" }, localeHints: ["sl", "en"], round: 1 as const, signal };
  // A non-authority reserved URL satisfies the existing replacement-oriented port shape and is never persisted.
  const failedSource = { url: "https://invalid.example/", reason: "unavailable" as const };
  return Object.freeze([
    { ...base, fact: { factKey: "ljubljana-public-safety-annual-aggregate", definitionId: "si-demo-public-safety@1", description: "Ljubljana public-safety annual aggregate" }, failedSource, authorityRoots: [{ publisherName: "Police", url: "https://www.policija.si/" }, { publisherName: "GOV.SI", url: "https://www.gov.si/" }] },
    { ...base, fact: { factKey: "ljubljana-population-denominator", definitionId: "si-demo-population@1", description: "Ljubljana official population denominator" }, failedSource, authorityRoots: [{ publisherName: "SURS", url: "https://www.stat.si/StatWeb/" }, { publisherName: "GOV.SI", url: "https://www.gov.si/" }] },
    { ...base, fact: { factKey: "ljubljana-identity-geometry-route", definitionId: "si-demo-identity-geometry@1", description: "Ljubljana official municipality and settlement identity with coordinate or geometry route" }, failedSource, authorityRoots: [{ publisherName: "e-Prostor", url: "https://www.e-prostor.gov.si/" }, { publisherName: "SURS", url: "https://www.stat.si/StatWeb/" }, { publisherName: "GOV.SI", url: "https://www.gov.si/" }] },
  ].map((job) => reconstructOfficialSourceDiscoveryRequest(job)));
}

function readDiscoveryMetadata(value: OfficialSourceDiscoveryResult): Omit<StagingRecord["discovery"], "output"> {
  if (value === null || typeof value !== "object" || types.isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype) invalidArguments();
  const result = exactDataObject(value, ["candidates", "metadata"]);
  const metadata = exactDataObject(result.metadata, ["invocationVersion", "protocolVersion", "compatibilityPolicy", "cliVersion", "model", "reasoningEffort", "toolPolicy", "templateVersion", "schemaVersion"]);
  if (metadata.invocationVersion !== "codex-cli-invocation@2" || metadata.protocolVersion !== "codex-cli-protocol@2" ||
    metadata.compatibilityPolicy !== "codex-cli-0.149.0-alpha.4-plus@2" || typeof metadata.cliVersion !== "string" ||
    metadata.model !== CODEX_DISCOVERY_MODEL || metadata.reasoningEffort !== "medium" || metadata.toolPolicy !== "codex-tools-web-search@2" ||
    metadata.templateVersion !== "official-source-discover@4" || metadata.schemaVersion !== "official-source-candidates@1") invalidArguments();
  try { parseSupportedCodexCliVersion(`${metadata.cliVersion}\n`); } catch { invalidArguments(); }
  return Object.freeze({
    invocationVersion: "codex-cli-invocation@2", protocolVersion: "codex-cli-protocol@2",
    compatibilityPolicy: "codex-cli-0.149.0-alpha.4-plus@2", cliVersion: metadata.cliVersion,
    model: CODEX_DISCOVERY_MODEL, reasoningEffort: "medium", toolPolicy: "codex-tools-web-search@2",
    templateVersion: "official-source-discover@4", schemaVersion: "official-source-candidates@1",
  });
}

function sameMetadata(left: Omit<StagingRecord["discovery"], "output">, right: Omit<StagingRecord["discovery"], "output">): boolean {
  return left.invocationVersion === right.invocationVersion && left.protocolVersion === right.protocolVersion &&
    left.compatibilityPolicy === right.compatibilityPolicy && left.cliVersion === right.cliVersion && left.model === right.model &&
    left.reasoningEffort === right.reasoningEffort && left.toolPolicy === right.toolPolicy && left.templateVersion === right.templateVersion &&
    left.schemaVersion === right.schemaVersion;
}

function sanitizeCandidates(candidates: OfficialSourceDiscoveryResult["candidates"]): readonly Readonly<{ url: string; urlSha256: string; host: string; hostSha256: string }>[] {
  if (!Array.isArray(candidates) || types.isProxy(candidates) || Object.getPrototypeOf(candidates) !== Array.prototype || candidates.length > 5) invalidArguments();
  const urls = new Set<string>();
  return candidates.map((candidate) => {
    if (candidate === null || typeof candidate !== "object" || types.isProxy(candidate) || Object.getPrototypeOf(candidate) !== Object.prototype) invalidArguments();
    const fields = exactDataObject(candidate, ["url", "claimedPublisher", "expectedCoverage", "rationale"]);
    const url = fields.url;
    if (typeof url !== "string") invalidArguments();
    let canonical: string;
    try { canonical = canonicalHttpsUrl(url); } catch { invalidArguments(); }
    if (urls.has(canonical)) invalidArguments();
    urls.add(canonical);
    const host = new URL(canonical).hostname;
    return Object.freeze({ url: canonical, urlSha256: sha256(canonical), host, hostSha256: sha256(host) });
  });
}

function exactDataObject(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== "object" || types.isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype || Object.getOwnPropertySymbols(value).length !== 0) invalidArguments();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.keys(descriptors).length !== keys.length || !keys.every((key) => descriptors[key]?.enumerable === true && "value" in descriptors[key]!)) invalidArguments();
  const copy = Object.create(null) as Record<string, unknown>;
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (descriptor === undefined || descriptor.enumerable !== true || !("value" in descriptor)) invalidArguments();
    copy[key] = descriptor.value;
  }
  return copy;
}

function sha256(value: string): string { return createHash("sha256").update(value, "utf8").digest("hex"); }

class PrepareSloveniaDemoPackageArgumentError extends Error {}

function invalidArguments(): never {
  throw new PrepareSloveniaDemoPackageArgumentError("prepare_slovenia_demo_package_invalid_arguments");
}

export type StagingStore = Readonly<{
  prepare(path: string): Promise<void>;
  cleanup(path: string): Promise<void>;
  write(path: string, record: StagingRecord): Promise<void>;
}>;

export function createStagingStore(options: Readonly<{ workspaceRoot: string; randomId?: () => string }>): StagingStore {
  const root = resolve(options.workspaceRoot);
  const randomId = options.randomId ?? randomUUID;
  const targetFor = (path: string): string => {
    if (path !== STAGING_PATH || path.includes("\0")) invalidArguments();
    const target = resolve(root, path);
    if (relative(root, target) !== STAGING_PATH) invalidArguments();
    return target;
  };
  const remove = async (path: string): Promise<void> => {
    const target = targetFor(path);
    await assertSafeArtifactIdentity(root, target, false);
    await unlink(target).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    });
  };
  return Object.freeze({
    prepare: remove,
    cleanup: remove,
    async write(path, record) {
      if (!isStagingRecord(record)) {
        // Callers cannot stage arbitrary facts, links, model output, or policy material.
        invalidArguments();
      }
      const target = targetFor(path);
      const directory = dirname(target);
      await assertSafeArtifactIdentity(root, target, false);
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await assertSafeArtifactIdentity(root, target, true);
      await unlink(target).catch((error: unknown) => {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      });
      const temporary = resolve(directory, `.prepare-si-demo-package-${randomId()}.tmp`);
      if (dirname(temporary) !== directory) invalidArguments();
      let handle: Awaited<ReturnType<typeof open>> | undefined;
      let temporaryOwned = false;
      try {
        handle = await open(temporary, "wx", 0o600);
        temporaryOwned = true;
        await handle.writeFile(`${JSON.stringify(record)}\n`, "utf8");
        await handle.sync();
        await handle.close();
        handle = undefined;
        await rename(temporary, target);
        await chmod(target, 0o600);
      } finally {
        await handle?.close().catch(() => undefined);
        if (temporaryOwned) await rm(temporary, { force: true });
      }
    },
  });
}

function isStagingRecord(value: unknown): value is StagingRecord {
  if (value === null || typeof value !== "object" || types.isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype) return false;
  const root = value as Record<string, unknown>;
  if (Object.keys(root).length !== 6 || root.schemaVersion !== STAGING_SCHEMA || root.mode !== "native_discovery_hints" ||
    root.stagingOnly !== true || root.policyLockWritten !== false || root.discovery === null || typeof root.discovery !== "object" ||
    types.isProxy(root.discovery) || Object.getPrototypeOf(root.discovery) !== Object.prototype) return false;
  const discovery = root.discovery as Record<string, unknown>;
  if (Object.keys(discovery).length !== 10 || discovery.invocationVersion !== "codex-cli-invocation@2" ||
    discovery.protocolVersion !== "codex-cli-protocol@2" || discovery.compatibilityPolicy !== "codex-cli-0.149.0-alpha.4-plus@2" ||
    typeof discovery.cliVersion !== "string" || discovery.model !== CODEX_DISCOVERY_MODEL || discovery.reasoningEffort !== "medium" ||
    discovery.toolPolicy !== "codex-tools-web-search@2" || discovery.templateVersion !== "official-source-discover@4" ||
    discovery.schemaVersion !== "official-source-candidates@1" || discovery.output !== "untrusted_hints_only" || !Array.isArray(root.jobs) || root.jobs.length !== 3) return false;
  const expectedIds = ["ljubljana_safety", "ljubljana_population", "ljubljana_identity_geometry"];
  return root.jobs.every((job, index) => {
    if (job === null || typeof job !== "object" || types.isProxy(job) || Object.getPrototypeOf(job) !== Object.prototype) return false;
    const fields = job as Record<string, unknown>;
    if (Object.keys(fields).length !== 2 || fields.jobId !== expectedIds[index] || !Array.isArray(fields.candidates) || fields.candidates.length > 5) return false;
    return fields.candidates.every((candidate) => {
      if (candidate === null || typeof candidate !== "object" || types.isProxy(candidate) || Object.getPrototypeOf(candidate) !== Object.prototype) return false;
      const item = candidate as Record<string, unknown>;
      if (Object.keys(item).length !== 4 || typeof item.url !== "string" || typeof item.host !== "string" ||
        item.urlSha256 !== sha256(item.url) || item.hostSha256 !== sha256(item.host)) return false;
      try { return canonicalHttpsUrl(item.url) === item.url && new URL(item.url).hostname === item.host; } catch { return false; }
    });
  });
}

function hasNoOption(argv: readonly string[]): boolean {
  if (!Array.isArray(argv) || types.isProxy(argv)) return false;
  return argv.length === 0 || (argv.length === 1 && argv[0] === "--");
}

async function assertSafeArtifactIdentity(root: string, target: string, requireParent: boolean): Promise<void> {
  if (!target.startsWith(`${root}/`)) invalidArguments();
  const pieces = relative(root, target).split("/");
  let cursor = root;
  for (let index = 0; index < pieces.length; index += 1) {
    cursor = resolve(cursor, pieces[index]!);
    try {
      const details = await lstat(cursor);
      if (details.isSymbolicLink() || (index === pieces.length - 1 && details.nlink > 1)) invalidArguments();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      if (requireParent && index < pieces.length - 1) invalidArguments();
      return;
    }
  }
}

if (import.meta.main) {
  void runPrepareSloveniaDemoPackageEntrypoint(process.argv.slice(2)).then((result) => {
    if (result.stderr !== "") process.stderr.write(result.stderr);
    process.exitCode = result.exitCode;
  });
}
