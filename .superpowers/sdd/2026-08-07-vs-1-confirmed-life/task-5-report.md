# Task 5 report: Deterministic budget and Life Git

## Scope

- Base: `fd80b5e23441582c5692282e672fa39301563069`.
- Реализован только VS-1 Task 5: corrective RUB income migration, pure Decimal budget,
  housing-only Life Git, append-only SQLite commit store, branch run revisions и offline replay.
- UI, narrative, generic VCS/diff/rules engine, ORM, queue, network replay и Task 6 не добавлялись.

## TDD evidence

1. Profile income RED: `tests/domain/profile.test.ts` дал 2 ожидаемых Zod failure — старый
   contract требовал `futureIncomeAll`/root `currency` и отвергал `monthlyIncome`.
   GREEN: 4/4; strict nested `{amount, currency:"RUB"}`, normalized Decimal text, stable profile ID
   и nested immutability.
2. Budget RED: missing `src/branch/budget.ts`. GREEN: exact
   `210000 / 93.1901 * 93.13 = 209864.57`, residual `139864.57`, final-only HALF_UP,
   typed taxes/living-cost unknowns и exact stable hashes.
3. Life Git RED: missing `src/application/fork-housing.ts`. GREEN: 6/6 initial behavioral tests
   for green guard, stored income/housing, C0/C1, rewind, causal diff, tamper and five-table schema.
4. Housing-only diff RED: 3 tests showed rate/ref/period changes were incorrectly labelled reused.
   GREEN: diff now compares all non-housing calculation inputs before returning `reused`.
5. Replay RED: missing `src/application/replay.ts`. GREEN: assessment + budget rerun and zero writes.
6. Full composition RED: `saveInitialHousingBranch` absent from composition. GREEN: real sealed
   evidence projection, Task 3 offline byte/HMAC replay, no source capture, no append; changed CBR byte
   rejects with `integrity_mismatch`.

## Fix round 1 TDD evidence

1. Atomicity RED: duplicate branch revision IDs left orphan C0 `{commits:1,revisions:0}` and C1
   `{commits:2,revisions:1}`. GREEN: housing-specific SQLite writer appends commit + branch revision
   in one transaction; both failures roll back and exact retries with new revision IDs succeed.
2. Decimal context RED: global `Decimal.set({precision:5,rounding:ROUND_DOWN})` changed income to
   `209850.00` and residual to `139850.00`. GREEN: private `Decimal.clone` fixes precision 64 and
   HALF_UP; the formula descriptor binds numeric context plus income/residual expressions. A narrow
   pure delta helper remains stable under mutated global Decimal without exposing the constructor.
   A second RED caught legal negative residuals rejected by the unsigned money parser; GREEN uses a
   strict signed-decimal parser only for display deltas, while income/housing inputs stay nonnegative.
3. DTO RED: created/loaded nested rate objects were mutable, and extra root/nested BudgetInput
   bindings could enter a commit and be ignored by housing-only diff. GREEN: strict exact-key
   canonical copy, deep freeze, frozen replay return and comparison of the entire input after removing
   only housing.
4. Replay RED: an HMAC-valid unsupported rules version reached Decision, while an HMAC-valid branch
   date mismatch replayed successfully. GREEN: exact supported assessment rules are required before
   Decision, and all duplicated date/rules links must match.
5. Integrity RED: 63/65-character hex aliases passed `secureHexEqual`; a 65th HMAC nibble passed the
   branch store. GREEN: all SHA-256/HMAC comparisons require exactly 64 case-insensitive hex chars.
6. Stage-shape RED: schema accepted mixed assessment/branch columns and orphan commit references;
   loaders accepted bypassed NULL/non-NULL shape tampering with matching HMAC. GREEN: stage-specific
   CHECK, branch-commit FK and defensive assessment/branch load validation.
7. Boundary refactor: Branch-owned calculation/diff DTOs no longer depend on Application, and
   Application replay no longer imports Infrastructure canonical helpers.

## Fix round 2 TDD evidence

1. Branch hash shape RED: six malformed `formulaHash`/`outputHash` inputs (63, 65 and non-hex)
   were appended, and six matching HMAC-valid stored revisions loaded successfully. GREEN: exported
   `isSha256Hex` is the single exact case-insensitive 64-hex validator used by `secureHexEqual`,
   `appendBranch` and `loadBranchByCommitId`; all malformed bindings fail with `integrity_mismatch`.
