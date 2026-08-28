import { chmod, mkdir, open, readFile, realpath, rename, rm, unlink } from "node:fs/promises";
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
  concurrency: Readonly<{ requested: readonly [1, 2, 5]; completed: readonly [1, 2, 5]; crossJobLeakage: boolean }>;
  abort: Readonly<{ processGroupTerminated: true; lateResultAccepted: false }>;
}>;

type Dependencies = Readonly<{
  initializeRuntime: () => Promise<Readonly<{
    cliVersion: string; protocolVersion: typeof CODEX_CLI_PROTOCOL_VERSION;
    compatibilityPolicy: typeof CODEX_CLI_COMPATIBILITY_POLICY; model: typeof CODEX_MODEL;
    noToolProbe: Probe; discoveryProbe: Probe;
  }>>;
  runOnboarding: () => Promise<Artifact["onboarding"]>;
  runDiscovery: () => Promise<Artifact["discovery"]>;
  measureConcurrency: (requested: 1 | 2 | 5) => Promise<Readonly<{ completed: 1 | 2 | 5; crossJobLeakage: boolean }>>;
  proveAbort: () => Promise<Artifact["abort"]>;
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
  const runtime = await dependencies.initializeRuntime();
  validateRuntime(runtime);
  const onboarding = await dependencies.runOnboarding();
  const discovery = await dependencies.runDiscovery();
  const one = await dependencies.measureConcurrency(1);
  const two = await dependencies.measureConcurrency(2);
  const five = await dependencies.measureConcurrency(5);
  const abort = await dependencies.proveAbort();
  validateProofs(runtime, onboarding, discovery, [one, two, five], abort);
  const artifact: Artifact = Object.freeze({
    schemaVersion: ARTIFACT_SCHEMA, cliVersion: runtime.cliVersion, protocolVersion: runtime.protocolVersion,
    compatibilityPolicy: runtime.compatibilityPolicy, model: runtime.model, effortsProven: ["low", "medium"] as const,
    noToolProbe: runtime.noToolProbe, discoveryProbe: runtime.discoveryProbe, onboarding, discovery,
    concurrency: Object.freeze({ requested: [1, 2, 5] as const, completed: [1, 2, 5] as const, crossJobLeakage: false }), abort,
  });
  void dependencies.now();
  await dependencies.writeArtifact(ownedArgs.artifactPath, artifact);
  return Object.freeze({ exitCode: 0, stderr: "" });
}

function readArgs(value: unknown): LocalCodexStageAArguments {
  const object = exactObject(value, ["live", "artifactPath"]);
  if (typeof object.live !== "boolean" || typeof object.artifactPath !== "string") throw new TypeError("local_codex_stage_a_invalid_arguments");
  return Object.freeze({ live: object.live, artifactPath: validateArtifactPath(object.artifactPath) });
}

function readDependencies(value: unknown): Dependencies {
  const object = exactObject(value, ["initializeRuntime", "runOnboarding", "runDiscovery", "measureConcurrency", "proveAbort", "writeArtifact", "now"], true);
  return Object.freeze({
    initializeRuntime: functionDependency(object.initializeRuntime, productionDependencies.initializeRuntime),
    runOnboarding: functionDependency(object.runOnboarding, productionDependencies.runOnboarding),
    runDiscovery: functionDependency(object.runDiscovery, productionDependencies.runDiscovery),
    measureConcurrency: functionDependency(object.measureConcurrency, productionDependencies.measureConcurrency),
    proveAbort: functionDependency(object.proveAbort, productionDependencies.proveAbort),
    writeArtifact: functionDependency(object.writeArtifact, productionDependencies.writeArtifact),
    now: functionDependency(object.now, productionDependencies.now),
  });
}

