import type Database from "better-sqlite3";

import {
  confirmPreferenceProfile,
  type PreferenceProfileSnapshot,
} from "../../decision/preference-profile";
import { confirmProfile } from "../../decision/profile";
import {
  confirmRelocationProfile,
  type RelocationProfileSnapshot,
} from "../../decision/relocation-profile";
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

  async appendRelocation(snapshot: RelocationProfileSnapshot): Promise<void> {
    let confirmed: RelocationProfileSnapshot;
    try {
      confirmed = confirmRelocationProfile(
        snapshot.profile,
        () => new Date(snapshot.confirmedAt),
      );
    } catch {
      integrityMismatch();
    }
    if (
      snapshot.schemaVersion !== "relocation-profile@1" ||
      confirmed.id !== snapshot.id ||
      canonicalJson(confirmed) !== canonicalJson(snapshot)
    ) {
      integrityMismatch();
    }
    const snapshotJson = canonicalJson(snapshot);
    this.database.prepare(`
      INSERT INTO profile_snapshots (id, confirmed_at, snapshot_json, snapshot_hash)
      VALUES (?, ?, ?, ?)
    `).run(snapshot.id, snapshot.confirmedAt, snapshotJson, sha256Text(snapshotJson));
  }

  async loadRelocationVerified(id: string): Promise<RelocationProfileSnapshot> {
    const row = this.database.prepare(`
      SELECT id, confirmed_at, snapshot_json, snapshot_hash
      FROM profile_snapshots WHERE id = ?
    `).get(id) as ProfileRow | undefined;
    if (row === undefined) throw new Error("profile_not_found");

    let snapshot: RelocationProfileSnapshot;
    let confirmed: RelocationProfileSnapshot;
    try {
      const parsed: unknown = JSON.parse(row.snapshot_json);
      if (
        typeof parsed !== "object" || parsed === null ||
        (parsed as { readonly schemaVersion?: unknown }).schemaVersion !==
          "relocation-profile@1"
      ) {
        integrityMismatch();
      }
      snapshot = parsed as RelocationProfileSnapshot;
      confirmed = confirmRelocationProfile(
        snapshot.profile,
        () => new Date(snapshot.confirmedAt),
      );
    } catch {
      integrityMismatch();
    }
    if (
      row.id !== id || snapshot.id !== id ||
      row.confirmed_at !== snapshot.confirmedAt ||
      row.snapshot_json !== canonicalJson(snapshot) ||
      !secureHexEqual(row.snapshot_hash, sha256Text(row.snapshot_json)) ||
      canonicalJson(confirmed) !== canonicalJson(snapshot)
    ) {
      integrityMismatch();
    }
    return confirmed;
  }

  async appendPreference(snapshot: PreferenceProfileSnapshot): Promise<void> {
    let confirmed: PreferenceProfileSnapshot;
    try {
      if (snapshot.schemaVersion !== "preference-profile@1") integrityMismatch();
      confirmed = confirmPreferenceProfile(
        { criteria: snapshot.criteria },
        () => new Date(snapshot.confirmedAt),
      );
    } catch {
      integrityMismatch();
    }
    if (
      confirmed.id !== snapshot.id ||
      canonicalJson(confirmed) !== canonicalJson(snapshot)
    ) {
      integrityMismatch();
    }
    const snapshotJson = canonicalJson(snapshot);
    this.database.prepare(`
      INSERT INTO profile_snapshots (id, confirmed_at, snapshot_json, snapshot_hash)
      VALUES (?, ?, ?, ?)
    `).run(snapshot.id, snapshot.confirmedAt, snapshotJson, sha256Text(snapshotJson));
  }

  async loadPreferenceVerified(id: string): Promise<PreferenceProfileSnapshot> {
    const row = this.database.prepare(`
      SELECT id, confirmed_at, snapshot_json, snapshot_hash
      FROM profile_snapshots WHERE id = ?
    `).get(id) as ProfileRow | undefined;
    if (row === undefined) throw new Error("profile_not_found");

    let snapshot: PreferenceProfileSnapshot;
    let confirmed: PreferenceProfileSnapshot;
    try {
      const parsed: unknown = JSON.parse(row.snapshot_json);
      if (
        typeof parsed !== "object" || parsed === null ||
        (parsed as { readonly schemaVersion?: unknown }).schemaVersion !==
          "preference-profile@1"
      ) {
        integrityMismatch();
      }
      snapshot = parsed as PreferenceProfileSnapshot;
      confirmed = confirmPreferenceProfile(
        { criteria: snapshot.criteria },
        () => new Date(snapshot.confirmedAt),
      );
    } catch {
      integrityMismatch();
    }
    if (
      row.id !== id || snapshot.id !== id ||
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
