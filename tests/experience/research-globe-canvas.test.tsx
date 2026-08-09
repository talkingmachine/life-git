// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import {
  Box3,
  BoxGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  Vector3,
} from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ResearchGlobeCanvas,
  type ResearchGlobeCanvasProps,
} from "../../src/experience/research-map/ResearchGlobeCanvas";
import * as globeCanvasModule from "../../src/experience/research-map/ResearchGlobeCanvas";
import type { RealisticEarthBundle } from "../../src/experience/research-map/realistic-earth-material";

const globeHarness = vi.hoisted(() => {
  const domElement = document.createElement("canvas");
  const renderer = {
    debug: {
      onShaderError: null as null | ((
        context: WebGLRenderingContext,
        program: WebGLProgram,
        vertexShader: WebGLShader,
        fragmentShader: WebGLShader,
      ) => void),
    },
    domElement,
    getContext: () => ({ isContextLost: () => false }),
  };
  return {
    attachCount: 0,
    controls: {
      autoRotate: true,
      enableDamping: false,
      maxDistance: 0,
      minDistance: 0,
    },
    domElement,
    detachCount: 0,
    pointOfView: vi.fn(),
    rendererInitiallyReady: true,
    renderedProps: undefined as Record<string, unknown> | undefined,
    resolveRenderer: (() => undefined) as () => void,
    renderer,
  };
});

const gltfHarness = vi.hoisted(() => ({
  autoResolve: true,
  failure: undefined as unknown,
  geometryDispose: vi.fn(),
  loadedUrls: [] as string[],
  pending: [] as {
    onError: (error: unknown) => void;
    onLoad: (result: { scene: unknown }) => void;
  }[],
}));

const earthHarness = vi.hoisted(() => {
  let resolvePromise: (bundle: unknown) => void = () => undefined;
  let rejectPromise: (error: unknown) => void = () => undefined;
  let promise = new Promise<unknown>(() => undefined);

  return {
    get promise() {
      return promise;
    },
    reject(error: unknown) {
      rejectPromise(error);
    },
    loadCalls: 0,
    load() {
      this.loadCalls += 1;
      return promise;
    },
    reset() {
      this.loadCalls = 0;
      promise = new Promise((resolve, reject) => {
        resolvePromise = resolve;
        rejectPromise = reject;
      });
    },
    resolve(bundle: unknown) {
      resolvePromise(bundle);
    },
  };
});

vi.mock("react-globe.gl", async () => {
  const React = await import("react");
  const methods = {
    controls: () => globeHarness.controls,
    getCoords: (lat: number, lng: number, altitude: number) => ({
      x: lat,
      y: lng,
      z: altitude,
    }),
    getGlobeRadius: () => 100,
    lights: vi.fn(),
    pointOfView: globeHarness.pointOfView,
    renderer: () => globeHarness.renderer,
  };

  return {
    default: React.forwardRef(function GlobeMock(props: Record<string, unknown>, ref) {
      const [rendererReady, setRendererReady] = React.useState(
        globeHarness.rendererInitiallyReady,
      );
      globeHarness.renderedProps = props;
      globeHarness.resolveRenderer = () => setRendererReady(true);
      React.useLayoutEffect(() => {
        if (!rendererReady) return;
        globeHarness.attachCount += 1;
        if (typeof ref === "function") ref(methods);
        else if (ref !== null) ref.current = methods;
        return () => {
          globeHarness.detachCount += 1;
          if (typeof ref === "function") ref(null);
          else if (ref !== null) ref.current = null;
        };
      }, [ref, rendererReady]);
      return React.createElement("div", { "data-testid": "globe-canvas" });
    }),
  };
});

vi.mock("three/examples/jsm/loaders/GLTFLoader.js", async () => {
  const { BoxGeometry, Mesh, MeshBasicMaterial, Object3D } = await import("three");
  return {
    GLTFLoader: class {
      load(
        url: string,
        onLoad: (result: { scene: InstanceType<typeof Object3D> }) => void,
        _onProgress: unknown,
        onError: (error: unknown) => void,
      ) {
        gltfHarness.loadedUrls.push(url);
        if (gltfHarness.failure !== undefined) {
          onError(gltfHarness.failure);
          return;
        }
        if (!gltfHarness.autoResolve) {
          gltfHarness.pending.push({
            onError,
            onLoad: onLoad as (result: { scene: unknown }) => void,
          });
          return;
        }
        const scene = new Object3D();
        const geometry = new BoxGeometry(2, 1, 4);
        geometry.dispose = gltfHarness.geometryDispose;
        geometry.translate(10, 20, 30);
        scene.add(new Mesh(geometry, new MeshBasicMaterial()));
        onLoad({ scene });
      }
    },
  };
});

