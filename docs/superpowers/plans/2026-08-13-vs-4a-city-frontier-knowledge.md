# VS-4A City Evidence and Knowledge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Install one reviewable city research package and publish replayable, append-only City Evidence and full four-fact City Knowledge without carrying stale predecessor values.

**Architecture:** Existing generic artifact/Evidence storage remains the only raw-byte owner. A narrow signed City Evidence overlay binds the generic snapshot to city/frontier context and durable `completedAt`. Research builds every current value/outcome from one structural, already-verified Evidence view and obtains unknown-fact metadata only from the exact reconstructed installed contract tuple, using inward Research DTOs only (never Application DTO imports); SQLite serializes revisions per city and reconstructs every row from sealed Evidence. Country Knowledge remains unchanged.

**Tech Stack:** TypeScript, the existing generic `ResearchPlan`/Evidence store, official source adapters, SQLite immediate transactions, canonical JSON/SHA-256/HMAC and Vitest.

**Depends on:** completed [`VS-4A Foundations`](2026-08-13-vs-4a-city-frontier-foundations.md) and its exact source contracts. `installable` means a sealed Catalog projection with `schemaVersion === "city-catalog@1"` and `rulesVersion === CITY_CATALOG_RULES_VERSION` (`"city-catalog@2"`) plus four complete deterministic plans whose city outcomes are `verified | unknown`; missing or malformed catalog/plan policy remains a real blocker.

**Required safety dependency:** completed [`VS-4A Safety Source Discovery`](2026-08-14-vs-4a-safety-source-discovery.md). A complete safety, rent, transit or broadband plan may close a city as evidence-backed unknown; a missing catalog projection or incomplete four-fact plan policy, not an unknown outcome, blocks installation.

**Format metadata:** `review-matrix` — executable five-task checklist whose length comes from mandatory source, persistence, RED/GREEN, replay and commit cells; it is linked from the short master index and is not a narrative specification.

## Constraints specific to this plan

- Task 6 implementation proceeds locally against committed fixtures and local synthetic boundary vectors under `PROCEED_WITH_TASK_6; PUBLICATION_PENDING_ARTIFACTS`. Administrative installation, Start and publication remain blocked until the sealed Catalog projection with schema `"city-catalog@1"` and current `CITY_CATALOG_RULES_VERSION` plus four deterministic per-member plans exist. Never create or publish a production package from synthetic fixtures; a completed plan's `unknown` is not a stop condition.
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

Catalog validates the complete 104-row considered universe but cannot emit a Catalog with
`rulesVersion === CITY_CATALOG_RULES_VERSION` or any Registry/catalog publication. Rent validates only approved filtering and median mechanics; its
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
feasibility without a sealed install artifact bound to `CITY_CATALOG_RULES_VERSION`, rent mechanics without verified publication, transit and
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
- Modify narrowly: `src/research/city-package.ts`
- Modify narrowly: `src/research/city-evidence.ts`
- Create: `src/research/city-safety-artifact-bridge.ts`
- Create: `src/infrastructure/sqlite/city-evidence-store.ts`
- Modify narrowly: `tests/research/city-evidence-composition.test.ts`
- Create: `tests/research/city-safety-artifact-bridge.test.ts`
- Create: `tests/integration/city-evidence-store.test.ts`
- Modify narrowly: `src/decision/city-catalog.ts`
- Modify narrowly: `src/application/replay-evidence.ts`
- Modify narrowly: `src/infrastructure/integrity.ts`
- Modify narrowly: `src/infrastructure/cold-start-composition.ts`
- Modify narrowly: `src/infrastructure/composition-root.ts`
- Modify: `src/infrastructure/sqlite/schema.sql`
- Modify: `src/infrastructure/sqlite/db.ts`
- Modify narrowly: `src/research/research-plan.ts`
- Modify narrowly: `src/infrastructure/sqlite/evidence-store.ts`
- Modify narrowly: `tests/domain/city-catalog.test.ts`
- Modify narrowly: `tests/integration/evidence-store.test.ts`
- Modify narrowly: `tests/integration/current-evidence.test.ts`
- Modify narrowly: `tests/integration/cold-start.test.ts`
- Modify: `tests/integration/database-schema.test.ts`
- Modify exact table inventories: `tests/integration/confirmed-life.test.ts`
- Modify exact table inventories: `tests/branch/life-git.test.ts`

**Interfaces:**

```ts
export interface CityEvidenceReplayIntegrity extends CityDecisionIntegrity {
  hashBytes(bytes: Uint8Array): string;
}

export interface CityEvidenceContext {
  readonly schemaVersion: "city-evidence-context@1";
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
  readonly evidenceRulesVersion: string;
  readonly assessmentAt: string;
  readonly completedAt: string;
}

export function cityEvidenceContextHash(
  context: CityEvidenceContext,
  integrity: CityDecisionIntegrity,
): string;

export interface CityEvidenceSnapshot {
  readonly schemaVersion: "city-evidence@1";
  readonly id: string; // exactly `${cityCheckRunId}:evidence`, same as generic EvidenceSnapshot
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
  readonly evidenceRulesVersion: string;
  readonly assessmentAt: string;
  readonly fixedAttemptLedgers: CityFixedAttemptLedgerTuple;
  readonly safetyAttemptLedger: CitySafetyAttemptLedger;
  readonly contextHash: string;
  readonly completedAt: string;
  readonly payloadHash: string;
  readonly hmac: string;
}

export type CityEvidencePayload = Omit<CityEvidenceSnapshot, "payloadHash" | "hmac">;

export type CityFixedAttemptLedgerTuple = readonly [
  CityFixedAttemptLedger<"si-city-long-term-rent">,
  CityFixedAttemptLedger<"si-city-urban-transit">,
  CityFixedAttemptLedger<"si-city-fixed-broadband">,
];

export interface CityEvidenceSealInput extends CityEvidenceContext {
  readonly genericEvidence: SealedEvidence<
    SloveniaCityFactSourceId,
    CityEvidenceClaim
  >;
  readonly artifacts: readonly LiveCapturedArtifact<SloveniaCityFactSourceId>[];
  readonly fixedAttemptLedgers: CityFixedAttemptLedgerTuple;
  readonly safetyAttemptLedger: CitySafetyAttemptLedger;
}

export type CityEvidenceExpectations = CityEvidenceContext;

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

// Inward Research value, shared by package installation, Ranking and replay.
export interface InstalledCityPackageExactKey {
  readonly countryCode: string;
  readonly packageId: string;
  readonly packageSchemaVersion: string;
  readonly catalogRevisionId: string;
  readonly evidenceRulesVersion: string;
}

export interface CityEvidencePackageReplayPort {
  loadExactReplayContract(
    key: InstalledCityPackageExactKey,
  ): CityPackageEvidenceReplayContract | undefined;
}

export interface CityPackageEvidenceReplayContract {
  readonly installedPackageManifest: {
    readonly id: string;
    readonly key: InstalledCityPackageExactKey;
  };
  readonly definition: CityResearchPackageDefinition;
  readonly catalogProjection: CityCatalogProjection;
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
  readonly integrity: CityEvidenceReplayIntegrity;
  readonly package: CityEvidencePackageReplayPort;
}

export interface CityEvidenceStorePort extends CityEvidenceReadPort {
  seal(input: CityEvidenceSealInput): CityEvidenceSnapshot;
}

// Inward Research contract used by Application and implemented by Infrastructure.
export interface VerifiedLoadExpectations<S extends string = SourceId> {
  readonly assessmentDate?: string;
  readonly parserVersions?: Readonly<Record<S, string>>;
  readonly rulesVersion?: string;
}

export interface VerifiedEvidenceBundle<
  S extends string = SourceId,
  C extends Claim<unknown, S> = Claim<unknown, S>,
> {
  readonly snapshot: EvidenceSnapshot<S, C>;
  readonly entries: readonly ParserEntry<S>[];
}

// Inward Application runtime port; Infrastructure composition implements it.
export interface EvidenceReplayIntegrityFactoryPort {
  create(hmacKey: string): EvidenceIntegrity;
}

export interface ReplayEvidenceRuntimePorts<
  S extends string = SourceId,
  C extends Claim<unknown, S> = Claim<unknown, S>,
> {
  readonly store: ReplayEvidenceStore<S, C>;
  readonly integrityFactory: EvidenceReplayIntegrityFactoryPort;
}

export interface ReplayEvidencePorts extends ReplayEvidenceRuntimePorts {
  readonly parsers?: EvidenceParsers;
}

// Infrastructure implementation; imported only by Infrastructure composition/adapters.
export function createCityEvidenceReplayIntegrity(
  integrity: CityDecisionIntegrity,
): CityEvidenceReplayIntegrity;

// Pure inward Research comparison; it uses the caller's one canonicalizer.
export function evidenceCanonicalEqual(
  left: unknown,
  right: unknown,
  integrity: Pick<EvidenceIntegrity, "canonical">,
): boolean;

// Module-private Infrastructure result; never imported by Application/Research.
interface VerifiedStoredEvidenceBundle<
  S extends string,
  C extends Claim<unknown, S>,
> {
  readonly snapshot: EvidenceSnapshot<S, C>;
  readonly manifest: EvidenceManifest<S, C>;
  readonly entries: readonly CapturedEntry<S>[];
}

/** @internal */
export function insertLiveArtifact<S extends string>(
  database: Database.Database,
  artifact: LiveCapturedArtifact<S>,
): void;

/** @internal */
export function loadVerifiedEvidenceBundle<
  S extends string,
  C extends Claim<unknown, S>,
>(
  database: Database.Database,
  id: string,
  integrity: EvidenceIntegrity,
  expected?: VerifiedLoadExpectations<S>,
): VerifiedStoredEvidenceBundle<S, C>;

export interface CitySafetyArtifactBridgeInput {
  readonly cityCheckRunId: string;
  readonly catalog: CityCatalogRevision;
  readonly sourcePlan: CitySafetySourcePlan;
  readonly authorityDirectory: OfficialAuthorityDirectory;
  readonly ledger: CitySafetyAttemptLedger;
  readonly artifacts: readonly LiveCapturedArtifact<"si-city-safety">[];
}

export interface CitySafetyArtifactBridge {
  readonly ledger: CitySafetyAttemptLedger;
  readonly artifacts: readonly LiveCapturedArtifact<"si-city-safety">[];
}

export function reconstructCitySafetyArtifactBridge(
  input: CitySafetyArtifactBridgeInput,
  integrity: CityEvidenceReplayIntegrity,
): CitySafetyArtifactBridge;

export function reconstructVerifiedCityCatalog(
  input: ReconstructCityCatalogInput,
  integrity: CityDecisionIntegrity,
): CityCatalogProjection;

export function reconstructCityFixedSourcePlan<
  S extends SloveniaCityFixedSourceId,
>(value: unknown, expectedSourceId: S): CityFixedSourcePlan<S>;
```

Define the City context, snapshot, package replay and store/read port types above in
`src/application/city-data-contracts.ts`; the SQLite adapter structurally implements those inward
contracts. The synchronous generic helper functions and their stored-row result remain Infrastructure
internals in `src/infrastructure/sqlite/evidence-store.ts`. The public `VerifiedEvidenceBundle` and
`VerifiedLoadExpectations` instead live inward in `src/research/research-plan.ts`; Application imports
them only from Research, and the SQLite adapter implements/maps to them. The module-private
`VerifiedStoredEvidenceBundle`, `SnapshotRow` and `ArtifactRow` stay in
`src/infrastructure/sqlite/evidence-store.ts` and are never exported as an inward/public contract. The
Research bridge interfaces and function live in
`src/research/city-safety-artifact-bridge.ts`; that file imports no Application module.
`reconstructVerifiedCityCatalog` is a narrow pure Decision addition in `src/decision/city-catalog.ts`.
`reconstructCityFixedSourcePlan` is a public pure Research function in
`src/research/city-evidence.ts`; `runCityFixedSourcePlan`, the City store and later Task 10 reuse it
instead of retaining or duplicating a private plan sanitizer.
`CityEvidenceReplayIntegrity` is an inward Research contract in `src/research/city-evidence.ts`. It
extends `CityDecisionIntegrity` only with `hashBytes(Uint8Array)` and deliberately has no `sign`.
Infrastructure `integrity.ts` implements
`createCityEvidenceReplayIntegrity(integrity): CityEvidenceReplayIntegrity` with bound canonical/hash
delegates and `node:crypto` byte SHA-256; Research and Application import neither that module nor any
crypto adapter. Package, catalog, fixed, safety-plan and ranking reconstruction get
only `CityDecisionIntegrity { canonical, hash }`; the artifact bridge and Task 10 byte replay get
`CityEvidenceReplayIntegrity { canonical, hash, hashBytes }`.

Full `EvidenceIntegrity { canonical, hash, sign }` is exposed in Application only to the one generic
`sealEvidencePlan` recomputation through the injected inward `EvidenceReplayIntegrityFactoryPort`, and
is otherwise retained by store-owned seal/signature verification. No other replay or pure reconstructor
receives `sign`. Every narrowed/full view delegates to the same injected canonical/hash functions;
there is no second canonicalizer.

`CityEvidenceContext` is a closed object with exactly the fourteen keys shown above. All strings are
nonempty canonical identifiers or canonical UTC millisecond instants as appropriate; `definitionIds`
has exactly the four `CityCriterionId` keys, and `assessmentAt <= completedAt`.
`cityEvidenceContextHash` is pure, rejects missing/extra/noncanonical context fields and returns exactly
`integrity.hash(integrity.canonical(<the exact context object>))`. The seal input and expectations carry
those same fields and context schema version. The overlay repeats every field except that its own
`schemaVersion` remains `city-evidence@1`; it adds only `id`, the four ledgers, `contextHash`,
`payloadHash` and `hmac`. Its ID and the underlying generic snapshot ID are both exactly
`${context.cityCheckRunId}:evidence`; no caller-selected Evidence ID is accepted. Its signed payload is
the exact `CityEvidencePayload` object without `payloadHash`/`hmac`. Compute exactly:

```ts
const canonicalPayload = integrity.canonical(payload);
const payloadHash = integrity.hash(canonicalPayload);
const hmac = integrity.sign(canonicalPayload);
```

Persist that same `canonicalPayload`. On load recompute all three equations from the parsed exact
payload. Compare every stored/recomputed payload hash and HMAC with a length-safe constant-time hex
comparison; ordinary string equality is forbidden for those comparisons.
Require the generic snapshot `contextHash` to equal the pure result and its `assessmentDate` to equal
the UTC calendar date `assessmentAt.slice(0, 10)`. Only at the generic seal boundary map
`SealEvidenceInput.rulesVersion = context.evidenceRulesVersion`; the resulting generic
`EvidenceSnapshot.rulesVersion` must equal `context.evidenceRulesVersion`. The context and overlay have
no ambiguous `rulesVersion` field. Use the generic snapshot ID as the only overlay ID.

`CityEvidenceSealInput` accepts exactly one already sealed generic four-source live bundle, the complete
`LiveCapturedArtifact[]` for that bundle, the canonical three-ledger tuple and one safety ledger; it does not
accept loose terminal entries or a generic sealing callback. The first operation at every public City
store entry is an ownership snapshot of the complete input: traverse only own data descriptors of
closed plain objects/dense arrays, reject accessors, symbols and non-plain prototypes, and copy every
`Uint8Array` into a private non-shared `ArrayBuffer`. Reject any view backed by `SharedArrayBuffer`.
This snapshot step invokes no canonical/hash/sign/package/replay callback and opens no transaction.
All validation, replay callbacks, canonicalization, byte hashing and persistence then use only that one
owned snapshot; the borrowed caller graph and buffers are never read again. Returned byte views are
fresh copies as well.

After ownership capture and before the first artifact or snapshot write, structurally validate the
owned supplied bundle, recompute
`canonicalManifest = integrity.canonical(genericEvidence.manifest)`, require it to equal the supplied
`genericEvidence.canonicalManifest`, recompute and compare
`integrity.hash(canonicalManifest)` and `integrity.sign(canonicalManifest)` with the supplied snapshot
manifest hash and HMAC using the same length-safe constant-time hex comparison, and canonical-compare
the manifest snapshot payload with the supplied snapshot.
This is verification of the original signature, not a second call to `sealEvidencePlan`, a replacement
signature, or permission to mutate the supplied bundle.

The artifact array must be dense and exactly match `genericEvidence.manifest.artifacts` in manifest
order, one captured artifact for each distinct manifest artifact ID with no missing, extra or duplicate
captured ID and exact run/source/role/request/URL/response/status/media/capturedAt/byte-length/SHA
provenance. Recompute SHA-256 from every supplied byte array before storage. Safety ledger references
are occurrence-based: repeated references to the same artifact ID are allowed only when their complete
role/document-role/artifact-SHA/source-SHA/locator values are canonically identical. Every occurrence is
bridge-validated, conflicting repeats fail, and each distinct referenced artifact ID resolves to exactly
one manifest row and one captured artifact. Do not require one manifest row per repeated occurrence.

