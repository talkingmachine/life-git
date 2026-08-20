# VS-4 Full Life Through Codex CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver one route-bound, budgeted, guarded and replayable Full Life baseline from a verified City Selection, then allow exactly one city, work or housing alternative without inventing facts or adding a decision graph.

**Architecture:** Branch owns the closed draft, budget, film, Passport, commit and deterministic diff contracts. Application re-derives all authoritative route/profile/city/fact inputs, performs one zero-write prepare with at most one Codex process, and commits one signed aggregate atomically. Infrastructure reuses the existing Evidence and Life Git stores and the startup-owned Codex CLI adapter returned by `getCodexCliModelAdapter()`, wraps that exact singleton with separate onboarding and Full Life capability ports, and composes one Full Life application; React owns only the unsaved draft and optional film edits.

**Tech Stack:** Node.js 24.13.0 process/file primitives, pnpm 11.19.0, TypeScript 6.0.3, Next.js 16.3.0, React 19.2.8, SQLite/better-sqlite3 13.0.3, Vitest 4.1.10, Zod 4.4.3 and Decimal.js 10.6.0. Competition model assistance uses installed authenticated `codex-cli 0.148.0-alpha.15`; no model SDK or bundled weights are added.

**Specs:**

- `docs/superpowers/specs/2026-08-20-vs-4-full-life-design.md` (`approved`)
- `docs/superpowers/specs/2026-08-20-codex-cli-runtime-design.md` (`approved`, supersedes Qwen/local-model clauses)
- `docs/superpowers/plans/2026-08-21-codex-cli-runtime.md` (shared runtime successor; execute first)
- `docs/superpowers/specs/2026-08-20-slovenia-profession-income-source.md` (`required`, currently absent and therefore BLOCKED)

## Global Constraints

- Only onboarding extraction/review and Full Life film may invoke Codex. Official research, route derivation, ranking, applicability, budget and diff remain deterministic local code.
- One user film action starts at most one `codex exec` process. No automatic second invocation, retry loop, retry state/button, background run, fallback provider or recorded response exists.
- The application never calls an LLM API directly, requests/stores an API key, passes `--model`, resumes a Codex session, or adds Qwen/GGUF/`node-llama-cpp`.
- Codex receives a minimal closed projection through stdin in a fresh app-owned `0700` temporary directory. It receives no repository, user rules, tools, plugins, apps, MCP servers, workspace dependencies or inherited secrets.
- Every Codex result is untrusted. Closed JSON/schema/lineage guards run locally before preview or persistence; invalid output leaves only the caller-owned draft.
- Historical replay reads the exact saved guarded film and performs zero Codex and zero official-source calls.
- Use `citySelectionSnapshotId` consistently in every Full Life DTO, database mirror and port. Never introduce the ambiguous alias `selectionSnapshotId` inside Full Life.
- The journey root is the existing `CitySelectionSnapshot.preCityBranchCommitId`; it must equal the selected `CityBranchCommit.parentId` and `forkedFrom`. Do not invent another journey/root ID.
- One journey has at most one Full Life baseline and that baseline has at most one alternative. The alternative changes exactly one user decision: city, work or housing.
- Installed housing is exactly `room | studio | one_bedroom`, labelled «Комната», «Студия», «Квартира с одной спальней». No free-text or model-created housing type exists.
- Missing rent, profession income, expense, route value or FX remains `unknown`; it never becomes zero or a midpoint. A user replacement is an explicit visible assumption that preserves the original reference.
- Confirmed ISO-4217 currency is preserved byte-for-byte. Full Life calculation supports EUR directly and RUB only through the dated sealed CBR EUR/RUB fact; other valid currencies remain visible and make dependent conversion output unknown.
- The database has no migration runner. Evolve the existing tables behind the established exact schema preflight and a user-confirmed disposable demo reset; never reset automatically.
- Preserve all historical `housing-branch@1`, profile `@1`, Evidence `@1` and replay bytes.
- Do not use a browser until the user explicitly permits it. Browser permission is required for the profession-income source-spec work and for the final visual walkthrough, not for the fixture/unit implementation tasks.

## Execution Order

1. Execute the shared-runtime plan and the upstream onboarding, Country Assessment V2 and City Selection plans; Task 1 verifies the one resulting runtime instead of building another.
2. Task 3 is spec-only and may run in parallel with Task 1 and all upstream product work as soon as the user explicitly permits the bounded official-source browser review.
3. Task 2 passes only after all upstream product work is complete. Task 4 waits for both that gate and the approved Task 3 source spec; neither gate may be replaced with a compatibility stub.
4. Execute Tasks 5–12 sequentially in numerical order after Task 4. Together Tasks 4–10 produce the first complete saved baseline and green baseline replay.
5. Task 11 adds the single alternative only after that baseline replay is green.
6. Task 12 runs last as the full offline, privacy and demo gate.

---
### Task 1: Execute and verify the one shared tool-free Codex CLI runtime

**Prerequisite plan:** `docs/superpowers/plans/2026-08-21-codex-cli-runtime.md`

**Files:**

- Verify: `src/infrastructure/codex-cli/contracts.ts`
- Verify: `src/infrastructure/codex-cli/owned-json.ts`
- Verify: `src/infrastructure/codex-cli/event-stream.ts`
- Verify: `src/infrastructure/codex-cli/preflight.ts`
- Verify: `src/infrastructure/codex-cli/temp-directory.ts`
- Verify: `src/infrastructure/codex-cli/process.ts`
- Verify: `src/infrastructure/codex-cli/feasibility-probe.ts`
- Verify: `src/infrastructure/codex-cli/model-adapter.ts`
- Verify: `src/infrastructure/codex-cli/runtime.ts`
- Verify: `src/instrumentation.ts`
- Verify: `tests/integration/codex-cli-runtime.test.ts`

**Interfaces:**

- Consumes: the complete shared runtime plan, including its reviewed real capability-isolation and network/privacy artifacts.
- Produces: the exact shared `CodexCliModelAdapter.invokeJson(CodexJsonInvocation)` boundary used later by the Full Life capability wrapper.

Full Life does not create a second launcher, preflight, disabled-feature tuple, event parser, temporary-directory manager or runtime singleton. Composition calls `getCodexCliModelAdapter()` and passes that exact startup-owned `CodexCliModelAdapter` to the Full Life capability wrapper, which owns only the Full Life prompt, schema and deterministic output guard.

- [ ] **Step 1: Execute every task in the shared runtime plan.** Stop if its real prepared-Mac capability inspection cannot prove an empty tool registry or if its network/privacy audit fails. Do not weaken isolation or add a fallback.

- [ ] **Step 2: Run the exact shared-runtime gate.**

```bash
pnpm exec vitest run \
  tests/infrastructure/codex-cli-contract.test.ts \
  tests/infrastructure/codex-cli-event-stream.test.ts \
  tests/infrastructure/codex-cli-preflight.test.ts \
  tests/infrastructure/codex-cli-temp-directory.test.ts \
  tests/infrastructure/codex-cli-process.test.ts \
  tests/integration/codex-cli-feasibility-contract.test.ts \
  tests/integration/codex-cli-runtime.test.ts \
  tests/integration/codex-cli-audit.test.ts \
  tests/integration/codex-cli-network-privacy-contract.test.ts
pnpm run typecheck
git diff --check
```

Expected: PASS, with the reviewed feasibility and privacy artifacts present. This verification task creates no Full Life commit and no duplicate source file.

---

### Task 2: Pass the upstream onboarding, Country Assessment V2 and City Selection gate

**Files:**

- Verify: `src/application/onboarding.ts`
- Verify: `src/infrastructure/sqlite/onboarding-store.ts`
- Verify: `src/decision/cold-start-assessment-v2.ts`
- Verify: `src/application/city-selection.ts`
- Verify: `src/application/city-frontier-contracts.ts`
- Verify: `src/branch/city.ts`
- Verify: `src/infrastructure/sqlite/city-selection-writer.ts`
- Verify: `tests/integration/onboarding.test.ts`
- Verify: `tests/domain/cold-start-assessment-v2.test.ts`
- Verify: `tests/integration/city-selection.test.ts`

