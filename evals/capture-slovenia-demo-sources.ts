import { chmod, lstat, mkdir, open, readFile, rename, rm, unlink } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { dirname, relative, resolve } from "node:path";
import { types } from "node:util";

import { canonicalHttpsUrl } from "../src/application/official-source-discovery";
import type { CaptureFailureKind, HttpStepRequest } from "../src/research/contracts";
import { captureHttpWithTrace, SourceCaptureError, type HttpCaptureLimits, type TracedLiveCapture } from "../src/infrastructure/sources/gateway";
import { SLOVENIA_OFFICIAL_DIRECTORY_BOOTSTRAP, sloveniaBootstrapUrlSha256, type SloveniaOfficialDirectoryBootstrapEntry } from "../src/infrastructure/sources/slovenia-official-directory-bootstrap";

const INPUT_PATH = "data/evals/prepare-slovenia-demo-package/result.json";
const OUTPUT_ROOT = "data/evals/capture-slovenia-demo-sources";
const MANIFEST_PATH = `${OUTPUT_ROOT}/manifest.json`;
const FAILURE_PATH = `${OUTPUT_ROOT}/failure.json`;
const OPT_IN_ERROR = "live_official_sources_opt_in_required\n";
const FAILED = "capture_slovenia_demo_sources_failed\n";
const SCHEMA = "si-demo-package-capture-staging@1" as const;

type Capture = TracedLiveCapture<string>;
type Manifest = Readonly<{ schemaVersion: typeof SCHEMA; runId: string; stagingOnly: true; policyLockWritten: false; captures: readonly Readonly<{ artifactId: string; routeId: string; sourceId: string; publisherId: string; inputCandidateSha256: string; method: "GET"; initialUrl: string; finalUrl: string; responseStatus: number; redirectChain: readonly string[]; mediaType: string; byteCount: number; sha256: string; capturedAt: string; rawPath: string }>[] }>;
export type CaptureSloveniaDemoSourcesArguments = Readonly<{ live: true }>;
type CaptureFn = (request: HttpStepRequest<string>, signal: AbortSignal, limits: HttpCaptureLimits) => Promise<Capture>;

type Dependencies = Readonly<{ readInput: () => Promise<unknown>; capture: CaptureFn; store: CaptureStore; createRunId: () => string; writeFailure: (value: FailureRecord) => Promise<void> }>;
export type CaptureStore = Readonly<{ prepare(): Promise<void>; cleanup(): Promise<void>; write(captures: readonly Readonly<{ policy: SloveniaOfficialDirectoryBootstrapEntry; capture: Capture }>[]): Promise<void> }>;

export function parseCaptureSloveniaDemoSourcesArgs(argv: readonly string[]): CaptureSloveniaDemoSourcesArguments {
  if (!Array.isArray(argv) || types.isProxy(argv)) invalid();
  const values = argv[0] === "--" ? argv.slice(1) : argv;
  if (values.length !== 1 || values[0] !== "--live-official-sources") invalid();
  return Object.freeze({ live: true });
}