`CityPackageEvidenceReplayContract` is the only source of package semantics at seal, load and Task 10.
The store constructs one closed `InstalledCityPackageExactKey` directly from the context's
country/package/schema/catalog/`evidenceRulesVersion` fields and passes that value, without renaming or
duplicating its five-field shape, to `loadExactReplayContract(key)`. Its definition must equal those
context package fields, `definition.evidenceRulesVersion === context.evidenceRulesVersion`, and its
source IDs must equal the canonical four-source order. Before using any returned semantic value,
require `installedPackageManifest` to be a fresh frozen closed audit object with exactly `id/key` and
require its key to canonically equal exactly
`{ countryCode: context.countryCode, packageId: context.packageId,
packageSchemaVersion: context.packageSchemaVersion, catalogRevisionId: context.catalogRevisionId,
evidenceRulesVersion: context.evidenceRulesVersion }`. The definition, catalog root, plans and directory must
canonically equal the full closed serialized projection reconstructed for that signed key; validator/
evaluator callables are never canonicalized and must be the exact capabilities selected by the
adapter's verified signed behavior-version key, while criteria defaults must already equal the
independently compiled Task 9 approved-defaults selection before evaluator normalization. A visible
match with hidden key, serialized-projection
or behavior-version drift is `integrity_mismatch`. The audit `id` is useful for logging
and traceability, but the City context persists no expected manifest ID, so Task 7/Application must not
pretend to authenticate it by caller comparison. The Task 9 manifest store/installed-package adapter
instead guarantees before return that this ID, payload hash and HMAC were recomputed from the persisted
canonical bytes. Forged ID/HMAC rows fail inside that adapter and never reach this consumer. The replay
value supplies the exact
`catalogProjection: { registry, catalog }`, not a bare catalog. Before inspecting visible fields or
members, call `reconstructVerifiedCityCatalog(catalogProjection, replayIntegrity)`. That pure function
preserves the existing unverified `reconstructCityCatalog` API, but independently recomputes and verifies
the Registry ID from the exact canonical Registry payload, reconstructs the complete candidate basis,
coverage and membership under the supplied catalog's exact `rulesVersion` (legacy
`LEGACY_CITY_CATALOG_RULES_VERSION` or current `CITY_CATALOG_RULES_VERSION`) while requiring
`catalog.schemaVersion === "city-catalog@1"`,
recomputes the catalog ID from the exact canonical catalog payload, requires
`catalog.registryRevisionId === registry.id`, canonical-compares both complete supplied objects with the
reconstructed projection, and returns a fresh frozen self-consistent projection. Thus a forged/stale ID
or an internally inconsistent member/root cannot become replay context. This pure function is not an
installation-authority lookup and deliberately accepts a different, fully valid projection whose
Registry/catalog payloads and hash-derived IDs are mutually consistent. Task 7's independent trust
anchor is the already signed closed context plus the exact replay lookup key: the returned catalog ID
must equal `context.catalogRevisionId`, so a coherent alternate root with a different ID still fails
both seal and load. Setup/Start's separate latest-installed trust anchor is specified in Task 9/Core;
Continue and Task 7/10 remain pinned to their frozen catalog revision rather than following latest.
The pure catalog reconstructor retains `LEGACY_CITY_CATALOG_RULES_VERSION` support solely for
administrative catalog load/replay. A City Evidence package contract must come from a Task 9 installed
manifest whose reconstructed catalog has `schemaVersion === "city-catalog@1"` and
`rulesVersion === CITY_CATALOG_RULES_VERSION`; seal, load and Task 10 reject the legacy catalog-rules
value as `city_catalog_upgrade_required`, and no new City run or Evidence overlay may be created under
legacy catalog rules.

The verified catalog ID must equal `context.catalogRevisionId`; verified Registry/catalog
country/package identity must equal context and definition; `context.packageSchemaVersion` must equal
only the signed package definition/manifest package schema, never `catalog.schemaVersion` or
`catalog.rulesVersion`; and the city must be exactly one verified catalog member. Reconstruct the
authority directory and safety plan with that verified catalog and the narrow replay integrity.
`reconstructCityFixedSourcePlan(value, expectedSourceId)` first requires
`expectedSourceId` to be one of the three fixed source literals and runtime-requires the closed value's
`sourceId === expectedSourceId`; callers cannot select an arbitrary generic `S` for an unchecked value.
It accepts only the nine exact
`CityFixedSourcePlan` keys; requires a dense nonempty route array whose route objects have exactly
`routeId/navigationUrl`, canonical HTTPS URLs and unique route IDs/URLs; requires canonical nonempty
plan/city/definition/parser/rules IDs and the exact source-to-criterion mapping; and closes the complete
claim contract to its twelve exact keys, the plan's source/criterion/definition, canonical scope/area/
geo/unit/denominator and freshness/value/source-period policies, with
`valueKind === "canonical_scalar"`. It snapshots rather than freezes caller data and returns a fresh
recursively frozen plain-object/array copy. It proves plan closure and internal bindings, not that an
otherwise valid plan is the installed one; each caller must still bind every returned field to its
independently established catalog/package/definition/version context.

The `fixedPlansByCityId` key set must equal the verified catalog member ID set. Before selecting the
context city, reconstruct all three plans in canonical long-term-rent/urban-transit/fixed-broadband
order for every member tuple by passing the corresponding literal as `expectedSourceId`, then bind
their exact plan/city/source/criterion/definition/parser/rules/
claim values to that member, the four definition IDs, `SLOVENIA_CITY_FACT_VERSIONS`, the generic parser
versions and the package's approved installed policy. Only then select
`fixedPlansByCityId[context.cityId]`; reject any absent/extra/mis-keyed/sparse/reordered tuple. Never
accept a caller-supplied plan, bare catalog or current/latest catalog as a substitute.

At both seal and load, reconstruct every fixed ledger with the corresponding exact replay plan,
`assessmentAt: context.assessmentAt` and `notAfterAt: context.completedAt`; reconstruct the safety ledger
with `runId: context.cityCheckRunId`, the verified replay catalog, reconstructed source plan/directory
and narrow replay integrity, including verified prior-Evidence lineage. Only then may the overlay HMAC
be accepted or a new overlay be signed. All four ledgers have
`assessmentAt === context.assessmentAt`, and require
`context.assessmentAt <= each ledger.completedAt <= context.completedAt`.

Chronology is ownership-specific and identical at seal and load. For each fixed attempt, require
`context.assessmentAt <= attemptedAt <= its fixed ledger.completedAt` and, for every artifact named by
that attempt, `attemptedAt <= capturedAt <= its fixed ledger.completedAt`; every fixed artifact ID has
exactly one attempt owner. Safety searches remain nondecreasing and each satisfies
`context.assessmentAt <= searchedAt <= safetyAttemptLedger.completedAt`. For every safety artifact
reference occurrence, define `originAt` as the matching query's `searchedAt` for a search-origin
candidate and `context.assessmentAt` for configured/previous-origin candidates. Order occurrences by
candidate index and then artifact-reference index. For each distinct artifact ID, only its first such
occurrence is the acquiring occurrence and must satisfy `firstOriginAt <= capturedAt`; later canonically
identical occurrences are cached reuse and may legitimately have `originAt > capturedAt`. Every reuse is
still bridge-validated, and the one stored artifact must satisfy
`capturedAt <= safetyAttemptLedger.completedAt` for every owning occurrence (and, generally,
`capturedAt <=` every fixed/safety ledger completion that owns its ID). Because each first origin is no
earlier than context assessment, every generic artifact capture remains between assessment and every
owning ledger completion, not merely below the outer context completion.

Resolve prior-origin Evidence at seal and load with one iterative, depth-safe chain walk. Initialize a
visited-ID set with the current `${cityCheckRunId}:evidence`; before every prior load, reject an already
visited ID, then add it. This rejects self, two-node and longer cycles without recursive stack growth.
Canonical-verify every prior overlay/generic bundle and its own replay contract, require each edge's
`prior.snapshot.completedAt <= current.snapshot.assessmentAt`, and bind the exact source-plan,
municipality, definition and accepted URL before advancing. An absent/tampered prior row or cyclic chain
fails the current seal/load; Task 7 does not defer cycle safety to Task 10.

`reconstructCitySafetyArtifactBridge` accepts only the already reconstructed, catalog-bound plan,
directory and ledger plus the complete captured safety artifact union. For raw-retention policies it
requires `sourceSha256 === artifactSha256 === stored sha256`, the exact locator in request/response URL
lineage and an allowed source media type. For transient retention it requires stored SHA to equal
`artifactSha256` (never `sourceSha256`), decodes UTF-8 JSON, and requires the bytes to equal the injected
canonical serialization of one closed schema: `city-safety-retained-navigation@1`,
`city-safety-retained-inspection@1` or `city-safety-retained-denominator@1`. Every projection has exact
`sourceSha256`, `sourceLocator`, `sourceMediaType`, `retentionPolicyId` and
`transientRawDeleted: true`. The closed navigation projection has exactly those common keys plus
`schemaVersion`, `cityId`, `municipalityCode`, `publisherId`, `publisherNavigationUrl`,
`resolvedNavigationUrl`, `officialTrace`, `confirmedDocumentUrl` and `documentLocatorPolicyId`. The
closed inspection projection has exactly the common keys plus `schemaVersion`, `cityId`,
`municipalityCode`, `publisherId`, `dataAuthorityId`, `publisherNavigationUrl`,
`resolvedEvidenceUrl`, `officialTrace` and `outcome`; usable outcome has exactly
`kind/referenceYear/quantity/denominator`, while rejected outcome has exactly `kind/basis` matching the
closed `CitySafetyRetainedRejectionBasis`. The closed denominator projection has exactly the common keys
plus `schemaVersion`, `publisherId`, `municipalityCode`, `referenceDate` and `population`.
Bind every such field to the exact candidate occurrence and reconstructed plan/directory. The
denominator projection also equals the candidate's SURS publisher, municipality, reference date,
population, media and artifact binding. Before any byte-SHA comparison, the bridge copies each input
artifact byte view into an owned private non-shared base `Uint8Array`, passes a separate further private
copy only to `integrity.hashBytes`, validates the returned lowercase SHA-256 against stored/ledger
bindings, decodes and compares only the unchanged base copy, and returns a third fresh copy. It never
canonicalizes bytes as JSON merely to hash them. Reject a `SharedArrayBuffer` view before invoking the
capability; mutation by a fake `hashBytes` callback therefore cannot affect the bytes subsequently
decoded, compared or returned. Return fresh copied artifacts and ledger. This is a pure
Research replay boundary: SQLite must call it at seal and load; do not export/reuse Application's
private live-inspection sanitizer, import Application into Research, or duplicate this bridge inside
SQLite. The completed S2/S3 producer needs no change in Task 7.

Persist copied live bytes, the verified already signed generic bundle and the newly signed City overlay
in the same synchronous `BEGIN IMMEDIATE` transaction without a live source call. An exact already-
persisted generic bundle is the idempotent recovery case. `VerifiedCityEvidence` returns the signed
overlay with the verified generic snapshot, verified manifest and `CapturedEntry` values whose artifacts
retain fresh copied bytes plus full run/source/request/response/capture provenance.
`SqliteCityEvidenceStore` is constructed conceptually as
`new SqliteCityEvidenceStore(database, integrity, packageReplay)` and owns no other dependency: no
public contract, latest-catalog lookup, installed-package registry, source, search, request, capture or
seal port. `CityEvidenceReplayPorts` likewise has only read, integrity and package capabilities.

- [ ] **Step 1: Write pure context, catalog/fixed-plan and safety artifact-bridge REDs**

In `city-evidence-store.test.ts`, require exact context keys, canonical timestamp/identifier validation,
the exact `integrity.hash(integrity.canonical(context))` result, definition-key closure, and rejection of
missing/extra/mutated fields. The exact context/overlay key is `evidenceRulesVersion`; reject an
otherwise equivalent `rulesVersion` key and prove only the generic `SealEvidenceInput.rulesVersion` /
`EvidenceSnapshot.rulesVersion` boundary receives that value. Compile-check
`CityEvidencePackageReplayPort.loadExactReplayContract(key: InstalledCityPackageExactKey)` and reject a
second object shape with a `rulesVersion` field. Prove `assessmentDate` must be the UTC date of
`assessmentAt`; schema/readback tests require the mirrored `evidence_rules_version` column and no City-
overlay `rules_version` alias.

In `city-catalog.test.ts`, drive `reconstructVerifiedCityCatalog` with real built Registry/catalog
projections whose `schemaVersion` is always `"city-catalog@1"`, for both historical
`LEGACY_CITY_CATALOG_RULES_VERSION` and current `CITY_CATALOG_RULES_VERSION`. Reject a forged Registry ID, forged catalog ID,
wrong Registry root, drift whose IDs/member projection were not recomputed consistently, wrong
`registryRevisionId`, and any noncanonical full-object difference. Separately construct a second,
fully valid alternate Registry+catalog root with all payloads, membership and both IDs recomputed and
prove the pure function accepts it as self-consistent; authority selection belongs to an external trust
anchor, not this function. Require fresh frozen canonical Registry and catalog copies. Assert the
function accepts only `CityDecisionIntegrity` and performs no sign, store, source or network operation.

In `city-evidence-composition.test.ts`, call
`reconstructCityFixedSourcePlan(value, expectedSourceId)` directly for all three
source types. Require exact plan/claim/route key closure, a dense nonempty route array, canonical unique
route IDs and HTTPS URLs, canonical plan/city/definition/parser/rules/policy identifiers, exact
source-to-criterion and claim-to-plan bindings, `canonical_scalar`, and fresh recursively frozen
nonaliased output. Reject every missing/extra/sparse/duplicate/noncanonical route, invalid plan/version
and claim binding. Compile-check that each literal `expectedSourceId` narrows the public generic return
type, and reject a valid plan paired with either other fixed-source literal before any callback. Prove
`runCityFixedSourcePlan` invokes
this same function before its first scheduler/route-port operation and uses only the returned copy;
mutation and malformed-plan cases remain zero-port-call REDs rather than a second private validator.

In `city-safety-artifact-bridge.test.ts`, cover raw municipal and denominator bytes, each of the three
canonical retained schemas, every common projection field and all candidate/municipality/publisher/
trace/usable/rejected/quantity/denominator bindings. Reject noncanonical JSON, invalid UTF-8, raw or
projection source-hash/locator/media/retention drift, stored artifact-SHA drift, wrong schema/extra key,
and every semantic binding mutation. Prove repeated canonically identical references are allowed and
each occurrence is checked against the single stored artifact resolved by its ID; conflicting repeats,
duplicate stored artifacts and missing/extra distinct artifacts fail. Assert fresh nonaliased bytes and no Application
import or private-sanitizer dependency. Inject a `CityEvidenceReplayIntegrity` with only
canonical/hash/hashBytes, assert raw and retained byte SHA-256 vectors, and make `hashBytes` mutate its
argument to prove the bridge hashes/decodes/returns only private non-shared copies. Compile-check that
the bridge cannot observe `sign`; catalog/fixed/safety-plan reconstruction remains limited to the
smaller canonical/hash `CityDecisionIntegrity` view.

- [ ] **Step 2: Write RED for atomic Evidence/overlay sealing and replay**

Require generic and overlay IDs to be exactly `${cityCheckRunId}:evidence`. Test same-ID exact retry and
conflict, same-check-run exact retry, the same check-run paired with a different ID, the same derived ID
with a different payload, and lookup/readback by both ID and unique check-run ID. A different check-run
necessarily derives a different ID; an existing row under either unique key is idempotent only when
generic bundle, context, ledgers and overlay payload are canonically identical, otherwise it is an
integrity conflict. Exercise a lost race
on each unique constraint and require exact canonical readback or conflict. Test exact
city/package/catalog/criteria/ranking/context binding and acceptance of one already sealed generic
four-source Evidence bundle without a second `sealEvidencePlan` call or replacement signature. Mutate
the supplied `canonicalManifest`, manifest payload, manifest hash and HMAC independently, including
internally consistent-looking replacements, and prove rejection before the first write. Require the
exact overlay `canonicalPayload`/`payloadHash`/`hmac` equations; reject wrong-length, malformed and
equal-prefix/different-suffix hash/HMAC values through the constant-time comparator path.

