import { createHash, randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, open, readFile, rename, rm, unlink } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { types } from "node:util";

import {
  snapshotSloveniaSafetyAuthorityDiscoveryStaging,
  snapshotSloveniaSafetyAuthorityPrerequisites,
  type SloveniaSafetyAuthorityPrerequisiteSnapshots,
} from "./discover-slovenia-safety-authority";
import type { HttpStepRequest } from "../src/research/contracts";
import {
  analyzeSloveniaMunicipalityAuthorityLinkHtml,
  type SloveniaMunicipalityAuthorityLinkEvidence,
} from "../src/infrastructure/sources/slovenia-municipality-authority-link-analyzer";
import {
  SLOVENIA_SAFETY_AUTHORITY_BOOTSTRAP,
  sloveniaSafetyAuthorityBootstrapUrlSha256,
} from "../src/infrastructure/sources/slovenia-safety-authority-bootstrap";
import {
  captureHttpWithTrace,
  type HttpCaptureLimits,
  type TracedLiveCapture,
} from "../src/infrastructure/sources/gateway";

const DISCOVERY_INPUT_PATH = "data/evals/prepare-slovenia-demo-package/result.json";
const FAILURE_INPUT_PATH = "data/evals/capture-slovenia-demo-sources/failure.json";
const RECOVERY_INPUT_PATH = "data/evals/discover-slovenia-safety-authority/result.json";
const OUTPUT_ROOT = "data/evals/capture-slovenia-safety-authority";
const RAW_PATH = `${OUTPUT_ROOT}/raw/gov-municipalities.bin`;
const MANIFEST_PATH = `${OUTPUT_ROOT}/manifest.json`;
const MANIFEST_SCHEMA = "si-demo-safety-authority-capture-staging@1" as const;
const OPT_IN_ERROR = "live_official_sources_opt_in_required\n";
const FAILED = "capture_slovenia_safety_authority_failed\n";

type Capture = TracedLiveCapture<"si-demo-gov-municipalities">;
type CaptureFn = (
  request: HttpStepRequest<"si-demo-gov-municipalities">,
  signal: AbortSignal,
  limits: HttpCaptureLimits,
) => Promise<Capture>;
type AnalyzeFn = (bytes: Uint8Array) => unknown;

type InputBindings = SloveniaSafetyAuthorityPrerequisiteSnapshots & Readonly<{
  recoveryDiscoverySnapshotSha256: string;
}>;

type StoreInput = Readonly<{
  capture: Capture;
  evidence: SloveniaMunicipalityAuthorityLinkEvidence;
  inputs: InputBindings;
}>;

type Dependencies = Readonly<{
  readDiscoveryInput: () => Promise<unknown>;
  readFailureInput: () => Promise<unknown>;
  readRecoveryInput: () => Promise<unknown>;
  createRunId: () => string;
  capture: CaptureFn;
  analyze: AnalyzeFn;
  store: CaptureSloveniaSafetyAuthorityStore;
}>;

export type CaptureSloveniaSafetyAuthorityArguments = Readonly<{ live: true }>;
export type CaptureSloveniaSafetyAuthorityStore = Readonly<{
  prepare(): Promise<void>;
  cleanup(): Promise<void>;
  write(value: unknown): Promise<void>;
}>;

export function parseCaptureSloveniaSafetyAuthorityArgs(
  argv: readonly string[],
): CaptureSloveniaSafetyAuthorityArguments {
  const values = denseDataArray(argv);
  const normalized = values[0] === "--" ? values.slice(1) : values;
  if (normalized.length !== 1 || normalized[0] !== "--live-official-sources") invalid();
  return Object.freeze({ live: true });
}

