import { types } from "node:util";

import {
  createCityBranchCommit,
  reconstructPreCityBranchCommit,
  replayCityBranchCommit,
  type CityBranchSelectionProjection,
  type CityBranchCommit,
  type PreCityBranchCommit,
} from "../branch/city";
import {
  reconstructCityCatalog,
  type CityCatalogRevision,
  type CityRegistryRevision,
} from "../decision/city-catalog";
import {
  CITY_CRITERION_IDS,
  reconstructCityCriteria,
  type CityCriteriaSnapshot,
  type CityCriterionEvaluatorRegistry,
  type CityCriterionDefinition,
  type CityCriterionDraft,
  type CityCriterionEvaluation,
  type CityCriterionEvaluationInput,
  type CityCriterionId,
  type CityRankingFactInput,
} from "../decision/city-criteria";
import type { CityDecisionIntegrity } from "../decision/city-integrity";
import type {
  CityFrontierProjection,
  CityFrontierStopCondition,
  CityFrontierVerificationBudget,
  CityLiveMarker,
  CityTerminalEntry,
  CityUnknownWarning,
} from "../decision/city-frontier-policy";
import {
  reconstructCityRanking,
  type CityKnowledgeRankingProjection,
  type RankedCity,
  type ScreenedCityExclusion,
} from "../decision/city-ranker";
import type { CitySelectionProjection } from "../decision/city-selection";
import type { InstalledCityPackageExactKey } from "../research/city-package";

export interface CityRankingSnapshot {
  readonly schemaVersion: "city-ranking@1";
  readonly id: string;
  readonly runId: string;
  readonly resolvedCountryShortlistRevisionId: string;
  readonly countryCode: string;
  readonly packageId: string;
  readonly packageSchemaVersion: string;
  readonly preCityBranchCommitId: string;
  readonly profileSnapshotId: string;
  readonly preferenceProfileSnapshotId: string;
  readonly registryRevisionId: string;
  readonly catalogRevisionId: string;
  readonly installedPackageContext: InstalledCityPackageExactKey;
  readonly criteriaSnapshotId: string;
  readonly assessmentAt: string;
  readonly knowledgeRevisionIds: Readonly<Record<string, string | null>>;
  readonly ordered: readonly RankedCity[];
  readonly screenedExclusions: readonly ScreenedCityExclusion[];
  readonly rulesVersion: "city-ranker@1";
  readonly verificationBudget: CityFrontierVerificationBudget;
  readonly createdAt: string;
}

export type CityRankingSnapshotPayload = Omit<CityRankingSnapshot, "id">;

export interface CityRankingSemanticInputs {
  readonly registry: CityRegistryRevision;
  readonly catalog: CityCatalogRevision;
  readonly criteria: CityCriteriaSnapshot;
  readonly knowledge: readonly CityKnowledgeRankingProjection[];
  readonly evaluators: CityCriterionEvaluatorRegistry;
}

export type CityFrontierOperation =
  | {
      readonly kind: "start";
      readonly commandId: string;
      readonly criteriaPayloadHash: string;
    }
  | {
      readonly kind: "city_completed";
      readonly commandId: string;
      readonly expectedHeadRevisionId: string;
      readonly cityId: string;
      readonly cityCheckRunId: string;
    };

export interface WorkingCityFrontierRevision {
  readonly schemaVersion: "city-frontier@1";
  readonly kind: "working";
  readonly id: string;
  readonly runId: string;
  readonly predecessorRevisionId?: string;
  readonly rankingSnapshotId: string;
  readonly markers: readonly CityLiveMarker[];
  readonly nextUncheckedRank: number;
  readonly phase: "verification_required";
  readonly operation: CityFrontierOperation;
  readonly createdAt: string;
}

export interface TerminalCityShortlistSnapshot {
  readonly schemaVersion: "city-frontier@1";
  readonly kind: "terminal";
  readonly id: string;
  readonly runId: string;
  readonly predecessorRevisionId?: string;
  readonly rankingSnapshotId: string;
  readonly markers: readonly CityLiveMarker[];
  readonly nextUncheckedRank: number;
  readonly entries: readonly CityTerminalEntry[];
  readonly stopCondition: CityFrontierStopCondition;
  readonly operation: CityFrontierOperation;
  readonly createdAt: string;
}

export type CityFrontierRevision =
  | WorkingCityFrontierRevision
  | TerminalCityShortlistSnapshot;

export type CityFrontierRevisionPayload =
  | Omit<WorkingCityFrontierRevision, "id">
  | Omit<TerminalCityShortlistSnapshot, "id">;

export interface SealCityFrontierRevisionInput {
  readonly runId: string;
  readonly predecessorRevisionId?: string;
  readonly rankingSnapshotId: string;
  readonly markers: readonly CityLiveMarker[];
  readonly projection: CityFrontierProjection;
  readonly operation: CityFrontierOperation;
  readonly createdAt: string;
}

export type CityFrontierReadModel = CityFrontierRevision;

export type CityFrontierEvent =
  | {
      readonly type: "city_activated";
      readonly runId: string;
      readonly baseRevisionId: string;
      readonly sequence: number;
      readonly occurredAt: string;
      readonly cityId: string;
      readonly rank: number;
    }
  | {
      readonly type: "city_progress";
      readonly runId: string;
      readonly baseRevisionId: string;
      readonly sequence: number;
      readonly occurredAt: string;
      readonly cityId: string;
      readonly stage: string;
      readonly label: string;
      readonly detail?: string;
      readonly sourceUrl?: string;
    }
  | {
      readonly type: "city_revision_committed";
      readonly runId: string;
      readonly baseRevisionId: string;
      readonly sequence: number;
      readonly occurredAt: string;
      readonly marker: CityLiveMarker;
      readonly revision: CityFrontierRevision;
    }
  | {
      readonly type: "city_continuation_completed";
      readonly runId: string;
      readonly baseRevisionId: string;
      readonly sequence: number;
      readonly occurredAt: string;
      readonly readModel: CityFrontierReadModel;
    };

export interface CitySelectionWithBranch {
  readonly selection: CitySelectionSnapshot;
  readonly commit: CityBranchCommit;
}

export interface CitySelectionSnapshot {
  readonly schemaVersion: "city-selection@1";
  readonly id: string;
  readonly commandId: string;
  readonly runId: string;
  readonly terminalRevisionId: string;
  readonly cityId: string;
  readonly countryCode: string;
  readonly profileSnapshotId: string;
  readonly preferenceProfileSnapshotId: string;
  readonly resolvedCountryShortlistRevisionId: string;
  readonly criteriaSnapshotId: string;
  readonly rankingSnapshotId: string;
  readonly preCityBranchCommitId: string;
  readonly selectedMarkerDigest: string;
  readonly knowledgeRevisionId: string;
  readonly evidenceSnapshotId: string;
  readonly unknownBasis: readonly CityUnknownWarning[];
  readonly warningCopyVersion?: "city-unknown-risk@1";
  readonly createdAt: string;
}

export type CitySelectionSnapshotPayload = Omit<CitySelectionSnapshot, "id">;

export interface CitySelectionAuthority {
  readonly terminal: TerminalCityShortlistSnapshot;
  readonly ranking: CityRankingSnapshot;
  readonly preCityBranch: PreCityBranchCommit;
}

export interface CreateCitySelectionWithBranchInput extends CitySelectionAuthority {
  readonly commandId: string;
  readonly selection: CitySelectionProjection;
  readonly createdAt: string;
}

type PlainRecord = Record<string, unknown>;

interface CapturedIntegrity {
  readonly canonical: (value: unknown) => string;
  readonly hash: (canonicalText: string) => string;
}

const LOWERCASE_DIGEST = /^[0-9a-f]{64}$/;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f-\u009f]/;
const UNKNOWN_REASONS = [
  "not_found",
  "stale",
  "conflict",
  "not_comparable",
  "source_unavailable",
] as const;
const STOP_CONDITIONS: readonly CityFrontierStopCondition[] = [
  "three_selectable",
  "catalog_exhausted",
  "live_candidate_limit_reached",
];
const LINK_REJECTION_REASONS = [
  "http_not_found",
  "transport_unavailable",
  "authority_untrusted",
  "stale",
  "scope_mismatch",
  "definition_mismatch",
  "missing_numerator",
  "denominator_missing",
  "denominator_zero",
  "denominator_period_mismatch",
  "denominator_scope_mismatch",
  "wrong_media_type",
  "too_large",
  "untrusted_redirect",
  "retention_unapproved",
  "conflict",
] as const;

