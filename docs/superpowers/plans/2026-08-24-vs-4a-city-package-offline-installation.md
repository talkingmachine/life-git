# VS-4A City Package Offline Installation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and prove the offline City Catalog/Knowledge/package persistence substrate, exact administrative installer, and sealed City Evidence replay without publishing an official Slovenia catalog.

**Architecture:** Existing generic Evidence gains a default-live, origin-specialized administrative branch without widening any live consumer. Structurally verified Catalog rows, full City Knowledge revisions, administrative package artifacts, and immutable signed package manifests remain separate persistence authorities. Production composition keeps Slovenia `not_ready`; only synthetic tests inject a ready resolver. Historical replay resolves an exact installed key and never consults current-package state or live sources.

**Tech Stack:** TypeScript, SQLite, canonical JSON/SHA-256/HMAC, Vitest, existing City Catalog/Evidence/Knowledge decision and research modules.

**Spec:** `docs/superpowers/specs/2026-08-24-vs-4a-city-package-offline-installation-design.md`

**Supersedes:** The execution structure and official-publication claim of Tasks 9–10 in `docs/superpowers/plans/2026-08-13-vs-4a-city-frontier-knowledge.md`. Their exact interface definitions, equations and hostile mutation matrices remain the contract appendix wherever this plan does not explicitly override them. Tasks 6–8 and their committed contracts remain unchanged.

## Global Constraints

- Current Slovenia remains `not_ready` with exactly the four existing readiness issues. Do not add a production ready/defaults/behavior entry.
- No browser, HTTP, official-source, model, Codex runtime, eval-model, or network call is permitted in this plan.
- `ArtifactBytes`, `ParserEntry`, official-source capture, public Evidence replay, Country Knowledge, Dossier, and existing City Evidence stay live-only through the default `O = "live"` type argument.
- Catalog schema remains `city-catalog@1`; new writes require rules `city-catalog@2`; historical rules `city-catalog@1` are load-only.
- Structural Catalog persistence does not certify official lineage. No production route or generic composition method may expose raw Catalog append.
- Existing databases with the prior live-only artifact table fail with `database_schema_reset_required`; never delete or reset data automatically.
- Preserve every existing Onboarding table, byte contract, test, and the protected untracked `.superpowers/brainstorm/*` directories.
- Every task uses strict RED before production, exact staged paths, an independent review, and no push, PR, or merge.
- Before every task staging step, `git diff --cached --quiet` must prove an empty index. After `git add`, `git diff --cached --name-only` must equal that task's sorted exact path inventory, `git diff --cached --check` must pass, and an independent reviewer must approve that cached diff before commit. After commit, verify the protected `.superpowers/brainstorm/*` status is unchanged.

## Documentation handoff before Task 1

Commit the approved boundary before any RED or production edit. The documentation commit contains
exactly the new spec amendment, this replacement plan, the parent Knowledge Tasks 9–10 supersession
notice, and the Core latest-installed port amendment.

```bash
git diff --cached --quiet
git add docs/superpowers/specs/2026-08-24-vs-4a-city-package-offline-installation-design.md \
  docs/superpowers/plans/2026-08-24-vs-4a-city-package-offline-installation.md \
  docs/superpowers/plans/2026-08-13-vs-4a-city-frontier-knowledge.md \
  docs/superpowers/plans/2026-08-13-vs-4a-city-frontier-core.md
git diff --cached --name-only
git diff --cached --check
git commit -m "docs: plan offline city installation"
```

---

### Task 1: Add the closed administrative Evidence origin

**Files:**
- Modify: `src/research/contracts.ts`
- Modify: `src/research/research-plan.ts`
- Modify: `src/infrastructure/sqlite/evidence-store.ts`
- Modify: `src/infrastructure/sqlite/schema.sql`
- Modify: `src/infrastructure/sqlite/db.ts`
- Create: `tests/research/evidence-origin-types.test.ts`
- Modify: `tests/integration/evidence-store.test.ts`
- Modify: `tests/integration/database-schema.test.ts`

**Consumes:** Existing `ArtifactBytes`, `LiveCapturedArtifact`, `TerminalEvidenceEntry`, `SealedEvidence`, `sealEvidencePlan`, `SqliteEvidenceStore`, and generic live replay.

**Produces:**

