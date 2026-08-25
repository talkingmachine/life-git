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

const CURRENT_ARTIFACT_ORIGIN_CHECK = `CHECK (
    (origin = 'live'
      AND url IS NOT NULL AND captured_at IS NOT NULL AND response_status IS NOT NULL
      AND response_url IS NOT NULL AND request_json IS NOT NULL
      AND producer IS NULL AND created_at IS NULL)
    OR
    (origin = 'administrative'
      AND url IS NULL AND captured_at IS NULL AND response_status IS NULL
      AND response_url IS NULL AND request_json IS NULL
      AND producer IS NOT NULL AND length(producer) > 0
      AND created_at IS NOT NULL AND length(created_at) > 0)
  )`;

const CURRENT_CITY_CATALOG_SQL = `CREATE TABLE city_catalog_revisions (
  id TEXT PRIMARY KEY,
  registry_revision_id TEXT NOT NULL,
  country_code TEXT NOT NULL CHECK (
    length(country_code) = 2
    AND country_code = upper(country_code)
    AND country_code GLOB '[A-Z][A-Z]'
  ),
  package_id TEXT NOT NULL,
  package_schema_version TEXT NOT NULL,
  registry_evidence_snapshot_id TEXT NOT NULL,
  catalog_evidence_snapshot_id TEXT NOT NULL,
  rules_version TEXT NOT NULL CHECK (
    rules_version IN ('city-catalog@1', 'city-catalog@2')
  ),
  created_at TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  payload_hash TEXT NOT NULL CHECK (length(payload_hash) = 64),
  hmac TEXT NOT NULL CHECK (length(hmac) = 64)
)`;

const CURRENT_CITY_KNOWLEDGE_SQL = `CREATE TABLE city_knowledge_revisions (
  id TEXT PRIMARY KEY,
  city_id TEXT NOT NULL,
  country_code TEXT NOT NULL CHECK (
    length(country_code) = 2
    AND country_code = upper(country_code)
    AND country_code GLOB '[A-Z][A-Z]'
  ),
  package_id TEXT NOT NULL,
  package_schema_version TEXT NOT NULL,
  rules_version TEXT NOT NULL,
  predecessor_id TEXT REFERENCES city_knowledge_revisions(id),
  evidence_snapshot_id TEXT NOT NULL REFERENCES city_evidence_snapshots(id),
  last_checked_at TEXT NOT NULL,
  knowledge_updated_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  payload_hash TEXT NOT NULL CHECK (length(payload_hash) = 64),
  hmac TEXT NOT NULL CHECK (length(hmac) = 64),
  CHECK (predecessor_id IS NULL OR predecessor_id <> id),
  UNIQUE (city_id, evidence_snapshot_id)
)`;

const CURRENT_INSTALLED_CITY_PACKAGE_MANIFESTS_SQL = `CREATE TABLE installed_city_package_manifests (
  id TEXT PRIMARY KEY,
  country_code TEXT NOT NULL CHECK (
    length(country_code) = 2
    AND country_code = upper(country_code)
    AND country_code GLOB '[A-Z][A-Z]'
  ),
  package_id TEXT NOT NULL,
  package_schema_version TEXT NOT NULL,
  catalog_revision_id TEXT NOT NULL REFERENCES city_catalog_revisions(id),
  evidence_rules_version TEXT NOT NULL,
  predecessor_manifest_id TEXT REFERENCES installed_city_package_manifests(id),
  administrative_evidence_snapshot_id TEXT NOT NULL REFERENCES evidence_snapshots(id),
  installed_at TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  payload_hash TEXT NOT NULL CHECK (length(payload_hash) = 64),
  hmac TEXT NOT NULL CHECK (length(hmac) = 64),
  CHECK (predecessor_manifest_id IS NULL OR predecessor_manifest_id <> id)
)`;

const CURRENT_INSTALLED_CITY_PACKAGE_HEADS_SQL = `CREATE TABLE installed_city_package_heads (
  country_code TEXT PRIMARY KEY CHECK (
    length(country_code) = 2
    AND country_code = upper(country_code)
    AND country_code GLOB '[A-Z][A-Z]'
  ),
  current_manifest_id TEXT NOT NULL UNIQUE,
  FOREIGN KEY (country_code, current_manifest_id)
    REFERENCES installed_city_package_manifests(country_code, id)
)`;

const TASK_13_TABLE_SQL = {
  city_criteria_snapshots: `CREATE TABLE city_criteria_snapshots (
    id TEXT PRIMARY KEY NOT NULL,
    profile_snapshot_id TEXT NOT NULL REFERENCES profile_snapshots(id),
    preference_profile_snapshot_id TEXT NOT NULL REFERENCES profile_snapshots(id),
    schema_version TEXT NOT NULL CHECK (schema_version = 'city-criteria@1'),
    rules_version TEXT NOT NULL CHECK (rules_version = 'city-criteria@1'),
    confirmed_at TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    payload_hash TEXT NOT NULL CHECK (
      length(payload_hash) = 64 AND payload_hash NOT GLOB '*[^0-9a-f]*'
    ),
    hmac TEXT NOT NULL CHECK (
      length(hmac) = 64 AND hmac NOT GLOB '*[^0-9a-f]*'
    ),
    CHECK (profile_snapshot_id <> preference_profile_snapshot_id)
  )`,
  city_selection_snapshots: `CREATE TABLE city_selection_snapshots (
    id TEXT PRIMARY KEY NOT NULL,
    run_id TEXT NOT NULL,
    command_id TEXT NOT NULL,
    terminal_revision_id TEXT NOT NULL REFERENCES city_frontier_revisions(id),
    city_id TEXT NOT NULL,
    country_code TEXT NOT NULL CHECK (
      length(country_code) = 2 AND country_code = upper(country_code)
      AND country_code GLOB '[A-Z][A-Z]'
    ),
    profile_snapshot_id TEXT NOT NULL REFERENCES profile_snapshots(id),
    preference_profile_snapshot_id TEXT NOT NULL REFERENCES profile_snapshots(id),
    resolved_country_shortlist_revision_id TEXT NOT NULL REFERENCES country_resolution_revisions(id),
    criteria_snapshot_id TEXT NOT NULL REFERENCES city_criteria_snapshots(id),
    ranking_snapshot_id TEXT NOT NULL REFERENCES city_ranking_snapshots(id),
    pre_city_branch_commit_id TEXT NOT NULL REFERENCES city_branch_commits(id),
    selected_marker_digest TEXT NOT NULL CHECK (
      length(selected_marker_digest) = 64
      AND selected_marker_digest NOT GLOB '*[^0-9a-f]*'
    ),
    knowledge_revision_id TEXT NOT NULL REFERENCES city_knowledge_revisions(id),
    evidence_snapshot_id TEXT NOT NULL REFERENCES city_evidence_snapshots(id),
    warning_copy_version TEXT CHECK (
      warning_copy_version IS NULL OR warning_copy_version = 'city-unknown-risk@1'
    ),
    schema_version TEXT NOT NULL CHECK (schema_version = 'city-selection@1'),
    command_json TEXT NOT NULL,
    command_hash TEXT NOT NULL CHECK (
      length(command_hash) = 64 AND command_hash NOT GLOB '*[^0-9a-f]*'
    ),
    payload_json TEXT NOT NULL,
    payload_hash TEXT NOT NULL CHECK (
      length(payload_hash) = 64 AND payload_hash NOT GLOB '*[^0-9a-f]*'
    ),
    hmac TEXT NOT NULL CHECK (
      length(hmac) = 64 AND hmac NOT GLOB '*[^0-9a-f]*'
    ),
    created_at TEXT NOT NULL,
    CHECK (profile_snapshot_id <> preference_profile_snapshot_id)
  )`,
  city_branch_commits: `CREATE TABLE city_branch_commits (
    id TEXT PRIMARY KEY NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('pre_city', 'selection')),
    profile_snapshot_id TEXT NOT NULL REFERENCES profile_snapshots(id),
    preference_profile_snapshot_id TEXT NOT NULL REFERENCES profile_snapshots(id),
    resolved_country_shortlist_revision_id TEXT NOT NULL REFERENCES country_resolution_revisions(id),
    country_code TEXT NOT NULL CHECK (
      length(country_code) = 2 AND country_code = upper(country_code)
      AND country_code GLOB '[A-Z][A-Z]'
    ),
    resolved_country_entry_digest TEXT NOT NULL CHECK (
      length(resolved_country_entry_digest) = 64
      AND resolved_country_entry_digest NOT GLOB '*[^0-9a-f]*'
    ),
    city_id TEXT,
    parent_id TEXT REFERENCES city_branch_commits(id),
    forked_from TEXT REFERENCES city_branch_commits(id),
    selection_snapshot_id TEXT REFERENCES city_selection_snapshots(id),
    schema_version TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    payload_hash TEXT NOT NULL CHECK (
      length(payload_hash) = 64 AND payload_hash NOT GLOB '*[^0-9a-f]*'
    ),
    hmac TEXT NOT NULL CHECK (
      length(hmac) = 64 AND hmac NOT GLOB '*[^0-9a-f]*'
    ),
    created_at TEXT NOT NULL,
    CHECK (profile_snapshot_id <> preference_profile_snapshot_id),
    CHECK (
      (kind = 'pre_city' AND schema_version = 'pre-city-branch@1'
        AND city_id IS NULL AND parent_id IS NULL AND forked_from IS NULL
        AND selection_snapshot_id IS NULL)
      OR
      (kind = 'selection' AND schema_version = 'city-branch@1'
        AND city_id IS NOT NULL AND parent_id IS NOT NULL AND forked_from IS NOT NULL
        AND selection_snapshot_id IS NOT NULL AND parent_id = forked_from)
    )
  )`,
  city_ranking_snapshots: `CREATE TABLE city_ranking_snapshots (
    id TEXT PRIMARY KEY NOT NULL,
    run_id TEXT NOT NULL,
    resolved_country_shortlist_revision_id TEXT NOT NULL REFERENCES country_resolution_revisions(id),
    country_code TEXT NOT NULL CHECK (
      length(country_code) = 2 AND country_code = upper(country_code)
      AND country_code GLOB '[A-Z][A-Z]'
    ),
    package_id TEXT NOT NULL,
    package_schema_version TEXT NOT NULL,
    registry_revision_id TEXT NOT NULL,
    catalog_revision_id TEXT NOT NULL REFERENCES city_catalog_revisions(id),
    criteria_snapshot_id TEXT NOT NULL REFERENCES city_criteria_snapshots(id),
    pre_city_branch_commit_id TEXT NOT NULL REFERENCES city_branch_commits(id),
    profile_snapshot_id TEXT NOT NULL REFERENCES profile_snapshots(id),
    preference_profile_snapshot_id TEXT NOT NULL REFERENCES profile_snapshots(id),
    evidence_rules_version TEXT NOT NULL,
    installed_package_context_json TEXT NOT NULL,
    live_city_candidate_limit INTEGER NOT NULL CHECK (live_city_candidate_limit = 10),
    target_selectable_cities INTEGER NOT NULL CHECK (target_selectable_cities = 3),
    budget_rules_version TEXT NOT NULL CHECK (budget_rules_version = 'city-frontier-budget@1'),
    schema_version TEXT NOT NULL CHECK (schema_version = 'city-ranking@1'),
    rules_version TEXT NOT NULL CHECK (rules_version = 'city-ranker@1'),
    assessment_at TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    payload_hash TEXT NOT NULL CHECK (
      length(payload_hash) = 64 AND payload_hash NOT GLOB '*[^0-9a-f]*'
    ),
    hmac TEXT NOT NULL CHECK (
      length(hmac) = 64 AND hmac NOT GLOB '*[^0-9a-f]*'
    ),
    created_at TEXT NOT NULL,
    CHECK (profile_snapshot_id <> preference_profile_snapshot_id),
    FOREIGN KEY (
      country_code, package_id, package_schema_version, catalog_revision_id, evidence_rules_version
    ) REFERENCES installed_city_package_manifests (
      country_code, package_id, package_schema_version, catalog_revision_id, evidence_rules_version
    )
  )`,
  city_frontier_revisions: `CREATE TABLE city_frontier_revisions (
    id TEXT PRIMARY KEY NOT NULL,
    run_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('working', 'terminal')),
    predecessor_id TEXT REFERENCES city_frontier_revisions(id),
    ranking_snapshot_id TEXT NOT NULL REFERENCES city_ranking_snapshots(id),
    operation_kind TEXT NOT NULL CHECK (operation_kind IN ('start', 'city_completed')),
    command_id TEXT NOT NULL,
    schema_version TEXT NOT NULL CHECK (schema_version = 'city-frontier@1'),
    command_json TEXT NOT NULL,
    command_hash TEXT NOT NULL CHECK (
      length(command_hash) = 64 AND command_hash NOT GLOB '*[^0-9a-f]*'
    ),
    payload_json TEXT NOT NULL,
    payload_hash TEXT NOT NULL CHECK (
      length(payload_hash) = 64 AND payload_hash NOT GLOB '*[^0-9a-f]*'
    ),
    hmac TEXT NOT NULL CHECK (
      length(hmac) = 64 AND hmac NOT GLOB '*[^0-9a-f]*'
    ),
    created_at TEXT NOT NULL,
    CHECK (
      (operation_kind = 'start' AND predecessor_id IS NULL)
      OR (operation_kind = 'city_completed' AND predecessor_id IS NOT NULL)
    ),
    CHECK (predecessor_id IS NULL OR predecessor_id <> id)
  )`,
} as const;

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, " ").trim();
}

