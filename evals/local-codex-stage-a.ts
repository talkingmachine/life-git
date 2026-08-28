import { chmod, lstat, mkdir, open, readFile, rename, rm, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, relative, resolve } from "node:path";
import { types } from "node:util";

import { CODEX_CLI_COMPATIBILITY_POLICY, CODEX_CLI_PROTOCOL_VERSION, CODEX_MODEL, createCodexJsonInvocation } from "../src/infrastructure/codex-cli/contracts";
import { getCodexCliModelAdapter, verifyCodexCliCapabilities } from "../src/infrastructure/codex-cli/runtime";
import { registerNodeCodexRuntime } from "../src/instrumentation-node";
import { createCodexOnboardingModel } from "../src/infrastructure/codex-cli/onboarding-model";
import { createCodexOfficialSourceDiscovery } from "../src/infrastructure/codex-cli/official-source-discovery";
import { createOnboardingSession } from "../src/decision/onboarding-session";
import { guardExtraction, projectQuestionnaireForModel } from "../src/decision/onboarding-model-contract";
import { parseLocalExtractionOutput } from "../src/decision/onboarding-model-output";
import type { SessionMessage } from "../src/decision/onboarding-session";
import { reconstructOfficialSourceDiscoveryRequest, type OfficialSourceDiscoveryRequest } from "../src/application/official-source-discovery";

const OPT_IN_ERROR = "local_codex_live_opt_in_required\n";
const ARTIFACT_SCHEMA = "local-codex-stage-a@1" as const;
const ARTIFACT_PATH = "data/evals/local-codex-stage-a/result.json";
const EVENT_LIMIT = 128;

export type LocalCodexStageAArguments = Readonly<{ live: boolean; artifactPath: string }>;
export type LocalCodexStageAEntrypointResult = Readonly<{ exitCode: 0 | 1; stderr: string }>;
type Probe = Readonly<{ passed: true; webSearchCount: number }>;
type Artifact = Readonly<{
  schemaVersion: typeof ARTIFACT_SCHEMA;
  cliVersion: string;
  protocolVersion: typeof CODEX_CLI_PROTOCOL_VERSION;
  compatibilityPolicy: typeof CODEX_CLI_COMPATIBILITY_POLICY;
  model: typeof CODEX_MODEL;
  effortsProven: readonly ["low", "medium"];
  noToolProbe: Probe;
  discoveryProbe: Probe;
  onboarding: Readonly<{ guardedProposalCount: number; inventedValueCount: number }>;
  discovery: Readonly<{ candidateCount: number; allCandidatesUntrusted: true }>;
  concurrency: Readonly<{ requested: readonly [1, 2, 5]; completed: readonly [1, 2, 5]; crossJobLeakage: false; measurements: readonly [ConcurrencyMeasurement, ConcurrencyMeasurement, ConcurrencyMeasurement] }>;
  abort: Readonly<{ processGroupTerminated: true; lateResultAccepted: false; waiterRejected: true; leaderTerminalObserved: true }>;
}>;

export type ConcurrencyMeasurement = Readonly<{ requested: 1 | 2 | 5; completed: 1 | 2 | 5; elapsedMs: number; p95Ms: number; throughputMilliJobsPerSecond: number; effectiveCeiling: 1 | 3 | 5 }>;
type AbortProof = Readonly<{ processGroupTerminated: boolean; lateResultAccepted: boolean; waiterRejected: boolean; leaderTerminalObserved: boolean }>;

export type StageAOnboardingFixture = Readonly<{
  message: SessionMessage;
  expected: Readonly<{ schemaVersion: "onboarding-model-output@1"; proposals: readonly Readonly<{ fieldId: string; typedValue: unknown; messageId: string; sourceSpan: Readonly<{ start: number; end: number }>; text: string }>[]; nextQuestion: string }>;
}>;

export type StageADiscoveryFixture = Readonly<{
  request: Omit<OfficialSourceDiscoveryRequest, "signal">;
  candidateLimit: number;
  candidatesUntrusted: true;
}>;

