# VS-4A City Evidence and Knowledge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Install one reviewable city research package and publish replayable, append-only City Evidence and full four-fact City Knowledge without carrying stale predecessor values.

**Architecture:** Existing generic artifact/Evidence storage remains the only raw-byte owner. A narrow signed City Evidence overlay binds the generic snapshot to city/frontier context and durable `completedAt`. Research builds each City Knowledge revision entirely from that one verified overlay; SQLite serializes revisions per city and reconstructs every row from sealed Evidence. Country Knowledge remains unchanged.

**Tech Stack:** TypeScript, the existing generic `ResearchPlan`/Evidence store, official source adapters, SQLite immediate transactions, canonical JSON/SHA-256/HMAC and Vitest.

**Depends on:** completed [`VS-4A Foundations`](2026-08-13-vs-4a-city-frontier-foundations.md) and its exact source contracts. `installable` means a sealed `city-catalog@2` projection plus four complete deterministic plans whose city outcomes are `verified | unknown`; missing or malformed catalog/plan policy remains a real blocker.

**Required safety dependency:** completed [`VS-4A Safety Source Discovery`](2026-08-14-vs-4a-safety-source-discovery.md). A complete safety, rent, transit or broadband plan may close a city as evidence-backed unknown; a missing catalog projection or incomplete four-fact plan policy, not an unknown outcome, blocks installation.

**Format metadata:** `review-matrix` — executable five-task checklist whose length comes from mandatory source, persistence, RED/GREEN, replay and commit cells; it is linked from the short master index and is not a narrative specification.

## Constraints specific to this plan

- If the source field map has not sealed `city-catalog@2` and four deterministic per-member plans, stop. Never create a production package from synthetic fixtures; a completed plan's `unknown` is not a stop condition.
- Do not generalize or alter Country Knowledge carry-forward behavior. City Knowledge is a separate full-projection contract.
- A City Knowledge revision contains exactly four current outcomes. Its predecessor contributes only the previous `knowledgeUpdatedAt` comparison baseline.
- `source_unavailable` requires a sealed completed discovery ledger. One failed candidate is never terminal; abort, storage, protocol, integrity and unexpected errors publish no City Knowledge.
- Raw bytes stay in `artifacts` only when the source-specific retention policy permits it. A prohibited transient copy is deleted after its minimal hash/locator projection is sealed; the City Evidence overlay and City Knowledge contain references only.
- Official catalog installation is an explicit administrative operation before user Start. Within a City Frontier run, only Continue may call official sources or the narrow safety-search port. Task 6 uses only committed fixtures and local synthetic boundary vectors: do not register, download, contact an authority or perform any network operation.

---

### Task 6: Implement the installed city research package and exact validators

**Requirements:** REQ-CF-01, REQ-CF-02, REQ-CF-04; SCN-CF-01, SCN-CF-06

**Files:**
- Create: `src/research/city-evidence.ts`
- Create: `src/research/city-package.ts`
- Create: `src/research/slovenia-city-plan.ts`
- Create: `src/research/parsers/slovenia-city.ts`
- Create: `src/infrastructure/sources/slovenia-city-source-adapter.ts`
- Create: `src/infrastructure/sources/installed-city-packages.ts`
- Create: `tests/research/city-package.test.ts`
- Create: `tests/sources/slovenia-city.test.ts`
- Modify narrowly: `src/research/contracts.ts`
- Modify narrowly: `src/research/research-plan.ts`
- Modify regression: `tests/research/cold-start.test.ts`

**Interfaces:**

