# City official-source recovery: first durable beta vertical

> Status: implementation-ready under the approved 2026-08-28 local Codex/source-recovery design.
> This plan adds no new product policy and requires no manual source-replacement approval.

**Goal:** deliver one executable local-beta vertical for an already installed city fact:

```text
verified SI city package/manifest
  -> check the effective Ljubljana safety source
  -> deterministic green/red when the official observation is usable
  -> provisional yellow when the source is broken/stale/not covering the fact
  -> bounded local-Codex official-source discovery
  -> existing authority/capture/parser gates
  -> one atomic Evidence -> Knowledge -> Frontier + SourceBinding + audit commit
  -> direct public source link and reviewable local owner audit
```

The vertical is deliberately one city and one existing fact definition first. It proves the
architecture before the same mechanism is applied to the remaining demo jobs. It does not turn the
subjective demo seed into installed data or Evidence.

## Non-negotiable boundaries

- Git/GitHub only. No Arc, Tracker, Arcanum or other Yandex infrastructure.
- No browser automation. Offline tests use fake model/search/capture ports. Live checks are explicit
  local opt-in commands using the already attested Codex runtime and reviewed source gateway.
- Installed city packages, manifests, catalogs and historical Evidence are immutable.
- Codex returns only untrusted extraction/search proposals. It never writes SourceBinding, Evidence,
  Knowledge, Frontier, audit or verdicts.
- Package, manifest, active binding, authority directory and exact policy versions are independently
  verified before model/network/write.
- A technical failure never becomes red. Green/red require verified Evidence. Exhausted recovery is
  yellow.
- A yellow/no-candidate/search-not-performed outcome does not mutate SourceBinding, Evidence,
  Knowledge or Frontier. It may append a bounded, confidentiality-safe recovery-attempt audit row.
- A successful replacement is automatic. There is no manual confirmation step.
- The successful publication is one SQLite `BEGIN IMMEDIATE` unit: Evidence, Knowledge, Frontier,
  SourceVersion, SourceBinding CAS and `official-source-replaced@1` either all commit or all roll back.
- Abort, loss of flight ownership or CAS loss before commit produces no late truth write.
- Known historical contracts remain replayable; unknown `@999` schemas fail closed. A legitimate
  `revisionOrdinal: 999` remains valid history.
- `dev-llm` and the external API provider remain backlog-only.

## Chosen first vertical

- Entity: installed Slovenia city catalog member `ljubljana`.
- Fact: existing `si-city-safety` / `si-municipal-police-offences-per-100000@1`.
- Parser/policy: existing deterministic safety inspection, official authority directory, reference
  period classifier and City Frontier criterion evaluator.
- Discovery: existing `OfficialSourceDiscoveryPort` backed locally by exact `gpt-5.4 medium` native
  web search. Terra remains the extraction/onboarding model; no model or effort above the approved
  mapping is introduced.
- Publication consumer: existing City Evidence, City Knowledge and City Frontier chain.

The current deterministic safety parser is stronger than an LLM parser and remains final authority.
`source.extract` is added only after this vertical works; it will propose an exact quote/observation
that the same local parser independently reproduces. It is not allowed to block the initial durable
recovery tracer bullet.

## Contracts to add

Create `src/application/city-source-recovery-contracts.ts` with descriptor-safe reconstruction,
owned copies and recursive freezing for these closed values.

### Binding identity and cursor

```ts
type CitySourceBindingKeyV1 = Readonly<{
  schemaVersion: "city-source-binding-key@1";
  countryCode: "SI";
  cityId: string;
  factKey: "si-city-safety";
  definitionId: "si-municipal-police-offences-per-100000@1";
}>;

type CitySourceBindingCursorV1 =
  | Readonly<{
      schemaVersion: "city-source-binding-cursor@1";
      kind: "installed";
      installedBindingDigest: string;
    }>
  | Readonly<{
      schemaVersion: "city-source-binding-cursor@1";
      kind: "override";
      revisionId: string;
      revisionOrdinal: number;
    }>;
```