const RANKING_PAYLOAD_KEYS = [
  "schemaVersion",
  "runId",
  "resolvedCountryShortlistRevisionId",
  "countryCode",
  "packageId",
  "packageSchemaVersion",
  "preCityBranchCommitId",
  "profileSnapshotId",
  "preferenceProfileSnapshotId",
  "registryRevisionId",
  "catalogRevisionId",
  "installedPackageContext",
  "criteriaSnapshotId",
  "assessmentAt",
  "knowledgeRevisionIds",
  "ordered",
  "screenedExclusions",
  "rulesVersion",
  "verificationBudget",
  "createdAt",
] as const;

const SELECTION_PAYLOAD_KEYS = [
  "schemaVersion",
  "commandId",
  "runId",
  "terminalRevisionId",
  "cityId",
  "countryCode",
  "profileSnapshotId",
  "preferenceProfileSnapshotId",
  "resolvedCountryShortlistRevisionId",
  "criteriaSnapshotId",
  "rankingSnapshotId",
  "preCityBranchCommitId",
  "selectedMarkerDigest",
  "knowledgeRevisionId",
  "evidenceSnapshotId",
  "unknownBasis",
  "createdAt",
] as const;

function mismatch(): never {
  throw new Error("integrity_mismatch");
}

function atBoundary<T>(operation: () => T): T {
  try {
    return operation();
  } catch {
    throw new Error("integrity_mismatch");
  }
}

function ownData<T>(borrowed: T): T {
  const active = new Set<object>();

  const visit = (value: unknown): unknown => {
    if (value === null || value === undefined || typeof value === "string" ||
      typeof value === "number" || typeof value === "boolean") {
      return value;
    }
    if (typeof value !== "object" || types.isProxy(value) || active.has(value)) mismatch();
    if (Object.getOwnPropertySymbols(value).length !== 0) mismatch();

    active.add(value);
    try {
      if (Array.isArray(value)) {
        if (Object.getPrototypeOf(value) !== Array.prototype) mismatch();
        const length = Object.getOwnPropertyDescriptor(value, "length");
        if (length === undefined || !("value" in length) ||
          !Number.isSafeInteger(length.value) || length.value < 0 ||
          Object.getOwnPropertyNames(value).length !== length.value + 1) {
          mismatch();
        }
        const copy: unknown[] = [];
        for (let index = 0; index < length.value; index += 1) {
          const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
          if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
            mismatch();
          }
          copy.push(visit(descriptor.value));
        }
        return copy;
      }

      if (Object.getPrototypeOf(value) !== Object.prototype) mismatch();
      const copy: PlainRecord = {};
      for (const key of Object.getOwnPropertyNames(value)) {
        if (key === "__proto__") mismatch();
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
          mismatch();
        }
        copy[key] = visit(descriptor.value);
      }
      return copy;
    } finally {
      active.delete(value);
    }
  };

  return visit(borrowed) as T;
}

function exactRootValues(value: unknown, keys: readonly string[]): PlainRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value) ||
    types.isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype ||
    Object.getOwnPropertySymbols(value).length !== 0) {
    mismatch();
  }
  const actual = Object.getOwnPropertyNames(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])) {
    mismatch();
  }
  const captured: PlainRecord = {};
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
      mismatch();
    }
    captured[key] = descriptor.value;
  }
  return captured;
}

function captureIntegrity(borrowed: CityDecisionIntegrity): CapturedIntegrity {
  if (borrowed === null || typeof borrowed !== "object" || Array.isArray(borrowed) ||
    types.isProxy(borrowed) || Object.getPrototypeOf(borrowed) !== Object.prototype ||
    Object.getOwnPropertySymbols(borrowed).length !== 0) {
    mismatch();
  }
  const canonical = Object.getOwnPropertyDescriptor(borrowed, "canonical");
  const hash = Object.getOwnPropertyDescriptor(borrowed, "hash");
  if (canonical === undefined || !("value" in canonical) || !canonical.enumerable ||
    typeof canonical.value !== "function" || types.isProxy(canonical.value) ||
    hash === undefined || !("value" in hash) || !hash.enumerable ||
    typeof hash.value !== "function" || types.isProxy(hash.value)) {
    mismatch();
  }
  return Object.freeze({
    canonical: canonical.value as (value: unknown) => string,
    hash: hash.value as (canonicalText: string) => string,
  });
}

function integrityView(integrity: CapturedIntegrity): CityDecisionIntegrity {
  return Object.freeze({ canonical: integrity.canonical, hash: integrity.hash });
}

function deepFreeze<T>(value: T, seen = new Set<object>()): T {
  if (value === null || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor)) mismatch();
    deepFreeze(descriptor.value, seen);
  }
  return Object.freeze(value);
}

function hashOwned(value: unknown, integrity: CapturedIntegrity): string {
  const canonical = Reflect.apply(
    integrity.canonical,
    Object.freeze({ capability: "canonical" }),
    [deepFreeze(value)],
  ) as unknown;
  if (typeof canonical !== "string") mismatch();
  const result = Reflect.apply(
    integrity.hash,
    Object.freeze({ capability: "hash" }),
    [canonical],
  ) as unknown;
  if (typeof result !== "string" || !LOWERCASE_DIGEST.test(result)) mismatch();
  return result;
}

function exactRecord(value: unknown, keys: readonly string[]): PlainRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype) {
    mismatch();
  }
  const actual = Object.getOwnPropertyNames(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])) {
    mismatch();
  }
  return value as PlainRecord;
}

function denseArray(value: unknown, expectedLength?: number): readonly unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype ||
    (expectedLength !== undefined && value.length !== expectedLength)) {
    mismatch();
  }
  return value;
}

function text(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value ||
    CONTROL_CHARACTER.test(value)) {
    mismatch();
  }
  return value;
}

function requireCanonicalTextScalars(value: unknown): void {
  if (typeof value === "string") {
    text(value);
    return;
  }
  if (value === null || value === undefined || typeof value !== "object") return;
  for (const key of Object.getOwnPropertyNames(value)) {
    if (Array.isArray(value) && key === "length") continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor)) mismatch();
    requireCanonicalTextScalars(descriptor.value);
  }
}

function countryCode(value: unknown): string {
  const country = text(value);
  if (!/^[A-Z]{2}$/.test(country)) mismatch();
  return country;
}

function positiveInteger(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) mismatch();
  return value;
}

function digest(value: unknown): string {
  if (typeof value !== "string" || !LOWERCASE_DIGEST.test(value)) mismatch();
  return value;
}

function instant(value: unknown): string {
  const candidate = text(value);
  try {
    if (new Date(candidate).toISOString() !== candidate) mismatch();
  } catch {
    mismatch();
  }
  return candidate;
}

function contentIdentifier(value: unknown, prefix: string): string {
  const identifier = text(value);
  if (!identifier.startsWith(`${prefix}:`) ||
    !LOWERCASE_DIGEST.test(identifier.slice(prefix.length + 1))) {
    mismatch();
  }
  return identifier;
}

function criterionId(value: unknown): CityCriterionId {
  if (!CITY_CRITERION_IDS.includes(value as CityCriterionId)) mismatch();
  return value as CityCriterionId;
}

function unknownReason(value: unknown): (typeof UNKNOWN_REASONS)[number] {
  if (!UNKNOWN_REASONS.includes(value as (typeof UNKNOWN_REASONS)[number])) mismatch();
  return value as (typeof UNKNOWN_REASONS)[number];
}

function dataEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (left === null || right === null || typeof left !== "object" ||
    typeof right !== "object" || Array.isArray(left) !== Array.isArray(right)) {
    return false;
  }
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length &&
      left.every((item, index) => dataEqual(item, right[index]));
  }
  const leftRecord = left as PlainRecord;
  const rightRecord = right as PlainRecord;
  const leftKeys = Object.getOwnPropertyNames(leftRecord).sort();
  const rightKeys = Object.getOwnPropertyNames(rightRecord).sort();
  return leftKeys.length === rightKeys.length &&
    leftKeys.every((key, index) => key === rightKeys[index] &&
      dataEqual(leftRecord[key], rightRecord[key]));
}

