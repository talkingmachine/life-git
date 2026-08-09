# Research Globe Productionization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the product's flat research map with the approved mandatory `react-globe.gl` experience, while preserving the existing research, retry, evidence, and journey data flow.

**Architecture:** Product metadata and renderer contracts live in `src/experience/research-map`; the product-facing `ResearchMap` converts candidates to globe routes and owns loading, failure, retry, and flight/reveal state. `ResearchGlobeCanvas` owns only WebGL rendering, local asset readiness, scene lifecycle, selection, and animation. The laboratory keeps a minimal `/lab` catalog, but the `/lab/research-map` experiment, its controller, and its random data generator are removed after their approved renderer is migrated.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 6, `react-globe.gl` 2.38, Three.js 0.183, Vitest 4, Testing Library, CSS Modules.

## Global Constraints

- Work only on the research-map presentation layer; do not change the DB, LLM orchestration, assessment rules, or evidence pipeline.
- Production origin is exactly `🇷🇺 Москва`, `{ lat: 55.7558, lng: 37.6173 }`.
- Current destination is exactly `🇦🇱 Тирана`, `{ lat: 41.3275, lng: 19.8187 }`, country `Албания`.
- The realistic globe is mandatory. Loading and a recoverable fullscreen error are allowed; flat maps, stylized Earth, CSS aircraft, and alternate renderers are not.
- Keep all runtime textures, the airliner GLB, and the Tirana photo local. Do not add runtime network asset loading.
- Do not add automatic weak-device quality selection in this change.
- Keep the approved route geometry, aircraft animation, camera, labels, card, status colors, reduced-motion behavior, and selection behavior.
- Keep yellow research retry and its previous/new evidence snapshot reporting.
- Remove only the research-map laboratory experiment; retain `/lab` as a minimal catalog for future experiments.
- Do not stage or commit intermediate work. The first commit is allowed only after automated verification, fresh browser permission, product parity review, and the user's visual approval.
- Preserve unrelated worktree changes and the untracked `.pnpm-store/` directory.

---

## File Structure

### Product research globe

- Create `src/experience/research-map/contracts.ts`: shared geographic, candidate, route, origin, readiness, and failure types.
- Create `src/experience/research-map/product-route.ts`: fixed Moscow origin, Tirana presentation metadata, and candidate-to-route conversion.
- Move `src/experience/lab/ResearchGlobeCanvas.tsx` to `src/experience/research-map/ResearchGlobeCanvas.tsx`: the single production WebGL renderer.
- Move the visual subset of `src/experience/lab/ResearchMapLab.module.css` to `src/experience/research-map/ResearchGlobe.module.css`: globe, balloons, card, loader, and error overlay styles only.
- Move the six focused scene/lifecycle helpers from `src/experience/lab` to `src/experience/research-map` without duplicating them.
- Rewrite `src/experience/components/ResearchMap.tsx`: product shell, route playback state, mandatory loader/error, dynamic client-only import, and yellow retry overlay.

### Product integration

- Modify `src/experience/view-model.ts`: produce required Tirana geographic and presentation metadata while preserving evidence-derived status and reason.
- Modify `src/experience/components/Vs1Start.tsx`: use the same typed Tirana metadata for pending and remove the landing-page SVG map.
- Modify `src/experience/components/Vs1Journey.tsx` only if the new `ResearchMap` contract requires an explicit run/playback key; do not change action behavior.
- Modify `src/app/globals.css`: remove flat-map, pin, CSS-aircraft, marker-rail, collapsed-green, and landing-map rules; keep only product overlay placement that does not belong to the CSS module.

### Laboratory and assets

- Create `src/app/lab/page.tsx`: minimal catalog explaining that future experiments live on child routes.
- Delete `src/app/lab/research-map/page.tsx`, `src/experience/lab/ResearchMapLab.tsx`, `src/experience/lab/research-map-scenario.ts`, and the old lab CSS after migration.
- Move `public/lab/cities/tirana.jpg` to `public/cities/tirana.jpg` and reduce its attribution file to the retained production image.
- Delete the seven unused synthetic city photos and `public/world-map.svg`.
- Keep `public/models/*` and `public/textures/*` with their attribution documents.