export async function runCaptureSloveniaDemoSources(args: CaptureSloveniaDemoSourcesArguments, supplied: Partial<Dependencies> = {}): Promise<void> {
  if (args === null || typeof args !== "object" || types.isProxy(args) || args.live !== true || Object.keys(args).length !== 1) invalid();
  const readInput = supplied.readInput ?? (async () => JSON.parse(await readFile(INPUT_PATH, "utf8")) as unknown);
  const capture = supplied.capture ?? captureHttpWithTrace;
  const createRunId = supplied.createRunId ?? randomUUID;
  const writeFailure = supplied.writeFailure ?? createFailureStore({ workspaceRoot: process.cwd() });
  const store = supplied.store ?? createCaptureStore({ workspaceRoot: process.cwd() });
  if (typeof readInput !== "function" || typeof capture !== "function" || typeof createRunId !== "function" || typeof writeFailure !== "function" || store === null || typeof store !== "object" || typeof store.prepare !== "function" || typeof store.cleanup !== "function" || typeof store.write !== "function") invalid();
  let prepared = false;
  let routeId: string | undefined;
  try {
    await store.prepare(); prepared = true; // Remove stale plausible output before any gate.
    const input = await readInput();
    assertExpectedCandidates(input); // Integrity gate: no network before this returns.
    const runId = createRunId(); if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(runId)) invalid();
    const captures: { policy: SloveniaOfficialDirectoryBootstrapEntry; capture: Capture }[] = [];
    for (const policy of SLOVENIA_OFFICIAL_DIRECTORY_BOOTSTRAP.routes) {
      routeId = policy.routeId;
      const request: HttpStepRequest<string> = Object.freeze({ runId, sourceId: policy.sourceId, role: policy.role, method: "GET", url: policy.url, headers: Object.freeze({ accept: "text/html" }), allowedHosts: policy.allowedHosts, allowedMediaTypes: policy.allowedMediaTypes });
      const signal = AbortSignal.timeout(policy.timeoutMs);
      captures.push({ policy, capture: snapshotCapture(policy, await capture(request, signal, { maxBytes: policy.maxBytes, maxRedirects: policy.maxRedirects }), runId) }); routeId = undefined;
    }
    await store.write(captures);
  } catch (error) {
    if (prepared) await store.cleanup();
    if (routeId !== undefined) await writeFailure(failureRecord(routeId, error)).catch(() => undefined);
    throw error;
  }
}

type FailureKind = CaptureFailureKind | "unclassified";
type FailureRouteId = SloveniaOfficialDirectoryBootstrapEntry["routeId"];
type FailureRecord = Readonly<{ schemaVersion: "si-demo-package-capture-failure@1"; stagingOnly: true; phase: "capture"; routeId: FailureRouteId; kind: FailureKind; retryable: boolean; responseStatus?: number; mediaType?: string }>;
function failureRecord(routeId: string, error: unknown): FailureRecord {
  const fixedRouteId = SLOVENIA_OFFICIAL_DIRECTORY_BOOTSTRAP.routes.find((route) => route.routeId === routeId)?.routeId;
  if (fixedRouteId === undefined) invalid();
  const trusted = trustedCaptureError(error);
  return Object.freeze({ schemaVersion: "si-demo-package-capture-failure@1", stagingOnly: true, phase: "capture", routeId: fixedRouteId, kind: trusted?.kind ?? "unclassified", retryable: trusted?.retryable ?? false, ...(trusted?.responseStatus === undefined ? {} : { responseStatus: trusted.responseStatus }), ...(trusted?.mediaType === undefined ? {} : { mediaType: trusted.mediaType }) });
}

function trustedCaptureError(value: unknown): Readonly<{ kind: CaptureFailureKind; retryable: boolean; responseStatus?: number; mediaType?: string }> | undefined {
  if (value === null || typeof value !== "object" || types.isProxy(value) || !types.isNativeError(value) || Object.getPrototypeOf(value) !== SourceCaptureError.prototype) return undefined;
  const fields = Object.getOwnPropertyDescriptors(value); const kind = fields.kind; const retryable = fields.retryable; const trace = fields.trace;
  if (kind?.enumerable !== true || !("value" in kind) || !isCaptureFailureKind(kind.value) || retryable?.enumerable !== true || !("value" in retryable) || typeof retryable.value !== "boolean" || retryable.value !== isRetryableCaptureKind(kind.value)) return undefined;
  if (trace === undefined || trace.enumerable !== true || !("value" in trace)) return undefined;
  if (trace.value === undefined) return Object.freeze({ kind: kind.value, retryable: retryable.value });
  if (!isObject(trace.value) || types.isProxy(trace.value) || Object.getPrototypeOf(trace.value) !== Object.prototype || !Object.isFrozen(trace.value)) return undefined;
  const details = Object.getOwnPropertyDescriptors(trace.value); const status = details.responseStatus; const media = details.mediaType;
  const responseStatus = status?.enumerable === true && "value" in status && Number.isSafeInteger(status.value) && status.value >= 100 && status.value <= 599 ? status.value : undefined;
  const mediaType = media?.enumerable === true && "value" in media && typeof media.value === "string" ? media.value.split(";", 1)[0]?.trim().toLowerCase() : undefined;
  return Object.freeze({ kind: kind.value, retryable: retryable.value, ...(responseStatus === undefined ? {} : { responseStatus }), ...(mediaType !== undefined && /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(mediaType) ? { mediaType } : {}) });
}

