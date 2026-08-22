import { createHash } from "node:crypto";

import { describe, expect, test } from "vitest";

import {
  confirmPreferenceProfile,
  materializePreferenceProfileV2,
  type PreferenceProfileSnapshot,
  type PreferenceProfileV2Snapshot,
} from "../../src/decision/preference-profile";
import {
  confirmRelocationProfile,
  materializeRelocationProfileV2,
  type RelocationProfileSnapshot,
  type RelocationProfileV2Snapshot,
} from "../../src/decision/relocation-profile";
import { canonicalJson, sha256Text } from "../../src/infrastructure/integrity";
import { openEvidenceDatabase } from "../../src/infrastructure/sqlite/db";
import { SqliteProfileStore } from "../../src/infrastructure/sqlite/profile-store";

interface SnapshotFixture {
  readonly snapshot: RelocationProfileSnapshot | PreferenceProfileSnapshot;
  append(store: SqliteProfileStore): Promise<void>;
  load(store: SqliteProfileStore): Promise<unknown>;
}

function snapshotFixture(kind: "relocation" | "preference"): SnapshotFixture {
  if (kind === "relocation") {
    const snapshot = confirmRelocationProfile({
      currentCountryCode: "RU",
      citizenships: ["RU"],
      monthlyIncome: { amount: "210000.00", currency: "RUB", basis: "net" },
      remoteWork: { relation: "foreign_employment", legallyAllowed: true },
      education: "none",
      relevantExperienceYears: 6,
      passportValidUntil: "2029-11-30",
      healthInsurance: "confirmed",
      companions: [
        { relationship: "minor_child" },
        { relationship: "spouse" },
        { relationship: "minor_child" },
      ],
    }, () => new Date("2026-08-11T09:15:00.000Z"));
    return {
      snapshot,
      append: (store) => store.appendRelocation(snapshot),
      load: (store) => store.loadRelocationVerified(snapshot.id),
    };
  }

  const snapshot = confirmPreferenceProfile({
    criteria: [{
      id: "personal_safety",
      mode: "weighted",
      importance: 5,
      target: "maximize",
    }],
  }, () => new Date("2026-08-12T08:00:00.000Z"));
  return {
    snapshot,
    append: (store) => store.appendPreference(snapshot),
    load: (store) => store.loadPreferenceVerified(snapshot.id),
  };
}

function v2Snapshots(): {
  readonly profile: RelocationProfileV2Snapshot;
  readonly preferences: PreferenceProfileV2Snapshot;
} {
  const confirmedAt = "2026-08-22T10:00:00.000Z";
  return {
    profile: materializeRelocationProfileV2({
      confirmedAt,
      profile: {
        schemaVersion: "relocation-profile@2",
        profile: {
          currentLocation: { countryCode: "RU", city: "Moscow" },
          moveHorizon: "within_3_months",
          movingParty: "alone",
          participants: [{
            participantId: "00000000-0000-4000-8000-000000000001",
            relationship: "self",
            citizenships: ["RU"],
            passport: "absent",
            currentWork: { applicability: "required", value: { status: "not_working" } },
            remoteContinuation: { applicability: "not_applicable" },
            monthlyIncome: {
              applicability: "required",
              value: { amount: "0", currency: "RUB", basis: "net" },
            },
            education: { applicability: "required", value: { level: "none" } },
            relevantExperienceYears: { applicability: "required", value: 0 },
          }],
          savings: { min: "0", max: "10000", currency: "EUR" },
        },
      },
    }),
    preferences: materializePreferenceProfileV2({
      confirmedAt,
      preferences: {
        schemaVersion: "preference-profile@2",
        countryCriteria: [
          { id: "outside_cis", mode: "required", importance: 5, target: "required_true" },
          { id: "europe", mode: "weighted", importance: 4, target: "maximize" },
          { id: "personal_safety", mode: "weighted", importance: 5, target: "maximize" },
          { id: "infrastructure", mode: "weighted", importance: 3, target: "maximize" },
          { id: "peace_and_stability", mode: "required", importance: 5, target: "required_true" },
        ],
        cityCriteria: [
          { id: "safety", mode: "required", importance: 5, target: "low crime" },
          { id: "long_term_rent", mode: "weighted", importance: 4, target: "under 1200 EUR" },
          { id: "urban_transit", mode: "weighted", importance: 3, target: "frequent" },
          { id: "fixed_broadband", mode: "weighted", importance: 2, target: "500 Mbps" },
        ],
      },
    }),
  };
}

