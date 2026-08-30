import { createHash, randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, open, readFile, rename, rm, unlink } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { types } from "node:util";

import {
  canonicalHttpsUrl,
  reconstructOfficialSourceDiscoveryRequest,
  type OfficialSourceDiscoveryPort,
} from "../src/application/official-source-discovery";
import { CODEX_DISCOVERY_MODEL } from "../src/infrastructure/codex-cli/contracts";
import { createCodexOfficialSourceDiscovery } from "../src/infrastructure/codex-cli/official-source-discovery";
import { parseSupportedCodexCliVersion } from "../src/infrastructure/codex-cli/policy";
import { verifyReviewedLocalCodexInstallation } from "../src/infrastructure/codex-cli/reviewed-installation";
import { getCodexCliModelAdapter } from "../src/infrastructure/codex-cli/runtime";
import {
  SLOVENIA_OFFICIAL_DIRECTORY_BOOTSTRAP,
  sloveniaBootstrapUrlSha256,
} from "../src/infrastructure/sources/slovenia-official-directory-bootstrap";
import { registerNodeCodexRuntime } from "../src/instrumentation-node";

const DISCOVERY_INPUT_PATH = "data/evals/prepare-slovenia-demo-package/result.json";
const FAILURE_INPUT_PATH = "data/evals/capture-slovenia-demo-sources/failure.json";
const OUTPUT_PATH = "data/evals/discover-slovenia-safety-authority/result.json";
const OUTPUT_SCHEMA = "si-demo-safety-authority-discovery-staging@1" as const;
const FAILURE_SCHEMA = "si-demo-package-capture-failure@1" as const;
const FAILURE_ROUTE_ID = "police-pu-ljubljana-stats" as const;
const POLICE_URL = "https://www.policija.si/o-slovenski-policiji/organiziranost/policijske-uprave/pu-ljubljana/statistika-pu-lj";
const GOV_HOST = "www.gov.si";
const OPT_IN_ERROR = "local_codex_live_opt_in_required\n";
const FAILED = "discover_slovenia_safety_authority_failed\n";

type RuntimeMetadata = Readonly<{
  invocationVersion: "codex-cli-invocation@2";
  protocolVersion: "codex-cli-protocol@2";
  compatibilityPolicy: "codex-cli-0.149.0-alpha.4-plus@2";
  cliVersion: string;
  model: typeof CODEX_DISCOVERY_MODEL;
  reasoningEffort: "medium";
  toolPolicy: "codex-tools-web-search@2";
  templateVersion: "official-source-discover@4";
  schemaVersion: "official-source-candidates@1";
}>;

export type SloveniaSafetyAuthorityDiscoveryStaging = Readonly<{
  schemaVersion: typeof OUTPUT_SCHEMA;
  stagingOnly: true;
  policyLockWritten: false;
  prerequisites: Readonly<{
    discoverySnapshotSha256: string;
    failureSnapshotSha256: string;
  }>;
  failedSource: Readonly<{
    routeId: typeof FAILURE_ROUTE_ID;
    urlSha256: string;
    kind: "transport_unavailable";
  }>;
  discovery: RuntimeMetadata & Readonly<{ output: "untrusted_hints_only" }>;
  candidates: readonly Readonly<{
    url: string;
    urlSha256: string;
    host: typeof GOV_HOST;
    hostSha256: string;
  }>[];
}>;

export type SloveniaSafetyAuthorityPrerequisiteSnapshots = Readonly<{
  discoverySnapshotSha256: string;
  failureSnapshotSha256: string;
}>;

type Discovery = Readonly<{
  discover(input: Parameters<OfficialSourceDiscoveryPort["discover"]>[0]): Promise<unknown>;
}>;

type Dependencies = Readonly<{
  readDiscoveryInput: () => Promise<unknown>;
  readFailureInput: () => Promise<unknown>;
  verifyInstallation: () => Promise<void>;
  registerRuntime: () => Promise<void>;
  discovery: Discovery;
  createDiscovery: () => Discovery;
  store: DiscoverSloveniaSafetyAuthorityStore;
}>;

export type DiscoverSloveniaSafetyAuthorityArguments = Readonly<{ live: true }>;
export type DiscoverSloveniaSafetyAuthorityResult = Readonly<{
  exitCode: 0 | 1;
  stderr: string;
}>;

export type DiscoverSloveniaSafetyAuthorityStore = Readonly<{
  prepare(): Promise<void>;
  cleanup(): Promise<void>;
  write(record: unknown): Promise<void>;
}>;

