import type Database from "better-sqlite3";

import type {
  CityCatalogStorePort,
  VerifiedCityCatalogBundle,
} from "../../application/city-data-contracts";
import {
  CITY_CATALOG_RULES_VERSION,
  reconstructVerifiedCityCatalog,
  type CityCatalogProjection,
} from "../../decision/city-catalog";
import type { CityDecisionIntegrity } from "../../decision/city-integrity";
import type { EvidenceIntegrity } from "../../research/research-plan";
import { secureHexEqual } from "../integrity";

interface CatalogRow {
  readonly id: string;
  readonly registry_revision_id: string;
  readonly country_code: string;
  readonly package_id: string;
  readonly package_schema_version: string;
  readonly registry_evidence_snapshot_id: string;
  readonly catalog_evidence_snapshot_id: string;
  readonly rules_version: string;
  readonly created_at: string;
  readonly payload_json: string;
  readonly payload_hash: string;
  readonly hmac: string;
}

interface IntegrityView extends CityDecisionIntegrity {
  readonly sign: (value: string) => string;
}

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
  const canonical = capability(value, "canonical") as unknown as (value: unknown) => string;
  const hash = capability(value, "hash") as unknown as (value: string) => string;
  const sign = capability(value, "sign") as unknown as (value: string) => string;
  return Object.freeze({ canonical, hash, sign });
}

function identifier(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/.test(value)) mismatch();
  return value;
}

function constraint(error: unknown): boolean {
  return error !== null && typeof error === "object" && "code" in error &&
    typeof (error as { readonly code?: unknown }).code === "string" &&
    (error as { readonly code: string }).code.startsWith("SQLITE_CONSTRAINT");
}

function normalize(error: unknown): never {
  if (error instanceof Error &&
    (error.message === "city_catalog_not_found" ||
      error.message === "city_catalog_upgrade_required" ||
      error.message === "integrity_mismatch")) throw error;
  mismatch();
}

export class SqliteCityCatalogStore implements CityCatalogStorePort {
  private readonly integrity: IntegrityView;

  constructor(
    private readonly database: Database.Database,
    integrity: EvidenceIntegrity,
  ) {
    this.integrity = integrityView(integrity);
  }

  appendVerified(input: CityCatalogProjection): VerifiedCityCatalogBundle {
    try {
      const verified = this.reconstruct(input);
      if (verified.catalog.rulesVersion !== CITY_CATALOG_RULES_VERSION) {
        throw new Error("city_catalog_upgrade_required");
      }
      const append = this.database.transaction(() => {
        const existing = this.findRow(verified.catalog.id);
        if (existing !== undefined) {
          const loaded = this.verifyRow(existing);
          if (this.integrity.canonical(loaded) !== this.integrity.canonical(verified)) mismatch();
          return loaded;
        }
        const payload = this.integrity.canonical(verified);
        try {
          this.database.prepare(`
            INSERT INTO city_catalog_revisions (
              id, registry_revision_id, country_code, package_id, package_schema_version,
              registry_evidence_snapshot_id, catalog_evidence_snapshot_id, rules_version,
              created_at, payload_json, payload_hash, hmac
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            verified.catalog.id,
            verified.registry.id,
            verified.catalog.countryCode,
            verified.catalog.packageId,
            verified.catalog.packageSchemaVersion,
            verified.registry.evidenceSnapshotId,
            verified.catalog.evidenceSnapshotId,
            verified.catalog.rulesVersion,
            verified.catalog.createdAt,
            payload,
            this.integrity.hash(payload),
            this.integrity.sign(payload),
          );
        } catch (error) {
          if (!constraint(error)) throw error;
          const collided = this.findRow(verified.catalog.id);
          if (collided === undefined) mismatch();
          const loaded = this.verifyRow(collided);
          if (this.integrity.canonical(loaded) !== payload) mismatch();
          return loaded;
        }
        return this.loadVerified(verified.catalog.id);
      });
      return append.immediate();
    } catch (error) {
      normalize(error);
    }
  }

  loadVerified(id: string): VerifiedCityCatalogBundle {
    try {
      const row = this.findRow(identifier(id));
      if (row === undefined) throw new Error("city_catalog_not_found");
      return this.verifyRow(row);
    } catch (error) {
      normalize(error);
    }
  }

  private reconstruct(value: CityCatalogProjection): VerifiedCityCatalogBundle {
    const verified = reconstructVerifiedCityCatalog(value, this.integrity);
    if (verified.registry.evidenceSnapshotId !== verified.catalog.evidenceSnapshotId) mismatch();
    return verified;
  }

  private findRow(id: string): CatalogRow | undefined {
    return this.database.prepare(`
      SELECT id, registry_revision_id, country_code, package_id, package_schema_version,
             registry_evidence_snapshot_id, catalog_evidence_snapshot_id, rules_version,
             created_at, payload_json, payload_hash, hmac
      FROM city_catalog_revisions WHERE id = ?
    `).get(id) as CatalogRow | undefined;
  }

  private verifyRow(row: CatalogRow): VerifiedCityCatalogBundle {
    if (!secureHexEqual(row.payload_hash, this.integrity.hash(row.payload_json)) ||
      !secureHexEqual(row.hmac, this.integrity.sign(row.payload_json))) mismatch();
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.payload_json) as unknown;
    } catch {
      mismatch();
    }
    const verified = this.reconstruct(parsed as CityCatalogProjection);
    if (this.integrity.canonical(verified) !== row.payload_json ||
      row.id !== verified.catalog.id || row.registry_revision_id !== verified.registry.id ||
      row.country_code !== verified.catalog.countryCode || row.package_id !== verified.catalog.packageId ||
      row.package_schema_version !== verified.catalog.packageSchemaVersion ||
      row.registry_evidence_snapshot_id !== verified.registry.evidenceSnapshotId ||
      row.catalog_evidence_snapshot_id !== verified.catalog.evidenceSnapshotId ||
      row.registry_evidence_snapshot_id !== row.catalog_evidence_snapshot_id ||
      row.rules_version !== verified.catalog.rulesVersion || row.created_at !== verified.catalog.createdAt) {
      mismatch();
    }
    return verified;
  }
}
