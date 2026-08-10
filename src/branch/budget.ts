import { createHash } from "node:crypto";

import Decimal from "decimal.js";

import type { HousingDecision } from "./housing";

const DECIMAL_TEXT = /^\d+(?:\.\d+)?$/;
const SIGNED_DECIMAL_TEXT = /^-?\d+(?:\.\d+)?$/;
const BudgetDecimal = Decimal.clone({
  precision: 64,
  rounding: Decimal.ROUND_HALF_UP,
});

export const BUDGET_FORMULA_ID = "FORMULA-VS1-FX-01" as const;
export const BUDGET_FORMULA_VERSION = "1" as const;
export const BUDGET_ROUNDING = "UNROUNDED_THEN_HALF_UP_2DP" as const;

const FORMULA_DESCRIPTOR = Object.freeze({
  formulaId: BUDGET_FORMULA_ID,
  formulaVersion: BUDGET_FORMULA_VERSION,
  expressions: Object.freeze({
    incomeAll: "income_ALL=income_RUB/CBR_RUB_PER_EUR*BOA_ALL_PER_EUR",
    knownResidualAll: "knownResidual_ALL=income_ALL-housing_ALL",
  }),
  numericContext: Object.freeze({
    library: "decimal.js",
    precision: 64,
    rounding: "ROUND_HALF_UP",
  }),
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

export interface CalculationInput {
  readonly binding: string;
  readonly value: string;
  readonly unit: string;
  readonly provenance: "profile" | "claim";
  readonly ref: string;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function requiredString(value: unknown): string {
  if (typeof value !== "string") throw new Error("invalid_budget_input");
  return value;
}

export function confirmBudgetInput(value: unknown): Readonly<BudgetInput> {
  if (!isRecord(value) || !hasExactKeys(value, ["income", "cbrRate", "boaRate", "housing"])) {
    throw new Error("invalid_budget_input");
  }
  const { income, cbrRate, boaRate, housing } = value;
  if (
    !isRecord(income) || !hasExactKeys(income, ["amount", "currency", "profileId"]) ||
    !isRecord(cbrRate) || !hasExactKeys(cbrRate, ["sourceId", "rate", "base", "quote", "claimId", "sourcePeriod", "ref"]) ||
    !isRecord(boaRate) || !hasExactKeys(boaRate, ["sourceId", "rate", "base", "quote", "claimId", "sourcePeriod", "ref"]) ||
    !isRecord(housing) || !hasExactKeys(housing, ["currency", "initialHousingAll"])
  ) throw new Error("invalid_budget_input");

  return Object.freeze({
    income: Object.freeze({
      amount: requiredString(income.amount),
      currency: requiredString(income.currency) as "RUB",
      profileId: requiredString(income.profileId),
    }),
    cbrRate: Object.freeze({
      sourceId: requiredString(cbrRate.sourceId) as "cbr-eur",
      rate: requiredString(cbrRate.rate),
      base: requiredString(cbrRate.base) as "EUR",
      quote: requiredString(cbrRate.quote) as "RUB",
      claimId: requiredString(cbrRate.claimId),
      sourcePeriod: requiredString(cbrRate.sourcePeriod),
      ref: requiredString(cbrRate.ref),
    }),
    boaRate: Object.freeze({
      sourceId: requiredString(boaRate.sourceId) as "boa-eur",
      rate: requiredString(boaRate.rate),
      base: requiredString(boaRate.base) as "EUR",
      quote: requiredString(boaRate.quote) as "ALL",
      claimId: requiredString(boaRate.claimId),
      sourcePeriod: requiredString(boaRate.sourcePeriod),
      ref: requiredString(boaRate.ref),
    }),
    housing: Object.freeze({
      currency: requiredString(housing.currency) as "ALL",
      initialHousingAll: requiredString(housing.initialHousingAll),
    }),
  });
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

function decimal(value: string, positive: boolean) {
  if (!DECIMAL_TEXT.test(value)) throw new Error("invalid_decimal");
  const parsed = new BudgetDecimal(value);
  if (!parsed.isFinite() || (positive ? parsed.lessThanOrEqualTo(0) : parsed.isNegative())) {
    throw new Error("invalid_decimal");
  }
  return parsed;
}

export function calculateDisplayDelta(after: string, before: string): string {
  return signedDecimal(after).minus(signedDecimal(before)).toFixed(2);
}

function signedDecimal(value: string) {
  if (!SIGNED_DECIMAL_TEXT.test(value)) throw new Error("invalid_decimal");
  const parsed = new BudgetDecimal(value);
  if (!parsed.isFinite()) throw new Error("invalid_decimal");
  return parsed;
}

function claimRef(claim: CbrBudgetRate | BoaBudgetRate): string {
  if (claim.claimId.length === 0 || claim.sourcePeriod.length === 0 || claim.ref.length === 0) {
    throw new Error("invalid_budget_binding");
  }
  return `${claim.claimId}@${claim.sourcePeriod}#${claim.ref}`;
}

export function calculateBudget(input: BudgetInput): BudgetCalculation {
  const exactInput = confirmBudgetInput(input);
  if (exactInput.income.currency !== "RUB" || exactInput.income.profileId.length === 0) {
    throw new Error("invalid_budget_binding");
  }
  if (
    exactInput.cbrRate.base !== "EUR" || exactInput.cbrRate.quote !== "RUB" ||
    exactInput.cbrRate.sourceId !== "cbr-eur" || exactInput.boaRate.sourceId !== "boa-eur" ||
    exactInput.boaRate.base !== "EUR" || exactInput.boaRate.quote !== "ALL" ||
    exactInput.housing.currency !== "ALL"
  ) {
    throw new Error("invalid_budget_binding");
  }

  const incomeRub = decimal(exactInput.income.amount, false);
  const cbrRubPerEur = decimal(exactInput.cbrRate.rate, true);
  const boaAllPerEur = decimal(exactInput.boaRate.rate, true);
  const housingAll = decimal(exactInput.housing.initialHousingAll, true);
  const incomeAll = incomeRub.div(cbrRubPerEur).mul(boaAllPerEur);
  const knownResidualAll = incomeAll.minus(housingAll);
  const inputs: readonly CalculationInput[] = Object.freeze([
    Object.freeze({ binding: "income_RUB", value: exactInput.income.amount, unit: "RUB/month", provenance: "profile", ref: exactInput.income.profileId }),
    Object.freeze({ binding: "CBR_RUB_PER_EUR", value: exactInput.cbrRate.rate, unit: "RUB/EUR", provenance: "claim", ref: claimRef(exactInput.cbrRate) }),
    Object.freeze({ binding: "BOA_ALL_PER_EUR", value: exactInput.boaRate.rate, unit: "ALL/EUR", provenance: "claim", ref: claimRef(exactInput.boaRate) }),
  ]);
  const unknowns: readonly BudgetUnknown[] = Object.freeze([
    Object.freeze({ kind: "taxes", status: "unknown", reason: "unmodelled" }),
    Object.freeze({ kind: "living_costs", status: "unknown", reason: "unmodelled" }),
  ]);
  const output = Object.freeze({
    incomeAll: incomeAll.toDecimalPlaces(2, BudgetDecimal.ROUND_HALF_UP).toFixed(2),
    housingAll: housingAll.toDecimalPlaces(2, BudgetDecimal.ROUND_HALF_UP).toFixed(2),
    knownResidualAll: knownResidualAll.toDecimalPlaces(2, BudgetDecimal.ROUND_HALF_UP).toFixed(2),
    unknowns,
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
