# VS-3 Place Frontier Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (\`- [ ]\`) syntax for tracking.

**Goal:** Build the first honest country-frontier slice: correct formal marker colors, freeze a deterministic place ranking, persist Country Knowledge and frontier snapshots, and show the installed-country search as persistent planet history.

**Architecture:** Decision owns pure preference confirmation, place ranking and formal residence verdicts. Research publishes evidence-backed Country Knowledge revisions through the existing VS-2 Evidence path; Application coordinates a frozen CountryFrontier through an injected country verifier; Infrastructure stores two narrow append-only aggregates and adapts the current Slovenia cold start. Experience adds one finite NDJSON flow over the existing globe and truthfully ends with the installed SI-only preliminary result.

**Tech Stack:** Node 24, TypeScript 6.0.3, Next.js 16.3.0, React 19.2.8, SQLite/better-sqlite3 13.0.3, Vitest 4.1.10, Zod 4.4.3, Decimal.js 10.6.0, existing official HTTPS adapters, Evidence HMAC/replay and react-globe.gl presentation.

## Global Constraints

- Marker color answers only formal long-term residence feasibility: green = at least one verified viable route; yellow = no green plus unresolved/incomplete formal evidence; red = current complete applicable catalog and every route verified impossible.
- One failed route, a preference mismatch or a failed city never creates country red.
- Place ranking uses countries, never country-route pairs; route count cannot enter the score.
- Unknown ranking facts use the visible worst-case boundary -1 and remain visible through coverage.
- Ranking order is frozen for the run; Country Knowledge written during the run affects only the next run.
- Automated frontier slots use installed country packages only. Unsupported custom countries remain in the separate cold-start comparator flow.
- Production installed coverage remains SI-only in this slice. Do not create fake packages or remembered facts to manufacture five countries.
- A terminal shortlist contains five distinct green/yellow countries or an honest smaller installed-coverage result; any yellow makes it preliminary.
- Every fact publication requires current official Evidence lineage. Installed navigation is never Evidence.
- Before defense, runtime model/API calls are exactly zero; add no provider SDK, API credential, prompt, model-backed ranker or replacement eval subsystem.
- Reuse the current capture gateway, Slovenia validators, Evidence/dossier stores, finite stream and globe. Add no second research pipeline, crawler, worker, queue, event store, workflow engine, ORM or graph database.
- Add only two tables: country_knowledge_revisions and place_frontier_snapshots. Store PreferenceProfileSnapshot in the existing profile_snapshots table.
- Do not persist stream events. Persist only Country Knowledge revisions and immutable ranking/terminal shortlist snapshots.
- Do not implement city, job, housing, taxes, budget or life simulation in this plan.
- Preserve the unrelated untracked .superpowers/brainstorm/12369-1786346924/ directory.
- Browser permission for the final local walkthrough is already granted for this chat; do not ask the user again.

---

### Task 1: Correct formal residence color semantics

**Requirements:** REQ-PF-02, REQ-PF-04; SCN-PF-02

**Files:**
- Create: src/decision/formal-residence-verdict.ts
- Create: tests/domain/formal-residence-verdict.test.ts
- Modify: src/decision/cold-start-assessment.ts:14-49,256-411
- Modify: src/application/cold-start.ts:67-88
- Modify: src/experience/cold-start-stream.ts:36-119
- Modify: src/experience/cold-start-view-model.ts:34-60,205-247
- Modify: src/experience/components/ColdStartComparator.tsx
- Modify: tests/integration/cold-start.test.ts
- Modify: tests/integration/cold-start-experience.test.tsx

**Interfaces:**
- Consumes: the existing Slovenia route-specific reasons, formula, Evidence Snapshot and dossier projection.
- Produces:

~~~ts
export type FormalMarker = "green" | "yellow" | "red";

export interface FormalEvidenceReference {
  readonly evidenceSnapshotId: string;
  readonly artifactId: string;
  readonly sourceId: string;
  readonly navigationUrl: string;
  readonly resolvedEvidenceUrl: string;
  readonly sourcePeriod: string;
  readonly locator: string;
  readonly excerptSha256: string;
  readonly validatorVersion: string;
}

export interface FormalReason {
  readonly code: string;
  readonly summary: string;
  readonly claimIds: readonly string[];
  readonly evidence: readonly FormalEvidenceReference[];
  readonly navigation: readonly {
    readonly sourceId: string;
    readonly url: string;
    readonly label: string;
  }[];
}

interface ResidenceRouteOutcomeBase {
  readonly routeId: string;
  readonly reasons: readonly FormalReason[];
  readonly evidenceSnapshotIds: readonly string[];
  readonly proceduralActions: readonly {
    readonly kind: "insurance" | "registration" | "document_submission";
    readonly completed: false;
  }[];
  readonly contingentActions: readonly {
    readonly kind: "job_offer" | "admission";
    readonly eligibility: "verified";
    readonly acquired: false;
  }[];
}

export type ResidenceRouteOutcome =
  | (ResidenceRouteOutcomeBase & {
      readonly status: "viable" | "impossible";
      readonly ruleEffectiveFrom: string;
      readonly ruleEffectiveTo?: string;
      readonly evidenceSnapshotIds: readonly [string, ...string[]];
    })
  | (ResidenceRouteOutcomeBase & {
      readonly status: "unknown";
      readonly ruleEffectiveFrom?: string;
      readonly ruleEffectiveTo?: string;
    });

export type CatalogRouteCoverage =
  | {
      readonly routeId: string;
      readonly applicability: "applicable";
      readonly evidence: readonly [FormalEvidenceReference, ...FormalEvidenceReference[]];
    }
  | {
      readonly routeId: string;
      readonly applicability: "excluded";
      readonly exclusionCode: string;
      readonly claimIds: readonly [string, ...string[]];
      readonly evidence: readonly [FormalEvidenceReference, ...FormalEvidenceReference[]];
    };

export interface CatalogCompletenessAttestation {
  readonly catalogRevisionId: string;
  readonly jurisdiction: string;
  readonly authority: string;
  readonly scopeKind: "all_long_term_residence_routes_for_profile";
  readonly profileSnapshotId: string;
  readonly catalogRoutes: readonly [CatalogRouteCoverage, ...CatalogRouteCoverage[]];
  readonly validatorVersion: string;
  readonly effectiveFrom: string;
  readonly effectiveTo?: string;
  readonly evidenceSnapshotId: string;
  readonly catalogEvidence: readonly [FormalEvidenceReference, ...FormalEvidenceReference[]];
}

export interface FormalResidenceVerdict {
  readonly rulesVersion: "formal-residence@1";
  readonly marker: FormalMarker;
  readonly verdictAsOf: string;
  readonly routeOutcomes: readonly ResidenceRouteOutcome[];
  readonly reasons: readonly FormalReason[];
  readonly catalogCompleteness:
    | {
        readonly status: "verified";
        readonly attestation: CatalogCompletenessAttestation;
      }
    | {
        readonly status: "unproven";
        readonly reasonCode: "catalog_completeness_unprovable";
      };
}

export function assessFormalResidence(input: {
  readonly profileSnapshotId: string;
  readonly verdictAsOf: string;
  readonly routes: readonly ResidenceRouteOutcome[];
  readonly completeness?: CatalogCompletenessAttestation;
}): FormalResidenceVerdict;
~~~

- [ ] **Step 1: Write the failing formal-verdict table**

Create tests/domain/formal-residence-verdict.test.ts with exactly these representative rows:

~~~ts
test.each([
  {
    name: "viable route wins over another unknown route",
    routes: [route("dn", "viable"), route("study", "unknown")],
    completeness: undefined,
    marker: "green",
  },
  {
    name: "failed route with unproven catalog stays yellow",
    routes: [route("dn", "impossible")],
    completeness: undefined,
    marker: "yellow",
  },
  {
    name: "unknown route with complete catalog stays yellow",
    routes: [route("dn", "impossible"), route("study", "unknown")],
    completeness: complete(["dn", "study"]),
    marker: "yellow",
  },
  {
    name: "complete effective all-impossible catalog is red",
    routes: [route("dn", "impossible"), route("study", "impossible")],
    completeness: complete(["dn", "study"]),
    marker: "red",
  },
])("$name", ({ routes, completeness, marker }) => {
  expect(assessFormalResidence({
    profileSnapshotId: "profile-1",
    verdictAsOf: "2026-08-12",
    routes,
    ...(completeness === undefined ? {} : { completeness }),
  }).marker).toBe(marker);
});
~~~