function createFailureStore(options: Readonly<{ workspaceRoot: string }>): (value: FailureRecord) => Promise<void> {
  const root = resolve(options.workspaceRoot);
  return async (value) => { const record = snapshotFailureRecord(value); const target = resolve(root, FAILURE_PATH); if (relative(root, target) !== FAILURE_PATH) invalid(); await atomicWrite(target, new TextEncoder().encode(`${JSON.stringify(record)}\n`), root, randomUUID); };
}

function snapshotFailureRecord(value: unknown): FailureRecord {
  if (!isObject(value) || Object.getOwnPropertySymbols(value).length !== 0) invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const required = ["schemaVersion", "stagingOnly", "phase", "routeId", "kind", "retryable"];
  const optional = ["responseStatus", "mediaType"];
  const keys = Object.keys(descriptors);
  if (!required.every((key) => keys.includes(key)) || keys.some((key) => !required.includes(key) && !optional.includes(key)) ||
    keys.some((key) => descriptors[key]?.enumerable !== true || !("value" in descriptors[key]!))) invalid();
  const read = (key: string): unknown => (descriptors[key] as PropertyDescriptor & { value: unknown } | undefined)?.value;
  const routeId = read("routeId"); const kind = read("kind"); const retryable = read("retryable");
  if (read("schemaVersion") !== "si-demo-package-capture-failure@1" || read("stagingOnly") !== true || read("phase") !== "capture" ||
    !isFailureRouteId(routeId) || !isFailureKind(kind) || typeof retryable !== "boolean" ||
    retryable !== (kind === "unclassified" ? false : isRetryableCaptureKind(kind))) invalid();
  const responseStatus = read("responseStatus"); const mediaType = read("mediaType");
  if (responseStatus !== undefined && (!Number.isSafeInteger(responseStatus) || (responseStatus as number) < 100 || (responseStatus as number) > 599)) invalid();
  if (mediaType !== undefined && (typeof mediaType !== "string" || mediaType.length > 128 || !/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(mediaType))) invalid();
  return Object.freeze({ schemaVersion: "si-demo-package-capture-failure@1", stagingOnly: true, phase: "capture", routeId, kind, retryable, ...(responseStatus === undefined ? {} : { responseStatus: responseStatus as number }), ...(mediaType === undefined ? {} : { mediaType }) });
}

function isCaptureFailureKind(value: unknown): value is CaptureFailureKind { return value === "timeout" || value === "rate_limited" || value === "server_error" || value === "http_error" || value === "wrong_media_type" || value === "too_large" || value === "navigation_mismatch"; }
function isRetryableCaptureKind(value: CaptureFailureKind): boolean { return value === "timeout" || value === "rate_limited" || value === "server_error"; }
function isFailureKind(value: unknown): value is FailureKind { return value === "unclassified" || isCaptureFailureKind(value); }
function isFailureRouteId(value: unknown): value is FailureRouteId { return SLOVENIA_OFFICIAL_DIRECTORY_BOOTSTRAP.routes.some((route) => route.routeId === value); }

export async function runCaptureSloveniaDemoSourcesEntrypoint(argv: readonly string[], supplied: Partial<Dependencies> = {}): Promise<Readonly<{ exitCode: 0 | 1; stderr: string }>> {
  try { await runCaptureSloveniaDemoSources(parseCaptureSloveniaDemoSourcesArgs(argv), supplied); return Object.freeze({ exitCode: 0, stderr: "" }); }
  catch { return Object.freeze({ exitCode: 1, stderr: noOption(argv) ? OPT_IN_ERROR : FAILED }); }
}

