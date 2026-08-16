# VS-4A Safety Source Discovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn municipal safety into a bounded, official-only `verified | unknown` subcheck that preserves its accepted/reviewed URLs, supports canonical zero-network replay and projects unknown as a selectable yellow city.

**Architecture:** Decision owns exact annual freshness and integer-rational comparison. Research owns the installed official authority/source plan and pure trust/ledger reconstruction. Application owns the sequential `previous -> configured -> search` use case behind narrow search and official-document ports. Infrastructure adapts provider URL discovery and official HTTPS without leaking provider types inward. The existing City Evidence overlay later persists the closed attempt ledger; City Knowledge stores only the compact fact and Evidence references.

**Tech Stack:** TypeScript 6.0.3, browser-safe `BigInt` integer comparison, existing `RequestStep`/Evidence integrity capabilities, SQLite City Evidence overlay from the Knowledge plan, Vitest and the real web-target smoke fixture.

| Field | Value |
| --- | --- |
| Status | `approved` |
| Owner | project user |
| Date | 2026-08-14 |
| Approval | project user / 2026-08-14 / exact plan commit `bb608b5` / approved |
| Approved design | [`2026-08-14-vs-4a-safety-source-discovery-design.md`](../specs/2026-08-14-vs-4a-safety-source-discovery-design.md) |
| Depends on | completed VS-4A Foundations Tasks 1–5; production package installation remains blocked until transit and broadband gates pass |
| Supersedes | safety-specific fixed-route/provider-free/candidate-fatal and green-with-amber steps in the 2026-08-13 VS-4A plans |
| Format metadata | `review-matrix` — three executable tasks whose length comes from mandatory trust types, source gates, adversarial RED/GREEN and commit cells; linked from the short master and not a narrative specification |
| Split review | Decision quantity/freshness remains in Foundations; persistence/UI consumers remain in Knowledge, Core and Delivery, so this document has one bounded discovery responsibility |

## Global Constraints

- Search discovers URL candidates only. Search rank, snippet, TLS and domain appearance never prove authority or a fact.
- Queries contain only official public city/municipality names, reference year and versioned safety terms. Profile, targets, selection, income and all other user data are forbidden.
- One check is sequential and bounded by `3 queries / 10 canonical candidates total / 2 official-chain hops`. No crawler, background worker, queue or runtime LLM is introduced.
- Previous and configured routes count toward the ten-candidate limit. Canonical URL deduplication happens before the queue consumes a candidate.
- Candidate 404, stale/broad/missing-total content, wrong media, oversize body, untrusted redirect and unapproved retention are recorded and search continues while budget remains.
- Abort/cancel, malformed provider protocol, Evidence/storage/integrity failure and unexpected errors abort the operation. They never become a domain unknown and never advance the City Frontier cursor.
- From January through June, exact `Y-2` is held as fallback while the full budget searches for `Y-1`; from July onward `Y-2` is stale. A previous `Y-2` never suppresses search.
- Persist canonical URLs and minimal aggregate/hash/locator metadata in the ledger. Raw municipal PDF/HTML bytes may exist only inside signed Evidence when the source-specific `seal_raw_artifact` policy permits it; they are always forbidden in repository fixtures, City Knowledge and browser read models. Search snippets are never persisted anywhere.
- The criterion may become `available_with_partial_official_coverage`; the whole Slovenia package stays `unavailable / NEEDS_CONTEXT` until all four criterion gates pass.
- A deployment with no named `CitySafetySearchPort` is explicitly `search_provider_unconfigured`; it may seal `source_unavailable` after configured routes but cannot pass the live source-ready walkthrough. This plan standardizes the inward URL-only protocol and does not silently select or embed a vendor SDK.
- This plan adds no table. Its ledger is embedded in the signed `city_evidence_snapshots` payload introduced by Knowledge Task 7.

Candidate rejection uses the closed `CitySafetyCandidateRejectionReason` union from the master ledger; terminal unknown remains the narrower `CityUnknownReason` selected only after budget closure.

---

### Task S1: Seal the official authority directory and per-city source plan

**Requirements:** approved supplement §§2, 3, 8

**Files:**
- Create: `src/research/city-safety-source-plan.ts`
- Create: `tests/research/city-safety-source-plan.test.ts`
- Create: `tests/sources/slovenia-city-safety.test.ts`
- Modify: `docs/changes/active/vs-4a-city-frontier/source-field-map.md`
- Modify: `tests/sources/fixtures/slovenia-city/README.md`
- Modify: `tests/sources/fixtures/slovenia-city/safety/manifest.json`
- Create only after official proof: `tests/sources/fixtures/slovenia-city/safety/municipal-positive.expected.json`
- Create: `tests/sources/fixtures/slovenia-city/safety/municipal-broad-scope.expected.json`
- Create: `tests/sources/fixtures/slovenia-city/safety/surs-municipality-population.request.json`
- Create: `tests/sources/fixtures/slovenia-city/safety/surs-municipality-population.expected.json`
- Create: `tests/sources/fixtures/slovenia-city/safety/discovery-validator-vectors.synthetic.json`
- Modify: `tests/sources/fixtures/slovenia-city/SHA256SUMS`

**Interfaces:**

