# VS-4A City Frontier Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver strict City Frontier commands, finite streaming, browser-safe projection, accessible globe/card UX, terminal city selection and evidence-backed acceptance without duplicating domain policy.

**Architecture:** HTTP adapters translate strict bodies to Application ports. A finite-NDJSON decoder validates the committed frontier prefix and withholds each continuation's canonical result through clean EOF; the returned revision itself decides whether the frontier is working or terminal. Pure Experience projection consumes verified read models; React owns only lifecycle, focus and rendering. `CityFrontierJourney` owns one ProductShell/globe across setup, continuation, terminal and selection, rather than expanding the existing country Journey.

**Tech Stack:** Next.js App Router, React, Zod, existing `finite-ndjson.ts` ownership/handoff, ProductShell/WorkspaceGlobe/ResearchWorkspace, Vitest/Testing Library, production Next build.

**Depends on:** completed [`Frontier Core`](2026-08-13-vs-4a-city-frontier-core.md).

**Required safety amendment:** [`VS-4A Safety Source Discovery`](2026-08-14-vs-4a-safety-source-discovery.md). It replaces the green-with-amber/no-yellow projection and extends replay/evidence to the bounded safety-search ledger.

**Split review:** This sub-300-line delivery checklist stays together because its four tasks share one strict wire/read-model lifecycle and one globe owner; the larger Foundations, Safety, Knowledge and Core matrices are separate linked plans.

## Constraints specific to this plan

- HTTP never accepts facts, score, warning basis, branch parent or Knowledge/Evidence IDs from the client.
- Start and Select are strict JSON. Continue is finite NDJSON and the only endpoint whose use case may reach official sources or the safety-search port.
- Browser modules may runtime-import only Decision and Experience. Application imports are type-only; Infrastructure and `node:*` are forbidden in the web bundle.
- Active unchecked city is gray `Проверяется`, never green or selectable.
- Fully verified selectable is green. Selectable with any unknown is yellow with warning text and the same selection affordance; yellow occupies a terminal slot and needs no separate modal.
- Cards show frozen rank/score and separately fresh verification coverage/facts. React never computes a second score.
- No Select control before terminal. Terminal 0 renders its exact `catalog_exhausted` or
  `live_candidate_limit_reached` reason and no City CTA; budget copy never claims the catalog ended.
- Preserve existing country, cold-start, housing and globe focus/reduced-motion behavior.

---

### Task 16: Add strict Start, Continue and Select HTTP adapters

**Requirements:** REQ-CF-04, REQ-CF-06, REQ-CF-07; SCN-CF-06, SCN-CF-08

**Files:**
- Create: `src/app/api/city-frontier/start/route.ts`
- Create: `src/app/api/city-frontier/continue/route.ts`
- Create: `src/app/api/city-frontier/select/route.ts`
- Create: `tests/integration/city-frontier-transport.test.ts`

**Interfaces:**

```text
POST /api/city-frontier/start
{ resolvedCountryShortlistRevisionId, countryCode, criteria, commandId }
-> application/json CityFrontierReadModel

POST /api/city-frontier/continue
{ runId, expectedRevisionId, commandId }
-> application/x-ndjson

POST /api/city-frontier/select
{ terminalCityShortlistSnapshotId, cityId, commandId, warningCopyVersion? }
-> application/json { selection, commit, readModel }
```

- [ ] **Step 1: Write route RED tests**

Cover exact media type, malformed JSON, unknown/missing/extra fields, exact four-criteria body, green/yellow/red committed markers, expected 404/409 safe mappings, generic no-leak 500, provider/internal error text suppression, no application call on invalid input, and exact JSON outputs.

- [ ] **Step 2: Add Continue lifecycle RED tests**

Assert prepare completes before stream construction, exact safe response headers, nonblocking response, one controller for request abort/body cancel, listener cleanup, LF framing, committed-before-event, exactly one required continuation-completed frame, callback/return canonical equality and generic error frames. A working one-city result is valid and must not masquerade as a terminal frontier.