```ts
export type SloveniaCitySourceId =
  | "si-city-catalog"
  | "si-city-safety"
  | "si-city-long-term-rent"
  | "si-city-urban-transit"
  | "si-city-fixed-broadband";

export interface InstalledCityResearchPackage {
  readonly packageId: string;
  readonly packageSchemaVersion: string;
  readonly countryCode: string;
  readonly evidenceRulesVersion: string;
  readonly criteriaDefaults: InstalledCityCriteriaDefaults;
  readonly criterionDefinitions: readonly CityCriterionDefinition[];
  readonly evaluatorRegistry: CityCriterionEvaluatorRegistry;
  createCatalogResearch(input: CatalogResearchInput): CatalogResearchBundle;
  createCityResearch(input: CityResearchInput): CityFactsResearchBundle;
}

export interface CatalogResearchBundle {
  readonly plan: ResearchPlan<"si-city-catalog", CityCatalogClaim>;
  readonly source: OfficialSourcePort<"si-city-catalog">;
  readonly terminalClaimCount: 1;
}

export interface CityFactsResearchBundle {
  readonly fixedPlan: ResearchPlan<Exclude<SloveniaCitySourceId, "si-city-catalog" | "si-city-safety">, CityEvidenceClaim>;
  readonly fixedSource: OfficialSourcePort<Exclude<SloveniaCitySourceId, "si-city-catalog" | "si-city-safety">>;
  readonly safety: {
    readonly sourcePlan: CitySafetySourcePlan;
    readonly authorityDirectory: OfficialAuthorityDirectory;
  };
  readonly criterionIds: readonly ["safety", "long_term_rent", "urban_transit", "fixed_broadband"];
}
```

`CatalogResearchBundle` has its own typed official-registry/population parser contract and exactly one catalog terminal result. `CityFactsResearchBundle.fixedPlan` closes rent/transit/broadband; before any blocker becomes unknown, each fixed plan records its checked official URLs, attempt dispositions and rejection reasons. The Application-owned safety discovery contributes the fourth `si-city-safety` terminal result and its artifacts before Evidence sealing. Together they close all four criterion IDs; each criterion yields one verified typed claim or one evidence-backed blocker that the Knowledge builder maps to an approved unknown reason.

- [ ] **Step 1: Write the missing-package and fixture-vector RED tests**

Assert exact country/package lookup, four definitions, versioned defaults/profile-mapping vectors, definition-specific normalizer/freshness vectors, exact source IDs/hosts/media/request shapes, one catalog terminal result, four city-fact terminal results, and `city_package_not_installed` for any other country.

- [ ] **Step 2: Run RED**

```bash
./node_modules/.bin/vitest run tests/research/city-package.test.ts \
  tests/sources/slovenia-city.test.ts
```

Expected: missing city package modules.

- [ ] **Step 3: Implement parsers and bounded source adapters from the approved field map**

Use only the installed field-map definitions, authority/source plan, schemas, numeric limits and committed fixture hashes. Rent/transit/broadband remain fixed-route and must record their checked official URLs, attempt dispositions and rejection reasons before a terminal blocker becomes unknown. The Research package produces the immutable safety source plan/directory/validators only; it does not import or call Application. Core Task 14 injects and invokes the completed Application discovery use case for `previous accepted URL -> configured official routes -> bounded search candidates`. Search provider results are not a `SloveniaCitySourceId`, artifact or claim. `CitySafetyDiscoveryResult.artifacts` contains only permitted official raw captures or canonical minimal retention projections under `si-city-safety`; the Application verifier merges those exact values into the generic Evidence manifest before sealing the overlay ledger. Validator outputs are `verified`, `not_found`, `stale`, `conflict`, `not_comparable` or sealed `source_unavailable`. Do not infer a value across a different geo scope, denominator or reference period; Task 6 performs no registration, download, authority contact or network operation.

- [ ] **Step 4: Extend generic Evidence failure typing without changing country behavior**

Add `not_found` and `not_comparable` only where the generic Research plan needs typed semantic outcomes. Preserve existing cold-start mappings byte-for-byte in behavior. For the safety composite only, wrong media, too large, untrusted redirect and unapproved retention become candidate rejections and continue within budget. A malformed provider response, tampered sealed Evidence, storage/integrity/internal failure or unexpected exception remains an operation failure, not `source_unavailable`.

