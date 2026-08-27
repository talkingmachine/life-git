import { types } from "node:util";

import type {
  CityCatalogRevision,
  CityCatalogProjection,
} from "../decision/city-catalog";
import {
  CITY_CRITERION_IDS,
  type CityCriterionDraft,
  type CityCriterionId,
  type InstalledCityCriteriaDefaults,
  type InstalledCityCriterionDefinitionTuple,
} from "../decision/city-criteria";
import type { CityDecisionIntegrity } from "../decision/city-integrity";
import type { CityFrontierVerificationBudget } from "../decision/city-frontier-policy";
import type {
  CapturedEntry,
  EvidenceSnapshot,
  LiveCapturedArtifact,
} from "../research/contracts";
import type {
  CityEvidenceClaim,
  CityEvidenceReplayIntegrity,
  CityFixedAttemptLedger,
  CityFixedSourcePeriodValidator,
  CityFixedSourcePlan,
  CityFixedValueValidator,
  SloveniaCityFactSourceId,
} from "../research/city-evidence";
import type { CitySafetyAttemptLedger } from "../research/city-safety-evidence";
import type {
  CitySafetySourcePlan,
  OfficialAuthorityDirectory,
} from "../research/city-safety-source-plan";
import type {
  CityResearchPackageDefinition,
  CityResearchPackageReadyCandidate,
  InstalledCityPackageExactKey,
  InstalledCityPackageManifest,
  InstalledCityResearchPackage,
} from "../research/city-package";
import type { SealedCityPackageAdministrativeEvidence } from "../research/city-package-artifact-set";
import type {
  EvidenceManifest,
  SealedEvidence,
} from "../research/research-plan";
import type { CityKnowledgeRevision } from "../research/city-knowledge";

export interface CityEvidenceContext {
  readonly schemaVersion: "city-evidence-context@1";
  readonly cityCheckRunId: string;
  readonly frontierRunId: string;
  readonly cityId: string;
  readonly countryCode: string;
  readonly packageId: string;
  readonly packageSchemaVersion: string;
  readonly catalogRevisionId: string;
  readonly criteriaSnapshotId: string;
  readonly rankingSnapshotId: string;
  readonly definitionIds: Readonly<Record<CityCriterionId, string>>;
  readonly evidenceRulesVersion: string;
  readonly assessmentAt: string;
  readonly completedAt: string;
}

export type CityFixedAttemptLedgerTuple = readonly [
  CityFixedAttemptLedger<"si-city-long-term-rent">,
  CityFixedAttemptLedger<"si-city-urban-transit">,
  CityFixedAttemptLedger<"si-city-fixed-broadband">,
];

export interface CityEvidenceSnapshot {
  readonly schemaVersion: "city-evidence@1";
  readonly id: string;
  readonly cityCheckRunId: string;
  readonly frontierRunId: string;
  readonly cityId: string;
  readonly countryCode: string;
  readonly packageId: string;
  readonly packageSchemaVersion: string;
  readonly catalogRevisionId: string;
  readonly criteriaSnapshotId: string;
  readonly rankingSnapshotId: string;
  readonly definitionIds: Readonly<Record<CityCriterionId, string>>;
  readonly evidenceRulesVersion: string;
  readonly assessmentAt: string;
  readonly fixedAttemptLedgers: CityFixedAttemptLedgerTuple;
  readonly safetyAttemptLedger: CitySafetyAttemptLedger;
  readonly contextHash: string;
  readonly completedAt: string;
  readonly payloadHash: string;
  readonly hmac: string;
}

export type CityEvidencePayload = Omit<CityEvidenceSnapshot, "payloadHash" | "hmac">;

export interface CityEvidenceSealInput extends CityEvidenceContext {
  readonly genericEvidence: SealedEvidence<SloveniaCityFactSourceId, CityEvidenceClaim>;
  readonly artifacts: readonly LiveCapturedArtifact<SloveniaCityFactSourceId>[];
  readonly fixedAttemptLedgers: CityFixedAttemptLedgerTuple;
  readonly safetyAttemptLedger: CitySafetyAttemptLedger;
}

export type CityEvidenceExpectations = CityEvidenceContext;

