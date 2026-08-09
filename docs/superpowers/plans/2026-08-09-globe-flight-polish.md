# Globe Flight Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the realistic globe laboratory into a calm origin-to-candidate journey with readable terrain lighting, fixed overview camera, detached growing trails, an ordered landing sequence, an approved recolorable 3D pin, and a licensed low-poly airliner.

**Architecture:** Keep `react-globe.gl` as the only renderer. Extend the focused Earth-material module for the normal map and synchronized sun, keep geographic/camera math in `globe-flight.ts`, and isolate custom marker/trail geometry in one small `globe-scene-objects.ts` module. `ResearchMapLab` owns scenario semantics; `ResearchGlobeCanvas` only coordinates Three.js objects and lifecycle.

**Tech Stack:** Next.js 16, React 19, react-globe.gl 2.38, Three.js 0.183 (`Line2` helpers included in Three examples), Vitest, local NASA/NOAA-derived textures, local CC BY 3.0 glTF 2.0 aircraft.

## Global Constraints

- Change only `/lab/research-map`, its focused lab modules/tests, and local lab visual assets.
- Production data flow, database, LLM, knowledge base, and source pipeline remain untouched.
- Terrain is intentionally expressive: displacement scale `3`, not geodetically exact.
- Every flight starts at the user origin; candidates are never chained.
- Active trails keep a visible world-space gap behind the aircraft; after landing they settle into
  the submerged destination before the marker is revealed.
- Automatic globe rotation is disabled; the camera moves once per run and zoom remains tightly bounded.
- Use the approved local Sketchfab pin with named `pin_head` and `pin_stem` parts, not procedural
  cylinder/sphere marker geometry.
- Add no package dependency and no parallel rendering/fallback system.
- Keep full reduced-motion behavior and cancel/dispose every owned frame, geometry, material, texture, and aircraft clone.
- Do not stage or commit until the user visually approves the experiment.
- Do not retain downloaded archives, preview images, or conversion scripts in the repository.

---

### Task 1: Add terrain normals and synchronized sunlight

**Files:**
- Create: `public/textures/earth-normal-2k.png`
- Modify: `src/experience/lab/realistic-earth-material.ts`
- Modify: `src/experience/lab/ResearchGlobeCanvas.tsx`
- Modify: `tests/experience/realistic-earth-material.test.ts`
- Modify: `.superpowers/sdd/2026-08-09-realistic-earth/task-1-report.md`

**Interfaces:**
- Consumes: `/textures/earth-elevation-2k.png`, the numeric NOAA ETOPO provenance already recorded, and the existing `RealisticEarthBundle`.
- Produces:

```ts
export interface RealisticEarthBundle {
  readonly material: MeshStandardMaterial;
  readonly readyMs: number;
  readonly estimatedGpuBytes: number;
  dispose(): void;
  getSunDirection(target: Vector3): Vector3;
  setSunAngle(angleRadians: number): void;
}
```

- [ ] **Step 1: Generate the local 2K tangent-space normal map outside the repository**

Read `earth-elevation-2k.png` as normalized height. For every pixel, use wrap-aware central
differences in X and clamped neighbors in Y:

```text
dx = (height[x+1,y] - height[x-1,y]) / 255
dy = (height[x,y+1] - height[x,y-1]) / 255
normal = normalize(vec3(-dx * 6, dy * 6, 1))
rgb = round((normal * 0.5 + 0.5) * 255)
```

Write `public/textures/earth-normal-2k.png` as RGB 2048×1024 PNG. Use a one-off command in
`/private/tmp`; retain no generator. Append the transform, size, mode, seam MAE, SHA-256, and NOAA
source inheritance to the texture report.

- [ ] **Step 2: Write failing material tests for the fourth texture and shared sun direction**

Extend the loader mock to return `day`, `night`, `elevation`, and `normal`. Assert:

```ts
expect(material.displacementScale).toBe(3);
expect(material.bumpMap).toBeNull();
expect(material.normalMap).toBe(normal);
expect(material.normalScale.x).toBeCloseTo(1);
expect(material.normalScale.y).toBeCloseTo(1);
expect(bundle.estimatedGpuBytes).toBe(111_848_107);

const direction = bundle.getSunDirection(new Vector3());
bundle.setSunAngle(Math.PI / 2);
expect(bundle.getSunDirection(direction).z).toBeCloseTo(1);
```

Also expect partial-load failure and double `dispose()` to dispose all four textures exactly once.

- [ ] **Step 3: Run the focused test to verify RED**

Run:

```bash
PATH=/opt/homebrew/bin:$PATH pnpm test -- tests/experience/realistic-earth-material.test.ts
```

Expected: FAIL because only three textures are loaded, `normalMap`/`getSunDirection` are absent,
and the old GPU estimate is `100_663_296`.

- [ ] **Step 4: Implement the fourth texture and updated material contract**

Load `/textures/earth-normal-2k.png` with `NoColorSpace`, mipmapped linear filtering, and the same
failure/disposal ownership as the other textures. Configure:

```ts
new MeshStandardMaterial({
  map: day,
  normalMap: normal,
  normalScale: new Vector2(1, 1),
  displacementMap: elevation,
  displacementScale: 3,
  displacementBias: 0,
  metalness: 0.02,
  roughness: 0.82,
});
```

Remove `bumpMap`/`bumpScale`. Include all four dimensions in `estimateTextureGpuBytes`. Implement
`getSunDirection(target)` as `target.copy(sunDirection)` so callers cannot replace the owned vector.

- [ ] **Step 5: Synchronize the physical directional light with the shader sun**

Create stable `AmbientLight` and `DirectionalLight` objects in `ResearchGlobeCanvas`. Use ambient
intensity `0.55` and directional intensity `2.5`. After every `setSunAngle`, run:

```ts
realisticEarth.getSunDirection(sunLight.position).multiplyScalar(300);
```

Use those stable lights in `currentGlobe.lights(...)`. Reduced motion applies one fixed direction
without scheduling a sun frame. Dispose the preview map explicitly when the realistic material
replaces it if react-globe.gl attached one to the stylized material.

- [ ] **Step 6: Run focused verification**

Run:

```bash
PATH=/opt/homebrew/bin:$PATH pnpm test -- tests/experience/realistic-earth-material.test.ts
PATH=/opt/homebrew/bin:$PATH pnpm typecheck
git diff --check
file public/textures/earth-normal-2k.png
du -ch public/textures/earth-*-2k.png public/textures/earth-*-4k.jpg
```