type Dependencies = Readonly<{
  initializeRuntime: () => Promise<Readonly<{
    cliVersion: string; protocolVersion: typeof CODEX_CLI_PROTOCOL_VERSION;
    compatibilityPolicy: typeof CODEX_CLI_COMPATIBILITY_POLICY; model: typeof CODEX_MODEL;
    noToolProbe: Probe; discoveryProbe: Probe;
  }>>;
  runOnboarding: () => Promise<Artifact["onboarding"]>;
  runDiscovery: () => Promise<Artifact["discovery"]>;
  measureConcurrency: (requested: 1 | 2 | 5) => Promise<ConcurrencyMeasurement>;
  proveAbort: () => Promise<AbortProof>;
  prepareArtifact: (path: string) => Promise<void>;
  cleanupArtifact: (path: string) => Promise<void>;
  writeArtifact: (path: string, artifact: Artifact) => Promise<void>;
  now: () => number;
}>;

export function parseLocalCodexStageAArgs(argv: readonly string[]): LocalCodexStageAArguments {
  if (!Array.isArray(argv) || types.isProxy(argv)) throw new TypeError("local_codex_stage_a_invalid_arguments");
  let live = false;
  let artifactPath = ARTIFACT_PATH;
  for (let index = 0; index < argv.length; index += 1) {
    const value = Object.getOwnPropertyDescriptor(argv, String(index));
    if (value?.enumerable !== true || !("value" in value) || typeof value.value !== "string") throw new TypeError("local_codex_stage_a_invalid_arguments");
    if (value.value === "--live-local-subscription") { live = true; continue; }
    if (value.value === "--artifact" && index + 1 < argv.length) {
      const next = Object.getOwnPropertyDescriptor(argv, String(++index));
      if (next?.enumerable !== true || !("value" in next) || typeof next.value !== "string") throw new TypeError("local_codex_stage_a_invalid_arguments");
      artifactPath = next.value;
      continue;
    }
    throw new TypeError("local_codex_stage_a_invalid_arguments");
  }
  return Object.freeze({ live, artifactPath: validateArtifactPath(artifactPath) });
}

export async function runLocalCodexStageA(
  args: LocalCodexStageAArguments,
  supplied: Partial<Dependencies> = {},
): Promise<LocalCodexStageAEntrypointResult> {
  const ownedArgs = readArgs(args);
  if (!ownedArgs.live) return Object.freeze({ exitCode: 1, stderr: OPT_IN_ERROR });
  const dependencies = readDependencies(supplied);
  // Stale evidence is removed before the first subscription-consuming action.
  await dependencies.prepareArtifact(ownedArgs.artifactPath);
  const startedAt = strictNow(dependencies.now());
  let artifact: Artifact | undefined;
  try {
    const runtime = await dependencies.initializeRuntime();
    validateRuntime(runtime);
    const onboarding = await dependencies.runOnboarding();
    const discovery = await dependencies.runDiscovery();
    const one = await dependencies.measureConcurrency(1);
    const two = await dependencies.measureConcurrency(2);
    const five = await dependencies.measureConcurrency(5);
    const abort = await dependencies.proveAbort();
    validateProofs(runtime, onboarding, discovery, [one, two, five], abort);
    artifact = Object.freeze({
    schemaVersion: ARTIFACT_SCHEMA, cliVersion: runtime.cliVersion, protocolVersion: runtime.protocolVersion,
    compatibilityPolicy: runtime.compatibilityPolicy, model: runtime.model, effortsProven: ["low", "medium"] as const,
    noToolProbe: runtime.noToolProbe, discoveryProbe: runtime.discoveryProbe, onboarding, discovery,
    concurrency: Object.freeze({ requested: [1, 2, 5] as const, completed: [1, 2, 5] as const, crossJobLeakage: false, measurements: [one, two, five] as const }),
    abort: Object.freeze({ processGroupTerminated: true, lateResultAccepted: false, waiterRejected: true, leaderTerminalObserved: true }),
    });
    if (strictNow(dependencies.now()) < startedAt) throw new TypeError("local_codex_stage_a_invalid_clock");
    validateArtifact(artifact);
    await dependencies.writeArtifact(ownedArgs.artifactPath, artifact);
  } catch (error) {
    // A failed gate must never leave a plausible-looking report behind.
    await dependencies.cleanupArtifact(ownedArgs.artifactPath);
    throw error;
  }
  return Object.freeze({ exitCode: 0, stderr: "" });
}

