import { types } from "node:util";

import Decimal from "decimal.js";

import type {
  ClaimKind,
  SloveniaSourceId,
} from "../research/cold-start-contracts";
import {
  SLOVENIA_V2_CLAIM_SOURCE,
  SLOVENIA_V2_CLAIM_VALIDATOR,
  SLOVENIA_V2_EVIDENCE_RULES_VERSION,
  SLOVENIA_V2_FORMAL_ROUTE_ID,
  SLOVENIA_V2_PARSER_VERSIONS,
  SLOVENIA_V2_RESEARCH_SCOPE,
  SLOVENIA_V2_SOURCE_ORDER,
  sloveniaV2ClaimId,
  sloveniaV2ClaimScopeToken,
  type ColdStartEvidenceClaimV2,
  type VerifiedCountryClaimV2,
} from "../research/cold-start-contracts-v2";
import type {
  Claim,
  CbrEurFacts,
  EvidenceSnapshot,
} from "../research/contracts";
import {
  reconstructCountryDossierPayloadV2,
  type DossierClaimV2,
  type DossierVersionV2,
} from "../research/dossier-v2";
import {
  reconstructCountryAssessmentInputV2,
  type CountryAssessmentInputV2,
} from "./country-assessment-input-v2";
import type {
  ColdStartComparator,
  ColdStartFormula,
} from "./cold-start-assessment";
import {
  assessFormalResidence,
  type CatalogCompletenessAttestation,
  type FormalEvidenceReference,
  type FormalReason,
  type ResidenceRouteOutcome,
} from "./formal-residence-verdict";
import type {
  RelocationParticipantV2,
} from "./relocation-profile";

export const COLD_START_ASSESSMENT_V2_RULES_VERSION =
  "cold-start-assessment@2" as const;

export type CountryAssessmentV2ReasonCode =
  | "citizenship_excluded"
  | "citizenship_applicability_unknown"
  | "companion_route_unverified"
  | "companion_route_impossible"
  | "passport_validity_insufficient"
  | "passport_validity_unknown"
  | "remote_continuation_unavailable"
  | "remote_work_prerequisite_unknown"
  | "income_below_verified_threshold"
  | "income_basis_not_comparable"
  | "fx_rate_unavailable"
  | "fx_rate_stale"
  | "country_evidence_incomplete"
  | "country_not_installed"
  | "route_requirements_verified";

export interface ParticipantRouteAssessmentV2 {
  readonly routeId: string;
  readonly participantId: string;
  readonly relationship: "self" | "spouse" | "minor_child" | "other_family";
  readonly status: "verified" | "unknown" | "impossible";
  readonly reasonCodes: readonly CountryAssessmentV2ReasonCode[];
  readonly claimIds: readonly string[];
}

export interface ColdStartFormulaEurV2 {
  readonly formulaId: "FORMULA-VS2-INCOME-EUR-01";
  readonly formulaVersion: "1";
  readonly expression: "monthlyIncomeEur < thresholdEur";
  readonly monthlyIncomeEur: string;
  readonly thresholdEur: string;
  readonly rounding: "UNROUNDED_THEN_HALF_UP_2DP";
  readonly sourceClaimIds: readonly string[];
}

export type ColdStartComparatorV2 = Omit<ColdStartComparator, "formula"> & {
  readonly participantAssessments: readonly ParticipantRouteAssessmentV2[];
  readonly formula?: ColdStartFormula | ColdStartFormulaEurV2;
};

export interface ColdStartAssessmentInputV2 {
  readonly assessmentAt: string;
  readonly profile: CountryAssessmentInputV2;
  readonly evidence: EvidenceSnapshot<SloveniaSourceId, ColdStartEvidenceClaimV2>;
  readonly dossier?: DossierVersionV2;
  readonly completeness?: CatalogCompletenessAttestation;
  readonly sourceNavigation: Readonly<Record<SloveniaSourceId, string>>;
  readonly sourceResolvedEvidence?: Readonly<Record<SloveniaSourceId, string>>;
}

type ParticipantStatus = ParticipantRouteAssessmentV2["status"];
type CbrClaim = Claim<CbrEurFacts, "cbr-eur">;

interface OwnedAssessmentInput {
  readonly assessmentAt: string;
  readonly profile: CountryAssessmentInputV2;
  readonly evidence: EvidenceSnapshot<SloveniaSourceId, ColdStartEvidenceClaimV2>;
  readonly dossier?: DossierVersionV2;
  readonly completeness?: unknown;
  readonly sourceNavigation: Readonly<Record<SloveniaSourceId, string>>;
  readonly sourceResolvedEvidence: Readonly<Partial<Record<SloveniaSourceId, string>>>;
}

interface Evaluation {
  readonly status: ParticipantStatus;
  readonly code?: CountryAssessmentV2ReasonCode;
  readonly claims: readonly DossierClaimV2[];
  readonly cbr?: {
    readonly claim: CbrClaim;
    readonly evidence: FormalEvidenceReference;
  };
  readonly navigation?: FormalReason["navigation"];
  readonly countryMissing?: true;
}

interface ParticipantEvaluation {
  readonly projection: ParticipantRouteAssessmentV2;
  readonly components: readonly Evaluation[];
  readonly hasCountryMissing: boolean;
  readonly formula?: ColdStartComparatorV2["formula"];
}

const SUMMARY: Readonly<Record<CountryAssessmentV2ReasonCode, string>> = Object.freeze({
  citizenship_excluded: "Гражданство исключено из подтверждённого маршрута.",
  citizenship_applicability_unknown:
    "Официальная применимость гражданства к маршруту не подтверждена.",
  companion_route_unverified: "Маршрут для сопровождающего не подтверждён.",
  companion_route_impossible: "Сопровождающий исключён из подтверждённого маршрута.",
  passport_validity_insufficient:
    "Срок действия паспорта меньше подтверждённого требования маршрута.",
  passport_validity_unknown:
    "Достаточность срока действия паспорта для интервала переезда не подтверждена.",
  remote_continuation_unavailable:
    "Текущую работу нельзя продолжить удалённо по требующему это маршруту.",
  remote_work_prerequisite_unknown:
    "Точная удалённая связь и её юридическая допустимость не подтверждены.",
  income_below_verified_threshold:
    "Подтверждённого текущего дохода недостаточно для порога маршрута.",
  income_basis_not_comparable:
    "База текущего дохода не сопоставима с подтверждённым порогом.",
  fx_rate_unavailable: "Подходящий официальный курс не подтверждён.",
  fx_rate_stale: "Подтверждённый официальный курс вне допустимого окна.",
  country_evidence_incomplete: "Официальные требования маршрута подтверждены не полностью.",
  country_not_installed: "Страна пока не установлена для формальной проверки.",
  route_requirements_verified: "Все применимые формальные требования маршрута подтверждены.",
});

