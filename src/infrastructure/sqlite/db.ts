import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import Database from "better-sqlite3";

const schema = readFileSync(resolve("src/infrastructure/sqlite/schema.sql"), "utf8");

const CURRENT_ARTIFACTS_TABLE = normalizeExactSchemaSql(`
CREATE TABLE IF NOT EXISTS artifacts (
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
  ),
  PRIMARY KEY (run_id, artifact_id)
);
`);

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

const CURRENT_DOSSIER_V2_TABLE = normalizeExactSchemaSql(`
CREATE TABLE IF NOT EXISTS dossier_versions_v2 (
  id TEXT PRIMARY KEY,
  country_code TEXT NOT NULL CHECK (country_code = 'SI'),
  predecessor_id TEXT REFERENCES dossier_versions_v2(id),
  evidence_snapshot_id TEXT NOT NULL REFERENCES evidence_snapshots(id),
  schema_version TEXT NOT NULL CHECK (schema_version = 'si-dossier@2'),
  payload_json TEXT NOT NULL,
  payload_hash TEXT NOT NULL CHECK (length(payload_hash) = 64),
  manifest_hash TEXT NOT NULL CHECK (length(manifest_hash) = 64),
  hmac TEXT NOT NULL CHECK (length(hmac) = 64),
  published_at TEXT NOT NULL,
  CHECK (predecessor_id IS NULL OR predecessor_id <> id),
  UNIQUE (country_code, evidence_snapshot_id)
);
`);

const CURRENT_DOSSIER_V2_ONE_SUCCESSOR = normalizeExactSchemaSql(`
CREATE UNIQUE INDEX IF NOT EXISTS dossier_versions_v2_one_successor
ON dossier_versions_v2 (predecessor_id)
WHERE predecessor_id IS NOT NULL;
`);

const CURRENT_DOSSIER_V2_ONE_ROOT = normalizeExactSchemaSql(`
CREATE UNIQUE INDEX IF NOT EXISTS dossier_versions_v2_one_root
ON dossier_versions_v2 (country_code)
WHERE predecessor_id IS NULL;
`);

const CURRENT_DOSSIER_V2_NO_UPDATE = normalizeExactSchemaSql(`
CREATE TRIGGER IF NOT EXISTS dossier_versions_v2_no_update
BEFORE UPDATE ON dossier_versions_v2
BEGIN
  SELECT RAISE(ABORT, 'dossier_version_v2_is_immutable');
END;
`);