function assertExpectedCandidates(value: unknown): void {
  const root = exact(value, ["schemaVersion", "mode", "stagingOnly", "policyLockWritten", "discovery", "jobs"]);
  if (root.schemaVersion !== "si-demo-package-acquisition-staging@1" || root.mode !== "native_discovery_hints" || root.stagingOnly !== true || root.policyLockWritten !== false || !denseArray(root.jobs) || root.jobs.length !== 3) invalid();
  const discovery = exact(root.discovery, ["invocationVersion", "protocolVersion", "compatibilityPolicy", "cliVersion", "model", "reasoningEffort", "toolPolicy", "templateVersion", "schemaVersion", "output"]);
  if (discovery.invocationVersion !== "codex-cli-invocation@2" || discovery.protocolVersion !== "codex-cli-protocol@2" || discovery.compatibilityPolicy !== "codex-cli-0.149.0-alpha.4-plus@2" || typeof discovery.cliVersion !== "string" || discovery.model !== "gpt-5.4" || discovery.reasoningEffort !== "medium" || discovery.toolPolicy !== "codex-tools-web-search@2" || discovery.templateVersion !== "official-source-discover@4" || discovery.schemaVersion !== "official-source-candidates@1" || discovery.output !== "untrusted_hints_only") invalid();
  const parsedJobs = root.jobs.map((entry) => {
    const job = exact(entry, ["jobId", "candidates"]);
    if (typeof job.jobId !== "string" || !denseArray(job.candidates) || job.candidates.length > 5) invalid();
    const candidates = job.candidates.map((candidate) => {
      const item = exact(candidate, ["url", "urlSha256", "host", "hostSha256"]);
      if (typeof item.url !== "string" || typeof item.urlSha256 !== "string" || typeof item.host !== "string" || typeof item.hostSha256 !== "string") invalid();
      const canonical = canonicalHttpsUrl(item.url);
      if (canonical !== item.url || new URL(canonical).hostname !== item.host || digest(canonical) !== item.urlSha256 || digest(item.host) !== item.hostSha256) invalid();
      return item;
    });
    return Object.freeze({ jobId: job.jobId, candidates });
  });
  if (new Set(parsedJobs.map((job) => job.jobId)).size !== 3) invalid();
  for (const policy of SLOVENIA_OFFICIAL_DIRECTORY_BOOTSTRAP.routes) {
    const job = parsedJobs.find((entry) => entry.jobId === policy.jobId);
    if (job === undefined) invalid();
    const candidate = job.candidates.find((item) => item.url === policy.url && item.urlSha256 === sloveniaBootstrapUrlSha256(policy) && item.host === new URL(policy.url).hostname && item.hostSha256 === digest(item.host));
    if (candidate === undefined) invalid();
  }
}

