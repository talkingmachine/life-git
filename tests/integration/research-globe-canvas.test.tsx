// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Vector3 as ThreeVector3 } from "three";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { GlobeRoute } from "../../src/experience/research-map/contracts";
import { projectPlaceFrontierView, type PlaceFrontierScreenState } from
  "../../src/experience/place-frontier-view-model";
import type { FrontierMarker } from "../../src/application/place-frontier";
import { assessFormalResidence } from "../../src/decision/formal-residence-verdict";
import type { PlaceFrontierEventState } from "../../src/experience/place-frontier-stream";

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
        const stopGlobeBubble = (event: Event) => event.stopPropagation();
        labels.current.addEventListener("click", stopGlobeBubble);
        labels.current.addEventListener("pointerdown", stopGlobeBubble);
        let replaceLabels: number | undefined;
        const scheduleReplacement = window.requestAnimationFrame(() => {
          replaceLabels = window.requestAnimationFrame(() => {
            labels.current?.replaceChildren(
              ...(props.htmlElementsData ?? []).map((datum) => props.htmlElement!(datum).cloneNode(true)),
            );
          });
        });
        return () => {
          window.cancelAnimationFrame(scheduleReplacement);
          if (replaceLabels !== undefined) window.cancelAnimationFrame(replaceLabels);
          labels.current?.removeEventListener("click", stopGlobeBubble);
          labels.current?.removeEventListener("pointerdown", stopGlobeBubble);
        };
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

function nextAnimationFrame(): Promise<void> {
  return new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
}

async function nextRendererFrame(): Promise<void> {
  await nextAnimationFrame();
  await nextAnimationFrame();
}

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