The installed digest is derived only from the independently replayed package, manifest, catalog,
source plan and authority directory. It is not caller-supplied authority.

### Durable source version and binding revision

```ts
type CitySourceVersionV1 = Readonly<{
  schemaVersion: "source-version@1";
  id: string;
  bindingKey: CitySourceBindingKeyV1;
  publisherId: string;
  navigationUrl: string;
  requestedUrl: string;
  finalUrl: string;
  captureArtifactIds: readonly string[];
  captureSha256: readonly string[];
  evidenceSnapshotId: string;
  parserVersion: string;
  capturedAt: string;
}>;

type CitySourceBindingRevisionV1 = Readonly<{
  schemaVersion: "source-binding@1";
  id: string;
  bindingKey: CitySourceBindingKeyV1;
  revisionOrdinal: number;
  predecessorRevisionId: string | null;
  sourceVersionId: string;
  evidenceSnapshotId: string;
  knowledgeRevisionId: string;
  frontierRevisionId: string;
  policyVersion: "official-source-recovery@1";
  actor: "local_codex_recovery";
  parentRunId: string;
  createdAt: string;
}>;
```

The first override has ordinal `1`; ordinals are safe positive integers with no artificial low cap.
Rollback is another revision pointing to a previously verified SourceVersion.

### Audit and public projection

`OfficialSourceRecoveryAttemptV1` is internal and append-only. It stores the run/binding identity,
old/requested/final URLs, canonical old-source failure reason, query/template and exact runtime
metadata, bounded candidate accept/reject decisions, authority/policy versions, evidence hashes,
outcome and timestamps. It never stores questionnaire/profile values, tokens, raw prompts, source
projection, raw model output or unrelated journey history.

`OfficialSourceReplacedEventV1` has exact schema `official-source-replaced@1` and is stored in the
same successful transaction as the truth publication.

The only public/browser source DTO is the already approved shape:

```ts
type PublicFactSourceV1 = Readonly<{
  schemaVersion: "public-fact-source@1";
  factKey: string;
  status: "green" | "red" | "yellow";
  publisherName: string | null;
  sourceUrl: string | null;
  checkedAt: string | null;
}>;
```

For green/red, publisher/URL/time come only from verified Evidence and the exact SourceVersion.
Yellow may not expose a search candidate as a source. Replacement details remain in the internal
owner audit. This plan may render a local CLI/eval report for the owner, but it does not add a second
browser/public provenance DTO. A future UI history panel requires its own exact approved contract.

## Persistence shape

Add exact schema/preflight coverage for:

- `city_source_versions`: immutable signed/canonical SourceVersion payloads;
- `city_source_binding_revisions`: immutable one-root/one-successor history per binding key;
- `city_source_binding_heads`: one mutable CAS pointer per binding key, guarded by the installed
  binding digest and updated only inside the recovery store;
- `official_source_recovery_attempts`: immutable bounded attempt log;
- `official_source_replacement_events`: immutable exact `official-source-replaced@1` events.

All immutable tables receive UPDATE/DELETE rejection triggers. The head table has no public generic
update method: the store executes exact `UPDATE ... WHERE active_revision_id = ?` (or the first
installed-digest insert) and requires one changed row. Payload hash/HMAC, mirror columns, FKs and
canonical-byte equality are verified on every read.

`SqliteCitySourceRecoveryStore` exposes only:

```ts
loadEffectiveVerified(installedAuthority): EffectiveCitySourceBinding;
appendYellowAttempt(attempt): OfficialSourceRecoveryAttemptV1;
appendReplacement(input, expectedCursor): CitySourceBindingRevisionV1;
loadHistoryVerified(bindingKey, installedAuthority): readonly CitySourceBindingRevisionV1[];
loadOwnerAuditVerified(bindingKey, installedAuthority): readonly OfficialSourceRecoveryAttemptV1[];
```