export function createCaptureStore(options: Readonly<{ workspaceRoot: string; randomId?: () => string }>): CaptureStore {
  const root = resolve(options.workspaceRoot); const randomId = options.randomId ?? randomUUID;
  const absolute = (path: string) => { const target = resolve(root, path); if (relative(root, target) !== path) invalid(); return target; };
  const paths = () => [MANIFEST_PATH, FAILURE_PATH, ...SLOVENIA_OFFICIAL_DIRECTORY_BOOTSTRAP.routes.map((route) => `${OUTPUT_ROOT}/raw/${route.routeId}.bin`)];
  const cleanup = async () => { for (const path of paths()) { const target = absolute(path); await safe(target, root, false); await unlink(target).catch((error: unknown) => { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }); } };
  return Object.freeze({
    prepare: cleanup, cleanup,
    async write(items) {
      if (items.length !== 3) invalid();
      if (items.some((item, index) => item.policy !== SLOVENIA_OFFICIAL_DIRECTORY_BOOTSTRAP.routes[index]) || new Set(items.map((item) => item.policy.routeId)).size !== 3) invalid();
      const runId = items[0]?.capture.artifact.runId; if (typeof runId !== "string" || items.some((item) => item.capture.artifact.runId !== runId)) invalid();
      const snapshots = items.map(({ policy, capture }) => ({ policy, capture: snapshotCapture(policy, capture, runId) }));
      const manifest: Manifest = Object.freeze({ schemaVersion: SCHEMA, runId, stagingOnly: true, policyLockWritten: false, captures: Object.freeze(snapshots.map(({ policy, capture }) => {
        const artifact = capture.artifact;
        const bytes = new Uint8Array(artifact.bytes);
        if (artifact.origin !== "live" || artifact.sourceId !== policy.sourceId || artifact.role !== policy.role || artifact.request.method !== "GET" || artifact.request.url !== policy.url || artifact.request.bodySha256 !== undefined || artifact.request.bodyMediaType !== undefined || artifact.url !== artifact.responseUrl || artifact.responseStatus < 200 || artifact.responseStatus > 299 || artifact.artifactId !== `${artifact.sourceId}:${artifact.role}:${artifact.sha256}` || artifact.sha256 !== digest(bytes) || bytes.byteLength > policy.maxBytes || artifact.mediaType === "" || !policy.allowedMediaTypes.includes(artifact.mediaType) || canonicalHttpsUrl(artifact.responseUrl) !== artifact.responseUrl || !policy.allowedHosts.includes(new URL(artifact.responseUrl).hostname) || !canonicalInstant(artifact.capturedAt)) invalid();
        const chain = capture.redirectChain.map((url) => canonicalHttpsUrl(url));
        if (chain.length === 0 || chain.length > policy.maxRedirects + 1 || chain[0] !== policy.url || chain.at(-1) !== artifact.responseUrl || new Set(chain).size !== chain.length || chain.some((url) => !policy.allowedHosts.includes(new URL(url).hostname))) invalid();
        return Object.freeze({ artifactId: artifact.artifactId, routeId: policy.routeId, sourceId: policy.sourceId, publisherId: policy.publisherId, inputCandidateSha256: sloveniaBootstrapUrlSha256(policy), method: "GET" as const, initialUrl: policy.url, finalUrl: artifact.responseUrl, responseStatus: artifact.responseStatus, redirectChain: Object.freeze(chain), mediaType: artifact.mediaType, byteCount: bytes.byteLength, sha256: artifact.sha256, capturedAt: artifact.capturedAt, rawPath: `${OUTPUT_ROOT}/raw/${policy.routeId}.bin` });
      })) });
      for (const item of snapshots) await atomicWrite(absolute(`${OUTPUT_ROOT}/raw/${item.policy.routeId}.bin`), item.capture.artifact.bytes, root, randomId);
      await atomicWrite(absolute(MANIFEST_PATH), new TextEncoder().encode(`${JSON.stringify(manifest)}\n`), root, randomId);
    },
  });
}