**Interfaces:**

- Consumes: Task 1 through `docs/superpowers/plans/2026-08-21-local-conversational-onboarding.md`; `docs/superpowers/plans/2026-08-20-country-assessment-v2.md`; and City Selection from `docs/superpowers/plans/2026-08-13-vs-4a-city-frontier.md` plus its split foundations/knowledge/core/delivery plans.
- Produces these exact Full Life prerequisites:

```ts
export interface FullLifeUpstreamProfilePort {
  loadRelocationV2Verified(id: string): Promise<RelocationProfileV2Snapshot>;
  loadPreferenceV2Verified(id: string): Promise<PreferenceProfileV2Snapshot>;
}

export interface CitySelectionReadPort {
  loadSelectionWithBranchVerified(
    citySelectionSnapshotId: string,
  ): Promise<CitySelectionWithBranch>;
  listSelectionsWithBranchesVerified(
    runId: string,
  ): Promise<readonly CitySelectionWithBranch[]>;
}
```

Both read methods are owned by City Frontier Core Task 15 and implemented by `city-selection-writer.ts`; Full Life only consumes this upstream port and never supplies a second loader. This gate requires `tests/integration/city-selection.test.ts` to pass the by-ID success, missing, mismatch, tamper and fresh-frozen-copy cases before Task 4 begins.

`CitySelectionWithBranch` is the exact wrapper `{ selection: CitySelectionSnapshot; commit: CityBranchCommit }`. Full Life always reads `wrapper.selection.id`, never `wrapper.id`. The loader reconstructs and verifies the row pair in one read transaction. The root invariant is:

```ts
selection.preCityBranchCommitId === commit.parentId &&
selection.preCityBranchCommitId === commit.forkedFrom &&
selection.id === commit.citySelectionSnapshotId;
```

- [ ] **Step 1: Check the required production files without creating Full Life compatibility stubs**

```bash
test -f src/application/onboarding.ts
test -f src/decision/cold-start-assessment-v2.ts
test -f src/application/city-selection.ts
test -f src/branch/city.ts
rg -n "loadRelocationV2Verified|loadPreferenceV2Verified" src tests
rg -n "loadSelectionWithBranchVerified|listSelectionsWithBranchesVerified" src tests
```

Expected before upstream execution: at least one command fails. Execute the approved upstream plans; do not add a Full Life-owned store, schema switch or temporary loader.

- [ ] **Step 2: Run the focused upstream gate after those plans finish**

```bash
pnpm exec vitest run \
  tests/integration/onboarding.test.ts \
  tests/research/cold-start-v2-contracts.test.ts \
  tests/sources/slovenia-v2.test.ts \
  tests/domain/cold-start-assessment-v2.test.ts \
  tests/integration/cold-start.test.ts \
  tests/integration/country-knowledge.test.ts \
  tests/integration/place-frontier.test.ts \
  tests/integration/country-resolution.test.ts \
  tests/integration/city-selection.test.ts \
  tests/integration/city-frontier-experience.test.tsx
pnpm typecheck
git diff --check
```

Expected: PASS. If it does not pass, stop before Task 4 and every Full Life production task. The independent, spec-only Task 3 review may still proceed. This gate creates no commit in the Full Life plan.

---

### Task 3: BLOCKED — approve the exact Slovenia profession-income source spec

**Files:**

- Required external input: `docs/superpowers/specs/2026-08-20-slovenia-profession-income-source.md`
- No production or fixture file may be created or modified by this task; Task 3 ends with the approved source spec.

**Interfaces:**

- Consumes: explicit fresh browser permission and user review.
- Produces an approved spec containing the exact supported profession IDs, Russian labels, SiStat classification codes, geographic scope, reference period, unit, gross/net basis, metadata/data coordinates, navigation/data URLs, parser/freshness versions and retention policy.

- [ ] **Step 1: Check whether the source decision already exists**

```bash
test -f docs/superpowers/specs/2026-08-20-slovenia-profession-income-source.md
rg -n "Статус.*approved|Approval.*approved" \
  docs/superpowers/specs/2026-08-20-slovenia-profession-income-source.md
```

Expected in the current repository: FAIL because the spec is absent.

- [ ] **Step 2: Stop and request the required browser permission**

Do not infer profession IDs from onboarding occupations, the legal income threshold, a model answer or the historical superseded plan. Do not browse, download or retain source data until the user explicitly permits browser use for the source-spec work.

- [ ] **Step 3: After permission, exhaust the bounded official SiStat source review and obtain exact user approval**

The resulting source spec is the sole authority for profession tuple and parser fixtures. If no comparable official dataset can support a profession, omit that profession from the installed tuple; do not substitute a vacancy site, estimate or legal threshold.

- [ ] **Step 4: Re-run the approval gate**

```bash
test -f docs/superpowers/specs/2026-08-20-slovenia-profession-income-source.md
rg -n "Статус.*approved|Approval.*approved" \
  docs/superpowers/specs/2026-08-20-slovenia-profession-income-source.md
```

Expected: PASS. Only then may Task 4 begin. This gate makes no code commit.

---

### Task 4: Seal and verified-load exact profession and FX facts

**Files:**

- Create: `src/decision/full-life-catalog.ts`
- Create: `src/research/full-life-facts.ts`
- Create: `src/research/slovenia-full-life-plan.ts`
- Create: `src/research/parsers/slovenia-profession-income.ts`
- Create: `src/application/full-life-facts.ts`
- Create: `src/infrastructure/sources/slovenia-full-life-source-adapter.ts`
- Modify: `src/infrastructure/sqlite/evidence-store.ts`
- Create: `tests/research/full-life-facts.test.ts`
- Create: `tests/integration/full-life-facts.test.ts`
- Add approved fixtures under: `tests/sources/fixtures/slovenia/full-life-profession/`

**Interfaces:**

- Consumes: approved Task 3 spec; existing `prepareEvidencePlan`, `sealEvidencePlan`, `SqliteEvidenceStore`, CBR parser and official source gateway.
- Produces:

```ts
export const SUPPORTED_HOUSING_IDS = [
  "room",
  "studio",
  "one_bedroom",
] as const;

export const SUPPORTED_HOUSING_LABELS = Object.freeze({
  room: "Комната",
  studio: "Студия",
  one_bedroom: "Квартира с одной спальней",
});

export type FullLifeFactSourceId = "si-profession-income" | "cbr-eur";

export type FullLifeEvidenceRef =
  | {
      readonly kind: "full_life_claim";
      readonly evidenceSnapshotId: string;
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

export type ProfessionIncomeOutcome =
  | {
      readonly professionId: SupportedProfessionId;
      readonly status: "verified";
      readonly signal: ProfessionIncomeSignal;
      readonly evidenceRefs: readonly [FullLifeEvidenceRef, ...FullLifeEvidenceRef[]];
    }
  | {
      readonly professionId: SupportedProfessionId;
      readonly status: "unknown";
      readonly reason: "not_found" | "stale" | "conflict" | "not_comparable";
    };

export interface FullLifeVerifiedFacts {
  readonly snapshotId: string;
  readonly citySelectionSnapshotId: string;
  readonly cityId: string;
  readonly assessmentDate: string;
  readonly professionIncome: readonly ProfessionIncomeOutcome[];
  readonly fx:
    | {
        readonly status: "verified";
        readonly value: CbrEurFacts;
        readonly evidenceRefs: readonly [FullLifeEvidenceRef, ...FullLifeEvidenceRef[]];
      }
    | { readonly status: "unknown"; readonly reason: string };
}

export interface FullLifeVerifiedFactsReadPort {
  loadVerified(
    snapshotId: string,
    expected: {
      readonly citySelectionSnapshotId: string;
      readonly cityId: string;
    },
  ): Promise<FullLifeVerifiedFacts>;
}
```

