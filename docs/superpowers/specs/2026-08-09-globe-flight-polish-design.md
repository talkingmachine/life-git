# Globe Flight Polish — Design

## Goal

Make the laboratory globe read as a future journey rather than a data diagram: each candidate is
reached from the user's actual origin, the route grows behind a recognizable low-poly aircraft,
markers feel native to the 3D globe, and the camera stays calm and close.

This remains isolated to `/lab/research-map`. Production data flow, the database, LLM orchestration,
and source pipeline do not change. Nothing is committed until visual approval.

## Terrain and surface clearance

- Increase terrain displacement from `1` to `3`. Replace grayscale bump shading with the approved
  terrain normal map; tune its generated slope strength and `normalScale` for clearly visible,
  intentionally exaggerated mountains.
- Treat the relief as expressive visualization, not geodetically exact scale.
- Recalculate aircraft and marker clearance for the new maximum normalized surface displacement
  of approximately `0.03`.

## Surface normals and lighting

- Generate one local 2048×1024 tangent-space terrain normal map from the same numeric ETOPO height
  source. Record provenance and conversion next to the existing texture report.
- Keep the grayscale heightmap for vertex displacement. Use the normal map, rather than the same
  grayscale texture, for per-fragment slope lighting.
- Reduce ambient-light intensity so it no longer washes out mountain shading.
- Drive the Three.js directional light from the same world-space sun direction as the day/night
  shader. The terminator, illuminated hemisphere, and terrain highlights must agree.
- Do not add parallax mapping, self-shadow ray marching, or another material framework.

The normal map adds one texture sample per fragment, about 10.7 MiB of decoded GPU storage including
mip levels, and an expected few MiB of transferred data. With the existing two 4K color textures
and 2K heightmap, the Earth texture set is approximately 106.7 MiB in decoded RGBA8 GPU storage
before renderer buffers and the temporary stylized preview.

For a future production release, use a 4K desktop tier and a 2K mobile/low-memory tier, cap renderer
pixel ratio, lazy-load the globe, and explicitly dispose the preview texture after promotion. GPU
compressed KTX2/Basis textures are a later optimization only if measurements justify the added
asset pipeline. These quality tiers and compression are not part of the current visual experiment.

## Camera and controls

- At the start of a run, compute a spherical mean from the user origin and every candidate in that
  run. Move the camera once to that overview before the first flight.
- Choose a close overview altitude within a narrow clamp; the globe must remain the dominant visual
  even when candidate spread would ideally request a wider view.
- Do not move the camera between candidates and disable automatic globe rotation completely.
- Keep manual orbit controls. Restrict zoom to a small range around the chosen overview so the user
  can move only a few wheel steps inward or outward.

## Flight and route behavior

- Every candidate flight starts from the user's origin. Candidates are not chained together.
- The route is not shown in full before departure. A bright active trail grows from the origin
  behind the aircraft as it moves along the spherical great-circle path. Its visible end keeps a
  small constant world-space gap behind the aircraft tail, so the aircraft never looks attached to
  a rod.
- Arrival is one ordered visual sequence: the aircraft reaches the destination and lands; the
  trail then settles from its airborne gap into the submerged destination anchor; only after the
  line is complete does the marker grow from scale `0` to `1`.
- The pending marker is revealed before the flight completion callback starts the result delay. It
  therefore appears as a gray head with the existing spinner/halo while verification is pending,
  then smoothly adopts the final green, yellow, or red status color.
- On landing, the completed route and marker remain visible and the next flight begins again at the
  origin.
- Route endpoints deliberately continue beneath the rendered Earth surface at both ends. They do
  **not** connect to the marker top. The globe hides the submerged final segment and the 3D marker
  sits above the same geographic anchor, producing a clean route-entering-the-ground effect.
- Keep the active trail in the existing Three.js custom layer rather than driving React state on
  every animation frame. Completed routes may stay in the existing arc layer.

## Glowing 3D pins