function validateBasis(value: unknown): void {
  if (value === null || typeof value !== "object" || Array.isArray(value)) mismatch();
  const candidate = value as PlainRecord;
  if (candidate.kind === "canonical_scalar") {
    const basis = exactRecord(candidate, ["kind", "value"]);
    text(basis.value);
    return;
  }
  if (candidate.kind === "municipal_safety") {
    const basis = exactRecord(candidate, ["kind", "quantity"]);
    const quantity = exactRecord(basis.quantity, [
      "offenceCount",
      "population",
      "rateBasis",
    ]);
    const offenceCount = text(quantity.offenceCount);
    const population = text(quantity.population);
    if (!/^(?:0|[1-9]\d*)$/.test(offenceCount) ||
      !/^[1-9]\d*$/.test(population) ||
      quantity.rateBasis !== "offences_per_100000_residents") {
      mismatch();
    }
    return;
  }
  mismatch();
}

function validateUnknownWarning(value: unknown): void {
  const warning = exactRecord(value, ["criterionId", "definitionId", "reason"]);
  criterionId(warning.criterionId);
  text(warning.definitionId);
  unknownReason(warning.reason);
}

function validateRequiredMismatch(value: unknown): void {
  const required = exactRecord(value, [
    "criterionId",
    "definitionId",
    "target",
    "verifiedBasis",
    "evaluatorVersion",
  ]);
  criterionId(required.criterionId);
  text(required.definitionId);
  text(required.target);
  validateBasis(required.verifiedBasis);
  text(required.evaluatorVersion);
}

function optionalReferenceYear(value: unknown): void {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) mismatch();
}

function validateFactLink(
  value: unknown,
  expectedDisposition: "accepted" | "reviewed_rejected",
): void {
  if (value === null || typeof value !== "object" || Array.isArray(value)) mismatch();
  const candidate = value as PlainRecord;
  const hasResolved = Object.prototype.hasOwnProperty.call(candidate, "resolvedEvidenceUrl");
  const hasYear = Object.prototype.hasOwnProperty.call(candidate, "referenceYear");
  const hasReason = Object.prototype.hasOwnProperty.call(candidate, "rejectionReason");
  if (expectedDisposition === "accepted") {
    if (candidate.disposition !== "accepted") mismatch();
    if (hasReason) mismatch();
    const link = exactRecord(candidate, [
      "sourceId",
      "disposition",
      "navigationUrl",
      "resolvedEvidenceUrl",
      ...(hasYear ? ["referenceYear"] : []),
    ]);
    text(link.sourceId);
    text(link.navigationUrl);
    text(link.resolvedEvidenceUrl);
    if (hasYear) optionalReferenceYear(link.referenceYear);
    return;
  }
  if (candidate.disposition !== "reviewed_rejected") mismatch();
  const link = exactRecord(candidate, [
    "sourceId",
    "disposition",
    "navigationUrl",
    ...(hasResolved ? ["resolvedEvidenceUrl"] : []),
    ...(hasYear ? ["referenceYear"] : []),
    ...(hasReason ? ["rejectionReason"] : []),
  ]);
  text(link.sourceId);
  text(link.navigationUrl);
  if (hasResolved) text(link.resolvedEvidenceUrl);
  if (hasYear) optionalReferenceYear(link.referenceYear);
  if (hasReason && !LINK_REJECTION_REASONS.includes(
    link.rejectionReason as (typeof LINK_REJECTION_REASONS)[number],
  )) {
    mismatch();
  }
}

function validateFactOutcome(value: unknown): void {
  if (value === null || typeof value !== "object" || Array.isArray(value)) mismatch();
  const candidate = value as PlainRecord;
  if (candidate.kind === "verified") {
    const outcome = exactRecord(candidate, ["kind", "basis"]);
    validateBasis(outcome.basis);
    return;
  }
  if (candidate.kind === "unknown") {
    const outcome = exactRecord(candidate, ["kind", "reason"]);
    unknownReason(outcome.reason);
    return;
  }
  mismatch();
}

function validateCommittedFact(value: unknown): void {
  const fact = exactRecord(value, [
    "criterionId",
    "definitionId",
    "geoScope",
    "referencePeriod",
    "freshnessBasis",
    "unit",
    "denominator",
    "outcome",
    "evidenceLinks",
    "manualCheckLinks",
  ]);
  criterionId(fact.criterionId);
  text(fact.definitionId);
  text(fact.geoScope);
  if (fact.referencePeriod !== null) text(fact.referencePeriod);
  text(fact.freshnessBasis);
  text(fact.unit);
  text(fact.denominator);
  validateFactOutcome(fact.outcome);
  for (const link of denseArray(fact.evidenceLinks)) validateFactLink(link, "accepted");
  for (const link of denseArray(fact.manualCheckLinks)) {
    validateFactLink(link, "reviewed_rejected");
  }
}

function parseLiveMarker(value: unknown): CityLiveMarker {
  const marker = exactRecord(value, [
    "cityId",
    "rank",
    "status",
    "visualStatus",
    "knowledgeRevisionId",
    "evidenceSnapshotId",
    "lastCheckedAt",
    "requiredMismatches",
    "unknownBasis",
    "verificationCoverage",
    "facts",
  ]);
  text(marker.cityId);
  positiveInteger(marker.rank);
  if (marker.status !== "selectable" && marker.status !== "excluded") mismatch();
  if (marker.visualStatus !== "green" && marker.visualStatus !== "yellow" &&
    marker.visualStatus !== "red") {
    mismatch();
  }
  text(marker.knowledgeRevisionId);
  text(marker.evidenceSnapshotId);
  instant(marker.lastCheckedAt);
  for (const required of denseArray(marker.requiredMismatches)) {
    validateRequiredMismatch(required);
  }
  for (const warning of denseArray(marker.unknownBasis)) validateUnknownWarning(warning);
  text(marker.verificationCoverage);
  for (const fact of denseArray(marker.facts, CITY_CRITERION_IDS.length)) {
    validateCommittedFact(fact);
  }
  return marker as unknown as CityLiveMarker;
}

function validateRankingFactor(value: unknown): void {
  if (value === null || typeof value !== "object" || Array.isArray(value)) mismatch();
  const factor = value as PlainRecord;
  const hasUnknownReason = Object.prototype.hasOwnProperty.call(factor, "unknownReason");
  const exactFactor = exactRecord(factor, [
    "criterionId",
    "definitionId",
    "mode",
    "importance",
    "evaluatorVersion",
    "freshnessPolicyVersion",
    "state",
    "factor",
    "weightedContribution",
    "targetComparison",
    "requiredMismatch",
    ...(hasUnknownReason ? ["unknownReason"] : []),
  ]);
  criterionId(exactFactor.criterionId);
  text(exactFactor.definitionId);
  if (exactFactor.mode !== "required" && exactFactor.mode !== "weighted") mismatch();
  if (![1, 2, 3, 4, 5].includes(exactFactor.importance as number)) mismatch();
  text(exactFactor.evaluatorVersion);
  text(exactFactor.freshnessPolicyVersion);
  if (exactFactor.state !== "verified" && exactFactor.state !== "unknown") mismatch();
  text(exactFactor.factor);
  text(exactFactor.weightedContribution);
  if (exactFactor.targetComparison !== "matches" &&
    exactFactor.targetComparison !== "does_not_match" &&
    exactFactor.targetComparison !== "unknown") {
    mismatch();
  }
  if (typeof exactFactor.requiredMismatch !== "boolean") mismatch();
  if (hasUnknownReason) {
    if (exactFactor.unknownReason === "no_knowledge_revision") return;
    unknownReason(exactFactor.unknownReason);
  }
}

function validateRankedCity(value: unknown): void {
  const city = exactRecord(value, [
    "cityId",
    "rank",
    "score",
    "coverage",
    "knowledgeRevisionId",
    "factors",
  ]);
  text(city.cityId);
  positiveInteger(city.rank);
  text(city.score);
  text(city.coverage);
  if (city.knowledgeRevisionId !== null) text(city.knowledgeRevisionId);
  for (const factor of denseArray(city.factors, CITY_CRITERION_IDS.length)) {
    validateRankingFactor(factor);
  }
}

function validateScreenedExclusion(value: unknown): void {
  const city = exactRecord(value, [
    "cityId",
    "score",
    "coverage",
    "knowledgeRevisionId",
    "requiredMismatches",
    "factors",
  ]);
  text(city.cityId);
  text(city.score);
  text(city.coverage);
  if (city.knowledgeRevisionId !== null) text(city.knowledgeRevisionId);
  for (const required of denseArray(city.requiredMismatches)) {
    validateRequiredMismatch(required);
  }
  for (const factor of denseArray(city.factors, CITY_CRITERION_IDS.length)) {
    validateRankingFactor(factor);
  }
}