- [ ] **Step 3: Run RED**

```bash
./node_modules/.bin/vitest run tests/integration/city-frontier-transport.test.ts
```

- [ ] **Step 4: Implement three thin adapters**

Use per-route ports containing only the exact method each route calls. Construct and validate all headers before starting the stream. Start/Select return no-store JSON. Continue links abort/cancel exactly once and emits no optimistic completion. Map only named expected domain errors; all integrity/unexpected text is hidden.

- [ ] **Step 5: Run GREEN and commit**

```bash
./node_modules/.bin/vitest run tests/integration/city-frontier-transport.test.ts \
  tests/integration/country-resolution-transport.test.ts \
  tests/integration/place-frontier-transport.test.ts
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/eslint src/app/api/city-frontier \
  tests/integration/city-frontier-transport.test.ts
git diff --check
git add src/app/api/city-frontier tests/integration/city-frontier-transport.test.ts
git commit -m "feat: expose city frontier transport"
```

---

### Task 17: Implement the finite wire decoder and pure view projection

**Requirements:** REQ-CF-04, REQ-CF-06; SCN-CF-03, SCN-CF-04, SCN-CF-06..08, SCN-CF-10

**Files:**
- Create: `src/experience/city-frontier-stream.ts`
- Create: `src/experience/city-frontier-view-model.ts`
- Modify: `tests/fixtures/place-frontier-client/entry.ts`
- Modify: `tests/integration/city-frontier-transport.test.ts`

**Wire contract:** Task 12 owns the closed `CityFrontierEvent` union in `src/application/city-frontier-contracts.ts`. Delivery type-imports that contract and independently validates its exact browser-safe wire projection; Experience never becomes an Application dependency.

- [ ] **Step 1: Write closed-protocol RED tests**

Reject unknown/extra keys, wrong run/base/sequence, progress without activation,
country/city/rank mismatch, second activation, commit with altered historical
prefix/source/cursor/phase/budget, uncommitted marker, working state after ten markers, limit terminal
below ten markers, an eleventh activation, illegal terminal and event after continuation completion.
Accept a working one-city continuation, immediate exhaustion, exact tenth-marker partial terminal and
multi-command red/selectable chains.

- [ ] **Step 2: Add EOF/cancellation RED tests**

Hold `city_continuation_completed` until clean EOF; trailing bytes/error/abort/cancel suppress its read model; retain only received committed markers on transport failure. The clean result may be working or terminal, and terminal UI is enabled only when `readModel.revision.kind === "terminal"`. Strict response opener must validate headers/body synchronously, cancel rejected bodies without masking the primary error and use the existing handoff ownership.

- [ ] **Step 3: Run RED**

```bash
./node_modules/.bin/vitest run tests/integration/city-frontier-transport.test.ts
```

- [ ] **Step 4: Implement strict normalization and reducer**

Reuse `readFiniteNdjson` and generic handoff; do not copy the reader. Runtime-import browser-safe semantic City Decision reconstruction, which verifies prefix, stop and warning semantics without recomputing sealed IDs/HMAC. Never import Application, Infrastructure, a crypto adapter or `node:*` at runtime.

- [ ] **Step 5: Implement pure projection and browser smoke**

Project all frozen-order markers from the verified Registry revision: pending gray `Проверяется`, all-verified selectable green `Доступен для выбора`, unknown selectable yellow `Доступен с неполными данными`, excluded red `Исключён`. `city_progress.sourceUrl` may contain only an already validated official navigation/document URL; never expose an untrusted provider result or snippet. Copy the exact committed tuple of four browser-safe fact projections plus accepted/reviewed official Evidence links and rejection reasons; never reconstruct them in React. Cards are terminal only and copy rank/score from Ranking plus fresh facts/coverage from committed markers. Project verified selection/branch history on stored reload. Stored mode has no fabricated progress/flight. Add City Decision plus both Experience modules to the real web-target fixture and fail on any Application/Infrastructure/`node:*` runtime edge.

