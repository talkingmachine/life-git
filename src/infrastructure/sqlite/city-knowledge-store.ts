import type Database from "better-sqlite3";

import type {
  CityEvidencePackageReplayPort,
  CityKnowledgeStorePort,
  CityPackageEvidenceReplayContract,
  VerifiedCityEvidence,
} from "../../application/city-data-contracts";
import {
  CITY_CATALOG_RULES_VERSION,
  reconstructVerifiedCityCatalog,
  type CityCatalogProjection,
} from "../../decision/city-catalog";
import {
  buildCityKnowledgeRevision,
  reconstructCityKnowledgeRevision,
  type CityKnowledgeEvidenceView,
  type CityKnowledgeFactContractTuple,
  type CityKnowledgeRevision,
} from "../../research/city-knowledge";
import {
  reconstructCityFixedSourcePlan,
  SLOVENIA_CITY_FACT_SOURCE_IDS,
  SLOVENIA_CITY_SAFETY_FACT_CONTRACT,
  type CityFixedSourcePlan,
} from "../../research/city-evidence";
import {
  reconstructCitySafetySourcePlan,
  reconstructOfficialAuthorityDirectory,
  type CitySafetySourcePlan,
} from "../../research/city-safety-source-plan";
import type { InstalledCityPackageExactKey } from "../../research/city-package";
import { SLOVENIA_CITY_FACT_VERSIONS } from "../../research/slovenia-city-plan";
import type { EvidenceIntegrity } from "../../research/research-plan";
import { createCityDecisionIntegrityView, secureHexEqual } from "../integrity";
import { SqliteCityEvidenceStore } from "./city-evidence-store";

interface KnowledgeRow {
  readonly id: string;
  readonly city_id: string;
  readonly country_code: string;
  readonly package_id: string;
  readonly package_schema_version: string;
  readonly rules_version: string;
  readonly predecessor_id: string | null;
  readonly evidence_snapshot_id: string;
  readonly last_checked_at: string;
  readonly knowledge_updated_at: string;
  readonly created_at: string;
  readonly payload_json: string;
  readonly payload_hash: string;
  readonly hmac: string;
}

interface VerifiedReplay {
  readonly key: InstalledCityPackageExactKey;
  readonly catalog: CityCatalogProjection;
  readonly selectedPlans: readonly [
    CityFixedSourcePlan<"si-city-long-term-rent">,
    CityFixedSourcePlan<"si-city-urban-transit">,
    CityFixedSourcePlan<"si-city-fixed-broadband">,
  ];
  readonly safetyPlan: CitySafetySourcePlan;
}

type IntegrityView = EvidenceIntegrity;

const CONTRACT_KEYS = [
  "installedPackageManifest", "definition", "catalogProjection", "fixedPlansByCityId",
  "safetySourcePlan", "officialAuthorityDirectory", "validateValue", "validateSourcePeriod",
] as const;
const FIXED_SOURCE_IDS = SLOVENIA_CITY_FACT_SOURCE_IDS.slice(1) as unknown as readonly [
  "si-city-long-term-rent",
  "si-city-urban-transit",
  "si-city-fixed-broadband",
];
const REVISION_KEYS = [
  "schemaVersion", "id", "cityId", "countryCode", "packageId", "packageSchemaVersion",
  "rulesVersion", "evidenceSnapshotId", "facts", "lastCheckedAt", "knowledgeUpdatedAt", "createdAt",
] as const;

function mismatch(): never {
  throw new Error("integrity_mismatch");
}

function capability(value: unknown, key: "canonical" | "hash" | "sign"): (...args: never[]) => unknown {
  if (value === null || typeof value !== "object") mismatch();
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (descriptor === undefined || !("value" in descriptor) || typeof descriptor.value !== "function") {
    mismatch();
  }
  return descriptor.value as (...args: never[]) => unknown;
}

function integrityView(value: EvidenceIntegrity): IntegrityView {
  return Object.freeze({
    canonical: capability(value, "canonical") as unknown as EvidenceIntegrity["canonical"],
    hash: capability(value, "hash") as unknown as EvidenceIntegrity["hash"],
    sign: capability(value, "sign") as unknown as EvidenceIntegrity["sign"],
  });
}