```ts
export type OfficialRetentionMode =
  | "seal_raw_artifact"
  | "seal_hash_locator_then_delete_transient";

export interface OfficialPublisherPolicy {
  readonly publisherId: string;
  readonly authorityKind: "police" | "government" | "open_data" | "statistics" | "municipality";
  readonly navigationUrl: string;
  readonly allowedHosts: readonly string[];
  readonly delegatedDocumentHosts: readonly string[];
  readonly allowedMediaTypes: readonly string[];
  readonly maxBytes: number;
  readonly redirectPolicyVersion: "official-chain@1";
  readonly documentLocatorPolicyId: string;
  readonly retentionPolicyId: string;
  readonly retentionMode: OfficialRetentionMode;
}

export interface OfficialMunicipalityPolicy {
  readonly cityId: string;
  readonly settlementCode: string;
  readonly municipalityCode: string;
  readonly officialCityNames: readonly string[];
  readonly officialMunicipalityNames: readonly string[];
  readonly publisherId: string;
  readonly officialHost: string;
}

export interface OfficialAuthorityDirectory {
  readonly schemaVersion: "official-authority-directory@1";
  readonly id: string;
  readonly countryCode: "SI";
  readonly catalogRevisionId: string;
  readonly requiredPublisherIds: {
    readonly police: string;
    readonly gov: string;
    readonly opsi: string;
    readonly surs: string;
  };
  readonly publishers: readonly OfficialPublisherPolicy[];
  readonly municipalities: readonly OfficialMunicipalityPolicy[];
  readonly rulesVersion: "slovenia-official-authorities@1";
}

export interface CitySafetyConfiguredRoute {
  readonly publisherId: string;
  readonly navigationUrl: string;
  readonly resolvedEvidenceUrl?: string;
}

export interface CitySafetySourcePlanEntry {
  readonly cityId: string;
  readonly settlementCode: string;
  readonly municipalityCode: string;
  readonly officialCityNames: readonly string[];
  readonly officialMunicipalityNames: readonly string[];
  readonly publisherIds: readonly string[];
  readonly configuredRoutes: readonly CitySafetyConfiguredRoute[];
}

export interface CitySafetySourcePlan {
  readonly schemaVersion: "city-safety-source-plan@1";
  readonly id: string;
  readonly catalogRevisionId: string;
  readonly authorityDirectoryId: string;
  readonly entries: readonly CitySafetySourcePlanEntry[];
  readonly queryTemplateVersion: "slovenia-municipal-safety-query@1";
  readonly definitionId: "si-municipal-police-offences-per-100000@1";
  readonly freshnessPolicyVersion: "municipal-annual-july-boundary@1";
  readonly discoveryRulesVersion: "city-safety-discovery@1";
}

export function buildOfficialAuthorityDirectory(
  input: Omit<OfficialAuthorityDirectory, "id">,
  integrity: CityDecisionIntegrity,
): OfficialAuthorityDirectory;
export function reconstructOfficialAuthorityDirectory(
  value: unknown,
  catalog: CityCatalogRevision,
  integrity: CityDecisionIntegrity,
): OfficialAuthorityDirectory;
export function buildCitySafetySourcePlan(
  input: { readonly catalog: CityCatalogRevision; readonly directory: OfficialAuthorityDirectory; readonly entries: readonly CitySafetySourcePlanEntry[] },
  integrity: CityDecisionIntegrity,
): CitySafetySourcePlan;
export function reconstructCitySafetySourcePlan(
  value: unknown,
  catalog: CityCatalogRevision,
  directory: OfficialAuthorityDirectory,
  integrity: CityDecisionIntegrity,
): CitySafetySourcePlan;
export function buildCitySafetyQueries(
  entry: CitySafetySourcePlanEntry,
  directory: OfficialAuthorityDirectory,
  assessmentAt: string,
  catalog: CityCatalogRevision,
  integrity: CityDecisionIntegrity,
): readonly [string, string, string];
```

`slovenia-municipal-safety-query@1` always emits the first two queries for newest completed year `Y-1`: `site:<municipalityHost> "<municipalityName>" policija "kazniva dejanja" <Y-1>` and `site:policija.si "<municipalityName>" "kazniva dejanja" <Y-1>`. The third query is `"<cityName>" "<municipalityName>" policija poročilo <year>` where `<year>` is `Y-2` from January through June and `Y-1` from July through December. Thus preferred discovery remains first while the bounded plan can still discover an eligible fallback before July. The function first reconstructs the directory against the exact catalog and injected integrity capability; there is no structural-only query path. Names/host are the first canonical values in the sealed entry/directory; escaping quotes/backslashes is deterministic and tested. No user-derived token is accepted by this function.

The authority directory is the versioned source of truth for `settlementCode`, both official-name arrays, municipality code, publisher, and host. Every source-plan entry must be canonically equal to those directory fields; callers cannot introduce a second crosswalk. Stable IDs use the exact prefixes `official-authority-directory:` and `city-safety-source-plan:` followed by the injected hash of their canonical payload. URLs are credential-free HTTPS with a lowercase hostname, no wildcard, fragment, explicit/default port, or trailing-dot hostname; canonical paths preserve `/` only when it is the origin root.

- [ ] **Step 1: Write closed-plan RED tests**

Build a synthetic exact Catalog Revision and assert one source entry per member, canonical `cityId` order, exact settlement/municipality binding, one closed publisher policy for Police/GOV/OPSI/SURS and every referenced municipality publisher, explicit document-host delegation, nonempty versioned document-locator/retention policies, canonical publisher-bound routes, exact January/June and July/December three-query schedules, stable IDs and rejection of missing/extra/duplicate/foreign entries, dangling publisher IDs, wildcard hosts, HTTP URLs, unknown redirects, quote/backslash injection and extra fields. A municipality host alone never proves the required Police data authority inside a document.

- [ ] **Step 2: Run RED**

```bash
./node_modules/.bin/vitest run tests/research/city-safety-source-plan.test.ts
```

- [ ] **Step 3: Perform the source-readiness gate before claiming `available`**

Use only official Police, municipality and SURS surfaces. Follow the local `AGENTS.md`: read-only navigation may use an explicit chat-wide permission, but immediately before downloading a municipal PDF/HTML or sending a POST capture ask for separate confirmation and wait. Keep raw captures in a `mktemp -d` directory, never in the repository.

