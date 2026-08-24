import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";

import type Database from "better-sqlite3";
import { afterEach, describe, expect, expectTypeOf, test } from "vitest";

import type {
  InstalledCityPackageManifestAppendInput,
  InstalledCityPackageManifestAppendPort,
  InstalledCityPackageManifestStorePort,
} from "../../src/application/city-data-contracts";
import { sealCityPackageAdministrativeEvidence } from "../../src/application/seal-administrative-evidence";
import type { ApprovedCityCriteriaDefaultsRegistry } from "../../src/decision/approved-city-criteria-defaults";
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
  INSTALLED_CITY_PACKAGE_BEHAVIOR_REGISTRY,
  InstalledCityPackages,
  resolveInstalledCityPackageBehaviorForDefinition,
  resolveInstalledCityPackageBehaviorForVersion,
  type InstalledCityPackageBehaviorRegistry,
  type VerifiedInstalledCityPackageReadPort,
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
import {
  buildInstalledPackageArtifactSetClaim,
  type CityPackageAdministrativeEvidenceClaim,
  type InstalledCityPackageArtifactSlot,
  type InstalledCityPackageJsonArtifactRole,
  type SealedCityPackageAdministrativeEvidence,
} from "../../src/research/city-package-artifact-set";
import type { CityResearchPackageReadyCandidate } from "../../src/research/city-package";
import {
  buildCitySafetySourcePlan,
  buildOfficialAuthorityDirectory,
} from "../../src/research/city-safety-source-plan";
import {
  sealEvidencePlan,
  type EvidenceIntegrity,
} from "../../src/research/research-plan";
import { SLOVENIA_CITY_FACT_VERSIONS } from "../../src/research/slovenia-city-plan";

const INTEGRITY_KEY = "task-4-installed-city-package-key-at-least-32-bytes";
const INTEGRITY = createEvidenceIntegrity(INTEGRITY_KEY);
const CITY_ID = "ljubljana";
const FIXED_SOURCE_IDS = [
  "si-city-long-term-rent",
  "si-city-urban-transit",
  "si-city-fixed-broadband",
] as const;
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
  const directory = mkdtempSync(join(tmpdir(), "city-package-manifest-"));
  temporaryDirectories.push(directory);
  return join(directory, "city.sqlite");
}

