# VS-4A City Frontier Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn one verified effective-green country into a frozen, official-data city search that ranks an at-most-100-member catalog, checks at most ten cities per run, returns up to three selectable cities, and atomically records the selected city as the first alternative Life Git branch.

**Architecture:** VS-4A is a new vertical slice, not an extension of the country ranker. Pure `city-*` Decision modules own catalog membership, criteria, exact Decimal ranking, frontier state and warning/selectability policy. Research owns one installed official country package and full four-fact City Evidence/Knowledge publication. Application orchestrates zero-network Start/Present, one-city-per-command Continue, and atomic Select. SQLite stores only canonical append-only artifacts; Experience consumes strict JSON/finite-NDJSON read models and reuses the existing globe presentation without putting city policy in React.

**Tech Stack:** Node 24, TypeScript 6.0.3, Next.js 16.3.0, React 19.2.8, SQLite/better-sqlite3 13.0.3, Vitest 4.1.10, Zod 4.4.3, Decimal.js 10.6.0, the existing Evidence pipeline, finite-NDJSON reader and globe components.

**Approved design:** [`docs/superpowers/specs/2026-08-13-vs-4a-city-frontier-design.md`](../specs/2026-08-13-vs-4a-city-frontier-design.md)

**Required approved supplement:** [`VS-4A Safety Source Discovery`](../specs/2026-08-14-vs-4a-safety-source-discovery-design.md). Its bounded-search, Evidence and yellow-marker rules supersede the narrower safety clauses in the baseline design and in the 2026-08-13 execution plans.

**Approved Task 11 architectural amendment (2026-08-24):** the verified Knowledge/Evidence
anti-corruption projection, Decision-owned marker derivation, predecessor transition and Task 12 digest
boundary in the ledger below supersede the incomplete Task 11 placeholder signatures.

**Approved Task 12 architectural amendment (2026-08-24):** Task 12 owns descriptor-safe
content-addressed Ranking/Frontier/Selection/Branch values. Branch stays independent from Application;
one Application wrapper derives and verifies the durable Selection plus sibling City Branch pair from
verified terminal/ranking/pre-city authority, and Tasks 13–15 use only those named boundaries.

**Approved Task 13 architectural amendment (2026-08-25):** Decision adds structural Criteria replay;
Application owns exact Criteria/run/intent identity plus all evaluator, Ranking, Knowledge/Evidence and
Task 11 semantics; SQLite owns only canonical signed bytes, stored-source pre-city replay, five-table
constraints and complete chain topology. Start converges on one deterministic pre-city parent and one
global command intent, while SQLite returns granular artifacts and Application assembles the rich model.

**Split rationale:** This index is intentionally linked to five reviewer-sized plans. Catalog/ranking, bounded safety discovery, Evidence/Knowledge, orchestration/persistence and delivery have different owners and failure modes; combining their executable steps would violate the documentation constitution's size and single-responsibility rules.

## Linked execution plans

Execute strictly in this order:

1. [`VS-4A Foundations`](2026-08-13-vs-4a-city-frontier-foundations.md) — canonical change package, official-source feasibility, City Catalog, Criteria and Ranker.
2. [`VS-4A Safety Source Discovery`](2026-08-14-vs-4a-safety-source-discovery.md) — exact safety quantity/freshness, official authority plan, bounded discovery, privacy-safe attempt ledger and replay projection.
3. [`VS-4A Evidence and Knowledge`](2026-08-13-vs-4a-city-frontier-knowledge.md) — city Evidence overlay, full four-fact Knowledge, replay and stores.
4. [`VS-4A Frontier Core`](2026-08-13-vs-4a-city-frontier-core.md) — frontier policy, snapshots, SQLite chain, Application, selection and sibling branches.
5. [`VS-4A Delivery`](2026-08-13-vs-4a-city-frontier-delivery.md) — strict transport, browser-safe projection, UI/globe, reload and acceptance evidence.

Each numbered task ends in a local commit and a fresh focused gate. Do not begin a later plan while an earlier plan has a failed gate or unresolved review finding.

## Global constraints

- Entry is only `requireResolvedCountryShortlistForCity(revisionId)` plus exact membership of the selected effective-green country. Automatic, working, empty, tampered and effective-red country states fail closed.
- City fit never changes a country's formal or effective status. Accepted formal-yellow remains formal yellow and effective green internally.
- The installed City Catalog contains at most 100 cities per country: national capital first, every
  explicitly and officially typed first-level regional capital next, then the largest remaining
  official urban centers by latest comparable population until the total reaches 100; equal
  population uses ordinal `cityId`. More than 100 mandatory capitals is `NEEDS_CONTEXT`, never silent
  truncation. New append/install/Start paths require `city-catalog@2`; historical `city-catalog@1`
  remains loadable for audit and historical presentation only.
- The first production slice installs exactly one country package. Artifact installability requires a sealed `city-catalog@2` Registry/catalog projection and complete deterministic source plans for safety, long-term rent, urban transit and fixed broadband. Each complete plan deterministically closes each city fact as `verified | unknown` after bounded official attempts; no fresh positive value for every city is an installation prerequisite. Missing or malformed catalog/plan policy blocks installability, while an honest evidence-backed `unknown` lowers coverage but leaves the city selectable.
- City Criteria and City Ranker are separate modules. Do not edit or reuse `preference-profile.ts`, `place-ranker.ts`, `place-package.ts` or their country snapshots for city semantics.
- Unknown contributes factor `0`, retains its importance in the denominator, lowers coverage and warns. Only a fresh comparable verified required mismatch excludes a city.
- Ranking is frozen across the full catalog. Live Knowledge changes fresh facts and verification coverage only; it never changes current-run rank/score/order.
- Continue checks exactly one frozen candidate and all four facts. A run commits at most ten completed
  city candidates; a failed/uncommitted retry consumes no city slot. Only Continue may call official
  HTTPS and the narrow safety-search port. Start, Present, reload and Select are zero-network.
