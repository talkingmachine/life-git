import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import Database from "better-sqlite3";

const schema = readFileSync(resolve("src/infrastructure/sqlite/schema.sql"), "utf8");

const CURRENT_RUN_REVISIONS_STAGE_CHECK = normalizeSchemaSql(`
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
  )
`);

const CURRENT_COUNTRY_KNOWLEDGE_TABLE = normalizeSchemaSql(`
  CREATE TABLE IF NOT EXISTS country_knowledge_revisions (
    id TEXT PRIMARY KEY,
    country_code TEXT NOT NULL CHECK (
      length(country_code) = 2
      AND country_code = upper(country_code)
      AND country_code GLOB '[A-Z][A-Z]'
    ),
    predecessor_id TEXT REFERENCES country_knowledge_revisions(id),
    trigger_evidence_snapshot_id TEXT NOT NULL REFERENCES evidence_snapshots(id),
    schema_version TEXT NOT NULL CHECK (schema_version = 'country-knowledge@1'),
    payload_json TEXT NOT NULL,
    payload_hash TEXT NOT NULL CHECK (length(payload_hash) = 64),
    hmac TEXT NOT NULL CHECK (length(hmac) = 64),
    created_at TEXT NOT NULL,
    CHECK (predecessor_id IS NULL OR predecessor_id <> id),
    UNIQUE (country_code, trigger_evidence_snapshot_id)
  );
`);

const CURRENT_CITY_EVIDENCE_TABLE = normalizeSchemaSql(`
  CREATE TABLE IF NOT EXISTS city_evidence_snapshots (
    id TEXT PRIMARY KEY REFERENCES evidence_snapshots(id),
    city_check_run_id TEXT NOT NULL UNIQUE,
    frontier_run_id TEXT NOT NULL,
    city_id TEXT NOT NULL,
    country_code TEXT NOT NULL,
    package_id TEXT NOT NULL,
    package_schema_version TEXT NOT NULL,
    catalog_revision_id TEXT NOT NULL,
    criteria_snapshot_id TEXT NOT NULL,
    ranking_snapshot_id TEXT NOT NULL,
    evidence_rules_version TEXT NOT NULL,
    context_hash TEXT NOT NULL CHECK (length(context_hash) = 64),
    assessment_at TEXT NOT NULL,
    completed_at TEXT NOT NULL,
    canonical_payload TEXT NOT NULL,
    payload_hash TEXT NOT NULL CHECK (length(payload_hash) = 64),
    hmac TEXT NOT NULL CHECK (length(hmac) = 64)
  );
`);

const CURRENT_COUNTRY_RESOLUTION_TABLE = normalizeSchemaSql(`
  CREATE TABLE IF NOT EXISTS country_resolution_revisions (
    id TEXT PRIMARY KEY,
    resolution_run_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('working', 'resolved')),
    predecessor_id TEXT REFERENCES country_resolution_revisions(id),
    automatic_shortlist_snapshot_id TEXT NOT NULL REFERENCES place_frontier_snapshots(id),
    ranking_snapshot_id TEXT NOT NULL REFERENCES place_frontier_snapshots(id),
    command_id TEXT NOT NULL,
    command_kind TEXT NOT NULL CHECK (
      command_kind IN ('start', 'yellow_decision', 'replacement_completed')
    ),
    command_json TEXT NOT NULL,
    command_hash TEXT NOT NULL CHECK (length(command_hash) = 64),
    schema_version TEXT NOT NULL CHECK (schema_version = 'country-resolution@1'),
    rules_version TEXT NOT NULL CHECK (rules_version = 'country-resolution@1'),
    context_hash TEXT NOT NULL CHECK (length(context_hash) = 64),
    payload_json TEXT NOT NULL,
    payload_hash TEXT NOT NULL CHECK (length(payload_hash) = 64),
    hmac TEXT NOT NULL CHECK (length(hmac) = 64),
    created_at TEXT NOT NULL,
    CHECK (predecessor_id IS NULL OR predecessor_id <> id)
  );
`);

