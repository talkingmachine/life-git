# VS-4A City Frontier Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist a frozen city ranking, advance an append-only one-city-at-a-time frontier to three selectable cities or exhaustion, and atomically record a terminal city selection as a sibling branch.

**Architecture:** Decision reconstructs frontier and selection state from immutable projections. Application owns Start/Continue/Present/Select and commit ordering behind inward-defined ports. SQLite persists one ranking snapshot, one append-only frontier revision chain and atomic selection/branch records. Research/source calls remain outside transactions and occur only in Continue.

**Tech Stack:** TypeScript, Decimal.js policies from Foundations, better-sqlite3 immediate transactions, canonical JSON/SHA-256/HMAC, existing verified Country Resolution and City Evidence/Knowledge ports, Vitest.

**Depends on:** completed [`Foundations`](2026-08-13-vs-4a-city-frontier-foundations.md) and [`Evidence and Knowledge`](2026-08-13-vs-4a-city-frontier-knowledge.md).

**Format metadata:** `review-matrix` — executable five-task checklist whose apparent length comes from mandatory per-task file, interface, RED/GREEN and commit cells; it is linked from the short master index and is not a narrative specification.

## Constraints specific to this plan

- Start must call the existing `requireResolvedCountryShortlistForCity`; no duplicate or weaker gate.
- Pre-city parent binds only stable country/profile context. It must not bind criteria, ranking or terminal city results, so alternative city runs remain sibling-capable.
- Screened exclusions are audit-only and never become live red markers.
- Continue completes exactly one candidate per command. Internal four-source captures may be parallel, but there is one durable marker successor.
- A city with any unknown but no verified required mismatch is selectable. Only fresh verified required mismatches produce `excluded`.
- No current Knowledge reload may rerank a run.
- Do not extend housing `life-git.ts`, `branch_commits` or `run_revisions` with a city union.

---

### Task 11: Define pure City Frontier and selection policy

**Requirements:** REQ-CF-04, REQ-CF-06, REQ-CF-07; SCN-CF-03, SCN-CF-04, SCN-CF-08, SCN-CF-09

**Files:**
- Create: `src/decision/city-frontier-policy.ts`
- Create: `src/decision/city-selection.ts`
- Create: `tests/domain/city-frontier-policy.test.ts`
- Create: `tests/domain/city-selection.test.ts`

**Interfaces:**

```ts
export interface CityLiveMarker {
  readonly cityId: string;
  readonly rank: number;
  readonly status: "selectable" | "excluded";
  readonly knowledgeRevisionId: string;
  readonly evidenceSnapshotId: string;
  readonly requiredMismatches: readonly CityRequiredMismatch[];
  readonly unknownBasis: readonly CityUnknownWarning[];
  readonly verificationCoverage: string;
  readonly facts: CityCommittedFactProjectionTuple;
}

export interface CityFactLinkProjection {
  readonly sourceId: string;
  readonly label: string;
  readonly navigationUrl: string;
  readonly resolvedEvidenceUrl?: string;
}

export interface CityUnknownWarning {
  readonly criterionId: CityCriterionId;
  readonly definitionId: string;
  readonly reason: CityUnknownReason;
}

export interface CityCommittedFactProjection extends Omit<CityRankingFactInput, "outcome"> {
  readonly outcome:
    | { readonly kind: "verified"; readonly value: string }
    | { readonly kind: "unknown"; readonly reason: CityUnknownReason };
  readonly evidenceLinks: readonly CityFactLinkProjection[];
  readonly manualCheckLinks: readonly CityFactLinkProjection[];
}
export type CityCommittedFactProjectionTuple = readonly [CityCommittedFactProjection, CityCommittedFactProjection, CityCommittedFactProjection, CityCommittedFactProjection];

export interface CityTerminalEntry {
  readonly cityId: string;
  readonly rank: number;
  readonly markerDigest: string;
  readonly knowledgeRevisionId: string;
  readonly evidenceSnapshotId: string;
  readonly unknownBasis: readonly CityUnknownWarning[];
}

export interface CityFrontierProjection {
  readonly nextUncheckedRank: number;
  readonly selectableCityIds: readonly string[];
  readonly phase?: "verification_required";
  readonly terminal?: {
    readonly entries: readonly CityTerminalEntry[];
    readonly stopCondition: "three_selectable" | "catalog_exhausted";
  };
}

export function reconstructCityFrontier(input: ReconstructCityFrontierInput): CityFrontierProjection;
export function reconstructCitySelection(input: ReconstructCitySelectionInput): CitySelectionProjection;
```

