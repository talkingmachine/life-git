# Calm Command Center Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current long-form VS-1 interface with the approved responsive Calm Command Center product shell while preserving every existing domain rule and server action.

**Architecture:** Keep `Vs1Start` and `Vs1Journey` as action-owning client coordinators, but move layout and navigation into focused experience components. Extend the pure view-model layer with summary and evidence-grouping data so presentation components remain deterministic and infrastructure-free. Use local SVG/CSS only and preserve the application contracts, immutable snapshot behavior, and action signatures.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 6, CSS, Vitest 4, Testing Library, Open Design product prototype.

## Global Constraints

- The first release is light-only.
- The interface is a cross-platform product shell backed only by the existing VS-1 journey.
- Preserve `startConfirmedLife`, `retryConfirmedLifeRun`, `saveInitialHousingBranch`, `rewindHousingBranch`, and `forkHousingBranch` signatures and domain behavior.
- Navigation and evidence filters never mutate a run, snapshot, or branch.
- Green, yellow, and red are reserved for verification states and always paired with an icon and text.
- Control feedback lasts 140–180 ms, section entrances 180–220 ms, and major transitions no more than 260 ms.
- Respect `prefers-reduced-motion: reduce` and exclude continuous decorative animation.
- Do not add a map SDK, remote visual dependency, authentication, billing, subscription logic, or unsupported navigation.
- Experience components consume serializable application data and server actions only; they never read SQLite, source adapters, or raw infrastructure.
- Existing official-source links retain `rel="noreferrer noopener"` and `target="_blank"` where already required.

---

### Task 1: Generate and capture the approved Open Design reference

**Files:**
- Reference: `docs/superpowers/specs/2026-08-10-life-branches-calm-command-center-design.md`
- Reference: `src/experience/components/Vs1Start.tsx`
- Reference: `src/experience/components/Vs1Journey.tsx`
- Reference: `src/app/globals.css`

**Interfaces:**
- Consumes: confirmed Open Design brief `cross-platform + product-shell + conceptual` and Calm Command Center specification.
- Produces: one terminal Open Design Preview/Studio reference for the approved visual direction; no repository source contract.

- [ ] **Step 1: Check the selected Open Design execution mode and authenticated runtime**

Use Open Design Cloud, the default confirmed mode. Carry the existing plugin workflow identifier through login status, agent discovery, project selection, generation, and polling. Do not switch to Local Codex or secure BYOK without explicit user confirmation.

- [ ] **Step 2: Select or create a dedicated Open Design project**

Use a project named `Life Branches Calm Command Center`. Do not overwrite an unrelated active project.

- [ ] **Step 3: Start exactly one generation**

Use one stable request identifier and a prompt containing:

```text
Redesign the existing Life Branches VS-1 relocation simulator as the approved Calm Command Center.
Create a cross-platform light-theme product shell for a premium data-rich subscription experience.
Include scenario setup, overview, research map, branch budget, Life Git C0→C1 comparison, and a
six-class Evidence Passport. Use deep ink/navy, warm off-white, white surfaces, restrained blue,
semantic green/yellow/red, modern sans typography, tabular metrics, moderate radii, minimal shadows,
and soft fast motion. Preserve honest uncertainty and never present an evidence percentage or score
that the source data cannot justify. Avoid glassmorphism, decorative gradients, dead navigation,
remote map SDKs, dark theme, billing, and authentication.
```

- [ ] **Step 4: Poll the same run to a terminal state**

Poll every 30–60 seconds without restarting generation. Open the exact Studio URL once if the run returns it and browser permission remains valid for this Open Design delivery; otherwise return the exact terminal Preview/Studio link.

- [ ] **Step 5: Record implementation observations in the plan execution notes**

Capture only concrete layout, spacing, component, and motion decisions that remain consistent with the approved specification. Do not import generated domain behavior or unsupported navigation.

### Task 2: Add pure command-center presentation data

**Files:**
- Modify: `src/experience/view-model.ts`
- Test: `tests/integration/experience.test.tsx`

**Interfaces:**
- Consumes: `RunDetails`, `EvidenceReadItem`, existing `createJourneyView(details)`.
- Produces: `CommandCenterSummary`, `EvidenceClassName`, `groupEvidenceItems(items)`, and new `summary` data returned by `createJourneyView`.