- A completed check publishes sealed Evidence, then a full four-fact City Knowledge revision, then a frontier successor. No old fact value is carried into a new city revision.
- Crash, cancel, storage, integrity, protocol or unexpected errors do not become domain unknown and do not advance the cursor. A completed Evidence/Knowledge result survives a later frontier append failure and is reused without network.
- Marker visual states are gray `pending`, `green`, `yellow` and `red`. Green and yellow are semantically selectable; yellow occupies a terminal slot and never triggers replacement, while only a verified required mismatch is red/excluded. Application supplies only a verified plain Knowledge/Evidence source projection; Decision derives effective facts, mismatches, weighted coverage, warnings and committed color at the frozen Ranking `assessmentAt`.
- Stop is exactly `three_selectable`, `catalog_exhausted` or `live_candidate_limit_reached`. The last
  reason applies after ten completed city checks only when the frozen queue still has candidates and
  fewer than three are selectable. Terminal `0..2` is valid; Select requires terminal `1..3` and an
  exact terminal entry.
- Selection warning basis is server-derived. The client supplies only terminal ID, city ID, command ID and `city-unknown-risk@1` iff warnings were displayed.
- Selection and City Branch Commit are one SQLite transaction. Alternative selections from the same
  terminal are sibling commits with `parentId = forkedFrom = preCityBranchCommitId`. Task 15 constructs
  the pair only through `createCitySelectionWithBranch` after fresh Task 11 selection and verified
  terminal/ranking/pre-city replay; load/presentation finishes with
  `reconstructCitySelectionWithBranch`. Both boundaries require
  `selection.createdAt >= terminal.createdAt`; equality is valid.
- Raw official bytes stay only in existing Evidence artifact storage when the source-specific retention policy permits it; otherwise a transient copy is deleted after the minimal hash/locator projection is sealed. City Knowledge never stores user criteria, score, suitability, search text or raw bytes.
- Runtime LLM/model calls remain exactly zero. The only external provider boundary added by VS-4A is the narrow safety URL-discovery port; provider SDK types, snippets, credentials and ranking never enter Decision, Research facts, Knowledge or the browser bundle.
- Do not add a universal crawler, background search worker, event store, queue, polling, ORM, mutable
  head table, jobs/housing/budget flow or universal city ontology. The approved sequential safety
  search budget is `3 queries / 10 document URL candidates / 2 official hops` per one city check; it
  is independent from the frontier-wide ten-city limit.
- Do not expand `PlaceFrontierJourney.tsx`; the city slice gets focused city components and one city journey owner.
- Preserve the three unrelated untracked `.superpowers/brainstorm/**` directories.

## Cross-plan interface ledger

These names are normative. A task may refine private helpers, but changing a public name or semantic field requires updating all linked plans before implementation continues.

