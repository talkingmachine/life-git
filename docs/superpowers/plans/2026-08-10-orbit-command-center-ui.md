# Orbit Command Center UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the post-run overview with the approved Orbit UI: a collapsed icon rail, a central local SVG globe, and borderless translucent working panels for the route, profile, and selected destination.

**Architecture:** Preserve the existing `Vs1Journey` state machine and immutable domain snapshots. Add small presentation-only components under `src/experience/components`, compose them from `OverviewWorkspace`, and keep every displayed value sourced from `RunDetails`/`JourneyView`; unsupported city qualities remain visibly unknown rather than becoming invented facts.

**Tech Stack:** Next.js 16.3, React 19, TypeScript 6, CSS, Vitest 4, Testing Library.

## Global Constraints

- Keep the existing fixed VS-1 route `Россия → Тирана`; do not imply a multi-city search or global ranking.
- Keep confirmed profile snapshots immutable; the compact profile may expand, but editing requires a future profile-revision use case.
- Use a local SVG/CSS globe with no map SDK, remote image, or new runtime dependency.
- Navigation is icon-only visually but retains exact accessible Russian names.
- Floating cards use visible backdrop blur, translucent fills, rounded corners, and shadows; they have no decorative borders.
- Statuses retain icon plus text and never rely on color alone.
- Preserve keyboard access, 44px targets, `prefers-reduced-motion`, and current retry/branch actions.

---

### Task 1: Orbit globe and accessible collapsed navigation

**Files:**
- Create: `src/experience/components/OrbitGlobe.tsx`
- Modify: `src/experience/components/NavigationRail.tsx`
- Modify: `tests/integration/product-shell.test.tsx`
- Create: `tests/integration/orbit-command-center.test.tsx`

**Interfaces:**
- Produces: `OrbitGlobe({ origin, destination, status }: { origin: string; destination: string; status: CommandCenterStatus })`.
- Preserves: `NavigationRailProps` and `CommandCenterDestination` unchanged.

- [ ] **Step 1: Write failing globe and navigation tests.**

```tsx
render(<OrbitGlobe origin="Россия" destination="Тирана" status="green" />);
expect(screen.getByRole("img", { name: /глобус маршрута россия.*тирана/i })).toBeTruthy();
expect(screen.getByText("Россия → Тирана")).toBeTruthy();

const navigation = screen.getByRole("navigation", { name: /основная навигация/i });
for (const control of within(navigation).getAllByRole("button")) {
  expect(control.getAttribute("aria-label")?.trim().length).toBeGreaterThan(0);
  expect(control.querySelector(".navigation-rail__label")?.classList.contains("visually-hidden")).toBe(true);
}
```

- [ ] **Step 2: Run the tests and verify RED.**

Run: `pnpm vitest run tests/integration/orbit-command-center.test.tsx tests/integration/product-shell.test.tsx`

Expected: FAIL because `OrbitGlobe` does not exist and navigation labels are not visually collapsed.

- [ ] **Step 3: Implement the local SVG globe.**

Render one labelled `figure`, an `svg` sphere with decorative continent paths, a route arc, origin/destination pins, and a text route label. Give decorative SVG children `aria-hidden="true"`; the `figure` owns the accessible name.

- [ ] **Step 4: Collapse navigation labels without losing names.**

Set every destination button's `aria-label` to `destination.label` and add `visually-hidden` to the existing text span. Do not remove the text from the DOM.

- [ ] **Step 5: Run the two tests and verify GREEN.**

Run: `pnpm vitest run tests/integration/orbit-command-center.test.tsx tests/integration/product-shell.test.tsx`

Expected: PASS.

### Task 2: Floating overview components

**Files:**
- Create: `src/experience/components/RouteCandidatePanel.tsx`
- Create: `src/experience/components/CompactProfilePanel.tsx`
- Create: `src/experience/components/DestinationDetailPanel.tsx`
- Modify: `src/experience/components/OverviewWorkspace.tsx`
- Modify: `src/experience/components/Vs1Journey.tsx`
- Modify: `tests/integration/orbit-command-center.test.tsx`
- Modify: `tests/integration/experience.test.tsx`

**Interfaces:**
- `RouteCandidatePanel({ marker, officialFacts, unresolvedItems, onOpenResearch })` renders the single scoped candidate.
- `CompactProfilePanel({ profile })` renders a native `details` disclosure using `ProfileCardData`.
- `DestinationDetailPanel({ marker, officialFacts, unresolvedItems, branchLabel, knownResidualAll, onOpenBranch })` renders only current view-model values and explicit unknown traits.
- `OverviewWorkspaceProps` gains `profile: ProfileCardData`; other props remain unchanged.

