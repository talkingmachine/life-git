"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import type { CountryResolutionReadModel } from "../../application/country-resolution";
import type { PlaceFrontierReadModel } from "../../application/place-frontier";
import {
  createCountryResolutionStreamHandoff,
  decodeCountryResolutionStream,
  normalizeCountryResolutionReadModel,
  openCountryResolutionStreamResponse,
  type CountryResolutionStreamHandoff,
} from "../country-resolution-stream";
import {
  beginCountryResolutionContinuation,
  failCountryResolutionContinuation,
  presentCountryResolutionReadModel,
  projectCountryResolutionView,
  reduceCountryResolutionContinuationEvent,
  type CountryResolutionScreenState,
} from "../country-resolution-view-model";
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
import { replaceCountryResolutionRunUrl, replacePlaceFrontierRunUrl } from "../run-url";
import type {
  ResearchCandidate,
  WorkspaceGlobePresentation,
} from "../research-map/contracts";
import { createProductGlobeRoute } from "../research-map/product-route";
import { CountryResolutionPanel } from "./CountryResolutionPanel";
import { ProductShell } from "./ProductShell";
import { ResearchWorkspace } from "./ResearchWorkspace";

export interface PlaceFrontierLiveInput {
  readonly runId: string;
  readonly profileId: string;
  readonly preferenceProfileId: string;
  readonly stream: ReadableStream<Uint8Array>;
  readonly streamHandoff?: PlaceFrontierStreamHandoff;
}

export type PlaceFrontierJourneyMode =
  | { readonly kind: "automatic-live"; readonly automatic: PlaceFrontierLiveInput }
  | { readonly kind: "automatic-stored"; readonly readModel: PlaceFrontierReadModel }
  | { readonly kind: "resolution-stored"; readonly readModel: CountryResolutionReadModel };

type LegacyPlaceFrontierJourneyProps =
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

