import type {
  CityCriterionId,
  CityUnknownReason,
  CityVerifiedFactBasis,
} from "../decision/city-criteria";
import type { CityDecisionIntegrity } from "../decision/city-integrity";
import type {
  Claim,
  LiveCapturedArtifact,
  ParserEntry,
} from "./contracts";
import type {
  CitySafetyArtifactReference,
  CitySafetyAttemptLedger,
  CitySafetyUsableCandidateAttempt,
} from "./city-safety-evidence";
import type {
  CitySafetySourcePlan,
  OfficialAuthorityDirectory,
} from "./city-safety-source-plan";
import type {
  TerminalEvidenceEntry,
  UnavailableEvidenceEntry,
  VerifiedEvidenceEntry,
} from "./research-plan";

export const SLOVENIA_CITY_FACT_SOURCE_IDS = Object.freeze([
  "si-city-safety",
  "si-city-long-term-rent",
  "si-city-urban-transit",
  "si-city-fixed-broadband",
] as const);

export type SloveniaCityFactSourceId =
  typeof SLOVENIA_CITY_FACT_SOURCE_IDS[number];

export type SloveniaCityFixedSourceId = Exclude<
  SloveniaCityFactSourceId,
  "si-city-safety"
>;

export interface CityEvidenceReplayIntegrity extends CityDecisionIntegrity {
  hashBytes(bytes: Uint8Array): string;
}

export const SLOVENIA_CITY_FIXED_CRITERION_BY_SOURCE = Object.freeze({
  "si-city-long-term-rent": "long_term_rent",
  "si-city-urban-transit": "urban_transit",
  "si-city-fixed-broadband": "fixed_broadband",
} as const) satisfies Readonly<Record<
  SloveniaCityFixedSourceId,
  Exclude<CityCriterionId, "safety">
>>;

export type SloveniaCityFixedCriterionId<
  S extends SloveniaCityFixedSourceId,
> = typeof SLOVENIA_CITY_FIXED_CRITERION_BY_SOURCE[S];

export interface CityEvidenceClaim<
  S extends SloveniaCityFactSourceId = SloveniaCityFactSourceId,
> extends Claim<CityVerifiedFactBasis, S> {
  readonly criterionId: CityCriterionId;
  readonly definitionId: string;
  readonly officialAreaId: string;
  readonly geoScope: string;
  readonly unit: string;
  readonly denominator: string;
  readonly freshnessPolicyVersion: string;
}

export interface CityFixedEvidenceClaim<
  S extends SloveniaCityFixedSourceId = SloveniaCityFixedSourceId,
> extends CityEvidenceClaim<S> {
  readonly value: { readonly kind: "canonical_scalar"; readonly value: string };
}

export interface CityFixedClaimContract<S extends SloveniaCityFixedSourceId> {
  readonly sourceId: S;
  readonly criterionId: SloveniaCityFixedCriterionId<S>;
  readonly definitionId: string;
  readonly scope: string;
  readonly officialAreaId: string;
  readonly geoScope: string;
  readonly unit: string;
  readonly denominator: string;
  readonly freshnessPolicyVersion: string;
  readonly valueKind: "canonical_scalar";
  readonly valuePolicyVersion: string;
  readonly sourcePeriodPolicyVersion: string;
}

export interface CityFixedValueValidationInput<S extends SloveniaCityFixedSourceId> {
  readonly sourceId: S;
  readonly criterionId: SloveniaCityFixedCriterionId<S>;
  readonly definitionId: string;
  readonly policyVersion: string;
  readonly value: string;
  readonly unit: string;
  readonly denominator: string;
}

export type CityFixedValueValidator = <S extends SloveniaCityFixedSourceId>(
  input: CityFixedValueValidationInput<S>,
) => string;

export interface CityFixedSourcePeriodValidationInput<
  S extends SloveniaCityFixedSourceId,
> {
  readonly sourceId: S;
  readonly policyVersion: string;
  readonly sourcePeriod: string;
  readonly assessmentAt: string;
}

export type CityFixedSourcePeriodValidator = <S extends SloveniaCityFixedSourceId>(
  input: CityFixedSourcePeriodValidationInput<S>,
) => "fresh" | "stale" | "not_comparable";

export interface CityFixedRoute {
  readonly routeId: string;
  readonly navigationUrl: string;
}

export interface CityFixedSourcePlan<S extends SloveniaCityFixedSourceId> {
  readonly planId: string;
  readonly sourceId: S;
  readonly cityId: string;
  readonly criterionId: SloveniaCityFixedCriterionId<S>;
  readonly definitionId: string;
  readonly claimContract: CityFixedClaimContract<S>;
  readonly routes: readonly CityFixedRoute[];
  readonly parserVersion: string;
  readonly rulesVersion: string;
}

export type CityFixedAttemptRejectionReason =
  | "http_not_found"
  | "source_drift"
  | "transport_failure"
  | "wrong_media_type"
  | "too_large"
  | "untrusted_redirect"
  | "retention_unapproved"
  | "universe_incomplete"
  | "definition_noncomparable"
  | "area_identifier_unproved"
  | "reference_period_unproved"
  | "license_unproved"
  | "stale"
  | "conflict";

export interface CityFixedRejectedAttempt<
  S extends SloveniaCityFixedSourceId = SloveniaCityFixedSourceId,
> {
  readonly cityCheckRunId: string;
  readonly sourceId: S;
  readonly index: number;
  readonly routeId: string;
  readonly navigationUrl: string;
  readonly resolvedEvidenceUrl?: string;
  readonly attemptedAt: string;
  readonly disposition: "rejected";
  readonly reason: CityFixedAttemptRejectionReason;
  readonly artifactIds: readonly string[];
}

export interface CityFixedAcceptedAttempt<
  S extends SloveniaCityFixedSourceId = SloveniaCityFixedSourceId,
> {
  readonly cityCheckRunId: string;
  readonly sourceId: S;
  readonly index: number;
  readonly routeId: string;
  readonly navigationUrl: string;
  readonly resolvedEvidenceUrl: string;
  readonly attemptedAt: string;
  readonly disposition: "accepted";
  readonly artifactIds: readonly string[];
  readonly claimIds: readonly string[];
}

export type CityFixedAttempt<
  S extends SloveniaCityFixedSourceId = SloveniaCityFixedSourceId,
> = CityFixedRejectedAttempt<S> | CityFixedAcceptedAttempt<S>;

export interface CityFixedAttemptLedger<
  S extends SloveniaCityFixedSourceId = SloveniaCityFixedSourceId,
> {
  readonly schemaVersion: "city-fixed-attempt-ledger@1";
  readonly cityCheckRunId: string;
  readonly cityId: string;
  readonly sourceId: S;
  readonly criterionId: SloveniaCityFixedCriterionId<S>;
  readonly planId: string;
  readonly definitionId: string;
  readonly valuePolicyVersion: string;
  readonly sourcePeriodPolicyVersion: string;
  readonly parserVersion: string;
  readonly rulesVersion: string;
  readonly assessmentAt: string;
  readonly attempts: readonly CityFixedAttempt<S>[];
  readonly result:
    | { readonly kind: "verified"; readonly claimIds: readonly string[] }
    | { readonly kind: "unknown"; readonly reason: CityUnknownReason };
  readonly completedAt: string;
}

export interface CityFixedDeadlineHandle {
  cancel(): void;
}

export interface CityFixedDeadlineScheduler {
  schedule(deadlineAt: string, onDeadline: () => void): CityFixedDeadlineHandle;
}

export interface CityFixedSourceRunInput<S extends SloveniaCityFixedSourceId> {
  readonly cityCheckRunId: string;
  readonly cityId: string;
  readonly sourceId: S;
  readonly criterionId: SloveniaCityFixedCriterionId<S>;
  readonly planId: string;
  readonly definitionId: string;
  readonly assessmentAt: string;
  readonly deadlineAt: string;
  readonly signal: AbortSignal;
  readonly now: () => string;
  readonly deadlineScheduler: CityFixedDeadlineScheduler;
  readonly validateValue: CityFixedValueValidator;
  readonly validateSourcePeriod: CityFixedSourcePeriodValidator;
}

