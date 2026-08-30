import { chmod, lstat, mkdir, open, readFile, rename, rm, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, relative, resolve } from "node:path";
import { types } from "node:util";

import { CODEX_CLI_COMPATIBILITY_POLICY, CODEX_CLI_PROTOCOL_VERSION, CODEX_DISCOVERY_MODEL, CODEX_MODEL, CodexRuntimeError, createCodexJsonInvocation, type CodexRuntimeErrorCode } from "../src/infrastructure/codex-cli/contracts";
import { getCodexCliModelAdapter, isTrustedCodexCliCapabilityDiagnosticRecord, verifyCodexCliCapabilitiesForStageADiagnostic, type CodexCliCapabilityDiagnosticObserver, type CodexCliCapabilityDiagnosticRecord } from "../src/infrastructure/codex-cli/runtime";
import { registerNodeCodexRuntime } from "../src/instrumentation-node";
import { REVIEWED_CODEX_EXECUTABLE, verifyReviewedLocalCodexInstallation } from "../src/infrastructure/codex-cli/reviewed-installation";
import { createCodexOnboardingModel } from "../src/infrastructure/codex-cli/onboarding-model";
import { createCodexOfficialSourceDiscovery } from "../src/infrastructure/codex-cli/official-source-discovery";
import { isTrustedNegativeCapabilityDiagnosticRecord, runLocalCodexNegativeCapability, type NegativeCapabilityDiagnosticObserver, type NegativeCapabilityDiagnosticRecord, type NegativeCapabilityTwoPhaseObservation } from "./local-codex-negative-capability";
import { createOnboardingSession } from "../src/decision/onboarding-session";
import { guardExtraction, isOnboardingGuardContractError, projectQuestionnaireForModel } from "../src/decision/onboarding-model-contract";
import { parseLocalExtractionOutput } from "../src/decision/onboarding-model-output";
import type { SessionMessage } from "../src/decision/onboarding-session";
import { OfficialSourceDiscoveryError, reconstructOfficialSourceDiscoveryRequest, type OfficialSourceDiscoveryErrorCode, type OfficialSourceDiscoveryRequest } from "../src/application/official-source-discovery";
import { OnboardingModelError, type OnboardingExtractionAcceptance, type OnboardingExtractionAcceptor, type OnboardingExtractionRetryReason, type OnboardingModelErrorCode } from "../src/application/onboarding-contracts";

const OPT_IN_ERROR = "local_codex_live_opt_in_required\n";
const ARTIFACT_SCHEMA = "local-codex-stage-a@4" as const;
const ARTIFACT_PATH = "data/evals/local-codex-stage-a/result.json";
const EVENT_LIMIT = 128;
const INFORMATIVE_EVIDENCE_TOKEN = /(?:(?:\p{L}\p{M}*){2,}|\p{N}+)/u;
const UNICODE_TOKEN_CONTINUATION_AT_START = /^[\p{L}\p{M}\p{N}]/u;
const UNICODE_TOKEN_CONTINUATION_AT_END = /[\p{L}\p{M}\p{N}]$/u;
const ONBOARDING_ACCEPTED = Object.freeze({ kind: "accepted" as const });
const ONBOARDING_GUARD_RETRY = Object.freeze({ kind: "retryable" as const, reason: "guard_invalid" as const });
const ONBOARDING_CANONICAL_RETRY = Object.freeze({ kind: "retryable" as const, reason: "canonical_mismatch" as const });
const ONBOARDING_EVIDENCE_RETRY = Object.freeze({ kind: "retryable" as const, reason: "evidence_mismatch" as const });

export type LocalCodexStageAArguments = Readonly<{ live: boolean; diagnostic?: true; artifactPath: string }>;
export type LocalCodexStageAEntrypointResult = Readonly<{ exitCode: 0 | 1; stderr: string }>;
type NoToolProbe = Readonly<{ passed: true; webSearchCount: 0 }>;
type DiscoveryProbe = Readonly<{
  availability: "available";
  selection: "model-selected";
  webSearchCount: number;
}>;
type DiscoveryOutcome = "candidate_hints" | "yellow_no_candidate" | "yellow_search_not_performed";
type DiscoveryProof = Readonly<{
  outcome: DiscoveryOutcome;
  candidateCount: number;
  allCandidatesUntrusted: true;
  replacementPublished: false;
}>;
type Artifact = Readonly<{
  schemaVersion: typeof ARTIFACT_SCHEMA;
  cliVersion: string;
  protocolVersion: typeof CODEX_CLI_PROTOCOL_VERSION;
  compatibilityPolicy: typeof CODEX_CLI_COMPATIBILITY_POLICY;
  models: Readonly<{ extraction: typeof CODEX_MODEL; discovery: typeof CODEX_DISCOVERY_MODEL }>;
  writeIsolationProof: Readonly<{ model: typeof CODEX_DISCOVERY_MODEL; toolPolicy: "codex-tools-web-search@2"; codeModeDisabled: true; proofMode: "patch-denial-then-search@1"; patchDenial: NegativeCapabilityTwoPhaseObservation["patchDenial"]; searchOnly: NegativeCapabilityTwoPhaseObservation["searchOnly"] }>;
  effortsProven: readonly ["low", "medium"];
  noToolProbe: NoToolProbe;
  discoveryProbe: DiscoveryProbe;
  onboarding: Readonly<{ guardedProposalCount: number; inventedValueCount: number }>;
  discovery: DiscoveryProof;
  concurrency: Readonly<{ requested: readonly [1, 2, 5]; completed: readonly [1, 2, 5]; crossJobLeakage: false; measurements: readonly [ConcurrencyMeasurement, ConcurrencyMeasurement, ConcurrencyMeasurement] }>;
  abort: Readonly<{ processGroupTerminated: true; lateResultAccepted: false; waiterRejected: true; leaderTerminalObserved: true }>;
}>;

export type ConcurrencyMeasurement = Readonly<{ requested: 1 | 2 | 5; completed: 1 | 2 | 5; elapsedMs: number; p95Ms: number; throughputMilliJobsPerSecond: number; effectiveCeiling: 1 | 3 | 5 }>;
type AbortProof = Readonly<{ processGroupTerminated: boolean; lateResultAccepted: boolean; waiterRejected: boolean; leaderTerminalObserved: boolean }>;
export type StageAAdapterForAbort = Readonly<{
  invokeJson(input: ReturnType<typeof invocation>): Promise<Readonly<{ value: unknown }>>;
  runtimeDiagnostics(): Readonly<{ activeLeaders: number; queuedFlights: number; effectiveCeiling: 1 | 3 | 5 }>;
}>;

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
  runNegativeCapabilityGate: (observer?: NegativeCapabilityDiagnosticObserver) => Promise<NegativeCapabilityTwoPhaseObservation>;
  initializeRuntime: (observer?: CodexCliCapabilityDiagnosticObserver) => Promise<Readonly<{
    cliVersion: string; protocolVersion: typeof CODEX_CLI_PROTOCOL_VERSION;
    compatibilityPolicy: typeof CODEX_CLI_COMPATIBILITY_POLICY; models: Readonly<{ extraction: typeof CODEX_MODEL; discovery: typeof CODEX_DISCOVERY_MODEL }>;
    noToolProbe: NoToolProbe; discoveryProbe: DiscoveryProbe;
  }>>;
  runOnboarding: () => Promise<Artifact["onboarding"]>;
  runDiscovery: () => Promise<DiscoveryProof>;
  measureConcurrency: (requested: 1 | 2 | 5) => Promise<ConcurrencyMeasurement>;
  proveAbort: () => Promise<AbortProof>;
  prepareArtifact: (path: string) => Promise<void>;
  cleanupArtifact: (path: string) => Promise<void>;
  writeArtifact: (path: string, artifact: Artifact) => Promise<void>;
  now: () => number;
}>;