- [ ] **Step 1: Write failing summary and evidence-grouping tests**

Add cases to `tests/integration/experience.test.tsx` that use the existing `RunDetails` fixtures and assert:

```tsx
const view = createJourneyView(details);
expect(view.summary).toEqual({
  branchLabel: "До фиксации C0",
  officialFacts: 1,
  unresolvedItems: 1,
  unknowns: 1,
  knownResidualAll: undefined,
});

const grouped = groupEvidenceItems(details.evidenceItems);
expect(grouped.official_fact).toHaveLength(1);
expect(grouped.unknown).toHaveLength(1);
expect(Object.keys(grouped)).toEqual([
  "official_fact",
  "user_fact",
  "calculation",
  "assumption",
  "projection",
  "unknown",
]);
```

Add branch fixtures asserting `branchLabel` is `C0` at the initial cursor, `C1` after a fork, and `knownResidualAll` equals the server-returned budget value.

- [ ] **Step 2: Run the focused test and verify failure**

Run: `pnpm vitest run tests/integration/experience.test.tsx`

Expected: FAIL because `groupEvidenceItems` and `view.summary` do not exist.

- [ ] **Step 3: Implement exact presentation types and pure helpers**

Add:

```ts
export const EVIDENCE_CLASS_NAMES = [
  "official_fact",
  "user_fact",
  "calculation",
  "assumption",
  "projection",
  "unknown",
] as const;

export type EvidenceClassName = typeof EVIDENCE_CLASS_NAMES[number];

export interface CommandCenterSummary {
  readonly branchLabel: "До фиксации C0" | "C0" | "C1";
  readonly officialFacts: number;
  readonly unresolvedItems: number;
  readonly unknowns: number;
  readonly knownResidualAll?: string;
}

export function groupEvidenceItems(items: readonly EvidenceReadItem[]):
  Readonly<Record<EvidenceClassName, readonly EvidenceReadItem[]>>;
```

`unresolvedItems` counts `unknown` items only; it is not a fabricated completeness score. Derive the branch label by comparing `branchCursor?.commitId` with `initialBranchCursor?.commitId` and checking whether a `branchDiff` exists.

- [ ] **Step 4: Run focused tests and verify pass**

Run: `pnpm vitest run tests/integration/experience.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit the pure presentation model**

```bash
git add src/experience/view-model.ts tests/integration/experience.test.tsx
git commit -m "feat: add command center view model"
```

### Task 3: Build the responsive product shell

**Files:**
- Create: `src/experience/components/ProductShell.tsx`
- Create: `src/experience/components/NavigationRail.tsx`
- Create: `src/experience/components/ContextBar.tsx`
- Test: `tests/integration/product-shell.test.tsx`

**Interfaces:**
- Consumes: `ReactNode`, `CommandCenterDestination`, optional route/branch/snapshot/status context.
- Produces: `ProductShell`, `NavigationRail`, `ContextBar`, and `CommandCenterDestination`.

- [ ] **Step 1: Write failing shell navigation tests**

Create `tests/integration/product-shell.test.tsx` with jsdom and assert:

```tsx
render(
  <ProductShell
    activeDestination="overview"
    context={{ route: "Россия → Тирана", branch: "C0", snapshot: "06.08.2026", status: "green" }}
    onDestinationChange={change}
  >
    <p>Workspace content</p>
  </ProductShell>,
);

expect(screen.getByRole("navigation", { name: /основная навигация/i })).toBeTruthy();
expect(screen.getByRole("button", { name: /обзор/i }).getAttribute("aria-current")).toBe("page");
fireEvent.click(screen.getByRole("button", { name: /источники/i }));
expect(change).toHaveBeenCalledWith("sources");
expect(screen.getByText("Россия → Тирана")).toBeTruthy();
expect(screen.getByText(/C0/)).toBeTruthy();
expect(screen.getAllByText(/подтверждено/i).length).toBeGreaterThan(0);
```

Assert the destination list contains exactly `overview`, `research`, `branch`, `life-git`, and `sources`; each control has a text label and icon hidden from assistive technology.

- [ ] **Step 2: Run shell tests and verify failure**

Run: `pnpm vitest run tests/integration/product-shell.test.tsx`

Expected: FAIL because the shell components do not exist.

- [ ] **Step 3: Implement the shell contract**

Define:

```ts
export type CommandCenterDestination =
  | "overview"
  | "research"
  | "branch"
  | "life-git"
  | "sources";

