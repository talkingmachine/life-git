import { describe, expect, expectTypeOf, test } from "vitest";

import {
  CITY_CRITERION_IDS,
  type CityCriteriaSnapshot,
  type CityCriterionEvaluation,
  type CityCriterionEvaluationInput,
  type CityCriterionEvaluator,
  type CityCriterionEvaluatorRegistry,
  type CityCriterionId,
  type CityRankingFactInput,
} from "../../src/decision/city-criteria";
import {
  reconstructCityFrontier,
  reconstructCityLiveMarker,
  type CityAcceptedFactLinkProjection,
  type CityCandidateViewStatus,
  type CityCommittedFactProjection,
  type CityCommittedFactProjectionTuple,
  type CityCommittedMarkerVisualStatus,
  type CityFactLinkRejectionReason,
  type CityFactLinkProjection,
  type CityFrontierProjection,
  type CityFrontierRankingProjection,
  type CityFrontierStopCondition,
  type CityFrontierVerificationBudget,
  type CityLiveMarker,
  type CityMarkerAuthorityProjection,
  type CityMarkerBinding,
  type CityMarkerDisposition,
  type CityReviewedFactLinkProjection,
  type CityTerminalEntry,
  type CityUnknownWarning,
  type ReconstructCityFrontierInput,
  type ReconstructCityLiveMarkerInput,
} from "../../src/decision/city-frontier-policy";
import type { CityRequiredMismatch } from "../../src/decision/city-ranker";

const ASSESSMENT_AT = "2026-01-02T00:00:00.000Z";
const LAST_CHECKED_AT = "2026-01-03T00:00:00.000Z";
const ORDERED_CITY_IDS = [
  "alpha", "bravo", "charlie", "delta", "echo", "foxtrot",
  "golf", "hotel", "india", "juliet", "kilo", "lima",
] as const;
const SCREENED_CITY_ID = "screened";

type MarkerKind = "green" | "yellow" | "red";
type MutableRecord = Record<string, unknown>;

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
  onCanonicalize?: (criterionId: CityCriterionId) => void,
  onEvaluate?: (criterionId: CityCriterionId, input: CityCriterionEvaluationInput) => void,
): CityCriterionEvaluatorRegistry {
  return Object.fromEntries(CITY_CRITERION_IDS.map((criterionId) => [criterionId, {
    definition: criterionDefinition(criterionId),
    canonicalizeTarget(target: unknown) {
      onCanonicalize?.(criterionId);
      return String(target);
    },
    evaluate(input: CityCriterionEvaluationInput) {
      onEvaluate?.(criterionId, input);
      return evaluateNormally(input);
    },
  }])) as unknown as CityCriterionEvaluatorRegistry;
}

function makeCriteria(): CityCriteriaSnapshot {
  const criteria = CITY_CRITERION_IDS.map((criterionId, index) => ({
    criterionId,
    definitionId: `${criterionId}@1`,
    mode: criterionId === "safety" ? "required" as const : "weighted" as const,
    importance: (index + 1) as 1 | 2 | 3 | 4,
    target: "1",
  })) as unknown as CityCriteriaSnapshot["criteria"];
  return {
    schemaVersion: "city-criteria@1",
    id: "criteria:1",
    profileSnapshotId: "profile:1",
    preferenceProfileSnapshotId: "preferences:1",
    criteria,
    rulesVersion: "city-criteria@1",
    confirmedAt: "2026-01-01T00:00:00.000Z",
  };
}

function acceptedLink(
  sourceId: string,
  options: { readonly safety?: boolean; readonly referenceYear?: number } = {},
): CityAcceptedFactLinkProjection {
  return {
    sourceId,
    disposition: "accepted",
    navigationUrl: `https://navigation.example/${sourceId}`,
    resolvedEvidenceUrl: `https://evidence.example/${sourceId}`,
    ...((options.safety ?? false)
      ? { referenceYear: options.referenceYear ?? 2025 }
      : options.referenceYear === undefined ? {} : { referenceYear: options.referenceYear }),
  };
}

function reviewedLink(
  sourceId: string,
  options: {
    readonly safety?: boolean;
    readonly resolved?: boolean;
    readonly referenceYear?: number;
  } = {},
): CityReviewedFactLinkProjection {
  return {
    sourceId,
    disposition: "reviewed_rejected",
    navigationUrl: `https://navigation.example/${sourceId}`,
    ...((options.resolved ?? false)
      ? { resolvedEvidenceUrl: `https://evidence.example/${sourceId}` }
      : {}),
    ...(options.referenceYear === undefined ? {} : { referenceYear: options.referenceYear }),
    ...((options.safety ?? false) ? { rejectionReason: "stale" as const } : {}),
  };
}

function makeFact(
  criterionId: CityCriterionId,
  kind: "verified" | "unknown" = "verified",
  factor = "1",
  evidenceLinks: readonly CityAcceptedFactLinkProjection[] = [],
  manualCheckLinks: readonly CityReviewedFactLinkProjection[] = [],
): CityCommittedFactProjection {
  const outcome: CityRankingFactInput["outcome"] = kind === "unknown"
    ? { kind: "unknown", reason: "not_found" }
    : { kind: "verified", basis: { kind: "canonical_scalar", value: factor } };
  return {
    criterionId,
    definitionId: `${criterionId}@1`,
    geoScope: "municipality",
    referencePeriod: "2025",
    freshnessBasis: "fresh@1",
    unit: "unit",
    denominator: "municipality",
    outcome,
    evidenceLinks,
    manualCheckLinks,
  };
}

function makeFacts(kind: MarkerKind): CityCommittedFactProjectionTuple {
  return CITY_CRITERION_IDS.map((criterionId) => {
    if (kind === "yellow" && criterionId === "fixed_broadband") {
      return makeFact(criterionId, "unknown");
    }
    return makeFact(criterionId, "verified", kind === "red" && criterionId === "safety" ? "0" : "1");
  }) as unknown as CityCommittedFactProjectionTuple;
}

function makeAuthority(cityId: string, kind: MarkerKind): CityMarkerAuthorityProjection {
  return {
    cityId,
    knowledgeRevisionId: `knowledge:${cityId}`,
    evidenceSnapshotId: `evidence:${cityId}`,
    lastCheckedAt: LAST_CHECKED_AT,
    facts: makeFacts(kind),
  };
}

function expectedMismatch(): CityRequiredMismatch {
  return {
    criterionId: "safety",
    definitionId: "safety@1",
    target: "1",
    verifiedBasis: { kind: "canonical_scalar", value: "0" },
    evaluatorVersion: "eval@1",
  };
}

function markerFor(
  authority: CityMarkerAuthorityProjection,
  rank: number,
  kind: MarkerKind,
): CityLiveMarker {
  const requiredMismatches = kind === "red" ? [expectedMismatch()] : [];
  const unknownBasis = kind === "yellow" ? [{
    criterionId: "fixed_broadband" as const,
    definitionId: "fixed_broadband@1",
    reason: "not_found" as const,
  }] : [];
  return {
    cityId: authority.cityId,
    rank,
    status: kind === "red" ? "excluded" : "selectable",
    visualStatus: kind,
    knowledgeRevisionId: authority.knowledgeRevisionId,
    evidenceSnapshotId: authority.evidenceSnapshotId,
    lastCheckedAt: authority.lastCheckedAt,
    requiredMismatches,
    unknownBasis,
    verificationCoverage: kind === "yellow" ? "0.6" : "1",
    facts: structuredClone(authority.facts) as CityCommittedFactProjectionTuple,
  };
}

function digestFor(rank: number): string {
  return rank.toString(16).repeat(64);
}

function makeBinding(cityId: string, rank: number, kind: MarkerKind): CityMarkerBinding {
  const authority = makeAuthority(cityId, kind);
  return {
    marker: markerFor(authority, rank, kind),
    markerDigest: digestFor(rank),
    authority,
  };
}

function rankingFor(orderedCityIds: readonly string[] = ORDERED_CITY_IDS): CityFrontierRankingProjection {
  return {
    assessmentAt: ASSESSMENT_AT,
    orderedCityIds: [...orderedCityIds],
    screenedExclusionCityIds: [SCREENED_CITY_ID],
  };
}