### Tests

- Move the renderer/helper tests to production import paths and rename the lab controller suite to `tests/experience/research-map.test.tsx`.
- Delete only random-scenario/controller expectations that no longer exist.
- Update `tests/integration/experience.test.tsx` for fullscreen globe behavior in pending, green, yellow, and red states.
- Keep all existing non-map integration suites unchanged except for compile-safe imports or assertions directly invalidated by the approved visual replacement.

---

### Task 1: Establish Product Contracts and Migrate Pure Globe Helpers

**Files:**
- Create: `src/experience/research-map/contracts.ts`
- Create: `src/experience/research-map/product-route.ts`
- Move: `src/experience/lab/globe-flight.ts` → `src/experience/research-map/globe-flight.ts`
- Move: `src/experience/lab/globe-journey.ts` → `src/experience/research-map/globe-journey.ts`
- Move: `src/experience/lab/globe-route-scene.ts` → `src/experience/research-map/globe-route-scene.ts`
- Move: `src/experience/lab/globe-scene-objects.ts` → `src/experience/research-map/globe-scene-objects.ts`
- Move: `src/experience/lab/realistic-earth-material.ts` → `src/experience/research-map/realistic-earth-material.ts`
- Move: `src/experience/lab/research-globe-lifecycle.ts` → `src/experience/research-map/research-globe-lifecycle.ts`
- Modify/rename: `tests/experience/globe-*.test.ts`, `tests/experience/realistic-earth-material.test.ts`, `tests/experience/research-globe-lifecycle.test.ts`
- Test: `tests/experience/product-route.test.ts`

**Interfaces:**
- Produces: `CandidateState`, `GeoCoordinate`, `ResearchCandidate`, `GlobeOrigin`, `GlobeRoute`, and `GlobeUnavailableReason` from `contracts.ts`.
- Produces: `MOSCOW_ORIGIN`, `TIRANA_PRESENTATION`, and `createProductGlobeRoute(candidate: ResearchCandidate): GlobeRoute` from `product-route.ts`.
- Preserves: existing helper function names and route geometry behavior.

- [ ] **Step 1: Write failing tests against the production paths**

Add `tests/experience/product-route.test.ts` with exact fixed metadata and route conversion assertions:

```ts
import { describe, expect, it } from "vitest";

import {
  createProductGlobeRoute,
  MOSCOW_ORIGIN,
  TIRANA_PRESENTATION,
} from "../../src/experience/research-map/product-route";

describe("product research route", () => {
  it("uses fixed Moscow and typed Tirana metadata", () => {
    expect(MOSCOW_ORIGIN).toEqual({
      city: "Москва",
      country: "Россия",
      flag: "🇷🇺",
      coordinate: { lat: 55.7558, lng: 37.6173 },
    });
    expect(TIRANA_PRESENTATION).toMatchObject({
      city: "Тирана",
      country: "Албания",
      flag: "🇦🇱",
      coordinate: { lat: 41.3275, lng: 19.8187 },
      photoUrl: "/cities/tirana.jpg",
    });
  });

  it("maps evidence-owned status and reason without name lookup", () => {
    const route = createProductGlobeRoute({
      id: "tirana",
      ...TIRANA_PRESENTATION,
      status: "red",
      reason: { summary: "Основание не подтверждено", officialUrl: "https://official.example/rule" },
    });
    expect(route).toMatchObject({
      key: "moscow-tirana",
      from: MOSCOW_ORIGIN.coordinate,
      to: TIRANA_PRESENTATION.coordinate,
      status: "red",
      rejectionReason: "Основание не подтверждено",
      officialUrl: "https://official.example/rule",
    });
  });
});
```

Change existing helper-test imports from `src/experience/lab/*` to `src/experience/research-map/*` before moving files.

- [ ] **Step 2: Run the focused tests and verify the path migration is red**

Run:

```bash
pnpm exec vitest run tests/experience/product-route.test.ts tests/experience/globe-flight.test.ts tests/experience/globe-journey.test.ts tests/experience/globe-route-scene.test.ts tests/experience/globe-scene-objects.test.ts tests/experience/realistic-earth-material.test.ts tests/experience/research-globe-lifecycle.test.ts
```

