import { describe, expect, test } from "vitest";

import { calculateBudget } from "../../src/branch/budget";

const input = {
  income: {
    amount: "210000",
    currency: "RUB" as const,
    profileId: "profile-1",
  },
  cbrRate: {
    sourceId: "cbr-eur" as const,
    rate: "93.1901",
    base: "EUR" as const,
    quote: "RUB" as const,
    claimId: "cbr-eur-facts-1",
    sourcePeriod: "2026-08-06",
    ref: "cbr-artifact#rate",
  },
  boaRate: {
    sourceId: "boa-eur" as const,
    rate: "93.13",
    base: "EUR" as const,
    quote: "ALL" as const,
    claimId: "boa-eur-facts-1",
    sourcePeriod: "2026-08-05",
    ref: "boa-artifact#rate",
  },
  housing: { currency: "ALL" as const, initialHousingAll: "70000" },
};

describe("calculateBudget", () => {
  test("uses unrounded Decimal intermediates and rounds only the final ALL values HALF_UP", () => {
    const budget = calculateBudget(input);

    expect(budget).toMatchObject({
      incomeAll: "209864.57",
      housingAll: "70000.00",
      knownResidualAll: "139864.57",
      formulaId: "FORMULA-VS1-FX-01",
      formulaVersion: "1",
      rounding: "UNROUNDED_THEN_HALF_UP_2DP",
    });
  });

  test("binds exact profile and dated claim inputs with stable formula, input and output hashes", () => {
    const first = calculateBudget(input);
    const second = calculateBudget(input);

    expect(first.inputs).toEqual([
      { binding: "income_RUB", value: "210000", unit: "RUB/month", provenance: "profile", ref: "profile-1" },
      { binding: "CBR_RUB_PER_EUR", value: "93.1901", unit: "RUB/EUR", provenance: "claim", ref: "cbr-eur-facts-1@2026-08-06#cbr-artifact#rate" },
      { binding: "BOA_ALL_PER_EUR", value: "93.13", unit: "ALL/EUR", provenance: "claim", ref: "boa-eur-facts-1@2026-08-05#boa-artifact#rate" },
    ]);
    expect(first.formulaHash).toBe("ed02a65cc7f09bbf9ab5ae1d15d0ff74a570a9c1a3f3c49eab6ce3582ce11186");
    expect(first.inputHash).toBe("ba0ac864f191b4f81adbde6249535995323308d36992964bba7953784c57c208");
    expect(first.outputHash).toBe("fd0ed9c34d6410ddbe62eb3d1f23b5b72bebe887b02c245a19a8356aa95143c3");
    expect(second).toEqual(first);
  });

  test("keeps taxes and unmodelled living costs as explicit typed unknowns", () => {
    expect(calculateBudget(input).unknowns).toEqual([
      { kind: "taxes", status: "unknown", reason: "unmodelled" },
      { kind: "living_costs", status: "unknown", reason: "unmodelled" },
    ]);
  });

  test.each([
    ["income", { ...input, income: { ...input.income, amount: "210000 RUB" } }],
    ["CBR rate", { ...input, cbrRate: { ...input.cbrRate, rate: "0" } }],
    ["BoA rate", { ...input, boaRate: { ...input.boaRate, rate: "NaN" } }],
    ["housing", { ...input, housing: { ...input.housing, initialHousingAll: "-1" } }],
  ])("rejects an invalid %s decimal instead of coercing through a JS number", (_label, invalid) => {
    expect(() => calculateBudget(invalid)).toThrow("invalid_decimal");
  });
});