function validateInstalledContext(
  value: unknown,
  payload: PlainRecord,
): void {
  const context = exactRecord(value, [
    "countryCode",
    "packageId",
    "packageSchemaVersion",
    "catalogRevisionId",
    "evidenceRulesVersion",
  ]);
  countryCode(context.countryCode);
  text(context.packageId);
  text(context.packageSchemaVersion);
  text(context.catalogRevisionId);
  text(context.evidenceRulesVersion);
  if (context.countryCode !== payload.countryCode ||
    context.packageId !== payload.packageId ||
    context.packageSchemaVersion !== payload.packageSchemaVersion ||
    context.catalogRevisionId !== payload.catalogRevisionId) {
    mismatch();
  }
}

function validateVerificationBudget(value: unknown): void {
  const budget = exactRecord(value, [
    "liveCityCandidateLimit",
    "targetSelectableCities",
    "rulesVersion",
  ]);
  if (budget.liveCityCandidateLimit !== 10 || budget.targetSelectableCities !== 3 ||
    budget.rulesVersion !== "city-frontier-budget@1") {
    mismatch();
  }
}

function validateKnowledgeRevisionIds(value: unknown): void {
  if (value === null || typeof value !== "object" || Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype) {
    mismatch();
  }
  for (const key of Object.getOwnPropertyNames(value)) {
    text(key);
    const revision = (value as PlainRecord)[key];
    if (revision !== null) text(revision);
  }
}

function parseRankingPayload(value: unknown): CityRankingSnapshotPayload {
  const payload = exactRecord(value, RANKING_PAYLOAD_KEYS);
  if (payload.schemaVersion !== "city-ranking@1" ||
    payload.rulesVersion !== "city-ranker@1") {
    mismatch();
  }
  text(payload.runId);
  text(payload.resolvedCountryShortlistRevisionId);
  countryCode(payload.countryCode);
  text(payload.packageId);
  text(payload.packageSchemaVersion);
  text(payload.preCityBranchCommitId);
  text(payload.profileSnapshotId);
  text(payload.preferenceProfileSnapshotId);
  text(payload.registryRevisionId);
  text(payload.catalogRevisionId);
  validateInstalledContext(payload.installedPackageContext, payload);
  text(payload.criteriaSnapshotId);
  instant(payload.assessmentAt);
  validateKnowledgeRevisionIds(payload.knowledgeRevisionIds);
  for (const city of denseArray(payload.ordered)) validateRankedCity(city);
  for (const city of denseArray(payload.screenedExclusions)) {
    validateScreenedExclusion(city);
  }
  validateVerificationBudget(payload.verificationBudget);
  instant(payload.createdAt);
  return payload as unknown as CityRankingSnapshotPayload;
}

function rankingPayloadOf(snapshot: CityRankingSnapshot): CityRankingSnapshotPayload {
  return Object.fromEntries(RANKING_PAYLOAD_KEYS.map((key) => [key, snapshot[key]])) as
    unknown as CityRankingSnapshotPayload;
}

function parseRankingSnapshot(value: unknown): CityRankingSnapshot {
  const snapshot = exactRecord(value, ["id", ...RANKING_PAYLOAD_KEYS]);
  const id = contentIdentifier(snapshot.id, "city-ranking");
  const payload = Object.fromEntries(
    RANKING_PAYLOAD_KEYS.map((key) => [key, snapshot[key]]),
  );
  return { id, ...parseRankingPayload(payload) };
}

function parseOperation(value: unknown): CityFrontierOperation {
  if (value === null || typeof value !== "object" || Array.isArray(value)) mismatch();
  const candidate = value as PlainRecord;
  if (candidate.kind === "start") {
    const operation = exactRecord(candidate, ["kind", "commandId", "criteriaPayloadHash"]);
    text(operation.commandId);
    digest(operation.criteriaPayloadHash);
    return operation as unknown as CityFrontierOperation;
  }
  if (candidate.kind === "city_completed") {
    const operation = exactRecord(candidate, [
      "kind",
      "commandId",
      "expectedHeadRevisionId",
      "cityId",
      "cityCheckRunId",
    ]);
    text(operation.commandId);
    text(operation.expectedHeadRevisionId);
    text(operation.cityId);
    text(operation.cityCheckRunId);
    return operation as unknown as CityFrontierOperation;
  }
  mismatch();
}

function parseTerminalEntry(value: unknown): CityTerminalEntry {
  const entry = exactRecord(value, [
    "cityId",
    "rank",
    "markerDigest",
    "knowledgeRevisionId",
    "evidenceSnapshotId",
    "unknownBasis",
  ]);
  text(entry.cityId);
  positiveInteger(entry.rank);
  digest(entry.markerDigest);
  text(entry.knowledgeRevisionId);
  text(entry.evidenceSnapshotId);
  for (const warning of denseArray(entry.unknownBasis)) validateUnknownWarning(warning);
  return entry as unknown as CityTerminalEntry;
}

function parseFrontierProjection(value: unknown): CityFrontierProjection {
  if (value === null || typeof value !== "object" || Array.isArray(value)) mismatch();
  const candidate = value as PlainRecord;
  if (candidate.kind === "working") {
    const projection = exactRecord(candidate, [
      "kind",
      "nextUncheckedRank",
      "selectableCityIds",
      "phase",
    ]);
    positiveInteger(projection.nextUncheckedRank);
    for (const cityIdValue of denseArray(projection.selectableCityIds)) text(cityIdValue);
    if (projection.phase !== "verification_required") mismatch();
    return projection as unknown as CityFrontierProjection;
  }
  if (candidate.kind === "terminal") {
    const projection = exactRecord(candidate, [
      "kind",
      "nextUncheckedRank",
      "selectableCityIds",
      "entries",
      "stopCondition",
    ]);
    positiveInteger(projection.nextUncheckedRank);
    for (const cityIdValue of denseArray(projection.selectableCityIds)) text(cityIdValue);
    for (const entry of denseArray(projection.entries)) parseTerminalEntry(entry);
    if (!STOP_CONDITIONS.includes(projection.stopCondition as CityFrontierStopCondition)) {
      mismatch();
    }
    return projection as unknown as CityFrontierProjection;
  }
  mismatch();
}

function parseSealFrontierInput(value: unknown): SealCityFrontierRevisionInput {
  if (value === null || typeof value !== "object" || Array.isArray(value)) mismatch();
  const candidate = value as PlainRecord;
  const hasPredecessor = Object.prototype.hasOwnProperty.call(
    candidate,
    "predecessorRevisionId",
  );
  const input = exactRecord(candidate, [
    "runId",
    ...(hasPredecessor ? ["predecessorRevisionId"] : []),
    "rankingSnapshotId",
    "markers",
    "projection",
    "operation",
    "createdAt",
  ]);
  text(input.runId);
  if (hasPredecessor) text(input.predecessorRevisionId);
  text(input.rankingSnapshotId);
  for (const marker of denseArray(input.markers)) parseLiveMarker(marker);
  parseFrontierProjection(input.projection);
  parseOperation(input.operation);
  instant(input.createdAt);
  return input as unknown as SealCityFrontierRevisionInput;
}

function flattenFrontierInput(
  input: SealCityFrontierRevisionInput,
): CityFrontierRevisionPayload {
  const common = {
    schemaVersion: "city-frontier@1" as const,
    runId: input.runId,
    ...(input.predecessorRevisionId === undefined
      ? {}
      : { predecessorRevisionId: input.predecessorRevisionId }),
    rankingSnapshotId: input.rankingSnapshotId,
    markers: input.markers,
    nextUncheckedRank: input.projection.nextUncheckedRank,
    operation: input.operation,
    createdAt: input.createdAt,
  };
  return input.projection.kind === "working"
    ? {
        ...common,
        kind: "working",
        phase: "verification_required",
      }
    : {
        ...common,
        kind: "terminal",
        entries: input.projection.entries,
        stopCondition: input.projection.stopCondition,
      };
}