type StageADiagnosticStage = "prepare_artifact" | "negative_capability" | "initialize_runtime" | "onboarding" | "discovery" | "concurrency_1" | "concurrency_2" | "concurrency_5" | "abort" | "proof_validation" | "artifact_write" | "cleanup";
type StageAOnboardingDiagnosticCode = "onboarding_model_output_invalid" | "onboarding_guard_invalid" | "onboarding_canonical_mismatch" | "onboarding_evidence_mismatch";
type StageADiagnosticCode = CodexRuntimeErrorCode | OnboardingModelErrorCode | OfficialSourceDiscoveryErrorCode | StageAOnboardingDiagnosticCode | "discovery_result_invalid" | "unclassified";
type FailureObserver = (stage: StageADiagnosticStage, error: unknown) => void;
const DIAGNOSTIC_CODES: readonly CodexRuntimeErrorCode[] = ["codex_missing", "codex_version_mismatch", "codex_not_authenticated", "codex_protocol_invalid", "codex_tool_event", "codex_search_not_performed", "codex_output_too_large", "codex_event_limit", "codex_timeout", "codex_aborted", "codex_process_failed", "codex_json_invalid", "codex_temp_root_invalid", "codex_tool_isolation_unproven", "codex_rate_limited", "codex_provider_transient"];
const ONBOARDING_MODEL_DIAGNOSTIC_CODES: readonly OnboardingModelErrorCode[] = ["onboarding_model_aborted", "onboarding_model_integrity_failed", "onboarding_model_invalid", "onboarding_model_runtime_failed"];
const STAGE_A_ONBOARDING_DIAGNOSTIC_CODES: readonly StageAOnboardingDiagnosticCode[] = ["onboarding_model_output_invalid", "onboarding_guard_invalid", "onboarding_canonical_mismatch", "onboarding_evidence_mismatch"];
const DISCOVERY_DIAGNOSTIC_CODES: readonly OfficialSourceDiscoveryErrorCode[] = ["official_source_discovery_aborted", "official_source_discovery_integrity_failed", "official_source_discovery_invalid", "official_source_discovery_runtime_failed"];

class StageAOnboardingDiagnosticError extends Error {
  readonly name = "StageAOnboardingDiagnosticError";

  constructor(readonly code: StageAOnboardingDiagnosticCode) {
    super(code);
  }
}
class StageADiscoveryDiagnosticError extends Error {
  readonly name = "StageADiscoveryDiagnosticError";
  readonly code = "discovery_result_invalid" as const;

  constructor() {
    super("discovery_result_invalid");
  }
}

type ReviewedStageARuntimeInitialization<T> = Readonly<{
  executableOverride: string | undefined;
  verifyInstallation: () => Promise<void>;
  registerRuntime: () => Promise<void>;
  consumeSubscription: (observer?: CodexCliCapabilityDiagnosticObserver) => Promise<T>;
}>;

export async function initializeReviewedStageARuntimeForTest<T>(
  input: ReviewedStageARuntimeInitialization<T>,
  observer?: CodexCliCapabilityDiagnosticObserver,
): Promise<T> {
  return initializeReviewedStageARuntime(input, observer);
}

export function parseLocalCodexStageAArgs(argv: readonly string[]): LocalCodexStageAArguments {
  if (!Array.isArray(argv) || types.isProxy(argv)) throw new TypeError("local_codex_stage_a_invalid_arguments");
  let live = false;
  let diagnostic = false;
  let artifactPath = ARTIFACT_PATH;
  let index = 0;
  const first = Object.getOwnPropertyDescriptor(argv, "0");
  if (first?.enumerable === true && "value" in first && first.value === "--") index = 1;
  for (; index < argv.length; index += 1) {
    const value = Object.getOwnPropertyDescriptor(argv, String(index));
    if (value?.enumerable !== true || !("value" in value) || typeof value.value !== "string") throw new TypeError("local_codex_stage_a_invalid_arguments");
    if (value.value === "--live-local-subscription" && !live) { live = true; continue; }
    if (value.value === "--diagnostic" && !diagnostic) { diagnostic = true; continue; }
    if (value.value === "--artifact" && index + 1 < argv.length) {
      const next = Object.getOwnPropertyDescriptor(argv, String(++index));
      if (next?.enumerable !== true || !("value" in next) || typeof next.value !== "string") throw new TypeError("local_codex_stage_a_invalid_arguments");
      artifactPath = next.value;
      continue;
    }
    throw new TypeError("local_codex_stage_a_invalid_arguments");
  }
  if (diagnostic && !live) throw new TypeError("local_codex_stage_a_invalid_arguments");
  return Object.freeze(diagnostic ? { live, diagnostic: true as const, artifactPath: validateArtifactPath(artifactPath) } : { live, artifactPath: validateArtifactPath(artifactPath) });
}

export async function runLocalCodexStageA(
  args: LocalCodexStageAArguments,
  supplied: Partial<Dependencies> = {},
): Promise<LocalCodexStageAEntrypointResult> {
  return runLocalCodexStageAWithFailureObserver(args, supplied);
}

async function runLocalCodexStageAWithFailureObserver(
  args: LocalCodexStageAArguments,
  supplied: Partial<Dependencies>,
  observeFailure?: FailureObserver,
  observeNegativeCapabilityDiagnostic?: (record: NegativeCapabilityDiagnosticRecord) => void,
  observeCapabilityDiagnostic?: (record: CodexCliCapabilityDiagnosticRecord) => void,
): Promise<LocalCodexStageAEntrypointResult> {
  const ownedArgs = readArgs(args);
  if (!ownedArgs.live) return Object.freeze({ exitCode: 1, stderr: OPT_IN_ERROR });
  const dependencies = readDependencies(supplied);
  let stage: StageADiagnosticStage = "prepare_artifact";
  let prepared = false;
  let artifact: Artifact | undefined;
  try {
    // Stale evidence is removed before the first subscription-consuming action.
    await dependencies.prepareArtifact(ownedArgs.artifactPath);
    prepared = true;
    stage = "negative_capability";
    const negativeCapability = ownedArgs.diagnostic === true &&
      dependencies.runNegativeCapabilityGate === productionDependencies.runNegativeCapabilityGate
      ? await dependencies.runNegativeCapabilityGate(observeNegativeCapabilityDiagnostic)
      : await dependencies.runNegativeCapabilityGate();
    const writeIsolationProof = requireWriteIsolationProof(negativeCapability);
    stage = "initialize_runtime";
    const startedAt = strictNow(dependencies.now());
    const runtime = ownedArgs.diagnostic === true &&
      dependencies.initializeRuntime === productionDependencies.initializeRuntime
      ? await dependencies.initializeRuntime(observeCapabilityDiagnostic)
      : await dependencies.initializeRuntime();
    validateRuntime(runtime);
    stage = "onboarding";
    const onboarding = await dependencies.runOnboarding();
    stage = "discovery";
    let discovery: DiscoveryProof;
    try {
      discovery = await dependencies.runDiscovery();
    } catch (error) {
      if (!isExactSearchNotPerformedDiscoveryError(error)) throw error;
      discovery = Object.freeze({ outcome: "yellow_search_not_performed", candidateCount: 0, allCandidatesUntrusted: true, replacementPublished: false });
    }
    stage = "concurrency_1";
    const one = await dependencies.measureConcurrency(1);
    stage = "concurrency_2";
    const two = await dependencies.measureConcurrency(2);
    stage = "concurrency_5";
    const five = await dependencies.measureConcurrency(5);
    stage = "abort";
    const abort = await dependencies.proveAbort();
    stage = "proof_validation";
    validateProofs(runtime, onboarding, discovery, [one, two, five], abort);
    artifact = Object.freeze({
    schemaVersion: ARTIFACT_SCHEMA, cliVersion: runtime.cliVersion, protocolVersion: runtime.protocolVersion,
    compatibilityPolicy: runtime.compatibilityPolicy, models: runtime.models, writeIsolationProof, effortsProven: ["low", "medium"] as const,
    noToolProbe: runtime.noToolProbe, discoveryProbe: runtime.discoveryProbe, onboarding, discovery,
    concurrency: Object.freeze({ requested: [1, 2, 5] as const, completed: [1, 2, 5] as const, crossJobLeakage: false, measurements: [one, two, five] as const }),
    abort: Object.freeze({ processGroupTerminated: true, lateResultAccepted: false, waiterRejected: true, leaderTerminalObserved: true }),
    });
    if (strictNow(dependencies.now()) < startedAt) throw new TypeError("local_codex_stage_a_invalid_clock");
    validateArtifact(artifact);
    stage = "artifact_write";
    await dependencies.writeArtifact(ownedArgs.artifactPath, artifact);
  } catch (error) {
    // A failed gate must never leave a plausible-looking report behind.
    if (!prepared) {
      observeFailure?.(stage, error);
      throw error;
    }
    try {
      await dependencies.cleanupArtifact(ownedArgs.artifactPath);
    } catch (cleanupError) {
      observeFailure?.("cleanup", cleanupError);
      throw cleanupError;
    }
    observeFailure?.(stage, error);
    throw error;
  }
  return Object.freeze({ exitCode: 0, stderr: "" });
}