function frontierInput(
  markerBindings: readonly CityMarkerBinding[],
  options: {
    readonly ranking?: CityFrontierRankingProjection;
    readonly criteria?: CityCriteriaSnapshot;
    readonly evaluators?: CityCriterionEvaluatorRegistry;
    readonly predecessorMarkers?: null | readonly CityLiveMarker[];
    readonly persisted?: CityFrontierProjection;
  } = {},
): ReconstructCityFrontierInput {
  const predecessorMarkers = options.predecessorMarkers === undefined
    ? markerBindings.length === 0
      ? null
      : markerBindings.slice(0, -1).map(({ marker }) => structuredClone(marker))
    : options.predecessorMarkers;
  return {
    ranking: options.ranking ?? rankingFor(),
    criteria: options.criteria ?? makeCriteria(),
    evaluators: options.evaluators ?? makeEvaluators(),
    predecessorMarkers,
    markerBindings,
    ...(options.persisted === undefined ? {} : { persisted: options.persisted }),
  };
}

function terminalEntry(binding: CityMarkerBinding): CityTerminalEntry {
  return {
    cityId: binding.marker.cityId,
    rank: binding.marker.rank,
    markerDigest: binding.markerDigest,
    knowledgeRevisionId: binding.marker.knowledgeRevisionId,
    evidenceSnapshotId: binding.marker.evidenceSnapshotId,
    unknownBasis: structuredClone(binding.marker.unknownBasis),
  };
}

function expectRecursivelyFrozen(value: unknown, seen = new Set<object>()): void {
  if (value === null || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value)) expectRecursivelyFrozen(child, seen);
}

function asMutable(value: unknown): MutableRecord {
  return value as MutableRecord;
}

