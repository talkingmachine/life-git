import { describe, expect, it, vi } from "vitest";

import { startGlobeJourney } from "../../src/experience/research-map/globe-journey";

function frameScheduler() {
  const callbacks = new Map<number, FrameRequestCallback>();
  let nextHandle = 0;
  return {
    cancelFrame: vi.fn((handle: number) => callbacks.delete(handle)),
    requestFrame: vi.fn((callback: FrameRequestCallback) => {
      const handle = ++nextHandle;
      callbacks.set(handle, callback);
      return handle;
    }),
    run(handle: number, timestamp: number) {
      const callback = callbacks.get(handle);
      callbacks.delete(handle);
      callback?.(timestamp);
    },
  };
}

const from = { lat: 55.7558, lng: 37.6173 };
const to = { lat: 41.3275, lng: 19.8187 };

describe("startGlobeJourney", () => {
  it("hides the aircraft at landing, then settles the trail and reveals the destination", () => {
    const frames = frameScheduler();
    const events: string[] = [];

    startGlobeJourney({
      cancelFrame: frames.cancelFrame,
      flightDurationMs: 100,
      from,
      onComplete: () => events.push("complete"),
      onFlightProgress: (_position, progress) => {
        if (progress === 1) events.push("flight:1");
      },
      onLanding: () => events.push("landing"),
      onDestinationReveal: () => events.push("destination"),
      onTrailSettleProgress: (progress) => {
        if (progress === 1) events.push("settle:1");
      },
      reducedMotion: false,
      requestFrame: frames.requestFrame,
      settleDurationMs: 20,
      to,
    });

    frames.run(1, 0);
    frames.run(2, 100);
    expect(events).toEqual(["flight:1", "landing"]);
    frames.run(3, 100);
    frames.run(4, 120);
    expect(events).toEqual(["flight:1", "landing", "settle:1", "destination", "complete"]);
  });

  it("cancels the current arrival frame and suppresses stale completion", () => {
    const frames = frameScheduler();
    const onComplete = vi.fn();
    const stop = startGlobeJourney({
      cancelFrame: frames.cancelFrame,
      flightDurationMs: 100,
      from,
      onComplete,
      onFlightProgress: vi.fn(),
      onLanding: vi.fn(),
      onDestinationReveal: vi.fn(),
      onTrailSettleProgress: vi.fn(),
      reducedMotion: false,
      requestFrame: frames.requestFrame,
      settleDurationMs: 20,
      to,
    });

    frames.run(1, 0);
    frames.run(2, 100);
    frames.run(3, 100);
    stop();
    stop();
    frames.run(4, 120);

    expect(frames.cancelFrame).toHaveBeenCalledOnce();
    expect(frames.cancelFrame).toHaveBeenCalledWith(4);
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("installs the completed line and destination synchronously under reduced motion", () => {
    const frames = frameScheduler();
    const events: string[] = [];

    startGlobeJourney({
      cancelFrame: frames.cancelFrame,
      flightDurationMs: 100,
      from,
      onComplete: () => events.push("complete"),
      onFlightProgress: (_position, progress) => events.push(`flight:${progress}`),
      onLanding: () => events.push("landing"),
      onDestinationReveal: () => events.push("destination"),
      onTrailSettleProgress: (progress) => events.push(`settle:${progress}`),
      reducedMotion: true,
      requestFrame: frames.requestFrame,
      settleDurationMs: 20,
      to,
    });

    expect(events).toEqual(["flight:1", "landing", "settle:1", "destination", "complete"]);
    expect(frames.requestFrame).not.toHaveBeenCalled();
  });
});
