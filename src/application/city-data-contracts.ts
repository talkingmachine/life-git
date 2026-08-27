import type {
  CityCatalogProjection,
} from "../decision/city-catalog";
import {
  CITY_CRITERION_IDS,
  type CityCriterionId,
  type InstalledCityCriteriaDefaults,
  type InstalledCityCriterionDefinitionTuple,
} from "../decision/city-criteria";
import type { CityDecisionIntegrity } from "../decision/city-integrity";
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
