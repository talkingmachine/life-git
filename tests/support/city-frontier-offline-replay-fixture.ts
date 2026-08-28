import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type Database from "better-sqlite3";

import {
  createCityFrontierApplication,
  type CityFrontierApplicationPorts,
  type CityFrontierFixedRoutePorts,
} from "../../src/application/city-frontier";
import type { CityFrontierReadModel } from
  "../../src/application/city-frontier-contracts";
import type { CityFixedAttemptLedgerTuple } from
  "../../src/application/city-data-contracts";
import { createCitySelectionApplication } from
  "../../src/application/city-selection";
import type {
  CitySafetyOfficialDocumentPort,
  CitySafetySearchPort,
} from "../../src/application/city-safety-contracts";
import { createCountryResolutionApplication } from
  "../../src/application/country-resolution";
import {
  countryCheckRunId,
  type CountryVerificationResult,
  type CountryVerifierPort,
} from "../../src/application/country-verifier";
import { installCityPackage } from "../../src/application/install-city-package";
import {
  createPlaceFrontierApplication,
  type PlaceFrontierApplicationPorts,
} from "../../src/application/place-frontier";
import type { ApprovedCityCriteriaDefaultsRegistry } from
  "../../src/decision/approved-city-criteria-defaults";
import {
  buildCityCatalogRevision,
  buildCityRegistryRevision,
} from "../../src/decision/city-catalog";
import {
  CITY_CRITERION_IDS,
  type CityCriterionEvaluation,
  type CityCriterionEvaluationInput,
  type CityCriterionEvaluatorRegistry,
  type InstalledCityCriteriaDefaults,
  type InstalledCityCriterionDefinitionTuple,
} from "../../src/decision/city-criteria";
import type { FormalResidenceVerdict } from
  "../../src/decision/formal-residence-verdict";
import { rankPlaces, type RankedPlace } from "../../src/decision/place-ranker";
import type { PreferenceProfileDraft } from
  "../../src/decision/preference-profile";
import type { RelocationProfileDraft } from
  "../../src/decision/relocation-profile";
import {
  createCityDecisionIntegrityView,
  createCityEvidenceReplayIntegrity,
  createEvidenceIntegrity,
} from "../../src/infrastructure/integrity";
import {
  InstalledCityPackages,
  type InstalledCityPackageBehaviorRegistry,
} from "../../src/infrastructure/sources/installed-city-packages";
import { SqliteCityBranchStore } from
  "../../src/infrastructure/sqlite/city-branch-store";
import { SqliteCityCatalogStore } from
  "../../src/infrastructure/sqlite/city-catalog-store";
import { SqliteCityCriteriaStore } from
  "../../src/infrastructure/sqlite/city-criteria-store";
import { SqliteCityEvidenceStore } from
  "../../src/infrastructure/sqlite/city-evidence-store";
import { SqliteCityFrontierStore } from
  "../../src/infrastructure/sqlite/city-frontier-store";
import { SqliteCityKnowledgeStore } from
  "../../src/infrastructure/sqlite/city-knowledge-store";
import { SqliteCityPackageManifestStore } from
  "../../src/infrastructure/sqlite/city-package-manifest-store";
import { SqliteCitySelectionWriter } from
  "../../src/infrastructure/sqlite/city-selection-writer";
import { SqliteCountryResolutionStore } from
  "../../src/infrastructure/sqlite/country-resolution-store";
import { openEvidenceDatabase } from "../../src/infrastructure/sqlite/db";
import { SqliteAdministrativeEvidenceStore } from
  "../../src/infrastructure/sqlite/evidence-store";
import { SqlitePlaceFrontierStore } from
  "../../src/infrastructure/sqlite/place-frontier-store";
import { SqliteProfileStore } from
  "../../src/infrastructure/sqlite/profile-store";
import { createCitySafetySearchPort } from
  "../../src/infrastructure/sources/city-safety-search-adapter";
import { createHttpCitySafetySearchStep } from
  "../../src/infrastructure/sources/http-city-safety-search-step";
import type { LiveCapturedArtifact, ParserEntry } from
  "../../src/research/contracts";
import {
  type CityFixedDeadlineScheduler,
  type CityFixedEvidenceClaim,
  type CityFixedRoutePort,
  type CityFixedSourcePlan,
  type SloveniaCityFixedSourceId,
} from "../../src/research/city-evidence";
import {
  getCityResearchPackageAvailability,
  type InstalledCityResearchPackage,
} from "../../src/research/city-package";
import {
  buildCitySafetySourcePlan,
  buildOfficialAuthorityDirectory,
} from "../../src/research/city-safety-source-plan";
import type { CitySafetyAttemptLedger } from
  "../../src/research/city-safety-evidence";
import { SLOVENIA_CITY_FACT_VERSIONS } from
  "../../src/research/slovenia-city-plan";

const HMAC_KEY = "task19a-city-frontier-offline-replay-key-at-least-32-bytes";
const PRIVATE_SENTINEL = "task19a-live-boundary-sentinel";
const PRIVATE_SEARCH_TOKEN = "task19a-private-search-token";
const START_AT = "2026-08-25T12:00:00.000Z";
const COUNTRY_AT = "2026-08-24T12:00:00.000Z";
const COUNTRY_DAY = "2026-08-24";
const CITY_IDS = ["ljubljana", "maribor"] as const;
const FIXED_SOURCE_IDS = [
  "si-city-long-term-rent",
  "si-city-urban-transit",
  "si-city-fixed-broadband",
] as const;
const RAW_TABLE_NAMES: readonly OfflineReplayTableName[] = [
  "city_catalog_revisions",
  "city_criteria_snapshots",
  "city_evidence_snapshots",
  "city_knowledge_revisions",
  "city_ranking_snapshots",
  "city_frontier_revisions",
  "city_selection_snapshots",
  "city_branch_commits",
  "evidence_snapshots",
  "artifacts",
];

export type OfflineReplayTableName =
  | "city_catalog_revisions"
  | "city_criteria_snapshots"
  | "city_evidence_snapshots"
  | "city_knowledge_revisions"
  | "city_ranking_snapshots"
  | "city_frontier_revisions"
  | "city_selection_snapshots"
  | "city_branch_commits"
  | "evidence_snapshots"
  | "artifacts";

export interface OfflineReplayEvidenceLedger {
  readonly id: string;
  readonly fixedAttemptLedgers: CityFixedAttemptLedgerTuple;
  readonly safetyAttemptLedger: CitySafetyAttemptLedger;
}

export type OfflineReplayRawCell =
  | Readonly<{ readonly kind: "null" }>
  | Readonly<{ readonly kind: "text"; readonly value: string }>
  | Readonly<{ readonly kind: "number"; readonly value: string }>
  | Readonly<{ readonly kind: "blob"; readonly hex: string }>;

export type OfflineReplayRawRow = Readonly<Record<string, OfflineReplayRawCell>>;

export interface OfflineReplayBoundaryCounters {
  readonly fixedRoutes: Readonly<{
    readonly "si-city-long-term-rent": number;
    readonly "si-city-urban-transit": number;
    readonly "si-city-fixed-broadband": number;
  }>;
  readonly safetyDocuments: number;
  readonly safetySearch: number;
  readonly rawSafetySearchRequests: number;
  readonly clock: number;
  readonly scheduler: number;
}

export type CityFrontierOfflineReplaySelectionScenario =
  | "single-yellow"
  | "two-yellow-siblings";

