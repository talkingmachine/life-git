"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import type { PlaceFrontierReadModel } from "../../application/place-frontier";
import type { PlaceFrontierCountryCard } from "../place-frontier-view-model";
import {
  createPlaceFrontierStreamHandoff,
  decodePlaceFrontierStream,
  openPlaceFrontierStreamResponse,
  type PlaceFrontierStreamHandoff,
} from "../place-frontier-stream";
import {
  createPlaceFrontierRunningState,
  failPlaceFrontierScreen,
  presentPlaceFrontierReadModel,
  projectPlaceFrontierView,
  reducePlaceFrontierScreenEvent,
  type PlaceFrontierScreenState,
} from "../place-frontier-view-model";
import { replacePlaceFrontierRunUrl } from "../run-url";
import { ProductShell } from "./ProductShell";
import { ResearchWorkspace } from "./ResearchWorkspace";

export type PlaceFrontierJourneyProps =
  | {
      readonly mode: "live";
      readonly runId: string;
      readonly profileId: string;
      readonly preferenceProfileId: string;
      readonly stream: ReadableStream<Uint8Array>;
      readonly streamHandoff?: PlaceFrontierStreamHandoff;
    }
  | {
      readonly mode: "stored";
      readonly runId: string;
      readonly initialReadModel: PlaceFrontierReadModel;
    }
  | {
      readonly mode: "interrupted";
      readonly runId: string;
    };

interface ActiveStream {
  readonly generation: number;
  readonly handoff: PlaceFrontierStreamHandoff;
  readonly stream: ReadableStream<Uint8Array>;
}

interface StreamConsumer extends ActiveStream {
  releaseToken?: object;
  readonly stop: (reason: DOMException) => void;
}

function releaseConsumerAfterEffectReplay(consumer: StreamConsumer): void {
  const releaseToken = {};
  consumer.releaseToken = releaseToken;
  queueMicrotask(() => {
    if (consumer.releaseToken === releaseToken) {
      consumer.stop(new DOMException("Frontier screen stopped consuming", "AbortError"));
    }
  });
}

const TRANSPORT_ERROR = "Поток проверки прерван. Доменный вывод не сформирован.";
const INTERRUPTED_ERROR = "Запуск был прерван до появления проверенного снимка.";
const RETRY_ERROR = "Повторная проверка не запущена. Предыдущая история сохранена.";

const ACTION_LABELS = {
  insurance: "Оформить медицинскую страховку",
  registration: "Выполнить регистрацию",
  document_submission: "Подать документы",
  job_offer: "Получить предложение о работе",
  admission: "Получить зачисление",
} as const;

function initialScreen(props: PlaceFrontierJourneyProps): PlaceFrontierScreenState {
  if (props.mode === "stored") return presentPlaceFrontierReadModel(props.initialReadModel);
  const running = createPlaceFrontierRunningState(props.runId);
  return props.mode === "interrupted"
    ? failPlaceFrontierScreen(running, INTERRUPTED_ERROR)
    : running;
}

function retryIdentity(props: PlaceFrontierJourneyProps): {
  readonly profileId: string;
  readonly preferenceProfileId: string;
} | undefined {
  if (props.mode === "live") {
    return { profileId: props.profileId, preferenceProfileId: props.preferenceProfileId };
  }
  if (props.mode === "stored") {
    return {
      profileId: props.initialReadModel.rankingSnapshot.profileSnapshotId,
      preferenceProfileId: props.initialReadModel.rankingSnapshot.preferenceProfileSnapshotId,
    };
  }
  return undefined;
}

function ReasonLinks({ reasons }: {
  readonly reasons: PlaceFrontierCountryCard["formalVerdict"]["reasons"];
}) {
  return (
    <>
      <section aria-label="Evidence">
        <h4>Evidence</h4>
        {reasons.flatMap((reason) => reason.evidence.map((reference) => (
          <a href={reference.navigationUrl} key={`${reason.code}:${reference.artifactId}`}>
            {reference.sourceId} · {reference.locator}
          </a>
        )))}
      </section>
      <section aria-label="Проверьте вручную">
        <h4>Проверьте вручную</h4>
        {reasons.flatMap((reason) => reason.navigation.map((link) => (
          <a href={link.url} key={`${reason.code}:${link.label}:${link.url}`}>{link.label}</a>
        )))}
      </section>
    </>
  );
}