To pass, seal: one fresh exact-municipality positive projection for a current catalog member; the Velenje-style multi-municipality negative projection; the same-year SURS municipality population request/result; official host/redirect/media/retention metadata; and synthetic boundary vectors. If no catalog-member document passes, retain `candidate_available_with_partial_official_coverage`, commit the honest evidence, and stop before installed-package integration.

- [ ] **Step 4: Implement build/reconstruct and privacy checks**

Use injected canonical/hash integrity; do not import Infrastructure or `node:crypto`. The plan binds public identities and routes only, never user criteria or profile data. The fixture scan rejects raw PDF/HTML, names/addresses/case IDs/person rows and search-result text.

- [ ] **Step 5: Verify fixtures and commit**

```bash
(cd tests/sources/fixtures/slovenia-city && shasum -a 256 -c SHA256SUMS)
./node_modules/.bin/vitest run tests/research/city-safety-source-plan.test.ts \
  tests/sources/slovenia-city-safety.test.ts
! rg -n -i '"(address|person(_?id)?|victim|suspect|case(_?id)?|searchSnippet)"[[:space:]]*:' \
  tests/sources/fixtures/slovenia-city/safety
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/eslint src/research/city-safety-source-plan.ts \
  tests/research/city-safety-source-plan.test.ts \
  tests/sources/slovenia-city-safety.test.ts
git diff --check
git add src/research/city-safety-source-plan.ts \
  tests/research/city-safety-source-plan.test.ts \
  tests/sources/slovenia-city-safety.test.ts \
  docs/changes/active/vs-4a-city-frontier/source-field-map.md \
  tests/sources/fixtures/slovenia-city
git commit -m "feat: bind official city safety sources"
```

---

## Shared closed discovery values

Task S2 creates these exact values in `src/research/city-safety-evidence.ts`; Task S3 adds strict reconstruction and link projection without changing their shape.

```ts
export interface CitySafetyQueryAttempt {
  readonly index: number;
  readonly queryId: string;
  readonly queryTemplateVersion: "slovenia-municipal-safety-query@1";
  readonly providerId: string;
  readonly query: string;
  readonly searchedAt: string;
  readonly outcome:
    | { readonly kind: "completed"; readonly returnedUrls: readonly string[] }
    | { readonly kind: "unavailable"; readonly reason: CitySafetySearchUnavailableReason };
}

export type CitySafetySearchUnavailableReason =
  | "provider_unavailable"
  | "search_provider_unconfigured";

export type CitySafetyCandidateOrigin =
  | {
      readonly kind: "previous";
      readonly priorSourcePlanId: string;
      readonly priorEvidenceSnapshotId: string;
    }
  | { readonly kind: "configured"; readonly configuredRouteIndex: number }
  | { readonly kind: "search"; readonly queryId: string };

export interface CitySafetyPreviousAcceptedReference {
  readonly cityId: string;
  readonly municipalityCode: string;
  readonly sourcePlanId: string;
  readonly definitionId: "si-municipal-police-offences-per-100000@1";
  readonly publisherId: string;
  readonly navigationUrl: string;
  readonly resolvedEvidenceUrl: string;
  readonly referenceYear: number;
  readonly evidenceSnapshotId: string;
}

export type CitySafetyArtifactReference =
  | {
      readonly role: "municipal_source";
      readonly documentRole: "navigation" | "terminal_claim";
      readonly artifactId: string;
      readonly artifactSha256: string;
      readonly sourceSha256: string;
      readonly locator: string;
    }
  | {
      readonly role: "surs_denominator";
      readonly artifactId: string;
      readonly artifactSha256: string;
      readonly sourceSha256: string;
      readonly locator: string;
    };

export interface CitySafetyDenominatorReference {
  readonly publisherId: string;
  readonly municipalityCode: string;
  readonly referenceDate: string;
  readonly population: string;
  readonly artifactId: string;
  readonly mediaType: string;
  readonly retentionPolicyId: string;
  readonly transientRawDeleted: boolean;
}

export interface CitySafetyConflictBasis {
  readonly referenceYear: number;
  readonly quantities: readonly [CitySafetyQuantity, CitySafetyQuantity];
  readonly denominator: CitySafetyDenominatorReference;
}

export interface CitySafetyOfficialChainEdge {
  readonly kind: "http_redirect" | "confirmed_document_link";
  readonly fromUrl: string;
  readonly toUrl: string;
}

export interface CitySafetyOfficialFailureTrace {
  readonly captureKind:
    | "timeout"
    | "rate_limited"
    | "server_error"
    | "http_error"
    | "wrong_media_type"
    | "too_large"
    | "navigation_mismatch";
  readonly responseStatus?: number;
  readonly responseUrl?: string;
  readonly mediaType?: string;
  readonly rejectedTarget?: {
    readonly kind: "untrusted_target" | "redirect_loop" | "hop_limit";
    readonly url: string;
  };
}

export interface CitySafetyOfficialInspectionTrace {
  readonly initialUrl: string;
  readonly edges: readonly CitySafetyOfficialChainEdge[];
  readonly lastTrustedUrl?: string;
  readonly officialHops: number;
  readonly failure?: CitySafetyOfficialFailureTrace;
}

export interface CitySafetyUsableCandidateAttempt {
  readonly index: number;
  readonly origin: CitySafetyCandidateOrigin;
  readonly canonicalUrl: string;
  readonly publisherId: string;
  readonly dataAuthorityId: string;
  readonly publisherNavigationUrl: string;
  readonly resolvedEvidenceUrl: string;
  readonly officialTrace: CitySafetyOfficialInspectionTrace;
  readonly mediaType: string;
  readonly retentionPolicyId: string;
  readonly transientRawDeleted: boolean;
  readonly artifactRefs: readonly CitySafetyArtifactReference[];
  readonly disposition: "usable";
  readonly referenceYear: number;
  readonly periodDisposition: "preferred" | "fallback";
  readonly quantity: CitySafetyQuantity;
  readonly denominator: CitySafetyDenominatorReference;
}

export interface CitySafetyRejectedCandidateAttempt {
  readonly index: number;
  readonly origin: CitySafetyCandidateOrigin;
  readonly canonicalUrl: string;
  readonly officialTrace: CitySafetyOfficialInspectionTrace;
  readonly reviewedOfficial?: {
    readonly publisherId: string;
    readonly dataAuthorityId: string;
    readonly publisherNavigationUrl: string;
    readonly resolvedEvidenceUrl?: string;
    readonly referenceYear?: number;
  };
  readonly mediaType?: string;
  readonly retentionPolicyId?: string;
  readonly transientRawDeleted?: boolean;
  readonly artifactRefs: readonly CitySafetyArtifactReference[];
  readonly disposition: "rejected";
  readonly reason: CitySafetyCandidateRejectionReason;
  readonly conflictBasis?: CitySafetyConflictBasis;
}

export type CitySafetyCandidateAttempt =
  | CitySafetyUsableCandidateAttempt
  | CitySafetyRejectedCandidateAttempt;

export interface CitySafetyAttemptLedger {
  readonly schemaVersion: "city-safety-attempt-ledger@1";
  readonly catalogRevisionId: string;
  readonly authorityDirectoryId: string;
  readonly sourcePlanId: string;
  readonly cityId: string;
  readonly municipalityCode: string;
  readonly assessmentAt: string;
  readonly definitionId: "si-municipal-police-offences-per-100000@1";
  readonly freshnessPolicyVersion: "municipal-annual-july-boundary@1";
  readonly discoveryRulesVersion: "city-safety-discovery@1";
  readonly queries: readonly CitySafetyQueryAttempt[];
  readonly candidates: readonly CitySafetyCandidateAttempt[];
  readonly counters: { readonly queries: number; readonly candidates: number; readonly maxOfficialHops: number };
  readonly result:
    | { readonly kind: "verified"; readonly quantity: CitySafetyQuantity; readonly referenceYear: number; readonly acceptedCandidateIndex: number }
    | { readonly kind: "unknown"; readonly reason: CityUnknownReason };
  readonly completedAt: string;
}
```

