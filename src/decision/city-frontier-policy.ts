import { types } from "node:util";

import { canonicalDecimal } from "./city-criterion-evaluator";
import {
  CITY_CRITERION_IDS,
  type CityCriteriaSnapshot,
  type CityCriterionDraft,
  type CityCriterionEvaluation,
  type CityCriterionEvaluationInput,
  type CityCriterionEvaluatorRegistry,
  type CityCriterionId,
  type CityImportance,
  type CityRankingFactInput,
  type CityUnknownReason,
  type CityVerifiedFactBasis,
} from "./city-criteria";
import type { CityRequiredMismatch } from "./city-ranker";

export type CityMarkerDisposition = "selectable" | "excluded";
export type CityCommittedMarkerVisualStatus = "green" | "yellow" | "red";
export type CityCandidateViewStatus = "pending" | CityCommittedMarkerVisualStatus;
export type CityFrontierStopCondition =
  | "three_selectable"
  | "catalog_exhausted"
  | "live_candidate_limit_reached";

export interface CityFrontierVerificationBudget {
  readonly liveCityCandidateLimit: 10;
  readonly targetSelectableCities: 3;
  readonly rulesVersion: "city-frontier-budget@1";
}

export type CityFactLinkRejectionReason =
  | "http_not_found"
  | "transport_unavailable"
  | "authority_untrusted"
  | "stale"
  | "scope_mismatch"
  | "definition_mismatch"
  | "missing_numerator"
  | "denominator_missing"
  | "denominator_zero"
  | "denominator_period_mismatch"
  | "denominator_scope_mismatch"
  | "wrong_media_type"
  | "too_large"
  | "untrusted_redirect"
  | "retention_unapproved"
  | "conflict";

export interface CityLiveMarker {
  readonly cityId: string;
  readonly rank: number;
  readonly status: CityMarkerDisposition;
  readonly visualStatus: CityCommittedMarkerVisualStatus;
  readonly knowledgeRevisionId: string;
  readonly evidenceSnapshotId: string;
  readonly lastCheckedAt: string;
  readonly requiredMismatches: readonly CityRequiredMismatch[];
  readonly unknownBasis: readonly CityUnknownWarning[];
  readonly verificationCoverage: string;
  readonly facts: CityCommittedFactProjectionTuple;
}

export type CityFactLinkProjection =
  | {
      readonly sourceId: string;
      readonly disposition: "accepted";
      readonly navigationUrl: string;
      readonly resolvedEvidenceUrl: string;
      readonly referenceYear?: number;
    }
  | {
      readonly sourceId: string;
      readonly disposition: "reviewed_rejected";
      readonly navigationUrl: string;
      readonly resolvedEvidenceUrl?: string;
      readonly referenceYear?: number;
      readonly rejectionReason?: CityFactLinkRejectionReason;
    };

export type CityAcceptedFactLinkProjection = Extract<
  CityFactLinkProjection,
  { readonly disposition: "accepted" }
>;
export type CityReviewedFactLinkProjection = Extract<
  CityFactLinkProjection,
  { readonly disposition: "reviewed_rejected" }
>;

export interface CityUnknownWarning {
  readonly criterionId: CityCriterionId;
  readonly definitionId: string;
  readonly reason: CityUnknownReason;
}

export interface CityCommittedFactProjection extends Omit<CityRankingFactInput, "outcome"> {
  readonly outcome:
    | { readonly kind: "verified"; readonly basis: CityVerifiedFactBasis }
    | { readonly kind: "unknown"; readonly reason: CityUnknownReason };
  readonly evidenceLinks: readonly CityAcceptedFactLinkProjection[];
  readonly manualCheckLinks: readonly CityReviewedFactLinkProjection[];
}

export type CityCommittedFactProjectionTuple = readonly [
  CityCommittedFactProjection,
  CityCommittedFactProjection,
  CityCommittedFactProjection,
  CityCommittedFactProjection,
];

export interface CityMarkerAuthorityProjection {
  readonly cityId: string;
  readonly knowledgeRevisionId: string;
  readonly evidenceSnapshotId: string;
  readonly lastCheckedAt: string;
  readonly facts: CityCommittedFactProjectionTuple;
}

export interface CityMarkerBinding {
  readonly marker: CityLiveMarker;
  readonly markerDigest: string;
  readonly authority: CityMarkerAuthorityProjection;
}

export interface CityFrontierRankingProjection {
  readonly assessmentAt: string;
  readonly orderedCityIds: readonly string[];
  readonly screenedExclusionCityIds: readonly string[];
}

export interface ReconstructCityLiveMarkerInput {
  readonly assessmentAt: string;
  readonly criteria: CityCriteriaSnapshot;
  readonly evaluators: CityCriterionEvaluatorRegistry;
  readonly rank: number;
  readonly authority: CityMarkerAuthorityProjection;
  readonly persisted?: CityLiveMarker;
}

export interface CityTerminalEntry {
  readonly cityId: string;
  readonly rank: number;
  readonly markerDigest: string;
  readonly knowledgeRevisionId: string;
  readonly evidenceSnapshotId: string;
  readonly unknownBasis: readonly CityUnknownWarning[];
}