Expected: test GREEN; exact RGB 2048×1024 normal map; total transfer remains recorded; typecheck and
diff check pass. Stop without staging or committing.

---

### Task 2: Make every route origin-based and lock the overview camera

**Files:**
- Modify: `src/experience/lab/globe-flight.ts`
- Modify: `src/experience/lab/ResearchMapLab.tsx`
- Modify: `src/experience/lab/ResearchGlobeCanvas.tsx`
- Modify: `tests/experience/globe-flight.test.ts`
- Modify: `tests/experience/research-map-lab.test.tsx`

**Interfaces:**
- Produces:

```ts
export function sphericalMeanCoordinate(
  coordinates: readonly GeoCoordinate[],
): GeoCoordinate | undefined;

export interface GlobeOverview {
  readonly key: number;
  readonly coordinates: readonly GeoCoordinate[];
}

export interface ResearchGlobeCanvasProps {
  readonly activeFlight?: GlobeRoute;
  readonly overview?: GlobeOverview;
  readonly routes: readonly GlobeRoute[];
  // existing callbacks unchanged
}
```

- [ ] **Step 1: Write failing geographic and lab-routing tests**

Add tests that assert a spherical mean handles `170°` and `-170°` longitude near the antimeridian,
returns `undefined` for an empty list, and falls back to the first coordinate when vectors cancel.

In the lab test, start a two-city scenario and inspect `renderGlobe` props. Assert both route keys
are `russia-<city>`, every `route.from` equals `{ lat: 55.7558, lng: 37.6173 }`, and
`overview.coordinates` already contains Russia plus both cities while only the first candidate is
visible.

- [ ] **Step 2: Run the tests to verify RED**

Run:

```bash
PATH=/opt/homebrew/bin:$PATH pnpm test -- tests/experience/globe-flight.test.ts tests/experience/research-map-lab.test.tsx
```

Expected: FAIL because `sphericalMeanCoordinate`/`overview` do not exist and routes still chain.

- [ ] **Step 3: Implement spherical mean and origin-only route semantics**

Average unit Cartesian vectors and normalize before converting back to latitude/longitude. If the
vector length is below `1e-8`, return a copy of the first coordinate.

In `ResearchMapLab`, remove previous-city routing from `toFlight`, completion keys, and
`globeRoutes`. Every candidate uses `russiaGeo`, key `russia-${city.id}`, and origin `Россия`.
Pass this overview on every non-idle render:

```ts
overview: {
  key: runToken.current,
  coordinates: [russiaGeo, ...scenario.map((city) => city.geo)],
}
```

- [ ] **Step 4: Implement one camera move, no auto-rotation, and tight zoom**

When `globeReady` and a new `overview.key` arrive, call `pointOfView` once using the spherical mean,
altitude `1.1`, and transition `850 ms` (`0` under reduced motion). Do not call `pointOfView` from
the active-flight effect.

Configure controls whenever the globe initializes:

```ts
const radius = currentGlobe.getGlobeRadius();
controls.autoRotate = false;
controls.enableDamping = true;
controls.minDistance = radius * 1.82;
controls.maxDistance = radius * 2.35;
```

Leave manual rotation and damping enabled.

- [ ] **Step 5: Run focused verification**

Run the Task 2 tests, `pnpm typecheck`, and `git diff --check`. Expected: routing/camera math tests
GREEN and no existing sequential-playback regression. Stop without staging or committing.

---

### Task 3: Replace cylinders with glowing pins and add a growing trail

**Files:**
- Create: `src/experience/lab/globe-scene-objects.ts`
- Modify: `src/experience/lab/ResearchGlobeCanvas.tsx`
- Create: `tests/experience/globe-scene-objects.test.ts`
- Verify: `tests/experience/globe-flight.test.ts`

**Interfaces:**
- Produces:

```ts
export interface GlobePinHandle {
  readonly object: Group;
  dispose(): void;
  setSpinnerAngle(angleRadians: number): void;
  setStatus(status: CandidateState): void;
}

export interface GlobeTrailHandle {
  readonly object: Group;
  dispose(): void;
  setColor(core: string, halo: string): void;
  setPoints(points: readonly Vector3[], viewport: { width: number; height: number }): void;
}

export function createGlowingPin(status: CandidateState): GlobePinHandle;
export function createGlobeTrail(color: string): GlobeTrailHandle;
```

- [ ] **Step 1: Write failing scene-object lifecycle tests**

Assert that a pin contains a stem, emissive orb, halo, and pending spinner; `setStatus("red")`
updates its visible material colors; `setSpinnerAngle` rotates only the spinner; double disposal
disposes each owned geometry/material once.

Assert that `createGlobeTrail` returns a group containing halo/core `Line2` children; `setColor`
updates both materials; `setPoints` updates both `LineGeometry` positions and both
`LineMaterial.resolution` values; double disposal is idempotent.

- [ ] **Step 2: Run the new test to verify RED**

Run:

```bash
PATH=/opt/homebrew/bin:$PATH pnpm test -- tests/experience/globe-scene-objects.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the focused Three.js scene-object module**

Build each pin from a slim cylinder stem, emissive sphere, translucent halo sphere, and torus
spinner. Share no global mutable scene state. Tag children with `userData.part` so focused tests and
future visual tuning can identify `stem`, `orb`, `halo`, and `spinner` without relying on array order.

Build the trail with Three examples `Line2`, `LineGeometry`, and `LineMaterial`. Put a halo line
(`linewidth: 7`, `opacity: 0.18`) and core line (`linewidth: 3`, `opacity: 0.95`) in one group; both
use `transparent: true` and `depthTest: true`. Do not add a dependency or a generic layer API.

- [ ] **Step 4: Write the coordinate helpers for pins and trails inside the canvas**

Use these exact visual constants:

```ts
const PIN_ANCHOR_ALTITUDE = 0.034;
const ROUTE_SUBMERGED_ALTITUDE = -0.004;
const PLANE_MIN_ALTITUDE = 0.045;
const ROUTE_PEAK_ALTITUDE = 0.2;
const TRAIL_SEGMENTS = 64;
```

Position each pin at `getCoords(lat, lng, PIN_ANCHOR_ALTITUDE)` and rotate its local Y axis onto the
outward radial vector. The stem extends inward far enough to overlap the maximum displaced surface.

For a completed route, sample 65 great-circle points. Altitude is:

```ts
ROUTE_SUBMERGED_ALTITUDE + Math.sin(Math.PI * t) * ROUTE_PEAK_ALTITUDE
```

Thus both final endpoints are hidden inside the globe. During flight, sample only through current
progress and keep the active trail's last point at the aircraft position. At progress `1`, append
the submerged destination anchor so the completed route visibly enters the ground.

- [ ] **Step 5: Integrate custom pins, active trail, and cleanup**

Remove `pointsData`, `ringsData`, and their cylinder/ring accessors. Cache one pin handle per route
key, update status without rebuilding it, and dispose pins removed by restart. Add pin objects,
active trail, completed trails, and the existing aircraft to `customLayerData`.

Remove the existing `arcsData` rendering and its accessors. Use the custom trail handles for both
active and completed routes so there is exactly one visual path per route. Update each completed
trail's core/halo colors when its candidate status changes.

Use one spinner animation frame only while a pending pin exists and reduced motion is false. Cancel
it on status completion, restart, and unmount. Do not drive React state per frame.

- [ ] **Step 6: Verify trail completion and cancellation**

Run:

```bash
PATH=/opt/homebrew/bin:$PATH pnpm test -- tests/experience/globe-scene-objects.test.ts tests/experience/globe-flight.test.ts tests/experience/research-map-lab.test.tsx
PATH=/opt/homebrew/bin:$PATH pnpm typecheck
PATH=/opt/homebrew/bin:$PATH pnpm lint
git diff --check
```

Expected: focused scene/lifecycle tests GREEN, existing flight cancellation GREEN, no lint/type
errors. Stop without staging or committing.

---

### Task 4: Replace the arrow with the licensed low-poly airliner

**Files:**
- Create: `public/models/research-airliner.glb`
- Create: `public/models/ATTRIBUTION.md`
- Delete: `public/models/research-plane.gltf`
- Modify: `src/experience/lab/ResearchGlobeCanvas.tsx`

**Interfaces:**
- Consumes: Poly Pizza model page `https://poly.pizza/m/a3XrQkLNna9` and direct GLB
  `https://static.poly.pizza/e6ac358e-e5a4-4a1b-8ffe-71d6d7ffa52f.glb`.
- Produces: local runtime URL `/models/research-airliner.glb`.

- [ ] **Step 1: Download and verify the exact model outside the repository**

Download the direct GLB to `/private/tmp`. Verify:

```text
format: glTF binary 2.0
exact bytes: 193456
model page triangles: 11287
creator: Poly by Google
license: Creative Commons Attribution 3.0
```

Reject the file if these values or the model page identity do not match.

- [ ] **Step 2: Install only the final GLB and attribution**

Copy the verified file to `public/models/research-airliner.glb`. Write `ATTRIBUTION.md` with title,
creator, model page, direct source, CC BY 3.0 license URL, exact bytes, and a note that no geometry or
textures were modified. Remove the obsolete arrow-like `research-plane.gltf`.

- [ ] **Step 3: Load and normalize the airliner**

Change the GLTF loader URL to `/models/research-airliner.glb`. After load, compute a `Box3`, center
the model around the origin, normalize its longest dimension to a stable scene size, and apply one
documented local-axis correction before the existing tangent/radial flight orientation. Do not
hardcode the previous `scale.setScalar(5.5)`.

Set the visual length target to `5.5` Three.js scene units. Keep clone/disposal behavior unchanged.

- [ ] **Step 4: Verify asset and nonvisual integration**

Run:

```bash
file public/models/research-airliner.glb
du -h public/models/research-airliner.glb
rg -n "research-plane|research-airliner" src public/models docs/superpowers
PATH=/opt/homebrew/bin:$PATH pnpm test -- tests/experience
PATH=/opt/homebrew/bin:$PATH pnpm typecheck
PATH=/opt/homebrew/bin:$PATH pnpm lint
git diff --check
git diff --cached --name-only
```

Expected: one 193456-byte glTF 2.0 binary; no runtime reference to the old model; all lab tests,
typecheck, lint, and diff check pass; index is empty. Stop without committing.

---

### Task 5: Install the approved pin and choreograph arrival

**Files:**
- Create: `public/models/research-location-pin.glb`
- Modify: `public/models/ATTRIBUTION.md`
- Modify: `src/experience/lab/globe-scene-objects.ts`
- Modify: `src/experience/lab/globe-route-scene.ts`
- Modify: `src/experience/lab/ResearchGlobeCanvas.tsx`
- Modify: `tests/experience/globe-scene-objects.test.ts`
- Modify: `tests/experience/globe-route-scene.test.ts`
- Modify: focused canvas/integration tests only where the public completion contract is observed

**Verified source:**
- Model: `Location Pin`
- Author: `elbastosoyyo`
- Page: `https://sketchfab.com/3d-models/location-pin-728fced8df934479bf9a46bc892e4780`
- Official metadata API: `https://api.sketchfab.com/v3/models/728fced8df934479bf9a46bc892e4780`
- License: Creative Commons Attribution 4.0
- Published metadata: 6,192 faces, 3,098 vertices, zero textures, one material, downloadable
- Runtime URL after verified offline normalization: `/models/research-location-pin.glb`

- [ ] **Step 1: Obtain, verify, and normalize the actual asset outside runtime**

Use Sketchfab's authenticated download flow; do not scrape viewer resources or bypass the official
download endpoint. Record the downloaded archive hash, source format, contained files, mesh names,
material slots, triangle/vertex counts, and license metadata. Reject any file whose identity or
license does not match the verified API response.

Inspect connected components and existing mesh/material boundaries. Produce one local GLB whose
scene contains `pin_head` and `pin_stem`. If the source is one mesh, split it once offline by
connected components. Normalize scale and orientation and translate the scene so the bottom tip is
the root pivot. Remove source cameras/lights and unused materials. Add the exact conversion and
hashes to `public/models/ATTRIBUTION.md`. Runtime must make no network request.

- [ ] **Step 2: Write and run failing marker contract tests**

Before implementation, change focused tests to require a marker template with named `pin_head` and
`pin_stem`, independently owned standard materials, a graphite stem unaffected by status, an
emissive status head, pending-only spinner/halo, reveal scale, and idempotent disposal. Add a test
that a stable `5–15°` lean rotates around the bottom pivot without translating it.