interface ProductShellProps {
  readonly activeDestination: CommandCenterDestination;
  readonly children: ReactNode;
  readonly context?: {
    readonly route: string;
    readonly branch: string;
    readonly snapshot: string;
    readonly status: "pending" | "green" | "yellow" | "red";
  };
  readonly onDestinationChange: (destination: CommandCenterDestination) => void;
  readonly setup?: boolean;
}
```

Use native buttons for destination changes. Render the same controls as a desktop rail and mobile bottom bar through CSS, but keep one accessible navigation landmark by hiding the inactive representation with responsive `display` rules and `aria-hidden` only when necessary.

- [ ] **Step 4: Implement ContextBar semantics**

Render route, branch, snapshot date, and a status badge whose icon and Russian label are:

```ts
pending: ["…", "Идёт проверка"]
green: ["✓", "Подтверждено в scope"]
yellow: ["!", "Нужно уточнить"]
red: ["×", "Не подходит"]
```

- [ ] **Step 5: Run shell tests and verify pass**

Run: `pnpm vitest run tests/integration/product-shell.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit the product shell**

```bash
git add src/experience/components/ProductShell.tsx src/experience/components/NavigationRail.tsx src/experience/components/ContextBar.tsx tests/integration/product-shell.test.tsx
git commit -m "feat: add responsive product shell"
```

### Task 4: Redesign scenario setup inside the shell

**Files:**
- Create: `src/experience/components/ScenarioSummary.tsx`
- Modify: `src/experience/components/Vs1Start.tsx`
- Test: `tests/integration/journey-actions.test.tsx`

**Interfaces:**
- Consumes: existing `ProfileDraft`, `startConfirmedLife`, `replaceRunUrl`, `ProductShell`.
- Produces: grouped scenario setup UI and `ScenarioSummary` with no new application action.

- [ ] **Step 1: Extend setup tests with shell and review expectations**

Add assertions before submission:

```tsx
expect(screen.getByRole("heading", { name: /настройте сценарий/i })).toBeTruthy();
expect(screen.getByRole("group", { name: /ресурсы/i })).toBeTruthy();
expect(screen.getByRole("group", { name: /занятость/i })).toBeTruthy();
expect(screen.getByRole("group", { name: /состав переезда/i })).toBeTruthy();
expect(screen.getByRole("region", { name: /резюме сценария/i })).toBeTruthy();
expect(screen.getByRole("button", { name: /начать проверку/i })).toBeDisabled();
```

Keep the current tests that confirmation resets after profile or housing edits and that the action receives the exact draft.

- [ ] **Step 2: Run focused setup tests and verify failure**

Run: `pnpm vitest run tests/integration/journey-actions.test.tsx -t "confirmed-life start|fresh snapshot"`

Expected: FAIL because the grouped shell and summary do not exist.

- [ ] **Step 3: Extract the read-only ScenarioSummary**

Give it:

```ts
interface ScenarioSummaryProps {
  readonly draft: ProfileDraft;
  readonly housingAll: string;
}
```

Render route scope, formatted resource values, income basis, companion route, and the count of accepted scenario conditions. Label all values as user inputs or scenario conditions, never official facts.

- [ ] **Step 4: Recompose Vs1Start without changing submission behavior**

Keep `INITIAL_PROFILE`, `changeDraft`, `setCondition`, and `submit` semantics. Wrap the form and summary in the setup variant of `ProductShell`. Split the form into three fieldsets plus a final review card. During the existing async pending state, keep the shell visible and show `ResearchMap` in the research workspace.

- [ ] **Step 5: Run setup and action tests**

