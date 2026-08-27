# VS-4A City Frontier Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist a frozen city ranking, advance an append-only one-city-at-a-time frontier to three selectable cities, queue exhaustion or an exact ten-city live limit, and atomically record a terminal city selection as a sibling branch.

**Architecture:** Decision reconstructs frontier and selection state from immutable projections. Application owns Start/Continue/Present/Select and commit ordering behind inward-defined ports. SQLite persists one ranking snapshot, one append-only frontier revision chain and atomic selection/branch records. Research/source calls remain outside transactions and occur only in Continue.

**Tech Stack:** TypeScript, Decimal.js policies from Foundations, better-sqlite3 immediate transactions, canonical JSON/SHA-256/HMAC, existing verified Country Resolution and City Evidence/Knowledge ports, Vitest.

**Depends on:** completed [`Foundations`](2026-08-13-vs-4a-city-frontier-foundations.md) and [`Evidence and Knowledge`](2026-08-13-vs-4a-city-frontier-knowledge.md).

**Required safety amendment:** [`VS-4A Safety Source Discovery`](2026-08-14-vs-4a-safety-source-discovery.md). Marker, Continue, replay and selection behavior below use its yellow-selectable and accepted/reviewed-link semantics.

**Approved Task 11 architectural amendment (2026-08-24):** Application supplies only verified plain
Knowledge/Evidence authority; Decision derives marker semantics from frozen Ranking assessment plus
Criteria/evaluators, and Task 12 owns the marker digest formula before frontier binding.

**Approved Task 12 architectural amendment (2026-08-24):** Task 12 owns descriptor-safe,
content-addressed sealing/reconstruction of Ranking, Frontier, Selection and Branch values. Branch
remains independent from Application, while one Application wrapper is the only normal constructor of
the durable Selection plus sibling City Branch pair from verified terminal/ranking/pre-city authority.

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
export type CityMarkerDisposition = "selectable" | "excluded";
export type CityCommittedMarkerVisualStatus = "green" | "yellow" | "red";
export type CityCandidateViewStatus = "pending" | CityCommittedMarkerVisualStatus;
export type CityFrontierStopCondition =
  | "three_selectable"
  | "catalog_exhausted"
  | "live_candidate_limit_reached";

export interface CityFrontierVerificationBudget {
  readonly liveCityCandidateLimit: 10;
  readonly targetSelectableCities: 3;
  readonly rulesVersion: "city-frontier-budget@1";
}

// Decision owns this closed union. Application maps the structurally identical verified Research
// rejection at its anti-corruption boundary; Task 11 never imports Research.
export type CityFactLinkRejectionReason =
  | "http_not_found"
  | "transport_unavailable"
  | "authority_untrusted"
  | "stale"
  | "scope_mismatch"
  | "definition_mismatch"
  | "missing_numerator"
  | "denominator_missing"
  | "denominator_zero"
  | "denominator_period_mismatch"
  | "denominator_scope_mismatch"
  | "wrong_media_type"
  | "too_large"
  | "untrusted_redirect"
  | "retention_unapproved"
  | "conflict";

export interface CityLiveMarker {
  readonly cityId: string;
  readonly rank: number;
  readonly status: CityMarkerDisposition;
  readonly visualStatus: CityCommittedMarkerVisualStatus;
  readonly knowledgeRevisionId: string;
  readonly evidenceSnapshotId: string;
  readonly lastCheckedAt: string;
  readonly requiredMismatches: readonly CityRequiredMismatch[];
  readonly unknownBasis: readonly CityUnknownWarning[];
  readonly verificationCoverage: string;
  readonly facts: CityCommittedFactProjectionTuple;
}

export type CityFactLinkProjection =
  | {
      readonly sourceId: string;
      readonly disposition: "accepted";
      readonly navigationUrl: string;
      readonly resolvedEvidenceUrl: string;
      // Contextually required when the enclosing fact criterionId is "safety".
      readonly referenceYear?: number;
    }
  | {
      readonly sourceId: string;
      readonly disposition: "reviewed_rejected";
      readonly navigationUrl: string;
      readonly resolvedEvidenceUrl?: string;
      readonly referenceYear?: number;
      // Required for safety facts and forbidden for every non-safety fact.
      readonly rejectionReason?: CityFactLinkRejectionReason;
    };

export type CityAcceptedFactLinkProjection = Extract<
  CityFactLinkProjection,
  { readonly disposition: "accepted" }
>;
export type CityReviewedFactLinkProjection = Extract<
  CityFactLinkProjection,
  { readonly disposition: "reviewed_rejected" }
>;

export interface CityUnknownWarning {
  readonly criterionId: CityCriterionId;
  readonly definitionId: string;
  readonly reason: CityUnknownReason;
}

export interface CityCommittedFactProjection extends Omit<CityRankingFactInput, "outcome"> {
  readonly outcome:
    | { readonly kind: "verified"; readonly basis: CityVerifiedFactBasis }
    | { readonly kind: "unknown"; readonly reason: CityUnknownReason };
  readonly evidenceLinks: readonly CityAcceptedFactLinkProjection[];
  readonly manualCheckLinks: readonly CityReviewedFactLinkProjection[];
}
export type CityCommittedFactProjectionTuple = readonly [CityCommittedFactProjection, CityCommittedFactProjection, CityCommittedFactProjection, CityCommittedFactProjection];

export interface CityMarkerAuthorityProjection {
  readonly cityId: string;
  readonly knowledgeRevisionId: string;
  readonly evidenceSnapshotId: string;
  readonly lastCheckedAt: string;
  readonly facts: CityCommittedFactProjectionTuple;
}

export interface CityMarkerBinding {
  readonly marker: CityLiveMarker;
  readonly markerDigest: string;
  readonly authority: CityMarkerAuthorityProjection;
}

export interface CityFrontierRankingProjection {
  readonly assessmentAt: string;
  readonly orderedCityIds: readonly string[];
  readonly screenedExclusionCityIds: readonly string[];
}

export interface ReconstructCityLiveMarkerInput {
  readonly assessmentAt: string;
  readonly criteria: CityCriteriaSnapshot;
  readonly evaluators: CityCriterionEvaluatorRegistry;
  readonly rank: number;
  readonly authority: CityMarkerAuthorityProjection;
  readonly persisted?: CityLiveMarker;
}

export interface CityTerminalEntry {
  readonly cityId: string;
  readonly rank: number;
  readonly markerDigest: string;
  readonly knowledgeRevisionId: string;
  readonly evidenceSnapshotId: string;
  readonly unknownBasis: readonly CityUnknownWarning[];
}

export type CityFrontierProjection =
  | {
      readonly kind: "working";
      readonly nextUncheckedRank: number;
      readonly selectableCityIds: readonly string[];
      readonly phase: "verification_required";
    }
  | {
      readonly kind: "terminal";
      readonly nextUncheckedRank: number;
      readonly selectableCityIds: readonly string[];
      readonly entries: readonly CityTerminalEntry[];
      readonly stopCondition: CityFrontierStopCondition;
    };

export interface ReconstructCityFrontierInput {
  readonly ranking: CityFrontierRankingProjection;
  readonly criteria: CityCriteriaSnapshot;
  readonly evaluators: CityCriterionEvaluatorRegistry;
  readonly predecessorMarkers: null | readonly CityLiveMarker[];
  readonly markerBindings: readonly CityMarkerBinding[];
  readonly persisted?: CityFrontierProjection;
}

export interface CitySelectionRequestProjection {
  readonly cityId: string;
  readonly warningCopyVersion?: "city-unknown-risk@1";
}

export interface ReconstructCitySelectionInput {
  readonly frontier: ReconstructCityFrontierInput;
  readonly request: CitySelectionRequestProjection;
}

export interface CitySelectionProjection {
  readonly entry: CityTerminalEntry;
  readonly reviewedSourceLinks: readonly CityReviewedFactLinkProjection[];
  readonly warningCopyVersion?: "city-unknown-risk@1";
}

export function reconstructCityLiveMarker(input: ReconstructCityLiveMarkerInput): CityLiveMarker;
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

Close `ReconstructCityFrontierInput` exactly over the narrow frozen Ranking projection, Criteria,
evaluators, predecessor, marker bindings and optional persisted projection. Require canonical
`assessmentAt`, unique/disjoint ordered and screened city IDs, exact four-fact criterion order and
`assessmentAt <= authority.lastCheckedAt`. Application-built authority is plain own data containing
only city/Knowledge/Evidence/time plus the raw four facts and links. Re-run every evaluator at the
frozen Ranking assessment, derive effective facts, required mismatches, weighted coverage, warnings,
status and visual status, and reject any claimed marker drift. Prove screened IDs never activate.
Compile/runtime-pin `ReconstructCityLiveMarkerInput` to exactly
`assessmentAt/criteria/evaluators/rank/authority/persisted?`: omission derives a fresh marker and a
present marker is exact-verified. Frontier must rerun this function for every binding; it cannot trust
the claimed marker merely because its digest has valid syntax.

`predecessorMarkers: null` is valid only for the zero-marker root. A successor supplies the exact
current prefix minus one marker, whose policy reconstructs as working, then adds exactly the next
frozen-rank city. Reject changed/reordered history, zero/two additions and successor-after-terminal.
Omitting `persisted` derives the projection; supplying it verifies exact canonical equality. Require a
raw lowercase 64-hex `markerDigest`, but prove Task 11 calls no hash/sign/crypto capability and makes no
claim that a simultaneously forged marker+digest is authentic. Tasks 12–14 own that verification.
Require the derived projection to be the closed `kind: "working" | "terminal"` union with no optional
phase/terminal overlap. Accepted links require a resolved URL and forbid a rejection reason. Pin one
compact source-class table against the enclosing fact: a safety accepted link requires
`referenceYear` equal to the numeric verified fact `referencePeriod`; a safety reviewed link requires
the Decision-owned rejection reason; every non-safety reviewed link forbids that key because current
fixed Evidence has no such authority. Other reviewed resolved URL/year fields remain optional.
Require `evidenceLinks` to contain accepted links only and `manualCheckLinks` plus selection
`reviewedSourceLinks` to contain reviewed-rejected links only; preserve their exact occurrence order
and duplicates at runtime as well as in the exported `Extract` aliases.

Use descriptor-hostile REDs for roots and representative nested branches: accessor, Proxy, symbol,
custom prototype, sparse/cyclic array or object, extra/missing/own-undefined key and aliased mutable
inputs. All fail closed as `integrity_mismatch` before evaluator execution where structurally invalid;
successful outputs are fresh recursively frozen copies and preserve duplicate link occurrences.
In one valid hostile-evaluator RED, the first `canonicalizeTarget` or `evaluate` callback triggers one
shared attack that mutates every borrowed Ranking/Criteria/authority/predecessor/persisted graph and
swaps all entries/methods in the borrowed evaluator registry; each
`evaluate` callback also retains its structured argument and delegates normally. Require the clean oracle
result, observable attack mutations on still-unfrozen caller objects, private frozen evaluation
arguments, exact original four-capability call counts, and a result unaffected by either retained-argument or later caller mutation. This pins complete ownership before the
first behavior callback without expanding into a callback matrix.
Assert each retained evaluator argument has exactly the three
`criterion/fact/assessmentAt` own data keys of `CityCriterionEvaluationInput`; its `.fact` has exactly
the eight `CityRankingFactInput` own data keys and contains no `evidenceLinks`, `manualCheckLinks` or
other Evidence URL/rejection field. Assert callbacks receive only fresh frozen exact one-key receivers
`{ capability: "canonicalizeTarget" }` or `{ capability: "evaluate" }`, never the borrowed evaluator,
registry, authority or complete input.
In the existing marker truth-table cluster, bind every raw fact's `criterionId`, `definitionId` and
`freshnessBasis` to the canonical criterion and captured evaluator definition before its callback.
Immediately descriptor-own each synchronous evaluator result before any later callback: `verified` is
the exact three-key `state/factor/targetComparison` branch, while `unknown` is the exact four-key branch
including `unknownReason`, requires factor `0` and comparison `unknown`, and cannot change the reason
of a raw-unknown fact or promote it to verified. Reject accessor/Proxy/symbol/custom-prototype/Promise,
extra/missing/own-undefined keys, malformed or out-of-range/noncanonical factors and thrown callbacks
as `integrity_mismatch`; none may become marker authority.

- [ ] **Step 2: Run RED**

```bash
./node_modules/.bin/vitest run tests/domain/city-frontier-policy.test.ts \
  tests/domain/city-selection.test.ts
```

- [ ] **Step 3: Implement pure reconstruction and transition validation**

First own and exact-close the complete input without invoking an evaluator or freezing caller data.
Application is the anti-corruption layer: after reconstructing Knowledge and replaying Evidence it
builds `CityMarkerAuthorityProjection`; Decision imports no Research/Application/Infrastructure type.
Require authority and claimed marker city/Knowledge/Evidence/time bindings to agree exactly.

Descriptor-own and exact-close the complete four-key evaluator registry before the first callback.
For every criterion, own its definition and capture the original `canonicalizeTarget` and `evaluate`
function references once. Invoke them only through fresh frozen one-capability receiver wrappers; no
later read from a borrowed registry/evaluator object is authoritative.

`reconstructCityLiveMarker` reconstructs Criteria with the supplied inward evaluator registry. For
each raw authority fact in the canonical four-criterion order, project field-by-field a fresh frozen
exact eight-key `CityRankingFactInput` containing only
`criterionId/definitionId/geoScope/referencePeriod/freshnessBasis/unit/denominator/outcome`; never pass
or alias either link array to an evaluator. Call the evaluator with a fresh frozen exact three-key
`CityCriterionEvaluationInput { criterion, fact, assessmentAt }`, then
descriptor-own and exact-validate the synchronous `CityCriterionEvaluation` result before invoking
another callback. Apply the same closed verified/unknown postconditions as the ranker, including
canonical factor bounds, raw-unknown reason equality and no unknown-to-verified promotion. Then
construct the effective committed fact and reattach fresh owned accepted/reviewed link copies. Derive each required mismatch from the verified evaluator
comparison, and compute coverage with
the ranker's exact weighted formula
`sum(importance for verified effective facts) / sum(importance)`. Derive one warning per effective
unknown fact in criterion order. A marker is red/excluded iff the derived mismatch list is nonempty;
otherwise it is yellow iff any effective fact is unknown, and green iff all four are verified. No
caller-supplied mismatch, coverage, warning or color is authoritative.

`reconstructCityFrontier` requires `ranking.assessmentAt` to equal the assessment passed to every
marker reconstruction, reruns `reconstructCityLiveMarker` with each binding's claimed marker as
`persisted`, then requires markers in activation/frozen rank order with unique city IDs, excludes every
screened ID and validates the root/successor law above. Terminal entries are green/yellow selectable markers in frozen
order and copy the caller-verified digest. After each committed marker choose stop deterministically:
`three_selectable`; else `catalog_exhausted` when no frozen candidate remains; else
`live_candidate_limit_reached` at ten markers. Otherwise preserve working
`verification_required` state. Preserve optional-field absence and duplicate accepted/reviewed link
occurrences exactly; do not deduplicate or localize labels in Decision. Experience derives display
labels from the verified `sourceId`.

