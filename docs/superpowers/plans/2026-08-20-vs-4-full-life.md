# VS-4 Full Life Implementation Plan

> **SUPERSEDED — DO NOT EXECUTE.** The Qwen/GGUF/`node-llama-cpp`, shared local-model,
> zero-external-model and byte-equivalence instructions below conflict with the approved
> [`2026-08-20-codex-cli-runtime-design.md`](../specs/2026-08-20-codex-cli-runtime-design.md).
> This plan will be replaced after user review of the successor runtime spec; no Full Life task in
> this document is currently authorized for execution.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn one verified City Selection into one route-bound, budgeted and locally generated Full Life baseline, then let the user save at most one city/work/housing alternative without inventing facts.

**Source specification:** `docs/superpowers/specs/2026-08-20-vs-4-full-life-design.md` (`approved`).

**Architecture:** Branch owns the closed route/draft/budget/film/Passport/commit contracts. Application owns the two-step boundary: `prepareFullLifeBranch` verifies and generates with zero writes; `commitFullLifeBranch` verifies the signed prepared envelope, applies optional edits and publishes one complete aggregate. Research reuses the sealed Evidence pipeline for the exact profession signal and dated CBR FX. Infrastructure reuses the existing SQLite branch store, one low-level Qwen runtime adapter and one capability facade shared by the two approved inward ports. React owns only the unsaved draft, route-specific answers and optional film edits.

**Tech Stack:** Node 24.13.0, pnpm 11.19.0, TypeScript 6.0.3, Next.js 16.3.0, React 19.2.8, SQLite/better-sqlite3 13.0.3, Vitest 4.1.10 and Decimal.js 10.6.0; upstream onboarding pins `node-llama-cpp` 3.20.0 and Qwen2.5-1.5B-Instruct Q4_K_M.

## Hard Prerequisite Gate

Do not start Task 1 until all five prerequisites pass:

1. VS-4A City Selection Tasks 9–19 are complete. `src/application/city-selection.ts` exports `loadSelectionWithBranchVerified(selectionId): Promise<CitySelectionWithBranch>`, and the selected `CitySelectionSnapshot` binds the exact profile, preference, resolved-country revision, City Evidence/Knowledge and accepted city warnings.
2. The separate `docs/superpowers/plans/2026-08-20-country-assessment-v2.md` has been executed completely against the approved `docs/superpowers/specs/2026-08-20-country-assessment-v2-design.md`. Cold Start dispatches verified `relocation-profile@2` IDs to `assessColdStartV2`, persists/replays `cold-start-assessment@2` with its participant projection, and preserves historical `@1` bytes. Do not let Full Life compensate for a missing V2 assessor or projection.
3. The onboarding plan is complete. Verified `relocation-profile@2` and `preference-profile@2` loaders exist, savings min/max are durable, and `src/infrastructure/local-model/{local-model-manifest,qwen-runtime,onboarding-model}.ts` pass the real-artifact smoke. Onboarding intentionally leaves route-specific documents, insurance and legality unknown; VS-4 must collect only those missing route inputs after route selection, never repeat onboarding.
4. With fresh browser permission, complete and obtain user approval for `docs/superpowers/specs/2026-08-20-slovenia-profession-income-source.md`. It must pin one comparable official SiStat dataset, supported profession definitions/classification codes, exact geographic scope, period, unit, gross/net basis, metadata/data coordinates, navigation/data URLs, parser/freshness versions and retention. If this source is not approved, stop: VS-4 is not complete and a legal-threshold or model estimate is forbidden.
5. The pinned build/device pair passes onboarding's real-artifact grammar, semantic, privacy and latency smoke. Onboarding output need not be byte-identical; Full Life film byte equivalence is proved separately after Task 4 has created the exact DTOs and before Task 5 can call the model. Do not add a different model, remote endpoint or recorded fallback.

Run the exact gate:

```bash
test -f src/application/city-selection.ts
test -f docs/superpowers/plans/2026-08-20-country-assessment-v2.md
test -f src/decision/cold-start-assessment-v2.ts
test -f src/infrastructure/local-model/local-model-manifest.ts
test -f src/infrastructure/local-model/qwen-runtime.ts
test -f src/infrastructure/local-model/onboarding-model.ts
test -f docs/superpowers/specs/2026-08-20-slovenia-profession-income-source.md
rg -n "loadSelectionWithBranchVerified|CitySelectionWithBranch" src/application tests
rg -n "assessColdStartV2|COLD_START_ASSESSMENT_V2_RULES_VERSION" \
  src/decision/cold-start-assessment-v2.ts
rg -n "cold-start-assessment@2|assessmentProjection" \
  src/application src/experience tests
rg -n "Статус.*approved|Approval.*approved" \
  docs/superpowers/specs/2026-08-20-slovenia-profession-income-source.md
pnpm exec vitest run \
  tests/integration/city-selection.test.ts \
  tests/integration/city-frontier-experience.test.tsx \
  tests/research/cold-start-v2-contracts.test.ts \
  tests/sources/slovenia-v2.test.ts \
  tests/domain/cold-start-assessment-v2.test.ts \
  tests/integration/cold-start.test.ts \
  tests/integration/country-knowledge.test.ts \
  tests/integration/place-frontier.test.ts \
  tests/integration/place-frontier-transport.test.ts \
  tests/integration/country-resolution.test.ts \
  tests/integration/country-resolution-store.test.ts \
  tests/integration/onboarding.test.ts \
  tests/integration/local-model-runtime.test.ts
```

If any command fails, execute the approved upstream plan or stop for the missing source decision; do not create a VS-4 workaround.

### Required VS-4A Task 15 amendment

Task 15 currently specifies `selectCity` plus `listSelectionsWithBranchesVerified(runId)`, but Full Life starts from one selection ID. Before the prerequisite gate may pass, amend and execute Task 15 in place; do not add a second City Selection store or a Full Life-owned compatibility loader.

**Files in the upstream amendment:**
- Modify: `src/application/city-selection.ts`
- Modify: `src/infrastructure/sqlite/city-selection-writer.ts`
- Modify: `src/infrastructure/city-frontier-composition.ts`
- Modify: `src/infrastructure/composition-root.ts`
- Modify: `tests/integration/city-selection.test.ts`

```ts
export interface CitySelectionReadPort {
  loadSelectionWithBranchVerified(
    selectionId: string,
  ): Promise<CitySelectionWithBranch>;
}

export interface CitySelectionApplication {
  loadSelectionWithBranchVerified(
    selectionId: string,
  ): Promise<CitySelectionWithBranch>;
  // Existing select/list methods remain unchanged.
}
```

The SQLite reader loads the exact `city_selection_snapshots` row and its referenced `city_branch_commits` row in one read transaction, reconstructs both, verifies their selection/commit/parent/country/profile/preference bindings, and returns fresh frozen values. RED tests cover missing selection, missing/mismatched/tampered branch, wrong sibling, and successful reload by ID. The composed City Selection application exposes this exact method; the hard gate's `rg` and `city-selection.test.ts` then prove the seam exists.

### Post-Task-4 / pre-Task-5 Full Life film feasibility gate

This gate is a tracer bullet for the one new local-model capability. It creates no provider abstraction, no second adapter/model instance and no product persistence.

**Files:**
- Create: `src/infrastructure/local-model/full-life-film-template.ts`
- Create: `evals/full-life-feasibility.ts`
- Create: `evals/fixtures/full-life/feasibility-cases.json`
- Modify: `tests/integration/local-model-runtime.test.ts`

The fixture uses the closed `FullLifeProjectionInput`/`FullLifeFilmDocument` shapes specified in Tasks 2 and 4 and the exact `full-life-film-template@1` grammar/settings later reused by the shared capability facade. Include current-work and installed-profession inputs, unknown rent/expense/FX, assumption replacement, accepted-yellow route input, prompt-injection strings, exact twelve-month output, every allowed input-ref class, malformed output and prohibited invented fact/link/probability cases.

- [ ] RED runtime tests prove a fresh context sequence is created/disposed for each film call and that the feasibility harness makes zero network/telemetry calls.
- [ ] Run the real pinned model three times for every canonical fixture with identical seed/settings. Require schema/lineage/adversarial acceptance, byte-equivalent canonical JSON for each repeated input, and recorded p50/p95 latency on the demo Mac.
- [ ] Run `pnpm exec vitest run tests/integration/local-model-runtime.test.ts` and `pnpm exec tsx evals/full-life-feasibility.ts`.
- [ ] Execute this gate immediately after Task 4. If grammar, byte equivalence, privacy or the 3–5 minute journey budget cannot pass, stop before Task 5; do not continue into Application/store/UI work and do not add retries, fallback, another model or a provider switch.
- [ ] Commit boundary: `feat: prove local full life film`.

## Normative Boundaries

- A baseline and at most one alternative exist. No decision graph, generic workflow, arbitrary branch browser or automatic enumeration.
- Formal green selects a verified viable route. Accepted formal yellow selects an exact unknown route outcome when one exists; only its absence produces the explicit `route_unresolved` fallback. Neither is relabelled verified.
- Route basis is editable before baseline commit and immutable afterwards. An alternative changes exactly one of city, work or housing.
- The route-input step follows the selector and precedes work. It asks only for missing route-specific document status, insurance status, mandatory-payment amount/applicability and timeline applicability/month; it never re-asks profile or preference fields.
- Facts/calculations come only from verified sources, confirmed user values and versioned pure functions. The local model creates only the saved projection.
- Missing rent, profession income, expense, route value or FX stays unknown. User replacement is a visible assumption; unknown never becomes zero or a midpoint.
- Confirmed source money preserves its guarded ISO-4217 currency verbatim. This release calculates EUR directly and RUB only through the dated CBR EUR/RUB claim; every other valid source currency remains visible while its conversion-dependent output is unknown.
- `prepareFullLifeBranch` has no write port. `commitFullLifeBranch` performs no source/model call and makes one atomic store call.
- Replay/presentation reads saved canonical film bytes and never calls official HTTP or the model.
- Preserve historical housing `BranchCommit` bytes and replay. Evolve the existing table/store; do not add a second Full Life graph.
- The current database has no migration runner. This plan deliberately uses a disposable-demo reset with exact schema preflight, not an `ALTER`/copy migration.

---

### Task 1: Seal and load exact profession plus FX facts

**Files:**
- Create: `src/decision/full-life-catalog.ts`
- Create: `src/research/full-life-facts.ts`
- Create: `src/research/slovenia-full-life-plan.ts`
- Create: `src/research/parsers/slovenia-profession-income.ts`
- Create: `src/application/full-life-facts.ts`
- Create: `src/infrastructure/sources/slovenia-full-life-source-adapter.ts`
- Create: `tests/research/full-life-facts.test.ts`
- Create: `tests/integration/full-life-facts.test.ts`

**Exact contracts:**

```ts
// src/decision/full-life-catalog.ts
import type { FormalEvidenceReference } from "./formal-residence-verdict";

export const SUPPORTED_PROFESSION_IDS = [
  // exact IDs/classification bindings from the approved profession-source spec
] as const;
export type SupportedProfessionId = (typeof SUPPORTED_PROFESSION_IDS)[number];

export const SUPPORTED_HOUSING_IDS = [
  "room",
  "studio",
  "one_bedroom",
] as const;
export type SupportedHousingId = (typeof SUPPORTED_HOUSING_IDS)[number];
export const SUPPORTED_HOUSING_LABELS: Readonly<
  Record<SupportedHousingId, string>
> = Object.freeze({
  room: "Комната",
  studio: "Студия",
  one_bedroom: "Квартира с одной спальней",
});

export type FullLifeFactSourceId = "si-profession-income" | "cbr-eur";

export type FullLifeEvidenceRef =
  | {
      readonly kind: "full_life_claim";
      readonly sourceId: FullLifeFactSourceId;
      readonly claimId: string;
      readonly artifactId: string;
      readonly navigationUrl: string;
      readonly resolvedUrl?: string;
      readonly sourcePeriod: string;
      readonly locator: string;
    }
  | {
      readonly kind: "city_committed_fact";
      readonly knowledgeRevisionId: string;
      readonly evidenceSnapshotId: string;
      readonly criterionId: "long_term_rent";
      readonly definitionId: string;
      readonly geoScope: string;
      readonly referencePeriod: string | null;
      readonly sourceId: string;
      readonly navigationUrl: string;
      readonly resolvedUrl?: string;
    }
  | {
      readonly kind: "country_formal_reason";
      readonly claimIds: readonly string[];
      readonly evidence: readonly FormalEvidenceReference[];
    };

// src/research/full-life-facts.ts

export interface ProfessionIncomeSignal {
  readonly professionId: SupportedProfessionId;
  readonly classificationCode: string;
  readonly geographicScope:
    | { readonly kind: "national"; readonly countryCode: "SI" }
    | { readonly kind: "city"; readonly countryCode: "SI"; readonly cityId: string };
  readonly amount:
    | { readonly kind: "point"; readonly value: string; readonly currency: "EUR" }
    | { readonly kind: "range"; readonly min: string; readonly max: string; readonly currency: "EUR" };
  readonly basis: "gross" | "net";
  readonly unit: "per_person_per_month";
  readonly referencePeriod: string;
}

export type FullLifeFactClaim =
  | (Claim<ProfessionIncomeSignal, "si-profession-income"> & {
      readonly claimKind: "profession_income_signal";
      readonly validatorVersion: "si-profession-income@1";
    })
  | Claim<CbrEurFacts, "cbr-eur">;

export interface FullLifeVerifiedFacts {
  readonly snapshotId: string;
  readonly selectionSnapshotId: string;
  readonly cityId: string;
  readonly assessmentDate: string;
  readonly professionSignals: readonly (ProfessionIncomeSignal & {
    readonly claimId: string;
    readonly evidenceRefs: readonly [FullLifeEvidenceRef, ...FullLifeEvidenceRef[]];
  })[];
  readonly fx:
    | {
        readonly status: "verified";
        readonly value: CbrEurFacts;
        readonly claimId: string;
        readonly evidenceRefs: readonly [FullLifeEvidenceRef, ...FullLifeEvidenceRef[]];
      }
    | { readonly status: "unknown"; readonly reason: string };
}

export interface FullLifeVerifiedFactsReadPort {
  findVerified(input: FullLifeFactsReadKey): Promise<FullLifeVerifiedFacts | undefined>;
  loadVerified(input: FullLifeFactsReadKey): Promise<FullLifeVerifiedFacts>;
}

export interface FullLifeFactsReadKey {
  readonly snapshotId: string;
  readonly selectionSnapshotId: string;
  readonly cityId: string;
  readonly countryCode: "SI";
}

// src/application/full-life-facts.ts
export interface FullLifeFactsResearchPorts {
  readonly selections: CitySelectionReadPort;
  readonly research: {
    prepare(input: {
      readonly runId: string;
      readonly assessmentDate: string;
      readonly deadlineAt: string;
      readonly contextHash: string;
      readonly signal: AbortSignal;
    }): Promise<SealedEvidence<FullLifeFactSourceId, FullLifeFactClaim>>;
  };
  readonly evidence: FullLifeVerifiedFactsReadPort & {
    seal(
      value: SealedEvidence<FullLifeFactSourceId, FullLifeFactClaim>,
    ): Promise<void>;
  };
  readonly integrity: Pick<EvidenceIntegrity, "canonical" | "hash">;
}

export function researchFullLifeFacts(
  input: {
    readonly runId: string;
    readonly snapshotId: string;
    readonly selectionId: string;
    readonly assessmentDate: string;
    readonly deadlineAt: string;
    readonly signal: AbortSignal;
  },
  ports: FullLifeFactsResearchPorts,
): Promise<FullLifeVerifiedFacts>;
```