Run the focused tests and verify that they fail because the current procedural marker and API do
not satisfy the contracts.

- [ ] **Step 3: Replace procedural marker geometry with the local model**

Load `/models/research-location-pin.glb` once beside the airliner loader and pass the normalized
template into the route-scene factory. Clone the two mesh parts per marker, replace their materials
with the specified status-head and graphite-stem `MeshStandardMaterial`s, and retain only the small
procedural halo/spinner effects. Remove the procedural cylinder/sphere marker body completely.

Expose only the narrow handle behavior needed by the scene: `setRevealProgress`, `setStatus`,
`setSpinnerAngle`, and `dispose`. The marker root stays at the arrival anchor; a child tilt group
applies a deterministic run/route-key lean with a `5–15°` magnitude around that bottom pivot.

- [ ] **Step 4: Write and run failing arrival-sequence tests**

Add focused tests for the observable phase contract:

```text
flying: trail ends behind the tail by a small constant world-space distance;
landed/settling: aircraft stays at destination while the line advances into the submerged anchor;
revealing: completed line stays fixed while marker scale advances 0 → 1;
complete: only now may onFlightComplete fire;
restart/unmount: every outstanding frame is cancelled and stale callbacks never fire;
reduced motion: completed line and scale-1 marker are installed synchronously before completion.
```

Run these tests and verify RED against the current immediate flight completion behavior.

- [ ] **Step 5: Implement one cancellable arrival animation**

Keep one small animation coordinator in the lab canvas/route scene. During flight, derive the trail
endpoint by moving a constant scene distance backward along the sampled route tangent, rather than
using a route-length-dependent fixed progress gap. After flight progress reaches `1`, keep the
aircraft landed, animate the trail endpoint to the submerged destination over `250 ms`, then reveal
the pin with an eased `0 → 1` scale over `350 ms`. Call `onFlightComplete` only after reveal.

The pin is present but scale-zero before its reveal, so the spinner cannot appear early. Status
changes interpolate only `pin_head` color/emissive; `pin_stem` stays graphite. Reduced motion sets
the completed trail and revealed pin synchronously and then calls completion without requesting a
frame. A returned cancellation function owns all flight/settle/reveal callbacks.

- [ ] **Step 6: Fix the two deferred trail details**

Allocate the shared trail position source as exactly `(TRAIL_SEGMENT_CAPACITY + 1) * 3` float
positions (64 segments / 65 vertices) before `LineGeometry` converts it to its interleaved segment
buffer. Set `depthWrite: false` on both transparent `LineMaterial`s. Preserve the existing fixed
buffer identity and disposal behavior.

- [ ] **Step 7: Run focused and nonvisual verification**

Run focused scene/route/canvas tests, all `tests/experience`, relevant integration tests,
typecheck, lint, asset metadata/hash checks, `git diff --check`, and
`git diff --cached --name-only`. Expected: all checks pass, the production data flow has no diff,
and the index remains empty. Do not commit.

---

### Task 6: Final parity and live visual/performance review

**Files:**
- Verify only: all files from Tasks 1–5
- Update reports only if measured values differ from planned estimates.

- [ ] **Step 1: Run the full nonvisual gate from a clean dev-process state**

Run all `tests/experience`, relevant integration tests, typecheck, lint, asset metadata checks,
artifact scan, and `git diff --check`. Confirm production DB/LLM/source files have no new diff from
this increment and nothing is staged.

- [ ] **Step 2: Request fresh browser permission**

Before using the in-app browser, tell the user exactly that the lab route, WebGL console, texture
timings, and one full random run will be inspected; wait for explicit permission.

- [ ] **Step 3: Perform the live contract review**

At `http://127.0.0.1:3000/lab/research-map`, verify:

```text
terrain silhouette and normal-map slope lighting are visible;
physical light and day/night terminator point in the same direction;
camera moves once, auto-rotation stays off, and zoom remains tightly bounded;
all flights start in Russia and the camera does not jump between candidates;
the active trail keeps a visible gap behind the airliner;
landing completes before the line settles into the globe, and the marker grows only afterward;
both completed route ends disappear into the globe beneath their pins;
the approved local pin replaces procedural marker bodies, keeps its tip pivot fixed while leaning
5–15°, recolors only its head, and stops the pending spinner on completion;
airliner scale, forward direction, banking, and terrain clearance look correct;
restart clears prior trails/pins and launches a fresh 1–5 city run;
console has no shader, WebGL, disposal, or asset errors.
```

Measure normal-map transfer bytes, realistic-material ready time, average/minimum sampled FPS for a
full run, and the new `111_848_107`-byte texture estimate. Leave the page open for user review.

- [ ] **Step 4: Stop for visual approval**

Do not stage or commit. Give the direct lab URL and report measurements plus any visible compromise.
Only after explicit visual approval should lab-only controls be removed, production parity checked,
and a first commit proposed.

---

### Task 7: Fix lifecycle regressions and add interactive marker details

**Files:**
- Modify: `src/experience/lab/research-map-scenario.ts`
- Modify: `src/experience/lab/ResearchMapLab.tsx`
- Modify: `src/experience/lab/ResearchMapLab.module.css`
- Modify: `src/experience/lab/ResearchGlobeCanvas.tsx`
- Modify: `src/experience/lab/globe-route-scene.ts`
- Modify: `src/experience/lab/globe-scene-objects.ts`
- Modify: `tests/experience/research-map-lab.test.tsx`
- Modify: `tests/experience/globe-route-scene.test.ts`
- Modify: `tests/experience/globe-scene-objects.test.ts`
- Create only after source verification: compressed local lab city photos and adjacent attribution

**Interfaces:**
- `GlobeRoute` gains lab display metadata: `country`, `city`, `description`, optional
  `rejectionReason`, and optional `photoUrl`.
- Custom-layer data identifies `kind: "pin" | "trail" | "aircraft"` and route key so only pins
  respond to `onCustomLayerClick`.
- HTML label data is derived only from revealed pins and uses `htmlElementsData`/`htmlElement`.

- [x] **Step 1: Capture the runtime error before modifying ownership**