```ts
export type EvidenceOrigin = "live" | "administrative";

export interface ArtifactContent {
  readonly artifactId: string;
  readonly role: string;
  readonly mediaType: string;
  readonly sha256: string;
  readonly bytes: Uint8Array;
}

export interface AdministrativeCapturedArtifact<S extends string> extends ArtifactContent {
  readonly runId: string;
  readonly sourceId: S;
  readonly origin: "administrative";
  readonly producer: string;
  readonly createdAt: string;
}

export interface AdministrativeArtifactProvenance<S extends string> {
  readonly artifactId: string;
  readonly runId: string;
  readonly sourceId: S;
  readonly role: string;
  readonly mediaType: string;
  readonly sha256: string;
  readonly byteLength: number;
  readonly origin: "administrative";
  readonly producer: string;
  readonly createdAt: string;
}

export interface AdministrativeTerminalEvidenceEntry<
  S extends string,
  C extends Claim<unknown, S>,
> {
  readonly sourceId: S;
  readonly origin: "administrative";
  readonly artifacts: readonly AdministrativeCapturedArtifact<S>[];
  readonly coverage: "verified";
  readonly claims: readonly C[];
}

export interface AdministrativeEvidenceManifestEntry<S extends string> {
  readonly sourceId: S;
  readonly origin: "administrative";
  readonly artifactIds: readonly string[];
}

export type EvidenceArtifactProvenance<
  S extends string,
  O extends EvidenceOrigin = "live",
> = O extends "live" ? LiveArtifactProvenance<S> : AdministrativeArtifactProvenance<S>;

export type TerminalEvidenceEntryForOrigin<
  S extends string,
  C extends Claim<unknown, S>,
  O extends EvidenceOrigin = "live",
> = O extends "live" ? TerminalEvidenceEntry<S, C> : AdministrativeTerminalEvidenceEntry<S, C>;

export type EvidenceManifestEntryForOrigin<
  S extends string,
  O extends EvidenceOrigin = "live",
> = O extends "live" ? LiveEvidenceManifestEntry<S> : AdministrativeEvidenceManifestEntry<S>;

export type CapturedArtifactForOrigin<
  S extends string,
  O extends EvidenceOrigin = "live",
> = O extends "live" ? LiveCapturedArtifact<S> : AdministrativeCapturedArtifact<S>;

export interface EvidenceManifest<
  S extends string = SourceId,
  C extends Claim<unknown, S> = Claim<unknown, S>,
  O extends EvidenceOrigin = "live",
> {
  readonly snapshot: Omit<EvidenceSnapshot<S, C>, "manifestHash" | "hmac">;
  readonly entries: readonly EvidenceManifestEntryForOrigin<S, O>[];
  readonly artifacts: readonly EvidenceArtifactProvenance<S, O>[];
}

export interface SealedEvidence<
  S extends string = SourceId,
  C extends Claim<unknown, S> = Claim<unknown, S>,
  O extends EvidenceOrigin = "live",
> {
  readonly snapshot: EvidenceSnapshot<S, C>;
  readonly manifest: EvidenceManifest<S, C, O>;
  readonly canonicalManifest: string;
}

export interface SealEvidenceInput<
  S extends string = SourceId,
  C extends Claim<unknown, S> = Claim<unknown, S>,
  O extends EvidenceOrigin = "live",
> {
  readonly id: string;
  readonly assessmentDate: string;
  readonly entries: readonly TerminalEvidenceEntryForOrigin<S, C, O>[];
  readonly sourceIds: readonly S[];
  readonly parserVersions: Readonly<Record<S, string>>;
  readonly rulesVersion: string;
  readonly contextHash?: string;
  readonly knowledgeBaselineRevisionId?: string;
}

export interface EvidenceWriteStore<
  S extends string = SourceId,
  C extends Claim<unknown, S> = Claim<unknown, S>,
  O extends EvidenceOrigin = "live",
> {
  appendArtifact(artifact: CapturedArtifactForOrigin<S, O>): Promise<void>;
  seal(sealed: SealedEvidence<S, C, O>): Promise<void>;
}

export function verifySealedEvidenceForInsert<S, C, O extends EvidenceOrigin>(
  sealed: SealedEvidence<S, C, O>,
  integrity: EvidenceIntegrity,
): void;

export class SqliteAdministrativeEvidenceStore<S extends string, C extends Claim<unknown, S>>
  implements EvidenceWriteStore<S, C, "administrative"> {
  constructor(database: Database.Database, integrity: EvidenceIntegrity);
  appendArtifact(artifact: AdministrativeCapturedArtifact<S>): Promise<void>;
  seal(sealed: SealedEvidence<S, C, "administrative">): Promise<void>;
}
```

- [ ] **Step 1: Write the type and runtime REDs**

Add compile-time cases proving every unchanged one-/two-argument Evidence type resolves to live, `.url` remains required, administrative values cannot enter a live API, live values cannot enter the explicit administrative store, and both origins compile through the shared verifier. Add hostile runtime cases for accessors, symbols, sparse arrays, custom prototypes, mixed origin keys, noncanonical time, provenance/byte drift, canonical manifest drift, and HMAC drift. Assert borrowed values and bytes remain unfrozen/unaliased.

- [ ] **Step 2: Write the schema/preflight REDs**

Assert the exact live/administrative SQL CHECK, direct SQL rejection of every mixed or NULL-invalid row, rejection of old live-only table SQL before schema execution, and no automatic reset. Existing live artifact insert/load/replay bytes must remain exact.

