import { readFileSync } from "node:fs";

import { describe, expect, expectTypeOf, test } from "vitest";

import * as cityFrontierContractsModule from
  "../../src/application/city-frontier-contracts";
import {
  type CityFrontierEvent,
  type CityFrontierOperation,
  type CityFrontierReadModel,
  type CityFrontierRevision,
  type CityFrontierRevisionPayload,
  type CityRankingSemanticInputs,
  type CityRankingSnapshot,
  type CityRankingSnapshotPayload,
  type CitySelectionAuthority,
  type CitySelectionSnapshot,
  type CitySelectionSnapshotPayload,
  type CitySelectionWithBranch,
  type CreateCitySelectionWithBranchInput,
  type SealCityFrontierRevisionInput,
  type TerminalCityShortlistSnapshot,
  type WorkingCityFrontierRevision,
  cityLiveMarkerDigest,
  createCitySelectionWithBranch,
  reconstructCityFrontierRevision,
  reconstructCityRankingSnapshot,
  reconstructCitySelectionSnapshot,
  reconstructCitySelectionWithBranch,
  sealCityFrontierRevision,
  sealCityRankingSnapshot,
  verifyCityRankingSnapshotSemantics,
} from "../../src/application/city-frontier-contracts";
import {
  type CityBranchCommit,
  type CityBranchSelectionProjection,
  type CreatePreCityBranchCommitInput,
  type PreCityBranchCommit,
  type PreCityBranchSourceProjection,
  type PreCityResolvedCountryEntryProjection,
  createCityBranchCommit,
  createPreCityBranchCommit,
  reconstructPreCityBranchCommit,
  replayCityBranchCommit,
  replayPreCityBranchCommit,
  resolvedCountryEntryDigest,
} from "../../src/branch/city";
import * as cityBranchModule from "../../src/branch/city";
import type {
  CityCatalogRevision,
  CityRegistryRevision,
} from "../../src/decision/city-catalog";
import {
  CITY_CRITERION_IDS,
  type CityCriteriaSnapshot,
  type CityCriterionEvaluation,
  type CityCriterionEvaluationInput,
  type CityCriterionEvaluatorRegistry,
  type CityCriterionId,
  type CityRankingFactInput,
} from "../../src/decision/city-criteria";
import type { CityDecisionIntegrity } from "../../src/decision/city-integrity";
import type {
  CityCommittedFactProjection,
  CityCommittedFactProjectionTuple,
  CityFrontierProjection,
  CityFrontierStopCondition,
  CityFrontierVerificationBudget,
  CityLiveMarker,
  CityTerminalEntry,
} from "../../src/decision/city-frontier-policy";
import type { CitySelectionProjection } from "../../src/decision/city-selection";
import type {
  CityKnowledgeRankingProjection,
  CityRankingResult,
} from "../../src/decision/city-ranker";
import { createEvidenceIntegrity } from "../../src/infrastructure/integrity";
import type { InstalledCityPackageExactKey } from "../../src/research/city-package";

const INTEGRITY = createEvidenceIntegrity("task-12-city-contract-test-key");
const ASSESSMENT_AT = "2026-01-02T00:00:00.000Z";
const CREATED_AT = "2026-01-03T00:00:00.000Z";
const LAST_CHECKED_AT = "2026-01-04T00:00:00.000Z";

type MutableRecord = Record<string, unknown>;
type MutableCityBranchBindingField =
  | "parentId"
  | "forkedFrom"
  | "citySelectionSnapshotId"
  | "cityId"
  | "countryCode"
  | "createdAt";

function mutable(value: unknown): MutableRecord {
  return value as MutableRecord;
}

function expectIntegrityMismatch(action: () => unknown): void {
  expect(action).toThrowError("integrity_mismatch");
}

function expectRecursivelyFrozen(value: unknown, seen = new Set<object>()): void {
  if (value === null || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  expect(Object.isFrozen(value)).toBe(true);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    expect(descriptor).toBeDefined();
    expect(descriptor !== undefined && "value" in descriptor).toBe(true);
    if (descriptor !== undefined && "value" in descriptor) {
      expectRecursivelyFrozen(descriptor.value, seen);
    }
  }
}

function criterionDefinition(criterionId: CityCriterionId) {
  return {
    criterionId,
    definitionId: `${criterionId}@1`,
    direction: "at_least" as const,
    unit: "unit",
    denominator: "municipality",
    compatibleGeoScopes: ["municipality"],
    freshnessPolicyVersion: "fresh@1",
    evaluatorVersion: "eval@1",
  };
}

function evaluateNormally({ fact }: CityCriterionEvaluationInput): CityCriterionEvaluation {
  if (fact.outcome.kind === "unknown") {
    return {
      state: "unknown",
      factor: "0",
      targetComparison: "unknown",
      unknownReason: fact.outcome.reason,
    };
  }
  const factor = fact.outcome.basis.kind === "canonical_scalar"
    ? fact.outcome.basis.value
    : "1";
  return {
    state: "verified",
    factor,
    targetComparison: factor === "0" ? "does_not_match" : "matches",
  };
}

function makeEvaluators(
  onCanonicalize?: (
    criterionId: CityCriterionId,
    receiver: unknown,
    target: unknown,
  ) => void,
  onEvaluate?: (
    criterionId: CityCriterionId,
    receiver: unknown,
    input: CityCriterionEvaluationInput,
  ) => void,
): CityCriterionEvaluatorRegistry {
  return Object.fromEntries(CITY_CRITERION_IDS.map((criterionId) => [criterionId, {
    definition: criterionDefinition(criterionId),
    canonicalizeTarget(this: unknown, target: unknown) {
      onCanonicalize?.(criterionId, this, target);
      return String(target);
    },
    evaluate(this: unknown, input: CityCriterionEvaluationInput) {
      onEvaluate?.(criterionId, this, input);
      return evaluateNormally(input);
    },
  }])) as unknown as CityCriterionEvaluatorRegistry;
}

function makeCriteria(): CityCriteriaSnapshot {
  return {
    schemaVersion: "city-criteria@1",
    id: "criteria:ljubljana",
    profileSnapshotId: "profile:confirmed",
    preferenceProfileSnapshotId: "preferences:confirmed",
    criteria: [
      {
        criterionId: "safety",
        definitionId: "safety@1",
        mode: "required",
        importance: 1,
        target: "1",
      },
      {
        criterionId: "long_term_rent",
        definitionId: "long_term_rent@1",
        mode: "weighted",
        importance: 2,
        target: "1",
      },
      {
        criterionId: "urban_transit",
        definitionId: "urban_transit@1",
        mode: "weighted",
        importance: 3,
        target: "1",
      },
      {
        criterionId: "fixed_broadband",
        definitionId: "fixed_broadband@1",
        mode: "weighted",
        importance: 4,
        target: "1",
      },
    ],
    rulesVersion: "city-criteria@1",
    confirmedAt: "2026-01-01T00:00:00.000Z",
  };
}

function verifiedFact(criterionId: CityCriterionId): CityRankingFactInput {
  return {
    criterionId,
    definitionId: `${criterionId}@1`,
    geoScope: "municipality",
    referencePeriod: "2025",
    freshnessBasis: "fresh@1",
    unit: "unit",
    denominator: "municipality",
    outcome: {
      kind: "verified",
      basis: { kind: "canonical_scalar", value: "1" },
    },
  };
}

function makeRegistry(): CityRegistryRevision {
  return {
    schemaVersion: "city-registry@1",
    id: "registry:si@1",
    packageId: "slovenia-city",
    packageSchemaVersion: "package@1",
    countryCode: "SI",
    evidenceSnapshotId: "catalog-evidence:1",
    entries: [
      {
        cityId: "alpha",
        countryCode: "SI",
        officialName: "Alpha",
        coordinate: { lat: 46.05, lng: 14.51 },
        administrativeType: "municipality",
        administrativeTerritory: "Alpha",
        capitalRoles: ["national"],
        evidenceReferenceIds: ["registry-source:alpha"],
      },
      {
        cityId: "beta",
        countryCode: "SI",
        officialName: "Beta",
        coordinate: { lat: 46.56, lng: 15.65 },
        administrativeType: "municipality",
        administrativeTerritory: "Beta",
        capitalRoles: [],
        evidenceReferenceIds: ["registry-source:beta"],
      },
    ],
    createdAt: "2025-12-20T00:00:00.000Z",
  };
}

function makeCatalog(): CityCatalogRevision {
  return {
    schemaVersion: "city-catalog@1",
    id: "catalog:si@2",
    packageId: "slovenia-city",
    packageSchemaVersion: "package@1",
    countryCode: "SI",
    registryRevisionId: "registry:si@1",
    evidenceSnapshotId: "catalog-evidence:1",
    populationDefinition: {
      definitionId: "population@1",
      geoScope: "municipality",
      unit: "people",
    },
    candidateBasis: [
      {
        cityId: "alpha",
        comparablePopulation: {
          kind: "verified",
          value: "100000",
          referencePeriod: "2025",
        },
      },
      {
        cityId: "beta",
        comparablePopulation: {
          kind: "verified",
          value: "50000",
          referencePeriod: "2025",
        },
      },
    ],
    members: [
      { cityId: "alpha", inclusionReasons: ["national_capital"] },
      { cityId: "beta", inclusionReasons: ["population_fill"] },
    ],
    coverage: { status: "complete" },
    rulesVersion: "city-catalog@2",
    createdAt: "2025-12-21T00:00:00.000Z",
  };
}

function makeKnowledge(): readonly CityKnowledgeRankingProjection[] {
  return [
    {
      cityId: "alpha",
      knowledgeRevisionId: "knowledge:alpha@1",
      facts: [
        verifiedFact("safety"),
        verifiedFact("long_term_rent"),
        verifiedFact("urban_transit"),
        verifiedFact("fixed_broadband"),
      ],
    },
    { cityId: "beta", knowledgeRevisionId: null, facts: [] },
  ];
}

function expectedRanking(): CityRankingResult {
  return {
    ordered: [
      {
        cityId: "alpha",
        rank: 1,
        score: "1",
        coverage: "1",
        knowledgeRevisionId: "knowledge:alpha@1",
        factors: [
          {
            criterionId: "safety",
            definitionId: "safety@1",
            mode: "required",
            importance: 1,
            evaluatorVersion: "eval@1",
            freshnessPolicyVersion: "fresh@1",
            state: "verified",
            factor: "1",
            weightedContribution: "1",
            targetComparison: "matches",
            requiredMismatch: false,
          },
          {
            criterionId: "long_term_rent",
            definitionId: "long_term_rent@1",
            mode: "weighted",
            importance: 2,
            evaluatorVersion: "eval@1",
            freshnessPolicyVersion: "fresh@1",
            state: "verified",
            factor: "1",
            weightedContribution: "2",
            targetComparison: "matches",
            requiredMismatch: false,
          },
          {
            criterionId: "urban_transit",
            definitionId: "urban_transit@1",
            mode: "weighted",
            importance: 3,
            evaluatorVersion: "eval@1",
            freshnessPolicyVersion: "fresh@1",
            state: "verified",
            factor: "1",
            weightedContribution: "3",
            targetComparison: "matches",
            requiredMismatch: false,
          },
          {
            criterionId: "fixed_broadband",
            definitionId: "fixed_broadband@1",
            mode: "weighted",
            importance: 4,
            evaluatorVersion: "eval@1",
            freshnessPolicyVersion: "fresh@1",
            state: "verified",
            factor: "1",
            weightedContribution: "4",
            targetComparison: "matches",
            requiredMismatch: false,
          },
        ],
      },
      {
        cityId: "beta",
        rank: 2,
        score: "0",
        coverage: "0",
        knowledgeRevisionId: null,
        factors: [
          {
            criterionId: "safety",
            definitionId: "safety@1",
            mode: "required",
            importance: 1,
            evaluatorVersion: "eval@1",
            freshnessPolicyVersion: "fresh@1",
            state: "unknown",
            factor: "0",
            weightedContribution: "0",
            targetComparison: "unknown",
            requiredMismatch: false,
            unknownReason: "no_knowledge_revision",
          },
          {
            criterionId: "long_term_rent",
            definitionId: "long_term_rent@1",
            mode: "weighted",
            importance: 2,
            evaluatorVersion: "eval@1",
            freshnessPolicyVersion: "fresh@1",
            state: "unknown",
            factor: "0",
            weightedContribution: "0",
            targetComparison: "unknown",
            requiredMismatch: false,
            unknownReason: "no_knowledge_revision",
          },
          {
            criterionId: "urban_transit",
            definitionId: "urban_transit@1",
            mode: "weighted",
            importance: 3,
            evaluatorVersion: "eval@1",
            freshnessPolicyVersion: "fresh@1",
            state: "unknown",
            factor: "0",
            weightedContribution: "0",
            targetComparison: "unknown",
            requiredMismatch: false,
            unknownReason: "no_knowledge_revision",
          },
          {
            criterionId: "fixed_broadband",
            definitionId: "fixed_broadband@1",
            mode: "weighted",
            importance: 4,
            evaluatorVersion: "eval@1",
            freshnessPolicyVersion: "fresh@1",
            state: "unknown",
            factor: "0",
            weightedContribution: "0",
            targetComparison: "unknown",
            requiredMismatch: false,
            unknownReason: "no_knowledge_revision",
          },
        ],
      },
    ],
    screenedExclusions: [],
    rulesVersion: "city-ranker@1",
  };
}

function installedPackageContext(): InstalledCityPackageExactKey {
  return {
    countryCode: "SI",
    packageId: "slovenia-city",
    packageSchemaVersion: "package@1",
    catalogRevisionId: "catalog:si@2",
    evidenceRulesVersion: "slovenia-city-evidence@7",
  };
}

function verificationBudget(): CityFrontierVerificationBudget {
  return {
    liveCityCandidateLimit: 10,
    targetSelectableCities: 3,
    rulesVersion: "city-frontier-budget@1",
  };
}

function rankingPayload(): CityRankingSnapshotPayload {
  const ranking = expectedRanking();
  return {
    schemaVersion: "city-ranking@1",
    runId: "city-frontier:run-1",
    resolvedCountryShortlistRevisionId: "country-resolution:terminal-1",
    countryCode: "SI",
    packageId: "slovenia-city",
    packageSchemaVersion: "package@1",
    preCityBranchCommitId: "pre-city-branch:root-1",
    profileSnapshotId: "profile:confirmed",
    preferenceProfileSnapshotId: "preferences:confirmed",
    registryRevisionId: "registry:si@1",
    catalogRevisionId: "catalog:si@2",
    installedPackageContext: installedPackageContext(),
    criteriaSnapshotId: "criteria:ljubljana",
    assessmentAt: ASSESSMENT_AT,
    knowledgeRevisionIds: {
      alpha: "knowledge:alpha@1",
      beta: null,
    },
    ordered: ranking.ordered,
    screenedExclusions: ranking.screenedExclusions,
    rulesVersion: "city-ranker@1",
    verificationBudget: verificationBudget(),
    createdAt: CREATED_AT,
  };
}

function semanticInputs(
  evaluators: CityCriterionEvaluatorRegistry = makeEvaluators(),
): CityRankingSemanticInputs {
  return {
    registry: makeRegistry(),
    catalog: makeCatalog(),
    criteria: makeCriteria(),
    knowledge: makeKnowledge(),
    evaluators,
  };
}

function sealPayload(payload: CityRankingSnapshotPayload = rankingPayload()): CityRankingSnapshot {
  return sealCityRankingSnapshot(payload, INTEGRITY);
}

function acceptedLink(sourceId: string, safety: boolean) {
  return {
    sourceId,
    disposition: "accepted" as const,
    navigationUrl: `https://navigation.example/${sourceId}`,
    resolvedEvidenceUrl: `https://evidence.example/${sourceId}`,
    ...(safety ? { referenceYear: 2025 } : {}),
  };
}

function reviewedLink(sourceId: string, safety: boolean) {
  return {
    sourceId,
    disposition: "reviewed_rejected" as const,
    navigationUrl: `https://navigation.example/${sourceId}`,
    resolvedEvidenceUrl: `https://evidence.example/${sourceId}`,
    ...(safety ? { referenceYear: 2025, rejectionReason: "stale" as const } : {}),
  };
}

function committedFact(
  criterionId: CityCriterionId,
  outcome: CityCommittedFactProjection["outcome"] = {
    kind: "verified",
    basis: { kind: "canonical_scalar", value: "1" },
  },
): CityCommittedFactProjection {
  const isSafety = criterionId === "safety";
  const duplicate = reviewedLink(`${criterionId}-manual-duplicate`, isSafety);
  const intervening = reviewedLink(`${criterionId}-manual-intervening`, isSafety);
  return {
    criterionId,
    definitionId: `${criterionId}@1`,
    geoScope: "municipality",
    referencePeriod: "2025",
    freshnessBasis: "fresh@1",
    unit: "unit",
    denominator: "municipality",
    outcome,
    evidenceLinks: [acceptedLink(`${criterionId}-accepted`, isSafety)],
    manualCheckLinks: [
      structuredClone(duplicate),
      intervening,
      structuredClone(duplicate),
    ],
  };
}

function greenMarker(): CityLiveMarker {
  return {
    cityId: "alpha",
    rank: 1,
    status: "selectable",
    visualStatus: "green",
    knowledgeRevisionId: "knowledge:alpha@1",
    evidenceSnapshotId: "city-evidence:alpha@1",
    lastCheckedAt: LAST_CHECKED_AT,
    requiredMismatches: [],
    unknownBasis: [],
    verificationCoverage: "1",
    facts: [
      committedFact("safety"),
      committedFact("long_term_rent"),
      committedFact("urban_transit"),
      committedFact("fixed_broadband"),
    ],
  };
}

function yellowMarker(): CityLiveMarker {
  const marker = greenMarker();
  const unknownFact = committedFact("fixed_broadband", {
    kind: "unknown",
    reason: "not_found",
  });
  return {
    ...marker,
    cityId: "beta",
    rank: 2,
    visualStatus: "yellow",
    knowledgeRevisionId: "knowledge:beta@1",
    evidenceSnapshotId: "city-evidence:beta@1",
    unknownBasis: [{
      criterionId: "fixed_broadband",
      definitionId: "fixed_broadband@1",
      reason: "not_found",
    }],
    verificationCoverage: "0.6",
    facts: [
      marker.facts[0],
      marker.facts[1],
      marker.facts[2],
      unknownFact,
    ] as CityCommittedFactProjectionTuple,
  };
}

function integrityObserver(
  onCanonical?: (value: unknown) => void,
  base: CityDecisionIntegrity = createEvidenceIntegrity(
    "task-12-observed-integrity-key",
  ),
): {
  readonly integrity: CityDecisionIntegrity;
  readonly receivers: unknown[];
  readonly canonicalValues: unknown[];
} {
  const receivers: unknown[] = [];
  const canonicalValues: unknown[] = [];
  const integrity: CityDecisionIntegrity = {
    canonical(this: unknown, value: unknown): string {
      receivers.push(this);
      canonicalValues.push(value);
      onCanonical?.(value);
      return Reflect.apply(
        base.canonical,
        Object.freeze({ capability: "canonical" }),
        [value],
      );
    },
    hash(this: unknown, canonicalText: string): string {
      receivers.push(this);
      return Reflect.apply(
        base.hash,
        Object.freeze({ capability: "hash" }),
        [canonicalText],
      );
    },
  };
  return { integrity, receivers, canonicalValues };
}

function expectExactIntegrityCallbackReceivers(receivers: readonly unknown[]): void {
  expect(receivers).toHaveLength(2);
  expect(receivers[0]).toEqual({ capability: "canonical" });
  expect(receivers[1]).toEqual({ capability: "hash" });
  expect(receivers[0]).not.toBe(receivers[1]);
  for (const receiver of receivers) {
    expect(Reflect.ownKeys(receiver as object)).toEqual(["capability"]);
    expect(Object.isFrozen(receiver)).toBe(true);
  }
}

function recursivelyFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) recursivelyFreeze(child);
  }
  return value;
}

function neutralHashWith(integrity: CityDecisionIntegrity, value: unknown): string {
  const privateValue = recursivelyFreeze(structuredClone(value));
  const canonical = Reflect.apply(
    integrity.canonical,
    Object.freeze({ capability: "canonical" }),
    [privateValue],
  );
  return Reflect.apply(
    integrity.hash,
    Object.freeze({ capability: "hash" }),
    [canonical],
  );
}

function neutralHash(value: unknown): string {
  return neutralHashWith(INTEGRITY, value);
}

function contentId(prefix: string, payload: unknown): string {
  return `${prefix}:${neutralHash(payload)}`;
}

function resolvedCountryEntry(): PreCityResolvedCountryEntryProjection {
  return {
    countryCode: "SI",
    rank: 1,
    formalMarkerDigest: "1".repeat(64),
  };
}

function preCitySource(): PreCityBranchSourceProjection {
  return {
    profileSnapshotId: "profile:confirmed",
    preferenceProfileSnapshotId: "preferences:confirmed",
    resolvedCountryShortlistRevisionId: "country-resolution:terminal-1",
    resolvedCountryEntry: resolvedCountryEntry(),
  };
}

function preCityInput(
  source: PreCityBranchSourceProjection = preCitySource(),
  createdAt = "2026-01-01T12:00:00.000Z",
): CreatePreCityBranchCommitInput {
  return { source, createdAt };
}

function manualPreCityCommit(
  source: PreCityBranchSourceProjection = preCitySource(),
  createdAt = "2026-01-01T12:00:00.000Z",
): PreCityBranchCommit {
  const payload = {
    schemaVersion: "pre-city-branch@1" as const,
    profileSnapshotId: source.profileSnapshotId,
    preferenceProfileSnapshotId: source.preferenceProfileSnapshotId,
    resolvedCountryShortlistRevisionId: source.resolvedCountryShortlistRevisionId,
    countryCode: source.resolvedCountryEntry.countryCode,
    resolvedCountryEntryDigest: neutralHash(source.resolvedCountryEntry),
    createdAt,
  };
  return { id: contentId("pre-city-branch", payload), ...payload };
}

function manualRankingSnapshot(
  preCityBranch: PreCityBranchCommit = manualPreCityCommit(),
  transform?: (payload: CityRankingSnapshotPayload) => void,
): CityRankingSnapshot {
  const payload = rankingPayload();
  mutable(payload).preCityBranchCommitId = preCityBranch.id;
  transform?.(payload);
  return {
    id: contentId("city-ranking", payload),
    ...structuredClone(payload),
  };
}

function markerEntry(marker: CityLiveMarker): CityTerminalEntry {
  return {
    cityId: marker.cityId,
    rank: marker.rank,
    markerDigest: neutralHash(marker),
    knowledgeRevisionId: marker.knowledgeRevisionId,
    evidenceSnapshotId: marker.evidenceSnapshotId,
    unknownBasis: structuredClone(marker.unknownBasis),
  };
}

function flattenReviewedLinks(marker: CityLiveMarker) {
  return marker.facts.flatMap(({ manualCheckLinks }) =>
    structuredClone(manualCheckLinks));
}

function workingProjection(
  nextUncheckedRank: number,
  selectableCityIds: readonly string[],
): CityFrontierProjection {
  return {
    kind: "working",
    nextUncheckedRank,
    selectableCityIds: [...selectableCityIds],
    phase: "verification_required",
  };
}

function terminalProjection(markers: readonly CityLiveMarker[]): CityFrontierProjection {
  return {
    kind: "terminal",
    nextUncheckedRank: markers.length + 1,
    selectableCityIds: markers
      .filter(({ status }) => status === "selectable")
      .map(({ cityId }) => cityId),
    entries: markers
      .filter(({ status }) => status === "selectable")
      .map(markerEntry),
    stopCondition: "catalog_exhausted",
  };
}

function startFrontierInput(
  rankingSnapshotId = manualRankingSnapshot().id,
): SealCityFrontierRevisionInput {
  return {
    runId: "city-frontier:run-1",
    rankingSnapshotId,
    markers: [],
    projection: workingProjection(1, []),
    operation: {
      kind: "start",
      commandId: "command:frontier-start",
      criteriaPayloadHash: "2".repeat(64),
    },
    createdAt: "2026-01-03T00:00:00.000Z",
  };
}