After explicit browser permission, run the first random scenario and restart once. Record the full
console exception/stack and the exact phase in which a marker disappears. Correlate it with asset
template disposal, route-scene reconciliation, and frame cancellation; do not patch from the
screenshot alone.

- [x] **Step 2: Write failing regression and visual-contract tests**

Add the smallest tests that reproduce the discovered lifecycle failure and require: no lab toast
list, labels only for revealed pins, pin-only click selection, detail content per status, no
early trail segment, a tail-sized gap, peak altitude `0.1`, full 3D aircraft tangent orientation,
15% larger pins, and the brighter neutral stem. Run the focused files and verify RED for each new
contract before implementation.

- [x] **Step 3: Fix lifecycle ownership at the proven source**

Change only the owner that disposes or reuses the stale object identified by the stack/reproduction.
Keep one template owner, one route-scene owner, and one cancellable journey per active route. Do not
add retries, duplicate models, a second renderer, or error-swallowing guards.

- [x] **Step 4: Remove lab toasts and add native marker interaction**

Suppress the shared candidate-summary list through an explicit stage option used only by
`ResearchMapLab`; preserve its production default. Enable globe pointer interaction and handle
`onCustomLayerClick` only when datum kind is `pin`. Render one accessible HTML detail card with a
close button and the status-specific content from the route fixture.

- [x] **Step 5: Add camera-facing city balloons**

Derive `htmlElementsData` from revealed route-scene pins. Create a white DOM balloon containing
only the city name, use the pin coordinate and a small altitude offset, and let CSS2DRenderer keep
it screen-facing. Dispose/remove generated elements when routes disappear or the canvas unmounts.

- [x] **Step 6: Correct plane, trail, arc, and pin appearance**

Set route peak altitude to `0.1`; calculate orientation from the unprojected next 3D path position
so climb/descent pitch is preserved. Set the trail gap to aircraft half-length plus a visible tail
clearance and return no drawable segment until that distance exists. Increase marker scale 15% and
brighten only the neutral graphite stem.

- [x] **Step 7: Add verified local green-result photos**

Use one appropriately licensed photo for each of the eight fixed lab cities, store compressed local
files, and record creator, source page, license, filename, and modifications. Do not load images
from a remote host at runtime.

- [x] **Step 8: Run the complete nonvisual gate**

Run focused RED/GREEN tests, all `tests/experience`, the full test suite, typecheck, lint, build,
asset/hash checks, `git diff --check`, and `git diff --cached --name-only`. Restore any automatic
Next.js config rewrite. Do not stage or commit.

- [ ] **Step 9: Request fresh browser permission for visual verification**

Verify the original first-run failure is gone, console stays clean, labels face the observer,
only pins are clickable, cards match every status, photos load locally, arcs stay close to Earth,
the plane pitches with the path, and the trail remains visibly detached from its tail. Leave
`http://127.0.0.1:3000/lab/research-map` open for user review and stop without committing.

---

### Task 8: Replace night master and remove the remaining interaction/route defects

**Files:**
- Replace: `public/textures/earth-night-4k.jpg`
- Create: `public/textures/ATTRIBUTION.md`
- Modify: `src/experience/lab/realistic-earth-material.ts`
- Modify: `src/experience/lab/ResearchGlobeCanvas.tsx`
- Modify: `src/experience/lab/ResearchMapLab.module.css`
- Modify: `src/experience/lab/globe-route-scene.ts`
- Modify: `src/experience/lab/globe-scene-objects.ts`
- Modify: `tests/experience/realistic-earth-material.test.ts`
- Modify: `tests/experience/research-map-lab.test.tsx`
- Modify: `tests/experience/globe-route-scene.test.ts`
- Modify: `tests/experience/globe-scene-objects.test.ts`

**Interfaces:**
- Keep `NIGHT_TEXTURE_URL` equal to `/textures/earth-night-4k.jpg` and the decoded image dimensions
  equal to `4096 × 2048`.
- Replace `PinLean` and `markerLean` with upright pin construction; `createGlowingPin(template,
  status)` accepts no orientation options.
- Add a route-tail state containing monotonically ordered points plus its scalar `tailProgress`;
  trail settle consumes that scalar rather than an arbitrary world-space endpoint.
- City-label DOM elements select the same `GlobeRoute.key` used by custom-layer pin clicks.

- [x] **Step 1: Acquire and validate the official NASA master in temporary storage**

Download the official NASA Earth Observatory Black Marble 2016 JPEG to `/private/tmp`, validate
that it decodes as exactly `13,500 × 6,750`, and calculate SHA-256. Reject redirects or content that
does not match those dimensions. Do not overwrite the repository texture yet.

- [x] **Step 2: Compare old and candidate texture sharpness before replacement**

Using the bundled Pillow runtime, create an in-memory `4096 × 2048` Lanczos candidate and compute
variance of Laplacian plus mean Sobel/edge energy for the existing texture and candidate at the same
size and luminance representation. Record both values, input/output dimensions, and file hashes in
`public/textures/ATTRIBUTION.md` with the NASA title, official source page, direct asset URL, and
NASA public-use attribution.

- [x] **Step 3: Encode and install the replacement texture**

Write a temporary output with Pillow `Image.Resampling.LANCZOS`, `quality=93`, `subsampling=0`,
`optimize=True`, and RGB/sRGB-compatible pixels. Validate its dimensions and JPEG sampling factors,
then replace only `public/textures/earth-night-4k.jpg`. Keep the runtime URL and material texture
count unchanged.

- [x] **Step 4: Write and verify RED tests for shader and interaction changes**

Change focused tests to require the night multiplier `1.45`, a semantic city-label button that
opens the same route detail card through pointer and keyboard activation, and no marker-lean API or
tilt transform. Run the three focused files and confirm each assertion fails for the missing
behavior rather than test setup.

- [x] **Step 5: Write and verify RED tests for monotonic trail progress**

Add route tests whose projector exposes route progress, then require every active and settling
sample to be nondecreasing, never exceed `tailProgress`, preserve the configured tail gap, and
finish at progress `1`. Include the screenshot regression shape where a coarse sample previously
advanced beyond the appended tail endpoint. Run the route tests and confirm RED.

- [x] **Step 6: Implement the shader, balloon, and upright-pin changes**

Change only the existing shader multiplier. Return a `<button type="button">` from the HTML-layer
factory, attach route selection to click activation, stop pointer propagation, and enable pointer
events in its existing CSS class. Remove `PinLean`, `markerLean`, and `pin_tilt`; attach the reveal
group directly to the upright marker root while retaining the bottom pivot and cleanup ownership.