export interface CityFrontierOfflineReplayProof {
  readonly savedCompletion: CityFrontierReadModel;
  readonly presentations: readonly [CityFrontierReadModel, CityFrontierReadModel];
  readonly evidenceBeforeClose: readonly OfflineReplayEvidenceLedger[];
  readonly evidenceAfterReopen: readonly OfflineReplayEvidenceLedger[];
  readonly rowsBefore: Readonly<Record<
    OfflineReplayTableName,
    readonly OfflineReplayRawRow[]
  >>;
  readonly rowsAfter: Readonly<Record<
    OfflineReplayTableName,
    readonly OfflineReplayRawRow[]
  >>;
  readonly counters: OfflineReplayBoundaryCounters;
  readonly queryOnly: number;
  readonly integrityCheck: readonly string[];
  readonly foreignKeyViolations: readonly unknown[];
  readonly totalChangesBefore: number;
  readonly totalChangesAfter: number;
  readonly databasePath: string;
  readonly privateSentinel: string;
  readonly privateSearchToken: string;
  canonical(value: unknown): string;
  cleanup(): void;
}

function freezeDeep<T>(value: T, seen = new Set<object>()): T {
  if (value === null || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) freezeDeep(child, seen);
  return Object.freeze(value);
}

function temporaryDatabase(): Readonly<{
  directory: string;
  writerPath: string;
  replayPath: string;
}> {
  const directory = mkdtempSync(join(tmpdir(), "city-frontier-offline-replay-"));
  return {
    directory,
    writerPath: join(directory, "writer.sqlite"),
    replayPath: join(directory, "replay.sqlite"),
  };
}

const RELOCATION_PROFILE: RelocationProfileDraft = {
  currentCountryCode: "RU",
  citizenships: ["RU"],
  monthlyIncome: { amount: "250000", currency: "RUB", basis: "net" },
  remoteWork: { relation: "foreign_employment", legallyAllowed: true },
  education: "higher",
  relevantExperienceYears: 5,
  passportValidUntil: "2030-01-01",
  healthInsurance: "confirmed",
  companions: [],
};

const PREFERENCE_PROFILE: PreferenceProfileDraft = {
  criteria: [{
    id: "personal_safety",
    mode: "weighted",
    importance: 5,
    target: "maximize",
  }],
};

function rankedSlovenia(): RankedPlace {
  return {
    countryCode: "SI",
    label: "Slovenia",
    flag: "🇸🇮",
    coordinate: { lat: 46.1512, lng: 14.9955 },
    factors: [{
      criterionId: "personal_safety",
      state: "known",
      match: "1",
      observationId: "observation-si",
      evaluatorVersion: "task19a-place-factor@1",
    }],
    rank: 1,
    relevance: "1",
    coverage: "1",
    contributions: [{
      criterionId: "personal_safety",
      state: "known",
      effectiveMatch: "1",
      weightedContribution: "5",
      observationId: "observation-si",
    }],
  };
}

function greenResidenceVerdict(
  profileSnapshotId: string,
  evidenceSnapshotId: string,
): FormalResidenceVerdict {
  const reference = {
    evidenceSnapshotId,
    artifactId: "task19a-place-artifact-si",
    sourceId: "task19a-place-source-si",
    navigationUrl: "https://gov.example.test/si",
    resolvedEvidenceUrl: "https://gov.example.test/si/rule.pdf",
    sourcePeriod: "2026-08",
    locator: "section-si",
    excerptSha256: "a".repeat(64),
    validatorVersion: "task19a-place-validator@1",
  };
  const reason = {
    code: "si_route_viable",
    summary: "Slovenia route is viable",
    claimIds: ["task19a-place-claim-si"],
    evidence: [reference],
    navigation: [],
  };
  return {
    rulesVersion: "formal-residence@1",
    marker: "green",
    verdictAsOf: COUNTRY_DAY,
    routeOutcomes: [{
      routeId: "task19a-route-si",
      status: "viable",
      ruleEffectiveFrom: "2026-01-01",
      reasons: [reason],
      evidenceSnapshotIds: [evidenceSnapshotId],
      proceduralActions: [],
      contingentActions: [],
    }],
    reasons: [reason],
    catalogCompleteness: {
      status: "unproven",
      reasonCode: "catalog_completeness_unprovable",
    },
  };
}

async function seedResolvedCountry(database: Database.Database) {
  const integrity = createEvidenceIntegrity(HMAC_KEY);
  const profiles = new SqliteProfileStore(database);
  const placeStore = new SqlitePlaceFrontierStore(database, HMAC_KEY, profiles);
  const verificationResults = new Map<string, CountryVerificationResult>();
  const verifier: CountryVerifierPort = {
    async check({ country, profileId, parentRunId }) {
      const evidenceSnapshotId = `task19a-place-evidence:${parentRunId}:${country.countryCode}`;
      const result: CountryVerificationResult = {
        countryCheckRunId: countryCheckRunId(parentRunId, country.countryCode, integrity),
        verdict: greenResidenceVerdict(profileId, evidenceSnapshotId),
        evidenceSnapshotId,
        sourceAssessmentRulesVersion: "cold-start-assessment@1",
        lastCheckedAt: COUNTRY_DAY,
      };
      verificationResults.set(result.countryCheckRunId, result);
      return result;
    },
    async present({ parentRunId, countryCode, countryCheckRunId: childRunId }) {
      if (childRunId !== countryCheckRunId(parentRunId, countryCode, integrity)) {
        throw new Error("integrity_mismatch");
      }
      const result = verificationResults.get(childRunId);
      if (result === undefined) throw new Error("evidence_not_found");
      return {
        verdict: result.verdict,
        evidenceSnapshotId: result.evidenceSnapshotId,
        sourceAssessmentRulesVersion: "cold-start-assessment@1" as const,
        lastCheckedAt: result.lastCheckedAt,
      };
    },
  };
  const placePorts: PlaceFrontierApplicationPorts = {
    profiles,
    rankingInputs: {
      freezeCurrent: async () => ({
        places: [rankedSlovenia()],
        knowledgeRevisionIds: { SI: null },
      }),
    },
    rank: rankPlaces,
    store: placeStore,
    knowledge: {
      loadVerified: async () => { throw new Error("unexpected_place_knowledge_load"); },
    },
    verifier,
    integrity,
    clock: () => new Date(COUNTRY_AT),
    nextRunId: () => "task19a-place-frontier-run",
  };
  const frontier = createPlaceFrontierApplication(placePorts);
  const prepared = await frontier.preparePlaceFrontier({
    profile: RELOCATION_PROFILE,
    preferences: PREFERENCE_PROFILE,
  });
  const automatic = await frontier.runPlaceFrontier(
    prepared,
    () => undefined,
    new AbortController().signal,
  );
  const countryStore = new SqliteCountryResolutionStore(database, HMAC_KEY);
  const resolution = createCountryResolutionApplication({
    frontier,
    store: countryStore,
    verifier,
    integrity,
    clock: () => new Date(COUNTRY_AT),
  });
  const started = await resolution.startCountryResolution({
    automaticShortlistSnapshotId: automatic.shortlistSnapshot.id,
  });
  if (started.revision.kind !== "resolved" ||
    started.revision.resolvedEntries.length !== 1 ||
    started.revision.resolvedEntries[0]!.countryCode !== "SI") {
    throw new Error("task19a_resolved_country_fixture_failed");
  }
  return { integrity, profiles, resolution, resolved: started.revision };
}

interface PolicyCalls {
  readonly evaluations: CityCriterionEvaluationInput[];
}

