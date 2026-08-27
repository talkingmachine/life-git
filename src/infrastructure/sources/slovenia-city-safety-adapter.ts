import { createHash } from "node:crypto";

import type {
  CitySafetyCandidateInspection,
  CitySafetyCandidateInspectionInput,
  CitySafetyOfficialDocumentPort,
  CitySafetyRejectedCandidateDetail,
} from "../../application/city-safety-contracts";
import { classifyCitySafetyPeriod, type CitySafetyQuantity } from "../../decision/city-safety";
import type { HttpStepRequest, LiveCapturedArtifact } from "../../research/contracts";
import { canonicalizeCitySafetyCandidateUrl } from "../../research/city-safety-discovery";
import type {
  CitySafetyArtifactReference,
  CitySafetyConflictBasis,
  CitySafetyDenominatorReference,
  CitySafetyOfficialChainEdge,
  CitySafetyOfficialInspectionTrace,
  CitySafetyRetainedInspectionOutcome,
  CitySafetyRetainedRejectionBasis,
} from "../../research/city-safety-evidence";
import type { OfficialPublisherPolicy } from "../../research/city-safety-source-plan";
import {
  SourceCaptureError,
  captureHttpWithTrace,
  type HttpCaptureLimits,
  type TracedLiveCapture,
} from "./gateway";

export type CitySafetyMunicipalDocumentAnalysis =
  | { readonly kind: "navigate"; readonly confirmedDocumentUrl: string }
  | {
      readonly kind: "terminal";
      readonly dataAuthorityId: string;
      readonly municipalityCodes: readonly string[];
      readonly definitionId: string;
      readonly referenceYear?: number;
      readonly offenceCounts: readonly string[];
    };

export type CitySafetyMunicipalDocumentAnalyzer = (input: {
  readonly artifact: LiveCapturedArtifact<"si-city-safety">;
  readonly publisherId: string;
  readonly documentLocatorPolicyId: string;
}) => Promise<CitySafetyMunicipalDocumentAnalysis> | CitySafetyMunicipalDocumentAnalysis;

export type CitySafetyPopulationLoadResult =
  | { readonly kind: "missing" }
  | {
      readonly kind: "captured";
      readonly publisherId: string;
      readonly municipalityCode: string;
      readonly referenceDate: string;
      readonly population: string;
      readonly artifact: LiveCapturedArtifact<"si-city-safety">;
    };

export type CitySafetyPopulationLoader = (input: {
  readonly runId: string;
  readonly municipalityCode: string;
  readonly referenceYear: number;
  readonly publisher: OfficialPublisherPolicy;
  readonly signal: AbortSignal;
}) => Promise<CitySafetyPopulationLoadResult>;

export type CitySafetyTracedCapture = (
  request: HttpStepRequest<"si-city-safety">,
  signal: AbortSignal,
  limits: HttpCaptureLimits,
) => Promise<TracedLiveCapture<"si-city-safety">>;

interface RetainedArtifact {
  readonly artifact: LiveCapturedArtifact<"si-city-safety">;
  readonly reference: CitySafetyArtifactReference;
  readonly sourceMediaType: string;
}

interface PopulationResolution {
  readonly kind: "resolved";
  readonly publisherId: string;
  readonly municipalityCode: string;
  readonly referenceDate: string;
  readonly population: string;
  readonly retained: RetainedArtifact;
  readonly reference: CitySafetyDenominatorReference;
}

type CachedPopulationResolution = { readonly kind: "missing" } | PopulationResolution;
const MISSING_POPULATION_RESOLUTION = Object.freeze({ kind: "missing" as const });

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, item]) => [key, canonicalValue(item)]));
  }
  return value;
}

function canonicalBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(canonicalValue(value)));
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function policyAllowsUrl(policy: OfficialPublisherPolicy, value: string): boolean {
  try {
    const host = new URL(canonicalizeCitySafetyCandidateUrl(value)).hostname;
    return policy.allowedHosts.includes(host) || policy.delegatedDocumentHosts.includes(host);
  } catch {
    return false;
  }
}

