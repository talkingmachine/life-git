import {
  BufferAttribute,
  BufferGeometry,
  Group,
  Line,
  LineBasicMaterial,
  Vector3,
} from "three";
import { describe, expect, it, vi } from "vitest";

import { interpolateGreatCircle } from "../../src/experience/research-map/globe-flight";
import {
  activeRouteTrailPoints,
  completedRouteTrailPoints,
  createGlobeRouteScene,
  planeAltitude,
  settlingRouteTrailPoints,
  TRAIL_GAP_DISTANCE,
  type GlobeRoute,
} from "../../src/experience/research-map/globe-route-scene";

const viewport = { width: 640, height: 360 };
const pendingRoute: GlobeRoute = {
  city: "Тирана",
  country: "Албания",
  description: "Проверяем визовые, финансовые и бытовые условия сценария.",
  flag: "🇦🇱",
  key: "russia-tirana",
  label: "Russia to Tirana",
  from: { lat: 55.7558, lng: 37.6173 },
  status: "pending",
  to: { lat: 41.3275, lng: 19.8187 },
};
const project = (coordinate: { lat: number; lng: number }, altitude: number) =>
  new Vector3(coordinate.lat, coordinate.lng, altitude);
const equatorRoute: GlobeRoute = {
  ...pendingRoute,
  city: "Тирана",
  country: "Албания",
  description: "Проверяем визовые, финансовые и бытовые условия сценария.",
  flag: "🇦🇱",
  from: { lat: 0, lng: 0 },
  to: { lat: 0, lng: 90 },
};
const equatorProject = (coordinate: { lat: number; lng: number }, altitude: number) =>
  new Vector3(coordinate.lng / 90 * 100, altitude * 100, 0);

function sceneObject(
  data: readonly { readonly key: string; readonly object: object }[],
  key: string,
): Group {
  const datum = data.find((entry) => entry.key === key);
  if (datum === undefined) throw new Error(`Missing scene object: ${key}`);
  if (!(datum.object instanceof Group)) throw new Error(`Expected scene group: ${key}`);
  return datum.object;
}

function childPart(group: Group, part: string): object {
  let child: object | undefined;
  group.traverse((candidate) => {
    if ((candidate as { userData?: { part?: string } }).userData?.part === part) child = candidate;
  });
  if (child === undefined) throw new Error(`Missing child part: ${part}`);
  return child;
}

function linePart(group: Group, part: string): Line<BufferGeometry, LineBasicMaterial> {
  const child = childPart(group, part);
  if (!(child instanceof Line) || !(child.material instanceof LineBasicMaterial)) {
    throw new Error(`Expected native line part: ${part}`);
  }
  return child as Line<BufferGeometry, LineBasicMaterial>;
}

function lineBuffer(line: Line<BufferGeometry, LineBasicMaterial>): BufferAttribute {
  const positions = line.geometry.attributes.position;
  if (!(positions instanceof BufferAttribute)) {
    throw new Error("Expected native trail buffer");
  }
  return positions;
}

