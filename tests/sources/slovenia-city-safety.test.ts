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

function keyVocabulary(value: string): ReadonlySet<string> {
  return new Set(value.split(" "));
}

const ALLOWED_JSON_KEYS_BY_FIXTURE: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ["discovery-validator-vectors.synthetic.json", keyVocabulary([
    "dataauthority definitionid documentmunicipalitycode documentmunicipalitycodes",
    "expecteddisposition expectedmunicipalitycode expectedreason fixtureclass id offencecount",
    "population populationreferenceyear privacy publisher quantitykind referenceyear schemaversion vectors",
  ].join(" "))],
  ["manifest.json", keyVocabulary([
    "archivetimestamp areacrosswalk assessmentdate authoritativeness authority blockingreason bytes cadence",
    "captured capturedate committed coverage discoveryvalidatorvectors.synthetic.json disposition",
    "distinctoffenses example expectedperiod failure fallbackreferenceyear fixtureclasses freshness",
    "installationauthorized installedauthoritydirectoryid installedsourceplanid knowngeodistinctoffenses",
    "member membersha256 method municipalbroadscope.expected.json nationwidecontext navigationurls",
    "newestofficiallylistedperiod originalurl policekd2023.expectedaggregate.json policekd2023.header.csv",
    "policekd2023.syntheticprojection.csv preferredreferenceyear privacy projectionfixture rawartifacts",
    "rawrequestsha256 rawresponsesha256 rawsha256 referenceperiod requestfixture resolvedretrievalurl",
    "responsefixture resultstatusfixture retrievalmirror role rows rulesversion schemaversion sha256 sourceid",
    "status surs05c3002s2023h1.request.json surs05c3002s2023h1.response.json",
    "sursmunicipalitypopulation.expected.json sursmunicipalitypopulation.request.json syntheticexpectation",
    "unknownadministrativeunitsentinels unknowngeodistinctoffenses url verifiedcatalogmemberpositive",
  ].join(" "))],
  ["municipal-broad-scope.expected.json", keyVocabulary([
    "coveredmunicipalitycodes coveredmunicipalitynames dataauthorityclaim disposition fixtureclass",
    "municipalitycode navigationurl proofboundary publishable publisher rawartifactcommitted rawsha256",
    "rejectionreason resolvedevidenceurl schemaversion settlementcode sourcereadiness",
  ].join(" "))],
  ["police-kd2023.expected-aggregate.json", keyVocabulary([
    "crosswalkauthority crosswalkmethod distinctoffenses geoscope policelabel publishable referenceperiod",
    "selectedunits sourceclass surscode totaldistinctoffenses unknowngeodistinctoffenses",
  ].join(" "))],
  ["surs-05C3002S-2023H1.request.json", keyVocabulary(
    "code filter format query response selection values",
  )],
  ["surs-05C3002S-2023H1.response.json", keyVocabulary([
    "0 17 2023h1 24 64 category class decimals dimension extension id index label polletje px role show size",
    "source spol starost time updated upravnaenota value version",
  ].join(" "))],
  ["surs-municipality-population.expected.json", keyVocabulary([
    "fixtureclass geography period proofboundary publishable rawresponsecaptured rawresponsesha256",
    "referencedate requestfixture requiredresultcontract schemaversion source sourcetable status unit value",
  ].join(" "))],
  ["surs-municipality-population.request.json", keyVocabulary([
    "code endpoint filter fixtureclass format provenanceboundary query referencedate request",
    "requestedmunicipalitycodes requeststatus response schemaversion selection sourcetable values",
  ].join(" "))],
]);
const ALLOWED_CSV_FIXTURES = new Set([
  "police-kd2023.header.csv",
  "police-kd2023.synthetic-projection.csv",
]);
const ALLOWED_SAFETY_FIXTURES = new Set([
  ...ALLOWED_JSON_KEYS_BY_FIXTURE.keys(),
  ...ALLOWED_CSV_FIXTURES,
]);