function retainedArtifact(
  source: LiveCapturedArtifact<"si-city-safety">,
  role: "municipal_source" | "surs_denominator",
  documentRole: "navigation" | "terminal_claim" | undefined,
  policy: OfficialPublisherPolicy,
  projection: unknown,
): RetainedArtifact {
  const transientRawDeleted = policy.retentionMode === "seal_hash_locator_then_delete_transient";
  const bytes = transientRawDeleted ? canonicalBytes(projection) : new Uint8Array(source.bytes);
  const artifactSha256 = transientRawDeleted ? sha256(bytes) : source.sha256;
  const request = { ...source.request };
  const artifact: LiveCapturedArtifact<"si-city-safety"> = transientRawDeleted
    ? {
        ...source,
        request,
        artifactId: `si-city-safety:${role}:${artifactSha256}`,
        role,
        mediaType: "application/json",
        sha256: artifactSha256,
        bytes,
      }
    : { ...source, request, role, bytes };
  const common = {
    artifactId: artifact.artifactId,
    artifactSha256,
    sourceSha256: source.sha256,
    locator: source.url,
  };
  return {
    artifact,
    sourceMediaType: source.mediaType,
    reference: role === "municipal_source"
      ? { role, documentRole: documentRole!, ...common }
      : { role, ...common },
  };
}

function materializePopulationResolution(seed: PopulationResolution): PopulationResolution {
  return {
    kind: "resolved",
    publisherId: seed.publisherId,
    municipalityCode: seed.municipalityCode,
    referenceDate: seed.referenceDate,
    population: seed.population,
    retained: {
      artifact: {
        ...seed.retained.artifact,
        request: { ...seed.retained.artifact.request },
        bytes: new Uint8Array(seed.retained.artifact.bytes),
      },
      reference: { ...seed.retained.reference },
      sourceMediaType: seed.retained.sourceMediaType,
    },
    reference: { ...seed.reference },
  };
}

function traceFromEdges(
  initialUrl: string,
  edges: readonly CitySafetyOfficialChainEdge[],
): CitySafetyOfficialInspectionTrace {
  return {
    initialUrl,
    edges: [...edges],
    lastTrustedUrl: edges.at(-1)?.toUrl ?? initialUrl,
    officialHops: edges.length,
  };
}

function appendRedirects(
  edges: CitySafetyOfficialChainEdge[],
  chain: readonly string[],
  officialHopLimit: number,
): void {
  for (let index = 1; index < chain.length; index += 1) {
    const fromUrl = canonicalizeCitySafetyCandidateUrl(chain[index - 1]!);
    const toUrl = canonicalizeCitySafetyCandidateUrl(chain[index]!);
    if ((edges.at(-1)?.toUrl ?? fromUrl) !== fromUrl || edges.length >= officialHopLimit) {
      throw new Error("invalid_city_safety_capture_trace");
    }
    edges.push({ kind: "http_redirect", fromUrl, toUrl });
  }
}

function captureRejectionReason(error: SourceCaptureError): CitySafetyRejectedCandidateDetail["reason"] {
  if (error.kind === "wrong_media_type") return "wrong_media_type";
  if (error.kind === "too_large") return "too_large";
  if (error.kind === "navigation_mismatch") return "untrusted_redirect";
  if (error.trace?.responseStatus === 404) return "http_not_found";
  return "transport_unavailable";
}

function rejectedTarget(
  error: SourceCaptureError,
  policy: OfficialPublisherPolicy,
  trustedUrls: readonly string[],
): NonNullable<NonNullable<CitySafetyOfficialInspectionTrace["failure"]>["rejectedTarget"]> | undefined {
  const url = error.trace?.rejectedRedirectUrl;
  if (url === undefined) return undefined;
  if (trustedUrls.includes(url)) return { kind: "redirect_loop", url };
  if (!policyAllowsUrl(policy, url)) return { kind: "untrusted_target", url };
  return { kind: "hop_limit", url };
}

