# VS-4A City Frontier Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist a frozen city ranking, advance an append-only one-city-at-a-time frontier to three selectable cities, queue exhaustion or an exact ten-city live limit, and atomically record a terminal city selection as a sibling branch.

**Architecture:** Decision reconstructs frontier and selection state from immutable projections. Application owns Start/Continue/Present/Select and commit ordering behind inward-defined ports. SQLite persists one ranking snapshot, one append-only frontier revision chain and atomic selection/branch records. Research/source calls remain outside transactions and occur only in Continue.

**Tech Stack:** TypeScript, Decimal.js policies from Foundations, better-sqlite3 immediate transactions, canonical JSON/SHA-256/HMAC, existing verified Country Resolution and City Evidence/Knowledge ports, Vitest.

**Depends on:** completed [`Foundations`](2026-08-13-vs-4a-city-frontier-foundations.md) and [`Evidence and Knowledge`](2026-08-13-vs-4a-city-frontier-knowledge.md).

**Required safety amendment:** [`VS-4A Safety Source Discovery`](2026-08-14-vs-4a-safety-source-discovery.md). Marker, Continue, replay and selection behavior below use its yellow-selectable and accepted/reviewed-link semantics.

**Format metadata:** `review-matrix` — executable five-task checklist whose apparent length comes from mandatory per-task file, interface, RED/GREEN and commit cells; it is linked from the short master index and is not a narrative specification.

## Constraints specific to this plan

- Start must call the existing `requireResolvedCountryShortlistForCity`; no duplicate or weaker gate.
- Pre-city parent binds only stable country/profile context. It must not bind criteria, ranking or terminal city results, so alternative city runs remain sibling-capable.
- Screened exclusions are audit-only and never become live red markers.
- Continue completes exactly one candidate per command. Internal four-criterion captures may be parallel, but safety candidate inspection is sequential and bounded, and there is one durable marker successor.
- One run commits at most ten completed city markers. A retry before marker commit consumes no city
  slot; after the tenth marker the successor is terminal and no eleventh city is activated.
- A city with any unknown but no verified required mismatch is yellow and selectable. Only fresh verified required mismatches produce red `excluded`.
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
  readonly status: CityMarkerDisposition;
  readonly visualStatus: CityCommittedMarkerVisualStatus;
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
  readonly disposition: "accepted" | "reviewed_rejected";
  readonly navigationUrl: string;
  readonly resolvedEvidenceUrl?: string;
  readonly referenceYear?: number;
  readonly rejectionReason?: CitySafetyCandidateRejectionReason;
}

export interface CityUnknownWarning {
  readonly criterionId: CityCriterionId;
  readonly definitionId: string;
  readonly reason: CityUnknownReason;
}

export interface CityCommittedFactProjection extends Omit<CityRankingFactInput, "outcome"> {
  readonly outcome:
    | { readonly kind: "verified"; readonly basis: CityVerifiedFactBasis }
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
    readonly stopCondition: CityFrontierStopCondition;
  };
}

export function reconstructCityFrontier(input: ReconstructCityFrontierInput): CityFrontierProjection;
export function reconstructCitySelection(input: ReconstructCitySelectionInput): CitySelectionProjection;
```

- [ ] **Step 1: Write the frontier truth-table RED**

Test pending first rank, all-verified green selectable city, unknown yellow selectable city, verified
required mismatch red exclusion, persistent excluded history/replacement, yellow occupying a terminal
slot without replacement, three-selectable stop, exhaustion with 0/1/2, nine completed markers with
0/1/2 selectable followed by a tenth-marker limit terminal, ten red with terminal zero, no fourth selectable, no
eleventh activation, frozen-rank marker prefix and one-marker transition. Reject green with unknown,
yellow with no unknown, red without a required mismatch, a working revision with ten markers, a limit
terminal below ten markers or after queue exhaustion, and any marker whose accepted/reviewed links do
not reconstruct from its Evidence.

- [ ] **Step 2: Run RED**

```bash
./node_modules/.bin/vitest run tests/domain/city-frontier-policy.test.ts \
  tests/domain/city-selection.test.ts