function flattenedFrontierPayload(
  input: SealCityFrontierRevisionInput,
): CityFrontierRevisionPayload {
  const common = {
    schemaVersion: "city-frontier@1" as const,
    runId: input.runId,
    ...(input.predecessorRevisionId === undefined
      ? {}
      : { predecessorRevisionId: input.predecessorRevisionId }),
    rankingSnapshotId: input.rankingSnapshotId,
    markers: structuredClone(input.markers),
    nextUncheckedRank: input.projection.nextUncheckedRank,
    operation: structuredClone(input.operation),
    createdAt: input.createdAt,
  };
  return input.projection.kind === "working"
    ? {
        ...common,
        kind: "working",
        phase: "verification_required",
      }
    : {
        ...common,
        kind: "terminal",
        entries: structuredClone(input.projection.entries),
        stopCondition: input.projection.stopCondition,
      };
}

function manualFrontierRevision(
  input: SealCityFrontierRevisionInput,
): CityFrontierRevision {
  const payload = flattenedFrontierPayload(input);
  return {
    id: contentId("city-frontier-revision", payload),
    ...payload,
  } as CityFrontierRevision;
}

function rootFrontierRevision(
  rankingSnapshotId = manualRankingSnapshot().id,
): WorkingCityFrontierRevision {
  return manualFrontierRevision(startFrontierInput(rankingSnapshotId)) as
    WorkingCityFrontierRevision;
}

function successorFrontierInput(
  predecessor: CityFrontierRevision = rootFrontierRevision(),
  marker: CityLiveMarker = greenMarker(),
): SealCityFrontierRevisionInput {
  return {
    runId: predecessor.runId,
    predecessorRevisionId: predecessor.id,
    rankingSnapshotId: predecessor.rankingSnapshotId,
    markers: [marker],
    projection: workingProjection(2, [marker.cityId]),
    operation: {
      kind: "city_completed",
      commandId: "command:alpha-completed",
      expectedHeadRevisionId: predecessor.id,
      cityId: marker.cityId,
      cityCheckRunId: "city-check:alpha@1",
    },
    createdAt: "2026-01-05T00:00:00.000Z",
  };
}

function terminalFrontierInput(
  rankingSnapshotId = manualRankingSnapshot().id,
): SealCityFrontierRevisionInput {
  const green = greenMarker();
  const yellow = yellowMarker();
  const predecessor = manualFrontierRevision({
    ...successorFrontierInput(rootFrontierRevision(rankingSnapshotId), green),
  });
  const markers = [green, yellow];
  return {
    runId: predecessor.runId,
    predecessorRevisionId: predecessor.id,
    rankingSnapshotId,
    markers,
    projection: terminalProjection(markers),
    operation: {
      kind: "city_completed",
      commandId: "command:beta-completed",
      expectedHeadRevisionId: predecessor.id,
      cityId: "beta",
      cityCheckRunId: "city-check:beta@1",
    },
    createdAt: "2026-01-06T00:00:00.000Z",
  };
}

function terminalFrontierRevision(
  rankingSnapshotId = manualRankingSnapshot().id,
): TerminalCityShortlistSnapshot {
  return manualFrontierRevision(terminalFrontierInput(rankingSnapshotId)) as
    TerminalCityShortlistSnapshot;
}

function selectionProjectionFor(
  marker: CityLiveMarker,
  warningCopyVersion?: "city-unknown-risk@1",
): CitySelectionProjection {
  return {
    entry: markerEntry(marker),
    reviewedSourceLinks: flattenReviewedLinks(marker),
    ...(warningCopyVersion === undefined ? {} : { warningCopyVersion }),
  };
}

function selectionAuthority(): CitySelectionAuthority {
  const preCityBranch = manualPreCityCommit();
  const ranking = manualRankingSnapshot(preCityBranch);
  return {
    terminal: terminalFrontierRevision(ranking.id),
    ranking,
    preCityBranch,
  };
}

function selectionCreateInput(
  cityId: "alpha" | "beta" = "alpha",
): CreateCitySelectionWithBranchInput {
  const authority = selectionAuthority();
  const marker = authority.terminal.markers.find(
    (candidate: CityLiveMarker) => candidate.cityId === cityId,
  )!;
  return {
    ...authority,
    commandId: `command:select-${cityId}`,
    selection: selectionProjectionFor(
      marker,
      marker.visualStatus === "yellow" ? "city-unknown-risk@1" : undefined,
    ),
    createdAt: "2026-01-07T00:00:00.000Z",
  };
}

function manualSelectionSnapshot(
  input: CreateCitySelectionWithBranchInput = selectionCreateInput(),
): CitySelectionSnapshot {
  const marker = input.terminal.markers.find(
    (candidate: CityLiveMarker) =>
      candidate.cityId === input.selection.entry.cityId,
  )!;
  const payload: CitySelectionSnapshotPayload = {
    schemaVersion: "city-selection@1",
    commandId: input.commandId,
    runId: input.terminal.runId,
    terminalRevisionId: input.terminal.id,
    cityId: marker.cityId,
    countryCode: input.ranking.countryCode,
    profileSnapshotId: input.ranking.profileSnapshotId,
    preferenceProfileSnapshotId: input.ranking.preferenceProfileSnapshotId,
    resolvedCountryShortlistRevisionId: input.ranking.resolvedCountryShortlistRevisionId,
    criteriaSnapshotId: input.ranking.criteriaSnapshotId,
    rankingSnapshotId: input.ranking.id,
    preCityBranchCommitId: input.preCityBranch.id,
    selectedMarkerDigest: neutralHash(marker),
    knowledgeRevisionId: marker.knowledgeRevisionId,
    evidenceSnapshotId: marker.evidenceSnapshotId,
    unknownBasis: structuredClone(marker.unknownBasis),
    ...(input.selection.warningCopyVersion === undefined
      ? {}
      : { warningCopyVersion: input.selection.warningCopyVersion }),
    createdAt: input.createdAt,
  };
  return { id: contentId("city-selection", payload), ...payload };
}

function branchProjectionFor(
  selection: CitySelectionSnapshot,
): CityBranchSelectionProjection {
  return {
    citySelectionSnapshotId: selection.id,
    preCityBranchCommitId: selection.preCityBranchCommitId,
    cityId: selection.cityId,
    countryCode: selection.countryCode,
    createdAt: selection.createdAt,
  };
}

function manualCityBranchCommit(
  selection: CitySelectionSnapshot,
  parent: PreCityBranchCommit,
): CityBranchCommit {
  const projection = branchProjectionFor(selection);
  const payload = {
    schemaVersion: "city-branch@1" as const,
    parentId: parent.id,
    forkedFrom: parent.id,
    citySelectionSnapshotId: projection.citySelectionSnapshotId,
    cityId: projection.cityId,
    countryCode: projection.countryCode,
    createdAt: projection.createdAt,
  };
  return { id: contentId("city-branch", payload), ...payload };
}

function manualSelectionWithBranch(
  input: CreateCitySelectionWithBranchInput = selectionCreateInput(),
): CitySelectionWithBranch {
  const selection = manualSelectionSnapshot(input);
  return {
    selection,
    commit: manualCityBranchCommit(selection, input.preCityBranch),
  };
}

function rehashFrontierRevision<T extends CityFrontierRevision>(value: T): T {
  const payload = { ...value } as MutableRecord;
  delete payload.id;
  mutable(value).id = contentId("city-frontier-revision", payload);
  return value;
}

function rehashRankingSnapshot<T extends CityRankingSnapshot>(value: T): T {
  const payload = { ...value } as MutableRecord;
  delete payload.id;
  mutable(value).id = contentId("city-ranking", payload);
  return value;
}

function rehashSelectionSnapshot<T extends CitySelectionSnapshot>(value: T): T {
  const payload = { ...value } as MutableRecord;
  delete payload.id;
  mutable(value).id = contentId("city-selection", payload);
  return value;
}

function rehashPreCityBranch<T extends PreCityBranchCommit>(value: T): T {
  const payload = { ...value } as MutableRecord;
  delete payload.id;
  mutable(value).id = contentId("pre-city-branch", payload);
  return value;
}

function rehashCityBranch<T extends CityBranchCommit>(value: T): T {
  const payload = { ...value } as MutableRecord;
  delete payload.id;
  mutable(value).id = contentId("city-branch", payload);
  return value;
}

interface Task12BoundaryCase {
  readonly family: "marker" | "ranking" | "frontier" | "pre-city" |
    "branch" | "selection";
  readonly name: string;
  readonly makePrimary: () => object;
  readonly invoke: (
    primary: object,
    integrity: CityDecisionIntegrity,
  ) => unknown;
}

function branchValueFixture(): {
  readonly parent: PreCityBranchCommit;
  readonly projection: CityBranchSelectionProjection;
  readonly commit: CityBranchCommit;
} {
  const input = selectionCreateInput();
  const selection = manualSelectionSnapshot(input);
  return {
    parent: input.preCityBranch,
    projection: branchProjectionFor(selection),
    commit: manualCityBranchCommit(selection, input.preCityBranch),
  };
}

function selectionPairFixture(): {
  readonly input: CreateCitySelectionWithBranchInput;
  readonly authority: CitySelectionAuthority;
  readonly value: CitySelectionWithBranch;
} {
  const input = selectionCreateInput();
  return {
    input,
    authority: {
      terminal: input.terminal,
      ranking: input.ranking,
      preCityBranch: input.preCityBranch,
    },
    value: manualSelectionWithBranch(input),
  };
}

function task12BoundaryCases(): readonly Task12BoundaryCase[] {
  return [
    {
      family: "marker",
      name: "live-marker digest",
      makePrimary: greenMarker,
      invoke: (primary, integrity) =>
        cityLiveMarkerDigest(primary as CityLiveMarker, integrity),
    },
    {
      family: "ranking",
      name: "ranking seal",
      makePrimary: rankingPayload,
      invoke: (primary, integrity) =>
        sealCityRankingSnapshot(primary as CityRankingSnapshotPayload, integrity),
    },
    {
      family: "ranking",
      name: "ranking reconstruction",
      makePrimary: manualRankingSnapshot,
      invoke: (primary, integrity) =>
        reconstructCityRankingSnapshot(primary, integrity),
    },
    {
      family: "ranking",
      name: "ranking semantic verification",
      makePrimary: manualRankingSnapshot,
      invoke: (primary, integrity) => verifyCityRankingSnapshotSemantics(
        primary as CityRankingSnapshot,
        semanticInputs(),
        integrity,
      ),
    },
    {
      family: "frontier",
      name: "frontier seal",
      makePrimary: startFrontierInput,
      invoke: (primary, integrity) =>
        sealCityFrontierRevision(primary as SealCityFrontierRevisionInput, integrity),
    },
    {
      family: "frontier",
      name: "frontier reconstruction",
      makePrimary: terminalFrontierRevision,
      invoke: (primary, integrity) =>
        reconstructCityFrontierRevision(primary, integrity),
    },
    {
      family: "pre-city",
      name: "resolved-country entry digest",
      makePrimary: resolvedCountryEntry,
      invoke: (primary, integrity) => resolvedCountryEntryDigest(
        primary as PreCityResolvedCountryEntryProjection,
        integrity,
      ),
    },
    {
      family: "pre-city",
      name: "pre-city create",
      makePrimary: preCityInput,
      invoke: (primary, integrity) => createPreCityBranchCommit(
        primary as CreatePreCityBranchCommitInput,
        integrity,
      ),
    },
    {
      family: "pre-city",
      name: "pre-city reconstruction",
      makePrimary: manualPreCityCommit,
      invoke: (primary, integrity) =>
        reconstructPreCityBranchCommit(primary, integrity),
    },
    {
      family: "pre-city",
      name: "pre-city source replay",
      makePrimary: manualPreCityCommit,
      invoke: (primary, integrity) =>
        replayPreCityBranchCommit(primary, preCitySource(), integrity),
    },
    {
      family: "branch",
      name: "city-branch create",
      makePrimary: () => branchValueFixture().projection,
      invoke: (primary, integrity) => createCityBranchCommit(
        primary as CityBranchSelectionProjection,
        branchValueFixture().parent,
        integrity,
      ),
    },
    {
      family: "branch",
      name: "city-branch replay",
      makePrimary: () => branchValueFixture().commit,
      invoke: (primary, integrity) => {
        const fixture = branchValueFixture();
        return replayCityBranchCommit(
          primary,
          fixture.projection,
          fixture.parent,
          integrity,
        );
      },
    },
    {
      family: "selection",
      name: "selection reconstruction",
      makePrimary: manualSelectionSnapshot,
      invoke: (primary, integrity) =>
        reconstructCitySelectionSnapshot(primary, integrity),
    },
    {
      family: "selection",
      name: "selection with branch create",
      makePrimary: () => selectionPairFixture().input,
      invoke: (primary, integrity) => createCitySelectionWithBranch(
        primary as CreateCitySelectionWithBranchInput,
        integrity,
      ),
    },
    {
      family: "selection",
      name: "selection with branch reconstruction",
      makePrimary: () => selectionPairFixture().value,
      invoke: (primary, integrity) => reconstructCitySelectionWithBranch(
        primary,
        selectionPairFixture().authority,
        integrity,
      ),
    },
  ];
}

function captureThrown(action: () => unknown): unknown {
  try {
    action();
  } catch (error) {
    return error;
  }
  throw new Error("test_expected_action_to_throw");
}

function expectFreshIntegrityMismatch(action: () => unknown, label: string): void {
  const first = captureThrown(action);
  const second = captureThrown(action);
  expect(first, label).not.toBe(second);
  expect(first, label).toBeInstanceOf(Error);
  expect(second, label).toBeInstanceOf(Error);
  expect((first as Error).message, label).toBe("integrity_mismatch");
  expect((second as Error).message, label).toBe("integrity_mismatch");
}

function literalModuleSpecifiers(source: string): readonly string[] {
  return [
    ...source.matchAll(/from\s+["']([^"']+)["']/g),
    ...source.matchAll(/^\s*import\s+["']([^"']+)["']/gm),
    ...source.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g),
    ...source.matchAll(/\brequire\s*\(\s*["']([^"']+)["']\s*\)/g),
  ].map((match) => match[1]);
}

function forbiddenContractImportSpecifiers(
  specifiers: readonly string[],
): readonly string[] {
  return specifiers.filter((specifier) =>
    /^\.\.\/infrastructure(?:\/|$)/.test(specifier) ||
    specifier === "node:crypto" ||
    specifier === "crypto" ||
    specifier === "better-sqlite3" ||
    specifier === "sqlite3" ||
    specifier === "node:sqlite");
}

function expectIntegrityCallbackReceivers(receivers: readonly unknown[]): void {
  expect(receivers.length).toBeGreaterThan(0);
  const capabilities = new Set<unknown>();
  for (const receiver of receivers) {
    expect(Reflect.ownKeys(receiver as object)).toEqual(["capability"]);
    expect(Object.isFrozen(receiver)).toBe(true);
    capabilities.add(mutable(receiver).capability);
  }
  expect(capabilities).toEqual(new Set(["canonical", "hash"]));
  expect(new Set(receivers).size).toBe(receivers.length);
}

describe("closed City Frontier contracts", () => {
  test("exports exact ranking, operation, event, selection and wrapper types", () => {
    // Break caught: widening an Application boundary, reopening a union, or dropping a lineage field.
    type ExpectedInstalledContext = {
      readonly countryCode: string;
      readonly packageId: string;
      readonly packageSchemaVersion: string;
      readonly catalogRevisionId: string;
      readonly evidenceRulesVersion: string;
    };
    type ExpectedBudget = {
      readonly liveCityCandidateLimit: 10;
      readonly targetSelectableCities: 3;
      readonly rulesVersion: "city-frontier-budget@1";
    };
    type ExpectedRanking = {
      readonly schemaVersion: "city-ranking@1";
      readonly id: string;
      readonly runId: string;
      readonly resolvedCountryShortlistRevisionId: string;
      readonly countryCode: string;
      readonly packageId: string;
      readonly packageSchemaVersion: string;
      readonly preCityBranchCommitId: string;
      readonly profileSnapshotId: string;
      readonly preferenceProfileSnapshotId: string;
      readonly registryRevisionId: string;
      readonly catalogRevisionId: string;
      readonly installedPackageContext: ExpectedInstalledContext;
      readonly criteriaSnapshotId: string;
      readonly assessmentAt: string;
      readonly knowledgeRevisionIds: Readonly<Record<string, string | null>>;
      readonly ordered: CityRankingResult["ordered"];
      readonly screenedExclusions: CityRankingResult["screenedExclusions"];
      readonly rulesVersion: "city-ranker@1";
      readonly verificationBudget: ExpectedBudget;
      readonly createdAt: string;
    };
    type ExpectedSemanticInputs = {
      readonly registry: CityRegistryRevision;
      readonly catalog: CityCatalogRevision;
      readonly criteria: CityCriteriaSnapshot;
      readonly knowledge: readonly CityKnowledgeRankingProjection[];
      readonly evaluators: CityCriterionEvaluatorRegistry;
    };
    type ExpectedOperation =
      | {
          readonly kind: "start";
          readonly commandId: string;
          readonly criteriaPayloadHash: string;
        }
      | {
          readonly kind: "city_completed";
          readonly commandId: string;
          readonly expectedHeadRevisionId: string;
          readonly cityId: string;
          readonly cityCheckRunId: string;
        };
    type ExpectedWorking = {
      readonly schemaVersion: "city-frontier@1";
      readonly kind: "working";
      readonly id: string;
      readonly runId: string;
      readonly predecessorRevisionId?: string;
      readonly rankingSnapshotId: string;
      readonly markers: readonly CityLiveMarker[];
      readonly nextUncheckedRank: number;
      readonly phase: "verification_required";
      readonly operation: ExpectedOperation;
      readonly createdAt: string;
    };
    type ExpectedTerminal = {
      readonly schemaVersion: "city-frontier@1";
      readonly kind: "terminal";
      readonly id: string;
      readonly runId: string;
      readonly predecessorRevisionId?: string;
      readonly rankingSnapshotId: string;
      readonly markers: readonly CityLiveMarker[];
      readonly nextUncheckedRank: number;
      readonly entries: readonly CityTerminalEntry[];
      readonly stopCondition: CityFrontierStopCondition;
      readonly operation: ExpectedOperation;
      readonly createdAt: string;
    };
    type ExpectedRevision = ExpectedWorking | ExpectedTerminal;
    type ExpectedRevisionPayload =
      | Omit<ExpectedWorking, "id">
      | Omit<ExpectedTerminal, "id">;
    type ExpectedSealRevisionInput = {
      readonly runId: string;
      readonly predecessorRevisionId?: string;
      readonly rankingSnapshotId: string;
      readonly markers: readonly CityLiveMarker[];
      readonly projection: CityFrontierProjection;
      readonly operation: ExpectedOperation;
      readonly createdAt: string;
    };
    type ExpectedEvent =
      | {
          readonly type: "city_activated";
          readonly runId: string;
          readonly baseRevisionId: string;
          readonly sequence: number;
          readonly occurredAt: string;
          readonly cityId: string;
          readonly rank: number;
        }
      | {
          readonly type: "city_progress";
          readonly runId: string;
          readonly baseRevisionId: string;
          readonly sequence: number;
          readonly occurredAt: string;
          readonly cityId: string;
          readonly stage: string;
          readonly label: string;
          readonly detail?: string;
          readonly sourceUrl?: string;
        }
      | {
          readonly type: "city_revision_committed";
          readonly runId: string;
          readonly baseRevisionId: string;
          readonly sequence: number;
          readonly occurredAt: string;
          readonly marker: CityLiveMarker;
          readonly revision: CityFrontierRevision;
        }
      | {
          readonly type: "city_continuation_completed";
          readonly runId: string;
          readonly baseRevisionId: string;
          readonly sequence: number;
          readonly occurredAt: string;
          readonly readModel: CityFrontierReadModel;
        };
    type ExpectedSelection = {
      readonly schemaVersion: "city-selection@1";
      readonly id: string;
      readonly commandId: string;
      readonly runId: string;
      readonly terminalRevisionId: string;
      readonly cityId: string;
      readonly countryCode: string;
      readonly profileSnapshotId: string;
      readonly preferenceProfileSnapshotId: string;
      readonly resolvedCountryShortlistRevisionId: string;
      readonly criteriaSnapshotId: string;
      readonly rankingSnapshotId: string;
      readonly preCityBranchCommitId: string;
      readonly selectedMarkerDigest: string;
      readonly knowledgeRevisionId: string;
      readonly evidenceSnapshotId: string;
      readonly unknownBasis: CityLiveMarker["unknownBasis"];
      readonly warningCopyVersion?: "city-unknown-risk@1";
      readonly createdAt: string;
    };
    type ExpectedResolvedEntry = {
      readonly countryCode: string;
      readonly rank: number;
      readonly formalMarkerDigest: string;
    };
    type ExpectedPreCitySource = {
      readonly profileSnapshotId: string;
      readonly preferenceProfileSnapshotId: string;
      readonly resolvedCountryShortlistRevisionId: string;
      readonly resolvedCountryEntry: ExpectedResolvedEntry;
    };
    type ExpectedPreCity = {
      readonly schemaVersion: "pre-city-branch@1";
      readonly id: string;
      readonly profileSnapshotId: string;
      readonly preferenceProfileSnapshotId: string;
      readonly resolvedCountryShortlistRevisionId: string;
      readonly countryCode: string;
      readonly resolvedCountryEntryDigest: string;
      readonly createdAt: string;
    };
    type ExpectedCityBranch = {
      readonly schemaVersion: "city-branch@1";
      readonly id: string;
      readonly parentId: string;
      readonly forkedFrom: string;
      readonly citySelectionSnapshotId: string;
      readonly cityId: string;
      readonly countryCode: string;
      readonly createdAt: string;
    };
    type ExpectedPreCityInput = {
      readonly source: ExpectedPreCitySource;
      readonly createdAt: string;
    };
    type ExpectedBranchSelection = {
      readonly citySelectionSnapshotId: string;
      readonly preCityBranchCommitId: string;
      readonly cityId: string;
      readonly countryCode: string;
      readonly createdAt: string;
    };
    type ExpectedSelectionAuthority = {
      readonly terminal: ExpectedTerminal;
      readonly ranking: ExpectedRanking;
      readonly preCityBranch: ExpectedPreCity;
    };
    type ExpectedCreateSelectionInput = {
      readonly terminal: ExpectedTerminal;
      readonly ranking: ExpectedRanking;
      readonly preCityBranch: ExpectedPreCity;
      readonly commandId: string;
      readonly selection: CitySelectionProjection;
      readonly createdAt: string;
    };
    type ExpectedSelectionWithBranch = {
      readonly selection: ExpectedSelection;
      readonly commit: ExpectedCityBranch;
    };

    expectTypeOf<CityRankingSnapshot>().toEqualTypeOf<ExpectedRanking>();
    expectTypeOf<CityRankingSnapshotPayload>()
      .toEqualTypeOf<Omit<ExpectedRanking, "id">>();
    expectTypeOf<CityRankingSemanticInputs>()
      .toEqualTypeOf<ExpectedSemanticInputs>();
    expectTypeOf<CityFrontierOperation>().toEqualTypeOf<ExpectedOperation>();
    expectTypeOf<WorkingCityFrontierRevision>().toEqualTypeOf<ExpectedWorking>();
    expectTypeOf<TerminalCityShortlistSnapshot>().toEqualTypeOf<ExpectedTerminal>();
    expectTypeOf<CityFrontierRevision>().toEqualTypeOf<ExpectedRevision>();
    expectTypeOf<CityFrontierRevisionPayload>()
      .toEqualTypeOf<ExpectedRevisionPayload>();
    expectTypeOf<SealCityFrontierRevisionInput>()
      .toEqualTypeOf<ExpectedSealRevisionInput>();
    expectTypeOf<CityFrontierEvent>().toEqualTypeOf<ExpectedEvent>();
    expectTypeOf<CitySelectionSnapshot>().toEqualTypeOf<ExpectedSelection>();
    expectTypeOf<CitySelectionSnapshotPayload>()
      .toEqualTypeOf<Omit<ExpectedSelection, "id">>();
    expectTypeOf<CitySelectionWithBranch>()
      .toEqualTypeOf<ExpectedSelectionWithBranch>();
    expectTypeOf<CitySelectionAuthority>()
      .toEqualTypeOf<ExpectedSelectionAuthority>();
    expectTypeOf<CreateCitySelectionWithBranchInput>()
      .toEqualTypeOf<ExpectedCreateSelectionInput>();
    expectTypeOf<PreCityResolvedCountryEntryProjection>()
      .toEqualTypeOf<ExpectedResolvedEntry>();
    expectTypeOf<PreCityBranchSourceProjection>()
      .toEqualTypeOf<ExpectedPreCitySource>();
    expectTypeOf<PreCityBranchCommit>().toEqualTypeOf<ExpectedPreCity>();
    expectTypeOf<CreatePreCityBranchCommitInput>()
      .toEqualTypeOf<ExpectedPreCityInput>();
    expectTypeOf<CityBranchCommit>().toEqualTypeOf<ExpectedCityBranch>();
    expectTypeOf<CityBranchSelectionProjection>()
      .toEqualTypeOf<ExpectedBranchSelection>();
  });

  test("pins every exact amended Task 12 function signature", () => {
    // Break caught: a decoder accepting caller authority or an authoritative wrapper losing a source.
    expectTypeOf(sealCityRankingSnapshot).toEqualTypeOf<(
      payload: CityRankingSnapshotPayload,
      integrity: CityDecisionIntegrity,
    ) => CityRankingSnapshot>();
    expectTypeOf(reconstructCityRankingSnapshot).toEqualTypeOf<(
      value: unknown,
      integrity: CityDecisionIntegrity,
    ) => CityRankingSnapshot>();
    expectTypeOf(verifyCityRankingSnapshotSemantics).toEqualTypeOf<(
      snapshot: CityRankingSnapshot,
      inputs: CityRankingSemanticInputs,
      integrity: CityDecisionIntegrity,
    ) => CityRankingSnapshot>();
    expectTypeOf(sealCityFrontierRevision).toEqualTypeOf<(
      input: SealCityFrontierRevisionInput,
      integrity: CityDecisionIntegrity,
    ) => CityFrontierRevision>();
    expectTypeOf(reconstructCityFrontierRevision).toEqualTypeOf<(
      value: unknown,
      integrity: CityDecisionIntegrity,
    ) => CityFrontierRevision>();
    expectTypeOf(reconstructCitySelectionSnapshot).toEqualTypeOf<(
      value: unknown,
      integrity: CityDecisionIntegrity,
    ) => CitySelectionSnapshot>();
    expectTypeOf(createCitySelectionWithBranch).toEqualTypeOf<(
      input: CreateCitySelectionWithBranchInput,
      integrity: CityDecisionIntegrity,
    ) => CitySelectionWithBranch>();
    expectTypeOf(reconstructCitySelectionWithBranch).toEqualTypeOf<(
      value: unknown,
      authority: CitySelectionAuthority,
      integrity: CityDecisionIntegrity,
    ) => CitySelectionWithBranch>();
    expectTypeOf(cityLiveMarkerDigest).toEqualTypeOf<(
      marker: CityLiveMarker,
      integrity: CityDecisionIntegrity,
    ) => string>();
    expectTypeOf(resolvedCountryEntryDigest).toEqualTypeOf<(
      entry: PreCityResolvedCountryEntryProjection,
      integrity: CityDecisionIntegrity,
    ) => string>();
    expectTypeOf(createPreCityBranchCommit).toEqualTypeOf<(
      input: CreatePreCityBranchCommitInput,
      integrity: CityDecisionIntegrity,
    ) => PreCityBranchCommit>();
    expectTypeOf(reconstructPreCityBranchCommit).toEqualTypeOf<(
      value: unknown,
      integrity: CityDecisionIntegrity,
    ) => PreCityBranchCommit>();
    expectTypeOf(replayPreCityBranchCommit).toEqualTypeOf<(
      value: unknown,
      source: PreCityBranchSourceProjection,
      integrity: CityDecisionIntegrity,
    ) => PreCityBranchCommit>();
    expectTypeOf(createCityBranchCommit).toEqualTypeOf<(
      selection: CityBranchSelectionProjection,
      parent: PreCityBranchCommit,
      integrity: CityDecisionIntegrity,
    ) => CityBranchCommit>();
    expectTypeOf(replayCityBranchCommit).toEqualTypeOf<(
      value: unknown,
      selection: CityBranchSelectionProjection,
      parent: PreCityBranchCommit,
      integrity: CityDecisionIntegrity,
    ) => CityBranchCommit>();
    expect(cityFrontierContractsModule).not.toHaveProperty("sealCitySelectionSnapshot");
  });

  test("exports only the frozen Task 12 runtime construction and replay surface", () => {
    // Break caught: adding an alternate Selection sealer or another unreviewed durable value path.
    expect(Object.keys(cityFrontierContractsModule).sort()).toEqual([
      "cityLiveMarkerDigest",
      "createCitySelectionWithBranch",
      "reconstructCityFrontierRevision",
      "reconstructCityRankingSnapshot",
      "reconstructCitySelectionSnapshot",
      "reconstructCitySelectionWithBranch",
      "sealCityFrontierRevision",
      "sealCityRankingSnapshot",
      "verifyCityRankingSnapshotSemantics",
    ].sort());
    expect(Object.keys(cityBranchModule).sort()).toEqual([
      "createCityBranchCommit",
      "createPreCityBranchCommit",
      "reconstructPreCityBranchCommit",
      "replayCityBranchCommit",
      "replayPreCityBranchCommit",
      "resolvedCountryEntryDigest",
    ].sort());
  });

  test("keeps pure Branch source pointed only at the Decision integrity type", () => {
    // Break caught: Branch depending outward on Application or unrelated housing/budget domains.
    const source = readFileSync(
      new URL("../../src/branch/city.ts", import.meta.url),
      "utf8",
    );
    const importPaths = literalModuleSpecifiers(source);
    const decisionImportLines = source.split("\n")
      .filter((line) => line.includes("../decision/"));

    expect(decisionImportLines).toEqual([
      'import type { CityDecisionIntegrity } from "../decision/city-integrity";',
    ]);
    expect(importPaths.filter((path) => path.startsWith("../decision/"))).toEqual([
      "../decision/city-integrity",
    ]);
    expect(source.match(/\.\.\/decision\/city-integrity/g)).toHaveLength(1);
    expect(source).not.toContain("../application/");
    expect(importPaths.filter((path) => /housing|budget/i.test(path))).toEqual([]);
    expect(forbiddenContractImportSpecifiers(importPaths)).toEqual([]);
  });

  test("keeps Application contracts free of Infrastructure, crypto and database imports", () => {
    // Break caught: moving hashing/storage implementation outward dependencies into Application.
    const source = readFileSync(
      new URL("../../src/application/city-frontier-contracts.ts", import.meta.url),
      "utf8",
    );
    expect(forbiddenContractImportSpecifiers(literalModuleSpecifiers(source)))
      .toEqual([]);
  });
});

