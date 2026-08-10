import { Vector3, type Group } from "three";

import type { GeoCoordinate, GlobeRoute } from "./contracts";
import {
  createGlobeTrail,
  type GlobeTrailHandle,
} from "./globe-scene-objects";
import { interpolateGreatCircle } from "./globe-flight";

export type { GlobeRoute } from "./contracts";

export interface GlobeRouteSceneDatum {
  readonly kind: "trail";
  readonly key: string;
  readonly object: Group;
  readonly routeKey: string;
}

export type GlobeCoordinateProjector = (
  coordinate: GeoCoordinate,
  altitude: number,
) => Vector3;

interface ReconcileOptions {
  readonly project: GlobeCoordinateProjector;
  readonly routes: readonly GlobeRoute[];
  readonly runKey: number | undefined;
  readonly viewport: { readonly width: number; readonly height: number };
}

interface FlightTrailUpdate {
  readonly aircraftPosition: Vector3;
  readonly progress: number;
  readonly project: GlobeCoordinateProjector;
  readonly route: GlobeRoute;
  readonly viewport: { readonly width: number; readonly height: number };
}

interface SettlingTrailUpdate {
  readonly landingTailProgress: number;
  readonly progress: number;
  readonly project: GlobeCoordinateProjector;
  readonly route: GlobeRoute;
  readonly viewport: { readonly width: number; readonly height: number };
}

export interface GlobeRouteScene {
  createFlightTrailUpdater(routeKey: string): (update: FlightTrailUpdate) => number | undefined;
  dispose(): void;
  reconcile(options: ReconcileOptions): readonly GlobeRouteSceneDatum[];
  settleFlightTrail(routeKey: string, update: SettlingTrailUpdate): void;
}

const JOURNEY_PEAK_ALTITUDE = 0.08;
const TRAIL_SEGMENTS = 128;
export const TRAIL_GAP_DISTANCE = 3.8;
const TRAIL_PROGRESS_SEARCH_ITERATIONS = 24;

export function journeyAltitude(progress: number): number {
  return Math.sin(Math.PI * progress) * JOURNEY_PEAK_ALTITUDE;
}

export const planeAltitude = journeyAltitude;

export function completedRouteTrailPoints(
  route: GlobeRoute,
  project: GlobeCoordinateProjector,
): Vector3[] {
  return Array.from({ length: TRAIL_SEGMENTS + 1 }, (_, index) => {
    const progress = index / TRAIL_SEGMENTS;
    return project(
      interpolateGreatCircle(route.from, route.to, progress),
      journeyAltitude(progress),
    );
  });
}

function routePointsThrough(
  route: GlobeRoute,
  endProgress: number,
  altitudeAt: (progress: number) => number,
  project: GlobeCoordinateProjector,
): Vector3[] {
  const clampedEnd = Math.min(1, Math.max(0, endProgress));
  const lastWholeSegment = Math.floor(clampedEnd * TRAIL_SEGMENTS);
  const points = Array.from({ length: lastWholeSegment + 1 }, (_, index) => {
    const sampleProgress = index / TRAIL_SEGMENTS;
    return project(
      interpolateGreatCircle(route.from, route.to, sampleProgress),
      altitudeAt(sampleProgress),
    );
  });
  if (Math.abs(clampedEnd - lastWholeSegment / TRAIL_SEGMENTS) > Number.EPSILON) {
    points.push(project(
      interpolateGreatCircle(route.from, route.to, clampedEnd),
      altitudeAt(clampedEnd),
    ));
  }
  return points;
}

function activeRouteTrailState(
  route: GlobeRoute,
  progress: number,
  aircraftPosition: Vector3,
  project: GlobeCoordinateProjector,
): { readonly points: Vector3[]; readonly tailProgress: number } {
  const clampedProgress = Math.min(1, Math.max(0, progress));
  const originTrailPosition = project(route.from, journeyAltitude(0));
  if (aircraftPosition.distanceTo(originTrailPosition) <= TRAIL_GAP_DISTANCE) {
    return {
      points: [originTrailPosition],
      tailProgress: 0,
    };
  }

  let earlierProgress = 0;
  let laterProgress = clampedProgress;
  for (let iteration = 0; iteration < TRAIL_PROGRESS_SEARCH_ITERATIONS; iteration += 1) {
    const candidateProgress = (earlierProgress + laterProgress) / 2;
    const candidate = project(
      interpolateGreatCircle(route.from, route.to, candidateProgress),
      journeyAltitude(candidateProgress),
    );
    if (candidate.distanceTo(aircraftPosition) > TRAIL_GAP_DISTANCE) {
      earlierProgress = candidateProgress;
    } else {
      laterProgress = candidateProgress;
    }
  }

  const tailProgress = (earlierProgress + laterProgress) / 2;
  return {
    points: routePointsThrough(route, tailProgress, journeyAltitude, project),
    tailProgress,
  };
}

