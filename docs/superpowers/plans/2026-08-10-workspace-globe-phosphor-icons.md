# Workspace Globe and Phosphor Icons Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render one persistent realistic Earth in the workspace left by the expandable navigation rail, reuse it on Overview and Research, remove the flat map, and replace mixed glyphs with one Phosphor icon system.

**Architecture:** `ProductShell` owns the desktop rail width and a single `WorkspaceGlobe` base layer. Destination workspaces render only glass foreground panels, so navigation changes do not remount WebGL. A small `UiIcon` adapter exposes an explicit, tree-shakeable Phosphor map and standardizes weight, size, and accessibility.

**Tech Stack:** Next.js 16, React 19, TypeScript 6, `react-globe.gl`, Three.js, `@phosphor-icons/react@2.1.10`, Vitest, Testing Library, CSS.

## Global Constraints

- Collapsed desktop rail width is exactly `80px`; expanded desktop rail width is exactly `240px`.
- The rail is collapsed by default and mobile retains fixed bottom navigation without an expanded mode.
- One `ResearchGlobeCanvas` instance occupies the workspace column only and uses background `#061014`.
- Overview, Research, Branch, Life Git, and Sources share the mounted globe scene.
- Cards remain borderless and visibly translucent; no card outline may be introduced.
- The flat `/world-map.svg` scene, airplane glyph, and obsolete `orbit-globe` presentation CSS are removed.
- All interface icons come from `@phosphor-icons/react@2.1.10`; Unicode icon glyphs are not used.
- Regular is the default icon weight; active navigation and high-priority status may use duotone.
- Existing retry, evidence lineage, branch, URL replacement, keyboard, and reduced-motion behavior must remain intact.

---

### Task 1: Introduce the typed Phosphor icon adapter

**Files:**
- Create: `src/experience/components/UiIcon.tsx`
- Create: `tests/integration/ui-icon.test.tsx`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Produces: `UiIconName`, a closed union derived from `UI_ICONS`.
- Produces: `UiIcon({ name, size?, weight?, className? })`, which renders a decorative Phosphor SVG inside a `data-icon` wrapper.
- Consumes later: `NavigationRail`, `ContextBar`, `OrbitPanels`, and `ResearchWorkspace` import `UiIcon` instead of raw glyphs.

- [ ] **Step 1: Write the failing adapter test**

```tsx
// tests/integration/ui-icon.test.tsx
// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { UiIcon } from "../../src/experience/components/UiIcon";

afterEach(cleanup);

it("renders the sanctioned icon map as decorative Phosphor SVG", () => {
  const { container } = render(
    <div>
      <UiIcon name="overview" />
      <UiIcon name="medical" size={18} />
      <UiIcon name="status-yellow" weight="duotone" />
    </div>,
  );

  expect(container.querySelectorAll("svg")).toHaveLength(3);
  expect(container.querySelector('[data-icon="overview"]')?.getAttribute("aria-hidden")).toBe("true");
  expect(container.textContent).toBe("");
});
```

- [ ] **Step 2: Run the test and verify the missing module failure**

Run: `pnpm test -- tests/integration/ui-icon.test.tsx`

Expected: FAIL because `UiIcon.tsx` and the Phosphor dependency do not exist.

- [ ] **Step 3: Add the exact dependency**

Run: `pnpm add @phosphor-icons/react@2.1.10`

Expected: `package.json` and `pnpm-lock.yaml` record exactly `2.1.10`.

- [ ] **Step 4: Implement the explicit icon map**

```tsx
// src/experience/components/UiIcon.tsx
import {
  ArrowClockwise,
  ArrowUpRight,
  Books,
  CheckCircle,
  CircleNotch,
  FirstAid,
  GitBranch,
  GitCommit,
  GlobeHemisphereWest,
  MagnifyingGlass,
  Minus,
  Plus,
  SidebarSimple,
  TrendUp,
  WarningCircle,
  Waves,
  XCircle,
} from "@phosphor-icons/react";

const UI_ICONS = {
  overview: GlobeHemisphereWest,
  research: MagnifyingGlass,
  branch: GitBranch,
  "life-git": GitCommit,
  sources: Books,
  "rail-toggle": SidebarSimple,
  "status-pending": CircleNotch,
  "status-green": CheckCircle,
  "status-yellow": WarningCircle,
  "status-red": XCircle,
  medical: FirstAid,
  sea: Waves,
  income: TrendUp,
  external: ArrowUpRight,
  expand: Plus,
  collapse: Minus,
  retry: ArrowClockwise,
} as const;

export type UiIconName = keyof typeof UI_ICONS;

interface UiIconProps {
  readonly className?: string;
  readonly name: UiIconName;
  readonly size?: number;
  readonly weight?: "regular" | "duotone";
}

export function UiIcon({ className, name, size = 20, weight = "regular" }: UiIconProps) {
  const Icon = UI_ICONS[name];
  return (
    <span aria-hidden="true" className={className} data-icon={name}>
      <Icon focusable="false" size={size} weight={weight} />
    </span>
  );
}
```