function evaluatorRegistry(calls: PolicyCalls): CityCriterionEvaluatorRegistry {
  return Object.fromEntries(CITY_CRITERION_IDS.map((criterionId) => [criterionId, {
    definition: {
      criterionId,
      definitionId: criterionId === "long_term_rent" ? "rent@1" :
        criterionId === "urban_transit" ? "transit@1" :
          criterionId === "fixed_broadband" ? "broadband@1" :
            "si-municipal-police-offences-per-100000@1",
      direction: criterionId === "safety" || criterionId === "long_term_rent"
        ? "at_most" as const
        : "at_least" as const,
      unit: criterionId === "safety" ? "offences_per_100000_residents" : "unit",
      denominator: criterionId === "safety"
        ? "municipality_population_january_1"
        : "municipality",
      compatibleGeoScopes: ["municipality"],
      freshnessPolicyVersion: criterionId === "safety"
        ? "municipal-annual-july-boundary@1"
        : "annual@1",
      evaluatorVersion: `task19a-${criterionId}-evaluator@1`,
    },
    canonicalizeTarget(target: unknown): string {
      if (typeof target !== "string" || !/^\d+(?:\.\d+)?$/.test(target)) {
        throw new Error("invalid_target");
      }
      return target;
    },
    evaluate(input: CityCriterionEvaluationInput): CityCriterionEvaluation {
      calls.evaluations.push(structuredClone(input));
      return input.fact.outcome.kind === "unknown"
        ? {
            state: "unknown",
            factor: "0",
            targetComparison: "unknown",
            unknownReason: input.fact.outcome.reason,
          }
        : { state: "verified", factor: "1", targetComparison: "matches" };
    },
  }])) as unknown as CityCriterionEvaluatorRegistry;
}

function fixedPlan<S extends SloveniaCityFixedSourceId>(
  sourceId: S,
  cityId: typeof CITY_IDS[number],
): CityFixedSourcePlan<S> {
  const criterionId = sourceId === "si-city-long-term-rent"
    ? "long_term_rent"
    : sourceId === "si-city-urban-transit" ? "urban_transit" : "fixed_broadband";
  const definitionId = criterionId === "long_term_rent" ? "rent@1" :
    criterionId === "urban_transit" ? "transit@1" : "broadband@1";
  const officialAreaId = cityId === "ljubljana" ? "061" : "070";
  return {
    planId: `${cityId}:${sourceId}:task19a-plan@1`,
    sourceId,
    cityId,
    criterionId,
    definitionId,
    claimContract: {
      sourceId,
      criterionId,
      definitionId,
      scope: `municipality:${cityId}`,
      officialAreaId,
      geoScope: "municipality",
      unit: "unit",
      denominator: "municipality",
      freshnessPolicyVersion: "annual@1",
      valueKind: "canonical_scalar",
      valuePolicyVersion: "canonical-scalar@1",
      sourcePeriodPolicyVersion: "annual-period@1",
    },
    routes: ["primary", "secondary"].map((route) => ({
      routeId: `${cityId}:${sourceId}:${route}`,
      navigationUrl: `https://official.example/${cityId}/${sourceId}/${route}`,
    })),
    parserVersion: SLOVENIA_CITY_FACT_VERSIONS[sourceId].parserVersion,
    rulesVersion: SLOVENIA_CITY_FACT_VERSIONS[sourceId].rulesVersion,
  } as unknown as CityFixedSourcePlan<S>;
}

function authorityPublisher(
  publisherId: string,
  authorityKind: "police" | "government" | "open_data" | "statistics" | "municipality",
  navigationUrl: string,
) {
  return {
    publisherId,
    authorityKind,
    navigationUrl,
    allowedHosts: [new URL(navigationUrl).hostname],
    delegatedDocumentHosts: [],
    allowedMediaTypes: ["application/pdf"],
    maxBytes: 1_000_000,
    redirectPolicyVersion: "official-chain@1" as const,
    documentLocatorPolicyId: `${publisherId}-locator@1`,
    retentionPolicyId: `${publisherId}-retention@1`,
    retentionMode: "seal_raw_artifact" as const,
  };
}

