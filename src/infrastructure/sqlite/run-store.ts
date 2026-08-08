import type Database from "better-sqlite3";

import type {
  AssessmentRunRevision,
  AssessmentRunRevisionPayload,
  BranchRunRevision,
  BranchRunRevisionPayload,
} from "../../application/contracts";
import type { Assessment } from "../../research/contracts";
import { canonicalJson, hmacSha256, secureHexEqual } from "../integrity";

interface RunRevisionRow {
  readonly id: string;
  readonly run_id: string;
  readonly stage: "assessment" | "branch";
  readonly assessment_date: string;
  readonly initial_housing_json: string | null;
  readonly profile_id: string;
  readonly evidence_snapshot_id: string;
  readonly assessment_id: string;
  readonly assessment_json: string | null;
  readonly rules_version: string;
  readonly parent_revision_id: string | null;
  readonly branch_commit_id: string | null;
  readonly formula_hash: string | null;
  readonly output_hash: string | null;
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

function branchPayload(revision: BranchRunRevision): BranchRunRevisionPayload {
  return {
    id: revision.id,
    runId: revision.runId,
    stage: revision.stage,
    assessmentDate: revision.assessmentDate,
    parentRevisionId: revision.parentRevisionId,
    profileId: revision.profileId,
    evidenceSnapshotId: revision.evidenceSnapshotId,
    assessmentId: revision.assessmentId,
    rulesVersion: revision.rulesVersion,
    branchCommitId: revision.branchCommitId,
    formulaHash: revision.formulaHash,
    outputHash: revision.outputHash,
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
        evidence_snapshot_id, assessment_id, assessment_json, rules_version,
        parent_revision_id, branch_commit_id, formula_hash, output_hash, revision_json, hmac
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, ?, ?)
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
             evidence_snapshot_id, assessment_id, assessment_json, rules_version,
             parent_revision_id, branch_commit_id, formula_hash, output_hash, revision_json, hmac
      FROM run_revisions WHERE run_id = ? AND stage = 'assessment'
    `).all(runId) as RunRevisionRow[];
    if (rows.length === 0) throw new Error("run_not_found");
    if (rows.length !== 1) integrityMismatch();
    const row = rows[0]!;

    let revision: AssessmentRunRevision;
    let assessment: Assessment;
    try {
      revision = JSON.parse(row.revision_json) as AssessmentRunRevision;
      if (row.assessment_json === null || row.initial_housing_json === null) integrityMismatch();
      assessment = JSON.parse(row.assessment_json) as Assessment;
    } catch {
      integrityMismatch();
    }
    const canonicalPayload = canonicalJson({ revision: payload(revision), assessment });
    if (
      row.parent_revision_id !== null || row.branch_commit_id !== null ||
      row.formula_hash !== null || row.output_hash !== null ||
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

  appendBranch(input: BranchRunRevisionPayload): BranchRunRevision {
    if (input.stage !== "branch" || input.parentRevisionId.length === 0 || input.branchCommitId.length === 0) {
      integrityMismatch();
    }
    const hmac = hmacSha256(canonicalJson(input), this.hmacKey);
    const revision: BranchRunRevision = Object.freeze({ ...input, hmac });
    this.database.prepare(`
      INSERT INTO run_revisions (
        id, run_id, stage, assessment_date, initial_housing_json, profile_id,
        evidence_snapshot_id, assessment_id, assessment_json, rules_version,
        parent_revision_id, branch_commit_id, formula_hash, output_hash, revision_json, hmac
      ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      revision.id,
      revision.runId,
      revision.stage,
      revision.assessmentDate,
      revision.profileId,
      revision.evidenceSnapshotId,
      revision.assessmentId,
      revision.rulesVersion,
      revision.parentRevisionId,
      revision.branchCommitId,
      revision.formulaHash,
      revision.outputHash,
      canonicalJson(revision),
      revision.hmac,
    );
    return revision;
  }

  async loadBranchByCommitId(commitId: string): Promise<BranchRunRevision> {
    const rows = this.database.prepare(`
      SELECT id, run_id, stage, assessment_date, initial_housing_json, profile_id,
             evidence_snapshot_id, assessment_id, assessment_json, rules_version,
             parent_revision_id, branch_commit_id, formula_hash, output_hash, revision_json, hmac
      FROM run_revisions WHERE branch_commit_id = ? AND stage = 'branch'
    `).all(commitId) as RunRevisionRow[];
    if (rows.length === 0) throw new Error("branch_revision_not_found");
    if (rows.length !== 1) integrityMismatch();
    const row = rows[0]!;
    let revision: BranchRunRevision;
    try {
      revision = JSON.parse(row.revision_json) as BranchRunRevision;
    } catch {
      integrityMismatch();
    }
    if (
      row.stage !== "branch" || row.initial_housing_json !== null || row.assessment_json !== null ||
      row.parent_revision_id === null || row.branch_commit_id === null ||
      row.formula_hash === null || row.output_hash === null ||
      revision.id !== row.id || revision.runId !== row.run_id || revision.stage !== row.stage ||
      revision.assessmentDate !== row.assessment_date || revision.profileId !== row.profile_id ||
      revision.evidenceSnapshotId !== row.evidence_snapshot_id || revision.assessmentId !== row.assessment_id ||
      revision.rulesVersion !== row.rules_version || revision.parentRevisionId !== row.parent_revision_id ||
      revision.branchCommitId !== row.branch_commit_id || revision.formulaHash !== row.formula_hash ||
      revision.outputHash !== row.output_hash || row.revision_json !== canonicalJson(revision) ||
      !secureHexEqual(revision.hmac, row.hmac) ||
      !secureHexEqual(row.hmac, hmacSha256(canonicalJson(branchPayload(revision)), this.hmacKey))
    ) integrityMismatch();
    return revision;
  }

  async loadInitialBranchByRunId(runId: string, assessmentRevisionId: string): Promise<BranchRunRevision> {
    const rows = this.database.prepare(`
      SELECT branch_commit_id
      FROM run_revisions
      WHERE run_id = ? AND stage = 'branch' AND parent_revision_id = ?
    `).all(runId, assessmentRevisionId) as { branch_commit_id: string | null }[];
    if (rows.length === 0) throw new Error("branch_revision_not_found");
    if (rows.length !== 1 || rows[0]!.branch_commit_id === null) integrityMismatch();
    return this.loadBranchByCommitId(rows[0]!.branch_commit_id);
  }
}
