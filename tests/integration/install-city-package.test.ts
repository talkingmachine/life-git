import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type Database from "better-sqlite3";
import { afterEach, describe, expect, test, vi } from "vitest";

import {
  installCityPackage,
  type InstallCityPackageInput,
  type InstallCityPackagePorts,
} from "../../src/application/install-city-package";
import type {
  InstalledCityPackageManifestAppendInput,
  InstalledCityPackageLookupPort,
} from "../../src/application/city-data-contracts";
import * as userCompositionModule from "../../src/infrastructure/composition-root";
import {
  createCityPackageInstallationComposition,
} from "../../src/infrastructure/city-package-installation-composition";
import type {
  ApprovedCityCriteriaDefaultsRegistry,
} from "../../src/decision/approved-city-criteria-defaults";
import {
  buildCityCatalogRevision,
  buildCityRegistryRevision,
  type CityCatalogProjection,
} from "../../src/decision/city-catalog";
import {
  CITY_CRITERION_IDS,
  type CityCriterionEvaluatorRegistry,
  type InstalledCityCriteriaDefaults,
  type InstalledCityCriterionDefinitionTuple,
} from "../../src/decision/city-criteria";
import { createEvidenceIntegrity } from "../../src/infrastructure/integrity";
import {
  InstalledCityPackages,
  type InstalledCityPackageBehaviorRegistry,
} from "../../src/infrastructure/sources/installed-city-packages";
import { SqliteCityCatalogStore } from "../../src/infrastructure/sqlite/city-catalog-store";
import { openEvidenceDatabase } from "../../src/infrastructure/sqlite/db";
import { SqliteAdministrativeEvidenceStore } from "../../src/infrastructure/sqlite/evidence-store";
import { SqliteCityPackageManifestStore } from "../../src/infrastructure/sqlite/city-package-manifest-store";
import type {
  CityFixedSourcePeriodValidator,
  CityFixedSourcePlan,
  CityFixedValueValidator,
  SloveniaCityFixedSourceId,
} from "../../src/research/city-evidence";
import { SLOVENIA_CITY_FACT_SOURCE_IDS } from "../../src/research/city-evidence";
import type {
  InstalledCityPackageManifest,
  InstalledCityPackageExactKey,
  InstalledCityPackageManifestPayload,
  InstalledCityResearchPackage,
  CityResearchPackageReadyCandidate,
} from "../../src/research/city-package";
import { getCityResearchPackageAvailability } from "../../src/research/city-package";
import {
  buildCitySafetySourcePlan,
  buildOfficialAuthorityDirectory,
} from "../../src/research/city-safety-source-plan";
import type { EvidenceIntegrity } from "../../src/research/research-plan";
import { SLOVENIA_CITY_FACT_VERSIONS } from "../../src/research/slovenia-city-plan";

const INTEGRITY_KEY = "task-5-offline-installer-key-at-least-32-bytes";
const INTEGRITY = createEvidenceIntegrity(INTEGRITY_KEY);
const CITY_ID = "ljubljana";
const FIXED_SOURCE_IDS = [
  "si-city-long-term-rent",
  "si-city-urban-transit",
  "si-city-fixed-broadband",
] as const satisfies readonly SloveniaCityFixedSourceId[];
const temporaryDirectories: string[] = [];
const databases: Database.Database[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) {
    if (database.open) database.close();
  }
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function memoryDatabase(): Database.Database {
  const database = openEvidenceDatabase(":memory:");
  databases.push(database);
  return database;
}

function temporaryDatabasePath(): string {
  const directory = mkdtempSync(join(tmpdir(), "install-city-package-"));
  temporaryDirectories.push(directory);
  return join(directory, "city.sqlite");
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function fixedPlan<S extends SloveniaCityFixedSourceId>(
  cityId: string,
  sourceId: S,
  suffix: string,
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
      officialAreaId: "061",
      geoScope: "municipality",
      unit: "canonical-unit",
      denominator: "canonical-denominator",
      freshnessPolicyVersion: "annual@1",
      valueKind: "canonical_scalar",
      valuePolicyVersion: "canonical-scalar@1",
      sourcePeriodPolicyVersion: "annual-period@1",
    },
    routes: [{
      routeId: `${sourceId}:primary-${suffix}`,
      navigationUrl: `https://official.example/${sourceId}/${suffix}`,
    }],
    parserVersion: SLOVENIA_CITY_FACT_VERSIONS[sourceId].parserVersion,
    rulesVersion: SLOVENIA_CITY_FACT_VERSIONS[sourceId].rulesVersion,
  } as unknown as CityFixedSourcePlan<S>;
}

interface ExecutableCallCounters {
  canonicalize: number;
  evaluate: number;
  value: number;
  period: number;
}

function evaluatorRegistry(
  counters: ExecutableCallCounters = { canonicalize: 0, evaluate: 0, value: 0, period: 0 },
): CityCriterionEvaluatorRegistry {
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
        counters.canonicalize += 1;
        if (typeof target !== "string") throw new Error("invalid_target");
        return target;
      },
      evaluate() {
        counters.evaluate += 1;
        return {
          state: "verified" as const,
          factor: "1",
          targetComparison: "matches" as const,
        };
      },
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
});
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

function behaviorRegistry(
  counters: ExecutableCallCounters = { canonicalize: 0, evaluate: 0, value: 0, period: 0 },
): InstalledCityPackageBehaviorRegistry {
  const registry = evaluatorRegistry(counters);
  const validateValue: CityFixedValueValidator = (input) => {
    counters.value += 1;
    return input.value;
  };
  const validateSourcePeriod: CityFixedSourcePeriodValidator = () => {
    counters.period += 1;
    return "fresh";
  };
  return {
    schemaVersion: "installed-city-package-behavior-registry@1",
    entries: [{
      approvedFor: APPROVED_FOR,
      versionKey: {
        evaluatorRegistryVersionId: "synthetic-evaluator-registry@1",
        evaluatorVersionIds: Object.fromEntries(CITY_CRITERION_IDS.map((criterionId) => [
          criterionId,
          registry[criterionId].definition.evaluatorVersion,
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
      ])) as InstalledCityPackageBehaviorRegistry["entries"][number][
        "fixedPolicyVersionsBySourceId"
      ],
      evaluatorRegistry: registry,
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

function installationFixture(
  suffix: string,
  installedAt: string,
  integrity: EvidenceIntegrity = INTEGRITY,
): {
  readonly input: InstallCityPackageInput;
  readonly ready: CityResearchPackageReadyCandidate;
} {
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
    }],
    createdAt: suffix === "a"
      ? "2026-01-01T00:00:00.000Z"
      : suffix === "b" ? "2026-01-02T00:00:00.000Z" : "2026-01-03T00:00:00.000Z",
  }, integrity);
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
        value: suffix === "a" ? "300000" : suffix === "b" ? "300001" : "300002",
        referencePeriod: "2026-01-01",
      },
    }],
    coverage: { status: "complete" },
    createdAt: suffix === "a"
      ? "2026-01-01T00:00:00.000Z"
      : suffix === "b" ? "2026-01-02T00:00:00.000Z" : "2026-01-03T00:00:00.000Z",
  }, integrity);
  const catalogProjection: CityCatalogProjection = { registry, catalog };
  const officialAuthorityDirectory = buildOfficialAuthorityDirectory({
    schemaVersion: "official-authority-directory@1",
    countryCode: "SI",
    catalogRevisionId: catalog.id,
    requiredPublisherIds: { police: "police", gov: "gov", opsi: "opsi", surs: "surs" },
    publishers: [
      publisher("municipality-ljubljana", "municipality", "https://ljubljana.si/"),
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
    }],
    rulesVersion: "slovenia-official-authorities@1",
  }, integrity);
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
    }],
  }, integrity);
  const fixedPlans = [
    fixedPlan(CITY_ID, "si-city-long-term-rent", suffix),
    fixedPlan(CITY_ID, "si-city-urban-transit", suffix),
    fixedPlan(CITY_ID, "si-city-fixed-broadband", suffix),
  ] as const;
  const ready: CityResearchPackageReadyCandidate = {
    definition: {
      packageId: APPROVED_FOR.packageId,
      packageSchemaVersion: APPROVED_FOR.packageSchemaVersion,
      countryCode: APPROVED_FOR.countryCode,
      evidenceRulesVersion: APPROVED_FOR.evidenceRulesVersion,
      sourceIds: [...SLOVENIA_CITY_FACT_SOURCE_IDS],
    },
    sourceContractStatus: "bounded_verified_or_unknown",
    readiness: { status: "ready", issues: [] },
  };
  return {
    ready,
    input: {
      countryCode: "SI",
      installedAt,
      catalogProjection,
      fixedPlansByCityId: { [CITY_ID]: fixedPlans },
      safetySourcePlan,
      officialAuthorityDirectory,
      criteriaDefaults: clone(DEFAULTS),
      criterionDefinitions: clone(DEFINITIONS),
    },
  };
}

function twoCityInstallationFixture(): ReturnType<typeof installationFixture> {
  const catalogEvidenceId = "catalog-evidence:two-city";
  const cityIds = ["ljubljana", "maribor"] as const;
  const registry = buildCityRegistryRevision({
    packageId: APPROVED_FOR.packageId,
    packageSchemaVersion: APPROVED_FOR.packageSchemaVersion,
    countryCode: "SI",
    evidenceSnapshotId: catalogEvidenceId,
    entries: cityIds.map((cityId, index) => ({
      cityId,
      countryCode: "SI",
      officialName: index === 0 ? "Ljubljana" : "Maribor",
      coordinate: index === 0 ? { lat: 46.05, lng: 14.51 } : { lat: 46.55, lng: 15.65 },
      administrativeType: "urban_settlement",
      administrativeTerritory: index === 0 ? "Mestna občina Ljubljana" : "Mestna občina Maribor",
      capitalRoles: index === 0 ? ["national" as const] : [],
      evidenceReferenceIds: [catalogEvidenceId],
    })),
    createdAt: "2026-01-04T00:00:00.000Z",
  }, INTEGRITY);
  const catalog = buildCityCatalogRevision({
    registry,
    evidenceSnapshotId: catalogEvidenceId,
    populationDefinition: {
      definitionId: "surs-settlement-population@1",
      geoScope: "settlement",
      unit: "people",
    },
    candidateBasis: cityIds.map((cityId, index) => ({
      cityId,
      comparablePopulation: {
        kind: "verified" as const,
        value: index === 0 ? "300000" : "100000",
        referencePeriod: "2026-01-01",
      },
    })),
    coverage: { status: "complete" },
    createdAt: "2026-01-04T00:00:00.000Z",
  }, INTEGRITY);
  const municipalities = cityIds.map((cityId, index) => ({
    cityId,
    settlementCode: index === 0 ? "061001" : "070001",
    municipalityCode: index === 0 ? "061" : "070",
    officialCityNames: [index === 0 ? "Ljubljana" : "Maribor"],
    officialMunicipalityNames: [
      index === 0 ? "Mestna občina Ljubljana" : "Mestna občina Maribor",
    ],
    publisherId: `municipality-${cityId}`,
    officialHost: `${cityId}.si`,
  }));
  const officialAuthorityDirectory = buildOfficialAuthorityDirectory({
    schemaVersion: "official-authority-directory@1",
    countryCode: "SI",
    catalogRevisionId: catalog.id,
    requiredPublisherIds: { police: "police", gov: "gov", opsi: "opsi", surs: "surs" },
    publishers: [
      ...cityIds.map((cityId) => publisher(
        `municipality-${cityId}`,
        "municipality",
        `https://${cityId}.si/`,
      )),
      publisher("police", "police", "https://policija.si/"),
      publisher("gov", "government", "https://gov.si/"),
      publisher("opsi", "open_data", "https://podatki.gov.si/"),
      publisher("surs", "statistics", "https://pxweb.stat.si/"),
    ],
    municipalities,
    rulesVersion: "slovenia-official-authorities@1",
  }, INTEGRITY);
  const safetySourcePlan = buildCitySafetySourcePlan({
    catalog,
    directory: officialAuthorityDirectory,
    entries: municipalities.map((municipality) => ({
      cityId: municipality.cityId,
      settlementCode: municipality.settlementCode,
      municipalityCode: municipality.municipalityCode,
      officialCityNames: municipality.officialCityNames,
      officialMunicipalityNames: municipality.officialMunicipalityNames,
      publisherIds: [municipality.publisherId, "police", "surs"],
      configuredRoutes: [{
        publisherId: municipality.publisherId,
        navigationUrl: `https://${municipality.cityId}.si/safety/two-city`,
      }],
    })),
  }, INTEGRITY);
  const ready: CityResearchPackageReadyCandidate = {
    definition: {
      packageId: APPROVED_FOR.packageId,
      packageSchemaVersion: APPROVED_FOR.packageSchemaVersion,
      countryCode: "SI",
      evidenceRulesVersion: APPROVED_FOR.evidenceRulesVersion,
      sourceIds: [...SLOVENIA_CITY_FACT_SOURCE_IDS],
    },
    sourceContractStatus: "bounded_verified_or_unknown",
    readiness: { status: "ready", issues: [] },
  };
  return {
    ready,
    input: {
      countryCode: "SI",
      installedAt: "2026-02-04T00:00:00.000Z",
      catalogProjection: { registry, catalog },
      fixedPlansByCityId: Object.fromEntries(cityIds.map((cityId) => [cityId, [
        fixedPlan(cityId, "si-city-long-term-rent", "two-city"),
        fixedPlan(cityId, "si-city-urban-transit", "two-city"),
        fixedPlan(cityId, "si-city-fixed-broadband", "two-city"),
      ] as const])),
      safetySourcePlan,
      officialAuthorityDirectory,
      criteriaDefaults: clone(DEFAULTS),
      criterionDefinitions: clone(DEFINITIONS),
    },
  };
}

