import DecimalJs from "decimal.js";

import { canonicalDecimal, linearAtMostFactor } from "./city-criterion-evaluator";
import type {
  CityCriterionEvaluator,
  CityCriterionEvaluation,
  CityCriterionEvaluationInput,
} from "./city-criteria";

export type CanonicalUnsignedInteger = string;

export interface CitySafetyQuantity {
  readonly offenceCount: CanonicalUnsignedInteger;
  readonly population: CanonicalUnsignedInteger;
  readonly rateBasis: "offences_per_100000_residents";
}

export type CitySafetyPeriodDisposition = "preferred" | "fallback" | "stale";

const UNSIGNED_INTEGER = /^(0|[1-9][0-9]*)$/;
const RATE_MULTIPLIER = 100_000n;
const Decimal = DecimalJs.clone({ precision: 40, rounding: DecimalJs.ROUND_HALF_EVEN });

function assertInstant(value: unknown): asserts value is string {
  try {
    if (typeof value !== "string" || new Date(value).toISOString() !== value) throw new Error();
  } catch { throw new Error("invalid_assessment_at"); }
}

function assertQuantity(value: unknown): asserts value is CitySafetyQuantity {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid_safety_quantity");
  const quantity = value as Record<string, unknown>;
  if (Object.keys(quantity).sort().join(",") !== "offenceCount,population,rateBasis" ||
    typeof quantity.offenceCount !== "string" || typeof quantity.population !== "string" ||
    !UNSIGNED_INTEGER.test(quantity.offenceCount) || !UNSIGNED_INTEGER.test(quantity.population) ||
    quantity.population === "0" || quantity.rateBasis !== "offences_per_100000_residents") {
    throw new Error("invalid_safety_quantity");
  }
}

function decimalParts(target: string): { readonly coefficient: bigint; readonly scale: bigint } {
  const canonical = canonicalDecimal(target);
  const [whole, fraction = ""] = canonical.split(".");
  return { coefficient: BigInt(`${whole}${fraction}`), scale: 10n ** BigInt(fraction.length) };
}

function actualRate(quantity: CitySafetyQuantity): string {
  return new Decimal(quantity.offenceCount).mul(RATE_MULTIPLIER.toString()).div(quantity.population).toFixed();
}

export function classifyCitySafetyPeriod(input: {
  readonly assessmentAt: string;
  readonly referenceYear: number;
}): CitySafetyPeriodDisposition {
  assertInstant(input.assessmentAt);
  if (!Number.isSafeInteger(input.referenceYear)) throw new Error("invalid_reference_year");
  const assessment = new Date(input.assessmentAt);
  const year = assessment.getUTCFullYear();
  const isBeforeJuly = assessment.getUTCMonth() < 6;
  if (input.referenceYear === year - 1) return "preferred";
  if (isBeforeJuly && input.referenceYear === year - 2) return "fallback";
  return "stale";
}

export function compareCitySafetyToTarget(input: {
  readonly quantity: CitySafetyQuantity;
  readonly target: string;
  readonly direction: "at_most";
}): "matches" | "does_not_match" {
  assertQuantity(input.quantity);
  if (input.direction !== "at_most") throw new Error("invalid_safety_direction");
  const { coefficient, scale } = decimalParts(input.target);
  const left = BigInt(input.quantity.offenceCount) * RATE_MULTIPLIER * scale;
  const right = coefficient * BigInt(input.quantity.population);
  return left <= right ? "matches" : "does_not_match";
}

export function createCitySafetyEvaluator(input: {
  readonly zeroScoreBoundary: string;
}): CityCriterionEvaluator {
  const boundary = new Decimal(canonicalDecimal(input.zeroScoreBoundary));
  if (!boundary.greaterThan(0)) throw new Error("invalid_zero_score_boundary");
  const definition = {
    criterionId: "safety" as const,
    definitionId: "si-municipal-police-offences-per-100000@1",
    direction: "at_most" as const,
    unit: "offences_per_100000_residents",
    denominator: "municipality_population_january_1",
    compatibleGeoScopes: ["municipality"] as const,
    freshnessPolicyVersion: "municipal-annual-july-boundary@1",
    evaluatorVersion: "si-municipal-safety-linear@1",
  };
  const canonicalizeTarget = (target: unknown): string => {
    const canonical = canonicalDecimal(target);
    if (new Decimal(canonical).greaterThanOrEqualTo(boundary)) throw new Error("invalid_zero_score_boundary");
    return canonical;
  };
  const unknown = (reason: CityCriterionEvaluation["unknownReason"]): CityCriterionEvaluation => ({
    state: "unknown", factor: "0", targetComparison: "unknown", ...(reason === undefined ? {} : { unknownReason: reason }),
  });
  return {
    definition,
    canonicalizeTarget,
    evaluate(evaluation: CityCriterionEvaluationInput): CityCriterionEvaluation {
      const { criterion, fact, assessmentAt } = evaluation;
      if (criterion.criterionId !== "safety" || criterion.definitionId !== definition.definitionId) {
        throw new Error("invalid_safety_criterion");
      }
      const target = canonicalizeTarget(criterion.target);
      if (fact.criterionId !== "safety" || fact.definitionId !== definition.definitionId ||
        fact.freshnessBasis !== definition.freshnessPolicyVersion || fact.geoScope !== "municipality" || fact.unit !== definition.unit ||
        fact.denominator !== definition.denominator || fact.referencePeriod === null ||
        !/^\d{4}$/.test(fact.referencePeriod)) return unknown("not_comparable");
      if (fact.outcome.kind === "unknown") return unknown(fact.outcome.reason);
      if (classifyCitySafetyPeriod({ assessmentAt, referenceYear: Number(fact.referencePeriod) }) === "stale") {
        return unknown("stale");
      }
      if (fact.outcome.basis.kind !== "municipal_safety") return unknown("not_comparable");
      const quantity = fact.outcome.basis.quantity;
      assertQuantity(quantity);
      const targetComparison = compareCitySafetyToTarget({ quantity, target, direction: "at_most" });
      return { state: "verified", factor: linearAtMostFactor(actualRate(quantity), target, boundary), targetComparison };
    },
  };
}
