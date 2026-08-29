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

const CURRENT_CITY_CATALOG_TABLE = normalizeExactSchemaSql(`
CREATE TABLE IF NOT EXISTS city_catalog_revisions (
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
);
`);

const CURRENT_CITY_KNOWLEDGE_TABLE = normalizeExactSchemaSql(`
CREATE TABLE IF NOT EXISTS city_knowledge_revisions (
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
);
`);

const CURRENT_CITY_KNOWLEDGE_ONE_ROOT = normalizeExactSchemaSql(`
CREATE UNIQUE INDEX IF NOT EXISTS city_knowledge_one_root
ON city_knowledge_revisions (city_id)
WHERE predecessor_id IS NULL;
`);

const CURRENT_CITY_KNOWLEDGE_ONE_SUCCESSOR = normalizeExactSchemaSql(`
CREATE UNIQUE INDEX IF NOT EXISTS city_knowledge_one_successor
ON city_knowledge_revisions (predecessor_id)
WHERE predecessor_id IS NOT NULL;
`);

const CURRENT_CITY_CATALOG_NO_UPDATE = normalizeExactSchemaSql(`
CREATE TRIGGER IF NOT EXISTS city_catalog_revisions_no_update
BEFORE UPDATE ON city_catalog_revisions
BEGIN
  SELECT RAISE(ABORT, 'city_catalog_revision_is_immutable');
END;
`);

const CURRENT_CITY_CATALOG_NO_DELETE = normalizeExactSchemaSql(`
CREATE TRIGGER IF NOT EXISTS city_catalog_revisions_no_delete
BEFORE DELETE ON city_catalog_revisions
BEGIN
  SELECT RAISE(ABORT, 'city_catalog_revision_is_immutable');
END;
`);

const CURRENT_CITY_KNOWLEDGE_NO_UPDATE = normalizeExactSchemaSql(`
CREATE TRIGGER IF NOT EXISTS city_knowledge_revisions_no_update
BEFORE UPDATE ON city_knowledge_revisions
BEGIN
  SELECT RAISE(ABORT, 'city_knowledge_revision_is_immutable');
END;
`);

const CURRENT_CITY_KNOWLEDGE_NO_DELETE = normalizeExactSchemaSql(`
CREATE TRIGGER IF NOT EXISTS city_knowledge_revisions_no_delete
BEFORE DELETE ON city_knowledge_revisions
BEGIN
  SELECT RAISE(ABORT, 'city_knowledge_revision_is_immutable');
END;
`);

const CURRENT_INSTALLED_CITY_PACKAGE_MANIFESTS = normalizeExactSchemaSql(`
CREATE TABLE IF NOT EXISTS installed_city_package_manifests (
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
);
`);

const CURRENT_INSTALLED_CITY_PACKAGE_HEADS = normalizeExactSchemaSql(`
CREATE TABLE IF NOT EXISTS installed_city_package_heads (
  country_code TEXT PRIMARY KEY CHECK (
    length(country_code) = 2
    AND country_code = upper(country_code)
    AND country_code GLOB '[A-Z][A-Z]'
  ),
  current_manifest_id TEXT NOT NULL UNIQUE,
  FOREIGN KEY (country_code, current_manifest_id)
    REFERENCES installed_city_package_manifests(country_code, id)
);
`);

const TASK4_OBJECTS = [
  ["installed_city_package_manifest_country_id", "index", normalizeExactSchemaSql(`
CREATE UNIQUE INDEX IF NOT EXISTS installed_city_package_manifest_country_id
ON installed_city_package_manifests (country_code, id);
  `)],
  ["installed_city_package_manifest_exact_key", "index", normalizeExactSchemaSql(`
CREATE UNIQUE INDEX IF NOT EXISTS installed_city_package_manifest_exact_key
ON installed_city_package_manifests (
  country_code, package_id, package_schema_version, catalog_revision_id, evidence_rules_version
);
  `)],
  ["installed_city_package_manifest_one_root", "index", normalizeExactSchemaSql(`
CREATE UNIQUE INDEX IF NOT EXISTS installed_city_package_manifest_one_root
ON installed_city_package_manifests (country_code)
WHERE predecessor_manifest_id IS NULL;
  `)],
  ["installed_city_package_manifest_one_successor", "index", normalizeExactSchemaSql(`
CREATE UNIQUE INDEX IF NOT EXISTS installed_city_package_manifest_one_successor
ON installed_city_package_manifests (predecessor_manifest_id)
WHERE predecessor_manifest_id IS NOT NULL;
  `)],
  ["installed_city_package_manifests_no_delete", "trigger", normalizeExactSchemaSql(`
CREATE TRIGGER IF NOT EXISTS installed_city_package_manifests_no_delete
BEFORE DELETE ON installed_city_package_manifests
BEGIN
  SELECT RAISE(ABORT, 'installed_city_package_manifest_is_immutable');
END;
  `)],
  ["installed_city_package_manifests_no_update", "trigger", normalizeExactSchemaSql(`
CREATE TRIGGER IF NOT EXISTS installed_city_package_manifests_no_update
BEFORE UPDATE ON installed_city_package_manifests
BEGIN
  SELECT RAISE(ABORT, 'installed_city_package_manifest_is_immutable');
END;
  `)],
] as const;

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