export type PlaceFrontierJourneyProps =
  (| { readonly mode: PlaceFrontierJourneyMode }
    | LegacyPlaceFrontierJourneyProps) & {
    readonly onReload?: () => void;
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

interface ActiveResolutionStream {
  readonly generation: number;
  readonly handoff: CountryResolutionStreamHandoff;
  readonly stream: ReadableStream<Uint8Array>;
}

interface ResolutionStreamConsumer extends ActiveResolutionStream {
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

function releaseResolutionConsumerAfterEffectReplay(
  consumer: ResolutionStreamConsumer,
): void {
  const releaseToken = {};
  consumer.releaseToken = releaseToken;
  queueMicrotask(() => {
    if (consumer.releaseToken === releaseToken) {
      consumer.stop(new DOMException("Resolution screen stopped consuming", "AbortError"));
    }
  });
}

const TRANSPORT_ERROR = "Поток проверки прерван. Доменный вывод не сформирован.";
const INTERRUPTED_ERROR = "Запуск был прерван до появления проверенного снимка.";
const RETRY_ERROR = "Повторная проверка не запущена. Предыдущая история сохранена.";
const RESOLUTION_START_ERROR = "Разрешение неопределённости не открыто. Автоматический результат сохранён.";
const RESOLUTION_DECISION_ERROR = "Решение не подтверждено. Цвет страны не изменён.";
const RESOLUTION_CONTINUE_ERROR = "Проверка замены прервана. Сохранённая история не изменена.";

const ACTION_LABELS = {
  insurance: "Оформить медицинскую страховку",
  registration: "Выполнить регистрацию",
  document_submission: "Подать документы",
  job_offer: "Получить предложение о работе",
  admission: "Получить зачисление",
} as const;

function normalizedMode(props: PlaceFrontierJourneyProps):
  | PlaceFrontierJourneyMode
  | { readonly kind: "automatic-interrupted"; readonly runId: string } {
  if (typeof props.mode === "object") return props.mode;
  if (props.mode === "live") {
    return {
      kind: "automatic-live",
      automatic: {
        runId: props.runId,
        profileId: props.profileId,
        preferenceProfileId: props.preferenceProfileId,
        stream: props.stream,
        ...(props.streamHandoff === undefined ? {} : { streamHandoff: props.streamHandoff }),
      },
    };
  }
  if (props.mode === "stored") {
    return { kind: "automatic-stored", readModel: props.initialReadModel };
  }
  return { kind: "automatic-interrupted", runId: props.runId };
}

function automaticReadModel(
  mode: ReturnType<typeof normalizedMode>,
): PlaceFrontierReadModel | undefined {
  if (mode.kind === "automatic-stored") return mode.readModel;
  if (mode.kind === "resolution-stored") return mode.readModel.automaticFrontier;
  return undefined;
}

function automaticRunId(mode: ReturnType<typeof normalizedMode>): string {
  if (mode.kind === "automatic-live") return mode.automatic.runId;
  if (mode.kind === "automatic-interrupted") return mode.runId;
  return automaticReadModel(mode)!.runId;
}

function initialScreen(mode: ReturnType<typeof normalizedMode>): PlaceFrontierScreenState {
  const stored = automaticReadModel(mode);
  if (stored !== undefined) return presentPlaceFrontierReadModel(stored);
  const running = createPlaceFrontierRunningState(automaticRunId(mode));
  return mode.kind === "automatic-interrupted"
    ? failPlaceFrontierScreen(running, INTERRUPTED_ERROR)
    : running;
}

function retryIdentity(mode: ReturnType<typeof normalizedMode>): {
  readonly profileId: string;
  readonly preferenceProfileId: string;
} | undefined {
  if (mode.kind === "automatic-live") {
    return {
      profileId: mode.automatic.profileId,
      preferenceProfileId: mode.automatic.preferenceProfileId,
    };
  }
  const stored = automaticReadModel(mode);
  if (stored !== undefined) {
    return {
      profileId: stored.rankingSnapshot.profileSnapshotId,
      preferenceProfileId: stored.rankingSnapshot.preferenceProfileSnapshotId,
    };
  }
  return undefined;
}

async function openCountryResolutionJson(response: Response): Promise<CountryResolutionReadModel> {
  if (!response.ok) throw new Error("country_resolution_request_failed");
  if (response.headers.get("content-type") !== "application/json; charset=utf-8") {
    throw new Error("invalid_country_resolution_content_type");
  }
  return normalizeCountryResolutionReadModel(await response.json());
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
  const mode = useMemo(() => normalizedMode(props), [props]);
  const initialGeneration = mode.kind === "automatic-live" ? 1 : 0;
  const [screen, setScreen] = useState<PlaceFrontierScreenState>(() => initialScreen(mode));
  const [resolutionScreen, setResolutionScreen] = useState<CountryResolutionScreenState | undefined>(
    () => mode.kind === "resolution-stored"
      ? presentCountryResolutionReadModel(mode.readModel)
      : undefined,
  );
  const [activeStream, setActiveStream] = useState<ActiveStream | undefined>(() =>
    mode.kind === "automatic-live" ? {
      generation: initialGeneration,
      handoff: mode.automatic.streamHandoff ??
        createPlaceFrontierStreamHandoff(mode.automatic.stream),
      stream: mode.automatic.stream,
    } : undefined);
  const [activeResolutionStream, setActiveResolutionStream] =
    useState<ActiveResolutionStream | undefined>();
  const [retryPending, setRetryPending] = useState(false);
  const [retryError, setRetryError] = useState<string>();
  const [resolutionStartError, setResolutionStartError] = useState<string>();
  const [decisionPending, setDecisionPending] = useState(false);
  const [decisionError, setDecisionError] = useState<string>();
  const generation = useRef(initialGeneration);
  const screenCursor = useRef(screen);
  const resolutionCursor = useRef(resolutionScreen);
  const streamConsumer = useRef<StreamConsumer | undefined>(undefined);
  const resolutionStreamConsumer = useRef<ResolutionStreamConsumer | undefined>(undefined);
  const pendingHandoff = useRef(activeStream?.handoff);
  const pendingResolutionHandoff = useRef<CountryResolutionStreamHandoff | undefined>(undefined);
  const stopConsumer = useRef<(reason: DOMException) => void>(
    (reason) => pendingHandoff.current?.cancel(reason),
  );
  const stopResolutionConsumer = useRef<(reason: DOMException) => void>(
    (reason) => pendingResolutionHandoff.current?.cancel(reason),
  );
  const retryController = useRef<AbortController | undefined>(undefined);
  const resolutionController = useRef<AbortController | undefined>(undefined);
  const resolutionStartSnapshotId = useRef<string | undefined>(
    mode.kind === "resolution-stored"
      ? mode.readModel.revision.automaticShortlistSnapshotId
      : undefined,
  );
  const decisionRequest = useRef<{
    readonly payload: string;
    readonly countryCode: string;
    readonly decision: "accepted_at_own_risk" | "rejected";
  } | undefined>(undefined);
  const mounted = useRef(false);
  const view = useMemo(() => projectPlaceFrontierView(screen), [screen]);
  const resolutionView = useMemo(() => resolutionScreen === undefined
    ? undefined
    : projectCountryResolutionView(resolutionScreen), [resolutionScreen]);
  const resolutionCandidates = useMemo<readonly ResearchCandidate[] | undefined>(() => {
    if (resolutionView === undefined) return undefined;
    const automaticByCode = new Map(view.markers.map((candidate) => [candidate.id, candidate]));
    return resolutionView.candidates.map((candidate) => {
      const automatic = automaticByCode.get(candidate.country.countryCode);
      return {
        ...(automatic ?? {
          id: candidate.country.countryCode,
          label: candidate.country.label,
          kind: "country" as const,
          country: candidate.country.label,
          flag: candidate.country.flag,
          coordinate: candidate.country.coordinate,
          description: "Проверяем формальную доступность долгосрочного проживания.",
        }),
        status: candidate.status,
        statusLabel: candidate.statusLabel,
        ...(candidate.summary === undefined && candidate.officialUrls.length === 0 &&
          candidate.manualCheckLinks.length === 0 ? {} : {
            reason: {
              summary: candidate.summary ?? "Формальные факты требуют решения пользователя.",
              ...(candidate.officialUrls.length === 0 ? {} : {
                officialUrl: candidate.officialUrls[0],
                officialUrls: candidate.officialUrls,
              }),
              ...(candidate.manualCheckLinks.length === 0 ? {} : {
                manualCheckLinks: candidate.manualCheckLinks,
              }),
            },
          }),
      };
    });
  }, [resolutionView, view.markers]);
  const activeGlobe = useMemo<WorkspaceGlobePresentation>(() => {
    if (resolutionCandidates === undefined) return view.globe;
    const routes = resolutionCandidates.map((candidate) => ({
      ...createProductGlobeRoute(view.globe.origin, candidate, screen.runId),
      markerVisible: true,
    }));
    const activeReplacement = resolutionScreen?.kind === "continuing"
      ? resolutionScreen.stream.activeReplacement
      : undefined;
    return {
      ...view.globe,
      ...(activeReplacement === undefined ? { activeFlight: undefined } : {
        activeFlight: routes.find(({ key }) =>
          key.endsWith(`:${activeReplacement.country.countryCode}`)),
      }),
      overview: {
        coordinates: [
          view.globe.origin.coordinate,
          ...resolutionCandidates.map(({ coordinate }) => coordinate),
        ],
        key: view.globe.overview.key,
      },
      routes,
    };
  }, [resolutionCandidates, resolutionScreen, screen.runId, view.globe]);
  const identity = retryIdentity(mode);
  const reload = props.onReload ?? (() => window.location.reload());

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
    if (activeResolutionStream === undefined || resolutionCursor.current === undefined) return;
    const currentConsumer = resolutionStreamConsumer.current;
    if (currentConsumer?.generation === activeResolutionStream.generation &&
      currentConsumer.stream === activeResolutionStream.stream) {
      currentConsumer.releaseToken = undefined;
      stopResolutionConsumer.current = currentConsumer.stop;
      return () => releaseResolutionConsumerAfterEffectReplay(currentConsumer);
    }
    currentConsumer?.stop(new DOMException("Resolution stream superseded", "AbortError"));
    const adoptedStream = activeResolutionStream.handoff.adopt();
    if (adoptedStream === undefined) return;
    if (pendingResolutionHandoff.current === activeResolutionStream.handoff) {
      pendingResolutionHandoff.current = undefined;
    }
    const controller = new AbortController();
    const initial = resolutionCursor.current.readModel;
    const iterator = decodeCountryResolutionStream(adoptedStream, initial, controller.signal);
    let stopped = false;
    const consumer: ResolutionStreamConsumer = {
      ...activeResolutionStream,
      stop: (reason) => {
        if (stopped) return;
        stopped = true;
        if (resolutionStreamConsumer.current === consumer) {
          resolutionStreamConsumer.current = undefined;
        }
        if (stopResolutionConsumer.current === consumer.stop) {
          stopResolutionConsumer.current = () => undefined;
        }
        controller.abort(reason);
        void iterator.return(undefined).catch(() => undefined);
      },
    };
    resolutionStreamConsumer.current = consumer;
    stopResolutionConsumer.current = consumer.stop;
    const consume = async () => {
      try {
        for await (const event of iterator) {
          if (generation.current !== activeResolutionStream.generation ||
            resolutionCursor.current === undefined) return;
          const next = reduceCountryResolutionContinuationEvent(
            resolutionCursor.current,
            event,
          );
          resolutionCursor.current = next;
          setResolutionScreen(next);
        }
      } catch {
        if (generation.current === activeResolutionStream.generation &&
          !controller.signal.aborted && resolutionCursor.current !== undefined) {
          const failed = failCountryResolutionContinuation(
            resolutionCursor.current,
            RESOLUTION_CONTINUE_ERROR,
          );
          resolutionCursor.current = failed;
          setResolutionScreen(failed);
        }
      }
    };
    void consume();
    return () => releaseResolutionConsumerAfterEffectReplay(consumer);
  }, [activeResolutionStream]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      queueMicrotask(() => {
        if (mounted.current) return;
        generation.current += 1;
        stopConsumer.current(new DOMException("Frontier screen unmounted", "AbortError"));
        stopResolutionConsumer.current(
          new DOMException("Resolution screen unmounted", "AbortError"),
        );
        retryController.current?.abort(new DOMException("Frontier screen unmounted", "AbortError"));
        resolutionController.current?.abort(
          new DOMException("Resolution screen unmounted", "AbortError"),
        );
      });
    };
  }, []);

  useEffect(() => {
    if (screen.kind !== "completed" || resolutionScreen !== undefined) return;
    const snapshotId = screen.readModel.shortlistSnapshot.id;
    if (resolutionStartSnapshotId.current === snapshotId) return;
    resolutionStartSnapshotId.current = snapshotId;
    const controller = new AbortController();
    resolutionController.current?.abort(
      new DOMException("Resolution start superseded", "AbortError"),
    );
    resolutionController.current = controller;
    void (async () => {
      try {
        const response = await fetch("/api/country-resolution/start", {
          body: JSON.stringify({ automaticShortlistSnapshotId: snapshotId }),
          headers: { "content-type": "application/json" },
          method: "POST",
          signal: controller.signal,
        });
        const readModel = await openCountryResolutionJson(response);
        if (controller.signal.aborted || !mounted.current) return;
        replaceCountryResolutionRunUrl(readModel.resolutionRunId);
        const next = presentCountryResolutionReadModel(readModel);
        resolutionCursor.current = next;
        setResolutionScreen(next);
      } catch {
        if (!controller.signal.aborted && mounted.current) {
          setResolutionStartError(RESOLUTION_START_ERROR);
        }
      } finally {
        if (resolutionController.current === controller) {
          resolutionController.current = undefined;
        }
      }
    })();
  }, [resolutionScreen, screen]);

  const continueResolution = (readModel: CountryResolutionReadModel) => {
    if (readModel.revision.kind !== "working" ||
      readModel.revision.phase !== "replacement_required") return;
    const nextGeneration = generation.current + 1;
    generation.current = nextGeneration;
    stopResolutionConsumer.current(
      new DOMException("Resolution stream superseded", "AbortError"),
    );
    const controller = new AbortController();
    resolutionController.current?.abort(
      new DOMException("Resolution request superseded", "AbortError"),
    );
    resolutionController.current = controller;
    void (async () => {
      let openedHandoff: CountryResolutionStreamHandoff | undefined;
      try {
        const expected = {
          resolutionRunId: readModel.resolutionRunId,
          expectedRevisionId: readModel.revision.id,
        };
        const response = await fetch("/api/country-resolution/continue", {
          body: JSON.stringify(expected),
          headers: { "content-type": "application/json" },
          method: "POST",
          signal: controller.signal,
        });
        const opened = openCountryResolutionStreamResponse(response, expected);
        openedHandoff = createCountryResolutionStreamHandoff(opened.stream);
        pendingResolutionHandoff.current = openedHandoff;
        stopResolutionConsumer.current = openedHandoff.cancel;
        if (generation.current !== nextGeneration || !mounted.current) {
          openedHandoff.cancel(
            new DOMException("Resolution continuation superseded", "AbortError"),
          );
          openedHandoff = undefined;
          return;
        }
        replaceCountryResolutionRunUrl(opened.resolutionRunId);
        const continuing = beginCountryResolutionContinuation(readModel);
        resolutionCursor.current = continuing;
        setResolutionScreen(continuing);
        setActiveResolutionStream({
          generation: nextGeneration,
          handoff: openedHandoff,
          stream: opened.stream,
        });
        openedHandoff = undefined;
      } catch {
        openedHandoff?.cancel(
          new DOMException("Resolution continuation rejected", "AbortError"),
        );
        if (!controller.signal.aborted && mounted.current) {
          const stable = presentCountryResolutionReadModel(readModel);
          const failed = failCountryResolutionContinuation(
            beginCountryResolutionContinuation(stable.readModel),
            RESOLUTION_CONTINUE_ERROR,
          );
          resolutionCursor.current = failed;
          setResolutionScreen(failed);
        }
      } finally {
        if (resolutionController.current === controller) {
          resolutionController.current = undefined;
        }
      }
    })();
  };

  const decide = (decision: "accepted_at_own_risk" | "rejected") => {
    if (resolutionScreen === undefined || decisionPending) return;
    const readModel = resolutionScreen.readModel;
    const projected = projectCountryResolutionView(resolutionScreen);
    if (readModel.revision.kind !== "working" || projected.currentPrompt === undefined) return;
    const current = decisionRequest.current;
    const matchesRetry = current?.countryCode === projected.currentPrompt.countryCode &&
      current.decision === decision;
    const payload = matchesRetry ? current.payload : JSON.stringify({
      resolutionRunId: readModel.resolutionRunId,
      expectedRevisionId: readModel.revision.id,
      countryCode: projected.currentPrompt.countryCode,
      decision,
      warningCopyVersion: projected.currentPrompt.warningCopyVersion,
      commandId: crypto.randomUUID(),
    });
    decisionRequest.current = {
      payload,
      countryCode: projected.currentPrompt.countryCode,
      decision,
    };
    setDecisionPending(true);
    setDecisionError(undefined);
    void (async () => {
      try {
        const response = await fetch("/api/country-resolution/decision", {
          body: payload,
          headers: { "content-type": "application/json" },
          method: "POST",
        });
        const decided = await openCountryResolutionJson(response);
        if (!mounted.current) return;
        decisionRequest.current = undefined;
        replaceCountryResolutionRunUrl(decided.resolutionRunId);
        const stable = presentCountryResolutionReadModel(decided);
        resolutionCursor.current = stable;
        setResolutionScreen(stable);
        if (decision === "rejected" && decided.revision.kind === "working" &&
          decided.revision.phase === "replacement_required") {
          continueResolution(decided);
        }
      } catch {
        if (mounted.current) setDecisionError(RESOLUTION_DECISION_ERROR);
      } finally {
        if (mounted.current) setDecisionPending(false);
      }
    })();
  };

  const retry = () => {
    if (identity === undefined || retryPending) return;
    const previousRunId = screen.runId;
    const nextGeneration = generation.current + 1;
    generation.current = nextGeneration;
    resolutionController.current?.abort(
      new DOMException("Automatic retry superseded resolution start", "AbortError"),
    );
    resolutionController.current = undefined;
    resolutionStartSnapshotId.current = undefined;
    setResolutionStartError(undefined);
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
  const activeGlobeMode = resolutionView?.globeMode ?? view.globeMode;
  const activeStatus = resolutionView?.globeMode === "collapsed"
    ? "green" as const
    : resolutionView?.currentPrompt !== undefined
      ? "yellow" as const
      : status;
  const resolutionProgress = resolutionScreen === undefined ||
    resolutionScreen.kind === "stable"
    ? []
    : resolutionScreen.stream.progress.map((item, index, items) => ({
        key: `resolution-progress-${index}`,
        label: item.label,
        ...(item.detail === undefined ? {} : { detail: item.detail }),
        ...(item.sourceUrl === undefined ? {} : { sourceUrl: item.sourceUrl }),
        current: index === items.length - 1,
      }));
  const resolutionAnnouncement = resolutionProgress.at(-1)?.label;
  return (
    <ProductShell
      activeDestination="research"
      context={{
        route: "Россия → страны",
        branch: "Проверка стран",
        snapshot: view.snapshotId ?? "Создаётся",
        status: activeStatus,
      }}
      globe={activeGlobe}
      globeMode={activeGlobeMode}
      onDestinationChange={() => undefined}
    >
      <section
        aria-label="Поиск формально доступных стран"
        className={`place-frontier-journey place-frontier-journey--${activeGlobeMode}`}
      >
        <ResearchWorkspace
          candidates={resolutionCandidates ?? view.markers}
          mode={activeStatus}
          progress={resolutionScreen === undefined ? view.progress : resolutionProgress}
          progressAnnouncement={resolutionScreen === undefined
            ? view.announcement
            : resolutionAnnouncement}
          scope="country-frontier"
        />
        {resolutionScreen !== undefined && resolutionView !== undefined ? (
          <CountryResolutionPanel
            decisionError={decisionError}
            decisionPending={decisionPending}
            onContinue={() => continueResolution(resolutionScreen.readModel)}
            onDecision={decide}
            onReload={reload}
            readModel={resolutionScreen.readModel}
            view={resolutionView}
          />
        ) : view.summary === undefined ? null : (
          <section className="place-frontier-summary">
            <p className="eyebrow">{view.summary.preliminary ? "Предварительный результат" : "Результат"}</p>
            <h2>{view.summary.composition.green} формально доступны / {view.summary.composition.yellow} требуют проверки</h2>
            {view.summary.stopCondition === "installed_coverage_exhausted" ? (
              <p>Установленное покрытие исчерпано; результат может содержать меньше пяти стран.</p>
            ) : null}
          </section>
        )}
        {resolutionScreen !== undefined || view.cards.length === 0 ? null : (
          <section aria-label="Карточки стран" className="place-frontier-cards">
            {view.cards.map((card) => <CountryCard card={card} key={card.country.countryCode} />)}
          </section>
        )}
        {resolutionScreen !== undefined || (
          view.transportError === undefined && retryError === undefined &&
          resolutionStartError === undefined && identity === undefined
        ) ? null : (
          <section className="place-frontier-journey__transport place-frontier-journey__retry">
            {view.transportError === undefined ? null : <p role="alert">{view.transportError}</p>}
            {retryError === undefined ? null : <p role="alert">{retryError}</p>}
            {resolutionStartError === undefined ? null : <p role="alert">{resolutionStartError}</p>}
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
