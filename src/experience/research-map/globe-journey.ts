import type { GeoCoordinate } from "./contracts";
import { startGlobeFlight } from "./globe-flight";

interface GlobeJourneyOptions {
  readonly cancelFrame: (handle: number) => void;
  readonly flightDurationMs: number;
  readonly from: GeoCoordinate;
  readonly onComplete: () => void;
  readonly onDestinationReveal: () => void;
  readonly onFlightProgress: (position: GeoCoordinate, progress: number) => void;
  readonly onLanding: () => void;
  readonly onTrailSettleProgress: (progress: number) => void;
  readonly reducedMotion: boolean;
  readonly requestFrame: (callback: FrameRequestCallback) => number;
  readonly settleDurationMs: number;
  readonly to: GeoCoordinate;
}

function startTimedProgress({
  cancelFrame,
  durationMs,
  onComplete,
  onProgress,
  requestFrame,
}: {
  readonly cancelFrame: (handle: number) => void;
  readonly durationMs: number;
  readonly onComplete: () => void;
  readonly onProgress: (progress: number) => void;
  readonly requestFrame: (callback: FrameRequestCallback) => number;
}): () => void {
  let active = true;
  let frameHandle: number | undefined;
  let startedAt: number | undefined;

  const advance = (timestamp: number) => {
    if (!active) return;
    startedAt ??= timestamp;
    const progress = Math.min(1, Math.max(0, (timestamp - startedAt) / Math.max(1, durationMs)));
    onProgress(progress);
    if (progress < 1) {
      frameHandle = requestFrame(advance);
      return;
    }
    active = false;
    frameHandle = undefined;
    onComplete();
  };

  frameHandle = requestFrame(advance);
  return () => {
    if (!active) return;
    active = false;
    if (frameHandle !== undefined) cancelFrame(frameHandle);
  };
}

export function startGlobeJourney(options: GlobeJourneyOptions): () => void {
  if (options.reducedMotion) {
    options.onFlightProgress({ ...options.to }, 1);
    options.onLanding();
    options.onTrailSettleProgress(1);
    options.onDestinationReveal();
    options.onComplete();
    return () => undefined;
  }

  let active = true;
  let stopCurrent: () => void = () => undefined;

  const revealDestination = () => {
    if (!active) return;
    options.onDestinationReveal();
    active = false;
    options.onComplete();
  };

  const startSettle = () => {
    if (!active) return;
    stopCurrent = startTimedProgress({
      cancelFrame: options.cancelFrame,
      durationMs: options.settleDurationMs,
      onComplete: revealDestination,
      onProgress: options.onTrailSettleProgress,
      requestFrame: options.requestFrame,
    });
  };

  stopCurrent = startGlobeFlight({
    cancelFrame: options.cancelFrame,
    durationMs: options.flightDurationMs,
    from: options.from,
    onComplete: () => {
      if (!active) return;
      options.onLanding();
      startSettle();
    },
    onProgress: options.onFlightProgress,
    reducedMotion: false,
    requestFrame: options.requestFrame,
    to: options.to,
  });

  return () => {
    if (!active) return;
    active = false;
    stopCurrent();
  };
}
