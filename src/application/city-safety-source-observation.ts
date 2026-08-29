import { createHash } from "node:crypto";
import { types } from "node:util";

import {
  CITY_SAFETY_DEFINITION_ID,
  SourceObservationError,
  abortSignalAborted,
  abortSignalReason,
  citySafetyObservationYellow,
  citySafetyObservedAnalysis,
  reconstructSourceExcerptProjectionV1,
  reconstructSourceObservationProposalV1,
  reconstructSourceObservationRequestV1,
  type CitySafetySourceObservationAnalysis,
  type SourceExcerptProjectionV1,
  type SourceObservationPort,
  type SourceObservationRequestV1,
} from "./source-observation";

export type CitySafetyPublicCaptureV1 = Readonly<{
  schemaVersion: "city-safety-public-capture@1";
  mediaType: "application/json" | "text/plain";
  sha256: string;
  bytes: Uint8Array;
  provenance: Readonly<{ kind: "official_public"; authenticated: false; personalized: false; containsPii: false }>;
}>;

export interface CitySafetyPublicExcerptProjector {
  project(value: unknown): SourceExcerptProjectionV1;
  requireVerified(value: unknown): SourceExcerptProjectionV1;
}

const AUTHENTIC_CITY_SAFETY_PROJECTORS = new WeakSet<object>();

export function createCitySafetyPublicExcerptProjector(): CitySafetyPublicExcerptProjector {
  const issued = new Set<string>();
  const projector = {
    project(value: unknown): SourceExcerptProjectionV1 {
      const capture = reconstructCapture(value);
      if (createHash("sha256").update(capture.bytes).digest("hex") !== capture.sha256) projectionInvalid();
      let decoded: string;
      try { decoded = new TextDecoder("utf-8", { fatal: true }).decode(capture.bytes); } catch { projectionInvalid(); }
      if (!wellFormedText(decoded) || forbiddenPublicData(decoded)) projectionInvalid();
      const text = capture.mediaType === "application/json" ? projectJson(decoded) : projectKeyValue(decoded);
      const projection = reconstructSourceExcerptProjectionV1({ schemaVersion: "source-excerpt-projection@1", projectionPolicyVersion: "city-safety-public-excerpt@1", sourceSha256: capture.sha256, mediaType: capture.mediaType, text });
      issued.add(projectionDigest(projection));
      return projection;
    },
    requireVerified(value: unknown): SourceExcerptProjectionV1 {
      const projection = reconstructSourceExcerptProjectionV1(value);
      if (!issued.has(projectionDigest(projection))) throw new SourceObservationError("source_observation_integrity_failed");
      return projection;
    },
  } satisfies CitySafetyPublicExcerptProjector;
  const frozen = Object.freeze(projector);
  AUTHENTIC_CITY_SAFETY_PROJECTORS.add(frozen);
  return frozen;
}

export function requireCitySafetyPublicExcerptProjector(value: unknown): CitySafetyPublicExcerptProjector {
  if (value === null || typeof value !== "object" || types.isProxy(value) || !AUTHENTIC_CITY_SAFETY_PROJECTORS.has(value)) integrity();
  return value as CitySafetyPublicExcerptProjector;
}

export function parseCitySafetyObservationQuote(input: Readonly<{ quote: string; municipalityCode: string; definitionId: typeof CITY_SAFETY_DEFINITION_ID; periodKind: "annual" }> ):
  Readonly<{ definitionId: typeof CITY_SAFETY_DEFINITION_ID; periodKind: "annual"; offenceCount: string; referenceYear: number; numeratorUnit: "offences" }> | undefined {
  if (!wellFormedText(input.quote) || !/^\d{3}$/.test(input.municipalityCode) || input.definitionId !== CITY_SAFETY_DEFINITION_ID || input.periodKind !== "annual") return undefined;
  const values = new Map<string, string>();
  for (const line of input.quote.split("\n")) {
    const match = /^(definitionId|periodKind|municipalityCode|referenceYear|offenceCount|numeratorUnit)=([^\n]+)$/.exec(line);
    if (match === null || values.has(match[1]!)) return undefined;
    values.set(match[1]!, match[2]!);
  }
  if (values.size !== 6 || values.get("definitionId") !== input.definitionId || values.get("periodKind") !== input.periodKind ||
    values.get("municipalityCode") !== input.municipalityCode || !/^\d{4}$/.test(values.get("referenceYear") ?? "") ||
    !/^(0|[1-9][0-9]*)$/.test(values.get("offenceCount") ?? "") || values.get("numeratorUnit") !== "offences") return undefined;
  return Object.freeze({ definitionId: CITY_SAFETY_DEFINITION_ID, periodKind: "annual", offenceCount: values.get("offenceCount")!, referenceYear: Number(values.get("referenceYear")), numeratorUnit: "offences" });
}