`src/decision/full-life-catalog.ts` is the one inward owner of the stable profession and housing tuples, housing labels and `FullLifeEvidenceRef`; the approved profession source spec fills only the profession tuple, while the competition housing tuple is exactly `room`, `studio`, `one_bedroom` in the order above. Research and the Task 2 installed plan import these constants rather than copying them. The three evidence-reference variants preserve the actual upstream granularity: a Full Life claim/artifact, a committed City fact/link without invented raw claim IDs, or one formal-country reason with its independent claim-ID and Evidence arrays. `researchFullLifeFacts` first loads `selectionId`, requires `snapshotId === runId + ":evidence"`, derives the Evidence `contextHash` from the exact selection/city/country plus ordered installed profession IDs, and constructs the exact `FullLifeFactsReadKey`. Before `research.prepare` or any source call it calls `evidence.findVerified(key)`: a verified existing snapshot is returned unchanged only when its signed `assessmentDate === input.assessmentDate`; absence alone permits capture, while a wrong date, malformed/tampered row or binding mismatch fails closed and never falls through to capture. After preparation it requires the sealed ID/date/context bindings, seals once and verified-reloads by the same key; an exact concurrent winner is returned, while a different payload fails. There is no retry loop or retry state. `createSloveniaFullLifePlan` has exactly `["si-profession-income", "cbr-eur"]`, parser versions `si-profession-income@1`/`cbr-eur@1`, rules `full-life-facts@1`, concurrency `2`, max captures `3` (SiStat metadata GET, SiStat series POST, CBR GET) and deadline `30_000`. It reuses `prepareEvidencePlan`, `sealEvidencePlan`, `captureCbrEur` and `SqliteEvidenceStore`; it does not duplicate the Evidence pipeline. The verified read projection preserves its signed `assessmentDate`, the CBR claim ID and closed references together with navigation/resolved URL, source period, locator and artifact/claim IDs so Budget, Passport and offline replay never reconstruct lineage from source ID conventions. Full-Life ref variants are reconstructed against verified Evidence; City and formal-country variants are canonical-copied from their already verified upstream projections. `loadVerified` addresses the immutable snapshot by ID and verifies the expected selection/city/country bindings; callers consume the returned date instead of supplying an untrusted or otherwise underivable one. The existing `latest_official_average_monthly_net_salary` legal threshold must fail the profession-signal guard.

- [ ] RED: test the exact SiStat coordinate/classification, national/city comparability, scope/period/unit/basis, stale/missing/conflicting signal, unsupported profession, CBR base/quote/date and the legal-threshold rejection.
- [ ] RED: integration-test capture order/count, artifact-before-claim sealing, exact profession and FX claim/Evidence projection, snapshot load, tamper failure and offline reload.
- [ ] RED: a repeated same-selection/same-day call returns the verified snapshot before any source/capture callback; a mismatched or tampered row fails before capture; two concurrent exact calls converge on one verified snapshot.
- [ ] GREEN: implement only the two-source plan, parser, adapter, research use case and narrow verified read projection.
- [ ] Verify:

```bash
pnpm exec vitest run \
  tests/research/full-life-facts.test.ts \
  tests/integration/full-life-facts.test.ts \
  tests/sources/parsers.test.ts
pnpm typecheck
pnpm exec eslint \
  src/decision/full-life-catalog.ts \
  src/research/full-life-facts.ts \
  src/research/slovenia-full-life-plan.ts \
  src/research/parsers/slovenia-profession-income.ts \
  src/application/full-life-facts.ts \
  src/infrastructure/sources/slovenia-full-life-source-adapter.ts \
  tests/research/full-life-facts.test.ts \
  tests/integration/full-life-facts.test.ts
```

- [ ] Atomic commit boundary:

```bash
git add src/decision/full-life-catalog.ts \
  src/research/full-life-facts.ts src/research/slovenia-full-life-plan.ts \
  src/research/parsers/slovenia-profession-income.ts \
  src/application/full-life-facts.ts \
  src/infrastructure/sources/slovenia-full-life-source-adapter.ts \
  tests/research/full-life-facts.test.ts tests/integration/full-life-facts.test.ts
git commit -m "feat: verify full life facts"
```

---

### Task 2: Close route choices, route-specific inputs and the draft

**Files:**
- Create: `src/branch/full-life.ts`
- Create: `src/application/full-life-route-inputs.ts`
- Create: `src/infrastructure/sources/slovenia-full-life-plan.ts`
- Create: `tests/domain/full-life.test.ts`
- Create: `tests/integration/full-life-route-inputs.test.ts`

**Exact route union:**

```ts
export type ViableResidenceRouteOutcome =
  Omit<Extract<ResidenceRouteOutcome, { readonly status: "viable" | "impossible" }>, "status">
  & { readonly status: "viable" };

export type FullLifeRouteBasis =
  | {
      readonly kind: "verified_route";
      readonly trustClass: "verified";
      readonly countryCode: "SI";
      readonly resolvedCountryShortlistRevisionId: string;
      readonly formalMarkerDigest: string;
      readonly routeOutcome: ViableResidenceRouteOutcome;
    }
  | {
      readonly kind: "accepted_yellow";
      readonly trustClass: "unresolved";
      readonly countryCode: "SI";
      readonly resolvedCountryShortlistRevisionId: string;
      readonly resolutionRevisionId: string;
      readonly formalMarkerDigest: string;
      readonly yellowDecisionCommandId: string;
      readonly warningCopyVersion: "yellow-risk@1";
      readonly uncertaintyBasis: YellowUncertaintyBasis;
      readonly outcome:
        | {
            readonly kind: "unknown_route";
            readonly routeOutcome: Extract<ResidenceRouteOutcome, { readonly status: "unknown" }>;
          }
        | { readonly kind: "route_unresolved" };
    };

export interface VerifiedFullLifeCountryContext {
  readonly selection: CitySelectionWithBranch;
  readonly resolution: ResolvedCountryShortlistSnapshot;
  readonly selectedEntry: ResolvedCountryEntry;
  readonly selectedMarker: FrontierMarker;
  readonly acceptedYellowDecision?: YellowDecision;
}

export function deriveFullLifeRouteChoices(
  input: VerifiedFullLifeCountryContext,
): readonly FullLifeRouteBasis[];
```

For accepted yellow, `deriveFullLifeRouteChoices` emits every exact `status:"unknown"` outcome and emits one `route_unresolved` choice only when there is no such outcome. A viable/impossible route cannot enter accepted-yellow choices.

**Route-input step:**

