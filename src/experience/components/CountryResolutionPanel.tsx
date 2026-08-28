"use client";

import { useEffect, useRef } from "react";

import type { CountryResolutionReadModel } from
  "../../application/country-resolution";
import type {
  CountryResolutionCandidateView,
  CountryResolutionView,
} from "../country-resolution-view-model";
import type { PlaceFrontierCountryCard } from "../place-frontier-view-model";

export const YELLOW_RISK_COPY =
  "Официальных данных недостаточно, чтобы подтвердить возможность долгосрочного проживания. " +
  "Принимая страну, вы берёте риск самостоятельной проверки на себя.";

interface CountryResolutionPanelProps {
  readonly decisionError?: string;
  readonly decisionPending: boolean;
  readonly onContinue: () => void;
  readonly onDecision: (decision: "accepted_at_own_risk" | "rejected") => void;
  readonly onReload: () => void;
  readonly readModel: CountryResolutionReadModel;
  readonly view: CountryResolutionView;
}

function promptCandidate(
  view: CountryResolutionView,
): CountryResolutionCandidateView | undefined {
  return view.candidates.find(({ country }) =>
    country.countryCode === view.currentPrompt?.countryCode);
}

function explanationStatusLabel(
  status: NonNullable<CountryResolutionCandidateView["assessmentExplanations"]>[number]["status"],
): "Нужно уточнить" | "Есть подтверждённое несоответствие" {
  return status === "unknown"
    ? "Нужно уточнить"
    : "Есть подтверждённое несоответствие";
}

