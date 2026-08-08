CREATE TABLE IF NOT EXISTS artifacts (
  artifact_id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  role TEXT NOT NULL,
  url TEXT NOT NULL,
  media_type TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  bytes BLOB NOT NULL,
  origin TEXT NOT NULL CHECK (origin = 'live'),
  captured_at TEXT NOT NULL,
  response_status INTEGER NOT NULL,
  response_url TEXT NOT NULL,
  request_json TEXT NOT NULL,
  sealed INTEGER NOT NULL DEFAULT 0 CHECK (sealed IN (0, 1))
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
