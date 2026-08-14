import { describe, expect, test } from "vitest";

import { buildCityCatalogRevision, buildCityRegistryRevision } from "../../src/decision/city-catalog";
import { confirmCityCriteria, type CityCriterionEvaluatorRegistry } from "../../src/decision/city-criteria";
import { rankCities, reconstructCityRanking } from "../../src/decision/city-ranker";
import type { CityDecisionIntegrity } from "../../src/decision/city-integrity";

const integrity: CityDecisionIntegrity = { canonical: JSON.stringify, hash: (value) => value };
const ids = ["safety", "long_term_rent", "urban_transit", "fixed_broadband"] as const;
const evaluators = Object.fromEntries(ids.map((criterionId) => [criterionId, {
  definition: { criterionId, definitionId: `${criterionId}@1`, direction: "at_least" as const, unit: "unit", denominator: "den", compatibleGeoScopes: ["municipality"], freshnessPolicyVersion: "fresh@1", evaluatorVersion: "eval@1" },
  canonicalizeTarget: (target: unknown) => String(target),
  evaluate: ({ fact }: { fact: { outcome: { kind: string; reason?: "not_found"; basis?: { value?: string } }; criterionId: string } }) => fact.outcome.kind === "unknown"
    ? { state: "unknown" as const, factor: "0", targetComparison: "unknown" as const, unknownReason: fact.outcome.reason! }
    : { state: "verified" as const, factor: fact.outcome.basis?.value ?? "1", targetComparison: "matches" as const },
}])) as unknown as CityCriterionEvaluatorRegistry;
const criteria = confirmCityCriteria({ draft: ids.map((criterionId, index) => ({ criterionId, definitionId: `${criterionId}@1`, mode: criterionId === "safety" ? "required" : "weighted", importance: index + 1, target: "1" })), profileSnapshotId: "profile", preferenceProfileSnapshotId: "preferences", confirmedAt: "2026-01-01T00:00:00.000Z" }, evaluators, integrity);
const registry = buildCityRegistryRevision({ packageId: "p", packageSchemaVersion: "p@1", countryCode: "ZZ", evidenceSnapshotId: "e", createdAt: "2026-01-01T00:00:00.000Z", entries: ["b", "a"].map((cityId) => ({ cityId, countryCode: "ZZ", officialName: cityId, coordinate: { lat: 0, lng: 0 }, administrativeType: "m", administrativeTerritory: "t", capitalRoles: [], evidenceReferenceIds: [cityId] })) }, integrity);
const catalog = buildCityCatalogRevision({ registry, evidenceSnapshotId: "e", populationDefinition: { definitionId: "d", geoScope: "municipality", unit: "people" }, candidateBasis: ["a", "b"].map((cityId) => ({ cityId, comparablePopulation: { kind: "verified" as const, value: "1", referencePeriod: "2025" } })), coverage: { status: "complete" }, createdAt: "2026-01-01T00:00:00.000Z" }, integrity);
function facts(cityId: string, safetyFactor = "0.5", otherFactor = "1") {
  return ids.map((criterionId) => ({
    criterionId,
    definitionId: `${criterionId}@1`,
    geoScope: "municipality",
    referencePeriod: "2025",
    freshnessBasis: "fresh@1",
    unit: "unit",
    denominator: "den",
    outcome: { kind: "verified" as const, basis: { kind: "canonical_scalar" as const, value: criterionId === "safety" ? safetyFactor : otherFactor } },
  })) as never;
}

