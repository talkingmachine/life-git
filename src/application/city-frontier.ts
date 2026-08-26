import type {
  CityCatalogStorePort,
  CityEvidenceReplayPorts,
  CityEvidenceStorePort,
  CityKnowledgeStorePort,
  InstalledCityCatalogReadPort,
  InstalledCityPackageLookupPort,
  InstalledCityPackageManifestStorePort,
} from "./city-data-contracts";
import {
  cityCheckRunId,
  cityCriteriaPayloadHash,
  cityEvidenceContextHash,
  cityFrontierRunId,
  isBorrowedProxy,
  type CityCriteriaCommandPayload,
  type CityEvidenceContext,
  type CityEvidenceSealInput,
  type CityFixedAttemptLedgerTuple,
  type VerifiedCityEvidence,
} from "./city-data-contracts";
import type {
  CityBranchReadPort,
  CityCriteriaReadPort,
  CityFrontierAppendPort,
  CityFrontierEvent,
  CityFrontierRevision,
  CityFrontierReadModel,
  CityFrontierReadPort,
  CityFrontierStartWriterPort,
  CityRankingReadPort,
  CityRankingSnapshot,
  CityFrontierStartPublication,
  CityFrontierStartPublicationResult,
  CitySelectionHistoryReadPort,
  TerminalCityShortlistSnapshot,
} from "./city-frontier-contracts";
import {
  reconstructCityFrontierRevision,
  reconstructCityRankingSnapshot,
  reconstructCitySelectionWithBranch,
  sealCityFrontierRevision,
  sealCityRankingSnapshot,
  verifyCityRankingSnapshotSemantics,
} from "./city-frontier-contracts";
import type {
  CitySafetyOfficialDocumentPort,
  CitySafetySearchPort,
} from "./city-safety-contracts";
import { replayCityEvidence } from "./replay-city-evidence";
import { runCitySafetyDiscovery } from "./run-city-safety-discovery";
import type { ResolvedCountryShortlistSnapshot } from "./country-resolution-contracts";
import {
  createPreCityBranchCommit,
  reconstructPreCityBranchCommit,
  replayPreCityBranchCommit,
  type PreCityBranchCommit,
  type PreCityBranchSourceProjection,
} from "../branch/city";
import {
  CITY_CATALOG_RULES_VERSION,
  LEGACY_CITY_CATALOG_RULES_VERSION,
  reconstructVerifiedCityCatalog,
  type CityCatalogRevision,
  type CityCatalogProjection,
} from "../decision/city-catalog";
import {
  CITY_CRITERION_IDS,
  confirmCityCriteria,
  deriveCityCriteriaDraft,
  reconstructCityCriteriaSnapshot,
  reconstructInstalledCityCriteriaDefaults,
  reconstructInstalledCityCriterionDefinitions,
  type CityCriteriaSnapshot,
  type CityCriterionEvaluatorRegistry,
  type CityCriterionDraft,
  type CityCriterionId,
  type InstalledCityCriterionDefinitionTuple,
} from "../decision/city-criteria";
import type { CityDecisionIntegrity } from "../decision/city-integrity";
import {
  reconstructCityFrontier,
  reconstructCityLiveMarker,
  type CityCommittedFactProjection,
  type CityCommittedFactProjectionTuple,
  type CityFactLinkRejectionReason,
  type CityFrontierProjection,
  type CityFrontierVerificationBudget,
  type CityLiveMarker,
  type CityMarkerBinding,
  type CityMarkerAuthorityProjection,
  type ReconstructCityFrontierInput,
} from "../decision/city-frontier-policy";
import { reconstructCitySelection } from "../decision/city-selection";
import {
  rankCities,
  type CityKnowledgeRankingProjection,
} from "../decision/city-ranker";
import type { PreferenceProfileSnapshot, PreferenceProfileV2Snapshot } from
  "../decision/preference-profile";
import type { RelocationProfileSnapshot, RelocationProfileV2Snapshot } from
  "../decision/relocation-profile";
import {
  assertCityPackageReady,
  type InstalledCityPackageExactKey,
  type InstalledCityPackageManifest,
  type InstalledCityPackageManifestPayload,
  type InstalledCityResearchPackage,
} from "../research/city-package";
import type {
  CityEvidenceClaim,
  CityFixedDeadlineScheduler,
  CityFixedEvidenceClaim,
  CityFixedRoutePort,
  CityFixedSourcePlan,
  CityFixedSourceRunResult,
} from "../research/city-evidence";
import {
  citySafetyTerminalEntry,
  reconstructCityFixedSourcePlan,
  runCityFixedSourcePlan,
  SLOVENIA_CITY_FACT_SOURCE_IDS,
  SLOVENIA_CITY_FIXED_CRITERION_BY_SOURCE,
  type SloveniaCityFactSourceId,
  type SloveniaCityFixedSourceId,
} from "../research/city-evidence";
import type { LiveCapturedArtifact } from "../research/contracts";
import type { EvidenceIntegrity, TerminalEvidenceEntry } from "../research/research-plan";
import { sealEvidencePlan } from "../research/research-plan";
import {
  projectCityKnowledgeForRanking,
  reconstructCityKnowledgeRevision,
  type CityKnowledgeEvidenceView,
  type CityKnowledgeFactContractTuple,
  type CityKnowledgeRevision,
} from "../research/city-knowledge";
import { getCityResearchPackageAvailability } from "../research/city-package";
import { SLOVENIA_CITY_FACT_VERSIONS } from "../research/slovenia-city-plan";
import {
  reconstructCitySafetySourcePlan,
  reconstructOfficialAuthorityDirectory,
} from "../research/city-safety-source-plan";
import {
  projectReconstructedCitySafetyTerminalLink,
  type CitySafetyEvidenceLink,
} from
  "../research/city-safety-evidence";

export interface StartCityFrontierInput {
  readonly resolvedCountryShortlistRevisionId: string;
  readonly countryCode: string;
  readonly criteriaDraft: readonly [
    CityCriterionDraft,
    CityCriterionDraft,
    CityCriterionDraft,
    CityCriterionDraft,
  ];
  readonly commandId: string;
}

export interface PrepareCityFrontierContinuationInput {
  readonly runId: string;
  readonly expectedRevisionId: string;
  readonly commandId: string;
}

export interface CityFrontierSetupReadModel {
  readonly resolvedCountryShortlistRevisionId: string;
  readonly countryCode: string;
  readonly profileSnapshotId: string;
  readonly preferenceProfileSnapshotId: string;
  readonly resolvedCountryEntry: PreCityBranchSourceProjection["resolvedCountryEntry"];
  readonly installedPackageContext: InstalledCityPackageExactKey;
  readonly registryRevisionId: string;
  readonly catalogMemberCount: number;
  readonly catalogCoverage: CityCatalogRevision["coverage"];
  readonly criterionDefinitions: InstalledCityCriterionDefinitionTuple;
  readonly criteriaDraft: StartCityFrontierInput["criteriaDraft"];
}

export interface CityFrontierPrepared {
  readonly schemaVersion: "city-frontier-prepared@1";
  readonly runId: string;
  readonly baseRevisionId: string;
  readonly rankingSnapshotId: string;
  readonly nextUncheckedRank: number;
  readonly commandId: string;
}

export interface CityFrontierResolvedCountryReadPort {
  requireResolvedCountryShortlistForCity(
    revisionId: string,
  ): Promise<ResolvedCountryShortlistSnapshot>;
}

export interface CityFrontierProfileReadPort {
  loadRelocationAnyVerified(
    id: string,
  ): Promise<RelocationProfileSnapshot | RelocationProfileV2Snapshot>;
  loadPreferenceForRankingVerified(
    id: string,
  ): Promise<PreferenceProfileSnapshot | PreferenceProfileV2Snapshot>;
}

export interface CityFrontierFixedRoutePorts {
  readonly "si-city-long-term-rent": CityFixedRoutePort<
    "si-city-long-term-rent",
    CityFixedEvidenceClaim<"si-city-long-term-rent">
  >;
  readonly "si-city-urban-transit": CityFixedRoutePort<
    "si-city-urban-transit",
    CityFixedEvidenceClaim<"si-city-urban-transit">
  >;
  readonly "si-city-fixed-broadband": CityFixedRoutePort<
    "si-city-fixed-broadband",
    CityFixedEvidenceClaim<"si-city-fixed-broadband">
  >;
}

export interface CityFrontierApplicationPorts {
  readonly resolveAvailability: typeof getCityResearchPackageAvailability;
  readonly resolvedCountries: CityFrontierResolvedCountryReadPort;
  readonly profiles: CityFrontierProfileReadPort;
  readonly installedPackages: InstalledCityPackageLookupPort;
  readonly installedPackageManifests: Pick<InstalledCityPackageManifestStorePort, "loadVerified">;
  readonly latestInstalledCatalog: InstalledCityCatalogReadPort;
  readonly historicalCatalogs: Pick<CityCatalogStorePort, "loadVerified">;
  readonly criteria: CityCriteriaReadPort;
  readonly branches: CityBranchReadPort;
  readonly rankings: CityRankingReadPort;
  readonly frontierRead: CityFrontierReadPort;
  readonly frontierAppend: CityFrontierAppendPort;
  readonly startWriter: CityFrontierStartWriterPort;
  readonly selectionHistory: CitySelectionHistoryReadPort;
  readonly evidence: CityEvidenceStorePort;
  readonly evidenceReplay: CityEvidenceReplayPorts;
  readonly knowledge: CityKnowledgeStorePort;
  readonly fixedRoutes: CityFrontierFixedRoutePorts;
  readonly fixedDeadlineScheduler: CityFixedDeadlineScheduler;
  readonly safetySearch: CitySafetySearchPort;
  readonly safetyDocuments: CitySafetyOfficialDocumentPort;
  readonly decisionIntegrity: CityDecisionIntegrity;
  readonly evidenceIntegrity: EvidenceIntegrity;
  readonly clock: () => Date;
  readonly fixedSourceDeadlineAt: (now: Date) => Date;
}

export interface CityFrontierApplication {
  presentCityFrontierSetup(input: {
    readonly resolvedCountryShortlistRevisionId: string;
    readonly countryCode: string;
  }): Promise<CityFrontierSetupReadModel>;
  startCityFrontier(input: StartCityFrontierInput): Promise<CityFrontierReadModel>;
  prepareCityFrontierContinuation(
    input: PrepareCityFrontierContinuationInput,
  ): Promise<CityFrontierPrepared>;
  continueCityFrontier(
    prepared: CityFrontierPrepared,
    emit: (event: CityFrontierEvent) => void | Promise<void>,
    signal: AbortSignal,
  ): Promise<CityFrontierReadModel>;
  presentCityFrontier(runId: string): Promise<CityFrontierReadModel>;
}

export interface VerifiedCityTerminalSelectionAuthority {
  readonly readModel: CityFrontierReadModel;
  readonly terminal: TerminalCityShortlistSnapshot;
  readonly ranking: CityRankingSnapshot;
  readonly preCityBranch: PreCityBranchCommit;
  readonly preCitySource: PreCityBranchSourceProjection;
  readonly frontier: ReconstructCityFrontierInput;
}

export interface CityFrontierSelectionAuthorityPort {
  loadCurrentTerminalSelectionAuthority(
    terminalCityShortlistSnapshotId: string,
  ): Promise<VerifiedCityTerminalSelectionAuthority>;
}

export interface CityFrontierApplicationAssembly {
  readonly application: Readonly<CityFrontierApplication>;
  readonly selectionAuthority: Readonly<CityFrontierSelectionAuthorityPort>;
}

type PlainRecord = Record<string, unknown>;

const PORT_KEYS = [
  "resolveAvailability", "resolvedCountries", "profiles", "installedPackages",
  "installedPackageManifests", "latestInstalledCatalog", "historicalCatalogs", "criteria",
  "branches", "rankings", "frontierRead", "frontierAppend", "startWriter",
  "selectionHistory", "evidence", "evidenceReplay", "knowledge", "fixedRoutes",
  "fixedDeadlineScheduler", "safetySearch", "safetyDocuments", "decisionIntegrity",
  "evidenceIntegrity", "clock", "fixedSourceDeadlineAt",
] as const;

function mismatch(): never {
  throw new Error("integrity_mismatch");
}

function exactRecord(value: unknown, keys: readonly string[]): PlainRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value) ||
    isBorrowedProxy(value) || Object.getPrototypeOf(value) !== Object.prototype ||
    Object.getOwnPropertySymbols(value).length !== 0) mismatch();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const actual = Object.keys(descriptors).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])) mismatch();
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) mismatch();
  }
  return value as PlainRecord;
}

function callable(value: unknown): (...args: never[]) => unknown {
  if (typeof value !== "function" || isBorrowedProxy(value)) mismatch();
  return value as (...args: never[]) => unknown;
}

function methodRecord(value: unknown, keys: readonly string[]): Readonly<PlainRecord> {
  const record = exactRecord(value, keys);
  return Object.freeze(Object.fromEntries(keys.map((key) => {
    const method = callable(record[key]);
    return [key, (...args: never[]) => Reflect.apply(method, record, args)];
  }))) as Readonly<PlainRecord>;
}

function directFunction(record: PlainRecord, key: string): (...args: never[]) => unknown {
  const capability = callable(record[key]);
  const receiver = Object.freeze({ capability: key });
  return (...args: never[]) => Reflect.apply(capability, receiver, args);
}

function capturePorts(value: CityFrontierApplicationPorts): Readonly<CityFrontierApplicationPorts> {
  const root = exactRecord(value, PORT_KEYS);
  const resolvedCountries = methodRecord(
    root.resolvedCountries,
    ["requireResolvedCountryShortlistForCity"],
  );
  const profiles = methodRecord(root.profiles, [
    "loadRelocationAnyVerified", "loadPreferenceForRankingVerified",
  ]);
  const installedPackages = methodRecord(root.installedPackages, ["findReady", "findExact"]);
  const installedPackageManifests = methodRecord(
    root.installedPackageManifests,
    ["loadVerified"],
  );
  const latestInstalledCatalog = methodRecord(
    root.latestInstalledCatalog,
    ["latestInstalledVerified"],
  );
  const historicalCatalogs = methodRecord(root.historicalCatalogs, ["loadVerified"]);
  const criteria = methodRecord(root.criteria, ["loadCriteriaVerified"]);
  const branches = methodRecord(
    root.branches,
    ["loadPreCityBranchVerified", "findPreCityBranchBySourceVerified"],
  );
  const rankings = methodRecord(root.rankings, ["loadRankingVerified"]);
  const frontierRead = methodRecord(root.frontierRead, [
    "loadRevisionVerified", "loadHeadVerified", "loadChainVerified", "findCommandVerified",
  ]);
  const frontierAppend = methodRecord(root.frontierAppend, ["appendRevision"]);
  const startWriter = methodRecord(root.startWriter, ["publishStart"]);
  const selectionHistory = methodRecord(
    root.selectionHistory,
    ["listSelectionsWithBranchesVerified"],
  );
  const evidence = methodRecord(root.evidence, [
    "loadVerified", "findVerifiedByCheckRunId", "seal",
  ]);
  const evidencePort = evidence as unknown as CityEvidenceStorePort;
  const replay = exactRecord(root.evidenceReplay, ["read", "integrity", "package"]);
  const replayRead = replay.read === root.evidence
    ? Object.freeze({
        loadVerified: (...args: Parameters<CityEvidenceStorePort["loadVerified"]>) =>
          evidencePort.loadVerified(...args),
        findVerifiedByCheckRunId: (
          ...args: Parameters<CityEvidenceStorePort["findVerifiedByCheckRunId"]>
        ) =>
          evidencePort.findVerifiedByCheckRunId(...args),
      })
    : methodRecord(replay.read, ["loadVerified", "findVerifiedByCheckRunId"]);
  const replayIntegrity = methodRecord(replay.integrity, ["canonical", "hash", "hashBytes"]);
  const replayPackage = methodRecord(replay.package, ["loadExactReplayContract"]);
  const knowledge = methodRecord(root.knowledge, [
    "publishFromEvidence", "latestVerified", "loadVerified", "findByEvidenceVerified",
  ]);
  const fixed = exactRecord(root.fixedRoutes, [
    "si-city-long-term-rent", "si-city-urban-transit", "si-city-fixed-broadband",
  ]);
  const fixedRoutes = Object.freeze(Object.fromEntries(Object.keys(fixed).map((key) => [
    key,
    methodRecord(fixed[key], ["inspect"]),
  ])));
  const fixedDeadlineScheduler = methodRecord(root.fixedDeadlineScheduler, ["schedule"]);
  const safetySearch = methodRecord(root.safetySearch, ["search"]);
  const safetyDocuments = methodRecord(root.safetyDocuments, ["inspect"]);
  const decisionIntegrity = methodRecord(root.decisionIntegrity, ["canonical", "hash"]);
  const evidenceIntegrity = methodRecord(
    root.evidenceIntegrity,
    ["canonical", "hash", "sign"],
  );
  return Object.freeze({
    resolveAvailability: directFunction(root, "resolveAvailability"),
    resolvedCountries,
    profiles,
    installedPackages,
    installedPackageManifests,
    latestInstalledCatalog,
    historicalCatalogs,
    criteria,
    branches,
    rankings,
    frontierRead,
    frontierAppend,
    startWriter,
    selectionHistory,
    evidence,
    evidenceReplay: Object.freeze({
      read: replayRead,
      integrity: replayIntegrity,
      package: replayPackage,
    }),
    knowledge,
    fixedRoutes,
    fixedDeadlineScheduler,
    safetySearch,
    safetyDocuments,
    decisionIntegrity,
    evidenceIntegrity,
    clock: directFunction(root, "clock"),
    fixedSourceDeadlineAt: directFunction(root, "fixedSourceDeadlineAt"),
  }) as unknown as Readonly<CityFrontierApplicationPorts>;
}

const SETUP_KEYS = ["resolvedCountryShortlistRevisionId", "countryCode"] as const;
const START_KEYS = [
  "resolvedCountryShortlistRevisionId", "countryCode", "criteriaDraft", "commandId",
] as const;
const PREPARE_KEYS = ["runId", "expectedRevisionId", "commandId"] as const;
const PREPARED_KEYS = [
  "schemaVersion", "runId", "baseRevisionId", "rankingSnapshotId", "nextUncheckedRank",
  "commandId",
] as const;
const EXACT_KEY_FIELDS = [
  "countryCode", "packageId", "packageSchemaVersion", "catalogRevisionId",
  "evidenceRulesVersion",
] as const;
const MANIFEST_PAYLOAD_FIELDS = [
  "schemaVersion", "key", "definition", "sourceContractStatus", "readiness", "catalogRoot",
  "fixedPlansByCityId", "safety", "criteria", "valueValidatorVersionId",
  "sourcePeriodValidatorVersionId", "predecessorManifestId", "installedAt",
] as const;
const MANIFEST_FIELDS = [...MANIFEST_PAYLOAD_FIELDS, "id", "payloadHash", "hmac"] as const;
const INSTALLED_PACKAGE_FIELDS = [
  "definition", "sourceContractStatus", "readiness", "installedPackageManifest", "registry",
  "catalog", "criteriaDefaults", "criterionDefinitions", "evaluatorRegistry",
  "fixedPlansByCityId", "safetySourcePlan", "officialAuthorityDirectory", "validateValue",
  "validateSourcePeriod",
] as const;
const FIXED_SOURCE_IDS = [
  "si-city-long-term-rent", "si-city-urban-transit", "si-city-fixed-broadband",
] as const satisfies readonly SloveniaCityFixedSourceId[];
const SHA256 = /^[0-9a-f]{64}$/;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:@-]*$/;