At store entry, use adversarial getters/accessors, symbol keys, non-plain prototypes, sparse arrays,
`SharedArrayBuffer`-backed views, caller mutation, and fake integrity/package-replay callbacks that
reentrantly mutate every borrowed metadata field and byte buffer. Accessors/SAB/non-closed input must
fail before a callback/transaction. Otherwise only the eagerly owned metadata snapshot and private
non-shared byte copies may affect validation/persistence/readback; caller mutation during or after a
callback cannot alter the stored bytes, provenance, canonical payload or comparison result.

Require all four ledger `assessmentAt` values to equal context `assessmentAt`; require generic
`assessmentDate` to equal its UTC date. Cover every boundary and one-millisecond inversion for
`context.assessmentAt <= each fixed/safety completedAt <= context.completedAt`, fixed
`attemptedAt <= each owned capturedAt <= fixed completedAt`, safety
`context.assessmentAt <= every searchedAt`,
`firstOriginAt <= capturedAt` only for each distinct artifact ID's first acquiring occurrence,
`capturedAt <=` every completion whose ledger owns that ID, nondecreasing safety searches, and
`prior.completedAt <= current.assessmentAt`; never require a cached reuse's later search/origin to
precede its already acquired capture, and never require independently completed ledgers to share one
exact timestamp. Add an explicit positive fixture whose SURS denominator is captured by the first
configured candidate and reused by a later search-origin candidate with
`capturedAt < laterQuery.searchedAt`; both seal and load pass while both occurrences remain bridge-
validated. Forge the first acquiring occurrence so its search `searchedAt > capturedAt` and require
both seal and load to fail. Require exactly three
`fixedAttemptLedgers` in canonical long-term-rent/urban-transit/fixed-broadband order, one for every
fixed terminal entry whether verified or unknown. Bind a verified ledger result/claim IDs to that
entry's exact claims and an unknown result/reason to that entry's blocker. Bind city/check/plan/
definition/assessment and every distinct ledger artifact ID to exactly one generic Evidence manifest
row; validate every repeated safety reference occurrence. No terminal artifact may be absent from or
appear only in the ledger. Reject a sparse,
reordered, missing, extra, duplicate or provenance-drifting seal-input artifact union and altered
bytes even when caller-supplied SHA text is unchanged. Reload and assert every returned captured
entry retains exact live provenance needed by Task 10.

In `evidence-store.test.ts`, add an import-boundary RED that scans every static, type-only and dynamic
import in `src/application/**` and rejects every path into `src/infrastructure/**`, not only the SQLite
store. Explicitly prove `application/replay-evidence.ts` imports neither
`createEvidenceIntegrity`/`canonicalJson` nor any other Infrastructure symbol. Add compile-checked
assignments proving `SqliteEvidenceStore` still satisfies Application's `ReplayEvidenceStore` through
the inward Research `VerifiedLoadExpectations`/`VerifiedEvidenceBundle`, and preserve canonical async
`loadVerifiedBundle` results, error behavior and fresh nonaliased bytes after the adapter mapping.
In the existing generic replay tests, inject a counted `EvidenceReplayIntegrityFactoryPort`; require
exactly one factory creation and one `sealEvidencePlan` recomputation per replay, the original
snapshot/error results and one shared canonical implementation for parser-version and final-snapshot
comparison. Reject an empty key in the Infrastructure factory and prove no signer is passed to a
validator, parser, plan rule or canonical-comparison callback. Exercise the existing
`createConfirmedLifeComposition` replay path and the cold-start replay path so every real caller passes
the inward factory; a compile fixture omitting it must fail, while `tsc --noEmit` covers the complete
call graph.

For safety, every previous-origin attempt resolves to an exact prior verified City Evidence/source-
plan/accepted URL lineage. Task 6 has already bound each reference's `artifactId`, `artifactSha256`,
run, source and role to the stored generic artifact. Task 7 alone validates the source-byte bridge:
raw mode binds `locator` to the exact canonical request/response URL lineage and requires the stored
captured-byte SHA-256 to equal `sourceSha256` (therefore `artifactSha256 === sourceSha256`);
transient mode parses the canonical retained inspection/navigation/denominator projection and
compares its `sourceLocator`, `sourceSha256` and retention disposition. Never compare the transient
stored projection SHA-256 itself with `sourceSha256`; it must equal `artifactSha256`.
The generic manifest verifies all stored artifact bytes and provenance, then the Research bridge
verifies every raw/projection occurrence. Cover both fixed ledgers and the safety ledger with the overlay
HMAC. Test overlay-without-generic rejection, generic-without-overlay recovery, byte/hash/HMAC tamper
and immutable UPDATE/DELETE. Mutate and re-sign fixed route order,
URL, reason, artifact/claim IDs, value/source-period policy versions, binding and times, plus safety query/provider/outcome/result order,
previous Evidence/source-plan provenance, redirect, authority/media/retention decision, artifact/
source hash, locator, rejection reason and `3/10/2` counters; every semantic mutation must fail
reconstruction before HMAC acceptance. Supply absent/wrong replay contracts and mutate definition or
any hidden exact-key field,
Registry ID/root, catalog ID/package binding/member/candidate basis/coverage, fixed plan tuple/key/order/
claim contract, safety plan or directory; every seal/load fails. Also supply a fully self-consistent
alternate Registry+catalog root with freshly recomputed IDs under the original signed
`context.catalogRevisionId`: pure reconstruction succeeds, but both seal and load reject the exact-ID
trust-anchor mismatch. Add self-prior, A→B→A and longer-cycle
fixtures plus a long acyclic chain to prove the iterative visited-set walk is cycle-safe and depth-safe
at both seal and load. Positive tests use only a local synthetic ready replay
contract whose catalog has `schemaVersion === "city-catalog@1"` and
`rulesVersion === CITY_CATALOG_RULES_VERSION`. An otherwise valid replay contract with legacy Catalog
rules fails `city_catalog_upgrade_required` before a write or source call. Current SI remains not ready and Task 7
performs no installation, network or source call.

- [ ] **Step 3: Run RED**

```bash
./node_modules/.bin/vitest run tests/domain/city-catalog.test.ts \
  tests/research/city-evidence-composition.test.ts \
  tests/research/city-safety-artifact-bridge.test.ts \
  tests/integration/city-evidence-store.test.ts \
  tests/integration/evidence-store.test.ts \
  tests/integration/current-evidence.test.ts \
  tests/integration/cold-start.test.ts \
  tests/integration/database-schema.test.ts
```

- [ ] **Step 4: Add only the `city_evidence_snapshots` table and preflight**

Columns: ID FK to `evidence_snapshots`, unique check-run ID, mirrored city/country/package/catalog/
criteria/ranking fields, `package_schema_version`, `evidence_rules_version`, `context_hash`,
assessmentAt/completedAt and canonical payload/hash/HMAC. There is no ambiguous City-overlay
`rules_version` column; that legacy name remains only on the referenced generic Evidence snapshot.
Add immutable triggers.
Update all exact table/index/trigger inventories and `db.ts` reset-required preflight.

- [ ] **Step 5: Factor synchronous generic artifact/bundle primitives**

In `evidence-store.ts`, factor internal synchronous
`insertLiveArtifact(database, artifact): void` from `appendArtifact` and
`loadVerifiedEvidenceBundle(database, id, integrity, expected?): VerifiedStoredEvidenceBundle<S, C>`
from the current split snapshot/manifest/artifact reads. `VerifiedStoredEvidenceBundle` is a non-exported
Infrastructure type returning the verified snapshot, verified manifest and
`readonly CapturedEntry<S>[]`; every artifact contains a fresh copied `Uint8Array` and exact full
provenance. One synchronous transactional read path must load and validate the snapshot row, canonical
manifest, hash/HMAC, every artifact row/byte hash/provenance and assemble entries from that same view.

Move the existing public `VerifiedLoadExpectations` and `VerifiedEvidenceBundle` contracts, unchanged,
to inward `research-plan.ts`. Also define pure `evidenceCanonicalEqual(left, right, integrity)` there;
it compares the two strings produced by the injected inward canonical capability and imports no
Infrastructure implementation. Define `EvidenceReplayIntegrityFactoryPort` in
`application/replay-evidence.ts` and add it to each generic replay runtime-port shape while preserving
the public `ReplayEvidenceInput` and `ReplayEvidenceStore` behavior. Both existing Infrastructure
callers adapt the existing implementation to that port: `cold-start-composition.ts` and
`composition-root.ts` each construct a frozen
`EvidenceReplayIntegrityFactoryPort { create: createEvidenceIntegrity }` and pass it explicitly to
`replayEvidenceByRules` or `replayEvidence`. Direct tests inject an explicit fake factory; no default or
Application-side fallback is permitted. `replayEvidence`, `replayEvidenceByRules` and every internal
`replayEvidencePlan` delegation forward the same complete runtime-port object; none may narrow it back
to `{ store }` and drop `integrityFactory`.

Remove every import by a module under `src/application/**` from `src/infrastructure/**`:
`application/replay-evidence.ts` obtains
`VerifiedLoadExpectations`, `VerifiedEvidenceBundle`, `EvidenceIntegrity` and
`evidenceCanonicalEqual` only from Research and obtains its runtime full integrity only by injected
factory. It creates that integrity exactly once per public replay, passes a canonical-only view to the
inward equality helper and passes the full object only to the one `sealEvidencePlan` recomputation.
It never calls/imports `canonicalJson`, `createEvidenceIntegrity`, `node:crypto` or a SQLite type. The
same injected canonicalizer compares parser versions and the final recomputed snapshot; no private
Application canonicalizer or second seal is added.

`SqliteEvidenceStore.loadVerifiedBundle` delegates to the synchronous private helper and maps its stored manifest/`CapturedEntry` result to the same inward
`VerifiedEvidenceBundle { snapshot, entries: ParserEntry[] }` async view, with fresh bytes and no row
type escaping Infrastructure. Add a compile-time structural assertion that `SqliteEvidenceStore`
satisfies `ReplayEvidenceStore`, plus the repository-wide Application import-boundary test above.
Require canonical async readback and generic replay equivalence before and after the refactor. Existing
async wrappers otherwise retain their public behavior.
Task 7 factors the shared `verifySealedEvidenceForInsert` body and calls it with the live default;
Task 9 gives that same export the final origin-generic signature shown in its Interfaces block rather
than adding an administrative cast or a second verifier. It performs the injected-integrity
pre-write canonical/hash/HMAC check above and uses length-safe constant-time comparison for hash/HMAC.
Public wrappers likewise snapshot closed metadata and copy bytes before asynchronous suspension; the
sync primitives validate and write only those owned values. Do not add City source-ID branches or weaken
existing country Evidence behavior.

- [ ] **Step 6: Implement one immediate City seal transaction and verified replay**

Promote the existing fixed-plan snapshot/validation path to
`reconstructCityFixedSourcePlan(value, expectedSourceId)`. Keep it synchronous and pure. The fixed
runner passes `callerInput.sourceId`, calls it before
scheduling a deadline or touching its route port and thereafter uses only the returned plan; remove the
private duplicate validator without changing Task 6 attempt/terminal behavior.

Accept the verified exact four-source generic Evidence bundle plus its exact complete
`LiveCapturedArtifact[]`, the three fixed ledgers and one safety ledger. The synchronous City store first creates the
descriptor-safe owned input/byte snapshot, derives and checks the deterministic Evidence ID, resolves
the exact replay contract by passing the one context-derived
`InstalledCityPackageExactKey` directly to `loadExactReplayContract`, verifies its signed five-field key and every returned full
package projection against the lookup request, and relies on the Task 9 adapter postcondition for the
audit manifest ID/hash/HMAC rather than comparing an unpersisted expected ID. It then derives an
Infrastructure-implemented
`CityEvidenceReplayIntegrity` view
from its store-owned full integrity, verifies its Registry+catalog root through
`reconstructVerifiedCityCatalog`, requires `catalog.schemaVersion === "city-catalog@1"` and
`catalog.rulesVersion === CITY_CATALOG_RULES_VERSION`, then reconstructs all three fixed plans for every catalog-member tuple
through `reconstructCityFixedSourcePlan(value, tupleExpectedSourceId)` before choosing the context city,
and performs all context,
prior-chain, semantic, chronology and artifact-bridge checks. Its safety chronology walk keeps a local
first-acquisition map keyed by distinct
artifact ID: record/validate the first occurrence's causal lower bound, but for every later reuse validate
only identity/bridge semantics and the owning completion upper bound. Within
one `BEGIN IMMEDIATE` transaction, call `insertLiveArtifact` for fresh copied artifacts, persist or
exact-replay the supplied already signed generic bundle, and then persist the overlay; Task 7 never
calls `sealEvidencePlan`, replaces the generic signature or reaches a live port. Before overlay sealing,
iteratively load and verify every previous-origin Evidence with the visited set and canonical-compare
each reference's city/municipality/definition/source-plan plus accepted URL with
the discovery input; no arbitrary current official URL may impersonate prior provenance. Require
each distinct fixed/safety artifact ID to resolve to exactly one same-run generic artifact, call
`reconstructCitySafetyArtifactBridge` for every reference occurrence with the no-sign replay integrity
so stored-byte SHA is recomputed from a private copy, then cover all four ledgers and
all context bindings with the overlay HMAC in the same immediate transaction. Load uses
`loadVerifiedEvidenceBundle`, reconstructs the exact replay semantics and bridge again, and only then
recomputes the exact overlay payload equations and returns the constant-time HMAC-accepted overlay. On a
lost ID or check-run insert race, read back by both keys and
canonical-compare. Cancellation or a thrown storage/parser/integrity error leaves no overlay row; an
already sealed generic snapshot without its overlay is recovered idempotently without a source call or
a second generic seal.

- [ ] **Step 7: Run GREEN and commit**

