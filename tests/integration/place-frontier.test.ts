import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import { describe, expect, test, vi } from "vitest";

import {
  countryCheckRunId,
  createPlaceFrontierApplication,
  projectTerminalSummary,
  type CountryVerifierPort,
  type FrontierMarker,
  type PlaceFrontierApplicationPorts,
  type PlaceFrontierEvent,
  type RankingSnapshot,
  type ShortlistSnapshot,
} from "../../src/application/place-frontier";
import type {
  ConfirmedOnboardingFrontierPort,
  OnboardingConfirmationReadPort,
  OnboardingModelVersions,
  OnboardingReceipt,
  VerifiedOnboardingConfirmation,
} from "../../src/application/onboarding-contracts";
import {
  ONBOARDING_MODEL_VERSIONS_V1,
  ONBOARDING_MODEL_VERSIONS_V2,
} from "../../src/application/onboarding-model-versions";
import type { ColdStartEvent } from "../../src/application/cold-start";
import {
  countryVerificationReplayExpectation,
  materializeFrontierMarker,
  type CountryVerificationProgress,
  type CountryVerificationResult,
} from "../../src/application/country-verifier";
import type { FormalEvidenceReference, FormalResidenceVerdict } from
  "../../src/decision/formal-residence-verdict";
import { assessFormalResidence } from "../../src/decision/formal-residence-verdict";
import {
  rankPlaces,
  rankPlacesForVerifiedPreferences,
  type RankablePlace,
  type RankedPlace,
} from
  "../../src/decision/place-ranker";
import { CITY_PREFERENCE_IDS, COUNTRY_PREFERENCE_IDS } from
  "../../src/decision/onboarding-catalog";
import {
  applyQuestionnaireFieldChange,
  confirmOnboardingValues,
  createOnboardingDraft,
  type ConfirmedOnboardingValues,
  type OnboardingDraft,
  type OnboardingFieldId,
} from "../../src/decision/onboarding-questionnaire";
import type {
  PreferenceProfileDraft,
  PreferenceProfileSnapshot,
  PreferenceProfileV2Snapshot,
} from "../../src/decision/preference-profile";
import {
  confirmPreferenceProfile,
  materializePreferenceProfileV2,
} from "../../src/decision/preference-profile";
import type {
  RelocationProfileDraft,
  RelocationProfileSnapshot,
  RelocationProfileV2Snapshot,
} from "../../src/decision/relocation-profile";
import {
  confirmRelocationProfile,
  materializeRelocationProfileV2,
} from "../../src/decision/relocation-profile";
import { canonicalJson, createEvidenceIntegrity } from "../../src/infrastructure/integrity";
import { createColdStartComposition } from "../../src/infrastructure/cold-start-composition";
import * as coldStartCompositionExports from
  "../../src/infrastructure/cold-start-composition";
import * as coldStartApplicationExports from "../../src/application/cold-start";
import { createPlaceFrontierComposition } from
  "../../src/infrastructure/place-frontier-composition";
import { normalizeCountryVerificationProgress } from
  "../../src/infrastructure/country-verifier-adapter";
import { createCountryVerifierAdapter } from
  "../../src/infrastructure/country-verifier-adapter";
import {
  initialPlaceFrontierEventState,
  reducePlaceFrontierEvent,
} from "../../src/experience/place-frontier-stream";
import { openEvidenceDatabase } from "../../src/infrastructure/sqlite/db";
import { SqlitePlaceFrontierStore } from
  "../../src/infrastructure/sqlite/place-frontier-store";
import { SqliteOnboardingStore } from
  "../../src/infrastructure/sqlite/onboarding-store";
import { insertRelocationV2Snapshot, SqliteProfileStore } from
  "../../src/infrastructure/sqlite/profile-store";

const NOW = "2026-08-12T08:00:00.000Z";
const DAY = "2026-08-12";
const HMAC_KEY = "frontier-test-key";
const ONBOARDING_SELF_ID = "00000000-0000-4000-8000-000000000201";
const ONBOARDING_COMMAND_ID = "00000000-0000-4000-8000-000000000210";
const ONBOARDING_VERSIONS: OnboardingModelVersions = ONBOARDING_MODEL_VERSIONS_V2;

const relocationProfile: RelocationProfileDraft = {
  currentCountryCode: "RU",
  citizenships: ["RU"],
  monthlyIncome: { amount: "250000", currency: "RUB", basis: "net" },
  remoteWork: { relation: "foreign_employment", legallyAllowed: true },
  education: "higher",
  relevantExperienceYears: 5,
  passportValidUntil: "2030-01-01",
  healthInsurance: "confirmed",
  companions: [],
};

const preferenceProfile: PreferenceProfileDraft = {
  criteria: [{
    id: "personal_safety",
    mode: "weighted",
    importance: 5,
    target: "maximize",
  }],
};

function reference(countryCode: string, evidenceSnapshotId: string): FormalEvidenceReference {
  return {
    evidenceSnapshotId,
    artifactId: `artifact-${countryCode}`,
    sourceId: `source-${countryCode}`,
    navigationUrl: `https://example.test/${countryCode}`,
    resolvedEvidenceUrl: `https://example.test/${countryCode}.pdf`,
    sourcePeriod: "2026-08",
    locator: `section-${countryCode}`,
    excerptSha256: "a".repeat(64),
    validatorVersion: "fixture-validator@1",
  };
}

function viableVerdict(countryCode: string, evidenceSnapshotId: string): FormalResidenceVerdict {
  const proof = reference(countryCode, evidenceSnapshotId);
  const reason = {
    code: `${countryCode}_route_viable`,
    summary: `${countryCode} route is viable`,
    claimIds: [`claim-${countryCode}`],
    evidence: [proof],
    navigation: [],
  };
  return {
    rulesVersion: "formal-residence@1",
    marker: "green",
    verdictAsOf: DAY,
    routeOutcomes: [{
      routeId: `route-${countryCode}`,
      status: "viable",
      ruleEffectiveFrom: "2026-01-01",
      reasons: [reason],
      evidenceSnapshotIds: [evidenceSnapshotId],
      proceduralActions: [],
      contingentActions: [],
    }],
    reasons: [reason],
    catalogCompleteness: {
      status: "unproven",
      reasonCode: "catalog_completeness_unprovable",
    },
  };
}

function unresolvedVerdict(): FormalResidenceVerdict {
  return {
    rulesVersion: "formal-residence@1",
    marker: "yellow",
    verdictAsOf: DAY,
    routeOutcomes: [],
    reasons: [],
    catalogCompleteness: {
      status: "unproven",
      reasonCode: "catalog_completeness_unprovable",
    },
  };
}

function unknownRouteVerdict(): FormalResidenceVerdict {
  return assessFormalResidence({
    profileSnapshotId: "stored-profile",
    verdictAsOf: DAY,
    routes: [{
      routeId: "route-SI",
      status: "unknown",
      reasons: [],
      evidenceSnapshotIds: [],
      proceduralActions: [],
      contingentActions: [],
    }],
  });
}

interface MutableRankedRow {
  relevance: string;
  coverage: string;
  factors: Array<{ match: string; criterionId: string }>;
  contributions: Array<{
    criterionId: string;
    effectiveMatch: string;
    weightedContribution: string;
  }>;
}

function firstRankingRow(payload: Record<string, unknown>): MutableRankedRow {
  return (payload as { ordered: MutableRankedRow[] }).ordered[0]!;
}

function mutateRanking(
  ranking: RankingSnapshot,
  mutate: (payload: Record<string, unknown>) => void,
): RankingSnapshot {
  const payload = structuredClone(ranking) as unknown as Record<string, unknown>;
  mutate(payload);
  return payload as unknown as RankingSnapshot;
}

function completeAllImpossibleVerdict(
  countryCode: string,
  profileId: string,
  evidenceSnapshotId: string,
): FormalResidenceVerdict {
  const proof = reference(countryCode, evidenceSnapshotId);
  return {
    rulesVersion: "formal-residence@1",
    marker: "red",
    verdictAsOf: DAY,
    routeOutcomes: [],
    reasons: [],
    catalogCompleteness: {
      status: "verified",
      attestation: {
        catalogRevisionId: `catalog-${countryCode}`,
        jurisdiction: countryCode,
        authority: `authority-${countryCode}`,
        scopeKind: "all_long_term_residence_routes_for_profile",
        profileSnapshotId: profileId,
        catalogRoutes: [{
          routeId: `excluded-${countryCode}`,
          applicability: "excluded",
          exclusionCode: "profile_not_eligible",
          claimIds: [`excluded-claim-${countryCode}`],
          evidence: [proof],
        }],
        validatorVersion: "catalog-validator@1",
        effectiveFrom: "2026-01-01",
        evidenceSnapshotId,
        catalogEvidence: [proof],
      },
    },
  };
}

function rankedPlace(
  countryCode: string,
  rank: number,
  draft: PreferenceProfileDraft = preferenceProfile,
): RankedPlace {
  return {
    countryCode,
    label: countryCode,
    flag: `flag-${countryCode}`,
    coordinate: { lat: 40 + rank, lng: 10 + rank },
    factors: draft.criteria.map((criterion) => ({
      criterionId: criterion.id,
      state: "known",
      match: "1",
      observationId: `observation-${countryCode}`,
      evaluatorVersion: "fixture-factor@1",
      ...(criterion.mode === "required" ? { requirementStatus: "matches" as const } : {}),
    })),
    rank,
    relevance: "1",
    coverage: "1",
    contributions: draft.criteria.map((criterion) => ({
      criterionId: criterion.id,
      state: "known",
      effectiveMatch: "1",
      weightedContribution: String(criterion.importance),
      observationId: `observation-${countryCode}`,
    })),
  };
}

function assessmentProjectionV2(
  profileSnapshotId: string,
  evidenceSnapshotId: string,
) {
  return {
    schemaVersion: "country-assessment-projection@2" as const,
    profileSnapshotId,
    evidenceSnapshotId,
    participantAssessments: [
      {
        routeId: "route-SI",
        participantId: "participant-self",
        relationship: "self" as const,
        status: "unknown" as const,
        reasonCodes: ["remote_work_prerequisite_unknown" as const],
        claimIds: ["claim-remote-work"],
      },
      {
        routeId: "route-SI",
        participantId: "participant-spouse",
        relationship: "spouse" as const,
        status: "impossible" as const,
        reasonCodes: ["companion_route_impossible" as const],
        claimIds: ["claim-companion"],
      },
    ],
  };
}

function verificationResultV2(
  profileSnapshotId: string,
  evidenceSnapshotId = "evidence-SI",
  parentRunId = "frontier-run-1",
): CountryVerificationResult {
  const integrity = createEvidenceIntegrity(HMAC_KEY);
  return {
    countryCheckRunId: countryCheckRunId(parentRunId, "SI", integrity),
    sourceAssessmentRulesVersion: "cold-start-assessment@2",
    verdict: unresolvedVerdict(),
    evidenceSnapshotId,
    lastCheckedAt: DAY,
    assessmentProjection: assessmentProjectionV2(profileSnapshotId, evidenceSnapshotId),
  };
}

function presentationFromVerification(
  result: CountryVerificationResult,
): Awaited<ReturnType<CountryVerifierPort["present"]>> {
  const common = {
    verdict: result.verdict,
    evidenceSnapshotId: result.evidenceSnapshotId,
    ...(result.currentKnowledgeRevisionId === undefined ? {} : {
      currentKnowledgeRevisionId: result.currentKnowledgeRevisionId,
    }),
    ...(result.updatedKnowledgeRevisionId === undefined ? {} : {
      updatedKnowledgeRevisionId: result.updatedKnowledgeRevisionId,
    }),
    ...(result.knowledgeUpdatedAt === undefined ? {} : {
      knowledgeUpdatedAt: result.knowledgeUpdatedAt,
    }),
    lastCheckedAt: result.lastCheckedAt,
  };
  if (result.sourceAssessmentRulesVersion === "cold-start-assessment@1") {
    return structuredClone({
      sourceAssessmentRulesVersion: result.sourceAssessmentRulesVersion,
      ...common,
    });
  }
  return structuredClone({
    sourceAssessmentRulesVersion: result.sourceAssessmentRulesVersion,
    ...common,
    assessmentProjection: result.assessmentProjection,
  });
}

interface HarnessOptions {
  readonly rankedCountries: readonly string[];
  readonly markerByCountry?: Readonly<Record<string, "green" | "yellow" | "red">>;
  readonly knowledgeRevisionIds?: Readonly<Record<string, string | null>>;
  readonly failCheckFor?: string;
  readonly progressEvents?: readonly CountryVerificationProgress[];
  readonly mutateCheckResult?: (result: Awaited<ReturnType<CountryVerifierPort["check"]>>) => unknown;
  readonly publishKnowledgeDuringCheck?: boolean;
  readonly abortDuringCheck?: AbortController;
  readonly failShortlistAppend?: boolean;
  readonly preferenceProfile?: PreferenceProfileDraft;
  readonly rankingPlaces?: readonly RankablePlace[];
  readonly useCanonicalRanking?: boolean;
  readonly clock?: () => Date;
}