function text(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) mismatch();
  return value;
}

function identifier(value: unknown): string {
  const result = text(value);
  if (!IDENTIFIER.test(result)) mismatch();
  return result;
}

function ownedJson(value: unknown, frozen = false, active = new Set<object>()): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "object" || isBorrowedProxy(value) || active.has(value) ||
    Object.getOwnPropertySymbols(value).length !== 0 || (frozen && !Object.isFrozen(value))) mismatch();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  active.add(value);
  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype ||
        Object.getOwnPropertyNames(value).length !== value.length + 1) mismatch();
      const copy: unknown[] = [];
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = descriptors[String(index)];
        if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) mismatch();
        copy.push(ownedJson(descriptor.value, frozen, active));
      }
      return Object.freeze(copy);
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) mismatch();
    const copy: Record<string, unknown> = {};
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (!("value" in descriptor) || !descriptor.enumerable || key === "__proto__") mismatch();
      copy[key] = ownedJson(descriptor.value, frozen, active);
    }
    return Object.freeze(copy);
  } finally {
    active.delete(value);
  }
}

function capturedCapability(value: unknown): (...args: never[]) => unknown {
  const capability = callable(value);
  if (Object.getPrototypeOf(capability) !== Function.prototype ||
    Object.getOwnPropertySymbols(capability).length !== 0) mismatch();
  const permitted = new Set(["length", "name", "prototype"]);
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(capability))) {
    if (!permitted.has(key) || !("value" in descriptor)) mismatch();
  }
  return capability;
}

function capturedEvaluatorRegistry(value: unknown): CityCriterionEvaluatorRegistry {
  const registry = exactRecord(value, CITY_CRITERION_IDS);
  if (!Object.isFrozen(value)) mismatch();
  const captured = Object.fromEntries(CITY_CRITERION_IDS.map((criterionId) => {
    const evaluator = exactRecord(
      registry[criterionId],
      ["definition", "canonicalizeTarget", "evaluate"],
    );
    if (!Object.isFrozen(evaluator)) mismatch();
    const definition = ownedJson(evaluator.definition, true);
    const canonicalize = capturedCapability(evaluator.canonicalizeTarget);
    const evaluate = capturedCapability(evaluator.evaluate);
    return [criterionId, Object.freeze({
      definition,
      canonicalizeTarget: canonicalize,
      evaluate,
    })];
  }));
  return Object.freeze(captured) as unknown as CityCriterionEvaluatorRegistry;
}

function capturedInstalledPackage(borrowed: unknown): InstalledCityResearchPackage {
  const root = exactRecord(borrowed, INSTALLED_PACKAGE_FIELDS);
  if (!Object.isFrozen(borrowed)) mismatch();
  const sourceContractStatus = root.sourceContractStatus;
  if (sourceContractStatus !== "bounded_verified_or_unknown") mismatch();
  const validateValue = capturedCapability(root.validateValue);
  const validateSourcePeriod = capturedCapability(root.validateSourcePeriod);
  return Object.freeze({
    definition: ownedJson(root.definition, true),
    sourceContractStatus,
    readiness: ownedJson(root.readiness, true),
    installedPackageManifest: ownedJson(root.installedPackageManifest, true),
    registry: ownedJson(root.registry, true),
    catalog: ownedJson(root.catalog, true),
    criteriaDefaults: ownedJson(root.criteriaDefaults, true),
    criterionDefinitions: ownedJson(root.criterionDefinitions, true),
    evaluatorRegistry: capturedEvaluatorRegistry(root.evaluatorRegistry),
    fixedPlansByCityId: ownedJson(root.fixedPlansByCityId, true),
    safetySourcePlan: ownedJson(root.safetySourcePlan, true),
    officialAuthorityDirectory: ownedJson(root.officialAuthorityDirectory, true),
    validateValue,
    validateSourcePeriod,
  } as InstalledCityResearchPackage);
}

function sameDecision(
  left: unknown,
  right: unknown,
  integrity: CityDecisionIntegrity,
): boolean {
  return integrity.canonical(left) === integrity.canonical(right);
}

function exactKey(value: unknown): InstalledCityPackageExactKey {
  const key = exactRecord(value, EXACT_KEY_FIELDS);
  if (typeof key.countryCode !== "string" || !/^[A-Z]{2}$/.test(key.countryCode)) mismatch();
  return Object.freeze({
    countryCode: key.countryCode,
    packageId: identifier(key.packageId),
    packageSchemaVersion: identifier(key.packageSchemaVersion),
    catalogRevisionId: identifier(key.catalogRevisionId),
    evidenceRulesVersion: identifier(key.evidenceRulesVersion),
  });
}

function inputSetup(value: unknown): Readonly<{
  resolvedCountryShortlistRevisionId: string;
  countryCode: string;
}> {
  const input = exactRecord(value, SETUP_KEYS);
  if (typeof input.countryCode !== "string" || !/^[A-Z]{2}$/.test(input.countryCode)) mismatch();
  return Object.freeze({
    resolvedCountryShortlistRevisionId: identifier(input.resolvedCountryShortlistRevisionId),
    countryCode: input.countryCode,
  });
}

function inputStart(value: unknown): Readonly<StartCityFrontierInput> {
  const input = exactRecord(value, START_KEYS);
  const criteriaDraft = ownedJson(input.criteriaDraft) as StartCityFrontierInput["criteriaDraft"];
  if (!Array.isArray(criteriaDraft) || criteriaDraft.length !== CITY_CRITERION_IDS.length) mismatch();
  return Object.freeze({
    resolvedCountryShortlistRevisionId: identifier(input.resolvedCountryShortlistRevisionId),
    countryCode: typeof input.countryCode === "string" && /^[A-Z]{2}$/.test(input.countryCode)
      ? input.countryCode
      : mismatch(),
    criteriaDraft,
    commandId: identifier(input.commandId),
  });
}

function inputPrepare(value: unknown): Readonly<PrepareCityFrontierContinuationInput> {
  const input = exactRecord(value, PREPARE_KEYS);
  return Object.freeze({
    runId: identifier(input.runId),
    expectedRevisionId: identifier(input.expectedRevisionId),
    commandId: identifier(input.commandId),
  });
}

function inputPrepared(value: unknown): CityFrontierPrepared {
  const prepared = exactRecord(value, PREPARED_KEYS);
  if (prepared.schemaVersion !== "city-frontier-prepared@1" ||
    !Number.isSafeInteger(prepared.nextUncheckedRank) ||
    (prepared.nextUncheckedRank as number) < 1) mismatch();
  return Object.freeze({
    schemaVersion: "city-frontier-prepared@1",
    runId: identifier(prepared.runId),
    baseRevisionId: identifier(prepared.baseRevisionId),
    rankingSnapshotId: identifier(prepared.rankingSnapshotId),
    nextUncheckedRank: prepared.nextUncheckedRank as number,
    commandId: identifier(prepared.commandId),
  });
}

function evidenceDigest(value: unknown, integrity: EvidenceIntegrity): string {
  const canonical = integrity.canonical(value);
  if (typeof canonical !== "string") mismatch();
  const digest = integrity.hash(canonical);
  if (typeof digest !== "string" || !SHA256.test(digest)) mismatch();
  return digest;
}

function artifactDigest(value: unknown, binding: unknown, integrity: EvidenceIntegrity): void {
  const owned = exactRecord(binding, [
    "evidenceSnapshotId", "artifactId", "artifactOrdinal", "runId", "sourceId", "role",
    "mediaType", "sha256",
  ]);
  if (!identifier(owned.evidenceSnapshotId) || !identifier(owned.artifactId) ||
    !Number.isSafeInteger(owned.artifactOrdinal) || (owned.artifactOrdinal as number) < 0 ||
    !identifier(owned.runId) || owned.sourceId !== "city-package-installation" ||
    !identifier(owned.role) || owned.mediaType !== "application/json" ||
    owned.sha256 !== evidenceDigest(value, integrity)) mismatch();
}

function manifestPayload(manifest: Record<string, unknown>): InstalledCityPackageManifestPayload {
  return Object.freeze(Object.fromEntries(MANIFEST_PAYLOAD_FIELDS.map((key) => [
    key,
    manifest[key],
  ]))) as unknown as InstalledCityPackageManifestPayload;
}

function verifyManifest(
  borrowed: unknown,
  installed: InstalledCityResearchPackage,
  ready: ReturnType<typeof assertCityPackageReady>,
  catalog: CityCatalogProjection,
  context: InstalledCityPackageExactKey,
  decisionIntegrity: CityDecisionIntegrity,
  evidenceIntegrity: EvidenceIntegrity,
): InstalledCityPackageManifest {
  const manifest = ownedJson(borrowed, true) as Record<string, unknown>;
  exactRecord(manifest, MANIFEST_FIELDS);
  const payload = manifestPayload(manifest);
  if (installed.installedPackageManifest.id !== manifest.id ||
    !sameDecision(exactKey(manifest.key), context, decisionIntegrity) ||
    payload.schemaVersion !== "installed-city-package-manifest@1") mismatch();
  const payloadHash = evidenceDigest(payload, evidenceIntegrity);
  if (manifest.payloadHash !== payloadHash || manifest.id !== `installed-city-package-manifest:${payloadHash}` ||
    typeof manifest.hmac !== "string" || !SHA256.test(manifest.hmac) ||
    !sameDecision(payload.definition, ready.definition, decisionIntegrity) ||
    !sameDecision(payload.definition, installed.definition, decisionIntegrity) ||
    payload.sourceContractStatus !== ready.sourceContractStatus ||
    payload.sourceContractStatus !== installed.sourceContractStatus ||
    !sameDecision(payload.readiness, ready.readiness, decisionIntegrity) ||
    !sameDecision(payload.readiness, installed.readiness, decisionIntegrity)) mismatch();
  const root = exactRecord(payload.catalogRoot, ["registryRevisionId", "catalogRevisionId"]);
  if (root.registryRevisionId !== catalog.registry.id || root.catalogRevisionId !== catalog.catalog.id) mismatch();
  return manifest as unknown as InstalledCityPackageManifest;
}

function verifyInstalledArtifacts(
  installed: InstalledCityResearchPackage,
  manifest: InstalledCityPackageManifest,
  catalog: CityCatalogProjection,
  decisionIntegrity: CityDecisionIntegrity,
  evidenceIntegrity: EvidenceIntegrity,
): Readonly<{
  criterionDefinitions: InstalledCityCriterionDefinitionTuple;
  criteriaDefaults: InstalledCityResearchPackage["criteriaDefaults"];
}> {
  const memberIds = catalog.catalog.members.map(({ cityId }) => cityId);
  const planMap = exactRecord(installed.fixedPlansByCityId, memberIds);
  const manifestPlanMap = exactRecord(manifest.fixedPlansByCityId, memberIds);
  const definitionsById = new Map(installed.criterionDefinitions.map((item) => [item.criterionId, item]));
  for (const cityId of memberIds) {
    const tuple = planMap[cityId];
    const manifestTuple = manifestPlanMap[cityId];
    if (!Array.isArray(tuple) || tuple.length !== FIXED_SOURCE_IDS.length ||
      Object.getOwnPropertyNames(tuple).length !== FIXED_SOURCE_IDS.length + 1 ||
      !Array.isArray(manifestTuple) || manifestTuple.length !== FIXED_SOURCE_IDS.length ||
      Object.getOwnPropertyNames(manifestTuple).length !== FIXED_SOURCE_IDS.length + 1) mismatch();
    for (let index = 0; index < FIXED_SOURCE_IDS.length; index += 1) {
      const sourceId = FIXED_SOURCE_IDS[index]!;
      const plan = reconstructCityFixedSourcePlan(tuple[index], sourceId);
      const binding = exactRecord(manifestTuple[index], [
        "sourceId", "cityId", "planId", "criterionId", "definitionId", "parserVersion",
        "rulesVersion", "freshnessPolicyVersion", "valuePolicyVersion",
        "sourcePeriodPolicyVersion", "planArtifact",
      ]);
      const definition = definitionsById.get(plan.criterionId);
      if (plan.cityId !== cityId || plan.sourceId !== sourceId ||
        plan.criterionId !== SLOVENIA_CITY_FIXED_CRITERION_BY_SOURCE[sourceId] ||
        definition === undefined || plan.definitionId !== definition.definitionId ||
        plan.claimContract.sourceId !== plan.sourceId ||
        plan.claimContract.criterionId !== plan.criterionId ||
        plan.claimContract.definitionId !== plan.definitionId ||
        plan.claimContract.scope !== `municipality:${cityId}` ||
        plan.claimContract.geoScope !== "municipality" ||
        plan.claimContract.unit !== definition.unit ||
        plan.claimContract.denominator !== definition.denominator ||
        plan.claimContract.freshnessPolicyVersion !== definition.freshnessPolicyVersion ||
        binding.sourceId !== plan.sourceId || binding.cityId !== plan.cityId ||
        binding.planId !== plan.planId || binding.criterionId !== plan.criterionId ||
        binding.definitionId !== plan.definitionId || binding.parserVersion !== plan.parserVersion ||
        binding.rulesVersion !== plan.rulesVersion ||
        binding.freshnessPolicyVersion !== plan.claimContract.freshnessPolicyVersion ||
        binding.valuePolicyVersion !== plan.claimContract.valuePolicyVersion ||
        binding.sourcePeriodPolicyVersion !== plan.claimContract.sourcePeriodPolicyVersion) mismatch();
      artifactDigest(plan, binding.planArtifact, evidenceIntegrity);
    }
  }

  const directory = reconstructOfficialAuthorityDirectory(
    installed.officialAuthorityDirectory,
    catalog.catalog,
    decisionIntegrity,
  );
  const safety = reconstructCitySafetySourcePlan(
    installed.safetySourcePlan,
    catalog.catalog,
    directory,
    decisionIntegrity,
  );
  const manifestSafety = exactRecord(manifest.safety, [
    "sourcePlanId", "sourcePlanSchemaVersion", "authorityDirectoryId", "queryTemplateVersion",
    "definitionId", "freshnessPolicyVersion", "discoveryRulesVersion", "sourcePlanArtifact",
    "authorityDirectoryArtifact",
  ]);
  if (manifestSafety.sourcePlanId !== safety.id ||
    manifestSafety.sourcePlanSchemaVersion !== safety.schemaVersion ||
    manifestSafety.authorityDirectoryId !== directory.id ||
    manifestSafety.queryTemplateVersion !== safety.queryTemplateVersion ||
    manifestSafety.definitionId !== safety.definitionId ||
    manifestSafety.freshnessPolicyVersion !== safety.freshnessPolicyVersion ||
    manifestSafety.discoveryRulesVersion !== safety.discoveryRulesVersion) mismatch();
  artifactDigest(safety, manifestSafety.sourcePlanArtifact, evidenceIntegrity);
  artifactDigest(directory, manifestSafety.authorityDirectoryArtifact, evidenceIntegrity);

  const manifestCriteria = exactRecord(manifest.criteria, [
    "defaultsMappingVersion", "definitionIds", "evaluatorRegistryVersionId",
    "evaluatorVersionIds", "defaultsArtifact", "definitionsArtifact",
  ]);
  const definitionIds = exactRecord(manifestCriteria.definitionIds, CITY_CRITERION_IDS);
  const evaluatorVersionIds = exactRecord(manifestCriteria.evaluatorVersionIds, CITY_CRITERION_IDS);
  artifactDigest(installed.criteriaDefaults, manifestCriteria.defaultsArtifact, evidenceIntegrity);
  artifactDigest(installed.criterionDefinitions, manifestCriteria.definitionsArtifact, evidenceIntegrity);
  const definitions = reconstructInstalledCityCriterionDefinitions(
    installed.criterionDefinitions,
    definitionIds as Readonly<Record<CityCriterionId, string>>,
    evaluatorVersionIds as Readonly<Record<CityCriterionId, string>>,
  );
  const defaults = reconstructInstalledCityCriteriaDefaults(
    installed.criteriaDefaults,
    identifier(manifestCriteria.defaultsMappingVersion),
    definitions,
    installed.evaluatorRegistry,
  );
  if (!identifier(manifestCriteria.evaluatorRegistryVersionId) ||
    !identifier(manifest.valueValidatorVersionId) ||
    !identifier(manifest.sourcePeriodValidatorVersionId)) mismatch();
  return Object.freeze({ criterionDefinitions: definitions, criteriaDefaults: defaults });
}

interface InitialTrust {
  readonly catalog: CityCatalogProjection;
  readonly context: InstalledCityPackageExactKey;
  readonly installed: InstalledCityResearchPackage;
  readonly criterionDefinitions: InstalledCityCriterionDefinitionTuple;
  readonly criteriaDefaults: InstalledCityResearchPackage["criteriaDefaults"];
  readonly evaluatorRegistry: InstalledCityResearchPackage["evaluatorRegistry"];
}

interface SetupAuthority {
  readonly trust: InitialTrust;
  readonly resolved: ResolvedCountryShortlistSnapshot;
  readonly relocation: RelocationProfileSnapshot | RelocationProfileV2Snapshot;
  readonly preference: PreferenceProfileSnapshot | PreferenceProfileV2Snapshot;
  readonly resolvedCountryEntry: PreCityBranchSourceProjection["resolvedCountryEntry"];
  readonly criteriaDraft: StartCityFrontierInput["criteriaDraft"];
}

