import { createHash } from "node:crypto";

import Decimal from "decimal.js";

import type { CalculationInput } from "../application/contracts";
import type { HousingDecision } from "./housing";

const DECIMAL_TEXT = /^\d+(?:\.\d+)?$/;

export const BUDGET_FORMULA_ID = "FORMULA-VS1-FX-01" as const;
export const BUDGET_FORMULA_VERSION = "1" as const;
export const BUDGET_ROUNDING = "UNROUNDED_THEN_HALF_UP_2DP" as const;

const FORMULA_DESCRIPTOR = Object.freeze({
  formulaId: BUDGET_FORMULA_ID,
  formulaVersion: BUDGET_FORMULA_VERSION,
  expression: "income_ALL=income_RUB/CBR_RUB_PER_EUR*BOA_ALL_PER_EUR",
  rounding: BUDGET_ROUNDING,
});

export interface BudgetIncome {
  readonly amount: string;
  readonly currency: "RUB";
  readonly profileId: string;
}

export interface CbrBudgetRate {
  readonly sourceId: "cbr-eur";
  readonly rate: string;
  readonly base: "EUR";
  readonly quote: "RUB";
  readonly claimId: string;
  readonly sourcePeriod: string;
  readonly ref: string;
}

export interface BoaBudgetRate {
  readonly sourceId: "boa-eur";
  readonly rate: string;
  readonly base: "EUR";
  readonly quote: "ALL";
  readonly claimId: string;
  readonly sourcePeriod: string;
  readonly ref: string;
}

export interface BudgetInput {
  readonly income: BudgetIncome;
  readonly cbrRate: CbrBudgetRate;
  readonly boaRate: BoaBudgetRate;
  readonly housing: HousingDecision;
}

export interface BudgetUnknown {
  readonly kind: "taxes" | "living_costs";
  readonly status: "unknown";
  readonly reason: "unmodelled";
}

export interface BudgetCalculation {
  readonly incomeAll: string;
  readonly housingAll: string;
  readonly knownResidualAll: string;
  readonly unknowns: readonly BudgetUnknown[];
  readonly formulaId: typeof BUDGET_FORMULA_ID;
  readonly formulaVersion: typeof BUDGET_FORMULA_VERSION;
  readonly rounding: typeof BUDGET_ROUNDING;
  readonly inputs: readonly CalculationInput[];
  readonly formulaHash: string;
  readonly inputHash: string;
  readonly outputHash: string;
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalValue(item)]));
  }
  return value;
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonicalValue(value))).digest("hex");
}

function decimal(value: string, positive: boolean): Decimal {
  if (!DECIMAL_TEXT.test(value)) throw new Error("invalid_decimal");
  const parsed = new Decimal(value);
  if (!parsed.isFinite() || (positive ? parsed.lessThanOrEqualTo(0) : parsed.isNegative())) {
    throw new Error("invalid_decimal");
  }
  return parsed;
}

function claimRef(claim: CbrBudgetRate | BoaBudgetRate): string {
  if (claim.claimId.length === 0 || claim.sourcePeriod.length === 0 || claim.ref.length === 0) {
    throw new Error("invalid_budget_binding");
  }
  return `${claim.claimId}@${claim.sourcePeriod}#${claim.ref}`;
}

export function calculateBudget(input: BudgetInput): BudgetCalculation {
  if (input.income.currency !== "RUB" || input.income.profileId.length === 0) {
    throw new Error("invalid_budget_binding");
  }
  if (
    input.cbrRate.base !== "EUR" || input.cbrRate.quote !== "RUB" ||
    input.cbrRate.sourceId !== "cbr-eur" || input.boaRate.sourceId !== "boa-eur" ||
    input.boaRate.base !== "EUR" || input.boaRate.quote !== "ALL" ||
    input.housing.currency !== "ALL"
  ) {
    throw new Error("invalid_budget_binding");
  }

  const incomeRub = decimal(input.income.amount, false);
  const cbrRubPerEur = decimal(input.cbrRate.rate, true);
  const boaAllPerEur = decimal(input.boaRate.rate, true);
  const housingAll = decimal(input.housing.initialHousingAll, true);
  const incomeAll = incomeRub.div(cbrRubPerEur).mul(boaAllPerEur);
  const knownResidualAll = incomeAll.minus(housingAll);
  const inputs: readonly CalculationInput[] = Object.freeze([
    Object.freeze({ binding: "income_RUB", value: input.income.amount, unit: "RUB/month", provenance: "profile", ref: input.income.profileId }),
    Object.freeze({ binding: "CBR_RUB_PER_EUR", value: input.cbrRate.rate, unit: "RUB/EUR", provenance: "claim", ref: claimRef(input.cbrRate) }),
    Object.freeze({ binding: "BOA_ALL_PER_EUR", value: input.boaRate.rate, unit: "ALL/EUR", provenance: "claim", ref: claimRef(input.boaRate) }),
  ]);
  const unknowns: readonly BudgetUnknown[] = Object.freeze([
    Object.freeze({ kind: "taxes", status: "unknown", reason: "unmodelled" }),
    Object.freeze({ kind: "living_costs", status: "unknown", reason: "unmodelled" }),
  ]);
  const output = Object.freeze({
    incomeAll: incomeAll.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2),
    housingAll: housingAll.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2),
    knownResidualAll: knownResidualAll.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2),
    unknowns,
  });
  const exactInput = Object.freeze({
    income: input.income,
    cbrRate: input.cbrRate,
    boaRate: input.boaRate,
    housing: input.housing,
  });

  return Object.freeze({
    ...output,
    formulaId: BUDGET_FORMULA_ID,
    formulaVersion: BUDGET_FORMULA_VERSION,
    rounding: BUDGET_ROUNDING,
    inputs,
    formulaHash: hash(FORMULA_DESCRIPTOR),
    inputHash: hash(exactInput),
    outputHash: hash(output),
  });
}