function parseFrontierPayload(value: unknown): CityFrontierRevisionPayload {
  if (value === null || typeof value !== "object" || Array.isArray(value)) mismatch();
  const candidate = value as PlainRecord;
  const hasPredecessor = Object.prototype.hasOwnProperty.call(
    candidate,
    "predecessorRevisionId",
  );
  const common = [
    "schemaVersion",
    "kind",
    "runId",
    ...(hasPredecessor ? ["predecessorRevisionId"] : []),
    "rankingSnapshotId",
    "markers",
    "nextUncheckedRank",
    "operation",
    "createdAt",
  ];
  const payload = candidate.kind === "working"
    ? exactRecord(candidate, [...common, "phase"])
    : candidate.kind === "terminal"
      ? exactRecord(candidate, [...common, "entries", "stopCondition"])
      : mismatch();
  if (payload.schemaVersion !== "city-frontier@1") mismatch();
  text(payload.runId);
  if (hasPredecessor) text(payload.predecessorRevisionId);
  text(payload.rankingSnapshotId);
  for (const marker of denseArray(payload.markers)) parseLiveMarker(marker);
  positiveInteger(payload.nextUncheckedRank);
  parseOperation(payload.operation);
  instant(payload.createdAt);
  if (payload.kind === "working") {
    if (payload.phase !== "verification_required") mismatch();
  } else {
    for (const entry of denseArray(payload.entries)) parseTerminalEntry(entry);
    if (!STOP_CONDITIONS.includes(payload.stopCondition as CityFrontierStopCondition)) {
      mismatch();
    }
  }
  return payload as unknown as CityFrontierRevisionPayload;
}

function frontierPayloadOf(revision: CityFrontierRevision): CityFrontierRevisionPayload {
  const payload = { ...revision } as PlainRecord;
  delete payload.id;
  return payload as unknown as CityFrontierRevisionPayload;
}

function parseFrontierRevision(value: unknown): CityFrontierRevision {
  if (value === null || typeof value !== "object" || Array.isArray(value)) mismatch();
  const candidate = value as PlainRecord;
  const id = contentIdentifier(candidate.id, "city-frontier-revision");
  const payload = { ...candidate };
  delete payload.id;
  return { id, ...parseFrontierPayload(payload) } as CityFrontierRevision;
}

function requireOperationAuthority(payload: CityFrontierRevisionPayload): void {
  if (payload.operation.kind === "start") {
    if (payload.predecessorRevisionId !== undefined || payload.markers.length !== 0) mismatch();
    return;
  }
  if (payload.predecessorRevisionId === undefined || payload.markers.length === 0 ||
    payload.operation.expectedHeadRevisionId !== payload.predecessorRevisionId ||
    payload.operation.cityId !== payload.markers[payload.markers.length - 1]?.cityId) {
    mismatch();
  }
}

function requireProjectionMarkerIds(input: SealCityFrontierRevisionInput): void {
  const expected = input.markers
    .filter((marker) => marker.status === "selectable")
    .map((marker) => marker.cityId);
  if (!dataEqual(input.projection.selectableCityIds, expected)) mismatch();
}

function requireTerminalAuthority(
  payload: CityFrontierRevisionPayload,
  integrity: CapturedIntegrity,
): void {
  if (payload.kind !== "terminal") return;
  const selectableMarkers = payload.markers.filter((marker) => marker.status === "selectable");
  if (payload.entries.length !== selectableMarkers.length) mismatch();
  const seenCities = new Set<string>();
  for (const entry of payload.entries) {
    if (seenCities.has(entry.cityId)) mismatch();
    seenCities.add(entry.cityId);
    const matches = payload.markers.filter((marker) => marker.cityId === entry.cityId);
    if (matches.length !== 1) mismatch();
    const marker = matches[0];
    if (marker === undefined || marker.status !== "selectable" ||
      marker.rank !== entry.rank || marker.knowledgeRevisionId !== entry.knowledgeRevisionId ||
      marker.evidenceSnapshotId !== entry.evidenceSnapshotId ||
      !dataEqual(marker.unknownBasis, entry.unknownBasis) ||
      entry.markerDigest !== hashOwned(marker, integrity)) {
      mismatch();
    }
  }
}

function parseSelectionPayload(value: unknown): CitySelectionSnapshotPayload {
  if (value === null || typeof value !== "object" || Array.isArray(value)) mismatch();
  const candidate = value as PlainRecord;
  const hasWarning = Object.prototype.hasOwnProperty.call(candidate, "warningCopyVersion");
  const selection = exactRecord(candidate, [
    ...SELECTION_PAYLOAD_KEYS,
    ...(hasWarning ? ["warningCopyVersion"] : []),
  ]);
  if (selection.schemaVersion !== "city-selection@1") mismatch();
  text(selection.commandId);
  text(selection.runId);
  text(selection.terminalRevisionId);
  text(selection.cityId);
  countryCode(selection.countryCode);
  text(selection.profileSnapshotId);
  text(selection.preferenceProfileSnapshotId);
  text(selection.resolvedCountryShortlistRevisionId);
  text(selection.criteriaSnapshotId);
  text(selection.rankingSnapshotId);
  text(selection.preCityBranchCommitId);
  digest(selection.selectedMarkerDigest);
  text(selection.knowledgeRevisionId);
  text(selection.evidenceSnapshotId);
  for (const warning of denseArray(selection.unknownBasis)) validateUnknownWarning(warning);
  if (hasWarning && selection.warningCopyVersion !== "city-unknown-risk@1") mismatch();
  instant(selection.createdAt);
  return selection as unknown as CitySelectionSnapshotPayload;
}

function selectionPayloadOf(selection: CitySelectionSnapshot): CitySelectionSnapshotPayload {
  const payload = { ...selection } as PlainRecord;
  delete payload.id;
  return payload as unknown as CitySelectionSnapshotPayload;
}

function parseSelectionSnapshot(value: unknown): CitySelectionSnapshot {
  if (value === null || typeof value !== "object" || Array.isArray(value)) mismatch();
  const candidate = value as PlainRecord;
  const id = contentIdentifier(candidate.id, "city-selection");
  const payload = { ...candidate };
  delete payload.id;
  return { id, ...parseSelectionPayload(payload) };
}

interface CapturedEvaluator {
  readonly definition: CityCriterionDefinition;
  readonly canonicalizeTarget: (target: unknown) => unknown;
  readonly evaluate: (input: CityCriterionEvaluationInput) => unknown;
}

type CapturedEvaluatorRegistry = Readonly<Record<CityCriterionId, CapturedEvaluator>>;

function parseCriterionDefinition(
  value: unknown,
  expectedCriterionId: CityCriterionId,
): CityCriterionDefinition {
  const definition = exactRecord(value, [
    "criterionId",
    "definitionId",
    "direction",
    "unit",
    "denominator",
    "compatibleGeoScopes",
    "freshnessPolicyVersion",
    "evaluatorVersion",
  ]);
  if (definition.criterionId !== expectedCriterionId ||
    (definition.direction !== "at_least" && definition.direction !== "at_most")) {
    mismatch();
  }
  text(definition.definitionId);
  text(definition.unit);
  text(definition.denominator);
  const scopes = denseArray(definition.compatibleGeoScopes);
  if (scopes.length === 0) mismatch();
  for (const scope of scopes) text(scope);
  text(definition.freshnessPolicyVersion);
  text(definition.evaluatorVersion);
  return definition as unknown as CityCriterionDefinition;
}

function captureEvaluators(value: unknown): CapturedEvaluatorRegistry {
  const registry = exactRootValues(value, CITY_CRITERION_IDS);
  const entries = CITY_CRITERION_IDS.map((id) => {
    const evaluator = exactRootValues(
      registry[id],
      ["definition", "canonicalizeTarget", "evaluate"],
    );
    const canonicalizeTarget = evaluator.canonicalizeTarget;
    const evaluate = evaluator.evaluate;
    if (typeof canonicalizeTarget !== "function" || types.isProxy(canonicalizeTarget) ||
      typeof evaluate !== "function" || types.isProxy(evaluate)) {
      mismatch();
    }
    return [id, Object.freeze({
      definition: deepFreeze(parseCriterionDefinition(ownData(evaluator.definition), id)),
      canonicalizeTarget: canonicalizeTarget as (target: unknown) => unknown,
      evaluate: evaluate as (input: CityCriterionEvaluationInput) => unknown,
    })] as const;
  });
  return deepFreeze(Object.fromEntries(entries)) as CapturedEvaluatorRegistry;
}