const REASON_RANK: Readonly<Record<CountryAssessmentV2ReasonCode, number>> = Object.freeze({
  citizenship_excluded: 0,
  citizenship_applicability_unknown: 0,
  companion_route_unverified: 1,
  companion_route_impossible: 1,
  passport_validity_insufficient: 2,
  passport_validity_unknown: 2,
  remote_continuation_unavailable: 3,
  remote_work_prerequisite_unknown: 3,
  income_below_verified_threshold: 4,
  income_basis_not_comparable: 4,
  fx_rate_unavailable: 4,
  fx_rate_stale: 4,
  country_evidence_incomplete: 5,
  country_not_installed: 5,
  route_requirements_verified: 5,
});

const CBR_DECIMAL_TEXT = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;

const EVIDENCE_BLOCKER_KINDS = new Set([
  "timeout",
  "rate_limited",
  "server_error",
  "http_error",
  "wrong_media_type",
  "too_large",
  "navigation_mismatch",
  "country_not_installed",
  "integrity_mismatch",
  "semantic_mismatch",
  "not_found",
  "not_comparable",
  "source_unavailable",
  "stale",
  "conflict",
  "deadline",
]);

function integrityMismatch(): never {
  throw new Error("integrity_mismatch");
}

function exactKeys(value: object, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

function isCanonicalDay(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/.test(value)
  ) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function isCanonicalInstant(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString() === value;
}

function cloneBorrowed<T>(borrowed: T, ancestors = new Set<object>()): T {
  if (
    borrowed === null || borrowed === undefined || typeof borrowed === "string" ||
    typeof borrowed === "boolean"
  ) return borrowed;
  if (typeof borrowed === "number") {
    if (!Number.isFinite(borrowed)) integrityMismatch();
    return borrowed;
  }
  if (typeof borrowed !== "object" || types.isProxy(borrowed)) integrityMismatch();
  if (ancestors.has(borrowed)) integrityMismatch();
  const prototype = Object.getPrototypeOf(borrowed);
  const descriptors = Object.getOwnPropertyDescriptors(borrowed);
  if (Object.getOwnPropertySymbols(descriptors).length !== 0) integrityMismatch();
  ancestors.add(borrowed);
  try {
    if (Array.isArray(borrowed)) {
      if (prototype !== Array.prototype) integrityMismatch();
      const lengthDescriptor = descriptors.length;
      if (lengthDescriptor === undefined || !("value" in lengthDescriptor) ||
        !Number.isSafeInteger(lengthDescriptor.value) || lengthDescriptor.value < 0) {
        integrityMismatch();
      }
      const length = lengthDescriptor.value as number;
      const expectedKeys = [
        ...Array.from({ length }, (_, index) => String(index)),
        "length",
      ].sort();
      const actualKeys = Object.keys(descriptors).sort();
      if (actualKeys.length !== expectedKeys.length ||
        actualKeys.some((key, index) => key !== expectedKeys[index])) {
        integrityMismatch();
      }
      return Array.from({ length }, (_, index) => {
        const descriptor = descriptors[String(index)];
        if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
          return integrityMismatch();
        }
        return cloneBorrowed(descriptor.value, ancestors);
      }) as T;
    }
    if (prototype !== Object.prototype && prototype !== null) integrityMismatch();
    const copy: Record<string, unknown> = {};
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (key === "__proto__" || !("value" in descriptor) || !descriptor.enumerable) {
        integrityMismatch();
      }
      Object.defineProperty(copy, key, {
        configurable: true,
        enumerable: true,
        value: cloneBorrowed(descriptor.value, ancestors),
        writable: true,
      });
    }
    return copy as T;
  } finally {
    ancestors.delete(borrowed);
  }
}

function snapshotInput(borrowed: ColdStartAssessmentInputV2): Record<string, unknown> {
  if (borrowed === null || typeof borrowed !== "object" || types.isProxy(borrowed) ||
    Array.isArray(borrowed)) integrityMismatch();
  const prototype = Object.getPrototypeOf(borrowed);
  const descriptors = Object.getOwnPropertyDescriptors(borrowed);
  if ((prototype !== Object.prototype && prototype !== null) ||
    Object.getOwnPropertySymbols(descriptors).length !== 0) integrityMismatch();
  const required = [
    "assessmentAt",
    "profile",
    "evidence",
    "sourceNavigation",
  ];
  const allowed = [
    ...required,
    "dossier",
    "completeness",
    "sourceResolvedEvidence",
  ];
  const keys = Object.keys(descriptors);
  if (!required.every((key) => keys.includes(key)) ||
    keys.some((key) => !allowed.includes(key))) integrityMismatch();
  const copy: Record<string, unknown> = {};
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (key === "completeness") {
      if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
        copy[key] = undefined;
        continue;
      }
      try {
        copy[key] = cloneBorrowed(descriptor.value);
      } catch {
        copy[key] = undefined;
      }
    } else {
      if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
        integrityMismatch();
      }
      copy[key] = cloneBorrowed(descriptor.value);
    }
  }
  return copy;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function reconstructStringRecord(
  value: unknown,
  requireAll: boolean,
): Readonly<Partial<Record<SloveniaSourceId, string>>> {
  if (!isRecord(value)) integrityMismatch();
  const keys = Object.keys(value);
  if (keys.some((key) => !SLOVENIA_V2_SOURCE_ORDER.includes(key as SloveniaSourceId)) ||
    (requireAll && !exactKeys(value, SLOVENIA_V2_SOURCE_ORDER))) integrityMismatch();
  const result: Partial<Record<SloveniaSourceId, string>> = {};
  for (const sourceId of SLOVENIA_V2_SOURCE_ORDER) {
    const candidate = value[sourceId];
    if (candidate === undefined) continue;
    if (!isHttpUrl(candidate)) integrityMismatch();
    result[sourceId] = candidate;
  }
  return result;
}