Expected: FAIL because `src/experience/research-map` does not exist yet.

- [ ] **Step 3: Add the exact shared types and product metadata**

Implement these stable shapes in `contracts.ts`:

```ts
export type CandidateState = "pending" | "green" | "yellow" | "red";

export interface GeoCoordinate {
  readonly lat: number;
  readonly lng: number;
}

export interface ResearchReason {
  readonly summary: string;
  readonly officialUrl?: string;
}

export interface ResearchCandidate {
  readonly id: string;
  readonly city: string;
  readonly country: string;
  readonly flag: string;
  readonly coordinate: GeoCoordinate;
  readonly description: string;
  readonly photoUrl?: string;
  readonly status: CandidateState;
  readonly reason?: ResearchReason;
}

export interface GlobeOrigin {
  readonly city: string;
  readonly country: string;
  readonly flag: string;
  readonly coordinate: GeoCoordinate;
}

export interface GlobeRoute {
  readonly city: string;
  readonly country: string;
  readonly description: string;
  readonly flag: string;
  readonly key: string;
  readonly label: string;
  readonly from: GeoCoordinate;
  readonly photoUrl?: string;
  readonly rejectionReason?: string;
  readonly officialUrl?: string;
  readonly status: CandidateState;
  readonly to: GeoCoordinate;
}

export type GlobeUnavailableReason =
  | "context-lost"
  | "dynamic-import"
  | "earth-material"
  | "model-load"
  | "react-render"
  | "renderer-init"
  | "webgl-unsupported";
```

Implement `MOSCOW_ORIGIN`, `TIRANA_PRESENTATION`, and a pure `createProductGlobeRoute` that copies all presentation fields and maps `reason.summary`/`reason.officialUrl` into the route. Route key is `moscow-${candidate.id}` and label is `Москва → ${candidate.city}`.

- [ ] **Step 4: Move the helpers, update only their type imports, and remove component coupling**

Use exact file moves, keep helper bodies unchanged, and replace imports such as:

```ts
import type { CandidateState } from "../components/ResearchMap";
import type { GeoCoordinate, GlobeRoute } from "./contracts";
```

`globe-flight.ts` imports `GeoCoordinate` from `contracts.ts` and re-exports it only if an existing consumer still requires that export. `globe-route-scene.ts` imports `GlobeRoute` from `contracts.ts`; it must not import from `components/ResearchMap`.

- [ ] **Step 5: Run the focused pure tests**

Run the command from Step 2.

Expected: PASS with the existing curve, trail, cleanup, material, and lifecycle assertions unchanged, plus the new fixed-route assertions.

---

### Task 2: Migrate the Renderer and Make Asset Readiness Mandatory

**Files:**
- Move: `src/experience/lab/ResearchGlobeCanvas.tsx` → `src/experience/research-map/ResearchGlobeCanvas.tsx`
- Create: `src/experience/research-map/ResearchGlobe.module.css`
- Modify/rename: `tests/experience/research-map-lab.test.tsx` → `tests/experience/research-globe-canvas.test.tsx` for renderer-only cases

**Interfaces:**
- Consumes: `GlobeOrigin`, `GlobeRoute`, `GlobeUnavailableReason` from `contracts.ts`.
- Produces: `ResearchGlobeCanvasProps` with `onReady(): void`, `onFlightComplete(flightKey: string): void`, and `onUnavailable(reason, error?)`.
- Guarantees: `onReady` fires once only after renderer initialization, realistic Earth material, and aircraft GLB are all ready.

- [ ] **Step 1: Move renderer tests to the production import and add readiness/failure assertions**

Keep the current renderer tests for orientation, camera framing, balloons, selected detail card, route persistence, context loss, flight completion, reduced motion, and cleanup. Add these focused cases:

```tsx
it("reports ready only after renderer, Earth, and aircraft are ready", async () => {
  const onReady = vi.fn();
  render(<ResearchGlobeCanvas {...commonProps} onReady={onReady} />);
  expect(onReady).not.toHaveBeenCalled();
  earthHarness.resolve();
  await waitFor(() => expect(onReady).toHaveBeenCalledOnce());
});

it("turns an Earth asset rejection into a mandatory globe failure", async () => {
  const onUnavailable = vi.fn();
  earthHarness.reject(new Error("night texture missing"));
  render(<ResearchGlobeCanvas {...commonProps} onReady={vi.fn()} onUnavailable={onUnavailable} />);
  await waitFor(() => expect(onUnavailable).toHaveBeenCalledWith(
    "earth-material",
    expect.any(Error),
  ));
});
```