- [ ] **Step 4: Implement server-derived selection/warning basis**

Selection reruns the complete frontier reconstruction, requires `frontier.persisted` to be present
with `kind === "terminal"`, and accepts only an exact terminal entry. Its nested request has exactly `cityId` and optional
`warningCopyVersion`; reject client-supplied terminal, digest, facts, parent, basis, link, command or
run fields. Return a fresh frozen `CityTerminalEntry`, the selected marker's `manualCheckLinks`
flattened in canonical four-fact/link occurrence order as transient `reviewedSourceLinks` without
deduplication, and the optional accepted copy token. Require no copy version for green and exact
`city-unknown-risk@1` for yellow. Do not persist a second reviewed-link array: the verified terminal
marker plus `entry.markerDigest` remains its durable binding. Yellow selection accepts the displayed
risk inline; no separate modal or decision aggregate is introduced.

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

export type CityFrontierRevisionPayload =
  | Omit<WorkingCityFrontierRevision, "id">
  | Omit<TerminalCityShortlistSnapshot, "id">;

export interface SealCityFrontierRevisionInput {
  readonly runId: string;
  readonly predecessorRevisionId?: string;
  readonly rankingSnapshotId: string;
  readonly markers: readonly CityLiveMarker[];
  readonly projection: CityFrontierProjection;
  readonly operation: CityFrontierOperation;
  readonly createdAt: string;
}

export function sealCityFrontierRevision(
  input: SealCityFrontierRevisionInput,
  integrity: CityDecisionIntegrity,
): CityFrontierRevision;

export function reconstructCityFrontierRevision(
  value: unknown,
  integrity: CityDecisionIntegrity,
): CityFrontierRevision;

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

export type CitySelectionSnapshotPayload = Omit<CitySelectionSnapshot, "id">;

export interface CitySelectionAuthority {
  readonly terminal: TerminalCityShortlistSnapshot;
  readonly ranking: CityRankingSnapshot;
  // Fresh output of replayPreCityBranchCommit against the verified source.
  readonly preCityBranch: PreCityBranchCommit;
}

export interface CreateCitySelectionWithBranchInput extends CitySelectionAuthority {
  readonly commandId: string;
  readonly selection: CitySelectionProjection;
  readonly createdAt: string;
}

export function reconstructCitySelectionSnapshot(
  value: unknown,
  integrity: CityDecisionIntegrity,
): CitySelectionSnapshot;

export function createCitySelectionWithBranch(
  input: CreateCitySelectionWithBranchInput,
  integrity: CityDecisionIntegrity,
): CitySelectionWithBranch;

export function reconstructCitySelectionWithBranch(
  value: unknown,
  authority: CitySelectionAuthority,
  integrity: CityDecisionIntegrity,
): CitySelectionWithBranch;

export function cityLiveMarkerDigest(
  marker: CityLiveMarker,
  integrity: CityDecisionIntegrity,
): string;
```

Branch values:

```ts
export interface PreCityResolvedCountryEntryProjection {
  readonly countryCode: string;
  readonly rank: number;
  readonly formalMarkerDigest: string;
}

export interface PreCityBranchSourceProjection {
  readonly profileSnapshotId: string;
  readonly preferenceProfileSnapshotId: string;
  readonly resolvedCountryShortlistRevisionId: string;
  readonly resolvedCountryEntry: PreCityResolvedCountryEntryProjection;
}

export interface CreatePreCityBranchCommitInput {
  readonly source: PreCityBranchSourceProjection;
  readonly createdAt: string;
}

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

export function resolvedCountryEntryDigest(
  entry: PreCityResolvedCountryEntryProjection,
  integrity: CityDecisionIntegrity,
): string;

export function createPreCityBranchCommit(
  input: CreatePreCityBranchCommitInput,
  integrity: CityDecisionIntegrity,
): PreCityBranchCommit;

export function reconstructPreCityBranchCommit(
  value: unknown,
  integrity: CityDecisionIntegrity,
): PreCityBranchCommit;

export function replayPreCityBranchCommit(
  value: unknown,
  source: PreCityBranchSourceProjection,
  integrity: CityDecisionIntegrity,
): PreCityBranchCommit;

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

export interface CityBranchSelectionProjection {
  readonly citySelectionSnapshotId: string;
  readonly preCityBranchCommitId: string;
  readonly cityId: string;
  readonly countryCode: string;
  readonly createdAt: string;
}

export function createCityBranchCommit(
  selection: CityBranchSelectionProjection,
  parent: PreCityBranchCommit,
  integrity: CityDecisionIntegrity,
): CityBranchCommit;

export function replayCityBranchCommit(
  value: unknown,
  selection: CityBranchSelectionProjection,
  parent: PreCityBranchCommit,
  integrity: CityDecisionIntegrity,
): CityBranchCommit;
```

`src/branch/city.ts` imports only the `CityDecisionIntegrity` type from Decision. It never imports
Application; Application may import these pure Branch values and functions.
`CityFrontierEvent` remains a transient compile-time closed union; Task 12 adds no durable event decoder.

- [ ] **Step 1: Write branch and closed-contract RED tests**

Test deterministic pre-city ID, exact resolved-country-entry digest, exact relocation + Preference
Profile bindings, the closed Application-owned `CityFrontierEvent` union, replay tamper and deep
freeze. Using Step 3's neutral captured-capability notation, pin
`cityLiveMarkerDigest(marker, integrity) === H(marker)` as raw lowercase 64-hex with no prefix; any marker field or
ordered duplicate link occurrence mutation changes it.

For every Task 12 seal/reconstruct/replay/wrapper boundary, test descriptor-owning and closing the
complete data graph before touching integrity, then exact descriptor-capture of only `canonical` and
`hash` into a fresh frozen exact two-key capability view. Invoke captured `canonical` with the exact
fresh frozen receiver `{ capability: "canonical" }` and captured `hash` with
`{ capability: "hash" }`, using only private frozen input. Immediately require an exact string result
and `/^[0-9a-f]{64}$/` for every hash. Accessors, symbols,
proxies, custom prototypes, sparse arrays, mutation/swap of later authority or integrity functions,
Promise-shaped/non-string/noncanonical hash results and hostile throws all fail by throwing a newly
allocated `Error("integrity_mismatch")` without reading or returning the hostile value. Assert exact
message and distinct identity across failures. Every success is a fresh recursively frozen,
non-aliased value.

Pin the scalar laws across all boundaries: exact schema/rules literals; every ID and text scalar is
non-empty, trimmed and control-free; every time is an exact canonical ISO instant; optional absence is
not an own `undefined`; country code is exact `/^[A-Z]{2}$/`; rank is a positive safe integer; and
every formal-marker, live-marker, terminal-entry or resolved-entry digest is lowercase 64-hex before
comparison, hashing or ID construction. The same lowercase-64hex law explicitly covers
`CityFrontierOperation.start.criteriaPayloadHash` and
`CitySelectionSnapshot.selectedMarkerDigest`; the latter equals the freshly recomputed selected
live-marker digest.

For `CityRankingSnapshot`, require one closed `installedPackageContext` with exactly
`countryCode/packageId/packageSchemaVersion/catalogRevisionId/evidenceRulesVersion`. Require its first
four identity fields to equal the snapshot's top-level country/package/schema/catalog fields, require
the exact fixed `verificationBudget` `{ liveCityCandidateLimit: 10, targetSelectableCities: 3,
rulesVersion: "city-frontier-budget@1" }`, and keep
top-level `rulesVersion === "city-ranker@1"` semantically separate. Cover exact key closure, missing/
extra/noncanonical fields, use of ambiguous `rulesVersion` instead of `evidenceRulesVersion`, every
top-level/context divergence and a context-only `evidenceRulesVersion` mutation with a recomputed
ranking ID. A rehashed `schemaVersion !== "city-ranking@1"` fails structural reconstruction. Assert
`sealCityRankingSnapshot` and `reconstructCityRankingSnapshot` include the complete context in the exact
hash-derived ID and return fresh frozen values. Structural reconstruction receives only `value` plus
`CityDecisionIntegrity`: prove it neither accepts caller expectations nor reads Registry/Catalog/
Criteria/Knowledge/evaluators. A structurally valid, rehashed but semantically altered order can pass
that function, then must fail the separate semantic verifier.

Test `verifyCityRankingSnapshotSemantics` with exact verified `CityRankingSemanticInputs`: Registry,
Catalog, Criteria snapshot, one Knowledge ranking projection per member and the installed evaluator
registry. Require exact Registry/catalog reference IDs, country/package/schema authority equations,
complete catalog membership, an exact `knowledgeRevisionIds` key set equal to all catalog members,
one matching null/non-null Knowledge projection per member, assessment time and canonical
rank/exclusion/factor output. In addition to the bounded binding matrix, reject (a) a structurally
re-sealed snapshot whose top-level and installed-context `packageSchemaVersion` agree with each other
and therefore passes structure, but drifts from both verified Registry and Catalog and must fail semantic
verification, and (b) a structurally re-sealed snapshot with one
extra `knowledgeRevisionIds` member key. A structurally valid re-sealed altered order may pass
`reconstructCityRankingSnapshot(value, integrity)` but must fail this semantic verifier. The verifier
owns Registry, Catalog, Criteria, Knowledge and the complete evaluator registry and captures all four
evaluator authorities before its first callback, so a first evaluator cannot mutate or swap any later
semantic input. Compile-check the exact structural and semantic signatures.

For `sealCityFrontierRevision` and `reconstructCityFrontierRevision`, cover root/successor and
working/terminal shapes, exact flattened content-derived IDs and operation authority. `start` requires
no predecessor and zero markers. `city_completed` requires a predecessor, requires
`expectedHeadRevisionId === predecessorRevisionId`, a non-empty marker list and the operation city
equal to the last marker city. A terminal entry digest must equal a fresh recomputation of the exact
unique selectable marker, and its `cityId/rank/knowledgeRevisionId/evidenceSnapshotId/unknownBasis`
must equal that marker's projection. Mutate any one entry field, substitute a valid-looking 64-hex
digest while the marker is unchanged, and fail even after rehashing the outer Frontier ID. Separately,
changing/reordering a duplicate reviewed link changes `cityLiveMarkerDigest`. A fully self-consistent
marker + recomputed digest + terminal entry + Frontier ID drift may pass this structural boundary, but
must fail the later Task 11 plus Knowledge/Evidence authority replay in Tasks 13–15. Structural
reconstruction receives only `value` and integrity and does not claim Task 11 semantic reconstruction.

For Branch and the authoritative Application wrapper, cover exact pre-city source replay, complete
selection context, green/yellow selection, yellow warning-basis tamper, A/B sibling identity,
`selection.preCityBranchCommitId === commit.parentId === commit.forkedFrom`, and wrong
parent/profile/preference/resolved-country/country/city/criteria/ranking bindings. Creation receives the
fresh Task 11 `CitySelectionProjection`, matches its entry, warning token and ordered duplicate
reviewed-link occurrences to the exact selected terminal marker, derives every durable Selection field,
then creates the Branch commit. Reconstructing an otherwise self-consistent terminal/projection pair
whose claimed entry digest is a different valid lowercase 64-hex value while the complete marker is
unchanged must fail through marker-digest recomputation even when all affected content IDs are
recomputed. Compile-check the exact named APIs: there is no Application-level
`sealCitySelectionSnapshot` and no Task 15/Application construction path for an authoritative
Selection+Branch pair except `createCitySelectionWithBranch`. The exported granular Branch
create/replay functions remain pure, non-authoritative value helpers; a store never accepts or
persists a selection-kind `CityBranchCommit` alone. The pre-city commit remains a valid independent
Start artifact inside Task 13's four-artifact transaction.
Also rehash one changed source-bound pre-city field—profile, Preference Profile, resolved revision,
country or resolved-entry digest—and every dependent Selection/Branch value: source-aware replay
against the unchanged verified source must still reject. A self-consistent `createdAt`-only change is
structurally/source valid and is not this negative. Rehash a changed City Branch payload while
keeping its expected Selection/parent projection unchanged and require `replayCityBranchCommit` to
reject it.

- [ ] **Step 2: Run RED**

```bash
./node_modules/.bin/vitest run tests/branch/city.test.ts
```

- [ ] **Step 3: Implement closed snapshot/operation types and ID helpers**

Use the Foundations `CityDecisionIntegrity` sealing contract in Application; keep `node:crypto` in
Infrastructure. Every helper first descriptor-owns/closes all borrowed data, then exact-captures the
own data descriptors for only `canonical` and `hash` into a fresh frozen exact two-key capability
view; no Task 12 contract receives `sign`. Invoke `canonical` with an exact fresh frozen
`{ capability: "canonical" }` receiver and `hash` with an exact fresh frozen
`{ capability: "hash" }` receiver plus private frozen arguments, validate callback results
immediately, and normalize any failure to a newly allocated
`Error("integrity_mismatch")` without inspecting, returning, reusing or aliasing the hostile thrown
value. Return only fresh recursively frozen, non-aliased success values. Every hash callback must return
exactly lowercase 64-hex before it enters an ID or digest.
Before those callbacks, enforce the same exact schema/rules, canonical identifier/text, canonical
instant, optional-absence, uppercase country-code, positive-safe-rank and lowercase-digest scalar laws
from Step 1.

The normative content-address formulas use only this neutral notation; it never implies a borrowed
integrity receiver:

```text
C(x) = Reflect.apply(capturedCanonical, freshFrozen({ capability: "canonical" }), [privateFrozen(x)])
H(x) = Reflect.apply(capturedHash, freshFrozen({ capability: "hash" }), [C(x)])

