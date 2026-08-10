# Life Branches: Calm Command Center redesign

**Status:** approved concept, pending written-spec review

**Date:** 2026-08-10

**Scope:** complete light-theme redesign of the existing VS-1 experience

**Visual direction:** Calm Command Center

## 1. Purpose

The redesign must make Life Branches feel like a premium decision-intelligence product without
turning it into a dense analytics dashboard. The interface should help a user inspect a large
amount of evidence, assumptions, calculations, and branch history while retaining curiosity and
control.

The product remains an evidence-backed relocation simulator. It does not recommend a decision,
hide uncertainty, or claim a precise future. The visual system must reinforce the distinction
between official facts, user facts, calculations, assumptions, projections, and unknowns.

## 2. Confirmed direction

The chosen direction is **Calm Command Center**:

- a cross-platform product shell rather than a single long page;
- a light, calm, data-rich interface for a premium subscription segment;
- strict information hierarchy, restrained surfaces, and generous section spacing;
- fast, soft motion that explains state changes rather than decorating them;
- production-minded responsive behavior, even though the first implementation contains the
  existing VS-1 journey only.

Two alternatives were rejected as the primary direction:

- **Living Atlas** made the map the dominant workspace but increased responsive and cognitive risk;
- **Editorial Intelligence** created a premium report aesthetic but weakened the sense of an
  interactive decision tool.

The chosen design uses subtle map layering from Living Atlas and the typographic confidence of
Editorial Intelligence, while its structure and interaction model remain Calm Command Center.

## 3. Product shell and information architecture

The current long page becomes a persistent workspace with five destinations:

1. **Overview** — current route, result, headline metrics, compact map, and next action.
2. **Research** — route verification, source progress, status reasons, and retry behavior.
3. **My branch** — confirmed profile snapshot, budget flow, assumptions, and C0 creation.
4. **Life Git** — rewind, fork, and causal comparison between C0 and C1.
5. **Sources** — the six Evidence Passport classes and their technical details.

Desktop uses a compact left navigation rail. A context bar above the content shows the active
route, active branch, snapshot date, and evidence state. Navigation changes the visible workspace
section without discarding the current run or branch state.

Mobile uses a compact header and bottom navigation for Overview, Branch, and Sources. Research and
Life Git remain available from the contextual menu and from relevant calls to action. Content is
prioritized into readable cards instead of shrinking desktop grids.

The product shell exposes only destinations backed by the current implementation. It must not
create dead premium-looking navigation or imply unsupported product capabilities.

## 4. Main screens

### 4.1 Scenario setup

The start experience is the empty state of the product shell. It contains:

- a concise product promise and explicit VS-1 scope;
- a three-part form for resources, employment, and relocation party;
- a live, read-only scenario summary;
- a final review block for conditions entering the immutable snapshot;
- one primary action to start verification.

Changing any input invalidates the confirmation exactly as it does today. Conditional spouse
fields remain conditional. Labels preserve the distinction between user input, scenario condition,
and official confirmation.

### 4.2 Research

The map remains the primary visual artifact during verification. Alongside it, the interface shows:

- the exact one-candidate VS-1 scope;
- a short ordered list of verification steps;
- source progress and the current evidence state;
- a readable status reason when the result is yellow or red;
- a verified official-source link and retry action when applicable.

Pending is shown as structured progress, not a spinner alone. A green result smoothly collapses the
large map into a compact status strip. Yellow and red states remain keyboard operable and must never
communicate meaning by color alone.

### 4.3 Overview and branch

After a completed run, Overview leads with:

- the bounded narrative headline;
- route compatibility in the declared scope;
- known residual budget;
- evidence completeness expressed as confirmed versus unresolved items, not a fabricated score;
- number of explicit unknowns;
- one context-sensitive next action.

The branch workspace contains the immutable profile snapshot and the existing budget flow. C0 is
created from the server-bound value. Unknown taxes and living costs remain visible next to the
budget rather than being hidden in a technical appendix.

### 4.4 Life Git

Life Git presents C0 and C1 as comparable branch states. Desktop uses two aligned columns; mobile
uses stacked states with a persistent change summary. The causal diff emphasizes:

- housing before and after;
- known residual before and after;
- signed deltas;
- the decision that caused the change;
- reused profile, evidence, and rules.

Rewind and fork are visually distinct. Rewind changes the viewing cursor without rewriting history.
Fork creates C1 only from the valid C0 cursor. Pending and error states disable duplicate actions
without removing the prior branch view.

### 4.5 Evidence Passport

Evidence Passport becomes a first-class Sources workspace. Six filter controls map one-to-one to:

- official fact;
- user fact;
- calculation;
- assumption;
- projection;
- unknown.

Every class has a distinct icon, label, and neutral surface treatment. Semantic green, yellow, and
red are reserved for verification state, not evidence class. Human-readable summaries are shown by
default. Formula versions, inputs, rounding, hashes, source anchors, and blocker identifiers stay in
disclosure panels.

Unknown and source-unavailable items receive higher visual priority than confirmed items because
they change what the user should investigate next. External official links keep the existing safe
link attributes.

## 5. Visual system

### 5.1 Color

The first release is light-only. The palette uses:

