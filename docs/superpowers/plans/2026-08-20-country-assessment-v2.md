# Country Assessment V2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Assess a verified `relocation-profile@2` against retained official Slovenia evidence for the whole declared group and carry the exact explanation through the existing Country Frontier without changing historical `@1` bytes.

**Architecture:** Research owns a separate fail-closed V2 claim/dossier contract over the existing retained artifacts. Decision owns one pure `assessColdStartV2` branch that feeds the existing `formal-residence@1` verdict. Cold Start dispatches by the verified profile schema; the existing ID-based `CountryVerifierPort` remains unchanged, while its result and marker become exact `@1 | @2` unions.

**Tech Stack:** TypeScript 6.0.3, Node 24.13.0, pnpm 11.19.0, Vitest 4.1.10, Zod 4.4.3, Decimal.js 10.6.0, SQLite/better-sqlite3 13.0.3.

**Spec:** `docs/superpowers/specs/2026-08-20-country-assessment-v2-design.md` (`approved`, commit `409ecf6e93b9e3166802b5a754d7d258e172462f`).

## Global Constraints

- Execute this plan after Local Conversational Onboarding Tasks 2, 6A and 6B have created the `@2` profile types, verified store branch and `CountryAssessmentInputV2`; return to onboarding Task 6C after this plan passes.
- Preserve `relocation-profile@1`, `ColdStartEvidenceClaim`, `vs2-si-evidence@2`, `si-dossier@1`, `assessColdStart`, `cold-start-assessment@1` and all historical canonical bytes.
- Add closed `@2` branches only. Do not add a schema registry, assessment graph, fallback, retry loop, legal predictor, inferred nationality taxonomy or household aggregation.
- Reuse existing retained official artifacts and source navigation. This plan performs no new browser research or source download. A classifier/scope absent from retained evidence stays absent and produces `unknown`.
- Keep `CountryVerifierPort` ID-based. Infrastructure transfers the opaque ID; Cold Start owns verified profile loading and exact schema dispatch.
- `formal-residence@1` remains the only marker engine. Participant assessments explain its input; they never calculate a second marker.
- The three existing `.superpowers/brainstorm/*` directories are user-owned and must remain untouched.

---

### Task 1: Define the closed V2 evidence and dossier contracts

**Files:**
- Create: `src/research/cold-start-contracts-v2.ts`
- Create: `src/research/dossier-v2.ts`
- Create: `tests/research/cold-start-v2-contracts.test.ts`

**Interfaces:**
- Consumes: existing `SloveniaSourceId`, `CountryEvidenceRef`, `Claim`, `CbrEurFacts`, `CountryRef` and sealed Evidence primitives.
- Produces: `ColdStartEvidenceClaimV2`, `CountryDossierPayloadV2`, `DossierVersionV2`, `buildCountryDossierV2`, `reconstructCountryDossierPayloadV2`.

```ts
export type ParticipantRequirementScopeV2 =
  | { readonly kind: "applicant" }
  | {
      readonly kind: "companion";
      readonly relationship: "spouse" | "minor_child" | "other_family";
    };

export interface ClaimValueByKindV2 {
  readonly route_basis: ClaimValueByKind["route_basis"];
  readonly citizenship_applicability: CitizenshipApplicabilityV2;
  readonly remote_work_relations: ClaimValueByKind["remote_work_relations"];
  readonly income: IncomeRequirementV2;
  readonly qualification: ClaimValueByKind["qualification"];
  readonly companion_entry: CompanionEntryV2;
  readonly companion_local_work_access: ClaimValueByKind["companion_local_work_access"];
  readonly duration: ClaimValueByKind["duration"] & {
    readonly scope: ParticipantRequirementScopeV2;
  };
  readonly general_statutory_prerequisites:
    ClaimValueByKind["general_statutory_prerequisites"] & {
      readonly scope: ParticipantRequirementScopeV2;
    };
}

export interface VerifiedCountryClaimV2<
  K extends ClaimKind = ClaimKind,
> extends Claim<ClaimValueByKindV2[K], SloveniaSourceId> {
  readonly claimKind: K;
  readonly evidence: readonly CountryEvidenceRef[];
  readonly validatorVersion: string;
}

export type ColdStartEvidenceClaimV2 =
  | VerifiedCountryClaimV2
  | Claim<CbrEurFacts, "cbr-eur">;

export interface DossierClaimV2<K extends ClaimKind = ClaimKind> {
  readonly claimId: string;
  readonly claimKind: K;
  readonly value: ClaimValueByKindV2[K];
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

export interface CountryDossierPayloadV2 {
  readonly country: CountryRef;
  readonly schemaVersion: "si-dossier@2";
  readonly claims: readonly DossierClaimV2[];
}

export interface DossierVersionV2 {
  readonly id: string;
  readonly ordinal: number;
  readonly countryCode: "SI";
  readonly predecessorId?: string;
  readonly evidenceSnapshotId: string;
  readonly schemaVersion: "si-dossier@2";
  readonly payload: CountryDossierPayloadV2;
  readonly payloadHash: string;
  readonly manifestHash: string;
  readonly hmac: string;
  readonly publishedAt: string;
}

export interface DossierPublishResultV2 {
  readonly version: DossierVersionV2;
  readonly created: boolean;
}
```

