"use client";

import { useRef, useState, useTransition } from "react";
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
import { BranchWorkspace } from "./BranchWorkspace";
import { LifeGitWorkspace } from "./LifeGitWorkspace";
import { OverviewWorkspace } from "./OverviewWorkspace";
import { ProductShell } from "./ProductShell";
import type { CommandCenterDestination } from "./ProductShell";
import { ResearchWorkspace } from "./ResearchWorkspace";
import type { ResearchRetryRecord } from "./ResearchWorkspace";
import { SourcesWorkspace } from "./SourcesWorkspace";

interface Vs1JourneyProps {
  details: RunDetails;
}

function isInitialBranchView(details: RunDetails): boolean {
  return details.initialBranchCursor !== undefined &&
    details.branchCursor?.commitId === details.initialBranchCursor.commitId;
}

export function Vs1Journey({ details }: Vs1JourneyProps) {
  const [current, setCurrent] = useState(details);
  const [destination, setDestination] = useState<CommandCenterDestination>(
    details.run.assessment.marker === "green" ? "overview" : "research",
  );
  const [initialDetails, setInitialDetails] = useState<RunDetails | undefined>(
    isInitialBranchView(details) ? details : undefined,
  );
  const [initialCursor, setInitialCursor] = useState(
    current.initialBranchCursor ?? current.branchCursor,
  );
  const [cursor, setCursor] = useState(current.branchCursor);
  const [housingAll, setHousingAll] = useState("90000");
  const [error, setError] = useState<string>();
  const [isResearchPending, setResearchPending] = useState(false);
  const [researchRetryError, setResearchRetryError] = useState<string>();
  const [researchRetryRecord, setResearchRetryRecord] = useState<ResearchRetryRecord>();
  const [isBranchPending, startBranchTransition] = useTransition();
  const branchActionInFlight = useRef(false);
  const view = createJourneyView(current);
  const mode = isResearchPending ? "pending" as const : view.candidate.status;
  const candidate = isResearchPending
    ? { ...view.candidate, status: "pending" as const, reason: undefined }
    : view.candidate;
  const canCreateC1 = cursor !== undefined && initialCursor !== undefined &&
    cursor.commitId === initialCursor.commitId;
  const canRewind = cursor !== undefined && initialCursor !== undefined &&
    cursor.commitId !== initialCursor.commitId;
  const showBranchControls = initialCursor !== undefined && initialDetails !== undefined;

  const runAction = (action: () => Promise<RunDetails>) => {
    if (branchActionInFlight.current) return;
    branchActionInFlight.current = true;
    setError(undefined);
    startBranchTransition(async () => {
      try {
        const next = await action();
        setCurrent(next);
        setInitialDetails((existing) => existing ?? (isInitialBranchView(next) ? next : undefined));
        setInitialCursor((existing) => existing ?? next.initialBranchCursor ?? next.branchCursor);
        setCursor(next.branchCursor);
      } catch {
        setError("Действие не выполнено. Исходный снимок сохранён.");
      } finally {
        branchActionInFlight.current = false;
      }
    });
  };

  const submitFork = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (cursor === undefined || initialCursor === undefined || cursor.commitId !== initialCursor.commitId) return;
    runAction(() => forkHousingBranch(cursor, housingAll));
  };

  const rewind = () => {
    if (initialCursor === undefined || initialDetails === undefined || branchActionInFlight.current) return;
    branchActionInFlight.current = true;
    startBranchTransition(async () => {
      try {
        const nextCursor = await rewindHousingBranch(initialCursor.commitId);
        setCursor(nextCursor);
        setCurrent(initialDetails);
      } catch {
        setError("Не удалось перемотать ветку. Исходный снимок сохранён.");
      } finally {
        branchActionInFlight.current = false;
      }
    });
  };

  const workspace = (() => {
    switch (destination) {
      case "overview":
        return (
          <OverviewWorkspace
            hasC0={initialCursor !== undefined}
            hasDiff={current.branchDiff !== undefined}
            marker={current.run.assessment.marker}
            narrative={current.narrative}
            onDestinationChange={setDestination}
            profile={view.profile}
            summary={view.summary}
          />
        );
      case "research":
        return (
          <section className="journey-shell journey-shell--research">
            <ResearchWorkspace
              candidates={[candidate]}
              mode={mode}
              onRetry={async (previousRunId) => {
                const previous = {
                  runId: previousRunId,
                  evidenceSnapshotId: current.run.evidenceSnapshotId,
                };
                setResearchRetryError(undefined);
                setResearchPending(true);
                try {
                  const next = await retryConfirmedLifeRun(previousRunId);
                  replaceRunUrl(next.run.runId);
                  setCurrent(next);
                  setInitialDetails(isInitialBranchView(next) ? next : undefined);
                  setInitialCursor(next.initialBranchCursor ?? next.branchCursor);
                  setCursor(next.branchCursor);
                  setResearchRetryRecord({
                    previous,
                    next: {
                      runId: next.run.runId,
                      evidenceSnapshotId: next.run.evidenceSnapshotId,
                    },
                  });
                  setDestination(next.run.assessment.marker === "green" ? "overview" : "research");
                } catch {
                  setResearchRetryError("Повторная проверка не выполнена. Предыдущий снимок сохранён.");
                } finally {
                  setResearchPending(false);
                }
              }}
              previousRun={{
                runId: current.run.runId,
                evidenceSnapshotId: current.run.evidenceSnapshotId,
              }}
              retryError={researchRetryError}
              retryRecord={researchRetryRecord}
            />
          </section>
        );
      case "branch":
        return (
          <BranchWorkspace
            budget={current.budget}
            canCreateC1={canCreateC1}
            canRewind={canRewind}
            canSaveC0={
              current.run.assessment.marker === "green" &&
              initialCursor === undefined &&
              !isBranchPending
            }
            housingAll={housingAll}
            isBranchPending={isBranchPending}
            onFork={submitFork}
            onHousingAllChange={setHousingAll}
            onRewind={rewind}
            onSaveC0={() => runAction(() => saveInitialHousingBranch(current.run.runId))}
            profile={view.profile}
            showBranchControls={showBranchControls}
          />
        );
      case "life-git":
        return (
          <LifeGitWorkspace
            canCreateC1={canCreateC1}
            canRewind={canRewind}
            diff={current.branchDiff}
            housingAll={housingAll}
            isBranchPending={isBranchPending}
            onFork={submitFork}
            onHousingAllChange={setHousingAll}
            onRewind={rewind}
            showBranchControls={showBranchControls}
          />
        );
      case "sources":
        return (
          <SourcesWorkspace
            companionMode={view.profile.companionMode}
            items={current.evidenceItems}
          />
        );
    }
  })();

  return (
    <ProductShell
      activeDestination={destination}
      context={{
        route: "Россия → Тирана",
        branch: view.summary.branchLabel,
        snapshot: current.run.assessmentDate,
        status: mode,
      }}
      onDestinationChange={setDestination}
    >
      {workspace}
      {error === undefined ? null : <p role="alert">{error}</p>}
    </ProductShell>
  );
}