function readArgs(value: unknown): LocalCodexStageAArguments {
  const object = exactObject(value, ["live", "artifactPath"]);
  if (typeof object.live !== "boolean" || typeof object.artifactPath !== "string") throw new TypeError("local_codex_stage_a_invalid_arguments");
  return Object.freeze({ live: object.live, artifactPath: validateArtifactPath(object.artifactPath) });
}

function readDependencies(value: unknown): Dependencies {
  const object = exactObject(value, ["initializeRuntime", "runOnboarding", "runDiscovery", "measureConcurrency", "proveAbort", "prepareArtifact", "cleanupArtifact", "writeArtifact", "now"], true);
  return Object.freeze({
    initializeRuntime: functionDependency(object.initializeRuntime, productionDependencies.initializeRuntime),
    runOnboarding: functionDependency(object.runOnboarding, productionDependencies.runOnboarding),
    runDiscovery: functionDependency(object.runDiscovery, productionDependencies.runDiscovery),
    measureConcurrency: functionDependency(object.measureConcurrency, productionDependencies.measureConcurrency),
    proveAbort: functionDependency(object.proveAbort, productionDependencies.proveAbort),
    prepareArtifact: functionDependency(object.prepareArtifact, productionDependencies.prepareArtifact),
    cleanupArtifact: functionDependency(object.cleanupArtifact, productionDependencies.cleanupArtifact),
    writeArtifact: functionDependency(object.writeArtifact, productionDependencies.writeArtifact),
    now: functionDependency(object.now, productionDependencies.now),
  });
}

function exactObject(value: unknown, keys: readonly string[], partial = false): Record<string, unknown> {
  if (value === null || typeof value !== "object" || types.isProxy(value) || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) || Object.getOwnPropertySymbols(value).length !== 0) throw new TypeError("local_codex_stage_a_invalid_arguments");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if ((!partial && Object.keys(descriptors).length !== keys.length) || Object.keys(descriptors).some((key) => !keys.includes(key))) throw new TypeError("local_codex_stage_a_invalid_arguments");
  const result = Object.create(null) as Record<string, unknown>;
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (descriptor !== undefined && (descriptor.enumerable !== true || !("value" in descriptor))) throw new TypeError("local_codex_stage_a_invalid_arguments");
    result[key] = descriptor?.value;
  }
  return result;
}

function functionDependency<T extends (...arguments_: never[]) => unknown>(value: unknown, fallback: T): T {
  if (value === undefined) return fallback;
  if (typeof value !== "function" || types.isProxy(value)) throw new TypeError("local_codex_stage_a_invalid_arguments");
  return value as T;
}

function validateArtifactPath(value: string): string {
  if (value !== ARTIFACT_PATH || value.includes("\0") || resolve(value) !== resolve(ARTIFACT_PATH)) throw new TypeError("local_codex_stage_a_invalid_artifact_path");
  return value;
}

function validateRuntime(value: Awaited<ReturnType<Dependencies["initializeRuntime"]>>): void {
  if (!/^codex-cli 0\.149\.0-alpha\.(?:[4-9]|[1-9][0-9]+)$/.test(value.cliVersion) || value.protocolVersion !== CODEX_CLI_PROTOCOL_VERSION || value.compatibilityPolicy !== CODEX_CLI_COMPATIBILITY_POLICY || value.model !== CODEX_MODEL || value.noToolProbe.passed !== true || value.noToolProbe.webSearchCount !== 0 || value.discoveryProbe.passed !== true || !Number.isInteger(value.discoveryProbe.webSearchCount) || value.discoveryProbe.webSearchCount < 1 || value.discoveryProbe.webSearchCount > EVENT_LIMIT) throw new TypeError("local_codex_stage_a_invalid_runtime_proof");
}

