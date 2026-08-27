import type { FrontierMarker } from "./country-verifier";
import { reconstructFormalResidenceVerdict } from "../decision/formal-residence-verdict";
import {
  COUNTRY_RESOLUTION_RULES_VERSION,
  deriveYellowUncertaintyBasis,
} from "../decision/country-resolution-policy";
import type {
  ResolutionMarkerProjection,
  ResolutionStopCondition,
  YellowDecision,
  YellowDecisionKind,
} from "../decision/country-resolution-policy";

function integrityMismatch(): never {
  throw new Error("integrity_mismatch");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: object, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index]);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isCountryCode(value: unknown): value is string {
  return typeof value === "string" && /^[A-Z]{2}$/.test(value);
}

function isCanonicalDay(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function isCanonicalInstant(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString() === value;
}

function reconstructFrontierCountry(value: unknown): FrontierMarker["country"] {
  if (!isRecord(value) || !hasExactKeys(value, ["countryCode", "label", "flag", "coordinate"]) ||
    !isCountryCode(value.countryCode) || !isNonEmptyString(value.label) ||
    !isNonEmptyString(value.flag) || !isRecord(value.coordinate) ||
    !hasExactKeys(value.coordinate, ["lat", "lng"]) ||
    typeof value.coordinate.lat !== "number" || !Number.isFinite(value.coordinate.lat) ||
    value.coordinate.lat < -90 || value.coordinate.lat > 90 ||
    typeof value.coordinate.lng !== "number" || !Number.isFinite(value.coordinate.lng) ||
    value.coordinate.lng < -180 || value.coordinate.lng > 180) integrityMismatch();
  return structuredClone(value) as unknown as FrontierMarker["country"];
}

export function reconstructFrontierMarker(
  value: unknown,
  expected?: {
    readonly profileSnapshotId?: string;
    readonly evidenceSnapshotId?: string;
  },
): FrontierMarker {
  if (!isRecord(value) || !hasExactKeys(value, [
    "country", "rank", "countryCheckRunId", "sourceAssessmentRulesVersion", "lastCheckedAt",
    "evidenceSnapshotId", ...(value.currentKnowledgeRevisionId === undefined
      ? []
      : ["currentKnowledgeRevisionId"]), ...(value.updatedKnowledgeRevisionId === undefined
      ? []
      : ["updatedKnowledgeRevisionId"]), ...(value.knowledgeUpdatedAt === undefined
      ? []
      : ["knowledgeUpdatedAt"]), "formalVerdict",
  ]) || !Number.isInteger(value.rank) || (value.rank as number) < 1 ||
    !isNonEmptyString(value.countryCheckRunId) ||
    value.sourceAssessmentRulesVersion !== "cold-start-assessment@1" ||
    !isCanonicalDay(value.lastCheckedAt) || !isNonEmptyString(value.evidenceSnapshotId) ||
    (value.currentKnowledgeRevisionId !== undefined &&
      !isNonEmptyString(value.currentKnowledgeRevisionId)) ||
    (value.updatedKnowledgeRevisionId !== undefined &&
      !isNonEmptyString(value.updatedKnowledgeRevisionId)) ||
    (value.knowledgeUpdatedAt !== undefined && !isCanonicalInstant(value.knowledgeUpdatedAt)) ||
    (value.currentKnowledgeRevisionId === undefined) !== (value.knowledgeUpdatedAt === undefined) ||
    (value.updatedKnowledgeRevisionId !== undefined &&
      value.updatedKnowledgeRevisionId !== value.currentKnowledgeRevisionId) ||
    (expected?.evidenceSnapshotId !== undefined &&
      expected.evidenceSnapshotId !== value.evidenceSnapshotId)) integrityMismatch();
  const formalVerdict = reconstructFormalResidenceVerdict(value.formalVerdict, {
    ...expected,
    evidenceSnapshotId: value.evidenceSnapshotId,
  });
  return structuredClone({
    ...value,
    country: reconstructFrontierCountry(value.country),
    formalVerdict,
  }) as FrontierMarker;
}

export function countryResolutionMarkerProjection(
  markerInput: FrontierMarker,
  integrity: ResolutionIntegrity,
  expected?: {
    readonly profileSnapshotId?: string;
    readonly evidenceSnapshotId?: string;
  },
): ResolutionMarkerProjection {
  const marker = reconstructFrontierMarker(markerInput, expected);
  return {
    countryCode: marker.country.countryCode,
    rank: marker.rank,
    formalStatus: marker.formalVerdict.marker,
    formalMarkerDigest: integrity.hash(integrity.canonical(marker)),
    ...(marker.formalVerdict.marker === "yellow"
      ? { expectedUncertaintyBasis: deriveYellowUncertaintyBasis(marker.formalVerdict) }
      : {}),
  };
}

export interface ResolutionSourceBinding {
  readonly automaticShortlistSnapshotId: string;
  readonly rankingSnapshotId: string;
  readonly profileSnapshotId: string;
  readonly preferenceProfileSnapshotId: string;
}

export interface ResolvedCountryEntry {
  readonly countryCode: string;
  readonly rank: number;
  readonly formalMarkerDigest: string;
}

export interface CountryResolutionSemanticContext {
  readonly source: ResolutionSourceBinding;
  readonly orderedCountryCodes: readonly string[];
  readonly markerProjections: readonly ResolutionMarkerProjection[];
}

export interface CountryResolutionChainLocator {
  readonly resolutionRunId: string;
  readonly source: ResolutionSourceBinding;
  readonly revisions: readonly CountryResolutionRevision[];
}

interface CountryResolutionRevisionBase extends ResolutionSourceBinding {
  readonly schemaVersion: "country-resolution@1";
  readonly rulesVersion: "country-resolution@1";
  readonly id: string;
  readonly resolutionRunId: string;
  readonly predecessorRevisionId?: string;
  readonly decisions: readonly YellowDecision[];
  readonly replacementMarkers: readonly FrontierMarker[];
  readonly nextUncheckedRank: number;
  readonly unresolvedCountryCodes: readonly string[];
  readonly slotCountryCodes: readonly string[];
  readonly contextHash: string;
  readonly createdAt: string;
}

export interface WorkingCountryResolutionRevision extends CountryResolutionRevisionBase {
  readonly kind: "working";
  readonly phase: "awaiting_decision" | "replacement_required";
}

export interface ResolvedCountryShortlistSnapshot extends CountryResolutionRevisionBase {
  readonly kind: "resolved";
  readonly resolvedEntries: readonly ResolvedCountryEntry[];
  readonly stopCondition: ResolutionStopCondition;
}

export type CountryResolutionRevision =
  | WorkingCountryResolutionRevision
  | ResolvedCountryShortlistSnapshot;

export interface ResolutionIntegrity {
  canonical(value: unknown): string;
  hash(value: string): string;
}

export type CountryResolutionOperation =
  | {
      readonly commandId: string;
      readonly kind: "start";
      readonly automaticShortlistSnapshotId: string;
    }
  | {
      readonly commandId: string;
      readonly kind: "yellow_decision";
      readonly expectedHeadRevisionId: string;
      readonly countryCode: string;
      readonly decision: YellowDecisionKind;
      readonly warningCopyVersion: "yellow-risk@1";
    }
  | {
      readonly commandId: string;
      readonly kind: "replacement_completed";
      readonly expectedHeadRevisionId: string;
      readonly countryCode: string;
      readonly countryCheckRunId: string;
    };

export function countryResolutionStartCommandId(
  automaticShortlistSnapshotId: string,
  integrity: ResolutionIntegrity,
): string {
  return `country-resolution:start:${integrity.hash(automaticShortlistSnapshotId)}`;
}

export function countryResolutionRunId(
  automaticShortlistSnapshotId: string,
  integrity: ResolutionIntegrity,
): string {
  return `country-resolution:${integrity.hash(integrity.canonical({
    automaticShortlistSnapshotId,
    rulesVersion: COUNTRY_RESOLUTION_RULES_VERSION,
  }))}`;
}

export function countryResolutionContextHash(input: {
  readonly resolutionRunId: string;
  readonly source: ResolutionSourceBinding;
  readonly predecessorRevisionId?: string;
  readonly operation: CountryResolutionOperation;
  readonly rulesVersion: "country-resolution@1";
}, integrity: ResolutionIntegrity): string {
  return integrity.hash(integrity.canonical(input));
}

export function countryResolutionRevisionId(
  resolutionRunId: string,
  operation: CountryResolutionOperation,
  integrity: ResolutionIntegrity,
): string {
  return `country-resolution-revision:${integrity.hash(integrity.canonical({
    resolutionRunId,
    operation,
  }))}`;
}

export interface CountryResolutionStorePort {
  append(input: {
    readonly revision: CountryResolutionRevision;
    readonly operation: CountryResolutionOperation;
    readonly context: CountryResolutionSemanticContext;
  }): CountryResolutionRevision;
  loadRevisionVerified(id: string, context: CountryResolutionSemanticContext): CountryResolutionRevision;
  loadHeadVerified(resolutionRunId: string, context: CountryResolutionSemanticContext): CountryResolutionRevision;
  loadChainVerified(
    resolutionRunId: string,
    context: CountryResolutionSemanticContext,
  ): readonly CountryResolutionRevision[];
  findByCommandVerified(
    resolutionRunId: string,
    commandId: string,
    context: CountryResolutionSemanticContext,
  ): { readonly revision: CountryResolutionRevision; readonly operation: CountryResolutionOperation } | undefined;
  findRootForRunVerified(
    resolutionRunId: string,
    context: CountryResolutionSemanticContext,
  ): CountryResolutionRevision | undefined;
  locateChainVerified(input:
    | { readonly resolutionRunId: string }
    | { readonly revisionId: string }
  ): CountryResolutionChainLocator;
}
