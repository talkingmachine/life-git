import { types } from "node:util";

export const SOURCE_EXCERPT_PROJECTION_VERSION = "source-excerpt-projection@1" as const;
export const SOURCE_OBSERVATION_PROPOSAL_VERSION = "source-observation-proposal@1" as const;
export const CITY_SAFETY_SOURCE_OBSERVATION_PARSER_VERSION = "si-city-safety-observation-parser@1" as const;
export const CITY_SAFETY_DEFINITION_ID = "si-municipal-police-offences-per-100000@1" as const;
export const CITY_SAFETY_SOURCE_OBSERVATION_UNAVAILABLE = "source_observation_unavailable" as const;

const NATIVE_ABORTED_GETTER = Object.getOwnPropertyDescriptor(AbortSignal.prototype, "aborted")?.get;
const NATIVE_REASON_GETTER = Object.getOwnPropertyDescriptor(AbortSignal.prototype, "reason")?.get;

export type SourceExcerptProjectionV1 = Readonly<{
  schemaVersion: typeof SOURCE_EXCERPT_PROJECTION_VERSION;
  projectionPolicyVersion: "city-safety-public-excerpt@1";
  sourceSha256: string;
  mediaType: "application/json" | "text/plain";
  text: string;
}>;

export type SourceObservationProposalV1 = Readonly<{
  schemaVersion: typeof SOURCE_OBSERVATION_PROPOSAL_VERSION;
  definitionId: typeof CITY_SAFETY_DEFINITION_ID;
  periodKind: "annual";
  offenceCount: string;
  referenceYear: number;
  numeratorUnit: "offences";
  quote: string;
  quoteLocator: Readonly<{ startByte: number; endByte: number }>;
  ambiguities: readonly string[];
}>;

export type SourceObservationAcceptance =
  | Readonly<{ kind: "accepted" }>
  | Readonly<{ kind: "retryable"; reason: "ambiguity" | "parser_mismatch" }>;

export type SourceObservationRequestV1 = Readonly<{
  schemaVersion: "source-observation-request@1";
  countryCode: "SI";
  cityId: string;
  municipalityCode: string;
  factKey: "si-city-safety";
  definitionId: typeof CITY_SAFETY_DEFINITION_ID;
  expectedPeriod: "annual";
  expectedNumeratorUnit: "offences";
  parserVersion: typeof CITY_SAFETY_SOURCE_OBSERVATION_PARSER_VERSION;
  projection: SourceExcerptProjectionV1;
  signal: AbortSignal;
}>;

export interface SourceObservationPort {
  observe(input: SourceObservationRequestV1): Promise<SourceObservationProposalV1>;
}

export type CitySafetySourceObservationAnalysis =
  | Readonly<{
      schemaVersion: "city-safety-source-observation-analysis@1";
      kind: "observed";
      definitionId: typeof CITY_SAFETY_DEFINITION_ID;
      periodKind: "annual";
      offenceCount: string;
      referenceYear: number;
      numeratorUnit: "offences";
    }>
  | Readonly<{
      schemaVersion: "city-safety-source-observation-analysis@1";
      kind: "yellow";
      reason: typeof CITY_SAFETY_SOURCE_OBSERVATION_UNAVAILABLE;
    }>;

export type SourceObservationErrorCode =
  | "source_observation_aborted"
  | "source_observation_integrity_failed"
  | "source_observation_runtime_failed"
  | "source_observation_invalid";

export class SourceObservationError extends Error {
  readonly name = "SourceObservationError";
  constructor(readonly code: SourceObservationErrorCode) { super(code); }
}

