import { calculateBudget, type BudgetInput } from "../branch/budget";
import { replayCommit, type BranchCommit } from "../branch/life-git";
import { confirmHousingDecision } from "../branch/housing";
import { assessRoute } from "../decision/assessment";
import { canonicalJson } from "../infrastructure/integrity";
import type { Assessment, Evidence, EvidenceSnapshot } from "../research/contracts";
import type { BranchStorePort, VerifiedBudgetFacts } from "./fork-housing";
import type { ProfileStorePort, RunStorePort } from "./contracts";

export interface ReplayRunPorts {
  readonly profileStore: ProfileStorePort;
  readonly runStore: RunStorePort;
  readonly branchStore: Pick<BranchStorePort, "loadVerified">;
  readonly replayEvidence: (snapshotId: string) => Promise<EvidenceSnapshot>;
  readonly projectDecisionEvidence: (snapshot: EvidenceSnapshot) => Evidence;
  readonly projectBudgetFacts: (
    snapshot: EvidenceSnapshot,
  ) => VerifiedBudgetFacts | Promise<VerifiedBudgetFacts>;
}

export interface HistoricalRunResult {
  readonly runId: string;
  readonly runRevisionId: string;
  readonly assessmentDate: string;
  readonly profileId: string;
  readonly evidenceSnapshotId: string;
  readonly assessmentId: string;
  readonly assessment: Assessment;
  readonly branchCommitId: string;
  readonly budget: BranchCommit["calculation"];
  readonly mode: "historical";
}

function integrityMismatch(): never {
  throw new Error("integrity_mismatch");
}

export function createReplayApplication(ports: ReplayRunPorts) {
  const replayRun = async (runId: string): Promise<HistoricalRunResult> => {
    if (typeof runId !== "string" || runId.length === 0) throw new Error("invalid_run_id");
    const assessmentRecord = await ports.runStore.loadAssessmentByRunId(runId);
    const assessmentRevision = assessmentRecord.revision;
    if (assessmentRevision.runId !== runId || assessmentRevision.stage !== "assessment") integrityMismatch();
    const profile = await ports.profileStore.loadVerified(assessmentRevision.profileId);
    const evidence = await ports.replayEvidence(assessmentRevision.evidenceSnapshotId);
    if (
      profile.id !== assessmentRevision.profileId || evidence.id !== assessmentRevision.evidenceSnapshotId ||
      evidence.assessmentDate !== assessmentRevision.assessmentDate
    ) integrityMismatch();
    const assessment = assessRoute(
      profile,
      ports.projectDecisionEvidence(evidence),
      { housingProvided: true },
    );
    if (canonicalJson(assessment) !== canonicalJson(assessmentRecord.assessment)) integrityMismatch();

    const branchRevision = await ports.runStore.loadInitialBranchByRunId(runId, assessmentRevision.id);
    const commit = await ports.branchStore.loadVerified(branchRevision.branchCommitId);
    if (
      branchRevision.runId !== runId || branchRevision.parentRevisionId !== assessmentRevision.id ||
      commit.profileId !== assessmentRevision.profileId ||
      commit.evidenceSnapshotId !== assessmentRevision.evidenceSnapshotId ||
      commit.assessmentId !== assessmentRevision.assessmentId || commit.rulesVersion !== assessmentRevision.rulesVersion ||
      branchRevision.profileId !== commit.profileId || branchRevision.evidenceSnapshotId !== commit.evidenceSnapshotId ||
      branchRevision.assessmentId !== commit.assessmentId || branchRevision.rulesVersion !== commit.rulesVersion ||
      branchRevision.formulaHash !== commit.formulaHash || branchRevision.outputHash !== commit.outputHash
    ) integrityMismatch();

    const facts = await ports.projectBudgetFacts(evidence);
    const decision = confirmHousingDecision(assessmentRevision.initialHousing);
    const exactInput: BudgetInput = {
      income: {
        amount: profile.profile.monthlyIncome.amount,
        currency: profile.profile.monthlyIncome.currency,
        profileId: profile.id,
      },
      cbrRate: facts.cbrRate,
      boaRate: facts.boaRate,
      housing: decision,
    };
    const exactCalculation = calculateBudget(exactInput);
    if (
      canonicalJson(commit.calculationInput) !== canonicalJson(exactInput) ||
      canonicalJson(commit.calculation) !== canonicalJson(exactCalculation) ||
      commit.formulaHash !== exactCalculation.formulaHash || commit.inputHash !== exactCalculation.inputHash ||
      commit.outputHash !== exactCalculation.outputHash
    ) integrityMismatch();
    replayCommit(commit);

    return Object.freeze({
      runId,
      runRevisionId: branchRevision.id,
      assessmentDate: assessmentRevision.assessmentDate,
      profileId: profile.id,
      evidenceSnapshotId: evidence.id,
      assessmentId: assessmentRevision.assessmentId,
      assessment,
      branchCommitId: commit.id,
      budget: commit.calculation,
      mode: "historical" as const,
    });
  };

  return Object.freeze({ replayRun });
}
