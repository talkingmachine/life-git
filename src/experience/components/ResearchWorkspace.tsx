"use client";

import { useState } from "react";

import type {
  CandidateState,
  ResearchCandidate as MapResearchCandidate,
  ResearchProgressItem,
} from "../research-map/contracts";
import type { createJourneyView } from "../view-model";
import { UiIcon } from "./UiIcon";

type LegacyJourneyCandidate = ReturnType<typeof createJourneyView>["candidate"];
type LegacyResearchCandidate = Omit<LegacyJourneyCandidate, "reason" | "status"> & {
  readonly reason?: MapResearchCandidate["reason"] | undefined;
  readonly status: CandidateState;
  readonly statusLabel?: string;
};
type ResearchCandidate = MapResearchCandidate | LegacyResearchCandidate;

interface ResearchWorkspaceProps {
  readonly scope?: "single-candidate" | "country-frontier";
  readonly mode: CandidateState;
  readonly candidates: readonly ResearchCandidate[];
  readonly previousRun?: ResearchRunReference;
  readonly progress?: readonly ResearchProgressItem[];
  readonly progressAnnouncement?: string;
  readonly retryError?: string;
  readonly retryRecord?: ResearchRetryRecord;
  readonly routeLabel?: string;
  readonly onRetry?: (previousRunId: string) => void;
}

export interface ResearchRunReference {
  readonly runId: string;
  readonly evidenceSnapshotId: string;
}

export interface ResearchRetryRecord {
  readonly previous: ResearchRunReference;
  readonly next: {
    readonly runId: string;
    readonly evidenceSnapshotId: string;
  };
}

const labels: Record<CandidateState, string> = {
  pending: "Проверка",
  green: "Подтверждено",
  yellow: "Нужно уточнить",
  red: "Не подходит",
};

const frontierLabels: Record<CandidateState, string> = {
  pending: "Формальная проверка",
  green: "Формально доступно",
  yellow: "Требует формальной проверки",
  red: "Формально недоступно",
};

const statusIcon = {
  pending: "status-pending",
  green: "status-green",
  yellow: "status-yellow",
  red: "status-red",
} as const;

function destinationLabel(candidate: ResearchCandidate): string {
  return "destination" in candidate ? candidate.destination : candidate.label;
}

function candidateRoute(candidate: ResearchCandidate, routeLabel?: string): string {
  if (routeLabel !== undefined) return routeLabel;
  return "origin" in candidate
    ? `${candidate.origin} → ${candidate.destination}`
    : `Россия → ${candidate.label}`;
}

