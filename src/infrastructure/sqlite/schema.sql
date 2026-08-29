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

CREATE TABLE IF NOT EXISTS city_source_versions (
  id TEXT PRIMARY KEY,
  country_code TEXT NOT NULL CHECK (country_code = 'SI'),
  city_id TEXT NOT NULL,
  fact_key TEXT NOT NULL CHECK (fact_key = 'si-city-safety'),
  definition_id TEXT NOT NULL CHECK (definition_id = 'si-municipal-police-offences-per-100000@1'),
  evidence_snapshot_id TEXT NOT NULL,
  schema_version TEXT NOT NULL CHECK (schema_version = 'source-version@1'),
  payload_json TEXT NOT NULL, payload_hash TEXT NOT NULL CHECK (length(payload_hash) = 64),
  hmac TEXT NOT NULL CHECK (length(hmac) = 64), created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS city_source_binding_revisions (
  id TEXT PRIMARY KEY, country_code TEXT NOT NULL CHECK (country_code = 'SI'), city_id TEXT NOT NULL,
  fact_key TEXT NOT NULL CHECK (fact_key = 'si-city-safety'), definition_id TEXT NOT NULL CHECK (definition_id = 'si-municipal-police-offences-per-100000@1'),
  revision_ordinal INTEGER NOT NULL CHECK (revision_ordinal > 0), predecessor_revision_id TEXT REFERENCES city_source_binding_revisions(id),
  source_version_id TEXT NOT NULL REFERENCES city_source_versions(id), evidence_snapshot_id TEXT NOT NULL,
  schema_version TEXT NOT NULL CHECK (schema_version = 'source-binding@1'), payload_json TEXT NOT NULL,
  payload_hash TEXT NOT NULL CHECK (length(payload_hash) = 64), hmac TEXT NOT NULL CHECK (length(hmac) = 64), created_at TEXT NOT NULL,
  UNIQUE(country_code, city_id, fact_key, definition_id, revision_ordinal), CHECK(predecessor_revision_id IS NULL OR predecessor_revision_id <> id)
);
CREATE UNIQUE INDEX IF NOT EXISTS city_source_binding_one_root ON city_source_binding_revisions(country_code, city_id, fact_key, definition_id) WHERE predecessor_revision_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS city_source_binding_one_successor ON city_source_binding_revisions(predecessor_revision_id) WHERE predecessor_revision_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS city_source_binding_heads (
  country_code TEXT NOT NULL CHECK (country_code = 'SI'), city_id TEXT NOT NULL,
  fact_key TEXT NOT NULL CHECK (fact_key = 'si-city-safety'), definition_id TEXT NOT NULL CHECK (definition_id = 'si-municipal-police-offences-per-100000@1'),
  installed_binding_digest TEXT NOT NULL CHECK (length(installed_binding_digest) = 64), active_revision_id TEXT UNIQUE REFERENCES city_source_binding_revisions(id),
  PRIMARY KEY(country_code, city_id, fact_key, definition_id)
);
CREATE TABLE IF NOT EXISTS official_source_recovery_attempts (
  id TEXT PRIMARY KEY, command_id TEXT NOT NULL UNIQUE, country_code TEXT NOT NULL CHECK (country_code = 'SI'), city_id TEXT NOT NULL,
  fact_key TEXT NOT NULL CHECK (fact_key = 'si-city-safety'), definition_id TEXT NOT NULL CHECK (definition_id = 'si-municipal-police-offences-per-100000@1'),
  schema_version TEXT NOT NULL CHECK (schema_version = 'official-source-recovery-attempt@1'), payload_json TEXT NOT NULL,
  payload_hash TEXT NOT NULL CHECK (length(payload_hash) = 64), hmac TEXT NOT NULL CHECK (length(hmac) = 64), created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS official_source_replacement_events (
  id TEXT PRIMARY KEY, command_id TEXT NOT NULL UNIQUE, revision_id TEXT NOT NULL UNIQUE REFERENCES city_source_binding_revisions(id),
  schema_version TEXT NOT NULL CHECK (schema_version = 'official-source-replaced@1'), payload_json TEXT NOT NULL,
  payload_hash TEXT NOT NULL CHECK (length(payload_hash) = 64), hmac TEXT NOT NULL CHECK (length(hmac) = 64), created_at TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS city_source_versions_no_update BEFORE UPDATE ON city_source_versions BEGIN SELECT RAISE(ABORT, 'city_source_version_is_immutable'); END;
CREATE TRIGGER IF NOT EXISTS city_source_versions_no_delete BEFORE DELETE ON city_source_versions BEGIN SELECT RAISE(ABORT, 'city_source_version_is_immutable'); END;
CREATE TRIGGER IF NOT EXISTS city_source_binding_revisions_no_update BEFORE UPDATE ON city_source_binding_revisions BEGIN SELECT RAISE(ABORT, 'city_source_binding_revision_is_immutable'); END;
CREATE TRIGGER IF NOT EXISTS city_source_binding_revisions_no_delete BEFORE DELETE ON city_source_binding_revisions BEGIN SELECT RAISE(ABORT, 'city_source_binding_revision_is_immutable'); END;
CREATE TRIGGER IF NOT EXISTS official_source_recovery_attempts_no_update BEFORE UPDATE ON official_source_recovery_attempts BEGIN SELECT RAISE(ABORT, 'official_source_recovery_attempt_is_immutable'); END;
CREATE TRIGGER IF NOT EXISTS official_source_recovery_attempts_no_delete BEFORE DELETE ON official_source_recovery_attempts BEGIN SELECT RAISE(ABORT, 'official_source_recovery_attempt_is_immutable'); END;
CREATE TRIGGER IF NOT EXISTS official_source_replacement_events_no_update BEFORE UPDATE ON official_source_replacement_events BEGIN SELECT RAISE(ABORT, 'official_source_replacement_event_is_immutable'); END;
CREATE TRIGGER IF NOT EXISTS official_source_replacement_events_no_delete BEFORE DELETE ON official_source_replacement_events BEGIN SELECT RAISE(ABORT, 'official_source_replacement_event_is_immutable'); END;

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

CREATE UNIQUE INDEX IF NOT EXISTS city_knowledge_one_root
ON city_knowledge_revisions (city_id)
WHERE predecessor_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS city_knowledge_one_successor
ON city_knowledge_revisions (predecessor_id)
WHERE predecessor_id IS NOT NULL;

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

CREATE UNIQUE INDEX IF NOT EXISTS installed_city_package_manifest_country_id
ON installed_city_package_manifests (country_code, id);

CREATE UNIQUE INDEX IF NOT EXISTS installed_city_package_manifest_exact_key
ON installed_city_package_manifests (
  country_code, package_id, package_schema_version, catalog_revision_id, evidence_rules_version
);

CREATE UNIQUE INDEX IF NOT EXISTS installed_city_package_manifest_one_root
ON installed_city_package_manifests (country_code)
WHERE predecessor_manifest_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS installed_city_package_manifest_one_successor
ON installed_city_package_manifests (predecessor_manifest_id)
WHERE predecessor_manifest_id IS NOT NULL;

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

CREATE UNIQUE INDEX IF NOT EXISTS dossier_versions_v2_one_successor
ON dossier_versions_v2 (predecessor_id)
WHERE predecessor_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS dossier_versions_v2_one_root
ON dossier_versions_v2 (country_code)
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

CREATE TRIGGER IF NOT EXISTS city_catalog_revisions_no_update
BEFORE UPDATE ON city_catalog_revisions
BEGIN
  SELECT RAISE(ABORT, 'city_catalog_revision_is_immutable');
END;

CREATE TRIGGER IF NOT EXISTS city_catalog_revisions_no_delete
BEFORE DELETE ON city_catalog_revisions
BEGIN
  SELECT RAISE(ABORT, 'city_catalog_revision_is_immutable');
END;

CREATE TRIGGER IF NOT EXISTS city_knowledge_revisions_no_update
BEFORE UPDATE ON city_knowledge_revisions
BEGIN
  SELECT RAISE(ABORT, 'city_knowledge_revision_is_immutable');
END;

CREATE TRIGGER IF NOT EXISTS city_knowledge_revisions_no_delete
BEFORE DELETE ON city_knowledge_revisions
BEGIN
  SELECT RAISE(ABORT, 'city_knowledge_revision_is_immutable');
END;

CREATE TRIGGER IF NOT EXISTS installed_city_package_manifests_no_update
BEFORE UPDATE ON installed_city_package_manifests
BEGIN
  SELECT RAISE(ABORT, 'installed_city_package_manifest_is_immutable');
END;

CREATE TRIGGER IF NOT EXISTS installed_city_package_manifests_no_delete
BEFORE DELETE ON installed_city_package_manifests
BEGIN
  SELECT RAISE(ABORT, 'installed_city_package_manifest_is_immutable');
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

CREATE TRIGGER IF NOT EXISTS dossier_versions_v2_no_update
BEFORE UPDATE ON dossier_versions_v2
BEGIN
  SELECT RAISE(ABORT, 'dossier_version_v2_is_immutable');
END;

CREATE TRIGGER IF NOT EXISTS dossier_versions_v2_no_delete
BEFORE DELETE ON dossier_versions_v2
BEGIN
  SELECT RAISE(ABORT, 'dossier_version_v2_is_immutable');
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

CREATE TABLE IF NOT EXISTS city_criteria_snapshots (
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
);

CREATE TABLE IF NOT EXISTS city_branch_commits (
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
);

CREATE TABLE IF NOT EXISTS city_ranking_snapshots (
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
);

CREATE TABLE IF NOT EXISTS city_frontier_revisions (
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
);

CREATE TABLE IF NOT EXISTS city_selection_snapshots (
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
);

CREATE UNIQUE INDEX IF NOT EXISTS city_branch_commits_one_selection
ON city_branch_commits (selection_snapshot_id)
WHERE kind = 'selection';

CREATE UNIQUE INDEX IF NOT EXISTS city_branch_commits_pre_city_source
ON city_branch_commits (resolved_country_shortlist_revision_id, country_code)
WHERE kind = 'pre_city';

CREATE UNIQUE INDEX IF NOT EXISTS city_ranking_snapshots_one_run
ON city_ranking_snapshots (run_id);

CREATE UNIQUE INDEX IF NOT EXISTS city_frontier_revisions_one_command
ON city_frontier_revisions (run_id, command_id);

CREATE UNIQUE INDEX IF NOT EXISTS city_frontier_revisions_one_root
ON city_frontier_revisions (run_id)
WHERE predecessor_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS city_frontier_revisions_one_start_command
ON city_frontier_revisions (command_id)
WHERE operation_kind = 'start';

CREATE UNIQUE INDEX IF NOT EXISTS city_frontier_revisions_one_successor
ON city_frontier_revisions (predecessor_id)
WHERE predecessor_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS city_frontier_revisions_one_terminal
ON city_frontier_revisions (run_id)
WHERE kind = 'terminal';

CREATE UNIQUE INDEX IF NOT EXISTS city_selection_snapshots_one_command
ON city_selection_snapshots (run_id, command_id);

CREATE TRIGGER IF NOT EXISTS city_criteria_snapshots_no_update
BEFORE UPDATE ON city_criteria_snapshots
BEGIN
  SELECT RAISE(ABORT, 'city_criteria_snapshot_is_immutable');
END;

CREATE TRIGGER IF NOT EXISTS city_criteria_snapshots_no_delete
BEFORE DELETE ON city_criteria_snapshots
BEGIN
  SELECT RAISE(ABORT, 'city_criteria_snapshot_is_immutable');
END;

CREATE TRIGGER IF NOT EXISTS city_branch_commits_no_update
BEFORE UPDATE ON city_branch_commits
BEGIN
  SELECT RAISE(ABORT, 'city_branch_commit_is_immutable');
END;

CREATE TRIGGER IF NOT EXISTS city_branch_commits_no_delete
BEFORE DELETE ON city_branch_commits
BEGIN
  SELECT RAISE(ABORT, 'city_branch_commit_is_immutable');
END;

CREATE TRIGGER IF NOT EXISTS city_ranking_snapshots_no_update
BEFORE UPDATE ON city_ranking_snapshots
BEGIN
  SELECT RAISE(ABORT, 'city_ranking_snapshot_is_immutable');
END;

CREATE TRIGGER IF NOT EXISTS city_ranking_snapshots_no_delete
BEFORE DELETE ON city_ranking_snapshots
BEGIN
  SELECT RAISE(ABORT, 'city_ranking_snapshot_is_immutable');
END;

CREATE TRIGGER IF NOT EXISTS city_frontier_revisions_no_update
BEFORE UPDATE ON city_frontier_revisions
BEGIN
  SELECT RAISE(ABORT, 'city_frontier_revision_is_immutable');
END;

CREATE TRIGGER IF NOT EXISTS city_frontier_revisions_no_delete
BEFORE DELETE ON city_frontier_revisions
BEGIN
  SELECT RAISE(ABORT, 'city_frontier_revision_is_immutable');
END;

CREATE TRIGGER IF NOT EXISTS city_selection_snapshots_no_update
BEFORE UPDATE ON city_selection_snapshots
BEGIN
  SELECT RAISE(ABORT, 'city_selection_snapshot_is_immutable');
END;

CREATE TRIGGER IF NOT EXISTS city_selection_snapshots_no_delete
BEFORE DELETE ON city_selection_snapshots
BEGIN
  SELECT RAISE(ABORT, 'city_selection_snapshot_is_immutable');
END;

CREATE TRIGGER IF NOT EXISTS city_frontier_revisions_no_successor_after_terminal
BEFORE INSERT ON city_frontier_revisions
WHEN NEW.predecessor_id IS NOT NULL AND EXISTS (
  SELECT 1 FROM city_frontier_revisions
  WHERE id = NEW.predecessor_id AND kind = 'terminal'
)
BEGIN
  SELECT RAISE(ABORT, 'city_frontier_terminal_has_no_successor');
END;