export interface VerifiedCityEvidence {
  readonly snapshot: CityEvidenceSnapshot;
  readonly genericEvidence: {
    readonly snapshot: EvidenceSnapshot<SloveniaCityFactSourceId, CityEvidenceClaim>;
    readonly manifest: EvidenceManifest<SloveniaCityFactSourceId, CityEvidenceClaim>;
    readonly entries: readonly CapturedEntry<SloveniaCityFactSourceId>[];
  };
}

export interface CityEvidenceReadPort {
  loadVerified(id: string, expected?: CityEvidenceExpectations): VerifiedCityEvidence;
  findVerifiedByCheckRunId(cityCheckRunId: string): VerifiedCityEvidence | undefined;
}

export interface CityPackageEvidenceReplayContract {
  readonly installedPackageManifest: {
    readonly id: string;
    readonly key: InstalledCityPackageExactKey;
  };
  readonly definition: CityResearchPackageDefinition;
  readonly catalogProjection: CityCatalogProjection;
  readonly fixedPlansByCityId: Readonly<Record<string, readonly [
    CityFixedSourcePlan<"si-city-long-term-rent">,
    CityFixedSourcePlan<"si-city-urban-transit">,
    CityFixedSourcePlan<"si-city-fixed-broadband">,
  ]>>;
  readonly safetySourcePlan: CitySafetySourcePlan;
  readonly officialAuthorityDirectory: OfficialAuthorityDirectory;
  readonly validateValue: CityFixedValueValidator;
  readonly validateSourcePeriod: CityFixedSourcePeriodValidator;
}

export interface CityEvidencePackageReplayPort {
  loadExactReplayContract(
    key: InstalledCityPackageExactKey,
  ): CityPackageEvidenceReplayContract | undefined;
}

export interface InstalledCityPackageManifestAppendInput {
  readonly ready: CityResearchPackageReadyCandidate;
  readonly catalog: VerifiedCityCatalogBundle;
  readonly administrativeEvidence: SealedCityPackageAdministrativeEvidence;
  readonly fixedPlansByCityId: Readonly<Record<string, readonly [
    CityFixedSourcePlan<"si-city-long-term-rent">,
    CityFixedSourcePlan<"si-city-urban-transit">,
    CityFixedSourcePlan<"si-city-fixed-broadband">,
  ]>>;
  readonly safetySourcePlan: CitySafetySourcePlan;
  readonly officialAuthorityDirectory: OfficialAuthorityDirectory;
  readonly criteriaDefaults: InstalledCityCriteriaDefaults;
  readonly criterionDefinitions: InstalledCityCriterionDefinitionTuple;
  readonly installedAt: string;
}

export interface InstalledCityPackageManifestAppendPort {
  appendPrepared(input: InstalledCityPackageManifestAppendInput): InstalledCityPackageManifest;
}

export interface InstalledCityPackageManifestStorePort
  extends InstalledCityPackageManifestAppendPort {
  loadVerified(key: InstalledCityPackageExactKey): InstalledCityPackageManifest | undefined;
  latestVerified(countryCode: string): InstalledCityPackageManifest | undefined;
}

export interface InstalledCityPackageLookupPort {
  findReady(countryCode: string): InstalledCityResearchPackage | undefined;
  findExact(key: InstalledCityPackageExactKey): InstalledCityResearchPackage | undefined;
}

export interface InstalledCityCatalogReadPort {
  latestInstalledVerified(countryCode: string): VerifiedCityCatalogBundle | undefined;
}

export interface CityEvidenceReplayPorts {
  readonly read: CityEvidenceReadPort;
  readonly integrity: CityEvidenceReplayIntegrity;
  readonly package: CityEvidencePackageReplayPort;
}

export interface CityEvidenceStorePort extends CityEvidenceReadPort {
  seal(input: CityEvidenceSealInput): CityEvidenceSnapshot;
}

export type VerifiedCityCatalogBundle = CityCatalogProjection;

export interface CityCatalogStorePort {
  appendVerified(input: CityCatalogProjection): VerifiedCityCatalogBundle;
  loadVerified(id: string): VerifiedCityCatalogBundle;
}

export interface CityKnowledgeStorePort {
  publishFromEvidence(evidenceSnapshotId: string, createdAt: string): CityKnowledgeRevision;
  latestVerified(cityId: string): CityKnowledgeRevision | undefined;
  loadVerified(id: string): CityKnowledgeRevision;
  findByEvidenceVerified(evidenceSnapshotId: string): CityKnowledgeRevision | undefined;
}