### Task S2: Implement bounded discovery behind inward ports

**Requirements:** approved supplement §§1, 2, 4, 6

**Files:**
- Create: `src/application/city-safety-contracts.ts`
- Create: `src/application/run-city-safety-discovery.ts`
- Create: `src/research/city-safety-discovery.ts`
- Create: `src/research/city-safety-evidence.ts` (closed value types; reconstruction is completed in Task S3)
- Create: `src/infrastructure/sources/city-safety-search-adapter.ts`
- Create: `src/infrastructure/sources/http-city-safety-search-step.ts`
- Create: `src/infrastructure/sources/slovenia-city-safety-adapter.ts`
- Create: `tests/research/city-safety-discovery.test.ts`
- Create: `tests/integration/city-safety-discovery.test.ts`
- Create: `tests/integration/city-safety-search-step.test.ts`
- Modify narrowly: `src/infrastructure/sources/gateway.ts`
- Modify narrowly: `tests/sources/gateway.test.ts`
- Modify: `.env.example`

**Inward ports and outer producer contract:**

```ts
export type CitySafetySearchStepResult =
  | { readonly kind: "completed"; readonly payload: unknown }
  | { readonly kind: "unavailable"; readonly reason: "provider_unavailable" };

export type CitySafetySearchStep = (
  input: { readonly query: string; readonly resultLimit: number },
  signal: AbortSignal,
) => Promise<CitySafetySearchStepResult>;

export interface HttpCitySafetySearchConfig {
  readonly endpoint: string;
  readonly providerId: string;
  readonly bearerToken?: string;
  readonly timeoutMs: number;
  readonly maxResponseBytes: 65536;
}

export type CitySafetySearchHttpRequest = (
  input: {
    readonly url: string;
    readonly method: "POST";
    readonly redirectMode: "error";
    readonly headers: Readonly<Record<string, string>>;
    readonly bodyBytes: Uint8Array;
  },
  signal: AbortSignal,
) => Promise<{
  readonly status: number;
  readonly mediaType: string;
  readonly bodyBytes: Uint8Array;
}>;

export function createHttpCitySafetySearchStep(
  config: HttpCitySafetySearchConfig,
  request: CitySafetySearchHttpRequest,
): CitySafetySearchStep;

export type CitySafetySearchResponse =
  | {
      readonly kind: "completed";
      readonly providerId: string;
      readonly urls: readonly string[];
    }
  | {
      readonly kind: "unavailable";
      readonly providerId: string;
      readonly reason: CitySafetySearchUnavailableReason;
    };

export interface CitySafetySearchPort {
  search(input: {
    readonly queryId: string;
    readonly query: string;
    readonly resultLimit: number;
    readonly signal: AbortSignal;
  }): Promise<CitySafetySearchResponse>;
}

export function createCitySafetySearchPort(input: {
  readonly step: CitySafetySearchStep;
  readonly providerId: string;
}): CitySafetySearchPort;

export function createUnconfiguredCitySafetySearchPort(): CitySafetySearchPort;

export interface CitySafetyOfficialDocumentPort {
  inspect(input: CitySafetyCandidateInspectionInput): Promise<CitySafetyCandidateInspection>;
}

export function canonicalizeCitySafetyCandidateUrl(value: string): string;

export interface RunCitySafetyDiscoveryInput {
  readonly runId: string;
  readonly catalog: CityCatalogRevision;
  readonly integrity: CityDecisionIntegrity;
  readonly sourcePlan: CitySafetySourcePlan;
  readonly authorityDirectory: OfficialAuthorityDirectory;
  readonly cityId: string;
  readonly assessmentAt: string;
  readonly previousAccepted?: CitySafetyPreviousAcceptedReference;
  readonly signal: AbortSignal;
}

export interface CitySafetyCandidateInspectionInput {
  readonly runId: string;
  readonly cityId: string;
  readonly municipalityCode: string;
  readonly candidateUrl: string;
  readonly publisherContext?: {
    readonly publisherId: string;
    readonly publisherNavigationUrl: string;
  };
  readonly officialHopLimit: 2;
  readonly assessmentAt: string;
  readonly authorityDirectory: OfficialAuthorityDirectory;
  readonly signal: AbortSignal;
}

export type CitySafetyUsableCandidateDetail = Omit<
  CitySafetyUsableCandidateAttempt,
  "index" | "origin" | "canonicalUrl"
>;

export type CitySafetyRejectedCandidateDetail = Omit<
  CitySafetyRejectedCandidateAttempt,
  "index" | "origin" | "canonicalUrl"
>;

export type CitySafetyCandidateInspection =
  | {
      readonly kind: "usable";
      readonly detail: CitySafetyUsableCandidateDetail;
      readonly artifacts: readonly LiveCapturedArtifact<"si-city-safety">[];
    }
  | {
      readonly kind: "rejected";
      readonly detail: CitySafetyRejectedCandidateDetail;
      readonly artifacts: readonly LiveCapturedArtifact<"si-city-safety">[];
    };

export interface CitySafetyDiscoveryResult {
  readonly ledger: CitySafetyAttemptLedger;
  readonly artifacts: readonly LiveCapturedArtifact<"si-city-safety">[];
}

export function runCitySafetyDiscovery(
  input: RunCitySafetyDiscoveryInput,
  ports: {
    readonly search: CitySafetySearchPort;
    readonly officialDocuments: CitySafetyOfficialDocumentPort;
    readonly clock: () => Date;
  },
): Promise<CitySafetyDiscoveryResult>;
```

