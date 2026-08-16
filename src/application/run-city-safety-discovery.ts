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
  CitySafetyQueryAttempt,
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
  CitySafetyCandidateInspection,
  CitySafetyCandidateInspectionInput,
  CitySafetyDiscoveryResult,
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

function validateTrace(
  inspection: CitySafetyCandidateInspection,
  candidate: QueuedCandidate,
  directory: OfficialAuthorityDirectory,
): void {
  const trace = inspection.detail.officialTrace;
  if (!isRecord(trace) || canonicalizeCitySafetyCandidateUrl(trace.initialUrl) !== candidate.url ||
    !Array.isArray(trace.edges) || trace.officialHops !== trace.edges.length ||
    trace.officialHops > OFFICIAL_HOP_LIMIT) throw new Error("invalid_city_safety_inspection");
  let cursor = candidate.url;
  for (const edge of trace.edges) {
    if (!isRecord(edge) || (edge.kind !== "http_redirect" && edge.kind !== "confirmed_document_link") ||
      typeof edge.fromUrl !== "string" || typeof edge.toUrl !== "string" ||
      canonicalizeCitySafetyCandidateUrl(edge.fromUrl) !== cursor) {
      throw new Error("invalid_city_safety_inspection");
    }
    cursor = canonicalizeCitySafetyCandidateUrl(edge.toUrl);
  }
  if (trace.lastTrustedUrl !== undefined && canonicalizeCitySafetyCandidateUrl(trace.lastTrustedUrl) !== cursor) {
    throw new Error("invalid_city_safety_inspection");
  }
  const reviewed = inspection.kind === "usable" ? inspection.detail : inspection.detail.reviewedOfficial;
  if (reviewed !== undefined) {
    const publisher = publisherById(directory, reviewed.publisherId);
    if (!urlAllowedByPublisher(cursor, publisher) ||
      trace.edges.some((edge) => !urlAllowedByPublisher(edge.fromUrl, publisher) ||
        !urlAllowedByPublisher(edge.toUrl, publisher))) throw new Error("invalid_city_safety_inspection");
  }
}

function validateArtifactReferences(
  refs: readonly CitySafetyArtifactReference[],
  artifacts: readonly LiveCapturedArtifact<"si-city-safety">[],
): void {
  if (!Array.isArray(refs) || !Array.isArray(artifacts)) throw new Error("invalid_city_safety_inspection");
  const artifactsById = new Map(artifacts.map((artifact) => [artifact.artifactId, artifact]));
  if (artifactsById.size !== artifacts.length || refs.length !== artifacts.length) {
    throw new Error("invalid_city_safety_inspection");
  }
  for (const ref of refs) {
    const artifact = artifactsById.get(ref.artifactId);
    if (artifact === undefined || artifact.sha256 !== ref.artifactSha256 || artifact.url !== ref.locator) {
      throw new Error("invalid_city_safety_inspection");
    }
  }
  if (new Set(refs.map(({ artifactId }) => artifactId)).size !== refs.length) {
    throw new Error("invalid_city_safety_inspection");
  }
}

function validateArtifactOrder(inspection: CitySafetyCandidateInspection): void {
  const refs = inspection.detail.artifactRefs;
  const municipal = refs.filter((ref) => ref.role === "municipal_source");
  const denominators = refs.filter((ref) => ref.role === "surs_denominator");
  const terminalIndices = refs.flatMap((ref, index) =>
    ref.role === "municipal_source" && ref.documentRole === "terminal_claim" ? [index] : []);
  const navigationCount = municipal.filter((ref) => ref.documentRole === "navigation").length;
  if (refs.slice(0, navigationCount).some((ref) =>
    ref.role !== "municipal_source" || ref.documentRole !== "navigation")) {
    throw new Error("invalid_city_safety_inspection");
  }
  const requiresTerminal = inspection.kind === "usable" ||
    SEMANTIC_REASONS.has(inspection.detail.reason);
  if ((requiresTerminal && terminalIndices.length !== 1) ||
    (!requiresTerminal && terminalIndices.length !== 0) ||
    (terminalIndices[0] !== undefined && terminalIndices[0] !== navigationCount)) {
    throw new Error("invalid_city_safety_inspection");
  }
  const denominatorRequired = inspection.kind === "usable" ||
    (inspection.kind === "rejected" && [
      "stale", "denominator_zero", "denominator_period_mismatch",
      "denominator_scope_mismatch", "conflict",
    ].includes(inspection.detail.reason));
  if (denominators.length !== (denominatorRequired ? 1 : 0) ||
    (denominators.length === 1 && refs.at(-1)?.role !== "surs_denominator")) {
    throw new Error("invalid_city_safety_inspection");
  }
}

