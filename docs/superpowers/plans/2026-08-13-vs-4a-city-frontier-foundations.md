# VS-4A City Frontier Foundations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish the canonical VS-4A contract, prove one official country package is feasible, and implement the pure City Catalog, Criteria and frozen Ranker policies.

**Architecture:** Foundations are inward-facing. Decision owns only immutable values and pure reconstruction; Research exposes installed package definitions behind a port. Official source discovery is an explicit fail-closed gate before a package can be installed. No task in this plan creates a run, accesses SQLite from Decision, or renders UI.

**Tech Stack:** TypeScript 6.0.3, Decimal.js 10.6.0, Vitest 4.1.10, injected canonical JSON/integrity capabilities at sealing boundaries, and official Slovenia sources captured only through the approved Evidence discipline.

**Master plan:** [`VS-4A City Frontier`](2026-08-13-vs-4a-city-frontier.md)

**Required safety amendment:** [`VS-4A Safety Source Discovery`](2026-08-14-vs-4a-safety-source-discovery.md). It replaces the safety-specific source gate, exact quantity/freshness and yellow-marker wording below; execute it after this plan and before Knowledge.

**Format metadata:** `review-matrix` — executable five-task checklist whose apparent length comes from mandatory per-task file, interface, RED/GREEN and commit cells; it is linked from the short master index and is not a narrative specification.

## Constraints specific to this plan

- Do not edit `preference-profile.ts`, `place-ranker.ts`, `place-package.ts` or historical VS-3/VS-3R change/design/evidence files.
- Do not declare Slovenia installed until the field map proves all catalog rules and all four criterion definitions with deterministic fixture vectors.
- Domain tests use explicit synthetic values. Synthetic values never enter the production installed package or source evidence.
- Decimal strings are canonical; JS `number` never decides ranking order.
- Each task stays reviewer-sized and commits independently.

---

### Task 1: Canonicalize the approved VS-4A product contract

**Requirements:** GOAL-CF-01; REQ-CF-01..07; SCN-CF-01..10

**Files:**
- Create: `docs/changes/active/vs-4a-city-frontier/change.md`
- Modify: `docs/product/charter.md`
- Modify: `docs/product/glossary.md`
- Modify: `docs/product/demo-story.md`
- Modify: `docs/architecture/spec-of-specs.md`
- Modify: `docs/README.md`

**Interfaces:** Produces the forward-only canonical wording consumed by every later task. Historical approved artifacts remain byte-identical.

- [ ] **Step 1: Capture the expected missing wording as a RED documentation audit**

Run before editing:

```bash
rg -n 'City Catalog Revision|three_selectable|city-unknown-risk@1|PreCityBranchCommit' \
  docs/product/charter.md docs/product/glossary.md docs/product/demo-story.md \
  docs/architecture/spec-of-specs.md docs/README.md
```

Expected: exit 1 or incomplete matches, proving the forward canon does not yet contain the approved exact contract.

- [ ] **Step 2: Create the active change package**

Write `change.md` with status `approved — implementation pending`, links to the baseline design, approved safety supplement and all six plan files, and exact traceability for `GOAL-CF-01`, `REQ-CF-01..07`, `SCN-CF-01..10`. Include this normative flow:

```text
Resolved Country Shortlist entry
  -> confirmed four-criterion City Criteria Snapshot
  -> full installed City Catalog ranking (at most 100 members)
  -> one-city-at-a-time fresh four-fact verification
  -> `three_selectable`, `catalog_exhausted` or `live_candidate_limit_reached` (10 completed cities)
  -> atomic City Selection Snapshot + sibling City Branch Commit
```

- [ ] **Step 3: Amend only forward canonical docs**

Add the exact catalog cap-100/national-and-first-level-regional-capital/population-fill rule, typed
`NEEDS_CONTEXT` overflow, separate live-10 candidate bound, bounded official safety fallback,
yellow-selectability rule, three-way terminal rule, full four-fact revision rule, frozen-vs-fresh
labels, accepted/reviewed source-link replay and sibling branch semantics. In Spec of Specs add a
`VS-4A` row after VS-3R and ownership sections for Decision, Research, Application, Infrastructure,
Branch and Experience. In README link the active change, both approved designs and this plan index.