export interface CityFixedRouteInspectionInput<S extends SloveniaCityFixedSourceId> {
  readonly cityCheckRunId: string;
  readonly cityId: string;
  readonly sourceId: S;
  readonly criterionId: SloveniaCityFixedCriterionId<S>;
  readonly planId: string;
  readonly definitionId: string;
  readonly assessmentAt: string;
  readonly deadlineAt: string;
  readonly attemptedAt: string;
  readonly routeIndex: number;
  readonly route: CityFixedRoute;
  readonly signal: AbortSignal;
}

export interface CityFixedAttemptLedgerExpectations<
  S extends SloveniaCityFixedSourceId,
> {
  readonly cityCheckRunId: string;
  readonly cityId: string;
  readonly sourceId: S;
  readonly criterionId: SloveniaCityFixedCriterionId<S>;
  readonly planId: string;
  readonly definitionId: string;
  readonly valuePolicyVersion: string;
  readonly sourcePeriodPolicyVersion: string;
  readonly routes: readonly CityFixedRoute[];
  readonly parserVersion: string;
  readonly rulesVersion: string;
  readonly assessmentAt: string;
  readonly notAfterAt: string;
}

export interface CityFixedRoutePort<
  S extends SloveniaCityFixedSourceId,
  C extends CityFixedEvidenceClaim<S>,
> {
  inspect(input: CityFixedRouteInspectionInput<S>): Promise<
    | {
        readonly kind: "verified";
        readonly attempt: CityFixedAcceptedAttempt<S>;
        readonly parserEntry: ParserEntry<S>;
        readonly claims: readonly [C];
      }
    | {
        readonly kind: "rejected";
        readonly attempt: CityFixedRejectedAttempt<S>;
        readonly parserEntry: ParserEntry<S>;
      }
  >;
}

export type CityFixedSourceRunResult<
  S extends SloveniaCityFixedSourceId,
  C extends CityFixedEvidenceClaim<S>,
> =
  | {
      readonly kind: "verified";
      readonly entry: VerifiedEvidenceEntry<S, C>;
      readonly ledger: CityFixedAttemptLedger<S>;
      readonly artifacts: readonly LiveCapturedArtifact<S>[];
    }
  | {
      readonly kind: "unknown";
      readonly entry: UnavailableEvidenceEntry<S>;
      readonly ledger: CityFixedAttemptLedger<S>;
      readonly artifacts: readonly LiveCapturedArtifact<S>[];
    };

export const SLOVENIA_CITY_SAFETY_FACT_CONTRACT = Object.freeze({
  sourceId: "si-city-safety",
  criterionId: "safety",
  definitionId: "si-municipal-police-offences-per-100000@1",
  geoScope: "municipality",
  unit: "offences_per_100000_residents",
  denominator: "municipality_population_january_1",
  freshnessPolicyVersion: "municipal-annual-july-boundary@1",
} as const);

export interface CitySafetyTerminalEntryInput {
  readonly cityCheckRunId: string;
  readonly ledger: CitySafetyAttemptLedger;
  readonly artifacts: readonly LiveCapturedArtifact<"si-city-safety">[];
  readonly sourcePlan: CitySafetySourcePlan;
  readonly authorityDirectory: OfficialAuthorityDirectory;
}

const FIXED_REJECTION_REASONS = new Set<CityFixedAttemptRejectionReason>([
  "http_not_found",
  "source_drift",
  "transport_failure",
  "wrong_media_type",
  "too_large",
  "untrusted_redirect",
  "retention_unapproved",
  "universe_incomplete",
  "definition_noncomparable",
  "area_identifier_unproved",
  "reference_period_unproved",
  "license_unproved",
  "stale",
  "conflict",
]);

const SOURCE_UNAVAILABLE_REASONS = new Set<CityFixedAttemptRejectionReason>([
  "source_drift",
  "transport_failure",
  "wrong_media_type",
  "too_large",
  "untrusted_redirect",
  "retention_unapproved",
  "license_unproved",
]);

const NOT_COMPARABLE_REASONS = new Set<CityFixedAttemptRejectionReason>([
  "universe_incomplete",
  "definition_noncomparable",
  "area_identifier_unproved",
  "reference_period_unproved",
]);

const PLAN_KEYS = [
  "planId",
  "sourceId",
  "cityId",
  "criterionId",
  "definitionId",
  "claimContract",
  "routes",
  "parserVersion",
  "rulesVersion",
] as const;

const CLAIM_CONTRACT_KEYS = [
  "sourceId",
  "criterionId",
  "definitionId",
  "scope",
  "officialAreaId",
  "geoScope",
  "unit",
  "denominator",
  "freshnessPolicyVersion",
  "valueKind",
  "valuePolicyVersion",
  "sourcePeriodPolicyVersion",
] as const;

const CLAIM_KEYS = [
  "claimId",
  "sourceId",
  "value",
  "scope",
  "sourcePeriod",
  "anchor",
  "status",
  "criterionId",
  "definitionId",
  "officialAreaId",
  "geoScope",
  "unit",
  "denominator",
  "freshnessPolicyVersion",
] as const;

function fail(message = "city_fixed_operation_failed"): never {
  throw new Error(message);
}

function integrityMismatch(): never {
  throw new Error("integrity_mismatch");
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function denseArray(value: unknown): value is readonly unknown[] {
  if (!Array.isArray(value)) return false;
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(value, index)) return false;
  }
  return true;
}

function exactKeys(value: object, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index]);
}

function exactOptionalKeys(
  value: object,
  required: readonly string[],
  optional: readonly string[],
): boolean {
  const actual = Object.keys(value);
  return required.every((key) => actual.includes(key)) &&
    actual.every((key) => required.includes(key) || optional.includes(key));
}

function canonicalText(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.trim() === value &&
    !/[\u0000-\u001f\u007f]/.test(value);
}

function canonicalIdentifier(value: unknown): value is string {
  return canonicalText(value) && /^[A-Za-z0-9][A-Za-z0-9._:@-]*$/.test(value);
}

function canonicalInstant(value: unknown): value is string {
  try {
    return typeof value === "string" && new Date(value).toISOString() === value;
  } catch {
    return false;
  }
}

function instantMillis(value: string): number {
  return Date.parse(value);
}

function canonicalHttpsUrl(value: unknown): value is string {
  try {
    if (typeof value !== "string" || value.trim() !== value) return false;
    const url = new URL(value);
    return url.protocol === "https:" && url.username === "" && url.password === "" &&
      url.hash === "" && url.href === value;
  } catch {
    return false;
  }
}

function sha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function cloneFrozen<T>(value: T): T {
  if (value instanceof Uint8Array) return new Uint8Array(value) as T;
  if (Array.isArray(value)) {
    return Object.freeze(value.map((item) => cloneFrozen(item))) as T;
  }
  if (value !== null && typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) fail();
    const clone = Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, cloneFrozen(child)]),
    );
    return Object.freeze(clone) as T;
  }
  return value;
}