describe("city marker digest", () => {
  test("equals the raw hash of the canonical complete marker", () => {
    // Break caught: adding a prefix, hashing a projection, or omitting a marker field.
    const marker = greenMarker();
    const digest = cityLiveMarkerDigest(marker, INTEGRITY);

    expect(digest).toBe(neutralHash(marker));
    expect(digest).toMatch(/^[a-f\d]{64}$/);
    expect(digest).not.toContain(":");
  });

  test("changes for every top-level marker field and representative nested fact data", () => {
    // Break caught: a digest projection that forgets color, time, authority, policy output or facts.
    const marker = greenMarker();
    const original = cityLiveMarkerDigest(marker, INTEGRITY);
    const mutations: readonly [string, (candidate: CityLiveMarker) => void][] = [
      ["cityId", (candidate) => { mutable(candidate).cityId = "gamma"; }],
      ["rank", (candidate) => { mutable(candidate).rank = 2; }],
      ["status", (candidate) => { mutable(candidate).status = "excluded"; }],
      ["visualStatus", (candidate) => { mutable(candidate).visualStatus = "yellow"; }],
      ["knowledgeRevisionId", (candidate) => {
        mutable(candidate).knowledgeRevisionId = "knowledge:other";
      }],
      ["evidenceSnapshotId", (candidate) => {
        mutable(candidate).evidenceSnapshotId = "city-evidence:other";
      }],
      ["lastCheckedAt", (candidate) => {
        mutable(candidate).lastCheckedAt = "2026-01-05T00:00:00.000Z";
      }],
      ["requiredMismatches", (candidate) => {
        mutable(candidate).requiredMismatches = [{
          criterionId: "safety",
          definitionId: "safety@1",
          target: "1",
          verifiedBasis: { kind: "canonical_scalar", value: "0" },
          evaluatorVersion: "eval@1",
        }];
      }],
      ["unknownBasis", (candidate) => {
        mutable(candidate).unknownBasis = [{
          criterionId: "fixed_broadband",
          definitionId: "fixed_broadband@1",
          reason: "not_found",
        }];
      }],
      ["verificationCoverage", (candidate) => {
        mutable(candidate).verificationCoverage = "0.9";
      }],
      ["fact outcome", (candidate) => {
        mutable(candidate.facts[1]).outcome = {
          kind: "verified",
          basis: { kind: "canonical_scalar", value: "0.5" },
        };
      }],
      ["accepted link", (candidate) => {
        mutable(candidate.facts[0].evidenceLinks[0]).resolvedEvidenceUrl =
          "https://evidence.example/changed";
      }],
    ];

    for (const [label, mutate] of mutations) {
      const candidate = structuredClone(marker);
      mutate(candidate);
      expect(cityLiveMarkerDigest(candidate, INTEGRITY), label).not.toBe(original);
    }
  });

  test("preserves ordered duplicate reviewed-link occurrences in the digest", () => {
    // Break caught: deduplicating, sorting, or treating duplicate link multiplicity as irrelevant.
    const marker = greenMarker();
    const original = cityLiveMarkerDigest(marker, INTEGRITY);
    const removedOccurrence = structuredClone(marker);
    const reorderedOccurrence = structuredClone(marker);
    const links = reorderedOccurrence.facts[2].manualCheckLinks as unknown as MutableRecord[];

    (removedOccurrence.facts[2].manualCheckLinks as unknown as MutableRecord[]).pop();
    [links[0], links[1]] = [links[1], links[0]];

    expect(cityLiveMarkerDigest(removedOccurrence, INTEGRITY)).not.toBe(original);
    expect(cityLiveMarkerDigest(reorderedOccurrence, INTEGRITY)).not.toBe(original);
  });

  test("rejects wrong fact-link disposition and rejection-reason literals", () => {
    // Break caught: hashing a marker whose accepted/reviewed link tuples were reopened.
    const wrongDisposition = greenMarker();
    mutable(wrongDisposition.facts[0].evidenceLinks[0]).disposition =
      "reviewed_rejected";
    const wrongReason = greenMarker();
    mutable(wrongReason.facts[0].manualCheckLinks[0]).rejectionReason =
      "not_a_reason";

    expectIntegrityMismatch(() => cityLiveMarkerDigest(wrongDisposition, INTEGRITY));
    expectIntegrityMismatch(() => cityLiveMarkerDigest(wrongReason, INTEGRITY));
  });

  test("owns the marker and integrity authority before the first callback", () => {
    // Break caught: canonicalization borrowing caller data or a later read accepting swapped hash authority.
    const marker = greenMarker();
    const cleanMarker = structuredClone(marker);
    const observation = integrityObserver(() => {
      mutable(marker).cityId = "attacker-city";
      mutable(observation.integrity).hash = () => "f".repeat(64);
    });

    const digest = cityLiveMarkerDigest(marker, observation.integrity);
    const base = createEvidenceIntegrity("task-12-observed-integrity-key");

    expect(marker.cityId).toBe("attacker-city");
    expect(digest).toBe(neutralHashWith(base, cleanMarker));
    expect(observation.canonicalValues).toHaveLength(1);
    expect(observation.canonicalValues[0]).not.toBe(marker);
    expectRecursivelyFrozen(observation.canonicalValues[0]);
    expectExactIntegrityCallbackReceivers(observation.receivers);
  });

  test("rejects descriptor-hostile marker graphs before integrity execution", () => {
    // Break caught: getters, Proxies, symbols, sparse arrays or cycles becoming digest authority.
    let calls = 0;
    const integrity: CityDecisionIntegrity = {
      canonical() { calls += 1; return "never"; },
      hash() { calls += 1; return "0".repeat(64); },
    };
    const getterMarker = greenMarker();
    Object.defineProperty(getterMarker, "cityId", {
      enumerable: true,
      get() { return "alpha"; },
    });
    const symbolMarker = greenMarker();
    Object.defineProperty(symbolMarker.facts[0], Symbol("hidden"), { value: true });
    const sparseMarker = greenMarker();
    delete (sparseMarker.facts as unknown as unknown[])[1];
    const cyclicMarker = greenMarker();
    mutable(cyclicMarker.facts[0]).cycle = cyclicMarker;
    const customPrototypeMarker = greenMarker();
    Object.setPrototypeOf(customPrototypeMarker.facts[0], { inherited: true });
    const proxyMarker = new Proxy(greenMarker(), {});

    for (const candidate of [
      getterMarker,
      symbolMarker,
      sparseMarker,
      cyclicMarker,
      customPrototypeMarker,
      proxyMarker,
    ]) {
      expectIntegrityMismatch(() => cityLiveMarkerDigest(candidate, integrity));
    }
    expect(calls).toBe(0);
  });
});

describe("City Ranking structural sealing and replay", () => {
  test("seals the exact payload with the complete context and budget in its ID", () => {
    // Break caught: hashing a projection, omitting package context/budget, or aliasing the caller payload.
    const payload = rankingPayload();
    const expectedId = `city-ranking:${neutralHash(payload)}`;

    const snapshot = sealCityRankingSnapshot(payload, INTEGRITY);

    expect(snapshot).toEqual({ id: expectedId, ...payload });
    expect(snapshot.id).toBe(expectedId);
    expect(snapshot.installedPackageContext).toEqual({
      countryCode: "SI",
      packageId: "slovenia-city",
      packageSchemaVersion: "package@1",
      catalogRevisionId: "catalog:si@2",
      evidenceRulesVersion: "slovenia-city-evidence@7",
    });
    expect(snapshot.verificationBudget).toEqual({
      liveCityCandidateLimit: 10,
      targetSelectableCities: 3,
      rulesVersion: "city-frontier-budget@1",
    });
    expect(snapshot.rulesVersion).toBe("city-ranker@1");
    expect(snapshot.installedPackageContext.evidenceRulesVersion).not.toBe(snapshot.rulesVersion);
    expect(snapshot).not.toBe(payload);
    expect(snapshot.installedPackageContext).not.toBe(payload.installedPackageContext);
    expectRecursivelyFrozen(snapshot);

    mutable(payload.installedPackageContext).evidenceRulesVersion = "attacker@1";
    mutable(payload.verificationBudget).targetSelectableCities = 99;
    mutable(payload.ordered[0]).cityId = "attacker";
    expect(snapshot.installedPackageContext.evidenceRulesVersion)
      .toBe("slovenia-city-evidence@7");
    expect(snapshot.verificationBudget.targetSelectableCities).toBe(3);
    expect(snapshot.ordered[0].cityId).toBe("alpha");
  });

  test("requires the exact five-key installed package context and three-key fixed budget", () => {
    // Break caught: accepting legacy rulesVersion, partial context, extra keys or a mutable budget decision.
    const invalidPayloads: CityRankingSnapshotPayload[] = [];
    const missingContext = rankingPayload();
    delete mutable(missingContext.installedPackageContext).evidenceRulesVersion;
    invalidPayloads.push(missingContext);
    const extraContext = rankingPayload();
    mutable(extraContext.installedPackageContext).extra = "not-authority";
    invalidPayloads.push(extraContext);
    const ambiguousContext = rankingPayload();
    delete mutable(ambiguousContext.installedPackageContext).evidenceRulesVersion;
    mutable(ambiguousContext.installedPackageContext).rulesVersion = "slovenia-city-evidence@7";
    invalidPayloads.push(ambiguousContext);
    const noncanonicalContext = rankingPayload();
    mutable(noncanonicalContext.installedPackageContext).evidenceRulesVersion = " evidence@7 ";
    invalidPayloads.push(noncanonicalContext);
    const missingBudget = rankingPayload();
    delete mutable(missingBudget.verificationBudget).targetSelectableCities;
    invalidPayloads.push(missingBudget);
    const extraBudget = rankingPayload();
    mutable(extraBudget.verificationBudget).extra = true;
    invalidPayloads.push(extraBudget);
    const changedLimit = rankingPayload();
    mutable(changedLimit.verificationBudget).liveCityCandidateLimit = 9;
    invalidPayloads.push(changedLimit);
    const changedTarget = rankingPayload();
    mutable(changedTarget.verificationBudget).targetSelectableCities = 2;
    invalidPayloads.push(changedTarget);
    const changedVersion = rankingPayload();
    mutable(changedVersion.verificationBudget).rulesVersion = "city-frontier-budget@2";
    invalidPayloads.push(changedVersion);

    for (const payload of invalidPayloads) {
      expectIntegrityMismatch(() => sealCityRankingSnapshot(payload, INTEGRITY));
    }
  });

  test("requires all four installed-context/top-level identity equations", () => {
    // Break caught: accepting a package key whose identity diverges from duplicated ranking authority.
    const divergences: readonly [keyof InstalledCityPackageExactKey, string][] = [
      ["countryCode", "AT"],
      ["packageId", "other-package"],
      ["packageSchemaVersion", "package@2"],
      ["catalogRevisionId", "catalog:other"],
    ];

    for (const [field, value] of divergences) {
      const contextOnly = rankingPayload();
      mutable(contextOnly.installedPackageContext)[field] = value;
      expectIntegrityMismatch(() => sealCityRankingSnapshot(contextOnly, INTEGRITY));

      const topLevelOnly = rankingPayload();
      mutable(topLevelOnly)[field] = value;
      expectIntegrityMismatch(() => sealCityRankingSnapshot(topLevelOnly, INTEGRITY));
    }
  });

  test("structural reconstruction rejects a rehashed context/top-level divergence", () => {
    // Break caught: enforcing installed-context equations only in the seal path.
    const candidate = structuredClone(manualRankingSnapshot());
    mutable(candidate.installedPackageContext).catalogRevisionId = "catalog:other";
    rehashRankingSnapshot(candidate);

    expectIntegrityMismatch(() => reconstructCityRankingSnapshot(candidate, INTEGRITY));
  });

  test("structural reconstruction rejects a correct digest under the wrong ID prefix before C/H", () => {
    // Break caught: accepting any prefix so long as the content digest suffix verifies.
    let integrityCalls = 0;
    const integrity: CityDecisionIntegrity = {
      canonical() { integrityCalls += 1; return "never"; },
      hash() { integrityCalls += 1; return "0".repeat(64); },
    };
    const candidate = structuredClone(manualRankingSnapshot());
    mutable(candidate).id = candidate.id.replace("city-ranking:", "ranking:");

    expectIntegrityMismatch(() => reconstructCityRankingSnapshot(candidate, integrity));
    expect(integrityCalls).toBe(0);
  });

  test("includes a context-only evidence-rules change in the rederived ranking identity", () => {
    // Break caught: dropping independently installed evidence rules from the sealed payload hash.
    const original = sealPayload();
    const changedPayload = rankingPayload();
    mutable(changedPayload.installedPackageContext).evidenceRulesVersion =
      "slovenia-city-evidence@8";

    const changed = sealPayload(changedPayload);
    const replayed = reconstructCityRankingSnapshot(changed, INTEGRITY);

    expect(changed.id).not.toBe(original.id);
    expect(changed.id).toBe(
      `city-ranking:${neutralHash(changedPayload)}`,
    );
    expect(replayed.installedPackageContext.evidenceRulesVersion)
      .toBe("slovenia-city-evidence@8");
    expect(replayed.rulesVersion).toBe("city-ranker@1");
  });

  test("reconstructs only exact hash-derived snapshots as fresh frozen data", () => {
    // Break caught: trusting an ID, returning stored aliases, or accepting replay payload tamper.
    const snapshot = sealPayload();
    const replayed = reconstructCityRankingSnapshot(snapshot, INTEGRITY);

    expect(replayed).toEqual(snapshot);
    expect(replayed).not.toBe(snapshot);
    expect(replayed.ordered).not.toBe(snapshot.ordered);
    expectRecursivelyFrozen(replayed);

    const tampered = structuredClone(snapshot);
    mutable(tampered.ordered[0]).score = "0";
    expectIntegrityMismatch(() => reconstructCityRankingSnapshot(tampered, INTEGRITY));

    const forgedId = structuredClone(snapshot);
    mutable(forgedId).id = `city-ranking:${"f".repeat(64)}`;
    expectIntegrityMismatch(() => reconstructCityRankingSnapshot(forgedId, INTEGRITY));

    const rehashedWrongSchema = structuredClone(snapshot);
    mutable(rehashedWrongSchema).schemaVersion = "city-ranking@2";
    rehashRankingSnapshot(rehashedWrongSchema);
    expectIntegrityMismatch(() =>
      reconstructCityRankingSnapshot(rehashedWrongSchema, INTEGRITY));
  });

  test("structural replay rejects representative hostile stored graphs before integrity callbacks", () => {
    // Break caught: replay reflecting through a stored Proxy or invoking an accessor while copying.
    let calls = 0;
    const integrity: CityDecisionIntegrity = {
      canonical() { calls += 1; return "never"; },
      hash() { calls += 1; return "0".repeat(64); },
    };
    const accessor = structuredClone(sealPayload());
    Object.defineProperty(accessor.installedPackageContext, "evidenceRulesVersion", {
      enumerable: true,
      get() { return "slovenia-city-evidence@7"; },
    });
    const proxy = new Proxy(structuredClone(sealPayload()), {});

    expectIntegrityMismatch(() => reconstructCityRankingSnapshot(accessor, integrity));
    expectIntegrityMismatch(() => reconstructCityRankingSnapshot(proxy, integrity));
    expect(calls).toBe(0);
  });

  test("structural replay ignores a caller-supplied semantic expectation object", () => {
    // Break caught: reintroducing a loader-context parameter or reading Registry/evaluator authority.
    const snapshot = sealPayload();
    let reads = 0;
    const poison = new Proxy({}, {
      get() { reads += 1; throw new Error("outer-layer-read"); },
      ownKeys() { reads += 1; throw new Error("outer-layer-read"); },
      getOwnPropertyDescriptor() { reads += 1; throw new Error("outer-layer-read"); },
    });
    const replayWithForbiddenThirdArgument = reconstructCityRankingSnapshot as unknown as (
      value: unknown,
      integrity: CityDecisionIntegrity,
      forbiddenExpectations: unknown,
    ) => CityRankingSnapshot;

    const replayed = replayWithForbiddenThirdArgument(snapshot, INTEGRITY, poison);

    expect(replayed).toEqual(snapshot);
    expect(reads).toBe(0);
  });

  test("owns payload and both integrity functions before canonicalization", () => {
    // Break caught: a mutating canonical callback changing sealed data or swapping later hash authority.
    const payload = rankingPayload();
    const cleanPayload = structuredClone(payload);
    const observation = integrityObserver(() => {
      mutable(payload).countryCode = "AT";
      mutable(payload.installedPackageContext).countryCode = "AT";
      mutable(payload.ordered[0]).cityId = "attacker";
      mutable(observation.integrity).hash = () => "f".repeat(64);
    });

    const snapshot = sealCityRankingSnapshot(payload, observation.integrity);
    const base = createEvidenceIntegrity("task-12-observed-integrity-key");

    expect(payload.countryCode).toBe("AT");
    expect(snapshot.countryCode).toBe("SI");
    expect(snapshot.ordered[0].cityId).toBe("alpha");
    expect(snapshot.id).toBe(`city-ranking:${neutralHashWith(base, cleanPayload)}`);
    expect(observation.canonicalValues).toHaveLength(1);
    expect(observation.canonicalValues[0]).not.toBe(payload);
    expectRecursivelyFrozen(observation.canonicalValues[0]);
    expectExactIntegrityCallbackReceivers(observation.receivers);
  });

  test("fails closed on representative hostile own-data graphs before integrity callbacks", () => {
    // Break caught: accessors, Proxy reflection, symbols, sparse arrays, cycles, prototypes or undefined keys.
    let calls = 0;
    const integrity: CityDecisionIntegrity = {
      canonical() { calls += 1; return "never"; },
      hash() { calls += 1; return "0".repeat(64); },
    };
    const accessor = rankingPayload();
    Object.defineProperty(accessor.installedPackageContext, "packageId", {
      enumerable: true,
      get() { return "slovenia-city"; },
    });
    const symbol = rankingPayload();
    Object.defineProperty(symbol.knowledgeRevisionIds, Symbol("hidden"), { value: true });
    const sparse = rankingPayload();
    delete (sparse.ordered as unknown as unknown[])[0];
    const cycle = rankingPayload();
    mutable(cycle.ordered[0]).cycle = cycle;
    const customPrototype = rankingPayload();
    Object.setPrototypeOf(customPrototype.verificationBudget, { inherited: true });
    const extra = rankingPayload();
    mutable(extra).unexpected = true;
    const missing = rankingPayload();
    delete mutable(missing).criteriaSnapshotId;
    const ownUndefined = rankingPayload();
    mutable(ownUndefined).criteriaSnapshotId = undefined;
    const proxy = new Proxy(rankingPayload(), {});

    for (const candidate of [
      accessor,
      symbol,
      sparse,
      cycle,
      customPrototype,
      extra,
      missing,
      ownUndefined,
      proxy,
    ]) {
      expectIntegrityMismatch(() => sealCityRankingSnapshot(candidate, integrity));
    }
    expect(calls).toBe(0);
  });
});

