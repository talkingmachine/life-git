"use client";

import dynamic from "next/dynamic";
import { Component, useCallback, useEffect, useMemo, useState } from "react";
import type { ComponentType, ReactNode } from "react";

import type { ResearchGlobeCanvasProps } from "../research-map/ResearchGlobeCanvas";
import type {
  ResearchCandidate,
  WorkspaceGlobePresentation,
} from "../research-map/contracts";
import {
  MOSCOW_ORIGIN,
  TIRANA_PRESENTATION,
} from "../research-map/product-route";
import type { CommandCenterStatus } from "./ProductShell";

export type WorkspaceGlobeMode = "full" | "background" | "collapsed";
export type { WorkspaceGlobePresentation } from "../research-map/contracts";

interface ResearchGlobeModule {
  readonly ResearchGlobeCanvas: ComponentType<ResearchGlobeCanvasProps>;
}

interface WorkspaceGlobeProps {
  readonly mode?: WorkspaceGlobeMode;
  readonly presentation?: WorkspaceGlobePresentation;
  readonly renderGlobe?: (props: ResearchGlobeCanvasProps) => ReactNode;
  readonly status: CommandCenterStatus;
}

interface GlobeLoadBoundaryProps {
  readonly children: ReactNode;
  readonly onError: () => void;
}

interface GlobeLoadBoundaryState {
  readonly failed: boolean;
}

function createDynamicResearchGlobe(): ComponentType<ResearchGlobeCanvasProps> {
  return dynamic<ResearchGlobeCanvasProps>(
    () => import("../research-map/ResearchGlobeCanvas")
      .then((module: ResearchGlobeModule) => module.ResearchGlobeCanvas),
    {
      loading: ({ error }) => {
        if (error !== null) throw error;
        return null;
      },
      ssr: false,
    },
  );
}

class GlobeLoadBoundary extends Component<GlobeLoadBoundaryProps, GlobeLoadBoundaryState> {
  state: GlobeLoadBoundaryState = { failed: false };

  static getDerivedStateFromError(): GlobeLoadBoundaryState {
    return { failed: true };
  }

  componentDidCatch(): void {
    this.props.onError();
  }

  render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}

function supportsWebGL(): boolean {
  if (
    typeof document === "undefined"
    || typeof WebGLRenderingContext === "undefined"
  ) return false;

  try {
    const canvas = document.createElement("canvas");
    return canvas.getContext("webgl2") !== null || canvas.getContext("webgl") !== null;
  } catch {
    return false;
  }
}

const ignoreGlobeEvent = () => undefined;

function defaultPresentation(status: CommandCenterStatus): WorkspaceGlobePresentation {
  const candidate: ResearchCandidate = {
    id: "tirana",
    ...TIRANA_PRESENTATION,
    status,
  };
  const route = {
    label: candidate.label,
    kind: candidate.kind,
    city: candidate.city,
    country: candidate.country,
    description: "Подтверждённый маршрут текущего сценария.",
    flag: candidate.flag,
    from: MOSCOW_ORIGIN.coordinate,
    key: "overview-moscow-tirana",
    routeLabel: `${MOSCOW_ORIGIN.label} → ${candidate.label}`,
    status,
    to: candidate.coordinate,
  } as const;
  return {
    activeFlight: route,
    ariaLabel: "3D Земля маршрута Россия → Тирана",
    origin: MOSCOW_ORIGIN,
    overview: {
      coordinates: [MOSCOW_ORIGIN.coordinate, candidate.coordinate],
      key: 1,
    },
    routes: [route],
  };
}

export function WorkspaceGlobe({
  mode = "background",
  presentation,
  renderGlobe,
  status,
}: WorkspaceGlobeProps) {
  const [webglSupported, setWebglSupported] = useState<boolean>();
  const [unavailable, setUnavailable] = useState(false);
  const [importFailed, setImportFailed] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [DynamicResearchGlobe, setDynamicResearchGlobe] = useState(
    () => createDynamicResearchGlobe(),
  );
  const fallbackPresentation = useMemo(() => defaultPresentation(status), [status]);
  const activePresentation = presentation ?? fallbackPresentation;
  const handleUnavailable = useCallback(() => setUnavailable(true), []);
  const globeProps = useMemo<ResearchGlobeCanvasProps>(() => ({
    activeFlight: activePresentation.activeFlight,
    backgroundColor: activePresentation.backgroundColor ?? "#061014",
    onFlightComplete: ignoreGlobeEvent,
    onReady: ignoreGlobeEvent,
    onUnavailable: handleUnavailable,
    origin: activePresentation.origin,
    overview: activePresentation.overview,
    routes: activePresentation.routes,
  }), [activePresentation, handleUnavailable]);
  const retry = useCallback(() => {
    setUnavailable(false);
    setImportFailed(false);
    setDynamicResearchGlobe(() => createDynamicResearchGlobe());
    setLoadAttempt((attempt) => attempt + 1);
    setWebglSupported(supportsWebGL());
  }, []);

  useEffect(() => setWebglSupported(supportsWebGL()), []);

  const globe = (() => {
    if (renderGlobe !== undefined) return renderGlobe(globeProps);
    if (importFailed || unavailable || webglSupported === false) {
      return (
        <button className="workspace-globe__fallback" onClick={retry} type="button">
          Повторить загрузку 3D Земли
        </button>
      );
    }
    if (webglSupported === undefined) {
      return <span className="workspace-globe__loading">Загрузка 3D Земли…</span>;
    }
    return (
      <GlobeLoadBoundary
        key={loadAttempt}
        onError={() => setImportFailed(true)}
      >
        <DynamicResearchGlobe {...globeProps} />
      </GlobeLoadBoundary>
    );
  })();

  return (
    <section
      aria-label={activePresentation.ariaLabel}
      className={`workspace-globe workspace-globe--${mode}`}
      data-mode={mode}
    >
      <div className="workspace-globe__engine">{globe}</div>
    </section>
  );
}