export type CityFrontierProjection =
  | {
      readonly kind: "working";
      readonly nextUncheckedRank: number;
      readonly selectableCityIds: readonly string[];
      readonly phase: "verification_required";
    }
  | {
      readonly kind: "terminal";
      readonly nextUncheckedRank: number;
      readonly selectableCityIds: readonly string[];
      readonly entries: readonly CityTerminalEntry[];
      readonly stopCondition: CityFrontierStopCondition;
    };

export interface ReconstructCityFrontierInput {
  readonly ranking: CityFrontierRankingProjection;
  readonly criteria: CityCriteriaSnapshot;
  readonly evaluators: CityCriterionEvaluatorRegistry;
  readonly predecessorMarkers: null | readonly CityLiveMarker[];
  readonly markerBindings: readonly CityMarkerBinding[];
  readonly persisted?: CityFrontierProjection;
}

const UNKNOWN_REASONS: readonly CityUnknownReason[] = [
  "not_found",
  "stale",
  "conflict",
  "not_comparable",
  "source_unavailable",
];
const REJECTION_REASONS: readonly CityFactLinkRejectionReason[] = [
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
];
const MARKER_KEYS = [
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
] as const;
const FACT_KEYS = [
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
] as const;
const FACT_INPUT_KEYS = [
  "criterionId",
  "definitionId",
  "geoScope",
  "referencePeriod",
  "freshnessBasis",
  "unit",
  "denominator",
  "outcome",
] as const;
const CRITERION_KEYS = ["criterionId", "definitionId", "mode", "importance", "target"] as const;
const DEFINITION_KEYS = [
  "criterionId",
  "definitionId",
  "direction",
  "unit",
  "denominator",
  "compatibleGeoScopes",
  "freshnessPolicyVersion",
  "evaluatorVersion",
] as const;

type PlainRecord = Record<string, unknown>;

interface CapturedEvaluator {
  readonly definition: {
    readonly criterionId: CityCriterionId;
    readonly definitionId: string;
    readonly direction: "at_least" | "at_most";
    readonly unit: string;
    readonly denominator: string;
    readonly compatibleGeoScopes: readonly string[];
    readonly freshnessPolicyVersion: string;
    readonly evaluatorVersion: string;
  };
  readonly canonicalizeTarget: (target: unknown) => string;
  readonly evaluate: (input: CityCriterionEvaluationInput) => CityCriterionEvaluation;
}

type CapturedEvaluators = Readonly<Record<CityCriterionId, CapturedEvaluator>>;

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

function isPlainRecord(value: unknown): value is PlainRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function ownSnapshot<T>(borrowed: T): T {
  const active = new Set<object>();

  const visit = (value: unknown): unknown => {
    if (value === null || value === undefined || typeof value === "string" ||
      typeof value === "number" || typeof value === "boolean") {
      return value;
    }
    if (typeof value === "function") {
      if (types.isProxy(value)) mismatch();
      return value;
    }
    if (typeof value !== "object" || types.isProxy(value) || active.has(value) ||
      Object.getOwnPropertySymbols(value).length !== 0) mismatch();

    active.add(value);
    try {
      if (Array.isArray(value)) return ownArray(value, visit);
      if (!isPlainRecord(value)) mismatch();
      const copy: PlainRecord = {};
      for (const key of Object.getOwnPropertyNames(value)) {
        if (key === "__proto__") mismatch();
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) mismatch();
        copy[key] = visit(descriptor.value);
      }
      return copy;
    } finally {
      active.delete(value);
    }
  };

  return visit(borrowed) as T;
}

function ownArray(value: unknown[], visit: (item: unknown) => unknown): unknown[] {
  if (Object.getPrototypeOf(value) !== Array.prototype) mismatch();
  const length = Object.getOwnPropertyDescriptor(value, "length");
  if (length === undefined || !("value" in length) || !Number.isSafeInteger(length.value) ||
    length.value < 0 || Object.getOwnPropertyNames(value).length !== length.value + 1) mismatch();
  const copy: unknown[] = [];
  for (let index = 0; index < length.value; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) mismatch();
    copy.push(visit(descriptor.value));
  }
  return copy;
}

function exactRecord(value: unknown, keys: readonly string[]): PlainRecord {
  if (!isPlainRecord(value)) mismatch();
  const actual = Object.getOwnPropertyNames(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) mismatch();
  return value;
}

function exactOptionalRecord(
  value: unknown,
  requiredKeys: readonly string[],
  optionalKey: string,
): { readonly record: PlainRecord; readonly hasOptional: boolean } {
  if (!isPlainRecord(value)) mismatch();
  const hasOptional = Object.prototype.hasOwnProperty.call(value, optionalKey);
  const record = exactRecord(value, hasOptional ? [...requiredKeys, optionalKey] : requiredKeys);
  if (hasOptional && record[optionalKey] === undefined) mismatch();
  return { record, hasOptional };
}

function denseArray(value: unknown, expectedLength?: number): readonly unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype ||
    (expectedLength !== undefined && value.length !== expectedLength) ||
    Object.getOwnPropertyNames(value).length !== value.length + 1) mismatch();
  return value;
}

