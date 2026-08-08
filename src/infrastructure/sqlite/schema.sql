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

CREATE TABLE IF NOT EXISTS profile_snapshots (
  id TEXT PRIMARY KEY,
  confirmed_at TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  snapshot_hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS run_revisions (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  stage TEXT NOT NULL CHECK (stage = 'assessment'),
  assessment_date TEXT NOT NULL,
  initial_housing_json TEXT NOT NULL,
  profile_id TEXT NOT NULL REFERENCES profile_snapshots(id),
  evidence_snapshot_id TEXT NOT NULL REFERENCES evidence_snapshots(id),
  assessment_id TEXT NOT NULL,
  assessment_json TEXT NOT NULL,
  rules_version TEXT NOT NULL,
  revision_json TEXT NOT NULL,
  hmac TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS run_revisions_one_assessment_per_run
ON run_revisions (run_id)
WHERE stage = 'assessment';

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