function descriptorSafeFrozenPlanCopy<T>(borrowed: T): T {
  const active = new Set<object>();

  const copy = (value: unknown): unknown => {
    if (value instanceof Uint8Array) return new Uint8Array(value);
    if (value === null || typeof value !== "object") return value;
    if (active.has(value) || Object.getOwnPropertySymbols(value).length !== 0) {
      fail("invalid_city_fixed_plan");
    }

    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) fail("invalid_city_fixed_plan");
      const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
      if (lengthDescriptor === undefined || !("value" in lengthDescriptor) ||
        typeof lengthDescriptor.value !== "number" || !Number.isSafeInteger(lengthDescriptor.value) ||
        lengthDescriptor.value < 0) {
        fail("invalid_city_fixed_plan");
      }
      const length = lengthDescriptor.value;
      if (Object.getOwnPropertyNames(value).length !== length + 1) {
        fail("invalid_city_fixed_plan");
      }

      active.add(value);
      try {
        const owned: unknown[] = [];
        for (let index = 0; index < length; index += 1) {
          const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
          if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
            fail("invalid_city_fixed_plan");
          }
          owned.push(copy(descriptor.value));
        }
        return Object.freeze(owned);
      } finally {
        active.delete(value);
      }
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      fail("invalid_city_fixed_plan");
    }
    active.add(value);
    try {
      const entries = Object.getOwnPropertyNames(value).map((key) => {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
          fail("invalid_city_fixed_plan");
        }
        return [key, copy(descriptor.value)] as const;
      });
      return Object.freeze(Object.fromEntries(entries));
    } finally {
      active.delete(value);
    }
  };

  return copy(borrowed) as T;
}

function validateRoutes(value: unknown): readonly CityFixedRoute[] {
  if (!denseArray(value) || value.length === 0) fail("invalid_city_fixed_plan");
  const routes = value.map((candidate) => {
    if (!record(candidate) || !exactKeys(candidate, ["routeId", "navigationUrl"]) ||
      !canonicalIdentifier(candidate.routeId) || !canonicalHttpsUrl(candidate.navigationUrl)) {
      fail("invalid_city_fixed_plan");
    }
    return candidate as unknown as CityFixedRoute;
  });
  if (new Set(routes.map(({ routeId }) => routeId)).size !== routes.length ||
    new Set(routes.map(({ navigationUrl }) => navigationUrl)).size !== routes.length) {
    fail("invalid_city_fixed_plan");
  }
  return routes;
}

function validateFixedPlan<S extends SloveniaCityFixedSourceId>(
  value: CityFixedSourcePlan<S>,
): CityFixedSourcePlan<S> {
  if (!record(value) || !exactKeys(value, PLAN_KEYS) ||
    !Object.hasOwn(SLOVENIA_CITY_FIXED_CRITERION_BY_SOURCE, value.sourceId) ||
    !canonicalIdentifier(value.planId) || !canonicalIdentifier(value.cityId) ||
    !canonicalIdentifier(value.definitionId) || !canonicalIdentifier(value.parserVersion) ||
    !canonicalIdentifier(value.rulesVersion) ||
    value.criterionId !== SLOVENIA_CITY_FIXED_CRITERION_BY_SOURCE[value.sourceId]) {
    fail("invalid_city_fixed_plan");
  }
  const contract = value.claimContract;
  if (!record(contract) || !exactKeys(contract, CLAIM_CONTRACT_KEYS) ||
    contract.sourceId !== value.sourceId || contract.criterionId !== value.criterionId ||
    contract.definitionId !== value.definitionId || contract.valueKind !== "canonical_scalar" ||
    !canonicalText(contract.scope) || !canonicalText(contract.officialAreaId) ||
    !canonicalText(contract.geoScope) || !canonicalText(contract.unit) ||
    !canonicalText(contract.denominator) ||
    !canonicalIdentifier(contract.freshnessPolicyVersion) ||
    !canonicalIdentifier(contract.valuePolicyVersion) ||
    !canonicalIdentifier(contract.sourcePeriodPolicyVersion)) {
    fail("invalid_city_fixed_plan");
  }
  validateRoutes(value.routes);
  return value;
}

export function reconstructCityFixedSourcePlan<
  S extends SloveniaCityFixedSourceId,
>(value: unknown, expectedSourceId: S): CityFixedSourcePlan<S> {
  if (!Object.hasOwn(SLOVENIA_CITY_FIXED_CRITERION_BY_SOURCE, expectedSourceId)) {
    fail("invalid_city_fixed_plan");
  }
  const owned = descriptorSafeFrozenPlanCopy(value);
  if (!record(owned) || owned.sourceId !== expectedSourceId) {
    fail("invalid_city_fixed_plan");
  }
  return validateFixedPlan(owned as unknown as CityFixedSourcePlan<S>);
}

function validateRunBinding<S extends SloveniaCityFixedSourceId>(
  input: CityFixedSourceRunInput<S>,
  plan: CityFixedSourcePlan<S>,
): void {
  if (!canonicalIdentifier(input.cityCheckRunId) || input.cityId !== plan.cityId ||
    input.sourceId !== plan.sourceId || input.criterionId !== plan.criterionId ||
    input.planId !== plan.planId || input.definitionId !== plan.definitionId ||
    !canonicalInstant(input.assessmentAt) || !canonicalInstant(input.deadlineAt) ||
    instantMillis(input.assessmentAt) >= instantMillis(input.deadlineAt) ||
    typeof input.now !== "function" || typeof input.validateValue !== "function" ||
    typeof input.validateSourcePeriod !== "function" ||
    !record(input.deadlineScheduler) || typeof input.deadlineScheduler.schedule !== "function" ||
    !(input.signal instanceof AbortSignal)) {
    fail("invalid_city_fixed_run");
  }
}

function snapshotRunInput<S extends SloveniaCityFixedSourceId>(
  input: CityFixedSourceRunInput<S>,
): CityFixedSourceRunInput<S> {
  return Object.freeze({
    cityCheckRunId: input.cityCheckRunId,
    cityId: input.cityId,
    sourceId: input.sourceId,
    criterionId: input.criterionId,
    planId: input.planId,
    definitionId: input.definitionId,
    assessmentAt: input.assessmentAt,
    deadlineAt: input.deadlineAt,
    signal: input.signal,
    now: input.now,
    deadlineScheduler: input.deadlineScheduler,
    validateValue: input.validateValue,
    validateSourcePeriod: input.validateSourcePeriod,
  });
}

function validateLiveArtifacts<S extends SloveniaCityFixedSourceId>(
  value: unknown,
  input: CityFixedRouteInspectionInput<S>,
): readonly LiveCapturedArtifact<S>[] {
  if (!denseArray(value)) fail();
  const artifacts = value.map((candidate) => {
    if (!record(candidate) || candidate.origin !== "live" ||
      candidate.runId !== input.cityCheckRunId || candidate.sourceId !== input.sourceId ||
      !canonicalIdentifier(candidate.artifactId) || !canonicalText(candidate.role) ||
      !canonicalHttpsUrl(candidate.url) || !canonicalHttpsUrl(candidate.responseUrl) ||
      !canonicalInstant(candidate.capturedAt) ||
      !Number.isInteger(candidate.responseStatus) || !canonicalText(candidate.mediaType) ||
      !sha256(candidate.sha256) || !(candidate.bytes instanceof Uint8Array) ||
      !record(candidate.request) ||
      (candidate.request.method !== "GET" && candidate.request.method !== "POST") ||
      !canonicalHttpsUrl(candidate.request.url)) {
      fail();
    }
    return candidate as unknown as LiveCapturedArtifact<S>;
  });
  const artifactIds = artifacts.map(({ artifactId }) => artifactId);
  if (new Set(artifactIds).size !== artifactIds.length) fail();
  return artifacts;
}

interface ValidatedInspection<S extends SloveniaCityFixedSourceId, C extends CityFixedEvidenceClaim<S>> {
  readonly attempt: CityFixedAttempt<S>;
  readonly parserEntry: ParserEntry<S>;
  readonly artifacts: readonly LiveCapturedArtifact<S>[];
  readonly claim?: C;
}