function reconstructEvidence(
  value: unknown,
  assessmentAt: string,
): EvidenceSnapshot<SloveniaSourceId, ColdStartEvidenceClaimV2> {
  if (!isRecord(value)) integrityMismatch();
  const expectedKeys = [
    "id",
    "assessmentDate",
    "artifactIds",
    "claims",
    "blockers",
    "coverage",
    "parserVersions",
    "rulesVersion",
    ...(value.contextHash === undefined ? [] : ["contextHash"]),
    ...(value.knowledgeBaselineRevisionId === undefined
      ? []
      : ["knowledgeBaselineRevisionId"]),
    "manifestHash",
    "hmac",
  ];
  if (!exactKeys(value, expectedKeys) || !isNonEmptyString(value.id) ||
    value.assessmentDate !== assessmentAt || !Array.isArray(value.artifactIds) ||
    !value.artifactIds.every(isNonEmptyString) ||
    new Set(value.artifactIds).size !== value.artifactIds.length ||
    !Array.isArray(value.claims) || !Array.isArray(value.blockers) ||
    !isRecord(value.coverage) || !exactKeys(value.coverage, SLOVENIA_V2_SOURCE_ORDER) ||
    !isRecord(value.parserVersions) ||
    !exactKeys(value.parserVersions, SLOVENIA_V2_SOURCE_ORDER) ||
    value.rulesVersion !== SLOVENIA_V2_EVIDENCE_RULES_VERSION ||
    (value.contextHash !== undefined && typeof value.contextHash !== "string") ||
    (value.knowledgeBaselineRevisionId !== undefined &&
      typeof value.knowledgeBaselineRevisionId !== "string") ||
    !isNonEmptyString(value.manifestHash) || !isNonEmptyString(value.hmac)) {
    integrityMismatch();
  }
  for (const sourceId of SLOVENIA_V2_SOURCE_ORDER) {
    if ((value.coverage[sourceId] !== "verified" &&
      value.coverage[sourceId] !== "unavailable") ||
      value.parserVersions[sourceId] !== SLOVENIA_V2_PARSER_VERSIONS[sourceId]) {
      integrityMismatch();
    }
  }
  if (value.claims.some((claim) => !isCountryClaim(claim) && !isCbrClaim(claim))) {
    integrityMismatch();
  }
  const evidence = value as unknown as
    EvidenceSnapshot<SloveniaSourceId, ColdStartEvidenceClaimV2>;
  const countryClaimIds = new Set<string>();
  for (const claim of evidence.claims) {
    if (!isCountryClaim(claim)) continue;
    try {
      validateEvidenceClaim(claim, evidence);
    } catch {
      integrityMismatch();
    }
    if (countryClaimIds.has(claim.claimId)) integrityMismatch();
    countryClaimIds.add(claim.claimId);
  }
  validateCbrEvidenceClaims(evidence);
  validateEvidenceTopology(evidence);
  return evidence;
}

function reconstructDossier(
  value: unknown,
  evidenceSnapshotId: string,
): DossierVersionV2 {
  if (!isRecord(value)) integrityMismatch();
  const expectedKeys = [
    "id",
    "ordinal",
    "countryCode",
    ...(value.predecessorId === undefined ? [] : ["predecessorId"]),
    "evidenceSnapshotId",
    "schemaVersion",
    "payload",
    "payloadHash",
    "manifestHash",
    "hmac",
    "publishedAt",
  ];
  if (!exactKeys(value, expectedKeys) || !isNonEmptyString(value.id) ||
    !Number.isSafeInteger(value.ordinal) || (value.ordinal as number) < 1 ||
    value.countryCode !== "SI" || value.evidenceSnapshotId !== evidenceSnapshotId ||
    value.schemaVersion !== "si-dossier@2" || !isNonEmptyString(value.payloadHash) ||
    !isNonEmptyString(value.manifestHash) || !isNonEmptyString(value.hmac) ||
    !isCanonicalInstant(value.publishedAt) ||
    (value.predecessorId !== undefined && !isNonEmptyString(value.predecessorId))) {
    integrityMismatch();
  }
  let payload: DossierVersionV2["payload"];
  try {
    payload = reconstructCountryDossierPayloadV2(value.payload);
  } catch {
    return integrityMismatch();
  }
  return {
    id: value.id,
    ordinal: value.ordinal as number,
    countryCode: "SI",
    ...(value.predecessorId === undefined ? {} : { predecessorId: value.predecessorId as string }),
    evidenceSnapshotId,
    schemaVersion: "si-dossier@2",
    payload,
    payloadHash: value.payloadHash,
    manifestHash: value.manifestHash,
    hmac: value.hmac,
    publishedAt: value.publishedAt,
  };
}

function reconstructAssessmentInput(
  borrowed: ColdStartAssessmentInputV2,
): OwnedAssessmentInput {
  const input = snapshotInput(borrowed);
  if (!isCanonicalDay(input.assessmentAt)) integrityMismatch();
  let profile: CountryAssessmentInputV2;
  try {
    profile = reconstructCountryAssessmentInputV2(input.profile);
  } catch {
    return integrityMismatch();
  }
  const evidence = reconstructEvidence(input.evidence, input.assessmentAt);
  const dossier = input.dossier === undefined
    ? undefined
    : reconstructDossier(input.dossier, evidence.id);
  const sourceNavigation = reconstructStringRecord(input.sourceNavigation, true) as
    Readonly<Record<SloveniaSourceId, string>>;
  const sourceResolvedEvidence = input.sourceResolvedEvidence === undefined
    ? {}
    : reconstructStringRecord(input.sourceResolvedEvidence, true);
  return {
    assessmentAt: input.assessmentAt,
    profile,
    evidence,
    ...(dossier === undefined ? {} : { dossier }),
    ...(input.completeness === undefined ? {} : { completeness: input.completeness }),
    sourceNavigation,
    sourceResolvedEvidence,
  };
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalValue(item)]));
  }
  return value;
}

function sameCanonicalValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonicalValue(left)) === JSON.stringify(canonicalValue(right));
}

function isClaimKind(value: unknown): value is ClaimKind {
  return value === "route_basis" || value === "citizenship_applicability" ||
    value === "remote_work_relations" || value === "income" ||
    value === "qualification" || value === "companion_entry" ||
    value === "companion_local_work_access" || value === "duration" ||
    value === "general_statutory_prerequisites";
}

function isSloveniaSourceId(value: unknown): value is SloveniaSourceId {
  return SLOVENIA_V2_SOURCE_ORDER.includes(value as SloveniaSourceId);
}

function isCountryClaim(
  value: unknown,
): value is VerifiedCountryClaimV2 {
  return isRecord(value) && "claimKind" in value;
}

function isCbrClaim(value: unknown): value is CbrClaim {
  return isRecord(value) && !("claimKind" in value) && value.sourceId === "cbr-eur";
}