CityRankingSnapshot.id     = "city-ranking:" + H(payload without id)
CityFrontierRevision.id    = "city-frontier-revision:" + H(flattened payload without id)
CitySelectionSnapshot.id   = "city-selection:" + H(payload without id)
PreCityBranchCommit.id     = "pre-city-branch:" + H(payload without id)
CityBranchCommit.id        = "city-branch:" + H(payload without id)
cityLiveMarkerDigest       = H(complete marker)
resolvedCountryEntryDigest = H(complete resolved-country entry projection)
```

Terminal snapshot is the terminal frontier revision, not a second mutable summary. It includes exact
selectable entries, markers and stop condition. `sealCityFrontierRevision` owns the input and flattens
only the matching closed Task 11 projection branch; it never reranks or claims semantic Task 11
verification. `start` is valid only with no predecessor and zero markers. `city_completed` requires a
predecessor, `expectedHeadRevisionId === predecessorRevisionId`, at least one marker and an operation
city equal to the final marker city. For every terminal entry, find the exact unique matching marker
and require `entry.cityId/rank/knowledgeRevisionId/evidenceSnapshotId/unknownBasis` to equal the
selectable marker projection plus `entry.markerDigest === cityLiveMarkerDigest(marker, integrity)`.
Structural `reconstructCityFrontierRevision(value, integrity)` repeats the closed-union, operation, digest and
content-ID checks, but chain/prefix/stop/count/rank semantic reconstruction remains Task 11 plus the
Task 13 verified chain boundary.

`cityLiveMarkerDigest` first owns the exact complete marker, then returns raw lowercase `H(marker)`
without a prefix. Task 11 accepts only a caller-verified
64-hex digest and never receives integrity; every Application/persistence construction or replay of a
`CityMarkerBinding` calls this Task 12 helper and requires exact equality before pure policy.

The ranking payload is the exact `CityRankingSnapshot` object without `id`; seal it as
`id = "city-ranking:" + H(payload)`. Both sealing and reconstruction
validate the closed installed-package key and the four equality equations above before hashing or
accepting the ID, and require exactly
`{ liveCityCandidateLimit: 10, targetSelectableCities: 3, rulesVersion:
"city-frontier-budget@1" }`. `evidenceRulesVersion` comes from the independently verified installed
package definition and is never copied from the ranker's `rulesVersion`.

`reconstructCityRankingSnapshot(value, integrity)` performs only closed own-data/dense-array/canonical-
identifier validation, the installed-context/top-level equality equations and exact hash-derived ID
verification. It has no semantic inputs and must not claim to rerun ranking. The separate pure
`verifyCityRankingSnapshotSemantics(snapshot, inputs, integrity)` requires the exact five-key
`CityRankingSemanticInputs`. Before any integrity or evaluator callback it descriptor-owns/closes the
snapshot plus Registry, Catalog, Criteria, every Knowledge projection and the complete evaluator
registry, captures the exact integrity functions and all four evaluator definition/function
authorities, and only then structurally reconstructs its private owned snapshot through the former
function. It requires `registry.id === snapshot.registryRevisionId`,
`catalog.id === snapshot.catalogRevisionId`,
`catalog.registryRevisionId === registry.id`, and exact country/package/package-schema equality across
Registry, Catalog, the snapshot top level and its installed-package context. It also requires
`criteria.id === snapshot.criteriaSnapshotId`,
`criteria.profileSnapshotId === snapshot.profileSnapshotId` and
`criteria.preferenceProfileSnapshotId === snapshot.preferenceProfileSnapshotId`. It requires the
`knowledgeRevisionIds` own-key set to equal the complete Catalog member set and exactly one Knowledge
projection per member with matching city and null/non-null revision ID. From the captured authorities
it constructs one stable fresh frozen evaluator wrapper registry. Each wrapper calls the original with
a fresh frozen exact `{ capability: "canonicalizeTarget" }` or `{ capability: "evaluate" }` receiver.
Canonicalization receives only the captured string target and must return the same canonical string
required by Criteria. Evaluation receives a fresh frozen exact three-key
`{ criterion, fact, assessmentAt }` whose `fact` is the Task 11 exact eight-key projection, and its
synchronous exact three-key verified or four-key unknown result is immediately descriptor-owned and
validated before any later callback. Verified requires canonical factor `[0,1]`, comparison
`matches | does_not_match` and no promotion of a raw unknown fact; unknown requires factor `0`,
comparison `unknown` and the allowed raw reason unchanged. It reconstructs
Criteria and calls the existing pure Decision ranking reconstruction only with that private wrapper
registry for `snapshot.assessmentAt`,
canonical-compares `ordered/screenedExclusions/rulesVersion`, and returns the verified fresh frozen
snapshot. No Infrastructure row enters either pure contract; only the semantic function receives the
compiled inward evaluator registry.

- [ ] **Step 4: Implement pure branch create/replay**

`resolvedCountryEntryDigest` hashes the complete exact
`{ countryCode, rank, formalMarkerDigest }` projection. `createPreCityBranchCommit` derives its flattened
payload and content ID from the exact closed `PreCityBranchSourceProjection` plus `createdAt`;
`reconstructPreCityBranchCommit(value, integrity)` is the descriptor-safe closed structural/content-ID
primitive. `replayPreCityBranchCommit` first calls that primitive, then requires every profile,
Preference Profile, resolved-shortlist, country-entry digest and country binding to equal the already
verified source even when a forged payload and its content ID are self-consistently rehashed. Task 14
constructs that plain source only after exact profile/Preference Profile reconstruction and
`requireResolvedCountryShortlistForCity`, including unique exact country entry
membership and equality of both profile IDs with the resolved snapshot source. Pre-city parent excludes
criteria/ranking/terminal-city fields. Its canonical `createdAt` is structurally content-bound but is
not supplied by `PreCityBranchSourceProjection` as an expected replay authority.

`createCityBranchCommit` and `replayCityBranchCommit` derive/verify the closed content-addressed commit
from the narrow Selection projection plus its exact pre-city parent. Require
`parentId === forkedFrom === selection.preCityBranchCommitId`, exact Selection ID/city/country/time and
country equality with the parent. City Branch includes only exact Selection identity and parent
lineage; replay rejects a self-consistently rehashed commit when its expected Selection or parent
projection is unchanged. Branch imports only the Decision integrity type and no Application or housing
budget/decision type.

Application exposes one normal construction boundary:
`createCitySelectionWithBranch(input, integrity)`. Its `preCityBranch` authority must already be
the fresh frozen output of `replayPreCityBranchCommit(value, verifiedSource, integrity)` against the
Task 14/15 verified source; `CitySelectionAuthority` intentionally does not duplicate that source.
The wrapper structurally reconstructs the supplied terminal,
Ranking and pre-city parent through `reconstructCityFrontierRevision`,
`reconstructCityRankingSnapshot` and `reconstructPreCityBranchCommit`; recomputes every terminal-entry
marker digest; requires
`terminal.runId === ranking.runId`, `terminal.rankingSnapshotId === ranking.id`,
`ranking.preCityBranchCommitId === preCityBranch.id`, and exact country/profile/Preference
Profile/resolved-country mirrors between Ranking and parent. It requires the supplied fresh Task 11
selection entry, warning token and ordered reviewed-link occurrence list to equal the exact selected
terminal marker, derives every durable `CitySelectionSnapshotPayload` field server-side, seals its
content ID, then invokes the pure Branch constructor. A caller never supplies parent/fork/digest/basis
or durable context fields as independent authority; those values carried by the fresh Task 11
projection are checked and rederived.

`reconstructCitySelectionWithBranch(value, authority, integrity)` first closes exact
`{ selection, commit }`, calls `reconstructCitySelectionSnapshot` for the Selection, reconstructs its
owned authority through `reconstructCityFrontierRevision`, `reconstructCityRankingSnapshot` and
`reconstructPreCityBranchCommit`, derives the exact `CityBranchSelectionProjection`, and calls
`replayCityBranchCommit`; it has no parallel ad-hoc decoder. It then repeats all
terminal/ranking/pre-city and marker-digest authority equations and
requires every derived Selection field—run, terminal, profile, Preference Profile, resolved-country,
criteria, Ranking, pre-city, selected-marker digest, Knowledge, Evidence, unknown basis, warning token,
city and country—to equal the authority-derived value, plus
`selection.preCityBranchCommitId === commit.parentId === commit.forkedFrom` and
`selection.createdAt === commit.createdAt`. It structurally validates and content-binds the Selection
command ID; Task 15's external command envelope separately verifies its idempotency binding. It does
not rerun Task 11 policy or source replay: Task 15 must first obtain a fresh
`CitySelectionProjection` from its
independently verified Task 11 frontier for creation, and both create/load paths must source-replay the
pre-city parent before supplying the terminal/ranking/pre-city authority. A and B selected from one
terminal necessarily reuse the same pre-city parent and become sibling commits. There is no
Application API that independently seals a Selection snapshot
or an unbound Selection/Branch pair; granular Branch constructors remain pure non-authoritative Branch
helpers used by the wrapper and verified store paths.

`reconstructCitySelectionSnapshot(value, integrity)` performs only descriptor-safe exact closed
structural/content-ID replay and returns a fresh recursively frozen copy. It is never Selection
authority without `reconstructCitySelectionWithBranch` plus the verified authority graph.

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
- Modify: `src/application/city-frontier-contracts.ts`
- Modify: `src/decision/city-criteria.ts`
- Create: `src/infrastructure/sqlite/city-criteria-store.ts`
- Create: `src/infrastructure/sqlite/city-frontier-store.ts`
- Create: `src/infrastructure/sqlite/city-branch-store.ts`
- Create: `tests/application/city-frontier-identity.test.ts`
- Modify: `tests/domain/city-criteria.test.ts`
- Modify: `tests/branch/city.test.ts`
- Create: `tests/integration/city-frontier-store.test.ts`
- Create: `tests/support/city-frontier-publication-worker.ts`
- Modify: `src/infrastructure/sqlite/schema.sql`
- Modify: `src/infrastructure/sqlite/db.ts`
- Modify: `tests/integration/database-schema.test.ts`
- Modify: `tests/integration/confirmed-life.test.ts`
- Modify: `tests/branch/life-git.test.ts`

**Interfaces:**

```ts
export interface CityCriteriaCommandPayload {
  readonly schemaVersion: "city-criteria-command@1";
  readonly profileSnapshotId: string;
  readonly preferenceProfileSnapshotId: string;
  readonly criteria: readonly [
    CityCriterionDraft,
    CityCriterionDraft,
    CityCriterionDraft,
    CityCriterionDraft,
  ];
  readonly rulesVersion: "city-criteria@1";
}

export function cityCriteriaPayloadHash(
  input: CityCriteriaCommandPayload,
  integrity: CityDecisionIntegrity,
): string;

export interface CityFrontierRunIdentity {
  readonly schemaVersion: "city-frontier-run@1";
  readonly resolvedCountryShortlistRevisionId: string;
  readonly countryCode: string;
  readonly registryRevisionId: string;
  readonly installedPackageContext: InstalledCityPackageExactKey;
  readonly criteriaPayloadHash: string;
  readonly catalogRulesVersion: CityCatalogRevision["rulesVersion"];
  readonly rankingRulesVersion: "city-ranker@1";
  readonly verificationBudget: CityFrontierVerificationBudget;
}

export function cityFrontierRunId(
  input: CityFrontierRunIdentity,
  integrity: CityDecisionIntegrity,
): string;

export interface CityFrontierStartIntent {
  readonly schemaVersion: "city-frontier-start-intent@1";
  readonly runId: string;
  readonly resolvedCountryShortlistRevisionId: string;
  readonly countryCode: string;
  readonly criteriaPayloadHash: string;
}

export interface CityFrontierAppendInput {
  readonly revision: CityFrontierRevision;
}

export interface CityCommandResult {
  readonly operation: CityFrontierOperation;
  readonly revision: CityFrontierRevision;
}

export interface CityFrontierStartPublication {
  readonly intent: CityFrontierStartIntent;
  readonly criteria: CityCriteriaSnapshot;
  readonly preCityBranch: PreCityBranchCommit;
  readonly preCitySource: PreCityBranchSourceProjection;
  readonly ranking: CityRankingSnapshot;
  readonly root: CityFrontierRevision;
}

export interface CityFrontierStartPublicationResult {
  readonly criteria: CityCriteriaSnapshot;
  readonly preCityBranch: PreCityBranchCommit;
  readonly ranking: CityRankingSnapshot;
  readonly root: CityFrontierRevision;
}

export interface CityCriteriaReadPort {
  loadCriteriaVerified(id: string): CityCriteriaSnapshot;
}

export interface CityBranchReadPort {
  loadPreCityBranchVerified(id: string): PreCityBranchCommit;
  findPreCityBranchBySourceVerified(
    source: PreCityBranchSourceProjection,
  ): PreCityBranchCommit | undefined;
}

export interface CityRankingReadPort {
  loadRankingVerified(id: string): CityRankingSnapshot;
}

export interface CityFrontierReadPort {
  loadRevisionVerified(id: string): CityFrontierRevision;
  loadHeadVerified(runId: string): CityFrontierRevision;
  loadChainVerified(runId: string): readonly CityFrontierRevision[];
  findCommandVerified(runId: string, commandId: string): CityCommandResult | undefined;
}

export interface CityFrontierAppendPort {
  appendRevision(input: CityFrontierAppendInput): CityFrontierRevision;
}

export interface CityFrontierStorePort
  extends CityFrontierReadPort, CityFrontierAppendPort {}

export interface CitySelectionHistoryReadPort {
  listSelectionsWithBranchesVerified(
    runId: string,
  ): Promise<readonly CitySelectionWithBranch[]>;
}

export interface CityFrontierStartWriterPort {
  publishStart(
    input: CityFrontierStartPublication,
  ): CityFrontierStartPublicationResult;
}
```

`src/application/city-frontier-contracts.ts` replaces the current source defect
`CityFrontierReadModel = CityFrontierRevision` with the exact rich interface already frozen in the
master ledger: run/assessment/source IDs, `registry`, `catalog`, `criteria`, `ranking`, current
`revision` and verified `selections`. The alias must not remain. SQLite returns only the granular
publication result above; Task 14 Application assembles the rich model after semantic verification.
Task 13 defines `CitySelectionHistoryReadPort` early so Task 14 depends on the stable inward port from
day one. Task 13 compile-pins only `CitySelectionHistoryReadPort`; it does not implement or test an
adapter, create a non-empty history fixture or claim pair/history ordering. Task 14 supplies and tests
the explicit fresh recursively frozen empty adapter, non-aliased across calls, until Task 15 replaces it.
Task 15 exclusively owns non-empty selection history, structural pair verification, reverse physical
insertion/equal-`createdAt` tie-break RED and rich-presentation ordering. It extends the port with its
by-ID loader; Task 14 never hardcodes `[]` and never imports a future writer.

The three exact identity equations use the Task 12 neutral captured-capability notation:

```text
cityCriteriaPayloadHash(input, integrity) = H(C(exact CityCriteriaCommandPayload))
cityFrontierRunId(input, integrity)        = "city-frontier:" + H(C(exact CityFrontierRunIdentity))
Start command equality                    = global root.operation.commandId ->
                                            C(exact CityFrontierStartIntent)