Add one red row with a non-empty complete catalog whose every route is evidence-backed excluded and
therefore has zero applicable outcomes: living long-term is proven unavailable. Add fail-closed
assertions for all of these cases: applicable catalog route IDs do not exactly equal
the outcome IDs; a catalog entry is neither uniquely applicable nor evidence-backed excluded;
catalog/profile or Evidence snapshot binding differs; the catalog proof is empty; a verified route
has no Evidence reference/current effective interval; or the attestation interval excludes
verdictAsOf. Every case returns yellow rather than red/green. An unknown route may omit an effective
date because missing current rule evidence is itself the honest unknown.

- [ ] **Step 2: Run the test and confirm RED**

Run:

~~~bash
./node_modules/.bin/vitest run tests/domain/formal-residence-verdict.test.ts
~~~

Expected: FAIL because formal-residence-verdict.ts does not exist.

- [ ] **Step 3: Implement the pure verdict**

Implement strict ISO calendar-day validation, unique route IDs, exact catalog/applicable/excluded
crosswalk, profile binding, non-empty sealed-reference lineage and effective-date intersection.
`CatalogCompletenessAttestation` may only be built by Research after verified Evidence load; Decision
still validates its closed structure. Invalid `viable`/`impossible` proof is normalized to unknown.
The decision order after that normalization must be literal:

~~~ts
if (routes.some((route) => route.status === "viable")) return green;
if (routes.some((route) => route.status === "unknown")) return yellow;
if (!isCurrentExactCompleteness(input)) return yellow;
return routes.every((route) => route.status === "impossible") ? red : yellow;
~~~

Deep-freeze the returned verdict. Do not infer a route, catalog entry, action or date.
Assert `rulesVersion === "formal-residence@1"`; unknown/mutated rule versions fail the strict wire
and stored-snapshot schemas.

- [ ] **Step 4: Write the failing Slovenia projection regressions**

In tests/integration/cold-start.test.ts, change the expected current synthetic result from red to:

~~~ts
expect(readModel.comparator.marker).toBe("yellow");
expect(readModel.comparator.formalVerdict.routeOutcomes).toEqual([
  expect.objectContaining({
    routeId: "si-temporary-residence-digital-nomad",
    status: "impossible",
  }),
]);
expect(readModel.comparator.formalVerdict.catalogCompleteness.status).toBe("unproven");
expect(readModel.comparator.formalVerdict.reasons.map(({ code }) => code)).toContain(
  "catalog_completeness_unprovable",
);
~~~

Add one compatible-profile row asserting:

~~~ts
expect(readModel.comparator.marker).toBe("green");
expect(readModel.comparator.personalFit).toBe("verified_route_available");
expect(readModel.comparator.cityScope).toBe("not_checked");
expect(readModel.comparator.formalVerdict.routeOutcomes[0].proceduralActions).toContainEqual({
  kind: "insurance",
  completed: false,
});
~~~

The compatible fixture must leave health insurance unconfirmed to prove that acquiring insurance is a procedural checklist action, not a false formal unknown. Keep unknown passport, remote-work legality and unavailable FX as separate yellow representatives.

- [ ] **Step 5: Run the integration tests and confirm RED**

Run:

~~~bash
./node_modules/.bin/vitest run tests/integration/cold-start.test.ts tests/integration/cold-start-experience.test.tsx
~~~

Expected: FAIL because ColdStartComparator only permits red/yellow, one blocked route still becomes red and the successful path still emits city_not_checked yellow.

- [ ] **Step 6: Project the current route through the pure verdict**

Change ColdStartComparator to:

~~~ts
export interface ColdStartComparator {
  readonly marker: FormalMarker;
  readonly personalFit:
    | "verified_route_available"
    | "route_blocked_catalog_incomplete"
    | "research_incomplete"
    | "personal_evidence_missing"
    | "all_routes_impossible";
  readonly cityScope: "not_checked";
  readonly formalVerdict: FormalResidenceVerdict;
  readonly formula?: ColdStartFormula;
}
~~~

In assessColdStart, build one route outcome:

- hard vetoes present -> impossible;
- personal formal unknowns present -> unknown;
- neither -> viable;
- unconfirmed insurance -> proceduralActions, not personalUnknowns;
- completeness omitted because the installed Slovenia package proves one route, not the full national long-stay catalog.

Call assessFormalResidence and use its marker. Preserve the income formula and route-specific
Evidence lineage. Add catalog_completeness_unprovable only on no-green impossible/unknown outcomes.
Remove city_not_checked as a marker reason. Derive displayed official links from each
`FormalEvidenceReference.navigationUrl`. Artifactless timeout/deadline reasons instead carry an
explicit `navigation` link labeled “источник для ручной проверки”; this is navigation, never
Evidence or proof. Do not merge the two link kinds or present navigation-only links as verified.

- [ ] **Step 7: Update wire schema and UI copy**

Permit green in the strict read-model schema. ColdStartView.marker becomes pending | green | yellow | red. ColdStartComparator renders:

- green: “Формальный маршрут доступен”, checklist actions and the disclaimer “не гарантирует одобрение и не оценивает город”;
- yellow: exact route/formal unknown and manual-check guidance;
- red: retained for future complete-catalog evidence only.

Do not make green globe markers interactive. Preserve existing red/yellow keyboard behavior and source details.

- [ ] **Step 8: Run Task 1 gates**

Run:

~~~bash
./node_modules/.bin/vitest run tests/domain/formal-residence-verdict.test.ts tests/integration/cold-start.test.ts tests/integration/cold-start-experience.test.tsx
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/eslint .
~~~

Expected: all commands PASS.

- [ ] **Step 9: Review and commit Task 1**

Review only formal-color semantics and legacy VS-1/VS-2 compatibility. Then:

~~~bash
git add src/decision/formal-residence-verdict.ts src/decision/cold-start-assessment.ts src/application/cold-start.ts src/experience/cold-start-stream.ts src/experience/cold-start-view-model.ts src/experience/components/ColdStartComparator.tsx tests/domain/formal-residence-verdict.test.ts tests/integration/cold-start.test.ts tests/integration/cold-start-experience.test.tsx
git commit -m "fix: correct formal residence colors"
~~~

---

### Task 2: Add PreferenceProfile and the pure PlaceRanker

**Requirements:** REQ-PF-01, NFR-PF-03

**Files:**
- Create: src/decision/preference-profile.ts
- Create: src/decision/place-ranker.ts
- Create: src/research/place-package.ts
- Create: src/infrastructure/sources/installed-place-packages.ts
- Create: tests/domain/place-ranker.test.ts
- Modify: src/infrastructure/sqlite/profile-store.ts
- Modify: tests/research/country-source-index.test.ts

**Interfaces:**
- Consumes: CountryRef-like installed place metadata and evidence-backed current factor projections.
- Produces:

~~~ts
export type PlaceCriterionId =
  | "outside_cis"
  | "europe"
  | "personal_safety"
  | "infrastructure"
  | "peace_and_stability";
export type PreferenceMode = "required" | "weighted";
export type Importance = 1 | 2 | 3 | 4 | 5;

export interface PreferenceCriterion {
  readonly id: PlaceCriterionId;
  readonly mode: PreferenceMode;
  readonly importance: Importance;
  readonly target: "required_true" | "maximize";
}

export interface PreferenceProfileDraft {
  readonly criteria: readonly PreferenceCriterion[];
}

export interface PreferenceProfileSnapshot {
  readonly schemaVersion: "preference-profile@1";
  readonly id: string;
  readonly confirmedAt: string;
  readonly criteria: readonly PreferenceCriterion[];
}