export function parseDiscoverSloveniaSafetyAuthorityArgs(
  argv: readonly string[],
): DiscoverSloveniaSafetyAuthorityArguments {
  const values = denseDataArray(argv);
  const normalized = values[0] === "--" ? values.slice(1) : values;
  if (normalized.length !== 1 || normalized[0] !== "--live-local-subscription") invalid();
  return Object.freeze({ live: true });
}

export async function runDiscoverSloveniaSafetyAuthority(
  args: DiscoverSloveniaSafetyAuthorityArguments,
  supplied: Partial<Dependencies> = {},
): Promise<void> {
  const inputArgs = exactDataObject(args, ["live"]);
  if (inputArgs.live !== true) invalid();

  const readDiscoveryInput = supplied.readDiscoveryInput ??
    (async () => JSON.parse(await readFile(DISCOVERY_INPUT_PATH, "utf8")) as unknown);
  const readFailureInput = supplied.readFailureInput ??
    (async () => JSON.parse(await readFile(FAILURE_INPUT_PATH, "utf8")) as unknown);
  const verifyInstallation = supplied.verifyInstallation ?? verifyReviewedLocalCodexInstallation;
  const registerRuntime = supplied.registerRuntime ?? registerNodeCodexRuntime;
  const createDiscovery = supplied.createDiscovery ??
    (() => createCodexOfficialSourceDiscovery(getCodexCliModelAdapter()));
  const store = supplied.store ?? createDiscoverSloveniaSafetyAuthorityStore({
    workspaceRoot: process.cwd(),
  });
  if (typeof readDiscoveryInput !== "function" || typeof readFailureInput !== "function" ||
    typeof verifyInstallation !== "function" || typeof registerRuntime !== "function" ||
    typeof createDiscovery !== "function" || !validStore(store)) invalid();

  try {
    const prerequisites = snapshotSloveniaSafetyAuthorityPrerequisites(
      await readDiscoveryInput(),
      await readFailureInput(),
    );

    await store.prepare();
    await verifyInstallation();
    await registerRuntime();

    const discovery = supplied.discovery ?? createDiscovery();
    const discover = discoveryMethod(discovery);
    const result = await Reflect.apply(discover, discovery, [fixedDiscoveryRequest()]) as unknown;
    await store.write(stagingRecord(result, prerequisites));
  } catch (error) {
    await store.cleanup();
    throw error;
  }
}

export async function runDiscoverSloveniaSafetyAuthorityEntrypoint(
  argv: readonly string[],
  supplied: Partial<Dependencies> = {},
): Promise<DiscoverSloveniaSafetyAuthorityResult> {
  try {
    await runDiscoverSloveniaSafetyAuthority(
      parseDiscoverSloveniaSafetyAuthorityArgs(argv),
      supplied,
    );
    return Object.freeze({ exitCode: 0, stderr: "" });
  } catch {
    return Object.freeze({
      exitCode: 1,
      stderr: noOption(argv) ? OPT_IN_ERROR : FAILED,
    });
  }
}

function fixedDiscoveryRequest(): Parameters<OfficialSourceDiscoveryPort["discover"]>[0] {
  return reconstructOfficialSourceDiscoveryRequest({
    schemaVersion: "official-source-discovery-request@1",
    entity: {
      entityId: "ljubljana",
      kind: "city",
      countryCode: "SI",
      displayName: "Ljubljana",
    },
    fact: {
      factKey: "ljubljana-official-municipality-site-link",
      definitionId: "si-demo-municipality-authority-link@1",
      description: "A first-party GOV.SI page that identifies Mestna občina Ljubljana and links to the official Municipality of Ljubljana website; return the GOV.SI page only",
    },
    failedSource: { url: POLICE_URL, reason: "unavailable" },
    authorityRoots: [{ publisherName: "GOV.SI", url: "https://www.gov.si/" }],
    localeHints: ["sl", "en"],
    round: 2,
    signal: new AbortController().signal,
  });
}

export function snapshotSloveniaSafetyAuthorityPrerequisites(
  discoveryInput: unknown,
  failureInput: unknown,
): SloveniaSafetyAuthorityPrerequisiteSnapshots {
  return Object.freeze({
    discoverySnapshotSha256: validateCurrentDiscoveryInput(discoveryInput),
    failureSnapshotSha256: validateTransportFailure(failureInput),
  });
}

