# Task 3 report — persist country resolution revisions

## Implemented

- Added the append-only `country_resolution_revisions` schema, four uniqueness constraints,
  immutable triggers, and additive preflight rejection of an incompatible pre-existing table.
- Added closed resolution contracts, deterministic run/revision/context IDs, a synchronous
  `SqliteCountryResolutionStore`, canonical row bytes, SHA-256 hashes, HMAC over
  `{ revision, operation }`, source-kind/link checks, topology checks, and Task 2 policy
  reconstruction/transition verification.
- Added verified shortlist presentation by either shortlist ID or run ID through one shared loader.
- Added real two-connection, barrier-synchronized stale-head and idempotent races with unconditional
  worker cleanup.

## TDD evidence

### RED

`./node_modules/.bin/vitest run tests/integration/database-schema.test.ts tests/integration/place-frontier.test.ts tests/integration/country-resolution-store.test.ts`

Initially failed as expected: the resolution contracts/store module did not exist; the ninth table
and incompatible-table preflight were absent; and the shortlist-ID presentation method was absent.

### GREEN

Focused persistence/cascade gate:

`./node_modules/.bin/vitest run tests/integration/country-resolution-store.test.ts tests/integration/database-schema.test.ts tests/integration/place-frontier.test.ts tests/integration/confirmed-life.test.ts tests/branch/life-git.test.ts`

Result: 5 files, 167 tests passed.

Full gate:

`npm test` — 34 files, 742 tests passed.

`./node_modules/.bin/tsc --noEmit` — passed.

`./node_modules/.bin/eslint src/application/country-resolution-contracts.ts src/infrastructure/sqlite/country-resolution-store.ts src/infrastructure/sqlite/place-frontier-store.ts tests/integration/country-resolution-store.test.ts` — passed.

`git diff --check` — passed.

## Files changed

The exact eleven Task 3 implementation/test files were changed. The pre-existing untracked
`.superpowers/brainstorm/12369-1786346924/` directory was preserved.

## Self-review

`SqliteCountryResolutionStore` is 609 lines and remains one adapter responsibility: closed decoding,
row cryptography, relational source/topology checks, and delegation to the Task 2 policy. It is below
the agreed 800-line stop threshold, with named helper sections and no duplicated ID formulas.

Readability score: 8/10. The adapter is necessarily dense because it fail-closes at each persistence
boundary; a future split would need an approved file-scope change, not a speculative abstraction.
