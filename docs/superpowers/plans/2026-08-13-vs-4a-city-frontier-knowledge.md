# VS-4A City Evidence and Knowledge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Install one reviewable city research package and publish replayable, append-only City Evidence and full four-fact City Knowledge without carrying stale predecessor values.

**Architecture:** Existing generic artifact/Evidence storage remains the only raw-byte owner. A narrow signed City Evidence overlay binds the generic snapshot to city/frontier context and durable `completedAt`. Research builds each City Knowledge revision entirely from that one verified overlay; SQLite serializes revisions per city and reconstructs every row from sealed Evidence. Country Knowledge remains unchanged.

**Tech Stack:** TypeScript, the existing generic `ResearchPlan`/Evidence store, official source adapters, SQLite immediate transactions, canonical JSON/SHA-256/HMAC and Vitest.

**Depends on:** completed [`VS-4A Foundations`](2026-08-13-vs-4a-city-frontier-foundations.md) and its exact source contracts. `installable` means a sealed `city-catalog@2` projection plus four complete deterministic plans whose city outcomes are `verified | unknown`; missing or malformed catalog/plan policy remains a real blocker.

**Required safety dependency:** completed [`VS-4A Safety Source Discovery`](2026-08-14-vs-4a-safety-source-discovery.md). A complete safety, rent, transit or broadband plan may close a city as evidence-backed unknown; a missing catalog projection or incomplete four-fact plan policy, not an unknown outcome, blocks installation.

**Format metadata:** `review-matrix` — executable five-task checklist whose length comes from mandatory source, persistence, RED/GREEN, replay and commit cells; it is linked from the short master index and is not a narrative specification.

## Constraints specific to this plan

- Task 6 implementation proceeds locally against committed fixtures and local synthetic boundary vectors under `PROCEED_WITH_TASK_6; PUBLICATION_PENDING_ARTIFACTS`. Administrative installation, Start and publication remain blocked until the sealed `city-catalog@2` projection and four deterministic per-member plans exist. Never create or publish a production package from synthetic fixtures; a completed plan's `unknown` is not a stop condition.
- Do not generalize or alter Country Knowledge carry-forward behavior. City Knowledge is a separate full-projection contract.
- A City Knowledge revision contains exactly four current outcomes. Its predecessor contributes only the previous `knowledgeUpdatedAt` comparison baseline.
- `source_unavailable` requires a sealed completed discovery ledger. One failed candidate is never terminal; abort, storage, protocol, integrity and unexpected errors publish no City Knowledge.
- Raw bytes stay in `artifacts` only when the source-specific retention policy permits it. A prohibited transient copy is deleted after its minimal hash/locator projection is sealed; the City Evidence overlay and City Knowledge contain references only.
- Official catalog installation is an explicit administrative operation before user Start. Within a City Frontier run, only Continue may call official sources or the narrow safety-search port. Task 6 uses only committed fixtures and local synthetic boundary vectors: do not register, download, contact an authority or perform any network operation.

---

### Task 6: Define the Slovenia city package candidate, strict fixed-source Evidence, and exact parsers

**Requirements:** REQ-CF-01, REQ-CF-02, REQ-CF-04; SCN-CF-01, SCN-CF-06

**Files:**
- Create: `src/research/city-evidence.ts`
- Create: `src/research/city-package.ts`
- Create: `src/research/slovenia-city-plan.ts`
- Create: `src/research/parsers/slovenia-city.ts`
- Create: `tests/research/city-evidence-composition.test.ts`
- Create: `tests/research/city-package.test.ts`
- Create: `tests/sources/slovenia-city.test.ts`
- Modify narrowly: `src/research/contracts.ts`
- Modify narrowly: `src/research/research-plan.ts`
- Modify regression-only: `tests/research/cold-start.test.ts`

**Interfaces:**

```ts
export const SLOVENIA_CITY_FACT_SOURCE_IDS = [
  "si-city-safety",
  "si-city-long-term-rent",
  "si-city-urban-transit",
  "si-city-fixed-broadband",
] as const;

export type SloveniaCityFactSourceId =
  typeof SLOVENIA_CITY_FACT_SOURCE_IDS[number];
export type SloveniaCityFixedSourceId = Exclude<
  SloveniaCityFactSourceId,
  "si-city-safety"
>;

export const SLOVENIA_CITY_FIXED_CRITERION_BY_SOURCE = {
  "si-city-long-term-rent": "long_term_rent",
  "si-city-urban-transit": "urban_transit",
  "si-city-fixed-broadband": "fixed_broadband",
} as const satisfies Readonly<Record<
  SloveniaCityFixedSourceId,
  Exclude<CityCriterionId, "safety">
>>;

export type SloveniaCityFixedCriterionId<
  S extends SloveniaCityFixedSourceId,
> = typeof SLOVENIA_CITY_FIXED_CRITERION_BY_SOURCE[S];

export interface CityEvidenceClaim<
  S extends SloveniaCityFactSourceId = SloveniaCityFactSourceId,
> extends Claim<CityVerifiedFactBasis, S> {
  readonly criterionId: CityCriterionId;
  readonly definitionId: string;
  readonly officialAreaId: string;
  readonly geoScope: string;
  readonly unit: string;
  readonly denominator: string;
  readonly freshnessPolicyVersion: string;
}

export interface CityFixedEvidenceClaim<
  S extends SloveniaCityFixedSourceId = SloveniaCityFixedSourceId,
> extends CityEvidenceClaim<S> {
  readonly value: { readonly kind: "canonical_scalar"; readonly value: string };
}

export interface CityFixedClaimContract<S extends SloveniaCityFixedSourceId> {
  readonly sourceId: S;
  readonly criterionId: SloveniaCityFixedCriterionId<S>;
  readonly definitionId: string;
  readonly scope: string;
  readonly officialAreaId: string;
  readonly geoScope: string;
  readonly unit: string;
  readonly denominator: string;
  readonly freshnessPolicyVersion: string;
  readonly valueKind: "canonical_scalar";
  readonly valuePolicyVersion: string;
  readonly sourcePeriodPolicyVersion: string;
}

export interface CityFixedValueValidationInput<S extends SloveniaCityFixedSourceId> {
  readonly sourceId: S;
  readonly criterionId: SloveniaCityFixedCriterionId<S>;
  readonly definitionId: string;
  readonly policyVersion: string;
  readonly value: string;
  readonly unit: string;
  readonly denominator: string;
}

export type CityFixedValueValidator = <S extends SloveniaCityFixedSourceId>(
  input: CityFixedValueValidationInput<S>,
) => string;

export interface CityFixedSourcePeriodValidationInput<S extends SloveniaCityFixedSourceId> {
  readonly sourceId: S;
  readonly policyVersion: string;
  readonly sourcePeriod: string;
  readonly assessmentAt: string;
}

export type CityFixedSourcePeriodValidator = <S extends SloveniaCityFixedSourceId>(
  input: CityFixedSourcePeriodValidationInput<S>,
) => "fresh" | "stale" | "not_comparable";

export interface CityFixedRoute {
  readonly routeId: string;
  readonly navigationUrl: string;
}

export interface CityFixedSourcePlan<S extends SloveniaCityFixedSourceId> {
  readonly planId: string;
  readonly sourceId: S;
  readonly cityId: string;
  readonly criterionId: SloveniaCityFixedCriterionId<S>;
  readonly definitionId: string;
  readonly claimContract: CityFixedClaimContract<S>;
  readonly routes: readonly CityFixedRoute[];
  readonly parserVersion: string;
  readonly rulesVersion: string;
}
```

