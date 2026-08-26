import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Worker } from "node:worker_threads";

import Database from "better-sqlite3";
import { afterEach, describe, expect, test, vi } from "vitest";

import {
  cityEvidenceContextHash,
  type CityCatalogStorePort,
  type CityEvidenceContext,
  type CityEvidencePackageReplayPort,
  type CityEvidencePayload,
  type CityEvidenceSealInput,
  type CityKnowledgeStorePort,
  type CityPackageEvidenceReplayContract,
} from "../../src/application/city-data-contracts";
import {
  buildCityCatalogRevision,
  buildCityRegistryRevision,
  CITY_CATALOG_RULES_VERSION,
  LEGACY_CITY_CATALOG_RULES_VERSION,
  type CityCatalogProjection,
  type CityCatalogRevision,
  type CityRegistryRevision,
} from "../../src/decision/city-catalog";
import {
  buildCityKnowledgeRevision,
  type CityKnowledgeEvidenceView,
  type CityKnowledgeFactContractTuple,
  type CityKnowledgeRevision,
} from "../../src/research/city-knowledge";
import {
  createCityDecisionIntegrityView,
  createEvidenceIntegrity,
} from "../../src/infrastructure/integrity";
import { SqliteCityCatalogStore } from "../../src/infrastructure/sqlite/city-catalog-store";
import { SqliteCityEvidenceStore } from "../../src/infrastructure/sqlite/city-evidence-store";
import { SqliteCityKnowledgeStore } from "../../src/infrastructure/sqlite/city-knowledge-store";
import { openEvidenceDatabase } from "../../src/infrastructure/sqlite/db";
import {
  insertSealedEvidence,
  loadVerifiedEvidenceBundle,
} from "../../src/infrastructure/sqlite/evidence-store";
import {
  citySafetyTerminalEntry,
  SLOVENIA_CITY_SAFETY_FACT_CONTRACT,
  SLOVENIA_CITY_FACT_SOURCE_IDS,
  type CityEvidenceClaim,
  type CityFixedAttemptLedger,
  type CityFixedEvidenceClaim,
  type CityFixedSourcePlan,
  type SloveniaCityFactSourceId,
  type SloveniaCityFixedSourceId,
} from "../../src/research/city-evidence";
import type {
  CitySafetyArtifactReference,
  CitySafetyAttemptLedger,
} from "../../src/research/city-safety-evidence";
import type { LiveCapturedArtifact } from "../../src/research/contracts";
import {
  buildCitySafetyQueries,
  buildCitySafetySourcePlan,
  buildOfficialAuthorityDirectory,
} from "../../src/research/city-safety-source-plan";
import type { TerminalEvidenceEntry } from "../../src/research/research-plan";
import { sealEvidencePlan, type EvidenceIntegrity } from "../../src/research/research-plan";
import { SLOVENIA_CITY_FACT_VERSIONS } from "../../src/research/slovenia-city-plan";

const INTEGRITY_KEY = "task-3-city-knowledge-integration-key";
const INTEGRITY = createEvidenceIntegrity(INTEGRITY_KEY);
const CITY_ID = "ljubljana";
const CATALOG_EVIDENCE_ID = "catalog-evidence:synthetic:1";
const BASE_TIME = Date.parse("2026-03-01T00:00:00.000Z");
const databases: Database.Database[] = [];
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) {
    if (database.open) database.close();
  }
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function database(): Database.Database {
  const result = openEvidenceDatabase(":memory:");
  databases.push(result);
  return result;
}

function temporaryDatabasePath(): string {
  const directory = mkdtempSync(join(tmpdir(), "city-knowledge-store-"));
  temporaryDirectories.push(directory);
  return join(directory, "city.sqlite");
}

function at(sequence: number, milliseconds: number): string {
  return new Date(BASE_TIME + sequence * 86_400_000 + milliseconds).toISOString();
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function fixedPlan<S extends SloveniaCityFixedSourceId>(sourceId: S): CityFixedSourcePlan<S> {
  const criterionId = sourceId === "si-city-long-term-rent"
    ? "long_term_rent"
    : sourceId === "si-city-urban-transit" ? "urban_transit" : "fixed_broadband";
  const definitionId = `${sourceId}-definition@1`;
  return {
    planId: `${sourceId}-plan@1`,
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
      unit: sourceId === "si-city-long-term-rent"
        ? "EUR_per_square_metre_per_month"
        : sourceId === "si-city-urban-transit" ? "boolean" : "megabits_per_second",
      denominator: sourceId === "si-city-long-term-rent"
        ? "qualifying_lease_contracts"
        : sourceId === "si-city-urban-transit" ? "city" : "fixed_network_access",
      freshnessPolicyVersion: "annual-calendar@1",
      valueKind: "canonical_scalar",
      valuePolicyVersion: "canonical-scalar@1",
      sourcePeriodPolicyVersion: "annual-period@1",
    },
    routes: [{
      routeId: `${sourceId}-primary`,
      navigationUrl: `https://official.example/${sourceId}`,
    }],
    parserVersion: SLOVENIA_CITY_FACT_VERSIONS[sourceId].parserVersion,
    rulesVersion: SLOVENIA_CITY_FACT_VERSIONS[sourceId].rulesVersion,
  } as unknown as CityFixedSourcePlan<S>;
}

function packageFixture(
  integrity: EvidenceIntegrity = INTEGRITY,
  catalogEvidenceId: string = CATALOG_EVIDENCE_ID,
  catalogRulesVersion: typeof CITY_CATALOG_RULES_VERSION | typeof LEGACY_CITY_CATALOG_RULES_VERSION =
    CITY_CATALOG_RULES_VERSION,
  registryEvidenceId: string = CATALOG_EVIDENCE_ID,
): {
  readonly registry: CityRegistryRevision;
  readonly catalog: CityCatalogRevision;
  readonly contract: CityPackageEvidenceReplayContract;
  readonly fixedPlans: readonly [
    CityFixedSourcePlan<"si-city-long-term-rent">,
    CityFixedSourcePlan<"si-city-urban-transit">,
    CityFixedSourcePlan<"si-city-fixed-broadband">,
  ];
} {
  const registry = buildCityRegistryRevision({
    packageId: "si-cities",
    packageSchemaVersion: "si-cities@1",
    countryCode: "SI",
    evidenceSnapshotId: registryEvidenceId,
    entries: [{
      cityId: CITY_ID,
      countryCode: "SI",
      officialName: "Ljubljana",
      coordinate: { lat: 46.05, lng: 14.51 },
      administrativeType: "central_urban_settlement",
      administrativeTerritory: "Mestna občina Ljubljana",
      capitalRoles: ["national"],
      evidenceReferenceIds: [registryEvidenceId],
    }],
    createdAt: "2026-01-01T00:00:00.000Z",
  }, integrity);
  const catalogInput = {
    registry,
    evidenceSnapshotId: catalogEvidenceId,
    populationDefinition: {
      definitionId: "surs-settlement-population@1",
      geoScope: "settlement",
      unit: "people" as const,
    },
    candidateBasis: [{
      cityId: CITY_ID,
      comparablePopulation: {
        kind: "verified" as const,
        value: "300000",
        referencePeriod: "2026-01-01",
      },
    }],
    coverage: { status: "complete" as const },
    createdAt: "2026-01-01T00:00:00.000Z",
  };
  const catalog = catalogRulesVersion === CITY_CATALOG_RULES_VERSION
    ? buildCityCatalogRevision(catalogInput, integrity)
    : (() => {
        const payload = {
          schemaVersion: "city-catalog@1" as const,
          packageId: registry.packageId,
          packageSchemaVersion: registry.packageSchemaVersion,
          countryCode: registry.countryCode,
          registryRevisionId: registry.id,
          evidenceSnapshotId: catalogEvidenceId,
          populationDefinition: catalogInput.populationDefinition,
          candidateBasis: catalogInput.candidateBasis,
          members: [{
            cityId: CITY_ID,
            inclusionReasons: ["population_threshold", "national_capital"] as const,
          }],
          coverage: catalogInput.coverage,
          rulesVersion: LEGACY_CITY_CATALOG_RULES_VERSION,
          createdAt: catalogInput.createdAt,
        };
        return { id: `city-catalog:${integrity.hash(integrity.canonical(payload))}`, ...payload };
      })();
  const publisher = (
    publisherId: string,
    authorityKind: "police" | "government" | "open_data" | "statistics" | "municipality",
    navigationUrl: string,
  ) => ({
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
  });
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
        navigationUrl: "https://ljubljana.si/safety",
      }],
    }],
  }, integrity);
  const fixedPlans = [
    fixedPlan("si-city-long-term-rent"),
    fixedPlan("si-city-urban-transit"),
    fixedPlan("si-city-fixed-broadband"),
  ] as const;
  const key = Object.freeze({
    countryCode: "SI",
    packageId: "si-cities",
    packageSchemaVersion: "si-cities@1",
    catalogRevisionId: catalog.id,
    evidenceRulesVersion: "si-city-evidence@1",
  });
  return {
    registry,
    catalog,
    fixedPlans,
    contract: {
      installedPackageManifest: Object.freeze({
        id: "installed-city-package:synthetic",
        key,
      }),
      definition: {
        packageId: key.packageId,
        packageSchemaVersion: key.packageSchemaVersion,
        countryCode: key.countryCode,
        evidenceRulesVersion: key.evidenceRulesVersion,
        sourceIds: SLOVENIA_CITY_FACT_SOURCE_IDS,
      },
      catalogProjection: { registry, catalog },
      fixedPlansByCityId: { [CITY_ID]: fixedPlans },
      safetySourcePlan,
      officialAuthorityDirectory,
      validateValue: (input) => input.value,
      validateSourcePeriod: () => "fresh",
    },
  };
}

function replayPort(fixture: ReturnType<typeof packageFixture>): CityEvidencePackageReplayPort {
  return {
    loadExactReplayContract: (key) => INTEGRITY.canonical(key) ===
      INTEGRITY.canonical(fixture.contract.installedPackageManifest.key)
      ? fixture.contract
      : undefined,
  };
}

interface KnowledgeWorkerResult {
  readonly ok: boolean;
  readonly revision?: CityKnowledgeRevision;
  readonly error?: string;
}

function publishInWorker(input: {
  readonly path: string;
  readonly contract: CityPackageEvidenceReplayContract;
  readonly evidenceSnapshotId: string;
  readonly createdAt: string;
  readonly delayMilliseconds?: number;
  readonly startGate?: SharedArrayBuffer;
}): Promise<KnowledgeWorkerResult> {
  const data = {
    installedPackageManifest: input.contract.installedPackageManifest,
    definition: input.contract.definition,
    catalogProjection: input.contract.catalogProjection,
    fixedPlansByCityId: input.contract.fixedPlansByCityId,
    safetySourcePlan: input.contract.safetySourcePlan,
    officialAuthorityDirectory: input.contract.officialAuthorityDirectory,
  };
  const workerSource = `
    import { parentPort, workerData } from "node:worker_threads";
    import Database from ${JSON.stringify(import.meta.resolve("better-sqlite3"))};
    import { createEvidenceIntegrity } from ${JSON.stringify(new URL(
      "../../src/infrastructure/integrity.ts",
      import.meta.url,
    ).href)};
    import { SqliteCityKnowledgeStore } from ${JSON.stringify(new URL(
      "../../src/infrastructure/sqlite/city-knowledge-store.ts",
      import.meta.url,
    ).href)};

    const run = async () => {
      if (workerData.startGate !== undefined) {
        const gate = new Int32Array(workerData.startGate);
        Atomics.add(gate, 0, 1);
        Atomics.notify(gate, 0);
        Atomics.wait(gate, 1, 0);
      }
      if (workerData.delayMilliseconds > 0) {
        await new Promise((resolve) => setTimeout(resolve, workerData.delayMilliseconds));
      }
      const database = new Database(workerData.path);
      database.pragma("foreign_keys = ON");
      database.pragma("busy_timeout = 5000");
      const key = Object.freeze({ ...workerData.contract.installedPackageManifest.key });
      const installedPackageManifest = Object.freeze({
        ...workerData.contract.installedPackageManifest,
        key,
      });
      const contract = {
        ...workerData.contract,
        installedPackageManifest,
        validateValue: (input) => input.value,
        validateSourcePeriod: () => "fresh",
      };
      try {
        const revision = new SqliteCityKnowledgeStore(
          database,
          createEvidenceIntegrity(workerData.integrityKey),
          { loadExactReplayContract: () => contract },
        ).publishFromEvidence(workerData.evidenceSnapshotId, workerData.createdAt);
        parentPort.postMessage({ ok: true, revision });
      } catch (error) {
        parentPort.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) });
      } finally {
        database.close();
      }
    };
    run();
  `;
  return new Promise((resolvePromise, rejectPromise) => {
    const worker = new Worker(new URL(`data:text/javascript,${encodeURIComponent(workerSource)}`), {
      workerData: {
        path: input.path,
        contract: structuredClone(data),
        evidenceSnapshotId: input.evidenceSnapshotId,
        createdAt: input.createdAt,
        delayMilliseconds: input.delayMilliseconds ?? 0,
        startGate: input.startGate,
        integrityKey: INTEGRITY_KEY,
      },
      execArgv: ["--import", "tsx"],
    });
    worker.once("message", (result: KnowledgeWorkerResult) => resolvePromise(result));
    worker.once("error", rejectPromise);
    worker.once("exit", (code) => {
      if (code !== 0) rejectPromise(new Error(`knowledge_worker_exit:${code}`));
    });
  });
}