- [ ] **Step 4: Verify no stale city promise remains**

```bash
rg -n 'City Catalog Revision|100 cities|live_candidate_limit_reached|three_selectable|city-unknown-risk@1|PreCityBranchCommit|Доступен с неполными данными|10 document URL candidates' \
  docs/product/charter.md docs/product/glossary.md docs/product/demo-story.md \
  docs/architecture/spec-of-specs.md docs/README.md \
  docs/changes/active/vs-4a-city-frontier/change.md
! rg -n 'population.*>= ?20.?000|top.?10|unknown.*исключает|перв(ый|ого).*город.*остан|green\+amber|no city yellow' \
  docs/product docs/architecture/spec-of-specs.md \
  docs/changes/active/vs-4a-city-frontier/change.md
git diff --check
```

Expected: positive terms present, stale search has no matches, diff check exits 0.

- [ ] **Step 5: Commit**

```bash
git add docs/README.md docs/product/charter.md docs/product/glossary.md \
  docs/product/demo-story.md docs/architecture/spec-of-specs.md \
  docs/changes/active/vs-4a-city-frontier/change.md
git commit -m "docs: canonicalize VS4A city frontier"
```

---

### Task 2: Prove the Slovenia official city-source contracts before installing a package

**Requirements:** REQ-CF-01, REQ-CF-02, REQ-CF-04, REQ-CF-05; SCN-CF-01, SCN-CF-06

**Files:**
- Modify: `docs/changes/active/vs-4a-city-frontier/source-field-map.md`
- Modify only when a source row is proven: `tests/sources/fixtures/slovenia-city/**`
- Do not create production package files in this task.

**Interfaces:** Produces the exact official URLs, authority/geo/period/unit/denominator definitions, request shapes, parser fixture hashes, freshness rules and failure taxonomy used by the Knowledge plan.

- [ ] **Step 1: Write the fail-closed field-map skeleton**

Maintain a four-row metric matrix (`safety`, `long_term_rent`, `urban_transit`, `fixed_broadband`) plus a catalog matrix. Every row requires: authority, navigation URL, resolved evidence URL/request, official area identifier, comparable population/metric definition, reference period, unit, denominator, update cadence, freshness rule, validator outline, capture bound and deterministic boundary vectors. The catalog matrix must prove the full considered universe, mandatory-capital roles and deterministic at-most-100 membership. Safety additionally records a per-catalog-member manifest for every catalog member, authority/host directory, known routes, query-template version, redirect/media/size/retention policy and criterion-level readiness. Mark the package `unavailable` until every criterion contract is complete.

- [ ] **Step 2: Inspect only official authority surfaces**

Use a disposable temporary database/directory. Follow the then-current local `AGENTS.md`: an explicit chat-wide read-only permission may cover navigation in that chat, while downloads, POST captures, forms, uploads and sign-in require separate immediate confirmation. Candidate authorities must remain Slovenian official public bodies or official municipal/operator sources; a search provider may discover candidate URLs but is never authority. Record final URLs, redirects, media types, request bodies and dates without recording credentials. Do not touch the existing developer database.

- [ ] **Step 3: Capture bounded reproducible fixtures**

For each proven catalog/criterion source, preserve the smallest response needed by the validator under `tests/sources/fixtures/slovenia-city/`, record SHA-256 and capture date in the field map, and exclude unrelated personal/raw data. Regenerate the prior ten-member catalog projection as an at-most-100 projection; never relabel the old top-ten hashes. Seal registry identity/point projections for every considered-universe entry, even when it is not selected, while criterion source plans cover exactly every selected Catalog member. Safety requires a fresh exact-municipality positive projection for a catalog member, a broad/multi-municipality rejection projection, a same-year SURS municipality denominator and search/trust vectors; raw municipal PDF/HTML bytes stay outside the repository. Each criterion ends in one closed source contract whose per-city result is `verified | unknown`, or an explicit infeasibility result.

