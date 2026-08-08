import type { CbrBudgetRate, BoaBudgetRate, BudgetInput } from "../branch/budget";
import {
  createCommit,
  diffCommits,
  forkHousingCommit,
  rewindTo,
  type BranchCommit,
  type BranchCursor,
  type HousingBranchDiff,
} from "../branch/life-git";
import { confirmHousingDecision, type HousingDecision } from "../branch/housing";
import type {
  BranchRunRevision,
  BranchRunRevisionPayload,
  ProfileStorePort,
  RunStorePort,
} from "./contracts";

export interface VerifiedBudgetFacts {
  readonly cbrRate: CbrBudgetRate;
  readonly boaRate: BoaBudgetRate;
}

export interface VerifiedBudgetFactsPort {
  loadVerifiedBudgetFacts(
    evidenceSnapshotId: string,
    expected: { readonly assessmentDate: string },
  ): Promise<VerifiedBudgetFacts>;
}

export interface BranchStorePort {
  loadVerified(id: string): Promise<BranchCommit>;
}

export interface HousingBranchAppendPort {
  append(
    commit: BranchCommit,
    revision: BranchRunRevisionPayload,
  ): BranchRunRevision | Promise<BranchRunRevision>;
}

export interface HousingBranchPorts {
  readonly profileStore: ProfileStorePort;
  readonly runStore: RunStorePort;
  readonly branchStore: BranchStorePort;
  readonly housingBranchAppend: HousingBranchAppendPort;
  readonly budgetFacts: VerifiedBudgetFactsPort;
  readonly nextRevisionId: () => string;
}

export interface HousingBranchResult {
  readonly commit: BranchCommit;
  readonly revision: BranchRunRevision;
}

export interface HousingBranchForkResult extends HousingBranchResult {
  readonly diff: HousingBranchDiff;
}

function validRunId(runId: string): void {
  if (typeof runId !== "string" || runId.length === 0) throw new Error("invalid_run_id");
}

function validCursor(value: BranchCursor): BranchCursor {
  if (
    value === null || typeof value !== "object" ||
    Object.keys(value).length !== 1 || typeof value.commitId !== "string" || value.commitId.length === 0
  ) throw new Error("invalid_branch_cursor");
  return value;
}

function validateBudgetFacts(facts: VerifiedBudgetFacts): void {
  if (
    facts.cbrRate.sourceId !== "cbr-eur" || facts.cbrRate.claimId !== "cbr-eur-facts-1" ||
    facts.boaRate.sourceId !== "boa-eur" || facts.boaRate.claimId !== "boa-eur-facts-1"
  ) throw new Error("integrity_mismatch");
}

export function createHousingBranchApplication(ports: HousingBranchPorts) {
  const appendBranchRevision = async (
    commit: BranchCommit,
    parentRevisionId: string,
    runId: string,
    assessmentDate: string,
  ): Promise<BranchRunRevision> => Promise.resolve(ports.housingBranchAppend.append(commit, {
    id: ports.nextRevisionId(),
    runId,
    stage: "branch",
    assessmentDate,
    parentRevisionId,
    profileId: commit.profileId,
    evidenceSnapshotId: commit.evidenceSnapshotId,
    assessmentId: commit.assessmentId,
    rulesVersion: commit.rulesVersion,
    branchCommitId: commit.id,
    formulaHash: commit.formulaHash,
    outputHash: commit.outputHash,
  }));

  const saveInitialHousingBranch = async (runId: string): Promise<HousingBranchResult> => {
    validRunId(runId);
    const record = await ports.runStore.loadAssessmentByRunId(runId);
    const assessmentRevision = record.revision;
    if (assessmentRevision.runId !== runId || assessmentRevision.stage !== "assessment") {
      throw new Error("integrity_mismatch");
    }
    if (record.assessment.marker !== "green") throw new Error("branch_requires_green_assessment");
    const profile = await ports.profileStore.loadVerified(assessmentRevision.profileId);
    if (profile.id !== assessmentRevision.profileId) throw new Error("integrity_mismatch");
    const facts = await ports.budgetFacts.loadVerifiedBudgetFacts(
      assessmentRevision.evidenceSnapshotId,
      { assessmentDate: assessmentRevision.assessmentDate },
    );
    validateBudgetFacts(facts);
    const decision = confirmHousingDecision(assessmentRevision.initialHousing);
    const calculationInput: BudgetInput = {
      income: {
        amount: profile.profile.monthlyIncome.amount,
        currency: profile.profile.monthlyIncome.currency,
        profileId: profile.id,
      },
      cbrRate: facts.cbrRate,
      boaRate: facts.boaRate,
      housing: decision,
    };
    const commit = createCommit({
      profileId: profile.id,
      evidenceSnapshotId: assessmentRevision.evidenceSnapshotId,
      assessmentId: assessmentRevision.assessmentId,
      rulesVersion: assessmentRevision.rulesVersion,
      decision,
      calculationInput,
    });
    const revision = await appendBranchRevision(
      commit,
      assessmentRevision.id,
      runId,
      assessmentRevision.assessmentDate,
    );
    return Object.freeze({ commit, revision });
  };

  const forkHousing = async (
    cursorInput: BranchCursor,
    decisionInput: HousingDecision,
  ): Promise<HousingBranchResult> => {
    const cursor = validCursor(cursorInput);
    const parent = await ports.branchStore.loadVerified(cursor.commitId);
    if (parent.parentId !== undefined || parent.forkedFrom !== undefined) {
      throw new Error("fork_requires_c0");
    }
    const parentRevision = await ports.runStore.loadBranchByCommitId(parent.id);
    if (
      parentRevision.branchCommitId !== parent.id || parentRevision.profileId !== parent.profileId ||
      parentRevision.evidenceSnapshotId !== parent.evidenceSnapshotId ||
      parentRevision.assessmentId !== parent.assessmentId || parentRevision.rulesVersion !== parent.rulesVersion ||
      parentRevision.formulaHash !== parent.formulaHash || parentRevision.outputHash !== parent.outputHash
    ) throw new Error("integrity_mismatch");
    const decision = confirmHousingDecision(decisionInput);
    const commit = forkHousingCommit(parent, decision);
    const revision = await appendBranchRevision(
      commit,
      parentRevision.id,
      parentRevision.runId,
      parentRevision.assessmentDate,
    );
    return Object.freeze({ commit, revision });
  };

  const rewindHousingBranch = async (commitId: string): Promise<BranchCursor> => {
    if (typeof commitId !== "string" || commitId.length === 0) throw new Error("invalid_commit_id");
    return rewindTo(await ports.branchStore.loadVerified(commitId));
  };

  const forkHousingBranch = async (
    cursorInput: BranchCursor,
    housingAll: string,
  ): Promise<HousingBranchForkResult> => {
    const cursor = validCursor(cursorInput);
    const parent = await ports.branchStore.loadVerified(cursor.commitId);
    const decision = confirmHousingDecision({ currency: "ALL", initialHousingAll: housingAll });
    const result = await forkHousing(cursor, decision);
    return Object.freeze({ ...result, diff: diffCommits(parent, result.commit) });
  };

  return Object.freeze({
    saveInitialHousingBranch,
    forkHousing,
    rewindHousingBranch,
    forkHousingBranch,
  });
}
