import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Worker } from "node:worker_threads";

import Database from "better-sqlite3";
import { afterEach, describe, expect, test, vi } from "vitest";

import type { OnboardingModelVersions } from "../../src/application/onboarding-contracts";
import {
  ONBOARDING_MODEL_VERSIONS_V1,
  ONBOARDING_MODEL_VERSIONS_V2,
  ONBOARDING_MODEL_VERSIONS_V3,
  ONBOARDING_MODEL_VERSIONS_V4,
  ONBOARDING_MODEL_VERSIONS_V5,
} from "../../src/application/onboarding-model-versions";
import { CITY_PREFERENCE_IDS, COUNTRY_PREFERENCE_IDS } from
  "../../src/decision/onboarding-catalog";
import {
  applyQuestionnaireFieldChange,
  confirmOnboardingValues,
  createOnboardingDraft,
  materializeOnboardingSnapshots,
  type ConfirmedOnboardingValues,
  type OnboardingDraft,
  type OnboardingFieldId,
} from "../../src/decision/onboarding-questionnaire";
import { canonicalJson, hmacSha256, sha256Text } from "../../src/infrastructure/integrity";
import { openEvidenceDatabase } from "../../src/infrastructure/sqlite/db";
import { SqliteOnboardingStore } from "../../src/infrastructure/sqlite/onboarding-store";

const SELF_ID = "00000000-0000-4000-8000-000000000001";
const COMMAND_1 = "00000000-0000-4000-8000-000000000010";
const COMMAND_2 = "00000000-0000-4000-8000-000000000011";
const COMMAND_3 = "00000000-0000-4000-8000-000000000012";
const NOW = "2026-08-22T10:00:00.000Z";
const HMAC_KEY = "onboarding-test-key";
const VERSIONS: OnboardingModelVersions = ONBOARDING_MODEL_VERSIONS_V1;
const V1_VERSIONS_JSON =
  '{"cliVersion":"codex-cli 0.148.0-alpha.15","extractionPrompt":"onboarding-extract@1",' +
  '"extractionSchema":"onboarding-model-output@1","invocation":"codex-cli-invocation@1",' +
  '"reviewPrompt":"onboarding-review@1","reviewSchema":"onboarding-review-output@1"}';
const V2_VERSIONS_JSON =
  '{"cliVersion":"codex-cli 0.148.0-alpha.15","extractionPrompt":"onboarding-extract@2",' +
  '"extractionSchema":"onboarding-extraction-wire@2","invocation":"codex-cli-invocation@1",' +
  '"reviewPrompt":"onboarding-review@1","reviewSchema":"onboarding-review-output@1"}';
const V3_VERSIONS_JSON =
  '{"cliVersion":"codex-cli 0.148.0-alpha.15","extractionPrompt":"onboarding-extract@3",' +
  '"extractionSchema":"onboarding-extraction-wire@2","invocation":"codex-cli-invocation@1",' +
  '"reviewPrompt":"onboarding-review@1","reviewSchema":"onboarding-review-output@1"}';
const V4_VERSIONS_JSON =
  '{"cliVersion":"codex-cli-0.149.0-alpha.4-plus@1","extractionPrompt":"onboarding-extract@4",' +
  '"extractionSchema":"onboarding-extraction-wire@2","invocation":"codex-cli-invocation@2",' +
  '"reviewPrompt":"onboarding-review@2","reviewSchema":"onboarding-review-output@1"}';
const V5_VERSIONS_JSON =
  '{"cliVersion":"codex-cli-0.149.0-alpha.4-plus@1","extractionPrompt":"onboarding-extract@5",' +
  '"extractionSchema":"onboarding-extraction-wire@2","invocation":"codex-cli-invocation@2",' +
  '"reviewPrompt":"onboarding-review@2","reviewSchema":"onboarding-review-output@1"}';
const V1_CONFIRMATION_DIGEST =
  "f1714bd3354b4a05f2f6ebee7ad6d28d2fd1d6f1702aa21d7856fa3e15e5ff32";
const V2_CONFIRMATION_DIGEST =
  "55e1bcc2b73c1f7b09dcf46f7be2065b957eb494eebd5a3b1dae61a2887485df";
const V3_CONFIRMATION_DIGEST =
  "b7bccce0fbec4090df4296afb3ef2d4fcefe1df6e8e1012efe0870873063e525";
const V4_CONFIRMATION_DIGEST =
  "ae493ed941ffcf8ff40d24faee1257d976cc4a3bcdfd7e6ffa5f471cf618a300";
const V5_CONFIRMATION_DIGEST =
  "38f273ef80ef283c828824c1dbca79e7c5f716eeb897f4ebe593f580fc1c2681";

const databases: Database.Database[] = [];
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) {
    if (database.open) database.close();
  }
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function track(database: Database.Database): Database.Database {
  databases.push(database);
  return database;
}

function temporaryDatabasePath(prefix = "onboarding-store-"): string {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return join(directory, "onboarding.sqlite");
}

function manual(
  draft: OnboardingDraft,
  fieldId: OnboardingFieldId,
  rawInput: unknown,
): OnboardingDraft {
  return applyQuestionnaireFieldChange(draft, { kind: "manual_set", fieldId, rawInput });
}

function confirmedValues(city = "Moscow"): ConfirmedOnboardingValues {
  let draft = createOnboardingDraft(() => SELF_ID);
  draft = manual(draft, "current_location", { countryCode: "RU", city });
  draft = manual(draft, "move_horizon", "within_3_months");
  draft = manual(draft, "moving_party", "alone");
  draft = manual(draft, "savings", { min: "0", max: "10000", currency: "EUR" });
  draft = manual(draft, `participants.${SELF_ID}.citizenships`, ["RU"]);
  draft = manual(draft, `participants.${SELF_ID}.passport`, "absent");
  draft = manual(draft, `participants.${SELF_ID}.current_work`, { status: "not_working" });
  draft = manual(draft, `participants.${SELF_ID}.monthly_income`, {
    amount: "0",
    currency: "RUB",
    basis: "net",
  });
  draft = manual(draft, `participants.${SELF_ID}.education`, { level: "none" });
  draft = manual(draft, `participants.${SELF_ID}.relevant_experience_years`, 0);
  for (const criterionId of COUNTRY_PREFERENCE_IDS) {
    draft = manual(draft, `country_preferences.${criterionId}.mode`, "required");
    draft = manual(draft, `country_preferences.${criterionId}.importance`, 3);
    draft = manual(draft, `country_preferences.${criterionId}.target`, "required_true");
  }
  for (const criterionId of CITY_PREFERENCE_IDS) {
    draft = manual(draft, `city_preferences.${criterionId}.mode`, "weighted");
    draft = manual(draft, `city_preferences.${criterionId}.importance`, 3);
    draft = manual(draft, `city_preferences.${criterionId}.target`, `${criterionId}-target`);
  }
  return confirmOnboardingValues(draft);
}