Successor command key                     = (runId, operation.commandId)
```

Both helpers descriptor-own and close the complete input and exact-capture only `canonical` and `hash`
as in Task 12. Every hash is raw lowercase 64-hex before return or prefixing. The Criteria command
payload has exactly the five named keys and exactly four criteria; it excludes Criteria ID and every
time. The run identity has exactly the nine named keys and includes the full five-key
`InstalledCityPackageExactKey` plus the exact budget; it excludes every clock and every snapshot ID
derived from a clock. Its Catalog-rules field is the authenticated referenced Catalog's closed
`"city-catalog@1" | "city-catalog@2"` value; both historical identity formulas are replayable, while a
new Start accepts only `CITY_CATALOG_RULES_VERSION`. The Start intent is the exact timestamp-free
five-key value above, and its `runId` must equal the ID recomputed from the exact run identity. No generic
payload/hash DTO or caller-supplied semantic proof is permitted.

Authority is split by the Dependency Rule. SQLite owns signed canonical row bytes, row hashes/HMACs,
content IDs, mirrors/FKs, Task 12 and Criteria structural replay, stored-source pre-city replay, command
equality, five-table constraints and complete frontier-chain topology. Application owns evaluator-aware
Criteria verification, semantic Ranking verification, verified Knowledge/Evidence reconstruction, raw
marker digest, and Task 11 frontier/selection reconstruction before seal/write and after every load.
The store never imports evaluator, Knowledge/Evidence or Task 11 policy, never claims their semantics,
and never accepts a caller Task 11 projection, digest or semantic-proof DTO. `CityCommandResult.operation`
must canonically equal `revision.operation`; `CityFrontierAppendInput` contains only `revision`.

- [ ] **Step 1: Write exact contract, identity and Criteria structural RED tests**

In `tests/application/city-frontier-identity.test.ts`, compile/runtime-pin every exact signature and
closed key set above, the rich `CityFrontierReadModel`, `CitySelectionHistoryReadPort`, and absence of
the old read-model alias, loader-context DTO, caller projection/digest and legacy append/publication
result. Pin the two identity formulas, prefix/raw-hash distinction, full installed key and budget,
both authenticated Catalog-rules literals, timestamp exclusion, criteria ID/time exclusion, and
single-field mutation sensitivity. Descriptor,
proxy, accessor, symbol, prototype, sparse-array, aliasing, hostile capability and non-lowerhex cases
follow the Task 12 boundary laws without a Cartesian callback permutation.

In `tests/domain/city-criteria.test.ts`, add the public structural boundary:

```ts
export function reconstructCityCriteriaSnapshot(
  value: unknown,
  integrity: CityDecisionIntegrity,
): CityCriteriaSnapshot;
```

Its exact content ID is `city-criteria:${H(C(payload without id))}`. It descriptor-owns/closes the
exact snapshot graph, validates scalar/schema/rules/tuple shape and ID, and returns a fresh recursively
frozen copy. It is structural only: one structurally valid, rehashed target that disagrees with the
installed evaluator passes this function and then fails the existing evaluator-aware
`reconstructCityCriteria(snapshot, evaluators)`. Pin that the existing semantic API remains and no
evaluator enters `reconstructCityCriteriaSnapshot`.

- [ ] **Step 2: Write the bounded persistence RED matrix**

Keep the matrix non-Cartesian. Cover exact signatures/rich model/no legacy DTO; identity formula and
timing; one success plus one representative missing/extra/mirror/HMAC/content-ID tamper per table;
structural-versus-semantic Criteria/Ranking/Frontier split; and the following focused groups:

1. Criteria, deterministic pre-city parent, Ranking and root round-trip as four exact artifacts.
2. Start failure after each would-be insert, command replay/conflict, different-command deterministic-run
   conflict, and a pre-existing shared parent that survives rollback.
   Reuse one Start command globally with changed resolved revision, country, Criteria or installed
   context/derived run and require `integrity_mismatch` rather than a second run.
3. Same-source concurrent Starts with different Criteria/run identities and different commands both
   succeed while producing byte-identical parent payload/ID and one shared row. The separate same-run/
   different-Start-command case is `integrity_mismatch`. Same-command retries converge on the stored
   winner even when the loser constructed later time-bound candidates.
4. One root, one successor, unique `(runId, commandId)` across all rows, one global Start command and
   one terminal; exact prefix-plus-one, expected head,
   run/Ranking/operation/time equations, terminal-final/no-successor, no working tenth marker and no
   rowid-order authority. Rehash one otherwise authentic Criteria/Ranking/root cross-row identity and
   require every full-chain/root loader to reject it. Structurally load authentic `@1` and `@2` Catalog
   identities, but require `city_catalog_upgrade_required` with zero insert for `@1` `publishStart` and
   direct `appendRevision`, including exact stored-command hits that would otherwise replay; an unknown
   Catalog rules literal remains `integrity_mismatch`.
5. Corrupt one non-returned ancestor at a time for `loadRevisionVerified`, `loadHeadVerified`,
   `loadChainVerified` and `findCommandVerified`; every loader rejects because each verifies the full
   chain. Also request an authentic root while a later terminal descendant is corrupt, then add an
   authenticated disconnected/cycle row; full loaded-row-set closure rejects both. Add two connections:
   different valid successors yield one success/one
   `stale_city_frontier_head`; identical command retries converge.
6. Task 15 schema foresight: selection command envelope has no timestamp, the branch row is the closed
   `pre_city | selection` union, and selection/branch pair lineage is FK/mirror-closed without a sixth
   mapping table.
7. For each Task 13 result family—not every method permutation—mutate/identity-check one load/find
   result, one append/command replay, one Start four-artifact result and the frontier-chain array. Every
   public Task 13 persistence output and nested artifact is fresh recursively frozen, non-aliased from
   input and non-aliased across calls. Selection-pair/history outputs remain exclusively Task 15.

Pre-city load is exactly one-argument and no-context. `loadPreCityBranchVerified(id)` authenticates its
row, invokes `CountryResolutionStorePort.locateChainVerified({ revisionId:
storedPreCity.resolvedCountryShortlistRevisionId })`, requires the requested
revision to be the verified resolved head, requires exactly one resolved entry for the stored country,
rebuilds the exact `PreCityBranchSourceProjection` from the verified chain source plus that entry, and
calls `replayPreCityBranchCommit`. This is structural/HMAC source replay only. Task 14 independently
repeats the full semantic resolved-country/profile guard and canonical-compares its source and parent.
`findPreCityBranchBySourceVerified(source)` queries only the exact authoritative logical key
`(source.resolvedCountryShortlistRevisionId, source.resolvedCountryEntry.countryCode)`, derives/replays
the same verified stored source, and returns `undefined` only for absence. A row at that key whose
mirrors or deterministic candidate differ is `integrity_mismatch`; Application does not catch
`pre_city_branch_not_found` as control flow.
Before reading either nested key or issuing SQL, it descriptor-owns/closes the complete source. One
hostile accessor/swap RED proves zero query and `integrity_mismatch`; do not expand it into a Cartesian
source-shape matrix.
Use exact errors `city_criteria_not_found`, `pre_city_branch_not_found`, `city_ranking_not_found` and
`city_frontier_not_found`; reserve `city_selection_not_found` for Task 15. Row tamper, binding failure
and Start conflicts are `integrity_mismatch`.

- [ ] **Step 3: Run RED and capture two static no-veto reviews**

```bash
./node_modules/.bin/vitest run tests/application/city-frontier-identity.test.ts \
  tests/domain/city-criteria.test.ts tests/branch/city.test.ts
./node_modules/.bin/vitest run tests/integration/city-frontier-store.test.ts \
  tests/integration/database-schema.test.ts
```

Expected: both commands fail only because the Task 13 production contracts/tables/stores are absent.
Before any production edit, obtain two independent static reviews of the frozen RED files and this
Task 13 block. Review A checks exact contracts/formulas/authority direction; Review B checks schema,
transaction, topology, races/errors and bounded coverage. Both must report Critical 0 / Important 0
and no veto. Any veto stops production and amends the plan/tests first. Do not implement from a review
with unresolved findings.

- [ ] **Step 4: Implement the structural Criteria API, identity helpers and rich read model**

Implement `reconstructCityCriteriaSnapshot` with the same descriptor-safe neutral integrity capture and
failure normalization as Task 12; keep evaluator-aware `reconstructCityCriteria` semantic. Implement
the exact payload/run helpers in `city-data-contracts.ts`. Replace the read-model alias with the master
ledger's exact rich interface. Add all inward ports and exact DTOs above; do not add a context argument,
semantic proof, projection or digest field for persistence convenience.

Task 14 obtains one `startAt` only after the installed package, resolved-country/profile, Criteria
draft and Knowledge inputs are verified. The exact time equations are:

```text
criteria.confirmedAt = ranking.assessmentAt = ranking.createdAt = root.createdAt = startAt
preCityBranch.createdAt = verifiedResolvedCountryShortlist.createdAt <= startAt
```

The pre-city parent is content-addressed from the verified source and the resolved snapshot's stable
`createdAt`, never the current Start clock. Application creates the deterministic candidate, performs
the source-key load/replay before sealing Ranking, reuses an exact existing parent when present, and
canonical-compares it with the candidate. Concurrent same-source Starts therefore construct identical
parent bytes and ID. No reservation, retry-time timestamp, ranking reseal or clock-derived parent ID is
allowed.

- [ ] **Step 5: Add exactly five tables and exact preflight inventory**

Add exactly `city_criteria_snapshots`, `city_branch_commits`, `city_ranking_snapshots`,
`city_frontier_revisions` and `city_selection_snapshots`; add no sixth/ninth support table. Every table
has private canonical `payload_json/payload_hash/hmac` columns and UPDATE/DELETE immutable triggers.
Freeze the row envelope formulas with `C` as canonical JSON, `SHA256_TEXT` as the raw lowercase-64
digest of exact text, and `HMAC_SHA256_TEXT` as the raw lowercase-64 keyed MAC of exact text:

```text
payload_json = C(reconstructed value)
payload_hash = SHA256_TEXT(payload_json)

non-command row hmac = HMAC_SHA256_TEXT(payload_json, key)

command_json = C(exact Start intent | successor operation | Task 15 selection intent)
command_hash = SHA256_TEXT(command_json)
command-row hmac = HMAC_SHA256_TEXT(
  C({ value: reconstructed value, command: exact command }),
  key,
)
```

Criteria, pre-city Branch and Ranking are non-command rows. Frontier and Selection are command rows;
the selection-kind Branch is authenticated as part of its structurally reconstructed Selection pair
and also retains its own non-command payload envelope. Field names and preimages are not adapter
choices. Verify canonical byte equality before parsed values, mirrors or FKs can be returned.
The exact schema and preflight inventory include:

- Criteria mirrors schema/rules/profile/Preference Profile/confirmed time and FKs both profile IDs.
- Branch is a closed `pre_city | selection` row. `pre_city` requires profile, Preference Profile,
  resolved revision, country and resolved-entry digest; forbids parent/fork/selection; its unique exact
  partial source key is exactly `(resolved_country_shortlist_revision_id, country_code) WHERE
  kind = 'pre_city'`. Profile/Preference Profile/entry-digest mirrors must equal the derived verified
  source but must not widen that uniqueness key. `selection` requires
  `parent_id = forked_from`, selection FK and matching country/time lineage. Its common profile,
  Preference Profile, resolved-revision and entry-digest columns are derived mirrors that must equal the
  verified pre-city parent/Selection context; they are never independent selection payload authority.
- Ranking is unique per run; FKs/mirrors bind resolved revision, Criteria, catalog and pre-city parent.
  It stores the closed installed context and mirrors country/package/schema/catalog/evidence-rules plus
  the fixed verification budget. Knowledge-map members are verified by exact lookup and payload/mirror
  comparison; do not add a per-map FK/junction table.
- Frontier FKs/mirrors bind predecessor and Ranking; named unique partial indexes enforce one root,
  one successor, global one Start `command_id`, one `(run, command)` across every Frontier row and one
  terminal. The global Start index is partial exactly on
  `command_id WHERE operation_kind = 'start'`; the all-row `(run_id, command_id)` index also prevents a
  successor from reusing its root command.
- Selection exists now but Task 13 never writes it. It includes Task 15's timestamp-free canonical
  command envelope/hash, terminal/Ranking/Criteria/pre-city/Knowledge/Evidence mirrors and the closed
  pair-lineage columns needed by the selection-kind branch FK. The exact named unique index
  `city_selection_snapshots_one_command` covers `(run_id, command_id)`. No creation timestamp enters command
  equality; its races converge by command-first canonical intent comparison, and unrelated constraints
  or native/busy errors are never relabeled as command conflicts.

The compact column map below is explanatory only. The executable `CREATE TABLE`/index/trigger SQL that
follows it is the sole normative physical schema and the normalized-SQL preflight authority. In this
map, columns are listed in physical order; `NN` means `NOT NULL`, `NULL` means nullable with default
`NULL`, and every omitted default means no default:

```text
city_criteria_snapshots:
  id TEXT PK NN;
  profile_snapshot_id TEXT NN FK profile_snapshots(id);
  preference_profile_snapshot_id TEXT NN FK profile_snapshots(id);
  schema_version TEXT NN CHECK = 'city-criteria@1';
  rules_version TEXT NN CHECK = 'city-criteria@1';
  confirmed_at TEXT NN;
  payload_json TEXT NN;
  payload_hash TEXT NN CHECK lowercase-hex64;
  hmac TEXT NN CHECK lowercase-hex64;
  CHECK profile_snapshot_id <> preference_profile_snapshot_id.

city_selection_snapshots:
  id TEXT PK NN;
  run_id TEXT NN;
  command_id TEXT NN;
  terminal_revision_id TEXT NN FK city_frontier_revisions(id);
  city_id TEXT NN;
  country_code TEXT NN CHECK /^[A-Z]{2}$/;
  profile_snapshot_id TEXT NN FK profile_snapshots(id);
  preference_profile_snapshot_id TEXT NN FK profile_snapshots(id);
  resolved_country_shortlist_revision_id TEXT NN FK country_resolution_revisions(id);
  criteria_snapshot_id TEXT NN FK city_criteria_snapshots(id);
  ranking_snapshot_id TEXT NN FK city_ranking_snapshots(id);
  pre_city_branch_commit_id TEXT NN FK city_branch_commits(id);
  selected_marker_digest TEXT NN CHECK lowercase-hex64;
  knowledge_revision_id TEXT NN FK city_knowledge_revisions(id);
  evidence_snapshot_id TEXT NN FK city_evidence_snapshots(id);
  warning_copy_version TEXT NULL CHECK NULL | 'city-unknown-risk@1';
  schema_version TEXT NN CHECK = 'city-selection@1';
  command_json TEXT NN;
  command_hash TEXT NN CHECK lowercase-hex64;
  payload_json TEXT NN;
  payload_hash TEXT NN CHECK lowercase-hex64;
  hmac TEXT NN CHECK lowercase-hex64;
  created_at TEXT NN;
  CHECK profile_snapshot_id <> preference_profile_snapshot_id.

city_branch_commits:
  id TEXT PK NN;
  kind TEXT NN CHECK IN ('pre_city','selection');
  profile_snapshot_id TEXT NN FK profile_snapshots(id);
  preference_profile_snapshot_id TEXT NN FK profile_snapshots(id);
  resolved_country_shortlist_revision_id TEXT NN FK country_resolution_revisions(id);
  country_code TEXT NN CHECK /^[A-Z]{2}$/;
  resolved_country_entry_digest TEXT NN CHECK lowercase-hex64;
  city_id TEXT NULL;
  parent_id TEXT NULL FK city_branch_commits(id);
  forked_from TEXT NULL FK city_branch_commits(id);
  selection_snapshot_id TEXT NULL FK city_selection_snapshots(id);
  schema_version TEXT NN CHECK pre_city -> 'pre-city-branch@1', selection -> 'city-branch@1';
  payload_json TEXT NN;
  payload_hash TEXT NN CHECK lowercase-hex64;
  hmac TEXT NN CHECK lowercase-hex64;
  created_at TEXT NN;
  CHECK profile_snapshot_id <> preference_profile_snapshot_id;
  CHECK pre_city -> city_id/parent_id/forked_from/selection_snapshot_id all NULL;
  CHECK selection -> city_id/parent_id/forked_from/selection_snapshot_id all NN and parent_id = forked_from.

