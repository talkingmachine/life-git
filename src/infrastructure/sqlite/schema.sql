CREATE TABLE IF NOT EXISTS artifacts (
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
);

CREATE TABLE IF NOT EXISTS evidence_snapshots (
  id TEXT PRIMARY KEY,
  assessment_date TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  manifest_json TEXT NOT NULL,
  manifest_hash TEXT NOT NULL,
  hmac TEXT NOT NULL,
  parser_versions_json TEXT NOT NULL,
  rules_version TEXT NOT NULL
);

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

CREATE UNIQUE INDEX IF NOT EXISTS country_knowledge_one_root
ON country_knowledge_revisions (country_code)
WHERE predecessor_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS country_knowledge_one_successor
ON country_knowledge_revisions (predecessor_id)
WHERE predecessor_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS dossier_versions (
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
);

CREATE UNIQUE INDEX IF NOT EXISTS dossier_versions_one_successor
ON dossier_versions (predecessor_id)
WHERE predecessor_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS dossier_versions_one_root
ON dossier_versions (country_code, schema_version)
WHERE predecessor_id IS NULL;

CREATE TABLE IF NOT EXISTS profile_snapshots (
  id TEXT PRIMARY KEY,
  confirmed_at TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  snapshot_hash TEXT NOT NULL
);

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

CREATE TABLE IF NOT EXISTS place_frontier_snapshots (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('ranking', 'shortlist')),
  schema_version TEXT NOT NULL CHECK (
    schema_version IN ('place-ranking@1', 'place-shortlist@1')
  ),
  payload_json TEXT NOT NULL,
  payload_hash TEXT NOT NULL CHECK (length(payload_hash) = 64),
  hmac TEXT NOT NULL CHECK (length(hmac) = 64),
  created_at TEXT NOT NULL,
  UNIQUE (run_id, kind)
);

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

CREATE UNIQUE INDEX IF NOT EXISTS country_resolution_one_root
ON country_resolution_revisions (resolution_run_id)
WHERE predecessor_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS country_resolution_one_successor
ON country_resolution_revisions (predecessor_id)
WHERE predecessor_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS country_resolution_one_command
ON country_resolution_revisions (resolution_run_id, command_id);

CREATE UNIQUE INDEX IF NOT EXISTS country_resolution_one_terminal
ON country_resolution_revisions (resolution_run_id)
WHERE kind = 'resolved';

CREATE TABLE IF NOT EXISTS run_revisions (
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
  branch_commit_id TEXT REFERENCES branch_commits(id),
  formula_hash TEXT,
  output_hash TEXT,
  revision_json TEXT NOT NULL,
  hmac TEXT NOT NULL,
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
);

CREATE UNIQUE INDEX IF NOT EXISTS run_revisions_one_assessment_per_run
ON run_revisions (run_id)
WHERE stage = 'assessment';

CREATE UNIQUE INDEX IF NOT EXISTS run_revisions_one_revision_per_commit
ON run_revisions (branch_commit_id)
WHERE stage = 'branch';

CREATE TABLE IF NOT EXISTS branch_commits (
  id TEXT PRIMARY KEY,
  parent_id TEXT REFERENCES branch_commits(id),
  forked_from TEXT REFERENCES branch_commits(id),
  profile_id TEXT NOT NULL REFERENCES profile_snapshots(id),
  evidence_snapshot_id TEXT NOT NULL REFERENCES evidence_snapshots(id),
  assessment_id TEXT NOT NULL,
  rules_version TEXT NOT NULL,
  formula_hash TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  output_hash TEXT NOT NULL,
  commit_json TEXT NOT NULL,
  commit_hash TEXT NOT NULL,
  hmac TEXT NOT NULL
);

CREATE TRIGGER IF NOT EXISTS artifacts_no_update
BEFORE UPDATE ON artifacts
WHEN OLD.sealed = 1
BEGIN
  SELECT RAISE(ABORT, 'sealed_artifact_is_immutable');
END;

CREATE TRIGGER IF NOT EXISTS artifacts_no_delete
BEFORE DELETE ON artifacts
WHEN OLD.sealed = 1
BEGIN
  SELECT RAISE(ABORT, 'sealed_artifact_is_immutable');
END;

CREATE TRIGGER IF NOT EXISTS evidence_snapshots_no_update
BEFORE UPDATE ON evidence_snapshots
BEGIN
  SELECT RAISE(ABORT, 'sealed_snapshot_is_immutable');
END;