The material mock must be controllable and resolve a small disposable `RealisticEarthBundle`; do not leave the current never-resolving promise in readiness tests.

- [ ] **Step 2: Run the renderer suite and verify it fails**

Run:

```bash
pnpm exec vitest run tests/experience/research-globe-canvas.test.tsx
```

Expected: FAIL because the renderer still uses lab imports, has no `onReady`, and warns instead of failing on Earth asset errors.

- [ ] **Step 3: Move the renderer and approved visual styles**

Move the component to the product directory and change its style import to:

```ts
import styles from "./ResearchGlobe.module.css";
```

Copy only `.globe`, balloon, selected-balloon, detail-card, responsive detail-card, and reduced-motion rules into the new module. Do not copy `.lab`, `.toolbar`, or `.label`.

- [ ] **Step 4: Add the mandatory readiness handshake**

Extend the prop contract:

```ts
export interface ResearchGlobeCanvasProps {
  readonly activeFlight?: GlobeRoute;
  readonly origin: GlobeOrigin;
  readonly overview: GlobeOverview;
  readonly routes: readonly GlobeRoute[];
  readonly onFlightComplete: (flightKey: string) => void;
  readonly onReady: () => void;
  readonly onUnavailable: (reason: GlobeUnavailableReason, error?: unknown) => void;
}
```

Track a `readyReported` ref and report readiness exactly once:

```ts
useEffect(() => {
  if (!globeReady || realisticEarth === undefined || planeTemplate === undefined) return;
  if (readyReported.current) return;
  readyReported.current = true;
  onReady();
}, [globeReady, onReady, planeTemplate, realisticEarth]);
```

Gate flight creation and flight execution on the same three conditions so no hidden flight finishes underneath the fullscreen loader.

- [ ] **Step 5: Remove the visible preview fallback and make Earth failures terminal**

Remove `startPreviewTextureLoad`, `PreviewTextureLease`, and the preview texture lifecycle. The Globe may initialize behind the opaque loader using its internal/default material, but the product must never uncover it until `realisticEarth` is ready.

Replace the material load rejection branch with:

```ts
(error: unknown) => {
  if (active) onUnavailable("earth-material", error);
}
```

Change realistic-Earth shader failure from warning-and-revert to `onUnavailable("earth-material", new Error("Realistic Earth shader compilation failed"))`. Do not restore a stylized material.

- [ ] **Step 6: Preserve source evidence in the selected marker card**

Keep the approved card UI. When `selectedRoute.officialUrl` exists, render:

```tsx
<a href={selectedRoute.officialUrl}>Официальный источник</a>
```

The link appears with the red/yellow reason content and does not alter the evidence URL.

- [ ] **Step 7: Run renderer and helper tests**

Run:

```bash
pnpm exec vitest run tests/experience/research-globe-canvas.test.tsx tests/experience/globe-flight.test.ts tests/experience/globe-journey.test.ts tests/experience/globe-route-scene.test.ts tests/experience/globe-scene-objects.test.ts tests/experience/realistic-earth-material.test.ts tests/experience/research-globe-lifecycle.test.ts
```

Expected: PASS; no lab imports remain in renderer/helper tests.

---

### Task 3: Replace `ResearchMap` with the Mandatory Product Globe Shell

**Files:**
- Rewrite: `src/experience/components/ResearchMap.tsx`
- Create: `tests/experience/research-map.test.tsx`
- Modify: `src/experience/research-map/ResearchGlobe.module.css`

**Interfaces:**
- Consumes: `ResearchCandidate`, `GlobeRoute`, and failure types from `contracts.ts`; `createProductGlobeRoute` and `MOSCOW_ORIGIN`; dynamically imported `ResearchGlobeCanvas`.
- Preserves: `mode`, `candidates`, `previousRun`, and `onRetry` product props.
- Optional test seams: `detectWebGL?: () => boolean` and `renderGlobe?: (props: ResearchGlobeCanvasProps) => ReactNode`; production callers do not pass them.