V2 dossier publication requires exactly one verified `route_basis`. Every non-scoped V2 claim kind may occur zero or one time. `duration` and `general_statutory_prerequisites` may each occur once per distinct `ParticipantRequirementScopeV2`, so one dossier can carry the applicant requirement plus separately proved spouse/minor-child/other-family requirements. Unscoped claim IDs remain `${sourceId}:${claimKind}:${validatorVersion}`. Applicant-scoped IDs use `${sourceId}:${claimKind}:applicant:${validatorVersion}`; companion-scoped IDs use `${sourceId}:${claimKind}:companion-${relationship}:${validatorVersion}`. Present claims follow the existing `REQUIRED_CLAIM_KINDS` order; scoped claims then order applicant first and companion relationships as `spouse`, `minor_child`, `other_family`. Duplicate kind/scope pairs fail. Missing optional claims are not blockers disguised as values, and catalog completeness is never inferred from dossier cardinality.

- [ ] Write RED tests for every exact V2 claim shape, simultaneous applicant/companion scopes, dense canonical kind/scope order, duplicate kind/scope and extra claim rejection, missing `route_basis`, artifact/source/anchor ownership, fresh frozen copies and V1/V2 cross-version rejection.
- [ ] Add historical assertions that the current V1 payload, manifest and dossier bytes are unchanged.
- [ ] Run `pnpm exec vitest run tests/research/cold-start-v2-contracts.test.ts tests/research/cold-start.test.ts`; expect the V2 module to be missing while V1 remains green.
- [ ] Implement the smallest pure contracts/builders/reconstructors; do not modify V1 modules.
- [ ] Re-run the focused suites, then `pnpm run typecheck`, scoped `pnpm exec eslint`, and `git diff --check`.
- [ ] Commit boundary: `feat: define country assessment v2 evidence`.

---

### Task 2: Validate V2 claims from retained Slovenia artifacts

**Files:**
- Create: `src/research/parsers/slovenia-v2.ts`
- Create: `src/research/slovenia-plan-v2.ts`
- Modify: `src/infrastructure/sources/slovenia-source-adapter.ts`
- Modify: `src/application/replay-evidence.ts`
- Modify: `src/infrastructure/sqlite/evidence-store.ts`
- Create: `tests/sources/slovenia-v2.test.ts`
- Modify: `tests/research/cold-start.test.ts`
- Modify: `tests/integration/evidence-store.test.ts`

**Interfaces:**
- Consumes: the existing `SloveniaSourceAdapter`, retained artifact bytes, `ParserEntry`, generic Evidence store and replay integrity.
- Produces: `validateSloveniaV2Entry`, `createSloveniaPlanV2`, `createSloveniaResearchV2`.

