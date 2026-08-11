"use client";

import Globe, { type GlobeMethods } from "react-globe.gl";
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Box3,
  Matrix4,
  Mesh,
  Object3D,
  TextureLoader,
  Vector3,
  type Material,
} from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

import {
  interpolateGreatCircle,
  sphericalMeanCoordinate,
  startDeferredInitialization,
  type GeoCoordinate,
} from "./globe-flight";
import { startGlobeJourney } from "./globe-journey";
import { createGlobeRouteScene, planeAltitude } from "./globe-route-scene";
import {
  loadRealisticEarthMaterial,
  type RealisticEarthBundle,
} from "./realistic-earth-material";
import {
  createGlobeLighting,
  startSynchronizedSunCycle,
} from "./research-globe-lifecycle";
import type {
  GlobeOrigin,
  GlobeOverview,
  GlobeRoute,
  GlobeUnavailableReason,
  PlaceKind,
} from "./contracts";
import { UiIcon } from "../components/UiIcon";
import styles from "./ResearchGlobe.module.css";

export type {
  GlobeOrigin,
  GlobeOverview,
  GlobeRoute,
  GlobeUnavailableReason,
} from "./contracts";

export interface ResearchGlobeCanvasProps {
  readonly activeFlight?: GlobeRoute;
  readonly backgroundColor?: string;
  readonly origin: GlobeOrigin;
  readonly overview: GlobeOverview;
  readonly routes: readonly GlobeRoute[];
  readonly onFlightComplete: (flightKey: string) => void;
  readonly onReady: () => void;
  readonly onUnavailable: (reason: GlobeUnavailableReason, error?: unknown) => void;
}

interface CustomLayerDatum {
  readonly kind: "aircraft" | "trail";
  readonly key: string;
  readonly object: Object3D;
  readonly routeKey: string;
}

interface CityLabelDatum {
  readonly altitude: number;
  readonly flag: string;
  readonly key: string;
  readonly kind: "destination" | "origin";
  readonly label: string;
  readonly lat: number;
  readonly lng: number;
  readonly placeKind: PlaceKind;
  readonly selected: boolean;
  readonly status: GlobeRoute["status"];
}

interface FlightLayer {
  readonly datum: CustomLayerDatum;
  readonly flight: GlobeRoute;
}

const customThreeObject = (datum: object) => (datum as CustomLayerDatum).object;
const keepCustomThreeObject = () => undefined;
const FIXED_SUN_ANGLE = Math.PI * 0.18;
const SUN_CYCLE_DURATION_MS = 90_000;
const AIRLINER_VISUAL_LENGTH = 5.5;
const FLIGHT_DURATION_MS = 1_050;
const AIRCRAFT_FADE_DURATION_MS = 200;
const AIRCRAFT_FADE_START_PROGRESS = (FLIGHT_DURATION_MS - AIRCRAFT_FADE_DURATION_MS)
  / FLIGHT_DURATION_MS;
const TRAIL_SETTLE_DURATION_MS = 250;
const CITY_LABEL_ALTITUDE = 0;
const statusLabels = {
  pending: "Проверка",
  green: "Подтверждено",
  yellow: "Нет данных",
  red: "Не подходит",
} as const;
const cityBalloonStatusClasses: Record<GlobeRoute["status"], string> = {
  pending: styles.cityBalloonPending,
  green: styles.cityBalloonGreen,
  yellow: styles.cityBalloonYellow,
  red: styles.cityBalloonRed,
};

