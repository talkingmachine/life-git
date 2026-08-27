import { types } from "node:util";

import type Database from "better-sqlite3";

import type {
  InstalledCityPackageManifestAppendInput,
  InstalledCityPackageManifestStorePort,
} from "../../application/city-data-contracts";
import {
  CITY_CATALOG_RULES_VERSION,
  LEGACY_CITY_CATALOG_RULES_VERSION,
} from "../../decision/city-catalog";
import {
  resolveApprovedCityCriteriaDefaults,
  type ApprovedCityCriteriaDefaultsRegistry,
  type ApprovedCityCriteriaPackageDefinition,
} from "../../decision/approved-city-criteria-defaults";
import {
  CITY_CRITERION_IDS,
  reconstructInstalledCityCriteriaDefaults,
  reconstructInstalledCityCriterionDefinitions,
  type CityCriterionId,
} from "../../decision/city-criteria";
import {
  reconstructCityFixedSourcePlan,
  type CityFixedSourcePlan,
  type SloveniaCityFixedSourceId,
} from "../../research/city-evidence";
import {
  assertCityPackageReady,
  type InstalledCityPackageExactKey,
  type InstalledCityPackageManifest,
  type InstalledCityPackageManifestPayload,
} from "../../research/city-package";
import {
  reconstructInstalledPackageArtifactSetClaim,
  type InstalledCityPackageArtifactSlot,
  type InstalledCityPackageJsonArtifactBinding,
  type InstalledCityPackageJsonArtifactRole,
} from "../../research/city-package-artifact-set";
import {
  reconstructCitySafetySourcePlan,
  reconstructOfficialAuthorityDirectory,
} from "../../research/city-safety-source-plan";
import type { EvidenceIntegrity } from "../../research/research-plan";
import { secureHexEqual } from "../integrity";
import {
  resolveInstalledCityPackageBehaviorForDefinition,
  resolveInstalledCityPackageBehaviorForVersion,
  type InstalledCityPackageBehaviorRegistry,
  type InstalledCityPackageBehaviorRegistryEntry,
  type VerifiedInstalledCityPackageReadPort,
  type VerifiedInstalledCityPackageRecord,
} from "../sources/installed-city-packages";
import { SqliteCityCatalogStore } from "./city-catalog-store";
import { loadVerifiedAdministrativeEvidenceBundle } from "./evidence-store";

const FIXED_SOURCE_IDS = [
  "si-city-long-term-rent",
  "si-city-urban-transit",
  "si-city-fixed-broadband",
] as const satisfies readonly SloveniaCityFixedSourceId[];
const PAYLOAD_KEYS = [
  "schemaVersion", "key", "definition", "sourceContractStatus", "readiness", "catalogRoot",
  "fixedPlansByCityId", "safety", "criteria", "valueValidatorVersionId",
  "sourcePeriodValidatorVersionId", "predecessorManifestId", "installedAt",
] as const;
const KEY_FIELDS = [
  "countryCode", "packageId", "packageSchemaVersion", "catalogRevisionId",
  "evidenceRulesVersion",
] as const;
const MUTABLE_CONNECTION_PRAGMAS = [
  "query_only", "ignore_check_constraints", "recursive_triggers", "trusted_schema",
  "busy_timeout",
] as const;
const INTRINSIC_ERROR_PROTOTYPE = Error.prototype;

interface ManifestRow {
  readonly id: string;
  readonly country_code: string;
  readonly package_id: string;
  readonly package_schema_version: string;
  readonly catalog_revision_id: string;
  readonly evidence_rules_version: string;
  readonly predecessor_manifest_id: string | null;
  readonly administrative_evidence_snapshot_id: string;
  readonly installed_at: string;
  readonly payload_json: string;
  readonly payload_hash: string;
  readonly hmac: string;
}

interface DatabaseListRow {
  readonly seq: number;
  readonly name: string;
  readonly file: string;
}

type MutableConnectionPragmas = Readonly<Record<
  typeof MUTABLE_CONNECTION_PRAGMAS[number],
  number
>>;

interface ConnectionState {
  readonly databases: readonly DatabaseListRow[];
  readonly pragmas: MutableConnectionPragmas;
}

type IntegrityView = EvidenceIntegrity;

function mismatch(): never {
  throw new Error("integrity_mismatch");
}

function normalize(error: unknown): never {
  if (error === null || typeof error !== "object" || types.isProxy(error) ||
    Object.getPrototypeOf(error) !== INTRINSIC_ERROR_PROTOTYPE) mismatch();
  const message = Object.getOwnPropertyDescriptor(error, "message");
  if (message === undefined || !Object.hasOwn(message, "value") ||
    typeof message.value !== "string") {
    mismatch();
  }
  if (message.value === "city_package_behavior_unavailable") {
    throw new Error("city_package_behavior_unavailable");
  }
  if (message.value === "city_catalog_upgrade_required") {
    throw new Error("city_catalog_upgrade_required");
  }
  mismatch();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!isRecord(value) || Object.getOwnPropertySymbols(value).length !== 0) mismatch();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const actual = Object.keys(descriptors).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    mismatch();
  }
  for (const descriptor of Object.values(descriptors)) {
    if (!("value" in descriptor) || !descriptor.enumerable) mismatch();
  }
  return value;
}

function freeze<T>(value: T): T {
  if (ArrayBuffer.isView(value)) return value;
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

function snapshot<T>(borrowed: T): T {
  const active = new Set<object>();
  const visit = (value: unknown): unknown => {
    if (value === null || typeof value === "string" || typeof value === "boolean") return value;
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value !== "object" || types.isProxy(value) || active.has(value)) mismatch();
    if (value instanceof SharedArrayBuffer) mismatch();
    if (value instanceof Uint8Array) {
      const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype) as object;
      const byteLengthDescriptor = Object.getOwnPropertyDescriptor(
        typedArrayPrototype, "byteLength",
      );
      if (byteLengthDescriptor?.get === undefined) mismatch();
      const byteLength = Reflect.apply(byteLengthDescriptor.get, value, []) as number;
      const actualNames = Object.getOwnPropertyNames(value).sort();
      const expectedNames = Array.from(
        { length: byteLength }, (_unused, index) => String(index),
      ).sort();
      if (Object.getPrototypeOf(value) !== Uint8Array.prototype ||
        Object.getOwnPropertySymbols(value).length !== 0 ||
        actualNames.length !== expectedNames.length ||
        actualNames.some((name, index) => name !== expectedNames[index])) mismatch();
      for (const name of expectedNames) {
        const descriptor = Object.getOwnPropertyDescriptor(value, name);
        if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) mismatch();
      }
      const bufferDescriptor = Object.getOwnPropertyDescriptor(typedArrayPrototype, "buffer");
      if (bufferDescriptor?.get === undefined ||
        Reflect.apply(bufferDescriptor.get, value, []) instanceof SharedArrayBuffer) mismatch();
      return Reflect.apply(Uint8Array.prototype.slice, value, [0]) as Uint8Array;
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Object.getOwnPropertySymbols(value).length !== 0) mismatch();
    active.add(value);
    try {
      if (Array.isArray(value)) {
        const expectedNames = [
          ...Array.from({ length: value.length }, (_unused, index) => String(index)),
          "length",
        ].sort();
        const actualNames = Object.getOwnPropertyNames(value).sort();
        if (Object.getPrototypeOf(value) !== Array.prototype ||
          actualNames.length !== expectedNames.length ||
          actualNames.some((name, index) => name !== expectedNames[index])) mismatch();
        const copy: unknown[] = [];
        for (let index = 0; index < value.length; index += 1) {
          const descriptor = descriptors[String(index)];
          if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
            mismatch();
          }
          copy.push(visit(descriptor.value));
        }
        return copy;
      }
      if (!isRecord(value)) mismatch();
      const copy: Record<string, unknown> = {};
      for (const [key, descriptor] of Object.entries(descriptors)) {
        if (!("value" in descriptor) || !descriptor.enumerable || key === "__proto__" ||
          typeof descriptor.value === "function") mismatch();
        copy[key] = visit(descriptor.value);
      }
      return copy;
    } finally {
      active.delete(value);
    }
  };
  return freeze(visit(borrowed) as T);
}