export function reconstructSourceExcerptProjectionV1(value: unknown): SourceExcerptProjectionV1 {
  const source = exactObject(value, ["schemaVersion", "projectionPolicyVersion", "sourceSha256", "mediaType", "text"]);
  if (source.schemaVersion !== SOURCE_EXCERPT_PROJECTION_VERSION || source.projectionPolicyVersion !== "city-safety-public-excerpt@1" ||
    !isSha256(source.sourceSha256) || source.mediaType !== "application/json" && source.mediaType !== "text/plain" ||
    !wellFormedText(source.text) || utf8Bytes(source.text) < 1 || utf8Bytes(source.text) > 65_536) integrity();
  return Object.freeze({ schemaVersion: SOURCE_EXCERPT_PROJECTION_VERSION, projectionPolicyVersion: "city-safety-public-excerpt@1", sourceSha256: source.sourceSha256, mediaType: source.mediaType, text: source.text });
}

export function reconstructSourceObservationProposalV1(value: unknown): SourceObservationProposalV1 {
  const source = exactObject(value, ["schemaVersion", "definitionId", "periodKind", "offenceCount", "referenceYear", "numeratorUnit", "quote", "quoteLocator", "ambiguities"]);
  const locator = exactObject(source.quoteLocator, ["startByte", "endByte"]);
  if (source.schemaVersion !== SOURCE_OBSERVATION_PROPOSAL_VERSION || source.definitionId !== CITY_SAFETY_DEFINITION_ID || source.periodKind !== "annual" ||
    !unsigned(source.offenceCount) || typeof source.referenceYear !== "number" || !Number.isSafeInteger(source.referenceYear) || source.referenceYear < 1900 || source.referenceYear > 9999 ||
    source.numeratorUnit !== "offences" || !wellFormedText(source.quote) || utf8Bytes(source.quote) < 1 || utf8Bytes(source.quote) > 16_384 ||
    typeof locator.startByte !== "number" || !Number.isSafeInteger(locator.startByte) || locator.startByte < 0 ||
    typeof locator.endByte !== "number" || !Number.isSafeInteger(locator.endByte) || locator.endByte <= locator.startByte) integrity();
  const ambiguities = denseTextArray(source.ambiguities, 8, 256);
  return Object.freeze({
    schemaVersion: SOURCE_OBSERVATION_PROPOSAL_VERSION, definitionId: CITY_SAFETY_DEFINITION_ID, periodKind: "annual",
    offenceCount: source.offenceCount, referenceYear: source.referenceYear, numeratorUnit: "offences", quote: source.quote,
    quoteLocator: Object.freeze({ startByte: locator.startByte, endByte: locator.endByte }), ambiguities,
  });
}

export function reconstructSourceObservationRequestV1(value: unknown): SourceObservationRequestV1 {
  const source = exactObject(value, ["schemaVersion", "countryCode", "cityId", "municipalityCode", "factKey", "definitionId", "expectedPeriod", "expectedNumeratorUnit", "parserVersion", "projection", "signal"]);
  if (source.schemaVersion !== "source-observation-request@1" || source.countryCode !== "SI" || !identifier(source.cityId) ||
    typeof source.municipalityCode !== "string" || !/^\d{3}$/.test(source.municipalityCode) || source.factKey !== "si-city-safety" ||
    source.definitionId !== CITY_SAFETY_DEFINITION_ID || source.expectedPeriod !== "annual" || source.expectedNumeratorUnit !== "offences" ||
    source.parserVersion !== CITY_SAFETY_SOURCE_OBSERVATION_PARSER_VERSION) integrity();
  const signal = requireAbortSignal(source.signal);
  if (abortSignalAborted(signal)) throw new SourceObservationError("source_observation_aborted");
  return Object.freeze({ schemaVersion: "source-observation-request@1", countryCode: "SI", cityId: source.cityId, municipalityCode: source.municipalityCode,
    factKey: "si-city-safety", definitionId: CITY_SAFETY_DEFINITION_ID, expectedPeriod: "annual", expectedNumeratorUnit: "offences",
    parserVersion: CITY_SAFETY_SOURCE_OBSERVATION_PARSER_VERSION, projection: reconstructSourceExcerptProjectionV1(source.projection), signal });
}

