import { describe, expect, test } from "vitest";

import {
  classifyCitySafetyPeriod,
  compareCitySafetyToTarget,
  createCitySafetyEvaluator,
  type CitySafetyQuantity,
} from "../../src/decision/city-safety";
import { linearAtLeastFactor, linearAtMostFactor } from "../../src/decision/city-criterion-evaluator";
import Decimal from "decimal.js";

const assessmentAt = "2026-07-01T00:00:00.000Z";
const quantity = (offenceCount: string, population = "100000"): CitySafetyQuantity => ({
  offenceCount,
  population,
  rateBasis: "offences_per_100000_residents",
});

describe("city safety policy", () => {
  test("classifies exact Jan-June and July safety-year boundaries", () => {
    // Break caught: treating the July release switch as a calendar-year rule.
    expect(classifyCitySafetyPeriod({ assessmentAt: "2026-06-30T23:59:59.999Z", referenceYear: 2025 }))
      .toBe("preferred");
    expect(classifyCitySafetyPeriod({ assessmentAt: "2026-06-30T23:59:59.999Z", referenceYear: 2024 }))
      .toBe("fallback");
    expect(classifyCitySafetyPeriod({ assessmentAt, referenceYear: 2025 })).toBe("preferred");
    expect(classifyCitySafetyPeriod({ assessmentAt, referenceYear: 2024 })).toBe("stale");
    expect(() => classifyCitySafetyPeriod({ assessmentAt: "2026-07-01", referenceYear: 2025 })).toThrow();
    expect(() => classifyCitySafetyPeriod({ assessmentAt, referenceYear: 2025.5 })).toThrow();
  });

  test("compares safety rates through exact integer cross-products", () => {
    // Break caught: rounding a display rate before target comparison.
    expect(compareCitySafetyToTarget({ quantity: quantity("0"), target: "0", direction: "at_most" }))
      .toBe("matches");
    expect(compareCitySafetyToTarget({ quantity: quantity("2"), target: "2", direction: "at_most" }))
      .toBe("matches");
    expect(compareCitySafetyToTarget({ quantity: quantity("2"), target: "2.00001", direction: "at_most" }))
      .toBe("matches");
    expect(compareCitySafetyToTarget({ quantity: quantity("2"), target: "1.99999", direction: "at_most" }))
      .toBe("does_not_match");
    for (const invalid of ["-1", "+1", "01", "1.0", "1e2"] as const) {
      expect(() => compareCitySafetyToTarget({ quantity: quantity(invalid), target: "1", direction: "at_most" }))
        .toThrow();
    }
    expect(() => compareCitySafetyToTarget({ quantity: quantity("1", "0"), target: "1", direction: "at_most" }))
      .toThrow();
  });

  test("evaluates safety with its definition-specific linear factor and freshness policy", () => {
    // Break caught: using a universal curve, accepting stale data, or deriving comparison from rounded rates.
    const evaluator = createCitySafetyEvaluator({ zeroScoreBoundary: "10" });
    const criterion = { criterionId: "safety" as const, definitionId: evaluator.definition.definitionId,
      mode: "weighted" as const, importance: 3 as const, target: "2" };
    const fact = (offenceCount: string, referencePeriod = "2025") => ({
      criterionId: "safety" as const,
      definitionId: evaluator.definition.definitionId,
      geoScope: "municipality",
      referencePeriod,
      freshnessBasis: "municipal-annual-july-boundary@1",
      unit: "offences_per_100000_residents",
      denominator: "municipality_population_january_1",
      outcome: { kind: "verified" as const, basis: { kind: "municipal_safety" as const, quantity: quantity(offenceCount) } },
    });
    expect(evaluator.evaluate({ criterion, fact: fact("2"), assessmentAt })).toEqual({
      state: "verified", factor: "1", targetComparison: "matches",
    });
    expect(evaluator.evaluate({ criterion, fact: fact("6"), assessmentAt })).toEqual({
      state: "verified", factor: "0.5", targetComparison: "does_not_match",
    });
    expect(evaluator.evaluate({ criterion, fact: fact("10"), assessmentAt })).toEqual({
      state: "verified", factor: "0", targetComparison: "does_not_match",
    });
    expect(evaluator.evaluate({ criterion, fact: fact("2", "2024"), assessmentAt })).toEqual({
      state: "unknown", factor: "0", targetComparison: "unknown", unknownReason: "stale",
    });
    expect(() => evaluator.evaluate({ criterion, fact: { ...fact("2"), criterionId: "urban_transit" }, assessmentAt }))
      .toThrow("invalid_safety_fact");
    expect(() => evaluator.evaluate({ criterion, fact: { ...fact("2"), definitionId: "other" }, assessmentAt }))
      .toThrow("invalid_safety_fact");
    expect(() => evaluator.evaluate({ criterion, fact: { ...fact("2"), freshnessBasis: "other" }, assessmentAt }))
      .toThrow("invalid_safety_fact");
    expect(evaluator.evaluate({ criterion, fact: { ...fact("2"), outcome: { kind: "unknown", reason: "not_found" } }, assessmentAt }))
      .toEqual({ state: "unknown", factor: "0", targetComparison: "unknown", unknownReason: "not_found" });
    expect(evaluator.evaluate({ criterion, fact: { ...fact("2"), referencePeriod: null, outcome: { kind: "unknown", reason: "source_unavailable" } }, assessmentAt }))
      .toEqual({ state: "unknown", factor: "0", targetComparison: "unknown", unknownReason: "source_unavailable" });
    expect(evaluator.evaluate({ criterion, fact: fact("2", "2024"), assessmentAt: "2026-06-30T00:00:00.000Z" }))
      .toMatchObject({ state: "verified" });
    expect(() => evaluator.evaluate({
      criterion: { ...criterion, target: "10" }, fact: fact("2"), assessmentAt,
    })).toThrow("invalid_zero_score_boundary");
  });

  test("keeps both definition-specific linear curves bounded and isolated from global Decimal mutation", () => {
    // Break caught: inverted at-least curve, boundary leakage, or mutable global Decimal configuration.
    expect(linearAtLeastFactor("0", "10", "0")).toBe("0");
    expect(linearAtLeastFactor("5", "10", "0")).toBe("0.5");
    expect(linearAtLeastFactor("10", "10", "0")).toBe("1");
    expect(linearAtLeastFactor("11", "10", "0")).toBe("1");
    expect(linearAtMostFactor("2", "2", "10")).toBe("1");
    expect(linearAtMostFactor("6", "2", "10")).toBe("0.5");
    expect(linearAtMostFactor("10", "2", "10")).toBe("0");
    Decimal.set({ precision: 2, rounding: Decimal.ROUND_UP });
    expect(linearAtMostFactor("3", "2", "5")).toBe("0.666666666666666667");
    expect(() => linearAtMostFactor("3", "5", "5")).toThrow();
    expect(() => linearAtLeastFactor("3", "5", "5")).toThrow();
  });
});
