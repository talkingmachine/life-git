# Slovenia Official Source Shape Repair

## Status

Approved on 2026-08-11 for the VS-2 live-source repair.

## Context

VS-2 already captures immutable response bytes, validates evidence, publishes a versioned country dossier, streams the research journey, and fails closed when a source cannot be verified. Its Slovenia validators currently accept only compact semantic test fixtures. Those fixtures contain synthetic markers such as `BEGIN 51.a člen`, `EFFECTIVE STATE LIST: COMPLETE.`, and custom SiStat fields that are absent from the real official responses.

The live-source check established the actual official machine surfaces:

- GOV.SI and ESS expose usable official HTML pages;
- PISRS human pages are JavaScript shells, while the official `https://pisrs.si/api` registry and consolidated-text endpoints expose the authoritative data;
- SiStat's human page is HTML, while `https://pxweb.stat.si/SiStatData/api/v1/en/Data/H285S.px` exposes PxWeb metadata and JSON-stat2;
- the existing CBR adapter already consumes a usable official endpoint and needs no source-shape change.

The exact paths, selected structural IDs, compact native excerpts, request body, response sizes, and observed SHA-256 provenance are recorded in [`Slovenia Official Source Field Map`](./2026-08-11-slovenia-official-source-field-map.md). That map is fixture provenance, not a production cache: every new run still fetches and validates current official bytes.

Keeping the synthetic parser would make the live gate permanently yellow. Adding a fallback or asking an LLM to rewrite official content would make the evidence impossible to reproduce. The repair therefore replaces the unreleased fixture-only VS-2 validator contract with deterministic, source-specific parsing of the real official schemas.

## Goal

Make the canonical Slovenia cold-start run verify all nine required country claims from current official responses, publish dossier `v1`, and produce the formula-backed personal verdict without storing remembered facts or trusting model-generated claims.

The verified result must remain reproducible from the captured bytes alone. A later offline replay must select the same PISRS versions, the same SiStat period and value, the same excerpts, and the same verdict without network or model calls.

## Non-goals

- No generic crawler, provider framework, DOM extraction language, or country-agnostic legal parser.
- No LLM normalization, translation, summarization, or claim extraction inside the evidence boundary.
- No compatibility path for the unreleased Slovenia `@1` fixture format.
- No expansion to additional countries, cities, visas, employment models, or user-profile fields.
- No broad mutation matrix or storage redesign.
- No change to CBR parsing, VS-1 evidence bytes, dossier schema, comparator policy, or UI journey semantics.

## Chosen Approach

Each Slovenia bundle receives one explicit capture recipe and one pure deterministic validator. The adapter derives official machine endpoints only from a candidate whose HTTPS host, authority root, and required claim slot have passed the existing discovery boundary. Exact record identity is then proven from the captured official registry before it is used.

The adapter captures exact official bytes and their request/response provenance. The validator parses only documented fields and stable structural identifiers from those bytes. It emits a claim only when identity, transport integrity, temporal applicability, and cross-source agreement all succeed. Missing, duplicate, ambiguous, future-only, structurally changed, or contradictory data produces the existing typed unavailable/yellow path; no last-known value is reused.

Human navigation and machine verification remain visibly distinct:

- the source-level navigation list retains exactly one readable primary official page for each bundle, so a user can open the route, publication, or procedure;
- artifact-bound evidence retains the exact official API request and resolved response URLs required by integrity verification;
- the compact source block may show both as “official source” and “machine-checked response” without implying that one URL was parsed as the other.

This preserves the current immutable artifact contract and makes every displayed provenance link truthful.

## Capture Topology

The revised Slovenia plan keeps four source bundles, concurrency `3`, and deadline `60_000ms`. The maximum increases from `10` to `11` because current PISRS verification requires both registry and selected consolidated-text artifacts.