function initialTrust(countryCode: string, ports: Readonly<CityFrontierApplicationPorts>): InitialTrust {
  const availability = ports.resolveAvailability(countryCode);
  if (availability === undefined) throw new Error("city_package_not_ready");
  const ready = assertCityPackageReady(availability);
  const borrowedInstalled = ports.installedPackages.findReady(countryCode);
  if (borrowedInstalled === undefined) throw new Error("city_package_not_installed");
  const installed = capturedInstalledPackage(borrowedInstalled);
  const borrowedCurrent = ports.latestInstalledCatalog.latestInstalledVerified(countryCode);
  if (borrowedCurrent === undefined) mismatch();
  const current = ownedJson(borrowedCurrent, true) as CityCatalogProjection;
  const reconstructed = reconstructVerifiedCityCatalog({
    registry: installed.registry,
    catalog: installed.catalog,
  }, ports.decisionIntegrity);
  if (reconstructed.registry.id !== current.registry.id ||
    reconstructed.catalog.id !== current.catalog.id ||
    !sameDecision(reconstructed, current, ports.decisionIntegrity)) mismatch();
  if (reconstructed.catalog.rulesVersion !== CITY_CATALOG_RULES_VERSION) {
    throw new Error("city_catalog_upgrade_required");
  }
  const shell = exactRecord(installed.installedPackageManifest, ["id", "key"]);
  if (!Object.isFrozen(installed.installedPackageManifest) ||
    typeof shell.id !== "string" || shell.id.length === 0) mismatch();
  const context = exactKey(shell.key);
  if (!Object.isFrozen(shell.key) || context.countryCode !== countryCode ||
    context.countryCode !== ready.definition.countryCode ||
    context.countryCode !== installed.definition.countryCode ||
    context.packageId !== ready.definition.packageId ||
    context.packageId !== installed.definition.packageId ||
    context.packageSchemaVersion !== ready.definition.packageSchemaVersion ||
    context.packageSchemaVersion !== installed.definition.packageSchemaVersion ||
    context.evidenceRulesVersion !== ready.definition.evidenceRulesVersion ||
    context.evidenceRulesVersion !== installed.definition.evidenceRulesVersion ||
    context.catalogRevisionId !== reconstructed.catalog.id) mismatch();
  const borrowedManifest = ports.installedPackageManifests.loadVerified(context);
  if (borrowedManifest === undefined) mismatch();
  const manifest = verifyManifest(
    borrowedManifest,
    installed,
    ready,
    reconstructed,
    context,
    ports.decisionIntegrity,
    ports.evidenceIntegrity,
  );
  const artifacts = verifyInstalledArtifacts(
    installed,
    manifest,
    reconstructed,
    ports.decisionIntegrity,
    ports.evidenceIntegrity,
  );
  return Object.freeze({
    catalog: reconstructed,
    context,
    installed,
    ...artifacts,
    evaluatorRegistry: installed.evaluatorRegistry,
  });
}

function bindHistoricalInstalledPackage(
  installed: InstalledCityResearchPackage,
  context: InstalledCityPackageExactKey,
  catalog: CityCatalogProjection,
  ports: Readonly<CityFrontierApplicationPorts>,
): ReturnType<typeof assertCityPackageReady> {
  let ready: ReturnType<typeof assertCityPackageReady>;
  try {
    ready = assertCityPackageReady(Object.freeze({
      definition: installed.definition,
      sourceContractStatus: installed.sourceContractStatus,
      readiness: installed.readiness,
    }));
  } catch {
    return mismatch();
  }
  const shell = exactRecord(installed.installedPackageManifest, ["id", "key"]);
  const shellContext = exactKey(shell.key);
  if (!Object.isFrozen(installed.installedPackageManifest) || !Object.isFrozen(shell.key) ||
    typeof shell.id !== "string" || shell.id.length === 0 ||
    !sameDecision(shellContext, context, ports.decisionIntegrity) ||
    context.countryCode !== ready.definition.countryCode ||
    context.countryCode !== installed.definition.countryCode ||
    context.packageId !== ready.definition.packageId ||
    context.packageId !== installed.definition.packageId ||
    context.packageSchemaVersion !== ready.definition.packageSchemaVersion ||
    context.packageSchemaVersion !== installed.definition.packageSchemaVersion ||
    context.evidenceRulesVersion !== ready.definition.evidenceRulesVersion ||
    context.evidenceRulesVersion !== installed.definition.evidenceRulesVersion ||
    context.catalogRevisionId !== catalog.catalog.id ||
    catalog.catalog.countryCode !== context.countryCode ||
    catalog.registry.countryCode !== context.countryCode ||
    catalog.catalog.packageId !== context.packageId ||
    catalog.registry.packageId !== context.packageId ||
    catalog.catalog.packageSchemaVersion !== context.packageSchemaVersion ||
    catalog.registry.packageSchemaVersion !== context.packageSchemaVersion ||
    catalog.registry.id !== catalog.catalog.registryRevisionId) mismatch();
  return ready;
}

function historicalTrust(
  borrowedContext: InstalledCityPackageExactKey,
  ranking: CityRankingSnapshot,
  ports: Readonly<CityFrontierApplicationPorts>,
  requireCurrentCatalog = false,
): InitialTrust {
  const context = exactKey(borrowedContext);
  if (!Object.isFrozen(borrowedContext) ||
    !sameDecision(context, ranking.installedPackageContext, ports.decisionIntegrity) ||
    ranking.countryCode !== context.countryCode || ranking.packageId !== context.packageId ||
    ranking.packageSchemaVersion !== context.packageSchemaVersion ||
    ranking.catalogRevisionId !== context.catalogRevisionId) mismatch();
  const borrowedInstalled = ports.installedPackages.findExact(borrowedContext);
  if (borrowedInstalled === undefined) throw new Error("city_package_revision_not_installed");
  const installed = capturedInstalledPackage(borrowedInstalled);
  const installedCatalog = reconstructVerifiedCityCatalog({
    registry: installed.registry,
    catalog: installed.catalog,
  }, ports.decisionIntegrity);
  const ready = bindHistoricalInstalledPackage(installed, context, installedCatalog, ports);
  const borrowedManifest = ports.installedPackageManifests.loadVerified(borrowedContext);
  if (borrowedManifest === undefined) mismatch();
  const manifest = verifyManifest(
    borrowedManifest,
    installed,
    ready,
    installedCatalog,
    context,
    ports.decisionIntegrity,
    ports.evidenceIntegrity,
  );
  const historical = reconstructVerifiedCityCatalog(
    ownedJson(ports.historicalCatalogs.loadVerified(context.catalogRevisionId)) as CityCatalogProjection,
    ports.decisionIntegrity,
  );
  if (!sameDecision(historical, installedCatalog, ports.decisionIntegrity) ||
    historical.registry.id !== ranking.registryRevisionId ||
    historical.catalog.id !== ranking.catalogRevisionId ||
    (historical.catalog.rulesVersion !== LEGACY_CITY_CATALOG_RULES_VERSION &&
      historical.catalog.rulesVersion !== CITY_CATALOG_RULES_VERSION)) mismatch();
  if (requireCurrentCatalog && historical.catalog.rulesVersion === LEGACY_CITY_CATALOG_RULES_VERSION) {
    throw new Error("city_catalog_upgrade_required");
  }
  const artifacts = verifyInstalledArtifacts(
    installed,
    manifest,
    historical,
    ports.decisionIntegrity,
    ports.evidenceIntegrity,
  );
  return Object.freeze({
    catalog: historical,
    context,
    installed,
    ...artifacts,
    evaluatorRegistry: installed.evaluatorRegistry,
  });
}

async function loadSetupAuthority(
  input: Readonly<{ resolvedCountryShortlistRevisionId: string; countryCode: string }>,
  ports: Readonly<CityFrontierApplicationPorts>,
): Promise<SetupAuthority> {
  const trust = initialTrust(input.countryCode, ports);
  const resolved = ownedJson(await ports.resolvedCountries.requireResolvedCountryShortlistForCity(
    input.resolvedCountryShortlistRevisionId,
  )) as ResolvedCountryShortlistSnapshot;
  if (resolved.id !== input.resolvedCountryShortlistRevisionId || resolved.kind !== "resolved" ||
    !Array.isArray(resolved.resolvedEntries)) mismatch();
  const entries = resolved.resolvedEntries.filter(({ countryCode }) => countryCode === input.countryCode);
  if (entries.length !== 1) mismatch();
  const relocation = ownedJson(await ports.profiles.loadRelocationAnyVerified(
    resolved.profileSnapshotId,
  )) as RelocationProfileSnapshot | RelocationProfileV2Snapshot;
  const preference = ownedJson(await ports.profiles.loadPreferenceForRankingVerified(
    resolved.preferenceProfileSnapshotId,
  )) as PreferenceProfileSnapshot | PreferenceProfileV2Snapshot;
  if (relocation.id !== resolved.profileSnapshotId || preference.id !== resolved.preferenceProfileSnapshotId ||
    (relocation.schemaVersion === "relocation-profile@1" &&
      preference.schemaVersion !== "preference-profile@1") ||
    (relocation.schemaVersion === "relocation-profile@2" &&
      preference.schemaVersion !== "preference-profile@2") ||
    (relocation.schemaVersion !== "relocation-profile@1" &&
      relocation.schemaVersion !== "relocation-profile@2")) mismatch();
  const criteriaDraft = relocation.schemaVersion === "relocation-profile@1" &&
      preference.schemaVersion === "preference-profile@1"
    ? deriveCityCriteriaDraft(
        relocation,
        preference,
        trust.criteriaDefaults,
        trust.evaluatorRegistry,
      )
    : deriveCityCriteriaDraft(
        relocation as RelocationProfileV2Snapshot,
        preference as PreferenceProfileV2Snapshot,
        trust.criteriaDefaults,
        trust.evaluatorRegistry,
      );
  const memberCount = trust.catalog.catalog.members.length;
  if (!Number.isSafeInteger(memberCount) || memberCount < 0 || memberCount > 100) mismatch();
  return Object.freeze({
    trust,
    resolved,
    relocation,
    preference,
    resolvedCountryEntry: entries[0]!,
    criteriaDraft,
  });
}

function setupReadModel(
  input: Readonly<{ resolvedCountryShortlistRevisionId: string; countryCode: string }>,
  authority: SetupAuthority,
): CityFrontierSetupReadModel {
  const memberCount = authority.trust.catalog.catalog.members.length;
  return Object.freeze({
    resolvedCountryShortlistRevisionId: authority.resolved.id,
    countryCode: input.countryCode,
    profileSnapshotId: authority.relocation.id,
    preferenceProfileSnapshotId: authority.preference.id,
    resolvedCountryEntry: authority.resolvedCountryEntry,
    installedPackageContext: authority.trust.context,
    registryRevisionId: authority.trust.catalog.registry.id,
    catalogMemberCount: memberCount,
    catalogCoverage: authority.trust.catalog.catalog.coverage,
    criterionDefinitions: authority.trust.criterionDefinitions,
    criteriaDraft: authority.criteriaDraft,
  });
}

async function setupModel(
  input: Readonly<{ resolvedCountryShortlistRevisionId: string; countryCode: string }>,
  ports: Readonly<CityFrontierApplicationPorts>,
): Promise<CityFrontierSetupReadModel> {
  return setupReadModel(input, await loadSetupAuthority(input, ports));
}

interface HistoricalSourceAuthority {
  readonly source: PreCityBranchSourceProjection;
  readonly resolved: ResolvedCountryShortlistSnapshot;
  readonly relocation: RelocationProfileSnapshot | RelocationProfileV2Snapshot;
  readonly preference: PreferenceProfileSnapshot | PreferenceProfileV2Snapshot;
}

async function loadHistoricalSourceAuthority(
  ranking: CityRankingSnapshot,
  criteria: ReturnType<typeof reconstructCityCriteriaSnapshot>,
  trust: InitialTrust,
  ports: Readonly<CityFrontierApplicationPorts>,
): Promise<HistoricalSourceAuthority> {
  const resolved = ownedJson(await ports.resolvedCountries.requireResolvedCountryShortlistForCity(
    ranking.resolvedCountryShortlistRevisionId,
  )) as ResolvedCountryShortlistSnapshot;
  if (resolved.id !== ranking.resolvedCountryShortlistRevisionId || resolved.kind !== "resolved" ||
    !Array.isArray(resolved.resolvedEntries)) mismatch();
  const entries = resolved.resolvedEntries.filter(({ countryCode }) =>
    countryCode === ranking.countryCode);
  if (entries.length !== 1) mismatch();
  const relocation = ownedJson(await ports.profiles.loadRelocationAnyVerified(
    resolved.profileSnapshotId,
  )) as RelocationProfileSnapshot | RelocationProfileV2Snapshot;
  const preference = ownedJson(await ports.profiles.loadPreferenceForRankingVerified(
    resolved.preferenceProfileSnapshotId,
  )) as PreferenceProfileSnapshot | PreferenceProfileV2Snapshot;
  if (relocation.id !== resolved.profileSnapshotId || preference.id !== resolved.preferenceProfileSnapshotId ||
    relocation.id !== ranking.profileSnapshotId || preference.id !== ranking.preferenceProfileSnapshotId ||
    relocation.id !== criteria.profileSnapshotId || preference.id !== criteria.preferenceProfileSnapshotId ||
    (relocation.schemaVersion === "relocation-profile@1" &&
      preference.schemaVersion !== "preference-profile@1") ||
    (relocation.schemaVersion === "relocation-profile@2" &&
      preference.schemaVersion !== "preference-profile@2") ||
    (relocation.schemaVersion !== "relocation-profile@1" &&
      relocation.schemaVersion !== "relocation-profile@2")) mismatch();
  const draft = relocation.schemaVersion === "relocation-profile@1" &&
      preference.schemaVersion === "preference-profile@1"
    ? deriveCityCriteriaDraft(
        relocation,
        preference,
        trust.criteriaDefaults,
        trust.evaluatorRegistry,
      )
    : deriveCityCriteriaDraft(
        relocation as RelocationProfileV2Snapshot,
        preference as PreferenceProfileV2Snapshot,
        trust.criteriaDefaults,
        trust.evaluatorRegistry,
      );
  if (!sameDecision(criteria.criteria, draft, ports.decisionIntegrity)) mismatch();
  return Object.freeze({
    source: Object.freeze({
      profileSnapshotId: relocation.id,
      preferenceProfileSnapshotId: preference.id,
      resolvedCountryShortlistRevisionId: resolved.id,
      resolvedCountryEntry: entries[0]!,
    }),
    resolved,
    relocation,
    preference,
  });
}

function verifiedKnowledgeProjection(
  revision: CityKnowledgeRevision,
  cityId: string,
  trust: InitialTrust,
): CityKnowledgeRankingProjection {
  const owned = ownedJson(revision) as CityKnowledgeRevision;
  const projection = projectCityKnowledgeForRanking(owned);
  if (owned.id !== projection.knowledgeRevisionId || owned.cityId !== cityId ||
    projection.cityId !== cityId || owned.countryCode !== trust.context.countryCode ||
    owned.packageId !== trust.context.packageId ||
    owned.packageSchemaVersion !== trust.context.packageSchemaVersion ||
    owned.rulesVersion !== trust.context.evidenceRulesVersion) mismatch();
  return projection;
}

function latestKnowledgeForRanking(
  trust: InitialTrust,
  ports: Readonly<CityFrontierApplicationPorts>,
): readonly CityKnowledgeRankingProjection[] {
  return Object.freeze(trust.catalog.catalog.members.map(({ cityId }) => {
    const revision = ports.knowledge.latestVerified(cityId);
    return revision === undefined
      ? Object.freeze({ cityId, knowledgeRevisionId: null, facts: Object.freeze([] as []) })
      : verifiedKnowledgeProjection(revision, cityId, trust);
  }));
}

function exactKnowledgeForRanking(
  ranking: CityRankingSnapshot,
  trust: InitialTrust,
  ports: Readonly<CityFrontierApplicationPorts>,
): readonly CityKnowledgeRankingProjection[] {
  const memberIds = trust.catalog.catalog.members.map(({ cityId }) => cityId);
  const bindings = exactRecord(ranking.knowledgeRevisionIds, memberIds);
  return Object.freeze(memberIds.map((cityId) => {
    const revisionId = bindings[cityId];
    if (revisionId === null) {
      return Object.freeze({ cityId, knowledgeRevisionId: null, facts: Object.freeze([] as []) });
    }
    const id = identifier(revisionId);
    const revision = ports.knowledge.loadVerified(id);
    const projection = verifiedKnowledgeProjection(revision, cityId, trust);
    if (projection.knowledgeRevisionId !== id) mismatch();
    return projection;
  }));
}

const START_VERIFICATION_BUDGET: CityFrontierVerificationBudget = Object.freeze({
  liveCityCandidateLimit: 10,
  targetSelectableCities: 3,
  rulesVersion: "city-frontier-budget@1",
});

function ownedClockInstant(value: unknown): string {
  if (value === null || typeof value !== "object" || isBorrowedProxy(value) ||
    Object.getPrototypeOf(value) !== Date.prototype ||
    Reflect.ownKeys(value).length !== 0) mismatch();
  let millis: number;
  let instant: string;
  try {
    millis = Date.prototype.getTime.call(value);
    instant = Date.prototype.toISOString.call(value);
  } catch {
    return mismatch();
  }
  if (!Number.isFinite(millis) || new Date(millis).toISOString() !== instant) mismatch();
  return instant;
}

function fixedRunnerClockSample(value: unknown): string {
  if (value === null || typeof value !== "object" || isBorrowedProxy(value) ||
    Object.getPrototypeOf(value) !== Date.prototype || Reflect.ownKeys(value).length !== 0) {
    return "invalid_city_fixed_clock";
  }
  try {
    const millis = Date.prototype.getTime.call(value);
    const instant = Date.prototype.toISOString.call(value);
    if (!Number.isFinite(millis) || new Date(millis).toISOString() !== instant) {
      return "invalid_city_fixed_clock";
    }
    return instant;
  } catch {
    return "invalid_city_fixed_clock";
  }
}

function criteriaCommandPayload(
  criteria: Readonly<StartCityFrontierInput["criteriaDraft"]>,
  profileSnapshotId: string,
  preferenceProfileSnapshotId: string,
): CityCriteriaCommandPayload {
  return Object.freeze({
    schemaVersion: "city-criteria-command@1",
    profileSnapshotId,
    preferenceProfileSnapshotId,
    criteria,
    rulesVersion: "city-criteria@1",
  });
}

function startRunId(
  input: Readonly<Pick<StartCityFrontierInput, "resolvedCountryShortlistRevisionId" | "countryCode">>,
  trust: InitialTrust,
  criteriaPayloadHash: string,
  integrity: CityDecisionIntegrity,
): string {
  return cityFrontierRunId(Object.freeze({
    schemaVersion: "city-frontier-run@1",
    resolvedCountryShortlistRevisionId: input.resolvedCountryShortlistRevisionId,
    countryCode: input.countryCode,
    registryRevisionId: trust.catalog.registry.id,
    installedPackageContext: trust.context,
    criteriaPayloadHash,
    catalogRulesVersion: trust.catalog.catalog.rulesVersion,
    rankingRulesVersion: "city-ranker@1",
    verificationBudget: START_VERIFICATION_BUDGET,
  }), integrity);
}

function startSource(authority: SetupAuthority): PreCityBranchSourceProjection {
  return Object.freeze({
    profileSnapshotId: authority.relocation.id,
    preferenceProfileSnapshotId: authority.preference.id,
    resolvedCountryShortlistRevisionId: authority.resolved.id,
    resolvedCountryEntry: authority.resolvedCountryEntry,
  });
}

