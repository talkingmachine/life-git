# VS-2 Honest Cold Start Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the approved Slovenia cold start: discover and recapture official sources on every current run, publish an immutable country dossier only after all nine critical claim kinds verify, compare it with one confirmed relocation profile, and show factual progress on the globe through a finite typed stream.

**Architecture:** Keep one modular-monolith evidence path. A plan-parameterized Research core owns capture, raw persistence, validation, signed Evidence construction and offline replay; the existing VS-1 exports remain compatibility wrappers over that core, while VS-2 atomically persists full Evidence+dossier. Cold Start adds only one Slovenia registry entry, one discovery adapter, three installed Slovenia source bundles, one append-only dossier table, one comparator and one finite NDJSON HTTP adapter. Experience projects typed events and never derives evidence or a verdict.

**Tech Stack:** Node 24, pnpm 11, Next.js 16.3.0 Route Handlers, React 19.2.8, TypeScript 6.0.3, SQLite (`better-sqlite3` 13.0.3), Vitest 4.1.10, Zod 4.4.3, Decimal.js 10.6.0, OpenAI SDK 7.4.0, Cheerio 1.2.0, `fast-xml-parser` 5.10.1, existing Three.js / `react-globe.gl` presentation.

**Normative spec:** [`VS-2 approved baseline`](../../changes/active/vs-2-honest-cold-start/change.md).

## Global Constraints

- Slovenia (`SI`) is the only installed cold-start country. The Country Registry contains names, aliases, coordinates and official authority roots, never a prewritten dossier or remembered legal values.
- One shared `prepareEvidencePlan` core owns current capture, exact raw bytes, validation and construction of the signed Evidence value. Existing `runEvidencePlan`/`runCurrentEvidence` commit that value through the Evidence store; VS-2 commits the same prepared value together with a full dossier in one SQLite transaction. `sealEvidence` and `replayEvidence` retain their current public signatures and exact VS-1 serialization through compatibility wrappers; no second evidence store or runner is permitted.
- The Slovenia plan has three country source bundles plus the already installed CBR EUR/RUB source: route (`GOV.SI + ZTuj-2`), income (`PISRS publication + complete SiStat listing/series`), and companion employment (`ESS + ZZSDT`). At most six discovered candidates and ten HTTP captures are allowed.
- The nine dossier claim kinds are exact and closed: route basis, citizenship applicability, remote-work relations, income, qualification, companion entry, companion local-work access, duration, and general statutory prerequisites. Unsupported semantics, duplicate/conflicting claims, an incomplete listing or a non-latest applicable period fail closed.
- Discovery receives only country, authority roots and claim kinds. It receives no profile, income, citizenship, free text or PII. Model output is an untrusted URL proposal; only installed deterministic validators can create a claim.
- One discovery model call is allowed. No model extraction call is needed for the installed Slovenia path; deterministic parsers consume captured bytes. The hard ceiling remains two model calls.
- Current-run limits are 60 seconds, concurrency three, one retry token per planned source bundle only for timeout/429/5xx, 30 MiB per artifact, six discovery candidates and ten request steps including retries.
- A full nine-kind country payload may publish even when current FX or the user does not pass. Missing country coverage means no dossier; missing current FX or a personal prerequisite means yellow unless another verified personal hard veto already proves red.
- Marker semantics are closed: gray while events are arriving; red only for a verified personal veto; yellow for incomplete research, missing personal evidence, or country-compatible/city-unverified; green is unreachable in VS-2.
- SQLite gains exactly one table, `dossier_versions`. It gains no source table, cold-start run table, queue, event store or cache table. Existing `profile_snapshots`, `artifacts` and `evidence_snapshots` are reused.
- Terminal reload uses immutable inputs instead of storing a personal verdict in the dossier: the URL carries `run` and `profile`; a `contextHash=SHA-256(canonical({runId,profileId}))` inside the VS-2 Evidence Snapshot/HMAC binds them without exposing profile facts. The presenter reloads the confirmed relocation profile and `${run}:evidence`, verifies that binding, replays without network, finds the matching dossier payload when one exists, and recalculates the exact comparator. This is the persisted terminal representation and lets a response disconnected after publication recover without violating dossier privacy.
- The only streaming adapter is one finite `POST /api/cold-start` NDJSON response. There is no Server Action progress, polling, SSE, WebSocket, worker or background continuation. On a full-coverage path, the request `AbortSignal` cancels before the single Evidence+dossier transaction; after it starts, synchronous SQLite commit is the boundary and the immutable version stands. On a blocked path, the equivalent terminal commit is the blocked Evidence seal. Raw artifacts appended before either boundary may remain unsealed.
- Progress is event-driven only. The globe flight is visual and never advances Research. No future timeline rows, simulated percentages or timers are allowed.
- Exactly three new logical test files are used: `TEST-VS2-RESEARCH`, `TEST-VS2-INTEGRATION`, and `TEST-VS2-EXPERIENCE`. Existing regression tests may receive small assertions, but there is no country/layout matrix or coverage target.
- Browser E2E is one scenario only. Repository instructions require a fresh explicit user permission immediately before that browser invocation, even if permission was granted earlier.
- No universal crawler, country plugin framework, generic rules platform, ORM, provider abstraction, arbitrary facts map, top-5/ranking, city research, salary catalogue or life simulation enters VS-2.

## File Map

```text
src/research/{contracts,research-plan,cold-start-contracts,country-registry,slovenia-plan,dossier}.ts
src/research/parsers/slovenia.ts
src/infrastructure/sources/{official-source-discovery,slovenia-source-adapter}.ts
src/infrastructure/sqlite/{schema.sql,evidence-store,profile-store,dossier-store}.ts
src/infrastructure/{cold-start-composition,composition-root}.ts
src/application/{replay-evidence,cold-start}.ts
src/decision/{relocation-profile,cold-start-assessment}.ts
src/app/api/cold-start/route.ts  src/app/page.tsx
src/experience/{cold-start-stream,cold-start-view-model,run-url}.ts
src/experience/components/{ColdStartStart,ColdStartJourney,ColdStartComparator}.tsx
tests/research/cold-start.test.ts
tests/integration/cold-start.test.ts
tests/integration/cold-start-experience.test.tsx
evals/vs2-live.ts
```

