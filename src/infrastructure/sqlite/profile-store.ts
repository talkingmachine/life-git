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

interface TypedProfileSnapshot {
  readonly schemaVersion: string;
  readonly id: string;
  readonly confirmedAt: string;
}

type ReconfirmSnapshot<T extends TypedProfileSnapshot> = (snapshot: T) => T;

function integrityMismatch(): never {
  throw new Error("integrity_mismatch");
}

function reconfirmTypedSnapshot<T extends TypedProfileSnapshot>(
  snapshot: T,
  schemaVersion: T["schemaVersion"],
  reconfirm: ReconfirmSnapshot<T>,
): T {
  let confirmed: T;
  try {
    if (snapshot.schemaVersion !== schemaVersion) integrityMismatch();
    confirmed = reconfirm(snapshot);
  } catch {
    integrityMismatch();
  }
  if (
    confirmed.id !== snapshot.id ||
    canonicalJson(confirmed) !== canonicalJson(snapshot)
  ) {
    integrityMismatch();
  }
  return confirmed;
}

function appendTypedSnapshot<T extends TypedProfileSnapshot>(
  database: Database.Database,
  snapshot: T,
  schemaVersion: T["schemaVersion"],
  reconfirm: ReconfirmSnapshot<T>,
): void {
  reconfirmTypedSnapshot(snapshot, schemaVersion, reconfirm);
  const snapshotJson = canonicalJson(snapshot);
  database.prepare(`
    INSERT INTO profile_snapshots (id, confirmed_at, snapshot_json, snapshot_hash)
    VALUES (?, ?, ?, ?)
  `).run(snapshot.id, snapshot.confirmedAt, snapshotJson, sha256Text(snapshotJson));
}

function loadTypedSnapshot<T extends TypedProfileSnapshot>(
  database: Database.Database,
  id: string,
  schemaVersion: T["schemaVersion"],
  reconfirm: ReconfirmSnapshot<T>,
): T {
  const row = database.prepare(`
    SELECT id, confirmed_at, snapshot_json, snapshot_hash
    FROM profile_snapshots WHERE id = ?
  `).get(id) as ProfileRow | undefined;
  if (row === undefined) throw new Error("profile_not_found");

  let snapshot: T;
  try {
    const parsed: unknown = JSON.parse(row.snapshot_json);
    if (
      typeof parsed !== "object" || parsed === null ||
      (parsed as { readonly schemaVersion?: unknown }).schemaVersion !== schemaVersion
    ) {
      integrityMismatch();
    }
    snapshot = parsed as T;
  } catch {
    integrityMismatch();
  }
  const confirmed = reconfirmTypedSnapshot(snapshot, schemaVersion, reconfirm);
  if (
    row.id !== id || snapshot.id !== id ||
    row.confirmed_at !== snapshot.confirmedAt ||
    row.snapshot_json !== canonicalJson(snapshot) ||
    !secureHexEqual(row.snapshot_hash, sha256Text(row.snapshot_json))
  ) {
    integrityMismatch();
  }
  return confirmed;
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
    appendTypedSnapshot(
      this.database,
      snapshot,
      "relocation-profile@1",
      (stored) => confirmRelocationProfile(
        stored.profile,
        () => new Date(stored.confirmedAt),
      ),
    );
  }

  async loadRelocationVerified(id: string): Promise<RelocationProfileSnapshot> {
    return loadTypedSnapshot(
      this.database,
      id,
      "relocation-profile@1",
      (stored) => confirmRelocationProfile(
        stored.profile,
        () => new Date(stored.confirmedAt),
      ),
    );
  }

  async appendPreference(snapshot: PreferenceProfileSnapshot): Promise<void> {
    appendTypedSnapshot(
      this.database,
      snapshot,
      "preference-profile@1",
      (stored) => confirmPreferenceProfile(
        { criteria: stored.criteria },
        () => new Date(stored.confirmedAt),
      ),
    );
  }

  async loadPreferenceVerified(id: string): Promise<PreferenceProfileSnapshot> {
    return loadTypedSnapshot(
      this.database,
      id,
      "preference-profile@1",
      (stored) => confirmPreferenceProfile(
        { criteria: stored.criteria },
        () => new Date(stored.confirmedAt),
      ),
    );
  }
}