| Bundle | Artifact role | Official request | Purpose |
| --- | --- | --- | --- |
| route | `gov-route-page` | discovered GOV.SI human page | readable national route summary |
| route | `ztuj2-registry` | `https://pisrs.si/api/rezultat/zbirka/id/ZAKO5761` | exact law identity, current status, single-record NPB listing |
| route | `ztuj2-details` | `https://pisrs.si/api/rezultat/neuradno-precisceno-besedilo/{selectedNpbId}/details` | Articles 51.a and 55 from the selected version |
| income | `salary-registry` | `https://pisrs.si/api/rezultat/zbirka/sop/{candidateSop}` | exact publication identity, status, and version listing |
| income | `salary-details` | `https://pisrs.si/api/rezultat/neuradno-precisceno-besedilo/{selectedNpbId}/details` | dated official monthly net-salary publication |
| income | `sistat-metadata` | GET `https://pxweb.stat.si/SiStatData/api/v1/en/Data/H285S.px` | complete dimension and category listing |
| income | `sistat-series` | POST the same endpoint with every dimension set to `all`, response `json-stat2` | complete official time series |
| companion | `ess-companion-page` | discovered ESS human page | readable conditional-employment procedure |
| companion | `zzsdt-registry` | `https://pisrs.si/api/rezultat/zbirka/id/ZAKO6655` | exact law identity, current status, single-record NPB listing |
| companion | `zzsdt-details` | `https://pisrs.si/api/rezultat/neuradno-precisceno-besedilo/{selectedNpbId}/details` | Articles 32 and 33 from the selected version |
| FX | existing `official-document` | existing CBR request | current EUR/RUB rate, unchanged |

The PISRS details request is permitted only after the registry artifact validates enough structure to derive one selected `npbId`. A malformed registry therefore causes no details request. The same pure registry decoder is run again by the validator over the sealed artifacts; capture-time endpoint derivation is not accepted as evidence. It also rechecks that the sealed artifact came from the exact expected GET request and final response URL. The SiStat POST body is derived from every unique metadata dimension, and the validator likewise rechecks the exact POST URL, method, and body hash offline. A malformed or incomplete metadata response causes no series request.

## PISRS Registry Contract

The route, companion, and salary registries share one small internal parser, not a public provider abstraction. It must prove:

- the requested record identity is exactly `ZAKO5761`, `ZAKO6655`, or the candidate salary SOP;
- the record is currently marked as a valid official instrument;
- the single-record official registry response contains one unambiguous sequence `Osnovni`, `NPB 1`, ..., `NPB N` with unique IDs and no gaps or duplicates;
- the selected version is the unique maximum `N`; the registry is not used to infer its effective date;
- the selected details contain the required provisions; when PISRS supplies target-level `navezavaNPB`, its applicability date must be at or before `assessmentAt`;
- the details response belongs to the selected registry ID.

The validator does not assume that array order means “latest”. It derives and checks the ordinal, binds the details artifact to the selected ID, and then proves current applicability from the official `Veljaven predpis` registry status plus the target sections in that selected current consolidated text. Where a target section includes `navezavaNPB`, that date is an additional mandatory cutoff check. It does not invent a missing effective date or silently fall back to an older NPB. Partial HTTP content, malformed JSON, an internal gap, an unknown status, an explicitly future target provision, a duplicate maximum, a registry/details mismatch, or a newly introduced pagination/total contract that the parser does not understand fails closed. A claim without a target-level effective date uses the selected official NPB identity as its source period, not a fabricated calendar date.

PISRS currently returns `npbVerzije` in one non-paginated record and publishes no independent total or continuation token. The system can prove that it received and parsed that authoritative response whole and that the returned sequence is internally gapless; it cannot prove that the authority did not itself omit a syntactically valid tail when no total exists. This is an explicit source-authority limitation. The product must not describe the check as stronger than the official interface permits.

## Route Validation

The route bundle is all-or-nothing and still emits exactly seven claims in canonical order:

1. `route_basis`
2. `citizenship_applicability`
3. `remote_work_relations`
4. `qualification`
5. `companion_entry`
6. `duration`
7. `general_statutory_prerequisites`

