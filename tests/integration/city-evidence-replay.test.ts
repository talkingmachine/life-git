import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type Database from "better-sqlite3";
import { afterEach, describe, expect, expectTypeOf, test, vi } from "vitest";

import * as replayModule from "../../src/application/replay-city-evidence";
import { replayCityEvidence } from "../../src/application/replay-city-evidence";
import {
  cityEvidenceContextHash,
  type CityEvidenceContext,
  type CityEvidenceReplayPorts,
  type CityEvidenceSealInput,
  type CityPackageEvidenceReplayContract,
  type InstalledCityPackageManifestAppendInput,
  type VerifiedCityEvidence,
} from "../../src/application/city-data-contracts";
import type { ApprovedCityCriteriaDefaultsRegistry } from
  "../../src/decision/approved-city-criteria-defaults";
import {
  buildCityCatalogRevision,
  buildCityRegistryRevision,
  LEGACY_CITY_CATALOG_RULES_VERSION,
  type CityCatalogRevision,
} from "../../src/decision/city-catalog";
import {
  CITY_CRITERION_IDS,
  type CityCriterionEvaluatorRegistry,
  type InstalledCityCriteriaDefaults,
  type InstalledCityCriterionDefinitionTuple,
} from "../../src/decision/city-criteria";
import {
  createCityEvidenceReplayIntegrity,
  createEvidenceIntegrity,
} from "../../src/infrastructure/integrity";
import { InstalledCityPackages } from
  "../../src/infrastructure/sources/installed-city-packages";
import type { InstalledCityPackageBehaviorRegistry } from
  "../../src/infrastructure/sources/installed-city-packages";
import { SqliteCityCatalogStore } from
  "../../src/infrastructure/sqlite/city-catalog-store";
import { SqliteCityEvidenceStore } from
  "../../src/infrastructure/sqlite/city-evidence-store";
import { openEvidenceDatabase } from "../../src/infrastructure/sqlite/db";
import { SqliteAdministrativeEvidenceStore } from
  "../../src/infrastructure/sqlite/evidence-store";
import { SqliteCityPackageManifestStore } from
  "../../src/infrastructure/sqlite/city-package-manifest-store";
import type { LiveCapturedArtifact } from "../../src/research/contracts";
import {
  citySafetyTerminalEntry,
  SLOVENIA_CITY_FACT_SOURCE_IDS,
  type CityEvidenceClaim,
  type CityFixedAttemptLedger,
  type CityFixedEvidenceClaim,
  type CityFixedSourcePeriodValidator,
  type CityFixedSourcePlan,
  type CityFixedValueValidator,
  type SloveniaCityFactSourceId,
  type SloveniaCityFixedSourceId,
} from "../../src/research/city-evidence";
import type {
  CitySafetyArtifactReference,
  CitySafetyAttemptLedger,
} from "../../src/research/city-safety-evidence";
import { sealCityPackageAdministrativeEvidence } from
  "../../src/application/seal-administrative-evidence";
import {
  buildCitySafetyQueries,
  buildCitySafetySourcePlan,
  buildOfficialAuthorityDirectory,
} from "../../src/research/city-safety-source-plan";
import type { TerminalEvidenceEntry } from "../../src/research/research-plan";
import { sealEvidencePlan } from "../../src/research/research-plan";
import { SLOVENIA_CITY_FACT_VERSIONS } from
  "../../src/research/slovenia-city-plan";

const INTEGRITY_KEY = "task-6-city-evidence-replay-key-at-least-32-bytes";
const INTEGRITY = createEvidenceIntegrity(INTEGRITY_KEY);
const CITY_ID = "ljubljana";
const SECOND_CITY_ID = "maribor";
const FIXED_SOURCE_IDS = [
  "si-city-long-term-rent",
  "si-city-urban-transit",
  "si-city-fixed-broadband",
] as const;
const temporaryDirectories: string[] = [];
const databases: Database.Database[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const database of databases.splice(0)) {
    if (database.open) database.close();
  }
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function temporaryDatabasePath(): string {
  const directory = mkdtempSync(join(tmpdir(), "city-evidence-replay-"));
  temporaryDirectories.push(directory);
  return join(directory, "city.sqlite");
}

function database(path: string): Database.Database {
  const value = openEvidenceDatabase(path);
  databases.push(value);
  return value;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function fixedPlan<S extends SloveniaCityFixedSourceId>(
  sourceId: S,
  suffix: string,
  cityId = CITY_ID,
  officialAreaId = cityId === CITY_ID ? "061" : "070",
): CityFixedSourcePlan<S> {
  const criterionId = sourceId === "si-city-long-term-rent"
    ? "long_term_rent"
    : sourceId === "si-city-urban-transit" ? "urban_transit" : "fixed_broadband";
  const definitionId = `${criterionId}-definition@1`;
  return {
    planId: `${cityId}:${sourceId}:plan-${suffix}@1`,
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
      unit: "canonical-unit",
      denominator: "canonical-denominator",
      freshnessPolicyVersion: "annual@1",
      valueKind: "canonical_scalar",
      valuePolicyVersion: "canonical-scalar@1",
      sourcePeriodPolicyVersion: "annual-period@1",
    },
    routes: [{
      routeId: `${cityId}:${sourceId}:primary-${suffix}`,
      navigationUrl: `https://official.example/${cityId}/${sourceId}/${suffix}`,
    }],
    parserVersion: SLOVENIA_CITY_FACT_VERSIONS[sourceId].parserVersion,
    rulesVersion: SLOVENIA_CITY_FACT_VERSIONS[sourceId].rulesVersion,
  } as unknown as CityFixedSourcePlan<S>;
}

function evaluatorRegistry(): CityCriterionEvaluatorRegistry {
  return Object.fromEntries(CITY_CRITERION_IDS.map((criterionId) => {
    const direction = criterionId === "urban_transit" || criterionId === "fixed_broadband"
      ? "at_least" as const
      : "at_most" as const;
    const definitionId = criterionId === "safety"
      ? "si-municipal-police-offences-per-100000@1"
      : `${criterionId}-definition@1`;
    return [criterionId, {
      definition: {
        criterionId,
        definitionId,
        direction,
        unit: "canonical-unit",
        denominator: "canonical-denominator",
        compatibleGeoScopes: ["municipality"],
        freshnessPolicyVersion: criterionId === "safety"
          ? "municipal-annual-july-boundary@1"
          : "annual@1",
        evaluatorVersion: `${criterionId}-evaluator@1`,
      },
      canonicalizeTarget(target: unknown): string {
        if (typeof target !== "string" || !/^\d+(?:\.\d+)?$/.test(target)) {
          throw new Error("invalid_target");
        }
        return target;
      },
      evaluate: () => ({
        state: "verified" as const,
        factor: "1",
        targetComparison: "matches" as const,
      }),
    }];
  })) as unknown as CityCriterionEvaluatorRegistry;
}

const EVALUATORS = evaluatorRegistry();
const DEFINITIONS = CITY_CRITERION_IDS.map((criterionId) => ({
  ...EVALUATORS[criterionId].definition,
  compatibleGeoScopes: [...EVALUATORS[criterionId].definition.compatibleGeoScopes],
})) as unknown as InstalledCityCriterionDefinitionTuple;
const DEFAULTS: InstalledCityCriteriaDefaults = {
  schemaVersion: "city-criteria-defaults@1",
  mappingVersion: "synthetic-city-defaults@1",
  criteria: CITY_CRITERION_IDS.map((criterionId, index) => ({
    criterionId,
    definitionId: EVALUATORS[criterionId].definition.definitionId,
    mode: index === 0 ? "required" as const : "weighted" as const,
    importance: (index + 1) as 1 | 2 | 3 | 4,
    target: String(index + 1),
  })) as unknown as InstalledCityCriteriaDefaults["criteria"],
};
const APPROVED_FOR = Object.freeze({
  countryCode: "SI",
  packageId: "si-cities",
  packageSchemaVersion: "si-cities@1",
  evidenceRulesVersion: "si-city-evidence@1",
} as const);
const APPROVED_DEFAULTS: ApprovedCityCriteriaDefaultsRegistry = {
  schemaVersion: "approved-city-criteria-defaults-registry@1",
  byMappingVersion: {
    [DEFAULTS.mappingVersion]: {
      mappingVersion: DEFAULTS.mappingVersion,
      approvedFor: APPROVED_FOR,
      defaults: DEFAULTS,
    },
  },
};

const validateValue: CityFixedValueValidator = (input) => input.value;
const validateSourcePeriod: CityFixedSourcePeriodValidator = () => "fresh";

function behaviorRegistry(): InstalledCityPackageBehaviorRegistry {
  return {
    schemaVersion: "installed-city-package-behavior-registry@1",
    entries: [{
      approvedFor: APPROVED_FOR,
      versionKey: {
        evaluatorRegistryVersionId: "synthetic-evaluator-registry@1",
        evaluatorVersionIds: Object.fromEntries(CITY_CRITERION_IDS.map((criterionId) => [
          criterionId,
          EVALUATORS[criterionId].definition.evaluatorVersion,
        ])) as Readonly<Record<(typeof CITY_CRITERION_IDS)[number], string>>,
        valueValidatorVersionId: "synthetic-value-validator@1",
        sourcePeriodValidatorVersionId: "synthetic-period-validator@1",
      },
      fixedPolicyVersionsBySourceId: Object.fromEntries(FIXED_SOURCE_IDS.map((sourceId) => [
        sourceId,
        {
          valuePolicyVersion: "canonical-scalar@1",
          sourcePeriodPolicyVersion: "annual-period@1",
        },
      ])) as InstalledCityPackageBehaviorRegistry["entries"][number]["fixedPolicyVersionsBySourceId"],
      evaluatorRegistry: evaluatorRegistry(),
      validateValue,
      validateSourcePeriod,
    }],
  };
}

