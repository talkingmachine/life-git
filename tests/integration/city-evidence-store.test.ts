import { createHash } from "node:crypto";

import type Database from "better-sqlite3";
import { afterEach, describe, expect, test, vi } from "vitest";

import {
  cityEvidenceContextHash,
  type CityEvidenceContext,
  type CityEvidencePackageReplayPort,
  type CityEvidencePayload,
  type CityEvidenceSealInput,
  type CityPackageEvidenceReplayContract,
} from "../../src/application/city-data-contracts";
import {
  buildCityCatalogRevision,
  buildCityRegistryRevision,
} from "../../src/decision/city-catalog";
import {
  createCityDecisionIntegrityView,
  createCityEvidenceReplayIntegrity,
  createEvidenceIntegrity,
} from "../../src/infrastructure/integrity";
import { SqliteCityEvidenceStore } from "../../src/infrastructure/sqlite/city-evidence-store";
import { openEvidenceDatabase } from "../../src/infrastructure/sqlite/db";
import { SqliteEvidenceStore } from "../../src/infrastructure/sqlite/evidence-store";
import {
  citySafetyTerminalEntry,
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
  CitySafetyRetainedDenominatorProjection,
  CitySafetyRetainedInspectionProjection,
  CitySafetyRetainedNavigationProjection,
} from "../../src/research/city-safety-evidence";
import type { LiveCapturedArtifact } from "../../src/research/contracts";
import {
  buildCitySafetyQueries,
  buildCitySafetySourcePlan,
  buildOfficialAuthorityDirectory,
  type OfficialRetentionMode,
} from "../../src/research/city-safety-source-plan";
import type { TerminalEvidenceEntry } from "../../src/research/research-plan";
import { sealEvidencePlan, type EvidenceIntegrity } from "../../src/research/research-plan";
import { SLOVENIA_CITY_FACT_VERSIONS } from "../../src/research/slovenia-city-plan";

const KEY = "city-evidence-test-key-at-least-32-bytes";
const INTEGRITY = createEvidenceIntegrity(KEY);
const CITY_ID = "ljubljana";
const CITY_CHECK_RUN_ID = "city-check:si:ljubljana:1";
const ASSESSMENT_AT = "2026-03-01T00:00:00.000Z";
const COMPLETED_AT = "2026-03-01T12:00:10.000Z";

const databases: Database.Database[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

function database(): Database.Database {
  const value = openEvidenceDatabase(":memory:");
  databases.push(value);
  return value;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function normalizeRequestBodySha(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeRequestBodySha);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key,
      key === "bodySha256" ? "0".repeat(64) : normalizeRequestBodySha(item),
    ]));
  }
  return value;
}

function installOverlayRaceTrigger(
  db: Database.Database,
  frontierRunIdSql = "NEW.frontier_run_id",
): void {
  db.exec(`
    CREATE TRIGGER simulate_city_overlay_race
    BEFORE INSERT ON city_evidence_snapshots
    BEGIN
      INSERT INTO city_evidence_snapshots (
        id, city_check_run_id, frontier_run_id, city_id, country_code, package_id,
        package_schema_version, catalog_revision_id, criteria_snapshot_id, ranking_snapshot_id,
        evidence_rules_version, context_hash, assessment_at, completed_at, canonical_payload,
        payload_hash, hmac
      ) VALUES (
        NEW.id, NEW.city_check_run_id, ${frontierRunIdSql}, NEW.city_id, NEW.country_code,
        NEW.package_id, NEW.package_schema_version, NEW.catalog_revision_id,
        NEW.criteria_snapshot_id, NEW.ranking_snapshot_id, NEW.evidence_rules_version,
        NEW.context_hash, NEW.assessment_at, NEW.completed_at, NEW.canonical_payload,
        NEW.payload_hash, NEW.hmac
      );
      SELECT RAISE(IGNORE);
    END;
  `);
}

interface MutableStoredOverlay {
  readonly safetyAttemptLedger: {
    readonly candidates: { origin: unknown }[];
    readonly queries: { searchedAt: string }[];
  };
}

function rewriteStoredOverlay(
  db: Database.Database,
  snapshotId: string,
  mutate: (payload: MutableStoredOverlay) => void,
): void {
  db.exec("DROP TRIGGER IF EXISTS city_evidence_snapshots_no_update");
  const row = db.prepare(`
    SELECT canonical_payload FROM city_evidence_snapshots WHERE id = ?
  `).get(snapshotId) as { readonly canonical_payload: string };
  const payload = JSON.parse(row.canonical_payload) as MutableStoredOverlay;
  mutate(payload);
  const canonicalPayload = INTEGRITY.canonical(payload);
  db.prepare(`
    UPDATE city_evidence_snapshots
    SET canonical_payload = ?, payload_hash = ?, hmac = ?
    WHERE id = ?
  `).run(
    canonicalPayload,
    INTEGRITY.hash(canonicalPayload),
    INTEGRITY.sign(canonicalPayload),
    snapshotId,
  );
}

function rewriteStoredPriorOrigin(
  db: Database.Database,
  snapshotId: string,
  priorEvidenceSnapshotId: string,
  priorSourcePlanId: string,
): void {
  rewriteStoredOverlay(db, snapshotId, (payload) => {
    payload.safetyAttemptLedger.candidates[0]!.origin = {
      kind: "previous",
      priorSourcePlanId,
      priorEvidenceSnapshotId,
    };
  });
}