GOV.SI must provide the expected route identity and publication date plus the readable national summary. PISRS must provide law `ZAKO5761`, the selected current consolidated text, one Article 51.a section, and one Article 55 section.

Article sections are bounded by their actual structural entries and the next article heading. They are not selected by incidental CSS classes or artificial begin/end lines. Required provisions must establish the third-country digital-nomad route, foreign work relationships, exclusion of Slovenian labour-market work, immediate family reunification, duration and reapplication rules, passport validity, health insurance, the twice-net-salary rule, and the applicable Article 55 grounds.

The qualification claim remains deliberately narrow: it states only that no qualification requirement is listed in the proven complete authoritative requirements. The citizenship claim never upgrades general third-country eligibility into a nationality-specific or consular guarantee.

The current official route text explicitly excludes EU and EEA citizens. The validator therefore emits only those two exclusions. It must not retain the synthetic fixture's unsupported `Switzerland` value unless a captured authoritative source states it explicitly.

Each claim anchor is made from the exact matched official text in its artifact. Changed or duplicate target articles, missing prerequisites, contradictory GOV.SI/PISRS semantics, or inability to prove the complete requirement boundary rejects the entire route bundle.

## Income Validation

The income bundle proves one dynamic claim; no salary amount is stored in source code or fixtures as accepted truth.

The PISRS salary candidate must encode one SOP. The registry and details artifacts must bind to that SOP, identify a publication date at or before `assessmentAt`, identify one salary month, and identify one official average monthly net-salary value.

SiStat validation must then:

- accept the real PxWeb metadata schema without synthetic fields;
- require unique complete dimensions and aligned value/label arrays;
- identify exactly one time dimension and exactly one `Net` salary coordinate;
- request all values for every dimension;
- validate JSON-stat2 `id`, `size`, dimension categories, coordinate cardinality, and value count;
- choose the unique maximum time period at or before `assessmentAt`;
- read the net value using the declared dimension order rather than a fixed offset.

The PISRS period and value must equal the selected SiStat period and value. A mismatch is `semantic_mismatch`. The resulting threshold is calculated with `Decimal` as `2 × latest official average monthly net salary`.

Anchors are deterministic local excerpts built from the actual PISRS publication fields, the relevant SiStat metadata labels, and the selected JSON-stat2 coordinate. They are never accepted from custom `anchorExcerpt`, `complete`, `pagination`, or `datasetId` fields.

## Companion Employment Validation

The companion bundle emits only `companion_local_work_access` with the existing narrow value: local employment is conditional, requires a labour-market check, and requires an information sheet.

ESS must state the applicable conditional procedure. PISRS must prove current law `ZAKO6655` and uniquely bounded Articles 32 and 33 from the selected consolidated version. The two sources must agree on `informativni list` and `kontrola trga dela` semantics.

The validator must not infer automatic labour-market access, a right to remote work for a foreign company, or a general immigration guarantee. Missing or changed target articles, an incomplete current-state listing, or an ESS/law contradiction rejects the bundle.

## Versioning and Replay

Because the Slovenia `@1` format is unreleased and exists only on this feature branch, the repair replaces it rather than creating dual behavior:

- plan: `vs2-slovenia@2`;
- rules: `vs2-si-evidence@2`;
- route validator: `si-route@2`;
- income validator: `si-income@2`;
- companion validator: `si-companion@2`;
- CBR validator remains `cbr-eur@1`;
- dossier schema remains `si-dossier@1`.

All installed-version allowlists, claim-ID checks, publication guards, replay dispatch, comparator lineage checks, and focused tests move mechanically to `@2`. No Slovenia `@1` replay branch remains. VS-1 versions and previously verified VS-1 byte behavior remain unchanged.

Replay uses only the sealed raw artifacts. It re-runs the same registry selection, article extraction, SiStat coordinate selection, cross-source agreement, claim construction, and artifact/hash checks. It never contacts PISRS, SiStat, GOV.SI, ESS, CBR, or the model.