function isStructurallyValidCbrClaim(
  value: unknown,
  evidence: EvidenceSnapshot<SloveniaSourceId, ColdStartEvidenceClaimV2>,
): value is CbrClaim {
  if (!isCbrClaim(value) || !exactKeys(value, [
    "claimId",
    "sourceId",
    "value",
    "scope",
    "sourcePeriod",
    "anchor",
    "status",
  ]) || !/^cbr-eur-facts-[1-9]\d*$/.test(value.claimId) ||
    value.scope !== SLOVENIA_V2_RESEARCH_SCOPE || value.status !== "verified" ||
    !isCanonicalDay(value.sourcePeriod) || !isRecord(value.value) ||
    !exactKeys(value.value, ["base", "quote", "nominal", "rate", "effectiveDate"]) ||
    value.value.base !== "EUR" || value.value.quote !== "RUB" ||
    value.value.nominal !== "1" || typeof value.value.rate !== "string" ||
    !CBR_DECIMAL_TEXT.test(value.value.rate) || !isCanonicalDay(value.value.effectiveDate) ||
    value.sourcePeriod !== value.value.effectiveDate || !isRecord(value.anchor) ||
    !exactKeys(value.anchor, ["artifactId", "locator", "excerptSha256"]) ||
    !isNonEmptyString(value.anchor.artifactId) ||
    !evidence.artifactIds.includes(value.anchor.artifactId) ||
    !isNonEmptyString(value.anchor.locator) ||
    typeof value.anchor.excerptSha256 !== "string" ||
    !/^[a-f\d]{64}$/.test(value.anchor.excerptSha256)) return false;
  try {
    return new Decimal(value.value.rate).greaterThan(0);
  } catch {
    return false;
  }
}

function validateCbrEvidenceClaims(
  evidence: EvidenceSnapshot<SloveniaSourceId, ColdStartEvidenceClaimV2>,
): void {
  const claims = evidence.claims.filter(isCbrClaim);
  if (evidence.coverage["cbr-eur"] === "unavailable") {
    if (claims.length !== 0) integrityMismatch();
    return;
  }
  if (claims.length !== 1 || !isStructurallyValidCbrClaim(claims[0], evidence)) {
    integrityMismatch();
  }
}

function validateEvidenceTopology(
  evidence: EvidenceSnapshot<SloveniaSourceId, ColdStartEvidenceClaimV2>,
): void {
  for (const borrowedBlocker of evidence.blockers) {
    const blocker: unknown = borrowedBlocker;
    if (!isRecord(blocker) || !exactKeys(blocker, [
      "sourceId",
      "kind",
      "navigationUrl",
      ...(blocker.resolvedUrl === undefined ? [] : ["resolvedUrl"]),
      "artifactIds",
    ]) || !isSloveniaSourceId(blocker.sourceId) ||
      typeof blocker.kind !== "string" || !EVIDENCE_BLOCKER_KINDS.has(blocker.kind) ||
      !isHttpUrl(blocker.navigationUrl) ||
      (blocker.resolvedUrl !== undefined && !isHttpUrl(blocker.resolvedUrl)) ||
      !Array.isArray(blocker.artifactIds) ||
      !blocker.artifactIds.every((artifactId) =>
        isNonEmptyString(artifactId) && evidence.artifactIds.includes(artifactId)
      ) || new Set(blocker.artifactIds).size !== blocker.artifactIds.length) {
      integrityMismatch();
    }
  }
  for (const sourceId of SLOVENIA_V2_SOURCE_ORDER) {
    const claims = evidence.claims.filter((claim) => claim.sourceId === sourceId);
    const blockers = evidence.blockers.filter((blocker) => blocker.sourceId === sourceId);
    const coverage = evidence.coverage[sourceId];
    if ((coverage === "verified" && (claims.length === 0 || blockers.length !== 0)) ||
      (coverage === "unavailable" && (claims.length !== 0 || blockers.length !== 1))) {
      integrityMismatch();
    }
  }
}

function projectedDossierClaim(claim: VerifiedCountryClaimV2): DossierClaimV2 {
  return {
    claimId: claim.claimId,
    claimKind: claim.claimKind,
    value: cloneBorrowed(claim.value),
    validatorVersion: claim.validatorVersion,
    evidence: claim.evidence.map((reference) => ({
      sourceId: reference.sourceId,
      navigationUrl: reference.navigationUrl,
      resolvedEvidenceUrl: reference.resolvedEvidenceUrl,
      sourcePeriod: reference.sourcePeriod,
      locator: reference.anchor.locator,
      excerptSha256: reference.anchor.excerptSha256,
    })),
  } as DossierClaimV2;
}

function validateEvidenceClaim(
  claim: VerifiedCountryClaimV2,
  evidence: EvidenceSnapshot<SloveniaSourceId, ColdStartEvidenceClaimV2>,
): void {
  if (!exactKeys(claim, [
    "claimId",
    "claimKind",
    "sourceId",
    "value",
    "scope",
    "sourcePeriod",
    "anchor",
    "status",
    "evidence",
    "validatorVersion",
  ]) || !isClaimKind(claim.claimKind)) integrityMismatch();
  const kind = claim.claimKind;
  if (claim.sourceId !== SLOVENIA_V2_CLAIM_SOURCE[kind] ||
    claim.scope !== SLOVENIA_V2_RESEARCH_SCOPE || claim.status !== "verified" ||
    claim.validatorVersion !== SLOVENIA_V2_CLAIM_VALIDATOR[kind] ||
    claim.claimId !== sloveniaV2ClaimId(kind, claim.value) ||
    !isNonEmptyString(claim.sourcePeriod) || !Array.isArray(claim.evidence) ||
    claim.evidence.length === 0 || evidence.coverage[claim.sourceId] !== "verified" ||
    !isRecord(claim.anchor)) integrityMismatch();
  for (const borrowedReference of claim.evidence) {
    const reference: unknown = borrowedReference;
    if (!isRecord(reference) || !exactKeys(reference, [
      "sourceId",
      "artifactId",
      "navigationUrl",
      "resolvedEvidenceUrl",
      "sourcePeriod",
      "anchor",
    ]) || !isSloveniaSourceId(reference.sourceId) ||
      reference.sourceId !== claim.sourceId ||
      !isHttpUrl(reference.navigationUrl) || !isHttpUrl(reference.resolvedEvidenceUrl) ||
      reference.sourcePeriod !== claim.sourcePeriod ||
      typeof reference.artifactId !== "string" ||
      !evidence.artifactIds.includes(reference.artifactId) || !isRecord(reference.anchor) ||
      !exactKeys(reference.anchor, ["artifactId", "locator", "excerptSha256"]) ||
      reference.anchor.artifactId !== reference.artifactId ||
      !isNonEmptyString(reference.anchor.locator) ||
      typeof reference.anchor.excerptSha256 !== "string" ||
      !/^[a-f\d]{64}$/.test(reference.anchor.excerptSha256)) integrityMismatch();
  }
  const lastAnchor = claim.evidence.at(-1)!.anchor;
  if (!sameCanonicalValue(claim.anchor, lastAnchor)) integrityMismatch();
}

