"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import type {
  CityFrontierSetupReadModel,
} from "../../application/city-frontier";
import type {
  CityFrontierReadModel,
} from "../../application/city-frontier-contracts";
import {
  createCityFrontierStreamHandoff,
  decodeCityFrontierStream,
  openCityFrontierStreamResponse,
  type CityFrontierStreamHandoff,
} from "../city-frontier-stream";
import {
  beginCityFrontierContinuation,
  failCityFrontierContinuation,
  presentCityFrontierReadModel,
  projectCityFrontierView,
  reduceCityFrontierContinuationEvent,
  type CityFrontierCardView,
  type CityFrontierScreenState,
} from "../city-frontier-view-model";
import { replaceCityFrontierRunUrl } from "../run-url";
import type {
  ResearchCandidate,
  ResearchProgressItem,
  WorkspaceGlobePresentation,
} from "../research-map/contracts";
import { createProductGlobeRoute, MOSCOW_ORIGIN } from "../research-map/product-route";
import { CityFrontierCards } from "./CityFrontierCards";
import { CityFrontierPanel } from "./CityFrontierPanel";
import { CityFrontierStart } from "./CityFrontierStart";
import { ProductShell } from "./ProductShell";
import { ResearchWorkspace } from "./ResearchWorkspace";
import { NEUTRAL_WORKSPACE_GLOBE_PRESENTATION } from "./WorkspaceGlobe";

export type CityFrontierJourneyMode =
  | { readonly kind: "setup"; readonly setup: CityFrontierSetupReadModel }
  | { readonly kind: "live"; readonly readModel: CityFrontierReadModel }
  | { readonly kind: "stored"; readonly readModel: CityFrontierReadModel };

export interface CityFrontierJourneyProps {
  readonly mode: CityFrontierJourneyMode;
  readonly onReload?: () => void;
}

interface ActiveContinuation {
  readonly generation: number;
  readonly handoff: CityFrontierStreamHandoff;
  readonly initialReadModel: CityFrontierReadModel;
  readonly stream: ReadableStream<Uint8Array>;
}

interface StreamConsumer extends ActiveContinuation {
  releaseToken?: object;
  readonly stop: (reason: DOMException) => void;
}

interface RetainedStartRequest {
  readonly criteriaKey: string;
  readonly payload: string;
}

interface RetainedContinueRequest {
  readonly identityKey: string;
  readonly payload: string;
}

interface RetainedSelectRequest {
  readonly cityId: string;
  readonly commandId: string;
  readonly identityKey: string;
  readonly payload: string;
  readonly terminalRevisionId: string;
}

interface CitySelectionEnvelope {
  readonly selection: unknown;
  readonly commit: unknown;
  readonly readModel: unknown;
}

const START_ERROR = "Поиск городов не запущен. Проверьте соединение и повторите попытку.";
const CONTINUE_ERROR = "Проверка города прервана. Сохранённая история не изменена.";
const STREAM_ERROR = "Поток проверки прерван. Сохранённое состояние требует проверки.";
const SELECT_ERROR = "Выбор города не сохранён. Сохранённая история не изменена.";

function releaseConsumerAfterEffectReplay(consumer: StreamConsumer): void {
  const releaseToken = {};
  consumer.releaseToken = releaseToken;
  queueMicrotask(() => {
    if (consumer.releaseToken === releaseToken) {
      consumer.stop(new DOMException("City frontier screen stopped consuming", "AbortError"));
    }
  });
}

async function openCityFrontierJson(response: Response): Promise<CityFrontierScreenState> {
  if (!response.ok) throw new Error("city_frontier_request_failed");
  if (response.headers.get("content-type") !== "application/json; charset=utf-8") {
    throw new Error("invalid_city_frontier_content_type");
  }
  return presentCityFrontierReadModel(await response.json());
}

