"use client";

import dynamic from "next/dynamic";
import {
  Component,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ComponentType, ReactNode } from "react";

import type {
  CandidateState,
  GlobeUnavailableReason,
  ResearchCandidate,
} from "../research-map/contracts";
import {
  MOSCOW_ORIGIN,
  createProductGlobeRoute,
} from "../research-map/product-route";
import type { ResearchGlobeCanvasProps } from "../research-map/ResearchGlobeCanvas";
import styles from "../research-map/ResearchGlobe.module.css";

interface ResearchGlobeModule {
  readonly ResearchGlobeCanvas: ComponentType<ResearchGlobeCanvasProps>;
}

export function loadResearchGlobeComponent(
  importResearchGlobe: () => Promise<ResearchGlobeModule> = (
    () => import("../research-map/ResearchGlobeCanvas")
  ),
): Promise<ComponentType<ResearchGlobeCanvasProps>> {
  return importResearchGlobe()
    .then((module) => module.ResearchGlobeCanvas)
    .catch((error: unknown) => function DynamicLoadFailure(props) {
      useEffect(
        () => props.onUnavailable("dynamic-import", error),
        [props.onUnavailable],
      );
      return null;
    });
}

const DynamicResearchGlobe = dynamic<ResearchGlobeCanvasProps>(
  loadResearchGlobeComponent,
  { ssr: false },
);

interface ResearchMapProps {
  readonly mode: CandidateState;
  readonly candidates: readonly ResearchCandidate[];
  readonly previousRun?: {
    readonly runId: string;
    readonly evidenceSnapshotId: string;
  };
  readonly onRetry?: (previousRunId: string) => Promise<{
    readonly runId: string;
    readonly evidenceSnapshotId: string;
  }>;
  readonly detectWebGL?: () => boolean;
  readonly renderGlobe?: (props: ResearchGlobeCanvasProps) => ReactNode;
}

interface GlobeFailure {
  readonly error?: unknown;
  readonly reason: GlobeUnavailableReason;
}

type GlobeCapability = "checking" | "supported" | "unsupported";

interface GlobeShellState {
  readonly attemptKey: number;
  readonly completedRouteKeys: ReadonlySet<string>;
  readonly failure?: GlobeFailure;
  readonly loading: boolean;
  readonly observedMode: CandidateState;
}

interface GlobeErrorBoundaryProps {
  readonly children: ReactNode;
  readonly onUnavailable: ResearchGlobeCanvasProps["onUnavailable"];
}

interface GlobeErrorBoundaryState {
  readonly failed: boolean;
}

class GlobeErrorBoundary extends Component<
  GlobeErrorBoundaryProps,
  GlobeErrorBoundaryState
> {
  public state: GlobeErrorBoundaryState = { failed: false };

  public static getDerivedStateFromError(): GlobeErrorBoundaryState {
    return { failed: true };
  }

  public componentDidCatch(error: Error): void {
    this.props.onUnavailable("react-render", error);
  }

  public render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}

function supportsWebGL(): boolean {
  if (typeof document === "undefined" || typeof WebGLRenderingContext === "undefined") {
    return false;
  }

  try {
    const canvas = document.createElement("canvas");
    return canvas.getContext("webgl2") !== null || canvas.getContext("webgl") !== null;
  } catch {
    return false;
  }
}

function canRenderGlobe(detectWebGL: () => boolean): boolean {
  try {
    return detectWebGL();
  } catch {
    return false;
  }
}

function GlobeRenderer({
  globeProps,
  renderGlobe,
}: {
  readonly globeProps: ResearchGlobeCanvasProps;
  readonly renderGlobe?: ResearchMapProps["renderGlobe"];
}): ReactNode {
  return renderGlobe === undefined
    ? <DynamicResearchGlobe {...globeProps} />
    : renderGlobe(globeProps);
}

