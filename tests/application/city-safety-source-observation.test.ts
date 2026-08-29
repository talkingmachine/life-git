import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  acceptCitySafetyProposal,
  analyzeCitySafetySourceObservation,
  createCitySafetyPublicExcerptProjector,
  deriveUniqueQuoteLocator,
  parseCitySafetyObservationQuote,
} from "../../src/application/city-safety-source-observation";
import {
  SourceObservationError,
  reconstructSourceExcerptProjectionV1,
  reconstructSourceObservationAcceptance,
  reconstructSourceObservationProposalV1,
  type SourceObservationRequestV1,
} from "../../src/application/source-observation";

const DEFINITION = "si-municipal-police-offences-per-100000@1" as const;
const SOURCE_TEXT = `definitionId=${DEFINITION}\nperiodKind=annual\nmunicipalityCode=061\nreferenceYear=2024\noffenceCount=1234\nnumeratorUnit=offences`;
const JSON_CAPTURE = JSON.stringify({ definitionId: DEFINITION, periodKind: "annual", municipalityCode: "061", referenceYear: 2024, offenceCount: "1234", numeratorUnit: "offences", ignored: "not forwarded" });

function capture(text = JSON_CAPTURE) {
  return { schemaVersion: "city-safety-public-capture@1", mediaType: "application/json", sha256: createHash("sha256").update(text).digest("hex"), bytes: new TextEncoder().encode(text), provenance: { kind: "official_public", authenticated: false, personalized: false, containsPii: false } } as const;
}

function request(projection: ReturnType<ReturnType<typeof createCitySafetyPublicExcerptProjector>["project"]>): SourceObservationRequestV1 {
  return { schemaVersion: "source-observation-request@1", countryCode: "SI", cityId: "ljubljana", municipalityCode: "061", factKey: "si-city-safety", definitionId: DEFINITION, expectedPeriod: "annual", expectedNumeratorUnit: "offences", parserVersion: "si-city-safety-observation-parser@1", projection, signal: new AbortController().signal };
}

function proposal(quote = SOURCE_TEXT) {
  return reconstructSourceObservationProposalV1({ schemaVersion: "source-observation-proposal@1", definitionId: DEFINITION, periodKind: "annual", offenceCount: "1234", referenceYear: 2024, numeratorUnit: "offences", quote, quoteLocator: deriveUniqueQuoteLocator(SOURCE_TEXT, quote), ambiguities: [] });
}