export function activeRouteTrailPoints(
  route: GlobeRoute,
  progress: number,
  aircraftPosition: Vector3,
  project: GlobeCoordinateProjector,
): Vector3[] {
  return activeRouteTrailState(route, progress, aircraftPosition, project).points;
}

export function settlingRouteTrailPoints(
  route: GlobeRoute,
  landingTailProgress: number,
  progress: number,
  project: GlobeCoordinateProjector,
): Vector3[] {
  const clampedProgress = Math.min(1, Math.max(0, progress));
  const endProgress = landingTailProgress + (1 - landingTailProgress) * clampedProgress;
  return routePointsThrough(
    route,
    endProgress,
    journeyAltitude,
    project,
  );
}

export function createGlobeRouteScene(): GlobeRouteScene {
  const trails = new Map<string, GlobeTrailHandle>();
  const flightProgress = new Map<string, {
    readonly aircraftPosition: Vector3;
    readonly progress: number;
    readonly tailProgress: number;
  }>();
  const trailData = new Map<string, GlobeRouteSceneDatum>();
  let currentRunKey: number | undefined;

  const disposeHandles = () => {
    trails.forEach((trail) => trail.dispose());
    trails.clear();
    flightProgress.clear();
    trailData.clear();
  };

  return {
    createFlightTrailUpdater(routeKey) {
      const ownedTrail = trails.get(routeKey);
      return (update) => {
        if (ownedTrail === undefined || trails.get(routeKey) !== ownedTrail) return;
        const trailState = activeRouteTrailState(
          update.route,
          update.progress,
          update.aircraftPosition,
          update.project,
        );
        flightProgress.set(routeKey, {
          aircraftPosition: update.aircraftPosition.clone(),
          progress: update.progress,
          tailProgress: trailState.tailProgress,
        });
        ownedTrail.setPoints(trailState.points, update.viewport);
        return trailState.tailProgress;
      };
    },
    dispose() {
      disposeHandles();
    },
    reconcile({ project, routes, runKey, viewport }) {
      if (currentRunKey !== runKey) {
        disposeHandles();
        currentRunKey = runKey;
      }

      const routeKeys = new Set(routes.map((route) => route.key));
      for (const [key, trail] of trails) {
        if (routeKeys.has(key)) continue;
        trail.dispose();
        trails.delete(key);
        trailData.delete(key);
        flightProgress.delete(key);
      }

      return routes.flatMap<GlobeRouteSceneDatum>((route) => {
        let trail = trails.get(route.key);
        if (trail === undefined) {
          trail = createGlobeTrail();
          trails.set(route.key, trail);
        }
        const activeProgress = flightProgress.get(route.key);
        if (route.status === "pending") {
          const progress = activeProgress?.progress ?? 0;
          const aircraftPosition = activeProgress?.aircraftPosition ?? project(
            interpolateGreatCircle(route.from, route.to, progress),
            planeAltitude(progress),
          );
          trail.setPoints(
            activeRouteTrailPoints(route, progress, aircraftPosition, project),
            viewport,
          );
        } else {
          flightProgress.delete(route.key);
          trail.setPoints(completedRouteTrailPoints(route, project), viewport);
        }

        let trailDatum = trailData.get(route.key);
        if (trailDatum === undefined) {
          trailDatum = {
            key: `trail:${route.key}`,
            kind: "trail",
            object: trail.object,
            routeKey: route.key,
          };
          trailData.set(route.key, trailDatum);
        }
        return [trailDatum];
      });
    },
    settleFlightTrail(routeKey, update) {
      trails.get(routeKey)?.setPoints(
        settlingRouteTrailPoints(
          update.route,
          update.landingTailProgress,
          update.progress,
          update.project,
        ),
        update.viewport,
      );
    },
  };
}
