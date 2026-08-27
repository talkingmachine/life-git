import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3";
import ts from "typescript";
import { afterEach, describe, expect, expectTypeOf, test } from "vitest";

import {
  cityCriteriaPayloadHash,
  cityFrontierRunId,
  type CityCatalogStorePort,
  type CityCriteriaCommandPayload,
  type CityFrontierRunIdentity,
  type VerifiedCityCatalogBundle,
} from "../../src/application/city-data-contracts";
import {
  reconstructCityRankingSnapshot,
  sealCityFrontierRevision,
  sealCityRankingSnapshot,
  type CityBranchReadPort,
  type CityCriteriaReadPort,
  type CityFrontierRevision,
  type CityFrontierStartPublication,
  type CityFrontierStartPublicationResult,
  type CityFrontierStartWriterPort,
  type CityFrontierStorePort,
  type CityRankingReadPort,
  type CityRankingSnapshot,
  type CityRankingSnapshotPayload,
  type WorkingCityFrontierRevision,
  verifyCityRankingSnapshotSemantics,
} from "../../src/application/city-frontier-contracts";
import {
  createPreCityBranchCommit,
  resolvedCountryEntryDigest,
  type PreCityBranchCommit,
  type PreCityBranchSourceProjection,
} from "../../src/branch/city";
import type {
  CountryResolutionChainLocator,
  CountryResolutionStorePort,
  ResolvedCountryShortlistSnapshot,
} from "../../src/application/country-resolution-contracts";
import {
  buildCityCatalogRevision,
  buildCityRegistryRevision,
  type CityCatalogRevision,
} from "../../src/decision/city-catalog";
import type {
  CityCriteriaSnapshot,
  CityCriterionEvaluation,
  CityCriterionEvaluationInput,
  CityCriterionDraft,
  CityCriterionEvaluatorRegistry,
} from "../../src/decision/city-criteria";
import { CITY_CRITERION_IDS } from "../../src/decision/city-criteria";
import type { CityDecisionIntegrity } from "../../src/decision/city-integrity";
import type {
  CityFrontierProjection,
  CityFrontierVerificationBudget,
  CityLiveMarker,
} from "../../src/decision/city-frontier-policy";
import {
  createCityDecisionIntegrityView,
  createEvidenceIntegrity,
} from "../../src/infrastructure/integrity";
import { SqliteCityBranchStore } from
  "../../src/infrastructure/sqlite/city-branch-store";
import { SqliteCityCriteriaStore } from
  "../../src/infrastructure/sqlite/city-criteria-store";
import { SqliteCityFrontierStore } from
  "../../src/infrastructure/sqlite/city-frontier-store";
import { openEvidenceDatabase } from "../../src/infrastructure/sqlite/db";
import type { EvidenceIntegrity } from "../../src/research/run";
import {
  cityFrontierPublicationWorker,
  type CityFrontierWorkerHandle,
} from
  "../support/city-frontier-publication-worker";

const INTEGRITY_KEY = "task-13-city-frontier-persistence-key";
const INTEGRITY = createEvidenceIntegrity(INTEGRITY_KEY);
const DECISION_INTEGRITY = createCityDecisionIntegrityView(INTEGRITY);
const START_AT = "2026-08-20T12:00:00.000Z";
const PARENT_AT = "2026-08-19T12:00:00.000Z";
const PROFILE_ID = "profile:confirmed";
const PREFERENCE_ID = "preference-profile:confirmed";
const RESOLUTION_ID = "country-resolution:resolved";
const databases: Database.Database[] = [];
const temporaryDirectories: string[] = [];
const workerTerminators: Array<() => Promise<number>> = [];

type PersistenceFrontierStore = CityFrontierStorePort &
  CityRankingReadPort & CityFrontierStartWriterPort;

interface StoreDependencies {
  readonly criteria: CityCriteriaReadPort;
  readonly branches: CityBranchReadPort;
  readonly catalogs: CityCatalogStorePort;
}

interface Harness {
  readonly database: Database.Database;
  readonly criteria: CityCriteriaReadPort;
  readonly branches: CityBranchReadPort;
  readonly frontier: PersistenceFrontierStore;
  readonly publication: CityFrontierStartPublication;
  readonly catalogBundle: VerifiedCityCatalogBundle;
  readonly locator: CountryResolutionChainLocator;
}

interface PublicationOptions {
  readonly commandId?: string;
  readonly startAt?: string;
  readonly firstTarget?: string;
  readonly catalogRulesVersion?: CityCatalogRevision["rulesVersion"];
  readonly resolvedRevisionId?: string;
  readonly countryCode?: string;
  readonly packageId?: string;
}

