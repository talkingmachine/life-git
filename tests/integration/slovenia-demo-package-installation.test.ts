import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import type { InstallCityPackageInput } from "../../src/application/install-city-package";
import { createCityPackageInstallationComposition } from "../../src/infrastructure/city-package-installation-composition";
import {
  getSloveniaDemoCityBehaviorPolicy,
  getSloveniaDemoCityEvaluatorRegistry,
  getSloveniaDemoCityPackageDefinition,
  SLOVENIA_DEMO_CITY_APPROVED_DEFAULTS,
  SLOVENIA_DEMO_CITY_CRITERIA_DEFAULTS,
} from "../../src/decision/slovenia-demo-city-policy";
import { buildCityCatalogRevision, buildCityRegistryRevision } from "../../src/decision/city-catalog";
import { CITY_CRITERION_IDS, type InstalledCityCriteriaDefaults, type InstalledCityCriterionDefinitionTuple } from "../../src/decision/city-criteria";
import { canonicalJson, createEvidenceIntegrity, sha256Text } from "../../src/infrastructure/integrity";
import { InstalledCityPackages } from "../../src/infrastructure/sources/installed-city-packages";
import { SqliteCityPackageManifestStore } from "../../src/infrastructure/sqlite/city-package-manifest-store";
import { openEvidenceDatabase } from "../../src/infrastructure/sqlite/db";
import { createSloveniaDemoCityInstallationPolicy, deriveSloveniaDemoPackageRelationView, loadCheckedInSloveniaDemoPackage, reconstructSealedSloveniaDemoPackageBundle } from "../../src/infrastructure/sources/slovenia-demo-package-bundle";
import type { CityFixedSourcePlan, SloveniaCityFixedSourceId } from "../../src/research/city-evidence";
import { getCityResearchPackageAvailability } from "../../src/research/city-package";
import { buildCitySafetySourcePlan, buildOfficialAuthorityDirectory } from "../../src/research/city-safety-source-plan";
import { SLOVENIA_CITY_FACT_VERSIONS } from "../../src/research/slovenia-city-plan";

const KEY = "si-demo-package-test-integrity-key-at-least-32-bytes";
const INTEGRITY = createEvidenceIntegrity(KEY);
const DIRECTORIES: string[] = [];
const DATABASES: Database.Database[] = [];
const DEFINITION = Object.freeze({ countryCode: "SI", packageId: "si-demo-city-package", packageSchemaVersion: "si-demo-city-package@1", evidenceRulesVersion: "si-demo-city-evidence@1" });
// Independently reviewed test pin.  Replace only after explicitly reviewing a new fixture graph.
const REVIEWED_TEST_MANIFEST_DIGEST = "6b7529d6037bc8ac2c267c9856699b625566e14dfe5e0499b4a94492f5069689";
const REVIEWED_TEST_INPUT_DIGEST = "762a4d7b8549880a8d4436f3275fdac9a7c3346a5d24f3262ef6f56db7f6f7c2";