```

- [ ] **Step 3: Implement pure reconstruction and transition validation**

Require markers in activation/frozen rank order with unique city IDs and exact Knowledge/Evidence
bindings. A marker is red/excluded iff `requiredMismatches` is nonempty; otherwise it is yellow iff
any fact is unknown, and green iff all four are verified. Terminal entries are green/yellow selectable
markers in frozen order. After each committed marker choose stop deterministically: `three_selectable`;
else `catalog_exhausted` when no frozen candidate remains; else `live_candidate_limit_reached` at ten
markers. Otherwise preserve working `verification_required` state.

- [ ] **Step 4: Implement server-derived selection/warning basis**

Selection accepts only an exact terminal entry. Reconstruct warnings and reviewed source links from the selected marker, require no copy version for green and exact `city-unknown-risk@1` for yellow, and reject client-supplied facts/parent/basis/link fields. Yellow selection accepts the displayed risk inline; no separate modal or decision aggregate is introduced.

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
  readonly packageId: string;
  readonly packageSchemaVersion: string;
  readonly preCityBranchCommitId: string;
  readonly profileSnapshotId: string;
  readonly preferenceProfileSnapshotId: string;
  readonly registryRevisionId: string;
  readonly catalogRevisionId: string;
  readonly installedPackageContext: InstalledCityPackageExactKey;
  readonly criteriaSnapshotId: string;
  readonly assessmentAt: string;
  readonly knowledgeRevisionIds: Readonly<Record<string, string | null>>;
  readonly ordered: readonly RankedCity[];
  readonly screenedExclusions: readonly ScreenedCityExclusion[];
  readonly rulesVersion: "city-ranker@1";
  readonly verificationBudget: CityFrontierVerificationBudget;
  readonly createdAt: string;
}

export type CityRankingSnapshotPayload = Omit<CityRankingSnapshot, "id">;

export interface CityRankingSemanticInputs {
  readonly registry: CityRegistryRevision;
  readonly catalog: CityCatalogRevision;
  readonly criteria: CityCriteriaSnapshot;
  readonly knowledge: readonly CityKnowledgeRankingProjection[];
  readonly evaluators: CityCriterionEvaluatorRegistry;
}

export function sealCityRankingSnapshot(
  payload: CityRankingSnapshotPayload,
  integrity: CityDecisionIntegrity,
): CityRankingSnapshot;

export function reconstructCityRankingSnapshot(
  value: unknown,
  integrity: CityDecisionIntegrity,
): CityRankingSnapshot;

export function verifyCityRankingSnapshotSemantics(
  snapshot: CityRankingSnapshot,
  inputs: CityRankingSemanticInputs,
  integrity: CityDecisionIntegrity,
): CityRankingSnapshot;

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
  readonly stopCondition: CityFrontierStopCondition;
  readonly operation: CityFrontierOperation;
  readonly createdAt: string;
}

export type CityFrontierRevision = WorkingCityFrontierRevision | TerminalCityShortlistSnapshot;

export type CityFrontierEvent =
  | { readonly type: "city_activated"; readonly runId: string; readonly baseRevisionId: string; readonly sequence: number; readonly occurredAt: string; readonly cityId: string; readonly rank: number }
  | { readonly type: "city_progress"; readonly runId: string; readonly baseRevisionId: string; readonly sequence: number; readonly occurredAt: string; readonly cityId: string; readonly stage: string; readonly label: string; readonly detail?: string; readonly sourceUrl?: string }
  | { readonly type: "city_revision_committed"; readonly runId: string; readonly baseRevisionId: string; readonly sequence: number; readonly occurredAt: string; readonly marker: CityLiveMarker; readonly revision: CityFrontierRevision }
  | { readonly type: "city_continuation_completed"; readonly runId: string; readonly baseRevisionId: string; readonly sequence: number; readonly occurredAt: string; readonly readModel: CityFrontierReadModel };

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

Test deterministic pre-city ID, exact resolved country entry digest, exact relocation + Preference Profile bindings, the closed Application-owned `CityFrontierEvent` union, complete selection context/selected-marker digest including visual status and reviewed links, green/yellow selection, yellow warning-basis tamper, A/B sibling branch identity, `parentId === forkedFrom`, wrong parent/profile/preference/country/city/criteria/ranking rejection, replay tamper and deep freeze.

For `CityRankingSnapshot`, require one closed `installedPackageContext` with exactly
`countryCode/packageId/packageSchemaVersion/catalogRevisionId/evidenceRulesVersion`. Require its first
four identity fields to equal the snapshot's top-level country/package/schema/catalog fields and keep
top-level `rulesVersion === "city-ranker@1"` semantically separate. Cover exact key closure, missing/
extra/noncanonical fields, use of ambiguous `rulesVersion` instead of `evidenceRulesVersion`, every
top-level/context divergence and a context-only mutation with a recomputed ranking ID. Assert
`sealCityRankingSnapshot` and `reconstructCityRankingSnapshot` include the complete context in the exact
hash-derived ID and return fresh frozen values. Structural reconstruction receives only `value` plus
`CityDecisionIntegrity`: prove it neither accepts caller expectations nor reads Registry/Catalog/
Criteria/Knowledge/evaluators. A structurally valid, rehashed but semantically altered order can pass
that function, then must fail the separate semantic verifier.

Test `verifyCityRankingSnapshotSemantics` with exact verified `CityRankingSemanticInputs`: Registry,
Catalog, Criteria snapshot, one Knowledge ranking projection per member and the installed evaluator
registry. Require exact reference IDs, catalog membership, null/non-null Knowledge revision map,
assessmentAt and canonical rank/exclusion/factor output. Mutate or omit each input/result binding and
reject it; the positive result is the same fresh frozen snapshot. Compile-check both exact signatures.

- [ ] **Step 2: Run RED**

```bash
./node_modules/.bin/vitest run tests/branch/city.test.ts
```

- [ ] **Step 3: Implement closed snapshot/operation types and ID helpers**

Use the Foundations `CityDecisionIntegrity` sealing contract in Application; keep `node:crypto` in Infrastructure. Browser semantic reconstruction does not recompute IDs. Terminal snapshot is the terminal frontier revision, not a second mutable summary. It includes exact selectable entries, markers and stop condition.

The ranking payload is the exact `CityRankingSnapshot` object without `id`; seal it as
`id = "city-ranking:" + integrity.hash(integrity.canonical(payload))`. Both sealing and reconstruction
validate the closed installed-package key and the four equality equations above before hashing or
accepting the ID. `evidenceRulesVersion` comes from the independently verified installed package
definition and is never copied from the ranker's `rulesVersion`.

`reconstructCityRankingSnapshot(value, integrity)` performs only closed own-data/dense-array/canonical-
identifier validation, the installed-context/top-level equality equations and exact hash-derived ID
verification. It has no semantic inputs and must not claim to rerun ranking. The separate pure
`verifyCityRankingSnapshotSemantics(snapshot, inputs, integrity)` requires the exact five-key
`CityRankingSemanticInputs`, first structurally reconstructs `snapshot` through the former function,
binds Registry/catalog/criteria IDs and complete catalog membership,
requires exactly one Knowledge projection per member with IDs/nulls equal to
`snapshot.knowledgeRevisionIds`, reconstructs Criteria with `inputs.evaluators`, and calls the existing
pure Decision ranking reconstruction for `snapshot.assessmentAt`. It canonical-compares the resulting
`ordered/screenedExclusions/rulesVersion` with the snapshot and returns the verified fresh frozen
snapshot. No Infrastructure row enters either pure contract; only the semantic function receives the
compiled inward evaluator registry.

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
- Modify: `tests/integration/database-schema.test.ts`
- Modify: `tests/integration/confirmed-life.test.ts`
- Modify: `tests/branch/life-git.test.ts`

**Interfaces:**

```ts
export interface CityFrontierStorePort {
  appendRevision(input: CityFrontierAppendInput): CityFrontierRevision;
  loadRankingVerified(id: string): CityRankingSnapshot;
  loadHeadVerified(runId: string): CityFrontierRevision;
  loadChainVerified(runId: string): readonly CityFrontierRevision[];
  findCommandVerified(runId: string, commandId: string): CityCommandResult | undefined;
}