```ts
export type CityCriterionId =
  | "safety"
  | "long_term_rent"
  | "urban_transit"
  | "fixed_broadband";

export type CityUnknownReason =
  | "not_found"
  | "stale"
  | "conflict"
  | "not_comparable"
  | "source_unavailable";

// Ranking-only absence before any city check; never persisted as a live fact.
export type CityRankingUnknownReason = CityUnknownReason | "no_knowledge_revision";

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

export interface CitySafetyDiscoveryBudget {
  readonly queryLimit: 3;
  // Document URLs inspected for one city's safety fact; not City Frontier cities.
  readonly candidateLimit: 10;
  readonly officialHopLimit: 2;
  readonly rulesVersion: "city-safety-discovery@1";
}

export type CitySafetyCandidateRejectionReason =
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

// Decision owns this structurally identical closed union. Application maps the verified Research
// value at the anti-corruption boundary; Decision never imports a Research type.
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

export type CitySafetyEvidenceLink =
  | {
      readonly disposition: "accepted";
      readonly navigationUrl: string;
      readonly resolvedEvidenceUrl: string;
      readonly referenceYear: number;
    }
  | {
      readonly disposition: "reviewed_rejected";
      readonly navigationUrl: string;
      readonly resolvedEvidenceUrl?: string;
      readonly referenceYear?: number;
      readonly rejectionReason: CitySafetyCandidateRejectionReason;
    };

export type CityFactLinkProjection =
  | {
      readonly sourceId: string;
      readonly disposition: "accepted";
      readonly navigationUrl: string;
      readonly resolvedEvidenceUrl: string;
      // Required when the enclosing fact criterionId is "safety".
      readonly referenceYear?: number;
    }
  | {
      readonly sourceId: string;
      readonly disposition: "reviewed_rejected";
      readonly navigationUrl: string;
      readonly resolvedEvidenceUrl?: string;
      readonly referenceYear?: number;
      // Required for safety facts; forbidden for every non-safety fact.
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

export type CityCommittedFactProjectionTuple = readonly [
  CityCommittedFactProjection,
  CityCommittedFactProjection,
  CityCommittedFactProjection,
  CityCommittedFactProjection,
];

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

export function reconstructCityCriteriaSnapshot(
  value: unknown,
  integrity: CityDecisionIntegrity,
): CityCriteriaSnapshot;

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
export function cityLiveMarkerDigest(
  marker: CityLiveMarker,
  integrity: CityDecisionIntegrity,
): string;

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

export function resolvedCountryEntryDigest(
  entry: PreCityResolvedCountryEntryProjection,
  integrity: CityDecisionIntegrity,
): string;

export interface CreatePreCityBranchCommitInput {
  readonly source: PreCityBranchSourceProjection;
  readonly createdAt: string;
}

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

export interface CitySelectionAuthority {
  readonly terminal: TerminalCityShortlistSnapshot;
  readonly ranking: CityRankingSnapshot;
  // Must be the fresh output of replayPreCityBranchCommit against verified source.
  readonly preCityBranch: PreCityBranchCommit;
}

export interface CreateCitySelectionWithBranchInput extends CitySelectionAuthority {
  readonly commandId: string;
  readonly selection: CitySelectionProjection;
  readonly createdAt: string;
}

export function createCitySelectionWithBranch(
  input: CreateCitySelectionWithBranchInput,
  integrity: CityDecisionIntegrity,
): CitySelectionWithBranch;
export function reconstructCitySelectionSnapshot(
  value: unknown,
  integrity: CityDecisionIntegrity,
): CitySelectionSnapshot;
export function reconstructCitySelectionWithBranch(
  value: unknown,
  authority: CitySelectionAuthority,
  integrity: CityDecisionIntegrity,
): CitySelectionWithBranch;

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

export interface CityCheckRunIdentity {
  readonly schemaVersion: "city-check-run@1";
  readonly runId: string;
  readonly cityId: string;
  readonly rankingSnapshotId: string;
}

export function cityCheckRunId(
  input: CityCheckRunIdentity,
  integrity: CityDecisionIntegrity,
): string;

export type CityFrontierProgressStage =
  | "source_started:si-city-safety"
  | "source_started:si-city-long-term-rent"
  | "source_started:si-city-urban-transit"
  | "source_started:si-city-fixed-broadband"
  | "source_completed:si-city-safety"
  | "source_completed:si-city-long-term-rent"
  | "source_completed:si-city-urban-transit"
  | "source_completed:si-city-fixed-broadband"
  | "evidence_verified"
  | "knowledge_published";

interface CityFrontierProgressEventBase {
  readonly type: "city_progress";
  readonly runId: string;
  readonly baseRevisionId: string;
  readonly sequence: number;
  readonly occurredAt: string;
  readonly cityId: string;
}

export type CityFrontierProgressEvent =
  | (CityFrontierProgressEventBase & {
      readonly stage:
        | "source_started:si-city-safety"
        | "source_started:si-city-long-term-rent"
        | "source_started:si-city-urban-transit"
        | "source_started:si-city-fixed-broadband"
        | "evidence_verified"
        | "knowledge_published";
      readonly sourceUrl?: never;
    })
  | (CityFrontierProgressEventBase & {
      readonly stage:
        | "source_completed:si-city-long-term-rent"
        | "source_completed:si-city-urban-transit"
        | "source_completed:si-city-fixed-broadband";
      readonly sourceUrl: string;
    })
  | (CityFrontierProgressEventBase & {
      readonly stage: "source_completed:si-city-safety";
      readonly sourceUrl?: string;
    });

export type CityFrontierEvent =
  | { readonly type: "city_activated"; readonly runId: string; readonly baseRevisionId: string; readonly sequence: number; readonly occurredAt: string; readonly cityId: string; readonly rank: number }
  | CityFrontierProgressEvent
  | { readonly type: "city_revision_committed"; readonly runId: string; readonly baseRevisionId: string; readonly sequence: number; readonly occurredAt: string; readonly marker: CityLiveMarker; readonly revision: CityFrontierRevision }
  | { readonly type: "city_continuation_completed"; readonly runId: string; readonly baseRevisionId: string; readonly sequence: number; readonly occurredAt: string; readonly readModel: CityFrontierReadModel };

export function deriveCityCriteriaDraft(
  profile: RelocationProfileSnapshot,
  preferences: PreferenceProfileSnapshot,
  defaults: InstalledCityCriteriaDefaults,
  evaluators: CityCriterionEvaluatorRegistry,
): CityCriteriaSnapshot["criteria"];
export function deriveCityCriteriaDraft(
  profile: RelocationProfileV2Snapshot,
  preferences: PreferenceProfileV2Snapshot,
  defaults: InstalledCityCriteriaDefaults,
  evaluators: CityCriterionEvaluatorRegistry,
): CityCriteriaSnapshot["criteria"];

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

export interface CityFrontierResolvedCountryReadPort {
  requireResolvedCountryShortlistForCity(
    revisionId: string,
  ): Promise<ResolvedCountryShortlistSnapshot>;
}

export interface CityFrontierProfileReadPort {
  loadRelocationAnyVerified(
    id: string,
  ): Promise<RelocationProfileSnapshot | RelocationProfileV2Snapshot>;
  loadPreferenceForRankingVerified(
    id: string,
  ): Promise<PreferenceProfileSnapshot | PreferenceProfileV2Snapshot>;
}

export interface CityFrontierFixedRoutePorts {
  readonly "si-city-long-term-rent": CityFixedRoutePort<
    "si-city-long-term-rent",
    CityFixedEvidenceClaim<"si-city-long-term-rent">
  >;
  readonly "si-city-urban-transit": CityFixedRoutePort<
    "si-city-urban-transit",
    CityFixedEvidenceClaim<"si-city-urban-transit">
  >;
  readonly "si-city-fixed-broadband": CityFixedRoutePort<
    "si-city-fixed-broadband",
    CityFixedEvidenceClaim<"si-city-fixed-broadband">
  >;
}

export interface CityFrontierApplicationPorts {
  readonly resolveAvailability: typeof getCityResearchPackageAvailability;
  readonly resolvedCountries: CityFrontierResolvedCountryReadPort;
  readonly profiles: CityFrontierProfileReadPort;
  readonly installedPackages: InstalledCityPackageLookupPort;
  readonly installedPackageManifests: Pick<InstalledCityPackageManifestStorePort, "loadVerified">;
  readonly latestInstalledCatalog: InstalledCityCatalogReadPort;
  readonly historicalCatalogs: Pick<CityCatalogStorePort, "loadVerified">;
  readonly criteria: CityCriteriaReadPort;
  readonly branches: CityBranchReadPort;
  readonly rankings: CityRankingReadPort;
  readonly frontierRead: CityFrontierReadPort;
  readonly frontierAppend: CityFrontierAppendPort;
  readonly startWriter: CityFrontierStartWriterPort;
  readonly selectionHistory: CitySelectionHistoryReadPort;
  readonly evidence: CityEvidenceStorePort;
  readonly evidenceReplay: CityEvidenceReplayPorts;
  readonly knowledge: CityKnowledgeStorePort;
  readonly fixedRoutes: CityFrontierFixedRoutePorts;
  readonly fixedDeadlineScheduler: CityFixedDeadlineScheduler;
  readonly safetySearch: CitySafetySearchPort;
  readonly safetyDocuments: CitySafetyOfficialDocumentPort;
  readonly decisionIntegrity: CityDecisionIntegrity;
  readonly evidenceIntegrity: EvidenceIntegrity;
  readonly clock: () => Date;
  readonly fixedSourceDeadlineAt: (now: Date) => Date;
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

export interface VerifiedCityTerminalSelectionAuthority {
  readonly readModel: CityFrontierReadModel;
  readonly terminal: TerminalCityShortlistSnapshot;
  readonly ranking: CityRankingSnapshot;
  readonly preCityBranch: PreCityBranchCommit;
  readonly preCitySource: PreCityBranchSourceProjection;
  readonly frontier: ReconstructCityFrontierInput;
}

export interface CityFrontierSelectionAuthorityPort {
  loadCurrentTerminalSelectionAuthority(
    terminalCityShortlistSnapshotId: string,
  ): Promise<VerifiedCityTerminalSelectionAuthority>;
}

export interface CityFrontierApplicationAssembly {
  readonly application: Readonly<CityFrontierApplication>;
  readonly selectionAuthority: Readonly<CityFrontierSelectionAuthorityPort>;
}

export function createCityFrontierApplication(
  ports: CityFrontierApplicationPorts,
): Readonly<CityFrontierApplicationAssembly>;

export type CityFrontierLiveSourceConfiguration =
  | { readonly kind: "unconfigured" }
  | {
      readonly kind: "configured";
      readonly fixedRoutes: CityFrontierFixedRoutePorts;
      readonly safetyDocuments: CitySafetyOfficialDocumentPort;
      readonly citySafetySearch?: Readonly<{
        readonly config: HttpCitySafetySearchConfig;
        readonly request: CitySafetySearchHttpRequest;
      }>;
    };

export interface CityFrontierFixedTiming {
  readonly fixedSourceDeadlineAt: (now: Date) => Date;
  readonly fixedDeadlineScheduler: CityFixedDeadlineScheduler;
}

export interface CityFrontierCompositionOptions {
  readonly database: Database.Database;
  readonly hmacKey: string;
  readonly resolvedCountries: CityFrontierResolvedCountryReadPort;
  readonly profiles: CityFrontierProfileReadPort;
  readonly liveSources: CityFrontierLiveSourceConfiguration;
  readonly resolveAvailability?: typeof getCityResearchPackageAvailability;
  readonly clock?: () => Date;
  readonly fixedTiming?: CityFrontierFixedTiming;
}

export function createCityFrontierComposition(
  options: CityFrontierCompositionOptions,
): Readonly<CityFrontierApplication & CitySelectionApplication>;

export interface CityFrontierReadModel {
  readonly runId: string;
  readonly assessmentAt: string;
  readonly resolvedCountryShortlistRevisionId: string;
  readonly countryCode: string;
  readonly preCityBranchCommitId: string;
  readonly registry: CityRegistryRevision;
  readonly catalog: CityCatalogRevision;
  readonly criteria: CityCriteriaSnapshot;
  readonly ranking: CityRankingSnapshot;
  readonly revision: CityFrontierRevision;
  readonly selections: readonly CitySelectionWithBranch[];
}

export interface SelectCityInput {
  readonly terminalCityShortlistSnapshotId: string;
  readonly cityId: string;
  readonly commandId: string;
  readonly warningCopyVersion?: "city-unknown-risk@1";
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

export interface CitySelectionApplication {
  selectCity(input: SelectCityInput): Promise<{
    readonly selection: CitySelectionSnapshot;
    readonly commit: CityBranchCommit;
    readonly readModel: CityFrontierReadModel;
  }>;
}

export interface CitySelectionApplicationPorts {
  readonly frontier: CityFrontierSelectionAuthorityPort;
  readonly writer: CitySelectionWriterPort;
  readonly integrity: CityDecisionIntegrity;
  readonly clock: () => Date;
}

export function createCitySelectionApplication(
  ports: CitySelectionApplicationPorts,
): Readonly<CitySelectionApplication>;

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

Task 12 IDs are exact content addresses over the closed payload without `id`:
`city-ranking:`, `city-frontier-revision:`, `city-selection:`, `pre-city-branch:` and `city-branch:`,
each followed by lowercase `hash(canonical(payload))`; Frontier uses its flattened closed-union
payload. `cityLiveMarkerDigest` and
`resolvedCountryEntryDigest` are the same raw lowercase 64-hex hash with no prefix over the complete
marker or resolved-country entry projection. All Task 12 boundaries descriptor-own/close inputs before
capturing only `canonical`/`hash`, validate callback results immediately and return fresh recursively
frozen values. Ranking and Frontier structural reconstruction never claims semantic verification:
Application separately calls the semantic Ranking verifier and Task 11 frontier/selection policy.
Standalone `reconstructCitySelectionSnapshot` is likewise structural only; pair authority requires
`reconstructCitySelectionWithBranch` with the verified graph.
The Branch module imports only the Decision integrity type and no Application module.
Full durable schemas plus the supporting Task 12
`CityRankingSnapshotPayload`/`CityRankingSemanticInputs`/`CityFrontierRevisionPayload`/
`CitySelectionSnapshotPayload` contracts remain normative in the linked Core plan; this master ledger
lists the callable cross-plan boundaries without duplicating those complete data schemas.

Task 13 adds structural Criteria content replay with exact
`city-criteria:${hash(canonical(payload without id))}`. The existing evaluator-aware Criteria
reconstruction remains the semantic boundary. Its identity helpers are exact and timestamp-free:
`cityCriteriaPayloadHash = raw H(C(exact five-key command payload))` and
`cityFrontierRunId = "city-frontier:" + H(C(exact nine-key run identity))`. Start command equality is
global by client command ID against the canonical exact five-key intent containing that derived run ID;
every Frontier row is unique by `(runId, commandId)`, so a successor cannot reuse its root command.
The identity's Catalog-rules field is the authenticated referenced Catalog's closed `@1 | @2` literal;
new Start still requires current `@2`. Every full-chain/root load follows the Ranking, Criteria and
Catalog references, structurally verifies all three, binds Catalog ID/Registry/country/package/schema to
Ranking/context, rebuilds both identities and the five-key Start intent, and binds the stored command
envelope, root Criteria hash/run/Ranking and Ranking source/context/Registry/rules/budget. Application
repeats the same identity replay after its evaluator/Ranking/Knowledge/Evidence/Task 11 semantic gates.

Task 14 adds the exact four-key `CityCheckRunIdentity`
`{ schemaVersion: "city-check-run@1", runId, cityId, rankingSnapshotId }` and derives
`cityCheckRunId = "city-check:" + H(C(exact descriptor-owned identity))`. Frontier and Ranking IDs use
their exact prefixed lowercase-64 forms and city ID is a nonempty canonical identifier. The boundary
captures neutral C then H, feeds H exactly C's returned string, accepts only a lowercase-64 result and
normalizes hostile input/capability/result failure to a fresh `integrity_mismatch`. Command, time, package
and Catalog do not enter this retry/race identity.

City Criteria setup accepts only matched relocation/Preference Profile versions `@1/@1 | @2/@2`.
The existing v1 mapping is unchanged: personal safety controls safety mode/importance; infrastructure
controls transit and broadband mode/importance; rent remains default. The exact ordered v2 city tuple
controls only each corresponding safety/rent/transit/broadband mode and importance. Installed defaults
retain criterion ID, definition ID and canonical package-unit target in both versions; free-form v2
target text is never evaluator authority, and relocation is binding authority only. Profile/source ID,
version, tuple/order or criterion drift fails before evaluator, Knowledge, ranking or write callbacks.

Task 14 does not treat the convenient installed-package lookup DTO as artifact authority. Its exact
port graph includes the independent least-authority
`installedPackageManifests: Pick<InstalledCityPackageManifestStorePort, "loadVerified">`. Setup/Start
own and key-validate `findReady`, compare the installed Catalog to the latest authenticated root, then
exact-load the full verified manifest by that owned key. Continue, Present and internal terminal
authority do the same immediately after `findExact`, without consulting latest state. Absence,
malformed/forged content ID or payload hash, alternate manifest, or audit-ID/key/definition/readiness/
catalog-root drift is fresh `integrity_mismatch`; HMAC verification remains the store's Infrastructure
postcondition. Application captures a private frozen narrowed `{ canonical, hash }` view of
`ports.evidenceIntegrity`; every full-manifest and administrative-artifact equation uses exact Evidence
C→H and makes zero `sign` calls. `decisionIntegrity` remains limited to Decision reconstruction and IDs.
Application binds every reconstructed member plan, safety plan, authority directory,
Criteria defaults and definition tuple to the full manifest's visible IDs/versions and exact canonical
artifact SHA-256 through that Evidence view before Criteria/Evidence/Knowledge/flight/source work.
One bounded discriminating Decision-vs-Evidence sentinel pins that split without a matrix. Evaluator and validator policy
version IDs are bound without comparing JavaScript function bytes. A real B plan under A's exact key
and exact manifest A therefore fails even if it is structurally valid. Task 7 replay remains a later,
independent store boundary rather than authorizing this Application gate.

Durable tables added by the complete slice, and no others:

1. `city_catalog_revisions`
2. `city_criteria_snapshots`
3. `city_evidence_snapshots` (typed overlay over existing `evidence_snapshots`)
4. `city_knowledge_revisions`
5. `city_ranking_snapshots`
6. `city_frontier_revisions`
7. `city_selection_snapshots`
8. `city_branch_commits` (`pre_city | selection` closed union)

Every table has a closed canonical payload, SHA-256, HMAC, mirrored-column verification and immutable UPDATE/DELETE triggers. Linear tables additionally enforce one root, one successor and no successor after terminal.
Task 13 introduces exactly the five Criteria/Ranking/Frontier/Selection/Branch tables in this inventory,
with no Knowledge-map junction. SQLite structurally verifies signed canonical bytes, content IDs,
mirrors/FKs, stored-source pre-city replay and the complete root-to-head topology. It never accepts or
claims evaluator Criteria, semantic Ranking, Knowledge/Evidence or Task 11 proof. Selection is reserved
for Task 15 but already carries its timestamp-free command envelope and exact
`city_selection_snapshots_one_command(run_id, command_id)` index.
Ranking's composite installed-package FK depends on the already frozen exact unique index
`installed_city_package_manifest_exact_key(country_code, package_id, package_schema_version,
catalog_revision_id, evidence_rules_version)`; Task 13 preflight rejects any drift as
`database_schema_reset_required`.
Every Task 13 row uses the exact private envelope `payload_json=C(reconstructed value)`, raw lowercase-64
`payload_hash=SHA256_TEXT(payload_json)` and, for non-command rows,
`hmac=HMAC_SHA256_TEXT(payload_json,key)`. Frontier and Selection also store
`command_json=C(exact intent/operation)`, its raw lowercase-64 SHA-256, and an HMAC over
`C({ value: reconstructed value, command: exact command })`. The Core Task 13 executable SQL appendix is
the sole normative physical schema and normalized-SQL preflight authority.

## Dependency direction

```text
Decision city policies
  ^
  | typed facts / ports
