import {
  BufferAttribute,
  BufferGeometry,
  DynamicDrawUsage,
  Group,
  Line,
  LineBasicMaterial,
  Vector3,
} from "three";

const TRAIL_SEGMENT_CAPACITY = 128;
const TRAIL_COLOR = "#aeb8ba";

export interface GlobeTrailHandle {
  readonly object: Group;
  dispose(): void;
  setPoints(points: readonly Vector3[], viewport: { width: number; height: number }): void;
}

function createTrailLine(geometry: BufferGeometry): Line<BufferGeometry, LineBasicMaterial> {
  const material = new LineBasicMaterial({
    color: TRAIL_COLOR,
    depthTest: true,
    depthWrite: false,
    opacity: 0.8,
    transparent: true,
  });
  const line = new Line(geometry, material);
  line.userData.part = "core";
  line.visible = false;
  return line;
}

function updateTrailGeometry(geometry: BufferGeometry, points: readonly Vector3[]): number {
  const pointCount = Math.min(TRAIL_SEGMENT_CAPACITY + 1, points.length);
  const positionAttribute = geometry.attributes.position;
  if (!(positionAttribute instanceof BufferAttribute)) {
    throw new Error("Globe trail position buffer is unavailable");
  }
  const positions = positionAttribute.array;

  for (let index = 0; index < pointCount; index += 1) {
    const point = points[index]!;
    const offset = index * 3;
    positions[offset] = point.x;
    positions[offset + 1] = point.y;
    positions[offset + 2] = point.z;
  }

  positionAttribute.clearUpdateRanges();
  positionAttribute.addUpdateRange(0, pointCount * 3);
  positionAttribute.needsUpdate = true;
  geometry.setDrawRange(0, pointCount);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return pointCount;
}

export function createGlobeTrail(): GlobeTrailHandle {
  const object = new Group();
  const geometry = new BufferGeometry();
  const positions = new BufferAttribute(
    new Float32Array((TRAIL_SEGMENT_CAPACITY + 1) * 3),
    3,
  );
  positions.setUsage(DynamicDrawUsage);
  geometry.setAttribute("position", positions);
  geometry.setDrawRange(0, 0);
  const core = createTrailLine(geometry);
  object.add(core);
  let disposed = false;

  return {
    object,
    dispose() {
      if (disposed) return;
      disposed = true;
      geometry.dispose();
      core.material.dispose();
    },
    setPoints(points, viewport) {
      // Retained in the shared handle contract; native WebGL lines do not need viewport resolution.
      void viewport;
      const pointCount = updateTrailGeometry(geometry, points);
      core.visible = pointCount > 1;
    },
  };
}