CREATE TRIGGER IF NOT EXISTS evidence_snapshots_no_delete
BEFORE DELETE ON evidence_snapshots
BEGIN
  SELECT RAISE(ABORT, 'sealed_snapshot_is_immutable');
END;

CREATE TRIGGER IF NOT EXISTS city_evidence_snapshots_no_update
BEFORE UPDATE ON city_evidence_snapshots
BEGIN
  SELECT RAISE(ABORT, 'city_evidence_snapshot_is_immutable');
END;

CREATE TRIGGER IF NOT EXISTS city_evidence_snapshots_no_delete
BEFORE DELETE ON city_evidence_snapshots
BEGIN
  SELECT RAISE(ABORT, 'city_evidence_snapshot_is_immutable');
END;

CREATE TRIGGER IF NOT EXISTS country_knowledge_revisions_no_update
BEFORE UPDATE ON country_knowledge_revisions
BEGIN
  SELECT RAISE(ABORT, 'country_knowledge_revision_is_immutable');
END;

CREATE TRIGGER IF NOT EXISTS country_knowledge_revisions_no_delete
BEFORE DELETE ON country_knowledge_revisions
BEGIN
  SELECT RAISE(ABORT, 'country_knowledge_revision_is_immutable');
END;

CREATE TRIGGER IF NOT EXISTS dossier_versions_no_update
BEFORE UPDATE ON dossier_versions
BEGIN
  SELECT RAISE(ABORT, 'dossier_version_is_immutable');
END;

CREATE TRIGGER IF NOT EXISTS dossier_versions_no_delete
BEFORE DELETE ON dossier_versions
BEGIN
  SELECT RAISE(ABORT, 'dossier_version_is_immutable');
END;

CREATE TRIGGER IF NOT EXISTS profile_snapshots_no_update
BEFORE UPDATE ON profile_snapshots
BEGIN
  SELECT RAISE(ABORT, 'profile_snapshot_is_immutable');
END;

CREATE TRIGGER IF NOT EXISTS profile_snapshots_no_delete
BEFORE DELETE ON profile_snapshots
BEGIN
  SELECT RAISE(ABORT, 'profile_snapshot_is_immutable');
END;

CREATE TRIGGER IF NOT EXISTS onboarding_confirmations_no_update
BEFORE UPDATE ON onboarding_confirmations
BEGIN
  SELECT RAISE(ABORT, 'onboarding_confirmation_is_immutable');
END;

CREATE TRIGGER IF NOT EXISTS onboarding_confirmations_no_delete
BEFORE DELETE ON onboarding_confirmations
BEGIN
  SELECT RAISE(ABORT, 'onboarding_confirmation_is_immutable');
END;

CREATE TRIGGER IF NOT EXISTS place_frontier_snapshots_no_update
BEFORE UPDATE ON place_frontier_snapshots
BEGIN
  SELECT RAISE(ABORT, 'place_frontier_snapshot_is_immutable');
END;

CREATE TRIGGER IF NOT EXISTS place_frontier_snapshots_no_delete
BEFORE DELETE ON place_frontier_snapshots
BEGIN
  SELECT RAISE(ABORT, 'place_frontier_snapshot_is_immutable');
END;

CREATE TRIGGER IF NOT EXISTS country_resolution_revisions_no_update
BEFORE UPDATE ON country_resolution_revisions
BEGIN
  SELECT RAISE(ABORT, 'country_resolution_revision_is_immutable');
END;

CREATE TRIGGER IF NOT EXISTS country_resolution_revisions_no_delete
BEFORE DELETE ON country_resolution_revisions
BEGIN
  SELECT RAISE(ABORT, 'country_resolution_revision_is_immutable');
END;

CREATE TRIGGER IF NOT EXISTS run_revisions_no_update
BEFORE UPDATE ON run_revisions
BEGIN
  SELECT RAISE(ABORT, 'run_revision_is_immutable');
END;

CREATE TRIGGER IF NOT EXISTS run_revisions_no_delete
BEFORE DELETE ON run_revisions
BEGIN
  SELECT RAISE(ABORT, 'run_revision_is_immutable');
END;

CREATE TRIGGER IF NOT EXISTS branch_commits_no_update
BEFORE UPDATE ON branch_commits
BEGIN
  SELECT RAISE(ABORT, 'branch_commit_is_immutable');
END;

CREATE TRIGGER IF NOT EXISTS branch_commits_no_delete
BEFORE DELETE ON branch_commits
BEGIN
  SELECT RAISE(ABORT, 'branch_commit_is_immutable');
END;
