import type { GeoCoordinate } from "./contracts";

export type { GeoCoordinate } from "./contracts";

interface GlobeFlightOptions {
  readonly from: GeoCoordinate;
  readonly to: GeoCoordinate;
  readonly durationMs: number;
  readonly reducedMotion: boolean;
  readonly requestFrame: (callback: FrameRequestCallback) => number;
  readonly cancelFrame: (handle: number) => void;
  readonly onComplete: () => void;
  readonly onProgress: (position: GeoCoordinate, progress: number) => void;
}

interface DeferredInitializationOptions {
  readonly initialize: () => boolean;
  readonly maxAttempts: number;
  readonly requestFrame: (callback: FrameRequestCallback) => number;
  readonly cancelFrame: (handle: number) => void;
  readonly onExhausted: () => void;
}

interface CartesianCoordinate {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

const degreesToRadians = Math.PI / 180;
const radiansToDegrees = 180 / Math.PI;

function toCartesian(coordinate: GeoCoordinate): CartesianCoordinate {
  const latitude = coordinate.lat * degreesToRadians;
  const longitude = coordinate.lng * degreesToRadians;
  const latitudeRadius = Math.cos(latitude);

  return {
    x: latitudeRadius * Math.cos(longitude),
    y: Math.sin(latitude),
    z: latitudeRadius * Math.sin(longitude),
  };
}

function toGeographic(coordinate: CartesianCoordinate): GeoCoordinate {
  return {
    lat: Math.atan2(coordinate.y, Math.hypot(coordinate.x, coordinate.z)) * radiansToDegrees,
    lng: Math.atan2(coordinate.z, coordinate.x) * radiansToDegrees,
  };
}

export function sphericalMeanCoordinate(
  coordinates: readonly GeoCoordinate[],
): GeoCoordinate | undefined {
  const first = coordinates[0];
  if (first === undefined) return undefined;

  const mean = coordinates.reduce<CartesianCoordinate>((sum, coordinate) => {
    const cartesian = toCartesian(coordinate);
    return {
      x: sum.x + cartesian.x,
      y: sum.y + cartesian.y,
      z: sum.z + cartesian.z,
    };
  }, { x: 0, y: 0, z: 0 });
  const averaged = {
    x: mean.x / coordinates.length,
    y: mean.y / coordinates.length,
    z: mean.z / coordinates.length,
  };
  const vectorLength = Math.hypot(averaged.x, averaged.y, averaged.z);
  if (vectorLength < 1e-8) return { ...first };

  return toGeographic({
    x: averaged.x / vectorLength,
    y: averaged.y / vectorLength,
    z: averaged.z / vectorLength,
  });
}

function clampProgress(progress: number): number {
  return Math.min(1, Math.max(0, progress));
}

export function startDeferredInitialization(options: DeferredInitializationOptions): () => void {
  const attemptLimit = Math.max(1, Math.floor(options.maxAttempts));
  let active = true;
  let attempts = 0;
  let frameHandle: number | undefined;

  const attempt = () => {
    if (!active) return;
    attempts += 1;
    if (options.initialize()) {
      active = false;
      frameHandle = undefined;
      return;
    }
    if (attempts >= attemptLimit) {
      active = false;
      frameHandle = undefined;
      options.onExhausted();
      return;
    }
    frameHandle = options.requestFrame(attempt);
  };

  attempt();

  return () => {
    if (!active) return;
    active = false;
    if (frameHandle !== undefined) options.cancelFrame(frameHandle);
  };
}

export function interpolateGreatCircle(
  from: GeoCoordinate,
  to: GeoCoordinate,
  progress: number,
): GeoCoordinate {
  const start = toCartesian(from);
  const end = toCartesian(to);
  const amount = clampProgress(progress);
  const dot = Math.min(1, Math.max(-1, start.x * end.x + start.y * end.y + start.z * end.z));
  const angle = Math.acos(dot);

  if (angle < Number.EPSILON) return { ...from };

  const sine = Math.sin(angle);
  const startWeight = Math.sin((1 - amount) * angle) / sine;
  const endWeight = Math.sin(amount * angle) / sine;

  return toGeographic({
    x: start.x * startWeight + end.x * endWeight,
    y: start.y * startWeight + end.y * endWeight,
    z: start.z * startWeight + end.z * endWeight,
  });
}

export function startGlobeFlight(options: GlobeFlightOptions): () => void {
  if (options.reducedMotion) {
    options.onProgress({ ...options.to }, 1);
    options.onComplete();
    return () => undefined;
  }

  let active = true;
  let frameHandle: number | undefined;
  let startedAt: number | undefined;

  const advance = (timestamp: number) => {
    if (!active) return;
    startedAt ??= timestamp;
    const progress = clampProgress((timestamp - startedAt) / Math.max(1, options.durationMs));
    options.onProgress(interpolateGreatCircle(options.from, options.to, progress), progress);
    if (progress < 1) {
      frameHandle = options.requestFrame(advance);
      return;
    }
    active = false;
    frameHandle = undefined;
    options.onComplete();
  };

  frameHandle = options.requestFrame(advance);

  return () => {
    active = false;
    if (frameHandle !== undefined) options.cancelFrame(frameHandle);
  };
}