Keep `prepareEvidencePlan`, `ResearchPlan.validate`, `CaptureFailureKind`, legacy `SourceId` and all
country behavior unchanged. Add only `not_found | not_comparable | source_unavailable` to
`EvidenceBlockerKind`. Beside `sealEvidencePlan`, add this generic pure composition seam:

```ts
export function composeTerminalEvidenceEntries<
  S extends string,
  C extends Claim<unknown, S>,
>(
  sourceIds: readonly S[],
  batches: readonly (readonly TerminalEvidenceEntry<S, C>[])[],
): readonly TerminalEvidenceEntry<S, C>[];
```

It calls no canonical/hash/sign function. It requires unique nonempty `sourceIds`, flattens the
batches, reuses the existing terminal validation for parser-entry, claim, blocker and artifact
ownership, rejects every missing/duplicate/foreign entry, and returns fresh recursively frozen copies
in exact `sourceIds` order. "Recursively frozen" here means cloned plain objects/arrays only:
artifact bytes are copied into new non-aliased `Uint8Array` values and a nonempty typed array is never
passed to `Object.freeze`; no caller-owned value is frozen or aliased. Task 14 composes all four
terminal entries and calls
`sealEvidencePlan` exactly once. Do not export, extract or reuse the generic capture runner for City:
its deadline and integrity-to-unavailable mapping is deliberately incompatible with the strict City
operation-failure contract.

The fixed-route rejection and complete-ledger contracts are:

```ts
export type CityFixedAttemptRejectionReason =
  | "http_not_found"
  | "source_drift"
  | "transport_failure"
  | "wrong_media_type"
  | "too_large"
  | "untrusted_redirect"
  | "retention_unapproved"
  | "universe_incomplete"
  | "definition_noncomparable"
  | "area_identifier_unproved"
  | "reference_period_unproved"
  | "license_unproved"
  | "stale"
  | "conflict";

export interface CityFixedRejectedAttempt<
  S extends SloveniaCityFixedSourceId = SloveniaCityFixedSourceId,
> {
  readonly cityCheckRunId: string;
  readonly sourceId: S;
  readonly index: number;
  readonly routeId: string;
  readonly navigationUrl: string;
  readonly resolvedEvidenceUrl?: string;
  readonly attemptedAt: string;
  readonly disposition: "rejected";
  readonly reason: CityFixedAttemptRejectionReason;
  readonly artifactIds: readonly string[];
}

export interface CityFixedAcceptedAttempt<
  S extends SloveniaCityFixedSourceId = SloveniaCityFixedSourceId,
> {
  readonly cityCheckRunId: string;
  readonly sourceId: S;
  readonly index: number;
  readonly routeId: string;
  readonly navigationUrl: string;
  readonly resolvedEvidenceUrl: string;
  readonly attemptedAt: string;
  readonly disposition: "accepted";
  readonly artifactIds: readonly string[];
  readonly claimIds: readonly string[];
}

export type CityFixedAttempt<
  S extends SloveniaCityFixedSourceId = SloveniaCityFixedSourceId,
> = CityFixedRejectedAttempt<S> | CityFixedAcceptedAttempt<S>;

export interface CityFixedAttemptLedger<
  S extends SloveniaCityFixedSourceId = SloveniaCityFixedSourceId,
> {
  readonly schemaVersion: "city-fixed-attempt-ledger@1";
  readonly cityCheckRunId: string;
  readonly cityId: string;
  readonly sourceId: S;
  readonly criterionId: SloveniaCityFixedCriterionId<S>;
  readonly planId: string;
  readonly definitionId: string;
  readonly valuePolicyVersion: string;
  readonly sourcePeriodPolicyVersion: string;
  readonly parserVersion: string;
  readonly rulesVersion: string;
  readonly assessmentAt: string;
  readonly attempts: readonly CityFixedAttempt<S>[];
  readonly result:
    | { readonly kind: "verified"; readonly claimIds: readonly string[] }
    | { readonly kind: "unknown"; readonly reason: CityUnknownReason };
  readonly completedAt: string;
}
```

Both verified and unknown results carry the ledger. A verified ledger retains every rejected prefix
route plus the accepted route, so checked official URLs never disappear after success. A completed
unknown ledger contains every configured route exactly once as rejected.

Define every public runner input explicitly; no referenced public type may remain implicit:

```ts
export interface CityFixedDeadlineHandle {
  cancel(): void;
}

export interface CityFixedDeadlineScheduler {
  schedule(deadlineAt: string, onDeadline: () => void): CityFixedDeadlineHandle;
}

export interface CityFixedSourceRunInput<S extends SloveniaCityFixedSourceId> {
  readonly cityCheckRunId: string;
  readonly cityId: string;
  readonly sourceId: S;
  readonly criterionId: SloveniaCityFixedCriterionId<S>;
  readonly planId: string;
  readonly definitionId: string;
  readonly assessmentAt: string;
  readonly deadlineAt: string;
  readonly signal: AbortSignal;
  readonly now: () => string;
  readonly deadlineScheduler: CityFixedDeadlineScheduler;
  readonly validateValue: CityFixedValueValidator;
  readonly validateSourcePeriod: CityFixedSourcePeriodValidator;
}

export interface CityFixedRouteInspectionInput<S extends SloveniaCityFixedSourceId> {
  readonly cityCheckRunId: string;
  readonly cityId: string;
  readonly sourceId: S;
  readonly criterionId: SloveniaCityFixedCriterionId<S>;
  readonly planId: string;
  readonly definitionId: string;
  readonly assessmentAt: string;
  readonly deadlineAt: string;
  readonly attemptedAt: string;
  readonly routeIndex: number;
  readonly route: CityFixedRoute;
  readonly signal: AbortSignal;
}

export interface CityFixedAttemptLedgerExpectations<S extends SloveniaCityFixedSourceId> {
  readonly cityCheckRunId: string;
  readonly cityId: string;
  readonly sourceId: S;
  readonly criterionId: SloveniaCityFixedCriterionId<S>;
  readonly planId: string;
  readonly definitionId: string;
  readonly valuePolicyVersion: string;
  readonly sourcePeriodPolicyVersion: string;
  readonly routes: readonly CityFixedRoute[];
  readonly parserVersion: string;
  readonly rulesVersion: string;
  readonly assessmentAt: string;
  readonly notAfterAt: string;
}

export interface CityFixedRoutePort<
  S extends SloveniaCityFixedSourceId,
  C extends CityFixedEvidenceClaim<S>,
> {
  inspect(input: CityFixedRouteInspectionInput<S>): Promise<
    | {
        readonly kind: "verified";
        readonly attempt: CityFixedAcceptedAttempt<S>;
        readonly parserEntry: ParserEntry<S>;
        readonly claims: readonly [C];
      }
    | {
        readonly kind: "rejected";
        readonly attempt: CityFixedRejectedAttempt<S>;
        readonly parserEntry: ParserEntry<S>;
      }
  >;
}

export type CityFixedSourceRunResult<
  S extends SloveniaCityFixedSourceId,
  C extends CityFixedEvidenceClaim<S>,
> =
  | {
      readonly kind: "verified";
      readonly entry: VerifiedEvidenceEntry<S, C>;
      readonly ledger: CityFixedAttemptLedger<S>;
      readonly artifacts: readonly LiveCapturedArtifact<S>[];
    }
  | {
      readonly kind: "unknown";
      readonly entry: UnavailableEvidenceEntry<S>;
      readonly ledger: CityFixedAttemptLedger<S>;
      readonly artifacts: readonly LiveCapturedArtifact<S>[];
    };

export async function runCityFixedSourcePlan<
  S extends SloveniaCityFixedSourceId,
  C extends CityFixedEvidenceClaim<S>,
>(
  input: CityFixedSourceRunInput<S>,
  plan: CityFixedSourcePlan<S>,
  port: CityFixedRoutePort<S, C>,
): Promise<CityFixedSourceRunResult<S, C>>;

export function reconstructCityFixedAttemptLedger<
  S extends SloveniaCityFixedSourceId,
>(
  value: unknown,
  expected: CityFixedAttemptLedgerExpectations<S>,
): CityFixedAttemptLedger<S>;

export const SLOVENIA_CITY_SAFETY_FACT_CONTRACT = {
  sourceId: "si-city-safety",
  criterionId: "safety",
  definitionId: "si-municipal-police-offences-per-100000@1",
  geoScope: "municipality",
  unit: "offences_per_100000_residents",
  denominator: "municipality_population_january_1",
  freshnessPolicyVersion: "municipal-annual-july-boundary@1",
} as const;

export interface CitySafetyTerminalEntryInput {
  readonly cityCheckRunId: string;
  readonly ledger: CitySafetyAttemptLedger;
  readonly artifacts: readonly LiveCapturedArtifact<"si-city-safety">[];
  readonly sourcePlan: CitySafetySourcePlan;
  readonly authorityDirectory: OfficialAuthorityDirectory;
}

export function citySafetyTerminalEntry(
  input: CitySafetyTerminalEntryInput,
): TerminalEvidenceEntry<
  "si-city-safety",
  CityEvidenceClaim<"si-city-safety">
>;
```