- [ ] **Step 1: Write the frontier truth-table RED**

Test pending first rank, selectable verified city, selectable unknown, verified required mismatch exclusion, persistent excluded history/replacement, three-selectable stop, exhaustion with 0/1/2, no fourth selectable, frozen-rank marker prefix and one-marker transition.

- [ ] **Step 2: Run RED**

```bash
./node_modules/.bin/vitest run tests/domain/city-frontier-policy.test.ts \
  tests/domain/city-selection.test.ts
```

- [ ] **Step 3: Implement pure reconstruction and transition validation**

Require markers in activation/frozen rank order with unique city IDs and exact Knowledge/Evidence bindings. A marker is excluded iff `requiredMismatches` is nonempty; unknown never excludes. Terminal entries are selectable markers in frozen order and stop only at exactly three or cursor exhaustion.

- [ ] **Step 4: Implement server-derived selection/warning basis**

Selection accepts only an exact terminal entry. Reconstruct warnings from the selected marker, require no copy version for empty basis and exact `city-unknown-risk@1` for nonempty basis, and reject client-supplied facts/parent/basis fields.

- [ ] **Step 5: Run GREEN and commit**

```bash
./node_modules/.bin/vitest run tests/domain/city-frontier-policy.test.ts \
  tests/domain/city-selection.test.ts
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/eslint src/decision/city-frontier-policy.ts \
  src/decision/city-selection.ts tests/domain/city-{frontier-policy,selection}.test.ts
git diff --check
git add src/decision/city-frontier-policy.ts src/decision/city-selection.ts \
  tests/domain/city-frontier-policy.test.ts tests/domain/city-selection.test.ts
git commit -m "feat: define city frontier policy"
```

---

### Task 12: Define city snapshots, operations and branch values

**Requirements:** REQ-CF-03, REQ-CF-06, REQ-CF-07; SCN-CF-07, SCN-CF-09

**Files:**
- Create: `src/application/city-frontier-contracts.ts`
- Create: `src/branch/city.ts`
- Create: `tests/branch/city.test.ts`

**Interfaces:**