async function atomicWrite(target: string, bytes: Uint8Array, root: string, randomId: () => string): Promise<void> { await safe(target, root, false); const directory = dirname(target); await mkdir(directory, { recursive: true, mode: 0o700 }); await safe(target, root, true); const temporary = resolve(directory, `.${randomId()}.tmp`); let handle: Awaited<ReturnType<typeof open>> | undefined; let temporaryOwned = false; try { handle = await open(temporary, "wx", 0o600); temporaryOwned = true; await handle.writeFile(bytes); await handle.sync(); await handle.close(); handle = undefined; await rename(temporary, target); temporaryOwned = false; await chmod(target, 0o600); } finally { await handle?.close().catch(() => undefined); if (temporaryOwned) await rm(temporary, { force: true }); } }
async function safe(target: string, root: string, requireParent: boolean): Promise<void> { const pieces = relative(root, target).split("/"); let cursor = root; for (let index = 0; index < pieces.length; index += 1) { cursor = resolve(cursor, pieces[index]!); try { const info = await lstat(cursor); if (info.isSymbolicLink() || (index === pieces.length - 1 && info.nlink > 1)) invalid(); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; if (requireParent && index < pieces.length - 1) invalid(); return; } } }
function digest(value: string | Uint8Array): string { return createHash("sha256").update(value).digest("hex"); }
function denseArray(value: unknown): value is unknown[] { if (!Array.isArray(value) || types.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype || Object.keys(value).length !== value.length) return false; return Array.from({ length: value.length }, (_, index) => { const descriptor = Object.getOwnPropertyDescriptor(value, String(index)); return descriptor?.enumerable === true && "value" in descriptor; }).every(Boolean); }
function snapshotCapture(policy: SloveniaOfficialDirectoryBootstrapEntry, borrowed: Capture, runId: string): Capture {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(runId)) invalid();
  const capture = exact(borrowed, ["artifact", "redirectChain"]);
  if (!denseArray(capture.redirectChain)) invalid();
  const artifact = exact(capture.artifact, [
    "artifactId", "runId", "sourceId", "role", "url", "mediaType", "sha256", "bytes",
    "origin", "capturedAt", "responseStatus", "responseUrl", "request",
  ]);
  const request = exact(artifact.request, ["method", "url"]);
  const borrowedBytes = artifact.bytes;
  if (!(borrowedBytes instanceof Uint8Array) || types.isProxy(borrowedBytes) ||
    Object.getPrototypeOf(borrowedBytes) !== Uint8Array.prototype) invalid();
  const bytes = new Uint8Array(borrowedBytes);
  if (artifact.runId !== runId || artifact.origin !== "live" || artifact.sourceId !== policy.sourceId ||
    artifact.role !== policy.role || request.method !== "GET" || request.url !== policy.url ||
    !Number.isSafeInteger(artifact.responseStatus) || (artifact.responseStatus as number) < 200 ||
    (artifact.responseStatus as number) > 299 || typeof artifact.sha256 !== "string" ||
    artifact.sha256 !== digest(bytes) ||
    artifact.artifactId !== `${policy.sourceId}:${policy.role}:${artifact.sha256}` ||
    typeof artifact.url !== "string" || artifact.url !== artifact.responseUrl ||
    typeof artifact.responseUrl !== "string" || typeof artifact.mediaType !== "string" ||
    !policy.allowedMediaTypes.includes(artifact.mediaType) || bytes.byteLength > policy.maxBytes ||
    !canonicalInstant(artifact.capturedAt)) invalid();
  let finalUrl: string;
  try {
    finalUrl = canonicalHttpsUrl(artifact.responseUrl);
    const parsed = new URL(finalUrl);
    if (parsed.port !== "" || !policy.allowedHosts.includes(parsed.hostname)) invalid();
  } catch { invalid(); }
  const redirectChain = capture.redirectChain.map((value) => {
    if (typeof value !== "string") invalid();
    let url: string;
    try {
      url = canonicalHttpsUrl(value);
      const parsed = new URL(url);
      if (parsed.port !== "" || !policy.allowedHosts.includes(parsed.hostname)) invalid();
    } catch { invalid(); }
    return url;
  });
  if (redirectChain.length === 0 || redirectChain.length > policy.maxRedirects + 1 ||
    redirectChain[0] !== policy.url || redirectChain.at(-1) !== finalUrl ||
    new Set(redirectChain).size !== redirectChain.length) invalid();
  return Object.freeze({
    artifact: Object.freeze({
      artifactId: artifact.artifactId as string,
      runId,
      sourceId: policy.sourceId,
      role: policy.role,
      url: finalUrl,
      mediaType: artifact.mediaType,
      sha256: artifact.sha256,
      bytes,
      origin: "live" as const,
      capturedAt: artifact.capturedAt as string,
      responseStatus: artifact.responseStatus as number,
      responseUrl: finalUrl,
      request: Object.freeze({ method: "GET" as const, url: policy.url }),
    }),
    redirectChain: Object.freeze(redirectChain),
  });
}
function canonicalInstant(value: unknown): boolean { if (typeof value !== "string") return false; try { return new Date(value).toISOString() === value; } catch { return false; } }
function isObject(value: unknown): value is object { return value !== null && typeof value === "object" && !types.isProxy(value) && Object.getPrototypeOf(value) === Object.prototype; }
function exact(value: unknown, keys: readonly string[]): Record<string, unknown> { if (!isObject(value) || Object.getOwnPropertySymbols(value).length !== 0) invalid(); const descriptors = Object.getOwnPropertyDescriptors(value); if (Object.keys(descriptors).length !== keys.length || !keys.every((key) => descriptors[key]?.enumerable === true && "value" in descriptors[key]!)) invalid(); return Object.fromEntries(keys.map((key) => [key, descriptors[key]!.value])); }
function invalid(): never { throw new Error("capture_slovenia_demo_sources_invalid"); }
function noOption(argv: readonly string[]): boolean { return Array.isArray(argv) && !types.isProxy(argv) && (argv.length === 0 || (argv.length === 1 && argv[0] === "--")); }
if (import.meta.main) void runCaptureSloveniaDemoSourcesEntrypoint(process.argv.slice(2)).then((result) => { if (result.stderr !== "") process.stderr.write(result.stderr); process.exitCode = result.exitCode; });
