# VS-3R Yellow Resolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the preliminary automatic country shortlist into an append-only, user-resolved shortlist with no unresolved yellow countries, while preserving formal Evidence truth and the existing planet history.

**Architecture:** Decision owns a pure country-resolution policy that reconstructs uncertainty, occupied slots, effective status, cursor and terminal state from immutable inputs. Application verifies the existing Place Frontier graph, appends one narrow resolution revision chain and reuses the existing `CountryVerifierPort` for replacements; Infrastructure stores that chain in one HMAC-protected SQLite table. Experience adds strict JSON commands plus a finite NDJSON continuation while the existing `PlaceFrontierJourney` remains the sole owner of `ProductShell` and the globe instance.

**Tech Stack:** Node 24, TypeScript 6.0.3, Next.js 16.3.0, React 19.2.8, SQLite/better-sqlite3 13.0.3, Vitest 4.1.10, Zod 4.4.3, the existing finite-NDJSON reader, Evidence HMAC/replay, Country Knowledge publication and react-globe.gl presentation.

**Approved design:** [`docs/superpowers/specs/2026-08-12-vs-3r-yellow-resolution-design.md`](../specs/2026-08-12-vs-3r-yellow-resolution-design.md)

## Global Constraints

- The existing `FormalResidenceVerdict` is immutable official truth. Resolution never edits its marker, routes, reasons, Evidence or Knowledge lineage.
- Effective status is derived only: formal green -> green; formal red -> red; unresolved formal yellow -> yellow; accepted formal yellow -> green; rejected formal yellow -> red.
- Accepted yellow is visually and functionally indistinguishable from ordinary green after commit; rejected yellow is visually and functionally ordinary red, but its explanation must not claim proven legal impossibility.
- Automatic Place Frontier completes first. Its Ranking and Shortlist snapshots remain immutable and preliminary; City Frontier must later accept only a non-empty verified resolved snapshot.
- Replacements come only from the existing full `RankingSnapshot.ordered`, in frozen rank order. Never rerank, read current ranking inputs, or reintroduce `excludedPlaces`.
- An unresolved yellow still occupies a provisional slot. Replacement is required only after formal red or user rejection leaves fewer than five occupied slots.
- Every decision, replacement completion and terminal outcome is append-only. A committed decision survives transport failure and is never rolled back with Evidence or Knowledge.
- Only explicit continuation may call `CountryVerifierPort.check` and official HTTPS. Start, decision, presentation and reload are zero-network.
- Replacement child identity is derived from `resolutionRunId + countryCode`, not the source Place Frontier run.
- Before defense, external LLM/API/provider calls, SDKs, credentials, prompts and model-backed ranking remain exactly zero.
- Add exactly one application table, `country_resolution_revisions`. Do not add an event store, mutable head table, command table, queue, worker, polling, workflow engine, crawler, ORM or second Evidence/Knowledge pipeline.
- Keep stream events ephemeral. Persist only complete canonical working/resolved revisions.
- Do not implement City Registry, City Knowledge, city ranking, jobs, housing, taxes, budget or Life Git in this plan.
- Preserve the unrelated untracked `.superpowers/brainstorm/12369-1786346924/` directory.
- A browser walkthrough, if later executed, requires a fresh explicit user permission immediately before browser use.

---

### Task 1: Canonicalize the VS-3R product contract

**Requirements:** REQ-YR-01..06; NFR-YR-01..06; SCN-YR-01..07

**Files:**
- Create: `docs/changes/active/vs-3r-yellow-resolution/change.md`
- Modify: `docs/product/charter.md`
- Modify: `docs/product/glossary.md`
- Modify: `docs/product/demo-story.md`
- Modify: `docs/architecture/spec-of-specs.md`
- Modify: `docs/README.md`

**Interfaces:**
- Consumes: the approved written design and the implemented historical VS-3 snapshots.
- Produces: one active `VS-3R` change package and forward-only canonical product wording. Historical VS-3 design/change/evidence files remain byte-unchanged.

- [ ] **Step 1: Write the active change package with exact traceability**

Create `change.md` with `GOAL-YR-01`, `REQ-YR-01..06`, `NFR-YR-01..06`, `SCN-YR-01..07`, the formal/effective table, ordered tasks `TASK-YR-01..07`, links to the approved design and this plan, and status `approved — implementation pending`.

The change text must explicitly say:

~~~text
Automatic Shortlist Snapshot is preliminary.
Unresolved formal yellow blocks a resolved shortlist and City Frontier.
accepted_at_own_risk produces ordinary effective green without changing formal yellow.
rejected produces ordinary effective red without claiming formal impossibility.
Resolved Country Shortlist Snapshot is the only future City Frontier input.
~~~

- [ ] **Step 2: Amend only the forward canonical documents**

Apply these exact semantic changes:

- Charter: replace direct green/yellow country selection with automatic frontier -> mandatory Yellow Resolution -> resolved shortlist -> future city research.
- Glossary: add `Formal status`, `Effective status`, `Yellow decision`, `Resolution revision`, `Resolved Country Shortlist Snapshot`; redefine `Top-5` as up to five effective-green countries after resolution.
- Demo Story: insert the yellow accept/reject phase; accepted becomes ordinary green, rejected becomes persistent ordinary red and triggers replacement.
- Spec of Specs: add a `VS-3R` row between VS-3 and City Frontier, assign Decision/Application/Infrastructure/Experience ownership, and state that old VS-3 stop is only the automatic-phase stop.
- README: list the active VS-3/VS-3R change packages and link the approved design and this implementation plan.

Do not rewrite the historical `docs/changes/active/vs-3-place-frontier/change.md`, its design or its implementation evidence as if VS-3R existed then.

- [ ] **Step 3: Run the canonical wording audit**

Run:

~~~bash
rg -n 'Resolved Country Shortlist|effective status|accepted_at_own_risk|VS-3R' \
  docs/product/charter.md docs/product/glossary.md docs/product/demo-story.md \
  docs/architecture/spec-of-specs.md docs/README.md \
  docs/changes/active/vs-3r-yellow-resolution/change.md
rg -n 'yellow.*(напрямую|сразу).*city|green/yellow.*окончатель' \
  docs/product/charter.md docs/product/glossary.md docs/product/demo-story.md \
  docs/architecture/spec-of-specs.md
git diff --check
~~~

Expected: first command finds the new normative terms in every intended surface; second command exits 1 with no stale forward-flow matches; diff check exits 0.

- [ ] **Step 4: Commit the canonical amendment**

~~~bash
git add docs/README.md docs/product/charter.md docs/product/glossary.md \
  docs/product/demo-story.md docs/architecture/spec-of-specs.md \
  docs/changes/active/vs-3r-yellow-resolution/change.md
git commit -m "docs: canonicalize VS3R yellow resolution"
~~~

---

### Task 2: Add the pure Country Resolution policy

**Requirements:** REQ-YR-02..04, REQ-YR-06; SCN-YR-01..05, SCN-YR-07

**Files:**
- Create: `src/decision/country-resolution-policy.ts`
- Create: `tests/domain/country-resolution-policy.test.ts`

**Interfaces:**
- Consumes: `FormalResidenceVerdict`, `FormalMarker`, `FormalEvidenceReference`, `FrontierMarker`-shaped marker input, and frozen ordered country codes.
- Produces:

~~~ts
export const COUNTRY_RESOLUTION_RULES_VERSION = "country-resolution@1" as const;
export const YELLOW_RISK_WARNING_VERSION = "yellow-risk@1" as const;

export type YellowDecisionKind = "accepted_at_own_risk" | "rejected";
export type EffectiveCountryStatus = "green" | "yellow" | "red";
export type CountryResolutionPhase = "awaiting_decision" | "replacement_required";
export type ResolutionStopCondition = "five_effective_green" | "ranking_exhausted";

