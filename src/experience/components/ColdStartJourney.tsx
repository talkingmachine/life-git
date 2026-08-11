"use client";

import { useEffect, useRef, useState } from "react";

import type { ColdStartReadModel } from "../../application/cold-start";
import {
  decodeColdStartStream,
  openColdStartStreamResponse,
} from "../cold-start-stream";
import {
  createColdStartRunningState,
  failColdStartScreen,
  presentColdStartReadModel,
  projectColdStartView,
  reduceColdStartScreenEvent,
  type ColdStartScreenState,
} from "../cold-start-view-model";
import { replaceColdStartRunUrl } from "../run-url";
import { ColdStartComparator } from "./ColdStartComparator";
import { ProductShell } from "./ProductShell";
import { ResearchWorkspace } from "./ResearchWorkspace";

interface ColdStartJourneyProps {
  readonly initialReadModel?: ColdStartReadModel;
  readonly interrupted?: boolean;
  readonly profileId: string;
  readonly runId: string;
  readonly stream?: ReadableStream<Uint8Array>;
}

const TRANSPORT_ERROR = "Поток проверки прерван. Доменный вывод не сформирован.";
const INTERRUPTED_ERROR = "Запуск был прерван до появления проверенного снимка.";

function initialScreen({
  initialReadModel,
  interrupted,
  runId,
}: Pick<ColdStartJourneyProps, "initialReadModel" | "interrupted" | "runId">): ColdStartScreenState {
  if (initialReadModel !== undefined) return presentColdStartReadModel(initialReadModel);
  const running = createColdStartRunningState(runId);
  return interrupted === true ? failColdStartScreen(running, INTERRUPTED_ERROR) : running;
}

export function ColdStartJourney(props: ColdStartJourneyProps) {
  const { profileId, stream } = props;
  const [screen, setScreen] = useState<ColdStartScreenState>(() => initialScreen(props));
  const [activeStream, setActiveStream] = useState(stream);
  const [retryPending, setRetryPending] = useState(false);
  const stopActiveStream = useRef<() => void>(() => undefined);
  const view = projectColdStartView(screen);

  useEffect(() => {
    if (activeStream === undefined) return;
    let active = true;
    const controller = new AbortController();
    const iterator = decodeColdStartStream(activeStream, controller.signal);
    const stop = () => {
      active = false;
      controller.abort(new DOMException("Screen stopped consuming research", "AbortError"));
    };
    stopActiveStream.current = stop;
    const consume = async () => {
      try {
        for await (const event of iterator) {
          if (!active) return;
          setScreen((current) => reduceColdStartScreenEvent(current, event));
        }
      } catch {
        if (active) setScreen((current) => failColdStartScreen(current, TRANSPORT_ERROR));
      }
    };
    void consume();
    return () => {
      stop();
      if (stopActiveStream.current === stop) stopActiveStream.current = () => undefined;
      void iterator.return(undefined).catch(() => undefined);
    };
  }, [activeStream]);

  const retry = () => {
    if (retryPending) return;
    const previousRunId = screen.runId;
    stopActiveStream.current();
    setActiveStream(undefined);
    setScreen(createColdStartRunningState(previousRunId));
    setRetryPending(true);
    void (async () => {
      try {
        const response = await fetch("/api/cold-start", {
          body: JSON.stringify({ countryInput: "Словения", profileId }),
          headers: { "content-type": "application/json" },
          method: "POST",
        });
        const opened = openColdStartStreamResponse(response, profileId);
        if (opened.runId === previousRunId) throw new Error("retry_reused_run");
        replaceColdStartRunUrl(opened.runId, opened.profileId);
        setScreen(createColdStartRunningState(opened.runId));
        setActiveStream(opened.stream);
      } catch {
        setScreen((current) => failColdStartScreen(current, TRANSPORT_ERROR));
      } finally {
        setRetryPending(false);
      }
    })();
  };

  const status = view.marker;
  return (
    <ProductShell
      activeDestination="research"
      context={{
        route: "Россия → Словения",
        branch: "Проверка страны",
        snapshot: view.readModel?.evidenceSnapshotId ?? "Создаётся",
        status,
      }}
      globe={view.globe}
      globeMode={view.globeMode}
      onDestinationChange={() => undefined}
    >
      <section
        aria-label="Cold-start проверка страны"
        className={`cold-start-journey cold-start-journey--${view.globeMode}`}
      >
        <ResearchWorkspace
          candidates={[view.candidate]}
          mode={status}
          progress={view.progress}
          progressAnnouncement={view.announcement}
          routeLabel="Россия → Словения"
        />
        {view.transportError === undefined ? null : (
          <section className="cold-start-journey__transport" role="alert">
            <p>{view.transportError}</p>
            <button disabled={retryPending} onClick={retry} type="button">
              {retryPending ? "Повторяем…" : "Повторить проверку"}
            </button>
          </section>
        )}
        {view.readModel === undefined ? null : (
          <ColdStartComparator
            onRetry={retry}
            readModel={view.readModel}
            retryPending={retryPending}
          />
        )}
      </section>
    </ProductShell>
  );
}