```ts
export interface CityRankingSnapshot {
  readonly schemaVersion: "city-ranking@1";
  readonly id: string;
  readonly runId: string;
  readonly resolvedCountryShortlistRevisionId: string;
  readonly countryCode: string;
  readonly preCityBranchCommitId: string;
  readonly profileSnapshotId: string;
  readonly preferenceProfileSnapshotId: string;
  readonly registryRevisionId: string;
  readonly catalogRevisionId: string;
  readonly criteriaSnapshotId: string;
  readonly assessmentAt: string;
  readonly knowledgeRevisionIds: Readonly<Record<string, string | null>>;
  readonly ordered: readonly RankedCity[];
  readonly screenedExclusions: readonly ScreenedCityExclusion[];
  readonly rulesVersion: "city-ranker@1";
  readonly createdAt: string;
}

export type CityFrontierOperation =
  | { readonly kind: "start"; readonly commandId: string; readonly criteriaPayloadHash: string }
  | { readonly kind: "city_completed"; readonly commandId: string; readonly expectedHeadRevisionId: string; readonly cityId: string; readonly cityCheckRunId: string };

export interface WorkingCityFrontierRevision {
  readonly schemaVersion: "city-frontier@1";
  readonly kind: "working";
  readonly id: string;
  readonly runId: string;
  readonly predecessorRevisionId?: string;
  readonly rankingSnapshotId: string;
  readonly markers: readonly CityLiveMarker[];
  readonly nextUncheckedRank: number;
  readonly phase: "verification_required";
  readonly operation: CityFrontierOperation;
  readonly createdAt: string;
}

export interface TerminalCityShortlistSnapshot {
  readonly schemaVersion: "city-frontier@1";
  readonly kind: "terminal";
  readonly id: string;
  readonly runId: string;
  readonly predecessorRevisionId?: string;
  readonly rankingSnapshotId: string;
  readonly markers: readonly CityLiveMarker[];
  readonly nextUncheckedRank: number;
  readonly entries: readonly CityTerminalEntry[];
  readonly stopCondition: "three_selectable" | "catalog_exhausted";
  readonly operation: CityFrontierOperation;
  readonly createdAt: string;
}

export type CityFrontierRevision = WorkingCityFrontierRevision | TerminalCityShortlistSnapshot;

export interface CitySelectionWithBranch {
  readonly selection: CitySelectionSnapshot;
  readonly commit: CityBranchCommit;
}

export interface CitySelectionSnapshot {
  readonly schemaVersion: "city-selection@1";
  readonly id: string;
  readonly commandId: string;
  readonly runId: string;
  readonly terminalRevisionId: string;
  readonly cityId: string;
  readonly countryCode: string;
  readonly profileSnapshotId: string;
  readonly preferenceProfileSnapshotId: string;
  readonly resolvedCountryShortlistRevisionId: string;
  readonly criteriaSnapshotId: string;
  readonly rankingSnapshotId: string;
  readonly preCityBranchCommitId: string;
  readonly selectedMarkerDigest: string;
  readonly knowledgeRevisionId: string;
  readonly evidenceSnapshotId: string;
  readonly unknownBasis: readonly CityUnknownWarning[];
  readonly warningCopyVersion?: "city-unknown-risk@1";
  readonly createdAt: string;
}
```

Branch values:

```ts
export interface PreCityBranchCommit {
  readonly schemaVersion: "pre-city-branch@1";
  readonly id: string;
  readonly profileSnapshotId: string;
  readonly preferenceProfileSnapshotId: string;
  readonly resolvedCountryShortlistRevisionId: string;
  readonly countryCode: string;
  readonly resolvedCountryEntryDigest: string;
  readonly createdAt: string;
}

export interface CityBranchCommit {
  readonly schemaVersion: "city-branch@1";
  readonly id: string;
  readonly parentId: string;
  readonly forkedFrom: string;
  readonly citySelectionSnapshotId: string;
  readonly cityId: string;
  readonly countryCode: string;
  readonly createdAt: string;
}
```

- [ ] **Step 1: Write branch and closed-contract RED tests**

Test deterministic pre-city ID, exact resolved country entry digest, exact relocation + Preference Profile bindings, complete selection context/selected-marker digest, A/B sibling branch identity, `parentId === forkedFrom`, wrong parent/profile/preference/country/city/criteria/ranking rejection, replay tamper and deep freeze.

- [ ] **Step 2: Run RED**

```bash
./node_modules/.bin/vitest run tests/branch/city.test.ts
```

- [ ] **Step 3: Implement closed snapshot/operation types and ID helpers**

Use the Foundations `CityDecisionIntegrity` sealing contract in Application; keep `node:crypto` in Infrastructure. Browser semantic reconstruction does not recompute IDs. Terminal snapshot is the terminal frontier revision, not a second mutable summary. It includes exact selectable entries, markers and stop condition.

- [ ] **Step 4: Implement pure branch create/replay**

Pre-city parent excludes criteria/ranking/terminal city fields. City branch includes only exact selection and parent lineage. Do not import housing budget/decision types.

- [ ] **Step 5: Run GREEN and commit**

```bash
./node_modules/.bin/vitest run tests/branch/city.test.ts \
  tests/branch/life-git.test.ts
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/eslint src/application/city-frontier-contracts.ts \
  src/branch/city.ts tests/branch/city.test.ts
git diff --check
git add src/application/city-frontier-contracts.ts src/branch/city.ts \
  tests/branch/city.test.ts
git commit -m "feat: define city branch snapshots"
```