Task 4 copies `SUPPORTED_PROFESSION_IDS` and its derived `SupportedProfessionId` type into this file from the exact ordered literal tuple in the approved Task 3 source spec. Task 3 remains spec-only. This plan intentionally contains no provisional profession ID, classification or source coordinate. The tuple is not a runtime parser or open registry. `professionIncome` has exactly one outcome per installed ID in that order. Zero applicable source rows yields `unknown`; more than one comparable row yields `conflict`; source array order never chooses a winner.

Research uses `full-life-facts:${hash(canonical({ citySelectionSnapshotId, cityId, assessmentDate, contextHash, rulesVersion }))}:evidence` as the stable server-derived snapshot ID and `full-life-facts-attempt:${nextId()}` as a separate random server-owned attempt run ID. Before any source call it calls `findVerified(stableSnapshotId)`. If present and exact, it returns it. If absent, it captures under the new attempt ID, seals to the stable snapshot ID and verified-reloads. In `finally`, it deletes only unsealed artifacts owned by that exact attempt run ID; sealed artifacts are immutable and untouched. A partial abort therefore cannot collide with the next ordinary action. Later baseline/alternative loaders address this immutable result by `snapshotId`, verify the expected selection and city, and consume the signed returned `assessmentDate`; they do not require or trust a browser-supplied date.

- [ ] **Step 1: Write RED contract/parser tests**

Cover the exact source coordinate, installed order, profession/classification binding, city versus national scope, period, unit, gross/net basis, stale/not-found/conflict/not-comparable outcomes, unsupported profession rejection, CBR base/quote/date and rejection of the existing legal income-threshold claim as a profession signal.

- [ ] **Step 2: Write RED persistence/application tests**

Cover structured navigation/resolved URLs through offline reload, stable snapshot read-before-capture, no browser-selected IDs/date/deadline, concurrent exact publication, failure before sealing, abort after the first artifact, exact unsealed-attempt cleanup and a successful new attempt after abort.

Representative source-bound assertion:

```ts
expect(result.professionIncome.map(({ professionId }) => professionId)).toEqual(
  SUPPORTED_PROFESSION_IDS,
);
expect(sourceCalls).toHaveLength(0);
expect(result.snapshotId).toBe(existing.snapshotId);
```

- [ ] **Step 3: Run RED**

```bash
pnpm exec vitest run \
  tests/research/full-life-facts.test.ts \
  tests/integration/full-life-facts.test.ts \
  tests/sources/parsers.test.ts
```

Expected: FAIL because Full Life fact modules do not exist.

- [ ] **Step 4: Implement the two-source plan and narrow verified projection**

Use exactly the parser/source IDs, coordinates, rules and retention approved in Task 3. Reuse the Evidence store and source gateway; do not add a second artifact store, generic facts framework, crawler or Codex call.

- [ ] **Step 5: Run GREEN and checks**

```bash
pnpm exec vitest run \
  tests/research/full-life-facts.test.ts \
  tests/integration/full-life-facts.test.ts \
  tests/sources/parsers.test.ts \
  tests/integration/evidence-store.test.ts
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
git diff --check
```

- [ ] **Step 6: Commit**

```bash
git add src/decision/full-life-catalog.ts \
  src/research/full-life-facts.ts src/research/slovenia-full-life-plan.ts \
  src/research/parsers/slovenia-profession-income.ts \
  src/application/full-life-facts.ts \
  src/infrastructure/sources/slovenia-full-life-source-adapter.ts \
  src/infrastructure/sqlite/evidence-store.ts \
  tests/research/full-life-facts.test.ts \
  tests/integration/full-life-facts.test.ts \
  tests/sources/fixtures/slovenia/full-life-profession
git commit -m "feat: verify full life facts"
```

---

### Task 5: Close route choices, route inputs, decisions and draft reconstruction

**Files:**

- Create: `src/branch/full-life.ts`
- Create: `src/application/full-life-route-inputs.ts`
- Create: `src/infrastructure/sources/slovenia-full-life-plan.ts`
- Create: `tests/domain/full-life.test.ts`
- Create: `tests/integration/full-life-route-inputs.test.ts`

**Interfaces:**

- Consumes: Task 2 verified City Selection/profile/country-resolution readers, Task 4 installed tuples and `FullLifeEvidenceRef`, existing `ResidenceRouteOutcome` and accepted-yellow decision.
- Produces the exact route/draft boundary:

```ts
export type FullLifeRouteBasis =
  | {
      readonly kind: "verified_route";
      readonly trustClass: "verified";
      readonly countryCode: "SI";
      readonly resolvedCountryShortlistRevisionId: string;
      readonly formalMarkerDigest: string;
      readonly routeOutcome: Omit<
        Extract<ResidenceRouteOutcome, { readonly status: "viable" | "impossible" }>,
        "status"
      > & { readonly status: "viable" };
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

export interface FullLifeRouteInputStep {
  readonly schemaVersion: "full-life-route-input-step@1";
  readonly citySelectionSnapshotId: string;
  readonly routeBasisHash: string;
  readonly requirements: readonly RouteSpecificRequirement[];
}

export interface FullLifeRouteInputs {
  readonly schemaVersion: "full-life-route-inputs@1";
  readonly citySelectionSnapshotId: string;
  readonly routeBasisHash: string;
  readonly documents: readonly RouteDocumentInput[];
  readonly insurance: readonly RouteInsuranceInput[];
  readonly mandatoryPayments: readonly RoutePaymentInput[];
  readonly timeline: readonly RouteTimelineInput[];
}

export type FullLifeBudgetIncomeChoice =
  | { readonly kind: "as_reference" }
  | {
      readonly kind: "user_assumption";
      readonly value: MoneyIntervalWithBasis;
      readonly reason: string;
    };

export interface MoneyInterval {
  readonly low: string;
  readonly high: string;
  readonly currency: string;
  readonly period: "month" | "one_time";
}

export interface MoneyIntervalWithBasis extends MoneyInterval {
  readonly taxBasis: "gross" | "net" | "unknown";
  readonly subjectBasis: "person" | "household" | "unknown";
}

export type FullLifeInputValue<T> =
  | { readonly status: "known"; readonly value: T; readonly evidenceRefs: readonly FullLifeEvidenceRef[] }
  | { readonly status: "assumption"; readonly value: T; readonly reason: string; readonly original: FullLifeInputValue<T> }
  | { readonly status: "unknown"; readonly reason: string; readonly evidenceRefs: readonly FullLifeEvidenceRef[] };

export type FullLifeWorkDecision =
  | {
      readonly mode: "keep_current_work";
      readonly participantId: string;
      readonly incomeReference: FullLifeInputValue<MoneyIntervalWithBasis>;
      readonly budgetIncomeChoice: FullLifeBudgetIncomeChoice;
    }
  | {
      readonly mode: "installed_profession";
      readonly professionId: SupportedProfessionId;
      readonly incomeReference: FullLifeInputValue<MoneyIntervalWithBasis>;
      readonly budgetIncomeChoice: FullLifeBudgetIncomeChoice;
    };

export interface FullLifeHousingDecision {
  readonly kind: "installed_housing";
  readonly housingId: "room" | "studio" | "one_bedroom";
  readonly officialCityRentReference: FullLifeInputValue<MoneyInterval>;
  readonly selectedMonthlyRent: FullLifeInputValue<MoneyInterval>;
}

export function deriveFullLifeDecisionIntent(
  draft: FullLifeDraft,
): FullLifeDecisionIntent;

export function deriveFullLifeSharedUserInputs(
  draft: FullLifeDraft,
): FullLifeSharedUserInputs;
```

