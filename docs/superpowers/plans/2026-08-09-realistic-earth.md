# Realistic Earth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a local 4K day/night Earth material with animated sunlight and true 2K vertex-displaced terrain to the existing globe laboratory, then measure its loading and animation cost.

**Architecture:** Keep `react-globe.gl` as the sole renderer. A focused material module owns texture loading, a patched `MeshStandardMaterial`, sun uniforms, displacement, GPU-memory estimation, and disposal; `ResearchGlobeCanvas` only selects the loading preview or realistic bundle and drives the slow sun cycle. The current stylized globe and flat WebGL fallback remain intact.

**Tech Stack:** Next.js 16, React 19, `react-globe.gl` 2.38, Three.js 0.183, Vitest, local NASA/NOAA-derived raster assets.

## Global Constraints

- Change only `/lab/research-map`, `ResearchGlobeCanvas`, its focused material helper/tests, and local visual assets.
- Day and night textures are exactly 4096×2048; elevation is exactly 2048×1024.
- Combined transferred texture size target is 5–10 MB.
- Use true vertex displacement at approximately 8× real-Earth relief, plus elevation-based surface shading.
- Blend day/night with a soft world-space terminator; city lights contribute only on the night side.
- Preserve routes, markers, GLTF aircraft, camera transitions, random 1–5 playback, HTML overlay, reduced motion, and the existing WebGL fallback.
- Keep all runtime assets local; retain no downloaded archive or temporary conversion script.
- Add no production data-flow or package dependency changes.
- Do not stage or commit until the user visually approves the experiment.

---

### Task 1: Prepare realistic Earth assets

**Files:**
- Create: `public/textures/earth-day-4k.jpg`
- Create: `public/textures/earth-night-4k.jpg`
- Create: `public/textures/earth-elevation-2k.png`
- Verify: `.superpowers/sdd/2026-08-09-realistic-earth/task-1-report.md`

**Interfaces:**
- Consumes: official NASA Visible Earth/Black Marble imagery and an official NASA or NOAA global elevation raster with compatible redistribution terms.
- Produces: the exact local URLs `/textures/earth-day-4k.jpg`, `/textures/earth-night-4k.jpg`, and `/textures/earth-elevation-2k.png`.

- [ ] **Step 1: Record source provenance before conversion**

  For each asset, record the official product page, direct source URL, product/version name,
  source dimensions, and reuse terms in the task report. Reject community mirrors without a
  traceable official source.

- [ ] **Step 2: Convert the three equirectangular textures outside the repository**

  Use a temporary directory and preserve a 2:1 equirectangular projection. Produce:

  ```text
  earth-day-4k.jpg       4096×2048 RGB, high-quality JPEG
  earth-night-4k.jpg     4096×2048 RGB, high-quality JPEG with black background and city lights
  earth-elevation-2k.png 2048×1024 grayscale PNG, ocean near 0 and highest land near 255
  ```

  Do not sharpen boundaries or add labels. Use wrap-aware resampling so the first and last columns
  meet cleanly at the antimeridian.

- [ ] **Step 3: Verify dimensions, files, and transfer budget**

  Run:

  ```bash
  file public/textures/earth-day-4k.jpg public/textures/earth-night-4k.jpg public/textures/earth-elevation-2k.png
  du -ch public/textures/earth-day-4k.jpg public/textures/earth-night-4k.jpg public/textures/earth-elevation-2k.png
  rg --files -g '*.zip' -g '*.tif' -g '*.tiff' -g '*.shp' -g '*generator*' .
  git diff --check
  ```

  Expected: exact dimensions above, combined size between 5 and 10 MB, no downloaded source or generator in the repository, and clean diff whitespace.

- [ ] **Step 4: Stop without committing**

  Write the complete source and conversion report, self-review the three assets, and leave them
  uncommitted for the task reviewer and later visual acceptance.

---

### Task 2: Build and integrate the day/night displacement material

**Files:**
- Create: `src/experience/lab/realistic-earth-material.ts`
- Modify: `src/experience/lab/ResearchGlobeCanvas.tsx`
- Create: `tests/experience/realistic-earth-material.test.ts`
- Verify: `tests/experience/globe-flight.test.ts`
- Verify: `tests/experience/research-map-lab.test.tsx`

**Interfaces:**
- Consumes: the three local URLs produced by Task 1 and the existing loading texture `/textures/research-earth.png`.
- Produces:

  ```ts
  export interface RealisticEarthBundle {
    readonly material: MeshStandardMaterial;
    readonly readyMs: number;
    readonly estimatedGpuBytes: number;
    dispose(): void;
    setSunAngle(angleRadians: number): void;
  }

  export async function loadRealisticEarthMaterial(
    loader: TextureLoader,
    startedAt?: number,
  ): Promise<RealisticEarthBundle>;

  export function estimateTextureGpuBytes(
    textures: readonly { readonly width: number; readonly height: number }[],
  ): number;
  ```