async function installSyntheticCityPackage(
  database: Database.Database,
  evidenceIntegrity: ReturnType<typeof createEvidenceIntegrity>,
) {
  const decisionIntegrity = createCityDecisionIntegrityView(evidenceIntegrity);
  const available = getCityResearchPackageAvailability("SI");
  if (available === undefined) throw new Error("task19a_package_definition_missing");
  const ready = freezeDeep({
    definition: structuredClone(available.definition),
    sourceContractStatus: "bounded_verified_or_unknown" as const,
    readiness: { status: "ready" as const, issues: [] as const },
  });
  const registry = buildCityRegistryRevision({
    packageId: ready.definition.packageId,
    packageSchemaVersion: ready.definition.packageSchemaVersion,
    countryCode: "SI",
    evidenceSnapshotId: "task19a-catalog-evidence",
    entries: [{
      cityId: "ljubljana",
      countryCode: "SI",
      officialName: "Ljubljana",
      coordinate: { lat: 46.0569, lng: 14.5058 },
      administrativeType: "central_urban_settlement",
      administrativeTerritory: "Mestna občina Ljubljana",
      capitalRoles: ["national"],
      evidenceReferenceIds: ["task19a-catalog-evidence"],
    }, {
      cityId: "maribor",
      countryCode: "SI",
      officialName: "Maribor",
      coordinate: { lat: 46.5547, lng: 15.6459 },
      administrativeType: "central_urban_settlement",
      administrativeTerritory: "Mestna občina Maribor",
      capitalRoles: [],
      evidenceReferenceIds: ["task19a-catalog-evidence"],
    }],
    createdAt: COUNTRY_AT,
  }, decisionIntegrity);
  const catalog = buildCityCatalogRevision({
    registry,
    evidenceSnapshotId: registry.evidenceSnapshotId,
    populationDefinition: {
      definitionId: "surs-settlement-population@1",
      geoScope: "settlement",
      unit: "people",
    },
    candidateBasis: [{
      cityId: "ljubljana",
      comparablePopulation: { kind: "verified", value: "300000", referencePeriod: "2025" },
    }, {
      cityId: "maribor",
      comparablePopulation: { kind: "verified", value: "114000", referencePeriod: "2025" },
    }],
    coverage: { status: "complete" },
    createdAt: COUNTRY_AT,
  }, decisionIntegrity);
  const fixedPlansByCityId = Object.fromEntries(CITY_IDS.map((cityId) => [cityId, [
    fixedPlan("si-city-long-term-rent", cityId),
    fixedPlan("si-city-urban-transit", cityId),
    fixedPlan("si-city-fixed-broadband", cityId),
  ]])) as unknown as InstalledCityResearchPackage["fixedPlansByCityId"];
  const officialAuthorityDirectory = buildOfficialAuthorityDirectory({
    schemaVersion: "official-authority-directory@1",
    countryCode: "SI",
    catalogRevisionId: catalog.id,
    requiredPublisherIds: { police: "police", gov: "gov", opsi: "opsi", surs: "surs" },
    publishers: [
      authorityPublisher("municipality-ljubljana", "municipality", "https://ljubljana.si/"),
      authorityPublisher("municipality-maribor", "municipality", "https://maribor.si/"),
      authorityPublisher("police", "police", "https://policija.si/"),
      authorityPublisher("gov", "government", "https://gov.si/"),
      authorityPublisher("opsi", "open_data", "https://podatki.gov.si/"),
      authorityPublisher("surs", "statistics", "https://pxweb.stat.si/"),
    ],
    municipalities: [{
      cityId: "ljubljana",
      settlementCode: "061001",
      municipalityCode: "061",
      officialCityNames: ["Ljubljana"],
      officialMunicipalityNames: ["Mestna občina Ljubljana"],
      publisherId: "municipality-ljubljana",
      officialHost: "ljubljana.si",
    }, {
      cityId: "maribor",
      settlementCode: "070001",
      municipalityCode: "070",
      officialCityNames: ["Maribor"],
      officialMunicipalityNames: ["Mestna občina Maribor"],
      publisherId: "municipality-maribor",
      officialHost: "maribor.si",
    }],
    rulesVersion: "slovenia-official-authorities@1",
  }, decisionIntegrity);
  const safetySourcePlan = buildCitySafetySourcePlan({
    catalog,
    directory: officialAuthorityDirectory,
    entries: CITY_IDS.map((cityId) => ({
      cityId,
      settlementCode: cityId === "ljubljana" ? "061001" : "070001",
      municipalityCode: cityId === "ljubljana" ? "061" : "070",
      officialCityNames: [cityId === "ljubljana" ? "Ljubljana" : "Maribor"],
      officialMunicipalityNames: [cityId === "ljubljana"
        ? "Mestna občina Ljubljana"
        : "Mestna občina Maribor"],
      publisherIds: [
        cityId === "ljubljana" ? "municipality-ljubljana" : "municipality-maribor",
        "police",
        "surs",
      ],
      configuredRoutes: [{
        publisherId: cityId === "ljubljana"
          ? "municipality-ljubljana"
          : "municipality-maribor",
        navigationUrl: `https://${cityId}.si/safety`,
      }],
    })),
  }, decisionIntegrity);
  const policyCalls: PolicyCalls = { evaluations: [] };
  const evaluators = evaluatorRegistry(policyCalls);
  const criterionDefinitions = CITY_CRITERION_IDS.map((criterionId) => ({
    ...evaluators[criterionId].definition,
    compatibleGeoScopes: [...evaluators[criterionId].definition.compatibleGeoScopes],
  })) as unknown as InstalledCityCriterionDefinitionTuple;
  const criteriaDefaults: InstalledCityCriteriaDefaults = {
    schemaVersion: "city-criteria-defaults@1",
    mappingVersion: "task19a-city-defaults@1",
    criteria: [
      { criterionId: "safety", definitionId: "si-municipal-police-offences-per-100000@1", mode: "weighted", importance: 3, target: "2" },
      { criterionId: "long_term_rent", definitionId: "rent@1", mode: "weighted", importance: 4, target: "900" },
      { criterionId: "urban_transit", definitionId: "transit@1", mode: "required", importance: 4, target: "0.7" },
      { criterionId: "fixed_broadband", definitionId: "broadband@1", mode: "required", importance: 4, target: "100" },
    ],
  };
  const approvedFor = {
    countryCode: "SI",
    packageId: ready.definition.packageId,
    packageSchemaVersion: ready.definition.packageSchemaVersion,
    evidenceRulesVersion: ready.definition.evidenceRulesVersion,
  } as const;
  const approvedDefaults: ApprovedCityCriteriaDefaultsRegistry = {
    schemaVersion: "approved-city-criteria-defaults-registry@1",
    byMappingVersion: {
      [criteriaDefaults.mappingVersion]: {
        mappingVersion: criteriaDefaults.mappingVersion,
        approvedFor,
        defaults: criteriaDefaults,
      },
    },
  };
  const behaviors: InstalledCityPackageBehaviorRegistry = {
    schemaVersion: "installed-city-package-behavior-registry@1",
    entries: [{
      approvedFor,
      versionKey: {
        evaluatorRegistryVersionId: "task19a-evaluator-registry@1",
        evaluatorVersionIds: Object.fromEntries(CITY_CRITERION_IDS.map((criterionId) => [
          criterionId,
          evaluators[criterionId].definition.evaluatorVersion,
        ])) as InstalledCityPackageBehaviorRegistry["entries"][number]["versionKey"]["evaluatorVersionIds"],
        valueValidatorVersionId: "task19a-value-validator@1",
        sourcePeriodValidatorVersionId: "task19a-period-validator@1",
      },
      fixedPolicyVersionsBySourceId: Object.fromEntries(FIXED_SOURCE_IDS.map((sourceId) => [
        sourceId,
        {
          valuePolicyVersion: "canonical-scalar@1",
          sourcePeriodPolicyVersion: "annual-period@1",
        },
      ])) as InstalledCityPackageBehaviorRegistry["entries"][number]["fixedPolicyVersionsBySourceId"],
      evaluatorRegistry: evaluators,
      validateValue: (input) => input.value,
      validateSourcePeriod: () => "fresh",
    }],
  };
  const catalogStore = new SqliteCityCatalogStore(database, evidenceIntegrity);
  const manifestStore = new SqliteCityPackageManifestStore(
    database,
    evidenceIntegrity,
    approvedDefaults,
    behaviors,
  );
  const installedPackages = new InstalledCityPackages(manifestStore);
  const installed = await installCityPackage({
    countryCode: "SI",
    installedAt: START_AT,
    catalogProjection: { registry, catalog },
    fixedPlansByCityId,
    safetySourcePlan,
    officialAuthorityDirectory,
    criteriaDefaults,
    criterionDefinitions,
  }, {
    resolveAvailability: () => structuredClone(ready),
    catalog: catalogStore,
    administrativeEvidence: new SqliteAdministrativeEvidenceStore(database, evidenceIntegrity),
    manifests: manifestStore,
    installedPackages,
    approvedDefaults,
    integrity: evidenceIntegrity,
  });
  return {
    approvedDefaults,
    behaviors,
    catalogStore,
    installed,
    installedPackages,
    manifestStore,
  };
}

function liveArtifact<S extends SloveniaCityFixedSourceId>(
  sourceId: S,
  runId: string,
  capturedAt: string,
  navigationUrl: string,
): LiveCapturedArtifact<S> {
  const bytes = new TextEncoder().encode(`${sourceId}:${navigationUrl}:task19a`);
  return {
    artifactId: `${runId}:${sourceId}:artifact`,
    runId,
    sourceId,
    role: "source",
    origin: "live",
    capturedAt,
    responseStatus: 200,
    responseUrl: `${navigationUrl}/resolved`,
    request: { method: "GET", url: navigationUrl },
    url: `${navigationUrl}/resolved`,
    mediaType: "application/json",
    sha256: createHash("sha256").update(bytes).digest("hex"),
    bytes,
  };
}

function fixedParserEntry<S extends SloveniaCityFixedSourceId>(
  sourceId: S,
  navigationUrl: string,
  parserVersion: string,
  artifacts: readonly LiveCapturedArtifact<S>[],
): ParserEntry<S> {
  return {
    sourceId,
    navigationUrl,
    resolvedEvidenceUrl: `${navigationUrl}/resolved`,
    artifacts,
    versionHint: parserVersion,
  };
}

