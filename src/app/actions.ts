"use server";

import type { HousingDecision } from "../branch/housing";
import type { ProfileDraft } from "../decision/profile";
import type { RunResult } from "../application/contracts";
import { getConfirmedLifeApplication } from "../infrastructure/composition-root";

export async function startConfirmedLife(
  draft: ProfileDraft,
  initialHousing: HousingDecision,
): Promise<RunResult> {
  return getConfirmedLifeApplication().startConfirmedLife(draft, initialHousing);
}

export async function retryConfirmedLifeRun(previousRunId: string): Promise<RunResult> {
  return getConfirmedLifeApplication().retryConfirmedLife(previousRunId);
}