- [ ] **Step 5: Run focused validation**

Run: `pnpm test -- tests/integration/ui-icon.test.tsx && pnpm typecheck`

Expected: PASS. The exact imports above were verified against the official `2.1.10` package tarball.

- [ ] **Step 6: Commit the adapter**

```bash
git add package.json pnpm-lock.yaml src/experience/components/UiIcon.tsx tests/integration/ui-icon.test.tsx
git commit -m "feat: add phosphor icon system"
```

---

### Task 2: Move the realistic globe into the product shell

**Files:**
- Create: `src/experience/components/WorkspaceGlobe.tsx`
- Delete: `src/experience/components/OrbitGlobe.tsx`
- Modify: `src/experience/components/ProductShell.tsx`
- Modify: `src/experience/components/OverviewWorkspace.tsx`
- Modify: `src/experience/research-map/ResearchGlobeCanvas.tsx`
- Modify: `tests/integration/orbit-command-center.test.tsx`
- Modify: `tests/integration/product-shell.test.tsx`

**Interfaces:**
- Produces: `WorkspaceGlobe({ status, renderGlobe? })` with the fixed Moscow → Tirana route and dark canvas.
- `ProductShell` owns and renders exactly one `WorkspaceGlobe` when `setup` is false and `context` exists.
- `OverviewWorkspace` no longer imports or renders a globe.

- [ ] **Step 1: Rewrite the globe integration test around workspace ownership**

```tsx
it("passes the fixed route and bundled dark background to the shared globe", () => {
  const renderGlobe = vi.fn(() => <div data-testid="research-globe-engine" />);
  render(<WorkspaceGlobe renderGlobe={renderGlobe} status="green" />);

  expect(screen.getByRole("region", { name: /3D Земля.*Россия.*Тирана/i })).toBeTruthy();
  expect(renderGlobe).toHaveBeenCalledWith(expect.objectContaining({
    backgroundColor: "#061014",
    origin: expect.objectContaining({ city: "Москва", country: "Россия" }),
    routes: [expect.objectContaining({ city: "Тирана", country: "Албания" })],
  }));
});
```

Add a `ProductShell` assertion that `.product-shell__workspace` contains one `.workspace-globe` before the active `<main>` and that rerendering with another destination still leaves exactly one globe region.

- [ ] **Step 2: Run the focused tests and verify they fail**

Run: `pnpm test -- tests/integration/orbit-command-center.test.tsx tests/integration/product-shell.test.tsx`

Expected: FAIL because `WorkspaceGlobe` does not exist and `OverviewWorkspace` still owns `OrbitGlobe`.

- [ ] **Step 3: Convert `OrbitGlobe` into `WorkspaceGlobe`**

Retain the current `supportsWebGL`, dynamic import, fallback retry, Moscow/Tirana coordinates, and route status. Replace the figure/caption presentation with this shell:

```tsx
return (
  <section aria-label="3D Земля маршрута Россия → Тирана" className="workspace-globe">
    <div className="workspace-globe__engine">{globe}</div>
  </section>
);
```

Pass `backgroundColor: "#061014"` to `ResearchGlobeCanvas`. Keep the fallback button accessible and keep `renderGlobe` only as a deterministic test seam.

- [ ] **Step 4: Mount the globe once in `ProductShell`**

```tsx
<div className="product-shell__workspace">
  {setup || context === undefined ? null : <WorkspaceGlobe status={context.status} />}
  {context === undefined ? null : <ContextBar context={context} />}
  <main className="product-shell__content">{children}</main>
</div>
```

Remove the `OrbitGlobe` import and element from `OverviewWorkspace`. Keep the foreground route, profile, detail, and telemetry panels unchanged in this task.

- [ ] **Step 5: Keep the canvas resize contract and dark default explicit**