export interface YellowUncertaintyReason {
  readonly code: string;
  readonly claimIds: readonly string[];
  readonly evidence: readonly FormalEvidenceReference[];
  readonly navigation: readonly { readonly sourceId: string; readonly url: string; readonly label: string }[];
}

export interface YellowUncertaintyBasis {
  readonly unknownRoutes: readonly {
    readonly routeId: string;
    readonly reasons: readonly YellowUncertaintyReason[];
  }[];
  readonly catalogCompletenessUnprovable?: YellowUncertaintyReason;
}

export interface ResolutionMarkerProjection {
  readonly countryCode: string;
  readonly rank: number;
  readonly formalStatus: FormalMarker;
  readonly formalMarkerDigest: string;
  readonly expectedUncertaintyBasis?: YellowUncertaintyBasis;
}

export interface YellowDecision {
  readonly countryCode: string;
  readonly decision: YellowDecisionKind;
  readonly formalMarkerDigest: string;
  readonly uncertaintyBasis: YellowUncertaintyBasis;
  readonly warningCopyVersion: "yellow-risk@1";
  readonly decidedAt: string;
  readonly commandId: string;
}

export interface CountryResolutionProjection {
  readonly unresolvedCountryCodes: readonly string[];
  readonly slotCountryCodes: readonly string[];
  readonly resolvedCountryCodes: readonly string[];
  readonly nextUncheckedRank: number;
  readonly currentPromptCountryCode?: string;
  readonly phase?: CountryResolutionPhase;
  readonly terminal?: {
    readonly resolvedEntries: readonly {
      readonly countryCode: string;
      readonly rank: number;
      readonly formalMarkerDigest: string;
    }[];
    readonly stopCondition: ResolutionStopCondition;
  };
}

export function deriveYellowUncertaintyBasis(
  verdict: FormalResidenceVerdict,
): YellowUncertaintyBasis;

export function effectiveCountryStatus(
  formalStatus: FormalMarker,
  decision?: YellowDecisionKind,
): EffectiveCountryStatus;

export function reconstructCountryResolution(input: {
  readonly orderedCountryCodes: readonly string[];
  readonly markers: readonly ResolutionMarkerProjection[];
  readonly decisions: readonly YellowDecision[];
  readonly persisted?: Pick<CountryResolutionProjection,
    "unresolvedCountryCodes" | "slotCountryCodes" | "resolvedCountryCodes" |
    "nextUncheckedRank" | "currentPromptCountryCode" | "phase" | "terminal">;
}): CountryResolutionProjection;

export function assertCountryResolutionTransition(input: {
  readonly predecessor?: CountryResolutionSemanticState;
  readonly successor: CountryResolutionSemanticState;
  readonly orderedCountryCodes: readonly string[];
}): void;
~~~

`CountryResolutionSemanticState` is the storage-independent subset `{kind, decisions, markerProjections, nextUncheckedRank, unresolvedCountryCodes, slotCountryCodes, resolvedEntries, phase?, stopCondition?}` used by Task 3. `markerProjections` contains only `ResolutionMarkerProjection`, never the Application-owned full `FrontierMarker`. The type contains no IDs, timestamps, React, SQLite or crypto adapters.

~~~ts
export interface CountryResolutionSemanticState {
  readonly kind: "working" | "resolved";
  readonly decisions: readonly YellowDecision[];
  readonly markerProjections: readonly ResolutionMarkerProjection[];
  readonly nextUncheckedRank: number;
  readonly unresolvedCountryCodes: readonly string[];
  readonly slotCountryCodes: readonly string[];
  readonly resolvedEntries: readonly {
    readonly countryCode: string;
    readonly rank: number;
    readonly formalMarkerDigest: string;
  }[];
  readonly phase?: CountryResolutionPhase;
  readonly stopCondition?: ResolutionStopCondition;
}
~~~

- [ ] **Step 1: Write the failing effective-status and uncertainty tests**

Add literal assertions for all five rows:

~~~ts
expect(effectiveCountryStatus("green")).toBe("green");
expect(effectiveCountryStatus("red")).toBe("red");
expect(effectiveCountryStatus("yellow")).toBe("yellow");
expect(effectiveCountryStatus("yellow", "accepted_at_own_risk")).toBe("green");
expect(effectiveCountryStatus("yellow", "rejected")).toBe("red");
~~~

Build a verdict with one impossible route, two unknown routes and unproven catalog. Assert that the basis preserves only unknown route IDs, their reason code/claim/Evidence/navigation references in verdict order, plus the exact catalog-unproven reason code/references in `catalogCompletenessUnprovable`; impossible-route reasons and human summary copy are absent. Add a catalog-only yellow case with no unknown route and assert its basis is still non-empty: derive the code from `catalogCompleteness.reasonCode`, reuse matching formal-reason references when present, otherwise persist empty reference arrays rather than inventing Evidence.

- [ ] **Step 2: Run the focused tests and confirm RED**

Run:

~~~bash
./node_modules/.bin/vitest run tests/domain/country-resolution-policy.test.ts
~~~

Expected: FAIL because `country-resolution-policy.ts` does not exist.

- [ ] **Step 3: Implement strict status and uncertainty reconstruction**

Reject any decision on formal green/red, accepted/rejected without formal yellow, duplicate command/country decisions, mismatched marker digest, invalid instant, unknown warning version, duplicate/unknown marker country or non-prefix ranks with `integrity_mismatch`.

Application computes `formalMarkerDigest = hash(canonical(full FrontierMarker))` and supplies `expectedUncertaintyBasis = deriveYellowUncertaintyBasis(fullMarker.formalVerdict)` for formal yellow. The pure policy accepts these verified expectations as data but never hashes or imports Application. It canonical-compares every persisted decision basis with the expected basis; green/red projections must not carry one.

- [ ] **Step 4: Add queue, slot, cursor and stop RED tests**

Use an ordered six-country fixture and assert:

- `3 green + 2 unresolved yellow` occupies five slots and prompts the lowest-rank yellow without replacement;
- accepted yellow remains a slot and moves to `resolvedCountryCodes`;
- rejected yellow drops from slots and yields `replacement_required` at the next 1-based rank;
- formal red replacement advances the cursor without a slot;
- replacement yellow occupies a slot and joins the globally rank-sorted prompt queue;
- five effective green yields `five_effective_green`;
- exhausted rank with 0–4 effective green yields `ranking_exhausted`, including empty;
- a persisted queue/slot/cursor/phase mismatch is rejected;
- a successor adds exactly one decision or one next-rank marker; no successor is allowed after resolved.

- [ ] **Step 5: Implement the minimal transition policy**

Use 1-based ranks throughout. `nextUncheckedRank === orderedCountryCodes.length + 1` is the exhausted sentinel. `slotCountryCodes` means provisional occupied slots: formal green + unresolved yellow + accepted yellow; it excludes formal red and rejected yellow. `resolvedCountryCodes` means effective green only.

State precedence is exact:

~~~text
if slot count < 5 and cursor not exhausted -> replacement_required
else if unresolved queue non-empty -> awaiting_decision
else -> terminal (five_effective_green or ranking_exhausted)
~~~

- [ ] **Step 6: Run the focused policy gate**

~~~bash
./node_modules/.bin/vitest run tests/domain/country-resolution-policy.test.ts
./node_modules/.bin/tsc --noEmit
~~~

Expected: policy tests pass and TypeScript exits 0.

- [ ] **Step 7: Commit**

~~~bash
git add src/decision/country-resolution-policy.ts tests/domain/country-resolution-policy.test.ts
git commit -m "feat: define country resolution policy"
~~~

---

### Task 3: Persist the append-only resolution chain