- a warm off-white page background;
- white primary surfaces;
- cool gray secondary surfaces and dividers;
- deep ink/navy for primary text and navigation;
- a restrained blue for interactive focus and selection;
- green, yellow, and red only for verified semantic states.

Contrast must meet WCAG AA for normal text and interactive controls. Status meaning must always be
paired with an icon and text label.

### 5.2 Typography

Use one modern sans-serif family with a dependable system fallback. Headings rely on size, weight,
and spacing rather than a decorative display face. Numeric metrics use tabular figures. Body copy
stays at a comfortable reading size and line length; technical identifiers may use monospace only
inside disclosure content.

### 5.3 Shape, depth, and density

The shell uses moderate radii, thin borders, and minimal shadows. Major sections have generous
space; rows within those sections are compact. Premium character comes from alignment, rhythm, and
typographic precision rather than glass effects, gradients, or oversized decoration.

Information follows a three-level density model:

1. decision-level summary visible immediately;
2. supporting facts visible in the current workspace;
3. technical provenance available through disclosure.

## 6. Motion

Motion communicates navigation, hierarchy, and causality:

- control feedback: 140–180 ms;
- card or section entrance: 180–220 ms with 6–8 px vertical travel;
- major state transitions: no more than 260 ms;
- active navigation indicator moves between destinations;
- a successful research map collapses into its status strip;
- forked values interpolate or cross-fade and changed rows receive a brief restrained highlight;
- errors appear in place without shaking or moving the entire layout.

Animations use transform and opacity where practical. Continuous decorative animation is excluded.
`prefers-reduced-motion: reduce` removes travel and nonessential interpolation while preserving
state changes.

## 7. Components and boundaries

The redesign may refactor presentation components but must preserve the current dependency rule:
experience components consume serializable application view data and server actions only. They do
not query SQLite, source adapters, or raw infrastructure.

Recommended presentation boundaries are:

- `ProductShell` — responsive frame and destination state;
- `NavigationRail` and `MobileNavigation` — destination controls;
- `ContextBar` — route, branch, snapshot, and evidence context;
- `ScenarioSetup` — grouped inputs, summary, and review;
- `OverviewWorkspace` — narrative, metrics, compact route, next action;
- `ResearchWorkspace` — map, verification steps, states, and retry;
- `BranchWorkspace` — profile snapshot, budget, unknowns, and C0 action;
- `LifeGitWorkspace` — branch controls and causal diff;
- `SourcesWorkspace` — evidence filters and grouped items;
- shared primitives for buttons, fields, status badges, metric tiles, disclosures, and inline alerts.

Existing application actions and domain rules remain the source of truth. UI state may control the
active destination, disclosures, filters, and optimistic visual transitions only.

## 8. Data and state flow

The redesign does not change domain behavior:

1. Setup submits the confirmed profile and housing value through `startConfirmedLife`.
2. The application returns `RunDetails`; the shell derives presentation data through the existing
   view-model layer.
3. Retry returns a new run and evidence snapshot while the previous snapshot remains immutable.
4. C0 save, rewind, and C1 fork continue to call the existing server actions.
5. Navigation and evidence filters never mutate the run, snapshot, or branch.

The URL continues to identify the active run. The active destination stays in client presentation
state for this slice; the redesign does not add another query parameter or fragment contract.

## 9. Errors, loading, and empty states

Errors are rendered inside the affected workspace and state what remained unchanged. A retry action
appears only when the operation is safe to repeat. The product shell and last valid data remain
visible.

Loading states preserve layout to avoid large shifts. Research loading shows named verification
steps; branch actions show pending feedback on the initiating control and prevent duplicates.
Skeletons are used only where the final shape is predictable.

Unsupported or absent data is shown as unknown, not zero, a blank metric, or a positive state.

## 10. Accessibility and responsive behavior

- All destinations, disclosures, filters, and branch actions are keyboard operable.
- Focus is visible and not clipped by overflow containers.
- Landmarks and headings describe the workspace hierarchy.
- Motion respects reduced-motion preferences.
- Touch targets are at least 44 by 44 CSS pixels on mobile.
- Desktop comparison grids become ordered mobile sequences without losing before/after labels.
- Horizontal scrolling is limited to bounded technical content and never required for the primary
  journey.

## 11. Verification

Implementation is complete only when:

- existing domain and integration tests continue to pass;
- updated experience tests cover navigation, setup confirmation, research states, C0, rewind, C1,
  causal diff, and all six evidence classes;
- typecheck, lint, tests, and production build pass;
- responsive layouts are checked at narrow mobile, tablet, and desktop widths;
- keyboard navigation and Enter/Space behavior are checked for yellow and red reasons;
- reduced-motion behavior is checked;
- the visual rubric confirms the journey can be understood without oral explanation;
- no status relies on color alone and no unresolved value is presented as confirmed.

## 12. Out of scope

- dark theme;
- billing, subscription management, authentication, or premium entitlement logic;
- new relocation destinations or global ranking behavior;
- changes to evidence, assessment, budget, Life Git, or snapshot domain rules;
- production features represented by nonfunctional navigation;
- a map SDK or remote visual dependency;
- decorative infinite animation.