Traceability: `REQ-VS2-01` -> Tasks 1,2,4,5; `REQ-VS2-02` -> Tasks 1–3; `REQ-VS2-03` -> Tasks 3–5; `REQ-VS2-04` -> Tasks 4–5; `REQ-VS2-05` -> Tasks 1,3,4,6. `NFR-VS2-01..03` are exercised by Tasks 1–3 and 6; the structural exclusions in `NFR-VS2-04` are reviewed in every task.

## Published Contract

These are the exact boundary shapes. Helpers may be private; public fields and discriminants must not gain alternate untyped forms.

```ts
type CountryCode = "SI";

interface CountryRef {
  readonly code: "SI";
  readonly englishName: "Slovenia";
  readonly displayName: "Словения";
  readonly flag: "🇸🇮";
  readonly coordinate: { readonly lat: 46.1512; readonly lng: 14.9955 };
}

type ClaimKind =
  | "route_basis"
  | "citizenship_applicability"
  | "remote_work_relations"
  | "income"
  | "qualification"
  | "companion_entry"
  | "companion_local_work_access"
  | "duration"
  | "general_statutory_prerequisites";

interface ClaimValueByKind {
  readonly route_basis: {
    readonly route: "temporary_residence_digital_nomad";
    readonly legalBasis: "ZTuj-2 Article 51a";
    readonly effectiveFrom: "2025-11-21";
  };
  readonly citizenship_applicability: {
    readonly eligibleCategory: "third_country_national";
    readonly explicitNationalityExclusions: readonly string[];
  };
  readonly remote_work_relations: {
    readonly allowedRelations: readonly (
      | "foreign_employer"
      | "own_foreign_business"
      | "foreign_clients"
    )[];
    readonly slovenianLabourMarketWorkIncluded: false;
  };
  readonly income: {
    readonly metric: "latest_official_average_monthly_net_salary";
    readonly multiplier: "2";
    readonly thresholdEur: string;
    readonly period: string;
  };
  readonly qualification: {
    readonly rule: "not_listed_in_authoritative_requirements";
  };
  readonly companion_entry: {
    readonly rule: "immediate_family_reunification_without_waiting_period";
  };
  readonly companion_local_work_access: {
    readonly access: "conditional";
    readonly labourMarketCheck: true;
    readonly informationSheet: true;
  };
  readonly duration: {
    readonly maximumMonths: 12;
    readonly extendable: false;
    readonly reapplyAfterMonths: 6;
  };
  readonly general_statutory_prerequisites: {
    readonly passportBeyondPermitMonths: 3;
    readonly healthInsurance: true;
    readonly article55GroundsApply: true;
  };
}

type SloveniaSourceId =
  | "si-digital-nomad-route"
  | "si-income-threshold"
  | "si-companion-employment"
  | "cbr-eur";

interface CountryEvidenceRef {
  readonly sourceId: SloveniaSourceId;
  readonly artifactId: string;
  readonly navigationUrl: string;
  readonly resolvedEvidenceUrl: string;
  readonly sourcePeriod: string;
  readonly anchor: ClaimAnchor;
}

interface VerifiedCountryClaim<K extends ClaimKind = ClaimKind>
  extends Claim<ClaimValueByKind[K], SloveniaSourceId> {
  readonly claimKind: K;
  readonly evidence: readonly CountryEvidenceRef[];
  readonly validatorVersion: string;
}

type ColdStartEvidenceClaim =
  | VerifiedCountryClaim
  | Claim<CbrEurFacts, "cbr-eur">;

interface DossierClaim<K extends ClaimKind = ClaimKind> {
  readonly claimId: string;
  readonly claimKind: K;
  readonly value: ClaimValueByKind[K];
  readonly validatorVersion: string;
  readonly evidence: readonly {
    readonly sourceId: SloveniaSourceId;
    readonly navigationUrl: string;
    readonly resolvedEvidenceUrl: string;
    readonly sourcePeriod: string;
    readonly locator: string;
    readonly excerptSha256: string;
  }[];
}

interface SourceCandidate {
  readonly candidateId: string;
  readonly url: string;
  readonly authorityRoot: string;
  readonly claimKinds: readonly ClaimKind[];
  readonly discoveredFrom: "registry";
}

interface ResearchPlan<S extends string, C extends Claim<unknown, S>> {
  readonly id: string;
  readonly scope: string;
  readonly sourceIds: readonly S[];
  readonly sourceNavigation: Readonly<Record<S, string>>;
  readonly parserVersions: Readonly<Record<S, string>>;
  readonly rulesVersion: string;
  readonly limits: {
    readonly concurrency: number;
    readonly maxCaptures: number;
    readonly deadlineMs: number;
  };
  validate(entry: ParserEntry<S>, assessmentAt: string): Promise<
    | { readonly ok: true; readonly claims: readonly C[] }
    | { readonly ok: false; readonly kind: "integrity_mismatch" | "semantic_mismatch" | "stale" | "conflict" }
  >;
  applyRules(
    entries: readonly TerminalEvidenceEntry<S, C>[],
    assessmentAt: string,
  ): readonly TerminalEvidenceEntry<S, C>[];
}

type EvidenceProgress<S extends string, C extends Claim<unknown, S>> =
  | { readonly type: "artifact_captured"; readonly sourceId: S; readonly artifact: LiveCapturedArtifact<S> }
  | { readonly type: "claim_verified"; readonly sourceId: S; readonly claim: C };

declare function runEvidencePlan<S extends string, C extends Claim<unknown, S>>(
  input: {
    readonly runId: string;
    readonly assessmentDate: string;
    readonly deadlineAt: string;
    readonly signal?: AbortSignal;
    readonly contextHash?: string;
  },
  plan: ResearchPlan<S, C>,
  ports: {
    readonly source: OfficialSourcePort<S>;
    readonly requestStep: RequestStep<S>;
    readonly store: EvidenceWriteStore<S, C>;
    readonly integrity: EvidenceIntegrity;
    readonly onProgress?: (event: EvidenceProgress<S, C>) => void | Promise<void>;
  },
): Promise<EvidenceSnapshot<S, C>>;

declare function prepareEvidencePlan<S extends string, C extends Claim<unknown, S>>(
  input: {
    readonly runId: string;
    readonly assessmentDate: string;
    readonly deadlineAt: string;
    readonly signal?: AbortSignal;
    readonly contextHash?: string;
  },
  plan: ResearchPlan<S, C>,
  ports: {
    readonly source: OfficialSourcePort<S>;
    readonly requestStep: RequestStep<S>;
    readonly artifacts: Pick<EvidenceWriteStore<S, C>, "appendArtifact">;
    readonly integrity: EvidenceIntegrity;
    readonly onProgress?: (event: EvidenceProgress<S, C>) => void | Promise<void>;
  },
): Promise<SealedEvidence<S, C>>;

interface RelocationProfileDraft {
  readonly currentCountryCode: "RU";
  readonly citizenships: readonly ["RU"];
  readonly monthlyIncome: {
    readonly amount: string;
    readonly currency: "RUB";
    readonly basis: "net" | "gross" | "unknown";
  };
  readonly remoteWork: {
    readonly relation: "foreign_employment" | "foreign_service" | "unknown";
    readonly legallyAllowed: true | false | "unknown";
  };
  readonly education: "none" | "higher" | "unknown";
  readonly relevantExperienceYears: number | "unknown";
  readonly passportValidUntil: string | "unknown";
  readonly healthInsurance: "confirmed" | "not_confirmed" | "unknown";
  readonly companions: readonly {
    readonly relationship: "spouse" | "minor_child" | "other_family";
  }[];
}

interface RelocationProfileSnapshot {
  readonly schemaVersion: "relocation-profile@1";
  readonly id: string;
  readonly confirmedAt: string;
  readonly profile: RelocationProfileDraft;
}

interface CountryDossierPayload {
  readonly country: CountryRef;
  readonly schemaVersion: "si-dossier@1";
  readonly claims: readonly DossierClaim[];
}

interface DossierVersion {
  readonly id: string;
  readonly ordinal: number;
  readonly countryCode: CountryCode;
  readonly predecessorId?: string;
  readonly evidenceSnapshotId: string;
  readonly schemaVersion: "si-dossier@1";
  readonly payload: CountryDossierPayload;
  readonly payloadHash: string;
  readonly manifestHash: string;
  readonly hmac: string;
  readonly publishedAt: string;
}

interface DossierPublishResult {
  readonly version: DossierVersion;
  readonly created: boolean;
}

interface ColdStartFormula {
  readonly formulaId: "FORMULA-VS2-INCOME-01";
  readonly formulaVersion: "1";
  readonly expression: "monthlyIncomeRub / eurRub < thresholdEur";
  readonly monthlyIncomeRub: string;
  readonly eurRub: string;
  readonly incomeEur: string;
  readonly thresholdEur: string;
  readonly rounding: "UNROUNDED_THEN_HALF_UP_2DP";
  readonly sourceClaimIds: readonly string[];
}

interface ColdStartComparator {
  readonly marker: "red" | "yellow";
  readonly personalFit:
    | "verified_veto"
    | "research_incomplete"
    | "personal_evidence_missing"
    | "route_compatible_city_unverified";
  readonly cityScope: "not_checked";
  readonly reasons: readonly {
    readonly code: string;
    readonly summary: string;
    readonly claimIds: readonly string[];
    readonly officialUrls: readonly string[];
  }[];
  readonly formula?: ColdStartFormula;
}

interface ColdStartReadModel {
  readonly runId: string;
  readonly country: CountryRef;
  readonly checkedAt: string;
  readonly evidenceSnapshotId: string;
  readonly assessmentRulesVersion: "cold-start-assessment@1";
  readonly dossier?: {
    readonly id: string;
    readonly label: string;
    readonly publishedAt: string;
  };
  readonly coverage: {
    readonly verified: number;
    readonly required: 9;
    readonly claimKinds: readonly ClaimKind[];
  };
  readonly comparator: ColdStartComparator;
  readonly sourceNavigation: readonly {
    readonly label: string;
    readonly url: string;
  }[];
}

type ColdStartEvent =
  | ColdStartEventBase<"source_discovered", {
      readonly candidateId: string;
      readonly url: string;
      readonly claimKinds: readonly ClaimKind[];
    }>
  | ColdStartEventBase<"authority_verified", {
      readonly candidateId: string;
      readonly authorityRoot: string;
    }>
  | ColdStartEventBase<"artifact_captured", {
      readonly sourceId: SloveniaSourceId;
      readonly role: string;
      readonly resolvedUrl: string;
      readonly sha256: string;
    }>
  | ColdStartEventBase<"claim_verified", {
      readonly claimId: string;
      readonly claimKind: ClaimKind | "fx_rate";
      readonly sourceIds: readonly SloveniaSourceId[];
    }>
  | ColdStartEventBase<"dossier_published", {
      readonly dossierVersionId: string;
      readonly label: string;
      readonly created: boolean;
    }>
  | ColdStartEventBase<"assessment_completed", {
      readonly readModel: ColdStartReadModel;
    }>;

interface ColdStartEventBase<T extends string, P> {
  readonly runId: string;
  readonly sequence: number;
  readonly occurredAt: string;
  readonly country: CountryRef;
  readonly type: T;
  readonly payload: P;
}

interface ColdStartPrepared {
  readonly runId: string;
  readonly profileId: string;
  readonly country: CountryRef;
  readonly assessmentAt: string;
  readonly deadlineAt: string;
}

interface ColdStartApplication {
  prepare(input:
    | { readonly countryInput: string; readonly profile: RelocationProfileDraft }
    | { readonly countryInput: string; readonly profileId: string }
  ): Promise<ColdStartPrepared>;
  run(
    prepared: ColdStartPrepared,
    emit: (event: ColdStartEvent) => void | Promise<void>,
    signal: AbortSignal,
  ): Promise<ColdStartReadModel>;
  present(input: { readonly runId: string; readonly profileId: string }): Promise<ColdStartReadModel>;
}
```

