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
  cityCriteriaPayloadHash,
  cityFrontierRunId,
  isBorrowedProxy,
  type CityCriteriaCommandPayload,
} from "./city-data-contracts";
import type {
  CityBranchReadPort,
  CityCriteriaReadPort,
  CityFrontierAppendPort,
  CityFrontierEvent,
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
  sealCityFrontierRevision,
  sealCityRankingSnapshot,
  verifyCityRankingSnapshotSemantics,
} from "./city-frontier-contracts";
import type {
  CitySafetyOfficialDocumentPort,
  CitySafetySearchPort,
} from "./city-safety-contracts";
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
  type CityCriterionEvaluatorRegistry,
  type CityCriterionDraft,
  type CityCriterionId,
  type InstalledCityCriterionDefinitionTuple,
} from "../decision/city-criteria";
import type { CityDecisionIntegrity } from "../decision/city-integrity";
import {
  reconstructCityFrontier,
  type CityFrontierVerificationBudget,
  type ReconstructCityFrontierInput,
} from "../decision/city-frontier-policy";
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
  CityFixedDeadlineScheduler,
  CityFixedEvidenceClaim,
  CityFixedRoutePort,
} from "../research/city-evidence";
import {
  reconstructCityFixedSourcePlan,
  SLOVENIA_CITY_FIXED_CRITERION_BY_SOURCE,
  type SloveniaCityFixedSourceId,
} from "../research/city-evidence";
import type { EvidenceIntegrity } from "../research/research-plan";
import {
  projectCityKnowledgeForRanking,
  type CityKnowledgeRevision,
} from "../research/city-knowledge";
import { getCityResearchPackageAvailability } from "../research/city-package";
import {
  reconstructCitySafetySourcePlan,
  reconstructOfficialAuthorityDirectory,
} from "../research/city-safety-source-plan";

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
  const replay = exactRecord(root.evidenceReplay, ["read", "integrity", "package"]);
  const replayRead = replay.read === root.evidence
    ? evidence
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
  const payloadHash = evidenceDigest(payload, evidenceIntegrity);
  if (manifest.payloadHash !== payloadHash || manifest.id !== `installed-city-package-manifest:${payloadHash}` ||
    typeof manifest.hmac !== "string" || !SHA256.test(manifest.hmac) ||
    installed.installedPackageManifest.id !== manifest.id ||
    !sameDecision(manifest.key, context, decisionIntegrity) ||
    !sameDecision(payload.definition, ready.definition, decisionIntegrity) ||
    !sameDecision(payload.definition, installed.definition, decisionIntegrity) ||
    payload.sourceContractStatus !== ready.sourceContractStatus ||
    payload.sourceContractStatus !== installed.sourceContractStatus ||
    !sameDecision(payload.readiness, ready.readiness, decisionIntegrity) ||
    !sameDecision(payload.readiness, installed.readiness, decisionIntegrity) ||
    payload.schemaVersion !== "installed-city-package-manifest@1") mismatch();
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

async function presentModel(
  runId: string,
  ports: Readonly<CityFrontierApplicationPorts>,
): Promise<CityFrontierReadModel> {
  const borrowedChain = ports.frontierRead.loadChainVerified(runId);
  const chain = ownedJson(borrowedChain) as readonly unknown[];
  if (!Array.isArray(chain) || chain.length !== 1) mismatch();
  const root = reconstructCityFrontierRevision(chain[0], ports.decisionIntegrity);
  if (root.runId !== runId || root.predecessorRevisionId !== undefined ||
    root.kind !== "working" || root.markers.length !== 0 || root.nextUncheckedRank !== 1 ||
    root.phase !== "verification_required" || root.operation.kind !== "start") mismatch();

  const borrowedRanking = ports.rankings.loadRankingVerified(root.rankingSnapshotId);
  if (borrowedRanking === null || typeof borrowedRanking !== "object" ||
    isBorrowedProxy(borrowedRanking) || !Object.isFrozen(borrowedRanking)) mismatch();
  const contextDescriptor = Object.getOwnPropertyDescriptor(
    borrowedRanking,
    "installedPackageContext",
  );
  if (contextDescriptor === undefined || !("value" in contextDescriptor) ||
    !contextDescriptor.enumerable) mismatch();
  const borrowedContext = contextDescriptor.value as InstalledCityPackageExactKey;
  const ranking = reconstructCityRankingSnapshot(borrowedRanking, ports.decisionIntegrity);
  if (ranking.id !== root.rankingSnapshotId || ranking.runId !== runId) mismatch();
  const trust = historicalTrust(borrowedContext, ranking, ports);

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
    root.createdAt !== criteria.confirmedAt || root.operation.criteriaPayloadHash !== criteriaPayloadHash) {
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

  const knowledge = exactKnowledgeForRanking(ranking, trust, ports);
  verifyCityRankingSnapshotSemantics(ranking, {
    registry: trust.catalog.registry,
    catalog: trust.catalog.catalog,
    criteria,
    knowledge,
    evaluators: trust.evaluatorRegistry,
  }, ports.decisionIntegrity);
  reconstructCityFrontier({
    ranking: {
      assessmentAt: ranking.assessmentAt,
      orderedCityIds: ranking.ordered.map(({ cityId }) => cityId),
      screenedExclusionCityIds: ranking.screenedExclusions.map(({ cityId }) => cityId),
    },
    criteria,
    evaluators: trust.evaluatorRegistry,
    predecessorMarkers: null,
    markerBindings: [],
    persisted: {
      kind: "working",
      nextUncheckedRank: root.nextUncheckedRank,
      selectableCityIds: [],
      phase: root.phase,
    },
  });

  const selections = ownedJson(
    await ports.selectionHistory.listSelectionsWithBranchesVerified(runId),
  ) as CityFrontierReadModel["selections"];
  if (!Array.isArray(selections) || selections.length !== 0) mismatch();
  return Object.freeze({
    runId,
    assessmentAt: ranking.assessmentAt,
    resolvedCountryShortlistRevisionId: ranking.resolvedCountryShortlistRevisionId,
    countryCode: ranking.countryCode,
    preCityBranchCommitId: replayedBranch.id,
    registry: trust.catalog.registry,
    catalog: trust.catalog.catalog,
    criteria,
    ranking,
    revision: root,
    selections,
  });
}

function notImplemented(): Promise<never> {
  return Promise.reject(new Error("city_frontier_not_implemented"));
}

export function createCityFrontierApplication(
  ports: CityFrontierApplicationPorts,
): Readonly<CityFrontierApplicationAssembly> {
  const captured = capturePorts(ports);
  const application: Readonly<CityFrontierApplication> = Object.freeze({
    presentCityFrontierSetup: (input: Parameters<CityFrontierApplication["presentCityFrontierSetup"]>[0]) =>
      setupModel(inputSetup(input), captured),
    startCityFrontier: (input: StartCityFrontierInput) => startModel(inputStart(input), captured),
    prepareCityFrontierContinuation: () => { void captured; return notImplemented(); },
    continueCityFrontier: () => { void captured; return notImplemented(); },
    presentCityFrontier: (runId: string) => presentModel(identifier(runId), captured),
  });
  const selectionAuthority: Readonly<CityFrontierSelectionAuthorityPort> = Object.freeze({
    loadCurrentTerminalSelectionAuthority: () => { void captured; return notImplemented(); },
  });
  return Object.freeze({ application, selectionAuthority });
}