function receiptId(completionCommandId: string): string {
  return `onboarding-receipt:${sha256Text(canonicalJson({
    schemaVersion: "onboarding-receipt-id@1",
    completionCommandId,
  }))}`;
}

function frontierRunId(completionCommandId: string): string {
  return `onboarding-frontier:${sha256Text(canonicalJson({
    schemaVersion: "onboarding-frontier-run-id@1",
    completionCommandId,
  }))}`;
}

function createStore(
  database: Database.Database,
  overrides: {
    readonly clock?: () => Date;
    readonly materialize?: typeof materializeOnboardingSnapshots;
  } = {},
): SqliteOnboardingStore {
  return new SqliteOnboardingStore(database, HMAC_KEY, {
    clock: overrides.clock ?? (() => new Date(NOW)),
    materialize: overrides.materialize ?? materializeOnboardingSnapshots,
  });
}

async function commit(
  store: SqliteOnboardingStore,
  completionCommandId = COMMAND_1,
  confirmed = confirmedValues(),
  versions: OnboardingModelVersions = VERSIONS,
) {
  return store.commitOrReplay({ completionCommandId, confirmed, versions });
}

async function replay(
  store: SqliteOnboardingStore,
  completionCommandId = COMMAND_1,
  confirmed = confirmedValues(),
  versions: OnboardingModelVersions = VERSIONS,
) {
  return store.replayCommitted({ completionCommandId, confirmed, versions });
}

