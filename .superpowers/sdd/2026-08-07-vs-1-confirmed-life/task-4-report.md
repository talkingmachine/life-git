# Task 4 report: current-run orchestration and bounded recovery

## Outcome

Implemented the Task 4 direct pipeline from strict server confirmation through one fresh Research run, verified sealed evidence, one scoped Decision assessment, and one immutable HMAC-sealed assessment revision. Manual recovery creates a new current run while preserving the exact confirmed profile, Branch-owned initial housing, and all previous rows.

Base: `243beeadeec20fe553639ce0ce0b933c63fcc2c7`

Commit subject: `feat: orchestrate confirmed-life run`
Final commit hash: reported in the final handoff because a commit cannot contain its own hash.

## TDD evidence

### RED 1: direct happy path

Command:

```text
pnpm vitest run tests/integration/confirmed-life.test.ts
```

Observed failure:

```text
Cannot find module '../../src/application/confirmed-life'
Test Files 1 failed; Tests no tests
```

The new test required profile append before live persistence/seal, exactly one Research and Decision call, the exact `now + 45s` deadline, verified evidence before assessment, normalized Branch housing, and a bound revision.

### GREEN 1

After the minimal contracts/use case/stores/schema implementation:

```text
Test Files 1 passed; Tests 1 passed
```

### RED 2: bounded manual recovery

Observed failure after adding the yellow/retry immutability test:

```text
TypeError: application.retryConfirmedLife is not a function
Test Files 1 failed; Tests 1 failed | 1 passed
```

The first run already completed as sealed yellow. The missing behavior was a new current run that reused the exact verified profile and housing without changing old profile/evidence/revision/artifact bytes.

### GREEN 2

After minimal verified retry orchestration:

```text
Test Files 1 passed; Tests 2 passed
```

### RED 3: redacted details and composition

Observed failures:

```text
TypeError: application.loadRunDetailsCore is not a function
Cannot find module '../../src/infrastructure/composition-root'
```

The resulting read use case returns only the validated profile plus redacted evidence facts/metadata/official links and never returns HMACs, keys, raw bytes, or parser entries. The server actions expose only public start/retry operations.

### Review RED: fail-closed typed claims

Independent review found that covered but semantically wrong claims (`{sourceId, accepted:true}`) were incorrectly promoted to green. The regression reproduced it exactly:

```text
expected 'green' to be 'yellow'
Test Files 1 failed; Tests 1 failed | 11 passed
```

Composition now accepts Law 79, Decision 858, and Tirana predicates only when a verified stable claim ID carries the exact runtime-validated typed value. The wrong-facts case is yellow; a separate exact typed sealed fixture is green.

### Final targeted GREEN

```text
Test Files 1 passed; Tests 15 passed
```

## Fix round 1

Base: `5bf5bdf0f665b9d8c2c1b08edf3e7c0e741d58af`

Finding mapping:

- Important: replaced “one matching claim is enough” projection with exact current-parser claim-set validation. Law 79 requires IDs `1..3`, Decision 858 `1..2`, and Tirana `1..2`; every claim must have the exact typed value, common correctly formatted period, declared scope, and complete snapshot-owned anchor. Missing, extra, unexpected, mixed, or malformed claims fail closed.
- False-red defense: mixed Law evidence with `albanian_employer_only` remains yellow because the exact official hard-mismatch rule is not established.
- Minor: added a partial unique index on `run_revisions(run_id) WHERE stage = 'assessment'`; it rejects a second assessment revision at write time without globally reserving `run_id` for future branch-stage rows.

Mixed-claim RED:

```text
TypeError: projectDecisionEvidence is not a function
Test Files 1 failed; Tests 3 failed | 15 passed
```

Duplicate-revision RED:

```text
expected promise to reject, but appendAssessment resolved a second revision
Test Files 1 failed; Tests 1 failed | 18 passed
```

Focused GREEN after both fixes and the compact defensive mutation table:

```text
Test Files 1 passed; Tests 28 passed
pnpm typecheck — PASS
pnpm lint — PASS
```

Fix round 1 full gate:

```text
pnpm test — PASS, 8 files / 105 tests
pnpm typecheck — PASS
pnpm lint — PASS
pnpm exec next build — PASS, compiled and generated successfully
git diff --check — PASS
```

## Files

Created:

- `src/application/contracts.ts`
- `src/application/confirmed-life.ts`
- `src/infrastructure/composition-root.ts`
- `src/infrastructure/sqlite/profile-store.ts`
- `src/infrastructure/sqlite/run-store.ts`
- `src/app/actions.ts`
- `tests/integration/confirmed-life.test.ts`
- `.superpowers/sdd/2026-08-07-vs-1-confirmed-life/task-4-report.md`

Modified:

- `src/infrastructure/sqlite/schema.sql`
- `tests/integration/evidence-store.test.ts` — replaced the obsolete “forever exactly two tables” Task 3 change detector with preservation of both Task 3 tables; Task 4 owns the exact four-table/no-branch assertion.

## Key decisions

- Application receives one `ResearchPort.runCurrentEvidence`; source sequencing, retries, parsing, raw persistence, and sealing remain owned by Task 3.
- Composition converts a verified snapshot into Decision evidence using exact typed claim predicates. Coverage alone proves nothing.
- The application read port receives only redacted source navigation/resolved URLs. Raw `ParserEntry`, artifacts, and bytes remain inside infrastructure verification.
- Profile storage hashes canonical bytes and reconstructs the frozen Decision snapshot on verified load.
- Each revision HMAC signs its IDs, run/date, exact initial housing, profile/evidence references, `assessmentId`, rules version, and the complete stored assessment representation.
- Retry verifies prior revision HMAC, confirmed profile hash, and sealed evidence reference before starting exactly one new current Research run.
- `EvidenceReadItem` declares the published calculation variant, but Task 4 does not fabricate a formula result before Task 5 exists.
- The inherited Task 1 Decision assessment remains the minimal marker/reasons domain value. Task 4 binds it to assessment/profile/evidence/date/rules through the signed revision and `RunResult`; broader Decision-domain enrichment is deliberately deferred.
- No branch tables, ORM, generic repository, queue, worker, polling, websocket, ranking, UI, or alternate evidence pipeline were added.

## Verification

Environment: Node 24 runtime and pnpm 11 runtime supplied in the task brief.

```text
pnpm vitest run tests/integration/confirmed-life.test.ts
  PASS — 1 file, 15 tests

pnpm test
  PASS — 8 files, 92 tests

pnpm typecheck
  PASS — tsc --noEmit

pnpm lint
  PASS — eslint .

git diff --check
  PASS — no output

pnpm build
  NOT AVAILABLE — package.json has no build script

pnpm exec next build
  PASS — optimized production build compiled, TypeScript passed,
  static generation completed; Next-generated tsconfig/next-env changes
  were reverted to keep the Task 4 diff scoped.
```

## Self-review

- Strict malformed/PII/client-ID/timestamp/housing inputs produce zero profile/evidence/revision writes and zero Research calls.
- Ordering is profile append → current evidence persist/parse/seal → verified load → one Decision call → revision append.
- Deadline is validated as exactly 45,000 ms from the injected clock.
- Yellow is a normal persisted terminal outcome; no fallback pipeline is used.
- Retry creates new run/evidence/revision IDs and one new live Research call; old rows compare byte-identical.
- Historical evidence cannot satisfy the new expected current-run evidence ID.
- HMAC tests cover date, housing, profile, evidence, assessment ID, full assessment representation, rules, and HMAC tampering.
- SQL triggers reject profile/revision update and delete; schema has exactly the two Task 3 and two Task 4 tables.
- `loadRunDetailsCore` output contains no HMAC field, key, raw bytes, PII, or parser entry.
- Independent review’s blocking semantic-promotion and raw-boundary findings were addressed. Fix round 1 additionally rejects mixed claim sets and enforces one assessment revision per run at write time. Deep-freezing parsed revision aggregates remains a non-blocking follow-up; verified loads still fail closed and SQLite rows are append-only.