- [ ] **Step 5: Run GREEN and commit**

```bash
./node_modules/.bin/vitest run tests/research/city-package.test.ts \
  tests/sources/slovenia-city.test.ts tests/research/cold-start.test.ts
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/eslint src/research/city-*.ts src/research/slovenia-city-plan.ts \
  src/research/parsers/slovenia-city.ts \
  src/infrastructure/sources/*city*.ts tests/research/city-package.test.ts \
  tests/sources/slovenia-city.test.ts
git diff --check
git add src/research/city-evidence.ts src/research/city-package.ts \
  src/research/slovenia-city-plan.ts src/research/parsers/slovenia-city.ts \
  src/infrastructure/sources/slovenia-city-source-adapter.ts \
  src/infrastructure/sources/installed-city-packages.ts src/research/contracts.ts \
  src/research/research-plan.ts tests/research/city-package.test.ts \
  tests/sources/slovenia-city.test.ts tests/research/cold-start.test.ts
git commit -m "feat: define Slovenia city research"
```

---

### Task 7: Add the signed City Evidence overlay

**Requirements:** REQ-CF-04, REQ-CF-05; SCN-CF-06

**Files:**
- Create: `src/application/city-data-contracts.ts`
- Create: `src/infrastructure/sqlite/city-evidence-store.ts`
- Create: `tests/integration/city-evidence-store.test.ts`
- Modify: `src/infrastructure/sqlite/schema.sql`
- Modify: `src/infrastructure/sqlite/db.ts`
- Modify narrowly: `src/infrastructure/sqlite/evidence-store.ts`
- Modify: `tests/integration/database-schema.test.ts`
- Modify exact table inventories: `tests/integration/confirmed-life.test.ts`
- Modify exact table inventories: `tests/branch/life-git.test.ts`

**Interfaces:**

```ts
export interface CityEvidenceSnapshot {
  readonly schemaVersion: "city-evidence@1";
  readonly id: string; // same ID as underlying EvidenceSnapshot
  readonly cityCheckRunId: string;
  readonly frontierRunId: string;
  readonly cityId: string;
  readonly countryCode: string;
  readonly packageId: string;
  readonly packageSchemaVersion: string;
  readonly catalogRevisionId: string;
  readonly criteriaSnapshotId: string;
  readonly rankingSnapshotId: string;
  readonly definitionIds: Readonly<Record<CityCriterionId, string>>;
  readonly rulesVersion: string;
  readonly safetyAttemptLedger: CitySafetyAttemptLedger;
  readonly contextHash: string;
  readonly completedAt: string;
}

export interface CityEvidenceStorePort {
  seal(input: CityEvidenceSealInput): CityEvidenceSnapshot;
  loadVerified(id: string, expected?: CityEvidenceExpectations): VerifiedCityEvidence;
  findVerifiedByCheckRunId(cityCheckRunId: string): VerifiedCityEvidence | undefined;
}
```

Define this port in `src/application/city-data-contracts.ts`; the SQLite adapter structurally implements the inward contract. Infrastructure must not own the public port.

- [ ] **Step 1: Write RED for atomic Evidence/overlay sealing**

Test same-ID exact retry, conflicting payload, exact city/package/catalog/criteria/ranking binding, `completedAt >= max(capturedAt, searchedAt)`, every ledger artifact reference present exactly once in the generic Evidence manifest, every previous-origin attempt resolving to an exact prior verified City Evidence/source-plan/accepted URL lineage, overlay-without-generic rejection, generic-without-overlay recovery, byte/hash/HMAC tamper and immutable UPDATE/DELETE. Bind every ledger reference to the exact discovery artifact before sealing: raw mode compares canonical URL/response URL and captured-byte hash with `locator`/`sourceSha256`; transient mode parses the canonical retained inspection/navigation/denominator projection and compares its `sourceLocator`, `sourceSha256` and retention disposition. The generic manifest then verifies the stored artifact bytes and provenance. Mutate/re-sign safety query/provider/outcome/result order, assessment time, previous Evidence/source-plan provenance, canonical URL, redirect, authority/media/retention decision, artifact/source hash, locator, rejection reason and `3/10/2` counters in both retention modes; every semantic mutation must fail reconstruction.

