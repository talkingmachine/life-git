import { classifyCitySafetyPeriod } from "../decision/city-safety";
import type { LiveCapturedArtifact } from "../research/contracts";
import {
  canonicalizeCitySafetyCandidateUrl,
  chooseCitySafetyUnknownReason,
} from "../research/city-safety-discovery";
import type {
  CitySafetyArtifactReference,
  CitySafetyCandidateAttempt,
  CitySafetyCandidateOrigin,
  CitySafetyCandidateRejectionReason,
  CitySafetyConflictBasis,
  CitySafetyDenominatorReference,
  CitySafetyOfficialFailureTrace,
  CitySafetyOfficialInspectionTrace,
  CitySafetyQueryAttempt,
  CitySafetyRejectedCandidateAttempt,
  CitySafetyUsableCandidateAttempt,
} from "../research/city-safety-evidence";
import {
  buildCitySafetyQueries,
  reconstructCitySafetySourcePlan,
  reconstructOfficialAuthorityDirectory,
  type OfficialAuthorityDirectory,
  type OfficialPublisherPolicy,
} from "../research/city-safety-source-plan";
import type {
  CitySafetyCandidateInspectionInput,
  CitySafetyDiscoveryResult,
  CitySafetyOfficialDiscoveryPort,
  RunCitySafetyDiscoveryInput,
} from "./city-safety-contracts";

const MAX_CANDIDATES = 10;
const OFFICIAL_HOP_LIMIT = 2 as const;
const CAPTURE_REASONS = new Set([
  "http_not_found",
  "transport_unavailable",
  "authority_untrusted",
  "wrong_media_type",
  "too_large",
  "untrusted_redirect",
]);
const SEMANTIC_REASONS = new Set([
  "stale",
  "scope_mismatch",
  "definition_mismatch",
  "missing_numerator",
  "denominator_missing",
  "denominator_zero",
  "denominator_period_mismatch",
  "denominator_scope_mismatch",
  "conflict",
]);

interface QueuedCandidate {
  readonly url: string;
  readonly origin: CitySafetyCandidateOrigin;
  readonly publisherContext?: CitySafetyCandidateInspectionInput["publisherContext"];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: object, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function canonicalInstant(value: unknown, error: string): string {
  try {
    if (typeof value !== "string" || new Date(value).toISOString() !== value) throw new Error();
    return value;
  } catch {
    throw new Error(error);
  }
}

function clockInstant(clock: () => Date): string {
  const value = clock();
  if (!(value instanceof Date)) throw new Error("invalid_city_safety_clock");
  return canonicalInstant(value.toISOString(), "invalid_city_safety_clock");
}

function abortIfNeeded(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
}

function publisherById(
  directory: OfficialAuthorityDirectory,
  publisherId: string,
): OfficialPublisherPolicy {
  const publisher = directory.publishers.find((item) => item.publisherId === publisherId);
  if (publisher === undefined) throw new Error("invalid_city_safety_inspection");
  return publisher;
}

function urlAllowedByPublisher(value: string, publisher: OfficialPublisherPolicy): boolean {
  try {
    const canonical = canonicalizeCitySafetyCandidateUrl(value);
    const host = new URL(canonical).hostname;
    return publisher.allowedHosts.includes(host) || publisher.delegatedDocumentHosts.includes(host);
  } catch {
    return false;
  }
}

function validatePrevious(
  input: RunCitySafetyDiscoveryInput,
  directory: OfficialAuthorityDirectory,
  municipalityCode: string,
): void {
  const previous = input.previousAccepted;
  if (previous === undefined) return;
  if (!isRecord(previous) || !hasExactKeys(previous, [
    "cityId", "municipalityCode", "sourcePlanId", "definitionId", "publisherId",
    "navigationUrl", "resolvedEvidenceUrl", "referenceYear", "evidenceSnapshotId",
  ]) || previous.cityId !== input.cityId || previous.municipalityCode !== municipalityCode ||
    previous.definitionId !== "si-municipal-police-offences-per-100000@1" ||
    typeof previous.sourcePlanId !== "string" || previous.sourcePlanId.length === 0 ||
    typeof previous.evidenceSnapshotId !== "string" || previous.evidenceSnapshotId.length === 0 ||
    !Number.isSafeInteger(previous.referenceYear)) throw new Error("invalid_city_safety_previous");
  const publisher = publisherById(directory, previous.publisherId);
  if (!urlAllowedByPublisher(previous.navigationUrl, publisher) ||
    !urlAllowedByPublisher(previous.resolvedEvidenceUrl, publisher)) {
    throw new Error("invalid_city_safety_previous");
  }
}

function priorRecoveryReason(attempt: CitySafetyCandidateAttempt | undefined):
  | "unavailable" | "stale" | "empty" | "not_covering_fact" | undefined {
  if (attempt === undefined) return undefined;
  if (attempt.disposition === "usable") return attempt.periodDisposition === "fallback" ? "stale" : undefined;
  if (attempt.reason === "stale") return "stale";
  if (attempt.reason === "scope_mismatch" || attempt.reason === "definition_mismatch") return "not_covering_fact";
  if (attempt.reason === "missing_numerator" || attempt.reason === "denominator_missing") return "empty";
  return "unavailable";
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((byte, index) => byte === right[index]);
}

function sameArtifact(
  left: LiveCapturedArtifact<"si-city-safety">,
  right: LiveCapturedArtifact<"si-city-safety">,
): boolean {
  const { bytes: leftBytes, ...leftMetadata } = left;
  const { bytes: rightBytes, ...rightMetadata } = right;
  return JSON.stringify(leftMetadata) === JSON.stringify(rightMetadata) && sameBytes(leftBytes, rightBytes);
}

function invalidInspection(): never {
  throw new Error("invalid_city_safety_inspection");
}

function isDenseArray(value: unknown): value is unknown[] {
  if (!Array.isArray(value)) return false;
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(value, index)) return false;
  }
  return true;
}