function exactObject(value: unknown, keys: readonly string[], partial = false): Record<string, unknown> {
  if (value === null || typeof value !== "object" || types.isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype || Object.getOwnPropertySymbols(value).length !== 0) throw new TypeError("local_codex_stage_a_invalid_arguments");
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

function validateProofs(runtime: Awaited<ReturnType<Dependencies["initializeRuntime"]>>, onboarding: Artifact["onboarding"], discovery: Artifact["discovery"], concurrency: readonly Readonly<{ completed: number; crossJobLeakage: boolean }>[], abort: Artifact["abort"]): void {
  void runtime;
  if (onboarding.guardedProposalCount !== 4 || onboarding.inventedValueCount !== 0 || !Number.isInteger(discovery.candidateCount) || discovery.candidateCount < 1 || discovery.candidateCount > 5 || discovery.allCandidatesUntrusted !== true || concurrency.length !== 3 || concurrency.some((proof, index) => proof.completed !== [1, 2, 5][index] || proof.crossJobLeakage !== false) || abort.processGroupTerminated !== true || abort.lateResultAccepted !== false) throw new TypeError("local_codex_stage_a_invalid_proof");
}

const productionDependencies: Dependencies = Object.freeze({
  async initializeRuntime() {
    await registerNodeCodexRuntime();
    const capabilityProof = await verifyCodexCliCapabilities(new AbortController().signal);
    const adapter = getCodexCliModelAdapter();
    const result = await adapter.invokeJson(invocation("onboarding.extract", "low", "codex-tools-none@2", "stage-a-version@1", { type: "object", additionalProperties: false, required: ["ok"], properties: { ok: { const: true } } }, "Return only {ok:true}."));
    return Object.freeze({ cliVersion: result.metadata.cliVersion, protocolVersion: result.metadata.protocolVersion, compatibilityPolicy: result.metadata.compatibilityPolicy, model: result.metadata.model, noToolProbe: Object.freeze({ passed: true, webSearchCount: capabilityProof.low.webSearchCount }), discoveryProbe: Object.freeze({ passed: true, webSearchCount: capabilityProof.discovery.webSearchCount }) });
  },
  async runOnboarding() {
    const fixture = await readOnboardingFixture();
    const session = createOnboardingSession({ nextParticipantId: () => "00000000-0000-4000-8000-000000000001", nextCompletionCommandId: () => "00000000-0000-4000-8000-000000000002" });
    const model = createCodexOnboardingModel(getCodexCliModelAdapter());
    const output = await model.extract({ message: fixture.message, questionnaire: projectQuestionnaireForModel(session), signal: new AbortController().signal });
    const guarded = guardExtraction({ session, userMessage: fixture.message, rawModelOutput: output });
    const actual = output.proposals;
    if (actual.length !== fixture.expected.proposals.length || guarded.proposals.length !== 4) throw new TypeError("local_codex_stage_a_onboarding_invalid");
    const matched = actual.filter((proposal, index) => JSON.stringify(proposal) === JSON.stringify(fixture.expected.proposals[index]) && fixture.message.text.slice(proposal.sourceSpan.start, proposal.sourceSpan.end) === fixture.expected.proposals[index]!.text).length;
    if (matched !== 4) throw new TypeError("local_codex_stage_a_onboarding_invalid");
    return Object.freeze({ guardedProposalCount: guarded.proposals.length, inventedValueCount: actual.length - matched });
  },
  async runDiscovery() {
    const fixture = await readDiscoveryFixture();
    const result = await createCodexOfficialSourceDiscovery(getCodexCliModelAdapter()).discover({ ...fixture.request, signal: new AbortController().signal });
    if (result.candidates.length < 1 || result.candidates.length > fixture.candidateLimit || result.metadata.model !== CODEX_MODEL || result.metadata.reasoningEffort !== "medium" || result.metadata.toolPolicy !== "codex-tools-web-search@1") throw new TypeError("local_codex_stage_a_discovery_invalid");
    return Object.freeze({ candidateCount: result.candidates.length, allCandidatesUntrusted: fixture.candidatesUntrusted });
  },
  async measureConcurrency(requested) {
    const adapter = getCodexCliModelAdapter();
    const ids = Array.from({ length: requested }, (_, index) => `stage-a:${index + 1}`);
    const values = await Promise.all(ids.map(async (id) => {
      const result = await adapter.invokeJson(invocation("onboarding.extract", "low", "codex-tools-none@2", "stage-a-echo@1", { type: "object", additionalProperties: false, required: ["jobId"], properties: { jobId: { const: id } } }, `Return only {"jobId":"${id}"}.`));
      return (result.value as { jobId?: unknown }).jobId === id;
    }));
    if (values.some((value) => !value)) throw new TypeError("local_codex_stage_a_cross_job_leakage");
    return Object.freeze({ completed: requested, crossJobLeakage: false });
  },
  async proveAbort() {
    const adapter = getCodexCliModelAdapter(); const controller = new AbortController();
    const work = adapter.invokeJson(invocation("onboarding.extract", "low", "codex-tools-none@2", "stage-a-abort@1", { type: "object", additionalProperties: false, required: ["ok"], properties: { ok: { const: true } } }, "Return only {ok:true}.", controller.signal));
    const reason = new DOMException("Stage A abort", "AbortError");
    controller.abort(reason);
    try {
      await work;
    } catch (error) {
      if (error === reason || error instanceof DOMException && error.name === "AbortError") {
        return Object.freeze({ processGroupTerminated: true, lateResultAccepted: false });
      }
      throw error;
    }
    throw new TypeError("local_codex_stage_a_late_result");
  },
  async writeArtifact(path, artifact) {
    const absolute = resolve(path); const directory = dirname(absolute);
    if (relative(resolve("data/evals/local-codex-stage-a"), absolute) !== "result.json") throw new TypeError("local_codex_stage_a_invalid_artifact_path");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    if (await existingPathIsUnsafe(directory, absolute)) throw new TypeError("local_codex_stage_a_invalid_artifact_path");
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

async function existingPathIsUnsafe(directory: string, target: string): Promise<boolean> {
  try {
    const canonicalDirectory = await realpath(directory);
    const canonicalTarget = await realpath(target);
    return dirname(canonicalTarget) !== canonicalDirectory || canonicalTarget !== resolve(canonicalDirectory, "result.json");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    return true;
  }
}

async function readOnboardingFixture(): Promise<Readonly<{ message: SessionMessage; expected: ReturnType<typeof parseLocalExtractionOutput> & { proposals: readonly (ReturnType<typeof parseLocalExtractionOutput>["proposals"][number] & { text: string })[] } }>> {
  const value: unknown = JSON.parse(await readFile(new URL("./fixtures/local-codex-stage-a/onboarding.json", import.meta.url), "utf8"));
  const root = exactObject(value, ["message", "expected"]);
  const message = exactObject(root.message, ["messageId", "role", "text"]);
  const expectedRoot = exactObject(root.expected, ["schemaVersion", "proposals", "nextQuestion"]);
  if (message.role !== "user" || typeof message.messageId !== "string" || typeof message.text !== "string" || !Array.isArray(expectedRoot.proposals)) throw new TypeError("local_codex_stage_a_invalid_fixture");
  const fixtureProposals = expectedRoot.proposals.map((value) => {
    const proposal = exactObject(value, ["fieldId", "typedValue", "messageId", "sourceSpan", "text"]);
    if (typeof proposal.text !== "string") throw new TypeError("local_codex_stage_a_invalid_fixture");
    return Object.freeze(proposal);
  });
  const parsed = parseLocalExtractionOutput({ schemaVersion: expectedRoot.schemaVersion, proposals: fixtureProposals.map((proposal) => ({ fieldId: proposal.fieldId, typedValue: proposal.typedValue, messageId: proposal.messageId, sourceSpan: proposal.sourceSpan })), nextQuestion: expectedRoot.nextQuestion });
  const texts = fixtureProposals.map((proposal) => proposal.text).filter((text): text is string => typeof text === "string");
  if (texts.length !== fixtureProposals.length) throw new TypeError("local_codex_stage_a_invalid_fixture");
  return Object.freeze({ message: Object.freeze({ messageId: message.messageId, role: "user", text: message.text }), expected: Object.freeze({ ...parsed, proposals: parsed.proposals.map((proposal, index) => Object.freeze({ ...proposal, text: texts[index]! })) }) });
}

async function readDiscoveryFixture(): Promise<Readonly<{ request: Omit<OfficialSourceDiscoveryRequest, "signal">; candidateLimit: number; candidatesUntrusted: true }>> {
  const value: unknown = JSON.parse(await readFile(new URL("./fixtures/local-codex-stage-a/discovery.json", import.meta.url), "utf8"));
  const root = exactObject(value, ["schemaVersion", "entity", "fact", "failedSource", "authorityRoots", "localeHints", "round", "candidateLimit", "candidatesUntrusted"]);
  if (!Number.isInteger(root.candidateLimit) || typeof root.candidateLimit !== "number" || root.candidateLimit < 1 || root.candidateLimit > 5 || root.candidatesUntrusted !== true) throw new TypeError("local_codex_stage_a_invalid_fixture");
  const request = reconstructOfficialSourceDiscoveryRequest({ schemaVersion: root.schemaVersion, entity: root.entity, fact: root.fact, failedSource: root.failedSource, authorityRoots: root.authorityRoots, localeHints: root.localeHints, round: root.round, signal: new AbortController().signal });
  return Object.freeze({ request: { schemaVersion: request.schemaVersion, entity: request.entity, fact: request.fact, failedSource: request.failedSource, authorityRoots: request.authorityRoots, localeHints: request.localeHints, round: request.round }, candidateLimit: root.candidateLimit, candidatesUntrusted: true });
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