describe("city live marker policy", () => {
  test("exports the exact closed frontier and marker contracts", () => {
    // Break caught: widening a Decision boundary with an extra field or an open status branch.
    type ExpectedCriterionId = "safety" | "long_term_rent" | "urban_transit" | "fixed_broadband";
    type ExpectedUnknownReason = "not_found" | "stale" | "conflict" | "not_comparable" | "source_unavailable";
    type ExpectedRejectionReason =
      | "http_not_found"
      | "transport_unavailable"
      | "authority_untrusted"
      | "stale"
      | "scope_mismatch"
      | "definition_mismatch"
      | "missing_numerator"
      | "denominator_missing"
      | "denominator_zero"
      | "denominator_period_mismatch"
      | "denominator_scope_mismatch"
      | "wrong_media_type"
      | "too_large"
      | "untrusted_redirect"
      | "retention_unapproved"
      | "conflict";
    type ExpectedAcceptedLink = {
      readonly sourceId: string;
      readonly disposition: "accepted";
      readonly navigationUrl: string;
      readonly resolvedEvidenceUrl: string;
      readonly referenceYear?: number;
    };
    type ExpectedReviewedLink = {
      readonly sourceId: string;
      readonly disposition: "reviewed_rejected";
      readonly navigationUrl: string;
      readonly resolvedEvidenceUrl?: string;
      readonly referenceYear?: number;
      readonly rejectionReason?: ExpectedRejectionReason;
    };
    type ExpectedVerifiedBasis =
      | { readonly kind: "canonical_scalar"; readonly value: string }
      | {
          readonly kind: "municipal_safety";
          readonly quantity: {
            readonly offenceCount: string;
            readonly population: string;
            readonly rateBasis: "offences_per_100000_residents";
          };
        };
    type ExpectedFact = {
      readonly criterionId: ExpectedCriterionId;
      readonly definitionId: string;
      readonly geoScope: string;
      readonly referencePeriod: string | null;
      readonly freshnessBasis: string;
      readonly unit: string;
      readonly denominator: string;
      readonly outcome:
        | { readonly kind: "verified"; readonly basis: ExpectedVerifiedBasis }
        | { readonly kind: "unknown"; readonly reason: ExpectedUnknownReason };
      readonly evidenceLinks: readonly ExpectedAcceptedLink[];
      readonly manualCheckLinks: readonly ExpectedReviewedLink[];
    };
    type ExpectedFactTuple = readonly [ExpectedFact, ExpectedFact, ExpectedFact, ExpectedFact];
    type ExpectedWarning = {
      readonly criterionId: ExpectedCriterionId;
      readonly definitionId: string;
      readonly reason: ExpectedUnknownReason;
    };
    type ExpectedMismatch = {
      readonly criterionId: ExpectedCriterionId;
      readonly definitionId: string;
      readonly target: string;
      readonly verifiedBasis: ExpectedVerifiedBasis;
      readonly evaluatorVersion: string;
    };
    type ExpectedMarker = {
      readonly cityId: string;
      readonly rank: number;
      readonly status: "selectable" | "excluded";
      readonly visualStatus: "green" | "yellow" | "red";
      readonly knowledgeRevisionId: string;
      readonly evidenceSnapshotId: string;
      readonly lastCheckedAt: string;
      readonly requiredMismatches: readonly ExpectedMismatch[];
      readonly unknownBasis: readonly ExpectedWarning[];
      readonly verificationCoverage: string;
      readonly facts: ExpectedFactTuple;
    };
    type ExpectedAuthority = {
      readonly cityId: string;
      readonly knowledgeRevisionId: string;
      readonly evidenceSnapshotId: string;
      readonly lastCheckedAt: string;
      readonly facts: ExpectedFactTuple;
    };
    type ExpectedBinding = {
      readonly marker: ExpectedMarker;
      readonly markerDigest: string;
      readonly authority: ExpectedAuthority;
    };
    type ExpectedRanking = {
      readonly assessmentAt: string;
      readonly orderedCityIds: readonly string[];
      readonly screenedExclusionCityIds: readonly string[];
    };
    type ExpectedEntry = {
      readonly cityId: string;
      readonly rank: number;
      readonly markerDigest: string;
      readonly knowledgeRevisionId: string;
      readonly evidenceSnapshotId: string;
      readonly unknownBasis: readonly ExpectedWarning[];
    };
    type ExpectedFrontier =
      | {
          readonly kind: "working";
          readonly nextUncheckedRank: number;
          readonly selectableCityIds: readonly string[];
          readonly phase: "verification_required";
        }
      | {
          readonly kind: "terminal";
          readonly nextUncheckedRank: number;
          readonly selectableCityIds: readonly string[];
          readonly entries: readonly ExpectedEntry[];
          readonly stopCondition: "three_selectable" | "catalog_exhausted" | "live_candidate_limit_reached";
        };
    type ExpectedLiveInput = {
      readonly assessmentAt: string;
      readonly criteria: CityCriteriaSnapshot;
      readonly evaluators: CityCriterionEvaluatorRegistry;
      readonly rank: number;
      readonly authority: ExpectedAuthority;
      readonly persisted?: ExpectedMarker;
    };
    type ExpectedFrontierInput = {
      readonly ranking: ExpectedRanking;
      readonly criteria: CityCriteriaSnapshot;
      readonly evaluators: CityCriterionEvaluatorRegistry;
      readonly predecessorMarkers: null | readonly ExpectedMarker[];
      readonly markerBindings: readonly ExpectedBinding[];
      readonly persisted?: ExpectedFrontier;
    };
    type ExpectedBudget = {
      readonly liveCityCandidateLimit: 10;
      readonly targetSelectableCities: 3;
      readonly rulesVersion: "city-frontier-budget@1";
    };

    expectTypeOf<CityFactLinkRejectionReason>().toEqualTypeOf<ExpectedRejectionReason>();
    expectTypeOf<CityCommittedFactProjection>().toEqualTypeOf<ExpectedFact>();
    expectTypeOf<CityCommittedFactProjectionTuple>().toEqualTypeOf<ExpectedFactTuple>();
    expectTypeOf<CityUnknownWarning>().toEqualTypeOf<ExpectedWarning>();
    expectTypeOf<CityLiveMarker>().toEqualTypeOf<ExpectedMarker>();
    expectTypeOf<CityMarkerAuthorityProjection>().toEqualTypeOf<ExpectedAuthority>();
    expectTypeOf<CityMarkerBinding>().toEqualTypeOf<ExpectedBinding>();
    expectTypeOf<CityFrontierRankingProjection>().toEqualTypeOf<ExpectedRanking>();
    expectTypeOf<CityTerminalEntry>().toEqualTypeOf<ExpectedEntry>();
    expectTypeOf<ReconstructCityLiveMarkerInput>().toEqualTypeOf<ExpectedLiveInput>();
    expectTypeOf<ReconstructCityFrontierInput>().toEqualTypeOf<ExpectedFrontierInput>();
    expectTypeOf<CityFrontierProjection>().toEqualTypeOf<ExpectedFrontier>();
    expectTypeOf<CityFrontierVerificationBudget>().toEqualTypeOf<ExpectedBudget>();
    expectTypeOf<CityMarkerDisposition>().toEqualTypeOf<"selectable" | "excluded">();
    expectTypeOf<CityCommittedMarkerVisualStatus>().toEqualTypeOf<"green" | "yellow" | "red">();
    expectTypeOf<CityCandidateViewStatus>().toEqualTypeOf<"pending" | "green" | "yellow" | "red">();
    expectTypeOf<CityFrontierStopCondition>().toEqualTypeOf<
      "three_selectable" | "catalog_exhausted" | "live_candidate_limit_reached"
    >();
    expectTypeOf<CityAcceptedFactLinkProjection>().toEqualTypeOf<ExpectedAcceptedLink>();
    expectTypeOf<CityReviewedFactLinkProjection>().toEqualTypeOf<ExpectedReviewedLink>();
    expectTypeOf<CityFactLinkProjection>().toEqualTypeOf<ExpectedAcceptedLink | ExpectedReviewedLink>();
  });

  test("derives green, yellow, and red markers from evaluator outcomes instead of claimed display fields", () => {
    // Break caught: trusting marker color/status or treating an unknown/required mismatch as the wrong disposition.
    const cases = [
      {
        cityId: "alpha",
        rank: 1,
        kind: "green" as const,
        status: "selectable" as const,
        visualStatus: "green" as const,
        coverage: "1",
        warnings: [] as readonly CityUnknownWarning[],
        mismatches: [] as readonly CityRequiredMismatch[],
      },
      {
        cityId: "bravo",
        rank: 2,
        kind: "yellow" as const,
        status: "selectable" as const,
        visualStatus: "yellow" as const,
        coverage: "0.6",
        warnings: [{
          criterionId: "fixed_broadband" as const,
          definitionId: "fixed_broadband@1",
          reason: "not_found" as const,
        }],
        mismatches: [] as readonly CityRequiredMismatch[],
      },
      {
        cityId: "charlie",
        rank: 3,
        kind: "red" as const,
        status: "excluded" as const,
        visualStatus: "red" as const,
        coverage: "1",
        warnings: [] as readonly CityUnknownWarning[],
        mismatches: [expectedMismatch()],
      },
    ];

    for (const scenario of cases) {
      const authority = makeAuthority(scenario.cityId, scenario.kind);
      const marker = reconstructCityLiveMarker({
        assessmentAt: ASSESSMENT_AT,
        criteria: makeCriteria(),
        evaluators: makeEvaluators(),
        rank: scenario.rank,
        authority,
      });

      expect(marker).toEqual({
        cityId: scenario.cityId,
        rank: scenario.rank,
        status: scenario.status,
        visualStatus: scenario.visualStatus,
        knowledgeRevisionId: `knowledge:${scenario.cityId}`,
        evidenceSnapshotId: `evidence:${scenario.cityId}`,
        lastCheckedAt: LAST_CHECKED_AT,
        requiredMismatches: scenario.mismatches,
        unknownBasis: scenario.warnings,
        verificationCoverage: scenario.coverage,
        facts: authority.facts,
      });
      expect(marker).not.toBe(authority);
      expect(marker.facts).not.toBe(authority.facts);
      expectRecursivelyFrozen(marker);
      expect(Object.isFrozen(authority)).toBe(false);
    }
  });

  test("omission derives a fresh marker while persisted input is only an exact verified claim", () => {
    // Break caught: returning persisted marker identity or accepting drift in any derived/binding field.
    const authority = makeAuthority("alpha", "green");
    const persisted = markerFor(authority, 1, "green");
    const reconstructed = reconstructCityLiveMarker({
      assessmentAt: ASSESSMENT_AT,
      criteria: makeCriteria(),
      evaluators: makeEvaluators(),
      rank: 1,
      authority,
      persisted,
    });
    expect(reconstructed).toEqual(persisted);
    expect(reconstructed).not.toBe(persisted);
    expect(reconstructed.facts).not.toBe(persisted.facts);

    const mutations: Array<(marker: MutableRecord) => void> = [
      (marker) => { marker.cityId = "forged"; },
      (marker) => { marker.rank = 2; },
      (marker) => { marker.status = "excluded"; },
      (marker) => { marker.visualStatus = "yellow"; },
      (marker) => { marker.knowledgeRevisionId = "knowledge:forged"; },
      (marker) => { marker.evidenceSnapshotId = "evidence:forged"; },
      (marker) => { marker.lastCheckedAt = "2026-01-04T00:00:00.000Z"; },
      (marker) => { marker.requiredMismatches = [expectedMismatch()]; },
      (marker) => { marker.unknownBasis = [{ criterionId: "safety", definitionId: "safety@1", reason: "stale" }]; },
      (marker) => { marker.verificationCoverage = "0"; },
      (marker) => {
        const facts = marker.facts as MutableRecord[];
        facts[0] = { ...facts[0], manualCheckLinks: [reviewedLink("forged", { safety: true })] };
      },
    ];
    for (const mutate of mutations) {
      const claimed = structuredClone(persisted) as unknown as MutableRecord;
      mutate(claimed);
      expect(() => reconstructCityLiveMarker({
        assessmentAt: ASSESSMENT_AT,
        criteria: makeCriteria(),
        evaluators: makeEvaluators(),
        rank: 1,
        authority,
        persisted: claimed as unknown as CityLiveMarker,
      })).toThrow("integrity_mismatch");
    }
  });

  test("rejects impossible green/yellow/red claims", () => {
    // Break caught: validating status fields independently instead of reconstructing their joint truth table.
    const yellowAuthority = makeAuthority("alpha", "yellow");
    const greenAuthority = makeAuthority("alpha", "green");
    const redAuthority = makeAuthority("alpha", "red");
    const impossible = [
      {
        authority: yellowAuthority,
        marker: { ...markerFor(yellowAuthority, 1, "yellow"), visualStatus: "green" as const },
      },
      {
        authority: greenAuthority,
        marker: { ...markerFor(greenAuthority, 1, "green"), visualStatus: "yellow" as const },
      },
      {
        authority: redAuthority,
        marker: { ...markerFor(redAuthority, 1, "red"), requiredMismatches: [] },
      },
    ];
    for (const { authority, marker } of impossible) {
      expect(() => reconstructCityLiveMarker({
        assessmentAt: ASSESSMENT_AT,
        criteria: makeCriteria(),
        evaluators: makeEvaluators(),
        rank: 1,
        authority,
        persisted: marker,
      })).toThrow("integrity_mismatch");
    }
  });

  test("requires canonical time, canonical fact order, and criterion/definition/freshness binding before evaluate", () => {
    // Break caught: invoking an evaluator for a fact bound to the wrong criterion, definition, or freshness policy.
    for (const mutate of [
      (fact: MutableRecord) => { fact.criterionId = "long_term_rent"; },
      (fact: MutableRecord) => { fact.definitionId = "wrong@1"; },
      (fact: MutableRecord) => { fact.freshnessBasis = "wrong@1"; },
    ]) {
      let evaluateCalls = 0;
      const authority = structuredClone(makeAuthority("alpha", "green"));
      mutate(asMutable(authority.facts[0]));
      expect(() => reconstructCityLiveMarker({
        assessmentAt: ASSESSMENT_AT,
        criteria: makeCriteria(),
        evaluators: makeEvaluators(undefined, () => { evaluateCalls += 1; }),
        rank: 1,
        authority,
      })).toThrow("integrity_mismatch");
      expect(evaluateCalls).toBe(0);
    }

    const reversed = structuredClone(makeAuthority("alpha", "green"));
    asMutable(reversed).facts = [...reversed.facts].reverse();
    expect(() => reconstructCityLiveMarker({
      assessmentAt: ASSESSMENT_AT,
      criteria: makeCriteria(),
      evaluators: makeEvaluators(),
      rank: 1,
      authority: reversed,
    })).toThrow("integrity_mismatch");

    for (const [assessmentAt, lastCheckedAt] of [
      ["not-an-instant", LAST_CHECKED_AT],
      [ASSESSMENT_AT, "not-an-instant"],
      ["2026-01-04T00:00:00.000Z", LAST_CHECKED_AT],
    ] as const) {
      const authority = makeAuthority("alpha", "green");
      asMutable(authority).lastCheckedAt = lastCheckedAt;
      expect(() => reconstructCityLiveMarker({
        assessmentAt,
        criteria: makeCriteria(),
        evaluators: makeEvaluators(),
        rank: 1,
        authority,
      })).toThrow("integrity_mismatch");
    }

    let callbackCalls = 0;
    const countedEvaluators = makeEvaluators(
      () => { callbackCalls += 1; },
      () => { callbackCalls += 1; },
    );
    expect(() => reconstructCityLiveMarker({
      assessmentAt: "+010000-01-01T00:00:00.000Z",
      criteria: makeCriteria(),
      evaluators: countedEvaluators,
      rank: 1,
      authority: makeAuthority("alpha", "green"),
    })).toThrow("integrity_mismatch");
    expect(callbackCalls).toBe(0);
  });

  test("owns exact evaluator results synchronously before invoking a later callback", () => {
    // Break caught: retaining the safety evaluation object until a later evaluator can mutate it into a mismatch.
    const base = makeEvaluators();
    const safetyResult: MutableRecord = {
      state: "verified",
      factor: "1",
      targetComparison: "matches",
    };
    const evaluators = {
      ...base,
      safety: {
        ...base.safety,
        evaluate: () => safetyResult as unknown as CityCriterionEvaluation,
      },
      long_term_rent: {
        ...base.long_term_rent,
        evaluate(input: CityCriterionEvaluationInput) {
          safetyResult.factor = "0";
          safetyResult.targetComparison = "does_not_match";
          safetyResult.extra = true;
          return evaluateNormally(input);
        },
      },
    } as CityCriterionEvaluatorRegistry;
    const marker = reconstructCityLiveMarker({
      assessmentAt: ASSESSMENT_AT,
      criteria: makeCriteria(),
      evaluators,
      rank: 1,
      authority: makeAuthority("alpha", "green"),
    });
    expect(marker).toMatchObject({
      status: "selectable",
      visualStatus: "green",
      requiredMismatches: [],
      verificationCoverage: "1",
    });
    expect(safetyResult).toEqual({
      state: "verified",
      factor: "0",
      targetComparison: "does_not_match",
      extra: true,
    });
  });

  test("turns a raw verified fact made unknown by its evaluator yellow and keeps weighted mismatch selectable", () => {
    // Break caught: retaining the raw verified outcome or treating a weighted does_not_match as a required exclusion.
    const base = makeEvaluators();
    const verifiedToUnknown = {
      ...base,
      fixed_broadband: {
        ...base.fixed_broadband,
        evaluate: () => ({
          state: "unknown" as const,
          factor: "0",
          targetComparison: "unknown" as const,
          unknownReason: "not_comparable" as const,
        }),
      },
    } as CityCriterionEvaluatorRegistry;
    const yellow = reconstructCityLiveMarker({
      assessmentAt: ASSESSMENT_AT,
      criteria: makeCriteria(),
      evaluators: verifiedToUnknown,
      rank: 1,
      authority: makeAuthority("alpha", "green"),
    });
    expect(yellow).toMatchObject({
      status: "selectable",
      visualStatus: "yellow",
      requiredMismatches: [],
      unknownBasis: [{
        criterionId: "fixed_broadband",
        definitionId: "fixed_broadband@1",
        reason: "not_comparable",
      }],
      verificationCoverage: "0.6",
    });
    expect(yellow.facts[3].outcome).toEqual({ kind: "unknown", reason: "not_comparable" });

    const weightedMismatch = {
      ...base,
      long_term_rent: {
        ...base.long_term_rent,
        evaluate: () => ({
          state: "verified" as const,
          factor: "1",
          targetComparison: "does_not_match" as const,
        }),
      },
    } as CityCriterionEvaluatorRegistry;
    const green = reconstructCityLiveMarker({
      assessmentAt: ASSESSMENT_AT,
      criteria: makeCriteria(),
      evaluators: weightedMismatch,
      rank: 1,
      authority: makeAuthority("alpha", "green"),
    });
    expect(green).toMatchObject({
      status: "selectable",
      visualStatus: "green",
      requiredMismatches: [],
      unknownBasis: [],
      verificationCoverage: "1",
    });
  });

  test("rejects every descriptor-hostile or impossible evaluator result and thrown callback", () => {
    // Break caught: reading evaluator results through getters/Proxies or accepting a widened/impossible result branch.
    const accessorResult = Object.defineProperty({}, "state", {
      enumerable: true,
      get() { return "verified"; },
    });
    const symbolResult = { state: "verified", factor: "1", targetComparison: "matches" };
    Object.defineProperty(symbolResult, Symbol("hidden"), { value: true });
    const customPrototypeResult = Object.assign(Object.create({ inherited: true }) as object, {
      state: "verified", factor: "1", targetComparison: "matches",
    });
    const malformedResults: readonly unknown[] = [
      accessorResult,
      new Proxy({ state: "verified", factor: "1", targetComparison: "matches" }, {}),
      symbolResult,
      customPrototypeResult,
      Promise.resolve({ state: "verified", factor: "1", targetComparison: "matches" }),
      { state: "verified", factor: "1", targetComparison: "matches", extra: true },
      { state: "verified", factor: "1" },
      { state: "verified", factor: "1", targetComparison: undefined },
      { state: "verified", factor: "-0.1", targetComparison: "matches" },
      { state: "verified", factor: "1.1", targetComparison: "matches" },
      { state: "verified", factor: "01", targetComparison: "matches" },
      { state: "verified", factor: "0.1000000000000000000", targetComparison: "matches" },
      { state: "verified", factor: "0.1234567890123456789", targetComparison: "matches" },
      { state: "verified", factor: "1", targetComparison: "unknown" },
      { state: "verified", factor: "1", targetComparison: "matches", unknownReason: "not_found" },
      { state: "unknown", factor: "0.1", targetComparison: "unknown", unknownReason: "not_found" },
      { state: "unknown", factor: "0", targetComparison: "matches", unknownReason: "not_found" },
      { state: "unknown", factor: "0", targetComparison: "unknown" },
      { state: "unknown", factor: "0", targetComparison: "unknown", unknownReason: undefined },
      { state: "unknown", factor: "0", targetComparison: "unknown", unknownReason: "foreign" },
    ];
    for (const malformedResult of malformedResults) {
      const base = makeEvaluators();
      const evaluators = {
        ...base,
        safety: {
          ...base.safety,
          evaluate: (() => malformedResult) as unknown as CityCriterionEvaluator["evaluate"],
        },
      } as CityCriterionEvaluatorRegistry;
      expect(() => reconstructCityLiveMarker({
        assessmentAt: ASSESSMENT_AT,
        criteria: makeCriteria(),
        evaluators,
        rank: 1,
        authority: makeAuthority("alpha", "green"),
      })).toThrow("integrity_mismatch");
    }

    const unknownAuthority = makeAuthority("alpha", "yellow");
    for (const malformedResult of [
      { state: "verified", factor: "1", targetComparison: "matches" },
      { state: "unknown", factor: "0", targetComparison: "unknown", unknownReason: "stale" },
    ] as const) {
      const base = makeEvaluators();
      const evaluators = {
        ...base,
        fixed_broadband: {
          ...base.fixed_broadband,
          evaluate: () => malformedResult,
        },
      } as CityCriterionEvaluatorRegistry;
      expect(() => reconstructCityLiveMarker({
        assessmentAt: ASSESSMENT_AT,
        criteria: makeCriteria(),
        evaluators,
        rank: 1,
        authority: unknownAuthority,
      })).toThrow("integrity_mismatch");
    }

    const base = makeEvaluators();
    for (const evaluators of [
      {
        ...base,
        safety: { ...base.safety, canonicalizeTarget: () => { throw new Error("poison"); } },
      },
      {
        ...base,
        safety: { ...base.safety, evaluate: () => { throw new Error("poison"); } },
      },
    ] as CityCriterionEvaluatorRegistry[]) {
      expect(() => reconstructCityLiveMarker({
        assessmentAt: ASSESSMENT_AT,
        criteria: makeCriteria(),
        evaluators,
        rank: 1,
        authority: makeAuthority("alpha", "green"),
      })).toThrow("integrity_mismatch");
    }
  });

  test("enforces accepted/reviewed link source laws and preserves exact occurrence order and duplicates", () => {
    // Break caught: deduplicating links, crossing dispositions, or trusting unsupported safety/non-safety metadata.
    const duplicateAccepted = acceptedLink("accepted-duplicate", { safety: true });
    const duplicateReviewed = reviewedLink("reviewed-duplicate", { safety: true });
    const authority = makeAuthority("alpha", "green");
    const facts = structuredClone(authority.facts) as unknown as CityCommittedFactProjection[];
    facts[0] = makeFact("safety", "verified", "1", [
      duplicateAccepted,
      acceptedLink("accepted-middle", { safety: true }),
      structuredClone(duplicateAccepted),
    ], [
      duplicateReviewed,
      reviewedLink("reviewed-middle", { safety: true, resolved: true, referenceYear: 2024 }),
      structuredClone(duplicateReviewed),
    ]);
    facts[1] = makeFact("long_term_rent", "verified", "1", [], [
      reviewedLink("rent-minimal"),
      reviewedLink("rent-optional", { resolved: true, referenceYear: 2023 }),
    ]);
    asMutable(authority).facts = facts;

    const marker = reconstructCityLiveMarker({
      assessmentAt: ASSESSMENT_AT,
      criteria: makeCriteria(),
      evaluators: makeEvaluators(),
      rank: 1,
      authority,
    });
    expect(marker.facts[0].evidenceLinks.map(({ sourceId }: { sourceId: string }) => sourceId)).toEqual([
      "accepted-duplicate", "accepted-middle", "accepted-duplicate",
    ]);
    expect(marker.facts[0].manualCheckLinks.map(({ sourceId }: { sourceId: string }) => sourceId)).toEqual([
      "reviewed-duplicate", "reviewed-middle", "reviewed-duplicate",
    ]);
    expect(marker.facts[1].manualCheckLinks).toEqual([
      {
        sourceId: "rent-minimal",
        disposition: "reviewed_rejected",
        navigationUrl: "https://navigation.example/rent-minimal",
      },
      {
        sourceId: "rent-optional",
        disposition: "reviewed_rejected",
        navigationUrl: "https://navigation.example/rent-optional",
        resolvedEvidenceUrl: "https://evidence.example/rent-optional",
        referenceYear: 2023,
      },
    ]);
    expect(marker.facts[0].evidenceLinks[0]).not.toBe(duplicateAccepted);
    expect(marker.facts[0].manualCheckLinks[0]).not.toBe(duplicateReviewed);

    const invalidMutations: Array<(fact: MutableRecord) => void> = [
      (fact) => {
        fact.evidenceLinks = [{
          sourceId: "missing-resolved",
          disposition: "accepted",
          navigationUrl: "https://navigation.example/missing-resolved",
          referenceYear: 2025,
        }];
      },
      (fact) => {
        fact.evidenceLinks = [{
          ...acceptedLink("accepted-reason", { safety: true }),
          rejectionReason: "stale",
        }];
      },
      (fact) => { fact.evidenceLinks = [acceptedLink("missing-year")]; },
      (fact) => { fact.evidenceLinks = [acceptedLink("wrong-year", { safety: true, referenceYear: 2024 })]; },
      (fact) => {
        fact.manualCheckLinks = [{
          sourceId: "missing-reason",
          disposition: "reviewed_rejected",
          navigationUrl: "https://navigation.example/missing-reason",
        }];
      },
      (fact) => { fact.evidenceLinks = [reviewedLink("wrong-list", { safety: true })]; },
      (fact) => { fact.manualCheckLinks = [acceptedLink("wrong-list", { safety: true })]; },
      (fact) => {
        fact.manualCheckLinks = [{
          ...reviewedLink("foreign-reason", { safety: true }),
          rejectionReason: "foreign",
        }];
      },
      (fact) => { fact.evidenceLinks = [{ ...acceptedLink("extra", { safety: true }), extra: true }]; },
    ];
    for (const mutate of invalidMutations) {
      const invalidAuthority = structuredClone(makeAuthority("alpha", "green"));
      mutate(asMutable(invalidAuthority.facts[0]));
      expect(() => reconstructCityLiveMarker({
        assessmentAt: ASSESSMENT_AT,
        criteria: makeCriteria(),
        evaluators: makeEvaluators(),
        rank: 1,
        authority: invalidAuthority,
      })).toThrow("integrity_mismatch");
    }
    const nonSafetyReason = structuredClone(makeAuthority("alpha", "green"));
    asMutable(nonSafetyReason.facts[1]).manualCheckLinks = [
      { ...reviewedLink("rent-reason"), rejectionReason: "stale" },
    ];
    expect(() => reconstructCityLiveMarker({
      assessmentAt: ASSESSMENT_AT,
      criteria: makeCriteria(),
      evaluators: makeEvaluators(),
      rank: 1,
      authority: nonSafetyReason,
    })).toThrow("integrity_mismatch");

    const rawUnknownWithAccepted = makeAuthority("alpha", "green");
    asMutable(rawUnknownWithAccepted.facts[0]).outcome = { kind: "unknown", reason: "not_found" };
    asMutable(rawUnknownWithAccepted.facts[0]).evidenceLinks = [
      acceptedLink("unknown-accepted", { safety: true }),
    ];
    expect(() => reconstructCityLiveMarker({
      assessmentAt: ASSESSMENT_AT,
      criteria: makeCriteria(),
      evaluators: makeEvaluators(),
      rank: 1,
      authority: rawUnknownWithAccepted,
    })).toThrow("integrity_mismatch");

    const effectiveUnknownWithAccepted = makeAuthority("alpha", "green");
    asMutable(effectiveUnknownWithAccepted.facts[0]).evidenceLinks = [
      acceptedLink("effective-unknown", { safety: true }),
    ];
    const base = makeEvaluators();
    const safetyUnknown = {
      ...base,
      safety: {
        ...base.safety,
        evaluate: () => ({
          state: "unknown" as const,
          factor: "0",
          targetComparison: "unknown" as const,
          unknownReason: "not_comparable" as const,
        }),
      },
    } as CityCriterionEvaluatorRegistry;
    expect(() => reconstructCityLiveMarker({
      assessmentAt: ASSESSMENT_AT,
      criteria: makeCriteria(),
      evaluators: safetyUnknown,
      rank: 1,
      authority: effectiveUnknownWithAccepted,
    })).toThrow("integrity_mismatch");
  });

  test("exact-closes standalone marker roots and evaluator registry descriptors before callbacks", () => {
    // Break caught: the direct marker API accepts an extra/missing/own-undefined key or reads hostile evaluator descriptors.
    const valid: ReconstructCityLiveMarkerInput = {
      assessmentAt: ASSESSMENT_AT,
      criteria: makeCriteria(),
      evaluators: makeEvaluators(),
      rank: 1,
      authority: makeAuthority("alpha", "green"),
    };
    const missing = { ...valid } as MutableRecord;
    delete missing.rank;
    for (const input of [
      { ...valid, applicationRunId: "run:1" },
      { ...valid, persisted: undefined },
      missing,
    ]) {
      expect(() => reconstructCityLiveMarker(input as unknown as ReconstructCityLiveMarkerInput))
        .toThrow("integrity_mismatch");
    }

    let behaviorCalls = 0;
    let descriptorReads = 0;
    const accessorRoot = Object.defineProperty({}, "assessmentAt", {
      enumerable: true,
      get() { throw new Error("root_accessor_must_not_run"); },
    });
    const proxyRoot = new Proxy(valid, {
      ownKeys() { throw new Error("root_proxy_must_not_run"); },
    });
    const registryAccessor = { ...valid } as MutableRecord;
    Object.defineProperty(registryAccessor, "evaluators", {
      enumerable: true,
      get() { throw new Error("registry_accessor_must_not_run"); },
    });
    const registryProxy = {
      ...valid,
      evaluators: new Proxy(makeEvaluators(undefined, () => { behaviorCalls += 1; }), {
        ownKeys() { throw new Error("registry_proxy_must_not_run"); },
      }),
    };
    const counted = makeEvaluators(
      () => { behaviorCalls += 1; },
      () => { behaviorCalls += 1; },
    );
    const evaluatorExtra = {
      ...valid,
      evaluators: {
        ...counted,
        safety: { ...counted.safety, applicationAdapter: "forbidden" },
      },
    };
    const capabilityAccessor = { ...counted.safety } as MutableRecord;
    Object.defineProperty(capabilityAccessor, "canonicalizeTarget", {
      enumerable: true,
      get() {
        descriptorReads += 1;
        return counted.safety.canonicalizeTarget;
      },
    });
    const definitionAccessor = { ...counted.safety } as MutableRecord;
    Object.defineProperty(definitionAccessor, "definition", {
      enumerable: true,
      get() {
        descriptorReads += 1;
        return counted.safety.definition;
      },
    });
    const undefinedCapability = {
      ...counted.safety,
      evaluate: undefined,
    };
    const hostileEvaluatorInputs = [capabilityAccessor, definitionAccessor, undefinedCapability]
      .map((safety) => ({ ...valid, evaluators: { ...counted, safety } }));
    for (const input of [
      accessorRoot,
      proxyRoot,
      registryAccessor,
      registryProxy,
      evaluatorExtra,
      ...hostileEvaluatorInputs,
    ]) {
      expect(() => reconstructCityLiveMarker(input as ReconstructCityLiveMarkerInput))
        .toThrow("integrity_mismatch");
      expect(behaviorCalls).toBe(0);
      expect(descriptorReads).toBe(0);
    }
  });
});