The installed plan maps only verified `proceduralActions` and proved route claims to requirements. An accepted-yellow unresolved route produces four explicit category-level unknowns and no invented document, amount or date. For housing, the one city-wide `long_term_rent` reference is displayed unchanged beside each installed type; it is never multiplied or relabelled as a type-specific rent.

`incomeReference` retains the exact profile or official signal. `budgetIncomeChoice:user_assumption` is the only path that may replace gross/net or person/household basis; it requires a complete entered interval and reason. No conversion coefficient is inferred.

- [ ] **Step 1: Write RED pure route/draft tests**

Cover formal green choices, all accepted-yellow unknown outcomes, fallback only when no unknown outcome exists, exact route hash, dense route answers, `not_applicable` clearing amount/month, wrong selection/hash/requirement order, immutable housing tuple and explicit income basis assumption.

- [ ] **Step 2: Write RED authoritative read tests**

Cover exact wrapper/revision/marker/yellow-decision binding, profile current work and savings, structured city rent reference, installed profession outcomes, zero/duplicate/wrong-city signal, city label tamper, sibling root mismatch and descriptor-safe copies.

Representative trust-boundary test:

```ts
await expect(loadFullLifeRouteInputStep(
  { citySelectionSnapshotId: selection.selection.id, routeBasisHash: "client-hash" },
  ports,
)).rejects.toThrow("integrity_mismatch");
expect(ports.installedPlan.requirementsFor).not.toHaveBeenCalled();
```

- [ ] **Step 3: Run RED**

```bash
pnpm exec vitest run \
  tests/domain/full-life.test.ts \
  tests/integration/full-life-route-inputs.test.ts
```

- [ ] **Step 4: Implement only the closed pure guards and read use cases**

`loadFullLifeSetup` and `loadFullLifeRouteInputStep` always reload the selection and country context. `reconstructFullLifeRouteInputs` accepts unknown browser data, requires exact step membership/order and returns a new frozen object. No source/model/store write exists in this task.

- [ ] **Step 5: Run GREEN and checks**

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
git diff --check
```

- [ ] **Step 6: Commit**

```bash
git add src/branch/full-life.ts \
  src/application/full-life-route-inputs.ts \
  src/infrastructure/sources/slovenia-full-life-plan.ts \
  tests/domain/full-life.test.ts \
  tests/integration/full-life-route-inputs.test.ts
git commit -m "feat: define full life draft"
```

---

### Task 6: Calculate typed budget, unknown subsets and runway

**Files:**

- Create: `src/branch/full-life-budget.ts`
- Modify: `src/branch/budget.ts`
- Create: `tests/domain/full-life-budget.test.ts`

**Interfaces:**

- Consumes: Task 5 `MoneyInterval`, `MoneyIntervalWithBasis`, expense IDs, decisions and `FullLifeInputValue`; existing CBR fact and Decimal helpers.
- Produces:

```ts
export interface EurInterval {
  readonly min: string;
  readonly max: string;
  readonly currency: "EUR";
}

export type FullLifeCalculatedInterval =
  | {
      readonly kind: "known";
      readonly value: EurInterval;
      readonly inputRefs: readonly [string, ...string[]];
    }
  | {
      readonly kind: "unknown";
      readonly inputRefs: readonly [string, ...string[]];
    };

export interface FullLifeKnownSubset {
  readonly kind: "known_subset";
  readonly value: EurInterval;
  readonly includedInputRefs: readonly string[];
  readonly excludedInputRefs: readonly string[];
}

export type FullLifeRunway =
  | { readonly kind: "finite"; readonly minMonths: string; readonly maxMonths: string }
  | { readonly kind: "no_known_deficit" }
  | { readonly kind: "lower_bound_only"; readonly minMonths: string }
  | { readonly kind: "unknown"; readonly inputRefs: readonly [string, ...string[]] };

export interface FullLifeBudget {
  readonly schemaVersion: "full-life-budget@1";
  readonly rulesVersion: "full-life-budget-rules@1";
  readonly monthlyIncome: FullLifeCalculatedInterval;
  readonly knownMonthlyExpenses: FullLifeKnownSubset;
  readonly knownMonthlyResidual: FullLifeCalculatedInterval;
  readonly excludedMonthlyExpenses: readonly ExcludedExpense[];
  readonly knownOneTimeExpenses: FullLifeKnownSubset;
  readonly savingsAfterKnownOneTime: FullLifeCalculatedInterval;
  readonly excludedOneTimeExpenses: readonly ExcludedExpense[];
  readonly runway: FullLifeRunway;
  readonly formulaHash: string;
  readonly inputHash: string;
  readonly outputHash: string;
}

export function calculateFullLifeBudget(input: FullLifeBudgetInput): FullLifeBudget;
export function reconstructFullLifeBudget(input: {
  readonly input: unknown;
  readonly output: unknown;
}): FullLifeBudget;
```

Known subset zero is allowed only as the sum of an explicitly empty included set; every excluded unknown remains listed and is never represented as zero. An unknown dependent input makes the exact dependent interval/runway unknown even though the separate known subset remains visible.

- [ ] **Step 1: Write RED formula tests**

Cover direct EUR, dated RUB division, absent/stale/wrong-pair FX, USD/GBP preservation, explicit basis assumption, gross/net mismatch, person/household mismatch, unknown subset accounting, negative savings clamp and all three runway rows.

- [ ] **Step 2: Write RED reconstruction/hash tests**

Mutate every calculated field/ref/hash, add extra keys, reorder excluded refs and prove fail-closed reconstruction. Preserve all existing `budget.ts` bytes and tests.

- [ ] **Step 3: Run RED**

```bash
pnpm exec vitest run tests/domain/full-life-budget.test.ts tests/domain/budget.test.ts
```

- [ ] **Step 4: Implement Decimal calculation with no UI helper**

Use unrounded Decimal intermediates. Apply versioned display rounding only when producing strings. Extract a shared helper from `budget.ts` only if both formula domains use the exact same operation; do not merge the two budget contracts.

- [ ] **Step 5: Run GREEN and commit**

```bash
pnpm exec vitest run tests/domain/full-life-budget.test.ts tests/domain/budget.test.ts
pnpm typecheck
pnpm exec eslint src/branch/full-life-budget.ts src/branch/budget.ts \
  tests/domain/full-life-budget.test.ts
git diff --check
git add src/branch/full-life-budget.ts src/branch/budget.ts \
  tests/domain/full-life-budget.test.ts
git commit -m "feat: calculate full life budget"
```

---

### Task 7: Guard the closed film document and add the Full Life Codex capability

**Files:**

- Create: `src/branch/full-life-film.ts`
- Create: `src/infrastructure/codex-cli/full-life-film-prompt.ts`
- Create: `src/infrastructure/codex-cli/full-life-film-model.ts`
- Create: `tests/domain/full-life-film.test.ts`
- Create: `tests/integration/codex-cli-full-life.test.ts`
- Create: `evals/codex-cli-full-life.ts`
- Create: `evals/fixtures/full-life/cases.json`

**Interfaces:**

- Consumes: Task 1 `CodexCliModelAdapter`, Task 5 draft/inputs, Task 6 budget, existing canonical JSON/hash helpers.
- Produces:

```ts
export type FullLifeInputRef =
  | `route:${string}`
  | `fact:${string}`
  | `user:${string}`
  | `calculation:${string}`
  | `assumption:${string}`
  | `unknown:${string}`
  | `decision:${"city" | "work" | "housing"}`;

export interface FullLifeCodexLineage {
  readonly invocationContractVersion: "codex-cli-invocation@1";
  readonly cliVersion: "codex-cli 0.148.0-alpha.15";
  readonly promptVersion: "full-life-film-prompt@1";
  readonly outputSchemaVersion: "full-life-film@1";
  readonly parametersVersion: "codex-cli-default@1";
  readonly observedMetadata?: Readonly<Record<string, string>>;
}