function insertSignedCityOverlay(
  db: Database.Database,
  payload: CityEvidencePayload,
): void {
  const canonicalPayload = INTEGRITY.canonical(payload);
  db.prepare(`
    INSERT INTO city_evidence_snapshots (
      id, city_check_run_id, frontier_run_id, city_id, country_code, package_id,
      package_schema_version, catalog_revision_id, criteria_snapshot_id, ranking_snapshot_id,
      evidence_rules_version, context_hash, assessment_at, completed_at, canonical_payload,
      payload_hash, hmac
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    payload.id,
    payload.cityCheckRunId,
    payload.frontierRunId,
    payload.cityId,
    payload.countryCode,
    payload.packageId,
    payload.packageSchemaVersion,
    payload.catalogRevisionId,
    payload.criteriaSnapshotId,
    payload.rankingSnapshotId,
    payload.evidenceRulesVersion,
    payload.contextHash,
    payload.assessmentAt,
    payload.completedAt,
    canonicalPayload,
    INTEGRITY.hash(canonicalPayload),
    INTEGRITY.sign(canonicalPayload),
  );
}

function withPriorOrigin(
  ledger: CitySafetyAttemptLedger,
  priorEvidenceSnapshotId: string,
  priorSourcePlanId: string,
): CitySafetyAttemptLedger {
  const first = ledger.candidates[0]!;
  return {
    ...ledger,
    candidates: [{
      ...first,
      origin: { kind: "previous", priorSourcePlanId, priorEvidenceSnapshotId },
    }, ...ledger.candidates.slice(1)],
  };
}

function fixedPlan<S extends SloveniaCityFixedSourceId>(
  sourceId: S,
  cityId = CITY_ID,
  officialAreaId = "061",
): CityFixedSourcePlan<S> {
  const criterionId = sourceId === "si-city-long-term-rent"
    ? "long_term_rent"
    : sourceId === "si-city-urban-transit"
      ? "urban_transit"
      : "fixed_broadband";
  const definitionId = `${sourceId}-definition@1`;
  return {
    planId: cityId === CITY_ID ? `${sourceId}-plan@1` : `${sourceId}-${cityId}-plan@1`,
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

function fixedLedger<S extends SloveniaCityFixedSourceId>(
  plan: CityFixedSourcePlan<S>,
  completedAt: string,
  cityCheckRunId = CITY_CHECK_RUN_ID,
  assessmentAt = ASSESSMENT_AT,
): CityFixedAttemptLedger<S> {
  return {
    schemaVersion: "city-fixed-attempt-ledger@1",
    cityCheckRunId,
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
      cityCheckRunId,
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

function packageFixture(
  integrity = INTEGRITY,
  retentionMode: OfficialRetentionMode = "seal_raw_artifact",
  includeSecondCity = false,
) {
  const registry = buildCityRegistryRevision({
    packageId: "si-cities",
    packageSchemaVersion: "si-cities@1",
    countryCode: "SI",
    evidenceSnapshotId: "catalog-evidence:1",
    entries: [{
      cityId: CITY_ID,
      countryCode: "SI",
      officialName: "Ljubljana",
      coordinate: { lat: 46.05, lng: 14.51 },
      administrativeType: "central_urban_settlement",
      administrativeTerritory: "Mestna občina Ljubljana",
      capitalRoles: ["national"],
      evidenceReferenceIds: ["catalog-evidence:1"],
    }, ...(includeSecondCity ? [{
      cityId: "maribor",
      countryCode: "SI" as const,
      officialName: "Maribor",
      coordinate: { lat: 46.55, lng: 15.65 },
      administrativeType: "central_urban_settlement" as const,
      administrativeTerritory: "Mestna občina Maribor",
      capitalRoles: [],
      evidenceReferenceIds: ["catalog-evidence:1"],
    }] : [])],
    createdAt: "2026-01-01T00:00:00.000Z",
  }, integrity);
  const catalog = buildCityCatalogRevision({
    registry,
    evidenceSnapshotId: "catalog-evidence:1",
    populationDefinition: {
      definitionId: "surs-settlement-population@1",
      geoScope: "settlement",
      unit: "people",
    },
    candidateBasis: [{
      cityId: CITY_ID,
      comparablePopulation: { kind: "verified", value: "300000", referencePeriod: "2026-01-01" },
    }, ...(includeSecondCity ? [{
      cityId: "maribor",
      comparablePopulation: {
        kind: "verified" as const,
        value: "114301",
        referencePeriod: "2026-01-01",
      },
    }] : [])],
    coverage: { status: "complete" },
    createdAt: "2026-01-01T00:00:00.000Z",
  }, integrity);
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
    retentionMode,
  });
  const officialAuthorityDirectory = buildOfficialAuthorityDirectory({
    schemaVersion: "official-authority-directory@1",
    countryCode: "SI",
    catalogRevisionId: catalog.id,
    requiredPublisherIds: { police: "police", gov: "gov", opsi: "opsi", surs: "surs" },
    publishers: [
      publisher("municipality-ljubljana", "municipality", "https://ljubljana.si/"),
      ...(includeSecondCity
        ? [publisher("municipality-maribor", "municipality", "https://maribor.si/")]
        : []),
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
    }, ...(includeSecondCity ? [{
      cityId: "maribor",
      settlementCode: "070001",
      municipalityCode: "070",
      officialCityNames: ["Maribor"],
      officialMunicipalityNames: ["Mestna občina Maribor"],
      publisherId: "municipality-maribor",
      officialHost: "maribor.si",
    }] : [])],
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
    }, ...(includeSecondCity ? [{
      cityId: "maribor",
      settlementCode: "070001",
      municipalityCode: "070",
      officialCityNames: ["Maribor"],
      officialMunicipalityNames: ["Mestna občina Maribor"],
      publisherIds: ["municipality-maribor", "police", "surs"],
      configuredRoutes: [{
        publisherId: "municipality-maribor",
        navigationUrl: "https://maribor.si/safety",
      }],
    }] : [])],
  }, integrity);
  const fixedPlans = [
    fixedPlan("si-city-long-term-rent"),
    fixedPlan("si-city-urban-transit"),
    fixedPlan("si-city-fixed-broadband"),
  ] as const;
  const secondFixedPlans = [
    fixedPlan("si-city-long-term-rent", "maribor", "070"),
    fixedPlan("si-city-urban-transit", "maribor", "070"),
    fixedPlan("si-city-fixed-broadband", "maribor", "070"),
  ] as const;
  const key = Object.freeze({
    countryCode: "SI",
    packageId: "si-cities",
    packageSchemaVersion: "si-cities@1",
    catalogRevisionId: catalog.id,
    evidenceRulesVersion: "si-city-evidence@1",
  });
  const contract: CityPackageEvidenceReplayContract = {
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
    fixedPlansByCityId: {
      [CITY_ID]: fixedPlans,
      ...(includeSecondCity ? { maribor: secondFixedPlans } : {}),
    },
    safetySourcePlan,
    officialAuthorityDirectory,
    validateValue: (input) => input.value,
    validateSourcePeriod: () => "fresh",
  };
  return {
    contract,
    fixedPlans,
    secondFixedPlans,
    catalog,
    officialAuthorityDirectory,
    safetySourcePlan,
    integrity,
  };
}

function context(catalogRevisionId: string): CityEvidenceContext {
  return {
    schemaVersion: "city-evidence-context@1",
    cityCheckRunId: CITY_CHECK_RUN_ID,
    frontierRunId: "frontier:si:1",
    cityId: CITY_ID,
    countryCode: "SI",
    packageId: "si-cities",
    packageSchemaVersion: "si-cities@1",
    catalogRevisionId,
    criteriaSnapshotId: "criteria:si:1",
    rankingSnapshotId: "ranking:si:1",
    definitionIds: {
      safety: "si-municipal-police-offences-per-100000@1",
      long_term_rent: "si-city-long-term-rent-definition@1",
      urban_transit: "si-city-urban-transit-definition@1",
      fixed_broadband: "si-city-fixed-broadband-definition@1",
    },
    evidenceRulesVersion: "si-city-evidence@1",
    assessmentAt: ASSESSMENT_AT,
    completedAt: COMPLETED_AT,
  };
}

function safetyLedger(
  fixture: ReturnType<typeof packageFixture>,
  cityId = CITY_ID,
): CitySafetyAttemptLedger {
  const entry = fixture.safetySourcePlan.entries.find((candidate) => candidate.cityId === cityId)!;
  const municipality = fixture.officialAuthorityDirectory.municipalities.find(
    (candidate) => candidate.cityId === cityId,
  )!;
  const navigationUrl = entry.configuredRoutes[0]!.navigationUrl;
  const queries = buildCitySafetyQueries(
    entry,
    fixture.officialAuthorityDirectory,
    ASSESSMENT_AT,
    fixture.catalog,
    fixture.integrity,
  );
  return {
    schemaVersion: "city-safety-attempt-ledger@1",
    catalogRevisionId: fixture.catalog.id,
    authorityDirectoryId: fixture.officialAuthorityDirectory.id,
    sourcePlanId: fixture.safetySourcePlan.id,
    cityId,
    municipalityCode: municipality.municipalityCode,
    assessmentAt: ASSESSMENT_AT,
    definitionId: "si-municipal-police-offences-per-100000@1",
    freshnessPolicyVersion: "municipal-annual-july-boundary@1",
    discoveryRulesVersion: "city-safety-discovery@1",
    queries: queries.map((query, index) => ({
      index,
      queryId: `city-safety-query:${CITY_CHECK_RUN_ID}:${index + 1}`,
      queryTemplateVersion: "slovenia-municipal-safety-query@1",
      providerId: "synthetic-search",
      query,
      searchedAt: `2026-03-01T12:00:0${index + 2}.000Z`,
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
        failure: {
          captureKind: "http_error",
          responseStatus: 404,
          responseUrl: navigationUrl,
        },
      },
      artifactRefs: [],
      disposition: "rejected",
      reason: "http_not_found",
    }],
    counters: { queries: 3, candidates: 1, maxOfficialHops: 0 },
    result: { kind: "unknown", reason: "not_found" },
    completedAt: "2026-03-01T12:00:06.000Z",
  };
}

function unavailableEntry(
  sourceId: SloveniaCityFactSourceId,
  navigationUrl: string,
  versionHint?: string,
): TerminalEvidenceEntry<
  SloveniaCityFactSourceId,
  CityEvidenceClaim
> {
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

async function sealInput(fixture = packageFixture()): Promise<{
  readonly input: CityEvidenceSealInput;
  readonly packageReplay: CityEvidencePackageReplayPort;
}> {
  const evidenceContext = context(fixture.catalog.id);
  const contextHash = cityEvidenceContextHash(evidenceContext, fixture.integrity);
  const entries = [
    unavailableEntry(
      "si-city-safety",
      "https://ljubljana.si/safety",
      SLOVENIA_CITY_FACT_VERSIONS["si-city-safety"].parserVersion,
    ),
    ...fixture.fixedPlans.map((plan) =>
      unavailableEntry(plan.sourceId, plan.routes[0]!.navigationUrl, plan.parserVersion)),
  ];
  const genericEvidence = await sealEvidencePlan({
    id: `${CITY_CHECK_RUN_ID}:evidence`,
    assessmentDate: ASSESSMENT_AT.slice(0, 10),
    entries,
    sourceIds: SLOVENIA_CITY_FACT_SOURCE_IDS,
    parserVersions: {
      "si-city-safety": SLOVENIA_CITY_FACT_VERSIONS["si-city-safety"].parserVersion,
      "si-city-long-term-rent": fixture.fixedPlans[0].parserVersion,
      "si-city-urban-transit": fixture.fixedPlans[1].parserVersion,
      "si-city-fixed-broadband": fixture.fixedPlans[2].parserVersion,
    },
    rulesVersion: evidenceContext.evidenceRulesVersion,
    contextHash,
  }, fixture.integrity);
  const input: CityEvidenceSealInput = {
    ...evidenceContext,
    genericEvidence,
    artifacts: [],
    fixedAttemptLedgers: [
      fixedLedger(fixture.fixedPlans[0], "2026-03-01T12:00:01.000Z"),
      fixedLedger(fixture.fixedPlans[1], "2026-03-01T12:00:02.000Z"),
      fixedLedger(fixture.fixedPlans[2], "2026-03-01T12:00:03.000Z"),
    ],
    safetyAttemptLedger: safetyLedger(fixture),
  };
  return {
    input,
    packageReplay: {
      loadExactReplayContract: (key) =>
        fixture.integrity.canonical(key) ===
          fixture.integrity.canonical(fixture.contract.installedPackageManifest.key)
          ? fixture.contract
          : undefined,
    },
  };
}

async function crossCitySafetyMismatchInput(): Promise<{
  readonly validInput: CityEvidenceSealInput;
  readonly mismatchedInput: CityEvidenceSealInput;
  readonly packageReplay: CityEvidencePackageReplayPort;
}> {
  const fixture = packageFixture(INTEGRITY, "seal_raw_artifact", true);
  const valid = await sealInput(fixture);
  const evidenceContext = context(fixture.catalog.id);
  const mismatchedLedger = safetyLedger(fixture, "maribor");
  const safetyEntry = citySafetyTerminalEntry({
    cityCheckRunId: evidenceContext.cityCheckRunId,
    ledger: mismatchedLedger,
    artifacts: [],
    sourcePlan: fixture.safetySourcePlan,
    authorityDirectory: fixture.officialAuthorityDirectory,
  });
  const genericEvidence = await sealEvidencePlan({
    id: `${evidenceContext.cityCheckRunId}:evidence`,
    assessmentDate: evidenceContext.assessmentAt.slice(0, 10),
    entries: [
      safetyEntry,
      ...fixture.fixedPlans.map((plan) =>
        unavailableEntry(plan.sourceId, plan.routes[0]!.navigationUrl, plan.parserVersion)),
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
    validInput: valid.input,
    mismatchedInput: {
      ...valid.input,
      genericEvidence,
      safetyAttemptLedger: mismatchedLedger,
    },
    packageReplay: valid.packageReplay,
  };
}

function safetyArtifact(
  artifactId: string,
  role: "municipal_source" | "surs_denominator",
  url: string,
  contents: string,
  request: LiveCapturedArtifact<"si-city-safety">["request"] = { method: "GET", url },
): LiveCapturedArtifact<"si-city-safety"> {
  const bytes = new TextEncoder().encode(contents);
  return {
    artifactId,
    runId: CITY_CHECK_RUN_ID,
    sourceId: "si-city-safety",
    role,
    url,
    mediaType: "application/pdf",
    sha256: sha256(bytes),
    bytes,
    origin: "live",
    capturedAt: "2026-03-01T12:00:00.500Z",
    responseStatus: 200,
    responseUrl: url,
    request,
  };
}

async function verifiedRawSafetySealInput(options: {
  readonly integrity?: EvidenceIntegrity;
  readonly sequence?: number;
  readonly priorEvidenceSnapshotId?: string;
  readonly denominatorBodySha256?: string;
} = {}): Promise<{
  readonly input: CityEvidenceSealInput;
  readonly packageReplay: CityEvidencePackageReplayPort;
}> {
  const integrity = options.integrity ?? INTEGRITY;
  const fixture = packageFixture(integrity);
  const sequence = options.sequence;
  const runId = sequence === undefined
    ? CITY_CHECK_RUN_ID
    : `city-check:si:ljubljana:chain-${String(sequence)}`;
  const assessmentAt = sequence === undefined
    ? ASSESSMENT_AT
    : new Date(Date.parse(ASSESSMENT_AT) + sequence * 60_000).toISOString();
  const at = (milliseconds: number): string =>
    new Date(Date.parse(assessmentAt) + milliseconds).toISOString();
  const evidenceContext: CityEvidenceContext = {
    ...context(fixture.catalog.id),
    cityCheckRunId: runId,
    assessmentAt,
    completedAt: sequence === undefined ? COMPLETED_AT : at(10_000),
  };
  const artifactSuffix = sequence === undefined ? "" : `-chain-${String(sequence)}`;
  const municipalUrl = "https://ljubljana.si/safety";
  const denominatorUrl = "https://pxweb.stat.si/population";
  const municipal = {
    ...safetyArtifact(
      `municipal-safety-2025${artifactSuffix}`,
      "municipal_source",
      municipalUrl,
      "municipal raw PDF bytes",
    ),
    runId,
    capturedAt: sequence === undefined ? "2026-03-01T12:00:00.500Z" : at(500),
  };
  const denominator = {
    ...safetyArtifact(
      `surs-population-2025${artifactSuffix}`,
      "surs_denominator",
      denominatorUrl,
      "SURS raw response bytes",
      {
        method: "POST",
        url: denominatorUrl,
        bodyMediaType: "application/json",
        bodySha256: options.denominatorBodySha256 ?? "c".repeat(64),
      },
    ),
    runId,
    capturedAt: sequence === undefined ? "2026-03-01T12:00:00.500Z" : at(500),
  };
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
    authorityDirectoryId: fixture.officialAuthorityDirectory.id,
    sourcePlanId: fixture.safetySourcePlan.id,
    cityId: CITY_ID,
    municipalityCode: "061",
    assessmentAt,
    definitionId: "si-municipal-police-offences-per-100000@1",
    freshnessPolicyVersion: "municipal-annual-july-boundary@1",
    discoveryRulesVersion: "city-safety-discovery@1",
    queries: [],
    candidates: [{
      index: 0,
      origin: options.priorEvidenceSnapshotId === undefined
        ? { kind: "configured", configuredRouteIndex: 0 }
        : {
            kind: "previous",
            priorSourcePlanId: fixture.safetySourcePlan.id,
            priorEvidenceSnapshotId: options.priorEvidenceSnapshotId,
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
    completedAt: sequence === undefined ? "2026-03-01T12:00:04.000Z" : at(4_000),
  };
  const safetyEntry = citySafetyTerminalEntry({
    cityCheckRunId: runId,
    ledger,
    artifacts: [municipal, denominator],
    sourcePlan: fixture.safetySourcePlan,
    authorityDirectory: fixture.officialAuthorityDirectory,
  });
  const fixedEntries = fixture.fixedPlans.map((plan) =>
    unavailableEntry(plan.sourceId, plan.routes[0]!.navigationUrl, plan.parserVersion));
  const genericEvidence = await sealEvidencePlan({
    id: `${runId}:evidence`,
    assessmentDate: assessmentAt.slice(0, 10),
    entries: [safetyEntry, ...fixedEntries],
    sourceIds: SLOVENIA_CITY_FACT_SOURCE_IDS,
    parserVersions: {
      "si-city-safety": SLOVENIA_CITY_FACT_VERSIONS["si-city-safety"].parserVersion,
      "si-city-long-term-rent": fixture.fixedPlans[0].parserVersion,
      "si-city-urban-transit": fixture.fixedPlans[1].parserVersion,
      "si-city-fixed-broadband": fixture.fixedPlans[2].parserVersion,
    },
    rulesVersion: evidenceContext.evidenceRulesVersion,
    contextHash: cityEvidenceContextHash(evidenceContext, integrity),
  }, integrity);
  return {
    input: {
      ...evidenceContext,
      genericEvidence,
      artifacts: [municipal, denominator],
      fixedAttemptLedgers: [
        fixedLedger(
          fixture.fixedPlans[0],
          sequence === undefined ? "2026-03-01T12:00:01.000Z" : at(1_000),
          runId,
          assessmentAt,
        ),
        fixedLedger(
          fixture.fixedPlans[1],
          sequence === undefined ? "2026-03-01T12:00:02.000Z" : at(2_000),
          runId,
          assessmentAt,
        ),
        fixedLedger(
          fixture.fixedPlans[2],
          sequence === undefined ? "2026-03-01T12:00:03.000Z" : at(3_000),
          runId,
          assessmentAt,
        ),
      ],
      safetyAttemptLedger: ledger,
    },
    packageReplay: {
      loadExactReplayContract: (key) =>
        integrity.canonical(key) === integrity.canonical(fixture.contract.installedPackageManifest.key)
          ? fixture.contract
          : undefined,
    },
  };
}

function retainedSafetyArtifact(
  artifactId: string,
  role: "municipal_source" | "surs_denominator",
  url: string,
  projection:
    | CitySafetyRetainedNavigationProjection
    | CitySafetyRetainedInspectionProjection
    | CitySafetyRetainedDenominatorProjection,
  request: LiveCapturedArtifact<"si-city-safety">["request"] = { method: "GET", url },
): LiveCapturedArtifact<"si-city-safety"> {
  const bytes = new TextEncoder().encode(INTEGRITY.canonical(projection));
  return {
    artifactId,
    runId: CITY_CHECK_RUN_ID,
    sourceId: "si-city-safety",
    role,
    url,
    mediaType: "application/json",
    sha256: sha256(bytes),
    bytes,
    origin: "live",
    capturedAt: "2026-03-01T12:00:00.500Z",
    responseStatus: 200,
    responseUrl: url,
    request,
  };
}

async function verifiedTransientSafetySealInput(): Promise<{
  readonly input: CityEvidenceSealInput;
  readonly packageReplay: CityEvidencePackageReplayPort;
}> {
  const fixture = packageFixture(INTEGRITY, "seal_hash_locator_then_delete_transient");
  const evidenceContext = context(fixture.catalog.id);
  const navigationUrl = "https://ljubljana.si/safety";
  const reportUrl = "https://ljubljana.si/report.pdf";
  const denominatorUrl = "https://pxweb.stat.si/population";
  const denominatorSourceSha256 = "b".repeat(64);
  const denominatorProjection: CitySafetyRetainedDenominatorProjection = {
    schemaVersion: "city-safety-retained-denominator@1",
    publisherId: "surs",
    municipalityCode: "061",
    referenceDate: "2025-01-01",
    population: "300000",
    sourceSha256: denominatorSourceSha256,
    sourceLocator: denominatorUrl,
    sourceMediaType: "application/pdf",
    retentionPolicyId: "surs-retention@1",
    transientRawDeleted: true,
  };
  const denominator = retainedSafetyArtifact(
    "surs-retained-2025",
    "surs_denominator",
    denominatorUrl,
    denominatorProjection,
    {
      method: "POST",
      url: denominatorUrl,
      bodyMediaType: "application/json",
      bodySha256: "c".repeat(64),
    },
  );
  const denominatorReference = {
    publisherId: "surs",
    municipalityCode: "061",
    referenceDate: "2025-01-01",
    population: "300000",
    artifactId: denominator.artifactId,
    mediaType: "application/json",
    retentionPolicyId: "surs-retention@1",
    transientRawDeleted: true,
  } as const;
  const trace = {
    initialUrl: navigationUrl,
    edges: [{ kind: "confirmed_document_link" as const, fromUrl: navigationUrl, toUrl: reportUrl }],
    lastTrustedUrl: reportUrl,
    officialHops: 1,
  } as const;
  const navigationSourceSha256 = "a".repeat(64);
  const navigationProjection: CitySafetyRetainedNavigationProjection = {
    schemaVersion: "city-safety-retained-navigation@1",
    cityId: CITY_ID,
    municipalityCode: "061",
    publisherId: "municipality-ljubljana",
    publisherNavigationUrl: navigationUrl,
    resolvedNavigationUrl: navigationUrl,
    officialTrace: trace,
    confirmedDocumentUrl: reportUrl,
    documentLocatorPolicyId: "municipality-ljubljana-locator@1",
    sourceSha256: navigationSourceSha256,
    sourceLocator: navigationUrl,
    sourceMediaType: "application/pdf",
    retentionPolicyId: "municipality-ljubljana-retention@1",
    transientRawDeleted: true,
  };
  const navigation = retainedSafetyArtifact(
    "municipal-retained-navigation",
    "municipal_source",
    navigationUrl,
    navigationProjection,
  );
  const quantity = {
    offenceCount: "1200",
    population: "300000",
    rateBasis: "offences_per_100000_residents" as const,
  };
  const terminalSourceSha256 = "d".repeat(64);
  const inspectionProjection: CitySafetyRetainedInspectionProjection = {
    schemaVersion: "city-safety-retained-inspection@1",
    cityId: CITY_ID,
    municipalityCode: "061",
    publisherId: "municipality-ljubljana",
    dataAuthorityId: "police",
    publisherNavigationUrl: navigationUrl,
    resolvedEvidenceUrl: reportUrl,
    officialTrace: trace,
    outcome: { kind: "usable", referenceYear: 2025, quantity, denominator: denominatorReference },
    sourceSha256: terminalSourceSha256,
    sourceLocator: reportUrl,
    sourceMediaType: "application/pdf",
    retentionPolicyId: "municipality-ljubljana-retention@1",
    transientRawDeleted: true,
  };
  const terminal = retainedSafetyArtifact(
    "municipal-retained-terminal",
    "municipal_source",
    reportUrl,
    inspectionProjection,
  );
  const references = [{
    role: "municipal_source" as const,
    documentRole: "navigation" as const,
    artifactId: navigation.artifactId,
    artifactSha256: navigation.sha256,
    sourceSha256: navigationSourceSha256,
    locator: navigationUrl,
  }, {
    role: "municipal_source" as const,
    documentRole: "terminal_claim" as const,
    artifactId: terminal.artifactId,
    artifactSha256: terminal.sha256,
    sourceSha256: terminalSourceSha256,
    locator: reportUrl,
  }, {
    role: "surs_denominator" as const,
    artifactId: denominator.artifactId,
    artifactSha256: denominator.sha256,
    sourceSha256: denominatorSourceSha256,
    locator: denominatorUrl,
  }] satisfies readonly CitySafetyArtifactReference[];
  const ledger: CitySafetyAttemptLedger = {
    schemaVersion: "city-safety-attempt-ledger@1",
    catalogRevisionId: fixture.catalog.id,
    authorityDirectoryId: fixture.officialAuthorityDirectory.id,
    sourcePlanId: fixture.safetySourcePlan.id,
    cityId: CITY_ID,
    municipalityCode: "061",
    assessmentAt: ASSESSMENT_AT,
    definitionId: "si-municipal-police-offences-per-100000@1",
    freshnessPolicyVersion: "municipal-annual-july-boundary@1",
    discoveryRulesVersion: "city-safety-discovery@1",
    queries: [],
    candidates: [{
      index: 0,
      origin: { kind: "configured", configuredRouteIndex: 0 },
      canonicalUrl: navigationUrl,
      publisherId: "municipality-ljubljana",
      dataAuthorityId: "police",
      publisherNavigationUrl: navigationUrl,
      resolvedEvidenceUrl: reportUrl,
      officialTrace: trace,
      mediaType: "application/pdf",
      retentionPolicyId: "municipality-ljubljana-retention@1",
      transientRawDeleted: true,
      artifactRefs: references,
      disposition: "usable",
      referenceYear: 2025,
      periodDisposition: "preferred",
      quantity,
      denominator: denominatorReference,
    }],
    counters: { queries: 0, candidates: 1, maxOfficialHops: 1 },
    result: { kind: "verified", quantity, referenceYear: 2025, acceptedCandidateIndex: 0 },
    completedAt: "2026-03-01T12:00:04.000Z",
  };
  const artifacts = [navigation, terminal, denominator] as const;
  const safetyEntry = citySafetyTerminalEntry({
    cityCheckRunId: CITY_CHECK_RUN_ID,
    ledger,
    artifacts,
    sourcePlan: fixture.safetySourcePlan,
    authorityDirectory: fixture.officialAuthorityDirectory,
  });
  const genericEvidence = await sealEvidencePlan({
    id: `${CITY_CHECK_RUN_ID}:evidence`,
    assessmentDate: ASSESSMENT_AT.slice(0, 10),
    entries: [
      safetyEntry,
      ...fixture.fixedPlans.map((plan) =>
        unavailableEntry(plan.sourceId, plan.routes[0]!.navigationUrl, plan.parserVersion)),
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
    input: {
      ...evidenceContext,
      genericEvidence,
      artifacts,
      fixedAttemptLedgers: [
        fixedLedger(fixture.fixedPlans[0], "2026-03-01T12:00:01.000Z"),
        fixedLedger(fixture.fixedPlans[1], "2026-03-01T12:00:02.000Z"),
        fixedLedger(fixture.fixedPlans[2], "2026-03-01T12:00:03.000Z"),
      ],
      safetyAttemptLedger: ledger,
    },
    packageReplay: {
      loadExactReplayContract: (key) =>
        INTEGRITY.canonical(key) === INTEGRITY.canonical(fixture.contract.installedPackageManifest.key)
          ? fixture.contract
          : undefined,
    },
  };
}

async function verifiedFixedSealInput(
  capturedAt = "2026-03-01T00:00:00.500Z",
): Promise<{
  readonly input: CityEvidenceSealInput;
  readonly packageReplay: CityEvidencePackageReplayPort;
}> {
  const fixture = packageFixture();
  const evidenceContext = context(fixture.catalog.id);
  const plan = fixture.fixedPlans[0];
  const resolvedEvidenceUrl = `${plan.routes[0]!.navigationUrl}/resolved`;
  const bytes = new TextEncoder().encode("verified fixed-source bytes");
  const artifact: LiveCapturedArtifact<"si-city-long-term-rent"> = {
    artifactId: "rent-fixed-artifact-2025",
    runId: CITY_CHECK_RUN_ID,
    sourceId: plan.sourceId,
    role: "official_dataset",
    url: resolvedEvidenceUrl,
    mediaType: "application/json",
    sha256: sha256(bytes),
    bytes,
    origin: "live",
    capturedAt,
    responseStatus: 200,
    responseUrl: resolvedEvidenceUrl,
    request: { method: "GET", url: plan.routes[0]!.navigationUrl },
  };
  const claim: CityFixedEvidenceClaim<"si-city-long-term-rent"> = {
    claimId: "rent-fixed-claim-2025",
    sourceId: plan.sourceId,
    value: { kind: "canonical_scalar", value: "9.5" },
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
  const verifiedLedger: CityFixedAttemptLedger<"si-city-long-term-rent"> = {
    schemaVersion: "city-fixed-attempt-ledger@1",
    cityCheckRunId: CITY_CHECK_RUN_ID,
    cityId: CITY_ID,
    sourceId: plan.sourceId,
    criterionId: plan.criterionId,
    planId: plan.planId,
    definitionId: plan.definitionId,
    valuePolicyVersion: plan.claimContract.valuePolicyVersion,
    sourcePeriodPolicyVersion: plan.claimContract.sourcePeriodPolicyVersion,
    parserVersion: plan.parserVersion,
    rulesVersion: plan.rulesVersion,
    assessmentAt: ASSESSMENT_AT,
    attempts: [{
      cityCheckRunId: CITY_CHECK_RUN_ID,
      sourceId: plan.sourceId,
      index: 0,
      routeId: plan.routes[0]!.routeId,
      navigationUrl: plan.routes[0]!.navigationUrl,
      resolvedEvidenceUrl,
      attemptedAt: ASSESSMENT_AT,
      disposition: "accepted",
      artifactIds: [artifact.artifactId],
      claimIds: [claim.claimId],
    }],
    result: { kind: "verified", claimIds: [claim.claimId] },
    completedAt: "2026-03-01T12:00:01.000Z",
  };
  const verifiedEntry: TerminalEvidenceEntry<SloveniaCityFactSourceId, CityEvidenceClaim> = {
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
  };
  const genericEvidence = await sealEvidencePlan({
    id: `${CITY_CHECK_RUN_ID}:evidence`,
    assessmentDate: ASSESSMENT_AT.slice(0, 10),
    entries: [
      unavailableEntry(
        "si-city-safety",
        "https://ljubljana.si/safety",
        SLOVENIA_CITY_FACT_VERSIONS["si-city-safety"].parserVersion,
      ),
      verifiedEntry,
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
    input: {
      ...evidenceContext,
      genericEvidence,
      artifacts: [artifact],
      fixedAttemptLedgers: [
        verifiedLedger,
        fixedLedger(fixture.fixedPlans[1], "2026-03-01T12:00:02.000Z"),
        fixedLedger(fixture.fixedPlans[2], "2026-03-01T12:00:03.000Z"),
      ],
      safetyAttemptLedger: safetyLedger(fixture),
    },
    packageReplay: {
      loadExactReplayContract: (key) =>
        INTEGRITY.canonical(key) === INTEGRITY.canonical(fixture.contract.installedPackageManifest.key)
          ? fixture.contract
          : undefined,
    },
  };
}

async function cachedDenominatorReuseSealInput(
  firstAcquiredBySearch = false,
): Promise<{
  readonly input: CityEvidenceSealInput;
  readonly packageReplay: CityEvidencePackageReplayPort;
}> {
  const fixture = packageFixture();
  const evidenceContext = context(fixture.catalog.id);
  const configuredUrl = "https://ljubljana.si/safety";
  const searchedUrl = "https://ljubljana.si/report.pdf";
  const denominatorUrl = "https://pxweb.stat.si/population";
  const configuredArtifact = safetyArtifact(
    "municipal-configured-rejected",
    "municipal_source",
    configuredUrl,
    "configured municipal bytes",
  );
  const sharedDenominatorBase = safetyArtifact(
    "surs-shared-denominator",
    "surs_denominator",
    denominatorUrl,
    "shared SURS bytes",
  );
  const sharedDenominator = firstAcquiredBySearch
    ? { ...sharedDenominatorBase, capturedAt: "2026-03-01T12:00:02.250Z" }
    : sharedDenominatorBase;
  const searchedArtifact = {
    ...safetyArtifact(
      "municipal-search-accepted",
      "municipal_source",
      searchedUrl,
      "searched municipal bytes",
    ),
    capturedAt: "2026-03-01T12:00:02.500Z",
  };
  const denominatorReference = {
    role: "surs_denominator" as const,
    artifactId: sharedDenominator.artifactId,
    artifactSha256: sharedDenominator.sha256,
    sourceSha256: sharedDenominator.sha256,
    locator: denominatorUrl,
  };
  const firstReferences = [{
    role: "municipal_source" as const,
    documentRole: "terminal_claim" as const,
    artifactId: configuredArtifact.artifactId,
    artifactSha256: configuredArtifact.sha256,
    sourceSha256: configuredArtifact.sha256,
    locator: configuredUrl,
  }, denominatorReference] satisfies readonly CitySafetyArtifactReference[];
  const secondReferences = [{
    role: "municipal_source" as const,
    documentRole: "terminal_claim" as const,
    artifactId: searchedArtifact.artifactId,
    artifactSha256: searchedArtifact.sha256,
    sourceSha256: searchedArtifact.sha256,
    locator: searchedUrl,
  }, denominatorReference] satisfies readonly CitySafetyArtifactReference[];
  const quantity = {
    offenceCount: "1200",
    population: "300000",
    rateBasis: "offences_per_100000_residents" as const,
  };
  const expectedQuery = buildCitySafetyQueries(
    fixture.safetySourcePlan.entries[0]!,
    fixture.officialAuthorityDirectory,
    ASSESSMENT_AT,
    fixture.catalog,
    INTEGRITY,
  )[0]!;
  const ledger: CitySafetyAttemptLedger = {
    schemaVersion: "city-safety-attempt-ledger@1",
    catalogRevisionId: fixture.catalog.id,
    authorityDirectoryId: fixture.officialAuthorityDirectory.id,
    sourcePlanId: fixture.safetySourcePlan.id,
    cityId: CITY_ID,
    municipalityCode: "061",
    assessmentAt: ASSESSMENT_AT,
    definitionId: "si-municipal-police-offences-per-100000@1",
    freshnessPolicyVersion: "municipal-annual-july-boundary@1",
    discoveryRulesVersion: "city-safety-discovery@1",
    queries: [{
      index: 0,
      queryId: `city-safety-query:${CITY_CHECK_RUN_ID}:1`,
      queryTemplateVersion: "slovenia-municipal-safety-query@1",
      providerId: "synthetic-search",
      query: expectedQuery,
      searchedAt: "2026-03-01T12:00:02.000Z",
      outcome: { kind: "completed", returnedUrls: [searchedUrl] },
    }],
    candidates: [firstAcquiredBySearch ? {
      index: 0,
      origin: { kind: "configured", configuredRouteIndex: 0 },
      canonicalUrl: configuredUrl,
      officialTrace: {
        initialUrl: configuredUrl,
        edges: [],
        lastTrustedUrl: configuredUrl,
        officialHops: 0,
        failure: {
          captureKind: "http_error",
          responseStatus: 404,
          responseUrl: configuredUrl,
        },
      },
      artifactRefs: [],
      disposition: "rejected",
      reason: "http_not_found",
    } : {
      index: 0,
      origin: { kind: "configured", configuredRouteIndex: 0 },
      canonicalUrl: configuredUrl,
      officialTrace: {
        initialUrl: configuredUrl,
        edges: [],
        lastTrustedUrl: configuredUrl,
        officialHops: 0,
      },
      reviewedOfficial: {
        publisherId: "municipality-ljubljana",
        dataAuthorityId: "police",
        publisherNavigationUrl: configuredUrl,
        resolvedEvidenceUrl: configuredUrl,
        referenceYear: 2024,
      },
      mediaType: "application/pdf",
      retentionPolicyId: "municipality-ljubljana-retention@1",
      transientRawDeleted: false,
      artifactRefs: firstReferences,
      disposition: "rejected",
      reason: "denominator_period_mismatch",
    }, {
      index: 1,
      origin: { kind: "search", queryId: `city-safety-query:${CITY_CHECK_RUN_ID}:1` },
      canonicalUrl: searchedUrl,
      publisherId: "municipality-ljubljana",
      dataAuthorityId: "police",
      publisherNavigationUrl: "https://ljubljana.si/",
      resolvedEvidenceUrl: searchedUrl,
      officialTrace: {
        initialUrl: searchedUrl,
        edges: [],
        lastTrustedUrl: searchedUrl,
        officialHops: 0,
      },
      mediaType: "application/pdf",
      retentionPolicyId: "municipality-ljubljana-retention@1",
      transientRawDeleted: false,
      artifactRefs: secondReferences,
      disposition: "usable",
      referenceYear: 2025,
      periodDisposition: "preferred",
      quantity,
      denominator: {
        publisherId: "surs",
        municipalityCode: "061",
        referenceDate: "2025-01-01",
        population: "300000",
        artifactId: sharedDenominator.artifactId,
        mediaType: "application/pdf",
        retentionPolicyId: "surs-retention@1",
        transientRawDeleted: false,
      },
    }],
    counters: { queries: 1, candidates: 2, maxOfficialHops: 0 },
    result: { kind: "verified", quantity, referenceYear: 2025, acceptedCandidateIndex: 1 },
    completedAt: "2026-03-01T12:00:04.000Z",
  };
  const artifacts = firstAcquiredBySearch
    ? [searchedArtifact, sharedDenominator] as const
    : [configuredArtifact, sharedDenominator, searchedArtifact] as const;
  const safetyEntry = citySafetyTerminalEntry({
    cityCheckRunId: CITY_CHECK_RUN_ID,
    ledger,
    artifacts,
    sourcePlan: fixture.safetySourcePlan,
    authorityDirectory: fixture.officialAuthorityDirectory,
  });
  const genericEvidence = await sealEvidencePlan({
    id: `${CITY_CHECK_RUN_ID}:evidence`,
    assessmentDate: ASSESSMENT_AT.slice(0, 10),
    entries: [
      safetyEntry,
      ...fixture.fixedPlans.map((plan) =>
        unavailableEntry(plan.sourceId, plan.routes[0]!.navigationUrl, plan.parserVersion)),
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
    input: {
      ...evidenceContext,
      genericEvidence,
      artifacts,
      fixedAttemptLedgers: [
        fixedLedger(fixture.fixedPlans[0], "2026-03-01T12:00:01.000Z"),
        fixedLedger(fixture.fixedPlans[1], "2026-03-01T12:00:02.000Z"),
        fixedLedger(fixture.fixedPlans[2], "2026-03-01T12:00:03.000Z"),
      ],
      safetyAttemptLedger: ledger,
    },
    packageReplay: {
      loadExactReplayContract: (key) =>
        INTEGRITY.canonical(key) === INTEGRITY.canonical(fixture.contract.installedPackageManifest.key)
          ? fixture.contract
          : undefined,
    },
  };
}

describe("City Evidence context", () => {
  test("hashes exactly the closed fourteen-key context with the caller's canonical capability", () => {
    // Break caught: accepting rulesVersion aliases, loose timestamps or an open/partial signed context.
    const fixture = packageFixture();
    const value = context(fixture.catalog.id);
    expect(Object.keys(value)).toEqual([
      "schemaVersion", "cityCheckRunId", "frontierRunId", "cityId", "countryCode", "packageId",
      "packageSchemaVersion", "catalogRevisionId", "criteriaSnapshotId", "rankingSnapshotId",
      "definitionIds", "evidenceRulesVersion", "assessmentAt", "completedAt",
    ]);
    expect(cityEvidenceContextHash(value, INTEGRITY)).toBe(INTEGRITY.hash(INTEGRITY.canonical(value)));
    expect(() => cityEvidenceContextHash(
      { ...value, rulesVersion: value.evidenceRulesVersion } as unknown as CityEvidenceContext,
      INTEGRITY,
    ))
      .toThrow("integrity_mismatch");
    expect(() => cityEvidenceContextHash({ ...value, completedAt: "2026-03-01T00:00:00Z" }, INTEGRITY))
      .toThrow("integrity_mismatch");
    expect(() => cityEvidenceContextHash({ ...value, completedAt: "2026-02-28T23:59:59.999Z" }, INTEGRITY))
      .toThrow("integrity_mismatch");
  });
});

describe("SQLite City Evidence overlay", () => {
  test("narrows runtime integrity capabilities before pure replay", async () => {
    const receivers = new Set<string>();
    const guardedIntegrity: EvidenceIntegrity = Object.freeze({
      canonical(this: Record<string, unknown>, value: unknown) {
        receivers.add(Object.keys(this).sort().join(","));
        return INTEGRITY.canonical(value);
      },
      hash(this: Record<string, unknown>, value: string) {
        receivers.add(Object.keys(this).sort().join(","));
        return INTEGRITY.hash(value);
      },
      sign: INTEGRITY.sign,
    });
    expect(Object.keys(createCityDecisionIntegrityView(guardedIntegrity)).sort())
      .toEqual(["canonical", "hash"]);
    expect(Object.keys(createCityEvidenceReplayIntegrity(guardedIntegrity)).sort())
      .toEqual(["canonical", "hash", "hashBytes"]);
    const fixture = await sealInput(packageFixture(guardedIntegrity));
    receivers.clear();

    const store = new SqliteCityEvidenceStore(database(), guardedIntegrity, fixture.packageReplay);
    store.seal(fixture.input);

    expect([...receivers].sort()).toEqual([
      "canonical,hash",
      "canonical,hash,sign",
    ]);
  });

  test("binds the safety ledger city to the signed City Evidence context at seal and load", async () => {
    const fixture = await crossCitySafetyMismatchInput();

    const sealDb = database();
    const sealStore = new SqliteCityEvidenceStore(sealDb, INTEGRITY, fixture.packageReplay);
    expect(() => sealStore.seal(fixture.mismatchedInput)).toThrow("integrity_mismatch");
    expect(sealDb.prepare("SELECT COUNT(*) AS count FROM evidence_snapshots").get())
      .toEqual({ count: 0 });

    const templateDb = database();
    const templateStore = new SqliteCityEvidenceStore(
      templateDb,
      INTEGRITY,
      fixture.packageReplay,
    );
    const template = templateStore.seal(fixture.validInput);
    const templateRow = templateDb.prepare(`
      SELECT canonical_payload FROM city_evidence_snapshots WHERE id = ?
    `).get(template.id) as { readonly canonical_payload: string };
    const mismatchedPayload = {
      ...(JSON.parse(templateRow.canonical_payload) as CityEvidencePayload),
      safetyAttemptLedger: fixture.mismatchedInput.safetyAttemptLedger,
    } satisfies CityEvidencePayload;

    const loadDb = database();
    await new SqliteEvidenceStore<SloveniaCityFactSourceId, CityEvidenceClaim>(loadDb)
      .seal(fixture.mismatchedInput.genericEvidence);
    insertSignedCityOverlay(loadDb, mismatchedPayload);
    const loadStore = new SqliteCityEvidenceStore(loadDb, INTEGRITY, fixture.packageReplay);
    expect(() => loadStore.loadVerified(template.id)).toThrow("integrity_mismatch");
  });

  test("uses the one injected canonicalizer for generic persistence and verified readback", async () => {
    // Break caught: prevalidating with the injected capability, then silently switching to canonicalJson.
    const defaultIntegrity = createEvidenceIntegrity(KEY);
    const alternateIntegrity = Object.freeze({
      canonical: (value: unknown) => `${defaultIntegrity.canonical(value)}\n`,
      hash: defaultIntegrity.hash,
      sign: defaultIntegrity.sign,
    });
    const db = database();
    const fixture = await sealInput(packageFixture(alternateIntegrity));
    const store = new SqliteCityEvidenceStore(db, alternateIntegrity, fixture.packageReplay);

    const sealed = store.seal(fixture.input);
    expect(store.loadVerified(sealed.id).snapshot).toEqual(sealed);
  });

  test("retries a canonically equivalent existing artifact under the injected canonicalizer", async () => {
    // Break caught: artifact retry switching back to canonicalJson after City validation used this capability.
    const alternateIntegrity: EvidenceIntegrity = Object.freeze({
      canonical: (value: unknown) => INTEGRITY.canonical(normalizeRequestBodySha(value)),
      hash: INTEGRITY.hash,
      sign: INTEGRITY.sign,
    });
    const db = database();
    const firstFixture = await verifiedRawSafetySealInput({
      integrity: alternateIntegrity,
      denominatorBodySha256: "c".repeat(64),
    });
    const retryFixture = await verifiedRawSafetySealInput({
      integrity: alternateIntegrity,
      denominatorBodySha256: "d".repeat(64),
    });
    const store = new SqliteCityEvidenceStore(
      db,
      alternateIntegrity,
      firstFixture.packageReplay,
    );

    const first = store.seal(firstFixture.input);
    expect(store.seal(retryFixture.input)).toEqual(first);
    expect(db.prepare("SELECT COUNT(*) AS count FROM artifacts").get()).toEqual({ count: 2 });
    expect(store.loadVerified(first.id).snapshot).toEqual(first);
  });

  test("atomically persists the supplied signed generic bundle and exact signed overlay", async () => {
    // Break caught: resealing generic Evidence, using a caller-chosen ID, or persisting either half alone.
    const db = database();
    const fixture = await sealInput();
    const store = new SqliteCityEvidenceStore(db, INTEGRITY, fixture.packageReplay);

    const snapshot = store.seal(fixture.input);
    const loaded = store.loadVerified(snapshot.id, context(fixture.input.catalogRevisionId));

    expect(snapshot.id).toBe(`${CITY_CHECK_RUN_ID}:evidence`);
    expect(snapshot.cityCheckRunId).toBe(CITY_CHECK_RUN_ID);
    expect(loaded.snapshot).toEqual(snapshot);
    expect(loaded.genericEvidence.snapshot).toEqual(fixture.input.genericEvidence.snapshot);
    expect(loaded.genericEvidence.manifest).toEqual(fixture.input.genericEvidence.manifest);
    expect(store.findVerifiedByCheckRunId(CITY_CHECK_RUN_ID)).toEqual(loaded);
    expect(db.prepare("SELECT COUNT(*) AS count FROM evidence_snapshots").get()).toEqual({ count: 1 });
    expect(db.prepare("SELECT COUNT(*) AS count FROM city_evidence_snapshots").get()).toEqual({ count: 1 });

    const row = db.prepare(`
      SELECT canonical_payload, payload_hash, hmac, evidence_rules_version
      FROM city_evidence_snapshots WHERE id = ?
    `).get(snapshot.id) as {
      readonly canonical_payload: string;
      readonly payload_hash: string;
      readonly hmac: string;
      readonly evidence_rules_version: string;
    };
    expect(row.payload_hash).toBe(INTEGRITY.hash(row.canonical_payload));
    expect(row.hmac).toBe(INTEGRITY.sign(row.canonical_payload));
    expect(row.evidence_rules_version).toBe(fixture.input.evidenceRulesVersion);

    expect(store.seal(fixture.input)).toEqual(snapshot);
    expect(() => db.prepare("UPDATE city_evidence_snapshots SET city_id = city_id").run())
      .toThrow("city_evidence_snapshot_is_immutable");
    expect(() => db.prepare("DELETE FROM city_evidence_snapshots").run())
      .toThrow("city_evidence_snapshot_is_immutable");
  });

  test("seals and replays producer-realistic verified raw safety artifacts", async () => {
    const db = database();
    const fixture = await verifiedRawSafetySealInput();
    const store = new SqliteCityEvidenceStore(db, INTEGRITY, fixture.packageReplay);

    const snapshot = store.seal(fixture.input);
    const loaded = store.loadVerified(snapshot.id);
    expect(loaded.snapshot.safetyAttemptLedger.result.kind).toBe("verified");
    expect(loaded.genericEvidence.entries[0]!.artifacts).toHaveLength(2);
    expect(loaded.genericEvidence.entries[0]!.artifacts.map(({ artifactId }) => artifactId))
      .toEqual(["municipal-safety-2025", "surs-population-2025"]);
    expect(loaded.genericEvidence.entries[0]!.artifacts[0]!.bytes)
      .not.toBe(fixture.input.artifacts[0]!.bytes);

    const expectedByte = loaded.genericEvidence.entries[0]!.artifacts[0]!.bytes[0];
    loaded.genericEvidence.entries[0]!.artifacts[0]!.bytes[0] = 0;
    expect(store.loadVerified(snapshot.id).genericEvidence.entries[0]!.artifacts[0]!.bytes[0])
      .toBe(expectedByte);
  });

  test("seals and replays all three canonical transient safety projections through SQLite", async () => {
    // Break caught: treating retained JSON bytes as raw source bytes or skipping navigation replay on load.
    const db = database();
    const fixture = await verifiedTransientSafetySealInput();
    const store = new SqliteCityEvidenceStore(db, INTEGRITY, fixture.packageReplay);

    const snapshot = store.seal(fixture.input);
    const loaded = store.loadVerified(snapshot.id);

    expect(loaded.snapshot.safetyAttemptLedger.result.kind).toBe("verified");
    expect(loaded.genericEvidence.entries[0]!.artifacts.map(({ mediaType }) => mediaType))
      .toEqual(["application/json", "application/json", "application/json"]);
    expect(loaded.genericEvidence.entries[0]!.artifacts.map(({ artifactId }) => artifactId))
      .toEqual([
        "municipal-retained-navigation",
        "municipal-retained-terminal",
        "surs-retained-2025",
      ]);
  });

  test("binds a verified fixed terminal claim to its accepted artifact on seal and load", async () => {
    // Break caught: accepting a verified fixed result without replaying its terminal claim/artifact ownership.
    const db = database();
    const fixture = await verifiedFixedSealInput();
    const store = new SqliteCityEvidenceStore(db, INTEGRITY, fixture.packageReplay);

    const snapshot = store.seal(fixture.input);
    const loaded = store.loadVerified(snapshot.id);

    expect(loaded.snapshot.fixedAttemptLedgers[0].result).toEqual({
      kind: "verified",
      claimIds: ["rent-fixed-claim-2025"],
    });
    expect(loaded.genericEvidence.entries[1]!.artifacts.map(({ artifactId }) => artifactId))
      .toEqual(["rent-fixed-artifact-2025"]);
    expect(loaded.genericEvidence.snapshot.claims.find(
      ({ claimId }) => claimId === "rent-fixed-claim-2025",
    )?.anchor.artifactId).toBe("rent-fixed-artifact-2025");
  });

  test("allows one cached SURS artifact acquired before a later search-origin reuse", async () => {
    // Break caught: applying each later origin timestamp to an already acquired repeated artifact.
    const db = database();
    const fixture = await cachedDenominatorReuseSealInput();
    const store = new SqliteCityEvidenceStore(db, INTEGRITY, fixture.packageReplay);

    const snapshot = store.seal(fixture.input);
    const loaded = store.loadVerified(snapshot.id);
    const occurrences = loaded.snapshot.safetyAttemptLedger.candidates.flatMap(
      ({ artifactRefs }) => artifactRefs.filter(
        ({ artifactId }) => artifactId === "surs-shared-denominator",
      ),
    );

    expect(occurrences).toHaveLength(2);
    expect(loaded.genericEvidence.entries[0]!.artifacts.filter(
      ({ artifactId }) => artifactId === "surs-shared-denominator",
    )).toHaveLength(1);
    expect(loaded.snapshot.safetyAttemptLedger.queries[0]!.searchedAt)
      .toBe("2026-03-01T12:00:02.000Z");
    expect(loaded.genericEvidence.entries[0]!.artifacts.find(
      ({ artifactId }) => artifactId === "surs-shared-denominator",
    )?.capturedAt).toBe("2026-03-01T12:00:00.500Z");
  });

  test("rejects a first-acquired SURS artifact captured before its search origin", async () => {
    const fixture = await cachedDenominatorReuseSealInput(true);
    const searchedAt = "2026-03-01T12:00:02.251Z";
    const invalidLedger: CitySafetyAttemptLedger = {
      ...fixture.input.safetyAttemptLedger,
      queries: [{ ...fixture.input.safetyAttemptLedger.queries[0]!, searchedAt }],
    };

    const sealDb = database();
    const sealStore = new SqliteCityEvidenceStore(sealDb, INTEGRITY, fixture.packageReplay);
    expect(() => sealStore.seal({
      ...fixture.input,
      safetyAttemptLedger: invalidLedger,
    })).toThrow("integrity_mismatch");
    expect(sealDb.prepare("SELECT COUNT(*) AS count FROM evidence_snapshots").get())
      .toEqual({ count: 0 });

    const loadDb = database();
    const loadStore = new SqliteCityEvidenceStore(loadDb, INTEGRITY, fixture.packageReplay);
    const snapshot = loadStore.seal(fixture.input);
    rewriteStoredOverlay(loadDb, snapshot.id, (payload) => {
      payload.safetyAttemptLedger.queries[0]!.searchedAt = searchedAt;
    });
    expect(() => loadStore.loadVerified(snapshot.id)).toThrow("integrity_mismatch");
  });

  test("rejects a self-prior edge at both seal and load", async () => {
    const fixture = await verifiedRawSafetySealInput({ sequence: 0 });
    const snapshotId = fixture.input.genericEvidence.snapshot.id;
    const sourcePlanId = fixture.input.safetyAttemptLedger.sourcePlanId;

    const sealDb = database();
    const sealStore = new SqliteCityEvidenceStore(sealDb, INTEGRITY, fixture.packageReplay);
    expect(() => sealStore.seal({
      ...fixture.input,
      safetyAttemptLedger: withPriorOrigin(
        fixture.input.safetyAttemptLedger,
        snapshotId,
        sourcePlanId,
      ),
    })).toThrow("integrity_mismatch");

    const loadDb = database();
    const loadStore = new SqliteCityEvidenceStore(loadDb, INTEGRITY, fixture.packageReplay);
    loadStore.seal(fixture.input);
    rewriteStoredPriorOrigin(loadDb, snapshotId, snapshotId, sourcePlanId);
    expect(() => loadStore.loadVerified(snapshotId)).toThrow("integrity_mismatch");
  });

  test("rejects a two-node prior cycle at both seal and load", async () => {
    const first = await verifiedRawSafetySealInput({ sequence: 10 });
    const second = await verifiedRawSafetySealInput({
      sequence: 11,
      priorEvidenceSnapshotId: first.input.genericEvidence.snapshot.id,
    });
    const db = database();
    const store = new SqliteCityEvidenceStore(db, INTEGRITY, first.packageReplay);
    store.seal(first.input);
    store.seal(second.input);
    rewriteStoredPriorOrigin(
      db,
      first.input.genericEvidence.snapshot.id,
      second.input.genericEvidence.snapshot.id,
      first.input.safetyAttemptLedger.sourcePlanId,
    );

    expect(() => store.seal(second.input)).toThrow("integrity_mismatch");
    expect(() => store.loadVerified(second.input.genericEvidence.snapshot.id))
      .toThrow("integrity_mismatch");
  });

  test("rejects a longer prior cycle at both seal and load", async () => {
    const fixtures: Awaited<ReturnType<typeof verifiedRawSafetySealInput>>[] = [];
    for (let sequence = 20; sequence < 24; sequence += 1) {
      fixtures.push(await verifiedRawSafetySealInput({
        sequence,
        ...(fixtures.length === 0
          ? {}
          : { priorEvidenceSnapshotId: fixtures.at(-1)!.input.genericEvidence.snapshot.id }),
      }));
    }
    const db = database();
    const store = new SqliteCityEvidenceStore(db, INTEGRITY, fixtures[0]!.packageReplay);
    fixtures.forEach(({ input }) => store.seal(input));
    const first = fixtures[0]!.input;
    const last = fixtures.at(-1)!.input;
    rewriteStoredPriorOrigin(
      db,
      first.genericEvidence.snapshot.id,
      last.genericEvidence.snapshot.id,
      first.safetyAttemptLedger.sourcePlanId,
    );

    expect(() => store.seal(last)).toThrow("integrity_mismatch");
    expect(() => store.loadVerified(last.genericEvidence.snapshot.id))
      .toThrow("integrity_mismatch");
  });

  test("seals and loads a long acyclic prior chain without recursive traversal", async () => {
    const db = database();
    let priorEvidenceSnapshotId: string | undefined;
    let store: SqliteCityEvidenceStore | undefined;
    let tailId: string | undefined;
    for (let sequence = 100; sequence < 164; sequence += 1) {
      const fixture = await verifiedRawSafetySealInput({
        sequence,
        ...(priorEvidenceSnapshotId === undefined ? {} : { priorEvidenceSnapshotId }),
      });
      store ??= new SqliteCityEvidenceStore(db, INTEGRITY, fixture.packageReplay);
      tailId = store.seal(fixture.input).id;
      priorEvidenceSnapshotId = tailId;
    }

    expect(tailId).toBe("city-check:si:ljubljana:chain-163:evidence");
    expect(store!.loadVerified(tailId!).snapshot.id).toBe(tailId);
  }, 30_000);

  test("rejects reordered, byte-drifted and provenance-drifted artifact unions", async () => {
    const mutations = [
      (artifacts: LiveCapturedArtifact<SloveniaCityFactSourceId>[]) => artifacts.reverse(),
      (artifacts: LiveCapturedArtifact<SloveniaCityFactSourceId>[]) => {
        artifacts[0]!.bytes[0] ^= 0xff;
      },
      (artifacts: LiveCapturedArtifact<SloveniaCityFactSourceId>[]) => {
        artifacts[0] = { ...artifacts[0]!, responseUrl: "https://ljubljana.si/unrelated" };
      },
    ];
    for (const mutate of mutations) {
      const db = database();
      const fixture = await verifiedRawSafetySealInput();
      const artifacts = fixture.input.artifacts.map((artifact) => ({
        ...artifact,
        bytes: new Uint8Array(artifact.bytes),
      }));
      mutate(artifacts);
      const store = new SqliteCityEvidenceStore(db, INTEGRITY, fixture.packageReplay);
      expect(() => store.seal({ ...fixture.input, artifacts })).toThrow("integrity_mismatch");
      expect(db.prepare("SELECT COUNT(*) AS count FROM evidence_snapshots").get())
        .toEqual({ count: 0 });
    }
  });

  test("rejects supplied manifest/signature drift before the first write", async () => {
    // Break caught: accepting an already sealed-looking bundle without authenticating its original signature.
    const db = database();
    const fixture = await sealInput();
    const store = new SqliteCityEvidenceStore(db, INTEGRITY, fixture.packageReplay);
    const forged = {
      ...fixture.input,
      genericEvidence: {
        ...fixture.input.genericEvidence,
        canonicalManifest: `${fixture.input.genericEvidence.canonicalManifest} `,
      },
    };

    expect(() => store.seal(forged)).toThrow("integrity_mismatch");
    expect(db.prepare("SELECT COUNT(*) AS count FROM evidence_snapshots").get()).toEqual({ count: 0 });
    expect(db.prepare("SELECT COUNT(*) AS count FROM city_evidence_snapshots").get()).toEqual({ count: 0 });
  });

  test("takes descriptor-safe ownership before package or integrity callbacks", async () => {
    // Break caught: a getter or reentrant callback changing borrowed metadata after partial validation.
    const db = database();
    const fixture = await sealInput();
    const packageReplay = { loadExactReplayContract: vi.fn(fixture.packageReplay.loadExactReplayContract) };
    const store = new SqliteCityEvidenceStore(db, INTEGRITY, packageReplay);
    const borrowed = { ...fixture.input } as Record<string, unknown>;
    Object.defineProperty(borrowed, "cityId", {
      enumerable: true,
      get: () => CITY_ID,
    });

    expect(() => store.seal(borrowed as unknown as CityEvidenceSealInput))
      .toThrow("integrity_mismatch");
    expect(packageReplay.loadExactReplayContract).not.toHaveBeenCalled();
    expect(db.prepare("SELECT COUNT(*) AS count FROM evidence_snapshots").get()).toEqual({ count: 0 });
  });

  test("rejects decorated byte views before package or integrity callbacks", async () => {
    const db = database();
    const fixture = await verifiedRawSafetySealInput();
    const packageReplay = { loadExactReplayContract: vi.fn(fixture.packageReplay.loadExactReplayContract) };
    const decorated = new Uint8Array(fixture.input.artifacts[0]!.bytes);
    Object.defineProperty(decorated, Symbol("unsigned-byte-metadata"), {
      value: "forged",
      enumerable: true,
    });
    const store = new SqliteCityEvidenceStore(db, INTEGRITY, packageReplay);

    expect(() => store.seal({
      ...fixture.input,
      artifacts: [{ ...fixture.input.artifacts[0]!, bytes: decorated }, ...fixture.input.artifacts.slice(1)],
    })).toThrow("integrity_mismatch");
    expect(packageReplay.loadExactReplayContract).not.toHaveBeenCalled();
    expect(db.prepare("SELECT COUNT(*) AS count FROM evidence_snapshots").get()).toEqual({ count: 0 });
  });

  test("rejects a missing exact package replay contract and ledger chronology inversion", async () => {
    // Break caught: following latest package semantics or checking only the outer completion timestamp.
    const firstDb = database();
    const fixture = await sealInput();
    const missing = new SqliteCityEvidenceStore(firstDb, INTEGRITY, {
      loadExactReplayContract: () => undefined,
    });
    expect(() => missing.seal(fixture.input)).toThrow("city_package_revision_not_installed");
    expect(firstDb.prepare("SELECT COUNT(*) AS count FROM evidence_snapshots").get()).toEqual({ count: 0 });

    const secondDb = database();
    const chronological = new SqliteCityEvidenceStore(secondDb, INTEGRITY, fixture.packageReplay);
    const firstLedger = fixture.input.fixedAttemptLedgers[0];
    expect(() => chronological.seal({
      ...fixture.input,
      fixedAttemptLedgers: [{
        ...firstLedger,
        completedAt: "2026-02-28T23:59:59.999Z",
      }, fixture.input.fixedAttemptLedgers[1], fixture.input.fixedAttemptLedgers[2]],
    })).toThrow("integrity_mismatch");
    expect(secondDb.prepare("SELECT COUNT(*) AS count FROM city_evidence_snapshots").get())
      .toEqual({ count: 0 });
  });

  test("normalizes malformed prior origins to an integrity mismatch", async () => {
    // Break caught: destructuring an untrusted null candidate origin before boundary validation.
    const db = database();
    const fixture = await sealInput();
    const store = new SqliteCityEvidenceStore(db, INTEGRITY, fixture.packageReplay);
    const candidate = fixture.input.safetyAttemptLedger.candidates[0]!;
    const malformedLedger = {
      ...fixture.input.safetyAttemptLedger,
      candidates: [{ ...candidate, origin: null }],
    } as unknown as CitySafetyAttemptLedger;

    expect(() => store.seal({
      ...fixture.input,
      safetyAttemptLedger: malformedLedger,
    })).toThrow("integrity_mismatch");
    expect(db.prepare("SELECT COUNT(*) AS count FROM evidence_snapshots").get())
      .toEqual({ count: 0 });
  });

  test("rejects a non-canonical fixed artifact capture instant", async () => {
    // Break caught: comparing raw timestamp strings without first validating the instant grammar.
    const db = database();
    const fixture = await verifiedFixedSealInput("2026-03-01T00:00:00Z");
    const store = new SqliteCityEvidenceStore(db, INTEGRITY, fixture.packageReplay);

    expect(() => store.seal(fixture.input)).toThrow("integrity_mismatch");
    expect(db.prepare("SELECT COUNT(*) AS count FROM evidence_snapshots").get())
      .toEqual({ count: 0 });
  });

  test("rejects replay Registry, catalog and fixed-plan drift at both seal and load", async () => {
    // Break caught: trusting a visible replay projection after exact-key lookup without reconstruction.
    const mutations = [
      ["Registry root", (contract: CityPackageEvidenceReplayContract) => ({
        ...contract,
        catalogProjection: {
          ...contract.catalogProjection,
          registry: { ...contract.catalogProjection.registry, id: "city-registry:forged" },
        },
      })],
      ["catalog root", (contract: CityPackageEvidenceReplayContract) => ({
        ...contract,
        catalogProjection: {
          ...contract.catalogProjection,
          catalog: { ...contract.catalogProjection.catalog, id: "city-catalog:forged" },
        },
      })],
      ["fixed plan", (contract: CityPackageEvidenceReplayContract) => {
        const tuple = contract.fixedPlansByCityId[CITY_ID]!;
        return {
          ...contract,
          fixedPlansByCityId: {
            [CITY_ID]: [{
              ...tuple[0],
              routes: [{
                ...tuple[0].routes[0]!,
                navigationUrl: "https://official.example/forged-rent-route",
              }],
            }, tuple[1], tuple[2]] as typeof tuple,
          },
        };
      }],
    ] as const;

    for (const [name, mutate] of mutations) {
      const fixture = packageFixture();
      const sealed = await sealInput(fixture);
      const driftedPort: CityEvidencePackageReplayPort = {
        loadExactReplayContract: () => mutate(fixture.contract),
      };
      const sealDb = database();
      expect(
        () => new SqliteCityEvidenceStore(sealDb, INTEGRITY, driftedPort).seal(sealed.input),
        `${name} seal`,
      ).toThrow("integrity_mismatch");
      expect(sealDb.prepare("SELECT COUNT(*) AS count FROM evidence_snapshots").get())
        .toEqual({ count: 0 });

      const loadDb = database();
      const validStore = new SqliteCityEvidenceStore(loadDb, INTEGRITY, sealed.packageReplay);
      const snapshot = validStore.seal(sealed.input);
      expect(
        () => new SqliteCityEvidenceStore(loadDb, INTEGRITY, driftedPort).loadVerified(snapshot.id),
        `${name} load`,
      ).toThrow("integrity_mismatch");
    }
  });

  test("rejects an orphan overlay but recovers a generic-only committed bundle", async () => {
    // Break caught: silently pairing an existing overlay with a newly supplied generic parent.
    const orphanDb = database();
    const orphanFixture = await sealInput();
    const orphanStore = new SqliteCityEvidenceStore(
      orphanDb,
      INTEGRITY,
      orphanFixture.packageReplay,
    );
    orphanStore.seal(orphanFixture.input);
    orphanDb.exec("DROP TRIGGER evidence_snapshots_no_delete");
    orphanDb.pragma("foreign_keys = OFF");
    orphanDb.prepare("DELETE FROM evidence_snapshots WHERE id = ?")
      .run(`${CITY_CHECK_RUN_ID}:evidence`);
    expect(() => orphanStore.seal(orphanFixture.input)).toThrow("integrity_mismatch");
    expect(orphanDb.prepare("SELECT COUNT(*) AS count FROM evidence_snapshots").get())
      .toEqual({ count: 0 });
    expect(orphanDb.prepare("SELECT COUNT(*) AS count FROM city_evidence_snapshots").get())
      .toEqual({ count: 1 });

    const recoveryDb = database();
    const recoveryFixture = await sealInput();
    await new SqliteEvidenceStore<SloveniaCityFactSourceId, CityEvidenceClaim>(recoveryDb)
      .seal(recoveryFixture.input.genericEvidence);
    const recoveryStore = new SqliteCityEvidenceStore(
      recoveryDb,
      INTEGRITY,
      recoveryFixture.packageReplay,
    );
    expect(recoveryStore.seal(recoveryFixture.input).id).toBe(`${CITY_CHECK_RUN_ID}:evidence`);
    expect(recoveryDb.prepare("SELECT COUNT(*) AS count FROM evidence_snapshots").get())
      .toEqual({ count: 1 });
    expect(recoveryDb.prepare("SELECT COUNT(*) AS count FROM city_evidence_snapshots").get())
      .toEqual({ count: 1 });
  });

  test("rejects an extra fourth fixed ledger instead of silently truncating it", async () => {
    const db = database();
    const fixture = await sealInput();
    const store = new SqliteCityEvidenceStore(db, INTEGRITY, fixture.packageReplay);
    const overlong = [
      ...fixture.input.fixedAttemptLedgers,
      fixture.input.fixedAttemptLedgers[2],
    ];

    expect(() => store.seal({
      ...fixture.input,
      fixedAttemptLedgers: overlong,
    } as unknown as CityEvidenceSealInput)).toThrow("integrity_mismatch");
    expect(db.prepare("SELECT COUNT(*) AS count FROM evidence_snapshots").get())
      .toEqual({ count: 0 });
  });

  test("reads back an exact lost overlay race and rejects a conflicting winner", async () => {
    // Break caught: returning the prepared snapshot without verifying which row won the unique insert.
    const exactDb = database();
    const exactFixture = await sealInput();
    installOverlayRaceTrigger(exactDb);
    const exactStore = new SqliteCityEvidenceStore(exactDb, INTEGRITY, exactFixture.packageReplay);
    const exact = exactStore.seal(exactFixture.input);
    expect(exactStore.loadVerified(exact.id).snapshot).toEqual(exact);

    const conflictDb = database();
    const conflictFixture = await sealInput();
    installOverlayRaceTrigger(conflictDb, "'frontier:forged'");
    const conflictStore = new SqliteCityEvidenceStore(
      conflictDb,
      INTEGRITY,
      conflictFixture.packageReplay,
    );
    expect(() => conflictStore.seal(conflictFixture.input)).toThrow("integrity_mismatch");
    expect(conflictDb.prepare("SELECT COUNT(*) AS count FROM evidence_snapshots").get())
      .toEqual({ count: 0 });
    expect(conflictDb.prepare("SELECT COUNT(*) AS count FROM city_evidence_snapshots").get())
      .toEqual({ count: 0 });
  });

  test("rejects same-ID semantic drift and signed-row tampering on load", async () => {
    const db = database();
    const fixture = await sealInput();
    const store = new SqliteCityEvidenceStore(db, INTEGRITY, fixture.packageReplay);
    store.seal(fixture.input);

    const first = fixture.input.fixedAttemptLedgers[0];
    expect(() => store.seal({
      ...fixture.input,
      fixedAttemptLedgers: [{
        ...first,
        completedAt: "2026-03-01T12:00:01.500Z",
      }, fixture.input.fixedAttemptLedgers[1], fixture.input.fixedAttemptLedgers[2]],
    })).toThrow("integrity_mismatch");

    db.exec("DROP TRIGGER city_evidence_snapshots_no_update");
    db.prepare("UPDATE city_evidence_snapshots SET hmac = ? WHERE id = ?")
      .run("0".repeat(64), `${CITY_CHECK_RUN_ID}:evidence`);
    expect(() => store.loadVerified(`${CITY_CHECK_RUN_ID}:evidence`))
      .toThrow("integrity_mismatch");
  });

  test("rejects stored artifact bytes and correctly re-signed generic or overlay semantic drift", async () => {
    // Break caught: treating a replacement signature as permission to skip package/ledger replay.
    const artifactDb = database();
    const artifactFixture = await verifiedRawSafetySealInput();
    const artifactStore = new SqliteCityEvidenceStore(
      artifactDb,
      INTEGRITY,
      artifactFixture.packageReplay,
    );
    const artifactSnapshot = artifactStore.seal(artifactFixture.input);
    artifactDb.exec("DROP TRIGGER artifacts_no_update");
    const originalBytes = artifactFixture.input.artifacts[0]!.bytes;
    artifactDb.prepare("UPDATE artifacts SET bytes = ? WHERE artifact_id = ?")
      .run(new Uint8Array(originalBytes.byteLength), artifactFixture.input.artifacts[0]!.artifactId);
    expect(() => artifactStore.loadVerified(artifactSnapshot.id)).toThrow("integrity_mismatch");

    const genericDb = database();
    const genericFixture = await sealInput();
    const genericStore = new SqliteCityEvidenceStore(genericDb, INTEGRITY, genericFixture.packageReplay);
    const genericSnapshot = genericStore.seal(genericFixture.input);
    genericDb.exec("DROP TRIGGER evidence_snapshots_no_update");
    const genericRow = genericDb.prepare(`
      SELECT snapshot_json, manifest_json FROM evidence_snapshots WHERE id = ?
    `).get(genericSnapshot.id) as { readonly snapshot_json: string; readonly manifest_json: string };
    const storedSnapshot = JSON.parse(genericRow.snapshot_json) as Record<string, unknown>;
    const storedManifest = JSON.parse(genericRow.manifest_json) as {
      entries: { navigationUrl: string }[];
    };
    storedManifest.entries[1]!.navigationUrl = "https://official.example/forged-rent-route";
    const canonicalManifest = INTEGRITY.canonical(storedManifest);
    const manifestHash = INTEGRITY.hash(canonicalManifest);
    const manifestHmac = INTEGRITY.sign(canonicalManifest);
    storedSnapshot.manifestHash = manifestHash;
    storedSnapshot.hmac = manifestHmac;
    genericDb.prepare(`
      UPDATE evidence_snapshots
      SET snapshot_json = ?, manifest_json = ?, manifest_hash = ?, hmac = ?
      WHERE id = ?
    `).run(
      INTEGRITY.canonical(storedSnapshot),
      canonicalManifest,
      manifestHash,
      manifestHmac,
      genericSnapshot.id,
    );
    expect(() => genericStore.loadVerified(genericSnapshot.id)).toThrow("integrity_mismatch");

    const overlayDb = database();
    const overlayFixture = await sealInput();
    const overlayStore = new SqliteCityEvidenceStore(overlayDb, INTEGRITY, overlayFixture.packageReplay);
    const overlaySnapshot = overlayStore.seal(overlayFixture.input);
    overlayDb.exec("DROP TRIGGER city_evidence_snapshots_no_update");
    const overlayRow = overlayDb.prepare(`
      SELECT canonical_payload FROM city_evidence_snapshots WHERE id = ?
    `).get(overlaySnapshot.id) as { readonly canonical_payload: string };
    const payload = JSON.parse(overlayRow.canonical_payload) as {
      fixedAttemptLedgers: { planId: string }[];
    };
    payload.fixedAttemptLedgers[0]!.planId = "forged-plan";
    const canonicalPayload = INTEGRITY.canonical(payload);
    overlayDb.prepare(`
      UPDATE city_evidence_snapshots
      SET canonical_payload = ?, payload_hash = ?, hmac = ?
      WHERE id = ?
    `).run(
      canonicalPayload,
      INTEGRITY.hash(canonicalPayload),
      INTEGRITY.sign(canonicalPayload),
      overlaySnapshot.id,
    );
    expect(() => overlayStore.loadVerified(overlaySnapshot.id)).toThrow("integrity_mismatch");
  });
});