function createStartPublication(
  input: Readonly<StartCityFrontierInput>,
  authority: SetupAuthority,
  knowledge: readonly CityKnowledgeRankingProjection[],
  confirmedAt: string,
  ports: Readonly<CityFrontierApplicationPorts>,
): Readonly<{
  publication: CityFrontierStartPublication;
  knowledge: readonly CityKnowledgeRankingProjection[];
}> {
  if (!sameDecision(input.criteriaDraft, authority.criteriaDraft, ports.decisionIntegrity)) mismatch();
  const criteria = confirmCityCriteria({
    draft: input.criteriaDraft,
    profileSnapshotId: authority.relocation.id,
    preferenceProfileSnapshotId: authority.preference.id,
    confirmedAt,
  }, authority.trust.evaluatorRegistry, ports.decisionIntegrity);
  const payload = criteriaCommandPayload(
    criteria.criteria,
    criteria.profileSnapshotId,
    criteria.preferenceProfileSnapshotId,
  );
  const criteriaPayloadHash = cityCriteriaPayloadHash(payload, ports.decisionIntegrity);
  const runId = startRunId(input, authority.trust, criteriaPayloadHash, ports.decisionIntegrity);
  const preCitySource = startSource(authority);
  if (authority.resolved.createdAt > confirmedAt) mismatch();
  const candidateBranch = createPreCityBranchCommit({
    source: preCitySource,
    createdAt: authority.resolved.createdAt,
  }, ports.decisionIntegrity);
  const storedBranch = ports.branches.findPreCityBranchBySourceVerified(preCitySource);
  const preCityBranch = storedBranch === undefined
    ? candidateBranch
    : replayPreCityBranchCommit(
        reconstructPreCityBranchCommit(storedBranch, ports.decisionIntegrity),
        preCitySource,
        ports.decisionIntegrity,
      );
  if (!sameDecision(preCityBranch, candidateBranch, ports.decisionIntegrity)) mismatch();
  const ranked = rankCities({
    assessmentAt: confirmedAt,
    registry: authority.trust.catalog.registry,
    catalog: authority.trust.catalog.catalog,
    criteria,
    knowledge,
    evaluators: authority.trust.evaluatorRegistry,
  });
  const knowledgeRevisionIds = Object.freeze(Object.fromEntries(
    knowledge.map(({ cityId, knowledgeRevisionId }) => [cityId, knowledgeRevisionId]),
  ));
  const ranking = sealCityRankingSnapshot({
    schemaVersion: "city-ranking@1",
    runId,
    resolvedCountryShortlistRevisionId: authority.resolved.id,
    countryCode: input.countryCode,
    packageId: authority.trust.context.packageId,
    packageSchemaVersion: authority.trust.context.packageSchemaVersion,
    preCityBranchCommitId: preCityBranch.id,
    profileSnapshotId: authority.relocation.id,
    preferenceProfileSnapshotId: authority.preference.id,
    registryRevisionId: authority.trust.catalog.registry.id,
    catalogRevisionId: authority.trust.catalog.catalog.id,
    installedPackageContext: authority.trust.context,
    criteriaSnapshotId: criteria.id,
    assessmentAt: confirmedAt,
    knowledgeRevisionIds,
    ordered: ranked.ordered,
    screenedExclusions: ranked.screenedExclusions,
    rulesVersion: ranked.rulesVersion,
    verificationBudget: START_VERIFICATION_BUDGET,
    createdAt: confirmedAt,
  }, ports.decisionIntegrity);
  verifyCityRankingSnapshotSemantics(ranking, {
    registry: authority.trust.catalog.registry,
    catalog: authority.trust.catalog.catalog,
    criteria,
    knowledge,
    evaluators: authority.trust.evaluatorRegistry,
  }, ports.decisionIntegrity);
  const projection = reconstructCityFrontier({
    ranking: {
      assessmentAt: ranking.assessmentAt,
      orderedCityIds: ranking.ordered.map(({ cityId }) => cityId),
      screenedExclusionCityIds: ranking.screenedExclusions.map(({ cityId }) => cityId),
    },
    criteria,
    evaluators: authority.trust.evaluatorRegistry,
    predecessorMarkers: null,
    markerBindings: [],
    persisted: {
      kind: "working",
      nextUncheckedRank: 1,
      selectableCityIds: [],
      phase: "verification_required",
    },
  });
  const root = sealCityFrontierRevision({
    runId,
    rankingSnapshotId: ranking.id,
    markers: [],
    projection,
    operation: { kind: "start", commandId: input.commandId, criteriaPayloadHash },
    createdAt: confirmedAt,
  }, ports.decisionIntegrity);
  const intent = Object.freeze({
    schemaVersion: "city-frontier-start-intent@1" as const,
    runId,
    resolvedCountryShortlistRevisionId: authority.resolved.id,
    countryCode: input.countryCode,
    criteriaPayloadHash,
  });
  return Object.freeze({
    publication: Object.freeze({
      intent,
      criteria,
      preCityBranch,
      preCitySource,
      ranking,
      root,
    }),
    knowledge,
  });
}

function verifyStartWinner(
  borrowed: unknown,
  input: Readonly<StartCityFrontierInput>,
  authority: SetupAuthority,
  source: PreCityBranchSourceProjection,
  ports: Readonly<CityFrontierApplicationPorts>,
): CityFrontierStartPublicationResult {
  const value = exactRecord(borrowed, ["criteria", "preCityBranch", "ranking", "root"]);
  const criteria = reconstructCityCriteriaSnapshot(value.criteria, ports.decisionIntegrity);
  const preCityBranch = replayPreCityBranchCommit(
    reconstructPreCityBranchCommit(value.preCityBranch, ports.decisionIntegrity),
    source,
    ports.decisionIntegrity,
  );
  const ranking = reconstructCityRankingSnapshot(value.ranking, ports.decisionIntegrity);
  const root = reconstructCityFrontierRevision(value.root, ports.decisionIntegrity);
  const payload = criteriaCommandPayload(
    criteria.criteria,
    criteria.profileSnapshotId,
    criteria.preferenceProfileSnapshotId,
  );
  const criteriaPayloadHash = cityCriteriaPayloadHash(payload, ports.decisionIntegrity);
  const requestedCriteriaPayloadHash = cityCriteriaPayloadHash(criteriaCommandPayload(
    authority.criteriaDraft,
    authority.relocation.id,
    authority.preference.id,
  ), ports.decisionIntegrity);
  const runId = startRunId(input, authority.trust, criteriaPayloadHash, ports.decisionIntegrity);
  const knowledge = exactKnowledgeForRanking(ranking, authority.trust, ports);
  verifyCityRankingSnapshotSemantics(ranking, {
    registry: authority.trust.catalog.registry,
    catalog: authority.trust.catalog.catalog,
    criteria,
    knowledge,
    evaluators: authority.trust.evaluatorRegistry,
  }, ports.decisionIntegrity);
  if (criteria.profileSnapshotId !== authority.relocation.id ||
    criteria.preferenceProfileSnapshotId !== authority.preference.id ||
    !sameDecision(criteria.criteria, authority.criteriaDraft, ports.decisionIntegrity) ||
    criteriaPayloadHash !== requestedCriteriaPayloadHash ||
    ranking.runId !== runId || ranking.resolvedCountryShortlistRevisionId !== authority.resolved.id ||
    ranking.countryCode !== input.countryCode || ranking.packageId !== authority.trust.context.packageId ||
    ranking.packageSchemaVersion !== authority.trust.context.packageSchemaVersion ||
    ranking.preCityBranchCommitId !== preCityBranch.id ||
    ranking.profileSnapshotId !== criteria.profileSnapshotId ||
    ranking.preferenceProfileSnapshotId !== criteria.preferenceProfileSnapshotId ||
    ranking.registryRevisionId !== authority.trust.catalog.registry.id ||
    ranking.catalogRevisionId !== authority.trust.catalog.catalog.id ||
    ranking.criteriaSnapshotId !== criteria.id ||
    !sameDecision(ranking.installedPackageContext, authority.trust.context, ports.decisionIntegrity) ||
    !sameDecision(ranking.verificationBudget, START_VERIFICATION_BUDGET, ports.decisionIntegrity) ||
    ranking.assessmentAt !== criteria.confirmedAt || ranking.createdAt !== criteria.confirmedAt ||
    preCityBranch.createdAt !== authority.resolved.createdAt ||
    preCityBranch.createdAt > criteria.confirmedAt ||
    root.kind !== "working" || root.runId !== runId || root.predecessorRevisionId !== undefined ||
    root.rankingSnapshotId !== ranking.id || root.markers.length !== 0 ||
    root.nextUncheckedRank !== 1 || root.phase !== "verification_required" ||
    root.createdAt !== criteria.confirmedAt || root.operation.kind !== "start" ||
    root.operation.commandId !== input.commandId ||
    root.operation.criteriaPayloadHash !== criteriaPayloadHash) mismatch();
  reconstructCityFrontier({
    ranking: {
      assessmentAt: ranking.assessmentAt,
      orderedCityIds: ranking.ordered.map(({ cityId }) => cityId),
      screenedExclusionCityIds: ranking.screenedExclusions.map(({ cityId }) => cityId),
    },
    criteria,
    evaluators: authority.trust.evaluatorRegistry,
    predecessorMarkers: null,
    markerBindings: [],
    persisted: {
      kind: "working",
      nextUncheckedRank: root.nextUncheckedRank,
      selectableCityIds: [],
      phase: root.phase,
    },
  });
  return Object.freeze({ criteria, preCityBranch, ranking, root });
}

async function reloadStartReadModel(
  winner: CityFrontierStartPublicationResult,
  input: Readonly<StartCityFrontierInput>,
  authority: SetupAuthority,
  source: PreCityBranchSourceProjection,
  ports: Readonly<CityFrontierApplicationPorts>,
): Promise<CityFrontierReadModel> {
  const criteria = reconstructCityCriteriaSnapshot(
    ports.criteria.loadCriteriaVerified(winner.criteria.id),
    ports.decisionIntegrity,
  );
  if (!sameDecision(criteria, winner.criteria, ports.decisionIntegrity)) mismatch();
  const preCityBranch = replayPreCityBranchCommit(
    reconstructPreCityBranchCommit(
      ports.branches.loadPreCityBranchVerified(winner.preCityBranch.id),
      ports.decisionIntegrity,
    ),
    source,
    ports.decisionIntegrity,
  );
  if (!sameDecision(preCityBranch, winner.preCityBranch, ports.decisionIntegrity)) mismatch();
  const ranking = reconstructCityRankingSnapshot(
    ports.rankings.loadRankingVerified(winner.ranking.id),
    ports.decisionIntegrity,
  );
  if (!sameDecision(ranking, winner.ranking, ports.decisionIntegrity)) mismatch();
  const knowledge = exactKnowledgeForRanking(ranking, authority.trust, ports);
  verifyCityRankingSnapshotSemantics(ranking, {
    registry: authority.trust.catalog.registry,
    catalog: authority.trust.catalog.catalog,
    criteria,
    knowledge,
    evaluators: authority.trust.evaluatorRegistry,
  }, ports.decisionIntegrity);
  const borrowedCatalog = ports.historicalCatalogs.loadVerified(ranking.catalogRevisionId);
  const catalog = reconstructVerifiedCityCatalog(
    ownedJson(borrowedCatalog) as CityCatalogProjection,
    ports.decisionIntegrity,
  );
  if (!sameDecision(catalog, authority.trust.catalog, ports.decisionIntegrity)) mismatch();
  const borrowedChain = ports.frontierRead.loadChainVerified(ranking.runId);
  const chain = ownedJson(borrowedChain) as readonly unknown[];
  if (!Array.isArray(chain) || chain.length === 0) mismatch();
  const revisions = chain.map((revision) =>
    reconstructCityFrontierRevision(revision, ports.decisionIntegrity));
  const root = revisions[0];
  const head = revisions.at(-1);
  if (root === undefined || !sameDecision(root, winner.root, ports.decisionIntegrity) ||
    head === undefined || revisions.length !== 1 || root.predecessorRevisionId !== undefined ||
    revisions.some((revision, index) => revision.runId !== ranking.runId ||
      revision.rankingSnapshotId !== ranking.id ||
      (index > 0 && revision.predecessorRevisionId !== revisions[index - 1]!.id))) mismatch();
  const command = exactRecord(
    ports.frontierRead.findCommandVerified(ranking.runId, input.commandId),
    ["operation", "revision"],
  );
  const commandRevision = reconstructCityFrontierRevision(
    command.revision,
    ports.decisionIntegrity,
  );
  if (!sameDecision(command.operation, root.operation, ports.decisionIntegrity) ||
    !sameDecision(commandRevision, root, ports.decisionIntegrity)) mismatch();
  const selections = ownedJson(
    await ports.selectionHistory.listSelectionsWithBranchesVerified(ranking.runId),
  ) as CityFrontierReadModel["selections"];
  if (!Array.isArray(selections) || selections.length !== 0) mismatch();
  return Object.freeze({
    runId: ranking.runId,
    assessmentAt: ranking.assessmentAt,
    resolvedCountryShortlistRevisionId: ranking.resolvedCountryShortlistRevisionId,
    countryCode: ranking.countryCode,
    preCityBranchCommitId: preCityBranch.id,
    registry: catalog.registry,
    catalog: catalog.catalog,
    criteria,
    ranking,
    revision: head,
    selections,
  });
}

async function startModel(
  input: Readonly<StartCityFrontierInput>,
  ports: Readonly<CityFrontierApplicationPorts>,
): Promise<CityFrontierReadModel> {
  const authority = await loadSetupAuthority(input, ports);
  if (!sameDecision(input.criteriaDraft, authority.criteriaDraft, ports.decisionIntegrity)) mismatch();
  const knowledge = latestKnowledgeForRanking(authority.trust, ports);
  const confirmedAt = ownedClockInstant(ports.clock());
  const created = createStartPublication(input, authority, knowledge, confirmedAt, ports);
  const winner = verifyStartWinner(
    ports.startWriter.publishStart(created.publication),
    input,
    authority,
    created.publication.preCitySource,
    ports,
  );
  return reloadStartReadModel(
    winner,
    input,
    authority,
    created.publication.preCitySource,
    ports,
  );
}

function preparedFromBase(
  input: Readonly<PrepareCityFrontierContinuationInput>,
  base: CityFrontierRevision,
): CityFrontierPrepared {
  if (base.kind !== "working" || base.runId !== input.runId ||
    base.id !== input.expectedRevisionId) mismatch();
  return Object.freeze({
    schemaVersion: "city-frontier-prepared@1",
    runId: base.runId,
    baseRevisionId: base.id,
    rankingSnapshotId: base.rankingSnapshotId,
    nextUncheckedRank: base.nextUncheckedRank,
    commandId: input.commandId,
  });
}

function loadClaimedBase(
  revisionId: string,
  ports: Readonly<CityFrontierApplicationPorts>,
): CityFrontierRevision {
  let borrowed: CityFrontierRevision;
  try {
    borrowed = ports.frontierRead.loadRevisionVerified(revisionId);
  } catch (error) {
    if (error instanceof Error && error.message === "city_frontier_not_found") mismatch();
    throw error;
  }
  const revision = reconstructCityFrontierRevision(borrowed, ports.decisionIntegrity);
  if (revision.id !== revisionId) mismatch();
  return revision;
}

async function prepareModel(
  input: Readonly<PrepareCityFrontierContinuationInput>,
  ports: Readonly<CityFrontierApplicationPorts>,
): Promise<CityFrontierPrepared> {
  const command = ports.frontierRead.findCommandVerified(input.runId, input.commandId);
  if (command !== undefined) {
    const envelope = exactRecord(command, ["operation", "revision"]);
    const revision = reconstructCityFrontierRevision(
      envelope.revision,
      ports.decisionIntegrity,
    );
    if (!sameDecision(envelope.operation, revision.operation, ports.decisionIntegrity) ||
      revision.runId !== input.runId || revision.operation.kind !== "city_completed" ||
      revision.operation.commandId !== input.commandId ||
      revision.operation.expectedHeadRevisionId !== input.expectedRevisionId ||
      revision.predecessorRevisionId !== input.expectedRevisionId) mismatch();
    const base = loadClaimedBase(input.expectedRevisionId, ports);
    if (base.runId !== revision.runId || base.rankingSnapshotId !== revision.rankingSnapshotId) {
      mismatch();
    }
    return preparedFromBase(input, base);
  }

  const head = reconstructCityFrontierRevision(
    ports.frontierRead.loadHeadVerified(input.runId),
    ports.decisionIntegrity,
  );
  if (head.runId !== input.runId) mismatch();
  if (head.id !== input.expectedRevisionId) {
    const claimed = loadClaimedBase(input.expectedRevisionId, ports);
    if (claimed.runId !== input.runId ||
      claimed.rankingSnapshotId !== head.rankingSnapshotId) mismatch();
    throw new Error("stale_city_frontier_head");
  }
  return preparedFromBase(input, head);
}

interface ContinuePreflight {
  readonly prepared: CityFrontierPrepared;
  readonly base: CityFrontierRevision;
  readonly completed?: CityFrontierRevision;
}

interface ContinuationFlightIdentity {
  readonly cityCheckRunId: string;
  readonly runId: string;
  readonly baseRevisionId: string;
  readonly rankingSnapshotId: string;
  readonly cityId: string;
  readonly assessmentAt: string;
  readonly installedPackageContext: InstalledCityPackageExactKey;
}

interface ContinueAuthority extends ContinuePreflight {
  readonly ranking: CityRankingSnapshot;
  readonly trust: InitialTrust;
  readonly criteria: ReturnType<typeof reconstructCityCriteriaSnapshot>;
  readonly branch: PreCityBranchCommit;
  readonly sourceAuthority: HistoricalSourceAuthority;
  readonly cityId: string;
  readonly rank: number;
  readonly cityCheckRunId: string;
  readonly flightIdentity: ContinuationFlightIdentity;
  readonly recoveredEvidencePresent: boolean;
  readonly baseMarkerBindings: readonly CityMarkerBinding[];
}

function loadHistoricalRanking(
  rankingSnapshotId: string,
  ports: Readonly<CityFrontierApplicationPorts>,
): Readonly<{
  ranking: CityRankingSnapshot;
  borrowedContext: InstalledCityPackageExactKey;
}> {
  const borrowedRanking = ports.rankings.loadRankingVerified(rankingSnapshotId);
  if (borrowedRanking === null || typeof borrowedRanking !== "object" ||
    isBorrowedProxy(borrowedRanking) || !Object.isFrozen(borrowedRanking)) mismatch();
  const contextDescriptor = Object.getOwnPropertyDescriptor(
    borrowedRanking,
    "installedPackageContext",
  );
  if (contextDescriptor === undefined || !("value" in contextDescriptor) ||
    !contextDescriptor.enumerable) mismatch();
  const ranking = reconstructCityRankingSnapshot(borrowedRanking, ports.decisionIntegrity);
  if (ranking.id !== rankingSnapshotId) mismatch();
  return Object.freeze({
    ranking,
    borrowedContext: contextDescriptor.value as InstalledCityPackageExactKey,
  });
}

function loadMarkerKnowledgeCopies(
  markers: readonly CityLiveMarker[],
  ports: Readonly<CityFrontierApplicationPorts>,
): readonly CityKnowledgeRevision[] {
  return Object.freeze(markers.map(({ knowledgeRevisionId }) =>
    ownedJson(ports.knowledge.loadVerified(knowledgeRevisionId)) as CityKnowledgeRevision));
}

