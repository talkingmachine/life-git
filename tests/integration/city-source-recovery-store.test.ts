import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import Database from "better-sqlite3";
import { afterEach, describe, expect, test } from "vitest";

import type { CitySourceBindingKeyV1, CitySourceVersionV1 } from "../../src/application/city-source-recovery-contracts";
import { SqliteCitySourceRecoveryStore } from "../../src/infrastructure/sqlite/city-source-recovery-store";
import { createEvidenceIntegrity } from "../../src/infrastructure/integrity";

const directories: string[] = [];
const databases: Database.Database[] = [];
const key: CitySourceBindingKeyV1 = Object.freeze({ schemaVersion: "city-source-binding-key@1", countryCode: "SI", cityId: "ljubljana", factKey: "si-city-safety", definitionId: "si-municipal-police-offences-per-100000@1" });
const version = (id: string): CitySourceVersionV1 => Object.freeze({ schemaVersion: "source-version@1", id, bindingKey: key, publisherId: "policija", navigationUrl: "https://www.policija.si/", requestedUrl: "https://www.policija.si/statistics", finalUrl: "https://www.policija.si/statistics", captureArtifactIds: Object.freeze(["artifact:one"]), captureSha256: Object.freeze(["a".repeat(64)]), evidenceSnapshotId: "evidence:one", parserVersion: "parser@1", capturedAt: "2026-08-29T12:00:00.000Z" });
const integrity = createEvidenceIntegrity("source-recovery-test-key");
function authority() { return Object.freeze({ bindingKey: key, sourceVersion: version("source:installed") }); }
function digest() { const value = authority(); return integrity.hash(integrity.canonical(value)); }
function recoveryDdl(): string { const schema = readFileSync(resolve("src/infrastructure/sqlite/schema.sql"), "utf8"); return schema.split("-- city-source-recovery-ddl:start\n")[1]!.split("-- city-source-recovery-ddl:end")[0]!; }
function open(truthFails = false) { const dir = mkdtempSync(join(tmpdir(), "source-recovery-")); directories.push(dir); const path = join(dir, "db.sqlite"); const db = new Database(path); db.pragma("foreign_keys = ON"); db.exec("CREATE TABLE city_evidence_snapshots(id TEXT PRIMARY KEY); CREATE TABLE city_knowledge_revisions(id TEXT PRIMARY KEY); CREATE TABLE city_frontier_revisions(id TEXT PRIMARY KEY);"); db.exec(recoveryDdl()); db.prepare("INSERT INTO city_evidence_snapshots VALUES(?)").run("evidence:one"); db.prepare("INSERT INTO city_knowledge_revisions VALUES(?)").run("knowledge:one"); db.prepare("INSERT INTO city_frontier_revisions VALUES(?)").run("frontier:one"); databases.push(db); return { store: new SqliteCitySourceRecoveryStore(db, integrity, Object.freeze({ loadVerified: (requested: CitySourceBindingKeyV1) => requested.cityId === key.cityId ? authority() : undefined }), Object.freeze({ requireVerified: () => { if (truthFails) throw new Error("truth_missing"); } })), path }; }
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
});