Validate `plan` before the first port call: IDs and versions are nonempty canonical identifiers,
`sourceId` maps to `criterionId` through
`SLOVENIA_CITY_FIXED_CRITERION_BY_SOURCE`, and `routes` is a nonempty dense array with unique
nonempty canonical route IDs and unique canonical HTTPS navigation URLs. The input run/city/source/
criterion/plan/definition bindings must exactly match that plan. Inspect routes sequentially in plan
order. Every returned attempt repeats the exact `cityCheckRunId`, `sourceId`, dense index, route ID,
navigation URL and invocation `attemptedAt`. Every parser entry has the same source; every contained
artifact is live, has the exact run/source, and is named exactly once by that attempt's
`artifactIds`. A duplicate artifact ID within or across routes, even with equal-looking bytes, is an
integrity conflict rather than a deduplication opportunity.
Require every returned resolved URL to be canonical HTTPS,
`parserEntry.navigationUrl === attempt.navigationUrl`,
`parserEntry.resolvedEvidenceUrl === (attempt.resolvedEvidenceUrl ?? attempt.navigationUrl)` and
`parserEntry.versionHint === plan.parserVersion`; `indexedSourceUrl` is absent because the fixed
runner has no search/index lineage.

`claimContract` is serializable and exact: its source/criterion/definition repeat the plan, while
`scope`, `officialAreaId`, `geoScope`, `unit`, `denominator`,
`freshnessPolicyVersion`, `valuePolicyVersion` and `sourcePeriodPolicyVersion` are nonempty canonical
values bound to that city's installed official-area crosswalk; `valueKind` is exactly
`canonical_scalar`. Task 6 defines no production value or period semantics. The runner calls only the
inward pure `input.validateValue` and `input.validateSourcePeriod` capabilities with the exact
versioned contract/claim bindings; Task 6 tests inject synthetic validators, and Task 9 supplies the
approved installed validators.

`assessmentAt`, `deadlineAt`, every `attemptedAt`, `completedAt` and every `now()` value use strict
canonical UTC millisecond instants. Require `assessmentAt < deadlineAt`. Create one runner-owned
`AbortController`, mirror an already-aborted caller before any clock/port call, forward later caller
abort to it, and schedule an absolute deadline through
`deadlineScheduler`. Race every `port.inspect` promise against the one abort/deadline rejection
promise, passing only the internal signal to the port; a hung or signal-ignoring port therefore
cannot keep the runner pending past the deadline. Immediately before each call, reject an aborted
signal, call `now()` once, require monotonic `assessmentAt <= attemptedAt < deadlineAt`, and pass that
exact instant. After the bounded race returns a port value, reject abort, call `now()` once and
require an instant no earlier than every prior pre/post-call instant and still strictly before
`deadlineAt`; the next attempt cannot precede that post-call instant. Only the post-call instant for
the accepted route or final rejected route becomes `completedAt`, and it must satisfy
`lastAttemptedAt <= completedAt < deadlineAt`.

In `finally`, cancel the deadline handle and remove the caller-abort listener. On caller abort or
deadline, abort the internal controller, reject once with the operation error, detach/ignore every
late port resolution or rejection and mutate no attempts/artifact union/entry/ledger state.
A reached deadline, regressing clock or noncanonical clock value is likewise an operation failure
with no terminal result.

A verified inspection returns exactly one `CityFixedEvidenceClaim`. Its source, mapped criterion,
definition, `scope`, `officialAreaId`, geo scope, unit, denominator and freshness must equal the
corresponding fields of the entire plan `claimContract`; its value is exactly
`{ kind: "canonical_scalar", value: <string> }`, its status is exactly `verified`, and its anchor
names exactly one artifact owned by that inspection's parser entry. Call `validateValue` with exact
source/criterion/definition, `valuePolicyVersion`, scalar value, unit and denominator and require its
returned canonical string to equal the claim value byte-for-byte. A throw, different canonical value,
wrong value kind or any other malformed verified output is an operation failure with no terminal
entry or ledger; a correct port reports a legitimate noncomparable value as a rejected
`definition_noncomparable` inspection. Call the source-period
validator only after the returned accepted attempt `claimIds` exactly equal the singleton claim ID
and every other ownership/contract check has passed, using the claim's exact `sourcePeriod`, the
contract's `sourcePeriodPolicyVersion`, source and assessment. Only `fresh` becomes an accepted
route. Normalize `stale` into a newly copied rejected
attempt with reason `stale`, and normalize `not_comparable` into a newly copied rejected attempt with reason
`reference_period_unproved`; copy only the inspected route bindings and own artifact IDs, discard the
claim/claim IDs, and continue to the next route. Thus a nonfresh period can never become a verified
claim. The accepted attempt
`claimIds`, returned singleton claim ID and ledger verified `claimIds` are exactly equal. Rejected
routes return no claim. Stop at the first accepted route; unknown is valid only after every route is
rejected exactly once.