function fixedPlan<S extends SloveniaCityFixedSourceId>(
  sourceId: S,
  suffix: string,
): CityFixedSourcePlan<S> {
  const criterionId = sourceId === "si-city-long-term-rent"
    ? "long_term_rent"
    : sourceId === "si-city-urban-transit" ? "urban_transit" : "fixed_broadband";
  const definitionId = `${criterionId}-definition@1`;
  return {
    planId: `${CITY_ID}:${sourceId}:plan-${suffix}@1`,
    sourceId,
    cityId: CITY_ID,
    criterionId,
    definitionId,
    claimContract: {
      sourceId,
      criterionId,
      definitionId,
      scope: `municipality:${CITY_ID}`,
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
const APPROVED_FOR = {
  countryCode: "SI",
  packageId: "si-cities",
  packageSchemaVersion: "si-cities@1",
  evidenceRulesVersion: "si-city-evidence@1",
} as const;
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
const VERSION_KEY = {
  evaluatorRegistryVersionId: "synthetic-evaluator-registry@1",
  evaluatorVersionIds: Object.fromEntries(CITY_CRITERION_IDS.map((criterionId) => [
    criterionId,
    EVALUATORS[criterionId].definition.evaluatorVersion,
  ])) as Readonly<Record<(typeof CITY_CRITERION_IDS)[number], string>>,
  valueValidatorVersionId: "synthetic-value-validator@1",
  sourcePeriodValidatorVersionId: "synthetic-period-validator@1",
};

function behaviorRegistry(): InstalledCityPackageBehaviorRegistry {
  return {
    schemaVersion: "installed-city-package-behavior-registry@1",
    entries: [{
      approvedFor: APPROVED_FOR,
      versionKey: {
        ...VERSION_KEY,
        evaluatorVersionIds: { ...VERSION_KEY.evaluatorVersionIds },
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
  database: Database.Database,
  suffix: string,
  installedAt: string,
  catalogRulesVersion: "city-catalog@1" | "city-catalog@2" = "city-catalog@2",
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
    }],
    createdAt: `2026-01-${suffix === "a" ? "01" : suffix === "b" ? "02" : "03"}T00:00:00.000Z`,
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
        value: suffix === "a" ? "300000" : suffix === "b" ? "300001" : "300002",
        referencePeriod: "2026-01-01",
      },
    }],
    coverage: { status: "complete" },
    createdAt: `2026-01-${suffix === "a" ? "01" : suffix === "b" ? "02" : "03"}T00:00:00.000Z`,
  }, INTEGRITY);
  let catalogBundle: CityCatalogProjection;
  if (catalogRulesVersion === "city-catalog@2") {
    catalogBundle = new SqliteCityCatalogStore(database, INTEGRITY)
      .appendVerified({ registry, catalog });
  } else {
    const { id: currentId, ...legacyPayload } = structuredClone(catalog);
    if (currentId !== catalog.id) throw new Error("invalid_legacy_catalog_fixture");
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
    catalogBundle = { registry, catalog: legacyCatalog };
    const canonicalBundle = INTEGRITY.canonical(catalogBundle);
    database.prepare(`
      INSERT INTO city_catalog_revisions (
        id, registry_revision_id, country_code, package_id, package_schema_version,
        registry_evidence_snapshot_id, catalog_evidence_snapshot_id, rules_version,
        created_at, payload_json, payload_hash, hmac
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      legacyCatalog.id, registry.id, legacyCatalog.countryCode, legacyCatalog.packageId,
      legacyCatalog.packageSchemaVersion, registry.evidenceSnapshotId,
      legacyCatalog.evidenceSnapshotId, legacyCatalog.rulesVersion, legacyCatalog.createdAt,
      canonicalBundle, INTEGRITY.hash(canonicalBundle), INTEGRITY.sign(canonicalBundle),
    );
  }
  const officialAuthorityDirectory = buildOfficialAuthorityDirectory({
    schemaVersion: "official-authority-directory@1",
    countryCode: "SI",
    catalogRevisionId: catalogBundle.catalog.id,
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
  }, INTEGRITY);
  const safetySourcePlan = buildCitySafetySourcePlan({
    catalog: catalogBundle.catalog,
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
  }, INTEGRITY);
  const fixedPlans = [
    fixedPlan("si-city-long-term-rent", suffix),
    fixedPlan("si-city-urban-transit", suffix),
    fixedPlan("si-city-fixed-broadband", suffix),
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
  const key = {
    countryCode: ready.definition.countryCode,
    packageId: ready.definition.packageId,
    packageSchemaVersion: ready.definition.packageSchemaVersion,
    catalogRevisionId: catalogBundle.catalog.id,
    evidenceRulesVersion: ready.definition.evidenceRulesVersion,
  };
  const administrativeEvidence = await sealCityPackageAdministrativeEvidence({
    key,
    installedAt,
    catalogMemberIds: [CITY_ID],
    fixedPlansByCityId: { [CITY_ID]: fixedPlans },
    safetySourcePlan,
    officialAuthorityDirectory,
    criteriaDefaults: DEFAULTS,
    criterionDefinitions: DEFINITIONS,
  }, {
    store: new SqliteAdministrativeEvidenceStore(database, INTEGRITY),
    integrity: INTEGRITY,
  });
  return {
    ready,
    catalog: catalogBundle,
    administrativeEvidence,
    fixedPlansByCityId: { [CITY_ID]: fixedPlans },
    safetySourcePlan,
    officialAuthorityDirectory,
    criteriaDefaults: DEFAULTS,
    criterionDefinitions: DEFINITIONS,
    installedAt,
  };
}

async function withRawJsonArtifact(
  database: Database.Database,
  borrowed: InstalledCityPackageManifestAppendInput,
  ordinal: number,
  rawBytes: Uint8Array,
): Promise<InstalledCityPackageManifestAppendInput> {
  const input = structuredClone(borrowed);
  const encoder = new TextEncoder();
  const ordered = [
    ...Object.keys(input.fixedPlansByCityId).sort().flatMap((cityId) =>
      input.fixedPlansByCityId[cityId]!.map((value, sourceIndex) => ({
        slot: {
          kind: "fixed_plan" as const,
          cityId,
          sourceId: FIXED_SOURCE_IDS[sourceIndex]!,
        } satisfies InstalledCityPackageArtifactSlot,
        role: "installed_city_fixed_source_plan" as const,
        value,
      }))),
    {
      slot: { kind: "safety_source_plan" } as const,
      role: "installed_city_safety_source_plan" as const,
      value: input.safetySourcePlan,
    },
    {
      slot: { kind: "official_authority_directory" } as const,
      role: "installed_city_official_authority_directory" as const,
      value: input.officialAuthorityDirectory,
    },
    {
      slot: { kind: "criteria_defaults" } as const,
      role: "installed_city_criteria_defaults" as const,
      value: input.criteriaDefaults,
    },
    {
      slot: { kind: "criterion_definitions" } as const,
      role: "installed_city_criterion_definitions" as const,
      value: input.criterionDefinitions,
    },
  ] satisfies readonly {
    readonly slot: InstalledCityPackageArtifactSlot;
    readonly role: InstalledCityPackageJsonArtifactRole;
    readonly value: unknown;
  }[];
  const materials = ordered.map((item, index) => {
    const bytes = index === ordinal
      ? new Uint8Array(rawBytes)
      : encoder.encode(INTEGRITY.canonical(item.value));
    return {
      ...item,
      bytes,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
  });
  const built = buildInstalledPackageArtifactSetClaim({
    key: {
      countryCode: input.ready.definition.countryCode,
      packageId: input.ready.definition.packageId,
      packageSchemaVersion: input.ready.definition.packageSchemaVersion,
      catalogRevisionId: input.catalog.catalog.id,
      evidenceRulesVersion: input.ready.definition.evidenceRulesVersion,
    },
    installedAt: input.installedAt,
    orderedMaterials: materials.map((material, artifactOrdinal) => ({
      artifactOrdinal,
      slot: material.slot,
      role: material.role,
      sha256: material.sha256,
    })),
  }, INTEGRITY);
  const artifacts = built.orderedArtifacts.map((material) => ({
    artifactId: material.artifactId,
    runId: built.installRunId,
    sourceId: "city-package-installation" as const,
    role: material.role,
    mediaType: "application/json" as const,
    sha256: material.sha256,
    bytes: new Uint8Array(materials[material.artifactOrdinal]!.bytes),
    origin: "administrative" as const,
    producer: "install-city-package@1",
    createdAt: input.installedAt,
  }));
  const sealed = await sealEvidencePlan<
    "city-package-installation",
    CityPackageAdministrativeEvidenceClaim,
    "administrative"
  >({
    id: built.evidenceId,
    assessmentDate: input.installedAt.slice(0, 10),
    entries: [{
      sourceId: "city-package-installation",
      origin: "administrative",
      artifacts,
      coverage: "verified",
      claims: [built.claim],
    }],
    sourceIds: ["city-package-installation"],
    parserVersions: { "city-package-installation": "city-package-administrative-json@1" },
    rulesVersion: "city-package-administrative-evidence@1",
  }, INTEGRITY);
  const evidenceStore = new SqliteAdministrativeEvidenceStore(database, INTEGRITY);
  for (const artifact of artifacts) await evidenceStore.appendArtifact(artifact);
  await evidenceStore.seal(sealed);
  const administrativeEvidence: SealedCityPackageAdministrativeEvidence = {
    installRunId: built.installRunId,
    evidenceId: built.evidenceId,
    evidence: sealed,
    artifacts,
    bindings: built.orderedArtifacts.map((artifact) => ({
      evidenceSnapshotId: built.evidenceId,
      artifactId: artifact.artifactId,
      artifactOrdinal: artifact.artifactOrdinal,
      runId: built.installRunId,
      sourceId: "city-package-installation",
      role: artifact.role,
      mediaType: "application/json",
      sha256: artifact.sha256,
    })),
  };
  return { ...input, administrativeEvidence };
}

function store(database: Database.Database) {
  return new SqliteCityPackageManifestStore(
    database,
    INTEGRITY,
    APPROVED_DEFAULTS,
    behaviorRegistry(),
  );
}

function count(database: Database.Database, table: string): number {
  return database.prepare(`SELECT COUNT(*) FROM ${table}`).pluck().get() as number;
}

function totalChanges(database: Database.Database): number {
  return database.prepare("SELECT total_changes()").pluck().get() as number;
}

interface MutableManifestPayloadFixture {
  fixedPlansByCityId: Record<string, Array<{
    cityId: string;
    planId: string;
    planArtifact: { artifactId: string; artifactOrdinal: number };
  }>>;
  safety: {
    sourcePlanArtifact: { artifactOrdinal: number };
    authorityDirectoryArtifact: { artifactOrdinal: number };
  };
  criteria: {
    defaultsArtifact: { artifactOrdinal: number };
    definitionsArtifact: { artifactOrdinal: number };
  };
}

function rewriteSignedManifestPayload(
  database: Database.Database,
  manifestId: string,
  mutate: (payload: MutableManifestPayloadFixture) => void,
): void {
  const payload = JSON.parse(database.prepare(`
    SELECT payload_json FROM installed_city_package_manifests WHERE id = ?
  `).pluck().get(manifestId) as string) as MutableManifestPayloadFixture;
  mutate(payload);
  const canonical = INTEGRITY.canonical(payload);
  const payloadHash = INTEGRITY.hash(canonical);
  const rewrittenId = `installed-city-package-manifest:${payloadHash}`;
  database.pragma("foreign_keys = OFF");
  database.exec("DROP TRIGGER installed_city_package_manifests_no_update");
  database.prepare(`
    UPDATE installed_city_package_manifests
    SET id = ?, payload_json = ?, payload_hash = ?, hmac = ?
    WHERE id = ?
  `).run(rewrittenId, canonical, payloadHash, INTEGRITY.sign(canonical), manifestId);
  database.prepare(`
    UPDATE installed_city_package_heads SET current_manifest_id = ?
    WHERE current_manifest_id = ?
  `).run(rewrittenId, manifestId);
}

function appendInWorker(
  databasePath: string,
  input: InstalledCityPackageManifestAppendInput,
  gate: SharedArrayBuffer,
): Promise<{ readonly ok: true; readonly manifestId: string } | {
  readonly ok: false;
  readonly message: string;
}> {
  const workerPath = `${databasePath}.${randomUUID()}.worker.ts`;
  const storeUrl = pathToFileURL(join(
    process.cwd(), "src/infrastructure/sqlite/city-package-manifest-store.ts",
  )).href;
  const databaseUrl = pathToFileURL(join(
    process.cwd(), "src/infrastructure/sqlite/db.ts",
  )).href;
  const integrityUrl = pathToFileURL(join(
    process.cwd(), "src/infrastructure/integrity.ts",
  )).href;
  writeFileSync(workerPath, `
    import { parentPort, workerData } from "node:worker_threads";
    import { SqliteCityPackageManifestStore } from ${JSON.stringify(storeUrl)};
    import { openEvidenceDatabase } from ${JSON.stringify(databaseUrl)};
    import { createEvidenceIntegrity } from ${JSON.stringify(integrityUrl)};
    const input = workerData.input;
    const evaluatorRegistry = Object.fromEntries(input.criterionDefinitions.map((definition) => [
      definition.criterionId,
      {
        definition,
        canonicalizeTarget(target) {
          if (typeof target !== "string") throw new Error("invalid_target");
          return target;
        },
        evaluate() {
          return { state: "verified", factor: "1", targetComparison: "matches" };
        },
      },
    ]));
    const behaviors = {
      schemaVersion: "installed-city-package-behavior-registry@1",
      entries: [{
        approvedFor: workerData.approvedFor,
        versionKey: workerData.versionKey,
        fixedPolicyVersionsBySourceId: workerData.fixedPolicyVersionsBySourceId,
        evaluatorRegistry,
        validateValue(value) { return value.value; },
        validateSourcePeriod() { return "fresh"; },
      }],
    };
    const database = openEvidenceDatabase(workerData.databasePath);
    try {
      const manifests = new SqliteCityPackageManifestStore(
        database,
        createEvidenceIntegrity(workerData.integrityKey),
        workerData.approvedDefaults,
        behaviors,
      );
      const gate = new Int32Array(workerData.gate);
      Atomics.add(gate, 0, 1);
      Atomics.notify(gate, 0);
      Atomics.wait(gate, 1, 0);
      const manifest = manifests.appendPrepared(input);
      parentPort.postMessage({ ok: true, manifestId: manifest.id });
    } catch (error) {
      parentPort.postMessage({
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      database.close();
    }
  `);
  const entry = behaviorRegistry().entries[0]!;
  return new Promise((resolve, reject) => {
    const worker = new Worker(workerPath, {
      execArgv: ["--import", "tsx"],
      workerData: {
        databasePath,
        input: structuredClone(input),
        integrityKey: INTEGRITY_KEY,
        approvedDefaults: structuredClone(APPROVED_DEFAULTS),
        approvedFor: structuredClone(entry.approvedFor),
        versionKey: structuredClone(entry.versionKey),
        fixedPolicyVersionsBySourceId: structuredClone(entry.fixedPolicyVersionsBySourceId),
        gate,
      },
    });
    worker.once("message", resolve);
    worker.once("error", reject);
  });
}

async function releaseWorkersTogether(gate: SharedArrayBuffer): Promise<void> {
  const state = new Int32Array(gate);
  const deadline = Date.now() + 20_000;
  while (Atomics.load(state, 0) !== 2) {
    if (Date.now() >= deadline) throw new Error("worker_gate_timeout");
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  Atomics.store(state, 1, 1);
  Atomics.notify(state, 1, 2);
}

describe("installed city package behavior registry", () => {
  test("is exact-closed, resolves one definition and exact version, and stays empty in production", () => {
    // Break caught: serialized/version-fallback behavior or a fabricated production Slovenia entry.
    const registry = behaviorRegistry();
    const byDefinition = resolveInstalledCityPackageBehaviorForDefinition(APPROVED_FOR, registry);
    const byVersion = resolveInstalledCityPackageBehaviorForVersion(APPROVED_FOR, VERSION_KEY, registry);

    expect({
      approvedFor: byDefinition.approvedFor,
      versionKey: byDefinition.versionKey,
      fixedPolicyVersionsBySourceId: byDefinition.fixedPolicyVersionsBySourceId,
    }).toEqual({
      approvedFor: byVersion.approvedFor,
      versionKey: byVersion.versionKey,
      fixedPolicyVersionsBySourceId: byVersion.fixedPolicyVersionsBySourceId,
    });
    expect(byDefinition.validateValue).not.toBe(byVersion.validateValue);
    expect(byDefinition.validateValue({
      sourceId: "si-city-long-term-rent",
      criterionId: "long_term_rent",
      definitionId: "long_term_rent-definition@1",
      policyVersion: "canonical-scalar@1",
      value: "12",
      unit: "canonical-unit",
      denominator: "canonical-denominator",
    })).toBe("12");
    expect(INSTALLED_CITY_PACKAGE_BEHAVIOR_REGISTRY).toEqual({
      schemaVersion: "installed-city-package-behavior-registry@1",
      entries: [],
    });
    expect(Object.isFrozen(INSTALLED_CITY_PACKAGE_BEHAVIOR_REGISTRY)).toBe(true);
    expect(Object.isFrozen(INSTALLED_CITY_PACKAGE_BEHAVIOR_REGISTRY.entries)).toBe(true);

    const ambiguous = { ...registry, entries: [...registry.entries, registry.entries[0]!] };
    expect(() => resolveInstalledCityPackageBehaviorForDefinition(APPROVED_FOR, ambiguous))
      .toThrow("city_package_behavior_unavailable");
    const entry = registry.entries[0]!;
    const malformed = {
      ...registry,
      entries: [{
        ...entry,
        versionKey: {
          ...entry.versionKey,
          evaluatorVersionIds: { ...entry.versionKey.evaluatorVersionIds, extra: "extra@1" },
        },
      }],
    } as unknown as InstalledCityPackageBehaviorRegistry;
    expect(() => resolveInstalledCityPackageBehaviorForDefinition(APPROVED_FOR, malformed))
      .toThrow("integrity_mismatch");
    expect(() => resolveInstalledCityPackageBehaviorForVersion(
      APPROVED_FOR,
      { ...VERSION_KEY, valueValidatorVersionId: "newer@1" },
      registry,
    )).toThrow("city_package_behavior_unavailable");
  });

  test("rejects hostile descriptors and owns every compiled capability before selection", () => {
    // Break caught: a late getter, proxy, or mutable function field changes selected executable code.
    let getterCalls = 0;
    const accessor = Object.defineProperty({}, "schemaVersion", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return "installed-city-package-behavior-registry@1";
      },
    }) as InstalledCityPackageBehaviorRegistry;
    expect(() => resolveInstalledCityPackageBehaviorForDefinition(APPROVED_FOR, accessor))
      .toThrow("integrity_mismatch");
    expect(getterCalls).toBe(0);
    expect(() => resolveInstalledCityPackageBehaviorForDefinition(
      APPROVED_FOR,
      new Proxy(behaviorRegistry(), {}) as InstalledCityPackageBehaviorRegistry,
    )).toThrow("integrity_mismatch");

    const indexedAccessor = behaviorRegistry();
    const indexedEntry = indexedAccessor.entries[0]!;
    let indexedGetterCalls = 0;
    Object.defineProperty(indexedAccessor.entries, "0", {
      configurable: true,
      enumerable: true,
      get() {
        indexedGetterCalls += 1;
        return indexedEntry;
      },
    });
    expect(() => resolveInstalledCityPackageBehaviorForDefinition(APPROVED_FOR, indexedAccessor))
      .toThrow("integrity_mismatch");
    expect(indexedGetterCalls).toBe(0);

    const constructorAccessor = behaviorRegistry();
    const constructorEntry = constructorAccessor.entries[0]!;
    let constructorGetterCalls = 0;
    Object.defineProperty(constructorAccessor.entries, "0", {
      configurable: true,
      enumerable: true,
      get() {
        constructorGetterCalls += 1;
        return constructorEntry;
      },
    });
    expect(() => new SqliteCityPackageManifestStore(
      memoryDatabase(), INTEGRITY, APPROVED_DEFAULTS, constructorAccessor,
    )).toThrow("integrity_mismatch");
    expect(constructorGetterCalls).toBe(0);

    const registry = behaviorRegistry();
    const selected = resolveInstalledCityPackageBehaviorForDefinition(APPROVED_FOR, registry);
    const originalValidator = selected.validateValue;
    (registry.entries[0] as { validateValue: CityFixedValueValidator }).validateValue = () => "evil";
    (registry.entries[0]!.versionKey.evaluatorVersionIds as Record<string, string>).safety =
      "evil@1";
    expect(originalValidator({
      sourceId: "si-city-long-term-rent",
      criterionId: "long_term_rent",
      definitionId: "long_term_rent-definition@1",
      policyVersion: "canonical-scalar@1",
      value: "12",
      unit: "canonical-unit",
      denominator: "canonical-denominator",
    })).toBe("12");
    expect(Object.isFrozen(selected)).toBe(true);

    const missingVersion = behaviorRegistry();
    delete (missingVersion.entries[0]!.versionKey.evaluatorVersionIds as Record<string, string>)
      .safety;
    expect(() => resolveInstalledCityPackageBehaviorForDefinition(APPROVED_FOR, missingVersion))
      .toThrow("integrity_mismatch");

    const sparse = behaviorRegistry();
    (sparse.entries as unknown as unknown[]).length = 2;
    expect(() => resolveInstalledCityPackageBehaviorForDefinition(APPROVED_FOR, sparse))
      .toThrow("integrity_mismatch");
    const symbolic = behaviorRegistry();
    Object.defineProperty(symbolic.entries[0]!, Symbol("extra"), { value: true });
    expect(() => resolveInstalledCityPackageBehaviorForDefinition(APPROVED_FOR, symbolic))
      .toThrow("integrity_mismatch");
    const symbolicEntries = behaviorRegistry();
    Object.defineProperty(symbolicEntries.entries, Symbol("extra"), { value: true });
    expect(() => resolveInstalledCityPackageBehaviorForDefinition(APPROVED_FOR, symbolicEntries))
      .toThrow("integrity_mismatch");
    const extraCapability = behaviorRegistry();
    Object.assign(extraCapability.entries[0]!, { normalize: () => "evil" });
    expect(() => resolveInstalledCityPackageBehaviorForDefinition(APPROVED_FOR, extraCapability))
      .toThrow("integrity_mismatch");
    const extraFixedPolicy = behaviorRegistry();
    Object.assign(extraFixedPolicy.entries[0]!.fixedPolicyVersionsBySourceId, {
      extra: {
        valuePolicyVersion: "extra@1",
        sourcePeriodPolicyVersion: "extra@1",
      },
    });
    expect(() => resolveInstalledCityPackageBehaviorForDefinition(APPROVED_FOR, extraFixedPolicy))
      .toThrow("integrity_mismatch");
    expect(() => resolveInstalledCityPackageBehaviorForDefinition(
      { ...APPROVED_FOR, countryCode: "si" }, behaviorRegistry(),
    )).toThrow("integrity_mismatch");
    expect(() => resolveInstalledCityPackageBehaviorForVersion(
      APPROVED_FOR,
      { ...VERSION_KEY, evaluatorVersionIds: {
        ...VERSION_KEY.evaluatorVersionIds,
        extra: "extra@1",
      } } as typeof VERSION_KEY,
      behaviorRegistry(),
    )).toThrow("integrity_mismatch");
  });

  test("wraps receiver-sensitive evaluator and validator functions with minimal owned receivers", () => {
    // Break caught: a captured function observes the borrowed registry entry through `this`.
    const registry = behaviorRegistry();
    const validatorReceivers: unknown[] = [];
    const evaluatorReceivers: unknown[] = [];
    (registry.entries[0] as { validateValue: CityFixedValueValidator }).validateValue =
      function receiverSensitive(value) {
        validatorReceivers.push(this);
        return value.value;
      };
    const evaluators = registry.entries[0]!.evaluatorRegistry;
    (evaluators.safety as { canonicalizeTarget: (target: unknown) => string })
      .canonicalizeTarget = function receiverSensitive(target) {
        evaluatorReceivers.push(this);
        return String(target);
      };
    const selected = resolveInstalledCityPackageBehaviorForDefinition(APPROVED_FOR, registry);
    expect(selected.validateValue({
      sourceId: "si-city-long-term-rent",
      criterionId: "long_term_rent",
      definitionId: "long_term_rent-definition@1",
      policyVersion: "canonical-scalar@1",
      value: "12",
      unit: "canonical-unit",
      denominator: "canonical-denominator",
    })).toBe("12");
    expect(selected.evaluatorRegistry.safety.canonicalizeTarget("1")).toBe("1");
    expect(Object.keys(validatorReceivers[0] as object)).toEqual(["capability"]);
    expect(Object.keys(evaluatorReceivers[0] as object)).toEqual(["criterionId"]);
    expect(validatorReceivers[0]).not.toBe(registry.entries[0]);
    expect(evaluatorReceivers[0]).not.toBe(evaluators.safety);
  });

  test("rejects a semantically malformed evaluator definition in an unmatched entry", () => {
    // Break caught: selection validates only the matching entry and masks malformed registry data.
    for (const [label, mutate] of [
      ["definitionId", (definition: Record<string, unknown>) => { definition.definitionId = ""; }],
      ["direction", (definition: Record<string, unknown>) => { definition.direction = "sideways"; }],
      ["unit", (definition: Record<string, unknown>) => { definition.unit = ""; }],
      ["denominator", (definition: Record<string, unknown>) => { definition.denominator = ""; }],
      ["geo scopes", (definition: Record<string, unknown>) => {
        definition.compatibleGeoScopes = [];
      }],
      ["freshness", (definition: Record<string, unknown>) => {
        definition.freshnessPolicyVersion = "";
      }],
    ] as const) {
      const registry = behaviorRegistry();
      const unmatchedRegistry = behaviorRegistry();
      const unmatched = unmatchedRegistry.entries[0]!;
      (unmatched as { approvedFor: typeof unmatched.approvedFor }).approvedFor = {
        ...unmatched.approvedFor,
        countryCode: "ZZ",
      };
      mutate(unmatched.evaluatorRegistry.safety.definition as unknown as Record<string, unknown>);
      (registry.entries as InstalledCityPackageBehaviorRegistry["entries"][number][]).push(unmatched);
      expect(() => resolveInstalledCityPackageBehaviorForDefinition(APPROVED_FOR, registry), label)
        .toThrow("integrity_mismatch");
    }
  });
});

describe("InstalledCityPackages", () => {
  test("rejects malformed lookup selectors before invoking the rich-read capability", () => {
    // Break caught: malformed keys/countries are normalized or forwarded to a trusted collaborator.
    let calls = 0;
    const port: VerifiedInstalledCityPackageReadPort = {
      loadExactVerified: () => {
        calls += 1;
        return undefined;
      },
      loadCurrentVerified: () => {
        calls += 1;
        return undefined;
      },
    };
    const installed = new InstalledCityPackages(port);
    const malformed = {
      countryCode: "si",
      packageId: "si-cities",
      packageSchemaVersion: "si-cities@1",
      catalogRevisionId: "catalog-a",
      evidenceRulesVersion: "si-city-evidence@1",
    };
    expect(() => installed.findExact(malformed)).toThrow("integrity_mismatch");
    expect(() => installed.loadExactReplayContract(malformed)).toThrow("integrity_mismatch");
    expect(() => installed.findReady("si")).toThrow("integrity_mismatch");
    expect(() => installed.latestInstalledVerified("si")).toThrow("integrity_mismatch");
    expect(calls).toBe(0);
  });

  test("rejects proxy rich-read collaborators without firing reflection traps", () => {
    // Break caught: capability capture invokes proxy traps before the first intended rich read.
    const port: VerifiedInstalledCityPackageReadPort = {
      loadExactVerified: () => undefined,
      loadCurrentVerified: () => undefined,
    };
    let trapCalls = 0;
    const proxy = new Proxy(port, {
      getOwnPropertyDescriptor(target, key) {
        trapCalls += 1;
        return Reflect.getOwnPropertyDescriptor(target, key);
      },
      getPrototypeOf(target) {
        trapCalls += 1;
        return Reflect.getPrototypeOf(target);
      },
    });
    expect(() => new InstalledCityPackages(proxy)).toThrow("integrity_mismatch");
    expect(trapCalls).toBe(0);
  });

  test("does not inherit a missing rich-read capability from Object.prototype", () => {
    // Break caught: prototype pollution supplies authority the collaborator never owned.
    const inherited = Object.getOwnPropertyDescriptor(Object.prototype, "loadExactVerified");
    Object.defineProperty(Object.prototype, "loadExactVerified", {
      configurable: true,
      value: () => undefined,
    });
    try {
      const incomplete = {
        loadCurrentVerified: () => undefined,
      } as unknown as VerifiedInstalledCityPackageReadPort;
      expect(() => new InstalledCityPackages(incomplete)).toThrow("integrity_mismatch");
    } finally {
      if (inherited === undefined) {
        delete (Object.prototype as { loadExactVerified?: unknown }).loadExactVerified;
      } else {
        Object.defineProperty(Object.prototype, "loadExactVerified", inherited);
      }
    }
  });
});

describe("SqliteCityPackageManifestStore", () => {
  test("owns append inheritance and the exact four-argument constructor at compile time", () => {
    // Break caught: Task 5 must not redeclare append and SQLite must own same-DB dependencies.
    expectTypeOf<InstalledCityPackageManifestStorePort>()
      .toMatchTypeOf<InstalledCityPackageManifestAppendPort>();
    expectTypeOf<InstalledCityPackageManifestAppendPort["appendPrepared"]>()
      .toEqualTypeOf<InstalledCityPackageManifestStorePort["appendPrepared"]>();
    expectTypeOf<ConstructorParameters<typeof SqliteCityPackageManifestStore>>()
      .toEqualTypeOf<[
        Database.Database,
        EvidenceIntegrity,
        ApprovedCityCriteriaDefaultsRegistry,
        InstalledCityPackageBehaviorRegistry,
      ]>();
  });

  test("owns defaults, behavior, and rich-read capabilities at construction", async () => {
    // Break caught: later mutation of a borrowed registry or collaborator redirects trusted reads.
    const database = memoryDatabase();
    const input = await preparedInput(database, "a", "2026-08-24T10:00:00.000Z");
    const defaults = structuredClone(APPROVED_DEFAULTS);
    const behaviors = behaviorRegistry();
    const manifests = new SqliteCityPackageManifestStore(database, INTEGRITY, defaults, behaviors);
    delete (defaults.byMappingVersion as Record<string, unknown>)[DEFAULTS.mappingVersion];
    (behaviors.entries[0] as { validateValue: CityFixedValueValidator }).validateValue = () => {
      throw new Error("borrowed_behavior_used");
    };
    const manifest = manifests.appendPrepared(input);

    const installed = new InstalledCityPackages(manifests);
    (manifests as unknown as { loadCurrentVerified: () => never }).loadCurrentVerified = () => {
      throw new Error("redirected_read");
    };
    (manifests as unknown as { loadExactVerified: () => never }).loadExactVerified = () => {
      throw new Error("redirected_read");
    };
    expect(installed.findReady("SI")?.installedPackageManifest.id).toBe(manifest.id);
    expect(installed.findExact(manifest.key)?.installedPackageManifest.id).toBe(manifest.id);
  });

  test("owns hostile rich records without freezing, retaining, or invoking borrowed accessors", async () => {
    // Break caught: InstalledCityPackages freezes/retains a collaborator record or reads accessors.
    const database = memoryDatabase();
    const manifests = store(database);
    const input = await preparedInput(database, "a", "2026-08-24T10:00:00.000Z");
    manifests.appendPrepared(input);
    const verified = manifests.loadCurrentVerified("SI")!;
    const mutable = {
      manifest: structuredClone(verified.manifest),
      ready: structuredClone(verified.ready),
      catalog: structuredClone(verified.catalog),
      fixedPlansByCityId: structuredClone(verified.fixedPlansByCityId),
      safetySourcePlan: structuredClone(verified.safetySourcePlan),
      officialAuthorityDirectory: structuredClone(verified.officialAuthorityDirectory),
      criteriaDefaults: structuredClone(verified.criteriaDefaults),
      criterionDefinitions: structuredClone(verified.criterionDefinitions),
      evaluatorRegistry: evaluatorRegistry(),
      validateValue,
      validateSourcePeriod,
    };
    const port: VerifiedInstalledCityPackageReadPort = {
      loadExactVerified: () => mutable,
      loadCurrentVerified: () => mutable,
    };
    const installed = new InstalledCityPackages(port);
    const first = installed.findReady("SI")!;
    const second = installed.findReady("SI")!;
    expect(first).not.toBe(second);
    expect(first.catalog).not.toBe(mutable.catalog.catalog);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(mutable)).toBe(false);
    expect(Object.isFrozen(mutable.evaluatorRegistry)).toBe(false);
    expect(Object.isFrozen(mutable.catalog)).toBe(false);

    let rootGetterCalls = 0;
    const hostileRoot = { ...mutable };
    Object.defineProperty(hostileRoot, "manifest", {
      enumerable: true,
      get() {
        rootGetterCalls += 1;
        return mutable.manifest;
      },
    });
    const hostileRootInstalled = new InstalledCityPackages({
      loadExactVerified: () => hostileRoot,
      loadCurrentVerified: () => hostileRoot,
    });
    expect(() => hostileRootInstalled.findReady("SI")).toThrow("integrity_mismatch");
    expect(rootGetterCalls).toBe(0);

    let nestedGetterCalls = 0;
    const hostileNested = { ...mutable, ready: structuredClone(mutable.ready) };
    Object.defineProperty(hostileNested.ready.definition, "packageId", {
      enumerable: true,
      get() {
        nestedGetterCalls += 1;
        return "si-cities";
      },
    });
    const hostileNestedInstalled = new InstalledCityPackages({
      loadExactVerified: () => hostileNested,
      loadCurrentVerified: () => hostileNested,
    });
    expect(() => hostileNestedInstalled.findReady("SI")).toThrow("integrity_mismatch");
    expect(nestedGetterCalls).toBe(0);
  });

  test("persists the exact thirteen-key signed payload and reconstructs current B plus historical A", async () => {
    // Break caught: latest-row substitution, unsigned payload drift, or loss of immutable history.
    const database = memoryDatabase();
    const manifests = store(database);
    const inputA = await preparedInput(database, "a", "2026-08-24T10:00:00.000Z");
    const inputB = await preparedInput(database, "b", "2026-08-25T10:00:00.000Z");
    const manifestA = manifests.appendPrepared(inputA);
    const manifestB = manifests.appendPrepared(inputB);
    const payloadA = JSON.parse(database.prepare(
      "SELECT payload_json FROM installed_city_package_manifests WHERE id = ?",
    ).pluck().get(manifestA.id) as string) as Record<string, unknown>;

    expect(Object.keys(payloadA).sort()).toEqual([
      "catalogRoot", "criteria", "definition", "fixedPlansByCityId", "installedAt", "key",
      "predecessorManifestId", "readiness", "safety", "schemaVersion",
      "sourceContractStatus", "sourcePeriodValidatorVersionId", "valueValidatorVersionId",
    ]);
    expect(manifestA.id).toBe(`installed-city-package-manifest:${manifestA.payloadHash}`);
    expect(manifestA.payloadHash).toBe(INTEGRITY.hash(INTEGRITY.canonical(payloadA)));
    expect(manifestA.hmac).toBe(INTEGRITY.sign(INTEGRITY.canonical(payloadA)));
    expect(manifestA.predecessorManifestId).toBeNull();
    expect(manifestB.predecessorManifestId).toBe(manifestA.id);
    expect(manifests.latestVerified("SI")).toEqual(manifestB);
    expect(manifests.loadVerified(manifestA.key)).toEqual(manifestA);
    expect(manifests.loadVerified({ ...manifestA.key, catalogRevisionId: "city-catalog:absent" }))
      .toBeUndefined();

    const installed = new InstalledCityPackages(manifests);
    const current = installed.findReady("SI")!;
    const exactA = installed.findExact(manifestA.key)!;
    expect(current.installedPackageManifest).toEqual({ id: manifestB.id, key: manifestB.key });
    expect(exactA.installedPackageManifest).toEqual({ id: manifestA.id, key: manifestA.key });
    expect(exactA.catalog).toEqual(inputA.catalog.catalog);
    expect(installed.loadExactReplayContract(manifestA.key)?.catalogProjection)
      .toEqual(inputA.catalog);
    expect(installed.latestInstalledVerified("SI")).toEqual(inputB.catalog);
    expect(Object.isFrozen(exactA)).toBe(true);
    expect(Object.isFrozen(exactA.fixedPlansByCityId[CITY_ID]![0])).toBe(true);
    expect(installed.findExact(manifestA.key)).not.toBe(exactA);
  });

  test("descriptor-owns the complete append graph and bytes before any integrity callback", async () => {
    // Break caught: integrity callbacks mutate borrowed plans, bindings, or Uint8Array bytes mid-append.
    const database = memoryDatabase();
    const borrowed = structuredClone(
      await preparedInput(database, "a", "2026-08-24T10:00:00.000Z"),
    );
    const expected = structuredClone(borrowed);
    let mutated = false;
    const reentrantIntegrity: EvidenceIntegrity = {
      canonical(value: unknown): string {
        if (!mutated) {
          mutated = true;
          (borrowed.fixedPlansByCityId[CITY_ID]![0] as { planId: string }).planId = "evil";
          (borrowed.criteriaDefaults.criteria[0] as { target: string }).target = "999";
          (borrowed.administrativeEvidence.bindings[0] as { sha256: string }).sha256 = "0".repeat(64);
          borrowed.administrativeEvidence.artifacts[0]!.bytes[0] ^= 0xff;
        }
        return INTEGRITY.canonical(value);
      },
      hash: (value) => INTEGRITY.hash(value),
      sign: (value) => INTEGRITY.sign(value),
    };
    const manifests = new SqliteCityPackageManifestStore(
      database, reentrantIntegrity, APPROVED_DEFAULTS, behaviorRegistry(),
    );
    const manifest = manifests.appendPrepared(borrowed);
    const reconstructed = manifests.loadExactVerified(manifest.key)!;
    expect(reconstructed.fixedPlansByCityId).toEqual(expected.fixedPlansByCityId);
    expect(reconstructed.criteriaDefaults).toEqual(expected.criteriaDefaults);
    expect(Object.isFrozen(borrowed)).toBe(false);
    expect(Object.isFrozen(borrowed.administrativeEvidence.artifacts[0]!.bytes)).toBe(false);

    let getterCalls = 0;
    const hostile = Object.defineProperty({}, "ready", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return borrowed.ready;
      },
    });
    expect(() => manifests.appendPrepared(
      hostile as InstalledCityPackageManifestAppendInput,
    )).toThrow("integrity_mismatch");
    expect(getterCalls).toBe(0);
    expect(() => manifests.appendPrepared(
      new Proxy(expected, {}) as InstalledCityPackageManifestAppendInput,
    )).toThrow("integrity_mismatch");
    expect(() => manifests.appendPrepared({
      ...expected,
      extra: true,
    } as InstalledCityPackageManifestAppendInput)).toThrow("integrity_mismatch");

    const poisoned = structuredClone(expected);
    let bufferGetterCalls = 0;
    Object.defineProperty(poisoned.administrativeEvidence.artifacts[0]!.bytes, "buffer", {
      configurable: true,
      get() {
        bufferGetterCalls += 1;
        return new ArrayBuffer(0);
      },
    });
    expect(() => manifests.appendPrepared(poisoned)).toThrow("integrity_mismatch");
    expect(bufferGetterCalls).toBe(0);
  });

  test("validates shell and artifact-set equations before fatal canonical JSON decode", async () => {
    // Break caught: permissive TextDecoder/JSON.parse or executable behavior before sealed claim checks.
    for (const [label, bytes] of [
      ["trailing-space", new TextEncoder().encode(`${INTEGRITY.canonical(fixedPlan(
        "si-city-long-term-rent", "a",
      ))} `)],
      ["bom", new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode("{}")])],
      ["duplicate-key", new TextEncoder().encode('{"a":1,"a":1}')],
      ["invalid-utf8", new Uint8Array([0xc3, 0x28])],
    ] as const) {
      const database = memoryDatabase();
      const canonical = await preparedInput(database, "a", "2026-08-24T10:00:00.000Z");
      const input = await withRawJsonArtifact(database, canonical, 0, bytes);
      let behaviorCalls = 0;
      const behaviors = behaviorRegistry();
      (behaviors.entries[0] as { validateValue: CityFixedValueValidator }).validateValue =
        (value) => {
          behaviorCalls += 1;
          return validateValue(value);
        };
      expect(() => new SqliteCityPackageManifestStore(
        database, INTEGRITY, APPROVED_DEFAULTS, behaviors,
      ).appendPrepared(input), label).toThrow("integrity_mismatch");
      expect(behaviorCalls, label).toBe(0);
      expect(count(database, "installed_city_package_manifests"), label).toBe(0);
      expect(count(database, "installed_city_package_heads"), label).toBe(0);
    }
  });

  test.each([
    ["safety", 0],
    ["fixed plan", 1],
  ] as const)("rejects a re-sealed %s definition/plan freshness drift", async (_label, index) => {
    // Break caught: individually valid definitions and source plans are accepted without cross-binding.
    const database = memoryDatabase();
    const canonical = await preparedInput(database, "a", "2026-08-24T10:00:00.000Z");
    const drifted = structuredClone(canonical);
    const definition = drifted.criterionDefinitions[index] as {
      freshnessPolicyVersion: string;
    };
    definition.freshnessPolicyVersion = "monthly-drift@1";
    const resealed = await withRawJsonArtifact(
      database,
      drifted,
      6,
      new TextEncoder().encode(INTEGRITY.canonical(drifted.criterionDefinitions)),
    );
    const behaviors = behaviorRegistry();
    const evaluators = evaluatorRegistry();
    let evaluatorCalls = 0;
    (evaluators[CITY_CRITERION_IDS[index]].definition as {
      freshnessPolicyVersion: string;
    }).freshnessPolicyVersion = "monthly-drift@1";
    for (const criterionId of CITY_CRITERION_IDS) {
      const canonicalize = evaluators[criterionId].canonicalizeTarget;
      (evaluators[criterionId] as { canonicalizeTarget: (target: unknown) => string })
        .canonicalizeTarget = (target) => {
          evaluatorCalls += 1;
          return canonicalize(target);
        };
    }
    (behaviors.entries[0] as {
      evaluatorRegistry: CityCriterionEvaluatorRegistry;
    }).evaluatorRegistry = evaluators;
    expect(() => new SqliteCityPackageManifestStore(
      database, INTEGRITY, APPROVED_DEFAULTS, behaviors,
    ).appendPrepared(resealed)).toThrow("integrity_mismatch");
    expect(evaluatorCalls).toBe(0);
  });

  test.each([
    ["evidence shell", (input: InstalledCityPackageManifestAppendInput) => {
      (input.administrativeEvidence.evidence.snapshot as { id: string }).id = "forged-evidence";
    }],
    ["artifact-set claim", (input: InstalledCityPackageManifestAppendInput) => {
      const claim = input.administrativeEvidence.evidence.snapshot.claims[0]!;
      (claim.value as { installRunId: string }).installRunId = "forged-run";
    }],
    ["binding ordinal", (input: InstalledCityPackageManifestAppendInput) => {
      (input.administrativeEvidence.bindings[0] as { artifactOrdinal: number }).artifactOrdinal = 1;
    }],
    ["artifact bytes", (input: InstalledCityPackageManifestAppendInput) => {
      input.administrativeEvidence.artifacts[0]!.bytes[0] ^= 0xff;
    }],
    ["administrative wrapper extra", (input: InstalledCityPackageManifestAppendInput) => {
      Object.assign(input.administrativeEvidence, { extra: true });
    }],
    ["root undefined", (input: InstalledCityPackageManifestAppendInput) => {
      Object.assign(input, { extra: undefined });
    }],
    ["sealed Evidence wrapper extra", (input: InstalledCityPackageManifestAppendInput) => {
      Object.assign(input.administrativeEvidence.evidence, { extra: true });
    }],
    ["binding hole plus extra name", (input: InstalledCityPackageManifestAppendInput) => {
      const bindings = input.administrativeEvidence.bindings as unknown as
        Array<unknown> & { extra?: string };
      delete bindings[0];
      bindings.extra = "compensating-own-name";
    }],
    ["nested symbol", (input: InstalledCityPackageManifestAppendInput) => {
      Object.defineProperty(input.fixedPlansByCityId[CITY_ID]![0], Symbol("extra"), {
        value: true,
      });
    }],
    ["nested non-enumerable", (input: InstalledCityPackageManifestAppendInput) => {
      Object.defineProperty(input.criteriaDefaults, "extra", { value: true });
    }],
    ["nested undefined", (input: InstalledCityPackageManifestAppendInput) => {
      Object.assign(input.catalog.catalog, { extra: undefined });
    }],
    ["nested custom prototype", (input: InstalledCityPackageManifestAppendInput) => {
      Object.setPrototypeOf(input.officialAuthorityDirectory, { hostile: true });
    }],
    ["nested cycle", (input: InstalledCityPackageManifestAppendInput) => {
      (input.criteriaDefaults as unknown as { cycle: unknown }).cycle = input.criteriaDefaults;
    }],
  ] as const)("rejects caller %s drift before executable behavior", async (_label, mutate) => {
    // Break caught: only evidenceId/bindings are derived while the rest of the supplied bundle is ignored.
    const database = memoryDatabase();
    const input = structuredClone(
      await preparedInput(database, "a", "2026-08-24T10:00:00.000Z"),
    );
    mutate(input);
    let behaviorCalls = 0;
    const behaviors = behaviorRegistry();
    (behaviors.entries[0] as { validateValue: CityFixedValueValidator }).validateValue = (value) => {
      behaviorCalls += 1;
      return validateValue(value);
    };
    expect(() => new SqliteCityPackageManifestStore(
      database, INTEGRITY, APPROVED_DEFAULTS, behaviors,
    ).appendPrepared(input)).toThrow("integrity_mismatch");
    expect(behaviorCalls).toBe(0);
    expect(count(database, "installed_city_package_manifests")).toBe(0);
  });

  test("keeps an unreferenced Catalog C non-current and exact retry A does not disturb head B", async () => {
    // Break caught: raw latest Catalog selection or retry deriving a replacement predecessor.
    const database = memoryDatabase();
    const manifests = store(database);
    const inputA = await preparedInput(database, "a", "2026-08-24T10:00:00.000Z");
    const inputB = await preparedInput(database, "b", "2026-08-25T10:00:00.000Z");
    const manifestA = manifests.appendPrepared(inputA);
    const manifestB = manifests.appendPrepared(inputB);
    const before = {
      manifests: count(database, "installed_city_package_manifests"),
      heads: count(database, "installed_city_package_heads"),
      changes: totalChanges(database),
    };
    const retryA = manifests.appendPrepared(structuredClone(inputA));
    const unreferencedC = await preparedInput(database, "c", "2026-08-26T10:00:00.000Z");

    expect(retryA).toEqual(manifestA);
    expect(manifests.latestVerified("SI")).toEqual(manifestB);
    expect(new InstalledCityPackages(manifests).latestInstalledVerified("SI"))
      .toEqual(inputB.catalog);
    expect(new InstalledCityPackages(manifests).latestInstalledVerified("SI"))
      .not.toEqual(unreferencedC.catalog);
    expect(count(database, "installed_city_package_manifests")).toBe(before.manifests);
    expect(count(database, "installed_city_package_heads")).toBe(before.heads);
    expect(totalChanges(database)).toBeGreaterThanOrEqual(before.changes);
  });

  test("preserves exact retry ordering after restart with zero manifest/head writes", async () => {
    // Break caught: restart retry follows current B and rewrites A as B's successor.
    const path = temporaryDatabasePath();
    const first = openEvidenceDatabase(path);
    databases.push(first);
    const inputA = await preparedInput(first, "a", "2026-08-24T10:00:00.000Z");
    const inputB = await preparedInput(first, "b", "2026-08-25T10:00:00.000Z");
    const firstStore = store(first);
    const manifestA = firstStore.appendPrepared(inputA);
    const manifestB = firstStore.appendPrepared(inputB);
    first.close();

    const reopened = openEvidenceDatabase(path);
    databases.push(reopened);
    const restartedStore = store(reopened);
    const beforeChanges = totalChanges(reopened);
    expect(restartedStore.appendPrepared(inputA)).toEqual(manifestA);
    expect(totalChanges(reopened)).toBe(beforeChanges);
    expect(restartedStore.latestVerified("SI")).toEqual(manifestB);
    expect(count(reopened, "installed_city_package_manifests")).toBe(2);
    expect(count(reopened, "installed_city_package_heads")).toBe(1);
  });

  test("reconstructs an exact A retry without preparing any head statement", async () => {
    // Break caught: retry ordering still consults the current B head despite making no writes.
    const database = memoryDatabase();
    const manifests = store(database);
    const inputA = await preparedInput(database, "a", "2026-08-24T10:00:00.000Z");
    const inputB = await preparedInput(database, "b", "2026-08-25T10:00:00.000Z");
    const manifestA = manifests.appendPrepared(inputA);
    manifests.appendPrepared(inputB);
    const before = totalChanges(database);
    const originalPrepare = database.prepare.bind(database);
    (database as unknown as { prepare: typeof database.prepare }).prepare = ((sql: string) => {
      if (sql.includes("installed_city_package_heads")) throw new Error("head_sql_on_retry");
      return originalPrepare(sql);
    }) as typeof database.prepare;
    try {
      expect(manifests.appendPrepared(structuredClone(inputA))).toEqual(manifestA);
    } finally {
      (database as unknown as { prepare: typeof database.prepare }).prepare = originalPrepare;
    }
    expect(totalChanges(database)).toBe(before);
  });

  test("serializes true two-worker identical and conflicting successor races", async () => {
    // Break caught: two connections leak SQLite errors, duplicate rows, or commit a same-time fork.
    const identicalPath = temporaryDatabasePath();
    const seedIdentical = openEvidenceDatabase(identicalPath);
    databases.push(seedIdentical);
    const identicalInput = await preparedInput(
      seedIdentical, "a", "2026-08-24T10:00:00.000Z",
    );
    seedIdentical.close();
    const identicalGate = new SharedArrayBuffer(2 * Int32Array.BYTES_PER_ELEMENT);
    const identicalPromises = [
      appendInWorker(identicalPath, identicalInput, identicalGate),
      appendInWorker(identicalPath, identicalInput, identicalGate),
    ] as const;
    await releaseWorkersTogether(identicalGate);
    const identical = await Promise.all(identicalPromises);
    expect(identical.every((result) => result.ok)).toBe(true);
    expect(new Set(identical.map((result) => result.ok ? result.manifestId : "error")).size)
      .toBe(1);
    const identicalDb = openEvidenceDatabase(identicalPath);
    databases.push(identicalDb);
    expect(count(identicalDb, "installed_city_package_manifests")).toBe(1);
    expect(count(identicalDb, "installed_city_package_heads")).toBe(1);

    const conflictPath = temporaryDatabasePath();
    const seedConflict = openEvidenceDatabase(conflictPath);
    databases.push(seedConflict);
    const inputA = await preparedInput(seedConflict, "a", "2026-08-24T10:00:00.000Z");
    const inputB = await preparedInput(seedConflict, "b", "2026-08-25T10:00:00.000Z");
    const inputC = await preparedInput(seedConflict, "c", "2026-08-25T10:00:00.000Z");
    store(seedConflict).appendPrepared(inputA);
    seedConflict.close();
    const conflictGate = new SharedArrayBuffer(2 * Int32Array.BYTES_PER_ELEMENT);
    const conflictingPromises = [
      appendInWorker(conflictPath, inputB, conflictGate),
      appendInWorker(conflictPath, inputC, conflictGate),
    ] as const;
    await releaseWorkersTogether(conflictGate);
    const conflicting = await Promise.all(conflictingPromises);
    expect(conflicting.filter((result) => result.ok)).toHaveLength(1);
    expect(conflicting.filter((result) => !result.ok)).toEqual([
      { ok: false, message: "integrity_mismatch" },
    ]);
    const conflictDb = openEvidenceDatabase(conflictPath);
    databases.push(conflictDb);
    expect(count(conflictDb, "installed_city_package_manifests")).toBe(2);
    expect(count(conflictDb, "installed_city_package_heads")).toBe(1);
    const latest = store(conflictDb).latestVerified("SI")!;
    expect([inputB.catalog.catalog.id, inputC.catalog.catalog.id])
      .toContain(latest.key.catalogRevisionId);
  });

  test("fails closed for missing compiled defaults or behavior before manifest/head rows", async () => {
    // Break caught: serialized manifest data selecting or fabricating executable policy.
    const database = memoryDatabase();
    const input = await preparedInput(database, "a", "2026-08-24T10:00:00.000Z");
    const emptyDefaults: ApprovedCityCriteriaDefaultsRegistry = {
      schemaVersion: "approved-city-criteria-defaults-registry@1",
      byMappingVersion: {},
    };
    const emptyBehaviors: InstalledCityPackageBehaviorRegistry = {
      schemaVersion: "installed-city-package-behavior-registry@1",
      entries: [],
    };
    expect(() => new SqliteCityPackageManifestStore(
      database, INTEGRITY, emptyDefaults, behaviorRegistry(),
    ).appendPrepared(input)).toThrow("city_package_behavior_unavailable");
    expect(() => new SqliteCityPackageManifestStore(
      database, INTEGRITY, APPROVED_DEFAULTS, emptyBehaviors,
    ).appendPrepared(input)).toThrow("city_package_behavior_unavailable");
    expect(count(database, "installed_city_package_manifests")).toBe(0);
    expect(count(database, "installed_city_package_heads")).toBe(0);
  });

  test("authenticates the existing chain before resolving new-append behavior", async () => {
    // Break caught: unavailable executable behavior masks a corrupt signed predecessor chain.
    const database = memoryDatabase();
    const inputA = await preparedInput(database, "a", "2026-08-24T10:00:00.000Z");
    const inputB = await preparedInput(database, "b", "2026-08-25T10:00:00.000Z");
    const manifestA = store(database).appendPrepared(inputA);
    database.exec("DROP TRIGGER installed_city_package_manifests_no_update");
    database.prepare(
      "UPDATE installed_city_package_manifests SET hmac = ? WHERE id = ?",
    ).run("0".repeat(64), manifestA.id);
    const emptyBehaviors: InstalledCityPackageBehaviorRegistry = {
      schemaVersion: "installed-city-package-behavior-registry@1",
      entries: [],
    };
    expect(() => new SqliteCityPackageManifestStore(
      database, INTEGRITY, APPROVED_DEFAULTS, emptyBehaviors,
    ).appendPrepared(inputB)).toThrow("integrity_mismatch");
    expect(count(database, "installed_city_package_manifests")).toBe(1);
  });

  test("rejects a fully verified legacy Catalog root before manifest or head writes", async () => {
    // Break caught: SqliteCityCatalogStore can read legacy @1, but installation requires current @2.
    const database = memoryDatabase();
    const input = await preparedInput(
      database, "a", "2026-08-24T10:00:00.000Z", "city-catalog@1",
    );
    expect(() => store(database).appendPrepared(input)).toThrow("integrity_mismatch");
    expect(count(database, "installed_city_package_manifests")).toBe(0);
    expect(count(database, "installed_city_package_heads")).toBe(0);
  });

  test("runs Catalog, Evidence, behavior, and manifest integrity in one immediate transaction before writes", async () => {
    // Break caught: verified dependencies are loaded outside the append transaction or behavior runs post-write.
    const database = memoryDatabase();
    const input = await preparedInput(database, "a", "2026-08-24T10:00:00.000Z");
    let integrityCalls = 0;
    const transactionalIntegrity: EvidenceIntegrity = {
      canonical(value) {
        expect(database.inTransaction).toBe(true);
        integrityCalls += 1;
        return INTEGRITY.canonical(value);
      },
      hash(value) {
        expect(database.inTransaction).toBe(true);
        integrityCalls += 1;
        return INTEGRITY.hash(value);
      },
      sign(value) {
        expect(database.inTransaction).toBe(true);
        integrityCalls += 1;
        return INTEGRITY.sign(value);
      },
    };
    let evaluatorCalls = 0;
    const behaviors = behaviorRegistry();
    const evaluators = evaluatorRegistry();
    const originalCanonicalize = evaluators.safety.canonicalizeTarget;
    (evaluators.safety as { canonicalizeTarget: (target: unknown) => string })
      .canonicalizeTarget = (target) => {
        expect(database.inTransaction).toBe(true);
        if (evaluatorCalls === 0) {
          expect(count(database, "installed_city_package_manifests")).toBe(0);
          expect(count(database, "installed_city_package_heads")).toBe(0);
        }
        evaluatorCalls += 1;
        return originalCanonicalize(target);
      };
    (behaviors.entries[0] as {
      evaluatorRegistry: CityCriterionEvaluatorRegistry;
    }).evaluatorRegistry = evaluators;
    new SqliteCityPackageManifestStore(
      database, transactionalIntegrity, APPROVED_DEFAULTS, behaviors,
    ).appendPrepared(input);
    expect(integrityCalls).toBeGreaterThan(0);
    expect(evaluatorCalls).toBeGreaterThan(0);
  });

  test("rejects append inside a caller-owned transaction instead of returning from a savepoint", async () => {
    // Break caught: nested better-sqlite3 transactions return before the package append is durable.
    const database = memoryDatabase();
    const manifests = store(database);
    const input = await preparedInput(database, "a", "2026-08-24T10:00:00.000Z");
    database.exec("BEGIN");
    try {
      expect(() => manifests.appendPrepared(input)).toThrow("integrity_mismatch");
    } finally {
      database.exec("ROLLBACK");
    }
    expect(count(database, "installed_city_package_manifests")).toBe(0);
    expect(count(database, "installed_city_package_heads")).toBe(0);
  });

  test("normalizes an accessor-backed Error without invoking its message getter", async () => {
    // Break caught: normalize reads a borrowed Error.message after rollback and permits autocommit DML.
    const database = memoryDatabase();
    database.exec("CREATE TABLE normalize_error_probe (value TEXT NOT NULL)");
    let armed = false;
    let getterCalls = 0;
    const hostile = new Error();
    Object.defineProperty(hostile, "message", {
      configurable: true,
      get() {
        getterCalls += 1;
        database.prepare("INSERT INTO normalize_error_probe VALUES ('getter-ran')").run();
        return "city_package_behavior_unavailable";
      },
    });
    const integrity: EvidenceIntegrity = {
      canonical: (value) => INTEGRITY.canonical(value),
      hash(value) {
        if (armed) throw hostile;
        return INTEGRITY.hash(value);
      },
      sign: (value) => INTEGRITY.sign(value),
    };
    const manifests = new SqliteCityPackageManifestStore(
      database, integrity, APPROVED_DEFAULTS, behaviorRegistry(),
    );
    const input = await preparedInput(database, "a", "2026-08-24T10:00:00.000Z");
    manifests.appendPrepared(input);

    armed = true;
    let caught: unknown;
    try {
      manifests.latestVerified("SI");
    } catch (error) {
      caught = error;
    }
    expect.soft(getterCalls).toBe(0);
    expect.soft(count(database, "normalize_error_probe")).toBe(0);
    expect(caught).not.toBe(hostile);
    expect(Object.getOwnPropertyDescriptor(caught as object, "message")?.value)
      .toBe("integrity_mismatch");
  });

  test("does not inherit a data value for an accessor Error descriptor", async () => {
    // Break caught: `value in descriptor` accepts Object.prototype pollution after rollback.
    const database = memoryDatabase();
    database.exec("CREATE TABLE normalize_descriptor_probe (value TEXT NOT NULL)");
    let armed = false;
    let messageGetterCalls = 0;
    let inheritedValueGetterCalls = 0;
    const hostile = new Error();
    Object.defineProperty(hostile, "message", {
      configurable: true,
      get() {
        messageGetterCalls += 1;
        return "city_package_behavior_unavailable";
      },
    });
    const originalValue = Object.getOwnPropertyDescriptor(Object.prototype, "value");
    const integrity: EvidenceIntegrity = {
      canonical: (value) => INTEGRITY.canonical(value),
      hash(value) {
        if (armed) {
          armed = false;
          Object.defineProperty(Object.prototype, "value", {
            configurable: true,
            get() {
              inheritedValueGetterCalls += 1;
              database.prepare(
                "INSERT INTO normalize_descriptor_probe VALUES ('getter-ran')",
              ).run();
              return "city_package_behavior_unavailable";
            },
          });
          throw hostile;
        }
        return INTEGRITY.hash(value);
      },
      sign: (value) => INTEGRITY.sign(value),
    };
    const manifests = new SqliteCityPackageManifestStore(
      database, integrity, APPROVED_DEFAULTS, behaviorRegistry(),
    );
    const input = await preparedInput(database, "a", "2026-08-24T10:00:00.000Z");
    manifests.appendPrepared(input);

    armed = true;
    let caught: unknown;
    try {
      manifests.latestVerified("SI");
    } catch (error) {
      caught = error;
    } finally {
      if (originalValue === undefined) {
        delete (Object.prototype as { value?: unknown }).value;
      } else {
        Object.defineProperty(Object.prototype, "value", originalValue);
      }
    }
    expect.soft(messageGetterCalls).toBe(0);
    expect.soft(inheritedValueGetterCalls).toBe(0);
    expect.soft(count(database, "normalize_descriptor_probe")).toBe(0);
    expect(Object.getOwnPropertyDescriptor(caught as object, "message")?.value)
      .toBe("integrity_mismatch");
  });

  test("normalizes a Proxy Error without invoking reflection traps", async () => {
    // Break caught: instanceof and message access reflect through a borrowed Proxy Error.
    const database = memoryDatabase();
    let armed = false;
    let trapCalls = 0;
    const hostile = new Proxy(new Error("city_package_behavior_unavailable"), {
      get(target, property, receiver) {
        trapCalls += 1;
        return Reflect.get(target, property, receiver);
      },
      getOwnPropertyDescriptor(target, property) {
        trapCalls += 1;
        return Reflect.getOwnPropertyDescriptor(target, property);
      },
      getPrototypeOf(target) {
        trapCalls += 1;
        return Reflect.getPrototypeOf(target);
      },
    });
    const integrity: EvidenceIntegrity = {
      canonical: (value) => INTEGRITY.canonical(value),
      hash(value) {
        if (armed) throw hostile;
        return INTEGRITY.hash(value);
      },
      sign: (value) => INTEGRITY.sign(value),
    };
    const manifests = new SqliteCityPackageManifestStore(
      database, integrity, APPROVED_DEFAULTS, behaviorRegistry(),
    );
    const input = await preparedInput(database, "a", "2026-08-24T10:00:00.000Z");
    manifests.appendPrepared(input);

    armed = true;
    let caught: unknown;
    try {
      manifests.latestVerified("SI");
    } catch (error) {
      caught = error;
    }
    expect(trapCalls).toBe(0);
    expect(caught).not.toBe(hostile);
    expect(Object.getOwnPropertyDescriptor(caught as object, "message")?.value)
      .toBe("integrity_mismatch");
  });

  test("does not accept an inherited behavior-unavailable Error message", async () => {
    // Break caught: inherited Error.prototype.message selects the behavior-unavailable branch.
    const database = memoryDatabase();
    let armed = false;
    const inherited = new Error("city_package_behavior_unavailable");
    delete (inherited as { message?: string }).message;
    const originalMessage = Object.getOwnPropertyDescriptor(Error.prototype, "message");
    if (originalMessage === undefined) throw new Error("missing_intrinsic_error_message");
    Object.defineProperty(Error.prototype, "message", {
      configurable: true,
      value: "city_package_behavior_unavailable",
      writable: true,
    });
    try {
      const integrity: EvidenceIntegrity = {
        canonical: (value) => INTEGRITY.canonical(value),
        hash(value) {
          if (armed) throw inherited;
          return INTEGRITY.hash(value);
        },
        sign: (value) => INTEGRITY.sign(value),
      };
      const manifests = new SqliteCityPackageManifestStore(
        database, integrity, APPROVED_DEFAULTS, behaviorRegistry(),
      );
      const input = await preparedInput(database, "a", "2026-08-24T10:00:00.000Z");
      manifests.appendPrepared(input);

      armed = true;
      let caught: unknown;
      try {
        manifests.latestVerified("SI");
      } catch (error) {
        caught = error;
      }
      expect(caught).not.toBe(inherited);
      expect(Object.getOwnPropertyDescriptor(caught as object, "message")?.value)
        .toBe("integrity_mismatch");
    } finally {
      Object.defineProperty(Error.prototype, "message", originalMessage);
    }
  });

  test("does not let a post-insert integrity callback commit an orphan manifest", async () => {
    // Break caught: callback COMMIT escapes better-sqlite3 rollback after the manifest INSERT.
    const database = memoryDatabase();
    const input = await preparedInput(database, "a", "2026-08-24T10:00:00.000Z");
    let fired = false;
    const integrity: EvidenceIntegrity = {
      canonical: (value) => INTEGRITY.canonical(value),
      hash(value) {
        if (!fired && database.inTransaction &&
          count(database, "installed_city_package_manifests") === 1 &&
          count(database, "installed_city_package_heads") === 0) {
          fired = true;
          database.exec("COMMIT");
          throw new Error("committed_from_integrity_callback");
        }
        return INTEGRITY.hash(value);
      },
      sign: (value) => INTEGRITY.sign(value),
    };
    const manifests = new SqliteCityPackageManifestStore(
      database, integrity, APPROVED_DEFAULTS, behaviorRegistry(),
    );

    expect(() => manifests.appendPrepared(input)).toThrow("integrity_mismatch");
    expect(fired).toBe(true);
    expect(count(database, "installed_city_package_manifests")).toBe(0);
    expect(count(database, "installed_city_package_heads")).toBe(0);
  });

  test.each(["COMMIT", "ROLLBACK"] as const)(
    "rejects a pre-insert callback %s with zero package rows",
    async (control) => {
      // Break caught: append continues in autocommit after a callback ends its owned transaction.
      const database = memoryDatabase();
      let fired = false;
      const behaviors = behaviorRegistry();
      const evaluators = evaluatorRegistry();
      const canonicalize = evaluators.safety.canonicalizeTarget;
      (evaluators.safety as { canonicalizeTarget: (target: unknown) => string })
        .canonicalizeTarget = (target) => {
          if (!fired) {
            fired = true;
            database.exec(control);
          }
          return canonicalize(target);
        };
      (behaviors.entries[0] as {
        evaluatorRegistry: CityCriterionEvaluatorRegistry;
      }).evaluatorRegistry = evaluators;
      const manifests = new SqliteCityPackageManifestStore(
        database, INTEGRITY, APPROVED_DEFAULTS, behaviors,
      );
      const input = await preparedInput(database, "a", "2026-08-24T10:00:00.000Z");

      expect(() => manifests.appendPrepared(input)).toThrow("integrity_mismatch");
      expect(fired).toBe(true);
      expect(count(database, "installed_city_package_manifests")).toBe(0);
      expect(count(database, "installed_city_package_heads")).toBe(0);
    },
  );

  test("rolls back the inserted successor and a reentrant head mutation after zero-row CAS", async () => {
    // Break caught: insert commits when the later signed-payload callback invalidates the expected head.
    const database = memoryDatabase();
    const inputA = await preparedInput(database, "a", "2026-08-24T10:00:00.000Z");
    const inputB = await preparedInput(database, "b", "2026-08-25T10:00:00.000Z");
    let armed = false;
    let fired = false;
    const racingIntegrity: EvidenceIntegrity = {
      canonical: (value) => INTEGRITY.canonical(value),
      hash: (value) => INTEGRITY.hash(value),
      sign(value) {
        if (armed && !fired) {
          let schemaVersion: unknown;
          try {
            schemaVersion = (JSON.parse(value) as { readonly schemaVersion?: unknown })
              .schemaVersion;
          } catch {
            // Other signed canonical values are not manifest payloads.
          }
          if (schemaVersion === "installed-city-package-manifest@1") {
            fired = true;
            database.prepare(
              "DELETE FROM installed_city_package_heads WHERE country_code = 'SI'",
            ).run();
          }
        }
        return INTEGRITY.sign(value);
      },
    };
    const manifests = new SqliteCityPackageManifestStore(
      database, racingIntegrity, APPROVED_DEFAULTS, behaviorRegistry(),
    );
    const manifestA = manifests.appendPrepared(inputA);
    armed = true;
    expect(() => manifests.appendPrepared(inputB)).toThrow("integrity_mismatch");
    expect(fired).toBe(true);
    expect(count(database, "installed_city_package_manifests")).toBe(1);
    expect(manifests.latestVerified("SI")).toEqual(manifestA);
  });

  test("rolls back B when its signing callback tampers the already verified predecessor A", async () => {
    // Break caught: CAS checks only the unchanged head ID after a late callback corrupts predecessor bytes.
    const database = memoryDatabase();
    const inputA = await preparedInput(database, "a", "2026-08-24T10:00:00.000Z");
    const inputB = await preparedInput(database, "b", "2026-08-25T10:00:00.000Z");
    let armed = false;
    let fired = false;
    let manifestAId = "";
    const integrity: EvidenceIntegrity = {
      canonical: (value) => INTEGRITY.canonical(value),
      hash: (value) => INTEGRITY.hash(value),
      sign(value) {
        if (armed && !fired) {
          const parsed = JSON.parse(value) as { readonly schemaVersion?: unknown };
          if (parsed.schemaVersion === "installed-city-package-manifest@1") {
            fired = true;
            database.prepare(
              "UPDATE installed_city_package_manifests SET hmac = ? WHERE id = ?",
            ).run("0".repeat(64), manifestAId);
          }
        }
        return INTEGRITY.sign(value);
      },
    };
    const manifests = new SqliteCityPackageManifestStore(
      database, integrity, APPROVED_DEFAULTS, behaviorRegistry(),
    );
    const manifestA = manifests.appendPrepared(inputA);
    manifestAId = manifestA.id;
    database.exec("DROP TRIGGER installed_city_package_manifests_no_update");
    armed = true;
    expect(() => manifests.appendPrepared(inputB)).toThrow("integrity_mismatch");
    armed = false;
    expect(fired).toBe(true);
    expect(count(database, "installed_city_package_manifests")).toBe(1);
    expect(manifests.latestVerified("SI")).toEqual(manifestA);
  });

  test("rolls back late artifact DML from public reads and exact retries", async () => {
    // Break caught: callback writes outside the manifest/head topology survive verified read paths.
    const database = memoryDatabase();
    let armed = false;
    let fired = 0;
    let artifactId = "";
    let retryHeadId = "";
    let mutation: "artifact" | "head" = "artifact";
    const behaviors = behaviorRegistry();
    const evaluators = evaluatorRegistry();
    const canonicalize = evaluators.safety.canonicalizeTarget;
    (evaluators.safety as { canonicalizeTarget: (target: unknown) => string })
      .canonicalizeTarget = (target) => {
        if (armed) {
          armed = false;
          fired += 1;
          if (mutation === "artifact") {
            const row = database.prepare(
              "SELECT run_id, bytes FROM artifacts WHERE artifact_id = ?",
            ).get(artifactId) as { readonly run_id: string; readonly bytes: Uint8Array };
            const bytes = Uint8Array.from(row.bytes);
            bytes[0] ^= 0xff;
            database.prepare(
              "UPDATE artifacts SET bytes = ? WHERE run_id = ? AND artifact_id = ?",
            ).run(bytes, row.run_id, artifactId);
          } else {
            database.prepare(`
              UPDATE installed_city_package_heads SET current_manifest_id = ?
              WHERE country_code = 'SI'
            `).run(retryHeadId);
          }
        }
        return canonicalize(target);
      };
    (behaviors.entries[0] as {
      evaluatorRegistry: CityCriterionEvaluatorRegistry;
    }).evaluatorRegistry = evaluators;
    const manifests = new SqliteCityPackageManifestStore(
      database, INTEGRITY, APPROVED_DEFAULTS, behaviors,
    );
    const inputA = await preparedInput(database, "a", "2026-08-24T10:00:00.000Z");
    const inputB = await preparedInput(database, "b", "2026-08-25T10:00:00.000Z");
    const manifestA = manifests.appendPrepared(inputA);
    const manifestB = manifests.appendPrepared(inputB);
    artifactId = inputA.administrativeEvidence.bindings[0]!.artifactId;
    const originalBytes = Uint8Array.from(database.prepare(
      "SELECT bytes FROM artifacts WHERE artifact_id = ?",
    ).pluck().get(artifactId) as Uint8Array);
    database.exec("DROP TRIGGER artifacts_no_update");

    armed = true;
    expect(() => manifests.latestVerified("SI")).toThrow("integrity_mismatch");
    expect(fired).toBe(1);
    expect(Uint8Array.from(database.prepare(
      "SELECT bytes FROM artifacts WHERE artifact_id = ?",
    ).pluck().get(artifactId) as Uint8Array)).toEqual(originalBytes);
    expect(manifests.latestVerified("SI")).toEqual(manifestB);

    mutation = "head";
    retryHeadId = manifestA.id;
    armed = true;
    expect(() => manifests.appendPrepared(structuredClone(inputA)))
      .toThrow("integrity_mismatch");
    expect(fired).toBe(2);
    expect(Uint8Array.from(database.prepare(
      "SELECT bytes FROM artifacts WHERE artifact_id = ?",
    ).pluck().get(artifactId) as Uint8Array)).toEqual(originalBytes);
    expect(manifests.latestVerified("SI")).toEqual(manifestB);
    expect(manifests.loadVerified(manifestA.key)).toEqual(manifestA);
  });

  test.each(["current read", "exact read", "exact retry", "new append"] as const)(
    "rolls back callback DDL during %s",
    async (operation) => {
      // Break caught: total_changes ignores DDL, allowing a callback to remove immutability guards.
      const database = memoryDatabase();
      let armed = false;
      let fired = 0;
      const behaviors = behaviorRegistry();
      const evaluators = evaluatorRegistry();
      const canonicalize = evaluators.safety.canonicalizeTarget;
      (evaluators.safety as { canonicalizeTarget: (target: unknown) => string })
        .canonicalizeTarget = (target) => {
          if (armed) {
            armed = false;
            fired += 1;
            database.exec("DROP TRIGGER installed_city_package_manifests_no_update");
          }
          return canonicalize(target);
        };
      (behaviors.entries[0] as {
        evaluatorRegistry: CityCriterionEvaluatorRegistry;
      }).evaluatorRegistry = evaluators;
      const manifests = new SqliteCityPackageManifestStore(
        database, INTEGRITY, APPROVED_DEFAULTS, behaviors,
      );
      const input = await preparedInput(database, "a", "2026-08-24T10:00:00.000Z");
      const installed = operation === "new append" ? undefined : manifests.appendPrepared(input);
      armed = true;
      const action = operation === "current read"
        ? () => manifests.latestVerified("SI")
        : operation === "exact read"
          ? () => manifests.loadVerified(installed!.key)
          : () => manifests.appendPrepared(structuredClone(input));

      expect(action).toThrow("integrity_mismatch");
      expect(fired).toBe(1);
      expect(database.prepare(`
        SELECT COUNT(*) FROM sqlite_master
        WHERE type = 'trigger' AND name = 'installed_city_package_manifests_no_update'
      `).pluck().get()).toBe(1);
      expect(count(database, "installed_city_package_manifests"))
        .toBe(operation === "new append" ? 0 : 1);
      expect(count(database, "installed_city_package_heads"))
        .toBe(operation === "new append" ? 0 : 1);
    },
  );

  test.each(["current read", "exact retry"] as const)(
    "rolls back callback TEMP-schema shadowing during %s",
    async (operation) => {
      // Break caught: main schema_version misses TEMP objects that shadow unqualified SQL.
      const database = memoryDatabase();
      let armed = false;
      const behaviors = behaviorRegistry();
      const evaluators = evaluatorRegistry();
      const canonicalize = evaluators.safety.canonicalizeTarget;
      (evaluators.safety as { canonicalizeTarget: (target: unknown) => string })
        .canonicalizeTarget = (target) => {
          if (armed) {
            armed = false;
            database.exec(`
              CREATE TEMP TABLE installed_city_package_heads (
                country_code TEXT,
                current_manifest_id TEXT
              )
            `);
          }
          return canonicalize(target);
        };
      (behaviors.entries[0] as {
        evaluatorRegistry: CityCriterionEvaluatorRegistry;
      }).evaluatorRegistry = evaluators;
      const manifests = new SqliteCityPackageManifestStore(
        database, INTEGRITY, APPROVED_DEFAULTS, behaviors,
      );
      const input = await preparedInput(database, "a", "2026-08-24T10:00:00.000Z");
      manifests.appendPrepared(input);
      armed = true;
      const action = operation === "current read"
        ? () => manifests.latestVerified("SI")
        : () => manifests.appendPrepared(structuredClone(input));

      expect(action).toThrow("integrity_mismatch");
      expect(database.prepare(`
        SELECT COUNT(*) FROM sqlite_temp_master
        WHERE name = 'installed_city_package_heads'
      `).pluck().get()).toBe(0);
      expect(manifests.latestVerified("SI")).toBeDefined();
    },
  );

  test.each(["current read", "exact retry"] as const)(
    "restores connection attachments after callback ATTACH during %s",
    async (operation) => {
      // Break caught: ATTACH survives transaction rollback even when schema drift is detected.
      const database = memoryDatabase();
      let armed = false;
      const behaviors = behaviorRegistry();
      const evaluators = evaluatorRegistry();
      const canonicalize = evaluators.safety.canonicalizeTarget;
      (evaluators.safety as { canonicalizeTarget: (target: unknown) => string })
        .canonicalizeTarget = (target) => {
          if (armed) {
            armed = false;
            database.prepare("ATTACH DATABASE ? AS hostile").run(":memory:");
          }
          return canonicalize(target);
        };
      (behaviors.entries[0] as {
        evaluatorRegistry: CityCriterionEvaluatorRegistry;
      }).evaluatorRegistry = evaluators;
      const manifests = new SqliteCityPackageManifestStore(
        database, INTEGRITY, APPROVED_DEFAULTS, behaviors,
      );
      const input = await preparedInput(database, "a", "2026-08-24T10:00:00.000Z");
      manifests.appendPrepared(input);
      const before = database.pragma("database_list");
      armed = true;
      const action = operation === "current read"
        ? () => manifests.latestVerified("SI")
        : () => manifests.appendPrepared(structuredClone(input));

      expect(action).toThrow("integrity_mismatch");
      expect(database.pragma("database_list")).toEqual(before);
      expect(manifests.latestVerified("SI")).toBeDefined();
    },
  );

  test("allows nested callback SELECTs while reconstructing a verified read", async () => {
    // Break caught: the callback sandbox blocks the read-only dependency work it must permit.
    const database = memoryDatabase();
    let armed = false;
    let selected = false;
    const behaviors = behaviorRegistry();
    const evaluators = evaluatorRegistry();
    const canonicalize = evaluators.safety.canonicalizeTarget;
    (evaluators.safety as { canonicalizeTarget: (target: unknown) => string })
      .canonicalizeTarget = (target) => {
        if (armed) {
          armed = false;
          selected = database.prepare("SELECT 42").pluck().get() === 42;
        }
        return canonicalize(target);
      };
    (behaviors.entries[0] as {
      evaluatorRegistry: CityCriterionEvaluatorRegistry;
    }).evaluatorRegistry = evaluators;
    const manifests = new SqliteCityPackageManifestStore(
      database, INTEGRITY, APPROVED_DEFAULTS, behaviors,
    );
    const input = await preparedInput(database, "a", "2026-08-24T10:00:00.000Z");
    const manifest = manifests.appendPrepared(input);

    armed = true;
    expect(manifests.latestVerified("SI")).toEqual(manifest);
    expect(selected).toBe(true);
  });

  test.each([
    {
      name: "INSERT",
      mutate: (database: Database.Database) => database.prepare(
        "INSERT INTO callback_barrier_probe (value) VALUES ('inserted')",
      ).run(),
    },
    {
      name: "UPDATE",
      mutate: (database: Database.Database) => database.prepare(
        "UPDATE callback_barrier_probe SET value = 'updated' WHERE id = 1",
      ).run(),
    },
    {
      name: "DDL",
      mutate: (database: Database.Database) => database.exec(
        "CREATE TABLE callback_barrier_ddl (id INTEGER PRIMARY KEY)",
      ),
    },
    {
      name: "TEMP DDL",
      mutate: (database: Database.Database) => database.exec(
        "CREATE TEMP TABLE callback_barrier_temp (id INTEGER PRIMARY KEY)",
      ),
    },
    {
      name: "ATTACH",
      mutate: (database: Database.Database) => database.prepare(
        "ATTACH DATABASE ? AS callback_barrier_hostile",
      ).run(":memory:"),
    },
    {
      name: "COMMIT",
      mutate: (database: Database.Database) => database.exec("COMMIT"),
    },
    {
      name: "ROLLBACK",
      mutate: (database: Database.Database) => database.exec("ROLLBACK"),
    },
    {
      name: "close",
      mutate: (database: Database.Database) => database.close(),
    },
    ...([
      "query_only",
      "ignore_check_constraints",
      "recursive_triggers",
      "trusted_schema",
      "busy_timeout",
    ] as const).map((pragma) => ({
      name: `PRAGMA ${pragma}`,
      mutate: (database: Database.Database) => {
        const value = database.pragma(pragma, { simple: true }) as number;
        const changed = pragma === "busy_timeout" ? (value === 0 ? 5000 : 0) : value === 0 ? 1 : 0;
        database.pragma(`${pragma} = ${changed}`);
      },
    })),
  ])(
    "blocks callback $name before connection mutation while completing a verified read",
    async ({ mutate }) => {
      // Break caught: callback SQL executes and is detected only after mutating shared connection state.
      const database = memoryDatabase();
      database.exec(`
        CREATE TABLE callback_barrier_probe (id INTEGER PRIMARY KEY, value TEXT NOT NULL);
        INSERT INTO callback_barrier_probe (id, value) VALUES (1, 'original');
      `);
      let armed = false;
      let blocked: unknown;
      const behaviors = behaviorRegistry();
      const evaluators = evaluatorRegistry();
      const canonicalize = evaluators.safety.canonicalizeTarget;
      (evaluators.safety as { canonicalizeTarget: (target: unknown) => string })
        .canonicalizeTarget = (target) => {
          if (armed) {
            armed = false;
            try {
              mutate(database);
            } catch (error) {
              blocked = error;
            }
          }
          return canonicalize(target);
        };
      (behaviors.entries[0] as {
        evaluatorRegistry: CityCriterionEvaluatorRegistry;
      }).evaluatorRegistry = evaluators;
      const manifests = new SqliteCityPackageManifestStore(
        database, INTEGRITY, APPROVED_DEFAULTS, behaviors,
      );
      const input = await preparedInput(database, "a", "2026-08-24T10:00:00.000Z");
      const manifest = manifests.appendPrepared(input);
      const schemaBefore = database.prepare(`
        SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name
      `).all();
      const tempSchemaBefore = database.prepare(`
        SELECT type, name, tbl_name, sql FROM sqlite_temp_master ORDER BY type, name
      `).all();
      const databasesBefore = database.pragma("database_list");
      const pragmasBefore = Object.fromEntries([
        "query_only",
        "ignore_check_constraints",
        "recursive_triggers",
        "trusted_schema",
        "busy_timeout",
      ].map((pragma) => [pragma, database.pragma(pragma, { simple: true })]));

      armed = true;
      expect(manifests.latestVerified("SI")).toEqual(manifest);
      expect(blocked).toBeInstanceOf(Error);
      expect((blocked as Error).message).toContain("busy executing a query");
      expect(database.open).toBe(true);
      expect(database.inTransaction).toBe(false);
      expect(database.prepare(
        "SELECT id, value FROM callback_barrier_probe ORDER BY id",
      ).all()).toEqual([{ id: 1, value: "original" }]);
      expect(database.prepare(`
        SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name
      `).all()).toEqual(schemaBefore);
      expect(database.prepare(`
        SELECT type, name, tbl_name, sql FROM sqlite_temp_master ORDER BY type, name
      `).all()).toEqual(tempSchemaBefore);
      expect(database.pragma("database_list")).toEqual(databasesBefore);
      expect(Object.fromEntries([
        "query_only",
        "ignore_check_constraints",
        "recursive_triggers",
        "trusted_schema",
        "busy_timeout",
      ].map((pragma) => [pragma, database.pragma(pragma, { simple: true })])))
        .toEqual(pragmasBefore);
    },
  );

  test("blocks callback DML during an exact retry while preserving zero-write replay", async () => {
    // Break caught: exact retry has guards but no prevention barrier around executable reconstruction.
    const database = memoryDatabase();
    database.exec("CREATE TABLE retry_barrier_probe (value TEXT NOT NULL)");
    let armed = false;
    let blocked: unknown;
    const behaviors = behaviorRegistry();
    const evaluators = evaluatorRegistry();
    const canonicalize = evaluators.safety.canonicalizeTarget;
    (evaluators.safety as { canonicalizeTarget: (target: unknown) => string })
      .canonicalizeTarget = (target) => {
        if (armed) {
          armed = false;
          try {
            database.prepare("INSERT INTO retry_barrier_probe VALUES ('mutated')").run();
          } catch (error) {
            blocked = error;
          }
        }
        return canonicalize(target);
      };
    (behaviors.entries[0] as {
      evaluatorRegistry: CityCriterionEvaluatorRegistry;
    }).evaluatorRegistry = evaluators;
    const manifests = new SqliteCityPackageManifestStore(
      database, INTEGRITY, APPROVED_DEFAULTS, behaviors,
    );
    const input = await preparedInput(database, "a", "2026-08-24T10:00:00.000Z");
    const manifest = manifests.appendPrepared(input);
    const changes = database.prepare("SELECT total_changes()").pluck().get();

    armed = true;
    expect(manifests.appendPrepared(structuredClone(input))).toEqual(manifest);
    expect((blocked as Error).message).toContain("busy executing a query");
    expect(database.prepare("SELECT * FROM retry_barrier_probe").all()).toEqual([]);
    expect(database.prepare("SELECT total_changes()").pluck().get()).toBe(changes);
  });

  test.each([
    "query_only",
    "ignore_check_constraints",
    "recursive_triggers",
    "trusted_schema",
    "busy_timeout",
  ] as const)("fails closed and preserves bounded PRAGMA %s after a callback setter", async (pragma) => {
    // Break caught: PRAGMA preparation mutates before its run call throws busy under the barrier.
    const database = memoryDatabase();
    let armed = false;
    let changed = 0;
    let blocked: unknown;
    const behaviors = behaviorRegistry();
    const evaluators = evaluatorRegistry();
    const canonicalize = evaluators.safety.canonicalizeTarget;
    (evaluators.safety as { canonicalizeTarget: (target: unknown) => string })
      .canonicalizeTarget = (target) => {
        if (armed) {
          armed = false;
          const setter = database.prepare(`PRAGMA ${pragma} = ${changed}`);
          try {
            setter.run();
          } catch (error) {
            blocked = error;
          }
        }
        return canonicalize(target);
      };
    (behaviors.entries[0] as {
      evaluatorRegistry: CityCriterionEvaluatorRegistry;
    }).evaluatorRegistry = evaluators;
    const manifests = new SqliteCityPackageManifestStore(
      database, INTEGRITY, APPROVED_DEFAULTS, behaviors,
    );
    const input = await preparedInput(database, "a", "2026-08-24T10:00:00.000Z");
    manifests.appendPrepared(input);
    const before = database.pragma(pragma, { simple: true }) as number;
    changed = pragma === "busy_timeout" ? (before === 0 ? 5000 : 0) : before === 0 ? 1 : 0;

    armed = true;
    expect(() => manifests.latestVerified("SI")).toThrow("integrity_mismatch");
    expect((blocked as Error).message).toContain("busy executing a query");
    expect(database.pragma(pragma, { simple: true })).toBe(before);
    expect(manifests.latestVerified("SI")).toBeDefined();
  });

  test("rejects same-key semantic/time drift and rolls back without changing the current head", async () => {
    // Break caught: an exact-key collision is treated as an idempotent retry.
    const database = memoryDatabase();
    const manifests = store(database);
    const input = await preparedInput(database, "a", "2026-08-24T10:00:00.000Z");
    const manifest = manifests.appendPrepared(input);
    const driftedTime = structuredClone(input);
    (driftedTime as { installedAt: string }).installedAt = "2026-08-24T11:00:00.000Z";
    expect(() => manifests.appendPrepared(driftedTime)).toThrow("integrity_mismatch");
    const driftedPlan = structuredClone(input);
    (driftedPlan.fixedPlansByCityId[CITY_ID]![0] as { planId: string }).planId += ":drift";
    expect(() => manifests.appendPrepared(driftedPlan)).toThrow("integrity_mismatch");
    expect(manifests.latestVerified("SI")).toEqual(manifest);
    expect(count(database, "installed_city_package_manifests")).toBe(1);
  });

  test("detects persisted signature, artifact, and package-head topology tamper", async () => {
    // Break caught: signature-only shortcut, missing artifact tolerance, or head rollback.
    const signatureDb = memoryDatabase();
    const signatureStore = store(signatureDb);
    const signatureInput = await preparedInput(signatureDb, "a", "2026-08-24T10:00:00.000Z");
    const signatureManifest = signatureStore.appendPrepared(signatureInput);
    signatureDb.exec("DROP TRIGGER installed_city_package_manifests_no_update");
    signatureDb.prepare(
      "UPDATE installed_city_package_manifests SET hmac = ? WHERE id = ?",
    ).run("0".repeat(64), signatureManifest.id);
    expect(() => signatureStore.loadVerified(signatureManifest.key)).toThrow("integrity_mismatch");

    const artifactDb = memoryDatabase();
    const artifactStore = store(artifactDb);
    const artifactInput = await preparedInput(artifactDb, "a", "2026-08-24T10:00:00.000Z");
    const artifactManifest = artifactStore.appendPrepared(artifactInput);
    artifactDb.exec("DROP TRIGGER artifacts_no_delete");
    artifactDb.prepare("DELETE FROM artifacts WHERE artifact_id = ?")
      .run(artifactInput.administrativeEvidence.bindings[0]!.artifactId);
    expect(() => artifactStore.loadVerified(artifactManifest.key)).toThrow("integrity_mismatch");

    const headDb = memoryDatabase();
    const headStore = store(headDb);
    const inputA = await preparedInput(headDb, "a", "2026-08-24T10:00:00.000Z");
    const inputB = await preparedInput(headDb, "b", "2026-08-25T10:00:00.000Z");
    const manifestA = headStore.appendPrepared(inputA);
    headStore.appendPrepared(inputB);
    headDb.prepare(
      "UPDATE installed_city_package_heads SET current_manifest_id = ? WHERE country_code = 'SI'",
    ).run(manifestA.id);
    expect(() => headStore.latestVerified("SI")).toThrow("integrity_mismatch");
    expect(() => new InstalledCityPackages(headStore).latestInstalledVerified("SI"))
      .toThrow("integrity_mismatch");
  });

  test("validates full predecessor history, row mirrors, and topology even for absent exact keys", async () => {
    // Break caught: validating only the requested/current envelope or returning absent before topology checks.
    const database = memoryDatabase();
    const manifests = store(database);
    const inputA = await preparedInput(database, "a", "2026-08-24T10:00:00.000Z");
    const inputB = await preparedInput(database, "b", "2026-08-25T10:00:00.000Z");
    const manifestA = manifests.appendPrepared(inputA);
    manifests.appendPrepared(inputB);
    database.exec("DROP TRIGGER artifacts_no_delete");
    database.prepare("DELETE FROM artifacts WHERE artifact_id = ?")
      .run(inputA.administrativeEvidence.bindings[0]!.artifactId);
    expect(() => manifests.loadVerified(manifestA.key)).toThrow("integrity_mismatch");
    expect(() => manifests.latestVerified("SI")).toThrow("integrity_mismatch");

    const topologyDb = memoryDatabase();
    const topologyStore = store(topologyDb);
    const topologyA = await preparedInput(topologyDb, "a", "2026-08-24T10:00:00.000Z");
    const topologyB = await preparedInput(topologyDb, "b", "2026-08-25T10:00:00.000Z");
    const persistedA = topologyStore.appendPrepared(topologyA);
    const persistedB = topologyStore.appendPrepared(topologyB);
    topologyDb.exec(`
      DROP TRIGGER installed_city_package_manifests_no_update;
      DROP INDEX installed_city_package_manifest_one_root;
    `);
    topologyDb.prepare(`
      UPDATE installed_city_package_manifests SET predecessor_manifest_id = NULL WHERE id = ?
    `).run(persistedB.id);
    expect(() => topologyStore.loadVerified({
      ...persistedA.key,
      catalogRevisionId: "city-catalog:absent",
    })).toThrow("integrity_mismatch");

    const mirrorDb = memoryDatabase();
    const mirrorStore = store(mirrorDb);
    const mirrorInput = await preparedInput(mirrorDb, "a", "2026-08-24T10:00:00.000Z");
    const mirrorManifest = mirrorStore.appendPrepared(mirrorInput);
    mirrorDb.exec("DROP TRIGGER installed_city_package_manifests_no_update");
    mirrorDb.pragma("foreign_keys = OFF");
    mirrorDb.prepare(
      "UPDATE installed_city_package_manifests SET id = ? WHERE id = ?",
    ).run("installed-city-package-manifest:forged", mirrorManifest.id);
    expect(() => mirrorStore.latestVerified("SI")).toThrow("integrity_mismatch");
  });

  test.each([
    ["missing city block", (payload: MutableManifestPayloadFixture) => {
      delete payload.fixedPlansByCityId[CITY_ID];
    }],
    ["extra city block", (payload: MutableManifestPayloadFixture) => {
      const extra = structuredClone(payload.fixedPlansByCityId[CITY_ID]!);
      extra.forEach((plan, index) => {
        plan.cityId = "maribor";
        plan.planId = `maribor:${FIXED_SOURCE_IDS[index]}:plan-extra@1`;
        plan.planArtifact.artifactId = `installed-city-package-artifact:extra-${index}`;
        plan.planArtifact.artifactOrdinal = index + FIXED_SOURCE_IDS.length;
      });
      payload.fixedPlansByCityId.maribor = extra;
      payload.safety.sourcePlanArtifact.artifactOrdinal += FIXED_SOURCE_IDS.length;
      payload.safety.authorityDirectoryArtifact.artifactOrdinal += FIXED_SOURCE_IDS.length;
      payload.criteria.defaultsArtifact.artifactOrdinal += FIXED_SOURCE_IDS.length;
      payload.criteria.definitionsArtifact.artifactOrdinal += FIXED_SOURCE_IDS.length;
    }],
    ["reordered fixed-source block", (payload: MutableManifestPayloadFixture) => {
      const tuple = payload.fixedPlansByCityId[CITY_ID]!;
      payload.fixedPlansByCityId[CITY_ID] = [tuple[1]!, tuple[0]!, tuple[2]!];
    }],
  ] as const)("rejects a re-signed %s before loading Evidence", async (_label, mutate) => {
    // Break caught: signed package blocks, rather than verified Catalog members, derive 3N + 4.
    const database = memoryDatabase();
    const manifests = store(database);
    const input = await preparedInput(database, "a", "2026-08-24T10:00:00.000Z");
    const manifest = manifests.appendPrepared(input);
    rewriteSignedManifestPayload(database, manifest.id, mutate);
    const originalPrepare = database.prepare.bind(database);
    let evidenceQueries = 0;
    (database as unknown as { prepare: typeof database.prepare }).prepare = ((sql: string) => {
      if (sql.includes("FROM evidence_snapshots")) evidenceQueries += 1;
      return originalPrepare(sql);
    }) as typeof database.prepare;
    try {
      expect(() => manifests.latestVerified("SI")).toThrow("integrity_mismatch");
    } finally {
      (database as unknown as { prepare: typeof database.prepare }).prepare = originalPrepare;
    }
    expect(evidenceQueries).toBe(0);
  });

  test("authenticates every envelope before behavior and rejects a cross-country successor", async () => {
    // Break caught: A behavior runs before corrupt B is authenticated, or ZZ can succeed SI head A.
    const database = memoryDatabase();
    let evaluatorCalls = 0;
    const behaviors = behaviorRegistry();
    const evaluators = evaluatorRegistry();
    const canonicalize = evaluators.safety.canonicalizeTarget;
    (evaluators.safety as { canonicalizeTarget: (target: unknown) => string })
      .canonicalizeTarget = (target) => {
        evaluatorCalls += 1;
        return canonicalize(target);
      };
    (behaviors.entries[0] as {
      evaluatorRegistry: CityCriterionEvaluatorRegistry;
    }).evaluatorRegistry = evaluators;
    const manifests = new SqliteCityPackageManifestStore(
      database, INTEGRITY, APPROVED_DEFAULTS, behaviors,
    );
    const inputA = await preparedInput(database, "a", "2026-08-24T10:00:00.000Z");
    const inputB = await preparedInput(database, "b", "2026-08-25T10:00:00.000Z");
    const manifestA = manifests.appendPrepared(inputA);
    const manifestB = manifests.appendPrepared(inputB);
    evaluatorCalls = 0;
    database.exec("DROP TRIGGER installed_city_package_manifests_no_update");
    database.prepare(
      "UPDATE installed_city_package_manifests SET hmac = ? WHERE id = ?",
    ).run("0".repeat(64), manifestB.id);
    expect(() => manifests.latestVerified("SI")).toThrow("integrity_mismatch");
    expect(evaluatorCalls).toBe(0);

    database.pragma("foreign_keys = OFF");
    database.prepare(
      "UPDATE installed_city_package_manifests SET hmac = ?, country_code = 'ZZ' WHERE id = ?",
    ).run(manifestB.hmac, manifestB.id);
    database.prepare(
      "UPDATE installed_city_package_heads SET current_manifest_id = ? WHERE country_code = 'SI'",
    ).run(manifestA.id);
    expect(() => manifests.latestVerified("SI")).toThrow("integrity_mismatch");
  });

  test("rejects a foreign-country head pointing into the selected country chain", async () => {
    // Break caught: head validation queries only the requested country and ignores reverse pointers.
    const database = memoryDatabase();
    const manifests = store(database);
    const inputA = await preparedInput(database, "a", "2026-08-24T10:00:00.000Z");
    const inputB = await preparedInput(database, "b", "2026-08-25T10:00:00.000Z");
    const manifestA = manifests.appendPrepared(inputA);
    manifests.appendPrepared(inputB);
    database.pragma("foreign_keys = OFF");
    database.prepare(`
      INSERT INTO installed_city_package_heads (country_code, current_manifest_id)
      VALUES ('ZZ', ?)
    `).run(manifestA.id);
    expect(() => manifests.latestVerified("SI")).toThrow("integrity_mismatch");
    expect(() => manifests.loadVerified(manifestA.key)).toThrow("integrity_mismatch");
  });

  test.each([
    ["id", "installed-city-package-manifest:forged"],
    ["country_code", "ZZ"],
    ["package_id", "other-package"],
    ["package_schema_version", "other-package@1"],
    ["catalog_revision_id", "city-catalog:forged"],
    ["evidence_rules_version", "other-rules@1"],
    ["predecessor_manifest_id", "installed-city-package-manifest:forged"],
    ["administrative_evidence_snapshot_id", "city-package-evidence:forged"],
    ["installed_at", "2026-08-24T11:00:00.000Z"],
    ["payload_json", "{}"],
    ["payload_hash", "0".repeat(64)],
    ["hmac", "0".repeat(64)],
  ])("rejects raw manifest mirror/signature drift in %s", async (column, value) => {
    // Break caught: trusting any denormalized row field without signed-payload mirror verification.
    const database = memoryDatabase();
    const manifests = store(database);
    const input = await preparedInput(database, "a", "2026-08-24T10:00:00.000Z");
    const manifest = manifests.appendPrepared(input);
    database.exec("DROP TRIGGER installed_city_package_manifests_no_update");
    database.pragma("foreign_keys = OFF");
    database.prepare(
      `UPDATE installed_city_package_manifests SET ${column} = ? WHERE id = ?`,
    ).run(value, manifest.id);
    expect(() => manifests.loadVerified(manifest.key)).toThrow("integrity_mismatch");
    expect(() => manifests.latestVerified("SI")).toThrow("integrity_mismatch");
  });
});
