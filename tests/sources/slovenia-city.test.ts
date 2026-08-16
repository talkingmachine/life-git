import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

import {
  parseSloveniaBroadbandFeasibility,
  parseSloveniaCatalogFeasibility,
  parseSloveniaRentMechanics,
  parseSloveniaTransitUniverse,
} from "../../src/research/parsers/slovenia-city";

const FIXTURE_ROOT = fileURLToPath(new URL("./fixtures/slovenia-city/", import.meta.url));

function fixtureJson(path: string): unknown {
  return JSON.parse(readFileSync(`${FIXTURE_ROOT}${path}`, "utf8"));
}

function fixtureFiles(root = FIXTURE_ROOT, relative = ""): readonly string[] {
  return readdirSync(`${root}${relative}`).flatMap((name) => {
    const path = `${relative}${name}`;
    return statSync(`${root}${path}`).isDirectory()
      ? fixtureFiles(root, `${path}/`)
      : [path];
  }).sort();
}

describe("Slovenia city feasibility parsers", () => {
  test("keeps SHA256SUMS exhaustive and byte-exact", () => {
    // Break caught: a feasibility projection changes or appears without package-level hash binding.
    const records = readFileSync(`${FIXTURE_ROOT}SHA256SUMS`, "utf8").trim().split("\n").map((line) => {
      const match = /^([a-f0-9]{64})  (.+)$/.exec(line);
      expect(match).not.toBeNull();
      return { digest: match![1]!, path: match![2]! };
    });
    expect(records.map(({ path }) => path).sort()).toEqual(
      fixtureFiles().filter((path) => path !== "SHA256SUMS"),
    );
    expect(new Set(records.map(({ path }) => path)).size).toBe(records.length);
    for (const record of records) {
      expect(createHash("sha256").update(readFileSync(`${FIXTURE_ROOT}${record.path}`)).digest("hex"))
        .toBe(record.digest);
    }
  });

  test("validates the complete 104-row catalog only as an unsealed feasibility observation", () => {
    // Break caught: an incomplete/top-ten fixture is promoted to city-catalog@2 or installability.
    const result = parseSloveniaCatalogFeasibility(
      fixtureJson("catalog/smn-2022-central-urban-settlements.expected.json"),
    );
    expect(result).toEqual({
      kind: "observation",
      value: {
        schemaVersion: "slovenia-city-catalog-feasibility@1",
        consideredUniverseRows: 104,
        comparablePopulationRows: 104,
        catalogArtifactVersion: null,
        registryCoordinatesSealed: false,
        installable: false,
      },
    });
    expect(JSON.stringify(result)).not.toMatch(/city-catalog@2|registryRevisionId|members/);

    const incomplete = structuredClone(
      fixtureJson("catalog/smn-2022-central-urban-settlements.expected.json"),
    ) as { rows: unknown[] };
    incomplete.rows.pop();
    expect(parseSloveniaCatalogFeasibility(incomplete)).toEqual({
      kind: "rejected",
      reason: "universe_incomplete",
    });
  });

  test("validates rent filtering output without authorizing a verified publication", () => {
    // Break caught: a redacted aggregate or a JavaScript number becomes a production fixed claim.
    const result = parseSloveniaRentMechanics(
      fixtureJson("rent/etn-2025.expected-aggregate.json"),
    );
    expect(result).toEqual({
      kind: "observation",
      value: {
        schemaVersion: "slovenia-city-rent-mechanics@1",
        municipalityCode: "61",
        referencePeriod: "2025",
        unit: "EUR per square metre per month",
        denominator: "qualifying lease contracts",
        qualifyingCount: 9982,
        median: "9.090909090909092",
        fixtureClass: "redacted-derived",
        productionClaimAuthorized: false,
      },
    });
    expect(JSON.stringify(result)).not.toMatch(/claimId|status.*verified/);

    const rowVector = fixtureJson("rent/etn-validator-vectors.synthetic.json");
    expect(parseSloveniaRentMechanics(rowVector)).toEqual({
      kind: "rejected",
      reason: "definition_noncomparable",
    });
  });

  test("closes the partial transit universe without defining a comparable criterion", () => {
    // Break caught: absence from an incomplete feed is interpreted as zero municipal transit.
    const result = parseSloveniaTransitUniverse(
      fixtureJson("transit/dujpp-coverage-projection.json"),
    );
    expect(result).toEqual({ kind: "rejected", reason: "universe_incomplete" });
    expect(JSON.stringify(result)).not.toMatch(
      /metric|unit|denominator|target|evaluator|claimId|verified/i,
    );
  });

  test("keeps broadband capture time separate from source period and reuse-license proof", () => {
    // Break caught: current portal status/captureDate is relabelled as a comparable source period.
    const feature = fixtureJson("broadband/akos-ljubljana-properties.json");
    const status = fixtureJson("broadband/akos-data-status.expected.json");
    expect(parseSloveniaBroadbandFeasibility({ feature, status })).toEqual({
      kind: "rejected",
      reason: "reference_period_unproved",
    });
    expect(parseSloveniaBroadbandFeasibility({
      feature,
      status,
      underlyingReferencePeriod: "2025",
    })).toEqual({ kind: "rejected", reason: "license_unproved" });
    expect(JSON.stringify(parseSloveniaBroadbandFeasibility({ feature, status }))).not.toMatch(
      /metric|unit|denominator|target|evaluator|claimId|verified/i,
    );
  });

  test.each([
    [parseSloveniaCatalogFeasibility, null],
    [parseSloveniaRentMechanics, { schemaVersion: "other" }],
    [parseSloveniaTransitUniverse, []],
    [parseSloveniaBroadbandFeasibility, { feature: {}, status: {} }],
  ] as const)("closes malformed or raw/unsealed input without a verified claim", (parse, value) => {
    // Break caught: permissive parsing turns arbitrary fixture-shaped input into a production fact.
    const result = parse(value);
    expect(result.kind).toBe("rejected");
    expect(JSON.stringify(result)).not.toMatch(/claimId|status.*verified/);
  });
});