- [ ] **Step 1: Write failing material-contract tests**

  Add tests that assert:

  ```ts
  expect(estimateTextureGpuBytes([
    { width: 4096, height: 2048 },
    { width: 4096, height: 2048 },
    { width: 2048, height: 1024 },
  ])).toBe(100_663_296); // RGBA8 plus 4/3 mip-chain estimate

  expect(material.displacementMap).toBe(elevation);
  expect(material.bumpMap).toBe(elevation);
  expect(material.displacementScale).toBeCloseTo(1);
  expect(material.customProgramCacheKey()).toBe("research-earth-day-night-v1");
  ```

  Invoke `material.onBeforeCompile` with a minimal shader fixture containing
  `#include <beginnormal_vertex>`, `#include <map_fragment>`, and
  `#include <emissivemap_fragment>`. Assert that the patched shader contains the
  `vEarthWorldNormal`, `earthNightMap`, `earthSunDirection`, and soft-terminator code, and that
  `setSunAngle` changes the sun-direction uniform. Assert that `dispose()` disposes every owned
  texture and the material exactly once.

- [ ] **Step 2: Run the focused test to verify RED**

  Run:

  ```bash
  PATH=/opt/homebrew/bin:$PATH pnpm test -- tests/experience/realistic-earth-material.test.ts
  ```

  Expected: FAIL because `realistic-earth-material.ts` and its exports do not exist.

- [ ] **Step 3: Implement the focused material module**

  Load all textures with `TextureLoader.loadAsync`. Set day/night textures to `SRGBColorSpace`,
  elevation to `NoColorSpace`, and enable mipmapped linear filtering. Create one
  `MeshStandardMaterial` with these base properties:

  ```ts
  {
    map: day,
    bumpMap: elevation,
    bumpScale: 0.35,
    displacementMap: elevation,
    displacementScale: 1,
    displacementBias: 0,
    metalness: 0.02,
    roughness: 0.82,
  }
  ```

  Patch `onBeforeCompile` so the vertex shader exports a normalized world-space surface normal.
  In the fragment shader compute:

  ```glsl
  float earthDaylight = smoothstep(-0.10, 0.18,
    dot(normalize(vEarthWorldNormal), normalize(earthSunDirection)));
  ```

  Multiply daytime diffuse color by `mix(0.06, 1.0, earthDaylight)` and add the night texture to
  emissive radiance multiplied by `(1.0 - earthDaylight) * 1.65`. Do not build a general shader
  framework.

- [ ] **Step 4: Run the material test to verify GREEN**

  Run the focused test from Step 2. Expected: PASS.

- [ ] **Step 5: Integrate loading, sun movement, and cleanup**

  In `ResearchGlobeCanvas`:

  ```text
  initial surface: existing research-earth.png and MeshPhongMaterial
  ready surface: RealisticEarthBundle.material
  realistic globe curvature resolution: 1.5 degrees
  graticule in realistic mode: disabled
  atmosphere color: #4a8ea8
  atmosphere altitude: 0.14
  sun-cycle duration: 90 seconds per revolution
  reduced motion: one fixed sun angle and no sun animation frame
  ```

  A texture/shader load failure logs one concise warning and leaves the stylized globe active;
  it must not call the existing whole-globe `onUnavailable` fallback. Cancel the sun animation
  frame and dispose the bundle on unmount. Keep aircraft minimum altitude, points, and arcs above
  the maximum displaced surface.

- [ ] **Step 6: Run all nonvisual verification**

  Run:

  ```bash
  PATH=/opt/homebrew/bin:$PATH pnpm test -- tests/experience/realistic-earth-material.test.ts tests/experience/globe-flight.test.ts tests/experience/research-map-lab.test.tsx
  PATH=/opt/homebrew/bin:$PATH pnpm typecheck
  PATH=/opt/homebrew/bin:$PATH pnpm lint
  git diff --check
  ```

  Expected: all focused tests, typecheck, lint, and diff check pass.

- [ ] **Step 7: Request browser permission and measure the experiment**

  After explicit permission, clean-load `http://127.0.0.1:3000/lab/research-map`. Use resource
  timing and animation-frame samples to report:

  ```text
  transferred bytes for each texture;
  load start to realistic-material ready time;
  average and minimum sampled FPS over a complete random run;
  estimated GPU bytes from the tested helper;
  whether the launch button re-enabled and console remained free of errors.
  ```

  Inspect day/night orientation, the soft moving terminator, city-light masking, displaced
  silhouette, UV seam, aircraft clearance, and status contrast. Leave the lab open for the user's
  visual decision. Do not stage or commit.