- [ ] **Step 2: Run RED**

```bash
./node_modules/.bin/vitest run tests/integration/city-evidence-store.test.ts \
  tests/integration/database-schema.test.ts
```

- [ ] **Step 3: Add only the `city_evidence_snapshots` table and preflight**

Columns: ID FK to `evidence_snapshots`, unique check-run ID, mirrored city/country/package fields, schema/rules/context hash, canonical payload/hash/HMAC and completedAt. Add immutable triggers. Update all exact table/index/trigger inventories and `db.ts` reset-required preflight.

- [ ] **Step 4: Implement one immediate seal transaction and verified replay**

Factor reusable generic Evidence verification out of `evidence-store.ts`; do not add city branches to old source-ID unions. Before sealing, load and verify every previous-origin Evidence reference and canonical-compare its city/municipality/definition/source-plan plus accepted URL with the discovery input; no arbitrary current official URL may impersonate prior provenance. Accept the exact discovery result artifacts, require each ledger ref to resolve to exactly one same-run artifact, and validate the raw or retained-projection bridge above before writing. Seal those exact `si-city-safety` artifacts through the existing artifact writer before the signed generic snapshot and overlay; the raw-seal mode stores permitted official bytes, while hash-locator mode stores only its canonical minimal projection. On lost insert race, read back and canonical-compare. A cancellation or thrown storage/parser error must leave no overlay row; a sealed generic snapshot without its overlay is recovered idempotently on retry.

- [ ] **Step 5: Run GREEN and commit**

```bash
./node_modules/.bin/vitest run tests/integration/city-evidence-store.test.ts \
  tests/integration/evidence-store.test.ts tests/integration/database-schema.test.ts \
  tests/integration/confirmed-life.test.ts tests/branch/life-git.test.ts
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/eslint src/infrastructure/sqlite/city-evidence-store.ts \
  src/infrastructure/sqlite/evidence-store.ts tests/integration/city-evidence-store.test.ts
git diff --check
git add src/application/city-data-contracts.ts \
  src/infrastructure/sqlite/schema.sql src/infrastructure/sqlite/db.ts \
  src/infrastructure/sqlite/evidence-store.ts \
  src/infrastructure/sqlite/city-evidence-store.ts \
  tests/integration/city-evidence-store.test.ts tests/integration/database-schema.test.ts \
  tests/integration/confirmed-life.test.ts tests/branch/life-git.test.ts
git commit -m "feat: seal city evidence context"
```

---

### Task 8: Build full four-fact City Knowledge revisions

**Requirements:** REQ-CF-05; SCN-CF-05, SCN-CF-06

**Files:**
- Create: `src/research/city-knowledge.ts`
- Create: `tests/research/city-knowledge.test.ts`

**Interfaces:**

