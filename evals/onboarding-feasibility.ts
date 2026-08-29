import { createHash, randomUUID } from "node:crypto";
import { chmod, open, readFile, realpath, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { types } from "node:util";

import {
  OnboardingModelError,
  type OnboardingModelErrorCode,
  type OnboardingModelPort,
  type OnboardingRuntimeErrorCode,
} from "../src/application/onboarding-contracts";
import {
  ONBOARDING_MODEL_VERSIONS_V10,
  reconstructOnboardingModelVersions,
  type OnboardingModelVersionsV10,
} from "../src/application/onboarding-model-versions";
import {
  PARTICIPANT_LEAF_IDS,
  PARTICIPANT_RELATIONSHIPS,
  QUESTIONNAIRE_ISSUE_CODES,
  type ParticipantDescriptor,
  type ParticipantLeafId,
  type ParticipantRosterProposal,
  type QuestionnaireIssueCode,
} from "../src/decision/onboarding-catalog";
import {
  corroborateModelReview,
  guardExtraction,
  projectQuestionnaireForModel,
  type GuardedExtractionProposal,
} from "../src/decision/onboarding-model-contract";
import {
  applySessionFieldChange,
  createOnboardingSession,
  reconstructOnboardingSessionState,
  type OnboardingSessionState,
  type SessionMessage,
} from "../src/decision/onboarding-session";
import {
  cloneOnboardingFieldValueForDecision,
  parseOnboardingFieldIdForDecision,
  type OnboardingFieldId,
  type QuestionnaireFieldChange,
  type QuestionnaireIssue,
} from "../src/decision/onboarding-questionnaire";
import { registerNodeCodexRuntime } from "../src/instrumentation-node";
import { getCodexCliModelAdapter } from "../src/infrastructure/codex-cli/runtime";
import { snapshotOwnedJson, type JsonObject, type JsonValue } from "../src/infrastructure/codex-cli/owned-json";
import {
  createCodexOnboardingModel,
  ONBOARDING_EXTRACTION_LIMITS,
  ONBOARDING_EXTRACTION_PROMPT_TEMPLATE,
  ONBOARDING_REVIEW_LIMITS,
  ONBOARDING_REVIEW_PROMPT_TEMPLATE,
} from "../src/infrastructure/codex-cli/onboarding-model";
import {
  ONBOARDING_EXTRACTION_SCHEMA,
  ONBOARDING_REVIEW_SCHEMA,
} from "../src/infrastructure/codex-cli/onboarding-schema";

const FIXTURE_VERSION = "onboarding-cases@1" as const;
const SESSION_SEED_VERSION = "onboarding-feasibility-session-seed@1" as const;
const ARTIFACT_VERSION = "onboarding-model-feasibility@4" as const;
const DIAGNOSTIC_VERSION = "onboarding-model-feasibility-diagnostic@3" as const;
const FEASIBILITY_FIXTURE_URL = new URL("./fixtures/onboarding/cases.json", import.meta.url);
const FEASIBILITY_FIXTURE_PATH = resolve(fileURLToPath(FEASIBILITY_FIXTURE_URL));
const CASE_IDS = [
  "extract_self_ru",
  "extract_companion",
  "extract_zero_unusual_iso",
  "extract_unknown",
  "extract_correction",
  "extract_prompt_injection",
  "review_final_blockers",
] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const PARTICIPANT_DESCRIPTOR = /^(?:self|companion\.(?:0|[1-9][0-9]*))$/;
const PARTICIPANT_ID = "00000000-0000-4000-8000-000000000001";
const PARTICIPANT_LEAF_SET = new Set<string>(PARTICIPANT_LEAF_IDS);
const RELATIONSHIP_SET = new Set<string>(PARTICIPANT_RELATIONSHIPS);
const ISSUE_CODE_SET = new Set<string>(QUESTIONNAIRE_ISSUE_CODES);
const MAX_CASES = CASE_IDS.length;
const MAX_CHANGES = 172;
const MAX_EXPECTED_VALUES = 172;
const NATIVE_ABORTED_GETTER = Object.getOwnPropertyDescriptor(AbortSignal.prototype, "aborted")?.get;
const FINAL_PROJECT_LIVE_MODEL_GATE_FLAG = "--final-project-live-model-gate";
const LIVE_MODEL_GATE_DEFERRED = "onboarding_live_model_gate_deferred\n";
const FEASIBILITY_FAILURE = "onboarding_model_feasibility_failed\n";

interface SessionSeed {
  readonly schemaVersion: typeof SESSION_SEED_VERSION;
  readonly initialParticipantId: string;
  readonly initialCompletionCommandId: string;
  readonly nextCompletionCommandIds: readonly string[];
  readonly changes: readonly Extract<QuestionnaireFieldChange, { readonly kind: "manual_set" }>[];
}

interface ExtractionCase {
  readonly caseId: (typeof CASE_IDS)[number];
  readonly kind: "extract";
  readonly sessionSeed: SessionSeed;
  readonly userMessage: SessionMessage;
  readonly expectedProposals: readonly GuardedExtractionProposal[];
}

interface ReviewCase {
  readonly caseId: "review_final_blockers";
  readonly kind: "review";
  readonly sessionSeed: SessionSeed;
  readonly expectedIssues: readonly QuestionnaireIssue[];
}

type FeasibilityCase = ExtractionCase | ReviewCase;

export interface OnboardingFeasibilityFixture {
  readonly fixtureVersion: typeof FIXTURE_VERSION;
  readonly cases: readonly FeasibilityCase[];
}

export interface OnboardingModelFeasibilityArtifact {
  readonly schemaVersion: typeof ARTIFACT_VERSION;
  readonly fixtureVersion: typeof FIXTURE_VERSION;
  readonly fixtureDigest: string;
  readonly invocationVersion: OnboardingModelVersionsV10["invocation"];
  readonly protocolVersion: "codex-cli-protocol@2";
  readonly model: "gpt-5.6-terra";
  readonly reasoningEffort: "low";
  readonly toolPolicy: "codex-tools-none@2";
  readonly cliVersion: OnboardingModelVersionsV10["cliVersion"];
  readonly extractionPromptVersion: OnboardingModelVersionsV10["extractionPrompt"];
  readonly reviewPromptVersion: OnboardingModelVersionsV10["reviewPrompt"];
  readonly extractionSchemaVersion: OnboardingModelVersionsV10["extractionSchema"];
  readonly reviewSchemaVersion: OnboardingModelVersionsV10["reviewSchema"];
  readonly extractionPromptDigest: string;
  readonly reviewPromptDigest: string;
  readonly extractionSchemaDigest: string;
  readonly reviewSchemaDigest: string;
  readonly extractionLimits: typeof ONBOARDING_EXTRACTION_LIMITS;
  readonly reviewLimits: typeof ONBOARDING_REVIEW_LIMITS;
  readonly caseResults: readonly {
    readonly caseId: string;
    readonly status: "passed";
    readonly elapsedMs: number;
  }[];
  readonly rawPromptStored: false;
  readonly rawOutputStored: false;
  readonly transcriptStored: false;
  readonly artifactDigest: string;
}

export type OnboardingFeasibilityStage =
  | "input_validation"
  | "runtime_initialization"
  | "extract_model"
  | "extract_semantic"
  | "review_model"
  | "review_semantic"
  | "artifact_write";

export interface OnboardingModelFeasibilityDiagnostic {
  readonly schemaVersion: typeof DIAGNOSTIC_VERSION;
  readonly fixtureVersion: typeof FIXTURE_VERSION;
  readonly caseId: string | null;
  readonly stage: OnboardingFeasibilityStage;
  readonly errorCode: OnboardingModelErrorCode | "onboarding_model_feasibility_failed";
  readonly runtimeCode: OnboardingRuntimeErrorCode | null;
  readonly passingArtifactPresent: false;
  readonly diagnosticDigest: string;
}

export class OnboardingFeasibilityError extends Error {
  readonly name = "OnboardingFeasibilityError";

  constructor() {
    super("onboarding_model_feasibility_failed");
  }
}

export type OnboardingFeasibilityLaunchMode =
  | "deferred"
  | "final-project-live-model-gate";

export interface OnboardingFeasibilityLaunchArguments {
  readonly mode: OnboardingFeasibilityLaunchMode;
  readonly artifactPath: string;
  readonly diagnosticPath: string;
}

export type OnboardingFeasibilityEntrypointResult =
  | Readonly<{ exitCode: 0; stdout: ""; stderr: "" }>
  | Readonly<{
      exitCode: 1;
      stdout: "";
      stderr:
        | "onboarding_live_model_gate_deferred\n"
        | "onboarding_model_feasibility_failed\n";
    }>;

const FEASIBILITY_SUCCESS_RESULT: OnboardingFeasibilityEntrypointResult = Object.freeze({
  exitCode: 0,
  stdout: "",
  stderr: "",
});
const FEASIBILITY_DEFERRED_RESULT: OnboardingFeasibilityEntrypointResult = Object.freeze({
  exitCode: 1,
  stdout: "",
  stderr: LIVE_MODEL_GATE_DEFERRED,
});
const FEASIBILITY_FAILURE_RESULT: OnboardingFeasibilityEntrypointResult = Object.freeze({
  exitCode: 1,
  stdout: "",
  stderr: FEASIBILITY_FAILURE,
});

export function readOnboardingFeasibilityFixture(value: unknown): OnboardingFeasibilityFixture {
  try {
    const owned = snapshotOwnedJson(value);
    const root = exactObject(owned, ["fixtureVersion", "cases"]);
    if (root.fixtureVersion !== FIXTURE_VERSION) throw failed();
    const cases = denseArray(root.cases, MAX_CASES);
    if (cases.length !== CASE_IDS.length) throw failed();
    const parsed = cases.map((entry, index) => readCase(entry, CASE_IDS[index]));
    return deepFreeze({ fixtureVersion: FIXTURE_VERSION, cases: parsed });
  } catch (error) {
    if (error instanceof OnboardingFeasibilityError) throw error;
    throw failed();
  }
}

export async function runOnboardingFeasibilityForTest(input: {
  readonly artifactPath: string;
  readonly diagnosticPath?: string;
  readonly fixtureBytes: Uint8Array;
  readonly model: OnboardingModelPort;
  readonly signal: AbortSignal;
  readonly clock?: () => number;
}): Promise<OnboardingModelFeasibilityArtifact> {
  const { artifactPath, diagnosticPath } = await requireOutputPaths(
    input.artifactPath,
    input.diagnosticPath,
  );
  await rm(artifactPath, { force: true });
  if (diagnosticPath !== undefined) await rm(diagnosticPath, { force: true });
  let stage: OnboardingFeasibilityStage = "input_validation";
  let caseId: string | null = null;

  try {
    requireActiveSignal(input.signal);
    const fixtureBytes = Uint8Array.from(input.fixtureBytes);
    const fixtureText = new TextDecoder("utf-8", { fatal: true }).decode(fixtureBytes);
    const fixture = readOnboardingFeasibilityFixture(JSON.parse(fixtureText) as unknown);
    const modelVersions = requireCurrentModelVersions(input.model.versions);
    const clock = input.clock ?? Date.now;
    const results: { caseId: string; status: "passed"; elapsedMs: number }[] = [];

    for (const testCase of fixture.cases) {
      requireActiveSignal(input.signal);
      caseId = testCase.caseId;
      stage = testCase.kind === "extract" ? "extract_model" : "review_model";
      const startedAt = readClock(clock);
      await runCase(testCase, input.model, input.signal, () => {
        stage = testCase.kind === "extract" ? "extract_semantic" : "review_semantic";
      });
      const finishedAt = readClock(clock);
      if (finishedAt < startedAt) throw failed();
      results.push({ caseId: testCase.caseId, status: "passed", elapsedMs: finishedAt - startedAt });
    }

    const withoutDigest = deepFreeze({
      schemaVersion: ARTIFACT_VERSION,
      fixtureVersion: FIXTURE_VERSION,
      fixtureDigest: sha256(fixtureBytes),
      invocationVersion: modelVersions.invocation,
      protocolVersion: "codex-cli-protocol@2" as const,
      model: "gpt-5.6-terra" as const,
      reasoningEffort: "low" as const,
      toolPolicy: "codex-tools-none@2" as const,
      cliVersion: modelVersions.cliVersion,
      extractionPromptVersion: modelVersions.extractionPrompt,
      reviewPromptVersion: modelVersions.reviewPrompt,
      extractionSchemaVersion: modelVersions.extractionSchema,
      reviewSchemaVersion: modelVersions.reviewSchema,
      extractionPromptDigest: digestText(ONBOARDING_EXTRACTION_PROMPT_TEMPLATE),
      reviewPromptDigest: digestText(ONBOARDING_REVIEW_PROMPT_TEMPLATE),
      extractionSchemaDigest: digestJson(ONBOARDING_EXTRACTION_SCHEMA),
      reviewSchemaDigest: digestJson(ONBOARDING_REVIEW_SCHEMA),
      extractionLimits: ONBOARDING_EXTRACTION_LIMITS,
      reviewLimits: ONBOARDING_REVIEW_LIMITS,
      caseResults: results,
      rawPromptStored: false as const,
      rawOutputStored: false as const,
      transcriptStored: false as const,
    });
    const artifact: OnboardingModelFeasibilityArtifact = deepFreeze({
      ...withoutDigest,
      artifactDigest: digestJson(withoutDigest),
    });
    stage = "artifact_write";
    await writeArtifactAtomically(artifactPath, artifact);
    return artifact;
  } catch (error) {
    await rm(artifactPath, { force: true });
    if (diagnosticPath !== undefined) {
      await writeFailureDiagnostic(diagnosticPath, { caseId, stage, error });
    }
    throw failed();
  }
}

export async function removeStaleOnboardingFeasibilityArtifact(
  borrowedArtifactPath: string,
): Promise<void> {
  const { artifactPath } = await requireOutputPaths(borrowedArtifactPath, undefined);
  await rm(artifactPath, { force: true });
}

async function runCase(
  testCase: FeasibilityCase,
  model: OnboardingModelPort,
  signal: AbortSignal,
  modelCompleted: () => void,
): Promise<void> {
  const session = buildSession(testCase.sessionSeed);
  const questionnaire = projectQuestionnaireForModel(session);
  if (testCase.kind === "extract") {
    const result = await model.extract({ message: testCase.userMessage, questionnaire, signal });
    modelCompleted();
    requireActiveSignal(signal);
    const guarded = guardExtraction({
      session,
      userMessage: testCase.userMessage,
      rawModelOutput: result,
    });
    if (guarded.nextQuestion.trim().length === 0 ||
      canonicalJson(canonicalProposals(guarded.proposals)) !==
      canonicalJson(canonicalProposals(testCase.expectedProposals))) {
      throw failed();
    }
    return;
  }

  const result = await model.review({ questionnaire, signal });
  modelCompleted();
  requireActiveSignal(signal);
  const issues = corroborateModelReview({ session, rawModelOutput: result });
  if (canonicalJson(issues) !== canonicalJson(testCase.expectedIssues)) throw failed();
}

function buildSession(seed: SessionSeed): OnboardingSessionState {
  let participantUsed = false;
  let initialCommandUsed = false;
  let completionIndex = 0;
  let session = createOnboardingSession({
    nextParticipantId: () => {
      if (participantUsed) throw failed();
      participantUsed = true;
      return seed.initialParticipantId;
    },
    nextCompletionCommandId: () => {
      if (initialCommandUsed) throw failed();
      initialCommandUsed = true;
      return seed.initialCompletionCommandId;
    },
  });

  for (const change of seed.changes) {
    session = applySessionFieldChange({
      session,
      change,
      nextCompletionCommandId: () => {
        const next = seed.nextCompletionCommandIds[completionIndex];
        if (next === undefined) throw failed();
        completionIndex += 1;
        return next;
      },
    });
  }
  if (completionIndex !== seed.nextCompletionCommandIds.length) throw failed();
  return reconstructOnboardingSessionState(session);
}

function readCase(value: JsonValue, expectedId: (typeof CASE_IDS)[number]): FeasibilityCase {
  const base = exactObject(value);
  if (base.caseId !== expectedId) throw failed();
  if (expectedId === "review_final_blockers") {
    requireKeys(base, ["caseId", "kind", "sessionSeed", "expectedIssues"]);
    if (base.kind !== "review") throw failed();
    return deepFreeze({
      caseId: expectedId,
      kind: "review" as const,
      sessionSeed: readSessionSeed(base.sessionSeed),
      expectedIssues: readExpectedIssues(base.expectedIssues),
    });
  }
  requireKeys(base, ["caseId", "kind", "sessionSeed", "userMessage", "expectedProposals"]);
  if (base.kind !== "extract") throw failed();
  return deepFreeze({
    caseId: expectedId,
    kind: "extract" as const,
    sessionSeed: readSessionSeed(base.sessionSeed),
    userMessage: readUserMessage(base.userMessage),
    expectedProposals: readExpectedProposals(base.expectedProposals),
  });
}

function readSessionSeed(value: JsonValue): SessionSeed {
  const seed = exactObject(value, [
    "schemaVersion",
    "initialParticipantId",
    "initialCompletionCommandId",
    "nextCompletionCommandIds",
    "changes",
  ]);
  if (seed.schemaVersion !== SESSION_SEED_VERSION) throw failed();
  const initialParticipantId = readUuid(seed.initialParticipantId);
  const initialCompletionCommandId = readUuid(seed.initialCompletionCommandId);
  if (initialParticipantId === initialCompletionCommandId) throw failed();
  const nextCompletionCommandIds = denseArray(seed.nextCompletionCommandIds, MAX_CHANGES).map(readUuid);
  const changes = denseArray(seed.changes, MAX_CHANGES).map(readManualChange);
  return deepFreeze({
    schemaVersion: SESSION_SEED_VERSION,
    initialParticipantId,
    initialCompletionCommandId,
    nextCompletionCommandIds,
    changes,
  });
}

function readManualChange(value: JsonValue): Extract<QuestionnaireFieldChange, { kind: "manual_set" }> {
  const change = exactObject(value, ["kind", "fieldId", "rawInput"]);
  if (change.kind !== "manual_set") throw failed();
  return deepFreeze({
    kind: "manual_set" as const,
    fieldId: parseOnboardingFieldIdForDecision(change.fieldId),
    rawInput: ordinaryJson(change.rawInput),
  });
}

function readUserMessage(value: JsonValue): SessionMessage {
  const message = exactObject(value, ["messageId", "role", "text"]);
  if (typeof message.messageId !== "string" || !UUID.test(message.messageId) ||
    message.role !== "user" || typeof message.text !== "string" || message.text.trim().length === 0) {
    throw failed();
  }
  return Object.freeze({ messageId: message.messageId, role: "user" as const, text: message.text });
}

function readExpectedProposals(value: JsonValue): readonly GuardedExtractionProposal[] {
  const proposals = denseArray(value, MAX_EXPECTED_VALUES).map(readExpectedProposal);
  const canonical = canonicalProposals(proposals);
  if (canonicalJson(proposals) !== canonicalJson(canonical)) throw failed();
  return canonical;
}

function readExpectedProposal(value: JsonValue): GuardedExtractionProposal {
  const proposal = exactObject(value);
  if (proposal.kind === "participant_roster") {
    requireKeys(proposal, ["kind", "roster"]);
    const roster = denseArray(proposal.roster, 20).map(readRosterEntry);
    if (roster.length === 0 || roster[0]?.descriptor !== "self" || roster[0]?.relationship !== "self" ||
      roster.some(({ descriptor }, index) => descriptor !== (index === 0 ? "self" : `companion.${index - 1}`))) {
      throw failed();
    }
    return deepFreeze({ kind: "participant_roster" as const, roster });
  }
  if (proposal.kind === "participant_leaf") {
    requireKeys(proposal, ["kind", "descriptor", "leafId", "normalizedValue"]);
    const descriptor = readDescriptor(proposal.descriptor);
    const leafId = readLeafId(proposal.leafId);
    const fieldId = `participants.${PARTICIPANT_ID}.${leafId}` as OnboardingFieldId;
    return deepFreeze({
      kind: "participant_leaf" as const,
      descriptor,
      leafId,
      normalizedValue: cloneOnboardingFieldValueForDecision(fieldId, ordinaryJson(proposal.normalizedValue)),
    }) as GuardedExtractionProposal;
  }
  if (proposal.kind === "non_participant_field") {
    requireKeys(proposal, ["kind", "fieldId", "normalizedValue"]);
    const fieldId = parseOnboardingFieldIdForDecision(proposal.fieldId);
    if (fieldId === "participants" || fieldId.startsWith("participants.")) throw failed();
    return deepFreeze({
      kind: "non_participant_field" as const,
      fieldId,
      normalizedValue: cloneOnboardingFieldValueForDecision(fieldId, ordinaryJson(proposal.normalizedValue)),
    }) as GuardedExtractionProposal;
  }
  throw failed();
}

function readRosterEntry(value: JsonValue): ParticipantRosterProposal {
  const entry = exactObject(value, ["descriptor", "relationship"]);
  const descriptor = readDescriptor(entry.descriptor);
  if (typeof entry.relationship !== "string" || !RELATIONSHIP_SET.has(entry.relationship)) throw failed();
  return Object.freeze({
    descriptor,
    relationship: entry.relationship as ParticipantRosterProposal["relationship"],
  });
}

function readExpectedIssues(value: JsonValue): readonly QuestionnaireIssue[] {
  const issues = denseArray(value, MAX_EXPECTED_VALUES).map((entry) => {
    const issue = exactObject(entry, ["fieldId", "reasonCode"]);
    const fieldId = parseOnboardingFieldIdForDecision(issue.fieldId);
    if (typeof issue.reasonCode !== "string" || !ISSUE_CODE_SET.has(issue.reasonCode)) throw failed();
    return Object.freeze({ fieldId, reasonCode: issue.reasonCode as QuestionnaireIssueCode });
  });
  if (new Set(issues.map(({ fieldId, reasonCode }) => `${fieldId}\0${reasonCode}`)).size !== issues.length) {
    throw failed();
  }
  return Object.freeze(issues);
}

function readDescriptor(value: JsonValue): ParticipantDescriptor {
  if (typeof value !== "string" || !PARTICIPANT_DESCRIPTOR.test(value)) throw failed();
  return value as ParticipantDescriptor;
}

function readLeafId(value: JsonValue): ParticipantLeafId {
  if (typeof value !== "string" || !PARTICIPANT_LEAF_SET.has(value)) throw failed();
  return value as ParticipantLeafId;
}

function canonicalProposals(
  value: readonly GuardedExtractionProposal[],
): readonly GuardedExtractionProposal[] {
  return Object.freeze([...value].sort((left, right) => compareText(proposalKey(left), proposalKey(right))));
}

function proposalKey(value: GuardedExtractionProposal): string {
  if (value.kind === "participant_roster") return "participants";
  if (value.kind === "participant_leaf") return `participants.${value.descriptor}.${value.leafId}`;
  return value.fieldId;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function exactObject(value: JsonValue, keys?: readonly string[]): Record<string, JsonValue> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw failed();
  const object = value as Record<string, JsonValue>;
  if (keys !== undefined) requireKeys(object, keys);
  return object;
}

function requireKeys(value: Readonly<Record<string, JsonValue>>, keys: readonly string[]): void {
  const actual = Object.keys(value);
  if (actual.length !== keys.length || !keys.every((key) => actual.includes(key))) throw failed();
}

function denseArray(value: JsonValue, maximum: number): readonly JsonValue[] {
  if (!Array.isArray(value) || value.length > maximum) throw failed();
  return value;
}

function readUuid(value: JsonValue): string {
  if (typeof value !== "string" || !UUID.test(value)) throw failed();
  return value;
}

function requireArtifactPath(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || !value.endsWith(".json")) throw failed();
  const path = resolve(value);
  if (path === resolve("/") || dirname(path) === path) throw failed();
  return path;
}