type MutableManifestPayload = InstalledCityPackageManifestPayload & {
  fixedPlansByCityId: Record<string, Array<Record<string, unknown>>>;
  safety: Record<string, unknown>;
  criteria: Record<string, unknown>;
};

function manifestFromPrepared(
  input: InstalledCityPackageManifestAppendInput,
  mutate?: (payload: MutableManifestPayload) => void,
): InstalledCityPackageManifest {
  const memberIds = input.catalog.catalog.members.map(({ cityId }) => cityId);
  const bindings = input.administrativeEvidence.bindings;
  const fixedPlansByCityId = Object.fromEntries(memberIds.map((cityId, memberIndex) => [
    cityId,
    input.fixedPlansByCityId[cityId]!.map((plan, sourceIndex) => ({
      sourceId: plan.sourceId,
      cityId: plan.cityId,
      planId: plan.planId,
      criterionId: plan.criterionId,
      definitionId: plan.definitionId,
      parserVersion: plan.parserVersion,
      rulesVersion: plan.rulesVersion,
      freshnessPolicyVersion: plan.claimContract.freshnessPolicyVersion,
      valuePolicyVersion: `task4-derived-value-${sourceIndex}@91`,
      sourcePeriodPolicyVersion: `task4-derived-period-${sourceIndex}@91`,
      planArtifact: clone(bindings[memberIndex * 3 + sourceIndex]!),
    })),
  ]));
  const singletonOffset = memberIds.length * 3;
  const payload = {
    schemaVersion: "installed-city-package-manifest@1",
    key: {
      countryCode: input.ready.definition.countryCode,
      packageId: input.ready.definition.packageId,
      packageSchemaVersion: input.ready.definition.packageSchemaVersion,
      catalogRevisionId: input.catalog.catalog.id,
      evidenceRulesVersion: input.ready.definition.evidenceRulesVersion,
    },
    definition: clone(input.ready.definition),
    sourceContractStatus: input.ready.sourceContractStatus,
    readiness: clone(input.ready.readiness),
    catalogRoot: {
      registryRevisionId: input.catalog.registry.id,
      catalogRevisionId: input.catalog.catalog.id,
    },
    fixedPlansByCityId,
    safety: {
      sourcePlanId: input.safetySourcePlan.id,
      sourcePlanSchemaVersion: input.safetySourcePlan.schemaVersion,
      authorityDirectoryId: input.safetySourcePlan.authorityDirectoryId,
      queryTemplateVersion: input.safetySourcePlan.queryTemplateVersion,
      definitionId: input.safetySourcePlan.definitionId,
      freshnessPolicyVersion: input.safetySourcePlan.freshnessPolicyVersion,
      discoveryRulesVersion: input.safetySourcePlan.discoveryRulesVersion,
      sourcePlanArtifact: clone(bindings[singletonOffset]!),
      authorityDirectoryArtifact: clone(bindings[singletonOffset + 1]!),
    },
    criteria: {
      defaultsMappingVersion: input.criteriaDefaults.mappingVersion,
      definitionIds: Object.fromEntries(input.criterionDefinitions.map((definition) => [
        definition.criterionId,
        definition.definitionId,
      ])),
      evaluatorRegistryVersionId: "arbitrary-task4-registry@91",
      evaluatorVersionIds: Object.fromEntries(CITY_CRITERION_IDS.map((criterionId) => [
        criterionId,
        `arbitrary-task4-${criterionId}@91`,
      ])),
      defaultsArtifact: clone(bindings[singletonOffset + 2]!),
      definitionsArtifact: clone(bindings[singletonOffset + 3]!),
    },
    valueValidatorVersionId: "arbitrary-task4-value-validator@91",
    sourcePeriodValidatorVersionId: "arbitrary-task4-period-validator@91",
    predecessorManifestId: `installed-city-package-manifest:${"a".repeat(64)}`,
    installedAt: input.installedAt,
  } as unknown as MutableManifestPayload;
  mutate?.(payload);
  const canonical = INTEGRITY.canonical(payload);
  const payloadHash = INTEGRITY.hash(canonical);
  return {
    ...payload,
    id: `installed-city-package-manifest:${payloadHash}`,
    payloadHash,
    hmac: INTEGRITY.sign(canonical),
  } as unknown as InstalledCityPackageManifest;
}

function packageFromPrepared(
  input: InstalledCityPackageManifestAppendInput,
  manifest: InstalledCityPackageManifest,
  counters: ExecutableCallCounters,
): InstalledCityResearchPackage {
  const registry = evaluatorRegistry(counters);
  return {
    ...clone(input.ready),
    installedPackageManifest: {
      id: manifest.id,
      key: clone(manifest.key),
    },
    registry: clone(input.catalog.registry),
    catalog: clone(input.catalog.catalog),
    criteriaDefaults: clone(input.criteriaDefaults),
    criterionDefinitions: clone(input.criterionDefinitions),
    evaluatorRegistry: registry,
    fixedPlansByCityId: clone(input.fixedPlansByCityId),
    safetySourcePlan: clone(input.safetySourcePlan),
    officialAuthorityDirectory: clone(input.officialAuthorityDirectory),
    validateValue(inputValue) {
      counters.value += 1;
      return inputValue.value;
    },
    validateSourcePeriod() {
      counters.period += 1;
      return "fresh";
    },
  };
}

interface HarnessState {
  readonly calls: string[];
  readonly executable: ExecutableCallCounters;
  prepared?: InstalledCityPackageManifestAppendInput;
  manifest?: InstalledCityPackageManifest;
  package?: InstalledCityResearchPackage;
  loadAlias?: CityCatalogProjection;
  catalogReceiver?: unknown;
  evidenceReceiver?: unknown;
  manifestReceiver?: unknown;
  lookupReceiver?: unknown;
}

function fakeHarness(fixture: ReturnType<typeof installationFixture>): {
  readonly ports: InstallCityPackagePorts;
  readonly state: HarnessState;
} {
  const state: HarnessState = {
    calls: [],
    executable: { canonicalize: 0, evaluate: 0, value: 0, period: 0 },
  };
  const ports: InstallCityPackagePorts = {
    resolveAvailability: function resolveAvailability(this: unknown, countryCode: string) {
      state.calls.push(`resolve:${String(this)}:${countryCode}`);
      return clone(fixture.ready);
    },
    catalog: {
      appendVerified(this: unknown, projection: CityCatalogProjection) {
        state.catalogReceiver = this;
        state.calls.push("catalog.append");
        return clone(projection);
      },
      loadVerified(this: unknown, id: string) {
        state.catalogReceiver = this;
        state.calls.push(`catalog.load:${id}`);
        state.loadAlias = clone(fixture.input.catalogProjection);
        return state.loadAlias;
      },
    },
    administrativeEvidence: {
      async appendArtifact(this: unknown) {
        state.evidenceReceiver = this;
        state.calls.push("evidence.artifact");
      },
      async seal(this: unknown) {
        state.evidenceReceiver = this;
        state.calls.push("evidence.seal");
      },
    },
    manifests: {
      appendPrepared(this: unknown, input: InstalledCityPackageManifestAppendInput) {
        state.manifestReceiver = this;
        state.calls.push("manifest.append");
        state.prepared = input;
        state.manifest = manifestFromPrepared(input);
        state.package = packageFromPrepared(input, state.manifest, state.executable);
        return state.manifest;
      },
    },
    installedPackages: {
      findReady() {
        state.calls.push("lookup.findReady");
        throw new Error("findReady_must_not_run");
      },
      findExact(this: unknown, key: InstalledCityPackageExactKey) {
        state.lookupReceiver = this;
        state.calls.push(`lookup.findExact:${key.catalogRevisionId}`);
        return state.package;
      },
    },
    approvedDefaults: clone(APPROVED_DEFAULTS),
    integrity: INTEGRITY,
  };
  return { ports, state };
}

async function rejectionOf(operation: Promise<unknown>): Promise<unknown> {
  try {
    await operation;
  } catch (error) {
    return error;
  }
  throw new Error("expected_rejection");
}

function tableCount(database: Database.Database, table: string): number {
  return database.prepare(`SELECT COUNT(*) FROM ${table}`).pluck().get() as number;
}