Research builders <- Application use cases <- Experience / HTTP
                         ^
                         |
                 SQLite / source adapters

Branch city values <- Application Select <- SQLite atomic writer
```

Decision imports neither Research revisions nor Application/SQLite/React. Research does not import Application. Application defines ports; infrastructure implements them. Browser modules may runtime-import only Experience; Decision and Application contracts are type-only, while Infrastructure and `node:*` are forbidden runtime edges.

`createCityFrontierApplication` is the sole constructible Task 14 Application boundary. It
descriptor-owns/closes the exact port graph, captures every method before behavior, imports no
Infrastructure/SQLite/HTTP/timer implementation and returns a frozen
`Readonly<CityFrontierApplicationAssembly>`. Only `assembly.application` is exposed to delivery;
`selectionAuthority` is internal Application-to-Application authority, never HTTP/event/read-model.
Composition alone constructs Task 13 stores, installed production registries and Evidence replay
dependencies. It constructs one authenticated `SqliteCityPackageManifestStore`, captures that store's
`loadVerified` receiver for the same underlying receiver used by `InstalledCityPackages`, and injects a
distinct fresh frozen plain `{ loadVerified }` adapter. The adapter is not the store and exposes no
append/latest/inherited prototype capability; Application imports no Infrastructure type. During Task
14, its internal option admits an absent `selectionHistory` and uses an adapter
returning a new frozen empty array per call. Final Task 15 composition removes that public option,
constructs one writer, injects that exact object as Task 14 history,
constructs Task 14 exactly once, and constructs Task 15 from that assembly's selection authority plus the
same writer. `createCityFrontierApplication` still returns the internal assembly and imports no Task 15;
`createCityFrontierComposition` returns exact frozen
`Readonly<CityFrontierApplication & CitySelectionApplication>`. Root exposes only that public surface,
never the writer/internal authority.

The internal terminal-selection loader structurally verifies the exact terminal/full chain, requires the
requested ID as the run's unique current terminal, and loads its frozen package/Catalog. It rejects `@1`
before evaluator/Knowledge/Evidence/Task 11 even though public Present may
audit it, then performs complete current semantic replay. It returns fresh owned read model, terminal,
Ranking, pre-city branch, source rebuilt from verified resolved/profile graph and exact Task 11 frontier
input. Task 14 never imports Task 15 back across this boundary.

Live sources are the exact configured/unconfigured union in the public ledger. Configured requires all
three keyed fixed ports and an official-document port; the optional HTTP search `{ config, request }` is
atomic and maps exactly through `createHttpCitySafetySearchStep` then `createCitySafetySearchPort`.
Absence maps to `createUnconfiguredCitySafetySearchPort`. The unconfigured branch's fixed/document ports
throw `city_source_adapter_unconfigured` if reached, but current SI returns the separately asserted fresh
frozen issues `["catalog_v2_projection_unsealed", "registry_coordinates_unsealed",
"per_member_source_plan_artifacts_unsealed", "criteria_policy_unapproved"]` and Setup/Start throw only
`Error("city_package_not_ready")` before those ports. The error has no issue payload/class contract. Real Slovenia fixed/document adapters,
analyzers and population implementations are deferred until the package is approved and ready; positive
tests use configured synthetic ports. Root composition defaults explicitly to `{ kind: "unconfigured" }`
and adds only optional `cityFrontierLiveSources`, `cityFrontierResolveAvailability` and
`cityFrontierFixedTiming` overrides. Application invokes only the captured `ports.resolveAvailability`;
composition supplies `getCityResearchPackageAvailability` as its default, and the use case never
direct-calls that imported pure function.

Absent fixed timing means exactly a `+45_000ms` deadline policy and a real `setTimeout` scheduler whose
canonical-future callback fires at most once and whose cancel is idempotent, non-throwing and final.
Application captures one research-start instant, passes three fresh Date copies to the policy, and
requires the three canonical future outputs to be byte-equal before source/event/write. Safety search
retains its separate timeout. `CityFixedSourceRunInput.now` stays `() => string`: Application wraps its
captured `() => Date` clock, owns/validates every returned Date and emits canonical ISO, so no Date or
borrowed clock crosses the Research boundary. Invalid/throwing clocks are pinned before source output.
Fixed abort/deadline/clock/protocol/native errors and existing search error
semantics are preserved; only bounded completed runner outcomes become unknown.

The public `CityFrontierReadModel` is the rich graph in the ledger, never an alias of one revision.
SQLite Start returns only Criteria/parent/Ranking/root; Application assembles the graph after its
semantic reload and obtains selection history through `CitySelectionHistoryReadPort`. History is a
fresh frozen array ordered by `(selection.createdAt ASC, selection.id ASC)` after structural pair and
Application semantic verification. Before Task 15, composition supplies an explicit fresh-empty history
adapter; the use case does not hardcode `[]`.
An authentic historical `city-catalog@1` graph remains zero-network Presentable, but its read model is
audit-only: `readModel.catalog.rulesVersion` lets Experience distinguish it, and Application exposes no
successful Continue or Select path. Setup/Start/Continue/Select and every durable write require `@2`.
Authenticated installed-package, Evidence and Knowledge readers/replayers may return either known
Catalog-rules literal for replay and typed classification. Manifest append/install, Evidence seal,
Knowledge publication, Frontier/Selection writes and Setup/Start/Continue/Select use-case gates—not
shared reconstruction—own `@2` authorization. Public Present still exact-loads the independently
verified full manifest and applies all artifact bindings before accepting known `@1`; internal selection
authority applies the same manifest gate and then rejects `@1` before semantic callbacks. Unknown rules
remain `integrity_mismatch`.

For Task 11, Application is the explicit anti-corruption layer: it derives
`CityMarkerAuthorityProjection` only from reconstructed Knowledge plus replayed Evidence. The pure
Decision input also receives only the two-part frozen Ranking projection, verified Criteria and inward
evaluators. Decision evaluates the four facts at `ranking.assessmentAt`, requires
`assessmentAt <= lastCheckedAt`, and derives every mismatch, weighted coverage, warning and marker
status through `reconstructCityLiveMarker`. Application first derives that marker, then computes the
raw lowercase `hash(canonical(marker))`; Task 11 validates/copies its 64-hex form, while Tasks 12–14
compute and reverify it through `CityDecisionIntegrity` before creating a frontier binding. Frontier
reruns marker reconstruction for every binding. No Research, crypto, clock or network capability
crosses into Task 11.

Task 11 owns/captures the complete graph and all four evaluator capabilities before the first behavior
callback. Each evaluator receives only a fresh frozen exact
`CityCriterionEvaluationInput { criterion, fact, assessmentAt }`; its eight-key `fact` projection
contains no Evidence link or rejection metadata. Accepted links occur only in `evidenceLinks`;
reviewed-rejected links occur only in `manualCheckLinks` and transient `reviewedSourceLinks`.
Against the enclosing fact, safety accepted links require a year equal to the verified fact period,
safety reviewed links require the Decision-owned rejection reason, and non-safety reviewed links
forbid that key. Before each callback, fact criterion/definition/freshness fields are bound to the
canonical criterion and captured definition. Every synchronous evaluator return is immediately
descriptor-owned and exact-validated: verified is the exact three-key branch; unknown is the exact
four-key branch with factor `0`, comparison `unknown` and the raw-unknown reason preserved. Hostile,
Promise-shaped, malformed and throwing returns fail as `integrity_mismatch` before later callbacks.
Definitions plus both function references are descriptor-captured once; callbacks run with fresh
frozen exact `{ capability: "canonicalizeTarget" }` or `{ capability: "evaluate" }` receivers, never
the borrowed evaluator or registry. A first callback cannot swap the remaining three authorities.

`predecessorMarkers: null` is reserved for the zero-marker root. Every successor supplies the exact
predecessor list, retains it as the canonical marker prefix, appends exactly one next frozen-rank
marker and requires the predecessor policy to remain working. Omitting `persisted` derives a new
closed `working | terminal` projection; providing it verifies exact canonical equality. Pure selection accepts only the exact
`cityId/warningCopyVersion?` request, requires a verified terminal entry, and returns a fresh entry
plus transient reviewed links flattened from the selected marker without deduplication.

## Common command and recovery rules

- Start accepts exactly `{ resolvedCountryShortlistRevisionId, countryCode, criteriaDraft, commandId }`.
  After every input is verified it obtains one `startAt` and requires
  `criteria.confirmedAt = ranking.assessmentAt = ranking.createdAt = root.createdAt = startAt`.
  The deterministic pre-city parent instead uses
  `preCity.createdAt = verifiedResolvedCountryShortlist.createdAt <= startAt`; Application performs the
  exact source-key find/replay before Ranking seal. Same source across runs/retries/races therefore has
  identical parent bytes/ID. Run identity includes the exact resolved revision, country, Registry,
  full installed-package key, Criteria payload hash, catalog/ranker rules and verification budget; it
  excludes clocks and clock-derived snapshot IDs. Inside `publishStart`'s `BEGIN IMMEDIATE`, global
  Start command lookup is the first SQLite action before any run-scoped row read or insert. The writer
  then authenticates the candidate Catalog even on a hit and derives rules/run/intent. A hit compares
  derived and stored intent first, so any drift—including `@1 ↔ @2`—is `integrity_mismatch`; only exact
  equality applies the candidate+winner `@2` gate before returning the fully verified stored winner. A
  miss gates the candidate before root lookup/write. Exact five-key intent replay converges even when a
  retry built later candidates. A different Start command for
  the already-existing deterministic run/root is also `integrity_mismatch`. `publishStart` and direct
  successor append both reject an authenticated `@1` Catalog as `city_catalog_upgrade_required` before
  returning a command replay or inserting anything. Direct append preserves conflict precedence: a
  command hit compares the candidate/stored operation first (`integrity_mismatch` on drift), then exact
  hit and miss paths authenticate/gate Catalog before replay/stale/write.
- Continue uses `(runId, expectedRevisionId, commandId)`. Prepare owns/closes that exact input and calls
  `findCommandVerified` before the head loader: a committed `city_completed` hit must name the input
  expected revision and derives Prepared from that verified base even if the current head is terminal;
  a miss requires that expected revision to be the unique working head. Every loaded frontier revision
  first passes Task 12 structural reconstruction, then the hit/miss branches share exact package/Catalog
  authentication and the current-`@2` gate before Criteria/evaluator/Knowledge/Evidence/Task 11,
  source, event, replay return or append. Only then does semantic reconstruction run; every successor is
  created through `sealCityFrontierRevision`. After command-first lookup, only an authenticated
  same-run/same-Ranking ancestor that is not the unique head is `stale_city_frontier_head`. On a miss and
  head mismatch, both Prepare and Continue exact-load the claimed base before classification; forged,
  missing, cross-run, cross-Ranking or otherwise misbound predecessors are `integrity_mismatch`, and only
  exact `city_frontier_not_found` is caught for absence normalization. A committed identical command replays its
  working-or-terminal result without source or duplicate event.
- Pre-city structural load remains no-context: the adapter authenticates the stored row, locates the
  verified country-resolution chain by its stored resolved revision, requires that revision as the
  resolved head plus one unique country entry, rebuilds the source and calls source replay. Application
  separately repeats the full semantic country/profile guard and canonical equality. Every frontier
  Start uses the separate descriptor-owned source-key find/replay before Ranking seal; it queries the
  exact `(resolved revision, country)` key and never catches not-found as control flow. Every frontier
  load/find traverses every run row exactly once from root to unique head, without `rowid`; disconnected,
  cyclic, cross-run/cross-Ranking, corrupt-ancestor, invalid prefix/time/count/terminal graphs poison all
  loaders. Each full-chain/root load also follows verified Ranking, Criteria and Catalog, binds their
  source/context/Registry/package/schema fields, derives Catalog rules, recomputes the exact Criteria
  hash, run ID and Start intent, and rejects any authentic rehashed cross-row drift; Application repeats
  that binding after semantic reconstruction.
- Structural absence uses exactly `city_criteria_not_found`, `pre_city_branch_not_found`,
  `city_ranking_not_found`, `city_frontier_not_found` and Task 15 `city_selection_not_found`.
  `findCommandVerified` returns `undefined` only for an absent command in an existing fully verified
  run; an absent run is `city_frontier_not_found`.
- A continuation derives exactly
  `city-check:${H(C({ schemaVersion: "city-check-run@1", runId, cityId, rankingSnapshotId }))}` only
  after verified Ranking semantics. Present-first recovery checks sealed City Evidence and published
  Knowledge before any source call.
- The Application-factory-scoped single-flight Map is keyed by this check ID and stores the canonical
  complete identity `{ cityCheckRunId, runId, baseRevisionId, rankingSnapshotId, cityId, assessmentAt,
  installedPackageContext }`. Identity drift fails closed. Its promise owns all four research runs,
  artifacts, one completion time, generic seal, Evidence seal/reload, Knowledge publish/reload and marker
  authority; followers never re-clock/reseal. Signals and emitters remain per-call. One abort detaches only
  that waiter; zero waiters before publication abort the shared controller and publish nothing.
  Immediately before Evidence seal the flight rechecks waiters and enters publishing; after durable
  Evidence/Knowledge no abort rolls back, but an aborted caller neither appends nor emits and a retry
  recovers with zero source. The caller receives the existing signal reason or platform `AbortError`,
  never a new City abort code. Map cleanup is identity-safe in `finally`.
- Each caller owns a serialized fresh-frozen event pump with contiguous one-based sequence and canonical
  nondecreasing times. Exact `city_activated` is first and precedes source. `CityFrontierProgressStage`
  is the closed ten-literal union: four `source_started:<sourceId>` in canonical
  `SLOVENIA_CITY_FACT_SOURCE_IDS` order, four `source_completed:<sourceId>` in the same order,
  `evidence_verified` and `knowledge_published`; progress has no extra display-text fields. Before parallel launch the flight
  broadcasts source-start drafts in canonical four-source order; after all results pass structural and
  authority validation it broadcasts source-completed drafts in the same order, then Evidence/Knowledge.
  Physical Promise completion order is irrelevant and the flight never awaits/captures emitters. Event
  starts and Evidence/Knowledge forbid `sourceUrl`; a verified fixed completion uses the accepted
  attempt's installed `navigationUrl`, while a completed unknown after all routes were rejected uses the
  final attempted installed route's `navigationUrl` (pinned by two-route-success and all-rejected cases).
  Safety completion includes one iff an authority-validated official document/navigation exists. No
  event string contains candidate/query/snippet/credential/raw-error data. Append precedes committed, then exactly one completed event whose model equals
  the return. Entry command hit emits nothing; stale different-command losers emit no commit/completed;
  pre-append emitter failure leaves no frontier successor, post-append failure preserves the winner, and
  detachment/failure has no late events.
- A command miss recovering completed Evidence/Knowledge emits private activation, then only
  `evidence_verified`, `knowledge_published`, committed and completed, with no source stages. Recovery and
  already-present Knowledge use the same pump, waiter, abort and emitter laws.
- A committed marker event is emitted only after the frontier append. Reconstruction requires
  `completed markers <= 10`; every tenth marker must produce terminal under the documented stop
  precedence, and no eleventh activation is valid. Every Continue then emits exactly one
  `city_continuation_completed` carrying the verified working-or-terminal read model; the route
  withholds that frame until clean EOF, and its model must canonically equal the callback return.
- Select is built only by `createCitySelectionApplication` from exact
  `CitySelectionApplicationPorts { frontier, writer, integrity, clock }`. Its Task 14 frontier authority
  rejects audit-only `@1` before Criteria/evaluator/Knowledge/Evidence/Task 11 callbacks and returns the
  fully current terminal graph. Task 15 calls Task 11 selection against `authority.frontier`,
  source-replays `authority.preCityBranch` against `authority.preCitySource`, creates the pair only
  through `createCitySelectionWithBranch`,
  and constructs the exact timestamp-free three-key selection intent. The atomic writer accepts only
  that intent, command ID and constructed pair; it owns command-first equality, Task 12 structural pair,
  stored-source pre-city replay, mirrors/FKs and insert/reload. Its command lookup is the first SQL;
  before returning a hit or inserting a miss it authenticates the referenced Catalog and enforces `@2`.
  Every Select invocation, after authority and pure selection, obtains exactly one server time and
  constructs one candidate/publication before calling the writer. An exact hit, including a race hit,
  compares only timestamp-free command intent, ignores and never canonical-compares candidate bytes,
  ID or `createdAt`, then structurally reloads the stored pair with its stored creation time and all
  immutable refs/source, mirrors and topology. Miss alone validates/inserts the candidate. Construction/reconstruction also
  require `selection.createdAt >= terminal.createdAt`, accepting equality. It performs no evaluator,
  Knowledge/Evidence or Task 11 callback. Application reloads the same terminal authority and requires
  exactly one matching history pair; partial success is impossible. Separate-connection identical races
  converge to one pair, while changed-remainder races yield one winner and `integrity_mismatch`, never
  UNIQUE/BUSY.
- Presentation verifies the complete source graph and calls no official source, request-step or safety-search port. Two presentations must be canonically equal and leave all relevant rows byte-for-byte unchanged.

## Full acceptance gate

Run sequentially; do not run the full test suite concurrently with the production build:

```bash
./node_modules/.bin/vitest run
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/eslint .
./node_modules/.bin/next build
git diff --check
! rg -n -i \
  'openai|anthropic|gemini|langchain|llamaindex|llm[_-]?|model[_-]?name' \
  src tests evals package.json pnpm-lock.yaml .env.example
```

Then execute the deterministic replay proof from the delivery plan and one isolated official-source walkthrough. Follow the then-current local `AGENTS.md` browser rule: an explicit chat-wide read-only permission may cover navigation in that chat, but downloads, forms, uploads, sign-in and any other external side effect still require separate immediate confirmation. Use a temporary database; never touch a developer database or fabricate a successful source outcome.

## Definition of done

VS-4A is complete only when:

- all five linked plans are implemented and locally reviewed;
- the official installed package has a sealed `city-catalog@2` projection and complete deterministic four-fact plans; each city fact may close as `verified | unknown`, while missing catalog artifacts or incomplete plan policy still block installation and publication;
- terminal selection and sibling branch publication are demonstrated on persisted data;
- replay is canonical and zero official/search network;
- canonical docs and the active change package are updated;
- implementation evidence is approved by the user before status/push work.

No plan authorizes push, merge, PR creation or status promotion by itself.