function parseCriteriaSnapshotCandidate(value: unknown): CityCriteriaSnapshot {
  const snapshot = exactRecord(value, [
    "schemaVersion",
    "id",
    "profileSnapshotId",
    "preferenceProfileSnapshotId",
    "criteria",
    "rulesVersion",
    "confirmedAt",
  ]);
  if (snapshot.schemaVersion !== "city-criteria@1" ||
    snapshot.rulesVersion !== "city-criteria@1") {
    mismatch();
  }
  const criteria = denseArray(snapshot.criteria, CITY_CRITERION_IDS.length)
    .map(parseCriterionDraft);
  if (criteria.some((criterion, index) =>
    criterion.criterionId !== CITY_CRITERION_IDS[index])) {
    mismatch();
  }
  return {
    schemaVersion: "city-criteria@1",
    id: text(snapshot.id),
    profileSnapshotId: text(snapshot.profileSnapshotId),
    preferenceProfileSnapshotId: text(snapshot.preferenceProfileSnapshotId),
    criteria: criteria as unknown as CityCriteriaSnapshot["criteria"],
    rulesVersion: "city-criteria@1",
    confirmedAt: instant(snapshot.confirmedAt),
  };
}

function requireCriteriaDefinitions(
  criteria: CityCriteriaSnapshot,
  evaluators: CapturedEvaluatorRegistry,
): void {
  for (const criterion of criteria.criteria) {
    if (criterion.definitionId !==
      evaluators[criterion.criterionId].definition.definitionId) {
      mismatch();
    }
  }
}

function parseCriterionDraft(value: unknown): CityCriterionDraft {
  const criterion = exactRecord(value, [
    "criterionId",
    "definitionId",
    "mode",
    "importance",
    "target",
  ]);
  criterionId(criterion.criterionId);
  text(criterion.definitionId);
  if (criterion.mode !== "required" && criterion.mode !== "weighted") mismatch();
  if (![1, 2, 3, 4, 5].includes(criterion.importance as number)) mismatch();
  text(criterion.target);
  return criterion as unknown as CityCriterionDraft;
}

function parseRankingFact(value: unknown): CityRankingFactInput {
  const fact = exactRecord(value, [
    "criterionId",
    "definitionId",
    "geoScope",
    "referencePeriod",
    "freshnessBasis",
    "unit",
    "denominator",
    "outcome",
  ]);
  criterionId(fact.criterionId);
  text(fact.definitionId);
  text(fact.geoScope);
  if (fact.referencePeriod !== null) text(fact.referencePeriod);
  text(fact.freshnessBasis);
  text(fact.unit);
  text(fact.denominator);
  validateFactOutcome(fact.outcome);
  return fact as unknown as CityRankingFactInput;
}

function canonicalFactor(value: unknown): string {
  const factor = text(value);
  if (!/^(?:0|1|0\.\d*[1-9])$/.test(factor)) mismatch();
  return factor;
}

function parseEvaluationResult(
  value: unknown,
  fact: CityRankingFactInput,
): CityCriterionEvaluation {
  const owned = ownData(value);
  if (owned === null || typeof owned !== "object" || Array.isArray(owned)) mismatch();
  const candidate = owned as PlainRecord;
  if (candidate.state === "verified") {
    const result = exactRecord(candidate, ["state", "factor", "targetComparison"]);
    const factor = canonicalFactor(result.factor);
    if ((result.targetComparison !== "matches" &&
      result.targetComparison !== "does_not_match") || fact.outcome.kind === "unknown") {
      mismatch();
    }
    return deepFreeze({
      state: "verified",
      factor,
      targetComparison: result.targetComparison,
    });
  }
  if (candidate.state === "unknown") {
    const result = exactRecord(candidate, [
      "state",
      "factor",
      "targetComparison",
      "unknownReason",
    ]);
    if (result.factor !== "0" || result.targetComparison !== "unknown") mismatch();
    const reason = unknownReason(result.unknownReason);
    if (fact.outcome.kind === "unknown" && reason !== fact.outcome.reason) mismatch();
    return deepFreeze({
      state: "unknown",
      factor: "0",
      targetComparison: "unknown",
      unknownReason: reason,
    });
  }
  mismatch();
}

function evaluatorWrappers(
  captured: CapturedEvaluatorRegistry,
): CityCriterionEvaluatorRegistry {
  const entries = CITY_CRITERION_IDS.map((id) => {
    const authority = captured[id];
    const wrapper = {
      definition: authority.definition,
      canonicalizeTarget(targetValue: unknown): string {
        const target = text(targetValue);
        let result: unknown;
        try {
          result = Reflect.apply(
            authority.canonicalizeTarget,
            Object.freeze({ capability: "canonicalizeTarget" }),
            [target],
          );
        } catch {
          mismatch();
        }
        if (typeof result !== "string" || result !== target) mismatch();
        return result;
      },
      evaluate(inputValue: CityCriterionEvaluationInput): CityCriterionEvaluation {
        const input = exactRecord(ownData(inputValue), [
          "criterion",
          "fact",
          "assessmentAt",
        ]);
        const privateInput = deepFreeze({
          criterion: parseCriterionDraft(input.criterion),
          fact: parseRankingFact(input.fact),
          assessmentAt: instant(input.assessmentAt),
        });
        let result: unknown;
        try {
          result = Reflect.apply(
            authority.evaluate,
            Object.freeze({ capability: "evaluate" }),
            [privateInput],
          );
        } catch {
          mismatch();
        }
        return parseEvaluationResult(result, privateInput.fact);
      },
    };
    return [id, deepFreeze(wrapper)] as const;
  });
  return deepFreeze(Object.fromEntries(entries)) as CityCriterionEvaluatorRegistry;
}

function parseSemanticKnowledge(
  value: unknown,
): readonly CityKnowledgeRankingProjection[] {
  return denseArray(value).map((item) => {
    const projection = exactRecord(item, ["cityId", "knowledgeRevisionId", "facts"]);
    text(projection.cityId);
    if (projection.knowledgeRevisionId === null) {
      denseArray(projection.facts, 0);
    } else {
      text(projection.knowledgeRevisionId);
      for (const fact of denseArray(projection.facts, CITY_CRITERION_IDS.length)) {
        parseRankingFact(fact);
      }
    }
    return projection as unknown as CityKnowledgeRankingProjection;
  });
}

function catalogMemberCityIds(value: unknown): readonly string[] {
  return denseArray(value).map((item) => {
    const member = exactRecord(item, ["cityId", "inclusionReasons"]);
    const cityIdValue = text(member.cityId);
    for (const reason of denseArray(member.inclusionReasons)) text(reason);
    return cityIdValue;
  });
}

function requireSemanticBindings(
  snapshot: CityRankingSnapshot,
  registry: CityRegistryRevision,
  catalog: CityCatalogRevision,
  criteria: CityCriteriaSnapshot,
  knowledge: readonly CityKnowledgeRankingProjection[],
): void {
  if (text(registry.id) !== snapshot.registryRevisionId ||
    text(catalog.id) !== snapshot.catalogRevisionId ||
    text(catalog.registryRevisionId) !== registry.id ||
    countryCode(registry.countryCode) !== snapshot.countryCode ||
    countryCode(catalog.countryCode) !== snapshot.countryCode ||
    text(registry.packageId) !== snapshot.packageId ||
    text(catalog.packageId) !== snapshot.packageId ||
    text(registry.packageSchemaVersion) !== snapshot.packageSchemaVersion ||
    text(catalog.packageSchemaVersion) !== snapshot.packageSchemaVersion ||
    text(criteria.id) !== snapshot.criteriaSnapshotId ||
    text(criteria.profileSnapshotId) !== snapshot.profileSnapshotId ||
    text(criteria.preferenceProfileSnapshotId) !== snapshot.preferenceProfileSnapshotId) {
    mismatch();
  }

  const memberIds = catalogMemberCityIds(catalog.members);
  if (new Set(memberIds).size !== memberIds.length) mismatch();
  const revisionKeys = Object.getOwnPropertyNames(snapshot.knowledgeRevisionIds).sort();
  const sortedMembers = [...memberIds].sort();
  if (revisionKeys.length !== sortedMembers.length ||
    revisionKeys.some((key, index) => key !== sortedMembers[index]) ||
    knowledge.length !== memberIds.length) {
    mismatch();
  }
  const byCity = new Map(knowledge.map((item) => [item.cityId, item]));
  if (byCity.size !== memberIds.length) mismatch();
  for (const cityIdValue of memberIds) {
    const projection = byCity.get(cityIdValue);
    if (projection === undefined ||
      projection.knowledgeRevisionId !== snapshot.knowledgeRevisionIds[cityIdValue]) {
      mismatch();
    }
  }
}