function harness(options: HarnessOptions) {
  const preferenceDraft = options.preferenceProfile ?? preferenceProfile;
  const database = openEvidenceDatabase(":memory:");
  const integrity = createEvidenceIntegrity(HMAC_KEY);
  const profiles = new Map<string, unknown>();
  const preferences = new Map<string, unknown>();
  const preferenceLoader = {
    loadPreferenceVerified: async (id: string) => {
      const snapshot = preferences.get(id);
      if (snapshot === undefined) throw new Error("profile_not_found");
      return structuredClone(snapshot) as PreferenceProfileSnapshot;
    },
    loadPreferenceForRankingVerified: async (id: string) => {
      const snapshot = preferences.get(id);
      if (snapshot === undefined) throw new Error("profile_not_found");
      return structuredClone(snapshot) as PreferenceProfileSnapshot | PreferenceProfileV2Snapshot;
    },
  };
  const store = new SqlitePlaceFrontierStore(database, HMAC_KEY, preferenceLoader);
  const checks: string[] = [];
  const verifierResults = new Map<string, Awaited<ReturnType<CountryVerifierPort["check"]>>>();
  const knowledgeOwners = new Map<string, string>();
  for (const id of Object.values(options.knowledgeRevisionIds ?? {})) {
    if (id !== null) knowledgeOwners.set(id, id.split(":").at(-1)!);
  }
  let rankCalls = 0;
  let currentInputCalls = 0;
  let presentCalls = 0;

  const ports: PlaceFrontierApplicationPorts = {
    onboardingConfirmations: {
      loadBySnapshotBindingsVerified: async () => {
        throw new Error("unexpected_onboarding_confirmation_load");
      },
    },
    profiles: {
      appendRelocation: async (snapshot) => { profiles.set(snapshot.id, snapshot); },
      loadRelocationVerified: async (id) => {
        const snapshot = profiles.get(id);
        if (snapshot === undefined) throw new Error("profile_not_found");
        return structuredClone(snapshot) as never;
      },
      loadRelocationAnyVerified: async (id) => {
        const snapshot = profiles.get(id);
        if (snapshot === undefined) throw new Error("profile_not_found");
        return structuredClone(snapshot) as never;
      },
      appendPreference: async (snapshot) => { preferences.set(snapshot.id, snapshot); },
      loadPreferenceVerified: preferenceLoader.loadPreferenceVerified,
      loadPreferenceForRankingVerified: preferenceLoader.loadPreferenceForRankingVerified,
    },
    rankingInputs: {
      freezeCurrent: async () => {
        currentInputCalls += 1;
        return {
          places: options.rankingPlaces ?? options.rankedCountries.map((countryCode, index) =>
            rankedPlace(countryCode, index + 1, preferenceDraft)),
          knowledgeRevisionIds: options.knowledgeRevisionIds ?? Object.fromEntries(
            options.rankedCountries.map((countryCode) => [countryCode, null]),
          ),
        };
      },
    },
    rank: (input) => {
      rankCalls += 1;
      if (options.useCanonicalRanking) return rankPlaces(input);
      return {
        ordered: input.places.map((place, index) =>
          rankedPlace(place.countryCode, index + 1, preferenceDraft)),
        excluded: [],
        rulesVersion: "place-ranker@1",
      };
    },
    store: options.failShortlistAppend
      ? {
          appendRanking: (snapshot) => store.appendRanking(snapshot),
          insertOrLoadRanking: (snapshot) => store.insertOrLoadRanking(snapshot),
          appendShortlist: async () => { throw new Error("storage_failed"); },
          loadRankingVerified: (id) => store.loadRankingVerified(id),
          loadRankingVerifiedIfPresent: (id) => store.loadRankingVerifiedIfPresent(id),
          loadShortlistVerified: (runId) => store.loadShortlistVerified(runId),
          loadShortlistVerifiedIfPresent: (runId) =>
            store.loadShortlistVerifiedIfPresent(runId),
        }
      : store,
    knowledge: {
      loadVerified: async (id) => ({ id, countryCode: knowledgeOwners.get(id) ?? id.split(":").at(-1)! }),
    },
    verifier: {
      check: async ({ country, profileId, parentRunId, emitProgress }) => {
        checks.push(country.countryCode);
        if (options.failCheckFor === country.countryCode) throw new Error("verification_failed");
        for (const progress of options.progressEvents ?? []) await emitProgress(progress);
        const evidenceSnapshotId = `evidence-${country.countryCode}`;
        const marker = options.markerByCountry?.[country.countryCode] ?? "green";
        const verdict = marker === "green"
          ? viableVerdict(country.countryCode, evidenceSnapshotId)
          : marker === "red"
            ? completeAllImpossibleVerdict(country.countryCode, profileId, evidenceSnapshotId)
            : unresolvedVerdict();
        const publishedKnowledgeId = `knowledge-published:${country.countryCode}`;
        if (options.publishKnowledgeDuringCheck) {
          knowledgeOwners.set(publishedKnowledgeId, country.countryCode);
        }
        const result = {
          countryCheckRunId: countryCheckRunId(parentRunId, country.countryCode, integrity),
          sourceAssessmentRulesVersion: "cold-start-assessment@1" as const,
          verdict,
          evidenceSnapshotId,
          ...(options.publishKnowledgeDuringCheck
            ? {
                currentKnowledgeRevisionId: publishedKnowledgeId,
                updatedKnowledgeRevisionId: publishedKnowledgeId,
                knowledgeUpdatedAt: NOW,
              }
            : {}),
          lastCheckedAt: DAY,
        };
        options.abortDuringCheck?.abort(new DOMException("aborted", "AbortError"));
        const checked = (options.mutateCheckResult?.(result) ?? result) as
          Awaited<ReturnType<CountryVerifierPort["check"]>>;
        verifierResults.set(country.countryCode, checked);
        return checked;
      },
      present: async ({ parentRunId, countryCode, countryCheckRunId: childRunId }) => {
        presentCalls += 1;
        if (childRunId !== countryCheckRunId(parentRunId, countryCode, integrity)) {
          throw new Error("integrity_mismatch");
        }
        const result = verifierResults.get(countryCode);
        if (result === undefined) throw new Error("integrity_mismatch");
        return presentationFromVerification(result);
      },
    },
    integrity,
    clock: options.clock ?? (() => new Date(NOW)),
    nextRunId: () => "frontier-run-1",
  };
  const application = createPlaceFrontierApplication(ports);

  return {
    application,
    database,
    store,
    checks,
    verifierResults,
    profiles,
    preferences,
    knowledgeOwners,
    counts: {
      rank: () => rankCalls,
      currentInput: () => currentInputCalls,
      present: () => presentCalls,
    },
    async prepare() {
      return application.preparePlaceFrontier({
        profile: relocationProfile,
        preferences: preferenceDraft,
      });
    },
    async run() {
      const prepared = await this.prepare();
      const events: PlaceFrontierEvent[] = [];
      const result = await application.runPlaceFrontier(
        prepared,
        (event) => { events.push(event); },
        new AbortController().signal,
      );
      return { prepared, result, events };
    },
  };
}

function requiredPlace(
  countryCode: string,
  requirementStatus: "matches" | "does_not_match",
): RankablePlace {
  return {
    countryCode,
    label: countryCode,
    flag: `flag-${countryCode}`,
    coordinate: { lat: 46, lng: 14 },
    factors: (["outside_cis", "europe"] as const).map((criterionId) => ({
      criterionId,
      state: "known" as const,
      match: requirementStatus === "matches" ? "1" : "-1",
      requirementStatus,
      observationId: `observation-${countryCode}-${criterionId}`,
      evaluatorVersion: "fixture-factor@1",
    })),
  };
}

function v2PreferenceSnapshot(): PreferenceProfileV2Snapshot {
  return materializePreferenceProfileV2({
    confirmedAt: NOW,
    preferences: {
      schemaVersion: "preference-profile@2",
      countryCriteria: [
        { id: "outside_cis", mode: "required", importance: 5, target: "required_true" },
        { id: "europe", mode: "weighted", importance: 4, target: "maximize" },
        { id: "personal_safety", mode: "weighted", importance: 5, target: "maximize" },
        { id: "infrastructure", mode: "weighted", importance: 3, target: "maximize" },
        { id: "peace_and_stability", mode: "required", importance: 2, target: "required_true" },
      ],
      cityCriteria: [
        { id: "safety", mode: "required", importance: 5, target: "low crime" },
        { id: "long_term_rent", mode: "weighted", importance: 4, target: "under 1200 EUR" },
        { id: "urban_transit", mode: "weighted", importance: 3, target: "frequent" },
        { id: "fixed_broadband", mode: "weighted", importance: 2, target: "500 Mbps" },
      ],
    },
  });
}

function v2RankablePlace(countryCode: string, match: string): RankablePlace {
  return {
    countryCode,
    label: countryCode,
    flag: `flag-${countryCode}`,
    coordinate: { lat: 46, lng: 14 },
    factors: [
      {
        criterionId: "outside_cis",
        state: "known",
        match: "1",
        requirementStatus: "matches",
        observationId: `observation-${countryCode}-outside-cis`,
        evaluatorVersion: "fixture-factor@1",
      },
      ...(["europe", "personal_safety", "infrastructure"] as const).map((criterionId) => ({
        criterionId,
        state: "known" as const,
        match,
        observationId: `observation-${countryCode}-${criterionId}`,
        evaluatorVersion: "fixture-factor@1",
      })),
      {
        criterionId: "peace_and_stability",
        state: "known",
        match: "1",
        requirementStatus: "matches",
        observationId: `observation-${countryCode}-peace`,
        evaluatorVersion: "fixture-factor@1",
      },
    ],
  };
}

function v2RelocationSnapshot(): RelocationProfileV2Snapshot {
  return materializeRelocationProfileV2({
    confirmedAt: NOW,
    profile: {
      schemaVersion: "relocation-profile@2",
      profile: {
        currentLocation: { countryCode: "RU", city: "Moscow" },
        moveHorizon: "within_3_months",
        movingParty: "alone",
        participants: [{
          participantId: "00000000-0000-4000-8000-000000000101",
          relationship: "self",
          citizenships: ["RU"],
          passport: { validUntil: "2030-01-01" },
          currentWork: {
            applicability: "required",
            value: { status: "employment", occupation: "Engineer" },
          },
          remoteContinuation: { applicability: "required", value: "yes" },
          monthlyIncome: {
            applicability: "required",
            value: { amount: "3000", currency: "EUR", basis: "net" },
          },
          education: {
            applicability: "required",
            value: { level: "higher", field: "Engineering" },
          },
          relevantExperienceYears: { applicability: "required", value: 8 },
        }],
        savings: { min: "10000", max: "20000", currency: "EUR" },
      },
    },
  });
}

function setOnboardingField(
  draft: OnboardingDraft,
  fieldId: OnboardingFieldId,
  rawInput: unknown,
): OnboardingDraft {
  return applyQuestionnaireFieldChange(draft, { kind: "manual_set", fieldId, rawInput });
}

function confirmedOnboardingValues(): ConfirmedOnboardingValues {
  let draft = createOnboardingDraft(() => ONBOARDING_SELF_ID);
  draft = setOnboardingField(draft, "current_location", { countryCode: "RU", city: "Moscow" });
  draft = setOnboardingField(draft, "move_horizon", "within_3_months");
  draft = setOnboardingField(draft, "moving_party", "alone");
  draft = setOnboardingField(draft, "savings", { min: "10000", max: "20000", currency: "EUR" });
  draft = setOnboardingField(
    draft,
    `participants.${ONBOARDING_SELF_ID}.citizenships`,
    ["RU"],
  );
  draft = setOnboardingField(draft, `participants.${ONBOARDING_SELF_ID}.passport`, {
    validUntil: "2030-01-01",
  });
  draft = setOnboardingField(draft, `participants.${ONBOARDING_SELF_ID}.current_work`, {
    status: "employment",
    occupation: "Engineer",
  });
  draft = setOnboardingField(
    draft,
    `participants.${ONBOARDING_SELF_ID}.remote_continuation`,
    "yes",
  );
  draft = setOnboardingField(draft, `participants.${ONBOARDING_SELF_ID}.monthly_income`, {
    amount: "3000",
    currency: "EUR",
    basis: "net",
  });
  draft = setOnboardingField(draft, `participants.${ONBOARDING_SELF_ID}.education`, {
    level: "higher",
    field: "Engineering",
  });
  draft = setOnboardingField(
    draft,
    `participants.${ONBOARDING_SELF_ID}.relevant_experience_years`,
    8,
  );
  for (const criterionId of COUNTRY_PREFERENCE_IDS) {
    const required = criterionId === "outside_cis" || criterionId === "peace_and_stability";
    draft = setOnboardingField(
      draft,
      `country_preferences.${criterionId}.mode`,
      required ? "required" : "weighted",
    );
    draft = setOnboardingField(draft, `country_preferences.${criterionId}.importance`, 3);
    draft = setOnboardingField(
      draft,
      `country_preferences.${criterionId}.target`,
      required ? "required_true" : "maximize",
    );
  }
  for (const criterionId of CITY_PREFERENCE_IDS) {
    draft = setOnboardingField(draft, `city_preferences.${criterionId}.mode`, "weighted");
    draft = setOnboardingField(draft, `city_preferences.${criterionId}.importance`, 3);
    draft = setOnboardingField(
      draft,
      `city_preferences.${criterionId}.target`,
      `${criterionId}-target`,
    );
  }
  return confirmOnboardingValues(draft);
}

interface FuturePlaceFrontierStore {
  appendRanking(snapshot: RankingSnapshot): Promise<void>;
  insertOrLoadRanking(snapshot: RankingSnapshot): Promise<RankingSnapshot>;
  appendShortlist(snapshot: ShortlistSnapshot): Promise<void>;
  loadRankingVerified(idOrRunId: string): Promise<RankingSnapshot>;
  loadRankingVerifiedIfPresent(idOrRunId: string): Promise<RankingSnapshot | undefined>;
  loadShortlistVerified(idOrRunId: string): Promise<ShortlistSnapshot>;
  loadShortlistVerifiedIfPresent(idOrRunId: string): Promise<ShortlistSnapshot | undefined>;
}

interface ReceiptHarnessOptions {
  readonly completionCommandId?: string;
  readonly versions?: OnboardingModelVersions;
  readonly transformConfirmation?: (
    confirmation: VerifiedOnboardingConfirmation,
  ) => VerifiedOnboardingConfirmation;
  readonly places?: readonly RankablePlace[];
}

async function receiptHarness(options: ReceiptHarnessOptions = {}) {
  const database = openEvidenceDatabase(":memory:");
  const onboardingStore = new SqliteOnboardingStore(database, HMAC_KEY, {
    clock: () => new Date(NOW),
  });
  const confirmed = confirmedOnboardingValues();
  const receipt = await onboardingStore.commitOrReplay({
    completionCommandId: options.completionCommandId ?? ONBOARDING_COMMAND_ID,
    confirmed,
    versions: options.versions ?? ONBOARDING_VERSIONS,
  });
  const profiles = new SqliteProfileStore(database);
  const placeStore = new SqlitePlaceFrontierStore(database, HMAC_KEY, profiles) as
    SqlitePlaceFrontierStore & FuturePlaceFrontierStore;
  let confirmationReads = 0;
  let freezes = 0;
  let ranks = 0;
  let inserts = 0;
  let rankingReads = 0;
  let clockReads = 0;
  let nextIdReads = 0;
  const onboardingConfirmations: OnboardingConfirmationReadPort = {
    loadBySnapshotBindingsVerified: async (bindings) => {
      confirmationReads += 1;
      const verified = await onboardingStore.loadBySnapshotBindingsVerified(bindings);
      return options.transformConfirmation?.(verified) ?? verified;
    },
  };
  const store: FuturePlaceFrontierStore = {
    appendRanking: (snapshot) => placeStore.appendRanking(snapshot),
    insertOrLoadRanking: async (snapshot) => {
      inserts += 1;
      return placeStore.insertOrLoadRanking(snapshot);
    },
    appendShortlist: (snapshot) => placeStore.appendShortlist(snapshot),
    loadRankingVerified: (id) => placeStore.loadRankingVerified(id),
    loadRankingVerifiedIfPresent: (id) => {
      rankingReads += 1;
      return placeStore.loadRankingVerifiedIfPresent(id);
    },
    loadShortlistVerified: (id) => placeStore.loadShortlistVerified(id),
    loadShortlistVerifiedIfPresent: (id) => placeStore.loadShortlistVerifiedIfPresent(id),
  };
  const application = createPlaceFrontierApplication({
    onboardingConfirmations,
    profiles,
    rankingInputs: {
      freezeCurrent: async () => {
        freezes += 1;
        const places = options.places ?? [v2RankablePlace("SI", "1"), v2RankablePlace("DE", "0.5")];
        return {
          places,
          knowledgeRevisionIds: Object.fromEntries(
            places.map(({ countryCode }) => [countryCode, null]),
          ),
        };
      },
    },
    rank: rankPlaces,
    rankVerifiedPreferences: (
      input: Parameters<typeof rankPlacesForVerifiedPreferences>[0],
    ) => {
      ranks += 1;
      return rankPlacesForVerifiedPreferences(input);
    },
    store,
    knowledge: {
      loadVerified: async () => { throw new Error("unexpected_knowledge_load"); },
    },
    verifier: {
      check: async () => { throw new Error("unexpected_verifier_check"); },
      present: async () => { throw new Error("unexpected_verifier_present"); },
    },
    integrity: createEvidenceIntegrity(HMAC_KEY),
    clock: () => {
      clockReads += 1;
      throw new Error("unexpected_clock_read");
    },
    nextRunId: () => {
      nextIdReads += 1;
      throw new Error("unexpected_next_id_read");
    },
  } as unknown as PlaceFrontierApplicationPorts) as ReturnType<
    typeof createPlaceFrontierApplication
  > & ConfirmedOnboardingFrontierPort;

  return {
    application,
    database,
    onboardingStore,
    placeStore,
    profiles,
    confirmed,
    receipt,
    counts: {
      confirmations: () => confirmationReads,
      freezes: () => freezes,
      ranks: () => ranks,
      inserts: () => inserts,
      rankingReads: () => rankingReads,
      clock: () => clockReads,
      nextId: () => nextIdReads,
    },
  };
}