```bash
./node_modules/.bin/vitest run tests/domain/city-catalog.test.ts \
  tests/research/city-evidence-composition.test.ts \
  tests/research/city-safety-artifact-bridge.test.ts \
  tests/integration/city-evidence-store.test.ts \
  tests/integration/evidence-store.test.ts tests/integration/current-evidence.test.ts \
  tests/integration/cold-start.test.ts tests/integration/database-schema.test.ts \
  tests/integration/confirmed-life.test.ts tests/branch/life-git.test.ts
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/eslint src/application/city-data-contracts.ts src/application/replay-evidence.ts \
  src/decision/city-catalog.ts \
  src/research/city-evidence.ts src/research/city-package.ts \
  src/research/city-safety-artifact-bridge.ts \
  src/research/research-plan.ts \
  src/infrastructure/integrity.ts src/infrastructure/cold-start-composition.ts \
  src/infrastructure/composition-root.ts \
  src/infrastructure/sqlite/city-evidence-store.ts src/infrastructure/sqlite/evidence-store.ts \
  tests/research/city-evidence-composition.test.ts \
  tests/research/city-safety-artifact-bridge.test.ts \
  tests/domain/city-catalog.test.ts tests/integration/city-evidence-store.test.ts
git diff --check
git add src/application/city-data-contracts.ts \
  src/application/replay-evidence.ts \
  src/decision/city-catalog.ts tests/domain/city-catalog.test.ts \
  src/research/city-evidence.ts src/research/city-package.ts \
  src/research/city-safety-artifact-bridge.ts \
  src/research/research-plan.ts \
  src/infrastructure/integrity.ts src/infrastructure/cold-start-composition.ts \
  src/infrastructure/composition-root.ts \
  src/infrastructure/sqlite/schema.sql src/infrastructure/sqlite/db.ts \
  src/infrastructure/sqlite/evidence-store.ts \
  src/infrastructure/sqlite/city-evidence-store.ts \
  tests/research/city-evidence-composition.test.ts \
  tests/research/city-safety-artifact-bridge.test.ts \
  tests/integration/city-evidence-store.test.ts tests/integration/evidence-store.test.ts \
  tests/integration/current-evidence.test.ts tests/integration/cold-start.test.ts \
  tests/integration/database-schema.test.ts \
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

// Inward Research contract. The structural shape is intentionally satisfied by
// VerifiedCityEvidence without importing src/application/city-data-contracts.
export interface CityKnowledgeEvidenceView {
  readonly snapshot: {
    readonly id: string;
    readonly cityId: string;
    readonly countryCode: string;
    readonly packageId: string;
    readonly packageSchemaVersion: string;
    readonly catalogRevisionId: string;
    readonly evidenceRulesVersion: string;
    readonly completedAt: string;
  };
  readonly genericEvidence: {
    readonly snapshot: {
      readonly id: string;
      readonly coverage: Readonly<Record<string, "verified" | "unavailable">>;
      readonly claims: readonly {
        readonly sourceId: string;
        readonly criterionId: CityCriterionId;
        readonly definitionId: string;
        readonly scope: string;
        readonly officialAreaId: string;
        readonly geoScope: string;
        readonly unit: string;
        readonly denominator: string;
        readonly freshnessPolicyVersion: string;
        readonly sourcePeriod: string;
        readonly value: CityVerifiedFactBasis;
        readonly anchor: {
          readonly artifactId: string;
          readonly locator: string;
          readonly excerptSha256: string;
        };
      }[];
      readonly blockers: readonly {
        readonly sourceId: string;
        readonly kind: string;
        readonly navigationUrl: string;
        readonly resolvedUrl?: string;
        readonly artifactIds: readonly string[];
      }[];
    };
    readonly manifest: {
      readonly entries: readonly {
        readonly sourceId: string;
        readonly navigationUrl: string;
        readonly resolvedEvidenceUrl: string;
        readonly artifactIds: readonly string[];
      }[];
      readonly artifacts: readonly {
        readonly artifactId: string;
        readonly sourceId: string;
      }[];
    };
    readonly entries: readonly {
      readonly sourceId: string;
      readonly navigationUrl: string;
      readonly resolvedEvidenceUrl: string;
      readonly artifacts: readonly {
        readonly artifactId: string;
        readonly sourceId: string;
      }[];
    }[];
  };
}

export interface CityKnowledgeFactContract<
  S extends SloveniaCityFactSourceId = SloveniaCityFactSourceId,
> {
  readonly sourceId: S;
  readonly criterionId: CityCriterionId;
  readonly definitionId: string;
  readonly scope: string;
  readonly geoScope: string;
  readonly officialAreaId: string;
  readonly unit: string;
  readonly denominator: string;
  readonly freshnessPolicyVersion: string;
}

export type CityKnowledgeFactContractTuple = readonly [
  CityKnowledgeFactContract<"si-city-safety">,
  CityKnowledgeFactContract<"si-city-long-term-rent">,
  CityKnowledgeFactContract<"si-city-urban-transit">,
  CityKnowledgeFactContract<"si-city-fixed-broadband">,
];

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
  readonly freshnessBasis: { readonly policyVersion: string };
  readonly unit: string;
  readonly denominator: string;
  readonly outcome: CityFactOutcome;
  readonly evidenceRefs: readonly CityFactEvidenceReference[];
}

export interface BuildCityKnowledgeInput {
  readonly packageKey: InstalledCityPackageExactKey;
  readonly evidence: CityKnowledgeEvidenceView;
  readonly factContracts: CityKnowledgeFactContractTuple;
  readonly createdAt: string;
  readonly predecessor?: CityKnowledgeRevision;
}

export interface ReconstructCityKnowledgeInput {
  readonly revision: CityKnowledgeRevision;
  readonly packageKey: InstalledCityPackageExactKey;
  readonly evidence: CityKnowledgeEvidenceView;
  readonly factContracts: CityKnowledgeFactContractTuple;
  // Present iff revision.predecessorRevisionId is present.
  readonly predecessor?: CityKnowledgeRevision;
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

`city-knowledge.ts` is an inward Research module: it must not import an Application DTO. It owns the
structural `CityKnowledgeEvidenceView`, `CityKnowledgeFactContract`, build and reconstruction DTOs above.
The build/reconstruct entry points accept only that already-verified Evidence view, the exact closed
`InstalledCityPackageExactKey`, the canonical dense fact-contract tuple and the optional predecessor;
build also accepts the new revision's `createdAt`. The evidence view's `snapshot` must bind exactly to the key's
`countryCode/packageId/packageSchemaVersion/catalogRevisionId/evidenceRulesVersion`; the city ID and
generic snapshot ID are derived only from that verified view and reconstruction binds them to the
submitted revision. The implementation descriptor-snapshots only the required projection shown above,
so the larger verified Evidence object remains structurally assignable and its unrelated raw-byte/
ledger fields are neither copied nor traversed; a missing, noncanonical or mismatched required
key/view field is `integrity_mismatch` before any integrity callback. Task 9 derives this tuple only
from exact reconstructed installed-package replay; it must never accept an ad-hoc fact contract.

`CityKnowledgeFactContract` is a closed own-data value with exactly `sourceId`, `criterionId`,
`definitionId`, `scope`, `geoScope`, `officialAreaId`, `unit`, `denominator` and
`freshnessPolicyVersion`. Its tuple is dense and exactly four entries in
`SLOVENIA_CITY_FACT_SOURCE_IDS` order, with the matching canonical criterion order and no duplicate,
foreign or omitted source/criterion. In particular the safety entry uses the exact literals from
`SLOVENIA_CITY_SAFETY_FACT_CONTRACT`; fixed entries use their exact reconstructed installed contracts.

- [ ] **Step 1: Write the no-carry-forward RED matrix**

Cover 4/4 verified and every live `CityUnknownReason`; reject ranking-only `no_knowledge_revision`,
missing/duplicate/foreign tuple entries, all contract definition/scope/area/geo/unit/denominator/
freshness drift, and all package-key/Evidence bindings. Exercise the real safety evaluator and `rankCities`
compatibility path from the exact safety contract, not merely a projection smoke test. Assert no
profile/target/importance/score/suitability/raw bytes, queries, provider results or attempt ledgers enter
Knowledge.

For each canonical source require exactly one coverage record, manifest entry and captured-entry source;
the source-local artifacts and manifest artifacts must be exact dense owned sets. `verified` requires
exactly one same-source claim, no blocker, a matching claim/contract/definition/source/scope/area/geo/
unit/denominator/freshness binding, a claim anchor owned by that source's manifest and captured entries,
and the correct basis kind (`municipal_safety` for safety, `canonical_scalar` for every fixed source).
`unknown` requires no claim and exactly one blocker with one of the five permitted reasons; its metadata
comes only from the exact reconstructed contract, its `referencePeriod` is `null`, and its one blocker
reference preserves producer-valid empty `artifactIds` while otherwise requiring exact same-source
manifest/captured ownership. Require a deterministic nonempty `evidenceRefs` array for every fact.
Include valid-artifact cross-source ownership rejection, not just nonexistent artifacts.

Cover a full semantic-change/no-carry matrix: unchanged facts with evidence locators/IDs/timestamps and
accepted/reviewed URLs changed preserve the predecessor update time, while every current-fact semantic
change (including known-to-unknown) uses the current check time and never copies a predecessor value.
Cover first revision, successor reconstruction, substituted predecessor ID/value/city/country, all
predecessor/current timestamp inequalities and the rule that package/rules need not be equal across
revisions. Cover all revision/key/Evidence bindings and every timestamp/nested-field tamper.

- [ ] **Step 2: Run RED**

```bash
./node_modules/.bin/vitest run tests/research/city-knowledge.test.ts
```

- [ ] **Step 3: Implement full projection and revision-level time semantics**

Descriptor-snapshot every contract, key, predecessor/revision and required Evidence projection as
own-data plain/dense values with no accessors, symbols, cycles or missing required keys before the first
`CityDecisionIntegrity` callback; require exact closed keys where this Task owns the schema, while
allowing unrelated fields on the structurally larger already-verified Evidence input. Callback mutation
or re-entrant mutation must not affect the private projection. Build all four current facts only from
this current sealed Evidence snapshot, whether verified or unknown. Verified `referencePeriod` is the exact
`claim.sourcePeriod`; unknown `referencePeriod` is `null`. `freshnessBasis` is exactly
`{ policyVersion: contract.freshnessPolicyVersion }`; ranking projection flattens that policy version to
the existing `CityRankingFactInput.freshnessBasis` string. Safety retains `offenceCount`, `population`
and the exact rational municipal basis from current Evidence. Knowledge does not copy queries, provider
results or an attempt ledger.

Set `rulesVersion` from the exact key/Evidence evidence-rules binding. The ID equation is explicit:
construct a payload that excludes `id`, then set
`id = "city-knowledge:" + integrity.hash(integrity.canonical(payload))`. Reconstruct by rebuilding
that exact payload and ID, then comparing the submitted revision structurally.

The first revision has no predecessor and sets `knowledgeUpdatedAt = lastCheckedAt`. A successor has a
predecessor input iff `predecessorRevisionId` is present; require that ID exactly, same `cityId` and
`countryCode`, the predecessor's own canonical ID/closed shape/time validity, and
`predecessor.createdAt < current.lastCheckedAt <= current.createdAt`. Recompute semantic equality only
from current facts versus predecessor facts, including definition, geo scope, reference period,
freshness-policy basis, unit, denominator and outcome, while excluding Evidence refs, accepted/reviewed
URLs, IDs and timestamps. Equality carries only predecessor `knowledgeUpdatedAt`; any semantic change,
including known-to-unknown, sets it to current `lastCheckedAt` and never carries a predecessor fact
value. Do not require package or rules equality across revisions.

- [ ] **Step 4: Add reconstruction/tamper and deep-freeze tests**

Tamper fact order/status/value/basis, contracts, reference period, policy version, all package-key/
city/country/Evidence bindings, every revision timestamp, every nested evidence reference and every
predecessor link. Exercise descriptor getters, symbols, cycles, callback re-entry and mutation to prove
the snapshot precedes integrity callbacks. Verify returned build/reconstruction values are freshly and
recursively frozen, never alias each other or caller-owned objects, and reject all extra/missing keys.
Verify evidence-reference, accepted-URL and reviewed-URL-only changes do not alter semantic-update time.

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
- Modify narrowly: `src/research/contracts.ts`
- Modify narrowly: `src/research/research-plan.ts`
- Modify: `src/research/city-package.ts`
- Create: `src/research/city-package-artifact-set.ts`
- Modify narrowly: `src/decision/city-criteria.ts`
- Create: `src/decision/approved-city-criteria-defaults.ts`
- Modify: `src/application/city-data-contracts.ts`
- Create: `src/application/seal-administrative-evidence.ts`
- Create: `src/application/install-city-package.ts`
- Create: `src/infrastructure/city-package-installation-composition.ts`
- Modify narrowly: `src/infrastructure/composition-root.ts`
- Move from Task 6 and create here: `src/infrastructure/sources/installed-city-packages.ts`
- Modify narrowly: `src/infrastructure/sqlite/evidence-store.ts`
- Create: `src/infrastructure/sqlite/city-catalog-store.ts`
- Create: `src/infrastructure/sqlite/city-package-manifest-store.ts`
- Create: `src/infrastructure/sqlite/city-knowledge-store.ts`
- Create: `evals/install-city-package.ts`
- Create: `tests/research/city-package-artifact-set.test.ts`
- Create: `tests/research/evidence-origin-types.test.ts`
- Create: `tests/integration/administrative-evidence.test.ts`
- Modify narrowly: `tests/integration/evidence-store.test.ts`
- Create: `tests/integration/city-knowledge-store.test.ts`
- Create: `tests/integration/city-package-manifest-store.test.ts`
- Modify narrowly: `tests/domain/city-criteria.test.ts`
- Create: `tests/domain/approved-city-criteria-defaults.test.ts`
- Modify: `src/infrastructure/sqlite/schema.sql`
- Modify: `src/infrastructure/sqlite/db.ts`
- Modify exact table/index/trigger inventories: `tests/integration/database-schema.test.ts`
- Modify exact table inventories: `tests/integration/confirmed-life.test.ts`
- Modify exact table inventories: `tests/branch/life-git.test.ts`

**Interfaces:**

```ts
export type EvidenceOrigin = "live" | "administrative";

// URL-free byte content shared only where an origin-neutral content shape is required.
export interface ArtifactContent {
  readonly artifactId: string;
  readonly role: string;
  readonly mediaType: string;
  readonly sha256: string;
  readonly bytes: Uint8Array;
}

// Preserve the existing parser contract exactly: ParserEntry.artifacts remains ArtifactBytes[].
export interface ArtifactBytes extends ArtifactContent {
  readonly url: string;
}

// Existing LiveCapturedArtifact<S> continues to extend the URL-bearing ArtifactBytes unchanged.
export interface AdministrativeCapturedArtifact<S extends string = SourceId>
  extends ArtifactContent {
  readonly runId: string;
  readonly sourceId: S;
  readonly origin: "administrative";
  readonly producer: string;
  readonly createdAt: string;
}

export type CapturedArtifactForOrigin<
  S extends string = SourceId,
  O extends EvidenceOrigin = "live",
> = O extends "live" ? LiveCapturedArtifact<S> : AdministrativeCapturedArtifact<S>;

