import type { BranchCommit, BranchCursor, HousingBranchDiff } from "../branch/life-git";
import type {
  BranchRunRevision,
  EvidenceReadItem,
  NarrativePort,
  RunDetailsCore,
} from "./contracts";
import type { HousingBranchForkResult, HousingBranchResult } from "./fork-housing";
import { createPresentRun, renderRunDetails } from "./present-run";

export interface JourneyPresentationPorts {
  readonly loadRunDetailsCore: (runId: string) => Promise<RunDetailsCore>;
  readonly loadInitialBranchByRunId: (
    runId: string,
    assessmentRevisionId: string,
  ) => Promise<BranchRunRevision>;
  readonly loadBranchCommit: (commitId: string) => Promise<BranchCommit>;
  readonly saveInitialHousingBranch: (runId: string) => Promise<HousingBranchResult>;
  readonly forkHousingBranch: (
    cursor: BranchCursor,
    housingAll: string,
  ) => Promise<HousingBranchForkResult>;
  readonly narrative: NarrativePort;
}

function withBranch(
  core: RunDetailsCore,
  commit: BranchCommit,
  branchDiff?: HousingBranchDiff,
): RunDetailsCore {
  const calculation: EvidenceReadItem = Object.freeze({
    class: "calculation",
    label: "Бюджет ветки жилья",
    displayValue: `${commit.calculation.knownResidualAll} ALL`,
    formulaId: commit.calculation.formulaId,
    formulaVersion: commit.calculation.formulaVersion,
    inputs: commit.calculation.inputs,
    rounding: commit.calculation.rounding,
    outputHash: commit.calculation.outputHash,
  });
  const budgetUnknowns: EvidenceReadItem[] = commit.calculation.unknowns.map((unknown) => Object.freeze({
    class: "unknown" as const,
    label: unknown.kind === "taxes" ? "Налоги" : "Стоимость жизни",
    provenance: "unmodelled" as const,
  }));
  return Object.freeze({
    ...core,
    evidenceItems: Object.freeze([
      ...core.evidenceItems.filter((item) => item.class !== "calculation"),
      calculation,
      ...budgetUnknowns,
    ]),
    budget: Object.freeze({
      incomeAll: commit.calculation.incomeAll,
      housingAll: commit.calculation.housingAll,
      knownResidualAll: commit.calculation.knownResidualAll,
      unknowns: Object.freeze(commit.calculation.unknowns.map((unknown) => unknown.kind)),
    }),
    ...(branchDiff === undefined ? {} : { branchDiff }),
    initialBranchCursor: Object.freeze({ commitId: commit.forkedFrom ?? commit.id }),
    branchCursor: Object.freeze({ commitId: commit.id }),
  });
}

function assertBranchBinding(
  revision: BranchRunRevision,
  commit: BranchCommit,
  expectedRunId: string,
): void {
  if (
    revision.runId !== expectedRunId || revision.branchCommitId !== commit.id ||
    revision.profileId !== commit.profileId ||
    revision.evidenceSnapshotId !== commit.evidenceSnapshotId ||
    revision.assessmentId !== commit.assessmentId ||
    revision.rulesVersion !== commit.rulesVersion ||
    revision.formulaHash !== commit.formulaHash ||
    revision.outputHash !== commit.outputHash
  ) throw new Error("integrity_mismatch");
}

function isMissingInitialBranch(error: unknown): boolean {
  return error instanceof Error && error.message === "branch_revision_not_found";
}

export function createJourneyPresentation(ports: JourneyPresentationPorts) {
  const loadPresentableCore = async (runId: string): Promise<RunDetailsCore> => {
    const core = await ports.loadRunDetailsCore(runId);
    try {
      const revision = await ports.loadInitialBranchByRunId(runId, core.run.runRevisionId);
      const commit = await ports.loadBranchCommit(revision.branchCommitId);
      assertBranchBinding(revision, commit, runId);
      return withBranch(core, commit);
    } catch (error) {
      if (isMissingInitialBranch(error)) return core;
      throw error;
    }
  };

  const presentRun = createPresentRun({
    loadRunDetailsCore: loadPresentableCore,
    narrative: ports.narrative,
  });

  const saveInitialHousingJourney = async (runId: string) => {
    const branch = await ports.saveInitialHousingBranch(runId);
    assertBranchBinding(branch.revision, branch.commit, runId);
    const core = await ports.loadRunDetailsCore(runId);
    return renderRunDetails(withBranch(core, branch.commit), ports.narrative);
  };

  const forkHousingJourney = async (cursor: BranchCursor, housingAll: string) => {
    const branch = await ports.forkHousingBranch(cursor, housingAll);
    assertBranchBinding(branch.revision, branch.commit, branch.revision.runId);
    const core = await ports.loadRunDetailsCore(branch.revision.runId);
    return renderRunDetails(withBranch(core, branch.commit, branch.diff), ports.narrative);
  };

  return Object.freeze({ presentRun, saveInitialHousingJourney, forkHousingJourney });
}