export interface FullLifeFilmProposal {
  readonly document: unknown;
  readonly lineage: FullLifeCodexLineage;
}

export interface SavedFullLifeFilm {
  readonly schemaVersion: "saved-full-life-film@1";
  readonly document: FullLifeFilmDocument;
  readonly canonicalBytes: string;
  readonly outputHash: string;
  readonly inputHash: string;
  readonly lineage: FullLifeCodexLineage;
}

export interface FullLifeFilmGeneratorPort {
  generate(
    input: FullLifeProjectionInput,
    signal: AbortSignal,
  ): Promise<FullLifeFilmProposal>;
}

export function confirmFullLifeFilm(input: {
  readonly proposal: FullLifeFilmProposal;
  readonly projectionInput: FullLifeProjectionInput;
  readonly integrity: FullLifeFilmIntegrity;
}): SavedFullLifeFilm;
```

The document contains exactly four typical-day segments (`morning`, `work`, `evening`, `night`), exactly months `1..12`, and exactly five factors (`load`, `sleep`, `stress`, `social_context`, `career`). Each item has its stable ID, non-empty text and non-empty exact `inputRefs`. The prompt contains only the minimal projection and closed vocabulary; no raw official bytes, transcript, credentials or unrelated journey history.

There is no byte-equivalence requirement, baseline-control generation or narrative causal classifier. Every new film is a versioned projection. Only deterministic facts/calculations participate in causal diff later.

- [ ] **Step 1: Write RED pure guard tests**

Cover exact segment catalogs, canonical bytes/hash, missing/duplicate IDs, invalid refs, unknown filling, invented fact/link/calculation/probability, oversized text, edited day/timeline as assumption and factor-edit rejection.

- [ ] **Step 2: Write RED capability tests over a fake Task 1 adapter**

Assert one `invokeJson` per `generate`, exact prompt/schema/version limits, no `--model` decision, local parser/guard rejection, abort forwarding and no prompt/raw output logging.

Representative one-process assertion:

```ts
await film.generate(projection, new AbortController().signal);
expect(runtime.invokeJson).toHaveBeenCalledTimes(1);
expect(runtime.invokeJson.mock.calls[0]?.[0].prompt).not.toContain("rawArtifactBytes");
```

- [ ] **Step 3: Run RED**

```bash
pnpm exec vitest run \
  tests/domain/full-life-film.test.ts \
  tests/integration/codex-cli-full-life.test.ts
```

- [ ] **Step 4: Implement the prompt/schema wrapper and guard**

`full-life-film-model.ts` is a capability adapter, not a provider registry. It calls the one concrete Task 1 adapter, parses the strict result and returns a proposal; Branch owns final semantic confirmation and canonical saved bytes.

- [ ] **Step 5: Run GREEN and the real synthetic film gate**

```bash
pnpm exec vitest run \
  tests/domain/full-life-film.test.ts \
  tests/integration/codex-cli-runtime.test.ts \
  tests/integration/codex-cli-full-life.test.ts
pnpm exec tsx evals/codex-cli-full-life.ts --mode=synthetic
pnpm typecheck
pnpm exec eslint \
  src/branch/full-life-film.ts \
  src/infrastructure/codex-cli/full-life-film-prompt.ts \
  src/infrastructure/codex-cli/full-life-film-model.ts \
  tests/domain/full-life-film.test.ts \
  tests/integration/codex-cli-full-life.test.ts evals/codex-cli-full-life.ts
git diff --check
```

Expected real gate: one tool-free Codex process returns a guarded film within the demo budget. Failure stops before Task 8; do not add fallback/retry/provider code.

- [ ] **Step 6: Commit**

```bash
git add src/branch/full-life-film.ts \
  src/infrastructure/codex-cli/full-life-film-prompt.ts \
  src/infrastructure/codex-cli/full-life-film-model.ts \
  tests/domain/full-life-film.test.ts \
  tests/integration/codex-cli-full-life.test.ts \
  evals/codex-cli-full-life.ts evals/fixtures/full-life/cases.json
git commit -m "feat: generate guarded full life film"
```

---

### Task 8: Prepare one authoritative baseline with zero writes

**Files:**

- Create: `src/application/full-life-contracts.ts`
- Create: `src/application/full-life.ts`
- Create: `tests/integration/full-life-prepare.test.ts`

**Interfaces:**

- Consumes: Task 4 verified facts, Task 5 route/draft readers, Task 6 budget, Task 7 film generator and existing integrity view.
- Produces:

```ts
export interface PrepareFullLifeBaselineCommand {
  readonly kind: "baseline";
  readonly commandId: string;
  readonly citySelectionSnapshotId: string;
  readonly factsSnapshotId: string;
  readonly routeBasisHash: string;
  readonly routeInputAnswers: unknown;
  readonly draft: unknown;
}

export interface PreparedFullLifeBaselinePayload {
  readonly kind: "baseline";
  readonly commandId: string;
  readonly citySelectionSnapshotId: string;
  readonly cityBranchCommitId: string;
  readonly preCityBranchCommitId: string;
  readonly profileSnapshotId: string;
  readonly preferenceProfileSnapshotId: string;
  readonly resolvedCountryShortlistRevisionId: string;
  readonly factsSnapshotId: string;
  readonly factsAssessmentDate: string;
  readonly routeBasis: FullLifeRouteBasis;
  readonly routeInputs: FullLifeRouteInputs;
  readonly draft: FullLifeDraft;
  readonly budgetInput: FullLifeBudgetInput;
  readonly budget: FullLifeBudget;
  readonly projectionInput: FullLifeProjectionInput;
  readonly originalFilm: SavedFullLifeFilm;
}

export interface PreparedFullLifeEnvelope {
  readonly schemaVersion: "prepared-full-life-envelope@1";
  readonly payload: PreparedFullLifeBaselinePayload;
  readonly payloadHash: string;
  readonly signature: string;
}

export async function prepareFullLifeBaseline(
  command: PrepareFullLifeBaselineCommand,
  signal: AbortSignal,
  ports: FullLifePreparePorts,
): Promise<PreparedFullLifeEnvelope>;
```

`FullLifePreparePorts` contains read-only selection, route-context, profile, preference, decision-input, facts and baseline-existence readers plus film and integrity. It contains no append/save/publish port and no clock.

Prepare order is normative:

1. Reload `CitySelectionWithBranch` by `command.citySelectionSnapshotId`.
2. Verify selection/commit/root/profile/preference/country bindings.
3. Call `loadFullLifeSetup`, select exactly one server-derived choice by `routeBasisHash`, and canonical-compare its basis.
4. Call `loadFullLifeRouteInputStep` and reconstruct route answers; never accept client route objects.
5. Verified-load profile, preference, decision projection and facts; consume the facts' signed date rather than a browser date.
6. Reconstruct every official/user/assumption/unknown field and reject client labels/markers/source refs.
7. Derive rent and route-payment expense slots, calculate typed budget and build the closed projection.
8. Call `film.generate` exactly once and locally confirm the film.
9. Sign the exact payload after every async callback returns.
10. Return the envelope with zero writes on success and failure.

- [ ] **Step 1: Write RED trust-boundary tests**

Cover wrapper/root/profile/preference/country/facts tamper, foreign route hash, route-answer mismatch, forged official value/ref/label/rent/profession signal, changed caller object during await, invalid assumption and second existing baseline on the same pre-city root.

- [ ] **Step 2: Write RED process/write-count tests**

Assert zero store writes, one film call on success, zero film calls before validation, one film call on model/schema failure, abort forwarding and draft-owned state untouched.

- [ ] **Step 3: Run RED**

```bash
pnpm exec vitest run \
  tests/integration/full-life-prepare.test.ts \
  tests/domain/full-life.test.ts \
  tests/domain/full-life-budget.test.ts \
  tests/domain/full-life-film.test.ts