export interface AdministrativeArtifactProvenance<S extends string = SourceId> {
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

export type LiveArtifactProvenance<S extends string = SourceId> =
  Omit<LiveCapturedArtifact<S>, "bytes"> & { readonly byteLength: number };

export type EvidenceArtifactProvenance<
  S extends string = SourceId,
  O extends EvidenceOrigin = "live",
> = O extends "live"
  ? LiveArtifactProvenance<S>
  : AdministrativeArtifactProvenance<S>;

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

export interface LiveEvidenceManifestEntry<S extends string> {
  readonly sourceId: S;
  readonly navigationUrl: string;
  readonly indexedSourceUrl?: string;
  readonly resolvedEvidenceUrl: string;
  readonly artifactIds: readonly string[];
  readonly versionHint?: string;
}

export type EvidenceManifestEntryForOrigin<
  S extends string,
  O extends EvidenceOrigin = "live",
> = O extends "live"
  ? LiveEvidenceManifestEntry<S>
  : AdministrativeEvidenceManifestEntry<S>;

export type TerminalEvidenceEntryForOrigin<
  S extends string,
  C extends Claim<unknown, S>,
  O extends EvidenceOrigin = "live",
> = O extends "live"
  ? TerminalEvidenceEntry<S, C>
  : AdministrativeTerminalEvidenceEntry<S, C>;

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

export function sealEvidencePlan<
  S extends string,
  C extends Claim<unknown, S>,
  O extends EvidenceOrigin = "live",
>(
  input: SealEvidenceInput<S, C, O>,
  integrity: EvidenceIntegrity,
): Promise<SealedEvidence<S, C, O>>;

/** @internal Infrastructure-only export shared by the live and administrative adapters. */
export function verifySealedEvidenceForInsert<
  S extends string,
  C extends Claim<unknown, S>,
  O extends EvidenceOrigin,
>(
  sealed: SealedEvidence<S, C, O>,
  integrity: EvidenceIntegrity,
): void;

/** @internal Infrastructure-only DTO; it contains no SQLite row or union. */
export interface AdministrativeVerifiedEvidenceEntry<S extends string> {
  readonly sourceId: S;
  readonly origin: "administrative";
  readonly artifacts: readonly AdministrativeCapturedArtifact<S>[];
}

/** @internal Infrastructure-only DTO exported only between SQLite adapters. */
export interface AdministrativeVerifiedEvidenceBundle<
  S extends string,
  C extends Claim<unknown, S>,
> {
  readonly snapshot: EvidenceSnapshot<S, C>;
  readonly manifest: EvidenceManifest<S, C, "administrative">;
  readonly entries: readonly AdministrativeVerifiedEvidenceEntry<S>[];
}

// Exact inward package-installation expectation input. Envelope literals are derived by the
// pure reconstructor rather than accepted from an adapter.
export interface AdministrativeEvidenceLoadExpectations {
  readonly evidenceId: string;
  readonly installedAt: string;
  readonly artifactIds: readonly string[];
}

export function reconstructAdministrativeEvidenceShell(
  value: unknown,
  expected: AdministrativeEvidenceLoadExpectations,
): EvidenceSnapshot<
  "city-package-installation",
  Claim<unknown, "city-package-installation">
>;

/** @internal Infrastructure-only capability used by the package-manifest store. */
export function loadVerifiedAdministrativeEvidenceBundle(
  database: Database.Database,
  expected: AdministrativeEvidenceLoadExpectations,
  integrity: EvidenceIntegrity,
): AdministrativeVerifiedEvidenceBundle<
  "city-package-installation",
  Claim<unknown, "city-package-installation">
>;

export interface VerifiedCityCatalogBundle {
  readonly registry: CityRegistryRevision;
  readonly catalog: CityCatalogRevision;
}

export interface CityCatalogStorePort {
  appendVerified(input: CityCatalogProjection): VerifiedCityCatalogBundle;
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

export type InstalledCityPackageJsonArtifactRole =
  | "installed_city_fixed_source_plan"
  | "installed_city_safety_source_plan"
  | "installed_city_official_authority_directory"
  | "installed_city_criteria_defaults"
  | "installed_city_criterion_definitions";

export type InstalledCityPackageArtifactSlot =
  | {
      readonly kind: "fixed_plan";
      readonly cityId: string;
      readonly sourceId: SloveniaCityFixedSourceId;
    }
  | { readonly kind: "safety_source_plan" }
  | { readonly kind: "official_authority_directory" }
  | { readonly kind: "criteria_defaults" }
  | { readonly kind: "criterion_definitions" };

export interface InstalledPackageArtifactSetMaterial {
  readonly artifactOrdinal: number;
  readonly slot: InstalledCityPackageArtifactSlot;
  readonly role: InstalledCityPackageJsonArtifactRole;
  readonly sha256: string;
}

export interface BuildInstalledPackageArtifactSetClaimInput {
  readonly key: InstalledCityPackageExactKey;
  readonly installedAt: string;
  readonly orderedMaterials: readonly InstalledPackageArtifactSetMaterial[];
}

export interface SealCityPackageAdministrativeEvidenceInput {
  readonly key: InstalledCityPackageExactKey;
  readonly installedAt: string;
  readonly catalogMemberIds: readonly string[];
  readonly fixedPlansByCityId: InstalledCityResearchPackage["fixedPlansByCityId"];
  readonly safetySourcePlan: CitySafetySourcePlan;
  readonly officialAuthorityDirectory: OfficialAuthorityDirectory;
  readonly criteriaDefaults: InstalledCityCriteriaDefaults;
  readonly criterionDefinitions: InstalledCityCriterionDefinitionTuple;
}

export interface CityPackageAdministrativeEvidenceClaim {
  readonly claimId: string;
  readonly sourceId: "city-package-installation";
  readonly value: {
    readonly schemaVersion: "installed-city-package-artifact-set@1";
    readonly key: InstalledCityPackageExactKey;
    readonly installRunId: string;
    readonly evidenceId: string;
    readonly orderedArtifacts: readonly {
      readonly artifactOrdinal: number;
      readonly role: InstalledCityPackageJsonArtifactRole;
      readonly artifactId: string;
    }[];
  };
  readonly scope: "city-package-installation";
  readonly sourcePeriod: string;
  readonly anchor: ClaimAnchor;
  readonly status: "verified";
}

export interface BuiltInstalledPackageArtifactSetClaim {
  readonly installRunId: string;
  readonly evidenceId: string;
  readonly orderedArtifacts: readonly (InstalledPackageArtifactSetMaterial & {
    readonly artifactId: string;
  })[];
  readonly claim: CityPackageAdministrativeEvidenceClaim;
}

export function buildInstalledPackageArtifactSetClaim(
  input: BuildInstalledPackageArtifactSetClaimInput,
  integrity: CityDecisionIntegrity,
): BuiltInstalledPackageArtifactSetClaim;

export function reconstructInstalledPackageArtifactSetClaim(
  claims: readonly unknown[],
  input: BuildInstalledPackageArtifactSetClaimInput,
  integrity: CityDecisionIntegrity,
): BuiltInstalledPackageArtifactSetClaim;

export interface SealedCityPackageAdministrativeEvidence {
  readonly installRunId: string;
  readonly evidenceId: string;
  readonly evidence: SealedEvidence<
    "city-package-installation",
    CityPackageAdministrativeEvidenceClaim,
    "administrative"
  >;
  readonly artifacts: readonly AdministrativeCapturedArtifact<
    "city-package-installation"
  >[];
  readonly bindings: readonly InstalledCityPackageJsonArtifactBinding<
    InstalledCityPackageJsonArtifactRole
  >[];
}

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

export interface InstalledCityResearchPackage
  extends CityResearchPackageReadyCandidate {
  readonly installedPackageManifest: {
    readonly id: string;
    readonly key: InstalledCityPackageExactKey;
  };
  readonly registry: CityRegistryRevision;
  readonly catalog: CityCatalogRevision;
  readonly criteriaDefaults: InstalledCityCriteriaDefaults;
  readonly criterionDefinitions: InstalledCityCriterionDefinitionTuple;
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
}

export interface InstalledCityPackageJsonArtifactBinding<
  R extends InstalledCityPackageJsonArtifactRole,
> {
  readonly evidenceSnapshotId: string;
  readonly artifactId: string;
  readonly artifactOrdinal: number;
  readonly runId: string;
  readonly sourceId: "city-package-installation";
  readonly role: R;
  readonly mediaType: "application/json";
  readonly sha256: string;
}

export interface InstalledCityFixedPlanManifestBinding<
  S extends SloveniaCityFixedSourceId,
> {
  readonly sourceId: S;
  readonly cityId: string;
  readonly planId: string;
  readonly criterionId: SloveniaCityFixedCriterionId<S>;
  readonly definitionId: string;
  readonly parserVersion: string;
  readonly rulesVersion: string;
  readonly freshnessPolicyVersion: string;
  readonly valuePolicyVersion: string;
  readonly sourcePeriodPolicyVersion: string;
  readonly planArtifact: InstalledCityPackageJsonArtifactBinding<
    "installed_city_fixed_source_plan"
  >;
}

export type InstalledCityCriterionDefinitionTuple = readonly [
  CityCriterionDefinition,
  CityCriterionDefinition,
  CityCriterionDefinition,
  CityCriterionDefinition,
];

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

export interface ApprovedCityCriteriaDefaultsRegistryEntry {
  readonly mappingVersion: string;
  readonly approvedFor: ApprovedCityCriteriaPackageDefinition;
  readonly defaults: InstalledCityCriteriaDefaults;
}

export interface ApprovedCityCriteriaPackageDefinition {
  readonly countryCode: string;
  readonly packageId: string;
  readonly packageSchemaVersion: string;
  readonly evidenceRulesVersion: string;
}

export interface ApprovedCityCriteriaDefaultsRegistry {
  readonly schemaVersion: "approved-city-criteria-defaults-registry@1";
  readonly byMappingVersion: Readonly<Record<
    string,
    ApprovedCityCriteriaDefaultsRegistryEntry
  >>;
}

export const APPROVED_CITY_CRITERIA_DEFAULTS_REGISTRY:
  ApprovedCityCriteriaDefaultsRegistry;

export function resolveApprovedCityCriteriaDefaults(
  definition: ApprovedCityCriteriaPackageDefinition,
  registry: ApprovedCityCriteriaDefaultsRegistry,
): InstalledCityCriteriaDefaults;

export interface InstalledCityPackageManifestPayload {
  readonly schemaVersion: "installed-city-package-manifest@1";
  readonly key: InstalledCityPackageExactKey;
  readonly definition: CityResearchPackageDefinition;
  readonly sourceContractStatus: "bounded_verified_or_unknown";
  readonly readiness: { readonly status: "ready"; readonly issues: readonly [] };
  readonly catalogRoot: {
    readonly registryRevisionId: string;
    readonly catalogRevisionId: string;
  };
  readonly fixedPlansByCityId: Readonly<Record<string, readonly [
    InstalledCityFixedPlanManifestBinding<"si-city-long-term-rent">,
    InstalledCityFixedPlanManifestBinding<"si-city-urban-transit">,
    InstalledCityFixedPlanManifestBinding<"si-city-fixed-broadband">,
  ]>>;
  readonly safety: {
    readonly sourcePlanId: string;
    readonly sourcePlanSchemaVersion: "city-safety-source-plan@1";
    readonly authorityDirectoryId: string;
    readonly queryTemplateVersion: string;
    readonly definitionId: string;
    readonly freshnessPolicyVersion: string;
    readonly discoveryRulesVersion: string;
    readonly sourcePlanArtifact: InstalledCityPackageJsonArtifactBinding<
      "installed_city_safety_source_plan"
    >;
    readonly authorityDirectoryArtifact: InstalledCityPackageJsonArtifactBinding<
      "installed_city_official_authority_directory"
    >;
  };
  readonly criteria: {
    readonly defaultsMappingVersion: string;
    readonly definitionIds: Readonly<Record<CityCriterionId, string>>;
    readonly evaluatorRegistryVersionId: string;
    readonly evaluatorVersionIds: Readonly<Record<CityCriterionId, string>>;
    readonly defaultsArtifact: InstalledCityPackageJsonArtifactBinding<
      "installed_city_criteria_defaults"
    >;
    readonly definitionsArtifact: InstalledCityPackageJsonArtifactBinding<
      "installed_city_criterion_definitions"
    >;
  };
  readonly valueValidatorVersionId: string;
  readonly sourcePeriodValidatorVersionId: string;
  readonly predecessorManifestId: string | null;
  readonly installedAt: string;
}

export interface InstalledCityPackageManifest extends InstalledCityPackageManifestPayload {
  readonly id: string;
  readonly payloadHash: string;
  readonly hmac: string;
}

export interface InstalledCityPackageManifestStorePort {
  // Postcondition: every return was reloaded from persisted canonical bytes and its
  // payloadHash, hash-derived id, HMAC, mirrored key and immutable artifact bindings verified.
  appendVerified(payload: InstalledCityPackageManifestPayload): InstalledCityPackageManifest;
  loadVerified(key: InstalledCityPackageExactKey): InstalledCityPackageManifest | undefined;
  latestVerified(countryCode: string): InstalledCityPackageManifest | undefined;
}

export interface InstalledCityPackageLookupPort {
  // Postcondition: every package was reconstructed from one verified store return;
  // installedPackageManifest.id is audit metadata, while key/projections are consumer bindings.
  findReady(countryCode: string): InstalledCityResearchPackage | undefined;
  findExact(key: InstalledCityPackageExactKey): InstalledCityResearchPackage | undefined;
}
```

The three City persistence ports above live in `src/application/city-data-contracts.ts`; SQLite only
implements them. `ArtifactContent`, `AdministrativeCapturedArtifact` and the origin-specialized
`CapturedArtifactForOrigin` live inward in `src/research/contracts.ts`; the origin-specialized terminal,
manifest, provenance, seal-input and write-store contracts live in inward
`src/research/research-plan.ts`. The pure artifact-set material/slot/role, claim and build result
contracts, `AdministrativeEvidenceLoadExpectations`, `reconstructAdministrativeEvidenceShell`,
`buildInstalledPackageArtifactSetClaim` and `reconstructInstalledPackageArtifactSetClaim` live
together in inward `src/research/city-package-artifact-set.ts`. Application sealing and Infrastructure manifest append/
restart both import that one inward module; it imports no Application, Infrastructure, SQLite or crypto
implementation. The established `ArtifactBytes` name and shape remain URL-bearing with
exactly `artifactId/role/url/mediaType/sha256/bytes`; `LiveCapturedArtifact` continues to extend it, and
`ParserEntry.artifacts` remains `readonly ArtifactBytes[]`. Administrative artifacts alone extend the
URL-free `ArtifactContent` base. No Slovenia parser, live parser fixture, `ParserEntry`, country-
knowledge or dossier consumer changes type or loses `.url`.

`EvidenceManifest`, `SealedEvidence`, `SealEvidenceInput`, `EvidenceArtifactProvenance` and
`EvidenceWriteStore` gain the closed origin parameter `O extends "live" | "administrative"`, defaulted
to `"live"`. Therefore every legacy one-/two-argument use, the public generic replay API, Task 7's
`VerifiedEvidenceBundle`, `VerifiedCityEvidence.genericEvidence`, `CapturedEntry[]`, City store and all
official-source paths remain compile-time live-only; they do not receive a union and cannot append,
seal, load or inspect an administrative branch. Only
`sealCityPackageAdministrativeEvidence` explicitly names `"administrative"` on its seal input, sealed
bundle and `EvidenceWriteStore` port. The conditional specializations never accept an unconstrained
origin at an Application use-case boundary.

The administrative captured object has exactly the ten keys shown and its manifest row has exactly the
same metadata with
`byteLength` replacing `bytes`: there is no `url`, `request`, `responseUrl`, `responseStatus` or
`capturedAt` key on either administrative shape. Its administrative terminal entry has exactly
`sourceId/origin/artifacts/coverage/claims`, and its manifest entry has exactly
`sourceId/origin/artifactIds`; neither contains navigation/index/resolution lineage. Existing
`OfficialSourcePort`, `RequestStep`,
`CaptureResult`, live `CapturedEntry`, research-plan validation and progress paths remain live-only and
cannot manufacture an administrative artifact. Inside
`infrastructure/sqlite/evidence-store.ts`, Task 9 adds one module-private origin-discriminated
`StoredArtifactRow` union and synchronous insert/read primitives. The existing `insertLiveArtifact`
and public `SqliteEvidenceStore` remain live specializations; a separate explicit
`SqliteAdministrativeEvidenceStore<S, C>` implements only `EvidenceWriteStore<S, C,
"administrative">`; installation composition instantiates it with source
`"city-package-installation"` and `CityPackageAdministrativeEvidenceClaim`. Both map through the
private row union, but neither exposes it. The Task 7
`loadVerifiedEvidenceBundle` continues to return only private live `CapturedEntry[]`; a distinct
Infrastructure-internal exported `loadVerifiedAdministrativeEvidenceBundle` capability returns only
the closed `AdministrativeVerifiedEvidenceBundle` DTO to `city-package-manifest-store.ts` on the same
synchronous database path. That DTO contains only the typed administrative snapshot, manifest and
fresh copied administrative entries; `StoredArtifactRow`, SQL rows and the live/administrative row union
remain module-private. Existing public async live replay maps
only live rows to `ParserEntry` and otherwise keeps its API, error behavior and byte-copy guarantees.
No SQLite row, row union or private stored-entry union crosses inward.

The origin-parameterized terminal/seal implementation accepts a captured artifact only through its
selected specialization:
`validateTerminalEntries`, `evidenceArtifactProvenance` and `assertSealedEvidenceStructure` require the
exact origin-specific own keys, common run/source ownership and one manifest provenance object per
artifact. Administrative values cannot carry a live-only key even with `undefined`, and live values
cannot carry `producer/createdAt`. `prepareEvidencePlan`, `OfficialSourcePort`, `RequestStep` and City
Evidence remain statically and dynamically live-only.

`verifySealedEvidenceForInsert<S, C, O extends EvidenceOrigin>` is the one shared prewrite verifier.
Both typed SQLite adapters pass their exact `SealedEvidence<S, C, O>` specialization to it; it verifies
the origin-selected closed manifest/entry/provenance shape plus canonical manifest, hash, HMAC and
snapshot equality without a cast, origin erasure or duplicate administrative verifier. The
administrative loader first snapshots the exact three-key
`AdministrativeEvidenceLoadExpectations { evidenceId, installedAt, artifactIds }`, reconstructs
the exact package-installation administrative `SealedEvidence` specialization from owned typed data,
calls the same verifier, then
passes its owned snapshot and owned expectations to the pure `reconstructAdministrativeEvidenceShell`.
It maps only the administrative branch into fresh DTO copies and returns the reconstructed frozen shell
as the bundle snapshot.
`city-package-manifest-store.ts` imports only this Infrastructure-internal capability/DTO, never the
private row union; neither symbol is re-exported from an inward module or public composition API.

`reconstructAdministrativeEvidenceShell` uses no integrity callback or I/O. It descriptor-snapshots the
expectations and supplied snapshot into private plain data, rejects accessors, symbols, sparse arrays,
custom prototypes and every extra/missing key, and returns a fresh recursively frozen snapshot. Its
exact snapshot own-key set is
`id/assessmentDate/artifactIds/claims/blockers/coverage/parserVersions/rulesVersion/manifestHash/hmac`:
`contextHash` and `knowledgeBaselineRevisionId` must be absent as own
properties, including when their value is `undefined`. Require
`id === expected.evidenceId`, canonical strict-UTC-millisecond `expected.installedAt`,
`assessmentDate === expected.installedAt.slice(0, 10)`, and snapshot `artifactIds` equal the dense
ordered `expected.artifactIds`. `coverage` has exactly the one own key
`city-package-installation: "verified"`; `blockers` is an empty dense array; `claims` is a dense
one-item array whose generic Claim structure was already verified and whose package semantics are
checked next. `parserVersions` is exactly the closed one-key map
`{ "city-package-installation": "city-package-administrative-json@1" }`, and `rulesVersion` is exactly
`city-package-administrative-evidence@1`. The bundle's dense `entries` array likewise has exactly one
closed `{ sourceId, origin, artifacts }` item for that source and the exact ordered artifacts; coverage,
blocker and claim cardinality remain the exact snapshot constraints above. No second source, blocker,
claim or parser key can survive the loader.

`InstalledCityCriterionDefinitionTuple` and both pure installed-criteria reconstructors live in
`src/decision/city-criteria.ts`. The definitions reconstructor closes the dense four-item canonical
criterion order and exact definition/evaluator-version maps. The defaults reconstructor closes
`city-criteria-defaults@1`, the exact mapping version and four definition/target bindings using only the
already resolved inward evaluator registry; both return fresh recursively frozen values.
`ApprovedCityCriteriaDefaultsRegistry`, its entry and
`resolveApprovedCityCriteriaDefaults` live in the inward pure
`src/decision/approved-city-criteria-defaults.ts`. The compiled production object is data, not an
Infrastructure registry or serialized function: its top level has exactly
`schemaVersion/byMappingVersion`, every record key equals its entry's canonical `mappingVersion`, every
entry has exactly `mappingVersion/approvedFor/defaults`, and `approvedFor` has exactly
`countryCode/packageId/packageSchemaVersion/evidenceRulesVersion`. Across the registry, exactly one
entry may match
an approved package-definition tuple. Each `defaults` value repeats the map key and contains exactly
four complete drafts in `CITY_CRITERION_IDS` order; every draft has exactly
`criterionId/definitionId/target/mode/importance`. The resolver validates and snapshots the closed
registry, selects by the independently trusted exact package definition rather than by a manifest-
supplied mapping version, and returns a fresh recursively frozen approved defaults value. The current
unready SI candidate has no fabricated approved entry; positive tests inject a closed synthetic
compiled registry. Decision defines the four-string `ApprovedCityCriteriaPackageDefinition` input DTO;
it imports no Research/Application/Infrastructure module. The installer and restart adapter project
exactly those four fields from their already bound Research package definition before calling inward.
`city-package-installation-composition.ts` supplies the compiled production constant to the installer,
and `composition-root.ts` supplies the same inward value to restart/runtime lookup composition. Tests
may inject a separate closed test registry, but no manifest/parser/database value can replace it.
`CityCatalogStorePort.appendVerified` deliberately accepts the existing inward
`CityCatalogProjection`, whose only keys are the exact closed `{ registry, catalog }` pair; there is no
separate publication alias and no Infrastructure row/SQLite type crosses the boundary.
`CityCatalogStorePort` is also the independent installed-root authority for Task 14. Its
`latestInstalledVerified(countryCode)` verifies and returns the complete persisted latest installed
`{ registry, catalog }` projection rather than an object borrowed from
`InstalledCityPackageLookupPort`; Setup/Start canonical-compare that projection and both exact IDs with
the package lookup's purely reconstructed projection. Immediately after that equality, Core validates
the lookup result's exact frozen `{ id, key }` manifest binding, compares the five-field key and freezes
the one `installedPackageContext` before any other read/callback or member/plan use; every later
Setup/Start stage consumes only that frozen trust-gate result and never repeats manifest validation. Its
`loadVerified(id)` supplies the exact authenticated frozen revision for Continue, so an installation
that becomes latest cannot redirect an existing frontier run. Neither method reaches a live source.
`CityResearchPackageReadyCandidate`, `CityResearchPackageAvailability`, the pure
`getCityResearchPackageAvailability` resolver and `assertCityPackageReady` live in inward Research
`src/research/city-package.ts`. A ready candidate carries only definition, source-contract status and
the empty ready discriminant; it does not contain Registry, Catalog, plans, validators or an installed
lookup result. `InstalledCityResearchPackage` remains the distinct full installed value.
It and `InstalledCityPackageExactKey` are inward Research contracts in
`src/research/city-package.ts`; Application imports that exact key rather than owning a duplicate.
`InstalledCityPackageLookupPort` likewise belongs to Application in
`src/application/city-data-contracts.ts`. `installed-city-packages.ts` only implements the port (and the
Task 7 `CityEvidencePackageReplayPort`) and never owns or re-exports a second public key/installed-value
contract. The replay method accepts that same `InstalledCityPackageExactKey` directly; it has no
second five-field DTO and no `rulesVersion`-named installed lookup field. Its
`findReady(countryCode)` returns the current ready installed package for Setup/Start only.
`InstalledCityPackageExactKey` is a closed own-data object with exactly the five shown canonical,
nonempty string fields; a missing/extra/noncanonical key is `integrity_mismatch` before lookup.
Its final field is deliberately named `evidenceRulesVersion`; `rulesVersion` elsewhere on a ranking
snapshot means `city-ranker@1` and is never an installed-package lookup value.
`findExact(key)` indexes the immutable installed-package history by all five closed key fields and is
the only runtime package lookup for Continue. It never falls back to country/latest or substitutes a
newer catalog. `undefined` means that exact frozen package revision is absent and Application maps it to
`city_package_revision_not_installed`; a non-undefined value must expose a fresh recursively frozen
`installedPackageManifest` with exactly `id/key`. As an adapter postcondition, its audit ID and key come
only from the manifest store result after persisted canonical bytes, payload hash, hash-derived ID and
HMAC verification. Its key must equal the requested key, definition country/package/schema/evidence
rules and reconstructed `catalog.id`. Application compares that signed five-field key and the complete
closed serialized replay projections and relies on the adapter postcondition for exact compiled
behavior-version selection; it has no separately persisted expected manifest ID and does not compare
the audit ID. Any visible-field or hidden manifest-key drift is
`integrity_mismatch`, never not-found. Both outcomes occur before a source call or write.
The implementation retains old installed projections after a later installation. Its replay projection
must be derived from the same exact installed value and include that value's exact
package definition, `catalogProjection: { registry, catalog }`, per-city fixed plans, safety
plan/directory and validators; the lookup keys include the requested catalog revision ID and never
resolve via "latest". The projection is accepted only after Task 7
`reconstructVerifiedCityCatalog(..., replayIntegrity)` verifies both IDs and the complete root. The
installed type/registry
may be implemented only after the exact criterion definitions/defaults/evaluators are approved and
the Registry plus Catalog with `schemaVersion === "city-catalog@1"` and
`rulesVersion === CITY_CATALOG_RULES_VERSION`, and all per-member plan artifacts, are sealed and reconstructed. No candidate may
be cast or relabelled as installed, and no installed value may be fabricated for current SI.

`sealCityPackageAdministrativeEvidence` is the only truthful creation path for package data artifacts.
It is an inward Application use case and imports no SQLite/HTTP module. It receives only the already
reconstructed values shown, the exact verified Catalog member order, `installedAt`, one full
`EvidenceIntegrity` and the generic inward write store. It first snapshots its closed input, rejects
accessors/symbols/non-plain values/sparse arrays, and canonicalizes each serialized value exactly once.
For each material, its bytes are exactly UTF-8 of that canonical JSON and its SHA is
`integrity.hash(canonicalJson)`. The use case derives, rather than accepts, this order: every Catalog
member in Catalog order, with its long-rent/transit/broadband fixed plans in canonical source order,
then the safety source plan, authority directory, approved criteria defaults and ordered criterion-
definition tuple. Thus the five closed role classes contain exactly `3 * memberCount + 4` artifacts,
one per serialized value, with integer ordinals `0..(3 * memberCount + 3)` and no caller-controlled
reordering.

For the ordered material descriptor `{ artifactOrdinal, slot, role, sha256 }`, where `slot` is the exact
closed `InstalledCityPackageArtifactSlot`, `buildInstalledPackageArtifactSetClaim` is the sole pure
owner of these equations:

```ts
const installRunPayload = {
  schemaVersion: "city-package-install-run@1",
  key,
  artifacts: orderedMaterialDescriptors,
};
const installRunId =
  `city-package-install:${integrity.hash(integrity.canonical(installRunPayload))}`;
const evidenceId = `${installRunId}:evidence`;
const artifactId = `${installRunId}:artifact:${String(artifactOrdinal).padStart(3, "0")}` +
  `:${role}:${sha256}`;
```

The builder receives only the verified exact key, canonical `installedAt` and the complete dense
ordered material descriptors. It snapshots/rejects accessors, symbols, sparse arrays, extra/missing
keys, noncanonical IDs/timestamps/SHA and invalid slot/role pairs; fixed-plan slots require the fixed-
plan role and each singleton slot requires its one matching singleton role. It requires ordinals
`0..N-1`, a nonempty injective slot set and the canonical member/source/singleton order, then derives
the run, Evidence and every artifact ID with the equations above. It returns one fresh recursively
frozen `BuiltInstalledPackageArtifactSetClaim`; neither caller supplies an ID or claim field.

The built claim is closed at every level. Its top level has exactly
`claimId/sourceId/value/scope/sourcePeriod/anchor/status`; `value` has exactly
`schemaVersion/key/installRunId/evidenceId/orderedArtifacts`; and every ordered-artifact item has exactly
`artifactOrdinal/role/artifactId`. Require `claimId === installRunId + ":artifact-set"`, source and scope
exactly `city-package-installation`, status exactly `verified`, `sourcePeriod === installedAt`, a fresh
closed exact key, the derived run/Evidence IDs and all derived role/ordinal/artifact-ID items in order.
`anchor` has exactly `artifactId/locator/excerptSha256`: its artifact is ordinal zero, its locator is
exactly `"urn:city-package-installation:" + installRunId`, and its excerpt SHA is the ordinal-zero
material SHA. No timestamp, ID, ordered item, anchor or literal is copied from a supplied claim.

`reconstructInstalledPackageArtifactSetClaim(claims, input, integrity)` has an explicit no-callback
first phase. Before it invokes the builder or any `integrity.canonical`/`integrity.hash` callback, it
walks only own data descriptors of the entire borrowed `claims` graph, requires a dense one-item array
and the exact plain-object graph for the claim, value, exact key, ordered-artifact items and anchor,
rejects accessors without invoking them, rejects symbols, sparse arrays and custom prototypes, and
copies every primitive/array/object into a private recursively frozen graph. It never freezes or retains
the caller's array or any nested caller object. Only after that owned closed snapshot exists does it
invoke the builder from the independently verified input and require the owned sole claim to equal
`expected.claim` under `integrity.canonical`; it returns a fresh recursively frozen built result.
Missing, extra or duplicate claims, duplicate/sparse ordered items, any extra
claim/value/key/anchor/item key and any field drift fail `integrity_mismatch`, even when the outer
Evidence or package manifest was re-signed. A reentrant integrity callback may mutate the original
borrowed graph but cannot alter the owned comparison or result. Both pure functions receive only
`CityDecisionIntegrity { canonical, hash }`; neither can sign, load or inspect bytes.

Every administrative artifact has that `runId/artifactId`, source ID exactly
`city-package-installation`, media type exactly `application/json`, producer exactly
`install-city-package@1`, and `createdAt === installedAt`. It has no HTTP request, response or URL
field. The one generic Evidence bundle has ID `evidenceId`, assessment date equal to the UTC date of
`installedAt`, rules version `city-package-administrative-evidence@1`, parser version
`city-package-administrative-json@1`, structurally absent `contextHash` and
`knowledgeBaselineRevisionId`, and one exact verified administrative source/manifest entry with no
navigation, request or response field. The Application use case calls
`buildInstalledPackageArtifactSetClaim` once and uses its returned run/Evidence/artifact IDs and sole
claim without rebuilding or spreading it. It then calls the existing
generic `sealEvidencePlan<"city-package-installation", CityPackageAdministrativeEvidenceClaim,
"administrative">` exactly once with the matching explicit `SealEvidenceInput` specialization, appends
the owned administrative artifacts through its explicitly administrative write-store port, seals that
one bundle and returns its generated bindings. No second sealing algorithm or HTTP
capture seam is introduced. It uses the injected full integrity's canonical/hash methods for material
construction but never calls `sign` directly; only that single `sealEvidencePlan` invocation observes
the signing method, and only the store observes it again for verification.

Exact retry means the same closed key, installed time, ordered values, producer and canonical bytes;
the generic artifact/Evidence store then requires full canonical provenance, byte and sealed-bundle
equality and converges under a two-connection race. Same content/key with different `installedAt` has
the same content-derived run/Evidence/artifact IDs but different signed provenance and is an integrity
collision, not a retry. Different content under the same package key derives a different install run;
the later manifest exact-key constraint rejects the losing installation and it cannot advance the head.
Any theoretical hash/ID collision with different canonical descriptors, provenance or bytes is also
`integrity_mismatch`. A crash after the administrative Evidence seal but before manifest publication may
leave only an unreferenced immutable generic bundle; exact retry reuses it, and no installed lookup can
expose it without a verified manifest.

`InstalledCityPackageManifestPayload` is the durable, closed, serializable installation boundary. Its
top level has exactly the thirteen keys shown; `key`, every artifact binding, fixed tuple element,
`catalogRoot`, `safety`, `criteria`, definition/version maps and the ready discriminant are recursively
closed plain objects/dense arrays. Each `InstalledCityPackageJsonArtifactBinding` has exactly the eight
shown keys. Its `sourceId` is exactly `city-package-installation`, its role is one of the five closed
literals, its media type is exactly `application/json`, its run/Evidence/artifact IDs are canonical
nonempty strings, its ordinal is the exact canonical position above, and its SHA is lowercase SHA-256.
All bindings have the one exact `runId/installRunId` and `evidenceSnapshotId/evidenceId`; require the
ordinal/role/SHA artifact-ID equation above. Every artifact slot contains
one binding object, never an array: one `planArtifact` for each fixed plan, one safety-plan artifact,
one authority-directory artifact, one criteria-defaults artifact and one artifact containing the
canonical ordered four-definition tuple. The complete slot-to-artifact map is injective: no artifact ID
or `(evidenceSnapshotId, artifactId)` pair may satisfy two slots, and no member/source slot may be
missing or extra.

The manifest does not duplicate Catalog bytes or Catalog Evidence. `catalogRoot` has exactly
`registryRevisionId/catalogRevisionId`; the latter equals `key.catalogRevisionId`. Reconstruction calls
`CityCatalogStorePort.loadVerified(catalogRevisionId)`, requires its verified Registry ID and complete
Catalog country/package identity to equal the manifest key/definition, requires
`catalog.schemaVersion === "city-catalog@1"` and
`catalog.rulesVersion === CITY_CATALOG_RULES_VERSION`, and uses only that fresh store projection.
`key.packageSchemaVersion` is compared only with the signed manifest/package definition, never with
either Catalog version field. `definition` repeats the key's country/package/schema,
`definition.evidenceRulesVersion === key.evidenceRulesVersion`, and its source IDs equal the canonical
four-source order.

For every verified Catalog member, `fixedPlansByCityId` has exactly one canonical ordered three-source
tuple and every element has exactly one `planArtifact`. Across all members it therefore maps every
member/source pair exactly once. There is exactly one referenced administrative Evidence snapshot, and
its distinct installation-artifact set must equal the complete ordered binding set—no extra, duplicate
or missing artifact. At manifest append and every load after restart, derive one closed
`AdministrativeEvidenceLoadExpectations` from the owned validated manifest payload at append or the
verified persisted manifest at restart: its exact `administrativeEvidenceSnapshotId`, canonical
`installedAt` and complete binding-order artifact IDs;
no caller supplies assessment, parser or rules literals. Pass that owned expectation to the typed
`loadVerifiedAdministrativeEvidenceBundle` capability. It recomputes the canonical manifest, manifest
hash, HMAC, snapshot/manifest equality and every byte SHA, then runs the pure administrative shell
reconstructor before returning anything. Resolve each
binding to exactly one typed administrative entry/artifact and require exact
ordinal/run/source/role/media/SHA/producer/createdAt, recompute the byte SHA and
reject role substitution, mixed live provenance or a second candidate row even if its bytes match.
The package manifest stores only these bindings: it never copies an artifact blob, canonical JSON value
or HTTP-looking provenance into a package table.
At append and every restart load, reconstruct the exact
`BuildInstalledPackageArtifactSetClaimInput` from the verified manifest key/`installedAt`, its exact
outer member/source/singleton slot positions and the byte-verified artifact SHAs. Call
`reconstructInstalledPackageArtifactSetClaim(bundle.snapshot.claims, input, integrity)` and require its
fresh derived run/Evidence/artifact IDs and ordered role bindings to equal every manifest binding,
bundle snapshot/manifest ID and administrative provenance field. The envelope reconstruction therefore
precedes claim reconstruction, and both checks run before artifact JSON decoding, behavior lookup,
manifest insert/current-pointer advance or installed-package return. A
caller-supplied run/order/claim value is never trusted, and append/restart share no private claim or ID
builder.

The Infrastructure-private canonical JSON decoder strictly decodes UTF-8, parses exactly one JSON
value, requires the original bytes to equal UTF-8 of `integrity.canonical(parsed)`, and returns only an
owned fresh value. Fixed-plan slots pass it to
`reconstructCityFixedSourcePlan(value, fixedBinding.sourceId)` and bind every plan/city/source/criterion/
definition/parser/rules/policy field. Decode and reconstruct the authority directory first with
`reconstructOfficialAuthorityDirectory`, then reconstruct the safety plan with
`reconstructCitySafetySourcePlan` against that directory and the verified Catalog. Decode the one
definition tuple through `reconstructInstalledCityCriterionDefinitions` in canonical criterion order.
Before any evaluator normalization, independently call `resolveApprovedCityCriteriaDefaults` with the
exact package definition and compiled approved-defaults registry. Require the manifest
`defaultsMappingVersion` to equal the returned mapping version and require
`integrity.canonical(decodedDefaults) === integrity.canonical(approvedDefaults)` over the complete
four-draft object, including every target, mode and importance. The manifest's version is only a signed
cross-check; it never selects or creates an approved registry entry. Only after that equality and all
manifest/Catalog/artifact integrity succeed may the adapter resolve the exact compiled executable-
behavior key and pass the same decoded defaults, reconstructed definitions and resolved evaluators to
`reconstructInstalledCityCriteriaDefaults`. Bind every mapping/definition/evaluator version to the
manifest and both compiled registries. No route, plan, directory, criteria or policy bytes may
come from an unsealed process-local object after restart, and no executable behavior runs before the
persisted data boundary is authenticated.

`InstalledCityPackageManifestStorePort.appendVerified` performs the complete Catalog, artifact and
non-executable policy/version reconstruction above on an owned closed copy before it computes a
signature or writes, and
`loadVerified`/`latestVerified` repeat it before returning. Every successful store method has an
explicit authenticity postcondition: the returned `id/payloadHash/hmac/key` were obtained from the same
persisted canonical payload bytes after recomputing canonical equality, payload hash, hash-derived ID
and expected HMAC and comparing hash/HMAC in constant time. Mirrored key columns must equal the parsed
signed key. The payload being signed is therefore the one validated owned value, not caller-owned
metadata that can change during a callback or transaction. The installed-package lookup/replay adapter
accepts only that verified store result, never a caller-built manifest, and exposes its `{ id, key }`
only as a fresh frozen audit binding. Consumers verify the signed key and complete reconstructed
projection; they do not invent an expected manifest ID absent from their persisted context.

The manifest never serializes a function, closure, class instance or executable source. There is no
evaluator-registry, evaluator, value-validator or source-period-validator artifact role: those
executable capabilities are referenced only by the closed version IDs shown and must resolve in the
compiled behavior registry. The inward compiled approved-defaults registry is injected separately and
contains only closed data. If it has no unique `approvedFor` match for the exact package definition,
restart/installation fails `city_package_behavior_unavailable`; it never trusts an unsupported manifest
mapping version or falls forward. If a match exists but the signed manifest mapping or canonical
defaults artifact differs, including a re-signed target/mode/importance change, the result is
`integrity_mismatch` before evaluator normalization. Infrastructure
`installed-city-packages.ts` owns one private closed, versioned in-process behavior registry. Its lookup
key is the canonical exact object
`{ evaluatorRegistryVersionId, evaluatorVersionIds, valueValidatorVersionId,
sourcePeriodValidatorVersionId }`; `evaluatorVersionIds` itself has exactly the four criterion keys.
Each registry entry repeats that complete version object and supplies only the inward
`CityCriterionEvaluatorRegistry`, `CityFixedValueValidator` and `CityFixedSourcePeriodValidator`
behaviors for those exact IDs. The adapter rejects extra/missing behavior keys and proves the returned
evaluator registry declares every requested evaluator version. Manifest reconstruction first verifies
all persisted data/artifacts, then resolves that exact key and assembles a fresh frozen
`InstalledCityResearchPackage` carrying a fresh frozen
`installedPackageManifest: { id: verifiedManifest.id, key: verifiedManifest.key }` binding. Missing compiled behavior throws
`city_package_behavior_unavailable`, including a missing individual evaluator implementation; it is
never treated as not-installed, upgraded to a newer version or fabricated from serialized code. A
missing/tampered referenced artifact or a present behavior whose declared policy binding differs is
`integrity_mismatch`.

Seal a manifest from the exact payload with the store-only `EvidenceIntegrity` equations:

```ts
const canonicalPayload = integrity.canonical(payload);
const payloadHash = integrity.hash(canonicalPayload);
const id = `installed-city-package-manifest:${payloadHash}`;
const hmac = integrity.sign(canonicalPayload);
```

Persist that canonical payload/hash/HMAC and verify the equations with length-safe constant-time hash/
HMAC comparisons on every read before resolving artifacts or behavior. The first country manifest has
`predecessorManifestId: null`; a successor names the verified current manifest and has a strictly later
`installedAt`. The exact five-field key and manifest ID are unique. Exact canonical retry is idempotent;
same key/different payload, same ID/different canonical payload, stale predecessor and lost-race drift
are integrity conflicts. Manifest rows and predecessor links are immutable with UPDATE/DELETE triggers.
`installed_city_package_heads` contains exactly one current-manifest pointer per installed country.
Installation inserts and verifies the immutable signed successor and advances only that pointer with a
compare-and-swap from the signed predecessor in the same immediate transaction; it never updates or
removes exact A. On every current lookup, verify the pointer names the unique no-successor manifest in
the intact signed predecessor chain, so pointer rollback, a fork and a skipped predecessor fail closed.
`findReady` and `latestInstalledVerified` resolve through that verified current pointer, while
`findExact`, Task 7 replay and Task 10 resolve the requested historical manifest directly by its full
key. Unreferenced catalog publication rows do not become installed/current packages.

- [ ] **Step 1: Write store/install RED tests**

First assert the pure current SI availability remains the Task 6 not-ready candidate and fails with
`city_package_not_ready` and all four readiness issues before any installed lookup,
official-source call, database read/write or catalog row. Assert a synthetic ready availability is
returned unchanged by `assertCityPackageReady`; prove an absent `findReady` result stays distinct for
Task 14 to map only to `city_package_not_installed`. Positive installer tests use a local synthetic
ready candidate plus a separate local synthetic installed package whose artifacts are created through
the real administrative sealing use case, with an approved compiled test-only defaults entry plus
value/period validators; they must not relabel Slovenia fixtures.
Require each installed/replay projection to preserve exact claim-contract value/period policy
versions, validator results and the exact Registry+catalog projection/root. Then cover out-of-band official catalog
capture/seal/publication, full considered-universe reconstruction
with omitted mandatory-capital/selected-population-fill rows and re-signed population tamper, exact
99/100/101 member boundary, `NEEDS_CONTEXT` with zero publication for more than 100 mandatory capitals,
historical administrative catalog load/replay with `schemaVersion === "city-catalog@1"` and
`rulesVersion === LEGACY_CITY_CATALOG_RULES_VERSION`, rejection and zero new catalog,
installed-manifest or head rows when `appendVerified` receives those legacy rules,
Start-visible latest Registry/catalog with the same schema and `rulesVersion === CITY_CATALOG_RULES_VERSION` without HTTP, distinct-city
roots, exact retry, same-projection successor, known-to-unknown, stale completed check rejection,
simultaneous identical publication, simultaneous distinct publication forming one linear chain, and no
revision for fatal outcomes.

In `city-package-artifact-set.test.ts`, drive both pure functions with the exact key, canonical install
time and complete synthetic member/source/singleton material order. Assert the closed slot/role map,
canonical run payload/hash, run/Evidence/artifact-ID equations, exact built-result and claim own keys,
the complete ordered `artifactOrdinal/role/artifactId` projection, installed-time source period,
installation URN and ordinal-zero anchor SHA. Require fresh recursively frozen nonaliased returns and
only a narrowed `CityDecisionIntegrity` with no sign/I/O capability. Reconstruct the one exact claim,
then independently mutate every top-level claim field, every value/key/ordered-item field and every
anchor field; add/remove/duplicate the claim, add an extra key at each nesting level, make arrays sparse,
alter role/order/ordinal/SHA-derived ID, install time, run/Evidence ID, source period or URN, and require
`integrity_mismatch`. Also reject an invalid slot/role pair, duplicate slot and noncanonical material
order before returning any ID. For the claim reconstructor's first phase, put accessors at every graph
level and assert no getter runs, add symbol keys and custom prototypes, and require all failures before
the builder or either integrity callback. On success and failure, prove the caller array and every nested
caller object remain unfrozen and unretained. Use a counted first integrity callback that reentrantly
mutates the borrowed claim array/value/item/anchor after snapshot; the comparison must use the private
frozen clone and remain deterministic.

In the same pure test file, drive `reconstructAdministrativeEvidenceShell` with the exact three-key
expectation and a generic-verifier-valid package-installation snapshot. Require the fresh frozen exact
own-key shell, installed-date equality, exact ordered artifact IDs, one verified coverage key, empty
blockers, one generic claim, exact one-key parser map, fixed administrative rules version and structural
absence of context/baseline properties. Reject an accessor, symbol, custom prototype, sparse array,
extra/missing field, assessment-date drift, parser key/value/missing/extra drift, rules drift and either
optional property's presence even when it is `undefined`, without any integrity capability.

In `administrative-evidence.test.ts`, pass the verified Catalog order and reconstructed package values
through the real `sealCityPackageAdministrativeEvidence` use case. Assert the exact material order,
slot objects, content/key-derived `installRunId`, `${installRunId}:evidence`, ordinal/role/SHA artifact
IDs and byte-for-byte equality with the one
`buildInstalledPackageArtifactSetClaim` result. Require one generic Evidence seal, exactly one source
entry and exactly that one claim, exact `install-city-package@1` producer and
`createdAt === installedAt`. Assert the installed-date assessment, exact closed administrative parser
map, fixed administrative Evidence rules and structural absence of context/baseline on the produced
snapshot. Every captured artifact and manifest provenance object must have the exact
administrative keys and no `url/request/responseUrl/responseStatus/capturedAt`; the only lineage is the
non-HTTP administrative URN on the generic claim anchor, while the administrative Evidence entry has
no navigation/index/resolution keys. Count every official source, request step,
fixed/safety inspection and search port and require zero calls. Exact retry and two identical SQLite
connections converge by full canonical bundle/provenance/byte equality; change created time under the
same content-derived IDs or inject a same-ID byte/provenance collision and require
`integrity_mismatch`. Different content derives a different run, but a second installation for the same
exact package key cannot publish or advance the head. Close/reopen and recover the identical owned bytes
and provenance, then tamper origin, producer, created time, role, ordinal, media, SHA or bytes and fail
before package reconstruction. In `evidence-store.test.ts`/schema tests, retain the complete live branch
behavior and reject every mixed-origin row, including administrative rows with any live-only column and
live rows with an administrative column or a NULL live column.

Also in `evidence-store.test.ts`, compile and execute
`verifySealedEvidenceForInsert<S, C, O extends EvidenceOrigin>` with both a live and an explicitly
administrative sealed bundle and no cast. Mutate canonical manifest/hash/HMAC/snapshot equality in each
origin and prove both traverse the same shared verifier behavior. Call
`loadVerifiedAdministrativeEvidenceBundle` from the manifest-store integration boundary and require a
fresh typed `AdministrativeVerifiedEvidenceBundle` with exact administrative manifest/entry/artifact
provenance and nonaliased bytes. Pass its exact three-key expectations object and prove the loader
rejects every shell drift before returning the bundle. Static/type tests reject a live row/entry in that return, any SQLite
row-union export, any inward/public re-export of the loader/DTO and any second administrative signature
verifier; `city-package-manifest-store.ts` is the only production importer.

In `evidence-origin-types.test.ts`, compile representative unchanged country-Knowledge, dossier,
`ParserEntry`, `CapturedEntry`, generic replay and Slovenia parser uses against the default type
arguments. Prove `ArtifactBytes.url` and `ParserEntry.artifacts[number].url` remain required/readable,
the established `EvidenceManifest<S, C>`, `SealedEvidence<S, C>` and `EvidenceWriteStore<S, C>` names
resolve to `"live"`, and Task 7's `CapturedEntry[]` cannot contain an administrative artifact. Add
`@ts-expect-error` fixtures showing an administrative terminal entry, provenance object, artifact or
sealed bundle cannot enter any default/live API and that a live value cannot enter the explicit
administrative store. Then compile the matching positive only with the explicit third
`"administrative"` argument. Keep these checks inside a real Vitest case with `expectTypeOf`, so both
the focused Vitest command and full `tsc --noEmit` exercise the fixture. Compile-check the shared
origin-generic verifier and the administrative loader's exact expectation/result types as well. This is
a new type-boundary test only; do not modify country-Knowledge,
dossier, any Slovenia parser, `current-evidence.test.ts` or `cold-start.test.ts` to accommodate the
administrative path.

Install two valid successive synthetic roots under the same country/package/schema/evidence-rules
tuple. Require
`findReady(countryCode)` to return only the newer root while `findExact(oldFiveFieldKey)` still returns a
fresh frozen old installed package with its old plans/validators and
`CityCatalogStorePort.loadVerified(oldCatalogId)` returns the identical old catalog projection. A
recreated lookup adapter must preserve both current-B and exact-A results from the sealed installed
artifacts. Every result exposes a fresh recursively frozen exact `{ id, key }` manifest binding. A
missing exact key returns `undefined`; test adapters that drift any visible field, return the requested
visible definition/catalog with a different hidden `installedPackageManifest.key`, or drift any full
replayed projection are Application-level `integrity_mismatch`. Application does not assert an
independent manifest ID; the real adapter must already have verified the returned audit ID/hash/HMAC
from persisted bytes. Neither exact lookup performs a source call. Compile-check
`appendVerified(input: CityCatalogProjection)` so no undefined publication DTO remains.

In `city-package-manifest-store.test.ts`, seal a complete synthetic manifest from a real verified
catalog, the one real administrative Evidence bundle for fixed-plan/safety/directory/criteria values,
the independently approved defaults entry and registered test behavior versions. Assert the
exact thirteen-key payload, exact canonical payload/hash/ID/HMAC equations, constant-time comparison
paths, deep-frozen fresh readback, exact retry, same-key/different-payload and ID collision, stale
predecessor, simultaneous successor/lost-race normalization, current-pointer compare-and-swap,
rollback/fork/skipped-predecessor rejection and immutable manifest UPDATE/DELETE. Independently
tamper/re-sign every key/root/plan/policy/safety/criteria/artifact/behavior-version field and reject it;
also reject missing/altered/noncanonical JSON bytes, SHA/run/source/media/role/Evidence binding, missing
member/source/criterion/tuple, an extra or duplicated artifact, one artifact reused for two slots, role
ambiguity, noncanonical ordering and a manifest containing any function or extra executable field.
Require exactly one artifact for every fixed-plan slot and exactly one each for the safety plan,
directory, defaults and complete definition tuple; assert the deterministic ordinal/role/SHA artifact-
ID equation, one common administrative Evidence/run binding and reject any Catalog bytes or Catalog
artifact field/binding in the manifest. Reject live/HTTP-looking package provenance, wrong producer or
created time, noncanonical administrative artifact order and a second Evidence bundle. Prove no evaluator/validator artifact role
is accepted and that only the exact compiled version key can supply executable behavior.

At both manifest append and a fresh-adapter restart load, assert the store obtains only the typed
administrative bundle, rebuilds the `BuildInstalledPackageArtifactSetClaimInput` from verified manifest
slots plus byte-verified SHAs and calls the shared reconstructors before decode/write/return. First pass
the exact derived `AdministrativeEvidenceLoadExpectations`, then mutate the administrative Evidence
snapshot and its manifest snapshot consistently, recompute the generic canonical manifest/hash/HMAC and
re-sign the package manifest. Independently drift `assessmentDate`; the required parser key; its value;
a missing or extra parser key; `rulesVersion`; a present `contextHash`; and a present
`knowledgeBaselineRevisionId`. Every case must fail at both append and restart before claim
reconstruction, artifact decode, write or installed-package return. Then mutate and re-sign the
administrative Evidence for every claim field and nested key/item/anchor field, including
exact key, installed-time source period, run/Evidence ID, ordered role/artifact IDs, installation URN and
ordinal-zero SHA; separately use zero, two identical or two conflicting claims and extra/sparse claim
data. Each must fail `integrity_mismatch` at append and after restart even when generic manifest/hash/
HMAC and package-manifest signature are internally recomputed. Assert no manifest/head write on append
and no installed package/projection/behavior call on restart. A positive append/restart returns the
identical fresh reconstructed claim/bindings without a cast or private duplicate builder.

Tamper the persisted canonical payload bytes, mirrored key, payload hash, manifest ID and HMAC one at a
time, including a forged audit ID paired with the right signed five-field key. Both direct
`InstalledCityPackageManifestStorePort` loads and real `installed-city-packages.ts` current/exact/replay
lookups must fail before artifact decode or projection return. This is the forged-ID/HMAC RED boundary;
Application and Task 7 do not duplicate it with an unavailable expected manifest ID.

In `city-criteria.test.ts`, drive
`reconstructInstalledCityCriterionDefinitions` and
`reconstructInstalledCityCriteriaDefaults` directly. Require exact own-key closure, canonical
four-criterion order, exact definition/evaluator-version maps, dense compatible scopes/default tuple,
canonical targets under the supplied evaluators, mapping-version equality and fresh recursive freeze.
Reject missing/extra/reordered/duplicate definitions or defaults and every definition, evaluator,
mapping, target and tuple binding drift.

In `approved-city-criteria-defaults.test.ts`, validate the exact closed compiled registry and select a
single entry solely from an independently supplied approved package definition. Require the record key,
entry/default mapping versions and exact approved-for country/package/schema/evidence-rules tuple to
agree, and
require exactly four complete drafts in deterministic criterion order with exact definition, target,
mode and importance. Reject extra/missing/duplicate package selections, an unsupported definition or
mapping version, map-key drift and every missing/extra/reordered/draft-field mutation. Installer and
restart tests must prove the manifest mapping version does not select the registry entry: a missing
compiled selection is `city_package_behavior_unavailable`; a re-signed manifest/defaults artifact with
altered mapping, target, mode or importance is `integrity_mismatch` before any evaluator
`canonicalizeTarget`/`evaluate` call. A canonical artifact equal to the independently selected entry is
then passed unchanged to `reconstructInstalledCityCriteriaDefaults` and normalizes successfully.

Close and reopen the database and construct a new `installed-city-packages.ts` adapter with only the
closed compiled test behavior registry and independently compiled approved-defaults registry. With
signed successor manifests A→B, assert current lookup is B,
exact lookup and `CityCatalogStorePort.loadVerified` of A still reconstruct A, and a Task 7 package replay
lookup for A returns A's exact catalog/plans/safety/criteria/validators with zero source/network call.
Remove each referenced artifact in turn, tamper a manifest/HMAC, omit the approved-defaults selection,
and omit each exact compiled evaluator/value/source-period behavior version: artifact/signature or
selected-defaults mismatch is `integrity_mismatch`, compiled selection/behavior absence is
`city_package_behavior_unavailable`, and neither falls back to B or a newer compiled version.
Current unready SI creates no manifest, current pointer or behavior entry.

- [ ] **Step 2: Run RED**

```bash
./node_modules/.bin/vitest run tests/domain/approved-city-criteria-defaults.test.ts \
  tests/domain/city-criteria.test.ts \
  tests/research/city-package-artifact-set.test.ts \
  tests/research/evidence-origin-types.test.ts \
  tests/integration/administrative-evidence.test.ts \
  tests/integration/evidence-store.test.ts \
  tests/integration/city-package-manifest-store.test.ts \
  tests/integration/city-knowledge-store.test.ts \
  tests/integration/database-schema.test.ts
```

- [ ] **Step 3: Add administrative artifacts plus manifest/head, catalog and knowledge tables**

Evolve the generic `artifacts` table in `schema.sql`/`db.ts` without inventing an HTTP request. The
common non-NULL columns remain `run_id`, `artifact_id`, `source_id`, `role`, `media_type`, `sha256`,
`bytes`, `byte_length`, `origin` and `sealed`; `origin` permits exactly `live | administrative`. Make the existing
`url/captured_at/response_status/response_url/request_json` columns nullable only so the discriminated
row can express administrative provenance, and add nullable `producer/created_at`. One table-level CHECK
is exactly the disjunction: a live row has all five live-only columns non-NULL and both administrative
columns NULL; an administrative row has all five live-only columns NULL and nonempty
`producer/created_at` non-NULL. Retain the live HTTP-status bound when status is non-NULL. The adapter
additionally requires strict UTC-millisecond `createdAt`, exact closed origin-specific objects, byte
length/SHA equality and rejects a mixed branch before insert and after load. `db.ts` treats the old
live-only shape or a missing/disagreeing CHECK/column as reset-required, and exact schema tests exercise
direct SQL rejection in both directions. Newly inserted live artifact readback and country/City replay
remain byte-for-byte behavior-compatible. Package tables never receive a blob; their FK/bindings name the one
sealed generic administrative Evidence bundle.

```sql
CHECK (origin IN ('live', 'administrative')),
CHECK (response_status IS NULL OR response_status BETWEEN 100 AND 599),
CHECK (
  (origin = 'live'
    AND url IS NOT NULL AND captured_at IS NOT NULL AND response_status IS NOT NULL
    AND response_url IS NOT NULL AND request_json IS NOT NULL
    AND producer IS NULL AND created_at IS NULL)
  OR
  (origin = 'administrative'
    AND url IS NULL AND captured_at IS NULL AND response_status IS NULL
    AND response_url IS NULL AND request_json IS NULL
    AND producer IS NOT NULL AND length(producer) > 0
    AND created_at IS NOT NULL AND length(created_at) > 0)
)
```

`installed_city_package_manifests` stores the exact key, predecessor, installed time, canonical closed
payload/hash/HMAC, one mirrored `administrative_evidence_snapshot_id` FK equal to every signed binding,
and immutable triggers; exact-key, ID and predecessor/successor indexes make historical
lookup deterministic. `installed_city_package_heads` stores only the country-to-current-manifest pointer,
with strict FK/unique constraints and compare-and-swap updates; loading it verifies that it equals the
unique no-successor head of the signed immutable chain. No mutable latest-only package payload exists.
`city_catalog_revisions` stores the closed Registry, full considered-universe population projection,
reconstructed Catalog and Evidence binding. `city_knowledge_revisions` stores one root/one successor per
city, unique city+Evidence, mirrored `rules_version` and revision times, payload/hash/HMAC and immutable
triggers. Add strict preflight and exact table/index/trigger inventories.

- [ ] **Step 4: Implement immediate publication and the administrative installer**

Catalog installer is an explicit CLI/eval use case, never a browser route and never called by City
Start. Both administrative installation and Setup/Start runtime resolution begin with the pure
availability and `assertCityPackageReady` boundary, without an Infrastructure call; package-unready is
`city_package_not_ready` and not `NEEDS_CONTEXT`. The installer does not call `findReady` to decide
readiness or require a package that it is about to install. It proves the approved exact criteria
policy by resolving the one matching entry from the independently compiled
`ApprovedCityCriteriaDefaultsRegistry` using the ready candidate's exact definition; neither install
input nor manifest chooses `defaultsMappingVersion`. It requires the supplied defaults value to be
canonically equal to that entry before invoking any evaluator. It passes all three fixed plans for every
member through `reconstructCityFixedSourcePlan(value, tupleExpectedSourceId)`, binds every returned
route/plan/member/source/criterion/version and complete claim contract to the sealed installed artifacts,
and proves the version-pinned canonical-scalar value validator, version-pinned source-period validator,
and a sealed source plan for
every member of the at-most-100 catalog, and all four readiness issues closed before constructing
and registering `InstalledCityResearchPackage`. Pass those values to
`sealCityPackageAdministrativeEvidence`; that use case serializes only the five allowed data-value role
classes as canonical JSON in the pinned slot order, creates/persists the one administrative generic
Evidence bundle, and returns exactly one binding per slot. Build the complete injective member/source
slot map only from that verified return. Catalog is loaded by its verified store ID and is not serialized
again. Executable evaluators and
validators contribute only their closed behavior-registry version IDs. Expose an exact-key entry only after
`appendVerified` returns the matching verified catalog bundle and
`InstalledCityPackageManifestStorePort.appendVerified` durably seals the exact manifest; exact entries
are immutable and exact retry is idempotent, while only a verified signed successor may become the
country head. The manifest/head immediate transaction references the already sealed administrative
Evidence and advances only the verified country current pointer; it never duplicates its bytes. If that
transaction fails, the unreferenced Evidence bundle is not an installed package and may only be reused
by exact retry. Reloading the registry reconstructs both current and historical exact entries from their
manifests, verified catalogs/administrative Evidence, approved-defaults registry and exact executable-
behavior registry; it does not require a mutable latest-only package row. Later Setup/Start runtime calls
`InstalledCityPackageLookupPort.findReady(countryCode)` only after pure readiness succeeded;
`city_package_not_installed` is reserved solely for `undefined` at that point, never for an existing
unready candidate and never as a slash-form alternative. Continue instead calls `findExact` with the
one closed `InstalledCityPackageExactKey` frozen as its Ranking snapshot's
`installedPackageContext`; it passes that object unchanged and maps only `undefined` to
`city_package_revision_not_installed`; it never resolves by country/latest. Every returned installed
package must itself retain the installed `ready` discriminant, expose the verified frozen
`installedPackageManifest` audit ID/key postcondition and exactly repeat all lookup-key, definition and source-
contract fields before use; Continue does not compare it with a possibly newer
country-only candidate. A particular frontier run may still check only ten.
`CityCatalogNeedsContextError` and `NEEDS_CONTEXT` remain exclusively the catalog-overflow outcome
for more than 100 mandatory capitals and insert no Registry/catalog rows. `appendVerified` and the
installer require `catalog.schemaVersion === "city-catalog@1"` and
`catalog.rulesVersion === CITY_CATALOG_RULES_VERSION`; a legacy catalog-rules publication request is
`city_catalog_upgrade_required` and writes nothing. `CityCatalogStore.loadVerified` still replays an
already persisted historical legacy-rules row, or the exact sealed current-rules catalog artifacts,
through the rules-version-pinned package parser without HTTP, compares
the full Registry/population projection, verifies the Registry and catalog IDs with
`reconstructVerifiedCityCatalog`, and only then reconstructs membership. Knowledge publication loads verified City Evidence
inside `BEGIN IMMEDIATE`, reconstructs all three fixed ledgers plus the complete safety ledger and
their accepted/reviewed URL lineages,
resolves the current head, rebuilds the full revision with injected integrity, rejects a check not
newer than the head, inserts, reloads and verifies the complete predecessor chain.

- [ ] **Step 5: Run GREEN and commit**

```bash
./node_modules/.bin/vitest run tests/domain/approved-city-criteria-defaults.test.ts \
  tests/domain/city-criteria.test.ts \
  tests/research/city-package-artifact-set.test.ts \
  tests/research/evidence-origin-types.test.ts \
  tests/integration/administrative-evidence.test.ts \
  tests/integration/evidence-store.test.ts \
  tests/integration/city-package-manifest-store.test.ts \
  tests/integration/city-knowledge-store.test.ts \
  tests/integration/city-evidence-store.test.ts tests/integration/database-schema.test.ts \
  tests/integration/current-evidence.test.ts tests/integration/cold-start.test.ts \
  tests/integration/confirmed-life.test.ts tests/branch/life-git.test.ts
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/eslint src/application/install-city-package.ts \
  src/application/seal-administrative-evidence.ts \
  src/research/contracts.ts src/research/research-plan.ts src/research/city-package.ts \
  src/research/city-package-artifact-set.ts \
  src/decision/city-criteria.ts src/decision/approved-city-criteria-defaults.ts \
  src/application/city-data-contracts.ts \
  src/infrastructure/city-package-installation-composition.ts src/infrastructure/composition-root.ts \
  src/infrastructure/sources/installed-city-packages.ts \
  src/infrastructure/sqlite/db.ts src/infrastructure/sqlite/evidence-store.ts \
  src/infrastructure/sqlite/city-{catalog,package-manifest,knowledge}-store.ts \
  tests/domain/{approved-city-criteria-defaults,city-criteria}.test.ts \
  tests/research/city-package-artifact-set.test.ts \
  tests/research/evidence-origin-types.test.ts \
  tests/integration/{administrative-evidence,evidence-store,city-package-manifest-store}.test.ts \
  tests/integration/database-schema.test.ts \
  tests/integration/city-knowledge-store.test.ts evals/install-city-package.ts
git diff --check
git add src/research/contracts.ts src/research/research-plan.ts src/research/city-package.ts \
  src/research/city-package-artifact-set.ts \
  src/decision/city-criteria.ts src/decision/approved-city-criteria-defaults.ts \
  src/application/city-data-contracts.ts \
  src/application/seal-administrative-evidence.ts \
  src/application/install-city-package.ts \
  src/infrastructure/city-package-installation-composition.ts \
  src/infrastructure/composition-root.ts \
  src/infrastructure/sources/installed-city-packages.ts \
  src/infrastructure/sqlite/evidence-store.ts \
  src/infrastructure/sqlite/city-catalog-store.ts \
  src/infrastructure/sqlite/city-package-manifest-store.ts \
  src/infrastructure/sqlite/city-knowledge-store.ts src/infrastructure/sqlite/schema.sql \
  src/infrastructure/sqlite/db.ts evals/install-city-package.ts \
  tests/research/city-package-artifact-set.test.ts \
  tests/research/evidence-origin-types.test.ts \
  tests/integration/administrative-evidence.test.ts tests/integration/evidence-store.test.ts \
  tests/integration/city-package-manifest-store.test.ts \
  tests/domain/city-criteria.test.ts tests/domain/approved-city-criteria-defaults.test.ts \
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
Seal the bundle under installed root A, install successor B, close/reopen SQLite and construct a new
package adapter from the persisted manifests/administrative Evidence plus only the closed compiled
approved-defaults and executable-behavior registries.
Replay must still resolve A by the overlay's exact five-field key; absence of A's manifest, referenced
artifact, approved defaults selection or exact behavior version fails closed and never falls through to
current B.

- [ ] **Step 2: Run RED**

```bash
./node_modules/.bin/vitest run tests/integration/city-evidence-replay.test.ts
```

- [ ] **Step 3: Implement package-specific byte replay**

Load the signed overlay and generic artifacts; Task 7 load has already completed its iterative visited-
set verification of the complete prior-Evidence chain. Reuse that depth-safe discipline when projecting
prior accepted provenance. Construct the shared `InstalledCityPackageExactKey` from the overlay's exact
`countryCode/packageId/packageSchemaVersion/catalogRevisionId/evidenceRulesVersion` fields and call only
`ports.package.loadExactReplayContract(key)` with that closed value; no duplicate lookup DTO or
`rulesVersion` alias exists. That port reconstructs the historical package after restart from the Task 9 immutable signed manifest,
verified referenced administrative Evidence, the independently selected compiled defaults entry and
the exact closed compiled behavior-registry entry; it never uses the
current-country pointer or upgrades an unavailable behavior to B. Require the exact installed
manifest's `packageSchemaVersion` to equal its signed package definition, then require the reconstructed
Catalog to retain `schemaVersion === "city-catalog@1"` and
`rulesVersion === CITY_CATALOG_RULES_VERSION`; the legacy catalog-rules value is
`city_catalog_upgrade_required` and is never a City-run replay compatibility path. Pass the manifest's
complete package definition and its exact `catalogProjection: { registry, catalog }` through
`reconstructVerifiedCityCatalog(..., ports.integrity)` before identity/package/member binding. Pass all
three fixed plans through `reconstructCityFixedSourcePlan(value, tupleExpectedSourceId)` before
reconstructing their attempt ledgers;
no private Task 10 plan validator is permitted. Then canonical-compare all three fixed attempt ledgers
against their ordered installed routes plus the safety attempt ledger with
that verified catalog, reconstructed safety plan/directory, narrowed canonical/hash integrity and
verified previous provenance.
Pass every safety artifact occurrence through the Task 7
`reconstructCitySafetyArtifactBridge`. Eagerly snapshot every verified `CapturedEntry` and copy each
byte view into a private non-shared `Uint8Array` before the first integrity/package callback. Use only
that owned live provenance, call `ports.integrity.hashBytes` on a further private copy and compare every
byte hash with the verified manifest, rerun the installed canonical-scalar value and source-period
validators on sealed permitted bytes/minimal projections, require the value validator's exact
canonical string equality, and
canonical-compare claims, blockers, fixed attempt order/URLs/reasons/artifacts/claim IDs, safety
queries/candidate order/redirects/counters/accepted/reviewed URLs, parser/rules versions, exact
assessment/completion chronology and context. Reject an absent or mismatched package definition,
Registry/catalog root or replay contract, cycles and wrong-city/source-plan lineage.
The implementation receives exactly the Task 7 `read`/`integrity`/`package` capability object; it
receives only the inward no-sign `CityEvidenceReplayIntegrity` canonical/hash/hashBytes capability,
cannot sign, seal, import `node:crypto`/Infrastructure or reach a live-source/search port. A mutating
`hashBytes` fake cannot change bytes used by later decode/comparison or returned replay. Never call
`CityFixedRoutePort.inspect`,
`CitySafetyOfficialDocumentPort.inspect`, `CitySafetySearchPort.search`,
`OfficialSourcePort.capture` or `RequestStep`.
Infrastructure composition alone calls `createCityEvidenceReplayIntegrity` and injects the returned
inward capability into this Application use case.

- [ ] **Step 4: Add drift/tamper tests**

Reject parser version drift, wrong package/city/context, altered bytes/hash, missing artifact,
missing/altered/cyclic prior Evidence lineage, changed blocker, fixed route/URL/order/reason/artifact/
claim/time mutation and every other re-signed semantic mutation. Inject known raw-byte SHA vectors,
wrong `hashBytes` output and a callback that mutates its argument; require private-copy isolation and
compile-check that Task 10 accepts no `sign` capability or outer crypto import.

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
