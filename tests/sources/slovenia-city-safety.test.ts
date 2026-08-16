import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

const FIXTURE_ROOT = fileURLToPath(new URL("./fixtures/slovenia-city/", import.meta.url));
const SAFETY_ROOT = fileURLToPath(new URL("./fixtures/slovenia-city/safety/", import.meta.url));

function readJson(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(`${SAFETY_ROOT}${name}`, "utf8")) as Record<string, unknown>;
}

function filesBelow(root: string, relative = ""): readonly string[] {
  return readdirSync(`${root}${relative}`).flatMap((name) => {
    const path = `${relative}${name}`;
    return statSync(`${root}${path}`).isDirectory() ? filesBelow(root, `${path}/`) : [path];
  }).sort();
}

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

describe("Slovenia city-safety source readiness fixtures", () => {
  test("stays candidate-only without a hash-bound current catalog-member positive", () => {
    // Break caught: source readiness is promoted from route discovery without official fact bytes/result.
    const manifest = readJson("manifest.json");
    expect(manifest.status).toBe("candidate_available_with_partial_official_coverage");
    expect(manifest.verifiedCatalogMemberPositive).toBeNull();
    expect(manifest.installationAuthorized).toBe(false);
    expect(existsSync(`${SAFETY_ROOT}municipal-positive.expected.json`)).toBe(false);
  });

  test("records the reviewed Velenje route only as an unbound broad-scope rejection", () => {
    // Break caught: a police-station aggregate spanning three municipalities becomes a Velenje fact.
    expect(readJson("municipal-broad-scope.expected.json")).toEqual(expect.objectContaining({
      schemaVersion: "city-safety-municipal-scope-projection@1",
      fixtureClass: "unavailable_projection",
      settlementCode: "133024",
      municipalityCode: "133",
      rawArtifactCommitted: false,
      rawSha256: null,
      publishable: false,
      disposition: "rejected",
      rejectionReason: "scope_mismatch",
      coveredMunicipalityCodes: ["125", "126", "133"],
    }));
  });

  test("keeps the municipality denominator as an unavailable request contract, not an invented result", () => {
    // Break caught: settlement summary values or an uncaptured PxWeb response are relabelled municipality denominators.
    const request = readJson("surs-municipality-population.request.json");
    const expected = readJson("surs-municipality-population.expected.json");
    expect(request).toEqual(expect.objectContaining({
      fixtureClass: "generated-request",
      sourceTable: "05C5003S",
      referenceDate: "2025-01-01",
    }));
    expect(expected).toEqual(expect.objectContaining({
      fixtureClass: "unavailable_projection",
      rawResponseCaptured: false,
      rawResponseSha256: null,
      status: "exact_municipality_result_not_bound",
      publishable: false,
    }));
    expect(expected).not.toHaveProperty("population");
  });

  test("contains only synthetic discovery boundary vectors", () => {
    // Break caught: validator examples are mistaken for real municipal observations.
    const fixture = readJson("discovery-validator-vectors.synthetic.json");
    expect(fixture).toEqual(expect.objectContaining({
      schemaVersion: "city-safety-discovery-validator-vectors@1",
      fixtureClass: "synthetic",
    }));
    const vectors = fixture.vectors as readonly Record<string, unknown>[];
    expect(vectors.map(({ expectedDisposition }) => expectedDisposition)).toEqual([
      "usable", "rejected", "rejected", "rejected", "rejected", "rejected",
    ]);
    expect(JSON.stringify(vectors)).toContain("scope_mismatch");
    expect(JSON.stringify(vectors)).toContain("missing_numerator");
    expect(JSON.stringify(vectors)).toContain("denominator_zero");
  });

  test("checksum manifest covers every committed fixture byte exactly once", () => {
    // Break caught: a projection changes or is added without being hash-bound by the package checksum file.
    const checksumLines = readFileSync(`${FIXTURE_ROOT}SHA256SUMS`, "utf8").trim().split("\n");
    const records = checksumLines.map((line) => {
      const match = /^([a-f0-9]{64})  (.+)$/.exec(line);
      expect(match).not.toBeNull();
      return { digest: match![1]!, path: match![2]! };
    });
    const fixtureFiles = filesBelow(FIXTURE_ROOT).filter((path) => path !== "SHA256SUMS");
    expect(records.map(({ path }) => path).sort()).toEqual(fixtureFiles);
    expect(new Set(records.map(({ path }) => path)).size).toBe(records.length);
    for (const record of records) expect(sha256(`${FIXTURE_ROOT}${record.path}`)).toBe(record.digest);
  });

  test("recursively excludes raw documents, sensitive row keys, and non-synthetic CSV data", () => {
    // Break caught: raw reports, search text, or identifiable offence rows enter repository fixtures.
    const safetyFiles = filesBelow(SAFETY_ROOT);
    expect(safetyFiles.some((name) => /\.(?:pdf|html?|zip)$/i.test(name))).toBe(false);
    const forbiddenKey = /"(?:address|person_?id|victim|suspect|case_?id|searchSnippet)"\s*:/i;
    for (const name of safetyFiles.filter((item) => item.endsWith(".json"))) {
      expect(readFileSync(`${SAFETY_ROOT}${name}`, "utf8")).not.toMatch(forbiddenKey);
    }
    const syntheticRows = readFileSync(`${SAFETY_ROOT}police-kd2023.synthetic-projection.csv`, "utf8")
      .trim().split("\n").slice(1);
    expect(syntheticRows.every((row) => row.startsWith("SYN-"))).toBe(true);
  });
});