- [ ] **Step 3: Run RED**

```bash
./node_modules/.bin/vitest run tests/research/evidence-origin-types.test.ts \
  tests/integration/evidence-store.test.ts tests/integration/database-schema.test.ts
```

Expected: failures only because the administrative specialization, store, schema, and preflight are absent.

- [ ] **Step 4: Implement the minimal origin-specialized boundary**

Keep `ArtifactBytes` URL-bearing. Introduce `ArtifactContent`; make administrative artifacts URL-free. Parameterize terminal entries, manifest/provenance, seal input/result, validation, and write store by defaulted origin. One shared verifier owns canonical manifest/hash/HMAC/snapshot equality. Keep the stored SQL row union module-private and map live/admin through separate adapters.

- [ ] **Step 5: Run GREEN and static gates**

```bash
./node_modules/.bin/vitest run tests/research/evidence-origin-types.test.ts \
  tests/integration/evidence-store.test.ts tests/integration/database-schema.test.ts \
  tests/integration/current-evidence.test.ts tests/integration/cold-start.test.ts
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/eslint src/research/contracts.ts src/research/research-plan.ts \
  src/infrastructure/sqlite/evidence-store.ts src/infrastructure/sqlite/db.ts \
  tests/research/evidence-origin-types.test.ts tests/integration/evidence-store.test.ts \
  tests/integration/database-schema.test.ts
git diff --check
```

- [ ] **Step 6: Commit exact Task 1 paths**

```bash
git add src/research/contracts.ts src/research/research-plan.ts \
  src/infrastructure/sqlite/evidence-store.ts src/infrastructure/sqlite/schema.sql \
  src/infrastructure/sqlite/db.ts tests/research/evidence-origin-types.test.ts \
  tests/integration/evidence-store.test.ts tests/integration/database-schema.test.ts
git commit -m "feat: add administrative evidence origin"
```

---

### Task 2: Seal deterministic administrative package artifacts

**Files:**
- Create: `src/research/city-package-artifact-set.ts`
- Create: `src/application/seal-administrative-evidence.ts`
- Modify narrowly: `src/infrastructure/sqlite/evidence-store.ts`
- Create: `tests/research/city-package-artifact-set.test.ts`
- Create: `tests/integration/administrative-evidence.test.ts`
- Modify narrowly: `tests/integration/evidence-store.test.ts`

**Consumes:** Explicit administrative Evidence store from Task 1; existing `InstalledCityPackageExactKey`, fixed/safety plans, authority directory, criteria defaults, criterion definitions, canonical/hash/sign integrity.

**Produces:**

```ts
export function buildInstalledPackageArtifactSetClaim(
  input: BuildInstalledPackageArtifactSetClaimInput,
  integrity: CityDecisionIntegrity,
): BuiltInstalledPackageArtifactSetClaim;

export function reconstructInstalledPackageArtifactSetClaim(
  claims: readonly unknown[],
  input: BuildInstalledPackageArtifactSetClaimInput,
  integrity: CityDecisionIntegrity,
): BuiltInstalledPackageArtifactSetClaim;

export function reconstructAdministrativeEvidenceShell(
  value: unknown,
  expected: AdministrativeEvidenceLoadExpectations,
): EvidenceSnapshot<"city-package-installation", Claim<unknown, "city-package-installation">>;

export function sealCityPackageAdministrativeEvidence(
  input: SealCityPackageAdministrativeEvidenceInput,
  ports: {
    readonly store: EvidenceWriteStore<
      "city-package-installation",
      CityPackageAdministrativeEvidenceClaim,
      "administrative"
    >;
    readonly integrity: EvidenceIntegrity;
  },
): Promise<SealedCityPackageAdministrativeEvidence>;

export interface AdministrativeEvidenceLoadExpectations {
  readonly evidenceId: string;
  readonly installedAt: string;
  readonly artifactIds: readonly string[];
}

export function loadVerifiedAdministrativeEvidenceBundle(
  database: Database.Database,
  expected: AdministrativeEvidenceLoadExpectations,
  integrity: EvidenceIntegrity,
): AdministrativeVerifiedEvidenceBundle<
  "city-package-installation",
  CityPackageAdministrativeEvidenceClaim
>;
```

- [ ] **Step 1: Write pure artifact-set REDs**

Pin the canonical order `3 * memberCount + 4`, slot/role bijection, ordinal sequence, exact run/Evidence/artifact ID equations, one closed claim, installation URN, ordinal-zero anchor SHA, recursive freeze, and nonaliasing. Mutate every nested field, ordering, slot, role, SHA, ID, timestamp, array density, descriptor, prototype, and callback timing; require `integrity_mismatch` before callbacks for hostile borrowed graphs.

- [ ] **Step 2: Write administrative sealing REDs**

Require canonical JSON bytes for every material, one generic seal, one source, one claim, no HTTP fields, producer `install-city-package@1`, exact created time, exact retry convergence, collision rejection, restart byte/provenance equality, and zero source/search/request calls.