interface Task13SchemaEntry {
  readonly type: string;
  readonly name: string;
  readonly tbl_name: string;
  readonly sql: string | null;
}

interface Task13TableInfoEntry {
  readonly cid: number;
  readonly name: string;
  readonly type: string;
  readonly notnull: number;
  readonly dflt_value: string | null;
  readonly pk: number;
}

interface Task13IndexListEntry {
  readonly name: string;
  readonly unique: number;
  readonly origin: string;
  readonly partial: number;
}

interface Task13IndexInfoEntry {
  readonly seqno: number;
  readonly cid: number;
  readonly name: string;
}

interface Task13PragmaSnapshot {
  readonly tables: Readonly<Record<string, {
    readonly tableInfo: readonly Task13TableInfoEntry[];
    readonly foreignKeys: readonly ForeignKeyEntry[];
    readonly indexes: readonly Task13IndexListEntry[];
    readonly indexColumns: Readonly<Record<string, readonly Task13IndexInfoEntry[]>>;
  }>>;
  readonly manifestExactKey: readonly Task13IndexInfoEntry[];
}

const TASK13_TABLE_NAMES = [
  "city_criteria_snapshots",
  "city_branch_commits",
  "city_ranking_snapshots",
  "city_frontier_revisions",
  "city_selection_snapshots",
] as const;

const TASK13_NAME_PREFIXES = [
  "city_criteria_",
  "city_branch_",
  "city_ranking_",
  "city_frontier_",
  "city_selection_",
] as const;

let cachedTask13Schema: readonly Task13SchemaEntry[] | undefined;
let cachedTask13Pragmas: Task13PragmaSnapshot | undefined;

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

function task13SchemaEntries(database: Database.Database): readonly Task13SchemaEntry[] {
  return (database.prepare(`
    SELECT type, name, tbl_name, sql FROM sqlite_master
    WHERE name NOT LIKE 'sqlite_%'
  `).all() as Task13SchemaEntry[]).filter((entry) =>
    TASK13_TABLE_NAMES.includes(entry.tbl_name as typeof TASK13_TABLE_NAMES[number]) ||
    TASK13_NAME_PREFIXES.some((prefix) => entry.name.startsWith(prefix))
  ).sort((left, right) => left.type.localeCompare(right.type) ||
    left.name.localeCompare(right.name));
}

function expectedTask13Schema(): readonly Task13SchemaEntry[] {
  if (cachedTask13Schema !== undefined) return cachedTask13Schema;
  const reference = new Database(":memory:");
  try {
    reference.exec(schema);
    cachedTask13Schema = task13SchemaEntries(reference);
    return cachedTask13Schema;
  } finally {
    reference.close();
  }
}

function task13TableInfo(
  database: Database.Database,
  table: string,
): readonly Task13TableInfoEntry[] {
  return (database.pragma(`table_info(${table})`) as Task13TableInfoEntry[])
    .map(({ cid, name, type, notnull, dflt_value: defaultValue, pk }) => ({
      cid,
      name,
      type,
      notnull,
      dflt_value: defaultValue,
      pk,
    }));
}

function task13ForeignKeys(
  database: Database.Database,
  table: string,
): readonly ForeignKeyEntry[] {
  return (database.pragma(`foreign_key_list(${table})`) as ForeignKeyEntry[])
    .map(({ id, seq, table: parent, from, to, on_update: onUpdate,
      on_delete: onDelete, match }) => ({
      id,
      seq,
      table: parent,
      from,
      to,
      on_update: onUpdate,
      on_delete: onDelete,
      match,
    }));
}

function task13IndexList(
  database: Database.Database,
  table: string,
): readonly Task13IndexListEntry[] {
  return (database.pragma(`index_list(${table})`) as Task13IndexListEntry[])
    .map(({ name, unique, origin, partial }) => ({ name, unique, origin, partial }));
}

