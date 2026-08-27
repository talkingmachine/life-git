import type { CityCatalogRevision } from "../decision/city-catalog";
import type { CityDecisionIntegrity } from "../decision/city-integrity";
import type { LiveCapturedArtifact } from "./contracts";
import { canonicalizeCitySafetyCandidateUrl } from "./city-safety-discovery";
import {
  reconstructCitySafetyAttemptLedger,
  type CitySafetyArtifactReference,
  type CitySafetyAttemptLedger,
  type CitySafetyCandidateAttempt,
  type CitySafetyDenominatorReference,
  type CitySafetyPreviousAcceptedReference,
} from "./city-safety-evidence";
import type { CityEvidenceReplayIntegrity } from "./city-evidence";
import {
  reconstructCitySafetySourcePlan,
  reconstructOfficialAuthorityDirectory,
  type CitySafetySourcePlan,
  type OfficialAuthorityDirectory,
  type OfficialPublisherPolicy,
} from "./city-safety-source-plan";

export interface CitySafetyArtifactBridgeInput {
  readonly cityCheckRunId: string;
  readonly catalog: CityCatalogRevision;
  readonly sourcePlan: CitySafetySourcePlan;
  readonly authorityDirectory: OfficialAuthorityDirectory;
  readonly previousAccepted?: CitySafetyPreviousAcceptedReference;
  readonly ledger: CitySafetyAttemptLedger;
  readonly artifacts: readonly LiveCapturedArtifact<"si-city-safety">[];
}

export interface CitySafetyArtifactBridge {
  readonly ledger: CitySafetyAttemptLedger;
  readonly artifacts: readonly LiveCapturedArtifact<"si-city-safety">[];
}

const ARTIFACT_KEYS = [
  "artifactId", "runId", "sourceId", "role", "url", "mediaType", "sha256", "bytes",
  "origin", "capturedAt", "responseStatus", "responseUrl", "request",
] as const;
const COMMON_PROJECTION_KEYS = [
  "sourceSha256", "sourceLocator", "sourceMediaType", "retentionPolicyId",
  "transientRawDeleted",
] as const;
const DENOMINATOR_KEYS = [
  "publisherId", "municipalityCode", "referenceDate", "population", "artifactId", "mediaType",
  "retentionPolicyId", "transientRawDeleted",
] as const;
const SHA256 = /^[a-f0-9]{64}$/;

function mismatch(): never {
  throw new Error("integrity_mismatch");
}

function exactReplayIntegrity(value: unknown): value is CityEvidenceReplayIntegrity {
  if (value === null || typeof value !== "object") return false;
  const keys = Reflect.ownKeys(value);
  return keys.length === 3 && ["canonical", "hash", "hashBytes"].every(
    (key) => keys.includes(key),
  ) && typeof (value as CityEvidenceReplayIntegrity).canonical === "function" &&
    typeof (value as CityEvidenceReplayIntegrity).hash === "function" &&
    typeof (value as CityEvidenceReplayIntegrity).hashBytes === "function";
}

function decisionIntegrityView(
  integrity: CityEvidenceReplayIntegrity,
): CityDecisionIntegrity {
  const view: CityDecisionIntegrity = Object.freeze({
    canonical(value: unknown): string {
      return integrity.canonical.call(view, value);
    },
    hash(canonicalText: string): string {
      return integrity.hash.call(view, canonicalText);
    },
  });
  return view;
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
  if (Object.getOwnPropertySymbols(value).length !== 0) return false;
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index]);
}

function canonicalInstant(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    return new Date(value).toISOString() === value;
  } catch {
    return false;
  }
}

function canonicalUrl(value: unknown): string {
  if (typeof value !== "string") mismatch();
  const canonical = canonicalizeCitySafetyCandidateUrl(value);
  if (canonical !== value) mismatch();
  return canonical;
}