vi.mock("../../src/experience/research-map/realistic-earth-material", () => ({
  loadRealisticEarthMaterial: () => earthHarness.load(),
}));

vi.mock("../../src/experience/research-map/research-globe-lifecycle", () => ({
  createGlobeLighting: () => ({ lights: [], sunLight: { position: new Vector3() } }),
  startSynchronizedSunCycle: () => vi.fn(),
}));

const origin = {
  city: "Москва",
  country: "Россия",
  flag: "🇷🇺",
  coordinate: { lat: 55.7558, lng: 37.6173 },
};

const firstRoute = {
  city: "Тирана",
  country: "Албания",
  description: "Идёт проверка условий переезда.",
  flag: "🇦🇱",
  key: "moscow-tirana",
  label: "Москва → Тирана",
  from: origin.coordinate,
  officialUrl: "https://example.gov.al/entry-rules",
  photoUrl: "/cities/tirana.jpg",
  rejectionReason: "Не выполнено обязательное условие сценария.",
  status: "pending" as const,
  to: { lat: 41.3275, lng: 19.8187 },
};

function createEarthBundle(): RealisticEarthBundle {
  return {
    dispose: vi.fn(),
    estimatedGpuBytes: 64,
    getSunDirection: (target) => target.set(1, 0, 0),
    material: new MeshStandardMaterial(),
    readyMs: 4,
    setSunAngle: vi.fn(),
  };
}

function createAirlinerScene(): Object3D {
  const scene = new Object3D();
  const geometry = new BoxGeometry(2, 1, 4);
  geometry.dispose = gltfHarness.geometryDispose;
  geometry.translate(10, 20, 30);
  scene.add(new Mesh(geometry, new MeshBasicMaterial()));
  return scene;
}

function resolveAircraft(): void {
  const pending = gltfHarness.pending.shift();
  if (pending === undefined) throw new Error("No pending aircraft load");
  act(() => pending.onLoad({ scene: createAirlinerScene() }));
}

function createCanvasProps(
  overrides: Partial<ResearchGlobeCanvasProps> = {},
): ResearchGlobeCanvasProps {
  return {
    onFlightComplete: vi.fn(),
    onReady: vi.fn(),
    onUnavailable: vi.fn(),
    origin,
    overview: { key: 1, coordinates: [origin.coordinate, firstRoute.to] },
    routes: [firstRoute],
    ...overrides,
  };
}