it("keeps five rapid frontier activations and a red replacement visible as planet markers", async () => {
  const countries: PlaceFrontierEventState["countries"] = ["AA", "BB", "CC", "DD", "EE", "FF"]
    .map((code, index) => ({
      country: {
        countryCode: code,
        label: `Country ${code}`,
        flag: `flag-${code}`,
        coordinate: { lat: 40 + index, lng: 10 + index },
      },
      rank: index + 1,
    }));
  const runningState = (activated: PlaceFrontierEventState["countries"]): PlaceFrontierScreenState => ({
    kind: "running",
    runId: "frontier-run-rapid",
    stream: {
      events: [],
      lastSequence: 1 + activated.length,
      runId: "frontier-run-rapid",
      countries: activated,
    },
  });
  const firstFive = projectPlaceFrontierView(runningState(countries.slice(0, 5)));
  const props = {
    onFlightComplete: () => undefined,
    onReady: () => undefined,
    onUnavailable: () => undefined,
  };
  const globe = render(<ResearchGlobeCanvas {...props} {...firstFive.globe} />);

  await nextRendererFrame();
  for (const code of ["AA", "BB", "CC", "DD", "EE"]) {
    expect(screen.getByRole("note", { name: new RegExp(`Country ${code}.*провер`) })).toBeTruthy();
  }

  const evidenceSnapshotId = "evidence-AA";
  const evidence = {
    evidenceSnapshotId,
    artifactId: "artifact-AA",
    sourceId: "source-AA",
    navigationUrl: "https://evidence.test/AA",
    resolvedEvidenceUrl: "https://evidence.test/AA.pdf",
    sourcePeriod: "2026-08",
    locator: "section-AA",
    excerptSha256: "a".repeat(64),
    validatorVersion: "fixture-validator@1",
  };
  const rejectedMarker: FrontierMarker = {
    country: countries[0]!.country,
    rank: 1,
    countryCheckRunId: `frontier-country:${"1".repeat(64)}`,
    sourceAssessmentRulesVersion: "cold-start-assessment@1",
    lastCheckedAt: "2026-08-12",
    evidenceSnapshotId,
    formalVerdict: assessFormalResidence({
      profileSnapshotId: "profile-AA",
      verdictAsOf: "2026-08-12",
      routes: [],
      completeness: {
        catalogRevisionId: "catalog-AA",
        jurisdiction: "AA",
        authority: "Authority AA",
        scopeKind: "all_long_term_residence_routes_for_profile",
        profileSnapshotId: "profile-AA",
        catalogRoutes: [{
          routeId: "excluded-AA",
          applicability: "excluded",
          exclusionCode: "profile_not_eligible",
          claimIds: ["claim-AA"],
          evidence: [evidence],
        }],
        validatorVersion: "catalog-validator@1",
        effectiveFrom: "2026-01-01",
        evidenceSnapshotId,
        catalogEvidence: [evidence],
      },
    }),
  };
  const rejectedFirst = {
    ...countries[0]!,
    completed: rejectedMarker,
  };
  const withReplacement = projectPlaceFrontierView(runningState([
    rejectedFirst,
    ...countries.slice(1),
  ]));
  globe.rerender(<ResearchGlobeCanvas {...props} {...withReplacement.globe} />);

  await nextRendererFrame();
  expect(screen.getByRole("button", { name: "Открыть страну Country AA" })).toBeTruthy();
  for (const code of ["BB", "CC", "DD", "EE", "FF"]) {
    expect(screen.getByRole("note", { name: new RegExp(`Country ${code}.*провер`) })).toBeTruthy();
  }
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

it("keeps cloned country marker focus through mouse and native keyboard closure", async () => {
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
  expect(marker.parentElement).toBe(screen.getByTestId("globe-labels"));
  const detailId = marker.getAttribute("aria-controls");
  expect(marker.getAttribute("aria-expanded")).toBe("false");
  expect(detailId).toBeTruthy();
  fireEvent.keyDown(marker, { key: "ArrowDown" });
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(marker);

  const heading = screen.getByRole("heading", { name: "Словения" });
  expect(document.activeElement).toBe(heading);
  expect(screen.getByRole("dialog").id).toBe(detailId);
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  await nextRendererFrame();

  const returnedMarker = screen.getByRole("button", { name: "Открыть страну Словения" });
  expect(returnedMarker.getAttribute("aria-expanded")).toBe("false");
  expect(document.activeElement).toBe(returnedMarker);
  fireEvent.keyDown(returnedMarker, { key: "Enter" });
  expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Словения" }));
  fireEvent.click(screen.getByRole("button", { name: "Закрыть карточку" }));
  await nextRendererFrame();
  const markerAfterClose = screen.getByRole("button", { name: "Открыть страну Словения" });
  expect(document.activeElement).toBe(markerAfterClose);
  expect(fireEvent.keyDown(markerAfterClose, { key: " " })).toBe(false);
  expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Словения" }));
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  await nextRendererFrame();
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Открыть страну Словения" }));
});

it("moves focus to a remaining marker or the globe when a selected marker is removed", async () => {
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
  const slovakia: GlobeRoute = {
    ...slovenia,
    country: "Словакия",
    flag: "🇸🇰",
    key: "cold-run-1:SK",
    label: "Словакия",
    routeLabel: "Россия → Словакия",
    to: { lat: 48.669, lng: 19.699 },
  };
  const globe = render(
    <ResearchGlobeCanvas
      activeFlight={slovenia}
      onFlightComplete={() => undefined}
      onReady={() => undefined}
      onUnavailable={() => undefined}
      origin={countryOrigin}
      overview={{ coordinates: [slovenia.from, slovenia.to, slovakia.to], key: 8 }}
      routes={[slovenia, slovakia]}
    />,
  );

  fireEvent.click(await screen.findByRole("button", { name: "Открыть страну Словения" }));
  expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Словения" }));

  globe.rerender(
    <ResearchGlobeCanvas
      activeFlight={slovakia}
      onFlightComplete={() => undefined}
      onReady={() => undefined}
      onUnavailable={() => undefined}
      origin={countryOrigin}
      overview={{ coordinates: [slovakia.from, slovakia.to], key: 8 }}
      routes={[slovakia]}
    />,
  );

  await nextRendererFrame();
  const remainingMarker = screen.getByRole("button", { name: "Открыть страну Словакия" });
  await waitFor(() => expect(document.activeElement).toBe(remainingMarker));

  fireEvent.click(remainingMarker);
  expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Словакия" }));

  globe.rerender(
    <ResearchGlobeCanvas
      onFlightComplete={() => undefined}
      onReady={() => undefined}
      onUnavailable={() => undefined}
      origin={countryOrigin}
      overview={{ coordinates: [countryOrigin.coordinate], key: 8 }}
      routes={[]}
    />,
  );

  await waitFor(() => {
    expect(document.activeElement).toBe(screen.getByRole("region", { name: "Глобус маршрутов" }));
  });
});

it("returns focus to a cloned marker when a new overview clears its details", async () => {
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
  const globe = render(
    <ResearchGlobeCanvas
      activeFlight={slovenia}
      onFlightComplete={() => undefined}
      onReady={() => undefined}
      onUnavailable={() => undefined}
      origin={countryOrigin}
      overview={{ coordinates: [slovenia.from, slovenia.to], key: 9 }}
      routes={[slovenia]}
    />,
  );

  fireEvent.click(await screen.findByRole("button", { name: "Открыть страну Словения" }));
  expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Словения" }));

  globe.rerender(
    <ResearchGlobeCanvas
      activeFlight={slovenia}
      onFlightComplete={() => undefined}
      onReady={() => undefined}
      onUnavailable={() => undefined}
      origin={countryOrigin}
      overview={{ coordinates: [slovenia.from, slovenia.to], key: 10 }}
      routes={[slovenia]}
    />,
  );

  await nextRendererFrame();
  const marker = screen.getByRole("button", { name: "Открыть страну Словения" });
  await waitFor(() => expect(document.activeElement).toBe(marker));
});

it("makes only red and yellow frontier markers interactive and closes a selected route that becomes green", async () => {
  lifecycle.startJourney.mockImplementation((options: { onDestinationReveal: () => void }) => {
    options.onDestinationReveal();
    return lifecycle.stopJourney;
  });
  const countryOrigin = {
    coordinate: origin.coordinate,
    country: "Россия",
    flag: "🇷🇺",
    kind: "country" as const,
    label: "Россия",
  };
  const frontierRoute = (
    key: string,
    label: string,
    status: GlobeRoute["status"],
    latitude: number,
  ): GlobeRoute => ({
    country: label,
    description: `Проверка: ${label}`,
    flag: "🌐",
    from: countryOrigin.coordinate,
    key,
    kind: "country",
    label,
    routeLabel: `Россия → ${label}`,
    status,
    to: { lat: latitude, lng: 15 },
  });
  const pending = {
    ...frontierRoute("run-1:pending", "Ожидание", "pending", 44),
    statusLabel: "Проверяется",
  };
  const green = frontierRoute("run-1:green", "Доступно", "green", 45);
  const yellow = {
    ...frontierRoute("run-1:yellow", "Уточнить", "yellow", 46),
    rejectionReason: "Нужна ручная проверка",
    officialUrl: "https://evidence.test/one",
    officialUrls: ["https://evidence.test/one", "https://evidence.test/two"],
    manualCheckLinks: [{ label: "Навигация", url: "https://manual.test/one" }],
    statusLabel: "Требует решения",
  };
  const red = {
    ...frontierRoute("run-1:red", "Недоступно", "red", 47),
    statusLabel: "Исключено",
  };
  const props = {
    activeFlight: pending,
    onFlightComplete: () => undefined,
    onReady: () => undefined,
    onUnavailable: () => undefined,
    origin: countryOrigin,
    overview: {
      coordinates: [countryOrigin.coordinate, pending.to, green.to, yellow.to, red.to],
      key: 20,
    },
  };
  const globe = render(
    <ResearchGlobeCanvas {...props} routes={[pending, green, yellow, red]} />,
  );

  expect(await screen.findByRole("button", { name: "Открыть страну Уточнить" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Открыть страну Недоступно" })).toBeTruthy();
  expect(screen.getAllByRole("button", { name: /Открыть страну/ })).toHaveLength(2);
  expect(screen.getByRole("note", { name: /Ожидание.*Проверяется/i })).toBeTruthy();
  expect(screen.getByRole("note", { name: /Доступно.*формально доступно/i })).toBeTruthy();

  const yellowMarker = screen.getByRole("button", { name: "Открыть страну Уточнить" });
  fireEvent.keyDown(yellowMarker, { key: "Enter" });
  expect(screen.getByRole("dialog")).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Evidence" })).toBeTruthy();
  expect(screen.getAllByRole("link", { name: /официальный источник/i })).toHaveLength(2);
  expect(screen.getByRole("heading", { name: "Проверьте вручную" })).toBeTruthy();
  expect(screen.getByRole("link", { name: "Навигация" })).toBeTruthy();
  expect(screen.getByText("Требует решения")).toBeTruthy();

  globe.rerender(
    <ResearchGlobeCanvas
      {...props}
      routes={[pending, green, { ...yellow, status: "green" }, red]}
    />,
  );
  await nextRendererFrame();
  expect(screen.queryByRole("dialog")).toBeNull();
  await waitFor(() => expect(document.activeElement).toBe(
    screen.getByRole("button", { name: "Открыть страну Недоступно" }),
  ));
});

it("does not steal focus from a newer resolution prompt after deferred marker closure", async () => {
  const countryOrigin = {
    coordinate: origin.coordinate,
    country: "Россия",
    flag: "🇷🇺",
    kind: "country" as const,
    label: "Россия",
  };
  const yellow: GlobeRoute = {
    country: "Словения",
    description: "Нужна ручная проверка",
    flag: "🇸🇮",
    from: countryOrigin.coordinate,
    key: "resolution-run:SI",
    kind: "country",
    label: "Словения",
    routeLabel: "Россия → Словения",
    status: "yellow",
    statusLabel: "Требует решения",
    to: { lat: 46.1512, lng: 14.9955 },
  };
  const red: GlobeRoute = {
    ...yellow,
    country: "Словакия",
    flag: "🇸🇰",
    key: "resolution-run:SK",
    label: "Словакия",
    status: "red",
    statusLabel: "Исключено",
    to: { lat: 48.669, lng: 19.699 },
  };
  const props = {
    onFlightComplete: () => undefined,
    onReady: () => undefined,
    onUnavailable: () => undefined,
    origin: countryOrigin,
    overview: { coordinates: [countryOrigin.coordinate, yellow.to, red.to], key: 30 },
  };
  const globe = render(
    <>
      <h2 data-testid="next-resolution-prompt" tabIndex={-1}>Решение по стране Словакия</h2>
      <ResearchGlobeCanvas {...props} routes={[yellow, red]} />
    </>,
  );

  fireEvent.click(await screen.findByRole("button", { name: "Открыть страну Словения" }));
  expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Словения" }));

  globe.rerender(
    <>
      <h2 data-testid="next-resolution-prompt" tabIndex={-1}>Решение по стране Словакия</h2>
      <ResearchGlobeCanvas
        {...props}
        routes={[{ ...yellow, status: "green", statusLabel: "Доступно для выбора" }, red]}
      />
    </>,
  );
  const nextPrompt = screen.getByTestId("next-resolution-prompt");
  nextPrompt.focus();
  await nextRendererFrame();

  expect(document.activeElement).toBe(nextPrompt);
  expect(screen.getByRole("note", { name: /Словения.*доступно для выбора/i })).toBeTruthy();
  expect(props.overview.key).toBe(30);
  expect(yellow.key).toBe("resolution-run:SI");
});