/** Closed CLI boundary: retains only the reviewed-build mismatch code. */
export async function runLocalCodexStageAEntrypoint(
  argv: readonly string[],
  supplied: Partial<Dependencies> = {},
): Promise<LocalCodexStageAEntrypointResult> {
  try {
    const args = parseLocalCodexStageAArgs(argv);
    let diagnostic: Readonly<{ stage: StageADiagnosticStage; code: StageADiagnosticCode }> | undefined;
    let negativeCapabilityDiagnostic: NegativeCapabilityDiagnosticRecord | undefined;
    let capabilityDiagnostic: CodexCliCapabilityDiagnosticRecord | undefined;
    try {
      return await runLocalCodexStageAWithFailureObserver(args, supplied, (stage, error) => {
        diagnostic = Object.freeze({
          stage,
          code: args.diagnostic ? safeOptInDiagnosticCode(error) : safeDiagnosticCode(error),
        });
      }, args.diagnostic === true ? (record) => {
        if (isTrustedNegativeCapabilityDiagnosticRecord(record)) negativeCapabilityDiagnostic = record;
      } : undefined, args.diagnostic === true ? (record) => {
        if (isTrustedCodexCliCapabilityDiagnosticRecord(record)) capabilityDiagnostic = record;
      } : undefined);
    } catch (error) {
      if (args.diagnostic && diagnostic?.stage === "initialize_runtime" && capabilityDiagnostic !== undefined) {
        return Object.freeze({ exitCode: 1, stderr: `local_codex_stage_a_failed:diagnostic@3:initialize_runtime:${diagnostic.code}:${capabilityDiagnostic.phase}\n` });
      }
      if (args.diagnostic && diagnostic?.stage === "negative_capability" && negativeCapabilityDiagnostic !== undefined) {
        return Object.freeze({ exitCode: 1, stderr: `local_codex_stage_a_failed:diagnostic@2:negative_capability:${negativeCapabilityDiagnostic.phase}:${negativeCapabilityDiagnostic.reason}\n` });
      }
      if (args.diagnostic && diagnostic !== undefined) {
        return Object.freeze({ exitCode: 1, stderr: `local_codex_stage_a_failed:diagnostic@1:${diagnostic.stage}:${diagnostic.code}\n` });
      }
      if (safeDiagnosticCode(error) === "codex_version_mismatch") {
        return Object.freeze({ exitCode: 1, stderr: "local_codex_stage_a_failed:codex_version_mismatch\n" });
      }
      return Object.freeze({ exitCode: 1, stderr: "local_codex_stage_a_failed\n" });
    }
  } catch {
    return Object.freeze({ exitCode: 1, stderr: "local_codex_stage_a_failed\n" });
  }
}

function readArgs(value: unknown): LocalCodexStageAArguments {
  const object = exactObject(value, ["live", "diagnostic", "artifactPath"], true);
  if (typeof object.live !== "boolean" || (object.diagnostic !== undefined && object.diagnostic !== true) || typeof object.artifactPath !== "string" || (object.diagnostic === true && !object.live)) throw new TypeError("local_codex_stage_a_invalid_arguments");
  return Object.freeze(object.diagnostic === true ? { live: object.live, diagnostic: true as const, artifactPath: validateArtifactPath(object.artifactPath) } : { live: object.live, artifactPath: validateArtifactPath(object.artifactPath) });
}

function safeDiagnosticCode(error: unknown): StageADiagnosticCode {
  try {
    if (types.isProxy(error) || !types.isNativeError(error)) return "unclassified";
    const codexCode = exactNativeErrorCode(error, CodexRuntimeError.prototype, "CodexRuntimeError", DIAGNOSTIC_CODES);
    if (codexCode !== undefined) return codexCode as CodexRuntimeErrorCode;
    const onboardingCode = exactNativeErrorCode(error, OnboardingModelError.prototype, "OnboardingModelError", ONBOARDING_MODEL_DIAGNOSTIC_CODES);
    if (onboardingCode !== undefined) {
      const runtimeCode = Object.getOwnPropertyDescriptor(error, "runtimeCode");
      if (runtimeCode?.enumerable !== true || !("value" in runtimeCode)) return "unclassified";
      if (onboardingCode === "onboarding_model_runtime_failed"
        ? !DIAGNOSTIC_CODES.includes(runtimeCode.value as CodexRuntimeErrorCode)
        : runtimeCode.value !== undefined) return "unclassified";
      return onboardingCode as OnboardingModelErrorCode;
    }
    const discoveryCode = exactNativeErrorCode(error, OfficialSourceDiscoveryError.prototype, "OfficialSourceDiscoveryError", DISCOVERY_DIAGNOSTIC_CODES);
    if (discoveryCode !== undefined) {
      const runtimeCode = Object.getOwnPropertyDescriptor(error, "runtimeCode");
      if (discoveryCode === "official_source_discovery_runtime_failed") {
        if (runtimeCode?.enumerable !== true || !("value" in runtimeCode) || typeof runtimeCode.value !== "string" || !DIAGNOSTIC_CODES.includes(runtimeCode.value as CodexRuntimeErrorCode)) return "unclassified";
      } else if (runtimeCode?.enumerable !== true || !("value" in runtimeCode) || runtimeCode.value !== undefined) return "unclassified";
      return discoveryCode as OfficialSourceDiscoveryErrorCode;
    }
    const localCode = exactNativeErrorCode(error, StageAOnboardingDiagnosticError.prototype, "StageAOnboardingDiagnosticError", STAGE_A_ONBOARDING_DIAGNOSTIC_CODES);
    if (localCode !== undefined) return localCode as StageAOnboardingDiagnosticCode;
    return exactNativeErrorCode(error, StageADiscoveryDiagnosticError.prototype, "StageADiscoveryDiagnosticError", ["discovery_result_invalid"]) === undefined ? "unclassified" : "discovery_result_invalid";
  } catch {
    return "unclassified";
  }
}