**Requirements:** REQ-YR-01, REQ-YR-02, REQ-YR-04, REQ-YR-06; NFR-YR-01..03, NFR-YR-05; SCN-YR-01, SCN-YR-02, SCN-YR-05, SCN-YR-07

**Files:**
- Create: `src/application/country-resolution-contracts.ts`
- Create: `src/infrastructure/sqlite/country-resolution-store.ts`
- Create: `tests/integration/country-resolution-store.test.ts`
- Modify: `src/infrastructure/sqlite/schema.sql`
- Modify: `src/infrastructure/sqlite/db.ts`
- Modify: `src/infrastructure/sqlite/place-frontier-store.ts`
- Modify: `src/application/place-frontier.ts`
- Modify: `tests/integration/database-schema.test.ts`
- Modify: `tests/integration/place-frontier.test.ts`
- Modify: `tests/integration/confirmed-life.test.ts`
- Modify: `tests/branch/life-git.test.ts`

**Interfaces:**
- Consumes: Task 2 policy, current `RankingSnapshot`, `ShortlistSnapshot`, profiles, Knowledge and marker replay.
- Produces:

~~~ts
export interface ResolutionSourceBinding {
  readonly automaticShortlistSnapshotId: string;
  readonly rankingSnapshotId: string;
  readonly profileSnapshotId: string;
  readonly preferenceProfileSnapshotId: string;
}

export interface ResolvedCountryEntry {
  readonly countryCode: string;
  readonly rank: number;
  readonly formalMarkerDigest: string;
}

export interface CountryResolutionSemanticContext {
  readonly source: ResolutionSourceBinding;
  readonly orderedCountryCodes: readonly string[];
  readonly markerProjections: readonly ResolutionMarkerProjection[];
}

export interface CountryResolutionChainLocator {
  readonly resolutionRunId: string;
  readonly source: ResolutionSourceBinding;
  readonly revisions: readonly CountryResolutionRevision[];
}

interface CountryResolutionRevisionBase extends ResolutionSourceBinding {
  readonly schemaVersion: "country-resolution@1";
  readonly rulesVersion: "country-resolution@1";
  readonly id: string;
  readonly resolutionRunId: string;
  readonly predecessorRevisionId?: string;
  readonly decisions: readonly YellowDecision[];
  readonly replacementMarkers: readonly FrontierMarker[];
  readonly nextUncheckedRank: number;
  readonly unresolvedCountryCodes: readonly string[];
  readonly slotCountryCodes: readonly string[];
  readonly contextHash: string;
  readonly createdAt: string;
}

export interface WorkingCountryResolutionRevision extends CountryResolutionRevisionBase {
  readonly kind: "working";
  readonly phase: "awaiting_decision" | "replacement_required";
}

export interface ResolvedCountryShortlistSnapshot extends CountryResolutionRevisionBase {
  readonly kind: "resolved";
  readonly resolvedEntries: readonly ResolvedCountryEntry[];
  readonly stopCondition: "five_effective_green" | "ranking_exhausted";
}

export type CountryResolutionRevision =
  | WorkingCountryResolutionRevision
  | ResolvedCountryShortlistSnapshot;

export interface ResolutionIntegrity {
  canonical(value: unknown): string;
  hash(value: string): string;
}

export type CountryResolutionOperation =
  | {
      readonly commandId: string;
      readonly kind: "start";
      readonly automaticShortlistSnapshotId: string;
    }
  | {
      readonly commandId: string;
      readonly kind: "yellow_decision";
      readonly expectedHeadRevisionId: string;
      readonly countryCode: string;
      readonly decision: YellowDecisionKind;
      readonly warningCopyVersion: "yellow-risk@1";
    }
  | {
      readonly commandId: string;
      readonly kind: "replacement_completed";
      readonly expectedHeadRevisionId: string;
      readonly countryCode: string;
      readonly countryCheckRunId: string;
    };

// Deterministic for the current default run; future restart may explicitly choose another run ID.
export function countryResolutionRunId(
  automaticShortlistSnapshotId: string,
  integrity: ResolutionIntegrity,
): string;

// Binds the exact frozen source IDs, rules and predecessor; excludes timestamps.
export function countryResolutionContextHash(input: {
  readonly resolutionRunId: string;
  readonly source: ResolutionSourceBinding;
  readonly predecessorRevisionId?: string;
  readonly operation: CountryResolutionOperation;
  readonly rulesVersion: "country-resolution@1";
}, integrity: ResolutionIntegrity): string;

export function countryResolutionRevisionId(
  resolutionRunId: string,
  operation: CountryResolutionOperation,
  integrity: ResolutionIntegrity,
): string;

export interface CountryResolutionStorePort {
  append(input: {
    readonly revision: CountryResolutionRevision;
    readonly operation: CountryResolutionOperation;
    readonly context: CountryResolutionSemanticContext;
  }): CountryResolutionRevision;
  loadRevisionVerified(id: string, context: CountryResolutionSemanticContext):
    CountryResolutionRevision;
  loadHeadVerified(resolutionRunId: string, context: CountryResolutionSemanticContext):
    CountryResolutionRevision;
  loadChainVerified(resolutionRunId: string, context: CountryResolutionSemanticContext):
    readonly CountryResolutionRevision[];
  findByCommandVerified(
    resolutionRunId: string,
    commandId: string,
    context: CountryResolutionSemanticContext,
  ): {
    readonly revision: CountryResolutionRevision;
    readonly operation: CountryResolutionOperation;
  } | undefined;
  findRootForRunVerified(resolutionRunId: string, context: CountryResolutionSemanticContext):
    CountryResolutionRevision | undefined;
  locateChainVerified(input:
    | { readonly resolutionRunId: string }
    | { readonly revisionId: string }
  ): CountryResolutionChainLocator;
}
~~~

`locateChainVerified` verifies only closed row bytes/hash/HMAC, mirrored columns and predecessor topology needed to locate the immutable source and candidate replacement markers. Application must immediately present that exact source, replay every located replacement marker, derive `CountryResolutionSemanticContext`, then use the context-required verified loads; no business projection may trust the locator result alone. The contracts module declares the resolved snapshot type; the verified Application guard which loads it by revision ID is implemented and tested in Task 4. No City subsystem is added.

Add `presentPlaceFrontierByShortlistId(shortlistSnapshotId)` to `PlaceFrontierApplication`, backed by one shared verified presentation loader. Change `SqlitePlaceFrontierStore.loadShortlistVerified(idOrRunId)` to load the shortlist row first and then its exact ranking reference; retain all existing run-ID callers.

- [ ] **Step 1: Write the failing schema and source-ID loader tests**

Assert the ninth application table is `country_resolution_revisions`; exact columns, four unique indexes and no-update/no-delete triggers exist. Add an incompatible pre-existing resolution table test that must throw `database_schema_reset_required` without changing that table. Add a Place Frontier test proving exact shortlist ID and run ID return the same fully replayed read model.

- [ ] **Step 2: Run the focused tests and confirm RED**

~~~bash
./node_modules/.bin/vitest run \
  tests/integration/database-schema.test.ts \
  tests/integration/place-frontier.test.ts \
  tests/integration/country-resolution-store.test.ts
~~~

Expected: FAIL because the table/store/test module and shortlist-ID presentation do not exist.

- [ ] **Step 3: Add the one-table schema**

Use exactly:

~~~sql
CREATE TABLE IF NOT EXISTS country_resolution_revisions (
  id TEXT PRIMARY KEY,
  resolution_run_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('working', 'resolved')),
  predecessor_id TEXT REFERENCES country_resolution_revisions(id),
  automatic_shortlist_snapshot_id TEXT NOT NULL REFERENCES place_frontier_snapshots(id),
  ranking_snapshot_id TEXT NOT NULL REFERENCES place_frontier_snapshots(id),
  command_id TEXT NOT NULL,
  command_kind TEXT NOT NULL CHECK (
    command_kind IN ('start', 'yellow_decision', 'replacement_completed')
  ),
  command_json TEXT NOT NULL,
  command_hash TEXT NOT NULL CHECK (length(command_hash) = 64),
  schema_version TEXT NOT NULL CHECK (schema_version = 'country-resolution@1'),
  rules_version TEXT NOT NULL CHECK (rules_version = 'country-resolution@1'),
  context_hash TEXT NOT NULL CHECK (length(context_hash) = 64),
  payload_json TEXT NOT NULL,
  payload_hash TEXT NOT NULL CHECK (length(payload_hash) = 64),
  hmac TEXT NOT NULL CHECK (length(hmac) = 64),
  created_at TEXT NOT NULL,
  CHECK (predecessor_id IS NULL OR predecessor_id <> id)
);

CREATE UNIQUE INDEX IF NOT EXISTS country_resolution_one_root
ON country_resolution_revisions (resolution_run_id)
WHERE predecessor_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS country_resolution_one_successor
ON country_resolution_revisions (predecessor_id)
WHERE predecessor_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS country_resolution_one_command
ON country_resolution_revisions (resolution_run_id, command_id);

CREATE UNIQUE INDEX IF NOT EXISTS country_resolution_one_terminal
ON country_resolution_revisions (resolution_run_id)
WHERE kind = 'resolved';
~~~

Add immutable update/delete triggers. Add `CURRENT_COUNTRY_RESOLUTION_TABLE` and `preflightExistingCountryResolution()` so an existing incompatible table fails before `schema.sql`; a database with no table remains an additive upgrade.

- [ ] **Step 4: Write the store RED matrix**

Cover root working, immediate resolved root, decision successor, replacement successor and resolved successor round trips. Then assert failure for:

- extra/missing keys, noncanonical JSON, bad payload hash/HMAC/context hash;
- wrong source shortlist/ranking kind or relationship;
- missing/wrong/forked predecessor and successor after resolved;
- altered decision, uncertainty basis, marker digest, replacement rank/country/child ID, cursor, queue, slots or rules after re-signing;
- UPDATE/DELETE;
- same command+payload convergence, same command+different payload integrity failure, new stale predecessor -> `stale_resolution_head`;
- two real SQLite connections racing accept vs reject -> one successor and one `stale_resolution_head`;
- two identical command workers -> both return the same verified revision.

- [ ] **Step 5: Implement append/load/verify**

`SqliteCountryResolutionStore(database, hmacKey)` owns synchronous immediate transactions. Each row HMAC signs:

~~~ts
canonicalJson({
  revision,
  operation,
})
~~~

The store computes canonical `command_json` and `command_hash` itself from the closed operation union. It never trusts an opaque caller-supplied payload hash. Start uses deterministic command ID `country-resolution:start:<sha256(sourceShortlistId)>`; every replacement row uses its deterministic `countryCheckRunId` as command ID, so one Continue call may append several independently idempotent rows. `countryResolutionRevisionId` hashes `{resolutionRunId, operation}`; `countryResolutionContextHash` hashes `{resolutionRunId, source, predecessorRevisionId, operation, rulesVersion}`. Neither formula includes `createdAt` or server-derived decision `decidedAt`, so an identical retry targets the same row before any new timestamp is generated.

Append order is exact:

1. Look up `(resolutionRunId, commandId)` inside the immediate transaction.
2. If found, verify row/chain and canonical operation; the same exact operation returns the prior revision even if head advanced, while any different operation under the same ID throws `integrity_mismatch`.
3. If new, load and verify the current head; candidate predecessor must equal it (or no root exists for start), otherwise `stale_resolution_head`.
4. Strict-decode the closed unions, verify canonical bytes/hash/HMAC, mirrored columns, predecessor chain, source row kinds/relationship, validate the caller-supplied semantic context against the same source IDs and every stored marker digest, then call Task 2 reconstruction and transition assertion.
5. `INSERT`; reload and canonical-compare before commit.
6. Normalize a lost command race to same/conflict and a lost predecessor race to `stale_resolution_head`; all cryptographic/semantic failures remain `integrity_mismatch`.

The SQLite foreign keys are insufficient because both source IDs target a polymorphic table: explicitly require `shortlist.kind=shortlist`, `ranking.kind=ranking`, and `shortlist.rankingSnapshotId=ranking.id`. Infrastructure owns these local relational checks and its own row cryptography; Task 4 Application owns complete cross-aggregate profile/Knowledge/Evidence/marker replay, avoiding a second Place Frontier semantic verifier inside the store.

- [ ] **Step 6: Run the persistence and cascade gate**

~~~bash
./node_modules/.bin/vitest run \
  tests/integration/country-resolution-store.test.ts \
  tests/integration/database-schema.test.ts \
  tests/integration/place-frontier.test.ts \
  tests/integration/confirmed-life.test.ts \
  tests/branch/life-git.test.ts
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/eslint \
  src/application/country-resolution-contracts.ts \
  src/infrastructure/sqlite/country-resolution-store.ts \
  src/infrastructure/sqlite/place-frontier-store.ts \
  tests/integration/country-resolution-store.test.ts
~~~

Expected: all focused tests, typecheck and scoped lint pass.

- [ ] **Step 7: Commit**

~~~bash
git add src/application/country-resolution-contracts.ts \
  src/application/place-frontier.ts \
  src/infrastructure/sqlite/country-resolution-store.ts \
  src/infrastructure/sqlite/place-frontier-store.ts \
  src/infrastructure/sqlite/schema.sql src/infrastructure/sqlite/db.ts \
  tests/integration/country-resolution-store.test.ts \
  tests/integration/database-schema.test.ts tests/integration/place-frontier.test.ts \
  tests/integration/confirmed-life.test.ts tests/branch/life-git.test.ts
git commit -m "feat: persist country resolution revisions"
~~~

---

### Task 4: Orchestrate decisions and frozen replacements

**Requirements:** REQ-YR-01..04, REQ-YR-06; NFR-YR-01, NFR-YR-02, NFR-YR-04, NFR-YR-05; SCN-YR-01..07

**Files:**
- Create: `src/application/country-verifier.ts`
- Create: `src/application/country-resolution.ts`
- Create: `src/infrastructure/country-verifier-adapter.ts`
- Create: `src/infrastructure/country-resolution-composition.ts`
- Create: `tests/integration/country-resolution.test.ts`
- Modify: `src/application/place-frontier.ts`
- Modify: `src/infrastructure/place-frontier-composition.ts`
- Modify: `src/infrastructure/composition-root.ts`
- Modify: `src/infrastructure/sqlite/country-resolution-store.ts`
- Modify: `tests/integration/place-frontier.test.ts`

**Interfaces:**
- Consumes: Tasks 2–3, current cold-start composition, Place Frontier presentation and the existing Evidence/Country Knowledge pipeline.
- Produces:

~~~ts
export interface CountryVerificationProgress {
  readonly stage: "source_discovered" | "authority_verified" | "artifact_captured" |
    "claim_verified" | "dossier_published";
  readonly label: string;
  readonly detail?: string;
  readonly sourceUrl?: string;
}

export interface CountryVerificationResult {
  readonly countryCheckRunId: string;
  readonly sourceAssessmentRulesVersion: "cold-start-assessment@1";
  readonly verdict: FormalResidenceVerdict;
  readonly evidenceSnapshotId: string;
  readonly currentKnowledgeRevisionId?: string;
  readonly updatedKnowledgeRevisionId?: string;
  readonly knowledgeUpdatedAt?: string;
  readonly lastCheckedAt: string;
}

