import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import Database from "better-sqlite3";
import { afterEach, describe, expect, test } from "vitest";

import type { CitySourceBindingKeyV1, CitySourceVersionV1 } from "../../src/application/city-source-recovery-contracts";
import { SqliteCitySourceRecoveryStore } from "../../src/infrastructure/sqlite/city-source-recovery-store";
import { SqliteCityContinuationUnitOfWork } from "../../src/infrastructure/sqlite/city-continuation-unit-of-work";
import { createEvidenceIntegrity } from "../../src/infrastructure/integrity";

const directories: string[] = [];
const databases: Database.Database[] = [];
const key: CitySourceBindingKeyV1 = Object.freeze({ schemaVersion: "city-source-binding-key@1", countryCode: "SI", cityId: "ljubljana", factKey: "si-city-safety", definitionId: "si-municipal-police-offences-per-100000@1" });
const version = (id: string): CitySourceVersionV1 => Object.freeze({ schemaVersion: "source-version@1", id, bindingKey: key, publisherId: "policija", navigationUrl: "https://www.policija.si/", requestedUrl: "https://www.policija.si/statistics", finalUrl: "https://www.policija.si/statistics", captureArtifactIds: Object.freeze(["artifact:one"]), captureSha256: Object.freeze(["a".repeat(64)]), evidenceSnapshotId: "evidence:one", parserVersion: "parser@1", capturedAt: "2026-08-29T12:00:00.000Z" });
const integrity = createEvidenceIntegrity("source-recovery-test-key");
function authority() { return Object.freeze({ bindingKey: key, sourceVersion: version("source:installed") }); }
function digest() { const value = authority(); return integrity.hash(integrity.canonical(value)); }
function recoveryDdl(): string { const schema = readFileSync(resolve("src/infrastructure/sqlite/schema.sql"), "utf8"); return schema.split("-- city-source-recovery-ddl:start\n")[1]!.split("-- city-source-recovery-ddl:end")[0]!; }
function open(truthFails = false) { const dir = mkdtempSync(join(tmpdir(), "source-recovery-")); directories.push(dir); const path = join(dir, "db.sqlite"); const db = new Database(path); db.pragma("foreign_keys = ON"); db.exec("CREATE TABLE city_evidence_snapshots(id TEXT PRIMARY KEY); CREATE TABLE city_knowledge_revisions(id TEXT PRIMARY KEY); CREATE TABLE city_frontier_revisions(id TEXT PRIMARY KEY);"); db.exec(recoveryDdl()); db.prepare("INSERT INTO city_evidence_snapshots VALUES(?)").run("evidence:one"); db.prepare("INSERT INTO city_knowledge_revisions VALUES(?)").run("knowledge:one"); db.prepare("INSERT INTO city_frontier_revisions VALUES(?)").run("frontier:one"); databases.push(db); let authorityEnabled = true; let authorityCalls = 0; return { store: new SqliteCitySourceRecoveryStore(db, integrity, Object.freeze({ loadVerified: (requested: CitySourceBindingKeyV1) => { authorityCalls += 1; return authorityEnabled && requested.cityId === key.cityId ? authority() : undefined; } }), Object.freeze({ requireVerified: () => { if (truthFails) throw new Error("truth_missing"); } })), path, disableAuthority: () => { authorityEnabled = false; }, authorityCalls: () => authorityCalls }; }
function replacement(commandId = "command:one") { const source = version("source:replacement"); const revision = { schemaVersion: "source-binding@1" as const, id: "binding:one", bindingKey: key, revisionOrdinal: 1, predecessorRevisionId: null, sourceVersionId: source.id, evidenceSnapshotId: source.evidenceSnapshotId, knowledgeRevisionId: "knowledge:one", frontierRevisionId: "frontier:one", policyVersion: "official-source-recovery@1" as const, actor: "local_codex_recovery" as const, parentRunId: "run:one", createdAt: "2026-08-29T12:01:00.000Z" }; const attempt = { schemaVersion: "official-source-recovery-attempt@1" as const, id: "attempt:one", commandId, bindingKey: key, cursor: { schemaVersion: "city-source-binding-cursor@1" as const, kind: "installed" as const, installedBindingDigest: digest() }, outcome: "replaced" as const, createdAt: "2026-08-29T12:01:00.000Z" }; return { commandId, sourceVersion: source, revision, attempt }; }
afterEach(() => { for (const db of databases.splice(0)) db.close(); for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe("SqliteCitySourceRecoveryStore", () => {
  test("installs a replacement once and rejects a loser cursor", () => {
    const { store } = open(); const first = store.loadEffectiveVerified(key);
    expect(first.cursor.kind).toBe("installed");
    const winner = store.appendReplacement(replacement(), first.cursor);
    expect(store.appendReplacement(replacement(), first.cursor)).toEqual(winner);
    expect(() => store.appendReplacement(replacement("command:other"), first.cursor)).toThrow("source_binding_cas_lost");
    expect(store.loadHistoryVerified(key).map((item) => item.revisionOrdinal)).toEqual([1]);
  });

  test("loads an immutable historical revision without consulting the current head", () => {
    const { store, disableAuthority, authorityCalls } = open();
    const cursor = store.loadEffectiveVerified(key).cursor;
    const revision = store.appendReplacement(replacement(), cursor);
    const secondInput = replacement("command:two");
    const second = { ...secondInput, sourceVersion: { ...secondInput.sourceVersion, id: "source:second" },
      revision: { ...secondInput.revision, id: "binding:two", revisionOrdinal: 2, predecessorRevisionId: revision.id, sourceVersionId: "source:second" },
      attempt: { ...secondInput.attempt, id: "attempt:two", commandId: "command:two", cursor: { schemaVersion: "city-source-binding-cursor@1" as const, kind: "override" as const, revisionId: revision.id, revisionOrdinal: 1 } } };
    store.appendReplacement(second, { schemaVersion: "city-source-binding-cursor@1", kind: "override", revisionId: revision.id, revisionOrdinal: 1 });
    const callsBefore = authorityCalls(); disableAuthority();

    const historical = store.loadRevisionVerified(key, revision.id);

    expect(historical.revision).toEqual(revision);
    expect(historical.sourceVersion.id).toBe("source:replacement");
    expect(Object.isFrozen(historical)).toBe(true);
    expect(Object.isFrozen(historical.revision)).toBe(true);
    expect(authorityCalls()).toBe(callsBefore);
  });

  test("rejects an authenticated branched history without consulting installed authority", () => {
    const { store, disableAuthority, authorityCalls } = open(); const database = databases[0]!;
    const installedCursor = store.loadEffectiveVerified(key).cursor;
    const first = store.appendReplacement(replacement(), installedCursor);
    const secondInput = replacement("command:two");
    const second = { ...secondInput, sourceVersion: { ...secondInput.sourceVersion, id: "source:second" },
      revision: { ...secondInput.revision, id: "binding:two", revisionOrdinal: 2, predecessorRevisionId: first.id, sourceVersionId: "source:second" },
      attempt: { ...secondInput.attempt, id: "attempt:two", commandId: "command:two", cursor: { schemaVersion: "city-source-binding-cursor@1" as const, kind: "override" as const, revisionId: first.id, revisionOrdinal: 1 } } };
    store.appendReplacement(second, second.attempt.cursor);
    const branch = { ...second.revision, id: "binding:branch", revisionOrdinal: 3, predecessorRevisionId: first.id };
    const payload = integrity.canonical(branch);
    database.exec("DROP INDEX city_source_binding_one_successor");
    database.prepare("INSERT INTO city_source_binding_revisions(id,country_code,city_id,fact_key,definition_id,revision_ordinal,predecessor_revision_id,source_version_id,evidence_snapshot_id,knowledge_revision_id,frontier_revision_id,schema_version,payload_json,payload_hash,hmac,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .run(branch.id, key.countryCode, key.cityId, key.factKey, key.definitionId, branch.revisionOrdinal,
        branch.predecessorRevisionId, branch.sourceVersionId, branch.evidenceSnapshotId,
        branch.knowledgeRevisionId, branch.frontierRevisionId, branch.schemaVersion, payload,
        integrity.hash(payload), integrity.sign(payload), branch.createdAt);
    const callsBefore = authorityCalls(); disableAuthority();
    expect(() => store.loadRevisionVerified(key, first.id)).toThrow("integrity_mismatch");
    expect(authorityCalls()).toBe(callsBefore);
  });

  test("rejects a changed source version under an existing command", () => {
    const { store } = open(); const cursor = store.loadEffectiveVerified(key).cursor; const input = replacement(); store.appendReplacement(input, cursor);
    expect(() => store.appendReplacement({ ...input, sourceVersion: { ...input.sourceVersion, finalUrl: "https://www.policija.si/changed" } }, cursor)).toThrow("integrity_mismatch");
  });

  test("rejects a changed attempt under an existing command", () => {
    const { store } = open(); const cursor = store.loadEffectiveVerified(key).cursor; const input = replacement(); store.appendReplacement(input, cursor);
    expect(() => store.appendReplacement({ ...input, attempt: { ...input.attempt, id: "attempt:changed" } }, cursor)).toThrow("integrity_mismatch");
  });

  test("rejects a tampered immutable schema when reopened", () => {
    const { store, path } = open(); const cursor = store.loadEffectiveVerified(key).cursor;
    store.appendReplacement(replacement(), cursor);
    const database = databases[0]!;
    expect(() => database.prepare("UPDATE city_source_versions SET payload_json = '{}' WHERE id = ?").run("source:replacement")).toThrow("city_source_version_is_immutable");
    database.exec("DROP TRIGGER city_source_versions_no_update");
    database.prepare("UPDATE city_source_versions SET payload_json = '{}' WHERE id = ?").run("source:replacement");
    database.close();
    const reopened = new Database(path); reopened.pragma("foreign_keys = ON");
    expect(() => new SqliteCitySourceRecoveryStore(reopened, integrity, Object.freeze({ loadVerified: () => authority() }), Object.freeze({ requireVerified: () => undefined })).loadEffectiveVerified(key)).toThrow("integrity_mismatch"); reopened.close();
  });

  test("does not create a head when the truth authority rejects the lineage", () => {
    const { store } = open(true); const cursor = store.loadEffectiveVerified(key).cursor;
    expect(() => store.appendReplacement(replacement(), cursor)).toThrow("integrity_mismatch");
    expect(databases[0]!.prepare("SELECT COUNT(*) AS count FROM city_source_binding_heads").get()).toEqual({ count: 0 });
  });

  test("rejects a hostile replacement command accessor before recovery writes", () => {
    const { store } = open(); const cursor = store.loadEffectiveVerified(key).cursor; const input = replacement(); let commandReads = 0;
    const hostile = { sourceVersion: input.sourceVersion, revision: input.revision, attempt: input.attempt };
    Object.defineProperty(hostile, "commandId", { enumerable: true, get: () => { commandReads += 1; return commandReads === 1 ? input.commandId : "command:split"; } });
    let failure: unknown;
    try { store.appendReplacement(hostile as unknown as Parameters<SqliteCitySourceRecoveryStore["appendReplacement"]>[0], cursor); } catch (caught) { failure = caught; }
    expect(commandReads).toBe(0);
    expect(failure).toMatchObject({ message: "integrity_mismatch" });
    for (const table of ["city_source_versions", "city_source_binding_revisions", "city_source_binding_heads", "official_source_recovery_attempts", "official_source_replacement_events"]) expect(databases[0]!.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()).toEqual({ count: 0 });
  });

  test("rolls every recovery write back when a truth FK is missing", () => {
    const { store } = open(); const cursor = store.loadEffectiveVerified(key).cursor; const input = replacement();
    expect(() => store.appendReplacement({ ...input, revision: { ...input.revision, knowledgeRevisionId: "knowledge:missing" } }, cursor)).toThrow("FOREIGN KEY constraint failed");
    for (const table of ["city_source_versions", "city_source_binding_revisions", "city_source_binding_heads", "official_source_recovery_attempts", "official_source_replacement_events"]) expect(databases[0]!.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()).toEqual({ count: 0 });
  });

  test("rolls an accepted replacement back when its shared continuation unit fails later", () => {
    const { store } = open(); const database = databases[0]!;
    const cursor = store.loadEffectiveVerified(key).cursor;
    expect(() => new SqliteCityContinuationUnitOfWork(database).run(() => {
      store.appendReplacementInTransaction(replacement(), cursor);
      throw new Error("injected_after_replacement");
    })).toThrow("injected_after_replacement");
    for (const table of ["city_source_versions", "city_source_binding_revisions", "city_source_binding_heads", "official_source_recovery_attempts", "official_source_replacement_events"]) {
      expect(database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()).toEqual({ count: 0 });
    }
  });

  test("rolls a yellow attempt back when the shared continuation unit loses ownership", () => {
    const { store } = open(); const database = databases[0]!;
    const attempt = { schemaVersion: "official-source-recovery-attempt@1" as const, id: "attempt:yellow",
      commandId: "command:yellow", bindingKey: key, cursor: { schemaVersion: "city-source-binding-cursor@1" as const,
        kind: "installed" as const, installedBindingDigest: digest() }, outcome: "yellow" as const,
      createdAt: "2026-08-29T12:01:00.000Z" };
    expect(() => new SqliteCityContinuationUnitOfWork(database).run(() => {
      store.appendYellowAttemptInTransaction(attempt);
      throw new Error("continuation_owner_detached");
    })).toThrow("continuation_owner_detached");
    expect(database.prepare("SELECT COUNT(*) AS count FROM official_source_recovery_attempts").get()).toEqual({ count: 0 });
  });

  test("rejects a thenable operation before committing its transaction", () => {
    const { store } = open(); const database = databases[0]!;
    const cursor = store.loadEffectiveVerified(key).cursor;
    expect(() => new SqliteCityContinuationUnitOfWork(database).run(() => {
      store.appendReplacementInTransaction(replacement(), cursor);
      return { then: () => undefined };
    })).toThrow("city_continuation_uow_async_operation");
    expect(database.prepare("SELECT COUNT(*) AS count FROM city_source_binding_heads").get())
      .toEqual({ count: 0 });
    expect(cursor.kind).toBe("installed");
  });

  test("rejects a tampered persisted replacement event mirror", () => {
    const { store } = open(); const cursor = store.loadEffectiveVerified(key).cursor; const input = replacement(); store.appendReplacement(input, cursor); const database = databases[0]!;
    database.exec("DROP TRIGGER official_source_replacement_events_no_update"); database.prepare("UPDATE official_source_replacement_events SET created_at = ? WHERE command_id = ?").run("2026-08-29T12:02:00.000Z", input.commandId);
    expect(() => store.appendReplacement(input, cursor)).toThrow("integrity_mismatch");
  });

  test.each([
    ["source version", "city_source_versions", "city_source_versions_no_update", "id", "source:replacement", "effective"],
    ["binding revision", "city_source_binding_revisions", "city_source_binding_revisions_no_update", "id", "binding:one", "history"],
    ["recovery attempt", "official_source_recovery_attempts", "official_source_recovery_attempts_no_update", "command_id", "command:one", "replay"],
  ])("rejects a tampered %s SQL mirror", (_kind, table, trigger, lookup, value, operation) => {
    const { store } = open(); const cursor = store.loadEffectiveVerified(key).cursor; const input = replacement(); store.appendReplacement(input, cursor); const database = databases[0]!;
    database.exec(`DROP TRIGGER ${trigger}`); database.prepare(`UPDATE ${table} SET created_at = ? WHERE ${lookup} = ?`).run("2026-08-29T12:02:00.000Z", value);
    expect(() => { if (operation === "effective") store.loadEffectiveVerified(key); else if (operation === "history") store.loadHistoryVerified(key); else store.appendReplacement(input, cursor); }).toThrow("integrity_mismatch");
  });
});
