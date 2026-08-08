import { readFileSync } from "node:fs";

import Database from "better-sqlite3";

const schema = readFileSync(new URL("./schema.sql", import.meta.url), "utf8");

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
  return value.toLowerCase().replace(/\s+/g, "");
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

export function openEvidenceDatabase(path: string): Database.Database {
  const database = new Database(path);
  try {
    database.pragma("foreign_keys = ON");
    preflightExistingRunRevisions(database);
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
