"use client";

import { useState } from "react";

export type CandidateState = "pending" | "green" | "yellow" | "red";

export interface ResearchCandidate {
  id: string;
  origin: "Россия";
  destination: "Тирана";
  status: CandidateState;
  reason?: {
    summary: string;
    officialUrl: string;
  };
}

interface ResearchMapProps {
  mode: CandidateState;
  candidates: readonly ResearchCandidate[];
  previousRun?: {
    readonly runId: string;
    readonly evidenceSnapshotId: string;
  };
  onRetry?: (previousRunId: string) => Promise<{
    readonly runId: string;
    readonly evidenceSnapshotId: string;
  }>;
}

const labels: Record<CandidateState, string> = {
  pending: "Проверка",
  green: "Подтверждено",
  yellow: "Нужно уточнить",
  red: "Не подходит",
};

export function ResearchMap({ mode, candidates, previousRun, onRetry }: ResearchMapProps) {
  const [openCandidateId, setOpenCandidateId] = useState<string>();
  const [retryRecord, setRetryRecord] = useState<{
    readonly previous: NonNullable<ResearchMapProps["previousRun"]>;
    readonly next: {
      readonly runId: string;
      readonly evidenceSnapshotId: string;
    };
  }>();
  const [retryError, setRetryError] = useState<string>();

  if (mode === "green") {
    return (
      <section
        aria-label="Карта проверки маршрута"
        className="research-map research-map--green research-map--collapsed"
        data-collapsed="true"
        data-scope="single-candidate"
        data-tone="green"
        role="region"
      >
        <span aria-hidden="true" className="research-map__status-icon">✓</span>
        <strong>Маршрут предварительно совместим</strong>
        <span className="research-map__state-label">Тирана · проверено в заявленном scope</span>
      </section>
    );
  }

  const reveal = (candidateId: string) => setOpenCandidateId((current) =>
    current === candidateId ? undefined : candidateId
  );
  const retry = async () => {
    if (previousRun === undefined || onRetry === undefined) return;
    const previous = previousRun;
    setRetryError(undefined);
    try {
      setRetryRecord({ previous, next: await onRetry(previous.runId) });
    } catch {
      setRetryError("Повторная проверка не выполнена. Предыдущий снимок сохранён.");
    }
  };

  return (
    <section
      aria-label="Карта проверки маршрута"
      className={`research-map research-map--${mode}`}
      data-scope="single-candidate"
      data-tone={mode === "pending" ? "gray" : mode}
      role="region"
    >
      <div className="research-map__canvas">
        <img alt="" aria-hidden="true" className="research-map__art" src="/world-map.svg" />
        <div aria-label="Самолёт летит из России в Тирану" className="research-map__airplane" role="img">
          ✈
        </div>
      </div>
      <ul className="research-map__markers">
        {candidates.map((candidate) => (
          <li className={`research-map__marker research-map__marker--${candidate.status}`} key={candidate.id}>
            {candidate.status === "yellow" || candidate.status === "red" ? (
              <>
                <button
                  aria-expanded={openCandidateId === candidate.id}
                  className="research-map__marker-button"
                  onClick={() => reveal(candidate.id)}
                  type="button"
                >
                  <span aria-hidden="true" className="research-map__status-icon">{candidate.status === "yellow" ? "!" : "×"}</span>
                  <span className="research-map__state-label">{candidate.destination} — {labels[candidate.status]}</span>
                </button>
                {openCandidateId === candidate.id && candidate.reason !== undefined ? (
                  <div className="research-map__reason">
                    <p>{candidate.reason.summary}</p>
                    <a href={candidate.reason.officialUrl}>Официальный источник</a>
                  </div>
                ) : null}
              </>
            ) : (
              <>
                {candidate.status === "pending" ? (
                  <span aria-label="Идёт проверка" className="research-map__status-icon" role="status">
                    <span aria-hidden="true" className="research-map__spinner" />
                  </span>
                ) : <span aria-hidden="true" className="research-map__status-icon">●</span>}
                <span>{candidate.origin} → {candidate.destination}</span>
                <span className="research-map__state-label">{labels[candidate.status]}</span>
              </>
            )}
          </li>
        ))}
      </ul>
      {mode === "yellow" && previousRun !== undefined && onRetry !== undefined ? (
        <div className="research-map__retry">
          <p>Предыдущий снимок: {retryRecord?.previous.evidenceSnapshotId ?? previousRun.evidenceSnapshotId}</p>
          <button
            onClick={retry}
            type="button"
          >
            Проверить ещё раз
          </button>
          {retryRecord === undefined ? null : (
            <div aria-live="polite">
              <p>Новый запуск: {retryRecord.next.runId}</p>
              <p>Новый снимок: {retryRecord.next.evidenceSnapshotId}</p>
            </div>
          )}
          {retryError === undefined ? null : <p role="alert">{retryError}</p>}
        </div>
      ) : null}
    </section>
  );
}