```ts
export interface MoneyInterval {
  readonly min: string;
  readonly max: string;
  readonly currency: string;
}

export type FullLifeInputValue<T> =
  | {
      readonly class: "official_fact";
      readonly value: T;
      readonly evidenceRefs: readonly [FullLifeEvidenceRef, ...FullLifeEvidenceRef[]];
    }
  | {
      readonly class: "user_fact";
      readonly value: T;
      readonly sourceRef:
        | `profile:${string}:${string}`
        | `route-input:${string}:${string}`
        | `full-life-input:${string}`;
    }
  | { readonly class: "assumption"; readonly value: T; readonly reason: string }
  | { readonly class: "unknown"; readonly reason: string };

export type PresentFullLifeInputValue<T> = Exclude<
  FullLifeInputValue<T>,
  { readonly class: "unknown" }
>;

export type RouteSpecificRequirement =
  | { readonly kind: "document"; readonly requirementId: string; readonly label: string }
  | { readonly kind: "insurance"; readonly requirementId: string; readonly label: string }
  | {
      readonly kind: "mandatory_payment";
      readonly requirementId: string;
      readonly label: string;
      readonly budgetCategory:
        | { readonly cadence: "monthly"; readonly id: "mandatory_payments" }
        | { readonly cadence: "one_time"; readonly id: "documents" };
    }
  | { readonly kind: "timeline_event"; readonly requirementId: string; readonly label: string };

export interface RouteDocumentInput {
  readonly requirementId: string;
  readonly status: FullLifeInputValue<"ready" | "to_obtain">;
}

export interface RouteInsuranceInput {
  readonly requirementId: string;
  readonly status: FullLifeInputValue<"confirmed" | "to_obtain">;
}

export type RoutePaymentInput =
  | {
      readonly requirementId: string;
      readonly applicability: PresentFullLifeInputValue<"applicable">;
      readonly amount: FullLifeInputValue<MoneyInterval>;
    }
  | {
      readonly requirementId: string;
      readonly applicability: PresentFullLifeInputValue<"not_applicable">;
    }
  | {
      readonly requirementId: string;
      readonly applicability: { readonly class: "unknown"; readonly reason: string };
    };

export type RouteTimelineInput =
  | {
      readonly requirementId: string;
      readonly applicability: PresentFullLifeInputValue<"applicable">;
      readonly plannedMonth: FullLifeInputValue<
        1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12
      >;
    }
  | {
      readonly requirementId: string;
      readonly applicability: PresentFullLifeInputValue<"not_applicable">;
    }
  | {
      readonly requirementId: string;
      readonly applicability: { readonly class: "unknown"; readonly reason: string };
    };

export interface FullLifeRouteInputStep {
  readonly schemaVersion: "full-life-route-input-step@1";
  readonly selectionSnapshotId: string;
  readonly routeBasisHash: string;
  readonly requirements: readonly RouteSpecificRequirement[];
}

export interface FullLifeRouteInputs {
  readonly schemaVersion: "full-life-route-inputs@1";
  readonly selectionSnapshotId: string;
  readonly routeBasisHash: string;
  readonly documents: readonly RouteDocumentInput[];
  readonly insurance: readonly RouteInsuranceInput[];
  readonly mandatoryPayments: readonly RoutePaymentInput[];
  readonly timeline: readonly RouteTimelineInput[];
}

export interface FullLifeRouteChoice {
  readonly routeBasisHash: string;
  readonly basis: FullLifeRouteBasis;
}

export interface FullLifeSetupReadModel {
  readonly selection: CitySelectionWithBranch;
  readonly routeChoices: readonly [FullLifeRouteChoice, ...FullLifeRouteChoice[]];
}

export type FullLifeCurrentWorkInput =
  | {
      readonly participantId: string;
      readonly relationship: "self" | "spouse" | "other_family";
      readonly status: "not_working";
      readonly income: FullLifeInputValue<MoneyIntervalWithBasis>;
    }
  | {
      readonly participantId: string;
      readonly relationship: "self" | "spouse" | "other_family";
      readonly status: "employment" | "self_employment" | "contract_service" | "other";
      readonly occupation?: string;
      readonly remoteContinuation: "yes" | "no";
      readonly income: FullLifeInputValue<MoneyIntervalWithBasis>;
    };

export interface FullLifeCityDecisionOption {
  readonly selectionId: string;
  readonly cityBranchCommitId: string;
  readonly cityId: string;
  readonly label: string;
  readonly marker: CityLiveMarker;
  readonly longTermRent: CityCommittedFactProjection;
}

export interface FullLifeInstalledProfessionOption {
  readonly professionId: SupportedProfessionId;
  readonly label: string;
  readonly applicability: {
    readonly status: "compatible" | "needs_context";
    readonly inputRefs: readonly [string, ...string[]];
  };
}

export interface FullLifeInstalledHousingOption {
  readonly housingId: SupportedHousingId;
  readonly label: string;
  readonly officialRent: FullLifeInputValue<MoneyInterval>;
}

export interface FullLifeInstalledDecisionCatalog {
  readonly professions: readonly [
    FullLifeInstalledProfessionOption,
    ...FullLifeInstalledProfessionOption[],
  ];
  readonly housing: readonly [
    FullLifeInstalledHousingOption,
    ...FullLifeInstalledHousingOption[],
  ];
}

export interface FullLifeDecisionInputProjection {
  readonly schemaVersion: "full-life-decision-inputs@1";
  readonly profileSnapshotId: string;
  readonly preferenceProfileSnapshotId: string;
  readonly currentWork: readonly FullLifeCurrentWorkInput[];
  readonly savings: FullLifeInputValue<MoneyInterval>;
  readonly selectedCity: FullLifeCityDecisionOption;
  readonly siblingCities: readonly FullLifeCityDecisionOption[];
  readonly professions: FullLifeInstalledDecisionCatalog["professions"];
  readonly housing: FullLifeInstalledDecisionCatalog["housing"];
}

export interface FullLifeCityDecisionSource {
  readonly terminal: TerminalCityShortlistSnapshot;
  readonly selections: readonly CitySelectionWithBranch[];
  readonly cityLabels: readonly {
    readonly cityId: string;
    readonly label: string;
  }[];
}

export interface FullLifeCityDecisionSourceReadPort {
  loadForSelectionVerified(
    selection: CitySelectionWithBranch,
  ): Promise<FullLifeCityDecisionSource>;
}

export interface FullLifeDecisionInputPorts {
  readonly selections: CitySelectionReadPort;
  readonly profiles: {
    loadRelocationV2Verified(id: string): Promise<RelocationProfileV2Snapshot>;
  };
  readonly cities: FullLifeCityDecisionSourceReadPort;
  readonly installedPlan: InstalledSloveniaFullLifePlanReadPort;
}

export interface FullLifeDecisionInputsReadPort {
  loadVerified(selectionId: string): Promise<FullLifeDecisionInputProjection>;
}

export interface FullLifeCountryContextReadPort {
  loadForSelectionVerified(
    selection: CitySelectionWithBranch,
  ): Promise<VerifiedFullLifeCountryContext>;
}

export interface InstalledSloveniaFullLifePlanReadPort {
  requirementsFor(
    basis: FullLifeRouteBasis,
  ): readonly RouteSpecificRequirement[];
  decisionCatalogFor(input: {
    readonly profile: RelocationProfileV2Snapshot;
    readonly cityId: string;
    readonly knowledgeRevisionId: string;
    readonly evidenceSnapshotId: string;
    readonly longTermRent: CityCommittedFactProjection;
  }): FullLifeInstalledDecisionCatalog;
}

export interface FullLifeRouteInputPorts {
  readonly selections: CitySelectionReadPort;
  readonly countryContext: FullLifeCountryContextReadPort;
  readonly installedPlan: InstalledSloveniaFullLifePlanReadPort;
  readonly integrity: CityDecisionIntegrity;
}

export function loadFullLifeSetup(
  selectionId: string,
  ports: FullLifeRouteInputPorts,
): Promise<FullLifeSetupReadModel>;

export function loadFullLifeDecisionInputs(
  selectionId: string,
  ports: FullLifeDecisionInputPorts,
): Promise<FullLifeDecisionInputProjection>;

export function loadFullLifeRouteInputStep(
  input: { readonly selectionId: string; readonly routeBasisHash: string },
  ports: FullLifeRouteInputPorts,
): Promise<FullLifeRouteInputStep>;

export function confirmFullLifeRouteInputs(
  step: FullLifeRouteInputStep,
  answers: unknown,
): FullLifeRouteInputs;

export function reconstructFullLifeRouteInputs(
  step: FullLifeRouteInputStep,
  value: unknown,
): FullLifeRouteInputs;

export type MonthlyExpenseId =
  | "rent" | "utilities" | "food" | "transport"
  | "communications" | "insurance" | "mandatory_payments";
export type OneTimeExpenseId =
  | "relocation" | "housing_deposit" | "documents" | "initial_setup";

export interface MoneyIntervalWithBasis extends MoneyInterval {
  readonly taxBasis: "gross" | "net";
  readonly populationBasis: "person" | "household";
  readonly period: "month";
}

export type FullLifeWorkDecision =
  | {
      readonly kind: "keep_current_work";
      readonly participantId: string;
      readonly remoteContinuation: "yes" | "no";
      readonly incomeReference: FullLifeInputValue<MoneyIntervalWithBasis>;
      readonly budgetIncome: FullLifeInputValue<MoneyIntervalWithBasis>;
    }
  | {
      readonly kind: "installed_profession";
      readonly professionId: SupportedProfessionId;
      readonly applicability: {
        readonly status: "compatible" | "needs_context";
        readonly inputRefs: readonly [string, ...string[]];
      };
      readonly incomeReference: FullLifeInputValue<MoneyIntervalWithBasis>;
      readonly budgetIncome: FullLifeInputValue<MoneyIntervalWithBasis>;
      readonly signalClaimId?: string;
    };

export interface FullLifeHousingDecision {
  readonly kind: "installed_housing";
  readonly housingId: SupportedHousingId;
  readonly officialRent: FullLifeInputValue<MoneyInterval>;
  readonly selectedMonthlyRent: FullLifeInputValue<MoneyInterval>;
}

export interface FullLifeDecisions {
  readonly work: FullLifeWorkDecision;
  readonly housing: FullLifeHousingDecision;
  readonly monthlyExpenses: Readonly<
    Record<MonthlyExpenseId, FullLifeInputValue<MoneyInterval>>
  >;
  readonly oneTimeExpenses: Readonly<
    Record<OneTimeExpenseId, FullLifeInputValue<MoneyInterval>>
  >;
  readonly savings: FullLifeInputValue<MoneyInterval>;
}

export interface FullLifeDecisionIntent {
  readonly citySelectionId: string;
  readonly work:
    | {
        readonly kind: "keep_current_work";
        readonly participantId: string;
        readonly budgetIncomeAssumption?: Extract<
          FullLifeInputValue<MoneyIntervalWithBasis>,
          { readonly class: "assumption" }
        >;
      }
    | {
        readonly kind: "installed_profession";
        readonly professionId: SupportedProfessionId;
        readonly budgetIncomeAssumption?: Extract<
          FullLifeInputValue<MoneyIntervalWithBasis>,
          { readonly class: "assumption" }
        >;
      };
  readonly housing: {
    readonly housingId: SupportedHousingId;
    readonly rentAssumption?: Extract<
      FullLifeInputValue<MoneyInterval>,
      { readonly class: "assumption" }
    >;
  };
}

export interface FullLifeSharedUserInputs {
  readonly monthlyExpenses: Readonly<
    Pick<
      FullLifeDecisions["monthlyExpenses"],
      "utilities" | "food" | "transport" | "communications" | "insurance"
    >
  >;
  readonly oneTimeExpenses: Readonly<
    Pick<
      FullLifeDecisions["oneTimeExpenses"],
      "relocation" | "housing_deposit" | "initial_setup"
    >
  >;
  readonly savings: FullLifeDecisions["savings"];
}

export function deriveFullLifeDecisionIntent(
  draft: FullLifeDraft,
): FullLifeDecisionIntent;

export function assertExactlyOneFullLifeDecisionChange(
  baseline: FullLifeDecisionIntent,
  alternative: FullLifeDecisionIntent,
  declared: "city" | "work" | "housing",
): void;

export function deriveFullLifeSharedUserInputs(
  draft: FullLifeDraft,
): FullLifeSharedUserInputs;

export interface FullLifeDraft {
  readonly schemaVersion: "full-life-draft@1";
  readonly citySelection: CitySelectionWithBranch;
  readonly profileSnapshotId: string;
  readonly preferenceProfileSnapshotId: string;
  readonly resolvedCountryShortlistRevisionId: string;
  readonly factsSnapshotId: string;
  readonly routeBasis: FullLifeRouteBasis;
  readonly routeInputs: FullLifeRouteInputs;
  readonly decisions: FullLifeDecisions;
}
```

`MoneyInterval.currency` is an uppercase value accepted by the installed ISO-4217 guard from onboarding; the open TypeScript `string` prevents a valid confirmed source currency such as USD or GBP from being narrowed or rewritten at this boundary. User-supplied status/month/amount is `user_fact | assumption | unknown`; `official_fact` can enter only from a verified Evidence read model. Requirement applicability and labels come only from the exact route outcome/installed binding. `not_applicable` omits `amount`/`plannedMonth`; switching to it clears the dependent session value and provenance. `unknown` is distinct and also carries no invented dependent value. The unresolved fallback renders four category-level unknowns and never invents document names, prices or dates. The installed Slovenia plan contains only supported profession/housing definitions and labels, EUR calculation currency, the exact comparable-rent mapping and route requirement bindings—no salary/FX value and no synthetic rent. `decisionCatalogFor` emits housing in exact `SUPPORTED_HOUSING_IDS` order with labels from `SUPPORTED_HOUSING_LABELS`. The verified City `long_term_rent` fact is city-wide rather than type-specific, so `room`, `studio` and `one_bedroom` each carry the same exact general reference or the same honest unknown. The product must label it as a general city rent reference and must not derive a housing-type multiplier, midpoint or price. A different chosen monthly cost is the existing visible user assumption and preserves that general official reference in Passport; unknown rent never makes an installed housing option unavailable.

`FullLifeRouteInputPorts` is the complete zero-write boundary for setup and route-input loading. `countryContext.loadForSelectionVerified` is composed in Task 8 from the existing City Selection, Country Resolution and Place Frontier verified readers; it is not a new store or copied source model. The loader canonical-compares the returned `context.selection` with the just-reloaded selection and verifies the selected entry/marker country, resolved revision, formal marker digest and accepted-yellow decision before deriving choices. Route hashes are exactly `integrity.hash(integrity.canonical(basis))`; the route-input loader repeats the same derivation and accepts only a matching hash. `reconstructFullLifeRouteInputs` owns a descriptor-safe copy and requires exact step selection/hash, one dense value per requirement, canonical order, correct discriminants and no extra requirement/value; it never treats a TypeScript annotation as trust. `installedPlan.requirementsFor` returns the fixed Task 2 binding and performs no I/O.

`loadFullLifeDecisionInputs` is the only server-derived source for the work, savings, city, profession and housing controls. It reloads the exact selection and its `relocation-profile@2`, then loads the terminal revision, installed city labels and all verified selection siblings through `cities.loadForSelectionVerified`. It requires the terminal/run/profile/preference/country bindings, selected entry marker digest, selected and sibling branch parent, every marker/fact tuple and every non-empty installed label to match. It extracts exactly one `long_term_rent` fact for each city option. Missing, duplicate, non-comparable or unknown rent stays the exact city unknown; `decisionCatalogFor` may create an `official_fact` only from a comparable verified rent fact with the same Knowledge/Evidence IDs, and otherwise returns `unknown`. Each accepted City link becomes a `kind:"city_committed_fact"` reference with its complete committed fact context; it never invents raw claim/artifact IDs. Route-reason provenance becomes `kind:"country_formal_reason"` and preserves the original independent claim-ID and `FormalEvidenceReference` arrays. The same pure installed binding derives each profession's `compatible | needs_context` result only from the exact `self` participant education/experience inputs and returns their profile refs. Current-work income becomes a point interval (`min === max`) and savings keeps its confirmed min/max; both retain the profile's exact ISO-4217 currency and `profile:<snapshot>:<field>` source reference. Minor children are omitted from `currentWork`; passport/citizenship data is not projected; no participant, applicability, amount, label, fact or selection is guessed.

`FullLifeDecisionInputsReadPort` is the composed read-only application facade over that function. The UI and `prepareFullLifeBranch` call the same facade; neither accepts a client-projected profile, catalog, marker, official rent or sibling list as authority. `decisionCatalogFor` is a pure lookup/mapping over the fixed installed definitions and supplied verified profile/rent inputs; it performs no I/O.

For an installed profession, Prepare chooses a signal deterministically: exactly one comparable city-scoped signal for the selected city wins; if none exists, exactly one comparable national signal wins; zero or multiple signals at the winning scope produce `incomeReference.class:"unknown"`. `signalClaimId` is required exactly when `incomeReference.class === "official_fact"` and must name that freshly loaded signal. The client cannot choose a signal or precedence.

`incomeReference` always retains the confirmed user value or selected official signal. `budgetIncome` must be canonical-equal to that reference or be an explicit `class:"assumption"` replacement with a complete interval/basis and non-empty reason; silent gross/net or person/household relabeling fails. Both values enter projection and Passport, so the assumption never hides the source reference. `deriveFullLifeDecisionIntent` deliberately excludes rehydrated salary/rent/Evidence values and includes only city identity, work/housing choice identity and explicit user overrides. `assertExactlyOneFullLifeDecisionChange` compares that closed intent: a city alternative may legitimately rehydrate different official salary/rent/budget values while only `citySelectionId` changes; it cannot smuggle a work/housing choice change. Every alternative also canonical-compares `deriveFullLifeSharedUserInputs` with the baseline, so food, utilities, transport, communications, insurance, relocation, deposit, setup and savings cannot change under a declared city/work/housing delta. Only server-derived rent, mandatory-payment/document slots, official income and calculated outputs may rehydrate. `FullLifeDraft` otherwise binds `CitySelectionWithBranch`, both `@2` profile IDs, country resolution, `FullLifeRouteBasis`, `FullLifeRouteInputs`, work, housing, all seven monthly categories, all four one-time categories and savings. Runtime guards require dense exact objects and deep-copy/freeze caller data.