export function confirmPreferenceProfile(
  draft: unknown,
  clock: () => Date,
): PreferenceProfileSnapshot;
~~~

~~~ts
export type PlaceFactorState =
  | "known"
  | "missing"
  | "stale"
  | "future"
  | "not_comparable";

export interface PlaceFactorProjection {
  readonly criterionId: PlaceCriterionId;
  readonly state: PlaceFactorState;
  readonly match?: string;
  readonly requirementStatus?: "matches" | "does_not_match";
  readonly observationId?: string;
  readonly evaluatorVersion: string;
}

export interface RankablePlace {
  readonly countryCode: string;
  readonly label: string;
  readonly flag: string;
  readonly coordinate: { readonly lat: number; readonly lng: number };
  readonly factors: readonly PlaceFactorProjection[];
}

export interface RankedPlace extends RankablePlace {
  readonly rank: number;
  readonly relevance: string;
  readonly coverage: string;
  readonly contributions: readonly {
    readonly criterionId: PlaceCriterionId;
    readonly state: PlaceFactorState;
    readonly effectiveMatch: string;
    readonly weightedContribution: string;
    readonly observationId?: string;
  }[];
}

export interface RequiredMismatch {
  readonly countryCode: string;
  readonly criterionId: PlaceCriterionId;
  readonly observationId: string;
}

export interface PlaceRankingResult {
  readonly ordered: readonly RankedPlace[];
  readonly excluded: readonly RequiredMismatch[];
  readonly rulesVersion: "place-ranker@1";
}

export function rankPlaces(input: {
  readonly assessmentAt: string;
  readonly preferences: PreferenceProfileSnapshot;
  readonly places: readonly RankablePlace[];
}): PlaceRankingResult;
~~~

- [ ] **Step 1: Write failing profile and ranker tests**

Create tests/domain/place-ranker.test.ts with four tests:

1. confirmPreferenceProfile rejects duplicate criterion IDs, missing criteria, invalid importance and unknown keys; it canonical-sorts and deep-freezes the snapshot.
2. known factors use Decimal matches in [-1,1], unknown states contribute -1 and zero coverage.
3. a known required factor explicitly marked does_not_match excludes before ordering; an unknown
   required factor remains with conservative -1. Numeric match alone never invents required
   eligibility.
4. order is relevance descending, coverage descending, ISO code; adding or removing route IDs from the outer test fixture cannot alter RankablePlace or output.

Use this exact scoring assertion:

~~~ts
expect(rankPlaces({
  assessmentAt: "2026-08-12",
  preferences,
  places: [
    place("PT", [known("personal_safety", "0.5"), missing("infrastructure")]),
    place("SI", [known("personal_safety", "0.5"), known("infrastructure", "0.2")]),
  ],
}).ordered.map(({ countryCode, relevance, coverage }) => ({
  countryCode,
  relevance,
  coverage,
}))).toEqual([
  { countryCode: "SI", relevance: "0.35", coverage: "1" },
  { countryCode: "PT", relevance: "-0.25", coverage: "0.5" },
]);
~~~

Use two equally weighted criteria in this fixture.

- [ ] **Step 2: Run the tests and confirm RED**

Run:

~~~bash
./node_modules/.bin/vitest run tests/domain/place-ranker.test.ts
~~~

Expected: FAIL because the modules do not exist.

- [ ] **Step 3: Implement canonical preference confirmation**

Use a strict Zod schema, the fixed criterion order above, SHA-256 of canonical JSON and recursive freezing. Do not accept free text, arbitrary criterion IDs or a provider-produced profile.

Add appendPreference and loadPreferenceVerified to SqliteProfileStore. Reuse profile_snapshots; verify schemaVersion, canonical bytes and snapshot hash exactly as relocation profiles do.

- [ ] **Step 4: Implement the pure ranker**

For each criterion:

~~~ts
const effectiveMatch = factor.state === "known"
  ? new Decimal(factor.match)
  : new Decimal(-1);
const contribution = effectiveMatch.mul(criterion.importance);
~~~

Reject a known match outside [-1,1], duplicate/missing factor rows, invalid dates and known rows
without observationId. A known required factor must carry an explicit requirementStatus; exclusion
applies only to does_not_match. Weighted factors must not carry this field. Coverage numerator
includes only known factors. Return Decimal text without binary floating-point arithmetic and
deep-freeze the result.

- [ ] **Step 5: Add the narrow installed place-package boundary**

In src/research/place-package.ts define:

~~~ts
export interface InstalledPlacePackage {
  readonly countryCode: string;
  readonly label: string;
  readonly flag: string;
  readonly coordinate: { readonly lat: number; readonly lng: number };
  readonly supportedCriteria: readonly PlaceCriterionId[];
  readonly routeCatalog: {
    readonly revisionId: string;
    readonly routeIds: readonly string[];
    readonly completeness: "unproven";
  };
}

export interface InstalledPlacePackagePort {
  list(): readonly InstalledPlacePackage[];
}
~~~

createInstalledPlacePackages() returns exactly SI with route ID
si-temporary-residence-digital-nomad, completeness unproven and `supportedCriteria: []`: no approved
place-factor source exists yet. Task 4 creates an explicit `missing` factor row for every confirmed
criterion. The package contains no fact values, thresholds, source bytes or profile data. Keep
CountrySourceIndexPort.lookup unchanged.

- [ ] **Step 6: Run Task 2 gates**

Run:

~~~bash
./node_modules/.bin/vitest run tests/domain/place-ranker.test.ts tests/research/country-source-index.test.ts
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/eslint .
~~~

Expected: all commands PASS.

- [ ] **Step 7: Review and commit Task 2**

Review that no ResidenceRoute or route count enters rankPlaces. Then:

~~~bash
git add src/decision/preference-profile.ts src/decision/place-ranker.ts src/research/place-package.ts src/infrastructure/sources/installed-place-packages.ts src/infrastructure/sqlite/profile-store.ts tests/domain/place-ranker.test.ts tests/research/country-source-index.test.ts
git commit -m "feat: rank installed places deterministically"
~~~

---

### Task 3: Publish append-only Country Knowledge revisions

**Requirements:** REQ-PF-05, REQ-PF-06; SCN-PF-04

**Files:**
- Create: src/research/country-knowledge.ts
- Create: src/infrastructure/sqlite/country-knowledge-store.ts
- Create: tests/integration/country-knowledge.test.ts
- Modify: src/infrastructure/sqlite/schema.sql
- Modify: src/infrastructure/sqlite/db.ts
- Modify: src/infrastructure/sqlite/evidence-store.ts
- Modify: src/application/cold-start.ts
- Modify: src/infrastructure/cold-start-composition.ts
- Modify: tests/integration/database-schema.test.ts
- Modify: tests/integration/cold-start.test.ts

**Interfaces:**
- Consumes: sealed current ColdStartEvidenceClaim values, Evidence blockers, parser/validator versions and exact Evidence references.
- Produces a closed current-country schema, not arbitrary JSON:

~~~ts
export interface FormalKnowledgeReference {
  readonly claimId: string;
  readonly claimKind: ClaimKind;
  readonly definitionId: string;
  readonly evidenceSnapshotId: string;
}

export interface KnowledgeStatusObservation {
  readonly kind: "source_status";
  readonly observationId: string;
  readonly sourceId: SloveniaSourceId;
  readonly status: "superseded" | "expired" | "unresolved";
  readonly affectedClaimKinds: readonly ClaimKind[];
  readonly supersedesObservationId?: string;
  readonly evidenceSnapshotId: string;
  readonly artifactIds: readonly string[];
  readonly definitionId: string;
  readonly capturedAt: string;
  readonly publishedAt?: string;
  readonly referencePeriod?: string;
  readonly effectiveFrom?: string;
  readonly effectiveTo?: string;
  readonly verifiedAt: string;
}

export interface SloveniaCountryKnowledgeRevision {
  readonly schemaVersion: "country-knowledge@1";
  readonly packageId: "SI";
  readonly observationSchemaVersion: "si-knowledge@1";
  readonly id: string;
  readonly countryCode: "SI";
  readonly predecessorId?: string;
  readonly triggerEvidenceSnapshotId: string;
  readonly formalClaimRefs: readonly FormalKnowledgeReference[];
  readonly statusObservations: readonly KnowledgeStatusObservation[];
  readonly createdAt: string;
}