```ts
export type CityFactOutcome =
  | { readonly kind: "verified"; readonly basis: CityVerifiedFactBasis }
  | { readonly kind: "unknown"; readonly reason: CityUnknownReason };

export type CityFactEvidenceReference =
  | {
      readonly kind: "claim";
      readonly sourceId: string;
      readonly artifactId: string;
      readonly locator: string;
      readonly excerptHash: string;
      readonly navigationUrl: string;
      readonly resolvedEvidenceUrl: string;
    }
  | {
      readonly kind: "blocker";
      readonly sourceId: string;
      readonly blocker: CityUnknownReason;
      readonly artifactIds: readonly string[];
      readonly navigationUrl: string;
      readonly resolvedEvidenceUrl?: string;
    };

export interface CityKnowledgeFact {
  readonly criterionId: CityCriterionId;
  readonly definitionId: string;
  readonly geoScope: { readonly kind: string; readonly officialAreaId: string };
  readonly referencePeriod: string | null;
  readonly freshnessBasis: { readonly policyVersion: string; readonly value: string | null };
  readonly unit: string;
  readonly denominator: string;
  readonly outcome: CityFactOutcome;
  readonly evidenceRefs: readonly CityFactEvidenceReference[];
}

export interface CityKnowledgeRevision {
  readonly schemaVersion: "city-knowledge@1";
  readonly id: string;
  readonly cityId: string;
  readonly countryCode: string;
  readonly packageId: string;
  readonly packageSchemaVersion: string;
  readonly rulesVersion: string;
  readonly predecessorRevisionId?: string;
  readonly evidenceSnapshotId: string;
  readonly facts: readonly [CityKnowledgeFact, CityKnowledgeFact, CityKnowledgeFact, CityKnowledgeFact];
  readonly lastCheckedAt: string;
  readonly knowledgeUpdatedAt: string;
  readonly createdAt: string;
}

export function buildCityKnowledgeRevision(input: BuildCityKnowledgeInput, integrity: CityDecisionIntegrity): CityKnowledgeRevision;
export function reconstructCityKnowledgeRevision(input: ReconstructCityKnowledgeInput, integrity: CityDecisionIntegrity): CityKnowledgeRevision;
export function projectCityKnowledgeForRanking(
  revision: CityKnowledgeRevision,
): CityKnowledgeRankingProjection;
```

- [ ] **Step 1: Write the no-carry-forward RED matrix**

Cover 4/4 verified, every live `CityUnknownReason`, rejection of ranking-only `no_knowledge_revision`, missing/duplicate/foreign criterion, wrong definition/geo/unit/denominator/evidence ownership, known-to-unknown, and absence of profile/target/importance/score/suitability/raw bytes.

- [ ] **Step 2: Run RED**

```bash
./node_modules/.bin/vitest run tests/research/city-knowledge.test.ts
```

- [ ] **Step 3: Implement full projection and revision-level time semantics**

Build all four facts only from current sealed Evidence, whether the outcome is verified or unknown, bind its exact `rulesVersion` and seal the revision ID through injected `CityDecisionIntegrity`. Safety verified facts retain `offenceCount`, `population` and the exact rational basis; Knowledge does not copy search queries, provider results or the attempt ledger. For semantic comparison include definition, geo scope, reference period, freshness basis, unit, denominator and outcome; exclude Evidence refs, accepted/reviewed URL changes, IDs and timestamps. First revision sets `knowledgeUpdatedAt = lastCheckedAt`; an unchanged semantic projection preserves only predecessor `knowledgeUpdatedAt`, never a predecessor fact value; known-to-unknown or any changed fact sets it to the new `lastCheckedAt`. Enforce predecessor time `< lastCheckedAt <= createdAt`.

- [ ] **Step 4: Add reconstruction/tamper and deep-freeze tests**

Change fact order, status/value, reference period, timestamp inequalities, Evidence refs/ownership, package/city/rules binding and extra keys. Verify only Evidence-reference changes do not alter semantic-update time.

- [ ] **Step 5: Run GREEN and commit**

```bash
./node_modules/.bin/vitest run tests/research/city-knowledge.test.ts \
  tests/domain/city-ranker.test.ts
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/eslint src/research/city-knowledge.ts \
  tests/research/city-knowledge.test.ts
git diff --check
git add src/research/city-knowledge.ts tests/research/city-knowledge.test.ts
git commit -m "feat: build full city knowledge"
```

---

### Task 9: Persist Catalog and City Knowledge and install the official catalog

**Requirements:** REQ-CF-01, REQ-CF-05; SCN-CF-01, SCN-CF-05, SCN-CF-06