function isExactSearchNotPerformedDiscoveryError(error: unknown): boolean {
  try {
    if (types.isProxy(error) || !types.isNativeError(error) ||
      Object.getPrototypeOf(error) !== OfficialSourceDiscoveryError.prototype ||
      Object.getOwnPropertySymbols(error).length !== 0) return false;
    const code = Object.getOwnPropertyDescriptor(error, "code");
    const runtimeCode = Object.getOwnPropertyDescriptor(error, "runtimeCode");
    const message = Object.getOwnPropertyDescriptor(error, "message");
    const name = Object.getOwnPropertyDescriptor(error, "name");
    return code?.enumerable === true && "value" in code && code.value === "official_source_discovery_runtime_failed" &&
      runtimeCode?.enumerable === true && "value" in runtimeCode && runtimeCode.value === "codex_search_not_performed" &&
      message?.enumerable === false && "value" in message && message.value === code.value &&
      name?.enumerable === true && "value" in name && name.value === "OfficialSourceDiscoveryError";
  } catch {
    return false;
  }
}

function safeOptInDiagnosticCode(error: unknown): StageADiagnosticCode {
  try {
    if (types.isProxy(error) || !types.isNativeError(error)) return "unclassified";
    const onboardingCode = exactNativeErrorCode(error, OnboardingModelError.prototype, "OnboardingModelError", ONBOARDING_MODEL_DIAGNOSTIC_CODES);
    if (onboardingCode === "onboarding_model_runtime_failed") {
      const runtimeCode = Object.getOwnPropertyDescriptor(error, "runtimeCode");
      if (runtimeCode?.enumerable !== true || !("value" in runtimeCode) || typeof runtimeCode.value !== "string" ||
        !DIAGNOSTIC_CODES.includes(runtimeCode.value as CodexRuntimeErrorCode)) return "unclassified";
      return runtimeCode.value as CodexRuntimeErrorCode;
    }
    const discoveryCode = exactNativeErrorCode(error, OfficialSourceDiscoveryError.prototype, "OfficialSourceDiscoveryError", DISCOVERY_DIAGNOSTIC_CODES);
    if (discoveryCode === "official_source_discovery_runtime_failed") {
      const runtimeCode = Object.getOwnPropertyDescriptor(error, "runtimeCode");
      if (runtimeCode?.enumerable !== true || !("value" in runtimeCode) || typeof runtimeCode.value !== "string" ||
        !DIAGNOSTIC_CODES.includes(runtimeCode.value as CodexRuntimeErrorCode)) return "unclassified";
      return runtimeCode.value as CodexRuntimeErrorCode;
    }
    return safeDiagnosticCode(error);
  } catch {
    return "unclassified";
  }
}

function exactNativeErrorCode(error: Error, prototype: object, expectedName: string, allowlist: readonly string[]): string | undefined {
  if (Object.getPrototypeOf(error) !== prototype || Object.getOwnPropertySymbols(error).length !== 0) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(error, "code");
  const message = Object.getOwnPropertyDescriptor(error, "message");
  const name = Object.getOwnPropertyDescriptor(error, "name");
  if (descriptor?.enumerable !== true || !("value" in descriptor) || typeof descriptor.value !== "string" ||
    message?.enumerable !== false || !("value" in message) || message.value !== descriptor.value ||
    name?.enumerable !== true || !("value" in name) || name.value !== expectedName ||
    !allowlist.includes(descriptor.value)) return undefined;
  return descriptor.value;
}