beforeEach(() => {
  earthHarness.reset();
  globeHarness.attachCount = 0;
  globeHarness.controls.autoRotate = true;
  globeHarness.controls.enableDamping = false;
  globeHarness.controls.maxDistance = 0;
  globeHarness.controls.minDistance = 0;
  globeHarness.detachCount = 0;
  globeHarness.pointOfView.mockClear();
  globeHarness.rendererInitiallyReady = true;
  globeHarness.renderedProps = undefined;
  globeHarness.resolveRenderer = () => undefined;
  globeHarness.renderer.debug.onShaderError = null;
  gltfHarness.autoResolve = true;
  gltfHarness.failure = undefined;
  gltfHarness.loadedUrls.length = 0;
  gltfHarness.pending.length = 0;
  gltfHarness.geometryDispose.mockClear();
  vi.stubGlobal("requestAnimationFrame", vi.fn(() => 71));
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.stubGlobal("matchMedia", vi.fn(() => ({
    addEventListener: vi.fn(),
    matches: false,
    removeEventListener: vi.fn(),
  })));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ResearchGlobeCanvas", () => {
  it("orients the aircraft along the full three-dimensional trajectory", () => {
    const orientPlaneAlongPath = (globeCanvasModule as unknown as {
      orientPlaneAlongPath: (plane: Object3D, current: Vector3, next: Vector3) => void;
    }).orientPlaneAlongPath;
    const plane = new Object3D();
    const current = new Vector3(10, 0, 0);
    const next = new Vector3(11, 2, 0);

    orientPlaneAlongPath(plane, current, next);

    const forward = new Vector3(1, 0, 0).applyQuaternion(plane.quaternion).normalize();
    expect(forward.toArray()).toEqual(expect.arrayContaining([
      expect.closeTo(1 / Math.sqrt(5), 5),
      expect.closeTo(2 / Math.sqrt(5), 5),
      expect.closeTo(0, 5),
    ]));
  });

  it("reports ready once only after independently pending renderer, Earth, and aircraft", async () => {
    globeHarness.rendererInitiallyReady = false;
    gltfHarness.autoResolve = false;
    const firstOnReady = vi.fn();
    const latestOnReady = vi.fn();
    const bundle = createEarthBundle();
    const { rerender } = render(
      <ResearchGlobeCanvas {...createCanvasProps({ onReady: firstOnReady })} />,
    );

    await waitFor(() => expect(gltfHarness.loadedUrls).toEqual(["/models/research-airliner.glb"]));
    rerender(<ResearchGlobeCanvas {...createCanvasProps({ onReady: latestOnReady })} />);
    expect(firstOnReady).not.toHaveBeenCalled();
    expect(latestOnReady).not.toHaveBeenCalled();

    earthHarness.resolve(bundle);
    await act(async () => Promise.resolve());
    expect(latestOnReady).not.toHaveBeenCalled();

    resolveAircraft();
    expect(latestOnReady).not.toHaveBeenCalled();

    act(() => globeHarness.resolveRenderer());
    await waitFor(() => expect(latestOnReady).toHaveBeenCalledOnce());
    expect(firstOnReady).not.toHaveBeenCalled();
    expect(globeHarness.renderedProps?.globeMaterial).toBe(bundle.material);

    rerender(<ResearchGlobeCanvas {...createCanvasProps({ onReady: vi.fn() })} />);
    await act(async () => Promise.resolve());
    expect(latestOnReady).toHaveBeenCalledOnce();
  });

  it("turns an Earth asset rejection into a mandatory globe failure", async () => {
    const onUnavailable = vi.fn();
    const error = new Error("night texture missing");
    render(<ResearchGlobeCanvas {...createCanvasProps({ onUnavailable })} />);

    earthHarness.reject(error);

    await waitFor(() => expect(onUnavailable).toHaveBeenCalledWith("earth-material", error));
  });

  it("turns an aircraft rejection into a mandatory globe failure", async () => {
    const onReady = vi.fn();
    const onUnavailable = vi.fn();
    const error = new Error("airliner missing");
    gltfHarness.failure = error;
    earthHarness.resolve(createEarthBundle());

    render(<ResearchGlobeCanvas {...createCanvasProps({ onReady, onUnavailable })} />);

    await waitFor(() => expect(onUnavailable).toHaveBeenCalledWith("model-load", error));
    expect(onReady).not.toHaveBeenCalled();
  });

  it("turns realistic Earth shader compilation failure into a mandatory globe failure", async () => {
    const onUnavailable = vi.fn();
    earthHarness.resolve(createEarthBundle());
    render(<ResearchGlobeCanvas {...createCanvasProps({ onUnavailable })} />);
    await waitFor(() => expect(globeHarness.renderer.debug.onShaderError).toBeTypeOf("function"));

    const context = {
      getShaderSource: () => "uniform sampler2D earthNightMap;",
    } as unknown as WebGLRenderingContext;
    act(() => globeHarness.renderer.debug.onShaderError?.(
      context,
      {} as WebGLProgram,
      {} as WebGLShader,
      {} as WebGLShader,
    ));

    expect(onUnavailable).toHaveBeenCalledWith(
      "earth-material",
      expect.objectContaining({ message: "Realistic Earth shader compilation failed" }),
    );
  });

  it("does not create or execute a hidden flight while any independent prerequisite is pending", async () => {
    globeHarness.rendererInitiallyReady = false;
    gltfHarness.autoResolve = false;
    const onFlightComplete = vi.fn();
    const onReady = vi.fn();
    render(
      <ResearchGlobeCanvas
        {...createCanvasProps({ activeFlight: firstRoute, onFlightComplete, onReady })}
      />,
    );

    const aircraftIsVisible = () => (globeHarness.renderedProps?.customLayerData as readonly {
      readonly kind: string;
    }[]).some((datum) => datum.kind === "aircraft");
    expect(aircraftIsVisible()).toBe(false);
    expect(onFlightComplete).not.toHaveBeenCalled();

    act(() => globeHarness.resolveRenderer());
    await waitFor(() => expect(globeHarness.pointOfView).toHaveBeenCalled());
    expect(aircraftIsVisible()).toBe(false);
    expect(onReady).not.toHaveBeenCalled();

    earthHarness.resolve(createEarthBundle());
    await act(async () => Promise.resolve());
    expect(aircraftIsVisible()).toBe(false);
    expect(onReady).not.toHaveBeenCalled();

    resolveAircraft();
    await waitFor(() => expect(aircraftIsVisible()).toBe(true));
    expect(onReady).toHaveBeenCalledOnce();
    expect(onFlightComplete).not.toHaveBeenCalled();
  });

  it("frames each overview once and never follows active-flight changes", async () => {
    const props = createCanvasProps({
      overview: { key: 1, coordinates: [{ lat: 0, lng: 170 }, { lat: 0, lng: -170 }] },
    });
    const { rerender } = render(<ResearchGlobeCanvas {...props} />);
    await waitFor(() => expect(globeHarness.pointOfView).toHaveBeenCalledTimes(2));
    expect(globeHarness.pointOfView).toHaveBeenNthCalledWith(
      2,
      { lat: 0, lng: 180, altitude: 1.1 },
      850,
    );

    rerender(<ResearchGlobeCanvas {...props} activeFlight={firstRoute} />);
    await act(async () => Promise.resolve());
    expect(globeHarness.pointOfView).toHaveBeenCalledTimes(2);

    rerender(
      <ResearchGlobeCanvas
        {...props}
        activeFlight={firstRoute}
        overview={{ key: 2, coordinates: [{ lat: 0, lng: 0 }, { lat: 0, lng: 90 }] }}
      />,
    );
    await waitFor(() => expect(globeHarness.pointOfView).toHaveBeenCalledTimes(3));
    expect(globeHarness.pointOfView).toHaveBeenLastCalledWith(
      { lat: 0, lng: 45, altitude: 1.1 },
      850,
    );
  });

  it("locks automatic rotation and configures the approved manual zoom range", async () => {
    render(<ResearchGlobeCanvas {...createCanvasProps({ routes: [] })} />);

    await waitFor(() => expect(globeHarness.pointOfView).toHaveBeenCalled());
    expect(globeHarness.pointOfView).toHaveBeenNthCalledWith(
      1,
      { lat: 50, lng: 26, altitude: 1.85 },
      0,
    );
    expect(globeHarness.controls).toEqual({
      autoRotate: false,
      enableDamping: true,
      minDistance: 182,
      maxDistance: 235,
    });
  });

  it("centers and normalizes the approved local airliner model", async () => {
    earthHarness.resolve(createEarthBundle());
    render(
      <ResearchGlobeCanvas {...createCanvasProps({ activeFlight: firstRoute })} />,
    );

    await waitFor(() => {
      const data = globeHarness.renderedProps?.customLayerData as readonly {
        readonly key: string;
      }[];
      expect(data.some((datum) => datum.key === firstRoute.key)).toBe(true);
    });
    const data = globeHarness.renderedProps?.customLayerData as readonly {
      readonly key: string;
      readonly object: Object3D;
    }[];
    const airliner = data.find((datum) => datum.key === firstRoute.key)?.object;
    const bounds = new Box3().setFromObject(airliner!);
    const size = bounds.getSize(new Vector3());
    const center = bounds.getCenter(new Vector3());
    expect(Math.max(size.x, size.y, size.z)).toBeCloseTo(5.5);
    expect(center.toArray()).toEqual([
      expect.closeTo(0, 5),
      expect.closeTo(0, 5),
      expect.closeTo(0, 5),
    ]);
    expect(airliner!.children[0]!.rotation.y).toBeCloseTo(Math.PI / 2);
  });

  it("fades the aircraft over its final 200 ms and removes it at landing", async () => {
    const callbacks = new Map<number, FrameRequestCallback>();
    let nextHandle = 0;
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
      const handle = ++nextHandle;
      callbacks.set(handle, callback);
      return handle;
    }));
    earthHarness.resolve(createEarthBundle());
    render(
      <ResearchGlobeCanvas {...createCanvasProps({ activeFlight: firstRoute })} />,
    );

    await waitFor(() => expect(callbacks.size).toBeGreaterThan(0));
    const data = globeHarness.renderedProps?.customLayerData as readonly {
      readonly kind: string;
      readonly object: Object3D;
    }[];
    const aircraft = data.find((datum) => datum.kind === "aircraft")?.object;
    const scene = new Group();
    scene.add(aircraft!);
    let planeMaterial: Mesh["material"] | undefined;
    aircraft?.traverse((child) => {
      if (planeMaterial === undefined && child instanceof Mesh) planeMaterial = child.material;
    });
    if (planeMaterial === undefined || Array.isArray(planeMaterial)) {
      throw new Error("Expected one aircraft material");
    }

    act(() => callbacks.get(1)?.(0));
    act(() => callbacks.get(2)?.(850));
    expect(planeMaterial.opacity).toBeCloseTo(1);
    act(() => callbacks.get(3)?.(950));
    expect(planeMaterial.opacity).toBeCloseTo(0.5);
    expect(planeMaterial.transparent).toBe(true);
    expect(planeMaterial.depthWrite).toBe(false);
    act(() => callbacks.get(4)?.(1_050));

    expect(planeMaterial.opacity).toBe(0);
    expect(aircraft?.parent).toBeNull();
    expect(callbacks.has(5)).toBe(true);
  });

  it("invalidates aircraft material only when fade flags change", async () => {
    const callbacks = new Map<number, FrameRequestCallback>();
    let nextHandle = 0;
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
      const handle = ++nextHandle;
      callbacks.set(handle, callback);
      return handle;
    }));
    earthHarness.resolve(createEarthBundle());
    render(
      <ResearchGlobeCanvas {...createCanvasProps({ activeFlight: firstRoute })} />,
    );

    await waitFor(() => expect(callbacks.size).toBeGreaterThan(0));
    const data = globeHarness.renderedProps?.customLayerData as readonly {
      readonly kind: string;
      readonly object: Object3D;
    }[];
    const aircraft = data.find((datum) => datum.kind === "aircraft")?.object;
    let planeMaterial: Mesh["material"] | undefined;
    aircraft?.traverse((child) => {
      if (planeMaterial === undefined && child instanceof Mesh) planeMaterial = child.material;
    });
    if (planeMaterial === undefined || Array.isArray(planeMaterial)) {
      throw new Error("Expected one aircraft material");
    }

    const opaqueVersion = planeMaterial.version;
    act(() => callbacks.get(1)?.(0));
    act(() => callbacks.get(2)?.(850));
    expect(planeMaterial.opacity).toBe(1);
    expect(planeMaterial.transparent).toBe(false);
    expect(planeMaterial.depthWrite).toBe(true);
    expect(planeMaterial.version).toBe(opaqueVersion);

    act(() => callbacks.get(3)?.(950));
    const fadingVersion = planeMaterial.version;
    expect(planeMaterial.transparent).toBe(true);
    expect(planeMaterial.depthWrite).toBe(false);
    expect(fadingVersion).toBe(opaqueVersion + 1);

    act(() => callbacks.get(4)?.(975));
    expect(planeMaterial.opacity).toBeGreaterThan(0);
    expect(planeMaterial.opacity).toBeLessThan(0.5);
    expect(planeMaterial.version).toBe(fadingVersion);
  });

  it("persists completed route visuals after the active flight clears", async () => {
    earthHarness.resolve(createEarthBundle());
    const props = createCanvasProps({ activeFlight: firstRoute });
    const { rerender } = render(<ResearchGlobeCanvas {...props} />);
    await waitFor(() => {
      const data = globeHarness.renderedProps?.customLayerData as readonly unknown[];
      expect(data.length).toBe(2);
    });

    rerender(<ResearchGlobeCanvas {...props} activeFlight={undefined} />);
    await waitFor(() => {
      const data = globeHarness.renderedProps?.customLayerData as readonly {
        readonly kind: string;
      }[];
      expect(data).toHaveLength(1);
      expect(data[0]?.kind).toBe("trail");
    });
    expect(globeHarness.renderedProps).not.toHaveProperty("arcsData");
    expect(globeHarness.renderedProps).not.toHaveProperty("pointsData");
    expect(globeHarness.renderedProps).not.toHaveProperty("ringsData");
  });

  it("keeps assets, renderer ref, and active journey stable across callback-only rerenders", async () => {
    const callbacks = new Map<number, FrameRequestCallback>();
    const activeHandles = new Set<number>();
    let nextHandle = 0;
    const requestFrame = vi.fn((callback: FrameRequestCallback) => {
      const handle = ++nextHandle;
      callbacks.set(handle, callback);
      activeHandles.add(handle);
      return handle;
    });
    const cancelFrame = vi.fn((handle: number) => activeHandles.delete(handle));
    vi.stubGlobal("requestAnimationFrame", requestFrame);
    vi.stubGlobal("cancelAnimationFrame", cancelFrame);
    const runLatestFrame = (timestamp: number) => {
      const handle = [...activeHandles].at(-1);
      if (handle === undefined) throw new Error("No active animation frame");
      activeHandles.delete(handle);
      act(() => callbacks.get(handle)?.(timestamp));
    };
    const bundle = createEarthBundle();
    const firstOnReady = vi.fn();
    const firstOnFlightComplete = vi.fn();
    const firstOnUnavailable = vi.fn();
    const latestOnReady = vi.fn();
    const latestOnFlightComplete = vi.fn();
    const latestOnUnavailable = vi.fn();
    earthHarness.resolve(bundle);
    const stableProps = {
      activeFlight: firstRoute,
      origin,
      overview: { key: 1, coordinates: [origin.coordinate, firstRoute.to] },
      routes: [firstRoute],
    };
    const { rerender } = render(
      <ResearchGlobeCanvas
        {...stableProps}
        onFlightComplete={firstOnFlightComplete}
        onReady={firstOnReady}
        onUnavailable={firstOnUnavailable}
      />,
    );
    await waitFor(() => expect(firstOnReady).toHaveBeenCalledOnce());
    await waitFor(() => expect(activeHandles.size).toBe(1));
    runLatestFrame(0);

    rerender(
      <ResearchGlobeCanvas
        {...stableProps}
        onFlightComplete={latestOnFlightComplete}
        onReady={latestOnReady}
        onUnavailable={latestOnUnavailable}
      />,
    );
    await act(async () => Promise.resolve());

    expect(earthHarness.loadCalls).toBe(1);
    expect(gltfHarness.loadedUrls).toEqual(["/models/research-airliner.glb"]);
    expect(bundle.dispose).not.toHaveBeenCalled();
    expect(gltfHarness.geometryDispose).not.toHaveBeenCalled();
    expect(globeHarness.attachCount).toBe(1);
    expect(globeHarness.detachCount).toBe(0);
    expect(cancelFrame).not.toHaveBeenCalled();
    expect(firstOnReady).toHaveBeenCalledOnce();
    expect(latestOnReady).not.toHaveBeenCalled();

    runLatestFrame(1_050);
    runLatestFrame(1_050);
    runLatestFrame(1_300);
    expect(firstOnFlightComplete).not.toHaveBeenCalled();
    expect(latestOnFlightComplete).toHaveBeenCalledWith(firstRoute.key);

    globeHarness.domElement.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    expect(firstOnUnavailable).not.toHaveBeenCalled();
    expect(latestOnUnavailable).toHaveBeenCalledWith("context-lost");
  });

  it("renders origin and destination balloons plus an unmodified official source link", async () => {
    const route = { ...firstRoute, status: "red" as const };
    render(<ResearchGlobeCanvas {...createCanvasProps({ routes: [route] })} />);
    await waitFor(() => expect(globeHarness.renderedProps?.htmlElementsData).toBeDefined());

    const labels = globeHarness.renderedProps?.htmlElementsData as readonly Record<string, unknown>[];
    expect(labels).toHaveLength(2);
    expect(labels.every((label) => label.altitude === 0)).toBe(true);
    const htmlElement = globeHarness.renderedProps?.htmlElement as (datum: object) => HTMLElement;
    const originBalloon = htmlElement(
      labels.find((label) => label.kind === "origin")!,
    ).firstElementChild as HTMLElement;
    expect(originBalloon.tagName).toBe("DIV");
    expect(originBalloon.getAttribute("role")).toBe("note");
    expect(originBalloon.textContent).toBe("🇷🇺Москва");

    const destinationLabel = labels.find((label) => label.kind === "destination")!;
    const destinationBalloon = htmlElement(destinationLabel).firstElementChild as HTMLElement;
    expect(destinationBalloon.tagName).toBe("BUTTON");
    expect(destinationBalloon.className).toContain("cityBalloonRed");
    fireEvent.click(destinationBalloon);

    const dialog = screen.getByRole("dialog", { name: "Тирана" });
    expect(within(dialog).getByText(firstRoute.rejectionReason)).toBeTruthy();
    const source = within(dialog).getByRole("link", { name: "Официальный источник" });
    expect(source.getAttribute("href")).toBe(firstRoute.officialUrl);
    await waitFor(() => expect(globeHarness.pointOfView).toHaveBeenLastCalledWith(
      { lat: firstRoute.to.lat, lng: firstRoute.to.lng, altitude: 1.1 },
      650,
    ));
  });

  it("keeps yellow evidence reason beside its unmodified official source link", async () => {
    const route = {
      ...firstRoute,
      rejectionReason: "Официальное подтверждение требования не найдено.",
      status: "yellow" as const,
    };
    render(<ResearchGlobeCanvas {...createCanvasProps({ routes: [route] })} />);
    await waitFor(() => expect(globeHarness.renderedProps?.htmlElementsData).toBeDefined());
    const labels = globeHarness.renderedProps?.htmlElementsData as readonly Record<string, unknown>[];
    const htmlElement = globeHarness.renderedProps?.htmlElement as (datum: object) => HTMLElement;
    const destinationBalloon = htmlElement(
      labels.find((label) => label.kind === "destination")!,
    ).firstElementChild as HTMLElement;

    fireEvent.click(destinationBalloon);

    const dialog = screen.getByRole("dialog", { name: "Тирана" });
    expect(within(dialog).getByText(route.rejectionReason)).toBeTruthy();
    expect(within(dialog).getByRole("link", { name: "Официальный источник" }).getAttribute("href"))
      .toBe(route.officialUrl);
  });

  it("shows the unmodified official source link with a green route photo", async () => {
    const route = { ...firstRoute, status: "green" as const };
    render(<ResearchGlobeCanvas {...createCanvasProps({ routes: [route] })} />);
    await waitFor(() => expect(globeHarness.renderedProps?.htmlElementsData).toBeDefined());
    const labels = globeHarness.renderedProps?.htmlElementsData as readonly Record<string, unknown>[];
    const htmlElement = globeHarness.renderedProps?.htmlElement as (datum: object) => HTMLElement;
    const destinationBalloon = htmlElement(
      labels.find((label) => label.kind === "destination")!,
    ).firstElementChild as HTMLElement;

    fireEvent.click(destinationBalloon);

    const dialog = screen.getByRole("dialog", { name: "Тирана" });
    expect(within(dialog).getByRole("img", { name: "Тирана" }).getAttribute("src"))
      .toBe(route.photoUrl);
    expect(within(dialog).getByRole("link", { name: "Официальный источник" }).getAttribute("href"))
      .toBe(route.officialUrl);
  });

  it("reports WebGL context loss", async () => {
    const onUnavailable = vi.fn();
    render(<ResearchGlobeCanvas {...createCanvasProps({ onUnavailable })} />);
    await waitFor(() => expect(globeHarness.pointOfView).toHaveBeenCalled());

    globeHarness.domElement.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));

    expect(onUnavailable).toHaveBeenCalledWith("context-lost");
  });

  it("reports ready before completing the full journey under reduced motion", async () => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({
      addEventListener: vi.fn(),
      matches: true,
      removeEventListener: vi.fn(),
    })));
    const events: string[] = [];
    earthHarness.resolve(createEarthBundle());
    render(
      <ResearchGlobeCanvas
        {...createCanvasProps({
          activeFlight: firstRoute,
          onFlightComplete: (flightKey) => events.push(`complete:${flightKey}`),
          onReady: () => events.push("ready"),
        })}
      />,
    );

    await waitFor(() => expect(events).toContain(`complete:${firstRoute.key}`));
    expect(events).toEqual(["ready", `complete:${firstRoute.key}`]);
  });

  it("disposes loaded Earth and aircraft resources during cleanup", async () => {
    const bundle = createEarthBundle();
    earthHarness.resolve(bundle);
    const { unmount } = render(<ResearchGlobeCanvas {...createCanvasProps()} />);
    await waitFor(() => expect(globeHarness.renderedProps?.globeMaterial).toBe(bundle.material));
    unmount();

    expect(bundle.dispose).toHaveBeenCalledOnce();
    expect(gltfHarness.geometryDispose).toHaveBeenCalledOnce();
    expect(globeHarness.renderer.debug.onShaderError).toBeNull();
  });
});