`canonicalizeCitySafetyCandidateUrl` accepts an absolute credential-free HTTPS URL, uses the platform URL parser to lower-case/IDNA-normalize the host and remove default port/dot segments, drops only the fragment, and preserves path plus query parameter order/values. It does not remove tracking-looking parameters or guess URL equivalence. The use case reconstructs source plan/directory with the exact input Catalog and browser-safe Decision integrity, then calls the hardened S1 `buildCitySafetyQueries`; it never duplicates query construction or trusts caller-owned official names. `CitySafetySearchPort` returns URLs only; snippets/titles are outside the inward contract. Its typed `unavailable` response is the only provider transport/availability path that may contribute to terminal `source_unavailable`; malformed provider protocol throws and aborts the operation. The Application clock supplies `searchedAt`, so provider data never chooses Evidence time. `city-safety-search-adapter.ts` owns both exact factories above: the configured factory adapts one injected deployment `CitySafetySearchStep`, binds a composition-owned provider ID and validates result count plus the closed response shape; the unconfigured factory performs no HTTP and returns `{kind:"unavailable",providerId:"search-provider-unconfigured",reason:"search_provider_unconfigured"}`. Neither selects a vendor in domain code or exposes SDK types.

Application, not the document adapter, owns candidate `index`, `origin` and canonical queue URL; it combines them with the returned detail and rejects any context/artifact mismatch. Queue inputs are exact: previous uses `previousAccepted.resolvedEvidenceUrl` and its verified `publisherId`/`navigationUrl`; each configured route uses `resolvedEvidenceUrl ?? navigationUrl` with that route's exact publisher/navigation context; search preserves provider order and has no publisher context. Repeated provider URLs remain in the query ledger and are deduplicated only before candidate inspection. A previous reference may cite an older valid source-plan revision; its prior IDs and publisher context are preserved while the URL is revalidated against the current directory.

The Slovenia document adapter uses an additive traced request-step gateway, the sealed authority directory and source-specific retention mode. It composes gateway redirects and analyzer-confirmed document links into `CitySafetyOfficialInspectionTrace`: contiguous canonical `http_redirect | confirmed_document_link` edges share one `officialHops <= 2` budget. A pure source analyzer may propose a document link only from fully captured bytes under the exact publisher `documentLocatorPolicyId`; the adapter validates the target and gives the next gateway call only the remaining hop budget. Capture failures preserve kind/status/response/media and a separate rejected target inside `officialTrace.failure`; the rejected hop is not appended as an edge (a loop target may equal an earlier edge URL) and is never projected as a reviewed link. Existing `captureHttpOnce` behavior remains unchanged.

The adapter returns sealable `LiveCapturedArtifact<"si-city-safety">` values with the detail and never writes Evidence. Municipal references distinguish `documentRole: navigation | terminal_claim`. Municipal `seal_raw_artifact` returns permitted official bytes. A transient terminal document returns canonical UTF-8 JSON `city-safety-retained-inspection@1` with city/municipality, publisher/Police authority, navigation/resolved URLs, the official trace, original source hash/locator/media, retention policy, deletion truth and a closed outcome. Outcome is either usable, or one of `stale | scope_mismatch | definition_mismatch | missing_numerator | denominator_missing | denominator_zero | denominator_period_mismatch | denominator_scope_mismatch | conflict`, with the exact quantity/observed-scope/definition/denominator/conflict basis required by that discriminant. A transient intermediate page returns `city-safety-retained-navigation@1`, binding the same source/provenance/retention fields and the exact confirmed document URL selected under `documentLocatorPolicyId`. Search responses never become artifacts.