describe("installCityPackage input, readiness and capability boundary", () => {
  test("installs through the exact ordered fake boundary without executing package behavior", async () => {
    // Break caught: wrong use-case ordering, current-package lookup, or executable policy in Application.
    const fixture = installationFixture("a", "2026-02-01T00:00:00.000Z");
    const { ports, state } = fakeHarness(fixture);
    const result = await installCityPackage(fixture.input, ports);

    expect(result.installedPackageManifest.id).toBe(state.manifest?.id);
    expect(result.installedPackageManifest.key.catalogRevisionId)
      .toBe(fixture.input.catalogProjection.catalog.id);
    expect(state.calls[0]).toBe("resolve:undefined:SI");
    expect(state.calls.indexOf("catalog.append")).toBeGreaterThan(0);
    expect(state.calls.findIndex((call) => call.startsWith("catalog.load:")))
      .toBeGreaterThan(state.calls.indexOf("catalog.append"));
    expect(state.calls.indexOf("evidence.seal"))
      .toBeGreaterThan(state.calls.findIndex((call) => call.startsWith("catalog.load:")));
    expect(state.calls.indexOf("manifest.append")).toBeGreaterThan(state.calls.indexOf("evidence.seal"));
    expect(state.calls.findIndex((call) => call.startsWith("lookup.findExact:")))
      .toBeGreaterThan(state.calls.indexOf("manifest.append"));
    expect(state.calls).not.toContain("lookup.findReady");
    expect(state.calls.filter((call) => call === "resolve:undefined:SI")).toHaveLength(1);
    expect(state.calls.filter((call) => call === "catalog.append")).toHaveLength(1);
    expect(state.calls.filter((call) => call.startsWith("catalog.load:"))).toHaveLength(1);
    expect(state.calls.filter((call) => call === "evidence.artifact")).toHaveLength(7);
    expect(state.calls.filter((call) => call === "evidence.seal")).toHaveLength(1);
    expect(state.calls.filter((call) => call === "manifest.append")).toHaveLength(1);
    expect(state.calls.filter((call) => call.startsWith("lookup.findExact:"))).toHaveLength(1);
    expect(state.catalogReceiver).toBe(ports.catalog);
    expect(state.evidenceReceiver).toBe(ports.administrativeEvidence);
    expect(state.manifestReceiver).toBe(ports.manifests);
    expect(state.lookupReceiver).toBe(ports.installedPackages);
    for (const receiver of [
      state.catalogReceiver,
      state.evidenceReceiver,
      state.manifestReceiver,
      state.lookupReceiver,
    ]) {
      expect(receiver).not.toBe(ports);
      expect(Reflect.ownKeys(receiver as object)).not.toContain("resolveAvailability");
    }
    expect(state.executable).toEqual({ canonicalize: 0, evaluate: 0, value: 0, period: 0 });
  });

  test("rejects malformed input before reading any port descriptor or callback", async () => {
    // Break caught: inspecting authority before the complete data-only input has been owned.
    const fixture = installationFixture("a", "2026-02-01T00:00:00.000Z");
    let portTraps = 0;
    const hostilePorts = new Proxy({} as InstallCityPackagePorts, {
      ownKeys() {
        portTraps += 1;
        throw new Error("ports_proxy_trap_invoked");
      },
      getOwnPropertyDescriptor() {
        portTraps += 1;
        throw new Error("ports_proxy_trap_invoked");
      },
      get() {
        portTraps += 1;
        throw new Error("ports_proxy_trap_invoked");
      },
    });
    const invalidInput = { ...fixture.input, installedAt: "not-an-instant" };

    await expect(installCityPackage(invalidInput, hostilePorts)).rejects.toThrow("integrity_mismatch");
    expect(portTraps).toBe(0);

    const { ports: ordinaryPorts } = fakeHarness(fixture);
    let ordinaryPortReflections = 0;
    const originalGetPrototypeOf = Object.getPrototypeOf;
    const originalGetOwnPropertyDescriptors = Object.getOwnPropertyDescriptors;
    const prototypeSpy = vi.spyOn(Object, "getPrototypeOf").mockImplementation((value) => {
      if (value === ordinaryPorts) ordinaryPortReflections += 1;
      return originalGetPrototypeOf(value);
    });
    const descriptorSpy = vi.spyOn(Object, "getOwnPropertyDescriptors").mockImplementation((value) => {
      if (value === ordinaryPorts) ordinaryPortReflections += 1;
      return originalGetOwnPropertyDescriptors(value);
    });
    try {
      await expect(installCityPackage(invalidInput, ordinaryPorts))
        .rejects.toThrow("integrity_mismatch");
      expect(ordinaryPortReflections).toBe(0);
    } finally {
      prototypeSpy.mockRestore();
      descriptorSpy.mockRestore();
    }
  });

  test("rejects every hostile recursive input shape with zero port reads", async () => {
    // Break caught: getters/proxies/sparse graphs being normalized or callbacks observed before closure.
    let inputBoundaryCalls = 0;
    let portBoundaryCalls = 0;
    const fixture = installationFixture("a", "2026-02-01T00:00:00.000Z");
    const variants: unknown[] = [];
    variants.push({ ...clone(fixture.input), extra: undefined });
    const missing = clone(fixture.input) as unknown as Record<string, unknown>;
    delete missing.installedAt;
    variants.push(missing);
    variants.push(Object.assign(clone(fixture.input), { [Symbol("extra")]: true }));
    variants.push(Object.assign(Object.create({ inherited: true }), clone(fixture.input)));
    variants.push(new Proxy(clone(fixture.input), {
      ownKeys() {
        inputBoundaryCalls += 1;
        throw new Error("input_proxy_trap_invoked");
      },
      getOwnPropertyDescriptor() {
        inputBoundaryCalls += 1;
        throw new Error("input_proxy_trap_invoked");
      },
    }));
    const cyclic = clone(fixture.input) as unknown as Record<string, unknown>;
    (cyclic.catalogProjection as Record<string, unknown>).cycle = cyclic;
    variants.push(cyclic);
    const sparse = clone(fixture.input);
    delete (sparse.fixedPlansByCityId[CITY_ID] as unknown as unknown[])[1];
    variants.push(sparse);
    const nestedAccessor = clone(fixture.input);
    Object.defineProperty(nestedAccessor.catalogProjection.catalog, "id", {
      enumerable: true,
      get() {
        inputBoundaryCalls += 1;
        throw new Error("input_getter_invoked");
      },
    });
    variants.push(nestedAccessor);
    const nestedSymbol = clone(fixture.input);
    Object.defineProperty(nestedSymbol.catalogProjection.catalog, Symbol("extra"), {
      configurable: true,
      enumerable: true,
      value: true,
    });
    variants.push(nestedSymbol);
    const nestedCustomPrototype = clone(fixture.input);
    Object.setPrototypeOf(
      nestedCustomPrototype.catalogProjection.catalog,
      { inherited: true },
    );
    variants.push(nestedCustomPrototype);
    const nestedExtra = clone(fixture.input);
    (nestedExtra.catalogProjection.catalog as unknown as Record<string, unknown>).extra = undefined;
    variants.push(nestedExtra);
    const nestedProxy = clone(fixture.input);
    const borrowedNestedCatalog = nestedProxy.catalogProjection.catalog;
    (nestedProxy.catalogProjection as unknown as { catalog: typeof borrowedNestedCatalog }).catalog =
      new Proxy(borrowedNestedCatalog, {
        ownKeys() {
          inputBoundaryCalls += 1;
          throw new Error("nested_input_proxy_trap_invoked");
        },
        getOwnPropertyDescriptor() {
          inputBoundaryCalls += 1;
          throw new Error("nested_input_proxy_trap_invoked");
        },
      });
    variants.push(nestedProxy);
    variants.push({ ...clone(fixture.input), countryCode: "si" });
    variants.push({ ...clone(fixture.input), installedAt: "2026-02-01" });
    const invalidIdentifier = clone(fixture.input);
    (invalidIdentifier.fixedPlansByCityId[CITY_ID]![0] as unknown as { planId: string }).planId =
      " invalid-plan";
    variants.push(invalidIdentifier);
    const openSafetyPlan = clone(fixture.input);
    (openSafetyPlan.safetySourcePlan as unknown as Record<string, unknown>).extra = true;
    variants.push(openSafetyPlan);
    const missingDirectoryField = clone(fixture.input);
    delete (missingDirectoryField.officialAuthorityDirectory as unknown as Record<string, unknown>)
      .rulesVersion;
    variants.push(missingDirectoryField);
    const invalidSafetyIdentifier = clone(fixture.input);
    (invalidSafetyIdentifier.safetySourcePlan as unknown as { definitionId: string }).definitionId =
      " invalid-safety-definition";
    variants.push(invalidSafetyIdentifier);
    const invalidDirectoryIdentifier = clone(fixture.input);
    (invalidDirectoryIdentifier.officialAuthorityDirectory as unknown as { id: string }).id =
      " invalid-authority-directory";
    variants.push(invalidDirectoryIdentifier);

    for (const input of variants) {
      const hostilePorts = new Proxy({} as InstallCityPackagePorts, {
        ownKeys() {
          portBoundaryCalls += 1;
          throw new Error("ports_proxy_trap_invoked");
        },
        getOwnPropertyDescriptor() {
          portBoundaryCalls += 1;
          throw new Error("ports_proxy_trap_invoked");
        },
      });
      await expect(installCityPackage(input as InstallCityPackageInput, hostilePorts))
        .rejects.toThrow("integrity_mismatch");
      expect(inputBoundaryCalls).toBe(0);
      expect(portBoundaryCalls).toBe(0);
    }
  });

  test("fully validates safety and authority data before invoking a valid resolver", async () => {
    // Break caught: generic ownership deferring open/missing/invalid safety schemas until step 6.
    const fixture = installationFixture("a", "2026-02-01T00:00:00.000Z");
    const openSafety = clone(fixture.input);
    (openSafety.safetySourcePlan as unknown as Record<string, unknown>).extra = true;
    const missingDirectory = clone(fixture.input);
    delete (missingDirectory.officialAuthorityDirectory as unknown as Record<string, unknown>)
      .rulesVersion;
    const invalidSafety = clone(fixture.input);
    (invalidSafety.safetySourcePlan as unknown as { definitionId: string }).definitionId =
      " invalid-safety-definition";
    const invalidDirectory = clone(fixture.input);
    (invalidDirectory.officialAuthorityDirectory as unknown as { id: string }).id =
      " invalid-authority-directory";

    for (const input of [openSafety, missingDirectory, invalidSafety, invalidDirectory]) {
      const { ports, state } = fakeHarness(fixture);
      let resolverCalls = 0;
      (ports as unknown as { resolveAvailability: InstallCityPackagePorts["resolveAvailability"] })
        .resolveAvailability = function (this: void) {
          resolverCalls += 1;
          return fixture.ready;
        };
      await expect(installCityPackage(input, ports)).rejects.toThrow("integrity_mismatch");
      expect(resolverCalls).toBe(0);
      expect(state.calls).toEqual([]);
    }
  });

  test("rejects a malformed ports root before resolver or nested method invocation", async () => {
    // Break caught: a Proxy or open root smuggling authority into the first callback.
    const fixture = installationFixture("a", "2026-02-01T00:00:00.000Z");
    let traps = 0;
    let resolverCalls = 0;
    const target = {
      ...fakeHarness(fixture).ports,
      resolveAvailability() {
        resolverCalls += 1;
        return fixture.ready;
      },
    };
    const proxy = new Proxy(target, {
      ownKeys() {
        traps += 1;
        throw new Error("root_proxy_trap_invoked");
      },
      getOwnPropertyDescriptor() {
        traps += 1;
        throw new Error("root_proxy_trap_invoked");
      },
    });
    await expect(installCityPackage(fixture.input, proxy)).rejects.toThrow("integrity_mismatch");
    expect(traps).toBe(0);
    expect(resolverCalls).toBe(0);

    const openRoot = { ...target, unexpected: undefined };
    await expect(installCityPackage(
      fixture.input,
      openRoot as unknown as InstallCityPackagePorts,
    )).rejects.toThrow("integrity_mismatch");
    expect(resolverCalls).toBe(0);
  });

  test("rejects hostile root, integrity, defaults and nested methods before resolver", async () => {
    // Break caught: invoking or inheriting a capability while pre-capturing the complete authority set.
    let boundaryCalls = 0;
    let resolverCalls = 0;
    const fixture = installationFixture("a", "2026-02-01T00:00:00.000Z");
    const base = fakeHarness(fixture).ports;
    const resolver = () => {
      resolverCalls += 1;
      return fixture.ready;
    };
    const variants: unknown[] = [];
    const missing = { ...base, resolveAvailability: resolver } as unknown as Record<string, unknown>;
    delete missing.manifests;
    variants.push(missing);
    variants.push(Object.assign({ ...base, resolveAvailability: resolver }, { [Symbol("extra")]: true }));
    variants.push(Object.assign(Object.create({ inherited: true }), {
      ...base,
      resolveAvailability: resolver,
    }));
    const accessorRoot = { ...base, resolveAvailability: resolver };
    Object.defineProperty(accessorRoot, "catalog", {
      enumerable: true,
      get() {
        boundaryCalls += 1;
        throw new Error("ports_getter_invoked");
      },
    });
    variants.push(accessorRoot);
    variants.push({
      ...base,
      resolveAvailability: resolver,
      catalog: new Proxy(base.catalog, {
        getPrototypeOf() {
          boundaryCalls += 1;
          throw new Error("nested_proxy_invoked");
        },
        getOwnPropertyDescriptor() {
          boundaryCalls += 1;
          throw new Error("nested_proxy_invoked");
        },
      }),
    });
    const accessorCatalog = {} as Record<string, unknown>;
    Object.defineProperty(accessorCatalog, "appendVerified", {
      enumerable: true,
      get() {
        boundaryCalls += 1;
        throw new Error("nested_method_getter_invoked");
      },
    });
    accessorCatalog.loadVerified = () => fixture.input.catalogProjection;
    variants.push({ ...base, resolveAvailability: resolver, catalog: accessorCatalog });
    variants.push({
      ...base,
      resolveAvailability: resolver,
      integrity: { ...INTEGRITY, extra: undefined },
    });
    variants.push({
      ...base,
      resolveAvailability: resolver,
      integrity: new Proxy({ ...INTEGRITY }, {
        ownKeys() {
          boundaryCalls += 1;
          throw new Error("integrity_proxy_invoked");
        },
      }),
    });
    const accessorDefaults = clone(APPROVED_DEFAULTS);
    Object.defineProperty(accessorDefaults, "byMappingVersion", {
      enumerable: true,
      get() {
        boundaryCalls += 1;
        throw new Error("defaults_getter_invoked");
      },
    });
    variants.push({ ...base, resolveAvailability: resolver, approvedDefaults: accessorDefaults });

    for (const value of variants) {
      await expect(installCityPackage(fixture.input, value as InstallCityPackagePorts))
        .rejects.toThrow("integrity_mismatch");
      expect(boundaryCalls).toBe(0);
      expect(resolverCalls).toBe(0);
    }

    Object.defineProperty(Object.prototype, "appendVerified", {
      configurable: true,
      value: () => fixture.input.catalogProjection,
    });
    try {
      await expect(installCityPackage(fixture.input, {
        ...base,
        resolveAvailability: resolver,
        catalog: { loadVerified: () => fixture.input.catalogProjection } as never,
      })).rejects.toThrow("integrity_mismatch");
      expect(resolverCalls).toBe(0);
    } finally {
      delete (Object.prototype as Record<string, unknown>).appendVerified;
    }
  });

  test("calls availability once standalone and performs zero integrity/store methods when not ready", async () => {
    // Break caught: treating descriptor capture as permission to activate integrity or persistence.
    for (const availability of [undefined, getCityResearchPackageAvailability("SI")]) {
      const fixture = installationFixture("a", "2026-02-01T00:00:00.000Z");
      const { ports, state } = fakeHarness(fixture);
      let resolverCalls = 0;
      let integrityCalls = 0;
      const mutable = ports as unknown as {
        resolveAvailability: InstallCityPackagePorts["resolveAvailability"];
        integrity: EvidenceIntegrity;
      };
      mutable.resolveAvailability = function (this: unknown, countryCode: string) {
        resolverCalls += 1;
        expect(this).toBeUndefined();
        expect(countryCode).toBe("SI");
        return availability;
      };
      mutable.integrity = {
        canonical(value) {
          integrityCalls += 1;
          return INTEGRITY.canonical(value);
        },
        hash(value) {
          integrityCalls += 1;
          return INTEGRITY.hash(value);
        },
        sign(value) {
          integrityCalls += 1;
          return INTEGRITY.sign(value);
        },
      };

      await expect(installCityPackage(fixture.input, ports))
        .rejects.toThrow("city_package_not_ready");
      expect(resolverCalls).toBe(1);
      expect(integrityCalls).toBe(0);
      expect(state.calls).toEqual([]);
    }
  });

  test("captures every authority and owned graph before resolver reentrant mutation", async () => {
    // Break caught: resolving ready and then lazily reading swapped stores, crypto, defaults or input.
    const fixture = installationFixture("a", "2026-02-01T00:00:00.000Z");
    const borrowedInput = clone(fixture.input) as InstallCityPackageInput & {
      installedAt: string;
      countryCode: string;
    };
    const { ports, state } = fakeHarness(fixture);
    const mutablePorts = ports as unknown as Record<string, unknown>;
    const catalog = ports.catalog as unknown as Record<string, unknown>;
    const administrative = ports.administrativeEvidence as unknown as Record<string, unknown>;
    const manifests = ports.manifests as unknown as Record<string, unknown>;
    const lookup = ports.installedPackages as unknown as Record<string, unknown>;
    const integrity = {
      canonical: INTEGRITY.canonical,
      hash: INTEGRITY.hash,
      sign: INTEGRITY.sign,
    };
    mutablePorts.integrity = integrity;
    mutablePorts.resolveAvailability = function (this: unknown) {
      expect(this).toBeUndefined();
      mutablePorts.catalog = { poisoned: true };
      mutablePorts.administrativeEvidence = { poisoned: true };
      mutablePorts.manifests = { poisoned: true };
      mutablePorts.installedPackages = { poisoned: true };
      catalog.appendVerified = () => { throw new Error("swapped_catalog_append"); };
      catalog.loadVerified = () => { throw new Error("swapped_catalog_load"); };
      administrative.appendArtifact = () => { throw new Error("swapped_artifact_append"); };
      administrative.seal = () => { throw new Error("swapped_evidence_seal"); };
      manifests.appendPrepared = () => { throw new Error("swapped_manifest_append"); };
      lookup.findExact = () => { throw new Error("swapped_lookup"); };
      integrity.canonical = () => { throw new Error("swapped_canonical"); };
      integrity.hash = () => { throw new Error("swapped_hash"); };
      integrity.sign = () => { throw new Error("swapped_sign"); };
      (ports.approvedDefaults.byMappingVersion as Record<string, unknown>)[DEFAULTS.mappingVersion] = {
        poisoned: true,
      };
      borrowedInput.countryCode = "ZZ";
      borrowedInput.installedAt = "2099-01-01T00:00:00.000Z";
      (borrowedInput.fixedPlansByCityId as Record<string, unknown>)[CITY_ID] = [];
      return clone(fixture.ready);
    };

    const result = await installCityPackage(borrowedInput, ports);
    expect(result.installedPackageManifest.key.countryCode).toBe("SI");
    expect(state.prepared?.installedAt).toBe("2026-02-01T00:00:00.000Z");
    expect(state.calls).toContain("catalog.append");
    expect(state.calls).toContain("manifest.append");
  });

  test("normalizes every resolver throw without borrowed Error inspection", async () => {
    // Break caught: resolver-spoofed readiness/upgrade codes or proxy/accessor Error side effects.
    const recognized = [
      "city_package_not_ready",
      "city_catalog_upgrade_required",
      "city_package_behavior_unavailable",
      "integrity_mismatch",
    ];
    for (const code of recognized) {
      let boundaryCalls = 0;
      const accessor = Object.create(Error.prototype) as Error;
      Object.defineProperty(accessor, "message", {
        enumerable: false,
        get() {
          boundaryCalls += 1;
          return code;
        },
      });
      const inherited = Object.create(new Error(code)) as Error;
      const custom = new Error(code);
      Object.setPrototypeOf(custom, { custom: true });
      const proxied = new Proxy(new Error(code), {
        getPrototypeOf() {
          boundaryCalls += 1;
          throw new Error("error_proxy_trap_invoked");
        },
        getOwnPropertyDescriptor() {
          boundaryCalls += 1;
          throw new Error("error_proxy_trap_invoked");
        },
      });
      for (const thrown of [code, new Error(code), accessor, inherited, custom, proxied]) {
        const fixture = installationFixture("a", "2026-02-01T00:00:00.000Z");
        const { ports, state } = fakeHarness(fixture);
        (ports as unknown as { resolveAvailability: () => never }).resolveAvailability = () => {
          throw thrown;
        };
        const error = await rejectionOf(installCityPackage(fixture.input, ports));
        expect(error).toBeInstanceOf(Error);
        expect(Object.getPrototypeOf(error)).toBe(Error.prototype);
        expect((error as Error).message).toBe("integrity_mismatch");
        expect(error).not.toBe(thrown);
        expect(boundaryCalls).toBe(0);
        expect(state.calls).toEqual([]);
      }
    }
    for (const thrown of [
      undefined,
      null,
      Symbol("resolver-error"),
      { message: "city_package_not_ready" },
      new Error("arbitrary_resolver_failure"),
    ]) {
      const fixture = installationFixture("a", "2026-02-01T00:00:00.000Z");
      const { ports, state } = fakeHarness(fixture);
      (ports as unknown as { resolveAvailability: () => never }).resolveAvailability = () => {
        throw thrown;
      };
      const error = await rejectionOf(installCityPackage(fixture.input, ports));
      expect((error as Error).message).toBe("integrity_mismatch");
      expect(Object.getPrototypeOf(error)).toBe(Error.prototype);
      expect(error).not.toBe(thrown);
      expect(state.calls).toEqual([]);
    }
  });

  test("rejects malformed availability and ready identity drift without persistence", async () => {
    // Break caught: treating an invalid resolver return as not-ready or accepting a different package definition.
    const fixture = installationFixture("a", "2026-02-01T00:00:00.000Z");
    const invalidNotReady = {
      ...clone(getCityResearchPackageAvailability("SI")!),
      readiness: { status: "not_ready", issues: [] },
    };
    const invalidReady = { ...clone(fixture.ready), unexpected: undefined };
    const readyIdentityDrifts = [
      { ...clone(fixture.ready), definition: { ...clone(fixture.ready.definition), countryCode: "ZZ" } },
      { ...clone(fixture.ready), definition: { ...clone(fixture.ready.definition), packageId: "other-package" } },
      {
        ...clone(fixture.ready),
        definition: { ...clone(fixture.ready.definition), packageSchemaVersion: "other-package@1" },
      },
      {
        ...clone(fixture.ready),
        definition: { ...clone(fixture.ready.definition), evidenceRulesVersion: "other-evidence@1" },
      },
    ];
    for (const availability of [invalidNotReady, invalidReady, ...readyIdentityDrifts]) {
      const { ports, state } = fakeHarness(fixture);
      let resolverCalls = 0;
      (ports as unknown as { resolveAvailability: () => typeof availability }).resolveAvailability = () => {
        resolverCalls += 1;
        return availability;
      };
      const error = await rejectionOf(installCityPackage(fixture.input, ports));
      expect((error as Error).message).toBe("integrity_mismatch");
      expect(resolverCalls).toBe(1);
      expect(state.calls).toEqual([]);
    }
  });

  test("activates integrity only through frozen exact Decision and sealing receivers", async () => {
    // Break caught: callback access to sign during Decision or to the original complete authority root.
    const fixture = installationFixture("a", "2026-02-01T00:00:00.000Z");
    const { ports, state } = fakeHarness(fixture);
    const receivers: Array<{
      readonly capability: string;
      readonly receiver: unknown;
      readonly beforeCatalogAppend: boolean;
    }> = [];
    const borrowedIntegrity: EvidenceIntegrity = {
      canonical: function (this: unknown, value: unknown) {
        receivers.push({
          capability: "canonical",
          receiver: this,
          beforeCatalogAppend: !state.calls.includes("catalog.append"),
        });
        return INTEGRITY.canonical(value);
      },
      hash: function (this: unknown, value: string) {
        receivers.push({
          capability: "hash",
          receiver: this,
          beforeCatalogAppend: !state.calls.includes("catalog.append"),
        });
        return INTEGRITY.hash(value);
      },
      sign: function (this: unknown, value: string) {
        receivers.push({
          capability: "sign",
          receiver: this,
          beforeCatalogAppend: !state.calls.includes("catalog.append"),
        });
        return INTEGRITY.sign(value);
      },
    };
    (ports as unknown as { integrity: EvidenceIntegrity }).integrity = borrowedIntegrity;
    await installCityPackage(fixture.input, ports);

    expect(receivers.length).toBeGreaterThan(0);
    expect(receivers.some(({ capability }) => capability === "sign")).toBe(true);
    for (const { capability, receiver, beforeCatalogAppend } of receivers) {
      expect(receiver).not.toBe(borrowedIntegrity);
      expect(receiver).not.toBe(ports);
      expect(Object.isFrozen(receiver)).toBe(true);
      const keys = Reflect.ownKeys(receiver as object).sort();
      expect([
        ["canonical", "hash"],
        ["canonical", "hash", "sign"],
      ]).toContainEqual(keys);
      if (capability === "sign") expect(keys).toEqual(["canonical", "hash", "sign"]);
      if (beforeCatalogAppend) expect(keys).toEqual(["canonical", "hash"]);
    }
  });
});