Prepare derives `monthlyExpenses.rent` exactly from `housing.selectedMonthlyRent`; the client cannot calculate with a different rent than it displays. Each installed mandatory-payment requirement has the fixed cadence/category above. Prepare groups applicable route amounts by that binding and requires the corresponding `monthlyExpenses.mandatory_payments` or `oneTimeExpenses.documents` value to be exactly the derived sum (or exact unknown when any required amount is unknown); no second authoritative amount is accepted. This release does not infer cadence from a label or planned month.

- [ ] RED: verified green, exact accepted-yellow unknown route, fallback only on absence, route digest/decision mismatch, rejected city and accepted city-warning binding; setup reloads the exact selection, rejects a country-context selection/revision/entry/marker/digest/decision mismatch, and an unknown/foreign route hash fails before route-input projection.
- [ ] RED: explicit route-input step order; document/insurance/payment/timeline unknowns; `not_applicable` omits and clears amount/month; no citizenship/passport/income/education/companions/preferences/savings questions; route-answer mismatch and mutation.
- [ ] RED: exact profile current work and savings projection, USD/GBP preservation, exact `room/studio/one_bedroom` housing order and Russian labels, selected terminal marker and city-wide `long_term_rent`, the same reference/unknown on all three options without a type multiplier or midpoint, zero/many rent facts, green/unknown rent, City rent → Passport source link without fabricated claim IDs, formal reason claim/Evidence-array preservation, sibling city selection and every terminal/profile/parent/label/fact tamper.
- [ ] RED: current work versus installed profession, city-over-national exact signal precedence, duplicate/absent signal unknown, `signalClaimId` binding, installed housing, complete category keys, server-only official values and unknown/assumption semantics.
- [ ] RED: `budgetIncome` either exactly reuses `incomeReference` or preserves it beside one explicit replacement assumption; reject silent basis relabel, missing reason and source-binding drift.
- [ ] RED: city intent delta accepts rehydrated city salary/rent/budget changes but rejects a simultaneous work/housing choice; work and housing deltas symmetrically keep the other two intent fields canonical-equal.
- [ ] RED: every alternative rejects a simultaneous food/savings or other shared-user-input change while allowing only the documented server-derived rehydration.
- [ ] RED: displayed/selected rent equals budget rent for official, assumption and unknown cases; a housing-cost assumption preserves the general city reference in Passport; mandatory-payment cadence/category derives exactly one budget slot and rejects a duplicate client amount.
- [ ] GREEN: implement the pure guards and narrow zero-write application loader.
- [ ] Verify:

```bash
pnpm exec vitest run \
  tests/domain/full-life.test.ts \
  tests/integration/full-life-route-inputs.test.ts \
  tests/domain/country-resolution-policy.test.ts
pnpm typecheck
pnpm exec eslint \
  src/branch/full-life.ts \
  src/application/full-life-route-inputs.ts \
  src/infrastructure/sources/slovenia-full-life-plan.ts \
  tests/domain/full-life.test.ts \
  tests/integration/full-life-route-inputs.test.ts
```

- [ ] Atomic commit: `git add` the five Task 2 files, then `git commit -m "feat: define full life draft"`.

---

### Task 3: Calculate deterministic budget, FX and runway

**Files:**
- Create: `src/branch/full-life-budget.ts`
- Create: `tests/domain/full-life-budget.test.ts`
- Modify: `src/branch/budget.ts`

**Exact input/output:**

`MonthlyExpenseId`, `OneTimeExpenseId`, `MoneyInterval` and `MoneyIntervalWithBasis` come from Task 2's `src/branch/full-life.ts`; Task 3 must not redeclare them.

```ts
export interface FullLifeBudgetInput {
  readonly schemaVersion: "full-life-budget-input@1";
  readonly calculationCurrency: "EUR";
  readonly incomeReference: FullLifeInputValue<MoneyIntervalWithBasis>;
  readonly income: FullLifeInputValue<MoneyIntervalWithBasis>;
  readonly monthlyExpenses: Readonly<Record<MonthlyExpenseId, FullLifeInputValue<MoneyInterval>>>;
  readonly oneTimeExpenses: Readonly<Record<OneTimeExpenseId, FullLifeInputValue<MoneyInterval>>>;
  readonly savings: FullLifeInputValue<MoneyInterval>;
  readonly fx:
    | {
        readonly class: "official_fact";
        readonly value: CbrEurFacts;
        readonly claimId: string;
        readonly evidenceRefs: readonly [FullLifeEvidenceRef, ...FullLifeEvidenceRef[]];
      }
    | { readonly class: "unknown"; readonly reason: string };
  readonly householdSize: FullLifeInputValue<number>;
}

export interface FullLifeCalculatedMoney {
  readonly min: string;
  readonly max: string;
  readonly currency: "EUR";
  readonly inputRefs: readonly [string, ...string[]];
}

export type FullLifeCalculatedValue =
  | { readonly kind: "known"; readonly amount: FullLifeCalculatedMoney }
  | { readonly kind: "unknown"; readonly reason: string; readonly inputRefs: readonly string[] };

export type FullLifeFxLineage =
  | { readonly inputRef: string; readonly kind: "direct_eur" }
  | {
      readonly inputRef: string;
      readonly kind: "cbr_rub_to_eur";
      readonly claimId: string;
      readonly evidenceRefs: readonly [FullLifeEvidenceRef, ...FullLifeEvidenceRef[]];
      readonly rate: string;
      readonly referenceDate: string;
    }
  | {
      readonly inputRef: string;
      readonly kind: "unconverted";
      readonly sourceCurrency: string;
      readonly reason: string;
    };

export type FullLifeRunway =
  | { readonly kind: "finite"; readonly minMonths: string; readonly maxMonths: string }
  | { readonly kind: "no_known_deficit" }
  | { readonly kind: "lower_bound_only"; readonly minMonths: string }
  | { readonly kind: "unknown"; readonly inputRefs: readonly string[] };

export interface FullLifeBudget {
  readonly schemaVersion: "full-life-budget@1";
  readonly rulesVersion: "full-life-budget-rules@1";
  readonly formulaHash: string;
  readonly inputHash: string;
  readonly outputHash: string;
  readonly monthlyIncome: FullLifeCalculatedValue;
  readonly knownMonthlyExpenses: FullLifeCalculatedValue;
  readonly monthlyResidual: FullLifeCalculatedValue;
  readonly excludedMonthlyInputRefs: readonly string[];
  readonly knownOneTimeExpenses: FullLifeCalculatedValue;
  readonly excludedOneTimeInputRefs: readonly string[];
  readonly postCostSavings: FullLifeCalculatedValue;
  readonly fxLineage: readonly FullLifeFxLineage[];
  readonly runway: FullLifeRunway;
}

export function calculateFullLifeBudget(input: FullLifeBudgetInput): FullLifeBudget;
export function reconstructFullLifeBudget(input: {
  readonly input: unknown;
  readonly output: unknown;
}): FullLifeBudget;
```

`incomeReference` is the immutable Task 2 source value; `income` is exactly the work decision's `budgetIncome` and must either canonical-match that reference or be its explicit assumption replacement. Use unrounded Decimal intermediates and versioned rounding only at display boundaries. EUR enters the EUR calculation directly; RUB→EUR divides by the exact dated CBR EUR/RUB claim. Those are the only calculation pairs in `full-life-budget-rules@1`. A valid ISO-4217 source interval in any other currency remains byte-for-byte visible in `FullLifeBudgetInput`, but that interval and every conversion-dependent sum/runway become `unknown` with its exact input ref; do not relabel, drop, zero, midpoint or route it through RUB. Preserve source currency/rate/date/evidence in `fxLineage`. Gross/net and person/household mismatches stay unknown unless Task 2 supplied an explicit `budgetIncome.class:"assumption"`; calculation consumes that replacement while projection and Passport retain the original `incomeReference`. Calculate savings min/max separately, clamp each after known one-time expense at zero and implement the spec's three runway rows exactly. `knownMonthlyExpenses` and `knownOneTimeExpenses` are deliberately partial known sums only when at least one comparable input exists; if a cadence has zero comparable inputs, its value is `unknown` rather than fabricated EUR zero. The two excluded-ref arrays make incompleteness visible, while `monthlyResidual`, `postCostSavings` and `runway` become unknown whenever their required inputs cannot be compared.

- [ ] RED: direct EUR, dated RUB→EUR with exact claim/Evidence/date lineage, absent/stale/wrong-pair FX, exact USD/GBP source preservation with conversion-dependent unknown, basis mismatch, household mismatch, explicit replacement assumption, unknown exclusion, typed known sums/residual/post-cost savings, all-monthly-unknown and all-one-time-unknown without a zero fabrication, negative clamp and all runway cases.
- [ ] RED: stable formula/input/output hashes and byte-for-byte preservation of existing `FORMULA-VS1-FX-01` tests.
- [ ] GREEN: extract only Decimal/canonical-hash helpers from `budget.ts`; do not unify both formula domains.
- [ ] Verify and commit:

```bash
pnpm exec vitest run tests/domain/full-life-budget.test.ts tests/domain/budget.test.ts
pnpm typecheck
pnpm exec eslint src/branch/full-life-budget.ts src/branch/budget.ts \
  tests/domain/full-life-budget.test.ts
git add src/branch/full-life-budget.ts src/branch/budget.ts tests/domain/full-life-budget.test.ts
git commit -m "feat: calculate full life budget"
```

---

### Task 4: Guard canonical film bytes and controlled causal output

**Files:**
- Create: `src/branch/full-life-film.ts`
- Create: `tests/domain/full-life-film.test.ts`

**Exact bytes contract:**