function capability(value: object, key: keyof EvidenceIntegrity): (...args: never[]) => unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (descriptor === undefined || !("value" in descriptor) || typeof descriptor.value !== "function") {
    mismatch();
  }
  return descriptor.value as (...args: never[]) => unknown;
}

function integrityView(borrowed: EvidenceIntegrity): IntegrityView {
  if (borrowed === null || typeof borrowed !== "object" || types.isProxy(borrowed)) mismatch();
  const canonical = capability(borrowed, "canonical") as (value: unknown) => string;
  const hash = capability(borrowed, "hash") as (value: string) => string;
  const sign = capability(borrowed, "sign") as (value: string) => string;
  const view: IntegrityView = {
    canonical(value) {
      return Reflect.apply(canonical, view, [value]);
    },
    hash(value) {
      return Reflect.apply(hash, view, [value]);
    },
    sign(value) {
      return Reflect.apply(sign, view, [value]);
    },
  };
  return Object.freeze(view);
}

function identifier(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/.test(value)) mismatch();
  return value;
}

function country(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Z]{2}$/.test(value)) mismatch();
  return value;
}

function instant(value: unknown): string {
  try {
    if (typeof value !== "string" || new Date(value).toISOString() !== value) mismatch();
    return value;
  } catch {
    mismatch();
  }
}

function exactKey(value: unknown): InstalledCityPackageExactKey {
  const key = exact(value, KEY_FIELDS);
  return freeze({
    countryCode: country(key.countryCode),
    packageId: identifier(key.packageId),
    packageSchemaVersion: identifier(key.packageSchemaVersion),
    catalogRevisionId: identifier(key.catalogRevisionId),
    evidenceRulesVersion: identifier(key.evidenceRulesVersion),
  });
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && left.every((byte, index) => byte === right[index]);
}

function sameManifestRow(left: ManifestRow, right: ManifestRow): boolean {
  return left.id === right.id && left.country_code === right.country_code &&
    left.package_id === right.package_id &&
    left.package_schema_version === right.package_schema_version &&
    left.catalog_revision_id === right.catalog_revision_id &&
    left.evidence_rules_version === right.evidence_rules_version &&
    left.predecessor_manifest_id === right.predecessor_manifest_id &&
    left.administrative_evidence_snapshot_id === right.administrative_evidence_snapshot_id &&
    left.installed_at === right.installed_at && left.payload_json === right.payload_json &&
    left.payload_hash === right.payload_hash && left.hmac === right.hmac;
}

function ownBehaviors(borrowed: InstalledCityPackageBehaviorRegistry):
InstalledCityPackageBehaviorRegistry {
  const registry = exact(borrowed, ["schemaVersion", "entries"]);
  const borrowedEntries = registry.entries;
  const entryNames = Array.isArray(borrowedEntries)
    ? [...Array.from({ length: borrowedEntries.length }, (_unused, index) => String(index)), "length"]
      .sort()
    : [];
  if (registry.schemaVersion !== "installed-city-package-behavior-registry@1" ||
    !Array.isArray(borrowedEntries) || types.isProxy(borrowedEntries) ||
    Object.getOwnPropertySymbols(borrowedEntries).length !== 0 ||
    Object.getPrototypeOf(borrowedEntries) !== Array.prototype ||
    Object.getOwnPropertyNames(borrowedEntries).sort().some(
      (name, index) => name !== entryNames[index],
    ) || Object.getOwnPropertyNames(borrowedEntries).length !== entryNames.length) mismatch();
  const descriptors = Object.getOwnPropertyDescriptors(borrowedEntries);
  const definitions: ApprovedCityCriteriaPackageDefinition[] = [];
  for (let index = 0; index < borrowedEntries.length; index += 1) {
    const item = descriptors[String(index)];
    if (item === undefined || !("value" in item) || !item.enumerable) return mismatch();
    const entry = exact(item.value, [
      "approvedFor", "versionKey", "fixedPolicyVersionsBySourceId", "evaluatorRegistry",
      "validateValue", "validateSourcePeriod",
    ]);
    const approved = Object.getOwnPropertyDescriptor(entry, "approvedFor");
    if (approved === undefined || !("value" in approved)) return mismatch();
    definitions.push(snapshot(approved.value) as ApprovedCityCriteriaPackageDefinition);
  }
  const entries = definitions.map((definition) =>
    resolveInstalledCityPackageBehaviorForDefinition(definition, borrowed));
  return freeze({ schemaVersion: "installed-city-package-behavior-registry@1", entries });
}

function binding(
  value: unknown,
  expectedRole: InstalledCityPackageJsonArtifactRole,
): InstalledCityPackageJsonArtifactBinding<InstalledCityPackageJsonArtifactRole> {
  const item = exact(value, [
    "evidenceSnapshotId", "artifactId", "artifactOrdinal", "runId", "sourceId", "role",
    "mediaType", "sha256",
  ]);
  if (!Number.isSafeInteger(item.artifactOrdinal) || Object.is(item.artifactOrdinal, -0) ||
    (item.artifactOrdinal as number) < 0 || item.sourceId !== "city-package-installation" ||
    item.role !== expectedRole || item.mediaType !== "application/json" ||
    typeof item.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(item.sha256)) mismatch();
  identifier(item.evidenceSnapshotId);
  identifier(item.artifactId);
  identifier(item.runId);
  return freeze(item as unknown as InstalledCityPackageJsonArtifactBinding<
    InstalledCityPackageJsonArtifactRole
  >);
}

function manifestCopy(payload: InstalledCityPackageManifestPayload, row: ManifestRow):
InstalledCityPackageManifest {
  return freeze({
    ...snapshot(payload),
    id: row.id,
    payloadHash: row.payload_hash,
    hmac: row.hmac,
  });
}