- [ ] **Step 1: Write product-shell tests before deleting the old stage**

Create a `renderGlobe` capture harness and add tests that assert:

```tsx
it.each(["green", "yellow", "red"] as const)(
  "renders a completed globe for an initial %s result without replay",
  (status) => {
    let props: ResearchGlobeCanvasProps | undefined;
    render(<ResearchMap
      candidates={[candidate(status)]}
      detectWebGL={() => true}
      mode={status}
      renderGlobe={(next) => { props = next; return <div data-testid="globe" />; }}
    />);
    expect(props?.routes).toHaveLength(1);
    expect(props?.routes[0]?.status).toBe(status);
    expect(props?.activeFlight).toBeUndefined();
  },
);

it("runs exactly one Moscow to Tirana flight while pending", () => {
  let props: ResearchGlobeCanvasProps | undefined;
  render(<ResearchMap
    candidates={[candidate("pending")]}
    detectWebGL={() => true}
    mode="pending"
    renderGlobe={(next) => { props = next; return <div data-testid="globe" />; }}
  />);
  expect(props?.origin).toEqual(MOSCOW_ORIGIN);
  expect(props?.activeFlight?.key).toBe("moscow-tirana");
  act(() => props?.onFlightComplete("moscow-tirana"));
  expect(props?.activeFlight).toBeUndefined();
  expect(props?.routes).toHaveLength(1);
});
```

Also assert loader status semantics, `onReady` removal of loader, unsupported WebGL error, each `onUnavailable` reason, non-dynamic retry remount, dynamic-import page reload, and absence of `world-map.svg`, percentage pin styles, CSS airplane, marker list, and collapsed-green markup.

- [ ] **Step 2: Run the shell test and verify the old implementation fails the new contract**

Run:

```bash
pnpm exec vitest run tests/experience/research-map.test.tsx
```

Expected: FAIL because `ResearchMapStage` still renders the SVG/CSS map and terminal green is collapsed.

- [ ] **Step 3: Implement a client-only dynamic renderer with explicit dynamic failure**

Keep the existing proven catch shape, moved to production imports:

```tsx
const DynamicResearchGlobe = dynamic<ResearchGlobeCanvasProps>(
  () => import("../research-map/ResearchGlobeCanvas")
    .then((module) => module.ResearchGlobeCanvas)
    .catch((error: unknown) => function DynamicLoadFailure(props) {
      useEffect(() => props.onUnavailable("dynamic-import", error), [props.onUnavailable]);
      return null;
    }),
  { ssr: false },
);
```

Keep a focused React error boundary that calls `onUnavailable("react-render", error)` and renders no alternate visual.

- [ ] **Step 4: Implement route playback without lab timers or randomness**

Derive routes with `candidates.map(createProductGlobeRoute)`. Use one integer overview/attempt key and a set of visually completed route keys. The behavior is:

```ts
const activeFlight = mode === "pending"
  ? routes.find((route) => !completedRouteKeys.has(route.key))
  : undefined;
```

When a new pending phase begins, clear completion state and increment the overview key. When `onFlightComplete(key)` fires, mark only that route complete. If status becomes terminal before the animation completes, stop replay by supplying no active flight; the renderer reconciles the route as completed. An initially terminal mount never supplies `activeFlight`.

- [ ] **Step 5: Implement mandatory loader, error, and retry**

Render one `100svh` region with the globe mounted beneath an opaque overlay. Loader contract:

```tsx
<div aria-live="polite" className={styles.loadingOverlay} role="status">
  <span aria-hidden="true" className={styles.loadingSpinner} />
  <p>Загружаем глобус и маршрут…</p>
</div>
```

Failure contract:

```tsx
<div className={styles.errorOverlay} role="alert">
  <h2>Не удалось загрузить глобус</h2>
  <p>Проверьте соединение и попробуйте снова.</p>
  <button onClick={retryGlobe} type="button">Повторить</button>
</div>
```