`appendReplacement` is callable only from the shared continuation unit of work. Idempotency is by
exact recovery run/command identity. A repeated equal command returns the same revision; a different
payload under the same command fails integrity.

## Transaction boundary

Add an inward `CityContinuationUnitOfWorkPort` with one synchronous `run` operation. The SQLite
adapter wraps it in `database.transaction(operation).immediate()`. All participating stores share
the exact same `better-sqlite3` connection.

Refactor only the minimum asynchronous wrapper that prevents use inside the transaction:

- expose an internal synchronous City Evidence replay function while keeping the public Promise API;
- split each participating store into a transaction-neutral internal operation and its existing
  public transaction-owning wrapper: `sealInTransaction`,
  `publishFromEvidenceInTransaction`, and `appendRevisionInTransaction`;
- the outer recovery UoW calls only those transaction-neutral operations; none may execute inner
  `BEGIN`, `COMMIT`, `ROLLBACK` or an independent `database.transaction(...).immediate()`;
- keep model/network/event emission outside the transaction;
- keep sealing/reconstruction/semantic checks in Application/Decision;
- run the existing evidence seal, verified replay, knowledge publication, frontier append and the
  optional binding replacement/audit synchronously inside the outer transaction;
- emit `evidence_verified`, `knowledge_published`, replacement and completion events only after the
  transaction commits.

The existing public store methods retain their current transaction wrappers and delegate to the same
internal operations. No nested transaction strategy is used. Integration tests must prove an outer
injected failure after each internal write rolls every participating table back. Do not duplicate
the Evidence/Knowledge/Frontier SQL or semantic validators in the recovery store.

## Application flow

Add a beta continuation method without breaking the frozen legacy return type:

```ts
continueCityFrontierWithSourceRecovery(
  prepared,
  emit,
  signal,
): Promise<
  | { schemaVersion: "city-source-recovery-outcome@1"; kind: "advanced"; readModel: CityFrontierReadModel }
  | { schemaVersion: "city-source-recovery-outcome@1"; kind: "yellow"; source: PublicFactSourceV1 }
>;
```

The legacy `continueCityFrontier` remains a compatibility surface until the beta route/UI is moved;
the two methods share one internal continuation implementation and one keyed flight, not two copies
of semantics.

Exact order:

1. replay installed package, manifest, catalog, criteria, ranking and authority directory;
2. derive installed binding digest and load the effective binding/history;
3. check abort/ownership;
4. inspect the effective prior URL first through existing authority/network/parser gates;
5. when it is usable, continue normal deterministic publication with no binding revision;
6. when it fails, classify one canonical recovery reason and enter provisional yellow;
7. call at most two `OfficialSourceDiscoveryPort` rounds under the existing shared deadline/signal;
8. pass every untrusted candidate through existing canonical URL, publisher authority-chain,
   redirect/MIME/size/capture/hash and deterministic parser gates;
9. if no usable candidate or `codex_search_not_performed`, append only the safe attempt record and
   return frozen yellow; do not seal/publish truth;
10. if a candidate is usable, prepare the same city evidence/knowledge/frontier values as normal;
11. recheck abort/flight ownership and every integrity invariant;
12. enter one immediate transaction, publish Evidence -> replay -> Knowledge -> Frontier, CAS the
    binding, append replacement audit/event, then commit;
13. after commit emit the closed progress/replacement events and return `advanced`.

Integrity/protocol/authority failures remain terminal rather than being mislabeled yellow. Timeout,
rate/provider unavailable and honest no-search/no-candidate exhaustion are yellow. No retry is added
outside the existing two discovery rounds.

## Discovery integration

Do not loosen `OfficialSourceDiscoveryPort` or trust its claimed publisher/rationale. Add a narrow
`CitySafetyOfficialDiscoveryAdapter` that supplies the already verified entity, fact, failed URL,
canonical failure reason, authority roots and locale hints. It converts only candidate URLs into the
existing safety candidate-inspection queue and retains exact reviewed runtime metadata for internal
audit.