function context(fixture: ReturnType<typeof packageFixture>, sequence: number): CityEvidenceContext {
  return {
    schemaVersion: "city-evidence-context@1",
    cityCheckRunId: `city-check:si:ljubljana:${sequence}`,
    frontierRunId: "frontier:si:1",
    cityId: CITY_ID,
    countryCode: "SI",
    packageId: "si-cities",
    packageSchemaVersion: "si-cities@1",
    catalogRevisionId: fixture.catalog.id,
    criteriaSnapshotId: "criteria:si:1",
    rankingSnapshotId: `ranking:si:${sequence}`,
    definitionIds: {
      safety: fixture.contract.safetySourcePlan.definitionId,
      long_term_rent: fixture.fixedPlans[0].definitionId,
      urban_transit: fixture.fixedPlans[1].definitionId,
      fixed_broadband: fixture.fixedPlans[2].definitionId,
    },
    evidenceRulesVersion: "si-city-evidence@1",
    assessmentAt: at(sequence, 0),
    completedAt: at(sequence, 43_210_000),
  };
}

function unavailableEntry(
  sourceId: SloveniaCityFactSourceId,
  navigationUrl: string,
  versionHint: string,
): TerminalEvidenceEntry<SloveniaCityFactSourceId, CityEvidenceClaim> {
  return {
    sourceId,
    parserEntry: {
      sourceId,
      navigationUrl,
      resolvedEvidenceUrl: navigationUrl,
      artifacts: [],
      versionHint,
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

function fixedUnknownLedger<S extends SloveniaCityFixedSourceId>(
  plan: CityFixedSourcePlan<S>,
  evidenceContext: CityEvidenceContext,
  offset: number,
): CityFixedAttemptLedger<S> {
  return {
    schemaVersion: "city-fixed-attempt-ledger@1",
    cityCheckRunId: evidenceContext.cityCheckRunId,
    cityId: CITY_ID,
    sourceId: plan.sourceId,
    criterionId: plan.criterionId,
    planId: plan.planId,
    definitionId: plan.definitionId,
    valuePolicyVersion: plan.claimContract.valuePolicyVersion,
    sourcePeriodPolicyVersion: plan.claimContract.sourcePeriodPolicyVersion,
    parserVersion: plan.parserVersion,
    rulesVersion: plan.rulesVersion,
    assessmentAt: evidenceContext.assessmentAt,
    attempts: [{
      cityCheckRunId: evidenceContext.cityCheckRunId,
      sourceId: plan.sourceId,
      index: 0,
      routeId: plan.routes[0]!.routeId,
      navigationUrl: plan.routes[0]!.navigationUrl,
      attemptedAt: evidenceContext.assessmentAt,
      disposition: "rejected",
      reason: "http_not_found",
      artifactIds: [],
    }],
    result: { kind: "unknown", reason: "not_found" },
    completedAt: new Date(Date.parse(evidenceContext.assessmentAt) + offset).toISOString(),
  };
}

function safetyLedger(
  fixture: ReturnType<typeof packageFixture>,
  evidenceContext: CityEvidenceContext,
): CitySafetyAttemptLedger {
  const entry = fixture.contract.safetySourcePlan.entries[0]!;
  const navigationUrl = entry.configuredRoutes[0]!.navigationUrl;
  const queries = buildCitySafetyQueries(
    entry,
    fixture.contract.officialAuthorityDirectory,
    evidenceContext.assessmentAt,
    fixture.catalog,
    INTEGRITY,
  );
  return {
    schemaVersion: "city-safety-attempt-ledger@1",
    catalogRevisionId: fixture.catalog.id,
    authorityDirectoryId: fixture.contract.officialAuthorityDirectory.id,
    sourcePlanId: fixture.contract.safetySourcePlan.id,
    cityId: CITY_ID,
    municipalityCode: entry.municipalityCode,
    assessmentAt: evidenceContext.assessmentAt,
    definitionId: fixture.contract.safetySourcePlan.definitionId,
    freshnessPolicyVersion: fixture.contract.safetySourcePlan.freshnessPolicyVersion,
    discoveryRulesVersion: fixture.contract.safetySourcePlan.discoveryRulesVersion,
    queries: queries.map((query, index) => ({
      index,
      queryId: `city-safety-query:${evidenceContext.cityCheckRunId}:${index + 1}`,
      queryTemplateVersion: "slovenia-municipal-safety-query@1",
      providerId: "synthetic-search",
      query,
      searchedAt: new Date(Date.parse(evidenceContext.assessmentAt) + (index + 2) * 1_000).toISOString(),
      outcome: { kind: "completed", returnedUrls: [] },
    })),
    candidates: [{
      index: 0,
      origin: { kind: "configured", configuredRouteIndex: 0 },
      canonicalUrl: navigationUrl,
      officialTrace: {
        initialUrl: navigationUrl,
        edges: [],
        lastTrustedUrl: navigationUrl,
        officialHops: 0,
        failure: { captureKind: "http_error", responseStatus: 404, responseUrl: navigationUrl },
      },
      artifactRefs: [],
      disposition: "rejected",
      reason: "http_not_found",
    }],
    counters: { queries: 3, candidates: 1, maxOfficialHops: 0 },
    result: { kind: "unknown", reason: "not_found" },
    completedAt: new Date(Date.parse(evidenceContext.assessmentAt) + 6_000).toISOString(),
  };
}

async function verifiedSafetyEvidenceInput(
  fixture: ReturnType<typeof packageFixture>,
  sequence: number,
  prior?: {
    readonly evidenceSnapshotId: string;
    readonly sourcePlanId: string;
  },
): Promise<CityEvidenceSealInput> {
  const evidenceContext = context(fixture, sequence);
  const capturedAt = new Date(Date.parse(evidenceContext.assessmentAt) + 500).toISOString();
  const municipalUrl = "https://ljubljana.si/safety";
  const denominatorUrl = "https://pxweb.stat.si/population";
  const artifact = (
    artifactId: string,
    role: "municipal_source" | "surs_denominator",
    url: string,
    contents: string,
    request: LiveCapturedArtifact<"si-city-safety">["request"],
  ): LiveCapturedArtifact<"si-city-safety"> => {
    const bytes = new TextEncoder().encode(contents);
    return {
      artifactId,
      runId: evidenceContext.cityCheckRunId,
      sourceId: "si-city-safety",
      role,
      url,
      mediaType: "application/pdf",
      sha256: sha256(bytes),
      bytes,
      origin: "live",
      capturedAt,
      responseStatus: 200,
      responseUrl: url,
      request,
    };
  };
  const municipal = artifact(
    `${evidenceContext.cityCheckRunId}:municipal-safety`,
    "municipal_source",
    municipalUrl,
    `municipal safety ${String(sequence)}`,
    { method: "GET", url: municipalUrl },
  );
  const denominator = artifact(
    `${evidenceContext.cityCheckRunId}:population`,
    "surs_denominator",
    denominatorUrl,
    `population ${String(sequence)}`,
    {
      method: "POST",
      url: denominatorUrl,
      bodyMediaType: "application/json",
      bodySha256: "c".repeat(64),
    },
  );
  const references = [{
    role: "municipal_source" as const,
    documentRole: "terminal_claim" as const,
    artifactId: municipal.artifactId,
    artifactSha256: municipal.sha256,
    sourceSha256: municipal.sha256,
    locator: municipalUrl,
  }, {
    role: "surs_denominator" as const,
    artifactId: denominator.artifactId,
    artifactSha256: denominator.sha256,
    sourceSha256: denominator.sha256,
    locator: denominatorUrl,
  }] satisfies readonly CitySafetyArtifactReference[];
  const quantity = {
    offenceCount: "1200",
    population: "300000",
    rateBasis: "offences_per_100000_residents" as const,
  };
  const ledger: CitySafetyAttemptLedger = {
    schemaVersion: "city-safety-attempt-ledger@1",
    catalogRevisionId: fixture.catalog.id,
    authorityDirectoryId: fixture.contract.officialAuthorityDirectory.id,
    sourcePlanId: fixture.contract.safetySourcePlan.id,
    cityId: CITY_ID,
    municipalityCode: "061",
    assessmentAt: evidenceContext.assessmentAt,
    definitionId: fixture.contract.safetySourcePlan.definitionId,
    freshnessPolicyVersion: fixture.contract.safetySourcePlan.freshnessPolicyVersion,
    discoveryRulesVersion: fixture.contract.safetySourcePlan.discoveryRulesVersion,
    queries: [],
    candidates: [{
      index: 0,
      origin: prior === undefined
        ? { kind: "configured", configuredRouteIndex: 0 }
        : {
            kind: "previous",
            priorSourcePlanId: prior.sourcePlanId,
            priorEvidenceSnapshotId: prior.evidenceSnapshotId,
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
      disposition: "usable",
      referenceYear: 2025,
      periodDisposition: "preferred",
      quantity,
      denominator: {
        publisherId: "surs",
        municipalityCode: "061",
        referenceDate: "2025-01-01",
        population: "300000",
        artifactId: denominator.artifactId,
        mediaType: "application/pdf",
        retentionPolicyId: "surs-retention@1",
        transientRawDeleted: false,
      },
    }],
    counters: { queries: 0, candidates: 1, maxOfficialHops: 0 },
    result: { kind: "verified", quantity, referenceYear: 2025, acceptedCandidateIndex: 0 },
    completedAt: new Date(Date.parse(evidenceContext.assessmentAt) + 4_000).toISOString(),
  };
  const safetyEntry = citySafetyTerminalEntry({
    cityCheckRunId: evidenceContext.cityCheckRunId,
    ledger,
    artifacts: [municipal, denominator],
    sourcePlan: fixture.contract.safetySourcePlan,
    authorityDirectory: fixture.contract.officialAuthorityDirectory,
  });
  const genericEvidence = await sealEvidencePlan({
    id: `${evidenceContext.cityCheckRunId}:evidence`,
    assessmentDate: evidenceContext.assessmentAt.slice(0, 10),
    entries: [
      safetyEntry,
      ...fixture.fixedPlans.map((plan) => unavailableEntry(
        plan.sourceId,
        plan.routes[0]!.navigationUrl,
        plan.parserVersion,
      )),
    ],
    sourceIds: SLOVENIA_CITY_FACT_SOURCE_IDS,
    parserVersions: {
      "si-city-safety": SLOVENIA_CITY_FACT_VERSIONS["si-city-safety"].parserVersion,
      "si-city-long-term-rent": fixture.fixedPlans[0].parserVersion,
      "si-city-urban-transit": fixture.fixedPlans[1].parserVersion,
      "si-city-fixed-broadband": fixture.fixedPlans[2].parserVersion,
    },
    rulesVersion: evidenceContext.evidenceRulesVersion,
    contextHash: cityEvidenceContextHash(evidenceContext, INTEGRITY),
  }, INTEGRITY);
  return {
    ...evidenceContext,
    genericEvidence,
    artifacts: [municipal, denominator],
    fixedAttemptLedgers: [
      fixedUnknownLedger(fixture.fixedPlans[0], evidenceContext, 1_000),
      fixedUnknownLedger(fixture.fixedPlans[1], evidenceContext, 2_000),
      fixedUnknownLedger(fixture.fixedPlans[2], evidenceContext, 3_000),
    ],
    safetyAttemptLedger: ledger,
  };
}

function verifiedRent(
  plan: CityFixedSourcePlan<"si-city-long-term-rent">,
  evidenceContext: CityEvidenceContext,
): {
  readonly entry: TerminalEvidenceEntry<SloveniaCityFactSourceId, CityEvidenceClaim>;
  readonly artifact: LiveCapturedArtifact<"si-city-long-term-rent">;
  readonly ledger: CityFixedAttemptLedger<"si-city-long-term-rent">;
} {
  const resolvedEvidenceUrl = `${plan.routes[0]!.navigationUrl}/resolved`;
  const bytes = new TextEncoder().encode(`verified rent ${evidenceContext.cityCheckRunId}`);
  const artifact: LiveCapturedArtifact<"si-city-long-term-rent"> = {
    artifactId: `${evidenceContext.cityCheckRunId}:rent-artifact`,
    runId: evidenceContext.cityCheckRunId,
    sourceId: plan.sourceId,
    role: "official_dataset",
    url: resolvedEvidenceUrl,
    mediaType: "application/json",
    sha256: sha256(bytes),
    bytes,
    origin: "live",
    capturedAt: new Date(Date.parse(evidenceContext.assessmentAt) + 500).toISOString(),
    responseStatus: 200,
    responseUrl: resolvedEvidenceUrl,
    request: { method: "GET", url: plan.routes[0]!.navigationUrl },
  };
  const claim: CityFixedEvidenceClaim<"si-city-long-term-rent"> = {
    claimId: `${evidenceContext.cityCheckRunId}:rent-claim`,
    sourceId: plan.sourceId,
    value: { kind: "canonical_scalar", value: "9.5" },
    scope: plan.claimContract.scope,
    sourcePeriod: "2025",
    anchor: { artifactId: artifact.artifactId, locator: artifact.url, excerptSha256: artifact.sha256 },
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
    artifact,
    entry: {
      sourceId: plan.sourceId,
      parserEntry: {
        sourceId: plan.sourceId,
        navigationUrl: plan.routes[0]!.navigationUrl,
        resolvedEvidenceUrl,
        artifacts: [artifact],
        versionHint: plan.parserVersion,
      },
      coverage: "verified",
      claims: [claim],
    },
    ledger: {
      schemaVersion: "city-fixed-attempt-ledger@1",
      cityCheckRunId: evidenceContext.cityCheckRunId,
      cityId: CITY_ID,
      sourceId: plan.sourceId,
      criterionId: plan.criterionId,
      planId: plan.planId,
      definitionId: plan.definitionId,
      valuePolicyVersion: plan.claimContract.valuePolicyVersion,
      sourcePeriodPolicyVersion: plan.claimContract.sourcePeriodPolicyVersion,
      parserVersion: plan.parserVersion,
      rulesVersion: plan.rulesVersion,
      assessmentAt: evidenceContext.assessmentAt,
      attempts: [{
        cityCheckRunId: evidenceContext.cityCheckRunId,
        sourceId: plan.sourceId,
        index: 0,
        routeId: plan.routes[0]!.routeId,
        navigationUrl: plan.routes[0]!.navigationUrl,
        resolvedEvidenceUrl,
        attemptedAt: evidenceContext.assessmentAt,
        disposition: "accepted",
        artifactIds: [artifact.artifactId],
        claimIds: [claim.claimId],
      }],
      result: { kind: "verified", claimIds: [claim.claimId] },
      completedAt: new Date(Date.parse(evidenceContext.assessmentAt) + 1_000).toISOString(),
    },
  };
}

async function evidenceInput(
  fixture: ReturnType<typeof packageFixture>,
  sequence: number,
  rent: "verified" | "unknown",
): Promise<CityEvidenceSealInput> {
  const evidenceContext = context(fixture, sequence);
  const rentVerified = verifiedRent(fixture.fixedPlans[0], evidenceContext);
  const entries: TerminalEvidenceEntry<SloveniaCityFactSourceId, CityEvidenceClaim>[] = [
    unavailableEntry(
      "si-city-safety",
      fixture.contract.safetySourcePlan.entries[0]!.configuredRoutes[0]!.navigationUrl,
      SLOVENIA_CITY_FACT_VERSIONS["si-city-safety"].parserVersion,
    ),
    rent === "verified" ? rentVerified.entry : unavailableEntry(
      fixture.fixedPlans[0].sourceId,
      fixture.fixedPlans[0].routes[0]!.navigationUrl,
      fixture.fixedPlans[0].parserVersion,
    ),
    unavailableEntry(
      fixture.fixedPlans[1].sourceId,
      fixture.fixedPlans[1].routes[0]!.navigationUrl,
      fixture.fixedPlans[1].parserVersion,
    ),
    unavailableEntry(
      fixture.fixedPlans[2].sourceId,
      fixture.fixedPlans[2].routes[0]!.navigationUrl,
      fixture.fixedPlans[2].parserVersion,
    ),
  ];
  const genericEvidence = await sealEvidencePlan({
    id: `${evidenceContext.cityCheckRunId}:evidence`,
    assessmentDate: evidenceContext.assessmentAt.slice(0, 10),
    entries,
    sourceIds: SLOVENIA_CITY_FACT_SOURCE_IDS,
    parserVersions: {
      "si-city-safety": SLOVENIA_CITY_FACT_VERSIONS["si-city-safety"].parserVersion,
      "si-city-long-term-rent": fixture.fixedPlans[0].parserVersion,
      "si-city-urban-transit": fixture.fixedPlans[1].parserVersion,
      "si-city-fixed-broadband": fixture.fixedPlans[2].parserVersion,
    },
    rulesVersion: evidenceContext.evidenceRulesVersion,
    contextHash: cityEvidenceContextHash(evidenceContext, INTEGRITY),
  }, INTEGRITY);
  return {
    ...evidenceContext,
    genericEvidence,
    artifacts: rent === "verified" ? [rentVerified.artifact] : [],
    fixedAttemptLedgers: [
      rent === "verified"
        ? rentVerified.ledger
        : fixedUnknownLedger(fixture.fixedPlans[0], evidenceContext, 1_000),
      fixedUnknownLedger(fixture.fixedPlans[1], evidenceContext, 2_000),
      fixedUnknownLedger(fixture.fixedPlans[2], evidenceContext, 3_000),
    ],
    safetyAttemptLedger: safetyLedger(fixture, evidenceContext),
  };
}

async function seedEvidence(
  db: Database.Database,
  fixture: ReturnType<typeof packageFixture>,
  sequence: number,
  rent: "verified" | "unknown",
): Promise<ReturnType<SqliteCityEvidenceStore["seal"]>> {
  return new SqliteCityEvidenceStore(db, INTEGRITY, replayPort(fixture))
    .seal(await evidenceInput(fixture, sequence, rent));
}

function contractWithCatalogRules(
  value: CityPackageEvidenceReplayContract,
  rulesVersion: string,
): CityPackageEvidenceReplayContract {
  const contract = structuredClone({
    installedPackageManifest: value.installedPackageManifest,
    definition: value.definition,
    catalogProjection: value.catalogProjection,
    fixedPlansByCityId: value.fixedPlansByCityId,
    safetySourcePlan: value.safetySourcePlan,
    officialAuthorityDirectory: value.officialAuthorityDirectory,
  });
  const { id: _catalogId, ...catalogBase } = contract.catalogProjection.catalog;
  void _catalogId;
  const catalogPayload = { ...catalogBase, rulesVersion };
  const catalog = {
    id: `city-catalog:${INTEGRITY.hash(INTEGRITY.canonical(catalogPayload))}`,
    ...catalogPayload,
  } as CityCatalogRevision;
  const { id: _directoryId, ...directoryBase } = contract.officialAuthorityDirectory;
  void _directoryId;
  const directoryPayload = { ...directoryBase, catalogRevisionId: catalog.id };
  const officialAuthorityDirectory = {
    id: `official-authority-directory:${INTEGRITY.hash(INTEGRITY.canonical(directoryPayload))}`,
    ...directoryPayload,
  };
  const { id: _sourcePlanId, ...sourcePlanBase } = contract.safetySourcePlan;
  void _sourcePlanId;
  const sourcePlanPayload = {
    ...sourcePlanBase,
    catalogRevisionId: catalog.id,
    authorityDirectoryId: officialAuthorityDirectory.id,
  };
  const safetySourcePlan = {
    id: `city-safety-source-plan:${INTEGRITY.hash(INTEGRITY.canonical(sourcePlanPayload))}`,
    ...sourcePlanPayload,
  };
  return {
    ...value,
    installedPackageManifest: Object.freeze({
      id: `${value.installedPackageManifest.id}:${rulesVersion}`,
      key: Object.freeze({
        ...value.installedPackageManifest.key,
        catalogRevisionId: catalog.id,
      }),
    }),
    catalogProjection: { registry: contract.catalogProjection.registry, catalog },
    officialAuthorityDirectory,
    safetySourcePlan,
  } as CityPackageEvidenceReplayContract;
}

function rebindEvidenceInput(
  value: CityEvidenceSealInput,
  contract: CityPackageEvidenceReplayContract,
): CityEvidenceSealInput {
  const input = structuredClone(value);
  const mutableInput = input as unknown as Record<string, unknown>;
  const ledger = input.safetyAttemptLedger as unknown as Record<string, unknown>;
  mutableInput.catalogRevisionId = contract.catalogProjection.catalog.id;
  ledger.catalogRevisionId = contract.catalogProjection.catalog.id;
  ledger.authorityDirectoryId = contract.officialAuthorityDirectory.id;
  ledger.sourcePlanId = contract.safetySourcePlan.id;
  const evidenceContext: CityEvidenceContext = {
    schemaVersion: input.schemaVersion,
    cityCheckRunId: input.cityCheckRunId,
    frontierRunId: input.frontierRunId,
    cityId: input.cityId,
    countryCode: input.countryCode,
    packageId: input.packageId,
    packageSchemaVersion: input.packageSchemaVersion,
    catalogRevisionId: input.catalogRevisionId,
    criteriaSnapshotId: input.criteriaSnapshotId,
    rankingSnapshotId: input.rankingSnapshotId,
    definitionIds: input.definitionIds,
    evidenceRulesVersion: input.evidenceRulesVersion,
    assessmentAt: input.assessmentAt,
    completedAt: input.completedAt,
  };
  const snapshot = input.genericEvidence.snapshot as unknown as Record<string, unknown>;
  const manifest = input.genericEvidence.manifest as unknown as Record<string, unknown>;
  snapshot.contextHash = cityEvidenceContextHash(evidenceContext, INTEGRITY);
  manifest.snapshot = Object.fromEntries(Object.entries(structuredClone(input.genericEvidence.snapshot))
    .filter(([key]) => key !== "manifestHash" && key !== "hmac"));
  const canonicalManifest = INTEGRITY.canonical(input.genericEvidence.manifest);
  (input.genericEvidence as unknown as Record<string, unknown>).canonicalManifest = canonicalManifest;
  snapshot.manifestHash = INTEGRITY.hash(canonicalManifest);
  snapshot.hmac = INTEGRITY.sign(canonicalManifest);
  return input;
}

function insertAuthenticatedEvidence(
  db: Database.Database,
  input: CityEvidenceSealInput,
): CityEvidencePayload {
  insertSealedEvidence(db, input.genericEvidence, INTEGRITY);
  const evidenceContext: CityEvidenceContext = {
    schemaVersion: input.schemaVersion,
    cityCheckRunId: input.cityCheckRunId,
    frontierRunId: input.frontierRunId,
    cityId: input.cityId,
    countryCode: input.countryCode,
    packageId: input.packageId,
    packageSchemaVersion: input.packageSchemaVersion,
    catalogRevisionId: input.catalogRevisionId,
    criteriaSnapshotId: input.criteriaSnapshotId,
    rankingSnapshotId: input.rankingSnapshotId,
    definitionIds: input.definitionIds,
    evidenceRulesVersion: input.evidenceRulesVersion,
    assessmentAt: input.assessmentAt,
    completedAt: input.completedAt,
  };
  const payload: CityEvidencePayload = {
    schemaVersion: "city-evidence@1",
    id: `${input.cityCheckRunId}:evidence`,
    cityCheckRunId: input.cityCheckRunId,
    frontierRunId: input.frontierRunId,
    cityId: input.cityId,
    countryCode: input.countryCode,
    packageId: input.packageId,
    packageSchemaVersion: input.packageSchemaVersion,
    catalogRevisionId: input.catalogRevisionId,
    criteriaSnapshotId: input.criteriaSnapshotId,
    rankingSnapshotId: input.rankingSnapshotId,
    definitionIds: structuredClone(input.definitionIds),
    evidenceRulesVersion: input.evidenceRulesVersion,
    assessmentAt: input.assessmentAt,
    fixedAttemptLedgers: structuredClone(input.fixedAttemptLedgers),
    safetyAttemptLedger: structuredClone(input.safetyAttemptLedger),
    contextHash: cityEvidenceContextHash(evidenceContext, INTEGRITY),
    completedAt: input.completedAt,
  };
  const canonical = INTEGRITY.canonical(payload);
  db.prepare(`
    INSERT INTO city_evidence_snapshots (
      id, city_check_run_id, frontier_run_id, city_id, country_code, package_id,
      package_schema_version, catalog_revision_id, criteria_snapshot_id, ranking_snapshot_id,
      evidence_rules_version, context_hash, assessment_at, completed_at, canonical_payload,
      payload_hash, hmac
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    payload.id, payload.cityCheckRunId, payload.frontierRunId, payload.cityId,
    payload.countryCode, payload.packageId, payload.packageSchemaVersion,
    payload.catalogRevisionId, payload.criteriaSnapshotId, payload.rankingSnapshotId,
    payload.evidenceRulesVersion, payload.contextHash, payload.assessmentAt,
    payload.completedAt, canonical, INTEGRITY.hash(canonical), INTEGRITY.sign(canonical),
  );
  return payload;
}

function insertAuthenticatedKnowledge(
  db: Database.Database,
  revision: CityKnowledgeRevision,
): void {
  const canonical = INTEGRITY.canonical(revision);
  db.prepare(`
    INSERT INTO city_knowledge_revisions (
      id, city_id, country_code, package_id, package_schema_version, rules_version,
      predecessor_id, evidence_snapshot_id, last_checked_at, knowledge_updated_at,
      created_at, payload_json, payload_hash, hmac
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    revision.id, revision.cityId, revision.countryCode, revision.packageId,
    revision.packageSchemaVersion, revision.rulesVersion,
    revision.predecessorRevisionId ?? null, revision.evidenceSnapshotId,
    revision.lastCheckedAt, revision.knowledgeUpdatedAt, revision.createdAt,
    canonical, INTEGRITY.hash(canonical), INTEGRITY.sign(canonical),
  );
}

function knowledgeContracts(
  fixture: ReturnType<typeof packageFixture>,
): CityKnowledgeFactContractTuple {
  const safetyEntry = fixture.contract.safetySourcePlan.entries.find(({ cityId }) => cityId === CITY_ID);
  if (safetyEntry === undefined) throw new Error("missing_safety_entry");
  const safety = {
    sourceId: SLOVENIA_CITY_SAFETY_FACT_CONTRACT.sourceId,
    criterionId: SLOVENIA_CITY_SAFETY_FACT_CONTRACT.criterionId,
    definitionId: fixture.contract.safetySourcePlan.definitionId,
    scope: `municipality:${safetyEntry.municipalityCode}`,
    geoScope: SLOVENIA_CITY_SAFETY_FACT_CONTRACT.geoScope,
    officialAreaId: safetyEntry.municipalityCode,
    unit: SLOVENIA_CITY_SAFETY_FACT_CONTRACT.unit,
    denominator: SLOVENIA_CITY_SAFETY_FACT_CONTRACT.denominator,
    freshnessPolicyVersion: fixture.contract.safetySourcePlan.freshnessPolicyVersion,
  } as const;
  const fixed = fixture.fixedPlans.map(({ claimContract }) => ({
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
  return [safety, fixed[0]!, fixed[1]!, fixed[2]!] as CityKnowledgeFactContractTuple;
}

function count(db: Database.Database, table: string): number {
  return (db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { readonly count: number }).count;
}

function expectRecursivelyFrozen(value: unknown, seen = new Set<object>()): void {
  if (value === null || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  expect(Object.isFrozen(value)).toBe(true);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    expect(descriptor).toBeDefined();
    expect(descriptor !== undefined && "value" in descriptor).toBe(true);
    if (descriptor !== undefined && "value" in descriptor) {
      expectRecursivelyFrozen(descriptor.value, seen);
    }
  }
}

function captureError(action: () => unknown): Error {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    return error as Error;
  }
  throw new Error("expected_error");
}

function catalogProjection(fixture: ReturnType<typeof packageFixture>): CityCatalogProjection {
  return { registry: fixture.registry, catalog: fixture.catalog };
}

function historicalCatalog(fixture: ReturnType<typeof packageFixture>): CityCatalogRevision {
  const payload = {
    schemaVersion: "city-catalog@1" as const,
    packageId: fixture.catalog.packageId,
    packageSchemaVersion: fixture.catalog.packageSchemaVersion,
    countryCode: fixture.catalog.countryCode,
    registryRevisionId: fixture.registry.id,
    evidenceSnapshotId: fixture.registry.evidenceSnapshotId,
    populationDefinition: fixture.catalog.populationDefinition,
    candidateBasis: fixture.catalog.candidateBasis,
    members: [{
      cityId: CITY_ID,
      inclusionReasons: ["population_threshold", "national_capital"] as const,
    }],
    coverage: fixture.catalog.coverage,
    rulesVersion: LEGACY_CITY_CATALOG_RULES_VERSION,
    createdAt: fixture.catalog.createdAt,
  };
  return { id: `city-catalog:${INTEGRITY.hash(INTEGRITY.canonical(payload))}`, ...payload };
}

function resignKnowledgeRevision(
  db: Database.Database,
  id: string,
  mutate: (revision: CityKnowledgeRevision) => Omit<CityKnowledgeRevision, "id">,
): string {
  const stored = db.prepare(
    "SELECT payload_json FROM city_knowledge_revisions WHERE id = ?",
  ).pluck().get(id) as string;
  const revision = JSON.parse(stored) as CityKnowledgeRevision;
  const payload = mutate(revision);
  const changedId = `city-knowledge:${INTEGRITY.hash(INTEGRITY.canonical(payload))}`;
  const changed: CityKnowledgeRevision = { id: changedId, ...payload };
  const canonical = INTEGRITY.canonical(changed);
  db.prepare(`
    UPDATE city_knowledge_revisions SET
      id = ?, city_id = ?, country_code = ?, package_id = ?, package_schema_version = ?,
      rules_version = ?, predecessor_id = ?, evidence_snapshot_id = ?, last_checked_at = ?,
      knowledge_updated_at = ?, created_at = ?, payload_json = ?, payload_hash = ?, hmac = ?
    WHERE id = ?
  `).run(
    changed.id,
    changed.cityId,
    changed.countryCode,
    changed.packageId,
    changed.packageSchemaVersion,
    changed.rulesVersion,
    changed.predecessorRevisionId ?? null,
    changed.evidenceSnapshotId,
    changed.lastCheckedAt,
    changed.knowledgeUpdatedAt,
    changed.createdAt,
    canonical,
    INTEGRITY.hash(canonical),
    INTEGRITY.sign(canonical),
    id,
  );
  return changed.id;
}

function knowledgePayload(revision: CityKnowledgeRevision): Omit<CityKnowledgeRevision, "id"> {
  return {
    schemaVersion: revision.schemaVersion,
    cityId: revision.cityId,
    countryCode: revision.countryCode,
    packageId: revision.packageId,
    packageSchemaVersion: revision.packageSchemaVersion,
    rulesVersion: revision.rulesVersion,
    ...(revision.predecessorRevisionId === undefined
      ? {}
      : { predecessorRevisionId: revision.predecessorRevisionId }),
    evidenceSnapshotId: revision.evidenceSnapshotId,
    facts: revision.facts,
    lastCheckedAt: revision.lastCheckedAt,
    knowledgeUpdatedAt: revision.knowledgeUpdatedAt,
    createdAt: revision.createdAt,
  };
}

describe("SQLite City Catalog store", () => {
  test("persists and reloads only a structurally verified current projection", () => {
    // Break caught: treating Catalog persistence as official-source certification or returning caller aliases.
    const db = database();
    const fixture = packageFixture();
    const store: CityCatalogStorePort = new SqliteCityCatalogStore(db, INTEGRITY);
    const input = structuredClone(catalogProjection(fixture));
    const appended = store.appendVerified(input);
    const loaded = store.loadVerified(fixture.catalog.id);

    expect(appended).toEqual(catalogProjection(fixture));
    expect(loaded).toEqual(appended);
    expect(appended).not.toBe(input);
    expect(loaded).not.toBe(appended);
    expect(Object.isFrozen(loaded.registry.entries)).toBe(true);
    expect(store.appendVerified(input)).toEqual(appended);
    expect(count(db, "city_catalog_revisions")).toBe(1);
    expect(db.prepare("PRAGMA foreign_key_list(city_catalog_revisions)").all()).toEqual([]);
    expect(Object.keys(loaded)).toEqual(["registry", "catalog"]);
    expect(JSON.stringify(loaded)).not.toContain("officialSource");
  });

  test("rejects fully rehashed mixed Registry/Catalog Evidence IDs before writing", () => {
    // Break caught: trusting two independently valid roots that cite different Evidence snapshots.
    const db = database();
    const fixture = packageFixture();
    const mixedCatalog = buildCityCatalogRevision({
      registry: fixture.registry,
      evidenceSnapshotId: "catalog-evidence:synthetic:mixed",
      populationDefinition: fixture.catalog.populationDefinition,
      candidateBasis: fixture.catalog.candidateBasis,
      coverage: fixture.catalog.coverage,
      createdAt: fixture.catalog.createdAt,
    }, INTEGRITY);

    expect(() => new SqliteCityCatalogStore(db, INTEGRITY).appendVerified({
      registry: fixture.registry,
      catalog: mixedCatalog,
    })).toThrow("integrity_mismatch");
    expect(count(db, "city_catalog_revisions")).toBe(0);
  });

  test("loads exact historical rules but never appends them as current", () => {
    // Break caught: applying current membership to a historical row or allowing a legacy write path.
    const db = database();
    const fixture = packageFixture();
    const historical = historicalCatalog(fixture);
    const projection = { registry: fixture.registry, catalog: historical };
    const payload = INTEGRITY.canonical(projection);
    db.prepare(`
      INSERT INTO city_catalog_revisions (
        id, registry_revision_id, country_code, package_id, package_schema_version,
        registry_evidence_snapshot_id, catalog_evidence_snapshot_id, rules_version,
        created_at, payload_json, payload_hash, hmac
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      historical.id,
      fixture.registry.id,
      fixture.registry.countryCode,
      fixture.registry.packageId,
      fixture.registry.packageSchemaVersion,
      fixture.registry.evidenceSnapshotId,
      historical.evidenceSnapshotId,
      historical.rulesVersion,
      historical.createdAt,
      payload,
      INTEGRITY.hash(payload),
      INTEGRITY.sign(payload),
    );
    const store = new SqliteCityCatalogStore(db, INTEGRITY);

    expect(store.loadVerified(historical.id)).toEqual(projection);
    expect(() => store.appendVerified(projection)).toThrow("city_catalog_upgrade_required");
    expect(count(db, "city_catalog_revisions")).toBe(1);
  });

  test("fails closed for persisted Evidence inequality, mirror, canonical, hash, HMAC, and ID drift", () => {
    // Break caught: authenticating only the nested projection while trusting mutable SQL mirrors/envelope fields.
    const mutations = [
      { sql: "catalog_evidence_snapshot_id = 'different-evidence'" },
      { sql: "registry_revision_id = 'different-registry'" },
      { sql: "country_code = 'ZZ'" },
      { sql: "payload_json = payload_json || ' '" },
      { sql: `payload_hash = '${"0".repeat(64)}'` },
      { sql: `hmac = '${"0".repeat(64)}'` },
      { sql: "id = 'city-catalog:forged'", loadId: "city-catalog:forged" },
    ];
    for (const mutation of mutations) {
      const db = database();
      const fixture = packageFixture();
      const store = new SqliteCityCatalogStore(db, INTEGRITY);
      store.appendVerified(catalogProjection(fixture));
      db.exec("DROP TRIGGER city_catalog_revisions_no_update");
      db.exec(`UPDATE city_catalog_revisions SET ${mutation.sql}`);
      expect(() => store.loadVerified(mutation.loadId ?? fixture.catalog.id)).toThrow("integrity_mismatch");
    }
  });

  test("does not converge a same-ID different-payload collision", () => {
    // Break caught: treating a hash collision as an exact Catalog retry.
    const db = database();
    const collisionIntegrity: EvidenceIntegrity = {
      canonical: INTEGRITY.canonical,
      hash: () => "a".repeat(64),
      sign: INTEGRITY.sign,
    };
    const first = packageFixture(collisionIntegrity);
    const secondRegistry = buildCityRegistryRevision({
      packageId: first.registry.packageId,
      packageSchemaVersion: first.registry.packageSchemaVersion,
      countryCode: first.registry.countryCode,
      evidenceSnapshotId: first.registry.evidenceSnapshotId,
      entries: [{ ...first.registry.entries[0]!, officialName: "Changed Ljubljana" }],
      createdAt: first.registry.createdAt,
    }, collisionIntegrity);
    const secondCatalog = buildCityCatalogRevision({
      registry: secondRegistry,
      evidenceSnapshotId: secondRegistry.evidenceSnapshotId,
      populationDefinition: first.catalog.populationDefinition,
      candidateBasis: first.catalog.candidateBasis,
      coverage: first.catalog.coverage,
      createdAt: first.catalog.createdAt,
    }, collisionIntegrity);
    const store = new SqliteCityCatalogStore(db, collisionIntegrity);
    store.appendVerified(catalogProjection(first));

    expect(() => store.appendVerified({ registry: secondRegistry, catalog: secondCatalog }))
      .toThrow("integrity_mismatch");
    expect(count(db, "city_catalog_revisions")).toBe(1);
  });

  test("reloads Catalog and the complete Knowledge chain through fresh adapters after restart", async () => {
    // Break caught: relying on in-memory aliases or connection-local state instead of persisted verification.
    const path = temporaryDatabasePath();
    const fixture = packageFixture();
    const firstConnection = openEvidenceDatabase(path);
    new SqliteCityCatalogStore(firstConnection, INTEGRITY).appendVerified(catalogProjection(fixture));
    const firstEvidence = await seedEvidence(firstConnection, fixture, 0, "unknown");
    const secondEvidence = await seedEvidence(firstConnection, fixture, 1, "unknown");
    const writer = new SqliteCityKnowledgeStore(firstConnection, INTEGRITY, replayPort(fixture));
    writer.publishFromEvidence(firstEvidence.id, at(0, 50_000_000));
    const head = writer.publishFromEvidence(secondEvidence.id, at(1, 50_000_000));
    firstConnection.close();

    const reopened = openEvidenceDatabase(path);
    databases.push(reopened);
    const restartedFixture = packageFixture();
    const catalogStore = new SqliteCityCatalogStore(reopened, INTEGRITY);
    const firstCatalogLoad = catalogStore.loadVerified(restartedFixture.catalog.id);
    const secondCatalogLoad = catalogStore.loadVerified(restartedFixture.catalog.id);
    expect(firstCatalogLoad).toEqual(catalogProjection(restartedFixture));
    expect(secondCatalogLoad).toEqual(firstCatalogLoad);
    expect(secondCatalogLoad).not.toBe(firstCatalogLoad);
    expect(Object.isFrozen(secondCatalogLoad.catalog.members)).toBe(true);

    const reader = new SqliteCityKnowledgeStore(reopened, INTEGRITY, replayPort(restartedFixture));
    const latest = reader.latestVerified(CITY_ID);
    const loaded = reader.loadVerified(head.id);
    const found = reader.findByEvidenceVerified(secondEvidence.id);
    expect(latest).toEqual(head);
    expect(loaded).toEqual(head);
    expect(found).toEqual(head);
    expect(reader.latestVerified(CITY_ID)).not.toBe(latest);
    expect(reader.loadVerified(head.id)).not.toBe(loaded);
    expect(reader.findByEvidenceVerified(secondEvidence.id)).not.toBe(found);
    expect(Object.isFrozen(latest?.facts[0]?.evidenceRefs)).toBe(true);
  });
});

describe("SQLite City Knowledge store", () => {
  test("reads authenticated @1 Knowledge, rejects @1 writes and unknown rules without poisoning @2", async () => {
    // Break caught: sharing the current write gate with the closed historical read reconstructor.
    const currentFixture = packageFixture();
    const currentDb = database();
    const currentEvidence = await seedEvidence(currentDb, currentFixture, 0, "unknown");
    const currentStore = new SqliteCityKnowledgeStore(
      currentDb,
      INTEGRITY,
      replayPort(currentFixture),
    );
    const currentRevision = currentStore.publishFromEvidence(currentEvidence.id, at(0, 50_000_000));

    const legacyFixture = packageFixture(
      INTEGRITY,
      CATALOG_EVIDENCE_ID,
      LEGACY_CITY_CATALOG_RULES_VERSION,
    );
    const legacyInput = await evidenceInput(legacyFixture, 0, "unknown");
    const legacyDb = database();
    const legacyEvidencePayload = insertAuthenticatedEvidence(legacyDb, legacyInput);
    const verifiedLegacyGeneric = loadVerifiedEvidenceBundle<
      SloveniaCityFactSourceId,
      CityEvidenceClaim
    >(
      legacyDb,
      legacyInput.genericEvidence.snapshot.id,
      INTEGRITY,
      {
        assessmentDate: legacyEvidencePayload.assessmentAt.slice(0, 10),
        rulesVersion: legacyEvidencePayload.evidenceRulesVersion,
      },
    );
    const legacyRevision = buildCityKnowledgeRevision({
      packageKey: legacyFixture.contract.installedPackageManifest.key,
      evidence: {
        snapshot: legacyEvidencePayload,
        genericEvidence: verifiedLegacyGeneric,
      } as CityKnowledgeEvidenceView,
      factContracts: knowledgeContracts(legacyFixture),
      createdAt: at(0, 50_000_000),
    }, createCityDecisionIntegrityView(INTEGRITY));
    insertAuthenticatedKnowledge(legacyDb, legacyRevision);
    const legacyStore = new SqliteCityKnowledgeStore(
      legacyDb,
      INTEGRITY,
      replayPort(legacyFixture),
    );
    const legacyA = legacyStore.loadVerified(legacyRevision.id);
    const legacyB = legacyStore.loadVerified(legacyRevision.id);
    expect(legacyA).toEqual(legacyRevision);
    expect(legacyB).toEqual(legacyA);
    expect(legacyA).not.toBe(legacyB);
    expect(legacyA.facts).not.toBe(legacyB.facts);
    expectRecursivelyFrozen(legacyA);
    expectRecursivelyFrozen(legacyB);

    const legacyWriteDb = database();
    const legacyEvidence = insertAuthenticatedEvidence(legacyWriteDb, legacyInput);
    const legacyWriter = new SqliteCityKnowledgeStore(
      legacyWriteDb,
      INTEGRITY,
      replayPort(legacyFixture),
    );
    expect(() => legacyWriter.publishFromEvidence(legacyEvidence.id, at(0, 50_000_000)))
      .toThrow("city_catalog_upgrade_required");
    expect(count(legacyWriteDb, "city_knowledge_revisions")).toBe(0);

    const unknownContract = contractWithCatalogRules(legacyFixture.contract, "city-catalog@999");
    const unknownInput = rebindEvidenceInput(legacyInput, unknownContract);
    const unknownDb = database();
    insertAuthenticatedEvidence(unknownDb, unknownInput);
    insertAuthenticatedKnowledge(unknownDb, legacyRevision);
    const unknownStore = new SqliteCityKnowledgeStore(unknownDb, INTEGRITY, {
      loadExactReplayContract: () => unknownContract,
    });
    const unknownA = captureError(() => unknownStore.loadVerified(legacyRevision.id));
    const unknownB = captureError(() => unknownStore.loadVerified(legacyRevision.id));
    expect(unknownA).toEqual(new Error("integrity_mismatch"));
    expect(unknownB).toEqual(new Error("integrity_mismatch"));
    expect(unknownA).not.toBe(unknownB);
    expect(currentStore.loadVerified(currentRevision.id)).toEqual(currentRevision);
  });

  test("rejects an authenticated unknown-rules Evidence publication before Knowledge persistence", async () => {
    // Break caught: classifying unknown rules as an upgrade or writing Knowledge before replay closes them.
    const legacyFixture = packageFixture(
      INTEGRITY,
      CATALOG_EVIDENCE_ID,
      LEGACY_CITY_CATALOG_RULES_VERSION,
    );
    const legacyInput = await evidenceInput(legacyFixture, 0, "unknown");
    const unknownContract = contractWithCatalogRules(
      legacyFixture.contract,
      "city-catalog@999",
    );
    const unknownInput = rebindEvidenceInput(legacyInput, unknownContract);
    expect(unknownContract.catalogProjection.catalog.rulesVersion).toBe("city-catalog@999");
    expect(unknownInput.catalogRevisionId).toBe(unknownContract.catalogProjection.catalog.id);
    expect(unknownInput.safetyAttemptLedger).toMatchObject({
      catalogRevisionId: unknownContract.catalogProjection.catalog.id,
      sourcePlanId: unknownContract.safetySourcePlan.id,
      authorityDirectoryId: unknownContract.officialAuthorityDirectory.id,
    });
    const unknownDb = database();
    const unknownEvidence = insertAuthenticatedEvidence(unknownDb, unknownInput);
    const evidenceRowsBefore = count(unknownDb, "evidence_snapshots");
    const cityEvidenceRowsBefore = count(unknownDb, "city_evidence_snapshots");
    const changesBefore = unknownDb.prepare("SELECT total_changes() AS count").get();
    const replayKeys: unknown[] = [];
    const unknownStore = new SqliteCityKnowledgeStore(unknownDb, INTEGRITY, {
      loadExactReplayContract: (key) => {
        replayKeys.push(structuredClone(key));
        return unknownContract;
      },
    });
    const first = captureError(() =>
      unknownStore.publishFromEvidence(unknownEvidence.id, at(0, 50_000_000)));
    const second = captureError(() =>
      unknownStore.publishFromEvidence(unknownEvidence.id, at(0, 50_000_000)));
    expect(first).toEqual(new Error("integrity_mismatch"));
    expect(second).toEqual(new Error("integrity_mismatch"));
    expect(first).not.toBe(second);
    expect(replayKeys).toEqual([
      unknownContract.installedPackageManifest.key,
      unknownContract.installedPackageManifest.key,
    ]);
    expect(count(unknownDb, "city_knowledge_revisions")).toBe(0);
    expect(count(unknownDb, "evidence_snapshots")).toBe(evidenceRowsBefore);
    expect(count(unknownDb, "city_evidence_snapshots")).toBe(cityEvidenceRowsBefore);
    expect(unknownDb.prepare("SELECT total_changes() AS count").get()).toEqual(changesBefore);

    const healthyFixture = packageFixture();
    const healthyDb = database();
    const healthyEvidence = await seedEvidence(healthyDb, healthyFixture, 0, "unknown");
    const healthyStore = new SqliteCityKnowledgeStore(
      healthyDb,
      INTEGRITY,
      replayPort(healthyFixture),
    );
    const healthy = healthyStore.publishFromEvidence(
      healthyEvidence.id,
      at(0, 50_000_000),
    );
    expect(healthyStore.loadVerified(healthy.id)).toEqual(healthy);
    expect(count(healthyDb, "city_knowledge_revisions")).toBe(1);
  });

  test("publishes four replay-contracted facts inside one immediate Evidence transaction", async () => {
    // Break caught: deriving unknown fact metadata from blockers/callers or replaying after a Knowledge write.
    const db = database();
    const fixture = packageFixture();
    const stableReplay = replayPort(fixture);
    const evidence = await seedEvidence(db, fixture, 0, "unknown");
    const observed: Array<{
      readonly inTransaction: boolean;
      readonly knowledgeRows: number;
      readonly key: unknown;
    }> = [];
    const countedReplay: CityEvidencePackageReplayPort = {
      loadExactReplayContract(key) {
        observed.push({
          inTransaction: db.inTransaction,
          knowledgeRows: count(db, "city_knowledge_revisions"),
          key: structuredClone(key),
        });
        return stableReplay.loadExactReplayContract(key);
      },
    };
    const store: CityKnowledgeStorePort = new SqliteCityKnowledgeStore(db, INTEGRITY, countedReplay);
    const createdAt = at(0, 50_000_000);
    const revision = store.publishFromEvidence(evidence.id, createdAt);

    expect(observed).toEqual([
      {
        inTransaction: true,
        knowledgeRows: 0,
        key: fixture.contract.installedPackageManifest.key,
      },
      {
        inTransaction: true,
        knowledgeRows: 0,
        key: fixture.contract.installedPackageManifest.key,
      },
      {
        inTransaction: true,
        knowledgeRows: 1,
        key: fixture.contract.installedPackageManifest.key,
      },
      {
        inTransaction: true,
        knowledgeRows: 1,
        key: fixture.contract.installedPackageManifest.key,
      },
    ]);
    expect(revision.facts).toEqual([
      expect.objectContaining({
        criterionId: "safety",
        definitionId: fixture.contract.safetySourcePlan.definitionId,
        geoScope: { kind: "municipality", officialAreaId: "061" },
        freshnessBasis: { policyVersion: fixture.contract.safetySourcePlan.freshnessPolicyVersion },
        unit: "offences_per_100000_residents",
        denominator: "municipality_population_january_1",
        outcome: { kind: "unknown", reason: "not_found" },
      }),
      ...fixture.fixedPlans.map((plan) => expect.objectContaining({
        criterionId: plan.criterionId,
        definitionId: plan.claimContract.definitionId,
        geoScope: {
          kind: plan.claimContract.geoScope,
          officialAreaId: plan.claimContract.officialAreaId,
        },
        freshnessBasis: { policyVersion: plan.claimContract.freshnessPolicyVersion },
        unit: plan.claimContract.unit,
        denominator: plan.claimContract.denominator,
        outcome: { kind: "unknown", reason: "not_found" },
      })),
    ]);
    expect(revision.facts.every(({ evidenceRefs }) => evidenceRefs[0]?.kind === "blocker")).toBe(true);
    expect(revision.createdAt).toBe(createdAt);
    const latest = store.latestVerified(CITY_ID);
    const loaded = store.loadVerified(revision.id);
    const found = store.findByEvidenceVerified(evidence.id);
    expect(latest).toEqual(revision);
    expect(loaded).toEqual(revision);
    expect(found).toEqual(revision);
    expect(store.latestVerified(CITY_ID)).not.toBe(latest);
    expect(store.loadVerified(revision.id)).not.toBe(loaded);
    expect(store.findByEvidenceVerified(evidence.id)).not.toBe(found);
    expect(Object.isFrozen(latest?.facts)).toBe(true);
    expect(Object.isFrozen(loaded.facts)).toBe(true);
    expect(Object.isFrozen(found?.facts)).toBe(true);
    expect(Object.isFrozen(revision.facts[0])).toBe(true);
  });

  test("orders verified Evidence and both package replays before the first Knowledge query", async () => {
    // Break caught: querying Knowledge before exact Evidence/replay authority is established in BEGIN IMMEDIATE.
    const path = temporaryDatabasePath();
    const bootstrap = openEvidenceDatabase(path);
    bootstrap.close();
    const trace: string[] = [];
    const db = new Database(path, { verbose: (sql) => trace.push(String(sql)) });
    databases.push(db);
    db.pragma("foreign_keys = ON");
    const fixture = packageFixture();
    const evidence = await seedEvidence(db, fixture, 0, "unknown");
    const stableReplay = replayPort(fixture);
    let replayCalls = 0;
    const replay: CityEvidencePackageReplayPort = {
      loadExactReplayContract(key) {
        replayCalls += 1;
        trace.push(`replay:${replayCalls}`);
        return stableReplay.loadExactReplayContract(key);
      },
    };
    trace.length = 0;

    new SqliteCityKnowledgeStore(db, INTEGRITY, replay)
      .publishFromEvidence(evidence.id, at(0, 50_000_000));

    const position = (match: (entry: string) => boolean): number => trace.findIndex(match);
    const begin = position((entry) => entry === "BEGIN IMMEDIATE");
    const evidenceQuery = position((entry) => /FROM city_evidence_snapshots/.test(entry));
    const firstReplay = position((entry) => entry === "replay:1");
    const secondReplay = position((entry) => entry === "replay:2");
    const firstKnowledgeQuery = position((entry) =>
      /city_knowledge_revisions/.test(entry) && /SELECT/.test(entry));
    const insert = position((entry) => /INSERT INTO city_knowledge_revisions/.test(entry));
    const commit = position((entry) => entry === "COMMIT");
    expect(Object.values({
      begin, evidenceQuery, firstReplay, secondReplay, firstKnowledgeQuery, insert, commit,
    }).every((index) => index >= 0)).toBe(true);
    expect(begin).toBeLessThan(evidenceQuery);
    expect(evidenceQuery).toBeLessThan(firstReplay);
    expect(firstReplay).toBeLessThan(secondReplay);
    expect(secondReplay).toBeLessThan(firstKnowledgeQuery);
    expect(firstKnowledgeQuery).toBeLessThan(insert);
    expect(insert).toBeLessThan(commit);
  });

  test("rejects semantic drift between the replay consumed by Evidence and the independent replay", async () => {
    // Break caught: comparing only replay identity/key while deriving Knowledge contracts from changed semantics.
    const db = database();
    const fixture = packageFixture();
    const evidence = await seedEvidence(db, fixture, 0, "unknown");
    const driftedPlans = fixture.fixedPlans.map((plan, index) => index === 0
      ? {
          ...plan,
          claimContract: {
            ...plan.claimContract,
            scope: "municipality:semantic-drift",
            unit: "semantic_drift_unit",
            denominator: "semantic_drift_denominator",
            freshnessPolicyVersion: "semantic-drift@1",
          },
        }
      : plan) as unknown as typeof fixture.fixedPlans;
    const driftedContract: CityPackageEvidenceReplayContract = {
      ...fixture.contract,
      fixedPlansByCityId: { [CITY_ID]: driftedPlans },
    };
    let calls = 0;
    const driftingReplay: CityEvidencePackageReplayPort = {
      loadExactReplayContract(key) {
        calls += 1;
        if (INTEGRITY.canonical(key) !==
          INTEGRITY.canonical(fixture.contract.installedPackageManifest.key)) return undefined;
        return calls === 1 ? fixture.contract : driftedContract;
      },
    };

    expect(() => new SqliteCityKnowledgeStore(db, INTEGRITY, driftingReplay)
      .publishFromEvidence(evidence.id, at(0, 50_000_000)))
      .toThrow("integrity_mismatch");
    expect(calls).toBe(2);
    expect(count(db, "city_knowledge_revisions")).toBe(0);
  });

  test("keeps retained prior Evidence bound to its own historical exact package replay", async () => {
    // Break caught: comparing an ancestor package replay to the current package instead of its own key.
    const db = database();
    const historicalEvidenceId = "catalog-evidence:lineage-a";
    const currentEvidenceId = "catalog-evidence:lineage-b";
    const historical = packageFixture(
      INTEGRITY,
      historicalEvidenceId,
      CITY_CATALOG_RULES_VERSION,
      historicalEvidenceId,
    );
    const current = packageFixture(
      INTEGRITY,
      currentEvidenceId,
      CITY_CATALOG_RULES_VERSION,
      currentEvidenceId,
    );
    const replay: CityEvidencePackageReplayPort = {
      loadExactReplayContract(key) {
        if (INTEGRITY.canonical(key) ===
          INTEGRITY.canonical(historical.contract.installedPackageManifest.key)) {
          return historical.contract;
        }
        if (INTEGRITY.canonical(key) ===
          INTEGRITY.canonical(current.contract.installedPackageManifest.key)) {
          return current.contract;
        }
        return undefined;
      },
    };
    const evidenceStore = new SqliteCityEvidenceStore(db, INTEGRITY, replay);
    const historicalEvidence = evidenceStore.seal(
      await verifiedSafetyEvidenceInput(historical, 0),
    );
    const currentInput = await evidenceInput(current, 1, "unknown");
    const firstCandidate = currentInput.safetyAttemptLedger.candidates[0]!;
    const currentEvidence = evidenceStore.seal({
      ...currentInput,
      safetyAttemptLedger: {
        ...currentInput.safetyAttemptLedger,
        candidates: [{
          ...firstCandidate,
          origin: {
            kind: "previous",
            priorSourcePlanId: historical.contract.safetySourcePlan.id,
            priorEvidenceSnapshotId: historicalEvidence.id,
          },
        }, ...currentInput.safetyAttemptLedger.candidates.slice(1)],
      },
    });
    expect(evidenceStore.loadVerified(currentEvidence.id).snapshot.id).toBe(currentEvidence.id);
    const store = new SqliteCityKnowledgeStore(db, INTEGRITY, replay);
    const head = store.publishFromEvidence(currentEvidence.id, at(1, 50_000_000));

    expect(head.predecessorRevisionId).toBeUndefined();
    expect(head.evidenceSnapshotId).toBe(currentEvidence.id);
    expect(head.facts[0].outcome).toEqual({ kind: "unknown", reason: "not_found" });
    expect(store.latestVerified(CITY_ID)).toEqual(head);
    expect(store.loadVerified(head.id)).toEqual(head);
    expect(store.findByEvidenceVerified(currentEvidence.id)).toEqual(head);
    expect(count(db, "city_knowledge_revisions")).toBe(1);
  });

  test("rolls back when the inserted Knowledge signature fails persisted chain verification", async () => {
    // Break caught: committing and returning the in-memory revision without reloading the inserted row.
    const db = database();
    const fixture = packageFixture();
    const evidence = await seedEvidence(db, fixture, 0, "unknown");
    let poisoned = false;
    const oneShotBadKnowledgeSignature: EvidenceIntegrity = {
      canonical: INTEGRITY.canonical,
      hash: INTEGRITY.hash,
      sign(payload) {
        if (!poisoned && payload.includes('"schemaVersion":"city-knowledge@1"')) {
          poisoned = true;
          return "0".repeat(64);
        }
        return INTEGRITY.sign(payload);
      },
    };

    expect(() => new SqliteCityKnowledgeStore(
      db,
      oneShotBadKnowledgeSignature,
      replayPort(fixture),
    ).publishFromEvidence(evidence.id, at(0, 50_000_000)))
      .toThrow("integrity_mismatch");
    expect(poisoned).toBe(true);
    expect(count(db, "city_knowledge_revisions")).toBe(0);
  });

  test("serializes identical and distinct publication across independent connections", async () => {
    // Break caught: connection-local retries permitting duplicate roots, forks, or leaking SQLITE_BUSY.
    const path = temporaryDatabasePath();
    const fixture = packageFixture();
    const setupDb = openEvidenceDatabase(path);
    setupDb.pragma("journal_mode = WAL");
    const firstEvidence = await seedEvidence(setupDb, fixture, 0, "unknown");
    const secondEvidence = await seedEvidence(setupDb, fixture, 1, "unknown");
    const thirdEvidence = await seedEvidence(setupDb, fixture, 2, "unknown");
    setupDb.close();

    const simultaneous = async (
      left: Omit<Parameters<typeof publishInWorker>[0], "path" | "contract" | "startGate">,
      right: Omit<Parameters<typeof publishInWorker>[0], "path" | "contract" | "startGate">,
    ): Promise<readonly [KnowledgeWorkerResult, KnowledgeWorkerResult]> => {
      const gateBuffer = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * 2);
      const gate = new Int32Array(gateBuffer);
      const leftResult = publishInWorker({
        path, contract: fixture.contract, startGate: gateBuffer, ...left,
      });
      const rightResult = publishInWorker({
        path, contract: fixture.contract, startGate: gateBuffer, ...right,
      });
      await vi.waitFor(() => expect(Atomics.load(gate, 0)).toBe(2), { timeout: 10_000 });
      Atomics.store(gate, 1, 1);
      Atomics.notify(gate, 1, 2);
      return Promise.all([leftResult, rightResult]);
    };

    const identical = await simultaneous(
      { evidenceSnapshotId: firstEvidence.id, createdAt: at(0, 50_000_000) },
      { evidenceSnapshotId: firstEvidence.id, createdAt: at(0, 50_000_000) },
    );
    expect(identical.map(({ ok, error }) => ({ ok, error }))).toEqual([
      { ok: true, error: undefined },
      { ok: true, error: undefined },
    ]);
    expect(identical[0].revision?.id).toBe(identical[1].revision?.id);

    const distinct = await simultaneous(
      { evidenceSnapshotId: secondEvidence.id, createdAt: at(1, 50_000_000) },
      {
        evidenceSnapshotId: thirdEvidence.id,
        createdAt: at(2, 50_000_000),
        delayMilliseconds: 75,
      },
    );
    expect(distinct[0].ok).toBe(true);
    expect(distinct[1].ok || distinct[1].error === "integrity_mismatch").toBe(true);
    expect(distinct.every(({ error }) => error === undefined || !error.includes("SQLITE_BUSY"))).toBe(true);

    const verification = openEvidenceDatabase(path);
    databases.push(verification);
    const store = new SqliteCityKnowledgeStore(verification, INTEGRITY, replayPort(fixture));
    if (!distinct[1].ok) {
      store.publishFromEvidence(thirdEvidence.id, at(2, 50_000_000));
    }
    const root = store.findByEvidenceVerified(firstEvidence.id);
    const successor = store.findByEvidenceVerified(secondEvidence.id);
    const head = store.findByEvidenceVerified(thirdEvidence.id);
    expect(root).toBeDefined();
    expect(successor?.predecessorRevisionId).toBe(root?.id);
    expect(head?.predecessorRevisionId).toBe(successor?.id);
    expect(store.latestVerified(CITY_ID)?.id).toBe(head?.id);
    expect(count(verification, "city_knowledge_revisions")).toBe(3);
  }, 30_000);

  test("requires exact retry time and unchanged independently replayed package", async () => {
    // Break caught: returning an existing Evidence row despite time or installed-package drift.
    const db = database();
    const fixture = packageFixture();
    const evidence = await seedEvidence(db, fixture, 0, "unknown");
    const store = new SqliteCityKnowledgeStore(db, INTEGRITY, replayPort(fixture));
    const createdAt = at(0, 50_000_000);
    const first = store.publishFromEvidence(evidence.id, createdAt);

    expect(store.publishFromEvidence(evidence.id, createdAt)).toEqual(first);
    expect(() => store.publishFromEvidence(evidence.id, at(0, 50_000_001)))
      .toThrow("integrity_mismatch");
    expect(count(db, "city_knowledge_revisions")).toBe(1);

    let calls = 0;
    const alternating: CityEvidencePackageReplayPort = {
      loadExactReplayContract(key) {
        calls += 1;
        if (calls % 2 === 1) return replayPort(fixture).loadExactReplayContract(key);
        return undefined;
      },
    };
    expect(() => new SqliteCityKnowledgeStore(db, INTEGRITY, alternating)
      .publishFromEvidence(evidence.id, createdAt)).toThrow("integrity_mismatch");
    expect(count(db, "city_knowledge_revisions")).toBe(1);
  });

  test("normalizes every missing or drifted second replay to zero-write integrity failure", async () => {
    // Break caught: leaking not-installed/upgrade errors or trusting malformed replay members/definitions.
    const cases: Array<{
      readonly name: string;
      readonly second: (fixture: ReturnType<typeof packageFixture>) => unknown;
    }> = [
      { name: "missing", second: () => undefined },
      { name: "wrong installed key", second: (fixture) => ({
        ...fixture.contract,
        installedPackageManifest: Object.freeze({
          ...fixture.contract.installedPackageManifest,
          key: Object.freeze({
            ...fixture.contract.installedPackageManifest.key,
            countryCode: "ZZ",
          }),
        }),
      }) },
      { name: "wrong member", second: (fixture) => ({ ...fixture.contract, fixedPlansByCityId: {} }) },
      { name: "wrong definition", second: (fixture) => ({
        ...fixture.contract,
        fixedPlansByCityId: {
          [CITY_ID]: [
            { ...fixture.fixedPlans[0], definitionId: "wrong-definition@1" },
            fixture.fixedPlans[1],
            fixture.fixedPlans[2],
          ],
        },
      } as CityPackageEvidenceReplayContract) },
      { name: "mixed catalog Evidence", second: () => packageFixture(
        INTEGRITY,
        "catalog-evidence:synthetic:mixed-replay",
      ).contract },
      { name: "legacy rules", second: () => packageFixture(
        INTEGRITY,
        CATALOG_EVIDENCE_ID,
        LEGACY_CITY_CATALOG_RULES_VERSION,
      ).contract },
      { name: "accessor replay", second: (fixture) => {
        const malformed = { ...fixture.contract } as Record<string, unknown>;
        Object.defineProperty(malformed, "definition", {
          enumerable: true,
          get: () => { throw new Error("replay_accessor_must_not_run"); },
        });
        return malformed;
      } },
      { name: "symbol replay", second: (fixture) => Object.assign(
        { ...fixture.contract },
        { [Symbol("unexpected")]: true },
      ) },
      { name: "prototype replay", second: (fixture) => Object.assign(
        Object.create({ inherited: true }) as Record<string, unknown>,
        fixture.contract,
      ) },
    ];
    for (const scenario of cases) {
      const db = database();
      const fixture = packageFixture();
      const evidence = await seedEvidence(db, fixture, 0, "unknown");
      let calls = 0;
      const alternating: CityEvidencePackageReplayPort = {
        loadExactReplayContract(key) {
          calls += 1;
          return calls === 1
            ? replayPort(fixture).loadExactReplayContract(key)
            : scenario.second(fixture) as CityPackageEvidenceReplayContract | undefined;
        },
      };
      expect(() => new SqliteCityKnowledgeStore(db, INTEGRITY, alternating)
        .publishFromEvidence(evidence.id, at(0, 50_000_000)), scenario.name)
        .toThrow("integrity_mismatch");
      expect(count(db, "city_knowledge_revisions"), scenario.name).toBe(0);
    }
  });

  test("owns the second replay tuple before a reentrant integrity callback", async () => {
    // Break caught: using later borrowed plan values after replay validation has begun.
    const db = database();
    const fixture = packageFixture();
    const evidence = await seedEvidence(db, fixture, 0, "unknown");
    const borrowed: CityPackageEvidenceReplayContract = {
      installedPackageManifest: fixture.contract.installedPackageManifest,
      definition: structuredClone(fixture.contract.definition),
      catalogProjection: structuredClone(fixture.contract.catalogProjection),
      fixedPlansByCityId: structuredClone(fixture.contract.fixedPlansByCityId),
      safetySourcePlan: structuredClone(fixture.contract.safetySourcePlan),
      officialAuthorityDirectory: structuredClone(fixture.contract.officialAuthorityDirectory),
      validateValue: fixture.contract.validateValue,
      validateSourcePeriod: fixture.contract.validateSourcePeriod,
    };
    let replayCalls = 0;
    let armed = false;
    let mutated = false;
    const mutatingIntegrity: EvidenceIntegrity = {
      canonical(value) {
        if (armed && !mutated) {
          mutated = true;
          const plans = borrowed.fixedPlansByCityId[CITY_ID] as unknown as Array<CityFixedSourcePlan<SloveniaCityFixedSourceId>>;
          plans[1] = { ...plans[1]!, claimContract: { ...plans[1]!.claimContract, unit: "mutated" } };
        }
        return INTEGRITY.canonical(value);
      },
      hash: INTEGRITY.hash,
      sign: INTEGRITY.sign,
    };
    const replay: CityEvidencePackageReplayPort = {
      loadExactReplayContract(key) {
        replayCalls += 1;
        if (replayCalls === 2) armed = true;
        if (replayCalls > 2) return replayPort(fixture).loadExactReplayContract(key);
        return INTEGRITY.canonical(key) === INTEGRITY.canonical(fixture.contract.installedPackageManifest.key)
          ? borrowed
          : undefined;
      },
    };
    const revision = new SqliteCityKnowledgeStore(db, mutatingIntegrity, replay)
      .publishFromEvidence(evidence.id, at(0, 50_000_000));

    expect(mutated).toBe(true);
    expect(revision.facts[2].unit).toBe(fixture.fixedPlans[1].claimContract.unit);
    expect(Object.isFrozen(revision.facts[2])).toBe(true);
  });

  test("forms one linear chain and drops a known value when successor Evidence becomes unknown", async () => {
    // Break caught: Country/predecessor carry-forward keeping an old basis after a current blocker.
    const db = database();
    const fixture = packageFixture();
    const firstEvidence = await seedEvidence(db, fixture, 0, "verified");
    const secondEvidence = await seedEvidence(db, fixture, 1, "unknown");
    const store = new SqliteCityKnowledgeStore(db, INTEGRITY, replayPort(fixture));
    const first = store.publishFromEvidence(firstEvidence.id, at(0, 50_000_000));
    const second = store.publishFromEvidence(secondEvidence.id, at(1, 50_000_000));

    expect(first.facts[1].outcome).toEqual({ kind: "verified", basis: { kind: "canonical_scalar", value: "9.5" } });
    expect(second.predecessorRevisionId).toBe(first.id);
    expect(second.facts[1].outcome).toEqual({ kind: "unknown", reason: "not_found" });
    expect(second.facts[1].evidenceRefs).toEqual([expect.objectContaining({
      kind: "blocker",
      sourceId: "si-city-long-term-rent",
      blocker: "not_found",
    })]);
    expect(second.facts[1]).not.toEqual(expect.objectContaining({
      outcome: first.facts[1].outcome,
    }));
    expect(second.knowledgeUpdatedAt).toBe(second.lastCheckedAt);
    expect(store.latestVerified(CITY_ID)).toEqual(second);
    expect(count(db, "city_knowledge_revisions")).toBe(2);

    expect(() => store.publishFromEvidence(firstEvidence.id, at(2, 50_000_000)))
      .toThrow("integrity_mismatch");
    expect(count(db, "city_knowledge_revisions")).toBe(2);
  });

  test("publishes unchanged observations as a newer successor while preserving knowledge freshness", async () => {
    // Break caught: collapsing same-projection checks or advancing semantic freshness without changed facts.
    const db = database();
    const fixture = packageFixture();
    const firstEvidence = await seedEvidence(db, fixture, 0, "unknown");
    const secondEvidence = await seedEvidence(db, fixture, 1, "unknown");
    const staleEvidence = await seedEvidence(db, fixture, -1, "unknown");
    const futureEvidence = await seedEvidence(db, fixture, 2, "unknown");
    const store = new SqliteCityKnowledgeStore(db, INTEGRITY, replayPort(fixture));
    const first = store.publishFromEvidence(firstEvidence.id, at(0, 50_000_000));
    const secondCreatedAt = at(1, 50_000_000);
    const second = store.publishFromEvidence(secondEvidence.id, secondCreatedAt);

    expect(second.id).not.toBe(first.id);
    expect(second.predecessorRevisionId).toBe(first.id);
    expect(second.facts).not.toBe(first.facts);
    expect(second.facts).toEqual(first.facts);
    expect(second.lastCheckedAt).toBe(secondEvidence.completedAt);
    expect(second.knowledgeUpdatedAt).toBe(first.knowledgeUpdatedAt);
    expect(second.createdAt).toBe(secondCreatedAt);

    expect(() => store.publishFromEvidence(staleEvidence.id, at(3, 50_000_000)))
      .toThrow("integrity_mismatch");
    expect(() => store.publishFromEvidence(futureEvidence.id, at(2, 1_000)))
      .toThrow("integrity_mismatch");
    expect(count(db, "city_knowledge_revisions")).toBe(2);
  });

  test("authenticates every ancestor and all row mirrors before replay on every read path", async () => {
    // Break caught: reading a valid head after its old root was corrupted or replaying before HMAC/mirror checks.
    const db = database();
    const fixture = packageFixture();
    const firstEvidence = await seedEvidence(db, fixture, 0, "unknown");
    const secondEvidence = await seedEvidence(db, fixture, 1, "unknown");
    const writer = new SqliteCityKnowledgeStore(db, INTEGRITY, replayPort(fixture));
    const first = writer.publishFromEvidence(firstEvidence.id, at(0, 50_000_000));
    const second = writer.publishFromEvidence(secondEvidence.id, at(1, 50_000_000));
    db.exec("DROP TRIGGER city_knowledge_revisions_no_update");
    db.prepare("UPDATE city_knowledge_revisions SET payload_hash = ? WHERE id = ?")
      .run("0".repeat(64), first.id);
    const replay = vi.fn(() => {
      throw new Error("replay_must_not_run");
    });
    const reader = new SqliteCityKnowledgeStore(db, INTEGRITY, { loadExactReplayContract: replay });

    expect(() => reader.latestVerified(CITY_ID)).toThrow("integrity_mismatch");
    expect(() => reader.loadVerified(second.id)).toThrow("integrity_mismatch");
    expect(() => reader.findByEvidenceVerified(secondEvidence.id)).toThrow("integrity_mismatch");
    expect(replay).not.toHaveBeenCalled();
  });

  test("rejects persisted canonical, HMAC, mirror, and internally signed topology drift", async () => {
    // Break caught: choosing a raw maximum/head while ignoring authenticated linear-chain coverage.
    const mutations = [
      "payload_json = payload_json || ' '",
      `hmac = '${"0".repeat(64)}'`,
      "city_id = 'maribor'",
      "evidence_snapshot_id = 'forged-evidence'",
      "rules_version = 'forged-rules@1'",
      "created_at = '2026-03-05T00:00:00.000Z'",
    ];
    for (const mutation of mutations) {
      const db = database();
      const fixture = packageFixture();
      const evidence = await seedEvidence(db, fixture, 0, "unknown");
      const store = new SqliteCityKnowledgeStore(db, INTEGRITY, replayPort(fixture));
      const revision = store.publishFromEvidence(evidence.id, at(0, 50_000_000));
      db.exec("DROP TRIGGER city_knowledge_revisions_no_update");
      db.pragma("foreign_keys = OFF");
      db.exec(`UPDATE city_knowledge_revisions SET ${mutation}`);
      expect(() => store.loadVerified(revision.id)).toThrow("integrity_mismatch");
    }

    const db = database();
    const fixture = packageFixture();
    const firstEvidence = await seedEvidence(db, fixture, 0, "unknown");
    const secondEvidence = await seedEvidence(db, fixture, 1, "unknown");
    const thirdEvidence = await seedEvidence(db, fixture, 2, "unknown");
    const store = new SqliteCityKnowledgeStore(db, INTEGRITY, replayPort(fixture));
    const first = store.publishFromEvidence(firstEvidence.id, at(0, 50_000_000));
    const second = store.publishFromEvidence(secondEvidence.id, at(1, 50_000_000));
    const third = store.publishFromEvidence(thirdEvidence.id, at(2, 50_000_000));
    db.exec("DROP INDEX city_knowledge_one_successor; DROP INDEX city_knowledge_one_root");
    db.exec("DROP TRIGGER city_knowledge_revisions_no_update");
    db.pragma("foreign_keys = OFF");
    resignKnowledgeRevision(db, third.id, (revision) => {
      return { ...knowledgePayload(revision), predecessorRevisionId: first.id };
    });
    expect(() => store.latestVerified(CITY_ID)).toThrow("integrity_mismatch");
    expect(new Set([first.id, second.id, third.id]).size).toBe(3);
  });

  test("rejects internally signed orphan and semantic payload drift", async () => {
    // Break caught: accepting a valid envelope without predecessor reachability or domain reconstruction.
    const orphanDb = database();
    const orphanFixture = packageFixture();
    const orphanFirstEvidence = await seedEvidence(orphanDb, orphanFixture, 0, "unknown");
    const orphanSecondEvidence = await seedEvidence(orphanDb, orphanFixture, 1, "unknown");
    const orphanStore = new SqliteCityKnowledgeStore(orphanDb, INTEGRITY, replayPort(orphanFixture));
    orphanStore.publishFromEvidence(orphanFirstEvidence.id, at(0, 50_000_000));
    const orphanSecond = orphanStore.publishFromEvidence(orphanSecondEvidence.id, at(1, 50_000_000));
    orphanDb.exec("DROP INDEX city_knowledge_one_successor; DROP TRIGGER city_knowledge_revisions_no_update");
    orphanDb.pragma("foreign_keys = OFF");
    const orphanId = resignKnowledgeRevision(orphanDb, orphanSecond.id, (revision) => {
      return {
        ...knowledgePayload(revision),
        predecessorRevisionId: "city-knowledge:missing-predecessor",
      };
    });
    expect(() => orphanStore.loadVerified(orphanId)).toThrow("integrity_mismatch");
    expect(() => orphanStore.findByEvidenceVerified(orphanSecondEvidence.id))
      .toThrow("integrity_mismatch");

    const semanticDb = database();
    const semanticFixture = packageFixture();
    const semanticEvidence = await seedEvidence(semanticDb, semanticFixture, 0, "unknown");
    const semanticStore = new SqliteCityKnowledgeStore(semanticDb, INTEGRITY, replayPort(semanticFixture));
    const semantic = semanticStore.publishFromEvidence(semanticEvidence.id, at(0, 50_000_000));
    semanticDb.exec("DROP TRIGGER city_knowledge_revisions_no_update");
    const semanticId = resignKnowledgeRevision(semanticDb, semantic.id, (revision) => {
      const facts = revision.facts.map((fact, index) => index === 0
        ? { ...fact, outcome: { kind: "unknown" as const, reason: "stale" as const } }
        : fact) as unknown as CityKnowledgeRevision["facts"];
      return { ...knowledgePayload(revision), facts };
    });
    expect(() => semanticStore.loadVerified(semanticId)).toThrow("integrity_mismatch");
  });

  test("authenticates every ancestor's exact Evidence and independent replay", async () => {
    // Break caught: reconstructing only the requested node while trusting an old signed ancestor semantically.
    const evidenceDb = database();
    const evidenceFixture = packageFixture();
    const evidenceFirst = await seedEvidence(evidenceDb, evidenceFixture, 0, "unknown");
    const evidenceSecond = await seedEvidence(evidenceDb, evidenceFixture, 1, "unknown");
    const evidenceWriter = new SqliteCityKnowledgeStore(
      evidenceDb, INTEGRITY, replayPort(evidenceFixture),
    );
    const evidenceRoot = evidenceWriter.publishFromEvidence(evidenceFirst.id, at(0, 50_000_000));
    const evidenceHead = evidenceWriter.publishFromEvidence(evidenceSecond.id, at(1, 50_000_000));
    evidenceDb.exec("DROP TRIGGER city_evidence_snapshots_no_update");
    evidenceDb.prepare("UPDATE city_evidence_snapshots SET payload_hash = ? WHERE id = ?")
      .run("0".repeat(64), evidenceRoot.evidenceSnapshotId);
    expect(() => evidenceWriter.latestVerified(CITY_ID)).toThrow("integrity_mismatch");
    expect(() => evidenceWriter.loadVerified(evidenceHead.id)).toThrow("integrity_mismatch");
    expect(() => evidenceWriter.findByEvidenceVerified(evidenceSecond.id)).toThrow("integrity_mismatch");

    const replayDb = database();
    const replayFixture = packageFixture();
    const replayFirst = await seedEvidence(replayDb, replayFixture, 0, "unknown");
    const replaySecond = await seedEvidence(replayDb, replayFixture, 1, "unknown");
    const replayWriter = new SqliteCityKnowledgeStore(replayDb, INTEGRITY, replayPort(replayFixture));
    replayWriter.publishFromEvidence(replayFirst.id, at(0, 50_000_000));
    const replayHead = replayWriter.publishFromEvidence(replaySecond.id, at(1, 50_000_000));
    const assertSecondNodeReplayDrift = (read: (reader: SqliteCityKnowledgeStore) => unknown): void => {
      let calls = 0;
      const drifting: CityEvidencePackageReplayPort = {
        loadExactReplayContract(key) {
          calls += 1;
          return calls === 4 ? undefined : replayPort(replayFixture).loadExactReplayContract(key);
        },
      };
      expect(() => read(new SqliteCityKnowledgeStore(replayDb, INTEGRITY, drifting)))
        .toThrow("integrity_mismatch");
      expect(calls).toBe(4);
    };
    assertSecondNodeReplayDrift((reader) => reader.latestVerified(CITY_ID));
    assertSecondNodeReplayDrift((reader) => reader.loadVerified(replayHead.id));
    assertSecondNodeReplayDrift((reader) => reader.findByEvidenceVerified(replaySecond.id));
  });

  test("database constraints keep Knowledge roots, successors, and revisions immutable", async () => {
    // Break caught: allowing SQL to fork or rewrite the signed audit chain.
    const db = database();
    const fixture = packageFixture();
    const evidence = await seedEvidence(db, fixture, 0, "unknown");
    const store = new SqliteCityKnowledgeStore(db, INTEGRITY, replayPort(fixture));
    const revision = store.publishFromEvidence(evidence.id, at(0, 50_000_000));

    expect(() => db.prepare("UPDATE city_knowledge_revisions SET hmac = hmac WHERE id = ?")
      .run(revision.id)).toThrow("city_knowledge_revision_is_immutable");
    expect(() => db.prepare("DELETE FROM city_knowledge_revisions WHERE id = ?")
      .run(revision.id)).toThrow("city_knowledge_revision_is_immutable");
  });
});

test("Task 3 persistence ports expose no official-source, publisher, raw-composition, or latest-installed method", () => {
  // Break caught: widening the structural stores into official publication or installation authority.
  const catalogMethods: ReadonlyArray<keyof CityCatalogStorePort> = ["appendVerified", "loadVerified"];
  const knowledgeMethods: ReadonlyArray<keyof CityKnowledgeStorePort> = [
    "publishFromEvidence", "latestVerified", "loadVerified", "findByEvidenceVerified",
  ];
  expect(catalogMethods).toEqual(["appendVerified", "loadVerified"]);
  expect(knowledgeMethods).not.toContain("publishOfficialSource");
  expect(knowledgeMethods).not.toContain("latestInstalledVerified");
  expect(CITY_CATALOG_RULES_VERSION).toBe("city-catalog@2");
});