const CURRENT_DOSSIER_V2_NO_DELETE = normalizeExactSchemaSql(`
CREATE TRIGGER IF NOT EXISTS dossier_versions_v2_no_delete
BEFORE DELETE ON dossier_versions_v2
BEGIN
  SELECT RAISE(ABORT, 'dossier_version_v2_is_immutable');
END;
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

const CURRENT_ONBOARDING_CONFIRMATIONS_TABLE = normalizeExactSchemaSql(`
CREATE TABLE IF NOT EXISTS onboarding_confirmations (
  schema_version TEXT NOT NULL
    CHECK (schema_version = 'onboarding-receipt@1'),
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
`);

const CURRENT_ONBOARDING_NO_UPDATE_TRIGGER = normalizeExactSchemaSql(`
CREATE TRIGGER IF NOT EXISTS onboarding_confirmations_no_update
BEFORE UPDATE ON onboarding_confirmations
BEGIN
  SELECT RAISE(ABORT, 'onboarding_confirmation_is_immutable');
END;
`);

const CURRENT_ONBOARDING_NO_DELETE_TRIGGER = normalizeExactSchemaSql(`
CREATE TRIGGER IF NOT EXISTS onboarding_confirmations_no_delete
BEFORE DELETE ON onboarding_confirmations
BEGIN
  SELECT RAISE(ABORT, 'onboarding_confirmation_is_immutable');
END;
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

interface IndexListEntry {
  readonly name: string;
  readonly unique: number;
}

interface IndexInfoEntry {
  readonly seqno: number;
  readonly name: string;
}

function normalizeSchemaSql(value: string): string {
  return value.toLowerCase().replace(/\s+/g, "").replace("ifnotexists", "").replace(/;$/, "");
}

function normalizeExactSchemaSql(value: string): string {
  const withoutOptionalExistence = value.trim()
    .replace(/^CREATE TABLE IF NOT EXISTS /, "CREATE TABLE ")
    .replace(/^CREATE TRIGGER IF NOT EXISTS /, "CREATE TRIGGER ")
    .replace(/^CREATE UNIQUE INDEX IF NOT EXISTS /, "CREATE UNIQUE INDEX ");
  return withoutOptionalExistence.endsWith(";")
    ? withoutOptionalExistence.slice(0, -1).trimEnd()
    : withoutOptionalExistence;
}

function preflightExistingArtifacts(database: Database.Database): void {
  const entry = database.prepare(`
    SELECT type, sql FROM sqlite_master WHERE name = 'artifacts'
  `).get() as SchemaEntry | undefined;
  if (entry === undefined) return;
  if (
    entry.type !== "table" || entry.sql === null ||
    normalizeExactSchemaSql(entry.sql) !== CURRENT_ARTIFACTS_TABLE
  ) throw new Error("database_schema_reset_required");
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

function hasExactDossierV2Object(
  database: Database.Database,
  name: string,
  type: "index" | "trigger",
  expectedSql: string,
): boolean {
  const entry = database.prepare(
    "SELECT type, sql FROM sqlite_master WHERE name = ?",
  ).get(name) as SchemaEntry | undefined;
  return entry !== undefined && entry.type === type && entry.sql !== null &&
    normalizeExactSchemaSql(entry.sql) === expectedSql;
}

function hasExactDossierV2ObjectSet(database: Database.Database): boolean {
  const objects = database.prepare(`
    SELECT type, name FROM sqlite_master
    WHERE tbl_name = 'dossier_versions_v2' AND name NOT LIKE 'sqlite_%'
    ORDER BY type, name
  `).all() as Array<{ readonly type: string; readonly name: string }>;
  const expected = [
    { type: "index", name: "dossier_versions_v2_one_root" },
    { type: "index", name: "dossier_versions_v2_one_successor" },
    { type: "table", name: "dossier_versions_v2" },
    { type: "trigger", name: "dossier_versions_v2_no_delete" },
    { type: "trigger", name: "dossier_versions_v2_no_update" },
  ];
  return objects.length === expected.length && objects.every((entry, index) =>
    entry.type === expected[index]!.type && entry.name === expected[index]!.name
  );
}

function preflightExistingDossierV2(database: Database.Database): void {
  const entry = database.prepare(`
    SELECT type, sql FROM sqlite_master WHERE name = 'dossier_versions_v2'
  `).get() as SchemaEntry | undefined;
  const objectNames = [
    "dossier_versions_v2_one_successor",
    "dossier_versions_v2_one_root",
    "dossier_versions_v2_no_update",
    "dossier_versions_v2_no_delete",
  ] as const;
  if (entry === undefined) {
    const orphanedObject = database.prepare(`
      SELECT 1 FROM sqlite_master WHERE name IN (?, ?, ?, ?) LIMIT 1
    `).get(...objectNames);
    if (orphanedObject !== undefined) throw new Error("database_schema_reset_required");
    return;
  }
  if (
    entry.type !== "table" || entry.sql === null ||
    normalizeExactSchemaSql(entry.sql) !== CURRENT_DOSSIER_V2_TABLE ||
    !hasExactDossierV2ObjectSet(database) ||
    !hasExactDossierV2Object(
      database,
      objectNames[0],
      "index",
      CURRENT_DOSSIER_V2_ONE_SUCCESSOR,
    ) ||
    !hasExactDossierV2Object(
      database,
      objectNames[1],
      "index",
      CURRENT_DOSSIER_V2_ONE_ROOT,
    ) ||
    !hasExactDossierV2Object(
      database,
      objectNames[2],
      "trigger",
      CURRENT_DOSSIER_V2_NO_UPDATE,
    ) ||
    !hasExactDossierV2Object(
      database,
      objectNames[3],
      "trigger",
      CURRENT_DOSSIER_V2_NO_DELETE,
    )
  ) throw new Error("database_schema_reset_required");
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

function hasCurrentOnboardingForeignKeys(database: Database.Database): boolean {
  const foreignKeys = database.pragma(
    "foreign_key_list(onboarding_confirmations)",
  ) as ForeignKeyEntry[];
  if (foreignKeys.length !== 2) return false;
  return ["profile_id", "preference_profile_id"].every((column) => {
    const candidates = foreignKeys.filter((entry) => entry.from === column);
    if (candidates.length !== 1) return false;
    const candidate = candidates[0]!;
    return candidate.seq === 0 &&
      candidate.table === "profile_snapshots" &&
      candidate.to === "id" &&
      candidate.on_update === "NO ACTION" &&
      candidate.on_delete === "NO ACTION" &&
      candidate.match === "NONE" &&
      foreignKeys.filter((entry) => entry.id === candidate.id).length === 1;
  });
}

function hasCurrentOnboardingUniqueConstraints(database: Database.Database): boolean {
  const indexes = database.pragma(
    "index_list(onboarding_confirmations)",
  ) as IndexListEntry[];
  const uniqueColumnSets = indexes
    .filter(({ unique }) => unique === 1)
    .map(({ name }) => (database.pragma(`index_info('${name}')`) as IndexInfoEntry[])
      .sort((left, right) => left.seqno - right.seqno)
      .map(({ name: column }) => column)
      .join(","))
    .sort();
  const expected = [
    "completion_command_id",
    "confirmed_at",
    "frontier_run_id",
    "profile_id,preference_profile_id",
    "receipt_id",
  ];
  return uniqueColumnSets.length === expected.length &&
    uniqueColumnSets.every((value, index) => value === expected[index]);
}

function hasExactSchemaObject(
  database: Database.Database,
  name: string,
  type: "trigger",
  expectedSql: string,
): boolean {
  const entry = database.prepare(
    "SELECT type, sql FROM sqlite_master WHERE name = ?",
  ).get(name) as SchemaEntry | undefined;
  return entry !== undefined && entry.type === type && entry.sql !== null &&
    normalizeExactSchemaSql(entry.sql) === expectedSql;
}

function preflightExistingOnboardingConfirmations(database: Database.Database): void {
  const entry = database.prepare(`
    SELECT type, sql FROM sqlite_master WHERE name = 'onboarding_confirmations'
  `).get() as SchemaEntry | undefined;
  const triggerNames = [
    "onboarding_confirmations_no_update",
    "onboarding_confirmations_no_delete",
  ] as const;
  if (entry === undefined) {
    const orphanedObject = database.prepare(`
      SELECT 1 FROM sqlite_master WHERE name IN (?, ?) LIMIT 1
    `).get(...triggerNames);
    if (orphanedObject !== undefined) throw new Error("database_schema_reset_required");
    return;
  }
  if (
    entry.type !== "table" ||
    entry.sql === null ||
    normalizeExactSchemaSql(entry.sql) !== CURRENT_ONBOARDING_CONFIRMATIONS_TABLE ||
    !hasCurrentOnboardingForeignKeys(database) ||
    !hasCurrentOnboardingUniqueConstraints(database) ||
    !hasExactSchemaObject(
      database,
      triggerNames[0],
      "trigger",
      CURRENT_ONBOARDING_NO_UPDATE_TRIGGER,
    ) ||
    !hasExactSchemaObject(
      database,
      triggerNames[1],
      "trigger",
      CURRENT_ONBOARDING_NO_DELETE_TRIGGER,
    )
  ) throw new Error("database_schema_reset_required");
}

export function openEvidenceDatabase(path: string): Database.Database {
  const database = new Database(path);
  try {
    database.pragma("foreign_keys = ON");
    preflightExistingArtifacts(database);
    preflightExistingRunRevisions(database);
    preflightExistingCityEvidence(database);
    preflightExistingCountryKnowledge(database);
    preflightExistingDossierV2(database);
    preflightExistingCountryResolution(database);
    preflightExistingOnboardingConfirmations(database);
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