- Replace the procedural cylinder/sphere marker with the approved Sketchfab model
  [Location Pin](https://sketchfab.com/3d-models/location-pin-728fced8df934479bf9a46bc892e4780)
  by `elbastosoyyo`, licensed under CC BY 4.0. Verify the download through Sketchfab, keep the
  normalized runtime asset local, and record the author, source URL, license URL, original file
  metadata, and offline conversion in `public/models/ATTRIBUTION.md`.
- Inspect the downloaded GLTF/GLB once offline. The normalized local GLB exposes exactly two named
  visual parts: `pin_head` for the upper sphere and `pin_stem` for the leg and point. Reuse existing
  mesh/material slots when present; otherwise split the source mesh by connected components during
  asset preparation. Runtime code never guesses geometry by bounds, names from an unknown export,
  or vertex positions.
- The `pin_head` uses an owned `MeshStandardMaterial`: gray while pending, then green, yellow, or
  red, with moderate emissive intensity that remains readable on both hemispheres. Status changes
  interpolate color rather than snapping.
- The `pin_stem` uses a neutral dark titanium/graphite `MeshStandardMaterial` with moderate
  metalness and roughness plus only a weak cool emissive contribution. It remains readable on the
  night side without competing with the head.
- A restrained halo and the existing thin spinner surround only the pending head. They are effects,
  not a second procedural marker, and the spinner disappears after a result.
- Normalize the asset so its root pivot is at the lowest tip. Position that pivot at the geographic
  arrival anchor, with the point slightly submerged. Keep every marker upright; reveal animation
  scales around the bottom pivot, so the arrival point never drifts.
- Pending, green, yellow, and red continue to use the existing status palette. Completed markers
  stay visible until a new run begins.
- Clone marker geometry/materials per visible instance only where mutation requires it and dispose
  owned clones on cleanup. Do not retain the old procedural marker geometry or create a general
  marker framework.

## Aircraft asset

- Replace the current arrow-like model with one lightweight low-poly aircraft from a traceable
  open-source or CC0 source.
- Store the final GLB/GLTF locally and record its source, author, license, and any conversion in a
  small adjacent attribution file.
- Do not retain source archives, introduce a runtime external request, or add a new package merely
  to process the asset.
- Preserve tangent-based orientation and ensure the model points along the route and remains above
  the exaggerated terrain throughout the flight.

## Lifecycle and fallback

- A new run cancels the active flight and trail, clears prior markers/routes, and recomputes the one
  overview camera position.
- Restart and unmount cancel flight, trail-settle, marker-reveal, color-transition, and spinner
  frames, prevent stale completion callbacks, and dispose owned trail, marker, and aircraft clones.
- Reduced motion keeps the sequential checks but immediately installs the completed submerged line
  and fully grown pending marker before continuing verification; it has no flight, settle, reveal,
  spinner, or color-transition frames.
- If the aircraft asset cannot load, preserve the existing WebGL fallback behavior; do not add a
  second rendering system.

## Verification scope

Automated checks cover only real contracts: origin-to-candidate routing, tail-gap behavior, ordered
landing → trail-settle → marker-reveal completion, restart/unmount cancellation, fixed camera
controls, marker cleanup, upright pivot-preserving placement, and reduced motion. The live laboratory
review remains responsible for terrain visibility, route submersion, pin appearance, aircraft
scale/orientation, close zoom bounds, and overall performance.

## Marker interaction and visual-polish delta

- The laboratory does not render the shared bottom-right candidate summary/toast list. Status is
  communicated by the globe markers, their labels, and the selected-marker detail card.
- Every revealed 3D pin is clickable through the native `react-globe.gl` custom-layer interaction.
  Trail and aircraft objects do not open marker details.
- Every revealed marker has a compact white city-name balloon supplied by the globe HTML layer.
  Because it is a CSS2D/DOM element, its face always stays parallel to the screen and readable to
  the observer while the globe rotates. Hidden or scale-zero markers have no balloon.
- Clicking a pin opens one ordinary HTML detail card over WebGL. It contains country, city, and
  status. Red adds the concise rejection reason; green adds a locally stored, attributed city
  photograph; yellow and pending add a short explanation of the current state. Clicking another
  pin replaces the card; its close control dismisses it.
- The lab city fixtures own the synthetic country, explanation/reason, and local photo path needed
  by this card. This does not introduce production data, DB, LLM, or source-pipeline changes.
- Increase the pin visual size by approximately 15%. Brighten the graphite stem while keeping it
  neutral and less prominent than the status head.
- Reduce the route peak altitude from `0.2` to `0.1`. The plane follows the same lower curve and is
  oriented along the full 3D path tangent, including the radial component during climb and descent.
- The active trail gap is measured behind the aircraft tail, not its center. Before the aircraft
  has travelled far enough to clear that gap, no visible line segment is drawn. The line therefore
  never intersects the aircraft or creates a visible support rod.
- Treat first-run disappearing markers and WebGL/runtime exceptions as a lifecycle regression.
  Capture the exact console stack before changing ownership, then add a regression test for the
  observed sequence. Asset templates, route-scene handles, animation frames, and rendered objects
  must each have one clear owner and must never be rendered after disposal.
- Local city photographs have explicit source/license attribution and no runtime network request.
  They are compressed for the lab rather than introducing an image-loading subsystem.

## Night texture, balloon, pin, and trail correction delta

### NASA Black Marble night master

- Replace the contents of `/textures/earth-night-4k.jpg` without changing its runtime URL,
  dimensions, texture configuration, material architecture, or decoded GPU-memory estimate.
- Use the official NASA Earth Observatory `Black Marble 2016` nighttime composite at
  `13,500 × 6,750` pixels as the only master. Verify the downloaded file dimensions and record the
  NASA title, source page, direct asset URL, public-use attribution, source hash, output hash, and
  conversion settings next to the Earth texture provenance.
- Before overwriting the repository asset, compare the existing and replacement images at the same
  `4096 × 2048` resolution. Record variance of Laplacian and mean edge-energy values for both. These
  metrics document the comparison; they do not automatically decide whether the visually approved
  NASA image is used.
- Downsample once with Pillow's Lanczos resampler to exactly `4096 × 2048`. Encode JPEG at quality
  `93`, disable chroma subsampling (`4:4:4` / Pillow `subsampling=0`), enable optimized output, and
  preserve sRGB output. Do not add an image-processing dependency to the application.
- Reduce the night-light multiplier in the existing Earth shader from `1.65` to `1.45`, leaving the
  day/night transition and all other material behavior unchanged. The live review must confirm that
  dense urban regions retain detail rather than becoming merged white areas.

### Clickable observer-facing city balloons

- Continue using the `react-globe.gl` HTML/CSS2D layer so every balloon remains parallel to the
  viewport while the globe moves.
- Render each city balloon as a semantic HTML button. Clicking or keyboard-activating it selects the
  same route key and opens the same detail card as clicking the revealed 3D pin.
- Balloon interaction must not start an unintended globe drag. Balloons exist only for revealed
  markers and disappear with their route; no second card or selection state is introduced.

### Upright pins

- Remove marker lean completely: no run-key hash, random angle, lean interface, or tilt transform.
- Keep the normalized model's lower-tip pivot at the geographic arrival anchor. Reveal scaling and
  status-head animation continue around that fixed upright pivot.

### Monotonic aircraft trail

- The visible kink is caused by sampling route points up to aircraft progress and then appending a
  tail endpoint located earlier on the route. That makes the polyline double back on itself.
- For every flight frame, solve one `tailProgress` in `[0, aircraftProgress]` whose projected route
  point is the configured world-space gap from the aircraft. Use a bounded binary search on the
  existing route curve; do not introduce splines, native `arcsData`, or per-frame React state.
- Generate route samples only through `tailProgress`, then append the exact point at
  `tailProgress`. Sample progress must be monotonic, so the active trail cannot overshoot and return.
- Before the aircraft has moved far enough to establish the configured gap, keep the existing
  no-segment state.
- At landing, retain the final `tailProgress`. During trail settle, interpolate that scalar to `1`
  and rebuild samples only through the interpolated progress. The line therefore advances smoothly
  to the submerged destination without temporarily drawing past it or creating a hook.
- Reduced motion installs the completed monotonic line immediately. Restart and unmount retain the
  existing single-owner cancellation and cleanup behavior.

### Verification boundary

- Automated tests cover NASA texture dimensions/URL invariants, shader night multiplier, semantic
  balloon selection, upright pin transforms, monotonic active/settling progress, restart cleanup,
  and reduced motion. They do not attempt pixel-perfect WebGL assertions.
- After nonvisual verification, request fresh browser permission. The live review compares the
  replacement night side, checks that city lights remain separated, activates balloons with pointer
  and keyboard, and observes a full flight and landing without a trail kink.
- All work remains isolated to `/lab/research-map`; production data flow, DB, LLM, and source
  pipeline remain untouched. Do not stage or commit before explicit visual approval.

## Pinless destination UI and grounded-route delta

This delta supersedes every earlier requirement to render, animate, load, or interact with a 3D
location pin. The normalized pin asset may remain in the repository until the laboratory is
approved, but `/lab/research-map` no longer loads or renders it and no hidden procedural or GLB pin
layer remains in the scene. It also supersedes earlier marker-reveal/spinner lifecycle wording: the
corresponding phase is now destination-balloon reveal. The earlier prohibition on automatic camera
movement still applies during playback; an explicit balloon selection is the sole exception.

### Destination balloons

- The observer-facing HTML balloon becomes the only destination marker. It appears after arrival at
  the same latitude and longitude as the former pin, with its pointer visually touching the terrain.
- The balloon is a semantic button and contains a Unicode country flag followed by the city name.
  The same flag appears beside the country name in the detail card. Laboratory fixtures own the
  explicit flag value; runtime code does not infer flags from translated country names.
- Balloon text communicates status: gray for `pending`, black for `green`, orange for `yellow`, and
  red for `red`. Routes themselves do not carry status color.
- The selected balloon exposes `aria-pressed="true"` and receives a restrained border, shadow, and
  scale emphasis. Selecting another balloon transfers this state; closing the card clears it.
- Clicking or keyboard-activating a balloon opens the existing detail card and smoothly centers the
  globe on its geographic coordinate at the existing `1.1` overview altitude. The card enters over
  roughly `350 ms` using opacity, a short translation, and slight scale; reduced motion makes the
  camera change immediate and removes the card transition.

### Flight and grounded trail

- All active and completed routes use one neutral gray, semi-transparent material. Status remains
  legible through the balloon and detail card only.
- Reduce the shared route/aircraft peak component from `0.1` to approximately `0.067`, preserving
  terrain clearance while making the arc about one third flatter.
- During flight, sample the visible trail directly on the final low route curve, ending at the
  existing constant distance behind the aircraft. Do not first place the line on the aircraft's
  higher curve.
- At landing, hide the aircraft immediately in the flight-completion callback. Then extend only the
  missing end of the already-grounded route from its saved `tailProgress` to the submerged
  destination anchor. The completed portion does not move vertically, so the whole arc cannot
  appear to fall onto the globe.
- Once the endpoint extension finishes, reveal the pending gray balloon and begin the existing
  verification delay. No marker-growth or spinner phase remains.
- Reduced motion immediately installs the completed grounded route and destination balloon while
  preserving sequential verification. Restart and unmount still cancel the active journey and
  remove completed route objects and balloon data from the previous run.

### Focused verification

- Automated checks cover pin-free scene data, explicit fixture flags, status-to-balloon styling,
  selected-balloon state, immediate aircraft hiding at landing, lower peak altitude, grounded
  active/settling trail geometry, phase order, restart cancellation, cleanup, and reduced motion.
- Live review covers balloon anchoring, flag rendering, selected emphasis, camera framing, card
  entrance, apparent terrain clearance, gray trail readability, and absence of whole-route drop.

## Anchored balloons, random origin, and unified flight-trail delta

This delta supersedes the preceding requirement to draw the active line on a lower curve than the
aircraft. The screenshot review showed that a route can have correct longitudinal progress while
still looking detached because its endpoint is substantially below the aircraft tail.

### One curve for aircraft and route

- Define one altitude function for both aircraft motion and active/completed route points. Its
  minimum clearance stays just above the maximum displaced terrain and its sinusoidal peak is lower
  than the current aircraft-only peak. The aircraft and trail therefore share the same world-space
  curve at every route progress.
- Solve `tailProgress` against that same curve and reduce the configured longitudinal tail gap from
  `7` to approximately `3.8` world units. Draw route samples only through `tailProgress`; the line
  must end directly behind the tail without a separate vertical gap.
- During arrival, interpolate only the end progress from saved `tailProgress` to `1`. Previously
  drawn points retain identical coordinates. Completed routes remain on the exact curve flown by
  the aircraft and never settle vertically.
- Replace the halo/core pair with one continuous neutral-gray `Line2`, approximately `0.55` opaque,
  with `transparent: true`, `depthWrite: false`, and normal depth testing. Keeping the unified curve
  above terrain prevents shader-displaced mountains from occluding alternating line fragments; do
  not disable depth testing or make the route visible through the far side of Earth.

### Balloon anchoring and selection

- Remove `transform` from the balloon transition list. Globe positioning must update without CSS
  interpolation on every renderer frame, so rotating the Earth cannot make balloons crawl toward
  their geographic anchors.
- Keep the existing static vertical placement transform, but emphasize selection only through
  border, background, and shadow. Do not scale or animate the transform of the anchored element.

### Random laboratory origin

- Add one compact pool of Russian origin cities with explicit city, coordinate, country, and
  Unicode flag fields. Select one origin once per laboratory run through the existing injected
  randomness boundary; every candidate flight in that run starts from it.
- Render the origin balloon immediately when a run starts. It uses the same white balloon visuals,
  black available text, and explicit `🇷🇺` flag as destination balloons, but is a non-interactive
  element with no card or selected state.
- Include the selected origin plus all candidate coordinates in overview framing. Outside the lab,
  the future origin comes from the user's actual city; this delta adds no production profile logic.

### Landing fade and scene removal

- During the last `500 ms` of the `1,050 ms` flight, interpolate every owned aircraft material from
  opacity `1` to `0`; transparent materials use `depthWrite: false`. At the destination the aircraft
  is fully transparent.
- On landing, remove the aircraft object from its Three.js parent immediately. Route endpoint
  extension, destination-balloon reveal, and verification continue through the existing journey
  lifecycle and must not depend on the aircraft remaining in custom-layer scene data.
- Restart and unmount retain one-owner cancellation and disposal. A removed aircraft must not be
  re-added by a later custom-layer update.

### Verification additions

- Automated tests cover shared route/aircraft altitude samples, exact constant tail separation,
  immutable existing route coordinates during arrival, one translucent line object, random origin
  reuse across candidates, non-interactive origin markup, transform-free anchor updates, last-500-ms
  aircraft opacity, landing removal, restart, unmount, and reduced motion.
- Live review checks a rotated globe for anchor drift and captures the middle and final portions of
  a flight to confirm one continuous line directly behind the aircraft tail.

## Continuous strip, exact balloon pointer, and short fade delta

This delta supersedes the preceding `Line2` requirement and the `500 ms` aircraft fade. The route
still follows the shared aircraft curve and keeps the same `3.8` world-unit tail gap.

### Truly continuous translucent route

- Replace the transparent segmented `Line2` with one native Three.js `Line` backed by a fixed-size
  `BufferGeometry`. The visible dotted pattern is transparency accumulation at overlapping expanded
  segment caps, not dash mode or missing route samples.
- Store one ordered vertex per route sample and update the geometry draw range in place. Use one
  neutral-gray `LineBasicMaterial` with opacity `0.8`, `transparent: true`, normal depth testing,
  and `depthWrite: false`.
- Accept the native WebGL line width instead of adding a custom ribbon/tube shader. This keeps the
  laboratory route genuinely uniform and avoids a second rendering architecture.

### Pointer is the geographic anchor

- Return a zero-size HTML anchor element to `react-globe.gl`, so CSS2D positions that wrapper at the
  exact latitude, longitude, and shared route altitude.
- Place the visible balloon as an absolutely positioned child above the zero-size anchor. Its
  triangular pointer tip, rather than the balloon center, must sit at the wrapper origin.
- Destination balloons remain semantic buttons. The origin stays non-interactive. Selection styles
  affect only border, background, and shadow; neither wrapper nor balloon interpolates geographic
  transforms.

### Short landing fade

- Fade owned aircraft materials only during the final `200 ms` of the existing `1,050 ms` flight.
  Opacity is `1` at `850 ms`, approximately `0.5` at `950 ms`, and `0` at landing.
- Landing removal, route extension, destination reveal, cancellation, unmount cleanup, and reduced
  motion behavior remain unchanged.

### Scope and verification

- Automated checks cover an ordered native line buffer/draw range, transparent depth behavior,
  anchor-wrapper markup for origin and destination, pointer ownership, the `200 ms` opacity curve,
  and existing restart/cleanup contracts.
- Planet zoom limits are deliberately unchanged until the unfinished scale requirement is clarified.
- Work remains restricted to `/lab/research-map`; do not stage or commit before visual approval.

## Submerged endpoints without route drop delta

This delta supersedes the requirement that completed-route endpoints remain at the aircraft's
`0.035` minimum altitude. That clearance is correct for the aircraft but leaves the route and HTML
pointer visibly floating above the globe.

- Keep the aircraft on the existing `journeyAltitude` curve. Keep the central route and its active
  tail endpoint on that same curve, so the line remains directly behind the aircraft.
- Give the route a short terminal ramp at each end. At progress `0` and `1`, route altitude is
  `-0.004`; over the nearest `1/16` of route progress, smoothly blend to the aircraft curve. The
  rest of the route is byte-for-byte unchanged and cannot vertically settle.
- During flight, the already-drawn origin ramp remains submerged at its first point and rises to the
  shared flight curve. During arrival, append only later progress samples; the final samples descend
  into the destination. Never rewrite the earlier route prefix.
- Position origin and destination HTML anchor wrappers at altitude `0`, so their pointer tips target
  the nominal globe surface instead of the aircraft-clearance shell.
- Automated checks require submerged endpoints, shared central samples, immutable settle prefixes,
  surface HTML anchors, and the existing constant tail gap. Scale controls remain unchanged.

## Single surface-to-surface curve correction

This delta fully replaces the preceding submerged-terminal-ramp design. The four-sample terminal
blend produced a visible radial elbow and is removed rather than refined.

- Aircraft and trail use one altitude function for every progress value:
  `0.08 * sin(PI * progress)`. It is `0` at both geographic endpoints and `0.08` at midpoint.
- There is no submerged altitude, terminal fraction, secondary curve, radial connector, or endpoint
  rewrite. The line touches the nominal globe surface; displaced terrain and normal depth testing
  naturally occlude the final pixels where appropriate.
- Increase route sampling from `64` to `128` segments. The active trail, completed trail, gap solver,
  and arrival extension all consume the same samples and altitude function.
- The aircraft can overlap exaggerated terrain only during the first/last instant of takeoff and
  landing; this is preferable to a permanently floating route or an artificial connector. Do not
  add a second aircraft-only clearance curve.
- HTML balloon anchors remain at altitude `0`, exactly matching route endpoints.
- Automated checks require `129` route vertices, surface endpoints, shared midpoint and tail
  geometry, monotonic arrival extension, fixed-buffer capacity, and unchanged cleanup behavior.

## Fullscreen frame removal

- The shared fullscreen research stage overrides the base card chrome with `border: 0`,
  `border-radius: 0`, and `box-shadow: none`.
- Non-fullscreen research cards retain their existing border, radius, and shadow.
