import { describe, expect, test } from "vitest";

import { confirmHousingDecision } from "../../src/branch/housing";

describe("confirmHousingDecision", () => {
  test("confirms and normalizes the synthetic 70000 ALL initial housing amount", () => {
    expect(confirmHousingDecision({ currency: "ALL", initialHousingAll: "70000.00" })).toEqual({
      currency: "ALL",
      initialHousingAll: "70000",
    });
  });

  test("rejects missing, non-positive, non-ALL, and out-of-range initial housing", () => {
    expect(() => confirmHousingDecision({ currency: "ALL" })).toThrow();
    expect(() => confirmHousingDecision({ currency: "ALL", initialHousingAll: "0" })).toThrow();
    expect(() => confirmHousingDecision({ currency: "RUB", initialHousingAll: "70000" })).toThrow();
    expect(() => confirmHousingDecision({ currency: "ALL", initialHousingAll: "1000000000" })).toThrow();
  });
});