The Slovenia validators may emit these literal values only when the current captured official text supports them. Changed official semantics do not get coerced into the old literals; they produce a typed blocker and require a future schema/version change.

---

### Task 1: Parameterize the evidence path without changing VS-1 replay

**Trace:** `TASK-VS2-01`; `REQ-VS2-01`, `REQ-VS2-02`, `REQ-VS2-05`; `INV-VS2-01`, `INV-VS2-05`.

**Files:** Modify `src/research/contracts.ts`, `src/research/run.ts`, `src/research/parsers/parser-support.ts`, `src/application/replay-evidence.ts`, `src/infrastructure/sources/gateway.ts`, `src/infrastructure/sqlite/evidence-store.ts`, `tests/sources/gateway.test.ts`, `tests/integration/current-evidence.test.ts`, `tests/integration/evidence-store.test.ts`; create `src/research/research-plan.ts`, `tests/research/cold-start.test.ts`.

**Interfaces:** Implement the generic `ResearchPlan`, `runEvidencePlan`, `EvidenceProgress` and type parameters in the published contract. Keep legacy `SourceId`, `EVIDENCE_SOURCE_IDS`, claim IDs, scope text, parser/rules versions, entry order, canonical manifest and public VS-1 exports unchanged.

- [ ] **Step 1: Capture the compatibility baseline.** Add one focused regression to `tests/integration/current-evidence.test.ts` which replays a fixed VS-1 sealed fixture through the extracted core and asserts canonical snapshot equality, source order, claim IDs, parser versions and `vs1-evidence@1`; do not duplicate existing source cases.
- [ ] **Step 2: Write the failing plan tests.** In `tests/research/cold-start.test.ts`, construct a two-source fake plan and assert plan-owned source order, parser versions, exact terminal coverage, progress only after artifact append/claim verification, concurrency limit, capture ceiling, one retry only for timeout/429/5xx, deadline as a prepared blocker value, and external client abort before preparation completes as an exception with no persisted seal.
- [ ] **Step 3: Run `pnpm vitest run tests/research/cold-start.test.ts tests/integration/current-evidence.test.ts`; expect FAIL because `runEvidencePlan` and generic contracts do not exist.**
- [ ] **Step 4: Generalize only transport/storage types.** Parameterize `Claim`, `EvidenceBlocker`, `EvidenceSnapshot`, `LiveCapturedArtifact`, `CaptureRequest`, `HttpStepRequest`, `RequestStep`, `ParserEntry`, `CapturedEntry`, `CaptureResult`, `OfficialSourcePort`, manifest/bundle/store types with `S extends string = SourceId`; give existing call sites legacy defaults. Add optional snapshot `contextHash`, present only for VS-2 and included in its canonical manifest/HMAC. Keep all VS-1 runtime JSON field names and omission behavior byte-compatible.
- [ ] **Step 5: Extract one preparation core.** Move the current deadline/retry/persist/validate/signed-value construction behind `prepareEvidencePlan`, plan-owned source IDs, versions, limits and validator callbacks. It appends raw artifacts immediately but does not insert an Evidence Snapshot. Use a three-worker bounded pool when the plan says three and five workers for the VS-1 plan. Link an optional external signal to the internal deadline controller; external abort propagates before terminal commit, while deadline produces normal blocker evidence. Count every `RequestStep` attempt against `maxCaptures`.
- [ ] **Step 6: Retain exact wrappers.** Define frozen `VS1_RESEARCH_PLAN`; implement `runEvidencePlan` as `prepareEvidencePlan` followed by the supplied Evidence store seal, and existing `runCurrentEvidence(input, ports)` as the VS-1 wrapper. Keep existing `parseEvidenceEntry`, `applyEvidenceRules`, `sealEvidence` signatures as VS-1 adapters over generic internals.
- [ ] **Step 7: Generalize offline replay.** Extract a plan-aware replay primitive selected by sealed `rulesVersion`; keep `replayEvidence` as the `vs1-evidence@1` wrapper. Verify HMAC/raw hashes before parser dispatch and compare the newly sealed canonical snapshot with the stored snapshot. Unknown rules/parser versions fail before projection.
- [ ] **Step 8: Add redirect-chain proof.** Change `captureHttpOnce` to follow at most five redirects manually, validating HTTPS and every intermediate/final host against `allowedHosts`. Add one allowed chain and one intermediate-unofficial-host regression; preserve one logical HTTP attempt, exact final bytes, MIME and 30 MiB behavior.
- [ ] **Step 9: Run `pnpm vitest run tests/research/cold-start.test.ts tests/sources/gateway.test.ts tests/integration/current-evidence.test.ts tests/integration/evidence-store.test.ts tests/integration/confirmed-life.test.ts tests/branch/life-git.test.ts`; expect PASS.**
- [ ] **Step 10: Run `pnpm typecheck && pnpm lint`; expect PASS, then commit `refactor: parameterize evidence research plan`.**