Run: `pnpm vitest run tests/integration/journey-actions.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit scenario setup**

```bash
git add src/experience/components/ScenarioSummary.tsx src/experience/components/Vs1Start.tsx tests/integration/journey-actions.test.tsx
git commit -m "feat: redesign scenario setup"
```

### Task 5: Recompose the journey as five workspaces

**Files:**
- Create: `src/experience/components/OverviewWorkspace.tsx`
- Create: `src/experience/components/BranchWorkspace.tsx`
- Create: `src/experience/components/LifeGitWorkspace.tsx`
- Create: `src/experience/components/SourcesWorkspace.tsx`
- Modify: `src/experience/components/Vs1Journey.tsx`
- Modify: `src/experience/components/ProfileCard.tsx`
- Modify: `src/experience/components/LifeBranch.tsx`
- Modify: `src/experience/components/LifeGitDiff.tsx`
- Modify: `src/experience/components/EvidencePassport.tsx`
- Test: `tests/integration/experience.test.tsx`
- Test: `tests/integration/journey-actions.test.tsx`

**Interfaces:**
- Consumes: `ProductShell`, `createJourneyView`, existing server actions and cursor logic.
- Produces: five navigable workspaces while `Vs1Journey` remains the sole action/state coordinator.

- [ ] **Step 1: Write failing workspace navigation tests**

Render `Vs1Journey` with a green C0 fixture. Assert Overview initially shows the narrative and summary metrics, then:

```tsx
fireEvent.click(screen.getByRole("button", { name: /моя ветвь/i }));
expect(screen.getByRole("heading", { name: /подтверждённый снимок/i })).toBeTruthy();
expect(screen.getByRole("figure", { name: /поток бюджета/i })).toBeTruthy();

fireEvent.click(screen.getByRole("button", { name: /Life Git/i }));
expect(screen.getByRole("heading", { name: /ветка жилья/i })).toBeTruthy();