**Files:**
- Modify: `src/application/city-data-contracts.ts`
- Create: `src/application/install-city-package.ts`
- Create: `src/infrastructure/city-package-installation-composition.ts`
- Create: `src/infrastructure/sqlite/city-catalog-store.ts`
- Create: `src/infrastructure/sqlite/city-knowledge-store.ts`
- Create: `evals/install-city-package.ts`
- Create: `tests/integration/city-knowledge-store.test.ts`
- Modify: `src/infrastructure/sqlite/schema.sql`
- Modify: `src/infrastructure/sqlite/db.ts`
- Modify exact table/index/trigger inventories: `tests/integration/database-schema.test.ts`
- Modify exact table inventories: `tests/integration/confirmed-life.test.ts`
- Modify exact table inventories: `tests/branch/life-git.test.ts`

**Interfaces:**

```ts
export interface VerifiedCityCatalogBundle {
  readonly registry: CityRegistryRevision;
  readonly catalog: CityCatalogRevision;
}

export interface CityCatalogStorePort {
  appendVerified(input: CityCatalogPublication): VerifiedCityCatalogBundle;
  loadVerified(id: string): VerifiedCityCatalogBundle;
  latestInstalledVerified(countryCode: string): VerifiedCityCatalogBundle | undefined;
}

export interface CityKnowledgeStorePort {
  publishFromEvidence(evidenceSnapshotId: string, createdAt: string): CityKnowledgeRevision;
  latestVerified(cityId: string): CityKnowledgeRevision | undefined;
  loadVerified(id: string): CityKnowledgeRevision;
  findByEvidenceVerified(evidenceSnapshotId: string): CityKnowledgeRevision | undefined;
}
```

Both store ports above live in `src/application/city-data-contracts.ts`; SQLite only implements them.

- [ ] **Step 1: Write store/install RED tests**

Cover out-of-band official catalog capture/seal/publication, full considered-universe reconstruction
with omitted mandatory-capital/selected-population-fill rows and re-signed population tamper, exact
99/100/101 member boundary, `NEEDS_CONTEXT` with zero publication for more than 100 mandatory capitals,
historical `city-catalog@1` load/replay, rejection and zero new rows for `appendVerified(@1)`,
Start-visible latest @2 Registry/catalog without HTTP, distinct-city
roots, exact retry, same-projection successor, known-to-unknown, stale completed check rejection,
simultaneous identical publication, simultaneous distinct publication forming one linear chain, and no
revision for fatal outcomes.

- [ ] **Step 2: Run RED**

```bash
./node_modules/.bin/vitest run tests/integration/city-knowledge-store.test.ts \
  tests/integration/database-schema.test.ts
```

- [ ] **Step 3: Add catalog and knowledge tables**

`city_catalog_revisions` stores the closed Registry, full considered-universe population projection, reconstructed Catalog and Evidence binding. `city_knowledge_revisions` stores one root/one successor per city, unique city+Evidence, mirrored `rules_version` and revision times, payload/hash/HMAC and immutable triggers. Add strict preflight and exact inventories.

- [ ] **Step 4: Implement immediate publication and the administrative installer**

Catalog installer is an explicit CLI/eval use case, never a browser route and never called by City
Start. It must prove a source plan for every member of the at-most-100 catalog, while a particular
frontier run may check only ten. `CityCatalogNeedsContextError` becomes package status `NEEDS_CONTEXT`
and inserts no Registry/catalog rows. `appendVerified` and the installer accept only
`city-catalog@2`; an @1 publication request is `city_catalog_upgrade_required` and writes nothing.
`CityCatalogStore.loadVerified` still replays an already persisted historical @1 row, or the exact
sealed @2 catalog artifacts, through the rules-version-pinned package parser without HTTP, compares
the full Registry/population projection and only then reconstructs membership. Knowledge publication loads verified City Evidence
inside `BEGIN IMMEDIATE`, reconstructs the complete safety ledger and accepted/reviewed URL lineage,
resolves the current head, rebuilds the full revision with injected integrity, rejects a check not
newer than the head, inserts, reloads and verifies the complete predecessor chain.