describe("City Ranking semantic verification", () => {
  test("accepts the exact five verified inputs and returns a fresh frozen snapshot", () => {
    // Break caught: omitting semantic reranking or returning the structurally loaded alias.
    const snapshot = sealPayload();

    const verified = verifyCityRankingSnapshotSemantics(
      snapshot,
      semanticInputs(),
      INTEGRITY,
    );

    expect(verified).toEqual(snapshot);
    expect(verified).not.toBe(snapshot);
    expect(verified.installedPackageContext).not.toBe(snapshot.installedPackageContext);
    expectRecursivelyFrozen(verified);
  });

  test("lets a re-sealed structurally valid altered order replay, then rejects it semantically", () => {
    // Break caught: structural replay pretending to rerank, or semantic verification trusting stored order.
    let evaluatorCalls = 0;
    const alteredPayload = rankingPayload();
    mutable(alteredPayload).ordered = [
      { ...structuredClone(alteredPayload.ordered[1]), rank: 1 },
      { ...structuredClone(alteredPayload.ordered[0]), rank: 2 },
    ];
    const altered = sealPayload(alteredPayload);
    const replayed = reconstructCityRankingSnapshot(altered, INTEGRITY);
    const inputs = semanticInputs(makeEvaluators(
      () => { evaluatorCalls += 1; },
      () => { evaluatorCalls += 1; },
    ));

    expect(replayed).toEqual(altered);
    expect(evaluatorCalls).toBe(0);
    expectIntegrityMismatch(() =>
      verifyCityRankingSnapshotSemantics(altered, inputs, INTEGRITY));
    expect(evaluatorCalls).toBeGreaterThan(0);
  });

  test("rejects verified package-schema drift and an extra Knowledge revision key", () => {
    // Break caught: treating structural agreement as verified package authority or accepting a map superset.
    const packageDriftPayload = rankingPayload();
    mutable(packageDriftPayload).packageSchemaVersion = "package@2";
    mutable(packageDriftPayload.installedPackageContext).packageSchemaVersion = "package@2";
    const packageDrift = sealPayload(packageDriftPayload);
    expect(reconstructCityRankingSnapshot(packageDrift, INTEGRITY)).toEqual(packageDrift);
    expectIntegrityMismatch(() =>
      verifyCityRankingSnapshotSemantics(packageDrift, semanticInputs(), INTEGRITY));

    const extraKnowledgeKeyPayload = rankingPayload();
    mutable(extraKnowledgeKeyPayload.knowledgeRevisionIds).gamma = null;
    const extraKnowledgeKey = sealPayload(extraKnowledgeKeyPayload);
    expect(reconstructCityRankingSnapshot(extraKnowledgeKey, INTEGRITY))
      .toEqual(extraKnowledgeKey);
    expectIntegrityMismatch(() =>
      verifyCityRankingSnapshotSemantics(extraKnowledgeKey, semanticInputs(), INTEGRITY));
  });

  test("binds every reference, catalog member, Knowledge nullability and ranking result", () => {
    // Break caught: a semantically wrong but correctly rehashed snapshot being accepted.
    const cases: readonly [string, () => {
      readonly snapshot: CityRankingSnapshot;
      readonly inputs: CityRankingSemanticInputs;
    }][] = [
      ["registry revision", () => {
        const payload = rankingPayload();
        mutable(payload).registryRevisionId = "registry:other";
        return { snapshot: sealPayload(payload), inputs: semanticInputs() };
      }],
      ["catalog revision", () => {
        const payload = rankingPayload();
        mutable(payload).catalogRevisionId = "catalog:other";
        mutable(payload.installedPackageContext).catalogRevisionId = "catalog:other";
        return { snapshot: sealPayload(payload), inputs: semanticInputs() };
      }],
      ["criteria revision", () => {
        const payload = rankingPayload();
        mutable(payload).criteriaSnapshotId = "criteria:other";
        return { snapshot: sealPayload(payload), inputs: semanticInputs() };
      }],
      ["profile binding", () => {
        const payload = rankingPayload();
        mutable(payload).profileSnapshotId = "profile:other";
        return { snapshot: sealPayload(payload), inputs: semanticInputs() };
      }],
      ["preference binding", () => {
        const payload = rankingPayload();
        mutable(payload).preferenceProfileSnapshotId = "preferences:other";
        return { snapshot: sealPayload(payload), inputs: semanticInputs() };
      }],
      ["country binding", () => {
        const payload = rankingPayload();
        mutable(payload).countryCode = "AT";
        mutable(payload.installedPackageContext).countryCode = "AT";
        return { snapshot: sealPayload(payload), inputs: semanticInputs() };
      }],
      ["package binding", () => {
        const payload = rankingPayload();
        mutable(payload).packageId = "other-package";
        mutable(payload.installedPackageContext).packageId = "other-package";
        return { snapshot: sealPayload(payload), inputs: semanticInputs() };
      }],
      ["catalog membership", () => {
        const inputs = semanticInputs();
        mutable(inputs.catalog).members = [inputs.catalog.members[0]];
        return { snapshot: sealPayload(), inputs };
      }],
      ["missing catalog member Knowledge", () => {
        const inputs = semanticInputs();
        mutable(inputs).knowledge = [inputs.knowledge[0]];
        return { snapshot: sealPayload(), inputs };
      }],
      ["extra Knowledge city", () => {
        const inputs = semanticInputs();
        mutable(inputs).knowledge = [
          ...inputs.knowledge,
          { cityId: "gamma", knowledgeRevisionId: null, facts: [] },
        ];
        return { snapshot: sealPayload(), inputs };
      }],
      ["Knowledge revision map nullability", () => {
        const payload = rankingPayload();
        mutable(payload.knowledgeRevisionIds).beta = "knowledge:beta@1";
        return { snapshot: sealPayload(payload), inputs: semanticInputs() };
      }],
      ["Knowledge revision ID", () => {
        const payload = rankingPayload();
        mutable(payload.knowledgeRevisionIds).alpha = "knowledge:alpha@2";
        return { snapshot: sealPayload(payload), inputs: semanticInputs() };
      }],
      ["Knowledge fact output", () => {
        const inputs = semanticInputs();
        const fact = inputs.knowledge[0]!.facts[1]!;
        mutable(fact.outcome).basis = { kind: "canonical_scalar", value: "0.5" };
        return { snapshot: sealPayload(), inputs };
      }],
      ["installed evaluator definition", () => {
        const evaluators = makeEvaluators();
        mutable(evaluators.long_term_rent.definition).evaluatorVersion = "eval@2";
        return { snapshot: sealPayload(), inputs: semanticInputs(evaluators) };
      }],
      ["factor output", () => {
        const payload = rankingPayload();
        mutable(payload.ordered[0].factors[1]).factor = "0.5";
        mutable(payload.ordered[0].factors[1]).weightedContribution = "1";
        mutable(payload.ordered[0]).score = "0.9";
        return { snapshot: sealPayload(payload), inputs: semanticInputs() };
      }],
      ["screened output", () => {
        const payload = rankingPayload();
        const screened = structuredClone(payload.ordered[0]) as unknown as MutableRecord;
        delete screened.rank;
        mutable(payload).screenedExclusions = [
          {
            ...screened,
            requiredMismatches: [],
          },
        ];
        mutable(payload).ordered = [payload.ordered[1]];
        return { snapshot: sealPayload(payload), inputs: semanticInputs() };
      }],
    ];

    for (const [label, makeCase] of cases) {
      const { snapshot, inputs } = makeCase();
      expect(() => verifyCityRankingSnapshotSemantics(snapshot, inputs, INTEGRITY), label)
        .toThrowError("integrity_mismatch");
    }
  });

  test("requires the exact five own-data semantic input keys before evaluator execution", () => {
    // Break caught: partial/extra semantic authority or reflective roots reaching evaluator callbacks.
    let evaluatorCalls = 0;
    const evaluators = makeEvaluators(
      () => { evaluatorCalls += 1; },
      () => { evaluatorCalls += 1; },
    );
    const missing = semanticInputs(evaluators);
    delete mutable(missing).knowledge;
    const extra = semanticInputs(evaluators);
    mutable(extra).expectedAssessmentAt = ASSESSMENT_AT;
    const ownUndefined = semanticInputs(evaluators);
    mutable(ownUndefined).knowledge = undefined;
    const accessor = semanticInputs(evaluators);
    Object.defineProperty(accessor, "catalog", {
      enumerable: true,
      get() { return makeCatalog(); },
    });
    const proxy = new Proxy(semanticInputs(evaluators), {});

    for (const inputs of [missing, extra, ownUndefined, accessor, proxy]) {
      expectIntegrityMismatch(() =>
        verifyCityRankingSnapshotSemantics(sealPayload(), inputs, INTEGRITY));
    }
    expect(evaluatorCalls).toBe(0);
  });

  test("prevalidates Registry, Catalog and every Criteria draft before any callback", () => {
    // Break caught: a later malformed verified input reaching ranking integrity or earlier evaluators.
    let integrityCalls = 0;
    let evaluatorCalls = 0;
    const integrity: CityDecisionIntegrity = {
      canonical() { integrityCalls += 1; return "never"; },
      hash() { integrityCalls += 1; return "0".repeat(64); },
    };
    const cases: readonly [string, () => CityRankingSemanticInputs][] = [
      ["Registry createdAt", () => {
        const inputs = semanticInputs(makeEvaluators(
          () => { evaluatorCalls += 1; },
          () => { evaluatorCalls += 1; },
        ));
        mutable(inputs.registry).createdAt = "2025-12-20T00:00:00Z";
        return inputs;
      }],
      ["Registry nested text", () => {
        const inputs = semanticInputs(makeEvaluators(
          () => { evaluatorCalls += 1; },
          () => { evaluatorCalls += 1; },
        ));
        mutable(inputs.registry.entries[0]).officialName = " Alpha ";
        return inputs;
      }],
      ["Catalog createdAt", () => {
        const inputs = semanticInputs(makeEvaluators(
          () => { evaluatorCalls += 1; },
          () => { evaluatorCalls += 1; },
        ));
        mutable(inputs.catalog).createdAt = "2025-12-20T00:00:00Z";
        return inputs;
      }],
      ["later Criteria target", () => {
        const inputs = semanticInputs(makeEvaluators(
          () => { evaluatorCalls += 1; },
          () => { evaluatorCalls += 1; },
        ));
        mutable(inputs.criteria.criteria[3]).target = " \n";
        return inputs;
      }],
    ];

    for (const [label, makeInputs] of cases) {
      expectFreshIntegrityMismatch(
        () => verifyCityRankingSnapshotSemantics(
          sealPayload(),
          makeInputs(),
          integrity,
        ),
        label,
      );
    }
    expect(integrityCalls).toBe(0);
    expect(evaluatorCalls).toBe(0);
  });

  test("owns all five semantic inputs and evaluator capabilities before the first callback", () => {
    // Break caught: late reads from Registry/Catalog/Criteria/Knowledge or remaining evaluator entries.
    const retainedArguments: CityCriterionEvaluationInput[] = [];
    const receivers: unknown[] = [];
    let attacked = false;
    const borrowed: {
      inputs?: CityRankingSemanticInputs;
      evaluators?: CityCriterionEvaluatorRegistry;
      snapshot?: CityRankingSnapshot;
    } = {};
    const attack = () => {
      if (attacked) return;
      attacked = true;
      const inputs = borrowed.inputs;
      const borrowedEvaluators = borrowed.evaluators;
      const snapshot = borrowed.snapshot;
      if (inputs === undefined || borrowedEvaluators === undefined || snapshot === undefined) {
        throw new Error("test_fixture_not_ready");
      }
      mutable(snapshot.ordered[0]).cityId = "snapshot-attacker";
      mutable(inputs.registry).id = "registry:attacker";
      mutable(inputs.registry.entries[0]).officialName = "Registry Attacker";
      (inputs.registry.entries as unknown as MutableRecord[]).reverse();
      mutable(inputs.catalog).id = "catalog:attacker";
      mutable(inputs.catalog.members[0]).cityId = "catalog-attacker";
      (inputs.catalog.members as unknown as MutableRecord[]).reverse();
      mutable(inputs.criteria.criteria[0]).target = "0";
      mutable(inputs.knowledge[0]!.facts[0]!.outcome).basis = {
        kind: "canonical_scalar",
        value: "0",
      };
      (inputs.knowledge as unknown as MutableRecord[]).splice(0);
      for (const criterionId of CITY_CRITERION_IDS) {
        mutable(borrowedEvaluators[criterionId].definition).evaluatorVersion =
          "eval@attacker";
        mutable(borrowedEvaluators)[criterionId] = {
          definition: criterionDefinition(criterionId),
          canonicalizeTarget: () => "attacker",
          evaluate: () => ({
            state: "verified",
            factor: "0",
            targetComparison: "does_not_match",
          }),
        };
      }
    };
    const borrowedEvaluators = makeEvaluators(
      (_criterionId, receiver) => {
        receivers.push(receiver);
        attack();
      },
      (_criterionId, receiver, input) => {
        receivers.push(receiver);
        retainedArguments.push(input);
        attack();
      },
    );
    const inputs = semanticInputs(borrowedEvaluators);
    const borrowedRegistryEntry = inputs.registry.entries[0];
    const borrowedCatalogMember = inputs.catalog.members[0];
    const borrowedKnowledgeFact = inputs.knowledge[0]!.facts[0]!;
    const borrowedDefinitions = CITY_CRITERION_IDS.map(
      (criterionId) => borrowedEvaluators[criterionId].definition,
    );
    borrowed.inputs = inputs;
    borrowed.evaluators = borrowedEvaluators;
    const cleanSnapshot = sealPayload();
    const snapshot = structuredClone(cleanSnapshot);
    borrowed.snapshot = snapshot;

    const verified = verifyCityRankingSnapshotSemantics(snapshot, inputs, INTEGRITY);

    expect(attacked).toBe(true);
    expect(inputs.registry.id).toBe("registry:attacker");
    expect(borrowedRegistryEntry.officialName).toBe("Registry Attacker");
    expect(inputs.catalog.id).toBe("catalog:attacker");
    expect(borrowedCatalogMember.cityId).toBe("catalog-attacker");
    expect(inputs.criteria.criteria[0].target).toBe("0");
    expect(borrowedKnowledgeFact.outcome).toEqual({
      kind: "verified",
      basis: { kind: "canonical_scalar", value: "0" },
    });
    expect(inputs.knowledge).toHaveLength(0);
    expect(snapshot.ordered[0].cityId).toBe("snapshot-attacker");
    expect(borrowedDefinitions.every(
      ({ evaluatorVersion }) => evaluatorVersion === "eval@attacker",
    )).toBe(true);
    expect(verified).toEqual(cleanSnapshot);
    expect(receivers).toHaveLength(16);
    expect(receivers.filter((receiver) =>
      mutable(receiver).capability === "canonicalizeTarget")).toHaveLength(12);
    expect(receivers.filter((receiver) =>
      mutable(receiver).capability === "evaluate")).toHaveLength(4);
    expect(new Set(receivers).size).toBe(receivers.length);
    expect(retainedArguments).toHaveLength(4);
    for (const receiver of receivers) {
      expect(Reflect.ownKeys(receiver as object)).toEqual(["capability"]);
      expect(mutable(receiver).capability === "canonicalizeTarget" ||
        mutable(receiver).capability === "evaluate").toBe(true);
      expect(Object.isFrozen(receiver)).toBe(true);
      expect(receiver).not.toBe(borrowedEvaluators);
    }
    for (const argument of retainedArguments) {
      expect(Reflect.ownKeys(argument).sort()).toEqual([
        "assessmentAt", "criterion", "fact",
      ]);
      expect(Reflect.ownKeys(argument.fact).sort()).toEqual([
        "criterionId", "definitionId", "denominator", "freshnessBasis",
        "geoScope", "outcome", "referencePeriod", "unit",
      ].sort());
      expect(argument.assessmentAt).toBe(ASSESSMENT_AT);
      expectRecursivelyFrozen(argument);
    }

    expect(() => {
      mutable(retainedArguments[0].fact).definitionId = "attacker@1";
    }).toThrow();
    expect(verified.ordered[0].factors[0].definitionId).toBe("safety@1");
    expectRecursivelyFrozen(verified);
  });
});

describe("City Frontier revision structural contracts", () => {
  test("seals exact flattened root, successor and terminal content IDs", () => {
    // Break caught: hashing the nested projection, retaining transient selectable IDs, or wrong prefix.
    const rootInput = startFrontierInput();
    const expectedRootPayload = flattenedFrontierPayload(rootInput);
    const root = sealCityFrontierRevision(rootInput, INTEGRITY);
    const successorInput = successorFrontierInput(root);
    const expectedSuccessorPayload = flattenedFrontierPayload(successorInput);
    const successor = sealCityFrontierRevision(successorInput, INTEGRITY);
    const terminalInput = terminalFrontierInput(rootInput.rankingSnapshotId);
    const expectedTerminalPayload = flattenedFrontierPayload(terminalInput);
    const terminal = sealCityFrontierRevision(terminalInput, INTEGRITY);

    expect(root).toEqual({
      id: `city-frontier-revision:${neutralHash(expectedRootPayload)}`,
      ...expectedRootPayload,
    });
    expect(successor).toEqual({
      id: `city-frontier-revision:${neutralHash(expectedSuccessorPayload)}`,
      ...expectedSuccessorPayload,
    });
    expect(terminal).toEqual({
      id: `city-frontier-revision:${neutralHash(expectedTerminalPayload)}`,
      ...expectedTerminalPayload,
    });
    expect(root).not.toBe(rootInput);
    expect(root.markers).not.toBe(rootInput.markers);
    expect(successor.markers).not.toBe(successorInput.markers);
    expect(terminal.markers).not.toBe(terminalInput.markers);
    expectRecursivelyFrozen(root);
    expectRecursivelyFrozen(successor);
    expectRecursivelyFrozen(terminal);
  });

  test("structurally reconstructs root, successor and terminal as fresh frozen values", () => {
    // Break caught: structural replay trusting aliases or accepting an ID detached from flattened content.
    const values = [
      rootFrontierRevision(),
      manualFrontierRevision(successorFrontierInput()),
      terminalFrontierRevision(),
    ];

    for (const value of values) {
      const replayed = reconstructCityFrontierRevision(value, INTEGRITY);
      expect(replayed).toEqual(value);
      expect(replayed).not.toBe(value);
      expect(replayed.markers).not.toBe(value.markers);
      expectRecursivelyFrozen(replayed);
    }
  });

  test("enforces start and city-completed predecessor/operation authority", () => {
    // Break caught: a root with history or a successor detached from its predecessor/final marker.
    const rootWithPredecessor = startFrontierInput();
    mutable(rootWithPredecessor).predecessorRevisionId = "city-frontier-revision:previous";
    const rootWithMarker = startFrontierInput();
    mutable(rootWithMarker).markers = [greenMarker()];
    const startWithUppercaseHash = startFrontierInput();
    mutable(startWithUppercaseHash.operation).criteriaPayloadHash = "A".repeat(64);
    const noPredecessor = successorFrontierInput();
    delete mutable(noPredecessor).predecessorRevisionId;
    const ownUndefinedPredecessor = successorFrontierInput();
    mutable(ownUndefinedPredecessor).predecessorRevisionId = undefined;
    const staleExpectedHead = successorFrontierInput();
    mutable(staleExpectedHead.operation).expectedHeadRevisionId = "city-frontier-revision:stale";
    const noMarkers = successorFrontierInput();
    mutable(noMarkers).markers = [];
    const wrongFinalCity = successorFrontierInput();
    mutable(wrongFinalCity.operation).cityId = "beta";

    for (const input of [
      rootWithPredecessor,
      rootWithMarker,
      startWithUppercaseHash,
      noPredecessor,
      ownUndefinedPredecessor,
      staleExpectedHead,
      noMarkers,
      wrongFinalCity,
    ]) {
      expectIntegrityMismatch(() => sealCityFrontierRevision(input, INTEGRITY));
    }
  });

  test("reconstruction repeats bounded root and successor operation laws after outer rehash", () => {
    // Break caught: a loader checking only content identity after seal enforced operation authority.
    const rootWithPredecessor = structuredClone(rootFrontierRevision());
    mutable(rootWithPredecessor).predecessorRevisionId =
      "city-frontier-revision:unexpected-parent";
    rehashFrontierRevision(rootWithPredecessor);

    const rootWithMarker = structuredClone(rootFrontierRevision());
    mutable(rootWithMarker).markers = [greenMarker()];
    rehashFrontierRevision(rootWithMarker);

    const successorWithoutPredecessor = structuredClone(
      manualFrontierRevision(successorFrontierInput()),
    );
    delete mutable(successorWithoutPredecessor).predecessorRevisionId;
    rehashFrontierRevision(successorWithoutPredecessor);

    const successorWithoutMarkers = structuredClone(
      manualFrontierRevision(successorFrontierInput()),
    );
    mutable(successorWithoutMarkers).markers = [];
    rehashFrontierRevision(successorWithoutMarkers);

    const staleExpectedHead = structuredClone(
      manualFrontierRevision(successorFrontierInput()),
    );
    mutable(staleExpectedHead.operation).expectedHeadRevisionId =
      "city-frontier-revision:stale";
    rehashFrontierRevision(staleExpectedHead);

    const wrongFinalCity = structuredClone(
      manualFrontierRevision(successorFrontierInput()),
    );
    mutable(wrongFinalCity.operation).cityId = "beta";
    rehashFrontierRevision(wrongFinalCity);

    for (const candidate of [
      rootWithPredecessor,
      rootWithMarker,
      successorWithoutPredecessor,
      successorWithoutMarkers,
      staleExpectedHead,
      wrongFinalCity,
    ]) {
      expectIntegrityMismatch(() => reconstructCityFrontierRevision(candidate, INTEGRITY));
    }
  });

  test("requires every terminal entry field and digest to equal its unique selectable marker", () => {
    // Break caught: a rehashed outer revision legitimizing a stale/fake terminal projection.
    const terminal = terminalFrontierRevision();
    const mutations: readonly [string, (entry: MutableRecord) => void][] = [
      ["cityId", (entry) => { entry.cityId = "gamma"; }],
      ["rank", (entry) => { entry.rank = 2; }],
      ["markerDigest", (entry) => { entry.markerDigest = "f".repeat(64); }],
      ["knowledgeRevisionId", (entry) => {
        entry.knowledgeRevisionId = "knowledge:other";
      }],
      ["evidenceSnapshotId", (entry) => {
        entry.evidenceSnapshotId = "city-evidence:other";
      }],
      ["unknownBasis", (entry) => {
        entry.unknownBasis = [{
          criterionId: "fixed_broadband",
          definitionId: "fixed_broadband@1",
          reason: "not_found",
        }];
      }],
    ];

    for (const [label, mutateEntry] of mutations) {
      const candidate = structuredClone(terminal);
      mutateEntry(mutable((candidate as TerminalCityShortlistSnapshot).entries[0]));
      const payload = { ...candidate } as MutableRecord;
      delete payload.id;
      mutable(candidate).id = contentId("city-frontier-revision", payload);
      expect(
        () => reconstructCityFrontierRevision(candidate, INTEGRITY),
        label,
      ).toThrowError("integrity_mismatch");
    }
  });

  test("rejects a self-consistent valid-looking fake terminal digest for an unchanged marker", () => {
    // Break caught: checking only entry/outer IDs instead of recomputing the complete live marker digest.
    const candidate = structuredClone(terminalFrontierRevision());
    mutable(candidate.entries[0]).markerDigest = "e".repeat(64);
    const payload = { ...candidate } as MutableRecord;
    delete payload.id;
    mutable(candidate).id = contentId("city-frontier-revision", payload);

    expectIntegrityMismatch(() => reconstructCityFrontierRevision(candidate, INTEGRITY));
  });

  test("accepts a fully self-consistent marker link, digest, entry and outer-ID change structurally", () => {
    // Break caught: structural replay overclaiming later Task 11 plus Knowledge/Evidence authority.
    const candidate = structuredClone(terminalFrontierRevision());
    const marker = candidate.markers[0];
    mutable(marker.facts[0].manualCheckLinks[1]).navigationUrl =
      "https://navigation.example/self-consistent-review";
    mutable(candidate.entries[0]).markerDigest = neutralHash(marker);
    const payload = { ...candidate } as MutableRecord;
    delete payload.id;
    mutable(candidate).id = contentId("city-frontier-revision", payload);

    const replayed = reconstructCityFrontierRevision(candidate, INTEGRITY);

    expect(replayed).toEqual(candidate);
    expectRecursivelyFrozen(replayed);
  });

  test("rejects duplicate terminal entries and entries for excluded markers", () => {
    // Break caught: ambiguous city-to-entry lookup or making a red marker selectable structurally.
    const duplicate = structuredClone(terminalFrontierRevision());
    mutable(duplicate).entries = [duplicate.entries[0], structuredClone(duplicate.entries[0])];
    const excluded = structuredClone(terminalFrontierRevision());
    mutable(excluded.markers[0]).status = "excluded";
    mutable(excluded.markers[0]).visualStatus = "red";
    mutable(excluded.entries[0]).markerDigest = neutralHash(excluded.markers[0]);

    for (const candidate of [duplicate, excluded]) {
      const payload = { ...candidate } as MutableRecord;
      delete payload.id;
      mutable(candidate).id = contentId("city-frontier-revision", payload);
      expectIntegrityMismatch(() => reconstructCityFrontierRevision(candidate, INTEGRITY));
    }
  });

  test("rejects a missing selectable entry and an ambiguously duplicated matching marker", () => {
    // Break caught: validating only supplied entries instead of an exact selectable-marker bijection.
    const missingEntry = structuredClone(terminalFrontierRevision());
    mutable(missingEntry).entries = [missingEntry.entries[0]];
    rehashFrontierRevision(missingEntry);

    const duplicateMarker = structuredClone(terminalFrontierRevision());
    mutable(duplicateMarker).markers = [
      duplicateMarker.markers[0],
      structuredClone(duplicateMarker.markers[0]),
    ];
    mutable(duplicateMarker).entries = [duplicateMarker.entries[0]];
    mutable(duplicateMarker.operation).cityId = duplicateMarker.markers[0].cityId;
    rehashFrontierRevision(duplicateMarker);

    expectIntegrityMismatch(() =>
      reconstructCityFrontierRevision(missingEntry, INTEGRITY));
    expectIntegrityMismatch(() =>
      reconstructCityFrontierRevision(duplicateMarker, INTEGRITY));
  });
});