Every usable result and semantic rejection derived from complete official bytes requires exactly one `municipal_source/terminal_claim` artifact under the publisher retention policy, in addition to zero or more `municipal_source/navigation` artifacts. `artifactRefs` order is navigation artifacts in official-chain order, then the terminal claim, then the optional single SURS denominator. Usable, stale and internal conflict require that denominator; denominator zero/period/scope mismatch requires its observed SURS artifact; denominator missing forbids a fabricated denominator artifact. Capture failures before complete terminal bytes have no terminal-claim artifact, although every earlier fully captured navigation page is retained. `retention_unapproved` never fabricates an artifact.

SURS retention is independently closed. With raw retention, the role-qualified denominator artifact contains permitted official bytes and `artifactSha256 === sourceSha256`. With transient deletion, it contains canonical UTF-8 JSON of this exact closed projection; no raw SURS bytes survive:

```ts
export interface CitySafetyRetainedDenominatorProjection {
  readonly schemaVersion: "city-safety-retained-denominator@1";
  readonly publisherId: string;
  readonly municipalityCode: string;
  readonly referenceDate: string;
  readonly population: string;
  readonly sourceSha256: string;
  readonly sourceLocator: string;
  readonly sourceMediaType: string;
  readonly retentionPolicyId: string;
  readonly transientRawDeleted: true;
}
```

`CitySafetyDenominatorReference` mirrors its applied media/retention/deletion disposition and must resolve to that one `surs_denominator` artifact.

Every usable attempt contains one exact SURS denominator reference: SURS publisher ID, municipality code, `${referenceYear}-01-01`, population, applied retention metadata and a role-qualified returned artifact reference. One denominator capture is reused inside a run. Application compares multiple usable same-year fallback claims: equal quantities are compatible; unequal quantities remain individually usable for exact replay but invalidate fallback selection and derive terminal conflict unless a preferred result is later found. A conflict inside one official publication chain remains adapter-owned and a rejected conflict attempt must carry canonical `conflictBasis` with both exact quantities and their shared denominator; that field is forbidden for every other rejection. Such a rejection also requires `reviewedOfficial.dataAuthorityId === directory.requiredPublisherIds.police`; missing or altered Police authority aborts rather than producing conflict.

The production producer is a vendor-neutral configured HTTPS endpoint, not an SDK. The configured endpoint must be one exact absolute credential-free HTTPS URL with no fragment. `http-city-safety-search-step.ts` sends strict JSON `{query,resultLimit}` with `redirectMode: "error"` and accepts at most 65,536 bytes of `application/json` with exact `{urls:string[]}`; it never follows a provider redirect. The adapter, not the endpoint, supplies the configured `providerId`. `.env.example` documents `CITY_SAFETY_SEARCH_ENDPOINT`, `CITY_SAFETY_SEARCH_PROVIDER_ID`, optional `CITY_SAFETY_SEARCH_BEARER_TOKEN` and a timeout validated as an integer from 1,000 through 15,000 ms. The token is request-only and is never logged, persisted or exposed to the browser. Missing configuration constructs the explicit unavailable step and keeps source readiness blocked; configured 2xx malformed payload aborts as protocol failure, while network, timeout, every 3xx and every other non-2xx response map to typed provider unavailability without following or exposing a redirect. Core Task 14 wires this factory in the composition root. Delivery Task 19 may run live search only with a user-approved deployment endpoint and provider ID.

Only `CitySafetySearchPort`, `CitySafetyOfficialDocumentPort` and their plain DTOs live in Application. `CitySafetySearchStep`, HTTP request/config types and the configured/unconfigured factories are outer Infrastructure contracts; Application never imports endpoint, token, HTTP status or environment concepts. Core Task 14 calls `createCitySafetySearchPort({step:createHttpCitySafetySearchStep(config, request), providerId:config.providerId})` when configuration is valid and `createUnconfiguredCitySafetySearchPort()` otherwise.

- [ ] **Step 1: Write pure reducer RED**

Assert sealed Catalog/integrity query reconstruction, queue order `previous -> configured -> discovered`, canonical URL dedup across host case/default port/fragment while preserving query order, rejection of credentials/HTTP, Y-1 priority, held Y-2 fallback, first exact Y-1 stop, exact `3/10/2` counters, sequential inspection, sealable artifact aggregation, and precedence `conflict > source_unavailable > stale > not_comparable > not_found`.

- [ ] **Step 2: Add adversarial RED**

Cover accepted previous Y-1 suppressing search; previous Y-2 continuing search; a valid previous URL from an older source-plan revision; missing/altered prior Evidence provenance and tampered/cross-city/cross-definition/forged-publisher previous lineage rejection; forged Catalog/directory/plan query context; exact previous/configured candidate URL and publisher/navigation context; same-response/cross-query/cross-origin URL dedup while preserving query ledger repeats; configured route-index and search query-ID provenance; January–June discovered Y-2 held until exhaustion then selected, and the same discovered Y-2 stale from July; equal versus conflicting same-year fallback claims; first route failure then external exact source; stale/broad/missing-total/wrong-media/oversize/untrusted redirect/unapproved retention continuing; combined redirect/document-link hop budget, redirected failure trace and rejected-target ledger metadata; completed-empty search versus typed provider unavailable versus explicit unconfigured producer; malformed provider protocol; snippet-only value; fake government host; conflict inside one official chain with missing/altered Police authority; explicit zero numerator; missing/zero/wrong-year/wrong-municipality denominator; exactly one usable/semantic-rejection terminal-claim artifact plus ordered navigation artifacts, class-specific artifact cardinality and retained navigation/inspection replay; one reused role-qualified SURS denominator artifact/reference; municipal and SURS raw/transient retention modes; abort/protocol/storage error throwing rather than returning unknown; and query privacy with a canary profile. For the configured HTTP producer assert strict POST bytes/media, response size/type/shape, exact credential-free HTTPS endpoint, explicit no-redirect request mode, every 3xx/non-2xx unavailable mapping, abort/timeout, absent configuration, provider ID ownership, and that bearer tokens never appear in errors, ledger, logs or browser-target imports.

