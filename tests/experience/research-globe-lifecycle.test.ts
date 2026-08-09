import { Vector3 } from "three";
import { describe, expect, it, vi } from "vitest";

import {
  createGlobeLighting,
  startSynchronizedSunCycle,
} from "../../src/experience/research-map/research-globe-lifecycle";

function createSunSource() {
  const direction = new Vector3(1, 0, 0);
  return {
    getSunDirection(target: Vector3): Vector3 {
      return target.copy(direction);
    },
    setSunAngle(angleRadians: number): void {
      direction.set(Math.cos(angleRadians), 0, Math.sin(angleRadians));
    },
  };
}

describe("globe sunlight lifecycle", () => {
  it("provides one stable light pair with the requested intensities", () => {
    const lighting = createGlobeLighting();

    expect(lighting.lights).toEqual([lighting.ambientLight, lighting.sunLight]);
    expect(lighting.lights).toBe(lighting.lights);
    expect(lighting.ambientLight.intensity).toBeCloseTo(0.55);
    expect(lighting.sunLight.intensity).toBeCloseTo(2.5);
  });

  it("synchronizes the directional position without a frame for reduced motion", () => {
    const lighting = createGlobeLighting();
    const requestFrame = vi.fn();
    const cancelFrame = vi.fn();

    const stop = startSynchronizedSunCycle({
      cancelFrame,
      cycleDurationMs: 90_000,
      fixedAngle: Math.PI / 2,
      realisticEarth: createSunSource(),
      reducedMotion: true,
      requestFrame,
      sunLight: lighting.sunLight,
    });

    expect(lighting.sunLight.position.x).toBeCloseTo(0);
    expect(lighting.sunLight.position.z).toBeCloseTo(300);
    expect(requestFrame).not.toHaveBeenCalled();
    stop();
    expect(cancelFrame).not.toHaveBeenCalled();
  });

  it("keeps animated sunlight synchronized and cancels the active frame", () => {
    const lighting = createGlobeLighting();
    const callbacks = new Map<number, (timestamp: number) => void>();
    let nextHandle = 0;
    const requestFrame = vi.fn((callback: (timestamp: number) => void) => {
      const handle = ++nextHandle;
      callbacks.set(handle, callback);
      return handle;
    });
    const cancelFrame = vi.fn();

    const stop = startSynchronizedSunCycle({
      cancelFrame,
      cycleDurationMs: 90_000,
      fixedAngle: 0,
      realisticEarth: createSunSource(),
      reducedMotion: false,
      requestFrame,
      sunLight: lighting.sunLight,
    });

    callbacks.get(1)?.(1_000);
    callbacks.get(2)?.(23_500);
    expect(lighting.sunLight.position.x).toBeCloseTo(0);
    expect(lighting.sunLight.position.z).toBeCloseTo(300);

    stop();
    stop();
    expect(cancelFrame).toHaveBeenCalledOnce();
    expect(cancelFrame).toHaveBeenCalledWith(3);
    callbacks.get(3)?.(46_000);
    expect(requestFrame).toHaveBeenCalledTimes(3);
  });
});