function seedSnapshot(
  database: ReturnType<typeof openEvidenceDatabase>,
  snapshot: RelocationProfileV2Snapshot | PreferenceProfileV2Snapshot,
): void {
  const snapshotJson = canonicalJson(snapshot);
  database.prepare(`
    INSERT INTO profile_snapshots (id, confirmed_at, snapshot_json, snapshot_hash)
    VALUES (?, ?, ?, ?)
  `).run(snapshot.id, snapshot.confirmedAt, snapshotJson, sha256Text(snapshotJson));
}

describe("typed profile snapshot persistence", () => {
  test("preserves the established relocation snapshot bytes", async () => {
    const database = openEvidenceDatabase(":memory:");
    const store = new SqliteProfileStore(database);
    const fixture = snapshotFixture("relocation");

    await fixture.append(store);

    expect(database.prepare(
      "SELECT snapshot_json FROM profile_snapshots WHERE id = ?",
    ).pluck().get(fixture.snapshot.id)).toBe(
      "{\"confirmedAt\":\"2026-08-11T09:15:00.000Z\",\"id\":\"006f978ccb642469af54b2241b31f794c85123c211970fd4dac12c559fb6227e\",\"profile\":{\"citizenships\":[\"RU\"],\"companions\":[{\"relationship\":\"spouse\"},{\"relationship\":\"minor_child\"},{\"relationship\":\"minor_child\"}],\"currentCountryCode\":\"RU\",\"education\":\"none\",\"healthInsurance\":\"confirmed\",\"monthlyIncome\":{\"amount\":\"210000\",\"basis\":\"net\",\"currency\":\"RUB\"},\"passportValidUntil\":\"2029-11-30\",\"relevantExperienceYears\":6,\"remoteWork\":{\"legallyAllowed\":true,\"relation\":\"foreign_employment\"}},\"schemaVersion\":\"relocation-profile@1\"}",
    );
    expect(await fixture.load(store)).toEqual(fixture.snapshot);
    database.close();
  });

  test("preserves the established preference snapshot bytes", async () => {
    // Break caught: changing canonical @1 persistence while adding @2 readers.
    const database = openEvidenceDatabase(":memory:");
    const store = new SqliteProfileStore(database);
    const fixture = snapshotFixture("preference");

    await fixture.append(store);

    expect(database.prepare(
      "SELECT snapshot_json FROM profile_snapshots WHERE id = ?",
    ).pluck().get(fixture.snapshot.id)).toBe(
      "{\"confirmedAt\":\"2026-08-12T08:00:00.000Z\",\"criteria\":[{\"id\":\"personal_safety\",\"importance\":5,\"mode\":\"weighted\",\"target\":\"maximize\"}],\"id\":\"4495e1fa18884893233042ff7be75e01be2223219a114bb2bff4d61fa21af239\",\"schemaVersion\":\"preference-profile@1\"}",
    );
    expect(await fixture.load(store)).toEqual(fixture.snapshot);
    database.close();
  });

  test.each(["relocation", "preference"] as const)(
    "rejects corrupt hash and non-canonical bytes for %s snapshots",
    async (kind) => {
      const database = openEvidenceDatabase(":memory:");
      const store = new SqliteProfileStore(database);
      const fixture = snapshotFixture(kind);
      await fixture.append(store);
      expect(await fixture.load(store)).toEqual(fixture.snapshot);

      database.exec("DROP TRIGGER profile_snapshots_no_update");
      database.prepare(
        "UPDATE profile_snapshots SET snapshot_hash = ? WHERE id = ?",
      ).run("0".repeat(64), fixture.snapshot.id);
      await expect(fixture.load(store)).rejects.toThrow("integrity_mismatch");

      const parsed = JSON.parse(database.prepare(
        "SELECT snapshot_json FROM profile_snapshots WHERE id = ?",
      ).pluck().get(fixture.snapshot.id) as string) as Record<string, unknown>;
      const nonCanonicalJson = JSON.stringify(Object.fromEntries(
        Object.entries(parsed).reverse(),
      ));
      const matchingHash = createHash("sha256").update(nonCanonicalJson).digest("hex");
      database.prepare(`
        UPDATE profile_snapshots SET snapshot_json = ?, snapshot_hash = ? WHERE id = ?
      `).run(nonCanonicalJson, matchingHash, fixture.snapshot.id);

      await expect(fixture.load(store)).rejects.toThrow("integrity_mismatch");
      database.close();
    },
  );

  test("loads exact @2 snapshots through V2-only readers as fresh frozen values", async () => {
    // Break caught: widening the historical @1 methods or failing to reconstruct persisted @2 bytes.
    const database = openEvidenceDatabase(":memory:");
    const store = new SqliteProfileStore(database);
    const snapshots = v2Snapshots();
    seedSnapshot(database, snapshots.profile);
    seedSnapshot(database, snapshots.preferences);

    const profile = await store.loadRelocationV2Verified(snapshots.profile.id);
    const preferences = await store.loadPreferenceV2Verified(snapshots.preferences.id);

    expect(profile).toEqual(snapshots.profile);
    expect(preferences).toEqual(snapshots.preferences);
    expect(profile).not.toBe(snapshots.profile);
    expect(preferences).not.toBe(snapshots.preferences);
    expect(Object.isFrozen(profile.profile.participants[0]?.monthlyIncome)).toBe(true);
    expect(Object.isFrozen(preferences.cityCriteria[0])).toBe(true);
    await expect(store.loadRelocationVerified(snapshots.profile.id))
      .rejects.toThrow("integrity_mismatch");
    await expect(store.loadPreferenceVerified(snapshots.preferences.id))
      .rejects.toThrow("integrity_mismatch");
    database.close();
  });

  test("ranking preference reads accept exactly @1 or @2 while dedicated loaders stay closed", async () => {
    // Break caught: an open-ended ranking loader or accidental widening of a version-specific reader.
    const database = openEvidenceDatabase(":memory:");
    const store = new SqliteProfileStore(database);
    const v1 = snapshotFixture("preference").snapshot as PreferenceProfileSnapshot;
    const v2 = v2Snapshots().preferences;
    const v1Json = canonicalJson(v1);
    database.prepare(`
      INSERT INTO profile_snapshots (id, confirmed_at, snapshot_json, snapshot_hash)
      VALUES (?, ?, ?, ?)
    `).run(v1.id, v1.confirmedAt, v1Json, sha256Text(v1Json));
    seedSnapshot(database, v2);

    await expect(store.loadPreferenceForRankingVerified(v1.id)).resolves.toEqual(v1);
    await expect(store.loadPreferenceForRankingVerified(v2.id)).resolves.toEqual(v2);
    await expect(store.loadPreferenceV2Verified(v1.id)).rejects.toThrow("integrity_mismatch");

    const invalid = { ...v2, schemaVersion: "preference-profile@3" };
    const invalidJson = canonicalJson(invalid);
    database.prepare(`
      INSERT INTO profile_snapshots (id, confirmed_at, snapshot_json, snapshot_hash)
      VALUES (?, ?, ?, ?)
    `).run("f".repeat(64), v2.confirmedAt, invalidJson, sha256Text(invalidJson));
    await expect(store.loadPreferenceForRankingVerified("f".repeat(64)))
      .rejects.toThrow("integrity_mismatch");
    database.close();
  });
});