- [ ] **Step 6: Run GREEN and commit**

```bash
./node_modules/.bin/vitest run tests/integration/city-frontier-transport.test.ts \
  tests/integration/place-frontier-transport.test.ts
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/eslint src/experience/city-frontier-{stream,view-model}.ts \
  tests/integration/city-frontier-transport.test.ts \
  tests/fixtures/place-frontier-client/entry.ts
git diff --check
git add src/experience/city-frontier-stream.ts \
  src/experience/city-frontier-view-model.ts \
  tests/integration/city-frontier-transport.test.ts \
  tests/fixtures/place-frontier-client/entry.ts
git commit -m "feat: decode city frontier"
```

---

### Task 18: Deliver setup, one-globe journey, cards and selection UX

**Requirements:** REQ-CF-02, REQ-CF-04, REQ-CF-06, REQ-CF-07; SCN-CF-03, SCN-CF-04, SCN-CF-08..10

**Files:**
- Create: `src/experience/components/CityFrontierStart.tsx`
- Create: `src/experience/components/CityFrontierJourney.tsx`
- Create: `src/experience/components/CityFrontierPanel.tsx`
- Create: `src/experience/components/CityFrontierCards.tsx`
- Create: `tests/integration/city-frontier-experience.test.tsx`
- Modify: `src/experience/components/CountryResolutionPanel.tsx`
- Modify: `src/app/page.tsx`
- Modify: `src/experience/run-url.ts`
- Modify: `src/experience/components/ResearchWorkspace.tsx`
- Modify: `src/experience/research-map/contracts.ts`
- Modify: `src/experience/research-map/product-route.ts`
- Modify: `src/experience/research-map/ResearchGlobeCanvas.tsx`
- Modify: `src/app/globals.css`
- Modify regressions: `tests/integration/country-resolution-experience.test.tsx`
- Modify regressions: `tests/integration/research-globe-canvas.test.tsx`
- Modify regressions: `tests/integration/product-shell.test.tsx`
- Modify regressions: `tests/integration/visual-system.test.ts`

**Component contract:** Each terminal country card exposes `Исследовать города` to exact `?flow=city-frontier&source=<resolvedRevisionId>&country=<code>`. The server calls `presentCityFrontierSetup` before rendering setup; invalid query bindings show no domain data. After Start, the URL is exactly `?flow=city-frontier&run=<id>`.

- [ ] **Step 1: Write setup and URL/page RED tests**

Assert each resolved country CTA carries exact source/country; setup Page verifies it server-side;
four fixed editable criteria use returned installed definitions/defaults; edit invalidates confirmation;
exact at-most-100 catalog coverage and installed-country scope copy, including a smaller official
universe, missing population and mandatory-capital-overflow `NEEDS_CONTEXT`; exact Start body;
ambiguous Start retry reuses the same command ID/payload; unavailable package message; URL installs
before state adoption; stored Page presents by run only; missing snapshot recoverable;
integrity/unexpected generic; zero client fetch on reload.
Assert a legacy-only @1 package renders an upgrade-required unavailable message and makes no Start or
source request, while a historical stored @1 run remains presentable by exact run ID.

- [ ] **Step 2: Write marker/card/selection RED tests**

Assert gray active marker; red excluded stays visible/clickable; green all-verified selectable; yellow
unknown selectable with the same interaction and terminal-slot behavior; exact frozen
`rank/score at start`; separate fresh four facts/coverage; explicit installed-catalog limitation and
incomplete-coverage warning; no second score or global-best claim; no Select before terminal;
terminal 0 no CTA; terminal 1–3 green/yellow selection; yellow CTA states inline risk acceptance
without a modal; exact Select payload; committed selection/branch confirmation; selecting a second
terminal city creates and displays a sibling alternative. For `live_candidate_limit_reached`, render
`Проверено 10 городов; в установленном каталоге остались непроверенные кандидаты` plus the exact
`N из 3` result; for `catalog_exhausted`, say the frozen queue is exhausted. Never conflate either
with per-city safety-source exhaustion.