---

### Task 13: Persist Criteria, Ranking, pre-city parent and the frontier chain

**Requirements:** REQ-CF-02, REQ-CF-03, REQ-CF-06; SCN-CF-03, SCN-CF-07, SCN-CF-08

**Files:**
- Modify: `src/application/city-data-contracts.ts`
- Create: `src/infrastructure/sqlite/city-criteria-store.ts`
- Create: `src/infrastructure/sqlite/city-frontier-store.ts`
- Create: `src/infrastructure/sqlite/city-branch-store.ts`
- Create: `tests/integration/city-frontier-store.test.ts`
- Create: `tests/support/city-frontier-publication-worker.ts`
- Modify: `src/infrastructure/sqlite/schema.sql`
- Modify: `src/infrastructure/sqlite/db.ts`
- Modify exact schema inventories.

**Interfaces:**

```ts
export interface CityFrontierStorePort {
  appendRevision(input: CityFrontierAppendInput): CityFrontierRevision;
  loadRankingVerified(id: string, context: CityRankingContext): CityRankingSnapshot;
  loadHeadVerified(runId: string, context: CityFrontierContext): CityFrontierRevision;
  loadChainVerified(runId: string, context: CityFrontierContext): readonly CityFrontierRevision[];
  findCommandVerified(runId: string, commandId: string, context: CityFrontierContext): CityCommandResult | undefined;
}

export interface CityFrontierStartWriterPort {
  publishStart(input: CityFrontierStartPublication): CityFrontierReadModel;
}

// Read-only Criteria/Branch/Ranking loaders remain narrow; Start writes only through CityFrontierStartWriterPort.
```

- [ ] **Step 1: Write schema/store RED tests**

Cover strict Criteria/Ranking and pre-city parent round-trip, exact relocation + Preference Profile bindings, atomic `publishStart` with failure after each would-be insert, full ranking reconstruction, one root/successor/terminal, command retry/conflict, stale head, exact bindings and immutable triggers.

- [ ] **Step 2: Run RED**

```bash
./node_modules/.bin/vitest run tests/integration/city-frontier-store.test.ts \
  tests/integration/database-schema.test.ts
```

- [ ] **Step 3: Add five tables and strict preflight**

Add `city_criteria_snapshots`, `city_ranking_snapshots`, `city_frontier_revisions`, `city_selection_snapshots` and closed-union `city_branch_commits`. The selection table exists before branch FKs but is written only in Task 15. A `pre_city` row has no parent/selection and is unique by resolved-country revision + country; `selection` rows require a parent and selection FK. Ranking is unique per run. Frontier has one root/successor/command/terminal indexes. Add immutable triggers/preflight and update exact inventories.

- [ ] **Step 4: Implement canonical verification and race normalization**

`publishStart` runs one `transaction.immediate()` across all four Start artifacts and exact-replays the deterministic command before any insert. Frontier successor append separately resolves idempotent command first, verifies current head, reconstructs pure policy, inserts and reloads. Only a verified lost predecessor race becomes `stale_city_frontier_head`; busy/constraint/native errors must not be broadly relabeled. Add two-connection tests: different successors yield one success/one stale; identical command retries converge.

- [ ] **Step 5: Run GREEN and commit**

```bash
./node_modules/.bin/vitest run tests/integration/city-frontier-store.test.ts \
  tests/integration/database-schema.test.ts tests/integration/confirmed-life.test.ts \
  tests/branch/life-git.test.ts
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/eslint src/infrastructure/sqlite/city-{criteria,frontier,branch}-store.ts \
  tests/integration/city-frontier-store.test.ts \
  tests/support/city-frontier-publication-worker.ts
git diff --check
git add src/application/city-data-contracts.ts \
  src/infrastructure/sqlite/city-criteria-store.ts \
  src/infrastructure/sqlite/city-frontier-store.ts \
  src/infrastructure/sqlite/city-branch-store.ts src/infrastructure/sqlite/schema.sql \
  src/infrastructure/sqlite/db.ts tests/integration/city-frontier-store.test.ts \
  tests/support/city-frontier-publication-worker.ts tests/integration/database-schema.test.ts \
  tests/integration/confirmed-life.test.ts tests/branch/life-git.test.ts
git commit -m "feat: persist city frontier"
```