- [ ] **Step 3: Run RED**

```bash
./node_modules/.bin/vitest run tests/research/city-package-artifact-set.test.ts \
  tests/integration/administrative-evidence.test.ts
```

- [ ] **Step 4: Implement the pure builder/reconstructor and one sealing use case**

Canonicalize each allowed value exactly once. Derive every identifier; never accept IDs, order, claims, anchors, or HTTP lineage from the caller. Invoke `sealEvidencePlan<"city-package-installation", CityPackageAdministrativeEvidenceClaim, "administrative">` exactly once and never call `integrity.sign` directly. Add the Infrastructure-internal typed administrative loader only after the shell reconstructor exists; it returns fresh administrative DTOs and never exports a SQLite row union.

- [ ] **Step 5: Run GREEN, typecheck, lint, and diff check**

```bash
./node_modules/.bin/vitest run tests/research/city-package-artifact-set.test.ts \
  tests/integration/administrative-evidence.test.ts tests/integration/evidence-store.test.ts
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/eslint src/research/city-package-artifact-set.ts \
  src/application/seal-administrative-evidence.ts \
  src/infrastructure/sqlite/evidence-store.ts \
  tests/research/city-package-artifact-set.test.ts tests/integration/administrative-evidence.test.ts
git diff --check
```

- [ ] **Step 6: Commit exact Task 2 paths**

```bash
git add src/research/city-package-artifact-set.ts \
  src/application/seal-administrative-evidence.ts \
  src/infrastructure/sqlite/evidence-store.ts tests/integration/evidence-store.test.ts \
  tests/research/city-package-artifact-set.test.ts \
  tests/integration/administrative-evidence.test.ts
git commit -m "feat: seal city package artifacts"
```

---

### Task 3: Persist structurally verified Catalog and full City Knowledge

**Files:**
- Modify: `src/decision/city-criteria.ts`
- Create: `src/decision/approved-city-criteria-defaults.ts`
- Modify narrowly: `src/application/city-data-contracts.ts`
- Create: `src/infrastructure/sqlite/city-catalog-store.ts`
- Create: `src/infrastructure/sqlite/city-knowledge-store.ts`
- Modify: `src/infrastructure/sqlite/schema.sql`
- Modify: `src/infrastructure/sqlite/db.ts`
- Modify: `tests/domain/city-criteria.test.ts`
- Create: `tests/domain/approved-city-criteria-defaults.test.ts`
- Create: `tests/integration/city-knowledge-store.test.ts`
- Modify: `tests/integration/database-schema.test.ts`
- Modify exact table inventories: `tests/integration/confirmed-life.test.ts`
- Modify exact table inventories: `tests/branch/life-git.test.ts`

**Produces:**

```ts
export interface CityCatalogStorePort {
  appendVerified(input: CityCatalogProjection): VerifiedCityCatalogBundle;
  loadVerified(id: string): VerifiedCityCatalogBundle;
}

export interface CityKnowledgeStorePort {
  publishFromEvidence(evidenceSnapshotId: string, createdAt: string): CityKnowledgeRevision;
  latestVerified(cityId: string): CityKnowledgeRevision | undefined;
  loadVerified(id: string): CityKnowledgeRevision;
  findByEvidenceVerified(evidenceSnapshotId: string): CityKnowledgeRevision | undefined;
}

export class SqliteCityKnowledgeStore implements CityKnowledgeStorePort {
  constructor(
    database: Database.Database,
    integrity: EvidenceIntegrity,
    packageReplay: CityEvidencePackageReplayPort,
  );
}

export function reconstructInstalledCityCriterionDefinitions(
  value: unknown,
  expectedDefinitionIds: Readonly<Record<CityCriterionId, string>>,
  expectedEvaluatorVersionIds: Readonly<Record<CityCriterionId, string>>,
): InstalledCityCriterionDefinitionTuple;

export function reconstructInstalledCityCriteriaDefaults(
  value: unknown,
  expectedMappingVersion: string,
  definitions: InstalledCityCriterionDefinitionTuple,
  evaluators: CityCriterionEvaluatorRegistry,
): InstalledCityCriteriaDefaults;

export function resolveApprovedCityCriteriaDefaults(
  definition: ApprovedCityCriteriaPackageDefinition,
  registry: ApprovedCityCriteriaDefaultsRegistry,
): InstalledCityCriteriaDefaults;
```