```ts
export const SLOVENIA_V2_PARSER_VERSIONS = Object.freeze({
  "si-digital-nomad-route": "si-route@3",
  "si-income-threshold": "si-income@3",
  "si-companion-employment": "si-companion@3",
  "cbr-eur": "cbr-eur@1",
} as const);

export const SLOVENIA_V2_EVIDENCE_RULES_VERSION =
  "vs2-si-evidence@3" as const;

export type SloveniaV2ValidationResult =
  | { readonly ok: true; readonly claims: readonly ColdStartEvidenceClaimV2[] }
  | {
      readonly ok: false;
      readonly kind:
        | "integrity_mismatch"
        | "semantic_mismatch"
        | "stale"
        | "conflict";
    };

export function validateSloveniaV2Entry(
  entry: ParserEntry<SloveniaSourceId>,
  assessmentAt: string,
): SloveniaV2ValidationResult;

export function createSloveniaPlanV2(
  sourceLineage: Readonly<Record<SloveniaSourceId, ResearchSourceLineage>>,
): ResearchPlan<SloveniaSourceId, ColdStartEvidenceClaimV2>;

export interface SloveniaResearchV2 {
  readonly plan: ResearchPlan<SloveniaSourceId, ColdStartEvidenceClaimV2>;
  readonly source: OfficialSourcePort<SloveniaSourceId>;
}

export function createSloveniaResearchV2(input: {
  readonly candidates: readonly SourceCandidate[];
}): SloveniaResearchV2;
```

The V2 validator may copy an existing semantic field only after reproducing it from the retained artifact. It emits ISO citizenship classifications only when the artifact names that exact country classification; broad `third_country_national` text is insufficient. It emits relationship classifications only for exact named relationships; `immediate family` alone is insufficient. Income gets `currency:"EUR"`, `basis:"net"`, `appliesTo:"applicant"` only when all four are proved. Duration/statutory values receive applicant or companion scope only when the retained text proves that scope. Unproved values are omitted, not guessed. The CBR claim remains byte-identical.

Unlike V1 all-or-nothing dossier rules, V2 Evidence keeps every independently verified unique claim and canonical-sorts the present subset. A source capture failure remains an ordinary Evidence blocker. Missing classifiers/scopes reduce assessment coverage and produce `unknown`; they do not invalidate unrelated verified claims.

- [ ] Write RED fixture tests for exact retained excerpts, the honest absence of unproved citizenship/companion classifications, applicant-scope proof, income scope/basis, CBR reuse and zero synthetic values.
- [ ] Add mutation tests for source/URL/period/anchor/parser/rules drift and for a re-signed V1/V2 rules mismatch.
- [ ] Add replay/store REDs for `vs2-si-evidence@3` source order and parser versions while preserving exact `@2` V1 replay.
- [ ] Run `pnpm exec vitest run tests/sources/slovenia-v2.test.ts tests/research/cold-start.test.ts tests/integration/evidence-store.test.ts`; expect only the V2 branches to fail.
- [ ] Implement one V2 plan over the existing source adapter. Do not duplicate HTTP navigation or add a source call.
- [ ] Re-run the focused suites, then `pnpm run typecheck`, scoped `pnpm exec eslint`, and `git diff --check`.
- [ ] Commit boundary: `feat: validate country assessment v2 evidence`.

---

### Task 3: Assess the whole group with current facts only

**Files:**
- Create: `src/decision/cold-start-assessment-v2.ts`
- Create: `tests/domain/cold-start-assessment-v2.test.ts`
- Modify: `tests/domain/formal-residence-verdict.test.ts`

**Interfaces:**
- Consumes: `CountryAssessmentInputV2`, V2 Evidence/Dossier, optional exact `CatalogCompletenessAttestation`, existing `assessFormalResidence` and CBR facts.
- Produces: `assessColdStartV2`, `ColdStartComparatorV2`, `ParticipantRouteAssessmentV2`, fixed reason/formula contracts.

```ts
export const COLD_START_ASSESSMENT_V2_RULES_VERSION =
  "cold-start-assessment@2" as const;

export function assessColdStartV2(
  input: ColdStartAssessmentInputV2,
): ColdStartComparatorV2;
```