describe("SQLite onboarding confirmation persistence", () => {
  test("atomically writes exact content IDs, domain-separated IDs, full HMAC, and verified pair", async () => {
    // Break caught: omitting any part of the durable confirmation binding or duplicating issuance work.
    const database = track(openEvidenceDatabase(":memory:"));
    const clock = vi.fn(() => new Date(NOW));
    const materialize = vi.fn(materializeOnboardingSnapshots);
    const store = createStore(database, { clock, materialize });
    const confirmed = confirmedValues();

    const receipt = await commit(store, COMMAND_1, confirmed);
    const verified = await store.loadBySnapshotBindingsVerified({
      profileId: receipt.profileId,
      preferenceProfileId: receipt.preferenceProfileId,
    });
    const snapshots = materializeOnboardingSnapshots({ confirmedAt: NOW, values: confirmed });
    const unsignedReceipt = {
      schemaVersion: "onboarding-receipt@1" as const,
      receiptId: receiptId(COMMAND_1),
      completionCommandId: COMMAND_1,
      profileId: snapshots.profile.id,
      preferenceProfileId: snapshots.preferences.id,
      frontierRunId: frontierRunId(COMMAND_1),
      confirmedAt: NOW,
    };
    const expectedDigest = hmacSha256(canonicalJson({
      schemaVersion: "onboarding-confirmation-binding@1",
      receipt: unsignedReceipt,
      profile: snapshots.profile,
      preferences: snapshots.preferences,
      provenance: confirmed.provenance,
      versions: VERSIONS,
    }), HMAC_KEY);

    expect(receipt).toEqual({ ...unsignedReceipt, confirmationDigest: expectedDigest });
    expect(receipt.confirmationDigest).toBe(V1_CONFIRMATION_DIGEST);
    expect(verified).toEqual({
      receipt,
      profile: snapshots.profile,
      preferences: snapshots.preferences,
      provenance: confirmed.provenance,
      versions: VERSIONS,
    });
    expect(clock).toHaveBeenCalledTimes(1);
    expect(materialize).toHaveBeenCalledTimes(1);
    expect(database.prepare("SELECT COUNT(*) AS count FROM profile_snapshots").get())
      .toEqual({ count: 2 });
    expect(database.prepare("SELECT COUNT(*) AS count FROM onboarding_confirmations").get())
      .toEqual({ count: 1 });
    expect(database.prepare(`
      SELECT versions_json, confirmation_digest FROM onboarding_confirmations
    `).get()).toEqual({
      versions_json: V1_VERSIONS_JSON,
      confirmation_digest: V1_CONFIRMATION_DIGEST,
    });
    const storedText = canonicalJson(database.prepare(
      "SELECT * FROM onboarding_confirmations",
    ).get());
    expect(storedText).not.toMatch(/rawInput|sourceSpan|message|chat|rawOutput|"prompt":/i);
    expect(Object.isFrozen(receipt)).toBe(true);
    expect(Object.isFrozen(verified.profile.profile.participants[0]?.monthlyIncome)).toBe(true);
  });

  test.each([
    ["historical V1", ONBOARDING_MODEL_VERSIONS_V1, V1_VERSIONS_JSON, V1_CONFIRMATION_DIGEST],
    ["current V2", ONBOARDING_MODEL_VERSIONS_V2, V2_VERSIONS_JSON, V2_CONFIRMATION_DIGEST],
    ["current V3", ONBOARDING_MODEL_VERSIONS_V3, V3_VERSIONS_JSON, V3_CONFIRMATION_DIGEST],
    ["historical V4", ONBOARDING_MODEL_VERSIONS_V4, V4_VERSIONS_JSON, V4_CONFIRMATION_DIGEST],
  ] as const)("persists and reopens the exact %s tuple without rewriting its row", async (
    _lineage,
    versions,
    expectedVersionsJson,
    expectedConfirmationDigest,
  ) => {
    // Break caught: migrating historical rows or failing to persist the current whole tuple.
    const path = temporaryDatabasePath("onboarding-lineage-");
    const database = track(openEvidenceDatabase(path));
    const receipt = await commit(createStore(database), COMMAND_1, confirmedValues(), versions);
    const rowBefore = database.prepare(`
      SELECT * FROM onboarding_confirmations WHERE receipt_id = ?
    `).get(receipt.receiptId);
    database.close();

    const reopened = track(openEvidenceDatabase(path));
    const store = createStore(reopened);
    const changesBefore = reopened.prepare("SELECT total_changes() AS count").get();
    const verified = await store.loadBySnapshotBindingsVerified({
      profileId: receipt.profileId,
      preferenceProfileId: receipt.preferenceProfileId,
    });

    expect(verified.versions).toBe(versions);
    expect(receipt.confirmationDigest).toBe(expectedConfirmationDigest);
    expect(reopened.prepare(`
      SELECT versions_json, confirmation_digest FROM onboarding_confirmations WHERE receipt_id = ?
    `).get(receipt.receiptId)).toEqual({
      versions_json: expectedVersionsJson,
      confirmation_digest: expectedConfirmationDigest,
    });
    expect(reopened.prepare(`
      SELECT * FROM onboarding_confirmations WHERE receipt_id = ?
    `).get(receipt.receiptId)).toEqual(rowBefore);
    expect(reopened.prepare("SELECT total_changes() AS count").get()).toEqual(changesBefore);
  });

  test("round-trips the current V5 tuple while retaining the six-key persistence shape", async () => {
    const database = track(openEvidenceDatabase(temporaryDatabasePath("onboarding-v5-lineage-")));
    const store = createStore(database);
    const receipt = await commit(store, COMMAND_1, confirmedValues(), ONBOARDING_MODEL_VERSIONS_V5);
    const row = database.prepare("SELECT versions_json FROM onboarding_confirmations WHERE receipt_id = ?").get(receipt.receiptId) as { versions_json: string };

    expect(JSON.parse(row.versions_json)).toEqual(ONBOARDING_MODEL_VERSIONS_V5);
    expect(row.versions_json).toBe(V5_VERSIONS_JSON);
    expect(receipt.confirmationDigest).toBe(V5_CONFIRMATION_DIGEST);
    expect((await store.loadBySnapshotBindingsVerified({
      profileId: receipt.profileId,
      preferenceProfileId: receipt.preferenceProfileId,
    })).versions).toBe(ONBOARDING_MODEL_VERSIONS_V5);
    expect(Object.keys(JSON.parse(row.versions_json))).toEqual([
      "cliVersion", "extractionPrompt", "extractionSchema", "invocation", "reviewPrompt", "reviewSchema",
    ]);
  });

  test("replays an ambiguous successful submission without another clock, materializer, or write", async () => {
    // Break caught: rematerializing an already committed command after the client missed its response.
    const database = track(openEvidenceDatabase(":memory:"));
    const clock = vi.fn(() => new Date(NOW));
    const materialize = vi.fn(materializeOnboardingSnapshots);
    const store = createStore(database, { clock, materialize });
    const confirmed = confirmedValues();

    await commit(store, COMMAND_1, confirmed); // Simulate a durable commit whose response was lost.
    const replayed = await commit(store, COMMAND_1, structuredClone(confirmed));

    expect(replayed).toEqual(await commit(store, COMMAND_1, confirmed));
    expect(clock).toHaveBeenCalledTimes(1);
    expect(materialize).toHaveBeenCalledTimes(1);
    expect(database.prepare("SELECT COUNT(*) AS count FROM profile_snapshots").get())
      .toEqual({ count: 2 });
    expect(database.prepare("SELECT COUNT(*) AS count FROM onboarding_confirmations").get())
      .toEqual({ count: 1 });
  });

  test("returns undefined for an absent command without issuance work or persistence", async () => {
    // Break caught: turning the read-only replay probe into a second commit path.
    const database = track(openEvidenceDatabase(":memory:"));
    const clock = vi.fn(() => new Date(NOW));
    const materialize = vi.fn(materializeOnboardingSnapshots);
    const store = createStore(database, { clock, materialize });
    const changesBefore = database.prepare("SELECT total_changes() AS count").get();

    await expect(replay(store)).resolves.toBeUndefined();

    expect(clock).not.toHaveBeenCalled();
    expect(materialize).not.toHaveBeenCalled();
    expect(database.prepare("SELECT total_changes() AS count").get()).toEqual(changesBefore);
    expect(database.prepare("SELECT COUNT(*) AS count FROM profile_snapshots").get())
      .toEqual({ count: 0 });
    expect(database.prepare("SELECT COUNT(*) AS count FROM onboarding_confirmations").get())
      .toEqual({ count: 0 });
  });

  test("returns the exact committed receipt without another clock, materialization, or write", async () => {
    // Break caught: replaying by rematerializing values or mutating the durable confirmation.
    const database = track(openEvidenceDatabase(":memory:"));
    const clock = vi.fn(() => new Date(NOW));
    const materialize = vi.fn(materializeOnboardingSnapshots);
    const store = createStore(database, { clock, materialize });
    const confirmed = confirmedValues();
    const receipt = await commit(store, COMMAND_1, confirmed);
    clock.mockClear();
    materialize.mockClear();
    const changesBefore = database.prepare("SELECT total_changes() AS count").get();

    const replayed = await replay(
      store,
      COMMAND_1,
      structuredClone(confirmed),
      { ...VERSIONS },
    );

    expect(replayed).toEqual(receipt);
    expect(Object.isFrozen(replayed)).toBe(true);
    expect(clock).not.toHaveBeenCalled();
    expect(materialize).not.toHaveBeenCalled();
    expect(database.prepare("SELECT total_changes() AS count").get()).toEqual(changesBefore);
  });

  test("rejects changed replay values and fixed versions without issuance work", async () => {
    // Break caught: using command identity alone as authorization to replay a different completion.
    const database = track(openEvidenceDatabase(":memory:"));
    const clock = vi.fn(() => new Date(NOW));
    const materialize = vi.fn(materializeOnboardingSnapshots);
    const store = createStore(database, { clock, materialize });
    await commit(store);
    clock.mockClear();
    materialize.mockClear();
    const changesBefore = database.prepare("SELECT total_changes() AS count").get();

    await expect(replay(store, COMMAND_1, confirmedValues("Kazan")))
      .rejects.toThrow("onboarding_completion_conflict");
    await expect(replay(store, COMMAND_1, confirmedValues(), {
      ...VERSIONS,
      reviewPrompt: "onboarding-review@2" as never,
    })).rejects.toThrow(TypeError);

    expect(clock).not.toHaveBeenCalled();
    expect(materialize).not.toHaveBeenCalled();
    expect(database.prepare("SELECT total_changes() AS count").get()).toEqual(changesBefore);
  });

  test("owns replay input without invoking a borrowed accessor", async () => {
    // Break caught: probing persistence after evaluating hostile caller-owned values.
    const database = track(openEvidenceDatabase(":memory:"));
    const clock = vi.fn(() => new Date(NOW));
    const materialize = vi.fn(materializeOnboardingSnapshots);
    const store = createStore(database, { clock, materialize });
    const hostile = structuredClone(confirmedValues());
    let accessorReads = 0;
    Object.defineProperty(hostile.profile.profile.currentLocation, "city", {
      enumerable: true,
      get: () => {
        accessorReads += 1;
        return "Moscow";
      },
    });
    const changesBefore = database.prepare("SELECT total_changes() AS count").get();

    await expect(replay(store, COMMAND_1, hostile))
      .rejects.toThrow("Invalid onboarding completion");

    expect(accessorReads).toBe(0);
    expect(clock).not.toHaveBeenCalled();
    expect(materialize).not.toHaveBeenCalled();
    expect(database.prepare("SELECT total_changes() AS count").get()).toEqual(changesBefore);
  });

  test("rejects a tampered committed receipt during read-only replay", async () => {
    // Break caught: returning a row by command ID without reconstructing its full HMAC binding.
    const database = track(openEvidenceDatabase(":memory:"));
    const clock = vi.fn(() => new Date(NOW));
    const materialize = vi.fn(materializeOnboardingSnapshots);
    const store = createStore(database, { clock, materialize });
    const receipt = await commit(store);
    database.exec("DROP TRIGGER onboarding_confirmations_no_update");
    database.prepare(`
      UPDATE onboarding_confirmations SET confirmation_digest = ? WHERE receipt_id = ?
    `).run("0".repeat(64), receipt.receiptId);
    clock.mockClear();
    materialize.mockClear();
    const changesBefore = database.prepare("SELECT total_changes() AS count").get();

    await expect(replay(store)).rejects.toThrow("integrity_mismatch");

    expect(clock).not.toHaveBeenCalled();
    expect(materialize).not.toHaveBeenCalled();
    expect(database.prepare("SELECT total_changes() AS count").get()).toEqual(changesBefore);
  });

  test("detects a tampered command through its deterministic receipt binding before replay work", async () => {
    // Break caught: treating a command-column tamper as a new command when its deterministic IDs remain.
    const database = track(openEvidenceDatabase(":memory:"));
    const clock = vi.fn(() => new Date(NOW));
    const materialize = vi.fn(materializeOnboardingSnapshots);
    const store = createStore(database, { clock, materialize });
    const confirmed = confirmedValues();
    const receipt = await commit(store, COMMAND_1, confirmed);
    database.exec("DROP TRIGGER onboarding_confirmations_no_update");
    database.prepare(`
      UPDATE onboarding_confirmations SET completion_command_id = ? WHERE receipt_id = ?
    `).run(COMMAND_2, receipt.receiptId);
    clock.mockClear();
    materialize.mockClear();

    await expect(commit(store, COMMAND_1, confirmed)).rejects.toThrow("integrity_mismatch");

    expect(database.prepare(`
      SELECT completion_command_id, receipt_id, frontier_run_id FROM onboarding_confirmations
    `).get()).toEqual({
      completion_command_id: COMMAND_2,
      receipt_id: receiptId(COMMAND_1),
      frontier_run_id: frontierRunId(COMMAND_1),
    });
    expect(clock).not.toHaveBeenCalled();
    expect(materialize).not.toHaveBeenCalled();
    expect(database.prepare("SELECT COUNT(*) AS count FROM profile_snapshots").get())
      .toEqual({ count: 2 });
    expect(database.prepare("SELECT COUNT(*) AS count FROM onboarding_confirmations").get())
      .toEqual({ count: 1 });
  });

  test("rejects same-command value or fixed-version conflicts after verifying the stored binding", async () => {
    // Break caught: treating a reused command ID as latest-wins or weakening the fixed model tuple.
    const database = track(openEvidenceDatabase(":memory:"));
    const clock = vi.fn(() => new Date(NOW));
    const materialize = vi.fn(materializeOnboardingSnapshots);
    const store = createStore(database, { clock, materialize });
    await commit(store);

    await expect(commit(store, COMMAND_1, confirmedValues("Kazan")))
      .rejects.toThrow("onboarding_completion_conflict");
    await expect(commit(store, COMMAND_1, confirmedValues(), {
      ...VERSIONS,
      reviewPrompt: "onboarding-review@2" as never,
    })).rejects.toThrow(TypeError);
    expect(clock).toHaveBeenCalledTimes(1);
    expect(materialize).toHaveBeenCalledTimes(1);
    expect(database.prepare("SELECT COUNT(*) AS count FROM onboarding_confirmations").get())
      .toEqual({ count: 1 });
  });

  test.each([
    ["V1 then V2", ONBOARDING_MODEL_VERSIONS_V1, ONBOARDING_MODEL_VERSIONS_V2],
    ["V1 then V3", ONBOARDING_MODEL_VERSIONS_V1, ONBOARDING_MODEL_VERSIONS_V3],
    ["V2 then V1", ONBOARDING_MODEL_VERSIONS_V2, ONBOARDING_MODEL_VERSIONS_V1],
    ["V2 then V3", ONBOARDING_MODEL_VERSIONS_V2, ONBOARDING_MODEL_VERSIONS_V3],
    ["V3 then V1", ONBOARDING_MODEL_VERSIONS_V3, ONBOARDING_MODEL_VERSIONS_V1],
    ["V3 then V2", ONBOARDING_MODEL_VERSIONS_V3, ONBOARDING_MODEL_VERSIONS_V2],
    ["V4 then V1", ONBOARDING_MODEL_VERSIONS_V4, ONBOARDING_MODEL_VERSIONS_V1],
  ] as const)("classifies a same-command %s replay as conflict before issuance or writes", async (
    _direction,
    committedVersions,
    replayedVersions,
  ) => {
    // Break caught: treating a lineage change as a new command or invalid caller tuple.
    const database = track(openEvidenceDatabase(":memory:"));
    const clock = vi.fn(() => new Date(NOW));
    const materialize = vi.fn(materializeOnboardingSnapshots);
    const store = createStore(database, { clock, materialize });
    const confirmed = confirmedValues();
    await commit(store, COMMAND_1, confirmed, committedVersions);
    clock.mockClear();
    materialize.mockClear();
    const changesBefore = database.prepare("SELECT total_changes() AS count").get();

    await expect(replay(store, COMMAND_1, structuredClone(confirmed), replayedVersions))
      .rejects.toThrow("onboarding_completion_conflict");
    await expect(commit(store, COMMAND_1, structuredClone(confirmed), replayedVersions))
      .rejects.toThrow("onboarding_completion_conflict");

    expect(clock).not.toHaveBeenCalled();
    expect(materialize).not.toHaveBeenCalled();
    expect(database.prepare("SELECT total_changes() AS count").get()).toEqual(changesBefore);
    expect(database.prepare("SELECT COUNT(*) AS count FROM onboarding_confirmations").get())
      .toEqual({ count: 1 });
  });

  test("issues monotonic milliseconds and distinct pairs for different commands at one wall-clock tick", async () => {
    // Break caught: ambiguous identical snapshot pairs or a latest-wins pair loader.
    const database = track(openEvidenceDatabase(":memory:"));
    const clock = vi.fn(() => new Date(NOW));
    const store = createStore(database, { clock });
    const confirmed = confirmedValues();

    const first = await commit(store, COMMAND_1, confirmed);
    const second = await commit(store, COMMAND_2, confirmed);
    const changed = await commit(store, COMMAND_3, confirmedValues("Kazan"));

    expect([first.confirmedAt, second.confirmedAt, changed.confirmedAt]).toEqual([
      "2026-08-22T10:00:00.000Z",
      "2026-08-22T10:00:00.001Z",
      "2026-08-22T10:00:00.002Z",
    ]);
    expect(new Set([first.profileId, second.profileId, changed.profileId])).toHaveLength(3);
    expect(new Set([
      first.preferenceProfileId,
      second.preferenceProfileId,
      changed.preferenceProfileId,
    ])).toHaveLength(3);
    expect(clock).toHaveBeenCalledTimes(3);
    await expect(store.loadBySnapshotBindingsVerified({
      profileId: first.profileId,
      preferenceProfileId: second.preferenceProfileId,
    })).rejects.toThrow("onboarding_confirmation_not_found");
    await expect(store.loadBySnapshotBindingsVerified({
      profileId: second.profileId,
      preferenceProfileId: second.preferenceProfileId,
    })).resolves.toEqual(expect.objectContaining({ receipt: second }));
  });

  test("rejects hostile borrowed values before clock, materialization, or persistence", async () => {
    // Break caught: canonicalizing or cloning a caller accessor/prototype before ownership is established.
    const database = track(openEvidenceDatabase(":memory:"));
    const clock = vi.fn(() => new Date(NOW));
    const materialize = vi.fn(materializeOnboardingSnapshots);
    const store = createStore(database, { clock, materialize });
    const hostile = structuredClone(confirmedValues());
    let accessorReads = 0;
    Object.defineProperty(hostile.profile.profile.currentLocation, "city", {
      enumerable: true,
      get: () => {
        accessorReads += 1;
        return "Moscow";
      },
    });

    await expect(commit(store, COMMAND_1, hostile)).rejects.toThrow(TypeError);
    expect(accessorReads).toBe(0);

    const hostileVersions = { ...VERSIONS };
    Object.setPrototypeOf(hostileVersions, { inherited: true });
    await expect(commit(store, COMMAND_1, confirmedValues(), hostileVersions))
      .rejects.toThrow(TypeError);
    expect(clock).not.toHaveBeenCalled();
    expect(materialize).not.toHaveBeenCalled();
    expect(database.prepare("SELECT COUNT(*) AS count FROM profile_snapshots").get())
      .toEqual({ count: 0 });
    expect(database.prepare("SELECT COUNT(*) AS count FROM onboarding_confirmations").get())
      .toEqual({ count: 0 });
  });

  test("rejects a nested versions Proxy without invoking any Proxy trap", async () => {
    // Break caught: reflecting on a borrowed nested Proxy before proving it is an ordinary object.
    const database = track(openEvidenceDatabase(":memory:"));
    const clock = vi.fn(() => new Date(NOW));
    const materialize = vi.fn(materializeOnboardingSnapshots);
    const store = createStore(database, { clock, materialize });
    let trapCalls = 0;
    const trap = (): never => {
      trapCalls += 1;
      throw new Error("versions_proxy_trap");
    };
    const versions = new Proxy({ ...ONBOARDING_MODEL_VERSIONS_V2 }, {
      get: trap,
      getOwnPropertyDescriptor: trap,
      getPrototypeOf: trap,
      ownKeys: trap,
    }) as OnboardingModelVersions;

    await expect(commit(store, COMMAND_1, confirmedValues(), versions))
      .rejects.toThrow("Invalid onboarding completion");

    expect(trapCalls).toBe(0);
    expect(clock).not.toHaveBeenCalled();
    expect(materialize).not.toHaveBeenCalled();
    expect(database.prepare("SELECT COUNT(*) AS count FROM onboarding_confirmations").get())
      .toEqual({ count: 0 });
  });

  test("rejects every hybrid and decorated tuple before issuance work", async () => {
    // Break caught: accepting labels independently or normalizing hostile tuple ownership.
    const database = track(openEvidenceDatabase(":memory:"));
    const clock = vi.fn(() => new Date(NOW));
    const materialize = vi.fn(materializeOnboardingSnapshots);
    const store = createStore(database, { clock, materialize });
    let accessorReads = 0;
    const accessor = { ...ONBOARDING_MODEL_VERSIONS_V2 } as Record<string, unknown>;
    Object.defineProperty(accessor, "extractionPrompt", {
      enumerable: true,
      get: () => {
        accessorReads += 1;
        return ONBOARDING_MODEL_VERSIONS_V2.extractionPrompt;
      },
    });
    const missing = { ...ONBOARDING_MODEL_VERSIONS_V2 } as Record<string, unknown>;
    delete missing.reviewSchema;
    const symbol = Symbol("decorated");
    const customPrototype = Object.assign(
      Object.create({ inherited: true }) as Record<string, unknown>,
      ONBOARDING_MODEL_VERSIONS_V2,
    );
    const invalidTuples: readonly unknown[] = [
      {
        ...ONBOARDING_MODEL_VERSIONS_V1,
        extractionPrompt: ONBOARDING_MODEL_VERSIONS_V2.extractionPrompt,
      },
      {
        ...ONBOARDING_MODEL_VERSIONS_V1,
        extractionSchema: ONBOARDING_MODEL_VERSIONS_V2.extractionSchema,
      },
      { ...ONBOARDING_MODEL_VERSIONS_V2, unexpected: true },
      missing,
      accessor,
      { ...ONBOARDING_MODEL_VERSIONS_V2, [symbol]: true },
      customPrototype,
    ];

    for (const versions of invalidTuples) {
      await expect(commit(
        store,
        COMMAND_1,
        confirmedValues(),
        versions as OnboardingModelVersions,
      )).rejects.toThrow(TypeError);
    }

    expect(accessorReads).toBe(0);
    expect(clock).not.toHaveBeenCalled();
    expect(materialize).not.toHaveBeenCalled();
    expect(database.prepare("SELECT COUNT(*) AS count FROM onboarding_confirmations").get())
      .toEqual({ count: 0 });
  });

  test("rejects malformed command identity and wrong fixed versions before issuance work", async () => {
    // Break caught: entering the write transaction with an unowned identity/version contract.
    const database = track(openEvidenceDatabase(":memory:"));
    const clock = vi.fn(() => new Date(NOW));
    const materialize = vi.fn(materializeOnboardingSnapshots);
    const store = createStore(database, { clock, materialize });

    await expect(commit(store, "NOT-A-UUID", confirmedValues())).rejects.toThrow(TypeError);
    await expect(commit(store, COMMAND_1, confirmedValues(), {
      ...VERSIONS,
      cliVersion: "codex-cli 0.148.0-alpha.16" as never,
    })).rejects.toThrow(TypeError);

    expect(clock).not.toHaveBeenCalled();
    expect(materialize).not.toHaveBeenCalled();
    expect(database.prepare("SELECT COUNT(*) AS count FROM profile_snapshots").get())
      .toEqual({ count: 0 });
    expect(database.prepare("SELECT COUNT(*) AS count FROM onboarding_confirmations").get())
      .toEqual({ count: 0 });
  });

  test("rejects valid materializer output bound to different confirmed values before inserts", async () => {
    // Break caught: trusting internally valid snapshots that substitute a normalized command value.
    const database = track(openEvidenceDatabase(":memory:"));
    database.exec(`
      CREATE TRIGGER fail_any_profile_snapshot_insert
      BEFORE INSERT ON profile_snapshots
      BEGIN
        SELECT RAISE(ABORT, 'profile_snapshot_insert_was_attempted');
      END;
    `);
    const clock = vi.fn(() => new Date(NOW));
    const materialize = vi.fn<typeof materializeOnboardingSnapshots>((input) =>
      materializeOnboardingSnapshots({
        confirmedAt: input.confirmedAt,
        values: confirmedValues("Kazan"),
      }));
    const store = createStore(database, { clock, materialize });

    await expect(commit(store, COMMAND_1, confirmedValues("Moscow")))
      .rejects.toThrow("integrity_mismatch");

    expect(clock).toHaveBeenCalledTimes(1);
    expect(materialize).toHaveBeenCalledTimes(1);
    expect(database.prepare("SELECT COUNT(*) AS count FROM profile_snapshots").get())
      .toEqual({ count: 0 });
    expect(database.prepare("SELECT COUNT(*) AS count FROM onboarding_confirmations").get())
      .toEqual({ count: 0 });
  });

  test("rolls both snapshots back when confirmation insertion fails after snapshot writes", async () => {
    // Break caught: leaking an orphaned @2 snapshot after a post-snapshot failure.
    const database = track(openEvidenceDatabase(":memory:"));
    database.exec(`
      CREATE TRIGGER force_onboarding_confirmation_failure
      BEFORE INSERT ON onboarding_confirmations
      BEGIN
        SELECT RAISE(ABORT, 'forced_post_snapshot_failure');
      END;
    `);
    const store = createStore(database);

    await expect(commit(store)).rejects.toThrow("forced_post_snapshot_failure");
    expect(database.prepare("SELECT COUNT(*) AS count FROM profile_snapshots").get())
      .toEqual({ count: 0 });
    expect(database.prepare("SELECT COUNT(*) AS count FROM onboarding_confirmations").get())
      .toEqual({ count: 0 });
  });

  test("accepts an exact pre-existing content snapshot and rejects a corrupt ID collision atomically", async () => {
    // Break caught: accepting content-address collisions without exact verified equality.
    const confirmed = confirmedValues();
    const snapshots = materializeOnboardingSnapshots({ confirmedAt: NOW, values: confirmed });

    const exactDatabase = track(openEvidenceDatabase(":memory:"));
    const profileJson = canonicalJson(snapshots.profile);
    exactDatabase.prepare(`
      INSERT INTO profile_snapshots (id, confirmed_at, snapshot_json, snapshot_hash)
      VALUES (?, ?, ?, ?)
    `).run(
      snapshots.profile.id,
      snapshots.profile.confirmedAt,
      profileJson,
      sha256Text(profileJson),
    );
    await expect(commit(createStore(exactDatabase), COMMAND_1, confirmed)).resolves.toEqual(
      expect.objectContaining({ profileId: snapshots.profile.id }),
    );
    expect(exactDatabase.prepare("SELECT COUNT(*) AS count FROM profile_snapshots").get())
      .toEqual({ count: 2 });

    const corruptDatabase = track(openEvidenceDatabase(":memory:"));
    corruptDatabase.prepare(`
      INSERT INTO profile_snapshots (id, confirmed_at, snapshot_json, snapshot_hash)
      VALUES (?, ?, '{}', ?)
    `).run(snapshots.profile.id, snapshots.profile.confirmedAt, sha256Text("{}"));
    await expect(commit(createStore(corruptDatabase), COMMAND_1, confirmed))
      .rejects.toThrow("integrity_mismatch");
    expect(corruptDatabase.prepare("SELECT COUNT(*) AS count FROM profile_snapshots").get())
      .toEqual({ count: 1 });
    expect(corruptDatabase.prepare("SELECT COUNT(*) AS count FROM onboarding_confirmations").get())
      .toEqual({ count: 0 });
  });

  test("rejects a corrupt preference content-ID collision without orphaning the profile", async () => {
    // Break caught: checking only the relocation collision before committing the pair.
    const database = track(openEvidenceDatabase(":memory:"));
    const confirmed = confirmedValues();
    const snapshots = materializeOnboardingSnapshots({ confirmedAt: NOW, values: confirmed });
    database.prepare(`
      INSERT INTO profile_snapshots (id, confirmed_at, snapshot_json, snapshot_hash)
      VALUES (?, ?, '{}', ?)
    `).run(
      snapshots.preferences.id,
      snapshots.preferences.confirmedAt,
      sha256Text("{}"),
    );

    await expect(commit(createStore(database), COMMAND_1, confirmed))
      .rejects.toThrow("integrity_mismatch");
    expect(database.prepare("SELECT id FROM profile_snapshots").all())
      .toEqual([{ id: snapshots.preferences.id }]);
    expect(database.prepare("SELECT COUNT(*) AS count FROM onboarding_confirmations").get())
      .toEqual({ count: 0 });
  });

  test("rejects an unsigned change from one exact tuple to the other", async () => {
    // Break caught: treating versions_json as valid metadata outside the confirmation HMAC.
    const database = track(openEvidenceDatabase(":memory:"));
    const store = createStore(database);
    const receipt = await commit(store, COMMAND_1, confirmedValues(), ONBOARDING_MODEL_VERSIONS_V1);
    database.exec("DROP TRIGGER onboarding_confirmations_no_update");
    database.prepare(`
      UPDATE onboarding_confirmations SET versions_json = ? WHERE receipt_id = ?
    `).run(V2_VERSIONS_JSON, receipt.receiptId);

    await expect(store.loadBySnapshotBindingsVerified({
      profileId: receipt.profileId,
      preferenceProfileId: receipt.preferenceProfileId,
    })).rejects.toThrow("integrity_mismatch");
  });

  test("rejects a fully re-signed prompt/schema hybrid tuple", async () => {
    // Break caught: verifying the signature before enforcing the application-owned whole-tuple set.
    const database = track(openEvidenceDatabase(":memory:"));
    const store = createStore(database);
    const receipt = await commit(store, COMMAND_1, confirmedValues(), ONBOARDING_MODEL_VERSIONS_V1);
    const verified = await store.loadBySnapshotBindingsVerified({
      profileId: receipt.profileId,
      preferenceProfileId: receipt.preferenceProfileId,
    });
    const hybrid = {
      ...ONBOARDING_MODEL_VERSIONS_V1,
      extractionPrompt: ONBOARDING_MODEL_VERSIONS_V2.extractionPrompt,
    };
    const unsignedReceipt = {
      schemaVersion: verified.receipt.schemaVersion,
      receiptId: verified.receipt.receiptId,
      completionCommandId: verified.receipt.completionCommandId,
      profileId: verified.receipt.profileId,
      preferenceProfileId: verified.receipt.preferenceProfileId,
      frontierRunId: verified.receipt.frontierRunId,
      confirmedAt: verified.receipt.confirmedAt,
    };
    const resignedDigest = hmacSha256(canonicalJson({
      schemaVersion: "onboarding-confirmation-binding@1",
      receipt: unsignedReceipt,
      profile: verified.profile,
      preferences: verified.preferences,
      provenance: verified.provenance,
      versions: hybrid,
    }), HMAC_KEY);
    database.exec("DROP TRIGGER onboarding_confirmations_no_update");
    database.prepare(`
      UPDATE onboarding_confirmations
      SET versions_json = ?, confirmation_digest = ?
      WHERE receipt_id = ?
    `).run(canonicalJson(hybrid), resignedDigest, receipt.receiptId);

    await expect(store.loadBySnapshotBindingsVerified({
      profileId: receipt.profileId,
      preferenceProfileId: receipt.preferenceProfileId,
    })).rejects.toThrow("integrity_mismatch");
  });

  test.each([
    ["digest", (database: Database.Database) => database.prepare(`
      UPDATE onboarding_confirmations SET confirmation_digest = ?
    `).run("0".repeat(64))],
    ["provenance", (database: Database.Database) => database.prepare(`
      UPDATE onboarding_confirmations SET provenance_json = ?
    `).run("{}")],
    ["versions", (database: Database.Database) => database.prepare(`
      UPDATE onboarding_confirmations SET versions_json = ?
    `).run(canonicalJson({ ...VERSIONS, reviewPrompt: "onboarding-review@2" }))],
    ["receipt", (database: Database.Database) => database.prepare(`
      UPDATE onboarding_confirmations SET receipt_id = ?
    `).run("onboarding-receipt:" + "0".repeat(64))],
    ["run", (database: Database.Database) => database.prepare(`
      UPDATE onboarding_confirmations SET frontier_run_id = ?
    `).run("onboarding-frontier:" + "0".repeat(64))],
    ["timestamp", (database: Database.Database) => database.prepare(`
      UPDATE onboarding_confirmations SET confirmed_at = ?
    `).run("2026-08-22T11:00:00.000Z")],
  ] as const)("classifies re-signed-independent %s tamper as integrity mismatch", async (
    _name,
    tamper,
  ) => {
    // Break caught: misclassifying corrupted persisted state as a caller command conflict.
    const database = track(openEvidenceDatabase(":memory:"));
    const store = createStore(database);
    const receipt = await commit(store);
    database.exec("DROP TRIGGER onboarding_confirmations_no_update");
    tamper(database);

    await expect(store.loadBySnapshotBindingsVerified({
      profileId: receipt.profileId,
      preferenceProfileId: receipt.preferenceProfileId,
    })).rejects.toThrow("integrity_mismatch");
    await expect(commit(store, COMMAND_1, confirmedValues("Kazan")))
      .rejects.toThrow("integrity_mismatch");
  });

  test("classifies snapshot tamper before comparing changed replay values", async () => {
    // Break caught: reporting a caller conflict while the durable snapshot binding is corrupt.
    const database = track(openEvidenceDatabase(":memory:"));
    const store = createStore(database);
    const receipt = await commit(store);
    database.exec("DROP TRIGGER profile_snapshots_no_update");
    database.prepare(`
      UPDATE profile_snapshots SET snapshot_json = '{}', snapshot_hash = ? WHERE id = ?
    `).run(sha256Text("{}"), receipt.profileId);

    await expect(commit(store, COMMAND_1, confirmedValues("Kazan")))
      .rejects.toThrow("integrity_mismatch");
    await expect(store.loadBySnapshotBindingsVerified({
      profileId: receipt.profileId,
      preferenceProfileId: receipt.preferenceProfileId,
    })).rejects.toThrow("integrity_mismatch");
  });

  test("issues previous plus one millisecond when the wall clock moves backward", async () => {
    // Break caught: trusting a regressed wall clock and reusing or reversing confirmedAt.
    const database = track(openEvidenceDatabase(":memory:"));
    const first = await commit(createStore(database), COMMAND_1);
    const backwardClock = vi.fn(() => new Date("2020-01-01T00:00:00.000Z"));

    const second = await commit(createStore(database, { clock: backwardClock }), COMMAND_2);

    expect(first.confirmedAt).toBe(NOW);
    expect(second.confirmedAt).toBe("2026-08-22T10:00:00.001Z");
    expect(backwardClock).toHaveBeenCalledTimes(1);
  });

  test.each(["completion_command_id", "frontier_run_id", "confirmed_at", "pair"] as const)(
    "rejects duplicate %s while leaving confirmation digests non-unique",
    async (duplicate) => {
      // Break caught: losing one of the four ambiguity-preventing uniqueness constraints.
      const database = track(openEvidenceDatabase(":memory:"));
      const store = createStore(database);
      const first = await commit(store, COMMAND_1);
      const second = await commit(store, COMMAND_2);
      const crossProfile = duplicate === "pair" ? first.profileId : first.profileId;
      const crossPreference = duplicate === "pair"
        ? first.preferenceProfileId
        : second.preferenceProfileId;
      const values = {
        receiptId: "test-receipt-unique",
        commandId: duplicate === "completion_command_id" ? COMMAND_1 : COMMAND_3,
        runId: duplicate === "frontier_run_id" ? first.frontierRunId : "test-frontier-unique",
        confirmedAt: duplicate === "confirmed_at"
          ? first.confirmedAt
          : "2026-08-22T10:00:01.500Z",
        profileId: crossProfile,
        preferenceProfileId: crossPreference,
      };

      expect(() => database.prepare(`
        INSERT INTO onboarding_confirmations (
          schema_version, receipt_id, completion_command_id, confirmation_digest,
          profile_id, preference_profile_id, frontier_run_id, confirmed_at,
          provenance_json, versions_json
        ) VALUES ('onboarding-receipt@1', ?, ?, ?, ?, ?, ?, ?, '{}', '{}')
      `).run(
        values.receiptId,
        values.commandId,
        first.confirmationDigest,
        values.profileId,
        values.preferenceProfileId,
        values.runId,
        values.confirmedAt,
      )).toThrow();

      database.exec("DROP TRIGGER onboarding_confirmations_no_update");
      expect(database.prepare(`
        UPDATE onboarding_confirmations
        SET confirmation_digest = ? WHERE receipt_id = ?
      `).run(first.confirmationDigest, second.receiptId).changes).toBe(1);
    },
  );
});