function task13ReferenceDatabase(): Database.Database {
  const database = track(new Database(":memory:"));
  for (const sql of Object.values(TASK_13_TABLE_SQL)) database.exec(sql);
  return database;
}

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

interface DirectArtifactRow {
  readonly run_id: string;
  readonly artifact_id: string;
  readonly source_id: string;
  readonly role: string;
  readonly url: string | null;
  readonly media_type: string;
  readonly sha256: string;
  readonly bytes: Uint8Array;
  readonly byte_length: number;
  readonly origin: string | null;
  readonly captured_at: string | null;
  readonly response_status: number | null;
  readonly response_url: string | null;
  readonly request_json: string | null;
  readonly producer: string | null;
  readonly created_at: string | null;
  readonly sealed: number;
}

function directArtifactRow(
  artifactId: string,
  origin: "live" | "administrative",
  overrides: Partial<DirectArtifactRow> = {},
): DirectArtifactRow {
  const live = origin === "live";
  return {
    run_id: "direct-schema-run",
    artifact_id: artifactId,
    source_id: "direct-schema-source",
    role: "official-document",
    url: live ? "https://official.example/source" : null,
    media_type: "application/octet-stream",
    sha256: "4bf5122f344554c53bde2ebb8cd2b7e3d1600ad631c385a5d7cce23c7785459a",
    bytes: Uint8Array.of(1),
    byte_length: 1,
    origin,
    captured_at: live ? "2026-08-24T10:00:00.000Z" : null,
    response_status: live ? 200 : null,
    response_url: live ? "https://official.example/source" : null,
    request_json: live ? '{"method":"GET","url":"https://official.example/source"}' : null,
    producer: live ? null : "install-city-package@1",
    created_at: live ? null : "2026-08-24T10:00:00.000Z",
    sealed: 0,
    ...overrides,
  };
}

function insertDirectArtifact(database: Database.Database, row: DirectArtifactRow): void {
  database.prepare(`
    INSERT INTO artifacts (
      run_id, artifact_id, source_id, role, url, media_type, sha256, bytes,
      byte_length, origin, captured_at, response_status, response_url, request_json,
      producer, created_at, sealed
    ) VALUES (
      @run_id, @artifact_id, @source_id, @role, @url, @media_type, @sha256, @bytes,
      @byte_length, @origin, @captured_at, @response_status, @response_url, @request_json,
      @producer, @created_at, @sealed
    )
  `).run(row);
}