afterEach(async () => {
  await Promise.allSettled(workerTerminators.splice(0).map((terminate) => terminate()));
  for (const database of databases.splice(0)) {
    if (database.open) database.close();
  }
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function trackWorker<T>(handle: CityFrontierWorkerHandle<T>): CityFrontierWorkerHandle<T> {
  workerTerminators.push(() => handle.terminate());
  return handle;
}

function temporaryDatabasePath(): string {
  const directory = mkdtempSync(join(tmpdir(), "city-frontier-store-"));
  temporaryDirectories.push(directory);
  return join(directory, "city.sqlite");
}

function track(database: Database.Database): Database.Database {
  databases.push(database);
  return database;
}

async function releaseWorkersTogether(
  gate: SharedArrayBuffer,
  expectedWorkers: number,
): Promise<void> {
  const state = new Int32Array(gate);
  const deadline = Date.now() + 20_000;
  while (Atomics.load(state, 0) !== expectedWorkers) {
    if (Date.now() >= deadline) throw new Error("city_frontier_worker_gate_timeout");
    await new Promise<void>((resolvePromise) => setImmediate(resolvePromise));
  }
  Atomics.store(state, 1, 1);
  Atomics.notify(state, 1, expectedWorkers);
}

function recursivelyFrozen(value: unknown, seen = new Set<object>()): void {
  if (value === null || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  expect(Object.isFrozen(value)).toBe(true);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    expect(descriptor).toBeDefined();
    expect(descriptor !== undefined && "value" in descriptor).toBe(true);
    if (descriptor !== undefined && "value" in descriptor) {
      recursivelyFrozen(descriptor.value, seen);
    }
  }
}

function recursivelyNotAliased(
  left: unknown,
  right: unknown,
  seen = new Set<object>(),
): void {
  if (
    left === null || right === null ||
    typeof left !== "object" || typeof right !== "object" ||
    seen.has(left)
  ) return;
  seen.add(left);
  expect(left).not.toBe(right);
  for (const key of Reflect.ownKeys(left)) {
    const leftDescriptor = Object.getOwnPropertyDescriptor(left, key);
    const rightDescriptor = Object.getOwnPropertyDescriptor(right, key);
    if (
      leftDescriptor !== undefined && rightDescriptor !== undefined &&
      "value" in leftDescriptor && "value" in rightDescriptor
    ) recursivelyNotAliased(leftDescriptor.value, rightDescriptor.value, seen);
  }
}

function expectErrorMessage(action: () => unknown, expected: string): void {
  let thrown: unknown;
  try {
    action();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(Error);
  expect((thrown as Error).message).toBe(expected);
}

function criteriaDrafts(firstTarget = "2"): readonly [
  CityCriterionDraft,
  CityCriterionDraft,
  CityCriterionDraft,
  CityCriterionDraft,
] {
  return [
    {
      criterionId: "safety",
      definitionId: "safety@1",
      mode: "required",
      importance: 5,
      target: firstTarget,
    },
    {
      criterionId: "long_term_rent",
      definitionId: "long_term_rent@1",
      mode: "weighted",
      importance: 4,
      target: "900",
    },
    {
      criterionId: "urban_transit",
      definitionId: "urban_transit@1",
      mode: "weighted",
      importance: 3,
      target: "0.7",
    },
    {
      criterionId: "fixed_broadband",
      definitionId: "fixed_broadband@1",
      mode: "weighted",
      importance: 2,
      target: "100",
    },
  ];
}

function criteriaSnapshot(
  criteria: CityCriteriaSnapshot["criteria"],
  confirmedAt: string,
): CityCriteriaSnapshot {
  const payload = {
    schemaVersion: "city-criteria@1" as const,
    profileSnapshotId: PROFILE_ID,
    preferenceProfileSnapshotId: PREFERENCE_ID,
    criteria,
    rulesVersion: "city-criteria@1" as const,
    confirmedAt,
  };
  return Object.freeze({
    id: `city-criteria:${DECISION_INTEGRITY.hash(
      DECISION_INTEGRITY.canonical(payload),
    )}`,
    ...structuredClone(payload),
  });
}

function catalogBundle(
  integrity: CityDecisionIntegrity,
  rulesVersion: CityCatalogRevision["rulesVersion"] = "city-catalog@2",
  countryCode = "SI",
  packageId = "si-cities",
): VerifiedCityCatalogBundle {
  const registry = buildCityRegistryRevision({
    packageId,
    packageSchemaVersion: "si-cities@1",
    countryCode,
    evidenceSnapshotId: "catalog-evidence:verified",
    entries: [{
      cityId: "ljubljana",
      countryCode,
      officialName: "Ljubljana",
      coordinate: { lat: 46.0569, lng: 14.5058 },
      administrativeType: "central_urban_settlement",
      administrativeTerritory: "Mestna občina Ljubljana",
      capitalRoles: ["national"],
      evidenceReferenceIds: ["catalog-evidence:verified"],
    }, {
      cityId: "maribor",
      countryCode,
      officialName: "Maribor",
      coordinate: { lat: 46.5547, lng: 15.6459 },
      administrativeType: "urban_settlement",
      administrativeTerritory: "Mestna občina Maribor",
      capitalRoles: [],
      evidenceReferenceIds: ["catalog-evidence:verified"],
    }],
    createdAt: "2026-08-18T00:00:00.000Z",
  }, integrity);
  const current = buildCityCatalogRevision({
    registry,
    evidenceSnapshotId: registry.evidenceSnapshotId,
    populationDefinition: {
      definitionId: "population@1",
      geoScope: "settlement",
      unit: "people",
    },
    candidateBasis: [{
      cityId: "ljubljana",
      comparablePopulation: {
        kind: "verified",
        value: "300000",
        referencePeriod: "2025",
      },
    }, {
      cityId: "maribor",
      comparablePopulation: {
        kind: "verified",
        value: "100000",
        referencePeriod: "2025",
      },
    }],
    coverage: { status: "complete" },
    createdAt: "2026-08-18T00:00:00.000Z",
  }, integrity);
  if (rulesVersion === "city-catalog@2") return { registry, catalog: current };
  const { id: _id, ...currentPayload } = current;
  void _id;
  const legacyPayload = { ...currentPayload, rulesVersion };
  return {
    registry,
    catalog: {
      id: `city-catalog:${integrity.hash(integrity.canonical(legacyPayload))}`,
      ...legacyPayload,
    },
  };
}

function resolvedLocator(
  revisionId = RESOLUTION_ID,
  countryCode = "SI",
): CountryResolutionChainLocator {
  const source = {
    automaticShortlistSnapshotId: "place-shortlist:verified",
    rankingSnapshotId: "place-ranking:verified",
    profileSnapshotId: PROFILE_ID,
    preferenceProfileSnapshotId: PREFERENCE_ID,
  };
  const resolved: ResolvedCountryShortlistSnapshot = {
    schemaVersion: "country-resolution@1",
    rulesVersion: "country-resolution@1",
    id: revisionId,
    resolutionRunId: "country-resolution-run:verified",
    ...source,
    decisions: [],
    replacementMarkers: [],
    nextUncheckedRank: 2,
    unresolvedCountryCodes: [],
    slotCountryCodes: [countryCode],
    contextHash: "c".repeat(64),
    createdAt: PARENT_AT,
    kind: "resolved",
    resolvedEntries: [{
      countryCode,
      rank: 1,
      formalMarkerDigest: "d".repeat(64),
    }],
    stopCondition: "ranking_exhausted",
  };
  return {
    resolutionRunId: resolved.resolutionRunId,
    source,
    revisions: [resolved],
  };
}

function unknownFactor(
  criterion: CityCriterionDraft,
): CityRankingSnapshot["ordered"][number]["factors"][number] {
  return {
    criterionId: criterion.criterionId,
    definitionId: criterion.definitionId,
    mode: criterion.mode,
    importance: criterion.importance,
    evaluatorVersion: `${criterion.criterionId}-evaluator@1`,
    freshnessPolicyVersion: "annual@1",
    state: "unknown",
    factor: "0",
    weightedContribution: "0",
    targetComparison: "unknown",
    requiredMismatch: false,
    unknownReason: "no_knowledge_revision",
  };
}

function installedEvaluators(): CityCriterionEvaluatorRegistry {
  return Object.fromEntries(CITY_CRITERION_IDS.map((criterionId) => [criterionId, {
    definition: {
      criterionId,
      definitionId: `${criterionId}@1`,
      direction: criterionId === "long_term_rent" ? "at_most" : "at_least",
      unit: "unit",
      denominator: "municipality",
      compatibleGeoScopes: ["municipality"],
      freshnessPolicyVersion: "annual@1",
      evaluatorVersion: `${criterionId}-evaluator@1`,
    },
    canonicalizeTarget(target: unknown) {
      return String(target);
    },
    evaluate({ fact }: CityCriterionEvaluationInput): CityCriterionEvaluation {
      if (fact.outcome.kind === "unknown") {
        return {
          state: "unknown",
          factor: "0",
          targetComparison: "unknown",
          unknownReason: fact.outcome.reason,
        };
      }
      return {
        state: "verified",
        factor: "1",
        targetComparison: "matches",
      };
    },
  }])) as unknown as CityCriterionEvaluatorRegistry;
}

function publicationFixture(
  options: PublicationOptions = {},
): {
  readonly publication: CityFrontierStartPublication;
  readonly catalogBundle: VerifiedCityCatalogBundle;
  readonly locator: CountryResolutionChainLocator;
} {
  const countryCode = options.countryCode ?? "SI";
  const bundle = catalogBundle(
    DECISION_INTEGRITY,
    options.catalogRulesVersion,
    countryCode,
    options.packageId,
  );
  const locator = resolvedLocator(options.resolvedRevisionId, countryCode);
  const resolved = locator.revisions[0] as ResolvedCountryShortlistSnapshot;
  const criteria = criteriaSnapshot(criteriaDrafts(options.firstTarget), options.startAt ?? START_AT);
  const criteriaPayload: CityCriteriaCommandPayload = {
    schemaVersion: "city-criteria-command@1",
    profileSnapshotId: criteria.profileSnapshotId,
    preferenceProfileSnapshotId: criteria.preferenceProfileSnapshotId,
    criteria: criteria.criteria,
    rulesVersion: criteria.rulesVersion,
  };
  const criteriaPayloadHash = cityCriteriaPayloadHash(criteriaPayload, DECISION_INTEGRITY);
  const installedPackageContext = {
    countryCode,
    packageId: bundle.catalog.packageId,
    packageSchemaVersion: bundle.catalog.packageSchemaVersion,
    catalogRevisionId: bundle.catalog.id,
    evidenceRulesVersion: "si-city-evidence@1",
  };
  const verificationBudget: CityFrontierVerificationBudget = {
    liveCityCandidateLimit: 10,
    targetSelectableCities: 3,
    rulesVersion: "city-frontier-budget@1",
  };
  const runIdentity: CityFrontierRunIdentity = {
    schemaVersion: "city-frontier-run@1",
    resolvedCountryShortlistRevisionId: resolved.id,
    countryCode,
    registryRevisionId: bundle.registry.id,
    installedPackageContext,
    criteriaPayloadHash,
    catalogRulesVersion: bundle.catalog.rulesVersion,
    rankingRulesVersion: "city-ranker@1",
    verificationBudget,
  };
  const runId = cityFrontierRunId(runIdentity, DECISION_INTEGRITY);
  const source: PreCityBranchSourceProjection = {
    profileSnapshotId: locator.source.profileSnapshotId,
    preferenceProfileSnapshotId: locator.source.preferenceProfileSnapshotId,
    resolvedCountryShortlistRevisionId: resolved.id,
    resolvedCountryEntry: resolved.resolvedEntries[0],
  };
  const preCityBranch = createPreCityBranchCommit({
    source,
    createdAt: resolved.createdAt,
  }, DECISION_INTEGRITY);
  const criteriaTuple = criteria.criteria;
  const rankingPayload: CityRankingSnapshotPayload = {
    schemaVersion: "city-ranking@1",
    runId,
    resolvedCountryShortlistRevisionId: resolved.id,
    countryCode,
    packageId: installedPackageContext.packageId,
    packageSchemaVersion: installedPackageContext.packageSchemaVersion,
    preCityBranchCommitId: preCityBranch.id,
    profileSnapshotId: criteria.profileSnapshotId,
    preferenceProfileSnapshotId: criteria.preferenceProfileSnapshotId,
    registryRevisionId: bundle.registry.id,
    catalogRevisionId: bundle.catalog.id,
    installedPackageContext,
    criteriaSnapshotId: criteria.id,
    assessmentAt: options.startAt ?? START_AT,
    knowledgeRevisionIds: { ljubljana: null, maribor: null },
    ordered: [{
      cityId: "ljubljana",
      rank: 1,
      score: "0",
      coverage: "0",
      knowledgeRevisionId: null,
      factors: criteriaTuple.map(unknownFactor) as unknown as
        CityRankingSnapshot["ordered"][number]["factors"],
    }, {
      cityId: "maribor",
      rank: 2,
      score: "0",
      coverage: "0",
      knowledgeRevisionId: null,
      factors: criteriaTuple.map(unknownFactor) as unknown as
        CityRankingSnapshot["ordered"][number]["factors"],
    }],
    screenedExclusions: [],
    rulesVersion: "city-ranker@1",
    verificationBudget,
    createdAt: options.startAt ?? START_AT,
  };
  const ranking = sealCityRankingSnapshot(rankingPayload, DECISION_INTEGRITY);
  const root = sealCityFrontierRevision({
    runId,
    rankingSnapshotId: ranking.id,
    markers: [],
    projection: {
      kind: "working",
      nextUncheckedRank: 1,
      selectableCityIds: [],
      phase: "verification_required",
    },
    operation: {
      kind: "start",
      commandId: options.commandId ?? "command:city-frontier-start",
      criteriaPayloadHash,
    },
    createdAt: options.startAt ?? START_AT,
  }, DECISION_INTEGRITY);
  const publication: CityFrontierStartPublication = {
    intent: {
      schemaVersion: "city-frontier-start-intent@1",
      runId,
      resolvedCountryShortlistRevisionId: resolved.id,
      countryCode,
      criteriaPayloadHash,
    },
    criteria,
    preCityBranch,
    preCitySource: source,
    ranking,
    root,
  };
  return { publication, catalogBundle: bundle, locator };
}

function workingProjection(
  revision: WorkingCityFrontierRevision,
): CityFrontierProjection {
  return {
    kind: "working",
    nextUncheckedRank: revision.nextUncheckedRank,
    selectableCityIds: revision.markers
      .filter(({ status }) => status === "selectable")
      .map(({ cityId }) => cityId),
    phase: revision.phase,
  };
}

function commandDriftPublication(
  baseline: CityFrontierStartPublication,
  drift: "resolved_revision" | "country" | "installed_context",
): CityFrontierStartPublication {
  const resolvedCountryShortlistRevisionId = drift === "resolved_revision"
    ? "country-resolution:other-resolved"
    : baseline.intent.resolvedCountryShortlistRevisionId;
  const countryCode = drift === "country" ? "AT" : baseline.intent.countryCode;
  const preCitySource: PreCityBranchSourceProjection = {
    ...structuredClone(baseline.preCitySource),
    resolvedCountryShortlistRevisionId,
    resolvedCountryEntry: {
      ...structuredClone(baseline.preCitySource.resolvedCountryEntry),
      countryCode,
    },
  };
  const preCityBranch = createPreCityBranchCommit({
    source: preCitySource,
    createdAt: baseline.preCityBranch.createdAt,
  }, DECISION_INTEGRITY);
  const installedPackageContext = {
    ...structuredClone(baseline.ranking.installedPackageContext),
    countryCode,
    evidenceRulesVersion: drift === "installed_context"
      ? "si-city-evidence@2"
      : baseline.ranking.installedPackageContext.evidenceRulesVersion,
  };
  const runId = cityFrontierRunId({
    schemaVersion: "city-frontier-run@1",
    resolvedCountryShortlistRevisionId,
    countryCode,
    registryRevisionId: baseline.ranking.registryRevisionId,
    installedPackageContext,
    criteriaPayloadHash: baseline.intent.criteriaPayloadHash,
    catalogRulesVersion: "city-catalog@2",
    rankingRulesVersion: baseline.ranking.rulesVersion,
    verificationBudget: baseline.ranking.verificationBudget,
  }, DECISION_INTEGRITY);
  const { id: _rankingId, ...baselineRankingPayload } = baseline.ranking;
  void _rankingId;
  const ranking = sealCityRankingSnapshot({
    ...structuredClone(baselineRankingPayload),
    runId,
    resolvedCountryShortlistRevisionId,
    countryCode,
    preCityBranchCommitId: preCityBranch.id,
    installedPackageContext,
  }, DECISION_INTEGRITY);
  const root = sealCityFrontierRevision({
    runId,
    rankingSnapshotId: ranking.id,
    markers: [],
    projection: workingProjection(baseline.root as WorkingCityFrontierRevision),
    operation: structuredClone(baseline.root.operation),
    createdAt: baseline.root.createdAt,
  }, DECISION_INTEGRITY);
  return {
    intent: {
      schemaVersion: "city-frontier-start-intent@1",
      runId,
      resolvedCountryShortlistRevisionId,
      countryCode,
      criteriaPayloadHash: baseline.intent.criteriaPayloadHash,
    },
    criteria: structuredClone(baseline.criteria),
    preCityBranch,
    preCitySource,
    ranking,
    root,
  };
}

function insertPrerequisites(
  database: Database.Database,
  publication: CityFrontierStartPublication,
  bundle: VerifiedCityCatalogBundle,
  locator: CountryResolutionChainLocator,
  integrity: EvidenceIntegrity = INTEGRITY,
): void {
  const resolved = locator.revisions[0] as ResolvedCountryShortlistSnapshot;
  database.prepare(`
    INSERT INTO profile_snapshots (id, confirmed_at, snapshot_json, snapshot_hash)
    VALUES (?, ?, '{}', ?), (?, ?, '{}', ?)
  `).run(
    PROFILE_ID,
    START_AT,
    "0".repeat(64),
    PREFERENCE_ID,
    START_AT,
    "1".repeat(64),
  );
  for (const [id, kind] of [
    [locator.source.rankingSnapshotId, "ranking"],
    [locator.source.automaticShortlistSnapshotId, "shortlist"],
  ] as const) {
    database.prepare(`
      INSERT INTO place_frontier_snapshots (
        id, run_id, kind, schema_version, payload_json, payload_hash, hmac, created_at
      ) VALUES (?, 'place-frontier:fixture', ?, ?, '{}', ?, ?, ?)
    `).run(
      id,
      kind,
      kind === "ranking" ? "place-ranking@1" : "place-shortlist@1",
      integrity.hash("{}"),
      integrity.sign("{}"),
      PARENT_AT,
    );
  }
  const resolutionPayload = integrity.canonical(resolved);
  const resolutionCommand = integrity.canonical({
    commandId: "command:country-resolution",
    kind: "start",
    automaticShortlistSnapshotId: locator.source.automaticShortlistSnapshotId,
  });
  database.prepare(`
    INSERT INTO country_resolution_revisions (
      id, resolution_run_id, kind, predecessor_id, automatic_shortlist_snapshot_id,
      ranking_snapshot_id, command_id, command_kind, command_json, command_hash,
      schema_version, rules_version, context_hash, payload_json, payload_hash, hmac, created_at
    ) VALUES (?, ?, 'resolved', NULL, ?, ?, 'command:country-resolution', 'start', ?, ?,
      'country-resolution@1', 'country-resolution@1', ?, ?, ?, ?, ?)
  `).run(
    resolved.id,
    resolved.resolutionRunId,
    locator.source.automaticShortlistSnapshotId,
    locator.source.rankingSnapshotId,
    resolutionCommand,
    integrity.hash(resolutionCommand),
    resolved.contextHash,
    resolutionPayload,
    integrity.hash(resolutionPayload),
    integrity.sign(resolutionPayload),
    resolved.createdAt,
  );
  database.prepare(`
    INSERT INTO evidence_snapshots (
      id, assessment_date, snapshot_json, manifest_json, manifest_hash, hmac,
      parser_versions_json, rules_version
    ) VALUES ('administrative-evidence:installed', '2026-08-18', '{}', '{}', ?, ?, '{}', 'fixture@1')
  `).run("2".repeat(64), "3".repeat(64));
  const catalogPayload = integrity.canonical(bundle);
  database.prepare(`
    INSERT INTO city_catalog_revisions (
      id, registry_revision_id, country_code, package_id, package_schema_version,
      registry_evidence_snapshot_id, catalog_evidence_snapshot_id, rules_version,
      created_at, payload_json, payload_hash, hmac
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    bundle.catalog.id,
    bundle.registry.id,
    bundle.catalog.countryCode,
    bundle.catalog.packageId,
    bundle.catalog.packageSchemaVersion,
    bundle.registry.evidenceSnapshotId,
    bundle.catalog.evidenceSnapshotId,
    bundle.catalog.rulesVersion,
    bundle.catalog.createdAt,
    catalogPayload,
    integrity.hash(catalogPayload),
    integrity.sign(catalogPayload),
  );
  const installed = publication.ranking.installedPackageContext;
  database.prepare(`
    INSERT INTO installed_city_package_manifests (
      id, country_code, package_id, package_schema_version, catalog_revision_id,
      evidence_rules_version, predecessor_manifest_id, administrative_evidence_snapshot_id,
      installed_at, payload_json, payload_hash, hmac
    ) VALUES ('installed-city-package:fixture', ?, ?, ?, ?, ?, NULL,
      'administrative-evidence:installed', ?, '{}', ?, ?)
  `).run(
    installed.countryCode,
    installed.packageId,
    installed.packageSchemaVersion,
    installed.catalogRevisionId,
    installed.evidenceRulesVersion,
    "2026-08-18T00:00:00.000Z",
    integrity.hash("{}"),
    integrity.sign("{}"),
  );
}

function insertFrontierRow(
  database: Database.Database,
  revision: CityFrontierRevision,
  command: CityFrontierStartPublication["intent"] | CityFrontierRevision["operation"],
  integrity: EvidenceIntegrity = INTEGRITY,
): void {
  const payloadJson = integrity.canonical(revision);
  const commandJson = integrity.canonical(command);
  database.prepare(`
    INSERT INTO city_frontier_revisions (
      id, run_id, kind, predecessor_id, ranking_snapshot_id, operation_kind,
      command_id, schema_version, command_json, command_hash, payload_json,
      payload_hash, hmac, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    revision.id,
    revision.runId,
    revision.kind,
    revision.predecessorRevisionId ?? null,
    revision.rankingSnapshotId,
    revision.operation.kind,
    revision.operation.commandId,
    revision.schemaVersion,
    commandJson,
    integrity.hash(commandJson),
    payloadJson,
    integrity.hash(payloadJson),
    integrity.sign(integrity.canonical({ value: revision, command })),
    revision.createdAt,
  );
}

function insertRankingRow(
  database: Database.Database,
  ranking: CityRankingSnapshot,
  integrity: EvidenceIntegrity = INTEGRITY,
): void {
  const payload = integrity.canonical(ranking);
  database.prepare(`
    INSERT INTO city_ranking_snapshots (
      id, run_id, resolved_country_shortlist_revision_id, country_code, package_id,
      package_schema_version, registry_revision_id, catalog_revision_id,
      criteria_snapshot_id, pre_city_branch_commit_id, profile_snapshot_id,
      preference_profile_snapshot_id, evidence_rules_version,
      installed_package_context_json, live_city_candidate_limit,
      target_selectable_cities, budget_rules_version, schema_version, rules_version,
      assessment_at, payload_json, payload_hash, hmac, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    ranking.id,
    ranking.runId,
    ranking.resolvedCountryShortlistRevisionId,
    ranking.countryCode,
    ranking.packageId,
    ranking.packageSchemaVersion,
    ranking.registryRevisionId,
    ranking.catalogRevisionId,
    ranking.criteriaSnapshotId,
    ranking.preCityBranchCommitId,
    ranking.profileSnapshotId,
    ranking.preferenceProfileSnapshotId,
    ranking.installedPackageContext.evidenceRulesVersion,
    integrity.canonical(ranking.installedPackageContext),
    ranking.verificationBudget.liveCityCandidateLimit,
    ranking.verificationBudget.targetSelectableCities,
    ranking.verificationBudget.rulesVersion,
    ranking.schemaVersion,
    ranking.rulesVersion,
    ranking.assessmentAt,
    payload,
    integrity.hash(payload),
    integrity.sign(payload),
    ranking.createdAt,
  );
}

function insertAuthenticPublicationRows(
  database: Database.Database,
  publication: CityFrontierStartPublication,
): void {
  const criteriaJson = INTEGRITY.canonical(publication.criteria);
  database.prepare(`
    INSERT INTO city_criteria_snapshots (
      id, profile_snapshot_id, preference_profile_snapshot_id, schema_version,
      rules_version, confirmed_at, payload_json, payload_hash, hmac
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    publication.criteria.id,
    publication.criteria.profileSnapshotId,
    publication.criteria.preferenceProfileSnapshotId,
    publication.criteria.schemaVersion,
    publication.criteria.rulesVersion,
    publication.criteria.confirmedAt,
    criteriaJson,
    INTEGRITY.hash(criteriaJson),
    INTEGRITY.sign(criteriaJson),
  );
  const branchJson = INTEGRITY.canonical(publication.preCityBranch);
  database.prepare(`
    INSERT INTO city_branch_commits (
      id, kind, profile_snapshot_id, preference_profile_snapshot_id,
      resolved_country_shortlist_revision_id, country_code,
      resolved_country_entry_digest, city_id, parent_id, forked_from,
      selection_snapshot_id, schema_version, payload_json, payload_hash, hmac, created_at
    ) VALUES (?, 'pre_city', ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, ?, ?, ?, ?, ?)
  `).run(
    publication.preCityBranch.id,
    publication.preCitySource.profileSnapshotId,
    publication.preCitySource.preferenceProfileSnapshotId,
    publication.preCitySource.resolvedCountryShortlistRevisionId,
    publication.preCitySource.resolvedCountryEntry.countryCode,
    resolvedCountryEntryDigest(
      publication.preCitySource.resolvedCountryEntry,
      DECISION_INTEGRITY,
    ),
    publication.preCityBranch.schemaVersion,
    branchJson,
    INTEGRITY.hash(branchJson),
    INTEGRITY.sign(branchJson),
    publication.preCityBranch.createdAt,
  );
  const ranking = publication.ranking;
  const rankingJson = INTEGRITY.canonical(ranking);
  database.prepare(`
    INSERT INTO city_ranking_snapshots (
      id, run_id, resolved_country_shortlist_revision_id, country_code, package_id,
      package_schema_version, registry_revision_id, catalog_revision_id,
      criteria_snapshot_id, pre_city_branch_commit_id, profile_snapshot_id,
      preference_profile_snapshot_id, evidence_rules_version,
      installed_package_context_json, live_city_candidate_limit,
      target_selectable_cities, budget_rules_version, schema_version, rules_version,
      assessment_at, payload_json, payload_hash, hmac, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    ranking.id,
    ranking.runId,
    ranking.resolvedCountryShortlistRevisionId,
    ranking.countryCode,
    ranking.packageId,
    ranking.packageSchemaVersion,
    ranking.registryRevisionId,
    ranking.catalogRevisionId,
    ranking.criteriaSnapshotId,
    ranking.preCityBranchCommitId,
    ranking.profileSnapshotId,
    ranking.preferenceProfileSnapshotId,
    ranking.installedPackageContext.evidenceRulesVersion,
    INTEGRITY.canonical(ranking.installedPackageContext),
    ranking.verificationBudget.liveCityCandidateLimit,
    ranking.verificationBudget.targetSelectableCities,
    ranking.verificationBudget.rulesVersion,
    ranking.schemaVersion,
    ranking.rulesVersion,
    ranking.assessmentAt,
    rankingJson,
    INTEGRITY.hash(rankingJson),
    INTEGRITY.sign(rankingJson),
    ranking.createdAt,
  );
  insertFrontierRow(database, publication.root, publication.intent);
}

function catalogPort(bundle: VerifiedCityCatalogBundle): CityCatalogStorePort {
  return {
    appendVerified() {
      throw new Error("unexpected_catalog_append");
    },
    loadVerified(id) {
      if (id !== bundle.catalog.id) throw new Error("city_catalog_not_found");
      return structuredClone(bundle);
    },
  };
}

function countryPort(locator: CountryResolutionChainLocator): CountryResolutionStorePort {
  return {
    locateChainVerified(input) {
      const matches = "revisionId" in input
        ? input.revisionId === locator.revisions.at(-1)?.id
        : input.resolutionRunId === locator.resolutionRunId;
      if (!matches) throw new Error("country_resolution_not_found");
      return structuredClone(locator);
    },
  } as CountryResolutionStorePort;
}

function stores(
  database: Database.Database,
  bundle: VerifiedCityCatalogBundle,
  locator: CountryResolutionChainLocator,
): Pick<Harness, "criteria" | "branches" | "frontier"> {
  const criteria = new SqliteCityCriteriaStore(database, INTEGRITY);
  const branches = new SqliteCityBranchStore(
    database,
    INTEGRITY,
    countryPort(locator),
  );
  const dependencies: StoreDependencies = {
    criteria,
    branches,
    catalogs: catalogPort(bundle),
  };
  const frontier = new SqliteCityFrontierStore(database, INTEGRITY, dependencies);
  return { criteria, branches, frontier };
}

function harness(
  options: PublicationOptions = {},
  path = ":memory:",
): Harness {
  const fixture = publicationFixture(options);
  const database = track(openEvidenceDatabase(path));
  insertPrerequisites(database, fixture.publication, fixture.catalogBundle, fixture.locator);
  return {
    database,
    ...stores(database, fixture.catalogBundle, fixture.locator),
    ...fixture,
  };
}

function observedFrontier(
  fixture: Harness,
  observation: ReturnType<typeof observedDatabase>,
): {
  readonly frontier: PersistenceFrontierStore;
  readonly dependencyCalls: () => number;
} {
  let dependencyCalls = 0;
  const countries = {
    locateChainVerified(input: Parameters<CountryResolutionStorePort["locateChainVerified"]>[0]) {
      dependencyCalls += 1;
      return countryPort(fixture.locator).locateChainVerified(input);
    },
  } as unknown as CountryResolutionStorePort;
  const catalogs: CityCatalogStorePort = {
    appendVerified() {
      dependencyCalls += 1;
      throw new Error("unexpected_catalog_append");
    },
    loadVerified(id) {
      dependencyCalls += 1;
      return catalogPort(fixture.catalogBundle).loadVerified(id);
    },
  };
  const criteria = new SqliteCityCriteriaStore(observation.database, INTEGRITY);
  const branches = new SqliteCityBranchStore(
    observation.database,
    INTEGRITY,
    countries,
  );
  const frontier = new SqliteCityFrontierStore(
    observation.database,
    INTEGRITY,
    { criteria, branches, catalogs },
  );
  observation.reset();
  return { frontier, dependencyCalls: () => dependencyCalls };
}

function rowCount(database: Database.Database, table: string): number {
  return (database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as {
    readonly count: number;
  }).count;
}

function dropImmutability(database: Database.Database, table: string): void {
  database.exec(`DROP TRIGGER ${table}_no_update`);
}

function observedDatabase(database: Database.Database): {
  readonly database: Database.Database;
  readonly calls: () => number;
  readonly reset: () => void;
} {
  let calls = 0;
  const observedMethods = new Set<PropertyKey>(["prepare", "exec", "transaction"]);
  return {
    database: new Proxy(database, {
      get(target, key, receiver) {
        const value = Reflect.get(target, key, receiver) as unknown;
        if (typeof value !== "function") return value;
        return (...arguments_: unknown[]) => {
          if (observedMethods.has(key)) calls += 1;
          return Reflect.apply(value, target, arguments_);
        };
      },
    }),
    calls: () => calls,
    reset: () => { calls = 0; },
  };
}

function marker(cityId = "ljubljana", rank = 1): CityLiveMarker {
  const criteria = criteriaDrafts();
  const facts = criteria.map((criterion) => ({
    criterionId: criterion.criterionId,
    definitionId: criterion.definitionId,
    geoScope: "municipality",
    referencePeriod: "2025",
    freshnessBasis: "annual@1",
    unit: "unit",
    denominator: "municipality",
    outcome: {
      kind: "verified" as const,
      basis: { kind: "canonical_scalar" as const, value: "1" },
    },
    evidenceLinks: [{
      sourceId: `${criterion.criterionId}-source`,
      disposition: "accepted" as const,
      navigationUrl: `https://navigation.example/${criterion.criterionId}`,
      resolvedEvidenceUrl: `https://evidence.example/${criterion.criterionId}`,
      ...(criterion.criterionId === "safety" ? { referenceYear: 2025 } : {}),
    }],
    manualCheckLinks: [],
  })) as unknown as CityLiveMarker["facts"];
  return {
    cityId,
    rank,
    status: "selectable",
    visualStatus: "green",
    knowledgeRevisionId: `city-knowledge:${cityId}`,
    evidenceSnapshotId: `city-evidence:${cityId}`,
    lastCheckedAt: "2026-08-21T00:00:00.000Z",
    requiredMismatches: [],
    unknownBasis: [],
    verificationCoverage: "1",
    facts,
  };
}

function successor(
  predecessor: CityFrontierRevision,
  cityMarker: CityLiveMarker = marker(),
  commandId = `command:${cityMarker.cityId}-completed`,
  kind: "working" | "terminal" = "working",
): CityFrontierRevision {
  const markers = [...predecessor.markers, cityMarker];
  const common = {
    nextUncheckedRank: markers.length + 1,
    selectableCityIds: markers.map(({ cityId }) => cityId),
  };
  const projection: CityFrontierProjection = kind === "working"
    ? { kind, ...common, phase: "verification_required" }
    : {
        kind,
        ...common,
        entries: markers.map((item) => ({
          cityId: item.cityId,
          rank: item.rank,
          markerDigest: DECISION_INTEGRITY.hash(DECISION_INTEGRITY.canonical(item)),
          knowledgeRevisionId: item.knowledgeRevisionId,
          evidenceSnapshotId: item.evidenceSnapshotId,
          unknownBasis: item.unknownBasis,
        })),
        stopCondition: "catalog_exhausted",
      };
  return sealCityFrontierRevision({
    runId: predecessor.runId,
    predecessorRevisionId: predecessor.id,
    rankingSnapshotId: predecessor.rankingSnapshotId,
    markers,
    projection,
    operation: {
      kind: "city_completed",
      commandId,
      expectedHeadRevisionId: predecessor.id,
      cityId: cityMarker.cityId,
      cityCheckRunId: `city-check:${cityMarker.cityId}`,
    },
    createdAt: new Date(Date.parse(predecessor.createdAt) + 60_000).toISOString(),
  }, DECISION_INTEGRITY);
}

describe("City frontier SQLite port contracts", () => {
  test("implements only the exact inward Task 13 persistence surfaces", () => {
    // Break caught: a loader context/semantic proof or legacy publication DTO reaching SQLite.
    const fixture = harness();
    expectTypeOf(fixture.criteria).toEqualTypeOf<CityCriteriaReadPort>();
    expectTypeOf(fixture.branches).toEqualTypeOf<CityBranchReadPort>();
    expectTypeOf(fixture.frontier).toEqualTypeOf<
      CityFrontierStorePort & CityRankingReadPort & CityFrontierStartWriterPort
    >();
    expectTypeOf(fixture.branches.loadPreCityBranchVerified).toEqualTypeOf<(
      id: string,
    ) => PreCityBranchCommit>();
    expectTypeOf(fixture.frontier.appendRevision).toEqualTypeOf<(
      input: { readonly revision: CityFrontierRevision },
    ) => CityFrontierRevision>();
  });

  test("compile-pins the exact structural constructor dependency DTO", () => {
    expectTypeOf<ConstructorParameters<typeof SqliteCityCriteriaStore>>()
      .toEqualTypeOf<[
        database: Database.Database,
        integrity: EvidenceIntegrity,
      ]>();
    expectTypeOf<ConstructorParameters<typeof SqliteCityBranchStore>>()
      .toEqualTypeOf<[
        database: Database.Database,
        integrity: EvidenceIntegrity,
        countries: CountryResolutionStorePort,
      ]>();
    expectTypeOf<ConstructorParameters<typeof SqliteCityFrontierStore>>()
      .toEqualTypeOf<[
        database: Database.Database,
        integrity: EvidenceIntegrity,
        dependencies: {
          readonly criteria: CityCriteriaReadPort;
          readonly branches: CityBranchReadPort;
          readonly catalogs: CityCatalogStorePort;
        },
      ]>();
  });

  test("imports only structural persistence authority across all literal module forms", () => {
    // Break caught: type-only or lazy imports smuggling evaluator/Knowledge/Task 11 authority outward.
    const forbiddenSymbol = /(?:Knowledge|Evidence)|^(?:CityCriterionEvaluator|reconstructCityCriteria$|CityCriteriaProjection$|verifyCityRankingSnapshotSemantics$|CityMarkerAuthorityProjection|CityFrontierRankingProjection|ReconstructCityLiveMarkerInput|ReconstructCityFrontierInput|CityFrontierProjection|CityLiveMarker|CityCommittedFactProjection|CityCommittedFactProjectionTuple|CityTerminalEntry)$/;
    const forbiddenModule = /(?:city-knowledge|city-evidence|city-ranker|city-frontier-policy|city-safety)/;
    const namespaceSensitiveModule = /(?:city-data-contracts|city-frontier-contracts|city-criteria|city-ranker|city-frontier-policy)/;
    const allowedIntegritySymbols = new Set(["EvidenceIntegrity"]);
    const violations: string[] = [];
    for (const relativePath of [
      "../../src/infrastructure/sqlite/city-criteria-store.ts",
      "../../src/infrastructure/sqlite/city-branch-store.ts",
      "../../src/infrastructure/sqlite/city-frontier-store.ts",
    ]) {
      const url = new URL(relativePath, import.meta.url);
      const source = ts.createSourceFile(
        url.pathname,
        readFileSync(url, "utf8"),
        ts.ScriptTarget.Latest,
        true,
      );
      const inspect = (node: ts.Node): void => {
        const checkModule = (specifier: string, symbol?: string): void => {
          if (
            forbiddenModule.test(specifier) ||
            (symbol !== undefined &&
              forbiddenSymbol.test(symbol) &&
              !allowedIntegritySymbols.has(symbol)) ||
            ((symbol === "*" || symbol === "default") &&
              namespaceSensitiveModule.test(specifier))
          ) {
            violations.push(`${relativePath}: ${specifier}${symbol === undefined ? "" : `#${symbol}`}`);
          }
        };
        if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
          const specifier = node.moduleSpecifier.text;
          const clause = node.importClause;
          if (clause?.name !== undefined) checkModule(specifier, "default");
          if (clause?.namedBindings !== undefined) {
            if (ts.isNamespaceImport(clause.namedBindings)) checkModule(specifier, "*");
            else {
              for (const element of clause.namedBindings.elements) {
                checkModule(specifier, (element.propertyName ?? element.name).text);
              }
            }
          }
          if (clause === undefined) checkModule(specifier, "*");
        } else if (
          ts.isExportDeclaration(node) &&
          node.moduleSpecifier !== undefined &&
          ts.isStringLiteral(node.moduleSpecifier)
        ) {
          const specifier = node.moduleSpecifier.text;
          if (node.exportClause === undefined) checkModule(specifier, "*");
          else if (ts.isNamedExports(node.exportClause)) {
            for (const element of node.exportClause.elements) {
              checkModule(specifier, (element.propertyName ?? element.name).text);
            }
          } else checkModule(specifier, "*");
        } else if (ts.isImportTypeNode(node)) {
          const argument = node.argument;
          if (
            ts.isLiteralTypeNode(argument) &&
            ts.isStringLiteral(argument.literal)
          ) {
            checkModule(
              argument.literal.text,
              node.qualifier?.getText(source) ?? "*",
            );
          }
        } else if (
          ts.isCallExpression(node) &&
          node.arguments.length === 1 &&
          ts.isStringLiteral(node.arguments[0]) &&
          (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
            (ts.isIdentifier(node.expression) && node.expression.text === "require"))
        ) {
          checkModule(node.arguments[0].text, "*");
        }
        ts.forEachChild(node, inspect);
      };
      inspect(source);
    }

    expect(violations).toEqual([]);
  });
});

describe("City frontier four-artifact Start publication", () => {
  test("round-trips Criteria, deterministic parent, Ranking and root as exact fresh values", () => {
    // Break caught: partial publication, SQLite read-model assembly, or an aliased mutable result.
    const fixture = harness();

    const result = fixture.frontier.publishStart(fixture.publication);

    expect(result).toEqual({
      criteria: fixture.publication.criteria,
      preCityBranch: fixture.publication.preCityBranch,
      ranking: fixture.publication.ranking,
      root: fixture.publication.root,
    });
    expect(Object.keys(result).sort()).toEqual([
      "criteria", "preCityBranch", "ranking", "root",
    ]);
    expect(result).not.toBe(fixture.publication);
    expect(result.criteria).not.toBe(fixture.publication.criteria);
    expect(result.preCityBranch).not.toBe(fixture.publication.preCityBranch);
    expect(result.ranking).not.toBe(fixture.publication.ranking);
    expect(result.root).not.toBe(fixture.publication.root);
    recursivelyNotAliased(result, fixture.publication);
    recursivelyFrozen(result);
    expect(rowCount(fixture.database, "city_criteria_snapshots")).toBe(1);
    expect(rowCount(fixture.database, "city_branch_commits")).toBe(1);
    expect(rowCount(fixture.database, "city_ranking_snapshots")).toBe(1);
    expect(rowCount(fixture.database, "city_frontier_revisions")).toBe(1);
    expect(rowCount(fixture.database, "city_selection_snapshots")).toBe(0);

    const criteria = fixture.criteria.loadCriteriaVerified(result.criteria.id);
    const parent = fixture.branches.loadPreCityBranchVerified(result.preCityBranch.id);
    const bySource = fixture.branches.findPreCityBranchBySourceVerified(
      fixture.publication.preCitySource,
    );
    const ranking = fixture.frontier.loadRankingVerified(result.ranking.id);
    const root = fixture.frontier.loadRevisionVerified(result.root.id);
    const head = fixture.frontier.loadHeadVerified(result.root.runId);
    const chain = fixture.frontier.loadChainVerified(result.root.runId);
    const command = fixture.frontier.findCommandVerified(
      result.root.runId,
      result.root.operation.commandId,
    );
    expect({ criteria, parent, bySource, ranking, root, head, chain, command }).toEqual({
      criteria: result.criteria,
      parent: result.preCityBranch,
      bySource: result.preCityBranch,
      ranking: result.ranking,
      root: result.root,
      head: result.root,
      chain: [result.root],
      command: { operation: result.root.operation, revision: result.root },
    });
    for (const value of [criteria, parent, bySource, ranking, root, head, chain, command]) {
      recursivelyFrozen(value);
    }
  });

  test("returns fresh non-aliased results for retry, load/find, append and chain families", () => {
    // Break caught: caching one frozen wrapper or returning stored/caller aliases.
    const fixture = harness();
    const firstStart = fixture.frontier.publishStart(fixture.publication);
    const secondStart = fixture.frontier.publishStart(structuredClone(fixture.publication));
    expect(secondStart).toEqual(firstStart);
    expect(secondStart).not.toBe(firstStart);
    expect(secondStart.criteria).not.toBe(firstStart.criteria);
    expect(secondStart.preCityBranch).not.toBe(firstStart.preCityBranch);
    expect(secondStart.ranking).not.toBe(firstStart.ranking);
    expect(secondStart.root).not.toBe(firstStart.root);
    recursivelyNotAliased(secondStart, firstStart);

    const firstLoad = fixture.frontier.loadRevisionVerified(firstStart.root.id);
    const secondLoad = fixture.frontier.loadRevisionVerified(firstStart.root.id);
    expect(secondLoad).toEqual(firstLoad);
    expect(secondLoad).not.toBe(firstLoad);
    recursivelyNotAliased(secondLoad, firstLoad);

    const firstFind = fixture.frontier.findCommandVerified(
      firstStart.root.runId,
      firstStart.root.operation.commandId,
    );
    const secondFind = fixture.frontier.findCommandVerified(
      firstStart.root.runId,
      firstStart.root.operation.commandId,
    );
    expect(secondFind).toEqual(firstFind);
    expect(secondFind).not.toBe(firstFind);
    expect(secondFind?.operation).not.toBe(firstFind?.operation);
    expect(secondFind?.revision).not.toBe(firstFind?.revision);
    recursivelyNotAliased(secondFind, firstFind);

    const appended = successor(firstStart.root);
    const firstAppend = fixture.frontier.appendRevision({ revision: appended });
    const secondAppend = fixture.frontier.appendRevision({
      revision: structuredClone(appended),
    });
    expect(secondAppend).toEqual(firstAppend);
    expect(secondAppend).not.toBe(firstAppend);
    expect(firstAppend).not.toBe(appended);
    expect(firstAppend.operation).not.toBe(appended.operation);
    expect(firstAppend.markers).not.toBe(appended.markers);
    recursivelyNotAliased(firstAppend, appended);
    recursivelyNotAliased(secondAppend, firstAppend);
    const firstChain = fixture.frontier.loadChainVerified(firstStart.root.runId);
    const secondChain = fixture.frontier.loadChainVerified(firstStart.root.runId);
    expect(secondChain).toEqual(firstChain);
    expect(secondChain).not.toBe(firstChain);
    expect(secondChain[0]).not.toBe(firstChain[0]);
    recursivelyNotAliased(secondChain, firstChain);
    recursivelyFrozen(secondStart);
    recursivelyFrozen(secondFind);
    recursivelyFrozen(secondAppend);
    recursivelyFrozen(secondChain);
  });

  test("owns and exact-closes the six-key Start graph before SQL or accessor execution", () => {
    // Break caught: transaction/lookup or nested getter execution before complete publication capture.
    const fixture = harness();
    const observation = observedDatabase(fixture.database);
    const observed = observedFrontier(fixture, observation);
    let accessorReads = 0;
    const accessor = structuredClone(fixture.publication);
    Object.defineProperty(accessor.intent, "countryCode", {
      enumerable: true,
      get() {
        accessorReads += 1;
        return fixture.publication.intent.countryCode;
      },
    });
    const symbol = structuredClone(fixture.publication);
    Object.defineProperty(symbol.ranking, Symbol("hidden"), { value: true });
    const candidates = [
      { ...structuredClone(fixture.publication), extra: true },
      accessor,
      symbol,
    ];
    for (const candidate of candidates) {
      const first = (() => {
        try {
          observed.frontier.publishStart(
            candidate as unknown as CityFrontierStartPublication,
          );
        } catch (error) {
          return error;
        }
        return undefined;
      })();
      const second = (() => {
        try {
          observed.frontier.publishStart(
            candidate as unknown as CityFrontierStartPublication,
          );
        } catch (error) {
          return error;
        }
        return undefined;
      })();
      expect(first).toBeInstanceOf(Error);
      expect(second).toBeInstanceOf(Error);
      expect((first as Error).message).toBe("integrity_mismatch");
      expect((second as Error).message).toBe("integrity_mismatch");
      expect(second).not.toBe(first);
    }
    expect(accessorReads).toBe(0);
    expect(observation.calls()).toBe(0);
    expect(observed.dependencyCalls()).toBe(0);
  });

  test("rejects bounded authentic Start graph/time/binding drift before SQL", () => {
    // Break caught: validating artifacts separately but omitting publication-wide equations.
    const fixture = harness();
    const rankingWith = (
      changes: Partial<CityRankingSnapshotPayload>,
    ): CityRankingSnapshot => {
      const { id, ...payload } = fixture.publication.ranking;
      void id;
      return sealCityRankingSnapshot({
        ...structuredClone(payload),
        ...changes,
      }, DECISION_INTEGRITY);
    };
    const rootWith = (
      ranking: CityRankingSnapshot,
      changes: Partial<{
        readonly runId: string;
        readonly markers: readonly CityLiveMarker[];
        readonly projection: CityFrontierProjection;
      }> = {},
    ): CityFrontierRevision => sealCityFrontierRevision({
      runId: changes.runId ?? fixture.publication.root.runId,
      rankingSnapshotId: ranking.id,
      markers: changes.markers ?? [],
      projection: changes.projection ?? workingProjection(
        fixture.publication.root as WorkingCityFrontierRevision,
      ),
      operation: structuredClone(fixture.publication.root.operation),
      createdAt: fixture.publication.root.createdAt,
    }, DECISION_INTEGRITY);
    const laterCriteria = criteriaSnapshot(
      fixture.publication.criteria.criteria,
      "2026-08-20T12:00:01.000Z",
    );
    const laterCriteriaRanking = rankingWith({ criteriaSnapshotId: laterCriteria.id });
    const lateParent = createPreCityBranchCommit({
      source: fixture.publication.preCitySource,
      createdAt: "2026-08-20T12:00:01.000Z",
    }, DECISION_INTEGRITY);
    const lateParentRanking = rankingWith({ preCityBranchCommitId: lateParent.id });
    const detachedRanking = rankingWith({ criteriaSnapshotId: "city-criteria:detached" });
    const contextRanking = structuredClone(fixture.publication.ranking);
    (contextRanking.installedPackageContext as unknown as Record<string, unknown>)
      .countryCode = "AT";
    const startOperation = fixture.publication.root.operation;
    if (startOperation.kind !== "start") throw new Error("invalid_fixture");
    const operationHashRoot = sealCityFrontierRevision({
      runId: fixture.publication.root.runId,
      rankingSnapshotId: fixture.publication.ranking.id,
      markers: [],
      projection: workingProjection(
        fixture.publication.root as WorkingCityFrontierRevision,
      ),
      operation: {
        ...startOperation,
        criteriaPayloadHash: "e".repeat(64),
      },
      createdAt: fixture.publication.root.createdAt,
    }, DECISION_INTEGRITY);
    const oneMarker = marker();
    const nonZeroMarkerRoot = structuredClone(fixture.publication.root);
    const mutableNonZeroMarkerRoot = nonZeroMarkerRoot as unknown as Record<string, unknown>;
    mutableNonZeroMarkerRoot.markers = [oneMarker];
    mutableNonZeroMarkerRoot.nextUncheckedRank = 2;
    const candidates: readonly CityFrontierStartPublication[] = [
      {
        ...fixture.publication,
        intent: { ...fixture.publication.intent, criteriaPayloadHash: "f".repeat(64) },
      },
      {
        ...fixture.publication,
        criteria: laterCriteria,
        ranking: laterCriteriaRanking,
        root: rootWith(laterCriteriaRanking),
      },
      {
        ...fixture.publication,
        preCityBranch: lateParent,
        ranking: lateParentRanking,
        root: rootWith(lateParentRanking),
      },
      {
        ...fixture.publication,
        preCitySource: {
          ...fixture.publication.preCitySource,
          resolvedCountryEntry: {
            ...fixture.publication.preCitySource.resolvedCountryEntry,
            formalMarkerDigest: "e".repeat(64),
          },
        },
      },
      {
        ...fixture.publication,
        ranking: detachedRanking,
        root: rootWith(detachedRanking),
      },
      {
        ...fixture.publication,
        ranking: contextRanking,
        root: rootWith(contextRanking),
      },
      { ...fixture.publication, root: operationHashRoot },
      {
        ...fixture.publication,
        root: rootWith(fixture.publication.ranking, {
          projection: {
            kind: "working",
            nextUncheckedRank: 2,
            selectableCityIds: [],
            phase: "verification_required",
          },
        }),
      },
      {
        ...fixture.publication,
        root: nonZeroMarkerRoot,
      },
      {
        ...fixture.publication,
        root: rootWith(fixture.publication.ranking, {
          runId: "city-frontier:detached-run",
        }),
      },
    ];
    for (const candidate of candidates) {
      const observation = observedDatabase(fixture.database);
      const observed = observedFrontier(fixture, observation);
      expectErrorMessage(
        () => observed.frontier.publishStart(candidate),
        "integrity_mismatch",
      );
      expect(observation.calls()).toBe(0);
      expect(observed.dependencyCalls()).toBe(0);
    }
    expect(rowCount(fixture.database, "city_criteria_snapshots")).toBe(0);
    expect(rowCount(fixture.database, "city_branch_commits")).toBe(0);
    expect(rowCount(fixture.database, "city_ranking_snapshots")).toBe(0);
    expect(rowCount(fixture.database, "city_frontier_revisions")).toBe(0);
  });

  test("uses exact not-found errors and undefined only for absent verified lookups", () => {
    // Break caught: treating corruption as absence or reserving Task 15's selection error early.
    const fixture = harness();
    expectErrorMessage(
      () => fixture.criteria.loadCriteriaVerified("city-criteria:absent"),
      "city_criteria_not_found",
    );
    expectErrorMessage(
      () => fixture.branches.loadPreCityBranchVerified("pre-city-branch:absent"),
      "pre_city_branch_not_found",
    );
    expectErrorMessage(
      () => fixture.frontier.loadRankingVerified("city-ranking:absent"),
      "city_ranking_not_found",
    );
    expectErrorMessage(
      () => fixture.frontier.loadRevisionVerified("city-frontier-revision:absent"),
      "city_frontier_not_found",
    );
    expectErrorMessage(
      () => fixture.frontier.loadHeadVerified("city-frontier:absent"),
      "city_frontier_not_found",
    );
    expectErrorMessage(
      () => fixture.frontier.loadChainVerified("city-frontier:absent"),
      "city_frontier_not_found",
    );
    expectErrorMessage(
      () => fixture.frontier.findCommandVerified("city-frontier:absent", "command:absent"),
      "city_frontier_not_found",
    );
    expect(fixture.branches.findPreCityBranchBySourceVerified(
      fixture.publication.preCitySource,
    )).toBeUndefined();

    fixture.frontier.publishStart(fixture.publication);
    expect(fixture.frontier.findCommandVerified(
      fixture.publication.root.runId,
      "command:absent",
    )).toBeUndefined();
  });

  test.each([
    ["city_criteria_snapshots", "criteria"],
    ["city_branch_commits", "branch"],
    ["city_ranking_snapshots", "ranking"],
    ["city_frontier_revisions", "frontier"],
  ] as const)("rolls back all Start writes when %s fails after insertion", (table, suffix) => {
    // Break caught: artifact-by-artifact commits escaping the one BEGIN IMMEDIATE transaction.
    const fixture = harness();
    fixture.database.exec(`
      CREATE TRIGGER inject_start_failure_${suffix} AFTER INSERT ON ${table}
      BEGIN SELECT RAISE(ABORT, 'injected_start_failure_${suffix}'); END
    `);

    expectErrorMessage(
      () => fixture.frontier.publishStart(fixture.publication),
      `injected_start_failure_${suffix}`,
    );
    expect(rowCount(fixture.database, "city_criteria_snapshots")).toBe(0);
    expect(rowCount(fixture.database, "city_branch_commits")).toBe(0);
    expect(rowCount(fixture.database, "city_ranking_snapshots")).toBe(0);
    expect(rowCount(fixture.database, "city_frontier_revisions")).toBe(0);
  });

  test("keeps a pre-existing shared parent when a later Start transaction rolls back", () => {
    // Break caught: rollback deleting an exact deterministic parent owned by another Start.
    const fixture = harness({ commandId: "command:first", firstTarget: "2" });
    fixture.frontier.publishStart(fixture.publication);
    const second = publicationFixture({ commandId: "command:second", firstTarget: "3" });
    fixture.database.exec(`
      CREATE TRIGGER inject_second_ranking_failure AFTER INSERT ON city_ranking_snapshots
      BEGIN SELECT RAISE(ABORT, 'injected_second_ranking_failure'); END
    `);

    expectErrorMessage(
      () => fixture.frontier.publishStart(second.publication),
      "injected_second_ranking_failure",
    );
    expect(rowCount(fixture.database, "city_branch_commits")).toBe(1);
    expect(fixture.branches.loadPreCityBranchVerified(
      fixture.publication.preCityBranch.id,
    )).toEqual(fixture.publication.preCityBranch);
    expect(rowCount(fixture.database, "city_criteria_snapshots")).toBe(1);
    expect(rowCount(fixture.database, "city_ranking_snapshots")).toBe(1);
    expect(rowCount(fixture.database, "city_frontier_revisions")).toBe(1);
  });

  test("reuses one deterministic parent for different Criteria/run identities", () => {
    // Break caught: current Start time or Criteria leaking into the pre-city parent ID.
    const fixture = harness({ commandId: "command:first", firstTarget: "2" });
    const first = fixture.frontier.publishStart(fixture.publication);
    const secondCandidate = publicationFixture({
      commandId: "command:second",
      firstTarget: "3",
      startAt: "2026-08-20T13:00:00.000Z",
    });
    const second = fixture.frontier.publishStart(secondCandidate.publication);

    expect(first.root.runId).not.toBe(second.root.runId);
    expect(second.preCityBranch).toEqual(first.preCityBranch);
    expect(second.preCityBranch.id).toBe(first.preCityBranch.id);
    expect(rowCount(fixture.database, "city_branch_commits")).toBe(1);
    expect(rowCount(fixture.database, "city_criteria_snapshots")).toBe(2);
    expect(rowCount(fixture.database, "city_ranking_snapshots")).toBe(2);
    expect(rowCount(fixture.database, "city_frontier_revisions")).toBe(2);
  });

  test("replays one global Start command only for exact timestamp-free intent", () => {
    // Break caught: retry-time artifacts replacing the winner or command drift creating a second run.
    const fixture = harness();
    const winner = fixture.frontier.publishStart(fixture.publication);
    const later = publicationFixture({
      commandId: fixture.publication.root.operation.commandId,
      startAt: "2026-08-21T12:00:00.000Z",
    });

    expect(fixture.frontier.publishStart(later.publication)).toEqual(winner);
    expect(rowCount(fixture.database, "city_criteria_snapshots")).toBe(1);
    expect(rowCount(fixture.database, "city_frontier_revisions")).toBe(1);

    const changedCriteria = publicationFixture({
      commandId: fixture.publication.root.operation.commandId,
      firstTarget: "3",
    });
    expect(() => fixture.frontier.publishStart(changedCriteria.publication))
      .toThrow("integrity_mismatch");
    expect(rowCount(fixture.database, "city_frontier_revisions")).toBe(1);
  });

  test("rejects a stale claimed run before replaying a global Start command", () => {
    // Break caught: exact command replay bypassing recomputation of nested installed identity.
    const fixture = harness();
    fixture.frontier.publishStart(fixture.publication);
    const { id: _rankingId, ...rankingPayload } = fixture.publication.ranking;
    void _rankingId;
    const ranking = sealCityRankingSnapshot({
      ...structuredClone(rankingPayload),
      installedPackageContext: {
        ...structuredClone(rankingPayload.installedPackageContext),
        evidenceRulesVersion: "si-city-evidence@2",
      },
    }, DECISION_INTEGRITY);
    const root = sealCityFrontierRevision({
      runId: fixture.publication.root.runId,
      rankingSnapshotId: ranking.id,
      markers: [],
      projection: workingProjection(
        fixture.publication.root as WorkingCityFrontierRevision,
      ),
      operation: structuredClone(fixture.publication.root.operation),
      createdAt: fixture.publication.root.createdAt,
    }, DECISION_INTEGRITY);

    expectErrorMessage(
      () => fixture.frontier.publishStart({ ...fixture.publication, ranking, root }),
      "integrity_mismatch",
    );
    expect(rowCount(fixture.database, "city_criteria_snapshots")).toBe(1);
    expect(rowCount(fixture.database, "city_branch_commits")).toBe(1);
    expect(rowCount(fixture.database, "city_ranking_snapshots")).toBe(1);
    expect(rowCount(fixture.database, "city_frontier_revisions")).toBe(1);
  });

  test.each(["miss", "hit"] as const)(
    "orders the %s global Start command lookup before candidate Catalog authority",
    (mode) => {
      // Break caught: Catalog or run-scoped work occurring before the global command decision.
      const fixture = harness();
      if (mode === "hit") fixture.frontier.publishStart(fixture.publication);
      const events: string[] = [];
      const observedDatabase = new Proxy(fixture.database, {
        get(target, key, receiver) {
          if (key === "transaction") {
            return (callback: () => unknown) => target.transaction(() => {
              events.push("begin_immediate");
              return callback();
            });
          }
          if (key === "prepare") {
            return (source: string) => {
              const sql = source.replace(/\s+/g, " ").toLowerCase();
              if (sql.includes("operation_kind = 'start'") &&
                sql.includes("command_id = ?")) {
                events.push("global_command");
              } else if (sql.includes("insert into city_") ||
                sql.includes("where run_id = ?")) {
                events.push("run_or_write");
              }
              return target.prepare(source);
            };
          }
          const value = Reflect.get(target, key, receiver) as unknown;
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
      const criteria = new SqliteCityCriteriaStore(observedDatabase, INTEGRITY);
      const branches = new SqliteCityBranchStore(
        observedDatabase,
        INTEGRITY,
        countryPort(fixture.locator),
      );
      const catalogs: CityCatalogStorePort = {
        appendVerified() {
          throw new Error("unexpected_catalog_append");
        },
        loadVerified(id) {
          events.push("catalog");
          return catalogPort(fixture.catalogBundle).loadVerified(id);
        },
      };
      const frontier = new SqliteCityFrontierStore(
        observedDatabase,
        INTEGRITY,
        { criteria, branches, catalogs },
      );

      expect(frontier.publishStart(structuredClone(fixture.publication)).root)
        .toEqual(fixture.publication.root);
      const catalogIndex = events.indexOf("catalog");
      expect(events.slice(0, 3)).toEqual([
        "begin_immediate",
        "global_command",
        "catalog",
      ]);
      expect(events.slice(0, catalogIndex)).not.toContain("run_or_write");
    },
  );

  test.each([
    "resolved_revision",
    "country",
    "installed_context",
  ] as const)("rejects global Start command drift in %s after catalog authentication", (drift) => {
    // Break caught: command-first replay accepting a different derived intent/run under one global ID.
    const fixture = harness();
    fixture.frontier.publishStart(fixture.publication);
    const candidate = commandDriftPublication(fixture.publication, drift);

    expectErrorMessage(
      () => fixture.frontier.publishStart(candidate),
      "integrity_mismatch",
    );
    expect(rowCount(fixture.database, "city_criteria_snapshots")).toBe(1);
    expect(rowCount(fixture.database, "city_branch_commits")).toBe(1);
    expect(rowCount(fixture.database, "city_ranking_snapshots")).toBe(1);
    expect(rowCount(fixture.database, "city_frontier_revisions")).toBe(1);
  });

  test("rejects a different Start command for the same deterministic run before artifact writes", () => {
    // Break caught: run uniqueness becoming a generic constraint after partial artifact inserts.
    const fixture = harness();
    fixture.frontier.publishStart(fixture.publication);
    const differentRoot = sealCityFrontierRevision({
      runId: fixture.publication.root.runId,
      rankingSnapshotId: fixture.publication.ranking.id,
      markers: [],
      projection: {
        kind: "working",
        nextUncheckedRank: 1,
        selectableCityIds: [],
        phase: "verification_required",
      },
      operation: {
        ...fixture.publication.root.operation,
        commandId: "command:different-start",
      },
      createdAt: fixture.publication.root.createdAt,
    }, DECISION_INTEGRITY);
    const conflict = { ...fixture.publication, root: differentRoot };

    expect(() => fixture.frontier.publishStart(conflict)).toThrow("integrity_mismatch");
    expect(rowCount(fixture.database, "city_criteria_snapshots")).toBe(1);
    expect(rowCount(fixture.database, "city_ranking_snapshots")).toBe(1);
    expect(rowCount(fixture.database, "city_frontier_revisions")).toBe(1);
  });
});

describe("City frontier append, topology and command replay", () => {
  test("owns and closes an append candidate before SQL or dependency execution", () => {
    // Break caught: replay/head lookup beginning before hostile revision ownership.
    const fixture = harness();
    const start = fixture.frontier.publishStart(fixture.publication);
    const observation = observedDatabase(fixture.database);
    const observed = observedFrontier(fixture, observation);
    let accessorReads = 0;
    const accessor = structuredClone(successor(start.root));
    Object.defineProperty(accessor.markers[0], "cityId", {
      enumerable: true,
      get() {
        accessorReads += 1;
        return "ljubljana";
      },
    });
    const validSuccessor = successor(start.root);
    const nextRankDrift = sealCityFrontierRevision({
      runId: validSuccessor.runId,
      predecessorRevisionId: validSuccessor.predecessorRevisionId,
      rankingSnapshotId: validSuccessor.rankingSnapshotId,
      markers: validSuccessor.markers,
      projection: {
        kind: "working",
        nextUncheckedRank: 3,
        selectableCityIds: [validSuccessor.markers[0]!.cityId],
        phase: "verification_required",
      },
      operation: validSuccessor.operation,
      createdAt: validSuccessor.createdAt,
    }, DECISION_INTEGRITY);
    const candidates = [
      { ...structuredClone(successor(start.root)), extra: true },
      accessor,
      structuredClone(start.root),
      nextRankDrift,
    ];
    for (const candidate of candidates) {
      const errors = [0, 1].map(() => {
        try {
          observed.frontier.appendRevision({
            revision: candidate as unknown as CityFrontierRevision,
          });
        } catch (error) {
          return error;
        }
        return undefined;
      });
      expect(errors[0]).toBeInstanceOf(Error);
      expect(errors[1]).toBeInstanceOf(Error);
      expect((errors[0] as Error).message).toBe("integrity_mismatch");
      expect((errors[1] as Error).message).toBe("integrity_mismatch");
      expect(errors[1]).not.toBe(errors[0]);
    }
    expect(accessorReads).toBe(0);
    expect(observation.calls()).toBe(0);
    expect(observed.dependencyCalls()).toBe(0);
  });

  test("appends one exact successor and resolves the command from a canonical root-to-head chain", () => {
    // Break caught: append returning only a caller projection or chain order depending on rowid.
    const fixture = harness();
    const start = fixture.frontier.publishStart(fixture.publication);
    const candidate = successor(start.root);

    const appended = fixture.frontier.appendRevision({ revision: candidate });

    expect(appended).toEqual(candidate);
    expect(appended).not.toBe(candidate);
    recursivelyFrozen(appended);
    expect(fixture.frontier.loadChainVerified(start.root.runId)).toEqual([
      start.root,
      candidate,
    ]);
    expect(fixture.frontier.loadHeadVerified(start.root.runId)).toEqual(candidate);
    expect(fixture.frontier.findCommandVerified(
      start.root.runId,
      candidate.operation.commandId,
    )).toEqual({ operation: candidate.operation, revision: candidate });

    fixture.database.pragma("reverse_unordered_selects = ON");
    expect(fixture.frontier.loadChainVerified(start.root.runId)).toEqual([
      start.root,
      candidate,
    ]);
  });

  test("compares command equality before replay and returns the committed winner", () => {
    // Break caught: same command returning candidate bytes or applying stale logic before drift detection.
    const fixture = harness();
    const start = fixture.frontier.publishStart(fixture.publication);
    const winner = successor(start.root);
    fixture.frontier.appendRevision({ revision: winner });

    const replay = fixture.frontier.appendRevision({ revision: structuredClone(winner) });
    expect(replay).toEqual(winner);
    expect(replay).not.toBe(winner);
    const laterWinner = sealCityFrontierRevision({
      runId: winner.runId,
      predecessorRevisionId: winner.predecessorRevisionId,
      rankingSnapshotId: winner.rankingSnapshotId,
      markers: winner.markers,
      projection: workingProjection(winner as WorkingCityFrontierRevision),
      operation: winner.operation,
      createdAt: new Date(Date.parse(winner.createdAt) + 60_000).toISOString(),
    }, DECISION_INTEGRITY);
    expect(fixture.frontier.appendRevision({ revision: laterWinner })).toEqual(winner);
    const drift = successor(
      start.root,
      marker("maribor"),
      winner.operation.commandId,
    );
    expect(() => fixture.frontier.appendRevision({ revision: drift }))
      .toThrow("integrity_mismatch");
    expect(rowCount(fixture.database, "city_frontier_revisions")).toBe(2);
  });

  test("maps an absent append run to integrity mismatch without inserting", () => {
    // Break caught: append leaking loader not-found vocabulary for a missing predecessor/run.
    const fixture = harness();
    const absentPredecessor = `city-frontier-revision:${"e".repeat(64)}`;
    const cityMarker = marker();
    const candidate = sealCityFrontierRevision({
      runId: `city-frontier:${"e".repeat(64)}`,
      predecessorRevisionId: absentPredecessor,
      rankingSnapshotId: fixture.publication.ranking.id,
      markers: [cityMarker],
      projection: {
        kind: "working",
        nextUncheckedRank: 2,
        selectableCityIds: [cityMarker.cityId],
        phase: "verification_required",
      },
      operation: {
        kind: "city_completed",
        commandId: "command:absent-run",
        expectedHeadRevisionId: absentPredecessor,
        cityId: cityMarker.cityId,
        cityCheckRunId: "city-check:absent-run",
      },
      createdAt: "2026-08-21T12:00:00.000Z",
    }, DECISION_INTEGRITY);

    const first = (() => {
      try {
        fixture.frontier.appendRevision({ revision: candidate });
      } catch (error) {
        return error;
      }
      return undefined;
    })();
    const second = (() => {
      try {
        fixture.frontier.appendRevision({ revision: candidate });
      } catch (error) {
        return error;
      }
      return undefined;
    })();
    expect(first).toBeInstanceOf(Error);
    expect(second).toBeInstanceOf(Error);
    expect((first as Error).message).toBe("integrity_mismatch");
    expect((second as Error).message).toBe("integrity_mismatch");
    expect(second).not.toBe(first);
    expect(rowCount(fixture.database, "city_frontier_revisions")).toBe(0);
  });

  test("labels only an authenticated same-run non-head ancestor as stale", () => {
    // Break caught: all constraint/missing/cross-run failures being collapsed into stale-head.
    const fixture = harness();
    const start = fixture.frontier.publishStart(fixture.publication);
    const head = fixture.frontier.appendRevision({ revision: successor(start.root) });
    const competing = successor(
      start.root,
      marker("maribor"),
      "command:maribor-completed",
    );

    expect(() => fixture.frontier.appendRevision({ revision: competing }))
      .toThrow("stale_city_frontier_head");

    const otherCandidate = publicationFixture({
      commandId: "command:other-run",
      firstTarget: "3",
    });
    const other = fixture.frontier.publishStart(otherCandidate.publication);
    const authenticCases = [
      {
        label: "missing predecessor",
        predecessorRevisionId: "city-frontier-revision:missing",
        rankingSnapshotId: start.ranking.id,
      },
      {
        label: "cross-run predecessor",
        predecessorRevisionId: other.root.id,
        rankingSnapshotId: start.ranking.id,
      },
      {
        label: "cross-Ranking successor",
        predecessorRevisionId: head.id,
        rankingSnapshotId: other.ranking.id,
      },
    ] as const;
    for (const candidateCase of authenticCases) {
      const revision = sealCityFrontierRevision({
        runId: start.root.runId,
        predecessorRevisionId: candidateCase.predecessorRevisionId,
        rankingSnapshotId: candidateCase.rankingSnapshotId,
        markers: [
          ...head.markers,
          marker(candidateCase.label, head.markers.length + 1),
        ],
        projection: {
          kind: "working",
          nextUncheckedRank: head.markers.length + 2,
          selectableCityIds: [
            ...head.markers
              .filter(({ status }: CityLiveMarker) => status === "selectable")
              .map(({ cityId }: CityLiveMarker) => cityId),
            candidateCase.label,
          ],
          phase: "verification_required",
        },
        operation: {
          kind: "city_completed",
          commandId: `command:${candidateCase.label}`,
          expectedHeadRevisionId: candidateCase.predecessorRevisionId,
          cityId: candidateCase.label,
          cityCheckRunId: `city-check:${candidateCase.label}`,
        },
        createdAt: new Date(Date.parse(head.createdAt) + 60_000).toISOString(),
      }, DECISION_INTEGRITY);
      expectErrorMessage(
        () => fixture.frontier.appendRevision({ revision }),
        "integrity_mismatch",
      );
    }
    expect(rowCount(fixture.database, "city_frontier_revisions")).toBe(3);
  });

  test.each([
    "non_prefix_markers",
    "prefix_plus_two_markers",
    "expected_head_mismatch",
    "decreasing_time",
    "cross_run_edge",
    "cross_ranking_edge",
  ] as const)("rejects authenticated chain equation drift: %s", (drift) => {
    // Break caught: trusting signed rows without predecessor/run/Ranking/time traversal equations.
    const fixture = harness({ commandId: "command:equation-primary" });
    const start = fixture.frontier.publishStart(fixture.publication);
    const child = fixture.frontier.appendRevision({ revision: successor(start.root) });
    const otherCandidate = publicationFixture({
      commandId: "command:equation-other",
      firstTarget: "3",
    });
    const other = fixture.frontier.publishStart(otherCandidate.publication);
    let runId = start.root.runId;
    let rankingSnapshotId = start.ranking.id;
    let predecessorRevisionId = child.id;
    let markers: readonly CityLiveMarker[] = [
      marker("maribor", 1),
      marker("ljubljana", 2),
    ];
    let createdAt = new Date(Date.parse(child.createdAt) + 60_000).toISOString();
    if (drift === "decreasing_time") {
      markers = [...child.markers, marker("maribor", 2)];
      createdAt = "2026-08-19T00:00:00.000Z";
    } else if (drift === "prefix_plus_two_markers") {
      markers = [
        ...child.markers,
        marker("maribor", 2),
        marker("celje", 3),
      ];
    } else if (drift === "expected_head_mismatch") {
      markers = [...child.markers, marker("maribor", 2)];
    } else if (drift === "cross_run_edge") {
      runId = other.root.runId;
      rankingSnapshotId = other.ranking.id;
      predecessorRevisionId = child.id;
      markers = [marker("maribor")];
    } else if (drift === "cross_ranking_edge") {
      rankingSnapshotId = other.ranking.id;
      markers = [...child.markers, marker("maribor", 2)];
    }
    let revision = sealCityFrontierRevision({
      runId,
      predecessorRevisionId,
      rankingSnapshotId,
      markers,
      projection: {
        kind: "working",
        nextUncheckedRank: markers.length + 1,
        selectableCityIds: markers.map(({ cityId }) => cityId),
        phase: "verification_required",
      },
      operation: {
        kind: "city_completed",
        commandId: `command:equation-${drift}`,
        expectedHeadRevisionId: predecessorRevisionId,
        cityId: markers.at(-1)?.cityId ?? "missing",
        cityCheckRunId: `city-check:equation-${drift}`,
      },
      createdAt,
    }, DECISION_INTEGRITY);
    if (drift === "expected_head_mismatch") {
      const { id, ...payload } = revision;
      void id;
      const changedPayload = {
        ...payload,
        operation: {
          ...payload.operation,
          expectedHeadRevisionId: start.root.id,
        },
      };
      revision = {
        id: `city-frontier-revision:${DECISION_INTEGRITY.hash(
          DECISION_INTEGRITY.canonical(changedPayload),
        )}`,
        ...changedPayload,
      } as CityFrontierRevision;
    }
    fixture.database.pragma("foreign_keys = OFF");
    insertFrontierRow(fixture.database, revision, revision.operation);

    for (const load of [
      () => fixture.frontier.loadRevisionVerified(revision.id),
      () => fixture.frontier.loadHeadVerified(runId),
      () => fixture.frontier.loadChainVerified(runId),
      () => fixture.frontier.findCommandVerified(runId, revision.operation.commandId),
    ]) expectErrorMessage(load, "integrity_mismatch");
  });

  test("makes a terminal final and rejects every later successor", () => {
    // Break caught: relying only on one terminal index while still allowing a child edge.
    const fixture = harness();
    const start = fixture.frontier.publishStart(fixture.publication);
    const terminal = successor(start.root, marker(), "command:terminal", "terminal");
    fixture.frontier.appendRevision({ revision: terminal });

    expect(() => fixture.frontier.appendRevision({
      revision: successor(terminal, marker("maribor", 2), "command:after-terminal"),
    })).toThrow("integrity_mismatch");
    expect(rowCount(fixture.database, "city_frontier_revisions")).toBe(2);
  });

  test("rejects a working tenth marker with zero tenth-row insert", () => {
    // Break caught: an off-by-one working frontier surviving at the live-candidate limit.
    const fixture = harness();
    let head = fixture.frontier.publishStart(fixture.publication).root;
    for (let rank = 1; rank <= 9; rank += 1) {
      const next = successor(
        head,
        marker(`city-${rank}`, rank),
        `command:city-${rank}`,
      );
      head = fixture.frontier.appendRevision({ revision: next });
    }
    const tenth = successor(head, marker("city-10", 10), "command:city-10");

    expect(() => fixture.frontier.appendRevision({ revision: tenth }))
      .toThrow("integrity_mismatch");
    expect(rowCount(fixture.database, "city_frontier_revisions")).toBe(10);
  });

  test("poisons every full-chain loader when a non-returned ancestor is corrupt", () => {
    // Break caught: validating only the requested/head/command row instead of the complete chain.
    const fixture = harness();
    const start = fixture.frontier.publishStart(fixture.publication);
    const child = fixture.frontier.appendRevision({ revision: successor(start.root) });
    dropImmutability(fixture.database, "city_frontier_revisions");
    fixture.database.prepare(`
      UPDATE city_frontier_revisions SET hmac = ? WHERE id = ?
    `).run("0".repeat(64), start.root.id);

    const loaders = [
      () => fixture.frontier.loadRevisionVerified(child.id),
      () => fixture.frontier.loadHeadVerified(start.root.runId),
      () => fixture.frontier.loadChainVerified(start.root.runId),
      () => fixture.frontier.findCommandVerified(
        start.root.runId,
        child.operation.commandId,
      ),
    ];
    for (const load of loaders) expect(load).toThrow("integrity_mismatch");
  });

  test("rejects an authentic requested root when a later descendant is corrupt", () => {
    // Break caught: early-returning the requested root before visiting the full loaded row set.
    const fixture = harness();
    const start = fixture.frontier.publishStart(fixture.publication);
    const child = fixture.frontier.appendRevision({
      revision: successor(start.root, marker(), "command:terminal-corrupt", "terminal"),
    });
    dropImmutability(fixture.database, "city_frontier_revisions");
    fixture.database.prepare(`
      UPDATE city_frontier_revisions SET command_hash = ? WHERE id = ?
    `).run("0".repeat(64), child.id);

    expect(() => fixture.frontier.loadRevisionVerified(start.root.id))
      .toThrow("integrity_mismatch");
  });

  test("derives the canonical chain when a successor was inserted physically before its root", () => {
    // Break caught: rowid/query order becoming chain authority.
    const fixture = harness();
    insertAuthenticPublicationRows(fixture.database, fixture.publication);
    const child = successor(fixture.publication.root);
    fixture.database.pragma("foreign_keys = OFF");
    fixture.database.exec("DROP TRIGGER city_frontier_revisions_no_delete");
    fixture.database.prepare("DELETE FROM city_frontier_revisions WHERE id = ?")
      .run(fixture.publication.root.id);
    insertFrontierRow(fixture.database, child, child.operation);
    insertFrontierRow(
      fixture.database,
      fixture.publication.root,
      fixture.publication.intent,
    );

    expect(fixture.frontier.loadChainVerified(fixture.publication.root.runId))
      .toEqual([fixture.publication.root, child]);
  });

  test("rejects an authenticated acyclic row disconnected from the valid root", () => {
    // Break caught: walking only root-to-head while ignoring an additional signed row for the run.
    const fixture = harness();
    fixture.frontier.publishStart(fixture.publication);
    const missingPredecessor = "city-frontier-revision:missing-parent";
    const disconnected = sealCityFrontierRevision({
      runId: fixture.publication.root.runId,
      predecessorRevisionId: missingPredecessor,
      rankingSnapshotId: fixture.publication.ranking.id,
      markers: [marker("disconnected")],
      projection: {
        kind: "working",
        nextUncheckedRank: 2,
        selectableCityIds: ["disconnected"],
        phase: "verification_required",
      },
      operation: {
        kind: "city_completed",
        commandId: "command:disconnected",
        expectedHeadRevisionId: missingPredecessor,
        cityId: "disconnected",
        cityCheckRunId: "city-check:disconnected",
      },
      createdAt: "2026-08-21T12:01:00.000Z",
    }, DECISION_INTEGRITY);
    fixture.database.pragma("foreign_keys = OFF");
    insertFrontierRow(fixture.database, disconnected, disconnected.operation);

    for (const load of [
      () => fixture.frontier.loadRevisionVerified(fixture.publication.root.id),
      () => fixture.frontier.loadHeadVerified(fixture.publication.root.runId),
      () => fixture.frontier.loadChainVerified(fixture.publication.root.runId),
      () => fixture.frontier.findCommandVerified(
        fixture.publication.root.runId,
        fixture.publication.root.operation.commandId,
      ),
    ]) expectErrorMessage(load, "integrity_mismatch");
  });

  test("rejects an authenticated cycle in a separately loaded row set", () => {
    // Break caught: a no-root cyclic component being treated as an absent command/head.
    const fixture = harness();
    fixture.frontier.publishStart(fixture.publication);
    const cycleHashes = {
      "command:cycle-a": "a".repeat(64),
      "command:cycle-b": "b".repeat(64),
    } as const;
    const integrity: EvidenceIntegrity = {
      canonical: INTEGRITY.canonical,
      hash(value) {
        for (const [commandId, digest] of Object.entries(cycleHashes)) {
          if (value.includes(`\"commandId\":\"${commandId}\"`)) return digest;
        }
        return INTEGRITY.hash(value);
      },
      sign: INTEGRITY.sign,
    };
    const decisionIntegrity = createCityDecisionIntegrityView(integrity);
    const cycleAId = `city-frontier-revision:${cycleHashes["command:cycle-a"]}`;
    const cycleBId = `city-frontier-revision:${cycleHashes["command:cycle-b"]}`;
    const cycleRevision = (
      commandId: keyof typeof cycleHashes,
      predecessorRevisionId: string,
      cityId: string,
    ) => sealCityFrontierRevision({
      runId: fixture.publication.root.runId,
      predecessorRevisionId,
      rankingSnapshotId: fixture.publication.ranking.id,
      markers: [marker(cityId)],
      projection: {
        kind: "working",
        nextUncheckedRank: 2,
        selectableCityIds: [cityId],
        phase: "verification_required",
      },
      operation: {
        kind: "city_completed",
        commandId,
        expectedHeadRevisionId: predecessorRevisionId,
        cityId,
        cityCheckRunId: `city-check:${cityId}`,
      },
      createdAt: "2026-08-21T12:01:00.000Z",
    }, decisionIntegrity);
    const cycleA = cycleRevision("command:cycle-a", cycleBId, "cycle-a");
    const cycleB = cycleRevision("command:cycle-b", cycleAId, "cycle-b");
    expect(cycleA.id).toBe(cycleAId);
    expect(cycleB.id).toBe(cycleBId);
    fixture.database.pragma("foreign_keys = OFF");
    fixture.database.exec("DROP TRIGGER city_frontier_revisions_no_delete");
    fixture.database.prepare("DELETE FROM city_frontier_revisions WHERE id = ?")
      .run(fixture.publication.root.id);
    insertFrontierRow(fixture.database, cycleA, cycleA.operation, integrity);
    insertFrontierRow(fixture.database, cycleB, cycleB.operation, integrity);
    const criteria = new SqliteCityCriteriaStore(fixture.database, integrity);
    const branches = new SqliteCityBranchStore(
      fixture.database,
      integrity,
      countryPort(fixture.locator),
    );
    const frontier = new SqliteCityFrontierStore(fixture.database, integrity, {
      criteria,
      branches,
      catalogs: catalogPort(fixture.catalogBundle),
    });

    for (const load of [
      () => frontier.loadRevisionVerified(cycleA.id),
      () => frontier.loadHeadVerified(fixture.publication.root.runId),
      () => frontier.loadChainVerified(fixture.publication.root.runId),
      () => frontier.findCommandVerified(
        fixture.publication.root.runId,
        cycleA.operation.commandId,
      ),
    ]) expectErrorMessage(load, "integrity_mismatch");
  });

  test("rejects a locally authentic Criteria-to-Ranking-to-root graph with stale run intent", () => {
    // Break caught: checking each content ID independently without replaying Criterial hash/run identity.
    const fixture = harness();
    fixture.frontier.publishStart(fixture.publication);
    const changedCriteria = criteriaSnapshot(criteriaDrafts("3"), START_AT);
    const { id: rankingId, ...rankingPayload } = fixture.publication.ranking;
    void rankingId;
    const changedRanking = sealCityRankingSnapshot({
      ...structuredClone(rankingPayload),
      criteriaSnapshotId: changedCriteria.id,
    }, DECISION_INTEGRITY);
    const changedRoot = sealCityFrontierRevision({
      runId: fixture.publication.root.runId,
      rankingSnapshotId: changedRanking.id,
      markers: [],
      projection: workingProjection(
        fixture.publication.root as WorkingCityFrontierRevision,
      ),
      operation: structuredClone(fixture.publication.root.operation),
      createdAt: fixture.publication.root.createdAt,
    }, DECISION_INTEGRITY);
    const changedPublication: CityFrontierStartPublication = {
      ...fixture.publication,
      criteria: changedCriteria,
      ranking: changedRanking,
      root: changedRoot,
    };
    fixture.database.pragma("foreign_keys = OFF");
    for (const table of [
      "city_frontier_revisions",
      "city_ranking_snapshots",
      "city_branch_commits",
      "city_criteria_snapshots",
    ]) fixture.database.exec(`DROP TRIGGER ${table}_no_delete`);
    fixture.database.exec(`
      DELETE FROM city_frontier_revisions;
      DELETE FROM city_ranking_snapshots;
      DELETE FROM city_branch_commits;
      DELETE FROM city_criteria_snapshots;
    `);
    insertAuthenticPublicationRows(fixture.database, changedPublication);

    for (const load of [
      () => fixture.frontier.loadRevisionVerified(changedRoot.id),
      () => fixture.frontier.loadHeadVerified(changedRoot.runId),
      () => fixture.frontier.loadChainVerified(changedRoot.runId),
      () => fixture.frontier.findCommandVerified(
        changedRoot.runId,
        changedRoot.operation.commandId,
      ),
    ]) expectErrorMessage(load, "integrity_mismatch");
  });

  test("rejects a locally authentic root whose Start hash drifts from stored Criteria", () => {
    // Break caught: replay comparing root and command to each other but not to Criteria authority.
    const fixture = harness();
    const start = fixture.frontier.publishStart(fixture.publication);
    const operation = start.root.operation;
    if (operation.kind !== "start") throw new Error("invalid_fixture");
    const root = sealCityFrontierRevision({
      runId: start.root.runId,
      rankingSnapshotId: start.root.rankingSnapshotId,
      markers: [],
      projection: workingProjection(start.root as WorkingCityFrontierRevision),
      operation: { ...operation, criteriaPayloadHash: "f".repeat(64) },
      createdAt: start.root.createdAt,
    }, DECISION_INTEGRITY);
    const command = {
      ...fixture.publication.intent,
      criteriaPayloadHash: "f".repeat(64),
    };
    const payloadJson = INTEGRITY.canonical(root);
    const commandJson = INTEGRITY.canonical(command);
    dropImmutability(fixture.database, "city_frontier_revisions");
    fixture.database.prepare(`
      UPDATE city_frontier_revisions
      SET id = ?, command_json = ?, command_hash = ?, payload_json = ?,
          payload_hash = ?, hmac = ?
      WHERE id = ?
    `).run(
      root.id,
      commandJson,
      INTEGRITY.hash(commandJson),
      payloadJson,
      INTEGRITY.hash(payloadJson),
      INTEGRITY.sign(INTEGRITY.canonical({ value: root, command })),
      start.root.id,
    );

    const errors = [
      () => fixture.frontier.loadRevisionVerified(root.id),
      () => fixture.frontier.loadHeadVerified(root.runId),
      () => fixture.frontier.loadChainVerified(root.runId),
      () => fixture.frontier.findCommandVerified(root.runId, operation.commandId),
    ].map((load) => {
      try {
        load();
      } catch (error) {
        return error;
      }
      return undefined;
    });
    for (const error of errors) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe("integrity_mismatch");
    }
    expect(new Set(errors).size).toBe(errors.length);
  });
});

describe("City frontier SQLite process races", () => {
  test("concurrently publishes different runs with one byte-identical shared parent row", async () => {
    // Break caught: deterministic parent insertion becoming a global conflict across valid Starts.
    const path = temporaryDatabasePath();
    const fixture = harness({ commandId: "command:race-first" }, path);
    const second = publicationFixture({
      commandId: "command:race-second",
      firstTarget: "3",
    });
    const gate = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * 2);
    const workers = [fixture.publication, second.publication].map((publication) =>
      trackWorker(cityFrontierPublicationWorker<CityFrontierStartPublicationResult>({
        databasePath: path,
        integrityKey: INTEGRITY_KEY,
        gate,
        catalogBundle: fixture.catalogBundle,
        countryLocator: fixture.locator,
        action: { kind: "publishStart", publication },
      })));

    await Promise.all(workers.map(({ ready }) => ready));
    await releaseWorkersTogether(gate, workers.length);
    const results = await Promise.all(workers.map(({ result }) => result));

    expect(results[0].root.runId).not.toBe(results[1].root.runId);
    expect(results[0].preCityBranch).toEqual(results[1].preCityBranch);
    expect(INTEGRITY.canonical(results[0].preCityBranch))
      .toBe(INTEGRITY.canonical(results[1].preCityBranch));
    expect(rowCount(fixture.database, "city_branch_commits")).toBe(1);
    expect(rowCount(fixture.database, "city_criteria_snapshots")).toBe(2);
    expect(rowCount(fixture.database, "city_ranking_snapshots")).toBe(2);
    expect(rowCount(fixture.database, "city_frontier_revisions")).toBe(2);
  });

  test("concurrent same-command Starts converge on one stored time-bound winner", async () => {
    // Break caught: loser-created timestamps/artifacts escaping command-first transaction replay.
    const path = temporaryDatabasePath();
    const fixture = harness({}, path);
    const later = publicationFixture({
      commandId: fixture.publication.root.operation.commandId,
      startAt: "2026-08-22T12:00:00.000Z",
    });
    const gate = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * 2);
    const workers = [fixture.publication, later.publication].map((publication) =>
      trackWorker(cityFrontierPublicationWorker<CityFrontierStartPublicationResult>({
        databasePath: path,
        integrityKey: INTEGRITY_KEY,
        gate,
        catalogBundle: fixture.catalogBundle,
        countryLocator: fixture.locator,
        action: { kind: "publishStart", publication },
      })));

    await Promise.all(workers.map(({ ready }) => ready));
    await releaseWorkersTogether(gate, workers.length);
    const results = await Promise.all(workers.map(({ result }) => result));

    expect(results[1]).toEqual(results[0]);
    const exactCandidates = [fixture.publication, later.publication].map((publication) =>
      INTEGRITY.canonical({
        criteria: publication.criteria,
        preCityBranch: publication.preCityBranch,
        ranking: publication.ranking,
        root: publication.root,
      }));
    expect(exactCandidates).toContain(INTEGRITY.canonical(results[0]));
    expect([
      results[0].criteria.confirmedAt,
      results[0].ranking.assessmentAt,
      results[0].ranking.createdAt,
      results[0].root.createdAt,
    ]).toEqual(Array(4).fill(results[0].root.createdAt));
    expect(results[0].preCityBranch.createdAt).toBe(PARENT_AT);
    expect(rowCount(fixture.database, "city_criteria_snapshots")).toBe(1);
    expect(rowCount(fixture.database, "city_branch_commits")).toBe(1);
    expect(rowCount(fixture.database, "city_ranking_snapshots")).toBe(1);
    expect(rowCount(fixture.database, "city_frontier_revisions")).toBe(1);
  });

  test("racing different successors yields one stale loser and identical retries converge", async () => {
    // Break caught: constraint text leaking from a head race or duplicate command retries diverging.
    const path = temporaryDatabasePath();
    const fixture = harness({}, path);
    const start = fixture.frontier.publishStart(fixture.publication);
    const candidates = [
      successor(start.root, marker("ljubljana"), "command:race-ljubljana"),
      successor(start.root, marker("maribor"), "command:race-maribor"),
    ];
    const raceGate = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * 2);
    const raceWorkers = candidates.map((revision) =>
      trackWorker(cityFrontierPublicationWorker<CityFrontierRevision>({
        databasePath: path,
        integrityKey: INTEGRITY_KEY,
        gate: raceGate,
        catalogBundle: fixture.catalogBundle,
        countryLocator: fixture.locator,
        action: { kind: "appendRevision", revision },
      })));
    await Promise.all(raceWorkers.map(({ ready }) => ready));
    await releaseWorkersTogether(raceGate, raceWorkers.length);
    const settled = await Promise.allSettled(raceWorkers.map(({ result }) => result));
    const winners = settled.filter((item): item is PromiseFulfilledResult<CityFrontierRevision> =>
      item.status === "fulfilled");
    const losers = settled.filter((item): item is PromiseRejectedResult =>
      item.status === "rejected");

    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    expect((losers[0].reason as Error).message).toBe("stale_city_frontier_head");
    expect(rowCount(fixture.database, "city_frontier_revisions")).toBe(2);

    const retryGate = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * 2);
    const retryWorkers = [0, 1].map(() =>
      trackWorker(cityFrontierPublicationWorker<CityFrontierRevision>({
        databasePath: path,
        integrityKey: INTEGRITY_KEY,
        gate: retryGate,
        catalogBundle: fixture.catalogBundle,
        countryLocator: fixture.locator,
        action: { kind: "appendRevision", revision: winners[0].value },
      })));
    await Promise.all(retryWorkers.map(({ ready }) => ready));
    await releaseWorkersTogether(retryGate, retryWorkers.length);
    const retries = await Promise.all(retryWorkers.map(({ result }) => result));
    expect(retries[1]).toEqual(retries[0]);
    expect(retries[1]).not.toBe(retries[0]);
    expect(rowCount(fixture.database, "city_frontier_revisions")).toBe(2);
  });
});