function canonicalString(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalString).join(",")}]`;
  if (isRecord(value)) return `{${Object.keys(value).sort().map((key) =>
    `${JSON.stringify(key)}:${canonicalString(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function hexSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new Uint8Array(bytes).buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function sanitizeFailure(value: unknown): CitySafetyOfficialFailureTrace {
  if (!isRecord(value)) invalidInspection();
  const captureKinds = [
    "timeout", "rate_limited", "server_error", "http_error", "wrong_media_type",
    "too_large", "navigation_mismatch",
  ];
  const keys = ["captureKind"];
  if (value.responseStatus !== undefined) keys.push("responseStatus");
  if (value.responseUrl !== undefined) keys.push("responseUrl");
  if (value.mediaType !== undefined) keys.push("mediaType");
  if (value.rejectedTarget !== undefined) keys.push("rejectedTarget");
  if (!hasExactKeys(value, keys) || !captureKinds.includes(value.captureKind as string) ||
    value.responseStatus !== undefined && (!Number.isSafeInteger(value.responseStatus) ||
      (value.responseStatus as number) < 100 || (value.responseStatus as number) > 599) ||
    value.responseUrl !== undefined && typeof value.responseUrl !== "string" ||
    value.mediaType !== undefined && (typeof value.mediaType !== "string" ||
      value.mediaType.length === 0 || value.mediaType !== value.mediaType.toLowerCase())) invalidInspection();
  const responseUrl = value.responseUrl === undefined
    ? undefined
    : canonicalizeCitySafetyCandidateUrl(value.responseUrl as string);
  let rejectedTarget: CitySafetyOfficialFailureTrace["rejectedTarget"];
  if (value.rejectedTarget !== undefined) {
    if (!isRecord(value.rejectedTarget) || !hasExactKeys(value.rejectedTarget, ["kind", "url"]) ||
      !["untrusted_target", "redirect_loop", "hop_limit"].includes(value.rejectedTarget.kind as string) ||
      typeof value.rejectedTarget.url !== "string") invalidInspection();
    rejectedTarget = {
      kind: value.rejectedTarget.kind as "untrusted_target" | "redirect_loop" | "hop_limit",
      url: canonicalizeCitySafetyCandidateUrl(value.rejectedTarget.url),
    };
  }
  return {
    captureKind: value.captureKind as CitySafetyOfficialFailureTrace["captureKind"],
    ...(value.responseStatus === undefined ? {} : { responseStatus: value.responseStatus as number }),
    ...(responseUrl === undefined ? {} : { responseUrl }),
    ...(value.mediaType === undefined ? {} : { mediaType: value.mediaType as string }),
    ...(rejectedTarget === undefined ? {} : { rejectedTarget }),
  };
}

function sanitizeTrace(
  value: unknown,
  candidate: QueuedCandidate,
  publisher: OfficialPublisherPolicy | undefined,
): CitySafetyOfficialInspectionTrace {
  if (!isRecord(value)) invalidInspection();
  const keys = ["initialUrl", "edges", "officialHops"];
  if (value.lastTrustedUrl !== undefined) keys.push("lastTrustedUrl");
  if (value.failure !== undefined) keys.push("failure");
  if (!hasExactKeys(value, keys) || typeof value.initialUrl !== "string" ||
    canonicalizeCitySafetyCandidateUrl(value.initialUrl) !== candidate.url ||
    !isDenseArray(value.edges) || value.officialHops !== value.edges.length ||
    !Number.isSafeInteger(value.officialHops) || (value.officialHops as number) > OFFICIAL_HOP_LIMIT) {
    invalidInspection();
  }
  let cursor = candidate.url;
  const trustedUrls = new Set([candidate.url]);
  const edges = value.edges.map((edge) => {
    if (!isRecord(edge) || !hasExactKeys(edge, ["kind", "fromUrl", "toUrl"]) ||
      (edge.kind !== "http_redirect" && edge.kind !== "confirmed_document_link") ||
      typeof edge.fromUrl !== "string" || typeof edge.toUrl !== "string") invalidInspection();
    const fromUrl = canonicalizeCitySafetyCandidateUrl(edge.fromUrl);
    const toUrl = canonicalizeCitySafetyCandidateUrl(edge.toUrl);
    if (fromUrl !== cursor || publisher !== undefined &&
      (!urlAllowedByPublisher(fromUrl, publisher) || !urlAllowedByPublisher(toUrl, publisher)) ||
      trustedUrls.has(toUrl)) {
      invalidInspection();
    }
    cursor = toUrl;
    trustedUrls.add(toUrl);
    return { kind: edge.kind as "http_redirect" | "confirmed_document_link", fromUrl, toUrl };
  });
  const lastTrustedUrl = value.lastTrustedUrl === undefined
    ? undefined
    : canonicalizeCitySafetyCandidateUrl(value.lastTrustedUrl as string);
  if (lastTrustedUrl !== undefined && lastTrustedUrl !== cursor ||
    publisher !== undefined && (lastTrustedUrl === undefined ||
      !urlAllowedByPublisher(candidate.url, publisher) || !urlAllowedByPublisher(lastTrustedUrl, publisher))) {
    invalidInspection();
  }
  const failure = value.failure === undefined ? undefined : sanitizeFailure(value.failure);
  if (failure?.responseUrl !== undefined && publisher !== undefined &&
    !urlAllowedByPublisher(failure.responseUrl, publisher) ||
    failure?.responseUrl !== undefined && failure.responseUrl !== lastTrustedUrl) invalidInspection();
  if (failure?.rejectedTarget?.kind === "untrusted_target" && publisher !== undefined &&
    urlAllowedByPublisher(failure.rejectedTarget.url, publisher) ||
    failure?.rejectedTarget?.kind === "redirect_loop" &&
      ![candidate.url, ...edges.map(({ toUrl }) => toUrl)].includes(failure.rejectedTarget.url) ||
    failure?.rejectedTarget?.kind === "hop_limit" && publisher !== undefined &&
      !urlAllowedByPublisher(failure.rejectedTarget.url, publisher) ||
    failure?.rejectedTarget?.kind === "hop_limit" && edges.length !== OFFICIAL_HOP_LIMIT) invalidInspection();
  return {
    initialUrl: candidate.url,
    edges,
    ...(lastTrustedUrl === undefined ? {} : { lastTrustedUrl }),
    officialHops: edges.length,
    ...(failure === undefined ? {} : { failure }),
  };
}

function sanitizeQuantity(value: unknown): CitySafetyUsableCandidateAttempt["quantity"] {
  if (!isRecord(value) || !hasExactKeys(value, ["offenceCount", "population", "rateBasis"]) ||
    typeof value.offenceCount !== "string" || !/^(0|[1-9][0-9]*)$/.test(value.offenceCount) ||
    typeof value.population !== "string" || !/^[1-9][0-9]*$/.test(value.population) ||
    value.rateBasis !== "offences_per_100000_residents") invalidInspection();
  return {
    offenceCount: value.offenceCount,
    population: value.population,
    rateBasis: "offences_per_100000_residents",
  };
}

function sanitizeDenominator(value: unknown): CitySafetyDenominatorReference {
  if (!isRecord(value) || !hasExactKeys(value, [
    "publisherId", "municipalityCode", "referenceDate", "population", "artifactId",
    "mediaType", "retentionPolicyId", "transientRawDeleted",
  ]) || ![value.publisherId, value.municipalityCode, value.referenceDate, value.population,
    value.artifactId, value.mediaType, value.retentionPolicyId].every((item) =>
    typeof item === "string" && item.length > 0) || typeof value.transientRawDeleted !== "boolean") {
    invalidInspection();
  }
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

function sanitizeArtifactReferences(value: unknown): readonly CitySafetyArtifactReference[] {
  if (!isDenseArray(value)) invalidInspection();
  const refs = value.map((ref): CitySafetyArtifactReference => {
    if (!isRecord(ref) || (ref.role !== "municipal_source" && ref.role !== "surs_denominator")) {
      invalidInspection();
    }
    const keys = ref.role === "municipal_source"
      ? ["role", "documentRole", "artifactId", "artifactSha256", "sourceSha256", "locator"]
      : ["role", "artifactId", "artifactSha256", "sourceSha256", "locator"];
    if (!hasExactKeys(ref, keys) || typeof ref.artifactId !== "string" || ref.artifactId.length === 0 ||
      !hexSha256(ref.artifactSha256) || !hexSha256(ref.sourceSha256) ||
      typeof ref.locator !== "string" || (ref.role === "municipal_source" &&
        ref.documentRole !== "navigation" && ref.documentRole !== "terminal_claim")) invalidInspection();
    const common = {
      artifactId: ref.artifactId,
      artifactSha256: ref.artifactSha256,
      sourceSha256: ref.sourceSha256,
      locator: canonicalizeCitySafetyCandidateUrl(ref.locator),
    };
    return ref.role === "municipal_source"
      ? { role: ref.role, documentRole: ref.documentRole as "navigation" | "terminal_claim", ...common }
      : { role: ref.role, ...common };
  });
  if (new Set(refs.map(({ artifactId }) => artifactId)).size !== refs.length) invalidInspection();
  return refs;
}

function validateArtifactOrder(
  kind: "usable" | "rejected",
  reason: CitySafetyCandidateRejectionReason | undefined,
  refs: readonly CitySafetyArtifactReference[],
  trace: CitySafetyOfficialInspectionTrace,
): void {
  const municipal = refs.filter((ref) => ref.role === "municipal_source");
  const denominators = refs.filter((ref) => ref.role === "surs_denominator");
  const terminalIndices = refs.flatMap((ref, index) =>
    ref.role === "municipal_source" && ref.documentRole === "terminal_claim" ? [index] : []);
  const navigationCount = municipal.filter((ref) => ref.documentRole === "navigation").length;
  const confirmedLinks = trace.edges.filter(({ kind: edgeKind }) => edgeKind === "confirmed_document_link");
  if (refs.slice(0, navigationCount).some((ref) =>
    ref.role !== "municipal_source" || ref.documentRole !== "navigation")) {
    throw new Error("invalid_city_safety_inspection");
  }
  const requiresTerminal = kind === "usable" || reason !== undefined && SEMANTIC_REASONS.has(reason);
  if (navigationCount < confirmedLinks.length || navigationCount > confirmedLinks.length + (requiresTerminal ? 0 : 1) ||
    refs.slice(0, confirmedLinks.length).some((ref, index) =>
      ref.role !== "municipal_source" || ref.documentRole !== "navigation" ||
      ref.locator !== confirmedLinks[index]!.fromUrl) ||
    navigationCount === confirmedLinks.length + 1 && refs[navigationCount - 1]?.locator !== trace.lastTrustedUrl ||
    (requiresTerminal && terminalIndices.length !== 1) ||
    (!requiresTerminal && terminalIndices.length !== 0) ||
    (terminalIndices[0] !== undefined && (terminalIndices[0] !== navigationCount ||
      refs[terminalIndices[0]]?.locator !== trace.lastTrustedUrl))) {
    throw new Error("invalid_city_safety_inspection");
  }
  const denominatorRequired = kind === "usable" || kind === "rejected" && reason !== undefined && [
      "stale", "denominator_zero", "denominator_period_mismatch",
      "denominator_scope_mismatch", "conflict",
    ].includes(reason);
  if (denominators.length !== (denominatorRequired ? 1 : 0) ||
    (denominators.length === 1 && refs.at(-1)?.role !== "surs_denominator")) {
    throw new Error("invalid_city_safety_inspection");
  }
}

function sanitizeReviewedOfficial(value: unknown): NonNullable<CitySafetyRejectedCandidateAttempt["reviewedOfficial"]> {
  if (!isRecord(value)) invalidInspection();
  const keys = ["publisherId", "dataAuthorityId", "publisherNavigationUrl"];
  if (value.resolvedEvidenceUrl !== undefined) keys.push("resolvedEvidenceUrl");
  if (value.referenceYear !== undefined) keys.push("referenceYear");
  if (!hasExactKeys(value, keys) || typeof value.publisherId !== "string" ||
    typeof value.dataAuthorityId !== "string" || value.dataAuthorityId.length === 0 ||
    typeof value.publisherNavigationUrl !== "string" ||
    value.resolvedEvidenceUrl !== undefined && typeof value.resolvedEvidenceUrl !== "string" ||
    value.referenceYear !== undefined && !Number.isSafeInteger(value.referenceYear)) invalidInspection();
  return {
    publisherId: value.publisherId,
    dataAuthorityId: value.dataAuthorityId,
    publisherNavigationUrl: canonicalizeCitySafetyCandidateUrl(value.publisherNavigationUrl),
    ...(value.resolvedEvidenceUrl === undefined ? {} : {
      resolvedEvidenceUrl: canonicalizeCitySafetyCandidateUrl(value.resolvedEvidenceUrl as string),
    }),
    ...(value.referenceYear === undefined ? {} : { referenceYear: value.referenceYear as number }),
  };
}

function bindPublisherContext(
  candidate: QueuedCandidate,
  publisher: OfficialPublisherPolicy,
  publisherNavigationUrl: string,
): void {
  const expectedNavigationUrl = candidate.publisherContext?.publisherNavigationUrl ?? publisher.navigationUrl;
  if (candidate.publisherContext !== undefined && candidate.publisherContext.publisherId !== publisher.publisherId ||
    canonicalizeCitySafetyCandidateUrl(publisherNavigationUrl) !==
      canonicalizeCitySafetyCandidateUrl(expectedNavigationUrl) ||
    !urlAllowedByPublisher(publisherNavigationUrl, publisher) || !urlAllowedByPublisher(candidate.url, publisher)) {
    invalidInspection();
  }
}

interface ProjectionBinding {
  readonly candidate: QueuedCandidate;
  readonly kind: "usable" | "rejected";
  readonly reason?: CitySafetyCandidateRejectionReason;
  readonly trace: CitySafetyOfficialInspectionTrace;
  readonly publisherNavigationUrl: string;
  readonly resolvedEvidenceUrl?: string;
  readonly dataAuthorityId?: string;
  readonly referenceYear?: number;
  readonly quantity?: CitySafetyUsableCandidateAttempt["quantity"];
  readonly denominator?: CitySafetyDenominatorReference;
  readonly conflictBasis?: CitySafetyConflictBasis;
}

function sameClosedValue(left: unknown, right: unknown): boolean {
  return canonicalString(left) === canonicalString(right);
}

function validateDenominatorContext(
  denominator: CitySafetyDenominatorReference,
  request: CitySafetyCandidateInspectionInput,
  policy: OfficialPublisherPolicy,
): void {
  if (denominator.artifactId.length === 0 || denominator.retentionPolicyId !== policy.retentionPolicyId ||
    denominator.transientRawDeleted !==
      (policy.retentionMode === "seal_hash_locator_then_delete_transient") ||
    !/^(0|[1-9][0-9]*)$/.test(denominator.population) ||
    !/^\d{4}-01-01$/.test(denominator.referenceDate) ||
    denominator.municipalityCode.length === 0 || denominator.publisherId.length === 0) invalidInspection();
  if (denominator.municipalityCode === request.municipalityCode &&
    denominator.publisherId === request.authorityDirectory.requiredPublisherIds.surs &&
    !policy.allowedMediaTypes.includes(denominator.mediaType) && denominator.mediaType !== "application/json") {
    invalidInspection();
  }
}

function validateRejectionBasis(
  value: unknown,
  binding: ProjectionBinding,
  request: CitySafetyCandidateInspectionInput,
  denominatorPolicy: OfficialPublisherPolicy,
): CitySafetyDenominatorReference | undefined {
  if (!isRecord(value) || value.kind !== binding.reason) invalidInspection();
  const referenceYear = binding.referenceYear;
  if (value.kind === "stale") {
    if (!hasExactKeys(value, ["kind", "referenceYear", "quantity", "denominator"]) ||
      value.referenceYear !== referenceYear) invalidInspection();
    const quantity = sanitizeQuantity(value.quantity);
    const denominator = sanitizeDenominator(value.denominator);
    validateDenominatorContext(denominator, request, denominatorPolicy);
    if (quantity.population !== denominator.population ||
      denominator.referenceDate !== `${String(referenceYear)}-01-01`) invalidInspection();
    return denominator;
  }
  if (value.kind === "scope_mismatch") {
    const keys = ["kind", "observedMunicipalityCodes"];
    if (value.referenceYear !== undefined) keys.push("referenceYear");
    if (value.offenceCount !== undefined) keys.push("offenceCount");
    if (!hasExactKeys(value, keys) || !isDenseArray(value.observedMunicipalityCodes)) invalidInspection();
    const codes = value.observedMunicipalityCodes;
    if (!codes.every((code) => typeof code === "string" && code.length > 0) ||
      new Set(codes).size !== codes.length ||
      [...codes].sort().some((code, index) => code !== codes[index]) ||
      value.referenceYear !== undefined && value.referenceYear !== referenceYear ||
      value.offenceCount !== undefined && (typeof value.offenceCount !== "string" ||
        !/^(0|[1-9][0-9]*)$/.test(value.offenceCount))) invalidInspection();
    return undefined;
  }
  if (value.kind === "definition_mismatch") {
    const keys = ["kind", "observedDefinitionId"];
    if (value.referenceYear !== undefined) keys.push("referenceYear");
    if (value.offenceCount !== undefined) keys.push("offenceCount");
    if (!hasExactKeys(value, keys) || typeof value.observedDefinitionId !== "string" ||
      value.observedDefinitionId.length === 0 || value.referenceYear !== undefined && value.referenceYear !== referenceYear ||
      value.offenceCount !== undefined && (typeof value.offenceCount !== "string" ||
        !/^(0|[1-9][0-9]*)$/.test(value.offenceCount))) invalidInspection();
    return undefined;
  }
  if (value.kind === "missing_numerator") {
    const keys = ["kind"];
    if (value.referenceYear !== undefined) keys.push("referenceYear");
    if (!hasExactKeys(value, keys) || value.referenceYear !== undefined && value.referenceYear !== referenceYear) {
      invalidInspection();
    }
    return undefined;
  }
  if (value.kind === "denominator_missing") {
    if (!hasExactKeys(value, ["kind", "referenceYear", "offenceCount"]) ||
      value.referenceYear !== referenceYear || typeof value.offenceCount !== "string" ||
      !/^(0|[1-9][0-9]*)$/.test(value.offenceCount)) invalidInspection();
    return undefined;
  }
  if (["denominator_zero", "denominator_period_mismatch", "denominator_scope_mismatch"].includes(value.kind as string)) {
    if (!hasExactKeys(value, ["kind", "referenceYear", "offenceCount", "observedDenominator"]) ||
      value.referenceYear !== referenceYear || typeof value.offenceCount !== "string" ||
      !/^(0|[1-9][0-9]*)$/.test(value.offenceCount)) invalidInspection();
    const denominator = sanitizeDenominator(value.observedDenominator);
    validateDenominatorContext(denominator, request, denominatorPolicy);
    if (value.kind === "denominator_zero" && denominator.population !== "0" ||
      value.kind === "denominator_period_mismatch" && denominator.referenceDate === `${String(referenceYear)}-01-01` ||
      value.kind === "denominator_scope_mismatch" && denominator.publisherId ===
        request.authorityDirectory.requiredPublisherIds.surs && denominator.municipalityCode === request.municipalityCode) {
      invalidInspection();
    }
    return denominator;
  }
  if (value.kind === "conflict") {
    if (!hasExactKeys(value, ["kind", "conflictBasis"])) invalidInspection();
    const conflict = sanitizeConflictBasis(value.conflictBasis);
    if (!sameClosedValue(conflict, binding.conflictBasis)) invalidInspection();
    validateDenominatorContext(conflict.denominator, request, denominatorPolicy);
    return conflict.denominator;
  }
  invalidInspection();
}

function sanitizeArtifactRequest(
  value: unknown,
  role: CitySafetyArtifactReference["role"],
): LiveCapturedArtifact<"si-city-safety">["request"] {
  if (!isRecord(value) || typeof value.url !== "string") invalidInspection();
  const url = canonicalizeCitySafetyCandidateUrl(value.url);
  if (value.method === "GET" && hasExactKeys(value, ["method", "url"])) {
    return { method: "GET", url };
  }
  if (role === "surs_denominator" && value.method === "POST" && hasExactKeys(value, [
    "method", "url", "bodyMediaType", "bodySha256",
  ]) && value.bodyMediaType === "application/json" && hexSha256(value.bodySha256)) {
    return {
      method: "POST",
      url,
      bodyMediaType: "application/json",
      bodySha256: value.bodySha256,
    };
  }
  invalidInspection();
}

async function sanitizeArtifacts(
  value: unknown,
  refs: readonly CitySafetyArtifactReference[],
  request: CitySafetyCandidateInspectionInput,
  municipalPublisher: OfficialPublisherPolicy,
  denominatorPublisher: OfficialPublisherPolicy,
  binding: ProjectionBinding,
): Promise<readonly LiveCapturedArtifact<"si-city-safety">[]> {
  if (!isDenseArray(value) || value.length !== refs.length) invalidInspection();
  const sanitized: LiveCapturedArtifact<"si-city-safety">[] = [];
  let projectionDenominator = binding.denominator;
  for (let index = 0; index < value.length; index += 1) {
    const artifact = value[index];
    const ref = refs[index]!;
    if (!isRecord(artifact) || !hasExactKeys(artifact, [
      "artifactId", "runId", "sourceId", "role", "url", "mediaType", "sha256", "bytes",
      "origin", "capturedAt", "responseStatus", "responseUrl", "request",
    ]) || artifact.artifactId !== ref.artifactId || artifact.runId !== request.runId ||
      artifact.sourceId !== "si-city-safety" || artifact.role !== ref.role || artifact.origin !== "live" ||
      typeof artifact.url !== "string" || typeof artifact.responseUrl !== "string" ||
      typeof artifact.mediaType !== "string" || !hexSha256(artifact.sha256) ||
      !(artifact.bytes instanceof Uint8Array) || artifact.sha256 !== ref.artifactSha256 ||
      await sha256Bytes(artifact.bytes) !== artifact.sha256 ||
      canonicalizeCitySafetyCandidateUrl(artifact.url) !== ref.locator ||
      canonicalizeCitySafetyCandidateUrl(artifact.responseUrl) !== ref.locator ||
      !Number.isSafeInteger(artifact.responseStatus) || (artifact.responseStatus as number) < 200 ||
      (artifact.responseStatus as number) >= 300 || typeof artifact.capturedAt !== "string") invalidInspection();
    canonicalInstant(artifact.capturedAt, "invalid_city_safety_inspection");
    const artifactRequest = sanitizeArtifactRequest(artifact.request, ref.role);
    const policy = ref.role === "municipal_source" ? municipalPublisher : denominatorPublisher;
    if (!urlAllowedByPublisher(artifact.url, policy) || !urlAllowedByPublisher(artifact.responseUrl, policy) ||
      !urlAllowedByPublisher(artifactRequest.url, policy)) invalidInspection();
    const isTransient = policy.retentionMode === "seal_hash_locator_then_delete_transient";
    if (!isTransient && (artifact.sha256 !== ref.sourceSha256 ||
      !policy.allowedMediaTypes.includes(artifact.mediaType)) ||
      isTransient && artifact.mediaType !== "application/json") invalidInspection();
    if (isTransient) {
      let projection: unknown;
      try {
        const text = new TextDecoder("utf-8", { fatal: true }).decode(artifact.bytes);
        projection = JSON.parse(text);
        if (text !== canonicalString(projection)) invalidInspection();
      } catch {
        invalidInspection();
      }
      if (!isRecord(projection) || projection.sourceSha256 !== ref.sourceSha256 ||
        projection.sourceLocator !== ref.locator || projection.retentionPolicyId !== policy.retentionPolicyId ||
        projection.transientRawDeleted !== true || typeof projection.sourceMediaType !== "string" ||
        !policy.allowedMediaTypes.includes(projection.sourceMediaType)) invalidInspection();
      const expectedSchema = ref.role === "surs_denominator"
        ? "city-safety-retained-denominator@1"
        : ref.documentRole === "navigation"
          ? "city-safety-retained-navigation@1"
          : "city-safety-retained-inspection@1";
      if (projection.schemaVersion !== expectedSchema) invalidInspection();
      if (ref.role === "municipal_source" && ref.documentRole === "navigation") {
        if (!hasExactKeys(projection, [
          "schemaVersion", "cityId", "municipalityCode", "publisherId", "publisherNavigationUrl",
          "resolvedNavigationUrl", "officialTrace", "confirmedDocumentUrl", "documentLocatorPolicyId",
          "sourceSha256", "sourceLocator", "sourceMediaType", "retentionPolicyId", "transientRawDeleted",
        ]) || projection.cityId !== request.cityId || projection.municipalityCode !== request.municipalityCode ||
          projection.publisherId !== municipalPublisher.publisherId ||
          projection.publisherNavigationUrl !== binding.publisherNavigationUrl ||
          projection.resolvedNavigationUrl !== ref.locator ||
          projection.documentLocatorPolicyId !== municipalPublisher.documentLocatorPolicyId ||
          typeof projection.confirmedDocumentUrl !== "string") invalidInspection();
        const navigationTrace = sanitizeTrace(projection.officialTrace, binding.candidate, municipalPublisher);
        const confirmedEdge = navigationTrace.edges.at(-1);
        const expectedConfirmedUrl = confirmedEdge?.kind === "confirmed_document_link" &&
          confirmedEdge.fromUrl === ref.locator
          ? confirmedEdge.toUrl
          : binding.trace.failure?.rejectedTarget?.url;
        if (navigationTrace.failure !== undefined || navigationTrace.edges.length > binding.trace.edges.length ||
          !navigationTrace.edges.every((edge, edgeIndex) => sameClosedValue(edge, binding.trace.edges[edgeIndex])) ||
          canonicalizeCitySafetyCandidateUrl(projection.confirmedDocumentUrl) !==
            expectedConfirmedUrl) invalidInspection();
      } else if (ref.role === "municipal_source") {
        if (!hasExactKeys(projection, [
          "schemaVersion", "cityId", "municipalityCode", "publisherId", "dataAuthorityId",
          "publisherNavigationUrl", "resolvedEvidenceUrl", "officialTrace", "outcome", "sourceSha256",
          "sourceLocator", "sourceMediaType", "retentionPolicyId", "transientRawDeleted",
        ]) || projection.cityId !== request.cityId || projection.municipalityCode !== request.municipalityCode ||
          projection.publisherId !== municipalPublisher.publisherId ||
          projection.dataAuthorityId !== binding.dataAuthorityId ||
          projection.publisherNavigationUrl !== binding.publisherNavigationUrl ||
          projection.resolvedEvidenceUrl !== binding.resolvedEvidenceUrl ||
          !sameClosedValue(sanitizeTrace(projection.officialTrace, binding.candidate, municipalPublisher), binding.trace) ||
          !isRecord(projection.outcome) || projection.outcome.kind !== binding.kind) invalidInspection();
        if (binding.kind === "usable") {
          if (!hasExactKeys(projection.outcome, ["kind", "referenceYear", "quantity", "denominator"]) ||
            projection.outcome.referenceYear !== binding.referenceYear ||
            !sameClosedValue(sanitizeQuantity(projection.outcome.quantity), binding.quantity) ||
            !sameClosedValue(sanitizeDenominator(projection.outcome.denominator), binding.denominator)) {
            invalidInspection();
          }
          projectionDenominator = sanitizeDenominator(projection.outcome.denominator);
        } else {
          if (!hasExactKeys(projection.outcome, ["kind", "basis"])) invalidInspection();
          projectionDenominator = validateRejectionBasis(
            projection.outcome.basis, binding, request, denominatorPublisher,
          );
        }
      } else {
        if (!hasExactKeys(projection, [
          "schemaVersion", "publisherId", "municipalityCode", "referenceDate", "population",
          "sourceSha256", "sourceLocator", "sourceMediaType", "retentionPolicyId", "transientRawDeleted",
        ]) || projectionDenominator === undefined || ref.artifactId !== projectionDenominator.artifactId ||
          artifact.mediaType !== projectionDenominator.mediaType ||
          projection.publisherId !== projectionDenominator.publisherId ||
          projection.municipalityCode !== projectionDenominator.municipalityCode ||
          projection.referenceDate !== projectionDenominator.referenceDate ||
          projection.population !== projectionDenominator.population) invalidInspection();
      }
    }
    sanitized.push({
      artifactId: artifact.artifactId as string,
      runId: request.runId,
      sourceId: "si-city-safety",
      role: ref.role,
      url: ref.locator,
      mediaType: artifact.mediaType,
      sha256: artifact.sha256,
      bytes: new Uint8Array(artifact.bytes),
      origin: "live",
      capturedAt: artifact.capturedAt,
      responseStatus: artifact.responseStatus as number,
      responseUrl: ref.locator,
      request: artifactRequest,
    });
  }
  return sanitized;
}

function sanitizeConflictBasis(value: unknown): CitySafetyConflictBasis {
  if (!isRecord(value) || !hasExactKeys(value, ["referenceYear", "quantities", "denominator"]) ||
    !Number.isSafeInteger(value.referenceYear) || !isDenseArray(value.quantities) ||
    value.quantities.length !== 2) invalidInspection();
  const quantities = value.quantities.map(sanitizeQuantity) as unknown as
    readonly [CitySafetyUsableCandidateAttempt["quantity"], CitySafetyUsableCandidateAttempt["quantity"]];
  const denominator = sanitizeDenominator(value.denominator);
  if (quantities[0].population !== quantities[1].population ||
    quantities[0].population !== denominator.population ||
    BigInt(quantities[0].offenceCount) >= BigInt(quantities[1].offenceCount)) invalidInspection();
  return { referenceYear: value.referenceYear as number, quantities, denominator };
}

async function validateInspection(
  inspection: unknown,
  candidate: QueuedCandidate,
  request: CitySafetyCandidateInspectionInput,
  directory: OfficialAuthorityDirectory,
): Promise<{
  readonly attempt: CitySafetyCandidateAttempt;
  readonly artifacts: readonly LiveCapturedArtifact<"si-city-safety">[];
}> {
  if (!isRecord(inspection) || !hasExactKeys(inspection, ["kind", "detail", "artifacts"]) ||
    (inspection.kind !== "usable" && inspection.kind !== "rejected") || !isRecord(inspection.detail) ||
    inspection.detail.disposition !== inspection.kind) invalidInspection();
  const refs = sanitizeArtifactReferences(inspection.detail.artifactRefs);
  const denominatorPublisher = publisherById(directory, directory.requiredPublisherIds.surs);
  if (inspection.kind === "rejected") {
    const rejectionReasons = [
      ...CAPTURE_REASONS, ...SEMANTIC_REASONS, "denominator_missing", "denominator_zero",
      "denominator_period_mismatch", "denominator_scope_mismatch", "retention_unapproved",
    ];
    if (!rejectionReasons.includes(inspection.detail.reason as string)) invalidInspection();
    const reason = inspection.detail.reason as CitySafetyCandidateRejectionReason;
    const keys = ["officialTrace", "artifactRefs", "disposition", "reason"];
    if (inspection.detail.reviewedOfficial !== undefined) keys.push("reviewedOfficial");
    if (inspection.detail.mediaType !== undefined) keys.push("mediaType");
    if (inspection.detail.retentionPolicyId !== undefined) keys.push("retentionPolicyId");
    if (inspection.detail.transientRawDeleted !== undefined) keys.push("transientRawDeleted");
    if (inspection.detail.conflictBasis !== undefined) keys.push("conflictBasis");
    if (!hasExactKeys(inspection.detail, keys)) invalidInspection();
    const semantic = !CAPTURE_REASONS.has(reason) && reason !== "retention_unapproved";
    const reviewed = inspection.detail.reviewedOfficial === undefined
      ? undefined
      : sanitizeReviewedOfficial(inspection.detail.reviewedOfficial);
    if ((semantic || refs.length > 0) && reviewed === undefined) invalidInspection();
    const matchingPublishers = directory.publishers.filter((item) => urlAllowedByPublisher(candidate.url, item));
    const publisher = reviewed === undefined
      ? candidate.publisherContext === undefined
        ? matchingPublishers.length === 1 ? matchingPublishers[0] : undefined
        : publisherById(directory, candidate.publisherContext.publisherId)
      : publisherById(directory, reviewed.publisherId);
    if (publisher !== undefined) {
      bindPublisherContext(candidate, publisher,
        reviewed?.publisherNavigationUrl ?? candidate.publisherContext?.publisherNavigationUrl ?? publisher.navigationUrl);
    }
    const trace = sanitizeTrace(inspection.detail.officialTrace, candidate, publisher);
    if (CAPTURE_REASONS.has(reason) !== (trace.failure !== undefined) ||
      reason === "authority_untrusted" && publisher !== undefined && (reviewed === undefined ||
        reviewed.dataAuthorityId === directory.requiredPublisherIds.police) ||
      semantic && reviewed?.dataAuthorityId !== directory.requiredPublisherIds.police ||
      semantic && reviewed?.resolvedEvidenceUrl !== trace.lastTrustedUrl ||
      ["stale", "denominator_missing", "denominator_zero", "denominator_period_mismatch",
        "denominator_scope_mismatch", "conflict"].includes(reason) && reviewed?.referenceYear === undefined ||
      reason === "stale" && classifyCitySafetyPeriod({
        assessmentAt: request.assessmentAt,
        referenceYear: reviewed!.referenceYear!,
      }) !== "stale" ||
      reason === "retention_unapproved" && refs.length !== 0) invalidInspection();
    if (reason === "http_not_found" &&
      (trace.failure?.captureKind !== "http_error" || trace.failure.responseStatus !== 404) ||
      reason === "transport_unavailable" &&
        (!["timeout", "rate_limited", "server_error", "http_error"].includes(trace.failure?.captureKind ?? "") ||
          trace.failure?.captureKind === "http_error" && trace.failure.responseStatus === 404) ||
      reason === "wrong_media_type" && trace.failure?.captureKind !== "wrong_media_type" ||
      reason === "too_large" && trace.failure?.captureKind !== "too_large" ||
      reason === "untrusted_redirect" &&
        (trace.failure?.captureKind !== "navigation_mismatch" || trace.failure.rejectedTarget === undefined) ||
      reason === "authority_untrusted" && trace.failure?.captureKind !== "navigation_mismatch") {
      invalidInspection();
    }
    if (publisher === undefined && (trace.edges.length > 0 || trace.lastTrustedUrl !== undefined || refs.length > 0)) {
      invalidInspection();
    }
    const hasRetentionDecision = refs.length > 0 || inspection.detail.retentionPolicyId !== undefined ||
      inspection.detail.transientRawDeleted !== undefined || inspection.detail.mediaType !== undefined;
    if (publisher !== undefined && hasRetentionDecision &&
      (inspection.detail.retentionPolicyId !== publisher.retentionPolicyId ||
      inspection.detail.transientRawDeleted !==
        (publisher.retentionMode === "seal_hash_locator_then_delete_transient") ||
      typeof inspection.detail.mediaType !== "string" ||
      !publisher.allowedMediaTypes.includes(inspection.detail.mediaType))) invalidInspection();
    validateArtifactOrder("rejected", reason, refs, trace);
    const conflictBasis = inspection.detail.conflictBasis === undefined
      ? undefined
      : sanitizeConflictBasis(inspection.detail.conflictBasis);
    if ((reason === "conflict") !== (conflictBasis !== undefined) || conflictBasis !== undefined &&
      (reviewed?.referenceYear !== conflictBasis.referenceYear ||
        conflictBasis.denominator.publisherId !== directory.requiredPublisherIds.surs ||
        conflictBasis.denominator.municipalityCode !== request.municipalityCode ||
        conflictBasis.denominator.referenceDate !== `${conflictBasis.referenceYear}-01-01` ||
        !refs.some((ref) => ref.role === "surs_denominator" &&
          ref.artifactId === conflictBasis.denominator.artifactId))) invalidInspection();
    if (publisher === undefined && (!isDenseArray(inspection.artifacts) || inspection.artifacts.length !== 0)) {
      invalidInspection();
    }
    const artifacts = publisher === undefined ? [] : await sanitizeArtifacts(
      inspection.artifacts, refs, request, publisher, denominatorPublisher, {
        candidate,
        kind: "rejected",
        reason,
        trace,
        publisherNavigationUrl: reviewed?.publisherNavigationUrl ??
          candidate.publisherContext?.publisherNavigationUrl ?? publisher.navigationUrl,
        resolvedEvidenceUrl: reviewed?.resolvedEvidenceUrl,
        dataAuthorityId: reviewed?.dataAuthorityId,
        referenceYear: reviewed?.referenceYear,
        conflictBasis,
      },
    );
    const attempt: CitySafetyRejectedCandidateAttempt = {
      index: -1,
      origin: candidate.origin,
      canonicalUrl: candidate.url,
      officialTrace: trace,
      ...(reviewed === undefined ? {} : { reviewedOfficial: reviewed }),
      ...(inspection.detail.mediaType === undefined ? {} : { mediaType: inspection.detail.mediaType as string }),
      ...(inspection.detail.retentionPolicyId === undefined ? {} : {
        retentionPolicyId: inspection.detail.retentionPolicyId as string,
      }),
      ...(inspection.detail.transientRawDeleted === undefined ? {} : {
        transientRawDeleted: inspection.detail.transientRawDeleted as boolean,
      }),
      artifactRefs: refs,
      disposition: "rejected",
      reason,
      ...(conflictBasis === undefined ? {} : { conflictBasis }),
    };
    return { attempt, artifacts };
  }

  const detail = inspection.detail;
  if (!hasExactKeys(detail, [
    "publisherId", "dataAuthorityId", "publisherNavigationUrl", "resolvedEvidenceUrl",
    "officialTrace", "mediaType", "retentionPolicyId", "transientRawDeleted", "artifactRefs",
    "disposition", "referenceYear", "periodDisposition", "quantity", "denominator",
  ]) || typeof detail.publisherId !== "string" || typeof detail.dataAuthorityId !== "string" ||
    typeof detail.publisherNavigationUrl !== "string" || typeof detail.resolvedEvidenceUrl !== "string" ||
    typeof detail.mediaType !== "string" || typeof detail.retentionPolicyId !== "string" ||
    typeof detail.transientRawDeleted !== "boolean" || !Number.isSafeInteger(detail.referenceYear) ||
    (detail.periodDisposition !== "preferred" && detail.periodDisposition !== "fallback")) invalidInspection();
    const publisher = publisherById(directory, detail.publisherId);
    bindPublisherContext(candidate, publisher, detail.publisherNavigationUrl);
    const trace = sanitizeTrace(detail.officialTrace, candidate, publisher);
    const quantity = sanitizeQuantity(detail.quantity);
    const denominator = sanitizeDenominator(detail.denominator);
    const expectedDisposition = classifyCitySafetyPeriod({
      assessmentAt: request.assessmentAt,
      referenceYear: detail.referenceYear as number,
    });
    if (trace.failure !== undefined ||
      detail.dataAuthorityId !== directory.requiredPublisherIds.police ||
      !publisher.allowedMediaTypes.includes(detail.mediaType) ||
      detail.retentionPolicyId !== publisher.retentionPolicyId ||
      detail.transientRawDeleted !==
        (publisher.retentionMode === "seal_hash_locator_then_delete_transient") ||
      canonicalizeCitySafetyCandidateUrl(detail.resolvedEvidenceUrl) !== trace.lastTrustedUrl ||
      !urlAllowedByPublisher(detail.resolvedEvidenceUrl, publisher) || expectedDisposition === "stale" ||
      detail.periodDisposition !== expectedDisposition ||
      denominator.publisherId !== directory.requiredPublisherIds.surs ||
      denominator.municipalityCode !== request.municipalityCode ||
      denominator.referenceDate !== `${detail.referenceYear as number}-01-01` ||
      denominator.population !== quantity.population ||
      denominator.retentionPolicyId !== denominatorPublisher.retentionPolicyId ||
      denominator.transientRawDeleted !==
        (denominatorPublisher.retentionMode === "seal_hash_locator_then_delete_transient") ||
      !refs.some((ref) => ref.role === "surs_denominator" && ref.artifactId === denominator.artifactId)) {
      invalidInspection();
    }
    validateArtifactOrder("usable", undefined, refs, trace);
    const artifacts = await sanitizeArtifacts(inspection.artifacts, refs, request, publisher, denominatorPublisher, {
      candidate,
      kind: "usable",
      trace,
      publisherNavigationUrl: canonicalizeCitySafetyCandidateUrl(detail.publisherNavigationUrl),
      resolvedEvidenceUrl: canonicalizeCitySafetyCandidateUrl(detail.resolvedEvidenceUrl),
      dataAuthorityId: detail.dataAuthorityId,
      referenceYear: detail.referenceYear as number,
      quantity,
      denominator,
    });
    const denominatorArtifact = artifacts.find(({ artifactId }) => artifactId === denominator.artifactId);
    if (denominatorArtifact?.mediaType !== denominator.mediaType) invalidInspection();
    const attempt: CitySafetyUsableCandidateAttempt = {
      index: -1,
      origin: candidate.origin,
      canonicalUrl: candidate.url,
      publisherId: publisher.publisherId,
      dataAuthorityId: directory.requiredPublisherIds.police,
      publisherNavigationUrl: canonicalizeCitySafetyCandidateUrl(detail.publisherNavigationUrl),
      resolvedEvidenceUrl: canonicalizeCitySafetyCandidateUrl(detail.resolvedEvidenceUrl),
      officialTrace: trace,
      mediaType: detail.mediaType,
      retentionPolicyId: publisher.retentionPolicyId,
      transientRawDeleted: detail.transientRawDeleted,
      artifactRefs: refs,
      disposition: "usable",
      referenceYear: detail.referenceYear as number,
      periodDisposition: detail.periodDisposition,
      quantity,
      denominator,
    };
    return { attempt, artifacts };
}

function validateSearchResponse(value: unknown, resultLimit: number): {
  readonly kind: "completed";
  readonly providerId: string;
  readonly urls: readonly string[];
} | {
  readonly kind: "unavailable";
  readonly providerId: string;
  readonly reason: "provider_unavailable" | "search_provider_unconfigured";
} {
  if (!isRecord(value) || typeof value.providerId !== "string" || value.providerId.length === 0) {
    throw new Error("invalid_city_safety_search_response");
  }
  if (value.kind === "completed") {
    if (!hasExactKeys(value, ["kind", "providerId", "urls"]) || !Array.isArray(value.urls) ||
      value.urls.length > resultLimit || !value.urls.every((url) => typeof url === "string")) {
      throw new Error("invalid_city_safety_search_response");
    }
    value.urls.forEach(canonicalizeCitySafetyCandidateUrl);
    return value as { readonly kind: "completed"; readonly providerId: string; readonly urls: readonly string[] };
  }
  if (value.kind === "unavailable" && hasExactKeys(value, ["kind", "providerId", "reason"]) &&
    (value.reason === "provider_unavailable" || value.reason === "search_provider_unconfigured")) {
    return value as {
      readonly kind: "unavailable";
      readonly providerId: string;
      readonly reason: "provider_unavailable" | "search_provider_unconfigured";
    };
  }
  throw new Error("invalid_city_safety_search_response");
}

function immutable<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) immutable(child);
  }
  return value;
}

export async function runCitySafetyDiscovery(
  input: RunCitySafetyDiscoveryInput,
  ports: Parameters<typeof executeDiscovery>[1],
): Promise<CitySafetyDiscoveryResult> {
  return executeDiscovery(input, ports);
}

async function executeDiscovery(
  input: RunCitySafetyDiscoveryInput,
  ports: {
    readonly search: import("./city-safety-contracts").CitySafetySearchPort;
    readonly officialDocuments: import("./city-safety-contracts").CitySafetyOfficialDocumentPort;
    readonly officialDiscovery?: CitySafetyOfficialDiscoveryPort;
    readonly clock: () => Date;
  },
): Promise<CitySafetyDiscoveryResult> {
  abortIfNeeded(input.signal);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(input.runId)) throw new Error("invalid_city_safety_run_id");
  canonicalInstant(input.assessmentAt, "invalid_assessment_at");
  const directory = reconstructOfficialAuthorityDirectory(input.authorityDirectory, input.catalog, input.integrity);
  const plan = reconstructCitySafetySourcePlan(input.sourcePlan, input.catalog, directory, input.integrity);
  const entry = plan.entries.find(({ cityId }) => cityId === input.cityId);
  if (entry === undefined) throw new Error("invalid_city_safety_city");
  validatePrevious(input, directory, entry.municipalityCode);
  const queries = buildCitySafetyQueries(entry, directory, input.assessmentAt, input.catalog, input.integrity);
  const queue: QueuedCandidate[] = [];
  if (input.previousAccepted !== undefined) {
    queue.push({
      url: canonicalizeCitySafetyCandidateUrl(input.previousAccepted.resolvedEvidenceUrl),
      origin: {
        kind: "previous",
        priorSourcePlanId: input.previousAccepted.sourcePlanId,
        priorEvidenceSnapshotId: input.previousAccepted.evidenceSnapshotId,
      },
      publisherContext: {
        publisherId: input.previousAccepted.publisherId,
        publisherNavigationUrl: input.previousAccepted.navigationUrl,
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

  const seen = new Set<string>();
  const candidateAttempts: CitySafetyCandidateAttempt[] = [];
  const queryAttempts: CitySafetyQueryAttempt[] = [];
  const artifactsById = new Map<string, LiveCapturedArtifact<"si-city-safety">>();
  let queueIndex = 0;
  let acceptedPreferred: CitySafetyUsableCandidateAttempt | undefined;
  let firstFallback: CitySafetyUsableCandidateAttempt | undefined;

  const inspectQueued = async (): Promise<void> => {
    while (queueIndex < queue.length && candidateAttempts.length < MAX_CANDIDATES &&
      acceptedPreferred === undefined) {
      abortIfNeeded(input.signal);
      const candidate = queue[queueIndex++]!;
      if (seen.has(candidate.url)) continue;
      seen.add(candidate.url);
      const request: CitySafetyCandidateInspectionInput = {
        runId: input.runId,
        cityId: input.cityId,
        municipalityCode: entry.municipalityCode,
        candidateUrl: candidate.url,
        ...(candidate.publisherContext === undefined ? {} : { publisherContext: candidate.publisherContext }),
        officialHopLimit: OFFICIAL_HOP_LIMIT,
        assessmentAt: input.assessmentAt,
        authorityDirectory: directory,
        signal: input.signal,
      };
      const inspection = await ports.officialDocuments.inspect(request);
      abortIfNeeded(input.signal);
      const validated = await validateInspection(inspection, candidate, request, directory);
      const indexed = { ...validated.attempt, index: candidateAttempts.length } as CitySafetyCandidateAttempt;
      candidateAttempts.push(indexed);
      for (const artifact of validated.artifacts) {
        const existing = artifactsById.get(artifact.artifactId);
        if (existing !== undefined && !sameArtifact(existing, artifact)) {
          throw new Error("city_safety_artifact_conflict");
        }
        if (existing === undefined) artifactsById.set(artifact.artifactId, artifact);
      }
      if (indexed.disposition === "usable") {
        if (indexed.periodDisposition === "preferred") acceptedPreferred = indexed;
        else firstFallback ??= indexed;
      }
    }
  };

  await inspectQueued();
  const previousAttempt = candidateAttempts.find((attempt) => attempt.origin.kind === "previous");
  const recoveryReason = input.previousAccepted === undefined ? undefined : priorRecoveryReason(previousAttempt);
  if (recoveryReason !== undefined && acceptedPreferred === undefined && ports.officialDiscovery !== undefined &&
    candidateAttempts.length < MAX_CANDIDATES) {
    const discovery = await ports.officialDiscovery.discover({
      runId: input.runId,
      catalog: input.catalog,
      integrity: input.integrity,
      sourcePlan: input.sourcePlan,
      authorityDirectory: input.authorityDirectory,
      cityId: input.cityId,
      failedUrl: previousAttempt!.canonicalUrl,
      reason: recoveryReason,
      signal: input.signal,
    });
    abortIfNeeded(input.signal);
    if (discovery.kind === "candidates") {
      discovery.urls.forEach((url) => queue.push({
        url: canonicalizeCitySafetyCandidateUrl(url),
        origin: { kind: "search", queryId: `official-source-recovery:${input.runId}` },
      }));
      await inspectQueued();
    }
  }
  for (let queryIndex = 0;
    queryIndex < queries.length && candidateAttempts.length < MAX_CANDIDATES && acceptedPreferred === undefined;
    queryIndex += 1) {
    if (recoveryReason !== undefined && ports.officialDiscovery !== undefined) break;
    abortIfNeeded(input.signal);
    const queryId = `city-safety-query:${input.runId}:${queryIndex + 1}`;
    const searchedAt = clockInstant(ports.clock);
    abortIfNeeded(input.signal);
    const resultLimit = MAX_CANDIDATES - candidateAttempts.length;
    const response = validateSearchResponse(await ports.search.search({
      queryId,
      query: queries[queryIndex]!,
      resultLimit,
      signal: input.signal,
    }), resultLimit);
    abortIfNeeded(input.signal);
    queryAttempts.push({
      index: queryIndex,
      queryId,
      queryTemplateVersion: "slovenia-municipal-safety-query@1",
      providerId: response.providerId,
      query: queries[queryIndex]!,
      searchedAt,
      outcome: response.kind === "completed"
        ? { kind: "completed", returnedUrls: [...response.urls] }
        : { kind: "unavailable", reason: response.reason },
    });
    if (response.kind === "completed") {
      response.urls.forEach((url) => queue.push({
        url: canonicalizeCitySafetyCandidateUrl(url),
        origin: { kind: "search", queryId },
      }));
      await inspectQueued();
    }
  }
  const completedAt = clockInstant(ports.clock);
  const hasFallbackConflict = candidateAttempts.some((attempt, index) =>
    attempt.disposition === "usable" && attempt.periodDisposition === "fallback" &&
    candidateAttempts.slice(index + 1).some((other) => other.disposition === "usable" &&
      other.periodDisposition === "fallback" && other.referenceYear === attempt.referenceYear &&
      (other.quantity.offenceCount !== attempt.quantity.offenceCount ||
        other.quantity.population !== attempt.quantity.population)));
  const accepted = acceptedPreferred ?? (hasFallbackConflict ? undefined : firstFallback);
  const result = accepted === undefined
    ? { kind: "unknown" as const, reason: chooseCitySafetyUnknownReason(candidateAttempts, queryAttempts) }
    : {
        kind: "verified" as const,
        quantity: accepted.quantity,
        referenceYear: accepted.referenceYear,
        acceptedCandidateIndex: accepted.index,
      };
  const ledger = immutable({
    schemaVersion: "city-safety-attempt-ledger@1" as const,
    catalogRevisionId: input.catalog.id,
    authorityDirectoryId: directory.id,
    sourcePlanId: plan.id,
    cityId: input.cityId,
    municipalityCode: entry.municipalityCode,
    assessmentAt: input.assessmentAt,
    definitionId: plan.definitionId,
    freshnessPolicyVersion: plan.freshnessPolicyVersion,
    discoveryRulesVersion: plan.discoveryRulesVersion,
    queries: queryAttempts,
    candidates: candidateAttempts,
    counters: {
      queries: queryAttempts.length,
      candidates: candidateAttempts.length,
      maxOfficialHops: candidateAttempts.reduce(
        (maximum, attempt) => Math.max(maximum, attempt.officialTrace.officialHops), 0),
    },
    result,
    completedAt,
  });
  return { ledger, artifacts: [...artifactsById.values()] };
}