function validateAttemptBinding<S extends SloveniaCityFixedSourceId>(
  value: unknown,
  inspectionInput: CityFixedRouteInspectionInput<S>,
  disposition: "accepted" | "rejected",
): asserts value is CityFixedAttempt<S> {
  if (!record(value)) fail();
  const required = [
    "cityCheckRunId",
    "sourceId",
    "index",
    "routeId",
    "navigationUrl",
    "attemptedAt",
    "disposition",
    "artifactIds",
  ];
  const dispositionKeys = disposition === "accepted" ? ["claimIds"] : ["reason"];
  if (!exactOptionalKeys(value, [...required, ...dispositionKeys], ["resolvedEvidenceUrl"]) ||
    value.cityCheckRunId !== inspectionInput.cityCheckRunId ||
    value.sourceId !== inspectionInput.sourceId || value.index !== inspectionInput.routeIndex ||
    value.routeId !== inspectionInput.route.routeId ||
    value.navigationUrl !== inspectionInput.route.navigationUrl ||
    value.attemptedAt !== inspectionInput.attemptedAt || value.disposition !== disposition ||
    !denseArray(value.artifactIds) ||
    !value.artifactIds.every(canonicalIdentifier) ||
    new Set(value.artifactIds).size !== value.artifactIds.length ||
    (value.resolvedEvidenceUrl !== undefined &&
      !canonicalHttpsUrl(value.resolvedEvidenceUrl))) {
    fail();
  }
  if (disposition === "accepted") {
    if (value.resolvedEvidenceUrl === undefined || !denseArray(value.claimIds) ||
      value.claimIds.length !== 1 || !value.claimIds.every(canonicalIdentifier)) fail();
  } else if (!FIXED_REJECTION_REASONS.has(value.reason as CityFixedAttemptRejectionReason)) {
    fail();
  }
}

function validateParserEntry<S extends SloveniaCityFixedSourceId>(
  value: unknown,
  inspectionInput: CityFixedRouteInspectionInput<S>,
  plan: CityFixedSourcePlan<S>,
  attempt: CityFixedAttempt<S>,
): { readonly parserEntry: ParserEntry<S>; readonly artifacts: readonly LiveCapturedArtifact<S>[] } {
  if (!record(value) || !exactOptionalKeys(
    value,
    ["sourceId", "navigationUrl", "resolvedEvidenceUrl", "artifacts", "versionHint"],
    [],
  ) || value.sourceId !== inspectionInput.sourceId ||
    value.navigationUrl !== attempt.navigationUrl || value.versionHint !== plan.parserVersion ||
    value.resolvedEvidenceUrl !== (attempt.resolvedEvidenceUrl ?? attempt.navigationUrl) ||
    !canonicalHttpsUrl(value.resolvedEvidenceUrl) || "indexedSourceUrl" in value) {
    fail();
  }
  const artifacts = validateLiveArtifacts(value.artifacts, inspectionInput);
  if (!sameStrings(attempt.artifactIds, artifacts.map(({ artifactId }) => artifactId))) fail();
  return { parserEntry: value as unknown as ParserEntry<S>, artifacts };
}

function validateFixedClaim<S extends SloveniaCityFixedSourceId, C extends CityFixedEvidenceClaim<S>>(
  value: unknown,
  plan: CityFixedSourcePlan<S>,
  artifacts: readonly LiveCapturedArtifact<S>[],
): C {
  if (!record(value) || !exactKeys(value, CLAIM_KEYS) || value.sourceId !== plan.sourceId ||
    value.criterionId !== plan.criterionId || value.definitionId !== plan.definitionId ||
    value.scope !== plan.claimContract.scope ||
    value.officialAreaId !== plan.claimContract.officialAreaId ||
    value.geoScope !== plan.claimContract.geoScope || value.unit !== plan.claimContract.unit ||
    value.denominator !== plan.claimContract.denominator ||
    value.freshnessPolicyVersion !== plan.claimContract.freshnessPolicyVersion ||
    value.status !== "verified" || !canonicalIdentifier(value.claimId) ||
    !canonicalText(value.sourcePeriod) || !record(value.value) ||
    !exactKeys(value.value, ["kind", "value"]) || value.value.kind !== "canonical_scalar" ||
    !canonicalText(value.value.value) || !record(value.anchor)) {
    fail();
  }
  const anchor = value.anchor;
  if (!exactKeys(anchor, ["artifactId", "locator", "excerptSha256"]) ||
    !canonicalIdentifier(anchor.artifactId) || !canonicalText(anchor.locator) ||
    !sha256(anchor.excerptSha256) ||
    artifacts.filter(({ artifactId }) => artifactId === anchor.artifactId).length !== 1) {
    fail();
  }
  return value as unknown as C;
}

function validateInspectionStructure<
  S extends SloveniaCityFixedSourceId,
  C extends CityFixedEvidenceClaim<S>,
>(
  value: unknown,
  inspectionInput: CityFixedRouteInspectionInput<S>,
  plan: CityFixedSourcePlan<S>,
): ValidatedInspection<S, C> {
  if (!record(value) || (value.kind !== "verified" && value.kind !== "rejected")) fail();
  if (value.kind === "rejected") {
    if (!exactKeys(value, ["kind", "attempt", "parserEntry"])) fail();
    validateAttemptBinding(value.attempt, inspectionInput, "rejected");
    const validated = validateParserEntry(value.parserEntry, inspectionInput, plan, value.attempt);
    return { attempt: value.attempt, ...validated };
  }
  if (!exactKeys(value, ["kind", "attempt", "parserEntry", "claims"]) ||
    !denseArray(value.claims) || value.claims.length !== 1) fail();
  validateAttemptBinding(value.attempt, inspectionInput, "accepted");
  if (value.attempt.disposition !== "accepted") fail();
  const validated = validateParserEntry(value.parserEntry, inspectionInput, plan, value.attempt);
  const claim = validateFixedClaim<S, C>(value.claims[0], plan, validated.artifacts);
  if (!sameStrings(value.attempt.claimIds, [claim.claimId])) fail();
  return { attempt: value.attempt, ...validated, claim };
}

function invokePolicyCallback<T>(signal: AbortSignal, callback: () => T): T {
  if (signal.aborted) throw signal.reason;
  try {
    const result = callback();
    if (signal.aborted) throw signal.reason;
    return result;
  } catch (error) {
    if (signal.aborted) throw signal.reason;
    throw error;
  }
}

function validateInspectionPolicy<
  S extends SloveniaCityFixedSourceId,
  C extends CityFixedEvidenceClaim<S>,
>(
  validated: ValidatedInspection<S, C>,
  plan: CityFixedSourcePlan<S>,
  input: CityFixedSourceRunInput<S>,
  signal: AbortSignal,
): "fresh" | "stale" | "not_comparable" {
  if (validated.attempt.disposition !== "accepted" || validated.claim === undefined) fail();
  const claim = validated.claim;
  const canonicalValue = invokePolicyCallback(signal, () => input.validateValue({
    sourceId: plan.sourceId,
    criterionId: plan.criterionId,
    definitionId: plan.definitionId,
    policyVersion: plan.claimContract.valuePolicyVersion,
    value: claim.value.value,
    unit: plan.claimContract.unit,
    denominator: plan.claimContract.denominator,
  }));
  if (canonicalValue !== claim.value.value) fail();
  const periodDisposition = invokePolicyCallback(signal, () => input.validateSourcePeriod({
    sourceId: plan.sourceId,
    policyVersion: plan.claimContract.sourcePeriodPolicyVersion,
    sourcePeriod: claim.sourcePeriod,
    assessmentAt: input.assessmentAt,
  }));
  if (!["fresh", "stale", "not_comparable"].includes(periodDisposition)) fail();
  return periodDisposition;
}

function unknownReason(attempts: readonly CityFixedAttempt[]): CityUnknownReason {
  const reasons = attempts.flatMap((attempt) =>
    attempt.disposition === "rejected" ? [attempt.reason] : []);
  if (reasons.includes("conflict")) return "conflict";
  if (reasons.some((reason) => SOURCE_UNAVAILABLE_REASONS.has(reason))) {
    return "source_unavailable";
  }
  if (reasons.includes("stale")) return "stale";
  if (reasons.some((reason) => NOT_COMPARABLE_REASONS.has(reason))) {
    return "not_comparable";
  }
  return "not_found";
}