The pure algorithm follows the approved order: reconstruct all borrowed inputs; require exactly one `self`; derive the UTC-clamped move interval; evaluate each route in dossier order and each participant in profile order; apply exact citizenship, companion, passport, work and income claims; aggregate `impossible > unknown > verified`; pass only decisive proved mismatch reasons into an impossible `ResidenceRouteOutcome`; then call existing `assessFormalResidence`. Production passes no completeness attestation until an installed exact attestation exists, so missing catalog proof cannot become red.

Money handling is closed: EUR direct; RUB through a fresh sealed CBR claim; any other ISO currency, stale/missing FX or gross/net mismatch is `unknown`. `not_working` and explicit remote `no` are current mismatches only for a route that proves remote work is required. Applicant permit terms never apply to a companion without companion-scoped claims.

- [ ] Write RED table tests for self-only and self+companion, exact relationship classification, proven exclusion, all four move horizons, absent/early/overlap/late passport, `not_working`, remote yes/no, direct EUR, fresh/stale RUB, unsupported ISO currency, income basis, zero income, and missing route claims.
- [ ] Assert hard mismatch dominance, deterministic route/participant order, unique pairs, non-empty decisive claim/evidence references, exact formula bytes and caller immutability.
- [ ] Prove synthetic exact completeness plus all-impossible can be red, while absent/mismatched completeness is yellow. Prove `assessFormalResidence` and all V1 fixtures remain unchanged.
- [ ] Run `pnpm exec vitest run tests/domain/cold-start-assessment-v2.test.ts tests/domain/formal-residence-verdict.test.ts`; expect a missing V2 assessor.
- [ ] Implement only the pure V2 branch and call the existing formal verdict once.
- [ ] Re-run the focused suites, then `pnpm run typecheck`, scoped `pnpm exec eslint`, and `git diff --check`.
- [ ] Commit boundary: `feat: assess country routes for onboarding v2`.

---

### Task 4: Dispatch verified profiles inside Cold Start

**Files:**
- Create: `src/application/country-assessment-projection-v2.ts`
- Modify: `src/application/cold-start.ts`
- Modify: `src/infrastructure/cold-start-composition.ts`
- Modify: `src/infrastructure/sqlite/profile-store.ts`
- Modify: `src/infrastructure/sqlite/dossier-store.ts`
- Modify: `src/research/country-knowledge.ts`
- Modify: `src/infrastructure/sqlite/country-knowledge-store.ts`
- Modify: `tests/integration/cold-start.test.ts`
- Modify: `tests/integration/country-knowledge.test.ts`
- Modify: `tests/integration/profile-store.test.ts`

**Interfaces:**
- Consumes: verified profile union from onboarding Task 6A, V1 research methods unchanged, V2 plan/assessor from Tasks 1–3.
- Produces: exact discriminated `ColdStartReadModel`, V2 dossier/store methods and ID-path dispatch.

