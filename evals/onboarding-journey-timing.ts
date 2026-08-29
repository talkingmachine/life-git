import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, realpath, rename, rm, stat } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { types } from "node:util";

import {
  completeOnboarding,
  extractMessage,
} from "../src/application/onboarding";
import type { OnboardingModelPort } from
  "../src/application/onboarding-contracts";
import {
  ONBOARDING_MODEL_VERSIONS_V7,
  reconstructOnboardingModelVersions,
  type OnboardingModelVersionsV7,
} from "../src/application/onboarding-model-versions";
import {
  createOnboardingSession,
  ONBOARDING_SESSION_LIMITS,
  type OnboardingSessionState,
} from "../src/decision/onboarding-session";
import {
  createPlaceFrontierStreamHandoff,
  openPlaceFrontierStreamResponse,
} from "../src/experience/place-frontier-stream";
import { registerNodeCodexRuntime } from "../src/instrumentation-node";
import { createCodexOnboardingModel } from
  "../src/infrastructure/codex-cli/onboarding-model";
import { getCodexCliModelAdapter } from
  "../src/infrastructure/codex-cli/runtime";

export const ONBOARDING_CANONICAL_JOURNEY_LIMIT_MS = 35_000;

const ARTIFACT_VERSION = "onboarding-journey-timing@4" as const;
const FIXTURE_VERSION = "onboarding-canonical-journey@1" as const;
const FIXED_FAILURE = "onboarding_journey_timing_failed";
const FINAL_PROJECT_LIVE_MODEL_GATE_FLAG = "--final-project-live-model-gate";
const LIVE_MODEL_GATE_DEFERRED = "onboarding_live_model_gate_deferred\n";
const IN_MEMORY_HMAC_KEY = "onboarding-journey-timing-integrity@1";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const JSON_NUMBER = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;
const CANONICAL_FIXTURE_URL = new URL("./fixtures/onboarding/canonical-journey.json", import.meta.url);
const CANONICAL_FIXTURE_PATH = resolve(fileURLToPath(CANONICAL_FIXTURE_URL));

export interface OnboardingJourneyTimingArtifact {
  readonly schemaVersion: typeof ARTIFACT_VERSION;
  readonly fixtureVersion: typeof FIXTURE_VERSION;
  readonly fixtureDigest: string;
  readonly modelVersions: OnboardingModelVersionsV7;
  readonly protocolVersion: "codex-cli-protocol@2";
  readonly model: "gpt-5.6-terra";
  readonly reasoningEffort: "low";
  readonly toolPolicy: "codex-tools-none@2";
  readonly elapsedMs: number;
  readonly limitMs: typeof ONBOARDING_CANONICAL_JOURNEY_LIMIT_MS;
  readonly acceptedFrontierHandoff: true;
  readonly modelInvocationCount: 2;
  readonly rawPromptStored: false;
  readonly rawOutputStored: false;
  readonly transcriptStored: false;
  readonly artifactDigest: string;
}

export interface OnboardingCanonicalJourneyFixture {
  readonly schemaVersion: typeof FIXTURE_VERSION;
  readonly ids: {
    readonly initialParticipantId: string;
    readonly companionParticipantId: string;
    readonly initialCompletionCommandId: string;
    readonly assistantMessageId: string;
    readonly extractedCompletionCommandId: string;
  };
  readonly messages: readonly [{
    readonly messageId: string;
    readonly role: "user";
    readonly text: string;
  }];
}

interface BorrowedCanonicalJourneyResult {
  readonly acceptedFrontierHandoff: boolean;
  readonly modelInvocationCount: number;
  readonly modelVersions: unknown;
}

interface CanonicalJourneyResult {
  readonly acceptedFrontierHandoff: boolean;
  readonly modelInvocationCount: number;
  readonly modelVersions: OnboardingModelVersionsV7;
}

export class OnboardingJourneyTimingError extends Error {
  readonly name = "OnboardingJourneyTimingError";

  constructor() {
    super(FIXED_FAILURE);
  }
}

export type OnboardingJourneyTimingLaunchMode =
  | "deferred"
  | "final-project-live-model-gate";

export interface OnboardingJourneyTimingLaunchArguments {
  readonly mode: OnboardingJourneyTimingLaunchMode;
  readonly artifactPath: string;
}