function receiptRanking(
  receipt: OnboardingReceipt,
  confirmation: VerifiedOnboardingConfirmation,
  places: readonly RankablePlace[],
): RankingSnapshot {
  const result = rankPlacesForVerifiedPreferences({
    assessmentAt: receipt.confirmedAt.slice(0, 10),
    preferences: confirmation.preferences,
    places,
  });
  const excludedCodes = new Set(result.excluded.map(({ countryCode }) => countryCode));
  const rankingSnapshotId = `${receipt.frontierRunId}:ranking`;
  const integrity = createEvidenceIntegrity(HMAC_KEY);
  return {
    schemaVersion: "place-ranking@1",
    id: rankingSnapshotId,
    runId: receipt.frontierRunId,
    profileSnapshotId: receipt.profileId,
    preferenceProfileSnapshotId: receipt.preferenceProfileId,
    assessmentAt: receipt.confirmedAt,
    contextHash: integrity.hash(integrity.canonical({
      runId: receipt.frontierRunId,
      profileId: receipt.profileId,
      preferenceProfileId: receipt.preferenceProfileId,
      assessmentAt: receipt.confirmedAt,
      rankingSnapshotId,
    })),
    knowledgeRevisionIds: Object.fromEntries(places.map(({ countryCode }) => [countryCode, null])),
    ordered: result.ordered,
    excludedPlaces: places
      .filter(({ countryCode }) => excludedCodes.has(countryCode))
      .map((place) => structuredClone(place))
      .sort((left, right) => left.countryCode.localeCompare(right.countryCode)),
    excluded: result.excluded,
    rulesVersion: result.rulesVersion,
    createdAt: receipt.confirmedAt,
  };
}

type RelocationSnapshotAny = RelocationProfileSnapshot | RelocationProfileV2Snapshot;
type PreferenceSnapshotAny = PreferenceProfileSnapshot | PreferenceProfileV2Snapshot;

function profilePairHarness(
  initialRelocation: RelocationSnapshotAny,
  initialPreference: PreferenceSnapshotAny,
) {
  const integrity = createEvidenceIntegrity(HMAC_KEY);
  const runId = "profile-pair-frontier-run";
  const rankingSnapshotId = `${runId}:ranking`;
  const contextHash = "profile-pair-context";
  const place = rankedPlace("SI", 1);
  const ranking: RankingSnapshot = {
    schemaVersion: "place-ranking@1",
    id: rankingSnapshotId,
    runId,
    profileSnapshotId: initialRelocation.id,
    preferenceProfileSnapshotId: initialPreference.id,
    assessmentAt: NOW,
    contextHash,
    knowledgeRevisionIds: { SI: null },
    ordered: [place],
    excludedPlaces: [],
    excluded: [],
    rulesVersion: "place-ranker@1",
    createdAt: NOW,
  };
  const prepared = {
    runId,
    profileId: initialRelocation.id,
    preferenceProfileId: initialPreference.id,
    assessmentAt: NOW,
    rankingSnapshotId,
    contextHash,
  };
  let relocation = initialRelocation;
  let preference = initialPreference;
  let shortlist: ShortlistSnapshot | undefined;
  let checkCalls = 0;
  let presentCalls = 0;

  const profiles = {
    appendRelocation: async () => { throw new Error("unexpected_append"); },
    loadRelocationVerified: async () => { throw new Error("v1_relocation_loader_called"); },
    loadRelocationAnyVerified: async () => structuredClone(relocation),
    appendPreference: async () => { throw new Error("unexpected_append"); },
    loadPreferenceVerified: async () => { throw new Error("v1_preference_loader_called"); },
    loadPreferenceForRankingVerified: async () => structuredClone(preference),
  } as unknown as PlaceFrontierApplicationPorts["profiles"];
  const application = createPlaceFrontierApplication({
    onboardingConfirmations: {
      loadBySnapshotBindingsVerified: async () => {
        throw new Error("unexpected_onboarding_confirmation_load");
      },
    },
    profiles,
    rankingInputs: {
      freezeCurrent: async () => { throw new Error("unexpected_ranking_input"); },
    },
    rank: rankPlacesForVerifiedPreferences,
    store: {
      appendRanking: async () => { throw new Error("unexpected_ranking_append"); },
      insertOrLoadRanking: async () => { throw new Error("unexpected_ranking_insert"); },
      appendShortlist: async (snapshot) => { shortlist = structuredClone(snapshot); },
      loadRankingVerified: async () => structuredClone(ranking),
      loadRankingVerifiedIfPresent: async () => structuredClone(ranking),
      loadShortlistVerified: async () => {
        if (shortlist === undefined) throw new Error("shortlist_not_found");
        return structuredClone(shortlist);
      },
      loadShortlistVerifiedIfPresent: async () =>
        shortlist === undefined ? undefined : structuredClone(shortlist),
    },
    knowledge: {
      loadVerified: async () => { throw new Error("unexpected_knowledge_load"); },
    },
    verifier: {
      check: async ({ profileId, parentRunId }) => {
        checkCalls += 1;
        if (relocation.schemaVersion === "relocation-profile@2") {
          return verificationResultV2(profileId, "evidence-SI", parentRunId);
        }
        return {
          countryCheckRunId: countryCheckRunId(parentRunId, "SI", integrity),
          sourceAssessmentRulesVersion: "cold-start-assessment@1",
          verdict: unresolvedVerdict(),
          evidenceSnapshotId: "evidence-SI",
          lastCheckedAt: DAY,
        };
      },
      present: async () => {
        presentCalls += 1;
        if (shortlist === undefined) throw new Error("shortlist_not_found");
        return countryVerificationReplayExpectation(shortlist.markers[0]!);
      },
    },
    integrity,
    clock: () => new Date(NOW),
    nextRunId: () => runId,
  });

  return {
    application,
    prepared,
    replaceProfiles(nextRelocation: RelocationSnapshotAny, nextPreference: PreferenceSnapshotAny) {
      relocation = nextRelocation;
      preference = nextPreference;
    },
    checkCalls: () => checkCalls,
    presentCalls: () => presentCalls,
  };
}

function genuineExcludedHarness() {
  return harness({
    rankedCountries: ["SI", "DE"],
    rankingPlaces: [requiredPlace("SI", "matches"), requiredPlace("DE", "does_not_match")],
    knowledgeRevisionIds: { SI: null, DE: null },
    preferenceProfile: { criteria: [
      { id: "outside_cis", mode: "required", importance: 5, target: "required_true" },
      { id: "europe", mode: "required", importance: 3, target: "required_true" },
    ] },
    useCanonicalRanking: true,
  });
}

function resignSnapshot(
  database: Database.Database,
  kind: "ranking" | "shortlist",
  mutate: (payload: Record<string, unknown>) => void,
): void {
  database.exec("DROP TRIGGER place_frontier_snapshots_no_update");
  const row = database.prepare(`
    SELECT id, payload_json FROM place_frontier_snapshots WHERE kind = ?
  `).get(kind) as { readonly id: string; readonly payload_json: string };
  const payload = JSON.parse(row.payload_json) as Record<string, unknown>;
  mutate(payload);
  const integrity = createEvidenceIntegrity(HMAC_KEY);
  const payloadJson = integrity.canonical(payload);
  database.prepare(`
    UPDATE place_frontier_snapshots
    SET payload_json = ?, payload_hash = ?, hmac = ?
    WHERE id = ?
  `).run(payloadJson, integrity.hash(payloadJson), integrity.sign(payloadJson), row.id);
}

function resignShortlist(
  database: Database.Database,
  mutate: (payload: Record<string, unknown>) => void,
): void {
  resignSnapshot(database, "shortlist", mutate);
}

function resignShortlistCreatedAt(
  database: Database.Database,
  createdAt: string,
): void {
  database.exec("DROP TRIGGER place_frontier_snapshots_no_update");
  const row = database.prepare(`
    SELECT id, payload_json FROM place_frontier_snapshots WHERE kind = 'shortlist'
  `).get() as { readonly id: string; readonly payload_json: string };
  const payload = JSON.parse(row.payload_json) as Record<string, unknown>;
  payload.createdAt = createdAt;
  const integrity = createEvidenceIntegrity(HMAC_KEY);
  const payloadJson = integrity.canonical(payload);
  database.prepare(`
    UPDATE place_frontier_snapshots
    SET payload_json = ?, payload_hash = ?, hmac = ?, created_at = ?
    WHERE id = ?
  `).run(
    payloadJson,
    integrity.hash(payloadJson),
    integrity.sign(payloadJson),
    createdAt,
    row.id,
  );
}

function nonTerminalProgressEvents(): readonly CountryVerificationProgress[] {
  const base = {
    runId: "child-run",
    sequence: 1,
    occurredAt: NOW,
    country: {
      code: "SI" as const,
      englishName: "Slovenia" as const,
      displayName: "Словения" as const,
      flag: "🇸🇮" as const,
      coordinate: { lat: 46.1512 as const, lng: 14.9955 as const },
    },
  };
  const events: readonly Exclude<
    ColdStartEvent,
    { readonly type: "assessment_completed" }
  >[] = [
    { ...base, type: "source_discovered", payload: { candidateId: "candidate-1", url: "https://gov.test/source", claimKinds: ["income"] } },
    { ...base, sequence: 2, type: "authority_verified", payload: { candidateId: "candidate-1", authorityRoot: "https://gov.test" } },
    { ...base, sequence: 3, type: "artifact_captured", payload: { sourceId: "si-income-threshold", role: "official rule", resolvedUrl: "https://gov.test/rule.pdf", sha256: "b".repeat(64) } },
    { ...base, sequence: 4, type: "claim_verified", payload: { claimId: "claim-1", claimKind: "income", sourceIds: ["si-income-threshold"] } },
    { ...base, sequence: 5, type: "dossier_published", payload: { dossierVersionId: "dossier-1", label: "Slovenia dossier", created: true } },
  ];
  return events.map(normalizeCountryVerificationProgress);
}

async function concurrentStoreWrites(input: {
  readonly path: string;
  readonly method: "appendRanking" | "insertOrLoadRanking" | "appendShortlist";
  readonly preference: PreferenceProfileSnapshot | PreferenceProfileV2Snapshot;
  readonly snapshots: readonly [
    RankingSnapshot | ShortlistSnapshot,
    RankingSnapshot | ShortlistSnapshot,
  ];
}): Promise<readonly string[]> {
  const barrier = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
  const state = new Int32Array(barrier);
  const storePath = join(process.cwd(), "src/infrastructure/sqlite/place-frontier-store.ts");
  const workerSource = `
    const { parentPort, workerData } = require("node:worker_threads");
    require("tsx/cjs");
    const Database = require("better-sqlite3");
    const { SqlitePlaceFrontierStore } = require(workerData.storePath);
    const database = new Database(workerData.path);
    database.pragma("foreign_keys = ON");
    const state = new Int32Array(workerData.barrier);
    parentPort.postMessage({ type: "ready" });
    Atomics.wait(state, 0, 0);
    const preferences = {
      loadPreferenceForRankingVerified: async (id) => {
        if (workerData.preference.id !== id) throw new Error("profile_not_found");
        return structuredClone(workerData.preference);
      },
    };
    Promise.resolve(new SqlitePlaceFrontierStore(
      database,
      workerData.key,
      preferences,
    )[workerData.method](
      workerData.snapshot,
    )).then((result) => {
      database.close();
      parentPort.postMessage({
        type: "done",
        result: result === undefined ? undefined : JSON.stringify(result),
      });
    }, (error) => {
      database.close();
      parentPort.postMessage({ type: "error", message: error.message });
    });
  `;
  const workers = input.snapshots.map((snapshot) => new Worker(workerSource, {
    eval: true,
    workerData: {
      path: input.path,
      method: input.method,
      snapshot,
      storePath,
      key: HMAC_KEY,
      preference: input.preference,
      barrier,
    },
  }));
  let ready = 0;
  const outcomes: string[] = [];
  try {
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const timeout = setTimeout(() => {
        settled = true;
        reject(new Error("concurrent_store_write_timeout"));
      }, 10_000);
      const finish = (error?: Error) => {
        if (settled) return;
        if (error !== undefined) {
          settled = true;
          clearTimeout(timeout);
          reject(error);
          return;
        }
        if (outcomes.length === workers.length) {
          settled = true;
          clearTimeout(timeout);
          resolve();
        }
      };
      for (const worker of workers) {
        worker.on("error", (error) => finish(error));
        worker.on("message", (message: {
          readonly type: string;
          readonly message?: string;
          readonly result?: string;
        }) => {
          if (message.type === "ready") {
            ready += 1;
            if (ready === workers.length) {
              Atomics.store(state, 0, 1);
              Atomics.notify(state, 0, workers.length);
            }
            return;
          }
          if (message.type === "error") {
            outcomes.push(message.message ?? "unknown_worker_error");
          } else {
            outcomes.push(message.result ?? "done");
          }
          finish();
        });
      }
    });
  } finally {
    await Promise.all(workers.map((worker) => worker.terminate()));
  }
  return outcomes.sort();
}