export async function runCaptureSloveniaSafetyAuthority(
  args: CaptureSloveniaSafetyAuthorityArguments,
  supplied: Partial<Dependencies> = {},
): Promise<void> {
  const inputArgs = exactDataObject(args, ["live"]);
  if (inputArgs.live !== true) invalid();
  const readDiscoveryInput = supplied.readDiscoveryInput ??
    (async () => JSON.parse(await readFile(DISCOVERY_INPUT_PATH, "utf8")) as unknown);
  const readFailureInput = supplied.readFailureInput ??
    (async () => JSON.parse(await readFile(FAILURE_INPUT_PATH, "utf8")) as unknown);
  const readRecoveryInput = supplied.readRecoveryInput ??
    (async () => JSON.parse(await readFile(RECOVERY_INPUT_PATH, "utf8")) as unknown);
  const createRunId = supplied.createRunId ?? randomUUID;
  const capture = supplied.capture ?? captureHttpWithTrace;
  const analyze = supplied.analyze ?? analyzeSloveniaMunicipalityAuthorityLinkHtml;
  const store = supplied.store ?? createCaptureSloveniaSafetyAuthorityStore({
    workspaceRoot: process.cwd(),
  });
  if (typeof readDiscoveryInput !== "function" || typeof readFailureInput !== "function" ||
    typeof readRecoveryInput !== "function" || typeof createRunId !== "function" ||
    typeof capture !== "function" || typeof analyze !== "function" || !validStore(store)) invalid();

  try {
    const prerequisites = snapshotSloveniaSafetyAuthorityPrerequisites(
      await readDiscoveryInput(),
      await readFailureInput(),
    );
    const recovery = snapshotSloveniaSafetyAuthorityDiscoveryStaging(await readRecoveryInput());
    if (recovery.prerequisites.discoverySnapshotSha256 !== prerequisites.discoverySnapshotSha256 ||
      recovery.prerequisites.failureSnapshotSha256 !== prerequisites.failureSnapshotSha256 ||
      !recovery.candidates.some((candidate) =>
        candidate.url === SLOVENIA_SAFETY_AUTHORITY_BOOTSTRAP.route.url &&
        candidate.urlSha256 === sloveniaSafetyAuthorityBootstrapUrlSha256() &&
        candidate.host === SLOVENIA_SAFETY_AUTHORITY_BOOTSTRAP.route.allowedHosts[0] &&
        candidate.hostSha256 === sha256(SLOVENIA_SAFETY_AUTHORITY_BOOTSTRAP.route.allowedHosts[0]))) {
      invalid();
    }
    const inputs = Object.freeze({
      ...prerequisites,
      recoveryDiscoverySnapshotSha256: sha256(JSON.stringify(recovery)),
    });

    await store.prepare();
    const runId = createRunId();
    if (!isUuidV4(runId)) invalid();
    const route = SLOVENIA_SAFETY_AUTHORITY_BOOTSTRAP.route;
    const request: HttpStepRequest<"si-demo-gov-municipalities"> = Object.freeze({
      runId,
      sourceId: route.sourceId,
      role: route.role,
      method: "GET",
      url: route.url,
      headers: Object.freeze({ accept: "text/html" }),
      allowedHosts: route.allowedHosts,
      allowedMediaTypes: route.allowedMediaTypes,
    });
    const captured = snapshotCapture(
      await capture(request, AbortSignal.timeout(route.timeoutMs), {
        maxBytes: route.maxBytes,
        maxRedirects: route.maxRedirects,
      }),
      runId,
    );
    const evidence = snapshotEvidence(analyze(new Uint8Array(captured.artifact.bytes)));
    const value: StoreInput = Object.freeze({ capture: captured, evidence, inputs });
    await store.write(value);
  } catch (error) {
    await store.cleanup();
    throw error;
  }
}

export async function runCaptureSloveniaSafetyAuthorityEntrypoint(
  argv: readonly string[],
  supplied: Partial<Dependencies> = {},
): Promise<Readonly<{ exitCode: 0 | 1; stderr: string }>> {
  try {
    await runCaptureSloveniaSafetyAuthority(parseCaptureSloveniaSafetyAuthorityArgs(argv), supplied);
    return Object.freeze({ exitCode: 0, stderr: "" });
  } catch {
    return Object.freeze({ exitCode: 1, stderr: noOption(argv) ? OPT_IN_ERROR : FAILED });
  }
}