export interface CityFrontierStartWriterPort {
  publishStart(input: CityFrontierStartPublication): CityFrontierReadModel;
}

// Read-only Criteria/Branch/Ranking loaders remain narrow; Start writes only through CityFrontierStartWriterPort.
```

No caller-supplied loader context DTO exists. The adapter derives every row expectation from
the requested ID/run, the signed canonical row and its persisted predecessor/ranking/reference columns;
Application canonical-compares returned IDs/bindings needed by its use case.

- [ ] **Step 1: Write schema/store RED tests**

Cover strict Criteria/Ranking and pre-city parent round-trip, exact relocation + Preference Profile
bindings, frozen `city-frontier-budget@1`, atomic `publishStart` with failure after each would-be insert,
full ranking reconstruction, one root/successor/terminal, no working head with ten markers, exact
three-way terminal reason/count/queue validation, command retry/conflict, stale head, exact bindings and
immutable triggers.

Persist and reload the complete `installedPackageContext` inside the canonical sealed ranking payload.
Assert mirrored country/package/schema/catalog/evidence-rules columns and the parsed closed context all
agree. `loadRankingVerified(id)` accepts no caller-supplied context: assert it verifies the private
signed row envelope, canonical JSON, hash-derived snapshot ID, mirrored columns, closed context and
stored reference/FK IDs, then returns the fresh frozen structurally reconstructed snapshot. Tamper or
re-hash any key field/top-level duplicate, mirror, HMAC/hash or reference and fail. Compile-check the
one-argument signature, absence of legacy loader-context parameter types, the inward Research
`InstalledCityPackageExactKey`, and that ranker `rulesVersion` cannot satisfy
`evidenceRulesVersion` accidentally.

Add a bootstrap-order positive: first call `loadRankingVerified(id)` with no expected package value,
read the returned `installedPackageContext`, resolve its exact installed package, load its verified
Registry/Catalog/Criteria/Knowledge inputs, then call `verifyCityRankingSnapshotSemantics`. An alternate
caller context cannot be supplied to make a bad row pass. Add semantic negatives for each referenced
input after a structurally valid load; the SQLite adapter must not claim it reranked without those
inputs.

- [ ] **Step 2: Run RED**

```bash
./node_modules/.bin/vitest run tests/integration/city-frontier-store.test.ts \
  tests/integration/database-schema.test.ts