function parseSelectionProjection(value: unknown): CitySelectionProjection {
  if (value === null || typeof value !== "object" || Array.isArray(value)) mismatch();
  const candidate = value as PlainRecord;
  const hasWarning = Object.prototype.hasOwnProperty.call(candidate, "warningCopyVersion");
  const projection = exactRecord(candidate, [
    "entry",
    "reviewedSourceLinks",
    ...(hasWarning ? ["warningCopyVersion"] : []),
  ]);
  parseTerminalEntry(projection.entry);
  for (const link of denseArray(projection.reviewedSourceLinks)) {
    validateFactLink(link, "reviewed_rejected");
  }
  if (hasWarning && projection.warningCopyVersion !== "city-unknown-risk@1") mismatch();
  return projection as unknown as CitySelectionProjection;
}

function requireAuthorityGraph(
  terminal: TerminalCityShortlistSnapshot,
  ranking: CityRankingSnapshot,
  preCityBranch: PreCityBranchCommit,
): void {
  if (terminal.runId !== ranking.runId || terminal.rankingSnapshotId !== ranking.id ||
    ranking.preCityBranchCommitId !== preCityBranch.id ||
    ranking.countryCode !== preCityBranch.countryCode ||
    ranking.profileSnapshotId !== preCityBranch.profileSnapshotId ||
    ranking.preferenceProfileSnapshotId !== preCityBranch.preferenceProfileSnapshotId ||
    ranking.resolvedCountryShortlistRevisionId !==
      preCityBranch.resolvedCountryShortlistRevisionId) {
    mismatch();
  }
}

function markerAndEntry(
  terminal: TerminalCityShortlistSnapshot,
  cityIdValue: string,
): { readonly marker: CityLiveMarker; readonly entry: CityTerminalEntry } {
  const markers = terminal.markers.filter((candidate) => candidate.cityId === cityIdValue);
  const entries = terminal.entries.filter((candidate) => candidate.cityId === cityIdValue);
  if (markers.length !== 1 || entries.length !== 1) mismatch();
  const marker = markers[0];
  const entry = entries[0];
  if (marker === undefined || entry === undefined || marker.status !== "selectable" ||
    (marker.visualStatus !== "green" && marker.visualStatus !== "yellow")) {
    mismatch();
  }
  return { marker, entry };
}

function reviewedLinks(marker: CityLiveMarker): readonly unknown[] {
  return marker.facts.flatMap((fact) => fact.manualCheckLinks);
}

function requireSelectionProjection(
  projection: CitySelectionProjection,
  marker: CityLiveMarker,
  entry: CityTerminalEntry,
): void {
  if (!dataEqual(projection.entry, entry) ||
    !dataEqual(projection.reviewedSourceLinks, reviewedLinks(marker))) {
    mismatch();
  }
  if (marker.visualStatus === "green") {
    if (projection.warningCopyVersion !== undefined) mismatch();
  } else if (projection.warningCopyVersion !== "city-unknown-risk@1") {
    mismatch();
  }
}

function derivedSelectionPayload(
  terminal: TerminalCityShortlistSnapshot,
  ranking: CityRankingSnapshot,
  preCityBranch: PreCityBranchCommit,
  marker: CityLiveMarker,
  markerDigest: string,
  commandId: string,
  createdAt: string,
): CitySelectionSnapshotPayload {
  return {
    schemaVersion: "city-selection@1",
    commandId,
    runId: terminal.runId,
    terminalRevisionId: terminal.id,
    cityId: marker.cityId,
    countryCode: ranking.countryCode,
    profileSnapshotId: ranking.profileSnapshotId,
    preferenceProfileSnapshotId: ranking.preferenceProfileSnapshotId,
    resolvedCountryShortlistRevisionId: ranking.resolvedCountryShortlistRevisionId,
    criteriaSnapshotId: ranking.criteriaSnapshotId,
    rankingSnapshotId: ranking.id,
    preCityBranchCommitId: preCityBranch.id,
    selectedMarkerDigest: markerDigest,
    knowledgeRevisionId: marker.knowledgeRevisionId,
    evidenceSnapshotId: marker.evidenceSnapshotId,
    unknownBasis: marker.unknownBasis,
    ...(marker.visualStatus === "yellow"
      ? { warningCopyVersion: "city-unknown-risk@1" as const }
      : {}),
    createdAt,
  };
}

function branchProjectionFor(
  selection: CitySelectionSnapshot,
): CityBranchSelectionProjection {
  return {
    citySelectionSnapshotId: selection.id,
    preCityBranchCommitId: selection.preCityBranchCommitId,
    cityId: selection.cityId,
    countryCode: selection.countryCode,
    createdAt: selection.createdAt,
  };
}

function parsePreCityBranchCandidate(value: unknown): PreCityBranchCommit {
  const commit = exactRecord(value, [
    "schemaVersion",
    "id",
    "profileSnapshotId",
    "preferenceProfileSnapshotId",
    "resolvedCountryShortlistRevisionId",
    "countryCode",
    "resolvedCountryEntryDigest",
    "createdAt",
  ]);
  if (commit.schemaVersion !== "pre-city-branch@1") mismatch();
  return {
    schemaVersion: "pre-city-branch@1",
    id: contentIdentifier(commit.id, "pre-city-branch"),
    profileSnapshotId: text(commit.profileSnapshotId),
    preferenceProfileSnapshotId: text(commit.preferenceProfileSnapshotId),
    resolvedCountryShortlistRevisionId: text(commit.resolvedCountryShortlistRevisionId),
    countryCode: countryCode(commit.countryCode),
    resolvedCountryEntryDigest: digest(commit.resolvedCountryEntryDigest),
    createdAt: instant(commit.createdAt),
  };
}

function parseCityBranchCandidate(value: unknown): CityBranchCommit {
  const commit = exactRecord(value, [
    "schemaVersion",
    "id",
    "parentId",
    "forkedFrom",
    "citySelectionSnapshotId",
    "cityId",
    "countryCode",
    "createdAt",
  ]);
  if (commit.schemaVersion !== "city-branch@1") mismatch();
  return {
    schemaVersion: "city-branch@1",
    id: contentIdentifier(commit.id, "city-branch"),
    parentId: contentIdentifier(commit.parentId, "pre-city-branch"),
    forkedFrom: contentIdentifier(commit.forkedFrom, "pre-city-branch"),
    citySelectionSnapshotId: contentIdentifier(
      commit.citySelectionSnapshotId,
      "city-selection",
    ),
    cityId: text(commit.cityId),
    countryCode: countryCode(commit.countryCode),
    createdAt: instant(commit.createdAt),
  };
}

export function sealCityRankingSnapshot(
  payload: CityRankingSnapshotPayload,
  integrity: CityDecisionIntegrity,
): CityRankingSnapshot {
  return atBoundary(() => {
    const ownedPayload = parseRankingPayload(ownData(payload));
    const capturedIntegrity = captureIntegrity(integrity);
    return deepFreeze({
      id: `city-ranking:${hashOwned(ownedPayload, capturedIntegrity)}`,
      ...ownedPayload,
    });
  });
}

export function reconstructCityRankingSnapshot(
  value: unknown,
  integrity: CityDecisionIntegrity,
): CityRankingSnapshot {
  return atBoundary(() => {
    const snapshot = parseRankingSnapshot(ownData(value));
    const capturedIntegrity = captureIntegrity(integrity);
    if (snapshot.id !==
      `city-ranking:${hashOwned(rankingPayloadOf(snapshot), capturedIntegrity)}`) {
      mismatch();
    }
    return deepFreeze(snapshot);
  });
}