export function acceptCitySafetyProposal(value: unknown, requestValue: SourceObservationRequestV1) {
  const request = reconstructSourceObservationRequestV1(requestValue); const proposal = reconstructSourceObservationProposalV1(value);
  if (proposal.ambiguities.length > 0) return Object.freeze({ kind: "retryable" as const, reason: "ambiguity" as const });
  const locator = deriveUniqueQuoteLocator(request.projection.text, proposal.quote);
  if (locator === undefined || locator.startByte !== proposal.quoteLocator.startByte || locator.endByte !== proposal.quoteLocator.endByte) return parserMismatch();
  const parsed = parseCitySafetyObservationQuote({ quote: proposal.quote, municipalityCode: request.municipalityCode, definitionId: request.definitionId, periodKind: request.expectedPeriod });
  if (parsed === undefined || parsed.definitionId !== proposal.definitionId || parsed.periodKind !== proposal.periodKind || parsed.offenceCount !== proposal.offenceCount || parsed.referenceYear !== proposal.referenceYear || parsed.numeratorUnit !== proposal.numeratorUnit) return parserMismatch();
  return Object.freeze({ kind: "accepted" as const });
}

export async function analyzeCitySafetySourceObservation(value: unknown): Promise<CitySafetySourceObservationAnalysis> {
  const outer = exactApplicationInput(value); const request = reconstructSourceObservationRequestV1(outer.request); const observe = requirePortMethod(outer.port);
  try {
    const proposal = reconstructSourceObservationProposalV1(await Reflect.apply(observe, outer.port, [request]) as unknown);
    if (abortSignalAborted(request.signal)) throw abortSignalReason(request.signal);
    if (acceptCitySafetyProposal(proposal, request).kind !== "accepted") return citySafetyObservationYellow();
    return citySafetyObservedAnalysis(proposal);
  } catch (error) {
    if (abortSignalAborted(request.signal)) throw abortSignalReason(request.signal);
    if (trustedSourceError(error, "source_observation_invalid") || trustedSourceError(error, "source_observation_runtime_failed")) return citySafetyObservationYellow();
    throw error;
  }
}

export function deriveUniqueQuoteLocator(text: string, quote: string): Readonly<{ startByte: number; endByte: number }> | undefined {
  if (!wellFormedText(text) || !wellFormedText(quote) || quote.length === 0) return undefined;
  const start = text.indexOf(quote); if (start < 0 || text.indexOf(quote, start + 1) >= 0) return undefined;
  return Object.freeze({ startByte: utf8Bytes(text.slice(0, start)), endByte: utf8Bytes(text.slice(0, start + quote.length)) });
}

function reconstructCapture(value: unknown): CitySafetyPublicCaptureV1 {
  const source = exactPlain(value, ["schemaVersion", "mediaType", "sha256", "bytes", "provenance"], projectionInvalid);
  if (source.schemaVersion !== "city-safety-public-capture@1" || source.mediaType !== "application/json" && source.mediaType !== "text/plain" ||
    typeof source.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(source.sha256) || !exactUint8Array(source.bytes) || source.bytes.byteLength < 1 || source.bytes.byteLength > 1_048_576) projectionInvalid();
  const provenance = exactPlain(source.provenance, ["kind", "authenticated", "personalized", "containsPii"], projectionInvalid);
  if (provenance.kind !== "official_public" || provenance.authenticated !== false || provenance.personalized !== false || provenance.containsPii !== false) projectionInvalid();
  let bytes: Uint8Array; try { bytes = new Uint8Array(source.bytes); } catch { projectionInvalid(); }
  return Object.freeze({ schemaVersion: "city-safety-public-capture@1", mediaType: source.mediaType, sha256: source.sha256, bytes, provenance: Object.freeze({ kind: "official_public", authenticated: false, personalized: false, containsPii: false }) });
}