function fixedRoutePort<S extends SloveniaCityFixedSourceId>(
  installed: InstalledCityResearchPackage,
  sourceId: S,
  sourceIndex: 0 | 1 | 2,
  disposition: "second_verified" | "all_rejected" | "first_verified",
): CityFixedRoutePort<S, CityFixedEvidenceClaim<S>> {
  return {
    async inspect(input) {
      const plan = installed.fixedPlansByCityId[input.cityId]?.[sourceIndex] as
        CityFixedSourcePlan<S> | undefined;
      if (plan?.sourceId !== sourceId) throw new Error("task19a_fixed_plan_missing");
      const verified = disposition === "first_verified" && input.routeIndex === 0 ||
        disposition === "second_verified" && input.routeIndex === 1;
      if (!verified) {
        return {
          kind: "rejected",
          attempt: {
            cityCheckRunId: input.cityCheckRunId,
            sourceId: input.sourceId,
            index: input.routeIndex,
            routeId: input.route.routeId,
            navigationUrl: input.route.navigationUrl,
            resolvedEvidenceUrl: `${input.route.navigationUrl}/resolved`,
            attemptedAt: input.attemptedAt,
            disposition: "rejected",
            reason: "http_not_found",
            artifactIds: [],
          },
          parserEntry: fixedParserEntry(
            input.sourceId,
            input.route.navigationUrl,
            plan.parserVersion,
            [],
          ),
        };
      }
      const artifact = liveArtifact(
        input.sourceId,
        input.cityCheckRunId,
        input.attemptedAt,
        input.route.navigationUrl,
      );
      const claim: CityFixedEvidenceClaim<S> = {
        claimId: `${input.cityCheckRunId}:${input.sourceId}:claim`,
        sourceId: input.sourceId,
        value: { kind: "canonical_scalar", value: "1" },
        scope: plan.claimContract.scope,
        sourcePeriod: "2025",
        anchor: {
          artifactId: artifact.artifactId,
          locator: artifact.url,
          excerptSha256: artifact.sha256,
        },
        status: "verified",
        criterionId: plan.criterionId,
        definitionId: plan.definitionId,
        officialAreaId: plan.claimContract.officialAreaId,
        geoScope: plan.claimContract.geoScope,
        unit: plan.claimContract.unit,
        denominator: plan.claimContract.denominator,
        freshnessPolicyVersion: plan.claimContract.freshnessPolicyVersion,
      };
      return {
        kind: "verified",
        attempt: {
          cityCheckRunId: input.cityCheckRunId,
          sourceId: input.sourceId,
          index: input.routeIndex,
          routeId: input.route.routeId,
          navigationUrl: input.route.navigationUrl,
          resolvedEvidenceUrl: artifact.url,
          attemptedAt: input.attemptedAt,
          disposition: "accepted",
          artifactIds: [artifact.artifactId],
          claimIds: [claim.claimId],
        },
        parserEntry: fixedParserEntry(
          input.sourceId,
          input.route.navigationUrl,
          plan.parserVersion,
          [artifact],
        ),
        claims: [claim],
      };
    },
  };
}

function seedFixedRoutes(
  installed: InstalledCityResearchPackage,
): CityFrontierFixedRoutePorts {
  return {
    "si-city-long-term-rent": fixedRoutePort(
      installed,
      "si-city-long-term-rent",
      0,
      "second_verified",
    ),
    "si-city-urban-transit": fixedRoutePort(
      installed,
      "si-city-urban-transit",
      1,
      "all_rejected",
    ),
    "si-city-fixed-broadband": fixedRoutePort(
      installed,
      "si-city-fixed-broadband",
      2,
      "first_verified",
    ),
  };
}

function seedSafetyDocuments(): CitySafetyOfficialDocumentPort {
  return {
    async inspect(input) {
      const bytes = new TextEncoder().encode(`task19a-safety:${input.candidateUrl}`);
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      const publisher = input.publisherContext;
      if (publisher === undefined) throw new Error("task19a_safety_publisher_missing");
      const missingDocumentUrl = `${input.candidateUrl}/missing.pdf`;
      const artifact: LiveCapturedArtifact<"si-city-safety"> = {
        artifactId: `${input.runId}:si-city-safety:artifact`,
        runId: input.runId,
        sourceId: "si-city-safety",
        role: "municipal_source",
        origin: "live",
        capturedAt: input.assessmentAt,
        responseStatus: 200,
        responseUrl: input.candidateUrl,
        request: { method: "GET", url: input.candidateUrl },
        url: input.candidateUrl,
        mediaType: "application/pdf",
        sha256,
        bytes,
      };
      return {
        kind: "rejected",
        detail: {
          officialTrace: {
            initialUrl: input.candidateUrl,
            edges: [{
              kind: "confirmed_document_link",
              fromUrl: input.candidateUrl,
              toUrl: missingDocumentUrl,
            }],
            lastTrustedUrl: missingDocumentUrl,
            officialHops: 1,
            failure: {
              captureKind: "http_error",
              responseStatus: 404,
              responseUrl: missingDocumentUrl,
            },
          },
          artifactRefs: [{
            role: "municipal_source",
            documentRole: "navigation",
            artifactId: artifact.artifactId,
            artifactSha256: artifact.sha256,
            sourceSha256: artifact.sha256,
            locator: artifact.url,
          }],
          reviewedOfficial: {
            publisherId: publisher.publisherId,
            dataAuthorityId: "police",
            publisherNavigationUrl: publisher.publisherNavigationUrl,
          },
          mediaType: "application/pdf",
          retentionPolicyId: `${publisher.publisherId}-retention@1`,
          transientRawDeleted: false,
          disposition: "rejected",
          reason: "http_not_found",
        },
        artifacts: [artifact],
      };
    },
  };
}

function seedSafetySearch(): CitySafetySearchPort {
  return {
    async search() {
      return { kind: "completed", providerId: "task19a-search", urls: [] };
    },
  };
}

function inertScheduler(): CityFixedDeadlineScheduler {
  return {
    schedule() {
      return { cancel: () => undefined };
    },
  };
}