```

- [ ] **Step 4: Implement the narrow baseline use case**

Snapshot caller inputs synchronously before the first await. Build no cache, workflow engine or mutable draft store. Envelope integrity exposes only `canonical`, `hash`, `sign`, `verify` and uses the existing secure HMAC comparison.

- [ ] **Step 5: Run GREEN and commit**

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
git diff --check
git add src/application/full-life-contracts.ts src/application/full-life.ts \
  tests/integration/full-life-prepare.test.ts
git commit -m "feat: prepare full life baseline"
```

---

### Task 9: Atomically commit, Passport and replay the baseline

**Files:**

- Modify: `src/branch/life-git.ts`
- Create: `src/branch/full-life-passport.ts`
- Create: `src/application/present-full-life.ts`
- Modify: `src/infrastructure/integrity.ts`
- Modify: `src/infrastructure/sqlite/branch-store.ts`
- Modify: `src/infrastructure/sqlite/schema.sql`
- Modify: `src/infrastructure/sqlite/db.ts`
- Create: `scripts/reset-demo-cli.ts`
- Modify: `package.json`
- Modify: `.env.example`
- Modify: `.gitignore`
- Create: `tests/branch/full-life-git.test.ts`
- Create: `tests/domain/full-life-passport.test.ts`
- Create: `tests/integration/full-life-commit.test.ts`
- Create: `tests/integration/full-life-store.test.ts`
- Modify: `tests/integration/database-schema.test.ts`
- Modify: `tests/integration/reset-demo.test.ts`

**Interfaces:**

- Consumes: Task 8 signed envelope and verified read ports; existing `BranchCommit`/`SqliteBranchStore` byte behavior.
- Produces:

```ts
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
  readonly factsAssessmentDate: string;
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

export interface CommitFullLifeCommand {
  readonly prepared: PreparedFullLifeEnvelope;
  readonly filmEdits?: FullLifeFilmEdits;
}

export interface FullLifeCommitStore {
  loadFullLifeVerified(id: string): Promise<FullLifeBranchCommit>;
  findBaselineForPreCityVerified(
    preCityBranchCommitId: string,
  ): Promise<FullLifeBranchCommit | undefined>;
  findAlternativeVerified(
    baselineId: string,
  ): Promise<FullLifeBranchCommit | undefined>;
  publishExact(commit: FullLifeBranchCommit): Promise<FullLifeBranchCommit>;
}
```

Passport is a closed non-empty union of `official_fact | user_fact | calculation | assumption | projection | unknown`. Official items embed structured `FullLifeEvidenceRef`, so replay can show navigation URL, scope and period without source I/O.

`FullLifeCommitIntent` contains every create input except `createdAt` and integrity functions. The commit application reads the command ID only from the verified `prepared.payload.commandId` after envelope signature/hash validation; there is no second browser-owned or outer command ID. `inputHash` hashes its exact canonical bytes. `publishExact` starts `transaction.immediate`, looks up `command_id`, verified-reloads an existing row and canonical-compares timestamp-free intent. Identical replay returns the first commit and first timestamp; different intent conflicts. Only an absent command inserts the caller candidate.

Schema evolves the existing `branch_commits` table through reset-only creation. Full Life rows require `schema_version`, `command_id`, `preference_profile_id`, `city_selection_snapshot_id`, `city_branch_commit_id` and `pre_city_branch_commit_id`; legacy rows forbid them. Baseline uniqueness is:

```sql
CREATE UNIQUE INDEX branch_commits_one_full_life_baseline_per_pre_city
ON branch_commits(pre_city_branch_commit_id)
WHERE schema_version = 'full-life-branch@1' AND forked_from IS NULL;

CREATE UNIQUE INDEX branch_commits_one_full_life_alternative_per_baseline
ON branch_commits(forked_from)
WHERE schema_version = 'full-life-branch@1' AND forked_from IS NOT NULL;

CREATE UNIQUE INDEX branch_commits_one_full_life_command
ON branch_commits(command_id)
WHERE schema_version = 'full-life-branch@1';
```

- [ ] **Step 1: Write RED pure commit/Passport tests**

Cover stable input/output hashes, all six Passport classes, structured official links, original/edited film, baseline without parent fields, tamper matrix and unchanged historical housing replay.

- [ ] **Step 2: Write RED application/store tests**

Cover invalid envelope/signature, rejection of an extra outer `commandId`, immutable reference reload, zero publish on failure, one exact publish, same-command/same-intent timestamp replay, same-command/different-intent conflict, concurrent sibling-city baseline race, schema preflight, triggers and reset path guard.

Representative idempotency assertion:

```ts
expect(second.id).toBe(first.id);
expect(second.createdAt).toBe(first.createdAt);
expect(clock).toHaveBeenCalledTimes(2);
```

- [ ] **Step 3: Run RED**

```bash
pnpm exec vitest run \
  tests/branch/full-life-git.test.ts \
  tests/domain/full-life-passport.test.ts \
  tests/integration/full-life-commit.test.ts \
  tests/integration/full-life-store.test.ts \
  tests/integration/database-schema.test.ts \
  tests/branch/life-git.test.ts
```

- [ ] **Step 4: Implement pure commit first, then store, then Application commit/present**

Commit re-verifies the signed envelope and every immutable reference, applies typed edits, rebuilds Passport and performs no source or Codex call. `presentFullLife` uses only verified Full Life commit reads and saved bytes.

- [ ] **Step 5: Run GREEN and checks**

```bash
pnpm exec vitest run \
  tests/branch/full-life-git.test.ts \
  tests/domain/full-life-passport.test.ts \
  tests/integration/full-life-commit.test.ts \
  tests/integration/full-life-store.test.ts \
  tests/integration/database-schema.test.ts \
  tests/integration/reset-demo.test.ts \
  tests/branch/life-git.test.ts
pnpm typecheck
pnpm exec eslint \
  src/branch/life-git.ts src/branch/full-life-passport.ts \
  src/application/full-life.ts src/application/present-full-life.ts \
  src/infrastructure/integrity.ts src/infrastructure/sqlite/branch-store.ts \
  src/infrastructure/sqlite/db.ts scripts/reset-demo-cli.ts \
  tests/branch/full-life-git.test.ts \
  tests/domain/full-life-passport.test.ts \
  tests/integration/full-life-commit.test.ts \
  tests/integration/full-life-store.test.ts
git diff --check
```

- [ ] **Step 6: Commit without creating/resetting a demo database**

```bash
git add src/branch/life-git.ts src/branch/full-life-passport.ts \
  src/application/full-life.ts src/application/present-full-life.ts \
  src/infrastructure/integrity.ts src/infrastructure/sqlite/branch-store.ts \
  src/infrastructure/sqlite/schema.sql src/infrastructure/sqlite/db.ts \
  scripts/reset-demo-cli.ts package.json .env.example .gitignore \
  tests/branch/full-life-git.test.ts tests/domain/full-life-passport.test.ts \
  tests/integration/full-life-commit.test.ts \
  tests/integration/full-life-store.test.ts \
  tests/integration/database-schema.test.ts tests/integration/reset-demo.test.ts
git commit -m "feat: publish full life baseline"
```

---

### Task 10: Compose and deliver the complete baseline workspace

**Files:**

- Create: `src/infrastructure/full-life-composition.ts`
- Modify: `src/infrastructure/composition-root.ts`
- Create: `src/experience/full-life-view-model.ts`
- Create: `src/experience/components/FullLifeJourney.tsx`
- Create: `src/experience/components/FullLifeRouteInputs.tsx`
- Create: `src/experience/components/FullLifeWorkspace.tsx`
- Modify: `src/experience/components/EvidencePassport.tsx`
- Modify: `src/experience/components/LifeBranch.tsx`
- Modify: `src/experience/components/CityFrontierJourney.tsx`
- Modify: `src/experience/run-url.ts`
- Modify: `src/app/actions.ts`
- Modify: `src/app/page.tsx`
- Modify: `src/app/globals.css`
- Create: `tests/integration/full-life-composition.test.ts`
- Create: `tests/integration/full-life-experience.test.tsx`
- Modify: `tests/integration/city-frontier-experience.test.tsx`