For a verified safety fact, assert accepted official link, reference year, offence numerator, SURS denominator and `lastCheckedAt`. For unknown safety, assert terminal reason, reviewed official links and per-link rejection reasons. Exhaustion copy says the bounded search ended; transport copy says the provider/official path was unavailable. Neither says that no source exists anywhere.

- [ ] **Step 3: Write lifecycle/a11y RED tests**

Cover StrictMode one-shot handoff, true-unmount cancel once, superseding Continue, same-command retry after ambiguous Continue, URL-before-adopt window, commit-then-EOF failure reload, request failure preserving history, ambiguous Select retry with the same command/payload, progress live region, active-city/terminal focus, Escape restoration, keyboard selection and reduced motion.

- [ ] **Step 4: Run RED**

```bash
./node_modules/.bin/vitest run tests/integration/city-frontier-experience.test.tsx \
  tests/integration/research-globe-canvas.test.tsx \
  tests/integration/product-shell.test.tsx tests/integration/visual-system.test.ts
```

- [ ] **Step 5: Implement focused city components and same-city-globe ownership**

`CityFrontierJourney` has a closed `setup | live | stored` mode and owns one ProductShell/WorkspaceGlobe across setup/live/terminal/selection; `CityFrontierStart` is its presentational setup child. Do not add city lifecycle to the 900-line country Journey. `CityFrontierPanel` owns controls/errors; `CityFrontierCards` is dumb markup. Preserve route keys across pending→red/green and close a detail if a route becomes noninteractive. Use a narrow collapsed pointer-event whitelist.

- [ ] **Step 6: Add only presentation fields needed by the existing globe**

Extend route/candidate contracts with exact gray/green/yellow/red status labels and accepted/reviewed Evidence links. Green and yellow city destinations are interactive only in terminal selection context; pending is a noninteractive note, excluded remains interactive for explanation. Add a real yellow material/style and visual-system assertions; do not emulate it with green plus an amber ring. Do not change camera, lighting or flight algorithms.

- [ ] **Step 7: Run GREEN and commit**

```bash
./node_modules/.bin/vitest run tests/integration/city-frontier-experience.test.tsx \
  tests/integration/country-resolution-experience.test.tsx \
  tests/integration/research-globe-canvas.test.tsx \
  tests/integration/product-shell.test.tsx tests/integration/visual-system.test.ts
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/eslint src/experience/components/CityFrontier*.tsx \
  src/experience/components/CountryResolutionPanel.tsx src/app/page.tsx \
  src/experience/run-url.ts src/experience/components/ResearchWorkspace.tsx \
  src/experience/research-map tests/integration/city-frontier-experience.test.tsx
git diff --check
git add src/experience/components/CityFrontierStart.tsx \
  src/experience/components/CityFrontierJourney.tsx \
  src/experience/components/CityFrontierPanel.tsx \
  src/experience/components/CityFrontierCards.tsx \
  src/experience/components/CountryResolutionPanel.tsx src/app/page.tsx \
  src/experience/run-url.ts src/experience/components/ResearchWorkspace.tsx \
  src/experience/research-map/contracts.ts src/experience/research-map/product-route.ts \
  src/experience/research-map/ResearchGlobeCanvas.tsx src/app/globals.css \
  tests/integration/city-frontier-experience.test.tsx \
  tests/integration/country-resolution-experience.test.tsx \
  tests/integration/research-globe-canvas.test.tsx \
  tests/integration/product-shell.test.tsx tests/integration/visual-system.test.ts
git commit -m "feat: show city frontier on globe"
```

---

### Task 19: Produce deterministic replay and official-source acceptance evidence

**Requirements:** all; SCN-CF-01..10

**Files:**
- Create: `docs/changes/active/vs-4a-city-frontier/implementation-evidence.md`
- Modify after approval only: `docs/changes/active/vs-4a-city-frontier/change.md`
- Modify after approval only: `docs/README.md`