function bindDossierToEvidence(
  input: OwnedAssessmentInput & { readonly dossier: DossierVersionV2 },
): ReadonlyMap<string, VerifiedCountryClaimV2> {
  const evidenceClaims = input.evidence.claims.filter(isCountryClaim);
  if (evidenceClaims.length !== input.dossier.payload.claims.length) integrityMismatch();
  const byId = new Map<string, VerifiedCountryClaimV2>();
  for (const claim of evidenceClaims) {
    if (byId.has(claim.claimId)) integrityMismatch();
    byId.set(claim.claimId, claim);
  }
  for (const dossierClaim of input.dossier.payload.claims) {
    const evidenceClaim = byId.get(dossierClaim.claimId);
    if (evidenceClaim === undefined ||
      !sameCanonicalValue(projectedDossierClaim(evidenceClaim), dossierClaim)) {
      integrityMismatch();
    }
  }
  return byId;
}

function formalEvidenceForClaim(
  evidenceSnapshotId: string,
  evidenceClaims: ReadonlyMap<string, VerifiedCountryClaimV2>,
  claim: DossierClaimV2,
): readonly FormalEvidenceReference[] {
  const evidenceClaim = evidenceClaims.get(claim.claimId);
  if (evidenceClaim === undefined) integrityMismatch();
  return evidenceClaim.evidence.map((reference) => ({
    evidenceSnapshotId,
    artifactId: reference.artifactId,
    sourceId: reference.sourceId,
    navigationUrl: reference.navigationUrl,
    resolvedEvidenceUrl: reference.resolvedEvidenceUrl,
    sourcePeriod: reference.sourcePeriod,
    locator: reference.anchor.locator,
    excerptSha256: reference.anchor.excerptSha256,
    validatorVersion: evidenceClaim.validatorVersion,
  }));
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function formalReason(
  code: CountryAssessmentV2ReasonCode,
  evaluation: Evaluation,
  input: OwnedAssessmentInput,
  evidenceClaims: ReadonlyMap<string, VerifiedCountryClaimV2>,
): FormalReason {
  const claimIds = [
    ...evaluation.claims.map(({ claimId }) => claimId),
    ...(evaluation.cbr === undefined ? [] : [evaluation.cbr.claim.claimId]),
  ];
  const evidence = [
    ...evaluation.claims.flatMap((claim) =>
      formalEvidenceForClaim(input.evidence.id, evidenceClaims, claim)
    ),
    ...(evaluation.cbr === undefined ? [] : [evaluation.cbr.evidence]),
  ];
  return {
    code,
    summary: SUMMARY[code],
    claimIds: unique(claimIds),
    evidence: uniqueBy(evidence, (reference) =>
      `${reference.evidenceSnapshotId}:${reference.artifactId}:${reference.locator}`
    ),
    navigation: evaluation.navigation ?? [],
  };
}

function uniqueBy<T>(values: readonly T[], key: (value: T) => string): T[] {
  return [...new Map(values.map((value) => [key(value), value])).values()];
}

function claimByKind<K extends ClaimKind>(
  dossier: DossierVersionV2,
  kind: K,
  scope?: string,
): DossierClaimV2<K> | undefined {
  return dossier.payload.claims.find((claim) =>
    claim.claimKind === kind &&
    (scope === undefined || sloveniaV2ClaimScopeToken(claim.claimKind, claim.value) === scope)
  ) as DossierClaimV2<K> | undefined;
}

function verified(...claims: readonly DossierClaimV2[]): Evaluation {
  return { status: "verified", claims };
}

function unknown(
  code: CountryAssessmentV2ReasonCode,
  claims: readonly DossierClaimV2[] = [],
  options: Pick<Evaluation, "cbr" | "navigation" | "countryMissing"> = {},
): Evaluation {
  return { status: "unknown", code, claims, ...options };
}

function impossible(
  code: CountryAssessmentV2ReasonCode,
  claims: readonly DossierClaimV2[],
  cbr?: Evaluation["cbr"],
): Evaluation {
  return { status: "impossible", code, claims, ...(cbr === undefined ? {} : { cbr }) };
}

function evaluateCitizenship(
  participant: RelocationParticipantV2,
  dossier: DossierVersionV2,
): Evaluation {
  const claim = claimByKind(dossier, "citizenship_applicability");
  if (claim === undefined) {
    return unknown("citizenship_applicability_unknown", [], { countryMissing: true });
  }
  const classifications = new Map(
    claim.value.classifications.map(({ countryCode, status }) => [countryCode, status]),
  );
  const statuses = participant.citizenships.map((countryCode) => classifications.get(countryCode));
  if (statuses.some((status) => status === undefined)) {
    return unknown("citizenship_applicability_unknown", [claim], { countryMissing: true });
  }
  return statuses.some((status) => status === "eligible")
    ? verified(claim)
    : impossible("citizenship_excluded", [claim]);
}

function evaluateCompanion(
  participant: RelocationParticipantV2,
  dossier: DossierVersionV2,
): Evaluation | undefined {
  if (participant.relationship === "self") return undefined;
  const claim = claimByKind(dossier, "companion_entry");
  if (claim === undefined) {
    return unknown("companion_route_unverified", [], { countryMissing: true });
  }
  const classification = claim.value.relationshipClassifications.find(
    ({ relationship }) => relationship === participant.relationship,
  );
  if (classification === undefined) {
    return unknown("companion_route_unverified", [claim], { countryMissing: true });
  }
  return classification.status === "eligible"
    ? verified(claim)
    : impossible("companion_route_impossible", [claim]);
}

function addUtcMonthsClamped(day: string, months: number): string {
  const date = new Date(`${day}T00:00:00.000Z`);
  const absoluteMonth = date.getUTCFullYear() * 12 + date.getUTCMonth() + months;
  const year = Math.floor(absoluteMonth / 12);
  const month = absoluteMonth % 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(date.getUTCDate(), lastDay)))
    .toISOString().slice(0, 10);
}

function moveOffsets(moveHorizon: OwnedAssessmentInput["profile"]["profile"]["profile"]["moveHorizon"]): {
  readonly early: number;
  readonly late?: number;
} {
  switch (moveHorizon) {
    case "within_3_months": return { early: 0, late: 3 };
    case "3_to_6_months": return { early: 3, late: 6 };
    case "6_to_12_months": return { early: 6, late: 12 };
    case "more_than_12_months": return { early: 12 };
  }
}

