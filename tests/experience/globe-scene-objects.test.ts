import {
  BufferAttribute,
  BufferGeometry,
  Line,
  LineBasicMaterial,
  Vector3,
} from "three";
import { describe, expect, it, vi } from "vitest";

import { createGlobeTrail } from "../../src/experience/research-map/globe-scene-objects";

function trailPart(
  trail: ReturnType<typeof createGlobeTrail>,
  part: string,
): Line<BufferGeometry, LineBasicMaterial> {
  const object = trail.object.children.find((child) => child.userData.part === part);
  if (!(object instanceof Line) || !(object.material instanceof LineBasicMaterial)) {
    throw new Error(`Missing native trail part: ${part}`);
  }
  return object as Line<BufferGeometry, LineBasicMaterial>;
}

describe("createGlobeTrail", () => {
  it("builds one continuous neutral translucent native line", () => {
    const trail = createGlobeTrail();
    const core = trailPart(trail, "core");

    expect(trail.object.children).toHaveLength(1);
    expect(core.material.opacity).toBeCloseTo(0.8);
    expect(core.material.transparent).toBe(true);
    expect(core.material.depthTest).toBe(true);
    expect(core.material.depthWrite).toBe(false);

    expect(core.material.color.getHexString()).toBe("aeb8ba");
  });

  it("writes ordered vertices and limits the draw range to visible points", () => {
    const trail = createGlobeTrail();
    const core = trailPart(trail, "core");

    trail.setPoints(
      [new Vector3(1, 2, 3), new Vector3(4, 5, 6), new Vector3(7, 8, 9)],
      { width: 640, height: 360 },
    );

    const positions = core.geometry.attributes.position;
    if (!(positions instanceof BufferAttribute)) throw new Error("Expected line positions");
    expect(Array.from(positions.array.slice(0, 9))).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9,
    ]);
    expect(core.geometry.drawRange).toEqual({ start: 0, count: 3 });
  });

  it("updates a fixed-capacity shared position buffer in place", () => {
    const trail = createGlobeTrail();
    const core = trailPart(trail, "core");
    const positions = core.geometry.attributes.position;
    if (!(positions instanceof BufferAttribute)) throw new Error("Expected line positions");

    expect(positions.array).toHaveLength(129 * 3);

    trail.setPoints(
      [new Vector3(1, 2, 3), new Vector3(4, 5, 6), new Vector3(7, 8, 9)],
      { width: 640, height: 360 },
    );
    trail.setPoints(
      [new Vector3(10, 11, 12), new Vector3(13, 14, 15)],
      { width: 800, height: 600 },
    );

    expect(core.geometry.attributes.position).toBe(positions);
    expect(Array.from(positions.array.slice(0, 6))).toEqual([
      10, 11, 12, 13, 14, 15,
    ]);
    expect(core.geometry.drawRange).toEqual({ start: 0, count: 2 });
    expect(positions.version).toBeGreaterThan(0);
  });

  it("disposes every owned trail resource exactly once", () => {
    const trail = createGlobeTrail();
    const lines = [trailPart(trail, "core")];
    const geometryDispose = vi.spyOn(lines[0]!.geometry, "dispose");
    const materials = lines.map((line) => vi.spyOn(line.material, "dispose"));

    trail.dispose();
    trail.dispose();

    for (const dispose of [geometryDispose, ...materials]) {
      expect(dispose).toHaveBeenCalledOnce();
    }
  });
});