export interface CityCriteriaCommandPayload {
  readonly schemaVersion: "city-criteria-command@1";
  readonly profileSnapshotId: string;
  readonly preferenceProfileSnapshotId: string;
  readonly criteria: readonly [
    CityCriterionDraft,
    CityCriterionDraft,
    CityCriterionDraft,
    CityCriterionDraft,
  ];
  readonly rulesVersion: "city-criteria@1";
}

export interface CityFrontierRunIdentity {
  readonly schemaVersion: "city-frontier-run@1";
  readonly resolvedCountryShortlistRevisionId: string;
  readonly countryCode: string;
  readonly registryRevisionId: string;
  readonly installedPackageContext: InstalledCityPackageExactKey;
  readonly criteriaPayloadHash: string;
  readonly catalogRulesVersion: CityCatalogRevision["rulesVersion"];
  readonly rankingRulesVersion: "city-ranker@1";
  readonly verificationBudget: CityFrontierVerificationBudget;
}

type IdentityRecord = Record<string, unknown>;

interface CapturedIdentityIntegrity {
  readonly canonical: (value: unknown) => string;
  readonly hash: (canonicalText: string) => string;
}

const IDENTITY_DIGEST = /^[0-9a-f]{64}$/;
const CRITERIA_PAYLOAD_KEYS = [
  "schemaVersion",
  "profileSnapshotId",
  "preferenceProfileSnapshotId",
  "criteria",
  "rulesVersion",
] as const;
const RUN_IDENTITY_KEYS = [
  "schemaVersion",
  "resolvedCountryShortlistRevisionId",
  "countryCode",
  "registryRevisionId",
  "installedPackageContext",
  "criteriaPayloadHash",
  "catalogRulesVersion",
  "rankingRulesVersion",
  "verificationBudget",
] as const;

function identityMismatch(): never {
  throw new Error("integrity_mismatch");
}

function atIdentityBoundary<T>(operation: () => T): T {
  try {
    return operation();
  } catch {
    throw new Error("integrity_mismatch");
  }
}

function ownIdentityGraph<T>(borrowed: T): T {
  const seen = new Set<object>();
  const visit = (value: unknown): unknown => {
    if (value === null || value === undefined || typeof value === "string" ||
      typeof value === "number" || typeof value === "boolean") {
      return value;
    }
    if (typeof value !== "object" || types.isProxy(value) || seen.has(value) ||
      Object.getOwnPropertySymbols(value).length !== 0) {
      identityMismatch();
    }
    seen.add(value);
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) identityMismatch();
      const length = Object.getOwnPropertyDescriptor(value, "length");
      if (length === undefined || !("value" in length) ||
        !Number.isSafeInteger(length.value) || length.value < 0 ||
        Object.getOwnPropertyNames(value).length !== length.value + 1) {
        identityMismatch();
      }
      const copy: unknown[] = [];
      for (let index = 0; index < length.value; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
          identityMismatch();
        }
        copy.push(visit(descriptor.value));
      }
      return copy;
    }
    if (Object.getPrototypeOf(value) !== Object.prototype) identityMismatch();
    const copy: IdentityRecord = {};
    for (const key of Object.getOwnPropertyNames(value)) {
      if (key === "__proto__") identityMismatch();
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
        identityMismatch();
      }
      copy[key] = visit(descriptor.value);
    }
    return copy;
  };
  return visit(borrowed) as T;
}

function freezeIdentityGraph<T>(value: T, seen = new Set<object>()): T {
  if (value === null || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor)) identityMismatch();
    freezeIdentityGraph(descriptor.value, seen);
  }
  return Object.freeze(value);
}

function exactIdentityRecord(value: unknown, keys: readonly string[]): IdentityRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Object.getOwnPropertySymbols(value).length !== 0) {
    identityMismatch();
  }
  const actual = Object.getOwnPropertyNames(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])) {
    identityMismatch();
  }
  return value as IdentityRecord;
}

function identityText(value: unknown): asserts value is string {
  if (typeof value !== "string" || value.length === 0) identityMismatch();
}