function publisher(
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

async function preparedInput(
  db: Database.Database,
  suffix: "a" | "b",
  installedAt: string,
): Promise<InstalledCityPackageManifestAppendInput> {
  const catalogEvidenceId = `catalog-evidence:${suffix}`;
  const registry = buildCityRegistryRevision({
    packageId: APPROVED_FOR.packageId,
    packageSchemaVersion: APPROVED_FOR.packageSchemaVersion,
    countryCode: APPROVED_FOR.countryCode,
    evidenceSnapshotId: catalogEvidenceId,
    entries: [{
      cityId: CITY_ID,
      countryCode: "SI",
      officialName: "Ljubljana",
      coordinate: { lat: 46.05, lng: 14.51 },
      administrativeType: "central_urban_settlement",
      administrativeTerritory: "Mestna občina Ljubljana",
      capitalRoles: ["national"],
      evidenceReferenceIds: [catalogEvidenceId],
    }, {
      cityId: SECOND_CITY_ID,
      countryCode: "SI",
      officialName: "Maribor",
      coordinate: { lat: 46.55, lng: 15.65 },
      administrativeType: "central_urban_settlement",
      administrativeTerritory: "Mestna občina Maribor",
      capitalRoles: [],
      evidenceReferenceIds: [catalogEvidenceId],
    }],
    createdAt: suffix === "a"
      ? "2026-01-01T00:00:00.000Z"
      : "2026-01-02T00:00:00.000Z",
  }, INTEGRITY);
  const catalog = buildCityCatalogRevision({
    registry,
    evidenceSnapshotId: catalogEvidenceId,
    populationDefinition: {
      definitionId: "surs-settlement-population@1",
      geoScope: "settlement",
      unit: "people",
    },
    candidateBasis: [{
      cityId: CITY_ID,
      comparablePopulation: {
        kind: "verified",
        value: suffix === "a" ? "300000" : "300001",
        referencePeriod: "2026-01-01",
      },
    }, {
      cityId: SECOND_CITY_ID,
      comparablePopulation: {
        kind: "verified",
        value: suffix === "a" ? "114301" : "114302",
        referencePeriod: "2026-01-01",
      },
    }],
    coverage: { status: "complete" },
    createdAt: suffix === "a"
      ? "2026-01-01T00:00:00.000Z"
      : "2026-01-02T00:00:00.000Z",
  }, INTEGRITY);
  const catalogBundle = new SqliteCityCatalogStore(db, INTEGRITY)
    .appendVerified({ registry, catalog });
  const officialAuthorityDirectory = buildOfficialAuthorityDirectory({
    schemaVersion: "official-authority-directory@1",
    countryCode: "SI",
    catalogRevisionId: catalog.id,
    requiredPublisherIds: { police: "police", gov: "gov", opsi: "opsi", surs: "surs" },
    publishers: [
      publisher("municipality-ljubljana", "municipality", "https://ljubljana.si/"),
      publisher("municipality-maribor", "municipality", "https://maribor.si/"),
      publisher("police", "police", "https://policija.si/"),
      publisher("gov", "government", "https://gov.si/"),
      publisher("opsi", "open_data", "https://podatki.gov.si/"),
      publisher("surs", "statistics", "https://pxweb.stat.si/"),
    ],
    municipalities: [{
      cityId: CITY_ID,
      settlementCode: "061001",
      municipalityCode: "061",
      officialCityNames: ["Ljubljana"],
      officialMunicipalityNames: ["Mestna občina Ljubljana"],
      publisherId: "municipality-ljubljana",
      officialHost: "ljubljana.si",
    }, {
      cityId: SECOND_CITY_ID,
      settlementCode: "070001",
      municipalityCode: "070",
      officialCityNames: ["Maribor"],
      officialMunicipalityNames: ["Mestna občina Maribor"],
      publisherId: "municipality-maribor",
      officialHost: "maribor.si",
    }],
    rulesVersion: "slovenia-official-authorities@1",
  }, INTEGRITY);
  const safetySourcePlan = buildCitySafetySourcePlan({
    catalog,
    directory: officialAuthorityDirectory,
    entries: [{
      cityId: CITY_ID,
      settlementCode: "061001",
      municipalityCode: "061",
      officialCityNames: ["Ljubljana"],
      officialMunicipalityNames: ["Mestna občina Ljubljana"],
      publisherIds: ["municipality-ljubljana", "police", "surs"],
      configuredRoutes: [{
        publisherId: "municipality-ljubljana",
        navigationUrl: `https://ljubljana.si/safety/${suffix}`,
      }],
    }, {
      cityId: SECOND_CITY_ID,
      settlementCode: "070001",
      municipalityCode: "070",
      officialCityNames: ["Maribor"],
      officialMunicipalityNames: ["Mestna občina Maribor"],
      publisherIds: ["municipality-maribor", "police", "surs"],
      configuredRoutes: [{
        publisherId: "municipality-maribor",
        navigationUrl: `https://maribor.si/safety/${suffix}`,
      }],
    }],
  }, INTEGRITY);
  const fixedPlansByCityId = {
    [CITY_ID]: [
      fixedPlan("si-city-long-term-rent", suffix),
      fixedPlan("si-city-urban-transit", suffix),
      fixedPlan("si-city-fixed-broadband", suffix),
    ],
    [SECOND_CITY_ID]: [
      fixedPlan("si-city-long-term-rent", suffix, SECOND_CITY_ID),
      fixedPlan("si-city-urban-transit", suffix, SECOND_CITY_ID),
      fixedPlan("si-city-fixed-broadband", suffix, SECOND_CITY_ID),
    ],
  } as const;
  const ready = {
    definition: {
      packageId: APPROVED_FOR.packageId,
      packageSchemaVersion: APPROVED_FOR.packageSchemaVersion,
      countryCode: APPROVED_FOR.countryCode,
      evidenceRulesVersion: APPROVED_FOR.evidenceRulesVersion,
      sourceIds: [...SLOVENIA_CITY_FACT_SOURCE_IDS],
    },
    sourceContractStatus: "bounded_verified_or_unknown" as const,
    readiness: { status: "ready" as const, issues: [] as const },
  };
  const key = {
    countryCode: ready.definition.countryCode,
    packageId: ready.definition.packageId,
    packageSchemaVersion: ready.definition.packageSchemaVersion,
    catalogRevisionId: catalog.id,
    evidenceRulesVersion: ready.definition.evidenceRulesVersion,
  };
  const administrativeEvidence = await sealCityPackageAdministrativeEvidence({
    key,
    installedAt,
    catalogMemberIds: catalog.members.map(({ cityId }) => cityId),
    fixedPlansByCityId,
    safetySourcePlan,
    officialAuthorityDirectory,
    criteriaDefaults: DEFAULTS,
    criterionDefinitions: DEFINITIONS,
  }, {
    store: new SqliteAdministrativeEvidenceStore(db, INTEGRITY),
    integrity: INTEGRITY,
  });
  return {
    ready,
    catalog: catalogBundle,
    administrativeEvidence,
    fixedPlansByCityId,
    safetySourcePlan,
    officialAuthorityDirectory,
    criteriaDefaults: DEFAULTS,
    criterionDefinitions: DEFINITIONS,
    installedAt,
  };
}

function unavailableEntry(
  sourceId: SloveniaCityFactSourceId,
  navigationUrl: string,
  versionHint?: string,
): TerminalEvidenceEntry<SloveniaCityFactSourceId, CityEvidenceClaim> {
  return {
    sourceId,
    parserEntry: {
      sourceId,
      navigationUrl,
      resolvedEvidenceUrl: navigationUrl,
      artifacts: [],
      ...(versionHint === undefined ? {} : { versionHint }),
    },
    coverage: "unavailable",
    blocker: {
      sourceId,
      kind: "not_found",
      navigationUrl,
      resolvedUrl: navigationUrl,
      artifactIds: [],
    },
  };
}

function unknownFixedLedger<S extends SloveniaCityFixedSourceId>(
  plan: CityFixedSourcePlan<S>,
  runId: string,
  assessmentAt: string,
  completedAt: string,
): CityFixedAttemptLedger<S> {
  return {
    schemaVersion: "city-fixed-attempt-ledger@1",
    cityCheckRunId: runId,
    cityId: CITY_ID,
    sourceId: plan.sourceId,
    criterionId: plan.criterionId,
    planId: plan.planId,
    definitionId: plan.definitionId,
    valuePolicyVersion: plan.claimContract.valuePolicyVersion,
    sourcePeriodPolicyVersion: plan.claimContract.sourcePeriodPolicyVersion,
    parserVersion: plan.parserVersion,
    rulesVersion: plan.rulesVersion,
    assessmentAt,
    attempts: [{
      cityCheckRunId: runId,
      sourceId: plan.sourceId,
      index: 0,
      routeId: plan.routes[0]!.routeId,
      navigationUrl: plan.routes[0]!.navigationUrl,
      attemptedAt: assessmentAt,
      disposition: "rejected",
      reason: "http_not_found",
      artifactIds: [],
    }],
    result: { kind: "unknown", reason: "not_found" },
    completedAt,
  };
}

function liveArtifact<S extends SloveniaCityFactSourceId>(input: {
  readonly artifactId: string;
  readonly runId: string;
  readonly sourceId: S;
  readonly role: string;
  readonly url: string;
  readonly text: string;
  readonly capturedAt: string;
  readonly request?: LiveCapturedArtifact<S>["request"];
}): LiveCapturedArtifact<S> {
  const bytes = new TextEncoder().encode(input.text);
  return {
    artifactId: input.artifactId,
    runId: input.runId,
    sourceId: input.sourceId,
    role: input.role,
    url: input.url,
    mediaType: input.sourceId === "si-city-long-term-rent"
      ? "application/json"
      : "application/pdf",
    sha256: sha256(bytes),
    bytes,
    origin: "live",
    capturedAt: input.capturedAt,
    responseStatus: 200,
    responseUrl: input.url,
    request: input.request ?? { method: "GET", url: input.url },
  };
}

async function cityEvidenceInput(
  prepared: InstalledCityPackageManifestAppendInput,
  sequence: number,
  priorEvidenceSnapshotId?: string,
  includeVerifiedRent = true,
  includeUnknownSafetyQueries = false,
): Promise<CityEvidenceSealInput> {
  const runId = `city-check:si:ljubljana:chain-${String(sequence)}`;
  const assessmentAt = new Date(Date.parse("2026-03-01T00:00:00.000Z") + sequence * 60_000)
    .toISOString();
  const at = (milliseconds: number): string =>
    new Date(Date.parse(assessmentAt) + milliseconds).toISOString();
  const fixedPlans = prepared.fixedPlansByCityId[CITY_ID]!;
  const safetyEntry = prepared.safetySourcePlan.entries
    .find(({ cityId }) => cityId === CITY_ID)!;
  const municipality = prepared.officialAuthorityDirectory.municipalities
    .find(({ cityId }) => cityId === CITY_ID)!;
  const municipalUrl = safetyEntry.configuredRoutes[0]!.navigationUrl;
  const denominatorUrl = "https://pxweb.stat.si/population";
  const rentUrl = `${fixedPlans[0].routes[0]!.navigationUrl}/resolved`;
  const rentArtifact = liveArtifact({
    artifactId: `rent-fixed-artifact-${String(sequence)}`,
    runId,
    sourceId: "si-city-long-term-rent",
    role: "official_dataset",
    url: rentUrl,
    text: `verified fixed-source bytes ${String(sequence)}`,
    capturedAt: at(500),
  });
  const municipalArtifact = liveArtifact({
    artifactId: `municipal-safety-${String(sequence)}`,
    runId,
    sourceId: "si-city-safety",
    role: "municipal_source",
    url: municipalUrl,
    text: `municipal raw PDF bytes ${String(sequence)}`,
    capturedAt: at(500),
  });
  const denominatorArtifact = liveArtifact({
    artifactId: `surs-population-${String(sequence)}`,
    runId,
    sourceId: "si-city-safety",
    role: "surs_denominator",
    url: denominatorUrl,
    text: `SURS raw response bytes ${String(sequence)}`,
    capturedAt: at(500),
    request: {
      method: "POST",
      url: denominatorUrl,
      bodyMediaType: "application/json",
      bodySha256: "c".repeat(64),
    },
  });
  const rentClaim: CityFixedEvidenceClaim<"si-city-long-term-rent"> = {
    claimId: `rent-fixed-claim-${String(sequence)}`,
    sourceId: fixedPlans[0].sourceId,
    value: { kind: "canonical_scalar", value: "9.5" },
    scope: fixedPlans[0].claimContract.scope,
    sourcePeriod: "2025",
    anchor: {
      artifactId: rentArtifact.artifactId,
      locator: rentArtifact.url,
      excerptSha256: rentArtifact.sha256,
    },
    status: "verified",
    criterionId: fixedPlans[0].criterionId,
    definitionId: fixedPlans[0].definitionId,
    officialAreaId: fixedPlans[0].claimContract.officialAreaId,
    geoScope: fixedPlans[0].claimContract.geoScope,
    unit: fixedPlans[0].claimContract.unit,
    denominator: fixedPlans[0].claimContract.denominator,
    freshnessPolicyVersion: fixedPlans[0].claimContract.freshnessPolicyVersion,
  };
  const rentLedger: CityFixedAttemptLedger<"si-city-long-term-rent"> = {
    schemaVersion: "city-fixed-attempt-ledger@1",
    cityCheckRunId: runId,
    cityId: CITY_ID,
    sourceId: fixedPlans[0].sourceId,
    criterionId: fixedPlans[0].criterionId,
    planId: fixedPlans[0].planId,
    definitionId: fixedPlans[0].definitionId,
    valuePolicyVersion: fixedPlans[0].claimContract.valuePolicyVersion,
    sourcePeriodPolicyVersion: fixedPlans[0].claimContract.sourcePeriodPolicyVersion,
    parserVersion: fixedPlans[0].parserVersion,
    rulesVersion: fixedPlans[0].rulesVersion,
    assessmentAt,
    attempts: [{
      cityCheckRunId: runId,
      sourceId: fixedPlans[0].sourceId,
      index: 0,
      routeId: fixedPlans[0].routes[0]!.routeId,
      navigationUrl: fixedPlans[0].routes[0]!.navigationUrl,
      resolvedEvidenceUrl: rentUrl,
      attemptedAt: assessmentAt,
      disposition: "accepted",
      artifactIds: [rentArtifact.artifactId],
      claimIds: [rentClaim.claimId],
    }],
    result: { kind: "verified", claimIds: [rentClaim.claimId] },
    completedAt: at(1_000),
  };
  const references = [{
    role: "municipal_source" as const,
    documentRole: "terminal_claim" as const,
    artifactId: municipalArtifact.artifactId,
    artifactSha256: municipalArtifact.sha256,
    sourceSha256: municipalArtifact.sha256,
    locator: municipalUrl,
  }, {
    role: "surs_denominator" as const,
    artifactId: denominatorArtifact.artifactId,
    artifactSha256: denominatorArtifact.sha256,
    sourceSha256: denominatorArtifact.sha256,
    locator: denominatorUrl,
  }] satisfies readonly CitySafetyArtifactReference[];
  const quantity = {
    offenceCount: "1200",
    population: "300000",
    rateBasis: "offences_per_100000_residents" as const,
  };
  const safetyQueries = includeUnknownSafetyQueries
    ? buildCitySafetyQueries(
        safetyEntry,
        prepared.officialAuthorityDirectory,
        assessmentAt,
        prepared.catalog.catalog,
        INTEGRITY,
      ).map((query, index) => ({
        index,
        queryId: `city-safety-query:${runId}:${String(index + 1)}`,
        queryTemplateVersion: "slovenia-municipal-safety-query@1" as const,
        providerId: "synthetic-search",
        query,
        searchedAt: at(1_500 + index * 500),
        outcome: { kind: "completed" as const, returnedUrls: [] },
      }))
    : [];
  const safetyCandidates = includeUnknownSafetyQueries
    ? [{
        index: 0,
        origin: { kind: "configured" as const, configuredRouteIndex: 0 },
        canonicalUrl: municipalUrl,
        officialTrace: {
          initialUrl: municipalUrl,
          edges: [],
          lastTrustedUrl: municipalUrl,
          officialHops: 0,
          failure: {
            captureKind: "http_error" as const,
            responseStatus: 404,
            responseUrl: municipalUrl,
          },
        },
        artifactRefs: [],
        disposition: "rejected" as const,
        reason: "http_not_found" as const,
      }]
    : [{
        index: 0,
        origin: priorEvidenceSnapshotId === undefined
          ? { kind: "configured" as const, configuredRouteIndex: 0 }
          : {
              kind: "previous" as const,
              priorSourcePlanId: prepared.safetySourcePlan.id,
              priorEvidenceSnapshotId,
            },
        canonicalUrl: municipalUrl,
        publisherId: "municipality-ljubljana",
        dataAuthorityId: "police",
        publisherNavigationUrl: municipalUrl,
        resolvedEvidenceUrl: municipalUrl,
        officialTrace: {
          initialUrl: municipalUrl,
          edges: [],
          lastTrustedUrl: municipalUrl,
          officialHops: 0,
        },
        mediaType: "application/pdf",
        retentionPolicyId: "municipality-ljubljana-retention@1",
        transientRawDeleted: false,
        artifactRefs: references,
        disposition: "usable" as const,
        referenceYear: 2025,
        periodDisposition: "preferred" as const,
        quantity,
        denominator: {
          publisherId: "surs",
          municipalityCode: municipality.municipalityCode,
          referenceDate: "2025-01-01",
          population: "300000",
          artifactId: denominatorArtifact.artifactId,
          mediaType: "application/pdf",
          retentionPolicyId: "surs-retention@1",
          transientRawDeleted: false,
        },
      }];
  const safetyLedger: CitySafetyAttemptLedger = {
    schemaVersion: "city-safety-attempt-ledger@1",
    catalogRevisionId: prepared.catalog.catalog.id,
    authorityDirectoryId: prepared.officialAuthorityDirectory.id,
    sourcePlanId: prepared.safetySourcePlan.id,
    cityId: CITY_ID,
    municipalityCode: municipality.municipalityCode,
    assessmentAt,
    definitionId: "si-municipal-police-offences-per-100000@1",
    freshnessPolicyVersion: "municipal-annual-july-boundary@1",
    discoveryRulesVersion: "city-safety-discovery@1",
    queries: safetyQueries,
    candidates: safetyCandidates,
    counters: { queries: safetyQueries.length, candidates: 1, maxOfficialHops: 0 },
    result: includeUnknownSafetyQueries
      ? { kind: "unknown", reason: "not_found" }
      : { kind: "verified", quantity, referenceYear: 2025, acceptedCandidateIndex: 0 },
    completedAt: at(4_000),
  };
  const safetyTerminal = citySafetyTerminalEntry({
    cityCheckRunId: runId,
    ledger: safetyLedger,
    artifacts: includeUnknownSafetyQueries ? [] : [municipalArtifact, denominatorArtifact],
    sourcePlan: prepared.safetySourcePlan,
    authorityDirectory: prepared.officialAuthorityDirectory,
  });
  const rentTerminal: TerminalEvidenceEntry<SloveniaCityFactSourceId, CityEvidenceClaim> = {
    sourceId: fixedPlans[0].sourceId,
    parserEntry: {
      sourceId: fixedPlans[0].sourceId,
      navigationUrl: fixedPlans[0].routes[0]!.navigationUrl,
      resolvedEvidenceUrl: rentUrl,
      artifacts: [rentArtifact],
      versionHint: fixedPlans[0].parserVersion,
    },
    coverage: "verified",
    claims: [rentClaim],
  };
  const evidenceContext: CityEvidenceContext = {
    schemaVersion: "city-evidence-context@1",
    cityCheckRunId: runId,
    frontierRunId: `frontier:si:${String(sequence)}`,
    cityId: CITY_ID,
    countryCode: "SI",
    packageId: APPROVED_FOR.packageId,
    packageSchemaVersion: APPROVED_FOR.packageSchemaVersion,
    catalogRevisionId: prepared.catalog.catalog.id,
    criteriaSnapshotId: `criteria:si:${String(sequence)}`,
    rankingSnapshotId: `ranking:si:${String(sequence)}`,
    definitionIds: Object.fromEntries(CITY_CRITERION_IDS.map((criterionId) => [
      criterionId,
      EVALUATORS[criterionId].definition.definitionId,
    ])) as CityEvidenceContext["definitionIds"],
    evidenceRulesVersion: APPROVED_FOR.evidenceRulesVersion,
    assessmentAt,
    completedAt: at(10_000),
  };
  const genericEvidence = await sealEvidencePlan({
    id: `${runId}:evidence`,
    assessmentDate: assessmentAt.slice(0, 10),
    entries: [
      safetyTerminal,
      includeVerifiedRent
        ? rentTerminal
        : unavailableEntry(
            fixedPlans[0].sourceId,
            fixedPlans[0].routes[0]!.navigationUrl,
            fixedPlans[0].parserVersion,
          ),
      unavailableEntry(
        fixedPlans[1].sourceId,
        fixedPlans[1].routes[0]!.navigationUrl,
        fixedPlans[1].parserVersion,
      ),
      unavailableEntry(
        fixedPlans[2].sourceId,
        fixedPlans[2].routes[0]!.navigationUrl,
        fixedPlans[2].parserVersion,
      ),
    ],
    sourceIds: SLOVENIA_CITY_FACT_SOURCE_IDS,
    parserVersions: {
      "si-city-safety": SLOVENIA_CITY_FACT_VERSIONS["si-city-safety"].parserVersion,
      "si-city-long-term-rent": fixedPlans[0].parserVersion,
      "si-city-urban-transit": fixedPlans[1].parserVersion,
      "si-city-fixed-broadband": fixedPlans[2].parserVersion,
    },
    rulesVersion: evidenceContext.evidenceRulesVersion,
    contextHash: cityEvidenceContextHash(evidenceContext, INTEGRITY),
  }, INTEGRITY);
  return {
    ...evidenceContext,
    genericEvidence,
    artifacts: [
      ...(includeUnknownSafetyQueries ? [] : [municipalArtifact, denominatorArtifact]),
      ...(includeVerifiedRent ? [rentArtifact] : []),
    ],
    fixedAttemptLedgers: [
      includeVerifiedRent
        ? rentLedger
        : unknownFixedLedger(fixedPlans[0], runId, assessmentAt, at(1_000)),
      unknownFixedLedger(fixedPlans[1], runId, assessmentAt, at(2_000)),
      unknownFixedLedger(fixedPlans[2], runId, assessmentAt, at(3_000)),
    ],
    safetyAttemptLedger: safetyLedger,
  };
}

interface HistoricalHarness {
  readonly database: Database.Database;
  readonly input: Parameters<typeof replayCityEvidence>[0];
  readonly read: SqliteCityEvidenceStore;
  readonly packages: InstalledCityPackages;
  readonly verifiedById: ReadonlyMap<string, VerifiedCityEvidence>;
  readonly contractA: CityPackageEvidenceReplayContract;
  readonly evidenceIds: readonly [string, string, string];
  readonly packageKeyA: CityPackageEvidenceReplayContract["installedPackageManifest"]["key"];
  readonly packageKeyB: CityPackageEvidenceReplayContract["installedPackageManifest"]["key"];
  readonly preparedA: InstalledCityPackageManifestAppendInput;
}

async function historicalHarness(): Promise<HistoricalHarness> {
  const path = temporaryDatabasePath();
  const first = database(path);
  const behaviors = behaviorRegistry();
  const manifestStore = new SqliteCityPackageManifestStore(
    first,
    INTEGRITY,
    APPROVED_DEFAULTS,
    behaviors,
  );
  const preparedA = await preparedInput(first, "a", "2026-01-10T00:00:00.000Z");
  const manifestA = manifestStore.appendPrepared(preparedA);
  const installed = new InstalledCityPackages(manifestStore);
  const evidenceStore = new SqliteCityEvidenceStore(first, INTEGRITY, installed);
  const firstInput = await cityEvidenceInput(preparedA, 0);
  const firstSnapshot = evidenceStore.seal(firstInput);
  const secondInput = await cityEvidenceInput(preparedA, 1, firstSnapshot.id);
  const secondSnapshot = evidenceStore.seal(secondInput);
  const thirdInput = await cityEvidenceInput(preparedA, 2, secondSnapshot.id);
  const thirdSnapshot = evidenceStore.seal(thirdInput);
  const verifiedById = new Map([
    [firstSnapshot.id, evidenceStore.loadVerified(firstSnapshot.id)],
    [secondSnapshot.id, evidenceStore.loadVerified(secondSnapshot.id)],
    [thirdSnapshot.id, evidenceStore.loadVerified(thirdSnapshot.id)],
  ] as const);
  const contractA = installed.loadExactReplayContract(manifestA.key);
  if (contractA === undefined) throw new Error("missing_a_fixture");
  const preparedB = await preparedInput(first, "b", "2026-03-02T00:00:00.000Z");
  const manifestB = manifestStore.appendPrepared(preparedB);
  first.close();

  const restarted = database(path);
  const restartedManifestStore = new SqliteCityPackageManifestStore(
    restarted,
    INTEGRITY,
    APPROVED_DEFAULTS,
    behaviorRegistry(),
  );
  const packages = new InstalledCityPackages(restartedManifestStore);
  const read = new SqliteCityEvidenceStore(restarted, INTEGRITY, packages);
  return {
    database: restarted,
    input: {
      evidenceSnapshotId: thirdSnapshot.id,
      cityId: CITY_ID,
      packageId: APPROVED_FOR.packageId,
    },
    read,
    packages,
    verifiedById,
    contractA,
    evidenceIds: [firstSnapshot.id, secondSnapshot.id, thirdSnapshot.id],
    packageKeyA: manifestA.key,
    packageKeyB: manifestB.key,
    preparedA,
  };
}

function cloneVerified(value: VerifiedCityEvidence): VerifiedCityEvidence {
  return structuredClone(value);
}

function cloneContract(
  value: CityPackageEvidenceReplayContract,
): CityPackageEvidenceReplayContract {
  const key = Object.freeze(structuredClone(value.installedPackageManifest.key));
  const installedPackageManifest = Object.freeze({
    id: value.installedPackageManifest.id,
    key,
  });
  return {
    installedPackageManifest,
    definition: structuredClone(value.definition),
    catalogProjection: structuredClone(value.catalogProjection),
    fixedPlansByCityId: structuredClone(value.fixedPlansByCityId),
    safetySourcePlan: structuredClone(value.safetySourcePlan),
    officialAuthorityDirectory: structuredClone(value.officialAuthorityDirectory),
    validateValue: value.validateValue,
    validateSourcePeriod: value.validateSourcePeriod,
  };
}

function contractWithCatalogRules(
  value: CityPackageEvidenceReplayContract,
  rulesVersion: string,
): CityPackageEvidenceReplayContract {
  const contract = cloneContract(value);
  const { id: _catalogId, ...currentCatalog } = contract.catalogProjection.catalog;
  void _catalogId;
  const catalogPayload = {
    ...currentCatalog,
    members: currentCatalog.members.map((member) => ({
      ...member,
      inclusionReasons: ["population_threshold", ...(member.cityId === CITY_ID
        ? ["national_capital" as const]
        : [])],
    })),
    rulesVersion,
  };
  const catalog = {
    id: `city-catalog:${INTEGRITY.hash(INTEGRITY.canonical(catalogPayload))}`,
    ...catalogPayload,
  } as CityCatalogRevision;
  const { id: _directoryId, ...currentDirectory } = contract.officialAuthorityDirectory;
  void _directoryId;
  const directoryPayload = { ...currentDirectory, catalogRevisionId: catalog.id };
  const officialAuthorityDirectory = {
    id: `official-authority-directory:${INTEGRITY.hash(INTEGRITY.canonical(directoryPayload))}`,
    ...directoryPayload,
  };
  const { id: _sourcePlanId, ...currentSourcePlan } = contract.safetySourcePlan;
  void _sourcePlanId;
  const sourcePlanPayload = {
    ...currentSourcePlan,
    catalogRevisionId: catalog.id,
    authorityDirectoryId: officialAuthorityDirectory.id,
  };
  const safetySourcePlan = {
    id: `city-safety-source-plan:${INTEGRITY.hash(INTEGRITY.canonical(sourcePlanPayload))}`,
    ...sourcePlanPayload,
  };
  const key = Object.freeze({
    ...contract.installedPackageManifest.key,
    catalogRevisionId: catalog.id,
  });
  return {
    ...contract,
    installedPackageManifest: Object.freeze({
      id: `${contract.installedPackageManifest.id}:${rulesVersion}`,
      key,
    }),
    catalogProjection: { registry: contract.catalogProjection.registry, catalog },
    officialAuthorityDirectory,
    safetySourcePlan,
  } as CityPackageEvidenceReplayContract;
}

function fakePorts(
  harness: HistoricalHarness,
  overrides: Partial<CityEvidenceReplayPorts> = {},
): CityEvidenceReplayPorts {
  return {
    read: {
      loadVerified(id) {
        const value = harness.verifiedById.get(id);
        if (value === undefined) throw new Error("city_evidence_not_found");
        return cloneVerified(value);
      },
      findVerifiedByCheckRunId: () => {
        throw new Error("forbidden_current_lookup");
      },
    },
    integrity: createCityEvidenceReplayIntegrity(INTEGRITY),
    package: {
      loadExactReplayContract(key) {
        return INTEGRITY.canonical(key) === INTEGRITY.canonical(harness.packageKeyA)
          ? cloneContract(harness.contractA)
          : undefined;
      },
    },
    ...overrides,
  };
}

function replayComparable(value: VerifiedCityEvidence): unknown {
  const owned = structuredClone(value) as unknown as {
    genericEvidence: { entries: Array<{ artifacts: Array<{ bytes: Uint8Array }> }> };
  };
  for (const entry of owned.genericEvidence.entries) {
    for (const artifact of entry.artifacts) {
      (artifact as unknown as { bytes: number[] }).bytes = [...artifact.bytes];
    }
  }
  return owned;
}

function expectFrozenMetadata(value: unknown): void {
  const visited = new Set<object>();
  const visit = (candidate: unknown): void => {
    if (candidate === null || typeof candidate !== "object" || candidate instanceof Uint8Array ||
      visited.has(candidate)) return;
    visited.add(candidate);
    expect(Object.isFrozen(candidate)).toBe(true);
    for (const item of Object.values(candidate)) visit(item);
  };
  visit(value);
}

function artifactBytes(value: VerifiedCityEvidence): Uint8Array[] {
  return value.genericEvidence.entries.flatMap(({ artifacts }) =>
    artifacts.map(({ bytes }) => bytes));
}

function expectPrivateBytes(bytes: Uint8Array): void {
  expect(bytes.byteOffset).toBe(0);
  expect(bytes.buffer.byteLength).toBe(bytes.byteLength);
  expect(typeof SharedArrayBuffer === "undefined" ||
    !(bytes.buffer instanceof SharedArrayBuffer)).toBe(true);
}

function rejectedWith(code: string) {
  return expect.objectContaining({ message: code });
}

type MutableRecord = Record<string, unknown>;

function asMutable(value: unknown): MutableRecord {
  return value as MutableRecord;
}

function rehashOverlay(value: VerifiedCityEvidence): void {
  const mutable = value.snapshot as unknown as MutableRecord;
  const payload = Object.fromEntries(Object.entries(mutable)
    .filter(([key]) => key !== "payloadHash" && key !== "hmac"));
  mutable.payloadHash = INTEGRITY.hash(INTEGRITY.canonical(payload));
  mutable.hmac = INTEGRITY.sign(INTEGRITY.canonical(payload));
}

function resealGeneric(value: VerifiedCityEvidence): void {
  const snapshot = asMutable(value.genericEvidence.snapshot);
  const manifestSnapshot = Object.fromEntries(Object.entries(structuredClone(snapshot))
    .filter(([key]) => key !== "manifestHash" && key !== "hmac"));
  (value.genericEvidence.manifest as unknown as MutableRecord).snapshot = manifestSnapshot;
  const canonicalManifest = INTEGRITY.canonical(value.genericEvidence.manifest);
  snapshot.manifestHash = INTEGRITY.hash(canonicalManifest);
  snapshot.hmac = INTEGRITY.sign(canonicalManifest);
}

function resealContext(value: VerifiedCityEvidence): void {
  const snapshot = value.snapshot;
  const context: CityEvidenceContext = {
    schemaVersion: "city-evidence-context@1",
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
  };
  const contextHash = cityEvidenceContextHash(context, INTEGRITY);
  asMutable(value.snapshot).contextHash = contextHash;
  asMutable(value.genericEvidence.snapshot).contextHash = contextHash;
  resealGeneric(value);
  rehashOverlay(value);
}

function containsBytes(value: unknown, visited = new Set<object>()): boolean {
  if (value instanceof Uint8Array) return true;
  if (value === null || typeof value !== "object" || visited.has(value)) return false;
  visited.add(value);
  return Object.values(value).some((item) => containsBytes(item, visited));
}

describe("replayCityEvidence", () => {
  test("exports only the closed proof use case and accepts no outer capability", () => {
    expect(Object.keys(replayModule)).toEqual(["replayCityEvidence"]);
    expectTypeOf<keyof Parameters<typeof replayCityEvidence>[0]>()
      .toEqualTypeOf<"evidenceSnapshotId" | "cityId" | "packageId">();
    expectTypeOf<keyof Parameters<typeof replayCityEvidence>[1]>()
      .toEqualTypeOf<"read" | "integrity" | "package">();

    const compileBoundary = (ports: Parameters<typeof replayCityEvidence>[1]): void => {
      // @ts-expect-error Task 6 receives no signing capability.
      void ports.integrity.sign;
      // @ts-expect-error Task 6 receives no live-source capability.
      void ports.source;
      // @ts-expect-error Task 6 receives no search capability.
      void ports.search;
      // @ts-expect-error Task 6 receives no request capability.
      void ports.request;
      // @ts-expect-error Task 6 receives no database capability.
      void ports.database;
    };
    expectTypeOf(compileBoundary).toBeFunction();

    const source = readFileSync(
      join(process.cwd(), "src/application/replay-city-evidence.ts"),
      "utf8",
    );
    expect(source).not.toMatch(/node:crypto|\/infrastructure\/|canonicalJson|createEvidenceIntegrity/);
    expect(source).not.toMatch(
      /findReady|latest|Date\.now|new Date|randomUUID|fetch|RequestStep|runCity|CityFixedRoutePort|CitySafetyOfficialDocumentPort|CitySafetySearchPort|OfficialSourcePort/,
    );
    expect(source).toContain('"findVerifiedByCheckRunId"');
    expect(source).not.toMatch(/findVerifiedByCheckRunId\s*\(/);
  });

  test("replays historical A twice after B and restart with no live call or fallback", async () => {
    const harness = await historicalHarness();
    const exactKeys: unknown[] = [];
    const readIds: string[] = [];
    const forbiddenCurrent = vi.fn(() => {
      throw new Error("forbidden_current_lookup");
    });
    const ports: CityEvidenceReplayPorts = {
      read: {
        loadVerified(id) {
          readIds.push(id);
          return harness.read.loadVerified(id);
        },
        findVerifiedByCheckRunId: forbiddenCurrent,
      },
      integrity: createCityEvidenceReplayIntegrity(INTEGRITY),
      package: {
        loadExactReplayContract(key) {
          exactKeys.push(structuredClone(key));
          return harness.packages.loadExactReplayContract(key);
        },
      },
    };

    const first = await replayCityEvidence(harness.input, ports);
    const firstBytesBeforeMutation = artifactBytes(first).map((bytes) => [...bytes]);
    artifactBytes(first)[0]!.fill(0);
    const second = await replayCityEvidence(harness.input, ports);

    expect(INTEGRITY.canonical(replayComparable(second)))
      .toBe(INTEGRITY.canonical(replayComparable(await replayCityEvidence(harness.input, ports))));
    expect(INTEGRITY.canonical(replayComparable(second))).toBe(INTEGRITY.canonical(replayComparable(
      harness.verifiedById.get(harness.evidenceIds[2])!,
    )));
    expect(first).not.toBe(second);
    expect(artifactBytes(second).map((bytes) => [...bytes])).toEqual(firstBytesBeforeMutation);
    artifactBytes(second).forEach(expectPrivateBytes);
    expectFrozenMetadata(first);
    expectFrozenMetadata(second);
    expect(readIds.slice(0, 3)).toEqual([
      harness.evidenceIds[2],
      harness.evidenceIds[1],
      harness.evidenceIds[0],
    ]);
    expect(exactKeys.slice(0, 3)).toHaveLength(3);
    expect(exactKeys.every((key) => INTEGRITY.canonical(key) ===
      INTEGRITY.canonical(harness.packageKeyA))).toBe(true);
    expect(INTEGRITY.canonical(harness.packages.findReady("SI")?.installedPackageManifest.key))
      .toBe(INTEGRITY.canonical(harness.packageKeyB));
    expect(forbiddenCurrent).not.toHaveBeenCalled();
  });

  test("rejects malformed input before reflecting on otherwise valid ports", async () => {
    const harness = await historicalHarness();
    const validPorts = fakePorts(harness);
    const portTrapCounts = {
      ownKeys: 0,
      getOwnPropertyDescriptor: 0,
      getPrototypeOf: 0,
      get: 0,
    };
    const hostilePorts = new Proxy(validPorts, {
      ownKeys() {
        portTrapCounts.ownKeys += 1;
        throw new Error("ports_own_keys_trap");
      },
      getOwnPropertyDescriptor() {
        portTrapCounts.getOwnPropertyDescriptor += 1;
        throw new Error("ports_descriptor_trap");
      },
      getPrototypeOf() {
        portTrapCounts.getPrototypeOf += 1;
        throw new Error("ports_prototype_trap");
      },
      get() {
        portTrapCounts.get += 1;
        throw new Error("ports_get_trap");
      },
    });
    let getterCalls = 0;
    const accessor = {
      evidenceSnapshotId: harness.input.evidenceSnapshotId,
      get cityId() {
        getterCalls += 1;
        return CITY_ID;
      },
      packageId: harness.input.packageId,
    };
    const withSymbol = { ...harness.input } as MutableRecord;
    Object.defineProperty(withSymbol, Symbol("extra"), { value: true, enumerable: true });
    const proxied = new Proxy({ ...harness.input }, {
      ownKeys() { throw new Error("input_proxy_trap"); },
    });
    const malformed: readonly unknown[] = [
      accessor,
      withSymbol,
      { ...harness.input, extra: undefined },
      { evidenceSnapshotId: harness.input.evidenceSnapshotId, cityId: CITY_ID },
      Object.assign(Object.create({}), harness.input),
      proxied,
      { ...harness.input, evidenceSnapshotId: " bad" },
      { ...harness.input, cityId: "bad city" },
      { ...harness.input, packageId: "" },
    ];

    for (const value of malformed) {
      const getPrototypeOf = vi.spyOn(Object, "getPrototypeOf");
      const getOwnPropertyDescriptors = vi.spyOn(Object, "getOwnPropertyDescriptors");
      const getOwnPropertyNames = vi.spyOn(Object, "getOwnPropertyNames");
      await expect(replayCityEvidence(
        value as Parameters<typeof replayCityEvidence>[0],
        hostilePorts,
      )).rejects.toEqual(rejectedWith("integrity_mismatch"));
      expect(getPrototypeOf.mock.calls.filter(([candidate]) => candidate === validPorts)).toHaveLength(0);
      expect(getOwnPropertyDescriptors.mock.calls
        .filter(([candidate]) => candidate === validPorts)).toHaveLength(0);
      expect(getOwnPropertyNames.mock.calls.filter(([candidate]) => candidate === validPorts))
        .toHaveLength(0);
      vi.restoreAllMocks();
    }
    expect(getterCalls).toBe(0);
    expect(portTrapCounts).toEqual({
      ownKeys: 0,
      getOwnPropertyDescriptor: 0,
      getPrototypeOf: 0,
      get: 0,
    });
  });

  test("exact-closes the three ports and the no-sign replay integrity", async () => {
    const harness = await historicalHarness();
    const valid = fakePorts(harness);
    let nestedGetterCalls = 0;
    let rootGetterCalls = 0;
    const readAccessor = {
      get loadVerified() {
        nestedGetterCalls += 1;
        return valid.read.loadVerified;
      },
      findVerifiedByCheckRunId: valid.read.findVerifiedByCheckRunId,
    };
    const packageAccessor = {
      get loadExactReplayContract() {
        nestedGetterCalls += 1;
        return valid.package.loadExactReplayContract;
      },
    };
    const readWithSymbol = { ...valid.read };
    Object.defineProperty(readWithSymbol, Symbol("extra"), { value: true, enumerable: true });
    const packageWithSymbol = { ...valid.package };
    Object.defineProperty(packageWithSymbol, Symbol("extra"), { value: true, enumerable: true });
    const integrityWithSymbol = { ...valid.integrity };
    Object.defineProperty(integrityWithSymbol, Symbol("extra"), { value: true, enumerable: true });
    const rootWithSymbol = { ...valid };
    Object.defineProperty(rootWithSymbol, Symbol("extra"), { value: true, enumerable: true });
    const rootAccessor = {
      get read() {
        rootGetterCalls += 1;
        return valid.read;
      },
      integrity: valid.integrity,
      package: valid.package,
    };
    const integrityAccessor = {
      canonical: valid.integrity.canonical,
      get hash() {
        nestedGetterCalls += 1;
        return valid.integrity.hash;
      },
      hashBytes: valid.integrity.hashBytes,
    };
    const proxiedCanonical = new Proxy(valid.integrity.canonical, {
      apply() { throw new Error("integrity_function_proxy_called"); },
    });
    const liveCalls = {
      source: vi.fn(() => { throw new Error("live_source_called"); }),
      search: vi.fn(() => { throw new Error("live_search_called"); }),
      request: vi.fn(() => { throw new Error("live_request_called"); }),
    };
    const cases: unknown[] = [
      { ...valid, extra: undefined },
      { read: valid.read, integrity: valid.integrity },
      Object.assign(Object.create({}), valid),
      rootWithSymbol,
      rootAccessor,
      {
        ...valid,
        integrity: { ...valid.integrity, sign: () => "0".repeat(64) },
      },
      {
        ...valid,
        integrity: { canonical: valid.integrity.canonical, hash: valid.integrity.hash },
      },
      { ...valid, integrity: integrityAccessor },
      { ...valid, integrity: integrityWithSymbol },
      { ...valid, integrity: Object.assign(Object.create({}), valid.integrity) },
      { ...valid, integrity: new Proxy({ ...valid.integrity }, {
        ownKeys() { throw new Error("integrity_proxy_trap"); },
      }) },
      { ...valid, integrity: { ...valid.integrity, canonical: proxiedCanonical } },
      new Proxy({ ...valid }, { ownKeys() { throw new Error("ports_proxy_trap"); } }),
      { ...valid, read: readAccessor },
      { ...valid, package: packageAccessor },
      { ...valid, read: { loadVerified: valid.read.loadVerified } },
      { ...valid, package: {} },
      { ...valid, read: { ...valid.read, extra: undefined } },
      { ...valid, package: { ...valid.package, extra: undefined } },
      { ...valid, read: Object.assign(Object.create({}), valid.read) },
      { ...valid, package: Object.assign(Object.create({}), valid.package) },
      { ...valid, read: readWithSymbol },
      { ...valid, package: packageWithSymbol },
      { ...valid, ...liveCalls },
    ];
    for (const ports of cases) {
      await expect(replayCityEvidence(
        harness.input,
        ports as CityEvidenceReplayPorts,
      )).rejects.toEqual(rejectedWith("integrity_mismatch"));
    }
    expect(nestedGetterCalls).toBe(0);
    expect(rootGetterCalls).toBe(0);
    Object.values(liveCalls).forEach((spy) => expect(spy).not.toHaveBeenCalled());
  });

  test("captures synchronously before a caller or read callback can swap authority", async () => {
    const harness = await historicalHarness();
    const borrowedInput = { ...harness.input };
    const borrowedById = new Map([...harness.verifiedById].map(([id, value]) => [
      id,
      cloneVerified(value),
    ]));
    const borrowedContract = cloneContract(harness.contractA);
    const read = {
      loadVerified(id: string): VerifiedCityEvidence {
        const value = borrowedById.get(id);
        if (value === undefined) throw new Error("city_evidence_not_found");
        asMutable(borrowedInput).cityId = "mutated-after-load";
        return value;
      },
      findVerifiedByCheckRunId: () => { throw new Error("forbidden_current_lookup"); },
    };
    const packagePort = {
      loadExactReplayContract: () => borrowedContract,
    };
    const integrity = {
      ...createCityEvidenceReplayIntegrity(INTEGRITY),
    } as unknown as MutableRecord;
    const ports = { read, integrity, package: packagePort } as unknown as CityEvidenceReplayPorts;

    const pending = replayCityEvidence(borrowedInput, ports);
    asMutable(borrowedInput).evidenceSnapshotId = "mutated-after-return";
    read.loadVerified = () => { throw new Error("swapped_read"); };
    packagePort.loadExactReplayContract = () => { throw new Error("swapped_package"); };
    integrity.hashBytes = () => { throw new Error("swapped_hash_bytes"); };
    for (const value of borrowedById.values()) {
      asMutable(value.snapshot).cityId = "mutated-borrowed-city";
      artifactBytes(value).forEach((bytes) => bytes.fill(0));
    }
    asMutable(borrowedContract.catalogProjection.catalog).countryCode = "ZZ";

    const result = await pending;
    expect(result.snapshot.cityId).toBe(CITY_ID);
    expect(result.snapshot.id).toBe(harness.evidenceIds[2]);
  });

  test("normalizes primitive, Promise and hostile port outcomes to fresh intrinsic errors", async () => {
    const harness = await historicalHarness();
    const valid = fakePorts(harness);
    let hostileMessageReads = 0;
    const hostileThrown = Object.create(null) as MutableRecord;
    Object.defineProperty(hostileThrown, "message", {
      enumerable: true,
      get() {
        hostileMessageReads += 1;
        throw new Error("hostile_message_getter");
      },
    });
    const borrowedErrors = [
      new Error("city_package_revision_not_installed"),
      new Error("city_evidence_not_found"),
      hostileThrown,
    ] as const;
    const cases: readonly CityEvidenceReplayPorts[] = [
      { ...valid, read: { ...valid.read, loadVerified: () => null as never } },
      {
        ...valid,
        read: {
          ...valid.read,
          loadVerified: () => Promise.resolve(
            cloneVerified(harness.verifiedById.get(harness.evidenceIds[2])!),
          ) as never,
        },
      },
      {
        ...valid,
        package: {
          loadExactReplayContract: () => Promise.resolve(cloneContract(harness.contractA)) as never,
        },
      },
      {
        ...valid,
        read: { ...valid.read, loadVerified: () => { throw borrowedErrors[0]; } },
      },
      {
        ...valid,
        package: { loadExactReplayContract: () => { throw borrowedErrors[1]; } },
      },
      {
        ...valid,
        read: { ...valid.read, loadVerified: () => { throw borrowedErrors[2]; } },
      },
    ];

    for (const [index, ports] of cases.entries()) {
      let rejection: unknown;
      try {
        await replayCityEvidence(harness.input, ports);
      } catch (error) {
        rejection = error;
      }
      expect(rejection, String(index)).toBeInstanceOf(Error);
      expect((rejection as Error).message, String(index)).toBe("integrity_mismatch");
      expect(Object.getPrototypeOf(rejection), String(index)).toBe(Error.prototype);
      expect(borrowedErrors.includes(rejection as never), String(index)).toBe(false);
    }
    expect(hostileMessageReads).toBe(0);
  });
});

function recordAtPath(root: unknown, path: readonly (string | number)[]): MutableRecord {
  let current = root;
  for (const part of path) {
    current = (current as Record<string | number, unknown>)[part];
  }
  return asMutable(current);
}

function readPortsReturning(
  harness: HistoricalHarness,
  replacements: ReadonlyMap<string, VerifiedCityEvidence>,
  packagePort: CityEvidenceReplayPorts["package"] = fakePorts(harness).package,
  integrity: CityEvidenceReplayPorts["integrity"] = createCityEvidenceReplayIntegrity(INTEGRITY),
): CityEvidenceReplayPorts {
  return {
    read: {
      loadVerified(id) {
        const value = replacements.get(id) ?? harness.verifiedById.get(id);
        if (value === undefined) throw new Error("city_evidence_not_found");
        return value;
      },
      findVerifiedByCheckRunId: () => { throw new Error("forbidden_current_lookup"); },
    },
    integrity,
    package: packagePort,
  };
}

function packageWithMutableManifest(
  value: CityPackageEvidenceReplayContract,
  mutate: (root: MutableRecord) => void,
): CityPackageEvidenceReplayContract {
  const root = {
    installedPackageManifest: structuredClone(value.installedPackageManifest),
    definition: structuredClone(value.definition),
    catalogProjection: structuredClone(value.catalogProjection),
    fixedPlansByCityId: structuredClone(value.fixedPlansByCityId),
    safetySourcePlan: structuredClone(value.safetySourcePlan),
    officialAuthorityDirectory: structuredClone(value.officialAuthorityDirectory),
    validateValue: value.validateValue,
    validateSourcePeriod: value.validateSourcePeriod,
  } as unknown as MutableRecord;
  mutate(root);
  const manifest = asMutable(root.installedPackageManifest);
  if (manifest.key !== undefined && manifest.key !== null && typeof manifest.key === "object") {
    Object.freeze(manifest.key);
  }
  Object.freeze(manifest);
  return root as unknown as CityPackageEvidenceReplayContract;
}

describe("replayCityEvidence hostile boundaries", () => {
  test("exact-closes every verified read branch before callbacks", async () => {
    const harness = await historicalHarness();
    const current = harness.verifiedById.get(harness.evidenceIds[2])!;
    const branches = [
      { name: "verified root", path: [] as const, required: "snapshot" },
      { name: "overlay", path: ["snapshot"] as const, required: "cityId" },
      { name: "definition map", path: ["snapshot", "definitionIds"] as const, required: "safety" },
      { name: "generic root", path: ["genericEvidence"] as const, required: "snapshot" },
      { name: "generic snapshot", path: ["genericEvidence", "snapshot"] as const, required: "id" },
      { name: "coverage", path: ["genericEvidence", "snapshot", "coverage"] as const, required: "si-city-safety" },
      { name: "parser versions", path: ["genericEvidence", "snapshot", "parserVersions"] as const, required: "si-city-safety" },
      { name: "claim", path: ["genericEvidence", "snapshot", "claims", 0] as const, required: "claimId" },
      { name: "claim value", path: ["genericEvidence", "snapshot", "claims", 0, "value"] as const, required: "kind" },
      { name: "claim anchor", path: ["genericEvidence", "snapshot", "claims", 0, "anchor"] as const, required: "artifactId" },
      { name: "blocker", path: ["genericEvidence", "snapshot", "blockers", 0] as const, required: "kind" },
      { name: "manifest", path: ["genericEvidence", "manifest"] as const, required: "snapshot" },
      { name: "manifest snapshot", path: ["genericEvidence", "manifest", "snapshot"] as const, required: "id" },
      { name: "manifest entry", path: ["genericEvidence", "manifest", "entries", 0] as const, required: "sourceId" },
      { name: "artifact provenance", path: ["genericEvidence", "manifest", "artifacts", 0] as const, required: "sha256" },
      { name: "captured entry", path: ["genericEvidence", "entries", 0] as const, required: "sourceId" },
      { name: "captured artifact", path: ["genericEvidence", "entries", 0, "artifacts", 0] as const, required: "bytes" },
      { name: "request", path: ["genericEvidence", "entries", 0, "artifacts", 0, "request"] as const, required: "method" },
      { name: "fixed ledger", path: ["snapshot", "fixedAttemptLedgers", 0] as const, required: "sourceId" },
      { name: "fixed attempt", path: ["snapshot", "fixedAttemptLedgers", 0, "attempts", 0] as const, required: "routeId" },
      { name: "fixed result", path: ["snapshot", "fixedAttemptLedgers", 0, "result"] as const, required: "kind" },
      { name: "safety ledger", path: ["snapshot", "safetyAttemptLedger"] as const, required: "cityId" },
      { name: "safety candidate", path: ["snapshot", "safetyAttemptLedger", "candidates", 0] as const, required: "origin" },
      { name: "safety origin", path: ["snapshot", "safetyAttemptLedger", "candidates", 0, "origin"] as const, required: "kind" },
      { name: "safety artifact ref", path: ["snapshot", "safetyAttemptLedger", "candidates", 0, "artifactRefs", 0] as const, required: "artifactId" },
      { name: "safety counters", path: ["snapshot", "safetyAttemptLedger", "counters"] as const, required: "queries" },
      { name: "safety result", path: ["snapshot", "safetyAttemptLedger", "result"] as const, required: "kind" },
    ];

    for (const [index, branch] of branches.entries()) {
      const mutated = cloneVerified(current);
      const target = recordAtPath(mutated, branch.path);
      if (index % 2 === 0) target.extra = undefined;
      else delete target[branch.required];
      const replacements = new Map([[harness.evidenceIds[2], mutated]]);
      await expect(replayCityEvidence(
        harness.input,
        readPortsReturning(harness, replacements),
      ), branch.name).rejects.toEqual(rejectedWith("integrity_mismatch"));
    }
  });

  test("rejects nested accessor, Proxy and shared byte storage without invoking traps", async () => {
    const harness = await historicalHarness();
    const current = harness.verifiedById.get(harness.evidenceIds[2])!;
    let getterCalls = 0;
    const accessor = cloneVerified(current);
    const claim = accessor.genericEvidence.snapshot.claims[0] as unknown as MutableRecord;
    Object.defineProperty(claim, "unit", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return "canonical-unit";
      },
    });
    const proxied = cloneVerified(current);
    (proxied.genericEvidence.entries[0] as unknown as MutableRecord).artifacts = new Proxy(
      [...proxied.genericEvidence.entries[0]!.artifacts],
      { ownKeys() { throw new Error("nested_proxy_trap"); } },
    );
    const shared = cloneVerified(current);
    if (typeof SharedArrayBuffer !== "undefined") {
      const bytes = artifactBytes(shared)[0]!;
      const sharedBytes = new Uint8Array(new SharedArrayBuffer(bytes.byteLength));
      sharedBytes.set(bytes);
      (shared.genericEvidence.entries[0]!.artifacts[0] as unknown as MutableRecord).bytes = sharedBytes;
    }
    for (const value of [accessor, proxied, shared]) {
      await expect(replayCityEvidence(harness.input, readPortsReturning(
        harness,
        new Map([[harness.evidenceIds[2], value]]),
      ))).rejects.toEqual(rejectedWith("integrity_mismatch"));
    }
    expect(getterCalls).toBe(0);
  });

  test("owns and reconstructs a valid safety query before rejecting nested query drift", async () => {
    const harness = await historicalHarness();
    const input = await cityEvidenceInput(harness.preparedA, 10, undefined, true, true);
    const store = new SqliteCityEvidenceStore(harness.database, INTEGRITY, harness.packages);
    const sealed = store.seal(input);
    const verified = store.loadVerified(sealed.id);
    const replayInput = {
      evidenceSnapshotId: sealed.id,
      cityId: CITY_ID,
      packageId: APPROVED_FOR.packageId,
    };
    const portsFor = (value: VerifiedCityEvidence): CityEvidenceReplayPorts => ({
      read: {
        loadVerified: () => value,
        findVerifiedByCheckRunId: () => { throw new Error("forbidden_current_lookup"); },
      },
      integrity: createCityEvidenceReplayIntegrity(INTEGRITY),
      package: fakePorts(harness).package,
    });

    await expect(replayCityEvidence(replayInput, portsFor(cloneVerified(verified))))
      .resolves.toEqual(expect.objectContaining({ snapshot: expect.objectContaining({ id: sealed.id }) }));

    for (const mutate of [
      (query: MutableRecord) => { query.extra = undefined; },
      (query: MutableRecord) => { delete query.providerId; },
      (query: MutableRecord) => { asMutable(query.outcome).returnedUrls = ["https://evil.invalid/"]; },
    ]) {
      const malformed = cloneVerified(verified);
      const query = (asMutable(malformed.snapshot.safetyAttemptLedger).queries as MutableRecord[])[0]!;
      mutate(query);
      rehashOverlay(malformed);
      await expect(replayCityEvidence(replayInput, portsFor(malformed)))
        .rejects.toEqual(rejectedWith("integrity_mismatch"));
    }
  });

  test("exact-closes package branches and routes them through inward reconstructors", async () => {
    const harness = await historicalHarness();
    const branches = [
      { name: "root", path: [] as const, required: "definition" },
      { name: "manifest", path: ["installedPackageManifest"] as const, required: "id" },
      { name: "key", path: ["installedPackageManifest", "key"] as const, required: "countryCode" },
      { name: "definition", path: ["definition"] as const, required: "packageId" },
      { name: "registry", path: ["catalogProjection", "registry"] as const, required: "id" },
      { name: "catalog", path: ["catalogProjection", "catalog"] as const, required: "id" },
      { name: "plan map", path: ["fixedPlansByCityId"] as const, required: CITY_ID },
      { name: "plan", path: ["fixedPlansByCityId", CITY_ID, 0] as const, required: "planId" },
      { name: "claim contract", path: ["fixedPlansByCityId", CITY_ID, 0, "claimContract"] as const, required: "unit" },
      { name: "route", path: ["fixedPlansByCityId", CITY_ID, 0, "routes", 0] as const, required: "routeId" },
      { name: "safety plan", path: ["safetySourcePlan"] as const, required: "id" },
      { name: "directory", path: ["officialAuthorityDirectory"] as const, required: "id" },
    ];
    for (const [index, branch] of branches.entries()) {
      const validatorCalls = { value: 0, period: 0 };
      const malformed = packageWithMutableManifest(harness.contractA, (root) => {
        root.validateValue = () => {
          validatorCalls.value += 1;
          return "9.5";
        };
        root.validateSourcePeriod = () => {
          validatorCalls.period += 1;
          return "fresh";
        };
        const target = recordAtPath(root, branch.path);
        if (index % 2 === 0) target.extra = undefined;
        else delete target[branch.required];
      });
      await expect(replayCityEvidence(harness.input, readPortsReturning(
        harness,
        new Map(),
        { loadExactReplayContract: () => malformed },
      )), branch.name).rejects.toEqual(rejectedWith("integrity_mismatch"));
      expect(validatorCalls, branch.name).toEqual({ value: 0, period: 0 });
    }

    let accessorCalls = 0;
    const accessor = packageWithMutableManifest(harness.contractA, (root) => {
      Object.defineProperty(root, "validateValue", {
        enumerable: true,
        get() {
          accessorCalls += 1;
          return validateValue;
        },
      });
    });
    const nestedProxy = packageWithMutableManifest(harness.contractA, (root) => {
      root.catalogProjection = new Proxy(asMutable(root.catalogProjection), {
        ownKeys() { throw new Error("package_nested_proxy_trap"); },
      });
    });
    let proxiedValidatorCalls = 0;
    const proxiedValidator = packageWithMutableManifest(harness.contractA, (root) => {
      root.validateValue = new Proxy(validateValue, {
        apply() {
          proxiedValidatorCalls += 1;
          throw new Error("proxied_validator_called");
        },
      });
    });
    for (const malformed of [accessor, nestedProxy, proxiedValidator]) {
      await expect(replayCityEvidence(harness.input, readPortsReturning(
        harness,
        new Map(),
        { loadExactReplayContract: () => malformed },
      ))).rejects.toEqual(rejectedWith("integrity_mismatch"));
    }
    expect(accessorCalls).toBe(0);
    expect(proxiedValidatorCalls).toBe(0);
  });

  test("accepts an independently authenticated manifest ID but rejects hidden exact-key drift", async () => {
    const harness = await historicalHarness();
    const changedId = packageWithMutableManifest(harness.contractA, (root) => {
      asMutable(root.installedPackageManifest).id = "installed-city-package:alternate-authenticated-id";
    });
    await expect(replayCityEvidence(harness.input, readPortsReturning(
      harness,
      new Map(),
      { loadExactReplayContract: () => changedId },
    ))).resolves.toEqual(expect.objectContaining({ snapshot: expect.objectContaining({ cityId: CITY_ID }) }));

    const changedKey = packageWithMutableManifest(harness.contractA, (root) => {
      asMutable(asMutable(root.installedPackageManifest).key).catalogRevisionId =
        harness.packageKeyB.catalogRevisionId;
    });
    await expect(replayCityEvidence(harness.input, readPortsReturning(
      harness,
      new Map(),
      { loadExactReplayContract: () => changedKey },
    ))).rejects.toEqual(rejectedWith("integrity_mismatch"));
  });
});