async function requireOutputPaths(
  artifactValue: unknown,
  diagnosticValue: unknown,
): Promise<{
  readonly artifactPath: string;
  readonly diagnosticPath?: string;
}> {
  const artifactPath = requireArtifactPath(artifactValue);
  const diagnosticPath = diagnosticValue === undefined
    ? undefined
    : requireDistinctDiagnosticPath(diagnosticValue, artifactPath);
  const [fixtureIdentity, artifactIdentity, diagnosticIdentity] = await Promise.all([
    readPathIdentity(FEASIBILITY_FIXTURE_PATH),
    readPathIdentity(artifactPath),
    diagnosticPath === undefined ? undefined : readPathIdentity(diagnosticPath),
  ]);
  if (
    pathsAlias(fixtureIdentity, artifactIdentity) ||
    (diagnosticIdentity !== undefined && (
      pathsAlias(fixtureIdentity, diagnosticIdentity) ||
      pathsAlias(artifactIdentity, diagnosticIdentity)
    ))
  ) throw failed();
  return Object.freeze({
    artifactPath,
    ...(diagnosticPath === undefined ? {} : { diagnosticPath }),
  });
}

interface PathIdentity {
  readonly realPath: string;
  readonly existing?: {
    readonly dev: number | bigint;
    readonly ino: number | bigint;
  };
}

