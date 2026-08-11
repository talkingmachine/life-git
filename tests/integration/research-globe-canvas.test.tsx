// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Vector3 as ThreeVector3 } from "three";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { GlobeRoute } from "../../src/experience/research-map/contracts";

const lifecycle = vi.hoisted(() => ({
  startJourney: vi.fn(),
  stopJourney: vi.fn(),
}));

vi.mock("../../src/experience/research-map/globe-journey", () => ({
  startGlobeJourney: lifecycle.startJourney,
}));

vi.mock("../../src/experience/research-map/globe-route-scene", () => ({
  createGlobeRouteScene: () => ({
    createFlightTrailUpdater: () => () => undefined,
    dispose: () => undefined,
    reconcile: () => [],
    settleFlightTrail: () => undefined,
  }),
  planeAltitude: () => 0,
}));

vi.mock("../../src/experience/research-map/realistic-earth-material", async () => {
  const { MeshStandardMaterial } = await import("three");
  return {
    loadRealisticEarthMaterial: async () => ({
      dispose: () => undefined,
      estimatedGpuBytes: 0,
      getSunDirection: (target: ThreeVector3) => target.set(1, 0, 0),
      material: new MeshStandardMaterial(),
      readyMs: 0,
      setSunAngle: () => undefined,
    }),
  };
});

vi.mock("../../src/experience/research-map/research-globe-lifecycle", async () => {
  const { AmbientLight, DirectionalLight } = await import("three");
  return {
    createGlobeLighting: () => {
      const ambientLight = new AmbientLight();
      const sunLight = new DirectionalLight();
      return { ambientLight, lights: [ambientLight, sunLight], sunLight };
    },
    startSynchronizedSunCycle: () => () => undefined,
  };
});

vi.mock("three/examples/jsm/loaders/GLTFLoader.js", async () => {
  const { Object3D } = await import("three");
  return {
    GLTFLoader: class GLTFLoader {
      load(
        _url: string,
        onLoad: (value: { scene: InstanceType<typeof Object3D> }) => void,
      ) {
        onLoad({ scene: new Object3D() });
      }
    },
  };
});

vi.mock("react-globe.gl", async () => {
  const React = await import("react");
  const { Vector3 } = await import("three");
  interface GlobeMockProps {
    readonly htmlElement?: (datum: object) => HTMLElement;
    readonly htmlElementsData?: readonly object[];
  }
  return {
    default: React.forwardRef(function GlobeMock(
      props: GlobeMockProps,
      ref: React.ForwardedRef<object>,
    ) {
      const labels = React.useRef<HTMLDivElement>(null);
      const methods = React.useMemo(() => {
        const canvas = document.createElement("canvas");
        const renderer = {
          debug: { onShaderError: null },
          domElement: canvas,
          getContext: () => ({ isContextLost: () => false }),
        };
        return {
          controls: () => ({
            autoRotate: false,
            enableDamping: false,
            maxDistance: 0,
            minDistance: 0,
          }),
          getCoords: () => new Vector3(1, 0, 0),
          getGlobeRadius: () => 100,
          lights: () => undefined,
          pointOfView: () => undefined,
          renderer: () => renderer,
        };
      }, []);
      React.useImperativeHandle(ref, () => methods, [methods]);
      React.useLayoutEffect(() => {
        if (labels.current === null || props.htmlElement === undefined) return;
        labels.current.replaceChildren(
          ...(props.htmlElementsData ?? []).map((datum) => props.htmlElement!(datum)),
        );
      }, [props.htmlElement, props.htmlElementsData]);
      return (
        <div data-testid="globe-mock">
          <div data-testid="globe-labels" ref={labels} />
        </div>
      );
    }),
  };
});

import { ResearchGlobeCanvas } from "../../src/experience/research-map/ResearchGlobeCanvas";

const origin = {
  city: "Москва",
  country: "Россия",
  flag: "🇷🇺",
  kind: "city",
  label: "Москва",
  coordinate: { lat: 55.7558, lng: 37.6173 },
} as const;

function route(key: string, status: GlobeRoute["status"]): GlobeRoute {
  return {
    city: "Тирана",
    country: "Албания",
    description: "Маршрут",
    flag: "🇦🇱",
    from: origin.coordinate,
    key,
    kind: "city",
    label: "Тирана",
    routeLabel: "Москва → Тирана",
    status,
    to: { lat: 41.3275, lng: 19.8187 },
  };
}

afterEach(cleanup);

beforeEach(() => {
  vi.clearAllMocks();
  lifecycle.startJourney.mockImplementation(() => lifecycle.stopJourney);
});

it("does not restart an active flight when rerenders replace its route object with the same key", async () => {
  const firstFlight = route("run-1:tirana", "pending");
  const props = {
    activeFlight: firstFlight,
    onFlightComplete: () => undefined,
    onReady: () => undefined,
    onUnavailable: () => undefined,
    origin,
    overview: { coordinates: [firstFlight.from, firstFlight.to], key: 1 },
    routes: [firstFlight],
  };
  const globe = render(<ResearchGlobeCanvas {...props} />);

  await waitFor(() => expect(lifecycle.startJourney).toHaveBeenCalledOnce());

  const sameFlightKey = route("run-1:tirana", "green");
  globe.rerender(
    <ResearchGlobeCanvas {...props} activeFlight={sameFlightKey} routes={[sameFlightKey]} />,
  );

  await waitFor(() => expect(lifecycle.startJourney).toHaveBeenCalledOnce());
  expect(lifecycle.stopJourney).not.toHaveBeenCalled();

  const nextFlight = route("run-2:tirana", "pending");
  globe.rerender(
    <ResearchGlobeCanvas {...props} activeFlight={nextFlight} routes={[nextFlight]} />,
  );

  await waitFor(() => expect(lifecycle.startJourney).toHaveBeenCalledTimes(2));
  expect(lifecycle.stopJourney).toHaveBeenCalled();
});

it("opens country marker details accessibly and returns focus on Escape", async () => {
  const countryOrigin = {
    coordinate: origin.coordinate,
    country: "Россия",
    flag: "🇷🇺",
    kind: "country" as const,
    label: "Россия",
  };
  const slovenia: GlobeRoute = {
    country: "Словения",
    description: "Проверка страны",
    flag: "🇸🇮",
    from: countryOrigin.coordinate,
    key: "cold-run-1:SI",
    kind: "country",
    label: "Словения",
    rejectionReason: "Подтверждённый запрет",
    routeLabel: "Россия → Словения",
    status: "red",
    to: { lat: 46.1512, lng: 14.9955 },
  };
  render(
    <ResearchGlobeCanvas
      activeFlight={slovenia}
      onFlightComplete={() => undefined}
      onReady={() => undefined}
      onUnavailable={() => undefined}
      origin={countryOrigin}
      overview={{ coordinates: [slovenia.from, slovenia.to], key: 7 }}
      routes={[slovenia]}
    />,
  );

  const marker = await screen.findByRole("button", { name: "Открыть страну Словения" });
  const detailId = marker.getAttribute("aria-controls");
  expect(marker.getAttribute("aria-expanded")).toBe("false");
  expect(detailId).toBeTruthy();
  fireEvent.click(marker);

  const heading = screen.getByRole("heading", { name: "Словения" });
  expect(document.activeElement).toBe(heading);
  expect(screen.getByRole("dialog").id).toBe(detailId);
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

  const returnedMarker = screen.getByRole("button", { name: "Открыть страну Словения" });
  expect(returnedMarker.getAttribute("aria-expanded")).toBe("false");
  expect(document.activeElement).toBe(returnedMarker);
});