export function ResearchMap({
  mode,
  candidates,
  previousRun,
  onRetry,
  detectWebGL = supportsWebGL,
  renderGlobe,
}: ResearchMapProps): React.JSX.Element {
  const routes = useMemo(
    () => candidates.map(createProductGlobeRoute),
    [candidates],
  );
  const [capability, setCapability] = useState<GlobeCapability>("checking");
  const [globeShell, setGlobeShell] = useState<GlobeShellState>(() => ({
    attemptKey: 0,
    completedRouteKeys: new Set(),
    loading: true,
    observedMode: mode,
  }));
  const [retryRecord, setRetryRecord] = useState<{
    readonly previous: NonNullable<ResearchMapProps["previousRun"]>;
    readonly next: {
      readonly runId: string;
      readonly evidenceSnapshotId: string;
    };
  }>();
  const [retryError, setRetryError] = useState<string>();
  const [retryPending, setRetryPending] = useState(false);
  const retryPendingRef = useRef(false);
  const retryRequestToken = useRef(0);
  const acceptedRetryContextKey = useRef<string | undefined>(undefined);
  const retryContextKey = previousRun !== undefined
    ? `${previousRun.runId}\u0000${previousRun.evidenceSnapshotId}`
    : "";
  const activeRetryContextKey = useRef(retryContextKey);

  if (globeShell.observedMode !== mode) {
    const pendingPhaseStarted = mode === "pending";
    setGlobeShell((current) => ({
      ...current,
      attemptKey: pendingPhaseStarted ? current.attemptKey + 1 : current.attemptKey,
      completedRouteKeys: pendingPhaseStarted ? new Set() : current.completedRouteKeys,
      failure: pendingPhaseStarted ? undefined : current.failure,
      loading: pendingPhaseStarted ? true : current.loading,
      observedMode: mode,
    }));
  }

  useEffect(() => {
    setCapability(canRenderGlobe(detectWebGL) ? "supported" : "unsupported");
  }, [detectWebGL]);

  useLayoutEffect(() => {
    activeRetryContextKey.current = retryContextKey;
    if (retryPendingRef.current) return;
    if (acceptedRetryContextKey.current === retryContextKey) {
      acceptedRetryContextKey.current = undefined;
      return;
    }
    acceptedRetryContextKey.current = undefined;
    retryRequestToken.current += 1;
    setRetryPending(false);
    setRetryRecord(undefined);
    setRetryError(undefined);
  }, [retryContextKey]);

  const attemptKey = globeShell.attemptKey;

  const handleReady = useCallback(() => {
    setGlobeShell((current) => current.attemptKey === attemptKey
      ? { ...current, loading: false }
      : current
    );
  }, [attemptKey]);

  const handleUnavailable = useCallback(
    (reason: GlobeUnavailableReason, error?: unknown) => {
      setGlobeShell((current) => current.attemptKey === attemptKey
        ? { ...current, failure: { error, reason }, loading: false }
        : current
      );
    },
    [attemptKey],
  );

  const handleFlightComplete = useCallback((flightKey: string) => {
    setGlobeShell((current) => {
      if (current.attemptKey !== attemptKey || current.completedRouteKeys.has(flightKey)) {
        return current;
      }
      const next = new Set(current.completedRouteKeys);
      next.add(flightKey);
      return { ...current, completedRouteKeys: next };
    });
  }, [attemptKey]);

  const retryGlobe = () => {
    if (globeShell.failure?.reason === "dynamic-import") {
      window.location.reload();
      return;
    }
    if (!canRenderGlobe(detectWebGL)) {
      setCapability("unsupported");
      return;
    }
    setCapability("supported");
    setGlobeShell((current) => ({
      ...current,
      attemptKey: current.attemptKey + 1,
      failure: undefined,
      loading: true,
    }));
  };

  const retryResearch = async () => {
    if (
      previousRun === undefined
      || onRetry === undefined
      || retryPendingRef.current
    ) return;
    const previous = previousRun;
    const requestContextKey = retryContextKey;
    const requestToken = retryRequestToken.current + 1;
    retryRequestToken.current = requestToken;
    retryPendingRef.current = true;
    setRetryPending(true);
    setRetryRecord(undefined);
    setRetryError(undefined);
    try {
      const next = await onRetry(previous.runId);
      const returnedContextKey = `${next.runId}\u0000${next.evidenceSnapshotId}`;
      if (
        retryRequestToken.current !== requestToken
        || (
          activeRetryContextKey.current !== requestContextKey
          && activeRetryContextKey.current !== returnedContextKey
        )
      ) return;
      acceptedRetryContextKey.current = returnedContextKey;
      setRetryRecord({ previous, next });
    } catch {
      if (
        retryRequestToken.current !== requestToken
        || activeRetryContextKey.current !== requestContextKey
      ) return;
      setRetryError("Повторная проверка не выполнена. Предыдущий снимок сохранён.");
    } finally {
      if (retryRequestToken.current === requestToken) {
        retryPendingRef.current = false;
        setRetryPending(false);
      }
    }
  };

  const activeFlight = mode === "pending"
    ? routes.find((route) => !globeShell.completedRouteKeys.has(route.key))
    : undefined;
  const globeProps: ResearchGlobeCanvasProps = {
    activeFlight,
    origin: MOSCOW_ORIGIN,
    overview: {
      key: attemptKey,
      coordinates: [
        MOSCOW_ORIGIN.coordinate,
        ...routes.map((route) => route.to),
      ],
    },
    routes,
    onFlightComplete: handleFlightComplete,
    onReady: handleReady,
    onUnavailable: handleUnavailable,
  };
  const failure = capability === "unsupported"
    ? { reason: "webgl-unsupported" as const }
    : globeShell.failure;
  const interactionBlocked = capability !== "supported"
    || globeShell.loading
    || failure !== undefined;
  const showLoader = failure === undefined
    && (capability === "checking" || globeShell.loading);

  return (
    <section
      aria-label="Карта проверки маршрута"
      className={styles.productShell}
      role="region"
    >
      <div
        aria-hidden={interactionBlocked ? "true" : undefined}
        className={styles.interactiveLayer}
        inert={interactionBlocked ? true : undefined}
      >
        {capability === "supported" ? (
          <GlobeErrorBoundary key={attemptKey} onUnavailable={handleUnavailable}>
            <GlobeRenderer globeProps={globeProps} renderGlobe={renderGlobe} />
          </GlobeErrorBoundary>
        ) : null}

        {mode === "yellow" && previousRun !== undefined && onRetry !== undefined ? (
          <div className={styles.retryOverlay}>
            <p>
              Предыдущий снимок:{" "}
              {retryRecord?.previous.evidenceSnapshotId ?? previousRun.evidenceSnapshotId}
            </p>
            <button disabled={retryPending} onClick={retryResearch} type="button">
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
      </div>

      {showLoader ? (
        <div aria-live="polite" className={styles.loadingOverlay} role="status">
          <span aria-hidden="true" className={styles.loadingSpinner} />
          <p>Загружаем глобус и маршрут…</p>
        </div>
      ) : failure === undefined ? null : (
        <div className={styles.errorOverlay} role="alert">
          <h2>Не удалось загрузить глобус</h2>
          <p>Проверьте соединение и попробуйте снова.</p>
          <button onClick={retryGlobe} type="button">Повторить</button>
        </div>
      )}
    </section>
  );
}