describe("City Catalog structural replay and write policy", () => {
  test("compares a global Start intent before applying candidate legacy policy", () => {
    // Break caught: candidate @1 upgrade hiding a different intent under an @2 winner command.
    const fixture = harness();
    fixture.frontier.publishStart(fixture.publication);
    const legacy = publicationFixture({
      catalogRulesVersion: "city-catalog@1",
      commandId: fixture.publication.root.operation.commandId,
    });
    const catalogs: CityCatalogStorePort = {
      appendVerified() {
        throw new Error("unexpected_catalog_append");
      },
      loadVerified(id) {
        if (id === legacy.catalogBundle.catalog.id) {
          return structuredClone(legacy.catalogBundle);
        }
        return catalogPort(fixture.catalogBundle).loadVerified(id);
      },
    };
    const frontier = new SqliteCityFrontierStore(
      fixture.database,
      INTEGRITY,
      { criteria: fixture.criteria, branches: fixture.branches, catalogs },
    );

    expectErrorMessage(
      () => frontier.publishStart(legacy.publication),
      "integrity_mismatch",
    );
    expect(rowCount(fixture.database, "city_criteria_snapshots")).toBe(1);
    expect(rowCount(fixture.database, "city_branch_commits")).toBe(1);
    expect(rowCount(fixture.database, "city_ranking_snapshots")).toBe(1);
    expect(rowCount(fixture.database, "city_frontier_revisions")).toBe(1);
  });

  test("fully verifies an exact legacy Start winner before applying upgrade policy", () => {
    // Break caught: candidate @1 upgrade returning before a corrupt stored command winner is loaded.
    const fixture = harness({ catalogRulesVersion: "city-catalog@1" });
    insertAuthenticPublicationRows(fixture.database, fixture.publication);
    dropImmutability(fixture.database, "city_frontier_revisions");
    fixture.database.prepare(`
      UPDATE city_frontier_revisions SET hmac = ? WHERE id = ?
    `).run("0".repeat(64), fixture.publication.root.id);

    expectErrorMessage(
      () => fixture.frontier.publishStart(structuredClone(fixture.publication)),
      "integrity_mismatch",
    );
    expect(rowCount(fixture.database, "city_criteria_snapshots")).toBe(1);
    expect(rowCount(fixture.database, "city_branch_commits")).toBe(1);
    expect(rowCount(fixture.database, "city_ranking_snapshots")).toBe(1);
    expect(rowCount(fixture.database, "city_frontier_revisions")).toBe(1);
  });

  test("gates append command replay from the verified stored chain Catalog", () => {
    // Break caught: an alternate @2 caller Ranking authorizing replay of a stored @1 command.
    const fixture = harness({ catalogRulesVersion: "city-catalog@1" });
    insertAuthenticPublicationRows(fixture.database, fixture.publication);
    const winner = successor(fixture.publication.root);
    insertFrontierRow(fixture.database, winner, winner.operation);
    const current = publicationFixture({ catalogRulesVersion: "city-catalog@2" });
    fixture.database.pragma("foreign_keys = OFF");
    insertRankingRow(fixture.database, current.publication.ranking);
    const candidate = sealCityFrontierRevision({
      runId: winner.runId,
      predecessorRevisionId: winner.predecessorRevisionId,
      rankingSnapshotId: current.publication.ranking.id,
      markers: winner.markers,
      projection: workingProjection(winner as WorkingCityFrontierRevision),
      operation: winner.operation,
      createdAt: winner.createdAt,
    }, DECISION_INTEGRITY);
    const catalogs: CityCatalogStorePort = {
      appendVerified() {
        throw new Error("unexpected_catalog_append");
      },
      loadVerified(id) {
        if (id === current.catalogBundle.catalog.id) {
          return structuredClone(current.catalogBundle);
        }
        return catalogPort(fixture.catalogBundle).loadVerified(id);
      },
    };
    const frontier = new SqliteCityFrontierStore(
      fixture.database,
      INTEGRITY,
      { criteria: fixture.criteria, branches: fixture.branches, catalogs },
    );

    expectErrorMessage(
      () => frontier.appendRevision({ revision: candidate }),
      "city_catalog_upgrade_required",
    );
    expect(rowCount(fixture.database, "city_ranking_snapshots")).toBe(2);
    expect(rowCount(fixture.database, "city_frontier_revisions")).toBe(2);
  });

  test("loads authentic @1 history but blocks publish, append and exact replay writes", () => {
    // Break caught: structural historical support being confused with current write authority.
    const fixture = harness({ catalogRulesVersion: "city-catalog@1" });
    expectErrorMessage(
      () => fixture.frontier.publishStart(fixture.publication),
      "city_catalog_upgrade_required",
    );
    for (const table of [
      "city_criteria_snapshots",
      "city_branch_commits",
      "city_ranking_snapshots",
      "city_frontier_revisions",
    ]) expect(rowCount(fixture.database, table), table).toBe(0);

    insertAuthenticPublicationRows(fixture.database, fixture.publication);
    expect(fixture.frontier.loadRevisionVerified(fixture.publication.root.id))
      .toEqual(fixture.publication.root);
    expect(fixture.frontier.loadChainVerified(fixture.publication.root.runId))
      .toEqual([fixture.publication.root]);
    expectErrorMessage(
      () => fixture.frontier.publishStart(structuredClone(fixture.publication)),
      "city_catalog_upgrade_required",
    );
    for (const table of [
      "city_criteria_snapshots",
      "city_branch_commits",
      "city_ranking_snapshots",
      "city_frontier_revisions",
    ]) expect(rowCount(fixture.database, table), table).toBe(1);
    const successorCandidate = successor(fixture.publication.root);
    expectErrorMessage(
      () => fixture.frontier.appendRevision({ revision: successorCandidate }),
      "city_catalog_upgrade_required",
    );
    expect(rowCount(fixture.database, "city_frontier_revisions")).toBe(1);

    insertFrontierRow(
      fixture.database,
      successorCandidate,
      successorCandidate.operation,
    );
    const operationDrift = successor(
      fixture.publication.root,
      marker("maribor"),
      successorCandidate.operation.commandId,
    );
    expectErrorMessage(
      () => fixture.frontier.appendRevision({ revision: operationDrift }),
      "integrity_mismatch",
    );
    expectErrorMessage(
      () => fixture.frontier.appendRevision({
        revision: structuredClone(successorCandidate),
      }),
      "city_catalog_upgrade_required",
    );
    expect(rowCount(fixture.database, "city_frontier_revisions")).toBe(2);
  });

  test("accepts current @2 writes and treats an unknown Catalog rule as integrity drift", () => {
    // Break caught: accepting open Catalog rule strings or applying the upgrade label to corruption.
    const current = harness();
    expect(current.frontier.publishStart(current.publication).root)
      .toEqual(current.publication.root);

    const fixture = harness();
    const unknownBundle = structuredClone(fixture.catalogBundle) as unknown as {
      readonly registry: VerifiedCityCatalogBundle["registry"];
      readonly catalog: Record<string, unknown>;
    };
    unknownBundle.catalog.rulesVersion = "city-catalog@999";
    const catalogs = {
      appendVerified() {
        throw new Error("unexpected_catalog_append");
      },
      loadVerified() {
        return structuredClone(unknownBundle) as unknown as VerifiedCityCatalogBundle;
      },
    } satisfies CityCatalogStorePort;
    const frontier = new SqliteCityFrontierStore(
      fixture.database,
      INTEGRITY,
      { criteria: fixture.criteria, branches: fixture.branches, catalogs },
    );
    expectErrorMessage(
      () => frontier.publishStart(fixture.publication),
      "integrity_mismatch",
    );
    expect(rowCount(fixture.database, "city_criteria_snapshots")).toBe(0);
    expect(rowCount(fixture.database, "city_branch_commits")).toBe(0);
    expect(rowCount(fixture.database, "city_ranking_snapshots")).toBe(0);
    expect(rowCount(fixture.database, "city_frontier_revisions")).toBe(0);
  });
});

