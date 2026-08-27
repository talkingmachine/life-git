# Task 6 report — persistent planet history and terminal country cards

## Status

DONE. Implemented the VS-3 country-frontier setup, strict client response boundary,
generation-safe live/stored/interrupted journey, terminal cards, explicit frontier research scope,
Evidence/manual-navigation lineage, red/yellow-only globe disclosure, clone-safe selection
invalidation, run-only reload routing, and narrow collapsed-mode CSS.

## TDD evidence

### Cluster 1 — setup, response opener, URL, page boundary

- RED command: `./node_modules/.bin/vitest run tests/integration/place-frontier-experience.test.tsx`
- RED result: failed suite, 0 tests, because `PlaceFrontierStart` did not exist. This was the expected
  missing-feature failure before production edits.
- First GREEN attempt: 8/10 tests passed. Two test-harness assumptions failed: Fetch `Headers`
  normalized leading whitespace before the opener could observe it, and jest-dom's `toBeChecked`
  matcher was not installed. The exact-trim assertion was changed to use a minimal Response-shaped
  object, and checkbox state used the native `checked` property.
- TypeScript then identified a missing projected shortlist/ranking snapshot ID. The authorized
  Task 5 view-model cascade now projects that existing ID without client derivation.
- GREEN result: 10/10 passed; `tsc --noEmit` exited 0.

### Cluster 2 — frontier scope and link lineage

- RED command: `./node_modules/.bin/vitest run tests/integration/place-frontier-experience.test.tsx`
- RED result: 3/13 failed: all four reason-bearing candidates were buttons instead of only
  red/yellow; plural Evidence links were absent from `GlobeRoute`; legacy `officialUrl` incorrectly
  came from manual navigation rather than Evidence.
- GREEN result: 13/13 passed after adding plural contracts, stable projection dedupe, product-route
  forwarding, explicit workspace scope, formal status labels, mixed-status progress and separated
  Evidence/manual groups. TypeScript exposed one legacy-reason union mismatch and one unreachable
  pending branch; both were corrected and the same tests plus `tsc --noEmit` passed.

### Cluster 3 — canvas semantics, focus and CSS

- RED canvas command: `./node_modules/.bin/vitest run tests/integration/research-globe-canvas.test.tsx`
- RED canvas result: 1/5 failed because four destination buttons rendered instead of exactly the
  red/yellow pair.
- GREEN canvas command: focused canvas plus cold-start regression tests.
- GREEN canvas result: 32/32 passed with pending/green notes, red/yellow delegated activation,
  separate detail link groups and selected-yellow-to-green focus restoration; `tsc --noEmit`
  exited 0.
- RED CSS command: focused product-shell and visual-system tests.
- RED CSS result: 29/30 passed; the new narrow collapsed frontier control whitelist selector was
  absent.
- GREEN CSS result: the combined focused integration gate passed 75/75, later 80/80 after lifecycle
  coverage was added.

### Cluster 4 — live lifecycle, retry and cards

- Initial command: focused Task 6 experience test.
- Result: 16/18. One assertion correctly had two identical current/updated Knowledge IDs, and the
  manually errored stream was nondeterministic; those test fixtures were corrected.
- Deterministic partial EOF then exposed a genuine 17/18 RED: the ranking event survived, but an
  immediately following activation did not reliably reach the rendered partial state before the
  decoder failure. Root cause was React scheduling multiple functional screen transitions while the
  finite decoder completed in one microtask.
- GREEN implementation: a generation-local synchronous screen cursor now advances solely through
  the existing Task 5 reducer before publishing render state. No reducer or controller was
  duplicated.
- GREEN result: 18/18 passed and `tsc --noEmit` exited 0. Covered stored zero-timeline/no-flight,
  partial transport history/no cards, exact retry body, old-screen preservation until strict open,
  reused-run rejection, URL-before-reader, interrupted reload-only, and unmount abort.

## Implemented behavior

- Setup has no country input; uses the approved solo-first relocation profile, editable income,
  zero-or-more companions, five valid ordered preferences and derived mode targets. Every edit
  invalidates confirmation. POST body is exactly `{profile, preferences:{criteria}}`.
- Strict response opener validates success, exact NDJSON content type, exact-trim nonempty run,
  profile and preference headers, optional retry identity, and non-null body without starting a
  reader.
- Journey uses the requested discriminated live/stored/interrupted props. One generation-owned
  stream iterator and AbortController retain received partial history and reject stale events.
  Retry aborts old stream/fetch work, rejects reused IDs, preserves old UI until strict open, writes
  the run-only URL before consumption, and preserves old UI with an alert on failure.
