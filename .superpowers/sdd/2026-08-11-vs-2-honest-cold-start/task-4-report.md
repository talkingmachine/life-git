# Task 4 report — confirmed relocation profile and cold-start assessment

Status: DONE

Base: `1f56234260999b30d27a562edd6048d05b4f5b9d`

## RED evidence

- Profile boundary: `./node_modules/.bin/vitest run tests/integration/cold-start.test.ts` failed because `src/decision/relocation-profile.ts` did not exist.
- Comparator: the same focused command failed because `src/decision/cold-start-assessment.ts` did not exist.
- Orchestration: the focused command failed because `src/application/cold-start.ts` did not exist.
- Composition: the focused suite then failed with `composed.prepare` undefined before Cold Start was added to the existing composition root.
- The first lint gate caught an inward dependency violation in both Decision modules. The root cause was their import of Infrastructure integrity helpers; replacing those imports with core-local canonicalization and Node SHA-256 restored the dependency boundary.

## Implemented

- Added strict `relocation-profile@1` confirmation with non-PII runtime schemas, canonical Decimal/date/companion normalization, one-clock immutable snapshots and stable canonical SHA-256 IDs.
- Reused `profile_snapshots` through explicit `appendRelocation` / `loadRelocationVerified` methods while leaving the VS-1 append/load path unchanged.
- Added the version-closed pure Slovenia comparator: verified Decimal income formula, official claim lineage checks, hard-veto dominance, yellow missing-evidence/research/city states and no green branch.
- Added Cold Start prepare/run/present coordination with profile/run context binding, privacy-safe serial events, one Research preparation, exact commit boundaries, atomic dossier publication or blocked Evidence seal, verified reload/offline replay and payload-hash dossier lookup.
- Added the narrow SQLite/OpenAI/gateway composition and spread it over the existing composition root without adding schema, run rows, event persistence, UI, routes or provider frameworks.
- Consolidated comparator and orchestration tests onto the existing semantic Slovenia replay fixture; no second CBR/research fixture family remains.

## Changed files

- `src/decision/relocation-profile.ts`
- `src/decision/cold-start-assessment.ts`
- `src/application/cold-start.ts`
- `src/infrastructure/cold-start-composition.ts`
- `src/infrastructure/sqlite/profile-store.ts`
- `src/infrastructure/composition-root.ts`
- `tests/integration/cold-start.test.ts`

## Final gates

- Focused Task 4 + legacy compatibility: 4 files, 112 tests passed.
- Full suite: 23 files, 452 tests passed.
- `./node_modules/.bin/tsc --noEmit`: passed.
- `./node_modules/.bin/eslint .`: passed.
- `git diff --check`: passed.

## Residual risks

- The application/composition path is proven with current semantic Slovenia fixtures and deterministic injected ports. Live-source shape/drift and the one permitted browser scenario remain Task 6 gates; Task 4 performs no network or browser validation.

## Review fix round 1

- RED: the focused suite reported three failures: both UTC passport boundary cases were falsely red, and a pre-aborted run still called discovery.
- Replaced overflowing month mutation with explicit UTC year/month calculation and target-month last-day clamping. `2026-01-31 + 15` now ends at `2027-04-30`; the leap target clamps `2022-11-30 + 15` to `2024-02-29`.
- Added abort checks before discovery and immediately after its awaited result, before any Research work.
- Removed the broad discovery catch: typed `ok:false` still drives honest blocked Evidence, while unexpected thrown errors propagate without Evidence/dossier commits.
- Removed the unsafe legacy `RequestStep` cast; Cold Start now keeps its own typed default gateway wiring.
- Focused Task 4 + legacy gate: 4 files, 114 tests passed.
- Full suite: 23 files, 454 tests passed. TypeScript, ESLint and `git diff --check` passed.