**Interfaces:**

- Consumes: Tasks 1 and 4–9 plus exact verified upstream readers.
- Produces one composed application:

```ts
export interface FullLifeApplication {
  loadSetup(citySelectionSnapshotId: string): Promise<FullLifeSetupReadModel>;
  loadRouteInputStep(input: {
    readonly citySelectionSnapshotId: string;
    readonly routeBasisHash: string;
  }): Promise<FullLifeRouteInputStep>;
  loadDecisionInputs(
    citySelectionSnapshotId: string,
  ): Promise<FullLifeDecisionInputProjection>;
  researchFacts(
    citySelectionSnapshotId: string,
    signal: AbortSignal,
  ): Promise<FullLifeVerifiedFacts>;
  prepareBaseline(
    command: PrepareFullLifeBaselineCommand,
    signal: AbortSignal,
  ): Promise<PreparedFullLifeEnvelope>;
  commit(command: CommitFullLifeCommand): Promise<FullLifeBranchCommit>;
  present(commitId: string): Promise<FullLifePresentationReadModel>;
}
```

`FullLifeCompositionDependencies` lists the exact City Selection, Country Resolution, Place Frontier, profile/preference, facts Evidence/source, branch store, integrity, clock, ID generator and film port dependencies. No action constructs its own partial graph.

`src/instrumentation.ts` initializes the Codex runtime once. The composition root only calls `getCodexCliModelAdapter()` and passes that exact returned singleton to the onboarding extraction/review wrapper and `createCodexFullLifeFilmPort`; it never constructs, initializes or preflights another adapter. The two ports are separate capability-specific objects, not a shared generic model facade.

`researchFactsAction` accepts only `citySelectionSnapshotId`; server composition derives date, stable snapshot ID, random attempt ID and deadline. `prepareFullLifeBaselineAction` accepts untrusted hash/answers/draft but never route facts. `presentFullLifeAction` accepts only commit ID and has no source/model dependency.

- [ ] **Step 1: Write RED composition identity/dependency tests**

Assert one `getCodexCliModelAdapter()` lookup, the same returned adapter identity in both narrow wrappers, zero adapter construction/initialization/preflight in composition, one Full Life application, exact verified loaders, server-owned research IDs/date/deadline, no browser projection as authority and zero adapter/source calls during presentation.

- [ ] **Step 2: Write RED experience tests**

Cover exact City Selection wrapper CTA, `?flow=full-life&selection=...`, route-first order, route change clearing dependent inputs, work/housing tuples and labels, general city rent wording, all input classes, typed budget subsets, draft preservation on service failure, optional film edits, commit URL replacement before adopting saved state and source-free reload.

Representative UI assertion:

```tsx
expect(screen.getAllByRole("radio", { name: /Комната|Студия|Квартира с одной спальней/ }))
  .toHaveLength(3);
expect(screen.getByText("Общий ориентир аренды по городу")).toBeVisible();
```

- [ ] **Step 3: Run RED**

```bash
pnpm exec vitest run \
  tests/integration/full-life-composition.test.ts \
  tests/integration/full-life-experience.test.tsx \
  tests/integration/city-frontier-experience.test.tsx
```

- [ ] **Step 4: Implement composition, actions and baseline UI**

The screen owns one unsaved draft. Codex failure preserves it and exposes one ordinary service error; no retry button/state appears. Narrow layout becomes one ordered column without hiding provenance/unknowns. View-model code formats saved values only and performs no budget or diff calculation.

- [ ] **Step 5: Run GREEN, build and commit**

```bash
pnpm exec vitest run \
  tests/integration/full-life-composition.test.ts \
  tests/integration/full-life-experience.test.tsx \
  tests/integration/full-life-prepare.test.ts \
  tests/integration/full-life-commit.test.ts \
  tests/integration/full-life-store.test.ts \
  tests/integration/city-frontier-experience.test.tsx
pnpm typecheck
pnpm exec eslint \
  src/infrastructure/full-life-composition.ts \
  src/infrastructure/composition-root.ts \
  src/experience/full-life-view-model.ts \
  src/experience/components/FullLifeJourney.tsx \
  src/experience/components/FullLifeRouteInputs.tsx \
  src/experience/components/FullLifeWorkspace.tsx \
  src/experience/components/CityFrontierJourney.tsx \
  src/experience/run-url.ts src/app/actions.ts src/app/page.tsx \
  tests/integration/full-life-composition.test.ts \
  tests/integration/full-life-experience.test.tsx
pnpm build
git diff --check
git add src/infrastructure/full-life-composition.ts \
  src/infrastructure/composition-root.ts \
  src/experience/full-life-view-model.ts \
  src/experience/components/FullLifeJourney.tsx \
  src/experience/components/FullLifeRouteInputs.tsx \
  src/experience/components/FullLifeWorkspace.tsx \
  src/experience/components/EvidencePassport.tsx \
  src/experience/components/LifeBranch.tsx \
  src/experience/components/CityFrontierJourney.tsx \
  src/experience/run-url.ts src/app/actions.ts src/app/page.tsx src/app/globals.css \
  tests/integration/full-life-composition.test.ts \
  tests/integration/full-life-experience.test.tsx \
  tests/integration/city-frontier-experience.test.tsx
git commit -m "feat: deliver full life baseline"
```

At this point the product has a working, saved and replayable Full Life baseline before alternative complexity is introduced.

---

### Task 11: Add exactly one city, work or housing alternative

**Files:**

- Modify: `src/application/full-life-contracts.ts`
- Modify: `src/application/full-life.ts`
- Modify: `src/application/present-full-life.ts`
- Modify: `src/branch/life-git.ts`
- Modify: `src/branch/full-life-film.ts`
- Modify: `src/experience/full-life-view-model.ts`
- Modify: `src/experience/components/FullLifeJourney.tsx`
- Modify: `src/experience/components/LifeGitDiff.tsx`
- Modify: `src/experience/components/CityFrontierJourney.tsx`
- Modify: `src/experience/run-url.ts`
- Modify: `src/app/actions.ts`
- Modify: `src/app/page.tsx`
- Create: `tests/integration/full-life-alternative.test.ts`
- Modify: `tests/branch/full-life-git.test.ts`
- Modify: `tests/integration/full-life-experience.test.tsx`

**Interfaces:**

- Consumes: verified baseline and its pre-city root; existing City Frontier/select-city flow; Tasks 4–10.
- Produces:

```ts
export interface PrepareFullLifeAlternativeCommand {
  readonly kind: "alternative";
  readonly commandId: string;
  readonly baselineCommitId: string;
  readonly citySelectionSnapshotId: string;
  readonly factsSnapshotId: string;
  readonly changedDecision: "city" | "work" | "housing";
  readonly draft: unknown;
}

export interface FullLifeDeterministicDiff {
  readonly changedDecision: "city" | "work" | "housing";
  readonly decision: FullLifeDecisionDelta;
  readonly budget: FullLifeBudgetDiff;
  readonly sharedProfileSnapshotId: string;
  readonly sharedPreferenceProfileSnapshotId: string;
  readonly sharedResolvedCountryShortlistRevisionId: string;
  readonly sharedRoute: true;
}

export interface FullLifeNarrativePair {
  readonly classification: "separate_projections";
  readonly baselineOutputHash: string;
  readonly alternativeOutputHash: string;
}
```

Alternative always copies baseline route basis and route inputs. Work/housing alternatives reuse baseline selection/facts. City alternative requires a verified sibling selection with the same `preCityBranchCommitId`, loads a new city-bound fact snapshot and may legitimately rehydrate official salary/rent/budget values. `deriveFullLifeDecisionIntent` proves exactly one user decision changed; `deriveFullLifeSharedUserInputs` proves unrelated expenses and savings did not change.