- Stored reload renders no fabricated timeline or active flight. Interrupted reload cannot fabricate
  semantic identity and exposes page reload only.
- ProductShell retains one globe instance across full/collapsed mode. Context snapshot is ranking ID
  while running and shortlist ID at terminal; terminal preliminary truth alone selects yellow/green.
- Local card helpers render Task 5 projection fields only: rank, relevance, coverage, every
  contribution, formal routes/reasons/intervals/evidence IDs/actions, completeness, Evidence and
  manual navigation in separate groups, rules/Knowledge/Evidence IDs and checked/updated dates.
- Research reason projection aggregates every formal Evidence navigation URL with stable dedupe,
  separately dedupes manual navigation by label+URL, and keeps legacy `officialUrl` as first Evidence
  URL only.
- Frontier workspace preserves first-seen order, formal status copy, mixed pending progress and
  red/yellow-only disclosure. Canvas mirrors those semantics and restores focus through the existing
  two-frame clone-safe path when selection becomes noninteractive.

## Final verification evidence

- Focused Task 6 plus CSS contract:
  `./node_modules/.bin/vitest run tests/integration/place-frontier-experience.test.tsx tests/integration/product-shell.test.tsx tests/integration/research-globe-canvas.test.tsx tests/integration/cold-start-experience.test.tsx tests/integration/visual-system.test.ts`
  — 5 files, 80/80 tests passed.
- Full suite: `./node_modules/.bin/vitest run` — 32 files, 701/701 tests passed.
- TypeScript: `./node_modules/.bin/tsc --noEmit` — exit 0.
- ESLint: `./node_modules/.bin/eslint .` — exit 0. An earlier run failed only on two unused mock
  callback parameters; they were removed before the final clean run.
- Production build: `./node_modules/.bin/next build` — exit 0; `/api/cold-start` and
  `/api/place-frontier` both reported as dynamic routes.
- `git diff --check` — exit 0.
- Provider audit:
  `rg -n -i 'openai|responses[.]parse|OPENAI_API_KEY|OPENAI_MODEL|llmCalls|modelCalls|provider sdk' src tests evals package.json pnpm-lock.yaml .env.example`
  — no matches.
- Scope audit: no diffs in Application, Decision, Research, Infrastructure, API route, package,
  lockfile or environment example. No schema, dependency, provider or country-package changes.
  The unrelated `.superpowers/brainstorm/12369-1786346924/` remains untouched and untracked.
- One read-only audit loop initially failed because the variable name `path` overwrote zsh's special
  `PATH` array, so its later `git`/`rg` commands were not found. It changed no files. The audit was
  rerun with `audit_target` and passed.

## Self-review

- Lifecycle: generation checks guard both stream and retry; old screens survive failed strict opens;
  rejected opened bodies are cancelled; unmount aborts consumer and pending fetch.
- Accessibility: status is redundant text/icon; only red/yellow are focusable disclosure controls;
  pending/green are status-bearing notes; Enter/Space, Escape/close and clone-safe focus restoration
  remain covered.
- Truth: UI consumes Task 5 projection only; it performs no verdict, score, coverage, composition,
  stop-condition or date calculation. Manual navigation is never promoted to Evidence. Exhausted or
  yellow results are explicitly preliminary and never labelled complete top-5.
- Scope: no second globe, cards controller, event bus, retry framework, provider surface, schema,
  dependency, country package or visual-engine algorithm change.
- Clean-code score: 9/10. Names and boundaries are explicit, local render helpers are cohesive and
  tests are behavior-driven. The Journey file is necessarily substantial because the approved plan
  requires local cards and one lifecycle owner; splitting it would violate the requested scope.
- Clean-architecture score: 10/10. Experience depends inward on Task 5 read models/reducers and
  translates them to UI; Decision/Application/Research remain unaware of React and unchanged.

## Files changed

- `docs/superpowers/plans/2026-08-12-vs-3-place-frontier.md`
- `src/app/globals.css`
- `src/app/page.tsx`
- `src/experience/components/PlaceFrontierJourney.tsx`
- `src/experience/components/PlaceFrontierStart.tsx`
- `src/experience/components/ResearchWorkspace.tsx`
- `src/experience/place-frontier-stream.ts`
- `src/experience/place-frontier-view-model.ts`
- `src/experience/research-map/ResearchGlobe.module.css`
- `src/experience/research-map/ResearchGlobeCanvas.tsx`
- `src/experience/research-map/contracts.ts`
- `src/experience/research-map/product-route.ts`
- `src/experience/run-url.ts`
- `tests/integration/place-frontier-experience.test.tsx`
- `tests/integration/product-shell.test.tsx`
- `tests/integration/research-globe-canvas.test.tsx`
- `tests/integration/visual-system.test.ts`

