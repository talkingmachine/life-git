# Realistic Earth Globe Design

## Goal

Turn the laboratory globe into a realistic day/night Earth with physically displaced terrain,
then measure whether the visual gain is affordable before simplifying it.

## Scope

- Change only `/lab/research-map`, `ResearchGlobeCanvas`, and local visual assets.
- Preserve the random 1–5 city flow, routes, markers, GLTF aircraft, camera transitions,
  reduced-motion behavior, HTML overlay, and existing WebGL fallback.
- Add no production data, database, LLM, or source-pipeline changes.
- Do not commit until the user visually approves the experiment.

## Assets

Bundle three reputable, license-compatible Earth textures locally:

- 4096×2048 daytime color/albedo texture.
- 4096×2048 nighttime city-lights texture.
- 2048×1024 grayscale elevation texture.

The combined transferred size target is 5–10 MB. Downloaded source archives and temporary
conversion scripts must not remain in the repository. The existing stylized
`research-earth.png` remains the loading preview and rollback asset.

## Rendering

Use one subdivided globe mesh managed by the existing `react-globe.gl` renderer.

- Increase globe geometry density only as far as needed for visible displacement.
- Apply real vertex displacement from the elevation texture, not only a normal or bump effect.
- Exaggerate elevation approximately 8× relative to real Earth so terrain is visible at globe scale.
- Blend the day and night textures in the globe material according to the dot product between
  the world-space surface normal and a world-space sun direction.
- Keep the terminator soft rather than drawing a hard dividing line.
- Show city lights only on the night side.
- Keep the sun direction stable in world space so globe rotation changes which regions are lit.
- Preserve the existing atmosphere, but retune its color/intensity for the realistic surface.
- Remove or greatly suppress the cartographic graticule if it competes with the realistic texture.

Routes, markers, and the aircraft render above the displaced surface and remain the primary
interactive visual layer.

## Loading and fallback

- Begin with the current stylized local surface while the three realistic textures load.
- Switch to the realistic material only after all required textures are ready.
- A texture or shader failure must leave the stylized globe usable; it must not break playback.
- Existing no-WebGL/context-loss fallback remains unchanged.
- Dispose loaded textures, shader material, and animation resources on unmount.

Do not build a parallel renderer or a general material framework.

## Performance experiment

Measure the realistic mode on the laboratory page rather than adding permanent telemetry UI.

- Record each asset's transferred bytes and dimensions.
- Measure texture loading time and time until the realistic material's first ready frame.
- Measure average and minimum sampled FPS during a complete random flight run.
- Estimate uncompressed GPU texture memory from dimensions and texture format.
- Confirm that the run completes and the launch button is re-enabled.

Target at the current desktop laboratory viewport:

- Combined transferred assets: 5–10 MB.
- Average animation performance: at least 45 FPS on a modern laptop.
- No multi-second main-thread freeze during material activation.

If the target is missed, the first simplification is reducing day and night textures from 4K to
2K. Shader architecture, flight flow, and displacement behavior remain unchanged.

## Acceptance

- Day and night sides are simultaneously visible with a soft, correctly oriented terminator.
- City lights are absent from the illuminated side and visible on the dark side.
- Terrain changes the globe silhouette at grazing angles without spikes, cracks, or a visible UV seam.
- Continents are correctly oriented.
- Routes, markers, aircraft, and status cards remain legible.
- A clean load and random 1–5 city run complete without console errors.
- Measured loading, FPS, and estimated GPU-memory results are reported before visual approval.