export function verifyCityRankingSnapshotSemantics(
  snapshot: CityRankingSnapshot,
  inputs: CityRankingSemanticInputs,
  integrity: CityDecisionIntegrity,
): CityRankingSnapshot {
  return atBoundary(() => {
    const root = exactRootValues(inputs, [
      "registry",
      "catalog",
      "criteria",
      "knowledge",
      "evaluators",
    ]);
    for (const key of [
      "registry",
      "catalog",
      "criteria",
      "knowledge",
      "evaluators",
    ] as const) {
      if (root[key] === null || typeof root[key] !== "object") mismatch();
    }
    const ownedSnapshot = parseRankingSnapshot(ownData(snapshot));
    const ownedRegistry = ownData(root.registry) as CityRegistryRevision;
    const ownedCatalog = ownData(root.catalog) as CityCatalogRevision;
    requireCanonicalTextScalars(ownedRegistry);
    requireCanonicalTextScalars(ownedCatalog);
    const criteria = parseCriteriaSnapshotCandidate(ownData(root.criteria));
    const knowledge = parseSemanticKnowledge(ownData(root.knowledge));
    const capturedEvaluators = captureEvaluators(root.evaluators);
    const { registry, catalog } = reconstructCityCatalog({
      registry: ownedRegistry,
      catalog: ownedCatalog,
    });
    requireCriteriaDefinitions(criteria, capturedEvaluators);
    const capturedIntegrity = captureIntegrity(integrity);
    const privateIntegrity = integrityView(capturedIntegrity);
    const reconstructed = reconstructCityRankingSnapshot(
      ownedSnapshot,
      privateIntegrity,
    );

    requireSemanticBindings(reconstructed, registry, catalog, criteria, knowledge);
    const evaluators = evaluatorWrappers(capturedEvaluators);
    reconstructCityCriteria(criteria, evaluators);
    reconstructCityRanking({
      assessmentAt: reconstructed.assessmentAt,
      registry,
      catalog,
      criteria,
      knowledge,
      evaluators,
      ranking: {
        ordered: reconstructed.ordered,
        screenedExclusions: reconstructed.screenedExclusions,
        rulesVersion: reconstructed.rulesVersion,
      },
    });
    return reconstructed;
  });
}

export function sealCityFrontierRevision(
  input: SealCityFrontierRevisionInput,
  integrity: CityDecisionIntegrity,
): CityFrontierRevision {
  return atBoundary(() => {
    const ownedInput = parseSealFrontierInput(ownData(input));
    const payload = parseFrontierPayload(flattenFrontierInput(ownedInput));
    requireOperationAuthority(payload);
    requireProjectionMarkerIds(ownedInput);
    const capturedIntegrity = captureIntegrity(integrity);
    requireTerminalAuthority(payload, capturedIntegrity);
    return deepFreeze({
      id: `city-frontier-revision:${hashOwned(payload, capturedIntegrity)}`,
      ...payload,
    } as CityFrontierRevision);
  });
}

export function reconstructCityFrontierRevision(
  value: unknown,
  integrity: CityDecisionIntegrity,
): CityFrontierRevision {
  return atBoundary(() => {
    const revision = parseFrontierRevision(ownData(value));
    const payload = frontierPayloadOf(revision);
    requireOperationAuthority(payload);
    const capturedIntegrity = captureIntegrity(integrity);
    requireTerminalAuthority(payload, capturedIntegrity);
    if (revision.id !==
      `city-frontier-revision:${hashOwned(payload, capturedIntegrity)}`) {
      mismatch();
    }
    return deepFreeze(revision);
  });
}

export function reconstructCitySelectionSnapshot(
  value: unknown,
  integrity: CityDecisionIntegrity,
): CitySelectionSnapshot {
  return atBoundary(() => {
    const selection = parseSelectionSnapshot(ownData(value));
    const capturedIntegrity = captureIntegrity(integrity);
    if (selection.id !==
      `city-selection:${hashOwned(selectionPayloadOf(selection), capturedIntegrity)}`) {
      mismatch();
    }
    return deepFreeze(selection);
  });
}

export function createCitySelectionWithBranch(
  input: CreateCitySelectionWithBranchInput,
  integrity: CityDecisionIntegrity,
): CitySelectionWithBranch {
  return atBoundary(() => {
    const root = exactRecord(ownData(input), [
      "terminal",
      "ranking",
      "preCityBranch",
      "commandId",
      "selection",
      "createdAt",
    ]);
    const terminalCandidate = parseFrontierRevision(root.terminal);
    if (terminalCandidate.kind !== "terminal") mismatch();
    const rankingCandidate = parseRankingSnapshot(root.ranking);
    const preCityCandidate = parsePreCityBranchCandidate(root.preCityBranch);
    const commandId = text(root.commandId);
    const projection = parseSelectionProjection(root.selection);
    const createdAt = instant(root.createdAt);
    const capturedIntegrity = captureIntegrity(integrity);
    const privateIntegrity = integrityView(capturedIntegrity);

    const terminal = reconstructCityFrontierRevision(
      terminalCandidate,
      privateIntegrity,
    );
    if (terminal.kind !== "terminal") mismatch();
    const ranking = reconstructCityRankingSnapshot(rankingCandidate, privateIntegrity);
    const preCityBranch = reconstructPreCityBranchCommit(
      preCityCandidate,
      privateIntegrity,
    );
    requireAuthorityGraph(terminal, ranking, preCityBranch);
    const { marker, entry } = markerAndEntry(terminal, projection.entry.cityId);
    requireSelectionProjection(projection, marker, entry);
    const markerDigest = hashOwned(marker, capturedIntegrity);
    if (entry.markerDigest !== markerDigest) mismatch();
    const payload = derivedSelectionPayload(
      terminal,
      ranking,
      preCityBranch,
      marker,
      markerDigest,
      commandId,
      createdAt,
    );
    const selection = deepFreeze({
      id: `city-selection:${hashOwned(payload, capturedIntegrity)}`,
      ...payload,
    });
    const commit = createCityBranchCommit(
      branchProjectionFor(selection),
      preCityBranch,
      privateIntegrity,
    );
    return deepFreeze({ selection, commit });
  });
}

export function reconstructCitySelectionWithBranch(
  value: unknown,
  authority: CitySelectionAuthority,
  integrity: CityDecisionIntegrity,
): CitySelectionWithBranch {
  return atBoundary(() => {
    const pair = exactRecord(ownData(value), ["selection", "commit"]);
    const authorityRoot = exactRecord(ownData(authority), [
      "terminal",
      "ranking",
      "preCityBranch",
    ]);
    const selectionCandidate = parseSelectionSnapshot(pair.selection);
    const commitCandidate = parseCityBranchCandidate(pair.commit);
    const terminalCandidate = parseFrontierRevision(authorityRoot.terminal);
    if (terminalCandidate.kind !== "terminal") mismatch();
    const rankingCandidate = parseRankingSnapshot(authorityRoot.ranking);
    const preCityCandidate = parsePreCityBranchCandidate(authorityRoot.preCityBranch);
    const capturedIntegrity = captureIntegrity(integrity);
    const privateIntegrity = integrityView(capturedIntegrity);

    const selection = reconstructCitySelectionSnapshot(
      selectionCandidate,
      privateIntegrity,
    );
    const terminal = reconstructCityFrontierRevision(
      terminalCandidate,
      privateIntegrity,
    );
    if (terminal.kind !== "terminal") mismatch();
    const ranking = reconstructCityRankingSnapshot(rankingCandidate, privateIntegrity);
    const preCityBranch = reconstructPreCityBranchCommit(
      preCityCandidate,
      privateIntegrity,
    );
    const commit = replayCityBranchCommit(
      commitCandidate,
      branchProjectionFor(selection),
      preCityBranch,
      privateIntegrity,
    );
    requireAuthorityGraph(terminal, ranking, preCityBranch);
    const { marker, entry } = markerAndEntry(terminal, selection.cityId);
    const markerDigest = hashOwned(marker, capturedIntegrity);
    if (entry.markerDigest !== markerDigest) mismatch();
    const expectedPayload = derivedSelectionPayload(
      terminal,
      ranking,
      preCityBranch,
      marker,
      markerDigest,
      selection.commandId,
      selection.createdAt,
    );
    if (!dataEqual(selectionPayloadOf(selection), expectedPayload) ||
      selection.preCityBranchCommitId !== commit.parentId ||
      selection.preCityBranchCommitId !== commit.forkedFrom ||
      selection.createdAt !== commit.createdAt) {
      mismatch();
    }
    return deepFreeze({ selection, commit });
  });
}

export function cityLiveMarkerDigest(
  marker: CityLiveMarker,
  integrity: CityDecisionIntegrity,
): string {
  return atBoundary(() => {
    const ownedMarker = parseLiveMarker(ownData(marker));
    const capturedIntegrity = captureIntegrity(integrity);
    return hashOwned(ownedMarker, capturedIntegrity);
  });
}