describe("installCityPackage structural binding and stage normalization", () => {
  test("rejects legacy Catalog before defaults or persistence", async () => {
    // Break caught: allowing load-compatible @1 roots to become new installed authority.
    const fixture = installationFixture("a", "2026-02-01T00:00:00.000Z");
    const legacyPayload = clone(fixture.input.catalogProjection.catalog) as unknown as
      Record<string, unknown>;
    delete legacyPayload.id;
    const mutableLegacy = legacyPayload as unknown as {
      rulesVersion: "city-catalog@1";
      members: Array<{ cityId: string; inclusionReasons: string[] }>;
    };
    mutableLegacy.rulesVersion = "city-catalog@1";
    mutableLegacy.members = [{
      cityId: CITY_ID,
      inclusionReasons: ["population_threshold", "national_capital"],
    }];
    const legacyCatalog = {
      id: `city-catalog:${INTEGRITY.hash(INTEGRITY.canonical(legacyPayload))}`,
      ...legacyPayload,
    };
    const input = {
      ...fixture.input,
      catalogProjection: {
        registry: fixture.input.catalogProjection.registry,
        catalog: legacyCatalog,
      },
    } as InstallCityPackageInput;
    const { ports, state } = fakeHarness(fixture);

    await expect(installCityPackage(input, ports))
      .rejects.toThrow("city_catalog_upgrade_required");
    expect(state.calls).toEqual(["resolve:undefined:SI"]);
  });

  test("rejects every pre-persistence identity, default and source-contract drift", async () => {
    // Break caught: persisting a package whose closed data graphs do not bind to one expected Catalog.
    const mutations: Array<(input: InstallCityPackageInput) => void> = [
      (input) => { (input as { countryCode: string }).countryCode = "ZZ"; },
      (input) => {
        (input.catalogProjection.catalog as unknown as { evidenceSnapshotId: string })
          .evidenceSnapshotId = "catalog-evidence:other";
      },
      (input) => {
        (input.criteriaDefaults.criteria as unknown as Array<Record<string, unknown>>)[0]!.target = "999";
      },
      (input) => {
        (input.fixedPlansByCityId[CITY_ID]![0] as unknown as { cityId: string }).cityId = "maribor";
      },
      (input) => {
        (input.fixedPlansByCityId[CITY_ID]![1].claimContract as unknown as { geoScope: string })
          .geoScope = "country";
      },
      (input) => {
        (input.fixedPlansByCityId[CITY_ID]![2].claimContract as unknown as { unit: string })
          .unit = "wrong-unit";
      },
      (input) => {
        (input.officialAuthorityDirectory as unknown as { catalogRevisionId: string })
          .catalogRevisionId = "city-catalog:wrong";
      },
      (input) => {
        (input.safetySourcePlan as unknown as { definitionId: string })
          .definitionId = "wrong-safety-definition@1";
      },
    ];
    for (const mutate of mutations) {
      const fixture = installationFixture("a", "2026-02-01T00:00:00.000Z");
      const input = clone(fixture.input);
      mutate(input);
      const { ports, state } = fakeHarness(fixture);
      await expect(installCityPackage(input, ports)).rejects.toThrow("integrity_mismatch");
      expect(state.calls.filter((call) => call === "catalog.append")).toHaveLength(0);
      expect(state.calls.filter((call) => call.startsWith("evidence."))).toHaveLength(0);
      expect(state.calls).not.toContain("manifest.append");
    }
  });

  test("binds every Catalog member to exactly three ordered source plans", async () => {
    // Break caught: one-city tests missing member omission/extra/order and cross-member plan hybrids.
    const positive = twoCityInstallationFixture();
    const positiveInput = clone(positive.input);
    (positiveInput as unknown as {
      fixedPlansByCityId: InstallCityPackageInput["fixedPlansByCityId"];
    }).fixedPlansByCityId = {
      maribor: positiveInput.fixedPlansByCityId.maribor!,
      ljubljana: positiveInput.fixedPlansByCityId.ljubljana!,
    };
    const positiveHarness = fakeHarness(positive);
    await installCityPackage(positiveInput, positiveHarness.ports);
    expect(Object.keys(positiveHarness.state.prepared!.fixedPlansByCityId))
      .toEqual(["ljubljana", "maribor"]);
    expect(positiveHarness.state.calls.filter((call) => call === "evidence.artifact"))
      .toHaveLength(10);

    const mutations: Array<(input: InstallCityPackageInput) => void> = [
      (input) => { delete (input.fixedPlansByCityId as Record<string, unknown>).maribor; },
      (input) => {
        (input.fixedPlansByCityId as Record<string, unknown>).celje =
          input.fixedPlansByCityId.ljubljana;
      },
      (input) => {
        (input.fixedPlansByCityId.maribor as unknown as unknown[]).pop();
      },
      (input) => {
        (input.catalogProjection.catalog.members as unknown as unknown[]).reverse();
      },
      (input) => {
        (input.catalogProjection.catalog.members as unknown as unknown[]).pop();
      },
      (input) => {
        (input.fixedPlansByCityId.maribor![0] as unknown as { sourceId: string }).sourceId =
          "si-city-urban-transit";
      },
      (input) => {
        (input.fixedPlansByCityId.maribor![1] as unknown as { criterionId: string }).criterionId =
          "fixed_broadband";
      },
      (input) => {
        (input.fixedPlansByCityId.maribor![2] as unknown as { definitionId: string }).definitionId =
          "wrong-definition@1";
      },
      (input) => {
        (input.fixedPlansByCityId.maribor![0].claimContract as unknown as { denominator: string })
          .denominator = "wrong-denominator";
      },
      (input) => {
        (input.fixedPlansByCityId.maribor![1].claimContract as unknown as {
          freshnessPolicyVersion: string;
        }).freshnessPolicyVersion = "wrong-freshness@1";
      },
    ];
    for (const mutate of mutations) {
      const fixture = twoCityInstallationFixture();
      const input = clone(fixture.input);
      mutate(input);
      const { ports, state } = fakeHarness(fixture);
      await expect(installCityPackage(input, ports)).rejects.toThrow("integrity_mismatch");
      expect(state.calls).not.toContain("catalog.append");
    }
  });

  test("preserves the approved-default resolver error split with zero persistence", async () => {
    // Break caught: merging absence and malformed/multiple trusted policy into one error.
    const fixture = installationFixture("a", "2026-02-01T00:00:00.000Z");
    const absentHarness = fakeHarness(fixture);
    (absentHarness.ports as unknown as { approvedDefaults: ApprovedCityCriteriaDefaultsRegistry })
      .approvedDefaults = {
        schemaVersion: "approved-city-criteria-defaults-registry@1",
        byMappingVersion: {},
      };
    await expect(installCityPackage(fixture.input, absentHarness.ports))
      .rejects.toThrow("city_package_behavior_unavailable");
    expect(absentHarness.state.calls).toEqual(["resolve:undefined:SI"]);

    for (const registry of [
      {
        schemaVersion: "approved-city-criteria-defaults-registry@1",
        byMappingVersion: {
          first: { unexpected: true },
        },
      },
      {
        schemaVersion: "approved-city-criteria-defaults-registry@1",
        byMappingVersion: {
          first: {
            mappingVersion: "first",
            approvedFor: APPROVED_FOR,
            defaults: { ...DEFAULTS, mappingVersion: "first" },
          },
          second: {
            mappingVersion: "second",
            approvedFor: APPROVED_FOR,
            defaults: { ...DEFAULTS, mappingVersion: "second" },
          },
        },
      },
    ]) {
      const { ports, state } = fakeHarness(fixture);
      (ports as unknown as { approvedDefaults: ApprovedCityCriteriaDefaultsRegistry })
        .approvedDefaults = registry as ApprovedCityCriteriaDefaultsRegistry;
      await expect(installCityPackage(fixture.input, ports)).rejects.toThrow("integrity_mismatch");
      expect(state.calls).toEqual(["resolve:undefined:SI"]);
    }
  });

  test("strictly owns Catalog returns and keeps expected Catalog as key/member authority", async () => {
    // Break caught: using a borrowed load alias after a reentrant seal callback or selecting its key/order.
    const fixture = installationFixture("a", "2026-02-01T00:00:00.000Z");
    const { ports, state } = fakeHarness(fixture);
    let borrowedLoad: CityCatalogProjection | undefined;
    (ports.catalog as unknown as { loadVerified: (id: string) => CityCatalogProjection })
      .loadVerified = (id) => {
        state.calls.push(`catalog.load:${id}`);
        const returned = clone(fixture.input.catalogProjection);
        borrowedLoad = returned;
        state.loadAlias = returned;
        return returned;
      };
    (ports.administrativeEvidence as unknown as {
      appendArtifact: () => Promise<void>;
    }).appendArtifact = async () => {
      state.calls.push("evidence.artifact");
      if (borrowedLoad !== undefined) {
        (borrowedLoad.catalog as unknown as { id: string }).id = "city-catalog:reentrant-drift";
        (borrowedLoad.catalog.members as unknown as unknown[]).reverse();
      }
    };

    const result = await installCityPackage(fixture.input, ports);
    expect(result.installedPackageManifest.key.catalogRevisionId)
      .toBe(fixture.input.catalogProjection.catalog.id);
    expect(state.prepared?.catalog).toEqual(fixture.input.catalogProjection);
    expect(state.prepared?.catalog).not.toBe(borrowedLoad);
    expect(state.prepared?.catalog.catalog.id).toBe(fixture.input.catalogProjection.catalog.id);
  });

  test("rejects drifted and hostile Catalog append/load returns before later callbacks", async () => {
    // Break caught: canonical equality hiding open/accessor/proxy return surfaces.
    let returnBoundaryCalls = 0;
    const fixtures = [
      () => ({ ...installationFixture("a", "2026-02-01T00:00:00.000Z").input.catalogProjection,
        extra: undefined }),
      () => Object.assign(
        clone(installationFixture("a", "2026-02-01T00:00:00.000Z").input.catalogProjection),
        { [Symbol("extra")]: true },
      ),
      () => {
        const value = clone(installationFixture("a", "2026-02-01T00:00:00.000Z").input.catalogProjection) as
          unknown as Record<string, unknown>;
        delete value.registry;
        return value;
      },
      () => Object.assign(Object.create({ inherited: true }),
        clone(installationFixture("a", "2026-02-01T00:00:00.000Z").input.catalogProjection)),
      () => installationFixture("b", "2026-02-02T00:00:00.000Z").input.catalogProjection,
      () => {
        const value = clone(installationFixture("a", "2026-02-01T00:00:00.000Z").input.catalogProjection);
        Object.defineProperty(value, "catalog", {
          enumerable: true,
          get() {
            returnBoundaryCalls += 1;
            throw new Error("catalog_return_getter_invoked");
          },
        });
        return value;
      },
      () => new Proxy(
        clone(installationFixture("a", "2026-02-01T00:00:00.000Z").input.catalogProjection),
        {
          ownKeys() {
            returnBoundaryCalls += 1;
            throw new Error("catalog_return_proxy_invoked");
          },
        },
      ),
    ];
    for (const stage of ["append", "load"] as const) {
      for (const returned of fixtures) {
        const fixture = installationFixture("a", "2026-02-01T00:00:00.000Z");
        const { ports, state } = fakeHarness(fixture);
        if (stage === "append") {
          (ports.catalog as unknown as { appendVerified: () => CityCatalogProjection })
            .appendVerified = () => {
              state.calls.push("catalog.append");
              return returned() as CityCatalogProjection;
            };
        } else {
          (ports.catalog as unknown as { loadVerified: () => CityCatalogProjection })
            .loadVerified = () => {
              state.calls.push("catalog.load:expected");
              return returned() as CityCatalogProjection;
            };
        }
        await expect(installCityPackage(fixture.input, ports)).rejects.toThrow("integrity_mismatch");
        expect(returnBoundaryCalls).toBe(0);
        if (stage === "append") {
          expect(state.calls.filter((call) => call.startsWith("catalog.load:"))).toHaveLength(0);
        }
        expect(state.calls.filter((call) => call.startsWith("evidence."))).toHaveLength(0);
      }
    }
  });

  test("maps Catalog, administrative and lookup callback codes to fresh mismatch", async () => {
    // Break caught: leaking adapter-internal not-found/upgrade/behavior codes across Application.
    const stages = ["catalogAppend", "catalogLoad", "administrative", "lookup"] as const;
    const codes = [
      "city_catalog_not_found",
      "city_catalog_upgrade_required",
      "city_package_behavior_unavailable",
      "integrity_mismatch",
    ];
    for (const stage of stages) {
      for (const code of codes) {
        const fixture = installationFixture("a", "2026-02-01T00:00:00.000Z");
        const { ports, state } = fakeHarness(fixture);
        const thrown = new Error(code);
        if (stage === "catalogAppend") {
          (ports.catalog as unknown as { appendVerified: () => never }).appendVerified = () => {
            throw thrown;
          };
        } else if (stage === "catalogLoad") {
          (ports.catalog as unknown as { loadVerified: () => never }).loadVerified = () => {
            throw thrown;
          };
        } else if (stage === "administrative") {
          (ports.administrativeEvidence as unknown as {
            appendArtifact: () => Promise<never>;
          }).appendArtifact = async () => { throw thrown; };
        } else {
          (ports.installedPackages as unknown as { findExact: () => never }).findExact = () => {
            throw thrown;
          };
        }
        const error = await rejectionOf(installCityPackage(fixture.input, ports));
        expect(error).toBeInstanceOf(Error);
        expect(Object.getPrototypeOf(error)).toBe(Error.prototype);
        expect((error as Error).message).toBe("integrity_mismatch");
        expect(error).not.toBe(thrown);
        if (stage === "lookup") expect(state.calls).toContain("manifest.append");
      }
    }
  });

  test("never inspects hostile callback Error shapes at any post-ready stage", async () => {
    // Break caught: reading borrowed message/prototype fields before the descriptor-safe classifier.
    const stages = [
      "catalogAppend", "catalogLoad", "administrativeAppend", "administrativeSeal",
      "manifest", "lookup",
    ] as const;
    for (const stage of stages) {
      for (const shape of ["primitive", "accessor", "inherited", "custom", "proxy", "arbitrary"] as const) {
        let boundaryCalls = 0;
        let thrown: unknown;
        if (shape === "primitive") {
          thrown = null;
        } else if (shape === "accessor") {
          thrown = Object.create(Error.prototype) as Error;
          Object.defineProperty(thrown, "message", {
            get() {
              boundaryCalls += 1;
              return "city_package_behavior_unavailable";
            },
          });
        } else if (shape === "inherited") {
          thrown = Object.create(new Error("city_package_behavior_unavailable"));
        } else if (shape === "custom") {
          thrown = new Error("city_package_behavior_unavailable");
          Object.setPrototypeOf(thrown, { custom: true });
        } else if (shape === "proxy") {
          thrown = new Proxy(new Error("city_package_behavior_unavailable"), {
            getPrototypeOf() {
              boundaryCalls += 1;
              throw new Error("error_proxy_trap_invoked");
            },
            getOwnPropertyDescriptor() {
              boundaryCalls += 1;
              throw new Error("error_proxy_trap_invoked");
            },
          });
        } else {
          thrown = new Error("arbitrary_adapter_failure");
        }
        const fixture = installationFixture("a", "2026-02-01T00:00:00.000Z");
        const { ports } = fakeHarness(fixture);
        if (stage === "catalogAppend") {
          (ports.catalog as unknown as { appendVerified: () => never }).appendVerified = () => {
            throw thrown;
          };
        } else if (stage === "catalogLoad") {
          (ports.catalog as unknown as { loadVerified: () => never }).loadVerified = () => {
            throw thrown;
          };
        } else if (stage === "administrativeAppend") {
          (ports.administrativeEvidence as unknown as {
            appendArtifact: () => Promise<never>;
          }).appendArtifact = async () => { throw thrown; };
        } else if (stage === "administrativeSeal") {
          (ports.administrativeEvidence as unknown as {
            seal: () => Promise<never>;
          }).seal = async () => { throw thrown; };
        } else if (stage === "manifest") {
          (ports.manifests as unknown as { appendPrepared: () => never }).appendPrepared = () => {
            throw thrown;
          };
        } else {
          (ports.installedPackages as unknown as { findExact: () => never }).findExact = () => {
            throw thrown;
          };
        }
        const error = await rejectionOf(installCityPackage(fixture.input, ports));
        expect((error as Error).message).toBe("integrity_mismatch");
        expect(Object.getPrototypeOf(error)).toBe(Error.prototype);
        expect(error).not.toBe(thrown);
        expect(boundaryCalls).toBe(0);
      }
    }
  });

  test("preserves only fresh descriptor-safe manifest behavior errors", async () => {
    // Break caught: swallowing Task 4 behavior availability or leaking its borrowed Error identity.
    for (const code of ["city_package_behavior_unavailable", "integrity_mismatch"]) {
      const fixture = installationFixture("a", "2026-02-01T00:00:00.000Z");
      const { ports } = fakeHarness(fixture);
      const thrown = new Error(code);
      (ports.manifests as unknown as { appendPrepared: () => never }).appendPrepared = () => {
        throw thrown;
      };
      const error = await rejectionOf(installCityPackage(fixture.input, ports));
      expect(error).toBeInstanceOf(Error);
      expect(Object.getPrototypeOf(error)).toBe(Error.prototype);
      expect((error as Error).message).toBe(code);
      expect(error).not.toBe(thrown);
    }
  });
});