- Round is exactly `1 | 2`.
- At most five candidates per round and existing global candidate bounds remain.
- Positive candidate hints require native-search proof from the reviewed runtime adapter.
- `codex_search_not_performed` and bounded provider unavailability produce yellow.
- malformed metadata, tool/file events, unsafe URL or authority mismatch fail closed.
- claimed publisher, expected coverage, rationale and snippets never become Evidence.

The existing hosted city-safety search endpoint remains untouched; the deferred provider switch is
not implemented. The new local-beta composition injects the Codex discovery adapter explicitly.

## Events and composition

Extend the closed beta event projection with only:

- `source_recovery_started` (no URL/query/model fields);
- `source_recovery_yellow` (canonical public reason only);
- `official_source_replaced` carrying only the already reconstructed current
  `PublicFactSourceV1`; no historical URL, query, rationale or audit identity;

Wire one `SqliteCitySourceRecoveryStore`, one shared SQLite unit of work and one lazily constructed
Codex discovery adapter in `city-frontier-composition.ts`. Production must still verify the reviewed
Codex installation before the first model child. The composition return exposes the beta continuation
only; stores, UoW, internal owner audit and model adapters do not escape to the browser API.

Update the beta API/stream decoder/UI only after the Application/composition vertical is green. The
screen must show yellow honestly and show the direct current source for green/red. The owner receives
the detailed replacement audit through the sanitized local walkthrough report until a separate exact
UI history contract is approved.

## Implementation sequence

### Milestone 1 — compiling contracts and durable binding skeleton

Files:

- create `src/application/city-source-recovery-contracts.ts`;
- create `src/application/city-source-recovery.ts` with the closed ports/pure projections only;
- create `src/infrastructure/sqlite/city-source-recovery-store.ts`;
- update `src/infrastructure/sqlite/schema.sql` and `src/infrastructure/sqlite/db.ts` preflight;
- create `tests/application/city-source-recovery-contracts.test.ts`;
- create `tests/integration/city-source-recovery-store.test.ts`.

RED only for actual ambiguities found while writing production. Initial tests pin exact DTO keys,
ownership/freeze, installed cursor, append-only ordinal/history, idempotency, CAS winner/loser,
reopen/tamper and `@999` versus ordinal 999. Then immediately typecheck and run targeted Vitest.

Checkpoint: one local Git commit; one implementation reviewer and one integrity reviewer.

### Milestone 2 — one normal check plus honest yellow

Files:

- update `src/application/run-city-safety-discovery.ts` and its narrow contracts;
- create `src/application/city-safety-official-discovery.ts`;
- update `src/application/city-frontier.ts` only at the shared continuation/research seam;
- extend existing focused safety/frontier tests rather than duplicating lower-layer gateway tests.

Prove:

- independently verified prior binding is inspected first;
- usable prior source performs no discovery and creates no binding revision;
- stale/unavailable/not-covering prior source enters recovery, never red;
- no candidate/search-not-performed returns frozen yellow with zero truth-table changes;
- authority/integrity failure occurs before discovery/network/write where applicable.

Checkpoint and milestone review.

### Milestone 3 — successful recovery and atomic publication

Files:

- add `CityContinuationUnitOfWorkPort` to the inward city application contracts;
- add the SQLite unit-of-work implementation;
- add transaction-neutral `sealInTransaction`, `publishFromEvidenceInTransaction` and
  `appendRevisionInTransaction` internals while preserving the existing public wrappers;
- expose internal synchronous replay in `src/application/replay-city-evidence.ts`;
- integrate `SqliteCitySourceRecoveryStore` in `city-frontier-composition.ts`;
- update the city continuation integration tests.

Prove one candidate passes authority/capture/parser, then one immediate transaction commits exact
Evidence, Knowledge, Frontier, SourceVersion, binding head/revision and replacement event. Inject a
throw before every write boundary and assert old heads plus row counts remain unchanged. Run two
connections against one cursor and assert one CAS winner, no last-writer-wins overwrite and readable
winner history.