### Task 2: Discover and deterministically validate Slovenia

**Trace:** `TASK-VS2-02`; `REQ-VS2-01`, `REQ-VS2-02`; `INV-VS2-01`, `INV-VS2-04`; `NFR-VS2-01..03`.

**Files:** Create `src/research/cold-start-contracts.ts`, `src/research/country-registry.ts`, `src/research/slovenia-plan.ts`, `src/research/parsers/slovenia.ts`, `src/infrastructure/sources/official-source-discovery.ts`, `src/infrastructure/sources/slovenia-source-adapter.ts`; extend only `tests/research/cold-start.test.ts`; add small semantic fixtures under `tests/sources/fixtures/slovenia/`.

**Interfaces:** Implement `CountryRef`, `ClaimKind`, `ClaimValueByKind`, `VerifiedCountryClaim`, `SourceCandidate`, `OfficialSourceDiscoveryPort`, `SloveniaSourceId` and `createSloveniaResearch({candidates}) -> {plan, source}` from the published contract. The Country Registry recognizes only trimmed, case-folded `SI`, `Slovenia`, `Словения`.

- [ ] **Step 1: Write failing registry/privacy tests.** Assert the three aliases resolve to the one frozen SI entry; unsupported input returns a typed `unsupported_country` result before profile append; registry data contains authority roots/coordinates but no remembered claim value/dossier; discovery input serializes exactly `{country, authorityRoots, requiredClaimKinds}` and contains none of a sentinel profile, income, citizenship or free text.
- [ ] **Step 2: Write failing discovery/plan tests.** Accept no more than six HTTPS candidates. Require candidate hosts to equal one exact installed canonical host (`www.gov.si`, `pisrs.si`, `pxweb.stat.si`, `www.ess.gov.si`); VS-2 does not expand cross-links to new hosts. Invalid/refused/model-error output produces missing planned sources rather than trusted facts. Add deterministic `cbr-eur` outside the discovery request for current RUB/EUR comparison.
- [ ] **Step 3: Write failing route validator tests.** The two-artifact route bundle (`GOV.SI`, current consolidated `ZTuj-2 Art. 51a`) must emit exactly route basis, citizenship applicability, remote-work relations, qualification, companion entry, duration and statutory prerequisites, each with exact artifact locator/hash, current applicability and `si-route@1`. The captured PISRS representation must include its complete amendment/effective-state listing; the validator selects the maximum effective state `<= assessmentAt` and rejects incomplete, ambiguous or future-only state. Citizenship may report only the complete authoritative national eligibility scope and its explicit exclusions; it never upgrades absence of a consular guarantee into guaranteed admission. A changed selector, incomplete eligibility/prerequisite listing, unsupported nationality inference or incomplete article is `semantic_mismatch`, never partial verified route claims.
- [ ] **Step 4: Write failing income validator tests.** The income bundle retains the applicable PISRS salary publication, SiStat metadata/listing and full series response. It rejects pagination/incomplete dimensions/ambiguous metric/future-only period; chooses the maximum published/effective period `<= assessmentAt`; verifies the `2 × latest average net salary` formula with Decimal and emits one `income` claim at `si-income@1`. Gross/net conversion is forbidden.
- [ ] **Step 5: Write failing companion validator tests.** The two-artifact ESS + current ZZSDT Arts. 32–33 bundle emits only `companion_local_work_access={conditional, labourMarketCheck, informationSheet}` at `si-companion@1`. The captured PISRS representation must include its complete amendment/effective-state listing; select the maximum effective state `<= assessmentAt` and reject incomplete, ambiguous or future-only state. The validator may infer that narrow local-employment result together with the route family-permit claim, but must not infer automatic access or remote work for a foreign company.
- [ ] **Step 6: Run `pnpm vitest run tests/research/cold-start.test.ts`; expect FAIL for absent registry/discovery/adapters/validators.**
- [ ] **Step 7: Implement bounded OpenAI discovery.** Use `responses.parse` with `gpt-5.6`, `store:false`, `tools:[{type:"web_search", search_context_size:"low", filters:{allowed_domains:[...]}}]`, strict Zod output, timeout 12 seconds and `maxRetries:0`. Return no claims. Refusal, invalid schema or API failure becomes a discovery blocker and leaves installed source slots unresolved.
- [ ] **Step 8: Implement four plan sources.** `si-digital-nomad-route` captures two HTML documents; `si-income-threshold` captures PISRS HTML plus SiStat metadata and an all-period JSON-stat response; `si-companion-employment` captures ESS and ZZSDT HTML; `cbr-eur` reuses the existing direct CBR capture/parser. Preserve all artifacts, source navigation and exact final URLs. The canonical successful path uses eight captures; retry cannot exceed ten.
- [ ] **Step 9: Implement three deterministic Slovenia validators in one file.** Normalize document text without executing scripts, use installed locators and typed Zod schemas, hash exact excerpts, and produce the literal claim values only when every required statement and period is supported. Sort claims in the approved nine-kind order; conflict/duplicate/missing kind stays a blocker.
- [ ] **Step 10: Run `pnpm vitest run tests/research/cold-start.test.ts tests/sources/gateway.test.ts tests/integration/current-evidence.test.ts`; expect PASS. Run `pnpm typecheck && pnpm lint`; expect PASS, then commit `feat: validate Slovenia cold start evidence`.**

