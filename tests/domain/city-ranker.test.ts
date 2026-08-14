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
  });

  test("fails closed on evaluator contracts and preserves caller-owned fact basis", () => {
    // Break caught: accepting impossible evaluator states, empty revision IDs, or freezing/aliasing caller basis.
    const basis = { kind: "canonical_scalar" as const, value: "1" };
    const knowledge = [{ cityId: "a", knowledgeRevisionId: "ka", facts: facts("a") },
      { cityId: "b", knowledgeRevisionId: "", facts: facts("b") }] as const;
    expect(() => rankCities({ assessmentAt: "2026-01-02T00:00:00.000Z", registry, catalog, criteria, evaluators, knowledge }))
      .toThrow("integrity_mismatch");
    expect(Object.isFrozen(basis)).toBe(false);
  });
});