- [ ] **Step 4: Apply the package installation gate**

The field map may say `installable` only if it proves:

```text
official registry/universe + population rule
+ safety definition/validator
+ long-term rent definition/validator
+ urban transit definition/validator
+ fixed broadband definition/validator
= one closed four-fact package
```

The catalog part of this gate must publish `city-catalog@2`, prove `members.length <= 100`, and stop
with `NEEDS_CONTEXT` before package publication if the sealed mandatory-capital set alone exceeds 100.
An earlier ten-member fixture or a source plan that covers only those ten is not sufficient.

An incomplete manifest, trust policy, definition or validator keeps that criterion unavailable. Safety may advance from `candidate_available_with_partial_official_coverage` to `available_with_partial_official_coverage` even when some cities resolve to evidenced unknown. This does not install the country package: transit or broadband failure keeps the whole package `unavailable / NEEDS_CONTEXT` and blocks package installation, live Start and source-verified claims. Pure Catalog/Criteria/Ranker and the separate safety component plan may proceed against synthetic/domain fixtures; do not claim integrated VS-4A success, add a placeholder URL, build a universal crawler or use fixtures as production facts.

- [ ] **Step 5: Verify and commit the feasibility result**

```bash
rg -n 'authority|navigationUrl|resolvedEvidenceUrl|referencePeriod|freshness|sha256|installable|unavailable' \
  docs/changes/active/vs-4a-city-frontier/source-field-map.md
git diff --check -- docs/changes/active/vs-4a-city-frontier/source-field-map.md \
  tests/sources/fixtures/slovenia-city
git add docs/changes/active/vs-4a-city-frontier/source-field-map.md
if test -d tests/sources/fixtures/slovenia-city; then
  git add tests/sources/fixtures/slovenia-city
fi
git commit -m "docs: verify Slovenia city sources"
```

Expected: one explicit final package status, exact field evidence, no secrets, and no production code.

---

### Task 3: Implement the pure City Registry and Catalog policy

**Requirements:** REQ-CF-01; SCN-CF-01

**Files:**
- Modify: `src/decision/city-integrity.ts`
- Modify: `src/decision/city-catalog.ts`
- Modify: `tests/domain/city-catalog.test.ts`
- Modify regressions: `tests/domain/city-ranker.test.ts`
- Modify regressions: `tests/research/city-safety-source-plan.test.ts`
- Modify regressions: `tests/research/city-safety-evidence.test.ts`
- Modify regressions: `tests/integration/city-safety-discovery.test.ts`

**Interfaces:**