function task13IndexInfo(
  database: Database.Database,
  index: string,
): readonly Task13IndexInfoEntry[] {
  return (database.pragma(`index_info(${index})`) as Task13IndexInfoEntry[])
    .map(({ seqno, cid, name }) => ({ seqno, cid, name }));
}

function captureTask13Pragmas(database: Database.Database): Task13PragmaSnapshot {
  const tables: Record<string, {
    readonly tableInfo: readonly Task13TableInfoEntry[];
    readonly foreignKeys: readonly ForeignKeyEntry[];
    readonly indexes: readonly Task13IndexListEntry[];
    readonly indexColumns: Readonly<Record<string, readonly Task13IndexInfoEntry[]>>;
  }> = {};
  for (const table of TASK13_TABLE_NAMES) {
    const indexes = task13IndexList(database, table);
    tables[table] = {
      tableInfo: task13TableInfo(database, table),
      foreignKeys: task13ForeignKeys(database, table),
      indexes,
      indexColumns: Object.fromEntries(indexes.map(({ name }) => [
        name,
        task13IndexInfo(database, name),
      ])),
    };
  }
  return {
    tables,
    manifestExactKey: task13IndexInfo(
      database,
      "installed_city_package_manifest_exact_key",
    ),
  };
}

function expectedTask13Pragmas(): Task13PragmaSnapshot {
  if (cachedTask13Pragmas !== undefined) return cachedTask13Pragmas;
  const reference = new Database(":memory:");
  try {
    reference.pragma("foreign_keys = ON");
    reference.exec(schema);
    cachedTask13Pragmas = captureTask13Pragmas(reference);
    return cachedTask13Pragmas;
  } finally {
    reference.close();
  }
}

function hasExpectedTask13Pragmas(database: Database.Database): boolean {
  try {
    const actual = captureTask13Pragmas(database);
    const expected = expectedTask13Pragmas();
    if (JSON.stringify(actual.tables) !== JSON.stringify(expected.tables)) return false;
    return JSON.stringify(actual.manifestExactKey) ===
      JSON.stringify(expected.manifestExactKey);
  } catch {
    return false;
  }
}

