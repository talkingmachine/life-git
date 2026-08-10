# Workspace Globe and Expandable Navigation

## Goal

Make the existing realistic `ResearchGlobeCanvas` the single persistent background of the application workspace. The globe and its bundled dark background occupy exactly the area left after the navigation rail; they never render underneath the rail.

## Layout

`ProductShell` owns a two-column grid:

- collapsed desktop rail: `80px`;
- expanded desktop rail: `240px`;
- workspace: `minmax(0, 1fr)`.

The rail is collapsed by default. A dedicated toggle changes only the first grid column. The workspace width therefore grows when the rail closes and shrinks when it opens. `ResearchGlobeCanvas` already observes its container with `ResizeObserver`, so its WebGL canvas follows the workspace size and the Earth appears to move left or right without a second globe instance.

Mobile keeps the existing fixed bottom navigation. It does not expose the expanded rail mode.

## Globe Ownership

The globe is rendered once by `ProductShell` through a workspace-level `WorkspaceGlobe` adapter, behind the context bar and active workspace content. It uses its bundled dark background instead of a transparent canvas. Every destination—Overview, Research, Branch, Life Git, and Sources—shares the same mounted scene. `OverviewWorkspace` no longer owns or mounts `OrbitGlobe`.

The route remains Moscow → Tirana for VS-1. WebGL capability and load failures render a controlled fallback in the same background layer without crashing the interface.

## Interface Layers

Navigation, route results, the compact profile, destination details, status, and retry controls are foreground layers. Their glass backgrounds remain translucent so the Earth is visible through them.

Overview keeps the city result, profile, and destination passport. Research becomes a set of functional status/retry panels over the shared globe instead of owning a second flat map.

## Cleanup

Remove:

- the legacy flat-map illustration and its decorative route markup;
- the old SVG globe implementation and obsolete SVG-only styles;
- duplicate globe containers and route-caption styling that no longer have an owner;
- unused animations and selectors left by those implementations.

Keep:

- evidence and retry behavior;
- accessible status text and keyboard navigation;
- responsive panel layout;
- `ResearchGlobeCanvas`, its lifecycle helpers, shaders, textures, and 3D model assets.

## State and Accessibility

Rail expansion is local presentation state and does not mutate a confirmed run. The toggle exposes `aria-expanded` and an explicit accessible name. Collapsed icon buttons retain labels for assistive technology; expanded mode reveals the same labels visually.

Reduced-motion users receive an immediate column-size change or minimal transition, while the globe's existing reduced-motion handling remains active.

## Icon System

Use only `@phosphor-icons/react@2.1.10` for interface icons. Navigation, destination traits, status indicators, disclosure controls, retry actions, and route actions use explicit tree-shakeable imports from this package; Unicode glyphs and hand-mixed icon styles are removed.

Standard interface icons use the regular Phosphor weight. Active navigation and high-priority statuses may use the duotone weight, while compact metadata uses the same regular geometry at a smaller size. Decorative icons are hidden from assistive technology; icon-only buttons carry their accessible name on the button.

## Verification

- Component tests cover collapsed/expanded rail semantics and the single shared globe instance.
- Component tests cover the Phosphor icon mapping and prohibit legacy Unicode navigation/status glyphs.
- Visual CSS contracts cover the `80px` and expanded grid columns, full-workspace globe layer, glass panels, and mobile bottom navigation.
- Existing journey, retry, branch, and evidence tests remain green.
- Browser QA checks desktop collapsed/expanded movement, a fresh external-browser URL, tablet, mobile, WebGL fallback, and console errors.
