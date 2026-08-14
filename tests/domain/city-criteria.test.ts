import { describe, expect, test } from "vitest";

import {
  CITY_CRITERION_IDS,
  confirmCityCriteria,
  deriveCityCriteriaDraft,
  reconstructCityCriteria,
  type CityCriterionEvaluatorRegistry,
  type InstalledCityCriteriaDefaults,
} from "../../src/decision/city-criteria";
import type { CityDecisionIntegrity } from "../../src/decision/city-integrity";

const INTEGRITY: CityDecisionIntegrity = { canonical: JSON.stringify, hash: (value) => `hash:${value}` };
const definitions = {
  safety: { definitionId: "safety@1", direction: "at_most" as const, unit: "rate", denominator: "people" },
  long_term_rent: { definitionId: "rent@1", direction: "at_most" as const, unit: "eur", denominator: "month" },
  urban_transit: { definitionId: "transit@1", direction: "at_least" as const, unit: "share", denominator: "people" },
  fixed_broadband: { definitionId: "broadband@1", direction: "at_least" as const, unit: "mbps", denominator: "connection" },
} as const;

const evaluators: CityCriterionEvaluatorRegistry = Object.fromEntries(CITY_CRITERION_IDS.map((criterionId) => {
  const definition = definitions[criterionId];
  return [criterionId, {
    definition: { criterionId, ...definition, compatibleGeoScopes: ["municipality"],
      freshnessPolicyVersion: "synthetic-freshness@1", evaluatorVersion: `synthetic-${criterionId}@1` },
    canonicalizeTarget: (target: unknown) => {
      if (typeof target !== "string" || !/^\d+(?:\.\d+)?$/.test(target)) throw new Error("invalid_target");
      return target.replace(/(?:\.0+|(?<=\.\d*?)0+)$/, "");
    },
    evaluate: () => ({ state: "verified" as const, factor: "1", targetComparison: "matches" as const }),
  }];
})) as unknown as CityCriterionEvaluatorRegistry;

const defaults: InstalledCityCriteriaDefaults = {
  schemaVersion: "city-criteria-defaults@1",
  mappingVersion: "synthetic-mapping@1",
  criteria: [
    { criterionId: "safety", definitionId: "safety@1", mode: "required", importance: 1, target: "2" },
    { criterionId: "long_term_rent", definitionId: "rent@1", mode: "weighted", importance: 2, target: "900" },
    { criterionId: "urban_transit", definitionId: "transit@1", mode: "weighted", importance: 2, target: "0.7" },
    { criterionId: "fixed_broadband", definitionId: "broadband@1", mode: "weighted", importance: 2, target: "100" },
  ],
};

const profile = { schemaVersion: "relocation-profile@1" as const, id: "profile", confirmedAt: "2026-01-01T00:00:00.000Z", profile: {} } as never;
const preferences = { schemaVersion: "preference-profile@1" as const, id: "preferences", confirmedAt: "2026-01-01T00:00:00.000Z", criteria: [
  { id: "personal_safety" as const, mode: "weighted" as const, importance: 3 as const, target: "maximize" as const },
  { id: "infrastructure" as const, mode: "required" as const, importance: 4 as const, target: "required_true" as const },
  { id: "europe" as const, mode: "weighted" as const, importance: 5 as const, target: "maximize" as const },
] };

describe("city criteria policy", () => {
  test("defines the fixed four-criterion catalog and maps only documented preference controls", () => {
    // Break caught: inventing city targets from preferences or failing to apply safety/infrastructure parity.
    expect(CITY_CRITERION_IDS).toEqual(["safety", "long_term_rent", "urban_transit", "fixed_broadband"]);
    expect(deriveCityCriteriaDraft(profile, preferences, defaults, evaluators)).toEqual([
      { criterionId: "safety", definitionId: "safety@1", mode: "weighted", importance: 3, target: "2" },
      { criterionId: "long_term_rent", definitionId: "rent@1", mode: "weighted", importance: 2, target: "900" },
      { criterionId: "urban_transit", definitionId: "transit@1", mode: "required", importance: 4, target: "0.7" },
      { criterionId: "fixed_broadband", definitionId: "broadband@1", mode: "required", importance: 4, target: "100" },
    ]);
  });

  test("seals exactly four canonical criteria and reconstructs only their semantic projection", () => {
    // Break caught: accepting reordered/extra definitions, noncanonical targets, or altered snapshot semantics.
    const draft = deriveCityCriteriaDraft(profile, preferences, defaults, evaluators);
    const first = confirmCityCriteria({ draft: [...draft].reverse(), profileSnapshotId: "profile",
      preferenceProfileSnapshotId: "preferences", confirmedAt: "2026-08-14T00:00:00.000Z" }, evaluators, INTEGRITY);
    const second = confirmCityCriteria({ draft, profileSnapshotId: "profile", preferenceProfileSnapshotId: "preferences",
      confirmedAt: "2026-08-14T00:00:00.000Z" }, evaluators, INTEGRITY);
    expect(first.id).toBe(second.id);
    expect(reconstructCityCriteria(first, evaluators)).toEqual({
      profileSnapshotId: "profile", preferenceProfileSnapshotId: "preferences", criteria: draft,
      rulesVersion: "city-criteria@1", confirmedAt: "2026-08-14T00:00:00.000Z",
    });
    expect(() => confirmCityCriteria({ draft: [...draft, draft[0] as (typeof draft)[number]], profileSnapshotId: "profile",
      preferenceProfileSnapshotId: "preferences", confirmedAt: "2026-08-14T00:00:00.000Z" }, evaluators, INTEGRITY)).toThrow();
    expect(() => reconstructCityCriteria({ ...first, extra: true } as typeof first, evaluators))
      .toThrow("integrity_mismatch");
  });
});