**Exact Knowledge replay dependency.** `SqliteCityKnowledgeStore` constructs its internal
`SqliteCityEvidenceStore` from the same SQLite connection, full integrity, and existing inward
`CityEvidencePackageReplayPort`; Task 3 adds no composition factory, source adapter, clock, or public
publication route. `publishFromEvidence` descriptor-snapshots its primitive arguments, enters
`BEGIN IMMEDIATE`, and loads exact verified City Evidence on that same connection before any Knowledge
query or write. It derives the closed five-field installed-package key only from that verified snapshot
and calls `packageReplay.loadExactReplayContract(key)` again. The adapter independently owns and
reconstructs this second replay result; it never trusts or reuses the Evidence reader's private replay
result, and a missing, alternating, malformed, legacy-rules, wrong-key, wrong-member, wrong-definition,
or mixed Registry/Catalog Evidence result is `integrity_mismatch` with zero writes.

The dense four-item fact-contract tuple is derived only from the reconstructed installed replay in
`SLOVENIA_CITY_FACT_SOURCE_IDS` order. Safety uses the reconstructed safety entry's municipality code
for `scope` and `officialAreaId`; each fixed contract is projected from its reconstructed plan
`claimContract`. All four definition IDs must equal the verified Evidence definition map. A blocker,
current claim, caller, or stored Knowledge row never supplies a contract or package key. Exact retry
requires the same Evidence ID and `createdAt`; a different time for the same Evidence, stale/forked
publication, replay drift, or row/chain/HMAC drift is `integrity_mismatch`. Publish and every read path
verify the complete Knowledge predecessor chain, exact City Evidence, exact package replay, mirrored
columns, hash/HMAC, and `reconstructCityKnowledgeRevision` before returning fresh frozen values.

- [ ] **Step 1: Write criteria/defaults REDs**

Pin exact four-item order, definitions/evaluator versions, canonical targets, mapping version, closed compiled registry selection by independently trusted package definition, full recursive freeze, and rejection of every hybrid, extra, missing, reordered, accessor, symbol, prototype, or unsupported entry. Confirm the production registry contains no ready Slovenia entry.

- [ ] **Step 2: Write Catalog and Knowledge store REDs**

Catalog append must reconstruct all IDs/membership and require current rules, while load replays current or historical rules exactly. Both append and load require `registry.evidenceSnapshotId === catalog.evidenceSnapshotId`; a fully rehashed mixed projection writes zero rows, and persisted/tampered inequality fails before return. The store must not claim official-source verification. Knowledge publication must load verified City Evidence inside `BEGIN IMMEDIATE`, publish exactly four current facts, drop old values on known-to-unknown, enforce strictly newer checks, keep one linear predecessor chain, converge on same-Evidence retry, and write nothing for fatal/integrity outcomes.

Include REDs proving that unknown facts obtain contract metadata from exact installed replay rather than
blockers/current facts; the replay key equals the five verified Evidence fields; missing/malformed/
legacy/wrong-member/wrong-definition/mixed-Evidence and alternating replay returns write zero rows;
reentrant replay mutation cannot alter the owned tuple; and both Evidence load and the second replay
validation occur inside the same transaction before the first Knowledge query or insert.

- [ ] **Step 3: Run RED**

```bash
./node_modules/.bin/vitest run tests/domain/approved-city-criteria-defaults.test.ts \
  tests/domain/city-criteria.test.ts tests/integration/city-knowledge-store.test.ts \
  tests/integration/database-schema.test.ts
```

- [ ] **Step 4: Implement inward criteria policy and both SQLite stores**

Persist canonical payload/hash/HMAC and immutable predecessor links. Catalog rows are structurally verified administrative data only; no source adapter, raw Catalog publisher, or production append route is added. Knowledge rebuilds through existing `buildCityKnowledgeRevision`/reconstructor and never applies Country Knowledge carry-forward.

- [ ] **Step 5: Run GREEN and broad regressions**

```bash
./node_modules/.bin/vitest run tests/domain/approved-city-criteria-defaults.test.ts \
  tests/domain/city-criteria.test.ts tests/research/city-knowledge.test.ts \
  tests/integration/city-knowledge-store.test.ts tests/integration/city-evidence-store.test.ts \
  tests/integration/database-schema.test.ts tests/integration/confirmed-life.test.ts \
  tests/branch/life-git.test.ts
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/eslint src/decision/city-criteria.ts \
  src/decision/approved-city-criteria-defaults.ts src/application/city-data-contracts.ts \
  src/infrastructure/sqlite/city-catalog-store.ts src/infrastructure/sqlite/city-knowledge-store.ts \
  src/infrastructure/sqlite/db.ts tests/domain/city-criteria.test.ts \
  tests/domain/approved-city-criteria-defaults.test.ts \
  tests/integration/city-knowledge-store.test.ts tests/integration/database-schema.test.ts
git diff --check
```

- [ ] **Step 6: Commit exact Task 3 paths**

```bash
git add src/decision/city-criteria.ts src/decision/approved-city-criteria-defaults.ts \
  src/application/city-data-contracts.ts src/infrastructure/sqlite/city-catalog-store.ts \
  src/infrastructure/sqlite/city-knowledge-store.ts src/infrastructure/sqlite/schema.sql \
  src/infrastructure/sqlite/db.ts tests/domain/city-criteria.test.ts \
  tests/domain/approved-city-criteria-defaults.test.ts tests/integration/city-knowledge-store.test.ts \
  tests/integration/database-schema.test.ts tests/integration/confirmed-life.test.ts \
  tests/branch/life-git.test.ts
git commit -m "feat: persist city catalog and knowledge"
```