- [ ] **Step 1: Add failing composition tests.**

```tsx
expect(screen.getByRole("region", { name: /кандидат маршрута/i })).toBeTruthy();
expect(screen.getByText("Тирана")).toBeTruthy();
expect(screen.getByRole("group", { name: /подтверждённый профиль/i })).toBeTruthy();
expect(screen.getByRole("complementary", { name: /подробно о тиране/i })).toBeTruthy();
expect(screen.getAllByText(/не исследовано/i).length).toBeGreaterThan(0);
```

- [ ] **Step 2: Run the composition tests and verify RED.**

Run: `pnpm vitest run tests/integration/orbit-command-center.test.tsx tests/integration/experience.test.tsx`

Expected: FAIL because the floating overview components are absent.

- [ ] **Step 3: Implement the single-candidate and compact-profile panels.**

Keep the candidate copy scoped to VS-1. The profile disclosure shows housing, income basis, income, resources, continuation, lawful-stay condition, and companion mode from `ProfileCardData`; it does not offer mutation.

- [ ] **Step 4: Implement the destination detail panel.**

Show marker text, evidence counts, branch label, optional known residual, and traits. Unsupported medicine/sea/income-level traits must render `Не исследовано`, not synthetic ratings.

- [ ] **Step 5: Recompose `OverviewWorkspace`.**

Use this DOM order for accessibility: heading/context, candidate panel, globe, compact profile, destination details. CSS positioning may visually layer them. Pass `view.profile` from `Vs1Journey`.

- [ ] **Step 6: Run the two tests and verify GREEN.**

Run: `pnpm vitest run tests/integration/orbit-command-center.test.tsx tests/integration/experience.test.tsx`

Expected: PASS.

### Task 3: Orbit visual tokens and responsive layout

**Files:**
- Modify: `src/app/globals.css`
- Modify: `tests/integration/visual-system.test.ts`

**Interfaces:**
- Produces CSS tokens `--orbit-accent`, `--glass-working`, `--glass-focus`, `--glass-blur-working`, `--glass-blur-focus`, and `--shadow-orbit`.
- Produces reusable classes `.orbit-panel`, `.orbit-panel--focus`, and `.visually-hidden`.

- [ ] **Step 1: Write failing visual-contract tests.**

```ts
expect(declaration(rule(css, ".navigation-rail"), "width")).toBe("68px");
expect(declaration(rule(css, ".orbit-panel"), "border")).toBe("0");
expect(declaration(rule(css, ".orbit-panel"), "backdrop-filter")).toContain("blur(");
expect(declaration(rule(css, ".orbit-command-center"), "position")).toBe("relative");
expect(css).toContain("@media (prefers-reduced-motion: reduce)");
```

- [ ] **Step 2: Run the visual test and verify RED.**

Run: `pnpm vitest run tests/integration/visual-system.test.ts`

Expected: FAIL because Orbit tokens/classes do not exist.

- [ ] **Step 3: Add the Orbit tokens and borderless glass surfaces.**

Use cobalt `#5364ff`, working surface `rgba(247, 250, 251, 0.36)`, focus surface `rgba(255, 255, 255, 0.52)`, blur values `24px`/`38px`, and no card border. Controls may retain borders.

- [ ] **Step 4: Implement desktop composition and responsive fallbacks.**

Desktop: 68px floating rail, candidate top-left, globe center, compact profile bottom-left, destination panel right. Tablet/mobile: panels become normal document-flow regions; navigation becomes the existing bottom bar and the globe remains labelled and visible.

- [ ] **Step 5: Run visual and component tests and verify GREEN.**

Run: `pnpm vitest run tests/integration/visual-system.test.ts tests/integration/orbit-command-center.test.tsx tests/integration/product-shell.test.tsx`

Expected: PASS.

### Task 4: Repository verification

**Files:**
- Modify only files required by failures attributable to Tasks 1–3.

**Interfaces:**
- Produces a verified build with no domain/application behavior changes.

- [ ] **Step 1: Run all four project checks.**

Run:

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

Expected: all commands exit `0` with no test failures.

- [ ] **Step 2: Review the final diff against `main`.**

Run: `git diff --check && git diff --stat main...HEAD && git status --short`

Expected: no whitespace errors; only Orbit UI source, tests, styles, and this plan are changed.