export interface CountryVerifierPort {
  check(input: {
    readonly country: RankablePlace;
    readonly profileId: string;
    readonly parentRunId: string;
    readonly emitProgress: (progress: CountryVerificationProgress) => void | Promise<void>;
    readonly signal: AbortSignal;
  }): Promise<CountryVerificationResult>;
  present(input: {
    readonly parentRunId: string;
    readonly countryCode: string;
    readonly countryCheckRunId: string;
    readonly profileId: string;
  }): Promise<Omit<CountryVerificationResult, "countryCheckRunId">>;
}

export interface CountryResolutionReadModel {
  readonly resolutionRunId: string;
  readonly assessmentAt: string;
  readonly automaticFrontier: PlaceFrontierReadModel;
  readonly revision: CountryResolutionRevision;
}

export interface CountryResolutionContinuationPrepared {
  readonly resolutionRunId: string;
  readonly expectedRevisionId: string;
  readonly automaticShortlistSnapshotId: string;
  readonly profileId: string;
  readonly contextHash: string;
}

export interface CountryResolutionApplication {
  startCountryResolution(input: {
    readonly automaticShortlistSnapshotId: string;
  }): Promise<CountryResolutionReadModel>;
  decideYellow(input: {
    readonly resolutionRunId: string;
    readonly expectedRevisionId: string;
    readonly countryCode: string;
    readonly decision: "accepted_at_own_risk" | "rejected";
    readonly warningCopyVersion: "yellow-risk@1";
    readonly commandId: string;
  }): Promise<CountryResolutionReadModel>;
  prepareCountryResolutionContinuation(input: {
    readonly resolutionRunId: string;
    readonly expectedRevisionId: string;
  }): Promise<CountryResolutionContinuationPrepared>;
  continueCountryResolution(
    prepared: CountryResolutionContinuationPrepared,
    emit: (event: CountryResolutionContinuationEvent) => void | Promise<void>,
    signal: AbortSignal,
  ): Promise<CountryResolutionReadModel>;
  presentCountryResolution(resolutionRunId: string): Promise<CountryResolutionReadModel>;
  requireResolvedCountryShortlistForCity(revisionId: string):
    Promise<ResolvedCountryShortlistSnapshot>;
}
~~~

The continuation event union is:

~~~ts
export interface ResolutionEvent<T extends string, P> {
  readonly resolutionRunId: string;
  readonly sequence: number;
  readonly occurredAt: string;
  readonly type: T;
  readonly payload: P;
}

export type CountryResolutionContinuationEvent =
  | ResolutionEvent<"replacement_country_activated", { country: FrontierCountry; rank: number }>
  | ResolutionEvent<"replacement_country_progress", {
      countryCode: string;
      stage: CountryVerificationProgress["stage"];
      label: string;
      detail?: string;
      sourceUrl?: string;
    }>
  | ResolutionEvent<"resolution_revision_committed", {
      marker: FrontierMarker;
      revision: CountryResolutionRevision;
    }>
  | ResolutionEvent<"resolution_continuation_completed", {
      readModel: CountryResolutionReadModel;
    }>;
~~~

Every envelope is `{resolutionRunId, sequence, occurredAt, type, payload}`. Committed marker events are emitted only after append succeeds.

- [ ] **Step 1: Characterize the existing verifier before extraction**

In `place-frontier.test.ts`, retain exact tests for deterministic child ID, all five progress stages, malformed verifier normalization, SI-only production composition and zero-network replay. Temporarily mutation-check one mapping (for example drop `artifact_captured.detail`) and observe the focused test fail, then restore it before refactoring.

- [ ] **Step 2: Extract the shared inward verifier seam**

Move `FrontierCountry`, `FrontierMarker`, normalized progress/result/port and strict marker materialization/replay expectation into `country-verifier.ts`. Export:

~~~ts
export function countryCheckRunId(
  parentRunId: string,
  countryCode: string,
  integrity: ResolutionIntegrity,
): string;

export function materializeFrontierMarker(input: {
  readonly place: RankedPlace;
  readonly checked: CountryVerificationResult;
  readonly parentRunId: string;
  readonly profileId: string;
  readonly integrity: ResolutionIntegrity;
}): FrontierMarker;
~~~

Create `createCountryVerifierAdapter(options): CountryVerifierPort` from the current `place-frontier-composition.ts` logic. Both compositions must use it. This removes the current Application runtime import of `infrastructure/integrity` without changing Place Frontier behavior.

- [ ] **Step 3: Run the extraction gate**

~~~bash
./node_modules/.bin/vitest run tests/integration/place-frontier.test.ts
./node_modules/.bin/tsc --noEmit
~~~

Expected: all existing Place Frontier tests pass unchanged.

- [ ] **Step 4: Write Application RED tests for start and decision**

Cover:

- all-green automatic snapshot -> deterministic immediate resolved root and verifier check count 0;
- initial yellows -> working root, lowest frozen-rank prompt, no replacement while five provisional slots exist;
- accept -> ordinary effective green and next prompt/terminal;
- reject -> committed `replacement_required` and persistent effective red;
- wrong source snapshot, warning version, country, head or client-supplied uncertainty rejected before append;
- same command/payload returns the same revision; same command/different payload fails;
- City handoff guard accepts a verified non-empty resolved revision ID and rejects automatic, working, tampered and empty IDs;
- named case `presents the same resolved chain twice without network`: two calls are canonical-equal with a throwing/counted `requestStep`, zero `verifier.check` and zero official requests.

Run and expect missing module/API failures:

~~~bash
./node_modules/.bin/vitest run tests/integration/country-resolution.test.ts
~~~

- [ ] **Step 5: Implement start, decision and replay graph verification**

Use the shared Task 3 helpers; the default formula is:

~~~ts
const resolutionRunId = `country-resolution:${integrity.hash(integrity.canonical({
  automaticShortlistSnapshotId,
  rulesVersion: "country-resolution@1",
}))}`;
~~~

Start idempotently finds the deterministic root for that run or appends it; do not add a unique-by-source constraint because a future explicit restart may reuse the same automatic snapshot under another run ID. Its operation ID is `country-resolution:start:<sha256(sourceShortlistId)>`. Decision derives uncertainty and `decidedAt` server-side, hashes the entire bound marker, builds one successor which may itself be resolved, and appends before returning. Decision operation identity is the exact client semantic tuple `{commandId, kind, expectedHeadRevisionId, countryCode, decision, warningCopyVersion}`; server-generated `decidedAt`, revision ID and context hash are not inputs to command equality.

Presentation locates the cryptographically verified chain, calls `presentPlaceFrontierByShortlistId`, replays every located replacement marker with `verifier.present`, derives `CountryResolutionSemanticContext` from the verified source plus exact replayed projections, then reloads/verifies the complete chain under that context. It verifies deterministic run ID, every transition, frozen source IDs and policy projection. It may not call `freezeCurrent`, ranker, `latest Knowledge` or `verifier.check`. `requireResolvedCountryShortlistForCity(revisionId)` uses this same verified load path, then requires `kind === "resolved"` and non-empty `resolvedEntries`; automatic IDs, working, tampered and empty revisions yield `resolved_country_shortlist_required`.

- [ ] **Step 6: Write continuation RED tests**

Cover reject -> formal red -> formal red -> green; reject -> replacement yellow -> global lowest-rank prompt; repeated replacements -> exhaustion 0–4 and empty; Knowledge update without rerank; child parent equals resolution run; abort/verifier/storage failure without false terminal; committed Evidence child recovery; revision event after commit; transport failure after commit followed by exact reload.

- [ ] **Step 7: Implement bounded continuation**

