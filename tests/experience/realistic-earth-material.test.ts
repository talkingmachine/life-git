import { LinearFilter, LinearMipmapLinearFilter, NoColorSpace, SRGBColorSpace, Texture, type TextureLoader, Vector3 } from "three";
import { describe, expect, it, vi } from "vitest";

import {
  estimateTextureGpuBytes,
  loadRealisticEarthMaterial,
} from "../../src/experience/research-map/realistic-earth-material";

function texture(width: number, height: number): Texture {
  const result = new Texture();
  result.image = { height, width };
  return result;
}

describe("estimateTextureGpuBytes", () => {
  it("includes RGBA8 storage and a full mip chain", () => {
    expect(estimateTextureGpuBytes([
      { width: 4096, height: 2048 },
      { width: 4096, height: 2048 },
      { width: 2048, height: 1024 },
      { width: 2048, height: 1024 },
    ])).toBe(111_848_107);
  });
});

describe("loadRealisticEarthMaterial", () => {
  it("builds the day-night displaced material and owns its lifecycle", async () => {
    const day = texture(4096, 2048);
    const night = texture(4096, 2048);
    const elevation = texture(2048, 1024);
    const normal = texture(2048, 1024);
    const dayDispose = vi.spyOn(day, "dispose");
    const nightDispose = vi.spyOn(night, "dispose");
    const elevationDispose = vi.spyOn(elevation, "dispose");
    const normalDispose = vi.spyOn(normal, "dispose");
    const loadAsync = vi.fn()
      .mockResolvedValueOnce(day)
      .mockResolvedValueOnce(night)
      .mockResolvedValueOnce(elevation)
      .mockResolvedValueOnce(normal);

    const bundle = await loadRealisticEarthMaterial({ loadAsync } as unknown as TextureLoader, 0);
    const { material } = bundle;

    expect(day.colorSpace).toBe(SRGBColorSpace);
    expect(night.colorSpace).toBe(SRGBColorSpace);
    expect(elevation.colorSpace).toBe(NoColorSpace);
    expect(normal.colorSpace).toBe(NoColorSpace);
    for (const ownedTexture of [day, night, elevation, normal]) {
      expect(ownedTexture.generateMipmaps).toBe(true);
      expect(ownedTexture.magFilter).toBe(LinearFilter);
      expect(ownedTexture.minFilter).toBe(LinearMipmapLinearFilter);
    }
    expect(material.map).toBe(day);
    expect(material.displacementMap).toBe(elevation);
    expect(material.bumpMap).toBeNull();
    expect(material.normalMap).toBe(normal);
    expect(material.normalScale.x).toBeCloseTo(1);
    expect(material.normalScale.y).toBeCloseTo(1);
    expect(material.displacementScale).toBeCloseTo(3);
    expect(material.displacementBias).toBe(0);
    expect(material.metalness).toBeCloseTo(0.02);
    expect(material.roughness).toBeCloseTo(0.82);
    expect(material.customProgramCacheKey()).toBe("research-earth-day-night-v1");
    expect(bundle.estimatedGpuBytes).toBe(111_848_107);

    const shader = {
      fragmentShader: [
        "void main() {",
        "#include <map_fragment>",
        "#include <emissivemap_fragment>",
        "}",
      ].join("\n"),
      uniforms: {},
      vertexShader: [
        "void main() {",
        "#include <beginnormal_vertex>",
        "}",
      ].join("\n"),
    };
    material.onBeforeCompile(
      shader as Parameters<typeof material.onBeforeCompile>[0],
      undefined as never,
    );

    expect(shader.vertexShader).toContain("vEarthWorldNormal");
    expect(shader.fragmentShader).toContain("earthNightMap");
    expect(shader.fragmentShader).toContain("earthSunDirection");
    expect(shader.fragmentShader).toContain("smoothstep(-0.10, 0.18");
    expect(shader.fragmentShader).toContain("mix(0.06, 1.0, earthDaylight)");
    expect(shader.fragmentShader).toContain("(1.0 - earthDaylight) * 1.45");

    const sunDirection = (shader.uniforms as {
      earthSunDirection: { value: Vector3 };
    }).earthSunDirection.value;
    const initialDirection = sunDirection.clone();
    bundle.setSunAngle(Math.PI / 2);
    expect(sunDirection.equals(initialDirection)).toBe(false);
    expect(sunDirection.x).toBeCloseTo(0);
    expect(sunDirection.z).toBeCloseTo(1);
    const direction = new Vector3();
    bundle.setSunAngle(Math.PI / 2);
    expect(bundle.getSunDirection(direction)).toBe(direction);
    expect(direction.z).toBeCloseTo(1);
    direction.set(4, 5, 6);
    expect(bundle.getSunDirection(new Vector3()).z).toBeCloseTo(1);

    const materialDispose = vi.spyOn(material, "dispose");
    bundle.dispose();
    bundle.dispose();

    expect(dayDispose).toHaveBeenCalledOnce();
    expect(nightDispose).toHaveBeenCalledOnce();
    expect(elevationDispose).toHaveBeenCalledOnce();
    expect(normalDispose).toHaveBeenCalledOnce();
    expect(materialDispose).toHaveBeenCalledOnce();
  });

  it("disposes textures that loaded before another asset failed", async () => {
    const day = texture(4096, 2048);
    const elevation = texture(2048, 1024);
    const normal = texture(2048, 1024);
    const dayDispose = vi.spyOn(day, "dispose");
    const elevationDispose = vi.spyOn(elevation, "dispose");
    const normalDispose = vi.spyOn(normal, "dispose");
    const loadAsync = vi.fn()
      .mockResolvedValueOnce(day)
      .mockRejectedValueOnce(new Error("night texture unavailable"))
      .mockResolvedValueOnce(elevation)
      .mockResolvedValueOnce(normal);

    await expect(loadRealisticEarthMaterial(
      { loadAsync } as unknown as TextureLoader,
    )).rejects.toThrow("night texture unavailable");

    expect(dayDispose).toHaveBeenCalledOnce();
    expect(elevationDispose).toHaveBeenCalledOnce();
    expect(normalDispose).toHaveBeenCalledOnce();
  });
});