function normalizedPeriodRejection<S extends SloveniaCityFixedSourceId>(
  attempt: CityFixedAcceptedAttempt<S>,
  disposition: "stale" | "not_comparable",
): CityFixedRejectedAttempt<S> {
  return {
    cityCheckRunId: attempt.cityCheckRunId,
    sourceId: attempt.sourceId,
    index: attempt.index,
    routeId: attempt.routeId,
    navigationUrl: attempt.navigationUrl,
    resolvedEvidenceUrl: attempt.resolvedEvidenceUrl,
    attemptedAt: attempt.attemptedAt,
    disposition: "rejected",
    reason: disposition === "stale" ? "stale" : "reference_period_unproved",
    artifactIds: [...attempt.artifactIds],
  };
}

function ledgerBase<S extends SloveniaCityFixedSourceId>(
  input: CityFixedSourceRunInput<S>,
  plan: CityFixedSourcePlan<S>,
  attempts: readonly CityFixedAttempt<S>[],
  completedAt: string,
): Omit<CityFixedAttemptLedger<S>, "result"> {
  return {
    schemaVersion: "city-fixed-attempt-ledger@1",
    cityCheckRunId: input.cityCheckRunId,
    cityId: input.cityId,
    sourceId: input.sourceId,
    criterionId: input.criterionId,
    planId: input.planId,
    definitionId: input.definitionId,
    valuePolicyVersion: plan.claimContract.valuePolicyVersion,
    sourcePeriodPolicyVersion: plan.claimContract.sourcePeriodPolicyVersion,
    parserVersion: plan.parserVersion,
    rulesVersion: plan.rulesVersion,
    assessmentAt: input.assessmentAt,
    attempts,
    completedAt,
  };
}

function terminalParserEntry<S extends SloveniaCityFixedSourceId>(
  summary: ParserEntry<S>,
  artifacts: readonly LiveCapturedArtifact<S>[],
): ParserEntry<S> {
  return {
    sourceId: summary.sourceId,
    navigationUrl: summary.navigationUrl,
    resolvedEvidenceUrl: summary.resolvedEvidenceUrl,
    artifacts,
    ...(summary.versionHint === undefined ? {} : { versionHint: summary.versionHint }),
  };
}

export async function runCityFixedSourcePlan<
  S extends SloveniaCityFixedSourceId,
  C extends CityFixedEvidenceClaim<S>,
>(
  callerInput: CityFixedSourceRunInput<S>,
  callerPlan: CityFixedSourcePlan<S>,
  port: CityFixedRoutePort<S, C>,
): Promise<CityFixedSourceRunResult<S, C>> {
  const input = snapshotRunInput(callerInput);
  const plan = reconstructCityFixedSourcePlan(callerPlan, input.sourceId);
  validateRunBinding(input, plan);
  if (input.signal.aborted) throw new Error("city_fixed_operation_aborted");

  const controller = new AbortController();
  let rejectOperation: ((reason: Error) => void) | undefined;
  let operationRejected = false;
  const operationFailure = new Promise<never>((_resolve, reject) => {
    rejectOperation = (reason) => {
      if (operationRejected) return;
      operationRejected = true;
      reject(reason);
    };
  });
  void operationFailure.catch(() => undefined);
  const abortOperation = (reason: Error): void => {
    if (!controller.signal.aborted) controller.abort(reason);
    rejectOperation?.(reason);
  };
  const onCallerAbort = (): void => abortOperation(new Error("city_fixed_operation_aborted"));
  input.signal.addEventListener("abort", onCallerAbort, { once: true });

  let deadlineHandle: CityFixedDeadlineHandle | undefined;
  const attempts: CityFixedAttempt<S>[] = [];
  const artifactUnion: LiveCapturedArtifact<S>[] = [];
  const ownedArtifactIds = new Set<string>();
  let lastClockMillis = instantMillis(input.assessmentAt);
  let lastParserEntry: ParserEntry<S> | undefined;

  try {
    deadlineHandle = input.deadlineScheduler.schedule(
      input.deadlineAt,
      () => abortOperation(new Error("city_fixed_deadline")),
    );
    if (!record(deadlineHandle) || typeof deadlineHandle.cancel !== "function") fail();

    for (let routeIndex = 0; routeIndex < plan.routes.length; routeIndex += 1) {
      if (controller.signal.aborted) throw controller.signal.reason;
      const attemptedAt = input.now();
      if (controller.signal.aborted) throw controller.signal.reason;
      if (!canonicalInstant(attemptedAt)) fail("invalid_city_fixed_clock");
      const attemptedMillis = instantMillis(attemptedAt);
      if (attemptedMillis < lastClockMillis ||
        attemptedMillis >= instantMillis(input.deadlineAt)) {
        abortOperation(new Error("invalid_city_fixed_clock"));
        throw new Error("invalid_city_fixed_clock");
      }
      const inspectionInput: CityFixedRouteInspectionInput<S> = Object.freeze({
        cityCheckRunId: input.cityCheckRunId,
        cityId: input.cityId,
        sourceId: input.sourceId,
        criterionId: input.criterionId,
        planId: input.planId,
        definitionId: input.definitionId,
        assessmentAt: input.assessmentAt,
        deadlineAt: input.deadlineAt,
        attemptedAt,
        routeIndex,
        route: plan.routes[routeIndex]!,
        signal: controller.signal,
      });
      const inspectionPromise = Promise.resolve().then(() => port.inspect(inspectionInput));
      const inspected: unknown = await Promise.race([inspectionPromise, operationFailure]);
      if (controller.signal.aborted) throw controller.signal.reason;

      const postCallAt = input.now();
      if (controller.signal.aborted) throw controller.signal.reason;
      if (!canonicalInstant(postCallAt)) fail("invalid_city_fixed_clock");
      const postCallMillis = instantMillis(postCallAt);
      if (postCallMillis < attemptedMillis || postCallMillis < lastClockMillis ||
        postCallMillis >= instantMillis(input.deadlineAt)) {
        abortOperation(new Error("invalid_city_fixed_clock"));
        throw new Error("invalid_city_fixed_clock");
      }
      const ownedInspection = cloneFrozen(inspected);
      const validated = Object.freeze(validateInspectionStructure<S, C>(
        ownedInspection,
        inspectionInput,
        plan,
      ));
      if (validated.artifacts.some(({ artifactId }) => ownedArtifactIds.has(artifactId))) fail();

      const periodDisposition = validated.attempt.disposition === "accepted"
        ? validateInspectionPolicy(validated, plan, input, controller.signal)
        : undefined;
      if (controller.signal.aborted) throw controller.signal.reason;

      for (const captured of validated.artifacts) {
        ownedArtifactIds.add(captured.artifactId);
        artifactUnion.push(captured);
      }
      lastClockMillis = postCallMillis;
      lastParserEntry = validated.parserEntry;

      if (validated.attempt.disposition === "accepted") {
        if (periodDisposition !== "fresh" || validated.claim === undefined) {
          if (periodDisposition !== "stale" && periodDisposition !== "not_comparable") fail();
          attempts.push(normalizedPeriodRejection(
            validated.attempt,
            periodDisposition,
          ));
          continue;
        }
        attempts.push(validated.attempt);
        const entryArtifacts = cloneFrozen(artifactUnion);
        const resultArtifacts = cloneFrozen(artifactUnion);
        const ledger: CityFixedAttemptLedger<S> = {
          ...ledgerBase(input, plan, attempts, postCallAt),
          result: { kind: "verified", claimIds: [...validated.attempt.claimIds] },
        };
        const entry: VerifiedEvidenceEntry<S, C> = {
          sourceId: plan.sourceId,
          coverage: "verified",
          parserEntry: terminalParserEntry(validated.parserEntry, entryArtifacts),
          claims: [validated.claim],
        };
        return cloneFrozen({ kind: "verified", entry, ledger, artifacts: resultArtifacts });
      }
      attempts.push(validated.attempt);
    }

    if (lastParserEntry === undefined || attempts.length !== plan.routes.length ||
      attempts.some(({ disposition }) => disposition !== "rejected")) fail();
    const completedAt = new Date(lastClockMillis).toISOString();
    const reason = unknownReason(attempts);
    const entryArtifacts = cloneFrozen(artifactUnion);
    const resultArtifacts = cloneFrozen(artifactUnion);
    const ledger: CityFixedAttemptLedger<S> = {
      ...ledgerBase(input, plan, attempts, completedAt),
      result: { kind: "unknown", reason },
    };
    const entry: UnavailableEvidenceEntry<S> = {
      sourceId: plan.sourceId,
      coverage: "unavailable",
      parserEntry: terminalParserEntry(lastParserEntry, entryArtifacts),
      blocker: {
        sourceId: plan.sourceId,
        kind: reason,
        navigationUrl: lastParserEntry.navigationUrl,
        resolvedUrl: lastParserEntry.resolvedEvidenceUrl,
        artifactIds: artifactUnion.map(({ artifactId }) => artifactId),
      },
    };
    return cloneFrozen({ kind: "unknown", entry, ledger, artifacts: resultArtifacts });
  } finally {
    deadlineHandle?.cancel();
    input.signal.removeEventListener("abort", onCallerAbort);
  }
}