async function replayMarkerBindings(
  runId: string,
  markers: readonly CityLiveMarker[],
  markerKnowledgeCopies: readonly CityKnowledgeRevision[],
  ranking: CityRankingSnapshot,
  criteria: CityCriteriaSnapshot,
  trust: InitialTrust,
  ports: Readonly<CityFrontierApplicationPorts>,
): Promise<readonly CityMarkerBinding[]> {
  if (markerKnowledgeCopies.length !== markers.length) mismatch();
  const bindings: CityMarkerBinding[] = [];
  for (let index = 0; index < markers.length; index += 1) {
    const persistedMarker = markers[index]!;
    const ranked = ranking.ordered[index];
    const rank = index + 1;
    if (ranked === undefined || ranked.rank !== rank || persistedMarker.rank !== rank ||
      persistedMarker.cityId !== ranked.cityId) mismatch();
    const derivedCityCheckRunId = cityCheckRunId(Object.freeze({
      schemaVersion: "city-check-run@1",
      runId,
      cityId: ranked.cityId,
      rankingSnapshotId: ranking.id,
    }), ports.decisionIntegrity);
    if (persistedMarker.evidenceSnapshotId !== `${derivedCityCheckRunId}:evidence`) mismatch();
    const evidence = await replayCityEvidence({
      evidenceSnapshotId: persistedMarker.evidenceSnapshotId,
      cityId: persistedMarker.cityId,
      packageId: trust.context.packageId,
    }, ports.evidenceReplay);
    const snapshot = evidence.snapshot;
    const evidenceContext: CityEvidenceContext = Object.freeze({
      schemaVersion: snapshot.schemaVersion === "city-evidence@1"
        ? "city-evidence-context@1"
        : mismatch(),
      cityCheckRunId: snapshot.cityCheckRunId,
      frontierRunId: snapshot.frontierRunId,
      cityId: snapshot.cityId,
      countryCode: snapshot.countryCode,
      packageId: snapshot.packageId,
      packageSchemaVersion: snapshot.packageSchemaVersion,
      catalogRevisionId: snapshot.catalogRevisionId,
      criteriaSnapshotId: snapshot.criteriaSnapshotId,
      rankingSnapshotId: snapshot.rankingSnapshotId,
      definitionIds: snapshot.definitionIds,
      evidenceRulesVersion: snapshot.evidenceRulesVersion,
      assessmentAt: snapshot.assessmentAt,
      completedAt: snapshot.completedAt,
    });
    bindVerifiedEvidence(evidence, evidenceContext, persistedMarker.evidenceSnapshotId, ports);
    if (evidenceContext.frontierRunId !== runId ||
      evidenceContext.rankingSnapshotId !== ranking.id ||
      evidenceContext.criteriaSnapshotId !== criteria.id ||
      evidenceContext.cityCheckRunId !== derivedCityCheckRunId ||
      snapshot.id !== `${derivedCityCheckRunId}:evidence`) mismatch();
    const markerKnowledge = reconstructCityKnowledgeRevision({
      revision: markerKnowledgeCopies[index],
      packageKey: trust.context,
      evidence: evidence as unknown as CityKnowledgeEvidenceView,
      factContracts: knowledgeContracts(trust, persistedMarker.cityId),
    }, ports.decisionIntegrity);
    if (markerKnowledge.id !== persistedMarker.knowledgeRevisionId ||
      markerKnowledge.cityId !== persistedMarker.cityId ||
      markerKnowledge.evidenceSnapshotId !== persistedMarker.evidenceSnapshotId ||
      markerKnowledge.predecessorRevisionId !== undefined ||
      markerKnowledge.lastCheckedAt !== snapshot.completedAt ||
      markerKnowledge.createdAt !== snapshot.completedAt) mismatch();
    const markerAuthority = continuationMarkerAuthority(markerKnowledge, evidence);
    const marker = reconstructCityLiveMarker({
      assessmentAt: ranking.assessmentAt,
      criteria,
      evaluators: trust.evaluatorRegistry,
      rank,
      authority: markerAuthority,
      persisted: persistedMarker,
    });
    const markerDigest = ports.decisionIntegrity.hash(ports.decisionIntegrity.canonical(marker));
    if (typeof markerDigest !== "string" || !SHA256.test(markerDigest)) mismatch();
    bindings.push(Object.freeze({ marker, markerDigest, authority: markerAuthority }));
  }
  return Object.freeze(bindings);
}

async function loadContinueAuthority(
  preflight: ContinuePreflight,
  ports: Readonly<CityFrontierApplicationPorts>,
  gated?: Readonly<{ ranking: CityRankingSnapshot; trust: InitialTrust }>,
): Promise<ContinueAuthority> {
  const { prepared, base } = preflight;
  const { ranking, trust } = gated ?? loadContinueTrust(preflight, ports);
  authenticateContinueChain(preflight, ranking, ports);

  const criteria = reconstructCityCriteriaSnapshot(
    ports.criteria.loadCriteriaVerified(ranking.criteriaSnapshotId),
    ports.decisionIntegrity,
  );
  const criteriaPayloadHash = cityCriteriaPayloadHash(criteriaCommandPayload(
    criteria.criteria,
    criteria.profileSnapshotId,
    criteria.preferenceProfileSnapshotId,
  ), ports.decisionIntegrity);
  const derivedRunId = startRunId({
    resolvedCountryShortlistRevisionId: ranking.resolvedCountryShortlistRevisionId,
    countryCode: ranking.countryCode,
  }, trust, criteriaPayloadHash, ports.decisionIntegrity);
  if (criteria.id !== ranking.criteriaSnapshotId || derivedRunId !== prepared.runId ||
    ranking.registryRevisionId !== trust.catalog.registry.id ||
    ranking.catalogRevisionId !== trust.catalog.catalog.id ||
    ranking.profileSnapshotId !== criteria.profileSnapshotId ||
    ranking.preferenceProfileSnapshotId !== criteria.preferenceProfileSnapshotId ||
    ranking.assessmentAt !== criteria.confirmedAt || ranking.createdAt !== criteria.confirmedAt ||
    !sameDecision(ranking.verificationBudget, START_VERIFICATION_BUDGET, ports.decisionIntegrity)) {
    mismatch();
  }

  const branch = reconstructPreCityBranchCommit(
    ports.branches.loadPreCityBranchVerified(ranking.preCityBranchCommitId),
    ports.decisionIntegrity,
  );
  const sourceAuthority = await loadHistoricalSourceAuthority(ranking, criteria, trust, ports);
  const replayedBranch = replayPreCityBranchCommit(
    branch,
    sourceAuthority.source,
    ports.decisionIntegrity,
  );
  if (replayedBranch.id !== ranking.preCityBranchCommitId ||
    replayedBranch.createdAt !== sourceAuthority.resolved.createdAt ||
    replayedBranch.createdAt > criteria.confirmedAt) mismatch();

  const baseMarkerKnowledge = loadMarkerKnowledgeCopies(base.markers, ports);
  const knowledge = exactKnowledgeForRanking(ranking, trust, ports);
  verifyCityRankingSnapshotSemantics(ranking, {
    registry: trust.catalog.registry,
    catalog: trust.catalog.catalog,
    criteria,
    knowledge,
    evaluators: trust.evaluatorRegistry,
  }, ports.decisionIntegrity);
  const baseBindings = await replayMarkerBindings(
    prepared.runId,
    base.markers,
    baseMarkerKnowledge,
    ranking,
    criteria,
    trust,
    ports,
  );
  if (base.kind !== "working" || base.phase !== "verification_required" ||
    base.nextUncheckedRank !== base.markers.length + 1 ||
    base.nextUncheckedRank !== prepared.nextUncheckedRank) mismatch();
  if (base.markers.length === 0) {
    if (base.predecessorRevisionId !== undefined || base.nextUncheckedRank !== 1 ||
      base.operation.kind !== "start" || base.createdAt !== criteria.confirmedAt ||
      base.operation.criteriaPayloadHash !== criteriaPayloadHash) mismatch();
  } else {
    const lastMarker = base.markers.at(-1)!;
    const lastRanked = ranking.ordered[base.markers.length - 1];
    if (base.predecessorRevisionId === undefined || base.operation.kind !== "city_completed" ||
      base.operation.expectedHeadRevisionId !== base.predecessorRevisionId ||
      lastRanked === undefined || lastMarker.rank !== lastRanked.rank ||
      lastMarker.cityId !== lastRanked.cityId || base.operation.cityId !== lastMarker.cityId ||
      base.operation.cityCheckRunId !== cityCheckRunId(Object.freeze({
        schemaVersion: "city-check-run@1",
        runId: prepared.runId,
        cityId: lastMarker.cityId,
        rankingSnapshotId: ranking.id,
      }), ports.decisionIntegrity) || base.createdAt !== lastMarker.lastCheckedAt) mismatch();
  }
  reconstructCityFrontier({
    ranking: {
      assessmentAt: ranking.assessmentAt,
      orderedCityIds: ranking.ordered.map(({ cityId }) => cityId),
      screenedExclusionCityIds: ranking.screenedExclusions.map(({ cityId }) => cityId),
    },
    criteria,
    evaluators: trust.evaluatorRegistry,
    predecessorMarkers: baseBindings.length === 0
      ? null
      : Object.freeze(base.markers.slice(0, -1)),
    markerBindings: baseBindings,
    persisted: persistedFrontierProjection(base),
  });

  const ranked = ranking.ordered[prepared.nextUncheckedRank - 1];
  if (ranked === undefined || ranked.rank !== prepared.nextUncheckedRank ||
    prepared.nextUncheckedRank > ranking.verificationBudget.liveCityCandidateLimit) mismatch();
  const checkRunId = cityCheckRunId(Object.freeze({
    schemaVersion: "city-check-run@1",
    runId: prepared.runId,
    cityId: ranked.cityId,
    rankingSnapshotId: ranking.id,
  }), ports.decisionIntegrity);
  const flightIdentity = ownedJson({
    cityCheckRunId: checkRunId,
    runId: prepared.runId,
    baseRevisionId: prepared.baseRevisionId,
    rankingSnapshotId: ranking.id,
    cityId: ranked.cityId,
    assessmentAt: ranking.assessmentAt,
    installedPackageContext: trust.context,
  }) as ContinuationFlightIdentity;
  const recoveredEvidenceProbe = ports.evidence.findVerifiedByCheckRunId(checkRunId);
  if (recoveredEvidenceProbe !== undefined &&
    (recoveredEvidenceProbe === null || typeof recoveredEvidenceProbe !== "object" ||
      isBorrowedProxy(recoveredEvidenceProbe))) mismatch();
  const recoveredEvidencePresent = recoveredEvidenceProbe !== undefined;
  return Object.freeze({
    ...preflight,
    ranking,
    trust,
    criteria,
    branch: replayedBranch,
    sourceAuthority,
    cityId: ranked.cityId,
    rank: ranked.rank,
    cityCheckRunId: checkRunId,
    flightIdentity,
    recoveredEvidencePresent,
    baseMarkerBindings: baseBindings,
  });
}

function loadContinueTrust(
  preflight: ContinuePreflight,
  ports: Readonly<CityFrontierApplicationPorts>,
): Readonly<{ ranking: CityRankingSnapshot; trust: InitialTrust }> {
  const loaded = loadHistoricalRanking(preflight.prepared.rankingSnapshotId, ports);
  const ranking = loaded.ranking;
  if (ranking.runId !== preflight.prepared.runId ||
    preflight.base.rankingSnapshotId !== ranking.id) mismatch();
  const trust = historicalTrust(loaded.borrowedContext, ranking, ports, true);
  return Object.freeze({ ranking, trust });
}

const abortSignalAbortedGetter = Object.getOwnPropertyDescriptor(
  AbortSignal.prototype,
  "aborted",
)?.get;
const abortSignalReasonGetter = Object.getOwnPropertyDescriptor(
  AbortSignal.prototype,
  "reason",
)?.get;

function nativeSignalAborted(signal: AbortSignal): boolean {
  if (abortSignalAbortedGetter === undefined) mismatch();
  const value = Reflect.apply(abortSignalAbortedGetter, signal, []);
  if (typeof value !== "boolean") mismatch();
  return value;
}

function nativeSignalReason(signal: AbortSignal): unknown {
  if (abortSignalReasonGetter === undefined) mismatch();
  return Reflect.apply(abortSignalReasonGetter, signal, []);
}

function abortReason(signal: AbortSignal): never {
  throw nativeSignalReason(signal) ?? new DOMException("Aborted", "AbortError");
}

function continuationDeadlines(
  ports: Readonly<CityFrontierApplicationPorts>,
): readonly [string, string, string] {
  const researchStartedAt = ownedClockInstant(ports.clock());
  const startedMillis = Date.parse(researchStartedAt);
  const deadlines = FIXED_SOURCE_IDS.map(() => {
    const input = new Date(startedMillis);
    const deadlineAt = ownedClockInstant(ports.fixedSourceDeadlineAt(input));
    if (Date.prototype.toISOString.call(input) !== researchStartedAt ||
      Date.parse(deadlineAt) <= startedMillis) mismatch();
    return deadlineAt;
  });
  if (deadlines.length !== FIXED_SOURCE_IDS.length ||
    deadlines.some((deadline) => deadline !== deadlines[0])) mismatch();
  return deadlines as unknown as readonly [string, string, string];
}

type ContinuationEventPayload<E = CityFrontierEvent> = E extends CityFrontierEvent
  ? Omit<E, "runId" | "baseRevisionId" | "sequence" | "occurredAt">
  : never;

interface ContinuationEventPump {
  emit(event: ContinuationEventPayload): Promise<void>;
}

function continuationEventPump(
  authority: ContinueAuthority,
  emit: (event: CityFrontierEvent) => void | Promise<void>,
  signal: AbortSignal,
  ports: Readonly<CityFrontierApplicationPorts>,
): ContinuationEventPump {
  let sequence = 0;
  let priorAt = authority.ranking.assessmentAt;
  return Object.freeze({
    async emit(payload: ContinuationEventPayload) {
      if (nativeSignalAborted(signal)) abortReason(signal);
      const occurredAt = ownedClockInstant(ports.clock());
      if (nativeSignalAborted(signal)) abortReason(signal);
      if (occurredAt < priorAt) mismatch();
      priorAt = occurredAt;
      sequence += 1;
      const event = ownedJson({
        ...payload,
        runId: authority.prepared.runId,
        baseRevisionId: authority.prepared.baseRevisionId,
        sequence,
        occurredAt,
      }) as CityFrontierEvent;
      await emit(event);
      if (nativeSignalAborted(signal)) abortReason(signal);
    },
  });
}

type FixedRunResults = readonly [
  CityFixedSourceRunResult<
    "si-city-long-term-rent",
    CityFixedEvidenceClaim<"si-city-long-term-rent">
  >,
  CityFixedSourceRunResult<
    "si-city-urban-transit",
    CityFixedEvidenceClaim<"si-city-urban-transit">
  >,
  CityFixedSourceRunResult<
    "si-city-fixed-broadband",
    CityFixedEvidenceClaim<"si-city-fixed-broadband">
  >,
];

interface ContinuationResearch {
  readonly fixedPlans: readonly [
    CityFixedSourcePlan<"si-city-long-term-rent">,
    CityFixedSourcePlan<"si-city-urban-transit">,
    CityFixedSourcePlan<"si-city-fixed-broadband">,
  ];
  readonly fixed: FixedRunResults;
  readonly safety: Awaited<ReturnType<typeof runCitySafetyDiscovery>>;
  readonly safetyEntry: TerminalEvidenceEntry<"si-city-safety", CityEvidenceClaim<"si-city-safety">>;
}

function fixedPlansForCity(
  trust: InitialTrust,
  cityId: string,
): ContinuationResearch["fixedPlans"] {
  const borrowed = trust.installed.fixedPlansByCityId[cityId];
  if (borrowed === undefined || borrowed.length !== FIXED_SOURCE_IDS.length) mismatch();
  return Object.freeze([
    reconstructCityFixedSourcePlan(borrowed[0], "si-city-long-term-rent"),
    reconstructCityFixedSourcePlan(borrowed[1], "si-city-urban-transit"),
    reconstructCityFixedSourcePlan(borrowed[2], "si-city-fixed-broadband"),
  ]);
}

function selectedFixedPlans(authority: ContinueAuthority): ContinuationResearch["fixedPlans"] {
  return fixedPlansForCity(authority.trust, authority.cityId);
}

async function runContinuationResearch(
  authority: ContinueAuthority,
  deadlines: readonly [string, string, string],
  signal: AbortSignal,
  ports: Readonly<CityFrontierApplicationPorts>,
): Promise<ContinuationResearch> {
  const plans = selectedFixedPlans(authority);
  const fixedNow = () => (): string => fixedRunnerClockSample(ports.clock());
  const safetyPromise = Promise.resolve().then(() => runCitySafetyDiscovery({
      runId: authority.cityCheckRunId,
      catalog: authority.trust.catalog.catalog,
      integrity: ports.decisionIntegrity,
      sourcePlan: authority.trust.installed.safetySourcePlan,
      authorityDirectory: authority.trust.installed.officialAuthorityDirectory,
      cityId: authority.cityId,
      assessmentAt: authority.ranking.assessmentAt,
      signal,
    }, {
      search: ports.safetySearch,
      officialDocuments: ports.safetyDocuments,
      clock: () => new Date(ownedClockInstant(ports.clock())),
    }));
  const fixedPromise = Promise.resolve().then(() => {
    const starts = [
      () => runCityFixedSourcePlan({
        cityCheckRunId: authority.cityCheckRunId,
        cityId: authority.cityId,
        sourceId: plans[0].sourceId,
        criterionId: plans[0].criterionId,
        planId: plans[0].planId,
        definitionId: plans[0].definitionId,
        assessmentAt: authority.ranking.assessmentAt,
        deadlineAt: deadlines[0],
        signal,
        now: fixedNow(),
        deadlineScheduler: ports.fixedDeadlineScheduler,
        validateValue: authority.trust.installed.validateValue,
        validateSourcePeriod: authority.trust.installed.validateSourcePeriod,
      }, plans[0], ports.fixedRoutes["si-city-long-term-rent"]),
      () => runCityFixedSourcePlan({
        cityCheckRunId: authority.cityCheckRunId,
        cityId: authority.cityId,
        sourceId: plans[1].sourceId,
        criterionId: plans[1].criterionId,
        planId: plans[1].planId,
        definitionId: plans[1].definitionId,
        assessmentAt: authority.ranking.assessmentAt,
        deadlineAt: deadlines[1],
        signal,
        now: fixedNow(),
        deadlineScheduler: ports.fixedDeadlineScheduler,
        validateValue: authority.trust.installed.validateValue,
        validateSourcePeriod: authority.trust.installed.validateSourcePeriod,
      }, plans[1], ports.fixedRoutes["si-city-urban-transit"]),
      () => runCityFixedSourcePlan({
        cityCheckRunId: authority.cityCheckRunId,
        cityId: authority.cityId,
        sourceId: plans[2].sourceId,
        criterionId: plans[2].criterionId,
        planId: plans[2].planId,
        definitionId: plans[2].definitionId,
        assessmentAt: authority.ranking.assessmentAt,
        deadlineAt: deadlines[2],
        signal,
        now: fixedNow(),
        deadlineScheduler: ports.fixedDeadlineScheduler,
        validateValue: authority.trust.installed.validateValue,
        validateSourcePeriod: authority.trust.installed.validateSourcePeriod,
      }, plans[2], ports.fixedRoutes["si-city-fixed-broadband"]),
    ] as const;
    const observed: Promise<CityFixedSourceRunResult<
      SloveniaCityFixedSourceId,
      CityFixedEvidenceClaim<SloveniaCityFixedSourceId>
    >>[] = [];
    for (const start of starts) {
      const promise = Promise.resolve(start()) as
        Promise<CityFixedSourceRunResult<
          SloveniaCityFixedSourceId,
          CityFixedEvidenceClaim<SloveniaCityFixedSourceId>
        >>;
      void promise.catch(() => undefined);
      observed.push(promise);
    }
    return Promise.all(observed) as unknown as Promise<FixedRunResults>;
  });
  const [safety, [rent, transit, broadband]] = await Promise.all([
    safetyPromise,
    fixedPromise,
  ]);
  const safetyEntry = citySafetyTerminalEntry({
    cityCheckRunId: authority.cityCheckRunId,
    ledger: safety.ledger,
    artifacts: safety.artifacts,
    sourcePlan: authority.trust.installed.safetySourcePlan,
    authorityDirectory: authority.trust.installed.officialAuthorityDirectory,
  });
  return Object.freeze({
    fixedPlans: plans,
    fixed: Object.freeze([rent, transit, broadband]) as FixedRunResults,
    safety,
    safetyEntry,
  });
}