fireEvent.click(screen.getByRole("button", { name: /источники/i }));
expect(screen.getByRole("heading", { name: /паспорт доказательств/i })).toBeTruthy();
```

Assert a yellow fixture opens Research initially so the reason and retry remain visible.

- [ ] **Step 2: Run journey tests and verify failure**

Run: `pnpm vitest run tests/integration/experience.test.tsx tests/integration/journey-actions.test.tsx`

Expected: FAIL because workspace navigation is not implemented.

- [ ] **Step 3: Implement OverviewWorkspace**

Render the bounded narrative, route scope, `knownResidualAll` when present, official fact count, unresolved count, and one next-action button. The next action maps to a real destination only:

```ts
yellow | red -> research
green without C0 -> branch
green with C0 and no diff -> life-git
green with diff -> life-git
```

Do not display a percentage or fabricated compatibility score.

- [ ] **Step 4: Implement BranchWorkspace and LifeGitWorkspace**

Move existing `ProfileCard`, `LifeBranch`, branch controls, and `LifeGitDiff` markup into focused containers. Keep action closures in `Vs1Journey`; pass callbacks and pending flags down. Preserve the `branchActionInFlight` guard and initial-details rewind behavior byte-for-byte where possible.

- [ ] **Step 5: Implement SourcesWorkspace filters**

Use `groupEvidenceItems`. Provide six native filter buttons with `aria-pressed`. The initial filter is `official_fact`; an `Все классы` control resets filtering. Keep the existing readable/technical distinction and official-source grouping.

- [ ] **Step 6: Recompose Vs1Journey**

Add:

```ts
const [destination, setDestination] = useState<CommandCenterDestination>(
  details.run.assessment.marker === "green" ? "overview" : "research",
);
```

When retry returns a terminal result, select `overview` for green and `research` otherwise. When C0 or C1 completes, retain the destination that initiated the action. Render only the active workspace inside `ProductShell`, but preserve current action state and error messages.

- [ ] **Step 7: Run all experience and action tests**

Run: `pnpm vitest run tests/integration/experience.test.tsx tests/integration/journey-actions.test.tsx tests/integration/product-shell.test.tsx`

Expected: PASS.

- [ ] **Step 8: Commit workspace composition**

```bash
git add src/experience/components src/experience/view-model.ts tests/integration/experience.test.tsx tests/integration/journey-actions.test.tsx tests/integration/product-shell.test.tsx
git commit -m "feat: compose command center workspaces"
```

### Task 6: Implement the light visual system and motion

**Files:**
- Modify: `src/app/globals.css`
- Modify: `src/app/layout.tsx`
- Modify: `public/world-map.svg`
- Test: `tests/integration/product-shell.test.tsx`
- Test: `tests/integration/experience.test.tsx`

**Interfaces:**
- Consumes: semantic class names emitted by Tasks 3–5.
- Produces: responsive desktop/tablet/mobile layouts, light design tokens, motion tokens, and reduced-motion behavior.

- [ ] **Step 1: Add structural accessibility assertions before styling**

Assert the shell renders one visible main region, navigation buttons retain readable labels, status badges contain text, and evidence filters expose `aria-pressed`. Keep existing status-icon and official-link assertions.

- [ ] **Step 2: Replace global tokens and base styles**

Define at minimum:

```css
:root {
  color-scheme: light;
  --canvas: #f4f5f2;
  --surface: #ffffff;
  --surface-subtle: #eef1ef;
  --ink: #17212b;
  --ink-muted: #66727c;
  --line: #dfe4e7;
  --accent: #2457d6;
  --success: #227451;
  --warning: #9a6500;
  --danger: #a23d35;
  --radius-sm: 12px;
  --radius-md: 18px;
  --radius-lg: 24px;
  --motion-fast: 160ms;
  --motion-section: 210ms;
  --motion-major: 260ms;
}
```

Use system sans fallbacks, `font-variant-numeric: tabular-nums` for metrics, thin borders, and restrained shadows.

- [ ] **Step 3: Add responsive shell layout**

Use a fixed-width desktop rail above `1100px`, a compact rail/tablet layout between `720px` and `1099px`, and bottom navigation below `720px`. Ensure content has bottom padding equal to the mobile navigation height and all touch targets are at least 44px.

- [ ] **Step 4: Add bounded motion and reduced-motion override**

Use opacity/transform transitions and named keyframes only for finite entrances or the pending route indicator. Add:

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    scroll-behavior: auto !important;
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

- [ ] **Step 5: Refine the local map asset**

Keep the SVG local and decorative where appropriate. Adjust fills and route styling to the calm light palette without adding external resources or status meaning that is absent from the HTML labels.

- [ ] **Step 6: Run focused UI tests**

Run: `pnpm vitest run tests/integration/product-shell.test.tsx tests/integration/experience.test.tsx tests/integration/journey-actions.test.tsx`

Expected: PASS.

- [ ] **Step 7: Commit the visual system**

```bash
git add src/app/globals.css src/app/layout.tsx public/world-map.svg tests/integration/product-shell.test.tsx tests/integration/experience.test.tsx
git commit -m "feat: apply calm command center visual system"
```

### Task 7: Full verification and visual QA

**Files:**
- Modify if findings require it: `src/experience/components/*.tsx`
- Modify if findings require it: `src/app/globals.css`
- Modify if findings require it: `tests/integration/*.test.tsx`
- Reference: `evals/visual-truth.md`

**Interfaces:**
- Consumes: completed redesign.
- Produces: verified build and documented handoff; no new product behavior.

- [ ] **Step 1: Run the complete automated suite**

Run:

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

Expected: all commands exit 0 with no test failures, TypeScript errors, lint errors, or build errors.

- [ ] **Step 2: Start the local app for visual inspection**

Run: `pnpm dev`

Use the configured local port. Do not open a browser unless the user has explicitly permitted that specific visual-QA browser use under the repository instructions.

- [ ] **Step 3: Check responsive layouts**

At approximately 390px, 768px, and 1440px widths, verify:

- setup fields and review remain readable;
- navigation changes representation without duplicate visible landmarks;
- metric cards do not overflow;
- C0/C1 comparison preserves labels;
- Evidence Passport technical content is bounded;
- mobile content is not obscured by bottom navigation.

- [ ] **Step 4: Check interaction and motion semantics**

Verify keyboard navigation, focus visibility, Enter/Space on yellow/red reasons, retry pending state, C0 duplicate prevention, rewind, fork, evidence filters, finite motion, and reduced-motion behavior.

- [ ] **Step 5: Run the visual-truth rubric**

Use `evals/visual-truth.md` to confirm the one-candidate scope, map transition, icon-plus-text statuses, unknowns, official links, six evidence classes, and causal housing diff can be understood without oral correction.

- [ ] **Step 6: Re-run the complete automated suite after visual fixes**

Run the same four commands from Step 1 and require all exit codes to be 0.

- [ ] **Step 7: Commit verification fixes if any**

```bash
git add src/experience/components src/app/globals.css tests/integration
git commit -m "fix: polish command center experience"
```