function nonEmptyText(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value ||
    /[\u0000-\u001f]/.test(value)) mismatch();
  return value;
}

function canonicalInstant(value: unknown): string {
  const text = nonEmptyText(value);
  try {
    if (new Date(text).toISOString() !== text) mismatch();
  } catch {
    mismatch();
  }
  return text;
}

function positiveInteger(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) mismatch();
  return value as number;
}

function canonicalFactor(value: unknown): string {
  const factor = canonicalDecimal(value);
  const fractional = /^0\.(\d+)$/.exec(factor)?.[1];
  if (factor !== value || (factor !== "0" && factor !== "1" &&
    (fractional === undefined || fractional.length > 18))) mismatch();
  return factor;
}

function webUrl(value: unknown): string {
  const text = nonEmptyText(value);
  try {
    const parsed = new URL(text);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") mismatch();
  } catch {
    mismatch();
  }
  return text;
}

function deepFreeze<T>(value: T, seen = new Set<object>()): T {
  if (value === null || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function sameData(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((item, index) => sameData(item, right[index]));
  }
  if (!isPlainRecord(left) || !isPlainRecord(right)) return false;
  const leftKeys = Object.getOwnPropertyNames(left).sort();
  const rightKeys = Object.getOwnPropertyNames(right).sort();
  return leftKeys.length === rightKeys.length &&
    leftKeys.every((key, index) => key === rightKeys[index] && sameData(left[key], right[key]));
}

function captureDefinition(value: unknown, expectedCriterionId: CityCriterionId) {
  const definition = exactRecord(value, DEFINITION_KEYS);
  if (definition.criterionId !== expectedCriterionId ||
    (definition.direction !== "at_least" && definition.direction !== "at_most")) mismatch();
  const compatibleGeoScopes = denseArray(definition.compatibleGeoScopes).map(nonEmptyText);
  if (compatibleGeoScopes.length === 0 || new Set(compatibleGeoScopes).size !== compatibleGeoScopes.length) {
    mismatch();
  }
  return {
    criterionId: expectedCriterionId,
    definitionId: nonEmptyText(definition.definitionId),
    direction: definition.direction,
    unit: nonEmptyText(definition.unit),
    denominator: nonEmptyText(definition.denominator),
    compatibleGeoScopes,
    freshnessPolicyVersion: nonEmptyText(definition.freshnessPolicyVersion),
    evaluatorVersion: nonEmptyText(definition.evaluatorVersion),
  };
}

function captureEvaluators(value: unknown): CapturedEvaluators {
  const registry = exactRecord(value, CITY_CRITERION_IDS);
  return Object.fromEntries(CITY_CRITERION_IDS.map((criterionId) => {
    const evaluator = exactRecord(registry[criterionId], ["definition", "canonicalizeTarget", "evaluate"]);
    if (typeof evaluator.canonicalizeTarget !== "function" || typeof evaluator.evaluate !== "function" ||
      types.isProxy(evaluator.canonicalizeTarget) || types.isProxy(evaluator.evaluate)) mismatch();
    return [criterionId, {
      definition: captureDefinition(evaluator.definition, criterionId),
      canonicalizeTarget: evaluator.canonicalizeTarget as CapturedEvaluator["canonicalizeTarget"],
      evaluate: evaluator.evaluate as CapturedEvaluator["evaluate"],
    }];
  })) as unknown as CapturedEvaluators;
}

function parseCriteriaStructure(value: unknown, evaluators: CapturedEvaluators): CityCriteriaSnapshot {
  const snapshot = exactRecord(value, [
    "schemaVersion",
    "id",
    "profileSnapshotId",
    "preferenceProfileSnapshotId",
    "criteria",
    "rulesVersion",
    "confirmedAt",
  ]);
  if (snapshot.schemaVersion !== "city-criteria@1" || snapshot.rulesVersion !== "city-criteria@1") mismatch();
  const criteria = denseArray(snapshot.criteria, CITY_CRITERION_IDS.length).map((item, index) => {
    const criterion = exactRecord(item, CRITERION_KEYS);
    const criterionId = CITY_CRITERION_IDS[index];
    if (criterion.criterionId !== criterionId ||
      criterion.definitionId !== evaluators[criterionId].definition.definitionId ||
      (criterion.mode !== "required" && criterion.mode !== "weighted") ||
      ![1, 2, 3, 4, 5].includes(criterion.importance as number)) mismatch();
    return {
      criterionId,
      definitionId: nonEmptyText(criterion.definitionId),
      mode: criterion.mode,
      importance: criterion.importance as CityImportance,
      target: nonEmptyText(criterion.target),
    };
  }) as unknown as CityCriteriaSnapshot["criteria"];
  return {
    schemaVersion: "city-criteria@1",
    id: nonEmptyText(snapshot.id),
    profileSnapshotId: nonEmptyText(snapshot.profileSnapshotId),
    preferenceProfileSnapshotId: nonEmptyText(snapshot.preferenceProfileSnapshotId),
    criteria,
    rulesVersion: "city-criteria@1",
    confirmedAt: canonicalInstant(snapshot.confirmedAt),
  };
}

function canonicalizeCriteria(
  criteria: CityCriteriaSnapshot,
  evaluators: CapturedEvaluators,
): CityCriteriaSnapshot {
  for (const criterion of criteria.criteria) {
    const evaluator = evaluators[criterion.criterionId];
    const receiver = deepFreeze({ capability: "canonicalizeTarget" as const });
    const canonical = Reflect.apply(evaluator.canonicalizeTarget, receiver, [criterion.target]);
    if (typeof canonical !== "string" || canonical !== criterion.target) mismatch();
  }
  return criteria;
}

function parseVerifiedBasis(value: unknown): CityVerifiedFactBasis {
  if (!isPlainRecord(value)) mismatch();
  if (value.kind === "canonical_scalar") {
    const basis = exactRecord(value, ["kind", "value"]);
    return { kind: "canonical_scalar", value: nonEmptyText(basis.value) };
  }
  if (value.kind === "municipal_safety") {
    const basis = exactRecord(value, ["kind", "quantity"]);
    const quantity = exactRecord(basis.quantity, ["offenceCount", "population", "rateBasis"]);
    const offenceCount = nonEmptyText(quantity.offenceCount);
    const population = nonEmptyText(quantity.population);
    if (!/^(0|[1-9]\d*)$/.test(offenceCount) || !/^[1-9]\d*$/.test(population) ||
      quantity.rateBasis !== "offences_per_100000_residents") mismatch();
    return {
      kind: "municipal_safety",
      quantity: { offenceCount, population, rateBasis: "offences_per_100000_residents" },
    };
  }
  mismatch();
}

function parseOutcome(value: unknown): CityCommittedFactProjection["outcome"] {
  if (!isPlainRecord(value)) mismatch();
  if (value.kind === "verified") {
    const outcome = exactRecord(value, ["kind", "basis"]);
    return { kind: "verified", basis: parseVerifiedBasis(outcome.basis) };
  }
  if (value.kind === "unknown") {
    const outcome = exactRecord(value, ["kind", "reason"]);
    if (!UNKNOWN_REASONS.includes(outcome.reason as CityUnknownReason)) mismatch();
    return { kind: "unknown", reason: outcome.reason as CityUnknownReason };
  }
  mismatch();
}

function parseAcceptedLink(
  value: unknown,
  criterionId: CityCriterionId,
  referencePeriod: string | null,
  outcome: CityCommittedFactProjection["outcome"],
): CityAcceptedFactLinkProjection {
  const { record: link, hasOptional: hasReferenceYear } = exactOptionalRecord(
    value,
    ["sourceId", "disposition", "navigationUrl", "resolvedEvidenceUrl"],
    "referenceYear",
  );
  if (link.disposition !== "accepted") mismatch();
  const referenceYear = hasReferenceYear ? positiveInteger(link.referenceYear) : undefined;
  if (criterionId === "safety") {
    if (outcome.kind !== "verified" || referencePeriod === null || !/^\d+$/.test(referencePeriod) ||
      referenceYear === undefined || Number(referencePeriod) !== referenceYear) mismatch();
  }
  return {
    sourceId: nonEmptyText(link.sourceId),
    disposition: "accepted",
    navigationUrl: webUrl(link.navigationUrl),
    resolvedEvidenceUrl: webUrl(link.resolvedEvidenceUrl),
    ...(referenceYear === undefined ? {} : { referenceYear }),
  };
}

function parseReviewedLink(
  value: unknown,
  criterionId: CityCriterionId,
): CityReviewedFactLinkProjection {
  if (!isPlainRecord(value)) mismatch();
  const optionalKeys = ["resolvedEvidenceUrl", "referenceYear", "rejectionReason"];
  const actualKeys = Object.getOwnPropertyNames(value);
  const requiredKeys = ["sourceId", "disposition", "navigationUrl"];
  if (requiredKeys.some((key) => !actualKeys.includes(key)) ||
    actualKeys.some((key) => !requiredKeys.includes(key) && !optionalKeys.includes(key))) mismatch();
  for (const key of optionalKeys) {
    if (Object.prototype.hasOwnProperty.call(value, key) && value[key] === undefined) mismatch();
  }
  if (value.disposition !== "reviewed_rejected") mismatch();
  const hasReason = Object.prototype.hasOwnProperty.call(value, "rejectionReason");
  if (criterionId === "safety") {
    if (!hasReason || !REJECTION_REASONS.includes(value.rejectionReason as CityFactLinkRejectionReason)) {
      mismatch();
    }
  } else if (hasReason) mismatch();
  const resolvedEvidenceUrl = Object.prototype.hasOwnProperty.call(value, "resolvedEvidenceUrl")
    ? webUrl(value.resolvedEvidenceUrl)
    : undefined;
  const referenceYear = Object.prototype.hasOwnProperty.call(value, "referenceYear")
    ? positiveInteger(value.referenceYear)
    : undefined;
  return {
    sourceId: nonEmptyText(value.sourceId),
    disposition: "reviewed_rejected",
    navigationUrl: webUrl(value.navigationUrl),
    ...(resolvedEvidenceUrl === undefined ? {} : { resolvedEvidenceUrl }),
    ...(referenceYear === undefined ? {} : { referenceYear }),
    ...(hasReason ? { rejectionReason: value.rejectionReason as CityFactLinkRejectionReason } : {}),
  };
}

function parseFact(
  value: unknown,
  criterion: CityCriterionDraft,
  evaluator: CapturedEvaluator,
): CityCommittedFactProjection {
  const fact = exactRecord(value, FACT_KEYS);
  if (fact.criterionId !== criterion.criterionId || fact.definitionId !== criterion.definitionId ||
    fact.freshnessBasis !== evaluator.definition.freshnessPolicyVersion) mismatch();
  const referencePeriod = fact.referencePeriod === null ? null : nonEmptyText(fact.referencePeriod);
  const outcome = parseOutcome(fact.outcome);
  const evidenceLinks = denseArray(fact.evidenceLinks).map((link) =>
    parseAcceptedLink(link, criterion.criterionId, referencePeriod, outcome));
  const manualCheckLinks = denseArray(fact.manualCheckLinks).map((link) =>
    parseReviewedLink(link, criterion.criterionId));
  return {
    criterionId: criterion.criterionId,
    definitionId: criterion.definitionId,
    geoScope: nonEmptyText(fact.geoScope),
    referencePeriod,
    freshnessBasis: evaluator.definition.freshnessPolicyVersion,
    unit: nonEmptyText(fact.unit),
    denominator: nonEmptyText(fact.denominator),
    outcome,
    evidenceLinks,
    manualCheckLinks,
  };
}

function parseFactTuple(
  value: unknown,
  criteria: CityCriteriaSnapshot,
  evaluators: CapturedEvaluators,
): CityCommittedFactProjectionTuple {
  const facts = denseArray(value, CITY_CRITERION_IDS.length).map((fact, index) => {
    const criterion = criteria.criteria[index];
    return parseFact(fact, criterion, evaluators[criterion.criterionId]);
  });
  return facts as unknown as CityCommittedFactProjectionTuple;
}

function parseAuthority(
  value: unknown,
  criteria: CityCriteriaSnapshot,
  evaluators: CapturedEvaluators,
): CityMarkerAuthorityProjection {
  const authority = exactRecord(value, [
    "cityId",
    "knowledgeRevisionId",
    "evidenceSnapshotId",
    "lastCheckedAt",
    "facts",
  ]);
  return {
    cityId: nonEmptyText(authority.cityId),
    knowledgeRevisionId: nonEmptyText(authority.knowledgeRevisionId),
    evidenceSnapshotId: nonEmptyText(authority.evidenceSnapshotId),
    lastCheckedAt: canonicalInstant(authority.lastCheckedAt),
    facts: parseFactTuple(authority.facts, criteria, evaluators),
  };
}

function parseWarning(value: unknown): CityUnknownWarning {
  const warning = exactRecord(value, ["criterionId", "definitionId", "reason"]);
  if (!CITY_CRITERION_IDS.includes(warning.criterionId as CityCriterionId) ||
    !UNKNOWN_REASONS.includes(warning.reason as CityUnknownReason)) mismatch();
  return {
    criterionId: warning.criterionId as CityCriterionId,
    definitionId: nonEmptyText(warning.definitionId),
    reason: warning.reason as CityUnknownReason,
  };
}

function parseMismatch(value: unknown): CityRequiredMismatch {
  const required = exactRecord(value, [
    "criterionId",
    "definitionId",
    "target",
    "verifiedBasis",
    "evaluatorVersion",
  ]);
  if (!CITY_CRITERION_IDS.includes(required.criterionId as CityCriterionId)) mismatch();
  return {
    criterionId: required.criterionId as CityCriterionId,
    definitionId: nonEmptyText(required.definitionId),
    target: nonEmptyText(required.target),
    verifiedBasis: parseVerifiedBasis(required.verifiedBasis),
    evaluatorVersion: nonEmptyText(required.evaluatorVersion),
  };
}

function parseMarker(
  value: unknown,
  criteria: CityCriteriaSnapshot,
  evaluators: CapturedEvaluators,
): CityLiveMarker {
  const marker = exactRecord(value, MARKER_KEYS);
  if ((marker.status !== "selectable" && marker.status !== "excluded") ||
    (marker.visualStatus !== "green" && marker.visualStatus !== "yellow" && marker.visualStatus !== "red")) {
    mismatch();
  }
  return {
    cityId: nonEmptyText(marker.cityId),
    rank: positiveInteger(marker.rank),
    status: marker.status,
    visualStatus: marker.visualStatus,
    knowledgeRevisionId: nonEmptyText(marker.knowledgeRevisionId),
    evidenceSnapshotId: nonEmptyText(marker.evidenceSnapshotId),
    lastCheckedAt: canonicalInstant(marker.lastCheckedAt),
    requiredMismatches: denseArray(marker.requiredMismatches).map(parseMismatch),
    unknownBasis: denseArray(marker.unknownBasis).map(parseWarning),
    verificationCoverage: canonicalFactor(marker.verificationCoverage),
    facts: parseFactTuple(marker.facts, criteria, evaluators),
  };
}

function copyFactInput(fact: CityCommittedFactProjection): CityRankingFactInput {
  const input = {
    criterionId: fact.criterionId,
    definitionId: fact.definitionId,
    geoScope: fact.geoScope,
    referencePeriod: fact.referencePeriod,
    freshnessBasis: fact.freshnessBasis,
    unit: fact.unit,
    denominator: fact.denominator,
    outcome: ownSnapshot(fact.outcome),
  };
  exactRecord(input, FACT_INPUT_KEYS);
  return input;
}

function copyCriterion(criterion: CityCriterionDraft): CityCriterionDraft {
  return {
    criterionId: criterion.criterionId,
    definitionId: criterion.definitionId,
    mode: criterion.mode,
    importance: criterion.importance,
    target: criterion.target,
  };
}

function parseEvaluation(
  value: unknown,
  rawOutcome: CityCommittedFactProjection["outcome"],
): CityCriterionEvaluation {
  if (!isPlainRecord(value)) mismatch();
  if (value.state === "verified") {
    const evaluation = exactRecord(value, ["state", "factor", "targetComparison"]);
    if (rawOutcome.kind === "unknown" ||
      (evaluation.targetComparison !== "matches" && evaluation.targetComparison !== "does_not_match")) {
      mismatch();
    }
    return {
      state: "verified",
      factor: canonicalFactor(evaluation.factor),
      targetComparison: evaluation.targetComparison,
    };
  }
  if (value.state === "unknown") {
    const evaluation = exactRecord(value, ["state", "factor", "targetComparison", "unknownReason"]);
    if (evaluation.factor !== "0" || evaluation.targetComparison !== "unknown" ||
      !UNKNOWN_REASONS.includes(evaluation.unknownReason as CityUnknownReason) ||
      (rawOutcome.kind === "unknown" && evaluation.unknownReason !== rawOutcome.reason)) mismatch();
    return {
      state: "unknown",
      factor: "0",
      targetComparison: "unknown",
      unknownReason: evaluation.unknownReason as CityUnknownReason,
    };
  }
  mismatch();
}

function evaluateFact(
  criterion: CityCriterionDraft,
  fact: CityCommittedFactProjection,
  assessmentAt: string,
  evaluator: CapturedEvaluator,
): { readonly fact: CityCommittedFactProjection; readonly evaluation: CityCriterionEvaluation } {
  const callbackInput = deepFreeze({
    criterion: copyCriterion(criterion),
    fact: copyFactInput(fact),
    assessmentAt,
  });
  const receiver = deepFreeze({ capability: "evaluate" as const });
  const returned = Reflect.apply(evaluator.evaluate, receiver, [callbackInput]);
  const evaluation = parseEvaluation(ownSnapshot(returned), fact.outcome);
  const outcome: CityCommittedFactProjection["outcome"] = evaluation.state === "verified"
    ? ownSnapshot(fact.outcome) as Extract<CityCommittedFactProjection["outcome"], { kind: "verified" }>
    : { kind: "unknown", reason: evaluation.unknownReason as CityUnknownReason };
  if (criterion.criterionId === "safety" && outcome.kind === "unknown" && fact.evidenceLinks.length > 0) {
    mismatch();
  }
  return {
    fact: {
      ...copyFactInput(fact),
      outcome,
      evidenceLinks: fact.evidenceLinks.map((link) => ({ ...link })),
      manualCheckLinks: fact.manualCheckLinks.map((link) => ({ ...link })),
    },
    evaluation,
  };
}

function weightedCoverage(
  criteria: CityCriteriaSnapshot["criteria"],
  evaluations: readonly CityCriterionEvaluation[],
): string {
  const denominator = BigInt(criteria.reduce((sum, criterion) => sum + criterion.importance, 0));
  const numerator = BigInt(criteria.reduce((sum, criterion, index) =>
    sum + (evaluations[index].state === "verified" ? criterion.importance : 0), 0));
  return rationalText(numerator, denominator);
}

function rationalText(numerator: bigint, denominator: bigint): string {
  let whole = numerator / denominator;
  const remainder = numerator % denominator;
  const scale = 10n ** 18n;
  let fraction = remainder * scale / denominator;
  const discarded = remainder * scale % denominator;
  if (discarded * 2n > denominator ||
    (discarded * 2n === denominator && fraction % 2n === 1n)) fraction += 1n;
  if (fraction === scale) {
    whole += 1n;
    fraction = 0n;
  }
  return fraction === 0n
    ? whole.toString()
    : `${whole}.${fraction.toString().padStart(18, "0").replace(/0+$/, "")}`;
}

function reconstructOwnedMarker(input: ReconstructCityLiveMarkerInput): CityLiveMarker {
  const root = exactOptionalRecord(
    input,
    ["assessmentAt", "criteria", "evaluators", "rank", "authority"],
    "persisted",
  );
  const assessmentAt = canonicalInstant(root.record.assessmentAt);
  const rank = positiveInteger(root.record.rank);
  const evaluators = captureEvaluators(root.record.evaluators);
  const criteria = parseCriteriaStructure(root.record.criteria, evaluators);
  const authority = parseAuthority(root.record.authority, criteria, evaluators);
  const persisted = root.hasOptional
    ? parseMarker(root.record.persisted, criteria, evaluators)
    : undefined;
  if (Date.parse(assessmentAt) > Date.parse(authority.lastCheckedAt)) mismatch();

  canonicalizeCriteria(criteria, evaluators);
  const effective = criteria.criteria.map((criterion, index) =>
    evaluateFact(criterion, authority.facts[index], assessmentAt, evaluators[criterion.criterionId]));
  const facts = effective.map(({ fact }) => fact) as unknown as CityCommittedFactProjectionTuple;
  const evaluations = effective.map(({ evaluation }) => evaluation);
  const requiredMismatches = criteria.criteria.flatMap((criterion, index) => {
    const evaluation = evaluations[index];
    const fact = facts[index];
    if (criterion.mode !== "required" || evaluation.state !== "verified" ||
      evaluation.targetComparison !== "does_not_match" || fact.outcome.kind !== "verified") return [];
    return [{
      criterionId: criterion.criterionId,
      definitionId: criterion.definitionId,
      target: criterion.target,
      verifiedBasis: ownSnapshot(fact.outcome.basis),
      evaluatorVersion: evaluators[criterion.criterionId].definition.evaluatorVersion,
    }];
  });
  const unknownBasis = criteria.criteria.flatMap((criterion, index) => {
    const outcome = facts[index].outcome;
    return outcome.kind === "unknown" ? [{
      criterionId: criterion.criterionId,
      definitionId: criterion.definitionId,
      reason: outcome.reason,
    }] : [];
  });
  const visualStatus: CityCommittedMarkerVisualStatus = requiredMismatches.length > 0
    ? "red"
    : unknownBasis.length > 0 ? "yellow" : "green";
  const marker: CityLiveMarker = {
    cityId: authority.cityId,
    rank,
    status: visualStatus === "red" ? "excluded" : "selectable",
    visualStatus,
    knowledgeRevisionId: authority.knowledgeRevisionId,
    evidenceSnapshotId: authority.evidenceSnapshotId,
    lastCheckedAt: authority.lastCheckedAt,
    requiredMismatches,
    unknownBasis,
    verificationCoverage: weightedCoverage(criteria.criteria, evaluations),
    facts,
  };
  if (persisted !== undefined && !sameData(marker, persisted)) mismatch();
  return deepFreeze(marker);
}

export function reconstructCityLiveMarker(input: ReconstructCityLiveMarkerInput): CityLiveMarker {
  return atBoundary(() => reconstructOwnedMarker(ownSnapshot(input)));
}

function parseStringList(value: unknown): readonly string[] {
  const values = denseArray(value).map(nonEmptyText);
  if (new Set(values).size !== values.length) mismatch();
  return values;
}

function parseRanking(value: unknown): CityFrontierRankingProjection {
  const ranking = exactRecord(value, ["assessmentAt", "orderedCityIds", "screenedExclusionCityIds"]);
  const orderedCityIds = parseStringList(ranking.orderedCityIds);
  const screenedExclusionCityIds = parseStringList(ranking.screenedExclusionCityIds);
  const screened = new Set(screenedExclusionCityIds);
  if (orderedCityIds.some((cityId) => screened.has(cityId))) mismatch();
  return {
    assessmentAt: canonicalInstant(ranking.assessmentAt),
    orderedCityIds,
    screenedExclusionCityIds,
  };
}

function parseBinding(
  value: unknown,
  criteria: CityCriteriaSnapshot,
  evaluators: CapturedEvaluators,
): CityMarkerBinding {
  const binding = exactRecord(value, ["marker", "markerDigest", "authority"]);
  const markerDigest = nonEmptyText(binding.markerDigest);
  if (!/^[0-9a-f]{64}$/.test(markerDigest)) mismatch();
  return {
    marker: parseMarker(binding.marker, criteria, evaluators),
    markerDigest,
    authority: parseAuthority(binding.authority, criteria, evaluators),
  };
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
  const markerDigest = nonEmptyText(entry.markerDigest);
  if (!/^[0-9a-f]{64}$/.test(markerDigest)) mismatch();
  return {
    cityId: nonEmptyText(entry.cityId),
    rank: positiveInteger(entry.rank),
    markerDigest,
    knowledgeRevisionId: nonEmptyText(entry.knowledgeRevisionId),
    evidenceSnapshotId: nonEmptyText(entry.evidenceSnapshotId),
    unknownBasis: denseArray(entry.unknownBasis).map(parseWarning),
  };
}

function parseFrontierProjection(value: unknown): CityFrontierProjection {
  if (!isPlainRecord(value)) mismatch();
  if (value.kind === "working") {
    const working = exactRecord(value, ["kind", "nextUncheckedRank", "selectableCityIds", "phase"]);
    if (working.phase !== "verification_required") mismatch();
    return {
      kind: "working",
      nextUncheckedRank: positiveInteger(working.nextUncheckedRank),
      selectableCityIds: parseStringList(working.selectableCityIds),
      phase: "verification_required",
    };
  }
  if (value.kind === "terminal") {
    const terminal = exactRecord(value, [
      "kind",
      "nextUncheckedRank",
      "selectableCityIds",
      "entries",
      "stopCondition",
    ]);
    if (terminal.stopCondition !== "three_selectable" &&
      terminal.stopCondition !== "catalog_exhausted" &&
      terminal.stopCondition !== "live_candidate_limit_reached") mismatch();
    return {
      kind: "terminal",
      nextUncheckedRank: positiveInteger(terminal.nextUncheckedRank),
      selectableCityIds: parseStringList(terminal.selectableCityIds),
      entries: denseArray(terminal.entries).map(parseTerminalEntry),
      stopCondition: terminal.stopCondition,
    };
  }
  mismatch();
}

function validateTransitionShape(
  ranking: CityFrontierRankingProjection,
  predecessorMarkers: null | readonly CityLiveMarker[],
  bindings: readonly CityMarkerBinding[],
): void {
  if (bindings.length === 0) {
    if (predecessorMarkers !== null) mismatch();
    return;
  }
  if (predecessorMarkers === null || predecessorMarkers.length !== bindings.length - 1 ||
    bindings.length > 10 || bindings.length > ranking.orderedCityIds.length) mismatch();
  for (let index = 0; index < bindings.length; index += 1) {
    const marker = bindings[index].marker;
    if (marker.rank !== index + 1 || marker.cityId !== ranking.orderedCityIds[index]) mismatch();
  }
}

function toTerminalEntry(marker: CityLiveMarker, markerDigest: string): CityTerminalEntry {
  return {
    cityId: marker.cityId,
    rank: marker.rank,
    markerDigest,
    knowledgeRevisionId: marker.knowledgeRevisionId,
    evidenceSnapshotId: marker.evidenceSnapshotId,
    unknownBasis: marker.unknownBasis.map((warning) => ({ ...warning })),
  };
}

function deriveFrontier(
  markers: readonly CityLiveMarker[],
  bindings: readonly CityMarkerBinding[],
  catalogSize: number,
): CityFrontierProjection {
  const selectableIndexes = markers.flatMap((marker, index) => marker.status === "selectable" ? [index] : []);
  const selectableCityIds = selectableIndexes.map((index) => markers[index].cityId);
  const nextUncheckedRank = markers.length + 1;
  const stopCondition: CityFrontierStopCondition | undefined = selectableCityIds.length >= 3
    ? "three_selectable"
    : markers.length >= catalogSize
      ? "catalog_exhausted"
      : markers.length >= 10 ? "live_candidate_limit_reached" : undefined;
  if (stopCondition === undefined) {
    return { kind: "working", nextUncheckedRank, selectableCityIds, phase: "verification_required" };
  }
  return {
    kind: "terminal",
    nextUncheckedRank,
    selectableCityIds,
    entries: selectableIndexes.map((index) =>
      toTerminalEntry(markers[index], bindings[index].markerDigest)),
    stopCondition,
  };
}

function reconstructOwnedFrontier(input: ReconstructCityFrontierInput): CityFrontierProjection {
  const root = exactOptionalRecord(
    input,
    ["ranking", "criteria", "evaluators", "predecessorMarkers", "markerBindings"],
    "persisted",
  );
  const evaluators = captureEvaluators(root.record.evaluators);
  const criteria = parseCriteriaStructure(root.record.criteria, evaluators);
  const ranking = parseRanking(root.record.ranking);
  const bindings = denseArray(root.record.markerBindings).map((binding) =>
    parseBinding(binding, criteria, evaluators));
  const predecessorMarkers = root.record.predecessorMarkers === null
    ? null
    : denseArray(root.record.predecessorMarkers).map((marker) =>
      parseMarker(marker, criteria, evaluators));
  const persisted = root.hasOptional ? parseFrontierProjection(root.record.persisted) : undefined;
  validateTransitionShape(ranking, predecessorMarkers, bindings);

  if (bindings.length === 0) canonicalizeCriteria(criteria, evaluators);
  const markers = bindings.map((binding, index) => reconstructCityLiveMarker({
    assessmentAt: ranking.assessmentAt,
    criteria,
    evaluators: root.record.evaluators as CityCriterionEvaluatorRegistry,
    rank: index + 1,
    authority: binding.authority,
    persisted: binding.marker,
  }));
  if (predecessorMarkers !== null) {
    for (let index = 0; index < predecessorMarkers.length; index += 1) {
      if (!sameData(predecessorMarkers[index], markers[index])) mismatch();
    }
    const predecessor = deriveFrontier(
      markers.slice(0, -1),
      bindings.slice(0, -1),
      ranking.orderedCityIds.length,
    );
    if (predecessor.kind !== "working") mismatch();
  }
  const projection = deriveFrontier(markers, bindings, ranking.orderedCityIds.length);
  if (persisted !== undefined && !sameData(projection, persisted)) mismatch();
  return deepFreeze(projection);
}

export function reconstructCityFrontier(input: ReconstructCityFrontierInput): CityFrontierProjection {
  return atBoundary(() => reconstructOwnedFrontier(ownSnapshot(input)));
}