```ts
export interface FullLifeModelManifest {
  readonly runtimeVersion: string;
  readonly modelSha256: string;
  readonly templateVersion: "full-life-film-template@1";
  readonly schemaVersion: "full-life-film@1";
  readonly parameters: {
    readonly seed: number;
    readonly temperature: number;
    readonly topP: number;
    readonly maxTokens: number;
  };
}

export type FullLifeInputRef =
  | `route:${string}`
  | `fact:${string}`
  | `user:${string}`
  | `calculation:${string}`
  | `assumption:${string}`
  | `unknown:${string}`
  | `decision:${"city" | "work" | "housing"}`;

export type FullLifeProjectionInputItem =
  | {
      readonly ref: FullLifeInputRef;
      readonly class: "official_fact";
      readonly value: unknown;
      readonly evidenceRefs: readonly [FullLifeEvidenceRef, ...FullLifeEvidenceRef[]];
    }
  | {
      readonly ref: FullLifeInputRef;
      readonly class: "user_fact";
      readonly value: unknown;
      readonly sourceRef: string;
    }
  | {
      readonly ref: FullLifeInputRef;
      readonly class: "calculation";
      readonly value: unknown;
      readonly formulaHash: string;
      readonly inputRefs: readonly [FullLifeInputRef, ...FullLifeInputRef[]];
    }
  | {
      readonly ref: FullLifeInputRef;
      readonly class: "assumption";
      readonly value: unknown;
      readonly reason: string;
      readonly inputRefs: readonly FullLifeInputRef[];
    }
  | {
      readonly ref: FullLifeInputRef;
      readonly class: "unknown";
      readonly reason: string;
      readonly inputRefs: readonly FullLifeInputRef[];
    };

export interface FullLifeProjectionInput {
  readonly schemaVersion: "full-life-projection-input@1";
  readonly selectionSnapshotId: string;
  readonly profileSnapshotId: string;
  readonly preferenceProfileSnapshotId: string;
  readonly routeBasis: FullLifeRouteBasis;
  readonly routeInputs: FullLifeRouteInputs;
  readonly decisions: FullLifeDecisions;
  readonly budget: FullLifeBudget;
  readonly inputCatalog: readonly [
    FullLifeProjectionInputItem,
    ...FullLifeProjectionInputItem[]
  ];
}

export interface FullLifeFilmSegment<
  K extends "morning" | "work" | "evening" | "night",
> {
  readonly segmentId: `day:${K}`;
  readonly kind: K;
  readonly text: string;
  readonly inputRefs: readonly [FullLifeInputRef, ...FullLifeInputRef[]];
}

export interface FullLifeTimelinePoint {
  readonly segmentId: `month:${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12}`;
  readonly month: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;
  readonly text: string;
  readonly inputRefs: readonly [FullLifeInputRef, ...FullLifeInputRef[]];
}

export interface FullLifeProjectionFactor {
  readonly factorId: "load" | "sleep" | "stress" | "social_context" | "career";
  readonly segmentId: `factor:${"load" | "sleep" | "stress" | "social_context" | "career"}`;
  readonly outlook: "lighter" | "mixed" | "heavier" | "unknown";
  readonly text: string;
  readonly inputRefs: readonly [FullLifeInputRef, ...FullLifeInputRef[]];
}

export type FullLifeFilmSegmentId =
  | FullLifeFilmDocument["typicalDay"][number]["segmentId"]
  | FullLifeTimelinePoint["segmentId"]
  | FullLifeProjectionFactor["segmentId"];

export interface FullLifeFilmDocument {
  readonly schemaVersion: "full-life-film@1";
  readonly typicalDay: readonly [
    FullLifeFilmSegment<"morning">,
    FullLifeFilmSegment<"work">,
    FullLifeFilmSegment<"evening">,
    FullLifeFilmSegment<"night">,
  ];
  readonly timeline: readonly [
    FullLifeTimelinePoint, FullLifeTimelinePoint, FullLifeTimelinePoint,
    FullLifeTimelinePoint, FullLifeTimelinePoint, FullLifeTimelinePoint,
    FullLifeTimelinePoint, FullLifeTimelinePoint, FullLifeTimelinePoint,
    FullLifeTimelinePoint, FullLifeTimelinePoint, FullLifeTimelinePoint,
  ];
  readonly factors: readonly [
    FullLifeProjectionFactor, FullLifeProjectionFactor,
    FullLifeProjectionFactor, FullLifeProjectionFactor,
    FullLifeProjectionFactor,
  ];
}

export interface RawFullLifeFilm {
  readonly canonicalBytes: string; // canonical UTF-8 JSON text of FullLifeFilmDocument
  readonly outputHash: string;     // sha256Text(canonicalBytes)
  readonly manifest: FullLifeModelManifest;
}

export interface SavedFullLifeFilm extends RawFullLifeFilm {
  readonly document: FullLifeFilmDocument;
  readonly manifestHash: string;
  readonly inputHash: string;
}

export interface FullLifeFilmEdits {
  readonly replacements: readonly {
    readonly segmentId: Exclude<FullLifeFilmSegmentId, `factor:${string}`>;
    readonly text: string;
  }[];
}

export interface EditedFullLifeFilm {
  readonly original: SavedFullLifeFilm;
  readonly edits: FullLifeFilmEdits;
  readonly document: FullLifeFilmDocument;
  readonly outputHash: string;
  readonly assumptionRefs: readonly FullLifeInputRef[];
}

export type FullLifeSavedPresentation =
  | {
      readonly editState: "unedited";
      readonly original: SavedFullLifeFilm;
    }
  | {
      readonly editState: "edited";
      readonly original: SavedFullLifeFilm;
      readonly edited: EditedFullLifeFilm;
    };

export type FullLifeCommittedFilm =
  | {
      readonly kind: "baseline";
      readonly presentation: FullLifeSavedPresentation;
    }
  | {
      readonly kind: "alternative";
      readonly presentation: FullLifeSavedPresentation;
      readonly storedBaselineFilmHash: string;
      readonly baselineControl: SavedFullLifeFilm;
      readonly diff: FullLifeFilmDiff;
    };

export interface FullLifeFilmDiff {
  readonly changedDecision: "city" | "work" | "housing";
  readonly routeUnchanged: true;
  readonly segments: readonly {
    readonly segmentId: FullLifeFilmSegmentId;
    readonly beforeHash: string;
    readonly afterHash: string;
    readonly classification: "causal" | "new_projection";
  }[];
}

export interface FullLifeFilmIntegrity {
  canonical(value: unknown): string;
  hash(canonicalText: string): string;
}

export function confirmFullLifeFilm(input: {
  readonly raw: RawFullLifeFilm;
  readonly projectionInput: FullLifeProjectionInput;
  readonly integrity: FullLifeFilmIntegrity;
}): SavedFullLifeFilm;

export function applyFullLifeFilmEdits(
  original: SavedFullLifeFilm,
  edits: FullLifeFilmEdits,
): EditedFullLifeFilm;

export function diffFullLifeFilms(input: {
  readonly changedDecision: "city" | "work" | "housing";
  readonly baseline: SavedFullLifeFilm;
  readonly baselineControl: SavedFullLifeFilm;
  readonly alternative: SavedFullLifeFilm;
  readonly baselineProjectionInput: FullLifeProjectionInput;
  readonly alternativeProjectionInput: FullLifeProjectionInput;
  readonly baselineIntent: FullLifeDecisionIntent;
  readonly alternativeIntent: FullLifeDecisionIntent;
}): FullLifeFilmDiff;
```

`confirmFullLifeFilm` parses `canonicalBytes`, requires byte equality with `integrity.canonical(document)`, recomputes `outputHash`, `manifestHash` and projection `inputHash`, then guards the closed typical-day catalog, exactly twelve month points, bounded factor catalog, stable segment IDs and non-empty exact `inputRefs`. Raw token text is session-only; canonical bytes/hash are the only film output persisted.

Prepare must pass raw control output through `confirmFullLifeFilm(rawControl, baselineProjectionInput, integrity)` before diffing. The diff verifies both saved films' input/manifest hashes against the supplied projection inputs, canonical route bytes across projections, and `assertExactlyOneFullLifeDecisionChange(baselineIntent, alternativeIntent, changedDecision)`. It labels a segment `causal` only when the confirmed baseline-control canonical bytes/hash equal the stored baseline and the changed segment references `decision:<kind>`. Every other narrative change is `new_projection`; it is saved, but never described as caused by the decision.

- [ ] RED: every post-Task-4 feasibility fixture passes the production DTO/grammar guard unchanged; malformed/noncanonical bytes, hash/manifest/input mismatch, unknown filling, invented fact/link/calculation/probability, missing/duplicate segment IDs and invalid refs fail.
- [ ] RED: edit-as-assumption with original preservation; raw control cannot enter diff; byte-equal and non-equal confirmed controls; projection input/manifest/route mismatch; wrong/two decision intents; missing cause refs; exact `causal | new_projection` result.
- [ ] GREEN: implement pure confirmation/edit/diff only.
- [ ] Verify and commit:

```bash
pnpm exec vitest run tests/domain/full-life-film.test.ts
pnpm typecheck
pnpm exec eslint src/branch/full-life-film.ts tests/domain/full-life-film.test.ts
git add src/branch/full-life-film.ts tests/domain/full-life-film.test.ts
git commit -m "feat: guard full life film"
```

---

### Task 5: Prepare baseline or alternative with zero writes

**Files:**
- Create: `src/application/full-life-contracts.ts`
- Create: `src/application/full-life.ts`
- Create: `tests/integration/full-life-prepare.test.ts`

**Commands and ports:**

```ts
export type PrepareFullLifeCommand =
  | {
      readonly kind: "baseline";
      readonly commandId: string;
      readonly selectionId: string;
      readonly factsSnapshotId: string;
      readonly routeBasisHash: string;
      readonly routeInputAnswers: unknown;
      readonly draft: unknown;
    }
  | {
      readonly kind: "alternative";
      readonly commandId: string;
      readonly baselineCommitId: string;
      readonly selectionId: string;
      readonly factsSnapshotId: string;
      readonly changedDecision: "city" | "work" | "housing";
      readonly draft: unknown;
    };

export interface FullLifeFilmGeneratorPort {
  generate(input: FullLifeProjectionInput): Promise<RawFullLifeFilm>;
}

export interface PreparedEnvelopeIntegrity extends FullLifeFilmIntegrity {
  sign(canonicalText: string): string;
  verify(canonicalText: string, signature: string): boolean;
}

export interface PreparedFullLifeCommon {
  readonly commandId: string;
  readonly preparedAt: string;
  readonly citySelectionSnapshotId: string;
  readonly cityBranchCommitId: string;
  readonly preCityBranchCommitId: string;
  readonly profileSnapshotId: string;
  readonly preferenceProfileSnapshotId: string;
  readonly resolvedCountryShortlistRevisionId: string;
  readonly factsSnapshotId: string;
  readonly routeBasis: FullLifeRouteBasis;
  readonly routeInputs: FullLifeRouteInputs;
  readonly draft: FullLifeDraft;
  readonly budgetInput: FullLifeBudgetInput;
  readonly budget: FullLifeBudget;
}

export type PreparedFullLifePayload =
  | (PreparedFullLifeCommon & {
      readonly kind: "baseline";
      readonly projectionInput: FullLifeProjectionInput;
      readonly originalFilm: SavedFullLifeFilm;
    })
  | (PreparedFullLifeCommon & {
      readonly kind: "alternative";
      readonly baselineCommitId: string;
      readonly changedDecision: "city" | "work" | "housing";
      readonly baselineProjectionInput: FullLifeProjectionInput;
      readonly storedBaselineFilm: SavedFullLifeFilm;
      readonly baselineControl: SavedFullLifeFilm;
      readonly alternativeProjectionInput: FullLifeProjectionInput;
      readonly alternativeFilm: SavedFullLifeFilm;
      readonly filmDiff: FullLifeFilmDiff;
    });

export interface PreparedFullLifeEnvelope {
  readonly schemaVersion: "prepared-full-life-envelope@1";
  readonly payload: PreparedFullLifePayload;
  readonly payloadHash: string;
  readonly signature: string;
}

export interface VerifiedFullLifeCommit {
  readonly id: string;
  readonly parentId?: string;
  readonly forkedFrom?: string;
  readonly citySelectionSnapshotId: string;
  readonly cityBranchCommitId: string;
  readonly preCityBranchCommitId: string;
  readonly profileSnapshotId: string;
  readonly preferenceProfileSnapshotId: string;
  readonly resolvedCountryShortlistRevisionId: string;
  readonly factsSnapshotId: string;
  readonly routeBasis: FullLifeRouteBasis;
  readonly routeInputs: FullLifeRouteInputs;
  readonly decisions: FullLifeDecisions;
  readonly budgetInput: FullLifeBudgetInput;
  readonly budget: FullLifeBudget;
  readonly projectionInput: FullLifeProjectionInput;
  readonly film: FullLifeCommittedFilm;
  readonly rulesVersion: "full-life-branch-rules@1";
}

export interface FullLifeAlternativeSetupReadModel {
  readonly baseline: VerifiedFullLifeCommit;
  readonly selection: CitySelectionWithBranch;
  readonly lockedRouteBasis: FullLifeRouteBasis;
  readonly lockedRouteInputs: FullLifeRouteInputs;
}

export interface FullLifePreparePorts {
  readonly selections: CitySelectionReadPort;
  readonly routeInputs: FullLifeRouteInputPorts;
  readonly decisionInputs: FullLifeDecisionInputsReadPort;
  readonly profiles: {
    loadRelocationV2Verified(id: string): Promise<RelocationProfileV2Snapshot>;
    loadPreferenceV2Verified(id: string): Promise<PreferenceProfileV2Snapshot>;
  };
  readonly countryResolutions: {
    loadResolvedVerified(id: string): Promise<ResolvedCountryShortlistSnapshot>;
  };
  readonly facts: FullLifeVerifiedFactsReadPort;
  readonly baselines: {
    loadBaselineVerified(id: string): Promise<VerifiedFullLifeCommit>;
    findBaselineByPreCityVerified(
      preCityBranchCommitId: string,
    ): Promise<VerifiedFullLifeCommit | undefined>;
    findAlternativeVerified(
      baselineId: string,
    ): Promise<VerifiedFullLifeCommit | undefined>;
  };
  readonly film: FullLifeFilmGeneratorPort;
  readonly integrity: PreparedEnvelopeIntegrity;
  readonly clock: () => Date;
}

export function prepareFullLifeBranch(
  command: PrepareFullLifeCommand,
  ports: FullLifePreparePorts,
): Promise<PreparedFullLifeEnvelope>;

export function loadFullLifeAlternativeSetup(
  input: { readonly baselineCommitId: string; readonly selectionId: string },
  ports: Pick<
    FullLifePreparePorts,
    "selections" | "routeInputs" | "baselines"
  >,
): Promise<FullLifeAlternativeSetupReadModel>;
```

`FullLifePreparePorts` is exactly the read-only interface above. It contains no append/save/publish port. Its clock is read once after all validation and model calls to seal one canonical `preparedAt`; Commit never reads another clock.

`PreparedFullLifePayload` is the closed union above. Alternative stores both verified controls and the alternative explicitly; no open metadata bag or model text exists beside the guarded films.

Every selection wrapper loaded by setup, Prepare, Commit or alternative setup must satisfy `selection.preCityBranchCommitId === commit.parentId === commit.forkedFrom`; the verified upstream reader checks the same relation before the wrapper crosses the port.

`loadFullLifeAlternativeSetup` reloads the baseline and requested selection, requires `selection.selection.preCityBranchCommitId === baseline.preCityBranchCommitId`, rederives the exact route choices for the requested sibling and requires the baseline's locked route hash/basis to remain present. It returns fresh frozen server values and never creates a selection, reads a source or calls the model.

Before calculating or calling the model, Prepare reloads all route authority on the server. For a baseline it calls `loadFullLifeSetup(command.selectionId, ports.routeInputs)`, canonical-compares `setup.selection` with the separately loaded wrapper, finds exactly one choice by the submitted `routeBasisHash`, calls `loadFullLifeRouteInputStep({ selectionId, routeBasisHash }, ports.routeInputs)`, and derives the authoritative basis from the choice plus authoritative inputs through `confirmFullLifeRouteInputs(step, command.routeInputAnswers)`. The browser never submits a trusted basis or completed input object. For an alternative Prepare repeats setup/choice/step derivation for the stored baseline selection and passes the stored inputs through `reconstructFullLifeRouteInputs`; a city alternative separately proves that the same basis/hash exists for the new same-country sibling but never changes the route bytes. A missing/changed marker, accepted-yellow decision, choice, hash, requirement, answer or selection binding fails before budget, clock or model. `ResolvedCountryShortlistSnapshot` alone is never treated as enough route authority.