const LEDGER_KEYS = [
  "schemaVersion",
  "cityCheckRunId",
  "cityId",
  "sourceId",
  "criterionId",
  "planId",
  "definitionId",
  "valuePolicyVersion",
  "sourcePeriodPolicyVersion",
  "parserVersion",
  "rulesVersion",
  "assessmentAt",
  "attempts",
  "result",
  "completedAt",
] as const;

function validateLedgerArtifactIds(
  value: unknown,
  ownedArtifactIds: Set<string>,
): readonly string[] {
  if (!denseArray(value) || !value.every(canonicalIdentifier) ||
    new Set(value).size !== value.length ||
    value.some((artifactId) => ownedArtifactIds.has(artifactId))) integrityMismatch();
  for (const artifactId of value) ownedArtifactIds.add(artifactId);
  return value;
}

function validateReconstructedAttempt<S extends SloveniaCityFixedSourceId>(
  value: unknown,
  expected: CityFixedAttemptLedgerExpectations<S>,
  index: number,
  completedMillis: number,
  previousAttemptedMillis: number,
  ownedArtifactIds: Set<string>,
): { readonly attempt: CityFixedAttempt<S>; readonly attemptedMillis: number } {
  if (!record(value)) integrityMismatch();
  const disposition = value.disposition;
  if (disposition !== "accepted" && disposition !== "rejected") integrityMismatch();
  const commonKeys = [
    "cityCheckRunId", "sourceId", "index", "routeId", "navigationUrl", "attemptedAt",
    "disposition", "artifactIds",
  ];
  const variantKeys = disposition === "accepted" ? ["claimIds"] : ["reason"];
  if (!exactOptionalKeys(value, [...commonKeys, ...variantKeys], ["resolvedEvidenceUrl"]) ||
    value.cityCheckRunId !== expected.cityCheckRunId || value.sourceId !== expected.sourceId ||
    value.index !== index || value.routeId !== expected.routes[index]?.routeId ||
    value.navigationUrl !== expected.routes[index]?.navigationUrl ||
    !canonicalInstant(value.attemptedAt)) integrityMismatch();
  const attemptedMillis = instantMillis(value.attemptedAt);
  if (attemptedMillis < previousAttemptedMillis || attemptedMillis > completedMillis) {
    integrityMismatch();
  }
  if (value.resolvedEvidenceUrl !== undefined &&
    !canonicalHttpsUrl(value.resolvedEvidenceUrl)) integrityMismatch();
  const artifactIds = validateLedgerArtifactIds(value.artifactIds, ownedArtifactIds);
  if (disposition === "accepted") {
    if (artifactIds.length === 0 || value.resolvedEvidenceUrl === undefined ||
      !denseArray(value.claimIds) ||
      value.claimIds.length !== 1 || !value.claimIds.every(canonicalIdentifier)) {
      integrityMismatch();
    }
  } else if (!FIXED_REJECTION_REASONS.has(value.reason as CityFixedAttemptRejectionReason)) {
    integrityMismatch();
  }
  return { attempt: value as unknown as CityFixedAttempt<S>, attemptedMillis };
}

function validateLedgerExpectation<S extends SloveniaCityFixedSourceId>(
  expected: CityFixedAttemptLedgerExpectations<S>,
): void {
  if (!record(expected) || !canonicalIdentifier(expected.cityCheckRunId) ||
    !canonicalIdentifier(expected.cityId) ||
    !Object.hasOwn(SLOVENIA_CITY_FIXED_CRITERION_BY_SOURCE, expected.sourceId) ||
    expected.criterionId !== SLOVENIA_CITY_FIXED_CRITERION_BY_SOURCE[expected.sourceId] ||
    !canonicalIdentifier(expected.planId) || !canonicalIdentifier(expected.definitionId) ||
    !canonicalIdentifier(expected.valuePolicyVersion) ||
    !canonicalIdentifier(expected.sourcePeriodPolicyVersion) ||
    !canonicalIdentifier(expected.parserVersion) || !canonicalIdentifier(expected.rulesVersion) ||
    !canonicalInstant(expected.assessmentAt) || !canonicalInstant(expected.notAfterAt) ||
    instantMillis(expected.assessmentAt) > instantMillis(expected.notAfterAt)) integrityMismatch();
  try {
    validateRoutes(expected.routes);
  } catch {
    integrityMismatch();
  }
}

export function reconstructCityFixedAttemptLedger<
  S extends SloveniaCityFixedSourceId,
>(
  borrowedValue: unknown,
  borrowedExpected: CityFixedAttemptLedgerExpectations<S>,
): CityFixedAttemptLedger<S> {
  try {
    const value = cloneFrozen(borrowedValue);
    const expected = cloneFrozen(borrowedExpected);
    validateLedgerExpectation(expected);
    if (!record(value) || !exactKeys(value, LEDGER_KEYS) ||
      value.schemaVersion !== "city-fixed-attempt-ledger@1" ||
      value.cityCheckRunId !== expected.cityCheckRunId || value.cityId !== expected.cityId ||
      value.sourceId !== expected.sourceId || value.criterionId !== expected.criterionId ||
      value.planId !== expected.planId || value.definitionId !== expected.definitionId ||
      value.valuePolicyVersion !== expected.valuePolicyVersion ||
      value.sourcePeriodPolicyVersion !== expected.sourcePeriodPolicyVersion ||
      value.parserVersion !== expected.parserVersion || value.rulesVersion !== expected.rulesVersion ||
      value.assessmentAt !== expected.assessmentAt || !canonicalInstant(value.completedAt) ||
      !denseArray(value.attempts) || !record(value.result)) integrityMismatch();
    const assessmentMillis = instantMillis(expected.assessmentAt);
    const completedMillis = instantMillis(value.completedAt);
    if (completedMillis < assessmentMillis ||
      completedMillis > instantMillis(expected.notAfterAt)) integrityMismatch();

    const ownedArtifactIds = new Set<string>();
    const attempts: CityFixedAttempt<S>[] = [];
    let previousAttemptedMillis = assessmentMillis;
    for (let index = 0; index < value.attempts.length; index += 1) {
      const validated = validateReconstructedAttempt(
        value.attempts[index],
        expected,
        index,
        completedMillis,
        previousAttemptedMillis,
        ownedArtifactIds,
      );
      attempts.push(validated.attempt);
      previousAttemptedMillis = validated.attemptedMillis;
    }
    if (attempts.length === 0 || attempts.length > expected.routes.length) integrityMismatch();

    if (value.result.kind === "verified") {
      if (!exactKeys(value.result, ["kind", "claimIds"]) ||
        !denseArray(value.result.claimIds) || value.result.claimIds.length !== 1 ||
        !value.result.claimIds.every(canonicalIdentifier) ||
        attempts.slice(0, -1).some(({ disposition }) => disposition !== "rejected")) {
        integrityMismatch();
      }
      const accepted = attempts.at(-1);
      if (accepted?.disposition !== "accepted" ||
        !sameStrings(accepted.claimIds, value.result.claimIds)) integrityMismatch();
    } else if (value.result.kind === "unknown") {
      if (!exactKeys(value.result, ["kind", "reason"]) ||
        attempts.length !== expected.routes.length ||
        attempts.some(({ disposition }) => disposition !== "rejected") ||
        value.result.reason !== unknownReason(attempts)) integrityMismatch();
    } else {
      integrityMismatch();
    }
    return value as unknown as CityFixedAttemptLedger<S>;
  } catch {
    integrityMismatch();
  }
}