describe("replayCityEvidence semantic replay", () => {
  test("rehashes every private byte copy before invoking compiled validators", async () => {
    const harness = await historicalHarness();
    const borrowedById = new Map([...harness.verifiedById].map(([id, value]) => [
      id,
      cloneVerified(value),
    ]));
    const borrowedBytes = [...borrowedById.values()].flatMap(artifactBytes);
    const borrowedBytesBefore = borrowedBytes.map((bytes) => [...bytes]);
    const expectedDigests = borrowedBytes.map(sha256).sort();
    const retainedHashArguments: Uint8Array[] = [];
    const hashedDigests: string[] = [];
    const timeline: string[] = [];
    const validatorInputs: unknown[] = [];
    const periodInputs: unknown[] = [];
    const integrityReceivers: Array<{ readonly operation: string; readonly receiver: unknown }> = [];
    const validatorReceivers: Array<{ readonly operation: string; readonly receiver: unknown }> = [];
    const borrowedRead: CityEvidenceReplayPorts["read"] = {
      loadVerified(id) {
        const value = borrowedById.get(id);
        if (value === undefined) throw new Error("city_evidence_not_found");
        return value;
      },
      findVerifiedByCheckRunId: () => { throw new Error("forbidden_current_lookup"); },
    };
    const replayIntegrity: CityEvidenceReplayPorts["integrity"] = Object.freeze({
      canonical(this: unknown, value: unknown): string {
        integrityReceivers.push({ operation: "canonical", receiver: this });
        expect(containsBytes(value)).toBe(false);
        timeline.push("canonical");
        return INTEGRITY.canonical(value);
      },
      hash(this: unknown, value: string): string {
        integrityReceivers.push({ operation: "hash", receiver: this });
        expect(typeof value).toBe("string");
        timeline.push("hash");
        return INTEGRITY.hash(value);
      },
      hashBytes(this: unknown, bytes: Uint8Array): string {
        integrityReceivers.push({ operation: "hashBytes", receiver: this });
        expect(bytes).toBeInstanceOf(Uint8Array);
        expectPrivateBytes(bytes);
        expect(borrowedBytes.some((borrowed) =>
          borrowed === bytes || borrowed.buffer === bytes.buffer)).toBe(false);
        retainedHashArguments.push(bytes);
        timeline.push("hashBytes");
        const digest = sha256(bytes);
        hashedDigests.push(digest);
        bytes.fill(0);
        return digest;
      },
    });
    const packagePort: CityEvidenceReplayPorts["package"] = {
      loadExactReplayContract(key) {
        if (INTEGRITY.canonical(key) !== INTEGRITY.canonical(harness.packageKeyA)) return undefined;
        const contract = cloneContract(harness.contractA);
        return packageWithMutableManifest(contract, (root) => {
          root.validateValue = function (this: unknown, input: unknown) {
            validatorReceivers.push({ operation: "validateValue", receiver: this });
            timeline.push("validateValue");
            validatorInputs.push(structuredClone(input));
            return asMutable(input).value as string;
          };
          root.validateSourcePeriod = function (this: unknown, input: unknown) {
            validatorReceivers.push({ operation: "validateSourcePeriod", receiver: this });
            timeline.push("validateSourcePeriod");
            periodInputs.push(structuredClone(input));
            return "fresh";
          };
        });
      },
    };
    const result = await replayCityEvidence(
      harness.input,
      { read: borrowedRead, package: packagePort, integrity: replayIntegrity },
    );
    const returnedBeforeRetainedMutation = artifactBytes(result).map((bytes) => [...bytes]);
    retainedHashArguments.forEach((bytes) => bytes.fill(0xff));

    expect(artifactBytes(result).map((bytes) => [...bytes])).toEqual(returnedBeforeRetainedMutation);
    expect(borrowedBytes.map((bytes) => [...bytes])).toEqual(borrowedBytesBefore);
    expect(retainedHashArguments).toHaveLength(borrowedBytes.length);
    expect(hashedDigests.sort()).toEqual(expectedDigests);
    const resultBytes = artifactBytes(result);
    expect(new Set(resultBytes.map(({ buffer }) => buffer)).size).toBe(resultBytes.length);
    for (const bytes of resultBytes) {
      expectPrivateBytes(bytes);
      expect([...borrowedBytes, ...retainedHashArguments].some((other) =>
        other === bytes || other.buffer === bytes.buffer)).toBe(false);
    }
    expect(validatorInputs).toHaveLength(3);
    expect(periodInputs).toHaveLength(3);
    expect(validatorInputs.map((input) => asMutable(input).sourceId))
      .toEqual(Array(3).fill("si-city-long-term-rent"));
    expect(timeline.indexOf("validateValue"))
      .toBeGreaterThan(timeline.map((item, index) => item === "hashBytes" ? index : -1)
        .filter((index) => index >= 0).at(-1)!);
    for (const { operation, receiver } of integrityReceivers) {
      expect(Object.isFrozen(receiver)).toBe(true);
      const keys = Object.keys(receiver as object).sort();
      if (operation === "hashBytes") {
        expect(keys).toEqual(["canonical", "hash", "hashBytes"]);
      } else {
        expect([
          ["canonical", "hash"],
          ["canonical", "hash", "hashBytes"],
        ]).toContainEqual(keys);
      }
      expect(receiver).not.toBe(replayIntegrity);
    }
    for (const { operation, receiver } of validatorReceivers) {
      expect(Object.isFrozen(receiver)).toBe(true);
      expect(receiver).toEqual({ capability: operation });
      expect(Object.keys(receiver as object)).toEqual(["capability"]);
    }
    for (const input of validatorInputs) {
      expect(Object.keys(input as object).sort()).toEqual([
        "criterionId", "definitionId", "denominator", "policyVersion", "sourceId", "unit", "value",
      ]);
    }
    for (const input of periodInputs) {
      expect(Object.keys(input as object).sort()).toEqual([
        "assessmentAt", "policyVersion", "sourceId", "sourcePeriod",
      ]);
    }
  });

  test("isolates canonical callbacks from borrowed and replay-owned graphs", async () => {
    const harness = await historicalHarness();
    const borrowedById = new Map([...harness.verifiedById].map(([id, value]) => [
      id,
      cloneVerified(value),
    ]));
    const borrowedContract = cloneContract(harness.contractA);
    const borrowedIdentities = new Set<object>();
    const collectIdentities = (value: unknown): void => {
      if (value === null || typeof value !== "object" || borrowedIdentities.has(value)) return;
      borrowedIdentities.add(value);
      if (value instanceof Uint8Array) return;
      Object.values(value).forEach(collectIdentities);
    };
    borrowedById.forEach(collectIdentities);
    collectIdentities(borrowedContract);

    const canonicalArguments: object[] = [];
    const mutationResults: boolean[] = [];
    const baseIntegrity = createCityEvidenceReplayIntegrity(INTEGRITY);
    const integrity: CityEvidenceReplayPorts["integrity"] = {
      canonical(value: unknown): string {
        const canonicalText = baseIntegrity.canonical(value);
        if (value !== null && typeof value === "object") {
          canonicalArguments.push(value);
          mutationResults.push(Reflect.set(value, "canonicalCallbackMutation", true));
        }
        return canonicalText;
      },
      hash: baseIntegrity.hash,
      hashBytes: baseIntegrity.hashBytes,
    };
    const ports: CityEvidenceReplayPorts = {
      read: {
        loadVerified(id) {
          const value = borrowedById.get(id);
          if (value === undefined) throw new Error("city_evidence_not_found");
          return value;
        },
        findVerifiedByCheckRunId: () => { throw new Error("forbidden_current_lookup"); },
      },
      integrity,
      package: {
        loadExactReplayContract(key) {
          return INTEGRITY.canonical(key) === INTEGRITY.canonical(harness.packageKeyA)
            ? borrowedContract
            : undefined;
        },
      },
    };

    const result = await replayCityEvidence(harness.input, ports);
    const replayIdentities = new Set<object>();
    const collectReplayIdentities = (value: unknown): void => {
      if (value === null || typeof value !== "object" || replayIdentities.has(value)) return;
      replayIdentities.add(value);
      if (value instanceof Uint8Array) return;
      Object.values(value).forEach(collectReplayIdentities);
    };
    collectReplayIdentities(result);

    expect(INTEGRITY.canonical(replayComparable(result))).toBe(INTEGRITY.canonical(
      replayComparable(harness.verifiedById.get(harness.evidenceIds[2])!),
    ));
    expect(canonicalArguments.length).toBeGreaterThan(0);
    expect(new Set(canonicalArguments).size).toBe(canonicalArguments.length);
    expect(mutationResults).toEqual(Array(canonicalArguments.length).fill(false));
    for (const argument of canonicalArguments) {
      expect(Object.isFrozen(argument)).toBe(true);
      expect(borrowedIdentities.has(argument)).toBe(false);
      expect(replayIdentities.has(argument)).toBe(false);
    }
  });

  test("owns the complete chain before the first integrity or package callback", async () => {
    const harness = await historicalHarness();
    const borrowedById = new Map([...harness.verifiedById].map(([id, value]) => [
      id,
      cloneVerified(value),
    ]));
    const expected = cloneVerified(borrowedById.get(harness.evidenceIds[2])!);
    const readOrder: string[] = [];
    const read = {
      loadVerified(id: string): VerifiedCityEvidence {
        readOrder.push(id);
        const value = borrowedById.get(id);
        if (value === undefined) throw new Error("city_evidence_not_found");
        return value;
      },
      findVerifiedByCheckRunId: () => { throw new Error("forbidden_current_lookup"); },
    };
    let attacked = false;
    const attackOnce = (): void => {
      if (attacked) return;
      attacked = true;
      expect(readOrder).toEqual([
        harness.evidenceIds[2],
        harness.evidenceIds[1],
        harness.evidenceIds[0],
      ]);
      for (const value of borrowedById.values()) {
        asMutable(value.snapshot).cityId = "mutated-after-complete-read";
        asMutable(value.genericEvidence.snapshot).rulesVersion = "mutated-after-complete-read";
        artifactBytes(value).forEach((bytes) => bytes.fill(0));
      }
      read.loadVerified = () => { throw new Error("swapped_read_after_complete_read"); };
    };
    const integrity: CityEvidenceReplayPorts["integrity"] = Object.freeze({
      canonical(value: unknown) {
        attackOnce();
        return INTEGRITY.canonical(value);
      },
      hash(value: string) {
        attackOnce();
        return INTEGRITY.hash(value);
      },
      hashBytes(bytes: Uint8Array) {
        attackOnce();
        return sha256(bytes);
      },
    });
    const packagePort: CityEvidenceReplayPorts["package"] = {
      loadExactReplayContract(key) {
        attackOnce();
        return INTEGRITY.canonical(key) === INTEGRITY.canonical(harness.packageKeyA)
          ? cloneContract(harness.contractA)
          : undefined;
      },
    };

    const result = await replayCityEvidence(harness.input, { read, integrity, package: packagePort });
    expect(attacked).toBe(true);
    expect(INTEGRITY.canonical(replayComparable(result)))
      .toBe(INTEGRITY.canonical(replayComparable(expected)));
  });

  test("rejects every malformed hashBytes result before validators", async () => {
    const harness = await historicalHarness();
    const validators = { value: 0, period: 0 };
    const packagePort: CityEvidenceReplayPorts["package"] = {
      loadExactReplayContract: () => packageWithMutableManifest(harness.contractA, (root) => {
        root.validateValue = () => {
          validators.value += 1;
          return "9.5";
        };
        root.validateSourcePeriod = () => {
          validators.period += 1;
          return "fresh";
        };
      }),
    };
    const badHashers: readonly ((bytes: Uint8Array) => unknown)[] = [
      (bytes) => sha256(bytes).toUpperCase(),
      () => "a".repeat(63),
      () => 42,
      () => { throw new Error("hash_bytes_failed"); },
    ];
    for (const badHasher of badHashers) {
      const integrity = Object.freeze({
        canonical: INTEGRITY.canonical,
        hash: INTEGRITY.hash,
        hashBytes: badHasher,
      }) as unknown as CityEvidenceReplayPorts["integrity"];
      await expect(replayCityEvidence(
        harness.input,
        readPortsReturning(harness, new Map(), packagePort, integrity),
      )).rejects.toEqual(rejectedWith("integrity_mismatch"));
    }
    expect(validators).toEqual({ value: 0, period: 0 });
  });

  test("rejects package, Catalog, every member plan, safety and directory drift", async () => {
    const harness = await historicalHarness();
    const semanticMutations: readonly {
      readonly name: string;
      readonly mutate: (root: MutableRecord) => void;
    }[] = [{
      name: "definition",
      mutate: (root) => { asMutable(root.definition).packageSchemaVersion = "si-cities@9"; },
    }, {
      name: "Registry",
      mutate: (root) => {
        asMutable(asMutable(root.catalogProjection).registry).countryCode = "ZZ";
      },
    }, {
      name: "unselected Catalog member",
      mutate: (root) => {
        const catalog = asMutable(asMutable(root.catalogProjection).catalog);
        const members = catalog.members as MutableRecord[];
        members[1]!.cityId = "mutated-unselected";
      },
    }, ...[CITY_ID, SECOND_CITY_ID].flatMap((cityId) => FIXED_SOURCE_IDS.map((_, index) => ({
      name: `${cityId} fixed plan ${String(index)}`,
      mutate: (root: MutableRecord) => {
        const plans = asMutable(root.fixedPlansByCityId)[cityId] as MutableRecord[];
        plans[index]!.rulesVersion = "mutated-rules@1";
      },
    }))), {
      name: "safety plan",
      mutate: (root) => { asMutable(root.safetySourcePlan).definitionId = "mutated-definition@1"; },
    }, {
      name: "directory",
      mutate: (root) => {
        const municipalities = asMutable(root.officialAuthorityDirectory).municipalities as MutableRecord[];
        municipalities[1]!.officialHost = "mutated.invalid";
      },
    }];
    for (const mutation of semanticMutations) {
      const contract = packageWithMutableManifest(harness.contractA, mutation.mutate);
      await expect(replayCityEvidence(harness.input, readPortsReturning(
        harness,
        new Map(),
        { loadExactReplayContract: () => contract },
      )), mutation.name).rejects.toEqual(rejectedWith("integrity_mismatch"));
    }
  });

  test("rejects overlay, ledger, URL, claim, blocker, time, byte and hash mutations", async () => {
    const harness = await historicalHarness();
    const current = harness.verifiedById.get(harness.evidenceIds[2])!;
    const mutations: readonly {
      readonly name: string;
      readonly mutate: (value: VerifiedCityEvidence) => void;
    }[] = [{
      name: "package overlay",
      mutate: (value) => {
        asMutable(value.snapshot).packageId = "mutated-package";
        rehashOverlay(value);
      },
    }, {
      name: "Catalog overlay",
      mutate: (value) => {
        asMutable(value.snapshot).catalogRevisionId = harness.packageKeyB.catalogRevisionId;
        rehashOverlay(value);
      },
    }, {
      name: "fixed plan binding",
      mutate: (value) => {
        asMutable(value.snapshot.fixedAttemptLedgers[0]).planId = "mutated-plan@1";
        rehashOverlay(value);
      },
    }, {
      name: "fixed URL",
      mutate: (value) => {
        const attempts = asMutable(value.snapshot.fixedAttemptLedgers[0]).attempts as MutableRecord[];
        attempts[0]!.navigationUrl = "https://wrong.example/fixed";
        rehashOverlay(value);
      },
    }, {
      name: "fixed time",
      mutate: (value) => {
        asMutable(value.snapshot.fixedAttemptLedgers[0]).completedAt = "2030-01-01T00:00:00.000Z";
        rehashOverlay(value);
      },
    }, {
      name: "safety definition",
      mutate: (value) => {
        asMutable(value.snapshot.safetyAttemptLedger).definitionId = "mutated-safety@1";
        rehashOverlay(value);
      },
    }, {
      name: "safety URL",
      mutate: (value) => {
        const candidates = asMutable(value.snapshot.safetyAttemptLedger).candidates as MutableRecord[];
        candidates[0]!.canonicalUrl = "https://wrong.example/safety";
        rehashOverlay(value);
      },
    }, {
      name: "claim unit",
      mutate: (value) => {
        const claims = value.genericEvidence.snapshot.claims as unknown as MutableRecord[];
        claims.find(({ sourceId }) => sourceId === "si-city-long-term-rent")!.unit = "wrong-unit";
        resealGeneric(value);
      },
    }, {
      name: "blocker URL",
      mutate: (value) => {
        (value.genericEvidence.snapshot.blockers[0] as unknown as MutableRecord).navigationUrl =
          "https://wrong.example/blocker";
        resealGeneric(value);
      },
    }, {
      name: "bytes",
      mutate: (value) => { artifactBytes(value)[0]![0] ^= 0xff; },
    }, {
      name: "artifact hash",
      mutate: (value) => {
        (value.genericEvidence.entries[0]!.artifacts[0] as unknown as MutableRecord).sha256 =
          "0".repeat(64);
      },
    }, {
      name: "artifact time",
      mutate: (value) => {
        (value.genericEvidence.entries[0]!.artifacts[0] as unknown as MutableRecord).capturedAt =
          "2030-01-01T00:00:00.000Z";
      },
    }];
    for (const mutation of mutations) {
      const value = cloneVerified(current);
      mutation.mutate(value);
      await expect(replayCityEvidence(harness.input, readPortsReturning(
        harness,
        new Map([[harness.evidenceIds[2], value]]),
      )), mutation.name).rejects.toEqual(rejectedWith("integrity_mismatch"));
    }
  });

  test("normalizes compiled validator drift and invokes neither validator for unknown facts", async () => {
    const harness = await historicalHarness();
    for (const contract of [
      packageWithMutableManifest(harness.contractA, (root) => {
        root.validateValue = () => "9.500";
      }),
      packageWithMutableManifest(harness.contractA, (root) => {
        root.validateSourcePeriod = () => "stale";
      }),
      packageWithMutableManifest(harness.contractA, (root) => {
        root.validateValue = () => { throw new Error("validator_failed"); };
      }),
    ]) {
      await expect(replayCityEvidence(harness.input, readPortsReturning(
        harness,
        new Map(),
        { loadExactReplayContract: () => contract },
      ))).rejects.toEqual(rejectedWith("integrity_mismatch"));
    }

    const unknownInput = await cityEvidenceInput(harness.preparedA, 9, undefined, false);
    const unknownSnapshot = new SqliteCityEvidenceStore(
      harness.database,
      INTEGRITY,
      harness.packages,
    ).seal(unknownInput);
    const unknownVerified = new SqliteCityEvidenceStore(
      harness.database,
      INTEGRITY,
      harness.packages,
    ).loadVerified(unknownSnapshot.id);
    const calls = { value: 0, period: 0 };
    const contract = packageWithMutableManifest(harness.contractA, (root) => {
      root.validateValue = () => {
        calls.value += 1;
        return "9.5";
      };
      root.validateSourcePeriod = () => {
        calls.period += 1;
        return "fresh";
      };
    });
    await expect(replayCityEvidence({
      evidenceSnapshotId: unknownSnapshot.id,
      cityId: CITY_ID,
      packageId: APPROVED_FOR.packageId,
    }, {
      read: {
        loadVerified: () => cloneVerified(unknownVerified),
        findVerifiedByCheckRunId: () => { throw new Error("forbidden_current_lookup"); },
      },
      integrity: createCityEvidenceReplayIntegrity(INTEGRITY),
      package: { loadExactReplayContract: () => contract },
    })).resolves.toEqual(expect.objectContaining({ snapshot: expect.objectContaining({
      id: unknownSnapshot.id,
    }) }));
    expect(calls).toEqual({ value: 0, period: 0 });
  });
});