function validateInspection(
  inspection: CitySafetyCandidateInspection,
  candidate: QueuedCandidate,
  request: CitySafetyCandidateInspectionInput,
  directory: OfficialAuthorityDirectory,
): CitySafetyCandidateAttempt {
  if (!isRecord(inspection) || !hasExactKeys(inspection, ["kind", "detail", "artifacts"]) ||
    (inspection.kind !== "usable" && inspection.kind !== "rejected") || !isRecord(inspection.detail) ||
    inspection.detail.disposition !== inspection.kind || !Array.isArray(inspection.artifacts)) {
    throw new Error("invalid_city_safety_inspection");
  }
  validateTrace(inspection, candidate, directory);
  validateArtifactReferences(inspection.detail.artifactRefs, inspection.artifacts);
  validateArtifactOrder(inspection);
  for (const artifact of inspection.artifacts) {
    if (!isRecord(artifact) || artifact.runId !== request.runId || artifact.sourceId !== "si-city-safety" ||
      artifact.origin !== "live") throw new Error("invalid_city_safety_inspection");
  }
  if (inspection.kind === "rejected") {
    if (CAPTURE_REASONS.has(inspection.detail.reason) && inspection.detail.officialTrace.failure === undefined ||
      SEMANTIC_REASONS.has(inspection.detail.reason) && inspection.detail.officialTrace.failure !== undefined ||
      (inspection.detail.reason === "conflict") !== (inspection.detail.conflictBasis !== undefined) ||
      inspection.detail.reason === "retention_unapproved" && inspection.detail.artifactRefs.length !== 0) {
      throw new Error("invalid_city_safety_inspection");
    }
    if (inspection.detail.reason === "conflict" &&
      inspection.detail.reviewedOfficial?.dataAuthorityId !== directory.requiredPublisherIds.police) {
      throw new Error("invalid_city_safety_inspection");
    }
  } else {
    const detail = inspection.detail;
    const publisher = publisherById(directory, detail.publisherId);
    const denominatorPublisher = publisherById(directory, directory.requiredPublisherIds.surs);
    const denominatorArtifact = inspection.artifacts.find(({ artifactId }) =>
      artifactId === detail.denominator.artifactId);
    const expectedDisposition = classifyCitySafetyPeriod({
      assessmentAt: request.assessmentAt,
      referenceYear: detail.referenceYear,
    });
    if (candidate.publisherContext !== undefined &&
      (detail.publisherId !== candidate.publisherContext.publisherId ||
        detail.publisherNavigationUrl !== candidate.publisherContext.publisherNavigationUrl) ||
      detail.dataAuthorityId !== directory.requiredPublisherIds.police ||
      detail.retentionPolicyId !== publisher.retentionPolicyId ||
      detail.transientRawDeleted !==
        (publisher.retentionMode === "seal_hash_locator_then_delete_transient") ||
      canonicalizeCitySafetyCandidateUrl(detail.resolvedEvidenceUrl) !==
        canonicalizeCitySafetyCandidateUrl(detail.officialTrace.lastTrustedUrl ?? "") ||
      !urlAllowedByPublisher(detail.resolvedEvidenceUrl, publisher) || expectedDisposition === "stale" ||
      detail.periodDisposition !== expectedDisposition || !/^(0|[1-9][0-9]*)$/.test(detail.quantity.offenceCount) ||
      !/^[1-9][0-9]*$/.test(detail.quantity.population) ||
      detail.quantity.rateBasis !== "offences_per_100000_residents" ||
      detail.denominator.publisherId !== directory.requiredPublisherIds.surs ||
      detail.denominator.municipalityCode !== request.municipalityCode ||
      detail.denominator.referenceDate !== `${detail.referenceYear}-01-01` ||
      detail.denominator.population !== detail.quantity.population ||
      detail.denominator.retentionPolicyId !== denominatorPublisher.retentionPolicyId ||
      detail.denominator.transientRawDeleted !==
        (denominatorPublisher.retentionMode === "seal_hash_locator_then_delete_transient") ||
      denominatorArtifact?.mediaType !== detail.denominator.mediaType ||
      !detail.artifactRefs.some((ref) =>
        ref.role === "surs_denominator" && ref.artifactId === detail.denominator.artifactId)) {
      throw new Error("invalid_city_safety_inspection");
    }
  }
  return {
    index: -1,
    origin: candidate.origin,
    canonicalUrl: candidate.url,
    ...inspection.detail,
  } as CitySafetyCandidateAttempt;
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
      const attempt = validateInspection(inspection, candidate, request, directory);
      const indexed = { ...attempt, index: candidateAttempts.length } as CitySafetyCandidateAttempt;
      candidateAttempts.push(indexed);
      for (const artifact of inspection.artifacts) {
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
  for (let queryIndex = 0;
    queryIndex < queries.length && candidateAttempts.length < MAX_CANDIDATES && acceptedPreferred === undefined;
    queryIndex += 1) {
    abortIfNeeded(input.signal);
    const queryId = `city-safety-query:${input.runId}:${queryIndex + 1}`;
    const searchedAt = clockInstant(ports.clock);
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