---

### Task 14: Implement Start, Continue and verified presentation

**Requirements:** REQ-CF-03, REQ-CF-04, REQ-CF-06; SCN-CF-03, SCN-CF-04, SCN-CF-06..08, SCN-CF-10

**Files:**
- Create: `src/application/city-verifier.ts`
- Create: `src/application/city-frontier.ts`
- Create: `src/infrastructure/city-verifier-adapter.ts`
- Create: `src/infrastructure/city-frontier-composition.ts`
- Create: `tests/integration/city-frontier.test.ts`
- Modify: `src/infrastructure/composition-root.ts`

**Interfaces:**

```ts
export interface CityFrontierApplication {
  presentCityFrontierSetup(input: {
    readonly resolvedCountryShortlistRevisionId: string;
    readonly countryCode: string;
  }): Promise<CityFrontierSetupReadModel>;
  startCityFrontier(input: StartCityFrontierInput): Promise<CityFrontierReadModel>;
  prepareCityFrontierContinuation(input: PrepareCityFrontierContinuationInput): Promise<CityFrontierPrepared>;
  continueCityFrontier(
    prepared: CityFrontierPrepared,
    emit: (event: CityFrontierEvent) => void | Promise<void>,
    signal: AbortSignal,
  ): Promise<CityFrontierReadModel>;
  presentCityFrontier(runId: string): Promise<CityFrontierReadModel>;
}
```

The setup read model contains the verified country entry, installed package/definition metadata and a four-criterion draft derived from the exact relocation and Preference Profile snapshots bound by the resolved-country source; it performs no HTTP. Start input contains resolved-country revision ID, country code, Criteria draft and command ID. Prepared continuation contains only verified run/head/active-city/check IDs and source context; HTTP bodies never carry facts or ranking data.

- [ ] **Step 1: Write Start/Present RED tests**

Assert setup and Start reject automatic/working/empty/tampered/effective-red inputs; accepted formal-yellow effective-green setup; exact installed definitions/default draft; exact relocation + Preference Profile IDs from source binding; exact Registry/catalog identity and coordinates; confirmed criteria; deterministic pre-city parent; frozen ranking; zero source calls; injected failure after each Start insert leaves zero partial rows; exact retry converges; two canonical presentations with zero source/request-step calls; exact four-fact/link marker projections; verified selection/branch history after reload.

- [ ] **Step 2: Run RED**

```bash
./node_modules/.bin/vitest run tests/integration/city-frontier.test.ts
```

- [ ] **Step 3: Implement Start and graph verification**

Setup and Start both call the existing country guard first. They load and verify both exact profile IDs from its frozen source binding; Setup derives defaults from those snapshots only. Start revalidates the entry/draft and both profile IDs, loads Registry/catalog/current Knowledge and ranks outside SQLite; then one Application-owned `publishStart` port uses a single immediate transaction to exact-replay or insert Criteria, pre-city parent, Ranking and frontier root atomically. Presentation reconstructs Registry identity, both profile bindings, every exact source and selection/branch history without network.

- [ ] **Step 4: Add Continue RED matrix**

Cover one city per command, all four subchecks despite early required mismatch, red then replacement, selectable unknown, three-stop, exhaustion 0/1/2, no rerank after Knowledge write, abort/fatal error no cursor, source-unavailable unknown, Evidence-sealed/Knowledge-missing recovery, Knowledge-published/frontier-missing recovery, exactly one final `city_continuation_completed` for both working and terminal results, canonical callback/return equality, emit throw after commit, stale/idempotent commands, and two concurrent identical Continues sharing one source execution.

- [ ] **Step 5: Implement present-first Continue ordering**