For `dynamic-import`, `retryGlobe` calls `window.location.reload()`. For all other reasons it clears failure, marks loading, increments attempt key, and remounts the renderer. WebGL detection runs before the renderer is shown; unsupported WebGL uses the same error UI.

- [ ] **Step 6: Preserve yellow retry as ordinary HTML overlay**

Move the existing retry block unchanged in behavior above the globe. Keep exact previous/new `runId` and `evidenceSnapshotId` reporting and the existing failure copy. It must not replace or hide the mandatory globe except while `ResearchMap` is in its own loading/error state.

- [ ] **Step 7: Run product-shell tests**

Run:

```bash
pnpm exec vitest run tests/experience/research-map.test.tsx
```

Expected: PASS for pending flight, terminal no-replay, Moscow/Tirana props, readiness gate, every failure reason, retry behavior, and old-map absence.

---

### Task 4: Wire the Real Product Journey to the New Candidate Contract

**Files:**
- Modify: `src/experience/view-model.ts`
- Modify: `src/experience/components/Vs1Start.tsx`
- Modify if required: `src/experience/components/Vs1Journey.tsx`
- Modify: `tests/integration/experience.test.tsx`
- Modify if type assertions require it: `tests/integration/present-journey.test.ts`

**Interfaces:**
- Consumes: `TIRANA_PRESENTATION` and `ResearchCandidate`.
- Preserves: evidence-derived marker, reason summary, official URL, retry action, and journey branch actions.
- Produces: the same candidate metadata in start-pending and persisted-run views.

- [ ] **Step 1: Replace old flat-map integration assertions**

Change the pending/terminal map tests to capture the production renderer props and assert:

```ts
expect(globeProps.origin.city).toBe("Москва");
expect(globeProps.origin.coordinate).toEqual({ lat: 55.7558, lng: 37.6173 });
expect(globeProps.routes[0]).toMatchObject({
  city: "Тирана",
  country: "Албания",
  flag: "🇦🇱",
  to: { lat: 41.3275, lng: 19.8187 },
});
```

For green, yellow, and red, assert a fullscreen map region remains and `data-collapsed` is absent. For red/yellow, click the globe balloon through the renderer test rather than expecting the deleted marker rail. Keep the integration test proving yellow retry preserves the previous snapshot and reports the new snapshot.

- [ ] **Step 2: Run the integration tests and verify metadata failures**

Run:

```bash
pnpm exec vitest run tests/integration/experience.test.tsx tests/integration/present-journey.test.ts
```

Expected: FAIL because `createJourneyView` still emits percentage coordinates and start-pending lacks required presentation fields.

- [ ] **Step 3: Update `createJourneyView` without changing assessment ownership**

Replace `origin`, `destination`, and `point` with the shared presentation object:

```ts
candidate: Object.freeze({
  id: "tirana",
  ...TIRANA_PRESENTATION,
  status: details.run.assessment.marker,
  ...(firstReason === undefined ? {} : {
    reason: Object.freeze({
      summary: reasonSummary(firstReason.code, firstReason.blockerKind),
      ...(reasonUrl === undefined ? {} : { officialUrl: reasonUrl }),
    }),
  }),
}),
```

Do not modify `reasonSummary`, source lineage, or assessment selection.

- [ ] **Step 4: Update the pending start path and remove the landing SVG**

Use the same required candidate shape:

```tsx
<ResearchMap
  candidates={[{ id: "tirana", ...TIRANA_PRESENTATION, status: "pending" }]}
  mode="pending"
/>
```

Delete the `<figure className="landing__map">` containing `/world-map.svg`. Leave the form and scope copy unchanged; do not add a second decorative globe to the landing page.

- [ ] **Step 5: Verify real retry and journey integration tests**

Run:

```bash
pnpm exec vitest run tests/integration/experience.test.tsx tests/integration/journey-actions.test.tsx tests/integration/present-journey.test.ts
```

Expected: PASS, including the yellow retry snapshot contract and branch actions.

---

### Task 5: Remove the Globe Experiment but Preserve the Laboratory