function packageReplayView(value: CityEvidencePackageReplayPort): CityEvidencePackageReplayPort {
  if (value === null || typeof value !== "object") mismatch();
  const descriptor = Object.getOwnPropertyDescriptor(value, "loadExactReplayContract");
  if (descriptor === undefined || !("value" in descriptor) ||
    typeof descriptor.value !== "function") mismatch();
  const load = descriptor.value as CityEvidencePackageReplayPort["loadExactReplayContract"];
  const view: CityEvidencePackageReplayPort = Object.freeze({
    loadExactReplayContract(key: InstalledCityPackageExactKey) {
      return load.call(view, key);
    },
  });
  return view;
}

function plainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function exactKeys(value: object, expected: readonly string[]): boolean {
  if (Object.getOwnPropertySymbols(value).length !== 0) return false;
  const actual = Object.getOwnPropertyNames(value).sort();
  const wanted = [...expected].sort();
  return sameStrings(actual, wanted) && expected.every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor !== undefined && "value" in descriptor && descriptor.enumerable;
  });
}

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!plainRecord(value) || !exactKeys(value, keys)) mismatch();
  return value;
}

function dataValue(record: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) mismatch();
  return descriptor.value;
}

function denseArray(value: unknown): value is readonly unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype ||
    Object.getOwnPropertySymbols(value).length !== 0 ||
    Object.getOwnPropertyNames(value).length !== value.length + 1) return false;
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) return false;
  }
  return true;
}

function ownSnapshot<T>(borrowed: T): T {
  const active = new Set<object>();
  const visit = (value: unknown): unknown => {
    if (value === null || value === undefined || typeof value === "string" ||
      typeof value === "number" || typeof value === "boolean" || typeof value === "function") {
      return value;
    }
    if (typeof value !== "object" || active.has(value) ||
      Object.getOwnPropertySymbols(value).length !== 0) mismatch();
    active.add(value);
    try {
      if (Array.isArray(value)) {
        if (!denseArray(value)) mismatch();
        return value.map(visit);
      }
      if (!plainRecord(value)) mismatch();
      const copy = Object.create(null) as Record<string, unknown>;
      for (const key of Object.getOwnPropertyNames(value)) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) mismatch();
        copy[key] = visit(descriptor.value);
      }
      return copy;
    } finally {
      active.delete(value);
    }
  };
  return visit(borrowed) as T;
}

function frozenSnapshot<T>(borrowed: T): T {
  const owned = ownSnapshot(borrowed);
  const freeze = (value: unknown): void => {
    if (value === null || typeof value !== "object" || Object.isFrozen(value)) return;
    for (const key of Object.getOwnPropertyNames(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !("value" in descriptor)) mismatch();
      freeze(descriptor.value);
    }
    Object.freeze(value);
  };
  freeze(owned);
  return owned;
}

function identifier(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/.test(value)) mismatch();
  return value;
}

function countryCode(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Z]{2}$/.test(value)) mismatch();
  return value;
}

function instant(value: unknown): string {
  if (typeof value !== "string") mismatch();
  try {
    if (new Date(value).toISOString() !== value) mismatch();
  } catch {
    mismatch();
  }
  return value;
}

function exactKey(snapshot: VerifiedCityEvidence["snapshot"]): InstalledCityPackageExactKey {
  return {
    countryCode: snapshot.countryCode,
    packageId: snapshot.packageId,
    packageSchemaVersion: snapshot.packageSchemaVersion,
    catalogRevisionId: snapshot.catalogRevisionId,
    evidenceRulesVersion: snapshot.evidenceRulesVersion,
  };
}

function sameCanonical(left: unknown, right: unknown, integrity: EvidenceIntegrity): boolean {
  try {
    return integrity.canonical(left) === integrity.canonical(right);
  } catch {
    return false;
  }
}