function validateCriteriaTuple(value: unknown): void {
  if (!Array.isArray(value) || value.length !== CITY_CRITERION_IDS.length ||
    Object.getPrototypeOf(value) !== Array.prototype) {
    identityMismatch();
  }
  for (let index = 0; index < CITY_CRITERION_IDS.length; index += 1) {
    const criterion = exactIdentityRecord(value[index], [
      "criterionId", "definitionId", "mode", "importance", "target",
    ]);
    if (criterion.criterionId !== CITY_CRITERION_IDS[index]) identityMismatch();
    identityText(criterion.definitionId);
    if (criterion.mode !== "required" && criterion.mode !== "weighted") identityMismatch();
    if (![1, 2, 3, 4, 5].includes(criterion.importance as number)) identityMismatch();
    identityText(criterion.target);
  }
}

function validateCriteriaPayload(value: unknown): CityCriteriaCommandPayload {
  const payload = exactIdentityRecord(value, CRITERIA_PAYLOAD_KEYS);
  if (payload.schemaVersion !== "city-criteria-command@1" ||
    payload.rulesVersion !== "city-criteria@1") {
    identityMismatch();
  }
  identityText(payload.profileSnapshotId);
  identityText(payload.preferenceProfileSnapshotId);
  if (payload.profileSnapshotId === payload.preferenceProfileSnapshotId) identityMismatch();
  validateCriteriaTuple(payload.criteria);
  return payload as unknown as CityCriteriaCommandPayload;
}

function validateInstalledPackageContext(value: unknown): void {
  const context = exactIdentityRecord(value, [
    "countryCode",
    "packageId",
    "packageSchemaVersion",
    "catalogRevisionId",
    "evidenceRulesVersion",
  ]);
  if (typeof context.countryCode !== "string" || !/^[A-Z]{2}$/.test(context.countryCode)) {
    identityMismatch();
  }
  identityText(context.packageId);
  identityText(context.packageSchemaVersion);
  identityText(context.catalogRevisionId);
  identityText(context.evidenceRulesVersion);
}

function validateVerificationBudget(value: unknown): void {
  const budget = exactIdentityRecord(value, [
    "liveCityCandidateLimit", "targetSelectableCities", "rulesVersion",
  ]);
  if (budget.liveCityCandidateLimit !== 10 || budget.targetSelectableCities !== 3 ||
    budget.rulesVersion !== "city-frontier-budget@1") {
    identityMismatch();
  }
}

function validateRunIdentity(value: unknown): CityFrontierRunIdentity {
  const identity = exactIdentityRecord(value, RUN_IDENTITY_KEYS);
  if (identity.schemaVersion !== "city-frontier-run@1" ||
    identity.rankingRulesVersion !== "city-ranker@1" ||
    (identity.catalogRulesVersion !== "city-catalog@1" &&
      identity.catalogRulesVersion !== "city-catalog@2")) {
    identityMismatch();
  }
  identityText(identity.resolvedCountryShortlistRevisionId);
  if (typeof identity.countryCode !== "string" || !/^[A-Z]{2}$/.test(identity.countryCode)) {
    identityMismatch();
  }
  identityText(identity.registryRevisionId);
  validateInstalledPackageContext(identity.installedPackageContext);
  if (typeof identity.criteriaPayloadHash !== "string" ||
    !IDENTITY_DIGEST.test(identity.criteriaPayloadHash)) {
    identityMismatch();
  }
  validateVerificationBudget(identity.verificationBudget);
  return identity as unknown as CityFrontierRunIdentity;
}

function captureIdentityIntegrity(value: CityDecisionIntegrity): CapturedIdentityIntegrity {
  if (value === null || typeof value !== "object" || Array.isArray(value) ||
    types.isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype ||
    Object.getOwnPropertySymbols(value).length !== 0 ||
    Object.getOwnPropertyNames(value).length !== 2) {
    identityMismatch();
  }
  const canonical = Object.getOwnPropertyDescriptor(value, "canonical");
  const hash = Object.getOwnPropertyDescriptor(value, "hash");
  if (canonical === undefined || !("value" in canonical) || !canonical.enumerable ||
    typeof canonical.value !== "function" || types.isProxy(canonical.value) ||
    hash === undefined || !("value" in hash) || !hash.enumerable ||
    typeof hash.value !== "function" || types.isProxy(hash.value)) {
    identityMismatch();
  }
  return Object.freeze({
    canonical: canonical.value as (value: unknown) => string,
    hash: hash.value as (canonicalText: string) => string,
  });
}