describe("installCityPackage manifest and exact lookup verification", () => {
  test("accepts closed signed predecessor and Task 4 behavior versions without selecting them", async () => {
    // Break caught: Application constructing an expected manifest payload or choosing Task 4 fields.
    const fixture = installationFixture("a", "2026-02-01T00:00:00.000Z");
    const { ports, state } = fakeHarness(fixture);
    const result = await installCityPackage(fixture.input, ports);

    expect(state.manifest?.predecessorManifestId)
      .toBe(`installed-city-package-manifest:${"a".repeat(64)}`);
    expect(state.manifest?.criteria.evaluatorRegistryVersionId)
      .toBe("arbitrary-task4-registry@91");
    expect(state.manifest?.valueValidatorVersionId)
      .toBe("arbitrary-task4-value-validator@91");
    expect(state.manifest?.fixedPlansByCityId[CITY_ID]?.[0].valuePolicyVersion)
      .toBe("task4-derived-value-0@91");
    expect(result.installedPackageManifest.id).toBe(state.manifest?.id);
  });

  test("rejects independently signed manifest drift in every Application-known binding", async () => {
    // Break caught: accepting a self-consistent envelope whose known installation semantics drift.
    const mutations: Array<(payload: MutableManifestPayload) => void> = [
      (payload) => { (payload.key as { catalogRevisionId: string }).catalogRevisionId = "city-catalog:drift"; },
      (payload) => { (payload.definition as { countryCode: string }).countryCode = "ZZ"; },
      (payload) => { (payload.readiness as { status: string }).status = "not_ready"; },
      (payload) => { (payload.catalogRoot as { registryRevisionId: string }).registryRevisionId = "city-registry:drift"; },
      (payload) => { (payload as { installedAt: string }).installedAt = "2026-02-02T00:00:00.000Z"; },
      (payload) => {
        const binding = payload.fixedPlansByCityId[CITY_ID]![0]!.planArtifact as {
          artifactId: string;
        };
        binding.artifactId = "city-package-artifact:drift";
      },
      (payload) => {
        (payload.safety.sourcePlanArtifact as { artifactId: string }).artifactId =
          "city-package-artifact:drift";
      },
      (payload) => {
        (payload.criteria.defaultsArtifact as { artifactId: string }).artifactId =
          "city-package-artifact:drift";
      },
      (payload) => {
        (payload.criteria as { defaultsMappingVersion: string }).defaultsMappingVersion =
          "drifted-mapping@1";
      },
      (payload) => {
        (payload.criteria.definitionIds as Record<string, string>).safety = "drifted-definition@1";
      },
    ];
    for (const mutate of mutations) {
      const fixture = installationFixture("a", "2026-02-01T00:00:00.000Z");
      const { ports, state } = fakeHarness(fixture);
      (ports.manifests as unknown as {
        appendPrepared: (input: InstalledCityPackageManifestAppendInput) => InstalledCityPackageManifest;
      }).appendPrepared = (input) => {
        state.calls.push("manifest.append");
        state.prepared = input;
        state.manifest = manifestFromPrepared(input, mutate);
        state.package = packageFromPrepared(input, state.manifest, state.executable);
        return state.manifest;
      };

      await expect(installCityPackage(fixture.input, ports)).rejects.toThrow("integrity_mismatch");
      expect(state.calls.filter((call) => call.startsWith("lookup."))).toHaveLength(0);
    }
  });

  test("verifies the signed manifest envelope before comparing known installation bindings", async () => {
    // Break caught: rejecting a known field before proving that the returned envelope is authentic.
    const fixture = installationFixture("a", "2026-02-01T00:00:00.000Z");
    const { ports, state } = fakeHarness(fixture);
    const integrityCalls: string[] = [];
    const observedIntegrity: EvidenceIntegrity = {
      canonical(value: unknown) {
        integrityCalls.push("canonical");
        return INTEGRITY.canonical(value);
      },
      hash(value: string) {
        integrityCalls.push("hash");
        return INTEGRITY.hash(value);
      },
      sign(value: string) {
        integrityCalls.push("sign");
        return INTEGRITY.sign(value);
      },
    };
    (ports as unknown as { integrity: EvidenceIntegrity }).integrity = observedIntegrity;
    (ports.manifests as unknown as {
      appendPrepared: (input: InstalledCityPackageManifestAppendInput) => InstalledCityPackageManifest;
    }).appendPrepared = (input) => {
      state.calls.push("manifest.append");
      const drifted = manifestFromPrepared(input, (payload) => {
        (payload.key as { catalogRevisionId: string }).catalogRevisionId = "city-catalog:drift";
      });
      integrityCalls.splice(0);
      return drifted;
    };

    await expect(installCityPackage(fixture.input, ports)).rejects.toThrow("integrity_mismatch");
    expect(integrityCalls.slice(0, 3)).toEqual(["canonical", "hash", "sign"]);
    expect(state.calls.filter((call) => call.startsWith("lookup."))).toHaveLength(0);
  });

  test("requires the exact 16-key envelope and exact 13-key payload before lookup", async () => {
    // Break caught: canonical JSON omitting open undefined/accessor/proxy manifest surfaces.
    let boundaryCalls = 0;
    const variants: Array<(manifest: InstalledCityPackageManifest) => unknown> = [
      (manifest) => ({ ...manifest, extra: undefined }),
      (manifest) => Object.assign({ ...manifest }, { [Symbol("extra")]: true }),
      (manifest) => {
        const value = { ...manifest } as unknown as Record<string, unknown>;
        delete value.hmac;
        return value;
      },
      (manifest) => {
        const value = { ...manifest };
        Object.setPrototypeOf(value, { inherited: true });
        return value;
      },
      (manifest) => {
        const value = { ...manifest };
        Object.defineProperty(value, "id", {
          enumerable: true,
          get() {
            boundaryCalls += 1;
            throw new Error("manifest_getter_invoked");
          },
        });
        return value;
      },
      (manifest) => new Proxy(manifest, {
        ownKeys() {
          boundaryCalls += 1;
          throw new Error("manifest_proxy_invoked");
        },
        getOwnPropertyDescriptor() {
          boundaryCalls += 1;
          throw new Error("manifest_proxy_invoked");
        },
      }),
      (manifest) => ({ ...manifest, catalogRoot: { ...manifest.catalogRoot, extra: undefined } }),
      (manifest) => ({
        ...manifest,
        catalogRoot: Object.assign({ ...manifest.catalogRoot }, { [Symbol("extra")]: true }),
      }),
      (manifest) => {
        const catalogRoot = { ...manifest.catalogRoot };
        Object.setPrototypeOf(catalogRoot, { inherited: true });
        return { ...manifest, catalogRoot };
      },
      (manifest) => {
        const catalogRoot = { ...manifest.catalogRoot };
        Object.defineProperty(catalogRoot, "catalogRevisionId", {
          enumerable: true,
          get() {
            boundaryCalls += 1;
            throw new Error("nested_manifest_getter_invoked");
          },
        });
        return { ...manifest, catalogRoot };
      },
      (manifest) => ({
        ...manifest,
        catalogRoot: new Proxy(manifest.catalogRoot, {
          ownKeys() {
            boundaryCalls += 1;
            throw new Error("nested_manifest_proxy_invoked");
          },
          getOwnPropertyDescriptor() {
            boundaryCalls += 1;
            throw new Error("nested_manifest_proxy_invoked");
          },
        }),
      }),
      (manifest) => {
        const value = clone(manifest);
        delete (value.catalogRoot as unknown as Record<string, unknown>).catalogRevisionId;
        return value;
      },
      (manifest) => {
        const value = clone(manifest);
        delete (value.fixedPlansByCityId[CITY_ID] as unknown as unknown[])[1];
        return value;
      },
      (manifest) => ({ ...manifest, payloadHash: "0".repeat(64) }),
      (manifest) => ({ ...manifest, hmac: "0".repeat(64) }),
      (manifest) => ({ ...manifest, id: `installed-city-package-manifest:${"0".repeat(64)}` }),
    ];
    for (const variant of variants) {
      const fixture = installationFixture("a", "2026-02-01T00:00:00.000Z");
      const { ports, state } = fakeHarness(fixture);
      (ports.manifests as unknown as {
        appendPrepared: (input: InstalledCityPackageManifestAppendInput) => InstalledCityPackageManifest;
      }).appendPrepared = (input) => {
        state.calls.push("manifest.append");
        const valid = manifestFromPrepared(input);
        return variant(valid) as InstalledCityPackageManifest;
      };
      await expect(installCityPackage(fixture.input, ports)).rejects.toThrow("integrity_mismatch");
      expect(boundaryCalls).toBe(0);
      expect(state.calls.filter((call) => call.startsWith("lookup."))).toHaveLength(0);
    }
  });

  test("owns the returned manifest before exact lookup can mutate its borrowed aliases", async () => {
    // Break caught: retaining the manifest adapter's mutable object through lookup validation.
    const fixture = installationFixture("a", "2026-02-01T00:00:00.000Z");
    const { ports, state } = fakeHarness(fixture);
    let originalId = "";
    let originalCatalogRevisionId = "";
    (ports.installedPackages as unknown as {
      findExact: InstalledCityPackageLookupPort["findExact"];
    }).findExact = () => {
      const borrowed = state.manifest!;
      originalId = borrowed.id;
      originalCatalogRevisionId = borrowed.key.catalogRevisionId;
      (borrowed as unknown as { id: string }).id =
        `installed-city-package-manifest:${"0".repeat(64)}`;
      (borrowed.key as unknown as { catalogRevisionId: string }).catalogRevisionId =
        "city-catalog:mutated-during-lookup";
      (borrowed.catalogRoot as unknown as { catalogRevisionId: string }).catalogRevisionId =
        "city-catalog:mutated-during-lookup";
      return state.package;
    };

    const installed = await installCityPackage(fixture.input, ports);
    expect(installed.installedPackageManifest.id).toBe(originalId);
    expect(installed.installedPackageManifest.key.catalogRevisionId).toBe(originalCatalogRevisionId);
  });

  test("owns the exact function-valued package without executing it and returns receiver-safe wrappers", async () => {
    // Break caught: returning borrowed functions/data or invoking executable policy during installation.
    const fixture = installationFixture("a", "2026-02-01T00:00:00.000Z");
    const { ports, state } = fakeHarness(fixture);
    const validatorReceivers: unknown[] = [];
    const periodReceivers: unknown[] = [];
    const evaluatorReceivers: unknown[] = [];
    let originalValidatorCalls = 0;
    let originalPeriodCalls = 0;
    let originalEvaluatorCalls = 0;
    (ports.installedPackages as unknown as {
      findExact: InstalledCityPackageLookupPort["findExact"];
    }).findExact = () => {
      const borrowed = state.package!;
      const mutableBorrowed = borrowed as unknown as {
        validateValue: CityFixedValueValidator;
        validateSourcePeriod: CityFixedSourcePeriodValidator;
        evaluatorRegistry: CityCriterionEvaluatorRegistry;
      };
      mutableBorrowed.validateValue = function (this: unknown, input) {
        originalValidatorCalls += 1;
        validatorReceivers.push(this);
        (input as unknown as { value: string }).value = "mutated-inside-validator";
        return "owned-validator-result";
      };
      mutableBorrowed.validateSourcePeriod = function (this: unknown) {
        originalPeriodCalls += 1;
        periodReceivers.push(this);
        return "fresh";
      };
      const mutableSafety = mutableBorrowed.evaluatorRegistry.safety as unknown as {
        canonicalizeTarget: (target: unknown) => string;
        evaluate: (input: unknown) => unknown;
      };
      mutableSafety.canonicalizeTarget = function (
        this: unknown,
        target: unknown,
      ) {
        originalEvaluatorCalls += 1;
        evaluatorReceivers.push(this);
        return String(target);
      };
      mutableSafety.evaluate = function (this: unknown) {
        originalEvaluatorCalls += 1;
        evaluatorReceivers.push(this);
        return { state: "verified", factor: "1", targetComparison: "matches" };
      };
      return borrowed;
    };

    const result = await installCityPackage(fixture.input, ports);
    expect(originalValidatorCalls).toBe(0);
    expect(originalPeriodCalls).toBe(0);
    expect(originalEvaluatorCalls).toBe(0);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.evaluatorRegistry.safety)).toBe(true);
    const borrowed = state.package!;
    (borrowed.catalog as unknown as { id: string }).id = "city-catalog:after-return-mutation";
    (borrowed as unknown as { validateValue: CityFixedValueValidator }).validateValue = () => {
      throw new Error("swapped_after_return");
    };
    expect(result.catalog.id).toBe(fixture.input.catalogProjection.catalog.id);
    const validatorInput = {
      sourceId: "si-city-long-term-rent" as const,
      criterionId: "long_term_rent" as const,
      definitionId: "long_term_rent-definition@1",
      policyVersion: "canonical-scalar@1",
      value: "123",
      unit: "canonical-unit",
      denominator: "canonical-denominator",
    };
    expect(result.validateValue(validatorInput)).toBe("owned-validator-result");
    expect(validatorInput.value).toBe("123");
    expect(result.validateSourcePeriod({
      sourceId: "si-city-long-term-rent",
      policyVersion: "annual-period@1",
      sourcePeriod: "2025",
      assessmentAt: "2026-02-01T00:00:00.000Z",
    })).toBe("fresh");
    expect(result.evaluatorRegistry.safety.canonicalizeTarget("4")).toBe("4");
    expect(result.evaluatorRegistry.safety.evaluate({} as never)).toEqual({
      state: "verified",
      factor: "1",
      targetComparison: "matches",
    });
    expect(originalValidatorCalls).toBe(1);
    expect(originalPeriodCalls).toBe(1);
    expect(originalEvaluatorCalls).toBe(2);
    expect(validatorReceivers).toHaveLength(1);
    expect(periodReceivers).toHaveLength(1);
    expect(evaluatorReceivers).toHaveLength(2);
    const validatorReceiver = validatorReceivers[0];
    const periodReceiver = periodReceivers[0];
    const evaluatorReceiver = evaluatorReceivers[0];
    expect(validatorReceiver).not.toBe(borrowed);
    expect(periodReceiver).not.toBe(borrowed);
    expect(evaluatorReceiver).not.toBe(borrowed.evaluatorRegistry.safety);
    expect(Object.isFrozen(validatorReceiver)).toBe(true);
    expect(Object.isFrozen(periodReceiver)).toBe(true);
    expect(Object.isFrozen(evaluatorReceiver)).toBe(true);
    expect(validatorReceiver).toEqual({ capability: "validateValue" });
    expect(periodReceiver).toEqual({ capability: "validateSourcePeriod" });
    expect(evaluatorReceiver).toEqual({ criterionId: "safety" });
  });

  test("rejects missing, drifted and hostile exact lookup returns without function execution", async () => {
    // Break caught: treating lookup as authority or accepting an open callable package surface.
    let boundaryCalls = 0;
    const variants: Array<(state: HarnessState) => unknown> = [
      () => undefined,
      (state) => ({ ...state.package!, extra: undefined }),
      (state) => {
        const value = { ...state.package! };
        Object.setPrototypeOf(value, { inherited: true });
        return value;
      },
      (state) => new Proxy(state.package!, {
        ownKeys() {
          boundaryCalls += 1;
          throw new Error("package_proxy_invoked");
        },
      }),
      (state) => {
        const value = { ...state.package! };
        Object.defineProperty(value, "catalog", {
          enumerable: true,
          get() {
            boundaryCalls += 1;
            throw new Error("package_getter_invoked");
          },
        });
        return value;
      },
      (state) => ({
        ...state.package!,
        installedPackageManifest: {
          ...state.package!.installedPackageManifest,
          id: "installed-city-package-manifest:wrong",
        },
      }),
      (state) => ({
        ...state.package!,
        installedPackageManifest: {
          ...state.package!.installedPackageManifest,
          key: {
            ...state.package!.installedPackageManifest.key,
            catalogRevisionId: "city-catalog:wrong",
          },
        },
      }),
      (state) => ({
        ...state.package!,
        definition: { ...state.package!.definition, countryCode: "ZZ" },
      }),
      (state) => ({
        ...state.package!,
        sourceContractStatus: "drifted-status",
      }),
      (state) => ({
        ...state.package!,
        readiness: { status: "not_ready", issues: [] },
      }),
      (state) => ({
        ...state.package!,
        registry: { ...state.package!.registry, id: "city-registry:wrong" },
      }),
      (state) => ({ ...state.package!, catalog: { ...state.package!.catalog, id: "city-catalog:wrong" } }),
      (state) => ({
        ...state.package!,
        criteriaDefaults: { ...state.package!.criteriaDefaults, mappingVersion: "wrong-mapping@1" },
      }),
      (state) => ({
        ...state.package!,
        criterionDefinitions: state.package!.criterionDefinitions.map((definition, index) =>
          index === 0 ? { ...definition, definitionId: "wrong-definition@1" } : definition),
      }),
      (state) => ({
        ...state.package!,
        fixedPlansByCityId: {
          ...state.package!.fixedPlansByCityId,
          [CITY_ID]: state.package!.fixedPlansByCityId[CITY_ID]!.map((plan, index) =>
            index === 0 ? { ...plan, planId: "wrong-plan@1" } : plan),
        },
      }),
      (state) => ({
        ...state.package!,
        safetySourcePlan: { ...state.package!.safetySourcePlan, id: "wrong-safety-plan@1" },
      }),
      (state) => ({
        ...state.package!,
        officialAuthorityDirectory: {
          ...state.package!.officialAuthorityDirectory,
          id: "wrong-authority-directory@1",
        },
      }),
      (state) => ({ ...state.package!, validateValue: "not-a-function" }),
      (state) => ({
        ...state.package!,
        validateValue: new Proxy(state.package!.validateValue, {
          apply() {
            boundaryCalls += 1;
            throw new Error("validator_proxy_invoked");
          },
          getPrototypeOf() {
            boundaryCalls += 1;
            throw new Error("validator_proxy_invoked");
          },
        }),
      }),
      (state) => {
        const value = { ...state.package! };
        Object.defineProperty(value, "validateSourcePeriod", {
          enumerable: true,
          get() {
            boundaryCalls += 1;
            throw new Error("validator_getter_invoked");
          },
        });
        return value;
      },
      (state) => ({
        ...state.package!,
        evaluatorRegistry: { ...state.package!.evaluatorRegistry, extra: state.package!.evaluatorRegistry.safety },
      }),
      (state) => ({
        ...state.package!,
        evaluatorRegistry: {
          ...state.package!.evaluatorRegistry,
          safety: {
            ...state.package!.evaluatorRegistry.safety,
            definition: {
              ...state.package!.evaluatorRegistry.safety.definition,
              definitionId: "wrong-definition@1",
            },
          },
        },
      }),
    ];
    for (const variant of variants) {
      const fixture = installationFixture("a", "2026-02-01T00:00:00.000Z");
      const { ports, state } = fakeHarness(fixture);
      (ports.installedPackages as unknown as { findExact: () => unknown }).findExact = () => {
        state.calls.push("lookup.findExact:override");
        return variant(state);
      };
      await expect(installCityPackage(fixture.input, ports)).rejects.toThrow("integrity_mismatch");
      expect(boundaryCalls).toBe(0);
      expect(state.executable).toEqual({ canonicalize: 0, evaluate: 0, value: 0, period: 0 });
      expect(state.calls).toContain("manifest.append");
      expect(state.calls.filter((call) => call.startsWith("lookup.findExact:"))).toHaveLength(1);
    }
  });
});

