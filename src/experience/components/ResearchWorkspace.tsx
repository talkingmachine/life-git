"use client";

import { useState } from "react";

import { UiIcon } from "./UiIcon";

export type CandidateState = "pending" | "green" | "yellow" | "red";

export interface ResearchCandidate {
  id: string;
  origin: "Россия";
  destination: "Тирана";
  status: CandidateState;
  reason?: {
    summary: string;
    officialUrl?: string;
  };
}

interface ResearchWorkspaceProps {
  mode: CandidateState;
  candidates: readonly ResearchCandidate[];
  previousRun?: ResearchRunReference;
  retryError?: string;
  retryRecord?: ResearchRetryRecord;
  onRetry?: (previousRunId: string) => void;
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

const statusIcon = {
  pending: "status-pending",
  green: "status-green",
  yellow: "status-yellow",
  red: "status-red",
} as const;

export function ResearchWorkspace({
  mode,
  candidates,
  onRetry,
  previousRun,
  retryError,
  retryRecord,
}: ResearchWorkspaceProps) {
  const [openCandidateId, setOpenCandidateId] = useState<string>();

  if (mode === "green") {
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
        <span className="research-workspace__state-label">Тирана · проверено в заявленном scope</span>
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

  const previousSnapshotId = retryRecord?.previous.evidenceSnapshotId ??
    previousRun?.evidenceSnapshotId;
  const showRetry = mode !== "pending" && (
    (mode === "yellow" && previousRun !== undefined && onRetry !== undefined) ||
    retryRecord !== undefined || retryError !== undefined
  );

  return (
    <section
      aria-label="Проверка маршрута"
      className={`research-workspace research-workspace--${mode}`}
      data-scope="single-candidate"
      data-tone={mode === "pending" ? "gray" : mode}
      role="region"
    >
      <section className="orbit-panel research-workspace__candidate">
        <p className="orbit-panel__index">01 / МАРШРУТ</p>
        <ul aria-label="Кандидаты маршрута">
          {candidates.map((candidate) => (
            <li
              className={`research-workspace__candidate-item research-workspace__candidate-item--${candidate.status}`}
              key={candidate.id}
            >
              <button
                aria-expanded={openCandidateId === candidate.id}
                onClick={() => reveal(candidate.id)}
                type="button"
              >
                <UiIcon
                  className="research-workspace__status-icon"
                  name={statusIcon[candidate.status]}
                  weight={candidate.status === "pending" ? "regular" : "duotone"}
                />
                <span className="research-workspace__route">
                  {candidate.origin} → {candidate.destination}
                </span>
                <span className="research-workspace__state-label">{labels[candidate.status]}</span>
                {candidate.reason === undefined ? null : (
                  <UiIcon
                    className="research-workspace__disclosure-icon"
                    name={openCandidateId === candidate.id ? "collapse" : "expand"}
                  />
                )}
              </button>
              {openCandidateId === candidate.id && candidate.reason !== undefined ? (
                <div className="research-workspace__reason">
                  <p>{candidate.reason.summary}</p>
                  {candidate.reason.officialUrl === undefined ? null : (
                    <a href={candidate.reason.officialUrl}>Официальный источник</a>
                  )}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
      {mode === "pending" ? (
        <aside
          aria-label="Ход проверки"
          className="orbit-panel research-workspace__progress"
          role="region"
        >
          <h2>Ход проверки</h2>
          <ol>
            <li>Профиль подтверждён</li>
            <li aria-current="step">Официальные источники проверяются</li>
            <li>Снимок доказательств ожидает завершения проверки</li>
          </ol>
          <p>Текущий источник: официальный контур Россия → Тирана</p>
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