async function readPathIdentity(path: string): Promise<PathIdentity> {
  const [realPath, identity] = await Promise.all([
    resolveRealPathThroughExistingPrefix(path),
    statIfPresent(path),
  ]);
  return Object.freeze({
    realPath,
    ...(identity === undefined
      ? {}
      : { existing: Object.freeze({ dev: identity.dev, ino: identity.ino }) }),
  });
}

function pathsAlias(left: PathIdentity, right: PathIdentity): boolean {
  return left.realPath === right.realPath || (
    left.existing !== undefined &&
    right.existing !== undefined &&
    left.existing.dev === right.existing.dev &&
    left.existing.ino === right.existing.ino
  );
}

async function resolveRealPathThroughExistingPrefix(path: string): Promise<string> {
  let existingPrefix = path;
  const missingSuffix: string[] = [];
  while (true) {
    try {
      return resolve(await realpath(existingPrefix), ...missingSuffix);
    } catch (error) {
      if (!isMissingPathError(error)) throw error;
      const parent = dirname(existingPrefix);
      if (parent === existingPrefix) throw error;
      missingSuffix.unshift(basename(existingPrefix));
      existingPrefix = parent;
    }
  }
}

async function statIfPresent(path: string): Promise<Awaited<ReturnType<typeof stat>> | undefined> {
  try {
    return await stat(path);
  } catch (error) {
    if (isMissingPathError(error)) return undefined;
    throw error;
  }
}

