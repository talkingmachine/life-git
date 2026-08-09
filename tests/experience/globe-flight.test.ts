import { describe, expect, it, vi } from "vitest";

import {
  interpolateGreatCircle,
  sphericalMeanCoordinate,
  startDeferredInitialization,
  startGlobeFlight,
} from "../../src/experience/research-map/globe-flight";

describe("sphericalMeanCoordinate", () => {
  it("averages positions across the antimeridian without wrapping through zero longitude", () => {
    const mean = sphericalMeanCoordinate([
      { lat: 0, lng: 170 },
      { lat: 0, lng: -170 },
    ]);

    expect(mean?.lat).toBeCloseTo(0, 6);
    expect(Math.abs(mean?.lng ?? 0)).toBeCloseTo(180, 6);
  });

  it("returns undefined when there are no positions to average", () => {
    expect(sphericalMeanCoordinate([])).toBeUndefined();
  });

  it("falls back to a copy of the first position when the mean vectors cancel", () => {
    const first = { lat: 0, lng: 0 };

    const mean = sphericalMeanCoordinate([first, { lat: 0, lng: 180 }]);

    expect(mean).toEqual(first);
    expect(mean).not.toBe(first);
  });
});

describe("interpolateGreatCircle", () => {
  it("follows the great-circle midpoint instead of linearly blending latitude", () => {
    const midpoint = interpolateGreatCircle(
      { lat: 0, lng: 0 },
      { lat: 60, lng: 90 },
      0.5,
    );

    expect(midpoint.lat).toBeCloseTo(37.761, 3);
    expect(midpoint.lng).toBeCloseTo(26.565, 3);
  });

  it("takes the short route across the antimeridian", () => {
    const midpoint = interpolateGreatCircle(
      { lat: 0, lng: 170 },
      { lat: 0, lng: -170 },
      0.5,
    );

    expect(midpoint.lat).toBeCloseTo(0, 6);
    expect(Math.abs(midpoint.lng)).toBeCloseTo(180, 6);
  });
});

describe("startGlobeFlight", () => {
  it("cancels its queued frame and ignores a stale callback after cleanup", () => {
    let queuedFrame: FrameRequestCallback | undefined;
    const cancelFrame = vi.fn();
    const onProgress = vi.fn();
    const onComplete = vi.fn();
    const stop = startGlobeFlight({
      durationMs: 1_000,
      from: { lat: 0, lng: 0 },
      onComplete,
      onProgress,
      reducedMotion: false,
      requestFrame(callback) {
        queuedFrame = callback;
        return 17;
      },
      cancelFrame,
      to: { lat: 60, lng: 90 },
    });

    stop();
    queuedFrame?.(500);

    expect(cancelFrame).toHaveBeenCalledWith(17);
    expect(onComplete).not.toHaveBeenCalled();
    expect(onProgress).not.toHaveBeenCalled();
  });

  it("signals completion once after reaching the final frame", () => {
    const frames: FrameRequestCallback[] = [];
    const onComplete = vi.fn();
    startGlobeFlight({
      durationMs: 1_000,
      from: { lat: 0, lng: 0 },
      onComplete,
      onProgress: vi.fn(),
      reducedMotion: false,
      requestFrame(callback) {
        frames.push(callback);
        return frames.length;
      },
      cancelFrame: vi.fn(),
      to: { lat: 60, lng: 90 },
    });

    frames[0]?.(100);
    frames[1]?.(1_100);
    frames[1]?.(1_200);

    expect(onComplete).toHaveBeenCalledOnce();
  });

  it("positions immediately at the destination when motion is reduced", () => {
    const requestFrame = vi.fn();
    const onProgress = vi.fn();
    const onComplete = vi.fn();

    startGlobeFlight({
      durationMs: 1_000,
      from: { lat: 0, lng: 0 },
      onComplete,
      onProgress,
      reducedMotion: true,
      requestFrame,
      cancelFrame: vi.fn(),
      to: { lat: 60, lng: 90 },
    });

    expect(requestFrame).not.toHaveBeenCalled();
    expect(onComplete).toHaveBeenCalledOnce();
    expect(onProgress).toHaveBeenCalledOnce();
    expect(onProgress).toHaveBeenCalledWith({ lat: 60, lng: 90 }, 1);
  });
});

describe("startDeferredInitialization", () => {
  it("retries a temporarily missing imperative ref and initializes exactly once", () => {
    const frames: FrameRequestCallback[] = [];
    const initialize = vi.fn()
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(false)
      .mockReturnValue(true);
    const onExhausted = vi.fn();

    startDeferredInitialization({
      cancelFrame: vi.fn(),
      initialize,
      maxAttempts: 4,
      onExhausted,
      requestFrame(callback) {
        frames.push(callback);
        return frames.length;
      },
    });

    frames[0]?.(0);
    frames[1]?.(16);
    frames[1]?.(32);

    expect(initialize).toHaveBeenCalledTimes(3);
    expect(onExhausted).not.toHaveBeenCalled();
  });

  it("reports exhaustion after the bounded number of attempts", () => {
    const frames: FrameRequestCallback[] = [];
    const onExhausted = vi.fn();

    startDeferredInitialization({
      cancelFrame: vi.fn(),
      initialize: () => false,
      maxAttempts: 2,
      onExhausted,
      requestFrame(callback) {
        frames.push(callback);
        return frames.length;
      },
    });

    frames[0]?.(0);

    expect(onExhausted).toHaveBeenCalledOnce();
    expect(frames).toHaveLength(1);
  });

  it("cancels a pending retry and invalidates its stale callback", () => {
    let queuedFrame: FrameRequestCallback | undefined;
    const cancelFrame = vi.fn();
    const initialize = vi.fn(() => false);
    const stop = startDeferredInitialization({
      cancelFrame,
      initialize,
      maxAttempts: 3,
      onExhausted: vi.fn(),
      requestFrame(callback) {
        queuedFrame = callback;
        return 23;
      },
    });

    stop();
    queuedFrame?.(0);

    expect(cancelFrame).toHaveBeenCalledWith(23);
    expect(initialize).toHaveBeenCalledOnce();
  });
});