afterEach(() => {
  for (const database of DATABASES.splice(0)) if (database.open) database.close();
  for (const directory of DIRECTORIES.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function temporaryDatabasePath(): string {
  const directory = mkdtempSync(join(tmpdir(), "si-demo-package-"));
  DIRECTORIES.push(directory);
  return join(directory, "package.sqlite");
}
function openDatabase(path: string): Database.Database { const database = openEvidenceDatabase(path); DATABASES.push(database); return database; }
function tableCount(database: Database.Database, table: string): number { return database.prepare(`SELECT COUNT(*) FROM ${table}`).pluck().get() as number; }
function databaseCounts(database: Database.Database) {
  return { catalogs: tableCount(database, "city_catalog_revisions"), evidence: tableCount(database, "evidence_snapshots"), artifacts: tableCount(database, "artifacts"), manifests: tableCount(database, "installed_city_package_manifests"), heads: tableCount(database, "installed_city_package_heads") };
}

function testInstallationPolicy() {
  const ready = Object.freeze({
    definition: getSloveniaDemoCityPackageDefinition(),
    sourceContractStatus: "bounded_verified_or_unknown" as const,
    readiness: Object.freeze({ status: "ready" as const, issues: Object.freeze([] as const) }),
  });
  return Object.freeze({
    resolveAvailability: (countryCode: string) => countryCode === "SI" ? ready : undefined,
    approvedDefaults: SLOVENIA_DEMO_CITY_APPROVED_DEFAULTS,
    behaviors: Object.freeze({
      schemaVersion: "installed-city-package-behavior-registry@1" as const,
      entries: Object.freeze([getSloveniaDemoCityBehaviorPolicy()]),
    }),
  });
}

function fixedPlan<S extends SloveniaCityFixedSourceId>(sourceId: S): CityFixedSourcePlan<S> {
  const criterionId = sourceId === "si-city-long-term-rent" ? "long_term_rent" : sourceId === "si-city-urban-transit" ? "urban_transit" : "fixed_broadband";
  return { planId: `ljubljana:${sourceId}:demo@1`, sourceId, cityId: "ljubljana", criterionId, definitionId: `${criterionId}-definition@1`, claimContract: { sourceId, criterionId, definitionId: `${criterionId}-definition@1`, scope: "municipality:ljubljana", officialAreaId: "061", geoScope: "municipality", unit: "canonical-unit", denominator: "canonical-denominator", freshnessPolicyVersion: "si-demo-bounded-unknown@1", valueKind: "canonical_scalar", valuePolicyVersion: "si-demo-bounded-value@1", sourcePeriodPolicyVersion: "si-demo-bounded-period@1" }, routes: [{ routeId: `${sourceId}:primary`, navigationUrl: `https://gov.si/${sourceId}/ljubljana` }], parserVersion: SLOVENIA_CITY_FACT_VERSIONS[sourceId].parserVersion, rulesVersion: SLOVENIA_CITY_FACT_VERSIONS[sourceId].rulesVersion } as unknown as CityFixedSourcePlan<S>;
}

function validInstallInput(): InstallCityPackageInput {
  const evidenceSnapshotId = "si-demo-ljubljana-catalog-evidence@1";
  const registry = buildCityRegistryRevision({ packageId: DEFINITION.packageId, packageSchemaVersion: DEFINITION.packageSchemaVersion, countryCode: "SI", evidenceSnapshotId, entries: [{ cityId: "ljubljana", countryCode: "SI", officialName: "Ljubljana", coordinate: { lat: 46.0569, lng: 14.5058 }, administrativeType: "settlement", administrativeTerritory: "Mestna občina Ljubljana", capitalRoles: ["national"], evidenceReferenceIds: [evidenceSnapshotId] }], createdAt: "2026-08-30T00:00:00.000Z" }, INTEGRITY);
  const catalog = buildCityCatalogRevision({ registry, evidenceSnapshotId, populationDefinition: { definitionId: "surs-settlement-population@1", geoScope: "settlement", unit: "people" }, candidateBasis: [{ cityId: "ljubljana", comparablePopulation: { kind: "verified", value: "300000", referencePeriod: "2025" } }], coverage: { status: "incomplete", reasons: ["official_universe_partial"] }, createdAt: "2026-08-30T00:00:00.000Z" }, INTEGRITY);
  const publisher = (publisherId: string, authorityKind: "police" | "government" | "open_data" | "statistics" | "municipality", navigationUrl: string) => ({ publisherId, authorityKind, navigationUrl, allowedHosts: [new URL(navigationUrl).hostname], delegatedDocumentHosts: publisherId === "municipality-ljubljana" ? ["cdn.ljubljana.si"] : [], allowedMediaTypes: ["application/pdf"], maxBytes: 1_000_000, redirectPolicyVersion: "official-chain@1" as const, documentLocatorPolicyId: `${publisherId}-locator@1`, retentionPolicyId: `${publisherId}-retention@1`, retentionMode: "seal_raw_artifact" as const });
  const directory = buildOfficialAuthorityDirectory({ schemaVersion: "official-authority-directory@1", countryCode: "SI", catalogRevisionId: catalog.id, requiredPublisherIds: { police: "police", gov: "gov", opsi: "opsi", surs: "surs" }, publishers: [publisher("municipality-ljubljana", "municipality", "https://ljubljana.si/"), publisher("police", "police", "https://policija.si/"), publisher("gov", "government", "https://gov.si/"), publisher("opsi", "open_data", "https://podatki.gov.si/"), publisher("surs", "statistics", "https://pxweb.stat.si/")], municipalities: [{ cityId: "ljubljana", settlementCode: "061001", municipalityCode: "061", officialCityNames: ["Ljubljana"], officialMunicipalityNames: ["Mestna občina Ljubljana"], publisherId: "municipality-ljubljana", officialHost: "ljubljana.si" }], rulesVersion: "slovenia-official-authorities@1" }, INTEGRITY);
  const safetySourcePlan = buildCitySafetySourcePlan({ catalog, directory, entries: [{ cityId: "ljubljana", settlementCode: "061001", municipalityCode: "061", officialCityNames: ["Ljubljana"], officialMunicipalityNames: ["Mestna občina Ljubljana"], publisherIds: ["municipality-ljubljana", "police", "surs"], configuredRoutes: [{ publisherId: "municipality-ljubljana", navigationUrl: "https://ljubljana.si/safety" }] }] }, INTEGRITY);
  const criterionEvaluators = getSloveniaDemoCityEvaluatorRegistry();
  const criteriaDefaults: InstalledCityCriteriaDefaults = structuredClone(SLOVENIA_DEMO_CITY_CRITERIA_DEFAULTS);
  return { countryCode: "SI", installedAt: "2026-08-30T00:00:00.000Z", catalogProjection: { registry, catalog }, fixedPlansByCityId: { ljubljana: [fixedPlan("si-city-long-term-rent"), fixedPlan("si-city-urban-transit"), fixedPlan("si-city-fixed-broadband")] }, safetySourcePlan, officialAuthorityDirectory: directory, criteriaDefaults, criterionDefinitions: CITY_CRITERION_IDS.map((id) => ({ ...criterionEvaluators[id].definition, compatibleGeoScopes: [...criterionEvaluators[id].definition.compatibleGeoScopes] })) as unknown as InstalledCityCriterionDefinitionTuple };
}

function sealed(input = validInstallInput()) {
  const relationView = deriveSloveniaDemoPackageRelationView(input);
  expect(sha256Text(canonicalJson(input))).toBe(REVIEWED_TEST_INPUT_DIGEST);
  const captures = [{ artifactId: "demo-capture@1", publisherId: "municipality-ljubljana", sourceUrl: "https://ljubljana.si/safety", sha256: "a".repeat(64), capturedAt: "2026-08-30T00:00:00.000Z", authorityTrace: { kind: "direct_allowed_host" as const } }];
  const manifest = { packageId: DEFINITION.packageId, packageSchemaVersion: DEFINITION.packageSchemaVersion, evidenceRulesVersion: DEFINITION.evidenceRulesVersion, catalogScopePolicy: "subjective-relocation-demo@1", cityIds: ["ljubljana"], captures, relationView };
  expect(sha256Text(canonicalJson(manifest))).toBe(REVIEWED_TEST_MANIFEST_DIGEST);
  const lock = { schemaVersion: "si-demo-city-policy-lock@1", packageId: DEFINITION.packageId, packageSchemaVersion: DEFINITION.packageSchemaVersion, evidenceRulesVersion: DEFINITION.evidenceRulesVersion, bundleManifestSha256: REVIEWED_TEST_MANIFEST_DIGEST, installInputSha256: REVIEWED_TEST_INPUT_DIGEST, cityIds: manifest.cityIds, captures, relationView };
  return reconstructSealedSloveniaDemoPackageBundle({ schemaVersion: "si-demo-city-acquisition-bundle@1", manifest, installInput: input }, lock);
}

async function installThroughBetaGate(
  database: Database.Database,
  bundle: unknown,
  lock: unknown,
) {
  const policy = testInstallationPolicy();
  const composition = createCityPackageInstallationComposition({
    database, hmacKey: KEY, resolveAvailability: policy.resolveAvailability,
    approvedDefaults: policy.approvedDefaults, behaviors: policy.behaviors,
  });
  const sealedBundle = reconstructSealedSloveniaDemoPackageBundle(bundle, lock);
  return composition.installCityPackage(sealedBundle.installInput);
}

describe("Slovenia demo package two-artifact installation gate", () => {
  it("installs the pinned Ljubljana-only partial beta, restarts, and exact-replays it", async () => {
    const aliasInput = validInstallInput();
    const derived = deriveSloveniaDemoPackageRelationView(aliasInput);
    (aliasInput.criteriaDefaults.criteria[0] as { target: string }).target = "forged";
    expect(Object.isFrozen(derived)).toBe(true);
    expect(derived.criteria.defaults.criteria[0]?.target).toBe("1");
    const borrowedInput = validInstallInput();
    const bundle = sealed(borrowedInput); const policy = testInstallationPolicy(); const path = temporaryDatabasePath();
    (borrowedInput as { installedAt: string }).installedAt = "2026-08-31T00:00:00.000Z";
    expect(getCityResearchPackageAvailability("SI")?.readiness.status).toBe("not_ready");
    expect(Object.isFrozen(bundle)).toBe(true);
    expect(Object.isFrozen(bundle.manifest)).toBe(true);
    expect(Object.isFrozen(bundle.manifest.captures)).toBe(true);
    expect(Object.isFrozen(bundle.installInput)).toBe(true);
    expect(Object.isFrozen(bundle.installInput.catalogProjection)).toBe(true);
    expect(bundle.installInput.installedAt).toBe("2026-08-30T00:00:00.000Z");
    let database = openDatabase(path);
    const first = createCityPackageInstallationComposition({ database, hmacKey: KEY, resolveAvailability: policy.resolveAvailability, approvedDefaults: policy.approvedDefaults, behaviors: policy.behaviors });
    const installed = await first.installCityPackage(bundle.installInput);
    expect(installed.catalog.coverage).toEqual({ status: "incomplete", reasons: ["official_universe_partial"] });
    expect(installed.catalog.members.map(({ cityId }) => cityId)).toEqual(["ljubljana"]);
    const before = databaseCounts(database); database.close(); database = openDatabase(path);
    const restarted = createCityPackageInstallationComposition({ database, hmacKey: KEY, resolveAvailability: policy.resolveAvailability, approvedDefaults: policy.approvedDefaults, behaviors: policy.behaviors });
    const replayed = await restarted.installCityPackage(bundle.installInput);
    expect(replayed.installedPackageManifest.id).toBe(installed.installedPackageManifest.id);
    expect(databaseCounts(database)).toEqual(before);
    expect(new InstalledCityPackages(new SqliteCityPackageManifestStore(database, INTEGRITY, policy.approvedDefaults, policy.behaviors)).findReady("SI")?.installedPackageManifest.id).toBe(installed.installedPackageManifest.id);
  });

  it("admits a delegated document only through its retained direct first-party parent", () => {
    const input = validInstallInput();
    const relationView = deriveSloveniaDemoPackageRelationView(input);
    const parent = { artifactId: "demo-parent@1", publisherId: "municipality-ljubljana", sourceUrl: "https://ljubljana.si/safety", sha256: "a".repeat(64), capturedAt: "2026-08-30T00:00:00.000Z", authorityTrace: { kind: "direct_allowed_host" as const } };
    const delegated = { artifactId: "demo-delegated@1", publisherId: "municipality-ljubljana", sourceUrl: "https://cdn.ljubljana.si/safety.pdf", sha256: "b".repeat(64), capturedAt: "2026-08-30T00:00:01.000Z", authorityTrace: { kind: "delegated_document" as const, parentArtifactId: parent.artifactId, edgeKind: "link" as const } };
    const bundleFor = (captures: readonly unknown[]) => {
      const manifest = { packageId: DEFINITION.packageId, packageSchemaVersion: DEFINITION.packageSchemaVersion, evidenceRulesVersion: DEFINITION.evidenceRulesVersion, catalogScopePolicy: "subjective-relocation-demo@1", cityIds: ["ljubljana"] as const, captures, relationView };
      const lock = { schemaVersion: "si-demo-city-policy-lock@1", packageId: DEFINITION.packageId, packageSchemaVersion: DEFINITION.packageSchemaVersion, evidenceRulesVersion: DEFINITION.evidenceRulesVersion, bundleManifestSha256: sha256Text(canonicalJson(manifest)), installInputSha256: sha256Text(canonicalJson(input)), cityIds: manifest.cityIds, captures, relationView };
      return { bundle: { schemaVersion: "si-demo-city-acquisition-bundle@1", manifest, installInput: input }, lock };
    };
    const accepted = bundleFor([delegated, parent]);
    expect(reconstructSealedSloveniaDemoPackageBundle(accepted.bundle, accepted.lock)
      .manifest.captures.map(({ artifactId }) => artifactId)).toEqual([
      "demo-delegated@1", "demo-parent@1",
    ]);
    const directDelegated = { ...delegated, authorityTrace: { kind: "direct_allowed_host" as const } };
    const directAttempt = bundleFor([directDelegated, parent]);
    expect(() => reconstructSealedSloveniaDemoPackageBundle(
      directAttempt.bundle,
      directAttempt.lock,
    )).toThrow("integrity_mismatch");
    const orphanAttempt = bundleFor([delegated]);
    expect(() => reconstructSealedSloveniaDemoPackageBundle(
      orphanAttempt.bundle,
      orphanAttempt.lock,
    )).toThrow("integrity_mismatch");
  });

  it("rejects bundle/lock drift and old feasibility material through the beta gate before all five SQLite tables", async () => {
    const path = temporaryDatabasePath(); const database = openDatabase(path); const input = validInstallInput(); const relationView = deriveSloveniaDemoPackageRelationView(input);
    const captures = [{ artifactId: "demo-capture@1", publisherId: "municipality-ljubljana", sourceUrl: "https://ljubljana.si/safety", sha256: "a".repeat(64), capturedAt: "2026-08-30T00:00:00.000Z", authorityTrace: { kind: "direct_allowed_host" as const } }];
    const manifest = { packageId: DEFINITION.packageId, packageSchemaVersion: DEFINITION.packageSchemaVersion, evidenceRulesVersion: DEFINITION.evidenceRulesVersion, catalogScopePolicy: "subjective-relocation-demo@1", cityIds: ["ljubljana"], captures, relationView };
    const lock = { schemaVersion: "si-demo-city-policy-lock@1", packageId: DEFINITION.packageId, packageSchemaVersion: DEFINITION.packageSchemaVersion, evidenceRulesVersion: DEFINITION.evidenceRulesVersion, bundleManifestSha256: sha256Text(canonicalJson(manifest)), installInputSha256: sha256Text(canonicalJson(input)), cityIds: manifest.cityIds, captures, relationView };
    const bundle = { schemaVersion: "si-demo-city-acquisition-bundle@1", manifest, installInput: input };
    const oldFixture = JSON.parse(readFileSync(join(process.cwd(), "tests/sources/fixtures/slovenia-city/catalog/smn-2022-central-urban-settlements.expected.json"), "utf8"));
    const criteriaDrift = structuredClone(input);
    (criteriaDrift.criteriaDefaults.criteria[0] as { target: string }).target = "999";
    const fixedPolicyDrift = structuredClone(input);
    (fixedPolicyDrift.fixedPlansByCityId.ljubljana[0]!.claimContract as { valuePolicyVersion: string }).valuePolicyVersion = "forged-policy@1";
    const unallowedHostManifest = {
      ...manifest,
      captures: [{ ...captures[0]!, sourceUrl: "https://other.example/safety" }],
    };
    const unknownPublisherManifest = {
      ...manifest,
      captures: [{ ...captures[0]!, publisherId: "unknown-publisher" }],
    };
    const behaviorDriftRelation = structuredClone(relationView);
    (behaviorDriftRelation.criteria.behaviorVersion as { evaluatorRegistryVersionId: string })
      .evaluatorRegistryVersionId = "forged-evaluators@999";
    const behaviorDriftManifest = { ...manifest, relationView: behaviorDriftRelation };
    const reviewedLockFor = (
      candidateManifest: typeof manifest,
      candidateInput: InstallCityPackageInput,
    ) => ({
      ...lock,
      bundleManifestSha256: sha256Text(canonicalJson(candidateManifest)),
      installInputSha256: sha256Text(canonicalJson(candidateInput)),
      captures: candidateManifest.captures,
      relationView: candidateManifest.relationView,
    });
    const attempts = [
      [bundle, { ...lock, bundleManifestSha256: "b".repeat(64) }],
      [{ ...bundle, manifest: unallowedHostManifest }, reviewedLockFor(unallowedHostManifest, input)],
      [{ ...bundle, manifest: unknownPublisherManifest }, reviewedLockFor(unknownPublisherManifest, input)],
      [{ ...bundle, manifest: { ...manifest, captures: [{ ...captures[0]!, sha256: "b".repeat(64) }] } }, lock],
      [{ ...bundle, installInput: { ...input, installedAt: "2026-08-31T00:00:00.000Z" } }, lock],
      [{ ...bundle, installInput: criteriaDrift }, reviewedLockFor(manifest, criteriaDrift)],
      [{ ...bundle, installInput: fixedPolicyDrift }, reviewedLockFor(manifest, fixedPolicyDrift)],
      [{ ...bundle, manifest: behaviorDriftManifest }, reviewedLockFor(behaviorDriftManifest, input)],
      [{ ...bundle, installInput: oldFixture }, lock],
    ];
    for (const [rejectedBundle, rejectedLock] of attempts) {
      await expect(installThroughBetaGate(database, rejectedBundle, rejectedLock))
        .rejects.toThrow("integrity_mismatch");
    }
    const selfRecomputedInput = { ...input, installedAt: "2026-08-31T00:00:00.000Z" };
    const selfRecomputedLock = {
      ...lock,
      installInputSha256: sha256Text(canonicalJson(selfRecomputedInput)),
    };
    const unpinnedStagingBundle = reconstructSealedSloveniaDemoPackageBundle(
      { ...bundle, installInput: selfRecomputedInput },
      selfRecomputedLock,
    );
    expect(unpinnedStagingBundle.installInput.installedAt).toBe("2026-08-31T00:00:00.000Z");
    expect(() => createSloveniaDemoCityInstallationPolicy(unpinnedStagingBundle))
      .toThrow("integrity_mismatch");
    // Coherent staging is not authority: only a checked-in M8C lock may cross that boundary.
    expect(loadCheckedInSloveniaDemoPackage).toThrow("si_demo_package_policy_lock_unavailable");
    expect(getCityResearchPackageAvailability("SI")?.readiness.status).toBe("not_ready");
    expect(databaseCounts(database)).toEqual({ catalogs: 0, evidence: 0, artifacts: 0, manifests: 0, heads: 0 });
  });
});