**Files:**
- Create: `src/app/lab/page.tsx`
- Delete: `src/app/lab/research-map/page.tsx`
- Delete: `src/experience/lab/ResearchMapLab.tsx`
- Delete: `src/experience/lab/ResearchMapLab.module.css`
- Delete: `src/experience/lab/research-map-scenario.ts`
- Delete: `tests/experience/research-map-scenario.test.ts`
- Delete migrated controller-only portions from the former `tests/experience/research-map-lab.test.tsx`
- Move: `public/lab/cities/tirana.jpg` → `public/cities/tirana.jpg`
- Create: `public/cities/ATTRIBUTION.md`
- Delete: `public/lab/cities/athens.jpg`, `belgrade.jpg`, `bucharest.jpg`, `podgorica.jpg`, `sarajevo.jpg`, `skopje.jpg`, `sofia.jpg`, and old `public/lab/cities/ATTRIBUTION.md`
- Delete: `public/world-map.svg`
- Modify: `src/app/globals.css`
- Test: `tests/experience/lab-catalog.test.tsx`

**Interfaces:**
- Produces: `/lab` as a lightweight catalog with no globe imports.
- Removes: `/lab/research-map`, random origins, random candidate generation, lab toolbar, lab timers, old SVG map, and synthetic city assets.

- [ ] **Step 1: Add a failing catalog test and source-cleanup assertions**

Create `tests/experience/lab-catalog.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import LabPage from "../../src/app/lab/page";

describe("lab catalog", () => {
  it("keeps a neutral home for future experiments", () => {
    render(<LabPage />);
    expect(screen.getByRole("main")).toBeTruthy();
    expect(screen.getByRole("heading", { name: /лаборатория/i })).toBeTruthy();
    expect(screen.queryByText(/запустить исследование/i)).toBeNull();
  });
});
```

Run:

```bash
pnpm exec vitest run tests/experience/lab-catalog.test.tsx
```

Expected: FAIL because `/lab` has no catalog page.

- [ ] **Step 2: Create the minimal lab catalog**

Implement a server component with no product imports:

```tsx
export default function LabPage(): React.JSX.Element {
  return (
    <main className="lab-catalog">
      <p className="eyebrow">Design lab</p>
      <h1>Лаборатория</h1>
      <p>Здесь будут появляться отдельные эксперименты интерфейса.</p>
    </main>
  );
}
```

Add only a compact `.lab-catalog` layout to `globals.css`; do not recreate the globe toolbar or experiment controller.

- [ ] **Step 3: Move the retained Tirana asset and attribution**

Move the binary unchanged to `public/cities/tirana.jpg`. Create `public/cities/ATTRIBUTION.md` containing only:

```md
# City photo attribution

The production runtime stores this image locally and does not contact an external image host.

| Local file | Work and author | License | Source |
| --- | --- | --- | --- |
| `tirana.jpg` | “Panorama of Tirana (2020)” by P4Jags | [CC BY-SA 2.0](https://creativecommons.org/licenses/by-sa/2.0/) | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Panorama_of_Tirana_(2020).jpg) |
```

Update the route metadata to `/cities/tirana.jpg` and verify no runtime path contains `/lab/cities/`.

- [ ] **Step 4: Delete exact obsolete files and CSS selectors**

Delete the explicit files listed for this task. From `globals.css`, remove `.landing__map`, `.research-map__art`, `.research-map__pin*`, `.research-map__flight*`, `.research-map__airplane`, `.research-map__markers`, `.research-map__marker*`, `.research-map--collapsed*`, and their responsive/reduced-motion blocks. Keep only classes still rendered by the new shell, such as its fullscreen container and yellow retry overlay.

- [ ] **Step 5: Run lab and product-map tests**

Run:

```bash
pnpm exec vitest run tests/experience/lab-catalog.test.tsx tests/experience/research-map.test.tsx tests/experience/research-globe-canvas.test.tsx tests/integration/experience.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Prove obsolete runtime references are gone**

Run these narrowly scoped searches:

```bash
rg -n "world-map\.svg|ResearchMapStage|MapPoint|ResearchFlight|research-map__pin|research-map__airplane|research-map--collapsed|/lab/cities|ResearchMapLab|createResearchMapScenario|createResearchOrigin" src tests public
rg -n "src/experience/lab|experience/lab" src tests
```

Expected: both commands return no matches. Confirm `src/app/lab/page.tsx` exists and `src/app/lab/research-map/page.tsx` does not.

---

### Task 6: Full Nonvisual Gate and Browser-Parity Handoff

**Files:**
- Review: all changed files from Tasks 1–5
- Do not stage or commit in this task before user approval

**Interfaces:**
- Verifies: all repository tests, TypeScript, lint, production build, local asset presence, no old fallback, and clean lifecycle contracts.
- Hands off: a running product URL only after obtaining fresh explicit browser permission.

- [ ] **Step 1: Run the full automated gate**

Run sequentially so the failing command is unambiguous:

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

Expected: all commands exit 0. If `next build` rewrites `tsconfig.json` or `next-env.d.ts`, inspect the diff and restore only generated, unintended changes with `apply_patch`; do not discard user edits.

- [ ] **Step 2: Verify mandatory local assets and attribution**

Run:

```bash
test -f public/cities/tirana.jpg
test -f public/cities/ATTRIBUTION.md
test -f public/models/research-airliner.glb
test -f public/models/ATTRIBUTION.md
test -f public/textures/earth-day-4k.jpg
test -f public/textures/earth-night-4k.jpg
test -f public/textures/earth-elevation-2k.png
test -f public/textures/earth-normal-2k.png
test -f public/textures/ATTRIBUTION.md
```

Expected: every command exits 0.

- [ ] **Step 3: Review the complete diff and staging boundary**

Run:

```bash
git status --short
git diff --check
git diff --stat
git diff -- src/experience src/app tests public docs package.json pnpm-lock.yaml pnpm-workspace.yaml
git diff --cached --stat
```

Expected: no whitespace errors, no accidental unrelated deletions, `.pnpm-store/` remains untouched and untracked, and the staged diff is empty.

- [ ] **Step 4: Ask for fresh browser permission**

Stop after the nonvisual gate and tell the user exactly what passed. Ask for explicit permission to use the browser for the production parity check. Do not treat the ambient in-app browser state as permission.

- [ ] **Step 5: After permission, run and inspect the real product flows**

Start the existing dev server and give the exact product URL, normally:

```text
http://127.0.0.1:3000/
```

In the browser, verify at the same viewport used for the approved lab:

1. Start pending research and confirm the fullscreen loader fully covers any provisional sphere.
2. Confirm the loader disappears only when realistic Earth, aircraft, and WebGL are ready.
3. Confirm Москва → Тирана flight, synchronized trail, landing, completed line, and pending balloon.
4. Confirm terminal green/yellow/red retain the full globe and do not replay on direct terminal load.
5. Confirm balloon keyboard/click selection, camera centering, Tirana image, status/reason, official source link, and close control.
6. Confirm yellow retry preserves previous/new snapshot reporting and starts a new pending flight.
7. Emulate reduced motion and confirm immediate completed route plus destination reveal.
8. Inspect the console for runtime errors, asset 404s, hydration errors, and WebGL warnings.
9. Navigate to `/lab` and confirm the catalog remains; navigate to `/lab/research-map` and confirm the experiment is gone.

- [ ] **Step 6: Obtain visual approval before the first commit**

Report the exact URL and browser findings. Do not stage, commit, or push until the user explicitly approves the integrated production result. After approval, run the full automated gate once more if browser-driven fixes occurred, then create the single first commit and push according to the existing repository authorization.

---

## Self-Review Record

- Spec coverage: every product state, fixed route, mandatory loading/error contract, renderer migration, source/evidence preservation, laboratory retention, asset cleanup, accessibility, reduced motion, and commit gate maps to a task above.
- Scope: no DB, LLM, assessment, evidence-fetching, or weak-device quality work is included.
- Type consistency: `ResearchCandidate.coordinate` maps to `GlobeRoute.to`; `MOSCOW_ORIGIN.coordinate` maps to `GlobeRoute.from`; `GlobeUnavailableReason` includes the required Earth failure; all consumers use the same shared contracts.
- Placeholder scan: every implementation and test step is concrete; no deferred markers or cross-task shorthand remain.
- Destructive scope: every deleted route, module, photo, and CSS family is named; the laboratory root, models, textures, attribution, and unrelated worktree changes are explicitly retained.