function isMissingPathError(error: unknown): boolean {
  if (error === null || typeof error !== "object" || !("code" in error)) return false;
  return error.code === "ENOENT" || error.code === "ENOTDIR";
}

function requireDistinctDiagnosticPath(value: unknown, artifactPath: string): string {
  const diagnosticPath = requireArtifactPath(value);
  if (diagnosticPath === artifactPath) throw failed();
  return diagnosticPath;
}

function requireCurrentModelVersions(value: unknown): OnboardingModelVersionsV10 {
  try {
    const versions = reconstructOnboardingModelVersions(value);
    if (versions !== ONBOARDING_MODEL_VERSIONS_V10) throw failed();
    return versions;
  } catch {
    throw failed();
  }
}

function requireActiveSignal(value: AbortSignal): void {
  if (NATIVE_ABORTED_GETTER === undefined) throw failed();
  try {
    if (NATIVE_ABORTED_GETTER.call(value) !== false) throw failed();
  } catch {
    throw failed();
  }
}

function readClock(clock: () => number): number {
  const value = clock();
  if (!Number.isSafeInteger(value) || value < 0) throw failed();
  return value;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(snapshotOwnedJson(value)));
}

function canonicalize(value: JsonValue): JsonValue {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  const object = value as JsonObject;
  const result: Record<string, JsonValue> = Object.create(null) as Record<string, JsonValue>;
  for (const key of Object.keys(object).sort()) result[key] = canonicalize(object[key] as JsonValue);
  return result;
}