- [ ] **Step 5: Run GREEN and commit**

```bash
./node_modules/.bin/vitest run tests/integration/city-knowledge-store.test.ts \
  tests/integration/city-evidence-store.test.ts tests/integration/database-schema.test.ts \
  tests/integration/confirmed-life.test.ts tests/branch/life-git.test.ts
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/eslint src/application/install-city-package.ts \
  src/infrastructure/city-package-installation-composition.ts \
  src/infrastructure/sqlite/city-{catalog,knowledge}-store.ts \
  tests/integration/city-knowledge-store.test.ts evals/install-city-package.ts
git diff --check
git add src/application/city-data-contracts.ts src/application/install-city-package.ts \
  src/infrastructure/city-package-installation-composition.ts \
  src/infrastructure/sqlite/city-catalog-store.ts \
  src/infrastructure/sqlite/city-knowledge-store.ts src/infrastructure/sqlite/schema.sql \
  src/infrastructure/sqlite/db.ts evals/install-city-package.ts \
  tests/integration/city-knowledge-store.test.ts tests/integration/database-schema.test.ts \
  tests/integration/confirmed-life.test.ts tests/branch/life-git.test.ts
git commit -m "feat: persist city knowledge"
```

---

### Task 10: Prove sealed City Evidence replay without network

**Requirements:** REQ-CF-04, REQ-CF-05; SCN-CF-10

**Files:**
- Create: `src/application/replay-city-evidence.ts`
- Create: `tests/integration/city-evidence-replay.test.ts`

**Interfaces:**

```ts
export function replayCityEvidence(input: {
  readonly evidenceSnapshotId: string;
  readonly cityId: string;
  readonly packageId: string;
}, ports: CityEvidenceReplayPorts): Promise<VerifiedCityEvidence>;
```

- [ ] **Step 1: Write zero-network RED**

Construct a real sealed city bundle, replace `CitySafetyOfficialDocumentPort.inspect`, `CitySafetySearchPort.search`, every generic `OfficialSourcePort.capture` and `RequestStep` with throwing counted spies, replay twice, compare canonical claims/blockers/safety ledger/accepted and reviewed URLs/context/completedAt, and assert every count remains zero.

- [ ] **Step 2: Run RED**

```bash
./node_modules/.bin/vitest run tests/integration/city-evidence-replay.test.ts
```

- [ ] **Step 3: Implement package-specific byte replay**

Load the signed overlay and generic artifacts, recursively load any explicitly referenced prior City Evidence, resolve the exact installed package/version, reconstruct its plan and safety attempt ledger with verified previous provenance, rerun validators on sealed permitted bytes/minimal projections and canonical-compare all claims, blockers, queries, candidate order, redirects, counters, accepted/reviewed URLs, parser/rules versions and context. Reject cycles and wrong-city/source-plan lineage. Never call `CitySafetyOfficialDocumentPort.inspect`, `CitySafetySearchPort.search`, `OfficialSourcePort.capture` or `RequestStep`.

- [ ] **Step 4: Add drift/tamper tests**

Reject parser version drift, wrong package/city/context, altered bytes/hash, missing artifact, missing/altered/cyclic prior Evidence lineage, changed blocker and re-signed semantic mutation.

- [ ] **Step 5: Run the Knowledge gate and commit**

```bash
./node_modules/.bin/vitest run tests/research/city-knowledge.test.ts \
  tests/research/city-package.test.ts tests/sources/slovenia-city.test.ts \
  tests/integration/city-evidence-store.test.ts \
  tests/integration/city-knowledge-store.test.ts \
  tests/integration/city-evidence-replay.test.ts
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/eslint src/application/replay-city-evidence.ts \
  tests/integration/city-evidence-replay.test.ts
git diff --check
git add src/application/replay-city-evidence.ts \
  tests/integration/city-evidence-replay.test.ts
git commit -m "feat: replay city evidence"
```
