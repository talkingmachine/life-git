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

export interface CitizenshipApplicabilityV2 {
  readonly classifications: readonly {
    readonly countryCode: string;
    readonly status: "eligible" | "excluded";
  }[];
}

export interface CompanionEntryV2 {
  readonly relationshipClassifications: readonly {
    readonly relationship: "spouse" | "minor_child" | "other_family";
    readonly status: "eligible" | "excluded";
  }[];
}

export interface IncomeRequirementV2 {
  readonly metric: "latest_official_average_monthly_net_salary";
  readonly multiplier: "2";
  readonly thresholdEur: string;
  readonly currency: "EUR";
  readonly basis: "net";
  readonly appliesTo: "applicant";
  readonly period: string;
}

export const SLOVENIA_V2_RESEARCH_SCOPE =
  "VS-2 Slovenia cold start" as const;

export const SLOVENIA_V2_SOURCE_ORDER = Object.freeze([
  "si-digital-nomad-route",
  "si-income-threshold",
  "si-companion-employment",
  "cbr-eur",
] as const);

export const SLOVENIA_V2_PARSER_VERSIONS = Object.freeze({
  "si-digital-nomad-route": "si-route@3",
  "si-income-threshold": "si-income@3",
  "si-companion-employment": "si-companion@3",
  "cbr-eur": "cbr-eur@1",
} as const);

export const SLOVENIA_V2_EVIDENCE_RULES_VERSION =
  "vs2-si-evidence@3" as const;

export const SLOVENIA_V2_FORMAL_ROUTE_ID =
  "si-temporary-residence-digital-nomad" as const;

export const SLOVENIA_V2_CLAIM_SOURCE = Object.freeze({
  route_basis: "si-digital-nomad-route",
  citizenship_applicability: "si-digital-nomad-route",
  remote_work_relations: "si-digital-nomad-route",
  income: "si-income-threshold",
  qualification: "si-digital-nomad-route",
  companion_entry: "si-digital-nomad-route",
  companion_local_work_access: "si-companion-employment",
  duration: "si-digital-nomad-route",
  general_statutory_prerequisites: "si-digital-nomad-route",
} as const satisfies Readonly<Record<ClaimKind, Exclude<SloveniaSourceId, "cbr-eur">>>);

export const SLOVENIA_V2_CLAIM_VALIDATOR = Object.freeze({
  route_basis: "si-route@3",
  citizenship_applicability: "si-route@3",
  remote_work_relations: "si-route@3",
  income: "si-income@3",
  qualification: "si-route@3",
  companion_entry: "si-route@3",
  companion_local_work_access: "si-companion@3",
  duration: "si-route@3",
  general_statutory_prerequisites: "si-route@3",
} as const satisfies Readonly<Record<ClaimKind, string>>);

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

export function buildCountryDossierV2(
  preparedEvidence: SealedEvidence<SloveniaSourceId, ColdStartEvidenceClaimV2>,
): CountryDossierPayloadV2;