```ts
export const LEGACY_CITY_CATALOG_RULES_VERSION = "city-catalog@1" as const;
export const CITY_CATALOG_RULES_VERSION = "city-catalog@2" as const;
export const CITY_CATALOG_MEMBER_LIMIT = 100 as const;
export interface CityDecisionIntegrity {
  canonical(value: unknown): string;
  hash(canonicalText: string): string;
}
// `regional` is accepted for @2 only when sealed package evidence explicitly types
// the city as a first-level regional capital. Lower-level centres do not qualify.
export type CityCapitalRole = "national" | "regional";
export type CityCatalogInclusionReason =
  // Historical @1-only reasons.
  | "population_threshold"
  | "top_ten_fill"
  // Shared capital reasons.
  | "national_capital"
  | "regional_capital"
  // Current @2-only fill reason.
  | "population_fill";

export class CityCatalogNeedsContextError extends Error {
  readonly code = "mandatory_capitals_exceed_limit";
  readonly mandatoryCapitalCount: number;
  readonly memberLimit = CITY_CATALOG_MEMBER_LIMIT;
  constructor(mandatoryCapitalCount: number) {
    super("mandatory_capitals_exceed_limit");
    this.name = "CityCatalogNeedsContextError";
    this.mandatoryCapitalCount = mandatoryCapitalCount;
  }
}

export interface CityRegistryEntry {
  readonly cityId: string;
  readonly countryCode: string;
  readonly officialName: string;
  readonly coordinate: { readonly lat: number; readonly lng: number };
  readonly administrativeType: string;
  readonly administrativeTerritory: string;
  readonly capitalRoles: readonly CityCapitalRole[];
  readonly evidenceReferenceIds: readonly string[];
}

export interface CityCatalogCandidateBasis {
  readonly cityId: string;
  readonly comparablePopulation:
    | { readonly kind: "verified"; readonly value: string; readonly referencePeriod: string }
    | { readonly kind: "unknown"; readonly reason: "not_found" | "not_comparable" };
}

export interface CityRegistryRevision {
  readonly schemaVersion: "city-registry@1";
  readonly id: string;
  readonly packageId: string;
  readonly packageSchemaVersion: string;
  readonly countryCode: string;
  readonly evidenceSnapshotId: string;
  readonly entries: readonly CityRegistryEntry[];
  readonly createdAt: string;
}

export interface CityCatalogMember {
  readonly cityId: string;
  readonly inclusionReasons: readonly CityCatalogInclusionReason[];
}

export interface CityCatalogRevision {
  readonly schemaVersion: "city-catalog@1";
  readonly id: string;
  readonly packageId: string;
  readonly packageSchemaVersion: string;
  readonly countryCode: string;
  readonly registryRevisionId: string;
  readonly evidenceSnapshotId: string;
  readonly populationDefinition: {
    readonly definitionId: string;
    readonly geoScope: string;
    readonly unit: "people";
  };
  readonly candidateBasis: readonly CityCatalogCandidateBasis[];
  readonly members: readonly CityCatalogMember[];
  readonly coverage:
    | { readonly status: "complete" }
    | { readonly status: "incomplete"; readonly reasons: readonly ("missing_population" | "official_universe_partial")[] };
  readonly rulesVersion: "city-catalog@1" | "city-catalog@2";
  readonly createdAt: string;
}

export function buildCityRegistryRevision(input: BuildCityRegistryInput, integrity: CityDecisionIntegrity): CityRegistryRevision;
export function buildCityCatalogRevision(input: BuildCityCatalogInput, integrity: CityDecisionIntegrity): CityCatalogRevision;
export function reconstructCityCatalog(input: ReconstructCityCatalogInput): CityCatalogProjection;
```

`CityCatalogRevision` binds package/schema/country, exact registry/evidence IDs, population definition,
the complete considered-universe `CityCatalogCandidateBasis[]` for every registry entry, members with
inclusion reasons, complete-or-incomplete coverage, rules version and createdAt. New writes use
`city-catalog@2`: unique mandatory capitals first, then verified comparable population descending and
ordinal `cityId` ascending until at most 100 members; stored members remain canonical `cityId` order.
Reconstruction dispatches by bound rules version, keeps historical `city-catalog@1` replayable, and
never trusts the member list alone.

**Approved amendment (2026-08-16):** the repository already contains the historical @1 implementation.
Execute this task as a TDD policy migration: do not rewrite or invalidate @1 rows; make the default
builder emit @2 and throw `CityCatalogNeedsContextError` before sealing an @2 ID. Knowledge Task 9
alone owns translation to package status `NEEDS_CONTEXT` and the zero-durable-row proof.

- [ ] **Step 1: Write the membership RED matrix**

Cover 99/100/101 ordinary population-fill members; 99/100/101 unique mandatory capitals with low or
missing population; a city carrying both roles counted once; equal-population ordinal `cityId`
tie-break; mixed population periods rejected; fewer than 100 official centers; input-order invariance;
omitted candidate-basis rows for either a selected or unselected Registry entry; incomplete population
coverage; exact @1 replay. Assert 101 mandatory capitals throws `CityCatalogNeedsContextError` before
returning an @2 revision.

- [ ] **Step 2: Run RED**