### Task 3: Publish immutable dossier versions and replay them offline

**Trace:** `TASK-VS2-03`; `REQ-VS2-02`, `REQ-VS2-05`; `INV-VS2-01`, `INV-VS2-02`.

**Files:** Create `src/research/dossier.ts`, `src/infrastructure/sqlite/dossier-store.ts`, `tests/integration/cold-start.test.ts`; modify `src/infrastructure/sqlite/schema.sql`, `src/infrastructure/sqlite/db.ts`, `src/infrastructure/sqlite/evidence-store.ts`, `src/application/replay-evidence.ts`, `tests/integration/database-schema.test.ts`.

**Interfaces:** Implement `CountryDossierPayload`, `DossierVersion`, `DossierPublishResult`, `buildCountryDossier(preparedEvidence)`, `SqliteDossierStore.publishWithEvidence/loadVerified/findByPayload/loadHead`, and plan-aware offline replay. Only `buildCountryDossier` grants publication eligibility; the SQLite store enforces append-only integrity/idempotency but never fills missing claims.

- [ ] **Step 1: Write failing schema/publisher tests.** Start with no SI row; a sealed snapshot with exactly one verified claim of each required kind produces `v1`; any missing/duplicate/conflicting/stale/invalid kind produces `publication_not_allowed` and zero rows. A sealed snapshot may have unavailable CBR and still publish because FX is not a dossier claim.
- [ ] **Step 2: Write failing idempotency/version tests.** A new current Evidence Snapshot with the same normalized country payload returns the existing version with `created:false`; a changed verified value, source URL, source period, excerpt hash or validator version creates the only successor `v2` and leaves `v1` byte-identical. Concurrent first/different publications cannot create a second root, and every predecessor must have the same country/schema. Retrieval timestamp, artifact ID, profile and personal verdict do not affect `payloadHash`.
- [ ] **Step 3: Write failing integrity/replay tests.** Update/delete triggers reject; copied-DB payload/HMAC/raw-byte tamper rejects; two replay/presentation loads call no network and return canonical-equal dossier/comparator inputs; unknown schema/validator/rules versions fail closed. A transaction failure produces no partial dossier row.
- [ ] **Step 4: Run `pnpm vitest run tests/integration/cold-start.test.ts tests/integration/database-schema.test.ts`; expect FAIL because the dossier table/store do not exist.**
- [ ] **Step 5: Add exactly one table and two immutable triggers.** Use this shape; `payload_json` is required so its hash and zero-network replay can be verified:

```sql
CREATE TABLE IF NOT EXISTS dossier_versions (
  id TEXT PRIMARY KEY,
  country_code TEXT NOT NULL CHECK (length(country_code) = 2 AND country_code = upper(country_code)),
  predecessor_id TEXT REFERENCES dossier_versions(id),
  evidence_snapshot_id TEXT NOT NULL REFERENCES evidence_snapshots(id),
  schema_version TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  payload_hash TEXT NOT NULL CHECK (length(payload_hash) = 64),
  manifest_hash TEXT NOT NULL CHECK (length(manifest_hash) = 64),
  hmac TEXT NOT NULL CHECK (length(hmac) = 64),
  published_at TEXT NOT NULL,
  CHECK (predecessor_id IS NULL OR predecessor_id <> id),
  UNIQUE (country_code, schema_version, payload_hash)
);

CREATE UNIQUE INDEX IF NOT EXISTS dossier_versions_one_successor
ON dossier_versions (predecessor_id)
WHERE predecessor_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS dossier_versions_one_root
ON dossier_versions (country_code, schema_version)
WHERE predecessor_id IS NULL;
```

- [ ] **Step 6: Normalize the dossier payload.** Include typed country claims in required-kind order and, per evidence reference, stable source ID, navigation/final URL, source period, locator, excerpt SHA-256 and validator version. Exclude capture timestamp, artifact ID, current FX, profile and verdict. Compute `payloadHash` from canonical payload; compute deterministic ID and signed manifest from country/schema/payload hash, predecessor, bound Evidence Snapshot and publication time.
- [ ] **Step 7: Implement one atomic success transaction.** Factor the current Evidence insert/seal statements into a synchronous `insertSealedEvidence(database, sealed)` helper; existing `SqliteEvidenceStore.seal` wraps it in its current transaction. `SqliteDossierStore.publishWithEvidence` uses the same helper and the dossier insert/lookup in one `better-sqlite3` transaction with no `await` inside. It always persists the new current Evidence Snapshot, then returns an integrity-verified exact payload match or inserts the sole successor. Verify predecessor country/schema equality, enforce the single-root/single-successor constraints and handle a uniqueness winner deterministically. Derive `ordinal` by walking the verified predecessor chain; do not store a mutable head pointer.
- [ ] **Step 8: Add `vs2-si-evidence@1` replay dispatch.** Reload exact raw artifacts and source navigation, invoke the same Slovenia validators with the stored assessment cutoff, reseal canonically and compare with the stored snapshot. `replayEvidence` remains the exact VS-1 wrapper; Cold Start calls the new plan-aware dispatcher.
- [ ] **Step 9: Run `pnpm vitest run tests/integration/cold-start.test.ts tests/integration/database-schema.test.ts tests/integration/evidence-store.test.ts tests/integration/current-evidence.test.ts`; expect PASS. Run `pnpm test && pnpm typecheck && pnpm lint`; expect PASS, then commit `feat: publish immutable country dossiers`.**

### Task 4: Confirm the relocation profile, assess personal fit and coordinate the run

**Trace:** `TASK-VS2-04`; `REQ-VS2-01`, `REQ-VS2-03`, `REQ-VS2-05`; `INV-VS2-02`, `INV-VS2-03`, `INV-VS2-04`.

**Files:** Create `src/decision/relocation-profile.ts`, `src/decision/cold-start-assessment.ts`, `src/application/cold-start.ts`, `src/infrastructure/cold-start-composition.ts`; modify `src/infrastructure/sqlite/profile-store.ts`, `src/infrastructure/composition-root.ts`; extend only `tests/integration/cold-start.test.ts`.

**Interfaces:** Implement `RelocationProfileDraft/Snapshot`, `ColdStartFormula`, `ColdStartComparator`, `ColdStartReadModel`, `ColdStartApplication` and `createColdStartApplication(ports)`. Reuse `profile_snapshots` through explicit relocation append/load methods; do not turn the Albania-specific VS-1 `Profile` into a loose union.