For the terminal entry, build a conflict-checked ordered union of artifacts from every inspected
route: rejected prefix plus accepted route for verified, or all rejected routes for unknown. Both
`entry.parserEntry.artifacts` and `result.artifacts` are fresh, separately copied, canonically equal
views of that complete union. Use only the accepted attempt's parser URL/version metadata for a
verified terminal summary or the final rejected attempt's metadata for an unknown summary; replace
its artifact array with the full union, and make the unknown blocker own every union artifact ID.
The generic manifest therefore has one terminal summary URL while every per-route URL and rejection
reason lives only in the ledger covered by the later signed overlay.

Choose the unknown reason with this closed precedence: `conflict`; `source_unavailable` for
transport/source-drift/media/size/redirect/retention/license; `stale`; `not_comparable` for
universe/definition/area/reference-period; then `not_found`. Abort/cancel, caller deadline,
malformed port output, ownership/integrity/storage/protocol failure or unexpected exception throws
and creates no terminal entry or ledger. Deep-copy every byte array with `new Uint8Array(bytes)`.
Recursively freeze only cloned plain objects and arrays; never call `Object.freeze` on a nonempty
`Uint8Array`. Neither output view may alias caller or port objects, arrays or bytes, and no caller-
owned input, plan, attempt, parser entry, claim, artifact or byte array may become frozen.

Reconstruction binds `expected.routes`, `expected.valuePolicyVersion`,
`expected.sourcePeriodPolicyVersion`,
`expected.parserVersion` and `expected.rulesVersion` to the exact configured plan and requires those
versions in the ledger. `expected.notAfterAt` is only a canonical upper bound: require
`assessmentAt <= every attemptedAt <= completedAt <= notAfterAt`, not equality with another
independently completed ledger. Every attempt is the matching
run/source/route/index/navigation URL prefix; unknown equals the full route list with every attempt
rejected, while verified is a proper or full prefix ending in exactly one accepted attempt and one
claim ID. Re-signed run/source/route ID, URL, order, truncation, extension, version or a
post-acceptance attempt is an integrity failure.

The fixed ledger itself has no HMAC. Task 7 covers it with the signed City Evidence overlay and
`reconstructCityFixedAttemptLedger` supplies semantic replay. Safety remains the completed S1-S3
`CitySafetyAttemptLedger`. The pure `citySafetyTerminalEntry` first requires already reconstructed
`CitySafetySourcePlan` and `OfficialAuthorityDirectory` values and exact ledger plan/directory/city/
definition binding. Its single generic terminal URL lineage is deterministic: the accepted usable
candidate; otherwise the final candidate carrying `reviewedOfficial`; otherwise the first configured
route for that city; otherwise the first publisher navigation URL allowed for that reconstructed
plan entry. Missing or non-official fallback lineage is an integrity failure, so even a zero-candidate
unknown never receives a fabricated URL.

For those four cases respectively, set generic navigation/resolved URLs to
`publisherNavigationUrl/resolvedEvidenceUrl`,
`publisherNavigationUrl/(resolvedEvidenceUrl ?? publisherNavigationUrl)`,
`navigationUrl/(resolvedEvidenceUrl ?? navigationUrl)`, or
`publisher.navigationUrl/publisher.navigationUrl`. Every chosen value is canonical HTTPS and bound
to the reconstructed directory.

The adapter conflict-checks the complete ordered union of safety candidate artifact references
against the supplied live artifacts. Every reference binds its exact `artifactId`; the corresponding
stored artifact must have `sha256 === artifactSha256`, the exact `cityCheckRunId`, source
`si-city-safety`, and the role encoded by that reference. Task 6 deliberately does not validate
`sourceSha256`, source locator or retention disposition: Task 7 validates those only while bridging
the retained raw or retained-projection representation to the signed ledger. In particular, never
compare a transient stored projection's SHA-256 to `sourceSha256`; its stored SHA-256 is
`artifactSha256`, while `sourceSha256` names the deleted source bytes described inside the validated
projection. The adapter places a fresh copied artifact union in its parser entry and blocker/claim
anchors as applicable. It retains no per-route URL list in the generic summary; the existing signed
safety ledger remains authoritative.
Verified safety emits exactly one `si-city-safety`/`safety` claim bound to the ledger quantity and
accepted artifact; unknown emits no claim and one blocker with the ledger reason and full union
artifact IDs.
For verified, map fields exactly as follows:

```ts
{
  claimId: "si-city-safety:" + ledger.cityId + ":" + String(ledger.result.referenceYear),
  sourceId: "si-city-safety",
  value: { kind: "municipal_safety", quantity: ledger.result.quantity },
  scope: "municipality:" + ledger.municipalityCode,
  sourcePeriod: String(ledger.result.referenceYear),
  anchor: {
    artifactId: terminalClaimRef.artifactId,
    locator: terminalClaimRef.locator,
    excerptSha256: terminalClaimRef.sourceSha256,
  },
  status: "verified",
  criterionId: "safety",
  definitionId: "si-municipal-police-offences-per-100000@1",
  officialAreaId: ledger.municipalityCode,
  geoScope: "municipality",
  unit: "offences_per_100000_residents",
  denominator: "municipality_population_january_1",
  freshnessPolicyVersion: "municipal-annual-july-boundary@1",
}
```

`terminalClaimRef` is the accepted candidate's exactly one
`municipal_source/terminal_claim` reference. It and the required same-year SURS denominator reference
must both resolve in the complete artifact union; the singular generic anchor points to the terminal
municipal source, while the signed ledger binds the denominator and exact rational quantity. Reject
any difference from `SLOVENIA_CITY_SAFETY_FACT_CONTRACT`, ledger definition/freshness/reference year,
or accepted-candidate index. Require `officialAreaId === ledger.municipalityCode` and require that
municipality code to equal both the reconstructed source-plan entry and its exact reconstructed
authority-directory municipality binding for `ledger.cityId`.
Apply the same byte-copy/plain-object-freeze rules as the fixed runner. Research must not import
Application `CitySafetyDiscoveryResult`, create a second safety ledger or seal Evidence.

The package boundary is candidate-only:

```ts
export type CityPackageReadinessIssue =
  | "catalog_v2_projection_unsealed"
  | "registry_coordinates_unsealed"
  | "per_member_source_plan_artifacts_unsealed"
  | "criteria_policy_unapproved";

export interface CityResearchPackageDefinition {
  readonly packageId: string;
  readonly packageSchemaVersion: string;
  readonly countryCode: string;
  readonly evidenceRulesVersion: string;
  readonly sourceIds: readonly SloveniaCityFactSourceId[];
}

export interface CityResearchPackageCandidate {
  readonly definition: CityResearchPackageDefinition;
  readonly sourceContractStatus: "bounded_verified_or_unknown";
  readonly readiness: {
    readonly status: "not_ready";
    readonly issues: readonly CityPackageReadinessIssue[];
  };
}

export const SLOVENIA_CITY_PACKAGE_DEFINITION = {
  packageId: "si-city-package",
  packageSchemaVersion: "si-city-package@1",
  countryCode: "SI",
  evidenceRulesVersion: "si-city-evidence@1",
  sourceIds: SLOVENIA_CITY_FACT_SOURCE_IDS,
} as const satisfies CityResearchPackageDefinition;

export const SLOVENIA_CITY_FACT_VERSIONS = {
  "si-city-safety": {
    parserVersion: "si-city-safety-terminal@1",
    rulesVersion: "city-safety-discovery@1",
  },
  "si-city-long-term-rent": {
    parserVersion: "si-city-long-term-rent-feasibility@1",
    rulesVersion: "si-city-long-term-rent-source@1",
  },
  "si-city-urban-transit": {
    parserVersion: "si-city-urban-transit-feasibility@1",
    rulesVersion: "si-city-urban-transit-source@1",
  },
  "si-city-fixed-broadband": {
    parserVersion: "si-city-fixed-broadband-feasibility@1",
    rulesVersion: "si-city-fixed-broadband-source@1",
  },
} as const satisfies Readonly<Record<
  SloveniaCityFactSourceId,
  { readonly parserVersion: string; readonly rulesVersion: string }
>>;

export function getCityResearchPackageCandidate(
  countryCode: string,
): CityResearchPackageCandidate | undefined;

export function assertCityPackageReady(
  candidate: CityResearchPackageCandidate,
): never;
```