describe("pre-city branch source and replay", () => {
  test("hashes the exact complete resolved-country entry as a raw lowercase digest", () => {
    // Break caught: hashing only country or dropping rank/formal marker authority.
    const entry = resolvedCountryEntry();
    const digest = resolvedCountryEntryDigest(entry, INTEGRITY);

    expect(digest).toBe(neutralHash(entry));
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    for (const mutateEntry of [
      (candidate: MutableRecord) => { candidate.countryCode = "AT"; },
      (candidate: MutableRecord) => { candidate.rank = 2; },
      (candidate: MutableRecord) => { candidate.formalMarkerDigest = "3".repeat(64); },
    ]) {
      const candidate = structuredClone(entry);
      mutateEntry(mutable(candidate));
      expect(resolvedCountryEntryDigest(candidate, INTEGRITY)).not.toBe(digest);
    }
  });

  test("creates the deterministic flattened pre-city parent and returns no aliases", () => {
    // Break caught: storing the source wrapper, omitting a binding, or using a non-content ID.
    const input = preCityInput();
    const expected = manualPreCityCommit(input.source, input.createdAt);

    const first = createPreCityBranchCommit(input, INTEGRITY);
    const second = createPreCityBranchCommit(structuredClone(input), INTEGRITY);

    expect(first).toEqual(expected);
    expect(second).toEqual(expected);
    expect(first).not.toBe(second);
    expect(first).not.toBe(input);
    expect(first.id).toBe(`pre-city-branch:${neutralHash({
      schemaVersion: "pre-city-branch@1",
      profileSnapshotId: "profile:confirmed",
      preferenceProfileSnapshotId: "preferences:confirmed",
      resolvedCountryShortlistRevisionId: "country-resolution:terminal-1",
      countryCode: "SI",
      resolvedCountryEntryDigest: neutralHash(input.source.resolvedCountryEntry),
      createdAt: "2026-01-01T12:00:00.000Z",
    })}`);
    expectRecursivelyFrozen(first);
  });

  test("structural replay accepts a self-consistent source-field rehash", () => {
    // Break caught: structural replay pretending it was given the verified pre-city source.
    const changedSource = preCitySource();
    mutable(changedSource).profileSnapshotId = "profile:self-consistent-other";
    const changed = manualPreCityCommit(changedSource);

    const replayed = reconstructPreCityBranchCommit(changed, INTEGRITY);

    expect(replayed).toEqual(changed);
    expect(replayed).not.toBe(changed);
    expectRecursivelyFrozen(replayed);
  });

  test("source replay rejects every self-consistently rehashed source-bound field", () => {
    // Break caught: content integrity being mistaken for verified source authority.
    const source = preCitySource();
    const candidates: PreCityBranchCommit[] = [];
    const profile = structuredClone(source);
    mutable(profile).profileSnapshotId = "profile:forged";
    candidates.push(manualPreCityCommit(profile));
    const preference = structuredClone(source);
    mutable(preference).preferenceProfileSnapshotId = "preferences:forged";
    candidates.push(manualPreCityCommit(preference));
    const resolvedRevision = structuredClone(source);
    mutable(resolvedRevision).resolvedCountryShortlistRevisionId =
      "country-resolution:forged";
    candidates.push(manualPreCityCommit(resolvedRevision));
    const country = structuredClone(manualPreCityCommit(source));
    mutable(country).countryCode = "AT";
    const countryPayload = { ...country } as MutableRecord;
    delete countryPayload.id;
    mutable(country).id = contentId("pre-city-branch", countryPayload);
    candidates.push(country);
    const entryDigest = structuredClone(manualPreCityCommit(source));
    mutable(entryDigest).resolvedCountryEntryDigest = "4".repeat(64);
    const entryPayload = { ...entryDigest } as MutableRecord;
    delete entryPayload.id;
    mutable(entryDigest).id = contentId("pre-city-branch", entryPayload);
    candidates.push(entryDigest);

    for (const candidate of candidates) {
      expect(reconstructPreCityBranchCommit(candidate, INTEGRITY)).toEqual(candidate);
      expectIntegrityMismatch(() => replayPreCityBranchCommit(candidate, source, INTEGRITY));
    }
  });

  test("source replay accepts a self-consistent createdAt-only rehash", () => {
    // Break caught: source replay overclaiming time authority absent from its source projection.
    const source = preCitySource();
    const changed = manualPreCityCommit(source, "2026-01-01T13:00:00.000Z");

    const replayed = replayPreCityBranchCommit(changed, source, INTEGRITY);

    expect(replayed).toEqual(changed);
    expectRecursivelyFrozen(replayed);
  });

  test("rejects structural tamper, noncanonical scalars and open source shapes", () => {
    // Break caught: optional undefined, weak digest/rank/country laws, or ignored extra authority.
    const tampered = structuredClone(manualPreCityCommit());
    mutable(tampered).profileSnapshotId = "profile:tampered";
    const invalidInputs = [
      (() => {
        const input = preCityInput();
        mutable(input).extra = true;
        return input;
      })(),
      (() => {
        const input = preCityInput();
        mutable(input.source).profileSnapshotId = " profile:confirmed ";
        return input;
      })(),
      (() => {
        const input = preCityInput();
        mutable(input.source.resolvedCountryEntry).countryCode = "si";
        return input;
      })(),
      (() => {
        const input = preCityInput();
        mutable(input.source.resolvedCountryEntry).rank = 0;
        return input;
      })(),
      (() => {
        const input = preCityInput();
        mutable(input.source.resolvedCountryEntry).formalMarkerDigest = "A".repeat(64);
        return input;
      })(),
      (() => {
        const input = preCityInput();
        mutable(input).createdAt = "2026-01-01";
        return input;
      })(),
    ];

    expectIntegrityMismatch(() => reconstructPreCityBranchCommit(tampered, INTEGRITY));
    for (const input of invalidInputs) {
      expectIntegrityMismatch(() => createPreCityBranchCommit(input, INTEGRITY));
    }
  });
});

describe("granular City Branch values", () => {
  test("creates exact content-addressed sibling commits from one pre-city parent", () => {
    // Break caught: deriving a new parent per city or losing forkedFrom lineage.
    const parent = manualPreCityCommit();
    const alphaSelection = manualSelectionSnapshot(selectionCreateInput("alpha"));
    const betaSelection = manualSelectionSnapshot(selectionCreateInput("beta"));
    const alphaProjection = branchProjectionFor(alphaSelection);
    const betaProjection = branchProjectionFor(betaSelection);

    const alpha = createCityBranchCommit(alphaProjection, parent, INTEGRITY);
    const beta = createCityBranchCommit(betaProjection, parent, INTEGRITY);

    expect(alpha).toEqual(manualCityBranchCommit(alphaSelection, parent));
    expect(beta).toEqual(manualCityBranchCommit(betaSelection, parent));
    expect(alpha.id).not.toBe(beta.id);
    expect(alpha.parentId).toBe(parent.id);
    expect(alpha.forkedFrom).toBe(parent.id);
    expect(beta.parentId).toBe(parent.id);
    expect(beta.forkedFrom).toBe(parent.id);
    expectRecursivelyFrozen(alpha);
    expectRecursivelyFrozen(beta);
  });

  test("replays only the exact expected Selection projection and parent", () => {
    // Break caught: accepting a rehashed commit whose payload drifted from expected authority.
    const input = selectionCreateInput("alpha");
    const selection = manualSelectionSnapshot(input);
    const projection = branchProjectionFor(selection);
    const commit = manualCityBranchCommit(selection, input.preCityBranch);
    const replayed = replayCityBranchCommit(
      commit,
      projection,
      input.preCityBranch,
      INTEGRITY,
    );

    expect(replayed).toEqual(commit);
    expect(replayed).not.toBe(commit);
    expectRecursivelyFrozen(replayed);

    const fields: readonly [MutableCityBranchBindingField, unknown][] = [
      ["parentId", "pre-city-branch:other"],
      ["forkedFrom", "pre-city-branch:other"],
      ["citySelectionSnapshotId", "city-selection:other"],
      ["cityId", "beta"],
      ["countryCode", "AT"],
      ["createdAt", "2026-01-07T01:00:00.000Z"],
    ];
    for (const [field, value] of fields) {
      const candidate = structuredClone(commit);
      mutable(candidate)[field] = value;
      const payload = { ...candidate } as MutableRecord;
      delete payload.id;
      mutable(candidate).id = contentId("city-branch", payload);
      expectIntegrityMismatch(() => replayCityBranchCommit(
        candidate,
        projection,
        input.preCityBranch,
        INTEGRITY,
      ));
    }
  });

  test("requires parentId and forkedFrom to equal the Selection pre-city parent", () => {
    // Break caught: a granular constructor creating cross-root or asymmetric lineage.
    const input = selectionCreateInput();
    const selection = manualSelectionSnapshot(input);
    const projection = branchProjectionFor(selection);
    const wrongParent = manualPreCityCommit(
      preCitySource(),
      "2026-01-01T13:00:00.000Z",
    );
    const wrongProjection = structuredClone(projection);
    mutable(wrongProjection).preCityBranchCommitId = wrongParent.id;

    expectIntegrityMismatch(() => createCityBranchCommit(
      projection,
      wrongParent,
      INTEGRITY,
    ));
    expectIntegrityMismatch(() => createCityBranchCommit(
      wrongProjection,
      input.preCityBranch,
      INTEGRITY,
    ));

    const wrongCountry = structuredClone(projection);
    mutable(wrongCountry).countryCode = "AT";
    expectIntegrityMismatch(() => createCityBranchCommit(
      wrongCountry,
      input.preCityBranch,
      INTEGRITY,
    ));
  });
});

describe("City Selection structural replay", () => {
  test("reconstructs an exact content-addressed Selection as fresh frozen data", () => {
    // Break caught: treating a stored Selection ID as authority or returning its aliases.
    const value = manualSelectionSnapshot();

    const replayed = reconstructCitySelectionSnapshot(value, INTEGRITY);

    expect(replayed).toEqual(value);
    expect(replayed).not.toBe(value);
    expect(replayed.unknownBasis).not.toBe(value.unknownBasis);
    expectRecursivelyFrozen(replayed);
  });

  test("rejects detached IDs, wrong schema and non-lowercase selected marker digests", () => {
    // Break caught: weak structural replay accepting invalid durable scalar authority.
    const detached = structuredClone(manualSelectionSnapshot());
    mutable(detached).cityId = "beta";
    const wrongSchema = structuredClone(manualSelectionSnapshot());
    mutable(wrongSchema).schemaVersion = "city-selection@2";
    rehashSelectionSnapshot(wrongSchema);
    const uppercaseDigest = structuredClone(manualSelectionSnapshot());
    mutable(uppercaseDigest).selectedMarkerDigest = "A".repeat(64);
    rehashSelectionSnapshot(uppercaseDigest);
    const ownUndefinedWarning = structuredClone(manualSelectionSnapshot());
    mutable(ownUndefinedWarning).warningCopyVersion = undefined;
    rehashSelectionSnapshot(ownUndefinedWarning);

    for (const candidate of [
      detached,
      wrongSchema,
      uppercaseDigest,
      ownUndefinedWarning,
    ]) {
      expectIntegrityMismatch(() => reconstructCitySelectionSnapshot(candidate, INTEGRITY));
    }
  });

  test("accepts a self-consistent commandId-only structural rehash", () => {
    // Break caught: the structural primitive overclaiming Task 15 command-envelope authority.
    const changed = structuredClone(manualSelectionSnapshot());
    mutable(changed).commandId = "command:select-alpha-retry";
    rehashSelectionSnapshot(changed);

    const replayed = reconstructCitySelectionSnapshot(changed, INTEGRITY);

    expect(replayed).toEqual(changed);
    expectRecursivelyFrozen(replayed);
  });
});

describe("authoritative City Selection with sibling Branch", () => {
  test("creates complete green and yellow Selection/Branch pairs from verified authority", () => {
    // Break caught: trusting caller durable fields, dropping warning basis, or losing parent lineage.
    const greenInput = selectionCreateInput("alpha");
    const yellowInput = selectionCreateInput("beta");

    const green = createCitySelectionWithBranch(greenInput, INTEGRITY);
    const yellow = createCitySelectionWithBranch(yellowInput, INTEGRITY);

    expect(green).toEqual(manualSelectionWithBranch(greenInput));
    expect(yellow).toEqual(manualSelectionWithBranch(yellowInput));
    expect(green.selection).not.toBe(greenInput.selection);
    expect(yellow.selection.unknownBasis).toEqual(yellowInput.selection.entry.unknownBasis);
    expect(green.selection.warningCopyVersion).toBeUndefined();
    expect(yellow.selection.warningCopyVersion).toBe("city-unknown-risk@1");
    expect(green.selection.selectedMarkerDigest).toBe(
      neutralHash(greenInput.terminal.markers[0]),
    );
    expect(yellow.selection.selectedMarkerDigest).toBe(
      neutralHash(yellowInput.terminal.markers[1]),
    );
    expect(green.selection.preCityBranchCommitId).toBe(greenInput.preCityBranch.id);
    expect(green.commit.parentId).toBe(greenInput.preCityBranch.id);
    expect(green.commit.forkedFrom).toBe(greenInput.preCityBranch.id);
    expectRecursivelyFrozen(green);
    expectRecursivelyFrozen(yellow);
  });

  test("creates A/B siblings with one parent and distinct Selection/Branch identities", () => {
    // Break caught: selecting B mutating/replacing A or creating a second pre-city root.
    const alphaInput = selectionCreateInput("alpha");
    const betaInput: CreateCitySelectionWithBranchInput = {
      ...alphaInput,
      commandId: "command:select-beta",
      selection: selectionProjectionFor(
        alphaInput.terminal.markers[1],
        "city-unknown-risk@1",
      ),
    };

    const alpha = createCitySelectionWithBranch(alphaInput, INTEGRITY);
    const beta = createCitySelectionWithBranch(betaInput, INTEGRITY);

    expect(alpha.selection.id).not.toBe(beta.selection.id);
    expect(alpha.commit.id).not.toBe(beta.commit.id);
    expect(alpha.commit.parentId).toBe(beta.commit.parentId);
    expect(alpha.commit.forkedFrom).toBe(beta.commit.forkedFrom);
    expect(alpha.commit.parentId).toBe(alphaInput.preCityBranch.id);
  });

  test("requires the exact marker entry, warning token and ordered reviewed-link occurrences", () => {
    // Break caught: selecting from a stale Task 11 projection or deduplicating reviewed evidence.
    const greenWithWarning = selectionCreateInput("alpha");
    mutable(greenWithWarning.selection).warningCopyVersion = "city-unknown-risk@1";
    const yellowWithoutWarning = selectionCreateInput("beta");
    delete mutable(yellowWithoutWarning.selection).warningCopyVersion;
    const yellowBasisTamper = selectionCreateInput("beta");
    mutable(yellowBasisTamper.selection.entry).unknownBasis = [];
    const removedDuplicate = selectionCreateInput("alpha");
    (removedDuplicate.selection.reviewedSourceLinks as unknown as MutableRecord[]).pop();
    const reordered = selectionCreateInput("alpha");
    const links = reordered.selection.reviewedSourceLinks as unknown as MutableRecord[];
    [links[0], links[1]] = [links[1], links[0]];

    for (const input of [
      greenWithWarning,
      yellowWithoutWarning,
      yellowBasisTamper,
      removedDuplicate,
      reordered,
    ]) {
      expectIntegrityMismatch(() => createCitySelectionWithBranch(input, INTEGRITY));
    }
  });

  test("rejects a self-consistent fake selected digest while the complete marker is unchanged", () => {
    // Break caught: trusting a syntactically valid digest copied through terminal/projection content IDs.
    const input = selectionCreateInput("alpha");
    const fakeDigest = "d".repeat(64);
    mutable(input.terminal.entries[0]).markerDigest = fakeDigest;
    rehashFrontierRevision(input.terminal);
    mutable(input.selection.entry).markerDigest = fakeDigest;

    expectIntegrityMismatch(() => createCitySelectionWithBranch(input, INTEGRITY));
  });

  test("rejects wrong terminal/ranking/pre-city mirrors even when affected IDs are rehashed", () => {
    // Break caught: a self-consistent content graph replacing verified cross-artifact authority.
    const wrongRun = selectionCreateInput();
    mutable(wrongRun.terminal).runId = "city-frontier:other-run";
    rehashFrontierRevision(wrongRun.terminal);
    const wrongRankingReference = selectionCreateInput();
    mutable(wrongRankingReference.terminal).rankingSnapshotId = "city-ranking:other";
    rehashFrontierRevision(wrongRankingReference.terminal);
    const wrongParent = selectionCreateInput();
    const changedParent = manualPreCityCommit(
      preCitySource(),
      "2026-01-01T13:00:00.000Z",
    );
    mutable(wrongParent).preCityBranch = changedParent;
    const contextDrifts: CreateCitySelectionWithBranchInput[] = [];
    for (const [field, value] of [
      ["profileSnapshotId", "profile:other"],
      ["preferenceProfileSnapshotId", "preferences:other"],
      ["resolvedCountryShortlistRevisionId", "country-resolution:other"],
      ["countryCode", "AT"],
    ] as const) {
      const drift = selectionCreateInput();
      mutable(drift.ranking)[field] = value;
      if (field === "countryCode") {
        mutable(drift.ranking.installedPackageContext).countryCode = value;
      }
      const rankingPayloadValue = { ...drift.ranking } as MutableRecord;
      delete rankingPayloadValue.id;
      mutable(drift.ranking).id = contentId("city-ranking", rankingPayloadValue);
      mutable(drift.terminal).rankingSnapshotId = drift.ranking.id;
      rehashFrontierRevision(drift.terminal);
      contextDrifts.push(drift);
    }

    for (const input of [
      wrongRun,
      wrongRankingReference,
      wrongParent,
      ...contextDrifts,
    ]) {
      expectIntegrityMismatch(() => createCitySelectionWithBranch(input, INTEGRITY));
    }
  });

  test("reconstructs exact green/yellow pairs as fresh recursively frozen values", () => {
    // Break caught: load replay trusting stored pair aliases or skipping full authority derivation.
    for (const cityId of ["alpha", "beta"] as const) {
      const input = selectionCreateInput(cityId);
      const value = manualSelectionWithBranch(input);
      const authority: CitySelectionAuthority = {
        terminal: input.terminal,
        ranking: input.ranking,
        preCityBranch: input.preCityBranch,
      };

      const replayed = reconstructCitySelectionWithBranch(value, authority, INTEGRITY);

      expect(replayed).toEqual(value);
      expect(replayed).not.toBe(value);
      expect(replayed.selection).not.toBe(value.selection);
      expect(replayed.commit).not.toBe(value.commit);
      expectRecursivelyFrozen(replayed);
    }
  });

  test("rejects a coherently rehashed fake digest across authority, Selection and Branch", () => {
    // Break caught: wrapper replay trusting cross-artifact agreement instead of the unchanged marker.
    const input = selectionCreateInput("alpha");
    const fakeDigest = "d".repeat(64);
    const forgedTerminal = structuredClone(input.terminal);
    mutable(forgedTerminal.entries[0]).markerDigest = fakeDigest;
    rehashFrontierRevision(forgedTerminal);

    const value = structuredClone(manualSelectionWithBranch(input));
    mutable(value.selection).terminalRevisionId = forgedTerminal.id;
    mutable(value.selection).selectedMarkerDigest = fakeDigest;
    rehashSelectionSnapshot(value.selection);
    mutable(value.commit).citySelectionSnapshotId = value.selection.id;
    rehashCityBranch(value.commit);
    const forgedAuthority: CitySelectionAuthority = {
      terminal: forgedTerminal,
      ranking: input.ranking,
      preCityBranch: input.preCityBranch,
    };

    expectIntegrityMismatch(() => reconstructCitySelectionWithBranch(
      value,
      forgedAuthority,
      INTEGRITY,
    ));
  });

  test("rejects every wrong durable Selection binding after consistent pair rehash", () => {
    // Break caught: pair-internal consistency substituting for terminal/ranking/pre-city authority.
    const input = selectionCreateInput("alpha");
    const authority: CitySelectionAuthority = {
      terminal: input.terminal,
      ranking: input.ranking,
      preCityBranch: input.preCityBranch,
    };
    const mutations: readonly [string, (selection: MutableRecord) => void][] = [
      ["run", (selection) => { selection.runId = "city-frontier:other"; }],
      ["terminal", (selection) => { selection.terminalRevisionId = "frontier:other"; }],
      ["city", (selection) => { selection.cityId = "beta"; }],
      ["country", (selection) => { selection.countryCode = "AT"; }],
      ["profile", (selection) => { selection.profileSnapshotId = "profile:other"; }],
      ["preference", (selection) => {
        selection.preferenceProfileSnapshotId = "preferences:other";
      }],
      ["resolved country", (selection) => {
        selection.resolvedCountryShortlistRevisionId = "country-resolution:other";
      }],
      ["criteria", (selection) => { selection.criteriaSnapshotId = "criteria:other"; }],
      ["ranking", (selection) => { selection.rankingSnapshotId = "ranking:other"; }],
      ["pre-city", (selection) => {
        selection.preCityBranchCommitId = "pre-city-branch:other";
      }],
      ["marker digest", (selection) => {
        selection.selectedMarkerDigest = "d".repeat(64);
      }],
      ["Knowledge", (selection) => {
        selection.knowledgeRevisionId = "knowledge:other";
      }],
      ["Evidence", (selection) => {
        selection.evidenceSnapshotId = "city-evidence:other";
      }],
      ["unknown basis", (selection) => {
        selection.unknownBasis = [{
          criterionId: "fixed_broadband",
          definitionId: "fixed_broadband@1",
          reason: "not_found",
        }];
      }],
      ["warning", (selection) => {
        selection.warningCopyVersion = "city-unknown-risk@1";
      }],
    ];

    for (const [label, mutateSelection] of mutations) {
      const candidate = structuredClone(manualSelectionWithBranch(input));
      mutateSelection(mutable(candidate.selection));
      rehashSelectionSnapshot(candidate.selection);
      mutable(candidate.commit).citySelectionSnapshotId = candidate.selection.id;
      rehashCityBranch(candidate.commit);
      expect(
        () => reconstructCitySelectionWithBranch(candidate, authority, INTEGRITY),
        label,
      ).toThrowError("integrity_mismatch");
    }
  });

  test("rejects wrong Branch bindings and a forged source-bound parent pair", () => {
    // Break caught: replay validating Selection and Branch independently without their lineage equations.
    const input = selectionCreateInput();
    const authority: CitySelectionAuthority = {
      terminal: input.terminal,
      ranking: input.ranking,
      preCityBranch: input.preCityBranch,
    };
    const wrongCommitFields: readonly [MutableCityBranchBindingField, unknown][] = [
      ["parentId", "pre-city-branch:other"],
      ["forkedFrom", "pre-city-branch:other"],
      ["citySelectionSnapshotId", "city-selection:other"],
      ["cityId", "beta"],
      ["countryCode", "AT"],
      ["createdAt", "2026-01-07T01:00:00.000Z"],
    ];
    for (const [field, value] of wrongCommitFields) {
      const candidate = structuredClone(manualSelectionWithBranch(input));
      mutable(candidate.commit)[field] = value;
      rehashCityBranch(candidate.commit);
      expectIntegrityMismatch(() =>
        reconstructCitySelectionWithBranch(candidate, authority, INTEGRITY));
    }

    const forgedParent = manualPreCityCommit(
      { ...preCitySource(), profileSnapshotId: "profile:forged" },
    );
    const forged = structuredClone(manualSelectionWithBranch(input));
    mutable(forged.selection).preCityBranchCommitId = forgedParent.id;
    rehashSelectionSnapshot(forged.selection);
    mutable(forged.commit).citySelectionSnapshotId = forged.selection.id;
    mutable(forged.commit).parentId = forgedParent.id;
    mutable(forged.commit).forkedFrom = forgedParent.id;
    rehashCityBranch(forged.commit);
    expectIntegrityMismatch(() =>
      reconstructCitySelectionWithBranch(forged, authority, INTEGRITY));
  });

  test("accepts a consistently rederived commandId-only pair change", () => {
    // Break caught: wrapper replay overclaiming Task 15 idempotency-envelope authority.
    const input = selectionCreateInput();
    const authority: CitySelectionAuthority = {
      terminal: input.terminal,
      ranking: input.ranking,
      preCityBranch: input.preCityBranch,
    };
    const changed = structuredClone(manualSelectionWithBranch(input));
    mutable(changed.selection).commandId = "command:select-alpha-retry";
    rehashSelectionSnapshot(changed.selection);
    mutable(changed.commit).citySelectionSnapshotId = changed.selection.id;
    rehashCityBranch(changed.commit);

    const replayed = reconstructCitySelectionWithBranch(changed, authority, INTEGRITY);

    expect(replayed).toEqual(changed);
    expectRecursivelyFrozen(replayed);
  });

  test("accepts a consistently rederived Selection/Branch createdAt change", () => {
    // Break caught: wrapper claiming a clock authority beyond exact pair equality.
    const input = selectionCreateInput();
    const authority: CitySelectionAuthority = {
      terminal: input.terminal,
      ranking: input.ranking,
      preCityBranch: input.preCityBranch,
    };
    const changed = structuredClone(manualSelectionWithBranch(input));
    mutable(changed.selection).createdAt = "2026-01-07T01:00:00.000Z";
    rehashSelectionSnapshot(changed.selection);
    mutable(changed.commit).citySelectionSnapshotId = changed.selection.id;
    mutable(changed.commit).createdAt = changed.selection.createdAt;
    rehashCityBranch(changed.commit);

    expect(reconstructCitySelectionWithBranch(changed, authority, INTEGRITY))
      .toEqual(changed);
  });
});