export type OnboardingJourneyTimingEntrypointResult =
  | Readonly<{ exitCode: 0; stdout: ""; stderr: "" }>
  | Readonly<{
      exitCode: 1;
      stdout: "";
      stderr:
        | "onboarding_live_model_gate_deferred\n"
        | "onboarding_journey_timing_failed\n";
    }>;

const TIMING_SUCCESS_RESULT: OnboardingJourneyTimingEntrypointResult = Object.freeze({
  exitCode: 0,
  stdout: "",
  stderr: "",
});
const TIMING_DEFERRED_RESULT: OnboardingJourneyTimingEntrypointResult = Object.freeze({
  exitCode: 1,
  stdout: "",
  stderr: LIVE_MODEL_GATE_DEFERRED,
});
const TIMING_FAILURE_RESULT: OnboardingJourneyTimingEntrypointResult = Object.freeze({
  exitCode: 1,
  stdout: "",
  stderr: `${FIXED_FAILURE}\n`,
});

export function readOnboardingCanonicalJourneyFixture(
  borrowedBytes: Uint8Array,
): OnboardingCanonicalJourneyFixture {
  try {
    const bytes = Uint8Array.from(borrowedBytes);
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    rejectDuplicateJsonObjectMembers(text);
    const root = exactRecord(JSON.parse(text) as unknown, [
      "schemaVersion",
      "ids",
      "messages",
    ]);
    if (root.schemaVersion !== FIXTURE_VERSION) throw failed();

    const borrowedIds = exactRecord(root.ids, [
      "initialParticipantId",
      "companionParticipantId",
      "initialCompletionCommandId",
      "assistantMessageId",
      "extractedCompletionCommandId",
    ]);
    const ids = {
      initialParticipantId: readUuid(borrowedIds.initialParticipantId),
      companionParticipantId: readUuid(borrowedIds.companionParticipantId),
      initialCompletionCommandId: readUuid(borrowedIds.initialCompletionCommandId),
      assistantMessageId: readUuid(borrowedIds.assistantMessageId),
      extractedCompletionCommandId: readUuid(borrowedIds.extractedCompletionCommandId),
    };

    const messages = denseArray(root.messages, 1);
    if (messages.length !== 1) throw failed();
    const borrowedMessage = exactRecord(messages[0], ["messageId", "role", "text"]);
    const messageId = readUuid(borrowedMessage.messageId);
    if (borrowedMessage.role !== "user") throw failed();
    const textValue = readFixtureText(borrowedMessage.text);

    const allIds = [...Object.values(ids), messageId];
    if (new Set(allIds).size !== allIds.length) throw failed();

    return deepFreeze({
      schemaVersion: FIXTURE_VERSION,
      ids,
      messages: [{ messageId, role: "user" as const, text: textValue }],
    });
  } catch {
    throw failed();
  }
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

export function parseOnboardingJourneyTimingArguments(
  input: unknown,
): OnboardingJourneyTimingLaunchArguments {
  const rawArguments = readOwnedStringArguments(input, 4);
  const offset = rawArguments[0] === "--" ? 1 : 0;
  const args = rawArguments.slice(offset);
  if (args.length === 2 && args[0] === "--artifact") {
    return Object.freeze({ mode: "deferred", artifactPath: args[1]! });
  }
  if (
    args.length === 3 &&
    args[0] === FINAL_PROJECT_LIVE_MODEL_GATE_FLAG &&
    args[1] === "--artifact"
  ) return Object.freeze({
    mode: "final-project-live-model-gate",
    artifactPath: args[2]!,
  });
  throw failed();
}

export async function runOnboardingJourneyTimingEntrypointForTest(input: {
  readonly rawArguments: unknown;
  readonly runFinalProjectLiveModelGate: (
    canonicalArtifactPath: string,
  ) => Promise<void>;
}): Promise<OnboardingJourneyTimingEntrypointResult> {
  let parsed: OnboardingJourneyTimingLaunchArguments;
  try {
    parsed = parseOnboardingJourneyTimingArguments(input.rawArguments);
  } catch {
    return TIMING_DEFERRED_RESULT;
  }

  try {
    const artifactPath = await requireArtifactPath(parsed.artifactPath);
    await removeStaleOnboardingJourneyTimingArtifact(artifactPath);
    if (parsed.mode === "deferred") return TIMING_DEFERRED_RESULT;
    await input.runFinalProjectLiveModelGate(artifactPath);
    return TIMING_SUCCESS_RESULT;
  } catch {
    return parsed.mode === "deferred" ? TIMING_DEFERRED_RESULT : TIMING_FAILURE_RESULT;
  }
}

export async function runOnboardingJourneyTimingForTest(input: {
  readonly artifactPath: string;
  readonly fixtureBytes: Uint8Array;
  readonly modelVersions: unknown;
  readonly runCanonicalJourney: () => Promise<BorrowedCanonicalJourneyResult>;
  readonly monotonicNowMs: () => number;
}): Promise<OnboardingJourneyTimingArtifact> {
  let artifactPath: string | undefined;
  try {
    artifactPath = await requireArtifactPath(input.artifactPath);
    await rm(artifactPath, { force: true });

    const fixtureBytes = Uint8Array.from(input.fixtureBytes);
    const fixture = readOnboardingCanonicalJourneyFixture(fixtureBytes);
    const expectedModelVersions = reconstructOnboardingModelVersions(input.modelVersions);
    if (expectedModelVersions !== ONBOARDING_MODEL_VERSIONS_V7) throw failed();
    const startedAt = readMonotonicClock(input.monotonicNowMs);
    const result = readCanonicalJourneyResult(await input.runCanonicalJourney());
    if (result.modelVersions !== expectedModelVersions) throw failed();
    const finishedAt = readMonotonicClock(input.monotonicNowMs);
    if (finishedAt < startedAt) throw failed();
    const elapsedMs = Math.ceil(finishedAt - startedAt);
    if (
      !Number.isSafeInteger(elapsedMs) ||
      elapsedMs < 0 ||
      elapsedMs > ONBOARDING_CANONICAL_JOURNEY_LIMIT_MS ||
      result.acceptedFrontierHandoff !== true ||
      result.modelInvocationCount !== 2
    ) throw failed();

    const withoutDigest = deepFreeze({
      schemaVersion: ARTIFACT_VERSION,
      fixtureVersion: fixture.schemaVersion,
      fixtureDigest: sha256(fixtureBytes),
      modelVersions: result.modelVersions,
      protocolVersion: "codex-cli-protocol@2" as const,
      model: "gpt-5.6-terra" as const,
      reasoningEffort: "low" as const,
      toolPolicy: "codex-tools-none@2" as const,
      elapsedMs,
      limitMs: ONBOARDING_CANONICAL_JOURNEY_LIMIT_MS,
      acceptedFrontierHandoff: true as const,
      modelInvocationCount: 2 as const,
      rawPromptStored: false as const,
      rawOutputStored: false as const,
      transcriptStored: false as const,
    } as const);
    const artifact: OnboardingJourneyTimingArtifact = deepFreeze({
      ...withoutDigest,
      artifactDigest: sha256(new TextEncoder().encode(canonicalJson(withoutDigest))),
    });
    await writeArtifactAtomically(artifactPath, artifact);
    return artifact;
  } catch {
    if (artifactPath !== undefined) {
      await rm(artifactPath, { force: true }).catch(() => undefined);
    }
    throw failed();
  }
}

export async function removeStaleOnboardingJourneyTimingArtifact(
  borrowedArtifactPath: string,
): Promise<void> {
  const artifactPath = await requireArtifactPath(borrowedArtifactPath);
  await rm(artifactPath, { force: true });
}

async function prepareProductionJourney(fixture: OnboardingCanonicalJourneyFixture): Promise<{
  readonly modelVersions: unknown;
  readonly run: () => Promise<BorrowedCanonicalJourneyResult>;
  readonly close: () => void;
}> {
  const [
    { createPlaceFrontierComposition },
    { openEvidenceDatabase },
    { SqliteOnboardingStore },
  ] = await Promise.all([
    import("../src/infrastructure/place-frontier-composition"),
    import("../src/infrastructure/sqlite/db"),
    import("../src/infrastructure/sqlite/onboarding-store"),
  ]);
  const database = openEvidenceDatabase(":memory:");
  try {
    const completion = new SqliteOnboardingStore(database, IN_MEMORY_HMAC_KEY);
    const frontier = createPlaceFrontierComposition({
      database,
      hmacKey: IN_MEMORY_HMAC_KEY,
      onboardingConfirmations: completion,
      clock: () => { throw failed(); },
      nextRunId: () => { throw failed(); },
    });
    const productionModel = createCodexOnboardingModel(getCodexCliModelAdapter());
    let modelInvocationCount = 0;
    const model: OnboardingModelPort = Object.freeze({
      versions: productionModel.versions,
      extract: async (input: Parameters<OnboardingModelPort["extract"]>[0]) => {
        modelInvocationCount += 1;
        return productionModel.extract(input);
      },
      review: async (input: Parameters<OnboardingModelPort["review"]>[0]) => {
        modelInvocationCount += 1;
        return productionModel.review(input);
      },
    });

    let initialParticipantIdUsed = false;
    let initialCompletionCommandIdUsed = false;
    const initialSession = createOnboardingSession({
      nextParticipantId: () => {
        if (initialParticipantIdUsed) throw failed();
        initialParticipantIdUsed = true;
        return fixture.ids.initialParticipantId;
      },
      nextCompletionCommandId: () => {
        if (initialCompletionCommandIdUsed) throw failed();
        initialCompletionCommandIdUsed = true;
        return fixture.ids.initialCompletionCommandId;
      },
    });
    if (!initialParticipantIdUsed || !initialCompletionCommandIdUsed) throw failed();

    const extractionCommand = deepFreeze({
      schemaVersion: "onboarding-message-command@1" as const,
      session: initialSession,
      message: fixture.messages[0],
    });
    const signal = new AbortController().signal;
    let started = false;

    return Object.freeze({
      modelVersions: model.versions,
      run: async () => {
        if (started) throw failed();
        started = true;
        let companionParticipantIdReads = 0;
        let assistantMessageIdReads = 0;
        let extractedCompletionCommandIdReads = 0;
        const session = await extractMessage(extractionCommand, {
          model,
          nextParticipantId: () => {
            companionParticipantIdReads += 1;
            if (companionParticipantIdReads !== 1) throw failed();
            return fixture.ids.companionParticipantId;
          },
          nextAssistantMessageId: () => {
            assistantMessageIdReads += 1;
            if (assistantMessageIdReads !== 1) throw failed();
            return fixture.ids.assistantMessageId;
          },
          nextCompletionCommandId: () => {
            extractedCompletionCommandIdReads += 1;
            if (extractedCompletionCommandIdReads !== 1) throw failed();
            return fixture.ids.extractedCompletionCommandId;
          },
        }, signal);
        assertCanonicalOnboardingJourneySession(session, fixture, {
          companionParticipantIdReads,
          assistantMessageIdReads,
          extractedCompletionCommandIdReads,
        });

        const completionResult = await completeOnboarding({
          schemaVersion: "onboarding-continue-command@1",
          session,
        }, { model, completion, frontier }, signal);
        if (completionResult.kind !== "launched") throw failed();
        requireMatchingLaunchIdentities(completionResult.receipt, completionResult.prepared);
        acceptInertFrontierHandoff(completionResult.receipt, completionResult.prepared);
        return Object.freeze({
          acceptedFrontierHandoff: true,
          modelInvocationCount,
          modelVersions: model.versions,
        });
      },
      close: () => {
        if (database.open) database.close();
      },
    });
  } catch {
    if (database.open) database.close();
    throw failed();
  }
}

export function assertCanonicalOnboardingJourneySession(
  session: OnboardingSessionState,
  fixture: OnboardingCanonicalJourneyFixture,
  reads: {
    readonly companionParticipantIdReads: number;
    readonly assistantMessageIdReads: number;
    readonly extractedCompletionCommandIdReads: number;
  },
): void {
  if (
    reads.companionParticipantIdReads !== 1 ||
    reads.assistantMessageIdReads !== 1 ||
    reads.extractedCompletionCommandIdReads !== 1 ||
    session.completionCommandId !== fixture.ids.extractedCompletionCommandId ||
    session.messages.length !== 2 ||
    session.messages[0]?.messageId !== fixture.messages[0].messageId ||
    session.messages[0]?.role !== "user" ||
    session.messages[0]?.text !== fixture.messages[0].text ||
    session.messages[1]?.messageId !== fixture.ids.assistantMessageId ||
    session.messages[1]?.role !== "assistant"
  ) throw failed();
  if (canonicalJson(session.descriptorBindings) !== canonicalJson({
    "companion.0": fixture.ids.companionParticipantId,
    self: fixture.ids.initialParticipantId,
  })) throw failed();

  const roster = session.draft.fields.find(({ fieldId }) => fieldId === "participants")
    ?.normalizedValue;
  if (canonicalJson(roster) !== canonicalJson([
    { participantId: fixture.ids.initialParticipantId, relationship: "self" },
    { participantId: fixture.ids.companionParticipantId, relationship: "spouse" },
  ])) throw failed();

  const applicableFields = session.draft.fields.filter(
    ({ applicability }) => applicability === "required",
  );
  const notApplicableFields = session.draft.fields.filter(
    ({ applicability }) => applicability === "not_applicable",
  );
  if (
    session.draft.fields.length !== 46 ||
    applicableFields.length !== 44 ||
    applicableFields.some(({ origin }) => origin !== "model") ||
    canonicalJson(notApplicableFields.map(({ fieldId }) => fieldId)) !== canonicalJson([
      `participants.${fixture.ids.initialParticipantId}.remote_continuation`,
      `participants.${fixture.ids.companionParticipantId}.remote_continuation`,
    ]) ||
    canonicalJson(session.draft.fields) !== canonicalJson(canonicalFieldStates(fixture))
  ) throw failed();
}

function canonicalFieldStates(
  fixture: OnboardingCanonicalJourneyFixture,
): readonly Readonly<Record<string, unknown>>[] {
  const selfId = fixture.ids.initialParticipantId;
  const spouseId = fixture.ids.companionParticipantId;
  const roster = [
    { participantId: selfId, relationship: "self" },
    { participantId: spouseId, relationship: "spouse" },
  ];
  return deepFreeze([
    modelField("current_location", { countryCode: "RU", city: "Москва" }),
    modelField("move_horizon", "within_3_months"),
    modelField("moving_party", "with_companions"),
    modelField("participants", roster, {
      previousValue: [{ participantId: selfId, relationship: "self" }],
      proposedValue: roster,
      reasonCode: "explicit_new_information",
      reviewState: "model_overwrite_unreviewed",
    }),
    modelField("savings", { min: "10000", max: "20000", currency: "EUR" }),
    modelField(`participants.${selfId}.citizenships`, ["RU"]),
    modelField(`participants.${selfId}.passport`, { validUntil: "2030-12-31" }),
    modelField(`participants.${selfId}.current_work`, { status: "not_working" }),
    notApplicableField(`participants.${selfId}.remote_continuation`),
    modelField(`participants.${selfId}.monthly_income`, {
      amount: "0",
      currency: "RUB",
      basis: "net",
    }),
    modelField(`participants.${selfId}.education`, { level: "higher", field: "информатика" }),
    modelField(`participants.${selfId}.relevant_experience_years`, 8),
    modelField(`participants.${spouseId}.citizenships`, ["RS"]),
    modelField(`participants.${spouseId}.passport`, { validUntil: "2031-12-31" }),
    modelField(`participants.${spouseId}.current_work`, { status: "not_working" }),
    notApplicableField(`participants.${spouseId}.remote_continuation`),
    modelField(`participants.${spouseId}.monthly_income`, {
      amount: "0",
      currency: "EUR",
      basis: "net",
    }),
    modelField(`participants.${spouseId}.education`, { level: "higher", field: "экономика" }),
    modelField(`participants.${spouseId}.relevant_experience_years`, 6),
    modelField("country_preferences.outside_cis.mode", "required"),
    modelField("country_preferences.outside_cis.importance", 5),
    modelField("country_preferences.outside_cis.target", "required_true"),
    modelField("country_preferences.europe.mode", "weighted"),
    modelField("country_preferences.europe.importance", 4),
    modelField("country_preferences.europe.target", "maximize"),
    modelField("country_preferences.personal_safety.mode", "weighted"),
    modelField("country_preferences.personal_safety.importance", 5),
    modelField("country_preferences.personal_safety.target", "maximize"),
    modelField("country_preferences.infrastructure.mode", "weighted"),
    modelField("country_preferences.infrastructure.importance", 4),
    modelField("country_preferences.infrastructure.target", "maximize"),
    modelField("country_preferences.peace_and_stability.mode", "weighted"),
    modelField("country_preferences.peace_and_stability.importance", 5),
    modelField("country_preferences.peace_and_stability.target", "maximize"),
    modelField("city_preferences.safety.mode", "weighted"),
    modelField("city_preferences.safety.importance", 5),
    modelField("city_preferences.safety.target", "высокий уровень личной безопасности"),
    modelField("city_preferences.long_term_rent.mode", "weighted"),
    modelField("city_preferences.long_term_rent.importance", 4),
    modelField("city_preferences.long_term_rent.target", "доступная долгосрочная аренда"),
    modelField("city_preferences.urban_transit.mode", "weighted"),
    modelField("city_preferences.urban_transit.importance", 4),
    modelField("city_preferences.urban_transit.target", "развитый общественный транспорт"),
    modelField("city_preferences.fixed_broadband.mode", "weighted"),
    modelField("city_preferences.fixed_broadband.importance", 3),
    modelField("city_preferences.fixed_broadband.target", "стабильный быстрый домашний интернет"),
  ]);
}

function modelField(
  fieldId: string,
  normalizedValue: unknown,
  overwrite: unknown = null,
): Readonly<Record<string, unknown>> {
  return {
    fieldId,
    applicability: "required",
    rawInput: null,
    normalizedValue,
    origin: "model",
    overwrite,
  };
}

function notApplicableField(fieldId: string): Readonly<Record<string, unknown>> {
  return {
    fieldId,
    applicability: "not_applicable",
    rawInput: null,
    normalizedValue: null,
    origin: "empty",
    overwrite: null,
  };
}

function requireMatchingLaunchIdentities(
  receipt: {
    readonly frontierRunId: string;
    readonly profileId: string;
    readonly preferenceProfileId: string;
  },
  prepared: {
    readonly runId: string;
    readonly profileId: string;
    readonly preferenceProfileId: string;
  },
): void {
  if (
    receipt.frontierRunId !== prepared.runId ||
    receipt.profileId !== prepared.profileId ||
    receipt.preferenceProfileId !== prepared.preferenceProfileId
  ) throw failed();
}

function acceptInertFrontierHandoff(
  receipt: {
    readonly frontierRunId: string;
    readonly profileId: string;
    readonly preferenceProfileId: string;
  },
  prepared: {
    readonly runId: string;
    readonly profileId: string;
    readonly preferenceProfileId: string;
  },
): void {
  const inertStream = new ReadableStream<Uint8Array>();
  const response = new Response(inertStream, {
    headers: {
      "cache-control": "no-store, no-transform",
      "content-type": "application/x-ndjson; charset=utf-8",
      "x-content-type-options": "nosniff",
      "x-life-run-id": prepared.runId,
      "x-life-profile-id": prepared.profileId,
      "x-life-preference-profile-id": prepared.preferenceProfileId,
    },
  });
  const opened = openPlaceFrontierStreamResponse(response, {
    profileId: receipt.profileId,
    preferenceProfileId: receipt.preferenceProfileId,
  });
  if (
    opened.runId !== receipt.frontierRunId ||
    opened.runId !== prepared.runId ||
    opened.profileId !== receipt.profileId ||
    opened.profileId !== prepared.profileId ||
    opened.preferenceProfileId !== receipt.preferenceProfileId ||
    opened.preferenceProfileId !== prepared.preferenceProfileId ||
    opened.stream !== inertStream
  ) throw failed();
  const handoff = createPlaceFrontierStreamHandoff(opened.stream);
  const adopted = handoff.adopt();
  if (adopted !== opened.stream || handoff.adopt() !== undefined) throw failed();
  void adopted.cancel(FIXED_FAILURE).catch(() => undefined);
}

function readCanonicalJourneyResult(value: unknown): CanonicalJourneyResult {
  const result = exactRecord(value, [
    "acceptedFrontierHandoff",
    "modelInvocationCount",
    "modelVersions",
  ]);
  if (
    typeof result.acceptedFrontierHandoff !== "boolean" ||
    typeof result.modelInvocationCount !== "number"
  ) throw failed();
  const modelVersions = reconstructOnboardingModelVersions(result.modelVersions);
  if (modelVersions !== ONBOARDING_MODEL_VERSIONS_V7) throw failed();
  return Object.freeze({
    acceptedFrontierHandoff: result.acceptedFrontierHandoff,
    modelInvocationCount: result.modelInvocationCount,
    modelVersions,
  });
}

function readArtifactArgument(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.trim() !== value
  ) throw failed();
  return value;
}

