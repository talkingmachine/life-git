import type { CityUnknownReason } from "../decision/city-criteria";
import type { CityCatalogRevision } from "../decision/city-catalog";
import type { CityDecisionIntegrity } from "../decision/city-integrity";
import { classifyCitySafetyPeriod, type CitySafetyQuantity } from "../decision/city-safety";
import {
  canonicalizeCitySafetyCandidateUrl,
  chooseCitySafetyUnknownReason,
} from "./city-safety-discovery";
import {
  buildCitySafetyQueries,
  reconstructCitySafetySourcePlan,
  reconstructOfficialAuthorityDirectory,
} from "./city-safety-source-plan";
import type {
  CitySafetySourcePlan,
  OfficialAuthorityDirectory,
  OfficialPublisherPolicy,
} from "./city-safety-source-plan";

export interface CitySafetyLedgerReconstructionContext {
  readonly runId: string;
  readonly catalog: CityCatalogRevision;
  readonly integrity: CityDecisionIntegrity;
  readonly sourcePlan: CitySafetySourcePlan;
  readonly authorityDirectory: OfficialAuthorityDirectory;
  readonly previousAccepted?: CitySafetyPreviousAcceptedReference;
}

export type CitySafetyEvidenceLink =
  | {
      readonly disposition: "accepted";
      readonly navigationUrl: string;
      readonly resolvedEvidenceUrl: string;
      readonly referenceYear: number;
    }
  | {
      readonly disposition: "reviewed_rejected";
      readonly navigationUrl: string;
      readonly resolvedEvidenceUrl?: string;
      readonly referenceYear?: number;
      readonly rejectionReason: CitySafetyCandidateRejectionReason;
    };

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

export type CitySafetyCandidateRejectionReason =
  | "http_not_found"
  | "transport_unavailable"
  | "authority_untrusted"
  | "stale"
  | "scope_mismatch"
  | "definition_mismatch"
  | "missing_numerator"
  | "denominator_missing"
  | "denominator_zero"
  | "denominator_period_mismatch"
  | "denominator_scope_mismatch"
  | "wrong_media_type"
  | "too_large"
  | "untrusted_redirect"
  | "retention_unapproved"
  | "conflict";

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
  readonly counters: {
    readonly queries: number;
    readonly candidates: number;
    readonly maxOfficialHops: number;
  };
  readonly result:
    | {
        readonly kind: "verified";
        readonly quantity: CitySafetyQuantity;
        readonly referenceYear: number;
        readonly acceptedCandidateIndex: number;
      }
    | { readonly kind: "unknown"; readonly reason: CityUnknownReason };
  readonly completedAt: string;
}

export type CitySafetyRetainedRejectionBasis =
  | {
      readonly kind: "stale";
      readonly referenceYear: number;
      readonly quantity: CitySafetyQuantity;
      readonly denominator: CitySafetyDenominatorReference;
    }
  | {
      readonly kind: "scope_mismatch";
      readonly observedMunicipalityCodes: readonly string[];
      readonly referenceYear?: number;
      readonly offenceCount?: CitySafetyQuantity["offenceCount"];
    }
  | {
      readonly kind: "definition_mismatch";
      readonly observedDefinitionId: string;
      readonly referenceYear?: number;
      readonly offenceCount?: CitySafetyQuantity["offenceCount"];
    }
  | { readonly kind: "missing_numerator"; readonly referenceYear?: number }
  | {
      readonly kind: "denominator_missing";
      readonly referenceYear: number;
      readonly offenceCount: CitySafetyQuantity["offenceCount"];
    }
  | {
      readonly kind:
        | "denominator_zero"
        | "denominator_period_mismatch"
        | "denominator_scope_mismatch";
      readonly referenceYear: number;
      readonly offenceCount: CitySafetyQuantity["offenceCount"];
      readonly observedDenominator: CitySafetyDenominatorReference;
    }
  | { readonly kind: "conflict"; readonly conflictBasis: CitySafetyConflictBasis };

export type CitySafetyRetainedInspectionOutcome =
  | {
      readonly kind: "usable";
      readonly referenceYear: number;
      readonly quantity: CitySafetyQuantity;
      readonly denominator: CitySafetyDenominatorReference;
    }
  | { readonly kind: "rejected"; readonly basis: CitySafetyRetainedRejectionBasis };

export interface CitySafetyRetainedInspectionProjection {
  readonly schemaVersion: "city-safety-retained-inspection@1";
  readonly cityId: string;
  readonly municipalityCode: string;
  readonly publisherId: string;
  readonly dataAuthorityId: string;
  readonly publisherNavigationUrl: string;
  readonly resolvedEvidenceUrl: string;
  readonly officialTrace: CitySafetyOfficialInspectionTrace;
  readonly outcome: CitySafetyRetainedInspectionOutcome;
  readonly sourceSha256: string;
  readonly sourceLocator: string;
  readonly sourceMediaType: string;
  readonly retentionPolicyId: string;
  readonly transientRawDeleted: true;
}

export interface CitySafetyRetainedNavigationProjection {
  readonly schemaVersion: "city-safety-retained-navigation@1";
  readonly cityId: string;
  readonly municipalityCode: string;
  readonly publisherId: string;
  readonly publisherNavigationUrl: string;
  readonly resolvedNavigationUrl: string;
  readonly officialTrace: CitySafetyOfficialInspectionTrace;
  readonly confirmedDocumentUrl: string;
  readonly documentLocatorPolicyId: string;
  readonly sourceSha256: string;
  readonly sourceLocator: string;
  readonly sourceMediaType: string;
  readonly retentionPolicyId: string;
  readonly transientRawDeleted: true;
}

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

const TOP_LEVEL_KEYS = [
  "schemaVersion", "catalogRevisionId", "authorityDirectoryId", "sourcePlanId", "cityId",
  "municipalityCode", "assessmentAt", "definitionId", "freshnessPolicyVersion",
  "discoveryRulesVersion", "queries", "candidates", "counters", "result", "completedAt",
] as const;
const RUN_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/;

interface ReplayQueuedCandidate {
  readonly url: string;
  readonly origin: CitySafetyCandidateOrigin;
  readonly publisherContext?: {
    readonly publisherId: string;
    readonly publisherNavigationUrl: string;
  };
}

function mismatch(): never {
  throw new Error("integrity_mismatch");
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function denseArray(value: unknown): value is unknown[] {
  if (!Array.isArray(value)) return false;
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(value, index)) return false;
  }
  return true;
}

function exactKeys(value: object, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index]);
}