function participantScopeToken(participant: RelocationParticipantV2): string {
  return participant.relationship === "self"
    ? "applicant"
    : `companion-${participant.relationship}`;
}

function evaluatePassport(
  participant: RelocationParticipantV2,
  input: OwnedAssessmentInput & { readonly dossier: DossierVersionV2 },
): Evaluation {
  const scope = participantScopeToken(participant);
  const duration = claimByKind(input.dossier, "duration", scope);
  const statutory = claimByKind(input.dossier, "general_statutory_prerequisites", scope);
  const claims: DossierClaimV2[] = [];
  if (duration !== undefined) claims.push(duration as DossierClaimV2);
  if (statutory !== undefined) claims.push(statutory as DossierClaimV2);
  if (duration === undefined || statutory === undefined) {
    return unknown("passport_validity_unknown", claims, { countryMissing: true });
  }
  if (participant.passport === "absent") {
    return impossible("passport_validity_insufficient", [duration, statutory]);
  }
  const offsets = moveOffsets(input.profile.profile.profile.moveHorizon);
  const permitMonths = duration.value.maximumMonths +
    statutory.value.passportBeyondPermitMonths;
  const earlyMove = addUtcMonthsClamped(input.assessmentAt, offsets.early);
  const requiredEarly = addUtcMonthsClamped(earlyMove, permitMonths);
  if (participant.passport.validUntil < requiredEarly) {
    return impossible("passport_validity_insufficient", [duration, statutory]);
  }
  if (offsets.late === undefined) {
    return unknown("passport_validity_unknown", [duration, statutory]);
  }
  const lateMove = addUtcMonthsClamped(input.assessmentAt, offsets.late);
  const requiredLate = addUtcMonthsClamped(lateMove, permitMonths);
  return participant.passport.validUntil >= requiredLate
    ? verified(duration, statutory)
    : unknown("passport_validity_unknown", [duration, statutory]);
}

function evaluateRemoteWork(
  participant: RelocationParticipantV2,
  dossier: DossierVersionV2,
): Evaluation | undefined {
  if (participant.relationship !== "self") return undefined;
  const claim = claimByKind(dossier, "remote_work_relations");
  if (claim === undefined) {
    return unknown("remote_work_prerequisite_unknown", [], { countryMissing: true });
  }
  if (participant.currentWork.applicability !== "required") integrityMismatch();
  if (participant.currentWork.value.status === "not_working") {
    return impossible("remote_continuation_unavailable", [claim]);
  }
  if (participant.remoteContinuation.applicability !== "required") integrityMismatch();
  if (participant.remoteContinuation.value === "no") {
    return impossible("remote_continuation_unavailable", [claim]);
  }
  return unknown("remote_work_prerequisite_unknown", [claim]);
}

function validCbrClaim(
  input: OwnedAssessmentInput,
): { readonly claim: CbrClaim; readonly rate: Decimal; readonly evidence: FormalEvidenceReference } |
  "unavailable" | "stale" {
  const claim = input.evidence.claims.find(isCbrClaim);
  if (claim === undefined || input.evidence.coverage["cbr-eur"] !== "verified") {
    return "unavailable";
  }
  if (input.sourceResolvedEvidence["cbr-eur"] === undefined) return "unavailable";
  const rate = new Decimal(claim.value.rate);
  const effective = Date.parse(`${claim.value.effectiveDate}T00:00:00.000Z`);
  const assessment = Date.parse(`${input.assessmentAt}T00:00:00.000Z`);
  const age = (assessment - effective) / 86_400_000;
  if (!Number.isInteger(age) || age < 0 || age > 3) return "stale";
  return {
    claim,
    rate,
    evidence: {
      evidenceSnapshotId: input.evidence.id,
      artifactId: claim.anchor.artifactId,
      sourceId: claim.sourceId,
      navigationUrl: input.sourceNavigation["cbr-eur"],
      resolvedEvidenceUrl: input.sourceResolvedEvidence["cbr-eur"],
      sourcePeriod: claim.sourcePeriod,
      locator: claim.anchor.locator,
      excerptSha256: claim.anchor.excerptSha256,
      validatorVersion: input.evidence.parserVersions["cbr-eur"],
    },
  };
}

function evaluateIncome(
  participant: RelocationParticipantV2,
  input: OwnedAssessmentInput & { readonly dossier: DossierVersionV2 },
): { readonly evaluation: Evaluation; readonly formula?: ColdStartComparatorV2["formula"] } |
  undefined {
  if (participant.relationship !== "self") return undefined;
  const claim = claimByKind(input.dossier, "income");
  if (claim === undefined) {
    return {
      evaluation: unknown("country_evidence_incomplete", [], { countryMissing: true }),
    };
  }
  if (participant.monthlyIncome.applicability !== "required") integrityMismatch();
  const current = participant.monthlyIncome.value;
  if (current.basis !== claim.value.basis) {
    return { evaluation: unknown("income_basis_not_comparable", [claim]) };
  }
  const monthly = new Decimal(current.amount);
  const threshold = new Decimal(claim.value.thresholdEur);
  if (current.currency === "EUR") {
    const formula: ColdStartFormulaEurV2 = {
      formulaId: "FORMULA-VS2-INCOME-EUR-01",
      formulaVersion: "1",
      expression: "monthlyIncomeEur < thresholdEur",
      monthlyIncomeEur: monthly.toFixed(),
      thresholdEur: threshold.toFixed(2),
      rounding: "UNROUNDED_THEN_HALF_UP_2DP",
      sourceClaimIds: [claim.claimId],
    };
    return {
      evaluation: monthly.lessThan(threshold)
        ? impossible("income_below_verified_threshold", [claim])
        : verified(claim),
      formula,
    };
  }
  if (current.currency !== "RUB") {
    return {
      evaluation: unknown("fx_rate_unavailable", [claim], {
        navigation: [{
          sourceId: "cbr-eur",
          url: input.sourceNavigation["cbr-eur"],
          label: "источник для ручной проверки",
        }],
      }),
    };
  }
  const cbr = validCbrClaim(input);
  if (cbr === "unavailable" || cbr === "stale") {
    return {
      evaluation: unknown(
        cbr === "unavailable" ? "fx_rate_unavailable" : "fx_rate_stale",
        [claim],
        {
          countryMissing: true,
          navigation: [{
            sourceId: "cbr-eur",
            url: input.sourceNavigation["cbr-eur"],
            label: "источник для ручной проверки",
          }],
        },
      ),
    };
  }
  const incomeEur = monthly.div(cbr.rate);
  const cbrEvaluation = { claim: cbr.claim, evidence: cbr.evidence };
  const formula: ColdStartFormula = {
    formulaId: "FORMULA-VS2-INCOME-01",
    formulaVersion: "1",
    expression: "monthlyIncomeRub / eurRub < thresholdEur",
    monthlyIncomeRub: monthly.toFixed(),
    eurRub: cbr.rate.toFixed(),
    incomeEur: incomeEur.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2),
    thresholdEur: threshold.toFixed(2),
    rounding: "UNROUNDED_THEN_HALF_UP_2DP",
    sourceClaimIds: [claim.claimId, cbr.claim.claimId],
  };
  return {
    evaluation: incomeEur.lessThan(threshold)
      ? impossible("income_below_verified_threshold", [claim], cbrEvaluation)
      : { ...verified(claim), cbr: cbrEvaluation },
    formula,
  };
}