For `SI`, return exactly the four issues above in declaration order and throw
`city_package_not_ready` from `assertCityPackageReady`. Its definition and source/parser metadata
must equal the literal constants above; any other country is absent. These feasibility parser/source
versions identify the committed candidate contracts only and do not make an installed fixed plan.
Deep-freeze a fresh candidate and source list. `slovenia-city-plan.ts` owns only this exact
candidate/source/parser version metadata. Task 6 defines no installed factory, registry,
`InstalledCityCriteriaDefaults`, targets,
normalizers, evaluator constants, Registry rows, Catalog revision or publication path.

Parsers produce candidate observations or closed rejections, never fixture-backed production claims:

```ts
export type SloveniaCityParserOutcome<T> =
  | { readonly kind: "observation"; readonly value: T }
  | { readonly kind: "rejected"; readonly reason: CityFixedAttemptRejectionReason };

export interface SloveniaCatalogFeasibilityObservation {
  readonly schemaVersion: "slovenia-city-catalog-feasibility@1";
  readonly consideredUniverseRows: 104;
  readonly comparablePopulationRows: 104;
  readonly catalogArtifactVersion: null;
  readonly registryCoordinatesSealed: false;
  readonly installable: false;
}

export interface SloveniaRentMechanicsObservation {
  readonly schemaVersion: "slovenia-city-rent-mechanics@1";
  readonly municipalityCode: string;
  readonly referencePeriod: string;
  readonly unit: "EUR per square metre per month";
  readonly denominator: "qualifying lease contracts";
  readonly qualifyingCount: number;
  readonly median: string;
  readonly fixtureClass: "redacted-derived";
  readonly productionClaimAuthorized: false;
}

export interface SloveniaTransitUniverseObservation {
  readonly schemaVersion: "slovenia-city-transit-universe@1";
  readonly sourceUniverseComplete: false;
  readonly missingMunicipalCoverageMeansZero: false;
  readonly rejectionReason: "universe_incomplete";
}

export interface SloveniaBroadbandFeasibilityObservation {
  readonly schemaVersion: "slovenia-city-broadband-feasibility@1";
  readonly sourceField: "gosp_vsaj_100_delez";
  readonly sourceAreaIdentifierFields: readonly ["eid_naselj", "eid_obcina"];
  readonly currentPortalStatusObserved: boolean;
  readonly underlyingReferencePeriodProved: false;
  readonly productionReuseLicenseProved: false;
  readonly comparableCriterionDefinitionApproved: false;
}

export function parseSloveniaCatalogFeasibility(
  value: unknown,
): SloveniaCityParserOutcome<SloveniaCatalogFeasibilityObservation>;
export function parseSloveniaRentMechanics(
  value: unknown,
): SloveniaCityParserOutcome<SloveniaRentMechanicsObservation>;
export function parseSloveniaTransitUniverse(
  value: unknown,
): SloveniaCityParserOutcome<SloveniaTransitUniverseObservation>;
export function parseSloveniaBroadbandFeasibility(
  value: unknown,
): SloveniaCityParserOutcome<SloveniaBroadbandFeasibilityObservation>;
```

Catalog validates the complete 104-row considered universe but cannot emit `city-catalog@2` or
Registry/catalog publication. Rent validates only approved filtering and median mechanics; its
redacted aggregate and synthetic vectors never become a verified terminal claim. Transit validates
the projection and closes `universe_incomplete`. Broadband closes
`reference_period_unproved`, or `license_unproved` when period proof is supplied alone;
`captureDate`/portal status is never source period. Transit and broadband observations are
source-shape feasibility projections only: neither parser may define a comparable criterion metric,
unit, denominator, target, evaluator or verified claim while `criteria_policy_unapproved` remains
open. Reuse the completed safety S1-S3 contracts
without redefining them.

The exact installed targets, definition-specific zero-score/normalizer boundaries, and a comparable
urban-transit metric/unit/denominator remain unapproved. Keep
`criteria_policy_unapproved` explicit. Do not ask again or infer these values from fixtures during
Task 6; this issue becomes load-bearing only for Task 9 installation and Task 14 live activation.

- [ ] **Step 1: Write the strict Evidence composition and fixed-runner RED matrix**

In `city-evidence-composition.test.ts`, compose reversed three-fixed plus one-safety batches into
the exact four-source order; assert composition signs zero times and one following seal signs once.
Reject empty/duplicate source lists, missing/duplicate/foreign terminal entries, foreign parser
entries, claim anchors and blocker artifacts. Reject empty/sparse/duplicate/noncanonical route plans,
wrong source-to-criterion mapping, run/source/index/route/URL/time mismatches, zero or two verified
claims, accepted/ledger claim-ID drift, attempt-to-parser artifact drift, and duplicate/conflicting
artifact IDs across routes. Prove a verified fixed run keeps rejected prefix attempts and the
accepted navigation/resolved URL. Require `entry.parserEntry.artifacts` and `result.artifacts` to be
separate fresh ordered copies of the complete route-artifact union; seal the terminal entry and assert
the rejected-prefix artifact is present in the generic Evidence manifest, not merely returned
separately. Mutate source/run/criterion/definition/parser/rules/route order/URL/reason/artifact/
claim/time, sign again, and reject reconstruction. Unknown requires every configured route and
covers all five precedence classes. Exercise canonical/monotonic assessment-attempt-completion-
deadline boundaries. Reject wrong-city scope/official-area, non-`canonical_scalar` value, unit,
denominator, freshness, value-policy or period-policy claims. Require the synthetic value validator's
returned canonical scalar to equal the claim byte-for-byte; a throw or difference is an operation
failure with no output. Prove synthetic `stale`/`not_comparable` period-validator results become the exact copied
rejections above, continue to a later route, and can close an exhausted unknown; mutate/re-sign the
pinned value/period policy versions and `notAfterAt` bound. Use a never-settling port to prove the internal deadline race rejects,
aborts its signal and cleans timer/listener state; resolve and reject late in separate cases and prove
neither creates output nor an unhandled failure. Prove byte arrays are copied without aliasing,
nonempty `Uint8Array` values are
not frozen, cloned plain containers are frozen and no caller-owned value becomes frozen. Abort/
deadline/malformed/ownership/integrity/storage/protocol and unexpected operation failures must reject
the promise and yield no result.
For `citySafetyTerminalEntry`, cover accepted, final-reviewed, configured-route and publisher
fallback lineage in that order, including a zero-candidate unknown; reject an unbound fallback or
artifact set, and require the complete fresh safety artifact union in the terminal parser entry.
Mutate reference artifact ID, `artifactSha256`, run, source and role independently and reject each;
prove a transient projection is matched to `artifactSha256`, never to `sourceSha256`, while the raw/
projection source-hash, locator and retention bridge remains exclusively a Task 7 assertion.
Assert every exact safety claim field/ID/scope/period/anchor/quantity/unit/denominator/freshness value
above, including `officialAreaId`, the unique terminal-claim plus same-year denominator references,
and rejection on any source-plan/authority-directory municipality mapping or accepted-index drift.
Canonical-compare definition/unit/denominator/freshness with the existing
`createCitySafetyEvaluator(...).definition` literals using a local synthetic test-only boundary that
is neither exported nor installed; Task 6 does not choose a target or zero-score boundary.