Prepare then calls `decisionInputs.loadVerified(command.selectionId)` and canonical-compares it with the separately reloaded selection/profile/preference references. The untrusted `draft` may choose only a projected participant/profession/housing/selection and may supply only the documented user value or assumption fields. Prepare reconstructs current-work income, savings, installed labels, city marker/facts and `officialRent` from the fresh projection. For installed profession it applies the Task 2 city-first/national-second singleton rule to the freshly loaded `FullLifeVerifiedFacts` and binds the exact `signalClaimId`; a client-supplied or stale official value, source class/ref, label, marker, rent, profile value, signal choice, invalid/non-ISO currency or sibling selection fails before the model call. A `not_working` projection remains visible but cannot enter `keep_current_work`. A work or housing alternative must reuse the baseline `factsSnapshotId` exactly. A city alternative must occur in the baseline selection's fresh `siblingCities`, load a new facts snapshot bound to that selection/city, and report the changed Evidence lineage in Passport/diff; it may not reuse city-scoped facts from the baseline. Every selection must share the baseline's exact `selection.preCityBranchCommitId`, which is copied into the prepared payload. This is revalidation, not a client projection hash or a new persistence layer.

Baseline calls `film.generate(baselineProjectionInput)` exactly once. Alternative copies the baseline route and route inputs, verifies exactly the declared city/work/housing change, then calls the same port exactly twice in order: first the unchanged saved baseline projection input (control), then alternative input. Both calls use the film port's identical pinned manifest/settings. There is no fallback, retry or retry state.

After the last model result is guarded, Prepare reads `clock()` exactly once, requires a canonical instant, stores it as `preparedAt`, and creates the envelope exactly: `payloadCanonical = integrity.canonical(payload)`, `payloadHash = integrity.hash(payloadCanonical)`, `signature = integrity.sign(payloadCanonical)`. Prepare owns deep snapshots before any async callback and writes nothing on success or failure.

- [ ] RED baseline lineage/mutation/source-drift/model/guard failures; fresh setup/route-step/route-input reconstruction; changed choice/marker/accepted-yellow/hash/requirement rejection before budget/model; fresh decision-input load; rejected client profile/catalog/marker/official-rent/profession-signal/source data; exact current-work/savings reconstruction; one model call, one final clock read and zero writes.
- [ ] RED alternative route/input immutability, verified projected sibling city context, non-sibling/tampered sibling rejection, work/housing exact facts reuse, city-bound new facts/Evidence diff, exact one changed intent plus shared-input equality, second existing alternative, ordered confirmed baseline-control/alternative calls and saved control bytes.
- [ ] RED accepted-yellow exact unknown outcome and fallback; never collapse an available unknown route to `route_unresolved`.
- [ ] GREEN implement the narrow application use case.
- [ ] Verify and commit:

```bash
pnpm exec vitest run \
  tests/integration/full-life-prepare.test.ts \
  tests/domain/full-life.test.ts \
  tests/domain/full-life-budget.test.ts \
  tests/domain/full-life-film.test.ts
pnpm typecheck
pnpm exec eslint \
  src/application/full-life-contracts.ts src/application/full-life.ts \
  tests/integration/full-life-prepare.test.ts
git add src/application/full-life-contracts.ts src/application/full-life.ts \
  tests/integration/full-life-prepare.test.ts
git commit -m "feat: prepare full life branch"
```

---

### Task 6: Create pure Full Life commits, Passport and diff

**Files:**
- Modify: `src/branch/life-git.ts`
- Create: `src/branch/full-life-passport.ts`
- Create: `tests/branch/full-life-git.test.ts`
- Create: `tests/domain/full-life-passport.test.ts`
- Modify: `tests/branch/life-git.test.ts`

Keep the current housing `BranchCommit` and its canonical bytes unchanged. Add a separate `FullLifeBranchCommit` and outward union `LifeGitCommit = BranchCommit | FullLifeBranchCommit`.

```ts
export type FullLifePassportItem =
  | {
      readonly class: "official_fact";
      readonly inputRef: FullLifeInputRef;
      readonly evidenceRefs: readonly [FullLifeEvidenceRef, ...FullLifeEvidenceRef[]];
    }
  | {
      readonly class: "user_fact";
      readonly inputRef: FullLifeInputRef;
      readonly sourceRef: string;
    }
  | {
      readonly class: "calculation";
      readonly inputRef: FullLifeInputRef;
      readonly formulaHash: string;
      readonly inputRefs: readonly [FullLifeInputRef, ...FullLifeInputRef[]];
    }
  | {
      readonly class: "assumption";
      readonly inputRef: FullLifeInputRef;
      readonly reason: string;
      readonly inputRefs: readonly FullLifeInputRef[];
    }
  | {
      readonly class: "projection";
      readonly segmentId: FullLifeFilmSegmentId;
      readonly inputRefs: readonly [FullLifeInputRef, ...FullLifeInputRef[]];
    }
  | {
      readonly class: "unknown";
      readonly inputRef: FullLifeInputRef;
      readonly reason: string;
      readonly inputRefs: readonly FullLifeInputRef[];
    };

export interface FullLifePassport {
  readonly schemaVersion: "full-life-passport@1";
  readonly rulesVersion: "full-life-passport-rules@1";
  readonly items: readonly [FullLifePassportItem, ...FullLifePassportItem[]];
}

export type FullLifeDecisionDelta =
  | {
      readonly kind: "city";
      readonly beforeSelectionSnapshotId: string;
      readonly afterSelectionSnapshotId: string;
    }
  | {
      readonly kind: "work";
      readonly before: FullLifeWorkDecision;
      readonly after: FullLifeWorkDecision;
    }
  | {
      readonly kind: "housing";
      readonly before: FullLifeHousingDecision;
      readonly after: FullLifeHousingDecision;
    };

export interface FullLifeBranchDiff {
  readonly schemaVersion: "full-life-diff@1";
  readonly baselineId: string;
  readonly alternativeId: string;
  readonly decision: FullLifeDecisionDelta;
  readonly sharedProfileSnapshotId: string;
  readonly sharedPreferenceProfileSnapshotId: string;
  readonly sharedResolvedCountryShortlistRevisionId: string;
  readonly beforeBudget: FullLifeBudget;
  readonly afterBudget: FullLifeBudget;
  readonly changedBudgetFields: readonly (
    | "monthly_income"
    | "known_monthly_expenses"
    | "monthly_residual"
    | "excluded_monthly_inputs"
    | "known_one_time_expenses"
    | "excluded_one_time_inputs"
    | "post_cost_savings"
    | "runway"
  )[];
  readonly film: FullLifeFilmDiff;
}

export interface FullLifeBranchCommit {
  readonly schemaVersion: "full-life-branch@1";
  readonly id: string;
  readonly commandId: string;
  readonly parentId?: string;
  readonly forkedFrom?: string;
  readonly citySelectionSnapshotId: string;
  readonly cityBranchCommitId: string;
  readonly preCityBranchCommitId: string;
  readonly profileSnapshotId: string;
  readonly preferenceProfileSnapshotId: string;
  readonly resolvedCountryShortlistRevisionId: string;
  readonly factsSnapshotId: string;
  readonly routeBasis: FullLifeRouteBasis;
  readonly routeInputs: FullLifeRouteInputs;
  readonly decisions: FullLifeDecisions;
  readonly budgetInput: FullLifeBudgetInput;
  readonly budget: FullLifeBudget;
  readonly projectionInput: FullLifeProjectionInput;
  readonly film: FullLifeCommittedFilm;
  readonly passport: FullLifePassport;
  readonly rulesVersion: "full-life-branch-rules@1";
  readonly inputHash: string;
  readonly outputHash: string;
  readonly createdAt: string;
}

export interface CreateFullLifeCommitInput {
  readonly commandId: string;
  readonly prepared: PreparedFullLifePayload;
  readonly film: FullLifeCommittedFilm;
  readonly passport: FullLifePassport;
  readonly integrity: FullLifeFilmIntegrity;
}

export function createFullLifeCommit(input: CreateFullLifeCommitInput): FullLifeBranchCommit;
export function replayFullLifeCommit(input: unknown): FullLifeBranchCommit;
export function diffFullLifeCommits(
  baseline: FullLifeBranchCommit,
  alternative: FullLifeBranchCommit,
): FullLifeBranchDiff;
```

Baseline omits both parent fields. Every commit copies the verified `selection.preCityBranchCommitId`; an alternative requires it to equal the baseline's, requires `parentId = forkedFrom = baseline.id`, identical route/route-input/profile/preference/country/rules, the Task 5 facts-snapshot rule for its declared delta, exactly one decision-intent change and identical shared user inputs. `createdAt` is exactly `prepared.preparedAt`, so replaying the same signed command does not call a clock or produce a different commit. `FullLifeCommittedFilm` is the Task 4 closed union and preserves original bytes beside any edit. Passport and diff use only the closed DTOs above; every item has an exact input/source/formula/segment reference. The diff carries both reconstructed typed budgets and a canonical ordered list of changed presentation fields, so reload never infers monetary changes from hashes or reruns calculation in Experience.

- [ ] RED stable ID/replay, all six Passport classes, original/edited bytes, parent/fork, immutable route and exactly-one-decision rules.
- [ ] RED tamper every hash/lineage/film/Passport field and preserve all existing housing Life Git tests byte-for-byte.
- [ ] GREEN implement only pure construction/replay/diff; no SQLite/application imports.
- [ ] Verify and commit:

```bash
pnpm exec vitest run \
  tests/branch/full-life-git.test.ts \
  tests/domain/full-life-passport.test.ts \
  tests/branch/life-git.test.ts
pnpm typecheck
pnpm exec eslint \
  src/branch/life-git.ts src/branch/full-life-passport.ts \
  tests/branch/full-life-git.test.ts tests/domain/full-life-passport.test.ts
git add src/branch/life-git.ts src/branch/full-life-passport.ts \
  tests/branch/full-life-git.test.ts tests/domain/full-life-passport.test.ts \
  tests/branch/life-git.test.ts
git commit -m "feat: commit full life domain"
```

---

### Task 7: Verify envelopes and atomically publish into the existing store

**Files:**
- Modify: `src/application/full-life.ts`
- Modify: `src/application/full-life-contracts.ts`
- Create: `src/application/present-full-life.ts`
- Modify: `src/infrastructure/integrity.ts`
- Modify: `src/infrastructure/sqlite/branch-store.ts`
- Modify: `src/infrastructure/sqlite/schema.sql`
- Modify: `src/infrastructure/sqlite/db.ts`
- Create: `scripts/reset-demo-cli.ts`
- Modify: `package.json`
- Modify: `.env.example`
- Modify: `.gitignore`
- Create: `tests/integration/full-life-commit.test.ts`
- Create: `tests/integration/full-life-store.test.ts`
- Create: `tests/integration/full-life-present.test.ts`
- Modify: `tests/integration/database-schema.test.ts`
- Modify: `tests/integration/reset-demo.test.ts`

**Application-owned commit:**

```ts
export interface CommitFullLifeCommand {
  readonly commandId: string;
  readonly prepared: PreparedFullLifeEnvelope;
  readonly filmEdits?: FullLifeFilmEdits;
}

export function commitFullLifeBranch(
  command: CommitFullLifeCommand,
  ports: FullLifeCommitPorts,
): Promise<FullLifeBranchCommit>;

export interface FullLifeCommitStore {
  loadFullLifeVerified(id: string): Promise<FullLifeBranchCommit>;
  findBaselineByPreCityVerified(
    preCityBranchCommitId: string,
  ): Promise<FullLifeBranchCommit | undefined>;
  findAlternativeVerified(baselineId: string): Promise<FullLifeBranchCommit | undefined>;
  publishExact(commit: FullLifeBranchCommit): Promise<FullLifeBranchCommit>;
}

export interface FullLifeCommitPorts {
  readonly integrity: PreparedEnvelopeIntegrity;
  readonly selections: CitySelectionReadPort;
  readonly routeInputs: FullLifeRouteInputPorts;
  readonly profiles: FullLifePreparePorts["profiles"];
  readonly countryResolutions: FullLifePreparePorts["countryResolutions"];
  readonly facts: FullLifeVerifiedFactsReadPort;
  readonly baselines: FullLifePreparePorts["baselines"];
  readonly store: FullLifeCommitStore;
}

export type FullLifePresentationReadModel =
  | {
      readonly kind: "baseline";
      readonly baseline: FullLifeBranchCommit;
      readonly comparison?: {
        readonly alternative: FullLifeBranchCommit;
        readonly diff: FullLifeBranchDiff;
      };
    }
  | {
      readonly kind: "alternative";
      readonly baseline: FullLifeBranchCommit;
      readonly alternative: FullLifeBranchCommit;
      readonly diff: FullLifeBranchDiff;
    };

export interface PresentFullLifePorts {
  readonly commits: Pick<
    FullLifeCommitStore,
    "loadFullLifeVerified" | "findAlternativeVerified"
  >;
}

export function presentFullLife(
  commitId: string,
  ports: PresentFullLifePorts,
): Promise<FullLifePresentationReadModel>;
```

