"use server";

import type { BranchCursor } from "../branch/life-git";
import { confirmHousingDecision, type HousingDecision } from "../branch/housing";
import { confirmProfile, type ProfileDraft } from "../decision/profile";

const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/;
const COMMIT_ID = /^[a-f\d]{64}$/;

function runId(value: unknown): string {
  if (typeof value !== "string" || !RUN_ID.test(value)) throw new Error("invalid_run_id");
  return value;
}

function commitId(value: unknown): string {
  if (typeof value !== "string" || !COMMIT_ID.test(value)) throw new Error("invalid_commit_id");
  return value;
}

function branchCursor(value: unknown): BranchCursor {
  if (
    value === null || typeof value !== "object" || Array.isArray(value) ||
    Object.keys(value).length !== 1 || !("commitId" in value)
  ) throw new Error("invalid_branch_cursor");
  return Object.freeze({ commitId: commitId(value.commitId) });
}

function housingDecimal(value: unknown): string {
  try {
    return confirmHousingDecision({ currency: "ALL", initialHousingAll: value }).initialHousingAll;
  } catch {
    throw new Error("invalid_housing_all");
  }
}

async function application() {
  return (await import("../infrastructure/composition-root")).getConfirmedLifeApplication();
}

export async function startConfirmedLife(draft: ProfileDraft, initialHousing: HousingDecision) {
  const exactDraft = confirmProfile(draft, () => new Date(0)).profile;
  const exactHousing = confirmHousingDecision(initialHousing);
  const service = await application();
  const run = await service.startConfirmedLife(exactDraft, exactHousing);
  return service.presentRun(run.runId);
}

export async function retryConfirmedLifeRun(previousRunId: string) {
  const exactRunId = runId(previousRunId);
  const service = await application();
  const next = await service.retryConfirmedLife(exactRunId);
  return service.presentRun(next.runId);
}

export async function saveInitialHousingBranch(previousRunId: string) {
  const exactRunId = runId(previousRunId);
  return (await application()).saveInitialHousingJourney(exactRunId);
}

export async function rewindHousingBranch(previousCommitId: string): Promise<BranchCursor> {
  const exactCommitId = commitId(previousCommitId);
  return (await application()).rewindHousingBranch(exactCommitId);
}

export async function forkHousingBranch(cursor: BranchCursor, housingAll: string) {
  const exactCursor = branchCursor(cursor);
  const exactHousing = housingDecimal(housingAll);
  return (await application()).forkHousingJourney(exactCursor, exactHousing);
}
