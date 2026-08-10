import {
  LinearFilter,
  LinearMipmapLinearFilter,
  MeshStandardMaterial,
  NoColorSpace,
  SRGBColorSpace,
  Vector2,
  Vector3,
  type Texture,
  type TextureLoader,
} from "three";

const DAY_TEXTURE_URL = "/textures/earth-day-4k.jpg";
const NIGHT_TEXTURE_URL = "/textures/earth-night-4k.jpg";
const ELEVATION_TEXTURE_URL = "/textures/earth-elevation-2k.png";
const NORMAL_TEXTURE_URL = "/textures/earth-normal-2k.png";
const MATERIAL_PROGRAM_KEY = "research-earth-day-night-v1";

export interface RealisticEarthBundle {
  readonly material: MeshStandardMaterial;
  readonly readyMs: number;
  readonly estimatedGpuBytes: number;
  dispose(): void;
  getSunDirection(target: Vector3): Vector3;
  setSunAngle(angleRadians: number): void;
}

export function estimateTextureGpuBytes(
  textures: readonly { readonly width: number; readonly height: number }[],
): number {
  const baseLevelBytes = textures.reduce(
    (total, texture) => total + texture.width * texture.height * 4,
    0,
  );
  return Math.round(baseLevelBytes * 4 / 3);
}

function configureTexture(texture: Texture, colorSpace: typeof SRGBColorSpace | typeof NoColorSpace): void {
  texture.colorSpace = colorSpace;
  texture.generateMipmaps = true;
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.needsUpdate = true;
}

function textureDimensions(texture: Texture): { readonly width: number; readonly height: number } {
  return texture.image as { readonly width: number; readonly height: number };
}

export async function loadRealisticEarthMaterial(
  loader: TextureLoader,
  startedAt = performance.now(),
): Promise<RealisticEarthBundle> {
  const loadResults = await Promise.allSettled([
    loader.loadAsync(DAY_TEXTURE_URL),
    loader.loadAsync(NIGHT_TEXTURE_URL),
    loader.loadAsync(ELEVATION_TEXTURE_URL),
    loader.loadAsync(NORMAL_TEXTURE_URL),
  ]);
  const loadedTextures = loadResults.flatMap((result) =>
    result.status === "fulfilled" ? [result.value] : []
  );
  const failedLoad = loadResults.find((result) => result.status === "rejected");
  if (failedLoad?.status === "rejected") {
    loadedTextures.forEach((texture) => texture.dispose());
    throw failedLoad.reason;
  }
  const [day, night, elevation, normal] = loadedTextures;

  configureTexture(day, SRGBColorSpace);
  configureTexture(night, SRGBColorSpace);
  configureTexture(elevation, NoColorSpace);
  configureTexture(normal, NoColorSpace);

  const sunDirection = new Vector3(1, 0, 0);
  const material = new MeshStandardMaterial({
    map: day,
    normalMap: normal,
    normalScale: new Vector2(1, 1),
    displacementMap: elevation,
    displacementScale: 3,
    displacementBias: 0,
    metalness: 0.02,
    roughness: 0.82,
  });

  material.customProgramCacheKey = () => MATERIAL_PROGRAM_KEY;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.earthNightMap = { value: night };
    shader.uniforms.earthSunDirection = { value: sunDirection };
    shader.vertexShader = `varying vec3 vEarthWorldNormal;\n${shader.vertexShader}`.replace(
      "#include <beginnormal_vertex>",
      [
        "#include <beginnormal_vertex>",
        "vEarthWorldNormal = normalize(mat3(modelMatrix) * objectNormal);",
      ].join("\n"),
    );
    shader.fragmentShader = [
      "uniform sampler2D earthNightMap;",
      "uniform vec3 earthSunDirection;",
      "varying vec3 vEarthWorldNormal;",
      shader.fragmentShader,
    ].join("\n");
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <map_fragment>",
      [
        "#include <map_fragment>",
        "float earthDaylight = smoothstep(-0.10, 0.18,",
        "  dot(normalize(vEarthWorldNormal), normalize(earthSunDirection)));",
        "diffuseColor.rgb *= mix(0.06, 1.0, earthDaylight);",
      ].join("\n"),
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <emissivemap_fragment>",
      [
        "#include <emissivemap_fragment>",
        "totalEmissiveRadiance += texture2D(earthNightMap, vMapUv).rgb",
        "  * (1.0 - earthDaylight) * 1.45;",
      ].join("\n"),
    );
  };

  let disposed = false;
  return {
    material,
    readyMs: performance.now() - startedAt,
    estimatedGpuBytes: estimateTextureGpuBytes([
      textureDimensions(day),
      textureDimensions(night),
      textureDimensions(elevation),
      textureDimensions(normal),
    ]),
    dispose() {
      if (disposed) return;
      disposed = true;
      day.dispose();
      night.dispose();
      elevation.dispose();
      normal.dispose();
      material.dispose();
    },
    getSunDirection(target) {
      return target.copy(sunDirection);
    },
    setSunAngle(angleRadians) {
      sunDirection.set(Math.cos(angleRadians), 0, Math.sin(angleRadians));
    },
  };
}