describe("city frontier truth and transition policy", () => {
  test("keeps the zero-marker root pending at the first frozen rank", () => {
    // Break caught: activating a candidate at the root or using a non-one-based next rank.
    expect(reconstructCityFrontier(frontierInput([]))).toEqual({
      kind: "working",
      nextUncheckedRank: 1,
      selectableCityIds: [],
      phase: "verification_required",
    });
  });

  test("terminates an empty frozen catalog at the zero-marker root", () => {
    // Break caught: projecting verification_required when no frozen candidate can ever be activated.
    expect(reconstructCityFrontier(frontierInput([], {
      ranking: rankingFor([]),
      predecessorMarkers: null,
    }))).toEqual({
      kind: "terminal",
      nextUncheckedRank: 1,
      selectableCityIds: [],
      entries: [],
      stopCondition: "catalog_exhausted",
    });
  });

  test("keeps excluded history and activates only its next frozen-rank replacement", () => {
    // Break caught: dropping a red marker from history, counting it as selectable, or skipping its replacement rank.
    const bindings = [
      makeBinding("alpha", 1, "red"),
      makeBinding("bravo", 2, "green"),
    ];
    expect(reconstructCityFrontier(frontierInput(bindings))).toEqual({
      kind: "working",
      nextUncheckedRank: 3,
      selectableCityIds: ["bravo"],
      phase: "verification_required",
    });
  });

  test("uses a yellow marker as a terminal slot and never replaces it", () => {
    // Break caught: replacing an unknown yellow selection instead of stopping at three selectable markers.
    const bindings = [
      makeBinding("alpha", 1, "green"),
      makeBinding("bravo", 2, "yellow"),
      makeBinding("charlie", 3, "green"),
    ];
    expect(reconstructCityFrontier(frontierInput(bindings))).toEqual({
      kind: "terminal",
      nextUncheckedRank: 4,
      selectableCityIds: ["alpha", "bravo", "charlie"],
      entries: [
        terminalEntry(bindings[0]),
        terminalEntry(bindings[1]),
        terminalEntry(bindings[2]),
      ],
      stopCondition: "three_selectable",
    });
  });

  test("stops on catalog exhaustion with exactly zero, one, or two selectable markers", () => {
    // Break caught: requiring three selections after the frozen catalog has no remaining candidate.
    const cases = [
      {
        kinds: ["red", "red"] as const,
        selectableCityIds: [] as readonly string[],
        entries: [] as readonly CityTerminalEntry[],
      },
      {
        kinds: ["red", "green"] as const,
        selectableCityIds: ["bravo"],
        entries: ["bravo"],
      },
      {
        kinds: ["green", "yellow"] as const,
        selectableCityIds: ["alpha", "bravo"],
        entries: ["alpha", "bravo"],
      },
    ];
    for (const scenario of cases) {
      const bindings = scenario.kinds.map((kind, index) =>
        makeBinding(ORDERED_CITY_IDS[index], index + 1, kind));
      const projection = reconstructCityFrontier(frontierInput(bindings, {
        ranking: rankingFor(["alpha", "bravo"]),
      }));
      expect(projection).toEqual({
        kind: "terminal",
        nextUncheckedRank: 3,
        selectableCityIds: scenario.selectableCityIds,
        entries: scenario.entries.map((cityId) => terminalEntry(
          bindings.find(({ marker }) => marker.cityId === cityId)!,
        )),
        stopCondition: "catalog_exhausted",
      });
    }
  });

  test("stops at the tenth live marker with zero, one, or two selectable markers", () => {
    // Break caught: activating rank eleven or failing to apply the ten-candidate limit below the selection target.
    const cases = [
      { selectableRanks: [] as readonly number[], selectableCityIds: [] as readonly string[] },
      { selectableRanks: [4], selectableCityIds: ["delta"] },
      { selectableRanks: [2, 9], selectableCityIds: ["bravo", "india"] },
    ];
    for (const scenario of cases) {
      const bindings = ORDERED_CITY_IDS.slice(0, 10).map((cityId, index) =>
        makeBinding(cityId, index + 1, scenario.selectableRanks.includes(index + 1) ? "green" : "red"));
      const projection = reconstructCityFrontier(frontierInput(bindings));
      expect(projection).toEqual({
        kind: "terminal",
        nextUncheckedRank: 11,
        selectableCityIds: scenario.selectableCityIds,
        entries: scenario.selectableRanks.map((rank) => terminalEntry(bindings[rank - 1])),
        stopCondition: "live_candidate_limit_reached",
      });
    }
  });

  test("applies coincident stop precedence at the third selectable and exact catalog end", () => {
    // Break caught: choosing exhaustion over the selection target, or limit over exhaustion when both occur together.
    const finalThird = [
      makeBinding("alpha", 1, "green"),
      makeBinding("bravo", 2, "yellow"),
      makeBinding("charlie", 3, "green"),
    ];
    expect(reconstructCityFrontier(frontierInput(finalThird, {
      ranking: rankingFor(["alpha", "bravo", "charlie"]),
    }))).toEqual({
      kind: "terminal",
      nextUncheckedRank: 4,
      selectableCityIds: ["alpha", "bravo", "charlie"],
      entries: finalThird.map(terminalEntry),
      stopCondition: "three_selectable",
    });

    const exactTen = ORDERED_CITY_IDS.slice(0, 10).map((cityId, index) =>
      makeBinding(cityId, index + 1, index === 1 || index === 8 ? "green" : "red"));
    expect(reconstructCityFrontier(frontierInput(exactTen, {
      ranking: rankingFor(ORDERED_CITY_IDS.slice(0, 10)),
    }))).toEqual({
      kind: "terminal",
      nextUncheckedRank: 11,
      selectableCityIds: ["bravo", "india"],
      entries: [terminalEntry(exactTen[1]), terminalEntry(exactTen[8])],
      stopCondition: "catalog_exhausted",
    });
  });

  test("never admits a fourth selectable marker or an eleventh live candidate", () => {
    // Break caught: continuing a successor after either terminal condition.
    const fourGreen = ORDERED_CITY_IDS.slice(0, 4).map((cityId, index) =>
      makeBinding(cityId, index + 1, "green"));
    expect(() => reconstructCityFrontier(frontierInput(fourGreen))).toThrow("integrity_mismatch");

    const elevenRed = ORDERED_CITY_IDS.slice(0, 11).map((cityId, index) =>
      makeBinding(cityId, index + 1, "red"));
    expect(() => reconstructCityFrontier(frontierInput(elevenRed))).toThrow("integrity_mismatch");
  });

  test("requires the exact frozen-rank prefix and exactly one marker per successor", () => {
    // Break caught: accepting changed/reordered history, a rank gap, or zero/two additions.
    const first = makeBinding("alpha", 1, "red");
    const second = makeBinding("bravo", 2, "green");
    const third = makeBinding("charlie", 3, "green");
    expect(reconstructCityFrontier(frontierInput([first], { predecessorMarkers: [] }))).toEqual({
      kind: "working",
      nextUncheckedRank: 2,
      selectableCityIds: [],
      phase: "verification_required",
    });

    expect(() => reconstructCityFrontier(frontierInput([first], {
      predecessorMarkers: [structuredClone(first.marker)],
    }))).toThrow("integrity_mismatch");
    expect(() => reconstructCityFrontier(frontierInput([first, second], {
      predecessorMarkers: [],
    }))).toThrow("integrity_mismatch");
    expect(() => reconstructCityFrontier(frontierInput([first, second, third], {
      predecessorMarkers: [structuredClone(second.marker), structuredClone(first.marker)],
    }))).toThrow("integrity_mismatch");
    const changedHistory = structuredClone(first.marker);
    asMutable(changedHistory).verificationCoverage = "0";
    expect(() => reconstructCityFrontier(frontierInput([first, second], {
      predecessorMarkers: [changedHistory],
    }))).toThrow("integrity_mismatch");
    expect(() => reconstructCityFrontier(frontierInput([
      makeBinding("bravo", 1, "green"),
    ], { predecessorMarkers: [] }))).toThrow("integrity_mismatch");
    expect(() => reconstructCityFrontier(frontierInput([
      makeBinding("alpha", 2, "green"),
    ], { predecessorMarkers: [] }))).toThrow("integrity_mismatch");
  });

  test("allows null predecessor only at the zero-marker root and rejects successor-after-terminal", () => {
    // Break caught: treating null as arbitrary history or allowing a terminal prefix to gain a successor.
    expect(() => reconstructCityFrontier(frontierInput([], { predecessorMarkers: [] })))
      .toThrow("integrity_mismatch");
    expect(() => reconstructCityFrontier(frontierInput([
      makeBinding("alpha", 1, "green"),
    ], { predecessorMarkers: null }))).toThrow("integrity_mismatch");

    const bindings = [
      makeBinding("alpha", 1, "green"),
      makeBinding("bravo", 2, "yellow"),
      makeBinding("charlie", 3, "green"),
      makeBinding("delta", 4, "green"),
    ];
    expect(() => reconstructCityFrontier(frontierInput(bindings, {
      predecessorMarkers: bindings.slice(0, 3).map(({ marker }) => structuredClone(marker)),
    }))).toThrow("integrity_mismatch");
  });

  test("derives or exact-verifies the closed persisted working/terminal projection", () => {
    // Break caught: trusting persisted phase/entries/stop fields or accepting working/terminal overlap.
    const binding = makeBinding("alpha", 1, "green");
    const working: CityFrontierProjection = {
      kind: "working",
      nextUncheckedRank: 2,
      selectableCityIds: ["alpha"],
      phase: "verification_required",
    };
    const reconstructed = reconstructCityFrontier(frontierInput([binding], { persisted: working }));
    expect(reconstructed).toEqual(working);
    expect(reconstructed).not.toBe(working);
    expectRecursivelyFrozen(reconstructed);

    const invalidPersisted = [
      { ...working, nextUncheckedRank: 3 },
      { ...working, selectableCityIds: [] },
      { ...working, phase: undefined },
      { ...working, entries: [] },
      { kind: "terminal", nextUncheckedRank: 2, selectableCityIds: ["alpha"], entries: [terminalEntry(binding)], stopCondition: "live_candidate_limit_reached" },
    ];
    for (const persisted of invalidPersisted) {
      expect(() => reconstructCityFrontier(frontierInput([binding], {
        persisted: persisted as unknown as CityFrontierProjection,
      }))).toThrow("integrity_mismatch");
    }

    const tenRed = ORDERED_CITY_IDS.slice(0, 10).map((cityId, index) =>
      makeBinding(cityId, index + 1, "red"));
    const workingAtTen = {
      kind: "working",
      nextUncheckedRank: 11,
      selectableCityIds: [],
      phase: "verification_required",
    } as const;
    expect(() => reconstructCityFrontier(frontierInput(tenRed, { persisted: workingAtTen })))
      .toThrow("integrity_mismatch");

    const twoRed = ORDERED_CITY_IDS.slice(0, 2).map((cityId, index) =>
      makeBinding(cityId, index + 1, "red"));
    const prematureLimit = {
      kind: "terminal",
      nextUncheckedRank: 3,
      selectableCityIds: [],
      entries: [],
      stopCondition: "live_candidate_limit_reached",
    } as const;
    expect(() => reconstructCityFrontier(frontierInput(twoRed, { persisted: prematureLimit })))
      .toThrow("integrity_mismatch");
    expect(() => reconstructCityFrontier(frontierInput(twoRed, {
      ranking: rankingFor(["alpha", "bravo"]),
      persisted: prematureLimit,
    }))).toThrow("integrity_mismatch");

    const terminalBindings = [
      makeBinding("alpha", 1, "green"),
      makeBinding("bravo", 2, "yellow"),
      makeBinding("charlie", 3, "green"),
    ];
    const terminal: CityFrontierProjection = {
      kind: "terminal",
      nextUncheckedRank: 4,
      selectableCityIds: ["alpha", "bravo", "charlie"],
      entries: terminalBindings.map(terminalEntry),
      stopCondition: "three_selectable",
    };
    const replayedTerminal = reconstructCityFrontier(frontierInput(terminalBindings, {
      persisted: terminal,
    }));
    expect(replayedTerminal).toEqual(terminal);
    expect(replayedTerminal).not.toBe(terminal);
    expectRecursivelyFrozen(replayedTerminal);

    const terminalMutations: Array<(projection: MutableRecord) => void> = [
      (projection) => { projection.stopCondition = "catalog_exhausted"; },
      (projection) => {
        const entries = projection.entries as MutableRecord[];
        entries.reverse();
      },
      (projection) => {
        const entries = projection.entries as MutableRecord[];
        entries[1].markerDigest = "f".repeat(64);
      },
      (projection) => {
        const entries = projection.entries as MutableRecord[];
        entries[1].unknownBasis = [];
      },
      (projection) => {
        const entries = projection.entries as MutableRecord[];
        entries[1].knowledgeRevisionId = "knowledge:forged";
      },
      (projection) => { projection.selectableCityIds = ["bravo", "alpha", "charlie"]; },
    ];
    for (const mutate of terminalMutations) {
      const tampered = structuredClone(terminal) as unknown as MutableRecord;
      mutate(tampered);
      expect(() => reconstructCityFrontier(frontierInput(terminalBindings, {
        persisted: tampered as unknown as CityFrontierProjection,
      }))).toThrow("integrity_mismatch");
    }
  });

  test("treats marker digest as raw lowercase 64-hex syntax and never as authenticity proof", () => {
    // Break caught: hashing/signing inside Decision or accepting uppercase, short, or non-hex digest syntax.
    const binding = makeBinding("alpha", 1, "green");
    const arbitraryDigest = "f".repeat(64);
    const projection = reconstructCityFrontier(frontierInput([{
      ...binding,
      markerDigest: arbitraryDigest,
    }]));
    expect(projection).toEqual({
      kind: "working",
      nextUncheckedRank: 2,
      selectableCityIds: ["alpha"],
      phase: "verification_required",
    });

    for (const markerDigest of ["F".repeat(64), "f".repeat(63), `${"f".repeat(63)}g`]) {
      expect(() => reconstructCityFrontier(frontierInput([{
        ...binding,
        markerDigest,
      }]))).toThrow("integrity_mismatch");
    }
  });

  test("reruns every marker reconstruction and never activates a screened city", () => {
    // Break caught: trusting a syntactically valid digest/claimed marker or leaking a screened exclusion into activation.
    let evaluateCalls = 0;
    const binding = makeBinding("alpha", 1, "green");
    const drifted = {
      ...binding,
      marker: { ...binding.marker, visualStatus: "yellow" as const },
    };
    expect(() => reconstructCityFrontier(frontierInput([drifted], {
      evaluators: makeEvaluators(undefined, () => { evaluateCalls += 1; }),
    }))).toThrow("integrity_mismatch");
    expect(evaluateCalls).toBe(4);

    const screened = makeBinding(SCREENED_CITY_ID, 1, "green");
    expect(() => reconstructCityFrontier(frontierInput([screened], { predecessorMarkers: [] })))
      .toThrow("integrity_mismatch");
  });

  test("requires canonical unique/disjoint Ranking ids and the exact frontier/authority data keys", () => {
    // Break caught: accepting ambiguous frozen rank ids or an Application/Research field across the Decision boundary.
    const binding = makeBinding("alpha", 1, "green");
    const invalidRankings: CityFrontierRankingProjection[] = [
      { ...rankingFor(), assessmentAt: "not-an-instant" },
      rankingFor(["alpha", "alpha"]),
      {
        assessmentAt: ASSESSMENT_AT,
        orderedCityIds: ["alpha", "bravo"],
        screenedExclusionCityIds: [SCREENED_CITY_ID, SCREENED_CITY_ID],
      },
      {
        assessmentAt: ASSESSMENT_AT,
        orderedCityIds: ["alpha", SCREENED_CITY_ID],
        screenedExclusionCityIds: [SCREENED_CITY_ID],
      },
    ];
    for (const ranking of invalidRankings) {
      expect(() => reconstructCityFrontier(frontierInput([binding], { ranking })))
        .toThrow("integrity_mismatch");
    }

    const extraInput = { ...frontierInput([binding]), applicationRunId: "run:1" };
    const undefinedInput = { ...frontierInput([binding]), persisted: undefined };
    const missingInput = { ...frontierInput([binding]) } as MutableRecord;
    delete missingInput.ranking;
    for (const input of [extraInput, undefinedInput, missingInput]) {
      expect(() => reconstructCityFrontier(input as unknown as ReconstructCityFrontierInput))
        .toThrow("integrity_mismatch");
    }

    const extraAuthorityBinding = makeBinding("alpha", 1, "green");
    asMutable(extraAuthorityBinding.authority).researchEnvelope = "forbidden";
    const undefinedAuthorityBinding = makeBinding("alpha", 1, "green");
    asMutable(undefinedAuthorityBinding.authority).researchEnvelope = undefined;
    const missingAuthorityBinding = makeBinding("alpha", 1, "green");
    delete asMutable(missingAuthorityBinding.authority).evidenceSnapshotId;
    for (const invalidBinding of [extraAuthorityBinding, undefinedAuthorityBinding, missingAuthorityBinding]) {
      expect(() => reconstructCityFrontier(frontierInput([invalidBinding])))
        .toThrow("integrity_mismatch");
    }
  });

  test("fails closed on descriptor-hostile roots and representative nested branches before evaluate", () => {
    // Break caught: invoking accessors/Proxy traps or behavior callbacks while borrowing structurally invalid graphs.
    const invalidInputs: Array<() => unknown> = [
      () => Object.defineProperty({}, "ranking", {
        enumerable: true,
        get() { throw new Error("accessor_must_not_run"); },
      }),
      () => new Proxy(frontierInput([makeBinding("alpha", 1, "green")]), {
        ownKeys() { throw new Error("proxy_trap_must_not_run"); },
      }),
      () => {
        const input = frontierInput([makeBinding("alpha", 1, "green")]);
        Object.defineProperty(input, Symbol("hidden"), { value: true });
        return input;
      },
      () => Object.assign(Object.create({ inherited: true }) as object,
        frontierInput([makeBinding("alpha", 1, "green")])),
      () => {
        const input = frontierInput([makeBinding("alpha", 1, "green")]);
        const ordered = new Array<string>(2);
        ordered[0] = "alpha";
        asMutable(input.ranking).orderedCityIds = ordered;
        return input;
      },
      () => {
        const input = frontierInput([makeBinding("alpha", 1, "green")]);
        const cyclic = input.ranking as unknown as MutableRecord;
        cyclic.cycle = cyclic;
        return input;
      },
      () => {
        const input = frontierInput([makeBinding("alpha", 1, "green")]);
        const binding = input.markerBindings[0] as unknown as MutableRecord;
        Object.defineProperty(binding, "authority", {
          enumerable: true,
          get() { throw new Error("nested_accessor_must_not_run"); },
        });
        return input;
      },
      () => {
        const input = frontierInput([makeBinding("alpha", 1, "green")]);
        const binding = input.markerBindings[0];
        const facts = binding.authority.facts as unknown as MutableRecord;
        facts[0] = new Proxy(binding.authority.facts[0], {});
        return input;
      },
    ];

    for (const makeInvalidInput of invalidInputs) {
      let evaluateCalls = 0;
      const input = makeInvalidInput() as ReconstructCityFrontierInput;
      if (input !== null && typeof input === "object" && !Array.isArray(input) && !(input instanceof Promise)) {
        const descriptor = Object.getOwnPropertyDescriptor(input, "evaluators");
        if (descriptor !== undefined && "value" in descriptor) {
          descriptor.value = makeEvaluators(undefined, () => { evaluateCalls += 1; });
          Object.defineProperty(input, "evaluators", descriptor);
        }
      }
      expect(() => reconstructCityFrontier(input)).toThrow("integrity_mismatch");
      expect(evaluateCalls).toBe(0);
    }
  });

  test("owns every borrowed graph and evaluator capability before the first hostile callback", () => {
    // Break caught: late-reading Ranking/Criteria/Evidence/history/persisted data or swapped evaluator methods.
    const canonicalReceivers: unknown[] = [];
    const evaluationReceivers: unknown[] = [];
    const retainedInputs: CityCriterionEvaluationInput[] = [];
    const canonicalCalls: CityCriterionId[] = [];
    const evaluateCalls: CityCriterionId[] = [];
    let attacked = false;
    const attack = () => {
      if (attacked) return;
      attacked = true;
      asMutable(borrowedInput.ranking).assessmentAt = "attacked";
      (borrowedInput.ranking.orderedCityIds as string[]).splice(0, ORDERED_CITY_IDS.length, "attacked");
      (borrowedInput.ranking.screenedExclusionCityIds as string[]).push("attacked");
      asMutable(borrowedInput.criteria).id = "attacked";
      asMutable(borrowedInput.criteria.criteria[0]).target = "0";
      const binding = borrowedInput.markerBindings[0];
      asMutable(binding.authority).cityId = "attacked";
      asMutable(binding.authority.facts[0]).definitionId = "attacked";
      asMutable(binding.marker).cityId = "attacked";
      (borrowedInput.predecessorMarkers as CityLiveMarker[]).push(binding.marker);
      asMutable(borrowedInput.persisted).nextUncheckedRank = 99;
      for (const criterionId of CITY_CRITERION_IDS) {
        const evaluator = borrowedEvaluators[criterionId] as unknown as MutableRecord;
        asMutable(evaluator.definition).definitionId = "attacked";
        evaluator.canonicalizeTarget = () => { throw new Error("mutated_callback_must_not_run"); };
        evaluator.evaluate = () => { throw new Error("mutated_callback_must_not_run"); };
        asMutable(borrowedEvaluators)[criterionId] = {
          definition: criterionDefinition(criterionId),
          canonicalizeTarget: () => { throw new Error("swapped_callback_must_not_run"); },
          evaluate: () => { throw new Error("swapped_callback_must_not_run"); },
        };
      }
    };

    const borrowedEvaluators = Object.fromEntries(CITY_CRITERION_IDS.map((criterionId) => [criterionId, {
      definition: criterionDefinition(criterionId),
      canonicalizeTarget(this: unknown, target: unknown) {
        canonicalReceivers.push(this);
        canonicalCalls.push(criterionId);
        attack();
        return String(target);
      },
      evaluate(this: unknown, input: CityCriterionEvaluationInput) {
        evaluationReceivers.push(this);
        evaluateCalls.push(criterionId);
        retainedInputs.push(input);
        attack();
        return evaluateNormally(input);
      },
    }])) as unknown as CityCriterionEvaluatorRegistry;
    const binding = makeBinding("alpha", 1, "green");
    const persisted: CityFrontierProjection = {
      kind: "working",
      nextUncheckedRank: 2,
      selectableCityIds: ["alpha"],
      phase: "verification_required",
    };
    const borrowedInput = frontierInput([binding], { evaluators: borrowedEvaluators, persisted });

    const result = reconstructCityFrontier(borrowedInput);

    expect(result).toEqual({
      kind: "working",
      nextUncheckedRank: 2,
      selectableCityIds: ["alpha"],
      phase: "verification_required",
    });
    expect(canonicalCalls).toEqual([...CITY_CRITERION_IDS]);
    expect(evaluateCalls).toEqual([...CITY_CRITERION_IDS]);
    expect(retainedInputs).toHaveLength(4);
    for (const input of retainedInputs) {
      expect(Object.keys(input).sort()).toEqual(["assessmentAt", "criterion", "fact"]);
      expect(Object.keys(input.fact).sort()).toEqual([
        "criterionId", "definitionId", "denominator", "freshnessBasis",
        "geoScope", "outcome", "referencePeriod", "unit",
      ].sort());
      expect(input.fact).not.toHaveProperty("evidenceLinks");
      expect(input.fact).not.toHaveProperty("manualCheckLinks");
      expectRecursivelyFrozen(input);
    }
    for (const receiver of canonicalReceivers) {
      expect(receiver).toEqual({ capability: "canonicalizeTarget" });
      expect(Object.keys(receiver as object)).toEqual(["capability"]);
      expectRecursivelyFrozen(receiver);
      expect(receiver).not.toBe(borrowedEvaluators);
    }
    for (const receiver of evaluationReceivers) {
      expect(receiver).toEqual({ capability: "evaluate" });
      expect(Object.keys(receiver as object)).toEqual(["capability"]);
      expectRecursivelyFrozen(receiver);
      expect(receiver).not.toBe(borrowedEvaluators);
    }
    expect(new Set(canonicalReceivers).size).toBe(4);
    expect(new Set(evaluationReceivers).size).toBe(4);
    expect(new Set([...canonicalReceivers, ...evaluationReceivers]).size).toBe(8);
    expect(borrowedInput.ranking.assessmentAt).toBe("attacked");
    expect(borrowedInput.ranking.orderedCityIds).toEqual(["attacked"]);
    expect(borrowedInput.markerBindings[0].authority.cityId).toBe("attacked");
    expect(borrowedInput.predecessorMarkers).toHaveLength(1);
    expect(asMutable(borrowedInput.persisted).nextUncheckedRank).toBe(99);
    expect(Object.isFrozen(borrowedInput)).toBe(false);
    expect(Object.isFrozen(borrowedInput.markerBindings[0].authority)).toBe(false);
    expect(Reflect.set(retainedInputs[0].fact as object, "criterionId", "attacked")).toBe(false);
    expect(result).toEqual({
      kind: "working",
      nextUncheckedRank: 2,
      selectableCityIds: ["alpha"],
      phase: "verification_required",
    });
    expectRecursivelyFrozen(result);
  });
});
