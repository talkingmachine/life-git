# Globe Surface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the laboratory's featureless sphere with a recognizable, restrained map of Earth.

**Architecture:** Generate one optimized local equirectangular texture from reputable public-domain world geometry, then pass that asset to the existing `react-globe.gl` instance through `globeImageUrl`. Keep the current renderer, material lighting, routes, aircraft, markers, fallback, and scenario state unchanged.

**Tech Stack:** Next.js 16, React 19, `react-globe.gl`, Three.js, a temporary asset-generation script outside the repository.

## Global Constraints

- Change only `/lab/research-map` and its local visual assets.
- Add no runtime dependency and make no production data-flow change.
- Bundle the texture locally; do not make a runtime network request.
- Do not commit until the user visually approves the laboratory.
- Preserve the existing WebGL fallback and `prefers-reduced-motion` behavior.

---

### Task 1: Recognizable Earth surface

**Files:**
- Create: `public/textures/research-earth.png`
- Modify: `src/experience/lab/ResearchGlobeCanvas.tsx`
- Verify: `tests/experience/globe-flight.test.ts`
- Verify: `tests/experience/research-map-lab.test.tsx`

**Interfaces:**
- Consumes: the existing `Globe` element and its `globeImageUrl` property.
- Produces: the local URL `/textures/research-earth.png`; no new TypeScript interface.

- [ ] **Step 1: Establish the failing visual contract**

  Confirm from `ResearchGlobeCanvas.tsx` that the current value is `globeImageUrl={null}` and record the clean-load browser symptom: the sphere has no land geometry. Do not add a source-string unit test for this visual-only defect.

- [ ] **Step 2: Create the local texture**

  Obtain public-domain world coastlines/country geometry from the official Natural Earth project during development. Use a temporary script outside the repository to render a 2048×1024 equirectangular PNG with these exact visual roles:

  ```text
  ocean:            #0b252c
  land fill:        #7f9690
  country borders:  rgba(197, 214, 207, 0.24)
  coastline:        rgba(205, 222, 215, 0.62)
  labels/relief:    none
  ```

  Save only the optimized PNG in `public/textures/`; do not retain downloaded archives or the temporary generator in the repository.

- [ ] **Step 3: Wire the texture into the existing globe**

  In `ResearchGlobeCanvas.tsx`, replace:

  ```tsx
  globeImageUrl={null}
  ```

  with:

  ```tsx
  globeImageUrl="/textures/research-earth.png"
  ```

  Adjust only the existing globe material's tint/emissive values if the texture is not legible under current lighting. Do not alter routes, markers, camera movement, flight timing, or fallback behavior.

- [ ] **Step 4: Verify the local asset and code contracts**

  Run:

  ```bash
  file public/textures/research-earth.png
  PATH=/opt/homebrew/bin:$PATH pnpm test -- tests/experience/globe-flight.test.ts tests/experience/research-map-lab.test.tsx
  PATH=/opt/homebrew/bin:$PATH pnpm typecheck
  PATH=/opt/homebrew/bin:$PATH pnpm lint
  git diff --check
  ```

  Expected: PNG is 2048×1024; 16 focused tests pass; typecheck, lint, and diff check pass.

- [ ] **Step 5: Request browser permission and perform visual acceptance**

  After explicit permission, clean-load `http://127.0.0.1:3000/lab/research-map` and verify:

  ```text
  recognizable continents are visible before starting;
  texture seam and orientation are correct;
  green/yellow/red/pending states remain readable;
  a random 1–5 city run completes and re-enables the button;
  no flat fallback or browser console error appears.
  ```

  Leave the page open for the user's visual review. Do not stage or commit.