- [x] **Step 7: Implement one monotonic tail-progress solver**

Use a fixed-iteration binary search over `[0, aircraftProgress]` to locate the last route point at
the required world-space distance behind the aircraft. Sample only `[0, tailProgress]`. Store the
landing `tailProgress`; settle by interpolating it to `1` and resampling through that value. Keep
the pre-gap one-point state, custom Three.js layer, fixed buffers, cancellation, and reduced-motion
contracts unchanged.

- [x] **Step 8: Run GREEN and the complete nonvisual gate**

Run all focused tests, the complete suite on Node 24, typecheck, lint, production build, texture
dimension/sampling/hash checks, `git diff --check`, and `git diff --cached --name-only`. Restore any
automatic Next.js TypeScript config rewrite. Confirm no runtime source references NASA remotely and
nothing is staged or committed.

- [x] **Step 9: Request fresh permission and perform live visual verification**

Ask before opening the in-app browser. At
`http://127.0.0.1:3000/lab/research-map`, inspect the night side at close zoom, compare separated
city-light detail, activate balloons and pins, run/restart a multi-city scenario, confirm upright
markers and a kink-free detached trail, and inspect console/runtime errors. Leave the lab open for
the user's review and do not commit.

---

### Task 9: Replace pins with status balloons and keep trails grounded

**Files:**
- Modify: `src/experience/lab/research-map-scenario.ts`
- Modify: `src/experience/lab/globe-journey.ts`
- Modify: `src/experience/lab/globe-route-scene.ts`
- Modify: `src/experience/lab/globe-scene-objects.ts`
- Modify: `src/experience/lab/ResearchGlobeCanvas.tsx`
- Modify: `src/experience/lab/ResearchMapLab.module.css`
- Modify: `tests/experience/research-map-scenario.test.ts`
- Modify: `tests/experience/globe-journey.test.ts`
- Modify: `tests/experience/globe-route-scene.test.ts`
- Modify: `tests/experience/globe-scene-objects.test.ts`
- Modify: `tests/experience/research-map-lab.test.tsx`

**Interfaces:**
- `LabResearchCity.flag: string` stores the explicit Unicode flag used by both destination UI
  surfaces.
- `GlobeRoute.flag?: string` transports that fixture value without country-name inference.
- `startGlobeJourney` replaces marker progress with `onLanding(): void` and
  `onDestinationReveal(): void`; its order is flight → landing → trail settle → destination reveal
  → completion.
- `createGlobeRouteScene()` accepts no pin template and produces only `kind: "trail"` data.
- `activeRouteTrailPoints` and `settlingRouteTrailPoints` always sample `routeAltitude`; settle only
  increases end progress.

- [x] **Step 1: Write RED journey and grounded-route tests**

Update the journey fixture to require this literal event order:

```ts
expect(events).toEqual(["flight:1", "landing", "settle:1", "destination", "complete"]);
```

Add route assertions that active and settling points use the same hand-derived final altitude at a
shared route progress, that settling never changes an existing point's radius, and that the peak is
approximately one third below the previous `0.096` completed-route midpoint.

- [x] **Step 2: Run the journey and route tests and verify RED**

Run:

```bash
pnpm exec vitest run tests/experience/globe-journey.test.ts tests/experience/globe-route-scene.test.ts
```

Expected: FAIL because `onLanding`/`onDestinationReveal` do not exist and the active trail still
uses `planeAltitude` before vertically settling.

- [x] **Step 3: Implement the minimal journey and trail correction**

Call `onLanding()` synchronously from the flight completion callback, settle the route, then call
`onDestinationReveal()` and `onComplete()` without a marker-reveal timer. Set the shared peak to
`0.067`. Generate active and settling trail samples with `routeAltitude`; preserve the binary-searched
tail gap and interpolate only `tailProgress → 1`. In `ResearchGlobeCanvas`, hide the aircraft in
`onLanding` rather than waiting for a later reveal frame.

- [x] **Step 4: Run the journey and route tests and verify GREEN**

Run the Step 2 command. Expected: both files pass with no warnings.

- [x] **Step 5: Write RED pinless-scene, flag, and balloon tests**

Require every generated fixture to have the literal country flag for its city. Update the route
scene test to call `createGlobeRouteScene()` without a model and assert that every returned datum has
`kind === "trail"`. Update the canvas-facing lab test to require buttons containing flag + city,
status classes/attributes for pending/green/yellow/red, and `aria-pressed="true"` after selection.
Delete pin-material/spinner expectations from the scene-object tests and require neutral trail
materials to be transparent with `depthWrite === false`.

- [x] **Step 6: Run the focused UI/scene tests and verify RED**

Run:

```bash
pnpm exec vitest run tests/experience/research-map-scenario.test.ts tests/experience/globe-scene-objects.test.ts tests/experience/globe-route-scene.test.ts tests/experience/research-map-lab.test.tsx
```

Expected: FAIL because fixtures have no flags, scene reconciliation still returns pins, and balloons
do not expose status or selection state.

- [x] **Step 7: Remove runtime pins and implement the balloon state UI**

Remove `createGlowingPin`, pin handles, spinner animation, pin-template GLTF loading, marker reveal
state, `onCustomLayerClick`, and pin custom-layer data. Keep the airliner GLB path unchanged. Add
explicit flags to all eight lab fixtures and pass `flag` into each `GlobeRoute`. Reveal route keys in
`onDestinationReveal`, place HTML elements at the terrain-adjacent destination altitude, and render
buttons as:

```html
<button aria-pressed="true|false"><span aria-hidden="true">🇦🇱</span><span>Тирана</span></button>
```

Apply status and selected classes from datum fields. Use one neutral gray for every trail and lower
core/halo opacity; do not retain status recoloring.

- [x] **Step 8: Add selection camera and detail-card polish**

On `selectedRoute` change, call `pointOfView({ lat, lng, altitude: 1.1 }, reducedMotion ? 0 : 650)`.
Show the same flag next to the detail-card country. Add one `350 ms` opacity/translate/scale keyframe,
a selected-balloon border/shadow/scale state, four text-color states, and a
`prefers-reduced-motion: reduce` override that disables the card animation.

