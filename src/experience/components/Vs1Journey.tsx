"use client";

import { useState, useTransition } from "react";
import type { FormEvent } from "react";

import type { RunDetails } from "../../application/contracts";
import {
  forkHousingBranch,
  retryConfirmedLifeRun,
  rewindHousingBranch,
  saveInitialHousingBranch,
} from "../../app/actions";
import { createJourneyView } from "../view-model";
import { replaceRunUrl } from "../run-url";
import { EvidencePassport } from "./EvidencePassport";
import { LifeBranch } from "./LifeBranch";
import { LifeGitDiff } from "./LifeGitDiff";
import { ProfileCard } from "./ProfileCard";
import { ResearchMap } from "./ResearchMap";

interface Vs1JourneyProps {
  details: RunDetails;
}

export function Vs1Journey({ details }: Vs1JourneyProps) {
  const [current, setCurrent] = useState(details);
  const [initialCursor, setInitialCursor] = useState(
    current.initialBranchCursor ?? current.branchCursor,
  );
  const [cursor, setCursor] = useState(current.branchCursor);
  const [housingAll, setHousingAll] = useState("90000");
  const [error, setError] = useState<string>();
  const [isResearchPending, setResearchPending] = useState(false);
  const [isBranchPending, startBranchTransition] = useTransition();
  const view = createJourneyView(current);
  const mode = isResearchPending ? "pending" as const : view.candidate.status;
  const candidate = isResearchPending
    ? { ...view.candidate, status: "pending" as const, reason: undefined }
    : view.candidate;

  const runAction = (action: () => Promise<RunDetails>) => {
    setError(undefined);
    startBranchTransition(async () => {
      try {
        const next = await action();
        setCurrent(next);
        setInitialCursor((existing) => existing ?? next.initialBranchCursor ?? next.branchCursor);
        setCursor(next.branchCursor);
      } catch {
        setError("Действие не выполнено. Исходный снимок сохранён.");
      }
    });
  };

  const submitFork = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (cursor === undefined || initialCursor === undefined || cursor.commitId !== initialCursor.commitId) return;
    runAction(() => forkHousingBranch(cursor, housingAll));
  };

  return (
    <main className="journey-shell">
      <header className="journey-hero">
        <p className="eyebrow">VS-1 · подтверждённая жизнь</p>
        <h1>{current.narrative.headline}</h1>
        <ul>
          {current.narrative.bullets.map((bullet) => <li key={bullet}>{bullet}</li>)}
        </ul>
        <p className="scope-note">Один заранее выбранный кандидат: Россия → Тирана. Это не глобальный рейтинг и не список лучших городов.</p>
      </header>

      <ProfileCard
        canSaveC0={current.run.assessment.marker === "green" && initialCursor === undefined}
        onSaveC0={() => runAction(() => saveInitialHousingBranch(current.run.runId))}
        profile={view.profile}
      />

      <ResearchMap
        candidates={[candidate]}
        mode={mode}
        onRetry={async (previousRunId) => {
          setResearchPending(true);
          try {
            const next = await retryConfirmedLifeRun(previousRunId);
            replaceRunUrl(next.run.runId);
            setCurrent(next);
            setInitialCursor(next.initialBranchCursor ?? next.branchCursor);
            setCursor(next.branchCursor);
            return {
              runId: next.run.runId,
              evidenceSnapshotId: next.run.evidenceSnapshotId,
            };
          } finally {
            setResearchPending(false);
          }
        }}
        previousRun={{
          runId: current.run.runId,
          evidenceSnapshotId: current.run.evidenceSnapshotId,
        }}
      />

      {current.budget === undefined ? null : <LifeBranch budget={current.budget} />}

      {initialCursor === undefined ? null : (
        <section aria-labelledby="branch-controls-heading" className="branch-controls">
          <h2 id="branch-controls-heading">Ветка жилья</h2>
          <button
            onClick={() => startBranchTransition(async () => {
              try {
                setCursor(await rewindHousingBranch(initialCursor.commitId));
              } catch {
                setError("Не удалось перемотать ветку. Исходный снимок сохранён.");
              }
            })}
            type="button"
          >
            Перемотать к C0
          </button>
          <form onSubmit={submitFork}>
            <label htmlFor="housing-all">Жильё для C1, ALL</label>
            <input
              id="housing-all"
              inputMode="decimal"
              onChange={(event) => setHousingAll(event.currentTarget.value)}
              value={housingAll}
            />
            <button
              disabled={
                cursor === undefined || initialCursor === undefined ||
                cursor.commitId !== initialCursor.commitId || isBranchPending
              }
              type="submit"
            >
              Создать C1
            </button>
          </form>
        </section>
      )}

      {current.branchDiff === undefined ? null : <LifeGitDiff diff={current.branchDiff} />}
      <EvidencePassport items={current.evidenceItems} />
      {error === undefined ? null : <p role="alert">{error}</p>}
    </main>
  );
}