describe("city safety source observation", () => {
  it("projects a verified public capture and privately re-attests only issued semantics", () => {
    const projector = createCitySafetyPublicExcerptProjector();
    const projection = projector.project(capture());
    expect(projection.text).toBe(SOURCE_TEXT);
    expect(Object.isFrozen(projection)).toBe(true);
    expect(projector.requireVerified({ ...projection })).toEqual(projection);
    expect(() => projector.requireVerified({ ...projection, text: `${projection.text}\nchanged=1` })).toThrow("source_observation_integrity_failed");
  });

  it("rejects bad hash, MIME, privacy and hostile capture ownership", () => {
    const projector = createCitySafetyPublicExcerptProjector();
    expect(() => projector.project({ ...capture(), sha256: "0".repeat(64) })).toThrow("city_safety_projection_invalid");
    expect(() => projector.project({ ...capture(), mediaType: "image/png" })).toThrow("city_safety_projection_invalid");
    expect(() => projector.project(capture(JSON.stringify({ ...JSON.parse(JSON_CAPTURE), email: "person@example.test" })))).toThrow("city_safety_projection_invalid");
    const inherited = Object.create({}); Object.assign(inherited, capture());
    expect(() => projector.project(inherited)).toThrow("city_safety_projection_invalid");
    expect(() => projector.project(new Proxy(capture(), {}))).toThrow("city_safety_projection_invalid");
    const accessor = { ...capture() }; Object.defineProperty(accessor, "sha256", { enumerable: true, get: () => capture().sha256 });
    expect(() => projector.project(accessor)).toThrow("city_safety_projection_invalid");
  });

  it("bounds projection at 64 KiB and snapshots an exact Uint8Array", () => {
    const projector = createCitySafetyPublicExcerptProjector();
    const bytes = new Uint8Array(new TextEncoder().encode(JSON_CAPTURE));
    const projected = projector.project({ ...capture(), bytes });
    bytes.fill(0);
    expect(projected.text).toBe(SOURCE_TEXT);
    const subclass = new (class extends Uint8Array {})(new TextEncoder().encode(JSON_CAPTURE));
    expect(() => projector.project({ ...capture(), bytes: subclass })).toThrow("city_safety_projection_invalid");
    expect(new TextEncoder().encode(projected.text).byteLength).toBeLessThanOrEqual(65_536);
    expect(reconstructSourceExcerptProjectionV1({ ...projected, text: "x".repeat(65_536) }).text).toHaveLength(65_536);
    expect(() => reconstructSourceExcerptProjectionV1({ ...projected, text: "x".repeat(65_537) })).toThrow("source_observation_integrity_failed");
  });

  it("independently parses and compares definition, period, municipality, year, count and unit", () => {
    const projector = createCitySafetyPublicExcerptProjector(); const req = request(projector.project(capture()));
    expect(acceptCitySafetyProposal(proposal(), req)).toEqual({ kind: "accepted" });
    for (const replacement of [SOURCE_TEXT.replace(DEFINITION, `${DEFINITION}-wrong`), SOURCE_TEXT.replace("periodKind=annual", "periodKind=monthly"), `${SOURCE_TEXT}\noffenceCount=9`]) {
      expect(parseCitySafetyObservationQuote({ quote: replacement, municipalityCode: "061", definitionId: DEFINITION, periodKind: "annual" })).toBeUndefined();
    }
  });

  it("rejects sparse/accessor ambiguity arrays and reason on accepted", () => {
    const sparse = new Array<string>(1);
    expect(() => reconstructSourceObservationProposalV1({ ...proposal(), ambiguities: sparse })).toThrow("source_observation_integrity_failed");
    const accessor: string[] = ["x"]; Object.defineProperty(accessor, "0", { enumerable: true, get: () => "x" });
    expect(() => reconstructSourceObservationProposalV1({ ...proposal(), ambiguities: accessor })).toThrow("source_observation_integrity_failed");
    const symbolArray = ["x"]; Object.defineProperty(symbolArray, Symbol("hidden"), { value: "secret" });
    expect(() => reconstructSourceObservationProposalV1({ ...proposal(), ambiguities: symbolArray })).toThrow("source_observation_integrity_failed");
    expect(() => reconstructSourceObservationAcceptance({ kind: "accepted", reason: undefined })).toThrow("source_observation_integrity_failed");
    const owned = proposal(); expect(Object.isFrozen(owned)).toBe(true); expect(Object.isFrozen(owned.quoteLocator)).toBe(true); expect(Object.isFrozen(owned.ambiguities)).toBe(true);
  });

  it("returns observed only after post-port revalidation and maps exhaustion to yellow", async () => {
    const projector = createCitySafetyPublicExcerptProjector(); const req = request(projector.project(capture()));
    const goodPort = Object.freeze({ observe: vi.fn().mockResolvedValue(proposal()) });
    await expect(analyzeCitySafetySourceObservation({ request: req, port: goodPort })).resolves.toMatchObject({ kind: "observed", definitionId: DEFINITION, periodKind: "annual", offenceCount: "1234" });
    const yellowPort = Object.freeze({ observe: vi.fn().mockRejectedValue(new SourceObservationError("source_observation_invalid")) });
    await expect(analyzeCitySafetySourceObservation({ request: req, port: yellowPort })).resolves.toEqual({ schemaVersion: "city-safety-source-observation-analysis@1", kind: "yellow", reason: "source_observation_unavailable" });
    const forgedPort = Object.freeze({ observe: vi.fn().mockResolvedValue({ ...proposal(), definitionId: `${DEFINITION}-wrong` }) });
    await expect(analyzeCitySafetySourceObservation({ request: req, port: forgedPort })).rejects.toMatchObject({ code: "source_observation_integrity_failed" });
  });

  it("maps semantically valid ambiguity and parser mismatch to yellow but hostile contracts fail closed", async () => {
    const projector = createCitySafetyPublicExcerptProjector(); const req = request(projector.project(capture()));
    for (const semantic of [{ ...proposal(), ambiguities: ["multiple rows"] }, { ...proposal(), offenceCount: "999" }]) {
      const port = Object.freeze({ observe: vi.fn().mockResolvedValue(semantic) });
      await expect(analyzeCitySafetySourceObservation({ request: req, port })).resolves.toMatchObject({ kind: "yellow", reason: "source_observation_unavailable" });
    }
    const proxyPort = Object.freeze({ observe: vi.fn().mockResolvedValue(new Proxy(proposal(), {})) });
    await expect(analyzeCitySafetySourceObservation({ request: req, port: proxyPort })).rejects.toMatchObject({ code: "source_observation_integrity_failed" });
    await expect(analyzeCitySafetySourceObservation({ request: { ...req, parserVersion: "si-city-safety-observation-parser@999" }, port: Object.freeze({ observe: vi.fn() }) })).rejects.toMatchObject({ code: "source_observation_integrity_failed" });
  });

  it("derives multibyte UTF-8 bounds and rejects overlapping quotes", () => {
    const prefix = "Любляна — ";
    expect(deriveUniqueQuoteLocator(prefix + SOURCE_TEXT, SOURCE_TEXT)).toEqual({ startByte: new TextEncoder().encode(prefix).byteLength, endByte: new TextEncoder().encode(prefix + SOURCE_TEXT).byteLength });
    expect(deriveUniqueQuoteLocator("aaaa", "aa")).toBeUndefined();
  });
});