function deepFreeze<T>(value: T): T {
  if (ArrayBuffer.isView(value)) return value;
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function immutableCopy<T>(value: T): T {
  return deepFreeze(structuredClone(value));
}

function sameCanonical(
  left: unknown,
  right: unknown,
  integrity: CityEvidenceReplayIntegrity,
): boolean {
  try {
    return integrity.canonical(left) === integrity.canonical(right);
  } catch {
    return false;
  }
}

function urlAllowed(value: string, publisher: OfficialPublisherPolicy): boolean {
  const host = new URL(value).hostname;
  return publisher.allowedHosts.includes(host) || publisher.delegatedDocumentHosts.includes(host);
}

function publisherById(
  directory: OfficialAuthorityDirectory,
  publisherId: string,
): OfficialPublisherPolicy {
  const matches = directory.publishers.filter((publisher) => publisher.publisherId === publisherId);
  if (matches.length !== 1) mismatch();
  return matches[0]!;
}

function municipalPublisher(
  candidate: CitySafetyCandidateAttempt,
  plan: CitySafetySourcePlan,
  directory: OfficialAuthorityDirectory,
  cityId: string,
): OfficialPublisherPolicy {
  if (candidate.disposition === "usable") return publisherById(directory, candidate.publisherId);
  if (candidate.reviewedOfficial !== undefined) {
    return publisherById(directory, candidate.reviewedOfficial.publisherId);
  }
  if (candidate.origin.kind === "configured") {
    const entry = plan.entries.find((candidateEntry) => candidateEntry.cityId === cityId);
    const route = entry?.configuredRoutes[candidate.origin.configuredRouteIndex];
    if (route !== undefined) return publisherById(directory, route.publisherId);
  }
  const matching = directory.publishers.filter((publisher) =>
    urlAllowed(candidate.canonicalUrl, publisher));
  if (matching.length !== 1) mismatch();
  return matching[0]!;
}

function validateRequest(
  value: unknown,
  role: CitySafetyArtifactReference["role"],
  publisher: OfficialPublisherPolicy,
  expectedUrl: string,
): LiveCapturedArtifact<"si-city-safety">["request"] {
  if (!record(value)) mismatch();
  if (value.method === "GET" && exactKeys(value, ["method", "url"])) {
    const url = canonicalUrl(value.url);
    if (url !== expectedUrl || !urlAllowed(url, publisher)) mismatch();
    return { method: "GET", url };
  }
  if (role === "surs_denominator" && value.method === "POST" &&
    exactKeys(value, ["method", "url", "bodyMediaType", "bodySha256"]) &&
    value.bodyMediaType === "application/json" && typeof value.bodySha256 === "string" &&
    SHA256.test(value.bodySha256)) {
    const url = canonicalUrl(value.url);
    if (url !== expectedUrl || !urlAllowed(url, publisher)) mismatch();
    return {
      method: "POST",
      url,
      bodyMediaType: "application/json",
      bodySha256: value.bodySha256,
    };
  }
  mismatch();
}

function municipalRequestUrls(
  candidate: CitySafetyCandidateAttempt,
): ReadonlyMap<CitySafetyArtifactReference, string> {
  const expected = new Map<CitySafetyArtifactReference, string>();
  const confirmedLinks = candidate.officialTrace.edges.filter(
    ({ kind }) => kind === "confirmed_document_link",
  );
  let confirmedIndex = 0;
  let captureStartUrl = candidate.officialTrace.initialUrl;
  for (const reference of candidate.artifactRefs) {
    if (reference.role !== "municipal_source") continue;
    const confirmed = confirmedLinks[confirmedIndex];
    if (reference.documentRole === "navigation" && confirmed !== undefined) {
      if (reference.locator !== confirmed.fromUrl) mismatch();
      expected.set(reference, captureStartUrl);
      captureStartUrl = confirmed.toUrl;
      confirmedIndex += 1;
      continue;
    }
    expected.set(reference, captureStartUrl);
  }
  if (confirmedIndex !== confirmedLinks.length) mismatch();
  return expected;
}

function validateDenominator(
  value: unknown,
  policy: OfficialPublisherPolicy,
): CitySafetyDenominatorReference {
  if (!record(value) || !exactKeys(value, DENOMINATOR_KEYS) ||
    typeof value.publisherId !== "string" || typeof value.municipalityCode !== "string" ||
    typeof value.referenceDate !== "string" || !/^\d{4}-01-01$/.test(value.referenceDate) ||
    typeof value.population !== "string" || !/^(0|[1-9][0-9]*)$/.test(value.population) ||
    typeof value.artifactId !== "string" || value.artifactId.length === 0 ||
    typeof value.mediaType !== "string" || value.retentionPolicyId !== policy.retentionPolicyId ||
    value.transientRawDeleted !==
      (policy.retentionMode === "seal_hash_locator_then_delete_transient")) mismatch();
  return value as unknown as CitySafetyDenominatorReference;
}

function validateQuantity(value: unknown): void {
  if (!record(value) || !exactKeys(value, ["offenceCount", "population", "rateBasis"]) ||
    typeof value.offenceCount !== "string" || !/^(0|[1-9][0-9]*)$/.test(value.offenceCount) ||
    typeof value.population !== "string" || !/^[1-9][0-9]*$/.test(value.population) ||
    value.rateBasis !== "offences_per_100000_residents") mismatch();
}

function validateConflictBasis(
  value: unknown,
  denominatorPolicy: OfficialPublisherPolicy,
): CitySafetyDenominatorReference {
  if (!record(value) || !exactKeys(value, ["referenceYear", "quantities", "denominator"]) ||
    !Number.isSafeInteger(value.referenceYear) || !denseArray(value.quantities) ||
    value.quantities.length !== 2) mismatch();
  value.quantities.forEach(validateQuantity);
  return validateDenominator(value.denominator, denominatorPolicy);
}

function validateRejectionBasis(
  value: unknown,
  candidate: Extract<CitySafetyCandidateAttempt, { readonly disposition: "rejected" }>,
  denominatorPolicy: OfficialPublisherPolicy,
  municipalityCode: string,
  integrity: CityEvidenceReplayIntegrity,
): CitySafetyDenominatorReference | undefined {
  if (!record(value) || value.kind !== candidate.reason) mismatch();
  const referenceYear = candidate.reviewedOfficial?.referenceYear;
  if (value.kind === "stale") {
    if (!exactKeys(value, ["kind", "referenceYear", "quantity", "denominator"]) ||
      value.referenceYear !== referenceYear) mismatch();
    validateQuantity(value.quantity);
    const denominator = validateDenominator(value.denominator, denominatorPolicy);
    if ((value.quantity as Record<string, unknown>).population !== denominator.population ||
      denominator.referenceDate !== `${String(referenceYear)}-01-01`) mismatch();
    return denominator;
  }
  if (value.kind === "scope_mismatch") {
    const keys = ["kind", "observedMunicipalityCodes"];
    if (value.referenceYear !== undefined) keys.push("referenceYear");
    if (value.offenceCount !== undefined) keys.push("offenceCount");
    if (!exactKeys(value, keys) || !denseArray(value.observedMunicipalityCodes)) mismatch();
    const observedMunicipalityCodes = value.observedMunicipalityCodes;
    if (!observedMunicipalityCodes.every((code) => typeof code === "string" && code.length > 0) ||
      new Set(observedMunicipalityCodes).size !== observedMunicipalityCodes.length ||
      [...observedMunicipalityCodes].sort().some((code, index) =>
        code !== observedMunicipalityCodes[index]) ||
      value.referenceYear !== undefined && value.referenceYear !== referenceYear ||
      value.offenceCount !== undefined && (typeof value.offenceCount !== "string" ||
        !/^(0|[1-9][0-9]*)$/.test(value.offenceCount))) mismatch();
    return undefined;
  }
  if (value.kind === "definition_mismatch") {
    const keys = ["kind", "observedDefinitionId"];
    if (value.referenceYear !== undefined) keys.push("referenceYear");
    if (value.offenceCount !== undefined) keys.push("offenceCount");
    if (!exactKeys(value, keys) || typeof value.observedDefinitionId !== "string" ||
      value.observedDefinitionId.length === 0 ||
      value.referenceYear !== undefined && value.referenceYear !== referenceYear ||
      value.offenceCount !== undefined && (typeof value.offenceCount !== "string" ||
        !/^(0|[1-9][0-9]*)$/.test(value.offenceCount))) mismatch();
    return undefined;
  }
  if (value.kind === "missing_numerator") {
    const keys = ["kind"];
    if (value.referenceYear !== undefined) keys.push("referenceYear");
    if (!exactKeys(value, keys) ||
      value.referenceYear !== undefined && value.referenceYear !== referenceYear) mismatch();
    return undefined;
  }
  if (value.kind === "denominator_missing") {
    if (!exactKeys(value, ["kind", "referenceYear", "offenceCount"]) ||
      value.referenceYear !== referenceYear || typeof value.offenceCount !== "string" ||
      !/^(0|[1-9][0-9]*)$/.test(value.offenceCount)) mismatch();
    return undefined;
  }
  if (["denominator_zero", "denominator_period_mismatch", "denominator_scope_mismatch"]
    .includes(value.kind as string)) {
    if (!exactKeys(value, ["kind", "referenceYear", "offenceCount", "observedDenominator"]) ||
      value.referenceYear !== referenceYear || typeof value.offenceCount !== "string" ||
      !/^(0|[1-9][0-9]*)$/.test(value.offenceCount)) mismatch();
    const denominator = validateDenominator(value.observedDenominator, denominatorPolicy);
    if (value.kind === "denominator_zero" && denominator.population !== "0" ||
      value.kind === "denominator_period_mismatch" &&
        denominator.referenceDate === `${String(referenceYear)}-01-01` ||
      value.kind === "denominator_scope_mismatch" &&
        denominator.publisherId === denominatorPolicy.publisherId &&
        denominator.municipalityCode === municipalityCode) mismatch();
    return denominator;
  }
  if (value.kind === "conflict") {
    if (!exactKeys(value, ["kind", "conflictBasis"]) || candidate.conflictBasis === undefined ||
      !sameCanonical(value.conflictBasis, candidate.conflictBasis, integrity)) mismatch();
    return validateConflictBasis(value.conflictBasis, denominatorPolicy);
  }
  mismatch();
}

function validateProjectionCommon(
  projection: Record<string, unknown>,
  reference: CitySafetyArtifactReference,
  publisher: OfficialPublisherPolicy,
): void {
  if (projection.sourceSha256 !== reference.sourceSha256 ||
    projection.sourceLocator !== reference.locator ||
    typeof projection.sourceMediaType !== "string" ||
    !publisher.allowedMediaTypes.includes(projection.sourceMediaType) ||
    projection.retentionPolicyId !== publisher.retentionPolicyId ||
    projection.transientRawDeleted !== true) mismatch();
}

function validateNavigationProjection(
  projection: Record<string, unknown>,
  candidate: CitySafetyCandidateAttempt,
  reference: Extract<CitySafetyArtifactReference, { readonly role: "municipal_source" }>,
  publisher: OfficialPublisherPolicy,
  cityId: string,
  municipalityCode: string,
  integrity: CityEvidenceReplayIntegrity,
): void {
  if (!exactKeys(projection, [
    "schemaVersion", "cityId", "municipalityCode", "publisherId", "publisherNavigationUrl",
    "resolvedNavigationUrl", "officialTrace", "confirmedDocumentUrl", "documentLocatorPolicyId",
    ...COMMON_PROJECTION_KEYS,
  ]) || projection.schemaVersion !== "city-safety-retained-navigation@1" ||
    projection.cityId !== cityId || projection.municipalityCode !== municipalityCode ||
    projection.publisherId !== publisher.publisherId ||
    projection.resolvedNavigationUrl !== reference.locator ||
    projection.documentLocatorPolicyId !== publisher.documentLocatorPolicyId) mismatch();
  const publisherNavigationUrl = candidate.disposition === "usable"
    ? candidate.publisherNavigationUrl
    : candidate.reviewedOfficial?.publisherNavigationUrl ?? publisher.navigationUrl;
  if (projection.publisherNavigationUrl !== publisherNavigationUrl) mismatch();
  const confirmedIndex = candidate.officialTrace.edges.findIndex((edge) =>
    edge.kind === "confirmed_document_link" && edge.fromUrl === reference.locator);
  const confirmedEdge = confirmedIndex < 0 ? undefined : candidate.officialTrace.edges[confirmedIndex];
  const expectedConfirmedUrl = confirmedEdge?.toUrl ??
    candidate.officialTrace.failure?.rejectedTarget?.url;
  const expectedEdges = confirmedIndex < 0
    ? candidate.officialTrace.edges
    : candidate.officialTrace.edges.slice(0, confirmedIndex + 1);
  const expectedTrace = {
    initialUrl: candidate.officialTrace.initialUrl,
    edges: expectedEdges,
    lastTrustedUrl: expectedEdges.at(-1)?.toUrl ?? candidate.officialTrace.initialUrl,
    officialHops: expectedEdges.length,
  };
  if (expectedConfirmedUrl === undefined || projection.confirmedDocumentUrl !== expectedConfirmedUrl ||
    !sameCanonical(projection.officialTrace, expectedTrace, integrity)) {
    mismatch();
  }
}

function validateInspectionProjection(
  projection: Record<string, unknown>,
  candidate: CitySafetyCandidateAttempt,
  publisher: OfficialPublisherPolicy,
  denominatorPolicy: OfficialPublisherPolicy,
  cityId: string,
  municipalityCode: string,
  integrity: CityEvidenceReplayIntegrity,
): CitySafetyDenominatorReference | undefined {
  if (!exactKeys(projection, [
    "schemaVersion", "cityId", "municipalityCode", "publisherId", "dataAuthorityId",
    "publisherNavigationUrl", "resolvedEvidenceUrl", "officialTrace", "outcome",
    ...COMMON_PROJECTION_KEYS,
  ]) || projection.schemaVersion !== "city-safety-retained-inspection@1" ||
    projection.cityId !== cityId || projection.municipalityCode !== municipalityCode ||
    projection.publisherId !== publisher.publisherId || projection.sourceMediaType !== candidate.mediaType ||
    !record(projection.outcome)) mismatch();
  if (candidate.disposition === "usable") {
    if (projection.dataAuthorityId !== candidate.dataAuthorityId ||
      projection.publisherNavigationUrl !== candidate.publisherNavigationUrl ||
      projection.resolvedEvidenceUrl !== candidate.resolvedEvidenceUrl ||
      !sameCanonical(projection.officialTrace, candidate.officialTrace, integrity) ||
      !sameCanonical(projection.outcome, {
        kind: "usable",
        referenceYear: candidate.referenceYear,
        quantity: candidate.quantity,
        denominator: candidate.denominator,
      }, integrity)) mismatch();
    return candidate.denominator;
  }
  const reviewed = candidate.reviewedOfficial;
  if (reviewed === undefined || reviewed.resolvedEvidenceUrl === undefined ||
    projection.dataAuthorityId !== reviewed.dataAuthorityId ||
    projection.publisherNavigationUrl !== reviewed.publisherNavigationUrl ||
    projection.resolvedEvidenceUrl !== reviewed.resolvedEvidenceUrl ||
    !sameCanonical(projection.officialTrace, candidate.officialTrace, integrity) ||
    !exactKeys(projection.outcome, ["kind", "basis"]) ||
    projection.outcome.kind !== "rejected") mismatch();
  return validateRejectionBasis(
    projection.outcome.basis,
    candidate,
    denominatorPolicy,
    municipalityCode,
    integrity,
  );
}

function validateDenominatorProjection(
  projection: Record<string, unknown>,
  expected: CitySafetyDenominatorReference | undefined,
  reference: CitySafetyArtifactReference,
  artifact: LiveCapturedArtifact<"si-city-safety">,
): void {
  if (!exactKeys(projection, [
    "schemaVersion", "publisherId", "municipalityCode", "referenceDate", "population",
    ...COMMON_PROJECTION_KEYS,
  ]) || projection.schemaVersion !== "city-safety-retained-denominator@1" || expected === undefined ||
    reference.artifactId !== expected.artifactId || artifact.mediaType !== expected.mediaType ||
    projection.publisherId !== expected.publisherId ||
    projection.municipalityCode !== expected.municipalityCode ||
    projection.referenceDate !== expected.referenceDate || projection.population !== expected.population) {
    mismatch();
  }
}

function decodeProjection(bytes: Uint8Array, integrity: CityEvidenceReplayIntegrity): Record<string, unknown> {
  let text: string;
  let value: unknown;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    value = JSON.parse(text);
    if (!record(value) || integrity.canonical(value) !== text) mismatch();
  } catch {
    mismatch();
  }
  return value;
}