- [ ] **Step 2: Write the candidate and fixture-parser RED matrix**

In `city-package.test.ts`, require the exact SI `packageId`/`packageSchemaVersion`/
`evidenceRulesVersion`, fact-source order, every literal parser/rules version, readiness issue order,
immutability, absence for other countries, `city_package_not_ready`, and no installed registry/
factory/default/normalizer constants. In `slovenia-city.test.ts`, verify `SHA256SUMS`, the 104-row catalog
feasibility without an @2 install artifact, rent mechanics without verified publication, transit and
broadband closed rejections, and that raw/unsealed fixture classes cannot become verified terminal
claims. Assert transit/broadband projections expose no comparable criterion metric/unit/denominator,
target, evaluator or verified claim while policy is unapproved. Keep `cold-start.test.ts` as a
regression-only proof of unchanged country Evidence/retry/
blocker behavior.

- [ ] **Step 3: Run RED**

```bash
./node_modules/.bin/vitest run tests/research/city-evidence-composition.test.ts \
  tests/research/city-package.test.ts tests/sources/slovenia-city.test.ts \
  tests/research/cold-start.test.ts
```

Expected: missing City composition, runner, candidate and parser modules/functions.

- [ ] **Step 4: Implement the minimal Research-only candidate, runner, parsers and pure composition**

Implement only the interfaces and validation above. Use committed fixtures and local synthetic
vectors; perform no network, registration, download, source call or external message. Do not create
the production adapter, installed registry, evaluator policy, claims derived from feasibility
fixtures, or publication side effects.

- [ ] **Step 5: Run GREEN and commit**

```bash
./node_modules/.bin/vitest run tests/research/city-evidence-composition.test.ts \
  tests/research/city-package.test.ts tests/sources/slovenia-city.test.ts \
  tests/research/cold-start.test.ts
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/eslint src/research/city-evidence.ts src/research/city-package.ts \
  src/research/slovenia-city-plan.ts src/research/parsers/slovenia-city.ts \
  src/research/contracts.ts src/research/research-plan.ts \
  tests/research/city-evidence-composition.test.ts tests/research/city-package.test.ts \
  tests/sources/slovenia-city.test.ts tests/research/cold-start.test.ts
git diff --check
git add src/research/city-evidence.ts src/research/city-package.ts \
  src/research/slovenia-city-plan.ts src/research/parsers/slovenia-city.ts \
  src/research/contracts.ts src/research/research-plan.ts \
  tests/research/city-evidence-composition.test.ts tests/research/city-package.test.ts \
  tests/sources/slovenia-city.test.ts tests/research/cold-start.test.ts
git commit -m "feat: define Slovenia city research candidate"
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
  readonly fixedAttemptLedgers: CityFixedAttemptLedgerTuple;
  readonly safetyAttemptLedger: CitySafetyAttemptLedger;
  readonly contextHash: string;
  readonly completedAt: string;
}

export type CityFixedAttemptLedgerTuple = readonly [
  CityFixedAttemptLedger<"si-city-long-term-rent">,
  CityFixedAttemptLedger<"si-city-urban-transit">,
  CityFixedAttemptLedger<"si-city-fixed-broadband">,
];

export interface CityEvidenceSealInput {
  readonly genericEvidence: SealedEvidence<
    SloveniaCityFactSourceId,
    CityEvidenceClaim
  >;
  readonly artifacts: readonly LiveCapturedArtifact<SloveniaCityFactSourceId>[];
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
  readonly fixedAttemptLedgers: CityFixedAttemptLedgerTuple;
  readonly safetyAttemptLedger: CitySafetyAttemptLedger;
  readonly completedAt: string;
}

export interface CityEvidenceExpectations {
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
}

export interface VerifiedCityEvidence {
  readonly snapshot: CityEvidenceSnapshot;
  readonly genericEvidence: {
    readonly snapshot: EvidenceSnapshot<
      SloveniaCityFactSourceId,
      CityEvidenceClaim
    >;
    readonly manifest: EvidenceManifest<
      SloveniaCityFactSourceId,
      CityEvidenceClaim
    >;
    readonly entries: readonly CapturedEntry<SloveniaCityFactSourceId>[];
  };
}

export interface CityEvidenceReadPort {
  loadVerified(
    id: string,
    expected?: CityEvidenceExpectations,
  ): VerifiedCityEvidence;
  findVerifiedByCheckRunId(
    cityCheckRunId: string,
  ): VerifiedCityEvidence | undefined;
}

export interface CityEvidencePackageReplayPort {
  loadExactReplayContract(input: {
    readonly countryCode: string;
    readonly packageId: string;
    readonly packageSchemaVersion: string;
    readonly rulesVersion: string;
  }): CityPackageEvidenceReplayContract | undefined;
}

export interface CityPackageEvidenceReplayContract {
  readonly definition: CityResearchPackageDefinition;
  readonly fixedPlansByCityId: Readonly<Record<string, readonly [
    CityFixedSourcePlan<"si-city-long-term-rent">,
    CityFixedSourcePlan<"si-city-urban-transit">,
    CityFixedSourcePlan<"si-city-fixed-broadband">,
  ]>>;
  readonly safetySourcePlan: CitySafetySourcePlan;
  readonly officialAuthorityDirectory: OfficialAuthorityDirectory;
  readonly validateValue: CityFixedValueValidator;
  readonly validateSourcePeriod: CityFixedSourcePeriodValidator;
}

export interface CityEvidenceReplayPorts {
  readonly read: CityEvidenceReadPort;
  readonly integrity: EvidenceIntegrity;
  readonly package: CityEvidencePackageReplayPort;
}

export interface CityEvidenceStorePort extends CityEvidenceReadPort {
  seal(input: CityEvidenceSealInput): CityEvidenceSnapshot;
}
```

