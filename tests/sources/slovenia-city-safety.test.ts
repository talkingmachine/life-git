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

function nestedKeys(value: unknown): readonly string[] {
  if (Array.isArray(value)) return value.flatMap(nestedKeys);
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, child]) => [key, ...nestedKeys(child)]);
}

function normalizedPrivacyKey(value: string): string {
  return value.replaceAll(/[-_\s]/g, "").toLowerCase();
}

const FORBIDDEN_JSON_KEYS = new Set([
  "address", "firstname", "lastname", "fullname", "personname",
  "personid", "personidentifier", "victim", "suspect", "caseid", "caseidentifier",
  "offenceid", "eventid", "eventdescription", "location", "locationdescription",
  "snippet", "title", "searchsnippet", "searchtitle", "searchresult", "searchresults",
  "searchdescription", "searchtext", "resulttitle", "resulttext", "resultdescription",
  "resultsummary", "htmlsnippet", "htmltitle", "displaylink", "formattedurl", "pagemap",
]);
const ALLOWED_CSV_FIXTURES = new Set([
  "police-kd2023.header.csv",
  "police-kd2023.synthetic-projection.csv",
]);

describe("Slovenia city-safety source readiness fixtures", () => {
  test.each([
    "firstName", "last_name", "full-name", "person name", "offenceId", "event_id",
    "eventDescription", "location", "location_description", "caseIdentifier", "personIdentifier",
  ])("recognizes nested private/search row key %s after normalization", (privateKey) => {
    // Break caught: normalized personal/event/location identifiers evade the recursive JSON gate.
    const nested = { envelope: [{ payload: { [privateKey]: "forbidden" } }] };
    expect(nestedKeys(nested).map(normalizedPrivacyKey).some((key) => FORBIDDEN_JSON_KEYS.has(key)))
      .toBe(true);
  });

  test("documents all six fixture classes including unavailable projections", () => {
    // Break caught: unavailable projections are omitted from the fixture taxonomy and mistaken for observations.
    const readme = readFileSync(`${FIXTURE_ROOT}README.md`, "utf8");
    expect(readme).toContain("six classes explicitly");
    expect(readme).toContain("`unavailable_projection`");
  });

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
    for (const name of safetyFiles.filter((item) => item.endsWith(".json"))) {
      const value = readJson(name);
      expect(nestedKeys(value).map(normalizedPrivacyKey).filter((key) => FORBIDDEN_JSON_KEYS.has(key)))
        .toEqual([]);
    }
    for (const name of safetyFiles.filter((item) => item.endsWith(".csv"))) {
      expect(ALLOWED_CSV_FIXTURES.has(name)).toBe(true);
      const rows = readFileSync(`${SAFETY_ROOT}${name}`, "utf8").trim().split("\n");
      if (name === "police-kd2023.header.csv") expect(rows).toHaveLength(1);
      else expect(rows.slice(1).every((row) => row.startsWith("SYN-"))).toBe(true);
    }
  });
});