function canonicalInstant(value: unknown): value is string {
  try {
    return typeof value === "string" && new Date(value).toISOString() === value;
  } catch {
    return false;
  }
}

function identifier(value: unknown): value is string {
  return typeof value === "string" && RUN_ID_PATTERN.test(value);
}

function immutableCopy<T>(value: T): T {
  return deepFreeze(structuredClone(value));
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function decodeQuery(
  value: unknown,
  index: number,
  runId: string,
  expectedQuery: string,
): CitySafetyQueryAttempt {
  if (!record(value) || !exactKeys(value, [
    "index", "queryId", "queryTemplateVersion", "providerId", "query", "searchedAt", "outcome",
  ]) || value.index !== index || value.queryId !== `city-safety-query:${runId}:${index + 1}` ||
    value.queryTemplateVersion !== "slovenia-municipal-safety-query@1" ||
    typeof value.providerId !== "string" || value.providerId.length === 0 ||
    value.query !== expectedQuery || !canonicalInstant(value.searchedAt) ||
    !record(value.outcome)) mismatch();
  let outcome: CitySafetyQueryAttempt["outcome"];
  if (value.outcome.kind === "completed" && exactKeys(value.outcome, ["kind", "returnedUrls"]) &&
    denseArray(value.outcome.returnedUrls) && value.outcome.returnedUrls.every((url) => typeof url === "string")) {
    value.outcome.returnedUrls.forEach((url) => canonicalizeCitySafetyCandidateUrl(url as string));
    outcome = { kind: "completed", returnedUrls: [...value.outcome.returnedUrls] as string[] };
  } else if (value.outcome.kind === "unavailable" && exactKeys(value.outcome, ["kind", "reason"]) &&
    (value.outcome.reason === "provider_unavailable" ||
      value.outcome.reason === "search_provider_unconfigured")) {
    outcome = { kind: "unavailable", reason: value.outcome.reason };
  } else {
    mismatch();
  }
  return {
    index,
    queryId: value.queryId,
    queryTemplateVersion: "slovenia-municipal-safety-query@1",
    providerId: value.providerId,
    query: expectedQuery,
    searchedAt: value.searchedAt,
    outcome,
  };
}

function sameOrigin(left: unknown, right: CitySafetyCandidateOrigin): boolean {
  if (!record(left) || left.kind !== right.kind) return false;
  if (right.kind === "previous") {
    return exactKeys(left, ["kind", "priorSourcePlanId", "priorEvidenceSnapshotId"]) &&
      left.priorSourcePlanId === right.priorSourcePlanId &&
      left.priorEvidenceSnapshotId === right.priorEvidenceSnapshotId;
  }
  if (right.kind === "configured") {
    return exactKeys(left, ["kind", "configuredRouteIndex"]) &&
      left.configuredRouteIndex === right.configuredRouteIndex;
  }
  return exactKeys(left, ["kind", "queryId"]) && left.queryId === right.queryId;
}

function publisherById(
  directory: OfficialAuthorityDirectory,
  publisherId: unknown,
): OfficialPublisherPolicy {
  if (typeof publisherId !== "string") mismatch();
  const publisher = directory.publishers.find((item) => item.publisherId === publisherId);
  if (publisher === undefined) mismatch();
  return publisher;
}

function decodePreviousAccepted(
  value: unknown,
  cityId: string,
  municipalityCode: string,
  directory: OfficialAuthorityDirectory,
): CitySafetyPreviousAcceptedReference | undefined {
  if (value === undefined) return undefined;
  if (!record(value) || !exactKeys(value, [
    "cityId", "municipalityCode", "sourcePlanId", "definitionId", "publisherId", "navigationUrl",
    "resolvedEvidenceUrl", "referenceYear", "evidenceSnapshotId",
  ]) || value.cityId !== cityId || value.municipalityCode !== municipalityCode ||
    value.definitionId !== "si-municipal-police-offences-per-100000@1" ||
    typeof value.sourcePlanId !== "string" || value.sourcePlanId.length === 0 ||
    typeof value.evidenceSnapshotId !== "string" || value.evidenceSnapshotId.length === 0 ||
    !Number.isSafeInteger(value.referenceYear)) mismatch();
  const publisher = publisherById(directory, value.publisherId);
  const navigationUrl = canonicalizeCitySafetyCandidateUrl(value.navigationUrl as string);
  const resolvedEvidenceUrl = canonicalizeCitySafetyCandidateUrl(value.resolvedEvidenceUrl as string);
  if (!urlAllowed(navigationUrl, publisher) || !urlAllowed(resolvedEvidenceUrl, publisher)) mismatch();
  return {
    cityId,
    municipalityCode,
    sourcePlanId: value.sourcePlanId,
    definitionId: "si-municipal-police-offences-per-100000@1",
    publisherId: publisher.publisherId,
    navigationUrl,
    resolvedEvidenceUrl,
    referenceYear: value.referenceYear as number,
    evidenceSnapshotId: value.evidenceSnapshotId,
  };
}

function urlAllowed(value: string, publisher: OfficialPublisherPolicy): boolean {
  const host = new URL(value).hostname;
  return publisher.allowedHosts.includes(host) || publisher.delegatedDocumentHosts.includes(host);
}

function urlDirectlyAllowed(value: string, publisher: OfficialPublisherPolicy): boolean {
  return publisher.allowedHosts.includes(new URL(value).hostname);
}

function scopedPublisherById(
  directory: OfficialAuthorityDirectory,
  publisherIds: readonly string[],
  publisherId: unknown,
): OfficialPublisherPolicy {
  const publisher = publisherById(directory, publisherId);
  if (!publisherIds.includes(publisher.publisherId)) mismatch();
  return publisher;
}

function uniqueScopedDirectPublisher(
  candidateUrl: string,
  directory: OfficialAuthorityDirectory,
  publisherIds: readonly string[],
): OfficialPublisherPolicy | undefined {
  const matches = directory.publishers.filter((publisher) =>
    publisherIds.includes(publisher.publisherId) && urlDirectlyAllowed(candidateUrl, publisher));
  return matches.length === 1 ? matches[0] : undefined;
}

function scopedDirectPublisherById(
  candidateUrl: string,
  directory: OfficialAuthorityDirectory,
  publisherIds: readonly string[],
  publisherId: unknown,
): OfficialPublisherPolicy {
  const publisher = scopedPublisherById(directory, publisherIds, publisherId);
  if (uniqueScopedDirectPublisher(candidateUrl, directory, publisherIds)?.publisherId !== publisher.publisherId) {
    mismatch();
  }
  return publisher;
}

function contextualPublisher(
  queued: ReplayQueuedCandidate,
  directory: OfficialAuthorityDirectory,
  publisherIds: readonly string[],
): OfficialPublisherPolicy | undefined {
  const context = queued.publisherContext;
  if (context === undefined || !publisherIds.includes(context.publisherId)) return undefined;
  const publisher = uniqueScopedDirectPublisher(queued.url, directory, publisherIds);
  if (publisher === undefined || publisher.publisherId !== context.publisherId ||
    !urlDirectlyAllowed(context.publisherNavigationUrl, publisher)) return undefined;
  return publisher;
}

const denominatorMediaAllowed = (mediaType: string, publisher: OfficialPublisherPolicy): boolean => publisher.retentionMode === "seal_raw_artifact" ? publisher.allowedMediaTypes.includes(mediaType) : mediaType === "application/json";

function canonicalLedgerUrl(value: unknown): string {
  if (typeof value !== "string") mismatch();
  const canonical = canonicalizeCitySafetyCandidateUrl(value);
  if (canonical !== value) mismatch();
  return canonical;
}

function decodeFailure(value: unknown): CitySafetyOfficialFailureTrace {
  if (!record(value)) mismatch();
  const keys = ["captureKind"];
  if (value.responseStatus !== undefined) keys.push("responseStatus");
  if (value.responseUrl !== undefined) keys.push("responseUrl");
  if (value.mediaType !== undefined) keys.push("mediaType");
  if (value.rejectedTarget !== undefined) keys.push("rejectedTarget");
  if (!exactKeys(value, keys) || ![
    "timeout", "rate_limited", "server_error", "http_error", "wrong_media_type", "too_large",
    "navigation_mismatch",
  ].includes(value.captureKind as string) || value.responseStatus !== undefined &&
    (!Number.isSafeInteger(value.responseStatus) || (value.responseStatus as number) < 100 ||
      (value.responseStatus as number) > 599) || value.mediaType !== undefined &&
    (typeof value.mediaType !== "string" || value.mediaType.length === 0 ||
      value.mediaType !== value.mediaType.toLowerCase())) mismatch();
  let rejectedTarget: CitySafetyOfficialFailureTrace["rejectedTarget"];
  if (value.rejectedTarget !== undefined) {
    if (!record(value.rejectedTarget) || !exactKeys(value.rejectedTarget, ["kind", "url"]) ||
      !["untrusted_target", "redirect_loop", "hop_limit"].includes(value.rejectedTarget.kind as string)) {
      mismatch();
    }
    rejectedTarget = {
      kind: value.rejectedTarget.kind as NonNullable<CitySafetyOfficialFailureTrace["rejectedTarget"]>["kind"],
      url: canonicalLedgerUrl(value.rejectedTarget.url),
    };
  }
  return {
    captureKind: value.captureKind as CitySafetyOfficialFailureTrace["captureKind"],
    ...(value.responseStatus === undefined ? {} : { responseStatus: value.responseStatus as number }),
    ...(value.responseUrl === undefined ? {} : { responseUrl: canonicalLedgerUrl(value.responseUrl) }),
    ...(value.mediaType === undefined ? {} : { mediaType: value.mediaType as string }),
    ...(rejectedTarget === undefined ? {} : { rejectedTarget }),
  };
}

function decodeTrace(
  value: unknown,
  queued: ReplayQueuedCandidate,
  publisher?: OfficialPublisherPolicy,
): CitySafetyOfficialInspectionTrace {
  if (!record(value)) mismatch();
  const keys = ["initialUrl", "edges", "officialHops"];
  if (value.lastTrustedUrl !== undefined) keys.push("lastTrustedUrl");
  if (value.failure !== undefined) keys.push("failure");
  if (!exactKeys(value, keys) || canonicalLedgerUrl(value.initialUrl) !== queued.url ||
    !denseArray(value.edges) || value.edges.length > 2 || value.officialHops !== value.edges.length) mismatch();
  if (publisher !== undefined && !urlDirectlyAllowed(queued.url, publisher)) mismatch();
  let cursor = queued.url;
  const visited = new Set([cursor]);
  const edges = value.edges.map((edge): CitySafetyOfficialChainEdge => {
    if (!record(edge) || !exactKeys(edge, ["kind", "fromUrl", "toUrl"]) ||
      (edge.kind !== "http_redirect" && edge.kind !== "confirmed_document_link")) mismatch();
    const fromUrl = canonicalLedgerUrl(edge.fromUrl);
    const toUrl = canonicalLedgerUrl(edge.toUrl);
    if (fromUrl !== cursor || visited.has(toUrl) || publisher !== undefined &&
      (!urlAllowed(fromUrl, publisher) || !urlAllowed(toUrl, publisher))) mismatch();
    cursor = toUrl;
    visited.add(toUrl);
    return { kind: edge.kind, fromUrl, toUrl };
  });
  const lastTrustedUrl = value.lastTrustedUrl === undefined
    ? undefined
    : canonicalLedgerUrl(value.lastTrustedUrl);
  if (lastTrustedUrl !== undefined && lastTrustedUrl !== cursor || publisher !== undefined &&
    (lastTrustedUrl === undefined || !urlAllowed(lastTrustedUrl, publisher))) mismatch();
  const failure = value.failure === undefined ? undefined : decodeFailure(value.failure);
  if (failure?.responseUrl !== undefined && failure.responseUrl !== lastTrustedUrl ||
    failure?.rejectedTarget?.kind === "redirect_loop" && !visited.has(failure.rejectedTarget.url) ||
    failure?.rejectedTarget?.kind === "hop_limit" && edges.length !== 2 ||
    failure?.rejectedTarget?.kind === "hop_limit" && publisher !== undefined &&
      !urlAllowed(failure.rejectedTarget.url, publisher) ||
    failure?.rejectedTarget?.kind === "untrusted_target" && publisher !== undefined &&
      urlAllowed(failure.rejectedTarget.url, publisher)) mismatch();
  return {
    initialUrl: queued.url,
    edges,
    ...(lastTrustedUrl === undefined ? {} : { lastTrustedUrl }),
    officialHops: edges.length,
    ...(failure === undefined ? {} : { failure }),
  };
}

function decodeQuantity(value: unknown): CitySafetyQuantity {
  if (!record(value) || !exactKeys(value, ["offenceCount", "population", "rateBasis"]) ||
    typeof value.offenceCount !== "string" || !/^(0|[1-9][0-9]*)$/.test(value.offenceCount) ||
    typeof value.population !== "string" || !/^[1-9][0-9]*$/.test(value.population) ||
    value.rateBasis !== "offences_per_100000_residents") mismatch();
  return {
    offenceCount: value.offenceCount,
    population: value.population,
    rateBasis: "offences_per_100000_residents",
  };
}

function decodeDenominator(value: unknown): CitySafetyDenominatorReference {
  if (!record(value) || !exactKeys(value, [
    "publisherId", "municipalityCode", "referenceDate", "population", "artifactId", "mediaType",
    "retentionPolicyId", "transientRawDeleted",
  ]) || ![value.publisherId, value.municipalityCode, value.referenceDate, value.population,
    value.artifactId, value.mediaType, value.retentionPolicyId].every((item) =>
    typeof item === "string" && item.length > 0) || typeof value.transientRawDeleted !== "boolean" ||
    !/^(0|[1-9][0-9]*)$/.test(value.population as string)) mismatch();
  return {
    publisherId: value.publisherId as string,
    municipalityCode: value.municipalityCode as string,
    referenceDate: value.referenceDate as string,
    population: value.population as string,
    artifactId: value.artifactId as string,
    mediaType: value.mediaType as string,
    retentionPolicyId: value.retentionPolicyId as string,
    transientRawDeleted: value.transientRawDeleted,
  };
}

function decodeArtifactRefs(
  value: unknown,
  municipalPublisher: OfficialPublisherPolicy | undefined,
  denominatorPublisher: OfficialPublisherPolicy,
): readonly CitySafetyArtifactReference[] {
  if (!denseArray(value)) mismatch();
  const refs = value.map((item): CitySafetyArtifactReference => {
    if (!record(item) || (item.role !== "municipal_source" && item.role !== "surs_denominator")) mismatch();
    const keys = item.role === "municipal_source"
      ? ["role", "documentRole", "artifactId", "artifactSha256", "sourceSha256", "locator"]
      : ["role", "artifactId", "artifactSha256", "sourceSha256", "locator"];
    if (!exactKeys(item, keys) || typeof item.artifactId !== "string" || item.artifactId.length === 0 ||
      typeof item.artifactSha256 !== "string" || !/^[a-f0-9]{64}$/.test(item.artifactSha256) ||
      typeof item.sourceSha256 !== "string" || !/^[a-f0-9]{64}$/.test(item.sourceSha256) ||
      item.role === "municipal_source" && item.documentRole !== "navigation" &&
        item.documentRole !== "terminal_claim") mismatch();
    const locator = canonicalLedgerUrl(item.locator);
    const policy = item.role === "municipal_source" ? municipalPublisher : denominatorPublisher;
    if (policy === undefined || !urlAllowed(locator, policy) || policy.retentionMode === "seal_raw_artifact" &&
      item.artifactSha256 !== item.sourceSha256) mismatch();
    const common = {
      artifactId: item.artifactId,
      artifactSha256: item.artifactSha256,
      sourceSha256: item.sourceSha256,
      locator,
    };
    return item.role === "municipal_source"
      ? { role: "municipal_source", documentRole: item.documentRole as "navigation" | "terminal_claim", ...common }
      : { role: "surs_denominator", ...common };
  });
  if (new Set(refs.map(({ artifactId }) => artifactId)).size !== refs.length) mismatch();
  return refs;
}

function validateArtifactOrder(
  refs: readonly CitySafetyArtifactReference[],
  trace: CitySafetyOfficialInspectionTrace,
  requiresTerminal: boolean,
  requiresDenominator: boolean,
): void {
  const confirmedLinks = trace.edges.filter(({ kind }) => kind === "confirmed_document_link");
  const navigation = refs.filter((ref) => ref.role === "municipal_source" && ref.documentRole === "navigation");
  const terminal = refs.filter((ref) => ref.role === "municipal_source" && ref.documentRole === "terminal_claim");
  const denominators = refs.filter((ref) => ref.role === "surs_denominator");
  if (navigation.length < confirmedLinks.length || navigation.length > confirmedLinks.length + (requiresTerminal ? 0 : 1) ||
    navigation.some((ref, index) => index < confirmedLinks.length &&
      ref.locator !== confirmedLinks[index]!.fromUrl) || terminal.length !== (requiresTerminal ? 1 : 0) ||
    navigation.length === confirmedLinks.length + 1 && navigation.at(-1)?.locator !== trace.lastTrustedUrl ||
    terminal[0] !== undefined && terminal[0].locator !== trace.lastTrustedUrl ||
    denominators.length !== (requiresDenominator ? 1 : 0)) mismatch();
  if ([...navigation, ...terminal, ...denominators].some((ref, index) => ref !== refs[index])) mismatch();
}

function decodeReviewedOfficial(value: unknown): NonNullable<CitySafetyRejectedCandidateAttempt["reviewedOfficial"]> {
  if (!record(value)) mismatch();
  const keys = ["publisherId", "dataAuthorityId", "publisherNavigationUrl"];
  if (value.resolvedEvidenceUrl !== undefined) keys.push("resolvedEvidenceUrl");
  if (value.referenceYear !== undefined) keys.push("referenceYear");
  if (!exactKeys(value, keys) || !identifier(value.publisherId) ||
    typeof value.dataAuthorityId !== "string" || value.dataAuthorityId.length === 0 ||
    value.referenceYear !== undefined && !Number.isSafeInteger(value.referenceYear)) mismatch();
  return {
    publisherId: value.publisherId,
    dataAuthorityId: value.dataAuthorityId,
    publisherNavigationUrl: canonicalLedgerUrl(value.publisherNavigationUrl),
    ...(value.resolvedEvidenceUrl === undefined
      ? {}
      : { resolvedEvidenceUrl: canonicalLedgerUrl(value.resolvedEvidenceUrl) }),
    ...(value.referenceYear === undefined ? {} : { referenceYear: value.referenceYear as number }),
  };
}

function decodeConflictBasis(value: unknown): CitySafetyConflictBasis {
  if (!record(value) || !exactKeys(value, ["referenceYear", "quantities", "denominator"]) ||
    !Number.isSafeInteger(value.referenceYear) || !denseArray(value.quantities) ||
    value.quantities.length !== 2) mismatch();
  const quantities = value.quantities.map(decodeQuantity) as unknown as
    readonly [CitySafetyQuantity, CitySafetyQuantity];
  const denominator = decodeDenominator(value.denominator);
  if (quantities[0].population !== quantities[1].population ||
    quantities[0].population !== denominator.population ||
    BigInt(quantities[0].offenceCount) >= BigInt(quantities[1].offenceCount)) mismatch();
  return { referenceYear: value.referenceYear as number, quantities, denominator };
}

function rejectionNeedsDenominator(reason: CitySafetyCandidateRejectionReason): boolean {
  return [
    "stale", "denominator_zero", "denominator_period_mismatch", "denominator_scope_mismatch", "conflict",
  ].includes(reason);
}

function validateFailureForReason(
  reason: CitySafetyCandidateRejectionReason,
  failure: CitySafetyOfficialFailureTrace | undefined,
): void {
  const captureReason = [
    "http_not_found", "transport_unavailable", "authority_untrusted", "wrong_media_type", "too_large",
    "untrusted_redirect",
  ].includes(reason);
  if (captureReason !== (failure !== undefined)) mismatch();
  if (reason === "http_not_found" &&
    (failure?.captureKind !== "http_error" || failure.responseStatus !== 404) ||
    reason === "transport_unavailable" &&
      (!["timeout", "rate_limited", "server_error", "http_error"].includes(failure?.captureKind ?? "") ||
        failure?.captureKind === "http_error" && failure.responseStatus === 404) ||
    reason === "authority_untrusted" && failure?.captureKind !== "navigation_mismatch" ||
    reason === "wrong_media_type" && failure?.captureKind !== "wrong_media_type" ||
    reason === "too_large" && failure?.captureKind !== "too_large" ||
    reason === "untrusted_redirect" &&
      (failure?.captureKind !== "navigation_mismatch" || failure.rejectedTarget === undefined)) mismatch();
}

function decodeCandidateEnvelope(
  value: unknown,
  index: number,
  queued: ReplayQueuedCandidate,
  publisherIds: readonly string[],
  directory: OfficialAuthorityDirectory,
  municipalityCode: string,
  assessmentAt: string,
): CitySafetyCandidateAttempt {
  if (!record(value) || value.index !== index || !sameOrigin(value.origin, queued.origin) ||
    typeof value.canonicalUrl !== "string" || value.canonicalUrl !== queued.url ||
    canonicalizeCitySafetyCandidateUrl(value.canonicalUrl) !== value.canonicalUrl) mismatch();
  const denominatorPublisher = publisherById(directory, directory.requiredPublisherIds.surs);
  if (value.disposition === "usable") {
    if (!exactKeys(value, [
      "index", "origin", "canonicalUrl", "publisherId", "dataAuthorityId", "publisherNavigationUrl",
      "resolvedEvidenceUrl", "officialTrace", "mediaType", "retentionPolicyId", "transientRawDeleted",
      "artifactRefs", "disposition", "referenceYear", "periodDisposition", "quantity", "denominator",
    ]) || !Number.isSafeInteger(value.referenceYear) ||
      (value.periodDisposition !== "preferred" && value.periodDisposition !== "fallback") ||
      typeof value.mediaType !== "string" || typeof value.transientRawDeleted !== "boolean") mismatch();
    const publisher = scopedDirectPublisherById(queued.url, directory, publisherIds, value.publisherId);
    const expectedNavigation = queued.publisherContext?.publisherNavigationUrl ?? publisher.navigationUrl;
    const publisherNavigationUrl = canonicalLedgerUrl(value.publisherNavigationUrl);
    if (queued.publisherContext !== undefined && queued.publisherContext.publisherId !== publisher.publisherId ||
      publisherNavigationUrl !== canonicalizeCitySafetyCandidateUrl(expectedNavigation) ||
      value.dataAuthorityId !== directory.requiredPublisherIds.police ||
      !urlDirectlyAllowed(publisherNavigationUrl, publisher) || !urlDirectlyAllowed(queued.url, publisher) ||
      !publisher.allowedMediaTypes.includes(value.mediaType) ||
      value.retentionPolicyId !== publisher.retentionPolicyId || value.transientRawDeleted !==
        (publisher.retentionMode === "seal_hash_locator_then_delete_transient")) mismatch();
    const trace = decodeTrace(value.officialTrace, queued, publisher);
    const resolvedEvidenceUrl = canonicalLedgerUrl(value.resolvedEvidenceUrl);
    const quantity = decodeQuantity(value.quantity);
    const denominator = decodeDenominator(value.denominator);
    const refs = decodeArtifactRefs(value.artifactRefs, publisher, denominatorPublisher);
    const expectedPeriod = classifyCitySafetyPeriod({
      assessmentAt,
      referenceYear: value.referenceYear as number,
    });
    if (trace.failure !== undefined || trace.lastTrustedUrl !== resolvedEvidenceUrl ||
      !urlAllowed(resolvedEvidenceUrl, publisher) || expectedPeriod === "stale" ||
      value.periodDisposition !== expectedPeriod || denominator.publisherId !== denominatorPublisher.publisherId ||
      denominator.municipalityCode !== municipalityCode ||
      denominator.referenceDate !== `${value.referenceYear as number}-01-01` ||
      denominator.population !== quantity.population || denominator.retentionPolicyId !==
        denominatorPublisher.retentionPolicyId || denominator.transientRawDeleted !==
        (denominatorPublisher.retentionMode === "seal_hash_locator_then_delete_transient") ||
      !denominatorMediaAllowed(denominator.mediaType, denominatorPublisher) ||
      !refs.some((ref) => ref.role === "surs_denominator" &&
          ref.artifactId === denominator.artifactId)) mismatch();
    validateArtifactOrder(refs, trace, true, true);
    return {
      index,
      origin: queued.origin,
      canonicalUrl: queued.url,
      publisherId: publisher.publisherId,
      dataAuthorityId: directory.requiredPublisherIds.police,
      publisherNavigationUrl,
      resolvedEvidenceUrl,
      officialTrace: trace,
      mediaType: value.mediaType,
      retentionPolicyId: publisher.retentionPolicyId,
      transientRawDeleted: value.transientRawDeleted,
      artifactRefs: refs,
      disposition: "usable",
      referenceYear: value.referenceYear as number,
      periodDisposition: value.periodDisposition,
      quantity,
      denominator,
    };
  }
  if (value.disposition !== "rejected") mismatch();
  const optionalKeys = ["reviewedOfficial", "mediaType", "retentionPolicyId", "transientRawDeleted", "conflictBasis"]
    .filter((key) => value[key] !== undefined);
  if (!exactKeys(value, [
    "index", "origin", "canonicalUrl", "officialTrace", "artifactRefs", "disposition", "reason",
    ...optionalKeys,
  ]) || ![
    "http_not_found", "transport_unavailable", "authority_untrusted", "stale", "scope_mismatch",
    "definition_mismatch", "missing_numerator", "denominator_missing", "denominator_zero",
    "denominator_period_mismatch", "denominator_scope_mismatch", "wrong_media_type", "too_large",
    "untrusted_redirect", "retention_unapproved", "conflict",
  ].includes(value.reason as string)) mismatch();
  const reason = value.reason as CitySafetyCandidateRejectionReason;
  const reviewed = value.reviewedOfficial === undefined
    ? undefined
    : decodeReviewedOfficial(value.reviewedOfficial);
  const publisher = reviewed !== undefined
    ? scopedDirectPublisherById(queued.url, directory, publisherIds, reviewed.publisherId)
    : queued.publisherContext === undefined
      ? uniqueScopedDirectPublisher(queued.url, directory, publisherIds)
      : contextualPublisher(queued, directory, publisherIds);
  if (publisher !== undefined) {
    const expectedNavigation = queued.publisherContext?.publisherNavigationUrl ?? publisher.navigationUrl;
    const actualNavigation = reviewed?.publisherNavigationUrl ?? expectedNavigation;
    if (queued.publisherContext !== undefined && queued.publisherContext.publisherId !== publisher.publisherId ||
      canonicalizeCitySafetyCandidateUrl(expectedNavigation) !== actualNavigation ||
      !urlDirectlyAllowed(actualNavigation, publisher) ||
      !urlDirectlyAllowed(queued.url, publisher)) mismatch();
  }
  const trace = decodeTrace(value.officialTrace, queued, publisher);
  validateFailureForReason(reason, trace.failure);
  const semantic = [
    "stale", "scope_mismatch", "definition_mismatch", "missing_numerator", "denominator_missing",
    "denominator_zero", "denominator_period_mismatch", "denominator_scope_mismatch", "conflict",
  ].includes(reason);
  const untrustedInitial = reason === "authority_untrusted" && publisher === undefined;
  const untrustedPublication = reason === "authority_untrusted" && publisher !== undefined;
  if (untrustedInitial && (trace.edges.length !== 0 || trace.lastTrustedUrl !== undefined ||
      reviewed !== undefined || value.artifactRefs instanceof Array && value.artifactRefs.length !== 0) ||
    untrustedPublication && (reviewed === undefined || reviewed.dataAuthorityId === directory.requiredPublisherIds.police) ||
    reason !== "authority_untrusted" && reviewed !== undefined &&
      reviewed.dataAuthorityId !== directory.requiredPublisherIds.police ||
    semantic && reviewed === undefined || semantic && reviewed?.resolvedEvidenceUrl !== trace.lastTrustedUrl ||
    semantic && [
      "stale", "denominator_missing", "denominator_zero", "denominator_period_mismatch",
      "denominator_scope_mismatch", "conflict",
    ].includes(reason) && reviewed?.referenceYear === undefined ||
    reason === "stale" && classifyCitySafetyPeriod({
      assessmentAt,
      referenceYear: reviewed!.referenceYear!,
    }) !== "stale") mismatch();
  const refs = decodeArtifactRefs(value.artifactRefs, publisher, denominatorPublisher);
  const hasRetention = refs.length > 0 || value.mediaType !== undefined ||
    value.retentionPolicyId !== undefined || value.transientRawDeleted !== undefined;
  if (hasRetention && (publisher === undefined || typeof value.mediaType !== "string" ||
      !publisher.allowedMediaTypes.includes(value.mediaType) || value.retentionPolicyId !==
        publisher.retentionPolicyId || value.transientRawDeleted !==
        (publisher.retentionMode === "seal_hash_locator_then_delete_transient")) ||
    reason === "retention_unapproved" && refs.length !== 0) mismatch();
  const conflictBasis = value.conflictBasis === undefined ? undefined : decodeConflictBasis(value.conflictBasis);
  if ((reason === "conflict") !== (conflictBasis !== undefined) || conflictBasis !== undefined &&
    (reviewed?.referenceYear !== conflictBasis.referenceYear ||
      conflictBasis.denominator.publisherId !== denominatorPublisher.publisherId ||
      conflictBasis.denominator.municipalityCode !== municipalityCode ||
      conflictBasis.denominator.referenceDate !== `${conflictBasis.referenceYear}-01-01` ||
      conflictBasis.denominator.retentionPolicyId !== denominatorPublisher.retentionPolicyId ||
      conflictBasis.denominator.transientRawDeleted !==
        (denominatorPublisher.retentionMode === "seal_hash_locator_then_delete_transient") ||
      !denominatorMediaAllowed(conflictBasis.denominator.mediaType, denominatorPublisher) ||
      !refs.some((ref) => ref.role === "surs_denominator" &&
        ref.artifactId === conflictBasis.denominator.artifactId))) mismatch();
  validateArtifactOrder(refs, trace, semantic, rejectionNeedsDenominator(reason));
  return {
    index,
    origin: queued.origin,
    canonicalUrl: queued.url,
    officialTrace: trace,
    ...(reviewed === undefined ? {} : { reviewedOfficial: reviewed }),
    ...(value.mediaType === undefined ? {} : { mediaType: value.mediaType as string }),
    ...(value.retentionPolicyId === undefined
      ? {}
      : { retentionPolicyId: value.retentionPolicyId as string }),
    ...(value.transientRawDeleted === undefined
      ? {}
      : { transientRawDeleted: value.transientRawDeleted as boolean }),
    artifactRefs: refs,
    disposition: "rejected",
    reason,
    ...(conflictBasis === undefined ? {} : { conflictBasis }),
  };
}

function decodeResult(
  value: unknown,
  candidates: readonly CitySafetyCandidateAttempt[],
  queries: readonly CitySafetyQueryAttempt[],
  exhausted: boolean,
): CitySafetyAttemptLedger["result"] {
  if (!record(value)) mismatch();
  const usable = candidates.filter((candidate): candidate is CitySafetyUsableCandidateAttempt =>
    candidate.disposition === "usable");
  const preferred = usable.find(({ periodDisposition }) => periodDisposition === "preferred");
  const fallbacks = usable.filter(({ periodDisposition }) => periodDisposition === "fallback");
  const fallbackConflict = fallbacks.some((candidate, index) => fallbacks.slice(index + 1)
    .some((other) => other.referenceYear === candidate.referenceYear &&
      (other.quantity.offenceCount !== candidate.quantity.offenceCount ||
        other.quantity.population !== candidate.quantity.population)));
  const accepted = preferred ?? (fallbackConflict ? undefined : fallbacks[0]);
  if (preferred !== undefined && preferred !== candidates.at(-1) || preferred === undefined && !exhausted) mismatch();
  if (accepted !== undefined) {
    if (value.kind !== "verified" || !exactKeys(value, [
      "kind", "quantity", "referenceYear", "acceptedCandidateIndex",
    ]) || value.acceptedCandidateIndex !== accepted.index || value.referenceYear !== accepted.referenceYear ||
      JSON.stringify(decodeQuantity(value.quantity)) !== JSON.stringify(accepted.quantity)) mismatch();
    return {
      kind: "verified",
      quantity: accepted.quantity,
      referenceYear: accepted.referenceYear,
      acceptedCandidateIndex: accepted.index,
    };
  }
  if (value.kind !== "unknown" || !exactKeys(value, ["kind", "reason"])) mismatch();
  const expected = chooseCitySafetyUnknownReason(candidates, queries);
  if (value.reason !== expected || fallbackConflict && expected !== "conflict") mismatch();
  return { kind: "unknown", reason: expected };
}

export function reconstructCitySafetyAttemptLedger(
  value: unknown,
  context: CitySafetyLedgerReconstructionContext,
): CitySafetyAttemptLedger {
  try {
    if (!RUN_ID_PATTERN.test(context.runId) || !record(value) || !exactKeys(value, TOP_LEVEL_KEYS) ||
      value.schemaVersion !== "city-safety-attempt-ledger@1" || !canonicalInstant(value.assessmentAt) ||
      !canonicalInstant(value.completedAt) || !denseArray(value.queries) || value.queries.length > 3 ||
      !denseArray(value.candidates) || value.candidates.length > 10 || !record(value.counters)) mismatch();
    const directory = reconstructOfficialAuthorityDirectory(
      context.authorityDirectory,
      context.catalog,
      context.integrity,
    );
    const plan = reconstructCitySafetySourcePlan(
      context.sourcePlan,
      context.catalog,
      directory,
      context.integrity,
    );
    const entry = plan.entries.find(({ cityId }) => cityId === value.cityId);
    if (entry === undefined || value.catalogRevisionId !== context.catalog.id ||
      value.authorityDirectoryId !== directory.id || value.sourcePlanId !== plan.id ||
      value.municipalityCode !== entry.municipalityCode || value.definitionId !== plan.definitionId ||
      value.freshnessPolicyVersion !== plan.freshnessPolicyVersion ||
      value.discoveryRulesVersion !== plan.discoveryRulesVersion) mismatch();
    const expectedQueries = buildCitySafetyQueries(
      entry,
      directory,
      value.assessmentAt,
      context.catalog,
      context.integrity,
    );
    const queries = value.queries.map((query, index) =>
      decodeQuery(query, index, context.runId, expectedQueries[index]!));
    const rawCandidates = value.candidates;
    const assessmentAt = value.assessmentAt;
    const previousAccepted = decodePreviousAccepted(
      context.previousAccepted,
      entry.cityId,
      entry.municipalityCode,
      directory,
    );
    const queue: ReplayQueuedCandidate[] = [];
    if (previousAccepted !== undefined) {
      const previous = previousAccepted;
      queue.push({
        url: canonicalizeCitySafetyCandidateUrl(previous.resolvedEvidenceUrl),
        origin: {
          kind: "previous",
          priorSourcePlanId: previous.sourcePlanId,
          priorEvidenceSnapshotId: previous.evidenceSnapshotId,
        },
        publisherContext: {
          publisherId: previous.publisherId,
          publisherNavigationUrl: previous.navigationUrl,
        },
      });
    }
    entry.configuredRoutes.forEach((route, configuredRouteIndex) => queue.push({
      url: canonicalizeCitySafetyCandidateUrl(route.resolvedEvidenceUrl ?? route.navigationUrl),
      origin: { kind: "configured", configuredRouteIndex },
      publisherContext: {
        publisherId: route.publisherId,
        publisherNavigationUrl: route.navigationUrl,
      },
    }));
    const candidates: CitySafetyCandidateAttempt[] = [];
    const seen = new Set<string>();
    let queueIndex = 0;
    let acceptedPreferred = false;
    const inspectQueue = (): void => {
      while (queueIndex < queue.length && candidates.length < 10 && !acceptedPreferred) {
        const queued = queue[queueIndex++]!;
        if (seen.has(queued.url)) continue;
        seen.add(queued.url);
        const candidate = decodeCandidateEnvelope(
          rawCandidates[candidates.length],
          candidates.length,
          queued,
          entry.publisherIds,
          directory,
          entry.municipalityCode,
          assessmentAt,
        );
        candidates.push(candidate);
        acceptedPreferred = candidate.disposition === "usable" && candidate.periodDisposition === "preferred";
      }
    };
    inspectQueue();
    // Recovery discovery is deliberately not represented as an ordinary search query: its
    // untrusted proposal is retained only as the candidate URL, then independently captured
    // and parsed.  Replay therefore accepts this tightly bounded, explicit origin segment.
    if (previousAccepted !== undefined && !acceptedPreferred) {
      let previousRound = 0;
      const urlsByRound = new Map<number, Set<string>>();
      while (candidates.length < rawCandidates.length && candidates.length < 10 && !acceptedPreferred) {
        const raw = rawCandidates[candidates.length];
        if (!record(raw) || !record(raw.origin) || raw.origin.kind !== "search" ||
          typeof raw.origin.queryId !== "string") break;
        const round = raw.origin.queryId === `official-source-recovery:${context.runId}:1`
          ? 1
          : raw.origin.queryId === `official-source-recovery:${context.runId}:2` ? 2 : undefined;
        if (round === undefined) break;
        if (round < previousRound || typeof raw.canonicalUrl !== "string" ||
          canonicalizeCitySafetyCandidateUrl(raw.canonicalUrl) !== raw.canonicalUrl) mismatch();
        const urls = urlsByRound.get(round) ?? new Set<string>();
        if (urls.size >= 5 || urls.has(raw.canonicalUrl)) mismatch();
        urls.add(raw.canonicalUrl);
        urlsByRound.set(round, urls);
        previousRound = round;
        queue.push({ url: raw.canonicalUrl, origin: { kind: "search", queryId: raw.origin.queryId } });
        inspectQueue();
      }
    }
    for (const query of queries) {
      if (candidates.length >= 10 || acceptedPreferred) mismatch();
      if (query.outcome.kind === "completed") {
        const resultLimit = 10 - candidates.length;
        if (query.outcome.returnedUrls.length > resultLimit) mismatch();
        query.outcome.returnedUrls.forEach((url) => queue.push({
          url: canonicalizeCitySafetyCandidateUrl(url),
          origin: { kind: "search", queryId: query.queryId },
        }));
        inspectQueue();
      }
    }
    if (candidates.length !== value.candidates.length) mismatch();
    const reusedArtifacts = new Map<string, string>();
    for (const candidate of candidates) {
      for (const ref of candidate.artifactRefs) {
        const closed = JSON.stringify([ref.role, ref.artifactSha256, ref.sourceSha256, ref.locator]);
        const existing = reusedArtifacts.get(ref.artifactId);
        if (existing !== undefined && existing !== closed) mismatch();
        reusedArtifacts.set(ref.artifactId, closed);
      }
    }
    const exhausted = candidates.length === 10 || queries.length === 3 &&
      queue.slice(queueIndex).every(({ url }) => seen.has(url));
    const result = decodeResult(value.result, candidates, queries, exhausted);
    if (!exactKeys(value.counters, ["queries", "candidates", "maxOfficialHops"]) ||
      value.counters.queries !== queries.length || value.counters.candidates !== candidates.length ||
      value.counters.maxOfficialHops !== candidates.reduce(
        (maximum, candidate) => Math.max(maximum, candidate.officialTrace.officialHops), 0)) mismatch();
    return immutableCopy({
      schemaVersion: "city-safety-attempt-ledger@1",
      catalogRevisionId: context.catalog.id,
      authorityDirectoryId: directory.id,
      sourcePlanId: plan.id,
      cityId: entry.cityId,
      municipalityCode: entry.municipalityCode,
      assessmentAt: value.assessmentAt,
      definitionId: plan.definitionId,
      freshnessPolicyVersion: plan.freshnessPolicyVersion,
      discoveryRulesVersion: plan.discoveryRulesVersion,
      queries,
      candidates,
      counters: {
        queries: queries.length,
        candidates: candidates.length,
        maxOfficialHops: value.counters.maxOfficialHops as number,
      },
      result,
      completedAt: value.completedAt,
    });
  } catch {
    mismatch();
  }
}

export function projectReconstructedCitySafetyEvidenceLinks(
  ledger: CitySafetyAttemptLedger,
): readonly CitySafetyEvidenceLink[] {
  const links: CitySafetyEvidenceLink[] = [];
  if (ledger.result.kind === "verified") {
    const accepted = ledger.candidates[ledger.result.acceptedCandidateIndex];
    if (accepted?.disposition !== "usable") mismatch();
    links.push({
      disposition: "accepted",
      navigationUrl: accepted.publisherNavigationUrl,
      resolvedEvidenceUrl: accepted.resolvedEvidenceUrl,
      referenceYear: accepted.referenceYear,
    });
  }
  for (const candidate of ledger.candidates) {
    if (candidate.disposition !== "rejected" || candidate.reviewedOfficial === undefined) continue;
    links.push({
      disposition: "reviewed_rejected",
      navigationUrl: candidate.reviewedOfficial.publisherNavigationUrl,
      ...(candidate.reviewedOfficial.resolvedEvidenceUrl === undefined
        ? {}
        : { resolvedEvidenceUrl: candidate.reviewedOfficial.resolvedEvidenceUrl }),
      ...(candidate.reviewedOfficial.referenceYear === undefined
        ? {}
        : { referenceYear: candidate.reviewedOfficial.referenceYear }),
      rejectionReason: candidate.reason,
    });
  }
  if (ledger.result.kind === "unknown" && ledger.result.reason === "conflict") {
    const fallbacks = ledger.candidates.filter(
      (candidate): candidate is CitySafetyUsableCandidateAttempt =>
        candidate.disposition === "usable" && candidate.periodDisposition === "fallback",
    );
    const conflicting = fallbacks.filter((candidate) => fallbacks.some((other) =>
      other !== candidate && other.referenceYear === candidate.referenceYear &&
      (other.quantity.offenceCount !== candidate.quantity.offenceCount ||
        other.quantity.population !== candidate.quantity.population)));
    for (const candidate of conflicting) {
      links.push({
        disposition: "reviewed_rejected",
        navigationUrl: candidate.publisherNavigationUrl,
        resolvedEvidenceUrl: candidate.resolvedEvidenceUrl,
        referenceYear: candidate.referenceYear,
        rejectionReason: "conflict",
      });
    }
  }
  return immutableCopy(links);
}

export function projectReconstructedCitySafetyTerminalLink(
  ledger: CitySafetyAttemptLedger,
  terminal: Readonly<{
    readonly navigationUrl: string;
    readonly resolvedEvidenceUrl: string;
  }>,
  expected:
    | Readonly<{ readonly kind: "claim"; readonly sourcePeriod: string }>
    | Readonly<{ readonly kind: "blocker"; readonly aggregateReason: CityUnknownReason }>,
): CitySafetyEvidenceLink {
  const links = projectReconstructedCitySafetyEvidenceLinks(ledger);
  const matches = links.filter((link) => link.navigationUrl === terminal.navigationUrl &&
    (link.resolvedEvidenceUrl ?? link.navigationUrl) === terminal.resolvedEvidenceUrl);
  if (expected.kind === "claim") {
    if (ledger.result.kind !== "verified" || matches.length !== 1 ||
      matches[0]?.disposition !== "accepted" ||
      String(matches[0].referenceYear) !== expected.sourcePeriod) mismatch();
    return matches[0];
  }
  if (ledger.result.kind !== "unknown" || ledger.result.reason !== expected.aggregateReason) mismatch();
  const rejectedMatches = matches.filter((link) => link.disposition === "reviewed_rejected");
  if (rejectedMatches.length === 1) return rejectedMatches[0]!;
  if (rejectedMatches.length > 1) mismatch();
  const unreviewed = ledger.candidates.filter((candidate) =>
    candidate.disposition === "rejected" && candidate.reviewedOfficial === undefined &&
    candidate.canonicalUrl === terminal.resolvedEvidenceUrl);
  if (unreviewed.length !== 1 || unreviewed[0]?.disposition !== "rejected") mismatch();
  return immutableCopy({
    disposition: "reviewed_rejected" as const,
    navigationUrl: terminal.navigationUrl,
    resolvedEvidenceUrl: terminal.resolvedEvidenceUrl,
    rejectionReason: unreviewed[0].reason,
  });
}

export function projectCitySafetyEvidenceLinks(
  value: unknown,
  context: CitySafetyLedgerReconstructionContext,
): readonly CitySafetyEvidenceLink[] {
  return projectReconstructedCitySafetyEvidenceLinks(
    reconstructCitySafetyAttemptLedger(value, context),
  );
}