function evaluateRoutePrerequisite(dossier: DossierVersionV2): Evaluation | undefined {
  const qualification = claimByKind(dossier, "qualification");
  return qualification === undefined
    ? unknown("country_evidence_incomplete", [], { countryMissing: true })
    : verified(qualification);
}

function aggregateStatus(components: readonly Evaluation[]): ParticipantStatus {
  if (components.some(({ status }) => status === "impossible")) return "impossible";
  if (components.some(({ status }) => status === "unknown")) return "unknown";
  return "verified";
}

function evaluateParticipant(
  participant: RelocationParticipantV2,
  input: OwnedAssessmentInput & { readonly dossier: DossierVersionV2 },
): ParticipantEvaluation {
  const components: Evaluation[] = [evaluateCitizenship(participant, input.dossier)];
  const companion = evaluateCompanion(participant, input.dossier);
  if (companion !== undefined) components.push(companion);
  components.push(evaluatePassport(participant, input));
  const remote = evaluateRemoteWork(participant, input.dossier);
  if (remote !== undefined) components.push(remote);
  const income = evaluateIncome(participant, input);
  if (income !== undefined) components.push(income.evaluation);
  if (participant.relationship === "self") {
    const routePrerequisite = evaluateRoutePrerequisite(input.dossier);
    if (routePrerequisite !== undefined) components.push(routePrerequisite);
  }
  const status = aggregateStatus(components);
  const reasonCodes = unique(components.flatMap(({ status: componentStatus, code }) =>
    componentStatus === "verified" || code === undefined ? [] : [code]
  ));
  return {
    projection: {
      routeId: SLOVENIA_V2_FORMAL_ROUTE_ID,
      participantId: participant.participantId,
      relationship: participant.relationship,
      status,
      reasonCodes: reasonCodes.length === 0 ? ["route_requirements_verified"] : reasonCodes,
      claimIds: unique(components.flatMap((component) => [
        ...component.claims.map(({ claimId }) => claimId),
        ...(component.cbr === undefined ? [] : [component.cbr.claim.claimId]),
      ])),
    },
    components,
    hasCountryMissing: components.some(({ countryMissing }) => countryMissing === true),
    ...(income?.formula === undefined ? {} : { formula: income.formula }),
  };
}

function isEvidenceReferenceBound(
  value: unknown,
  evidence: EvidenceSnapshot<SloveniaSourceId, ColdStartEvidenceClaimV2>,
): value is FormalEvidenceReference {
  return isRecord(value) && exactKeys(value, [
    "evidenceSnapshotId",
    "artifactId",
    "sourceId",
    "navigationUrl",
    "resolvedEvidenceUrl",
    "sourcePeriod",
    "locator",
    "excerptSha256",
    "validatorVersion",
  ]) && value.evidenceSnapshotId === evidence.id &&
    typeof value.artifactId === "string" && evidence.artifactIds.includes(value.artifactId) &&
    isNonEmptyString(value.sourceId) && isHttpUrl(value.navigationUrl) &&
    isHttpUrl(value.resolvedEvidenceUrl) && isNonEmptyString(value.sourcePeriod) &&
    isNonEmptyString(value.locator) && typeof value.excerptSha256 === "string" &&
    /^[a-f\d]{64}$/.test(value.excerptSha256) && isNonEmptyString(value.validatorVersion);
}

function acceptedCompleteness(
  value: unknown,
  input: OwnedAssessmentInput,
  routeIds: readonly string[],
): CatalogCompletenessAttestation | undefined {
  if (routeIds.length === 0) return undefined;
  if (!isRecord(value)) return undefined;
  const expectedKeys = [
    "catalogRevisionId",
    "jurisdiction",
    "authority",
    "scopeKind",
    "profileSnapshotId",
    "catalogRoutes",
    "validatorVersion",
    "effectiveFrom",
    ...(value.effectiveTo === undefined ? [] : ["effectiveTo"]),
    "evidenceSnapshotId",
    "catalogEvidence",
  ];
  if (!exactKeys(value, expectedKeys) || !isNonEmptyString(value.catalogRevisionId) ||
    value.jurisdiction !== "SI" || !isNonEmptyString(value.authority) ||
    value.scopeKind !== "all_long_term_residence_routes_for_profile" ||
    value.profileSnapshotId !== input.profile.profileSnapshotId ||
    !isNonEmptyString(value.validatorVersion) || !isCanonicalDay(value.effectiveFrom) ||
    value.effectiveFrom > input.assessmentAt ||
    (value.effectiveTo !== undefined &&
      (!isCanonicalDay(value.effectiveTo) || value.effectiveTo < input.assessmentAt)) ||
    value.evidenceSnapshotId !== input.evidence.id || !Array.isArray(value.catalogRoutes) ||
    !Array.isArray(value.catalogEvidence) || value.catalogEvidence.length === 0 ||
    !value.catalogEvidence.every((reference) =>
      isEvidenceReferenceBound(reference, input.evidence)
    )) return undefined;
  const catalogRoutes = value.catalogRoutes;
  if (catalogRoutes.length === 0) return undefined;
  const catalogRouteIds: string[] = [];
  const applicableRouteIds: string[] = [];
  for (const coverage of catalogRoutes) {
    if (!isRecord(coverage) || !isNonEmptyString(coverage.routeId) ||
      catalogRouteIds.includes(coverage.routeId) || !Array.isArray(coverage.evidence) ||
      coverage.evidence.length === 0 || !coverage.evidence.every((reference) =>
        isEvidenceReferenceBound(reference, input.evidence)
      )) return undefined;
    catalogRouteIds.push(coverage.routeId);
    if (coverage.applicability === "applicable") {
      if (!exactKeys(coverage, ["routeId", "applicability", "evidence"])) return undefined;
      applicableRouteIds.push(coverage.routeId);
      continue;
    }
    if (coverage.applicability !== "excluded" || !exactKeys(coverage, [
      "routeId",
      "applicability",
      "exclusionCode",
      "claimIds",
      "evidence",
    ]) || !isNonEmptyString(coverage.exclusionCode) || !Array.isArray(coverage.claimIds) ||
      coverage.claimIds.length === 0 || !coverage.claimIds.every(isNonEmptyString) ||
      new Set(coverage.claimIds).size !== coverage.claimIds.length) return undefined;
  }
  if (applicableRouteIds.length !== routeIds.length ||
    applicableRouteIds.some((routeId, index) => routeId !== routeIds[index])) return undefined;
  return value as unknown as CatalogCompletenessAttestation;
}