---

### Task 4: Persist immutable installed-package history and exact lookup

**Files:**
- Modify: `src/research/city-package.ts`
- Modify narrowly: `src/application/city-data-contracts.ts`
- Create: `src/infrastructure/sqlite/city-package-manifest-store.ts`
- Create: `src/infrastructure/sources/installed-city-packages.ts`
- Modify: `src/infrastructure/sqlite/schema.sql`
- Modify: `src/infrastructure/sqlite/db.ts`
- Modify: `tests/research/city-package.test.ts`
- Create: `tests/integration/city-package-manifest-store.test.ts`
- Modify: `tests/integration/database-schema.test.ts`
- Modify exact table inventories: `tests/integration/confirmed-life.test.ts`
- Modify exact table inventories: `tests/branch/life-git.test.ts`

**Produces:** `CityResearchPackageAvailability`, `CityResearchPackageReadyCandidate`, `InstalledCityResearchPackage`, `InstalledCityPackageManifest`, `InstalledCityPackageLookupPort`, and:

```ts
export interface InstalledCityPackageManifestAppendInput {
  readonly ready: CityResearchPackageReadyCandidate;
  readonly catalog: VerifiedCityCatalogBundle;
  readonly administrativeEvidence: SealedCityPackageAdministrativeEvidence;
  readonly fixedPlansByCityId: Readonly<Record<string, readonly [
    CityFixedSourcePlan<"si-city-long-term-rent">,
    CityFixedSourcePlan<"si-city-urban-transit">,
    CityFixedSourcePlan<"si-city-fixed-broadband">,
  ]>>;
  readonly safetySourcePlan: CitySafetySourcePlan;
  readonly officialAuthorityDirectory: OfficialAuthorityDirectory;
  readonly criteriaDefaults: InstalledCityCriteriaDefaults;
  readonly criterionDefinitions: InstalledCityCriterionDefinitionTuple;
  readonly installedAt: string;
}

export interface InstalledCityPackageManifestStorePort {
  appendPrepared(input: InstalledCityPackageManifestAppendInput): InstalledCityPackageManifest;
  loadVerified(key: InstalledCityPackageExactKey): InstalledCityPackageManifest | undefined;
  latestVerified(countryCode: string): InstalledCityPackageManifest | undefined;
}

export interface InstalledCityCatalogReadPort {
  latestInstalledVerified(countryCode: string): VerifiedCityCatalogBundle | undefined;
}
```

The implementation is backed by the verified package head plus exact Catalog load.

**Explicit appendix override — manifest append ownership:** Application never constructs or supplies
the thirteen-key `InstalledCityPackageManifestPayload`. `appendPrepared` receives only verified ready
data, reconstructed persisted values, sealed administrative bindings and `installedAt`; it receives no
predecessor, behavior-version ID, manifest ID, payload hash or HMAC. Inside one `BEGIN IMMEDIATE`, the
adapter independently selects exactly one compiled behavior entry by the exact approved package
definition, verifies evaluator bindings against the reconstructed definitions, derives all behavior
versions, loads the verified current country head to derive `predecessorManifestId`, constructs and
signs the exact payload, inserts it, and compare-and-swap advances the head. Missing or ambiguous
compiled behavior throws `city_package_behavior_unavailable` with zero manifest/head rows. Full-payload
insert is private Infrastructure code.

- [ ] **Step 1: Write availability/history REDs**

Keep current SI’s exact not-ready value and four issues. Inject a synthetic ready value for positive tests. Install roots A then B; require current B, exact historical A, fresh frozen manifest `{ id, key }`, exact five-field lookup, zero fallback, and `undefined` only for an absent exact key. Then append a structurally valid but unreferenced Catalog C: `latestInstalledVerified(countryCode)` must still return B. A raw-row maximum, a head redirected to C, or any head/Catalog mismatch fails closed; C never becomes current.

- [ ] **Step 2: Write manifest integrity REDs**

Pin the exact signed payload/hash-derived ID/HMAC, thirteen-key closure, administrative Evidence and artifact-set claim reconstruction before JSON decode, all member/source/singleton slots, compiled defaults/behavior selection, predecessor/head CAS, immutable triggers, exact retry, lost race, restart, rollback/fork/skipped predecessor, forged audit ID, mirrored-key drift, missing artifact/default/behavior, and no current-B substitution for A.

- [ ] **Step 3: Run RED**

```bash
./node_modules/.bin/vitest run tests/research/city-package.test.ts \
  tests/integration/city-package-manifest-store.test.ts tests/integration/database-schema.test.ts
```

