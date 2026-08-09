# Design: production research globe

Date: 2026-08-09
Branch: `design/research-map-lab`

## Goal

Replace the product's flat SVG research map and collapsed result with the visually approved
`react-globe.gl` experience. The globe is mandatory: the product may show loading or a recoverable
error, but it never substitutes the old map or another renderer.

The production data flow, assessment rules, database, LLM orchestration, and evidence pipeline do
not change in this work.

## Selected architecture

Move the approved renderer and its focused helpers from `src/experience/lab` to
`src/experience/research-map`. `ResearchMap` remains the product-facing component and converts its
typed product candidate into `GlobeRoute` data. It owns mandatory loading/error/retry UI; the canvas
owns only Three.js rendering and lifecycle.

There is exactly one globe implementation. Production must not import from `lab`, and the approved
renderer must not be copied into `ResearchMap.tsx`.

## Product states

### Origin and route metadata

- Until the profile model contains a city, the production origin is fixed as `🇷🇺 Москва`,
  `{ lat: 55.7558, lng: 37.6173 }`.
- The current VS-1 candidate is `🇦🇱 Тирана`, `{ lat: 41.3275, lng: 19.8187 }`, country `Албания`.
- `ResearchCandidate` gains required geographic and presentation metadata instead of relying on
  percentage coordinates or destination-name lookup inside the renderer.
- The existing assessment status and verified rejection reason remain the authority for
  pending/green/yellow/red and detail-card content.

### Pending

- The globe occupies `100svh` and starts Москва → Тирана once its required assets are ready.
- The route is drawn behind the aircraft. After landing, the pending destination balloon appears.
- If the server-side research is still running, the gray pending balloon remains until the product
  candidate status changes.

### Terminal result

- Green, yellow, and red all keep the full globe visible. The former collapsed green card is
  removed.
- An initially terminal page renders the completed route and terminal balloon immediately without
  replaying the flight.
- Balloon selection, camera centering, country flag, local city image, rejection summary, and
  status copy remain identical to the approved experiment.
- The existing yellow retry workflow stays as product HTML UI associated with the globe. It is not
  a visual fallback and does not create a second map.

## Mandatory loading and failure behavior

- `ResearchMap` dynamically loads the client-only renderer with SSR disabled.
- A fullscreen product loader covers the stage until WebGL initialization, the realistic Earth
  material, and the local aircraft GLB are all ready.
- WebGL unsupported, renderer initialization, context loss, dynamic-import failure, Earth asset
  failure, and aircraft failure all enter one fullscreen error state with a `Повторить` action.
- Retry remounts recoverable renderer/asset failures. A failed dynamic chunk reloads the page so
  the browser performs a new chunk request.
- No error path renders `world-map.svg`, coordinate pins, CSS aircraft, a stylized Earth material,
  a flat canvas, or an alternate globe implementation.
- Automatic quality reduction is intentionally deferred. The production renderer initially uses
  the approved quality; a later task may select lower texture/geometry quality without changing the
  screen contract.

## Module and asset migration

Move to `src/experience/research-map`:

- `ResearchGlobeCanvas.tsx` → `ResearchGlobeCanvas.tsx`
- `ResearchMapLab.module.css` visual rules → `ResearchGlobe.module.css`
- `globe-flight.ts`
- `globe-journey.ts`
- `globe-route-scene.ts`
- `globe-scene-objects.ts`
- `realistic-earth-material.ts`
- `research-globe-lifecycle.ts`

Remove product-obsolete code and assets:

- the fallback branch and `visual` slot in `ResearchMapStage`;
- `ResearchMapStage` itself once `ResearchMap` owns the globe;
- `MapPoint`, `ResearchFlight`, percentage positioning, SVG pins, CSS flight, marker rails, and
  collapsed green markup;
- `public/world-map.svg` and its unused CSS;
- `/lab/research-map`, `ResearchMapLab`, its random origin/city scenario, timers, toolbar, and their
  focused controller tests;
- unused synthetic city photographs.

Keep the production Tirana image locally under `public/cities/tirana.jpg` with its attribution.
Textures and GLB files remain local and keep their existing provenance documents.

## Laboratory remains a product capability

Deleting `/lab/research-map` does not delete the laboratory concept. Add a minimal `/lab` catalog
route that is independent of production flows and contains no globe copy. Future design
experiments receive their own child routes and may import production components explicitly.

The laboratory catalog is not linked from the user journey and does not load DB, LLM, or source
pipeline dependencies.

## Accessibility and reduced motion

- Loader uses an announced status; error copy uses an alert and exposes a real button.
- Destination balloons remain keyboard-operable semantic buttons; the Moscow origin remains inert.
- Detail card semantics and close control remain unchanged.
- Reduced motion immediately renders the completed route and destination reveal while preserving
  status state and cleanup.

## Verification contracts

Automated tests cover:

1. Product `ResearchMap` always requests the globe for pending and terminal states.
2. Pending supplies one active flight; initial terminal state supplies no active flight and one
   completed route.
3. Москва and Тирана metadata reach the canvas without lab randomness.
4. Loading stays visible until renderer and mandatory assets report ready.
5. Every failure class shows error/retry and never renders old map markup.
6. Yellow retry behavior and previous/new snapshot reporting still work.
7. Dynamic restart, stale animation cancellation, unmount cleanup, context loss, and reduced motion
   retain their existing contracts.
8. Runtime source and public assets contain no `world-map.svg`, flat-map pins, CSS aircraft, lab
   globe page, synthetic generator, or collapsed green branch.

After the nonvisual gate, request fresh browser permission and run the real product pending and
terminal flows. Compare the product globe with the approved lab behavior at the same viewport,
inspect loading/error UI and console, then commit only if parity holds.

## Commit boundary

The visual approval authorizes productionization, but the first commit remains after migration,
cleanup, automated checks, and browser parity review. Do not stage intermediate lab controls or
fallback code.