describe("city ranker", () => {
  test("ranks exact full-denominator scores, retains unknowns, and excludes only required verified mismatches", () => {
    // Break caught: dropping unknown denominator, excluding a required unknown, or omitting excluded factors.
    const ranking = rankCities({ assessmentAt: "2026-01-02T00:00:00.000Z", registry, catalog, criteria, evaluators, knowledge: [
      { cityId: "a", knowledgeRevisionId: null, facts: [] },
      { cityId: "b", knowledgeRevisionId: "kb", facts: facts("b") },
    ] });
    expect(ranking.ordered.map(({ cityId, score, coverage, rank }) => ({ cityId, score, coverage, rank }))).toEqual([
      { cityId: "b", score: "0.95", coverage: "1", rank: 1 },
      { cityId: "a", score: "0", coverage: "0", rank: 2 },
    ]);
    expect(ranking.ordered[1]?.factors.map(({ unknownReason }) => unknownReason)).toEqual([
      "no_knowledge_revision", "no_knowledge_revision", "no_knowledge_revision", "no_knowledge_revision",
    ]);
    expect(Object.isFrozen(ranking.ordered[0]?.factors)).toBe(true);
    expect(() => reconstructCityRanking({ assessmentAt: "2026-01-02T00:00:00.000Z", registry, catalog, criteria, evaluators, knowledge: [
      { cityId: "a", knowledgeRevisionId: null, facts: [] }, { cityId: "b", knowledgeRevisionId: "kb", facts: facts("b") },
    ], ranking: { ...ranking, ordered: [...ranking.ordered].reverse() } })).toThrow("integrity_mismatch");
  });

  test("rounds persisted scores half-even with carry while retaining exact ordering", () => {
    // Break caught: serializing rational scores with half-up rounding or losing a carry into the integer part.
    const input = { assessmentAt: "2026-01-02T00:00:00.000Z", registry, catalog, criteria, evaluators, knowledge: [
      { cityId: "a", knowledgeRevisionId: "ka", facts: facts("a", "0.999999999999999995") },
      { cityId: "b", knowledgeRevisionId: "kb", facts: facts("b", "0.000000000000000005", "0") },
    ] } as const;
    expect(rankCities(input).ordered.map(({ cityId, score }) => ({ cityId, score }))).toEqual([
      { cityId: "a", score: "1" }, { cityId: "b", score: "0" },
    ]);
    const equalDisplay = rankCities({ ...input, knowledge: [
      { cityId: "a", knowledgeRevisionId: "ka", facts: facts("a", "0.000000000000000001", "0") },
      { cityId: "b", knowledgeRevisionId: "kb", facts: facts("b", "0.000000000000000002", "0") },
    ] });
    expect(equalDisplay.ordered.map(({ cityId, score }) => ({ cityId, score }))).toEqual([
      { cityId: "b", score: "0" }, { cityId: "a", score: "0" },
    ]);
  });

  test("fails closed on evaluator contracts and preserves caller-owned fact basis", () => {
    // Break caught: accepting an empty non-null Knowledge revision id.
    const knowledge = [{ cityId: "a", knowledgeRevisionId: "ka", facts: facts("a") },
      { cityId: "b", knowledgeRevisionId: "", facts: facts("b") }] as const;
    expect(() => rankCities({ assessmentAt: "2026-01-02T00:00:00.000Z", registry, catalog, criteria, evaluators, knowledge }))
      .toThrow("integrity_mismatch");
  });

  test("rejects evaluator outcomes that cannot describe verified or unknown facts", () => {
    // Break caught: trusting evaluator output with contradictory state, comparison, or reason.
    const malformed = {
      ...evaluators,
      safety: {
        ...evaluators.safety,
        evaluate: () => ({ state: "unknown" as const, factor: "0", targetComparison: "matches" as const }),
      },
    } as CityCriterionEvaluatorRegistry;
    expect(() => rankCities({ assessmentAt: "2026-01-02T00:00:00.000Z", registry, catalog, criteria, evaluators: malformed, knowledge: [
      { cityId: "a", knowledgeRevisionId: "ka", facts: facts("a") },
      { cityId: "b", knowledgeRevisionId: "kb", facts: facts("b") },
    ] })).toThrow("integrity_mismatch");
  });

  test("clones a required mismatch basis without freezing caller-owned Knowledge", () => {
    // Break caught: deep-freezing or retaining a mutable basis object supplied by Knowledge.
    const basis = { kind: "canonical_scalar" as const, value: "1" };
    const mismatchFacts = facts("a") as unknown as Array<Record<string, unknown>>;
    mismatchFacts[0] = { ...mismatchFacts[0], outcome: { kind: "verified", basis } };
    const mismatchEvaluators = {
      ...evaluators,
      safety: {
        ...evaluators.safety,
        evaluate: () => ({ state: "verified" as const, factor: "1", targetComparison: "does_not_match" as const }),
      },
    } as CityCriterionEvaluatorRegistry;
    const knowledge = [
      { cityId: "a", knowledgeRevisionId: "ka", facts: mismatchFacts },
      { cityId: "b", knowledgeRevisionId: "kb", facts: facts("b") },
    ] as unknown as readonly import("../../src/decision/city-ranker").CityKnowledgeRankingProjection[];
    const ranking = rankCities({ assessmentAt: "2026-01-02T00:00:00.000Z", registry, catalog, criteria, evaluators: mismatchEvaluators, knowledge });
    const outputBasis = ranking.screenedExclusions[0]?.requiredMismatches[0]?.verifiedBasis;
    expect(Object.isFrozen(basis)).toBe(false);
    expect(outputBasis).not.toBe(basis);
    basis.value = "2";
    expect(outputBasis).toEqual({ kind: "canonical_scalar", value: "1" });
    expect(ranking.screenedExclusions[0]?.factors).toHaveLength(4);
    expect(ranking.screenedExclusions[0]?.requiredMismatches).toEqual([{
      criterionId: "safety", definitionId: "safety@1", target: "1", verifiedBasis: { kind: "canonical_scalar", value: "1" }, evaluatorVersion: "eval@1",
    }]);
  });

  test("keeps weighted mismatches, normalizes Knowledge order, and ranks by exact score then coverage then ordinal city id", () => {
    // Break caught: treating weighted mismatches as exclusions, using input order, rounded strings, or population as a tie-break.
    const weightedMismatch = {
      ...evaluators,
      long_term_rent: {
        ...evaluators.long_term_rent,
        evaluate: ({ fact }: { fact: { outcome: { kind: string; basis?: { value?: string } } } }) => ({
          state: "verified" as const, factor: fact.outcome.basis?.value ?? "1", targetComparison: "does_not_match" as const,
        }),
      },
    } as CityCriterionEvaluatorRegistry;
    const input = { assessmentAt: "2026-01-02T00:00:00.000Z", registry, catalog, criteria, evaluators: weightedMismatch, knowledge: [
      { cityId: "b", knowledgeRevisionId: "kb", facts: facts("b", "1", "0") },
      { cityId: "a", knowledgeRevisionId: "ka", facts: facts("a", "1", "0") },
    ] } as const;
    const ranking = rankCities(input);
    expect(ranking.ordered.map(({ cityId, rank, score, coverage }) => ({ cityId, rank, score, coverage }))).toEqual([
      { cityId: "a", rank: 1, score: "0.1", coverage: "1" },
      { cityId: "b", rank: 2, score: "0.1", coverage: "1" },
    ]);
    expect(ranking.ordered[0]?.factors[1]).toMatchObject({ targetComparison: "does_not_match", requiredMismatch: false });
    expect(rankCities({ ...input, knowledge: [...input.knowledge].reverse() }).ordered).toEqual(ranking.ordered);
  });

  test("rejects non-member Knowledge shapes and every impossible evaluator output state", () => {
    // Break caught: silently collapsing duplicate/missing/foreign projections or accepting malformed evaluator output.
    const input = { assessmentAt: "2026-01-02T00:00:00.000Z", registry, catalog, criteria, evaluators, knowledge: [
      { cityId: "a", knowledgeRevisionId: "ka", facts: facts("a") }, { cityId: "b", knowledgeRevisionId: "kb", facts: facts("b") },
    ] } as const;
    expect(() => rankCities({ ...input, assessmentAt: "not-an-instant" })).toThrow("integrity_mismatch");
    for (const knowledge of [
      [input.knowledge[0], input.knowledge[0]],
      [input.knowledge[0], { ...input.knowledge[1], cityId: "foreign" }],
      [{ ...input.knowledge[0], facts: [...facts("a")].reverse() }, input.knowledge[1]],
      [{ ...input.knowledge[0], facts: ([...facts("a")] as unknown[]).slice(0, 3) }, input.knowledge[1]],
      [{ ...input.knowledge[0], facts: [{ ...(facts("a") as unknown as Array<Record<string, unknown>>)[0], freshnessBasis: "wrong@1" }, ...(facts("a") as unknown as unknown[]).slice(1)] }, input.knowledge[1]],
    ]) expect(() => rankCities({ ...input, knowledge: knowledge as never })).toThrow("integrity_mismatch");
    const outcomes = [
      { state: "verified", factor: "1", targetComparison: "unknown" },
      { state: "verified", factor: "1", targetComparison: "matches", unknownReason: "not_found" },
      { state: "unknown", factor: "0.1", targetComparison: "unknown", unknownReason: "not_found" },
      { state: "unknown", factor: "0", targetComparison: "matches", unknownReason: "not_found" },
      { state: "unknown", factor: "0", targetComparison: "unknown" },
      { state: "unknown", factor: "0", targetComparison: "unknown", unknownReason: "no_knowledge_revision" },
      { state: "verified", factor: "0.1000000000000000000", targetComparison: "matches" },
    ] as const;
    for (const outcome of outcomes) {
      const overridden = { ...evaluators, safety: { ...evaluators.safety, evaluate: () => outcome } } as CityCriterionEvaluatorRegistry;
      expect(() => rankCities({ ...input, evaluators: overridden })).toThrow("integrity_mismatch");
    }
    const wrongDefinition = { ...evaluators, safety: { ...evaluators.safety, definition: { ...evaluators.safety.definition, definitionId: "wrong@1" } } } as CityCriterionEvaluatorRegistry;
    expect(() => rankCities({ ...input, evaluators: wrongDefinition })).toThrow("integrity_mismatch");
  });

  test("replays only an exact canonical ranking and deep-freezes the reconstruction", () => {
    // Break caught: accepting any tampered public output, omitted members, extra keys, or mutable replay results.
    const input = { assessmentAt: "2026-01-02T00:00:00.000Z", registry, catalog, criteria, evaluators, knowledge: [
      { cityId: "a", knowledgeRevisionId: "ka", facts: facts("a") }, { cityId: "b", knowledgeRevisionId: "kb", facts: facts("b") },
    ] } as const;
    const ranking = rankCities(input);
    expect(reconstructCityRanking({ ...input, ranking })).toEqual(ranking);
    expect(Object.isFrozen(reconstructCityRanking({ ...input, ranking }).ordered[0])).toBe(true);
    for (const mutate of [
      (copy: Record<string, unknown>) => { (copy.ordered as Array<Record<string, unknown>>)[0].score = "0"; },
      (copy: Record<string, unknown>) => { (copy.ordered as Array<Record<string, unknown>>)[0].factors = []; },
      (copy: Record<string, unknown>) => { (copy.ordered as Array<Record<string, unknown>>)[0].rank = 9; },
      (copy: Record<string, unknown>) => { (copy.ordered as Array<Record<string, unknown>>)[0].coverage = "0"; },
      (copy: Record<string, unknown>) => { ((copy.ordered as Array<Record<string, unknown>>)[0].factors as Array<Record<string, unknown>>)[0].factor = "0"; },
      (copy: Record<string, unknown>) => { ((copy.ordered as Array<Record<string, unknown>>)[0].factors as Array<Record<string, unknown>>)[0].definitionId = "wrong@1"; },
      (copy: Record<string, unknown>) => { ((copy.ordered as Array<Record<string, unknown>>)[0].factors as Array<Record<string, unknown>>)[0].evaluatorVersion = "wrong@1"; },
      (copy: Record<string, unknown>) => { ((copy.ordered as Array<Record<string, unknown>>)[0].factors as Array<Record<string, unknown>>)[0].freshnessPolicyVersion = "wrong@1"; },
      (copy: Record<string, unknown>) => { ((copy.ordered as Array<Record<string, unknown>>)[0].factors as Array<Record<string, unknown>>)[0].targetComparison = "does_not_match"; },
      (copy: Record<string, unknown>) => { copy.rulesVersion = "wrong@1"; },
      (copy: Record<string, unknown>) => { copy.extra = true; },
      (copy: Record<string, unknown>) => { copy.screenedExclusions = []; copy.ordered = (copy.ordered as unknown[]).slice(0, 1); },
    ]) {
      const copy = JSON.parse(JSON.stringify(ranking)) as Record<string, unknown>;
      mutate(copy);
      expect(() => reconstructCityRanking({ ...input, ranking: copy as never })).toThrow("integrity_mismatch");
    }
    const undefinedExtra = { ...ranking, extra: undefined };
    expect(() => reconstructCityRanking({ ...input, ranking: undefinedExtra as never })).toThrow("integrity_mismatch");
    const toJsonExtra = { ...ranking, toJSON: () => ranking };
    expect(() => reconstructCityRanking({ ...input, ranking: toJsonExtra as never })).toThrow("integrity_mismatch");
  });

  test("replays exact municipal safety integers and never consumes a presentation rate", () => {
    // Break caught: depending on a display rate instead of the sealed integer basis.
    const safetyFacts = facts("a") as unknown as Array<Record<string, unknown>>;
    const basis = { kind: "municipal_safety" as const, quantity: { offenceCount: "0", population: "100", rateBasis: "offences_per_100000_residents" as const } };
    safetyFacts[0] = { ...safetyFacts[0], outcome: { kind: "verified", basis } };
    const safetyEvaluator = {
      ...evaluators,
      safety: {
        ...evaluators.safety,
        evaluate: ({ fact }: { fact: { outcome: { kind: string; basis?: { quantity?: { offenceCount?: string } } } } }) => ({
          state: "verified" as const,
          factor: fact.outcome.basis?.quantity?.offenceCount === "0" ? "1" : "0",
          targetComparison: "matches" as const,
        }),
      },
    } as CityCriterionEvaluatorRegistry;
    const input = { assessmentAt: "2026-01-02T00:00:00.000Z", registry, catalog, criteria, evaluators: safetyEvaluator, knowledge: [
      { cityId: "a", knowledgeRevisionId: "ka", facts: safetyFacts }, { cityId: "b", knowledgeRevisionId: "kb", facts: facts("b") },
    ] } as unknown as import("../../src/decision/city-ranker").RankCitiesInput;
    const ranking = rankCities(input);
    expect(basis.quantity).not.toHaveProperty("displayRate");
    basis.quantity.offenceCount = "1";
    expect(() => reconstructCityRanking({ ...input, ranking })).toThrow("integrity_mismatch");
  });
});