- [ ] **Step 4: Implement manifest/head storage and installed reconstruction**

Verify persisted canonical bytes/hash/HMAC and the complete signed chain before resolving artifacts or executable behavior. Resolve defaults only from the independently compiled registry and behaviors only from the exact private version key. `latestInstalledVerified` follows the verified package head; it never chooses the latest raw Catalog row.

- [ ] **Step 5: Run GREEN and restart/tamper regressions**

```bash
./node_modules/.bin/vitest run tests/research/city-package.test.ts \
  tests/integration/city-package-manifest-store.test.ts tests/integration/administrative-evidence.test.ts \
  tests/integration/evidence-store.test.ts tests/integration/database-schema.test.ts \
  tests/integration/confirmed-life.test.ts tests/branch/life-git.test.ts
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/eslint src/research/city-package.ts src/application/city-data-contracts.ts \
  src/infrastructure/sqlite/city-package-manifest-store.ts \
  src/infrastructure/sources/installed-city-packages.ts src/infrastructure/sqlite/db.ts \
  tests/research/city-package.test.ts tests/integration/city-package-manifest-store.test.ts \
  tests/integration/database-schema.test.ts
git diff --check
```

- [ ] **Step 6: Commit exact Task 4 paths**

```bash
git add src/research/city-package.ts src/application/city-data-contracts.ts \
  src/infrastructure/sqlite/city-package-manifest-store.ts \
  src/infrastructure/sources/installed-city-packages.ts src/infrastructure/sqlite/schema.sql \
  src/infrastructure/sqlite/db.ts tests/research/city-package.test.ts \
  tests/integration/city-package-manifest-store.test.ts tests/integration/database-schema.test.ts \
  tests/integration/confirmed-life.test.ts tests/branch/life-git.test.ts
git commit -m "feat: persist installed city packages"
```

---

### Task 5: Implement the exact offline installer and composition boundary

**Files:**
- Create: `src/application/install-city-package.ts`
- Create: `src/infrastructure/city-package-installation-composition.ts`
- Create: `tests/integration/install-city-package.test.ts`

**Produces:**

```ts
export interface InstallCityPackageInput {
  readonly countryCode: string;
  readonly installedAt: string;
  readonly catalogProjection: CityCatalogProjection;
  readonly fixedPlansByCityId: Readonly<Record<string, readonly [
    CityFixedSourcePlan<"si-city-long-term-rent">,
    CityFixedSourcePlan<"si-city-urban-transit">,
    CityFixedSourcePlan<"si-city-fixed-broadband">,
  ]>>;
  readonly safetySourcePlan: CitySafetySourcePlan;
  readonly officialAuthorityDirectory: OfficialAuthorityDirectory;
  readonly criteriaDefaults: InstalledCityCriteriaDefaults;
  readonly criterionDefinitions: InstalledCityCriterionDefinitionTuple;
}

export interface InstallCityPackagePorts {
  readonly resolveAvailability: (
    countryCode: string,
  ) => CityResearchPackageAvailability | undefined;
  readonly catalog: CityCatalogStorePort;
  readonly administrativeEvidence: EvidenceWriteStore<
    "city-package-installation",
    CityPackageAdministrativeEvidenceClaim,
    "administrative"
  >;
  readonly manifests: InstalledCityPackageManifestAppendPort;
  readonly installedPackages: InstalledCityPackageLookupPort;
  readonly approvedDefaults: ApprovedCityCriteriaDefaultsRegistry;
  readonly integrity: EvidenceIntegrity;
}

export function installCityPackage(
  input: InstallCityPackageInput,
  ports: InstallCityPackagePorts,
): Promise<InstalledCityResearchPackage>;

export interface InstalledCityPackageManifestAppendPort {
  appendPrepared(
    input: InstalledCityPackageManifestAppendInput,
  ): InstalledCityPackageManifest;
}
```

- [ ] **Step 1: Write input/readiness REDs**

Reject accessors without invocation, symbols, sparse arrays, custom prototypes, cycles, extra/missing fields, invalid IDs/timestamps, and reentrant mutation before any port/callback. Missing or current SI not-ready availability must throw `city_package_not_ready` with zero Catalog/Evidence/manifest/lookup calls and rows. Assert the user-facing production composition root's exact exported and returned surfaces contain no installer, Catalog store, or raw append capability.

- [ ] **Step 2: Write synthetic installation REDs**

With an injected closed synthetic ready resolver, require exact projection/package/defaults/plan bindings, current catalog rules, one Catalog append/reload, one administrative seal, one manifest/head append, exact `findExact` replay, exact retry, and no clock/ID/source/search/HTTP/model/browser capability. Legacy rules write nothing and throw `city_catalog_upgrade_required`; return drift or missing exact replay throws `integrity_mismatch`.

- [ ] **Step 3: Run RED**

```bash
./node_modules/.bin/vitest run tests/integration/install-city-package.test.ts
```