describe("Task 12 structural decoder composition", () => {
  test("semantic/source/Branch replay reject correct-prefix forged content IDs", () => {
    // Break caught: a semantic or source wrapper skipping its required structural decoder.
    let evaluatorCalls = 0;
    const evaluators = makeEvaluators(
      () => { evaluatorCalls += 1; },
      () => { evaluatorCalls += 1; },
    );
    const ranking = structuredClone(manualRankingSnapshot());
    mutable(ranking).id = `city-ranking:${"f".repeat(64)}`;
    const observation = integrityObserver(undefined, INTEGRITY);

    expectIntegrityMismatch(() => verifyCityRankingSnapshotSemantics(
      ranking,
      semanticInputs(evaluators),
      observation.integrity,
    ));
    expect(evaluatorCalls).toBe(0);
    expectIntegrityCallbackReceivers(observation.receivers);

    const preCity = structuredClone(manualPreCityCommit());
    mutable(preCity).id = `pre-city-branch:${"f".repeat(64)}`;
    expectIntegrityMismatch(() => replayPreCityBranchCommit(
      preCity,
      preCitySource(),
      INTEGRITY,
    ));

    const branch = branchValueFixture();
    mutable(branch.commit).id = `city-branch:${"f".repeat(64)}`;
    expectIntegrityMismatch(() => replayCityBranchCommit(
      branch.commit,
      branch.projection,
      branch.parent,
      INTEGRITY,
    ));
  });

  test("replay rejects rehashed values outside every closed schema/policy literal", () => {
    // Break caught: content integrity reopening a frozen durable discriminant or policy literal.
    let integrityCalls = 0;
    const integrity: CityDecisionIntegrity = {
      canonical() { integrityCalls += 1; return "never"; },
      hash() { integrityCalls += 1; return "0".repeat(64); },
    };
    const ranking = structuredClone(manualRankingSnapshot());
    mutable(ranking).schemaVersion = "city-ranking@2";
    rehashRankingSnapshot(ranking);

    const preCity = structuredClone(manualPreCityCommit());
    mutable(preCity).schemaVersion = "pre-city-branch@2";
    rehashPreCityBranch(preCity);

    const branch = branchValueFixture();
    mutable(branch.commit).schemaVersion = "city-branch@2";
    rehashCityBranch(branch.commit);

    const frontierSchema = structuredClone(rootFrontierRevision());
    mutable(frontierSchema).schemaVersion = "city-frontier@2";
    rehashFrontierRevision(frontierSchema);
    const workingPhase = structuredClone(rootFrontierRevision());
    mutable(workingPhase).phase = "other";
    rehashFrontierRevision(workingPhase);
    const terminalStop = structuredClone(terminalFrontierRevision());
    mutable(terminalStop).stopCondition = "other";
    rehashFrontierRevision(terminalStop);

    const selectionSchema = structuredClone(manualSelectionSnapshot());
    mutable(selectionSchema).schemaVersion = "city-selection@2";
    rehashSelectionSnapshot(selectionSchema);
    const selectionWarning = structuredClone(manualSelectionSnapshot());
    mutable(selectionWarning).warningCopyVersion = "city-unknown-risk@2";
    rehashSelectionSnapshot(selectionWarning);

    const actions: readonly [string, () => unknown][] = [
      ["ranking schema", () => reconstructCityRankingSnapshot(ranking, integrity)],
      ["pre-city schema", () => reconstructPreCityBranchCommit(preCity, integrity)],
      ["city-branch schema", () => replayCityBranchCommit(
        branch.commit,
        branch.projection,
        branch.parent,
        integrity,
      )],
      ["frontier schema", () => reconstructCityFrontierRevision(
        frontierSchema,
        integrity,
      )],
      ["working phase", () => reconstructCityFrontierRevision(
        workingPhase,
        integrity,
      )],
      ["terminal stop", () => reconstructCityFrontierRevision(
        terminalStop,
        integrity,
      )],
      ["selection schema", () => reconstructCitySelectionSnapshot(
        selectionSchema,
        integrity,
      )],
      ["selection warning", () => reconstructCitySelectionSnapshot(
        selectionWarning,
        integrity,
      )],
    ];
    for (const [label, action] of actions) {
      expectFreshIntegrityMismatch(action, label);
    }
    expect(integrityCalls).toBe(0);
  });
});

describe("Task 12 canonical scalar gates", () => {
  test("replay rejects rehashed invalid rules/text/country/time scalars before C/H", () => {
    // Break caught: validating constructor scalars but trusting the same malformed stored payload.
    let integrityCalls = 0;
    const integrity: CityDecisionIntegrity = {
      canonical() { integrityCalls += 1; return "never"; },
      hash() { integrityCalls += 1; return "0".repeat(64); },
    };

    const rankingRules = structuredClone(manualRankingSnapshot());
    mutable(rankingRules).rulesVersion = "city-ranker@2";
    rehashRankingSnapshot(rankingRules);
    const rankingBudget = structuredClone(manualRankingSnapshot());
    mutable(rankingBudget.verificationBudget).targetSelectableCities = 2;
    rehashRankingSnapshot(rankingBudget);

    const frontierBlank = structuredClone(rootFrontierRevision());
    mutable(frontierBlank).runId = "";
    rehashFrontierRevision(frontierBlank);
    const frontierControl = structuredClone(rootFrontierRevision());
    mutable(frontierControl.operation).commandId = "command:\nstart";
    rehashFrontierRevision(frontierControl);
    const frontierTime = structuredClone(rootFrontierRevision());
    mutable(frontierTime).createdAt = "2026-01-03T00:00:00Z";
    rehashFrontierRevision(frontierTime);

    const preCityCountry = structuredClone(manualPreCityCommit());
    mutable(preCityCountry).countryCode = "si";
    rehashPreCityBranch(preCityCountry);
    const preCityDigest = structuredClone(manualPreCityCommit());
    mutable(preCityDigest).resolvedCountryEntryDigest = "g".repeat(64);
    rehashPreCityBranch(preCityDigest);
    const preCityTime = structuredClone(manualPreCityCommit());
    mutable(preCityTime).createdAt = "2026-01-01T12:00:00Z";
    rehashPreCityBranch(preCityTime);

    const branchSchema = branchValueFixture();
    mutable(branchSchema.commit).schemaVersion = "city-branch@2";
    rehashCityBranch(branchSchema.commit);
    const branchTime = branchValueFixture();
    mutable(branchTime.commit).createdAt = "2026-01-07T00:00:00Z";
    mutable(branchTime.projection).createdAt = "2026-01-07T00:00:00Z";
    rehashCityBranch(branchTime.commit);

    const actions: readonly [string, () => unknown][] = [
      ["ranking rules", () => reconstructCityRankingSnapshot(rankingRules, integrity)],
      ["ranking budget", () => reconstructCityRankingSnapshot(rankingBudget, integrity)],
      ["frontier blank", () => reconstructCityFrontierRevision(frontierBlank, integrity)],
      ["frontier control", () => reconstructCityFrontierRevision(frontierControl, integrity)],
      ["frontier time", () => reconstructCityFrontierRevision(frontierTime, integrity)],
      ["pre-city country", () => reconstructPreCityBranchCommit(preCityCountry, integrity)],
      ["pre-city digest", () => reconstructPreCityBranchCommit(preCityDigest, integrity)],
      ["pre-city time", () => reconstructPreCityBranchCommit(preCityTime, integrity)],
      ["city-branch schema", () => replayCityBranchCommit(
        branchSchema.commit,
        branchSchema.projection,
        branchSchema.parent,
        integrity,
      )],
      ["city-branch time", () => replayCityBranchCommit(
        branchTime.commit,
        branchTime.projection,
        branchTime.parent,
        integrity,
      )],
    ];
    for (const [label, action] of actions) {
      expectFreshIntegrityMismatch(action, label);
    }
    expect(integrityCalls).toBe(0);
  });

  test("rejects malformed Ranking constructor scalars before integrity execution", () => {
    // Break caught: hashing a malformed Ranking payload before exact ID/time scalar validation.
    let integrityCalls = 0;
    const integrity: CityDecisionIntegrity = {
      canonical() { integrityCalls += 1; return "never"; },
      hash() { integrityCalls += 1; return "0".repeat(64); },
    };
    const blankRun = rankingPayload();
    mutable(blankRun).runId = "";
    const noncanonicalAssessment = rankingPayload();
    mutable(noncanonicalAssessment).assessmentAt = "2026-01-02T00:00:00Z";
    const noncanonicalCreated = rankingPayload();
    mutable(noncanonicalCreated).createdAt = "2026-01-03T00:00:00Z";

    for (const payload of [blankRun, noncanonicalAssessment, noncanonicalCreated]) {
      expectIntegrityMismatch(() => sealCityRankingSnapshot(payload, integrity));
    }
    expect(integrityCalls).toBe(0);
  });

  test("rejects invalid marker/entry digest inputs before integrity execution", () => {
    // Break caught: hashing invalid direct inputs or terminal digests before scalar validation.
    let integrityCalls = 0;
    const integrity: CityDecisionIntegrity = {
      canonical() { integrityCalls += 1; return "never"; },
      hash() { integrityCalls += 1; return "0".repeat(64); },
    };
    const invalidMarker = greenMarker();
    mutable(invalidMarker).rank = 0;
    const invalidResolvedEntry = resolvedCountryEntry();
    mutable(invalidResolvedEntry).formalMarkerDigest = "g".repeat(64);
    const invalidTerminalDigest = structuredClone(terminalFrontierRevision());
    mutable(invalidTerminalDigest.entries[0]).markerDigest = "g".repeat(64);
    rehashFrontierRevision(invalidTerminalDigest);

    expectIntegrityMismatch(() => cityLiveMarkerDigest(invalidMarker, integrity));
    expectIntegrityMismatch(() =>
      resolvedCountryEntryDigest(invalidResolvedEntry, integrity));
    expectIntegrityMismatch(() =>
      reconstructCityFrontierRevision(invalidTerminalDigest, integrity));
    expect(integrityCalls).toBe(0);
  });

  test("rejects frontier ID/text/time/prefix scalars before integrity execution", () => {
    // Break caught: hashing a malformed operation/root and treating its digest as validation.
    let integrityCalls = 0;
    const integrity: CityDecisionIntegrity = {
      canonical() { integrityCalls += 1; return "never"; },
      hash() { integrityCalls += 1; return "0".repeat(64); },
    };
    const blankRun = startFrontierInput();
    mutable(blankRun).runId = "";
    const controlCommand = startFrontierInput();
    mutable(controlCommand.operation).commandId = "command:\nstart";
    const noncanonicalTime = startFrontierInput();
    mutable(noncanonicalTime).createdAt = "2026-01-03T00:00:00Z";
    const lowercaseNonhexCriteriaHash = startFrontierInput();
    mutable(lowercaseNonhexCriteriaHash.operation).criteriaPayloadHash = "g".repeat(64);
    const wrongPrefix = structuredClone(rootFrontierRevision());
    mutable(wrongPrefix).id = wrongPrefix.id.replace(
      "city-frontier-revision:",
      "frontier-revision:",
    );
    const cases: readonly (() => unknown)[] = [
      () => sealCityFrontierRevision(blankRun, integrity),
      () => sealCityFrontierRevision(controlCommand, integrity),
      () => sealCityFrontierRevision(noncanonicalTime, integrity),
      () => sealCityFrontierRevision(lowercaseNonhexCriteriaHash, integrity),
      () => reconstructCityFrontierRevision(wrongPrefix, integrity),
    ];

    for (const action of cases) expectIntegrityMismatch(action);
    expect(integrityCalls).toBe(0);
  });

  test("rejects branch ID/text/country/time/prefix scalars before integrity execution", () => {
    // Break caught: deriving pre-city/city-branch IDs from malformed source or Selection scalars.
    let integrityCalls = 0;
    const integrity: CityDecisionIntegrity = {
      canonical() { integrityCalls += 1; return "never"; },
      hash() { integrityCalls += 1; return "0".repeat(64); },
    };
    const blankProfile = preCityInput();
    mutable(blankProfile.source).profileSnapshotId = " ";
    const lowercaseCountry = preCityInput();
    mutable(lowercaseCountry.source.resolvedCountryEntry).countryCode = "si";
    const lowercaseNonhexSourceDigest = preCityInput();
    mutable(lowercaseNonhexSourceDigest.source.resolvedCountryEntry)
      .formalMarkerDigest = "g".repeat(64);
    const noncanonicalPreCityTime = preCityInput();
    mutable(noncanonicalPreCityTime).createdAt = "2026-01-01T12:00:00Z";
    const wrongPreCityPrefix = structuredClone(manualPreCityCommit());
    mutable(wrongPreCityPrefix).id = wrongPreCityPrefix.id.replace(
      "pre-city-branch:",
      "branch-root:",
    );
    const lowercaseNonhexStoredDigest = structuredClone(manualPreCityCommit());
    mutable(lowercaseNonhexStoredDigest).resolvedCountryEntryDigest = "g".repeat(64);
    rehashPreCityBranch(lowercaseNonhexStoredDigest);
    const blankSelectionId = branchValueFixture();
    mutable(blankSelectionId.projection).citySelectionSnapshotId = "";
    const controlCity = branchValueFixture();
    mutable(controlCity.projection).cityId = "alpha\n";
    const noncanonicalBranchTime = branchValueFixture();
    mutable(noncanonicalBranchTime.projection).createdAt = "2026-01-07T00:00:00Z";
    const wrongBranchPrefix = branchValueFixture();
    mutable(wrongBranchPrefix.commit).id = wrongBranchPrefix.commit.id.replace(
      "city-branch:",
      "branch:",
    );
    const cases: readonly (() => unknown)[] = [
      () => createPreCityBranchCommit(blankProfile, integrity),
      () => createPreCityBranchCommit(lowercaseCountry, integrity),
      () => createPreCityBranchCommit(lowercaseNonhexSourceDigest, integrity),
      () => createPreCityBranchCommit(noncanonicalPreCityTime, integrity),
      () => reconstructPreCityBranchCommit(wrongPreCityPrefix, integrity),
      () => replayPreCityBranchCommit(
        lowercaseNonhexStoredDigest,
        preCitySource(),
        integrity,
      ),
      () => createCityBranchCommit(
        blankSelectionId.projection,
        blankSelectionId.parent,
        integrity,
      ),
      () => createCityBranchCommit(
        controlCity.projection,
        controlCity.parent,
        integrity,
      ),
      () => createCityBranchCommit(
        noncanonicalBranchTime.projection,
        noncanonicalBranchTime.parent,
        integrity,
      ),
      () => replayCityBranchCommit(
        wrongBranchPrefix.commit,
        wrongBranchPrefix.projection,
        wrongBranchPrefix.parent,
        integrity,
      ),
    ];

    for (const action of cases) expectIntegrityMismatch(action);
    expect(integrityCalls).toBe(0);
  });

  test("rejects Selection ID/text/country/time/prefix scalars before integrity execution", () => {
    // Break caught: content-rehashing malformed durable Selection strings into apparent authority.
    let integrityCalls = 0;
    const integrity: CityDecisionIntegrity = {
      canonical() { integrityCalls += 1; return "never"; },
      hash() { integrityCalls += 1; return "0".repeat(64); },
    };
    const blankCommand = structuredClone(manualSelectionSnapshot());
    mutable(blankCommand).commandId = "";
    rehashSelectionSnapshot(blankCommand);
    const controlCity = structuredClone(manualSelectionSnapshot());
    mutable(controlCity).cityId = "alpha\n";
    rehashSelectionSnapshot(controlCity);
    const lowercaseCountry = structuredClone(manualSelectionSnapshot());
    mutable(lowercaseCountry).countryCode = "si";
    rehashSelectionSnapshot(lowercaseCountry);
    const noncanonicalTime = structuredClone(manualSelectionSnapshot());
    mutable(noncanonicalTime).createdAt = "2026-01-07T00:00:00Z";
    rehashSelectionSnapshot(noncanonicalTime);
    const lowercaseNonhexDigest = structuredClone(manualSelectionSnapshot());
    mutable(lowercaseNonhexDigest).selectedMarkerDigest = "g".repeat(64);
    rehashSelectionSnapshot(lowercaseNonhexDigest);
    const wrongPrefix = structuredClone(manualSelectionSnapshot());
    mutable(wrongPrefix).id = wrongPrefix.id.replace(
      "city-selection:",
      "selection:",
    );

    for (const candidate of [
      blankCommand,
      controlCity,
      lowercaseCountry,
      noncanonicalTime,
      lowercaseNonhexDigest,
      wrongPrefix,
    ]) {
      expectIntegrityMismatch(() => reconstructCitySelectionSnapshot(candidate, integrity));
    }
    expect(integrityCalls).toBe(0);
  });

  test("rejects malformed Selection wrapper constructor scalars before integrity execution", () => {
    // Break caught: deriving Selection/Branch IDs before validating caller command/time scalars.
    let integrityCalls = 0;
    const integrity: CityDecisionIntegrity = {
      canonical() { integrityCalls += 1; return "never"; },
      hash() { integrityCalls += 1; return "0".repeat(64); },
    };
    const blankCommand = selectionCreateInput();
    mutable(blankCommand).commandId = "";
    const controlCommand = selectionCreateInput();
    mutable(controlCommand).commandId = "command:\nselect";
    const noncanonicalTime = selectionCreateInput();
    mutable(noncanonicalTime).createdAt = "2026-01-07T00:00:00Z";
    const lowercasePreCity = selectionCreateInput();
    mutable(lowercasePreCity.preCityBranch).countryCode = "si";
    const lowercaseCommit = selectionPairFixture();
    mutable(lowercaseCommit.value.commit).countryCode = "si";
    const lowercaseAuthorityPreCity = selectionPairFixture();
    mutable(lowercaseAuthorityPreCity.authority.preCityBranch).countryCode = "si";

    for (const input of [blankCommand, controlCommand, noncanonicalTime]) {
      expectIntegrityMismatch(() => createCitySelectionWithBranch(input, integrity));
    }
    expectFreshIntegrityMismatch(
      () => createCitySelectionWithBranch(lowercasePreCity, integrity),
      "create pre-city country",
    );
    expectFreshIntegrityMismatch(
      () => reconstructCitySelectionWithBranch(
        lowercaseCommit.value,
        lowercaseCommit.authority,
        integrity,
      ),
      "replay commit country",
    );
    expectFreshIntegrityMismatch(
      () => reconstructCitySelectionWithBranch(
        lowercaseAuthorityPreCity.value,
        lowercaseAuthorityPreCity.authority,
        integrity,
      ),
      "replay authority pre-city country",
    );
    expect(integrityCalls).toBe(0);
  });
});