interface SafetyBoundContext {
  readonly entry: CitySafetySourcePlan["entries"][number];
  readonly municipality: OfficialAuthorityDirectory["municipalities"][number];
}

function validateSafetyContext(input: CitySafetyTerminalEntryInput): SafetyBoundContext {
  const { ledger, sourcePlan, authorityDirectory } = input;
  if (!record(input) || !canonicalIdentifier(input.cityCheckRunId) || !record(ledger) ||
    !record(sourcePlan) || !record(authorityDirectory) ||
    ledger.schemaVersion !== "city-safety-attempt-ledger@1" ||
    sourcePlan.schemaVersion !== "city-safety-source-plan@1" ||
    authorityDirectory.schemaVersion !== "official-authority-directory@1" ||
    authorityDirectory.countryCode !== "SI" || sourcePlan.id !== ledger.sourcePlanId ||
    authorityDirectory.id !== ledger.authorityDirectoryId ||
    sourcePlan.authorityDirectoryId !== authorityDirectory.id ||
    sourcePlan.catalogRevisionId !== ledger.catalogRevisionId ||
    authorityDirectory.catalogRevisionId !== ledger.catalogRevisionId ||
    sourcePlan.definitionId !== SLOVENIA_CITY_SAFETY_FACT_CONTRACT.definitionId ||
    ledger.definitionId !== SLOVENIA_CITY_SAFETY_FACT_CONTRACT.definitionId ||
    sourcePlan.freshnessPolicyVersion !==
      SLOVENIA_CITY_SAFETY_FACT_CONTRACT.freshnessPolicyVersion ||
    ledger.freshnessPolicyVersion !==
      SLOVENIA_CITY_SAFETY_FACT_CONTRACT.freshnessPolicyVersion ||
    sourcePlan.discoveryRulesVersion !== ledger.discoveryRulesVersion ||
    !denseArray(sourcePlan.entries) || !denseArray(authorityDirectory.municipalities) ||
    !denseArray(authorityDirectory.publishers) || !denseArray(ledger.candidates) ||
    !denseArray(input.artifacts)) fail("invalid_city_safety_terminal_entry");
  const matchingEntries = sourcePlan.entries.filter(({ cityId }) => cityId === ledger.cityId);
  const matchingMunicipalities = authorityDirectory.municipalities
    .filter(({ cityId }) => cityId === ledger.cityId);
  if (matchingEntries.length !== 1 || matchingMunicipalities.length !== 1) {
    fail("invalid_city_safety_terminal_entry");
  }
  const entry = matchingEntries[0]!;
  const municipality = matchingMunicipalities[0]!;
  if (ledger.municipalityCode !== entry.municipalityCode ||
    ledger.municipalityCode !== municipality.municipalityCode ||
    entry.settlementCode !== municipality.settlementCode ||
    !denseArray(entry.publisherIds) || entry.publisherIds.length === 0 ||
    !denseArray(entry.configuredRoutes)) fail("invalid_city_safety_terminal_entry");
  for (let index = 0; index < ledger.candidates.length; index += 1) {
    if (ledger.candidates[index]?.index !== index) fail("invalid_city_safety_terminal_entry");
  }
  return { entry, municipality };
}

function validateSafetyReference(value: unknown): CitySafetyArtifactReference {
  if (!record(value) || !canonicalIdentifier(value.artifactId) ||
    !sha256(value.artifactSha256) || !sha256(value.sourceSha256) ||
    !canonicalText(value.locator)) fail("invalid_city_safety_terminal_entry");
  if (value.role === "municipal_source") {
    if (!exactKeys(value, [
      "role", "documentRole", "artifactId", "artifactSha256", "sourceSha256", "locator",
    ]) || (value.documentRole !== "navigation" && value.documentRole !== "terminal_claim")) {
      fail("invalid_city_safety_terminal_entry");
    }
  } else if (value.role === "surs_denominator") {
    if (!exactKeys(value, [
      "role", "artifactId", "artifactSha256", "sourceSha256", "locator",
    ])) fail("invalid_city_safety_terminal_entry");
  } else {
    fail("invalid_city_safety_terminal_entry");
  }
  return value as unknown as CitySafetyArtifactReference;
}

function sameReference(left: CitySafetyArtifactReference, right: CitySafetyArtifactReference): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function validateSafetyStoredArtifact(
  value: unknown,
  input: CitySafetyTerminalEntryInput,
): LiveCapturedArtifact<"si-city-safety"> {
  if (!record(value) || value.origin !== "live" || value.runId !== input.cityCheckRunId ||
    value.sourceId !== "si-city-safety" || !canonicalIdentifier(value.artifactId) ||
    (value.role !== "municipal_source" && value.role !== "surs_denominator") ||
    !sha256(value.sha256) || !(value.bytes instanceof Uint8Array) ||
    !canonicalHttpsUrl(value.url) || !canonicalHttpsUrl(value.responseUrl) ||
    !canonicalInstant(value.capturedAt) || !Number.isInteger(value.responseStatus) ||
    !canonicalText(value.mediaType) || !record(value.request) ||
    (value.request.method !== "GET" && value.request.method !== "POST") ||
    !canonicalHttpsUrl(value.request.url)) fail("invalid_city_safety_terminal_entry");
  return value as unknown as LiveCapturedArtifact<"si-city-safety">;
}

function safetyArtifactUnion(
  input: CitySafetyTerminalEntryInput,
): {
  readonly artifacts: readonly LiveCapturedArtifact<"si-city-safety">[];
  readonly references: ReadonlyMap<string, CitySafetyArtifactReference>;
} {
  const stored = input.artifacts.map((value) => validateSafetyStoredArtifact(value, input));
  if (new Set(stored.map(({ artifactId }) => artifactId)).size !== stored.length) {
    fail("invalid_city_safety_terminal_entry");
  }
  const storedById = new Map(stored.map((artifact) => [artifact.artifactId, artifact]));
  const references = new Map<string, CitySafetyArtifactReference>();
  for (const candidate of input.ledger.candidates) {
    if (!denseArray(candidate.artifactRefs)) fail("invalid_city_safety_terminal_entry");
    for (const rawReference of candidate.artifactRefs) {
      const reference = validateSafetyReference(rawReference);
      const previous = references.get(reference.artifactId);
      if (previous !== undefined && !sameReference(previous, reference)) {
        fail("invalid_city_safety_terminal_entry");
      }
      if (previous === undefined) references.set(reference.artifactId, reference);
    }
  }
  if (references.size !== stored.length) fail("invalid_city_safety_terminal_entry");
  const artifacts = [...references.values()].map((reference) => {
    const artifact = storedById.get(reference.artifactId);
    if (artifact === undefined || artifact.sha256 !== reference.artifactSha256 ||
      artifact.role !== reference.role) fail("invalid_city_safety_terminal_entry");
    return artifact;
  });
  return { artifacts, references };
}

function directoryPublisher(
  directory: OfficialAuthorityDirectory,
  publisherId: string,
): OfficialAuthorityDirectory["publishers"][number] {
  const matches = directory.publishers.filter((publisher) => publisher.publisherId === publisherId);
  if (matches.length !== 1) fail("invalid_city_safety_terminal_entry");
  return matches[0]!;
}