function exactSelectionEnvelope(value: unknown): CitySelectionEnvelope {
  if (value === null || typeof value !== "object" || Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype) {
    throw new Error("invalid_city_selection_envelope");
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (keys.length !== 3 || keys[0] !== "commit" || keys[1] !== "readModel" ||
    keys[2] !== "selection") {
    throw new Error("invalid_city_selection_envelope");
  }
  return {
    selection: record.selection,
    commit: record.commit,
    readModel: record.readModel,
  };
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

async function openCitySelectionJson(
  response: Response,
  current: CityFrontierReadModel,
  request: RetainedSelectRequest,
): Promise<CityFrontierScreenState> {
  if (!response.ok) throw new Error("city_selection_request_failed");
  if (response.headers.get("content-type") !== "application/json; charset=utf-8") {
    throw new Error("invalid_city_selection_content_type");
  }
  const envelope = exactSelectionEnvelope(await response.json());
  const next = presentCityFrontierReadModel(envelope.readModel as CityFrontierReadModel);
  if (next.kind !== "stable" || next.readModel.runId !== current.runId ||
    next.readModel.revision.kind !== "terminal" ||
    next.readModel.revision.id !== request.terminalRevisionId) {
    throw new Error("invalid_city_selection_read_model_identity");
  }
  const returnedHistory = new Map<
    string,
    Array<CityFrontierReadModel["selections"][number]>
  >();
  for (const pair of next.readModel.selections) {
    const identity = JSON.stringify([pair.selection.id, pair.commit.id]);
    const matching = returnedHistory.get(identity) ?? [];
    matching.push(pair);
    returnedHistory.set(identity, matching);
  }
  const preservesSelectionHistory = current.selections.every((prior) => {
    const identity = JSON.stringify([prior.selection.id, prior.commit.id]);
    const preserved = returnedHistory.get(identity);
    return preserved?.length === 1 && canonicalJson(preserved[0]) === canonicalJson(prior);
  });
  if (!preservesSelectionHistory) {
    throw new Error("invalid_city_selection_history_replacement");
  }
  const matches = next.readModel.selections.filter(({ selection }) =>
    selection.commandId === request.commandId &&
    selection.cityId === request.cityId &&
    selection.terminalRevisionId === request.terminalRevisionId
  );
  if (matches.length !== 1) throw new Error("invalid_city_selection_history");
  const matched = matches[0]!;
  if (canonicalJson(envelope.selection) !== canonicalJson(matched.selection) ||
    canonicalJson(envelope.commit) !== canonicalJson(matched.commit)) {
    throw new Error("invalid_city_selection_result_binding");
  }
  return next;
}

function candidateReason(candidate: ReturnType<typeof projectCityFrontierView>["candidates"][number]):
ResearchCandidate["reason"] {
  if (candidate.sourceUnavailable === true) {
    return { summary: "Официальный источник недоступен, факт не подтверждён." };
  }
  if (candidate.status === "red") {
    return { summary: "Город исключён по обязательному критерию." };
  }
  if (candidate.status === "yellow") {
    return { summary: "По одному или нескольким критериям сохранены неполные данные." };
  }
  return undefined;
}

function researchCandidates(
  view: ReturnType<typeof projectCityFrontierView>,
): readonly ResearchCandidate[] {
  return view.candidates.map((candidate) => ({
    id: candidate.city.cityId,
    label: candidate.city.officialName,
    kind: "city",
    city: candidate.city.officialName,
    country: candidate.city.countryCode,
    flag: "🌐",
    coordinate: candidate.city.coordinate,
    description: "Проверяем четыре подтверждённых критерия города.",
    status: candidate.status,
    statusLabel: candidate.statusLabel,
    ...(candidateReason(candidate) === undefined ? {} : { reason: candidateReason(candidate) }),
  }));
}

function progressItems(
  view: ReturnType<typeof projectCityFrontierView>,
): readonly ResearchProgressItem[] {
  return view.progress.flatMap((event, index, events) => event.type !== "city_progress" ? [] : [{
    key: `${event.sequence}:${event.stage}`,
    label: event.stage,
    ...(event.sourceUrl === undefined ? {} : { sourceUrl: event.sourceUrl }),
    current: index === events.length - 1,
  }]);
}

function cityGlobe(
  runId: string,
  revisionCursor: number,
  candidates: readonly ResearchCandidate[],
): WorkspaceGlobePresentation {
  const routes = candidates.map((candidate) => ({
    ...createProductGlobeRoute(MOSCOW_ORIGIN, candidate, runId),
    markerVisible: true,
  }));
  return {
    activeFlight: routes.find(({ status }) => status === "pending"),
    ariaLabel: "3D Земля поиска городов",
    origin: MOSCOW_ORIGIN,
    overview: {
      coordinates: [MOSCOW_ORIGIN.coordinate, ...candidates.map(({ coordinate }) => coordinate)],
      key: revisionCursor,
    },
    routes,
  };
}

export function CityFrontierJourney({ mode, onReload }: CityFrontierJourneyProps) {
  const setup = mode.kind === "setup" ? mode.setup : undefined;
  const [screen, setScreen] = useState<CityFrontierScreenState | undefined>(() =>
    mode.kind === "setup" ? undefined : presentCityFrontierReadModel(mode.readModel));
  const [activeContinuation, setActiveContinuation] = useState<ActiveContinuation>();
  const [startPending, setStartPending] = useState(false);
  const [startError, setStartError] = useState<string>();
  const [continuePending, setContinuePending] = useState(false);
  const [continueError, setContinueError] = useState<string>();
  const [selectPendingCityId, setSelectPendingCityId] = useState<string>();
  const [selectError, setSelectError] = useState<string>();
  const mounted = useRef(false);
  const generation = useRef(0);
  const screenCursor = useRef(screen);
  const startController = useRef<AbortController | undefined>(undefined);
  const continueController = useRef<AbortController | undefined>(undefined);
  const selectController = useRef<AbortController | undefined>(undefined);
  const startRequest = useRef<RetainedStartRequest | undefined>(undefined);
  const continueRequest = useRef<RetainedContinueRequest | undefined>(undefined);
  const selectRequests = useRef(new Map<string, RetainedSelectRequest>());
  const pendingHandoff = useRef<CityFrontierStreamHandoff | undefined>(undefined);
  const consumerRef = useRef<StreamConsumer | undefined>(undefined);
  const stopConsumer = useRef<(reason: DOMException) => void>(
    (reason) => pendingHandoff.current?.cancel(reason),
  );
  const view = useMemo(() => screen === undefined ? undefined : projectCityFrontierView(screen),
    [screen]);
  const candidates = useMemo(() => view === undefined ? [] : researchCandidates(view), [view]);
  const progress = useMemo(() => view === undefined ? [] : progressItems(view), [view]);
  const globe = useMemo(() => screen === undefined
    ? NEUTRAL_WORKSPACE_GLOBE_PRESENTATION
    : cityGlobe(screen.readModel.runId, screen.readModel.revision.nextUncheckedRank, candidates),
  [candidates, screen]);
  const reload = onReload ?? (() => window.location.reload());

  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      queueMicrotask(() => {
        if (mounted.current) return;
        generation.current += 1;
        startController.current?.abort(
          new DOMException("City frontier start unmounted", "AbortError"),
        );
        continueController.current?.abort(
          new DOMException("City frontier continuation unmounted", "AbortError"),
        );
        selectController.current?.abort(
          new DOMException("City frontier selection unmounted", "AbortError"),
        );
        stopConsumer.current(
          new DOMException("City frontier screen unmounted", "AbortError"),
        );
      });
    };
  }, []);

  useEffect(() => {
    if (activeContinuation === undefined) return;
    const currentConsumer = consumerRef.current;
    if (currentConsumer?.generation === activeContinuation.generation &&
      currentConsumer.stream === activeContinuation.stream) {
      currentConsumer.releaseToken = undefined;
      stopConsumer.current = currentConsumer.stop;
      return () => releaseConsumerAfterEffectReplay(currentConsumer);
    }
    currentConsumer?.stop(new DOMException("City continuation superseded", "AbortError"));
    const adopted = activeContinuation.handoff.adopt();
    if (adopted === undefined) return;
    if (pendingHandoff.current === activeContinuation.handoff) pendingHandoff.current = undefined;
    const controller = new AbortController();
    const iterator = decodeCityFrontierStream(
      adopted,
      activeContinuation.initialReadModel,
      controller.signal,
    );
    let stopped = false;
    const consumer: StreamConsumer = {
      ...activeContinuation,
      stop: (reason) => {
        if (stopped) return;
        stopped = true;
        if (consumerRef.current === consumer) consumerRef.current = undefined;
        if (stopConsumer.current === consumer.stop) stopConsumer.current = () => undefined;
        controller.abort(reason);
        void iterator.return(undefined).catch(() => undefined);
      },
    };
    consumerRef.current = consumer;
    stopConsumer.current = consumer.stop;
    void (async () => {
      try {
        for await (const event of iterator) {
          if (!mounted.current || generation.current !== activeContinuation.generation ||
            screenCursor.current === undefined) return;
          const next = reduceCityFrontierContinuationEvent(screenCursor.current, event);
          if (event.type === "city_revision_committed" ||
            event.type === "city_continuation_completed" || event.type === "source_recovery_yellow") {
            continueRequest.current = undefined;
          }
          screenCursor.current = next;
          setScreen(next);
        }
      } catch {
        if (mounted.current && generation.current === activeContinuation.generation &&
          !controller.signal.aborted && screenCursor.current !== undefined) {
          const failed = failCityFrontierContinuation(screenCursor.current, STREAM_ERROR);
          screenCursor.current = failed;
          setScreen(failed);
        }
      }
    })();
    return () => releaseConsumerAfterEffectReplay(consumer);
  }, [activeContinuation]);

  const start = (criteria: CityFrontierSetupReadModel["criteriaDraft"]) => {
    if (setup === undefined || startPending) return;
    const criteriaKey = JSON.stringify(criteria);
    const retained = startRequest.current;
    const payload = retained?.criteriaKey === criteriaKey ? retained.payload : JSON.stringify({
      resolvedCountryShortlistRevisionId: setup.resolvedCountryShortlistRevisionId,
      countryCode: setup.countryCode,
      criteria,
      commandId: crypto.randomUUID(),
    });
    startRequest.current = { criteriaKey, payload };
    const controller = new AbortController();
    startController.current?.abort(new DOMException("City start superseded", "AbortError"));
    startController.current = controller;
    setStartPending(true);
    setStartError(undefined);
    void (async () => {
      try {
        const response = await fetch("/api/city-frontier/start", {
          body: payload,
          headers: { "content-type": "application/json" },
          method: "POST",
          signal: controller.signal,
        });
        const next = await openCityFrontierJson(response);
        if (controller.signal.aborted || !mounted.current) return;
        replaceCityFrontierRunUrl(next.readModel.runId);
        if (controller.signal.aborted || !mounted.current) return;
        startRequest.current = undefined;
        screenCursor.current = next;
        setScreen(next);
      } catch {
        if (!controller.signal.aborted && mounted.current) setStartError(START_ERROR);
      } finally {
        if (mounted.current && startController.current === controller) setStartPending(false);
        if (startController.current === controller) startController.current = undefined;
      }
    })();
  };

  const continueFrontier = () => {
    const current = screenCursor.current;
    const retryableTransportError = current?.kind === "transportError" &&
      current.stream.committedRevisionId === undefined;
    const retryableYellow = current?.kind === "continuing" && current.stream.yellowSource !== undefined;
    if (current === undefined || continuePending ||
      (current.kind !== "stable" && !retryableTransportError && !retryableYellow)) return;
    const readModel = current.readModel;
    if (readModel.revision.kind !== "working" ||
      readModel.catalog.rulesVersion !== "city-catalog@2") return;
    const nextGeneration = generation.current + 1;
    generation.current = nextGeneration;
    stopConsumer.current(new DOMException("City continuation superseded", "AbortError"));
    const controller = new AbortController();
    continueController.current?.abort(new DOMException("City request superseded", "AbortError"));
    continueController.current = controller;
    setContinuePending(true);
    setContinueError(undefined);
    void (async () => {
      let openedHandoff: CityFrontierStreamHandoff | undefined;
      try {
        const identityKey = `${readModel.runId}\u0000${readModel.revision.id}`;
        const retained = continueRequest.current;
        const payload = retained?.identityKey === identityKey
          ? retained.payload
          : JSON.stringify({
              runId: readModel.runId,
              expectedRevisionId: readModel.revision.id,
              commandId: crypto.randomUUID(),
            });
        continueRequest.current = { identityKey, payload };
        const response = await fetch("/api/city-frontier/continue", {
          body: payload,
          headers: { "content-type": "application/json" },
          method: "POST",
          signal: controller.signal,
        });
        const opened = openCityFrontierStreamResponse(response, {
          runId: readModel.runId,
          baseRevisionId: readModel.revision.id,
        });
        openedHandoff = createCityFrontierStreamHandoff(opened.stream);
        pendingHandoff.current = openedHandoff;
        stopConsumer.current = openedHandoff.cancel;
        if (controller.signal.aborted || !mounted.current ||
          generation.current !== nextGeneration) {
          openedHandoff.cancel(new DOMException("City continuation superseded", "AbortError"));
          openedHandoff = undefined;
          return;
        }
        replaceCityFrontierRunUrl(opened.runId);
        if (controller.signal.aborted || !mounted.current ||
          generation.current !== nextGeneration) {
          openedHandoff.cancel(new DOMException("City continuation superseded", "AbortError"));
          openedHandoff = undefined;
          return;
        }
        const continuing = beginCityFrontierContinuation(readModel);
        screenCursor.current = continuing;
        setScreen(continuing);
        setActiveContinuation({
          generation: nextGeneration,
          handoff: openedHandoff,
          initialReadModel: readModel,
          stream: opened.stream,
        });
        openedHandoff = undefined;
      } catch {
        openedHandoff?.cancel(new DOMException("City continuation rejected", "AbortError"));
        if (!controller.signal.aborted && mounted.current &&
          generation.current === nextGeneration) setContinueError(CONTINUE_ERROR);
      } finally {
        if (mounted.current && generation.current === nextGeneration) setContinuePending(false);
        if (continueController.current === controller) continueController.current = undefined;
      }
    })();
  };

  const selectCity = (card: CityFrontierCardView) => {
    const current = screenCursor.current;
    if (current === undefined || current.kind !== "stable" ||
      current.readModel.revision.kind !== "terminal" ||
      current.readModel.catalog.rulesVersion !== "city-catalog@2" ||
      selectController.current !== undefined) return;
    const terminalRevisionId = current.readModel.revision.id;
    const projected = projectCityFrontierView(current);
    const currentCard = projected.cards.find(({ city, markerDigest }) =>
      city.cityId === card.city.cityId && markerDigest === card.markerDigest);
    if (currentCard === undefined) return;

    const identityKey = `${terminalRevisionId}\u0000${currentCard.city.cityId}`;
    const retained = selectRequests.current.get(identityKey);
    const request = retained ?? (() => {
      const commandId = crypto.randomUUID();
      const payload = JSON.stringify({
        terminalCityShortlistSnapshotId: terminalRevisionId,
        cityId: currentCard.city.cityId,
        commandId,
        ...(currentCard.status === "yellow"
          ? { warningCopyVersion: "city-unknown-risk@1" }
          : {}),
      });
      return {
        cityId: currentCard.city.cityId,
        commandId,
        identityKey,
        payload,
        terminalRevisionId,
      };
    })();
    selectRequests.current.set(identityKey, request);
    const controller = new AbortController();
    selectController.current = controller;
    setSelectPendingCityId(currentCard.city.cityId);
    setSelectError(undefined);
    void (async () => {
      try {
        const response = await fetch("/api/city-frontier/select", {
          body: request.payload,
          headers: { "content-type": "application/json" },
          method: "POST",
          signal: controller.signal,
        });
        const next = await openCitySelectionJson(response, current.readModel, request);
        const latest = screenCursor.current;
        if (controller.signal.aborted || !mounted.current ||
          selectController.current !== controller || latest === undefined ||
          latest.readModel.runId !== current.readModel.runId ||
          latest.readModel.revision.id !== terminalRevisionId) return;
        selectRequests.current.delete(identityKey);
        screenCursor.current = next;
        setScreen(next);
      } catch {
        if (!controller.signal.aborted && mounted.current &&
          selectController.current === controller) setSelectError(SELECT_ERROR);
      } finally {
        if (selectController.current === controller) {
          selectController.current = undefined;
          if (mounted.current) setSelectPendingCityId(undefined);
        }
      }
    })();
  };

  const modeStatus = view === undefined
    ? "pending" as const
    : view.candidates.some(({ status }) => status === "pending")
      ? "pending" as const
      : view.cards.length > 0 ? "green" as const : "yellow" as const;
  const stableTerminal = screen?.kind === "stable" &&
    screen.readModel.revision.kind === "terminal";
  const selectionEnabled = stableTerminal &&
    screen.readModel.catalog.rulesVersion === "city-catalog@2";

  return (
    <ProductShell
      activeDestination="research"
      context={screen === undefined ? undefined : {
        route: `Россия → города ${screen.readModel.countryCode}`,
        branch: "Проверка городов",
        snapshot: screen.readModel.revision.id,
        status: modeStatus,
      }}
      globe={globe}
      globeMode={screen === undefined ? "onboarding" : "full"}
      onDestinationChange={() => undefined}
      setup={screen === undefined}
    >
      <section aria-label="Поиск городов" className="place-frontier-journey">
        {screen === undefined && setup !== undefined ? (
          <CityFrontierStart
            error={startError}
            onStart={start}
            pending={startPending}
            setup={setup}
          />
        ) : screen !== undefined && view !== undefined ? (
          <>
            {stableTerminal ? (
              <CityFrontierCards
                cards={view.cards}
                error={selectError}
                onSelect={selectCity}
                pendingCityId={selectPendingCityId}
                registry={screen.readModel.registry}
                selectionEnabled={selectionEnabled}
                selectionHistory={view.selectionHistory ?? []}
              />
            ) : (
              <ResearchWorkspace
                candidates={candidates}
                mode={modeStatus}
                progress={progress}
                progressAnnouncement={progress.at(-1)?.label}
                scope="city-frontier"
              />
            )}
            <CityFrontierPanel
              canRetry={continueError !== undefined || (
                screen.kind === "transportError" && !view.requiresVerifiedReload
              ) || (screen.kind === "continuing" && screen.stream.yellowSource !== undefined)}
              continuing={(screen.kind === "continuing" && screen.stream.yellowSource === undefined) ||
                continuePending}
              onContinue={continueFrontier}
              onReload={reload}
              readModel={screen.readModel}
              requestError={continueError}
              view={view}
            />
          </>
        ) : null}
      </section>
    </ProductShell>
  );
}