Codex runs exactly once for the alternative projection. It does not reproduce the baseline and does not classify text changes as causal. Deterministic decision/budget changes are causal; narrative is the saved pair above.

City alternative uses the existing selector:

```text
baseline commit
  -> ?flow=city&fullLifeBaseline=<baseline ID>
  -> server reloads baseline and terminal/root
  -> normal selectCity creates sibling selection
  -> ?flow=full-life&baseline=<baseline ID>&selection=<new selection ID>
  -> verified alternative setup
```

The browser never supplies run/root/route facts. A journey with only the original selection can therefore create its city alternative without pre-creating sibling selections.

- [ ] **Step 1: Write RED pure/application alternative tests**

Parameterize city/work/housing. Cover locked route, same root, exact one decision intent, unchanged shared inputs, appropriate facts reuse/research, foreign sibling rejection, second existing alternative, one film call, zero baseline regeneration and deterministic-only diff.

- [ ] **Step 2: Write RED concurrency/store tests**

Two different commands racing for the sole alternative produce one success and one constraint-safe product conflict. Same command/same intent returns the first alternative/timestamp. Baseline remains byte-identical.

- [ ] **Step 3: Write RED city-return and presentation tests**

Cover initial one-selection journey, server-derived terminal/root, normal sibling selection, exact return URL, work/housing local entry, removed/disabled alternative action after commit and source/model-free presentation of both projections.

- [ ] **Step 4: Run RED**

```bash
pnpm exec vitest run \
  tests/integration/full-life-alternative.test.ts \
  tests/branch/full-life-git.test.ts \
  tests/integration/full-life-experience.test.tsx \
  tests/integration/full-life-store.test.ts \
  tests/integration/city-selection.test.ts
```

- [ ] **Step 5: Implement the alternative union and UI path**

Extend the prepared payload with a closed alternative arm. Do not add branch lists, graph navigation, arbitrary forks, rewind mutation or automatic scenario enumeration.

- [ ] **Step 6: Run GREEN, build and commit**

```bash
pnpm exec vitest run \
  tests/integration/full-life-alternative.test.ts \
  tests/branch/full-life-git.test.ts \
  tests/integration/full-life-experience.test.tsx \
  tests/integration/full-life-store.test.ts \
  tests/integration/city-selection.test.ts
pnpm typecheck
pnpm exec eslint \
  src/application/full-life-contracts.ts src/application/full-life.ts \
  src/application/present-full-life.ts src/branch/life-git.ts \
  src/branch/full-life-film.ts src/experience/full-life-view-model.ts \
  src/experience/components/FullLifeJourney.tsx \
  src/experience/components/LifeGitDiff.tsx \
  src/experience/components/CityFrontierJourney.tsx \
  src/experience/run-url.ts src/app/actions.ts src/app/page.tsx \
  tests/integration/full-life-alternative.test.ts \
  tests/integration/full-life-experience.test.tsx
pnpm build
git diff --check
git add src/application/full-life-contracts.ts src/application/full-life.ts \
  src/application/present-full-life.ts src/branch/life-git.ts \
  src/branch/full-life-film.ts src/experience/full-life-view-model.ts \
  src/experience/components/FullLifeJourney.tsx \
  src/experience/components/LifeGitDiff.tsx \
  src/experience/components/CityFrontierJourney.tsx \
  src/experience/run-url.ts src/app/actions.ts src/app/page.tsx \
  tests/integration/full-life-alternative.test.ts \
  tests/branch/full-life-git.test.ts \
  tests/integration/full-life-experience.test.tsx
git commit -m "feat: add one full life alternative"
```

---

### Task 12: Prove offline replay, privacy and the complete demo

**Files:**

- Create: `tests/integration/full-life-replay.test.ts`
- Create: `tests/integration/full-life-demo.test.tsx`
- Modify: `evals/codex-cli-full-life.ts`
- Modify: `evals/fixtures/full-life/cases.json`

**Interfaces:**

- Consumes: the complete Tasks 1–11 application and saved database.
- Produces no new product interface; it is the release gate.

- [ ] **Step 1: Add black-box baseline and alternative tests**

Baseline cases cover current work, supported profession, dated RUB/EUR FX, unsupported ISO currency, unknown rent and assumption, incomplete expenses, savings interval, route unknowns, film edits and all six Passport classes. Alternative cases cover exactly one city/work/housing change per isolated database and separate narrative projections.

- [ ] **Step 2: Add tamper and offline replay tests**

Mutate every persisted binding/hash/ref/film/Passport/diff field. Successful replay returns exact saved canonical film bytes and structured links with zero official source calls, zero Codex adapter calls and zero budget recomputation in React.

- [ ] **Step 3: Run the complete automated gate**

```bash
pnpm exec vitest run \
  tests/integration/full-life-replay.test.ts \
  tests/integration/full-life-demo.test.tsx
pnpm exec tsx evals/codex-cli-full-life.ts --mode=synthetic
pnpm exec tsx evals/codex-cli-full-life.ts --mode=replay-offline
pnpm test
pnpm typecheck
pnpm lint
pnpm build
git diff --check
rg -n "node-llama-cpp|Qwen|GGUF|OPENAI_API_KEY|providerRegistry|providerSwitch" \
  package.json pnpm-lock.yaml src
```

Expected audit: no matches. Direct API clients, API-key handling, model weights/downloaders and provider switching are absent.

- [ ] **Step 4: Run the real Codex privacy/failure gate on the prepared Mac**

Verify exact CLI preflight, tool-free event stream, closed child env, fresh temp cleanup, one process per action, prompt injection rejection, timeout/abort, logged-out/missing-CLI behavior, no application telemetry and no unapproved network traffic. A service outage must leave the draft and create no commit/fallback/retry UI; after recovery the same ordinary save action may be pressed again.

- [ ] **Step 5: Obtain explicit browser permission and time the visual journey**

Run one clean 3–5 minute flow: onboarding → Country/Yellow Resolution → City Selection → route → route inputs → baseline → one alternative → Passport/diff → offline reload. Browser permission is not implied by this plan or by Codex CLI runtime approval.

- [ ] **Step 6: Commit the release evidence tests**

```bash
git add tests/integration/full-life-replay.test.ts \
  tests/integration/full-life-demo.test.tsx \
  evals/codex-cli-full-life.ts evals/fixtures/full-life/cases.json
git commit -m "feat: prove full life journey"
```

## Completion Gate

VS-4 is complete only when the exact upstream gate passes; the approved profession source installs a deterministic supported tuple; the City Selection CTA opens server-derived route choices; route answers, official facts, current work, savings, rent and labels are re-derived rather than trusted from the browser; the typed budget exposes known subsets and every excluded unknown; one tool-free Codex process produces each guarded saved projection; zero-write prepare precedes one atomic commit; the database permits one baseline per pre-city journey and at most one alternative; city/work/housing alternatives change exactly one decision; Passport preserves structured source links; and presentation/offline replay perform zero official-source and zero Codex calls.

## Non-Goals / Do Not Build

- No Qwen, GGUF, Ollama, LM Studio, `node-llama-cpp`, direct OpenAI API, API key, provider registry/switch or model chooser.
- No Codex session resume, repository/workspace access, tools, plugins, apps, MCP, user rules or inherited secrets.
- No retry loop/state/button, fallback/recorded response, background worker, queue or second invocation inside one action.
- No generic facts framework, universal profession registry, job/vacancy search, housing listings, booking, legal/tax advice or probabilities.
- No automatic route selection, arbitrary branch graph, multiple alternatives, automatic scenario enumeration or mutable baseline.
- No second Full Life commit table, ORM or migration runner.
- No UI budget formulas, film regeneration during replay, or narrative text described as a causal effect.