No concerns remain.

## Review fix round 1 — 2026-08-12

### Accepted findings and TDD evidence

- Rejected response ownership: the first focused run reported 4/20 failures; one was a test-harness
  misuse of `.resolves` with the then-synchronous opener. After correcting that assertion, the
  factual RED was 3/20: direct bad content type, Start bad content type and retry changed identity
  each observed `cancel` 0 instead of 1. The opener is now one async ownership boundary. It performs
  the existing strict validation once, cancels every available rejected body exactly once, and
  rethrows the primary validation error. GREEN: 20/20 and `tsc --noEmit` exit 0.
- StrictMode stream ownership: RED was 3/23. Under default React `StrictMode`, neither the terminal
  result nor the retained-history transport alert appeared, and replay cancelled the one-shot stream
  once before true unmount. Root cause was immediate destructive cleanup plus generation increment
  during setup-cleanup-setup replay. A generation-owned consumer is now retained across replay;
  cleanup schedules an idempotent release that the replay setup revokes. True unmount and retry
  supersession still abort, while stale generations remain rejected. GREEN: 23/23 and TypeScript
  exit 0.
- Rapid frontier marker visibility: RED was 1/6 in the Canvas integration file. After five immediate
  activations, only the origin existed in the marker DOM because previous pending flights had been
  interrupted before destination reveal. The frontier projection now marks every activated route as
  immediately marker-visible through an optional presentation contract. The Canvas consumes that
  truth without changing flight, camera, material, clone or focus algorithms. GREEN: 6/6 and
  TypeScript exit 0; all five gray markers remained visible and the first red plus sixth replacement
  persisted together.
- Formal verdict date: RED was 1/23 because the terminal card had no `Вердикт на дату` field. The
  card now renders the projected `formalVerdict.verdictAsOf` directly. GREEN: 23/23.
- Companion summary: RED was 1/24 because adding a spouse changed profile state but left the review
  copy at `Один человек`. The review derives its party size and relationship labels from the current
  companions. Add and remove both invalidate confirmation; remove restores solo copy. GREEN: 24/24.
- Cancellation error precedence self-review: an isolated stronger probe made `body.cancel()` throw
  synchronously. RED was 1/1: `cancel_failed` replaced
  `invalid_place_frontier_content_type`. Cancellation now begins behind a Promise boundary, so both
  synchronous throws and rejected Promises remain secondary. GREEN: isolated 1/1 with exactly one
  cancellation and the original validation error preserved.
- Lifecycle preservation characterization: retry missing identity cancels its rejected body exactly
  once, and a second retry superseding an already-consumed first retry triggers the first stream's
  underlying source cancellation exactly once. An initial supersession probe incorrectly spied
  `ReadableStream.cancel()`, which cannot observe the decoder's legitimate `reader.cancel()` call;
  it failed with 0 calls. The probe was corrected to observe the underlying source `cancel`
  callback, passed, and the exploratory pending-ownership production change was removed.

### Final verification after review fixes

- Focused Task 6 gate: 5 files, 89/89 tests passed.
- Full Vitest: 32 files, 710/710 tests passed.
- `tsc --noEmit`: exit 0.
- ESLint: exit 0.
- Next production build: exit 0; `/api/cold-start` and `/api/place-frontier` remained dynamic.
- `git diff --check`: exit 0.
- Provider audit: no matches (the expected `rg` exit 1 with empty output).
- Scope audit: exactly eight authorized Task 6 source/test files changed. Application, Decision,
  Research, Infrastructure, API routes, package files, lockfile and environment example have no
  diff. The unrelated brainstorm directory remains untouched and untracked.

### Review-fix self-review

- Lifecycle: one stream consumer owns one one-shot body; StrictMode replay cannot cancel or consume
  it twice. Destructive cleanup remains idempotent and deferred only long enough to distinguish
  replay, while true unmount/retry supersession and generation guards retain ownership safety.
- Accessibility and visual behavior: pending frontier markers remain noninteractive gray notes;
  red/yellow are still the only buttons. Existing focus restoration, clone handling and collapsed
  pointer whitelist behavior are unchanged.
- Truth: `markerVisible` describes presentation visibility only; it does not alter formal status.
  `verdictAsOf` and companion summary are rendered from existing projected/profile state with no new
  domain calculations.