2. SQL hash shape RED: six HMAC-valid updates with the same malformed formula/output bindings passed
   the stage CHECK. GREEN: branch rows additionally require length 64 and no non-hex characters;
   assessment rows still require both hash columns to be NULL.
3. Schema preflight RED: a representative e506 database containing an unsafe mixed row, a database
   with the current CHECK but no branch-commit FK, and one with the FK but no current CHECK all opened
   for application use. GREEN: `openEvidenceDatabase` fingerprints the exact normalized stage/hash
   CHECK from `sqlite_master.sql`, verifies the real FK through `PRAGMA foreign_key_list`, rejects and
   closes stale schemas with `database_schema_reset_required` before executing any DDL.
4. A fresh exact-current database reopens idempotently with the same five application tables. No
   migration/rebuild framework, schema-version table, compatibility path or sixth table was added;
   Task 7 remains the explicit reset boundary.

## Decisions and bindings

- Confirmed profile is the only income authority; `saveInitialHousingBranch(runId)` has no client
  income/housing/rate arguments. Regression fixture `310000 RUB` yields `309800.08 ALL`.
- CBR/BoA application input is a narrow verified projection. It requires exact source IDs,
  claim IDs, source periods, typed values, artifact/locator/excerpt references and sealed snapshot
  coverage/parser versions. There are no default or fallback rates.
- Budget uses `decimal.js` only for money, does not round intermediate EUR conversion, and returns
  Decimal strings plus formula/input/output hashes. `knownResidual = incomeAll - housingAll`;
  taxes and living costs remain explicit typed unknowns.
- A commit contains the housing decision and exact canonical typed calculation state needed for
  deterministic replay. C1 can change only housing; profile/evidence/rules and all rate lineage must
  match C0 before a reused causal diff is emitted.
- `run_revisions` keeps its partial uniqueness for one assessment per run and now also holds HMAC
  `stage:"branch"` revisions. Assessment revisions are never modified. `branch_commits` is the only
  new table; update/delete triggers protect both commits and revisions.
- `replayRun` loads HMAC/hash-verified historical rows, invokes Task 3 `replayEvidence`, reruns the
  same Decision and budget functions, invokes Branch `replayCommit`, compares bindings/hashes/IDs,
  appends nothing and returns `mode:"historical"`.

## Hash evidence

- Formula hash after fixed numeric-context binding:
  `5d911ebc44a21e5f10245bcd77ef6d04d5f61b36306fd7833d5e2e22513e2f25`.
- Canonical scenario input hash: `ba0ac864f191b4f81adbde6249535995323308d36992964bba7953784c57c208`.
- Canonical scenario output hash: `fd0ed9c34d6410ddbe62eb3d1f23b5b72bebe887b02c245a19a8356aa95143c3`.
- Pre-report staged implementation diff SHA-256:
  `97f4d9ed86ea513a7e929fda1ee17b53aac98e3f2249a52ca454e2b45342a9ff`.
- Fix-round pre-report staged diff SHA-256:
  `5e01825620d0cd229f5b5e41f5fa38b2560ab43eafd32d7e63a771eeb2a762ae`.
- Fix-round-2 pre-report staged diff SHA-256:
  `b2997c6ceb8828417ccf27d1e32be2e38cf7243bd56574961ff09eb52db7682e`.

## Gates and self-review

- Targeted domain/branch/replay RED/GREEN cycles: PASS.
- Full Vitest suite after fix round 1: 152 tests, 10 files, 0 failures.
- Focused branch/schema fix-round-2 gate: 48 tests, 2 files, 0 failures.
- Full Vitest suite after fix round 2: 174 tests, 11 files, 0 failures.
- TypeScript `tsc --noEmit`: PASS.
- ESLint: PASS.
- Next 16.3.0 production build: PASS; generated `tsconfig.json` changes and `next-env.d.ts`
  were restored/removed via `apply_patch`.
- `git diff --check`: PASS.
- Self-review: no JS number/coercion for money; no client-provided save inputs; yellow/red produce
  zero branch writes; C0/C1 transaction failures leave zero new rows and retry cleanly;
  forged/tampered cursor/commit/evidence fail closed; rewind deletes nothing; strict commit state is
  deep immutable; negative residual deltas use strict signed Decimal text without weakening money
  inputs; fork lineage and HMAC branch revision parent/date/rules/formula/output bindings are exact;
  stale schemas are closed before DDL or application use, current schemas reopen idempotently; replay
  has neither network nor write port; schema has exactly five application tables and no migration
  metadata; no UI/narrative/Task 6 changes.