```ts
export interface ColdStartReadModelCommon {
  readonly runId: string;
  readonly country: CountryRef;
  readonly checkedAt: string;
  readonly evidenceSnapshotId: string;
  readonly knowledge: {
    readonly rankingRevisionId?: string;
    readonly currentRevisionId?: string;
    readonly updatedRevisionId?: string;
    readonly lastCheckedAt: string;
    readonly knowledgeUpdatedAt?: string;
  };
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
  readonly sourceNavigation: readonly {
    readonly label: string;
    readonly url: string;
  }[];
}

export interface CountryAssessmentProjectionV2 {
  readonly schemaVersion: "country-assessment-projection@2";
  readonly profileSnapshotId: string;
  readonly evidenceSnapshotId: string;
  readonly participantAssessments: readonly ParticipantRouteAssessmentV2[];
}

export function reconstructCountryAssessmentProjectionV2(
  value: unknown,
  expected: {
    readonly profileSnapshotId: string;
    readonly evidenceSnapshotId: string;
    readonly orderedPairs: readonly {
      readonly routeId: string;
      readonly participantId: string;
    }[];
  },
): CountryAssessmentProjectionV2;

export type ColdStartReadModelV2 = ColdStartReadModelCommon & {
  readonly assessmentRulesVersion: "cold-start-assessment@2";
  readonly comparator: ColdStartComparatorV2;
  readonly assessmentProjection: CountryAssessmentProjectionV2;
};

export type ColdStartReadModelAny = ColdStartReadModel | ColdStartReadModelV2;

export type ColdStartEventAny =
  | Exclude<ColdStartEvent, { readonly type: "assessment_completed" }>
  | ColdStartEventBase<"assessment_completed", {
      readonly readModel: ColdStartReadModelAny;
    }>;

export interface ColdStartApplicationAny extends ColdStartApplication {
  prepareAny(input: {
    readonly countryInput: string;
    readonly profileId: string;
  }): Promise<ColdStartPrepared>;
  runAny(
    prepared: ColdStartPrepared,
    emit: (event: ColdStartEventAny) => void | Promise<void>,
    signal: AbortSignal,
  ): Promise<ColdStartReadModelAny>;
  presentAny(input: {
    readonly runId: string;
    readonly profileId: string;
  }): Promise<ColdStartReadModelAny>;
}

export interface ColdStartVerifiedBundleV2 {
  readonly snapshot: EvidenceSnapshot<SloveniaSourceId, ColdStartEvidenceClaimV2>;
  readonly entries: readonly ParserEntry<SloveniaSourceId>[];
}

export interface ColdStartResearchPrepareInputV2 extends Omit<
  ColdStartResearchPrepareInput,
  "onProgress"
> {
  readonly onProgress: (
    progress: EvidenceProgress<SloveniaSourceId, ColdStartEvidenceClaimV2>,
  ) => void | Promise<void>;
}

export interface ColdStartApplicationPortsV2 extends Omit<
  ColdStartApplicationPorts,
  "profiles" | "research" | "evidence" | "dossiers"
> {
  readonly profiles: ColdStartApplicationPorts["profiles"] & {
    loadRelocationAnyVerified(
      id: string,
    ): Promise<RelocationProfileSnapshot | RelocationProfileV2Snapshot>;
  };
  readonly research: {
    prepare(input: ColdStartResearchPrepareInput): Promise<
      SealedEvidence<SloveniaSourceId, ColdStartEvidenceClaim>
    >;
    prepareV2(input: ColdStartResearchPrepareInputV2): Promise<
      SealedEvidence<SloveniaSourceId, ColdStartEvidenceClaimV2>
    >;
  };
  readonly evidence: {
    seal(sealed: SealedEvidence<SloveniaSourceId, ColdStartEvidenceClaim>): Promise<void>;
    loadVerifiedBundle(id: string): Promise<ColdStartVerifiedBundle>;
    replay(id: string): Promise<EvidenceSnapshot<SloveniaSourceId, ColdStartEvidenceClaim>>;
    sealV2(
      sealed: SealedEvidence<SloveniaSourceId, ColdStartEvidenceClaimV2>,
    ): Promise<void>;
    loadVerifiedBundleV2(id: string): Promise<ColdStartVerifiedBundleV2>;
    replayV2(
      id: string,
    ): Promise<EvidenceSnapshot<SloveniaSourceId, ColdStartEvidenceClaimV2>>;
  };
  readonly dossiers: {
    publishWithEvidence(input: {
      readonly preparedEvidence: SealedEvidence<SloveniaSourceId, ColdStartEvidenceClaim>;
      readonly publishedAt: string;
    }): DossierPublishResult;
    findByPayload(
      countryCode: "SI",
      schemaVersion: "si-dossier@1",
      payloadHash: string,
    ): DossierVersion | undefined;
    publishWithEvidenceV2(input: {
      readonly preparedEvidence: SealedEvidence<SloveniaSourceId, ColdStartEvidenceClaimV2>;
      readonly publishedAt: string;
    }): DossierPublishResultV2;
    findV2ByPayload(
      countryCode: "SI",
      payloadHash: string,
    ): DossierVersionV2 | undefined;
  };
}
```