export function reconstructCountryDossierPayloadV2(
  value: unknown,
): CountryDossierPayloadV2;
```

V2 dossier publication requires exactly one verified `route_basis`. Every non-scoped V2 claim kind may occur zero or one time. `duration` and `general_statutory_prerequisites` may each occur once per distinct `ParticipantRequirementScopeV2`, so one dossier can carry the applicant requirement plus separately proved spouse/minor-child/other-family requirements. Unscoped claim IDs remain `${sourceId}:${claimKind}:${validatorVersion}`. Applicant-scoped IDs use `${sourceId}:${claimKind}:applicant:${validatorVersion}`; companion-scoped IDs use `${sourceId}:${claimKind}:companion-${relationship}:${validatorVersion}`. Present claims follow the existing `REQUIRED_CLAIM_KINDS` order; scoped claims then order applicant first and companion relationships as `spouse`, `minor_child`, `other_family`. Duplicate kind/scope pairs fail. Missing optional claims are not blockers disguised as values, and catalog completeness is never inferred from dossier cardinality.

Task 1 owns the complete persisted V2 identity policy above. The Task 2 Slovenia plan imports and
re-exports those constants; it must not duplicate them. `companion-entry-classifier@1` is an
internal classifier within the retained route-source parser `si-route@3`, so the persisted
`companion_entry.validatorVersion` and claim ID use `si-route@3`. The inherited `Claim.scope`
remains `SLOVENIA_V2_RESEARCH_SCOPE`; scoped identity, duplicate detection and ordering use only
`claim.value.scope`. `buildCountryDossierV2` throws `publication_not_allowed`; the persisted-value
reconstructor throws `integrity_mismatch`.

Task 1 also owns the singleton formal-route mapping
`temporary_residence_digital_nomad -> si-temporary-residence-digital-nomad` through
`SLOVENIA_V2_FORMAL_ROUTE_ID`. Dossier claim order is not route order. The V2 assessment derives
that one route only when the reconstructed dossier contains the exact route basis and must not
invent any other route ID.

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
export {
  SLOVENIA_V2_EVIDENCE_RULES_VERSION,
  SLOVENIA_V2_PARSER_VERSIONS,
  SLOVENIA_V2_RESEARCH_SCOPE,
  SLOVENIA_V2_SOURCE_ORDER,
} from "./cold-start-contracts-v2";

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
- Modify: `src/research/cold-start-contracts-v2.ts`
- Modify: `tests/research/cold-start-v2-contracts.test.ts`

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

The pure algorithm follows the approved order: reconstruct all borrowed inputs; require exactly one `self`; derive the UTC-clamped move interval; derive only the singleton route owned by `SLOVENIA_V2_FORMAL_ROUTE_ID`; evaluate each participant in profile order; apply exact citizenship, companion, passport, work and income claims; aggregate `impossible > unknown > verified`; pass only decisive proved mismatch reasons into an impossible `ResidenceRouteOutcome`; then call existing `assessFormalResidence` exactly once. Without a dossier, the assessor derives no route, returns an empty participant projection and reaches the existing yellow/research-incomplete path rather than fabricating a placeholder route.

The current `@2` input contains no exact remote-work relation or route-specific legality proof. Consequently, for the installed digital-nomad route, `remote_continuation: "yes"` remains `unknown` and no viable `@2` route is reachable in Tasks 1–5. A viable path is deferred until a separately sealed route-specific relation/legality fact is added; `assessColdStartV2` must not infer one from `current_work` or `remote_continuation`.

Completeness is accepted only after a descriptor-safe exact copy proves `jurisdiction === "SI"`, the profile ID, an effective interval covering `assessmentAt`, the exact Evidence Snapshot ID, applicable catalog route IDs exactly equal to the singleton derived route set, and Evidence references whose snapshot IDs equal the assessment Evidence ID and whose artifact IDs exist in that Evidence Snapshot. Separately proved excluded catalog routes may coexist. A mismatch, or an attestation for an empty derived route set, is omitted before the formal call. No verified producer/loader exists yet and the installed Slovenia catalog remains `unproven`, so production passes `undefined`; synthetic attestations exist only to exercise the formal seam.

Every move boundary is computed first with UTC month clamping. The passport-required boundary is then computed from that already-clamped move boundary by adding the permit maximum plus passport reserve; the offsets are never collapsed. For example, `2026-01-31 + 3 months = 2026-04-30`, then `+ 15 months = 2027-07-30`, not July 31.

Money handling is closed: EUR direct; RUB through a fresh sealed CBR claim; any other ISO currency, stale/missing FX or gross/net mismatch is `unknown`. `not_working` and explicit remote `no` are current mismatches only for a route that proves remote work is required. Applicant permit terms never apply to a companion without companion-scoped claims.

- [ ] Write RED table tests for self-only and self+companion, exact relationship classification, proven exclusion, all four move horizons including the sequential January-31 clamp, absent/early/overlap/late passport, `not_working`, remote yes/no, direct EUR, fresh/stale RUB, unsupported ISO currency, income basis, zero income, missing route claims and the no-dossier zero-route path. Prove that current onboarding-only inputs cannot produce a viable route.
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
- Modify: `src/infrastructure/sqlite/evidence-store.ts`
- Modify: `src/research/country-knowledge.ts`
- Modify: `src/infrastructure/sqlite/country-knowledge-store.ts`
- Create: `tests/integration/country-assessment-projection-v2.test.ts`
- Modify: `tests/integration/cold-start.test.ts`
- Modify: `tests/integration/country-knowledge.test.ts`
- Create: `tests/integration/dossier-store-v2.test.ts`
- Modify: `tests/integration/evidence-store.test.ts`
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

The generic SQLite Evidence store remains the persistence primitive, but every typed read is an
exact versioned boundary. The existing `loadVerifiedCountryEvidence` remains V1-only. Task 4 adds
`loadVerifiedCountryEvidenceV2(database, id, key): VerifiedCountryEvidenceInputV2`, which invokes
the existing generic verifier with exact `SLOVENIA_V2_PARSER_VERSIONS` and
`SLOVENIA_V2_EVIDENCE_RULES_VERSION`. Composition owns a separately typed
`SqliteEvidenceStore<SloveniaSourceId, ColdStartEvidenceClaimV2>`: `sealV2` delegates to its generic
seal, `loadVerifiedBundleV2` always supplies the exact V3 expectations, and `replayV2` first performs
that exact verified V3 load before delegating to the existing rules-aware replay. A V1 snapshot,
unknown rules version or parser drift must fail before it can cross a V2-typed port; there is no
registry or fallback cast.

Country Knowledge keeps its existing outward port, persisted `country-knowledge@1` schema, linear
chain and canonical HMAC/hash bytes. The domain adds the closed
`VerifiedCountryEvidenceInputV2` and a suffixed
`buildSloveniaKnowledgeRevisionV2(...): SloveniaCountryKnowledgeRevision | undefined`. The V2
builder validates the complete V3 Evidence graph, exact source order, rules/parser versions, claim
IDs, validators, participant scopes and artifact ownership, but emits compact references only for
unscoped V2 country claims. `duration` and `general_statutory_prerequisites` are never emitted from
V3 because `FormalKnowledgeReference` has no participant scope and permits only one reference per
`ClaimKind`; if a V3 revision contains either scoped kind, any predecessor reference and status for
that kind is retired instead of being silently reused or last-write-wins. Those scoped facts remain
only in V2 Dossier/Assessment. No `scope` field is added to `country-knowledge@1`, and no claim value
or artifact byte enters a Knowledge revision. The historical atomic transient policy is preserved:
any relevant `timeout`, `deadline`, `rate_limited` or `server_error` returns no revision, so the
current predecessor remains unchanged and scoped retirement is deferred until an otherwise
publishable Evidence revision.

`SqliteCountryKnowledgeStore.resolveForEvidence`, `publishCurrentFromEvidence` and revision replay
keep their current signatures and dispatch only after reading the stored exact rules branch:
`vs2-si-evidence@2` uses the existing V1 loader/builder, `vs2-si-evidence@3` uses the V2
loader/builder, and every other value fails `integrity_mismatch`. The same exact branch is used when
recomputing a persisted revision. A V2 successor may follow a V1 predecessor in the one Knowledge
chain, but no historical row is rewritten. Composition's unchanged `knowledge.publishCurrent`
also validates `lastCheckedAt` through the selected exact V1/V2 projection.

- [ ] Write REDs for V1 draft, V1 ID, V2 ID, unknown schema, profile ID mismatch before research, exact V2 Evidence/Dossier replay, the absent order-aware projection module, independently derived route × participant order, projection/comparator binding, partial V2 dossier, no-completeness yellow, and zero adapter schema logic.
- [ ] Add store REDs for V1/V2 dossier isolation, tamper, lost race and exact retry; add Evidence REDs for exact V1/V3 loader and replay separation; add Knowledge REDs for V3 parser/rules bindings, scoped-claim retirement, exact internal dispatch and V1 historical bytes.
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
