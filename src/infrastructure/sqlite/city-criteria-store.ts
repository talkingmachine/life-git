import type Database from "better-sqlite3";

import type { CityCriteriaReadPort } from "../../application/city-frontier-contracts";
import {
  reconstructCityCriteriaSnapshot,
  type CityCriteriaSnapshot,
} from "../../decision/city-criteria";
import type { EvidenceIntegrity } from "../../research/research-plan";
import {
  createCityDecisionIntegrityView,
  secureHexEqual,
} from "../integrity";

interface CriteriaRow {
  readonly id: string;
  readonly profile_snapshot_id: string;
  readonly preference_profile_snapshot_id: string;
  readonly schema_version: string;
  readonly rules_version: string;
  readonly confirmed_at: string;
  readonly payload_json: string;
  readonly payload_hash: string;
  readonly hmac: string;
}

const LOWERCASE_DIGEST = /^[0-9a-f]{64}$/;

function mismatch(): never {
  throw new Error("integrity_mismatch");
}

export class SqliteCityCriteriaStore implements CityCriteriaReadPort {
  constructor(
    private readonly database: Database.Database,
    private readonly integrity: EvidenceIntegrity,
  ) {}

  loadCriteriaVerified(id: string): CityCriteriaSnapshot {
    const row = this.database.prepare(`
      SELECT id, profile_snapshot_id, preference_profile_snapshot_id,
             schema_version, rules_version, confirmed_at, payload_json,
             payload_hash, hmac
      FROM city_criteria_snapshots WHERE id = ?
    `).get(id) as CriteriaRow | undefined;
    if (row === undefined) throw new Error("city_criteria_not_found");

    try {
      if (!LOWERCASE_DIGEST.test(row.payload_hash) ||
        !LOWERCASE_DIGEST.test(row.hmac)) {
        mismatch();
      }
      const value = JSON.parse(row.payload_json) as unknown;
      const canonical = this.integrity.canonical(value);
      if (canonical !== row.payload_json ||
        !secureHexEqual(this.integrity.hash(row.payload_json), row.payload_hash) ||
        !secureHexEqual(this.integrity.sign(row.payload_json), row.hmac)) {
        mismatch();
      }
      const snapshot = reconstructCityCriteriaSnapshot(
        value,
        createCityDecisionIntegrityView(this.integrity),
      );
      if (row.id !== snapshot.id ||
        row.profile_snapshot_id !== snapshot.profileSnapshotId ||
        row.preference_profile_snapshot_id !== snapshot.preferenceProfileSnapshotId ||
        row.schema_version !== snapshot.schemaVersion ||
        row.rules_version !== snapshot.rulesVersion ||
        row.confirmed_at !== snapshot.confirmedAt) {
        mismatch();
      }
      return snapshot;
    } catch {
      throw new Error("integrity_mismatch");
    }
  }
}
