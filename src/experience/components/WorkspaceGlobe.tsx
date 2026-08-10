"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
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
  readonly status: CommandCenterStatus;
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

export function WorkspaceGlobe({ renderGlobe, status }: WorkspaceGlobeProps) {
  const [webglSupported, setWebglSupported] = useState<boolean>();
  const [unavailable, setUnavailable] = useState(false);
  const globeRoute: GlobeRoute = {
    city: TIRANA.city,
    country: TIRANA.country,
    description: "Подтверждённый маршрут текущего сценария.",
    flag: TIRANA.flag,
    from: MOSCOW.coordinate,
    key: "overview-moscow-tirana",
    label: `${MOSCOW.city} → ${TIRANA.city}`,
    status,
    to: TIRANA.coordinate,
  };
  const globeProps: ResearchGlobeCanvasProps = {
    activeFlight: globeRoute,
    backgroundColor: "#061014",
    onFlightComplete: () => undefined,
    onReady: () => undefined,
    onUnavailable: () => setUnavailable(true),
    origin: MOSCOW,
    overview: {
      coordinates: [MOSCOW.coordinate, TIRANA.coordinate],
      key: 1,
    },
    routes: [globeRoute],
  };
  const retry = useCallback(() => {
    setUnavailable(false);
    setWebglSupported(supportsWebGL());
  }, []);

  useEffect(() => setWebglSupported(supportsWebGL()), []);

  const globe = (() => {
    if (renderGlobe !== undefined) return renderGlobe(globeProps);
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
    return <DynamicResearchGlobe {...globeProps} />;
  })();

  return (
    <section aria-label="3D Земля маршрута Россия → Тирана" className="workspace-globe">
      <div className="workspace-globe__engine">{globe}</div>
    </section>
  );
}