async function concurrentSameCommand(path: string): Promise<{
  readonly outcomes: readonly string[];
  readonly clockCalls: number;
  readonly materializeCalls: number;
}> {
  const barrier = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * 3);
  const counters = new Int32Array(barrier);
  const storePath = join(process.cwd(), "src/infrastructure/sqlite/onboarding-store.ts");
  const questionnairePath = join(process.cwd(), "src/decision/onboarding-questionnaire.ts");
  const workerSource = `
    const { parentPort, workerData } = require("node:worker_threads");
    require("tsx/cjs");
    const Database = require("better-sqlite3");
    const { SqliteOnboardingStore } = require(workerData.storePath);
    const { materializeOnboardingSnapshots } = require(workerData.questionnairePath);
    const database = new Database(workerData.path);
    database.pragma("foreign_keys = ON");
    database.pragma("busy_timeout = 5000");
    const counters = new Int32Array(workerData.barrier);
    const store = new SqliteOnboardingStore(database, workerData.key, {
      clock: () => {
        Atomics.add(counters, 1, 1);
        return new Date(workerData.now);
      },
      materialize: (input) => {
        Atomics.add(counters, 2, 1);
        return materializeOnboardingSnapshots(input);
      },
    });
    parentPort.postMessage({ type: "ready" });
    Atomics.wait(counters, 0, 0);
    store.commitOrReplay(workerData.input).then((receipt) => {
      database.close();
      parentPort.postMessage({ type: "done", receipt: JSON.stringify(receipt) });
    }, (error) => {
      database.close();
      parentPort.postMessage({ type: "error", message: error.message });
    });
  `;
  const input = { completionCommandId: COMMAND_1, confirmed: confirmedValues(), versions: VERSIONS };
  const workers = Array.from({ length: 2 }, () => new Worker(workerSource, {
    eval: true,
    workerData: {
      path,
      key: HMAC_KEY,
      now: NOW,
      input,
      storePath,
      questionnairePath,
      barrier,
    },
  }));
  const outcomes: string[] = [];
  let ready = 0;
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("concurrent_onboarding_timeout")), 10_000);
      for (const worker of workers) {
        worker.on("error", reject);
        worker.on("message", (message: { readonly type: string; readonly receipt?: string; readonly message?: string }) => {
          if (message.type === "ready") {
            ready += 1;
            if (ready === workers.length) {
              Atomics.store(counters, 0, 1);
              Atomics.notify(counters, 0, workers.length);
            }
            return;
          }
          outcomes.push(message.type === "done" ? message.receipt! : message.message!);
          if (outcomes.length === workers.length) {
            clearTimeout(timeout);
            resolve();
          }
        });
      }
    });
  } finally {
    await Promise.all(workers.map((worker) => worker.terminate()));
  }
  return {
    outcomes,
    clockCalls: Atomics.load(counters, 1),
    materializeCalls: Atomics.load(counters, 2),
  };
}

describe("SQLite onboarding writer serialization", () => {
  test("concurrent same-command writers converge with one issuance path", async () => {
    // Break caught: checking idempotency before BEGIN IMMEDIATE and racing two first writes.
    const path = temporaryDatabasePath("onboarding-race-");
    const database = track(openEvidenceDatabase(path));

    const result = await concurrentSameCommand(path);

    expect(result.outcomes).toHaveLength(2);
    expect(new Set(result.outcomes)).toHaveLength(1);
    expect(result.clockCalls).toBe(1);
    expect(result.materializeCalls).toBe(1);
    expect(database.prepare("SELECT COUNT(*) AS count FROM profile_snapshots").get())
      .toEqual({ count: 2 });
    expect(database.prepare("SELECT COUNT(*) AS count FROM onboarding_confirmations").get())
      .toEqual({ count: 1 });
  }, 15_000);
});