- [ ] **Step 1: Write failing profile-boundary tests.** Strictly accept only ISO-coded, typed, non-PII fields in the published relocation draft; reject name, passport number, email, address, arbitrary relationship/free text and unknown keys. Normalize decimal income, dates and companion list; an injected clock produces an immutable canonical `relocation-profile@1` snapshot and stable SHA-256 ID. Verify legacy VS-1 profile rows still load byte-identically.
- [ ] **Step 2: Write failing comparator tests.** With a full dossier, current CBR claim and `210000 RUB net`, calculate `incomeEur = monthlyIncomeRub / eurRub` with unrounded Decimal intermediates/HALF_UP 2dp; if below the verified dossier threshold, return red `verified_veto` with `FORMULA-VS2-INCOME-01`, both claim lineages and official URLs. Gross/unknown income basis, unavailable FX, unknown passport validity or insurance cannot pass; absent any hard veto they return yellow. Explicit citizenship/remote-work mismatch may be red only when the corresponding dossier claim proves it.
- [ ] **Step 3: Write the no-green comparator case.** A second fully confirmed route-compatible profile returns yellow `route_compatible_city_unverified`, with `cityScope:"not_checked"`; no input can return green in VS-2. A country evidence blocker returns yellow `research_incomplete` and no dossier label.
- [ ] **Step 4: Write failing orchestration tests.** `prepare` resolves SI before writing, confirms or reloads one relocation profile, assigns a new run, assessment cutoff and 60-second deadline. `run` calls discovery without profile, emits valid discovery/authority events, invokes Research preparation once, verifies the signed prepared Evidence value, then atomically publishes full coverage or seals blocked evidence. It reload-verifies the committed snapshot, compares once and emits one terminal event last. Retry with `profileId` creates a new run/snapshot and preserves the prior rows.
- [ ] **Step 5: Write commit-boundary/reload tests.** Abort before a full-coverage `publishWithEvidence` call leaves no sealed Evidence/dossier; abort immediately after its synchronous transaction leaves both immutable. For a normally completed blocked run, application checks abort and commits its blocker Evidence alone; abort before that seal leaves only unsealed raw. Research includes `contextHash=SHA-256(canonical({runId,profileId}))` inside the signed VS-2 snapshot. `present({runId,profileId})` verifies that binding, performs zero network, reloads `${runId}:evidence`, replays it, finds/verifies the normalized dossier when present and reproduces the exact terminal read model; a swapped profile/run pair fails closed.
- [ ] **Step 6: Run `pnpm vitest run tests/integration/cold-start.test.ts tests/domain/profile.test.ts tests/integration/confirmed-life.test.ts`; expect FAIL for absent profile/comparator/use case.**
- [ ] **Step 7: Implement strict relocation confirmation in its own Decision module.** Add `appendRelocation` and `loadRelocationVerified` to `SqliteProfileStore`, dispatching only on the explicit top-level schema version while leaving current `append/loadVerified` semantics unchanged. Store no name or document number.
- [ ] **Step 8: Implement the versioned pure comparator.** Project only verified dossier/current-evidence claims. Dispatch `vs2-si-evidence@1` plus optional `si-dossier@1|none` to `cold-start-assessment@1`; retain that exact assessor for reload, expose the version in the read model, and fail closed for an unknown combination. Red dominates personal unknowns only when a hard veto is already proven, matching the canonical low-income scenario; otherwise unresolved prerequisites remain yellow. Produce fixed Russian summaries from reason codes, never model prose.
- [ ] **Step 9: Implement the Cold Start use case and composition.** Centralize sequential event numbering/time, map generic artifact/claim progress to redacted events, and ensure `assessment_completed` is last. The application—not Route/UI—owns publish timing and comparator inputs. Reuse the same DB, gateway, evidence integrity/store and OpenAI key supplied by the existing composition root.
- [ ] **Step 10: Run `pnpm vitest run tests/integration/cold-start.test.ts tests/integration/confirmed-life.test.ts tests/integration/present-journey.test.ts`; expect PASS. Run `pnpm test && pnpm typecheck && pnpm lint`; expect PASS, then commit `feat: assess Slovenia against confirmed profile`.**

### Task 5: Stream factual progress and render the full-screen globe/comparator

**Trace:** `TASK-VS2-05`; `REQ-VS2-01`, `REQ-VS2-04`; `INV-VS2-03`, `INV-VS2-05`.

**Files:** Create `src/app/api/cold-start/route.ts`, `src/experience/cold-start-stream.ts`, `src/experience/cold-start-view-model.ts`, `src/experience/components/ColdStartStart.tsx`, `src/experience/components/ColdStartJourney.tsx`, `src/experience/components/ColdStartComparator.tsx`, `tests/integration/cold-start-experience.test.tsx`; modify `tests/integration/cold-start.test.ts`, `src/app/page.tsx`, `src/app/globals.css`, `src/experience/run-url.ts`, `src/experience/components/ProductShell.tsx`, `src/experience/components/WorkspaceGlobe.tsx`, `src/experience/components/ResearchWorkspace.tsx`, `src/experience/research-map/contracts.ts`, `src/experience/research-map/product-route.ts`, `src/experience/research-map/ResearchGlobeCanvas.tsx`; make only necessary fixture-signature updates in existing UI tests.

**Interfaces:** `POST /api/cold-start` accepts the strict `prepare` input and returns finite NDJSON `ColdStartEvent` lines. `decodeColdStartStream(response.body)` validates every line with one shared Zod event schema. `reduceColdStartEvent` enforces one run, strictly increasing sequence and terminal-last behavior. Experience consumes only `ColdStartReadModel`/events.

