# Task 2 implementation report

Status: implementation, independent review, and local gates complete.

Base: `ceb3be0b3c75724167e42a7ac2d0bf75736709de`

## Scope delivered

- Frozen Slovenia-only Country Registry for trimmed, case-folded `SI`, `Slovenia`, and `Словения`, with exact authority roots and no dossier, salary, eligibility conclusion, profile, or free-text echo.
- One bounded OpenAI discovery call using `gpt-5.6`, `store:false`, strict Zod structured output, low-context web search on the four installed hosts, 12-second timeout, and zero SDK retries.
- All-or-nothing discovery validation for at most six candidates, HTTPS, exact canonical host including port, matching authority root, unique nonempty requested claim kinds, refusal/schema/error/timeout blockers, and no claim creation.
- Frozen four-source Slovenia research plan with order route, income, companion, CBR; versions `si-route@1`, `si-income@1`, `si-companion@1`, `cbr-eur@1`; rules `vs2-evidence@1`; limits 3 concurrent, 10 captures, 60 seconds.
- Canonical eight-step source adapter: GOV.SI + ZTuj-2; salary publication + SiStat metadata + all-dimension/all-period JSON-stat2 POST; ESS + ZZSDT; existing direct CBR adapter.
- Deterministic, text/data-driven, all-or-nothing route, income, and companion validators with exact artifact locators/excerpt hashes, complete effective-state proof, latest applicable selection, Decimal income formula, no gross/net conversion, and closed literal claim schemas.
- Cross-source duplicate/missing coverage fail-closed rules and relative canonical claim ordering.

## RED → GREEN evidence

1. Registry/privacy/discovery
   - RED: focused run loaded the new boundary and reported 19 behavioral failures from the unimplemented registry/discovery functions.
   - GREEN: 19 focused tests passed for aliases, unsupported no-echo, exact privacy payload/configuration, all-or-nothing candidate validation, and typed failure results.
2. Plan/source adapter
   - RED: canonical capture test failed because every source returned `navigation_mismatch` from the source skeleton.
   - GREEN: 4 focused tests passed for exact plan metadata, eight request steps, metadata-derived SiStat query, direct CBR reuse, and zero-request missing/ambiguous slots.
3. Route validator
   - RED: the valid two-artifact route bundle returned `semantic_mismatch`; seven negative mutations already failed closed.
   - GREEN: 8 focused tests passed after exact seven-claim bundle validation. A subsequent navigation/final-URL mutation failed and then passed after preserving the request URL separately from the resolved URL.
4. Income validator
   - RED: both valid and changed-value cases returned `semantic_mismatch`; invalid listing/metric/period cases already failed closed.
   - GREEN: 8 focused tests passed, including the `1601.00 → 3202.00` mutation proving the threshold is derived rather than remembered. Malformed publication date/value mutations then failed and passed after strict ISO/guarded Decimal parsing.
5. Companion validator
   - RED: the valid two-artifact companion bundle returned `semantic_mismatch`; seven forbidden/incomplete mutations already failed closed.
   - GREEN: 8 focused tests passed for only conditional local access and all negative mutations.
6. Cross-source rules and security mutations
   - RED: reversed claim order remained reversed and missing/duplicate coverage stayed verified; a noncanonical HTTPS port was accepted.
   - GREEN: 3 cross-source mutation tests plus exact-host-port tests passed after deterministic sorting, conflict blocking, and exact `URL.host` comparison.
7. Independent-review regressions
   - RED: 7 focused failures proved extra enumerable country fields were serialized, the plan was mutable, all route claims reused one hash, moved/reversed article boundaries were accepted, and companion anchors were generic.
   - GREEN: 7 focused tests passed after canonical payload reconstruction, deep-frozen plan configuration, ordered bounded Article 51a/55/32/33 validation, and exact claim-specific supporting excerpts.

## Files

Created production files:

- `src/research/cold-start-contracts.ts`
- `src/research/country-registry.ts`
- `src/research/slovenia-plan.ts`
- `src/research/parsers/slovenia.ts`
- `src/infrastructure/sources/official-source-discovery.ts`
- `src/infrastructure/sources/slovenia-source-adapter.ts`

Extended test file:

- `tests/research/cold-start.test.ts`

Created semantic fixtures:

- `tests/sources/fixtures/slovenia/route-gov.html`
- `tests/sources/fixtures/slovenia/ztuj2.html`
- `tests/sources/fixtures/slovenia/salary-publication.html`
- `tests/sources/fixtures/slovenia/sistat-metadata.json`
- `tests/sources/fixtures/slovenia/sistat-series.json`
- `tests/sources/fixtures/slovenia/companion-ess.html`
- `tests/sources/fixtures/slovenia/zzsdt.html`

## Fresh verification

- `./node_modules/.bin/vitest run tests/research/cold-start.test.ts` — 1 file, 81 tests passed.
- `./node_modules/.bin/vitest run tests/research/cold-start.test.ts tests/sources/gateway.test.ts tests/integration/current-evidence.test.ts` — 3 files, 118 tests passed.
- `./node_modules/.bin/vitest run` — 22 files, 367 tests passed.
- `./node_modules/.bin/tsc --noEmit` — exit 0.
- `./node_modules/.bin/eslint .` — exit 0.
- `git diff --check` — exit 0.

## Self-review and concerns

