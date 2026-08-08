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
  stage TEXT NOT NULL CHECK (stage IN ('assessment', 'branch')),
  assessment_date TEXT NOT NULL,
  initial_housing_json TEXT,
  profile_id TEXT NOT NULL REFERENCES profile_snapshots(id),
  evidence_snapshot_id TEXT NOT NULL REFERENCES evidence_snapshots(id),
  assessment_id TEXT NOT NULL,
  assessment_json TEXT,
  rules_version TEXT NOT NULL,
  parent_revision_id TEXT REFERENCES run_revisions(id),
  branch_commit_id TEXT,
  formula_hash TEXT,
  output_hash TEXT,
  revision_json TEXT NOT NULL,
  hmac TEXT NOT NULL
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