- [ ] **Step 3: Run RED**

```bash
./node_modules/.bin/vitest run tests/research/city-safety-discovery.test.ts \
  tests/integration/city-safety-discovery.test.ts \
  tests/integration/city-safety-search-step.test.ts
```

- [ ] **Step 4: Implement one sequential use case and adapters**

Create the exact values in `Shared closed discovery values`, reconstruct the source plan/directory from input Catalog/integrity, then call `buildCitySafetyQueries` for at most three queries. `queryId` is the deterministic `city-safety-query:<runId>:<1-based-index>` after closed run-ID validation; `searchedAt` and `completedAt` come from the injected Application clock. Validate every redirect or confirmed-document-link edge against the authority directory/publisher policy before following it, cap their combined official-chain depth at two, and count every canonical candidate before inspection. Candidate failures return typed rejections with replay-relevant official trace and class-correct artifacts; typed provider/official transport incompleteness is remembered and only becomes `source_unavailable` after a successfully closed ledger. Canonical-compare every adapter detail and artifact against its inspection input before Application adds the envelope. Aggregate the adapter-returned artifacts in `CitySafetyDiscoveryResult`; never hold SQLite or write Evidence inside this use case. Task S3 adds strict reconstruction, while the Knowledge plan seals these exact artifacts and ledger without a second discovery result shape.

Budget is closed only when a preferred candidate is selected, the ten-candidate limit is reached, or all three query outcomes are recorded and every canonical URL they returned has been inspected or deduplicated. A completed-empty query and an unavailable query both consume one query slot but preserve their distinct outcomes. A held fallback may be selected only at non-preferred budget closure.

- [ ] **Step 5: Run GREEN, port-boundary checks and commit**

```bash
./node_modules/.bin/vitest run tests/research/city-safety-discovery.test.ts \
  tests/integration/city-safety-discovery.test.ts \
  tests/integration/city-safety-search-step.test.ts tests/sources/gateway.test.ts
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/eslint src/application/{city-safety-contracts,run-city-safety-discovery}.ts \
  src/research/city-safety-discovery.ts \
  src/research/city-safety-evidence.ts \
  src/infrastructure/sources/{city-safety-search-adapter,http-city-safety-search-step,slovenia-city-safety-adapter,gateway}.ts \
  tests/research/city-safety-discovery.test.ts \
  tests/integration/city-safety-discovery.test.ts \
  tests/integration/city-safety-search-step.test.ts
git diff --check
git add src/application/city-safety-contracts.ts \
  src/application/run-city-safety-discovery.ts src/research/city-safety-discovery.ts \
  src/research/city-safety-evidence.ts \
  src/infrastructure/sources/city-safety-search-adapter.ts \
  src/infrastructure/sources/http-city-safety-search-step.ts \
  src/infrastructure/sources/slovenia-city-safety-adapter.ts \
  src/infrastructure/sources/gateway.ts tests/sources/gateway.test.ts \
  tests/research/city-safety-discovery.test.ts \
  tests/integration/city-safety-discovery.test.ts \
  tests/integration/city-safety-search-step.test.ts .env.example
git commit -m "feat: discover official safety sources"
```

---

### Task S3: Close the immutable attempt ledger and replay projection

**Requirements:** approved supplement §§3, 5, 6, 7

**Files:**
- Modify: `src/research/city-safety-evidence.ts`
- Create: `tests/research/city-safety-evidence.test.ts`

**Reconstruction API for the shared Task S2 values:**

```ts
export function reconstructCitySafetyAttemptLedger(
  value: unknown,
  context: {
    readonly catalog: CityCatalogRevision;
    readonly integrity: CityDecisionIntegrity;
    readonly sourcePlan: CitySafetySourcePlan;
    readonly authorityDirectory: OfficialAuthorityDirectory;
    readonly previousAccepted?: CitySafetyPreviousAcceptedReference;
  },
): CitySafetyAttemptLedger;
export function projectCitySafetyEvidenceLinks(
  ledger: CitySafetyAttemptLedger,
): readonly CitySafetyEvidenceLink[];
```

Candidate attempts bind a closed origin: previous binds exact prior source-plan/Evidence IDs and verified publisher context (which may differ from the current plan), configured binds its exact route index, and search binds its exact query ID. They also bind canonical/publisher/navigation/resolved URLs, the combined typed official chain and capture failure, Police data authority, media/retention decisions, role-qualified municipal and SURS artifact hashes/locators, exact denominator municipality/date/population/retention disposition, reference year, preferred/fallback disposition and exact rejection. Query attempts are regenerated through reconstructed Catalog/directory/plan plus `buildCitySafetyQueries`, then bind query/template/provider IDs, Evidence-clock `searchedAt` and either ordered returned URLs (including repeats) or typed provider/unconfigured availability. Search text is retained only as the deterministic public query; snippets are forbidden.

- [ ] **Step 1: Write strict ledger RED**