- [x] **Step 9: Run focused tests and the nonvisual gate**

Run the Step 6 command, then the complete Node 24 test suite, typecheck, lint, production build,
`git diff --check`, and `git diff --cached --name-only`. Confirm the runtime source no longer
references `research-location-pin.glb`, `createGlowingPin`, `pin_head`, or `pin_stem`. Do not stage,
commit, or change production data flow.

- [ ] **Step 10: Request browser permission and perform visual review**

After explicit permission, open `http://127.0.0.1:3000/lab/research-map`; capture active flight and
arrival, verify immediate aircraft removal, grounded low gray routes, balloon anchors/colors/flags,
selected emphasis, camera centering, card entrance, restart cleanup, reduced-motion semantics, and a
clean runtime console. Leave the laboratory open for user review.

---

### Task 10: Unify aircraft/trail geometry and add a random origin

**Files:**
- Modify: `src/experience/lab/globe-route-scene.ts`
- Modify: `src/experience/lab/globe-scene-objects.ts`
- Modify: `src/experience/lab/research-map-scenario.ts`
- Modify: `src/experience/lab/ResearchMapLab.tsx`
- Modify: `src/experience/lab/ResearchGlobeCanvas.tsx`
- Modify: `src/experience/lab/ResearchMapLab.module.css`
- Modify: `tests/experience/globe-route-scene.test.ts`
- Modify: `tests/experience/globe-scene-objects.test.ts`
- Modify: `tests/experience/research-map-scenario.test.ts`
- Modify: `tests/experience/research-map-lab.test.tsx`

**Interfaces:**
- `journeyAltitude(progress: number): number` is the sole altitude function consumed by aircraft
  positioning, gap solving, active trail sampling, arrival extension, and completed routes.
- `createGlobeTrail()` owns one `Line2` named `core` with opacity `0.55` and no halo child.
- `LabResearchOrigin` contains `city`, `country`, `flag`, and `geo`;
  `createResearchOrigin(random?: () => number): LabResearchOrigin` selects one immutable copy.
- `ResearchGlobeCanvasProps.origin?: GlobeOrigin` supplies the non-interactive starting balloon.
- The aircraft clone owns its materials; opacity is updated during the last `500 / 1_050` fraction
  of flight and `removeFromParent()` is called by `onLanding`.

- [x] **Step 1: Write RED unified-curve and single-line tests**

Change route expectations to require literal shared samples: start/end altitude `0.035`, midpoint
altitude `0.08`, `planeAltitude(progress) === completedRouteTrailPoints(...)[sample].z`, and
`TRAIL_GAP_DISTANCE === 3.8`. Require active and settling prefix points to retain the same altitude
and coordinates. Change scene-object tests to require exactly one `core` child, opacity `0.55`,
`transparent === true`, `depthWrite === false`, and no `halo` child.

- [x] **Step 2: Run the route/scene tests and verify RED**

```bash
pnpm exec vitest run tests/experience/globe-route-scene.test.ts tests/experience/globe-scene-objects.test.ts
```

Expected: FAIL because aircraft and route still use separate altitude functions, gap is `7`, and
the trail still creates halo plus core.

- [x] **Step 3: Implement one journey curve and one trail object**

Replace `planeAltitude`/`routeAltitude` internals with one exported `journeyAltitude` using clearance
`0.035` plus `Math.sin(Math.PI * progress) * 0.045`; retain `planeAltitude` only as a compatibility
alias if existing consumers need it. Use the shared curve in every projector call and binary-search
candidate. Set gap `3.8`. Remove halo creation/disposal/resolution work; retain the fixed-capacity
core geometry and normal depth testing.

- [x] **Step 4: Run the route/scene tests and verify GREEN**

Run the Step 2 command. Expected: both files pass without warnings.

- [x] **Step 5: Write RED origin and anchored-balloon tests**

Require deterministic origin selection and defensive coordinate copying. In lab tests inject one
origin and assert: all candidate labels/from-coordinates use it, overview begins with it, HTML data
contains one origin datum from run start, the origin renders as a non-interactive `DIV` with flag
and city, and destination markers remain buttons. Require the selected balloon class without a
scale transform contract.

- [x] **Step 6: Run scenario/lab tests and verify RED**

```bash
pnpm exec vitest run tests/experience/research-map-scenario.test.ts tests/experience/research-map-lab.test.tsx
```

Expected: FAIL because no origin generator/prop/datum exists and balloon CSS still transitions and
scales `transform`.

- [x] **Step 7: Implement one origin per run and remove positional easing**

Add five Russian origin fixtures and `createResearchOrigin`. Add `createOrigin` injection to
`ResearchMapLab`, store the selected origin in running/complete playback state, and derive candidate
origin names, route coordinates, flight labels, and overview from it. Pass a `GlobeOrigin` to the
canvas. Add one non-interactive origin label datum with `🇷🇺`, green/black status styling, and the
same balloon shell. Remove `transform` from transitions and remove selected scaling; keep only
border/background/shadow emphasis.

- [x] **Step 8: Write and verify RED aircraft-fade/removal test**

Drive the real canvas journey with controlled RAF timestamps `0`, `550`, `800`, and `1_050`. Attach
the aircraft object to a test `Group`. Assert opacity `1` at 550 ms, approximately `0.5` at 800 ms,
`0` at landing, transparent material with `depthWrite === false`, and `parent === null` before the
first settle frame. Run only that test and confirm it fails because opacity is not updated.

- [x] **Step 9: Implement last-500-ms fade and scene removal**

Traverse cloned aircraft meshes on flight progress. Before the fade window keep opacity `1`; within
it set owned materials transparent, `depthWrite = false`, and interpolate to `0`. In `onLanding`,
force opacity `0` and call `flightPlane.removeFromParent()` instead of only toggling visibility.
Keep the journey effect alive so settle and destination reveal still complete.

- [x] **Step 10: Run focused tests and complete nonvisual gate**

Run the four focused files, all tests with Node 24 and one worker, typecheck, lint, production build,
`git diff --check`, empty staged-diff check, and runtime searches for removed halo/pin paths. Restore
automatic Next.js config rewrites. Do not stage or commit.

- [ ] **Step 11: Request permission for live review**

After fresh explicit permission, inspect one complete run and manually rotate the globe. Verify one
continuous line directly behind the aircraft, no terrain-induced gaps, fixed balloons, one inert
origin marker, 500 ms fade/removal, restart cleanup, and a clean runtime console. Leave the page
open for the user's visual decision.