Prepare reloads exact `replacement_required` head. Continue takes only `ranking.ordered[nextUncheckedRank - 1]`, calls `verifier.present` first for the deterministic child and calls `check` only on `evidence_not_found`, materializes the strict marker, appends its successor with `commandId = countryCheckRunId`, then emits `resolution_revision_committed`. Each consecutive formal-red replacement therefore has its own deterministic operation and predecessor even when one Continue stream appends several revisions. Green/yellow fills the slot and stops; exhaustion returns the policy-derived working/resolved head. Abort before resolution append never fabricates a revision; an already published Evidence/Knowledge child may be recovered on the next explicit continuation.

- [ ] **Step 8: Wire composition and run the Application gate**

Create `country-resolution-composition.ts` with the same database/HMAC/profile/Knowledge/frontier/verifier dependencies. Expose the five methods from `composition-root.ts`.

Run:

~~~bash
./node_modules/.bin/vitest run \
  tests/domain/country-resolution-policy.test.ts \
  tests/integration/country-resolution-store.test.ts \
  tests/integration/country-resolution.test.ts \
  tests/integration/place-frontier.test.ts
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/eslint \
  src/application/country-verifier.ts src/application/country-resolution.ts \
  src/infrastructure/country-verifier-adapter.ts \
  src/infrastructure/country-resolution-composition.ts
~~~

Expected: focused behavior, typecheck and lint pass.

- [ ] **Step 9: Commit**

~~~bash
git add src/application/country-verifier.ts src/application/country-resolution.ts \
  src/application/place-frontier.ts \
  src/infrastructure/country-verifier-adapter.ts \
  src/infrastructure/country-resolution-composition.ts \
  src/infrastructure/place-frontier-composition.ts \
  src/infrastructure/composition-root.ts \
  src/infrastructure/sqlite/country-resolution-store.ts \
  tests/integration/country-resolution.test.ts tests/integration/place-frontier.test.ts
git commit -m "feat: resolve yellow country choices"
~~~

---

### Task 5: Add strict commands, continuation stream and pure projection

**Requirements:** REQ-YR-02, REQ-YR-03, REQ-YR-05, REQ-YR-06; NFR-YR-03, NFR-YR-04, NFR-YR-06; SCN-YR-02..07

**Files:**
- Create: `src/app/api/country-resolution/start/route.ts`
- Create: `src/app/api/country-resolution/decision/route.ts`
- Create: `src/app/api/country-resolution/continue/route.ts`
- Create: `src/experience/country-resolution-stream.ts`
- Create: `src/experience/country-resolution-view-model.ts`
- Create: `tests/integration/country-resolution-transport.test.ts`
- Modify: `src/experience/finite-ndjson.ts`
- Modify: `src/experience/place-frontier-stream.ts`
- Modify: `src/experience/place-frontier-view-model.ts`
- Modify: `tests/integration/place-frontier-transport.test.ts`
- Modify: `tests/integration/place-frontier-experience.test.tsx`
- Modify: `tests/fixtures/place-frontier-client/entry.ts`

**Interfaces:**
- Consumes: Task 4 application/read model/events and existing `readFiniteNdjson`.
- Produces three strict routes, one continuation decoder/reducer and one pure view projection.

~~~ts
export interface CountryResolutionCandidateView {
  readonly country: FrontierCountry;
  readonly rank: number;
  readonly status: "pending" | "green" | "yellow" | "red";
  readonly statusLabel: "Доступно для выбора" | "Требует решения" | "Исключено";
  readonly summary?: string;
  readonly officialUrls: readonly string[];
  readonly manualCheckLinks: readonly { readonly label: string; readonly url: string }[];
}

export interface CountryResolutionView {
  readonly candidates: readonly CountryResolutionCandidateView[];
  readonly currentPrompt?: {
    readonly countryCode: string;
    readonly uncertainty: YellowUncertaintyBasis;
    readonly warningCopyVersion: "yellow-risk@1";
  };
  readonly canContinue: boolean;
  readonly cards: readonly PlaceFrontierCountryCard[];
  readonly globeMode: "full" | "collapsed";
  readonly transportError?: string;
}
~~~

Start request:

~~~ts
{ readonly automaticShortlistSnapshotId: string }
~~~

Decision request:

~~~ts
{
  readonly resolutionRunId: string;
  readonly expectedRevisionId: string;
  readonly countryCode: string;
  readonly decision: "accepted_at_own_risk" | "rejected";
  readonly warningCopyVersion: "yellow-risk@1";
  readonly commandId: string;
}
~~~

Continue request:

~~~ts
{ readonly resolutionRunId: string; readonly expectedRevisionId: string }
~~~

JSON responses for start/decision are exact `CountryResolutionReadModel`. Continue is `application/x-ndjson; charset=utf-8` with exact `x-life-resolution-run-id` and `x-life-expected-revision-id` headers.

Projection API:

~~~ts
export type CountryResolutionScreenState =
  | { readonly kind: "stable"; readonly readModel: CountryResolutionReadModel }
  | { readonly kind: "continuing"; readonly readModel: CountryResolutionReadModel; readonly stream: CountryResolutionEventState }
  | { readonly kind: "transportError"; readonly readModel: CountryResolutionReadModel; readonly stream: CountryResolutionEventState; readonly message: string };

export interface CountryResolutionEventState {
  readonly resolutionRunId: string;
  readonly expectedRevisionId: string;
  readonly lastSequence: number;
  readonly activeReplacement?: { readonly country: FrontierCountry; readonly rank: number };
  readonly committedRevisionIds: readonly string[];
  readonly progress: readonly CountryVerificationProgress[];
  readonly terminal?: CountryResolutionReadModel;
}

export function presentCountryResolutionReadModel(
  readModel: CountryResolutionReadModel,
): CountryResolutionScreenState;
export function beginCountryResolutionContinuation(
  readModel: CountryResolutionReadModel,
): CountryResolutionScreenState;
export function reduceCountryResolutionContinuationEvent(
  state: CountryResolutionScreenState,
  event: CountryResolutionContinuationEvent,
): CountryResolutionScreenState;
export function failCountryResolutionContinuation(
  state: CountryResolutionScreenState,
  message: string,
): CountryResolutionScreenState;
export function projectCountryResolutionView(
  state: CountryResolutionScreenState,
): CountryResolutionView;
~~~

- [ ] **Step 1: Write route RED tests**

Test exact media type, malformed JSON, strict unknown/mixed fields, expected 400/404/409 mappings, generic no-message 500, zero application calls on invalid input, and no official verifier call in start/decision. For continue, assert prepare completes before stream creation, nonblocking pump, exact headers, request abort/body cancel same reason, terminal-return equality and no fabricated terminal.

Run:

~~~bash
./node_modules/.bin/vitest run tests/integration/country-resolution-transport.test.ts
~~~

Expected: import/module failures for the new routes and decoder.

- [ ] **Step 2: Implement strict JSON routes and continuation adapter**

Normalize missing source, run or revision inside Application to `resolution_not_found`. All three routes and `page.tsx` use one mapping: `resolution_not_found` -> 404/recoverable unavailable; `stale_resolution_head` and `invalid_resolution_target` -> 409; malformed input -> 400; integrity/provider/unexpected errors -> generic 500. Never return internal error messages or accept uncertainty/timestamps from the client.

Continue validates prepared identifiers/header safety before creating its stream. It links Request.signal and body cancellation to one controller, emits one JSON line per strict Application event, requires exactly one terminal and canonical equality with the returned read model, then closes.

- [ ] **Step 3: Write finite protocol RED tests**

Cover strict nested schemas; first sequence 1; fixed run; activation only at the persisted cursor; matching progress/completion; committed revision monotonicity; no optimistic status; immediate exhaustion; one terminal last; terminal held until clean EOF; trailing bytes/error/cancel suppress terminal; line-size/fatal UTF-8/early-return/abort compatibility inherited from `readFiniteNdjson`.

- [ ] **Step 4: Implement the decoder without duplicating workflow code**

