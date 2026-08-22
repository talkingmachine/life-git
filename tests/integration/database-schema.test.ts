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

function storedSchema(database: Database.Database): readonly unknown[] {
  return database.prepare(`
    SELECT type, name, sql FROM sqlite_master
    WHERE name NOT LIKE 'sqlite_%'
    ORDER BY type, name
  `).all();
}

function replaceStoredSchemaLiteral(
  database: Database.Database,
  objectName: string,
  expectedLiteral: string,
  alteredLiteral: string,
): void {
  const row = database.prepare(
    "SELECT type, sql FROM sqlite_master WHERE name = ?",
  ).get(objectName) as { readonly type: string; readonly sql: string } | undefined;
  if (row === undefined || !row.sql.includes(expectedLiteral)) {
    throw new Error("schema_test_fixture_mismatch");
  }
  const alteredSql = row.sql.replace(expectedLiteral, alteredLiteral);
  if (row.type === "table" && objectName === "onboarding_confirmations") {
    const triggers = database.prepare(`
      SELECT sql FROM sqlite_master
      WHERE type = 'trigger' AND tbl_name = 'onboarding_confirmations'
      ORDER BY name
    `).all() as Array<{ readonly sql: string }>;
    database.exec(`
      DROP TRIGGER onboarding_confirmations_no_update;
      DROP TRIGGER onboarding_confirmations_no_delete;
      DROP TABLE onboarding_confirmations;
    `);
    database.exec(alteredSql);
    for (const trigger of triggers) database.exec(trigger.sql);
    return;
  }
  if (row.type === "trigger" && objectName === "onboarding_confirmations_no_delete") {
    database.exec("DROP TRIGGER onboarding_confirmations_no_delete");
    database.exec(alteredSql);
    return;
  }
  throw new Error("schema_test_fixture_mismatch");
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
      { name: "city_evidence_snapshots" },
      { name: "country_knowledge_revisions" },
      { name: "country_resolution_revisions" },
      { name: "dossier_versions" },
      { name: "evidence_snapshots" },
      { name: "onboarding_confirmations" },
      { name: "place_frontier_snapshots" },
      { name: "profile_snapshots" },
      { name: "run_revisions" },
    ]);

    const cityEvidenceColumns = reopened.prepare(
      "PRAGMA table_info(city_evidence_snapshots)",
    ).all() as { readonly name: string }[];
    expect(cityEvidenceColumns.map(({ name }) => name)).toEqual([
      "id", "city_check_run_id", "frontier_run_id", "city_id", "country_code",
      "package_id", "package_schema_version", "catalog_revision_id", "criteria_snapshot_id",
      "ranking_snapshot_id", "evidence_rules_version", "context_hash", "assessment_at",
      "completed_at", "canonical_payload", "payload_hash", "hmac",
    ]);
    expect(cityEvidenceColumns.map(({ name }) => name)).not.toContain("rules_version");
    expect(reopened.prepare(`
      SELECT type, name FROM sqlite_master
      WHERE name LIKE 'city_evidence_%'
      ORDER BY type, name
    `).all()).toEqual([
      { type: "table", name: "city_evidence_snapshots" },
      { type: "trigger", name: "city_evidence_snapshots_no_delete" },
      { type: "trigger", name: "city_evidence_snapshots_no_update" },
    ]);

    const onboardingColumns = reopened.prepare(
      "PRAGMA table_info(onboarding_confirmations)",
    ).all() as { readonly name: string }[];
    expect(onboardingColumns.map(({ name }) => name)).toEqual([
      "schema_version",
      "receipt_id",
      "completion_command_id",
      "confirmation_digest",
      "profile_id",
      "preference_profile_id",
      "frontier_run_id",
      "confirmed_at",
      "provenance_json",
      "versions_json",
    ]);
    expect(onboardingColumns.map(({ name }) => name)).not.toEqual(expect.arrayContaining([
      "chat",
      "messages",
      "raw_input",
      "source_spans",
      "prompt",
      "raw_output",
    ]));

    const onboardingForeignKeys = reopened.prepare(
      "PRAGMA foreign_key_list(onboarding_confirmations)",
    ).all() as Array<{
      readonly table: string;
      readonly from: string;
      readonly to: string;
      readonly on_update: string;
      readonly on_delete: string;
      readonly match: string;
    }>;
    expect(onboardingForeignKeys.map((entry) => ({
      table: entry.table,
      from: entry.from,
      to: entry.to,
      onUpdate: entry.on_update,
      onDelete: entry.on_delete,
      match: entry.match,
    })).sort((left, right) => left.from.localeCompare(right.from))).toEqual([
      {
        table: "profile_snapshots",
        from: "preference_profile_id",
        to: "id",
        onUpdate: "NO ACTION",
        onDelete: "NO ACTION",
        match: "NONE",
      },
      {
        table: "profile_snapshots",
        from: "profile_id",
        to: "id",
        onUpdate: "NO ACTION",
        onDelete: "NO ACTION",
        match: "NONE",
      },
    ]);
    expect(onboardingForeignKeys.some(({ from }) => from === "frontier_run_id")).toBe(false);

    const onboardingUniqueIndexes = reopened.prepare(
      "PRAGMA index_list(onboarding_confirmations)",
    ).all() as Array<{ readonly name: string; readonly unique: number }>;
    const uniqueColumnSets = onboardingUniqueIndexes
      .filter(({ unique }) => unique === 1)
      .map(({ name }) => (reopened.prepare(`PRAGMA index_info('${name}')`).all() as
        Array<{ readonly name: string }>).map(({ name: column }) => column).join(","))
      .sort();
    expect(uniqueColumnSets).toEqual([
      "completion_command_id",
      "confirmed_at",
      "frontier_run_id",
      "profile_id,preference_profile_id",
      "receipt_id",
    ]);
    expect(reopened.prepare(`
      SELECT type, name FROM sqlite_master
      WHERE name LIKE 'onboarding_confirmations_%'
      ORDER BY type, name
    `).all()).toEqual([
      { type: "trigger", name: "onboarding_confirmations_no_delete" },
      { type: "trigger", name: "onboarding_confirmations_no_update" },
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

  test("rejects an incompatible existing City Evidence overlay table before schema execution", () => {
    // Break caught: silently reusing a pre-context City overlay schema with ambiguous rules columns.
    const path = temporaryDatabasePath();
    const incompatible = track(new Database(path));
    incompatible.exec("CREATE TABLE city_evidence_snapshots (id TEXT PRIMARY KEY, rules_version TEXT)");
    incompatible.close();

    expect(() => openEvidenceDatabase(path)).toThrow("database_schema_reset_required");

    const verification = track(new Database(path, { readonly: true }));
    expect(verification.prepare(
      "SELECT sql FROM sqlite_master WHERE name = 'city_evidence_snapshots'",
    ).get()).toEqual({
      sql: "CREATE TABLE city_evidence_snapshots (id TEXT PRIMARY KEY, rules_version TEXT)",
    });
  });

  test("rejects an incompatible existing onboarding confirmation table before schema execution", () => {
    // Break caught: CREATE IF NOT EXISTS silently accepting a partial confirmation binding.
    const path = temporaryDatabasePath();
    const incompatible = track(new Database(path));
    incompatible.exec("CREATE TABLE onboarding_confirmations (receipt_id TEXT PRIMARY KEY)");
    incompatible.close();

    expect(() => openEvidenceDatabase(path)).toThrow("database_schema_reset_required");

    const verification = track(new Database(path, { readonly: true }));
    expect(verification.prepare(
      "SELECT sql FROM sqlite_master WHERE name = 'onboarding_confirmations'",
    ).get()).toEqual({
      sql: "CREATE TABLE onboarding_confirmations (receipt_id TEXT PRIMARY KEY)",
    });
    expect(verification.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    ).all()).toEqual([{ name: "onboarding_confirmations" }]);
  });

  test("rejects the full onboarding column shape with a weakened schema constraint", () => {
    // Break caught: preflighting by column names while silently accepting weaker checks.
    const path = temporaryDatabasePath();
    track(openEvidenceDatabase(path)).close();
    const incompatible = track(new Database(path));
    incompatible.exec(`
      DROP TRIGGER onboarding_confirmations_no_update;
      DROP TRIGGER onboarding_confirmations_no_delete;
      DROP TABLE onboarding_confirmations;
      CREATE TABLE onboarding_confirmations (
        schema_version TEXT NOT NULL CHECK (schema_version IN (
          'onboarding-receipt@1', 'onboarding-receipt@2'
        )),
        receipt_id TEXT PRIMARY KEY,
        completion_command_id TEXT NOT NULL UNIQUE,
        confirmation_digest TEXT NOT NULL CHECK (
          length(confirmation_digest) = 64
          AND confirmation_digest NOT GLOB '*[^0-9a-f]*'
        ),
        profile_id TEXT NOT NULL REFERENCES profile_snapshots(id),
        preference_profile_id TEXT NOT NULL REFERENCES profile_snapshots(id),
        frontier_run_id TEXT NOT NULL UNIQUE,
        confirmed_at TEXT NOT NULL UNIQUE,
        provenance_json TEXT NOT NULL,
        versions_json TEXT NOT NULL,
        UNIQUE (profile_id, preference_profile_id),
        CHECK (profile_id <> preference_profile_id)
      );
      CREATE TRIGGER onboarding_confirmations_no_update
      BEFORE UPDATE ON onboarding_confirmations
      BEGIN
        SELECT RAISE(ABORT, 'onboarding_confirmation_is_immutable');
      END;
      CREATE TRIGGER onboarding_confirmations_no_delete
      BEFORE DELETE ON onboarding_confirmations
      BEGIN
        SELECT RAISE(ABORT, 'onboarding_confirmation_is_immutable');
      END;
    `);
    incompatible.close();

    expect(() => openEvidenceDatabase(path)).toThrow("database_schema_reset_required");
  });

  test("rejects whitespace inserted inside the exact schema-version quoted literal", () => {
    // Break caught: deleting literal whitespace while compacting stored table SQL for preflight.
    const path = temporaryDatabasePath();
    track(openEvidenceDatabase(path)).close();
    const tampered = track(new Database(path));
    replaceStoredSchemaLiteral(
      tampered,
      "onboarding_confirmations",
      "'onboarding-receipt@1'",
      "'onboarding-receipt @1'",
    );
    const before = storedSchema(tampered);
    tampered.close();

    let openError: unknown;
    try {
      track(openEvidenceDatabase(path));
    } catch (error) {
      openError = error;
    }
    expect(openError).toEqual(expect.objectContaining({
      message: "database_schema_reset_required",
    }));

    const verification = track(new Database(path, { readonly: true }));
    expect(storedSchema(verification)).toEqual(before);
  });

  test("rejects whitespace inserted inside an exact trigger error literal", () => {
    // Break caught: deleting literal whitespace while compacting stored trigger SQL for preflight.
    const path = temporaryDatabasePath();
    track(openEvidenceDatabase(path)).close();
    const tampered = track(new Database(path));
    replaceStoredSchemaLiteral(
      tampered,
      "onboarding_confirmations_no_delete",
      "'onboarding_confirmation_is_immutable'",
      "'onboarding_confirmation_is_ immutable'",
    );
    const before = storedSchema(tampered);
    tampered.close();

    let openError: unknown;
    try {
      track(openEvidenceDatabase(path));
    } catch (error) {
      openError = error;
    }
    expect(openError).toEqual(expect.objectContaining({
      message: "database_schema_reset_required",
    }));

    const verification = track(new Database(path, { readonly: true }));
    expect(storedSchema(verification)).toEqual(before);
  });

  test("rejects ASCII whitespace that changes an exact column token boundary", () => {
    // Break caught: compacting distinct column/type tokens into the expected application column.
    const path = temporaryDatabasePath();
    track(openEvidenceDatabase(path)).close();
    const tampered = track(new Database(path));
    replaceStoredSchemaLiteral(
      tampered,
      "onboarding_confirmations",
      "versions_json TEXT NOT NULL",
      "versions_ json TEXT NOT NULL",
    );
    const before = storedSchema(tampered);
    tampered.close();

    let openError: unknown;
    try {
      track(openEvidenceDatabase(path));
    } catch (error) {
      openError = error;
    }
    expect(openError).toEqual(expect.objectContaining({
      message: "database_schema_reset_required",
    }));

    const verification = track(new Database(path, { readonly: true }));
    expect(storedSchema(verification)).toEqual(before);
  });

  test("rejects non-breaking whitespace retained inside an exact identifier", () => {
    // Break caught: deleting a non-ASCII identifier character into the expected application column.
    const path = temporaryDatabasePath();
    track(openEvidenceDatabase(path)).close();
    const tampered = track(new Database(path));
    replaceStoredSchemaLiteral(
      tampered,
      "onboarding_confirmations",
      "versions_json TEXT NOT NULL",
      "versions_\u00a0json TEXT NOT NULL",
    );
    const before = storedSchema(tampered);
    tampered.close();

    let openError: unknown;
    try {
      track(openEvidenceDatabase(path));
    } catch (error) {
      openError = error;
    }
    expect(openError).toEqual(expect.objectContaining({
      message: "database_schema_reset_required",
    }));

    const verification = track(new Database(path, { readonly: true }));
    expect(storedSchema(verification)).toEqual(before);
  });

  test("rejects a missing or altered onboarding immutability trigger on reopen", () => {
    // Break caught: healing or tolerating a database whose durable receipts became mutable.
    const path = temporaryDatabasePath();
    track(openEvidenceDatabase(path)).close();
    const tampered = track(new Database(path));
    tampered.exec(`
      DROP TRIGGER onboarding_confirmations_no_update;
      CREATE TRIGGER onboarding_confirmations_no_update
      BEFORE UPDATE ON onboarding_confirmations
      BEGIN
        SELECT RAISE(ABORT, 'wrong_error');
      END;
    `);
    tampered.close();

    expect(() => openEvidenceDatabase(path)).toThrow("database_schema_reset_required");
  });

  test.each(["missing", "altered"] as const)(
    "rejects a %s onboarding delete trigger on reopen",
    (mode) => {
      // Break caught: checking only update immutability while deletes remain unguarded.
      const path = temporaryDatabasePath();
      track(openEvidenceDatabase(path)).close();
      const tampered = track(new Database(path));
      tampered.exec("DROP TRIGGER onboarding_confirmations_no_delete");
      if (mode === "altered") {
        tampered.exec(`
          CREATE TRIGGER onboarding_confirmations_no_delete
          BEFORE DELETE ON onboarding_confirmations
          BEGIN
            SELECT RAISE(ABORT, 'wrong_error');
          END;
        `);
      }
      tampered.close();

      expect(() => openEvidenceDatabase(path)).toThrow("database_schema_reset_required");
    },
  );

  test("onboarding confirmation triggers reject update and delete", () => {
    // Break caught: a confirmation row becoming mutable after it is issued.
    const database = track(openEvidenceDatabase(":memory:"));
    database.prepare(`
      INSERT INTO profile_snapshots (id, confirmed_at, snapshot_json, snapshot_hash)
      VALUES (?, ?, '{}', ?), (?, ?, '{}', ?)
    `).run(
      "a".repeat(64),
      "2026-08-22T10:00:00.000Z",
      "0".repeat(64),
      "b".repeat(64),
      "2026-08-22T10:00:00.000Z",
      "0".repeat(64),
    );
    database.prepare(`
      INSERT INTO onboarding_confirmations (
        schema_version, receipt_id, completion_command_id, confirmation_digest,
        profile_id, preference_profile_id, frontier_run_id, confirmed_at,
        provenance_json, versions_json
      ) VALUES ('onboarding-receipt@1', ?, ?, ?, ?, ?, ?, ?, '{}', '{}')
    `).run(
      "receipt",
      "00000000-0000-4000-8000-000000000010",
      "c".repeat(64),
      "a".repeat(64),
      "b".repeat(64),
      "frontier",
      "2026-08-22T10:00:00.000Z",
    );

    expect(() => database.prepare(`
      UPDATE onboarding_confirmations SET confirmed_at = confirmed_at WHERE receipt_id = 'receipt'
    `).run()).toThrow("onboarding_confirmation_is_immutable");
    expect(() => database.prepare(`
      DELETE FROM onboarding_confirmations WHERE receipt_id = 'receipt'
    `).run()).toThrow("onboarding_confirmation_is_immutable");
  });
});