Checkpoint; executable reviewer plus mandatory persistence/concurrency/security reviewer.

### Milestone 4 — events, the sole public source DTO and composition/API

Files:

- extend `src/application/city-frontier-contracts.ts` with the three beta event cases;
- update composition and beta route/stream response/decoder;
- add only the closed `PublicFactSourceV1` projection;
- update the smallest relevant Experience component to render yellow, direct source and replacement
  summary.

Tests pin exact browser-safe keys, recursive ownership/freeze, confidentiality and no search candidate
as a yellow source. Do not duplicate Evidence or gateway semantics at every surface.

Checkpoint and milestone review.

### Milestone 5 — source.extract proposal gate

After the durable vertical works, add `SourceObservationPort` and the Terra low -> one medium retry
adapter. It receives only a bounded public `SourceExcerptProjection`, returns an exact quote plus
observation proposal, and uses zero tools. Infrastructure derives quote bounds; the versioned local
city-safety parser must independently reproduce the same observation/period/unit. Mismatch or
ambiguity is yellow and never Evidence. Raw capture/projection/model output stays memory-only.

This milestone gets its own focused plan amendment if production uncovers a fact-specific parser
ambiguity. It may not delay the working deterministic recovery vertical.

### Milestone 6 — abort/recovery/concurrency/history hardening

Add only executable tests for:

- all-waiter abort and no late write;
- one waiter detach without canceling a shared leader;
- same binding/same command single-flight;
- different cities through pool ceilings 1/2/5 without cross-job leakage;
- crash after transaction rollback and idempotent retry;
- historical replay at an old binding revision with zero model/network/current-source calls;
- supported package/catalog/source `@1/@2` history and unknown `@999` fail-closed;
- confidentiality and hostile proxy/accessor/borrowed buffer boundaries.

Second reviewer is mandatory for integrity/persistence/concurrency/security only. Non-correctness
Important findings go to the hardening backlog and do not reopen already proven earlier verticals.

### Milestone 7 — explicit local live gate and expansion

Create a sanitized opt-in eval for one Ljubljana safety recovery scenario:

```text
known broken/stale URL
  -> local Codex discovery with positive native-search proof
  -> official candidate
  -> authority/capture/parser gates
  -> atomic replacement
  -> repeat check uses the replacement first
```

The artifact contains only closed outcome/count/version/timing/hashes and no prompt, query, source
content, credentials or raw model output. Also prove the no-search/no-candidate yellow path has no
truth mutation.

Only after that gate is stable, run one five-city SI batch, then plan/install authoritative packages
for other demo countries. The non-authoritative 10x5 seed remains only a job planner.

## Executable feedback after every milestone

Focused commands are selected from the changed files, followed by:

```bash
pnpm typecheck
pnpm lint
git diff --check
```

At milestone closure:

```bash
pnpm test
```

Live model/search commands are never part of ordinary CI and run only after offline tests, one
implementation review and the risk review required for that milestone.

## Definition of done for this plan

- One local Ljubljana safety check proves normal green/red from verified Evidence.
- A broken/stale source produces yellow rather than red.
- At least one real official candidate completes automatic replacement with a direct public URL and
  a reviewable sanitized local owner-audit report.
- Repeating the fact check reads and revalidates the new effective source first.
- No-candidate/search-not-performed produces yellow with zero SourceBinding/Evidence/Knowledge/
  Frontier mutation.
- Package/manifest/authority/policy gates precede model/network/write.
- Successful replacement is atomic across all truth and audit records; injected failures and CAS
  races leave no partial publication.
- Abort and lost ownership cannot write late.
- Historical replay is offline and exact; `@999` contracts fail closed while ordinal 999 remains valid.
- Public DTOs are closed, owned and recursively frozen; confidentiality tests pass.
- Full offline suite, typecheck, lint and diff-check pass; reviewers report no Critical/Important
  correctness findings.