function readDependencies(value: unknown): Dependencies {
  const object = exactObject(value, ["runNegativeCapabilityGate", "initializeRuntime", "runOnboarding", "runDiscovery", "measureConcurrency", "proveAbort", "prepareArtifact", "cleanupArtifact", "writeArtifact", "now"], true);
  return Object.freeze({
    runNegativeCapabilityGate: functionDependency(object.runNegativeCapabilityGate, productionDependencies.runNegativeCapabilityGate),
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
  if (value.cliVersion !== "codex-cli 0.149.0-alpha.4" || value.protocolVersion !== CODEX_CLI_PROTOCOL_VERSION || value.compatibilityPolicy !== CODEX_CLI_COMPATIBILITY_POLICY || value.models.extraction !== CODEX_MODEL || value.models.discovery !== CODEX_DISCOVERY_MODEL || value.noToolProbe.passed !== true || value.noToolProbe.webSearchCount !== 0 || value.discoveryProbe.availability !== "available" || value.discoveryProbe.selection !== "model-selected" || !Number.isInteger(value.discoveryProbe.webSearchCount) || value.discoveryProbe.webSearchCount < 0 || value.discoveryProbe.webSearchCount > EVENT_LIMIT) throw new TypeError("local_codex_stage_a_invalid_runtime_proof");
}

function validateProofs(runtime: Awaited<ReturnType<Dependencies["initializeRuntime"]>>, onboarding: Artifact["onboarding"], discovery: Artifact["discovery"], concurrency: readonly ConcurrencyMeasurement[], abort: AbortProof): void {
  void runtime;
  if (onboarding.guardedProposalCount !== 4 || onboarding.inventedValueCount !== 0 || !validDiscoveryProof(discovery) || concurrency.length !== 3 || concurrency.some((proof, index) => !validMeasurement(proof, [1, 2, 5][index]!)) || abort.processGroupTerminated !== true || abort.lateResultAccepted !== false || abort.waiterRejected !== true || abort.leaderTerminalObserved !== true) throw new TypeError("local_codex_stage_a_invalid_proof");
}

function requireWriteIsolationProof(value: NegativeCapabilityTwoPhaseObservation): Artifact["writeIsolationProof"] {
  try {
    const observation = exactObject(value, ["schemaVersion", "proofMode", "model", "toolPolicy", "codeModeDisabled", "mode", "stableCode", "passed", "patchDenial", "searchOnly"]);
    if (observation.schemaVersion !== "local-codex-negative-capability-observation@3" || observation.proofMode !== "patch-denial-then-search@1" || observation.model !== CODEX_DISCOVERY_MODEL || observation.toolPolicy !== "codex-tools-web-search@2" || observation.codeModeDisabled !== true || observation.mode !== "strict" || observation.stableCode !== "codex_negative_capability_passed" || observation.passed !== true) throw new TypeError();
    const patchDenial = readPhaseProof(observation.patchDenial, "local-codex-negative-patch-denial@1", { webSearchCompleted: 0, applyPatchAttempts: 1, fileChangeSeen: 2, writePrevented: true });
    const searchOnly = readPhaseProof(observation.searchOnly, "local-codex-negative-search-only@1", { webSearchCompleted: 1, applyPatchAttempts: 0, fileChangeSeen: 0, writePrevented: false });
    return Object.freeze({
      model: CODEX_DISCOVERY_MODEL,
      toolPolicy: "codex-tools-web-search@2",
      codeModeDisabled: true,
      proofMode: "patch-denial-then-search@1",
      patchDenial,
      searchOnly,
    });
  } catch {
    throw new CodexRuntimeError("codex_tool_isolation_unproven");
  }
}

function readPhaseProof(value: unknown, templateVersion: "local-codex-negative-patch-denial@1" | "local-codex-negative-search-only@1", expected: Readonly<{ webSearchCompleted: 0 | 1; applyPatchAttempts: 0 | 1; fileChangeSeen: 0 | 2; writePrevented: boolean }>): NegativeCapabilityTwoPhaseObservation["patchDenial"] {
  const phase = exactObject(value, ["templateVersion", "schemaVersion", "protocolValid", "unknownEventSeen", "webSearchCompleted", "applyPatchAttempts", "fileChangeSeen", "writePrevented", "canaryUnchanged", "childExitClean", "eventTypeCounts"]);
  if (phase.templateVersion !== templateVersion || phase.schemaVersion !== "local-codex-negative-capability-phase-result@1" || phase.protocolValid !== true || phase.unknownEventSeen !== false || phase.webSearchCompleted !== expected.webSearchCompleted || phase.applyPatchAttempts !== expected.applyPatchAttempts || phase.fileChangeSeen !== expected.fileChangeSeen || phase.writePrevented !== expected.writePrevented || phase.canaryUnchanged !== true || phase.childExitClean !== true) throw new TypeError();
  const eventTypeCounts = readSafeEventTypeCounts(phase.eventTypeCounts);
  return Object.freeze({
    templateVersion,
    schemaVersion: "local-codex-negative-capability-phase-result@1",
    protocolValid: true,
    unknownEventSeen: false,
    webSearchCompleted: expected.webSearchCompleted,
    applyPatchAttempts: expected.applyPatchAttempts,
    fileChangeSeen: expected.fileChangeSeen,
    writePrevented: expected.writePrevented,
    canaryUnchanged: true,
    childExitClean: true,
    eventTypeCounts,
  });
}

function readSafeEventTypeCounts(value: unknown): Readonly<Record<string, number>> {
  const labels = ["thread.started", "turn.started", "item.started", "item.completed", "turn.completed", "notice", "reasoning", "agent_message", "file_change", "web_search"] as const;
  const counts = exactObject(value, labels, true);
  const result: Record<string, number> = Object.create(null);
  for (const label of labels) {
    const count = counts[label];
    if (count === undefined) continue;
    if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0 || count > EVENT_LIMIT) throw new TypeError();
    result[label] = count;
  }
  for (const label of ["thread.started", "turn.started", "item.started", "item.completed", "turn.completed"] as const) if (result[label] === undefined) throw new TypeError();
  return Object.freeze(result);
}

function validDiscoveryProof(value: DiscoveryProof): boolean {
  return value.allCandidatesUntrusted === true && value.replacementPublished === false &&
    ((value.outcome === "candidate_hints" && Number.isInteger(value.candidateCount) && value.candidateCount >= 1 && value.candidateCount <= 5) ||
      ((value.outcome === "yellow_no_candidate" || value.outcome === "yellow_search_not_performed") && value.candidateCount === 0));
}

function validMeasurement(value: ConcurrencyMeasurement, requested: number): boolean {
  if (value.requested !== requested || value.completed !== requested || ![1, 3, 5].includes(value.effectiveCeiling) || ![value.elapsedMs, value.p95Ms, value.throughputMilliJobsPerSecond].every((number) => Number.isSafeInteger(number) && number >= 0 && number <= 3_600_000_000) || value.p95Ms > value.elapsedMs) return false;
  return value.throughputMilliJobsPerSecond === throughputMilliJobsPerSecond(requested, value.elapsedMs);
}

function validateArtifact(value: Artifact): void {
  const root = exactObject(value, ["schemaVersion", "cliVersion", "protocolVersion", "compatibilityPolicy", "models", "writeIsolationProof", "effortsProven", "noToolProbe", "discoveryProbe", "onboarding", "discovery", "concurrency", "abort"]);
  if (root.schemaVersion !== ARTIFACT_SCHEMA || typeof root.cliVersion !== "string" || root.protocolVersion !== CODEX_CLI_PROTOCOL_VERSION || root.compatibilityPolicy !== CODEX_CLI_COMPATIBILITY_POLICY) throw new TypeError("local_codex_stage_a_invalid_artifact");
  const efforts = exactArray(root.effortsProven);
  const models = exactObject(root.models, ["extraction", "discovery"]);
  const writeIsolationProof = exactObject(root.writeIsolationProof, ["model", "toolPolicy", "codeModeDisabled", "proofMode", "patchDenial", "searchOnly"]);
  const noTool = exactObject(root.noToolProbe, ["passed", "webSearchCount"]);
  const discoveryProbe = exactObject(root.discoveryProbe, ["availability", "selection", "webSearchCount"]);
  const onboarding = exactObject(root.onboarding, ["guardedProposalCount", "inventedValueCount"]);
  const discovery = exactObject(root.discovery, ["outcome", "candidateCount", "allCandidatesUntrusted", "replacementPublished"]);
  const concurrency = exactObject(root.concurrency, ["requested", "completed", "crossJobLeakage", "measurements"]);
  const abort = exactObject(root.abort, ["processGroupTerminated", "lateResultAccepted", "waiterRejected", "leaderTerminalObserved"]);
  try {
    if (models.extraction !== CODEX_MODEL || models.discovery !== CODEX_DISCOVERY_MODEL || writeIsolationProof.model !== CODEX_DISCOVERY_MODEL || writeIsolationProof.toolPolicy !== "codex-tools-web-search@2" || writeIsolationProof.codeModeDisabled !== true || writeIsolationProof.proofMode !== "patch-denial-then-search@1") throw new TypeError();
    readPhaseProof(writeIsolationProof.patchDenial, "local-codex-negative-patch-denial@1", { webSearchCompleted: 0, applyPatchAttempts: 1, fileChangeSeen: 2, writePrevented: true });
    readPhaseProof(writeIsolationProof.searchOnly, "local-codex-negative-search-only@1", { webSearchCompleted: 1, applyPatchAttempts: 0, fileChangeSeen: 0, writePrevented: false });
  } catch { throw new TypeError("local_codex_stage_a_invalid_artifact"); }
  if (efforts.length !== 2 || efforts[0] !== "low" || efforts[1] !== "medium" || noTool.passed !== true || noTool.webSearchCount !== 0 || discoveryProbe.availability !== "available" || discoveryProbe.selection !== "model-selected" || typeof discoveryProbe.webSearchCount !== "number" || !Number.isSafeInteger(discoveryProbe.webSearchCount) || discoveryProbe.webSearchCount < 0 || discoveryProbe.webSearchCount > EVENT_LIMIT || onboarding.guardedProposalCount !== 4 || onboarding.inventedValueCount !== 0 || !validDiscoveryProof(discovery as DiscoveryProof) || concurrency.crossJobLeakage !== false || abort.processGroupTerminated !== true || abort.lateResultAccepted !== false || abort.waiterRejected !== true || abort.leaderTerminalObserved !== true) throw new TypeError("local_codex_stage_a_invalid_artifact");
  const requested = exactArray(concurrency.requested); const completed = exactArray(concurrency.completed); const measurements = exactArray(concurrency.measurements);
  if (requested.length !== 3 || completed.length !== 3 || measurements.length !== 3 || requested.some((entry, index) => entry !== [1, 2, 5][index]) || completed.some((entry, index) => entry !== [1, 2, 5][index])) throw new TypeError("local_codex_stage_a_invalid_artifact");
  measurements.forEach((measurement, index) => { if (!validMeasurement(exactObject(measurement, ["requested", "completed", "elapsedMs", "p95Ms", "throughputMilliJobsPerSecond", "effectiveCeiling"]) as ConcurrencyMeasurement, [1, 2, 5][index]!)) throw new TypeError("local_codex_stage_a_invalid_artifact"); });
}

function strictNow(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError("local_codex_stage_a_invalid_clock");
  return value;
}

const productionArtifactStore = createStageAArtifactStore({ workspaceRoot: process.cwd() });

const productionDependencies: Dependencies = Object.freeze({
  runNegativeCapabilityGate: (observer) => runLocalCodexNegativeCapability(["--", "--live-local-subscription"], undefined, observer),
  prepareArtifact: productionArtifactStore.prepare,
  cleanupArtifact: productionArtifactStore.cleanup,
  async initializeRuntime(observer) {
    return initializeReviewedStageARuntime({
      executableOverride: process.env.CODEX_EXECUTABLE,
      verifyInstallation: verifyReviewedLocalCodexInstallation,
      registerRuntime: registerNodeCodexRuntime,
      consumeSubscription: async (capabilityObserver) => {
        const capabilityProof = await verifyCodexCliCapabilitiesForStageADiagnostic(new AbortController().signal, capabilityObserver);
        return Object.freeze({ cliVersion: capabilityProof.runtime.cliVersion, protocolVersion: capabilityProof.runtime.protocolVersion, compatibilityPolicy: capabilityProof.runtime.compatibilityPolicy, models: capabilityProof.runtime.models, noToolProbe: Object.freeze({ passed: true, webSearchCount: capabilityProof.low.webSearchCount }), discoveryProbe: Object.freeze({ availability: capabilityProof.discovery.availability, selection: capabilityProof.discovery.selection, webSearchCount: capabilityProof.discovery.webSearchCount }) });
      },
    }, observer);
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
      const result = await adapter.invokeJson(invocation("onboarding.extract", "low", "codex-tools-none@2", "stage-a-echo@1", { type: "object", additionalProperties: false, required: ["jobId"], properties: { jobId: { type: "string", enum: [id] } } }, `Return only {"jobId":"${id}"}.`));
      const elapsed = monotonicNow() - callStartedAt;
      return Object.freeze({ matches: (result.value as { jobId?: unknown }).jobId === id, elapsed });
    }));
    const elapsedMs = monotonicNow() - startedAt;
    if (values.some((value) => !value.matches)) throw new TypeError("local_codex_stage_a_cross_job_leakage");
    const diagnostics = adapter.runtimeDiagnostics();
    if (diagnostics.activeLeaders !== 0 || diagnostics.queuedFlights !== 0) throw new TypeError("local_codex_stage_a_concurrency_not_terminal");
    const samples = values.map((value) => safeElapsed(value.elapsed));
    const total = safeElapsed(elapsedMs);
    return Object.freeze({ requested, completed: requested, elapsedMs: total, p95Ms: nearestRankP95(samples), throughputMilliJobsPerSecond: throughputMilliJobsPerSecond(requested, total), effectiveCeiling: diagnostics.effectiveCeiling });
  },
  async proveAbort() {
    return proveStageAAbort(getCodexCliModelAdapter());
  },
  async writeArtifact(path, artifact) {
    await productionArtifactStore.write(path, artifact);
  },
  now: monotonicNow,
});