function validatePublisherUrl(
  directory: OfficialAuthorityDirectory,
  publisherId: string,
  value: string,
): string {
  const publisher = directoryPublisher(directory, publisherId);
  if (!canonicalHttpsUrl(value)) fail("invalid_city_safety_terminal_entry");
  const host = new URL(value).hostname;
  if (![...publisher.allowedHosts, ...publisher.delegatedDocumentHosts].includes(host)) {
    fail("invalid_city_safety_terminal_entry");
  }
  return value;
}

function acceptedSafetyCandidate(
  input: CitySafetyTerminalEntryInput,
): CitySafetyUsableCandidateAttempt {
  const result = input.ledger.result;
  if (result.kind !== "verified" || !Number.isSafeInteger(result.acceptedCandidateIndex)) {
    fail("invalid_city_safety_terminal_entry");
  }
  const candidate = input.ledger.candidates[result.acceptedCandidateIndex];
  if (candidate?.disposition !== "usable" ||
    candidate.index !== result.acceptedCandidateIndex ||
    candidate.referenceYear !== result.referenceYear ||
    JSON.stringify(candidate.quantity) !== JSON.stringify(result.quantity)) {
    fail("invalid_city_safety_terminal_entry");
  }
  validatePublisherUrl(
    input.authorityDirectory,
    candidate.publisherId,
    candidate.publisherNavigationUrl,
  );
  validatePublisherUrl(
    input.authorityDirectory,
    candidate.publisherId,
    candidate.resolvedEvidenceUrl,
  );
  if (candidate.dataAuthorityId !== input.authorityDirectory.requiredPublisherIds.police) {
    fail("invalid_city_safety_terminal_entry");
  }
  return candidate;
}

function validateSafetyClaimReferences(
  input: CitySafetyTerminalEntryInput,
  accepted: CitySafetyUsableCandidateAttempt,
  references: ReadonlyMap<string, CitySafetyArtifactReference>,
): Extract<CitySafetyArtifactReference, { role: "municipal_source" }> {
  const terminalReferences = accepted.artifactRefs.filter((reference): reference is Extract<
    CitySafetyArtifactReference,
    { role: "municipal_source" }
  > => reference.role === "municipal_source" && reference.documentRole === "terminal_claim");
  const denominators = accepted.artifactRefs.filter((reference) =>
    reference.role === "surs_denominator");
  if (terminalReferences.length !== 1 || denominators.length !== 1 ||
    accepted.denominator.artifactId !== denominators[0]!.artifactId ||
    accepted.denominator.publisherId !== input.authorityDirectory.requiredPublisherIds.surs ||
    accepted.denominator.municipalityCode !== input.ledger.municipalityCode ||
    accepted.denominator.referenceDate !== `${accepted.referenceYear}-01-01` ||
    accepted.denominator.population !== accepted.quantity.population ||
    !references.has(terminalReferences[0]!.artifactId) ||
    !references.has(denominators[0]!.artifactId)) fail("invalid_city_safety_terminal_entry");
  return terminalReferences[0]!;
}

interface SafetyTerminalLineage {
  readonly navigationUrl: string;
  readonly resolvedEvidenceUrl: string;
}

function safetyTerminalLineage(
  input: CitySafetyTerminalEntryInput,
  context: SafetyBoundContext,
): SafetyTerminalLineage {
  if (input.ledger.result.kind === "verified") {
    const accepted = acceptedSafetyCandidate(input);
    return {
      navigationUrl: accepted.publisherNavigationUrl,
      resolvedEvidenceUrl: accepted.resolvedEvidenceUrl,
    };
  }
  for (let index = input.ledger.candidates.length - 1; index >= 0; index -= 1) {
    const candidate = input.ledger.candidates[index];
    if (candidate?.disposition !== "rejected" || candidate.reviewedOfficial === undefined) continue;
    const reviewed = candidate.reviewedOfficial;
    const navigationUrl = validatePublisherUrl(
      input.authorityDirectory,
      reviewed.publisherId,
      reviewed.publisherNavigationUrl,
    );
    const resolvedEvidenceUrl = reviewed.resolvedEvidenceUrl === undefined
      ? navigationUrl
      : validatePublisherUrl(
          input.authorityDirectory,
          reviewed.publisherId,
          reviewed.resolvedEvidenceUrl,
        );
    return { navigationUrl, resolvedEvidenceUrl };
  }
  const configured = context.entry.configuredRoutes[0];
  if (configured !== undefined) {
    const navigationUrl = validatePublisherUrl(
      input.authorityDirectory,
      configured.publisherId,
      configured.navigationUrl,
    );
    const resolvedEvidenceUrl = configured.resolvedEvidenceUrl === undefined
      ? navigationUrl
      : validatePublisherUrl(
          input.authorityDirectory,
          configured.publisherId,
          configured.resolvedEvidenceUrl,
        );
    return { navigationUrl, resolvedEvidenceUrl };
  }
  const publisherId = context.entry.publisherIds[0];
  if (publisherId === undefined) fail("invalid_city_safety_terminal_entry");
  const publisher = directoryPublisher(input.authorityDirectory, publisherId);
  if (!canonicalHttpsUrl(publisher.navigationUrl)) fail("invalid_city_safety_terminal_entry");
  return { navigationUrl: publisher.navigationUrl, resolvedEvidenceUrl: publisher.navigationUrl };
}

export function citySafetyTerminalEntry(
  borrowedInput: CitySafetyTerminalEntryInput,
): TerminalEvidenceEntry<"si-city-safety", CityEvidenceClaim<"si-city-safety">> {
  const input = cloneFrozen(borrowedInput);
  const context = validateSafetyContext(input);
  const union = safetyArtifactUnion(input);
  const lineage = safetyTerminalLineage(input, context);
  const parserEntry: ParserEntry<"si-city-safety"> = {
    sourceId: "si-city-safety",
    navigationUrl: lineage.navigationUrl,
    resolvedEvidenceUrl: lineage.resolvedEvidenceUrl,
    artifacts: cloneFrozen(union.artifacts),
    versionHint: "si-city-safety-terminal@1",
  };

  if (input.ledger.result.kind === "verified") {
    const accepted = acceptedSafetyCandidate(input);
    const terminalClaimReference = validateSafetyClaimReferences(
      input,
      accepted,
      union.references,
    );
    const claim: CityEvidenceClaim<"si-city-safety"> = {
      claimId: `si-city-safety:${input.ledger.cityId}:${String(accepted.referenceYear)}`,
      sourceId: "si-city-safety",
      value: { kind: "municipal_safety", quantity: accepted.quantity },
      scope: `municipality:${input.ledger.municipalityCode}`,
      sourcePeriod: String(accepted.referenceYear),
      anchor: {
        artifactId: terminalClaimReference.artifactId,
        locator: terminalClaimReference.locator,
        excerptSha256: terminalClaimReference.sourceSha256,
      },
      status: "verified",
      criterionId: SLOVENIA_CITY_SAFETY_FACT_CONTRACT.criterionId,
      definitionId: SLOVENIA_CITY_SAFETY_FACT_CONTRACT.definitionId,
      officialAreaId: input.ledger.municipalityCode,
      geoScope: SLOVENIA_CITY_SAFETY_FACT_CONTRACT.geoScope,
      unit: SLOVENIA_CITY_SAFETY_FACT_CONTRACT.unit,
      denominator: SLOVENIA_CITY_SAFETY_FACT_CONTRACT.denominator,
      freshnessPolicyVersion: SLOVENIA_CITY_SAFETY_FACT_CONTRACT.freshnessPolicyVersion,
    };
    return cloneFrozen({
      sourceId: "si-city-safety",
      coverage: "verified",
      parserEntry,
      claims: [claim],
    });
  }

  return cloneFrozen({
    sourceId: "si-city-safety",
    coverage: "unavailable",
    parserEntry,
    blocker: {
      sourceId: "si-city-safety",
      kind: input.ledger.result.reason,
      navigationUrl: lineage.navigationUrl,
      resolvedUrl: lineage.resolvedEvidenceUrl,
      artifactIds: union.artifacts.map(({ artifactId }) => artifactId),
    },
  });
}