```

- [ ] **Step 3: Add five tables and strict preflight**

Add `city_criteria_snapshots`, `city_ranking_snapshots`, `city_frontier_revisions`, `city_selection_snapshots` and closed-union `city_branch_commits`. The selection table exists before branch FKs but is written only in Task 15. A `pre_city` row has no parent/selection and is unique by resolved-country revision + country; `selection` rows require a parent and selection FK. Ranking is unique per run and binds the exact verification budget plus canonical `installed_package_context`, mirrored `package_id`, `package_schema_version` and `evidence_rules_version`; existing country/catalog columns must equal the same context. Persist an Infrastructure-private canonical-row payload hash/HMAC envelope, not an outward snapshot field, and verify it before parsing/return. Frontier has one root/successor/command/terminal indexes. Add immutable triggers/preflight and update exact inventories.

- [ ] **Step 4: Implement canonical verification and race normalization**

`publishStart` runs one `transaction.immediate()` across all four Start artifacts and exact-replays the deterministic command before any insert. Frontier successor append separately resolves idempotent command first, verifies current head, reconstructs pure policy, inserts and reloads. Only a verified lost predecessor race becomes `stale_city_frontier_head`; busy/constraint/native errors must not be broadly relabeled. Add two-connection tests: different successors yield one success/one stale; identical command retries converge.

Before inserting a ranking, Application calls `reconstructCityRankingSnapshot(value, integrity)` and
`verifyCityRankingSnapshotSemantics` with the already verified installed package/catalog/criteria/
Knowledge inputs, then passes only the returned frozen snapshot to `publishStart`. The SQLite writer
repeats structural reconstruction, signs/persists the private row envelope and verifies canonical row
JSON, mirrors and references. `loadRankingVerified(id)` verifies only that complete persistence/
structural boundary and returns the snapshot without caller expectations or semantic-rerank claims.
Application then obtains the exact installed package and verified inputs from the returned context and
calls the semantic verifier before presentation or Continue. `publishStart` persists exactly the
context supplied by Start's independently verified installed manifest and never derives its evidence
rules from `city-ranker@1`.

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
- Create: `src/infrastructure/sources/slovenia-city-source-adapter.ts`
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

Assert setup and Start reject automatic/working/empty/tampered/effective-red inputs; accepted
formal-yellow effective-green setup; exact installed definitions/default draft; exact relocation +
Preference Profile IDs from source binding; exact Registry/catalog identity, Catalog
`schemaVersion === "city-catalog@1"`, `rulesVersion === CITY_CATALOG_RULES_VERSION` and at-most-100 membership
and coordinates; confirmed criteria; deterministic pre-city parent; frozen ranking bound to
`city-frontier-budget@1` (`10` completed / target `3`); zero official/search calls; injected failure
after each Start insert leaves zero partial rows; exact retry converges; two canonical presentations
with zero source/request-step/search calls; exact four-fact accepted/reviewed-link marker projections;
verified selection/branch history after reload. An installed package whose Catalog uses
`LEGACY_CITY_CATALOG_RULES_VERSION` must fail Setup/Start as
`city_catalog_upgrade_required` before ranking, source calls or any Criteria/pre-city/Ranking/frontier
run row. No legacy-catalog-rules City run can be created. Continue and Present require an exact
installed manifest whose Catalog retains `schemaVersion === "city-catalog@1"` and
`rulesVersion === CITY_CATALOG_RULES_VERSION`; Present is
guaranteed only for snapshots created by that current-catalog-rules Start path. A synthetic/imported
snapshot bound to legacy Catalog rules is rejected as `city_catalog_upgrade_required`; historical
migration/import compatibility is out of scope.

Add the package-readiness preflight ahead of any database, source or ranking port. For the current SI
candidate, both Setup and Start fail `city_package_not_ready` with all four readiness issues and zero
installed-lookup/database/source/ranking calls. `city_package_not_installed` is distinct and applies
only when pure readiness returns a `CityResearchPackageReadyCandidate` and the subsequent
`InstalledCityPackageLookupPort.findReady(countryCode)` result is absent; never accept a slash-form
alternative. Use only a local synthetic ready candidate plus a separate matching synthetic installed
package for positive Start/Continue integration tests. Construct that installed package through the
Task 9 administrative Evidence installer with an independently compiled
`ApprovedCityCriteriaDefaultsRegistry`; do not substitute a caller-presealed object or fabricated HTTP
provenance.

After the synthetic ready lookup returns, independently forge Registry/catalog IDs and inconsistent
Registry entry/root or catalog candidate/member/coverage drift; the pure reconstruction gate rejects
those cases. Separately build a fully valid alternate Registry+catalog root with its membership and both
hash-derived IDs recomputed. Prove pure `reconstructVerifiedCityCatalog` accepts that alternate as
self-consistent but Setup and Start still reject it because it differs from the independent
`CityCatalogStorePort.latestInstalledVerified(countryCode)` projection. Require exact Registry ID,
catalog ID and canonical full-`{ registry, catalog }` equality with that trusted root. The authenticated
catalog-store read is the only permitted persistence call after `findReady` in this initial trust gate;
until equality succeeds, observe no package manifest/member/plan/directory/default, country guard,
profile, Knowledge, ranking, fixed-route, safety, evaluator, search or official-document callback and
write no durable Start row.

Immediately after that root equality, require the server to validate the returned
`installedPackageManifest` as a fresh recursively frozen plain object with exactly own data keys
`id/key`, no accessor/symbol/custom prototype, a nonempty audit ID and a frozen exact five-field
`InstalledCityPackageExactKey`. Compare `countryCode`/`packageId` with the ready candidate, signed
package definition and trusted Registry/catalog identity; compare `catalogRevisionId` with the
reconstructed and authoritative Catalog ID; and compare `packageSchemaVersion` plus
`evidenceRulesVersion` only with the signed package definition/manifest, never with either Catalog
version field. Then construct exactly one fresh frozen
`installedPackageContext` copy before any other read or callback. The audit ID is authenticated by the
lookup-adapter postcondition but has no independently persisted Application expectation. For every
positive Setup/Start case, require the setup read model and sealed Ranking snapshot to carry that same
context. Give the manifest/key a missing or extra key, accessor, symbol, custom prototype or unfrozen
node; use an empty/non-string audit ID; mutate each signed key field; replace
`evidenceRulesVersion` with the ranker's `rulesVersion`; or hide key drift behind otherwise matching
visible definition/catalog. Explicitly set `key.packageSchemaVersion` to `"city-catalog@2"` while the
signed package definition retains its own package schema and reject the key/definition mismatch; set
`catalog.schemaVersion` to `"city-catalog@2"` and reject it even after rehashing; only
`catalog.rulesVersion === LEGACY_CITY_CATALOG_RULES_VERSION` exercises
`city_catalog_upgrade_required`.
Trace the exact prefix as pure readiness → `findReady` → pure catalog reconstruction →
`latestInstalledVerified`/root equality → manifest/key validation → context freeze, then fail with zero
country-guard/profile/Criteria/Knowledge read, ranking/fixed-plan/safety/directory/evaluator/validator
callback, source call or durable Start row. No later phase may reread or revalidate the raw manifest/key.
Separately, after a successful gate, diverge a copied context field or the Ranking's top-level
country/package/schema/catalog mirrors; Task 13 structural reconstruction must reject it before
`publishStart` without rerunning the manifest gate.

For the final member in canonical catalog order, separately corrupt the final fixed-broadband tuple's
route closure/URL, parser or rules version, plan/city/source/criterion/definition binding and claim
contract. Setup and Start must reject the entire installed package before ranking or any source call,
not merely defer failure until that city is active. Assert all three plans of every member tuple passed
through `reconstructCityFixedSourcePlan(value, tupleExpectedSourceId)`, including a cross-source literal
mismatch, and no partial Start row exists. With the real installed-package adapter, omit the approved
defaults selection or re-sign a changed mapping, target, mode or importance; Setup and Start fail closed
before evaluator normalization, country guard, profile/Knowledge reads, ranking, any source call or a
durable row. The manifest mapping version alone never authorizes a default draft.

- [ ] **Step 2: Run RED**

```bash
./node_modules/.bin/vitest run tests/integration/city-frontier.test.ts
```

- [ ] **Step 3: Implement Start and graph verification**

Setup and Start share one private Application initial-trust-gate helper and first call pure
`getCityResearchPackageAvailability(countryCode)` and
`assertCityPackageReady` without touching a port. An existing but unready candidate throws
`city_package_not_ready`; only the returned `CityResearchPackageReadyCandidate` proceeds to
`InstalledCityPackageLookupPort.findReady(countryCode)`, where absence throws
`city_package_not_installed`. Immediately after a non-absent result and without first reading a member,
plan or directory, pass exactly
`{ registry: installed.registry, catalog: installed.catalog }` to Task 7
`reconstructVerifiedCityCatalog` with a narrowed `CityDecisionIntegrity { canonical, hash }` view.
This establishes only self-consistency. Next, as the sole additional persistence read after the
installed-package lookup in this trust gate, call the injected inward
`CityCatalogStorePort.latestInstalledVerified(countryCode)`. Absence, a non-current root or any mismatch
fails closed. Require exact equality of both Registry and catalog IDs and
`integrity.canonical({ registry, catalog })` for the reconstructed package projection and the complete
trusted store projection. A fully valid rehashed alternate therefore passes pure reconstruction but
fails this authority comparison.

At that exact point in the initial trust gate, before a country guard, member/plan/directory/default
inspection or any other read/callback, validate
`installed.installedPackageManifest` by own data descriptors as a recursively frozen plain object with
exactly `id/key`, no accessor or symbol, a nonempty string audit ID and a recursively frozen plain key
with exactly
`countryCode/packageId/packageSchemaVersion/catalogRevisionId/evidenceRulesVersion`. Compare
`countryCode`/`packageId` with the ready candidate, signed installed package definition and
reconstructed/authoritative Catalog identity; compare `catalogRevisionId` with both Catalog IDs; and
compare `packageSchemaVersion` plus `evidenceRulesVersion` only with the signed installed package
definition/manifest—never with either Catalog version field. The audit ID
remains adapter-authenticated metadata and is not compared with an unavailable Application expectation.
Require both reconstructed and authoritative Catalogs to keep
`schemaVersion === "city-catalog@1"` and
`rulesVersion === CITY_CATALOG_RULES_VERSION` (`"city-catalog@2"`); the legacy Catalog rules value
throws `city_catalog_upgrade_required` before context construction or any other read/callback. Then copy
the signed key exactly once and freeze it:

```ts
const signedKey = installed.installedPackageManifest.key;
const installedPackageContext: InstalledCityPackageExactKey = Object.freeze({
  countryCode: signedKey.countryCode,
  packageId: signedKey.packageId,
  packageSchemaVersion: signedKey.packageSchemaVersion,
  catalogRevisionId: signedKey.catalogRevisionId,
  evidenceRulesVersion: signedKey.evidenceRulesVersion,
});
```

The gate projects the fresh frozen lookup value once into a private manifest-free, identity-verified
Application trust record containing the trusted Registry+catalog projection, opaque manifest audit ID,
`installedPackageContext`, owned frozen copies of the installed definition/readiness/data projections
and the exact opaque validator capability references needed later; it exposes no new public contract.
The record contains neither `installedPackageManifest` nor the raw key. Drop the raw installed,
manifest and key locals at this boundary. Every later Setup/Start step receives only this frozen trust
record and uses its context for package identity; no later stage can reread, reconstruct or revalidate
the manifest/key. The only port reads before this return are `findReady` and
`latestInstalledVerified`; the only callbacks are the pure
catalog/root reconstruction and canonical equality. No failure in this gate writes a durable Start row.

Use only the initial identity-verified trust record's fresh frozen Registry+catalog projection and
installed data from that point onward. Require them to repeat the ready candidate's exact
country/package/schema/definition/source-
contract/readiness fields. Require `fixedPlansByCityId` to have exactly the verified member key set and
each value to be a dense three-item tuple. In canonical member order, call
`reconstructCityFixedSourcePlan(value, tupleExpectedSourceId)` for all three
long-rent/transit/broadband values in every tuple before
ranking; bind each returned plan's exact plan/city/source/criterion/definition/parser/rules and complete
claim contract to the member, approved criterion definitions and `SLOVENIA_CITY_FACT_VERSIONS`.
Only after the final member's final plan passes may Application reconstruct and bind the official
authority directory and safety plan against the same trusted catalog and narrow integrity. Copy and
freeze those reconstructed plans/directory, definition, criteria defaults and trusted catalog
projection as the one
Application installed-package data context, `verifiedInstalled`, and carry the already frozen
`installedPackageContext` unchanged while binding—without freezing—the exact validator capabilities.
The defaults may enter this context only through the Task 9 lookup adapter's
postcondition that their complete canonical four-draft value equals the independently compiled
approved-defaults selection before evaluator normalization; a signed manifest mapping version is not a
second trust source. Never read the raw installed Registry/catalog/plan/default objects again. For a
matching verified installed package, both then call the existing country guard before any other use-
case work. They load and verify both
exact profile IDs from its frozen source binding; Setup derives its draft only from those snapshots and
the frozen approved installed defaults.
Start revalidates the entry/draft and both profile IDs, loads current Knowledge and ranks only the
verified catalog members/coordinates outside SQLite. Setup returns the initial gate's server-derived
`installedPackageContext` with the installed metadata; Start consumes the same gate result and never
accepts a client context or reconstructs one after profile/Knowledge work. The frozen Ranking snapshot
stores that exact already verified context, and its top-level country/package/schema/catalog fields
equal the first four context fields while its separate `rulesVersion` remains `city-ranker@1`. Start structurally reconstructs
the sealed Ranking and calls `verifyCityRankingSnapshotSemantics` with the verified Registry/catalog,
confirmed Criteria, exact Knowledge projections and installed evaluator registry before persistence.
Then one Application-owned
`publishStart` port uses a single immediate
transaction to exact-replay or insert Criteria, pre-city parent, Ranking and frontier root atomically.
Presentation first obtains the structurally verified Ranking through `loadRankingVerified(id)`, then
uses its returned manifest context to resolve the exact installed package/catalog/criteria/Knowledge
inputs, requires the manifest package schema to equal its signed package definition, requires every
reconstructed/authoritative Catalog to retain schema `"city-catalog@1"` and current
`CITY_CATALOG_RULES_VERSION`, and calls
`verifyCityRankingSnapshotSemantics` before projecting a read model. It also
reconstructs Registry identity, both profile bindings, every exact source and selection/branch history
without network.

- [ ] **Step 4: Add Continue RED matrix**

Cover one city per command, all four subchecks despite early required mismatch, red then replacement,
yellow selectable/no replacement, three-stop, exhaustion 0/1/2, live-city limit with 0/1/2, stop
precedence on the tenth marker, no eleventh activation or source call, no rerank after Knowledge write,
abort/fatal error no cursor or city-budget consumption, previous accepted Y-1 with zero search, previous
Y-2 continuing search, first route failure then discovered exact source, stale/broad/missing-total
candidate continuation, completed-empty provider result, typed provider failure, explicit unconfigured
producer, full safety URL budget unknown, January–June fallback, July stale, same-chain conflict, both
raw-seal and delete-transient artifact handoffs, known-to-unknown without carry-forward,
Evidence-sealed/Knowledge-missing recovery, Knowledge-published/frontier-missing recovery, exactly one
final `city_continuation_completed` for both working and terminal results, canonical callback/return
equality, emit throw after commit, stale/idempotent commands, and two concurrent identical Continues
sharing one source execution. For the three fixed runs, use counted installed value/period validators,
an injected Application clock and a fake Infrastructure deadline scheduler; assert every exact
capability reaches `CityFixedSourceRunInput`. Make one route port never settle and prove the scheduler
aborts/rejects the shared operation with zero Evidence, Knowledge, marker or budget advancement and
no late output.

For the successful sealing path, assert the City context and overlay expose only
`evidenceRulesVersion` and copy it from `ranking.installedPackageContext.evidenceRulesVersion`.
Compile/runtime-reject a City `rulesVersion` alias. Require the one generic seal input and resulting
generic snapshot to map that value to their pre-existing `rulesVersion` field exactly once; every other
package replay call passes the shared `InstalledCityPackageExactKey` object directly.

Start a run against catalog A, install a valid successor catalog B for the same country/package/schema/
evidence-rules tuple, and require Continue of the frozen A run to call
`InstalledCityPackageLookupPort.findExact(ranking.installedPackageContext)` with that exact closed
object and no field-by-field reconstruction or override. It must continue successfully
with A's package/plans and `CityCatalogStorePort.loadVerified(A.id)`, with zero `findReady` or
`latestInstalledVerified` call; B becoming latest must not redirect or invalidate A. An absent exact
package maps to `city_package_revision_not_installed`; a non-undefined returned package that differs
from any requested key field, hides drift only in `installedPackageManifest.key`, or drifts any full
replayed projection is `integrity_mismatch`. Both fail before the first fixed/safety/search/
document call, before completed-Evidence lookup or Task 7 replay, before Knowledge recovery,
single-flight or any event/callback, and with zero Evidence/Knowledge/marker/cursor/budget write. Count
all of those ports/callbacks across Prepare+Continue and require zero calls for both failures.

Supply a synthetic structurally valid Ranking whose frozen exact lookup returns a package whose Catalog
keeps `schemaVersion === "city-catalog@1"` but uses
`LEGACY_CITY_CATALOG_RULES_VERSION`. Continue rejects those legacy Catalog rules as
`city_catalog_upgrade_required` before completed-Evidence, Knowledge,
single-flight, callback or source access; Present rejects the same unsupported snapshot before read-model
projection. This is rejection coverage only—there is no legacy-catalog-rules run creator, migration or
import path.
Separately rehash a Catalog with `schemaVersion: "city-catalog@2"` and reject it as structural
`integrity_mismatch`, not an upgrade case. Set only the lookup key/manifest
`packageSchemaVersion` to `"city-catalog@2"` while its signed package definition retains its actual
package schema and reject that package binding as `integrity_mismatch`; neither mutation may reach
completed Evidence or Knowledge.

Repeat the inconsistent forged-ID/root/member cases for Continue after its `findExact`. Also return a
fully valid alternate root with recomputed membership and IDs: pure reconstruction succeeds, but exact
comparison with `CityCatalogStorePort.loadVerified(frozenCatalogRevisionId)` fails. Never consult
`latestInstalledVerified` for Continue. Repeat the malformed final-member/final-broadband route,
version and binding cases. Each fails before the first fixed/safety/search/document call, before a
single-flight research promise is installed and with zero Evidence, Knowledge, marker, cursor or budget
write. Assert all member tuples were preflight in the valid case. Store-level seal/load tests still
independently reject a replay mismatch later; Core's early trust gate is not a substitute for the Task 7
store gate.

After the exact package/catalog/plan gate, mutate each verified Criteria/Knowledge/evaluator semantic
input or a structurally valid rehashed Ranking order/factor/exclusion. Require
`verifyCityRankingSnapshotSemantics` to fail before completed-Evidence lookup, Task 7 replay, Knowledge
recovery, single-flight, callback or source call. A valid case calls the semantic verifier once using
only inputs named by the loaded snapshot and the exact installed package.

- [ ] **Step 5: Implement present-first Continue ordering**

`prepareCityFrontierContinuation` may call only the no-context head/command loaders and copy the
ranking snapshot ID plus active/check metadata needed for its opaque prepared IDs; it must not load the
Ranking payload, prefetch a completed Evidence/check, replay Task 7, read/write Knowledge, resolve a
package, install single-flight or invoke an event/source callback. `continueCityFrontier`
revalidates rather than trusting that prepared object, so the order below applies across the complete
Prepare+Continue attempt.

Continue first calls the no-context `loadHeadVerified(runId)`, validates terminal state, ten-marker
ceiling, prepared/head identity and active city/check identity, then checks abort. It next calls exactly
`loadRankingVerified(head.rankingSnapshotId)` with no caller context, verifies the returned snapshot ID,
run and head binding, and reads its structurally verified `installedPackageContext`. These head/ranking
operations are the only reads permitted before the historical package gate. Continue takes the lookup
key solely as `ranking.installedPackageContext` and passes that exact closed object to the inward
`InstalledCityPackageLookupPort.findExact`; it neither rebuilds the key from individual run/head fields
nor reruns the country-only availability, `findReady` or `latestInstalledVerified` path. A later package
definition must not reinterpret a frozen run.

`undefined` throws `city_package_revision_not_installed`. A returned value must expose a fresh frozen
`installedPackageManifest` whose key canonically equals the exact requested context. Its ID is audit
metadata already authenticated by the manifest-store/lookup adapter postcondition; Continue has no
independent expected ID and does not compare it. Its visible definition country/
package/schema/evidence-rules and reconstructed catalog ID must equal the same key; any visible or
hidden-key/full-projection mismatch throws
`integrity_mismatch`. Until this succeeds, Continue performs no completed-Evidence/check lookup, Task 7
package replay, Knowledge read/recovery/write, single-flight registration, event/callback emission, or
fixed/safety/search/document source call. Immediately afterwards, repeat the verified installed-context
gate from Step 3 with a frozen rather than latest trust anchor: call
`reconstructVerifiedCityCatalog` on the exact package projection, then call
`CityCatalogStorePort.loadVerified(ranking.installedPackageContext.catalogRevisionId)` and require exact
Registry ID, catalog ID and canonical full-projection equality. Do not call
`latestInstalledVerified`; a later installation cannot redirect an existing run. Require the trusted
Registry/catalog root and package country/ID/evidence rules to equal their corresponding frozen context
fields; require `context.packageSchemaVersion` to equal only the signed manifest/package definition.
Require both reconstructed and authoritative Catalogs to retain
`schemaVersion === "city-catalog@1"` and
`rulesVersion === CITY_CATALOG_RULES_VERSION`; legacy Catalog rules are
`city_catalog_upgrade_required`. Require the Ranking snapshot's top-level country/package/schema/catalog duplicates to obey
their equality equations. Before any completed-Evidence or Knowledge read and before installing
single-flight, enumerate the complete trusted member set and pass all three plans of every tuple through
`reconstructCityFixedSourcePlan(value, tupleExpectedSourceId)`, including exact member/source/criterion/
definition/parser/rules/claim binding; then reconstruct the safety plan/directory and bind all exact
criteria and compiled behavior versions. Now load the exact Criteria snapshot and every non-null
Knowledge revision named by the structurally verified Ranking, build the complete
`CityRankingSemanticInputs` with the trusted Registry/catalog and installed evaluator registry, and
call `verifyCityRankingSnapshotSemantics` exactly once. Missing/extra/drifting input or ranking output is
`integrity_mismatch`. All source-run inputs use only that fresh frozen verified installed context.

Only after the entire frozen trust/preflight gate passes does Continue look up the completed check by
deterministic ID. If present it replays Task 7 Evidence and publishes missing Knowledge; if absent it
uses one composition-scoped promise keyed by `cityCheckRunId` so concurrent identical commands share
the same bounded four-fact research call. Recovery and fresh research therefore use the same exact
historical installed package after restart and cannot be redirected to the latest package. The raw
installed package merely supplies its immutable per-member `CityFixedSourcePlan` values,
Registry+catalog projection, safety plan/directory and validators; it never constructs or imports an
adapter. Composition injects the inward `CityCatalogStorePort` into Application for the latest/exact
trust-anchor reads above; Application knows no SQLite type, and that port is not added to the City
Evidence store constructor. Composition also exposes the Task 7
`CityEvidencePackageReplayPort` projection from
that same installed value and injects it, together with the same `EvidenceIntegrity`, into the
synchronous `SqliteCityEvidenceStore(database, integrity, packageReplay)`. Application does not pass a
caller-owned replay plan or a latest-catalog lookup to the store. The full `sign` capability is scoped
only to store-owned signing/verification and Application's one generic `sealEvidencePlan` call. Pure catalog/package/fixed/safety-plan
reconstruction receives only `CityDecisionIntegrity { canonical, hash }`. The store derives the inward
no-sign `CityEvidenceReplayIntegrity { canonical, hash, hashBytes }` Infrastructure implementation for
the artifact bridge; no Research/Application module imports crypto. At seal and load, the store independently reloads and
re-verifies the exact Registry+catalog projection and plans; it never trusts Core's earlier verification.
`city-frontier-composition.ts` separately constructs
`slovenia-city-source-adapter.ts` as the Infrastructure implementation of `CityFixedRoutePort` and
constructs the Infrastructure `CityFixedDeadlineScheduler` over the real timer primitive. It injects
both ports into Application; Application owns/injects the canonical clock and derives each absolute
deadline. For every fixed run, Application passes `now` from that clock,
`deadlineScheduler` from Infrastructure, exact `validateValue: verifiedInstalled.validateValue`, and exact
`validateSourcePeriod: verifiedInstalled.validateSourcePeriod` into `CityFixedSourceRunInput`. Run the three
strict fixed plans independently through `runCityFixedSourcePlan`; neither Research nor the source
adapter reads `Date`, creates a timer or chooses a validator. Application invokes
`runCitySafetyDiscovery` separately with the verified installed safety plan/directory, public
city/year/criterion terms and injected search/document ports, then converts its Research-owned replay
ledger through the pure safety terminal adapter using the same reconstructed plan/directory and
`cityCheckRunId`, including deterministic official fallback lineage for a zero-candidate unknown.

Call `composeTerminalEvidenceEntries` with the canonical four-source order, the three fixed terminal
entries and the safety terminal entry. The fixed runner entries already contain the ordered union of
every route artifact, including rejected prefixes. After all four independent ledgers and captured
artifacts exist, obtain one canonical `completedAt` no earlier than any ledger completion or capture and
construct the exact Task 7 `CityEvidenceContext`: `city-evidence-context@1`, deterministic
`cityCheckRunId`, frontier run/city/country, frozen package/schema/catalog, criteria/ranking,
four-definition map, `evidenceRulesVersion`, shared `assessmentAt` and that `completedAt`. All five
country/package/schema/catalog/evidence-rules values come directly from
`ranking.installedPackageContext` and are not independently reconstructed from the current package.
Every ledger uses that exact `assessmentAt`; Core/store enforce the Task 7 owned-artifact chronology and any
prior Evidence completion is `<= assessmentAt`. Compute
`contextHash = cityEvidenceContextHash(context, integrity)` once in Application.
Set `evidenceId` exactly to `${cityCheckRunId}:evidence` and call `sealEvidencePlan` exactly once
on the composed four entries with `id: evidenceId`, that hash and
`assessmentDate === context.assessmentAt.slice(0, 10)`. This one call is the only boundary that maps
`SealEvidenceInput.rulesVersion = context.evidenceRulesVersion`; the City context and overlay never
expose an ambiguous `rulesVersion` alias.

Then build `CityEvidenceSealInput.artifacts` as the exact complete live artifact union in the sealed
generic manifest's order from all three fixed results plus the safety discovery artifacts, with no
missing/extra distinct artifact ID. Repeated canonically identical safety-ledger references reuse the
one distinct manifest artifact and remain occurrence-validated; conflicting repeats fail. Pass the
same context fields without re-derivation, that array, the verified already signed generic bundle, all
three fixed ledgers and the safety ledger to the City store. The store resolves the catalog-bound replay
contract and atomically persists the bytes, generic bundle and overlay without a second generic seal or
replacement signature. Publish all four Knowledge facts, evaluate criteria, append one
green/yellow/red marker successor, derive the exact three-way terminal reason, emit the committed
marker, construct the verified working-or-terminal read model, emit exactly one
`city_continuation_completed`, then return the canonically identical model. Abort/deadline,
malformed source output and every fixed operation failure publish no Evidence/Knowledge and advance
no cursor or city budget; they never become unknown.
`city-frontier-composition.ts` constructs the provider-neutral search port exactly as Task S2
specifies: valid config uses
`createCitySafetySearchPort({step:createHttpCitySafetySearchStep(config, request), providerId:config.providerId})`;
missing config uses `createUnconfiguredCitySafetySearchPort()`, stays explicitly unconfigured and
may close `source_unavailable` after configured official routes are exhausted; it does not invalidate an otherwise complete installed plan. Current SI never reaches this path while its candidate is unready.
Recovery reuses the one already sealed generic four-source bundle and overlay without network or a
second seal. Lookup always uses `${cityCheckRunId}:evidence`: an exact retry is idempotent only when the
generic bundle, context, all ledgers and overlay payload are canonically identical. The same check-run
paired with any different ID, or with the derived ID but different bytes/metadata, is an integrity
conflict. A row for a different check-run occupying either unique key is likewise a conflict; all such
conflicts perform no write or source retry. A different check-run otherwise derives a different ID.
An emit failure after append never
rolls back the revision. Clear
the single-flight entry in `finally`; never hold SQLite across HTTP/search or add a lease table.

- [ ] **Step 6: Run GREEN and commit**

```bash
./node_modules/.bin/vitest run tests/integration/city-frontier.test.ts \
  tests/integration/city-frontier-store.test.ts \
  tests/integration/city-knowledge-store.test.ts \
  tests/integration/country-resolution.test.ts
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/eslint src/application/city-{frontier,verifier}.ts \
  src/infrastructure/city-{frontier-composition,verifier-adapter}.ts \
  src/infrastructure/sources/slovenia-city-source-adapter.ts \
  tests/integration/city-frontier.test.ts
git diff --check
git add src/application/city-frontier.ts src/application/city-verifier.ts \
  src/infrastructure/city-frontier-composition.ts \
  src/infrastructure/city-verifier-adapter.ts \
  src/infrastructure/sources/slovenia-city-source-adapter.ts \
  src/infrastructure/composition-root.ts \
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

Load/verify terminal and source graph inside the transaction, derive yellow warning basis, accepted/reviewed link binding and branch parent server-side, construct both pure values, insert both, reload/verify both, then commit. Source links never affect selectability by themselves. Add `listSelectionsWithBranchesVerified(runId)` to the inward writer port; Select and `presentCityFrontier` return the complete verified history. A second city from the same terminal reuses the same pre-city parent and creates a sibling commit.

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
  src/infrastructure/composition-root.ts tests/integration/city-selection.test.ts
git commit -m "feat: select city branch"
```