function personalFitFor(
  routeStatus: ResidenceRouteOutcome["status"] | undefined,
  marker: ColdStartComparatorV2["marker"],
  hasCountryMissing: boolean,
): ColdStartComparatorV2["personalFit"] {
  if (routeStatus === undefined) return "research_incomplete";
  if (routeStatus === "viable") return "verified_route_available";
  if (routeStatus === "impossible") {
    return marker === "red" ? "all_routes_impossible" : "route_blocked_catalog_incomplete";
  }
  return hasCountryMissing ? "research_incomplete" : "personal_evidence_missing";
}

function routeFromEvaluations(
  input: OwnedAssessmentInput & { readonly dossier: DossierVersionV2 },
  evaluations: readonly ParticipantEvaluation[],
  evidenceClaims: ReadonlyMap<string, VerifiedCountryClaimV2>,
): ResidenceRouteOutcome {
  const routeBasis = claimByKind(input.dossier, "route_basis");
  if (routeBasis === undefined ||
    routeBasis.value.route !== "temporary_residence_digital_nomad") integrityMismatch();
  const components = evaluations.flatMap(({ components }) => components);
  const status = evaluations.some(({ projection }) => projection.status === "impossible")
    ? "impossible" as const
    : evaluations.some(({ projection }) => projection.status === "unknown")
    ? "unknown" as const
    : "viable" as const;
  const determining = status === "impossible"
    ? components.filter((component) => component.status === "impossible")
    : status === "unknown"
    ? components.filter((component) => component.status === "unknown")
    : [{ status: "verified", code: "route_requirements_verified", claims: uniqueBy(
      components.flatMap(({ claims }) => claims),
      ({ claimId }) => claimId,
    ) } satisfies Evaluation];
  const orderedDetermining = [...determining].sort((left, right) =>
    REASON_RANK[left.code ?? "route_requirements_verified"] -
    REASON_RANK[right.code ?? "route_requirements_verified"]
  );
  const reasons = uniqueBy(orderedDetermining.map((evaluation) => {
    if (evaluation.code === undefined) integrityMismatch();
    return formalReason(evaluation.code, evaluation, input, evidenceClaims);
  }), (item) => `${item.code}:${item.claimIds.join(",")}`);
  if (status === "impossible" && reasons.some((reason) =>
    reason.claimIds.length === 0 || reason.evidence.length === 0
  )) integrityMismatch();
  const statutory = claimByKind(input.dossier, "general_statutory_prerequisites", "applicant");
  const base = {
    routeId: SLOVENIA_V2_FORMAL_ROUTE_ID,
    reasons,
    evidenceSnapshotIds: [input.evidence.id] as [string],
    proceduralActions: statutory?.value.healthInsurance === true
      ? [{ kind: "insurance" as const, completed: false as const }]
      : [],
    contingentActions: [],
  };
  if (routeBasis.value.effectiveFrom > input.assessmentAt) {
    const notCurrent = unknown("country_evidence_incomplete", [routeBasis], {
      countryMissing: true,
    });
    return {
      ...base,
      status: "unknown",
      reasons: [formalReason(
        "country_evidence_incomplete",
        notCurrent,
        input,
        evidenceClaims,
      )],
    };
  }
  return status === "unknown"
    ? { ...base, status }
    : { ...base, status, ruleEffectiveFrom: routeBasis.value.effectiveFrom };
}

export function assessColdStartV2(
  borrowed: ColdStartAssessmentInputV2,
): ColdStartComparatorV2 {
  const input = reconstructAssessmentInput(borrowed);
  if (input.profile.profile.profile.participants.filter(
    ({ relationship }) => relationship === "self",
  ).length !== 1) integrityMismatch();

  let participantAssessments: readonly ParticipantRouteAssessmentV2[] = [];
  let route: ResidenceRouteOutcome | undefined;
  let formula: ColdStartComparatorV2["formula"];
  let hasCountryMissing = input.dossier === undefined;
  const routeBasis = input.dossier === undefined
    ? undefined
    : claimByKind(input.dossier, "route_basis");
  const routeProofNotCurrent = routeBasis !== undefined &&
    routeBasis.value.effectiveFrom > input.assessmentAt;
  if (input.dossier !== undefined) {
    const evidenceClaims = bindDossierToEvidence({ ...input, dossier: input.dossier });
    const evaluations = input.profile.profile.profile.participants.map((profileParticipant) =>
      evaluateParticipant(profileParticipant, { ...input, dossier: input.dossier! })
    );
    participantAssessments = evaluations.map(({ projection }) => projection);
    hasCountryMissing = evaluations.some((evaluation) => evaluation.hasCountryMissing);
    formula = evaluations.find((evaluation) => evaluation.formula !== undefined)?.formula;
    route = routeFromEvaluations(
      { ...input, dossier: input.dossier },
      evaluations,
      evidenceClaims,
    );
  }
  const routes = route === undefined ? [] : [route];
  const completeness = acceptedCompleteness(input.completeness, input, routes.map(({ routeId }) =>
    routeId));
  const formalVerdict = assessFormalResidence({
    profileSnapshotId: input.profile.profileSnapshotId,
    verdictAsOf: input.assessmentAt,
    routes,
    ...(completeness === undefined ? {} : { completeness }),
  });
  const formalRouteStatus = formalVerdict.routeOutcomes[0]?.status;
  const routeProofNormalized = route !== undefined && formalRouteStatus !== route.status;
  return deepFreeze({
    marker: formalVerdict.marker,
    personalFit: personalFitFor(
      formalRouteStatus,
      formalVerdict.marker,
      hasCountryMissing || routeProofNormalized || routeProofNotCurrent,
    ),
    cityScope: "not_checked" as const,
    formalVerdict,
    participantAssessments,
    ...(formula === undefined ? {} : { formula }),
  });
}