In `ResearchGlobeCanvas`, retain the existing `ResizeObserver` sizing and set the prop default to `#061014`. The root `.globe` remains `position: absolute; inset: 0` so it fills the workspace container rather than a square Overview viewport.

- [ ] **Step 6: Run focused tests**

Run: `pnpm test -- tests/integration/orbit-command-center.test.tsx tests/integration/product-shell.test.tsx tests/integration/journey-actions.test.tsx`

Expected: PASS, including yellow journeys that initially open Research.

- [ ] **Step 7: Commit shared globe ownership**

```bash
git add src/experience/components/WorkspaceGlobe.tsx src/experience/components/OrbitGlobe.tsx src/experience/components/ProductShell.tsx src/experience/components/OverviewWorkspace.tsx src/experience/research-map/ResearchGlobeCanvas.tsx tests/integration/orbit-command-center.test.tsx tests/integration/product-shell.test.tsx
git commit -m "feat: share globe across workspaces"
```

---

### Task 3: Add the 80px/240px navigation rail and Phosphor navigation icons

**Files:**
- Modify: `src/experience/components/ProductShell.tsx`
- Modify: `src/experience/components/NavigationRail.tsx`
- Modify: `src/experience/components/ContextBar.tsx`
- Modify: `src/app/globals.css`
- Modify: `tests/integration/product-shell.test.tsx`
- Modify: `tests/integration/visual-system.test.ts`

**Interfaces:**
- `NavigationRail` consumes `expanded: boolean` and `onExpandedChange(expanded: boolean): void`.
- `ProductShell` owns local `railExpanded` state and exposes it through `data-rail-expanded`.
- `UiIcon` supplies all navigation and context-status icons.

- [ ] **Step 1: Add failing expansion and icon semantics tests**

```tsx
const shell = render(
  <ProductShell
    activeDestination="overview"
    context={{ route: "Россия → Тирана", branch: "C0", snapshot: "06.08.2026", status: "green" }}
    onDestinationChange={() => undefined}
  >
    Workspace
  </ProductShell>,
);
const toggle = screen.getByRole("button", { name: /раскрыть навигацию/i });
expect(toggle.getAttribute("aria-expanded")).toBe("false");
expect(shell.container.querySelector(".product-shell")?.getAttribute("data-rail-expanded")).toBe("false");
expect(screen.getByRole("button", { name: /обзор/i }).querySelector('[data-icon="overview"]')).toBeTruthy();

fireEvent.click(toggle);
expect(screen.getByRole("button", { name: /свернуть навигацию/i }).getAttribute("aria-expanded")).toBe("true");
expect(shell.container.querySelector(".product-shell")?.getAttribute("data-rail-expanded")).toBe("true");
expect(screen.getByText("Обзор").classList.contains("visually-hidden")).toBe(false);
```

Update the visual contract to require `grid-template-columns: 80px minmax(0, 1fr)` and `.product-shell[data-rail-expanded="true"]` to require `240px minmax(0, 1fr)`.

- [ ] **Step 2: Run tests and verify the collapsed-only rail fails**

Run: `pnpm test -- tests/integration/product-shell.test.tsx tests/integration/visual-system.test.ts`

Expected: FAIL because there is no toggle, no expansion state, and the icons are strings.

- [ ] **Step 3: Implement rail state in `ProductShell`**

```tsx
const [railExpanded, setRailExpanded] = useState(false);

<div className="product-shell" data-rail-expanded={railExpanded} data-setup={setup || undefined}>
  <NavigationRail
    activeDestination={activeDestination}
    expanded={railExpanded}
    onDestinationChange={onDestinationChange}
    onExpandedChange={setRailExpanded}
  />
  <div className="product-shell__workspace">
    {setup || context === undefined ? null : <WorkspaceGlobe status={context.status} />}
    {context === undefined ? null : <ContextBar context={context} />}
    <main className="product-shell__content">{children}</main>
  </div>
</div>
```

- [ ] **Step 4: Replace navigation/status strings with `UiIcon`**

Map destination IDs directly to `UiIconName`: `overview`, `research`, `branch`, `life-git`, `sources`. Add an icon-only rail toggle with `aria-expanded`, `aria-label`, and `<UiIcon name="rail-toggle" />`. In `ContextBar`, map pending/green/yellow/red to `status-pending`, `status-green`, `status-yellow`, and `status-red`; keep the visible status label unchanged.

- [ ] **Step 5: Implement the exact workspace geometry**