function snapshotCapture(value: unknown, expectedRunId?: string): Capture {
  const root = exactDataObject(value, ["artifact", "redirectChain"]);
  const artifact = exactDataObject(root.artifact, [
    "artifactId", "runId", "sourceId", "role", "url", "mediaType", "sha256", "bytes",
    "origin", "capturedAt", "responseStatus", "responseUrl", "request",
  ]);
  const request = exactDataObject(artifact.request, ["method", "url"]);
  const runId = expectedRunId ?? artifact.runId;
  const route = SLOVENIA_SAFETY_AUTHORITY_BOOTSTRAP.route;
  if (typeof runId !== "string" || !isUuidV4(runId) || artifact.runId !== runId ||
    artifact.sourceId !== route.sourceId || artifact.role !== route.role || artifact.origin !== "live" ||
    request.method !== "GET" || request.url !== route.url || artifact.url !== artifact.responseUrl ||
    artifact.mediaType !== "text/html" || !Number.isSafeInteger(artifact.responseStatus) ||
    (artifact.responseStatus as number) < 200 || (artifact.responseStatus as number) > 299 ||
    !canonicalInstant(artifact.capturedAt)) invalid();
  if (artifact.bytes === null || typeof artifact.bytes !== "object" ||
    types.isProxy(artifact.bytes) || !(artifact.bytes instanceof Uint8Array) ||
    Object.getPrototypeOf(artifact.bytes) !== Uint8Array.prototype) invalid();
  const bytes = new Uint8Array(artifact.bytes);
  if (bytes.byteLength > route.maxBytes || typeof artifact.sha256 !== "string" ||
    artifact.sha256 !== sha256(bytes) ||
    artifact.artifactId !== `${route.sourceId}:${route.role}:${artifact.sha256}`) invalid();
  const responseUrl = exactOfficialUrl(artifact.responseUrl, route.allowedHosts);
  const redirectChain = denseDataArray(root.redirectChain, route.maxRedirects + 1).map((url) =>
    exactOfficialUrl(url, route.allowedHosts));
  if (redirectChain.length === 0 || redirectChain[0] !== route.url ||
    redirectChain.at(-1) !== responseUrl || new Set(redirectChain).size !== redirectChain.length) invalid();
  return Object.freeze({
    artifact: Object.freeze({
      artifactId: artifact.artifactId as string,
      runId,
      sourceId: route.sourceId,
      role: route.role,
      url: responseUrl,
      mediaType: "text/html",
      sha256: artifact.sha256,
      bytes,
      origin: "live" as const,
      capturedAt: artifact.capturedAt as string,
      responseStatus: artifact.responseStatus as number,
      responseUrl,
      request: Object.freeze({ method: "GET" as const, url: route.url }),
    }),
    redirectChain: Object.freeze(redirectChain),
  });
}

function snapshotEvidence(value: unknown): SloveniaMunicipalityAuthorityLinkEvidence {
  const evidence = exactDataObject(value, [
    "schemaVersion", "analyzerVersion", "parentPublisherHost", "municipalityHost", "linkUrl",
    "identityLabel",
  ]);
  if (evidence.schemaVersion !== "si-municipality-authority-link-evidence@1" ||
    evidence.analyzerVersion !== "si-municipality-authority-link-html@1" ||
    evidence.parentPublisherHost !== "www.gov.si" || evidence.municipalityHost !== "www.ljubljana.si" ||
    evidence.linkUrl !== "https://www.ljubljana.si/" ||
    evidence.identityLabel !== "Mestna občina Ljubljana") invalid();
  return Object.freeze({
    schemaVersion: "si-municipality-authority-link-evidence@1",
    analyzerVersion: "si-municipality-authority-link-html@1",
    parentPublisherHost: "www.gov.si",
    municipalityHost: "www.ljubljana.si",
    linkUrl: "https://www.ljubljana.si/",
    identityLabel: "Mestna občina Ljubljana",
  });
}

function snapshotInputBindings(value: unknown): InputBindings {
  const input = exactDataObject(value, [
    "discoverySnapshotSha256", "failureSnapshotSha256", "recoveryDiscoverySnapshotSha256",
  ]);
  if (!isSha256(input.discoverySnapshotSha256) || !isSha256(input.failureSnapshotSha256) ||
    !isSha256(input.recoveryDiscoverySnapshotSha256)) invalid();
  return Object.freeze({
    discoverySnapshotSha256: input.discoverySnapshotSha256,
    failureSnapshotSha256: input.failureSnapshotSha256,
    recoveryDiscoverySnapshotSha256: input.recoveryDiscoverySnapshotSha256,
  });
}

