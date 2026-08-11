import { describe, expect, it, vi } from "vitest";

import type { BranchRunRevision, RunDetailsCore } from "../../src/application/contracts";
import { createJourneyPresentation } from "../../src/application/present-journey";
import { createCommit, diffCommits, forkHousingCommit } from "../../src/branch/life-git";

const core: RunDetailsCore = {
  run: {
    runId: "run-1",
    runRevisionId: "assessment-revision-1",
    assessmentDate: "2026-08-08",
    profileId: "profile-1",
    evidenceSnapshotId: "evidence-1",
    assessmentId: "assessment-1",
    assessment: { marker: "green", reasons: [] },
    mode: "current",
  },
  profile: {
    id: "profile-1",
    confirmedAt: "2026-08-08T10:00:00.000Z",
    profile: {
      availableResourcesAll: "500000",
      monthlyIncome: { amount: "210000", currency: "RUB" },
      incomeBasis: "foreign_contract",
      companionBasis: "none",
      relationship: "none",
      conditions: {
        incomeContinues12Months: true,
        lawfulStayPrerequisiteAccepted: true,
        stagedSpouseRouteAccepted: false,
      },
    },
  },
  evidenceItems: [{
    class: "unknown",
    label: "Источник",
    provenance: "unmodelled",
  }],
};

const c0 = createCommit({
  profileId: "profile-1",
  evidenceSnapshotId: "evidence-1",
  assessmentId: "assessment-1",
  rulesVersion: "vs1-assessment@1",
  decision: { currency: "ALL", initialHousingAll: "70000" },
  calculationInput: {
    income: { amount: "210000", currency: "RUB", profileId: "profile-1" },
    cbrRate: {
      sourceId: "cbr-eur",
      rate: "100",
      base: "EUR",
      quote: "RUB",
      claimId: "cbr-eur-facts-1",
      sourcePeriod: "2026-08-08",
      ref: "cbr-ref",
    },
    boaRate: {
      sourceId: "boa-eur",
      rate: "100",
      base: "EUR",
      quote: "ALL",
      claimId: "boa-eur-facts-1",
      sourcePeriod: "2026-08-08",
      ref: "boa-ref",
    },
    housing: { currency: "ALL", initialHousingAll: "70000" },
  },
});

const c1 = forkHousingCommit(c0, { currency: "ALL", initialHousingAll: "90000" });

function revision(commit: typeof c0, id: string): BranchRunRevision {
  return {
    id,
    runId: "run-1",
    stage: "branch",
    assessmentDate: "2026-08-08",
    parentRevisionId: "assessment-revision-1",
    profileId: commit.profileId,
    evidenceSnapshotId: commit.evidenceSnapshotId,
    assessmentId: commit.assessmentId,
    rulesVersion: commit.rulesVersion,
    branchCommitId: commit.id,
    formulaHash: commit.formulaHash,
    outputHash: commit.outputHash,
    hmac: "signed",
  };
}

describe("journey presentation application", () => {
  it("owns initial loading, C0 presentation and C1 diff presentation", async () => {
    const loadCore = vi.fn(async () => core);
    const application = createJourneyPresentation({
      loadRunDetailsCore: loadCore,
      loadInitialBranchByRunId: async () => revision(c0, "branch-revision-0"),
      loadBranchCommit: async (id) => id === c0.id ? c0 : c1,
      saveInitialHousingBranch: async () => ({ commit: c0, revision: revision(c0, "branch-revision-0") }),
      forkHousingBranch: async () => ({
        commit: c1,
        revision: revision(c1, "branch-revision-1"),
        diff: diffCommits(c0, c1),
      }),
    });

    const initial = await application.presentRun("run-1");
    expect(initial).toMatchObject({
      budget: { housingAll: "70000.00" },
      initialBranchCursor: { commitId: c0.id },
      branchCursor: { commitId: c0.id },
    });
    const c0Presentation = await application.saveInitialHousingJourney("run-1");
    expect(c0Presentation).toMatchObject({
      budget: { housingAll: "70000.00" },
    });
    const c1Presentation = await application.forkHousingJourney({ commitId: c0.id }, "90000");
    expect(c1Presentation).toMatchObject({
      budget: { housingAll: "90000.00" },
      branchDiff: { housing: { before: "70000.00", after: "90000.00" } },
    });
    expect(initial.narrative).toEqual(c0Presentation.narrative);
    expect(c0Presentation.narrative).toEqual(c1Presentation.narrative);
    expect(loadCore).toHaveBeenCalledTimes(3);
  });

  it("keeps a run without C0 presentable and does not swallow other load failures", async () => {
    const missing = createJourneyPresentation({
      loadRunDetailsCore: async () => core,
      loadInitialBranchByRunId: async () => { throw new Error("branch_revision_not_found"); },
      loadBranchCommit: async () => c0,
      saveInitialHousingBranch: async () => ({ commit: c0, revision: revision(c0, "branch-revision-0") }),
      forkHousingBranch: async () => ({
        commit: c1,
        revision: revision(c1, "branch-revision-1"),
        diff: diffCommits(c0, c1),
      }),
    });
    await expect(missing.presentRun("run-1")).resolves.toMatchObject({ run: { runId: "run-1" } });

    const corrupt = createJourneyPresentation({
      loadRunDetailsCore: async () => core,
      loadInitialBranchByRunId: async () => { throw new Error("integrity_mismatch"); },
      loadBranchCommit: async () => c0,
      saveInitialHousingBranch: async () => ({ commit: c0, revision: revision(c0, "branch-revision-0") }),
      forkHousingBranch: async () => ({
        commit: c1,
        revision: revision(c1, "branch-revision-1"),
        diff: diffCommits(c0, c1),
      }),
    });
    await expect(corrupt.presentRun("run-1")).rejects.toThrow("integrity_mismatch");
  });
});