```css
.product-shell {
  min-height: 100svh;
  display: grid;
  grid-template-columns: 80px minmax(0, 1fr);
  background: #061014;
  transition: grid-template-columns 240ms cubic-bezier(0.2, 0.75, 0.2, 1);
}

.product-shell[data-rail-expanded="true"] {
  grid-template-columns: 240px minmax(0, 1fr);
}

.product-shell__workspace {
  position: relative;
  min-width: 0;
  min-height: 100svh;
  overflow: hidden;
  isolation: isolate;
}

.workspace-globe { position: absolute; inset: 0; z-index: 0; }
.context-bar, .product-shell__content { position: relative; z-index: 2; }
```

Hide the toggle and use the existing fixed five-column bottom navigation below `720px`. In `prefers-reduced-motion: reduce`, remove the grid transition.

- [ ] **Step 6: Run focused tests**

Run: `pnpm test -- tests/integration/product-shell.test.tsx tests/integration/visual-system.test.ts tests/integration/ui-icon.test.tsx`

Expected: PASS with visible labels only in expanded desktop state and unchanged accessible names when collapsed.

- [ ] **Step 7: Commit the rail**

```bash
git add src/experience/components/ProductShell.tsx src/experience/components/NavigationRail.tsx src/experience/components/ContextBar.tsx src/app/globals.css tests/integration/product-shell.test.tsx tests/integration/visual-system.test.ts
git commit -m "feat: add expandable workspace rail"
```

---

### Task 4: Replace the flat Research map with glass status panels

**Files:**
- Create: `src/experience/components/ResearchWorkspace.tsx`
- Delete: `src/experience/components/ResearchMap.tsx`
- Delete: `public/world-map.svg`
- Modify: `src/experience/components/Vs1Journey.tsx`
- Modify: `src/app/globals.css`
- Modify: `tests/integration/experience.test.tsx`
- Modify: `tests/integration/journey-actions.test.tsx`
- Modify: `tests/integration/visual-system.test.ts`

**Interfaces:**
- `ResearchWorkspace` preserves `ResearchCandidate`, `ResearchRunReference`, `ResearchRetryRecord`, and all current props from `ResearchMap`.
- `Vs1Journey` imports the renamed component and retry record type without changing retry data flow.
- Research renders only foreground panels; the globe remains owned by `ProductShell`.

- [ ] **Step 1: Rewrite Research tests around panels rather than a map illustration**

Replace map-specific expectations with:

```tsx
const research = screen.getByRole("region", { name: /проверка маршрута/i });
expect(research.getAttribute("data-tone")).toBe("gray");
expect(within(research).getByRole("region", { name: /ход проверки/i })).toBeTruthy();
expect(within(research).getByText(/Россия.*Тирана/i)).toBeTruthy();
expect(research.querySelector('img[src="/world-map.svg"]')).toBeNull();
expect(within(research).queryByRole("img", { name: /самолёт/i })).toBeNull();
```

Retain existing assertions for candidate count, yellow/red reason disclosure, official source URL, retry snapshot lineage, retry error, and green collapsed status.

- [ ] **Step 2: Run tests and verify the old illustration violates them**

Run: `pnpm test -- tests/integration/experience.test.tsx tests/integration/journey-actions.test.tsx`

Expected: FAIL because `ResearchMap` still renders `/world-map.svg` and the airplane glyph.

- [ ] **Step 3: Implement `ResearchWorkspace` with existing behavior**

Use this stable structure for non-green states:

```tsx
const statusIcon = {
  pending: "status-pending",
  green: "status-green",
  yellow: "status-yellow",
  red: "status-red",
} as const;

<section
  aria-label="Проверка маршрута"
  className={`research-workspace research-workspace--${mode}`}
  data-scope="single-candidate"
  data-tone={mode === "pending" ? "gray" : mode}
  role="region"
>
  <section className="orbit-panel research-workspace__candidate">
    <p className="orbit-panel__index">01 / МАРШРУТ</p>
    <ul aria-label="Кандидаты маршрута">
      {candidates.map((candidate) => (
        <li key={candidate.id}>
          <button
            aria-expanded={openCandidateId === candidate.id}
            onClick={() => reveal(candidate.id)}
            type="button"
          >
            <UiIcon name={statusIcon[candidate.status]} weight={candidate.status === "pending" ? "regular" : "duotone"} />
            <span>{candidate.origin} → {candidate.destination}</span>
            <span>{labels[candidate.status]}</span>
          </button>
          {openCandidateId === candidate.id && candidate.reason !== undefined ? (
            <div className="research-workspace__reason">
              <p>{candidate.reason.summary}</p>
              {candidate.reason.officialUrl === undefined ? null : (
                <a href={candidate.reason.officialUrl}>Официальный источник</a>
              )}
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  </section>
  {mode === "pending" ? (
    <aside aria-label="Ход проверки" className="orbit-panel research-workspace__progress">
      <h2>Ход проверки</h2>
      <ol>
        <li>Профиль подтверждён</li>
        <li aria-current="step">Официальные источники проверяются</li>
        <li>Снимок доказательств ожидает завершения проверки</li>
      </ol>
      <p>Текущий источник: официальный контур Россия → Тирана</p>
    </aside>
  ) : null}
  {showRetry ? (
    <section className="orbit-panel research-workspace__retry">
      {previousSnapshotId === undefined ? null : <p>Предыдущий снимок: {previousSnapshotId}</p>}
      {mode === "yellow" && previousRun !== undefined && onRetry !== undefined ? (
        <button onClick={retry} type="button">
          <UiIcon name="retry" />
          Проверить ещё раз
        </button>
      ) : null}
      {retryRecord === undefined ? null : (
        <div aria-live="polite">
          <p>Новый запуск: {retryRecord.next.runId}</p>
          <p>Новый снимок: {retryRecord.next.evidenceSnapshotId}</p>
        </div>
      )}
      {retryError === undefined ? null : <p role="alert">{retryError}</p>}
    </section>
  ) : null}
</section>
```

Use `UiIcon` for status, disclosure, and retry actions. Do not render a map image, airplane glyph, second canvas, or decorative route line.

- [ ] **Step 4: Rewire `Vs1Journey` without changing retry semantics**

Rename imports and JSX from `ResearchMap` to `ResearchWorkspace`; keep the existing `previous`, `next`, `replaceRunUrl`, pending transition, error handling, and post-retry destination selection byte-for-byte equivalent.

- [ ] **Step 5: Remove obsolete map assets and CSS**

Delete `public/world-map.svg` and every `.research-map__canvas`, `__art`, `__airplane`, `route-arrival`, marker-position, tablet map-grid, and mobile map-height rule. Add absolute/in-flow responsive placement for `research-workspace__candidate`, `__progress`, and `__retry` using the same borderless translucent `.orbit-panel` surface.

- [ ] **Step 6: Run focused tests**

Run: `pnpm test -- tests/integration/experience.test.tsx tests/integration/journey-actions.test.tsx tests/integration/visual-system.test.ts`

Expected: PASS, including yellow initial Research, pending retry, green completion, official-link disclosure, and snapshot lineage.

- [ ] **Step 7: Commit the Research workspace**

```bash
git add src/experience/components/ResearchWorkspace.tsx src/experience/components/ResearchMap.tsx src/experience/components/Vs1Journey.tsx public/world-map.svg src/app/globals.css tests/integration/experience.test.tsx tests/integration/journey-actions.test.tsx tests/integration/visual-system.test.ts
git commit -m "refactor: replace flat research map"
```

---

### Task 5: Replace panel glyphs and remove obsolete globe CSS

**Files:**
- Modify: `src/experience/components/OrbitPanels.tsx`
- Modify: `src/app/globals.css`
- Modify: `tests/integration/orbit-command-center.test.tsx`
- Modify: `tests/integration/visual-system.test.ts`

**Interfaces:**
- `OrbitPanels` uses `UiIcon` for route status, external action, profile disclosure, medicine, sea, income, and destination status.
- The shared globe uses only `.workspace-globe` selectors; `.orbit-globe*` selectors no longer exist.

- [ ] **Step 1: Add failing legacy-glyph and cleanup tests**

```tsx
const { container } = render(<DestinationDetailPanel marker="yellow" />);
expect(container.querySelector('[data-icon="medical"]')).toBeTruthy();
expect(container.querySelector('[data-icon="sea"]')).toBeTruthy();
expect(container.querySelector('[data-icon="income"]')).toBeTruthy();
expect(container.textContent).not.toMatch(/[✚≈↗●]/u);
```

In `visual-system.test.ts`, assert `css` does not contain `.orbit-globe`, `globe-arrival`, `.research-map__art`, `.research-map__airplane`, or `route-arrival`.