async function initializeReviewedStageARuntime<T>(
  input: ReviewedStageARuntimeInitialization<T>,
  observer?: CodexCliCapabilityDiagnosticObserver,
): Promise<T> {
  if (input.executableOverride !== undefined && input.executableOverride !== REVIEWED_CODEX_EXECUTABLE) {
    throw new CodexRuntimeError("codex_version_mismatch");
  }
  await input.verifyInstallation();
  await input.registerRuntime();
  return input.consumeSubscription(observer);
}

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

/** Zero elapsed is reported as zero rather than fabricating an infinite rate. */
function throughputMilliJobsPerSecond(completed: number, elapsedMs: number): number {
  if (elapsedMs === 0) return 0;
  return Math.floor((completed * 1_000_000) / elapsedMs);
}

/**
 * `processGroupTerminated` is derived only after the adapter operation settles
 * and the pool returns to baseline.  The adapter's lower layer already awaits
 * `runBoundedProcess` exit (including TERM/KILL); this gate exposes no process
 * identity and deliberately does not repeat process-layer tests.
 */
export async function proveStageAAbort(
  adapter: StageAAdapterForAbort,
  wait: (predicate: () => boolean) => Promise<void> = waitFor,
): Promise<Readonly<{ processGroupTerminated: true; lateResultAccepted: false; waiterRejected: true; leaderTerminalObserved: true }>> {
  const controller = new AbortController();
  const baseline = adapter.runtimeDiagnostics();
  if (baseline.activeLeaders !== 0 || baseline.queuedFlights !== 0) throw new TypeError("local_codex_stage_a_abort_not_idle");
  const work = adapter.invokeJson(invocation("onboarding.extract", "low", "codex-tools-none@2", "stage-a-abort@1", { type: "object", additionalProperties: false, required: ["ok"], properties: { ok: { type: "boolean", enum: [true] } } }, "Return only {ok:true}.", controller.signal));
  await wait(() => adapter.runtimeDiagnostics().activeLeaders === baseline.activeLeaders + 1);
  const reason = new DOMException("Stage A abort", "AbortError");
  controller.abort(reason);
  try {
    await work;
  } catch (error) {
    if (error !== reason) throw new TypeError("local_codex_stage_a_abort_reason_mismatch");
    await wait(() => {
      const diagnostics = adapter.runtimeDiagnostics();
      return diagnostics.activeLeaders === baseline.activeLeaders && diagnostics.queuedFlights === baseline.queuedFlights;
    });
    const successor = await adapter.invokeJson(invocation("onboarding.extract", "low", "codex-tools-none@2", "stage-a-abort-successor@1", { type: "object", additionalProperties: false, required: ["ok"], properties: { ok: { type: "boolean", enum: [true] } } }, "Return only {ok:true}."));
    if ((successor.value as { ok?: unknown }).ok !== true) throw new TypeError("local_codex_stage_a_successor_invalid");
    return Object.freeze({ processGroupTerminated: true, lateResultAccepted: false, waiterRejected: true, leaderTerminalObserved: true });
  }
  throw new TypeError("local_codex_stage_a_late_result");
}