describe("Onboarding receipt Place Frontier", () => {
  test("prepares current V2 lineage at its fixed run and time, then fast-replays it", async () => {
    const fixture = await receiptHarness();

    const first = await fixture.application.prepareFromOnboardingReceipt(fixture.receipt);
    expect(first).toEqual({
      runId: fixture.receipt.frontierRunId,
      profileId: fixture.receipt.profileId,
      preferenceProfileId: fixture.receipt.preferenceProfileId,
      assessmentAt: fixture.receipt.confirmedAt,
      rankingSnapshotId: `${fixture.receipt.frontierRunId}:ranking`,
      contextHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    const ranking = await fixture.placeStore.loadRankingVerified(first.rankingSnapshotId);
    expect(ranking).toEqual(expect.objectContaining({
      runId: fixture.receipt.frontierRunId,
      profileSnapshotId: fixture.receipt.profileId,
      preferenceProfileSnapshotId: fixture.receipt.preferenceProfileId,
      assessmentAt: fixture.receipt.confirmedAt,
      createdAt: fixture.receipt.confirmedAt,
    }));
    expect(ranking.ordered[0]?.contributions.map(({ criterionId }) => criterionId)).toEqual([
      "outside_cis",
      "europe",
      "personal_safety",
      "infrastructure",
      "peace_and_stability",
    ]);
    expect(fixture.counts.confirmations()).toBe(1);
    expect(fixture.counts.freezes()).toBe(1);
    expect(fixture.counts.ranks()).toBe(1);
    expect(fixture.counts.inserts()).toBe(1);
    expect(fixture.counts.clock()).toBe(0);
    expect(fixture.counts.nextId()).toBe(0);

    await expect(fixture.application.prepareFromOnboardingReceipt(fixture.receipt))
      .resolves.toEqual(first);
    expect(fixture.counts.confirmations()).toBe(2);
    expect(fixture.counts.freezes()).toBe(1);
    expect(fixture.counts.ranks()).toBe(1);
    expect(fixture.counts.inserts()).toBe(1);
    expect(fixture.counts.clock()).toBe(0);
    expect(fixture.counts.nextId()).toBe(0);
  });

  test("prepares a reopened historical V1 lineage confirmation", async () => {
    // Break caught: allowing only the current tuple at the receipt-to-Frontier boundary.
    const fixture = await receiptHarness({ versions: ONBOARDING_MODEL_VERSIONS_V1 });
    const historical = await fixture.onboardingStore.loadBySnapshotBindingsVerified({
      profileId: fixture.receipt.profileId,
      preferenceProfileId: fixture.receipt.preferenceProfileId,
    });

    const prepared = await fixture.application.prepareFromOnboardingReceipt(fixture.receipt);

    expect(historical.versions).toBe(ONBOARDING_MODEL_VERSIONS_V1);
    expect(prepared).toEqual(expect.objectContaining({
      runId: fixture.receipt.frontierRunId,
      profileId: fixture.receipt.profileId,
      preferenceProfileId: fixture.receipt.preferenceProfileId,
      assessmentAt: fixture.receipt.confirmedAt,
    }));
    expect(fixture.counts.confirmations()).toBe(1);
    expect(fixture.counts.rankingReads()).toBe(1);
    expect(fixture.counts.freezes()).toBe(1);
    expect(fixture.counts.ranks()).toBe(1);
    expect(fixture.counts.inserts()).toBe(1);
  });

  test("accepts an authoritative v7 completion UUID through verified receipt preparation", async () => {
    const fixture = await receiptHarness({
      completionCommandId: "018f3d2e-7b6c-7abc-8def-0123456789ab",
    });

    const prepared = await fixture.application.prepareFromOnboardingReceipt(fixture.receipt);
    expect(prepared).toEqual(expect.objectContaining({
      runId: fixture.receipt.frontierRunId,
      profileId: fixture.receipt.profileId,
      preferenceProfileId: fixture.receipt.preferenceProfileId,
      assessmentAt: fixture.receipt.confirmedAt,
    }));
    expect(fixture.counts.confirmations()).toBe(1);
    expect(fixture.counts.rankingReads()).toBe(1);
    expect(fixture.counts.freezes()).toBe(1);
    expect(fixture.counts.ranks()).toBe(1);
    expect(fixture.counts.inserts()).toBe(1);
  });

  test("rejects non-exact and accessor-backed borrowed receipts without evaluating them", async () => {
    const fixture = await receiptHarness();
    let getterReads = 0;
    const accessorReceipt = { ...fixture.receipt } as Record<string, unknown>;
    Object.defineProperty(accessorReceipt, "profileId", {
      enumerable: true,
      get() {
        getterReads += 1;
        return fixture.receipt.profileId;
      },
    });
    const extraReceipt = { ...fixture.receipt, unexpected: true };

    await expect(fixture.application.prepareFromOnboardingReceipt(
      accessorReceipt as unknown as OnboardingReceipt,
    )).rejects.toThrow("integrity_mismatch");
    await expect(fixture.application.prepareFromOnboardingReceipt(
      extraReceipt as unknown as OnboardingReceipt,
    )).rejects.toThrow("integrity_mismatch");
    expect(getterReads).toBe(0);
    expect(fixture.counts.confirmations()).toBe(0);
    expect(fixture.counts.freezes()).toBe(0);
    expect(fixture.counts.ranks()).toBe(0);
    expect(fixture.counts.inserts()).toBe(0);
  });

  test("rejects a valid forged provenance with its stale receipt digest before ranking access", async () => {
    const fixture = await receiptHarness({
      transformConfirmation: (confirmation) => {
        let changed = false;
        return {
          ...confirmation,
          provenance: {
            ...confirmation.provenance,
            fields: confirmation.provenance.fields.map((field) => {
              if (
                changed || field.applicability !== "required" ||
                field.reviewState !== "accepted" || field.origin !== "manual"
              ) return field;
              changed = true;
              return { ...field, origin: "model" };
            }),
          },
        };
      },
    });

    await expect(fixture.application.prepareFromOnboardingReceipt(fixture.receipt))
      .rejects.toThrow("integrity_mismatch");
    expect(fixture.counts.confirmations()).toBe(1);
    expect(fixture.counts.rankingReads()).toBe(0);
    expect(fixture.counts.freezes()).toBe(0);
    expect(fixture.counts.ranks()).toBe(0);
    expect(fixture.counts.inserts()).toBe(0);
  });

  test.each([
    ["receipt", (value: VerifiedOnboardingConfirmation) => ({
      ...value,
      receipt: { ...value.receipt, confirmationDigest: "f".repeat(64) },
    })],
    ["profile", (value: VerifiedOnboardingConfirmation) => ({
      ...value,
      profile: { ...value.profile, id: "f".repeat(64) },
    })],
    ["preferences", (value: VerifiedOnboardingConfirmation) => ({
      ...value,
      preferences: { ...value.preferences, id: "e".repeat(64) },
    })],
    ["provenance", (value: VerifiedOnboardingConfirmation) => ({
      ...value,
      provenance: { ...value.provenance, fields: value.provenance.fields.slice(1) },
    })],
    ["versions", (value: VerifiedOnboardingConfirmation) => ({
      ...value,
      versions: { ...value.versions, reviewPrompt: "onboarding-review@999" },
    })],
  ] as const)("rejects a verified response with a conflicting %s binding", async (_field, mutate) => {
    const fixture = await receiptHarness({
      transformConfirmation: (confirmation) =>
        mutate(confirmation) as unknown as VerifiedOnboardingConfirmation,
    });

    await expect(fixture.application.prepareFromOnboardingReceipt(fixture.receipt))
      .rejects.toThrow("integrity_mismatch");
    expect(fixture.counts.rankingReads()).toBe(0);
    expect(fixture.counts.freezes()).toBe(0);
    expect(fixture.counts.ranks()).toBe(0);
    expect(fixture.counts.inserts()).toBe(0);
  });

  test.each([
    ["V2 prompt with V1 schema", {
      ...ONBOARDING_MODEL_VERSIONS_V1,
      extractionPrompt: ONBOARDING_MODEL_VERSIONS_V2.extractionPrompt,
    }],
    ["V1 prompt with V2 schema", {
      ...ONBOARDING_MODEL_VERSIONS_V1,
      extractionSchema: ONBOARDING_MODEL_VERSIONS_V2.extractionSchema,
    }],
  ] as const)("rejects the %s hybrid before ranking reads or writes", async (
    _hybridName,
    versions,
  ) => {
    // Break caught: independently accepting prompt and schema labels at Frontier.
    const fixture = await receiptHarness({
      transformConfirmation: (confirmation) => ({
        ...confirmation,
        versions: versions as unknown as OnboardingModelVersions,
      }),
    });

    await expect(fixture.application.prepareFromOnboardingReceipt(fixture.receipt))
      .rejects.toThrow("integrity_mismatch");
    expect(fixture.counts.confirmations()).toBe(1);
    expect(fixture.counts.rankingReads()).toBe(0);
    expect(fixture.counts.freezes()).toBe(0);
    expect(fixture.counts.ranks()).toBe(0);
    expect(fixture.counts.inserts()).toBe(0);
  });

  test("rejects decorated version tuples before ranking reads or writes", async () => {
    // Break caught: normalizing missing, extra, symbol, accessor, or custom-prototype metadata.
    let accessorReads = 0;
    const accessor = { ...ONBOARDING_MODEL_VERSIONS_V2 } as Record<string, unknown>;
    Object.defineProperty(accessor, "extractionSchema", {
      enumerable: true,
      get: () => {
        accessorReads += 1;
        return ONBOARDING_MODEL_VERSIONS_V2.extractionSchema;
      },
    });
    const missing = { ...ONBOARDING_MODEL_VERSIONS_V2 } as Record<string, unknown>;
    delete missing.reviewSchema;
    const symbol = Symbol("decorated");
    const customPrototype = Object.assign(
      Object.create({ inherited: true }) as Record<string, unknown>,
      ONBOARDING_MODEL_VERSIONS_V2,
    );
    const invalidTuples: readonly unknown[] = [
      { ...ONBOARDING_MODEL_VERSIONS_V2, unexpected: true },
      missing,
      { ...ONBOARDING_MODEL_VERSIONS_V2, [symbol]: true },
      accessor,
      customPrototype,
    ];

    for (const versions of invalidTuples) {
      const fixture = await receiptHarness({
        transformConfirmation: (confirmation) => ({
          ...confirmation,
          versions: versions as OnboardingModelVersions,
        }),
      });
      await expect(fixture.application.prepareFromOnboardingReceipt(fixture.receipt))
        .rejects.toThrow("integrity_mismatch");
      expect(fixture.counts.rankingReads()).toBe(0);
      expect(fixture.counts.freezes()).toBe(0);
      expect(fixture.counts.ranks()).toBe(0);
      expect(fixture.counts.inserts()).toBe(0);
      fixture.database.close();
    }
    expect(accessorReads).toBe(0);
  });

  test("rejects a versions Proxy without invoking any Proxy trap", async () => {
    // Break caught: reflecting into hostile lineage metadata before Proxy rejection.
    let trapCalls = 0;
    const trap = (): never => {
      trapCalls += 1;
      throw new Error("frontier_versions_proxy_trap");
    };
    const versions = new Proxy({ ...ONBOARDING_MODEL_VERSIONS_V2 }, {
      get: trap,
      getOwnPropertyDescriptor: trap,
      getPrototypeOf: trap,
      ownKeys: trap,
    }) as OnboardingModelVersions;
    const fixture = await receiptHarness({
      transformConfirmation: (confirmation) => ({ ...confirmation, versions }),
    });

    await expect(fixture.application.prepareFromOnboardingReceipt(fixture.receipt))
      .rejects.toThrow("integrity_mismatch");

    expect(trapCalls).toBe(0);
    expect(fixture.counts.rankingReads()).toBe(0);
    expect(fixture.counts.freezes()).toBe(0);
    expect(fixture.counts.ranks()).toBe(0);
    expect(fixture.counts.inserts()).toBe(0);
  });

  test("rejects unsigned exact-tuple tamper and a re-signed hybrid before ranking access", async () => {
    // Break caught: omitting lineage from HMAC input or treating a valid HMAC as tuple validity.
    const unsigned = await receiptHarness({
      transformConfirmation: (confirmation) => ({
        ...confirmation,
        versions: ONBOARDING_MODEL_VERSIONS_V1,
      }),
    });
    await expect(unsigned.application.prepareFromOnboardingReceipt(unsigned.receipt))
      .rejects.toThrow("integrity_mismatch");
    expect(unsigned.counts.rankingReads()).toBe(0);
    expect(unsigned.counts.freezes()).toBe(0);
    expect(unsigned.counts.ranks()).toBe(0);
    expect(unsigned.counts.inserts()).toBe(0);

    const resigned = await receiptHarness({
      transformConfirmation: (confirmation) => {
        const versions = {
          ...ONBOARDING_MODEL_VERSIONS_V1,
          extractionPrompt: ONBOARDING_MODEL_VERSIONS_V2.extractionPrompt,
        };
        const receipt = {
          schemaVersion: confirmation.receipt.schemaVersion,
          receiptId: confirmation.receipt.receiptId,
          completionCommandId: confirmation.receipt.completionCommandId,
          profileId: confirmation.receipt.profileId,
          preferenceProfileId: confirmation.receipt.preferenceProfileId,
          frontierRunId: confirmation.receipt.frontierRunId,
          confirmedAt: confirmation.receipt.confirmedAt,
        };
        const integrity = createEvidenceIntegrity(HMAC_KEY);
        const confirmationDigest = integrity.sign(integrity.canonical({
          schemaVersion: "onboarding-confirmation-binding@1",
          receipt,
          profile: confirmation.profile,
          preferences: confirmation.preferences,
          provenance: confirmation.provenance,
          versions,
        }));
        return {
          ...confirmation,
          receipt: { ...confirmation.receipt, confirmationDigest },
          versions: versions as unknown as OnboardingModelVersions,
        };
      },
    });
    await expect(resigned.application.prepareFromOnboardingReceipt(resigned.receipt))
      .rejects.toThrow("integrity_mismatch");
    expect(resigned.counts.rankingReads()).toBe(0);
    expect(resigned.counts.freezes()).toBe(0);
    expect(resigned.counts.ranks()).toBe(0);
    expect(resigned.counts.inserts()).toBe(0);
  });

  test("rejects an existing fixed run bound to another verified confirmation", async () => {
    const fixture = await receiptHarness();
    const secondReceipt = await fixture.onboardingStore.commitOrReplay({
      completionCommandId: "00000000-0000-4000-8000-000000000211",
      confirmed: fixture.confirmed,
      versions: ONBOARDING_VERSIONS,
    });
    const second = await fixture.onboardingStore.loadBySnapshotBindingsVerified({
      profileId: secondReceipt.profileId,
      preferenceProfileId: secondReceipt.preferenceProfileId,
    });
    const places = [v2RankablePlace("SI", "1")];
    await fixture.placeStore.appendRanking(receiptRanking({
      ...secondReceipt,
      frontierRunId: fixture.receipt.frontierRunId,
    }, second, places));

    await expect(fixture.application.prepareFromOnboardingReceipt(fixture.receipt))
      .rejects.toThrow("integrity_mismatch");
    expect(fixture.counts.freezes()).toBe(0);
    expect(fixture.counts.ranks()).toBe(0);
    expect(fixture.counts.inserts()).toBe(0);
  });

  test("production composition ranks only @2 country criteria and exposes receipt preparation", async () => {
    const fixture = await receiptHarness();
    const application = createPlaceFrontierComposition({
      database: fixture.database,
      hmacKey: HMAC_KEY,
      onboardingConfirmations: fixture.onboardingStore,
      clock: () => { throw new Error("unexpected_clock_read"); },
      nextRunId: () => { throw new Error("unexpected_next_id_read"); },
    } as unknown as Parameters<typeof createPlaceFrontierComposition>[0]) as ReturnType<
      typeof createPlaceFrontierComposition
    > & ConfirmedOnboardingFrontierPort;

    const prepared = await application.prepareFromOnboardingReceipt(fixture.receipt);
    const ranking = await fixture.placeStore.loadRankingVerified(prepared.rankingSnapshotId);
    expect(ranking.ordered).not.toHaveLength(0);
    expect(ranking.ordered[0]?.factors.map(({ criterionId }) => criterionId)).toEqual([
      "outside_cis",
      "europe",
      "personal_safety",
      "infrastructure",
      "peace_and_stability",
    ]);
    expect(ranking.ordered[0]?.factors.map(({ criterionId }) => criterionId))
      .not.toEqual(expect.arrayContaining([...CITY_PREFERENCE_IDS]));
  });
});

describe("Country Frontier V2 marker contract", () => {
  test("materializes and replays an exact fresh frozen V2 projection", () => {
    const integrity = createEvidenceIntegrity(HMAC_KEY);
    const checked = verificationResultV2("stored-profile");
    const borrowedProjection = checked.assessmentProjection!;

    const marker = materializeFrontierMarker({
      place: rankedPlace("SI", 1),
      checked,
      parentRunId: "frontier-run-1",
      profileId: "stored-profile",
      integrity,
    });
    const replay = countryVerificationReplayExpectation(marker);
    (borrowedProjection.participantAssessments[0]!.reasonCodes as string[])[0] =
      "country_not_installed";

    expect(marker).toEqual(expect.objectContaining({
      sourceAssessmentRulesVersion: "cold-start-assessment@2",
      assessmentProjection: assessmentProjectionV2("stored-profile", "evidence-SI"),
    }));
    expect(replay).toEqual({
      sourceAssessmentRulesVersion: "cold-start-assessment@2",
      verdict: unresolvedVerdict(),
      evidenceSnapshotId: "evidence-SI",
      lastCheckedAt: DAY,
      assessmentProjection: assessmentProjectionV2("stored-profile", "evidence-SI"),
    });
    expect(marker.assessmentProjection).not.toBe(borrowedProjection);
    expect(replay.assessmentProjection).not.toBe(marker.assessmentProjection);
    expect(Object.isFrozen(marker.assessmentProjection)).toBe(true);
    if (marker.sourceAssessmentRulesVersion !== "cold-start-assessment@2") {
      throw new Error("test_fixture_mismatch");
    }
    expect(Object.isFrozen(marker.assessmentProjection.participantAssessments)).toBe(true);
    expect(Object.isFrozen(replay.assessmentProjection)).toBe(true);
  });

  test("keeps the historical V1 result and replay free of a projection key", () => {
    const integrity = createEvidenceIntegrity(HMAC_KEY);
    const checked: CountryVerificationResult = {
      countryCheckRunId: countryCheckRunId("frontier-run-1", "SI", integrity),
      sourceAssessmentRulesVersion: "cold-start-assessment@1",
      verdict: unresolvedVerdict(),
      evidenceSnapshotId: "evidence-SI",
      lastCheckedAt: DAY,
    };

    const marker = materializeFrontierMarker({
      place: rankedPlace("SI", 1),
      checked,
      parentRunId: "frontier-run-1",
      profileId: "stored-profile",
      integrity,
    });
    const replay = countryVerificationReplayExpectation(marker);

    expect(Object.hasOwn(marker, "assessmentProjection")).toBe(false);
    expect(Object.hasOwn(replay, "assessmentProjection")).toBe(false);
    expect(JSON.stringify(replay)).toBe(
      '{"sourceAssessmentRulesVersion":"cold-start-assessment@1",' +
      '"verdict":{"rulesVersion":"formal-residence@1","marker":"yellow",' +
      '"verdictAsOf":"2026-08-12","routeOutcomes":[],"reasons":[],' +
      '"catalogCompleteness":{"status":"unproven",' +
      '"reasonCode":"catalog_completeness_unprovable"}},' +
      '"evidenceSnapshotId":"evidence-SI","lastCheckedAt":"2026-08-12"}',
    );
  });

  test("rejects an enumerable version getter without evaluating borrowed result data", () => {
    const integrity = createEvidenceIntegrity(HMAC_KEY);
    let getterCalls = 0;
    const checked: Record<string, unknown> = {
      countryCheckRunId: countryCheckRunId("frontier-run-1", "SI", integrity),
      verdict: unresolvedVerdict(),
      evidenceSnapshotId: "evidence-SI",
      lastCheckedAt: DAY,
    };
    Object.defineProperty(checked, "sourceAssessmentRulesVersion", {
      configurable: true,
      enumerable: true,
      get() {
        getterCalls += 1;
        return getterCalls === 1
          ? "cold-start-assessment@1"
          : "cold-start-assessment@2";
      },
    });

    expect(() => materializeFrontierMarker({
      place: rankedPlace("SI", 1),
      checked: checked as unknown as CountryVerificationResult,
      parentRunId: "frontier-run-1",
      profileId: "stored-profile",
      integrity,
    })).toThrow("integrity_mismatch");
    expect(getterCalls).toBe(0);
  });

  test.each([
    ["a non-enumerable assessmentProjection", (checked: Record<PropertyKey, unknown>) => {
      Object.defineProperty(checked, "assessmentProjection", {
        configurable: true,
        enumerable: false,
        value: assessmentProjectionV2("stored-profile", "evidence-SI"),
      });
      return checked;
    }],
    ["an enumerable symbol key", (checked: Record<PropertyKey, unknown>) => {
      Object.defineProperty(checked, Symbol("hidden"), {
        configurable: true,
        enumerable: true,
        value: "hidden",
      });
      return checked;
    }],
    ["a custom prototype", (checked: Record<PropertyKey, unknown>) =>
      Object.assign(Object.create({ inherited: true }) as Record<PropertyKey, unknown>, checked)],
  ] as const)("rejects a V1 result with %s", (_label, mutate) => {
    const integrity = createEvidenceIntegrity(HMAC_KEY);
    const checked = mutate({
      countryCheckRunId: countryCheckRunId("frontier-run-1", "SI", integrity),
      sourceAssessmentRulesVersion: "cold-start-assessment@1",
      verdict: unresolvedVerdict(),
      evidenceSnapshotId: "evidence-SI",
      lastCheckedAt: DAY,
    });

    expect(() => materializeFrontierMarker({
      place: rankedPlace("SI", 1),
      checked: checked as unknown as CountryVerificationResult,
      parentRunId: "frontier-run-1",
      profileId: "stored-profile",
      integrity,
    })).toThrow("integrity_mismatch");
  });

  test("rejects a Proxy result before invoking any Proxy trap", () => {
    const integrity = createEvidenceIntegrity(HMAC_KEY);
    let trapCalls = 0;
    const checked = new Proxy({
      countryCheckRunId: countryCheckRunId("frontier-run-1", "SI", integrity),
      sourceAssessmentRulesVersion: "cold-start-assessment@1" as const,
      verdict: unresolvedVerdict(),
      evidenceSnapshotId: "evidence-SI",
      lastCheckedAt: DAY,
    }, {
      get(target, key, receiver) {
        trapCalls += 1;
        return Reflect.get(target, key, receiver);
      },
    });

    expect(() => materializeFrontierMarker({
      place: rankedPlace("SI", 1),
      checked,
      parentRunId: "frontier-run-1",
      profileId: "stored-profile",
      integrity,
    })).toThrow("integrity_mismatch");
    expect(trapCalls).toBe(0);
  });

  test.each([
    ["V1 result with projection", (result: Record<string, unknown>) => {
      result.assessmentProjection = assessmentProjectionV2("stored-profile", "evidence-SI");
    }],
    ["V2 result without projection", (result: Record<string, unknown>) => {
      result.sourceAssessmentRulesVersion = "cold-start-assessment@2";
    }],
    ["projection profile binding", (result: Record<string, unknown>) => {
      Object.assign(result, verificationResultV2("profile-other"));
    }],
    ["projection Evidence binding", (result: Record<string, unknown>) => {
      Object.assign(result, verificationResultV2("stored-profile"));
      (result.assessmentProjection as { evidenceSnapshotId: string }).evidenceSnapshotId =
        "evidence-other";
    }],
    ["duplicate participant pair", (result: Record<string, unknown>) => {
      Object.assign(result, verificationResultV2("stored-profile"));
      const projection = result.assessmentProjection as ReturnType<typeof assessmentProjectionV2>;
      projection.participantAssessments[1] = structuredClone(
        projection.participantAssessments[0]!,
      );
    }],
  ] as const)("rejects an invalid %s before marker publication", (_label, mutate) => {
    const integrity = createEvidenceIntegrity(HMAC_KEY);
    const result: Record<string, unknown> = {
      countryCheckRunId: countryCheckRunId("frontier-run-1", "SI", integrity),
      sourceAssessmentRulesVersion: "cold-start-assessment@1",
      verdict: unresolvedVerdict(),
      evidenceSnapshotId: "evidence-SI",
      lastCheckedAt: DAY,
    };
    mutate(result);

    expect(() => materializeFrontierMarker({
      place: rankedPlace("SI", 1),
      checked: result as unknown as CountryVerificationResult,
      parentRunId: "frontier-run-1",
      profileId: "stored-profile",
      integrity,
    })).toThrow("integrity_mismatch");
  });
});

describe("Place Frontier profile version pairs", () => {
  test.each([
    [
      "@1/@1",
      () => confirmRelocationProfile(relocationProfile, () => new Date(NOW)),
      () => confirmPreferenceProfile(preferenceProfile, () => new Date(NOW)),
      "cold-start-assessment@1",
    ],
    [
      "@2/@2",
      () => v2RelocationSnapshot(),
      () => v2PreferenceSnapshot(),
      "cold-start-assessment@2",
    ],
  ] as const)(
    "runs and presents a matching %s pair through the union readers",
    async (_label, relocationFactory, preferenceFactory, assessmentRulesVersion) => {
      const frontier = profilePairHarness(relocationFactory(), preferenceFactory());

      const run = await frontier.application.runPlaceFrontier(
        frontier.prepared,
        () => undefined,
        new AbortController().signal,
      );
      const replay = await frontier.application.presentPlaceFrontier(frontier.prepared.runId);

      expect(run.shortlistSnapshot.markers[0]!.sourceAssessmentRulesVersion).toBe(
        assessmentRulesVersion,
      );
      expect(replay).toEqual(run);
      expect(frontier.checkCalls()).toBe(1);
      expect(frontier.presentCalls()).toBe(1);
    },
  );

  test.each([
    [
      "@1/@2",
      () => confirmRelocationProfile(relocationProfile, () => new Date(NOW)),
      () => v2PreferenceSnapshot(),
    ],
    [
      "@2/@1",
      () => v2RelocationSnapshot(),
      () => confirmPreferenceProfile(preferenceProfile, () => new Date(NOW)),
    ],
  ] as const)(
    "rejects a mixed %s pair before starting country verification",
    async (_label, relocationFactory, preferenceFactory) => {
      const frontier = profilePairHarness(relocationFactory(), preferenceFactory());

      await expect(frontier.application.runPlaceFrontier(
        frontier.prepared,
        () => undefined,
        new AbortController().signal,
      )).rejects.toThrow("integrity_mismatch");
      expect(frontier.checkCalls()).toBe(0);
    },
  );

  test.each([
    [
      "relocation @2 / preference @1",
      (relocation: RelocationProfileSnapshot, preference: PreferenceProfileSnapshot) => [
        { ...v2RelocationSnapshot(), id: relocation.id } as RelocationProfileV2Snapshot,
        preference,
      ] as const,
    ],
    [
      "relocation @1 / preference @2",
      (relocation: RelocationProfileSnapshot, preference: PreferenceProfileSnapshot) => [
        relocation,
        { ...v2PreferenceSnapshot(), id: preference.id } as PreferenceProfileV2Snapshot,
      ] as const,
    ],
  ] as const)(
    "rejects a replay with a mixed %s pair before verifier presentation",
    async (_label, mixedPair) => {
      const relocation = confirmRelocationProfile(relocationProfile, () => new Date(NOW));
      const preference = confirmPreferenceProfile(preferenceProfile, () => new Date(NOW));
      const frontier = profilePairHarness(relocation, preference);
      await frontier.application.runPlaceFrontier(
        frontier.prepared,
        () => undefined,
        new AbortController().signal,
      );
      const [mixedRelocation, mixedPreference] = mixedPair(relocation, preference);
      frontier.replaceProfiles(mixedRelocation, mixedPreference);

      await expect(frontier.application.presentPlaceFrontier(
        frontier.prepared.runId,
      )).rejects.toThrow("integrity_mismatch");
      expect(frontier.presentCalls()).toBe(0);
    },
  );
});

describe("frozen CountryFrontier", () => {
  test("does not export a caller-selected child preparation surface", () => {
    expect(Object.keys(coldStartApplicationExports)).not.toContain(
      "createColdStartApplicationBundle",
    );
    expect(Object.keys(coldStartCompositionExports)).not.toContain(
      "createColdStartCompositionBundle",
    );
  });

  test("keeps caller-controlled run IDs out of the public cold-start application", async () => {
    let generatedIds = 0;
    const application = createColdStartComposition({
      database: openEvidenceDatabase(":memory:"),
      hmacKey: HMAC_KEY,
      nextRunId: () => `cold-run-${++generatedIds}`,
    });

    expect("prepareColdStartWithRunId" in application).toBe(false);
    await expect(application.prepare({
      countryInput: "SI",
      profile: relocationProfile,
    })).resolves.toEqual(expect.objectContaining({ runId: "cold-run-1" }));
    expect(generatedIds).toBe(1);
  });

  test("production frontier is SI-only, consumes no child ID and replays with zero network", async () => {
    const database = openEvidenceDatabase(":memory:");
    const requestStep = vi.fn(async () => {
      throw new Error("network_must_not_run");
    });
    let generatedIds = 0;
    const application = createPlaceFrontierComposition({
      database,
      hmacKey: HMAC_KEY,
      countrySourceIndex: {
        lookup: () => ({
          ok: false as const,
          kind: "country_not_installed" as const,
          candidates: [] as const,
        }),
      },
      requestStep,
      clock: () => new Date(NOW),
      nextRunId: () => `frontier-run-${++generatedIds}`,
    });
    const prepared = await application.preparePlaceFrontier({
      profile: relocationProfile,
      preferences: preferenceProfile,
    });

    const result = await application.runPlaceFrontier(
      prepared,
      () => undefined,
      new AbortController().signal,
    );
    const callsBeforeReplay = requestStep.mock.calls.length;
    const replay = await application.presentPlaceFrontier(prepared.runId);

    expect(result.rankingSnapshot.ordered.map(({ countryCode }) => countryCode)).toEqual(["SI"]);
    expect(result.shortlistSnapshot.markers.map(({ country }) => country.countryCode)).toEqual(["SI"]);
    expect(replay).toEqual(result);
    expect(requestStep).toHaveBeenCalledTimes(callsBeforeReplay);
    expect(generatedIds).toBe(1);
  });

  test("production verifier checks and presents a V2 profile through its Any-only boundary", async () => {
    const database = openEvidenceDatabase(":memory:");
    const profile = v2RelocationSnapshot();
    insertRelocationV2Snapshot(database, profile);
    const requestStep = vi.fn(async () => {
      throw new Error("network_must_not_run");
    });
    const verifier = createCountryVerifierAdapter({
      database,
      hmacKey: HMAC_KEY,
      countrySourceIndex: {
        lookup: () => ({
          ok: false as const,
          kind: "country_not_installed" as const,
          candidates: [] as const,
        }),
      },
      requestStep,
      clock: () => new Date(NOW),
    });
    const parentRunId = "v2-adapter-parent";

    const checked = await verifier.check({
      country: rankedPlace("SI", 1),
      profileId: profile.id,
      parentRunId,
      emitProgress: () => undefined,
      signal: new AbortController().signal,
    });
    const presented = await verifier.present({
      parentRunId,
      countryCode: "SI",
      countryCheckRunId: checked.countryCheckRunId,
      profileId: profile.id,
    });
    const expectedPresentation = presentationFromVerification(checked);

    expect(checked).toMatchObject({
      sourceAssessmentRulesVersion: "cold-start-assessment@2",
      assessmentProjection: {
        schemaVersion: "country-assessment-projection@2",
        profileSnapshotId: profile.id,
        participantAssessments: [],
      },
    });
    expect(presented).toEqual(expectedPresentation);
    if (
      checked.sourceAssessmentRulesVersion !== "cold-start-assessment@2" ||
      presented.sourceAssessmentRulesVersion !== "cold-start-assessment@2"
    ) throw new Error("test_fixture_mismatch");
    expect(checked.assessmentProjection).not.toBe(presented.assessmentProjection);
    expect(Object.isFrozen(checked.assessmentProjection)).toBe(true);
    expect(Object.isFrozen(presented.assessmentProjection)).toBe(true);
    expect(requestStep).not.toHaveBeenCalled();
  });

  test("presents the same fully replayed frontier by exact shortlist ID or run ID", async () => {
    const fixture = harness({ rankedCountries: ["SI"] });
    const { prepared, result } = await fixture.run();

    await expect(fixture.application.presentPlaceFrontierByShortlistId(
      result.shortlistSnapshot.id,
    )).resolves.toEqual(await fixture.application.presentPlaceFrontier(prepared.runId));
  });

  test("accepts a terminal shortlist sealed after its ranking assessment", async () => {
    let seconds = 0;
    const fixture = harness({
      rankedCountries: ["SI"],
      clock: () => new Date(Date.parse(NOW) + seconds++ * 1_000),
    });
    const { result, events } = await fixture.run();
    let state = initialPlaceFrontierEventState();

    for (const event of events) {
      state = reducePlaceFrontierEvent(state, event);
    }

    expect(Date.parse(result.shortlistSnapshot.createdAt))
      .toBeGreaterThan(Date.parse(result.assessmentAt));
    expect(state.terminal).toEqual(result);
  });

  test("floors live shortlist issuance at assessment time when the clock rolls back", async () => {
    let clockReads = 0;
    const fixture = harness({
      rankedCountries: ["SI"],
      clock: () => new Date(clockReads++ === 0 ? NOW : "2026-08-12T07:59:00.000Z"),
    });
    const prepared = await fixture.prepare();
    let state = initialPlaceFrontierEventState();

    const result = await fixture.application.runPlaceFrontier(
      prepared,
      (event) => { state = reducePlaceFrontierEvent(state, event); },
      new AbortController().signal,
    );

    expect(result.shortlistSnapshot.createdAt).toBe(NOW);
    expect(state.terminal).toEqual(result);
  });

  test("isolates completed event payloads from persisted and returned frontier state", async () => {
    const fixture = harness({ rankedCountries: ["SI"] });
    const prepared = await fixture.prepare();
    const result = await fixture.application.runPlaceFrontier(
      prepared,
      (event) => {
        try {
          if (event.type === "country_completed") {
            (event.payload.marker.country as { label: string }).label = "corrupted country";
            (event.payload.marker.formalVerdict as { marker: string }).marker = "red";
          }
          if (event.type === "frontier_completed") {
            (event.payload.readModel.rankingSnapshot.ordered[0] as { label: string }).label =
              "corrupted ranking";
          }
        } catch {
          // A deeply frozen callback view is also an acceptable isolation boundary.
        }
      },
      new AbortController().signal,
    );

    const stored = await fixture.store.loadShortlistVerified(prepared.runId);
    const presented = await fixture.application.presentPlaceFrontier(prepared.runId);
    expect(result.shortlistSnapshot.markers[0]?.country.label).toBe("SI");
    expect(result.shortlistSnapshot.markers[0]?.formalVerdict.marker).toBe("green");
    expect(result.rankingSnapshot.ordered[0]?.label).toBe("SI");
    expect(stored.markers[0]?.country.label).toBe("SI");
    expect(presented).toEqual(result);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.shortlistSnapshot.markers[0]?.formalVerdict)).toBe(true);
  });

  test("forwards every typed child progress payload with frontier sequencing", async () => {
    const fixture = harness({
      rankedCountries: ["SI"],
      progressEvents: nonTerminalProgressEvents(),
    });

    const { events } = await fixture.run();
    expect(events.filter((event) => (event as { type: string }).type === "country_progress"))
      .toEqual([
        expect.objectContaining({
          sequence: 3,
          payload: {
            countryCode: "SI",
            stage: "source_discovered",
            label: "candidate-1",
            sourceUrl: "https://gov.test/source",
          },
        }),
        expect.objectContaining({
          sequence: 4,
          payload: {
            countryCode: "SI",
            stage: "authority_verified",
            label: "candidate-1",
            detail: "https://gov.test",
          },
        }),
        expect.objectContaining({
          sequence: 5,
          payload: {
            countryCode: "SI",
            stage: "artifact_captured",
            label: "official rule",
            detail: "sha256:" + "b".repeat(64),
            sourceUrl: "https://gov.test/rule.pdf",
          },
        }),
        expect.objectContaining({
          sequence: 6,
          payload: {
            countryCode: "SI",
            stage: "claim_verified",
            label: "claim-1",
            detail: "income · si-income-threshold",
          },
        }),
        expect.objectContaining({
          sequence: 7,
          payload: {
            countryCode: "SI",
            stage: "dossier_published",
            label: "Slovenia dossier",
            detail: "dossier-1 · created",
          },
        }),
      ]);
  });

  test("activates five, preserves every marker and replaces only red until five are non-red", async () => {
    const fixture = harness({
      rankedCountries: ["DE", "ES", "FR", "IT", "PT", "SI"],
      markerByCountry: {
        DE: "green",
        ES: "red",
        FR: "yellow",
        IT: "green",
        PT: "green",
        SI: "green",
      },
    });

    const { prepared, result, events } = await fixture.run();
    expect(projectTerminalSummary(result)).toEqual({
      countries: ["DE", "FR", "IT", "PT", "SI"],
      composition: { green: 4, yellow: 1 },
      stopCondition: "five_non_red",
      preliminary: true,
    });
    expect(result.shortlistSnapshot.markers.map(({ country, formalVerdict }) => [
      country.countryCode,
      formalVerdict.marker,
    ])).toEqual([
      ["DE", "green"],
      ["ES", "red"],
      ["FR", "yellow"],
      ["IT", "green"],
      ["PT", "green"],
      ["SI", "green"],
    ]);
    expect(fixture.checks).toEqual(["DE", "ES", "FR", "IT", "PT", "SI"]);
    expect(fixture.counts.rank()).toBe(1);
    expect(fixture.counts.currentInput()).toBe(1);
    expect(events.map((event) => (event as { type: string }).type)).toEqual([
      "ranking_sealed",
      "country_activated",
      "country_activated",
      "country_activated",
      "country_activated",
      "country_activated",
      "country_completed",
      "country_completed",
      "country_activated",
      "country_completed",
      "country_completed",
      "country_completed",
      "country_completed",
      "frontier_completed",
    ]);

    const rankingRows = fixture.database.prepare(
      "SELECT COUNT(*) AS count FROM place_frontier_snapshots WHERE kind = 'ranking'",
    ).get();
    expect(rankingRows).toEqual({ count: 1 });
    expect(await fixture.application.presentPlaceFrontier(prepared.runId)).toEqual(result);
    expect(fixture.counts.rank()).toBe(1);
    expect(fixture.counts.currentInput()).toBe(1);
  });

  test("replays a completed shortlist through present-only semantic verification and protocol events", async () => {
    let clockReads = 0;
    const fixture = harness({
      rankedCountries: ["DE", "ES", "FR", "IT", "PT", "SI"],
      markerByCountry: {
        DE: "red",
        ES: "green",
        FR: "green",
        IT: "green",
        PT: "green",
        SI: "green",
      },
      clock: () => {
        clockReads += 1;
        return new Date(NOW);
      },
    });
    const live = await fixture.run();
    const checksAfterLiveRun = [...fixture.checks];
    const clockReadsAfterLiveRun = clockReads;
    const appendRanking = vi.spyOn(fixture.store, "appendRanking");
    const appendShortlist = vi.spyOn(fixture.store, "appendShortlist");
    const replayEvents: PlaceFrontierEvent[] = [];

    const replayed = await fixture.application.runPlaceFrontier(
      live.prepared,
      (event) => { replayEvents.push(event); },
      new AbortController().signal,
    );

    expect(replayed).toEqual(live.result);
    expect(fixture.checks).toEqual(checksAfterLiveRun);
    expect(fixture.counts.present()).toBe(live.result.shortlistSnapshot.markers.length);
    expect(fixture.counts.rank()).toBe(1);
    expect(fixture.counts.currentInput()).toBe(1);
    expect(appendRanking).not.toHaveBeenCalled();
    expect(appendShortlist).not.toHaveBeenCalled();
    expect(clockReads).toBe(clockReadsAfterLiveRun);
    expect(replayEvents.map(({ type }) => type)).toEqual([
      "ranking_sealed",
      "country_activated",
      "country_activated",
      "country_activated",
      "country_activated",
      "country_activated",
      "country_completed",
      "country_activated",
      "country_completed",
      "country_completed",
      "country_completed",
      "country_completed",
      "country_completed",
      "frontier_completed",
    ]);
    expect(replayEvents.some(({ type }) => type === "country_progress")).toBe(false);
    let state = initialPlaceFrontierEventState();
    for (const event of replayEvents) state = reducePlaceFrontierEvent(state, event);
    expect(state.terminal).toEqual(live.result);
  });

  test("rejects an earlier completed shortlist at the application replay boundary", async () => {
    const fixture = harness({ rankedCountries: ["SI"] });
    const live = await fixture.run();
    vi.spyOn(fixture.store, "loadShortlistVerifiedIfPresent").mockResolvedValue({
      ...live.result.shortlistSnapshot,
      createdAt: "2026-08-12T07:59:00.000Z",
    });
    const presentCallsBeforeReplay = fixture.counts.present();
    const replayEvents: PlaceFrontierEvent[] = [];

    await expect(fixture.application.runPlaceFrontier(
      live.prepared,
      (event) => { replayEvents.push(event); },
      new AbortController().signal,
    )).rejects.toThrow("integrity_mismatch");
    expect(fixture.counts.present()).toBe(presentCallsBeforeReplay);
    expect(replayEvents).toEqual([]);
  });

  test("honestly exhausts the installed SI-only coverage with one preliminary country", async () => {
    const fixture = harness({ rankedCountries: ["SI"] });
    const { result } = await fixture.run();

    expect(projectTerminalSummary(result)).toEqual({
      countries: ["SI"],
      composition: { green: 1, yellow: 0 },
      stopCondition: "installed_coverage_exhausted",
      preliminary: true,
    });
    expect(Object.keys(result)).toEqual([
      "runId",
      "assessmentAt",
      "rankingSnapshot",
      "shortlistSnapshot",
    ]);
    expect(JSON.stringify(result.shortlistSnapshot)).not.toMatch(
      /countries|composition|stopCondition|preliminary/,
    );
  });

  test("seals ranking during prepare and never changes it after a country publishes Knowledge", async () => {
    const fixture = harness({
      rankedCountries: ["DE", "SI"],
      knowledgeRevisionIds: { DE: null, SI: "knowledge:SI" },
    });
    const prepared = await fixture.prepare();
    const frozen = await fixture.store.loadRankingVerified(prepared.rankingSnapshotId);

    await expect(fixture.application.runPlaceFrontier(
      prepared,
      () => undefined,
      new AbortController().signal,
    )).resolves.toBeDefined();
    expect(await fixture.store.loadRankingVerified(prepared.rankingSnapshotId)).toEqual(frozen);
    expect(fixture.counts.rank()).toBe(1);
  });

  test("keeps the frozen ranking when a child publishes a genuinely new Knowledge revision", async () => {
    const fixture = harness({
      rankedCountries: ["DE", "SI"],
      knowledgeRevisionIds: { DE: null, SI: "knowledge-before:SI" },
      publishKnowledgeDuringCheck: true,
    });
    const prepared = await fixture.prepare();
    const frozen = await fixture.store.loadRankingVerified(prepared.rankingSnapshotId);

    const result = await fixture.application.runPlaceFrontier(
      prepared,
      () => undefined,
      new AbortController().signal,
    );

    expect(result.rankingSnapshot).toEqual(frozen);
    expect(result.rankingSnapshot.knowledgeRevisionIds.SI).toBe("knowledge-before:SI");
    expect(result.shortlistSnapshot.markers.find(({ country }) => country.countryCode === "SI"))
      .toEqual(expect.objectContaining({
        currentKnowledgeRevisionId: "knowledge-published:SI",
        updatedKnowledgeRevisionId: "knowledge-published:SI",
      }));
  });

  test("binds prepared assessmentAt before invoking any verifier", async () => {
    const fixture = harness({ rankedCountries: ["SI"] });
    const prepared = await fixture.prepare();

    await expect(fixture.application.runPlaceFrontier(
      { ...prepared, assessmentAt: "2026-08-13T08:00:00.000Z" },
      () => undefined,
      new AbortController().signal,
    )).rejects.toThrow("integrity_mismatch");
    expect(fixture.checks).toEqual([]);
  });

  test("counts repeated required mismatch rows as one Knowledge country", async () => {
    const fixture = genuineExcludedHarness();

    const prepared = await fixture.prepare();
    const ranking = await fixture.store.loadRankingVerified(prepared.rankingSnapshotId);
    expect(ranking.excluded).toHaveLength(2);
    expect(ranking.excludedPlaces).toEqual([requiredPlace("DE", "does_not_match")]);
    const events: Array<{ readonly type: string; readonly payload: unknown }> = [];
    const result = await fixture.application.runPlaceFrontier(
      prepared,
      (event) => { events.push(event); },
      new AbortController().signal,
    );
    expect(events[0]).toEqual(expect.objectContaining({
      type: "ranking_sealed",
      payload: expect.objectContaining({ excludedCountryCodes: ["DE"] }),
    }));
    expect(await fixture.application.presentPlaceFrontier(prepared.runId)).toEqual(result);
  });

  test.each([
    ["invalid date", (result: Awaited<ReturnType<CountryVerifierPort["check"]>>) => ({
      ...result,
      lastCheckedAt: "2026-02-30",
    })],
    ["partial verdict", (result: Awaited<ReturnType<CountryVerifierPort["check"]>>) => ({
      ...result,
      verdict: { rulesVersion: "formal-residence@1", marker: "green" },
    })],
    ["unknown marker field", (result: Awaited<ReturnType<CountryVerifierPort["check"]>>) => ({
      ...result,
      unexpected: true,
    })],
    ["binary marker field", (result: Awaited<ReturnType<CountryVerifierPort["check"]>>) => ({
      ...result,
      unexpected: new Uint8Array([1]),
    })],
    ["mismatched updated Knowledge head", (
      result: Awaited<ReturnType<CountryVerifierPort["check"]>>,
    ) => ({
      ...result,
      currentKnowledgeRevisionId: "knowledge-current:SI",
      updatedKnowledgeRevisionId: "knowledge-updated:SI",
      knowledgeUpdatedAt: NOW,
    })],
  ] as const)("rejects malformed verifier output (%s) before shortlist persistence", async (
    _name,
    mutateCheckResult,
  ) => {
    const fixture = harness({ rankedCountries: ["SI"], mutateCheckResult });
    const prepared = await fixture.prepare();
    const events: Array<{ readonly type: string }> = [];

    await expect(fixture.application.runPlaceFrontier(
      prepared,
      (event) => { events.push(event); },
      new AbortController().signal,
    )).rejects.toThrow("integrity_mismatch");
    expect(events.some(({ type }) => type === "country_completed")).toBe(false);
    expect(fixture.database.prepare(
      "SELECT kind FROM place_frontier_snapshots ORDER BY kind",
    ).all()).toEqual([{ kind: "ranking" }]);
  });

  test.each([
    ["post-check abort", { abort: true, storage: false }, "aborted"],
    ["shortlist storage failure", { abort: false, storage: true }, "storage_failed"],
  ] as const)("does not publish a shortlist after %s", async (_name, mode, message) => {
    const abortController = new AbortController();
    const fixture = harness({
      rankedCountries: ["SI"],
      ...(mode.abort ? { abortDuringCheck: abortController } : {}),
      failShortlistAppend: mode.storage,
    });
    const prepared = await fixture.prepare();

    await expect(fixture.application.runPlaceFrontier(
      prepared,
      () => undefined,
      abortController.signal,
    )).rejects.toThrow(message);
    expect(fixture.database.prepare(
      "SELECT kind FROM place_frontier_snapshots ORDER BY kind",
    ).all()).toEqual([{ kind: "ranking" }]);
  });

  test("does not publish a shortlist after verifier failure", async () => {
    const fixture = harness({ rankedCountries: ["DE", "ES"], failCheckFor: "ES" });
    const prepared = await fixture.prepare();

    await expect(fixture.application.runPlaceFrontier(
      prepared,
      () => undefined,
      new AbortController().signal,
    )).rejects.toThrow("verification_failed");
    expect(fixture.database.prepare(
      "SELECT kind FROM place_frontier_snapshots ORDER BY kind",
    ).all()).toEqual([{ kind: "ranking" }]);
    await expect(fixture.application.presentPlaceFrontier(prepared.runId))
      .rejects.toThrow("snapshot_not_found");
  });

  test.each([
    ["reversed", "2026-08-13", "2026-08-11"],
    ["not yet applicable", "2026-08-13", undefined],
    ["already expired", undefined, "2026-08-11"],
  ] as const)("rejects an unknown route with a %s interval before shortlist persistence", async (
    _name,
    effectiveFrom,
    effectiveTo,
  ) => {
    const fixture = harness({
      rankedCountries: ["SI"],
      mutateCheckResult: (result) => ({
        ...result,
        verdict: {
          ...unknownRouteVerdict(),
          routeOutcomes: [{
            ...unknownRouteVerdict().routeOutcomes[0]!,
            ...(effectiveFrom === undefined ? {} : { ruleEffectiveFrom: effectiveFrom }),
            ...(effectiveTo === undefined ? {} : { ruleEffectiveTo: effectiveTo }),
          }],
        },
      }),
    });
    const prepared = await fixture.prepare();

    await expect(fixture.application.runPlaceFrontier(
      prepared,
      () => undefined,
      new AbortController().signal,
    )).rejects.toThrow("integrity_mismatch");
    expect(fixture.database.prepare(
      "SELECT kind FROM place_frontier_snapshots ORDER BY kind",
    ).all()).toEqual([{ kind: "ranking" }]);
  });
});