function validateProofs(runtime: Awaited<ReturnType<Dependencies["initializeRuntime"]>>, onboarding: Artifact["onboarding"], discovery: Artifact["discovery"], concurrency: readonly ConcurrencyMeasurement[], abort: AbortProof): void {
  void runtime;
  if (onboarding.guardedProposalCount !== 4 || onboarding.inventedValueCount !== 0 || !Number.isInteger(discovery.candidateCount) || discovery.candidateCount < 1 || discovery.candidateCount > 5 || discovery.allCandidatesUntrusted !== true || concurrency.length !== 3 || concurrency.some((proof, index) => !validMeasurement(proof, [1, 2, 5][index]!)) || abort.processGroupTerminated !== true || abort.lateResultAccepted !== false || abort.waiterRejected !== true || abort.leaderTerminalObserved !== true) throw new TypeError("local_codex_stage_a_invalid_proof");
}

function validMeasurement(value: ConcurrencyMeasurement, requested: number): boolean {
  return value.requested === requested && value.completed === requested && [1, 3, 5].includes(value.effectiveCeiling) && [value.elapsedMs, value.p95Ms, value.throughputMilliJobsPerSecond].every((number) => Number.isSafeInteger(number) && number >= 0 && number <= 3_600_000_000);
}

function validateArtifact(value: Artifact): void {
  const root = exactObject(value, ["schemaVersion", "cliVersion", "protocolVersion", "compatibilityPolicy", "model", "effortsProven", "noToolProbe", "discoveryProbe", "onboarding", "discovery", "concurrency", "abort"]);
  if (root.schemaVersion !== ARTIFACT_SCHEMA || typeof root.cliVersion !== "string" || root.protocolVersion !== CODEX_CLI_PROTOCOL_VERSION || root.compatibilityPolicy !== CODEX_CLI_COMPATIBILITY_POLICY || root.model !== CODEX_MODEL) throw new TypeError("local_codex_stage_a_invalid_artifact");
  const efforts = exactArray(root.effortsProven);
  const noTool = exactObject(root.noToolProbe, ["passed", "webSearchCount"]);
  const discoveryProbe = exactObject(root.discoveryProbe, ["passed", "webSearchCount"]);
  const onboarding = exactObject(root.onboarding, ["guardedProposalCount", "inventedValueCount"]);
  const discovery = exactObject(root.discovery, ["candidateCount", "allCandidatesUntrusted"]);
  const concurrency = exactObject(root.concurrency, ["requested", "completed", "crossJobLeakage", "measurements"]);
  const abort = exactObject(root.abort, ["processGroupTerminated", "lateResultAccepted", "waiterRejected", "leaderTerminalObserved"]);
  if (efforts.length !== 2 || efforts[0] !== "low" || efforts[1] !== "medium" || noTool.passed !== true || noTool.webSearchCount !== 0 || discoveryProbe.passed !== true || typeof discoveryProbe.webSearchCount !== "number" || !Number.isSafeInteger(discoveryProbe.webSearchCount) || discoveryProbe.webSearchCount < 1 || discoveryProbe.webSearchCount > EVENT_LIMIT || onboarding.guardedProposalCount !== 4 || onboarding.inventedValueCount !== 0 || typeof discovery.candidateCount !== "number" || !Number.isSafeInteger(discovery.candidateCount) || discovery.candidateCount < 1 || discovery.candidateCount > 5 || discovery.allCandidatesUntrusted !== true || concurrency.crossJobLeakage !== false || abort.processGroupTerminated !== true || abort.lateResultAccepted !== false || abort.waiterRejected !== true || abort.leaderTerminalObserved !== true) throw new TypeError("local_codex_stage_a_invalid_artifact");
  const requested = exactArray(concurrency.requested); const completed = exactArray(concurrency.completed); const measurements = exactArray(concurrency.measurements);
  if (requested.length !== 3 || completed.length !== 3 || measurements.length !== 3 || requested.some((entry, index) => entry !== [1, 2, 5][index]) || completed.some((entry, index) => entry !== [1, 2, 5][index])) throw new TypeError("local_codex_stage_a_invalid_artifact");
  measurements.forEach((measurement, index) => { if (!validMeasurement(exactObject(measurement, ["requested", "completed", "elapsedMs", "p95Ms", "throughputMilliJobsPerSecond", "effectiveCeiling"]) as ConcurrencyMeasurement, [1, 2, 5][index]!)) throw new TypeError("local_codex_stage_a_invalid_artifact"); });
}

function strictNow(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 3_600_000_000) throw new TypeError("local_codex_stage_a_invalid_clock");
  return value;
}

