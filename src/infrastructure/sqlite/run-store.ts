import type Database from "better-sqlite3";

import type {
  AssessmentRunRevision,
  AssessmentRunRevisionPayload,
} from "../../application/contracts";
import type { Assessment } from "../../research/contracts";
import { canonicalJson, hmacSha256, secureHexEqual } from "../integrity";

interface RunRevisionRow {
  readonly id: string;
  readonly run_id: string;
  readonly stage: "assessment";
  readonly assessment_date: string;
  readonly initial_housing_json: string;
  readonly profile_id: string;
  readonly evidence_snapshot_id: string;
  readonly assessment_id: string;
  readonly assessment_json: string;
  readonly rules_version: string;
  readonly revision_json: string;
  readonly hmac: string;
}

function integrityMismatch(): never {
  throw new Error("integrity_mismatch");
}

function payload(revision: AssessmentRunRevision): AssessmentRunRevisionPayload {
  return {
    id: revision.id,
    runId: revision.runId,
    stage: revision.stage,
    assessmentDate: revision.assessmentDate,
    initialHousing: revision.initialHousing,
    profileId: revision.profileId,
    evidenceSnapshotId: revision.evidenceSnapshotId,
    assessmentId: revision.assessmentId,
    rulesVersion: revision.rulesVersion,
  };
}

export class SqliteRunStore {
  constructor(
    private readonly database: Database.Database,
    private readonly hmacKey: string,
  ) {
    if (hmacKey.length === 0) throw new Error("integrity_key_missing");
  }

  async appendAssessment(input: AssessmentRunRevisionPayload & {
    readonly assessment: Assessment;
  }): Promise<{ readonly revision: AssessmentRunRevision; readonly assessment: Assessment }> {
    if (input.stage !== "assessment") integrityMismatch();
    const { assessment, ...revisionPayload } = input;
    const hmac = hmacSha256(canonicalJson({ revision: revisionPayload, assessment }), this.hmacKey);
    const revision: AssessmentRunRevision = Object.freeze({ ...revisionPayload, hmac });
    this.database.prepare(`
      INSERT INTO run_revisions (
        id, run_id, stage, assessment_date, initial_housing_json, profile_id,
        evidence_snapshot_id, assessment_id, assessment_json, rules_version, revision_json, hmac
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      revision.id,
      revision.runId,
      revision.stage,
      revision.assessmentDate,
      canonicalJson(revision.initialHousing),
      revision.profileId,
      revision.evidenceSnapshotId,
      revision.assessmentId,
      canonicalJson(assessment),
      revision.rulesVersion,
      canonicalJson(revision),
      revision.hmac,
    );
    return { revision, assessment };
  }

  async loadAssessmentByRunId(runId: string): Promise<{
    readonly revision: AssessmentRunRevision;
    readonly assessment: Assessment;
  }> {
    const rows = this.database.prepare(`
      SELECT id, run_id, stage, assessment_date, initial_housing_json, profile_id,
             evidence_snapshot_id, assessment_id, assessment_json, rules_version, revision_json, hmac
      FROM run_revisions WHERE run_id = ? AND stage = 'assessment'
    `).all(runId) as RunRevisionRow[];
    if (rows.length === 0) throw new Error("run_not_found");
    if (rows.length !== 1) integrityMismatch();
    const row = rows[0]!;

    let revision: AssessmentRunRevision;
    let assessment: Assessment;
    try {
      revision = JSON.parse(row.revision_json) as AssessmentRunRevision;
      assessment = JSON.parse(row.assessment_json) as Assessment;
    } catch {
      integrityMismatch();
    }
    const canonicalPayload = canonicalJson({ revision: payload(revision), assessment });
    if (
      revision.id !== row.id ||
      revision.runId !== row.run_id ||
      revision.stage !== row.stage ||
      revision.assessmentDate !== row.assessment_date ||
      canonicalJson(revision.initialHousing) !== row.initial_housing_json ||
      revision.profileId !== row.profile_id ||
      revision.evidenceSnapshotId !== row.evidence_snapshot_id ||
      revision.assessmentId !== row.assessment_id ||
      canonicalJson(assessment) !== row.assessment_json ||
      revision.rulesVersion !== row.rules_version ||
      row.revision_json !== canonicalJson(revision) ||
      !secureHexEqual(revision.hmac, row.hmac) ||
      !secureHexEqual(row.hmac, hmacSha256(canonicalPayload, this.hmacKey))
    ) {
      integrityMismatch();
    }
    return { revision, assessment };
  }
}