## Failure, Security, and Privacy Semantics

- Candidate URLs remain untrusted. Every request uses HTTPS, exact approved `URL.host`, explicit media types, bounded redirects, byte limits, the shared deadline, and no retries beyond the frozen plan.
- During current validation and offline replay, every machine artifact must still prove `origin:"live"`, status `200`, the expected role, exact request method and URL, exact final response URL, and—when present—the recomputed request-body SHA-256. Correct-looking bytes from another official path are not interchangeable evidence.
- Machine endpoints are derived from exact validated IDs, not arbitrary URLs returned by the model or content.
- Scripts from official HTML are never executed.
- Unsupported source shapes, extra ambiguity, or inability to prove completeness yields yellow; it never yields partial verified claims.
- Raw bytes remain only in immutable Evidence storage. The dossier stores stable source lineage and excerpt hashes, not copied documents.
- The discovery request remains the existing non-PII country/authority/claim-kind payload. Source parsing receives no user profile.
- Red and yellow UI explanations continue to use verified official links and concise blocker reasons. Parser failures do not expose raw source bodies or internal exceptions.

## Testing Strategy

Use small official-shaped fixtures mechanically reduced from the responses recorded in the field map, not full megabyte responses and not remembered semantic summaries. Fixtures exercise the same field paths, structural IDs, version names, article entries, dimension declarations, JSON-stat2 layout, and request provenance as the official APIs.

Required representative TDD cases:

- happy route, income, and companion bundles produce the existing nine-claim coverage;
- an internal gap or duplicate in the returned NPB sequence fails closed; the tests do not claim to detect an authority-side tail omission without a published total;
- wrong record identity or registry/details binding fails closed;
- missing, duplicated, reordered, or substantively changed target article fails closed;
- salary period/value mismatch between PISRS and SiStat fails closed;
- incomplete/ambiguous SiStat dimensions or latest period fails closed;
- ESS and law disagreement fails closed;
- mutations change anchors only when the matched official excerpt changes;
- offline replay produces identical claims and dossier hash with zero network/model calls;
- the existing CBR, VS-1, publication, tamper, and UI suites remain green.

The test suite stays representative. It does not enumerate arbitrary HTML whitespace, all PISRS records, every JSON-stat dimension order, or hypothetical provider behavior.

## Live Acceptance Gate

After the focused repair is green, Task 6 performs one fresh official-source run. It is accepted only if it records:

- exactly one model discovery call for the canonical run;
- no profile/PII in discovery or Evidence event payloads;
- at most `11` captures, concurrency at most `3`, and completion within `60s`;
- verified coverage `9/9` plus current CBR evidence;
- terminal red for the approved profile fixture, backed by the live FX/income formula;
- immutable dossier `v1` with complete source lineage;
- zero-network deterministic reload/replay and successful tamper rejection;
- idempotent same-payload publication and one controlled `v2` predecessor link.

Any official-source drift or unresolved ambiguity leaves the run yellow and blocks the `source-verified` claim. The eval must report that blocker; it may not substitute fixtures, cached values, or a normalization fallback.

Browser E2E remains a separate final gate and requires fresh explicit user permission immediately before opening the browser.

## Implementation Boundary

Expected production changes are limited to the existing Slovenia plan, source adapter, pure Slovenia parser, and mechanical installed-version checks in dossier/replay/application/decision code. Expected test changes are limited to the existing Slovenia fixtures and focused cold-start/source integration tests. The canonical VS-2 plan and Task 6 live eval may be updated mechanically to replace their capture assertion `10` with `11`; no other eval scope is added by this repair.

No new evidence store, event framework, provider registry, generic extractor, alternate research pipeline, or compatibility layer is authorized by this design. If the actual official response cannot be proven through these narrow contracts, implementation stops with an explicit yellow blocker and the design is revisited.