function replaySemantics(contract: CityPackageEvidenceReplayContract): object {
  const replay = exactRecord(contract, CONTRACT_KEYS);
  return {
    installedPackageManifest: dataValue(replay, "installedPackageManifest"),
    definition: dataValue(replay, "definition"),
    catalogProjection: dataValue(replay, "catalogProjection"),
    fixedPlansByCityId: dataValue(replay, "fixedPlansByCityId"),
    safetySourcePlan: dataValue(replay, "safetySourcePlan"),
    officialAuthorityDirectory: dataValue(replay, "officialAuthorityDirectory"),
  };
}

function sameReplaySemantics(
  left: CityPackageEvidenceReplayContract,
  right: CityPackageEvidenceReplayContract,
  integrity: EvidenceIntegrity,
): boolean {
  return sameCanonical(replaySemantics(left), replaySemantics(right), integrity) &&
    dataValue(left, "validateValue") === dataValue(right, "validateValue") &&
    dataValue(left, "validateSourcePeriod") === dataValue(right, "validateSourcePeriod");
}

function verifyReplay(
  borrowed: CityPackageEvidenceReplayContract | undefined,
  evidence: VerifiedCityEvidence,
  integrity: EvidenceIntegrity,
): VerifiedReplay {
  try {
    if (borrowed === undefined || !plainRecord(borrowed) || !exactKeys(borrowed, CONTRACT_KEYS)) mismatch();
    const manifest = dataValue(borrowed, "installedPackageManifest");
    const definitionValue = dataValue(borrowed, "definition");
    const catalogValue = dataValue(borrowed, "catalogProjection");
    const plansValue = dataValue(borrowed, "fixedPlansByCityId");
    const safetyValue = dataValue(borrowed, "safetySourcePlan");
    const directoryValue = dataValue(borrowed, "officialAuthorityDirectory");
    const valueValidator = dataValue(borrowed, "validateValue");
    const periodValidator = dataValue(borrowed, "validateSourcePeriod");
    if (!plainRecord(manifest) || !exactKeys(manifest, ["id", "key"]) ||
      !Object.isFrozen(manifest) || !Object.isFrozen(manifest.key) ||
      !plainRecord(manifest.key) || !exactKeys(manifest.key, [
        "countryCode", "packageId", "packageSchemaVersion", "catalogRevisionId", "evidenceRulesVersion",
      ]) || typeof valueValidator !== "function" || typeof periodValidator !== "function") mismatch();

    // Establish complete local ownership before canonical/hash/reconstructor callbacks can re-enter.
    const ownedManifest = ownSnapshot(manifest);
    const ownedDefinition = ownSnapshot(definitionValue);
    const ownedCatalog = ownSnapshot(catalogValue);
    const plansByCity = ownSnapshot(plansValue);
    const ownedSafety = ownSnapshot(safetyValue);
    const ownedDirectory = ownSnapshot(directoryValue);
    const key = exactKey(evidence.snapshot);
    if (!plainRecord(ownedManifest) || !identifier(ownedManifest.id) ||
      !plainRecord(ownedManifest.key) || !sameCanonical(ownedManifest.key, key, integrity)) mismatch();
    const definition = exactRecord(ownedDefinition, [
      "packageId", "packageSchemaVersion", "countryCode", "evidenceRulesVersion", "sourceIds",
    ]);
    if (definition.packageId !== key.packageId ||
      definition.packageSchemaVersion !== key.packageSchemaVersion ||
      definition.countryCode !== key.countryCode ||
      definition.evidenceRulesVersion !== key.evidenceRulesVersion ||
      !denseArray(definition.sourceIds) ||
      !sameStrings(definition.sourceIds as readonly string[], SLOVENIA_CITY_FACT_SOURCE_IDS)) mismatch();
    const decisionIntegrity = createCityDecisionIntegrityView(integrity);
    const catalog = reconstructVerifiedCityCatalog(
      ownedCatalog as CityCatalogProjection,
      decisionIntegrity,
    );
    if (catalog.catalog.rulesVersion !== CITY_CATALOG_RULES_VERSION ||
      catalog.registry.evidenceSnapshotId !== catalog.catalog.evidenceSnapshotId ||
      catalog.catalog.id !== key.catalogRevisionId || catalog.catalog.countryCode !== key.countryCode ||
      catalog.registry.countryCode !== key.countryCode || catalog.catalog.packageId !== key.packageId ||
      catalog.registry.packageId !== key.packageId ||
      catalog.catalog.packageSchemaVersion !== key.packageSchemaVersion ||
      catalog.registry.packageSchemaVersion !== key.packageSchemaVersion) mismatch();
    const memberIds = catalog.catalog.members.map(({ cityId }) => cityId).sort();
    if (!plainRecord(plansByCity) || !sameStrings(Object.keys(plansByCity).sort(), memberIds) ||
      !memberIds.includes(evidence.snapshot.cityId)) mismatch();
    let selectedPlans: VerifiedReplay["selectedPlans"] | undefined;
    for (const cityId of memberIds) {
      const tuple = plansByCity[cityId];
      if (!denseArray(tuple) || tuple.length !== FIXED_SOURCE_IDS.length) mismatch();
      const plans = [
        reconstructCityFixedSourcePlan(tuple[0], FIXED_SOURCE_IDS[0]),
        reconstructCityFixedSourcePlan(tuple[1], FIXED_SOURCE_IDS[1]),
        reconstructCityFixedSourcePlan(tuple[2], FIXED_SOURCE_IDS[2]),
      ] as const;
      for (let index = 0; index < plans.length; index += 1) {
        const plan = plans[index];
        const sourceId = FIXED_SOURCE_IDS[index];
        const criterionId = sourceId === "si-city-long-term-rent"
          ? "long_term_rent"
          : sourceId === "si-city-urban-transit" ? "urban_transit" : "fixed_broadband";
        if (plan.cityId !== cityId || plan.sourceId !== sourceId || plan.criterionId !== criterionId ||
          plan.definitionId !== evidence.snapshot.definitionIds[criterionId] ||
          plan.claimContract.definitionId !== evidence.snapshot.definitionIds[criterionId] ||
          plan.parserVersion !== SLOVENIA_CITY_FACT_VERSIONS[sourceId].parserVersion ||
          plan.rulesVersion !== SLOVENIA_CITY_FACT_VERSIONS[sourceId].rulesVersion) mismatch();
      }
      if (cityId === evidence.snapshot.cityId) selectedPlans = plans;
    }
    if (selectedPlans === undefined) mismatch();
    const directory = reconstructOfficialAuthorityDirectory(
      ownedDirectory,
      catalog.catalog,
      decisionIntegrity,
    );
    const safetyPlan = reconstructCitySafetySourcePlan(
      ownedSafety,
      catalog.catalog,
      directory,
      decisionIntegrity,
    );
    if (safetyPlan.definitionId !== evidence.snapshot.definitionIds.safety ||
      safetyPlan.discoveryRulesVersion !== SLOVENIA_CITY_FACT_VERSIONS["si-city-safety"].rulesVersion ||
      !safetyPlan.entries.some(({ cityId }) => cityId === evidence.snapshot.cityId)) mismatch();
    return { key, catalog, selectedPlans, safetyPlan };
  } catch {
    mismatch();
  }
}

