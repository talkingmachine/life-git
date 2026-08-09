# Globe Surface Design

## Goal

Make the laboratory globe immediately recognizable as Earth while keeping routes, aircraft,
markers, and status cards visually dominant.

## Scope

- Change only `/lab/research-map` and its local visual assets.
- Keep the existing `react-globe.gl` renderer, flight animation, random 1–5 city scenario,
  fallback, and production data flow unchanged.
- Do not add labels, terrain, interaction, or a second geography renderer.

## Surface

- Use one lightweight local equirectangular texture loaded through `globeImageUrl`.
- Draw geographically recognizable coastlines from a reputable public-domain world dataset.
- Ocean: dark teal, compatible with the existing background and atmosphere.
- Land: lighter desaturated gray-green so continents remain readable at the current camera distance.
- Country borders: subtle and lower contrast than coastlines.
- No place names, satellite imagery, political coloring, or decorative relief.

## Visual hierarchy

1. Active aircraft and route.
2. Candidate markers and route history.
3. Continent silhouettes.
4. Country borders and graticule.

The texture must not reduce the contrast of green, yellow, red, or pending gray states.

## Failure and motion

- The texture is bundled locally and must not depend on a runtime network request.
- Existing WebGL fallback remains unchanged.
- `prefers-reduced-motion` behavior is unaffected because the surface is static.

## Acceptance

- A clean load visibly shows recognizable continents before a run starts.
- The texture covers the sphere without an obvious seam or inverted geography.
- All current routes, markers, airplane movement, camera transitions, and 1–5 city completion still work.
- No new runtime dependency or production-flow change is introduced.