describe("globe route coordinates", () => {
  it("uses one smooth surface-to-surface curve for route and aircraft", () => {
    const points = completedRouteTrailPoints(pendingRoute, project);

    expect(points).toHaveLength(129);
    expect(points[0]?.z).toBeCloseTo(0);
    expect(points[32]?.z).toBeCloseTo(planeAltitude(0.25));
    expect(points[64]?.z).toBeCloseTo(planeAltitude(0.5));
    expect(points[96]?.z).toBeCloseTo(planeAltitude(0.75));
    expect(points[128]?.z).toBeCloseTo(0);
  });

  it("keeps a constant tail gap without ever doubling the line back", () => {
    const progress = 0.5;
    const aircraft = equatorProject(
      interpolateGreatCircle(equatorRoute.from, equatorRoute.to, progress),
      planeAltitude(progress),
    );

    const active = activeRouteTrailPoints(
      equatorRoute,
      progress,
      aircraft,
      equatorProject,
    );
    const routeProgress = active.map((point) => point.x / 100);

    expect(active.at(-1)?.distanceTo(aircraft)).toBeCloseTo(TRAIL_GAP_DISTANCE, 4);
    expect(routeProgress.every((value, index) => index === 0 || value >= routeProgress[index - 1]!))
      .toBe(true);
    expect(routeProgress.at(-1)).toBeLessThan(progress);
    expect(TRAIL_GAP_DISTANCE).toBeCloseTo(3.8);
    expect(active[0]?.y).toBeCloseTo(0);
    for (const point of active) {
      const pointProgress = point.x / 100;
      expect(point.y).toBeCloseTo(planeAltitude(pointProgress) * 100, 4);
    }
  });

  it("draws no support rod before the aircraft clears the tail gap", () => {
    const originAircraft = project(pendingRoute.from, planeAltitude(0));

    const points = activeRouteTrailPoints(pendingRoute, 0, originAircraft, project);

    expect(points).toHaveLength(1);
  });

  it("extends monotonically from the tail gap to the destination without dropping", () => {
    const landingTailProgress = 0.94;

    const start = settlingRouteTrailPoints(
      equatorRoute,
      landingTailProgress,
      0,
      equatorProject,
    );
    const halfway = settlingRouteTrailPoints(
      equatorRoute,
      landingTailProgress,
      0.5,
      equatorProject,
    );
    const complete = settlingRouteTrailPoints(
      equatorRoute,
      landingTailProgress,
      1,
      equatorProject,
    );

    for (const points of [start, halfway, complete]) {
      const progress = points.map((point) => point.x / 100);
      expect(progress.every((value, index) => index === 0 || value >= progress[index - 1]!))
        .toBe(true);
    }
    expect(start.at(-1)?.x).toBeCloseTo(94);
    expect(halfway.at(-1)?.x).toBeCloseTo(97);
    // The final start point is the exact 0.94 endpoint; halfway replaces it with later samples.
    for (let index = 0; index < start.length - 1; index += 1) {
      expect(halfway[index]?.y).toBeCloseTo(start[index]!.y, 5);
    }
    expect(complete).toHaveLength(129);
    expect(complete.at(-1)?.x).toBeCloseTo(100);
    expect(complete.at(-1)?.y).toBeCloseTo(0);
  });

  it("uses a compact aircraft and trail arc", () => {
    expect(planeAltitude(0)).toBeCloseTo(0);
    expect(planeAltitude(0.5)).toBeCloseTo(0.08);
    expect(planeAltitude(1)).toBeCloseTo(0);
  });

});

describe("globe route handle reconciliation", () => {
  it("keeps datum identity stable when status changes for the same route", () => {
    const scene = createGlobeRouteScene();
    const first = scene.reconcile({ project, routes: [pendingRoute], runKey: 1, viewport });

    const second = scene.reconcile({
      project,
      routes: [{ ...pendingRoute, status: "green" }],
      runKey: 1,
      viewport,
    });

    expect(second[0]).toBe(first[0]);
    expect(first).toHaveLength(1);
    expect(first[0]?.kind).toBe("trail");
  });

  it("reuses route-key handles without encoding status in route color", () => {
    const scene = createGlobeRouteScene();
    const first = scene.reconcile({ project, routes: [pendingRoute], runKey: 1, viewport });
    const firstTrail = sceneObject(first, "trail:russia-tirana");

    const second = scene.reconcile({
      project,
      routes: [{ ...pendingRoute, status: "red" }],
      runKey: 1,
      viewport,
    });
    const secondTrail = sceneObject(second, "trail:russia-tirana");
    const core = linePart(firstTrail, "core");

    expect(secondTrail).toBe(firstTrail);
    expect(core.material.color.getHexString()).toBe("aeb8ba");
    expect(core.geometry.drawRange).toEqual({ start: 0, count: 129 });
  });

  it("disposes and replaces handles when a restart reuses the route key", () => {
    const scene = createGlobeRouteScene();
    const first = scene.reconcile({ project, routes: [pendingRoute], runKey: 1, viewport });
    const firstTrail = sceneObject(first, "trail:russia-tirana");
    const core = linePart(firstTrail, "core");
    const trailDispose = vi.spyOn(core.geometry, "dispose");

    const restarted = scene.reconcile({ project, routes: [pendingRoute], runKey: 2, viewport });

    expect(sceneObject(restarted, "trail:russia-tirana")).not.toBe(firstTrail);
    expect(trailDispose).toHaveBeenCalledOnce();
  });

  it("ignores a stale flight updater after same-key restart", () => {
    const scene = createGlobeRouteScene();
    const first = scene.reconcile({ project, routes: [pendingRoute], runKey: 1, viewport });
    const oldCore = linePart(sceneObject(first, "trail:russia-tirana"), "core");
    const oldBuffer = lineBuffer(oldCore);
    const staleUpdate = scene.createFlightTrailUpdater(pendingRoute.key);
    scene.reconcile({ project, routes: [pendingRoute], runKey: 2, viewport });
    const versionAfterRestart = oldBuffer.version;

    staleUpdate({
      aircraftPosition: new Vector3(7, 8, 9),
      progress: 0.5,
      project,
      route: pendingRoute,
      viewport,
    });

    expect(oldBuffer.version).toBe(versionAfterRestart);
  });
});