async function waitFor(predicate: () => boolean, timeoutMs = 10_000): Promise<void> {
  const started = monotonicNow();
  while (!predicate()) {
    if (monotonicNow() - started > timeoutMs) throw new TypeError("local_codex_stage_a_terminal_timeout");
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
}

export type StageAArtifactStore = Readonly<{ prepare(path: string): Promise<void>; cleanup(path: string): Promise<void>; write(path: string, artifact: Artifact): Promise<void> }>;

export function createStageAArtifactStore(options: Readonly<{ workspaceRoot: string; randomId?: () => string }>): StageAArtifactStore {
  const root = resolve(options.workspaceRoot);
  const randomId = options.randomId ?? randomUUID;
  const targetFor = (path: string): string => {
    if (path !== ARTIFACT_PATH || path.includes("\0")) throw new TypeError("local_codex_stage_a_invalid_artifact_path");
    const target = resolve(root, path);
    if (relative(root, target) !== ARTIFACT_PATH) throw new TypeError("local_codex_stage_a_invalid_artifact_path");
    return target;
  };
  const remove = async (path: string): Promise<void> => {
    const target = targetFor(path);
    await assertSafeArtifactIdentity(root, target, false);
    await unlink(target).catch((error: unknown) => { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; });
  };
  return Object.freeze({
    prepare: remove,
    cleanup: remove,
    async write(path, artifact) {
      validateArtifact(artifact);
      const absolute = targetFor(path); const directory = dirname(absolute);
      await assertSafeArtifactIdentity(root, absolute, false);
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await assertSafeArtifactIdentity(root, absolute, true);
      await unlink(absolute).catch((error: unknown) => { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; });
      const temporary = resolve(directory, `.local-codex-stage-a-${randomId()}.tmp`);
      if (dirname(temporary) !== directory) throw new TypeError("local_codex_stage_a_invalid_artifact_path");
      let handle: Awaited<ReturnType<typeof open>> | undefined;
      let temporaryOwned = false;
      try {
        handle = await open(temporary, "wx", 0o600);
        temporaryOwned = true;
        await handle.writeFile(`${JSON.stringify(artifact)}\n`, "utf8");
        await handle.sync();
        await handle.close(); handle = undefined;
        await rename(temporary, absolute);
        await chmod(absolute, 0o600);
      } finally {
        await handle?.close().catch(() => undefined);
        if (temporaryOwned) await rm(temporary, { force: true });
      }
    },
  });
}

/** Reject every alias before a mutation; the artifact is intentionally one lexical leaf. */
async function assertSafeArtifactIdentity(root: string, target: string, requireParent: boolean): Promise<void> {
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
    const messageId = message.messageId;
    const messageText = message.text;
    const fixtureProposals = expectedRoot.proposals.map((proposalValue) => {
      const proposal = exactObject(proposalValue, ["fieldId", "typedValue", "messageId", "sourceSpan", "text"]);
      if (typeof proposal.text !== "string") throw new TypeError();
      return Object.freeze(proposal);
    });
    const parsed = parseLocalExtractionOutput({ schemaVersion: expectedRoot.schemaVersion, proposals: fixtureProposals.map((proposal) => ({ fieldId: proposal.fieldId, typedValue: proposal.typedValue, messageId: proposal.messageId, sourceSpan: proposal.sourceSpan })), nextQuestion: expectedRoot.nextQuestion });
    const texts = fixtureProposals.map((proposal) => proposal.text).filter((text): text is string => typeof text === "string");
    if (texts.length !== fixtureProposals.length) throw new TypeError();
    const proposals = parsed.proposals.map((proposal, index) => {
      const text = texts[index]!;
      if (proposal.messageId !== messageId ||
        proposal.sourceSpan.start >= proposal.sourceSpan.end ||
        proposal.sourceSpan.end > messageText.length ||
        messageText.slice(proposal.sourceSpan.start, proposal.sourceSpan.end) !== text) {
        throw new TypeError();
      }
      return {
        ...proposal,
        sourceSpan: { ...proposal.sourceSpan },
        text,
      };
    });
    return deepFreeze({
      message: { messageId, role: "user" as const, text: messageText },
      expected: {
        schemaVersion: parsed.schemaVersion,
        nextQuestion: parsed.nextQuestion,
        proposals,
      },
    });
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

export async function evaluateOnboardingFixture(fixture: StageAOnboardingFixture, model: Readonly<{ extract(input: { readonly message: SessionMessage; readonly questionnaire: unknown; readonly signal: AbortSignal; readonly acceptExtraction?: OnboardingExtractionAcceptor }): Promise<unknown> }>): Promise<Artifact["onboarding"]> {
  const oracle = parseOnboardingFixture(fixture);
  const session = createOnboardingSession({
    nextParticipantId: () => "00000000-0000-4000-8000-000000000001",
    nextCompletionCommandId: () => "00000000-0000-4000-8000-000000000002",
  });
  requireValidOnboardingOracle(oracle, session);
  let exhaustedRetryReason: OnboardingExtractionRetryReason | undefined;
  let rawOutput: unknown;
  try {
    rawOutput = await model.extract({
      message: oracle.message,
      questionnaire: projectQuestionnaireForModel(session),
      signal: new AbortController().signal,
      acceptExtraction: (candidate, attempt) => {
        const acceptance = classifyOnboardingFixtureCandidate(oracle, session, candidate);
        if (attempt.attempt === "retry") {
          exhaustedRetryReason = acceptance.kind === "retryable" ? acceptance.reason : undefined;
        }
        return acceptance;
      },
    });
  } catch (error) {
    if (exhaustedRetryReason !== undefined && isExactOnboardingModelInvalid(error)) {
      throw new StageAOnboardingDiagnosticError(stageADiagnosticForRetryReason(exhaustedRetryReason));
    }
    throw error;
  }
  const output = onboardingDiagnosticBoundary("onboarding_model_output_invalid", () => parseLocalExtractionOutput(rawOutput));
  const guarded = onboardingDiagnosticBoundary("onboarding_guard_invalid", () => guardExtraction({ session, userMessage: oracle.message, rawModelOutput: output }));
  onboardingDiagnosticBoundary("onboarding_canonical_mismatch", () => assertGuardedFixtureProposals(oracle, guarded.proposals));
  onboardingDiagnosticBoundary("onboarding_evidence_mismatch", () => assertFixtureEvidenceCoverage(oracle, output.proposals));
  return Object.freeze({ guardedProposalCount: guarded.proposals.length, inventedValueCount: 0 });
}

function requireValidOnboardingOracle(
  fixture: StageAOnboardingFixture,
  session: ReturnType<typeof createOnboardingSession>,
): void {
  try {
    const output = fixtureExtractionOutput(fixture);
    const guarded = guardExtraction({
      session,
      userMessage: fixture.message,
      rawModelOutput: output,
    });
    assertGuardedFixtureProposals(fixture, guarded.proposals);
    assertFixtureEvidenceCoverage(fixture, output.proposals);
  } catch {
    throw new TypeError("local_codex_stage_a_invalid_fixture");
  }
}

function classifyOnboardingFixtureCandidate(
  fixture: StageAOnboardingFixture,
  session: ReturnType<typeof createOnboardingSession>,
  candidate: unknown,
): OnboardingExtractionAcceptance {
  const output = parseLocalExtractionOutput(candidate);
  let guarded: ReturnType<typeof guardExtraction>;
  try {
    guarded = guardExtraction({
      session,
      userMessage: fixture.message,
      rawModelOutput: output,
    });
  } catch (error) {
    if (!isOnboardingGuardContractError(error)) throw error;
    return ONBOARDING_GUARD_RETRY;
  }
  try {
    assertGuardedFixtureProposals(fixture, guarded.proposals);
  } catch (error) {
    if (!isExactStageAOnboardingError(error)) throw error;
    return ONBOARDING_CANONICAL_RETRY;
  }
  try {
    assertFixtureEvidenceCoverage(fixture, output.proposals);
  } catch (error) {
    if (!isExactStageAOnboardingError(error)) throw error;
    return ONBOARDING_EVIDENCE_RETRY;
  }
  return ONBOARDING_ACCEPTED;
}

function fixtureExtractionOutput(
  fixture: StageAOnboardingFixture,
): ReturnType<typeof parseLocalExtractionOutput> {
  return parseLocalExtractionOutput({
    schemaVersion: fixture.expected.schemaVersion,
    proposals: fixture.expected.proposals.map((proposal) => ({
      fieldId: proposal.fieldId,
      typedValue: proposal.typedValue,
      messageId: proposal.messageId,
      sourceSpan: proposal.sourceSpan,
    })),
    nextQuestion: fixture.expected.nextQuestion,
  });
}

function isExactStageAOnboardingError(error: unknown): boolean {
  try {
    if (error === null || typeof error !== "object" ||
      Object.getPrototypeOf(error) !== TypeError.prototype ||
      Object.getOwnPropertySymbols(error).length !== 0) return false;
    const message = Object.getOwnPropertyDescriptor(error, "message");
    return message !== undefined && "value" in message &&
      message.value === "local_codex_stage_a_onboarding_invalid";
  } catch {
    return false;
  }
}

function isExactOnboardingModelInvalid(error: unknown): boolean {
  return safeDiagnosticCode(error) === "onboarding_model_invalid";
}

function stageADiagnosticForRetryReason(
  reason: OnboardingExtractionRetryReason,
): StageAOnboardingDiagnosticCode {
  if (reason === "guard_invalid") return "onboarding_guard_invalid";
  if (reason === "canonical_mismatch") return "onboarding_canonical_mismatch";
  return "onboarding_evidence_mismatch";
}

function onboardingDiagnosticBoundary<T>(code: StageAOnboardingDiagnosticCode, operation: () => T): T {
  try {
    return operation();
  } catch {
    throw new StageAOnboardingDiagnosticError(code);
  }
}

function assertFixtureEvidenceCoverage(
  fixture: StageAOnboardingFixture,
  actual: readonly Readonly<{ fieldId: string; messageId: string; sourceSpan: Readonly<{ start: number; end: number }> }>[],
): void {
  for (const expected of fixture.expected.proposals) {
    if (expected.sourceSpan.start >= expected.sourceSpan.end || expected.sourceSpan.end > fixture.message.text.length ||
      fixture.message.text.slice(expected.sourceSpan.start, expected.sourceSpan.end) !== expected.text) {
      throw new TypeError("local_codex_stage_a_onboarding_invalid");
    }
    const proposal = actual.find(({ fieldId }) => fieldId === expected.fieldId);
    if (proposal === undefined || proposal.messageId !== expected.messageId) {
      throw new TypeError("local_codex_stage_a_onboarding_invalid");
    }
    const overlap = Math.max(0, Math.min(proposal.sourceSpan.end, expected.sourceSpan.end) - Math.max(proposal.sourceSpan.start, expected.sourceSpan.start));
    const shorter = Math.min(proposal.sourceSpan.end - proposal.sourceSpan.start, expected.sourceSpan.end - expected.sourceSpan.start);
    const evidence = fixture.message.text.slice(proposal.sourceSpan.start, proposal.sourceSpan.end);
    const splitsToken = splitsUnicodeTokenAt(fixture.message.text, proposal.sourceSpan.start) ||
      splitsUnicodeTokenAt(fixture.message.text, proposal.sourceSpan.end);
    if (overlap === 0 || overlap * 2 < shorter || splitsToken || !INFORMATIVE_EVIDENCE_TOKEN.test(evidence)) {
      throw new TypeError("local_codex_stage_a_onboarding_invalid");
    }
  }
}

function splitsUnicodeTokenAt(text: string, offset: number): boolean {
  return offset > 0 && offset < text.length &&
    UNICODE_TOKEN_CONTINUATION_AT_END.test(text.slice(0, offset)) &&
    UNICODE_TOKEN_CONTINUATION_AT_START.test(text.slice(offset));
}

export async function evaluateDiscoveryFixture(fixture: StageADiscoveryFixture, port: Readonly<{ discover(input: OfficialSourceDiscoveryRequest): Promise<unknown> }>): Promise<Artifact["discovery"]> {
  const rawResult = await port.discover({ ...fixture.request, signal: new AbortController().signal });
  try {
    const result = exactObject(rawResult, ["candidates", "metadata"]);
    const candidates = exactArray(result.candidates);
    const metadata = exactObject(result.metadata, ["invocationVersion", "protocolVersion", "compatibilityPolicy", "cliVersion", "model", "reasoningEffort", "toolPolicy", "templateVersion", "schemaVersion"]);
    if (candidates.length > fixture.candidateLimit ||
      metadata.invocationVersion !== "codex-cli-invocation@2" || metadata.protocolVersion !== CODEX_CLI_PROTOCOL_VERSION || metadata.compatibilityPolicy !== CODEX_CLI_COMPATIBILITY_POLICY ||
      typeof metadata.cliVersion !== "string" || metadata.model !== CODEX_DISCOVERY_MODEL || metadata.reasoningEffort !== "medium" || metadata.toolPolicy !== "codex-tools-web-search@2" ||
      metadata.templateVersion !== "official-source-discover@4" || metadata.schemaVersion !== "official-source-candidates@1") throw new TypeError("local_codex_stage_a_discovery_invalid");
    return Object.freeze(candidates.length === 0
      ? { outcome: "yellow_no_candidate" as const, candidateCount: 0, allCandidatesUntrusted: fixture.candidatesUntrusted, replacementPublished: false as const }
      : { outcome: "candidate_hints" as const, candidateCount: candidates.length, allCandidatesUntrusted: fixture.candidatesUntrusted, replacementPublished: false as const });
  } catch {
    throw new StageADiscoveryDiagnosticError();
  }
}

/** Independently derives the documented guarded shape from the fixture's raw model proposal. */
export function assertGuardedFixtureProposals(fixture: StageAOnboardingFixture, guarded: unknown): void {
  const proposals = ownedArray(guarded, "local_codex_stage_a_onboarding_invalid");
  if (proposals.length !== fixture.expected.proposals.length) throw new TypeError("local_codex_stage_a_onboarding_invalid");
  for (let index = 0; index < proposals.length; index += 1) {
    if (!equalOwnedJson(proposals[index], expectedGuardedProposal(fixture.expected.proposals[index]!))) {
      throw new TypeError("local_codex_stage_a_onboarding_invalid");
    }
  }
}

function expectedGuardedProposal(proposal: StageAOnboardingFixture["expected"]["proposals"][number]): object {
  if (proposal.fieldId === "participants") return { kind: "participant_roster", roster: proposal.typedValue };
  const participant = /^participants\.(self|companion\.(?:0|[1-9][0-9]*))\.([a-z_]+)$/.exec(proposal.fieldId);
  if (participant !== null) return { kind: "participant_leaf", descriptor: participant[1]!, leafId: participant[2]!, normalizedValue: proposal.typedValue };
  return { kind: "non_participant_field", fieldId: proposal.fieldId, normalizedValue: proposal.typedValue };
}

function equalOwnedJson(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (left === null || right === null || typeof left !== "object" || typeof right !== "object" || types.isProxy(left) || types.isProxy(right)) return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) return false;
    const leftValues = ownedArray(left, "local_codex_stage_a_onboarding_invalid");
    const rightValues = ownedArray(right, "local_codex_stage_a_onboarding_invalid");
    return leftValues.length === rightValues.length && leftValues.every((value, index) => equalOwnedJson(value, rightValues[index]));
  }
  if (!ownedRecord(left) || !ownedRecord(right)) return false;
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return leftKeys.length === rightKeys.length && leftKeys.every((key, index) => key === rightKeys[index] && equalOwnedJson(left[key], right[key]));
}