---

### Task 11: Continuous route and exact HTML anchors

**Files:**
- Modify: `src/experience/lab/globe-scene-objects.ts`
- Modify: `src/experience/lab/ResearchGlobeCanvas.tsx`
- Modify: `src/experience/lab/ResearchMapLab.module.css`
- Modify: `tests/experience/globe-scene-objects.test.ts`
- Modify: `tests/experience/research-map-lab.test.tsx`

**Interfaces:**
- `createGlobeTrail()` keeps its public handle but owns one Three.js `Line` with a fixed
  `BufferGeometry` position attribute and an updated draw range.
- `createCityBalloon(datum)` returns a zero-size anchor `DIV`; its first child is the existing
  destination `BUTTON` or non-interactive origin `DIV`.
- Aircraft opacity fades over the last `200 / 1,050` fraction of flight.

- [x] **Step 1: Write and verify RED native-line tests**

Require one `Line`, a `65 * 3` fixed position buffer, literal ordered vertices, draw count equal to
the supplied point count, opacity `0.8`, `transparent === true`, `depthWrite === false`, and
single disposal. Run `tests/experience/globe-scene-objects.test.ts`; expect failure because the
implementation still owns `Line2` segment geometry.

- [x] **Step 2: Implement and verify the continuous native line**

Replace `Line2`/`LineGeometry`/`LineMaterial` with `Line`/`BufferGeometry`/`LineBasicMaterial`.
Update the fixed position attribute in place, set its update range and draw range, and retain
normal depth testing. Run route-scene and scene-object tests; both must pass.

- [x] **Step 3: Write and verify RED anchor-wrapper and 200 ms fade tests**

Require HTML data to create a zero-size anchor wrapper whose child preserves current origin and
destination semantics. Drive RAF at `0`, `850`, `950`, and `1,050` ms and require opacities `1`,
`0.5`, and `0`, followed by scene removal. Run the canvas test and confirm the old direct balloon
element and 500 ms fade fail.

- [x] **Step 4: Implement exact pointer anchors and short fade**

Create wrapper plus visible child markup, move balloon positioning into child CSS, keep interaction
on destination children only, and set the aircraft fade duration to `200`. Do not change camera
zoom limits or route geometry.

- [x] **Step 5: Complete the nonvisual gate**

Run the focused tests, all tests with Node 24 and one worker, typecheck, lint, production build,
`git diff --check`, and the empty staged-diff check. Restore any automatic Next.js config rewrites.
Do not stage or commit.

- [ ] **Step 6: Request fresh browser permission**

After explicit permission, inspect the route at close zoom, both route endpoints, origin/destination
interaction, the final 200 ms fade, restart cleanup, and console. Leave the lab open for review.

---

### Task 12: Submerge only route endpoints

**Files:**
- Modify: `src/experience/lab/globe-route-scene.ts`
- Modify: `src/experience/lab/ResearchGlobeCanvas.tsx`
- Modify: `tests/experience/globe-route-scene.test.ts`
- Modify: `tests/experience/research-map-lab.test.tsx`

**Interfaces:**
- `journeyAltitude(progress)` remains the aircraft curve.
- Internal `trailAltitude(progress)` blends from `-0.004` to `journeyAltitude` over `1/16` at both
  route ends and equals `journeyAltitude` everywhere else.
- HTML route labels use altitude `0`.

- [x] **Step 1: Write and verify RED terminal-ramp tests**

Require completed samples `0` and `64` at `-0.004`, sample `4` at the aircraft curve, midpoint at
the aircraft curve, and final settling endpoint at `-0.004`. Require previously drawn settling
prefix coordinates to remain identical. Run the route-scene tests and confirm failure against the
current all-airborne line.

- [x] **Step 2: Implement the endpoint altitude blend**

Add one smoothstep terminal weight and use `trailAltitude` for completed, active, gap-search, and
settling samples. Do not change `journeyAltitude`, tail gap, or progress interpolation.

- [x] **Step 3: Write and verify RED surface-anchor test**

Require every origin/destination HTML datum altitude to equal `0`. Run the canvas test and confirm
failure against the current `0.035` anchor shell.

- [x] **Step 4: Move HTML anchors to the nominal surface**

Set the shared city-label altitude to `0`; do not change wrapper markup, selection, or card behavior.

- [x] **Step 5: Run the complete nonvisual gate**

Run focused tests, all tests with Node 24 and one worker, typecheck, lint, production build,
`git diff --check`, and the empty staged-diff check. Restore automatic Next.js config rewrites and
do not stage or commit.

---

### Task 13: Replace terminal ramps with one surface curve

**Files:**
- Modify: `src/experience/lab/globe-route-scene.ts`
- Modify: `src/experience/lab/globe-scene-objects.ts`
- Modify: `tests/experience/globe-route-scene.test.ts`
- Modify: `tests/experience/globe-scene-objects.test.ts`

**Interfaces:**
- `journeyAltitude(progress)` returns `Math.sin(Math.PI * progress) * 0.08`.
- `planeAltitude` remains a compatibility alias for that function.
- Every route generator calls `journeyAltitude`; `TRAIL_SEGMENTS` is `128` and trail capacity is
  `128`, producing a fixed `129 * 3` position buffer.

- [x] **Step 1: Write and verify RED single-curve tests**

Require aircraft and route altitude `0` at progress `0`/`1`, altitude `0.08` at midpoint, exactly
`129` completed samples, active origin altitude `0`, and settling endpoint altitude `0`. Run the
route-scene test and confirm failure against the terminal-ramp implementation.

- [x] **Step 2: Implement the single 128-segment curve**

Delete submerged/ramp constants and `trailAltitude`. Change `journeyAltitude` to the surface sine
profile, set route segments to `128`, and use that function in every route projector and gap search.

- [x] **Step 3: Expand and verify the fixed native-line buffer**

Update the fixed native-line capacity and tests to `129 * 3`, with completed draw count `129`.
Run scene-object and route-scene tests and verify both pass.

- [x] **Step 4: Run the complete nonvisual gate**

Run all tests with Node 24 and one worker, typecheck, lint, production build, `git diff --check`, and
the empty staged-diff check. Restore automatic Next.js config rewrites. Do not stage or commit.
