import { describe, expect, expectTypeOf, test } from "vitest";

import {
  CITY_CRITERION_IDS,
  type CityCriteriaSnapshot,
  type CityCriterionEvaluation,
  type CityCriterionEvaluationInput,
  type CityCriterionEvaluatorRegistry,
  type CityCriterionId,
  type CityRankingFactInput,
} from "../../src/decision/city-criteria";
import {
  type CityAcceptedFactLinkProjection,
  type CityCommittedFactProjection,
  type CityCommittedFactProjectionTuple,
  type CityFrontierProjection,
  type CityLiveMarker,
  type CityMarkerAuthorityProjection,
  type CityMarkerBinding,
  type CityReviewedFactLinkProjection,
  type CityTerminalEntry,
  type ReconstructCityFrontierInput,
} from "../../src/decision/city-frontier-policy";
import {
  reconstructCitySelection,
  type CitySelectionProjection,
  type CitySelectionRequestProjection,
  type ReconstructCitySelectionInput,
} from "../../src/decision/city-selection";

const ASSESSMENT_AT = "2026-01-02T00:00:00.000Z";
const LAST_CHECKED_AT = "2026-01-03T00:00:00.000Z";
const CITY_IDS = ["alpha", "bravo", "charlie", "delta"] as const;

type MutableRecord = Record<string, unknown>;
type MarkerKind = "green" | "yellow";

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
  return { state: "verified", factor: "1", targetComparison: "matches" };
}

function makeEvaluators(
  onEvaluate?: () => void,
  onCanonicalize?: () => void,
): CityCriterionEvaluatorRegistry {
  return Object.fromEntries(CITY_CRITERION_IDS.map((criterionId) => [criterionId, {
    definition: criterionDefinition(criterionId),
    canonicalizeTarget(target: unknown) {
      onCanonicalize?.();
      return String(target);
    },
    evaluate(input: CityCriterionEvaluationInput) {
      onEvaluate?.();
      return evaluateNormally(input);
    },
  }])) as unknown as CityCriterionEvaluatorRegistry;
}