```bash
./node_modules/.bin/vitest run tests/domain/city-catalog.test.ts
```

Expected after the 2026-08-16 amendment: the existing @1 suite fails the new @2
cap/priority/overflow assertions before production code changes.

- [ ] **Step 3: Implement closed validation and canonical membership**

Reject duplicate city IDs, foreign country entries, invalid coordinates, mixed population definition/geo scope, incomplete considered-universe coverage, missing evidence refs and extra fields. For @2 deduplicate mandatory roles by city, fail closed above 100, then fill only from verified comparable populations; unknown non-capital population is never guessed. `CityDecisionIntegrity` is a type-only inward capability; Application/Infrastructure inject the existing canonical/SHA implementation. Inject it only when sealing IDs; semantic reconstruction recomputes projection without hashing. Decision must not import `node:crypto` or Infrastructure. Store candidate bases and members in canonical `cityId` order; do not rank by population after membership is built.
For @2 canonicalize each member reason in `national_capital`, `regional_capital`, `population_fill`
order and reject either @1-only reason on an @2 revision.

- [ ] **Step 4: Add reconstruction/tamper tests**

Mutate/resign membership, the 100/101 boundary, an omitted candidate, inclusion reason, coverage,
population basis, registry binding, rule version and order. Assert cross-version reason misuse fails,
historical @1 reconstruction stays byte-stable, @2 semantic reconstruction fails closed, returned data
is deeply immutable and targets/scores/raw bytes are absent; server-side store tests separately assert
sealed ID/hash/HMAC mismatch as `integrity_mismatch`.

- [ ] **Step 5: Run GREEN and commit**

```bash
./node_modules/.bin/vitest run tests/domain/city-catalog.test.ts
./node_modules/.bin/vitest run tests/domain/city-ranker.test.ts \
  tests/research/city-safety-source-plan.test.ts \
  tests/research/city-safety-evidence.test.ts \
  tests/integration/city-safety-discovery.test.ts
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/eslint src/decision/city-integrity.ts \
  src/decision/city-catalog.ts tests/domain/city-catalog.test.ts \
  tests/domain/city-ranker.test.ts tests/research/city-safety-source-plan.test.ts \
  tests/research/city-safety-evidence.test.ts tests/integration/city-safety-discovery.test.ts
git diff --check
git add src/decision/city-integrity.ts src/decision/city-catalog.ts \
  tests/domain/city-catalog.test.ts tests/domain/city-ranker.test.ts \
  tests/research/city-safety-source-plan.test.ts tests/research/city-safety-evidence.test.ts \
  tests/integration/city-safety-discovery.test.ts
git commit -m "feat: cap city catalog membership"
```

---

### Task 4: Implement exact four-criterion definitions and snapshots

**Requirements:** REQ-CF-02; SCN-CF-02

**Files:**
- Create: `src/decision/city-safety.ts`
- Create: `src/decision/city-criterion-evaluator.ts`
- Create: `src/decision/city-criteria.ts`
- Create: `tests/domain/city-safety.test.ts`
- Create: `tests/domain/city-criteria.test.ts`

**Interfaces:**