function assembleCitySeed(
  database: Database.Database,
  profiles: SqliteProfileStore,
  resolution: ReturnType<typeof createCountryResolutionApplication>,
  packageAuthority: Awaited<ReturnType<typeof installSyntheticCityPackage>>,
) {
  const evidenceIntegrity = createEvidenceIntegrity(HMAC_KEY);
  const decisionIntegrity = createCityDecisionIntegrityView(evidenceIntegrity);
  const criteriaStore = new SqliteCityCriteriaStore(database, evidenceIntegrity);
  const countryStore = new SqliteCountryResolutionStore(database, HMAC_KEY);
  const branchStore = new SqliteCityBranchStore(database, evidenceIntegrity, countryStore);
  const frontierStore = new SqliteCityFrontierStore(database, evidenceIntegrity, {
    criteria: criteriaStore,
    branches: branchStore,
    catalogs: packageAuthority.catalogStore,
  });
  const evidenceStore = new SqliteCityEvidenceStore(
    database,
    evidenceIntegrity,
    packageAuthority.installedPackages,
  );
  const knowledgeStore = new SqliteCityKnowledgeStore(
    database,
    evidenceIntegrity,
    packageAuthority.installedPackages,
  );
  const selectionWriter = new SqliteCitySelectionWriter(database, evidenceIntegrity, {
    catalogs: packageAuthority.catalogStore,
    historicalPackages: packageAuthority.manifestStore,
    branches: branchStore,
    rankings: frontierStore,
    frontier: frontierStore,
  });
  const manifestLoad = packageAuthority.manifestStore.loadVerified
    .bind(packageAuthority.manifestStore);
  const ports: CityFrontierApplicationPorts = {
    resolveAvailability: () => freezeDeep({
      definition: structuredClone(packageAuthority.installed.definition),
      sourceContractStatus: "bounded_verified_or_unknown" as const,
      readiness: { status: "ready" as const, issues: [] as const },
    }),
    resolvedCountries: {
      requireResolvedCountryShortlistForCity:
        resolution.requireResolvedCountryShortlistForCity.bind(resolution),
    },
    profiles: {
      loadRelocationAnyVerified: profiles.loadRelocationAnyVerified.bind(profiles),
      loadPreferenceForRankingVerified:
        profiles.loadPreferenceForRankingVerified.bind(profiles),
    },
    installedPackages: {
      findReady: packageAuthority.installedPackages.findReady
        .bind(packageAuthority.installedPackages),
      findExact: packageAuthority.installedPackages.findExact
        .bind(packageAuthority.installedPackages),
    },
    installedPackageManifests: { loadVerified: manifestLoad },
    latestInstalledCatalog: {
      latestInstalledVerified: packageAuthority.installedPackages.latestInstalledVerified
        .bind(packageAuthority.installedPackages),
    },
    historicalCatalogs: {
      loadVerified: packageAuthority.catalogStore.loadVerified
        .bind(packageAuthority.catalogStore),
    },
    criteria: {
      loadCriteriaVerified: criteriaStore.loadCriteriaVerified.bind(criteriaStore),
    },
    branches: {
      loadPreCityBranchVerified: branchStore.loadPreCityBranchVerified.bind(branchStore),
      findPreCityBranchBySourceVerified: branchStore.findPreCityBranchBySourceVerified
        .bind(branchStore),
    },
    rankings: {
      loadRankingVerified: frontierStore.loadRankingVerified.bind(frontierStore),
    },
    frontierRead: {
      loadRevisionVerified: frontierStore.loadRevisionVerified.bind(frontierStore),
      loadHeadVerified: frontierStore.loadHeadVerified.bind(frontierStore),
      loadChainVerified: frontierStore.loadChainVerified.bind(frontierStore),
      findCommandVerified: frontierStore.findCommandVerified.bind(frontierStore),
    },
    frontierAppend: {
      appendRevision: frontierStore.appendRevision.bind(frontierStore),
    },
    startWriter: {
      publishStart(input) {
        const result = frontierStore.publishStart(input);
        for (const key of ["criteria", "preCityBranch", "ranking", "root"] as const) {
          const expected = key === "preCityBranch" ? input.preCityBranch : input[key];
          if (evidenceIntegrity.canonical(result[key]) !==
            evidenceIntegrity.canonical(expected)) {
            throw new Error(`task19a_start_store_drift:${key}`);
          }
        }
        return result;
      },
    },
    selectionHistory: selectionWriter,
    evidence: {
      loadVerified: evidenceStore.loadVerified.bind(evidenceStore),
      findVerifiedByCheckRunId: evidenceStore.findVerifiedByCheckRunId.bind(evidenceStore),
      seal: evidenceStore.seal.bind(evidenceStore),
    },
    evidenceReplay: {
      read: {
        loadVerified: evidenceStore.loadVerified.bind(evidenceStore),
        findVerifiedByCheckRunId: evidenceStore.findVerifiedByCheckRunId.bind(evidenceStore),
      },
      integrity: createCityEvidenceReplayIntegrity(decisionIntegrity),
      package: {
        loadExactReplayContract: packageAuthority.installedPackages.loadExactReplayContract
          .bind(packageAuthority.installedPackages),
      },
    },
    knowledge: {
      publishFromEvidence: knowledgeStore.publishFromEvidence.bind(knowledgeStore),
      latestVerified: knowledgeStore.latestVerified.bind(knowledgeStore),
      loadVerified: knowledgeStore.loadVerified.bind(knowledgeStore),
      findByEvidenceVerified: knowledgeStore.findByEvidenceVerified.bind(knowledgeStore),
    },
    fixedRoutes: seedFixedRoutes(packageAuthority.installed),
    fixedDeadlineScheduler: inertScheduler(),
    safetySearch: seedSafetySearch(),
    safetyDocuments: seedSafetyDocuments(),
    decisionIntegrity,
    evidenceIntegrity,
    clock: () => new Date(START_AT),
    fixedSourceDeadlineAt: (now) => new Date(now.valueOf() + 45_000),
  };
  const assembly = createCityFrontierApplication(ports);
  const selection = createCitySelectionApplication({
    frontier: assembly.selectionAuthority,
    writer: selectionWriter,
    integrity: decisionIntegrity,
    clock: () => new Date(START_AT),
  });
  return { application: assembly.application, evidenceStore, selection };
}

function snapshotRawRows(
  database: Database.Database,
): CityFrontierOfflineReplayProof["rowsBefore"] {
  return Object.fromEntries(RAW_TABLE_NAMES.map((table) => {
    const orderBy = table === "artifacts" ? "run_id, artifact_id" : "id";
    const rows = database.prepare(`SELECT * FROM ${table} ORDER BY ${orderBy}`).all() as
      Readonly<Record<string, unknown>>[];
    return [table, rows.map((row) => Object.freeze(Object.fromEntries(
      Object.entries(row).map(([column, value]) => [column, rawCell(value)]),
    )))];
  })) as unknown as CityFrontierOfflineReplayProof["rowsBefore"];
}

function rawCell(value: unknown): OfflineReplayRawCell {
  if (value === null) return Object.freeze({ kind: "null" });
  if (typeof value === "string") return Object.freeze({ kind: "text", value });
  if (typeof value === "number" && Number.isFinite(value)) {
    return Object.freeze({ kind: "number", value: String(value) });
  }
  if (value instanceof Uint8Array) {
    return Object.freeze({
      kind: "blob",
      hex: Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString("hex"),
    });
  }
  throw new Error("task19a_unknown_sqlite_cell");
}