describe("database schema preflight", () => {
  test("installs the exact live or administrative artifact discriminator", () => {
    // Break caught: a weaker SQL shape accepting mixed HTTP and administrative provenance.
    const database = track(openEvidenceDatabase(":memory:"));
    const artifactSql = database.prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'artifacts'",
    ).pluck().get() as string;

    expect(artifactSql).toContain("CHECK (origin IN ('live', 'administrative'))");
    expect(artifactSql).toContain(
      "CHECK (response_status IS NULL OR response_status BETWEEN 100 AND 599)",
    );
    expect(artifactSql).toContain(CURRENT_ARTIFACT_ORIGIN_CHECK);
    expect(database.prepare("PRAGMA table_info(artifacts)").all()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "url", notnull: 0 }),
        expect.objectContaining({ name: "captured_at", notnull: 0 }),
        expect.objectContaining({ name: "response_status", notnull: 0 }),
        expect.objectContaining({ name: "response_url", notnull: 0 }),
        expect.objectContaining({ name: "request_json", notnull: 0 }),
        expect.objectContaining({ name: "producer", notnull: 0 }),
        expect.objectContaining({ name: "created_at", notnull: 0 }),
      ]),
    );

    expect(() => insertDirectArtifact(
      database,
      directArtifactRow("valid-live", "live"),
    )).not.toThrow();
    expect(() => insertDirectArtifact(
      database,
      directArtifactRow("valid-administrative", "administrative"),
    )).not.toThrow();
  });

  test.each([
    ["NULL origin", "live", { origin: null }],
    ["unknown origin", "live", { origin: "imported" }],
    ["live NULL url", "live", { url: null }],
    ["live NULL captured_at", "live", { captured_at: null }],
    ["live NULL response_status", "live", { response_status: null }],
    ["live NULL response_url", "live", { response_url: null }],
    ["live NULL request_json", "live", { request_json: null }],
    ["live administrative producer", "live", { producer: "mixed" }],
    ["live administrative created_at", "live", { created_at: "2026-08-24T10:00:00.000Z" }],
    ["live response status below HTTP range", "live", { response_status: 99 }],
    ["live response status above HTTP range", "live", { response_status: 600 }],
    ["administrative live url", "administrative", { url: "https://mixed.example" }],
    ["administrative live captured_at", "administrative", {
      captured_at: "2026-08-24T10:00:00.000Z",
    }],
    ["administrative live response_status", "administrative", { response_status: 200 }],
    ["administrative live response_url", "administrative", {
      response_url: "https://mixed.example",
    }],
    ["administrative live request_json", "administrative", { request_json: "{}" }],
    ["administrative NULL producer", "administrative", { producer: null }],
    ["administrative empty producer", "administrative", { producer: "" }],
    ["administrative NULL created_at", "administrative", { created_at: null }],
    ["administrative empty created_at", "administrative", { created_at: "" }],
    ["NULL common run_id", "live", { run_id: null }],
    ["NULL common artifact_id", "live", { artifact_id: null }],
    ["NULL common source_id", "administrative", { source_id: null }],
    ["NULL common role", "live", { role: null }],
    ["NULL common media_type", "administrative", { media_type: null }],
    ["NULL common sha256", "live", { sha256: null }],
    ["NULL common bytes", "administrative", { bytes: null }],
    ["NULL common byte_length", "live", { byte_length: null }],
    ["invalid sealed discriminator", "live", { sealed: 2 }],
  ] as const)("rejects direct SQL %s", (_name, origin, overrides) => {
    // Break caught: relying on adapter validation while direct SQL admits an invalid union row.
    const database = track(openEvidenceDatabase(":memory:"));
    const row = directArtifactRow(
      `invalid-${_name.replaceAll(" ", "-")}`,
      origin,
      overrides as Partial<DirectArtifactRow>,
    );
    expect(() => insertDirectArtifact(database, row)).toThrow();
  });

  test("rejects the prior live-only artifact table before any schema execution and preserves it", () => {
    // Break caught: CREATE IF NOT EXISTS silently accepting or automatically resetting old evidence.
    const path = temporaryDatabasePath();
    const legacy = track(new Database(path));
    legacy.exec(`
      CREATE TABLE artifacts (
        run_id TEXT NOT NULL,
        artifact_id TEXT NOT NULL,
        source_id TEXT NOT NULL,
        role TEXT NOT NULL,
        url TEXT NOT NULL,
        media_type TEXT NOT NULL,
        sha256 TEXT NOT NULL,
        bytes BLOB NOT NULL,
        byte_length INTEGER NOT NULL,
        origin TEXT NOT NULL CHECK (origin = 'live'),
        captured_at TEXT NOT NULL,
        response_status INTEGER NOT NULL,
        response_url TEXT NOT NULL,
        request_json TEXT NOT NULL,
        sealed INTEGER NOT NULL DEFAULT 0 CHECK (sealed IN (0, 1)),
        PRIMARY KEY (run_id, artifact_id)
      )
    `);
    legacy.prepare(`
      INSERT INTO artifacts (
        run_id, artifact_id, source_id, role, url, media_type, sha256, bytes,
        byte_length, origin, captured_at, response_status, response_url, request_json, sealed
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'live', ?, ?, ?, ?, 0)
    `).run(
      "legacy-run",
      "legacy-artifact",
      "legacy-source",
      "official-document",
      "https://official.example/legacy",
      "application/octet-stream",
      "4bf5122f344554c53bde2ebb8cd2b7e3d1600ad631c385a5d7cce23c7785459a",
      Uint8Array.of(1),
      1,
      "2026-08-24T10:00:00.000Z",
      200,
      "https://official.example/legacy",
      '{"method":"GET","url":"https://official.example/legacy"}',
    );
    const before = storedSchema(legacy);
    legacy.close();

    expect(() => openEvidenceDatabase(path)).toThrow("database_schema_reset_required");

    const verification = track(new Database(path, { readonly: true }));
    expect(storedSchema(verification)).toEqual(before);
    expect(verification.prepare(
      "SELECT artifact_id, bytes FROM artifacts",
    ).get()).toEqual({ artifact_id: "legacy-artifact", bytes: Buffer.from([1]) });
    expect(verification.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    ).all()).toEqual([{ name: "artifacts" }]);
  });

  test("rejects a new-column artifact table with a weakened discriminator without changing it", () => {
    // Break caught: preflighting columns while accepting a missing producer/created-time constraint.
    const path = temporaryDatabasePath();
    const weakened = track(new Database(path));
    weakened.exec(`
      CREATE TABLE artifacts (
        run_id TEXT NOT NULL,
        artifact_id TEXT NOT NULL,
        source_id TEXT NOT NULL,
        role TEXT NOT NULL,
        url TEXT,
        media_type TEXT NOT NULL,
        sha256 TEXT NOT NULL,
        bytes BLOB NOT NULL,
        byte_length INTEGER NOT NULL,
        origin TEXT NOT NULL CHECK (origin IN ('live', 'administrative')),
        captured_at TEXT,
        response_status INTEGER,
        response_url TEXT,
        request_json TEXT,
        producer TEXT,
        created_at TEXT,
        sealed INTEGER NOT NULL DEFAULT 0 CHECK (sealed IN (0, 1)),
        CHECK (response_status IS NULL OR response_status BETWEEN 100 AND 599),
        CHECK (
          (origin = 'live' AND url IS NOT NULL AND captured_at IS NOT NULL
            AND response_status IS NOT NULL AND response_url IS NOT NULL
            AND request_json IS NOT NULL AND producer IS NULL AND created_at IS NULL)
          OR
          (origin = 'administrative' AND url IS NULL AND captured_at IS NULL
            AND response_status IS NULL AND response_url IS NULL AND request_json IS NULL)
        ),
        PRIMARY KEY (run_id, artifact_id)
      )
    `);
    const before = storedSchema(weakened);
    weakened.close();

    expect(() => openEvidenceDatabase(path)).toThrow("database_schema_reset_required");

    const verification = track(new Database(path, { readonly: true }));
    expect(storedSchema(verification)).toEqual(before);
    expect(verification.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    ).all()).toEqual([{ name: "artifacts" }]);
  });

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

  test("rejects an existing incompatible V2 dossier table before schema execution", () => {
    const path = temporaryDatabasePath();
    const incompatible = track(new Database(path));
    incompatible.exec("CREATE TABLE dossier_versions_v2 (id TEXT PRIMARY KEY)");
    incompatible.close();

    expect(() => openEvidenceDatabase(path)).toThrow("database_schema_reset_required");

    const verification = track(new Database(path, { readonly: true }));
    expect(verification.prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'dossier_versions_v2'",
    ).get()).toEqual({ sql: "CREATE TABLE dossier_versions_v2 (id TEXT PRIMARY KEY)" });
    expect(verification.prepare(
      `SELECT COUNT(*) AS count FROM sqlite_master
       WHERE name NOT LIKE 'sqlite_%' AND name <> 'dossier_versions_v2'`,
    ).get()).toEqual({ count: 0 });
  });

  test("rejects an altered V2 dossier immutability trigger before schema execution", () => {
    const path = temporaryDatabasePath();
    track(openEvidenceDatabase(path)).close();
    const tampered = track(new Database(path));
    tampered.exec(`
      DROP TRIGGER dossier_versions_v2_no_update;
      CREATE TRIGGER dossier_versions_v2_no_update
      BEFORE UPDATE ON dossier_versions_v2
      BEGIN
        SELECT RAISE(ABORT, 'wrong_v2_immutability_guard');
      END;
    `);
    const before = storedSchema(tampered);
    tampered.close();

    expect(() => openEvidenceDatabase(path)).toThrow("database_schema_reset_required");

    const verification = track(new Database(path, { readonly: true }));
    expect(storedSchema(verification)).toEqual(before);
  });

  test.each([
    ["missing one-root", "DROP INDEX dossier_versions_v2_one_root"],
    [
      "altered one-successor",
      `DROP INDEX dossier_versions_v2_one_successor;
       CREATE INDEX dossier_versions_v2_one_successor
       ON dossier_versions_v2 (predecessor_id)`,
    ],
  ] as const)("rejects a %s V2 chain index before schema execution", (_name, sql) => {
    const path = temporaryDatabasePath();
    track(openEvidenceDatabase(path)).close();
    const tampered = track(new Database(path));
    tampered.exec(sql);
    const before = storedSchema(tampered);
    tampered.close();

    expect(() => openEvidenceDatabase(path)).toThrow("database_schema_reset_required");

    const verification = track(new Database(path, { readonly: true }));
    expect(storedSchema(verification)).toEqual(before);
  });

  test("adds the exact V2 dossier table to a legacy database with no V2 objects", () => {
    const path = temporaryDatabasePath();
    const legacy = track(openEvidenceDatabase(path));
    legacy.exec(`
      DROP TRIGGER dossier_versions_v2_no_update;
      DROP TRIGGER dossier_versions_v2_no_delete;
      DROP INDEX dossier_versions_v2_one_root;
      DROP INDEX dossier_versions_v2_one_successor;
      DROP TABLE dossier_versions_v2;
    `);
    const legacyV1DossierSql = legacy.prepare(
      "SELECT sql FROM sqlite_master WHERE name = 'dossier_versions'",
    ).pluck().get();
    legacy.close();

    const upgraded = track(openEvidenceDatabase(path));

    expect(upgraded.prepare(
      "SELECT sql FROM sqlite_master WHERE name = 'dossier_versions'",
    ).pluck().get()).toBe(legacyV1DossierSql);
    expect(upgraded.prepare(`
      SELECT type, name FROM sqlite_master
      WHERE tbl_name = 'dossier_versions_v2' AND name NOT LIKE 'sqlite_%'
      ORDER BY type, name
    `).all()).toEqual([
      { type: "index", name: "dossier_versions_v2_one_root" },
      { type: "index", name: "dossier_versions_v2_one_successor" },
      { type: "table", name: "dossier_versions_v2" },
      { type: "trigger", name: "dossier_versions_v2_no_delete" },
      { type: "trigger", name: "dossier_versions_v2_no_update" },
    ]);
  });

  test.each(["trigger", "index"] as const)(
    "rejects an orphan V2 dossier %s name before creating the table",
    (kind) => {
      const path = temporaryDatabasePath();
      const orphaned = track(new Database(path));
      orphaned.exec("CREATE TABLE unrelated (id TEXT PRIMARY KEY)");
      if (kind === "trigger") {
        orphaned.exec(`
          CREATE TRIGGER dossier_versions_v2_no_delete
          BEFORE DELETE ON unrelated
          BEGIN SELECT RAISE(ABORT, 'orphan'); END
        `);
      } else {
        orphaned.exec(`
          CREATE UNIQUE INDEX dossier_versions_v2_one_root ON unrelated (id)
        `);
      }
      const before = storedSchema(orphaned);
      orphaned.close();

      expect(() => openEvidenceDatabase(path)).toThrow("database_schema_reset_required");

      const verification = track(new Database(path, { readonly: true }));
      expect(storedSchema(verification)).toEqual(before);
    },
  );

  test.each([
    [
      "poison insert trigger",
      `CREATE TRIGGER dossier_versions_v2_poison
       BEFORE INSERT ON dossier_versions_v2
       BEGIN SELECT RAISE(ABORT, 'poison_v2_insert'); END`,
    ],
    [
      "extra unique payload index",
      `CREATE UNIQUE INDEX dossier_versions_v2_extra_payload
       ON dossier_versions_v2 (country_code, payload_hash)`,
    ],
  ] as const)("rejects a V2 dossier %s before schema execution", (_name, sql) => {
    const path = temporaryDatabasePath();
    track(openEvidenceDatabase(path)).close();
    const tampered = track(new Database(path));
    tampered.exec(sql);
    const before = storedSchema(tampered);
    tampered.close();

    expect(() => openEvidenceDatabase(path)).toThrow("database_schema_reset_required");

    const verification = track(new Database(path, { readonly: true }));
    expect(storedSchema(verification)).toEqual(before);
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
      { name: "city_branch_commits" },
      { name: "city_catalog_revisions" },
      { name: "city_criteria_snapshots" },
      { name: "city_evidence_snapshots" },
      { name: "city_frontier_revisions" },
      { name: "city_knowledge_revisions" },
      { name: "city_ranking_snapshots" },
      { name: "city_selection_snapshots" },
      { name: "country_knowledge_revisions" },
      { name: "country_resolution_revisions" },
      { name: "dossier_versions" },
      { name: "dossier_versions_v2" },
      { name: "evidence_snapshots" },
      { name: "installed_city_package_heads" },
      { name: "installed_city_package_manifests" },
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

    expect(reopened.prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'city_catalog_revisions'",
    ).pluck().get()).toBe(CURRENT_CITY_CATALOG_SQL);
    expect(reopened.prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'city_knowledge_revisions'",
    ).pluck().get()).toBe(CURRENT_CITY_KNOWLEDGE_SQL);
    expect(reopened.prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'installed_city_package_manifests'",
    ).pluck().get()).toBe(CURRENT_INSTALLED_CITY_PACKAGE_MANIFESTS_SQL);
    expect(reopened.prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'installed_city_package_heads'",
    ).pluck().get()).toBe(CURRENT_INSTALLED_CITY_PACKAGE_HEADS_SQL);
    expect(reopened.prepare("PRAGMA table_info(city_catalog_revisions)").all()
      .map((column) => (column as { readonly name: string }).name)).toEqual([
      "id", "registry_revision_id", "country_code", "package_id", "package_schema_version",
      "registry_evidence_snapshot_id", "catalog_evidence_snapshot_id", "rules_version",
      "created_at", "payload_json", "payload_hash", "hmac",
    ]);
    expect(reopened.prepare("PRAGMA foreign_key_list(city_catalog_revisions)").all()).toEqual([]);
    expect(reopened.prepare(`
      SELECT type, name FROM sqlite_master
      WHERE tbl_name = 'city_catalog_revisions' AND name NOT LIKE 'sqlite_%'
      ORDER BY type, name
    `).all()).toEqual([
      { type: "table", name: "city_catalog_revisions" },
      { type: "trigger", name: "city_catalog_revisions_no_delete" },
      { type: "trigger", name: "city_catalog_revisions_no_update" },
    ]);

    expect(reopened.prepare("PRAGMA table_info(city_knowledge_revisions)").all()
      .map((column) => (column as { readonly name: string }).name)).toEqual([
      "id", "city_id", "country_code", "package_id", "package_schema_version", "rules_version",
      "predecessor_id", "evidence_snapshot_id", "last_checked_at", "knowledge_updated_at",
      "created_at", "payload_json", "payload_hash", "hmac",
    ]);
    expect((reopened.prepare("PRAGMA foreign_key_list(city_knowledge_revisions)").all() as Array<{
      readonly table: string;
      readonly from: string;
      readonly to: string;
    }>).map(({ table, from, to }) => ({ table, from, to })).sort((left, right) =>
      left.from.localeCompare(right.from))).toEqual([
      { table: "city_evidence_snapshots", from: "evidence_snapshot_id", to: "id" },
      { table: "city_knowledge_revisions", from: "predecessor_id", to: "id" },
    ]);
    expect(reopened.prepare(`
      SELECT type, name FROM sqlite_master
      WHERE tbl_name = 'city_knowledge_revisions' AND name NOT LIKE 'sqlite_%'
      ORDER BY type, name
    `).all()).toEqual([
      { type: "index", name: "city_knowledge_one_root" },
      { type: "index", name: "city_knowledge_one_successor" },
      { type: "table", name: "city_knowledge_revisions" },
      { type: "trigger", name: "city_knowledge_revisions_no_delete" },
      { type: "trigger", name: "city_knowledge_revisions_no_update" },
    ]);
    expect(reopened.prepare(
      "SELECT sql FROM sqlite_master WHERE name = 'city_knowledge_one_root'",
    ).pluck().get()).toBe(`CREATE UNIQUE INDEX city_knowledge_one_root
ON city_knowledge_revisions (city_id)
WHERE predecessor_id IS NULL`);
    expect(reopened.prepare(
      "SELECT sql FROM sqlite_master WHERE name = 'city_knowledge_one_successor'",
    ).pluck().get()).toBe(`CREATE UNIQUE INDEX city_knowledge_one_successor
ON city_knowledge_revisions (predecessor_id)
WHERE predecessor_id IS NOT NULL`);
    expect(reopened.prepare(
      "SELECT sql FROM sqlite_master WHERE name = 'city_catalog_revisions_no_update'",
    ).pluck().get()).toBe(`CREATE TRIGGER city_catalog_revisions_no_update
BEFORE UPDATE ON city_catalog_revisions
BEGIN
  SELECT RAISE(ABORT, 'city_catalog_revision_is_immutable');
END`);
    expect(reopened.prepare(
      "SELECT sql FROM sqlite_master WHERE name = 'city_catalog_revisions_no_delete'",
    ).pluck().get()).toBe(`CREATE TRIGGER city_catalog_revisions_no_delete
BEFORE DELETE ON city_catalog_revisions
BEGIN
  SELECT RAISE(ABORT, 'city_catalog_revision_is_immutable');
END`);
    expect(reopened.prepare(
      "SELECT sql FROM sqlite_master WHERE name = 'city_knowledge_revisions_no_update'",
    ).pluck().get()).toBe(`CREATE TRIGGER city_knowledge_revisions_no_update
BEFORE UPDATE ON city_knowledge_revisions
BEGIN
  SELECT RAISE(ABORT, 'city_knowledge_revision_is_immutable');
END`);
    expect(reopened.prepare(
      "SELECT sql FROM sqlite_master WHERE name = 'city_knowledge_revisions_no_delete'",
    ).pluck().get()).toBe(`CREATE TRIGGER city_knowledge_revisions_no_delete
BEFORE DELETE ON city_knowledge_revisions
BEGIN
  SELECT RAISE(ABORT, 'city_knowledge_revision_is_immutable');
END`);

    expect(reopened.prepare("PRAGMA table_info(installed_city_package_manifests)").all()
      .map((column) => (column as { readonly name: string }).name)).toEqual([
      "id", "country_code", "package_id", "package_schema_version", "catalog_revision_id",
      "evidence_rules_version", "predecessor_manifest_id",
      "administrative_evidence_snapshot_id", "installed_at", "payload_json", "payload_hash", "hmac",
    ]);
    expect((reopened.prepare(
      "PRAGMA foreign_key_list(installed_city_package_manifests)",
    ).all() as Array<{ readonly table: string; readonly from: string; readonly to: string }>).map(
      ({ table, from, to }) => ({ table, from, to }),
    ).sort((left, right) => left.from.localeCompare(right.from))).toEqual([
      { table: "evidence_snapshots", from: "administrative_evidence_snapshot_id", to: "id" },
      { table: "city_catalog_revisions", from: "catalog_revision_id", to: "id" },
      { table: "installed_city_package_manifests", from: "predecessor_manifest_id", to: "id" },
    ]);
    expect(reopened.prepare(`
      SELECT type, name FROM sqlite_master
      WHERE tbl_name = 'installed_city_package_manifests' AND name NOT LIKE 'sqlite_%'
      ORDER BY type, name
    `).all()).toEqual([
      { type: "index", name: "installed_city_package_manifest_country_id" },
      { type: "index", name: "installed_city_package_manifest_exact_key" },
      { type: "index", name: "installed_city_package_manifest_one_root" },
      { type: "index", name: "installed_city_package_manifest_one_successor" },
      { type: "table", name: "installed_city_package_manifests" },
      { type: "trigger", name: "installed_city_package_manifests_no_delete" },
      { type: "trigger", name: "installed_city_package_manifests_no_update" },
    ]);
    expect(reopened.prepare(`
      SELECT name, sql FROM sqlite_master
      WHERE name IN (
        'installed_city_package_manifest_country_id',
        'installed_city_package_manifest_exact_key',
        'installed_city_package_manifest_one_root',
        'installed_city_package_manifest_one_successor',
        'installed_city_package_manifests_no_delete',
        'installed_city_package_manifests_no_update'
      ) ORDER BY name
    `).all()).toEqual([
      {
        name: "installed_city_package_manifest_country_id",
        sql: `CREATE UNIQUE INDEX installed_city_package_manifest_country_id
ON installed_city_package_manifests (country_code, id)`,
      },
      {
        name: "installed_city_package_manifest_exact_key",
        sql: `CREATE UNIQUE INDEX installed_city_package_manifest_exact_key
ON installed_city_package_manifests (
  country_code, package_id, package_schema_version, catalog_revision_id, evidence_rules_version
)`,
      },
      {
        name: "installed_city_package_manifest_one_root",
        sql: `CREATE UNIQUE INDEX installed_city_package_manifest_one_root
ON installed_city_package_manifests (country_code)
WHERE predecessor_manifest_id IS NULL`,
      },
      {
        name: "installed_city_package_manifest_one_successor",
        sql: `CREATE UNIQUE INDEX installed_city_package_manifest_one_successor
ON installed_city_package_manifests (predecessor_manifest_id)
WHERE predecessor_manifest_id IS NOT NULL`,
      },
      {
        name: "installed_city_package_manifests_no_delete",
        sql: `CREATE TRIGGER installed_city_package_manifests_no_delete
BEFORE DELETE ON installed_city_package_manifests
BEGIN
  SELECT RAISE(ABORT, 'installed_city_package_manifest_is_immutable');
END`,
      },
      {
        name: "installed_city_package_manifests_no_update",
        sql: `CREATE TRIGGER installed_city_package_manifests_no_update
BEFORE UPDATE ON installed_city_package_manifests
BEGIN
  SELECT RAISE(ABORT, 'installed_city_package_manifest_is_immutable');
END`,
      },
    ]);
    expect(reopened.prepare(`
      SELECT type, name FROM sqlite_master
      WHERE tbl_name = 'installed_city_package_heads' AND name NOT LIKE 'sqlite_%'
      ORDER BY type, name
    `).all()).toEqual([
      { type: "table", name: "installed_city_package_heads" },
    ]);
    expect((reopened.prepare(
      "PRAGMA foreign_key_list(installed_city_package_heads)",
    ).all() as Array<{ readonly id: number; readonly seq: number; readonly table: string;
      readonly from: string; readonly to: string }>).map(
      ({ id, seq, table, from, to }) => ({ id, seq, table, from, to }),
    )).toEqual([
      {
        id: 0,
        seq: 0,
        table: "installed_city_package_manifests",
        from: "country_code",
        to: "country_code",
      },
      {
        id: 0,
        seq: 1,
        table: "installed_city_package_manifests",
        from: "current_manifest_id",
        to: "id",
      },
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
      { type: "index", name: "dossier_versions_v2_one_root" },
      { type: "index", name: "dossier_versions_v2_one_successor" },
      { type: "table", name: "dossier_versions_v2" },
      { type: "trigger", name: "dossier_versions_no_delete" },
      { type: "trigger", name: "dossier_versions_no_update" },
      { type: "trigger", name: "dossier_versions_v2_no_delete" },
      { type: "trigger", name: "dossier_versions_v2_no_update" },
    ]);
    expect(reopened.prepare(`
      SELECT type, name, sql FROM sqlite_master
      WHERE name IN (
        'dossier_versions',
        'dossier_versions_one_root',
        'dossier_versions_one_successor',
        'dossier_versions_no_update',
        'dossier_versions_no_delete'
      )
      ORDER BY type, name
    `).all()).toEqual([
      {
        type: "index",
        name: "dossier_versions_one_root",
        sql: `CREATE UNIQUE INDEX dossier_versions_one_root
ON dossier_versions (country_code, schema_version)
WHERE predecessor_id IS NULL`,
      },
      {
        type: "index",
        name: "dossier_versions_one_successor",
        sql: `CREATE UNIQUE INDEX dossier_versions_one_successor
ON dossier_versions (predecessor_id)
WHERE predecessor_id IS NOT NULL`,
      },
      {
        type: "table",
        name: "dossier_versions",
        sql: `CREATE TABLE dossier_versions (
  id TEXT PRIMARY KEY,
  country_code TEXT NOT NULL CHECK (length(country_code) = 2 AND country_code = upper(country_code)),
  predecessor_id TEXT REFERENCES dossier_versions(id),
  evidence_snapshot_id TEXT NOT NULL REFERENCES evidence_snapshots(id),
  schema_version TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  payload_hash TEXT NOT NULL CHECK (length(payload_hash) = 64),
  manifest_hash TEXT NOT NULL CHECK (length(manifest_hash) = 64),
  hmac TEXT NOT NULL CHECK (length(hmac) = 64),
  published_at TEXT NOT NULL,
  CHECK (predecessor_id IS NULL OR predecessor_id <> id),
  UNIQUE (country_code, schema_version, payload_hash)
)`,
      },
      {
        type: "trigger",
        name: "dossier_versions_no_delete",
        sql: `CREATE TRIGGER dossier_versions_no_delete
BEFORE DELETE ON dossier_versions
BEGIN
  SELECT RAISE(ABORT, 'dossier_version_is_immutable');
END`,
      },
      {
        type: "trigger",
        name: "dossier_versions_no_update",
        sql: `CREATE TRIGGER dossier_versions_no_update
BEFORE UPDATE ON dossier_versions
BEGIN
  SELECT RAISE(ABORT, 'dossier_version_is_immutable');
END`,
      },
    ]);
    const dossierV2Columns = reopened.prepare(
      "PRAGMA table_info(dossier_versions_v2)",
    ).all() as { readonly name: string }[];
    expect(dossierV2Columns.map(({ name }) => name)).toEqual([
      "id",
      "country_code",
      "predecessor_id",
      "evidence_snapshot_id",
      "schema_version",
      "payload_json",
      "payload_hash",
      "manifest_hash",
      "hmac",
      "published_at",
    ]);
    const dossierV2ForeignKeys = reopened.prepare(
      "PRAGMA foreign_key_list(dossier_versions_v2)",
    ).all() as Array<{ readonly table: string; readonly from: string; readonly to: string }>;
    expect(dossierV2ForeignKeys.map(({ table, from, to }) => ({ table, from, to })))
      .toEqual(expect.arrayContaining([
        {
          table: "dossier_versions_v2",
          from: "predecessor_id",
          to: "id",
        },
        {
          table: "evidence_snapshots",
          from: "evidence_snapshot_id",
          to: "id",
        },
      ]));
    const dossierV2UniqueIndexes = reopened.prepare(
      "PRAGMA index_list(dossier_versions_v2)",
    ).all() as Array<{ readonly name: string; readonly unique: number }>;
    const dossierV2UniqueColumns = dossierV2UniqueIndexes
      .filter(({ unique }) => unique === 1)
      .map(({ name }) => (reopened.prepare(`PRAGMA index_info('${name}')`).all() as
        Array<{ readonly name: string }>).map(({ name }) => name).join(","))
      .sort();
    expect(dossierV2UniqueColumns).toEqual([
      "country_code",
      "country_code,evidence_snapshot_id",
      "id",
      "predecessor_id",
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

  test.each([
    ["Catalog", "city_catalog_revisions"],
    ["Knowledge", "city_knowledge_revisions"],
  ])("rejects an incompatible existing City %s table before schema execution", (_label, table) => {
    // Break caught: CREATE IF NOT EXISTS accepting a partial structural persistence boundary.
    const path = temporaryDatabasePath();
    const incompatible = track(new Database(path));
    incompatible.exec(`CREATE TABLE ${table} (id TEXT PRIMARY KEY)`);
    incompatible.close();

    expect(() => openEvidenceDatabase(path)).toThrow("database_schema_reset_required");

    const verification = track(new Database(path, { readonly: true }));
    expect(verification.prepare(
      `SELECT sql FROM sqlite_master WHERE name = '${table}'`,
    ).pluck().get()).toBe(`CREATE TABLE ${table} (id TEXT PRIMARY KEY)`);
    expect(verification.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    ).all()).toEqual([{ name: table }]);
  });

  test.each([
    ["missing Catalog table", "DROP TABLE city_catalog_revisions"],
    ["missing Catalog trigger", "DROP TRIGGER city_catalog_revisions_no_delete"],
    ["altered Catalog trigger", `
      DROP TRIGGER city_catalog_revisions_no_update;
      CREATE TRIGGER city_catalog_revisions_no_update BEFORE UPDATE ON city_catalog_revisions
      BEGIN SELECT RAISE(ABORT, 'weakened'); END
    `],
    ["arbitrarily named extra Catalog object", `
      CREATE TRIGGER evil_catalog_guard BEFORE UPDATE ON city_catalog_revisions
      BEGIN SELECT RAISE(ABORT, 'unexpected'); END
    `],
    ["missing Knowledge table", "DROP TABLE city_knowledge_revisions"],
    ["missing Knowledge index", "DROP INDEX city_knowledge_one_successor"],
    ["altered Knowledge index", `
      DROP INDEX city_knowledge_one_root;
      CREATE INDEX city_knowledge_one_root ON city_knowledge_revisions (city_id)
    `],
    ["arbitrarily named extra Knowledge object", `
      CREATE INDEX evil_knowledge_idx ON city_knowledge_revisions (created_at)
    `],
  ])("rejects a %s on reopen without repairing or changing stored objects", (_label, mutation) => {
    // Break caught: schema execution silently repairing a partial or weakened installed object set.
    const path = temporaryDatabasePath();
    track(openEvidenceDatabase(path)).close();
    const incompatible = track(new Database(path));
    incompatible.exec(mutation);
    const before = storedSchema(incompatible);
    incompatible.close();

    expect(() => openEvidenceDatabase(path)).toThrow("database_schema_reset_required");

    const verification = track(new Database(path, { readonly: true }));
    expect(storedSchema(verification)).toEqual(before);
  });

  test("installs Task 3 tables additively only when both object families are wholly absent", () => {
    // Break caught: rejecting an exact pre-Task-3 database or accepting only one partially installed family.
    const path = temporaryDatabasePath();
    const legacy = track(openEvidenceDatabase(path));
    legacy.pragma("foreign_keys = OFF");
    legacy.exec(`
      DROP TABLE city_selection_snapshots;
      DROP TABLE city_frontier_revisions;
      DROP TABLE city_ranking_snapshots;
      DROP TABLE city_branch_commits;
      DROP TABLE city_criteria_snapshots;
      DROP TABLE installed_city_package_heads;
      DROP TABLE installed_city_package_manifests;
      DROP TABLE city_catalog_revisions;
      DROP TABLE city_knowledge_revisions;
    `);
    legacy.close();

    const upgraded = track(openEvidenceDatabase(path));
    expect(upgraded.prepare(`
      SELECT name FROM sqlite_master
      WHERE name IN ('city_catalog_revisions', 'city_knowledge_revisions')
      ORDER BY name
    `).all()).toEqual([
      { name: "city_catalog_revisions" },
      { name: "city_knowledge_revisions" },
    ]);
  });

  test.each([
    ["trigger", `
      CREATE TRIGGER city_catalog_revisions_no_update BEFORE UPDATE ON unrelated
      BEGIN SELECT RAISE(ABORT, 'reserved'); END
    `],
    ["index", "CREATE INDEX city_knowledge_one_root ON unrelated (id)"],
  ])("rejects a reserved Task 3 %s name attached to another table", (_label, objectSql) => {
    // Break caught: IF NOT EXISTS accepting a reserved guard/index name owned by an unrelated table.
    const path = temporaryDatabasePath();
    const legacy = track(openEvidenceDatabase(path));
    legacy.exec(`
      DROP TABLE city_catalog_revisions;
      DROP TABLE city_knowledge_revisions;
      CREATE TABLE unrelated (id TEXT PRIMARY KEY);
      ${objectSql}
    `);
    const before = storedSchema(legacy);
    legacy.close();

    expect(() => openEvidenceDatabase(path)).toThrow("database_schema_reset_required");
    const verification = track(new Database(path, { readonly: true }));
    expect(storedSchema(verification)).toEqual(before);
  });

  test("enforces direct-SQL City roots, successors, and immutable rows", () => {
    // Break caught: relying on store checks while leaving the append-only topology mutable in SQLite.
    const db = track(openEvidenceDatabase(":memory:"));
    db.prepare(`
      INSERT INTO city_catalog_revisions (
        id, registry_revision_id, country_code, package_id, package_schema_version,
        registry_evidence_snapshot_id, catalog_evidence_snapshot_id, rules_version,
        created_at, payload_json, payload_hash, hmac
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "catalog-1", "registry-1", "SI", "si-cities", "si-cities@1", "opaque-evidence",
      "opaque-evidence", "city-catalog@2", "2026-08-24T00:00:00.000Z", "{}",
      "a".repeat(64), "b".repeat(64),
    );
    expect(() => db.prepare(
      "UPDATE city_catalog_revisions SET payload_json = payload_json WHERE id = 'catalog-1'",
    ).run()).toThrow("city_catalog_revision_is_immutable");
    expect(() => db.prepare(
      "DELETE FROM city_catalog_revisions WHERE id = 'catalog-1'",
    ).run()).toThrow("city_catalog_revision_is_immutable");

    db.pragma("foreign_keys = OFF");
    const insertKnowledge = db.prepare(`
      INSERT INTO city_knowledge_revisions (
        id, city_id, country_code, package_id, package_schema_version, rules_version,
        predecessor_id, evidence_snapshot_id, last_checked_at, knowledge_updated_at,
        created_at, payload_json, payload_hash, hmac
      ) VALUES (?, 'ljubljana', 'SI', 'si-cities', 'si-cities@1', 'si-city-evidence@1',
        ?, ?, '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z',
        '2026-08-24T00:00:01.000Z', '{}', ?, ?)
    `);
    insertKnowledge.run("knowledge-root", null, "evidence-root", "c".repeat(64), "d".repeat(64));
    expect(() => insertKnowledge.run(
      "knowledge-second-root", null, "evidence-second-root", "c".repeat(64), "d".repeat(64),
    )).toThrow(/UNIQUE constraint failed/);
    insertKnowledge.run(
      "knowledge-child", "knowledge-root", "evidence-child", "c".repeat(64), "d".repeat(64),
    );
    expect(() => insertKnowledge.run(
      "knowledge-fork", "knowledge-root", "evidence-fork", "c".repeat(64), "d".repeat(64),
    )).toThrow(/UNIQUE constraint failed/);
    expect(() => db.prepare(
      "UPDATE city_knowledge_revisions SET payload_json = payload_json WHERE id = 'knowledge-root'",
    ).run()).toThrow("city_knowledge_revision_is_immutable");
    expect(() => db.prepare(
      "DELETE FROM city_knowledge_revisions WHERE id = 'knowledge-root'",
    ).run()).toThrow("city_knowledge_revision_is_immutable");
  });

  test.each([
    ["manifest", "installed_city_package_manifests"],
    ["head", "installed_city_package_heads"],
  ])("rejects an incompatible installed-package %s table before schema execution", (_label, table) => {
    // Break caught: CREATE IF NOT EXISTS accepting a partial Task 4 authority.
    const path = temporaryDatabasePath();
    const incompatible = track(new Database(path));
    incompatible.exec(`CREATE TABLE ${table} (id TEXT PRIMARY KEY)`);
    incompatible.close();

    expect(() => openEvidenceDatabase(path)).toThrow("database_schema_reset_required");
    const verification = track(new Database(path, { readonly: true }));
    expect(verification.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    ).all()).toEqual([{ name: table }]);
  });

  test("rejects an isolated Task 4 family when prerequisite Evidence and Catalog authorities are absent", () => {
    // Break caught: schema.sql silently heals a package authority built over no prerequisite authorities.
    const path = temporaryDatabasePath();
    const incompatible = track(new Database(path));
    incompatible.exec(`
      ${CURRENT_INSTALLED_CITY_PACKAGE_MANIFESTS_SQL};
      CREATE UNIQUE INDEX installed_city_package_manifest_country_id
      ON installed_city_package_manifests (country_code, id);
      CREATE UNIQUE INDEX installed_city_package_manifest_exact_key
      ON installed_city_package_manifests (
        country_code, package_id, package_schema_version, catalog_revision_id, evidence_rules_version
      );
      CREATE UNIQUE INDEX installed_city_package_manifest_one_root
      ON installed_city_package_manifests (country_code)
      WHERE predecessor_manifest_id IS NULL;
      CREATE UNIQUE INDEX installed_city_package_manifest_one_successor
      ON installed_city_package_manifests (predecessor_manifest_id)
      WHERE predecessor_manifest_id IS NOT NULL;
      CREATE TRIGGER installed_city_package_manifests_no_update
      BEFORE UPDATE ON installed_city_package_manifests
      BEGIN SELECT RAISE(ABORT, 'installed_city_package_manifest_is_immutable'); END;
      CREATE TRIGGER installed_city_package_manifests_no_delete
      BEFORE DELETE ON installed_city_package_manifests
      BEGIN SELECT RAISE(ABORT, 'installed_city_package_manifest_is_immutable'); END;
      ${CURRENT_INSTALLED_CITY_PACKAGE_HEADS_SQL};
    `);
    const before = storedSchema(incompatible);
    incompatible.close();

    expect(() => openEvidenceDatabase(path)).toThrow("database_schema_reset_required");
    const verification = track(new Database(path, { readonly: true }));
    expect(storedSchema(verification)).toEqual(before);
  });

  test.each([
    ["missing manifest table", "DROP TABLE installed_city_package_manifests"],
    ["missing head table", "DROP TABLE installed_city_package_heads"],
    ["missing exact-key index", "DROP INDEX installed_city_package_manifest_exact_key"],
    ["missing country-id support index", "DROP INDEX installed_city_package_manifest_country_id"],
    ["weakened root index", `
      DROP INDEX installed_city_package_manifest_one_root;
      CREATE INDEX installed_city_package_manifest_one_root
      ON installed_city_package_manifests (country_code)
    `],
    ["missing immutable trigger", "DROP TRIGGER installed_city_package_manifests_no_delete"],
    ["weakened successor index", `
      DROP INDEX installed_city_package_manifest_one_successor;
      CREATE INDEX installed_city_package_manifest_one_successor
      ON installed_city_package_manifests (predecessor_manifest_id)
    `],
    ["weakened update trigger", `
      DROP TRIGGER installed_city_package_manifests_no_update;
      CREATE TRIGGER installed_city_package_manifests_no_update
      BEFORE UPDATE ON installed_city_package_manifests
      BEGIN SELECT RAISE(ABORT, 'weakened'); END
    `],
    ["head without composite FK or UNIQUE", `
      DROP TABLE installed_city_package_heads;
      CREATE TABLE installed_city_package_heads (
        country_code TEXT PRIMARY KEY,
        current_manifest_id TEXT NOT NULL REFERENCES installed_city_package_manifests(id)
      )
    `],
    ["extra manifest object", `
      CREATE INDEX evil_installed_package_index ON installed_city_package_manifests (installed_at)
    `],
  ])("rejects a %s without repairing stored Task 4 objects", (_label, mutation) => {
    // Break caught: a partial/weakened package authority is silently repaired on reopen.
    const path = temporaryDatabasePath();
    track(openEvidenceDatabase(path)).close();
    const incompatible = track(new Database(path));
    incompatible.pragma("foreign_keys = OFF");
    incompatible.exec(mutation);
    const before = storedSchema(incompatible);
    incompatible.close();

    expect(() => openEvidenceDatabase(path)).toThrow("database_schema_reset_required");
    const verification = track(new Database(path, { readonly: true }));
    expect(storedSchema(verification)).toEqual(before);
  });

  test("installs Task 4 objects additively only when both families and all reserved names are absent", () => {
    // Break caught: rejecting an exact pre-Task-4 database or accepting an orphan reserved object.
    const path = temporaryDatabasePath();
    const legacy = track(openEvidenceDatabase(path));
    legacy.pragma("foreign_keys = OFF");
    legacy.exec(`
      DROP TABLE city_selection_snapshots;
      DROP TABLE city_frontier_revisions;
      DROP TABLE city_ranking_snapshots;
      DROP TABLE city_branch_commits;
      DROP TABLE city_criteria_snapshots;
      DROP TABLE installed_city_package_heads;
      DROP TABLE installed_city_package_manifests;
    `);
    legacy.close();

    const upgraded = track(openEvidenceDatabase(path));
    expect(upgraded.prepare(`
      SELECT name FROM sqlite_master
      WHERE name IN ('installed_city_package_heads', 'installed_city_package_manifests')
      ORDER BY name
    `).all()).toEqual([
      { name: "installed_city_package_heads" },
      { name: "installed_city_package_manifests" },
    ]);
    upgraded.close();

    const orphaned = track(new Database(path));
    orphaned.pragma("foreign_keys = OFF");
    orphaned.exec(`
      DROP TABLE installed_city_package_heads;
      DROP TABLE installed_city_package_manifests;
      CREATE TABLE unrelated (id TEXT PRIMARY KEY);
      CREATE INDEX installed_city_package_manifest_exact_key ON unrelated (id);
    `);
    const before = storedSchema(orphaned);
    orphaned.close();
    expect(() => openEvidenceDatabase(path)).toThrow("database_schema_reset_required");
    const verification = track(new Database(path, { readonly: true }));
    expect(storedSchema(verification)).toEqual(before);
  });

  test("enforces direct-SQL installed-package exact keys, linear history, country-bound heads, and immutability", () => {
    // Break caught: relying on adapter checks for uniqueness, topology, country binding, or append-only rows.
    const db = track(openEvidenceDatabase(":memory:"));
    db.prepare(`
      INSERT INTO city_catalog_revisions (
        id, registry_revision_id, country_code, package_id, package_schema_version,
        registry_evidence_snapshot_id, catalog_evidence_snapshot_id, rules_version,
        created_at, payload_json, payload_hash, hmac
      ) VALUES ('catalog-a', 'registry-a', 'SI', 'si-cities', 'si-cities@1',
        'catalog-evidence', 'catalog-evidence', 'city-catalog@2',
        '2026-08-24T00:00:00.000Z', '{}', ?, ?)
    `).run("a".repeat(64), "b".repeat(64));
    db.prepare(`
      INSERT INTO city_catalog_revisions
      SELECT 'catalog-b', registry_revision_id, country_code, package_id, package_schema_version,
             registry_evidence_snapshot_id, catalog_evidence_snapshot_id, rules_version,
             created_at, payload_json, payload_hash, hmac
      FROM city_catalog_revisions WHERE id = 'catalog-a'
    `).run();
    db.prepare(`
      INSERT INTO city_catalog_revisions
      SELECT 'catalog-c', registry_revision_id, country_code, package_id, package_schema_version,
             registry_evidence_snapshot_id, catalog_evidence_snapshot_id, rules_version,
             created_at, payload_json, payload_hash, hmac
      FROM city_catalog_revisions WHERE id = 'catalog-a'
    `).run();
    db.prepare(`
      INSERT INTO evidence_snapshots (
        id, assessment_date, snapshot_json, manifest_json, manifest_hash, hmac,
        parser_versions_json, rules_version
      ) VALUES ('administrative-a', '2026-08-24', '{}', '{}', ?, ?, '{}', 'admin@1')
    `).run("c".repeat(64), "d".repeat(64));
    const insertManifest = db.prepare(`
      INSERT INTO installed_city_package_manifests (
        id, country_code, package_id, package_schema_version, catalog_revision_id,
        evidence_rules_version, predecessor_manifest_id, administrative_evidence_snapshot_id,
        installed_at, payload_json, payload_hash, hmac
      ) VALUES (?, 'SI', 'si-cities', 'si-cities@1', ?, 'si-city-evidence@1',
        ?, 'administrative-a', ?, '{}', ?, ?)
    `);
    insertManifest.run(
      "manifest-root", "catalog-a", null, "2026-08-24T00:00:00.000Z",
      "e".repeat(64), "f".repeat(64),
    );
    expect(() => insertManifest.run(
      "manifest-duplicate-key", "catalog-a", null, "2026-08-25T00:00:00.000Z",
      "e".repeat(64), "f".repeat(64),
    )).toThrow(/UNIQUE constraint failed/);
    expect(() => insertManifest.run(
      "manifest-second-root", "catalog-b", null, "2026-08-25T00:00:00.000Z",
      "e".repeat(64), "f".repeat(64),
    )).toThrow(/UNIQUE constraint failed/);
    insertManifest.run(
      "manifest-child", "catalog-b", "manifest-root", "2026-08-25T00:00:00.000Z",
      "e".repeat(64), "f".repeat(64),
    );
    expect(() => insertManifest.run(
      "manifest-fork", "catalog-c", "manifest-root", "2026-08-26T00:00:00.000Z",
      "e".repeat(64), "f".repeat(64),
    )).toThrow(/UNIQUE constraint failed/);
    expect(() => db.prepare(`
      INSERT INTO installed_city_package_heads (country_code, current_manifest_id)
      VALUES ('ZZ', 'manifest-child')
    `).run()).toThrow(/FOREIGN KEY constraint failed/);
    db.prepare(`
      INSERT INTO installed_city_package_heads (country_code, current_manifest_id)
      VALUES ('SI', 'manifest-child')
    `).run();
    expect(() => db.prepare(`
      UPDATE installed_city_package_manifests SET payload_json = payload_json
      WHERE id = 'manifest-root'
    `).run()).toThrow("installed_city_package_manifest_is_immutable");
    expect(() => db.prepare(`
      DELETE FROM installed_city_package_manifests WHERE id = 'manifest-root'
    `).run()).toThrow("installed_city_package_manifest_is_immutable");
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

  test("installs the exact five-table City persistence family and physical columns", () => {
    // Break caught: adding a support table, omitting Task 15 foresight, or drifting physical order.
    const database = track(openEvidenceDatabase(":memory:"));
    expect(database.pragma("foreign_keys", { simple: true })).toBe(1);

    const tables = database.prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'table' AND name IN (
        'city_criteria_snapshots', 'city_branch_commits', 'city_ranking_snapshots',
        'city_frontier_revisions', 'city_selection_snapshots'
      ) ORDER BY name
    `).all();
    expect(tables).toEqual([
      { name: "city_branch_commits" },
      { name: "city_criteria_snapshots" },
      { name: "city_frontier_revisions" },
      { name: "city_ranking_snapshots" },
      { name: "city_selection_snapshots" },
    ]);

    const expectedColumns = {
      city_criteria_snapshots: [
        "id", "profile_snapshot_id", "preference_profile_snapshot_id", "schema_version",
        "rules_version", "confirmed_at", "payload_json", "payload_hash", "hmac",
      ],
      city_selection_snapshots: [
        "id", "run_id", "command_id", "terminal_revision_id", "city_id", "country_code",
        "profile_snapshot_id", "preference_profile_snapshot_id",
        "resolved_country_shortlist_revision_id", "criteria_snapshot_id", "ranking_snapshot_id",
        "pre_city_branch_commit_id", "selected_marker_digest", "knowledge_revision_id",
        "evidence_snapshot_id", "warning_copy_version", "schema_version", "command_json",
        "command_hash", "payload_json", "payload_hash", "hmac", "created_at",
      ],
      city_branch_commits: [
        "id", "kind", "profile_snapshot_id", "preference_profile_snapshot_id",
        "resolved_country_shortlist_revision_id", "country_code", "resolved_country_entry_digest",
        "city_id", "parent_id", "forked_from", "selection_snapshot_id", "schema_version",
        "payload_json", "payload_hash", "hmac", "created_at",
      ],
      city_ranking_snapshots: [
        "id", "run_id", "resolved_country_shortlist_revision_id", "country_code", "package_id",
        "package_schema_version", "registry_revision_id", "catalog_revision_id",
        "criteria_snapshot_id", "pre_city_branch_commit_id", "profile_snapshot_id",
        "preference_profile_snapshot_id", "evidence_rules_version",
        "installed_package_context_json", "live_city_candidate_limit",
        "target_selectable_cities", "budget_rules_version", "schema_version", "rules_version",
        "assessment_at", "payload_json", "payload_hash", "hmac", "created_at",
      ],
      city_frontier_revisions: [
        "id", "run_id", "kind", "predecessor_id", "ranking_snapshot_id", "operation_kind",
        "command_id", "schema_version", "command_json", "command_hash", "payload_json",
        "payload_hash", "hmac", "created_at",
      ],
    } as const;

    for (const [table, columns] of Object.entries(expectedColumns)) {
      const stored = database.prepare(`
        SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?
      `).get(table) as { readonly sql: string };
      expect(normalizeSql(stored.sql), table)
        .toBe(normalizeSql(TASK_13_TABLE_SQL[table as keyof typeof TASK_13_TABLE_SQL]));
      const actual = database.prepare(`PRAGMA table_info(${table})`).all() as
        Array<{
          readonly name: string;
          readonly type: string;
          readonly notnull: number;
          readonly dflt_value: string | null;
          readonly pk: number;
        }>;
      const nullable = new Set([
        "warning_copy_version",
        "parent_id",
        "forked_from",
        "selection_snapshot_id",
        "predecessor_id",
      ]);
      const integers = new Set([
        "live_city_candidate_limit",
        "target_selectable_cities",
      ]);
      expect(actual.map(({ name, type, notnull, dflt_value: defaultValue, pk }) => ({
        name,
        type,
        notnull,
        dflt_value: defaultValue,
        pk,
      })), table).toEqual(columns.map((name, index) => ({
        name,
        type: integers.has(name) ? "INTEGER" : "TEXT",
        notnull: nullable.has(name) ||
          (table === "city_branch_commits" && name === "city_id") ? 0 : 1,
        dflt_value: null,
        pk: index === 0 ? 1 : 0,
      })));
    }
  });

  test("installs every exact named City index and no sixth mapping index/table", () => {
    // Break caught: widening the parent source key or weakening root/command/topology uniqueness.
    const database = track(openEvidenceDatabase(":memory:"));
    const actual = database.prepare(`
      SELECT name, sql FROM sqlite_master
      WHERE type = 'index' AND tbl_name IN (
        'city_criteria_snapshots', 'city_branch_commits', 'city_ranking_snapshots',
        'city_frontier_revisions', 'city_selection_snapshots'
      ) AND sql IS NOT NULL ORDER BY name
    `).all() as Array<{ readonly name: string; readonly sql: string }>;
    expect(actual.map(({ name, sql }) => ({ name, sql: normalizeSql(sql) }))).toEqual([
      {
        name: "city_branch_commits_one_selection",
        sql: "CREATE UNIQUE INDEX city_branch_commits_one_selection ON city_branch_commits (selection_snapshot_id) WHERE kind = 'selection'",
      },
      {
        name: "city_branch_commits_pre_city_source",
        sql: "CREATE UNIQUE INDEX city_branch_commits_pre_city_source ON city_branch_commits (resolved_country_shortlist_revision_id, country_code) WHERE kind = 'pre_city'",
      },
      {
        name: "city_frontier_revisions_one_command",
        sql: "CREATE UNIQUE INDEX city_frontier_revisions_one_command ON city_frontier_revisions (run_id, command_id)",
      },
      {
        name: "city_frontier_revisions_one_root",
        sql: "CREATE UNIQUE INDEX city_frontier_revisions_one_root ON city_frontier_revisions (run_id) WHERE predecessor_id IS NULL",
      },
      {
        name: "city_frontier_revisions_one_start_command",
        sql: "CREATE UNIQUE INDEX city_frontier_revisions_one_start_command ON city_frontier_revisions (command_id) WHERE operation_kind = 'start'",
      },
      {
        name: "city_frontier_revisions_one_successor",
        sql: "CREATE UNIQUE INDEX city_frontier_revisions_one_successor ON city_frontier_revisions (predecessor_id) WHERE predecessor_id IS NOT NULL",
      },
      {
        name: "city_frontier_revisions_one_terminal",
        sql: "CREATE UNIQUE INDEX city_frontier_revisions_one_terminal ON city_frontier_revisions (run_id) WHERE kind = 'terminal'",
      },
      {
        name: "city_ranking_snapshots_one_run",
        sql: "CREATE UNIQUE INDEX city_ranking_snapshots_one_run ON city_ranking_snapshots (run_id)",
      },
      {
        name: "city_selection_snapshots_one_command",
        sql: "CREATE UNIQUE INDEX city_selection_snapshots_one_command ON city_selection_snapshots (run_id, command_id)",
      },
    ]);
    expect(database.prepare(`
      SELECT name FROM sqlite_master WHERE type = 'table'
      AND name LIKE 'city_%mapping%'
    `).all()).toEqual([]);
    const expectedByTable = {
      city_criteria_snapshots: [],
      city_branch_commits: [
        ["city_branch_commits_one_selection", ["selection_snapshot_id"], 1],
        ["city_branch_commits_pre_city_source", [
          "resolved_country_shortlist_revision_id",
          "country_code",
        ], 1],
      ],
      city_ranking_snapshots: [
        ["city_ranking_snapshots_one_run", ["run_id"], 0],
      ],
      city_frontier_revisions: [
        ["city_frontier_revisions_one_command", ["run_id", "command_id"], 0],
        ["city_frontier_revisions_one_root", ["run_id"], 1],
        ["city_frontier_revisions_one_start_command", ["command_id"], 1],
        ["city_frontier_revisions_one_successor", ["predecessor_id"], 1],
        ["city_frontier_revisions_one_terminal", ["run_id"], 1],
      ],
      city_selection_snapshots: [
        ["city_selection_snapshots_one_command", ["run_id", "command_id"], 0],
      ],
    } as const;
    for (const [table, expectedIndexes] of Object.entries(expectedByTable)) {
      const rows = (database.prepare(`PRAGMA index_list(${table})`).all() as Array<{
        readonly name: string;
        readonly unique: number;
        readonly origin: string;
        readonly partial: number;
      }>).filter(({ name }) => !name.startsWith("sqlite_autoindex_"))
        .sort((left, right) => left.name.localeCompare(right.name));
      expect(rows.map(({ name, unique, origin, partial }) => ({
        name,
        unique,
        origin,
        partial,
      })), table).toEqual(expectedIndexes.map(([name, , partial]) => ({
        name,
        unique: 1,
        origin: "c",
        partial,
      })));
      for (const [name, columns] of expectedIndexes) {
        const info = database.prepare(`PRAGMA index_info(${name})`).all() as Array<{
          readonly name: string;
        }>;
        expect(info.map(({ name: column }) => column), name).toEqual(columns);
      }
    }
  });

  test("installs ten immutable triggers and the terminal-successor guard exactly", () => {
    // Break caught: one durable family remaining mutable or a terminal accepting a successor.
    const database = track(openEvidenceDatabase(":memory:"));
    const triggers = database.prepare(`
      SELECT name, sql FROM sqlite_master
      WHERE type = 'trigger' AND tbl_name IN (
        'city_criteria_snapshots', 'city_branch_commits', 'city_ranking_snapshots',
        'city_frontier_revisions', 'city_selection_snapshots'
      ) ORDER BY name
    `).all() as Array<{ readonly name: string; readonly sql: string }>;
    const messages = new Map<string, string>([
      ["city_criteria_snapshots_no_update", "city_criteria_snapshot_is_immutable"],
      ["city_criteria_snapshots_no_delete", "city_criteria_snapshot_is_immutable"],
      ["city_branch_commits_no_update", "city_branch_commit_is_immutable"],
      ["city_branch_commits_no_delete", "city_branch_commit_is_immutable"],
      ["city_ranking_snapshots_no_update", "city_ranking_snapshot_is_immutable"],
      ["city_ranking_snapshots_no_delete", "city_ranking_snapshot_is_immutable"],
      ["city_frontier_revisions_no_update", "city_frontier_revision_is_immutable"],
      ["city_frontier_revisions_no_delete", "city_frontier_revision_is_immutable"],
      ["city_selection_snapshots_no_update", "city_selection_snapshot_is_immutable"],
      ["city_selection_snapshots_no_delete", "city_selection_snapshot_is_immutable"],
      [
        "city_frontier_revisions_no_successor_after_terminal",
        "city_frontier_terminal_has_no_successor",
      ],
    ]);
    expect(triggers.map(({ name }) => name)).toEqual([...messages.keys()].sort());
    for (const { name, sql } of triggers) {
      const expected = name === "city_frontier_revisions_no_successor_after_terminal"
        ? `CREATE TRIGGER city_frontier_revisions_no_successor_after_terminal
           BEFORE INSERT ON city_frontier_revisions
           WHEN NEW.predecessor_id IS NOT NULL AND EXISTS (
             SELECT 1 FROM city_frontier_revisions
             WHERE id = NEW.predecessor_id AND kind = 'terminal'
           )
           BEGIN SELECT RAISE(ABORT, 'city_frontier_terminal_has_no_successor'); END`
        : (() => {
            const event = name.endsWith("_no_update") ? "UPDATE" : "DELETE";
            const table = name.replace(/_no_(?:update|delete)$/, "");
            return `CREATE TRIGGER ${name} BEFORE ${event} ON ${table}
              BEGIN SELECT RAISE(ABORT, '${messages.get(name)}'); END`;
          })();
      expect(normalizeSql(sql), name).toBe(normalizeSql(expected));
    }
  });

  test("pins every FK row and exact primary-key autoindex inventory", () => {
    // Break caught: composite/selection lineage drift or hidden inline UNIQUE authority.
    const database = track(openEvidenceDatabase(":memory:"));
    const reference = task13ReferenceDatabase();
    for (const table of [
      "city_criteria_snapshots",
      "city_branch_commits",
      "city_ranking_snapshots",
      "city_frontier_revisions",
      "city_selection_snapshots",
    ]) {
      expect(database.prepare(`PRAGMA foreign_key_list(${table})`).all(), table)
        .toEqual(reference.prepare(`PRAGMA foreign_key_list(${table})`).all());
      const auto = (database.prepare(`PRAGMA index_list(${table})`).all() as Array<{
        readonly name: string;
        readonly unique: number;
        readonly origin: string;
        readonly partial: number;
      }>).filter(({ name }) => name.startsWith("sqlite_autoindex_"));
      const expectedAuto = (reference.prepare(`PRAGMA index_list(${table})`).all() as
        typeof auto).filter(({ name }) => name.startsWith("sqlite_autoindex_"));
      expect(auto.map(({ name, unique, origin, partial }) => ({
        name,
        unique,
        origin,
        partial,
      })), table).toEqual(expectedAuto.map(({ name, unique, origin, partial }) => ({
        name,
        unique,
        origin,
        partial,
      })));
      for (const { name } of expectedAuto) {
        expect(database.prepare(`PRAGMA index_info(${name})`).all(), name)
          .toEqual(reference.prepare(`PRAGMA index_info(${name})`).all());
      }
    }
  });

  test.each([
    ["foreign_keys readback", "foreign_keys"],
    ["ordered table metadata", "table_info(city_criteria_snapshots)"],
    ["complete foreign keys", "foreign_key_list(city_frontier_revisions)"],
    ["complete index inventory", "index_list(city_frontier_revisions)"],
    ["named index columns", "index_info(city_frontier_revisions_one_command)"],
    [
      "manifest exact-key columns",
      "index_info(installed_city_package_manifest_exact_key)",
    ],
  ] as const)("consumes exact %s during Task13 reopen preflight", (_label, target) => {
    // Break caught: comparing sqlite_master SQL without consuming normative PRAGMA metadata.
    const path = temporaryDatabasePath();
    track(openEvidenceDatabase(path)).close();
    const prototype = Database.prototype as unknown as {
      pragma: (
        source: string,
        options?: { readonly simple?: boolean },
      ) => unknown;
    };
    const original = prototype.pragma;
    prototype.pragma = function observedPragma(
      source: string,
      options?: { readonly simple?: boolean },
    ): unknown {
      const normalized = source.toLowerCase().replace(/\s+/g, "");
      const result = options === undefined
        ? Reflect.apply(original, this, [source])
        : Reflect.apply(original, this, [source, options]);
      if (normalized !== target) return result;
      if (target === "foreign_keys") return 0;
      if (!Array.isArray(result) || result.length === 0) {
        throw new Error("schema_test_fixture_mismatch");
      }
      const first = result[0] as Record<string, unknown>;
      const drifted = target.startsWith("table_info(")
        ? { ...first, type: "BLOB" }
        : target.startsWith("foreign_key_list(")
          ? { ...first, to: "drifted" }
          : target.startsWith("index_list(")
            ? { ...first, unique: first.unique === 1 ? 0 : 1 }
            : { ...first, name: "drifted" };
      return [drifted, ...result.slice(1)];
    };
    try {
      expect(() => openEvidenceDatabase(path)).toThrow("database_schema_reset_required");
    } finally {
      prototype.pragma = original;
    }
  });

  test("rejects missing manifest authority while the Task13 family remains", () => {
    // Break caught: healing Task4 underneath an already-installed Task13 Ranking FK family.
    const path = temporaryDatabasePath();
    track(openEvidenceDatabase(path)).close();
    const tampered = track(new Database(path));
    tampered.pragma("foreign_keys = OFF");
    tampered.exec(`
      DROP TABLE installed_city_package_heads;
      DROP TABLE installed_city_package_manifests;
    `);
    const before = storedSchema(tampered);
    tampered.close();

    expect(() => openEvidenceDatabase(path)).toThrow("database_schema_reset_required");
    const verification = track(new Database(path, { readonly: true }));
    expect(storedSchema(verification)).toEqual(before);
  });

  test("rejects a partial City family without healing it", () => {
    // Break caught: silently installing around a partial durable schema.
    const path = temporaryDatabasePath();
    track(openEvidenceDatabase(path)).close();
    const partial = track(new Database(path));
    partial.pragma("foreign_keys = OFF");
    partial.exec(`
      DROP TABLE IF EXISTS city_selection_snapshots;
      DROP TABLE IF EXISTS city_frontier_revisions;
      DROP TABLE IF EXISTS city_ranking_snapshots;
      DROP TABLE IF EXISTS city_branch_commits;
      DROP TABLE IF EXISTS city_criteria_snapshots;
    `);
    partial.exec("CREATE TABLE city_criteria_snapshots (id TEXT PRIMARY KEY NOT NULL)");
    const before = storedSchema(partial);
    partial.close();

    expect(() => openEvidenceDatabase(path)).toThrow("database_schema_reset_required");
    const verification = track(new Database(path, { readonly: true }));
    expect(storedSchema(verification)).toEqual(before);
  });

  test("atomically installs and reverifies the whole absent City family", () => {
    // Break caught: treating an exact pre-Task13 database as partial or exposing partial DDL commits.
    const path = temporaryDatabasePath();
    track(openEvidenceDatabase(path)).close();
    const legacy = track(new Database(path));
    legacy.pragma("foreign_keys = OFF");
    legacy.exec(`
      DROP TABLE IF EXISTS city_selection_snapshots;
      DROP TABLE IF EXISTS city_frontier_revisions;
      DROP TABLE IF EXISTS city_ranking_snapshots;
      DROP TABLE IF EXISTS city_branch_commits;
      DROP TABLE IF EXISTS city_criteria_snapshots;
    `);
    legacy.close();

    const upgraded = track(openEvidenceDatabase(path));
    const rows = upgraded.prepare(`
      SELECT name, sql FROM sqlite_master
      WHERE type = 'table' AND name IN (
        'city_criteria_snapshots', 'city_branch_commits', 'city_ranking_snapshots',
        'city_frontier_revisions', 'city_selection_snapshots'
      ) ORDER BY name
    `).all() as Array<{ readonly name: keyof typeof TASK_13_TABLE_SQL; readonly sql: string }>;
    expect(rows).toHaveLength(5);
    for (const { name, sql } of rows) {
      expect(normalizeSql(sql), name).toBe(normalizeSql(TASK_13_TABLE_SQL[name]));
    }
    const firstOpenSchema = storedSchema(upgraded);
    upgraded.close();
    const reopened = track(openEvidenceDatabase(path));
    expect(storedSchema(reopened)).toEqual(firstOpenSchema);
  });

  test("leaves no partial City objects when a late reserved name blocks installation", () => {
    // Break caught: committing early Task13 DDL before a later collision aborts family installation.
    const path = temporaryDatabasePath();
    track(openEvidenceDatabase(path)).close();
    const legacy = track(new Database(path));
    legacy.pragma("foreign_keys = OFF");
    legacy.exec(`
      DROP TABLE IF EXISTS city_selection_snapshots;
      DROP TABLE IF EXISTS city_frontier_revisions;
      DROP TABLE IF EXISTS city_ranking_snapshots;
      DROP TABLE IF EXISTS city_branch_commits;
      DROP TABLE IF EXISTS city_criteria_snapshots;
      CREATE TABLE unrelated_city_fixture (id TEXT PRIMARY KEY);
      CREATE UNIQUE INDEX city_selection_snapshots_one_command
      ON unrelated_city_fixture (id);
    `);
    const before = storedSchema(legacy);
    legacy.close();

    expect(() => openEvidenceDatabase(path)).toThrow("database_schema_reset_required");
    const verification = track(new Database(path, { readonly: true }));
    expect(storedSchema(verification)).toEqual(before);
  });

  test("rejects an unknown prefixed City object on an otherwise exact database", () => {
    // Break caught: preflight enumerating only known names instead of closing family prefixes.
    const path = temporaryDatabasePath();
    track(openEvidenceDatabase(path)).close();
    const tampered = track(new Database(path));
    tampered.exec("CREATE TABLE city_frontier_rogue (id TEXT PRIMARY KEY)");
    const before = storedSchema(tampered);
    tampered.close();

    expect(() => openEvidenceDatabase(path)).toThrow("database_schema_reset_required");
    const verification = track(new Database(path, { readonly: true }));
    expect(storedSchema(verification)).toEqual(before);
  });

  test.each(["index", "trigger"] as const)(
    "rejects an arbitrary-name extra City %s on reopen",
    (kind) => {
      // Break caught: checking only family prefixes while arbitrary user objects weaken authority.
      const path = temporaryDatabasePath();
      track(openEvidenceDatabase(path)).close();
      const tampered = track(new Database(path));
      const exists = tampered.prepare(`
        SELECT 1 AS present FROM sqlite_master
        WHERE type = 'table' AND name = 'city_criteria_snapshots'
      `).get();
      expect(exists).toEqual({ present: 1 });
      if (exists === undefined) return;
      tampered.exec(kind === "index"
        ? "CREATE INDEX harmless_name ON city_criteria_snapshots (confirmed_at)"
        : `CREATE TRIGGER harmless_name BEFORE UPDATE ON city_criteria_snapshots
           BEGIN SELECT RAISE(ABORT, 'wrong_guard'); END`);
      tampered.close();

      expect(() => openEvidenceDatabase(path)).toThrow("database_schema_reset_required");
    },
  );

  test.each([
    ["weakened City table CHECK", "table"],
    ["missing named City index", "missing_index"],
    ["non-unique named City index", "index"],
    ["missing named City trigger", "missing_trigger"],
    ["altered terminal trigger WHEN", "trigger"],
    ["weakened manifest exact-key index", "manifest_index"],
  ] as const)("rejects and preserves a %s on reopen", (_label, kind) => {
    // Break caught: fresh-install equality without exact reopen/preflight enforcement.
    const path = temporaryDatabasePath();
    track(openEvidenceDatabase(path)).close();
    const tampered = track(new Database(path));
    tampered.pragma("foreign_keys = OFF");
    if (kind === "table") {
      const triggerRows = tampered.prepare(`
        SELECT sql FROM sqlite_master
        WHERE type = 'trigger' AND tbl_name = 'city_criteria_snapshots'
        ORDER BY name
      `).all() as Array<{ readonly sql: string }>;
      const sql = (tampered.prepare(`
        SELECT sql FROM sqlite_master WHERE type = 'table'
        AND name = 'city_criteria_snapshots'
      `).pluck().get() as string).replace(
        "schema_version = 'city-criteria@1'",
        "schema_version IN ('city-criteria@1', 'city-criteria@2')",
      );
      tampered.exec(`
        DROP TRIGGER city_criteria_snapshots_no_update;
        DROP TRIGGER city_criteria_snapshots_no_delete;
        DROP TABLE city_criteria_snapshots;
      `);
      tampered.exec(sql);
      for (const row of triggerRows) tampered.exec(row.sql);
    } else if (kind === "missing_index") {
      tampered.exec("DROP INDEX city_frontier_revisions_one_command");
    } else if (kind === "index") {
      const sql = (tampered.prepare(`
        SELECT sql FROM sqlite_master WHERE type = 'index'
        AND name = 'city_frontier_revisions_one_command'
      `).pluck().get() as string).replace("CREATE UNIQUE INDEX", "CREATE INDEX");
      tampered.exec("DROP INDEX city_frontier_revisions_one_command");
      tampered.exec(sql);
    } else if (kind === "missing_trigger") {
      tampered.exec("DROP TRIGGER city_frontier_revisions_no_successor_after_terminal");
    } else if (kind === "trigger") {
      const sql = (tampered.prepare(`
        SELECT sql FROM sqlite_master WHERE type = 'trigger'
        AND name = 'city_frontier_revisions_no_successor_after_terminal'
      `).pluck().get() as string).replace("kind = 'terminal'", "kind = 'working'");
      tampered.exec("DROP TRIGGER city_frontier_revisions_no_successor_after_terminal");
      tampered.exec(sql);
    } else {
      const sql = (tampered.prepare(`
        SELECT sql FROM sqlite_master WHERE type = 'index'
        AND name = 'installed_city_package_manifest_exact_key'
      `).pluck().get() as string).replace("CREATE UNIQUE INDEX", "CREATE INDEX");
      tampered.exec("DROP INDEX installed_city_package_manifest_exact_key");
      tampered.exec(sql);
    }
    const before = storedSchema(tampered);
    tampered.close();

    expect(() => openEvidenceDatabase(path)).toThrow("database_schema_reset_required");
    const verification = track(new Database(path, { readonly: true }));
    expect(storedSchema(verification)).toEqual(before);
  });
});