```ts
export type CanonicalUnsignedInteger = string;

export interface CitySafetyQuantity {
  readonly offenceCount: CanonicalUnsignedInteger;
  readonly population: CanonicalUnsignedInteger;
  readonly rateBasis: "offences_per_100000_residents";
}

export type CitySafetyPeriodDisposition = "preferred" | "fallback" | "stale";

export function classifyCitySafetyPeriod(input: {
  readonly assessmentAt: string;
  readonly referenceYear: number;
}): CitySafetyPeriodDisposition;

export function compareCitySafetyToTarget(input: {
  readonly quantity: CitySafetyQuantity;
  readonly target: string;
  readonly direction: "at_most";
}): "matches" | "does_not_match";

export const CITY_CRITERION_IDS = [
  "safety", "long_term_rent", "urban_transit", "fixed_broadband",
] as const;
export type CityCriterionId = typeof CITY_CRITERION_IDS[number];
export type CityCriterionMode = "required" | "weighted";
export type CityImportance = 1 | 2 | 3 | 4 | 5;

export interface CityCriterionDraft {
  readonly criterionId: CityCriterionId;
  readonly definitionId: string;
  readonly mode: CityCriterionMode;
  readonly importance: CityImportance;
  readonly target: string;
}

export interface CityCriterionDefinition {
  readonly criterionId: CityCriterionId;
  readonly definitionId: string;
  readonly direction: "at_least" | "at_most";
  readonly unit: string;
  readonly denominator: string;
  readonly compatibleGeoScopes: readonly string[];
  readonly freshnessPolicyVersion: string;
  readonly evaluatorVersion: string;
}

export interface CityCriterionEvaluationInput {
  readonly criterion: CityCriterionDraft;
  readonly fact: CityRankingFactInput;
  readonly assessmentAt: string;
}

export interface CityCriterionEvaluation {
  readonly state: "verified" | "unknown";
  readonly factor: string;
  readonly targetComparison: "matches" | "does_not_match" | "unknown";
  readonly unknownReason?: CityUnknownReason;
}

export type CityCriterionEvaluatorRegistry = Readonly<Record<CityCriterionId, CityCriterionEvaluator>>;

export type CityUnknownReason =
  | "not_found" | "stale" | "conflict" | "not_comparable" | "source_unavailable";
export type CityRankingUnknownReason = CityUnknownReason | "no_knowledge_revision";

export type CityVerifiedFactBasis =
  | { readonly kind: "canonical_scalar"; readonly value: string }
  | { readonly kind: "municipal_safety"; readonly quantity: CitySafetyQuantity };

export interface CityCriteriaSnapshot {
  readonly schemaVersion: "city-criteria@1";
  readonly id: string;
  readonly profileSnapshotId: string;
  readonly preferenceProfileSnapshotId: string;
  readonly criteria: readonly [CityCriterionDraft, CityCriterionDraft, CityCriterionDraft, CityCriterionDraft];
  readonly rulesVersion: "city-criteria@1";
  readonly confirmedAt: string;
}

export type CityCriteriaProjection = Pick<CityCriteriaSnapshot,
  "profileSnapshotId" | "preferenceProfileSnapshotId" | "criteria" | "rulesVersion" | "confirmedAt"
>;

export interface CityRankingFactInput {
  readonly criterionId: CityCriterionId;
  readonly definitionId: string;
  readonly geoScope: string;
  readonly referencePeriod: string | null;
  readonly freshnessBasis: string;
  readonly unit: string;
  readonly denominator: string;
  readonly outcome:
    | { readonly kind: "verified"; readonly basis: CityVerifiedFactBasis }
    | { readonly kind: "unknown"; readonly reason: CityUnknownReason };
}

export interface CityCriterionEvaluator {
  readonly definition: CityCriterionDefinition;
  canonicalizeTarget(target: unknown): string;
  evaluate(input: CityCriterionEvaluationInput): CityCriterionEvaluation;
}

export interface InstalledCityCriteriaDefaults {
  readonly schemaVersion: "city-criteria-defaults@1";
  readonly mappingVersion: string;
  readonly criteria: readonly [CityCriterionDraft, CityCriterionDraft, CityCriterionDraft, CityCriterionDraft];
}

export function deriveCityCriteriaDraft(
  profile: RelocationProfileSnapshot,
  preferences: PreferenceProfileSnapshot,
  defaults: InstalledCityCriteriaDefaults,
  evaluators: CityCriterionEvaluatorRegistry,
): readonly [CityCriterionDraft, CityCriterionDraft, CityCriterionDraft, CityCriterionDraft];

export function confirmCityCriteria(
  input: {
    readonly draft: unknown;
    readonly profileSnapshotId: string;
    readonly preferenceProfileSnapshotId: string;
    readonly confirmedAt: string;
  },
  evaluators: CityCriterionEvaluatorRegistry,
  integrity: CityDecisionIntegrity,
): CityCriteriaSnapshot;
export function reconstructCityCriteria(
  snapshot: CityCriteriaSnapshot,
  evaluators: CityCriterionEvaluatorRegistry,
): CityCriteriaProjection;
```