describe("Task 12 own-data and callback boundary contract", () => {
  test("rejects one representative hostile primary graph at every boundary before C/H", () => {
    // Break caught: a newly added seal/reconstruct/replay path copying before descriptor ownership.
    let callbackCalls = 0;
    let accessorReads = 0;
    const integrity: CityDecisionIntegrity = {
      canonical() { callbackCalls += 1; return "never"; },
      hash() { callbackCalls += 1; return "0".repeat(64); },
    };
    const cases = task12BoundaryCases();

    expect(new Set(cases.map(({ family }) => family))).toEqual(new Set([
      "marker", "ranking", "frontier", "pre-city", "branch", "selection",
    ]));
    for (const [index, boundary] of cases.entries()) {
      let candidate = boundary.makePrimary();
      switch (index % 4) {
        case 0:
          Object.defineProperty(candidate, "unexpected", {
            enumerable: true,
            get() { accessorReads += 1; return "attacker"; },
          });
          break;
        case 1:
          Object.defineProperty(candidate, Symbol("attacker"), {
            enumerable: true,
            value: "attacker",
          });
          break;
        case 2:
          Object.setPrototypeOf(candidate, { inherited: "attacker" });
          break;
        case 3:
          candidate = new Proxy(candidate, {});
          break;
      }

      const first = captureThrown(() => boundary.invoke(candidate, integrity));
      const second = captureThrown(() => boundary.invoke(candidate, integrity));
      expect(first, boundary.name).not.toBe(second);
      expect(first, boundary.name).toBeInstanceOf(Error);
      expect(second, boundary.name).toBeInstanceOf(Error);
      expect((first as Error).message, boundary.name).toBe("integrity_mismatch");
      expect((second as Error).message, boundary.name).toBe("integrity_mismatch");
    }
    expect(accessorReads).toBe(0);
    expect(callbackCalls).toBe(0);
  });

  test("rejects a plain enumerable extra key at every boundary before C/H", () => {
    // Break caught: rejecting reflective hazards but silently dropping ordinary extra authority.
    let callbackCalls = 0;
    const integrity: CityDecisionIntegrity = {
      canonical() { callbackCalls += 1; return "never"; },
      hash() { callbackCalls += 1; return "0".repeat(64); },
    };

    for (const boundary of task12BoundaryCases()) {
      const candidate = boundary.makePrimary();
      mutable(candidate).unexpected = true;
      const first = captureThrown(() => boundary.invoke(candidate, integrity));
      const second = captureThrown(() => boundary.invoke(candidate, integrity));

      expect(first, boundary.name).not.toBe(second);
      expect(first, boundary.name).toBeInstanceOf(Error);
      expect(second, boundary.name).toBeInstanceOf(Error);
      expect((first as Error).message, boundary.name).toBe("integrity_mismatch");
      expect((second as Error).message, boundary.name).toBe("integrity_mismatch");
    }
    expect(callbackCalls).toBe(0);
  });

  test("rejects missing, undefined and hidden primary keys before C/H", () => {
    // Break caught: treating absence/undefined or non-enumerable authority as ordinary closed data.
    let callbackCalls = 0;
    let accessorReads = 0;
    const integrity: CityDecisionIntegrity = {
      canonical() { callbackCalls += 1; return "never"; },
      hash() { callbackCalls += 1; return "0".repeat(64); },
    };

    for (const boundary of task12BoundaryCases()) {
      for (const mode of [
        "missing",
        "own undefined",
        "hidden data",
        "hidden accessor",
      ] as const) {
        const candidate = boundary.makePrimary();
        const requiredKey = Reflect.ownKeys(candidate)[0];
        expect(requiredKey).toBeDefined();
        if (requiredKey === undefined) throw new Error("test_expected_required_key");
        if (mode === "missing") {
          Reflect.deleteProperty(candidate, requiredKey);
        } else if (mode === "own undefined") {
          Reflect.set(candidate, requiredKey, undefined);
        } else if (mode === "hidden data") {
          Object.defineProperty(candidate, "unexpected", {
            enumerable: false,
            value: true,
          });
        } else {
          Object.defineProperty(candidate, "unexpected", {
            enumerable: false,
            get() { accessorReads += 1; return true; },
          });
        }
        const first = captureThrown(() => boundary.invoke(candidate, integrity));
        const second = captureThrown(() => boundary.invoke(candidate, integrity));

        expect(first, `${boundary.name}: ${mode}`).not.toBe(second);
        expect(first, `${boundary.name}: ${mode}`).toBeInstanceOf(Error);
        expect(second, `${boundary.name}: ${mode}`).toBeInstanceOf(Error);
        expect((first as Error).message, `${boundary.name}: ${mode}`)
          .toBe("integrity_mismatch");
        expect((second as Error).message, `${boundary.name}: ${mode}`)
          .toBe("integrity_mismatch");
      }
    }
    expect(accessorReads).toBe(0);
    expect(callbackCalls).toBe(0);
  });

  test("rejects hostile integrity roots at every boundary without invoking a capability", () => {
    // Break caught: reading getters, accepting a Proxy/symbol, or inheriting C/H authority.
    let callbackCalls = 0;
    let accessorReads = 0;

    for (const [index, boundary] of task12BoundaryCases().entries()) {
      const plain = {
        canonical() { callbackCalls += 1; return "never"; },
        hash() { callbackCalls += 1; return "0".repeat(64); },
      };
      let hostile: object;
      switch (index % 4) {
        case 0: {
          const accessor = { hash: plain.hash } as MutableRecord;
          Object.defineProperty(accessor, "canonical", {
            enumerable: true,
            get() { accessorReads += 1; return plain.canonical; },
          });
          hostile = accessor;
          break;
        }
        case 1:
          Object.defineProperty(plain, Symbol("attacker"), { value: true });
          hostile = plain;
          break;
        case 2:
          Object.setPrototypeOf(plain, { inherited: "attacker" });
          hostile = plain;
          break;
        default:
          hostile = new Proxy(plain, {});
      }

      const invoke = () => boundary.invoke(
          boundary.makePrimary(),
          hostile as CityDecisionIntegrity,
        );
      const first = captureThrown(invoke);
      const second = captureThrown(invoke);
      expect(first, boundary.name).not.toBe(second);
      expect(first, boundary.name).toBeInstanceOf(Error);
      expect(second, boundary.name).toBeInstanceOf(Error);
      expect((first as Error).message, boundary.name).toBe("integrity_mismatch");
      expect((second as Error).message, boundary.name).toBe("integrity_mismatch");
    }
    expect(accessorReads).toBe(0);
    expect(callbackCalls).toBe(0);
  });

  test("rejects callable-Proxy C/H functions at every boundary without traps", () => {
    // Break caught: exact integrity-root closure followed by unsafe callable Proxy invocation.
    let applyCalls = 0;
    let getReads = 0;
    const validCanonical = (value: unknown) => Reflect.apply(
      INTEGRITY.canonical,
      Object.freeze({ capability: "canonical" }),
      [value],
    );
    const validHash = (canonicalText: string) => Reflect.apply(
      INTEGRITY.hash,
      Object.freeze({ capability: "hash" }),
      [canonicalText],
    );
    const callableProxy = <T extends (...arguments_: never[]) => unknown>(target: T): T =>
      new Proxy(target, {
        apply(callable, receiver, argumentsList) {
          applyCalls += 1;
          return Reflect.apply(callable, receiver, argumentsList);
        },
        get(callable, key, receiver) {
          getReads += 1;
          return Reflect.get(callable, key, receiver);
        },
      });

    for (const boundary of task12BoundaryCases()) {
      for (const mode of ["canonical", "hash"] as const) {
        const integrity = mode === "canonical"
          ? { canonical: callableProxy(validCanonical), hash: validHash }
          : { canonical: validCanonical, hash: callableProxy(validHash) };
        expectFreshIntegrityMismatch(
          () => boundary.invoke(boundary.makePrimary(), integrity),
          `${boundary.name}: callable-Proxy ${mode}`,
        );
      }
    }
    expect(applyCalls).toBe(0);
    expect(getReads).toBe(0);
  });

  test("rejects hostile secondary authority roots before any integrity callback", () => {
    // Break caught: closing only the first argument before hashing and reflecting later authority.
    let callbackCalls = 0;
    const integrity: CityDecisionIntegrity = {
      canonical() { callbackCalls += 1; return "never"; },
      hash() { callbackCalls += 1; return "0".repeat(64); },
    };
    const branch = branchValueFixture();
    const pair = selectionPairFixture();
    const extraSemanticInputs = semanticInputs();
    mutable(extraSemanticInputs).unexpected = true;
    const extraSource = preCitySource();
    mutable(extraSource).unexpected = true;
    const extraParent = branchValueFixture();
    mutable(extraParent.parent).unexpected = true;
    const extraProjection = branchValueFixture();
    mutable(extraProjection.projection).unexpected = true;
    const extraAuthority = selectionPairFixture();
    mutable(extraAuthority.authority).unexpected = true;
    const cases: readonly [string, () => unknown][] = [
      ["semantic inputs", () => verifyCityRankingSnapshotSemantics(
        manualRankingSnapshot(),
        new Proxy(semanticInputs(), {}),
        integrity,
      )],
      ["pre-city source", () => replayPreCityBranchCommit(
        manualPreCityCommit(),
        new Proxy(preCitySource(), {}),
        integrity,
      )],
      ["city-branch parent", () => createCityBranchCommit(
        branch.projection,
        new Proxy(branch.parent, {}),
        integrity,
      )],
      ["city-branch replay projection", () => replayCityBranchCommit(
        branch.commit,
        new Proxy(branch.projection, {}),
        branch.parent,
        integrity,
      )],
      ["city-branch replay parent", () => replayCityBranchCommit(
        branch.commit,
        branch.projection,
        new Proxy(branch.parent, {}),
        integrity,
      )],
      ["selection wrapper authority", () => reconstructCitySelectionWithBranch(
        pair.value,
        new Proxy(pair.authority, {}),
        integrity,
      )],
      ["plain extra semantic inputs", () => verifyCityRankingSnapshotSemantics(
        manualRankingSnapshot(),
        extraSemanticInputs,
        integrity,
      )],
      ["plain extra pre-city source", () => replayPreCityBranchCommit(
        manualPreCityCommit(),
        extraSource,
        integrity,
      )],
      ["plain extra city-branch parent", () => createCityBranchCommit(
        extraParent.projection,
        extraParent.parent,
        integrity,
      )],
      ["plain extra city-branch projection", () => createCityBranchCommit(
        extraProjection.projection,
        extraProjection.parent,
        integrity,
      )],
      ["plain extra selection authority", () => reconstructCitySelectionWithBranch(
        extraAuthority.value,
        extraAuthority.authority,
        integrity,
      )],
    ];

    for (const [label, action] of cases) {
      const first = captureThrown(action);
      const second = captureThrown(action);
      expect(first, label).not.toBe(second);
      expect(first, label).toBeInstanceOf(Error);
      expect(second, label).toBeInstanceOf(Error);
      expect((first as Error).message, label).toBe("integrity_mismatch");
      expect((second as Error).message, label).toBe("integrity_mismatch");
    }
    expect(callbackCalls).toBe(0);
  });

  test("rejects missing, undefined and hidden secondary keys before C/H", () => {
    // Break caught: closing primary data while accepting partial/hidden secondary authority.
    interface SecondaryRequiredCase {
      readonly name: string;
      readonly make: () => {
        readonly root: object;
        readonly invoke: (integrity: CityDecisionIntegrity) => unknown;
      };
    }
    const cases: readonly SecondaryRequiredCase[] = [
      {
        name: "semantic inputs",
        make: () => {
          const root = semanticInputs();
          return {
            root,
            invoke: (integrity) => verifyCityRankingSnapshotSemantics(
              manualRankingSnapshot(),
              root,
              integrity,
            ),
          };
        },
      },
      {
        name: "pre-city source",
        make: () => {
          const root = preCitySource();
          return {
            root,
            invoke: (integrity) => replayPreCityBranchCommit(
              manualPreCityCommit(),
              root,
              integrity,
            ),
          };
        },
      },
      {
        name: "city-branch projection",
        make: () => {
          const fixture = branchValueFixture();
          return {
            root: fixture.projection,
            invoke: (integrity) => createCityBranchCommit(
              fixture.projection,
              fixture.parent,
              integrity,
            ),
          };
        },
      },
      {
        name: "city-branch parent",
        make: () => {
          const fixture = branchValueFixture();
          return {
            root: fixture.parent,
            invoke: (integrity) => createCityBranchCommit(
              fixture.projection,
              fixture.parent,
              integrity,
            ),
          };
        },
      },
      {
        name: "selection wrapper authority",
        make: () => {
          const fixture = selectionPairFixture();
          return {
            root: fixture.authority,
            invoke: (integrity) => reconstructCitySelectionWithBranch(
              fixture.value,
              fixture.authority,
              integrity,
            ),
          };
        },
      },
    ];
    let callbackCalls = 0;
    let accessorReads = 0;
    const integrity: CityDecisionIntegrity = {
      canonical() { callbackCalls += 1; return "never"; },
      hash() { callbackCalls += 1; return "0".repeat(64); },
    };

    for (const boundary of cases) {
      for (const mode of [
        "missing",
        "own undefined",
        "hidden data",
        "hidden accessor",
      ] as const) {
        const fixture = boundary.make();
        const requiredKey = Reflect.ownKeys(fixture.root)[0];
        expect(requiredKey).toBeDefined();
        if (requiredKey === undefined) throw new Error("test_expected_required_key");
        if (mode === "missing") {
          Reflect.deleteProperty(fixture.root, requiredKey);
        } else if (mode === "own undefined") {
          Reflect.set(fixture.root, requiredKey, undefined);
        } else if (mode === "hidden data") {
          Object.defineProperty(fixture.root, "unexpected", {
            enumerable: false,
            value: true,
          });
        } else {
          Object.defineProperty(fixture.root, "unexpected", {
            enumerable: false,
            get() { accessorReads += 1; return true; },
          });
        }
        const first = captureThrown(() => fixture.invoke(integrity));
        const second = captureThrown(() => fixture.invoke(integrity));

        expect(first, `${boundary.name}: ${mode}`).not.toBe(second);
        expect(first, `${boundary.name}: ${mode}`).toBeInstanceOf(Error);
        expect(second, `${boundary.name}: ${mode}`).toBeInstanceOf(Error);
        expect((first as Error).message, `${boundary.name}: ${mode}`)
          .toBe("integrity_mismatch");
        expect((second as Error).message, `${boundary.name}: ${mode}`)
          .toBe("integrity_mismatch");
      }
    }
    expect(accessorReads).toBe(0);
    expect(callbackCalls).toBe(0);
  });

  test("rejects representative nested accessors in each new family before C/H", () => {
    // Break caught: shallow-closing roots while spreading a nested marker/source/parent authority.
    let accessorReads = 0;
    let callbackCalls = 0;
    const integrity: CityDecisionIntegrity = {
      canonical() { callbackCalls += 1; return "never"; },
      hash() { callbackCalls += 1; return "0".repeat(64); },
    };
    const accessor = (value: object, key: string, result: unknown) => {
      Object.defineProperty(value, key, {
        enumerable: true,
        get() { accessorReads += 1; return result; },
      });
    };

    const frontier = terminalFrontierInput();
    if (frontier.projection.kind !== "terminal") {
      throw new Error("test_expected_terminal_projection");
    }
    accessor(
      frontier.projection.entries[0],
      "markerDigest",
      frontier.projection.entries[0].markerDigest,
    );

    const preCity = preCityInput();
    accessor(
      preCity.source.resolvedCountryEntry,
      "formalMarkerDigest",
      preCity.source.resolvedCountryEntry.formalMarkerDigest,
    );

    const branchParent = branchValueFixture();
    accessor(branchParent.parent, "countryCode", branchParent.parent.countryCode);
    const branchProjection = branchValueFixture();
    accessor(
      branchProjection.projection,
      "cityId",
      branchProjection.projection.cityId,
    );

    const pair = selectionPairFixture();
    accessor(
      pair.authority.ranking.installedPackageContext,
      "packageId",
      pair.authority.ranking.installedPackageContext.packageId,
    );
    const createEntry = selectionCreateInput();
    accessor(
      createEntry.selection.entry,
      "markerDigest",
      createEntry.selection.entry.markerDigest,
    );
    const createLink = selectionCreateInput();
    accessor(
      createLink.selection.reviewedSourceLinks[0],
      "sourceId",
      createLink.selection.reviewedSourceLinks[0].sourceId,
    );
    const pairSelection = selectionPairFixture();
    accessor(
      pairSelection.value.selection,
      "selectedMarkerDigest",
      pairSelection.value.selection.selectedMarkerDigest,
    );
    const pairCommit = selectionPairFixture();
    accessor(
      pairCommit.value.commit,
      "parentId",
      pairCommit.value.commit.parentId,
    );

    const cases: readonly [string, () => unknown][] = [
      ["frontier projection entry", () => sealCityFrontierRevision(frontier, integrity)],
      ["pre-city resolved entry", () => createPreCityBranchCommit(preCity, integrity)],
      ["city-branch parent", () => createCityBranchCommit(
        branchParent.projection,
        branchParent.parent,
        integrity,
      )],
      ["city-branch projection", () => createCityBranchCommit(
        branchProjection.projection,
        branchProjection.parent,
        integrity,
      )],
      ["selection wrapper authority", () => reconstructCitySelectionWithBranch(
        pair.value,
        pair.authority,
        integrity,
      )],
      ["selection create entry", () => createCitySelectionWithBranch(
        createEntry,
        integrity,
      )],
      ["selection create reviewed link", () => createCitySelectionWithBranch(
        createLink,
        integrity,
      )],
      ["selection replay value Selection", () => reconstructCitySelectionWithBranch(
        pairSelection.value,
        pairSelection.authority,
        integrity,
      )],
      ["selection replay value commit", () => reconstructCitySelectionWithBranch(
        pairCommit.value,
        pairCommit.authority,
        integrity,
      )],
    ];

    for (const [label, action] of cases) {
      expect(action, label).toThrowError("integrity_mismatch");
    }
    expect(accessorReads).toBe(0);
    expect(callbackCalls).toBe(0);
  });

  test("rejects a nested evaluator accessor before integrity or evaluator execution", () => {
    // Break caught: capturing evaluator functions with an ordinary property read after hashing starts.
    let accessorReads = 0;
    let evaluatorCalls = 0;
    let integrityCalls = 0;
    const evaluators = makeEvaluators();
    Object.defineProperty(evaluators.safety, "evaluate", {
      enumerable: true,
      get() {
        accessorReads += 1;
        return () => {
          evaluatorCalls += 1;
          return {
            state: "verified",
            factor: "1",
            targetComparison: "matches",
          };
        };
      },
    });
    const inputs = semanticInputs(evaluators);
    const integrity: CityDecisionIntegrity = {
      canonical() { integrityCalls += 1; return "never"; },
      hash() { integrityCalls += 1; return "0".repeat(64); },
    };
    const invoke = () => verifyCityRankingSnapshotSemantics(
      manualRankingSnapshot(),
      inputs,
      integrity,
    );

    const first = captureThrown(invoke);
    const second = captureThrown(invoke);

    expect(first).not.toBe(second);
    expect(first).toBeInstanceOf(Error);
    expect(second).toBeInstanceOf(Error);
    expect((first as Error).message).toBe("integrity_mismatch");
    expect((second as Error).message).toBe("integrity_mismatch");
    expect(accessorReads).toBe(0);
    expect(evaluatorCalls).toBe(0);
    expect(integrityCalls).toBe(0);
  });

  test("owns every representative nested semantic input before any callback", () => {
    // Break caught: closing semantic roots while ordinary reads invoke nested borrowed accessors.
    let accessorReads = 0;
    let evaluatorCalls = 0;
    let integrityCalls = 0;
    const integrity: CityDecisionIntegrity = {
      canonical() { integrityCalls += 1; return "never"; },
      hash() { integrityCalls += 1; return "0".repeat(64); },
    };
    const accessor = (value: object, key: string, result: unknown) => {
      Object.defineProperty(value, key, {
        enumerable: true,
        get() { accessorReads += 1; return result; },
      });
    };
    const variants: readonly [
      string,
      (inputs: CityRankingSemanticInputs) => void,
    ][] = [
      ["Registry entry", (inputs) => accessor(
        inputs.registry.entries[0],
        "officialName",
        inputs.registry.entries[0].officialName,
      )],
      ["Catalog member", (inputs) => accessor(
        inputs.catalog.members[0],
        "cityId",
        inputs.catalog.members[0].cityId,
      )],
      ["Criteria criterion", (inputs) => accessor(
        inputs.criteria.criteria[0],
        "target",
        inputs.criteria.criteria[0].target,
      )],
      ["Knowledge fact", (inputs) => accessor(
        inputs.knowledge[0]!.facts[0]!,
        "definitionId",
        inputs.knowledge[0]!.facts[0]!.definitionId,
      )],
      ["Knowledge outcome value", (inputs) => {
        const outcome = inputs.knowledge[0]!.facts[0]!.outcome;
        if (outcome.kind !== "verified" || outcome.basis.kind !== "canonical_scalar") {
          throw new Error("test_expected_verified_scalar_outcome");
        }
        accessor(outcome.basis, "value", outcome.basis.value);
      }],
    ];

    for (const [label, mutateInputs] of variants) {
      const evaluators = makeEvaluators(
        () => { evaluatorCalls += 1; },
        () => { evaluatorCalls += 1; },
      );
      const inputs = semanticInputs(evaluators);
      mutateInputs(inputs);
      expectFreshIntegrityMismatch(
        () => verifyCityRankingSnapshotSemantics(
          manualRankingSnapshot(),
          inputs,
          integrity,
        ),
        label,
      );
    }
    expect(accessorReads).toBe(0);
    expect(evaluatorCalls).toBe(0);
    expect(integrityCalls).toBe(0);
  });

  test("requires an exact closed evaluator registry before integrity or evaluation", () => {
    // Break caught: validating evaluator members while accepting a partial/open registry root.
    let accessorReads = 0;
    let evaluatorCalls = 0;
    let integrityCalls = 0;
    const integrity: CityDecisionIntegrity = {
      canonical() { integrityCalls += 1; return "never"; },
      hash() { integrityCalls += 1; return "0".repeat(64); },
    };
    const variants: readonly [
      string,
      (registry: CityCriterionEvaluatorRegistry) => void,
    ][] = [
      ["enumerable extra", (registry) => {
        mutable(registry).unexpected = true;
      }],
      ["Symbol extra", (registry) => {
        Object.defineProperty(registry, Symbol("unexpected"), { value: true });
      }],
      ["hidden extra data", (registry) => {
        Object.defineProperty(registry, "unexpected", {
          enumerable: false,
          value: true,
        });
      }],
      ["hidden extra accessor", (registry) => {
        Object.defineProperty(registry, "unexpected", {
          enumerable: false,
          get() { accessorReads += 1; return true; },
        });
      }],
      ["missing criterion", (registry) => {
        delete mutable(registry).safety;
      }],
      ["own-undefined criterion", (registry) => {
        mutable(registry).safety = undefined;
      }],
    ];

    for (const [label, mutateRegistry] of variants) {
      const evaluators = makeEvaluators(
        () => { evaluatorCalls += 1; },
        () => { evaluatorCalls += 1; },
      );
      mutateRegistry(evaluators);
      const inputs = semanticInputs(evaluators);
      expectFreshIntegrityMismatch(
        () => verifyCityRankingSnapshotSemantics(
          manualRankingSnapshot(),
          inputs,
          integrity,
        ),
        `evaluator registry ${label}`,
      );
    }
    expect(accessorReads).toBe(0);
    expect(evaluatorCalls).toBe(0);
    expect(integrityCalls).toBe(0);
  });

  test("requires exact evaluator records and definitions before any callback", () => {
    // Break caught: closing the registry root but spreading open evaluator/definition members.
    let accessorReads = 0;
    let evaluatorCalls = 0;
    let integrityCalls = 0;
    const integrity: CityDecisionIntegrity = {
      canonical() { integrityCalls += 1; return "never"; },
      hash() { integrityCalls += 1; return "0".repeat(64); },
    };
    const variants: readonly [
      string,
      (registry: CityCriterionEvaluatorRegistry) => void,
    ][] = [
      ["evaluator record extra", (registry) => {
        mutable(registry.safety).unexpected = true;
      }],
      ["evaluator record Symbol", (registry) => {
        Object.defineProperty(registry.safety, Symbol("unexpected"), { value: true });
      }],
      ["evaluator record hidden extra", (registry) => {
        Object.defineProperty(registry.safety, "unexpected", {
          enumerable: false,
          value: true,
        });
      }],
      ["evaluator definition accessor", (registry) => {
        const definition = registry.safety.definition;
        Object.defineProperty(registry.safety, "definition", {
          enumerable: true,
          get() { accessorReads += 1; return definition; },
        });
      }],
      ["evaluator missing canonicalizeTarget", (registry) => {
        delete mutable(registry.safety).canonicalizeTarget;
      }],
      ["evaluator own-undefined evaluate", (registry) => {
        mutable(registry.safety).evaluate = undefined;
      }],
      ["definition extra", (registry) => {
        mutable(registry.long_term_rent.definition).unexpected = true;
      }],
      ["definition custom prototype", (registry) => {
        Object.setPrototypeOf(registry.safety.definition, { inherited: true });
      }],
      ["definition missing evaluatorVersion", (registry) => {
        delete mutable(registry.safety.definition).evaluatorVersion;
      }],
      ["definition own-undefined evaluatorVersion", (registry) => {
        mutable(registry.safety.definition).evaluatorVersion = undefined;
      }],
    ];

    for (const [label, mutateEvaluator] of variants) {
      const evaluators = makeEvaluators(
        () => { evaluatorCalls += 1; },
        () => { evaluatorCalls += 1; },
      );
      mutateEvaluator(evaluators);
      expectFreshIntegrityMismatch(
        () => verifyCityRankingSnapshotSemantics(
          manualRankingSnapshot(),
          semanticInputs(evaluators),
          integrity,
        ),
        label,
      );
    }
    expect(accessorReads).toBe(0);
    expect(evaluatorCalls).toBe(0);
    expect(integrityCalls).toBe(0);
  });

  test("rejects callable-Proxy evaluator functions before integrity or traps", () => {
    // Break caught: owning evaluator descriptors but invoking a Proxy-backed function authority.
    let applyCalls = 0;
    let getReads = 0;
    let integrityCalls = 0;
    const integrity: CityDecisionIntegrity = {
      canonical() { integrityCalls += 1; return "never"; },
      hash() { integrityCalls += 1; return "0".repeat(64); },
    };

    for (const capability of ["canonicalizeTarget", "evaluate"] as const) {
      const evaluators = makeEvaluators();
      const target = evaluators.safety[capability];
      const proxy = new Proxy(target, {
        apply(callable, receiver, argumentsList) {
          applyCalls += 1;
          return Reflect.apply(callable, receiver, argumentsList);
        },
        get(callable, key, receiver) {
          getReads += 1;
          return Reflect.get(callable, key, receiver);
        },
      });
      mutable(evaluators.safety)[capability] = proxy;
      const inputs = semanticInputs(evaluators);

      expectFreshIntegrityMismatch(
        () => verifyCityRankingSnapshotSemantics(
          manualRankingSnapshot(),
          inputs,
          integrity,
        ),
        `evaluator callable-Proxy ${capability}`,
      );
    }
    expect(applyCalls).toBe(0);
    expect(getReads).toBe(0);
    expect(integrityCalls).toBe(0);
  });

  test("normalizes distributed hostile C/H results at every boundary", () => {
    // Break caught: accepting async/non-string/non-lowercase callback output or leaking a throw.
    const hostileError = new Error("hostile_integrity_error");

    for (const [index, boundary] of task12BoundaryCases().entries()) {
      const base = createEvidenceIntegrity("task-12-hostile-callback-key");
      let callbackCalls = 0;
      const validCanonical = (value: unknown) => Reflect.apply(
        base.canonical,
        Object.freeze({ capability: "canonical" }),
        [value],
      );
      const validHash = (canonicalText: string) => Reflect.apply(
        base.hash,
        Object.freeze({ capability: "hash" }),
        [canonicalText],
      );
      let integrity: object;
      switch (index % 9) {
        case 0:
          integrity = {
            canonical() { callbackCalls += 1; throw hostileError; },
            hash: validHash,
          };
          break;
        case 1:
          integrity = {
            canonical() { callbackCalls += 1; return Promise.resolve("async"); },
            hash: validHash,
          };
          break;
        case 2:
          integrity = {
            canonical() { callbackCalls += 1; return 7; },
            hash: validHash,
          };
          break;
        case 3:
          integrity = {
            canonical: validCanonical,
            hash() { callbackCalls += 1; throw hostileError; },
          };
          break;
        case 4:
          integrity = {
            canonical: validCanonical,
            hash() { callbackCalls += 1; return Promise.resolve("async"); },
          };
          break;
        case 5:
          integrity = {
            canonical: validCanonical,
            hash() { callbackCalls += 1; return 7; },
          };
          break;
        case 6:
          integrity = {
            canonical: validCanonical,
            hash() { callbackCalls += 1; return "A".repeat(64); },
          };
          break;
        case 7:
          integrity = {
            canonical: validCanonical,
            hash() { callbackCalls += 1; return "a".repeat(63); },
          };
          break;
        default:
          integrity = {
            canonical: validCanonical,
            hash() { callbackCalls += 1; return "g".repeat(64); },
          };
      }

      const first = captureThrown(() => boundary.invoke(
        boundary.makePrimary(),
        integrity as CityDecisionIntegrity,
      ));
      const second = captureThrown(() => boundary.invoke(
        boundary.makePrimary(),
        integrity as CityDecisionIntegrity,
      ));
      expect(first, boundary.name).not.toBe(hostileError);
      expect(second, boundary.name).not.toBe(hostileError);
      expect(first, boundary.name).not.toBe(second);
      expect(first, boundary.name).toBeInstanceOf(Error);
      expect(second, boundary.name).toBeInstanceOf(Error);
      expect((first as Error).message, boundary.name).toBe("integrity_mismatch");
      expect((second as Error).message, boundary.name).toBe("integrity_mismatch");
      expect(callbackCalls, boundary.name).toBeGreaterThan(0);
    }
  });

  test("allocates a fresh mismatch without inspecting a hostile throw at every boundary", () => {
    // Break caught: rethrowing/caching callback failures or probing the hostile thrown object.
    let hostileReads = 0;
    const hostileThrown = new Proxy(Object.create(null) as object, {
      get() { hostileReads += 1; return undefined; },
      getOwnPropertyDescriptor() { hostileReads += 1; return undefined; },
      getPrototypeOf() { hostileReads += 1; return null; },
      ownKeys() { hostileReads += 1; return []; },
    });

    for (const boundary of task12BoundaryCases()) {
      for (const mode of ["canonical", "hash"] as const) {
        let callbackCalls = 0;
        const integrity: CityDecisionIntegrity = mode === "canonical"
          ? {
              canonical() { callbackCalls += 1; throw hostileThrown; },
              hash() { return "0".repeat(64); },
            }
          : {
              canonical(value: unknown) {
                return Reflect.apply(
                  INTEGRITY.canonical,
                  Object.freeze({ capability: "canonical" }),
                  [value],
                );
              },
              hash() { callbackCalls += 1; throw hostileThrown; },
            };
        const label = `${boundary.name}: hostile ${mode}`;
        const first = captureThrown(() =>
          boundary.invoke(boundary.makePrimary(), integrity));
        const second = captureThrown(() =>
          boundary.invoke(boundary.makePrimary(), integrity));

        expect(Object.is(first, hostileThrown), label).toBe(false);
        expect(Object.is(second, hostileThrown), label).toBe(false);
        expect(first, label).not.toBe(second);
        expect(first, label).toBeInstanceOf(Error);
        expect(second, label).toBeInstanceOf(Error);
        expect((first as Error).message, label).toBe("integrity_mismatch");
        expect((second as Error).message, label).toBe("integrity_mismatch");
        expect(callbackCalls, label).toBe(2);
      }
    }
    expect(hostileReads).toBe(0);
  });

  test("owns every primary and both C/H functions before its first callback", () => {
    // Break caught: late-reading a borrowed graph or a swapped later integrity capability.
    const cases = task12BoundaryCases();
    const executed: string[] = [];
    for (const boundary of cases) {
      const cleanPrimary = boundary.makePrimary();
      const expected = boundary.invoke(
        structuredClone(cleanPrimary),
        INTEGRITY,
      );
      const primary = structuredClone(cleanPrimary);
      const observation = integrityObserver(() => {
        mutable(primary).unexpected = "attacker";
        mutable(observation.integrity).canonical = () => "attacker";
        mutable(observation.integrity).hash = () => "f".repeat(64);
      }, INTEGRITY);

      const actual = boundary.invoke(primary, observation.integrity);

      executed.push(boundary.name);
      expect(actual, boundary.name).toEqual(expected);
      expect(mutable(primary).unexpected, boundary.name).toBe("attacker");
      for (const captured of observation.canonicalValues) {
        expect(captured, boundary.name).not.toBe(primary);
        expectRecursivelyFrozen(captured);
      }
      expectIntegrityCallbackReceivers(observation.receivers);
    }
    expect(executed).toEqual(cases.map(({ name }) => name));
  });

  test("owns every secondary authority graph before its first integrity callback", () => {
    // Break caught: eagerly owning the primary while late-reading replay/source/parent authority.
    interface SecondaryAuthorityCase {
      readonly name: string;
      readonly expected: unknown;
      readonly invoke: (integrity: CityDecisionIntegrity) => unknown;
      readonly attack: () => void;
      readonly assertAttacked: () => void;
    }
    const base = INTEGRITY;
    const cases: SecondaryAuthorityCase[] = [];

    {
      const snapshot = manualRankingSnapshot();
      const inputs = semanticInputs();
      cases.push({
        name: "ranking semantic inputs",
        expected: verifyCityRankingSnapshotSemantics(
          manualRankingSnapshot(),
          semanticInputs(),
          base,
        ),
        invoke: (integrity) =>
          verifyCityRankingSnapshotSemantics(snapshot, inputs, integrity),
        attack: () => {
          mutable(inputs.registry).id = "registry:attacker";
          mutable(inputs.registry.entries[0]).officialName = "Registry Attacker";
          mutable(inputs.catalog).id = "catalog:attacker";
          mutable(inputs.catalog.members[0]).cityId = "catalog-attacker";
          mutable(inputs.criteria.criteria[0]).target = "0";
          mutable(inputs.knowledge[0]!.facts[0]!.outcome).basis = {
            kind: "canonical_scalar",
            value: "0",
          };
          for (const criterionId of CITY_CRITERION_IDS) {
            mutable(inputs.evaluators[criterionId].definition).evaluatorVersion =
              "eval@attacker";
            mutable(inputs.evaluators)[criterionId] = {
              definition: criterionDefinition(criterionId),
              canonicalizeTarget: () => "attacker",
              evaluate: () => ({
                state: "verified",
                factor: "0",
                targetComparison: "does_not_match",
              }),
            };
          }
        },
        assertAttacked: () => {
          expect(inputs.registry.entries[0].officialName).toBe("Registry Attacker");
          expect(inputs.catalog.members[0].cityId).toBe("catalog-attacker");
          expect(inputs.criteria.criteria[0].target).toBe("0");
        },
      });
    }
    {
      const value = manualPreCityCommit();
      const source = preCitySource();
      cases.push({
        name: "pre-city replay source",
        expected: replayPreCityBranchCommit(
          manualPreCityCommit(),
          preCitySource(),
          base,
        ),
        invoke: (integrity) => replayPreCityBranchCommit(value, source, integrity),
        attack: () => {
          mutable(source).profileSnapshotId = "profile:attacker";
          mutable(source.resolvedCountryEntry).formalMarkerDigest = "9".repeat(64);
        },
        assertAttacked: () => {
          expect(source.profileSnapshotId).toBe("profile:attacker");
          expect(source.resolvedCountryEntry.formalMarkerDigest).toBe("9".repeat(64));
        },
      });
    }
    {
      const fixture = branchValueFixture();
      cases.push({
        name: "city-branch create parent",
        expected: createCityBranchCommit(
          branchValueFixture().projection,
          branchValueFixture().parent,
          base,
        ),
        invoke: (integrity) =>
          createCityBranchCommit(fixture.projection, fixture.parent, integrity),
        attack: () => {
          mutable(fixture.parent).countryCode = "AT";
          mutable(fixture.parent).profileSnapshotId = "profile:attacker";
        },
        assertAttacked: () => {
          expect(fixture.parent.countryCode).toBe("AT");
          expect(fixture.parent.profileSnapshotId).toBe("profile:attacker");
        },
      });
    }
    {
      const fixture = branchValueFixture();
      cases.push({
        name: "city-branch replay projection and parent",
        expected: replayCityBranchCommit(
          branchValueFixture().commit,
          branchValueFixture().projection,
          branchValueFixture().parent,
          base,
        ),
        invoke: (integrity) => replayCityBranchCommit(
          fixture.commit,
          fixture.projection,
          fixture.parent,
          integrity,
        ),
        attack: () => {
          mutable(fixture.projection).cityId = "attacker";
          mutable(fixture.parent).countryCode = "AT";
        },
        assertAttacked: () => {
          expect(fixture.projection.cityId).toBe("attacker");
          expect(fixture.parent.countryCode).toBe("AT");
        },
      });
    }
    {
      const fixture = selectionPairFixture();
      cases.push({
        name: "selection wrapper reconstruction authority",
        expected: reconstructCitySelectionWithBranch(
          selectionPairFixture().value,
          selectionPairFixture().authority,
          base,
        ),
        invoke: (integrity) => reconstructCitySelectionWithBranch(
          fixture.value,
          fixture.authority,
          integrity,
        ),
        attack: () => {
          mutable(fixture.authority.terminal.markers[0]).cityId = "attacker";
          mutable(fixture.authority.ranking).profileSnapshotId = "profile:attacker";
          mutable(fixture.authority.preCityBranch).profileSnapshotId =
            "profile:attacker";
        },
        assertAttacked: () => {
          expect(fixture.authority.terminal.markers[0].cityId).toBe("attacker");
          expect(fixture.authority.ranking.profileSnapshotId).toBe("profile:attacker");
          expect(fixture.authority.preCityBranch.profileSnapshotId)
            .toBe("profile:attacker");
        },
      });
    }

    for (const boundary of cases) {
      const observation = integrityObserver(() => {
        boundary.attack();
        mutable(observation.integrity).canonical = () => "attacker";
        mutable(observation.integrity).hash = () => "f".repeat(64);
      }, INTEGRITY);

      const actual = boundary.invoke(observation.integrity);

      expect(actual, boundary.name).toEqual(boundary.expected);
      boundary.assertAttacked();
      for (const captured of observation.canonicalValues) {
        expectRecursivelyFrozen(captured);
      }
      expectIntegrityCallbackReceivers(observation.receivers);
    }
  });

  test("normalizes hostile evaluator throws and synchronous return shapes", () => {
    // Break caught: the semantic wrapper delegating hostile capability output validation to ranker code.
    let hostileReads = 0;
    let accessorReads = 0;
    const hostileThrown = new Proxy(Object.create(null) as object, {
      get() { hostileReads += 1; return undefined; },
      getOwnPropertyDescriptor() { hostileReads += 1; return undefined; },
      getPrototypeOf() { hostileReads += 1; return null; },
      ownKeys() { hostileReads += 1; return []; },
    });
    const cases: readonly [
      string,
      (registry: CityCriterionEvaluatorRegistry, onCall: () => void) => void,
      ((inputs: CityRankingSemanticInputs) => void)?,
    ][] = [
      ["canonicalize throw", (registry, onCall) => {
        mutable(registry.safety).canonicalizeTarget = () => {
          onCall();
          throw hostileThrown;
        };
      }],
      ["canonicalize Promise", (registry, onCall) => {
        mutable(registry.safety).canonicalizeTarget = () => {
          onCall();
          return Promise.resolve("1");
        };
      }],
      ["canonicalize non-string", (registry, onCall) => {
        mutable(registry.safety).canonicalizeTarget = () => {
          onCall();
          return 1;
        };
      }],
      ["canonicalize different string", (registry, onCall) => {
        mutable(registry.safety).canonicalizeTarget = () => {
          onCall();
          return "different";
        };
      }],
      ["evaluate throw", (registry, onCall) => {
        mutable(registry.safety).evaluate = () => {
          onCall();
          throw hostileThrown;
        };
      }],
      ["evaluate Promise", (registry, onCall) => {
        mutable(registry.safety).evaluate = () => {
          onCall();
          return Promise.resolve({
            state: "verified",
            factor: "1",
            targetComparison: "matches",
          });
        };
      }],
      ["evaluate Proxy", (registry, onCall) => {
        mutable(registry.safety).evaluate = () => {
          onCall();
          return new Proxy({
            state: "verified",
            factor: "1",
            targetComparison: "matches",
          }, {});
        };
      }],
      ["evaluate accessor", (registry, onCall) => {
        mutable(registry.safety).evaluate = () => {
          onCall();
          const result = {
            state: "verified",
            targetComparison: "matches",
          } as MutableRecord;
          Object.defineProperty(result, "factor", {
            enumerable: true,
            get() { accessorReads += 1; return "1"; },
          });
          return result;
        };
      }],
      ["evaluate extra key", (registry, onCall) => {
        mutable(registry.safety).evaluate = () => {
          onCall();
          return {
            state: "verified",
            factor: "1",
            targetComparison: "matches",
            extra: true,
          };
        };
      }],
      ["evaluate hidden extra data", (registry, onCall) => {
        mutable(registry.safety).evaluate = () => {
          onCall();
          const result = {
            state: "verified",
            factor: "1",
            targetComparison: "matches",
          };
          Object.defineProperty(result, "extra", {
            enumerable: false,
            value: true,
          });
          return result;
        };
      }],
      ["evaluate hidden extra accessor", (registry, onCall) => {
        mutable(registry.safety).evaluate = () => {
          onCall();
          const result = {
            state: "verified",
            factor: "1",
            targetComparison: "matches",
          };
          Object.defineProperty(result, "extra", {
            enumerable: false,
            get() { accessorReads += 1; return true; },
          });
          return result;
        };
      }],
      ["evaluate Symbol extra", (registry, onCall) => {
        mutable(registry.safety).evaluate = () => {
          onCall();
          const result = {
            state: "verified",
            factor: "1",
            targetComparison: "matches",
          };
          Object.defineProperty(result, Symbol("extra"), { value: true });
          return result;
        };
      }],
      ["evaluate custom prototype", (registry, onCall) => {
        mutable(registry.safety).evaluate = () => {
          onCall();
          const result = {
            state: "verified",
            factor: "1",
            targetComparison: "matches",
          };
          Object.setPrototypeOf(result, { inherited: true });
          return result;
        };
      }],
      ["evaluate verified missing factor", (registry, onCall) => {
        mutable(registry.safety).evaluate = () => {
          onCall();
          return {
            state: "verified",
            targetComparison: "matches",
          };
        };
      }],
      ["evaluate verified own-undefined factor", (registry, onCall) => {
        mutable(registry.safety).evaluate = () => {
          onCall();
          return {
            state: "verified",
            factor: undefined,
            targetComparison: "matches",
          };
        };
      }],
      ["evaluate unknown missing reason", (registry, onCall) => {
        mutable(registry.safety).evaluate = () => {
          onCall();
          return {
            state: "unknown",
            factor: "0",
            targetComparison: "unknown",
          };
        };
      }],
      ["evaluate unknown own-undefined reason", (registry, onCall) => {
        mutable(registry.safety).evaluate = () => {
          onCall();
          return {
            state: "unknown",
            factor: "0",
            targetComparison: "unknown",
            unknownReason: undefined,
          };
        };
      }],
      ["evaluate invalid verified factor", (registry, onCall) => {
        mutable(registry.safety).evaluate = () => {
          onCall();
          return {
            state: "verified",
            factor: "1.1",
            targetComparison: "matches",
          };
        };
      }],
      ["evaluate negative verified factor", (registry, onCall) => {
        mutable(registry.safety).evaluate = () => {
          onCall();
          return {
            state: "verified",
            factor: "-0.1",
            targetComparison: "matches",
          };
        };
      }],
      ["evaluate noncanonical verified factor", (registry, onCall) => {
        mutable(registry.safety).evaluate = () => {
          onCall();
          return {
            state: "verified",
            factor: "01",
            targetComparison: "matches",
          };
        };
      }],
      ["evaluate malformed unknown", (registry, onCall) => {
        mutable(registry.safety).evaluate = () => {
          onCall();
          return {
            state: "unknown",
            factor: "1",
            targetComparison: "unknown",
            unknownReason: "not_found",
          };
        };
      }],
      ["evaluate changes raw unknown reason", (registry, onCall) => {
        mutable(registry.safety).evaluate = () => {
          onCall();
          return {
            state: "unknown",
            factor: "0",
            targetComparison: "unknown",
            unknownReason: "source_unavailable",
          };
        };
        mutable(registry.long_term_rent).evaluate = (
          input: CityCriterionEvaluationInput,
        ) => {
          onCall();
          return evaluateNormally(input);
        };
      }, (inputs) => {
        mutable(inputs.knowledge[0]!.facts[0]!).outcome = {
          kind: "unknown",
          reason: "not_found",
        };
      }],
      ["evaluate promotes raw unknown", (registry, onCall) => {
        mutable(registry.safety).evaluate = () => {
          onCall();
          return {
            state: "verified",
            factor: "1",
            targetComparison: "matches",
          };
        };
        mutable(registry.long_term_rent).evaluate = (
          input: CityCriterionEvaluationInput,
        ) => {
          onCall();
          return evaluateNormally(input);
        };
      }, (inputs) => {
        mutable(inputs.knowledge[0]!.facts[0]!).outcome = {
          kind: "unknown",
          reason: "not_found",
        };
      }],
    ];

    for (const [label, install, mutateInputs] of cases) {
      let callbackCalls = 0;
      const invoke = () => {
        const evaluators = makeEvaluators();
        install(evaluators, () => { callbackCalls += 1; });
        const inputs = semanticInputs(evaluators);
        mutateInputs?.(inputs);
        return verifyCityRankingSnapshotSemantics(
          manualRankingSnapshot(),
          inputs,
          INTEGRITY,
        );
      };
      const first = captureThrown(invoke);
      const second = captureThrown(invoke);

      expect(Object.is(first, hostileThrown), label).toBe(false);
      expect(Object.is(second, hostileThrown), label).toBe(false);
      expect(first, label).not.toBe(second);
      expect(first, label).toBeInstanceOf(Error);
      expect(second, label).toBeInstanceOf(Error);
      expect((first as Error).message, label).toBe("integrity_mismatch");
      expect((second as Error).message, label).toBe("integrity_mismatch");
      expect(callbackCalls, label).toBe(2);
    }
    expect(hostileReads).toBe(0);
    expect(accessorReads).toBe(0);
  });
});