city_ranking_snapshots:
  id TEXT PK NN;
  run_id TEXT NN;
  resolved_country_shortlist_revision_id TEXT NN FK country_resolution_revisions(id);
  country_code TEXT NN CHECK /^[A-Z]{2}$/;
  package_id TEXT NN;
  package_schema_version TEXT NN;
  registry_revision_id TEXT NN;
  catalog_revision_id TEXT NN FK city_catalog_revisions(id);
  criteria_snapshot_id TEXT NN FK city_criteria_snapshots(id);
  pre_city_branch_commit_id TEXT NN FK city_branch_commits(id);
  profile_snapshot_id TEXT NN FK profile_snapshots(id);
  preference_profile_snapshot_id TEXT NN FK profile_snapshots(id);
  evidence_rules_version TEXT NN;
  installed_package_context_json TEXT NN;
  live_city_candidate_limit INTEGER NN CHECK = 10;
  target_selectable_cities INTEGER NN CHECK = 3;
  budget_rules_version TEXT NN CHECK = 'city-frontier-budget@1';
  schema_version TEXT NN CHECK = 'city-ranking@1';
  rules_version TEXT NN CHECK = 'city-ranker@1';
  assessment_at TEXT NN;
  payload_json TEXT NN;
  payload_hash TEXT NN CHECK lowercase-hex64;
  hmac TEXT NN CHECK lowercase-hex64;
  created_at TEXT NN;
  CHECK profile_snapshot_id <> preference_profile_snapshot_id;
  composite FK (country_code, package_id, package_schema_version, catalog_revision_id,
    evidence_rules_version) -> installed_city_package_manifests exact-key columns.

city_frontier_revisions:
  id TEXT PK NN;
  run_id TEXT NN;
  kind TEXT NN CHECK IN ('working','terminal');
  predecessor_id TEXT NULL FK city_frontier_revisions(id);
  ranking_snapshot_id TEXT NN FK city_ranking_snapshots(id);
  operation_kind TEXT NN CHECK IN ('start','city_completed');
  command_id TEXT NN;
  schema_version TEXT NN CHECK = 'city-frontier@1';
  command_json TEXT NN;
  command_hash TEXT NN CHECK lowercase-hex64;
  payload_json TEXT NN;
  payload_hash TEXT NN CHECK lowercase-hex64;
  hmac TEXT NN CHECK lowercase-hex64;
  created_at TEXT NN;
  CHECK predecessor_id IS NULL iff operation_kind = 'start';
  CHECK predecessor_id <> id.
```

The exact `schema.sql` table SQL below expands every shorthand above; this SQL, not an
implementer-chosen translation, is compared by preflight:

```sql
CREATE TABLE IF NOT EXISTS city_criteria_snapshots (
  id TEXT PRIMARY KEY NOT NULL,
  profile_snapshot_id TEXT NOT NULL REFERENCES profile_snapshots(id),
  preference_profile_snapshot_id TEXT NOT NULL REFERENCES profile_snapshots(id),
  schema_version TEXT NOT NULL CHECK (schema_version = 'city-criteria@1'),
  rules_version TEXT NOT NULL CHECK (rules_version = 'city-criteria@1'),
  confirmed_at TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  payload_hash TEXT NOT NULL CHECK (
    length(payload_hash) = 64 AND payload_hash NOT GLOB '*[^0-9a-f]*'
  ),
  hmac TEXT NOT NULL CHECK (
    length(hmac) = 64 AND hmac NOT GLOB '*[^0-9a-f]*'
  ),
  CHECK (profile_snapshot_id <> preference_profile_snapshot_id)
);

CREATE TABLE IF NOT EXISTS city_selection_snapshots (
  id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL,
  command_id TEXT NOT NULL,
  terminal_revision_id TEXT NOT NULL REFERENCES city_frontier_revisions(id),
  city_id TEXT NOT NULL,
  country_code TEXT NOT NULL CHECK (
    length(country_code) = 2 AND country_code = upper(country_code)
    AND country_code GLOB '[A-Z][A-Z]'
  ),
  profile_snapshot_id TEXT NOT NULL REFERENCES profile_snapshots(id),
  preference_profile_snapshot_id TEXT NOT NULL REFERENCES profile_snapshots(id),
  resolved_country_shortlist_revision_id TEXT NOT NULL REFERENCES country_resolution_revisions(id),
  criteria_snapshot_id TEXT NOT NULL REFERENCES city_criteria_snapshots(id),
  ranking_snapshot_id TEXT NOT NULL REFERENCES city_ranking_snapshots(id),
  pre_city_branch_commit_id TEXT NOT NULL REFERENCES city_branch_commits(id),
  selected_marker_digest TEXT NOT NULL CHECK (
    length(selected_marker_digest) = 64
    AND selected_marker_digest NOT GLOB '*[^0-9a-f]*'
  ),
  knowledge_revision_id TEXT NOT NULL REFERENCES city_knowledge_revisions(id),
  evidence_snapshot_id TEXT NOT NULL REFERENCES city_evidence_snapshots(id),
  warning_copy_version TEXT CHECK (
    warning_copy_version IS NULL OR warning_copy_version = 'city-unknown-risk@1'
  ),
  schema_version TEXT NOT NULL CHECK (schema_version = 'city-selection@1'),
  command_json TEXT NOT NULL,
  command_hash TEXT NOT NULL CHECK (
    length(command_hash) = 64 AND command_hash NOT GLOB '*[^0-9a-f]*'
  ),
  payload_json TEXT NOT NULL,
  payload_hash TEXT NOT NULL CHECK (
    length(payload_hash) = 64 AND payload_hash NOT GLOB '*[^0-9a-f]*'
  ),
  hmac TEXT NOT NULL CHECK (
    length(hmac) = 64 AND hmac NOT GLOB '*[^0-9a-f]*'
  ),
  created_at TEXT NOT NULL,
  CHECK (profile_snapshot_id <> preference_profile_snapshot_id)
);

CREATE TABLE IF NOT EXISTS city_branch_commits (
  id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('pre_city', 'selection')),
  profile_snapshot_id TEXT NOT NULL REFERENCES profile_snapshots(id),
  preference_profile_snapshot_id TEXT NOT NULL REFERENCES profile_snapshots(id),
  resolved_country_shortlist_revision_id TEXT NOT NULL REFERENCES country_resolution_revisions(id),
  country_code TEXT NOT NULL CHECK (
    length(country_code) = 2 AND country_code = upper(country_code)
    AND country_code GLOB '[A-Z][A-Z]'
  ),
  resolved_country_entry_digest TEXT NOT NULL CHECK (
    length(resolved_country_entry_digest) = 64
    AND resolved_country_entry_digest NOT GLOB '*[^0-9a-f]*'
  ),
  city_id TEXT,
  parent_id TEXT REFERENCES city_branch_commits(id),
  forked_from TEXT REFERENCES city_branch_commits(id),
  selection_snapshot_id TEXT REFERENCES city_selection_snapshots(id),
  schema_version TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  payload_hash TEXT NOT NULL CHECK (
    length(payload_hash) = 64 AND payload_hash NOT GLOB '*[^0-9a-f]*'
  ),
  hmac TEXT NOT NULL CHECK (
    length(hmac) = 64 AND hmac NOT GLOB '*[^0-9a-f]*'
  ),
  created_at TEXT NOT NULL,
  CHECK (profile_snapshot_id <> preference_profile_snapshot_id),
  CHECK (
    (kind = 'pre_city' AND schema_version = 'pre-city-branch@1'
      AND city_id IS NULL AND parent_id IS NULL AND forked_from IS NULL
      AND selection_snapshot_id IS NULL)
    OR
    (kind = 'selection' AND schema_version = 'city-branch@1'
      AND city_id IS NOT NULL AND parent_id IS NOT NULL AND forked_from IS NOT NULL
      AND selection_snapshot_id IS NOT NULL AND parent_id = forked_from)
  )
);

CREATE TABLE IF NOT EXISTS city_ranking_snapshots (
  id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL,
  resolved_country_shortlist_revision_id TEXT NOT NULL REFERENCES country_resolution_revisions(id),
  country_code TEXT NOT NULL CHECK (
    length(country_code) = 2 AND country_code = upper(country_code)
    AND country_code GLOB '[A-Z][A-Z]'
  ),
  package_id TEXT NOT NULL,
  package_schema_version TEXT NOT NULL,
  registry_revision_id TEXT NOT NULL,
  catalog_revision_id TEXT NOT NULL REFERENCES city_catalog_revisions(id),
  criteria_snapshot_id TEXT NOT NULL REFERENCES city_criteria_snapshots(id),
  pre_city_branch_commit_id TEXT NOT NULL REFERENCES city_branch_commits(id),
  profile_snapshot_id TEXT NOT NULL REFERENCES profile_snapshots(id),
  preference_profile_snapshot_id TEXT NOT NULL REFERENCES profile_snapshots(id),
  evidence_rules_version TEXT NOT NULL,
  installed_package_context_json TEXT NOT NULL,
  live_city_candidate_limit INTEGER NOT NULL CHECK (live_city_candidate_limit = 10),
  target_selectable_cities INTEGER NOT NULL CHECK (target_selectable_cities = 3),
  budget_rules_version TEXT NOT NULL CHECK (budget_rules_version = 'city-frontier-budget@1'),
  schema_version TEXT NOT NULL CHECK (schema_version = 'city-ranking@1'),
  rules_version TEXT NOT NULL CHECK (rules_version = 'city-ranker@1'),
  assessment_at TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  payload_hash TEXT NOT NULL CHECK (
    length(payload_hash) = 64 AND payload_hash NOT GLOB '*[^0-9a-f]*'
  ),
  hmac TEXT NOT NULL CHECK (
    length(hmac) = 64 AND hmac NOT GLOB '*[^0-9a-f]*'
  ),
  created_at TEXT NOT NULL,
  CHECK (profile_snapshot_id <> preference_profile_snapshot_id),
  FOREIGN KEY (
    country_code, package_id, package_schema_version, catalog_revision_id, evidence_rules_version
  ) REFERENCES installed_city_package_manifests (
    country_code, package_id, package_schema_version, catalog_revision_id, evidence_rules_version
  )
);

CREATE TABLE IF NOT EXISTS city_frontier_revisions (
  id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('working', 'terminal')),
  predecessor_id TEXT REFERENCES city_frontier_revisions(id),
  ranking_snapshot_id TEXT NOT NULL REFERENCES city_ranking_snapshots(id),
  operation_kind TEXT NOT NULL CHECK (operation_kind IN ('start', 'city_completed')),
  command_id TEXT NOT NULL,
  schema_version TEXT NOT NULL CHECK (schema_version = 'city-frontier@1'),
  command_json TEXT NOT NULL,
  command_hash TEXT NOT NULL CHECK (
    length(command_hash) = 64 AND command_hash NOT GLOB '*[^0-9a-f]*'
  ),
  payload_json TEXT NOT NULL,
  payload_hash TEXT NOT NULL CHECK (
    length(payload_hash) = 64 AND payload_hash NOT GLOB '*[^0-9a-f]*'
  ),
  hmac TEXT NOT NULL CHECK (
    length(hmac) = 64 AND hmac NOT GLOB '*[^0-9a-f]*'
  ),
  created_at TEXT NOT NULL,
  CHECK (
    (operation_kind = 'start' AND predecessor_id IS NULL)
    OR (operation_kind = 'city_completed' AND predecessor_id IS NOT NULL)
  ),
  CHECK (predecessor_id IS NULL OR predecessor_id <> id)
);
```

`lowercase-hex64` expands exactly to
`length(column) = 64 AND column NOT GLOB '*[^0-9a-f]*'`. Exact named indexes are:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS city_branch_commits_pre_city_source
ON city_branch_commits (resolved_country_shortlist_revision_id, country_code)
WHERE kind = 'pre_city';
CREATE UNIQUE INDEX IF NOT EXISTS city_branch_commits_one_selection
ON city_branch_commits (selection_snapshot_id) WHERE kind = 'selection';
CREATE UNIQUE INDEX IF NOT EXISTS city_ranking_snapshots_one_run
ON city_ranking_snapshots (run_id);
CREATE UNIQUE INDEX IF NOT EXISTS city_frontier_revisions_one_root
ON city_frontier_revisions (run_id) WHERE predecessor_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS city_frontier_revisions_one_successor
ON city_frontier_revisions (predecessor_id) WHERE predecessor_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS city_frontier_revisions_one_command
ON city_frontier_revisions (run_id, command_id);
CREATE UNIQUE INDEX IF NOT EXISTS city_frontier_revisions_one_start_command
ON city_frontier_revisions (command_id) WHERE operation_kind = 'start';
CREATE UNIQUE INDEX IF NOT EXISTS city_frontier_revisions_one_terminal
ON city_frontier_revisions (run_id) WHERE kind = 'terminal';
CREATE UNIQUE INDEX IF NOT EXISTS city_selection_snapshots_one_command
ON city_selection_snapshots (run_id, command_id);
```

The ten immutable triggers are `<table>_no_update` and `<table>_no_delete` for each exact table, with
errors respectively `city_criteria_snapshot_is_immutable`, `city_branch_commit_is_immutable`,
`city_ranking_snapshot_is_immutable`, `city_frontier_revision_is_immutable` and
`city_selection_snapshot_is_immutable`. Add the eleventh exact
`city_frontier_revisions_no_successor_after_terminal` `BEFORE INSERT` trigger; when `NEW.predecessor_id` names a
terminal row it raises `city_frontier_terminal_has_no_successor`.

```text
city_criteria_snapshots_no_update / city_criteria_snapshots_no_delete
  -> city_criteria_snapshot_is_immutable
city_branch_commits_no_update / city_branch_commits_no_delete
  -> city_branch_commit_is_immutable
city_ranking_snapshots_no_update / city_ranking_snapshots_no_delete
  -> city_ranking_snapshot_is_immutable
city_frontier_revisions_no_update / city_frontier_revisions_no_delete
  -> city_frontier_revision_is_immutable
city_selection_snapshots_no_update / city_selection_snapshots_no_delete
  -> city_selection_snapshot_is_immutable
city_frontier_revisions_no_successor_after_terminal
  -> city_frontier_terminal_has_no_successor
```

Exact trigger SQL is:

```sql
CREATE TRIGGER IF NOT EXISTS city_criteria_snapshots_no_update
BEFORE UPDATE ON city_criteria_snapshots
BEGIN SELECT RAISE(ABORT, 'city_criteria_snapshot_is_immutable'); END;
CREATE TRIGGER IF NOT EXISTS city_criteria_snapshots_no_delete
BEFORE DELETE ON city_criteria_snapshots
BEGIN SELECT RAISE(ABORT, 'city_criteria_snapshot_is_immutable'); END;
CREATE TRIGGER IF NOT EXISTS city_branch_commits_no_update
BEFORE UPDATE ON city_branch_commits
BEGIN SELECT RAISE(ABORT, 'city_branch_commit_is_immutable'); END;
CREATE TRIGGER IF NOT EXISTS city_branch_commits_no_delete
BEFORE DELETE ON city_branch_commits
BEGIN SELECT RAISE(ABORT, 'city_branch_commit_is_immutable'); END;
CREATE TRIGGER IF NOT EXISTS city_ranking_snapshots_no_update
BEFORE UPDATE ON city_ranking_snapshots
BEGIN SELECT RAISE(ABORT, 'city_ranking_snapshot_is_immutable'); END;
CREATE TRIGGER IF NOT EXISTS city_ranking_snapshots_no_delete
BEFORE DELETE ON city_ranking_snapshots
BEGIN SELECT RAISE(ABORT, 'city_ranking_snapshot_is_immutable'); END;
CREATE TRIGGER IF NOT EXISTS city_frontier_revisions_no_update
BEFORE UPDATE ON city_frontier_revisions
BEGIN SELECT RAISE(ABORT, 'city_frontier_revision_is_immutable'); END;
CREATE TRIGGER IF NOT EXISTS city_frontier_revisions_no_delete
BEFORE DELETE ON city_frontier_revisions
BEGIN SELECT RAISE(ABORT, 'city_frontier_revision_is_immutable'); END;
CREATE TRIGGER IF NOT EXISTS city_selection_snapshots_no_update
BEFORE UPDATE ON city_selection_snapshots
BEGIN SELECT RAISE(ABORT, 'city_selection_snapshot_is_immutable'); END;
CREATE TRIGGER IF NOT EXISTS city_selection_snapshots_no_delete
BEFORE DELETE ON city_selection_snapshots
BEGIN SELECT RAISE(ABORT, 'city_selection_snapshot_is_immutable'); END;
CREATE TRIGGER IF NOT EXISTS city_frontier_revisions_no_successor_after_terminal
BEFORE INSERT ON city_frontier_revisions
WHEN NEW.predecessor_id IS NOT NULL AND EXISTS (
  SELECT 1 FROM city_frontier_revisions
  WHERE id = NEW.predecessor_id AND kind = 'terminal'
)
BEGIN SELECT RAISE(ABORT, 'city_frontier_terminal_has_no_successor'); END;
```

`db.ts` preflight enumerates the exact five table definitions, every named index and all ten immutable
triggers plus the terminal-successor trigger. It sets and verifies `PRAGMA foreign_keys = ON` before
preflight or any transaction. Preflight compares normalized table/trigger/index SQL plus ordered
`PRAGMA table_info`, `foreign_key_list` and `index_list/index_info`, and rejects any extra object whose
name starts with `city_criteria_`, `city_branch_`, `city_ranking_`, `city_frontier_` or
`city_selection_`. It also rejects every non-listed user index/trigger whose `tbl_name` is one of the
five exact tables regardless of object name. The only non-listed entries allowed on those tables are
SQLite-generated `sqlite_autoindex_*` rows with `sql IS NULL`; preflight verifies their PRAGMA
`origin/unique/columns` exactly for the declared primary keys/inline constraints. RED adds arbitrary-name
extra index and trigger cases. The composite Ranking FK also requires the already existing exact unique
index `installed_city_package_manifest_exact_key` on
`(country_code, package_id, package_schema_version, catalog_revision_id, evidence_rules_version)`;
preflight verifies its normalized SQL/PRAGMA columns before installing or opening Task 13, and any drift
is `database_schema_reset_required`. If the whole family is absent, install it atomically and reverify; if every object is
exact, open; any partial, extra, altered, orphaned or foreign-keys-off state is
`database_schema_reset_required`. Update all exact table inventories in the three named tests. FKs are
used where a scalar relation is representable; a Knowledge map is not denormalized merely to fabricate
per-member FKs.

- [ ] **Step 6: Implement canonical structural loaders and complete-chain verification**

Each loader first verifies private canonical bytes/hash/HMAC and every mirror/FK, then calls its
Decision/Application/Branch structural reconstruction boundary and returns a fresh frozen value.
`loadCriteriaVerified` calls `reconstructCityCriteriaSnapshot`; `loadRankingVerified` calls
`reconstructCityRankingSnapshot`; frontier loaders call `reconstructCityFrontierRevision`; branch load
derives and replays stored source through the verified country-resolution chain as specified in Step 2.
The same freshness/non-aliasing law covers every load/find, `appendRevision`, command replay,
`publishStart` and every nested result/array: outputs are fresh recursively frozen, do not alias inputs
or cached row objects, and are non-identical across calls while canonically equal.

Every full-chain/root load also follows the root's Ranking reference, structurally verifies that
Ranking and its Criteria, and calls the no-context exact historical
`CityCatalogStorePort.loadVerified(ranking.catalogRevisionId)`. It authenticates that Catalog bundle and
binds catalog ID, Registry ID, country, package ID and package schema to the Ranking and its full
installed context. It rebuilds the exact five-key `CityCriteriaCommandPayload` and raw hash, then
rebuilds the exact nine-key `CityFrontierRunIdentity` and derived run ID using the verified Catalog's
actual closed rules literal plus the Ranking's resolved source, country, Registry, full installed
context, ranker rules and budget. It derives the exact five-key Start intent from those recomputed
values and requires canonical equality with the stored root command envelope. The root operation's
Criteria hash, every revision run/Ranking binding, and the Ranking's run/context/source/rules/budget
mirrors must all equal that replay; no individually authentic, rehashed Criteria/Ranking/Catalog/root
drift survives. Both Catalog rules versions are loadable structurally for historical replay.

`loadRankingVerified(id)` takes no expected context. It authenticates the closed
`installedPackageContext`, all five mirrors and stored references, but does not rerank. Application reads
the returned context, resolves the exact installed package and calls
`verifyCityRankingSnapshotSemantics`. A structurally valid rehashed alternate order passes only the
structural layer and then fails Application semantics.

Every frontier load/find reads the complete run chain without `rowid` authority and verifies: exactly
one root; root has no predecessor and Start operation; every successor has the prior content ID,
prefix-plus-one marker, matching expected head and `city_completed` operation; one successor per node;
each `(runId, commandId)` occurs at most once while multiple distinct successor commands form the chain;
same run and Ranking throughout; marker counts/ranks progress exactly; timestamps
are nondecreasing; a terminal is final and has no successor; a working revision never has ten markers;
the requested head is the unique verified head. Visit every row for the run exactly once from the root:
no disconnected component, cycle, duplicate visit, cross-run/cross-Ranking edge or non-root without
exactly one predecessor is accepted. A corrupt ancestor poisons all four loaders even when the requested
row itself authenticates. This is topology/Task 12 structure only; Application still replays Task 11
and Knowledge/Evidence after load.
`loadChainVerified` returns a fresh recursively frozen root→successor→unique-head array produced by
that visited traversal. RED inserts authentic rows in reverse physical order through fixture setup and
requires the same canonical chain; neither `rowid` nor query order may leak into authority.
`findCommandVerified` throws `city_frontier_not_found` when the run has no rows, verifies the complete
existing run before lookup, and returns `undefined` only when the command is absent from that verified
run. Any row/envelope/topology drift remains `integrity_mismatch`.

- [ ] **Step 7: Implement append and atomic Start with exact replay/race normalization**

Before SQL, `publishStart` descriptor-owns the exact six-key publication and validates all four
structural artifacts plus their graph. It requires: the Criteria payload hash and timestamp-free intent;
the claimed run/intent/root equations; root Start operation and command;
`root.operation.criteriaPayloadHash` equal to the helper result; deterministic parent source replay and
time equation; Ranking top-level/context/
Criteria/pre-city/run bindings; equal `startAt` across Criteria, Ranking assessment/creation and root;
zero-marker root; and the claimed ranking/budget literals. Reject this caller-owned pure structural
candidate graph before opening a transaction. The publication carries no Catalog authority, so no
pre-SQL step may claim its rules are authenticated.

Then one `BEGIN IMMEDIATE` transaction performs this order:

1. Look up `root.operation.commandId` globally among Start rows before any run-scoped read or insert.
2. Even on a command hit, authenticate the candidate Ranking's referenced Catalog. Bind Catalog ID,
   Registry, country, package and schema, use its actual rules to recompute the candidate's exact
   Criteria hash, run identity/run ID and Start intent, and require canonical equality with every
   claimed candidate field. This catches a forged candidate context that merely copied a stored intent
   and occurs before intent comparison, replay return, derived-run root lookup or insert.
3. On a command hit, compare the now-derived candidate intent with the stored canonical intent. Drift—
   including a different derived run from country, resolved revision, Criteria, Registry/package or
   budget or `@1 ↔ @2` rules—is `integrity_mismatch`. Only after exact intent equality fully load the
   stored winner, including its own Catalog/identity replay, and require both candidate and winner rules
   to equal `CITY_CATALOG_RULES_VERSION`; exact `@1` replay is `city_catalog_upgrade_required`. Then
   return its Criteria/parent/Ranking/root even when the retry generated later time-bound candidates.
   On a miss, require the candidate rules to equal `CITY_CATALOG_RULES_VERSION` before the next step.
4. Before any artifact insert, query the derived run root and fully verify it if present. An existing
   root under a different Start command is `integrity_mismatch` with zero Criteria/parent/Ranking write;
   only an absent root proceeds.
5. Exact-replay or insert Criteria, deterministic pre-city parent, Ranking and root in that order,
   reloading each through its structural boundary. A pre-existing exact shared parent is reuse, not
   partial success, and remains if a later candidate transaction rolls back.
6. Reload all four artifacts and return exactly `CityFrontierStartPublicationResult`; never assemble a
   read model in SQLite.

`appendRevision({ revision })` structurally reconstructs only the owned candidate and validates its
local scalars/content ID/operation/claimed predecessor fields before SQL; complete persisted topology
cannot be authorized from caller data. It then begins immediate, resolves the stored command first, and
on a command hit first compares the exact candidate operation to the stored operation; any drift is
`integrity_mismatch`. Only an exact hit or command miss then loads/verifies the referenced complete
chain/head and authenticated Catalog before returning, applying stale logic or inserting. It requires
that Catalog rules equal `CITY_CATALOG_RULES_VERSION`; a structurally valid historical
`city-catalog@1` run is presentable but direct append—including an exact committed-command hit—fails
`city_catalog_upgrade_required` with zero insert. Exact current-rules committed command returns
`{ operation, revision }` internally and the port returns
its revision; same key with drift is `integrity_mismatch`. After command-first replay, only a candidate
whose expected predecessor is an authenticated same-run/same-Ranking ancestor but is not the unique
current head becomes `stale_city_frontier_head`. A forged, missing, cross-run, cross-Ranking or otherwise
misbound predecessor is `integrity_mismatch`. Start conflicts, row tamper, binding failure, busy/native failures and
unrelated constraints are never relabeled as stale or not-found. Do not catch all SQLite constraints.

Application calls Task 11 and all Criteria/Ranking/Knowledge/Evidence semantic gates before sealing and
passing a revision. The store repeats only structural/content/topology checks. After load, Application
repeats all semantic gates before returning a rich model. The immutable referenced rows make this
split safe without holding SQLite across evaluator or Evidence callbacks.

- [ ] **Step 8: Run GREEN, non-neural gates and commit**

```bash
./node_modules/.bin/vitest run tests/application/city-frontier-identity.test.ts \
  tests/domain/city-criteria.test.ts tests/branch/city.test.ts
./node_modules/.bin/vitest run tests/integration/city-frontier-store.test.ts \
  tests/integration/database-schema.test.ts tests/integration/confirmed-life.test.ts \
  tests/branch/life-git.test.ts
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/eslint src/application/city-data-contracts.ts \
  src/application/city-frontier-contracts.ts src/decision/city-criteria.ts \
  src/infrastructure/sqlite/city-{criteria,frontier,branch}-store.ts \
  src/infrastructure/sqlite/db.ts \
  tests/application/city-frontier-identity.test.ts tests/domain/city-criteria.test.ts \
  tests/integration/city-frontier-store.test.ts \
  tests/support/city-frontier-publication-worker.ts \
  tests/integration/database-schema.test.ts tests/integration/confirmed-life.test.ts \
  tests/branch/city.test.ts tests/branch/life-git.test.ts
git diff --check
! rg -n -i 'openai|anthropic|gemini|langchain|llamaindex|llm[_-]?|model[_-]?name' \
  src/application/city-data-contracts.ts src/application/city-frontier-contracts.ts \
  src/decision/city-criteria.ts src/infrastructure/sqlite/city-{criteria,frontier,branch}-store.ts \
  src/infrastructure/sqlite/db.ts \
  tests/application/city-frontier-identity.test.ts tests/domain/city-criteria.test.ts \
  tests/integration/city-frontier-store.test.ts tests/support/city-frontier-publication-worker.ts \
  tests/integration/database-schema.test.ts tests/integration/confirmed-life.test.ts \
  tests/branch/city.test.ts tests/branch/life-git.test.ts
git add src/application/city-data-contracts.ts \
  src/application/city-frontier-contracts.ts src/decision/city-criteria.ts \
  src/infrastructure/sqlite/city-criteria-store.ts \
  src/infrastructure/sqlite/city-frontier-store.ts \
  src/infrastructure/sqlite/city-branch-store.ts src/infrastructure/sqlite/schema.sql \
  src/infrastructure/sqlite/db.ts tests/integration/city-frontier-store.test.ts \
  tests/application/city-frontier-identity.test.ts tests/domain/city-criteria.test.ts \
  tests/support/city-frontier-publication-worker.ts tests/integration/database-schema.test.ts \
  tests/integration/confirmed-life.test.ts tests/branch/city.test.ts tests/branch/life-git.test.ts
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
- Modify: `src/infrastructure/sqlite/city-package-manifest-store.ts`
- Modify: `src/infrastructure/sources/installed-city-packages.ts`
- Modify: `src/infrastructure/sqlite/city-evidence-store.ts`
- Modify: `src/application/replay-city-evidence.ts`
- Modify: `src/infrastructure/sqlite/city-knowledge-store.ts`
- Modify: `tests/integration/city-package-manifest-store.test.ts`
- Modify: `tests/integration/city-evidence-store.test.ts`
- Modify: `tests/integration/city-evidence-replay.test.ts`
- Modify: `tests/integration/city-knowledge-store.test.ts`
- Modify: `src/infrastructure/composition-root.ts`

**Interfaces:**

```ts
export interface StartCityFrontierInput {
  readonly resolvedCountryShortlistRevisionId: string;
  readonly countryCode: string;
  readonly criteriaDraft: readonly [
    CityCriterionDraft,
    CityCriterionDraft,
    CityCriterionDraft,
    CityCriterionDraft,
  ];
  readonly commandId: string;
}

export interface PrepareCityFrontierContinuationInput {
  readonly runId: string;
  readonly expectedRevisionId: string;
  readonly commandId: string;
}