export function reconstructSourceObservationAcceptance(value: unknown): SourceObservationAcceptance {
  const source = exactObjectOneOf(value, [["kind"], ["kind", "reason"]]);
  if (source.kind === "accepted" && !Object.hasOwn(source, "reason")) return Object.freeze({ kind: "accepted" });
  if (source.kind === "retryable" && (source.reason === "ambiguity" || source.reason === "parser_mismatch")) return Object.freeze({ kind: "retryable", reason: source.reason });
  integrity();
}

export function citySafetyObservationYellow(): CitySafetySourceObservationAnalysis {
  return Object.freeze({ schemaVersion: "city-safety-source-observation-analysis@1", kind: "yellow", reason: CITY_SAFETY_SOURCE_OBSERVATION_UNAVAILABLE });
}

export function citySafetyObservedAnalysis(value: unknown): CitySafetySourceObservationAnalysis {
  const proposal = reconstructSourceObservationProposalV1(value);
  return Object.freeze({ schemaVersion: "city-safety-source-observation-analysis@1", kind: "observed", definitionId: CITY_SAFETY_DEFINITION_ID, periodKind: "annual", offenceCount: proposal.offenceCount, referenceYear: proposal.referenceYear, numeratorUnit: "offences" });
}

export function requireAbortSignal(value: unknown): AbortSignal {
  if (value === null || typeof value !== "object" || types.isProxy(value) || NATIVE_ABORTED_GETTER === undefined || NATIVE_REASON_GETTER === undefined) integrity();
  try { if (typeof NATIVE_ABORTED_GETTER.call(value) !== "boolean") integrity(); void NATIVE_REASON_GETTER.call(value); } catch { integrity(); }
  return value as AbortSignal;
}
export function abortSignalAborted(signal: AbortSignal): boolean { return NATIVE_ABORTED_GETTER?.call(signal) === true; }
export function abortSignalReason(signal: AbortSignal): unknown { return NATIVE_REASON_GETTER?.call(signal); }

function exactObject(value: unknown, keys: readonly string[]): Record<string, unknown> { return exactObjectOneOf(value, [keys]); }
function exactObjectOneOf(value: unknown, shapes: readonly (readonly string[])[]): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value) || types.isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype || Object.getOwnPropertySymbols(value).length !== 0) integrity();
  const descriptors = Object.getOwnPropertyDescriptors(value); const keys = Object.keys(descriptors);
  const shape = shapes.find((candidate) => keys.length === candidate.length && candidate.every((key) => keys.includes(key)));
  if (shape === undefined) integrity();
  const result = Object.create(null) as Record<string, unknown>;
  for (const key of shape) { const descriptor = descriptors[key]; if (descriptor?.enumerable !== true || !("value" in descriptor)) integrity(); result[key] = descriptor.value; }
  return result;
}
function denseTextArray(value: unknown, maximumItems: number, maximumBytes: number): readonly string[] {
  if (!Array.isArray(value) || types.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > maximumItems || Object.getOwnPropertySymbols(value).length !== 0) integrity();
  const descriptors = Object.getOwnPropertyDescriptors(value); if (Object.keys(descriptors).length !== value.length + 1) integrity();
  const copy: string[] = [];
  for (let index = 0; index < value.length; index += 1) { const descriptor = descriptors[String(index)]; if (descriptor?.enumerable !== true || !("value" in descriptor) || !wellFormedText(descriptor.value) || utf8Bytes(descriptor.value) < 1 || utf8Bytes(descriptor.value) > maximumBytes) integrity(); copy.push(descriptor.value); }
  return Object.freeze(copy);
}
function identifier(value: unknown): value is string { return typeof value === "string" && /^[a-z][a-z0-9-]{0,63}$/.test(value); }
function unsigned(value: unknown): value is string { return typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value); }
function isSha256(value: unknown): value is string { return typeof value === "string" && /^[a-f0-9]{64}$/.test(value); }
function wellFormedText(value: unknown): value is string { return typeof value === "string" && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(value); }
function utf8Bytes(value: string): number { return new TextEncoder().encode(value).byteLength; }
function integrity(): never { throw new SourceObservationError("source_observation_integrity_failed"); }