async function seedWriterDatabase(
  database: Database.Database,
  scenario: CityFrontierOfflineReplaySelectionScenario,
): Promise<Readonly<{
  savedCompletion: CityFrontierReadModel;
  evidenceBeforeClose: readonly OfflineReplayEvidenceLedger[];
  rowsBefore: CityFrontierOfflineReplayProof["rowsBefore"];
  approvedDefaults: ApprovedCityCriteriaDefaultsRegistry;
  behaviors: InstalledCityPackageBehaviorRegistry;
  installed: Awaited<ReturnType<typeof installSyntheticCityPackage>>["installed"];
  resolved: Awaited<ReturnType<typeof seedResolvedCountry>>["resolved"];
}>> {
  const country = await seedResolvedCountry(database);
  const packageAuthority = await installSyntheticCityPackage(database, country.integrity);
  const city = assembleCitySeed(
    database,
    country.profiles,
    country.resolution,
    packageAuthority,
  );
  const setup = await city.application.presentCityFrontierSetup({
    resolvedCountryShortlistRevisionId: country.resolved.id,
    countryCode: "SI",
  });
  let current = await city.application.startCityFrontier({
    resolvedCountryShortlistRevisionId: country.resolved.id,
    countryCode: "SI",
    criteriaDraft: structuredClone(setup.criteriaDraft),
    commandId: "task19a-city-start",
  });
  for (const [index] of packageAuthority.installed.catalog.members.entries()) {
    const prepared = await city.application.prepareCityFrontierContinuation({
      runId: current.runId,
      expectedRevisionId: current.revision.id,
      commandId: `task19a-city-continue-${String(index + 1)}`,
    });
    current = await city.application.continueCityFrontier(
      prepared,
      () => undefined,
      new AbortController().signal,
    );
  }
  if (current.revision.kind !== "terminal" ||
    current.revision.stopCondition !== "catalog_exhausted" ||
    current.revision.markers.length !== 2 ||
    !current.revision.markers.every((marker) =>
      marker.status === "selectable" && marker.visualStatus === "yellow")) {
    throw new Error("task19a_terminal_fixture_failed");
  }
  const requestedSelectionCount = scenario === "two-yellow-siblings" ? 2 : 1;
  const selectedMarkers = [...current.revision.markers]
    .filter((marker) => marker.unknownBasis.length > 0 && marker.facts.some((fact) =>
      fact.manualCheckLinks.length > 0))
    .sort((left, right) => left.rank - right.rank)
    .slice(0, requestedSelectionCount);
  if (selectedMarkers.length !== requestedSelectionCount) {
    throw new Error("task19a_yellow_marker_missing");
  }
  let savedCompletion = current;
  for (const [index, selected] of selectedMarkers.entries()) {
    const selectedResult = await city.selection.selectCity({
      terminalCityShortlistSnapshotId: current.revision.id,
      cityId: selected.cityId,
      commandId: index === 0
        ? "task19a-city-select-yellow"
        : "task19b-city-select-yellow-sibling",
      warningCopyVersion: "city-unknown-risk@1",
    });
    savedCompletion = selectedResult.readModel;
  }
  if (savedCompletion.selections.length !== requestedSelectionCount) {
    throw new Error("task19a_selection_history_missing");
  }
  const evidenceIds = [...new Set(savedCompletion.revision.markers.map((marker) =>
    marker.evidenceSnapshotId))].sort();
  const evidenceBeforeClose = evidenceIds.map((id) => {
    const verified = city.evidenceStore.loadVerified(id);
    return freezeDeep({
      id,
      fixedAttemptLedgers: structuredClone(verified.snapshot.fixedAttemptLedgers),
      safetyAttemptLedger: structuredClone(verified.snapshot.safetyAttemptLedger),
    });
  });
  return freezeDeep({
    savedCompletion,
    evidenceBeforeClose,
    rowsBefore: snapshotRawRows(database),
    approvedDefaults: packageAuthority.approvedDefaults,
    behaviors: packageAuthority.behaviors,
    installed: packageAuthority.installed,
    resolved: country.resolved,
  });
}

type SeedCapture = Awaited<ReturnType<typeof seedWriterDatabase>>;

interface MutableBoundaryCounters {
  fixedRoutes: {
    "si-city-long-term-rent": number;
    "si-city-urban-transit": number;
    "si-city-fixed-broadband": number;
  };
  safetyDocuments: number;
  safetySearch: number;
  rawSafetySearchRequests: number;
  clock: number;
  scheduler: number;
}

function emptyBoundaryCounters(): MutableBoundaryCounters {
  return {
    fixedRoutes: {
      "si-city-long-term-rent": 0,
      "si-city-urban-transit": 0,
      "si-city-fixed-broadband": 0,
    },
    safetyDocuments: 0,
    safetySearch: 0,
    rawSafetySearchRequests: 0,
    clock: 0,
    scheduler: 0,
  };
}

function throwingFixedRoutes(
  counters: MutableBoundaryCounters,
): CityFrontierFixedRoutePorts {
  return Object.fromEntries(FIXED_SOURCE_IDS.map((sourceId) => [sourceId, {
    async inspect() {
      counters.fixedRoutes[sourceId] += 1;
      throw new Error(PRIVATE_SENTINEL);
    },
  }])) as unknown as CityFrontierFixedRoutePorts;
}

function throwingSafetyDocuments(
  counters: MutableBoundaryCounters,
): CitySafetyOfficialDocumentPort {
  return {
    async inspect() {
      counters.safetyDocuments += 1;
      throw new Error(PRIVATE_SENTINEL);
    },
  };
}

function throwingScheduler(
  counters: MutableBoundaryCounters,
): CityFixedDeadlineScheduler {
  return {
    schedule() {
      counters.scheduler += 1;
      throw new Error(PRIVATE_SENTINEL);
    },
  };
}

function countedSafetySearch(
  counters: MutableBoundaryCounters,
): CitySafetySearchPort {
  const provider = createCitySafetySearchPort({
    providerId: "task19a-replay-search",
    step: createHttpCitySafetySearchStep({
      endpoint: "https://search-provider.invalid/query",
      providerId: "task19a-replay-search",
      bearerToken: PRIVATE_SEARCH_TOKEN,
      timeoutMs: 1_000,
      maxResponseBytes: 65536,
    }, async () => {
      counters.rawSafetySearchRequests += 1;
      throw new Error(PRIVATE_SENTINEL);
    }),
  });
  return {
    async search(input) {
      counters.safetySearch += 1;
      return provider.search(input);
    },
  };
}