function contracts(
  replay: VerifiedReplay,
  cityId: string,
): CityKnowledgeFactContractTuple {
  const safetyEntry = replay.safetyPlan.entries.find((entry) => entry.cityId === cityId);
  if (safetyEntry === undefined) mismatch();
  const safety = {
    sourceId: SLOVENIA_CITY_SAFETY_FACT_CONTRACT.sourceId,
    criterionId: SLOVENIA_CITY_SAFETY_FACT_CONTRACT.criterionId,
    definitionId: replay.safetyPlan.definitionId,
    scope: `municipality:${safetyEntry.municipalityCode}`,
    geoScope: SLOVENIA_CITY_SAFETY_FACT_CONTRACT.geoScope,
    officialAreaId: safetyEntry.municipalityCode,
    unit: SLOVENIA_CITY_SAFETY_FACT_CONTRACT.unit,
    denominator: SLOVENIA_CITY_SAFETY_FACT_CONTRACT.denominator,
    freshnessPolicyVersion: replay.safetyPlan.freshnessPolicyVersion,
  } as const;
  const fixed = replay.selectedPlans.map((plan) => ({
    sourceId: plan.claimContract.sourceId,
    criterionId: plan.claimContract.criterionId,
    definitionId: plan.claimContract.definitionId,
    scope: plan.claimContract.scope,
    geoScope: plan.claimContract.geoScope,
    officialAreaId: plan.claimContract.officialAreaId,
    unit: plan.claimContract.unit,
    denominator: plan.claimContract.denominator,
    freshnessPolicyVersion: plan.claimContract.freshnessPolicyVersion,
  }));
  return [safety, fixed[0]!, fixed[1]!, fixed[2]!] as CityKnowledgeFactContractTuple;
}