export type InstalledCountryKnowledgeRevision = SloveniaCountryKnowledgeRevision;

export interface KnowledgeEvidenceEntry {
  readonly sourceId: SloveniaSourceId;
  readonly navigationUrl: string;
  readonly indexedSourceUrl?: string;
  readonly resolvedEvidenceUrl: string;
  readonly artifactIds: readonly string[];
  readonly versionHint?: string;
}

export interface VerifiedCountryEvidenceInput {
  readonly snapshot: EvidenceSnapshot<SloveniaSourceId, ColdStartEvidenceClaim>;
  readonly entries: readonly KnowledgeEvidenceEntry[];
  readonly artifacts: readonly EvidenceArtifactProvenance<SloveniaSourceId>[];
}

export function buildSloveniaKnowledgeRevision(input: {
  readonly evidence: VerifiedCountryEvidenceInput;
  readonly predecessor?: SloveniaCountryKnowledgeRevision;
  readonly createdAt: string;
}): SloveniaCountryKnowledgeRevision | undefined;

~~~

The store contract is:

~~~ts
export interface CountryKnowledgeStore {
  publish(revision: InstalledCountryKnowledgeRevision): InstalledCountryKnowledgeRevision;
  latest(countryCode: string): InstalledCountryKnowledgeRevision | undefined;
  loadVerified(id: string): InstalledCountryKnowledgeRevision;
}
~~~

Each revision is a complete current Knowledge snapshot, not a delta. `formalClaimRefs` point to the
typed values and full source metadata already sealed in Evidence; values/raw bytes are not copied.
A successor carries forward unaffected current refs, replaces changed/revalidated refs and records
an evidence-backed mask only when that affected kind has no verified replacement in the same
revision. Therefore `latest` alone is sufficient for current Knowledge
read, while predecessor verification preserves history.

This slice deliberately stores no derived place `match`: current Slovenia Evidence has no approved
place-factor facts, so Task 4 supplies `missing` for every preference criterion. The first future
place-factor source package must add typed official factual observations in Research and a separate
Decision evaluator; only its `PlaceFactorProjection`/evaluator version belongs in RankingSnapshot.

- [ ] **Step 1: Write the failing schema/store/publication tests**

Create tests/integration/country-knowledge.test.ts with one compact table:

~~~ts
test.each([
  ["full verified", verifiedEvidence(), true],
  ["partial verified plus artifact-backed semantic mismatch", partialEvidence(), true],
  ["timeout without artifacts", timeoutEvidence(), false],
  ["deadline without artifacts", deadlineEvidence(), false],
])("%s", (_, evidence, publishes) => {
  const revision = buildSloveniaKnowledgeRevision({
    evidence,
    createdAt: "2026-08-12T12:00:00.000Z",
  });
  expect(revision !== undefined).toBe(publishes);
});
~~~

Also assert:

- a repeated verified value from a new Evidence snapshot creates a successor revalidation revision;
- a partial successor keeps unaffected current refs and a changed value replaces only its old ref;
- expired/unresolved/superseded status replaces the affected formal ref in the full current snapshot,
  while an unrelated ref survives unchanged;
- update/delete triggers reject mutation;
- payload/hash/HMAC/predecessor/evidence-reference tampering returns integrity_mismatch;
- latest is deterministic and concurrent publication uses an immediate transaction.

In database-schema.test.ts expect exactly the two new country_knowledge_revisions indexes and two immutable triggers defined below.

- [ ] **Step 2: Run focused tests and confirm RED**

Run:

~~~bash
./node_modules/.bin/vitest run tests/integration/country-knowledge.test.ts tests/integration/database-schema.test.ts
~~~

Expected: FAIL because the table, builder and store do not exist.

- [ ] **Step 3: Add the append-only table**

Add:

~~~sql
CREATE TABLE IF NOT EXISTS country_knowledge_revisions (
  id TEXT PRIMARY KEY,
  country_code TEXT NOT NULL CHECK (
    length(country_code) = 2
    AND country_code = upper(country_code)
    AND country_code GLOB '[A-Z][A-Z]'
  ),
  predecessor_id TEXT REFERENCES country_knowledge_revisions(id),
  trigger_evidence_snapshot_id TEXT NOT NULL REFERENCES evidence_snapshots(id),
  schema_version TEXT NOT NULL CHECK (schema_version = 'country-knowledge@1'),
  payload_json TEXT NOT NULL,
  payload_hash TEXT NOT NULL CHECK (length(payload_hash) = 64),
  hmac TEXT NOT NULL CHECK (length(hmac) = 64),
  created_at TEXT NOT NULL,
  CHECK (predecessor_id IS NULL OR predecessor_id <> id),
  UNIQUE (country_code, trigger_evidence_snapshot_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS country_knowledge_one_root
ON country_knowledge_revisions (country_code)
WHERE predecessor_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS country_knowledge_one_successor
ON country_knowledge_revisions (predecessor_id)
WHERE predecessor_id IS NOT NULL;
~~~

Add the update- and delete-rejection triggers using message
`country_knowledge_revision_is_immutable`.

- [ ] **Step 4: Implement the typed builder**

Map every verified country claim to a compact FormalKnowledgeReference; resolve its typed value,
definition, period, effective dates, captures and source anchors only through verified Evidence. The
current Slovenia mapper emits no place-fit observation because VS-2 validates no such fact;
rankPlaces therefore sees those criteria as missing honestly. Map stale to expired
and semantic_mismatch/conflict with at least one artifact ID to unresolved. A successor is a full
current snapshot: changed values replace their refs without a mask (the predecessor preserves
history); unchanged values point to the new revalidation Evidence; unaffected refs carry forward.
A status mask is emitted only when there is no verified replacement for the affected kind. Do not publish capture
timeout, deadline, rate-limit or server failure without artifacts. Do not copy claim values or raw
artifact bytes into Knowledge.

Use source-specific affectedClaimKinds from the installed Slovenia plan; do not infer claim kinds
from error text. Canonicalize refs/statuses by claim kind/source ID before hashing and freeze the
revision. Do not add an unused generic factual schema or a Research-owned match evaluator.

- [ ] **Step 5: Implement the verified SQLite store**

Extend the existing verified Evidence loader with one narrow `loadVerifiedCountryEvidence` result:
snapshot, entries and the already verified manifest artifact provenance; never expose raw bytes in
the Knowledge input. Follow SqliteDossierStore patterns: canonical payload, SHA-256, HMAC, constant-time verification,
predecessor chain validation and database.transaction(...).immediate(). The table/envelope are ISO
country-generic; the installed discriminated decoder is currently SI-only, so a second package adds
a decoder variant without a core table migration. publish/loadVerified must load every Evidence
snapshot referenced by formal/ranking/status rows, verify exact claim/anchor ownership, and reject a
successor that silently drops an unaffected current observation. A native TypeError must never leak
for malformed storage.

- [ ] **Step 6: Wire publication into the existing cold start**

Add a knowledge port to ColdStartApplicationPorts:

~~~ts
readonly knowledge: {
  publishCurrent(input: {
    readonly evidenceSnapshotId: string;
    readonly lastCheckedAt: string;
  }): Promise<{
    readonly publishedRevision?: InstalledCountryKnowledgeRevision;
    readonly currentRevision?: InstalledCountryKnowledgeRevision;
  }>;
  latest(countryCode: string): Promise<InstalledCountryKnowledgeRevision | undefined>;
};
~~~

After Evidence is sealed/published and verified, publish current knowledge. Add this read-model metadata:

~~~ts
readonly knowledge: {
  readonly rankingRevisionId?: string;
  readonly currentRevisionId?: string;
  readonly updatedRevisionId?: string;
  readonly lastCheckedAt: string; // strict YYYY-MM-DD from sealed Evidence assessmentDate
  readonly knowledgeUpdatedAt?: string;
};
~~~

The manual VS-2 flow has no ranking revision, so rankingRevisionId is absent. `updatedRevisionId`
exists when this check publishes either the first root or a successor. `currentRevisionId` and `knowledgeUpdatedAt`
always identify the latest verified revision after the attempt, including a pre-existing revision
when this run has no new evidence. They are absent only when the country has never had a Knowledge
revision. lastCheckedAt always equals this completed check assessment date and is not stored inside a
Knowledge revision.

Set `lastCheckedAt` to the verified sealed Evidence `assessmentDate` (`YYYY-MM-DD`) for both full and
unavailable snapshots. Do not call a new clock, fabricate midnight or add run-completion storage.

- [ ] **Step 7: Run Task 3 gates**

Run:

~~~bash
./node_modules/.bin/vitest run tests/integration/country-knowledge.test.ts tests/integration/database-schema.test.ts tests/integration/cold-start.test.ts
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/eslint .
~~~

Expected: all commands PASS.

- [ ] **Step 8: Review and commit Task 3**

Review transactionality, typed values, evidence ownership and no-byte duplication. Then:

~~~bash
git add src/research/country-knowledge.ts src/infrastructure/sqlite/country-knowledge-store.ts src/infrastructure/sqlite/evidence-store.ts src/infrastructure/sqlite/schema.sql src/infrastructure/sqlite/db.ts src/application/cold-start.ts src/infrastructure/cold-start-composition.ts tests/integration/country-knowledge.test.ts tests/integration/database-schema.test.ts tests/integration/cold-start.test.ts
git commit -m "feat: publish country knowledge revisions"
~~~

---

### Task 4: Build the frozen CountryFrontier and snapshot store

**Requirements:** REQ-PF-01, REQ-PF-03, REQ-PF-06; SCN-PF-01, SCN-PF-03, SCN-PF-05

**Files:**
- Create: src/application/place-frontier.ts
- Create: src/infrastructure/place-frontier-composition.ts
- Create: src/infrastructure/sqlite/place-frontier-store.ts
- Create: tests/integration/place-frontier.test.ts
- Modify: src/infrastructure/sqlite/schema.sql
- Modify: src/application/cold-start.ts
- Modify: src/infrastructure/composition-root.ts
- Modify: tests/integration/database-schema.test.ts

**Interfaces:**
- Consumes: confirmed relocation/preference profiles, installed place packages, current Knowledge factor projections, rankPlaces and the current Slovenia cold-start application.
- Produces:

~~~ts
export interface PlaceFrontierApplication {
  preparePlaceFrontier(input:
    | {
        readonly profile: RelocationProfileDraft;
        readonly preferences: PreferenceProfileDraft;
      }
    | {
        readonly profileId: string;
        readonly preferenceProfileId: string;
      }
  ): Promise<PlaceFrontierPrepared>;

  runPlaceFrontier(
    prepared: PlaceFrontierPrepared,
    emit: (event: PlaceFrontierEvent) => void | Promise<void>,
    signal: AbortSignal,
  ): Promise<PlaceFrontierReadModel>;

  presentPlaceFrontier(runId: string): Promise<PlaceFrontierReadModel>;
}
~~~

`preparePlaceFrontier` confirms or loads both profile snapshots, loads the current verified
Knowledge revisions, calls `rankPlaces` exactly once and atomically appends the immutable
`RankingSnapshot` before returning `PlaceFrontierPrepared`. A prepared run whose stream is never
started may therefore have a ranking row and no shortlist row; that is valid incomplete history.
`runPlaceFrontier` only loads and verifies that ranking row and never ranks again.
`contextHash` is SHA-256 of canonical `{runId, profileId, preferenceProfileId, assessmentAt,
rankingSnapshotId}` and must equal the value stored inside the HMAC-protected ranking payload.

`presentPlaceFrontier` starts from the verified shortlist row, follows its exact ranking reference,
loads the referenced profile/preference snapshots and every referenced Knowledge/Evidence row, and
rejects any run/profile/reference mismatch before constructing the read model. It performs no
ranking, source capture or current-Knowledge lookup.

~~~ts
export interface PlaceFrontierPrepared {
  readonly runId: string;
  readonly profileId: string;
  readonly preferenceProfileId: string;
  readonly assessmentAt: string;
  readonly rankingSnapshotId: string;
  readonly contextHash: string;
}

export interface FrontierCountry {
  readonly countryCode: string;
  readonly label: string;
  readonly flag: string;
  readonly coordinate: { readonly lat: number; readonly lng: number };
}

export interface FrontierMarker {
  readonly country: FrontierCountry;
  readonly rank: number;
  readonly countryCheckRunId: string;
  readonly sourceAssessmentRulesVersion: string;
  readonly lastCheckedAt: string; // strict YYYY-MM-DD
  readonly evidenceSnapshotId: string;
  readonly currentKnowledgeRevisionId?: string;
  readonly updatedKnowledgeRevisionId?: string;
  readonly knowledgeUpdatedAt?: string;
  readonly formalVerdict: FormalResidenceVerdict;
}

export interface PlaceFrontierReadModel {
  readonly runId: string;
  readonly assessmentAt: string;
  readonly rankingSnapshot: RankingSnapshot;
  readonly shortlistSnapshot: ShortlistSnapshot;
}
~~~

Terminal markers come only from `shortlistSnapshot.markers`. Installed coverage is the exact key
set of `rankingSnapshot.knowledgeRevisionIds`; eligible frontier size is `ordered.length`, with
required mismatches in `excluded`. Preliminary is derived from the terminal summary as yellow > 0
or countries.length < 5.
None of these values is persisted twice.

~~~ts
export interface CountryVerifierPort {
  check(input: {
    readonly country: RankablePlace;
    readonly profileId: string;
    readonly parentRunId: string;
    readonly emitProgress: (
      progress: Exclude<ColdStartEvent, { readonly type: "assessment_completed" }>,
    ) => void | Promise<void>;
    readonly signal: AbortSignal;
  }): Promise<{
    readonly countryCheckRunId: string;
    readonly sourceAssessmentRulesVersion: string;
    readonly verdict: FormalResidenceVerdict;
    readonly evidenceSnapshotId: string;
    readonly currentKnowledgeRevisionId?: string;
    readonly updatedKnowledgeRevisionId?: string;
    readonly knowledgeUpdatedAt?: string;
    readonly lastCheckedAt: string;
  }>;

  present(input: {
    readonly parentRunId: string;
    readonly countryCode: string;
    readonly countryCheckRunId: string;
    readonly profileId: string;
  }): Promise<{
    readonly sourceAssessmentRulesVersion: string;
    readonly verdict: FormalResidenceVerdict;
    readonly evidenceSnapshotId: string;
    readonly currentKnowledgeRevisionId?: string;
    readonly updatedKnowledgeRevisionId?: string;
    readonly knowledgeUpdatedAt?: string;
    readonly lastCheckedAt: string;
  }>;
}
~~~

~~~ts
export interface RankingSnapshot {
  readonly schemaVersion: "place-ranking@1";
  readonly id: string;
  readonly runId: string;
  readonly profileSnapshotId: string;
  readonly preferenceProfileSnapshotId: string;
  readonly assessmentAt: string;
  readonly contextHash: string;
  readonly knowledgeRevisionIds: Readonly<Record<string, string | null>>;
  readonly ordered: readonly RankedPlace[];
  readonly excluded: readonly RequiredMismatch[];
  readonly rulesVersion: "place-ranker@1";
  readonly createdAt: string;
}

export interface ShortlistSnapshot {
  readonly schemaVersion: "place-shortlist@1";
  readonly id: string;
  readonly runId: string;
  readonly rankingSnapshotId: string;
  readonly markers: readonly FrontierMarker[];
  readonly rulesVersion: "country-frontier@1";
  readonly createdAt: string;
}
~~~

`countries`, green/yellow composition and stop condition are not persisted twice. A pure terminal
projection derives them from markers plus frozen ranking: the non-red marker codes, exact color
counts, and `five_non_red` when count is five or `installed_coverage_exhausted` when markers exhaust
ordered countries.

Task 4 also owns the domain event union later consumed unchanged by the HTTP adapter:

~~~ts
export interface FrontierEventBase<T extends string, P> {
  readonly runId: string;
  readonly sequence: number;
  readonly occurredAt: string;
  readonly type: T;
  readonly payload: P;
}

export type PlaceFrontierEvent =
  | FrontierEventBase<"ranking_sealed", {
      readonly rankingSnapshotId: string;
      readonly orderedCountryCodes: readonly string[];
      readonly excludedCountryCodes: readonly string[];
    }>
  | FrontierEventBase<"country_activated", {
      readonly country: FrontierCountry;
      readonly rank: number;
    }>
  | FrontierEventBase<"country_progress", {
      readonly countryCode: string;
      readonly stage:
        | "source_discovered"
        | "authority_verified"
        | "artifact_captured"
        | "claim_verified"
        | "dossier_published";
      readonly label: string;
      readonly detail?: string;
      readonly sourceUrl?: string;
    }>
  | FrontierEventBase<"country_completed", {
      readonly marker: FrontierMarker;
    }>
  | FrontierEventBase<"frontier_completed", {
      readonly readModel: PlaceFrontierReadModel;
    }>;
~~~

- [ ] **Step 1: Write the failing frontier fixture**

Create tests/integration/place-frontier.test.ts. Use six synthetic RankablePlace rows only at the injected port boundary; do not add them to production installed packages.

~~~ts
const result = await harness({
  rankedCountries: ["DE", "ES", "FR", "IT", "PT", "SI"],
  verdicts: {
    DE: viableVerdict("DE"),
    ES: completeAllImpossibleVerdict("ES"),
    FR: unresolvedVerdict("FR"),
    IT: viableVerdict("IT"),
    PT: viableVerdict("PT"),
    SI: viableVerdict("SI"),
  },
}).run();

expect(projectTerminalSummary(result).countries).toEqual(["DE", "FR", "IT", "PT", "SI"]);
expect(projectTerminalSummary(result).composition).toEqual({ green: 4, yellow: 1 });
expect(projectTerminalSummary(result).stopCondition).toBe("five_non_red");
expect(result.shortlistSnapshot.markers.map(({ country, formalVerdict }) => [
  country.countryCode,
  formalVerdict.marker,
])).toEqual([
  ["DE", "green"],
  ["ES", "red"],
  ["FR", "yellow"],
  ["IT", "green"],
  ["PT", "green"],
  ["SI", "green"],
]);
~~~

Add three bounded tests:

- SI-only installed coverage ends installed_coverage_exhausted with at most one non-red; Task 5
  derives preliminary from that snapshot rather than persisting a flag;
- a Knowledge revision published during country check does not change RankingSnapshot.ordered;
- verifier/storage/integrity failure creates no shortlist row and presentPlaceFrontier fails closed.

Add one table-driven tamper test for each referenced row family: relocation profile, preference
profile, ranking Knowledge revision, marker Evidence snapshot, current/updated Knowledge revision,
child cold-start run and completeness Evidence reference. Re-signing only the outer frontier payload
must still make `presentPlaceFrontier` fail with `integrity_mismatch`; no verifier network method is
called. Include separate mutations for `formalVerdict.rulesVersion` and marker
`sourceAssessmentRulesVersion`; the latter must equal the replayed child
`assessmentRulesVersion`.

`RankingSnapshot.knowledgeRevisionIds` is the only persisted ranking-Knowledge mapping. Its keys
must exactly cover ordered plus excluded countries, every non-null loaded revision must own that
country code, and cards/markers derive the ranking revision from this map rather than copying it.

`countryCheckRunId` is deterministic:
`"frontier-country:" + sha256(canonicalJson({parentRunId, countryCode}))`. Swapping a valid child
run from another parent must fail even when profile/country are equal.

Assert each country is checked once, initial activation contains min(5, ordered.length), red activates the next row, and unsupported packages are absent before verification.

- [ ] **Step 2: Run focused tests and confirm RED**

Run:

~~~bash
./node_modules/.bin/vitest run tests/integration/place-frontier.test.ts tests/integration/database-schema.test.ts
~~~

Expected: FAIL because the application and snapshot table do not exist.

- [ ] **Step 3: Add the narrow snapshot table**

Add:

~~~sql
CREATE TABLE IF NOT EXISTS place_frontier_snapshots (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('ranking', 'shortlist')),
  schema_version TEXT NOT NULL CHECK (
    schema_version IN ('place-ranking@1', 'place-shortlist@1')
  ),
  payload_json TEXT NOT NULL,
  payload_hash TEXT NOT NULL CHECK (length(payload_hash) = 64),
  hmac TEXT NOT NULL CHECK (length(hmac) = 64),
  created_at TEXT NOT NULL,
  UNIQUE (run_id, kind)
);
~~~

Use the declared `UNIQUE (run_id, kind)` as the lookup index and add only immutable update/delete
triggers. Do not add a redundant index, run table or event table.

- [ ] **Step 4: Implement SqlitePlaceFrontierStore**

Expose appendRanking, appendShortlist, loadRankingVerified and loadShortlistVerified. Verify closed
schema, canonical payload/hash/HMAC, ID, run/kind/schema/contextHash relationship and
shortlist.rankingSnapshotId. appendShortlist must fail unless the referenced verified ranking row
already exists. Storage verifies its own aggregate; Application `presentPlaceFrontier` additionally
loads and verifies every cross-aggregate reference listed above.

The shortlist structural validator requires unique marker countries/ranks in the exact checked
prefix of `ranking.ordered`, full verdict/reference integrity, and one terminal predicate: either
exactly five non-red markers or every ordered country checked. A table-driven test mutates order,
rank, duplicates, premature termination and rulesVersion; append/load fail closed.

- [ ] **Step 5: Implement CountryFrontier orchestration**

The algorithm is exactly:

~~~ts
const activated = ordered.slice(0, 5);
let checkIndex = 0;
let nextIndex = activated.length;
emit ranking_sealed;
emit one country_activated for each activated country;

while (checkIndex < activated.length) {
  const country = activated[checkIndex++];
  const checked = await verifier.check(...);
  append marker without removing earlier markers;
  if (checked.verdict.marker === "red" && nextIndex < ordered.length) {
    const replacement = ordered[nextIndex++];
    activated.push(replacement);
    emit country_activated for replacement;
  }
  if (nonRed.length === 5) break;
}

publish shortlist only when five non-red exist or checked markers exhaust ordered;
~~~

Verify the prepared run/profile/preference/context before any country check. Load the
RankingSnapshot already persisted by prepare and never call rankPlaces inside runPlaceFrontier. On
abort or unexpected error, do not append shortlist. Store the complete immutable
`FormalResidenceVerdict` in each marker; `marker` color, summaries and official links are projections
of that proof and are never separately persisted.

- [ ] **Step 6: Adapt the existing Slovenia cold start**

In createPlaceFrontierComposition, CountryVerifierPort.check must call the existing
ColdStartApplication:

1. derive the expected child ID from parentRunId/countryCode and call a narrow internal
   `prepareColdStartWithRunId` that shares the existing prepare core; the public custom-country HTTP
   request cannot supply a run ID;
2. prepare “Словения” with the existing profileId and that child ID;
3. run with the same AbortSignal;
4. forward only actual non-terminal cold-start events as typed country progress;
5. map the terminal comparator.formalVerdict directly and copy the child
   `assessmentRulesVersion` as `sourceAssessmentRulesVersion`;
6. return the child cold-start run ID plus Evidence and current/updated Knowledge revision IDs from
   the read model; `lastCheckedAt` is exactly `readModel.knowledge.lastCheckedAt` and the verified
   Evidence assessment date.

The adapter `present` first recomputes the child ID from parent run/country, then calls the existing
zero-network cold-start presenter with that ID and exact parent profile ID.
`presentPlaceFrontier` canonical-compares that replayed verdict,
Evidence ID, Knowledge IDs and lastCheckedAt to the marker. Swapping a valid child run from another
profile/frontier must fail closed.

Do not duplicate Slovenia capture, validation, sealing, dossier or replay code.

Add uniquely named methods to composition-root so object spread cannot collide:

~~~ts
preparePlaceFrontier
runPlaceFrontier
presentPlaceFrontier
~~~

- [ ] **Step 7: Run Task 4 gates**

Run:

~~~bash
./node_modules/.bin/vitest run tests/integration/place-frontier.test.ts tests/integration/database-schema.test.ts tests/integration/cold-start.test.ts
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/eslint .
~~~

Expected: all commands PASS.

- [ ] **Step 8: Review and commit Task 4**

Review frozen order, one-country production honesty, failure atomicity and absence of a second pipeline. Then:

~~~bash
git add src/application/place-frontier.ts src/application/cold-start.ts src/infrastructure/place-frontier-composition.ts src/infrastructure/sqlite/place-frontier-store.ts src/infrastructure/sqlite/schema.sql src/infrastructure/composition-root.ts tests/integration/place-frontier.test.ts tests/integration/database-schema.test.ts
git commit -m "feat: add frozen country frontier"
~~~

---

### Task 5: Add the finite frontier protocol and pure projection

**Requirements:** REQ-PF-03, REQ-PF-04, REQ-PF-06; SCN-PF-01, SCN-PF-03, SCN-PF-05

**Files:**
- Create: src/app/api/place-frontier/route.ts
- Create: src/experience/finite-ndjson.ts
- Create: src/experience/place-frontier-stream.ts
- Create: src/experience/place-frontier-view-model.ts
- Create: tests/integration/place-frontier-transport.test.ts
- Modify: src/experience/cold-start-stream.ts
- Modify: tests/integration/cold-start-experience.test.tsx

**Interfaces:**
- Consumes: the Task 4 `PlaceFrontierEvent`, `PlaceFrontierReadModel` and existing
  `WorkspaceGlobePresentation`.
- Produces one strict finite protocol. Every envelope includes `runId`, `sequence`, `occurredAt` and
  `type`. A normally closed stream has exactly one final `frontier_completed`; an errored/cancelled
  stream has none.

- [ ] **Step 1: Write failing protocol/projection tests**

Create tests/integration/place-frontier-transport.test.ts with a finite chunk-split stream. Assert:

- no event means no fabricated marker or progress;
- country_activated adds a gray marker and flight;
- country_completed changes only that marker and replacement activation preserves all earlier rows;
- terminal projection keeps every route, exact composition and complete formal verdicts;
- reload projection has the same markers/cards data with an empty live timeline;
- terminal line followed by stream error or trailing data never yields the terminal read model.

For a client transport/decoder error, the current screen retains only received session state and no
terminal cards. The test may then call `presentPlaceFrontier`: if the server committed before the
client failure, reload recovers that verified snapshot; if it did not, present fails closed. No
client ACK or rollback protocol is added.

Also cover fatal UTF-8, line size excluding LF, split JSON/final flush, wrong run/sequence,
request/cancel propagation and reader release. Use a six-country synthetic wire fixture only here and
one production SI-only read-model row.

- [ ] **Step 2: Run the test and confirm RED**

Run:

~~~bash
./node_modules/.bin/vitest run tests/integration/place-frontier-transport.test.ts
~~~

Expected: FAIL because the route, shared reader, decoder and view model do not exist.

- [ ] **Step 3: Implement the strict route and decoder**

The POST body uses a strict top-level discriminated union while Decision remains the owner of both
nested confirmations:

~~~ts
const requestSchema = z.union([
  z.object({ profile: z.unknown(), preferences: z.unknown() }).strict(),
  z.object({
    profileId: z.string().min(1),
    preferenceProfileId: z.string().min(1),
  }).strict(),
]);
~~~

Validate before opening the stream. Return application/problem+json for expected input errors,
generic 500 for unexpected prepare errors. Use Node runtime, application/x-ndjson,
no-store/no-transform and nosniff. Link Request.signal and ReadableStream.cancel to one
AbortController. Start the pump without awaiting it.

Extract only `readFiniteNdjson` from the cold-start decoder: it owns fatal UTF-8, 256 KiB maximum
line excluding LF, split lines/final flush and cancel/release. Both protocol decoders retain their
own strict event schemas, run/sequence rules and terminal-held-until-clean-EOF behavior. Do not add a
generic event bus, reducer framework or retry layer.

- [ ] **Step 4: Implement the pure multi-marker view model**

State is running | completed | transportError. Reduce only received events. Keep a map/list of every activated country in first-seen order; completed changes only that marker. activeFlight is the latest activated route. terminal changes globeMode from full to collapsed without unmounting the globe.

Project card fields from the read model only:

- complete formal verdict, route outcomes, completeness proof and checklist/contingent actions;
- ranking factor contributions and coverage;
- ranking Knowledge revision ID derived from RankingSnapshot.knowledgeRevisionIds;
- current-run updated revision ID;
- lastCheckedAt and knowledgeUpdatedAt;
- exact composition and stop condition.

UI must not compute verdict, score, coverage or dates.

- [ ] **Step 5: Run Task 5 gates and commit**

Run:

~~~bash
./node_modules/.bin/vitest run tests/integration/place-frontier-transport.test.ts tests/integration/cold-start-experience.test.tsx
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/eslint .
~~~

Review finite framing, cancellation, terminal truth and pure projection. Then commit only the listed
files:

~~~bash
git add src/app/api/place-frontier/route.ts src/experience/finite-ndjson.ts src/experience/place-frontier-stream.ts src/experience/place-frontier-view-model.ts src/experience/cold-start-stream.ts tests/integration/place-frontier-transport.test.ts tests/integration/cold-start-experience.test.tsx
git commit -m "feat: stream place frontier protocol"
~~~

---

### Task 6: Present persistent planet history and terminal country cards

**Requirements:** REQ-PF-03, REQ-PF-04, REQ-PF-06; SCN-PF-01, SCN-PF-03, SCN-PF-05

**Files:**
- Create: src/experience/components/PlaceFrontierStart.tsx
- Create: src/experience/components/PlaceFrontierJourney.tsx
- Create: tests/integration/place-frontier-experience.test.tsx
- Modify: src/app/page.tsx
- Modify: src/experience/run-url.ts
- Modify: src/experience/components/ResearchWorkspace.tsx
- Modify: src/experience/research-map/contracts.ts
- Modify: src/experience/research-map/ResearchGlobeCanvas.tsx
- Modify: src/app/globals.css
- Modify: tests/integration/research-globe-canvas.test.tsx
- Modify: tests/integration/product-shell.test.tsx

- [ ] **Step 1: Write the failing journey test**

Use already-decoded states/read models. Assert red persistence and replacement, green
non-interactivity, yellow keyboard detail/manual guidance, terminal collapse with every marker,
preliminary wording for yellow or fewer than five, transport alert without cards, and stored reload
with no fabricated timeline. Run the file and confirm RED because the components/frontier scope do
not exist.

- [ ] **Step 2: Implement setup and journey**

PlaceFrontierStart does not ask for a country. It confirms the canonical relocation profile and these editable structured defaults:

~~~ts
[
  { id: "outside_cis", mode: "required", importance: 5, target: "required_true" },
  { id: "europe", mode: "weighted", importance: 4, target: "required_true" },
  { id: "personal_safety", mode: "weighted", importance: 5, target: "maximize" },
  { id: "infrastructure", mode: "weighted", importance: 5, target: "maximize" },
  { id: "peace_and_stability", mode: "weighted", importance: 5, target: "maximize" },
]
~~~

The confirmation copy says ranking is limited to installed packages and the current first slice may return fewer than five.

Add flow=place-frontier to page.tsx. A run URL needs only run plus flow because the verified RankingSnapshot binds profile and preferences. Preserve flow=cold-start unchanged.

Keep country cards as a small local component inside `PlaceFrontierJourney`; do not create a separate
cards controller/file. Cards display only the Task 5 projection.

- [ ] **Step 3: Reuse the globe with an explicit frontier scope**

Add scope?: "single-candidate" | "country-frontier" to ResearchWorkspace, defaulting to single-candidate. The existing green early return runs only for single-candidate. In frontier scope render mixed candidates and actual progress.

Extend ResearchReason with `officialUrls?: readonly string[]` for Evidence links and
`manualCheckLinks?: readonly {label: string; url: string}[]` for navigation-only guidance, while
keeping `officialUrl` for VS-1/VS-2 compatibility. In ResearchGlobeCanvas:

- red/yellow destination markers are buttons with aria-expanded/controls;
- green/pending destinations are noninteractive elements;
- red/yellow detail labels Evidence-backed official links separately from “проверьте вручную”
  navigation links;
- focus/Escape/route-removal/overview behavior keeps the existing tested implementation;
- do not touch flight, material, camera or lighting algorithms.

- [ ] **Step 4: Add only the required CSS**

Add place-frontier setup/full/collapsed/cards selectors. Reuse existing tokens and collapsed content pass-through. Do not add breakpoint/layout matrices. Respect reduced motion through the existing globe behavior.

- [ ] **Step 5: Run Task 6 gates**

Run:

~~~bash
./node_modules/.bin/vitest run tests/integration/place-frontier-experience.test.tsx tests/integration/product-shell.test.tsx tests/integration/research-globe-canvas.test.tsx tests/integration/cold-start-experience.test.tsx
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/eslint .
./node_modules/.bin/next build
~~~

Expected: all commands PASS; Next reports both /api/cold-start and /api/place-frontier as dynamic
routes.

- [ ] **Step 6: Review and commit Task 6**

Review protocol truthfulness, a11y, multi-marker persistence and VS-1/VS-2 compatibility. Then:

~~~bash
git add src/app/page.tsx src/app/globals.css src/experience/run-url.ts src/experience/components/PlaceFrontierStart.tsx src/experience/components/PlaceFrontierJourney.tsx src/experience/components/ResearchWorkspace.tsx src/experience/research-map/contracts.ts src/experience/research-map/ResearchGlobeCanvas.tsx tests/integration/place-frontier-experience.test.tsx tests/integration/research-globe-canvas.test.tsx tests/integration/product-shell.test.tsx
git commit -m "feat: show place frontier on globe"
~~~

---

### Task 7: Verify replay, provider-free scope and the installed-country walkthrough

**Requirements:** REQ-PF-01 through REQ-PF-06; NFR-PF-01 through NFR-PF-04

**Files:**
- Create after successful evidence collection: docs/changes/active/vs-3-place-frontier/implementation-evidence.md
- Modify only after user approves the evidence: docs/changes/active/vs-3-place-frontier/change.md
- Modify only if the executed plan differs materially: docs/superpowers/plans/2026-08-12-vs-3-place-frontier.md

**Interfaces:**
- Consumes: final committed implementation, local SQLite DB, installed SI package and existing official HTTPS path.
- Produces: one truthful implementation-evidence record. No eval platform or provider script is added.

- [ ] **Step 1: Run the complete local gate from a clean tracked tree**

Run:

~~~bash
./node_modules/.bin/vitest run
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/eslint .
./node_modules/.bin/next build
git diff --check
git status --short
~~~

Expected: all tests/static/build pass; status contains no unexpected tracked changes and preserves only the known brainstorm directory before evidence drafting.

- [ ] **Step 2: Run the provider-surface audit**

Run:

~~~bash
rg -n -i 'openai|responses[.]parse|OPENAI_API_KEY|OPENAI_MODEL|llmCalls|modelCalls|provider sdk' src tests evals package.json pnpm-lock.yaml .env.example
~~~

Expected: no matches. Historical archived documentation is outside this runtime audit.

- [ ] **Step 3: Prove zero-network replay in integration**

Run the focused replay test with requestStep replaced by a function that throws network_forbidden. Call presentPlaceFrontier twice and assert canonical equality of:

- RankingSnapshot;
- all marker order/states/reasons;
- ShortlistSnapshot markers/rules version and the derived composition/stop condition;
- ranking and updated Knowledge revision IDs;
- Evidence snapshot IDs.

Assert requestStep count remains zero.

- [ ] **Step 4: Start the local app and perform one browser walkthrough**

Use a fresh temporary DATABASE_PATH and configured EVIDENCE_HMAC_KEY. Open flow=place-frontier in the in-app browser. The user has already authorized browser checks in this chat.

Observe and record:

1. setup states installed-coverage limitation and confirms preferences;
2. SI marker appears gray before terminal;
3. visible timeline advances only on actual source/claim events;
4. terminal SI is green only if the verified route is viable, otherwise yellow; it is never false red solely because the DN route failed;
5. globe collapses but the marker remains;
6. terminal copy says preliminary and shows exact green/yellow composition;
7. red/yellow keyboard semantics remain covered by automated tests; do not fabricate a live red country;
8. reload shows the exact stored snapshot without official HTTP requests.

If official source drift prevents a verified route, record the real yellow blocker. Do not substitute fixtures or recorded bytes.

- [ ] **Step 5: Inspect persisted integrity and dates**

With read-only SQL, verify:

- exactly one ranking snapshot and at most one shortlist snapshot for the browser run;
- no update/delete occurred;
- ShortlistSnapshot references the exact ranking ID;
- Knowledge revision references sealed Evidence and contains no raw bytes;
- lastCheckedAt reflects the completed attempt;
- knowledgeUpdatedAt equals the latest pre-existing or newly published evidence-backed revision
  time, and is absent only when the country has never had a Knowledge revision.

- [ ] **Step 6: Write implementation evidence**

Create implementation-evidence.md containing:

- commit SHA and timestamp;
- exact test/type/lint/build commands and counts;
- provider-surface audit result;
- browser URL/run ID and observed marker/progress/composition/collapse/reload;
- source outcome and exact yellow blocker if drift occurred;
- read-only DB counts, snapshot IDs and zero-network replay count;
- known limitation: installed production coverage is SI-only and red replacement is proven by integration fixture until another package passes its own source-feasibility gate.

Do not mark the active change implemented yet.

- [ ] **Step 7: Request evidence approval**

Present the evidence file to the user and stop. Do not update the active change status, commit the evidence or push before the user explicitly approves the implementation evidence.

- [ ] **Step 8: After approval, close and publish the documentation**

Change active change status to implemented and link the approved evidence. Run:

~~~bash
git add docs/changes/active/vs-3-place-frontier/change.md docs/changes/active/vs-3-place-frontier/implementation-evidence.md
git commit -m "docs: verify VS3 place frontier"
git push origin feat/vs1-confirmed-life
~~~

Expected: push succeeds; merge remains the user’s action.

---

## Plan self-review

### Spec coverage

- REQ-PF-01: Task 2 ranker and Task 4 frozen RankingSnapshot.
- REQ-PF-02: Task 1 formal verdict and current SI correction.
- REQ-PF-03: Task 4 red replacement/exhaustion, Task 5 projection and Task 6 planet UI.
- REQ-PF-04: Task 1 source/reason semantics, Task 5 protocol truth and Task 6 accessible markers/progress.
- REQ-PF-05: Task 3 typed append-only Knowledge publication.
- REQ-PF-06: Task 3/4 integrity, Task 5/6 reload projection and Task 7 replay.
- NFR-PF-01: Tasks 1/3/4 preserve official Evidence lineage; Task 7 live walkthrough.
- NFR-PF-02: no provider surface in any task; Task 7 audit.
- NFR-PF-03: Task 2 conservative ranking and visible factor coverage.
- NFR-PF-04: two tables, one verifier adapter, one new route, no city/new-country/platform scope.

### Explicitly deferred

- Additional country packages require separate approved source-feasibility changes.
- Complete-catalog live red requires a country-specific current CatalogCompletenessAttestation.
- City frontier and all city facts remain the next slice.
- External LLM-assisted discovery remains BACKLOG-EXT-LLM-01 after defense and before monetization.

### Approval state

Product requirements, formal marker/frontier semantics, review-driven integrity/persistence
amendments and this exact task plan were approved together by the user on 2026-08-12 by selecting
Subagent-Driven execution. Implementation is authorized task-by-task with the review gates above.