function captureFailureDetail(
  input: CitySafetyCandidateInspectionInput,
  policy: OfficialPublisherPolicy,
  publisherNavigationUrl: string,
  edges: CitySafetyOfficialChainEdge[],
  error: SourceCaptureError,
  artifacts: readonly RetainedArtifact[],
): CitySafetyCandidateInspection {
  if (error.trace !== undefined) appendRedirects(edges, error.trace.redirectChain, input.officialHopLimit);
  const lastTrustedUrl = edges.at(-1)?.toUrl ?? error.trace?.redirectChain.at(-1);
  const reason = captureRejectionReason(error);
  return {
    kind: "rejected",
    detail: {
      officialTrace: {
        initialUrl: input.candidateUrl,
        edges,
        ...(lastTrustedUrl === undefined ? {} : { lastTrustedUrl }),
        officialHops: edges.length,
        failure: {
          captureKind: error.kind,
          ...(error.trace?.responseStatus === undefined ? {} : { responseStatus: error.trace.responseStatus }),
          ...(error.trace?.responseUrl === undefined ? {} : { responseUrl: error.trace.responseUrl }),
          ...(error.trace?.mediaType === undefined ? {} : { mediaType: error.trace.mediaType }),
          ...(rejectedTarget(error, policy, [input.candidateUrl, ...edges.map(({ toUrl }) => toUrl)]) === undefined
            ? {}
            : {
                rejectedTarget: rejectedTarget(
                  error,
                  policy,
                  [input.candidateUrl, ...edges.map(({ toUrl }) => toUrl)],
                ),
              }),
        },
      },
      reviewedOfficial: {
        publisherId: policy.publisherId,
        dataAuthorityId: input.authorityDirectory.requiredPublisherIds.police,
        publisherNavigationUrl,
      },
      ...(artifacts.length === 0 ? {} : {
        mediaType: artifacts.at(-1)!.sourceMediaType,
        retentionPolicyId: policy.retentionPolicyId,
        transientRawDeleted: policy.retentionMode === "seal_hash_locator_then_delete_transient",
      }),
      artifactRefs: artifacts.map(({ reference }) => reference),
      disposition: "rejected",
      reason,
    },
    artifacts: artifacts.map(({ artifact }) => artifact),
  };
}

function officialPolicy(input: CitySafetyCandidateInspectionInput): {
  readonly policy: OfficialPublisherPolicy;
  readonly publisherNavigationUrl: string;
} | undefined {
  if (input.publisherContext !== undefined) {
    const policy = input.authorityDirectory.publishers.find(({ publisherId }) =>
      publisherId === input.publisherContext?.publisherId);
    if (policy === undefined || !policyAllowsUrl(policy, input.publisherContext.publisherNavigationUrl) ||
      !policyAllowsUrl(policy, input.candidateUrl)) return undefined;
    return { policy, publisherNavigationUrl: input.publisherContext.publisherNavigationUrl };
  }
  const matches = input.authorityDirectory.publishers.filter((policy) =>
    policyAllowsUrl(policy, input.candidateUrl));
  if (matches.length !== 1) return undefined;
  return { policy: matches[0]!, publisherNavigationUrl: matches[0]!.navigationUrl };
}

function authorityRejected(input: CitySafetyCandidateInspectionInput): CitySafetyCandidateInspection {
  return {
    kind: "rejected",
    detail: {
      officialTrace: {
        initialUrl: input.candidateUrl,
        edges: [],
        officialHops: 0,
        failure: { captureKind: "navigation_mismatch" },
      },
      artifactRefs: [],
      disposition: "rejected",
      reason: "authority_untrusted",
    },
    artifacts: [],
  };
}

function reviewedOfficial(
  publisherId: string,
  dataAuthorityId: string,
  publisherNavigationUrl: string,
  resolvedEvidenceUrl: string,
  referenceYear?: number,
) {
  return {
    publisherId,
    dataAuthorityId,
    publisherNavigationUrl,
    resolvedEvidenceUrl,
    ...(referenceYear === undefined ? {} : { referenceYear }),
  };
}

function canonicalCount(value: string): boolean {
  return /^(0|[1-9][0-9]*)$/.test(value);
}

function ordinalQuantities(
  offenceCounts: readonly string[],
  population: string,
): readonly [CitySafetyQuantity, CitySafetyQuantity] {
  const quantities = [...new Set(offenceCounts)].map((offenceCount) => ({
    offenceCount,
    population,
    rateBasis: "offences_per_100000_residents" as const,
  })).sort((left, right) => BigInt(left.offenceCount) < BigInt(right.offenceCount) ? -1 :
    BigInt(left.offenceCount) > BigInt(right.offenceCount) ? 1 : 0);
  return [quantities[0]!, quantities[1]!];
}