function evidenceView(evidence: VerifiedCityEvidence): CityKnowledgeEvidenceView {
  return evidence as unknown as CityKnowledgeEvidenceView;
}

function revisionPayload(revision: CityKnowledgeRevision): Omit<CityKnowledgeRevision, "id"> {
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

function rawRevision(row: KnowledgeRow, integrity: EvidenceIntegrity): CityKnowledgeRevision {
  if (!secureHexEqual(row.payload_hash, integrity.hash(row.payload_json)) ||
    !secureHexEqual(row.hmac, integrity.sign(row.payload_json))) mismatch();
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.payload_json) as unknown;
  } catch {
    mismatch();
  }
  const hasPredecessor = plainRecord(parsed) && Object.hasOwn(parsed, "predecessorRevisionId");
  const revision = exactRecord(parsed, hasPredecessor ? [...REVISION_KEYS, "predecessorRevisionId"] : REVISION_KEYS);
  const facts = revision.facts;
  if (revision.schemaVersion !== "city-knowledge@1" || !identifier(revision.id) ||
    !identifier(revision.cityId) || countryCode(revision.countryCode) !== row.country_code ||
    !identifier(revision.packageId) || !identifier(revision.packageSchemaVersion) ||
    !identifier(revision.rulesVersion) || !identifier(revision.evidenceSnapshotId) ||
    !denseArray(facts) || facts.length !== 4 ||
    (hasPredecessor && !identifier(revision.predecessorRevisionId)) ||
    !instant(revision.lastCheckedAt) || !instant(revision.knowledgeUpdatedAt) ||
    !instant(revision.createdAt)) mismatch();
  const typed = revision as unknown as CityKnowledgeRevision;
  const expectedId = `city-knowledge:${integrity.hash(integrity.canonical(revisionPayload(typed)))}`;
  if (integrity.canonical(typed) !== row.payload_json || typed.id !== expectedId ||
    row.id !== typed.id || row.city_id !== typed.cityId || row.country_code !== typed.countryCode ||
    row.package_id !== typed.packageId || row.package_schema_version !== typed.packageSchemaVersion ||
    row.rules_version !== typed.rulesVersion ||
    row.predecessor_id !== (typed.predecessorRevisionId ?? null) ||
    row.evidence_snapshot_id !== typed.evidenceSnapshotId ||
    row.last_checked_at !== typed.lastCheckedAt || row.knowledge_updated_at !== typed.knowledgeUpdatedAt ||
    row.created_at !== typed.createdAt) mismatch();
  return typed;
}

function constraint(error: unknown): boolean {
  return error !== null && typeof error === "object" && "code" in error &&
    typeof (error as { readonly code?: unknown }).code === "string" &&
    (error as { readonly code: string }).code.startsWith("SQLITE_CONSTRAINT");
}

function normalize(error: unknown): never {
  if (error instanceof Error && error.message === "city_knowledge_not_found") throw error;
  mismatch();
}

export class SqliteCityKnowledgeStore implements CityKnowledgeStorePort {
  private readonly integrity: IntegrityView;
  private readonly packageReplay: CityEvidencePackageReplayPort;

  constructor(
    private readonly database: Database.Database,
    integrity: EvidenceIntegrity,
    packageReplay: CityEvidencePackageReplayPort,
  ) {
    this.integrity = integrityView(integrity);
    this.packageReplay = packageReplayView(packageReplay);
  }