Use the closed event union from Task 4. Export or extract only browser-safe strict Place Frontier read-model/marker normalization needed to validate the nested automatic frontier; do not copy ranking formulas or import Application/Infrastructure at runtime. Reuse the existing finite reader and move the generic one-shot `FiniteStreamHandoff`/cancel-without-masking from `place-frontier-stream.ts` only if both journeys need it.

- [ ] **Step 5: Write pure projection RED tests**

Assert:

- source markers plus replacements remain in frozen rank order;
- accepted yellow produces the exact same green candidate/card shape as formal green, with no badge/warning/reason;
- rejected yellow produces the same red status/control behavior as formal red, but detail says the user declined unresolved risk;
- current unresolved prompt alone carries exact unknown facts and official/manual links;
- working `replacement_required` exposes Continue and no terminal cards;
- continuation progress uses only received events;
- transport error retains committed colors/history and has no terminal cards;
- resolved 1–5 entries show only effective green cards; empty resolved has no City CTA;
- stored presentation has no synthetic timeline/flight and performs no network.

- [ ] **Step 6: Implement and browser-bundle the pure projection**

Task 5 emits the exact effective candidate DTO above, independent of React/globe. Task 6 only threads `statusLabel` into shared map contracts. Add both resolution Experience modules to `tests/fixtures/place-frontier-client/entry.ts` so real web-target bundling rejects any runtime Application/Infrastructure/`node:` dependency.

- [ ] **Step 7: Run the transport/projection gate**

~~~bash
./node_modules/.bin/vitest run \
  tests/integration/country-resolution-transport.test.ts \
  tests/integration/place-frontier-transport.test.ts \
  tests/integration/place-frontier-experience.test.tsx
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/eslint \
  src/app/api/country-resolution \
  src/experience/country-resolution-stream.ts \
  src/experience/country-resolution-view-model.ts
~~~

Expected: focused tests, TypeScript and lint pass; web-target smoke has no Node runtime edge.

- [ ] **Step 8: Commit**

~~~bash
git add src/app/api/country-resolution src/experience/finite-ndjson.ts \
  src/experience/place-frontier-stream.ts src/experience/place-frontier-view-model.ts \
  src/experience/country-resolution-stream.ts \
  src/experience/country-resolution-view-model.ts \
  tests/integration/country-resolution-transport.test.ts \
  tests/integration/place-frontier-transport.test.ts \
  tests/integration/place-frontier-experience.test.tsx \
  tests/fixtures/place-frontier-client/entry.ts
git commit -m "feat: stream country resolution"
~~~

---

### Task 6: Resolve yellow on the same planet

**Requirements:** REQ-YR-02..05; NFR-YR-04, NFR-YR-06; SCN-YR-01..06

**Files:**
- Create: `src/experience/components/CountryResolutionPanel.tsx`
- Create: `tests/integration/country-resolution-experience.test.tsx`
- Modify: `src/experience/components/PlaceFrontierJourney.tsx`
- Modify: `src/experience/components/ResearchWorkspace.tsx`
- Modify: `src/experience/research-map/contracts.ts`
- Modify: `src/experience/research-map/product-route.ts`
- Modify: `src/experience/research-map/ResearchGlobeCanvas.tsx`
- Modify: `src/experience/run-url.ts`
- Modify: `src/app/page.tsx`
- Modify: `src/app/globals.css`
- Modify: `tests/integration/place-frontier-experience.test.tsx`
- Modify: `tests/integration/research-globe-canvas.test.tsx`
- Modify: `tests/integration/product-shell.test.tsx`
- Modify: `tests/integration/visual-system.test.ts`

**Interfaces:**
- Consumes: Task 5 screen/view projection and strict response openers.
- Produces: one same-shell automatic -> resolution -> resolved experience and reload route `?flow=country-resolution&run=<resolutionRunId>`.

`PlaceFrontierJourney` receives a closed mode union rather than optional resolution props:

~~~ts
export interface PlaceFrontierLiveInput {
  readonly runId: string;
  readonly profileId: string;
  readonly preferenceProfileId: string;
  readonly stream: ReadableStream<Uint8Array>;
}

type PlaceFrontierJourneyMode =
  | { readonly kind: "automatic-live"; readonly automatic: PlaceFrontierLiveInput }
  | { readonly kind: "automatic-stored"; readonly readModel: PlaceFrontierReadModel }
  | { readonly kind: "resolution-stored"; readonly readModel: CountryResolutionReadModel };
~~~

Only the Journey owns transitions between these modes and the one finite-stream handoff; the page server supplies one initial mode.

Add to presentation contracts:

~~~ts
interface ResearchCandidate {
  readonly id: string;
  readonly label: string;
  readonly status: "pending" | "green" | "yellow" | "red";
  readonly statusLabel?: string;
}

interface GlobeRoute {
  readonly key: string;
  readonly label: string;
  readonly status: "pending" | "green" | "yellow" | "red";
  readonly statusLabel?: string;
}
~~~

`createProductGlobeRoute` forwards it. Research Workspace and globe detail use it when present; existing single-candidate and automatic frontier labels remain unchanged.

- [ ] **Step 1: Write the same-globe and decision RED journey tests**

Assert clean automatic terminal invokes strict Start once, replaces URL, and keeps the exact `.workspace-globe` DOM node. Stored old Place Frontier links idempotently start/transition; `flow=country-resolution&run=...` server-presents resolution by run only. All-green moves straight to resolved without prompt.

For unresolved yellow assert prompt heading focus, exact unknown reason codes/links/risk copy, only two buttons, both disabled during request, and request body has no reasons/timestamp. Freeze versioned copy `yellow-risk@1` as: `Официальных данных недостаточно, чтобы подтвердить возможность долгосрочного проживания. Принимая страну, вы берёте риск самостоятельной проверки на себя.` A catalog-only uncertainty must render `Полнота официального каталога маршрутов не подтверждена.` even when no unknown route exists. No marker color changes before success.

- [ ] **Step 2: Add the resolution panel and same-shell handoff**

`PlaceFrontierJourney` remains the sole `ProductShell` and globe owner. It starts resolution only after a clean verified automatic terminal. `CountryResolutionPanel` renders the already-projected prompt, Continue/reload/error states and terminal cards; it owns no status/queue/cursor policy.

On decision success:

- accepted closes any yellow detail and shows ordinary noninteractive green immediately;
- rejected shows ordinary interactive red immediately, then live mode attempts Continue;
- ambiguous decision transport retries the same `commandId` and exact payload;
- stored/reloaded `replacement_required` never auto-calls official sources and shows explicit Continue.

- [ ] **Step 3: Write effective marker RED tests**

Use four source/replacement origins and assert:

- formal green and accepted yellow have the same green label `Доступно для выбора`, are noninteractive and expose no accepted-risk badge/reason;
- formal red and rejected yellow have red label `Исключено`, are keyboard-operable buttons and persist after replacement/reload;
- rejected detail truthfully says formal facts remained incomplete and the user declined risk;
- unresolved yellow alone retains decision interaction;
- route keys and overview key do not change on color changes; replacements append one route;
- Escape/close focus restoration, selected yellow -> accepted green closure, reduced motion and existing marker clone behavior remain green.

- [ ] **Step 4: Implement statusLabel and globe/workspace presentation only**

Do not alter camera, flight, material, lighting, clone/focus or reduced-motion algorithms. Use the projected effective status; never inspect `YellowDecision` inside canvas/workspace. Keep rejected/accepted origin internal to truthful detail data only.

- [ ] **Step 5: Write continuation lifecycle and terminal RED tests**

Cover URL-before-stream-adoption, StrictMode one-shot reuse, true-unmount cancellation once, supersede/stale-generation protection, committed marker followed by transport failure and reload, explicit Continue recovery, global next prompt focus, factual progress live region, terminal collapse with same globe, 1–5 cards, empty terminal without City CTA, and no synthetic timeline on reload.