export function ResearchWorkspace({
  mode,
  candidates,
  onRetry,
  previousRun,
  progress = [],
  progressAnnouncement,
  retryError,
  retryRecord,
  routeLabel,
  scope = "single-candidate",
}: ResearchWorkspaceProps) {
  const [openCandidateId, setOpenCandidateId] = useState<string>();

  if (mode === "green" && scope === "single-candidate") {
    const destination = candidates[0] === undefined
      ? "Маршрут"
      : destinationLabel(candidates[0]);
    return (
      <section
        aria-label="Проверка маршрута"
        className="orbit-panel research-workspace research-workspace--green research-workspace--collapsed"
        data-collapsed="true"
        data-scope="single-candidate"
        data-tone="green"
        role="region"
      >
        <UiIcon className="research-workspace__status-icon" name="status-green" weight="duotone" />
        <strong>Маршрут предварительно совместим</strong>
        <span className="research-workspace__state-label">
          {destination} · проверено в заявленном scope
        </span>
      </section>
    );
  }

  const reveal = (candidateId: string) => setOpenCandidateId((current) =>
    current === candidateId ? undefined : candidateId
  );
  const retry = () => {
    if (previousRun === undefined || onRetry === undefined) return;
    onRetry(previousRun.runId);
  };

  const previousSnapshotId = retryRecord?.previous.evidenceSnapshotId
    ?? previousRun?.evidenceSnapshotId;
  const showRetry = scope === "single-candidate" && mode !== "pending" && (
    (mode === "yellow" && previousRun !== undefined && onRetry !== undefined)
    || retryRecord !== undefined
    || retryError !== undefined
  );
  const candidateLabels = scope === "country-frontier" ? frontierLabels : labels;
  const showProgress = scope === "country-frontier"
    ? candidates.some(({ status }) => status === "pending")
    : mode === "pending";

  return (
    <section
      aria-label={scope === "country-frontier"
        ? "Проверка формальной доступности стран"
        : "Проверка маршрута"}
      className={`research-workspace research-workspace--${mode}`}
      data-scope={scope}
      data-tone={mode === "pending" ? "gray" : mode}
      role="region"
    >
      <section className="orbit-panel research-workspace__candidate">
        <p className="orbit-panel__index">
          {scope === "country-frontier" ? "СТРАНЫ" : "01 / МАРШРУТ"}
        </p>
        <ul aria-label={scope === "country-frontier" ? "Кандидаты стран" : "Кандидаты маршрута"}>
          {candidates.map((candidate) => {
            const reasonId = `research-reason-${candidate.id}`;
            const isInteractive = candidate.reason !== undefined &&
              (candidate.status === "red" || candidate.status === "yellow");
            return (
              <li
                className={`research-workspace__candidate-item research-workspace__candidate-item--${candidate.status}`}
                key={candidate.id}
              >
                {!isInteractive ? (
                  <div className="research-workspace__candidate-control">
                    <UiIcon
                      className="research-workspace__status-icon"
                      name={statusIcon[candidate.status]}
                      weight={candidate.status === "pending" ? "regular" : "duotone"}
                    />
                    <span className="research-workspace__route">
                      {candidateRoute(candidate, routeLabel)}
                    </span>
                    <span className="research-workspace__state-label">
                      {candidate.statusLabel ?? candidateLabels[candidate.status]}
                    </span>
                  </div>
                ) : (
                  <button
                    aria-controls={reasonId}
                    aria-expanded={openCandidateId === candidate.id}
                    className="research-workspace__candidate-control"
                    onClick={() => reveal(candidate.id)}
                    type="button"
                  >
                    <UiIcon
                      className="research-workspace__status-icon"
                      name={statusIcon[candidate.status]}
                      weight="duotone"
                    />
                    <span className="research-workspace__route">
                      {candidateRoute(candidate, routeLabel)}
                    </span>
                    <span className="research-workspace__state-label">
                      {candidate.statusLabel ?? candidateLabels[candidate.status]}
                    </span>
                    <UiIcon
                      className="research-workspace__disclosure-icon"
                      name={openCandidateId === candidate.id ? "collapse" : "expand"}
                    />
                  </button>
                )}
                {openCandidateId === candidate.id && isInteractive && candidate.reason !== undefined ? (
                  <div className="research-workspace__reason" id={reasonId}>
                    <p>{candidate.reason.summary}</p>
                    {(candidate.reason.officialUrls ?? (
                      candidate.reason.officialUrl === undefined ? [] : [candidate.reason.officialUrl]
                    )).length === 0 ? null : (
                      <section aria-label="Evidence">
                        <h3>Evidence</h3>
                        {(candidate.reason.officialUrls ?? [candidate.reason.officialUrl!])
                          .map((url, index) => (
                            <a href={url} key={url}>Официальный источник {index + 1}</a>
                          ))}
                      </section>
                    )}
                    {candidate.reason.manualCheckLinks?.length ? (
                      <section aria-label="Проверьте вручную">
                        <h3>Проверьте вручную</h3>
                        {candidate.reason.manualCheckLinks.map((link) => (
                          <a href={link.url} key={`${link.label}:${link.url}`}>{link.label}</a>
                        ))}
                      </section>
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </section>
      {showProgress ? (
        <aside
          aria-label="Ход проверки"
          className="orbit-panel research-workspace__progress"
          role="region"
        >
          <h2>Ход проверки</h2>
          {progress.length === 0 ? (
            <p>Ожидаем первый подтверждённый шаг.</p>
          ) : (
            <ol>
              {progress.map((item) => (
                <li aria-current={item.current ? "step" : undefined} key={item.key}>
                  <span>{item.label}</span>
                  {item.detail === undefined ? null : <small>{item.detail}</small>}
                  {item.sourceUrl === undefined ? null : (
                    <a href={item.sourceUrl}>Открыть официальный источник</a>
                  )}
                </li>
              ))}
            </ol>
          )}
          <p
            aria-atomic="true"
            aria-live="polite"
            className="visually-hidden"
          >
            {progressAnnouncement ?? ""}
          </p>
        </aside>
      ) : null}
      {showRetry ? (
        <section aria-label="Повторная проверка" className="orbit-panel research-workspace__retry">
          {previousSnapshotId === undefined ? null : <p>Предыдущий снимок: {previousSnapshotId}</p>}
          {mode === "yellow" && previousRun !== undefined && onRetry !== undefined ? (
            <button onClick={retry} type="button">
              <UiIcon name="retry" />
              Проверить ещё раз
            </button>
          ) : null}
          {retryRecord === undefined ? null : (
            <div aria-live="polite">
              <p>Новый запуск: {retryRecord.next.runId}</p>
              <p>Новый снимок: {retryRecord.next.evidenceSnapshotId}</p>
            </div>
          )}
          {retryError === undefined ? null : <p role="alert">{retryError}</p>}
        </section>
      ) : null}
    </section>
  );
}