function preflightExistingTask13CityFrontier(database: Database.Database): void {
  const actual = task13SchemaEntries(database);
  const presentTables = new Set(actual
    .filter(({ type, name }) => type === "table" &&
      TASK13_TABLE_NAMES.includes(name as typeof TASK13_TABLE_NAMES[number]))
    .map(({ name }) => name));
  if (presentTables.size === 0) {
    if (actual.length !== 0) throw new Error("database_schema_reset_required");
    return;
  }
  if (presentTables.size !== TASK13_TABLE_NAMES.length) {
    throw new Error("database_schema_reset_required");
  }
  const expected = expectedTask13Schema();
  if (actual.length !== expected.length || actual.some((entry, index) => {
    const reference = expected[index]!;
    return entry.type !== reference.type || entry.name !== reference.name ||
      entry.tbl_name !== reference.tbl_name || entry.sql === null || reference.sql === null ||
      normalizeExactSchemaSql(entry.sql) !== normalizeExactSchemaSql(reference.sql);
  }) || !hasExpectedTask13Pragmas(database)) {
    throw new Error("database_schema_reset_required");
  }
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

function exactAttachedObjects(
  database: Database.Database,
  table: string,
): Array<{ readonly type: string; readonly name: string }> {
  return database.prepare(`
    SELECT type, name FROM sqlite_master
    WHERE tbl_name = ? AND name NOT LIKE 'sqlite_%'
    ORDER BY type, name
  `).all(table) as Array<{ readonly type: string; readonly name: string }>;
}

function sameObjectInventory(
  actual: readonly { readonly type: string; readonly name: string }[],
  expected: readonly { readonly type: string; readonly name: string }[],
): boolean {
  return actual.length === expected.length && actual.every((entry, index) =>
    entry.type === expected[index]!.type && entry.name === expected[index]!.name
  );
}

function exactTask3Object(
  database: Database.Database,
  name: string,
  type: "index" | "trigger",
  sql: string,
): boolean {
  const entry = database.prepare(
    "SELECT type, sql FROM sqlite_master WHERE name = ?",
  ).get(name) as SchemaEntry | undefined;
  return entry !== undefined && entry.type === type && entry.sql !== null &&
    normalizeExactSchemaSql(entry.sql) === sql;
}

function preflightExistingCityPersistence(database: Database.Database): void {
  const catalogObjects = exactAttachedObjects(database, "city_catalog_revisions");
  const knowledgeObjects = exactAttachedObjects(database, "city_knowledge_revisions");
  if (catalogObjects.length === 0 && knowledgeObjects.length === 0) {
    const reservedName = database.prepare(`
      SELECT 1 FROM sqlite_master WHERE name IN (
        'city_catalog_revisions',
        'city_catalog_revisions_no_update',
        'city_catalog_revisions_no_delete',
        'city_knowledge_revisions',
        'city_knowledge_one_root',
        'city_knowledge_one_successor',
        'city_knowledge_revisions_no_update',
        'city_knowledge_revisions_no_delete'
      ) LIMIT 1
    `).get();
    if (reservedName !== undefined) throw new Error("database_schema_reset_required");
    return;
  }
  if (catalogObjects.length === 0 || knowledgeObjects.length === 0) {
    throw new Error("database_schema_reset_required");
  }
  const catalog = database.prepare(
    "SELECT type, sql FROM sqlite_master WHERE name = 'city_catalog_revisions'",
  ).get() as SchemaEntry | undefined;
  const knowledge = database.prepare(
    "SELECT type, sql FROM sqlite_master WHERE name = 'city_knowledge_revisions'",
  ).get() as SchemaEntry | undefined;
  const expectedCatalogObjects = [
    { type: "table", name: "city_catalog_revisions" },
    { type: "trigger", name: "city_catalog_revisions_no_delete" },
    { type: "trigger", name: "city_catalog_revisions_no_update" },
  ];
  const expectedKnowledgeObjects = [
    { type: "index", name: "city_knowledge_one_root" },
    { type: "index", name: "city_knowledge_one_successor" },
    { type: "table", name: "city_knowledge_revisions" },
    { type: "trigger", name: "city_knowledge_revisions_no_delete" },
    { type: "trigger", name: "city_knowledge_revisions_no_update" },
  ];
  if (catalog === undefined || catalog.type !== "table" || catalog.sql === null ||
    normalizeExactSchemaSql(catalog.sql) !== CURRENT_CITY_CATALOG_TABLE ||
    knowledge === undefined || knowledge.type !== "table" || knowledge.sql === null ||
    normalizeExactSchemaSql(knowledge.sql) !== CURRENT_CITY_KNOWLEDGE_TABLE ||
    !sameObjectInventory(catalogObjects, expectedCatalogObjects) ||
    !sameObjectInventory(knowledgeObjects, expectedKnowledgeObjects) ||
    !exactTask3Object(
      database,
      "city_catalog_revisions_no_update",
      "trigger",
      CURRENT_CITY_CATALOG_NO_UPDATE,
    ) ||
    !exactTask3Object(
      database,
      "city_catalog_revisions_no_delete",
      "trigger",
      CURRENT_CITY_CATALOG_NO_DELETE,
    ) ||
    !exactTask3Object(
      database,
      "city_knowledge_one_root",
      "index",
      CURRENT_CITY_KNOWLEDGE_ONE_ROOT,
    ) ||
    !exactTask3Object(
      database,
      "city_knowledge_one_successor",
      "index",
      CURRENT_CITY_KNOWLEDGE_ONE_SUCCESSOR,
    ) ||
    !exactTask3Object(
      database,
      "city_knowledge_revisions_no_update",
      "trigger",
      CURRENT_CITY_KNOWLEDGE_NO_UPDATE,
    ) ||
    !exactTask3Object(
      database,
      "city_knowledge_revisions_no_delete",
      "trigger",
      CURRENT_CITY_KNOWLEDGE_NO_DELETE,
    )) throw new Error("database_schema_reset_required");
}

function preflightExistingInstalledCityPackages(database: Database.Database): void {
  const manifestObjects = exactAttachedObjects(database, "installed_city_package_manifests");
  const headObjects = exactAttachedObjects(database, "installed_city_package_heads");
  const reservedNames = [
    "installed_city_package_manifests",
    "installed_city_package_heads",
    ...TASK4_OBJECTS.map(([name]) => name),
  ];
  if (manifestObjects.length === 0 && headObjects.length === 0) {
    const placeholders = reservedNames.map(() => "?").join(", ");
    const orphan = database.prepare(
      `SELECT 1 FROM sqlite_master WHERE name IN (${placeholders}) LIMIT 1`,
    ).get(...reservedNames);
    if (orphan !== undefined) throw new Error("database_schema_reset_required");
    return;
  }
  if (manifestObjects.length === 0 || headObjects.length === 0) {
    throw new Error("database_schema_reset_required");
  }
  const manifest = database.prepare(
    "SELECT type, sql FROM sqlite_master WHERE name = 'installed_city_package_manifests'",
  ).get() as SchemaEntry | undefined;
  const head = database.prepare(
    "SELECT type, sql FROM sqlite_master WHERE name = 'installed_city_package_heads'",
  ).get() as SchemaEntry | undefined;
  const prerequisites = database.prepare(`
    SELECT COUNT(*) FROM sqlite_master
    WHERE type = 'table' AND name IN ('evidence_snapshots', 'city_catalog_revisions')
  `).pluck().get() as number;
  const expectedManifest = [
    { type: "index", name: "installed_city_package_manifest_country_id" },
    { type: "index", name: "installed_city_package_manifest_exact_key" },
    { type: "index", name: "installed_city_package_manifest_one_root" },
    { type: "index", name: "installed_city_package_manifest_one_successor" },
    { type: "table", name: "installed_city_package_manifests" },
    { type: "trigger", name: "installed_city_package_manifests_no_delete" },
    { type: "trigger", name: "installed_city_package_manifests_no_update" },
  ];
  if (prerequisites !== 2 || manifest === undefined || manifest.type !== "table" ||
    manifest.sql === null ||
    normalizeExactSchemaSql(manifest.sql) !== CURRENT_INSTALLED_CITY_PACKAGE_MANIFESTS ||
    head === undefined || head.type !== "table" || head.sql === null ||
    normalizeExactSchemaSql(head.sql) !== CURRENT_INSTALLED_CITY_PACKAGE_HEADS ||
    !sameObjectInventory(manifestObjects, expectedManifest) ||
    !sameObjectInventory(headObjects, [{ type: "table", name: "installed_city_package_heads" }]) ||
    TASK4_OBJECTS.some(([name, type, sql]) =>
      !exactTask3Object(database, name, type, sql))) {
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

const SOURCE_RECOVERY_TABLES = [
  "city_source_versions",
  "city_source_binding_revisions",
  "city_source_binding_heads",
  "official_source_recovery_attempts",
  "official_source_replacement_events",
] as const;

interface SourceRecoverySchemaEntry {
  readonly type: string;
  readonly name: string;
  readonly tbl_name: string;
  readonly sql: string | null;
}

function sourceRecoveryObjects(database: Database.Database): SourceRecoverySchemaEntry[] {
  const placeholders = SOURCE_RECOVERY_TABLES.map(() => "?").join(", ");
  return database.prepare(`
    SELECT type, name, tbl_name, sql FROM sqlite_master
    WHERE ((type = 'table' AND name IN (${placeholders}))
       OR (tbl_name IN (${placeholders}) AND type IN ('index', 'trigger')))
      AND name NOT LIKE 'sqlite_%'
    ORDER BY type, name
  `).all(...SOURCE_RECOVERY_TABLES, ...SOURCE_RECOVERY_TABLES) as SourceRecoverySchemaEntry[];
}

function preflightExistingCitySourceRecovery(database: Database.Database): void {
  const actual = sourceRecoveryObjects(database);
  if (actual.length === 0) return;
  const present = new Set(actual.filter(({ type }) => type === "table").map(({ name }) => name));
  if (present.size !== SOURCE_RECOVERY_TABLES.length) throw new Error("database_schema_reset_required");
  const reference = new Database(":memory:");
  try {
    reference.pragma("foreign_keys = ON");
    reference.exec(schema);
    const expected = sourceRecoveryObjects(reference);
    if (actual.length !== expected.length || actual.some((entry, index) => {
      const expectedEntry = expected[index]!;
      return entry.type !== expectedEntry.type || entry.name !== expectedEntry.name ||
        entry.tbl_name !== expectedEntry.tbl_name || entry.sql === null || expectedEntry.sql === null ||
        normalizeExactSchemaSql(entry.sql) !== normalizeExactSchemaSql(expectedEntry.sql);
    })) throw new Error("database_schema_reset_required");
  } finally {
    reference.close();
  }
}

export function openEvidenceDatabase(path: string): Database.Database {
  const database = new Database(path);
  try {
    database.pragma("foreign_keys = ON");
    if (database.pragma("foreign_keys", { simple: true }) !== 1) {
      throw new Error("database_schema_reset_required");
    }
    preflightExistingArtifacts(database);
    preflightExistingRunRevisions(database);
    preflightExistingCityEvidence(database);
    preflightExistingCityPersistence(database);
    preflightExistingInstalledCityPackages(database);
    preflightExistingCountryKnowledge(database);
    preflightExistingDossierV2(database);
    preflightExistingCountryResolution(database);
    preflightExistingOnboardingConfirmations(database);
    preflightExistingCitySourceRecovery(database);
    preflightExistingTask13CityFrontier(database);
    database.transaction(() => {
      database.exec(schema);
      preflightExistingCitySourceRecovery(database);
      preflightExistingTask13CityFrontier(database);
    })();
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