function validateCurrentDiscoveryInput(value: unknown): string {
  const root = exactDataObject(value, [
    "schemaVersion", "mode", "stagingOnly", "policyLockWritten", "discovery", "jobs",
  ]);
  if (root.schemaVersion !== "si-demo-package-acquisition-staging@1" ||
    root.mode !== "native_discovery_hints" || root.stagingOnly !== true ||
    root.policyLockWritten !== false) invalid();
  const metadata = exactDataObject(root.discovery, [
    "invocationVersion", "protocolVersion", "compatibilityPolicy", "cliVersion", "model",
    "reasoningEffort", "toolPolicy", "templateVersion", "schemaVersion", "output",
  ]);
  validateRuntimeMetadata(metadata);
  if (metadata.output !== "untrusted_hints_only") invalid();

  const jobs = denseDataArray(root.jobs, 3);
  if (jobs.length !== 3) invalid();
  const expectedJobIds = [
    "ljubljana_safety", "ljubljana_population", "ljubljana_identity_geometry",
  ] as const;
  const parsed = jobs.map((job, index) => {
    const fields = exactDataObject(job, ["jobId", "candidates"]);
    if (fields.jobId !== expectedJobIds[index]) invalid();
    const candidates = denseDataArray(fields.candidates, 5).map(validateStagedCandidate);
    if (new Set(candidates.map(({ url }) => url)).size !== candidates.length) invalid();
    return Object.freeze({ jobId: fields.jobId, candidates: Object.freeze(candidates) });
  });
  for (const policy of SLOVENIA_OFFICIAL_DIRECTORY_BOOTSTRAP.routes) {
    const job = parsed.find(({ jobId }) => jobId === policy.jobId);
    if (job === undefined || !job.candidates.some((candidate) =>
      candidate.url === policy.url &&
      candidate.urlSha256 === sloveniaBootstrapUrlSha256(policy) &&
      candidate.host === new URL(policy.url).hostname &&
      candidate.hostSha256 === sha256(candidate.host))) invalid();
  }
  const snapshot = Object.freeze({
    schemaVersion: "si-demo-package-acquisition-staging@1",
    mode: "native_discovery_hints",
    stagingOnly: true,
    policyLockWritten: false,
    discovery: Object.freeze({ ...validateRuntimeMetadata(metadata), output: "untrusted_hints_only" }),
    jobs: Object.freeze(parsed),
  });
  return sha256(JSON.stringify(snapshot));
}

function validateTransportFailure(value: unknown): string {
  const failure = exactDataObject(value, [
    "schemaVersion", "stagingOnly", "phase", "routeId", "kind", "retryable",
  ]);
  if (failure.schemaVersion !== FAILURE_SCHEMA || failure.stagingOnly !== true ||
    failure.phase !== "capture" || failure.routeId !== FAILURE_ROUTE_ID ||
    !((failure.kind === "http_error" && failure.retryable === false) ||
      (failure.kind === "timeout" && failure.retryable === true))) invalid();
  return sha256(JSON.stringify(Object.freeze({
    schemaVersion: FAILURE_SCHEMA,
    stagingOnly: true,
    phase: "capture",
    routeId: FAILURE_ROUTE_ID,
    kind: failure.kind,
    retryable: failure.retryable,
  })));
}

function stagingRecord(
  value: unknown,
  prerequisites: Readonly<{
    discoverySnapshotSha256: string;
    failureSnapshotSha256: string;
  }>,
): SloveniaSafetyAuthorityDiscoveryStaging {
  const result = exactDataObject(value, ["candidates", "metadata"]);
  const metadata = validateRuntimeMetadata(exactDataObject(result.metadata, [
    "invocationVersion", "protocolVersion", "compatibilityPolicy", "cliVersion", "model",
    "reasoningEffort", "toolPolicy", "templateVersion", "schemaVersion",
  ]));
  const seen = new Set<string>();
  const candidates = denseDataArray(result.candidates, 5).flatMap((candidate) => {
    const fields = exactDataObject(candidate, [
      "url", "claimedPublisher", "expectedCoverage", "rationale",
    ]);
    if (typeof fields.claimedPublisher !== "string" ||
      typeof fields.expectedCoverage !== "string" || typeof fields.rationale !== "string") invalid();
    const url = canonicalHttpsUrl(fields.url);
    if (seen.has(url)) invalid();
    seen.add(url);
    const parsed = new URL(url);
    const host = parsed.hostname;
    return host === GOV_HOST && parsed.port === ""
      ? [Object.freeze({
          url,
          urlSha256: sha256(url),
          host: GOV_HOST,
          hostSha256: sha256(GOV_HOST),
        })]
      : [];
  });
  return Object.freeze({
    schemaVersion: OUTPUT_SCHEMA,
    stagingOnly: true,
    policyLockWritten: false,
    prerequisites: Object.freeze({ ...prerequisites }),
    failedSource: Object.freeze({
      routeId: FAILURE_ROUTE_ID,
      urlSha256: sha256(POLICE_URL),
      kind: "transport_unavailable",
    }),
    discovery: Object.freeze({ ...metadata, output: "untrusted_hints_only" }),
    candidates: Object.freeze(candidates),
  });
}