function copyAndHash(
  bytes: Uint8Array,
  integrity: CityEvidenceReplayIntegrity,
): { readonly bytes: Uint8Array; readonly digest: string } {
  if (!(bytes instanceof Uint8Array) ||
    typeof SharedArrayBuffer !== "undefined" && bytes.buffer instanceof SharedArrayBuffer) mismatch();
  const base = new Uint8Array(bytes);
  const hashInput = new Uint8Array(base);
  const digest = integrity.hashBytes(hashInput);
  if (!SHA256.test(digest)) mismatch();
  return { bytes: base, digest };
}

function validateArtifact(
  value: LiveCapturedArtifact<"si-city-safety">,
  reference: CitySafetyArtifactReference,
  publisher: OfficialPublisherPolicy,
  expectedRequestUrl: string,
  runId: string,
  integrity: CityEvidenceReplayIntegrity,
): { readonly artifact: LiveCapturedArtifact<"si-city-safety">; readonly baseBytes: Uint8Array } {
  if (!record(value) || !exactKeys(value, ARTIFACT_KEYS) || value.artifactId !== reference.artifactId ||
    value.runId !== runId || value.sourceId !== "si-city-safety" || value.role !== reference.role ||
    value.origin !== "live" || value.sha256 !== reference.artifactSha256 || !SHA256.test(value.sha256) ||
    value.url !== reference.locator || value.responseUrl !== reference.locator ||
    canonicalUrl(value.url) !== reference.locator || canonicalUrl(value.responseUrl) !== reference.locator ||
    !urlAllowed(value.url, publisher) || !urlAllowed(value.responseUrl, publisher) ||
    typeof value.mediaType !== "string" || !canonicalInstant(value.capturedAt) ||
    !Number.isSafeInteger(value.responseStatus) || value.responseStatus < 200 || value.responseStatus >= 300) {
    mismatch();
  }
  const request = validateRequest(value.request, reference.role, publisher, expectedRequestUrl);
  const copied = copyAndHash(value.bytes, integrity);
  if (copied.digest !== value.sha256) mismatch();
  return {
    baseBytes: copied.bytes,
    artifact: {
      artifactId: value.artifactId,
      runId,
      sourceId: "si-city-safety",
      role: reference.role,
      url: value.url,
      mediaType: value.mediaType,
      sha256: value.sha256,
      bytes: new Uint8Array(copied.bytes),
      origin: "live",
      capturedAt: value.capturedAt,
      responseStatus: value.responseStatus,
      responseUrl: value.responseUrl,
      request,
    },
  };
}