- [ ] **Step 2: Run tests and verify the glyph/CSS failures**

Run: `pnpm test -- tests/integration/orbit-command-center.test.tsx tests/integration/visual-system.test.ts`

Expected: FAIL on the current Unicode traits and obsolete square-globe CSS.

- [ ] **Step 3: Replace all panel glyphs with `UiIcon`**

Use this fixed trait map:

```tsx
const traits = [
  { icon: "medical", label: "Медицина" },
  { icon: "sea", label: "Море" },
  { icon: "income", label: "Доходы" },
] as const;
```

Replace route `↗` with `external`, profile `+ / −` with `expand / collapse`, and status `●` with `status-green`, `status-yellow`, or `status-red`. Preserve all visible labels and button accessible names.

- [ ] **Step 4: Delete obsolete globe and animation selectors**

Remove `.orbit-globe`, `.orbit-globe::before`, `.orbit-globe__engine`, `.orbit-globe__caption`, `.orbit-globe__status*`, `@keyframes globe-arrival`, their tablet/mobile overrides, and the old square viewport contract. Keep only `.workspace-globe`, `.workspace-globe__engine`, `.workspace-globe__fallback`, and `.workspace-globe__loading` rules required by the full workspace layer.

- [ ] **Step 5: Verify glass and responsive composition**

Keep `.orbit-panel { border: 0; backdrop-filter: blur(24px) saturate(135%); }`. Ensure Overview and Research foreground panels have nonzero insets, the right destination panel never touches the viewport edge, and mobile panels enter normal document flow above the bottom navigation.

- [ ] **Step 6: Run focused and full automated verification**

Run: `pnpm test -- tests/integration/orbit-command-center.test.tsx tests/integration/visual-system.test.ts`

Expected: PASS.

Run: `pnpm test && pnpm typecheck && pnpm lint && pnpm build`

Expected: all tests pass, TypeScript and ESLint report no errors, and the production build completes.

- [ ] **Step 7: Commit UI cleanup**

```bash
git add src/experience/components/OrbitPanels.tsx src/app/globals.css tests/integration/orbit-command-center.test.tsx tests/integration/visual-system.test.ts
git commit -m "refactor: unify command center visuals"
```

---

### Task 6: Validate fresh-browser behavior and hand off

**Files:**
- Modify only if QA exposes a reproducible defect in the files already listed above.

**Interfaces:**
- Consumes the complete shell, globe, rail, Research, and icon contracts from Tasks 1–5.
- Produces an evidence-backed handoff; no push, PR, or merge is part of this task.

- [ ] **Step 1: Check repository scope before QA**

Run: `git status --short && git diff --stat main...HEAD`

Expected: user-owned `.pnpm-store/` and `.superpowers/brainstorm/` remain untracked and unstaged; feature files are the only intentional changes.

- [ ] **Step 2: Start or reuse the local application**

Run: `pnpm dev`

Expected: Next.js serves the app without compile errors.

- [ ] **Step 3: Request explicit browser permission**

Before browser automation, tell the user the exact QA scope—fresh URL, rail expansion, Overview/Research globe persistence, mobile navigation, and console—and wait for explicit permission as required by `AGENTS.md`.

- [ ] **Step 4: Perform desktop browser QA after permission**

Open a fresh `?run=<valid-run-id>` URL. Verify:

- yellow runs open Research with the 3D Earth visible;
- switching Research → Overview does not blank or duplicate the Earth;
- collapsed rail leaves an `80px` column and expanded rail leaves `240px`;
- the Earth canvas resizes left/right with the workspace;
- panels visibly blur the Earth and have no outlines;
- all navigation and trait icons share Phosphor geometry;
- console contains no WebGL, hydration, asset 404, or React errors.

- [ ] **Step 5: Perform responsive and fallback QA**

At tablet and mobile widths, verify panels enter readable flow, the bottom navigation remains usable, and no rail toggle appears. Disable WebGL or force the unavailable seam and verify the retry button is visible without crashing foreground workspaces.

- [ ] **Step 6: Re-run the full verification after any QA fix**

Run: `pnpm test && pnpm typecheck && pnpm lint && pnpm build`

Expected: all commands pass after the final code state.

- [ ] **Step 7: Report completion without merging or pushing**

Report the exact test/build results, the chosen Phosphor package/version, the removed flat-map asset, and any browser-specific finding. Leave review, push, PR creation, and merge to a separately authorized action.