For the active frozen city: check abort; load completed check by deterministic ID; replay/publish missing Knowledge; otherwise use one composition-scoped promise keyed by `cityCheckRunId` so concurrent identical commands share the same bounded research call; seal Evidence; publish Knowledge; evaluate criteria; append one marker successor; emit the committed marker; construct the verified working-or-terminal read model; emit exactly one `city_continuation_completed`; then return the canonically identical model. An emit failure after append never rolls back the revision. Clear the single-flight entry in `finally`; never hold SQLite across HTTP or add a lease table.

- [ ] **Step 6: Run GREEN and commit**

```bash
./node_modules/.bin/vitest run tests/integration/city-frontier.test.ts \
  tests/integration/city-frontier-store.test.ts \
  tests/integration/city-knowledge-store.test.ts \
  tests/integration/country-resolution.test.ts
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/eslint src/application/city-{frontier,verifier}.ts \
  src/infrastructure/city-{frontier-composition,verifier-adapter}.ts \
  tests/integration/city-frontier.test.ts
git diff --check
git add src/application/city-frontier.ts src/application/city-verifier.ts \
  src/infrastructure/city-frontier-composition.ts \
  src/infrastructure/city-verifier-adapter.ts src/infrastructure/composition-root.ts \
  tests/integration/city-frontier.test.ts
git commit -m "feat: run city frontier"
```

---

### Task 15: Atomically publish City Selection and sibling branches

**Requirements:** REQ-CF-07; SCN-CF-04, SCN-CF-08, SCN-CF-09

**Files:**
- Create: `src/application/city-selection.ts`
- Create: `src/infrastructure/sqlite/city-selection-writer.ts`
- Create: `tests/integration/city-selection.test.ts`
- Modify: `src/infrastructure/city-frontier-composition.ts`
- Modify: `src/infrastructure/composition-root.ts`

**Interfaces:**

```ts
export function selectCity(input: SelectCityInput): Promise<{
  readonly selection: CitySelectionSnapshot;
  readonly commit: CityBranchCommit;
  readonly readModel: CityFrontierReadModel;
}>;
```

- [ ] **Step 1: Write selection/atomicity RED tests**

Accept exact terminal selectable city with 0 or nonzero warnings; reject working/empty/missing/excluded/tampered city, wrong copy-version presence and client extra basis/parent fields. Inject failure before either insert and verify neither row exists. Retry same command must return both prior rows; altered payload conflicts; returned/presented read models contain verified sibling selection/branch history.

- [ ] **Step 2: Run RED**

```bash
./node_modules/.bin/vitest run tests/integration/city-selection.test.ts
```

- [ ] **Step 3: Implement the atomic writer over the existing tables**

Use the Task 13 `city_selection_snapshots` and `city_branch_commits` schemas. Verify mirrored command/context/marker fields, require `parent_id = forked_from`, exact selection FK and the same country/profile context as the verified `pre_city` parent.

- [ ] **Step 4: Implement one atomic writer transaction**

Load/verify terminal and source graph inside the transaction, derive warning basis and branch parent server-side, construct both pure values, insert both, reload/verify both, then commit. Add `listSelectionsWithBranchesVerified(runId)` to the inward writer port; Select and `presentCityFrontier` return the complete verified history. A second city from the same terminal reuses the same pre-city parent and creates a sibling commit.

- [ ] **Step 5: Run the core gate and commit**

```bash
./node_modules/.bin/vitest run tests/integration/city-selection.test.ts \
  tests/integration/city-frontier.test.ts tests/integration/city-frontier-store.test.ts \
  tests/branch/city.test.ts tests/integration/database-schema.test.ts \
  tests/integration/confirmed-life.test.ts tests/branch/life-git.test.ts
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/eslint src/application/city-selection.ts \
  src/infrastructure/sqlite/city-selection-writer.ts \
  tests/integration/city-selection.test.ts
git diff --check
git add src/application/city-selection.ts \
  src/infrastructure/sqlite/city-selection-writer.ts \
  src/infrastructure/city-frontier-composition.ts \
  src/infrastructure/composition-root.ts tests/integration/city-selection.test.ts \
  tests/integration/database-schema.test.ts
git commit -m "feat: select city branch"
```