- [ ] **Step 6: Implement lifecycle, page routing and narrow CSS**

Add `replaceCountryResolutionRunUrl`. Page handles `flow=country-resolution` before legacy flows and maps normalized `resolution_not_found` to recoverable unavailable output; integrity/unexpected failures show no domain output. Reuse the proven finite-stream handoff/generation pattern; retain the accepted response body from strict open through effect adoption so immediate URL/unmount cancels the server once.

CSS may add only bounded resolution panel/cards/controls rules and collapsed pointer-event whitelist entries. Existing ProductShell/globe layout and breakpoints remain.

- [ ] **Step 7: Run the Experience regression gate**

~~~bash
./node_modules/.bin/vitest run \
  tests/integration/country-resolution-experience.test.tsx \
  tests/integration/place-frontier-experience.test.tsx \
  tests/integration/research-globe-canvas.test.tsx \
  tests/integration/product-shell.test.tsx \
  tests/integration/visual-system.test.ts
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/eslint \
  src/experience/components/CountryResolutionPanel.tsx \
  src/experience/components/PlaceFrontierJourney.tsx \
  src/experience/research-map src/app/page.tsx
~~~

Expected: all focused experience/a11y/lifecycle tests pass; typecheck and lint exit 0.

- [ ] **Step 8: Commit**

~~~bash
git add src/experience/components/CountryResolutionPanel.tsx \
  src/experience/components/PlaceFrontierJourney.tsx \
  src/experience/components/ResearchWorkspace.tsx \
  src/experience/research-map/contracts.ts \
  src/experience/research-map/product-route.ts \
  src/experience/research-map/ResearchGlobeCanvas.tsx \
  src/experience/run-url.ts src/app/page.tsx src/app/globals.css \
  tests/integration/country-resolution-experience.test.tsx \
  tests/integration/place-frontier-experience.test.tsx \
  tests/integration/research-globe-canvas.test.tsx \
  tests/integration/product-shell.test.tsx tests/integration/visual-system.test.ts
git commit -m "feat: resolve countries on globe"
~~~

---

### Task 7: Prove replay, provider-free scope and the City handoff gate

**Requirements:** REQ-YR-01..06; NFR-YR-01..06; SCN-YR-01..07

**Files:**
- Create after verification: `docs/changes/active/vs-3r-yellow-resolution/implementation-evidence.md`
- Modify only after explicit evidence approval: `docs/changes/active/vs-3r-yellow-resolution/change.md`
- Modify only after explicit evidence approval: `docs/README.md`

**Interfaces:**
- Consumes: completed Tasks 1–6.
- Produces: reproducible implementation evidence and an approval stop. It does not merge, land or create City code.

- [ ] **Step 1: Run all deterministic gates sequentially**

~~~bash
./node_modules/.bin/vitest run
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/eslint .
./node_modules/.bin/next build
git diff --check
~~~

Expected: every command exits 0. Do not run full Vitest and Next build concurrently.

- [ ] **Step 2: Run the zero-provider audit**

~~~bash
rg -n -i \
  'openai|responses[.]parse|OPENAI_API_KEY|anthropic|gemini|llmCalls|modelCalls' \
  src tests evals package.json pnpm-lock.yaml .env.example
~~~

Expected: exit 1 and no runtime/config matches.

- [ ] **Step 3: Prove deterministic zero-network resolution replay**

Task 4 must leave a named integration case `presents the same resolved chain twice without network`. Re-run it directly:

~~~bash
./node_modules/.bin/vitest run tests/integration/country-resolution.test.ts \
  -t "presents the same resolved chain twice without network"
~~~

The case uses a fresh isolated SQLite fixture with a terminal automatic snapshot, at least one accepted yellow, one rejected yellow and one replacement marker. It builds composition with `requestStep` throwing `network_forbidden` and a counter, calls `presentCountryResolution(resolutionRunId)` twice and canonical-compares:

- automatic ranking and shortlist IDs;
- source and replacement markers, formal verdicts and effective projections;
- all decisions, uncertainty bases and warning versions;
- predecessor chain, cursor, resolved entries and stop condition;
- Evidence and ranking/current/updated Knowledge IDs.

Assert `requestStepCalls === 0`, `verifier.check` is never invoked, the two read models are canonical-equal, and no row count/hash changes during presentation.

- [ ] **Step 4: Re-run the future City input guard without implementing City**

Re-run the Application-level guard test introduced in Task 4 for:

~~~ts
export function requireResolvedCountryShortlistForCity(
  revisionId: string,
): Promise<ResolvedCountryShortlistSnapshot>;
~~~

Run:

~~~bash
./node_modules/.bin/vitest run tests/integration/country-resolution.test.ts \
  -t "requires a verified non-empty resolved shortlist for City"
~~~

It loads by ID through verified presentation, accepts only a resolved revision with `resolvedEntries.length > 0`, and rejects an automatic shortlist ID, working revision, tampered revision and empty resolved revision with `resolved_country_shortlist_required`. Do not create City Registry, city tables or city ranking.

- [ ] **Step 5: Optionally run one live browser walkthrough only after fresh permission**

Ask the user immediately before using any browser. If approved, use a new temporary DB and process-only synthetic HMAC, never the existing DB. Run the installed SI path, observe the actual automatic terminal, then:

- if SI is yellow, accept and verify ordinary green terminal/exhaustion behavior;
- if SI is green, verify immediate resolved root;
- do not fabricate a rejected/replacement production country; synthetic tests are the only proof until another real package is installed;
- reload the exact resolution URL and verify same marker/card, no live timeline and no official capture.

Stop honestly if official-source or environment drift prevents the flow. Record only observed stages.

- [ ] **Step 6: Write evidence and stop for approval**

Write exact HEAD SHA/time, commands/counts, replay IDs/results, provider audit, DB integrity/immutability observations, browser permission/outcome if any, SI-only limitation and cleanup state. Leave the evidence uncommitted and do not change status yet. Ask the user to approve the evidence.

- [ ] **Step 7: Publish documentation only after explicit approval**

After approval, set change status to `implemented — verified <date>`, link evidence in `docs/README.md`, then:

~~~bash
git add docs/changes/active/vs-3r-yellow-resolution/change.md \
  docs/changes/active/vs-3r-yellow-resolution/implementation-evidence.md \
  docs/README.md
git commit -m "docs: verify VS3R yellow resolution"
git push origin feat/vs1-confirmed-life
~~~

Never merge, land or push to trunk. Report the pushed branch and leave CI, review and merge to the user.

---

## Plan self-review checklist

- `REQ-YR-01`: Tasks 1, 3, 4 and 7 verify source binding and preserve automatic snapshots.
- `REQ-YR-02`: Tasks 2, 4, 5 and 6 own exact yellow decisions and post-commit effective colors.
- `REQ-YR-03`: Tasks 2, 4 and 5 own frozen cursor, bounded continuation and actual progress.
- `REQ-YR-04`: Tasks 2–4 own terminal policy, 0–5 outcome and exact resolved entries.
- `REQ-YR-05`: Tasks 5–6 retain the same planet/history and accessibility semantics.
- `REQ-YR-06`: Tasks 3–5 and 7 own chain integrity, idempotency, concurrency and zero-network replay.
- `NFR-YR-01..06`: each is covered by Global Constraints; Tasks 3, 5, 6 and 7 contain executable gates.
- No task changes formal verdict, reranks, reads current ranking inputs during continuation, adds City implementation, adds a second pipeline, or persists stream events.
- All cross-task names are stable: `slotCountryCodes`, `resolvedEntries`, `CountryResolutionRevision`, `CountryResolutionReadModel`, `CountryResolutionContinuationEvent`, `resolutionRunId`, `expectedRevisionId`.