- [ ] **Step 4: Implement minimal orchestration**

Use only the supplied canonical `installedAt`. Resolve availability before persistence, independently select approved defaults, reconstruct every supplied value, derive key/member order, and call Task 2–4 capabilities exactly once in the approved order. Call `manifests.appendPrepared(...)` exactly once; Application never reads a head and never chooses a predecessor or executable behavior-version ID. `city-package-installation-composition.ts` is a dedicated administrative factory whose availability resolver is a code dependency, never serialized input; this slice invokes it only from integration tests with a closed synthetic ready resolver. Do not modify the user-facing composition root, create an installation eval, or re-export/return the installer or Catalog write capability.

- [ ] **Step 5: Run the complete offline installation gate**

```bash
./node_modules/.bin/vitest run tests/research/evidence-origin-types.test.ts \
  tests/research/city-package-artifact-set.test.ts tests/research/city-package.test.ts \
  tests/research/city-knowledge.test.ts tests/domain/approved-city-criteria-defaults.test.ts \
  tests/domain/city-criteria.test.ts tests/integration/administrative-evidence.test.ts \
  tests/integration/evidence-store.test.ts tests/integration/city-package-manifest-store.test.ts \
  tests/integration/city-knowledge-store.test.ts tests/integration/install-city-package.test.ts \
  tests/integration/city-evidence-store.test.ts tests/integration/database-schema.test.ts \
  tests/integration/current-evidence.test.ts tests/integration/cold-start.test.ts \
  tests/integration/confirmed-life.test.ts tests/branch/life-git.test.ts
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/eslint src/application/install-city-package.ts \
  src/infrastructure/city-package-installation-composition.ts \
  tests/integration/install-city-package.test.ts
git diff --check
```

- [ ] **Step 6: Commit exact Task 5 paths**

```bash
git add src/application/install-city-package.ts \
  src/infrastructure/city-package-installation-composition.ts \
  tests/integration/install-city-package.test.ts
git commit -m "feat: prepare offline city installation"
```

---

### Task 6: Prove sealed City Evidence replay without network

**Files:**
- Create: `src/application/replay-city-evidence.ts`
- Create: `tests/integration/city-evidence-replay.test.ts`

**Produces:**

```ts
export function replayCityEvidence(input: {
  readonly evidenceSnapshotId: string;
  readonly cityId: string;
  readonly packageId: string;
}, ports: CityEvidenceReplayPorts): Promise<VerifiedCityEvidence>;
```

- [ ] **Step 1: Write closed-input and zero-network REDs**

Descriptor-snapshot the exact three-key input before the first port call. Reject accessors without invocation, symbols, extra/missing keys, prototypes, invalid IDs, and reentrant mutation. Replay a real sealed synthetic bundle twice with every live source/search/request port replaced by throwing counted spies; require canonical equality and zero calls.

- [ ] **Step 2: Write historical/tamper REDs**

Seal under A, install successor B, restart, and require exact A replay. Remove A’s manifest/artifact/default/behavior or mutate package/catalog/plan/claim/blocker/ledger/URL/time/prior-chain/bytes/hash and require fail-closed behavior without B fallback. Prove private byte-copy isolation against a mutating `hashBytes` fake and compile-check that the use case accepts no `sign`, crypto, Infrastructure, or live-source capability.

- [ ] **Step 3: Run RED**

```bash
./node_modules/.bin/vitest run tests/integration/city-evidence-replay.test.ts
```

- [ ] **Step 4: Implement the proof-only Application replay boundary**

Load verified Evidence, derive the exact installed key from its overlay, resolve only the historical exact replay contract, re-run existing inward Catalog/fixed-plan/safety bridge/ledger/value/period reconstructors, and return a fresh frozen verified value. Do not modify composition in this task.

- [ ] **Step 5: Run the complete Knowledge gate**

```bash
./node_modules/.bin/vitest run tests/research/city-knowledge.test.ts \
  tests/research/city-package.test.ts tests/sources/slovenia-city.test.ts \
  tests/integration/city-evidence-store.test.ts tests/integration/city-knowledge-store.test.ts \
  tests/integration/city-evidence-replay.test.ts
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/eslint src/application/replay-city-evidence.ts \
  tests/integration/city-evidence-replay.test.ts
pnpm test
pnpm run lint
pnpm run build
git diff --check
```

- [ ] **Step 6: Commit exact Task 6 paths**

```bash
git add src/application/replay-city-evidence.ts tests/integration/city-evidence-replay.test.ts
git commit -m "feat: replay city evidence"
```

---

## Completion and handoff

This plan is complete only when all six task commits have independent approval, the final full offline
gate passes, current Slovenia is still `not_ready`, and no live/model/network/browser call occurred.
The handoff to VS-4A Core must explicitly say that persistence/replay infrastructure is ready while
official Slovenia Catalog Evidence publication remains pending and no production package is installed.