Reject extra/missing fields, out-of-order indices, duplicate canonical candidate attempts, over-budget counters, altered Catalog/integrity/query reconstruction, combined-hop under/over-reporting, broken/noncontiguous/retyped official edges, missing/extra capture failure or rejected target metadata, completed-empty rewritten as unavailable (and vice versa), a search-origin candidate with a missing/late/wrong query ID or URL absent from that exact query result, a configured candidate with a missing/wrong route index, publisher context or URL absent from that exact bound route, a previous candidate with missing/altered prior source-plan/Evidence/publisher IDs or no canonically equal verified `previousAccepted` context, cross-catalog/directory/current-source-plan/city/municipality/definition binding, dangling publisher/data-authority IDs, fallback selected before budget exhaustion, unknown with an eligible selected result, preferred result skipped for fallback, incompatible same-year usable fallbacks not producing conflict, compatible fallbacks producing false conflict, missing/extra/reordered/altered conflict basis or Police authority, missing/duplicate/reordered/document-role-swapped/class-incompatible artifact references or retained navigation/inspection outcomes, altered SURS publisher/municipality/date/population/hash/locator/media/retention/deletion disposition, altered assessment time/URL/authority/media/retention/result/reason and any profile/user-data field.

- [ ] **Step 2: Run RED**

```bash
./node_modules/.bin/vitest run tests/research/city-safety-evidence.test.ts
```

- [ ] **Step 3: Implement reconstruction and link projection**

Reconstruct the exact Catalog, authority directory and source plan with the supplied integrity, regenerate query texts through `buildCitySafetyQueries`, then re-run the pure discovery invariants; do not trust mirrored counters, origins, freshness disposition, query text or publisher IDs. A previous origin requires a canonically equal verified `previousAccepted` context and exact prior source-plan/Evidence/publisher context, without requiring equality to the current source-plan ID; configured and search origins resolve through their exact route index/query ID. Every official trace must form one contiguous policy-valid chain whose redirect plus confirmed-document-link edges equal `officialHops <= 2`; capture failure metadata and rejected target are allowed only for their exact rejection class. Every usable attempt must bind `dataAuthorityId === directory.requiredPublisherIds.police`, exact current municipality scope, and one exact SURS denominator reference/artifact matching quantity/reference year and SURS retention policy. A rejected conflict attempt must contain two unequal canonical quantities for one municipality/year, the exact shared denominator, a reviewed official publisher and `dataAuthorityId === directory.requiredPublisherIds.police`; conflict basis is absent otherwise. Validate artifact-reference closed shape, role, canonical hash syntax, uniqueness and class-specific cardinality: semantic rejections from complete bytes require the exact raw/retained-inspection municipal artifact, and denominator-bearing outcomes require the matching SURS raw/retained-denominator artifact. Do not claim byte/locator verification without an Evidence manifest. Recompute compatible/incompatible same-year fallback handling directly from usable quantities: unequal same-year fallbacks plus no preferred result require terminal conflict. The selected `acceptedCandidateIndex` must reference a usable candidate whose quantity/year exactly equal the result. A January–June fallback may remain usable while search continues; it becomes selected only after query/candidate exhaustion and only when no preferred candidate exists. Project the selected official document first, then only trusted reviewed official candidates; capture-failure rejected targets are never links. When terminal conflict derives from incompatible usable fallbacks, project their official links as reviewed conflict links without mutating the ledger attempts. Never expose untrusted search-only URLs as official links. Deep-freeze all returned values.

- [ ] **Step 4: Verify downstream contract ownership before implementation continues**

Confirm the linked plans already require Knowledge Task 7 to embed this exact ledger in `CityEvidenceSnapshot` and perform the re-signed artifact/source-hash/locator-to-manifest tamper checks that pure S3 cannot perform, Task 8 to keep only quantity/unknown plus Evidence refs, and Task 10 to replay bytes/minimal projections, ledger and locators with throwing search/official spies. Confirm Core markers carry `green | yellow | red`, exact fact/link projections and server-derived warnings, while Delivery renders accepted/reviewed links from committed markers and performs no search on reload. A mismatch is a plan defect and blocks implementation; do not patch around it in code.

- [ ] **Step 5: Run GREEN and commit**

```bash
./node_modules/.bin/vitest run tests/research/city-safety-evidence.test.ts \
  tests/research/city-safety-discovery.test.ts \
  tests/integration/city-safety-discovery.test.ts
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/eslint src/research/city-safety-evidence.ts \
  tests/research/city-safety-evidence.test.ts
git diff --check
git add src/research/city-safety-evidence.ts \
  tests/research/city-safety-evidence.test.ts
git commit -m "feat: bind safety discovery evidence"
```

## Downstream acceptance contract

The linked Knowledge, Core and Delivery plans must consume these types without copying the discovery algorithm:

- City Evidence stores the full ledger in its existing signed overlay payload; no ninth table.
- City Knowledge stores exact quantity or unknown and Evidence references only. Known-to-unknown changes `knowledgeUpdatedAt`; URL-only revalidation does not.
- Continue seals Evidence, publishes all four facts, then appends one marker. A yellow marker occupies a selectable slot and does not activate a replacement.
- Presentation/reload/selection use verified snapshots only and call zero search/official ports.
- Verified cards show accepted source/year/numerator/denominator/`lastCheckedAt`; yellow cards show terminal reason, reviewed official links and exact rejection explanations.
- Final evidence records query/candidate/hop counts, accepted/reviewed URLs, transient cleanup and zero-network replay.

## Plan verification gate

Before approving this plan package, run:

```bash
rg -n '3 queries|10 canonical|2 official|municipal-annual-july-boundary@1|yellow|CitySafetyAttemptLedger' \
  docs/superpowers/plans/2026-08-1{3,4}-vs-4a-*.md
! rg -n 'there is no city yello[w]|green[+]amber|Runtime provider/LLM/API calls.*zer[o]|Use only field-map URL[s]' \
  docs/superpowers/plans/2026-08-1{3,4}-vs-4a-*.md
git diff --check -- docs/superpowers/plans
```

No task in this plan authorizes package installation, browser/download side effects, push, PR or merge by itself.
