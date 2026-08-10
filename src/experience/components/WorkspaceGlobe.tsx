"use client";

import dynamic from "next/dynamic";
import { Component, useCallback, useEffect, useMemo, useState } from "react";
import type { ComponentType, ReactNode } from "react";

import type {
  GlobeRoute,
  ResearchGlobeCanvasProps,
} from "../research-map/ResearchGlobeCanvas";
import type { CommandCenterStatus } from "./ProductShell";

interface ResearchGlobeModule {
  readonly ResearchGlobeCanvas: ComponentType<ResearchGlobeCanvasProps>;
}

interface WorkspaceGlobeProps {
  readonly renderGlobe?: (props: ResearchGlobeCanvasProps) => ReactNode;
  readonly reloadPage?: () => void;
  readonly status: CommandCenterStatus;
}

interface GlobeLoadBoundaryProps {
  readonly children: ReactNode;
  readonly onError: () => void;
}

interface GlobeLoadBoundaryState {
  readonly failed: boolean;
}

const MOSCOW = {
  city: "Москва",
  country: "Россия",
  flag: "🇷🇺",
  coordinate: { lat: 55.7558, lng: 37.6173 },
} as const;

const TIRANA = {
  city: "Тирана",
  country: "Албания",
  flag: "🇦🇱",
  coordinate: { lat: 41.3275, lng: 19.8187 },
} as const;

const DynamicResearchGlobe = dynamic<ResearchGlobeCanvasProps>(
  () => import("../research-map/ResearchGlobeCanvas")
    .then((module: ResearchGlobeModule) => module.ResearchGlobeCanvas),
  { ssr: false },
);

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

function reloadDocument(): void {
  window.location.reload();
}

const ignoreGlobeEvent = () => undefined;

export function WorkspaceGlobe({
  renderGlobe,
  reloadPage = reloadDocument,
  status,
}: WorkspaceGlobeProps) {
  const [webglSupported, setWebglSupported] = useState<boolean>();
  const [unavailable, setUnavailable] = useState(false);
  const [importFailed, setImportFailed] = useState(false);
  const globeRoute = useMemo<GlobeRoute>(() => ({
    city: TIRANA.city,
    country: TIRANA.country,
    description: "Подтверждённый маршрут текущего сценария.",
    flag: TIRANA.flag,
    from: MOSCOW.coordinate,
    key: "overview-moscow-tirana",
    label: `${MOSCOW.city} → ${TIRANA.city}`,
    status,
    to: TIRANA.coordinate,
  }), [status]);
  const routes = useMemo(() => [globeRoute], [globeRoute]);
  const overview = useMemo(() => ({
    coordinates: [MOSCOW.coordinate, TIRANA.coordinate],
    key: 1,
  }), []);
  const handleUnavailable = useCallback(() => setUnavailable(true), []);
  const globeProps = useMemo<ResearchGlobeCanvasProps>(() => ({
    activeFlight: globeRoute,
    backgroundColor: "#061014",
    onFlightComplete: ignoreGlobeEvent,
    onReady: ignoreGlobeEvent,
    onUnavailable: handleUnavailable,
    origin: MOSCOW,
    overview,
    routes,
  }), [globeRoute, handleUnavailable, overview, routes]);
  const retry = useCallback(() => {
    setUnavailable(false);
    setWebglSupported(supportsWebGL());
  }, []);

  useEffect(() => setWebglSupported(supportsWebGL()), []);

  const globe = (() => {
    if (renderGlobe !== undefined) return renderGlobe(globeProps);
    if (importFailed) {
      return (
        <button className="workspace-globe__fallback" onClick={reloadPage} type="button">
          Повторить загрузку 3D Земли
        </button>
      );
    }
    if (unavailable || webglSupported === false) {
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
      <GlobeLoadBoundary onError={() => setImportFailed(true)}>
        <DynamicResearchGlobe {...globeProps} />
      </GlobeLoadBoundary>
    );
  })();

  return (
    <section aria-label="3D Земля маршрута Россия → Тирана" className="workspace-globe">
      <div className="workspace-globe__engine">{globe}</div>
    </section>
  );
}