  publishFromEvidence(evidenceSnapshotId: string, createdAt: string): CityKnowledgeRevision {
    try {
      const ownedEvidenceId = identifier(evidenceSnapshotId);
      const ownedCreatedAt = instant(createdAt);
      const publish = this.database.transaction(() => {
        const { evidence, replay } = this.loadEvidenceAndReplay(ownedEvidenceId);
        const factContracts = contracts(replay, evidence.snapshot.cityId);
        const existingRows = this.rowsByEvidence(ownedEvidenceId);
        if (existingRows.length > 1) mismatch();
        if (existingRows.length === 1) {
          const existing = this.verifyRequested(existingRows[0]!.id, false);
          if (existing.createdAt !== ownedCreatedAt) mismatch();
          return existing;
        }
        const predecessor = this.latestVerified(evidence.snapshot.cityId);
        const revision = buildCityKnowledgeRevision({
          packageKey: replay.key,
          evidence: evidenceView(evidence),
          factContracts,
          createdAt: ownedCreatedAt,
          ...(predecessor === undefined ? {} : { predecessor }),
        }, createCityDecisionIntegrityView(this.integrity));
        const payload = this.integrity.canonical(revision);
        try {
          this.database.prepare(`
            INSERT INTO city_knowledge_revisions (
              id, city_id, country_code, package_id, package_schema_version, rules_version,
              predecessor_id, evidence_snapshot_id, last_checked_at, knowledge_updated_at,
              created_at, payload_json, payload_hash, hmac
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            revision.id,
            revision.cityId,
            revision.countryCode,
            revision.packageId,
            revision.packageSchemaVersion,
            revision.rulesVersion,
            revision.predecessorRevisionId ?? null,
            revision.evidenceSnapshotId,
            revision.lastCheckedAt,
            revision.knowledgeUpdatedAt,
            revision.createdAt,
            payload,
            this.integrity.hash(payload),
            this.integrity.sign(payload),
          );
        } catch (error) {
          if (!constraint(error)) throw error;
          const collided = this.rowsByEvidence(ownedEvidenceId);
          if (collided.length !== 1) mismatch();
          const existing = this.verifyRequested(collided[0]!.id, false);
          if (this.integrity.canonical(existing) !== payload || existing.createdAt !== ownedCreatedAt) mismatch();
          return existing;
        }
        return this.verifyRequested(revision.id, false);
      });
      return publish.immediate();
    } catch (error) {
      normalize(error);
    }
  }

  latestVerified(cityId: string): CityKnowledgeRevision | undefined {
    try {
      const ownedCityId = identifier(cityId);
      const rows = this.database.prepare(`
        SELECT candidate.id
        FROM city_knowledge_revisions AS candidate
        WHERE candidate.city_id = ?
          AND NOT EXISTS (
            SELECT 1 FROM city_knowledge_revisions AS successor
            WHERE successor.predecessor_id = candidate.id
          )
      `).all(ownedCityId) as Array<{ readonly id: string }>;
      const count = this.database.prepare(
        "SELECT COUNT(*) AS count FROM city_knowledge_revisions WHERE city_id = ?",
      ).get(ownedCityId) as { readonly count: number };
      if (rows.length === 0) {
        if (count.count !== 0) mismatch();
        return undefined;
      }
      if (rows.length !== 1) mismatch();
      return this.verifyRequested(rows[0]!.id, true, count.count);
    } catch (error) {
      normalize(error);
    }
  }

  loadVerified(id: string): CityKnowledgeRevision {
    try {
      return this.verifyRequested(identifier(id), false);
    } catch (error) {
      normalize(error);
    }
  }

  findByEvidenceVerified(evidenceSnapshotId: string): CityKnowledgeRevision | undefined {
    try {
      const rows = this.rowsByEvidence(identifier(evidenceSnapshotId));
      if (rows.length > 1) mismatch();
      return rows.length === 0 ? undefined : this.verifyRequested(rows[0]!.id, false);
    } catch (error) {
      normalize(error);
    }
  }

  private loadEvidenceAndReplay(evidenceSnapshotId: string): {
    readonly evidence: VerifiedCityEvidence;
    readonly replay: VerifiedReplay;
  } {
    const captured: Array<{
      readonly key: InstalledCityPackageExactKey;
      readonly replay: CityPackageEvidenceReplayContract;
    }> = [];
    const recordingReplay: CityEvidencePackageReplayPort = Object.freeze({
      loadExactReplayContract: (key: InstalledCityPackageExactKey) => {
        const ownedKey = frozenSnapshot(key);
        let borrowed: CityPackageEvidenceReplayContract | undefined;
        try {
          borrowed = this.packageReplay.loadExactReplayContract(ownedKey);
        } catch {
          mismatch();
        }
        if (borrowed === undefined) return undefined;
        const owned = frozenSnapshot(borrowed);
        captured.push({ key: ownedKey, replay: owned });
        return owned;
      },
    });
    const evidence = new SqliteCityEvidenceStore(
      this.database,
      this.integrity,
      recordingReplay,
    ).loadVerified(evidenceSnapshotId);
    if (captured.length === 0) mismatch();

    const key = frozenSnapshot(exactKey(evidence.snapshot));
    let borrowed: CityPackageEvidenceReplayContract | undefined;
    try {
      borrowed = this.packageReplay.loadExactReplayContract(key);
    } catch {
      mismatch();
    }
    if (borrowed === undefined) mismatch();
    const ownedSecond = frozenSnapshot(borrowed);
    const replay = verifyReplay(ownedSecond, evidence, this.integrity);
    const currentCaptures = captured.filter((consumed) => sameCanonical(
      consumed.key,
      key,
      this.integrity,
    ));
    if (currentCaptures.length === 0 || !currentCaptures.every((consumed) => sameReplaySemantics(
      consumed.replay,
      ownedSecond,
      this.integrity,
    ))) mismatch();
    return { evidence, replay };
  }

  private rowsByEvidence(evidenceSnapshotId: string): Array<{ readonly id: string }> {
    return this.database.prepare(`
      SELECT id FROM city_knowledge_revisions WHERE evidence_snapshot_id = ?
    `).all(evidenceSnapshotId) as Array<{ readonly id: string }>;
  }

  private row(id: string): KnowledgeRow | undefined {
    return this.database.prepare(`
      SELECT id, city_id, country_code, package_id, package_schema_version, rules_version,
             predecessor_id, evidence_snapshot_id, last_checked_at, knowledge_updated_at,
             created_at, payload_json, payload_hash, hmac
      FROM city_knowledge_revisions WHERE id = ?
    `).get(id) as KnowledgeRow | undefined;
  }

  private verifyRequested(
    id: string,
    requireFullCity: boolean,
    expectedCount?: number,
  ): CityKnowledgeRevision {
    const chain: Array<{ readonly row: KnowledgeRow; readonly raw: CityKnowledgeRevision }> = [];
    const seen = new Set<string>();
    let cursor: string | undefined = id;
    while (cursor !== undefined) {
      if (seen.has(cursor)) mismatch();
      seen.add(cursor);
      const row = this.row(cursor);
      if (row === undefined) {
        if (chain.length === 0) throw new Error("city_knowledge_not_found");
        mismatch();
      }
      const raw = rawRevision(row, this.integrity);
      if (chain.length > 0 && chain[chain.length - 1]!.raw.cityId !== raw.cityId) mismatch();
      chain.push({ row, raw });
      cursor = raw.predecessorRevisionId;
    }
    chain.reverse();
    if (chain[0]?.raw.predecessorRevisionId !== undefined ||
      (requireFullCity && chain.length !== expectedCount)) mismatch();
    let predecessor: CityKnowledgeRevision | undefined;
    for (const node of chain) {
      const { evidence, replay } = this.loadEvidenceAndReplay(node.raw.evidenceSnapshotId);
      const reconstructed = reconstructCityKnowledgeRevision({
        revision: node.raw,
        packageKey: replay.key,
        evidence: evidenceView(evidence),
        factContracts: contracts(replay, evidence.snapshot.cityId),
        ...(predecessor === undefined ? {} : { predecessor }),
      }, createCityDecisionIntegrityView(this.integrity));
      if (reconstructed.cityId !== chain[0]!.raw.cityId) mismatch();
      predecessor = reconstructed;
    }
    if (predecessor === undefined) mismatch();
    return predecessor;
  }
}