function validateRuntimeMetadata(value: Record<string, unknown>): RuntimeMetadata {
  if (value.invocationVersion !== "codex-cli-invocation@2" ||
    value.protocolVersion !== "codex-cli-protocol@2" ||
    value.compatibilityPolicy !== "codex-cli-0.149.0-alpha.4-plus@2" ||
    typeof value.cliVersion !== "string" || value.model !== CODEX_DISCOVERY_MODEL ||
    value.reasoningEffort !== "medium" || value.toolPolicy !== "codex-tools-web-search@2" ||
    value.templateVersion !== "official-source-discover@4" ||
    value.schemaVersion !== "official-source-candidates@1") invalid();
  try {
    parseSupportedCodexCliVersion(`${value.cliVersion}\n`);
  } catch {
    invalid();
  }
  return Object.freeze({
    invocationVersion: "codex-cli-invocation@2",
    protocolVersion: "codex-cli-protocol@2",
    compatibilityPolicy: "codex-cli-0.149.0-alpha.4-plus@2",
    cliVersion: value.cliVersion,
    model: CODEX_DISCOVERY_MODEL,
    reasoningEffort: "medium",
    toolPolicy: "codex-tools-web-search@2",
    templateVersion: "official-source-discover@4",
    schemaVersion: "official-source-candidates@1",
  });
}

function validateStagedCandidate(value: unknown): Readonly<{
  url: string;
  urlSha256: string;
  host: string;
  hostSha256: string;
}> {
  const candidate = exactDataObject(value, ["url", "urlSha256", "host", "hostSha256"]);
  if (typeof candidate.url !== "string" || typeof candidate.urlSha256 !== "string" ||
    typeof candidate.host !== "string" || typeof candidate.hostSha256 !== "string") invalid();
  const url = canonicalHttpsUrl(candidate.url);
  const host = new URL(url).hostname;
  if (url !== candidate.url || host !== candidate.host || sha256(url) !== candidate.urlSha256 ||
    sha256(host) !== candidate.hostSha256) invalid();
  return Object.freeze({
    url,
    urlSha256: candidate.urlSha256,
    host,
    hostSha256: candidate.hostSha256,
  });
}

export function snapshotSloveniaSafetyAuthorityDiscoveryStaging(
  value: unknown,
): SloveniaSafetyAuthorityDiscoveryStaging {
  const root = exactDataObject(value, [
    "schemaVersion", "stagingOnly", "policyLockWritten", "prerequisites", "failedSource",
    "discovery", "candidates",
  ]);
  if (root.schemaVersion !== OUTPUT_SCHEMA || root.stagingOnly !== true ||
    root.policyLockWritten !== false) invalid();
  const prerequisites = exactDataObject(root.prerequisites, [
    "discoverySnapshotSha256", "failureSnapshotSha256",
  ]);
  if (!isSha256(prerequisites.discoverySnapshotSha256) ||
    !isSha256(prerequisites.failureSnapshotSha256)) invalid();
  const failedSource = exactDataObject(root.failedSource, ["routeId", "urlSha256", "kind"]);
  if (failedSource.routeId !== FAILURE_ROUTE_ID || failedSource.urlSha256 !== sha256(POLICE_URL) ||
    failedSource.kind !== "transport_unavailable") invalid();
  const discovery = exactDataObject(root.discovery, [
    "invocationVersion", "protocolVersion", "compatibilityPolicy", "cliVersion", "model",
    "reasoningEffort", "toolPolicy", "templateVersion", "schemaVersion", "output",
  ]);
  const metadata = validateRuntimeMetadata(discovery);
  if (discovery.output !== "untrusted_hints_only") invalid();
  const seen = new Set<string>();
  const candidates = denseDataArray(root.candidates, 5).map((value) => {
    const candidate = validateStagedCandidate(value);
    if (candidate.host !== GOV_HOST || seen.has(candidate.url)) invalid();
    seen.add(candidate.url);
    return Object.freeze({
      url: candidate.url,
      urlSha256: candidate.urlSha256,
      host: GOV_HOST,
      hostSha256: candidate.hostSha256,
    });
  });
  return Object.freeze({
    schemaVersion: OUTPUT_SCHEMA,
    stagingOnly: true,
    policyLockWritten: false,
    prerequisites: Object.freeze({
      discoverySnapshotSha256: prerequisites.discoverySnapshotSha256,
      failureSnapshotSha256: prerequisites.failureSnapshotSha256,
    }),
    failedSource: Object.freeze({
      routeId: FAILURE_ROUTE_ID,
      urlSha256: sha256(POLICE_URL),
      kind: "transport_unavailable",
    }),
    discovery: Object.freeze({ ...metadata, output: "untrusted_hints_only" }),
    candidates: Object.freeze(candidates),
  });
}