interface SchemaEntry {
  readonly type: string;
  readonly sql: string | null;
}

interface ForeignKeyEntry {
  readonly id: number;
  readonly seq: number;
  readonly table: string;
  readonly from: string;
  readonly to: string | null;
  readonly on_update: string;
  readonly on_delete: string;
  readonly match: string;
}

function normalizeSchemaSql(value: string): string {
  return value.toLowerCase().replace(/\s+/g, "").replace("ifnotexists", "").replace(/;$/, "");
}

function hasCurrentBranchCommitForeignKey(database: Database.Database): boolean {
  const foreignKeys = database.pragma("foreign_key_list(run_revisions)") as ForeignKeyEntry[];
  const candidates = foreignKeys.filter((entry) => entry.from === "branch_commit_id");
  if (candidates.length !== 1) return false;
  const candidate = candidates[0]!;
  return candidate.seq === 0 && candidate.table === "branch_commits" && candidate.to === "id" &&
    candidate.on_update === "NO ACTION" && candidate.on_delete === "NO ACTION" &&
    candidate.match === "NONE" && foreignKeys.filter((entry) => entry.id === candidate.id).length === 1;
}

function preflightExistingRunRevisions(database: Database.Database): void {
  const entry = database.prepare(`
    SELECT type, sql FROM sqlite_master WHERE name = 'run_revisions'
  `).get() as SchemaEntry | undefined;
  if (entry === undefined) return;
  if (
    entry.type !== "table" || entry.sql === null ||
    !normalizeSchemaSql(entry.sql).includes(CURRENT_RUN_REVISIONS_STAGE_CHECK) ||
    !hasCurrentBranchCommitForeignKey(database)
  ) {
    throw new Error("database_schema_reset_required");
  }
}

function preflightExistingCountryKnowledge(database: Database.Database): void {
  const entry = database.prepare(`
    SELECT type, sql FROM sqlite_master WHERE name = 'country_knowledge_revisions'
  `).get() as SchemaEntry | undefined;
  if (entry === undefined) return;
  if (
    entry.type !== "table" || entry.sql === null ||
    normalizeSchemaSql(entry.sql) !== CURRENT_COUNTRY_KNOWLEDGE_TABLE
  ) {
    throw new Error("database_schema_reset_required");
  }
}

function preflightExistingCityEvidence(database: Database.Database): void {
  const entry = database.prepare(`
    SELECT type, sql FROM sqlite_master WHERE name = 'city_evidence_snapshots'
  `).get() as SchemaEntry | undefined;
  if (entry === undefined) return;
  if (
    entry.type !== "table" || entry.sql === null ||
    normalizeSchemaSql(entry.sql) !== CURRENT_CITY_EVIDENCE_TABLE
  ) {
    throw new Error("database_schema_reset_required");
  }
}

function preflightExistingCountryResolution(database: Database.Database): void {
  const entry = database.prepare(`
    SELECT type, sql FROM sqlite_master WHERE name = 'country_resolution_revisions'
  `).get() as SchemaEntry | undefined;
  if (entry === undefined) return;
  if (
    entry.type !== "table" || entry.sql === null ||
    normalizeSchemaSql(entry.sql) !== CURRENT_COUNTRY_RESOLUTION_TABLE
  ) {
    throw new Error("database_schema_reset_required");
  }
}

export function openEvidenceDatabase(path: string): Database.Database {
  const database = new Database(path);
  try {
    database.pragma("foreign_keys = ON");
    preflightExistingRunRevisions(database);
    preflightExistingCityEvidence(database);
    preflightExistingCountryKnowledge(database);
    preflightExistingCountryResolution(database);
    database.exec(schema);
    return database;
  } catch (error) {
    try {
      database.close();
    } catch (closeError) {
      void closeError;
    }
    throw error;
  }
}