export function createCaptureSloveniaSafetyAuthorityStore(options: Readonly<{
  workspaceRoot: string;
  randomId?: () => string;
}>): CaptureSloveniaSafetyAuthorityStore {
  const root = resolve(options.workspaceRoot);
  const randomId = options.randomId ?? randomUUID;
  const absolute = (path: string): string => {
    const target = resolve(root, path);
    if (relative(root, target) !== path) invalid();
    return target;
  };
  const paths = [MANIFEST_PATH, RAW_PATH] as const;
  const cleanup = async (): Promise<void> => {
    for (const path of paths) {
      const target = absolute(path);
      await assertSafeArtifactIdentity(root, target, false);
      await unlink(target).catch((error: unknown) => {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      });
    }
  };
  return Object.freeze({
    prepare: cleanup,
    cleanup,
    async write(value) {
      const input = exactDataObject(value, ["capture", "evidence", "inputs"]);
      const captured = snapshotCapture(input.capture);
      const evidence = snapshotEvidence(input.evidence);
      const inputs = snapshotInputBindings(input.inputs);
      const route = SLOVENIA_SAFETY_AUTHORITY_BOOTSTRAP.route;
      const artifact = captured.artifact;
      const manifest = Object.freeze({
        schemaVersion: MANIFEST_SCHEMA,
        runId: artifact.runId,
        stagingOnly: true,
        policyLockWritten: false,
        authorityInstalled: false,
        inputs,
        capture: Object.freeze({
          artifactId: artifact.artifactId,
          routeId: route.routeId,
          sourceId: route.sourceId,
          publisherId: route.publisherId,
          inputCandidateSha256: sloveniaSafetyAuthorityBootstrapUrlSha256(),
          method: "GET" as const,
          initialUrl: route.url,
          finalUrl: artifact.responseUrl,
          responseStatus: artifact.responseStatus,
          redirectChain: captured.redirectChain,
          mediaType: artifact.mediaType,
          byteCount: artifact.bytes.byteLength,
          sha256: artifact.sha256,
          capturedAt: artifact.capturedAt,
          rawPath: RAW_PATH,
        }),
        candidateAuthorityEvidence: Object.freeze({
          ...evidence,
          parentArtifactId: artifact.artifactId,
          edgeKind: "confirmed_document_link" as const,
        }),
      });
      await atomicWrite(absolute(RAW_PATH), artifact.bytes, root, randomId);
      await atomicWrite(
        absolute(MANIFEST_PATH),
        new TextEncoder().encode(`${JSON.stringify(manifest)}\n`),
        root,
        randomId,
      );
    },
  });
}

async function atomicWrite(
  target: string,
  bytes: Uint8Array,
  root: string,
  randomId: () => string,
): Promise<void> {
  await assertSafeArtifactIdentity(root, target, false);
  const directory = dirname(target);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await assertSafeArtifactIdentity(root, target, true);
  const temporary = resolve(directory, `.${randomId()}.tmp`);
  if (dirname(temporary) !== directory || temporary === target) invalid();
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  let temporaryOwned = false;
  try {
    handle = await open(temporary, "wx", 0o600);
    temporaryOwned = true;
    await handle.writeFile(bytes);
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
}

function validStore(value: unknown): value is CaptureSloveniaSafetyAuthorityStore {
  if (!isPlainDataObject(value)) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  return Object.keys(descriptors).length === 3 && ["prepare", "cleanup", "write"].every((key) => {
    const descriptor = descriptors[key];
    return descriptor?.enumerable === true && "value" in descriptor &&
      typeof descriptor.value === "function";
  });
}

function exactOfficialUrl(value: unknown, allowedHosts: readonly string[]): string {
  if (typeof value !== "string") invalid();
  let parsed: URL;
  try { parsed = new URL(value); } catch { invalid(); }
  if (parsed.protocol !== "https:" || parsed.username !== "" || parsed.password !== "" ||
    parsed.port !== "" || parsed.hash !== "" || parsed.href !== value ||
    !allowedHosts.includes(parsed.hostname)) invalid();
  return parsed.href;
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

function canonicalInstant(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try { return new Date(value).toISOString() === value; } catch { return false; }
}

function isUuidV4(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

function noOption(argv: readonly string[]): boolean {
  try {
    const values = denseDataArray(argv);
    return values.length === 0 || (values.length === 1 && values[0] === "--");
  } catch { return false; }
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function invalid(): never {
  throw new Error("capture_slovenia_safety_authority_invalid");
}

if (import.meta.main) {
  void runCaptureSloveniaSafetyAuthorityEntrypoint(process.argv.slice(2)).then((result) => {
    if (result.stderr !== "") process.stderr.write(result.stderr);
    process.exitCode = result.exitCode;
  });
}