`Omit` changes only the four versioned seams and preserves the current required `countrySourceIndex`, `knowledge`, `integrity`, `clock`, `nextRunId` and every other unchanged port. `SqliteProfileStore.loadRelocationVerified` remains V1-only for existing Place Frontier consumers; the new `loadRelocationAnyVerified` is used only by Cold Start dispatch. Direct draft preparation and the existing outward `ColdStartReadModel` remain V1 in this task. `createColdStartApplication` with `ColdStartApplicationPortsV2` and `createColdStartComposition` return the exact `ColdStartApplicationAny` surface above. Its ID-only `prepareAny`, `runAny` and `presentAny` verified-load the profile, check the requested/sealed ID, and return `ColdStartReadModelAny`; inherited `prepare`, `run` and `present` remain byte-compatible V1 for historical/direct callers. In the V2 branch Cold Start already owns the verified profile and reconstructed dossier, so it derives `orderedPairs` from dossier route order crossed with profile participant order and calls `reconstructCountryAssessmentProjectionV2` before the read model crosses its port. The resulting fresh frozen `assessmentProjection` is bound to the same profile/Evidence IDs and comparator; no adapter is asked to reload or infer order. Task 5 atomically exposes that projection through Country Verifier and the streams by calling the explicit Any methods. V1 continues to call existing research/dossier/assessor methods. V2 calls the suffixed V2 methods and returns `ColdStartReadModelV2`. `SqliteDossierStore` uses the existing table but reconstructs by exact schema; V1 and V2 predecessor chains never cross. Country Knowledge accepts the exact V3 Evidence projection without rewriting historical revisions and publishes only claims its V2 contract understands.

- [ ] Write REDs for V1 draft, V1 ID, V2 ID, unknown schema, profile ID mismatch before research, exact V2 Evidence/Dossier replay, the absent order-aware projection module, independently derived route × participant order, projection/comparator binding, partial V2 dossier, no-completeness yellow, and zero adapter schema logic.
- [ ] Add store REDs for V1/V2 dossier isolation, tamper, lost race and exact retry; add Knowledge REDs for V3 parser/rules bindings and V1 historical bytes.
- [ ] Run `pnpm exec vitest run tests/integration/cold-start.test.ts tests/integration/country-knowledge.test.ts tests/integration/profile-store.test.ts`; expect only explicit V2 seams to fail. Add a compile fixture proving existing Place Frontier still receives the unchanged V1 loader, `ColdStartApplicationPortsV2` satisfies every unchanged base member, composition returns `ColdStartApplicationAny`, and inherited V1 methods retain their old result/event types and behavior.
- [ ] Implement the closed branch with separate suffixed V2 methods; do not genericize the existing V1 API.
- [ ] Re-run the focused suites, then `pnpm run typecheck`, scoped `pnpm exec eslint`, and `git diff --check`.
- [ ] Commit boundary: `feat: dispatch country assessment by profile version`.

---

### Task 5: Carry the V2 explanation through Country Frontier

**Files:**
- Modify: `src/application/country-assessment-projection-v2.ts`
- Modify: `src/application/country-verifier.ts`
- Modify: `src/application/place-frontier.ts`
- Modify: `src/application/country-resolution.ts`
- Modify: `src/application/country-resolution-contracts.ts`
- Modify: `src/infrastructure/country-verifier-adapter.ts`
- Modify: `src/experience/cold-start-stream.ts`
- Modify: `src/experience/cold-start-view-model.ts`
- Modify: `src/experience/place-frontier-stream.ts`
- Modify: `src/experience/place-frontier-view-model.ts`
- Modify: `src/experience/country-resolution-stream.ts`
- Modify: `src/experience/country-resolution-view-model.ts`
- Modify: `src/experience/components/ColdStartComparator.tsx`
- Modify: `src/experience/components/PlaceFrontierJourney.tsx`
- Modify: `src/experience/components/CountryResolutionPanel.tsx`
- Modify: `tests/integration/cold-start-experience.test.tsx`
- Modify: `tests/integration/place-frontier.test.ts`
- Modify: `tests/integration/place-frontier-transport.test.ts`
- Modify: `tests/integration/place-frontier-experience.test.tsx`
- Modify: `tests/integration/country-resolution.test.ts`
- Modify: `tests/integration/country-resolution-transport.test.ts`
- Modify: `tests/integration/country-resolution-store.test.ts`
- Modify: `tests/integration/country-resolution-experience.test.tsx`