function FormalReasons({ reasons }: {
  readonly reasons: PlaceFrontierCountryCard["formalVerdict"]["reasons"];
}) {
  return (
    <section>
      <h4>Причины</h4>
      <ul>
        {reasons.map((reason) => (
          <li key={reason.code}>
            <strong>{reason.code}</strong>: {reason.summary}
            {reason.claimIds.length === 0 ? null : ` · Claims: ${reason.claimIds.join(", ")}`}
          </li>
        ))}
      </ul>
      <ReasonLinks reasons={reasons} />
    </section>
  );
}

function CountryCard({ card }: { readonly card: PlaceFrontierCountryCard }) {
  const verdict = card.formalVerdict;
  return (
    <article className="place-frontier-card">
      <header>
        <p>{card.country.flag} Место {card.rank}</p>
        <h3>{card.country.label}</h3>
        <p>{verdict.marker}</p>
      </header>
      <dl>
        <div><dt>Релевантность</dt><dd>{card.relevance}</dd></div>
        <div><dt>Покрытие</dt><dd>{card.coverage}</dd></div>
        <div><dt>Вердикт на дату</dt><dd>{verdict.verdictAsOf}</dd></div>
        <div><dt>Последняя проверка</dt><dd>{card.lastCheckedAt}</dd></div>
        <div><dt>Обновление знаний</dt><dd>{card.knowledgeUpdatedAt ?? "Нет"}</dd></div>
      </dl>
      <section>
        <h4>Вклад предпочтений</h4>
        <ul>
          {card.contributions.map((contribution) => (
            <li key={contribution.criterionId}>
              {contribution.criterionId}: {contribution.state} · effective {contribution.effectiveMatch}
              {" · contribution "}{contribution.weightedContribution}
              {contribution.observationId === undefined ? null : ` · ${contribution.observationId}`}
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h4>Формальные маршруты</h4>
        {verdict.routeOutcomes.map((route) => (
          <article className="place-frontier-card__route" key={route.routeId}>
            <h5>{route.routeId}</h5>
            <p>{route.status}</p>
            <p>
              Rules: {route.ruleEffectiveFrom ?? "Не определено"}
              {route.ruleEffectiveTo === undefined ? null : ` — ${route.ruleEffectiveTo}`}
            </p>
            <p>Evidence snapshots: {route.evidenceSnapshotIds.join(", ") || "Нет"}</p>
            <FormalReasons reasons={route.reasons} />
            {route.proceduralActions.length === 0 ? null : (
              <ul>{route.proceduralActions.map((action) => (
                <li key={action.kind}>{ACTION_LABELS[action.kind]} · не выполнено</li>
              ))}</ul>
            )}
            {route.contingentActions.length === 0 ? null : (
              <ul>{route.contingentActions.map((action) => (
                <li key={action.kind}>{ACTION_LABELS[action.kind]} · ещё не получено</li>
              ))}</ul>
            )}
          </article>
        ))}
      </section>
      <section>
        <h4>Полнота catalog</h4>
        {verdict.catalogCompleteness.status === "verified" ? (
          <dl>
            <div><dt>Ревизия</dt><dd>{verdict.catalogCompleteness.attestation.catalogRevisionId}</dd></div>
            <div><dt>Jurisdiction</dt><dd>{verdict.catalogCompleteness.attestation.jurisdiction}</dd></div>
            <div><dt>Орган</dt><dd>{verdict.catalogCompleteness.attestation.authority}</dd></div>
            <div><dt>Scope</dt><dd>{verdict.catalogCompleteness.attestation.scopeKind}</dd></div>
            <div><dt>Profile</dt><dd>{verdict.catalogCompleteness.attestation.profileSnapshotId}</dd></div>
            <div><dt>Validator</dt><dd>{verdict.catalogCompleteness.attestation.validatorVersion}</dd></div>
            <div><dt>Effective from</dt><dd>{verdict.catalogCompleteness.attestation.effectiveFrom}</dd></div>
            <div><dt>Effective to</dt><dd>{verdict.catalogCompleteness.attestation.effectiveTo ?? "Без даты"}</dd></div>
            <div><dt>Evidence</dt><dd>{verdict.catalogCompleteness.attestation.evidenceSnapshotId}</dd></div>
            {verdict.catalogCompleteness.attestation.catalogRoutes.map((route) => (
              <div key={route.routeId}>
                <dt>Catalog route</dt>
                <dd>
                  {route.routeId} · {route.applicability}
                  {route.applicability === "excluded"
                    ? ` · ${route.exclusionCode} · ${route.claimIds.join(", ")}`
                    : ""}
                  {` · Evidence: ${route.evidence.map(({ artifactId }) => artifactId).join(", ")}`}
                </dd>
              </div>
            ))}
            <div>
              <dt>Catalog Evidence</dt>
              <dd>{verdict.catalogCompleteness.attestation.catalogEvidence
                .map(({ artifactId }) => artifactId).join(", ")}</dd>
            </div>
          </dl>
        ) : <p>{verdict.catalogCompleteness.reasonCode}</p>}
      </section>
      <FormalReasons reasons={verdict.reasons} />
      <dl>
        <div><dt>Evidence snapshot</dt><dd>{card.evidenceSnapshotId}</dd></div>
        <div><dt>Rules</dt><dd>{card.sourceAssessmentRulesVersion} · {verdict.rulesVersion}</dd></div>
        <div><dt>Ranking Knowledge</dt><dd>{card.rankingKnowledgeRevisionId ?? "Нет"}</dd></div>
        <div><dt>Current Knowledge</dt><dd>{card.currentKnowledgeRevisionId ?? "Нет"}</dd></div>
        <div><dt>Обновлено в run</dt><dd>{card.currentRunUpdatedRevisionId ?? "Нет"}</dd></div>
      </dl>
    </article>
  );
}

export function PlaceFrontierJourney(props: PlaceFrontierJourneyProps) {
  const initialGeneration = props.mode === "live" ? 1 : 0;
  const [screen, setScreen] = useState<PlaceFrontierScreenState>(() => initialScreen(props));
  const [activeStream, setActiveStream] = useState<ActiveStream | undefined>(() =>
    props.mode === "live" ? {
      generation: initialGeneration,
      handoff: props.streamHandoff ?? createPlaceFrontierStreamHandoff(props.stream),
      stream: props.stream,
    } : undefined);
  const [retryPending, setRetryPending] = useState(false);
  const [retryError, setRetryError] = useState<string>();
  const generation = useRef(initialGeneration);
  const screenCursor = useRef(screen);
  const streamConsumer = useRef<StreamConsumer | undefined>(undefined);
  const pendingHandoff = useRef(activeStream?.handoff);
  const stopConsumer = useRef<(reason: DOMException) => void>(
    (reason) => pendingHandoff.current?.cancel(reason),
  );
  const retryController = useRef<AbortController | undefined>(undefined);
  const mounted = useRef(false);
  const view = useMemo(() => projectPlaceFrontierView(screen), [screen]);
  const identity = retryIdentity(props);

  useEffect(() => {
    if (activeStream === undefined) return;
    const currentConsumer = streamConsumer.current;
    if (
      currentConsumer?.generation === activeStream.generation
      && currentConsumer.stream === activeStream.stream
    ) {
      currentConsumer.releaseToken = undefined;
      stopConsumer.current = currentConsumer.stop;
      return () => releaseConsumerAfterEffectReplay(currentConsumer);
    }
    currentConsumer?.stop(new DOMException("Frontier stream superseded", "AbortError"));
    const adoptedStream = activeStream.handoff.adopt();
    if (adoptedStream === undefined) return;
    if (pendingHandoff.current === activeStream.handoff) pendingHandoff.current = undefined;
    const controller = new AbortController();
    const iterator = decodePlaceFrontierStream(adoptedStream, controller.signal);
    let stopped = false;
    const consumer: StreamConsumer = {
      ...activeStream,
      stop: (reason) => {
        if (stopped) return;
        stopped = true;
        if (streamConsumer.current === consumer) streamConsumer.current = undefined;
        if (stopConsumer.current === consumer.stop) stopConsumer.current = () => undefined;
        controller.abort(reason);
        void iterator.return(undefined).catch(() => undefined);
      },
    };
    streamConsumer.current = consumer;
    stopConsumer.current = consumer.stop;
    const consume = async () => {
      try {
        for await (const event of iterator) {
          if (generation.current !== activeStream.generation) return;
          const next = reducePlaceFrontierScreenEvent(screenCursor.current, event);
          screenCursor.current = next;
          setScreen(next);
        }
      } catch {
        if (generation.current === activeStream.generation && !controller.signal.aborted) {
          const failed = failPlaceFrontierScreen(screenCursor.current, TRANSPORT_ERROR);
          screenCursor.current = failed;
          setScreen(failed);
        }
      }
    };
    void consume();
    return () => releaseConsumerAfterEffectReplay(consumer);
  }, [activeStream]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      queueMicrotask(() => {
        if (mounted.current) return;
        generation.current += 1;
        stopConsumer.current(new DOMException("Frontier screen unmounted", "AbortError"));
        retryController.current?.abort(new DOMException("Frontier screen unmounted", "AbortError"));
      });
    };
  }, []);

  const retry = () => {
    if (identity === undefined || retryPending) return;
    const previousRunId = screen.runId;
    const nextGeneration = generation.current + 1;
    generation.current = nextGeneration;
    stopConsumer.current(new DOMException("Frontier stream superseded", "AbortError"));
    retryController.current?.abort(new DOMException("Retry superseded", "AbortError"));
    const controller = new AbortController();
    retryController.current = controller;
    setRetryPending(true);
    setRetryError(undefined);
    void (async () => {
      let openedHandoff: PlaceFrontierStreamHandoff | undefined;
      try {
        const response = await fetch("/api/place-frontier", {
          body: JSON.stringify(identity),
          headers: { "content-type": "application/json" },
          method: "POST",
          signal: controller.signal,
        });
        const opened = openPlaceFrontierStreamResponse(response, identity);
        openedHandoff = createPlaceFrontierStreamHandoff(opened.stream);
        pendingHandoff.current = openedHandoff;
        stopConsumer.current = openedHandoff.cancel;
        if (opened.runId === previousRunId) throw new Error("retry_reused_run");
        if (generation.current !== nextGeneration) {
          openedHandoff.cancel(new DOMException("Retry superseded", "AbortError"));
          openedHandoff = undefined;
          return;
        }
        replacePlaceFrontierRunUrl(opened.runId);
        const running = createPlaceFrontierRunningState(opened.runId);
        screenCursor.current = running;
        setScreen(running);
        setActiveStream({
          generation: nextGeneration,
          handoff: openedHandoff,
          stream: opened.stream,
        });
        openedHandoff = undefined;
      } catch {
        openedHandoff?.cancel(new DOMException("Retry response rejected", "AbortError"));
        if (generation.current === nextGeneration && !controller.signal.aborted) {
          setRetryError(RETRY_ERROR);
        }
      } finally {
        if (generation.current === nextGeneration) setRetryPending(false);
        if (retryController.current === controller) retryController.current = undefined;
      }
    })();
  };

  const status = view.summary?.preliminary === false
    ? "green" as const
    : view.summary ? "yellow" as const : "pending" as const;
  return (
    <ProductShell
      activeDestination="research"
      context={{
        route: "Россия → страны",
        branch: "Проверка стран",
        snapshot: view.snapshotId ?? "Создаётся",
        status,
      }}
      globe={view.globe}
      globeMode={view.globeMode}
      onDestinationChange={() => undefined}
    >
      <section
        aria-label="Поиск формально доступных стран"
        className={`place-frontier-journey place-frontier-journey--${view.globeMode}`}
      >
        <ResearchWorkspace
          candidates={view.markers}
          mode={status}
          progress={view.progress}
          progressAnnouncement={view.announcement}
          scope="country-frontier"
        />
        {view.summary === undefined ? null : (
          <section className="place-frontier-summary">
            <p className="eyebrow">{view.summary.preliminary ? "Предварительный результат" : "Результат"}</p>
            <h2>{view.summary.composition.green} формально доступны / {view.summary.composition.yellow} требуют проверки</h2>
            {view.summary.stopCondition === "installed_coverage_exhausted" ? (
              <p>Установленное покрытие исчерпано; результат может содержать меньше пяти стран.</p>
            ) : null}
          </section>
        )}
        {view.cards.length === 0 ? null : (
          <section aria-label="Карточки стран" className="place-frontier-cards">
            {view.cards.map((card) => <CountryCard card={card} key={card.country.countryCode} />)}
          </section>
        )}
        {view.transportError === undefined && retryError === undefined && identity === undefined ? null : (
          <section className="place-frontier-journey__transport place-frontier-journey__retry">
            {view.transportError === undefined ? null : <p role="alert">{view.transportError}</p>}
            {retryError === undefined ? null : <p role="alert">{retryError}</p>}
            {identity === undefined ? (
              <button onClick={() => window.location.reload()} type="button">Перезагрузить страницу</button>
            ) : (
              <button disabled={retryPending} onClick={retry} type="button">
                {retryPending ? "Повторяем…" : "Повторить проверку"}
              </button>
            )}
          </section>
        )}
      </section>
    </ProductShell>
  );
}
