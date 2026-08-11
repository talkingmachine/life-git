# Task 3 report: immutable country dossiers

## Scope

- Added the exact `dossier_versions` table, its two partial unique indexes, and its two immutable triggers.
- Added strict country-payload construction, synchronous atomic Evidence+dossier publication, verified version-chain loads, payload idempotency, and offline rules dispatch.
- Corrected the Task 2 Slovenia rules literal to `vs2-si-evidence@1` and updated its existing assertion.
- Preserved the unrelated untracked `.superpowers/brainstorm/12369-1786346924/` directory.

## RED / GREEN evidence

1. Schema and rules version:
   - RED: focused Vitest run failed because `dossier_versions` was absent and the plan still returned `vs2-evidence@1`.
   - GREEN: the same two focused cases passed after the schema and literal changes.
2. Payload and publisher:
   - RED: `tests/integration/cold-start.test.ts` failed because `dossier-store` did not exist.
   - GREEN: Task 3, schema, and existing Evidence store tests passed after the normalized payload, sync insert helper, and atomic store were added.
3. Replay:
   - RED: the replay test failed with `replayEvidenceByRules is not a function`.
   - GREEN: two Slovenia replays from verified stored bytes matched the original canonical snapshot.
4. Integrity self-review regressions:
   - RED: an unexpected claim ID published, and a cryptographically valid missing predecessor surfaced `dossier_not_found`.
   - GREEN: both now fail closed as `publication_not_allowed` / `integrity_mismatch` respectively.

## Files

Created:

- `src/research/dossier.ts`
- `src/infrastructure/sqlite/dossier-store.ts`
- `tests/integration/cold-start.test.ts`
- `.superpowers/sdd/2026-08-11-vs-2-honest-cold-start/task-3-report.md`

Modified:

- `src/infrastructure/sqlite/schema.sql`
- `src/infrastructure/sqlite/evidence-store.ts`
- `src/application/replay-evidence.ts`
- `src/research/slovenia-plan.ts`
- `tests/integration/database-schema.test.ts`
- `tests/research/cold-start.test.ts`
- `tests/branch/life-git.test.ts` (controller-approved table-list row only)
- `tests/integration/confirmed-life.test.ts` (controller-approved table-list row only)

`src/infrastructure/sqlite/db.ts` did not require a change.

## Verification

- Controller-authorized compatibility rerun: 83/83 passed.
- Prescribed four-file gate: 46/46 passed.
- Full Vitest suite: 404/404 passed.
- `tsc --noEmit`: passed.
- `eslint .`: passed.
- `git diff --check`: passed.
- Earlier full-suite RED: 402/404 passed; the only failures were the two legacy exact-five-table assertions observing the mandated sixth `dossier_versions` table. The controller appended explicit authorization, each expected list received only the `dossier_versions` row, and the fresh full suite passed 404/404.

## Self-review and concerns

- The payload reconstructs only the published fields and excludes artifact IDs, capture timestamps, context/profile binding, CBR/FX, and personal verdicts.
- Publication first verifies the prepared Evidence signature and eligibility, then synchronously inserts Evidence and the dossier inside one `better-sqlite3` transaction. A dossier failure rolls the Evidence seal back.
- Same normalized payloads persist the new current Evidence snapshot but return the original verified dossier. Stable value, source URL, source period, and excerpt-hash changes create one successor while leaving the predecessor byte-identical.
- Current validator versions are exact. An unknown validator version fails closed; a future installed validator version would require an explicit supported-version code change before it could produce a successor.
- No queue, head/source/run table, ORM, repository/service layer, browser, network call, or dependency installation was added.
- No open implementation blocker remains. The future-validator-version point above is an explicit version-dispatch boundary, not an unhandled compatibility path.

## External review fix round 1

### RED / GREEN

- Concurrency RED: two local Worker threads released by one `Atomics` start barrier opened two file-backed SQLite connections with a finite 3000 ms busy timeout. Simultaneous same-payload and different-payload publications both failed on the review base with `database is locked`.
- Concurrency GREEN: the existing `better-sqlite3` transaction now enters through `.immediate()`, acquiring writer ownership before artifact reads. Both simultaneous cases complete: same payload stores two Evidence snapshots and one v1 winner; different payload stores one root and its sole v2 successor.
- Structure RED: correctly re-signed extra/reordered source entries, verified CBR with a blocker, and malformed identical-payload Evidence reached publication. A self-review regression also proved that a directly inserted, correctly re-signed manifest whose embedded snapshot artifact list drifted from the signed snapshot was accepted. The representative missing/duplicate/artifact-list cases already failed through narrower checks.
- Structure GREEN: the pure `assertSealedEvidenceStructure` proves exact source order/cardinality, embedded-snapshot equality, coverage/parser keys, artifact equality/uniqueness/ownership, verified claim anchor membership, and blocker consistency. Builder, insert, and verified load all invoke it; malformed new, direct-insert, and idempotent paths commit nothing.
- Provenance RED: a non-terminal evidence ref whose nested anchor named a different or missing artifact still published.
- Provenance GREEN: every country ref now requires `reference.anchor.artifactId === reference.artifactId` in the same source entry.
- Copy RED: dossier freezing also froze the prepared Evidence claim value and nested exclusions array.
- Copy GREEN: every closed claim kind is reconstructed field-by-field, including fresh nested arrays, before the dossier output is frozen. The prepared graph remains mutable and unaliased.

### Verification

- Focused external-review file: 32/32 passed.
- Task 3 four-file gate: 60/60 passed.
- Full suite: 418/418 passed across 23 files.
- `tsc --noEmit`: passed.
- `eslint .`: passed.
- `git diff --check`: passed.