const productionDependencies: Dependencies = Object.freeze({
  prepareArtifact: removeArtifact,
  cleanupArtifact: removeArtifact,
  async initializeRuntime() {
    await registerNodeCodexRuntime();
    const capabilityProof = await verifyCodexCliCapabilities(new AbortController().signal);
    const adapter = getCodexCliModelAdapter();
    const result = await adapter.invokeJson(invocation("onboarding.extract", "low", "codex-tools-none@2", "stage-a-version@1", { type: "object", additionalProperties: false, required: ["ok"], properties: { ok: { const: true } } }, "Return only {ok:true}."));
    return Object.freeze({ cliVersion: result.metadata.cliVersion, protocolVersion: result.metadata.protocolVersion, compatibilityPolicy: result.metadata.compatibilityPolicy, model: result.metadata.model, noToolProbe: Object.freeze({ passed: true, webSearchCount: capabilityProof.low.webSearchCount }), discoveryProbe: Object.freeze({ passed: true, webSearchCount: capabilityProof.discovery.webSearchCount }) });
  },
  async runOnboarding() {
    const fixture = await readOnboardingFixture();
    return evaluateOnboardingFixture(fixture, createCodexOnboardingModel(getCodexCliModelAdapter()));
  },
  async runDiscovery() {
    const fixture = await readDiscoveryFixture();
    return evaluateDiscoveryFixture(fixture, createCodexOfficialSourceDiscovery(getCodexCliModelAdapter()));
  },
  async measureConcurrency(requested) {
    const adapter = getCodexCliModelAdapter();
    const ids = Array.from({ length: requested }, (_, index) => `stage-a:${index + 1}`);
    const startedAt = monotonicNow();
    const values = await Promise.all(ids.map(async (id) => {
      const callStartedAt = monotonicNow();
      const result = await adapter.invokeJson(invocation("onboarding.extract", "low", "codex-tools-none@2", "stage-a-echo@1", { type: "object", additionalProperties: false, required: ["jobId"], properties: { jobId: { const: id } } }, `Return only {"jobId":"${id}"}.`));
      const elapsed = monotonicNow() - callStartedAt;
      return Object.freeze({ matches: (result.value as { jobId?: unknown }).jobId === id, elapsed });
    }));
    const elapsedMs = monotonicNow() - startedAt;
    if (values.some((value) => !value.matches)) throw new TypeError("local_codex_stage_a_cross_job_leakage");
    const diagnostics = adapter.runtimeDiagnostics();
    if (diagnostics.activeLeaders !== 0 || diagnostics.queuedFlights !== 0) throw new TypeError("local_codex_stage_a_concurrency_not_terminal");
    const samples = values.map((value) => safeElapsed(value.elapsed));
    const total = safeElapsed(elapsedMs);
    return Object.freeze({ requested, completed: requested, elapsedMs: total, p95Ms: nearestRankP95(samples), throughputMilliJobsPerSecond: Math.floor((requested * 1_000_000) / Math.max(1, total)), effectiveCeiling: diagnostics.effectiveCeiling });
  },
  async proveAbort() {
    const adapter = getCodexCliModelAdapter(); const controller = new AbortController();
    const baseline = adapter.runtimeDiagnostics();
    if (baseline.activeLeaders !== 0 || baseline.queuedFlights !== 0) throw new TypeError("local_codex_stage_a_abort_not_idle");
    const work = adapter.invokeJson(invocation("onboarding.extract", "low", "codex-tools-none@2", "stage-a-abort@1", { type: "object", additionalProperties: false, required: ["ok"], properties: { ok: { const: true } } }, "Return only {ok:true}.", controller.signal));
    await waitFor(() => adapter.runtimeDiagnostics().activeLeaders === baseline.activeLeaders + 1);
    const reason = new DOMException("Stage A abort", "AbortError");
    controller.abort(reason);
    try {
      await work;
    } catch (error) {
      if (error !== reason) throw new TypeError("local_codex_stage_a_abort_reason_mismatch");
      await waitFor(() => {
        const diagnostics = adapter.runtimeDiagnostics();
        return diagnostics.activeLeaders === baseline.activeLeaders && diagnostics.queuedFlights === baseline.queuedFlights;
      });
      const successor = await adapter.invokeJson(invocation("onboarding.extract", "low", "codex-tools-none@2", "stage-a-abort-successor@1", { type: "object", additionalProperties: false, required: ["ok"], properties: { ok: { const: true } } }, "Return only {ok:true}."));
      if ((successor.value as { ok?: unknown }).ok !== true) throw new TypeError("local_codex_stage_a_successor_invalid");
      return Object.freeze({ processGroupTerminated: true, lateResultAccepted: false, waiterRejected: true, leaderTerminalObserved: true });
    }
    throw new TypeError("local_codex_stage_a_late_result");
  },
  async writeArtifact(path, artifact) {
    const absolute = resolve(path); const directory = dirname(absolute);
    if (relative(resolve("data/evals/local-codex-stage-a"), absolute) !== "result.json") throw new TypeError("local_codex_stage_a_invalid_artifact_path");
    await assertSafeArtifactIdentity(absolute, false);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await assertSafeArtifactIdentity(absolute, true);
    await unlink(absolute).catch((error: unknown) => { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; });
    const temporary = resolve(directory, `.local-codex-stage-a-${randomUUID()}.tmp`);
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(temporary, "wx", 0o600);
      await handle.writeFile(`${JSON.stringify(artifact)}\n`, "utf8");
      await handle.sync();
      await handle.close(); handle = undefined;
      await rename(temporary, absolute);
      await chmod(absolute, 0o600);
    } finally {
      await handle?.close().catch(() => undefined);
      await rm(temporary, { force: true });
    }
  },
  now: () => Date.now(),
});