describe("frontier snapshot integrity", () => {
  test("rejects a re-signed shortlist issued before its ranking assessment", async () => {
    const fixture = harness({ rankedCountries: ["SI"] });
    const { prepared } = await fixture.run();
    resignShortlistCreatedAt(fixture.database, "2026-08-12T07:59:00.000Z");

    await expect(fixture.store.loadShortlistVerified(prepared.runId))
      .rejects.toThrow("integrity_mismatch");
  });

  test("verifies persisted @1 ranking semantics against its actual @2 preference snapshot ID", async () => {
    // Break caught: hard-wiring Frontier replay to the historical @1 preference loader.
    const database = openEvidenceDatabase(":memory:");
    const preferences = v2PreferenceSnapshot();
    const loadPreferenceForRankingVerified = vi.fn(async (id: string) => {
      if (id !== preferences.id) throw new Error("profile_not_found");
      return structuredClone(preferences);
    });
    const store = new SqlitePlaceFrontierStore(database, HMAC_KEY, {
      loadPreferenceForRankingVerified,
    });
    const runId = "frontier-v2-preference";
    const profileSnapshotId = "a".repeat(64);
    const rankingId = `${runId}:ranking`;
    const result = rankPlaces({
      assessmentAt: DAY,
      preferences: preferences as never,
      places: [v2RankablePlace("PT", "0.5"), v2RankablePlace("SI", "1")],
    });
    const integrity = createEvidenceIntegrity(HMAC_KEY);
    const ranking: RankingSnapshot = {
      schemaVersion: "place-ranking@1",
      id: rankingId,
      runId,
      profileSnapshotId,
      preferenceProfileSnapshotId: preferences.id,
      assessmentAt: NOW,
      contextHash: integrity.hash(integrity.canonical({
        runId,
        profileId: profileSnapshotId,
        preferenceProfileId: preferences.id,
        assessmentAt: NOW,
        rankingSnapshotId: rankingId,
      })),
      knowledgeRevisionIds: { PT: null, SI: null },
      ordered: result.ordered,
      excludedPlaces: [],
      excluded: result.excluded,
      rulesVersion: "place-ranker@1",
      createdAt: NOW,
    };

    await store.appendRanking(ranking);

    await expect(store.loadRankingVerified(runId)).resolves.toEqual(ranking);
    expect(loadPreferenceForRankingVerified).toHaveBeenCalledWith(preferences.id);
    expect(ranking.schemaVersion).toBe("place-ranking@1");
    expect(ranking.preferenceProfileSnapshotId).toBe(preferences.id);
    database.close();
  });

  test("rejects a fabricated excluded country on append and re-signed load", async () => {
    const source = genuineExcludedHarness();
    const prepared = await source.prepare();
    const valid = await source.store.loadRankingVerified(prepared.rankingSnapshotId);
    const fabricateCountry = (payload: Record<string, unknown>) => {
      const ranking = payload as unknown as {
        excluded: Array<{ countryCode: string }>;
        knowledgeRevisionIds: Record<string, string | null>;
      };
      ranking.excluded.forEach((row) => { row.countryCode = "ZZ"; });
      delete ranking.knowledgeRevisionIds.DE;
      ranking.knowledgeRevisionIds.ZZ = null;
    };
    const forged = mutateRanking(valid, fabricateCountry);
    const preference = source.preferences.get(valid.preferenceProfileSnapshotId) as
      PreferenceProfileSnapshot;
    const emptyStore = new SqlitePlaceFrontierStore(openEvidenceDatabase(":memory:"), HMAC_KEY, {
      loadPreferenceForRankingVerified: async () => structuredClone(preference),
    });

    await expect(emptyStore.appendRanking(forged)).rejects.toThrow("integrity_mismatch");
    resignSnapshot(source.database, "ranking", fabricateCountry);
    await expect(source.store.loadRankingVerified(prepared.rankingSnapshotId))
      .rejects.toThrow("integrity_mismatch");
  });

  test.each([
    ["missing", (payload: Record<string, unknown>) => { delete payload.excludedPlaces; }],
    ["extra", (payload: Record<string, unknown>) => {
      (payload.excludedPlaces as RankablePlace[]).push(requiredPlace("ZZ", "does_not_match"));
    }],
    ["duplicate", (payload: Record<string, unknown>) => {
      (payload.excludedPlaces as RankablePlace[]).push(requiredPlace("DE", "does_not_match"));
    }],
    ["overlap", (payload: Record<string, unknown>) => {
      (payload.excludedPlaces as RankablePlace[])[0] = requiredPlace("SI", "does_not_match");
    }],
    ["altered input", (payload: Record<string, unknown>) => {
      const place = (payload.excludedPlaces as RankablePlace[])[0]!;
      (place.factors[0] as { requirementStatus: string }).requirementStatus = "matches";
    }],
    ["altered output", (payload: Record<string, unknown>) => {
      const ranking = payload as unknown as { excluded: Array<{ observationId: string }> };
      ranking.excluded[0]!.observationId = "fabricated-observation";
    }],
  ] as const)("rejects a re-signed ranking with %s excluded input integrity", async (
    _name,
    mutate,
  ) => {
    const fixture = genuineExcludedHarness();
    const prepared = await fixture.prepare();
    resignSnapshot(fixture.database, "ranking", mutate);

    await expect(fixture.store.loadRankingVerified(prepared.rankingSnapshotId))
      .rejects.toThrow("integrity_mismatch");
  });

  test.each([
    ["known match", (payload: Record<string, unknown>) => {
      firstRankingRow(payload).factors[0]!.match = "2";
    }],
    ["relevance", (payload: Record<string, unknown>) => {
      firstRankingRow(payload).relevance = "999";
    }],
    ["coverage", (payload: Record<string, unknown>) => {
      firstRankingRow(payload).coverage = "-7";
    }],
    ["factor criterion", (payload: Record<string, unknown>) => {
      firstRankingRow(payload).factors[0]!.criterionId = "infrastructure";
    }],
    ["contribution criterion", (payload: Record<string, unknown>) => {
      firstRankingRow(payload).contributions[0]!.criterionId = "infrastructure";
    }],
    ["effective match", (payload: Record<string, unknown>) => {
      firstRankingRow(payload).contributions[0]!.effectiveMatch = "42";
    }],
    ["weighted contribution", (payload: Record<string, unknown>) => {
      firstRankingRow(payload).contributions[0]!.weightedContribution = "999";
    }],
  ] as const)("rejects a semantically forged ranking %s on append and re-signed load", async (
    _name,
    mutate,
  ) => {
    const source = harness({ rankedCountries: ["SI"] });
    const prepared = await source.prepare();
    const valid = await source.store.loadRankingVerified(prepared.rankingSnapshotId);
    const forged = mutateRanking(valid, mutate);
    const emptyDatabase = openEvidenceDatabase(":memory:");
    const preference = source.preferences.get(valid.preferenceProfileSnapshotId) as
      PreferenceProfileSnapshot;
    const emptyStore = new SqlitePlaceFrontierStore(emptyDatabase, HMAC_KEY, {
      loadPreferenceForRankingVerified: async () => structuredClone(preference),
    });

    await expect(emptyStore.appendRanking(forged)).rejects.toThrow("integrity_mismatch");
    resignSnapshot(source.database, "ranking", mutate);
    await expect(source.store.loadRankingVerified(prepared.rankingSnapshotId))
      .rejects.toThrow("integrity_mismatch");
  });

  test.each([
    "relocation profile",
    "preference profile",
    "ranking Knowledge revision",
    "marker Evidence snapshot",
    "current Knowledge revision",
    "updated Knowledge revision",
    "child cold-start run",
    "completeness Evidence reference",
    "formal verdict rules version",
    "source assessment rules version",
  ] as const)("rejects an invalid referenced graph at %s without rechecking a country", async (family) => {
    const fixture = harness({
      rankedCountries: ["SI"],
      ...(family === "completeness Evidence reference"
        ? { markerByCountry: { SI: "red" as const } }
        : {}),
      ...(family === "current Knowledge revision" || family === "updated Knowledge revision"
        ? { publishKnowledgeDuringCheck: true }
        : {}),
    });
    const { prepared } = await fixture.run();
    const checksBeforePresentation = [...fixture.checks];

    if (family === "relocation profile") {
      const profile = fixture.profiles.get(prepared.profileId) as Record<string, unknown>;
      fixture.profiles.set(prepared.profileId, { ...profile, id: "0".repeat(64) });
    } else if (family === "preference profile") {
      const preferences = fixture.preferences.get(prepared.preferenceProfileId) as
        Record<string, unknown>;
      fixture.preferences.set(prepared.preferenceProfileId, {
        ...preferences,
        id: "0".repeat(64),
      });
    } else if (family === "ranking Knowledge revision") {
      resignSnapshot(fixture.database, "ranking", (payload) => {
        payload.knowledgeRevisionIds = { SI: "knowledge:DE" };
      });
    } else {
      resignSnapshot(fixture.database, "shortlist", (payload) => {
        const marker = (payload.markers as Record<string, unknown>[])[0]!;
        if (family === "marker Evidence snapshot") {
          marker.evidenceSnapshotId = "other-evidence";
        } else if (family === "current Knowledge revision") {
          marker.currentKnowledgeRevisionId = "knowledge-other:SI";
        } else if (family === "updated Knowledge revision") {
          marker.updatedKnowledgeRevisionId = "knowledge-other:SI";
        } else if (family === "child cold-start run") {
          marker.countryCheckRunId = `frontier-country:${"0".repeat(64)}`;
        } else if (family === "formal verdict rules version") {
          (marker.formalVerdict as Record<string, unknown>).rulesVersion = "formal-residence@2";
        } else if (family === "source assessment rules version") {
          marker.sourceAssessmentRulesVersion = "cold-start-assessment@2";
        } else {
          const verdict = marker.formalVerdict as {
            catalogCompleteness: {
              attestation: { catalogEvidence: Record<string, unknown>[] };
            };
          };
          verdict.catalogCompleteness.attestation.catalogEvidence[0]!.evidenceSnapshotId =
            "other-evidence";
        }
      });
    }

    await expect(fixture.application.presentPlaceFrontier(prepared.runId))
      .rejects.toThrow("integrity_mismatch");
    expect(fixture.checks).toEqual(checksBeforePresentation);
    expect(fixture.counts.present()).toBe(0);
  });

  test.each([
    ["extra ranking field", "ranking", (payload: Record<string, unknown>) => {
      payload.unexpected = true;
    }],
    ["invalid assessment instant", "ranking", (payload: Record<string, unknown>) => {
      payload.assessmentAt = "2026-08-12";
    }],
    ["contextHash not recomputed", "ranking", (payload: Record<string, unknown>) => {
      payload.contextHash = "f".repeat(64);
    }],
    ["extra shortlist field", "shortlist", (payload: Record<string, unknown>) => {
      payload.unexpected = true;
    }],
  ] as const)("rejects re-signed closed-schema violation: %s", async (_name, kind, mutate) => {
    const fixture = harness({ rankedCountries: ["SI"] });
    const { prepared } = await fixture.run();
    resignSnapshot(fixture.database, kind, mutate);

    const load = kind === "ranking"
      ? fixture.store.loadRankingVerified(prepared.rankingSnapshotId)
      : fixture.store.loadShortlistVerified(prepared.runId);
    await expect(load).rejects.toThrow("integrity_mismatch");
  });

  test("converges identical append retries and rejects conflicting retries", async () => {
    const fixture = harness({ rankedCountries: ["SI"] });
    const prepared = await fixture.prepare();
    const ranking = await fixture.store.loadRankingVerified(prepared.rankingSnapshotId);

    await expect(fixture.store.appendRanking(ranking)).resolves.toBeUndefined();
    await expect(fixture.store.appendRanking({
      ...ranking,
      contextHash: "f".repeat(64),
    })).rejects.toThrow("integrity_mismatch");
    expect(fixture.database.prepare(
      "SELECT COUNT(*) AS count FROM place_frontier_snapshots WHERE kind = 'ranking'",
    ).get()).toEqual({ count: 1 });
  });

  test("converges identical shortlist retries and rejects conflicting retries", async () => {
    const fixture = harness({ rankedCountries: ["SI"] });
    const { prepared, result } = await fixture.run();

    await expect(fixture.store.appendShortlist(result.shortlistSnapshot)).resolves.toBeUndefined();
    await expect(fixture.store.appendShortlist({
      ...result.shortlistSnapshot,
      createdAt: "2026-08-12T09:00:00.000Z",
    })).rejects.toThrow("integrity_mismatch");
    expect(fixture.database.prepare(
      "SELECT COUNT(*) AS count FROM place_frontier_snapshots WHERE kind = 'shortlist'",
    ).get()).toEqual({ count: 1 });
    expect(await fixture.store.loadShortlistVerified(prepared.runId))
      .toEqual(result.shortlistSnapshot);
  });

  test("rejects mismatched updated and current Knowledge IDs on shortlist append and load", async () => {
    const fixture = harness({ rankedCountries: ["SI"], publishKnowledgeDuringCheck: true });
    const { prepared, result } = await fixture.run();
    const mismatched = structuredClone(result.shortlistSnapshot);
    (mismatched.markers[0] as { updatedKnowledgeRevisionId: string })
      .updatedKnowledgeRevisionId = "knowledge-other:SI";
    const emptyStore = new SqlitePlaceFrontierStore(
      openEvidenceDatabase(":memory:"),
      HMAC_KEY,
      {
        loadPreferenceForRankingVerified: async () => structuredClone(
          fixture.preferences.get(result.rankingSnapshot.preferenceProfileSnapshotId) as
            PreferenceProfileSnapshot,
        ),
      },
    );
    await emptyStore.appendRanking(result.rankingSnapshot);

    await expect(emptyStore.appendShortlist(mismatched)).rejects.toThrow("integrity_mismatch");

    resignShortlist(fixture.database, (payload) => {
      (payload.markers as Array<{ updatedKnowledgeRevisionId: string }>)[0]!
        .updatedKnowledgeRevisionId = "knowledge-other:SI";
    });
    await expect(fixture.store.loadShortlistVerified(prepared.runId))
      .rejects.toThrow("integrity_mismatch");
  });

  test("converges identical writes through two real SQLite connections", async () => {
    const directory = mkdtempSync(join(tmpdir(), "place-frontier-race-"));
    const path = join(directory, "frontier.sqlite");
    try {
      const firstDatabase = openEvidenceDatabase(path);
      const fixture = harness({ rankedCountries: ["SI"] });
      const prepared = await fixture.prepare();
      const ranking = await fixture.store.loadRankingVerified(prepared.rankingSnapshotId);

      await expect(concurrentStoreWrites({
        path,
        method: "appendRanking",
        preference: fixture.preferences.get(ranking.preferenceProfileSnapshotId) as
          PreferenceProfileSnapshot,
        snapshots: [ranking, ranking],
      })).resolves.toEqual(["done", "done"]);
      expect(firstDatabase.prepare(
        "SELECT COUNT(*) AS count FROM place_frontier_snapshots",
      ).get()).toEqual({ count: 1 });
      firstDatabase.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("keeps one verified winner for conflicting concurrent ranking writes", async () => {
    const directory = mkdtempSync(join(tmpdir(), "place-frontier-conflict-race-"));
    const path = join(directory, "frontier.sqlite");
    try {
      const database = openEvidenceDatabase(path);
      const fixture = harness({ rankedCountries: ["SI"] });
      const prepared = await fixture.prepare();
      const ranking = await fixture.store.loadRankingVerified(prepared.rankingSnapshotId);
      const conflicting = {
        ...ranking,
        ordered: ranking.ordered.map((place) => ({ ...place, label: "conflicting-label" })),
      };

      await expect(concurrentStoreWrites({
        path,
        method: "appendRanking",
        preference: fixture.preferences.get(ranking.preferenceProfileSnapshotId) as
          PreferenceProfileSnapshot,
        snapshots: [ranking, conflicting],
      })).resolves.toEqual(["done", "integrity_mismatch"]);
      const preference = fixture.preferences.get(ranking.preferenceProfileSnapshotId) as
        PreferenceProfileSnapshot;
      const winner = await new SqlitePlaceFrontierStore(database, HMAC_KEY, {
        loadPreferenceForRankingVerified: async () => structuredClone(preference),
      })
        .loadRankingVerified(prepared.runId);
      expect([canonicalJson(ranking), canonicalJson(conflicting)])
        .toContain(canonicalJson(winner));
      expect(database.prepare(
        "SELECT COUNT(*) AS count FROM place_frontier_snapshots",
      ).get()).toEqual({ count: 1 });
      database.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("returns the same first winner for differing valid insert-or-load rankings", async () => {
    const directory = mkdtempSync(join(tmpdir(), "place-frontier-insert-or-load-race-"));
    const path = join(directory, "frontier.sqlite");
    try {
      const database = openEvidenceDatabase(path);
      const fixture = harness({ rankedCountries: ["SI"] });
      const prepared = await fixture.prepare();
      const ranking = await fixture.store.loadRankingVerified(prepared.rankingSnapshotId);
      const differingValidCandidate = {
        ...ranking,
        ordered: ranking.ordered.map((place) => ({ ...place, label: "Slovenia" })),
      };

      const outcomes = await concurrentStoreWrites({
        path,
        method: "insertOrLoadRanking",
        preference: fixture.preferences.get(ranking.preferenceProfileSnapshotId) as
          PreferenceProfileSnapshot,
        snapshots: [ranking, differingValidCandidate],
      });
      expect(outcomes).toHaveLength(2);
      expect(outcomes[0]).toBe(outcomes[1]);
      const winner = JSON.parse(outcomes[0]!) as RankingSnapshot;
      expect([canonicalJson(ranking), canonicalJson(differingValidCandidate)])
        .toContain(canonicalJson(winner));
      expect(await new SqlitePlaceFrontierStore(database, HMAC_KEY, {
        loadPreferenceForRankingVerified: async () => structuredClone(
          fixture.preferences.get(ranking.preferenceProfileSnapshotId) as
            PreferenceProfileSnapshot,
        ),
      }).loadRankingVerified(prepared.runId)).toEqual(winner);
      expect(database.prepare(
        "SELECT COUNT(*) AS count FROM place_frontier_snapshots WHERE kind = 'ranking'",
      ).get()).toEqual({ count: 1 });
      database.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("converges identical shortlist writes through two real SQLite connections", async () => {
    const directory = mkdtempSync(join(tmpdir(), "place-frontier-shortlist-race-"));
    const path = join(directory, "frontier.sqlite");
    try {
      const seedDatabase = openEvidenceDatabase(path);
      const fixture = harness({ rankedCountries: ["SI"] });
      const prepared = await fixture.prepare();
      const ranking = await fixture.store.loadRankingVerified(prepared.rankingSnapshotId);
      const result = await fixture.application.runPlaceFrontier(
        prepared,
        () => undefined,
        new AbortController().signal,
      );
      const preference = fixture.preferences.get(ranking.preferenceProfileSnapshotId) as
        PreferenceProfileSnapshot;
      const seedStore = new SqlitePlaceFrontierStore(seedDatabase, HMAC_KEY, {
        loadPreferenceForRankingVerified: async () => structuredClone(preference),
      });
      await seedStore.appendRanking(ranking);

      await expect(concurrentStoreWrites({
        path,
        method: "appendShortlist",
        preference,
        snapshots: [result.shortlistSnapshot, result.shortlistSnapshot],
      })).resolves.toEqual(["done", "done"]);
      expect(seedDatabase.prepare(
        "SELECT COUNT(*) AS count FROM place_frontier_snapshots WHERE kind = 'shortlist'",
      ).get()).toEqual({ count: 1 });
      seedDatabase.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test.each([
    ["malformed JSON", "{not-json"],
    ["invalid closed payload", "{}"],
  ] as const)("normalizes %s while loading a snapshot", async (_name, payloadJson) => {
    const fixture = harness({ rankedCountries: ["SI"] });
    const prepared = await fixture.prepare();
    fixture.database.exec("DROP TRIGGER place_frontier_snapshots_no_update");
    fixture.database.prepare(`
      UPDATE place_frontier_snapshots SET payload_json = ? WHERE id = ?
    `).run(payloadJson, prepared.rankingSnapshotId);

    await expect(fixture.store.loadRankingVerified(prepared.rankingSnapshotId))
      .rejects.toThrow("integrity_mismatch");
  });
  test.each([
    ["marker order", (markers: FrontierMarker[]) => markers.reverse()],
    ["rank", (markers: FrontierMarker[]) => { markers[0] = { ...markers[0]!, rank: 99 }; }],
    ["duplicate", (markers: FrontierMarker[]) => { markers[1] = markers[0]!; }],
    ["premature termination", (markers: FrontierMarker[]) => { markers.splice(5); }],
    ["rules version", (_markers: FrontierMarker[], payload: Record<string, unknown>) => {
      payload.rulesVersion = "country-frontier@2";
    }],
  ] as const)("rejects a re-signed shortlist with invalid %s", async (_name, mutate) => {
    const fixture = harness({
      rankedCountries: ["DE", "ES", "FR", "IT", "PT", "SI"],
      markerByCountry: { DE: "green", ES: "red", FR: "yellow", IT: "green", PT: "green", SI: "green" },
    });
    const { prepared } = await fixture.run();
    resignShortlist(fixture.database, (payload) => {
      mutate(payload.markers as FrontierMarker[], payload);
    });

    await expect(fixture.store.loadShortlistVerified(prepared.runId))
      .rejects.toThrow("integrity_mismatch");
  });

  test.each([
    ["formal verdict rulesVersion", (marker: FrontierMarker) => ({
      ...marker,
      formalVerdict: { ...marker.formalVerdict, rulesVersion: "formal-residence@2" },
    })],
    ["source assessment rulesVersion", (marker: FrontierMarker) => ({
      ...marker,
      sourceAssessmentRulesVersion: "cold-start-assessment@2",
    })],
    ["deterministic child run", (marker: FrontierMarker) => ({
      ...marker,
      countryCheckRunId: "frontier-country:swapped",
    })],
  ] as const)("rejects a re-signed marker with invalid %s", async (_name, mutate) => {
    const fixture = harness({ rankedCountries: ["SI"] });
    const { prepared } = await fixture.run();
    resignShortlist(fixture.database, (payload) => {
      const markers = payload.markers as FrontierMarker[];
      markers[0] = mutate(markers[0]!) as FrontierMarker;
    });

    await expect(fixture.application.presentPlaceFrontier(prepared.runId))
      .rejects.toThrow("integrity_mismatch");
  });

  test("requires exact Knowledge key coverage and country ownership", async () => {
    const missingKey = harness({
      rankedCountries: ["DE", "SI"],
      knowledgeRevisionIds: { SI: null },
    });
    await expect(missingKey.prepare()).rejects.toThrow("integrity_mismatch");

    const wrongOwner = harness({
      rankedCountries: ["SI"],
      knowledgeRevisionIds: { SI: "knowledge:DE" },
    });
    const { prepared } = await wrongOwner.run();
    await expect(wrongOwner.application.presentPlaceFrontier(prepared.runId))
      .rejects.toThrow("integrity_mismatch");
  });

  test("immutable triggers reject update and delete without a redundant lookup index", async () => {
    const fixture = harness({ rankedCountries: ["SI"] });
    const { prepared } = await fixture.run();

    expect(() => fixture.database.prepare(
      "UPDATE place_frontier_snapshots SET created_at = created_at WHERE run_id = ?",
    ).run(prepared.runId)).toThrow("place_frontier_snapshot_is_immutable");
    expect(() => fixture.database.prepare(
      "DELETE FROM place_frontier_snapshots WHERE run_id = ?",
    ).run(prepared.runId)).toThrow("place_frontier_snapshot_is_immutable");
    expect(fixture.database.prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'index' AND tbl_name = 'place_frontier_snapshots'
        AND name NOT LIKE 'sqlite_autoindex%'
    `).all()).toEqual([]);
  });
});
