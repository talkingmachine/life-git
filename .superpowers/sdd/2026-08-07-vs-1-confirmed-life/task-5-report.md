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

- Formula hash: `ed02a65cc7f09bbf9ab5ae1d15d0ff74a570a9c1a3f3c49eab6ce3582ce11186`.
- Canonical scenario input hash: `ba0ac864f191b4f81adbde6249535995323308d36992964bba7953784c57c208`.
- Canonical scenario output hash: `fd0ed9c34d6410ddbe62eb3d1f23b5b72bebe887b02c245a19a8356aa95143c3`.
- Pre-report staged implementation diff SHA-256:
  `97f4d9ed86ea513a7e929fda1ee17b53aac98e3f2249a52ca454e2b45342a9ff`.

## Gates and self-review

- Targeted domain/branch/replay RED/GREEN cycles: PASS.
- Full Vitest suite: 128 tests, 10 files, 0 failures.
- TypeScript `tsc --noEmit`: PASS.
- ESLint: PASS.
- Next 16.3.0 production build: PASS; generated `tsconfig.json` changes and `next-env.d.ts`
  were restored/removed via `apply_patch`.
- `git diff --check`: PASS.
- Self-review: no JS number/coercion for money; no client-provided save inputs; yellow/red produce
  zero branch writes; forged/tampered cursor/commit/evidence fail closed; rewind deletes nothing;
  fork lineage and HMAC branch revision parent are exact; replay has neither network nor write port;
  schema has exactly five application tables; no UI/narrative/Task 6 changes.