function continuationEvidenceContext(
  authority: ContinueAuthority,
  research: ContinuationResearch,
  completedAt: string,
): CityEvidenceContext {
  if (completedAt < authority.ranking.assessmentAt ||
    research.fixed.some(({ ledger }) => ledger.completedAt > completedAt) ||
    research.safety.ledger.completedAt > completedAt) mismatch();
  return Object.freeze({
    schemaVersion: "city-evidence-context@1",
    cityCheckRunId: authority.cityCheckRunId,
    frontierRunId: authority.prepared.runId,
    cityId: authority.cityId,
    countryCode: authority.trust.context.countryCode,
    packageId: authority.trust.context.packageId,
    packageSchemaVersion: authority.trust.context.packageSchemaVersion,
    catalogRevisionId: authority.trust.context.catalogRevisionId,
    criteriaSnapshotId: authority.criteria.id,
    rankingSnapshotId: authority.ranking.id,
    definitionIds: Object.freeze({
      safety: authority.trust.installed.safetySourcePlan.definitionId,
      long_term_rent: research.fixedPlans[0].definitionId,
      urban_transit: research.fixedPlans[1].definitionId,
      fixed_broadband: research.fixedPlans[2].definitionId,
    }),
    evidenceRulesVersion: authority.trust.context.evidenceRulesVersion,
    assessmentAt: authority.ranking.assessmentAt,
    completedAt,
  });
}

function bindVerifiedEvidence(
  verified: VerifiedCityEvidence,
  context: CityEvidenceContext,
  sealedId: string,
  ports: Readonly<CityFrontierApplicationPorts>,
): void {
  const snapshot = verified.snapshot;
  if (snapshot.id !== sealedId || snapshot.id !== `${context.cityCheckRunId}:evidence` ||
    snapshot.schemaVersion !== "city-evidence@1" ||
    snapshot.cityCheckRunId !== context.cityCheckRunId ||
    snapshot.frontierRunId !== context.frontierRunId || snapshot.cityId !== context.cityId ||
    snapshot.countryCode !== context.countryCode || snapshot.packageId !== context.packageId ||
    snapshot.packageSchemaVersion !== context.packageSchemaVersion ||
    snapshot.catalogRevisionId !== context.catalogRevisionId ||
    snapshot.criteriaSnapshotId !== context.criteriaSnapshotId ||
    snapshot.rankingSnapshotId !== context.rankingSnapshotId ||
    snapshot.evidenceRulesVersion !== context.evidenceRulesVersion ||
    snapshot.assessmentAt !== context.assessmentAt || snapshot.completedAt !== context.completedAt ||
    snapshot.contextHash !== cityEvidenceContextHash(context, ports.decisionIntegrity) ||
    !sameDecision(snapshot.definitionIds, context.definitionIds, ports.decisionIntegrity) ||
    verified.genericEvidence.snapshot.id !== sealedId) mismatch();
}

async function sealContinuationEvidence(
  authority: ContinueAuthority,
  research: ContinuationResearch,
  completedAt: string,
  beforeDurableWrite: () => void,
  ports: Readonly<CityFrontierApplicationPorts>,
): Promise<Readonly<{ context: CityEvidenceContext; verified: VerifiedCityEvidence }>> {
  const context = continuationEvidenceContext(authority, research, completedAt);
  const entries: readonly TerminalEvidenceEntry<
    SloveniaCityFactSourceId,
    CityEvidenceClaim
  >[] = Object.freeze([
    research.safetyEntry,
    research.fixed[0].entry,
    research.fixed[1].entry,
    research.fixed[2].entry,
  ]);
  const evidenceId = `${authority.cityCheckRunId}:evidence`;
  const genericEvidence = await sealEvidencePlan({
    id: evidenceId,
    assessmentDate: authority.ranking.assessmentAt.slice(0, 10),
    entries,
    sourceIds: SLOVENIA_CITY_FACT_SOURCE_IDS,
    parserVersions: Object.freeze({
      "si-city-safety": SLOVENIA_CITY_FACT_VERSIONS["si-city-safety"].parserVersion,
      "si-city-long-term-rent": research.fixedPlans[0].parserVersion,
      "si-city-urban-transit": research.fixedPlans[1].parserVersion,
      "si-city-fixed-broadband": research.fixedPlans[2].parserVersion,
    }),
    rulesVersion: context.evidenceRulesVersion,
    contextHash: cityEvidenceContextHash(context, ports.decisionIntegrity),
  }, ports.evidenceIntegrity);
  const artifacts = Object.freeze([
    ...research.safety.artifacts,
    ...research.fixed[0].artifacts,
    ...research.fixed[1].artifacts,
    ...research.fixed[2].artifacts,
  ]) as readonly LiveCapturedArtifact<SloveniaCityFactSourceId>[];
  const fixedAttemptLedgers = Object.freeze([
    research.fixed[0].ledger,
    research.fixed[1].ledger,
    research.fixed[2].ledger,
  ]) as CityFixedAttemptLedgerTuple;
  const sealInput: CityEvidenceSealInput = Object.freeze({
    ...context,
    genericEvidence,
    artifacts,
    fixedAttemptLedgers,
    safetyAttemptLedger: research.safety.ledger,
  });
  beforeDurableWrite();
  const sealed = ports.evidence.seal(sealInput);
  if (sealed.id !== evidenceId || sealed.cityCheckRunId !== authority.cityCheckRunId) mismatch();
  const verified = await replayCityEvidence({
    evidenceSnapshotId: sealed.id,
    cityId: authority.cityId,
    packageId: authority.trust.context.packageId,
  }, ports.evidenceReplay);
  bindVerifiedEvidence(verified, context, sealed.id, ports);
  if (!sameDecision(verified.snapshot, sealed, ports.decisionIntegrity)) mismatch();
  return Object.freeze({ context, verified });
}

function recoveredEvidenceContext(
  authority: ContinueAuthority,
  evidence: VerifiedCityEvidence,
): CityEvidenceContext {
  const plans = selectedFixedPlans(authority);
  return Object.freeze({
    schemaVersion: "city-evidence-context@1",
    cityCheckRunId: authority.cityCheckRunId,
    frontierRunId: authority.prepared.runId,
    cityId: authority.cityId,
    countryCode: authority.trust.context.countryCode,
    packageId: authority.trust.context.packageId,
    packageSchemaVersion: authority.trust.context.packageSchemaVersion,
    catalogRevisionId: authority.trust.context.catalogRevisionId,
    criteriaSnapshotId: authority.criteria.id,
    rankingSnapshotId: authority.ranking.id,
    definitionIds: Object.freeze({
      safety: authority.trust.installed.safetySourcePlan.definitionId,
      long_term_rent: plans[0].definitionId,
      urban_transit: plans[1].definitionId,
      fixed_broadband: plans[2].definitionId,
    }),
    evidenceRulesVersion: authority.trust.context.evidenceRulesVersion,
    assessmentAt: authority.ranking.assessmentAt,
    completedAt: evidence.snapshot.completedAt,
  });
}

async function recoverContinuationEvidence(
  authority: ContinueAuthority,
  ports: Readonly<CityFrontierApplicationPorts>,
): Promise<Readonly<{ context: CityEvidenceContext; verified: VerifiedCityEvidence }>> {
  if (!authority.recoveredEvidencePresent) mismatch();
  const evidenceId = `${authority.cityCheckRunId}:evidence`;
  const verified = await replayCityEvidence({
    evidenceSnapshotId: evidenceId,
    cityId: authority.cityId,
    packageId: authority.trust.context.packageId,
  }, ports.evidenceReplay);
  const context = recoveredEvidenceContext(authority, verified);
  bindVerifiedEvidence(verified, context, evidenceId, ports);
  return Object.freeze({ context, verified });
}

function continuationSafetyTerminalLink(
  evidence: VerifiedCityEvidence,
): CitySafetyEvidenceLink {
  const ledger = evidence.snapshot.safetyAttemptLedger;
  const entries = evidence.genericEvidence.entries.filter(({ sourceId }) =>
    sourceId === "si-city-safety");
  if (entries.length !== 1) mismatch();
  const entry = entries[0]!;
  const terminal = Object.freeze({
    navigationUrl: entry.navigationUrl,
    resolvedEvidenceUrl: entry.resolvedEvidenceUrl,
  });
  const snapshot = evidence.genericEvidence.snapshot;
  const claims = snapshot.claims.filter(({ sourceId }) => sourceId === "si-city-safety");
  const blockers = snapshot.blockers.filter(({ sourceId }) => sourceId === "si-city-safety");
  if (ledger.result.kind === "verified") {
    if (snapshot.coverage["si-city-safety"] !== "verified" || claims.length !== 1 ||
      blockers.length !== 0 || claims[0]!.sourcePeriod !== String(ledger.result.referenceYear)) mismatch();
    const link = projectReconstructedCitySafetyTerminalLink(
      ledger,
      terminal,
      Object.freeze({ kind: "claim", sourcePeriod: claims[0]!.sourcePeriod }),
    );
    if (link.disposition !== "accepted") mismatch();
    return link;
  }
  if (snapshot.coverage["si-city-safety"] !== "unavailable" || claims.length !== 0 ||
    blockers.length !== 1) mismatch();
  const blocker = blockers[0]!;
  if (blocker.kind !== ledger.result.reason || blocker.navigationUrl !== terminal.navigationUrl ||
    (blocker.resolvedUrl ?? blocker.navigationUrl) !== terminal.resolvedEvidenceUrl) mismatch();
  const link = projectReconstructedCitySafetyTerminalLink(
    ledger,
    terminal,
    Object.freeze({ kind: "blocker", aggregateReason: ledger.result.reason }),
  );
  if (link.disposition !== "reviewed_rejected") mismatch();
  return link;
}

function knowledgeContracts(
  trust: InitialTrust,
  cityId: string,
): CityKnowledgeFactContractTuple {
  const safetyEntry = trust.installed.safetySourcePlan.entries.find(
    (entry) => entry.cityId === cityId,
  );
  if (safetyEntry === undefined) mismatch();
  const safety = Object.freeze({
    sourceId: "si-city-safety" as const,
    criterionId: "safety" as const,
    definitionId: trust.installed.safetySourcePlan.definitionId,
    scope: `municipality:${safetyEntry.municipalityCode}`,
    geoScope: "municipality",
    officialAreaId: safetyEntry.municipalityCode,
    unit: "offences_per_100000_residents",
    denominator: "municipality_population_january_1",
    freshnessPolicyVersion: trust.installed.safetySourcePlan.freshnessPolicyVersion,
  });
  const fixed = fixedPlansForCity(trust, cityId).map(({ claimContract }) => Object.freeze({
    sourceId: claimContract.sourceId,
    criterionId: claimContract.criterionId,
    definitionId: claimContract.definitionId,
    scope: claimContract.scope,
    geoScope: claimContract.geoScope,
    officialAreaId: claimContract.officialAreaId,
    unit: claimContract.unit,
    denominator: claimContract.denominator,
    freshnessPolicyVersion: claimContract.freshnessPolicyVersion,
  }));
  return Object.freeze([safety, fixed[0]!, fixed[1]!, fixed[2]!]) as
    CityKnowledgeFactContractTuple;
}

function reconstructContinuationKnowledge(
  revision: CityKnowledgeRevision,
  evidence: VerifiedCityEvidence,
  contracts: CityKnowledgeFactContractTuple,
  authority: ContinueAuthority,
  ports: Readonly<CityFrontierApplicationPorts>,
): CityKnowledgeRevision {
  const reconstructed = reconstructCityKnowledgeRevision({
    revision,
    packageKey: authority.trust.context,
    evidence: evidence as unknown as CityKnowledgeEvidenceView,
    factContracts: contracts,
  }, ports.decisionIntegrity);
  if (reconstructed.cityId !== authority.cityId ||
    reconstructed.evidenceSnapshotId !== evidence.snapshot.id ||
    reconstructed.predecessorRevisionId !== undefined ||
    reconstructed.lastCheckedAt !== evidence.snapshot.completedAt ||
    reconstructed.createdAt !== evidence.snapshot.completedAt) mismatch();
  return reconstructed;
}

function publishContinuationKnowledge(
  evidence: VerifiedCityEvidence,
  authority: ContinueAuthority,
  beforePublish: () => void,
  ports: Readonly<CityFrontierApplicationPorts>,
): CityKnowledgeRevision {
  const contracts = knowledgeContracts(authority.trust, authority.cityId);
  const evidenceSnapshotId = evidence.snapshot.id;
  const completedAt = evidence.snapshot.completedAt;
  beforePublish();
  const published = reconstructContinuationKnowledge(
    ports.knowledge.publishFromEvidence(
      evidenceSnapshotId,
      completedAt,
    ),
    evidence,
    contracts,
    authority,
    ports,
  );
  const loaded = reconstructContinuationKnowledge(
    ports.knowledge.loadVerified(published.id),
    evidence,
    contracts,
    authority,
    ports,
  );
  if (!sameDecision(loaded, published, ports.decisionIntegrity)) mismatch();
  return loaded;
}

function recoverContinuationKnowledge(
  evidence: VerifiedCityEvidence,
  authority: ContinueAuthority,
  ports: Readonly<CityFrontierApplicationPorts>,
): CityKnowledgeRevision | undefined {
  const found = ports.knowledge.findByEvidenceVerified(evidence.snapshot.id);
  if (found === undefined) return undefined;
  const contracts = knowledgeContracts(authority.trust, authority.cityId);
  const reconstructed = reconstructContinuationKnowledge(
    found,
    evidence,
    contracts,
    authority,
    ports,
  );
  const loaded = reconstructContinuationKnowledge(
    ports.knowledge.loadVerified(reconstructed.id),
    evidence,
    contracts,
    authority,
    ports,
  );
  if (!sameDecision(loaded, reconstructed, ports.decisionIntegrity)) mismatch();
  return loaded;
}

function continuationMarkerAuthority(
  knowledge: CityKnowledgeRevision,
  evidence: VerifiedCityEvidence,
  attachedSafetyTerminalLink: CitySafetyEvidenceLink = continuationSafetyTerminalLink(evidence),
): CityMarkerAuthorityProjection {
  const safetyLedger = evidence.snapshot.safetyAttemptLedger;
  const facts = knowledge.facts.map((fact) => {
    const evidenceLinks = Object.freeze(fact.evidenceRefs.flatMap((reference) => {
      if (reference.kind !== "claim") return [];
      if (fact.criterionId === "safety" &&
        (attachedSafetyTerminalLink.disposition !== "accepted" ||
          attachedSafetyTerminalLink.navigationUrl !== reference.navigationUrl ||
          attachedSafetyTerminalLink.resolvedEvidenceUrl !== reference.resolvedEvidenceUrl ||
          fact.referencePeriod !== String(attachedSafetyTerminalLink.referenceYear))) mismatch();
      return [Object.freeze({
        sourceId: reference.sourceId,
        disposition: "accepted" as const,
        navigationUrl: reference.navigationUrl,
        resolvedEvidenceUrl: reference.resolvedEvidenceUrl,
        ...(fact.criterionId === "safety"
          ? { referenceYear: (attachedSafetyTerminalLink as Extract<
              CitySafetyEvidenceLink,
              { readonly disposition: "accepted" }
            >).referenceYear }
          : {}),
      })];
    }));
    const manualCheckLinks = Object.freeze(fact.evidenceRefs.flatMap((reference) => {
      if (reference.kind !== "blocker") return [];
      let safetyRejection: CityFactLinkRejectionReason | undefined;
      let safetyReferenceYear: number | undefined;
      const navigationUrl = reference.navigationUrl;
      const resolvedEvidenceUrl = reference.resolvedEvidenceUrl;
      if (fact.criterionId === "safety") {
        if (safetyLedger.result.kind !== "unknown" || fact.outcome.kind !== "unknown" ||
          fact.outcome.reason !== safetyLedger.result.reason) mismatch();
        const terminalUrl = reference.resolvedEvidenceUrl ?? reference.navigationUrl;
        if (attachedSafetyTerminalLink.disposition !== "reviewed_rejected" ||
          attachedSafetyTerminalLink.navigationUrl !== reference.navigationUrl ||
          (attachedSafetyTerminalLink.resolvedEvidenceUrl ??
            attachedSafetyTerminalLink.navigationUrl) !== terminalUrl) mismatch();
        safetyRejection = attachedSafetyTerminalLink.rejectionReason;
        safetyReferenceYear = attachedSafetyTerminalLink.referenceYear;
      }
      return [Object.freeze({
        sourceId: reference.sourceId,
        disposition: "reviewed_rejected" as const,
        navigationUrl,
        ...(resolvedEvidenceUrl === undefined
          ? {}
          : { resolvedEvidenceUrl }),
        ...(safetyReferenceYear === undefined
          ? {}
          : { referenceYear: safetyReferenceYear }),
        ...(safetyRejection === undefined
          ? {}
          : { rejectionReason: safetyRejection }),
      })];
    }));
    return Object.freeze({
      criterionId: fact.criterionId,
      definitionId: fact.definitionId,
      geoScope: fact.geoScope.kind,
      referencePeriod: fact.referencePeriod,
      freshnessBasis: fact.freshnessBasis.policyVersion,
      unit: fact.unit,
      denominator: fact.denominator,
      outcome: fact.outcome,
      evidenceLinks,
      manualCheckLinks,
    } satisfies CityCommittedFactProjection);
  });
  if (facts.length !== CITY_CRITERION_IDS.length) mismatch();
  return Object.freeze({
    cityId: knowledge.cityId,
    knowledgeRevisionId: knowledge.id,
    evidenceSnapshotId: knowledge.evidenceSnapshotId,
    lastCheckedAt: knowledge.lastCheckedAt,
    facts: Object.freeze(facts) as unknown as CityCommittedFactProjectionTuple,
  });
}

interface ContinuationCommit {
  readonly marker: CityLiveMarker;
  readonly markerAuthority: CityMarkerAuthorityProjection;
  readonly revision: CityFrontierRevision;
}