**Interfaces:**
- Consumes: discriminated Cold Start read model and current ID-based `CountryVerifierPort` calls.
- Produces: exact V1/V2 `CountryVerificationResult`, `CountryVerificationPresentation`, `FrontierMarker` and replay projection.

Task 4 owns the exact `CountryAssessmentProjectionV2` and its order-aware reconstructor because Cold Start is the boundary that simultaneously holds the verified profile and dossier. Keep the current `CountryVerifierPort.check/present` input signatures. In this task, widen its result and the adapter together; `country-verifier-adapter.ts` calls `ColdStartApplicationAny.prepareAny/runAny/presentAny` explicitly and branches on `ColdStartReadModelAny`, so no intermediate union is assigned to the historical literal-`@1` result. Historical direct Cold Start callers keep the inherited V1 methods. For V2, the adapter requires the read model's already reconstructed `assessmentProjection` IDs to equal its profile/Evidence IDs and copies that fresh frozen projection; it has no profile/dossier loader and never derives order from opaque IDs or the projection being checked. It adds no projection key for V1. Result, presentation and marker are exact discriminated unions from the approved spec. Marker materialization, replay expectation, SQLite JSON, stream schemas and view-model normalization preserve the exact projection. Persisted marker/revision readers verify their own HMAC and structural density/unique-pair rules; any semantic `present` path obtains the order-verified projection again from Cold Start. Country Resolution digests the complete reconstructed marker, so accepted-yellow/replacement replay cannot drop or change participant explanations.

- [ ] Write REDs for exact V2 check/present/materialization, profile/evidence bindings, preservation of Task 4's independently ordered dense projection, unique `(routeId, participantId)`, closed reasons and fresh frozen copies; prove the adapter has no loader and IDs alone are never accepted as an ordering oracle.
- [ ] Mutate/remove/add/reorder every projection field at marker, shortlist, resolution revision and wire boundaries; require `integrity_mismatch`. Assert V1 output contains no projection key and historical stream bytes remain exact.
- [ ] Add UI REDs in `ColdStartComparator`, `PlaceFrontierJourney` and `CountryResolutionPanel` showing concise route/participant unknown or mismatch explanations without exposing names, legal probability or a second marker.
- [ ] Run `pnpm exec vitest run tests/integration/cold-start-experience.test.tsx tests/integration/place-frontier.test.ts tests/integration/place-frontier-transport.test.ts tests/integration/place-frontier-experience.test.tsx tests/integration/country-resolution.test.ts tests/integration/country-resolution-transport.test.ts tests/integration/country-resolution-store.test.ts tests/integration/country-resolution-experience.test.tsx`; expect only V2 union/projection failures.
- [ ] Implement the exact union and projection; do not change port inputs or `country-frontier@1` calculation.
- [ ] Re-run the focused suites, then `pnpm run typecheck`, scoped `pnpm exec eslint`, `pnpm run build`, and `git diff --check`.
- [ ] Commit boundary: `feat: replay country assessment v2`.

## Completion Gate

Run:

```bash
pnpm exec vitest run \
  tests/research/cold-start-v2-contracts.test.ts \
  tests/sources/slovenia-v2.test.ts \
  tests/domain/cold-start-assessment-v2.test.ts \
  tests/integration/cold-start.test.ts \
  tests/integration/country-knowledge.test.ts \
  tests/integration/place-frontier.test.ts \
  tests/integration/place-frontier-transport.test.ts \
  tests/integration/country-resolution.test.ts \
  tests/integration/country-resolution-store.test.ts
pnpm run typecheck
pnpm run lint
pnpm run build
git diff --check
```

Completion requires an ID-loaded `relocation-profile@2` to produce the honest V2 assessment, preserve every participant, retain unknowns for unproved official classifiers/scopes, use the existing formal marker once, survive Country Frontier/Resolution persistence and replay, and leave every V1 fixture/byte path unchanged. Then resume Local Conversational Onboarding Task 6C for the receipt-to-fixed-run product handoff.
