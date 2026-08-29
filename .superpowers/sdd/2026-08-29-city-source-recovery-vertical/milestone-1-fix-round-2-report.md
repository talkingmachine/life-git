# Milestone 1 fix round 2 report

- RED: `pnpm exec vitest run tests/integration/city-source-recovery-store.test.ts --reporter=dot` exited 1 with the two intended failures: altered SourceVersion and altered attempt under an existing command were accepted.
- Files changed: `schema.sql`, recovery store, recovery-store integration test, this report.
- Implementation: recovery DDL is extracted from marked production SQL into a FK-ON minimal-reference fixture; repeated commands now verify canonical persisted SourceVersion, revision, attempt, and derived replacement event (including event hash/HMAC) before returning idempotently.
- GREEN: `pnpm exec vitest run tests/application/city-source-recovery-contracts.test.ts tests/integration/city-source-recovery-store.test.ts tests/integration/database-schema.test.ts --reporter=dot` exited 0: 3 files, 118 tests. `pnpm typecheck`, `pnpm lint`, and `git diff --check` exited 0.
- Self-review: source-recovery fixture executes the marked production DDL and keeps `foreign_keys = ON`; missing truth references remain protected by SQL FKs, while cross-store semantic replay remains Milestone 3 work.
- Commit SHA: final local checkpoint, reported with this milestone handoff.
- Remaining concern: this M1 seam proves reference existence, not the real Evidence → Knowledge → Frontier publication transaction, which is deliberately deferred to Milestone 3.