Application first requires `command.commandId === prepared.payload.commandId`, recomputes canonical payload/hash, calls `verify(payloadCanonical, signature)`, reloads every immutable selection/profile/preference/country/facts/baseline reference, and repeats the same server route setup/choice/step/input reconstruction used by Prepare. It verifies the exact shared `preCityBranchCommitId`, reconstructs draft/budget/projection/film, applies typed edits, derives Passport and calls `createFullLifeCommit` with the signed `preparedAt`. It makes no official-source, model or clock call. Only then does it invoke `publishExact` once. A second baseline anywhere under the same pre-city parent is rejected before publish; the database index below remains the race-safe authority.

`createPreparedFullLifeIntegrity` in `infrastructure/integrity.ts` exposes exactly `canonical/hash/sign/verify`; `verify` recomputes HMAC and uses existing `secureHexEqual`. Do not widen `EvidenceIntegrity` or add a generic signing service.

`SqliteBranchStore.publishExact` owns one SQLite transaction: insert-or-load same command, reject a different payload, reload/reconstruct/HMAC-verify, return. No domain calculation, envelope verification, model call or cross-port callback occurs inside the transaction.

`presentFullLife` loads only verified Full Life commits. For a requested alternative it loads its exact baseline parent; for a requested baseline it may load its sole alternative. It reconstructs `FullLifeBranchDiff` from saved commits and returns the closed read model above. Its port has no facts, source, clock or model capability.

**Exact reset-only schema transition:**

- Add `schema_version`, `command_id`, `preference_profile_id`, `city_selection_snapshot_id`, `city_branch_commit_id` and `pre_city_branch_commit_id` to `branch_commits`.
- Make legacy-only `assessment_id` nullable and add one closed CHECK: `housing-branch@1` requires legacy mirrors and forbids Full Life mirrors; `full-life-branch@1` requires command/profile/preference/facts/selection/city/pre-city mirrors, forbids assessment, and requires either both parent fields null or `parent_id = forked_from`.
- Add FK bindings to `profile_snapshots`, `evidence_snapshots` and `city_selection_snapshots`; both `city_branch_commit_id` and `pre_city_branch_commit_id` reference `city_branch_commits(id)`. Before insert and again on verified reload, require the selected City row's `parent_id = forked_from = pre_city_branch_commit_id`, its selection FK equals `city_selection_snapshot_id`, and the referenced pre-city row has `kind = "pre_city"` with the same country/profile/preference lineage. Full Life never points the pre-city mirror at the legacy housing `branch_commits` table.
- Add partial unique indexes:

```sql
CREATE UNIQUE INDEX branch_commits_one_full_life_baseline_per_pre_city_branch
ON branch_commits(pre_city_branch_commit_id)
WHERE schema_version = 'full-life-branch@1' AND forked_from IS NULL;

CREATE UNIQUE INDEX branch_commits_one_full_life_alternative_per_baseline
ON branch_commits(forked_from)
WHERE schema_version = 'full-life-branch@1' AND forked_from IS NOT NULL;

CREATE UNIQUE INDEX branch_commits_one_full_life_command
ON branch_commits(command_id)
WHERE schema_version = 'full-life-branch@1';
```

The first index enforces one baseline across every sibling city selection in the same journey; the second enforces at most one alternative to that baseline. Application prechecks are only friendly feedback. `db.ts` must preflight the exact new table/index/FK shape—including both City-commit references and no pre-city FK to `branch_commits`—before `schema.sql` and throw `database_schema_reset_required` for the current legacy table without modifying it.

There is no data migration. Change the demo-only example to `DATABASE_PATH=data/current-run/life-branches.db`, ignore `data/**/*.db` plus SQLite siblings, and add `"reset:demo": "node --import tsx scripts/reset-demo-cli.ts"`. The CLI accepts no paths, creates only `data/current-run/` when absent, then calls existing `resetDemo(resolve("data/current-run/life-branches.db"), resolve("data"))`. This satisfies the existing strict-descendant guard and deletes only that configured disposable demo DB plus `-wal/-shm`. Never run it automatically. After the user explicitly confirms that exact DB is disposable, the one reset command is:

```bash
pnpm run reset:demo
```

- [ ] RED invalid/tampered signature, changed envelope/edits/references, zero publish on failure, same signed command stable `createdAt`/ID idempotency, changed envelope under one command conflict and application ownership.
- [ ] RED route authority drift at Commit, selected-City parent/fork/pre-city mismatch, wrong City-commit FK target, different pre-city parent, second baseline through a sibling city selection, partial failure, load tamper, old-schema preflight untouched, fresh schema inventory, immutable triggers, two-command races for both the journey baseline and second alternative, and legacy housing append/replay.
- [ ] GREEN implement the integrity view, schema/store, reset CLI and application commit in that order.
- [ ] Verify:

```bash
pnpm exec vitest run \
  tests/integration/full-life-commit.test.ts \
  tests/integration/full-life-store.test.ts \
  tests/integration/full-life-present.test.ts \
  tests/integration/database-schema.test.ts \
  tests/integration/reset-demo.test.ts \
  tests/branch/full-life-git.test.ts \
  tests/branch/life-git.test.ts
pnpm typecheck
pnpm exec eslint \
  src/application/full-life.ts src/application/full-life-contracts.ts \
  src/infrastructure/integrity.ts src/infrastructure/sqlite/branch-store.ts \
  src/infrastructure/sqlite/db.ts scripts/reset-demo-cli.ts \
  tests/integration/full-life-commit.test.ts \
  tests/integration/full-life-store.test.ts
```

- [ ] Atomic code commit (do not include or create a demo DB):

```bash
git add src/application/full-life.ts src/application/full-life-contracts.ts \
  src/application/present-full-life.ts \
  src/infrastructure/integrity.ts src/infrastructure/sqlite/branch-store.ts \
  src/infrastructure/sqlite/schema.sql src/infrastructure/sqlite/db.ts \
  scripts/reset-demo-cli.ts package.json .env.example .gitignore \
  tests/integration/full-life-commit.test.ts \
  tests/integration/full-life-store.test.ts \
  tests/integration/full-life-present.test.ts \
  tests/integration/database-schema.test.ts tests/integration/reset-demo.test.ts
git commit -m "feat: publish full life atomically"
```

---

### Task 8: Add film to the shared local capability facade

**Files:**
- Verify unchanged: `src/infrastructure/local-model/qwen-runtime.ts`
- Modify: `src/infrastructure/local-model/onboarding-model.ts`
- Modify: `src/infrastructure/local-model/full-life-film-template.ts`
- Create: `src/infrastructure/full-life-composition.ts`
- Modify: `src/infrastructure/composition-root.ts`
- Create: `tests/integration/local-film-generator.test.ts`
- Modify: `tests/integration/local-model-runtime.test.ts`
- Modify: `tests/integration/full-life-route-inputs.test.ts`
- Modify: `tests/integration/full-life-prepare.test.ts`
- Create: `evals/full-life.ts`
- Create: `evals/fixtures/full-life/cases.json`

`qwen-runtime.ts` remains the one low-level Infrastructure adapter and keeps its only generation seam:

```ts
export class QwenLocalModelAdapter {
  generateJson(input: {
    readonly prompt: string;
    readonly grammar: string;
    readonly maxTokens: number;
    readonly signal: AbortSignal;
  }): Promise<string>;
}
```

`full-life-film-template.ts` remains only a template/JSON-grammar/settings helper. Extend the existing capability facade in `onboarding-model.ts`; do not make the low-level runtime adapter implement Application ports:

```ts
export interface LocalModelCapabilities
  extends LocalOnboardingModelPort, FullLifeFilmGeneratorPort {}

export function createLocalModelCapabilities(
  runtime: QwenLocalModelAdapter,
): LocalModelCapabilities;

export interface FullLifeApplication {
  loadSetup(selectionId: string): Promise<FullLifeSetupReadModel>;
  loadAlternativeSetup(input: {
    readonly baselineCommitId: string;
    readonly selectionId: string;
  }): Promise<FullLifeAlternativeSetupReadModel>;
  loadDecisionInputs(selectionId: string): Promise<FullLifeDecisionInputProjection>;
  researchFacts(input: {
    readonly selectionId: string;
    readonly signal: AbortSignal;
  }): Promise<FullLifeVerifiedFacts>;
  loadRouteInputStep(input: {
    readonly selectionId: string;
    readonly routeBasisHash: string;
  }): Promise<FullLifeRouteInputStep>;
  prepare(command: PrepareFullLifeCommand): Promise<PreparedFullLifeEnvelope>;
  commit(command: CommitFullLifeCommand): Promise<FullLifeBranchCommit>;
  present(commitId: string): Promise<FullLifePresentationReadModel>;
}

export interface FullLifeCompositionDependencies {
  readonly selections: CitySelectionReadPort;
  readonly routeInputs: FullLifeRouteInputPorts;
  readonly decisionInputs: FullLifeDecisionInputsReadPort;
  readonly profiles: FullLifePreparePorts["profiles"];
  readonly countryResolutions: FullLifePreparePorts["countryResolutions"];
  readonly factsResearch: FullLifeFactsResearchPorts;
  readonly facts: FullLifeVerifiedFactsReadPort;
  readonly commits: FullLifeCommitStore;
  readonly film: FullLifeFilmGeneratorPort;
  readonly integrity: PreparedEnvelopeIntegrity;
  readonly clock: () => Date;
}

export function createFullLifeApplication(
  dependencies: FullLifeCompositionDependencies,
): FullLifeApplication;
```

The factory returns one object whose `extract`, `review` and `generate` methods own only their three fixed template/grammar/settings contracts and delegate raw constrained generation to `runtime.generateJson`. The composition root constructs exactly one `QwenLocalModelAdapter`, calls `createLocalModelCapabilities` exactly once and injects that same facade object as both `onboardingPorts.model` and `fullLifePorts.film`. `generate` uses the one `full-life-film-template@1` contract, canonicalizes the guarded structured document with `canonicalJson` and hashes those exact bytes with `sha256Text`. Do not create `full-life-film-generator.ts`, a second facade/runtime/model instance, generic model client, provider registry/switch, feature flag, fallback or retry loop.

`full-life-composition.ts` implements the Task 2 read seams without persistence: `FullLifeCountryContextReadPort` composes the existing Country Resolution/Place Frontier verified readers; `FullLifeCityDecisionSourceReadPort` composes the exact City Frontier terminal chain, installed City Catalog labels and `listSelectionsWithBranchesVerified`; and one `FullLifeDecisionInputsReadPort` delegates to `loadFullLifeDecisionInputs` with `loadRelocationV2Verified`, `loadPreferenceV2Verified` and the fixed Slovenia plan. No copied catalog, marker, rent or sibling cache is introduced.

The same file assembles one `FullLifeApplication`, not separate ad-hoc action graphs. It first constructs the Task 2 route/decision read objects from the existing verified City Selection/Country Resolution/Place Frontier/profile stores and installed Slovenia plan, then passes the exact `FullLifeCompositionDependencies` object above to the application factory. The factory maps `commits.loadFullLifeVerified` to the narrower baseline loader only after proving `forkedFrom === undefined`, and uses the same commit port directly for commit and presentation; it introduces no second graph, registry or store-specific inward type. It binds Task 1 research, Task 2 setup/route/decision reads, Task 5 prepare/alternative setup, Task 7 commit and presentation. `researchFacts` verified-loads the selection, reads the server clock once, derives `assessmentDate = now.toISOString().slice(0, 10)`, `runId = "full-life-facts:" + integrity.hash(integrity.canonical({ selectionSnapshotId: selection.selection.id, cityId: selection.selection.cityId, assessmentDate }))`, `snapshotId = runId + ":evidence"` and `deadlineAt = now + 30_000ms`, then calls the Task 1 use case with the request AbortSignal. That use case performs its exact `findVerified` read before any source/capture callback; a repeated same-selection/same-date call therefore returns the already verified snapshot with zero writes, and tamper never falls through to capture. The browser cannot choose IDs, date or deadline. The composition root constructs this application once and exports it to Task 9 actions.

- [ ] RED `QwenLocalModelAdapter` exposes `generateJson` but does not implement `extract`, `review` or `generate`; `onboardingPorts.model === fullLifePorts.film`, one runtime/facade/model load, exact manifest/settings, canonical bytes/hash, malformed/refusal/oversize/outage and zero external network/telemetry.
- [ ] RED one composed application binds every listed verified reader/store/adapter plus the same route/decision/model objects into setup, facts, prepare, commit and present; no action constructs a partial graph and no source reader is called through a browser projection.
- [ ] RED facts research accepts only selection ID + request signal, derives canonical server date/deadline/run/snapshot IDs, is same-day idempotent and cannot be influenced by client IDs/dates.
- [ ] RED replay/presentation make zero adapter calls.
- [ ] GREEN add only the film capability, decision-input read composition and object identity wiring.
- [ ] Run the fake and real gates:

```bash
pnpm exec vitest run \
  tests/integration/local-film-generator.test.ts \
  tests/integration/local-model-runtime.test.ts \
  tests/integration/onboarding.test.ts \
  tests/integration/full-life-route-inputs.test.ts \
  tests/integration/full-life-prepare.test.ts
pnpm exec tsx evals/full-life.ts --mode=golden
pnpm typecheck
pnpm exec eslint \
  src/infrastructure/local-model/onboarding-model.ts \
  src/infrastructure/local-model/full-life-film-template.ts \
  src/infrastructure/full-life-composition.ts \
  src/infrastructure/composition-root.ts \
  tests/integration/local-film-generator.test.ts \
  tests/integration/full-life-route-inputs.test.ts \
  tests/integration/full-life-prepare.test.ts evals/full-life.ts
```