- [ ] **Step 1: Write failing finite-stream tests in `tests/integration/cold-start.test.ts`.** Invalid JSON/content type/input returns problem JSON before stream and no run. A valid POST prepares first, then returns `application/x-ndjson; charset=utf-8`, `Cache-Control: no-store, no-transform`, `X-Content-Type-Options: nosniff`, `X-Life-Run-Id` and `X-Life-Profile-Id`. A linked controller is aborted by either `request.signal` or `ReadableStream.cancel()`; `start()` launches the pump without awaiting it before the `Response` returns. Each event is written once. Every normally closed stream has exactly one final `assessment_completed`; an errored/cancelled transport has no domain verdict, so UI stays gray and reports a transport error.
- [ ] **Step 2: Write failing decoder/reducer/visual-truth tests in `tests/integration/cold-start-experience.test.tsx`.** Decode UTF-8 and JSON split across arbitrary chunks; flush the final decoder; reject a trailing partial line, a missing terminal on normal close, and any line over 256 KiB. With no received event, show gray/full globe and no fake timeline row. Each real event appends one human label and only the newest atomic live announcement; artifact/claim repetitions aggregate counts without inventing steps. Marker remains gray through `dossier_published`; only `assessment_completed` makes it red/yellow and collapses, but does not unmount, the globe. Reject skipped/duplicate sequence, changed run ID, an event after terminal or malformed payload.
- [ ] **Step 3: Write failing comparator/accessibility tests.** Terminal red exposes a reason trigger with `aria-expanded/aria-controls`, concise veto, formula operands and descriptive official links; opening focuses its heading/close control, Escape/close returns focus, and globe collapse never strands focus. Terminal yellow exposes blocker/retry. Comparator always shows country scope, `city not checked`, coverage, checked time, dossier version or `not published`, personal fit and `исследовано отдельно от top-5`. State has icon plus text and no color-only meaning.
- [ ] **Step 4: Write the reload and retry test.** Response headers replace the URL with encoded `?flow=cold-start&run=...&profile=...` before reading the body. Reload calls zero-network `present` and renders the same terminal comparator. A reload before any sealed snapshot shows an interrupted-run retry state, not a verdict. Yellow retry posts the existing `profileId`, receives a new run/snapshot and leaves the prior presentation immutable. Decoder/network failure uses `role=alert` and never fabricates a domain marker.
- [ ] **Step 5: Run `pnpm vitest run tests/integration/cold-start.test.ts tests/integration/cold-start-experience.test.tsx`; expect FAIL for absent route/decoder/components.**
- [ ] **Step 6: Implement the Node Route Handler.** Export `runtime="nodejs"` and `dynamic="force-dynamic"`; parse/prepare before constructing `ReadableStream`; encode exactly one JSON object plus newline per event. Route code owns HTTP concerns only—no progress timer, verdict, retry or rollback.
- [ ] **Step 7: Implement the pure stream decoder/reducer/view model.** Enforce the 256 KiB line bound, final flush and normal-close terminal invariant. Keep the full typed event in memory only for the current screen; do not persist an event log. Timeline wording is fixed application copy. The final event supplies the redacted read model; no raw profile or chain-of-thought is rendered.
- [ ] **Step 8: Implement one focused setup.** Default to the approved synthetic values (Russia/Russian citizenship, 210000 RUB net, official remote employment, no degree, unknown experience/passport expiry/insurance) while allowing `no companion` or typed family members. Require final confirmation; unsupported country shows an inline error and starts no stream.
- [ ] **Step 9: Generalize only the globe presentation boundary.** `WorkspaceGlobe` accepts an optional origin/routes/overview/ARIA presentation and `mode:"full"|"background"|"collapsed"`; its current Moscow→Tirana default stays unchanged. Replace only the route-label boundary with `{label, kind:"country"|"city"}` so VS-2 can honestly show Russia→Slovenia without inventing Ljubljana. Do not add a provider/view-model layer and do not modify flight, earth material, scene-object or sun-cycle algorithms.
- [ ] **Step 10: Implement the cold-start screen.** Before terminal, the globe fills the workspace and actual progress overlays it; after terminal it becomes the existing small background/collapsed window beside `ColdStartComparator`. WebGL failure leaves timeline/comparator usable and offers only a visual retry; it never changes Research state.
- [ ] **Step 11: Run `pnpm vitest run tests/integration/cold-start-experience.test.tsx tests/integration/product-shell.test.tsx tests/integration/research-globe-canvas.test.tsx tests/integration/experience.test.tsx`; expect PASS. Run `pnpm test && pnpm typecheck && pnpm lint && pnpm build`; expect PASS, then commit `feat: stream cold-start research journey`.**

### Task 6: Live Slovenia gate, one browser E2E and implementation evidence

**Trace:** `TASK-VS2-06`; all VS-2 REQ/INV/NFR; `EVAL-VS2-01..04`.

**Files:** Create `evals/vs2-live.ts`; modify `package.json`, `docs/changes/active/vs-2-honest-cold-start/change.md`; create `docs/changes/active/vs-2-honest-cold-start/implementation-evidence.md`; generate one redacted JSON artifact under `artifacts/evals/vs2/` from the live command only.

**Interfaces:** Add `pnpm eval:vs2`. The eval uses a fresh SQLite path under `data/evals`, the canonical synthetic relocation profile and real official capture; it writes no raw database, HMAC key, API key or model response into Git.

- [ ] **Step 1: Run the complete local gate:**

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

Require all pre-existing VS-1 tests plus exactly the three VS-2 logical groups to pass.

- [ ] **Step 2: Implement and run `pnpm eval:vs2`.** On a fresh DB require no dossier before the run; live discovery and all current official captures; complete/latest applicable source series; sealed nine-kind coverage; SI dossier v1; current CBR lineage; formula-backed red for the canonical 210000 RUB net profile. Save source URLs, periods, locators, hashes, versions, event order, request/model counts and latency in redacted form.
- [ ] **Step 3: Exercise one fail-closed case in the same eval.** Inject one semantic/incomplete-listing failure after real navigation; require terminal yellow, no new dossier row and an official navigation link. Retry creates a new run/snapshot.
- [ ] **Step 4: Exercise replay/version integrity in the same eval.** Two zero-network replays must match; a copied-DB raw byte or dossier payload tamper must reject; identical normalized rerun returns the same dossier; one controlled changed verified payload creates v2 with v1 predecessor and leaves v1 immutable.
- [ ] **Step 5: Audit privacy and cost.** Assert the exact discovery/model payload contains only country/roots/claim kinds; nonterminal events contain no profile; no operational record includes free text/PII. Record model calls `<=1`, candidates `<=6`, captures `<=10`, concurrency `<=3` and total current-run budget `<=60s`.
- [ ] **Step 6: Stop and obtain fresh explicit browser permission from the user.** This is mandatory under repository instructions and is not satisfied by prior browser permission.
- [ ] **Step 7: After permission, run exactly one browser E2E.** Open `?flow=cold-start`, confirm the synthetic profile, submit Slovenia, observe gray plus actual events in order, then terminal red, collapsed globe, formula, official source detail and comparator. Reload the terminal URL and require the same presentation. Check Tab plus Enter/Space/Escape for the red reason; do not add a browser framework or country/layout matrix. Zero-network reload is proven by integration/eval instrumentation; reduced-motion/WebGL fallback is proven in `TEST-VS2-EXPERIENCE`, not as extra browser branches.
- [ ] **Step 8: Draft implementation evidence without changing approved status.** List commands/results and browser observations, cross-link the redacted artifact, and state which readiness levels are supported by the evidence.
- [ ] **Step 9: Stop for user approval of the implementation evidence.** Do not edit the approved change status, canonical specs or archive before this explicit review.
- [ ] **Step 10: After approval, update only the earned status/evidence links, run `git diff --check`, inspect full `git status`, preserve unrelated `.superpowers/...`, and commit only VS-2 evidence/code as `test: verify VS-2 cold start`. Push the feature branch only after the complete gate passes; never merge or push main.**

## Completion Gate

VS-2 is complete only when all six task commits exist, the local gate passes, live Slovenia evidence earns the claimed status, the one permitted browser scenario passes, VS-1 replay remains canonical-equal, and the user approves the implementation evidence. VS-3 country shortlist/cities remains a separate approved change package.