async function requireArtifactPath(value: unknown): Promise<string> {
  const rawPath = readArtifactArgument(value);
  if (!rawPath.endsWith(".json")) throw failed();
  const path = resolve(rawPath);
  if (
    path === resolve("/") ||
    dirname(path) === path ||
    path === CANONICAL_FIXTURE_PATH
  ) throw failed();
  await rejectCanonicalFixtureAlias(path);
  return path;
}

async function rejectCanonicalFixtureAlias(artifactPath: string): Promise<void> {
  const [canonicalPath, canonicalIdentity, artifactRealPath, artifactIdentity] = await Promise.all([
    realpath(CANONICAL_FIXTURE_PATH),
    stat(CANONICAL_FIXTURE_PATH),
    resolveRealPathThroughExistingPrefix(artifactPath),
    statIfPresent(artifactPath),
  ]);
  if (
    artifactRealPath === canonicalPath ||
    (artifactIdentity !== undefined &&
      artifactIdentity.dev === canonicalIdentity.dev &&
      artifactIdentity.ino === canonicalIdentity.ino)
  ) throw failed();
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

function rejectDuplicateJsonObjectMembers(text: string): void {
  new JsonObjectMemberScanner(text).scan();
}

class JsonObjectMemberScanner {
  private index = 0;

  constructor(private readonly text: string) {}

  scan(): void {
    this.readValue();
    this.skipWhitespace();
    if (this.index !== this.text.length) throw failed();
  }

  private readValue(): void {
    this.skipWhitespace();
    switch (this.text[this.index]) {
      case "{":
        this.readObject();
        return;
      case "[":
        this.readArray();
        return;
      case '"':
        this.readString();
        return;
      case "t":
        this.readLiteral("true");
        return;
      case "f":
        this.readLiteral("false");
        return;
      case "n":
        this.readLiteral("null");
        return;
      default:
        this.readNumber();
    }
  }

  private readObject(): void {
    this.index += 1;
    this.skipWhitespace();
    if (this.consume("}")) return;
    const names = new Set<string>();
    while (true) {
      this.skipWhitespace();
      const name = this.readString();
      if (names.has(name)) throw failed();
      names.add(name);
      this.skipWhitespace();
      if (!this.consume(":")) throw failed();
      this.readValue();
      this.skipWhitespace();
      if (this.consume("}")) return;
      if (!this.consume(",")) throw failed();
    }
  }

  private readArray(): void {
    this.index += 1;
    this.skipWhitespace();
    if (this.consume("]")) return;
    while (true) {
      this.readValue();
      this.skipWhitespace();
      if (this.consume("]")) return;
      if (!this.consume(",")) throw failed();
    }
  }

  private readString(): string {
    if (!this.consume('"')) throw failed();
    let value = "";
    while (this.index < this.text.length) {
      const character = this.text[this.index];
      this.index += 1;
      if (character === '"') return value;
      if (character === undefined || character.charCodeAt(0) <= 0x1f) throw failed();
      if (character !== "\\") {
        value += character;
        continue;
      }
      value += this.readEscape();
    }
    throw failed();
  }

  private readEscape(): string {
    const escape = this.text[this.index];
    this.index += 1;
    switch (escape) {
      case '"': return '"';
      case "\\": return "\\";
      case "/": return "/";
      case "b": return "\b";
      case "f": return "\f";
      case "n": return "\n";
      case "r": return "\r";
      case "t": return "\t";
      case "u": return this.readUnicodeEscape();
      default: throw failed();
    }
  }

  private readUnicodeEscape(): string {
    const hex = this.text.slice(this.index, this.index + 4);
    if (!/^[0-9a-fA-F]{4}$/u.test(hex)) throw failed();
    this.index += 4;
    return String.fromCharCode(Number.parseInt(hex, 16));
  }

  private readLiteral(literal: string): void {
    if (!this.text.startsWith(literal, this.index)) throw failed();
    this.index += literal.length;
  }

  private readNumber(): void {
    JSON_NUMBER.lastIndex = this.index;
    const match = JSON_NUMBER.exec(this.text);
    if (match === null) throw failed();
    this.index = JSON_NUMBER.lastIndex;
  }

  private skipWhitespace(): void {
    while (
      this.text[this.index] === " " ||
      this.text[this.index] === "\n" ||
      this.text[this.index] === "\r" ||
      this.text[this.index] === "\t"
    ) this.index += 1;
  }

  private consume(character: string): boolean {
    if (this.text[this.index] !== character) return false;
    this.index += 1;
    return true;
  }
}

function readUuid(value: unknown): string {
  if (typeof value !== "string" || !UUID.test(value)) throw failed();
  return value;
}

function readFixtureText(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    new TextEncoder().encode(value).byteLength > ONBOARDING_SESSION_LIMITS.maxMessageUtf8Bytes
  ) throw failed();
  return value;
}