interface FixtureTreeFile {
  readonly name: string;
  readonly text: string;
}

function assertPrivacySafeFixtureTree(files: readonly FixtureTreeFile[]): void {
  const names = files.map(({ name }) => name);
  const unexpectedNames = names.filter((name) => !ALLOWED_SAFETY_FIXTURES.has(name));
  const missingNames = [...ALLOWED_SAFETY_FIXTURES].filter((name) => !names.includes(name));
  if (unexpectedNames.length > 0 || missingNames.length > 0 || new Set(names).size !== names.length) {
    throw new Error("unexpected_safety_fixture_tree");
  }
  for (const file of files) {
    const allowedJsonKeys = ALLOWED_JSON_KEYS_BY_FIXTURE.get(file.name);
    if (allowedJsonKeys !== undefined) {
      const value: unknown = JSON.parse(file.text);
      const keys = nestedKeys(value).map(normalizedPrivacyKey);
      const forbiddenKeys = keys.filter((key) => FORBIDDEN_JSON_KEYS.has(key));
      if (forbiddenKeys.length > 0) throw new Error(`private_json_key:${file.name}`);
      const unexpectedKeys = keys.filter((key) => !allowedJsonKeys.has(key));
      if (unexpectedKeys.length > 0) {
        throw new Error(`unexpected_json_key:${file.name}:${unexpectedKeys[0]}`);
      }
    }
    if (ALLOWED_CSV_FIXTURES.has(file.name)) {
      const rows = file.text.trim().split("\n");
      if (file.name === "police-kd2023.header.csv" && rows.length !== 1) {
        throw new Error(`non_header_csv:${file.name}`);
      }
      if (file.name !== "police-kd2023.header.csv" &&
        !rows.slice(1).every((row) => row.startsWith("SYN-"))) {
        throw new Error(`non_synthetic_csv:${file.name}`);
      }
    }
  }
}

function safetyFixtureTree(): readonly FixtureTreeFile[] {
  return filesBelow(SAFETY_ROOT).map((name) => ({
    name,
    text: readFileSync(`${SAFETY_ROOT}${name}`, "utf8"),
  }));
}

function augmentJsonFixture(
  files: readonly FixtureTreeFile[],
  name: string,
  extra: Readonly<Record<string, unknown>>,
): readonly FixtureTreeFile[] {
  return files.map((file) => file.name === name
    ? { ...file, text: JSON.stringify({ ...(JSON.parse(file.text) as object), ...extra }) }
    : file);
}

describe("Slovenia city-safety source readiness fixtures", () => {
  test.each(["raw.bin", "unknown.json", "notes.txt"])("rejects unknown safety fixture %s", (name) => {
    // Break caught: an allowlist-free extension check permits raw or renamed source payloads.
    expect(() => assertPrivacySafeFixtureTree([
      ...safetyFixtureTree(),
      { name, text: name.endsWith(".json") ? "{}" : "raw" },
    ])).toThrow("unexpected_safety_fixture");
  });

  test("rejects person-shaped rows added inside an allowlisted JSON fixture", () => {
    // Break caught: a filename allowlist alone permits new personal row-shaped schemas.
    expect(() => assertPrivacySafeFixtureTree(augmentJsonFixture(
      safetyFixtureTree(),
      "manifest.json",
      { persons: [{ id: "P-1", name: "Jane" }] },
    ))).toThrow("unexpected_json_key");
  });

  test("rejects search-result rows added inside an allowlisted JSON fixture", () => {
    // Break caught: generic item/link/description keys can smuggle search-result text under an allowed filename.
    expect(() => assertPrivacySafeFixtureTree(augmentJsonFixture(
      safetyFixtureTree(),
      "manifest.json",
      { items: [{ link: "https://example.invalid", description: "snippet" }] },
    ))).toThrow("unexpected_json_key");
  });

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
    expect(() => assertPrivacySafeFixtureTree(safetyFixtureTree())).not.toThrow();
  });
});
