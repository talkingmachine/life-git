import { createHash } from "node:crypto";

import { describe, expect, test } from "vitest";

import {
  confirmPreferenceProfile,
  type PreferenceProfileSnapshot,
} from "../../src/decision/preference-profile";
import {
  confirmRelocationProfile,
  type RelocationProfileSnapshot,
} from "../../src/decision/relocation-profile";
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
});