function readMonotonicClock(clock: () => number): number {
  const value = clock();
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw failed();
  return value;
}

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== "object" ||
    types.isProxy(value) ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) ||
    Object.getOwnPropertySymbols(value).length !== 0
  ) throw failed();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (
    Object.keys(descriptors).length !== keys.length ||
    !keys.every((key) => key in descriptors)
  ) throw failed();
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
      throw failed();
    }
    result[key] = descriptor.value;
  }
  return result;
}

function denseArray(value: unknown, maximumLength: number): readonly unknown[] {
  if (
    types.isProxy(value) ||
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    Object.getOwnPropertySymbols(value).length !== 0 ||
    value.length > maximumLength
  ) throw failed();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const result: unknown[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
      throw failed();
    }
    result.push(descriptor.value);
  }
  const allowed = new Set([
    ...Array.from({ length: value.length }, (_, index) => String(index)),
    "length",
  ]);
  if (Object.keys(descriptors).some((key) => !allowed.has(key))) throw failed();
  return result;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw failed();
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = exactRecord(value, Object.keys(value));
    return `{${Object.keys(record).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  throw failed();
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

async function writeArtifactAtomically(
  artifactPath: string,
  artifact: OnboardingJourneyTimingArtifact,
): Promise<void> {
  await mkdir(dirname(artifactPath), { recursive: true });
  const temporaryPath = resolve(
    dirname(artifactPath),
    `.${basename(artifactPath)}.${process.pid}.${randomUUID()}.tmp`,
  );
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(temporaryPath, "wx", 0o600);
    await handle.chmod(0o600);
    await handle.writeFile(`${canonicalJson(artifact)}\n`, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporaryPath, artifactPath);
  } finally {
    await handle?.close().catch(() => undefined);
    await rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function failed(): OnboardingJourneyTimingError {
  return new OnboardingJourneyTimingError();
}

async function runFinalProjectLiveModelGate(artifactPath: string): Promise<void> {
  try {
    const fixtureBytes = new Uint8Array(await readFile(CANONICAL_FIXTURE_URL));
    const fixture = readOnboardingCanonicalJourneyFixture(fixtureBytes);
    await registerNodeCodexRuntime();
    const production = await prepareProductionJourney(fixture);
    try {
      await runOnboardingJourneyTimingForTest({
        artifactPath,
        fixtureBytes,
        modelVersions: production.modelVersions,
        runCanonicalJourney: production.run,
        monotonicNowMs: () => performance.now(),
      });
    } finally {
      production.close();
    }
  } catch {
    await rm(artifactPath, { force: true }).catch(() => undefined);
    throw failed();
  }
}

async function main(): Promise<void> {
  const result = await runOnboardingJourneyTimingEntrypointForTest({
    rawArguments: process.argv.slice(2),
    runFinalProjectLiveModelGate,
  });
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  process.exitCode = result.exitCode;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().catch(() => {
    process.stderr.write(`${FIXED_FAILURE}\n`);
    process.exitCode = 1;
  });
}
