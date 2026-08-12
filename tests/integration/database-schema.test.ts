import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3";
import { afterEach, describe, expect, test } from "vitest";

import { openEvidenceDatabase } from "../../src/infrastructure/sqlite/db";

const databases: Database.Database[] = [];
const temporaryDirectories: string[] = [];

const CURRENT_STAGE_SHAPE_CHECK = `
  CHECK (
    (
      stage = 'assessment' AND
      initial_housing_json IS NOT NULL AND assessment_json IS NOT NULL AND
      parent_revision_id IS NULL AND branch_commit_id IS NULL AND
      formula_hash IS NULL AND output_hash IS NULL
    ) OR (
      stage = 'branch' AND
      initial_housing_json IS NULL AND assessment_json IS NULL AND
      parent_revision_id IS NOT NULL AND branch_commit_id IS NOT NULL AND
      formula_hash IS NOT NULL AND output_hash IS NOT NULL AND
      length(formula_hash) = 64 AND formula_hash NOT GLOB '*[^0-9A-Fa-f]*' AND
      length(output_hash) = 64 AND output_hash NOT GLOB '*[^0-9A-Fa-f]*'
    )
  )`;

afterEach(() => {
  for (const database of databases.splice(0)) {
    if (database.open) database.close();
  }
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function temporaryDatabasePath(): string {
  const directory = mkdtempSync(join(tmpdir(), "confirmed-life-schema-"));
  temporaryDirectories.push(directory);
  return join(directory, "evidence.sqlite");
}

function track(database: Database.Database): Database.Database {
  databases.push(database);
  return database;
}

function createRunRevisionsSchema(
  path: string,
  options: { readonly stageShapeCheck: boolean; readonly branchCommitForeignKey: boolean },
): Database.Database {
  const database = track(new Database(path));
  database.exec(`
    CREATE TABLE run_revisions (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      stage TEXT NOT NULL CHECK (stage IN ('assessment', 'branch')),
      assessment_date TEXT NOT NULL,
      initial_housing_json TEXT,
      profile_id TEXT NOT NULL REFERENCES profile_snapshots(id),
      evidence_snapshot_id TEXT NOT NULL REFERENCES evidence_snapshots(id),
      assessment_id TEXT NOT NULL,
      assessment_json TEXT,
      rules_version TEXT NOT NULL,
      parent_revision_id TEXT REFERENCES run_revisions(id),
      branch_commit_id TEXT ${options.branchCommitForeignKey ? "REFERENCES branch_commits(id)" : ""},
      formula_hash TEXT,
      output_hash TEXT,
      revision_json TEXT NOT NULL,
      hmac TEXT NOT NULL
      ${options.stageShapeCheck ? `,${CURRENT_STAGE_SHAPE_CHECK}` : ""}
    )
  `);
  return database;
}

describe("database schema preflight", () => {
  test("rejects an existing incompatible country Knowledge table before schema execution", () => {
    const path = temporaryDatabasePath();
    const incompatible = track(new Database(path));
    incompatible.exec("CREATE TABLE country_knowledge_revisions (id TEXT PRIMARY KEY)");
    incompatible.close();

    expect(() => openEvidenceDatabase(path)).toThrow("database_schema_reset_required");

    const verification = track(new Database(path, { readonly: true }));
    expect(verification.prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'country_knowledge_revisions'",
    ).get()).toEqual({ sql: "CREATE TABLE country_knowledge_revisions (id TEXT PRIMARY KEY)" });
  });

  test("rejects a representative e506 schema before its unsafe mixed row can be used", () => {
    const path = temporaryDatabasePath();
    const legacy = createRunRevisionsSchema(path, {
      stageShapeCheck: false,
      branchCommitForeignKey: false,
    });
    legacy.pragma("foreign_keys = OFF");
    legacy.prepare(`
      INSERT INTO run_revisions (
        id, run_id, stage, assessment_date, initial_housing_json, profile_id,
        evidence_snapshot_id, assessment_id, assessment_json, rules_version,
        parent_revision_id, branch_commit_id, formula_hash, output_hash, revision_json, hmac
      ) VALUES (?, ?, 'assessment', ?, '{}', ?, ?, ?, '{}', ?, NULL, ?, ?, ?, '{}', ?)
    `).run(
      "legacy-revision",
      "legacy-run",
      "2026-08-07",
      "legacy-profile",
      "legacy-evidence",
      "legacy-assessment",
      "vs1-assessment@1",
      "orphan-branch-commit",
      "short",
      "not-hex",
      "legacy-hmac",
    );
    legacy.close();

    let opened: Database.Database | undefined;
    expect(() => {
      opened = openEvidenceDatabase(path);
    }).toThrow("database_schema_reset_required");
    expect(opened).toBeUndefined();

    const verification = track(new Database(path, { readonly: true }));
    expect(verification.prepare("SELECT COUNT(*) AS count FROM run_revisions").get()).toEqual({ count: 1 });
    expect(verification.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    ).all()).toEqual([{ name: "run_revisions" }]);
  });

  test("rejects a schema with the current stage check but no branch-commit foreign key", () => {
    const path = temporaryDatabasePath();
    createRunRevisionsSchema(path, {
      stageShapeCheck: true,
      branchCommitForeignKey: false,
    }).close();

    expect(() => openEvidenceDatabase(path)).toThrow("database_schema_reset_required");
  });

  test("rejects a schema with the branch-commit foreign key but no current stage check", () => {
    const path = temporaryDatabasePath();
    createRunRevisionsSchema(path, {
      stageShapeCheck: false,
      branchCommitForeignKey: true,
    }).close();

    expect(() => openEvidenceDatabase(path)).toThrow("database_schema_reset_required");
  });

  test("reopens the exact current schema idempotently without adding application tables", () => {
    const path = temporaryDatabasePath();
    track(openEvidenceDatabase(path)).close();

    const reopened = track(openEvidenceDatabase(path));
    expect(reopened.pragma("foreign_keys", { simple: true })).toBe(1);
    expect(reopened.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    ).all()).toEqual([
      { name: "artifacts" },
      { name: "branch_commits" },
      { name: "country_knowledge_revisions" },
      { name: "country_resolution_revisions" },
      { name: "dossier_versions" },
      { name: "evidence_snapshots" },
      { name: "place_frontier_snapshots" },
      { name: "profile_snapshots" },
      { name: "run_revisions" },
    ]);

    expect(reopened.prepare(`
      SELECT type, name FROM sqlite_master
      WHERE name LIKE 'country_knowledge_%'
        AND type IN ('index', 'trigger')
      ORDER BY type, name
    `).all()).toEqual([
      { type: "index", name: "country_knowledge_one_root" },
      { type: "index", name: "country_knowledge_one_successor" },
      { type: "trigger", name: "country_knowledge_revisions_no_delete" },
      { type: "trigger", name: "country_knowledge_revisions_no_update" },
    ]);

    expect(reopened.prepare(`
      SELECT type, name FROM sqlite_master
      WHERE name LIKE 'dossier_versions_%'
      ORDER BY type, name
    `).all()).toEqual([
      { type: "index", name: "dossier_versions_one_root" },
      { type: "index", name: "dossier_versions_one_successor" },
      { type: "trigger", name: "dossier_versions_no_delete" },
      { type: "trigger", name: "dossier_versions_no_update" },
    ]);

    expect(reopened.prepare(`
      SELECT type, name FROM sqlite_master
      WHERE name LIKE 'place_frontier_%'
      ORDER BY type, name
    `).all()).toEqual([
      { type: "table", name: "place_frontier_snapshots" },
      { type: "trigger", name: "place_frontier_snapshots_no_delete" },
      { type: "trigger", name: "place_frontier_snapshots_no_update" },
    ]);

    const frontierColumns = reopened.prepare(
      "PRAGMA table_info(place_frontier_snapshots)",
    ).all() as { readonly name: string }[];
    expect(frontierColumns.map(({ name }) => name)).toEqual([
      "id",
      "run_id",
      "kind",
      "schema_version",
      "payload_json",
      "payload_hash",
      "hmac",
      "created_at",
    ]);

    const resolutionColumns = reopened.prepare(
      "PRAGMA table_info(country_resolution_revisions)",
    ).all() as { readonly name: string }[];
    expect(resolutionColumns.map(({ name }) => name)).toEqual([
      "id", "resolution_run_id", "kind", "predecessor_id",
      "automatic_shortlist_snapshot_id", "ranking_snapshot_id", "command_id", "command_kind",
      "command_json", "command_hash", "schema_version", "rules_version", "context_hash",
      "payload_json", "payload_hash", "hmac", "created_at",
    ]);
    expect(reopened.prepare(`
      SELECT type, name FROM sqlite_master
      WHERE name LIKE 'country_resolution_%' AND type IN ('index', 'trigger')
      ORDER BY type, name
    `).all()).toEqual([
      { type: "index", name: "country_resolution_one_command" },
      { type: "index", name: "country_resolution_one_root" },
      { type: "index", name: "country_resolution_one_successor" },
      { type: "index", name: "country_resolution_one_terminal" },
      { type: "trigger", name: "country_resolution_revisions_no_delete" },
      { type: "trigger", name: "country_resolution_revisions_no_update" },
    ]);
  });

  test("rejects an incompatible existing country-resolution table without changing it", () => {
    const path = temporaryDatabasePath();
    const incompatible = track(new Database(path));
    incompatible.exec("CREATE TABLE country_resolution_revisions (id TEXT PRIMARY KEY)");
    incompatible.close();

    expect(() => openEvidenceDatabase(path)).toThrow("database_schema_reset_required");

    const verification = track(new Database(path, { readonly: true }));
    expect(verification.prepare(
      "SELECT sql FROM sqlite_master WHERE name = 'country_resolution_revisions'",
    ).get()).toEqual({ sql: "CREATE TABLE country_resolution_revisions (id TEXT PRIMARY KEY)" });
  });
});