- Scope and architecture: changes remain in the Experience/presentation boundary. No controller,
  event bus, queue, provider, schema, dependency or visual-engine algorithm was added.
- Clean-code score: 9/10. Response ownership and effect cleanup have named, single-purpose
  boundaries; regressions cover success and failure lifecycle paths. The Journey remains the largest
  local presentation module from the approved Task 6 design.
- Clean-architecture score: 10/10. Domain/Application remain independent of React and presentation;
  the new marker visibility flag travels outward through the existing view contract only.

No concerns remain after review fix round 1.

## Review fix round 2 — 2026-08-12

### Accepted findings and TDD evidence

- Synchronous opener contract: before production changes, `tsc --noEmit --pretty false` failed with
  TS2322 because `ReturnType<typeof openPlaceFrontierStreamResponse>` was still a Promise. The
  focused runtime probe also failed 1/1 because the opener returned `Promise {}` rather than the
  exact response value. The opener is synchronous again. A guarded fire-and-forget cancellation is
  initiated immediately on every strict validation failure; synchronous throws, asynchronous
  rejection and a never-settling cancellation cannot replace or delay the primary synchronous
  validation error. Start and retry call the synchronous opener directly. GREEN: response-boundary
  tests 8/8 and TypeScript exit 0.
- Accepted-body ownership: exact Start and retry probes unmounted synchronously from run-only URL
  installation, before the passive decoder effect. RED: 2/2 failed with underlying body
  cancellation 0 while reader acquisition remained 0. A small idempotent stream handoff now owns
  each accepted body before URL installation. Start retains launch ownership, retry retains
  generation ownership, and the decoder adopts that ownership exactly once. On pre-adoption
  unmount/supersession the handoff cancels once; after adoption its cancellation is a no-op and the
  existing generation consumer remains the sole owner. GREEN: both window probes 2/2 and the full
  lifecycle subset 12/12, including StrictMode terminal/transport replay, true unmount and retry
  supersession.
- URL failure self-review: an additional Start probe made `history.replaceState` throw after strict
  open. RED was 1/1 with cancellation 0. The launch catch now cancels its still-owned handoff and
  clears the retained owner before showing the existing generic error. GREEN: 1/1; body cancellation
  was exactly once and reader acquisition remained 0.
- Late launch-response self-review: an additional probe unmounted Start while fetch was pending and
  then resolved a valid response. RED was 1/1 with cancellation 0. Start now checks its synchronous
  mount owner immediately before and after URL installation, so a transport that resolves after
  unmount is cancelled once without URL/state installation or reader acquisition. GREEN: 1/1.

### Final verification after review fix round 2

- Focused Task 6 gate: 5 files, 94/94 tests passed.
- Full Vitest: 32 files, 715/715 tests passed.
- One later full run executed concurrently with the production build and hit the existing 5-second
  timeout in the browser-bundle subprocess test (714/715). The timed-out test then passed alone
  1/1 in 433 ms, and the full suite passed again sequentially at 715/715.
- `tsc --noEmit --pretty false`: exit 0.
- ESLint: exit 0. The first final run found only two `prefer-const` findings in the new test harness;
  those bindings were corrected before the clean rerun.
- Next production build: exit 0; `/api/cold-start` and `/api/place-frontier` remained dynamic.
- `git diff --check`: exit 0.
- Provider audit: no matches (the expected `rg` exit 1 with empty output).
- Scope audit before this report append: exactly four authorized Task 6 source/test files changed.
  No Application, Decision, Research, Infrastructure, API, package, lockfile, environment, schema,
  dependency or provider changes. The unrelated brainstorm directory remains untouched and
  untracked.

### Review-fix self-review

- Lifecycle: strict rejection and accepted pre-adoption bodies always have one cancellation owner;
  decoder adoption transfers ownership once. Cleanup remains idempotent across StrictMode replay,
  true unmount, retry supersession, stale generation, URL failure and normal terminal consumption.
- Accessibility and truth: no rendered content, interaction, verdict, ranking, evidence or visual
  behavior changed in this round.
- Scope and architecture: the handoff is a narrow Experience-boundary ownership value, not a
  resource framework, controller or event bus. Domain/Application/Research/provider boundaries are
  unchanged.
- Clean-code score: 9/10. The synchronous opener and ownership transfer have explicit contracts,
  one-purpose names and focused failure-path tests.
- Clean-architecture score: 10/10. Stream transport ownership remains entirely in Experience and
  does not leak into inward layers.

No concerns remain after review fix round 2.