export class SqliteCityPackageManifestStore implements
  InstalledCityPackageManifestStorePort,
  VerifiedInstalledCityPackageReadPort {
  private readonly integrity: IntegrityView;
  private readonly defaults: ApprovedCityCriteriaDefaultsRegistry;
  private readonly behaviors: InstalledCityPackageBehaviorRegistry;
  private readonly catalogs: SqliteCityCatalogStore;

  constructor(
    private readonly database: Database.Database,
    integrity: EvidenceIntegrity,
    approvedDefaults: ApprovedCityCriteriaDefaultsRegistry,
    behaviors: InstalledCityPackageBehaviorRegistry,
  ) {
    this.integrity = integrityView(integrity);
    this.defaults = snapshot(approvedDefaults);
    this.behaviors = ownBehaviors(behaviors);
    this.catalogs = new SqliteCityCatalogStore(database, this.integrity);
    this.database.pragma("busy_timeout = 5000");
  }

  appendPrepared(borrowed: InstalledCityPackageManifestAppendInput): InstalledCityPackageManifest {
    if (this.database.inTransaction) mismatch();
    const input = snapshot(borrowed);
    this.validateAppendInput(input);
    const connection = this.connectionState();
    try {
      const append = this.database.transaction(() => this.appendOwned(input));
      return append.immediate();
    } catch (error) {
      this.restoreConnectionState(connection);
      normalize(error);
    }
  }

  loadVerified(key: InstalledCityPackageExactKey): InstalledCityPackageManifest | undefined {
    return this.loadExactVerified(key)?.manifest;
  }

  latestVerified(countryCode: string): InstalledCityPackageManifest | undefined {
    return this.loadCurrentVerified(countryCode)?.manifest;
  }

  loadExactVerified(borrowedKey: InstalledCityPackageExactKey):
  VerifiedInstalledCityPackageRecord | undefined {
    const key = exactKey(snapshot(borrowedKey));
    const connection = this.connectionState();
    try {
      const read = this.database.transaction(() => {
        const beforeChanges = this.totalChanges();
        const beforeSchema = this.schemaState();
        const { rows, records } = this.withCallbackBarrier(() => ({
          rows: this.findExactRows(key),
          records: this.reconstructCountry(key.countryCode),
        }));
        if (this.totalChanges() !== beforeChanges || this.schemaState() !== beforeSchema) mismatch();
        if (rows.length === 0) return undefined;
        if (rows.length !== 1) mismatch();
        const matches = records.filter(({ manifest }) =>
          KEY_FIELDS.every((field) => manifest.key[field] === key[field]));
        if (matches.length !== 1 || matches[0]!.manifest.id !== rows[0]!.id) mismatch();
        return matches[0];
      });
      return read.immediate();
    } catch (error) {
      this.restoreConnectionState(connection);
      normalize(error);
    }
  }

  loadCurrentVerified(borrowedCountryCode: string):
  VerifiedInstalledCityPackageRecord | undefined {
    const countryCode = country(borrowedCountryCode);
    const connection = this.connectionState();
    try {
      const read = this.database.transaction(() => {
        const beforeChanges = this.totalChanges();
        const beforeSchema = this.schemaState();
        const records = this.withCallbackBarrier(() => this.reconstructCountry(countryCode));
        if (this.totalChanges() !== beforeChanges || this.schemaState() !== beforeSchema) mismatch();
        return records.length === 0 ? undefined : records[records.length - 1];
      });
      return read.immediate();
    } catch (error) {
      this.restoreConnectionState(connection);
      normalize(error);
    }
  }

  private appendOwned(input: InstalledCityPackageManifestAppendInput): InstalledCityPackageManifest {
    const initialChanges = this.totalChanges();
    const initialSchema = this.schemaState();
    const prepared = this.withCallbackBarrier(() => {
      const ready = assertCityPackageReady(input.ready);
      const definition = this.approvedDefinition(ready.definition);
      const catalog = this.catalogs.loadVerified(input.catalog.catalog.id);
      if (this.integrity.canonical(catalog) !== this.integrity.canonical(input.catalog) ||
        catalog.catalog.countryCode !== definition.countryCode ||
        catalog.catalog.packageId !== definition.packageId ||
        catalog.catalog.packageSchemaVersion !== definition.packageSchemaVersion) mismatch();
      if (catalog.catalog.rulesVersion === LEGACY_CITY_CATALOG_RULES_VERSION) {
        throw new Error("city_catalog_upgrade_required");
      }
      if (catalog.catalog.rulesVersion !== CITY_CATALOG_RULES_VERSION) mismatch();
      const key = exactKey({
        countryCode: definition.countryCode,
        packageId: definition.packageId,
        packageSchemaVersion: definition.packageSchemaVersion,
        catalogRevisionId: catalog.catalog.id,
        evidenceRulesVersion: definition.evidenceRulesVersion,
      });
      const exactRows = this.findExactRows(key);
      if (exactRows.length > 1) mismatch();
      if (exactRows.length === 1) {
        const record = this.reconstructRetryChain(exactRows[0]!);
        this.comparePrepared(record, input);
        return { kind: "retry" as const, manifest: record.manifest };
      }
      const current = this.reconstructCountry(key.countryCode);
      const verifiedPredecessorRows = this.countryRows(key.countryCode);
      const predecessor = current.length === 0 ? undefined : current[current.length - 1];
      if (predecessor !== undefined &&
        predecessor.manifest.installedAt >= instant(input.installedAt)) mismatch();
      const approvedDefaults = resolveApprovedCityCriteriaDefaults(definition, this.defaults);
      const behavior = resolveInstalledCityPackageBehaviorForDefinition(definition, this.behaviors);
      const reconstructed = this.reconstructPrepared(
        input, ready, catalog, key, approvedDefaults, behavior,
      );
      const payload = this.payloadFrom(reconstructed, predecessor?.manifest.id ?? null);
      const canonical = this.integrity.canonical(payload);
      const payloadHash = this.integrity.hash(canonical);
      const id = `installed-city-package-manifest:${payloadHash}`;
      const hmac = this.integrity.sign(canonical);
      const expectedRow: ManifestRow = {
        id,
        country_code: key.countryCode,
        package_id: key.packageId,
        package_schema_version: key.packageSchemaVersion,
        catalog_revision_id: key.catalogRevisionId,
        evidence_rules_version: key.evidenceRulesVersion,
        predecessor_manifest_id: predecessor?.manifest.id ?? null,
        administrative_evidence_snapshot_id: input.administrativeEvidence.evidenceId,
        installed_at: input.installedAt,
        payload_json: canonical,
        payload_hash: payloadHash,
        hmac,
      };
      return {
        kind: "append" as const,
        candidate: manifestCopy(payload, expectedRow),
        expectedRow,
        predecessorManifestId: predecessor?.manifest.id,
        verifiedPredecessorRows,
      };
    });
    if (!this.database.inTransaction || this.totalChanges() !== initialChanges ||
      this.schemaState() !== initialSchema) mismatch();
    if (prepared.kind === "retry") return prepared.manifest;
    const { candidate, expectedRow, predecessorManifestId, verifiedPredecessorRows } = prepared;
    try {
      this.database.prepare(`
        INSERT INTO installed_city_package_manifests (
          id, country_code, package_id, package_schema_version, catalog_revision_id,
          evidence_rules_version, predecessor_manifest_id, administrative_evidence_snapshot_id,
          installed_at, payload_json, payload_hash, hmac
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        expectedRow.id, expectedRow.country_code, expectedRow.package_id,
        expectedRow.package_schema_version, expectedRow.catalog_revision_id,
        expectedRow.evidence_rules_version, expectedRow.predecessor_manifest_id,
        expectedRow.administrative_evidence_snapshot_id, expectedRow.installed_at,
        expectedRow.payload_json, expectedRow.payload_hash, expectedRow.hmac,
      );
    } catch {
      mismatch();
    }
    if (this.totalChanges() !== initialChanges + 1 || this.schemaState() !== initialSchema) mismatch();
    const persisted = this.withCallbackBarrier(() => {
      const inserted = this.findById(expectedRow.id);
      if (inserted === undefined || !sameManifestRow(inserted, expectedRow)) mismatch();
      const record = this.reconstructRow(inserted);
      this.comparePrepared(record, input);
      if (this.integrity.canonical(record.manifest) !==
        this.integrity.canonical(candidate)) mismatch();
      return { inserted, manifest: record.manifest };
    });
    if (!this.database.inTransaction || this.totalChanges() !== initialChanges + 1 ||
      this.schemaState() !== initialSchema) mismatch();
    for (const verifiedRow of verifiedPredecessorRows) {
      const predecessorRow = this.findById(verifiedRow.id);
      if (predecessorRow === undefined || !sameManifestRow(predecessorRow, verifiedRow)) mismatch();
    }
    const persistedInserted = this.findById(persisted.inserted.id);
    if (persistedInserted === undefined ||
      !sameManifestRow(persistedInserted, persisted.inserted)) mismatch();
    const insertedSuccessors = this.database.prepare(`
      SELECT id FROM installed_city_package_manifests WHERE predecessor_manifest_id = ?
    `).all(persisted.inserted.id);
    if (insertedSuccessors.length !== 0) mismatch();
    if (predecessorManifestId !== undefined) {
      const predecessorSuccessors = this.database.prepare(`
        SELECT id FROM installed_city_package_manifests WHERE predecessor_manifest_id = ?
      `).all(predecessorManifestId) as Array<{ readonly id: string }>;
      if (predecessorSuccessors.length !== 1 ||
        predecessorSuccessors[0]!.id !== persisted.inserted.id) {
        mismatch();
      }
    }
    if (predecessorManifestId === undefined) {
      const result = this.database.prepare(`
        INSERT INTO installed_city_package_heads (country_code, current_manifest_id)
        VALUES (?, ?)
      `).run(expectedRow.country_code, expectedRow.id);
      if (result.changes !== 1) mismatch();
    } else {
      const result = this.database.prepare(`
        UPDATE installed_city_package_heads SET current_manifest_id = ?
        WHERE country_code = ? AND current_manifest_id = ?
      `).run(expectedRow.id, expectedRow.country_code, predecessorManifestId);
      if (result.changes !== 1) mismatch();
    }
    if (!this.database.inTransaction || this.totalChanges() !== initialChanges + 2 ||
      this.schemaState() !== initialSchema) mismatch();
    return manifestCopy(persisted.manifest, persisted.inserted);
  }

  private validateAppendInput(input: InstalledCityPackageManifestAppendInput): void {
    exact(input, [
      "ready", "catalog", "administrativeEvidence", "fixedPlansByCityId", "safetySourcePlan",
      "officialAuthorityDirectory", "criteriaDefaults", "criterionDefinitions", "installedAt",
    ]);
    const administrative = exact(input.administrativeEvidence, [
      "installRunId", "evidenceId", "evidence", "artifacts", "bindings",
    ]);
    exact(administrative.evidence, ["snapshot", "manifest", "canonicalManifest"]);
    if (!Array.isArray(administrative.artifacts) || !Array.isArray(administrative.bindings)) mismatch();
    for (const artifact of administrative.artifacts) {
      exact(artifact, [
        "artifactId", "runId", "sourceId", "role", "mediaType", "sha256", "bytes", "origin",
        "producer", "createdAt",
      ]);
    }
    for (const item of administrative.bindings) {
      exact(item, [
        "evidenceSnapshotId", "artifactId", "artifactOrdinal", "runId", "sourceId", "role",
        "mediaType", "sha256",
      ]);
    }
  }

  private approvedDefinition(value: unknown): ApprovedCityCriteriaPackageDefinition {
    const definition = exact(value, [
      "packageId", "packageSchemaVersion", "countryCode", "evidenceRulesVersion", "sourceIds",
    ]);
    return freeze({
      countryCode: country(definition.countryCode),
      packageId: identifier(definition.packageId),
      packageSchemaVersion: identifier(definition.packageSchemaVersion),
      evidenceRulesVersion: identifier(definition.evidenceRulesVersion),
    });
  }

  private findExactRows(key: InstalledCityPackageExactKey): ManifestRow[] {
    return this.database.prepare(`
      SELECT id, country_code, package_id, package_schema_version, catalog_revision_id,
             evidence_rules_version, predecessor_manifest_id,
             administrative_evidence_snapshot_id, installed_at, payload_json, payload_hash, hmac
      FROM installed_city_package_manifests
      WHERE country_code = ? AND package_id = ? AND package_schema_version = ?
        AND catalog_revision_id = ? AND evidence_rules_version = ?
    `).all(
      key.countryCode, key.packageId, key.packageSchemaVersion, key.catalogRevisionId,
      key.evidenceRulesVersion,
    ) as ManifestRow[];
  }

  private findById(id: string): ManifestRow | undefined {
    const rows = this.database.prepare(`
      SELECT id, country_code, package_id, package_schema_version, catalog_revision_id,
             evidence_rules_version, predecessor_manifest_id,
             administrative_evidence_snapshot_id, installed_at, payload_json, payload_hash, hmac
      FROM installed_city_package_manifests WHERE id = ?
    `).all(id) as ManifestRow[];
    if (rows.length > 1) mismatch();
    return rows[0];
  }

  private totalChanges(): number {
    return this.database.prepare("SELECT total_changes()").pluck().get() as number;
  }

  private withCallbackBarrier<T>(operation: () => T): T {
    const iterator = this.database.prepare(`
      SELECT 1 AS callback_barrier
      UNION ALL
      SELECT 2 AS callback_barrier
    `).iterate()[Symbol.iterator]();
    const first = iterator.next();
    if (first.done) {
      iterator.return?.();
      mismatch();
    }
    try {
      return operation();
    } finally {
      iterator.return?.();
    }
  }

  private schemaState(): string {
    const mainSchemaVersion = this.database.pragma(
      "main.schema_version", { simple: true },
    ) as number;
    const tempSchemaVersion = this.database.pragma(
      "temp.schema_version", { simple: true },
    ) as number;
    const mainObjects = this.database.prepare(`
      SELECT type, name, tbl_name, sql FROM main.sqlite_master
      WHERE name NOT LIKE 'sqlite_%'
      ORDER BY type, name, tbl_name, sql
    `).all();
    const tempObjects = this.database.prepare(`
      SELECT type, name, tbl_name, sql FROM temp.sqlite_master
      WHERE name NOT LIKE 'sqlite_%'
      ORDER BY type, name, tbl_name, sql
    `).all();
    const databases = this.databaseList();
    return JSON.stringify({
      mainSchemaVersion,
      tempSchemaVersion,
      mainObjects,
      tempObjects,
      databases,
      pragmas: this.mutableConnectionPragmas(),
    });
  }

  private connectionState(): ConnectionState {
    this.database.pragma("temp.schema_version", { simple: true });
    return {
      databases: this.databaseList(),
      pragmas: this.mutableConnectionPragmas(),
    };
  }

  private mutableConnectionPragmas(): MutableConnectionPragmas {
    return Object.fromEntries(MUTABLE_CONNECTION_PRAGMAS.map((name) => {
      const value = this.database.pragma(name, { simple: true });
      if (typeof value !== "number" || !Number.isSafeInteger(value)) mismatch();
      return [name, value];
    })) as MutableConnectionPragmas;
  }

  private databaseList(): DatabaseListRow[] {
    return this.database.pragma("database_list") as DatabaseListRow[];
  }

  private restoreDatabaseList(expected: readonly DatabaseListRow[]): void {
    const expectedNames = new Set(expected.map(({ name }) => name));
    const added = this.databaseList()
      .filter(({ name }) => !expectedNames.has(name))
      .sort((left, right) => right.seq - left.seq);
    for (const { name } of added) {
      const identifier = `"${name.replaceAll('"', '""')}"`;
      try {
        this.database.exec(`DETACH DATABASE ${identifier}`);
      } catch {
        mismatch();
      }
    }
    if (JSON.stringify(this.databaseList()) !== JSON.stringify(expected)) mismatch();
  }

  private restoreConnectionState(expected: ConnectionState): void {
    const actualPragmas = this.mutableConnectionPragmas();
    for (const name of MUTABLE_CONNECTION_PRAGMAS) {
      if (actualPragmas[name] !== expected.pragmas[name]) {
        this.database.pragma(`${name} = ${expected.pragmas[name]}`);
      }
    }
    this.restoreDatabaseList(expected.databases);
    if (JSON.stringify(this.mutableConnectionPragmas()) !== JSON.stringify(expected.pragmas)) {
      mismatch();
    }
  }

  private reconstructRetryChain(row: ManifestRow): VerifiedInstalledCityPackageRecord {
    const rows: ManifestRow[] = [];
    const seen = new Set<string>();
    let cursor: ManifestRow | undefined = row;
    while (cursor !== undefined) {
      if (seen.has(cursor.id)) mismatch();
      seen.add(cursor.id);
      rows.push(cursor);
      cursor = cursor.predecessor_manifest_id === null
        ? undefined
        : this.findById(cursor.predecessor_manifest_id);
      if (cursor === undefined && rows[rows.length - 1]!.predecessor_manifest_id !== null) mismatch();
    }
    rows.reverse();
    const manifests = rows.map((candidate) => this.verifyEnvelope(candidate));
    let previous: VerifiedInstalledCityPackageRecord | undefined;
    let requested: VerifiedInstalledCityPackageRecord | undefined;
    for (let index = 0; index < rows.length; index += 1) {
      const candidate = rows[index]!;
      const manifest = manifests[index]!;
      const record = this.reconstructPersisted(manifest);
      if (previous === undefined) {
        if (record.manifest.predecessorManifestId !== null) mismatch();
      } else if (record.manifest.predecessorManifestId !== previous.manifest.id ||
        record.manifest.installedAt <= previous.manifest.installedAt ||
        record.manifest.key.countryCode !== previous.manifest.key.countryCode) mismatch();
      previous = record;
      if (candidate.id === row.id) requested = record;
    }
    for (const verifiedRow of rows) {
      if (JSON.stringify(this.findById(verifiedRow.id)) !== JSON.stringify(verifiedRow)) mismatch();
    }
    if (requested === undefined) mismatch();
    return requested;
  }

  private reconstructCountry(countryCode: string): VerifiedInstalledCityPackageRecord[] {
    const rows = this.countryRows(countryCode);
    const heads = this.database.prepare(`
      SELECT current_manifest_id FROM installed_city_package_heads WHERE country_code = ?
    `).all(countryCode) as Array<{ readonly current_manifest_id: string }>;
    if (rows.length === 0) {
      if (heads.length !== 0) mismatch();
      return [];
    }
    const initialTopology = this.countryTopology(countryCode, rows);
    if (heads.length !== 1) mismatch();
    const byId = new Map<string, ManifestRow>();
    for (const row of rows) {
      if (byId.has(row.id)) mismatch();
      byId.set(row.id, row);
    }
    const roots = rows.filter((row) => row.predecessor_manifest_id === null);
    if (roots.length !== 1) mismatch();
    const successor = new Map<string, ManifestRow>();
    for (const row of rows) {
      if (row.predecessor_manifest_id === null) continue;
      if (!byId.has(row.predecessor_manifest_id) || successor.has(row.predecessor_manifest_id)) {
        mismatch();
      }
      successor.set(row.predecessor_manifest_id, row);
    }
    const ordered: ManifestRow[] = [];
    const visited = new Set<string>();
    let cursor: ManifestRow | undefined = roots[0];
    while (cursor !== undefined) {
      if (visited.has(cursor.id)) mismatch();
      visited.add(cursor.id);
      ordered.push(cursor);
      cursor = successor.get(cursor.id);
    }
    if (ordered.length !== rows.length || heads[0]!.current_manifest_id !== ordered.at(-1)!.id) {
      mismatch();
    }
    const chainHeads = this.headsForRows(rows);
    if (chainHeads.length !== 1 || chainHeads[0]!.country_code !== countryCode ||
      chainHeads[0]!.current_manifest_id !== ordered.at(-1)!.id) mismatch();
    for (let index = 0; index < ordered.length; index += 1) {
      const candidate = ordered[index]!;
      const globalSuccessors = this.database.prepare(`
        SELECT id, country_code FROM installed_city_package_manifests
        WHERE predecessor_manifest_id = ?
      `).all(candidate.id) as Array<{ readonly id: string; readonly country_code: string }>;
      const expectedSuccessor = ordered[index + 1];
      if (expectedSuccessor === undefined) {
        if (globalSuccessors.length !== 0) mismatch();
      } else if (globalSuccessors.length !== 1 ||
        globalSuccessors[0]!.id !== expectedSuccessor.id ||
        globalSuccessors[0]!.country_code !== countryCode) mismatch();
    }
    const manifests = ordered.map((candidate) => this.verifyEnvelope(candidate));
    for (let index = 0; index < manifests.length; index += 1) {
      const manifest = manifests[index]!;
      if (index === 0) {
        if (manifest.predecessorManifestId !== null) mismatch();
      } else {
        const previous = manifests[index - 1]!;
        if (manifest.predecessorManifestId !== previous.id ||
          manifest.installedAt <= previous.installedAt ||
          manifest.key.countryCode !== countryCode) mismatch();
      }
    }
    if (this.countryTopology(countryCode, rows) !== initialTopology) mismatch();
    const records: VerifiedInstalledCityPackageRecord[] = [];
    for (let index = 0; index < ordered.length; index += 1) {
      records.push(this.reconstructPersisted(manifests[index]!));
    }
    if (this.countryTopology(countryCode, rows) !== initialTopology) mismatch();
    return records;
  }

  private countryTopology(countryCode: string, rows: readonly ManifestRow[]): string {
    const heads = this.headsForRows(rows);
    const rowIds = new Set(rows.map(({ id }) => id));
    const successors = (this.database.prepare(`
      SELECT id, country_code, predecessor_manifest_id
      FROM installed_city_package_manifests WHERE predecessor_manifest_id IS NOT NULL
      ORDER BY predecessor_manifest_id, country_code, id
    `).all() as Array<{
      readonly id: string;
      readonly country_code: string;
      readonly predecessor_manifest_id: string;
    }>).filter(({ predecessor_manifest_id }) => rowIds.has(predecessor_manifest_id));
    return JSON.stringify({ rows: this.countryRows(countryCode), heads, successors });
  }

  private headsForRows(rows: readonly ManifestRow[]): Array<{
    readonly country_code: string;
    readonly current_manifest_id: string;
  }> {
    const rowIds = new Set(rows.map(({ id }) => id));
    return (this.database.prepare(`
      SELECT country_code, current_manifest_id FROM installed_city_package_heads
      ORDER BY country_code, current_manifest_id
    `).all() as Array<{
      readonly country_code: string;
      readonly current_manifest_id: string;
    }>).filter(({ current_manifest_id }) => rowIds.has(current_manifest_id));
  }

  private countryRows(countryCode: string): ManifestRow[] {
    return this.database.prepare(`
      SELECT id, country_code, package_id, package_schema_version, catalog_revision_id,
             evidence_rules_version, predecessor_manifest_id,
             administrative_evidence_snapshot_id, installed_at, payload_json, payload_hash, hmac
      FROM installed_city_package_manifests WHERE country_code = ? ORDER BY id
    `).all(countryCode) as ManifestRow[];
  }

  private verifyEnvelope(row: ManifestRow): InstalledCityPackageManifest {
    if (!secureHexEqual(row.payload_hash, this.integrity.hash(row.payload_json)) ||
      !secureHexEqual(row.hmac, this.integrity.sign(row.payload_json)) ||
      row.id !== `installed-city-package-manifest:${row.payload_hash}`) mismatch();
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.payload_json) as unknown;
    } catch {
      mismatch();
    }
    if (this.integrity.canonical(parsed) !== row.payload_json) mismatch();
    const payload = exact(parsed, PAYLOAD_KEYS) as unknown as InstalledCityPackageManifestPayload;
    if (payload.schemaVersion !== "installed-city-package-manifest@1") mismatch();
    const key = exactKey(payload.key);
    if (row.country_code !== key.countryCode || row.package_id !== key.packageId ||
      row.package_schema_version !== key.packageSchemaVersion ||
      row.catalog_revision_id !== key.catalogRevisionId ||
      row.evidence_rules_version !== key.evidenceRulesVersion ||
      row.predecessor_manifest_id !== payload.predecessorManifestId ||
      row.installed_at !== payload.installedAt ||
      row.administrative_evidence_snapshot_id !== this.evidenceId(payload)) mismatch();
    instant(payload.installedAt);
    return manifestCopy(payload, row);
  }

  private reconstructRow(row: ManifestRow): VerifiedInstalledCityPackageRecord {
    return this.reconstructPersisted(this.verifyEnvelope(row));
  }

  private evidenceId(payload: InstalledCityPackageManifestPayload): string {
    const bindings = this.orderedBindings(payload);
    if (bindings.length === 0 ||
      bindings.some((item) => item.evidenceSnapshotId !== bindings[0]!.evidenceSnapshotId)) mismatch();
    return bindings[0]!.evidenceSnapshotId;
  }

  private orderedBindings(payload: InstalledCityPackageManifestPayload): readonly (
    InstalledCityPackageJsonArtifactBinding<InstalledCityPackageJsonArtifactRole> & {
      readonly slot: InstalledCityPackageArtifactSlot;
    }
  )[] {
    const fixed = exact(payload.fixedPlansByCityId, Object.keys(payload.fixedPlansByCityId).sort());
    const ordered: Array<InstalledCityPackageJsonArtifactBinding<
      InstalledCityPackageJsonArtifactRole
    > & { readonly slot: InstalledCityPackageArtifactSlot }> = [];
    const cityIds = Object.keys(fixed).sort();
    for (const cityId of cityIds) {
      identifier(cityId);
      const tuple = fixed[cityId];
      if (!Array.isArray(tuple) || tuple.length !== FIXED_SOURCE_IDS.length) mismatch();
      FIXED_SOURCE_IDS.forEach((sourceId, sourceIndex) => {
        const plan = exact(tuple[sourceIndex], [
          "sourceId", "cityId", "planId", "criterionId", "definitionId", "parserVersion",
          "rulesVersion", "freshnessPolicyVersion", "valuePolicyVersion",
          "sourcePeriodPolicyVersion", "planArtifact",
        ]);
        if (plan.sourceId !== sourceId || plan.cityId !== cityId) mismatch();
        ordered.push({
          ...binding(plan.planArtifact, "installed_city_fixed_source_plan"),
          slot: { kind: "fixed_plan" as const, cityId, sourceId },
        });
      });
    }
    const safety = exact(payload.safety, [
      "sourcePlanId", "sourcePlanSchemaVersion", "authorityDirectoryId", "queryTemplateVersion",
      "definitionId", "freshnessPolicyVersion", "discoveryRulesVersion", "sourcePlanArtifact",
      "authorityDirectoryArtifact",
    ]);
    ordered.push({
      ...binding(safety.sourcePlanArtifact, "installed_city_safety_source_plan"),
      slot: { kind: "safety_source_plan" as const },
    });
    ordered.push({
      ...binding(safety.authorityDirectoryArtifact, "installed_city_official_authority_directory"),
      slot: { kind: "official_authority_directory" as const },
    });
    const criteria = exact(payload.criteria, [
      "defaultsMappingVersion", "definitionIds", "evaluatorRegistryVersionId",
      "evaluatorVersionIds", "defaultsArtifact", "definitionsArtifact",
    ]);
    ordered.push({
      ...binding(criteria.defaultsArtifact, "installed_city_criteria_defaults"),
      slot: { kind: "criteria_defaults" as const },
    });
    ordered.push({
      ...binding(criteria.definitionsArtifact, "installed_city_criterion_definitions"),
      slot: { kind: "criterion_definitions" as const },
    });
    const evidenceId = ordered[0]?.evidenceSnapshotId;
    const runId = ordered[0]?.runId;
    if (ordered.some((item, index) => item.artifactOrdinal !== index ||
      item.evidenceSnapshotId !== evidenceId || item.runId !== runId) ||
      new Set(ordered.map(({ artifactId }) => artifactId)).size !== ordered.length) mismatch();
    return ordered;
  }

  private reconstructPersisted(
    manifest: InstalledCityPackageManifest,
    preparedInput?: InstalledCityPackageManifestAppendInput,
  ):
  VerifiedInstalledCityPackageRecord {
    const ready = assertCityPackageReady({
      definition: manifest.definition,
      sourceContractStatus: manifest.sourceContractStatus,
      readiness: manifest.readiness,
    });
    const definition = this.approvedDefinition(ready.definition);
    if (this.integrity.canonical(exactKey(manifest.key)) !== this.integrity.canonical(manifest.key) ||
      manifest.key.countryCode !== definition.countryCode ||
      manifest.key.packageId !== definition.packageId ||
      manifest.key.packageSchemaVersion !== definition.packageSchemaVersion ||
      manifest.key.evidenceRulesVersion !== definition.evidenceRulesVersion) mismatch();
    const catalog = this.catalogs.loadVerified(manifest.key.catalogRevisionId);
    const catalogRoot = exact(manifest.catalogRoot, ["registryRevisionId", "catalogRevisionId"]);
    if (catalogRoot.registryRevisionId !== catalog.registry.id ||
      catalogRoot.catalogRevisionId !== catalog.catalog.id ||
      catalog.catalog.countryCode !== definition.countryCode ||
      catalog.catalog.packageId !== definition.packageId ||
      catalog.catalog.packageSchemaVersion !== definition.packageSchemaVersion ||
      (catalog.catalog.rulesVersion !== LEGACY_CITY_CATALOG_RULES_VERSION &&
        catalog.catalog.rulesVersion !== CITY_CATALOG_RULES_VERSION)) mismatch();
    const memberIds = catalog.catalog.members.map(({ cityId }) => cityId);
    const fixedPlanCityIds = Object.keys(exact(
      manifest.fixedPlansByCityId,
      Object.keys(manifest.fixedPlansByCityId).sort(),
    )).sort();
    if (fixedPlanCityIds.length !== memberIds.length ||
      fixedPlanCityIds.some((cityId, index) => cityId !== memberIds[index])) mismatch();
    const ordered = this.orderedBindings(manifest);
    const bundle = loadVerifiedAdministrativeEvidenceBundle(this.database, {
      evidenceId: ordered[0]!.evidenceSnapshotId,
      installedAt: manifest.installedAt,
      artifactIds: ordered.map(({ artifactId }) => artifactId),
    }, this.integrity);
    const artifacts = bundle.entries[0]?.artifacts;
    if (bundle.entries.length !== 1 || artifacts === undefined ||
      artifacts.length !== ordered.length) mismatch();
    for (let index = 0; index < ordered.length; index += 1) {
      const expected = ordered[index]!;
      const artifact = artifacts[index]!;
      if (artifact.artifactId !== expected.artifactId || artifact.runId !== expected.runId ||
        artifact.sourceId !== expected.sourceId || artifact.role !== expected.role ||
        artifact.mediaType !== expected.mediaType || artifact.sha256 !== expected.sha256 ||
        artifact.producer !== "install-city-package@1" || artifact.createdAt !== manifest.installedAt) {
        mismatch();
      }
    }
    const claim = reconstructInstalledPackageArtifactSetClaim(bundle.snapshot.claims, {
      key: manifest.key,
      installedAt: manifest.installedAt,
      orderedMaterials: ordered.map((item) => ({
        artifactOrdinal: item.artifactOrdinal,
        slot: item.slot,
        role: item.role,
        sha256: item.sha256,
      })),
    }, this.integrity);
    if (claim.evidenceId !== bundle.snapshot.id || claim.installRunId !== ordered[0]!.runId ||
      claim.orderedArtifacts.some((item, index) => item.artifactId !== ordered[index]!.artifactId)) {
      mismatch();
    }
    const decoded = artifacts.map((artifact) => this.decodeCanonicalJson(artifact.bytes));
    const fixedPlansByCityId: Record<string, readonly [
      CityFixedSourcePlan<"si-city-long-term-rent">,
      CityFixedSourcePlan<"si-city-urban-transit">,
      CityFixedSourcePlan<"si-city-fixed-broadband">,
    ]> = {};
    for (let memberIndex = 0; memberIndex < memberIds.length; memberIndex += 1) {
      const cityId = memberIds[memberIndex]!;
      const offset = memberIndex * FIXED_SOURCE_IDS.length;
      fixedPlansByCityId[cityId] = [
        reconstructCityFixedSourcePlan(decoded[offset], FIXED_SOURCE_IDS[0]),
        reconstructCityFixedSourcePlan(decoded[offset + 1], FIXED_SOURCE_IDS[1]),
        reconstructCityFixedSourcePlan(decoded[offset + 2], FIXED_SOURCE_IDS[2]),
      ];
    }
    if (Object.keys(manifest.fixedPlansByCityId).length !== memberIds.length ||
      memberIds.some((cityId, index) => Object.keys(manifest.fixedPlansByCityId).sort()[index] !== cityId)) {
      mismatch();
    }
    const singletonOffset = memberIds.length * FIXED_SOURCE_IDS.length;
    const officialAuthorityDirectory = reconstructOfficialAuthorityDirectory(
      decoded[singletonOffset + 1], catalog.catalog, this.integrity,
    );
    const safetySourcePlan = reconstructCitySafetySourcePlan(
      decoded[singletonOffset], catalog.catalog, officialAuthorityDirectory, this.integrity,
    );
    const criteria = exact(manifest.criteria, [
      "defaultsMappingVersion", "definitionIds", "evaluatorRegistryVersionId",
      "evaluatorVersionIds", "defaultsArtifact", "definitionsArtifact",
    ]);
    exact(criteria.definitionIds, CITY_CRITERION_IDS);
    exact(criteria.evaluatorVersionIds, CITY_CRITERION_IDS);
    const criterionDefinitions = reconstructInstalledCityCriterionDefinitions(
      decoded[singletonOffset + 3],
      criteria.definitionIds as Readonly<Record<CityCriterionId, string>>,
      criteria.evaluatorVersionIds as Readonly<Record<CityCriterionId, string>>,
    );
    const approvedDefaults = resolveApprovedCityCriteriaDefaults(definition, this.defaults);
    if (approvedDefaults.mappingVersion !== criteria.defaultsMappingVersion ||
      this.integrity.canonical(decoded[singletonOffset + 2]) !==
        this.integrity.canonical(approvedDefaults)) mismatch();
    if (preparedInput !== undefined) {
      const canonical = this.integrity.canonical.bind(this.integrity);
      if (canonical(ready) !== canonical(preparedInput.ready) ||
        canonical(catalog) !== canonical(preparedInput.catalog) ||
        canonical(fixedPlansByCityId) !== canonical(preparedInput.fixedPlansByCityId) ||
        canonical(safetySourcePlan) !== canonical(preparedInput.safetySourcePlan) ||
        canonical(officialAuthorityDirectory) !==
          canonical(preparedInput.officialAuthorityDirectory) ||
        canonical(approvedDefaults) !== canonical(preparedInput.criteriaDefaults) ||
        canonical(criterionDefinitions) !== canonical(preparedInput.criterionDefinitions)) mismatch();
    }
    const behavior = resolveInstalledCityPackageBehaviorForVersion(definition, {
      evaluatorRegistryVersionId: identifier(criteria.evaluatorRegistryVersionId),
      evaluatorVersionIds: criteria.evaluatorVersionIds as Readonly<Record<CityCriterionId, string>>,
      valueValidatorVersionId: manifest.valueValidatorVersionId,
      sourcePeriodValidatorVersionId: manifest.sourcePeriodValidatorVersionId,
    }, this.behaviors);
    this.bindReconstructed(
      manifest, fixedPlansByCityId, safetySourcePlan, criterionDefinitions, behavior,
    );
    const criteriaDefaults = reconstructInstalledCityCriteriaDefaults(
      decoded[singletonOffset + 2], approvedDefaults.mappingVersion,
      criterionDefinitions, behavior.evaluatorRegistry,
    );
    return freeze({
      manifest,
      ready,
      catalog,
      fixedPlansByCityId: freeze(fixedPlansByCityId),
      safetySourcePlan,
      officialAuthorityDirectory,
      criteriaDefaults,
      criterionDefinitions,
      evaluatorRegistry: behavior.evaluatorRegistry,
      validateValue: behavior.validateValue,
      validateSourcePeriod: behavior.validateSourcePeriod,
    });
  }

  private decodeCanonicalJson(bytes: Uint8Array): unknown {
    let text: string;
    let parsed: unknown;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      parsed = JSON.parse(text) as unknown;
    } catch {
      mismatch();
    }
    const canonicalBytes = new TextEncoder().encode(this.integrity.canonical(parsed));
    if (!sameBytes(bytes, canonicalBytes)) mismatch();
    return snapshot(parsed);
  }

  private bindReconstructed(
    manifest: InstalledCityPackageManifest,
    plans: Readonly<Record<string, readonly [
      CityFixedSourcePlan<"si-city-long-term-rent">,
      CityFixedSourcePlan<"si-city-urban-transit">,
      CityFixedSourcePlan<"si-city-fixed-broadband">,
    ]>>,
    safety: ReturnType<typeof reconstructCitySafetySourcePlan>,
    definitions: ReturnType<typeof reconstructInstalledCityCriterionDefinitions>,
    behavior: InstalledCityPackageBehaviorRegistryEntry,
  ): void {
    for (const criterionId of CITY_CRITERION_IDS) {
      const definition = definitions.find((candidate) => candidate.criterionId === criterionId);
      const executableDefinition = behavior.evaluatorRegistry[criterionId].definition;
      if (definition === undefined || definition.criterionId !== executableDefinition.criterionId ||
        definition.definitionId !== executableDefinition.definitionId ||
        definition.direction !== executableDefinition.direction ||
        definition.unit !== executableDefinition.unit ||
        definition.denominator !== executableDefinition.denominator ||
        definition.freshnessPolicyVersion !== executableDefinition.freshnessPolicyVersion ||
        definition.evaluatorVersion !== executableDefinition.evaluatorVersion ||
        definition.compatibleGeoScopes.length !== executableDefinition.compatibleGeoScopes.length ||
        definition.compatibleGeoScopes.some(
          (scope, index) => scope !== executableDefinition.compatibleGeoScopes[index],
        )) mismatch();
    }
    for (const [cityId, tuple] of Object.entries(plans)) {
      const persisted = manifest.fixedPlansByCityId[cityId];
      if (persisted === undefined) mismatch();
      tuple.forEach((plan, index) => {
        const bound = persisted[index]!;
        const policy = behavior.fixedPolicyVersionsBySourceId[plan.sourceId];
        if (bound.sourceId !== plan.sourceId || bound.cityId !== plan.cityId ||
          bound.planId !== plan.planId || bound.criterionId !== plan.criterionId ||
          bound.definitionId !== plan.definitionId || bound.parserVersion !== plan.parserVersion ||
          bound.rulesVersion !== plan.rulesVersion ||
          bound.freshnessPolicyVersion !== plan.claimContract.freshnessPolicyVersion ||
          bound.valuePolicyVersion !== plan.claimContract.valuePolicyVersion ||
          bound.sourcePeriodPolicyVersion !== plan.claimContract.sourcePeriodPolicyVersion ||
          policy.valuePolicyVersion !== plan.claimContract.valuePolicyVersion ||
          policy.sourcePeriodPolicyVersion !== plan.claimContract.sourcePeriodPolicyVersion) mismatch();
        const definition = definitions.find(({ criterionId }) => criterionId === plan.criterionId);
        if (definition === undefined || definition.definitionId !== plan.definitionId ||
          definition.freshnessPolicyVersion !== plan.claimContract.freshnessPolicyVersion ||
          !definition.compatibleGeoScopes.includes(plan.claimContract.geoScope) ||
          definition.unit !== plan.claimContract.unit ||
          definition.denominator !== plan.claimContract.denominator) mismatch();
      });
    }
    const safetyBinding = manifest.safety;
    const safetyDefinition = definitions[0];
    if (safetyBinding.sourcePlanId !== safety.id ||
      safetyBinding.sourcePlanSchemaVersion !== safety.schemaVersion ||
      safetyBinding.authorityDirectoryId !== safety.authorityDirectoryId ||
      safetyBinding.queryTemplateVersion !== safety.queryTemplateVersion ||
      safetyBinding.definitionId !== safety.definitionId ||
      safetyBinding.freshnessPolicyVersion !== safety.freshnessPolicyVersion ||
      safetyBinding.discoveryRulesVersion !== safety.discoveryRulesVersion ||
      safetyDefinition.definitionId !== safety.definitionId ||
      safetyDefinition.freshnessPolicyVersion !== safety.freshnessPolicyVersion) mismatch();
  }

  private reconstructPrepared(
    input: InstalledCityPackageManifestAppendInput,
    ready: ReturnType<typeof assertCityPackageReady>,
    catalog: InstalledCityPackageManifestAppendInput["catalog"],
    key: InstalledCityPackageExactKey,
    approvedDefaults: ReturnType<typeof resolveApprovedCityCriteriaDefaults>,
    behavior: InstalledCityPackageBehaviorRegistryEntry,
  ): VerifiedInstalledCityPackageRecord {
    const temporaryPayload = this.payloadFromInput(input, ready, catalog, key, behavior, null);
    const manifest: InstalledCityPackageManifest = freeze({
      ...temporaryPayload,
      id: "installed-city-package-manifest:prepared",
      payloadHash: "0".repeat(64),
      hmac: "0".repeat(64),
    });
    this.compareAdministrative(manifest, input);
    const reconstructed = this.reconstructPersisted(manifest, input);
    if (this.integrity.canonical(reconstructed.criteriaDefaults) !==
      this.integrity.canonical(approvedDefaults)) mismatch();
    this.comparePrepared(reconstructed, input);
    return reconstructed;
  }

  private payloadFrom(
    prepared: VerifiedInstalledCityPackageRecord,
    predecessorManifestId: string | null,
  ): InstalledCityPackageManifestPayload {
    const payload = Object.fromEntries(PAYLOAD_KEYS.map((key) => [key, prepared.manifest[key]])) as
      unknown as InstalledCityPackageManifestPayload;
    return freeze({ ...snapshot(payload), predecessorManifestId });
  }

  private payloadFromInput(
    input: InstalledCityPackageManifestAppendInput,
    ready: ReturnType<typeof assertCityPackageReady>,
    catalog: InstalledCityPackageManifestAppendInput["catalog"],
    key: InstalledCityPackageExactKey,
    behavior: InstalledCityPackageBehaviorRegistryEntry,
    predecessorManifestId: string | null,
    existing?: InstalledCityPackageManifest,
  ): InstalledCityPackageManifestPayload {
    if (existing !== undefined) return freeze({
      ...snapshot(existing),
      predecessorManifestId,
    });
    const bindings = input.administrativeEvidence.bindings;
    const memberIds = catalog.catalog.members.map(({ cityId }) => cityId);
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
        valuePolicyVersion: plan.claimContract.valuePolicyVersion,
        sourcePeriodPolicyVersion: plan.claimContract.sourcePeriodPolicyVersion,
        planArtifact: bindings[memberIndex * 3 + sourceIndex]!,
      })),
    ])) as unknown as InstalledCityPackageManifestPayload["fixedPlansByCityId"];
    const singletonOffset = memberIds.length * 3;
    return freeze({
      schemaVersion: "installed-city-package-manifest@1",
      key,
      definition: ready.definition,
      sourceContractStatus: ready.sourceContractStatus,
      readiness: ready.readiness,
      catalogRoot: {
        registryRevisionId: catalog.registry.id,
        catalogRevisionId: catalog.catalog.id,
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
        sourcePlanArtifact: bindings[singletonOffset] as InstalledCityPackageManifestPayload[
          "safety"
        ]["sourcePlanArtifact"],
        authorityDirectoryArtifact: bindings[singletonOffset + 1] as
          InstalledCityPackageManifestPayload["safety"]["authorityDirectoryArtifact"],
      },
      criteria: {
        defaultsMappingVersion: input.criteriaDefaults.mappingVersion,
        definitionIds: Object.fromEntries(input.criterionDefinitions.map((definition) => [
          definition.criterionId, definition.definitionId,
        ])) as Readonly<Record<CityCriterionId, string>>,
        evaluatorRegistryVersionId: behavior.versionKey.evaluatorRegistryVersionId,
        evaluatorVersionIds: behavior.versionKey.evaluatorVersionIds,
        defaultsArtifact: bindings[singletonOffset + 2] as
          InstalledCityPackageManifestPayload["criteria"]["defaultsArtifact"],
        definitionsArtifact: bindings[singletonOffset + 3] as
          InstalledCityPackageManifestPayload["criteria"]["definitionsArtifact"],
      },
      valueValidatorVersionId: behavior.versionKey.valueValidatorVersionId,
      sourcePeriodValidatorVersionId: behavior.versionKey.sourcePeriodValidatorVersionId,
      predecessorManifestId,
      installedAt: input.installedAt,
    });
  }

  private comparePrepared(
    record: VerifiedInstalledCityPackageRecord,
    input: InstalledCityPackageManifestAppendInput,
  ): void {
    const canonical = this.integrity.canonical.bind(this.integrity);
    if (record.manifest.installedAt !== input.installedAt ||
      canonical(record.ready) !== canonical(input.ready) ||
      canonical(record.catalog) !== canonical(input.catalog) ||
      canonical(record.fixedPlansByCityId) !== canonical(input.fixedPlansByCityId) ||
      canonical(record.safetySourcePlan) !== canonical(input.safetySourcePlan) ||
      canonical(record.officialAuthorityDirectory) !== canonical(input.officialAuthorityDirectory) ||
      canonical(record.criteriaDefaults) !== canonical(input.criteriaDefaults) ||
      canonical(record.criterionDefinitions) !== canonical(input.criterionDefinitions)) mismatch();
    this.compareAdministrative(record.manifest, input);
  }

  private compareAdministrative(
    manifest: InstalledCityPackageManifest,
    input: InstalledCityPackageManifestAppendInput,
  ): void {
    const canonical = this.integrity.canonical.bind(this.integrity);
    const expectedBindings = this.orderedBindings(manifest);
    const serializedBindings = expectedBindings.map((item) => ({
      evidenceSnapshotId: item.evidenceSnapshotId,
      artifactId: item.artifactId,
      artifactOrdinal: item.artifactOrdinal,
      runId: item.runId,
      sourceId: item.sourceId,
      role: item.role,
      mediaType: item.mediaType,
      sha256: item.sha256,
    }));
    if (canonical(serializedBindings) !==
      canonical(input.administrativeEvidence.bindings) ||
      input.administrativeEvidence.evidenceId !== expectedBindings[0]!.evidenceSnapshotId ||
      input.administrativeEvidence.installRunId !== expectedBindings[0]!.runId) mismatch();
    const bundle = loadVerifiedAdministrativeEvidenceBundle(this.database, {
      evidenceId: input.administrativeEvidence.evidenceId,
      installedAt: input.installedAt,
      artifactIds: expectedBindings.map(({ artifactId }) => artifactId),
    }, this.integrity);
    if (canonical(bundle.snapshot) !== canonical(input.administrativeEvidence.evidence.snapshot) ||
      canonical(bundle.manifest) !== canonical(input.administrativeEvidence.evidence.manifest) ||
      input.administrativeEvidence.evidence.canonicalManifest !==
        canonical(input.administrativeEvidence.evidence.manifest) ||
      input.administrativeEvidence.artifacts.length !== bundle.entries[0]!.artifacts.length) mismatch();
    input.administrativeEvidence.artifacts.forEach((artifact, index) => {
      const persisted = bundle.entries[0]!.artifacts[index]!;
      const { bytes, ...metadata } = artifact;
      const { bytes: persistedBytes, ...persistedMetadata } = persisted;
      if (canonical(metadata) !== canonical(persistedMetadata) || !sameBytes(bytes, persistedBytes)) {
        mismatch();
      }
    });
  }
}