function commitContinuationRevision(
  knowledge: CityKnowledgeRevision,
  evidence: VerifiedCityEvidence,
  safetyTerminalLink: ContinuationEvidence["safetyTerminalLink"],
  completedAt: string,
  authority: ContinueAuthority,
  beforeAppend: () => void,
  ports: Readonly<CityFrontierApplicationPorts>,
): ContinuationCommit {
  if (knowledge.lastCheckedAt !== completedAt || knowledge.createdAt !== completedAt ||
    evidence.snapshot.completedAt !== completedAt) mismatch();
  const markerAuthority = continuationMarkerAuthority(knowledge, evidence, safetyTerminalLink);
  const marker = reconstructCityLiveMarker({
    assessmentAt: authority.ranking.assessmentAt,
    criteria: authority.criteria,
    evaluators: authority.trust.evaluatorRegistry,
    rank: authority.rank,
    authority: markerAuthority,
  });
  const markerDigest = ports.decisionIntegrity.hash(
    ports.decisionIntegrity.canonical(marker),
  );
  if (typeof markerDigest !== "string" || !SHA256.test(markerDigest)) mismatch();
  const markerBindings = Object.freeze([
    ...authority.baseMarkerBindings,
    Object.freeze({ marker, markerDigest, authority: markerAuthority }),
  ]);
  const projection = reconstructCityFrontier({
    ranking: {
      assessmentAt: authority.ranking.assessmentAt,
      orderedCityIds: authority.ranking.ordered.map(({ cityId }) => cityId),
      screenedExclusionCityIds: authority.ranking.screenedExclusions.map(({ cityId }) => cityId),
    },
    criteria: authority.criteria,
    evaluators: authority.trust.evaluatorRegistry,
    predecessorMarkers: authority.base.markers,
    markerBindings,
  });
  const candidate = sealCityFrontierRevision({
    runId: authority.prepared.runId,
    predecessorRevisionId: authority.base.id,
    rankingSnapshotId: authority.ranking.id,
    markers: Object.freeze([...authority.base.markers, marker]),
    projection,
    operation: {
      kind: "city_completed",
      commandId: authority.prepared.commandId,
      expectedHeadRevisionId: authority.base.id,
      cityId: authority.cityId,
      cityCheckRunId: authority.cityCheckRunId,
    },
    createdAt: completedAt,
  }, ports.decisionIntegrity);
  beforeAppend();
  const revision = reconstructCityFrontierRevision(
    ports.frontierAppend.appendRevision({ revision: candidate }),
    ports.decisionIntegrity,
  );
  if (!sameDecision(revision, candidate, ports.decisionIntegrity)) mismatch();
  return Object.freeze({ marker, markerAuthority, revision });
}

function persistedFrontierProjection(revision: CityFrontierRevision): CityFrontierProjection {
  const selectableCityIds = revision.markers
    .filter(({ status }) => status === "selectable")
    .map(({ cityId }) => cityId);
  return revision.kind === "working"
    ? Object.freeze({
        kind: "working",
        nextUncheckedRank: revision.nextUncheckedRank,
        selectableCityIds: Object.freeze(selectableCityIds),
        phase: revision.phase,
      })
    : Object.freeze({
        kind: "terminal",
        nextUncheckedRank: revision.nextUncheckedRank,
        selectableCityIds: Object.freeze(selectableCityIds),
        entries: revision.entries,
        stopCondition: revision.stopCondition,
      });
}

async function reloadContinuationReadModel(
  authority: ContinueAuthority,
  committed: ContinuationCommit,
  expectedEvidence: Readonly<{ context: CityEvidenceContext; verified: VerifiedCityEvidence }>,
  expectedKnowledge: CityKnowledgeRevision,
  ports: Readonly<CityFrontierApplicationPorts>,
): Promise<CityFrontierReadModel> {
  const chain = reconstructFrontierChain(
    authority.prepared.runId,
    ports.frontierRead.loadChainVerified(authority.prepared.runId),
    ports,
  );
  if (chain.length !== authority.base.markers.length + 2) mismatch();
  const predecessor = chain.at(-2);
  const revision = chain.at(-1);
  if (predecessor === undefined || revision === undefined ||
    !sameDecision(predecessor, authority.base, ports.decisionIntegrity) ||
    !sameDecision(revision, committed.revision, ports.decisionIntegrity) ||
    revision.runId !== authority.prepared.runId ||
    revision.rankingSnapshotId !== authority.prepared.rankingSnapshotId ||
    revision.predecessorRevisionId !== predecessor.id) mismatch();

  const loadedRanking = loadHistoricalRanking(revision.rankingSnapshotId, ports);
  const ranking = loadedRanking.ranking;
  if (!sameDecision(ranking, authority.ranking, ports.decisionIntegrity) ||
    !sameDecision(exactKey(loadedRanking.borrowedContext), authority.trust.context,
      ports.decisionIntegrity)) mismatch();
  authenticateRevisionCommand(chain[0]!, ports);
  for (let index = 1; index < chain.length; index += 1) {
    authenticateCompletedRevision(authority.prepared.runId, chain[index]!, index, ranking, ports);
  }
  const catalog = reconstructVerifiedCityCatalog(
    ownedJson(ports.historicalCatalogs.loadVerified(ranking.catalogRevisionId)) as
      CityCatalogProjection,
    ports.decisionIntegrity,
  );
  if (!sameDecision(catalog, authority.trust.catalog, ports.decisionIntegrity)) mismatch();
  const criteria = reconstructCityCriteriaSnapshot(
    ports.criteria.loadCriteriaVerified(ranking.criteriaSnapshotId),
    ports.decisionIntegrity,
  );
  if (!sameDecision(criteria, authority.criteria, ports.decisionIntegrity)) mismatch();
  const branch = replayPreCityBranchCommit(
    reconstructPreCityBranchCommit(
      ports.branches.loadPreCityBranchVerified(ranking.preCityBranchCommitId),
      ports.decisionIntegrity,
    ),
    authority.sourceAuthority.source,
    ports.decisionIntegrity,
  );
  if (!sameDecision(branch, authority.branch, ports.decisionIntegrity)) mismatch();

  const persistedMarker = revision.markers[authority.rank - 1];
  if (persistedMarker === undefined || revision.markers.length !== authority.rank) mismatch();
  const borrowedKnowledge = ports.knowledge.loadVerified(persistedMarker.knowledgeRevisionId);
  const verifiedEvidence = await replayCityEvidence({
    evidenceSnapshotId: persistedMarker.evidenceSnapshotId,
    cityId: persistedMarker.cityId,
    packageId: authority.trust.context.packageId,
  }, ports.evidenceReplay);
  bindVerifiedEvidence(
    verifiedEvidence,
    expectedEvidence.context,
    persistedMarker.evidenceSnapshotId,
    ports,
  );
  if (!sameDecision(verifiedEvidence, expectedEvidence.verified, ports.decisionIntegrity)) mismatch();
  const knowledge = reconstructContinuationKnowledge(
    borrowedKnowledge,
    verifiedEvidence,
    knowledgeContracts(authority.trust, authority.cityId),
    authority,
    ports,
  );
  if (!sameDecision(knowledge, expectedKnowledge, ports.decisionIntegrity)) mismatch();
  const markerAuthority = continuationMarkerAuthority(knowledge, verifiedEvidence);
  const marker = reconstructCityLiveMarker({
    assessmentAt: ranking.assessmentAt,
    criteria,
    evaluators: authority.trust.evaluatorRegistry,
    rank: authority.rank,
    authority: markerAuthority,
    persisted: persistedMarker,
  });
  const markerDigest = ports.decisionIntegrity.hash(ports.decisionIntegrity.canonical(marker));
  if (typeof markerDigest !== "string" || !SHA256.test(markerDigest)) mismatch();
  reconstructCityFrontier({
    ranking: {
      assessmentAt: ranking.assessmentAt,
      orderedCityIds: ranking.ordered.map(({ cityId }) => cityId),
      screenedExclusionCityIds: ranking.screenedExclusions.map(({ cityId }) => cityId),
    },
    criteria,
    evaluators: authority.trust.evaluatorRegistry,
    predecessorMarkers: authority.base.markers,
    markerBindings: Object.freeze([
      ...authority.baseMarkerBindings,
      Object.freeze({ marker, markerDigest, authority: markerAuthority }),
    ]),
    persisted: persistedFrontierProjection(revision),
  });

  const selections = ownedJson(
    await ports.selectionHistory.listSelectionsWithBranchesVerified(authority.prepared.runId),
  ) as CityFrontierReadModel["selections"];
  if (!Array.isArray(selections) || selections.length !== 0) mismatch();
  return Object.freeze({
    runId: ranking.runId,
    assessmentAt: ranking.assessmentAt,
    resolvedCountryShortlistRevisionId: ranking.resolvedCountryShortlistRevisionId,
    countryCode: ranking.countryCode,
    preCityBranchCommitId: branch.id,
    registry: catalog.registry,
    catalog: catalog.catalog,
    criteria,
    ranking,
    revision,
    selections,
  });
}

function continuePreflight(
  prepared: CityFrontierPrepared,
  ports: Readonly<CityFrontierApplicationPorts>,
): ContinuePreflight {
  const command = ports.frontierRead.findCommandVerified(
    prepared.runId,
    prepared.commandId,
  );
  if (command !== undefined) {
    const envelope = exactRecord(command, ["operation", "revision"]);
    const revision = reconstructCityFrontierRevision(
      envelope.revision,
      ports.decisionIntegrity,
    );
    if (!sameDecision(envelope.operation, revision.operation, ports.decisionIntegrity) ||
      revision.runId !== prepared.runId ||
      revision.rankingSnapshotId !== prepared.rankingSnapshotId ||
      revision.operation.kind !== "city_completed" ||
      revision.operation.commandId !== prepared.commandId ||
      revision.operation.expectedHeadRevisionId !== prepared.baseRevisionId ||
      revision.predecessorRevisionId !== prepared.baseRevisionId) mismatch();
    const base = loadClaimedBase(prepared.baseRevisionId, ports);
    if (base.kind !== "working" || base.runId !== prepared.runId ||
      base.rankingSnapshotId !== prepared.rankingSnapshotId ||
      base.nextUncheckedRank !== prepared.nextUncheckedRank) mismatch();
    return Object.freeze({ prepared, base, completed: revision });
  }

  const head = reconstructCityFrontierRevision(
    ports.frontierRead.loadHeadVerified(prepared.runId),
    ports.decisionIntegrity,
  );
  if (head.runId !== prepared.runId) mismatch();
  if (head.id !== prepared.baseRevisionId) {
    const claimed = loadClaimedBase(prepared.baseRevisionId, ports);
    if (claimed.runId !== prepared.runId ||
      claimed.rankingSnapshotId !== head.rankingSnapshotId) mismatch();
    throw new Error("stale_city_frontier_head");
  }
  if (head.kind !== "working" || head.rankingSnapshotId !== prepared.rankingSnapshotId ||
    head.nextUncheckedRank !== prepared.nextUncheckedRank) mismatch();
  return Object.freeze({ prepared, base: head });
}

type ContinuationEvidence = Readonly<{
  context: CityEvidenceContext;
  verified: VerifiedCityEvidence;
  safetyTerminalLink: CitySafetyEvidenceLink;
}>;

interface ContinuationFlight {
  readonly identityCanonical: string;
  readonly controller: AbortController;
  readonly waiters: Set<symbol>;
  readonly recovery: boolean;
  start(): void;
  readonly research: Promise<ContinuationResearch | undefined>;
  readonly evidence: Promise<ContinuationEvidence>;
  readonly knowledge: Promise<CityKnowledgeRevision>;
}

type ContinuationFlights = Map<string, ContinuationFlight>;

const abortSignalAddEventListener = AbortSignal.prototype.addEventListener;
const abortSignalRemoveEventListener = AbortSignal.prototype.removeEventListener;

function addNativeAbortListener(signal: AbortSignal, listener: () => void): void {
  Reflect.apply(abortSignalAddEventListener, signal, ["abort", listener, { once: true }]);
}

function removeNativeAbortListener(signal: AbortSignal, listener: () => void): void {
  Reflect.apply(abortSignalRemoveEventListener, signal, ["abort", listener]);
}

function clearContinuationFlight(
  flights: ContinuationFlights,
  checkRunId: string,
  flight: ContinuationFlight,
): void {
  if (flights.get(checkRunId) === flight) flights.delete(checkRunId);
}

function abortContinuationFlight(flight: ContinuationFlight): void {
  if (!nativeSignalAborted(flight.controller.signal)) {
    flight.controller.abort(new DOMException("Aborted", "AbortError"));
  }
}

function requireContinuationWaiter(flight: ContinuationFlight): void {
  if (flight.waiters.size === 0 || nativeSignalAborted(flight.controller.signal)) {
    abortReason(flight.controller.signal);
  }
}

function createContinuationFlight(
  authority: ContinueAuthority,
  identityCanonical: string,
  deadlines: readonly [string, string, string] | undefined,
  flights: ContinuationFlights,
  ports: Readonly<CityFrontierApplicationPorts>,
): ContinuationFlight {
  const controller = new AbortController();
  const waiters = new Set<symbol>();
  const recovery = authority.recoveredEvidencePresent;
  if (recovery !== (deadlines === undefined)) mismatch();
  let startFlight!: () => void;
  const started = new Promise<void>((resolve) => { startFlight = resolve; });
  let startClaimed = false;
  const rawResearch: Promise<ContinuationResearch | undefined> = recovery
    ? started.then(() => undefined)
    : started.then(() => runContinuationResearch(
        authority,
        deadlines!,
        controller.signal,
        ports,
      ));
  const research = rawResearch.catch((error: unknown) => {
    abortContinuationFlight(flight);
    throw error;
  });
  const unvalidatedEvidence = recovery
    ? research.then(() => recoverContinuationEvidence(authority, ports))
    : research.then(async (completedResearch) => {
        if (completedResearch === undefined) mismatch();
        requireContinuationWaiter(flight);
        const completedAt = ownedClockInstant(ports.clock());
        return sealContinuationEvidence(
          authority,
          completedResearch,
          completedAt,
          () => requireContinuationWaiter(flight),
          ports,
        );
      });
  const evidence = unvalidatedEvidence.then((value): ContinuationEvidence => {
    const safetyTerminalLink = continuationSafetyTerminalLink(value.verified);
    return Object.freeze({
      ...value,
      safetyTerminalLink,
    });
  });
  const knowledge = evidence.then((verifiedEvidence) => {
    requireContinuationWaiter(flight);
    if (recovery) {
      const recovered = recoverContinuationKnowledge(
        verifiedEvidence.verified,
        authority,
        ports,
      );
      if (recovered !== undefined) return recovered;
    }
    return publishContinuationKnowledge(
      verifiedEvidence.verified,
      authority,
      () => requireContinuationWaiter(flight),
      ports,
    );
  });
  const flight: ContinuationFlight = Object.freeze({
    identityCanonical,
    controller,
    waiters,
    recovery,
    start() {
      requireContinuationWaiter(flight);
      if (startClaimed) return;
      startClaimed = true;
      startFlight();
    },
    research,
    evidence,
    knowledge,
  });
  flights.set(authority.cityCheckRunId, flight);
  void knowledge.then(
    () => undefined,
    () => {
      abortContinuationFlight(flight);
      clearContinuationFlight(flights, authority.cityCheckRunId, flight);
    },
  );
  return flight;
}

function continuationFlight(
  authority: ContinueAuthority,
  flights: ContinuationFlights,
  ports: Readonly<CityFrontierApplicationPorts>,
): ContinuationFlight {
  const active = flights.get(authority.cityCheckRunId);
  if (active === undefined) {
    const deadlines = !authority.recoveredEvidencePresent
      ? continuationDeadlines(ports)
      : undefined;
    const identityCanonical = ports.decisionIntegrity.canonical(authority.flightIdentity);
    if (typeof identityCanonical !== "string") mismatch();
    return createContinuationFlight(authority, identityCanonical, deadlines, flights, ports);
  }
  const identityCanonical = ports.decisionIntegrity.canonical(authority.flightIdentity);
  if (typeof identityCanonical !== "string" ||
    active.identityCanonical !== identityCanonical) mismatch();
  return active;
}

async function emitResearchStart(
  authority: ContinueAuthority,
  pump: ContinuationEventPump,
): Promise<void> {
  await pump.emit({ type: "city_activated", cityId: authority.cityId, rank: authority.rank });
  for (const sourceId of SLOVENIA_CITY_FACT_SOURCE_IDS) {
    await pump.emit({
      type: "city_progress",
      cityId: authority.cityId,
      stage: `source_started:${sourceId}`,
    } as ContinuationEventPayload);
  }
}

async function emitResearchCompletion(
  authority: ContinueAuthority,
  research: ContinuationResearch,
  pump: ContinuationEventPump,
): Promise<void> {
  const completedUrls = [
    research.safetyEntry.parserEntry.navigationUrl,
    research.fixed[0].entry.parserEntry.navigationUrl,
    research.fixed[1].entry.parserEntry.navigationUrl,
    research.fixed[2].entry.parserEntry.navigationUrl,
  ] as const;
  for (let index = 0; index < SLOVENIA_CITY_FACT_SOURCE_IDS.length; index += 1) {
    const sourceId = SLOVENIA_CITY_FACT_SOURCE_IDS[index]!;
    await pump.emit({
      type: "city_progress",
      cityId: authority.cityId,
      stage: `source_completed:${sourceId}`,
      sourceUrl: completedUrls[index],
    } as ContinuationEventPayload);
  }
}

async function runContinuationWaiter(
  authority: ContinueAuthority,
  flight: ContinuationFlight,
  emit: (event: CityFrontierEvent) => void | Promise<void>,
  signal: AbortSignal,
  ports: Readonly<CityFrontierApplicationPorts>,
): Promise<CityFrontierReadModel> {
  const pump = continuationEventPump(authority, emit, signal, ports);
  if (flight.recovery) {
    await pump.emit({ type: "city_activated", cityId: authority.cityId, rank: authority.rank });
    flight.start();
  } else {
    await emitResearchStart(authority, pump);
    flight.start();
    const research = await flight.research;
    if (research === undefined) mismatch();
    await emitResearchCompletion(authority, research, pump);
  }
  const evidence = await flight.evidence;
  await pump.emit({
    type: "city_progress",
    cityId: authority.cityId,
    stage: "evidence_verified",
  });
  const knowledge = await flight.knowledge;
  await pump.emit({
    type: "city_progress",
    cityId: authority.cityId,
    stage: "knowledge_published",
  });
  if (nativeSignalAborted(signal)) abortReason(signal);
  const completedAt = evidence.verified.snapshot.completedAt;
  const committed = commitContinuationRevision(
    knowledge,
    evidence.verified,
    evidence.safetyTerminalLink,
    completedAt,
    authority,
    () => {
      if (nativeSignalAborted(signal)) abortReason(signal);
      requireContinuationWaiter(flight);
    },
    ports,
  );
  await pump.emit({
    type: "city_revision_committed",
    marker: committed.marker,
    revision: committed.revision,
  });
  const readModel = await reloadContinuationReadModel(
    authority,
    committed,
    evidence,
    knowledge,
    ports,
  );
  await pump.emit({
    type: "city_continuation_completed",
    readModel,
  });
  return readModel;
}