function projectJson(text: string): string {
  let parsed: unknown; try { parsed = JSON.parse(text); } catch { projectionInvalid(); }
  const source = exactPlain(parsed, ["definitionId", "periodKind", "municipalityCode", "referenceYear", "offenceCount", "numeratorUnit"], projectionInvalid, ["ignored"]);
  return canonicalProjection(source);
}
function projectKeyValue(text: string): string {
  const lines = text.split("\n"); if (lines.length !== 6) projectionInvalid();
  const source = Object.fromEntries(lines.map((line) => { const index = line.indexOf("="); if (index <= 0) projectionInvalid(); return [line.slice(0, index), line.slice(index + 1)]; }));
  return canonicalProjection(exactPlain(source, ["definitionId", "periodKind", "municipalityCode", "referenceYear", "offenceCount", "numeratorUnit"], projectionInvalid));
}
function canonicalProjection(source: Record<string, unknown>): string {
  if (source.definitionId !== CITY_SAFETY_DEFINITION_ID || source.periodKind !== "annual" || typeof source.municipalityCode !== "string" || !/^\d{3}$/.test(source.municipalityCode) ||
    (typeof source.referenceYear !== "number" && typeof source.referenceYear !== "string") || !/^\d{4}$/.test(String(source.referenceYear)) ||
    typeof source.offenceCount !== "string" || !/^(0|[1-9][0-9]*)$/.test(source.offenceCount) || source.numeratorUnit !== "offences") projectionInvalid();
  const projection = `definitionId=${source.definitionId}\nperiodKind=annual\nmunicipalityCode=${source.municipalityCode}\nreferenceYear=${source.referenceYear}\noffenceCount=${source.offenceCount}\nnumeratorUnit=offences`;
  if (utf8Bytes(projection) > 65_536) projectionInvalid(); return projection;
}
function projectionDigest(value: SourceExcerptProjectionV1): string { return createHash("sha256").update(JSON.stringify({ schemaVersion: value.schemaVersion, projectionPolicyVersion: value.projectionPolicyVersion, sourceSha256: value.sourceSha256, mediaType: value.mediaType, text: value.text })).digest("hex"); }
function exactUint8Array(value: unknown): value is Uint8Array { return value !== null && typeof value === "object" && !types.isProxy(value) && Object.getPrototypeOf(value) === Uint8Array.prototype; }
function exactPlain(value: unknown, required: readonly string[], fail: () => never, optional: readonly string[] = []): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value) || types.isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype || Object.getOwnPropertySymbols(value).length !== 0) fail();
  const descriptors = Object.getOwnPropertyDescriptors(value); const keys = Object.keys(descriptors); const allowed = new Set([...required, ...optional]);
  if (keys.length < required.length || keys.length > allowed.size || !required.every((key) => keys.includes(key)) || keys.some((key) => !allowed.has(key))) fail();
  const result = Object.create(null) as Record<string, unknown>;
  for (const key of keys) { const descriptor = descriptors[key]; if (descriptor?.enumerable !== true || !("value" in descriptor)) fail(); result[key] = descriptor.value; }
  return result;
}
function exactApplicationInput(value: unknown): { request: unknown; port: unknown } { const source = exactPlain(value, ["request", "port"], integrity); return { request: source.request, port: source.port }; }
function requirePortMethod(value: unknown): SourceObservationPort["observe"] { const source = exactPlain(value, ["observe"], integrity); if (typeof source.observe !== "function" || types.isProxy(source.observe)) integrity(); return source.observe as SourceObservationPort["observe"]; }
function trustedSourceError(value: unknown, code: SourceObservationError["code"]): boolean { if (value === null || typeof value !== "object" || types.isProxy(value) || !types.isNativeError(value) || Object.getPrototypeOf(value) !== SourceObservationError.prototype) return false; const descriptor = Object.getOwnPropertyDescriptor(value, "code"); return descriptor?.enumerable === true && "value" in descriptor && descriptor.value === code; }
function parserMismatch() { return Object.freeze({ kind: "retryable" as const, reason: "parser_mismatch" as const }); }
function forbiddenPublicData(text: string): boolean { return /<\s*(script|form|iframe|object|embed)\b|\b(cookie|authorization|password|email|phone)\b|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/i.test(text); }
function wellFormedText(value: unknown): value is string { return typeof value === "string" && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(value); }
function utf8Bytes(value: string): number { return new TextEncoder().encode(value).byteLength; }
function projectionInvalid(): never { throw new TypeError("city_safety_projection_invalid"); }
function integrity(): never { throw new SourceObservationError("source_observation_integrity_failed"); }