- The Research core does not import Infrastructure. `createSloveniaPlan` remains pure; `createSloveniaResearch` composes it with the source adapter in Infrastructure.
- Discovery serializes only `{country, authorityRoots, requiredClaimKinds}` as the user input and never returns claims.
- Candidate URLs remain untrusted navigation proposals; only captured bytes passing installed validators produce claims.
- CBR is absent from discovery and delegates to the existing direct capture/parser path.
- No database, application, UI, dossier, second runner, provider framework, crawler, runtime cache, dependency, network, or browser work was added.
- Semantic fixtures encode explicit completeness proof because the retained spike did not preserve a live PISRS DOM selector. Task 6 live evaluation remains responsible for narrowly adapting source-shape parsing if current official representations differ; no live-source readiness claim is made here.
- The unrelated untracked `.superpowers/brainstorm/12369-1786346924/` files were not read, changed, staged, or removed.

Independent review initially reported four issues: unordered article boundaries, possible extra-field discovery leakage, non-claim-specific route anchors, and mutable plan configuration. All four were accepted, reproduced with failing tests, fixed, and included in the fresh verification above. No unresolved code-review finding remains.

## External review fix round 1

Fix base: `59f013d0b874185383de9975e08bcfd18befb8ae`

### Behavior-sensitive RED → GREEN evidence

1. Gateway redirect ports
   - RED: three focused tests admitted a non-default port at the initial URL, an intermediate redirect, and the final response URL (initial attempted fetch, intermediate followed the unsafe hop, final produced an artifact).
   - GREEN: canonical allowlist comparison now uses `URL.host` on every existing gateway check; all 3 focused tests passed while default HTTPS port normalization remains valid.
2. Effective-state selection and article bounds
   - RED: route and companion validators accepted a `FUTURE` state dated before the assessment cutoff; they also accepted globally reversed Article 51a/55 and Article 32/33 sections.
   - GREEN: selection preserves `EFFECTIVE`/`FUTURE`, chooses only the unique latest applicable `EFFECTIVE` state, rejects contradictory applicable `FUTURE` rows, and requires global non-overlapping article-marker order. The 4 focused state/order mutations passed.
3. JSON-stat dimensional identity
   - RED: a valid singleton third dimension was rejected, while an extra dimension key and one dimension serving as both metric and time were accepted.
   - GREEN: dimension keys must exactly equal `id`; metric and time codes must differ; every other dimension must resolve unambiguously to its only coordinate. The 15-test income group passed, including explicit missing, extra, same-code, singleton, and multi-valued-unselected cases.
4. Exact semantic provenance
   - RED: harmless inserted page lines changed route/companion evidence hashes, and reordered required statements inside Article 51a/33 still validated.
   - GREEN: evidence excerpts are assembled from unique actual supporting lines rather than positional slices or section contents; required semantic lines are strictly ordered. All 4 focused insertion/reordering tests passed.
5. JIT publication identity
   - RED: a different well-formed PISRS `sop` with matching content failed because `2026-01-1950` was literal, while a captured URL/content mismatch passed.
   - GREEN: publication identity is derived from matching canonical candidate and captured request URLs, then bound to the content ID, excerpt, locator, selected SiStat period, and value. Both focused mutations passed; no salary value was stored in production.
6. Candidate immutability
   - RED: discovered `claimKinds` remained mutable, and caller URL mutations after adapter construction changed subsequent capture requests.
   - GREEN: discovery copies and freezes `claimKinds`; the adapter snapshots and freezes candidate scalars and arrays before slot validation. Both focused mutation tests passed.

### Files changed in this round

- `src/infrastructure/sources/gateway.ts`
- `tests/sources/gateway.test.ts`
- `src/infrastructure/sources/official-source-discovery.ts`
- `src/infrastructure/sources/slovenia-source-adapter.ts`
- `src/research/parsers/slovenia.ts`
- `tests/research/cold-start.test.ts`
- `.superpowers/sdd/2026-08-11-vs-2-honest-cold-start/task-2-report.md`

No fixtures or other production/test files were changed. The unrelated untracked brainstorm directory remains untouched.

### Fresh final gates

- `./node_modules/.bin/vitest run tests/research/cold-start.test.ts tests/sources/gateway.test.ts` — 2 files, 124 tests passed.
- `./node_modules/.bin/vitest run tests/research/cold-start.test.ts tests/sources/gateway.test.ts tests/integration/current-evidence.test.ts` — 3 files, 137 tests passed.
- `./node_modules/.bin/vitest run` — 22 files, 386 tests passed.
- `./node_modules/.bin/tsc --noEmit` — exit 0.
- `./node_modules/.bin/eslint .` — exit 0.
- `git diff --check` — exit 0.

### Self-review and concerns

- The gateway expansion is one-token narrow (`hostname` to canonical `host`) and retains the existing initial, redirect, and final validation flow.
- The Slovenia validators remain deterministic and all-or-nothing; no network, browser, dependency, crawler, cache, provider framework, database, application, UI, dossier, or second-runner work was added.
- Publication validation contains no fixed publication ID or salary value; the fixture ID appears only in tests and semantic fixture content.
- Review-round tests increased `tests/research/cold-start.test.ts` from 81 to 97 tests and `tests/sources/gateway.test.ts` by 3 tests.
- A fresh independent review found no actionable issue and confirmed the diff is limited to the seven approved files in this round (including this report), with the unrelated brainstorm untouched.
- No known concern remains after the fresh gates.