function attachContinuationWaiter(
  authority: ContinueAuthority,
  flight: ContinuationFlight,
  emit: (event: CityFrontierEvent) => void | Promise<void>,
  callerSignal: AbortSignal,
  flights: ContinuationFlights,
  ports: Readonly<CityFrontierApplicationPorts>,
): Promise<CityFrontierReadModel> {
  const token = Symbol("city-continuation-waiter");
  const privateController = new AbortController();
  return new Promise<CityFrontierReadModel>((resolve, reject) => {
    let settled = false;
    const detach = (abortShared: boolean): void => {
      flight.waiters.delete(token);
      if (flight.waiters.size !== 0) return;
      if (abortShared) abortContinuationFlight(flight);
      clearContinuationFlight(flights, authority.cityCheckRunId, flight);
    };
    const finish = (
      settle: (value: CityFrontierReadModel | PromiseLike<CityFrontierReadModel>) => void,
      value: CityFrontierReadModel,
    ): void => {
      if (settled) return;
      settled = true;
      removeNativeAbortListener(callerSignal, onCallerAbort);
      detach(false);
      settle(value);
    };
    const fail = (error: unknown, abortShared: boolean): void => {
      if (settled) return;
      settled = true;
      removeNativeAbortListener(callerSignal, onCallerAbort);
      if (!nativeSignalAborted(privateController.signal)) privateController.abort(error);
      detach(abortShared);
      reject(error);
    };
    const onCallerAbort = (): void => fail(
      nativeSignalReason(callerSignal) ?? new DOMException("Aborted", "AbortError"),
      true,
    );
    try {
      addNativeAbortListener(callerSignal, onCallerAbort);
    } catch (error: unknown) {
      if (flight.waiters.size === 0) {
        abortContinuationFlight(flight);
        clearContinuationFlight(flights, authority.cityCheckRunId, flight);
      }
      reject(error);
      return;
    }
    flight.waiters.add(token);
    if (nativeSignalAborted(callerSignal)) {
      onCallerAbort();
      return;
    }
    void runContinuationWaiter(
      authority,
      flight,
      emit,
      privateController.signal,
      ports,
    ).then(
      (value) => finish(resolve, value),
      (error: unknown) => fail(error, true),
    );
  });
}

async function continueModel(
  prepared: CityFrontierPrepared,
  emit: (event: CityFrontierEvent) => void | Promise<void>,
  callerSignal: AbortSignal,
  flights: ContinuationFlights,
  ports: Readonly<CityFrontierApplicationPorts>,
): Promise<CityFrontierReadModel> {
  const preflight = continuePreflight(prepared, ports);
  if (preflight.completed !== undefined) {
    const gated = loadContinueTrust(preflight, ports);
    authenticateContinueChain(preflight, gated.ranking, ports);
    return presentModel(prepared.runId, ports, preflight.completed.id);
  }
  const authority = await loadContinueAuthority(preflight, ports);
  if (nativeSignalAborted(callerSignal)) abortReason(callerSignal);
  const flight = continuationFlight(authority, flights, ports);
  return attachContinuationWaiter(authority, flight, emit, callerSignal, flights, ports);
}

function reconstructFrontierChain(
  runId: string,
  borrowedChain: readonly CityFrontierRevision[],
  ports: Readonly<CityFrontierApplicationPorts>,
): readonly CityFrontierRevision[] {
  const chainValues = ownedJson(borrowedChain) as readonly unknown[];
  if (!Array.isArray(chainValues) || chainValues.length < 1 ||
    chainValues.length > START_VERIFICATION_BUDGET.liveCityCandidateLimit + 1) mismatch();
  const chain = chainValues.map((value) =>
    reconstructCityFrontierRevision(value, ports.decisionIntegrity));
  const root = chain[0];
  if (root === undefined) mismatch();
  if (root.runId !== runId || root.predecessorRevisionId !== undefined ||
    root.kind !== "working" || root.markers.length !== 0 || root.nextUncheckedRank !== 1 ||
    root.phase !== "verification_required" || root.operation.kind !== "start") mismatch();

  for (let index = 1; index < chain.length; index += 1) {
    const previous = chain[index - 1]!;
    const revision = chain[index]!;
    const marker = revision.markers[index - 1];
    if (previous.kind !== "working" || revision.runId !== runId ||
      revision.predecessorRevisionId !== previous.id ||
      revision.rankingSnapshotId !== root.rankingSnapshotId ||
      revision.operation.kind !== "city_completed" ||
      revision.operation.expectedHeadRevisionId !== previous.id ||
      revision.markers.length !== index || revision.nextUncheckedRank !== index + 1 ||
      revision.createdAt < previous.createdAt || marker === undefined || marker.rank !== index ||
      marker.cityId !== revision.operation.cityId || marker.lastCheckedAt !== revision.createdAt ||
      !sameDecision(revision.markers.slice(0, -1), previous.markers,
        ports.decisionIntegrity)) mismatch();
  }
  return Object.freeze(chain);
}

interface ReplayedPresentationGraph {
  readonly readModel: CityFrontierReadModel;
  readonly target: CityFrontierRevision;
  readonly ranking: CityRankingSnapshot;
  readonly preCityBranch: PreCityBranchCommit;
  readonly preCitySource: PreCityBranchSourceProjection;
  readonly frontier: ReconstructCityFrontierInput;
}

function authenticateRevisionCommand(
  revision: CityFrontierRevision,
  ports: Readonly<CityFrontierApplicationPorts>,
): void {
  const borrowedCommand = ports.frontierRead.findCommandVerified(
    revision.runId,
    revision.operation.commandId,
  );
  if (borrowedCommand === undefined) mismatch();
  const envelope = exactRecord(borrowedCommand, ["operation", "revision"]);
  const commandRevision = reconstructCityFrontierRevision(
    envelope.revision,
    ports.decisionIntegrity,
  );
  if (!sameDecision(envelope.operation, revision.operation, ports.decisionIntegrity) ||
    !sameDecision(commandRevision, revision, ports.decisionIntegrity)) mismatch();
}

function authenticateCompletedRevision(
  runId: string,
  revision: CityFrontierRevision,
  index: number,
  ranking: CityRankingSnapshot,
  ports: Readonly<CityFrontierApplicationPorts>,
): void {
  const marker = revision.markers[index - 1];
  const ranked = ranking.ordered[index - 1];
  if (marker === undefined || ranked === undefined || marker.rank !== index ||
    ranked.rank !== index || marker.cityId !== ranked.cityId ||
    revision.operation.kind !== "city_completed" ||
    revision.operation.cityId !== marker.cityId) mismatch();
  const derivedCityCheckRunId = cityCheckRunId(Object.freeze({
    schemaVersion: "city-check-run@1",
    runId,
    cityId: marker.cityId,
    rankingSnapshotId: ranking.id,
  }), ports.decisionIntegrity);
  if (revision.operation.cityCheckRunId !== derivedCityCheckRunId) mismatch();
  authenticateRevisionCommand(revision, ports);
}

function authenticateContinueChain(
  preflight: ContinuePreflight,
  ranking: CityRankingSnapshot,
  ports: Readonly<CityFrontierApplicationPorts>,
): void {
  const chain = reconstructFrontierChain(
    preflight.prepared.runId,
    ports.frontierRead.loadChainVerified(preflight.prepared.runId),
    ports,
  );
  const baseIndex = chain.findIndex(({ id }) => id === preflight.base.id);
  if (baseIndex < 0 ||
    !sameDecision(chain[baseIndex], preflight.base, ports.decisionIntegrity) ||
    (preflight.completed === undefined && baseIndex !== chain.length - 1)) mismatch();
  if (preflight.completed !== undefined) {
    const completed = chain[baseIndex + 1];
    if (completed === undefined ||
      !sameDecision(completed, preflight.completed, ports.decisionIntegrity)) mismatch();
  }
  if (chain[0]!.rankingSnapshotId !== ranking.id) mismatch();
  authenticateRevisionCommand(chain[0]!, ports);
  for (let index = 1; index < chain.length; index += 1) {
    authenticateCompletedRevision(preflight.prepared.runId, chain[index]!, index, ranking, ports);
  }
}

function presentationReadModel(
  graph: ReplayedPresentationGraph,
  selections: CityFrontierReadModel["selections"],
): CityFrontierReadModel {
  return Object.freeze({
    ...graph.readModel,
    selections,
  });
}

async function replayPresentationGraph(
  runId: string,
  chain: readonly CityFrontierRevision[],
  target: CityFrontierRevision,
  requireCurrentCatalog: boolean,
  ports: Readonly<CityFrontierApplicationPorts>,
): Promise<ReplayedPresentationGraph> {
  const root = chain[0];
  const targetIndex = chain.findIndex(({ id }) => id === target.id);
  if (root === undefined || targetIndex < 0 ||
    !sameDecision(chain[targetIndex], target, ports.decisionIntegrity)) mismatch();

  const loadedRanking = loadHistoricalRanking(root.rankingSnapshotId, ports);
  const ranking = loadedRanking.ranking;
  if (ranking.id !== root.rankingSnapshotId || ranking.runId !== runId) mismatch();
  const trust = historicalTrust(
    loadedRanking.borrowedContext,
    ranking,
    ports,
    requireCurrentCatalog,
  );

  const criteria = reconstructCityCriteriaSnapshot(
    ports.criteria.loadCriteriaVerified(ranking.criteriaSnapshotId),
    ports.decisionIntegrity,
  );
  const criteriaPayloadHash = cityCriteriaPayloadHash(criteriaCommandPayload(
    criteria.criteria,
    criteria.profileSnapshotId,
    criteria.preferenceProfileSnapshotId,
  ), ports.decisionIntegrity);
  const derivedRunId = startRunId({
    resolvedCountryShortlistRevisionId: ranking.resolvedCountryShortlistRevisionId,
    countryCode: ranking.countryCode,
  }, trust, criteriaPayloadHash, ports.decisionIntegrity);
  if (criteria.id !== ranking.criteriaSnapshotId ||
    criteria.profileSnapshotId !== ranking.profileSnapshotId ||
    criteria.preferenceProfileSnapshotId !== ranking.preferenceProfileSnapshotId ||
    derivedRunId !== runId || ranking.registryRevisionId !== trust.catalog.registry.id ||
    ranking.catalogRevisionId !== trust.catalog.catalog.id ||
    !sameDecision(ranking.verificationBudget, START_VERIFICATION_BUDGET, ports.decisionIntegrity) ||
    ranking.assessmentAt !== criteria.confirmedAt || ranking.createdAt !== criteria.confirmedAt ||
    root.createdAt !== criteria.confirmedAt || root.operation.kind !== "start" ||
    root.operation.criteriaPayloadHash !== criteriaPayloadHash) {
    mismatch();
  }

  const branch = reconstructPreCityBranchCommit(
    ports.branches.loadPreCityBranchVerified(ranking.preCityBranchCommitId),
    ports.decisionIntegrity,
  );
  const sourceAuthority = await loadHistoricalSourceAuthority(ranking, criteria, trust, ports);
  const replayedBranch = replayPreCityBranchCommit(
    branch,
    sourceAuthority.source,
    ports.decisionIntegrity,
  );
  if (replayedBranch.id !== ranking.preCityBranchCommitId ||
    replayedBranch.createdAt !== sourceAuthority.resolved.createdAt ||
    replayedBranch.createdAt > criteria.confirmedAt) mismatch();

  for (let index = 1; index <= targetIndex; index += 1) {
    const revision = chain[index]!;
    authenticateCompletedRevision(runId, revision, index, ranking, ports);
  }

  const markerKnowledge = loadMarkerKnowledgeCopies(target.markers, ports);
  const knowledge = exactKnowledgeForRanking(ranking, trust, ports);
  verifyCityRankingSnapshotSemantics(ranking, {
    registry: trust.catalog.registry,
    catalog: trust.catalog.catalog,
    criteria,
    knowledge,
    evaluators: trust.evaluatorRegistry,
  }, ports.decisionIntegrity);
  const markerBindings = await replayMarkerBindings(
    runId,
    target.markers,
    markerKnowledge,
    ranking,
    criteria,
    trust,
    ports,
  );
  const frontier: ReconstructCityFrontierInput = Object.freeze({
    ranking: Object.freeze({
      assessmentAt: ranking.assessmentAt,
      orderedCityIds: Object.freeze(ranking.ordered.map(({ cityId }) => cityId)),
      screenedExclusionCityIds: Object.freeze(
        ranking.screenedExclusions.map(({ cityId }) => cityId),
      ),
    }),
    criteria,
    evaluators: trust.evaluatorRegistry,
    predecessorMarkers: target.markers.length === 0
      ? null
      : Object.freeze(target.markers.slice(0, -1)),
    markerBindings,
    persisted: persistedFrontierProjection(target),
  });
  reconstructCityFrontier(frontier);

  const readModel: CityFrontierReadModel = Object.freeze({
    runId,
    assessmentAt: ranking.assessmentAt,
    resolvedCountryShortlistRevisionId: ranking.resolvedCountryShortlistRevisionId,
    countryCode: ranking.countryCode,
    preCityBranchCommitId: replayedBranch.id,
    registry: trust.catalog.registry,
    catalog: trust.catalog.catalog,
    criteria,
    ranking,
    revision: target,
    selections: Object.freeze([]),
  });
  return Object.freeze({
    readModel,
    target,
    ranking,
    preCityBranch: replayedBranch,
    preCitySource: sourceAuthority.source,
    frontier,
  });
}

async function loadCurrentTerminalGraph(
  terminalRevisionId: string,
  ports: Readonly<CityFrontierApplicationPorts>,
): Promise<ReplayedPresentationGraph> {
  const claimed = loadClaimedBase(terminalRevisionId, ports);
  const chain = reconstructFrontierChain(
    claimed.runId,
    ports.frontierRead.loadChainVerified(claimed.runId),
    ports,
  );
  const current = chain.at(-1);
  if (claimed.kind !== "terminal" || current === undefined ||
    !sameDecision(claimed, current, ports.decisionIntegrity)) mismatch();
  return replayPresentationGraph(claimed.runId, chain, claimed, true, ports);
}

async function replaySelectionHistory(
  base: ReplayedPresentationGraph,
  ports: Readonly<CityFrontierApplicationPorts>,
): Promise<CityFrontierReadModel["selections"]> {
  const borrowed = await ports.selectionHistory.listSelectionsWithBranchesVerified(
    base.target.runId,
  );
  const values = ownedJson(borrowed) as readonly unknown[];
  if (!Array.isArray(values)) mismatch();
  const selections = [];
  for (const value of values) {
    const pair = exactRecord(value, ["selection", "commit"]);
    const selection = exactRecord(pair.selection, [
      "schemaVersion", "id", "commandId", "runId", "terminalRevisionId", "cityId",
      "countryCode", "profileSnapshotId", "preferenceProfileSnapshotId",
      "resolvedCountryShortlistRevisionId", "criteriaSnapshotId", "rankingSnapshotId",
      "preCityBranchCommitId", "selectedMarkerDigest", "knowledgeRevisionId",
      "evidenceSnapshotId", "unknownBasis",
      ...(Object.prototype.hasOwnProperty.call(pair.selection, "warningCopyVersion")
        ? ["warningCopyVersion"]
        : []),
      "createdAt",
    ]);
    if (selection.runId !== base.target.runId ||
      selection.terminalRevisionId !== base.target.id ||
      selection.rankingSnapshotId !== base.ranking.id) mismatch();
    const authority = await loadCurrentTerminalGraph(identifier(selection.terminalRevisionId), ports);
    const request = selection.warningCopyVersion === undefined
      ? Object.freeze({ cityId: identifier(selection.cityId) })
      : Object.freeze({
          cityId: identifier(selection.cityId),
          warningCopyVersion: selection.warningCopyVersion,
        });
    reconstructCitySelection({ frontier: authority.frontier, request });
    selections.push(reconstructCitySelectionWithBranch(value, {
      terminal: authority.target as TerminalCityShortlistSnapshot,
      ranking: authority.ranking,
      preCityBranch: authority.preCityBranch,
    }, ports.decisionIntegrity));
  }
  return Object.freeze(selections);
}

async function presentModel(
  runId: string,
  ports: Readonly<CityFrontierApplicationPorts>,
  targetRevisionId?: string,
): Promise<CityFrontierReadModel> {
  const chain = reconstructFrontierChain(
    runId,
    ports.frontierRead.loadChainVerified(runId),
    ports,
  );
  const target = targetRevisionId === undefined
    ? chain.at(-1)
    : chain.find(({ id }) => id === targetRevisionId);
  if (target === undefined) mismatch();
  const graph = await replayPresentationGraph(runId, chain, target, false, ports);
  const selections = target.kind === "terminal"
    ? await replaySelectionHistory(graph, ports)
    : Object.freeze([]);
  return presentationReadModel(graph, selections);
}

async function loadCurrentTerminalSelectionAuthority(
  terminalRevisionId: string,
  ports: Readonly<CityFrontierApplicationPorts>,
): Promise<VerifiedCityTerminalSelectionAuthority> {
  const graph = await loadCurrentTerminalGraph(terminalRevisionId, ports);
  if (graph.target.kind !== "terminal") mismatch();
  const selections = await replaySelectionHistory(graph, ports);
  return Object.freeze({
    readModel: presentationReadModel(graph, selections),
    terminal: graph.target,
    ranking: graph.ranking,
    preCityBranch: graph.preCityBranch,
    preCitySource: graph.preCitySource,
    frontier: graph.frontier,
  });
}

export function createCityFrontierApplication(
  ports: CityFrontierApplicationPorts,
): Readonly<CityFrontierApplicationAssembly> {
  const captured = capturePorts(ports);
  const continuationFlights: ContinuationFlights = new Map();
  const application: Readonly<CityFrontierApplication> = Object.freeze({
    presentCityFrontierSetup: async (
      input: Parameters<CityFrontierApplication["presentCityFrontierSetup"]>[0],
    ) =>
      setupModel(inputSetup(input), captured),
    startCityFrontier: async (input: StartCityFrontierInput) =>
      startModel(inputStart(input), captured),
    prepareCityFrontierContinuation: async (input: PrepareCityFrontierContinuationInput) =>
      prepareModel(inputPrepare(input), captured),
    continueCityFrontier: async (
      prepared: CityFrontierPrepared,
      emit: (event: CityFrontierEvent) => void | Promise<void>,
      signal: AbortSignal,
    ) => {
      const ownedPrepared = inputPrepared(prepared);
      if (typeof emit !== "function" || isBorrowedProxy(emit) ||
        isBorrowedProxy(signal) || !(signal instanceof AbortSignal)) mismatch();
      return continueModel(ownedPrepared, emit, signal, continuationFlights, captured);
    },
    presentCityFrontier: async (runId: string) => presentModel(identifier(runId), captured),
  });
  const selectionAuthority: Readonly<CityFrontierSelectionAuthorityPort> = Object.freeze({
    loadCurrentTerminalSelectionAuthority: async (terminalRevisionId: string) =>
      loadCurrentTerminalSelectionAuthority(identifier(terminalRevisionId), captured),
  });
  return Object.freeze({ application, selectionAuthority });
}
