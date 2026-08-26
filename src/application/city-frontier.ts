import type {
  CityCatalogStorePort,
  CityEvidenceReplayPorts,
  CityEvidenceStorePort,
  CityKnowledgeStorePort,
  InstalledCityCatalogReadPort,
  InstalledCityPackageLookupPort,
  InstalledCityPackageManifestStorePort,
} from "./city-data-contracts";
import { isBorrowedProxy } from "./city-data-contracts";
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
  CitySelectionHistoryReadPort,
  TerminalCityShortlistSnapshot,
} from "./city-frontier-contracts";
import type {
  CitySafetyOfficialDocumentPort,
  CitySafetySearchPort,
} from "./city-safety-contracts";
import type { ResolvedCountryShortlistSnapshot } from "./country-resolution-contracts";
import type { PreCityBranchCommit, PreCityBranchSourceProjection } from "../branch/city";
import {
  CITY_CATALOG_RULES_VERSION,
  reconstructVerifiedCityCatalog,
  type CityCatalogRevision,
  type CityCatalogProjection,
} from "../decision/city-catalog";
import {
  CITY_CRITERION_IDS,
  deriveCityCriteriaDraft,
  reconstructInstalledCityCriteriaDefaults,
  reconstructInstalledCityCriterionDefinitions,
  type CityCriterionEvaluatorRegistry,
  type CityCriterionDraft,
  type CityCriterionId,
  type InstalledCityCriterionDefinitionTuple,
} from "../decision/city-criteria";
import type { CityDecisionIntegrity } from "../decision/city-integrity";
import type { ReconstructCityFrontierInput } from "../decision/city-frontier-policy";
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

async function setupModel(
  input: Readonly<{ resolvedCountryShortlistRevisionId: string; countryCode: string }>,
  ports: Readonly<CityFrontierApplicationPorts>,
): Promise<CityFrontierSetupReadModel> {
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
    resolvedCountryShortlistRevisionId: resolved.id,
    countryCode: input.countryCode,
    profileSnapshotId: relocation.id,
    preferenceProfileSnapshotId: preference.id,
    resolvedCountryEntry: entries[0]!,
    installedPackageContext: trust.context,
    registryRevisionId: trust.catalog.registry.id,
    catalogMemberCount: memberCount,
    catalogCoverage: trust.catalog.catalog.coverage,
    criterionDefinitions: trust.criterionDefinitions,
    criteriaDraft,
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
    startCityFrontier: async (input: StartCityFrontierInput) => {
      const owned = inputStart(input);
      await setupModel({
        resolvedCountryShortlistRevisionId: owned.resolvedCountryShortlistRevisionId,
        countryCode: owned.countryCode,
      }, captured);
      return notImplemented();
    },
    prepareCityFrontierContinuation: () => { void captured; return notImplemented(); },
    continueCityFrontier: () => { void captured; return notImplemented(); },
    presentCityFrontier: () => { void captured; return notImplemented(); },
  });
  const selectionAuthority: Readonly<CityFrontierSelectionAuthorityPort> = Object.freeze({
    loadCurrentTerminalSelectionAuthority: () => { void captured; return notImplemented(); },
  });
  return Object.freeze({ application, selectionAuthority });
}