Define all types above in `src/application/city-data-contracts.ts`; the SQLite adapter structurally
implements the inward contracts. `CityEvidenceSealInput` accepts exactly one already sealed generic
four-source bundle, the complete live-artifact union for that bundle, the canonical three-ledger tuple
and one safety ledger; it does not accept loose terminal entries or a generic sealing callback. The
artifact array must be dense and exactly match `genericEvidence.manifest.artifacts` in manifest order,
one artifact per manifest row with no missing/extra/duplicate ID, and exact run/source/role/request/
URL/response/status/media/capturedAt/byte-length/SHA provenance. Recompute SHA-256 from every supplied
byte array before storage. Derive `contextHash` from the explicit seal-input context,
require the generic snapshot's context hash to equal it, and use the generic snapshot ID as the only
overlay ID. Persist copied live bytes, the already signed generic bundle and the City overlay in the
same immediate transaction without calling `sealEvidencePlan`, hash/sign, or any live source again;
an exact already-persisted generic bundle is the idempotent recovery case. `VerifiedCityEvidence`
returns the signed overlay together with the verified generic snapshot, verified manifest and
`CapturedEntry` values whose artifacts retain full bytes plus run/source/request/response/capture
provenance. `CityEvidenceReplayPorts` has
only read, integrity and package capabilities. Neither it nor any nested replay port exposes a source,
search, request, capture or seal capability. Infrastructure must not own any public port above.

- [ ] **Step 1: Write RED for atomic Evidence/overlay sealing**

Test same-ID exact retry, conflicting payload, exact city/package/catalog/criteria/ranking binding,
and acceptance of one already sealed generic four-source Evidence bundle without a second seal/sign
operation. Require overlay `completedAt` to be greater than or equal to all three independent fixed
ledger `completedAt` values, the safety ledger `completedAt`, every fixed `attemptedAt`, every generic
artifact `capturedAt`, and every safety-query `searchedAt`; never require independently completed
ledgers to share one exact timestamp. Require exactly three
`fixedAttemptLedgers` in canonical long-term-rent/urban-transit/fixed-broadband order, one for every
fixed terminal entry whether verified or unknown. Bind a verified ledger result/claim IDs to that
entry's exact claims and an unknown result/reason to that entry's blocker. Bind city/check/plan/
definition/assessment and every ledger artifact reference exactly once to the generic Evidence
manifest; no terminal artifact may be absent from or appear only in the ledger. Reject a sparse,
reordered, missing, extra, duplicate or provenance-drifting seal-input artifact union and altered
bytes even when caller-supplied SHA text is unchanged. Reload and assert every returned captured
entry retains exact live provenance needed by Task 10.

For safety, every previous-origin attempt resolves to an exact prior verified City Evidence/source-
plan/accepted URL lineage. Task 6 has already bound each reference's `artifactId`, `artifactSha256`,
run, source and role to the stored generic artifact. Task 7 alone validates the source-byte bridge:
raw mode binds `locator` to the exact canonical request/response URL lineage and requires the stored
captured-byte SHA-256 to equal `sourceSha256` (therefore `artifactSha256 === sourceSha256`);
transient mode parses the canonical retained inspection/navigation/denominator projection and
compares its `sourceLocator`, `sourceSha256` and retention disposition. Never compare the transient
stored projection SHA-256 itself with `sourceSha256`; it must equal `artifactSha256`.
The generic manifest verifies all stored artifact bytes and provenance. Cover both fixed ledgers and
the safety ledger with the overlay HMAC; validate the overlay chronology bound against every ledger
completion, fixed attempt, generic capture and safety search. Test overlay-without-generic rejection, generic-without-overlay
recovery, byte/hash/HMAC tamper and immutable UPDATE/DELETE. Mutate and re-sign fixed route order,
URL, reason, artifact/claim IDs, value/source-period policy versions, binding and times, plus safety query/provider/outcome/result order,
previous Evidence/source-plan provenance, redirect, authority/media/retention decision, artifact/
source hash, locator, rejection reason and `3/10/2` counters; every semantic mutation must fail
reconstruction.

- [ ] **Step 2: Run RED**

```bash
./node_modules/.bin/vitest run tests/integration/city-evidence-store.test.ts \
  tests/integration/database-schema.test.ts
```

- [ ] **Step 3: Add only the `city_evidence_snapshots` table and preflight**

Columns: ID FK to `evidence_snapshots`, unique check-run ID, mirrored city/country/package fields, schema/rules/context hash, canonical payload/hash/HMAC and completedAt. Add immutable triggers. Update all exact table/index/trigger inventories and `db.ts` reset-required preflight.

- [ ] **Step 4: Implement one immediate seal transaction and verified replay**

Factor reusable generic Evidence verification out of `evidence-store.ts`; do not add city branches to
old source-ID unions. Accept an already sealed, verified, exact four-source generic Evidence bundle
plus its exact complete live-artifact union, the three fixed ledgers and one safety ledger. Within one
immediate transaction, copy/append those exact live artifacts through the existing generic artifact
writer, persist or exact-replay the supplied already signed generic bundle, and then persist the
overlay; Task 7 must never call `sealEvidencePlan` or seal/hash/sign the generic bundle again. Before
overlay sealing, load and verify every previous-origin Evidence
reference and canonical-compare its city/municipality/definition/source-plan plus accepted URL with
the discovery input; no arbitrary current official URL may impersonate prior provenance. Require
each fixed and safety ledger reference to resolve to exactly one same-run generic artifact, validate
the raw or retained-projection bridge above, then cover all four ledgers and all context bindings with
the overlay HMAC in the same immediate transaction. On a lost insert race, read back and canonical-
compare. Cancellation or a thrown storage/parser/integrity error leaves no overlay row; an already
sealed generic snapshot without its overlay is recovered idempotently without a source call or a
second generic seal.

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
- Modify: `src/research/city-package.ts`
- Modify: `src/application/city-data-contracts.ts`
- Create: `src/application/install-city-package.ts`
- Create: `src/infrastructure/city-package-installation-composition.ts`
- Move from Task 6 and create here: `src/infrastructure/sources/installed-city-packages.ts`
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

export interface CityResearchPackageReadyCandidate {
  readonly definition: CityResearchPackageDefinition;
  readonly sourceContractStatus: "bounded_verified_or_unknown";
  readonly readiness: { readonly status: "ready"; readonly issues: readonly [] };
}

export type CityResearchPackageAvailability =
  | CityResearchPackageCandidate
  | CityResearchPackageReadyCandidate;

export function getCityResearchPackageAvailability(
  countryCode: string,
): CityResearchPackageAvailability | undefined;

// Task 9 evolves the Task 6 candidate-only assertion to this discriminated signature.
export function assertCityPackageReady(
  availability: CityResearchPackageAvailability,
): CityResearchPackageReadyCandidate;

export interface InstalledCityResearchPackage
  extends CityResearchPackageReadyCandidate {
  readonly registry: CityRegistryRevision;
  readonly catalog: CityCatalogRevision;
  readonly criteriaDefaults: InstalledCityCriteriaDefaults;
  readonly criterionDefinitions: readonly CityCriterionDefinition[];
  readonly evaluatorRegistry: CityCriterionEvaluatorRegistry;
  readonly fixedPlansByCityId: Readonly<Record<string, readonly [
    CityFixedSourcePlan<"si-city-long-term-rent">,
    CityFixedSourcePlan<"si-city-urban-transit">,
    CityFixedSourcePlan<"si-city-fixed-broadband">,
  ]>>;
  readonly safetySourcePlan: CitySafetySourcePlan;
  readonly officialAuthorityDirectory: OfficialAuthorityDirectory;
  readonly validateValue: CityFixedValueValidator;
  readonly validateSourcePeriod: CityFixedSourcePeriodValidator;
  readonly sealedCatalogArtifactIds: readonly string[];
  readonly sealedSourcePlanArtifactIdsByCityId: Readonly<Record<string, readonly string[]>>;
}