- [ ] **Step 1: Write RED for the closed snapshot**

Test exactly four unique IDs in fixed order, required/weighted parity, importance boundaries, definition ownership, canonical targets, unsupported definition/unit/domain, stable ID under draft permutation, exact reconstruction and extra-field rejection. Add exact relocation/profile-preference-to-default mapping vectors for all four criteria; country-only preferences may influence documented matching city defaults but must never invent missing rent/transit/broadband targets. In `city-safety.test.ts`, reject signed/leading-zero/decimal/exponent/unsafe numeric inputs and zero population; accept explicit zero offences; cover exact target below/equal/above and June 30/July 1 `Y-1/Y-2` boundaries.

- [ ] **Step 2: Run RED**

```bash
./node_modules/.bin/vitest run tests/domain/city-safety.test.ts \
  tests/domain/city-criteria.test.ts
```

- [ ] **Step 3: Implement the registry and snapshot**

Use canonical-instant validation and browser-safe `BigInt` only after closed string validation. Canonical integers match `/^(0|[1-9][0-9]*)$/`; population is positive. Convert the target Decimal to integer coefficient/scale and compare cross-products without division or rounding. Keep source URLs, Evidence and search concepts out of Decision. Keep other normalizers in definition-specific evaluator objects. `city-criteria.ts` owns the pure versioned `deriveCityCriteriaDraft` mapping and validates/counts/orders, but contains no universal distance curve. Package defaults provide every numeric target that the profile cannot derive. Sealing IDs uses injected `CityDecisionIntegrity`; browser semantic reconstruction never hashes and Decision imports no crypto adapter. Use canonical Decimal strings and exact canonical instants. The safety definition is exactly `si-municipal-police-offences-per-100000@1`, direction `at_most`, municipality scope, unit `offences_per_100000_residents` and freshness `municipal-annual-july-boundary@1`; its evaluator imports `city-safety.ts` and compares integer cross-products.

- [ ] **Step 4: Add evaluator boundary vectors**

For both directions verify below/boundary/above target, factor `[0,1]`, saturation at `1`, monotonic approach and freshness boundary. Safety additionally covers June 30/July 1, preferred `Y-1`, held January–June `Y-2`, July stale, zero numerator, missing/zero denominator and a display-rounded rate that cannot change comparison. Use synthetic evaluator fixtures here; official Slovenia vectors belong to the installed-package task.

- [ ] **Step 5: Run GREEN and commit**

```bash
./node_modules/.bin/vitest run tests/domain/city-safety.test.ts \
  tests/domain/city-criteria.test.ts
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/eslint src/decision/city-safety.ts \
  src/decision/city-criterion-evaluator.ts src/decision/city-criteria.ts \
  tests/domain/city-safety.test.ts tests/domain/city-criteria.test.ts
git diff --check
git add src/decision/city-safety.ts src/decision/city-criterion-evaluator.ts \
  src/decision/city-criteria.ts tests/domain/city-safety.test.ts \
  tests/domain/city-criteria.test.ts
git commit -m "feat: define city criteria"
```

---

### Task 5: Implement the pure frozen City Ranker

**Requirements:** REQ-CF-03; SCN-CF-02, SCN-CF-07

**Files:**
- Create: `src/decision/city-ranker.ts`
- Create: `tests/domain/city-ranker.test.ts`

**Interfaces:**