function assembleCityReplay(
  database: Database.Database,
  captured: SeedCapture,
  counters: MutableBoundaryCounters,
) {
  const evidenceIntegrity = createEvidenceIntegrity(HMAC_KEY);
  const decisionIntegrity = createCityDecisionIntegrityView(evidenceIntegrity);
  const catalogStore = new SqliteCityCatalogStore(database, evidenceIntegrity);
  const manifestStore = new SqliteCityPackageManifestStore(
    database,
    evidenceIntegrity,
    captured.approvedDefaults,
    captured.behaviors,
  );
  const installedPackages = new InstalledCityPackages(manifestStore);
  const profiles = new SqliteProfileStore(database);
  const criteriaStore = new SqliteCityCriteriaStore(database, evidenceIntegrity);
  const countryStore = new SqliteCountryResolutionStore(database, HMAC_KEY);
  const branchStore = new SqliteCityBranchStore(database, evidenceIntegrity, countryStore);
  const frontierStore = new SqliteCityFrontierStore(database, evidenceIntegrity, {
    criteria: criteriaStore,
    branches: branchStore,
    catalogs: catalogStore,
  });
  const evidenceStore = new SqliteCityEvidenceStore(
    database,
    evidenceIntegrity,
    installedPackages,
  );
  const knowledgeStore = new SqliteCityKnowledgeStore(
    database,
    evidenceIntegrity,
    installedPackages,
  );
  const selectionStore = new SqliteCitySelectionWriter(database, evidenceIntegrity, {
    catalogs: catalogStore,
    historicalPackages: manifestStore,
    branches: branchStore,
    rankings: frontierStore,
    frontier: frontierStore,
  });
  const manifestLoad = manifestStore.loadVerified.bind(manifestStore);
  const ports: CityFrontierApplicationPorts = {
    resolveAvailability: () => freezeDeep({
      definition: structuredClone(captured.installed.definition),
      sourceContractStatus: "bounded_verified_or_unknown" as const,
      readiness: { status: "ready" as const, issues: [] as const },
    }),
    resolvedCountries: {
      async requireResolvedCountryShortlistForCity(revisionId) {
        if (revisionId !== captured.resolved.id) throw new Error("integrity_mismatch");
        return freezeDeep(structuredClone(captured.resolved));
      },
    },
    profiles: {
      loadRelocationAnyVerified: profiles.loadRelocationAnyVerified.bind(profiles),
      loadPreferenceForRankingVerified:
        profiles.loadPreferenceForRankingVerified.bind(profiles),
    },
    installedPackages: {
      findReady: installedPackages.findReady.bind(installedPackages),
      findExact: installedPackages.findExact.bind(installedPackages),
    },
    installedPackageManifests: { loadVerified: manifestLoad },
    latestInstalledCatalog: {
      latestInstalledVerified: installedPackages.latestInstalledVerified
        .bind(installedPackages),
    },
    historicalCatalogs: { loadVerified: catalogStore.loadVerified.bind(catalogStore) },
    criteria: { loadCriteriaVerified: criteriaStore.loadCriteriaVerified.bind(criteriaStore) },
    branches: {
      loadPreCityBranchVerified: branchStore.loadPreCityBranchVerified.bind(branchStore),
      findPreCityBranchBySourceVerified: branchStore.findPreCityBranchBySourceVerified
        .bind(branchStore),
    },
    rankings: { loadRankingVerified: frontierStore.loadRankingVerified.bind(frontierStore) },
    frontierRead: {
      loadRevisionVerified: frontierStore.loadRevisionVerified.bind(frontierStore),
      loadHeadVerified: frontierStore.loadHeadVerified.bind(frontierStore),
      loadChainVerified: frontierStore.loadChainVerified.bind(frontierStore),
      findCommandVerified: frontierStore.findCommandVerified.bind(frontierStore),
    },
    frontierAppend: { appendRevision: frontierStore.appendRevision.bind(frontierStore) },
    startWriter: { publishStart: frontierStore.publishStart.bind(frontierStore) },
    selectionHistory: selectionStore,
    evidence: {
      loadVerified: evidenceStore.loadVerified.bind(evidenceStore),
      findVerifiedByCheckRunId: evidenceStore.findVerifiedByCheckRunId.bind(evidenceStore),
      seal: evidenceStore.seal.bind(evidenceStore),
    },
    evidenceReplay: {
      read: {
        loadVerified: evidenceStore.loadVerified.bind(evidenceStore),
        findVerifiedByCheckRunId: evidenceStore.findVerifiedByCheckRunId.bind(evidenceStore),
      },
      integrity: createCityEvidenceReplayIntegrity(decisionIntegrity),
      package: {
        loadExactReplayContract: installedPackages.loadExactReplayContract
          .bind(installedPackages),
      },
    },
    knowledge: {
      publishFromEvidence: knowledgeStore.publishFromEvidence.bind(knowledgeStore),
      latestVerified: knowledgeStore.latestVerified.bind(knowledgeStore),
      loadVerified: knowledgeStore.loadVerified.bind(knowledgeStore),
      findByEvidenceVerified: knowledgeStore.findByEvidenceVerified.bind(knowledgeStore),
    },
    fixedRoutes: throwingFixedRoutes(counters),
    fixedDeadlineScheduler: throwingScheduler(counters),
    safetySearch: countedSafetySearch(counters),
    safetyDocuments: throwingSafetyDocuments(counters),
    decisionIntegrity,
    evidenceIntegrity,
    clock: () => {
      counters.clock += 1;
      throw new Error(PRIVATE_SENTINEL);
    },
    fixedSourceDeadlineAt: () => {
      counters.clock += 1;
      throw new Error(PRIVATE_SENTINEL);
    },
  };
  return {
    application: createCityFrontierApplication(ports).application,
    evidenceStore,
  };
}

function totalChanges(database: Database.Database): number {
  const row = database.prepare("SELECT total_changes() AS count").get() as
    { readonly count: number };
  return row.count;
}

function sqliteIntegrityCheck(database: Database.Database): readonly string[] {
  const rows = database.pragma("integrity_check") as readonly unknown[];
  return Object.freeze(rows.map((row) => {
    if (row === null || typeof row !== "object" || Array.isArray(row) ||
      Object.getPrototypeOf(row) !== Object.prototype ||
      Object.keys(row).length !== 1 || typeof (row as { integrity_check?: unknown })
        .integrity_check !== "string") {
      throw new Error("task19_sqlite_integrity_check_invalid");
    }
    return (row as { readonly integrity_check: string }).integrity_check;
  }));
}

/**
 * Builds the Task 19A durable City Frontier replay proof.
 *
 * The writer connection is closed before its database is copied. The copy is
 * then reopened query-only and presented twice through production Application
 * and SQLite adapters with counted throwing live boundaries.
 */
export async function createCityFrontierOfflineReplayProof(
  scenario: CityFrontierOfflineReplaySelectionScenario = "single-yellow",
):
Promise<CityFrontierOfflineReplayProof> {
  if (scenario !== "single-yellow" && scenario !== "two-yellow-siblings") {
    throw new Error("task19_invalid_replay_scenario");
  }
  const temporary = temporaryDatabase();
  let writer: Database.Database | undefined;
  let replay: Database.Database | undefined;
  let cleaned = false;
  const cleanup = (): void => {
    if (cleaned) return;
    cleaned = true;
    if (replay?.open === true) replay.close();
    if (writer?.open === true) writer.close();
    rmSync(temporary.directory, { recursive: true, force: true });
  };
  try {
    writer = openEvidenceDatabase(temporary.writerPath);
    const captured = await seedWriterDatabase(writer, scenario);
    writer.close();
    writer = undefined;

    copyFileSync(temporary.writerPath, temporary.replayPath);
    replay = openEvidenceDatabase(temporary.replayPath);
    replay.pragma("query_only = ON");
    const queryOnly = replay.pragma("query_only", { simple: true });
    if (queryOnly !== 1) {
      throw new Error("task19a_query_only_not_enabled");
    }

    const integrity = createEvidenceIntegrity(HMAC_KEY);
    const replayBaselineRows = snapshotRawRows(replay);
    if (integrity.canonical(replayBaselineRows) !== integrity.canonical(captured.rowsBefore)) {
      throw new Error("task19a_replay_copy_mismatch");
    }
    const totalChangesBefore = totalChanges(replay);
    const integrityCheck = sqliteIntegrityCheck(replay);
    const foreignKeyViolations = freezeDeep(structuredClone(
      replay.pragma("foreign_key_check") as readonly unknown[],
    ));
    const counters = emptyBoundaryCounters();
    const assembled = assembleCityReplay(replay, captured, counters);
    const first = await assembled.application.presentCityFrontier(
      captured.savedCompletion.runId,
    );
    const second = await assembled.application.presentCityFrontier(
      captured.savedCompletion.runId,
    );
    const evidenceIds = [...new Set(first.revision.markers.map((marker) =>
      marker.evidenceSnapshotId))].sort();
    const evidenceAfterReopen = evidenceIds.map((id) => {
      const verified = assembled.evidenceStore.loadVerified(id);
      return freezeDeep({
        id,
        fixedAttemptLedgers: structuredClone(verified.snapshot.fixedAttemptLedgers),
        safetyAttemptLedger: structuredClone(verified.snapshot.safetyAttemptLedger),
      });
    });
    const rowsAfter = snapshotRawRows(replay);
    const totalChangesAfter = totalChanges(replay);

    return freezeDeep({
      savedCompletion: captured.savedCompletion,
      presentations: [first, second] as const,
      evidenceBeforeClose: captured.evidenceBeforeClose,
      evidenceAfterReopen,
      rowsBefore: captured.rowsBefore,
      rowsAfter,
      counters: structuredClone(counters),
      queryOnly,
      integrityCheck,
      foreignKeyViolations,
      totalChangesBefore,
      totalChangesAfter,
      databasePath: temporary.replayPath,
      privateSentinel: PRIVATE_SENTINEL,
      privateSearchToken: PRIVATE_SEARCH_TOKEN,
      canonical: (value: unknown) => integrity.canonical(value),
      cleanup,
    });
  } catch (error) {
    cleanup();
    throw error;
  }
}