**Stop boundary:** Evidence remains untracked and status/docs remain unchanged until the user approves the exact evidence.

- [ ] **Step 1: Run all deterministic gates sequentially**

```bash
./node_modules/.bin/vitest run
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/eslint .
./node_modules/.bin/next build
git diff --check
! rg -n -i \
  'openai|anthropic|gemini|langchain|llamaindex|llm[_-]?|model[_-]?name' \
  src tests evals package.json pnpm-lock.yaml .env.example
```

Record exact counts, duration, HEAD and timestamp. If any gate fails, stop evidence work and debug; never edit evidence to call a failed gate green.

- [ ] **Step 2: Run the canonical two-presentation replay proof**

On an isolated copy/backup of a real completed test DB, replace every official source/request-step/safety-search port with counted throwing spies. Call `presentCityFrontier(runId)` twice and compare canonical read models including catalog/criteria/ranking, marker prefix, terminal entries, four-fact Knowledge IDs/Evidence IDs, projected accepted/reviewed URLs and reasons, pre-city parent and selections/branches. Separately load or replay the verified City Evidence bundle and canonical-compare its full safety attempt ledger. Snapshot full immutable rows from all eight new tables plus relevant generic Evidence rows before/after; assert byte equality and zero official/search calls.

- [ ] **Step 3: Verify City selection and sibling branch SQL**

With `PRAGMA query_only=ON`, prove the selected city belongs to the exact terminal, warnings equal the marker unknown basis, selection/branch hashes/HMAC verify, and two choices from one terminal have the same pre-city `parent_id/forked_from` and distinct selection/branch IDs. Record `integrity_check=ok` and zero FK violations.

- [ ] **Step 4: Execute one isolated official-source walkthrough**

Follow the then-current local `AGENTS.md`: an explicit chat-wide read-only permission may cover browser navigation in that chat, while downloads/forms/uploads/sign-in require separate immediate confirmation. Then use a `mktemp -d` database and a process-only HMAC key. Install the official catalog with the administrative installer, start from a verified resolved country, confirm four criteria, explicitly Continue candidates until any terminal, never beyond ten completed cities. Inspect actual previous/configured/search fallback, per-city safety query/document-URL/hop bounds, frontier-wide city count, rejection ledger, source/fact progress and gray/green/yellow/red states. Select one green or yellow city, reload the exact URL and verify the same links/reasons with no new official/search request. Do not click arbitrary external links, reuse a developer DB or replace live outcomes with fixtures.

- [ ] **Step 5: Write exact evidence and stop for approval**

Evidence includes HEAD/time, commands/counts, source/capture outcomes, query/provider/template IDs,
per-city safety `3 queries / 10 document URLs / 2 hops`, separate frontier `completed city checks <= 10`,
candidate rejection ledger, accepted/reviewed URLs, retention/transient cleanup, catalog
membership/coverage/cap/rules version, ranking formula inputs, marker/four-fact lineage, exact terminal
stop, selection/branch IDs, zero-network replay, SQL integrity, limitations and cleanup (server stopped,
temp DB/sidecars removed, HMAC/search credentials unset). Run:

```bash
evidence_diff_check="$(git diff --no-index --check /dev/null \
  docs/changes/active/vs-4a-city-frontier/implementation-evidence.md 2>&1 || true)"
test -z "$evidence_diff_check"
git status --short
```

Then stop and ask the user to approve the untracked evidence. Do not stage, commit, push or mark the change implemented.

- [ ] **Step 6: After explicit evidence approval, publish docs only**

Update change status to `implemented — source-verified`, link the approved evidence from README, stage only those three docs and commit:

```bash
git add docs/README.md docs/changes/active/vs-4a-city-frontier/change.md \
  docs/changes/active/vs-4a-city-frontier/implementation-evidence.md
git commit -m "docs: verify VS4A city frontier"
```

No push, PR or merge without a separate user request.