export interface InstalledCityPackageLookupPort {
  findReady(countryCode: string): InstalledCityResearchPackage | undefined;
}
```

Both store ports above live in `src/application/city-data-contracts.ts`; SQLite only implements them.
`CityResearchPackageReadyCandidate`, `CityResearchPackageAvailability`, the pure
`getCityResearchPackageAvailability` resolver and `assertCityPackageReady` live in inward Research
`src/research/city-package.ts`. A ready candidate carries only definition, source-contract status and
the empty ready discriminant; it does not contain Registry, Catalog, plans, validators or an installed
lookup result. `InstalledCityResearchPackage` remains the distinct full installed value.
It is also an inward Research contract in `src/research/city-package.ts`; only the lookup port belongs
to Application.
`InstalledCityPackageLookupPort` is an inward Application port in
`src/application/city-data-contracts.ts`; `installed-city-packages.ts` only implements it (and the
Task 7 `CityEvidencePackageReplayPort`) and never owns or re-exports a second public contract. Its
replay projection must be derived from the same exact installed value. The installed type/registry
may be implemented only after the exact criterion definitions/defaults/evaluators are approved and
the @2 Registry/catalog and per-member plan artifacts are sealed and reconstructed. No candidate may
be cast or relabelled as installed, and no installed value may be fabricated for current SI.

- [ ] **Step 1: Write store/install RED tests**

First assert the pure current SI availability remains the Task 6 not-ready candidate and fails with
`city_package_not_ready` and all four readiness issues before any installed lookup,
official-source call, database read/write or catalog row. Assert a synthetic ready availability is
returned unchanged by `assertCityPackageReady`; prove an absent `findReady` result stays distinct for
Task 14 to map only to `city_package_not_installed`. Positive installer tests use a local synthetic
ready candidate plus a separate local synthetic installed package with explicit synthetic sealed artifacts and approved
test-only criterion policy plus value/period validators; they must not relabel Slovenia fixtures.
Require each installed/replay projection to preserve exact claim-contract value/period policy
versions and validator results. Then cover out-of-band official catalog
capture/seal/publication, full considered-universe reconstruction
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
Start. Both administrative installation and later runtime resolution begin with the pure availability
and `assertCityPackageReady` boundary, without an Infrastructure call; package-unready is
`city_package_not_ready` and not `NEEDS_CONTEXT`. The installer does not call `findReady` to decide
readiness or require a package that it is about to install. It proves the approved exact criteria
policy, every fixed plan's complete claim contract, version-pinned canonical-scalar value validator,
version-pinned source-period validator, and a sealed source plan for
every member of the at-most-100 catalog, and all four readiness issues closed before constructing
and registering `InstalledCityResearchPackage`. Later Application runtime calls
`InstalledCityPackageLookupPort.findReady(countryCode)` only after pure readiness succeeded;
`city_package_not_installed` is reserved solely for `undefined` at that point, never for an existing
unready candidate and never as a slash-form alternative. A returned installed package must exactly
repeat the ready candidate definition/source-contract/readiness fields before use. A particular
frontier run may still check only ten.
`CityCatalogNeedsContextError` and `NEEDS_CONTEXT` remain exclusively the catalog-overflow outcome
for more than 100 mandatory capitals and insert no Registry/catalog rows. `appendVerified` and the installer accept only
`city-catalog@2`; an @1 publication request is `city_catalog_upgrade_required` and writes nothing.
`CityCatalogStore.loadVerified` still replays an already persisted historical @1 row, or the exact
sealed @2 catalog artifacts, through the rules-version-pinned package parser without HTTP, compares
the full Registry/population projection and only then reconstructs membership. Knowledge publication loads verified City Evidence
inside `BEGIN IMMEDIATE`, reconstructs all three fixed ledgers plus the complete safety ledger and
their accepted/reviewed URL lineages,
resolves the current head, rebuilds the full revision with injected integrity, rejects a check not
newer than the head, inserts, reloads and verifies the complete predecessor chain.

- [ ] **Step 5: Run GREEN and commit**

```bash
./node_modules/.bin/vitest run tests/integration/city-knowledge-store.test.ts \
  tests/integration/city-evidence-store.test.ts tests/integration/database-schema.test.ts \
  tests/integration/confirmed-life.test.ts tests/branch/life-git.test.ts
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/eslint src/application/install-city-package.ts \
  src/research/city-package.ts src/application/city-data-contracts.ts \
  src/infrastructure/city-package-installation-composition.ts \
  src/infrastructure/sources/installed-city-packages.ts \
  src/infrastructure/sqlite/city-{catalog,knowledge}-store.ts \
  tests/integration/city-knowledge-store.test.ts evals/install-city-package.ts
git diff --check
git add src/research/city-package.ts src/application/city-data-contracts.ts \
  src/application/install-city-package.ts \
  src/infrastructure/city-package-installation-composition.ts \
  src/infrastructure/sources/installed-city-packages.ts \
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

Construct a real sealed city bundle, replace `CitySafetyOfficialDocumentPort.inspect`,
`CitySafetySearchPort.search`, every fixed `CityFixedRoutePort.inspect`, generic
`OfficialSourcePort.capture` and `RequestStep` with throwing counted spies, replay twice, compare
canonical claims/blockers, all three fixed ledgers, the safety ledger, accepted and reviewed URLs,
context/completedAt, the verified manifest and every captured entry's byte/run/source/request/
response/capturedAt provenance, and assert every count remains zero.

- [ ] **Step 2: Run RED**

```bash
./node_modules/.bin/vitest run tests/integration/city-evidence-replay.test.ts
```

- [ ] **Step 3: Implement package-specific byte replay**

Load the signed overlay and generic artifacts, recursively load any explicitly referenced prior City
Evidence, use only `ports.package.loadExactReplayContract` to resolve the exact installed
package/version replay projection, and reconstruct and canonical-compare all three
fixed attempt ledgers against their ordered installed routes plus the safety attempt ledger with
verified previous provenance. Use only the returned `CapturedEntry` live provenance, recompute every
byte hash against the verified manifest, rerun the installed canonical-scalar value and source-period
validators on sealed permitted bytes/minimal projections, require the value validator's exact
canonical string equality, and
canonical-compare claims, blockers, fixed attempt order/URLs/reasons/artifacts/claim IDs, safety
queries/candidate order/redirects/counters/accepted/reviewed URLs, parser/rules versions and context.
Reject an absent or mismatched package replay contract, cycles and wrong-city/source-plan lineage.
The implementation receives exactly the Task 7 `read`/`integrity`/`package` capability object; it
cannot seal or reach a live-source/search port. Never call `CityFixedRoutePort.inspect`,
`CitySafetyOfficialDocumentPort.inspect`, `CitySafetySearchPort.search`,
`OfficialSourcePort.capture` or `RequestStep`.

- [ ] **Step 4: Add drift/tamper tests**

Reject parser version drift, wrong package/city/context, altered bytes/hash, missing artifact,
missing/altered/cyclic prior Evidence lineage, changed blocker, fixed route/URL/order/reason/artifact/
claim/time mutation and every other re-signed semantic mutation.

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