export function createSloveniaCitySafetyAdapter(dependencies: {
  readonly capture?: CitySafetyTracedCapture;
  readonly analyze: CitySafetyMunicipalDocumentAnalyzer;
  readonly loadPopulation: CitySafetyPopulationLoader;
}): CitySafetyOfficialDocumentPort {
  const capture = dependencies.capture ?? captureHttpWithTrace;
  const populationCache = new Map<string, Promise<CachedPopulationResolution>>();

  async function loadPopulation(
    input: CitySafetyCandidateInspectionInput,
    referenceYear: number,
    publisher: OfficialPublisherPolicy,
  ): Promise<CachedPopulationResolution> {
    const key = `${input.runId}:${input.municipalityCode}:${referenceYear}`;
    let promise = populationCache.get(key);
    if (promise === undefined) {
      const pending = dependencies.loadPopulation({
        runId: input.runId,
        municipalityCode: input.municipalityCode,
        referenceYear,
        publisher,
        signal: input.signal,
      }).then((load) => load.kind === "missing"
        ? MISSING_POPULATION_RESOLUTION
        : retainPopulation(input, load, publisher));
      populationCache.set(key, pending);
      void pending.catch(() => {
        if (populationCache.get(key) === pending) populationCache.delete(key);
      });
      promise = pending;
    }
    const cached = await promise;
    return cached.kind === "missing" ? cached : materializePopulationResolution(cached);
  }

  function retainPopulation(
    input: CitySafetyCandidateInspectionInput,
    load: Exclude<CitySafetyPopulationLoadResult, { readonly kind: "missing" }>,
    policy: OfficialPublisherPolicy,
  ): PopulationResolution {
    if (load.artifact.runId !== input.runId || load.artifact.sourceId !== "si-city-safety" ||
      load.artifact.origin !== "live") throw new Error("invalid_city_safety_population");
    const projection = {
      schemaVersion: "city-safety-retained-denominator@1",
      publisherId: load.publisherId,
      municipalityCode: load.municipalityCode,
      referenceDate: load.referenceDate,
      population: load.population,
      sourceSha256: load.artifact.sha256,
      sourceLocator: load.artifact.url,
      sourceMediaType: load.artifact.mediaType,
      retentionPolicyId: policy.retentionPolicyId,
      transientRawDeleted: true,
    } as const;
    const retained = retainedArtifact(load.artifact, "surs_denominator", undefined, policy, projection);
    const reference = {
      publisherId: load.publisherId,
      municipalityCode: load.municipalityCode,
      referenceDate: load.referenceDate,
      population: load.population,
      artifactId: retained.artifact.artifactId,
      mediaType: retained.artifact.mediaType,
      retentionPolicyId: policy.retentionPolicyId,
      transientRawDeleted: policy.retentionMode === "seal_hash_locator_then_delete_transient",
    };
    return {
      kind: "resolved",
      publisherId: load.publisherId,
      municipalityCode: load.municipalityCode,
      referenceDate: load.referenceDate,
      population: load.population,
      retained,
      reference,
    };
  }

  return {
    async inspect(input): Promise<CitySafetyCandidateInspection> {
      const official = officialPolicy(input);
      if (official === undefined) return authorityRejected(input);
      const { policy, publisherNavigationUrl } = official;
      const edges: CitySafetyOfficialChainEdge[] = [];
      const navigationArtifacts: RetainedArtifact[] = [];
      let currentUrl = canonicalizeCitySafetyCandidateUrl(input.candidateUrl);
      let terminalArtifact: LiveCapturedArtifact<"si-city-safety">;
      let terminalAnalysis: Extract<CitySafetyMunicipalDocumentAnalysis, { readonly kind: "terminal" }>;

      while (true) {
        let captured: TracedLiveCapture<"si-city-safety">;
        try {
          captured = await capture({
            runId: input.runId,
            sourceId: "si-city-safety",
            role: navigationArtifacts.length === 0 ? "municipal_source" : "municipal_terminal",
            method: "GET",
            url: currentUrl,
            headers: { accept: policy.allowedMediaTypes.join(", ") },
            allowedHosts: [...policy.allowedHosts, ...policy.delegatedDocumentHosts],
            allowedMediaTypes: policy.allowedMediaTypes,
          }, input.signal, {
            maxBytes: policy.maxBytes,
            maxRedirects: input.officialHopLimit - edges.length,
          });
        } catch (error) {
          if (input.signal.aborted) throw input.signal.reason ?? error;
          if (!(error instanceof SourceCaptureError)) throw error;
          return captureFailureDetail(
            input, policy, publisherNavigationUrl, edges, error, navigationArtifacts,
          );
        }
        appendRedirects(edges, captured.redirectChain, input.officialHopLimit);
        if (!policyAllowsUrl(policy, captured.artifact.url) || captured.artifact.runId !== input.runId ||
          captured.artifact.sourceId !== "si-city-safety") throw new Error("invalid_city_safety_capture");
        const analysis = await dependencies.analyze({
          artifact: captured.artifact,
          publisherId: policy.publisherId,
          documentLocatorPolicyId: policy.documentLocatorPolicyId,
        });
        if (analysis.kind === "terminal") {
          terminalArtifact = captured.artifact;
          terminalAnalysis = analysis;
          break;
        }
        const fromUrl = captured.artifact.url;
        const toUrl = canonicalizeCitySafetyCandidateUrl(analysis.confirmedDocumentUrl);
        const retainNavigation = (officialTrace: CitySafetyOfficialInspectionTrace): RetainedArtifact =>
          retainedArtifact(
            captured.artifact,
            "municipal_source",
            "navigation",
            policy,
            {
              schemaVersion: "city-safety-retained-navigation@1",
              cityId: input.cityId,
              municipalityCode: input.municipalityCode,
              publisherId: policy.publisherId,
              publisherNavigationUrl,
              resolvedNavigationUrl: fromUrl,
              officialTrace,
              confirmedDocumentUrl: toUrl,
              documentLocatorPolicyId: policy.documentLocatorPolicyId,
              sourceSha256: captured.artifact.sha256,
              sourceLocator: captured.artifact.url,
              sourceMediaType: captured.artifact.mediaType,
              retentionPolicyId: policy.retentionPolicyId,
              transientRawDeleted: true,
            },
          );
        const trustedUrls = [input.candidateUrl, ...edges.map(({ toUrl: trustedUrl }) => trustedUrl)];
        if (!policyAllowsUrl(policy, toUrl) || edges.length >= input.officialHopLimit ||
          trustedUrls.includes(toUrl)) {
          navigationArtifacts.push(retainNavigation(traceFromEdges(input.candidateUrl, edges)));
          const error = new SourceCaptureError("navigation_mismatch", "Confirmed document link rejected", undefined, {
            redirectChain: [fromUrl],
            rejectedRedirectUrl: toUrl,
            responseStatus: captured.artifact.responseStatus,
            responseUrl: fromUrl,
            mediaType: captured.artifact.mediaType,
          });
          return captureFailureDetail(
            input, policy, publisherNavigationUrl, edges, error, navigationArtifacts,
          );
        }
        edges.push({ kind: "confirmed_document_link", fromUrl, toUrl });
        const navigationTrace = traceFromEdges(input.candidateUrl, edges);
        navigationArtifacts.push(retainNavigation(navigationTrace));
        currentUrl = toUrl;
      }

      const trace = traceFromEdges(input.candidateUrl, edges);
      const resolvedEvidenceUrl = terminalArtifact.url;
      const semanticReject = (
        reason: CitySafetyRejectedCandidateDetail["reason"],
        basis: CitySafetyRetainedRejectionBasis,
        population?: PopulationResolution,
        conflictBasis?: CitySafetyConflictBasis,
      ): CitySafetyCandidateInspection => {
        const outcome: CitySafetyRetainedInspectionOutcome = { kind: "rejected", basis };
        const terminal = retainedArtifact(terminalArtifact, "municipal_source", "terminal_claim", policy, {
          schemaVersion: "city-safety-retained-inspection@1",
          cityId: input.cityId,
          municipalityCode: input.municipalityCode,
          publisherId: policy.publisherId,
          dataAuthorityId: terminalAnalysis.dataAuthorityId,
          publisherNavigationUrl,
          resolvedEvidenceUrl,
          officialTrace: trace,
          outcome,
          sourceSha256: terminalArtifact.sha256,
          sourceLocator: terminalArtifact.url,
          sourceMediaType: terminalArtifact.mediaType,
          retentionPolicyId: policy.retentionPolicyId,
          transientRawDeleted: true,
        });
        const all = [...navigationArtifacts, terminal, ...(population === undefined ? [] : [population.retained])];
        return {
          kind: "rejected",
          detail: {
            officialTrace: trace,
            reviewedOfficial: reviewedOfficial(
              policy.publisherId,
              terminalAnalysis.dataAuthorityId,
              publisherNavigationUrl,
              resolvedEvidenceUrl,
              terminalAnalysis.referenceYear,
            ),
            mediaType: terminalArtifact.mediaType,
            retentionPolicyId: policy.retentionPolicyId,
            transientRawDeleted: policy.retentionMode === "seal_hash_locator_then_delete_transient",
            artifactRefs: all.map(({ reference }) => reference),
            disposition: "rejected",
            reason,
            ...(conflictBasis === undefined ? {} : { conflictBasis }),
          },
          artifacts: all.map(({ artifact }) => artifact),
        };
      };

      if (terminalAnalysis.dataAuthorityId !== input.authorityDirectory.requiredPublisherIds.police) {
        const retainedNavigation = navigationArtifacts.map(({ artifact }) => artifact);
        return {
          kind: "rejected",
          detail: {
            officialTrace: {
              ...trace,
              failure: { captureKind: "navigation_mismatch" },
            },
            reviewedOfficial: reviewedOfficial(
              policy.publisherId,
              terminalAnalysis.dataAuthorityId,
              publisherNavigationUrl,
              resolvedEvidenceUrl,
              terminalAnalysis.referenceYear,
            ),
            ...(navigationArtifacts.length === 0 ? {} : {
              mediaType: navigationArtifacts.at(-1)!.sourceMediaType,
              retentionPolicyId: policy.retentionPolicyId,
              transientRawDeleted: policy.retentionMode === "seal_hash_locator_then_delete_transient",
            }),
            artifactRefs: navigationArtifacts.map(({ reference }) => reference),
            disposition: "rejected",
            reason: "authority_untrusted",
          },
          artifacts: retainedNavigation,
        };
      }
      const municipalityCodes = [...new Set(terminalAnalysis.municipalityCodes)].sort();
      if (municipalityCodes.length !== 1 || municipalityCodes[0] !== input.municipalityCode) {
        return semanticReject("scope_mismatch", {
          kind: "scope_mismatch",
          observedMunicipalityCodes: municipalityCodes,
          ...(terminalAnalysis.referenceYear === undefined ? {} : { referenceYear: terminalAnalysis.referenceYear }),
          ...(terminalAnalysis.offenceCounts[0] === undefined
            ? {}
            : { offenceCount: terminalAnalysis.offenceCounts[0] }),
        });
      }
      if (terminalAnalysis.definitionId !== "si-municipal-police-offences-per-100000@1") {
        return semanticReject("definition_mismatch", {
          kind: "definition_mismatch",
          observedDefinitionId: terminalAnalysis.definitionId,
          ...(terminalAnalysis.referenceYear === undefined ? {} : { referenceYear: terminalAnalysis.referenceYear }),
          ...(terminalAnalysis.offenceCounts[0] === undefined
            ? {}
            : { offenceCount: terminalAnalysis.offenceCounts[0] }),
        });
      }
      if (terminalAnalysis.referenceYear === undefined ||
        terminalAnalysis.offenceCounts.length === 0 ||
        !terminalAnalysis.offenceCounts.every(canonicalCount)) {
        return semanticReject("missing_numerator", {
          kind: "missing_numerator",
          ...(terminalAnalysis.referenceYear === undefined ? {} : { referenceYear: terminalAnalysis.referenceYear }),
        });
      }
      const sursPolicy = input.authorityDirectory.publishers.find(({ publisherId }) =>
        publisherId === input.authorityDirectory.requiredPublisherIds.surs);
      if (sursPolicy === undefined) throw new Error("invalid_city_safety_directory");
      const populationLoad = await loadPopulation(input, terminalAnalysis.referenceYear, sursPolicy);
      if (populationLoad.kind === "missing") {
        return semanticReject("denominator_missing", {
          kind: "denominator_missing",
          referenceYear: terminalAnalysis.referenceYear,
          offenceCount: terminalAnalysis.offenceCounts[0]!,
        });
      }
      const population = populationLoad;
      const expectedReferenceDate = `${terminalAnalysis.referenceYear}-01-01`;
      if (population.publisherId !== input.authorityDirectory.requiredPublisherIds.surs ||
        population.municipalityCode !== input.municipalityCode) {
        return semanticReject("denominator_scope_mismatch", {
          kind: "denominator_scope_mismatch",
          referenceYear: terminalAnalysis.referenceYear,
          offenceCount: terminalAnalysis.offenceCounts[0]!,
          observedDenominator: population.reference,
        }, population);
      }
      if (population.referenceDate !== expectedReferenceDate) {
        return semanticReject("denominator_period_mismatch", {
          kind: "denominator_period_mismatch",
          referenceYear: terminalAnalysis.referenceYear,
          offenceCount: terminalAnalysis.offenceCounts[0]!,
          observedDenominator: population.reference,
        }, population);
      }
      if (population.population === "0") {
        return semanticReject("denominator_zero", {
          kind: "denominator_zero",
          referenceYear: terminalAnalysis.referenceYear,
          offenceCount: terminalAnalysis.offenceCounts[0]!,
          observedDenominator: population.reference,
        }, population);
      }
      if (!/^[1-9][0-9]*$/.test(population.population)) {
        throw new Error("invalid_city_safety_population");
      }
      const uniqueCounts = [...new Set(terminalAnalysis.offenceCounts)];
      if (uniqueCounts.length > 1) {
        const conflictBasis = {
          referenceYear: terminalAnalysis.referenceYear,
          quantities: ordinalQuantities(uniqueCounts, population.population),
          denominator: population.reference,
        };
        return semanticReject("conflict", { kind: "conflict", conflictBasis }, population, conflictBasis);
      }
      const quantity: CitySafetyQuantity = {
        offenceCount: uniqueCounts[0]!,
        population: population.population,
        rateBasis: "offences_per_100000_residents",
      };
      const periodDisposition = classifyCitySafetyPeriod({
        assessmentAt: input.assessmentAt,
        referenceYear: terminalAnalysis.referenceYear,
      });
      if (periodDisposition === "stale") {
        return semanticReject("stale", {
          kind: "stale",
          referenceYear: terminalAnalysis.referenceYear,
          quantity,
          denominator: population.reference,
        }, population);
      }
      const outcome: CitySafetyRetainedInspectionOutcome = {
        kind: "usable",
        referenceYear: terminalAnalysis.referenceYear,
        quantity,
        denominator: population.reference,
      };
      const terminal = retainedArtifact(terminalArtifact, "municipal_source", "terminal_claim", policy, {
        schemaVersion: "city-safety-retained-inspection@1",
        cityId: input.cityId,
        municipalityCode: input.municipalityCode,
        publisherId: policy.publisherId,
        dataAuthorityId: terminalAnalysis.dataAuthorityId,
        publisherNavigationUrl,
        resolvedEvidenceUrl,
        officialTrace: trace,
        outcome,
        sourceSha256: terminalArtifact.sha256,
        sourceLocator: terminalArtifact.url,
        sourceMediaType: terminalArtifact.mediaType,
        retentionPolicyId: policy.retentionPolicyId,
        transientRawDeleted: true,
      });
      const all = [...navigationArtifacts, terminal, population.retained];
      return {
        kind: "usable",
        detail: {
          publisherId: policy.publisherId,
          dataAuthorityId: terminalAnalysis.dataAuthorityId,
          publisherNavigationUrl,
          resolvedEvidenceUrl,
          officialTrace: trace,
          mediaType: terminalArtifact.mediaType,
          retentionPolicyId: policy.retentionPolicyId,
          transientRawDeleted: policy.retentionMode === "seal_hash_locator_then_delete_transient",
          artifactRefs: all.map(({ reference }) => reference),
          disposition: "usable",
          referenceYear: terminalAnalysis.referenceYear,
          periodDisposition,
          quantity,
          denominator: population.reference,
        },
        artifacts: all.map(({ artifact }) => artifact),
      };
    },
  };
}