function reconstructLedger(
  input: CitySafetyArtifactBridgeInput,
  catalog: CityCatalogRevision,
  plan: CitySafetySourcePlan,
  directory: OfficialAuthorityDirectory,
  integrity: CityDecisionIntegrity,
): CitySafetyAttemptLedger {
  return reconstructCitySafetyAttemptLedger(input.ledger, {
    runId: input.cityCheckRunId,
    catalog,
    integrity,
    sourcePlan: plan,
    authorityDirectory: directory,
    ...(input.previousAccepted === undefined
      ? {}
      : { previousAccepted: input.previousAccepted }),
  });
}

export function reconstructCitySafetyArtifactBridge(
  input: CitySafetyArtifactBridgeInput,
  integrity: CityEvidenceReplayIntegrity,
): CitySafetyArtifactBridge {
  try {
    if (!record(input) || !denseArray(input.artifacts) || typeof input.cityCheckRunId !== "string" ||
      input.cityCheckRunId.length === 0 || !exactReplayIntegrity(integrity)) mismatch();
    const decisionIntegrity = decisionIntegrityView(integrity);
    const directory = reconstructOfficialAuthorityDirectory(
      input.authorityDirectory,
      input.catalog,
      decisionIntegrity,
    );
    const plan = reconstructCitySafetySourcePlan(
      input.sourcePlan,
      input.catalog,
      directory,
      decisionIntegrity,
    );
    const ledger = reconstructLedger(input, input.catalog, plan, directory, decisionIntegrity);
    const planEntry = plan.entries.find(({ cityId }) => cityId === ledger.cityId);
    const municipality = directory.municipalities.find(({ cityId }) => cityId === ledger.cityId);
    if (planEntry === undefined || municipality === undefined ||
      planEntry.municipalityCode !== ledger.municipalityCode ||
      municipality.municipalityCode !== ledger.municipalityCode) mismatch();

    const references = new Map<string, CitySafetyArtifactReference>();
    for (const candidate of ledger.candidates) {
      for (const reference of candidate.artifactRefs) {
        const previous = references.get(reference.artifactId);
        if (previous !== undefined && !sameCanonical(previous, reference, integrity)) mismatch();
        references.set(reference.artifactId, reference);
      }
    }
    const artifactsById = new Map<string, LiveCapturedArtifact<"si-city-safety">>();
    for (const artifact of input.artifacts) {
      if (artifactsById.has(artifact.artifactId)) mismatch();
      artifactsById.set(artifact.artifactId, artifact);
    }
    if (references.size !== artifactsById.size ||
      [...references.keys()].some((artifactId) => !artifactsById.has(artifactId))) mismatch();

    const denominatorPolicy = publisherById(directory, directory.requiredPublisherIds.surs);
    const validatedById = new Map<string, LiveCapturedArtifact<"si-city-safety">>();
    for (const candidate of ledger.candidates) {
      const municipalPolicy = candidate.artifactRefs.some(({ role }) => role === "municipal_source")
        ? municipalPublisher(candidate, plan, directory, ledger.cityId)
        : undefined;
      const requestUrls = municipalRequestUrls(candidate);
      let denominator: CitySafetyDenominatorReference | undefined = candidate.disposition === "usable"
        ? candidate.denominator
        : candidate.conflictBasis?.denominator;
      for (const reference of candidate.artifactRefs) {
        const publisher = reference.role === "municipal_source"
          ? municipalPolicy ?? mismatch()
          : denominatorPolicy;
        const stored = artifactsById.get(reference.artifactId);
        if (stored === undefined) mismatch();
        const validated = validateArtifact(
          stored,
          reference,
          publisher,
          reference.role === "municipal_source"
            ? requestUrls.get(reference) ?? mismatch()
            : reference.locator,
          input.cityCheckRunId,
          integrity,
        );
        const rawRetention = publisher.retentionMode === "seal_raw_artifact";
        if (reference.role === "surs_denominator") {
          if (denominator === undefined) {
            if (denominatorPolicy.retentionMode !== "seal_raw_artifact") mismatch();
          } else if (denominator.artifactId !== reference.artifactId ||
              denominator.mediaType !== validated.artifact.mediaType ||
              denominator.publisherId !== denominatorPolicy.publisherId ||
              denominator.municipalityCode !== ledger.municipalityCode ||
              denominator.retentionPolicyId !== denominatorPolicy.retentionPolicyId ||
              denominator.transientRawDeleted !==
                (denominatorPolicy.retentionMode === "seal_hash_locator_then_delete_transient")) mismatch();
        }
        if (rawRetention) {
          if (reference.sourceSha256 !== reference.artifactSha256 ||
            !publisher.allowedMediaTypes.includes(validated.artifact.mediaType)) mismatch();
          if (reference.role === "municipal_source" &&
            reference.documentRole === "terminal_claim" &&
            (candidate.mediaType === undefined || validated.artifact.mediaType !== candidate.mediaType)) {
            mismatch();
          }
        } else {
          if (validated.artifact.mediaType !== "application/json") mismatch();
          const projection = decodeProjection(validated.baseBytes, integrity);
          validateProjectionCommon(projection, reference, publisher);
          if (reference.role === "municipal_source" && reference.documentRole === "navigation") {
            validateNavigationProjection(
              projection,
              candidate,
              reference,
              publisher,
              ledger.cityId,
              ledger.municipalityCode,
              integrity,
            );
          } else if (reference.role === "municipal_source") {
            denominator = validateInspectionProjection(
              projection,
              candidate,
              publisher,
              denominatorPolicy,
              ledger.cityId,
              ledger.municipalityCode,
              integrity,
            );
          } else {
            validateDenominatorProjection(projection, denominator, reference, validated.artifact);
          }
        }
        validatedById.set(reference.artifactId, validated.artifact);
      }
    }
    const artifacts = input.artifacts.map(({ artifactId }) => {
      const artifact = validatedById.get(artifactId);
      if (artifact === undefined) mismatch();
      return { ...artifact, bytes: new Uint8Array(artifact.bytes) };
    });
    return immutableCopy({ ledger, artifacts });
  } catch {
    mismatch();
  }
}