describe("city-package installation composition and persisted recovery", () => {
  test("returns one frozen administrative method and keeps the user-facing root free of install authority", () => {
    // Break caught: exposing stores/registries or wiring the administrative installer into user delivery.
    const database = memoryDatabase();
    const fixture = installationFixture("a", "2026-02-01T00:00:00.000Z");
    const composition = createCityPackageInstallationComposition({
      database,
      hmacKey: INTEGRITY_KEY,
      resolveAvailability: () => fixture.ready,
      approvedDefaults: APPROVED_DEFAULTS,
      behaviors: behaviorRegistry(),
    });
    expect(Reflect.ownKeys(composition)).toEqual(["installCityPackage"]);
    const installDescriptor = Object.getOwnPropertyDescriptor(composition, "installCityPackage");
    expect(installDescriptor).toMatchObject({ enumerable: true });
    expect(installDescriptor).toHaveProperty("value");
    expect(typeof installDescriptor?.value).toBe("function");
    expect(Object.isFrozen(composition)).toBe(true);

    const forbidden = /(?:install.*city|city.*install|catalog.*append|append.*catalog|manifest.*append|append.*manifest|availability|approved.*defaults|behaviors?)/i;
    expect(Object.keys(userCompositionModule).filter((key) => forbidden.test(key))).toEqual([]);
    const userApplication = userCompositionModule.createConfirmedLifeComposition({
      database,
      hmacKey: INTEGRITY_KEY,
    });
    expect(Object.keys(userApplication).filter((key) => forbidden.test(key))).toEqual([]);
  });

  test("owns defaults and behavior once and requires an exact five-option factory boundary", async () => {
    // Break caught: lazy option reads, production fallback, or additional raw factory capability.
    const database = memoryDatabase();
    const fixture = installationFixture("a", "2026-02-01T00:00:00.000Z");
    const defaults = clone(APPROVED_DEFAULTS);
    const behaviors = behaviorRegistry();
    const composition = createCityPackageInstallationComposition({
      database,
      hmacKey: INTEGRITY_KEY,
      resolveAvailability: function (this: unknown) {
        expect(this).toBeUndefined();
        return clone(fixture.ready);
      },
      approvedDefaults: defaults,
      behaviors,
    });
    (defaults.byMappingVersion as Record<string, unknown>)[DEFAULTS.mappingVersion] = {
      poisoned: true,
    };
    (behaviors.entries as unknown as unknown[]).splice(0);
    const installed = await composition.installCityPackage(fixture.input);
    expect(installed.catalog.id).toBe(fixture.input.catalogProjection.catalog.id);

    let factoryBoundaryCalls = 0;
    const validOptions = {
      database,
      hmacKey: INTEGRITY_KEY,
      resolveAvailability: () => fixture.ready,
      approvedDefaults: APPROVED_DEFAULTS,
      behaviors: behaviorRegistry(),
    };
    const invalidOptions: unknown[] = [
      {
        database,
        hmacKey: INTEGRITY_KEY,
        resolveAvailability: () => fixture.ready,
        approvedDefaults: APPROVED_DEFAULTS,
      },
      {
        database,
        hmacKey: INTEGRITY_KEY,
        resolveAvailability: () => fixture.ready,
        approvedDefaults: APPROVED_DEFAULTS,
        behaviors: behaviorRegistry(),
        extra: undefined,
      },
      Object.assign(Object.create({ inherited: true }), {
        database,
        hmacKey: INTEGRITY_KEY,
        resolveAvailability: () => fixture.ready,
        approvedDefaults: APPROVED_DEFAULTS,
        behaviors: behaviorRegistry(),
      }),
      Object.assign({ ...validOptions }, { [Symbol("extra")]: true }),
      (() => {
        const value = { ...validOptions };
        Object.defineProperty(value, "approvedDefaults", {
          enumerable: true,
          get() {
            factoryBoundaryCalls += 1;
            throw new Error("factory_getter_invoked");
          },
        });
        return value;
      })(),
      new Proxy(validOptions, {
        ownKeys() {
          factoryBoundaryCalls += 1;
          throw new Error("factory_proxy_invoked");
        },
        getOwnPropertyDescriptor() {
          factoryBoundaryCalls += 1;
          throw new Error("factory_proxy_invoked");
        },
      }),
    ];
    for (const options of invalidOptions) {
      expect(() => createCityPackageInstallationComposition(options as never))
        .toThrow("integrity_mismatch");
      expect(factoryBoundaryCalls).toBe(0);
    }
  });

  test("installs A then B, restarts, and retrying A returns A while B stays current", async () => {
    // Break caught: exact retry following the head or replacing historical A with current B.
    const databasePath = temporaryDatabasePath();
    const fixtureA = installationFixture("a", "2026-02-01T00:00:00.000Z");
    const fixtureB = installationFixture("b", "2026-02-02T00:00:00.000Z");
    let database = openEvidenceDatabase(databasePath);
    databases.push(database);
    const firstFactory = createCityPackageInstallationComposition({
      database,
      hmacKey: INTEGRITY_KEY,
      resolveAvailability: () => clone(fixtureA.ready),
      approvedDefaults: APPROVED_DEFAULTS,
      behaviors: behaviorRegistry(),
    });
    const installedA = await firstFactory.installCityPackage(fixtureA.input);
    const installedB = await firstFactory.installCityPackage(fixtureB.input);
    expect(installedB.installedPackageManifest.id).not.toBe(installedA.installedPackageManifest.id);
    const beforeRetryRows = {
      catalogs: tableCount(database, "city_catalog_revisions"),
      evidence: tableCount(database, "evidence_snapshots"),
      artifacts: tableCount(database, "artifacts"),
      manifests: tableCount(database, "installed_city_package_manifests"),
      heads: tableCount(database, "installed_city_package_heads"),
    };
    database.close();

    database = openEvidenceDatabase(databasePath);
    databases.push(database);
    const restartedFactory = createCityPackageInstallationComposition({
      database,
      hmacKey: INTEGRITY_KEY,
      resolveAvailability: () => clone(fixtureA.ready),
      approvedDefaults: APPROVED_DEFAULTS,
      behaviors: behaviorRegistry(),
    });
    const retriedA = await restartedFactory.installCityPackage(fixtureA.input);
    expect(retriedA.installedPackageManifest.id).toBe(installedA.installedPackageManifest.id);
    expect({
      catalogs: tableCount(database, "city_catalog_revisions"),
      evidence: tableCount(database, "evidence_snapshots"),
      artifacts: tableCount(database, "artifacts"),
      manifests: tableCount(database, "installed_city_package_manifests"),
      heads: tableCount(database, "installed_city_package_heads"),
    }).toEqual(beforeRetryRows);
    const store = new SqliteCityPackageManifestStore(
      database,
      INTEGRITY,
      APPROVED_DEFAULTS,
      behaviorRegistry(),
    );
    const current = new InstalledCityPackages(store).findReady("SI");
    expect(current?.installedPackageManifest.id).toBe(installedB.installedPackageManifest.id);
  });

  test("keeps partial Catalog/Evidence when behavior is unavailable and resumes without duplicate rows", async () => {
    // Break caught: an outer transaction/compensation erasing permitted independent effects.
    const databasePath = temporaryDatabasePath();
    let database = openEvidenceDatabase(databasePath);
    databases.push(database);
    const fixture = installationFixture("a", "2026-02-01T00:00:00.000Z");
    const unavailableFactory = createCityPackageInstallationComposition({
      database,
      hmacKey: INTEGRITY_KEY,
      resolveAvailability: () => clone(fixture.ready),
      approvedDefaults: APPROVED_DEFAULTS,
      behaviors: {
        schemaVersion: "installed-city-package-behavior-registry@1",
        entries: [],
      },
    });
    await expect(unavailableFactory.installCityPackage(fixture.input))
      .rejects.toThrow("city_package_behavior_unavailable");
    expect(tableCount(database, "city_catalog_revisions")).toBe(1);
    expect(tableCount(database, "evidence_snapshots")).toBe(1);
    expect(tableCount(database, "artifacts")).toBe(7);
    expect(tableCount(database, "installed_city_package_manifests")).toBe(0);
    expect(tableCount(database, "installed_city_package_heads")).toBe(0);

    database.close();
    database = openEvidenceDatabase(databasePath);
    databases.push(database);
    const recoveredFactory = createCityPackageInstallationComposition({
      database,
      hmacKey: INTEGRITY_KEY,
      resolveAvailability: () => clone(fixture.ready),
      approvedDefaults: APPROVED_DEFAULTS,
      behaviors: behaviorRegistry(),
    });
    const installed = await recoveredFactory.installCityPackage(fixture.input);
    expect(installed.catalog.id).toBe(fixture.input.catalogProjection.catalog.id);
    expect(tableCount(database, "city_catalog_revisions")).toBe(1);
    expect(tableCount(database, "evidence_snapshots")).toBe(1);
    expect(tableCount(database, "artifacts")).toBe(7);
    expect(tableCount(database, "installed_city_package_manifests")).toBe(1);
    expect(tableCount(database, "installed_city_package_heads")).toBe(1);
  });

  test("lets structural evaluator and fixed-policy drift reach Task 4 after Catalog/Evidence", async () => {
    // Break caught: Application importing compiled behavior merely to reject structural IDs early.
    const mutations: Array<(input: InstallCityPackageInput) => void> = [
      (input) => {
        (input.criterionDefinitions[3] as unknown as { evaluatorVersion: string }).evaluatorVersion =
          "compiled-unapproved@99";
      },
      (input) => {
        (input.fixedPlansByCityId[CITY_ID]![0].claimContract as unknown as {
          valuePolicyVersion: string;
        }).valuePolicyVersion = "compiled-unapproved-policy@99";
      },
    ];
    for (const mutate of mutations) {
      const database = memoryDatabase();
      const fixture = installationFixture("a", "2026-02-01T00:00:00.000Z");
      const input = clone(fixture.input);
      mutate(input);
      const composition = createCityPackageInstallationComposition({
        database,
        hmacKey: INTEGRITY_KEY,
        resolveAvailability: () => clone(fixture.ready),
        approvedDefaults: APPROVED_DEFAULTS,
        behaviors: behaviorRegistry(),
      });
      await expect(composition.installCityPackage(input)).rejects.toThrow("integrity_mismatch");
      expect(tableCount(database, "city_catalog_revisions")).toBe(1);
      expect(tableCount(database, "evidence_snapshots")).toBe(1);
      expect(tableCount(database, "installed_city_package_manifests")).toBe(0);
      expect(tableCount(database, "installed_city_package_heads")).toBe(0);
    }
  });

  test("preserves a successful manifest/head when exact lookup throws and retry recovers", async () => {
    // Break caught: compensating a completed manifest or leaking lookup behavior-unavailable.
    const database = memoryDatabase();
    const fixture = installationFixture("a", "2026-02-01T00:00:00.000Z");
    const manifests = new SqliteCityPackageManifestStore(
      database,
      INTEGRITY,
      APPROVED_DEFAULTS,
      behaviorRegistry(),
    );
    const basePorts = {
      resolveAvailability: () => clone(fixture.ready),
      catalog: new SqliteCityCatalogStore(database, INTEGRITY),
      administrativeEvidence: new SqliteAdministrativeEvidenceStore(database, INTEGRITY),
      manifests,
      approvedDefaults: APPROVED_DEFAULTS,
      integrity: INTEGRITY,
    };
    const thrown = new Error("city_package_behavior_unavailable");
    const failingPorts: InstallCityPackagePorts = {
      ...basePorts,
      installedPackages: {
        findReady: () => undefined,
        findExact: () => { throw thrown; },
      },
    };
    const error = await rejectionOf(installCityPackage(fixture.input, failingPorts));
    expect((error as Error).message).toBe("integrity_mismatch");
    expect(error).not.toBe(thrown);
    expect(tableCount(database, "installed_city_package_manifests")).toBe(1);
    expect(tableCount(database, "installed_city_package_heads")).toBe(1);
    const beforeRetryRows = tableCount(database, "installed_city_package_manifests");

    const recovered = await installCityPackage(fixture.input, {
      ...basePorts,
      installedPackages: new InstalledCityPackages(manifests),
    });
    expect(recovered.catalog.id).toBe(fixture.input.catalogProjection.catalog.id);
    expect(tableCount(database, "installed_city_package_manifests")).toBe(beforeRetryRows);
    expect(tableCount(database, "installed_city_package_heads")).toBe(1);
  });
});