function makeCriteria(): CityCriteriaSnapshot {
  return {
    schemaVersion: "city-criteria@1",
    id: "criteria:1",
    profileSnapshotId: "profile:1",
    preferenceProfileSnapshotId: "preferences:1",
    criteria: CITY_CRITERION_IDS.map((criterionId, index) => ({
      criterionId,
      definitionId: `${criterionId}@1`,
      mode: criterionId === "safety" ? "required" as const : "weighted" as const,
      importance: (index + 1) as 1 | 2 | 3 | 4,
      target: "1",
    })) as unknown as CityCriteriaSnapshot["criteria"],
    rulesVersion: "city-criteria@1",
    confirmedAt: "2026-01-01T00:00:00.000Z",
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
  manualCheckLinks: readonly CityReviewedFactLinkProjection[] = [],
  evidenceLinks: readonly CityAcceptedFactLinkProjection[] = [],
): CityCommittedFactProjection {
  const outcome: CityRankingFactInput["outcome"] = kind === "unknown"
    ? { kind: "unknown", reason: "not_found" }
    : { kind: "verified", basis: { kind: "canonical_scalar", value: "1" } };
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
  if (kind === "green") {
    return CITY_CRITERION_IDS.map((criterionId) => makeFact(criterionId)) as unknown as
      CityCommittedFactProjectionTuple;
  }
  const duplicate = reviewedLink("safety-duplicate", { safety: true });
  return [
    makeFact("safety", "verified", [
      duplicate,
      reviewedLink("safety-middle", { safety: true, resolved: true, referenceYear: 2024 }),
      structuredClone(duplicate),
    ]),
    makeFact("long_term_rent", "verified", [reviewedLink("rent-source")]),
    makeFact("urban_transit", "verified", [
      reviewedLink("transit-source", { resolved: true, referenceYear: 2023 }),
    ]),
    makeFact("fixed_broadband", "unknown", [reviewedLink("broadband-source")]),
  ];
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

function makeMarker(
  authority: CityMarkerAuthorityProjection,
  rank: number,
  kind: MarkerKind,
): CityLiveMarker {
  return {
    cityId: authority.cityId,
    rank,
    status: "selectable",
    visualStatus: kind,
    knowledgeRevisionId: authority.knowledgeRevisionId,
    evidenceSnapshotId: authority.evidenceSnapshotId,
    lastCheckedAt: authority.lastCheckedAt,
    requiredMismatches: [],
    unknownBasis: kind === "yellow" ? [{
      criterionId: "fixed_broadband",
      definitionId: "fixed_broadband@1",
      reason: "not_found",
    }] : [],
    verificationCoverage: kind === "yellow" ? "0.6" : "1",
    facts: structuredClone(authority.facts) as CityCommittedFactProjectionTuple,
  };
}

function makeBinding(cityId: string, rank: number, kind: MarkerKind): CityMarkerBinding {
  const authority = makeAuthority(cityId, kind);
  return {
    marker: makeMarker(authority, rank, kind),
    markerDigest: rank.toString(16).repeat(64),
    authority,
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

function makeTerminalFrontier(
  evaluators: CityCriterionEvaluatorRegistry = makeEvaluators(),
): ReconstructCityFrontierInput {
  const bindings = [
    makeBinding("alpha", 1, "green"),
    makeBinding("bravo", 2, "yellow"),
    makeBinding("charlie", 3, "green"),
  ];
  const persisted: CityFrontierProjection = {
    kind: "terminal",
    nextUncheckedRank: 4,
    selectableCityIds: ["alpha", "bravo", "charlie"],
    entries: bindings.map(terminalEntry),
    stopCondition: "three_selectable",
  };
  return {
    ranking: {
      assessmentAt: ASSESSMENT_AT,
      orderedCityIds: [...CITY_IDS],
      screenedExclusionCityIds: ["screened"],
    },
    criteria: makeCriteria(),
    evaluators,
    predecessorMarkers: bindings.slice(0, 2).map(({ marker }) => structuredClone(marker)),
    markerBindings: bindings,
    persisted,
  };
}

function expectedReviewedLinks(): readonly CityReviewedFactLinkProjection[] {
  return [
    {
      sourceId: "safety-duplicate",
      disposition: "reviewed_rejected",
      navigationUrl: "https://navigation.example/safety-duplicate",
      rejectionReason: "stale",
    },
    {
      sourceId: "safety-middle",
      disposition: "reviewed_rejected",
      navigationUrl: "https://navigation.example/safety-middle",
      resolvedEvidenceUrl: "https://evidence.example/safety-middle",
      referenceYear: 2024,
      rejectionReason: "stale",
    },
    {
      sourceId: "safety-duplicate",
      disposition: "reviewed_rejected",
      navigationUrl: "https://navigation.example/safety-duplicate",
      rejectionReason: "stale",
    },
    {
      sourceId: "rent-source",
      disposition: "reviewed_rejected",
      navigationUrl: "https://navigation.example/rent-source",
    },
    {
      sourceId: "transit-source",
      disposition: "reviewed_rejected",
      navigationUrl: "https://navigation.example/transit-source",
      resolvedEvidenceUrl: "https://evidence.example/transit-source",
      referenceYear: 2023,
    },
    {
      sourceId: "broadband-source",
      disposition: "reviewed_rejected",
      navigationUrl: "https://navigation.example/broadband-source",
    },
  ];
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

describe("city selection policy", () => {
  test("exports the exact closed request, input, and output contracts", () => {
    // Break caught: admitting a client-supplied marker/frontier binding or widening the warning token.
    type ExpectedRequest = {
      readonly cityId: string;
      readonly warningCopyVersion?: "city-unknown-risk@1";
    };
    type ExpectedWarning = {
      readonly criterionId: "safety" | "long_term_rent" | "urban_transit" | "fixed_broadband";
      readonly definitionId: string;
      readonly reason: "not_found" | "stale" | "conflict" | "not_comparable" | "source_unavailable";
    };
    type ExpectedTerminalEntry = {
      readonly cityId: string;
      readonly rank: number;
      readonly markerDigest: string;
      readonly knowledgeRevisionId: string;
      readonly evidenceSnapshotId: string;
      readonly unknownBasis: readonly ExpectedWarning[];
    };
    type ExpectedReviewedLink = {
      readonly sourceId: string;
      readonly disposition: "reviewed_rejected";
      readonly navigationUrl: string;
      readonly resolvedEvidenceUrl?: string;
      readonly referenceYear?: number;
      readonly rejectionReason?:
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
    };
    type ExpectedInput = {
      readonly frontier: ReconstructCityFrontierInput;
      readonly request: ExpectedRequest;
    };
    type ExpectedProjection = {
      readonly entry: ExpectedTerminalEntry;
      readonly reviewedSourceLinks: readonly ExpectedReviewedLink[];
      readonly warningCopyVersion?: "city-unknown-risk@1";
    };
    expectTypeOf<CitySelectionRequestProjection>().toEqualTypeOf<ExpectedRequest>();
    expectTypeOf<ReconstructCitySelectionInput>().toEqualTypeOf<ExpectedInput>();
    expectTypeOf<CitySelectionProjection>().toEqualTypeOf<ExpectedProjection>();
  });

  test("selects a green terminal entry without a warning token and returns fresh frozen data", () => {
    // Break caught: requiring/returning unknown-risk copy for a fully verified green marker or aliasing frontier data.
    const frontier = makeTerminalFrontier();
    const selected = reconstructCitySelection({
      frontier,
      request: { cityId: "alpha" },
    });
    expect(selected).toEqual({
      entry: {
        cityId: "alpha",
        rank: 1,
        markerDigest: "1".repeat(64),
        knowledgeRevisionId: "knowledge:alpha",
        evidenceSnapshotId: "evidence:alpha",
        unknownBasis: [],
      },
      reviewedSourceLinks: [],
    });
    expect(Object.keys(selected).sort()).toEqual(["entry", "reviewedSourceLinks"]);
    expect(selected.entry).not.toBe((frontier.persisted as Extract<CityFrontierProjection, { kind: "terminal" }>).entries[0]);
    expectRecursivelyFrozen(selected);
  });

  test("selects yellow only with the exact copy token and preserves reviewed-link fact/order/duplicates", () => {
    // Break caught: deduplicating reviewed sources, reordering facts, or accepting yellow without explicit risk copy.
    const frontier = makeTerminalFrontier();
    const selected = reconstructCitySelection({
      frontier,
      request: { cityId: "bravo", warningCopyVersion: "city-unknown-risk@1" },
    });
    expect(selected).toEqual({
      entry: {
        cityId: "bravo",
        rank: 2,
        markerDigest: "2".repeat(64),
        knowledgeRevisionId: "knowledge:bravo",
        evidenceSnapshotId: "evidence:bravo",
        unknownBasis: [{
          criterionId: "fixed_broadband",
          definitionId: "fixed_broadband@1",
          reason: "not_found",
        }],
      },
      reviewedSourceLinks: expectedReviewedLinks(),
      warningCopyVersion: "city-unknown-risk@1",
    });
    const sourceIds = selected.reviewedSourceLinks.map(
      ({ sourceId }: { sourceId: string }) => sourceId,
    );
    expect(sourceIds).toEqual([
      "safety-duplicate", "safety-middle", "safety-duplicate",
      "rent-source", "transit-source", "broadband-source",
    ]);
    expect(selected.reviewedSourceLinks[0]).not.toBe(
      frontier.markerBindings[1].marker.facts[0].manualCheckLinks[0],
    );
    expectRecursivelyFrozen(selected);

    asMutable(frontier.markerBindings[1].authority.facts[0].manualCheckLinks[0]).sourceId = "attacked";
    asMutable((frontier.persisted as Extract<CityFrontierProjection, { kind: "terminal" }>).entries[1]).cityId = "attacked";
    expect(selected).toEqual({
      entry: {
        cityId: "bravo",
        rank: 2,
        markerDigest: "2".repeat(64),
        knowledgeRevisionId: "knowledge:bravo",
        evidenceSnapshotId: "evidence:bravo",
        unknownBasis: [{
          criterionId: "fixed_broadband",
          definitionId: "fixed_broadband@1",
          reason: "not_found",
        }],
      },
      reviewedSourceLinks: expectedReviewedLinks(),
      warningCopyVersion: "city-unknown-risk@1",
    });
  });

  test("rejects a green warning token and requires the exact yellow warning token", () => {
    // Break caught: treating warning copy as optional client decoration instead of server-derived marker basis.
    const invalidRequests = [
      { cityId: "alpha", warningCopyVersion: "city-unknown-risk@1" },
      { cityId: "bravo" },
      { cityId: "bravo", warningCopyVersion: "wrong@1" },
    ];
    for (const request of invalidRequests) {
      expect(() => reconstructCitySelection({
        frontier: makeTerminalFrontier(),
        request: request as CitySelectionRequestProjection,
      })).toThrow("integrity_mismatch");
    }
  });

  test("requires a verified terminal frontier and an exact terminal entry", () => {
    // Break caught: selecting from working/derived-only frontier state or from an id absent from terminal entries.
    const noPersisted = makeTerminalFrontier();
    delete (noPersisted as unknown as MutableRecord).persisted;
    expect(() => reconstructCitySelection({
      frontier: noPersisted,
      request: { cityId: "alpha" },
    })).toThrow("integrity_mismatch");

    const working = makeTerminalFrontier();
    (working as unknown as MutableRecord).persisted = {
      kind: "working",
      nextUncheckedRank: 4,
      selectableCityIds: ["alpha", "bravo", "charlie"],
      phase: "verification_required",
    };
    expect(() => reconstructCitySelection({
      frontier: working,
      request: { cityId: "alpha" },
    })).toThrow("integrity_mismatch");

    expect(() => reconstructCitySelection({
      frontier: makeTerminalFrontier(),
      request: { cityId: "delta" },
    })).toThrow("integrity_mismatch");
    expect(() => reconstructCitySelection({
      frontier: makeTerminalFrontier(),
      request: { cityId: "screened" },
    })).toThrow("integrity_mismatch");
  });

  test("exact-closes the selection root and rejects every client-supplied authority field", () => {
    // Break caught: letting terminal/digest/facts/parent/basis/link/command/run claims enter the selection request.
    const forbiddenKeys = [
      "terminal", "markerDigest", "facts", "parent", "basis", "link", "command", "run",
    ] as const;
    for (const forbiddenKey of forbiddenKeys) {
      expect(() => reconstructCitySelection({
        frontier: makeTerminalFrontier(),
        request: { cityId: "alpha", [forbiddenKey]: "forged" },
      } as unknown as ReconstructCitySelectionInput)).toThrow("integrity_mismatch");
    }

    const extraRoot = {
      frontier: makeTerminalFrontier(),
      request: { cityId: "alpha" },
      commandId: "forged",
    };
    const undefinedRoot = {
      frontier: makeTerminalFrontier(),
      request: { cityId: "alpha" },
      commandId: undefined,
    };
    const missingRoot = { frontier: makeTerminalFrontier() };
    const undefinedRequest = {
      frontier: makeTerminalFrontier(),
      request: { cityId: "alpha", warningCopyVersion: undefined },
    };
    for (const input of [extraRoot, undefinedRoot, missingRoot, undefinedRequest]) {
      expect(() => reconstructCitySelection(input as unknown as ReconstructCitySelectionInput))
        .toThrow("integrity_mismatch");
    }
  });

  test("fails closed on descriptor-hostile selection roots and nested requests", () => {
    // Break caught: executing frontier policy after an accessor, Proxy, symbol, or custom-prototype request crossed the boundary.
    const accessorRoot = Object.defineProperty({}, "frontier", {
      enumerable: true,
      get() { throw new Error("accessor_must_not_run"); },
    });
    const proxyRoot = new Proxy({
      frontier: makeTerminalFrontier(),
      request: { cityId: "alpha" },
    }, {
      ownKeys() { throw new Error("proxy_trap_must_not_run"); },
    });
    const symbolRequest = { cityId: "alpha" };
    Object.defineProperty(symbolRequest, Symbol("hidden"), { value: true });
    const customRequest = Object.assign(Object.create({ inherited: true }) as object, {
      cityId: "alpha",
    });
    const accessorRequest = Object.defineProperty({}, "cityId", {
      enumerable: true,
      get() { throw new Error("nested_accessor_must_not_run"); },
    });
    let evaluatorCalls = 0;
    const countedFrontier = () => makeTerminalFrontier(makeEvaluators(
      () => { evaluatorCalls += 1; },
      () => { evaluatorCalls += 1; },
    ));
    for (const input of [
      accessorRoot,
      proxyRoot,
      { frontier: countedFrontier(), request: symbolRequest },
      { frontier: countedFrontier(), request: customRequest },
      { frontier: countedFrontier(), request: accessorRequest },
    ]) {
      expect(() => reconstructCitySelection(input as ReconstructCitySelectionInput))
        .toThrow("integrity_mismatch");
      expect(evaluatorCalls).toBe(0);
    }
  });

  test("owns the exact request before frontier evaluator callbacks can mutate it", () => {
    // Break caught: exact-checking or reading the borrowed request only after frontier replay invokes behavior.
    let attacked = false;
    const evaluators = makeEvaluators(undefined, () => {
      if (attacked) return;
      attacked = true;
      const request = borrowedInput.request as unknown as MutableRecord;
      request.cityId = "bravo";
      request.warningCopyVersion = "city-unknown-risk@1";
    });
    const borrowedInput: ReconstructCitySelectionInput = {
      frontier: makeTerminalFrontier(evaluators),
      request: { cityId: "alpha" },
    };

    const selected = reconstructCitySelection(borrowedInput);

    expect(selected).toEqual({
      entry: {
        cityId: "alpha",
        rank: 1,
        markerDigest: "1".repeat(64),
        knowledgeRevisionId: "knowledge:alpha",
        evidenceSnapshotId: "evidence:alpha",
        unknownBasis: [],
      },
      reviewedSourceLinks: [],
    });
    expect(borrowedInput.request).toEqual({
      cityId: "bravo",
      warningCopyVersion: "city-unknown-risk@1",
    });
    expect(Object.isFrozen(borrowedInput.request)).toBe(false);
  });

  test("reruns the complete frontier and rejects stale marker or terminal claims", () => {
    // Break caught: selecting directly from persisted entries without replaying all three authority-bound markers.
    let evaluateCalls = 0;
    const frontier = makeTerminalFrontier(makeEvaluators(() => { evaluateCalls += 1; }));
    const selected = reconstructCitySelection({
      frontier,
      request: { cityId: "alpha" },
    });
    expect(selected.entry.cityId).toBe("alpha");
    expect(evaluateCalls).toBe(12);

    const staleMarker = makeTerminalFrontier();
    const second = staleMarker.markerBindings[1];
    asMutable(second.authority.facts[3]).outcome = {
      kind: "verified",
      basis: { kind: "canonical_scalar", value: "1" },
    };
    expect(() => reconstructCitySelection({
      frontier: staleMarker,
      request: { cityId: "bravo", warningCopyVersion: "city-unknown-risk@1" },
    })).toThrow("integrity_mismatch");

    const staleTerminal = makeTerminalFrontier();
    const terminal = staleTerminal.persisted as Extract<CityFrontierProjection, { kind: "terminal" }>;
    asMutable(terminal.entries[1]).markerDigest = "f".repeat(64);
    expect(() => reconstructCitySelection({
      frontier: staleTerminal,
      request: { cityId: "bravo", warningCopyVersion: "city-unknown-risk@1" },
    })).toThrow("integrity_mismatch");
  });
});
