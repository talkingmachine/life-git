# VS-4A City Frontier Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn one verified effective-green country into a frozen, official-data city search that checks cities in rank order, returns up to three selectable cities, and atomically records the selected city as the first alternative Life Git branch.

**Architecture:** VS-4A is a new vertical slice, not an extension of the country ranker. Pure `city-*` Decision modules own catalog membership, criteria, exact Decimal ranking, frontier state and warning/selectability policy. Research owns one installed official country package and full four-fact City Evidence/Knowledge publication. Application orchestrates zero-network Start/Present, one-city-per-command Continue, and atomic Select. SQLite stores only canonical append-only artifacts; Experience consumes strict JSON/finite-NDJSON read models and reuses the existing globe presentation without putting city policy in React.

**Tech Stack:** Node 24, TypeScript 6.0.3, Next.js 16.3.0, React 19.2.8, SQLite/better-sqlite3 13.0.3, Vitest 4.1.10, Zod 4.4.3, Decimal.js 10.6.0, the existing Evidence pipeline, finite-NDJSON reader and globe components.

**Approved design:** [`docs/superpowers/specs/2026-08-13-vs-4a-city-frontier-design.md`](../specs/2026-08-13-vs-4a-city-frontier-design.md)

**Split rationale:** This index is intentionally linked to four reviewer-sized plans. Catalog/ranking, Evidence/Knowledge, orchestration/persistence and delivery have different owners and failure modes; combining their executable steps would violate the documentation constitution's size and single-responsibility rules.

## Linked execution plans

Execute strictly in this order:

1. [`VS-4A Foundations`](2026-08-13-vs-4a-city-frontier-foundations.md) — canonical change package, official-source feasibility, City Catalog, Criteria and Ranker.
2. [`VS-4A Evidence and Knowledge`](2026-08-13-vs-4a-city-frontier-knowledge.md) — city Evidence overlay, full four-fact Knowledge, replay and stores.
3. [`VS-4A Frontier Core`](2026-08-13-vs-4a-city-frontier-core.md) — frontier policy, snapshots, SQLite chain, Application, selection and sibling branches.
4. [`VS-4A Delivery`](2026-08-13-vs-4a-city-frontier-delivery.md) — strict transport, browser-safe projection, UI/globe, reload and acceptance evidence.

Each numbered task ends in a local commit and a fresh focused gate. Do not begin a later plan while an earlier plan has a failed gate or unresolved review finding.

## Global constraints

- Entry is only `requireResolvedCountryShortlistForCity(revisionId)` plus exact membership of the selected effective-green country. Automatic, working, empty, tampered and effective-red country states fail closed.
- City fit never changes a country's formal or effective status. Accepted formal-yellow remains formal yellow and effective green internally.
- The automatic universe is the installed official city/municipal-center catalog: population `>= 20000`, national and explicitly typed regional capitals regardless of population, then largest comparable official centers until at least ten when available. More than ten are never truncated.
- The first production slice installs exactly one country package. A package is unavailable unless an official field map proves catalog coverage and deterministic validators for safety, long-term rent, urban transit and fixed broadband.
- City Criteria and City Ranker are separate modules. Do not edit or reuse `preference-profile.ts`, `place-ranker.ts`, `place-package.ts` or their country snapshots for city semantics.
- Unknown contributes factor `0`, retains its importance in the denominator, lowers coverage and warns. Only a fresh comparable verified required mismatch excludes a city.
- Ranking is frozen across the full catalog. Live Knowledge changes fresh facts and verification coverage only; it never changes current-run rank/score/order.
- Continue checks exactly one frozen candidate and all four facts. Only Continue may call official HTTPS. Start, Present, reload and Select are zero-network.
- A completed check publishes sealed Evidence, then a full four-fact City Knowledge revision, then a frontier successor. No old fact value is carried into a new city revision.
- Crash, cancel, storage, integrity, protocol or unexpected errors do not become domain unknown and do not advance the cursor. A completed Evidence/Knowledge result survives a later frontier append failure and is reused without network.
- Marker states are `pending`, `selectable`, `excluded`; there is no city yellow. Selectable with unknown uses the same green marker plus an amber warning ring and explicit text.
- Stop is exactly three selectable cities or catalog exhaustion. Terminal `0..2` is valid; Select requires terminal `1..3` and an exact terminal entry.
- Selection warning basis is server-derived. The client supplies only terminal ID, city ID, command ID and `city-unknown-risk@1` iff warnings were displayed.
- Selection and City Branch Commit are one SQLite transaction. Alternative selections from the same terminal are sibling commits with `parentId = forkedFrom = preCityBranchCommitId`.
- Raw official bytes stay only in existing Evidence artifact storage. City Knowledge never stores user criteria, score, suitability or raw bytes.
- Runtime provider/LLM/API calls, SDKs, keys and model abstractions remain exactly zero.
- Do not add a crawler, event store, queue, worker, polling, ORM, mutable head table, jobs/housing/budget flow or universal city ontology.
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

export type CityMarkerStatus = "pending" | "selectable" | "excluded";
export type CityFrontierStopCondition = "three_selectable" | "catalog_exhausted";

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
```

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

Decision imports neither Research revisions nor Application/SQLite/React. Research does not import Application. Application defines ports; infrastructure implements them. Experience may runtime-import only browser-safe Decision/Experience modules and type-import Application contracts.

## Common command and recovery rules

- Start derives deterministic run/artifact IDs from resolved-country revision + country + Registry/catalog + criteria payload + rules versions and persists the client command ID in the root. Identical retry converges; the same command ID with altered payload is `integrity_mismatch`.
- Continue uses `(runId, expectedRevisionId, commandId)`. A moved head is `stale_city_frontier_head`; a committed identical command replays its result.
- A continuation's deterministic `cityCheckRunId` is derived from `runId + cityId + rankingSnapshotId`. Present-first recovery checks sealed City Evidence and published Knowledge before any source call.
- A committed marker event is emitted only after the frontier append. Every Continue then emits exactly one `city_continuation_completed` carrying the verified working-or-terminal read model; the route withholds that frame until clean EOF, and its model must canonically equal the callback return.
- Select is idempotent per `(runId, commandId, canonical payload)`. The atomic writer inserts or exact-replays both selection and branch; partial success is impossible.
- Presentation verifies the complete source graph and calls no source, request-step or provider port. Two presentations must be canonically equal and leave all relevant rows byte-for-byte unchanged.

## Full acceptance gate

Run sequentially; do not run the full test suite concurrently with the production build:

```bash
./node_modules/.bin/vitest run
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/eslint .
./node_modules/.bin/next build
git diff --check
! rg -n -i \
  'openai|anthropic|gemini|langchain|llamaindex|api[_-]?key|model[_-]?name' \
  src tests evals package.json pnpm-lock.yaml .env.example
```

Then execute the deterministic replay proof from the delivery plan and one isolated official-source browser walkthrough. Immediately before every browser opening or browser-tool call, stop, state the exact intended action, ask the user for explicit permission and wait for the answer. No earlier or blanket permission carries into that action. Use a temporary database; never touch a developer database or fabricate a successful source outcome.

## Definition of done

VS-4A is complete only when:

- all four linked plans are implemented and locally reviewed;
- the official installed package passed the source feasibility gate;
- terminal selection and sibling branch publication are demonstrated on persisted data;
- replay is canonical and zero-network;
- canonical docs and the active change package are updated;
- implementation evidence is approved by the user before status/push work.

No plan authorizes push, merge, PR creation or status promotion by itself.