function hashIdentity(value: unknown, integrity: CapturedIdentityIntegrity): string {
  const canonical = Reflect.apply(
    integrity.canonical,
    Object.freeze({ capability: "canonical" }),
    [freezeIdentityGraph(value)],
  ) as unknown;
  if (typeof canonical !== "string") identityMismatch();
  const digest = Reflect.apply(
    integrity.hash,
    Object.freeze({ capability: "hash" }),
    [canonical],
  ) as unknown;
  if (typeof digest !== "string" || !IDENTITY_DIGEST.test(digest)) identityMismatch();
  return digest;
}

export function cityCriteriaPayloadHash(
  input: CityCriteriaCommandPayload,
  integrity: CityDecisionIntegrity,
): string {
  return atIdentityBoundary(() => {
    const capturedIntegrity = captureIdentityIntegrity(integrity);
    const owned = validateCriteriaPayload(ownIdentityGraph(input));
    return hashIdentity(owned, capturedIntegrity);
  });
}

export function cityFrontierRunId(
  input: CityFrontierRunIdentity,
  integrity: CityDecisionIntegrity,
): string {
  return atIdentityBoundary(() => {
    const capturedIntegrity = captureIdentityIntegrity(integrity);
    const owned = validateRunIdentity(ownIdentityGraph(input));
    return `city-frontier:${hashIdentity(owned, capturedIntegrity)}`;
  });
}

const CONTEXT_KEYS = [
  "schemaVersion",
  "cityCheckRunId",
  "frontierRunId",
  "cityId",
  "countryCode",
  "packageId",
  "packageSchemaVersion",
  "catalogRevisionId",
  "criteriaSnapshotId",
  "rankingSnapshotId",
  "definitionIds",
  "evidenceRulesVersion",
  "assessmentAt",
  "completedAt",
] as const;

function integrityMismatch(): never {
  throw new Error("integrity_mismatch");
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: object, expected: readonly string[]): boolean {
  if (Object.getOwnPropertySymbols(value).length !== 0) return false;
  const actual = Object.getOwnPropertyNames(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index] && (() => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return descriptor !== undefined && "value" in descriptor && descriptor.enumerable;
    })());
}

function canonicalIdentifier(value: unknown): value is string {
  return typeof value === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9._:@-]*$/.test(value);
}

function canonicalInstant(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    return new Date(value).toISOString() === value;
  } catch {
    return false;
  }
}

function validateContext(value: unknown): asserts value is CityEvidenceContext {
  if (!isPlainRecord(value) || !hasExactKeys(value, CONTEXT_KEYS) ||
    value.schemaVersion !== "city-evidence-context@1" ||
    !canonicalIdentifier(value.cityCheckRunId) ||
    !canonicalIdentifier(value.frontierRunId) ||
    !canonicalIdentifier(value.cityId) ||
    typeof value.countryCode !== "string" || !/^[A-Z]{2}$/.test(value.countryCode) ||
    !canonicalIdentifier(value.packageId) ||
    !canonicalIdentifier(value.packageSchemaVersion) ||
    !canonicalIdentifier(value.catalogRevisionId) ||
    !canonicalIdentifier(value.criteriaSnapshotId) ||
    !canonicalIdentifier(value.rankingSnapshotId) ||
    !canonicalIdentifier(value.evidenceRulesVersion) ||
    !canonicalInstant(value.assessmentAt) ||
    !canonicalInstant(value.completedAt) ||
    value.assessmentAt > value.completedAt ||
    !isPlainRecord(value.definitionIds) ||
    !hasExactKeys(value.definitionIds, CITY_CRITERION_IDS)) {
    integrityMismatch();
  }
  const definitionIds = value.definitionIds as Record<string, unknown>;
  if (!CITY_CRITERION_IDS.every((criterionId) =>
    canonicalIdentifier(definitionIds[criterionId]))) integrityMismatch();
}

export function cityEvidenceContextHash(
  context: CityEvidenceContext,
  integrity: CityDecisionIntegrity,
): string {
  try {
    validateContext(context);
    if (integrity === null || typeof integrity !== "object" ||
      typeof integrity.canonical !== "function" || typeof integrity.hash !== "function") {
      integrityMismatch();
    }
    return integrity.hash(integrity.canonical(context));
  } catch {
    integrityMismatch();
  }
}