export interface CityFrontierSetupReadModel {
  readonly resolvedCountryShortlistRevisionId: string;
  readonly countryCode: string;
  readonly profileSnapshotId: string;
  readonly preferenceProfileSnapshotId: string;
  readonly resolvedCountryEntry: PreCityResolvedCountryEntryProjection;
  readonly installedPackageContext: InstalledCityPackageExactKey;
  readonly registryRevisionId: string;
  readonly catalogMemberCount: number;
  readonly catalogCoverage: CityCatalogRevision["coverage"];
  readonly criterionDefinitions: InstalledCityCriterionDefinitionTuple;
  readonly criteriaDraft: readonly [
    CityCriterionDraft,
    CityCriterionDraft,
    CityCriterionDraft,
    CityCriterionDraft,
  ];
}

export interface CityFrontierPrepared {
  readonly schemaVersion: "city-frontier-prepared@1";
  readonly runId: string;
  readonly baseRevisionId: string;
  readonly rankingSnapshotId: string;
  readonly nextUncheckedRank: number;
  readonly commandId: string;
}

export interface CityFrontierApplication {
  presentCityFrontierSetup(input: {
    readonly resolvedCountryShortlistRevisionId: string;
    readonly countryCode: string;
  }): Promise<CityFrontierSetupReadModel>;
  startCityFrontier(input: StartCityFrontierInput): Promise<CityFrontierReadModel>;
  prepareCityFrontierContinuation(
    input: PrepareCityFrontierContinuationInput,
  ): Promise<CityFrontierPrepared>;
  continueCityFrontier(
    prepared: CityFrontierPrepared,
    emit: (event: CityFrontierEvent) => void | Promise<void>,
    signal: AbortSignal,
  ): Promise<CityFrontierReadModel>;
  presentCityFrontier(runId: string): Promise<CityFrontierReadModel>;
}
```

The setup read model contains the verified country entry, installed package/definition metadata and a
four-criterion draft derived from the exact relocation and Preference Profile snapshots bound by the
resolved-country source; it performs no HTTP. Start and Prepare accept exactly the public keys shown
above; extra client run, snapshot, clock, package, parent, ranking, fact or digest authority is rejected.
Prepared continuation contains only the six exact server-verified fields shown above. Prepare does not
load Ranking or derive active-city/check/source context; Continue reloads head plus Ranking, derives
those values and revalidates them. HTTP bodies never carry facts or ranking data. Both DTOs are closed,
fresh recursively frozen and contain no raw Research/HTTP or database object. Setup requires
`catalogMemberCount === verifiedCatalog.members.length` as a safe integer `0..100` and copies the exact
fresh frozen closed `verifiedCatalog.coverage`; it exposes neither full catalog root nor raw package.
Application receives Task 13's
`CitySelectionHistoryReadPort` from composition and always assembles the exact rich read model; before
Task 15, the injected implementation returns a fresh frozen empty array rather than a hardcoded future
history in the use case.

**Offline-installation port amendment (2026-08-24):** latest installed-root reads use the separately
injected `InstalledCityCatalogReadPort.latestInstalledVerified(countryCode)`. Exact historical reads
continue to use `CityCatalogStorePort.loadVerified(id)`. Core composition injects both inward ports and
never obtains latest state from raw Catalog rows.

- [ ] **Step 1: Write Start/Present RED tests**

Assert setup and Start reject automatic/working/empty/tampered/effective-red inputs; accepted
formal-yellow effective-green setup; exact installed definitions/default draft; exact relocation +
Preference Profile IDs from source binding; exact Registry/catalog identity, Catalog
`schemaVersion === "city-catalog@1"`, `rulesVersion === CITY_CATALOG_RULES_VERSION` and at-most-100 membership
and coordinates; confirmed criteria; deterministic pre-city parent created from the verified plain
`PreCityBranchSourceProjection` and replayed against that same source; frozen ranking bound to
`city-frontier-budget@1` (`10` completed / target `3`); zero official/search calls; injected failure
after each Start insert leaves zero partial rows; exact retry converges; two canonical presentations
with zero source/request-step/search calls; exact four-fact accepted/reviewed-link marker projections;
exact `lastCheckedAt`, raw 64-hex marker digest and verified selection/branch history after reload.
Compile/runtime-pin the exact Start/Prepare keys. Pin the exact Criteria payload hash, deterministic run
ID and timestamp-free Start intent, and require one `startAt` after all verified inputs. Require
`criteria.confirmedAt = ranking.assessmentAt = ranking.createdAt = root.createdAt = startAt`, while
`preCityBranch.createdAt = resolvedSnapshot.createdAt <= startAt`. Prove source-key parent lookup/replay
happens before Ranking seal; retries and two races that obtain different clocks still use byte-identical
parent bytes/ID. Require `publishStart` to return the granular four-artifact result and Application to
assemble the rich model only after semantic reload. The initial selection-history adapter is called and
returns a fresh frozen empty list; no hardcoded `selections: []` path exists.
Pin Setup's exact key set, `catalogMemberCount === verifiedCatalog.members.length` as safe `0..100`,
and exact fresh closed coverage equality; count/coverage drift or aliasing fails before return.
For Start reload and both presentations, rehash one otherwise authentic Criteria/Ranking/root cross-row
identity and require rejection before read-model projection with zero source/network call.
For Continue and both presentations, independently reconstruct the raw four facts/links from exact
Knowledge plus replayed Evidence, project frozen Ranking assessment/ordered/screened IDs, and call
Task 11 with verified Criteria/evaluators and the exact predecessor marker list. Mutate every authority
ID/time/fact/link, evaluator-derived mismatch/coverage/warning/color, digest and predecessor binding;
reject before append/presentation and perform zero source/search/document call during reload. An installed package whose Catalog uses
`LEGACY_CITY_CATALOG_RULES_VERSION` must fail Setup/Start as
`city_catalog_upgrade_required` before ranking, source calls or any Criteria/pre-city/Ranking/frontier
run row. No legacy-catalog-rules City run can be created. Continue also rejects an authentic bound `@1`
run as `city_catalog_upgrade_required` before recovery/source/append. Present instead accepts exact
installed historical manifests whose structurally authenticated Catalog rules are `@1 | @2`, reruns the
bound Catalog/Criteria/Ranking/Knowledge/Evidence/Task 11 semantics and returns a zero-network rich
model. An `@1` read model is audit-only: its `catalog.rulesVersion` lets Experience disable successful
Continue/Select affordances.

In the two newly modified installed-package files, make authenticated read reconstruction version-
neutral over the closed `@1 | @2` Catalog union. `loadExactVerified` and `loadCurrentVerified` must be
able to verify a persisted chain containing legacy predecessors; `findReady`, `findExact`,
`loadExactReplayContract` and `latestInstalledVerified` may therefore surface an authentic `@1` value
so the owning Application boundary can classify it. Unknown rules remain `integrity_mismatch`. Keep
`@2` enforcement at write/use boundaries: manifest append/installer, `publishStart`, direct Frontier
append, Continue and Select. RED persists a mixed legacy-root→current-head manifest chain, proves exact
legacy and current/head reads both work, proves latest/current lookup is not poisoned, and proves an
attempted `@1` manifest append still fails without a row.

Apply the same split to the existing Evidence/Knowledge replay chain. Authenticated
`city-evidence-store` load, `replay-city-evidence` and `city-knowledge-store` load paths accept the
exact Catalog rules already bound by the historical package (`@1 | @2`), while
`CityEvidenceStore.seal` and `CityKnowledgeStore.publishFromEvidence` remain `@2`-only writes. One
end-to-end RED presents an authentic `@1` terminal through manifest → Evidence store/Application replay
→ Knowledge → semantic Ranking/Task 11 with zero source and zero durable write. Paired direct `@1`
Evidence seal and Knowledge publication probes fail `city_catalog_upgrade_required` before insert;
unknown rules fail `integrity_mismatch`.

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
`InstalledCityCatalogReadPort.latestInstalledVerified(countryCode)` projection. Require exact Registry ID,
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
./node_modules/.bin/vitest run tests/integration/city-frontier.test.ts \
  tests/integration/city-package-manifest-store.test.ts \
  tests/integration/city-evidence-store.test.ts \
  tests/integration/city-evidence-replay.test.ts \
  tests/integration/city-knowledge-store.test.ts
```

- [ ] **Step 3: Implement Start and graph verification**

First widen only the shared persisted-manifest chain reconstructor and authenticated read projections
to the known `@1 | @2` Catalog union. Do not leave a current-rules assertion buried in
`reconstructPersisted`, because that prevents an exact current head from loading when it has an
authentic legacy predecessor. Keep append validation explicitly `@2` and let each Application use case
apply its own gate: Setup/Start/Continue/Select require current rules, while Present accepts either
known literal. This read/write split never treats a structurally returned package as write authority.
Likewise move current-rules assertions out of shared authenticated Evidence/Knowledge load/replay and
onto their mutation boundaries. Evidence load/Application replay and Knowledge load accept only the
exact package-bound known literal; Evidence `seal` and Knowledge `publishFromEvidence` require current
rules before write. Present chains those read-only APIs and performs no repair publication for `@1`.

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
`InstalledCityCatalogReadPort.latestInstalledVerified(countryCode)`. Absence, a non-current root or any mismatch
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
case work. That guard returns the exact `ResolvedCountryShortlistSnapshot` and unique selected
`ResolvedCountryEntry`. Application verifies both exact profile IDs from the snapshot source and the
profile snapshots, then builds one fresh plain frozen `PreCityBranchSourceProjection` containing those
IDs, the resolved snapshot ID and the complete exact entry. Setup derives its draft only from those
snapshots and the frozen approved installed defaults. Start revalidates the entry/draft and both profile
IDs, loads current Knowledge and completes every semantic input check, then obtains exactly one
`startAt`. It constructs the exact five-key `CityCriteriaCommandPayload`, computes its raw payload hash,
constructs the exact run identity and derives the prefixed deterministic run ID, and constructs the
exact timestamp-free Start intent. It calls `createPreCityBranchCommit` with the verified source and
`createdAt: resolvedSnapshot.createdAt`, requires that time not exceed `startAt`, and performs the
source-key structural `findPreCityBranchBySourceVerified` load/replay before sealing Ranking. A missing
parent uses the deterministic
candidate; an existing parent must canonically equal it. A concurrent winner is resolved by Task 13's
same stored-source replay, never by resealing Ranking with a new parent or clock. Start then ranks only
the verified catalog members/coordinates outside SQLite. Setup returns the initial gate's server-derived
`installedPackageContext` with the installed metadata; Start consumes the same gate result and never
accepts a client context or reconstructs one after profile/Knowledge work. The frozen Ranking snapshot
stores that exact already verified context, and its top-level country/package/schema/catalog fields
equal the first four context fields while its separate `rulesVersion` remains `city-ranker@1`. Start structurally reconstructs
the sealed Ranking and calls `verifyCityRankingSnapshotSemantics` with the verified Registry/catalog,
confirmed Criteria, exact Knowledge projections and installed evaluator registry before persistence.
Require `criteria.confirmedAt = ranking.assessmentAt = ranking.createdAt = root.createdAt = startAt`.
Then root creation uses `sealCityFrontierRevision` over the Task 11 zero-marker projection, with its
Start operation carrying the client command and exact Criteria payload hash. One Application-owned
`publishStart` port uses a single immediate transaction to exact-replay or insert Criteria, pre-city
parent, Ranking and frontier root atomically and returns the granular four-artifact result. Application
canonical-compares that result, structurally reloads it, repeats evaluator Criteria, semantic Ranking,
Task 11 and source/Knowledge/Evidence guards, independently rebuilds the exact Criteria payload hash,
run identity/run ID and five-key Start intent from the reloaded Criteria/Ranking/root and requires all
cross-row bindings plus stored command-envelope equality, reads verified selection history, and only
then assembles the rich `CityFrontierReadModel`.
Presentation first obtains the structurally verified Ranking through `loadRankingVerified(id)`, then
uses its returned manifest context to resolve the exact installed package/catalog/criteria/Knowledge
inputs, requires the manifest package schema to equal its signed package definition, requires every
reconstructed/authoritative Catalog to retain schema `"city-catalog@1"` and the exact authenticated
closed `LEGACY_CITY_CATALOG_RULES_VERSION | CITY_CATALOG_RULES_VERSION` literal bound into the run
identity, and calls
`verifyCityRankingSnapshotSemantics` before projecting a read model. It also
reconstructs Registry identity, both profile bindings, every exact source and selection/branch history
without network. The legacy result is audit-only and is not authority to Continue or Select.
For each pair from the structurally verified ordered history port, Presentation resolves the exact
historical package, repeats the semantic source-parent/terminal/Ranking/Criteria/Knowledge/Evidence and
Task 11 frontier graph, reruns pure selection from the persisted city plus optional warning request,
then calls `reconstructCitySelectionWithBranch` and requires canonical equality. Any drift rejects the
whole rich model with zero official/search network; no structural pair alone enters `selections`.

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

Add a fresh HTTP Prepare+Continue retry after an earlier identical command produced a working winner,
and another after it produced a terminal winner. Prepare must find the committed command before testing
the current head, recover the original base and return the exact six-key value; Continue semantically
replays the winner with zero source call and no duplicate event. Mutated expected base/operation is
`integrity_mismatch`.

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
single-flight, callback or source access. Present exact-loads the same historically bound package,
replays its Catalog/Criteria/Ranking/Knowledge/Evidence/Task 11 semantics with zero source/network and
returns an audit-only rich model whose Catalog still exposes `@1`; a missing or drifted exact package
fails closed.
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

Every frontier value used by Continue or Present first passes
`reconstructCityFrontierRevision(value, integrity)` at the Task 12 structural boundary, then the exact
Task 11 Knowledge/Evidence/Criteria semantic reconstruction described below. Structural success or a
valid signed row never authorizes marker policy by itself.

`prepareCityFrontierContinuation` first descriptor-owns/closes and scalar-validates the exact
three-key input, then calls `findCommandVerified(runId, commandId)` before any head lookup. On a hit it
requires a `city_completed` operation whose `expectedHeadRevisionId === input.expectedRevisionId`,
structurally loads and verifies that base revision, and derives the exact six-key Prepared value from
the base even if the committed winner has since made the current head terminal. On a miss it loads the
unique head, requires a working head whose ID equals `input.expectedRevisionId`, and derives the same
six-key value from that head. Prepare may call only these no-context frontier loaders; it must not load
Ranking or derive active city/rank/check ID, prefetch completed Evidence/check, replay Task 7,
read/write Knowledge, resolve a package, install single-flight or invoke an event/source callback.
`continueCityFrontier` revalidates rather than trusting that prepared object, so the order below applies
across the complete Prepare+Continue attempt.

