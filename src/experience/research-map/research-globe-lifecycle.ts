import {
  AmbientLight,
  DirectionalLight,
  type Vector3,
} from "three";

interface SunDirectionSource {
  getSunDirection(target: Vector3): Vector3;
  setSunAngle(angleRadians: number): void;
}

export interface GlobeLighting {
  readonly ambientLight: AmbientLight;
  readonly lights: [AmbientLight, DirectionalLight];
  readonly sunLight: DirectionalLight;
}

export function createGlobeLighting(): GlobeLighting {
  const ambientLight = new AmbientLight("#b9dce2", 0.55);
  const sunLight = new DirectionalLight("#fff1d0", 2.5);
  return { ambientLight, lights: [ambientLight, sunLight], sunLight };
}

export function startSynchronizedSunCycle({
  cancelFrame,
  cycleDurationMs,
  fixedAngle,
  realisticEarth,
  reducedMotion,
  requestFrame,
  sunLight,
}: {
  readonly cancelFrame: (handle: number) => void;
  readonly cycleDurationMs: number;
  readonly fixedAngle: number;
  readonly realisticEarth: SunDirectionSource;
  readonly reducedMotion: boolean;
  readonly requestFrame: (callback: FrameRequestCallback) => number;
  readonly sunLight: DirectionalLight;
}): () => void {
  const setSunAngle = (angleRadians: number) => {
    realisticEarth.setSunAngle(angleRadians);
    realisticEarth.getSunDirection(sunLight.position).multiplyScalar(300);
  };
  setSunAngle(fixedAngle);
  if (reducedMotion) return () => undefined;

  let animationFrame: number | undefined;
  let firstFrameAt: number | undefined;
  let active = true;
  const animateSun = (timestamp: number) => {
    if (!active) return;
    firstFrameAt ??= timestamp;
    const elapsed = (timestamp - firstFrameAt) % cycleDurationMs;
    setSunAngle(fixedAngle + elapsed / cycleDurationMs * Math.PI * 2);
    animationFrame = requestFrame(animateSun);
  };
  animationFrame = requestFrame(animateSun);

  return () => {
    if (!active) return;
    active = false;
    if (animationFrame !== undefined) cancelFrame(animationFrame);
  };
}