function ownedArray(value: unknown, code: string): readonly unknown[] {
  if (!Array.isArray(value) || types.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype || Object.getOwnPropertySymbols(value).length !== 0) throw new TypeError(code);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.keys(descriptors).length !== value.length + 1) throw new TypeError(code);
  const copy: unknown[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (descriptor?.enumerable !== true || !("value" in descriptor)) throw new TypeError(code);
    copy.push(descriptor.value);
  }
  return copy;
}

function ownedRecord(value: object): value is Record<string, unknown> {
  if (types.isProxy(value) || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) || Object.getOwnPropertySymbols(value).length !== 0) return false;
  return Object.values(Object.getOwnPropertyDescriptors(value)).every((descriptor) => descriptor.enumerable === true && "value" in descriptor);
}

function assertOwnedJson(value: unknown): void {
  if (value === null || typeof value !== "object") return;
  if (types.isProxy(value)) throw new TypeError("local_codex_stage_a_invalid_fixture");
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

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function exactArray(value: unknown): readonly unknown[] {
  assertOwnedJson(value);
  if (!Array.isArray(value)) throw new TypeError("local_codex_stage_a_discovery_invalid");
  return value;
}

function invocation(capability: "onboarding.extract" | "source.discover", reasoningEffort: "low" | "medium", toolPolicy: "codex-tools-none@2" | "codex-tools-web-search@2", templateVersion: string, outputSchema: object, prompt: string, signal = new AbortController().signal) {
  return createCodexJsonInvocation({ capability, reasoningEffort, toolPolicy, templateVersion, schemaVersion: templateVersion, prompt, outputSchema, limits: { timeoutMs: 30_000, maxStdoutBytes: 131_072, maxStderrBytes: 16_384, maxEvents: EVENT_LIMIT }, signal });
}

if (import.meta.main) {
  runLocalCodexStageAEntrypoint(process.argv.slice(2)).then((result) => {
    if (result.stderr !== "") process.stderr.write(result.stderr);
    process.exitCode = result.exitCode;
  });
}