Continue first descriptor-owns/closes and scalar-validates the exact six-key Prepared value, including
schema, IDs, positive safe next rank and no symbols/accessors/proxy/custom prototype. Only then it calls
`findCommandVerified(runId, commandId)`. On a command hit it structurally loads the prepared base
revision and requires exact base run/Ranking/next-rank equations. A committed `city_completed`
operation must have `expectedHeadRevisionId === prepared.baseRevisionId` and exact command; drift is
`integrity_mismatch`. It does not yet run semantic replay or return. Only an absent command loads the
no-context `loadHeadVerified(runId)`, requires a working head whose ID equals
`prepared.baseRevisionId`, validates the ten-marker ceiling and `prepared.nextUncheckedRank`, then
checks abort. Both branches next call exactly `loadRankingVerified(base.rankingSnapshotId)` with no
caller context, verify the returned snapshot ID/run/revision binding and read its structurally verified
`installedPackageContext`. These base/head/Ranking operations are the only reads permitted before the
common historical package gate. Continue takes the lookup
key solely as `ranking.installedPackageContext` and passes that exact closed object to the inward
`InstalledCityPackageLookupPort.findExact`; it neither rebuilds the key from individual run/head fields
nor reruns the country-only availability, `findReady` or `latestInstalledVerified` path. A later package
definition must not reinterpret a frozen run. Both hit and miss traverse the same exact package/Catalog
authentication below and require current rules before any Criteria/evaluator/Knowledge/Evidence/Task 11,
event or source callback. After that complete semantic gate, a command hit returns the committed
working-or-terminal rich model with zero source/event/append; only a miss continues.
Only after Ranking semantic verification on that miss does Continue derive the active city, rank and deterministic
`cityCheckRunId`; none are trusted from Prepared. RED covers committed retries whose winner left a
working head and whose winner terminalized the run, both returning the same semantic model without
source access.
Bounded RED mutates Prepared schema, Ranking ID and next rank on committed replay and requires
`integrity_mismatch` with zero source call. A matching Prepared for an exact committed `@1` command
fails `city_catalog_upgrade_required` at the common Catalog gate with zero semantic/source/event/append
callback.

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
adapter. Composition injects the inward `InstalledCityCatalogReadPort` for latest installed-root reads
and `CityCatalogStorePort` for exact historical reads; Application knows no SQLite type, and neither
port is added to the City
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
replacement signature. Publish all four Knowledge facts, reconstruct the fresh Knowledge revision and
build one plain `CityMarkerAuthorityProjection` from its IDs/`lastCheckedAt` plus the four raw facts.
Attach accepted fixed-source claim links and reviewed blocker links only from the verified generic
Evidence projection; map safety accepted/reviewed links only from the verified safety Evidence replay.
The authority contains no ready mismatch, coverage, warning, status or visual color.

Project `CityFrontierRankingProjection` exactly from the already semantically verified frozen Ranking
`assessmentAt`, ordered IDs and screened-exclusion IDs. Pass it with verified Criteria/evaluators,
`predecessorMarkers: []` for the first successor or the exact current-head markers thereafter.
Call `reconstructCityLiveMarker` with that assessment, verified Criteria/evaluators, next frozen rank,
authority and no `persisted` marker. Decision derives the effective facts, mismatch, weighted coverage,
warnings and green/yellow/red marker. Compute `cityLiveMarkerDigest(marker, integrity)`, create the
binding, then call `reconstructCityFrontier` against the would-be persisted projection; frontier reruns
marker reconstruction for every binding and derives the exact three-way terminal reason. Presentation
and recovery rebuild the authority from verified persisted Knowledge/Evidence, verify each persisted
marker through `reconstructCityLiveMarker`, recompute its digest, then reconstruct the frontier with
zero network; they never trust marker facts or digest merely because a frontier row is signed.

Seal the Task 11 would-be successor through `sealCityFrontierRevision`, append that verified revision,
emit the committed marker, construct the verified
working-or-terminal read model, emit exactly one
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
  tests/integration/city-package-manifest-store.test.ts \
  tests/integration/city-evidence-store.test.ts \
  tests/integration/city-evidence-replay.test.ts \
  tests/integration/city-knowledge-store.test.ts \
  tests/integration/country-resolution.test.ts
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/eslint src/application/city-{frontier,verifier}.ts \
  src/application/replay-city-evidence.ts \
  src/infrastructure/city-{frontier-composition,verifier-adapter}.ts \
  src/infrastructure/composition-root.ts \
  src/infrastructure/sqlite/city-{package-manifest,evidence,knowledge}-store.ts \
  src/infrastructure/sources/{installed-city-packages,slovenia-city-source-adapter}.ts \
  tests/integration/city-frontier.test.ts \
  tests/integration/city-package-manifest-store.test.ts \
  tests/integration/city-evidence-store.test.ts \
  tests/integration/city-evidence-replay.test.ts \
  tests/integration/city-knowledge-store.test.ts
git diff --check
git add src/application/city-frontier.ts src/application/city-verifier.ts \
  src/infrastructure/city-frontier-composition.ts \
  src/infrastructure/city-verifier-adapter.ts \
  src/application/replay-city-evidence.ts \
  src/infrastructure/sqlite/city-package-manifest-store.ts \
  src/infrastructure/sqlite/city-evidence-store.ts \
  src/infrastructure/sqlite/city-knowledge-store.ts \
  src/infrastructure/sources/installed-city-packages.ts \
  src/infrastructure/sources/slovenia-city-source-adapter.ts \
  src/infrastructure/composition-root.ts \
  tests/integration/city-frontier.test.ts \
  tests/integration/city-package-manifest-store.test.ts \
  tests/integration/city-evidence-store.test.ts \
  tests/integration/city-evidence-replay.test.ts \
  tests/integration/city-knowledge-store.test.ts
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
export interface SelectCityInput {
  readonly terminalCityShortlistSnapshotId: string;
  readonly cityId: string;
  readonly commandId: string;
  readonly warningCopyVersion?: "city-unknown-risk@1";
}

export interface CitySelectionApplication {
  selectCity(input: SelectCityInput): Promise<{
    readonly selection: CitySelectionSnapshot;
    readonly commit: CityBranchCommit;
    readonly readModel: CityFrontierReadModel;
  }>;
}

export interface CitySelectionCommandIntent {
  readonly terminalCityShortlistSnapshotId: string;
  readonly cityId: string;
  readonly warningCopyVersion?: "city-unknown-risk@1";
}

export interface CitySelectionPublication {
  readonly commandId: string;
  readonly intent: CitySelectionCommandIntent;
  readonly pair: CitySelectionWithBranch;
}

export interface CitySelectionReadPort extends CitySelectionHistoryReadPort {
  loadSelectionWithBranchVerified(
    citySelectionSnapshotId: string,
  ): Promise<CitySelectionWithBranch>;
}

export interface CitySelectionWriterPort extends CitySelectionReadPort {
  publishSelection(
    input: CitySelectionPublication,
  ): Promise<CitySelectionWithBranch>;
}
```

- [ ] **Step 1: Write selection/atomicity RED tests**

Accept only the exact `SelectCityInput` keys; accept a terminal selectable city with 0 or nonzero warnings; reject working/empty/missing/excluded/tampered city, wrong copy-version presence/value and client `runId`, basis or parent fields. After the Application command envelope is removed, compile/runtime-pin the pure request to exactly `{ cityId, warningCopyVersion? }`; reject terminal ID, command ID, digest, facts, basis, links and parent on that nested surface. Require `reconstructCitySelection` to return the exact fresh terminal entry plus transient reviewed links flattened from the selected marker in four-fact/link occurrence order without deduplication. Derive `runId` from the verified terminal snapshot before command lookup. Assert idempotency is keyed by that derived `runId + commandId`: an identical canonical remainder `{ terminalCityShortlistSnapshotId, cityId, warningCopyVersion? }` returns both prior rows, while the same key with any changed remainder conflicts. Inject failure before either insert and verify neither row exists. Returned/presented read models contain verified sibling selection/branch history. Cover `loadSelectionWithBranchVerified(citySelectionSnapshotId)` success, missing ID, duplicate or mismatched selection/commit rows, tampered root/context bindings and fresh frozen copies; the lookup must not accept `runId` or browser-supplied context as authority.

An authentic audit-only terminal whose bound Catalog rules are `city-catalog@1` fails
`city_catalog_upgrade_required` immediately after exact package/Catalog authentication and before
Criteria/evaluator, Knowledge/Evidence, semantic Ranking, Task 11, pair construction or writer
invocation; pin those counters at zero. The writer independently exact-loads the referenced Catalog and enforces
current rules before replay/insert, so a forged direct publication cannot bypass the Application gate.
Cover both a command miss and an exact stored-command hit on `@1`; neither returns a pair or inserts,
and both fail `city_catalog_upgrade_required` with wrapper/writer-write counters at zero.

Compile/runtime-pin `createCitySelectionWithBranch` as the only Task 15 construction path after the
fresh Task 11 selection projection, and `reconstructCitySelectionWithBranch` as the final loaded-pair
authority check after the exact terminal/ranking/pre-city graph is loaded. Neither Select nor the
writer assembles or accepts independently authoritative Selection/Branch literals.
Insert siblings in reverse physical order, including equal timestamps, and require both the structural
history port and semantically verified rich presentation to use the exact total order
`selection.createdAt ASC, selection.id ASC`. Inject evaluator, Knowledge, Evidence and Task 11 spies
and statically pin imports: Application invokes them before construction and after structural reload;
`city-selection-writer.ts` invokes none of them and accepts only the exact timestamp-free command
intent plus the already constructed pair. Descriptor-own/exact-key pin the explicit intent interface;
future public Select fields cannot silently enter command equality.

- [ ] **Step 2: Run RED**

```bash
./node_modules/.bin/vitest run tests/integration/city-selection.test.ts
```

- [ ] **Step 3: Implement the atomic writer over the existing tables**

Use the Task 13 `city_selection_snapshots` and `city_branch_commits` schemas. Verify mirrored
context/marker/pair fields through Task 12 structural replay; separately verify command identity and
idempotency through the writer-owned timestamp-free command envelope. Require
`parent_id = forked_from`, exact selection FK and the same country/profile context as the verified
`pre_city` parent. A selection-kind City Branch row is never accepted or persisted independently from
its Selection snapshot. The writer accepts exactly `CitySelectionPublication`, not a Task 11 projection,
evaluator registry, Knowledge/Evidence graph, digest proof or caller-assembled authority DTO.

- [ ] **Step 4: Implement one atomic writer transaction**

Application `selectCity` first structurally loads the complete terminal chain and the minimum
Ranking/pre-city references needed to exact-load and authenticate the historical package/Registry/
Catalog. Immediately after that Catalog authentication—and before Application Criteria/evaluator,
Knowledge, Evidence, semantic Ranking, Task 11, wrapper or writer callbacks—it requires the exact bound
Catalog rules to equal `CITY_CATALOG_RULES_VERSION`; `@1` is audit-only and fails
`city_catalog_upgrade_required`. Only the current-rules path loads/reconstructs Criteria, semantic
Ranking and every Knowledge/Evidence marker authority, recomputes digests, and reruns Task 11 frontier
reconstruction. It then calls `reconstructCitySelection` with only the exact city/version
request. Application rebuilds the exact resolved-country/profile source through the full semantic guard,
source-replays the parent, and passes that fresh parent, the fresh selection projection, the verified
terminal/ranking authority, client command ID and one server creation time to
`createCitySelectionWithBranch`. The wrapper maps
`entry.cityId/markerDigest/knowledgeRevisionId/evidenceSnapshotId/unknownBasis` and optional version to
the Selection Snapshot, derives the exact parent/fork/context and invokes the pure Branch helper.
`reviewedSourceLinks` is a verified transient result for presentation/command binding and is not
persisted as a second array. It builds exact `CitySelectionPublication` with the timestamp-free intent
and calls the writer.

Before SQL the writer owns/closes the exact publication and its pure preflight requires
`pair.selection.commandId === publication.commandId`, derives
the run ID from the sealed pair, and requires exact intent-to-selection equality for terminal revision,
city and optional warning-copy presence/value. Outer command/intent drift is `integrity_mismatch` with
zero inserts and zero semantic callbacks. It then begins immediate; lookup by
`(derived pair.selection.runId, commandId)` is the first SQL action. Changed stored intent is
`integrity_mismatch`. For an exact command hit it authenticates the stored pair's referenced Catalog;
for a miss it authenticates the candidate pair's referenced Catalog. It rejects `@1` as
`city_catalog_upgrade_required` before returning replay, loading further run rows or inserting. Both
current-rules hit and miss paths then load all immutable structural terminal/Ranking/pre-city/reference
rows, derive the stored pre-city source
through Task 13's country-resolution-chain adapter, calls Task 12 structural
`reconstructCitySelectionWithBranch`, and verify mirrors/FKs/pair topology. A hit applies those checks to
the stored pair and only then returns a fresh pair. A miss applies them to the candidate, inserts both
rows, reloads the same structural graph/pair and commits. Insert order is Selection first and selection-kind Branch
second because the Branch owns the Selection FK; failure probes immediately before Selection, between
Selection and Branch, and after Branch/reload roll back both rows. It performs zero evaluator, Knowledge, Evidence or Task 11
callbacks. Immutable append-only references make the prior Application semantic check safe.

Implement both `loadSelectionWithBranchVerified(citySelectionSnapshotId)` and inherited
`listSelectionsWithBranchesVerified(runId)` in `city-selection-writer.ts`. The by-ID method loads the
exact selection/commit pair in one read transaction; verifies
`selection.id === commit.citySelectionSnapshotId`,
`selection.preCityBranchCommitId === commit.parentId === commit.forkedFrom` and all stored mirrors;
rejects missing as `city_selection_not_found`, duplicate, mismatched or tampered rows; and returns a
fresh frozen pair. The list method verifies every pair and orders it by
`(selection.createdAt ASC, selection.id ASC)` without `rowid`. After write/load, Application repeats the
full semantic graph, Task 11 selection and pair equality before returning or presenting the rich model.
Source links never affect selectability by themselves. A second city from the same terminal reuses the
same pre-city parent and creates a sibling commit.

`selectCity` never accepts a client `runId`: it verified-loads `terminalCityShortlistSnapshotId`, derives
the run ID from that terminal, and passes only `(derived runId, commandId, canonical remaining payload)`
to the atomic writer. The writer exact-replays only when the canonical remainder is unchanged and
returns `integrity_mismatch` for the same derived key with a different remainder.

- [ ] **Step 5: Run the core gate and commit**

```bash
./node_modules/.bin/vitest run tests/integration/city-selection.test.ts \
  tests/integration/city-frontier.test.ts tests/integration/city-frontier-store.test.ts \
  tests/branch/city.test.ts tests/integration/database-schema.test.ts \
  tests/integration/confirmed-life.test.ts tests/branch/life-git.test.ts
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/eslint src/application/city-selection.ts \
  src/infrastructure/sqlite/city-selection-writer.ts \
  src/infrastructure/city-frontier-composition.ts \
  src/infrastructure/composition-root.ts \
  tests/integration/city-selection.test.ts
git diff --check
git add src/application/city-selection.ts \
  src/infrastructure/sqlite/city-selection-writer.ts \
  src/infrastructure/city-frontier-composition.ts \
  src/infrastructure/composition-root.ts tests/integration/city-selection.test.ts
git commit -m "feat: select city branch"
```