```ts
export type CityKnowledgeRankingProjection =
  | {
      readonly cityId: string;
      readonly knowledgeRevisionId: string;
      readonly facts: readonly [CityRankingFactInput, CityRankingFactInput, CityRankingFactInput, CityRankingFactInput];
    }
  | {
      readonly cityId: string;
      readonly knowledgeRevisionId: null;
      readonly facts: readonly [];
    };

export interface CityRequiredMismatch {
  readonly criterionId: CityCriterionId;
  readonly definitionId: string;
  readonly target: string;
  readonly verifiedBasis: CityVerifiedFactBasis;
  readonly evaluatorVersion: string;
}

export interface CityRankingFactor {
  readonly criterionId: CityCriterionId;
  readonly definitionId: string;
  readonly mode: CityCriterionMode;
  readonly importance: CityImportance;
  readonly evaluatorVersion: string;
  readonly freshnessPolicyVersion: string;
  readonly state: "verified" | "unknown";
  readonly factor: string;
  readonly weightedContribution: string;
  readonly targetComparison: "matches" | "does_not_match" | "unknown";
  readonly requiredMismatch: boolean;
  readonly unknownReason?: CityRankingUnknownReason;
}

export interface RankedCity {
  readonly cityId: string;
  readonly rank: number;
  readonly score: string;
  readonly coverage: string;
  readonly knowledgeRevisionId: string | null;
  readonly factors: readonly [CityRankingFactor, CityRankingFactor, CityRankingFactor, CityRankingFactor];
}

export interface ScreenedCityExclusion {
  readonly cityId: string;
  readonly score: string;
  readonly coverage: string;
  readonly knowledgeRevisionId: string | null;
  readonly requiredMismatches: readonly CityRequiredMismatch[];
  readonly factors: readonly [CityRankingFactor, CityRankingFactor, CityRankingFactor, CityRankingFactor];
}

export interface CityRankingResult {
  readonly ordered: readonly RankedCity[];
  readonly screenedExclusions: readonly ScreenedCityExclusion[];
  readonly rulesVersion: "city-ranker@1";
}

export function rankCities(input: RankCitiesInput): CityRankingResult;
export function reconstructCityRanking(input: ReconstructCityRankingInput): CityRankingResult;
```

`RankCitiesInput` contains only assessmentAt, Catalog, Registry, Criteria, Decision-owned Knowledge projections and evaluator registry. It does not import a Research revision.

- [ ] **Step 1: Write exact formula RED tests**

Assert:

```text
score    = sum(importance * factor) / sum(importance)
coverage = sum(importance where verified) / sum(importance)
```

Cover unknown `0` with full denominator, required match contribution, required verified mismatch exclusion, required unknown retention, weighted mismatch retention, all four factors for excluded cities, and null Knowledge as four ranking-only `no_knowledge_revision` factors. Assert that this reason is rejected by live City Evidence/Knowledge decoders. For safety, mutate the formatted display rate while holding the exact integer basis and prove required mismatch/factor/order are unchanged; mutate the integer basis and prove reconstruction fails or the outcome changes deterministically.

- [ ] **Step 2: Run RED**

```bash
./node_modules/.bin/vitest run tests/domain/city-ranker.test.ts
```

- [ ] **Step 3: Implement canonical Decimal ranking**

Sort `score DESC`, then `coverage DESC`, then `cityId ASC`. Population must not appear in scoring or tie-break. Preserve full factor/contribution/evaluator data. `ordered + screenedExclusions` must exactly partition catalog membership.

- [ ] **Step 4: Add reconstruction and adversarial tests**

Reject duplicate/missing/extra city projections/facts, catalog/registry/country/definition mismatch, noncanonical Decimal, tampered score/coverage/factor/definition/evaluator/freshness/target-comparison/version/exclusion, altered membership union and input-order dependence.

- [ ] **Step 5: Run the foundation gate and commit**

```bash
./node_modules/.bin/vitest run tests/domain/city-catalog.test.ts \
  tests/domain/city-criteria.test.ts tests/domain/city-ranker.test.ts \
  tests/domain/place-ranker.test.ts
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/eslint src/decision/city-*.ts tests/domain/city-*.test.ts
git diff --check
git add src/decision/city-ranker.ts tests/domain/city-ranker.test.ts
git commit -m "feat: rank installed cities"
```

Expected: city tests green and the unchanged country ranker regression remains green.