function monotonicNow(): number {
  return Number(process.hrtime.bigint() / 1_000_000n);
}

function safeElapsed(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 3_600_000_000) throw new TypeError("local_codex_stage_a_invalid_clock");
  return value;
}

function nearestRankP95(samples: readonly number[]): number {
  if (samples.length === 0) throw new TypeError("local_codex_stage_a_invalid_metrics");
  const ordered = [...samples].sort((left, right) => left - right);
  return ordered[Math.ceil(ordered.length * 0.95) - 1]!;
}

async function waitFor(predicate: () => boolean, timeoutMs = 10_000): Promise<void> {
  const started = monotonicNow();
  while (!predicate()) {
    if (monotonicNow() - started > timeoutMs) throw new TypeError("local_codex_stage_a_terminal_timeout");
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
}

async function removeArtifact(path: string): Promise<void> {
  const target = resolve(validateArtifactPath(path));
  await assertSafeArtifactIdentity(target, false);
  await unlink(target).catch((error: unknown) => { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; });
}

/** Reject every alias before a mutation; the artifact is intentionally one lexical leaf. */
async function assertSafeArtifactIdentity(target: string, requireParent: boolean): Promise<void> {
  const root = resolve(process.cwd());
  if (!target.startsWith(`${root}/`)) throw new TypeError("local_codex_stage_a_invalid_artifact_path");
  const pieces = relative(root, target).split("/");
  let cursor = root;
  for (let index = 0; index < pieces.length; index += 1) {
    cursor = resolve(cursor, pieces[index]!);
    try {
      const details = await lstat(cursor);
      if (details.isSymbolicLink() || (index === pieces.length - 1 && details.nlink > 1)) throw new TypeError("local_codex_stage_a_invalid_artifact_path");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      if (requireParent && index < pieces.length - 1) throw new TypeError("local_codex_stage_a_invalid_artifact_path");
      return;
    }
  }
}

export async function readOnboardingFixture(): Promise<StageAOnboardingFixture> {
  return parseOnboardingFixture(JSON.parse(await readFile(new URL("./fixtures/local-codex-stage-a/onboarding.json", import.meta.url), "utf8")));
}

export function parseOnboardingFixture(value: unknown): StageAOnboardingFixture {
  try {
    assertOwnedJson(value);
    const root = exactObject(value, ["message", "expected"]);
    const message = exactObject(root.message, ["messageId", "role", "text"]);
    const expectedRoot = exactObject(root.expected, ["schemaVersion", "proposals", "nextQuestion"]);
    if (message.role !== "user" || typeof message.messageId !== "string" || typeof message.text !== "string" || !Array.isArray(expectedRoot.proposals)) throw new TypeError();
    const fixtureProposals = expectedRoot.proposals.map((proposalValue) => {
      const proposal = exactObject(proposalValue, ["fieldId", "typedValue", "messageId", "sourceSpan", "text"]);
      if (typeof proposal.text !== "string") throw new TypeError();
      return Object.freeze(proposal);
    });
    const parsed = parseLocalExtractionOutput({ schemaVersion: expectedRoot.schemaVersion, proposals: fixtureProposals.map((proposal) => ({ fieldId: proposal.fieldId, typedValue: proposal.typedValue, messageId: proposal.messageId, sourceSpan: proposal.sourceSpan })), nextQuestion: expectedRoot.nextQuestion });
    const texts = fixtureProposals.map((proposal) => proposal.text).filter((text): text is string => typeof text === "string");
    if (texts.length !== fixtureProposals.length) throw new TypeError();
    return Object.freeze({ message: Object.freeze({ messageId: message.messageId, role: "user", text: message.text }), expected: Object.freeze({ schemaVersion: parsed.schemaVersion, nextQuestion: parsed.nextQuestion, proposals: parsed.proposals.map((proposal, index) => Object.freeze({ ...proposal, text: texts[index]! })) }) });
  } catch { throw new TypeError("local_codex_stage_a_invalid_fixture"); }
}

export async function readDiscoveryFixture(): Promise<StageADiscoveryFixture> {
  return parseDiscoveryFixture(JSON.parse(await readFile(new URL("./fixtures/local-codex-stage-a/discovery.json", import.meta.url), "utf8")));
}

export function parseDiscoveryFixture(value: unknown): StageADiscoveryFixture {
  try {
    assertOwnedJson(value);
    const root = exactObject(value, ["schemaVersion", "entity", "fact", "failedSource", "authorityRoots", "localeHints", "round", "candidateLimit", "candidatesUntrusted"]);
    if (!Number.isInteger(root.candidateLimit) || typeof root.candidateLimit !== "number" || root.candidateLimit < 1 || root.candidateLimit > 5 || root.candidatesUntrusted !== true) throw new TypeError();
    const request = reconstructOfficialSourceDiscoveryRequest({ schemaVersion: root.schemaVersion, entity: root.entity, fact: root.fact, failedSource: root.failedSource, authorityRoots: root.authorityRoots, localeHints: root.localeHints, round: root.round, signal: new AbortController().signal });
    return Object.freeze({ request: { schemaVersion: request.schemaVersion, entity: request.entity, fact: request.fact, failedSource: request.failedSource, authorityRoots: request.authorityRoots, localeHints: request.localeHints, round: request.round }, candidateLimit: root.candidateLimit, candidatesUntrusted: true });
  } catch { throw new TypeError("local_codex_stage_a_invalid_fixture"); }
}

export async function evaluateOnboardingFixture(fixture: StageAOnboardingFixture, model: Readonly<{ extract(input: { readonly message: SessionMessage; readonly questionnaire: unknown; readonly signal: AbortSignal }): Promise<unknown> }>): Promise<Artifact["onboarding"]> {
  const session = createOnboardingSession({
    nextParticipantId: () => "00000000-0000-4000-8000-000000000001",
    nextCompletionCommandId: () => "00000000-0000-4000-8000-000000000002",
  });
  const output = parseLocalExtractionOutput(await model.extract({ message: fixture.message, questionnaire: projectQuestionnaireForModel(session), signal: new AbortController().signal }));
  const guarded = guardExtraction({ session, userMessage: fixture.message, rawModelOutput: output });
  const actual = output.proposals;
  const expected = fixture.expected.proposals;
  const matched = actual.filter((proposal) => expected.some((entry) => exactProposalMatch(proposal, entry, fixture.message.text))).length;
  if (actual.length !== expected.length || matched !== expected.length || guarded.proposals.length !== expected.length) throw new TypeError("local_codex_stage_a_onboarding_invalid");
  return Object.freeze({ guardedProposalCount: guarded.proposals.length, inventedValueCount: actual.length - matched });
}

export async function evaluateDiscoveryFixture(fixture: StageADiscoveryFixture, port: Readonly<{ discover(input: OfficialSourceDiscoveryRequest): Promise<unknown> }>): Promise<Artifact["discovery"]> {
  const result = exactObject(await port.discover({ ...fixture.request, signal: new AbortController().signal }), ["candidates", "metadata"]);
  const candidates = exactArray(result.candidates);
  const metadata = exactObject(result.metadata, ["invocationVersion", "protocolVersion", "compatibilityPolicy", "cliVersion", "model", "reasoningEffort", "toolPolicy", "templateVersion", "schemaVersion"]);
  if (candidates.length < 1 || candidates.length > fixture.candidateLimit ||
    metadata.invocationVersion !== "codex-cli-invocation@2" || metadata.protocolVersion !== CODEX_CLI_PROTOCOL_VERSION || metadata.compatibilityPolicy !== CODEX_CLI_COMPATIBILITY_POLICY ||
    typeof metadata.cliVersion !== "string" || metadata.model !== CODEX_MODEL || metadata.reasoningEffort !== "medium" || metadata.toolPolicy !== "codex-tools-web-search@1" ||
    metadata.templateVersion !== "official-source-discover@1" || metadata.schemaVersion !== "official-source-candidates@1") throw new TypeError("local_codex_stage_a_discovery_invalid");
  return Object.freeze({ candidateCount: candidates.length, allCandidatesUntrusted: fixture.candidatesUntrusted });
}

function exactProposalMatch(actual: { readonly fieldId: unknown; readonly typedValue: unknown; readonly messageId: unknown; readonly sourceSpan: { readonly start: unknown; readonly end: unknown } }, expected: StageAOnboardingFixture["expected"]["proposals"][number], text: string): boolean {
  return actual.fieldId === expected.fieldId && actual.messageId === expected.messageId && actual.sourceSpan.start === expected.sourceSpan.start && actual.sourceSpan.end === expected.sourceSpan.end &&
    text.slice(expected.sourceSpan.start, expected.sourceSpan.end) === expected.text && JSON.stringify(actual.typedValue) === JSON.stringify(expected.typedValue);
}

function assertOwnedJson(value: unknown): void {
  if (value === null || typeof value !== "object" || types.isProxy(value)) return;
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype || Object.getOwnPropertySymbols(value).length !== 0) throw new TypeError("local_codex_stage_a_invalid_fixture");
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Object.keys(descriptors).length !== value.length + 1) throw new TypeError("local_codex_stage_a_invalid_fixture");
    for (let index = 0; index < value.length; index += 1) { const descriptor = descriptors[String(index)]; if (descriptor?.enumerable !== true || !("value" in descriptor)) throw new TypeError("local_codex_stage_a_invalid_fixture"); assertOwnedJson(descriptor.value); }
    return;
  }
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null || Object.getOwnPropertySymbols(value).length !== 0) throw new TypeError("local_codex_stage_a_invalid_fixture");
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) { if (descriptor.enumerable !== true || !("value" in descriptor)) throw new TypeError("local_codex_stage_a_invalid_fixture"); assertOwnedJson(descriptor.value); }
}

function exactArray(value: unknown): readonly unknown[] {
  assertOwnedJson(value);
  if (!Array.isArray(value)) throw new TypeError("local_codex_stage_a_discovery_invalid");
  return value;
}

function invocation(capability: "onboarding.extract" | "source.discover", reasoningEffort: "low" | "medium", toolPolicy: "codex-tools-none@2" | "codex-tools-web-search@1", templateVersion: string, outputSchema: object, prompt: string, signal = new AbortController().signal) {
  return createCodexJsonInvocation({ capability, reasoningEffort, toolPolicy, templateVersion, schemaVersion: templateVersion, prompt, outputSchema, limits: { timeoutMs: 30_000, maxStdoutBytes: 131_072, maxStderrBytes: 16_384, maxEvents: EVENT_LIMIT }, signal });
}

if (import.meta.main) {
  runLocalCodexStageA(parseLocalCodexStageAArgs(process.argv.slice(2))).then((result) => {
    if (result.stderr !== "") process.stderr.write(result.stderr);
    process.exitCode = result.exitCode;
  }).catch(() => { process.stderr.write("local_codex_stage_a_failed\n"); process.exitCode = 1; });
}