export function createDiscoverSloveniaSafetyAuthorityStore(options: Readonly<{
  workspaceRoot: string;
  randomId?: () => string;
}>): DiscoverSloveniaSafetyAuthorityStore {
  const root = resolve(options.workspaceRoot);
  const randomId = options.randomId ?? randomUUID;
  const target = resolve(root, OUTPUT_PATH);
  if (relative(root, target) !== OUTPUT_PATH) invalid();

  const remove = async (): Promise<void> => {
    await assertSafeArtifactIdentity(root, target, false);
    await unlink(target).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    });
  };
  return Object.freeze({
    prepare: remove,
    cleanup: remove,
    async write(value) {
      const record = snapshotSloveniaSafetyAuthorityDiscoveryStaging(value);
      const directory = dirname(target);
      await assertSafeArtifactIdentity(root, target, false);
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await assertSafeArtifactIdentity(root, target, true);
      await unlink(target).catch((error: unknown) => {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      });
      const temporary = resolve(directory, `.discover-si-safety-authority-${randomId()}.tmp`);
      if (dirname(temporary) !== directory || temporary === target) invalid();
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
        temporaryOwned = false;
        await chmod(target, 0o600);
      } finally {
        await handle?.close().catch(() => undefined);
        if (temporaryOwned) await rm(temporary, { force: true });
      }
    },
  });
}

function validStore(value: unknown): value is DiscoverSloveniaSafetyAuthorityStore {
  if (!isPlainDataObject(value)) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  return ["prepare", "cleanup", "write"].every((key) => {
    const descriptor = descriptors[key];
    return descriptor?.enumerable === true && "value" in descriptor &&
      typeof descriptor.value === "function";
  });
}

function discoveryMethod(value: unknown): Discovery["discover"] {
  if (!isPlainDataObject(value)) invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.keys(descriptors).length !== 1 || Object.getOwnPropertySymbols(value).length !== 0) invalid();
  const descriptor = descriptors.discover;
  if (descriptor?.enumerable !== true || !("value" in descriptor) ||
    typeof descriptor.value !== "function") invalid();
  return descriptor.value as Discovery["discover"];
}

function denseDataArray(value: unknown, maximum = Number.MAX_SAFE_INTEGER): readonly unknown[] {
  if (!Array.isArray(value) || types.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype ||
    value.length > maximum || Object.getOwnPropertySymbols(value).length !== 0) invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.keys(descriptors).length !== value.length + 1) invalid();
  const copy: unknown[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (descriptor?.enumerable !== true || !("value" in descriptor)) invalid();
    copy.push(descriptor.value);
  }
  return Object.freeze(copy);
}

function isPlainDataObject(value: unknown): value is object {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    !types.isProxy(value) && (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null) && Object.getOwnPropertySymbols(value).length === 0;
}

function exactDataObject(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!isPlainDataObject(value)) invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.keys(descriptors).length !== keys.length ||
    !keys.every((key) => Object.hasOwn(descriptors, key))) invalid();
  const copy = Object.create(null) as Record<string, unknown>;
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (descriptor?.enumerable !== true || !("value" in descriptor)) invalid();
    copy[key] = descriptor.value;
  }
  return copy;
}

async function assertSafeArtifactIdentity(
  root: string,
  target: string,
  requireParent: boolean,
): Promise<void> {
  const pieces = relative(root, target).split("/");
  let cursor = root;
  for (let index = 0; index < pieces.length; index += 1) {
    cursor = resolve(cursor, pieces[index]!);
    try {
      const details = await lstat(cursor);
      if (details.isSymbolicLink() || (index === pieces.length - 1 && details.nlink > 1)) invalid();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      if (requireParent && index < pieces.length - 1) invalid();
      return;
    }
  }
}

function noOption(argv: readonly string[]): boolean {
  try {
    const values = denseDataArray(argv);
    return values.length === 0 || (values.length === 1 && values[0] === "--");
  } catch {
    return false;
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

function invalid(): never {
  throw new Error("discover_slovenia_safety_authority_invalid");
}

if (import.meta.main) {
  void runDiscoverSloveniaSafetyAuthorityEntrypoint(process.argv.slice(2)).then((result) => {
    if (result.stderr !== "") process.stderr.write(result.stderr);
    process.exitCode = result.exitCode;
  });
}