describe("replayCityEvidence historical fail-closed behavior", () => {
  test("replays an authenticated legacy Catalog chain read-only and rejects unknown rules", async () => {
    // Break caught: enforcing current Catalog rules inside the shared historical Evidence reader.
    const harness = await historicalHarness();
    const legacyContract = contractWithCatalogRules(
      harness.contractA,
      LEGACY_CITY_CATALOG_RULES_VERSION,
    );
    const reboundEvidence = (contract: CityPackageEvidenceReplayContract) => {
      const values = new Map<string, VerifiedCityEvidence>();
      for (const id of harness.evidenceIds) {
        const value = cloneVerified(harness.verifiedById.get(id)!);
        asMutable(value.snapshot).catalogRevisionId =
          contract.installedPackageManifest.key.catalogRevisionId;
        const ledger = asMutable(value.snapshot.safetyAttemptLedger);
        ledger.catalogRevisionId = contract.catalogProjection.catalog.id;
        ledger.authorityDirectoryId = contract.officialAuthorityDirectory.id;
        ledger.sourcePlanId = contract.safetySourcePlan.id;
        for (const candidate of ledger.candidates as MutableRecord[]) {
          const origin = candidate.origin as MutableRecord;
          if (origin.kind === "previous") {
            origin.priorSourcePlanId = contract.safetySourcePlan.id;
          }
        }
        resealContext(value);
        values.set(id, value);
      }
      return values;
    };
    const legacyById = reboundEvidence(legacyContract);
    const packageCalls: unknown[] = [];
    const result = await replayCityEvidence(harness.input, {
      read: {
        loadVerified(id) {
          const value = legacyById.get(id);
          if (value === undefined) throw new Error("city_evidence_not_found");
          return cloneVerified(value);
        },
        findVerifiedByCheckRunId: () => { throw new Error("forbidden_current_lookup"); },
      },
      integrity: createCityEvidenceReplayIntegrity(INTEGRITY),
      package: {
        loadExactReplayContract(key) {
          packageCalls.push(structuredClone(key));
          return INTEGRITY.canonical(key) ===
            INTEGRITY.canonical(legacyContract.installedPackageManifest.key)
            ? cloneContract(legacyContract)
            : undefined;
        },
      },
    });
    expect(result.snapshot.id).toBe(harness.evidenceIds[2]);
    expect(packageCalls.length).toBeGreaterThan(0);
    expect(packageCalls.every((key) => INTEGRITY.canonical(key) ===
      INTEGRITY.canonical(legacyContract.installedPackageManifest.key))).toBe(true);

    const unknownContract = contractWithCatalogRules(harness.contractA, "city-catalog@999");
    const unknownById = reboundEvidence(unknownContract);
    await expect(replayCityEvidence(harness.input, {
      read: {
        loadVerified(id) {
          const value = unknownById.get(id);
          if (value === undefined) throw new Error("city_evidence_not_found");
          return cloneVerified(value);
        },
        findVerifiedByCheckRunId: () => { throw new Error("forbidden_current_lookup"); },
      },
      integrity: createCityEvidenceReplayIntegrity(INTEGRITY),
      package: { loadExactReplayContract: () => unknownContract },
    })).rejects.toEqual(rejectedWith("integrity_mismatch"));
  });

  test("owns reused borrowed nodes before the next ancestor read", async () => {
    const harness = await historicalHarness();
    const shared = cloneVerified(harness.verifiedById.get(harness.evidenceIds[2])!);
    const readOrder: string[] = [];
    const read: CityEvidenceReplayPorts["read"] = {
      loadVerified(id) {
        readOrder.push(id);
        const next = harness.verifiedById.get(id);
        if (next === undefined) throw new Error("city_evidence_not_found");
        const replacement = cloneVerified(next) as unknown as MutableRecord;
        const mutableShared = shared as unknown as MutableRecord;
        for (const key of Object.keys(mutableShared)) delete mutableShared[key];
        Object.assign(mutableShared, replacement);
        return shared;
      },
      findVerifiedByCheckRunId: () => { throw new Error("forbidden_current_lookup"); },
    };
    await expect(replayCityEvidence(harness.input, {
      read,
      integrity: createCityEvidenceReplayIntegrity(INTEGRITY),
      package: fakePorts(harness).package,
    })).resolves.toEqual(expect.objectContaining({ snapshot: expect.objectContaining({
      id: harness.evidenceIds[2],
    }) }));
    expect(readOrder).toEqual([
      harness.evidenceIds[2],
      harness.evidenceIds[1],
      harness.evidenceIds[0],
    ]);
  });

  test("independently rejects a non-adjacent ancestor mutation and missing prior node", async () => {
    const harness = await historicalHarness();
    const ancestor = cloneVerified(harness.verifiedById.get(harness.evidenceIds[0])!);
    asMutable(ancestor.snapshot.fixedAttemptLedgers[0]).planId = "mutated-ancestor-plan@1";
    rehashOverlay(ancestor);
    await expect(replayCityEvidence(harness.input, readPortsReturning(
      harness,
      new Map([[harness.evidenceIds[0], ancestor]]),
    ))).rejects.toEqual(rejectedWith("integrity_mismatch"));

    const readCalls: string[] = [];
    await expect(replayCityEvidence(harness.input, {
      ...fakePorts(harness),
      read: {
        loadVerified(id: string) {
          readCalls.push(id);
          if (id === harness.evidenceIds[0]) throw new Error("city_evidence_not_found");
          return cloneVerified(harness.verifiedById.get(id)!);
        },
        findVerifiedByCheckRunId: () => { throw new Error("forbidden_current_lookup"); },
      },
    })).rejects.toEqual(rejectedWith("integrity_mismatch"));
    expect(readCalls).toEqual([
      harness.evidenceIds[2],
      harness.evidenceIds[1],
      harness.evidenceIds[0],
    ]);
  });

  test("rejects a coherently resealed predecessor completed after its successor assessment", async () => {
    const harness = await historicalHarness();
    const middle = cloneVerified(harness.verifiedById.get(harness.evidenceIds[1])!);
    const current = harness.verifiedById.get(harness.evidenceIds[2])!;
    asMutable(middle.snapshot).completedAt = new Date(
      Date.parse(current.snapshot.assessmentAt) + 1_000,
    ).toISOString();
    resealContext(middle);

    await expect(replayCityEvidence(harness.input, readPortsReturning(
      harness,
      new Map([[harness.evidenceIds[1], middle]]),
    ))).rejects.toEqual(rejectedWith("integrity_mismatch"));
  });

  test("detects a prior cycle before reloading a visited node", async () => {
    const harness = await historicalHarness();
    const middle = cloneVerified(harness.verifiedById.get(harness.evidenceIds[1])!);
    const candidates = asMutable(middle.snapshot.safetyAttemptLedger).candidates as MutableRecord[];
    asMutable(candidates[0]!.origin).priorEvidenceSnapshotId = harness.evidenceIds[2];
    rehashOverlay(middle);
    const calls: string[] = [];
    const ports = readPortsReturning(
      harness,
      new Map([[harness.evidenceIds[1], middle]]),
    );
    await expect(replayCityEvidence(harness.input, {
      ...ports,
      read: {
        loadVerified(id: string) {
          calls.push(id);
          return ports.read.loadVerified(id);
        },
        findVerifiedByCheckRunId: ports.read.findVerifiedByCheckRunId,
      },
    })).rejects.toEqual(rejectedWith("integrity_mismatch"));
    expect(calls).toEqual([harness.evidenceIds[2], harness.evidenceIds[1]]);
  });

  test("uses all five A overlay fields and never substitutes current B", async () => {
    const harness = await historicalHarness();
    const requestedKeys: unknown[] = [];
    const bContract = harness.packages.loadExactReplayContract(harness.packageKeyB)!;
    await expect(replayCityEvidence(harness.input, readPortsReturning(
      harness,
      new Map(),
      {
        loadExactReplayContract(key) {
          requestedKeys.push(structuredClone(key));
          return cloneContract(bContract);
        },
      },
    ))).rejects.toEqual(rejectedWith("integrity_mismatch"));
    expect(requestedKeys[0]).toEqual({
      countryCode: harness.packageKeyA.countryCode,
      packageId: harness.packageKeyA.packageId,
      packageSchemaVersion: harness.packageKeyA.packageSchemaVersion,
      catalogRevisionId: harness.packageKeyA.catalogRevisionId,
      evidenceRulesVersion: harness.packageKeyA.evidenceRulesVersion,
    });

    const overlayFields = [
      ["countryCode", "ZZ"],
      ["packageId", "mutated-package"],
      ["packageSchemaVersion", "si-cities@9"],
      ["catalogRevisionId", harness.packageKeyB.catalogRevisionId],
      ["evidenceRulesVersion", "mutated-evidence@1"],
    ] as const;
    for (const [field, replacement] of overlayFields) {
      const current = cloneVerified(harness.verifiedById.get(harness.evidenceIds[2])!);
      asMutable(current.snapshot)[field] = replacement;
      rehashOverlay(current);
      await expect(replayCityEvidence(harness.input, readPortsReturning(
        harness,
        new Map([[harness.evidenceIds[2], current]]),
      ))).rejects.toEqual(rejectedWith("integrity_mismatch"));
    }
  });

  test("maps an absent exact A only to not-installed and does not consult B", async () => {
    const harness = await historicalHarness();
    const exact = vi.fn(() => undefined);
    await expect(replayCityEvidence(harness.input, readPortsReturning(
      harness,
      new Map(),
      { loadExactReplayContract: exact },
    ))).rejects.toEqual(rejectedWith("city_package_revision_not_installed"));
    expect(exact).toHaveBeenCalledWith(harness.packageKeyA);
    expect(exact).not.toHaveBeenCalledWith(harness.packageKeyB);
  });

  test("fails closed after exact persisted A manifest deletion while B remains current", async () => {
    const harness = await historicalHarness();
    expect(harness.packages.findReady("SI")?.installedPackageManifest.key)
      .toEqual(harness.packageKeyB);
    harness.database.pragma("foreign_keys = OFF");
    harness.database.exec("DROP TRIGGER installed_city_package_manifests_no_delete");
    const deletion = harness.database.prepare(
      "DELETE FROM installed_city_package_manifests WHERE id = ?",
    ).run(harness.contractA.installedPackageManifest.id);
    harness.database.exec(`
      CREATE TRIGGER installed_city_package_manifests_no_delete
      BEFORE DELETE ON installed_city_package_manifests
      BEGIN
        SELECT RAISE(ABORT, 'installed_city_package_manifest_is_immutable');
      END
    `);
    harness.database.pragma("foreign_keys = ON");
    expect(deletion.changes).toBe(1);

    const requestedKeys: unknown[] = [];
    await expect(replayCityEvidence(harness.input, readPortsReturning(
      harness,
      new Map(),
      {
        loadExactReplayContract(key) {
          requestedKeys.push(structuredClone(key));
          return harness.packages.loadExactReplayContract(key);
        },
      },
    ))).rejects.toEqual(rejectedWith("integrity_mismatch"));
    expect(requestedKeys).toHaveLength(1);
    expect(requestedKeys[0]).toEqual(harness.packageKeyA);
    expect(requestedKeys).not.toContainEqual(harness.packageKeyB);
  });

  test("fails closed when A artifact, defaults or exact behavior is unavailable", async () => {
    const artifactHarness = await historicalHarness();
    const manifestRow = artifactHarness.database.prepare(`
      SELECT administrative_evidence_snapshot_id
      FROM installed_city_package_manifests
      WHERE id = ?
    `).get(artifactHarness.contractA.installedPackageManifest.id) as {
      readonly administrative_evidence_snapshot_id: string;
    };
    expect(manifestRow.administrative_evidence_snapshot_id)
      .toBe(artifactHarness.preparedA.administrativeEvidence.evidenceId);
    const binding = artifactHarness.preparedA.administrativeEvidence.bindings
      .find(({ evidenceSnapshotId }) =>
        evidenceSnapshotId === manifestRow.administrative_evidence_snapshot_id)!;
    artifactHarness.database.exec("DROP TRIGGER artifacts_no_update");
    const artifactUpdate = artifactHarness.database.prepare(`
      UPDATE artifacts SET bytes = ? WHERE run_id = ? AND artifact_id = ?
    `).run(new Uint8Array([0]), binding.runId, binding.artifactId);
    expect(artifactUpdate.changes).toBe(1);
    const artifactKeys: unknown[] = [];
    await expect(replayCityEvidence(artifactHarness.input, readPortsReturning(
      artifactHarness,
      new Map(),
      {
        loadExactReplayContract(key) {
          artifactKeys.push(structuredClone(key));
          return artifactHarness.packages.loadExactReplayContract(key);
        },
      },
    ))).rejects.toEqual(rejectedWith("integrity_mismatch"));
    expect(artifactKeys.length).toBeGreaterThan(0);
    expect(artifactKeys.every((key) =>
      INTEGRITY.canonical(key) === INTEGRITY.canonical(artifactHarness.packageKeyA))).toBe(true);
    expect(artifactKeys).not.toContainEqual(artifactHarness.packageKeyB);

    const defaultsHarness = await historicalHarness();
    const emptyDefaults: ApprovedCityCriteriaDefaultsRegistry = {
      schemaVersion: "approved-city-criteria-defaults-registry@1",
      byMappingVersion: {},
    };
    const missingDefaults = new InstalledCityPackages(new SqliteCityPackageManifestStore(
      defaultsHarness.database,
      INTEGRITY,
      emptyDefaults,
      behaviorRegistry(),
    ));
    const defaultsKeys: unknown[] = [];
    await expect(replayCityEvidence(defaultsHarness.input, readPortsReturning(
      defaultsHarness,
      new Map(),
      {
        loadExactReplayContract(key) {
          defaultsKeys.push(structuredClone(key));
          return missingDefaults.loadExactReplayContract(key);
        },
      },
    ))).rejects.toBeInstanceOf(Error);
    expect(defaultsKeys.length).toBeGreaterThan(0);
    expect(defaultsKeys.every((key) =>
      INTEGRITY.canonical(key) === INTEGRITY.canonical(defaultsHarness.packageKeyA))).toBe(true);
    expect(defaultsKeys).not.toContainEqual(defaultsHarness.packageKeyB);

    const behaviorHarness = await historicalHarness();
    const emptyBehaviors: InstalledCityPackageBehaviorRegistry = {
      schemaVersion: "installed-city-package-behavior-registry@1",
      entries: [],
    };
    const missingBehavior = new InstalledCityPackages(new SqliteCityPackageManifestStore(
      behaviorHarness.database,
      INTEGRITY,
      APPROVED_DEFAULTS,
      emptyBehaviors,
    ));
    const behaviorKeys: unknown[] = [];
    await expect(replayCityEvidence(behaviorHarness.input, readPortsReturning(
      behaviorHarness,
      new Map(),
      {
        loadExactReplayContract(key) {
          behaviorKeys.push(structuredClone(key));
          return missingBehavior.loadExactReplayContract(key);
        },
      },
    ))).rejects.toBeInstanceOf(Error);
    expect(behaviorKeys.length).toBeGreaterThan(0);
    expect(behaviorKeys.every((key) =>
      INTEGRITY.canonical(key) === INTEGRITY.canonical(behaviorHarness.packageKeyA))).toBe(true);
    expect(behaviorKeys).not.toContainEqual(behaviorHarness.packageKeyB);
  });
});
