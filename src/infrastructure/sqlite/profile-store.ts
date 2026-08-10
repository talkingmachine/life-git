import type Database from "better-sqlite3";

import { confirmProfile } from "../../decision/profile";
import type { ProfileSnapshot } from "../../research/contracts";
import { canonicalJson, secureHexEqual, sha256Text } from "../integrity";

interface ProfileRow {
  readonly id: string;
  readonly confirmed_at: string;
  readonly snapshot_json: string;
  readonly snapshot_hash: string;
}

function integrityMismatch(): never {
  throw new Error("integrity_mismatch");
}

export class SqliteProfileStore {
  constructor(private readonly database: Database.Database) {}

  async append(snapshot: ProfileSnapshot): Promise<void> {
    const confirmed = confirmProfile(snapshot.profile, () => new Date(snapshot.confirmedAt));
    if (confirmed.id !== snapshot.id || canonicalJson(confirmed) !== canonicalJson(snapshot)) {
      integrityMismatch();
    }
    const snapshotJson = canonicalJson(snapshot);
    this.database.prepare(`
      INSERT INTO profile_snapshots (id, confirmed_at, snapshot_json, snapshot_hash)
      VALUES (?, ?, ?, ?)
    `).run(snapshot.id, snapshot.confirmedAt, snapshotJson, sha256Text(snapshotJson));
  }

  async loadVerified(id: string): Promise<ProfileSnapshot> {
    const row = this.database.prepare(`
      SELECT id, confirmed_at, snapshot_json, snapshot_hash
      FROM profile_snapshots WHERE id = ?
    `).get(id) as ProfileRow | undefined;
    if (row === undefined) throw new Error("profile_not_found");

    let snapshot: ProfileSnapshot;
    try {
      snapshot = JSON.parse(row.snapshot_json) as ProfileSnapshot;
    } catch {
      integrityMismatch();
    }
    const confirmed = confirmProfile(snapshot.profile, () => new Date(snapshot.confirmedAt));
    if (
      row.id !== id ||
      snapshot.id !== id ||
      row.confirmed_at !== snapshot.confirmedAt ||
      row.snapshot_json !== canonicalJson(snapshot) ||
      !secureHexEqual(row.snapshot_hash, sha256Text(row.snapshot_json)) ||
      canonicalJson(confirmed) !== canonicalJson(snapshot)
    ) {
      integrityMismatch();
    }
    return confirmed;
  }
}
