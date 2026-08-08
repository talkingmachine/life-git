import type Database from "better-sqlite3";

import { replayCommit, type BranchCommit } from "../../branch/life-git";
import { canonicalJson, hmacSha256, secureHexEqual, sha256Text } from "../integrity";

interface BranchCommitRow {
  readonly id: string;
  readonly parent_id: string | null;
  readonly forked_from: string | null;
  readonly profile_id: string;
  readonly evidence_snapshot_id: string;
  readonly assessment_id: string;
  readonly rules_version: string;
  readonly formula_hash: string;
  readonly input_hash: string;
  readonly output_hash: string;
  readonly commit_json: string;
  readonly commit_hash: string;
  readonly hmac: string;
}

function integrityMismatch(): never {
  throw new Error("integrity_mismatch");
}

export class SqliteBranchStore {
  constructor(
    private readonly database: Database.Database,
    private readonly hmacKey: string,
  ) {
    if (hmacKey.length === 0) throw new Error("integrity_key_missing");
  }

  async append(commit: BranchCommit): Promise<void> {
    replayCommit(commit);
    const commitJson = canonicalJson(commit);
    const commitHash = sha256Text(commitJson);
    const hmac = hmacSha256(canonicalJson({ commit, commitHash }), this.hmacKey);
    this.database.prepare(`
      INSERT INTO branch_commits (
        id, parent_id, forked_from, profile_id, evidence_snapshot_id, assessment_id,
        rules_version, formula_hash, input_hash, output_hash, commit_json, commit_hash, hmac
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      commit.id,
      commit.parentId ?? null,
      commit.forkedFrom ?? null,
      commit.profileId,
      commit.evidenceSnapshotId,
      commit.assessmentId,
      commit.rulesVersion,
      commit.formulaHash,
      commit.inputHash,
      commit.outputHash,
      commitJson,
      commitHash,
      hmac,
    );
  }

  async loadVerified(id: string): Promise<BranchCommit> {
    const row = this.database.prepare(`
      SELECT id, parent_id, forked_from, profile_id, evidence_snapshot_id, assessment_id,
             rules_version, formula_hash, input_hash, output_hash, commit_json, commit_hash, hmac
      FROM branch_commits WHERE id = ?
    `).get(id) as BranchCommitRow | undefined;
    if (row === undefined) throw new Error("branch_commit_not_found");
    let commit: BranchCommit;
    try {
      commit = JSON.parse(row.commit_json) as BranchCommit;
    } catch {
      integrityMismatch();
    }
    const commitHash = sha256Text(row.commit_json);
    if (
      row.commit_json !== canonicalJson(commit) || commit.id !== row.id ||
      (commit.parentId ?? null) !== row.parent_id || (commit.forkedFrom ?? null) !== row.forked_from ||
      commit.profileId !== row.profile_id || commit.evidenceSnapshotId !== row.evidence_snapshot_id ||
      commit.assessmentId !== row.assessment_id || commit.rulesVersion !== row.rules_version ||
      commit.formulaHash !== row.formula_hash || commit.inputHash !== row.input_hash ||
      commit.outputHash !== row.output_hash || !secureHexEqual(row.commit_hash, commitHash) ||
      !secureHexEqual(row.hmac, hmacSha256(canonicalJson({ commit, commitHash }), this.hmacKey))
    ) integrityMismatch();
    return replayCommit(commit);
  }
}