describe("City persistence envelope, mirror and source replay boundaries", () => {
  test("stores the exact canonical payload/hash/HMAC preimage for all four artifacts", () => {
    // Break caught: a self-consistent private adapter envelope replacing the normative byte formulas.
    const fixture = harness();
    const start = fixture.frontier.publishStart(fixture.publication);
    for (const [table, id, value] of [
      ["city_criteria_snapshots", start.criteria.id, start.criteria],
      ["city_branch_commits", start.preCityBranch.id, start.preCityBranch],
      ["city_ranking_snapshots", start.ranking.id, start.ranking],
    ] as const) {
      const row = fixture.database.prepare(`
        SELECT payload_json, payload_hash, hmac FROM ${table} WHERE id = ?
      `).get(id) as {
        readonly payload_json: string;
        readonly payload_hash: string;
        readonly hmac: string;
      };
      const payloadJson = INTEGRITY.canonical(value);
      expect(row).toEqual({
        payload_json: payloadJson,
        payload_hash: INTEGRITY.hash(payloadJson),
        hmac: INTEGRITY.sign(payloadJson),
      });
    }
    const frontierRow = fixture.database.prepare(`
      SELECT payload_json, payload_hash, command_json, command_hash, hmac
      FROM city_frontier_revisions WHERE id = ?
    `).get(start.root.id) as {
      readonly payload_json: string;
      readonly payload_hash: string;
      readonly command_json: string;
      readonly command_hash: string;
      readonly hmac: string;
    };
    const payloadJson = INTEGRITY.canonical(start.root);
    const commandJson = INTEGRITY.canonical(fixture.publication.intent);
    expect(frontierRow).toEqual({
      payload_json: payloadJson,
      payload_hash: INTEGRITY.hash(payloadJson),
      command_json: commandJson,
      command_hash: INTEGRITY.hash(commandJson),
      hmac: INTEGRITY.sign(INTEGRITY.canonical({
        value: start.root,
        command: fixture.publication.intent,
      })),
    });
  });

  test("rejects authenticated semantically equal but noncanonical payload and command bytes", () => {
    // Break caught: parsing before requiring exact C(value) byte equality.
    {
      const fixture = harness();
      const start = fixture.frontier.publishStart(fixture.publication);
      dropImmutability(fixture.database, "city_criteria_snapshots");
      const noncanonical = JSON.stringify(start.criteria, null, 2);
      fixture.database.prepare(`
        UPDATE city_criteria_snapshots
        SET payload_json = ?, payload_hash = ?, hmac = ? WHERE id = ?
      `).run(
        noncanonical,
        INTEGRITY.hash(noncanonical),
        INTEGRITY.sign(noncanonical),
        start.criteria.id,
      );
      expectErrorMessage(
        () => fixture.criteria.loadCriteriaVerified(start.criteria.id),
        "integrity_mismatch",
      );
    }
    {
      const fixture = harness();
      const start = fixture.frontier.publishStart(fixture.publication);
      dropImmutability(fixture.database, "city_frontier_revisions");
      const noncanonical = JSON.stringify(fixture.publication.intent, null, 2);
      fixture.database.prepare(`
        UPDATE city_frontier_revisions
        SET command_json = ?, command_hash = ?, hmac = ? WHERE id = ?
      `).run(
        noncanonical,
        INTEGRITY.hash(noncanonical),
        INTEGRITY.sign(INTEGRITY.canonical({
          value: start.root,
          command: fixture.publication.intent,
        })),
        start.root.id,
      );
      expectErrorMessage(
        () => fixture.frontier.loadRevisionVerified(start.root.id),
        "integrity_mismatch",
      );
    }
  });

  test.each([
    "city_branch_commits",
    "city_ranking_snapshots",
    "city_frontier_revisions",
  ] as const)("rejects a valid artifact row with a bad HMAC in %s", (table) => {
    // Break caught: assuming FK/content IDs make private row authentication redundant.
    const fixture = harness();
    const start = fixture.frontier.publishStart(fixture.publication);
    dropImmutability(fixture.database, table);
    const id = table === "city_branch_commits"
      ? start.preCityBranch.id
      : table === "city_ranking_snapshots" ? start.ranking.id : start.root.id;
    fixture.database.prepare(`UPDATE ${table} SET hmac = ? WHERE id = ?`)
      .run("0".repeat(64), id);
    const load = table === "city_branch_commits"
      ? () => fixture.branches.loadPreCityBranchVerified(id)
      : table === "city_ranking_snapshots"
        ? () => fixture.frontier.loadRankingVerified(id)
        : () => fixture.frontier.loadRevisionVerified(id);
    expectErrorMessage(load, "integrity_mismatch");
  });

  test.each([
    ["criteria profile mirror", "city_criteria_snapshots", "profile_snapshot_id", "profile:other"],
    ["branch country mirror", "city_branch_commits", "country_code", "AT"],
    ["Ranking installed context mirror", "city_ranking_snapshots", "installed_package_context_json", "{}"],
    ["Frontier Ranking mirror", "city_frontier_revisions", "ranking_snapshot_id", "city-ranking:other"],
  ] as const)("rejects %s drift outside the signed payload", (_label, table, column, value) => {
    // Break caught: returning a signed payload without checking its relational/derived mirrors.
    const fixture = harness();
    const start = fixture.frontier.publishStart(fixture.publication);
    dropImmutability(fixture.database, table);
    fixture.database.pragma("foreign_keys = OFF");
    const id = table === "city_criteria_snapshots"
      ? start.criteria.id
      : table === "city_branch_commits"
        ? start.preCityBranch.id
        : table === "city_ranking_snapshots" ? start.ranking.id : start.root.id;
    fixture.database.prepare(`UPDATE ${table} SET ${column} = ? WHERE id = ?`)
      .run(value, id);
    const load = table === "city_criteria_snapshots"
      ? () => fixture.criteria.loadCriteriaVerified(id)
      : table === "city_branch_commits"
        ? () => fixture.branches.loadPreCityBranchVerified(id)
        : table === "city_ranking_snapshots"
          ? () => fixture.frontier.loadRankingVerified(id)
          : () => fixture.frontier.loadRevisionVerified(id);
    expectErrorMessage(load, "integrity_mismatch");
  });

  test.each([
    "city_branch_commits",
    "city_ranking_snapshots",
    "city_frontier_revisions",
  ] as const)("rejects a detached content ID in %s", (table) => {
    // Break caught: accepting a signed value under a caller-selected row identity.
    const fixture = harness();
    const start = fixture.frontier.publishStart(fixture.publication);
    dropImmutability(fixture.database, table);
    fixture.database.pragma("foreign_keys = OFF");
    const oldId = table === "city_branch_commits"
      ? start.preCityBranch.id
      : table === "city_ranking_snapshots" ? start.ranking.id : start.root.id;
    const prefix = table === "city_branch_commits"
      ? "pre-city-branch"
      : table === "city_ranking_snapshots" ? "city-ranking" : "city-frontier-revision";
    const detachedId = `${prefix}:${"e".repeat(64)}`;
    fixture.database.prepare(`UPDATE ${table} SET id = ? WHERE id = ?`)
      .run(detachedId, oldId);
    const load = table === "city_branch_commits"
      ? () => fixture.branches.loadPreCityBranchVerified(detachedId)
      : table === "city_ranking_snapshots"
        ? () => fixture.frontier.loadRankingVerified(detachedId)
        : () => fixture.frontier.loadRevisionVerified(detachedId);
    expectErrorMessage(load, "integrity_mismatch");
  });

  test("rejects representative HMAC, source-payload, mirror, content-ID and command drift", () => {
    // Break caught: returning a row after checking only one layer of its private envelope.
    {
      const fixture = harness();
      const start = fixture.frontier.publishStart(fixture.publication);
      dropImmutability(fixture.database, "city_criteria_snapshots");
      fixture.database.prepare(`UPDATE city_criteria_snapshots SET hmac = ? WHERE id = ?`)
        .run("0".repeat(64), start.criteria.id);
      expect(() => fixture.criteria.loadCriteriaVerified(start.criteria.id))
        .toThrow("integrity_mismatch");
    }
    {
      const fixture = harness();
      const start = fixture.frontier.publishStart(fixture.publication);
      dropImmutability(fixture.database, "city_branch_commits");
      const changed = { ...start.preCityBranch, extra: true };
      const payload = INTEGRITY.canonical(changed);
      fixture.database.prepare(`
        UPDATE city_branch_commits SET payload_json = ?, payload_hash = ?, hmac = ? WHERE id = ?
      `).run(payload, INTEGRITY.hash(payload), INTEGRITY.sign(payload), start.preCityBranch.id);
      expect(() => fixture.branches.loadPreCityBranchVerified(start.preCityBranch.id))
        .toThrow("integrity_mismatch");
    }
    {
      const fixture = harness();
      const start = fixture.frontier.publishStart(fixture.publication);
      dropImmutability(fixture.database, "city_ranking_snapshots");
      fixture.database.pragma("foreign_keys = OFF");
      fixture.database.prepare(`
        UPDATE city_ranking_snapshots SET registry_revision_id = 'city-registry:other'
        WHERE id = ?
      `).run(start.ranking.id);
      expect(() => fixture.frontier.loadRankingVerified(start.ranking.id))
        .toThrow("integrity_mismatch");
    }
    {
      const fixture = harness();
      const start = fixture.frontier.publishStart(fixture.publication);
      dropImmutability(fixture.database, "city_criteria_snapshots");
      fixture.database.pragma("foreign_keys = OFF");
      const detachedId = `city-criteria:${"e".repeat(64)}`;
      fixture.database.prepare(`UPDATE city_criteria_snapshots SET id = ? WHERE id = ?`)
        .run(detachedId, start.criteria.id);
      expect(() => fixture.criteria.loadCriteriaVerified(detachedId))
        .toThrow("integrity_mismatch");
    }
    {
      const fixture = harness();
      const start = fixture.frontier.publishStart(fixture.publication);
      dropImmutability(fixture.database, "city_frontier_revisions");
      const command = {
        schemaVersion: "city-frontier-start-intent@1",
        runId: start.root.runId,
        resolvedCountryShortlistRevisionId:
          fixture.publication.intent.resolvedCountryShortlistRevisionId,
        countryCode: fixture.publication.intent.countryCode,
        criteriaPayloadHash: "f".repeat(64),
      };
      const commandJson = INTEGRITY.canonical(command);
      const payloadJson = fixture.database.prepare(`
        SELECT payload_json FROM city_frontier_revisions WHERE id = ?
      `).get(start.root.id) as { readonly payload_json: string };
      const hmac = INTEGRITY.sign(INTEGRITY.canonical({
        value: JSON.parse(payloadJson.payload_json) as unknown,
        command,
      }));
      fixture.database.prepare(`
        UPDATE city_frontier_revisions
        SET command_json = ?, command_hash = ?, hmac = ? WHERE id = ?
      `).run(commandJson, INTEGRITY.hash(commandJson), hmac, start.root.id);
      expect(() => fixture.frontier.loadRevisionVerified(start.root.id))
        .toThrow("integrity_mismatch");
    }
  });

  test("loads an authentic alternate order structurally, then fails installed semantics", () => {
    // Break caught: persistence importing evaluator/Knowledge authority instead of structural replay.
    const fixture = harness();
    const start = fixture.frontier.publishStart(fixture.publication);
    dropImmutability(fixture.database, "city_ranking_snapshots");
    fixture.database.pragma("foreign_keys = OFF");
    const { id: _id, ...payload } = start.ranking;
    void _id;
    const changed = sealCityRankingSnapshot({
      ...structuredClone(payload),
      ordered: [
        { ...structuredClone(start.ranking.ordered[1]), rank: 1 },
        { ...structuredClone(start.ranking.ordered[0]), rank: 2 },
      ],
    }, DECISION_INTEGRITY);
    const payloadJson = INTEGRITY.canonical(changed);
    fixture.database.prepare(`
      UPDATE city_ranking_snapshots
      SET id = ?, payload_json = ?, payload_hash = ?, hmac = ? WHERE id = ?
    `).run(
      changed.id,
      payloadJson,
      INTEGRITY.hash(payloadJson),
      INTEGRITY.sign(payloadJson),
      start.ranking.id,
    );

    expect(reconstructCityRankingSnapshot(changed, DECISION_INTEGRITY)).toEqual(changed);
    expect(fixture.frontier.loadRankingVerified(changed.id)).toEqual(changed);
    expectErrorMessage(
      () => verifyCityRankingSnapshotSemantics(changed, {
        registry: fixture.catalogBundle.registry,
        catalog: fixture.catalogBundle.catalog,
        criteria: start.criteria,
        knowledge: [],
        evaluators: installedEvaluators(),
      }, DECISION_INTEGRITY),
      "integrity_mismatch",
    );
  });

  test("rejects hostile pre-city source descriptors before issuing SQL", () => {
    // Break caught: reading a nested key/getter before complete source ownership.
    const fixture = harness();
    let prepares = 0;
    let accessorReads = 0;
    const databaseProxy = new Proxy(fixture.database, {
      get(target, key, receiver) {
        if (key === "prepare") {
          return (...arguments_: Parameters<Database.Database["prepare"]>) => {
            prepares += 1;
            return Reflect.apply(target.prepare, target, arguments_);
          };
        }
        const value = Reflect.get(target, key, receiver) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const branch = new SqliteCityBranchStore(
      databaseProxy,
      INTEGRITY,
      countryPort(fixture.locator),
    );
    const hostile = structuredClone(fixture.publication.preCitySource);
    Object.defineProperty(hostile.resolvedCountryEntry, "countryCode", {
      enumerable: true,
      get() {
        accessorReads += 1;
        return "AT";
      },
    });

    expect(() => branch.findPreCityBranchBySourceVerified(hostile))
      .toThrow("integrity_mismatch");
    expect(accessorReads).toBe(0);
    expect(prepares).toBe(0);
  });

  test("rejects a non-deterministic commit occupying the exact pre-city source", () => {
    // Break caught: source replay authenticating bindings but not the resolved-head timestamp.
    const fixture = harness();
    const resolvedHead = fixture.locator.revisions.at(-1) as
      ResolvedCountryShortlistSnapshot;
    const early = createPreCityBranchCommit({
      source: fixture.publication.preCitySource,
      createdAt: new Date(Date.parse(resolvedHead.createdAt) - 1).toISOString(),
    }, DECISION_INTEGRITY);
    const payload = INTEGRITY.canonical(early);
    fixture.database.prepare(`
      INSERT INTO city_branch_commits (
        id, kind, profile_snapshot_id, preference_profile_snapshot_id,
        resolved_country_shortlist_revision_id, country_code,
        resolved_country_entry_digest, city_id, parent_id, forked_from,
        selection_snapshot_id, schema_version, payload_json, payload_hash, hmac, created_at
      ) VALUES (?, 'pre_city', ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, ?, ?, ?, ?, ?)
    `).run(
      early.id,
      early.profileSnapshotId,
      early.preferenceProfileSnapshotId,
      early.resolvedCountryShortlistRevisionId,
      early.countryCode,
      early.resolvedCountryEntryDigest,
      early.schemaVersion,
      payload,
      INTEGRITY.hash(payload),
      INTEGRITY.sign(payload),
      early.createdAt,
    );
    const loadError = (() => {
      try {
        fixture.branches.loadPreCityBranchVerified(early.id);
      } catch (error) {
        return error;
      }
      return undefined;
    })();
    const findError = (() => {
      try {
        fixture.branches.findPreCityBranchBySourceVerified(
          fixture.publication.preCitySource,
        );
      } catch (error) {
        return error;
      }
      return undefined;
    })();
    expect(loadError).toBeInstanceOf(Error);
    expect(findError).toBeInstanceOf(Error);
    expect((loadError as Error).message).toBe("integrity_mismatch");
    expect((findError as Error).message).toBe("integrity_mismatch");
    expect(findError).not.toBe(loadError);

    expectErrorMessage(
      () => fixture.frontier.publishStart(fixture.publication),
      "integrity_mismatch",
    );
    expect(rowCount(fixture.database, "city_branch_commits")).toBe(1);
    expect(rowCount(fixture.database, "city_criteria_snapshots")).toBe(0);
    expect(rowCount(fixture.database, "city_ranking_snapshots")).toBe(0);
    expect(rowCount(fixture.database, "city_frontier_revisions")).toBe(0);
  });

  test.each([
    "requested_revision_not_head",
    "multiple_country_entries",
    "derived_source_mismatch",
  ] as const)("rejects stored pre-city replay when %s", (drift) => {
    // Break caught: trusting stored source mirrors without replay through the verified resolution head.
    const fixture = harness();
    const start = fixture.frontier.publishStart(fixture.publication);
    let locator = structuredClone(fixture.locator);
    const head = locator.revisions.at(-1) as ResolvedCountryShortlistSnapshot;
    if (drift === "requested_revision_not_head") {
      locator = {
        ...locator,
        revisions: [
          ...locator.revisions,
          { ...structuredClone(head), id: "country-resolution:later-head" },
        ],
      };
    } else if (drift === "multiple_country_entries") {
      locator = {
        ...locator,
        revisions: [{
          ...structuredClone(head),
          resolvedEntries: [
            ...head.resolvedEntries,
            {
              ...structuredClone(head.resolvedEntries[0]),
              rank: 2,
              formalMarkerDigest: "e".repeat(64),
            },
          ],
        }],
      };
    } else {
      locator = {
        ...locator,
        source: { ...locator.source, profileSnapshotId: "profile:other" },
      };
    }
    const countries = {
      locateChainVerified() {
        return structuredClone(locator);
      },
    } as unknown as CountryResolutionStorePort;
    const branch = new SqliteCityBranchStore(
      fixture.database,
      INTEGRITY,
      countries,
    );

    expectErrorMessage(
      () => branch.loadPreCityBranchVerified(start.preCityBranch.id),
      "integrity_mismatch",
    );
  });

  test.each([
    "derived_mirror",
    "deterministic_candidate",
  ] as const)("find-by-source rejects a corrupt exact-key %s row", (drift) => {
    // Break caught: treating an occupied authoritative source key as absence or trusted lookup.
    const fixture = harness();
    const start = fixture.frontier.publishStart(fixture.publication);
    dropImmutability(fixture.database, "city_branch_commits");
    fixture.database.pragma("foreign_keys = OFF");
    if (drift === "derived_mirror") {
      fixture.database.prepare(`
        UPDATE city_branch_commits SET resolved_country_entry_digest = ? WHERE id = ?
      `).run("e".repeat(64), start.preCityBranch.id);
    } else {
      fixture.database.prepare(`
        UPDATE city_branch_commits SET id = ? WHERE id = ?
      `).run(`pre-city-branch:${"e".repeat(64)}`, start.preCityBranch.id);
    }

    expectErrorMessage(
      () => fixture.branches.findPreCityBranchBySourceVerified(
        fixture.publication.preCitySource,
      ),
      "integrity_mismatch",
    );
  });

  test("find-by-source queries only revision/country, then rejects caller source drift", () => {
    // Break caught: widening the SQL key with profile fields and returning false absence.
    const fixture = harness();
    fixture.frontier.publishStart(fixture.publication);
    const changedSource = {
      ...fixture.publication.preCitySource,
      profileSnapshotId: "profile:other",
    };

    expectErrorMessage(
      () => fixture.branches.findPreCityBranchBySourceVerified(changedSource),
      "integrity_mismatch",
    );
  });
});
