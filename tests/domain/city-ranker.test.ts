import { describe, expect, test } from "vitest";

import { rankCities } from "../../src/decision/city-ranker";

describe("city ranker", () => {
  test("requires the pure installed-city ranking policy", () => {
    // Break caught: omitting the dedicated City Ranking decision boundary.
    expect(rankCities).toBeTypeOf("function");
  });
});