function markerDetailId(routeKey: string): string {
  return `research-marker-detail-${routeKey.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

function markerButtonFromEventTarget(target: EventTarget | null): HTMLButtonElement | null {
  if (!(target instanceof Element)) return null;
  return target.closest<HTMLButtonElement>("button[data-route-key]");
}

function visibleMarkerButton(
  container: HTMLElement | null,
  routeKey: string,
): HTMLButtonElement | undefined {
  const markers = container?.querySelectorAll<HTMLButtonElement>("button[data-route-key]");
  return Array.from(markers ?? []).find((marker) => marker.dataset.routeKey === routeKey);
}

function firstVisibleMarkerButton(container: HTMLElement | null): HTMLButtonElement | undefined {
  return container?.querySelector<HTMLButtonElement>("button[data-route-key]") ?? undefined;
}

function normalizeAirliner(scene: Object3D): Object3D {
  const bounds = new Box3().setFromObject(scene);
  const size = bounds.getSize(new Vector3());
  const longestDimension = Math.max(size.x, size.y, size.z);
  if (!Number.isFinite(longestDimension) || longestDimension <= 0) return scene;

  scene.position.sub(bounds.getCenter(new Vector3()));

  // The Poly by Google airliner points along local +Z; this wrapper maps it to local +X tangent.
  const axisCorrection = new Object3D();
  axisCorrection.rotation.y = Math.PI / 2;
  axisCorrection.add(scene);

  const flightWrapper = new Object3D();
  flightWrapper.scale.setScalar(AIRLINER_VISUAL_LENGTH / longestDimension);
  flightWrapper.add(axisCorrection);
  return flightWrapper;
}

function disposeMaterial(material: Material | Material[]): void {
  if (Array.isArray(material)) {
    material.forEach((entry) => entry.dispose());
    return;
  }
  material.dispose();
}

function disposeObject(object: Object3D): void {
  object.traverse((child) => {
    if (!(child instanceof Mesh)) return;
    child.geometry.dispose();
    disposeMaterial(child.material);
  });
}

function clonePlaneTemplate(template: Object3D): Object3D {
  const clone = template.clone(true);
  clone.traverse((child) => {
    if (!(child instanceof Mesh)) return;
    child.geometry = child.geometry.clone();
    child.material = Array.isArray(child.material)
      ? child.material.map((material) => material.clone())
      : child.material.clone();
  });
  return clone;
}

function setAircraftOpacity(aircraft: Object3D, opacity: number): void {
  aircraft.traverse((child) => {
    if (!(child instanceof Mesh)) return;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) {
      const transparent = opacity < 1;
      const depthWrite = opacity >= 1;
      const flagsChanged = material.transparent !== transparent
        || material.depthWrite !== depthWrite;
      material.opacity = opacity;
      material.transparent = transparent;
      material.depthWrite = depthWrite;
      if (flagsChanged) material.needsUpdate = true;
    }
  });
}

function globePosition(
  globe: GlobeMethods,
  coordinate: GeoCoordinate,
  altitude: number,
): Vector3 {
  const position = globe.getCoords(coordinate.lat, coordinate.lng, altitude);
  return new Vector3(position.x, position.y, position.z);
}

function useReducedMotion(): boolean {
  const [reducedMotion, setReducedMotion] = useState(() =>
    typeof window !== "undefined"
      && typeof window.matchMedia === "function"
      && window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  return reducedMotion;
}

function useContainerSize(): {
  readonly container: React.RefObject<HTMLDivElement | null>;
  readonly height: number;
  readonly width: number;
} {
  const container = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ height: 1, width: 1 });

  useLayoutEffect(() => {
    const element = container.current;
    if (element === null) return;
    const update = () => {
      const bounds = element.getBoundingClientRect();
      setSize({ height: Math.max(1, bounds.height), width: Math.max(1, bounds.width) });
    };
    update();

    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(update);
      observer.observe(element);
      return () => observer.disconnect();
    }

    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  return { container, ...size };
}

export function orientPlaneAlongPath(
  plane: Object3D,
  current: Vector3,
  next: Vector3,
): void {
  const forward = next.clone().sub(current).normalize();
  if (forward.lengthSq() === 0) return;
  const radial = current.clone().normalize();
  const up = radial.addScaledVector(forward, -radial.dot(forward)).normalize();
  const side = forward.clone().cross(up).normalize();
  plane.quaternion.setFromRotationMatrix(new Matrix4().makeBasis(forward, up, side));
}

function orientPlane(
  plane: Object3D,
  globe: GlobeMethods,
  position: GeoCoordinate,
  nextPosition: GeoCoordinate,
  progress: number,
  nextProgress: number,
): Vector3 {
  const altitude = planeAltitude(progress);
  const current = globePosition(globe, position, altitude);
  const next = globePosition(globe, nextPosition, planeAltitude(nextProgress));
  orientPlaneAlongPath(plane, current, next);
  plane.position.copy(current);
  return current;
}

export function ResearchGlobeCanvas({
  activeFlight,
  backgroundColor = "#061014",
  origin,
  overview,
  routes,
  onFlightComplete,
  onReady,
  onUnavailable,
}: ResearchGlobeCanvasProps): React.JSX.Element {
  const globe = useRef<GlobeMethods | undefined>(undefined);
  const globeInitialized = useRef(false);
  const framedOverviewKey = useRef<number | undefined>(undefined);
  const stopGlobeInitialization = useRef<(() => void) | undefined>(undefined);
  const contextCleanup = useRef<(() => void) | undefined>(undefined);
  const stopFlight = useRef<(() => void) | undefined>(undefined);
  const readyReported = useRef(false);
  const onFlightCompleteRef = useRef(onFlightComplete);
  const onReadyRef = useRef(onReady);
  const onUnavailableRef = useRef(onUnavailable);
  const flightLayerRef = useRef<FlightLayer | undefined>(undefined);
  const destinationRevealCompleted = useRef(new Set<string>());
  const detailHeading = useRef<HTMLHeadingElement>(null);
  const returnFocusKey = useRef<string | undefined>(undefined);
  const viewport = useRef({ width: 1, height: 1 });
  const [globeReady, setGlobeReady] = useState(false);
  const [planeTemplate, setPlaneTemplate] = useState<Object3D>();
  const [destinationEpoch, setDestinationEpoch] = useState(0);
  const [flightLayer, setFlightLayer] = useState<FlightLayer>();
  const [routeLayerData, setRouteLayerData] = useState<CustomLayerDatum[]>([]);
  const [realisticEarth, setRealisticEarth] = useState<RealisticEarthBundle>();
  const [readyForFlights, setReadyForFlights] = useState(false);
  const [selectedRouteKey, setSelectedRouteKey] = useState<string>();
  onFlightCompleteRef.current = onFlightComplete;
  onReadyRef.current = onReady;
  onUnavailableRef.current = onUnavailable;
  const reducedMotion = useReducedMotion();
  const size = useContainerSize();
  viewport.current = { width: size.width, height: size.height };
  const routeScene = useMemo(createGlobeRouteScene, []);
  const lighting = useMemo(createGlobeLighting, []);
  const activeFlightKey = activeFlight?.key;
  const readActiveFlight = useEffectEvent(() => activeFlight);

  const customLayerData = useMemo<CustomLayerDatum[]>(
    () => flightLayer === undefined ? routeLayerData : [...routeLayerData, flightLayer.datum],
    [flightLayer, routeLayerData],
  );
  const cityLabelData = useMemo<CityLabelDatum[]>(() => {
    const destinations = routes.flatMap((route) => (
      route.status !== "pending" || destinationRevealCompleted.current.has(route.key)
        ? [{
          altitude: CITY_LABEL_ALTITUDE,
          flag: route.flag ?? "🌐",
          key: route.key,
          kind: "destination" as const,
          label: route.label,
          lat: route.to.lat,
          lng: route.to.lng,
          placeKind: route.kind,
          selected: route.key === selectedRouteKey,
          status: route.status,
        }]
        : []
    ));
    return [{
      altitude: CITY_LABEL_ALTITUDE,
      flag: origin.flag,
      key: "research-origin",
      kind: "origin" as const,
      label: origin.label,
      lat: origin.coordinate.lat,
      lng: origin.coordinate.lng,
      placeKind: origin.kind,
      selected: false,
      status: "green" as const,
    }, ...destinations];
  }, [destinationEpoch, origin, routeLayerData, routes, selectedRouteKey]);
  const selectedRoute = routes.find((route) => route.key === selectedRouteKey);
  const selectedLatitude = selectedRoute?.to.lat;
  const selectedLongitude = selectedRoute?.to.lng;
  const createCityBalloon = useCallback((datum: object): HTMLElement => {
    const label = datum as CityLabelDatum;
    const anchor = document.createElement("div");
    anchor.className = styles.cityBalloonAnchor;
    const element = document.createElement(label.kind === "origin" ? "div" : "button");
    element.className = [
      styles.cityBalloon,
      cityBalloonStatusClasses[label.status],
      label.kind === "origin" ? styles.cityBalloonOrigin : undefined,
      label.selected ? styles.cityBalloonSelected : undefined,
    ].filter(Boolean).join(" ");
    element.dataset.status = label.status;
    if (element instanceof HTMLButtonElement) {
      element.type = "button";
      element.setAttribute(
        "aria-label",
        `Открыть ${label.placeKind === "country" ? "страну" : "город"} ${label.label}`,
      );
      element.setAttribute("aria-controls", markerDetailId(label.key));
      element.setAttribute("aria-expanded", String(label.selected));
      element.dataset.routeKey = label.key;
    } else {
      element.setAttribute("role", "note");
      element.setAttribute(
        "aria-label",
        `${label.placeKind === "country" ? "Страна" : "Город"} отправления: ${label.label}`,
      );
    }
    const flag = document.createElement("span");
    flag.ariaHidden = "true";
    flag.className = styles.cityBalloonFlag;
    flag.textContent = label.flag;
    const place = document.createElement("span");
    place.textContent = label.label;
    element.append(flag, place);
    anchor.append(element);
    return anchor;
  }, []);

  const openMarkerDetails = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    const marker = markerButtonFromEventTarget(event.target);
    if (marker === null || !event.currentTarget.contains(marker)) return;
    const routeKey = marker.dataset.routeKey;
    if (routeKey === undefined || !routes.some((route) => route.key === routeKey)) return;
    event.stopPropagation();
    setSelectedRouteKey(routeKey);
  }, [routes]);

  const stopGlobeMarkerPointer = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const marker = markerButtonFromEventTarget(event.target);
    if (marker !== null && event.currentTarget.contains(marker)) event.stopPropagation();
  }, []);

  const closeSelectedRoute = useCallback(() => {
    if (selectedRouteKey === undefined) return;
    returnFocusKey.current = selectedRouteKey;
    setSelectedRouteKey(undefined);
  }, [selectedRouteKey]);

  useLayoutEffect(() => {
    if (selectedRouteKey !== undefined) {
      detailHeading.current?.focus();
      return;
    }
    const routeKey = returnFocusKey.current;
    if (routeKey === undefined) return;
    const container = size.container.current;
    const marker = visibleMarkerButton(container, routeKey)
      ?? firstVisibleMarkerButton(container);
    if (marker !== undefined) marker.focus();
    else container?.focus();
    returnFocusKey.current = undefined;
  }, [cityLabelData, selectedRouteKey]);

  useEffect(() => {
    let active = true;
    let loadedBundle: RealisticEarthBundle | undefined;
    const startedAt = performance.now();

    void loadRealisticEarthMaterial(new TextureLoader(), startedAt).then(
      (bundle) => {
        loadedBundle = bundle;
        if (!active) {
          bundle.dispose();
          return;
        }
        setRealisticEarth(bundle);
      },
      (error: unknown) => {
        if (active) onUnavailableRef.current("earth-material", error);
      },
    );

    return () => {
      active = false;
      loadedBundle?.dispose();
    };
  }, []);

  useEffect(() => {
    if (!globeReady || realisticEarth === undefined || planeTemplate === undefined) return;
    if (readyReported.current) return;
    readyReported.current = true;
    onReadyRef.current();
    setReadyForFlights(true);
  }, [globeReady, planeTemplate, realisticEarth]);

  useEffect(() => {
    if (realisticEarth === undefined) return;
    return startSynchronizedSunCycle({
      cancelFrame: window.cancelAnimationFrame.bind(window),
      cycleDurationMs: SUN_CYCLE_DURATION_MS,
      fixedAngle: FIXED_SUN_ANGLE,
      realisticEarth,
      reducedMotion,
      requestFrame: window.requestAnimationFrame.bind(window),
      sunLight: lighting.sunLight,
    });
  }, [lighting, realisticEarth, reducedMotion]);

  useLayoutEffect(() => {
    const currentGlobe = globe.current;
    if (!globeReady || realisticEarth === undefined || currentGlobe === undefined) return;

    const renderer = currentGlobe.renderer();
    const previousShaderError = renderer.debug.onShaderError;
    const handleShaderError: NonNullable<typeof renderer.debug.onShaderError> = (
      context,
      program,
      vertexShader,
      fragmentShader,
    ) => {
      const isRealisticEarthShader = context
        .getShaderSource(fragmentShader)
        ?.includes("earthNightMap") === true;
      if (!isRealisticEarthShader) {
        if (previousShaderError !== null) {
          previousShaderError(context, program, vertexShader, fragmentShader);
        } else {
          console.error("[research-globe:shader] Shader compilation failed");
        }
        return;
      }

      onUnavailableRef.current(
        "earth-material",
        new Error("Realistic Earth shader compilation failed"),
      );
    };

    renderer.debug.onShaderError = handleShaderError;
    return () => {
      if (renderer.debug.onShaderError === handleShaderError) {
        renderer.debug.onShaderError = previousShaderError;
      }
    };
  }, [globeReady, realisticEarth]);

  useEffect(() => {
    let active = true;
    let loadedPlane: Object3D | undefined;
    const loader = new GLTFLoader();

    loader.load(
      "/models/research-airliner.glb",
      ({ scene }) => {
        loadedPlane = normalizeAirliner(scene);
        if (!active) {
          disposeObject(loadedPlane);
          return;
        }
        setPlaneTemplate(loadedPlane);
      },
      undefined,
      (error) => {
        if (active) onUnavailableRef.current("model-load", error);
      },
    );

    return () => {
      active = false;
      if (loadedPlane !== undefined) disposeObject(loadedPlane);
    };
  }, []);

  const initializeGlobe = useCallback((): boolean => {
    if (globeInitialized.current) return true;
    const currentGlobe = globe.current;
    if (currentGlobe === undefined) return false;
    globeInitialized.current = true;

    try {
      const renderer = currentGlobe.renderer();
      if (renderer.getContext().isContextLost()) throw new Error("WebGL context is unavailable");

      const handleContextLost = (event: Event) => {
        event.preventDefault();
        onUnavailableRef.current("context-lost");
      };
      contextCleanup.current?.();
      renderer.domElement.addEventListener("webglcontextlost", handleContextLost, { once: true });
      contextCleanup.current = () => renderer.domElement.removeEventListener("webglcontextlost", handleContextLost);

      currentGlobe.lights(lighting.lights);
      const controls = currentGlobe.controls();
      const radius = currentGlobe.getGlobeRadius();
      controls.autoRotate = false;
      controls.enableDamping = true;
      controls.minDistance = radius * 1.82;
      controls.maxDistance = radius * 2.35;
      currentGlobe.pointOfView({ lat: 50, lng: 26, altitude: 1.85 }, 0);
      setGlobeReady(true);
      return true;
    } catch (error) {
      onUnavailableRef.current("renderer-init", error);
      return true;
    }
  }, [lighting]);

  const setGlobeRef = useCallback((instance: GlobeMethods | null) => {
    globe.current = instance ?? undefined;
    if (instance === null || globeInitialized.current) return;
    stopGlobeInitialization.current?.();
    stopGlobeInitialization.current = startDeferredInitialization({
      cancelFrame: window.clearTimeout.bind(window),
      initialize: initializeGlobe,
      maxAttempts: 4,
      onExhausted: () => onUnavailableRef.current(
        "renderer-init",
        new Error("Globe renderer unavailable after 4 initialization attempts"),
      ),
      requestFrame: (callback) => window.setTimeout(() => callback(window.performance.now()), 16),
    });
  }, [initializeGlobe]);

  useEffect(() => () => {
    stopGlobeInitialization.current?.();
    contextCleanup.current?.();
    const layer = flightLayerRef.current;
    flightLayerRef.current = undefined;
    if (layer !== undefined) disposeObject(layer.datum.object);
  }, []);

  useEffect(() => () => routeScene.dispose(), [routeScene]);

  useEffect(() => {
    destinationRevealCompleted.current.clear();
    setDestinationEpoch((epoch) => epoch + 1);
    setSelectedRouteKey(undefined);
  }, [overview.key]);

  useLayoutEffect(() => {
    if (selectedRouteKey !== undefined && !routes.some((route) => route.key === selectedRouteKey)) {
      returnFocusKey.current = selectedRouteKey;
      setSelectedRouteKey(undefined);
    }
  }, [routes, selectedRouteKey]);

  useLayoutEffect(() => {
    stopFlight.current?.();
    stopFlight.current = undefined;
    const previousLayer = flightLayerRef.current;
    flightLayerRef.current = undefined;
    if (previousLayer !== undefined) disposeObject(previousLayer.datum.object);
    const nextFlight = readActiveFlight();
    if (
      !globeReady
      || realisticEarth === undefined
      || planeTemplate === undefined
      || !readyForFlights
      || nextFlight === undefined
    ) {
      setFlightLayer(undefined);
      return;
    }
    const nextLayer: FlightLayer = {
      datum: {
        key: nextFlight.key,
        kind: "aircraft",
        object: clonePlaneTemplate(planeTemplate),
        routeKey: nextFlight.key,
      },
      flight: nextFlight,
    };
    flightLayerRef.current = nextLayer;
    setFlightLayer(nextLayer);
  }, [activeFlightKey, globeReady, planeTemplate, readyForFlights, realisticEarth]);

  useLayoutEffect(() => {
    const currentGlobe = globe.current;
    if (!globeReady || currentGlobe === undefined) {
      setRouteLayerData([]);
      return;
    }

    const nextLayerData = routeScene.reconcile({
      project: (coordinate, altitude) => globePosition(currentGlobe, coordinate, altitude),
      routes,
      runKey: overview.key,
      viewport: viewport.current,
    });
    setRouteLayerData([...nextLayerData]);
  }, [globeReady, overview.key, routeScene, routes, size.height, size.width]);

  useLayoutEffect(() => {
    const currentGlobe = globe.current;
    if (
      !globeReady
      || currentGlobe === undefined
      || framedOverviewKey.current === overview.key
    ) return;

    const center = sphericalMeanCoordinate(overview.coordinates);
    if (center === undefined) return;
    framedOverviewKey.current = overview.key;
    currentGlobe.pointOfView(
      { lat: center.lat, lng: center.lng, altitude: 1.1 },
      reducedMotion ? 0 : 850,
    );
  }, [globeReady, overview, reducedMotion]);

  useLayoutEffect(() => {
    const currentGlobe = globe.current;
    if (
      !globeReady
      || currentGlobe === undefined
      || selectedLatitude === undefined
      || selectedLongitude === undefined
    ) return;
    currentGlobe.pointOfView(
      { lat: selectedLatitude, lng: selectedLongitude, altitude: 1.1 },
      reducedMotion ? 0 : 650,
    );
  }, [globeReady, reducedMotion, selectedLatitude, selectedLongitude]);

  useLayoutEffect(() => {
    const currentGlobe = globe.current;
    if (
      !globeReady
      || realisticEarth === undefined
      || planeTemplate === undefined
      || !readyForFlights
      || currentGlobe === undefined
      || flightLayer === undefined
    ) return;
    const { flight } = flightLayer;
    const flightPlane = flightLayer.datum.object;
    const updateTrail = routeScene.createFlightTrailUpdater(flight.key);
    let landingTailProgress: number | undefined;

    const stop = startGlobeJourney({
      cancelFrame: window.cancelAnimationFrame.bind(window),
      flightDurationMs: FLIGHT_DURATION_MS,
      from: flight.from,
      onComplete: () => {
        onFlightCompleteRef.current(flight.key);
      },
      onDestinationReveal() {
        if (destinationRevealCompleted.current.has(flight.key)) return;
        destinationRevealCompleted.current.add(flight.key);
        setDestinationEpoch((epoch) => epoch + 1);
      },
      onFlightProgress(position, progress) {
        const opacity = progress <= AIRCRAFT_FADE_START_PROGRESS
          ? 1
          : (1 - progress) / (1 - AIRCRAFT_FADE_START_PROGRESS);
        setAircraftOpacity(flightPlane, Math.max(0, Math.min(1, opacity)));
        const nextProgress = Math.min(1, progress + 0.002);
        const nextPosition = interpolateGreatCircle(
          flight.from,
          flight.to,
          nextProgress,
        );
        const aircraftPosition = orientPlane(
          flightPlane,
          currentGlobe,
          position,
          nextPosition,
          progress,
          nextProgress,
        );
        landingTailProgress = updateTrail({
          aircraftPosition,
          progress,
          project: (coordinate, altitude) => globePosition(currentGlobe, coordinate, altitude),
          route: flight,
          viewport: viewport.current,
        }) ?? landingTailProgress;
      },
      onLanding() {
        setAircraftOpacity(flightPlane, 0);
        flightPlane.removeFromParent();
      },
      onTrailSettleProgress(progress) {
        if (landingTailProgress === undefined) return;
        routeScene.settleFlightTrail(flight.key, {
          landingTailProgress,
          progress,
          project: (coordinate, altitude) => globePosition(currentGlobe, coordinate, altitude),
          route: flight,
          viewport: viewport.current,
        });
      },
      reducedMotion,
      requestFrame: window.requestAnimationFrame.bind(window),
      settleDurationMs: TRAIL_SETTLE_DURATION_MS,
      to: flight.to,
    });
    stopFlight.current = stop;
    return () => {
      stop();
      if (stopFlight.current === stop) stopFlight.current = undefined;
    };
  }, [flightLayer, globeReady, planeTemplate, readyForFlights, realisticEarth, reducedMotion, routeScene]);

  return (
    <div
      aria-label="Глобус маршрутов"
      className={styles.globe}
      onClick={openMarkerDetails}
      onPointerDown={stopGlobeMarkerPointer}
      ref={size.container}
      role="region"
      style={{ background: backgroundColor }}
      tabIndex={-1}
    >
      <Globe
        // react-globe.gl narrows refs to mutable objects, although its forwardRef accepts callback refs.
        ref={setGlobeRef as unknown as React.MutableRefObject<GlobeMethods | undefined>}
        width={size.width}
        height={size.height}
        backgroundColor={backgroundColor}
        {...(realisticEarth === undefined ? {} : { globeMaterial: realisticEarth.material })}
        globeCurvatureResolution={1.5}
        showGraticules={false}
        showAtmosphere
        atmosphereColor="#4a8ea8"
        atmosphereAltitude={0.14}
        customLayerData={customLayerData}
        customThreeObject={customThreeObject}
        customThreeObjectUpdate={keepCustomThreeObject}
        htmlElementsData={cityLabelData}
        htmlLat={(datum) => (datum as CityLabelDatum).lat}
        htmlLng={(datum) => (datum as CityLabelDatum).lng}
        htmlAltitude={(datum) => (datum as CityLabelDatum).altitude}
        htmlElement={createCityBalloon}
        htmlTransitionDuration={0}
        enablePointerInteraction
      />
      {selectedRoute === undefined ? null : (
        <aside
          aria-labelledby={`${markerDetailId(selectedRoute.key)}-heading`}
          className={styles.markerDetails}
          id={markerDetailId(selectedRoute.key)}
          onKeyDown={(event) => {
            if (event.key === "Escape") closeSelectedRoute();
          }}
          role="dialog"
        >
          <button
            aria-label="Закрыть карточку"
            className={styles.markerDetailsClose}
            onClick={closeSelectedRoute}
            type="button"
          >
            <UiIcon name="close" />
          </button>
          <p className={styles.markerDetailsCountry}>
            <span aria-hidden="true" className={styles.markerDetailsFlag}>
              {selectedRoute.flag ?? "🌐"}
            </span>
            <span>{selectedRoute.country ?? "Страна кандидата"}</span>
          </p>
          <h2
            id={`${markerDetailId(selectedRoute.key)}-heading`}
            ref={detailHeading}
            tabIndex={-1}
          >
            {selectedRoute.label}
          </h2>
          <p className={styles.markerDetailsStatus}>{statusLabels[selectedRoute.status]}</p>
          {selectedRoute.status === "green" && selectedRoute.photoUrl !== undefined ? (
            <img
              alt={selectedRoute.label}
              className={styles.markerDetailsPhoto}
              src={selectedRoute.photoUrl}
            />
          ) : (
            <>
              <p>
                {selectedRoute.status === "red"
                  ? selectedRoute.rejectionReason ?? "Кандидат исключён по обязательному условию."
                  : selectedRoute.status === "yellow"
                    ? selectedRoute.rejectionReason
                      ?? selectedRoute.description
                      ?? "Нет подтверждённых данных по обязательному условию."
                  : selectedRoute.description ?? "Проверяем условия сценария."}
              </p>
            </>
          )}
          {selectedRoute.officialUrl === undefined ? null : (
            <a href={selectedRoute.officialUrl}>
              Официальный источник: {selectedRoute.label}
            </a>
          )}
        </aside>
      )}
    </div>
  );
}