function AssessmentExplanations({
  explanations,
}: {
  readonly explanations?: CountryResolutionCandidateView["assessmentExplanations"];
}) {
  if (explanations === undefined || explanations.length === 0) return null;
  return (
    <section aria-label="Объяснение по участникам">
      <ul>
        {explanations.map((explanation, index) => (
          <li key={`${explanation.routeLabel}:${explanation.participantLabel}:${index}`}>
            <p>{explanation.routeLabel} · {explanation.participantLabel}</p>
            <p>
              <strong>{explanationStatusLabel(explanation.status)}</strong>
              {`: ${explanation.reasonLabels.join("; ")}`}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ResolvedCountryCard({
  candidate,
  card,
  sourceRevisionId,
}: {
  readonly candidate: CountryResolutionCandidateView;
  readonly card: PlaceFrontierCountryCard;
  readonly sourceRevisionId: string;
}) {
  return (
    <article className="place-frontier-card country-resolution-card">
      <header>
        <p>{card.country.flag} Место {card.rank}</p>
        <h3>{card.country.label}</h3>
        <p>{candidate.statusLabel}</p>
      </header>
      <AssessmentExplanations explanations={candidate.assessmentExplanations} />
      <dl>
        <div><dt>Релевантность</dt><dd>{card.relevance}</dd></div>
        <div><dt>Покрытие</dt><dd>{card.coverage}</dd></div>
        <div><dt>Последняя проверка</dt><dd>{card.lastCheckedAt}</dd></div>
        <div><dt>Evidence snapshot</dt><dd>{card.evidenceSnapshotId}</dd></div>
      </dl>
      <section>
        <h4>Вклад предпочтений</h4>
        <ul>
          {card.contributions.map((contribution) => (
            <li key={contribution.criterionId}>
              {contribution.criterionId}: {contribution.state} · effective
              {` ${contribution.effectiveMatch} · contribution ${contribution.weightedContribution}`}
            </li>
          ))}
        </ul>
      </section>
      <a href={`?flow=city-frontier&source=${encodeURIComponent(sourceRevisionId)}` +
        `&country=${encodeURIComponent(card.country.countryCode)}`}>
        Исследовать города
      </a>
    </article>
  );
}

export function CountryResolutionPanel({
  decisionError,
  decisionPending,
  onContinue,
  onDecision,
  onReload,
  readModel,
  view,
}: CountryResolutionPanelProps) {
  const promptHeading = useRef<HTMLHeadingElement>(null);
  const candidate = promptCandidate(view);

  useEffect(() => {
    if (view.currentPrompt !== undefined) promptHeading.current?.focus();
  }, [view.currentPrompt?.countryCode]);

  if (view.requiresVerifiedReload) {
    return (
      <section className="country-resolution-panel country-resolution-panel--continuation">
        <p role="alert">
          Обновление сохранено, но завершение потока не подтверждено.{" "}
          Перезагрузите страницу, чтобы проверить актуальное состояние.
        </p>
        <button onClick={onReload} type="button">Перезагрузить</button>
        <p className="visually-hidden">Revision: {readModel.revision.id}</p>
      </section>
    );
  }

  if (view.currentPrompt !== undefined && candidate !== undefined) {
    return (
      <section aria-labelledby="country-resolution-heading" className="country-resolution-panel">
        <p className="eyebrow">Требуется решение</p>
        <h2 id="country-resolution-heading" ref={promptHeading} tabIndex={-1}>
          Решение по стране {candidate.country.label}
        </h2>
        {view.currentPrompt.uncertainty.unknownRoutes.length === 0 ? null : (
          <section aria-label="Неполные формальные факты">
            <h3>Неполные формальные факты</h3>
            <ul>
              {view.currentPrompt.uncertainty.unknownRoutes.flatMap((route) =>
                route.reasons.map((reason) => (
                  <li key={`${route.routeId}:${reason.code}`}>
                    {route.routeId}: <strong>{reason.code}</strong>
                  </li>
                ))) }
            </ul>
          </section>
        )}
        <AssessmentExplanations explanations={candidate.assessmentExplanations} />
        {view.currentPrompt.uncertainty.catalogCompletenessUnprovable === undefined ? null : (
          <p>Полнота официального каталога маршрутов не подтверждена.</p>
        )}
        <p>{YELLOW_RISK_COPY}</p>
        {candidate.officialUrls.length === 0 ? null : (
          <section aria-label="Evidence">
            <h3>Evidence</h3>
            {candidate.officialUrls.map((url, index) => (
              <a href={url} key={url}>Официальный источник {index + 1}</a>
            ))}
          </section>
        )}
        {candidate.manualCheckLinks.length === 0 ? null : (
          <section aria-label="Проверьте вручную">
            <h3>Проверьте вручную</h3>
            {candidate.manualCheckLinks.map((link) => (
              <a href={link.url} key={`${link.label}:${link.url}`}>{link.label}</a>
            ))}
          </section>
        )}
        {decisionError === undefined ? null : <p role="alert">{decisionError}</p>}
        <div className="country-resolution-panel__actions">
          <button disabled={decisionPending} onClick={() => onDecision("accepted_at_own_risk")}
            type="button">
            Принять риск и оставить страну
          </button>
          <button disabled={decisionPending} onClick={() => onDecision("rejected")} type="button">
            Отклонить страну
          </button>
        </div>
      </section>
    );
  }

  if (view.globeMode === "collapsed") {
    return (
      <>
        <section className="place-frontier-summary country-resolution-summary">
          <p className="eyebrow">Результат</p>
          <h2>{view.cards.length} стран доступны для выбора</h2>
          {view.cards.length === 0 ? (
            <p>После разрешения неопределённости подходящих стран не осталось.</p>
          ) : null}
        </section>
        {view.cards.length === 0 ? null : (
          <section aria-label="Карточки стран" className="place-frontier-cards">
            {view.cards.map((card) => {
              const effective = view.candidates.find(({ country }) =>
                country.countryCode === card.country.countryCode);
              if (effective === undefined) return null;
              return <ResolvedCountryCard candidate={effective} card={card}
                sourceRevisionId={readModel.revision.id}
                key={card.country.countryCode} />;
            })}
          </section>
        )}
      </>
    );
  }

  return (
    <section className="country-resolution-panel country-resolution-panel--continuation">
      {view.transportError === undefined ? null : <p role="alert">{view.transportError}</p>}
      {view.canContinue ? (
        <button onClick={onContinue} type="button">Продолжить проверку</button>
      ) : <p>Проверяем следующую страну из сохранённого рейтинга.</p>}
      <p className="visually-hidden">Revision: {readModel.revision.id}</p>
    </section>
  );
}