- [ ] Require same-input canonical byte equivalence on the pinned build/device before causal wording is enabled.
- [ ] Atomic commit:

```bash
git add src/infrastructure/local-model/onboarding-model.ts \
  src/infrastructure/local-model/full-life-film-template.ts \
  src/infrastructure/full-life-composition.ts \
  src/infrastructure/composition-root.ts \
  tests/integration/local-film-generator.test.ts \
  tests/integration/local-model-runtime.test.ts \
  tests/integration/full-life-route-inputs.test.ts \
  tests/integration/full-life-prepare.test.ts \
  evals/full-life.ts evals/fixtures/full-life/cases.json
git commit -m "feat: generate local full life film"
```

---

### Task 9: Deliver the route-first workspace and one alternative control

**Files:**
- Create: `src/experience/full-life-view-model.ts`
- Create: `src/experience/components/FullLifeJourney.tsx`
- Create: `src/experience/components/FullLifeRouteInputs.tsx`
- Create: `src/experience/components/FullLifeWorkspace.tsx`
- Modify: `src/experience/components/EvidencePassport.tsx`
- Modify: `src/experience/components/LifeBranch.tsx`
- Modify: `src/experience/components/LifeGitDiff.tsx`
- Modify: `src/experience/components/CityFrontierJourney.tsx`
- Modify: `src/experience/run-url.ts`
- Modify: `src/app/actions.ts`
- Modify: `src/app/page.tsx`
- Modify: `src/app/globals.css`
- Create: `tests/integration/full-life-experience.test.tsx`
- Modify: `tests/integration/city-frontier-experience.test.tsx`

Export exactly these server actions: `loadFullLifeSetupAction`, `loadFullLifeAlternativeSetupAction`, `loadFullLifeDecisionInputsAction`, `researchFullLifeFactsAction`, `loadFullLifeRouteInputStepAction`, `prepareFullLifeBranchAction`, `commitFullLifeBranchAction` and `presentFullLifeAction`.

**Exact entry/reload contract:**

```ts
// src/experience/run-url.ts
export function fullLifeSetupUrl(selectionId: string): string;
// exactly ?flow=full-life&selection=<encoded selection ID>

export function fullLifeCityAlternativeUrl(baselineCommitId: string): string;
// exactly ?flow=city&fullLifeBaseline=<encoded baseline ID>

export function fullLifeAlternativeSetupUrl(input: {
  readonly baselineCommitId: string;
  readonly selectionId: string;
}): string;
// exactly ?flow=full-life&baseline=<encoded baseline ID>&selection=<encoded selection ID>

export function replaceFullLifeCommitUrl(commitId: string): void;
// exactly ?flow=full-life&commit=<encoded commit ID>

// src/app/actions.ts
export async function loadFullLifeSetupAction(input: {
  readonly selectionId: string;
}): Promise<FullLifeSetupReadModel>;

export async function loadFullLifeRouteInputStepAction(input: {
  readonly selectionId: string;
  readonly routeBasisHash: string;
}): Promise<FullLifeRouteInputStep>;

export async function loadFullLifeDecisionInputsAction(input: {
  readonly selectionId: string;
}): Promise<FullLifeDecisionInputProjection>;

export async function loadFullLifeAlternativeSetupAction(input: {
  readonly baselineCommitId: string;
  readonly selectionId: string;
}): Promise<FullLifeAlternativeSetupReadModel>;

export async function researchFullLifeFactsAction(input: {
  readonly selectionId: string;
}): Promise<FullLifeVerifiedFacts>;

export async function presentFullLifeAction(input: {
  readonly commitId: string;
}): Promise<FullLifePresentationReadModel>;
```

After a verified City Selection succeeds, `CityFrontierJourney` renders one `Собрать мою жизнь` link built only from `selection.selection.id` through `fullLifeSetupUrl`. It never serializes route, profile, warning or branch facts into the URL. For `?flow=full-life&selection=...`, `page.tsx` requires exactly one non-empty selection and no baseline/commit, calls `loadFullLifeSetup`, then renders the selector from its verified route choices. Selecting a choice sends only `{ selectionId, routeBasisHash }`; Application reloads the selection and re-derives the exact basis before returning requirements. Prepare later receives only that hash plus raw route answers. Unknown/mismatched hashes fail without showing domain data.

The baseline commit view exposes one city-alternative link from `fullLifeCityAlternativeUrl(baseline.id)`. For `?flow=city&fullLifeBaseline=...`, the server loads the verified baseline and its selection, derives the stored terminal run and common `preCityBranchCommitId`, then renders the existing City Frontier; it never accepts a client run/root. Existing `selectCity` creates the normal sibling selection. In this context only, successful selection navigates through `fullLifeAlternativeSetupUrl({ baselineCommitId, selectionId: selected.selection.id })`. That entry calls `loadFullLifeAlternativeSetupAction`, proves the new selection shares the baseline pre-city parent and locked route, and opens alternative mode. Thus a journey that initially had one selection can create one city alternative without a new store, graph or duplicated City selector. Work/housing alternatives remain local choices from the baseline commit view.

After `commitFullLifeBranchAction` returns a verified commit, the client installs `?flow=full-life&commit=...` before adopting stored state. A reload with exactly one commit ID calls `presentFullLife`; it never calls setup, fact research or the model. Missing, conflicting `selection+commit`, array-valued or unknown IDs render the closed unavailable state. No second Full Life route or client-side router is introduced.

`researchFullLifeFactsAction` accepts only `selectionId` and delegates to the composed application's server-derived date/deadline/ID wrapper; request cancellation supplies the internal signal. The browser cannot submit `runId`, `snapshotId`, `assessmentDate` or `deadlineAt`.

The baseline screen order is: verified City summary → route selector → route-specific missing-input step → work → housing → monthly/one-time expenses → savings → one adjacent preview. It does not render the work block until route inputs are confirmed. At that boundary it calls `loadFullLifeDecisionInputsAction` with only `selectionId`; current-work income, savings, installed profession/housing labels, verified city marker/rent and sibling choices render only from the returned server projection. Profession salary signals and FX render only from the `FullLifeVerifiedFacts` returned by `researchFullLifeFactsAction` and join by the closed IDs. React sends user choices/amounts back as untrusted draft fields and never manufactures or mutates profile values, official salary/rent, labels, marker facts or sibling identity. Accepted-yellow exact unknown route and fallback have distinct copy. Draft and optional film edits remain React state through errors. The only durable action is the explicit commit after successful generation/guard and optional edits.

Alternative mode displays route and route inputs locked, allows exactly one of city/work/housing, prepares with baseline control, and removes/disables the create-alternative action after one stored alternative. Narrow layout is one ordered column with classes/provenance still visible.

`presentFullLifeAction` delegates only to the composed application's `present`. `presentFullLife` loads verified saved commits, typed budgets/diff and canonical saved film bytes; its ports deliberately omit facts research and model generation. `full-life-view-model.ts` only formats the saved `FullLifePresentationReadModel` and performs no budget, Passport or diff calculation.

- [ ] RED exact City Selection wrapper CTA/setup URL, server-side setup and decision-input loads, verified route-choice hash, route-first ordering, explicit missing route inputs, route-change invalidation, no onboarding duplication, projected current work/savings/catalog labels/city rent/siblings, green/accepted-yellow variants, all category classes, retained draft on outage and optional edits.
- [ ] RED baseline-bound return to the existing terminal City Frontier, initial one-selection journey, normal sibling `selectCity`, exact alternative URL/root/locked-route validation and rejection of a foreign baseline/selection/run.
- [ ] RED facts action exposes only selection ID, rejects attempted client date/IDs and delegates through the one composed application.
- [ ] RED one atomic save, saved replay, original film visibility, all six Passport classes, exactly one alternative action, locked route and `causal | new_projection` copy.
- [ ] RED commit URL is installed before stored state, exact reload is source/model-free, and missing/conflicting/array query inputs expose no selection or commit data.
- [ ] GREEN reuse existing shell/Passport/Life Git components without new design system or UI formulas.
- [ ] Verify and commit:

```bash
pnpm exec vitest run \
  tests/integration/full-life-experience.test.tsx \
  tests/integration/full-life-prepare.test.ts \
  tests/integration/full-life-commit.test.ts \
  tests/integration/full-life-store.test.ts
pnpm typecheck
pnpm exec eslint \
  src/experience/full-life-view-model.ts \
  src/experience/components/FullLifeJourney.tsx \
  src/experience/components/FullLifeRouteInputs.tsx \
  src/experience/components/FullLifeWorkspace.tsx \
  src/experience/components/CityFrontierJourney.tsx src/experience/run-url.ts \
  src/app/actions.ts src/app/page.tsx \
  tests/integration/full-life-experience.test.tsx \
  tests/integration/city-frontier-experience.test.tsx
pnpm build
git add src/experience/full-life-view-model.ts \
  src/experience/components/FullLifeJourney.tsx \
  src/experience/components/FullLifeRouteInputs.tsx \
  src/experience/components/FullLifeWorkspace.tsx \
  src/experience/components/EvidencePassport.tsx \
  src/experience/components/LifeBranch.tsx \
  src/experience/components/LifeGitDiff.tsx \
  src/experience/components/CityFrontierJourney.tsx src/experience/run-url.ts \
  src/app/actions.ts src/app/page.tsx src/app/globals.css \
  tests/integration/full-life-experience.test.tsx \
  tests/integration/city-frontier-experience.test.tsx
git commit -m "feat: deliver full life workspace"
```

---

### Task 10: Prove offline replay, controlled alternative and demo timing

**Files:**
- Create: `tests/integration/full-life-replay.test.ts`
- Create: `tests/integration/full-life-demo.test.tsx`
- Modify: `evals/full-life.ts`
- Modify: `evals/fixtures/full-life/cases.json`

- [ ] Add black-box baseline cases for current work, supported profession signal, dated RUB/EUR FX, unknown rent plus optional assumption, incomplete expenses, savings interval, route-specific unknowns and saved canonical film bytes/hash.
- [ ] Parameterize city/work/housing alternatives but create only one per isolated database. Assert identical route/profile/country/rules, exactly one decision delta, stored baseline control bytes and correct causal fallback.
- [ ] Tamper every persisted boundary; replay fails closed. A successful replay makes zero official HTTP, zero model calls and returns saved bytes without reserialization drift.
- [ ] Run the exact automated completion gate:

```bash
pnpm exec vitest run \
  tests/integration/full-life-replay.test.ts \
  tests/integration/full-life-demo.test.tsx
pnpm exec tsx evals/full-life.ts --mode=golden
pnpm exec tsx evals/full-life.ts --mode=replay-offline
pnpm test
pnpm typecheck
pnpm lint
pnpm build
git diff --check
rg -n "openai|anthropic|providerRegistry|providerSwitch|apiKey" \
  src/infrastructure/local-model src/application/full-life.ts
```

- [ ] After explicit user permission for browser use, time one clean 3–5 minute run with the preloaded model: onboarding → Country/Yellow Resolution → City Selection → route → route inputs → baseline → one alternative → Passport/diff. Browser permission is not implied by this plan.
- [ ] Inject one model outage: ordinary save fails, draft remains, no commit/fallback/retry UI appears; after recovery the same ordinary save succeeds.
- [ ] Atomic commit:

```bash
git add tests/integration/full-life-replay.test.ts \
  tests/integration/full-life-demo.test.tsx \
  evals/full-life.ts evals/fixtures/full-life/cases.json
git commit -m "feat: prove full life journey"
```

## Completion Gate

VS-4 is complete only when the real Full Life film gate has passed after Task 4 and before Task 5; a verified City Selection CTA opens the exact setup URL and exposes only server-derived route choices; applicable route inputs collect their dependent values while `not_applicable` clears them; the approved profession/FX snapshot preserves exact claim/Evidence lineage and produces one route-bound baseline; accepted yellow preserves the exact unknown outcome or honest fallback; budget/unknown/basis rules are deterministic and visible; the single shared local adapter produces guarded canonical film bytes; Application verifies the prepared envelope and atomically commits the aggregate; the database enforces at most one alternative; and exact commit-URL replay/diff perform no official HTTP or model regeneration.

## One Rejected Alternative

A new `full_life_commits` table would avoid resetting the demo DB, but would create a second branch graph, duplicate HMAC/replay/idempotency logic and weaken Life Git ownership. Because the repository explicitly uses reset-required schema preflights and the competition database is disposable, evolve `branch_commits` once and require the narrow `pnpm run reset:demo`.

## Non-Goals / Do Not Build

- No external model/API, provider registry/switch, generic model client, telemetry, API billing or monetization.
- No generic facts framework beyond the existing Evidence plan; no duplicated CBR or artifact store.
- No automatic route selection, free profession, job/vacancy/housing listings, tax/legal advice or probabilities.
- No retry loop, fallback film, recorded runtime response, background worker, queue, event store or mutable head.
- No migration runner, ORM, second commit table, general decision graph or arbitrary number of alternatives.
- No duplicate onboarding/profile questions, UI budget formulas or film regeneration during replay/presentation.