function ordinaryJson(value: JsonValue): JsonValue {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(ordinaryJson);
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, ordinaryJson(child)]));
}

function digestText(value: string): string {
  return sha256(new TextEncoder().encode(value));
}

function digestJson(value: unknown): string {
  return digestText(canonicalJson(value));
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

async function writeArtifactAtomically(
  artifactPath: string,
  artifact: unknown,
): Promise<void> {
  const temporaryPath = `${artifactPath}.${process.pid}.${randomUUID()}.tmp`;
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(temporaryPath, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify(snapshotOwnedJson(artifact))}\n`, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporaryPath, artifactPath);
    await chmod(artifactPath, 0o600);
  } finally {
    await handle?.close().catch(() => undefined);
    await rm(temporaryPath, { force: true });
  }
}

async function writeFailureDiagnostic(
  diagnosticPath: string,
  input: {
    readonly caseId: string | null;
    readonly stage: OnboardingFeasibilityStage;
    readonly error: unknown;
  },
): Promise<void> {
  const errorCode: OnboardingModelErrorCode | "onboarding_model_feasibility_failed" =
    input.error instanceof OnboardingModelError
    ? input.error.code
    : "onboarding_model_feasibility_failed";
  const runtimeCode = input.error instanceof OnboardingModelError
    ? input.error.runtimeCode ?? null
    : null;
  const withoutDigest = deepFreeze({
    schemaVersion: DIAGNOSTIC_VERSION,
    fixtureVersion: FIXTURE_VERSION,
    caseId: input.caseId,
    stage: input.stage,
    errorCode,
    runtimeCode,
    passingArtifactPresent: false as const,
  });
  const diagnostic: OnboardingModelFeasibilityDiagnostic = deepFreeze({
    ...withoutDigest,
    diagnosticDigest: digestJson(withoutDigest),
  });
  await writeArtifactAtomically(diagnosticPath, diagnostic);
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function failed(): OnboardingFeasibilityError {
  return new OnboardingFeasibilityError();
}

function readOwnedStringArguments(value: unknown, maximumLength: number): readonly string[] {
  if (
    types.isProxy(value) ||
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    Object.getOwnPropertySymbols(value).length !== 0 ||
    value.length > maximumLength
  ) throw failed();

  const descriptors = Object.getOwnPropertyDescriptors(value);
  const allowed = new Set([
    ...Array.from({ length: value.length }, (_, index) => String(index)),
    "length",
  ]);
  if (Object.keys(descriptors).some((key) => !allowed.has(key))) throw failed();

  const copy: string[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (
      descriptor === undefined ||
      !("value" in descriptor) ||
      descriptor.enumerable !== true ||
      typeof descriptor.value !== "string"
    ) throw failed();
    copy.push(descriptor.value);
  }
  return Object.freeze(copy);
}

export function parseOnboardingFeasibilityArguments(
  input: unknown,
): OnboardingFeasibilityLaunchArguments {
  const args = readOwnedStringArguments(input, 5);
  if (args.length === 4 && args[0] === "--artifact" && args[2] === "--diagnostic") {
    return Object.freeze({
      mode: "deferred",
      artifactPath: args[1]!,
      diagnosticPath: args[3]!,
    });
  }
  if (
    args.length === 5 &&
    args[0] === FINAL_PROJECT_LIVE_MODEL_GATE_FLAG &&
    args[1] === "--artifact" &&
    args[3] === "--diagnostic"
  ) return Object.freeze({
    mode: "final-project-live-model-gate",
    artifactPath: args[2]!,
    diagnosticPath: args[4]!,
  });
  throw failed();
}

export async function runOnboardingFeasibilityEntrypointForTest(input: {
  readonly rawArguments: unknown;
  readonly runFinalProjectLiveModelGate: (paths: Readonly<{
    artifactPath: string;
    diagnosticPath: string;
  }>) => Promise<void>;
}): Promise<OnboardingFeasibilityEntrypointResult> {
  let parsed: OnboardingFeasibilityLaunchArguments;
  try {
    parsed = parseOnboardingFeasibilityArguments(input.rawArguments);
  } catch {
    return FEASIBILITY_DEFERRED_RESULT;
  }

  try {
    const paths = await requireOutputPaths(parsed.artifactPath, parsed.diagnosticPath);
    if (paths.diagnosticPath === undefined) throw failed();
    await removeStaleOnboardingFeasibilityArtifact(paths.artifactPath);
    if (parsed.mode === "deferred") return FEASIBILITY_DEFERRED_RESULT;
    await rm(paths.diagnosticPath, { force: true });
    await input.runFinalProjectLiveModelGate(Object.freeze({
      artifactPath: paths.artifactPath,
      diagnosticPath: paths.diagnosticPath,
    }));
    return FEASIBILITY_SUCCESS_RESULT;
  } catch {
    return parsed.mode === "deferred"
      ? FEASIBILITY_DEFERRED_RESULT
      : FEASIBILITY_FAILURE_RESULT;
  }
}

async function runFinalProjectLiveModelGate(paths: Readonly<{
  artifactPath: string;
  diagnosticPath: string;
}>): Promise<void> {
  let runnerStarted = false;
  try {
    const fixtureBytes = new Uint8Array(await readFile(FEASIBILITY_FIXTURE_URL));
    await registerNodeCodexRuntime();
    runnerStarted = true;
    await runOnboardingFeasibilityForTest({
      artifactPath: paths.artifactPath,
      diagnosticPath: paths.diagnosticPath,
      fixtureBytes,
      model: createCodexOnboardingModel(getCodexCliModelAdapter()),
      signal: new AbortController().signal,
    });
  } catch (error) {
    await rm(paths.artifactPath, { force: true });
    if (!runnerStarted) {
      await writeFailureDiagnostic(paths.diagnosticPath, {
        caseId: null,
        stage: "runtime_initialization",
        error,
      });
    }
    throw failed();
  }
}

async function main(): Promise<void> {
  const result = await runOnboardingFeasibilityEntrypointForTest({
    rawArguments: process.argv.slice(2),
    runFinalProjectLiveModelGate,
  });
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  process.exitCode = result.exitCode;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().catch(() => {
    process.stderr.write(FEASIBILITY_FAILURE);
    process.exitCode = 1;
  });
}
