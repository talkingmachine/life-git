import { z } from "zod";

import type {
  CaptureRequest,
  CaptureResult,
  CapturedEntry,
  HttpStepRequest,
  LiveCapturedArtifact,
  OfficialSourcePort,
  RequestStep,
} from "../../research/contracts";
import type {
  ClaimKind,
  SloveniaResearch,
  SloveniaSourceId,
  SourceCandidate,
} from "../../research/cold-start-contracts";
import { createSloveniaPlan } from "../../research/slovenia-plan";
import { SOURCE_POLICIES } from "../../research/source-policy";
import { SourceCaptureError } from "./gateway";
import { captureCbrEur } from "./official-source-adapter";

const SISTAT_ENDPOINT = "https://pxweb.stat.si/SiStatData/pxweb/en/Data/-/H285S.px/";

type CountrySourceId = Exclude<SloveniaSourceId, "cbr-eur">;

interface CandidateSlots {
  readonly routeGov?: SourceCandidate;
  readonly routeLaw?: SourceCandidate;
  readonly salary?: SourceCandidate;
  readonly sistat?: SourceCandidate;
  readonly companionEss?: SourceCandidate;
  readonly companionLaw?: SourceCandidate;
}

const metadataSchema = z.object({
  variables: z.array(z.object({
    code: z.string().trim().min(1),
  }).passthrough()).min(1),
}).passthrough();

function candidateMatches(
  candidate: SourceCandidate,
  host: string,
  authorityRoot: string,
  claimKind: ClaimKind,
): boolean {
  try {
    const url = new URL(candidate.url);
    return candidate.discoveredFrom === "registry" &&
      url.protocol === "https:" &&
      url.host.toLowerCase() === host &&
      candidate.authorityRoot === authorityRoot &&
      candidate.claimKinds.includes(claimKind);
  } catch {
    return false;
  }
}

function uniqueCandidate(
  candidates: readonly SourceCandidate[],
  host: string,
  authorityRoot: string,
  claimKind: ClaimKind,
): SourceCandidate | undefined {
  const matches = candidates.filter((candidate) =>
    candidateMatches(candidate, host, authorityRoot, claimKind)
  );
  return matches.length === 1 ? matches[0] : undefined;
}

function candidateSlots(candidates: readonly SourceCandidate[]): CandidateSlots {
  return Object.freeze({
    routeGov: uniqueCandidate(candidates, "www.gov.si", "https://www.gov.si", "route_basis"),
    routeLaw: uniqueCandidate(candidates, "pisrs.si", "https://pisrs.si", "route_basis"),
    salary: uniqueCandidate(candidates, "pisrs.si", "https://pisrs.si", "income"),
    sistat: uniqueCandidate(candidates, "pxweb.stat.si", "https://pxweb.stat.si", "income"),
    companionEss: uniqueCandidate(
      candidates,
      "www.ess.gov.si",
      "https://www.ess.gov.si",
      "companion_local_work_access",
    ),
    companionLaw: uniqueCandidate(
      candidates,
      "pisrs.si",
      "https://pisrs.si",
      "companion_local_work_access",
    ),
  });
}

function snapshotCandidate(candidate: SourceCandidate): SourceCandidate {
  return Object.freeze({
    candidateId: candidate.candidateId,
    url: candidate.url,
    authorityRoot: candidate.authorityRoot,
    claimKinds: Object.freeze([...candidate.claimKinds]),
    discoveredFrom: candidate.discoveredFrom,
  });
}

async function runStep(
  requestStep: RequestStep<SloveniaSourceId>,
  request: HttpStepRequest<SloveniaSourceId>,
  signal: AbortSignal,
  partialArtifacts: readonly LiveCapturedArtifact<SloveniaSourceId>[],
): Promise<LiveCapturedArtifact<SloveniaSourceId>> {
  try {
    const artifact = await requestStep(request, signal);
    if (
      artifact.origin !== "live" ||
      artifact.runId !== request.runId ||
      artifact.sourceId !== request.sourceId
    ) {
      throw new SourceCaptureError("navigation_mismatch", "Source step returned foreign evidence");
    }
    return artifact;
  } catch (error) {
    if (error instanceof SourceCaptureError) {
      Object.assign(error, { partialArtifacts });
    }
    throw error;
  }
}

function getRequest(
  request: CaptureRequest<SloveniaSourceId>,
  role: string,
  url: string,
  host: string,
  accept: string,
): HttpStepRequest<SloveniaSourceId> {
  return {
    runId: request.runId,
    sourceId: request.sourceId,
    role,
    method: "GET",
    url,
    headers: { accept },
    allowedHosts: [host],
    allowedMediaTypes: [accept],
  };
}

function entry(
  sourceId: CountrySourceId,
  navigationUrl: string,
  artifacts: readonly LiveCapturedArtifact<SloveniaSourceId>[],
): CapturedEntry<SloveniaSourceId> {
  return {
    sourceId,
    navigationUrl,
    resolvedEvidenceUrl: artifacts.at(-1)?.responseUrl ?? navigationUrl,
    artifacts,
  };
}

function unavailable(sourceId: SloveniaSourceId): CaptureResult<SloveniaSourceId> {
  return {
    ok: false,
    sourceId,
    kind: "navigation_mismatch",
    attempts: 1,
    partialArtifacts: [],
  };
}

function decodeMetadata(artifact: LiveCapturedArtifact<SloveniaSourceId>): readonly string[] {
  try {
    const parsed = metadataSchema.safeParse(JSON.parse(new TextDecoder().decode(artifact.bytes)));
    if (!parsed.success) return [];
    const codes = parsed.data.variables.map((variable) => variable.code);
    return new Set(codes).size === codes.length ? codes : [];
  } catch {
    return [];
  }
}

export class SloveniaSourceAdapter implements OfficialSourcePort<SloveniaSourceId> {
  private readonly slots: CandidateSlots;

  readonly sourceNavigation: Readonly<Record<SloveniaSourceId, string>>;

  constructor(candidates: readonly SourceCandidate[]) {
    this.slots = candidateSlots(candidates.map(snapshotCandidate));
    this.sourceNavigation = Object.freeze({
      "si-digital-nomad-route": this.slots.routeGov?.url ?? "https://www.gov.si",
      "si-income-threshold": this.slots.salary?.url ?? "https://pisrs.si",
      "si-companion-employment": this.slots.companionEss?.url ?? "https://www.ess.gov.si",
      "cbr-eur": SOURCE_POLICIES["cbr-eur"].url,
    });
  }

  async capture(
    request: CaptureRequest<SloveniaSourceId>,
    requestStep: RequestStep<SloveniaSourceId>,
  ): Promise<CaptureResult<SloveniaSourceId>> {
    if (request.sourceId === "cbr-eur") {
      return captureCbrEur(
        request as CaptureRequest & { readonly sourceId: "cbr-eur" },
        requestStep as unknown as RequestStep,
      ) as unknown as Promise<CaptureResult<SloveniaSourceId>>;
    }
    try {
      let captured: CapturedEntry<SloveniaSourceId>;
      if (request.sourceId === "si-digital-nomad-route") {
        const gov = this.slots.routeGov;
        const law = this.slots.routeLaw;
        if (gov === undefined || law === undefined) return unavailable(request.sourceId);
        const govArtifact = await runStep(requestStep, getRequest(
          request,
          "gov-route-page",
          gov.url,
          "www.gov.si",
          "text/html",
        ), request.signal, []);
        const lawArtifact = await runStep(requestStep, getRequest(
          request,
          "ztuj2-consolidated",
          law.url,
          "pisrs.si",
          "text/html",
        ), request.signal, [govArtifact]);
        captured = entry(request.sourceId, gov.url, [govArtifact, lawArtifact]);
      } else if (request.sourceId === "si-income-threshold") {
        const salary = this.slots.salary;
        const sistat = this.slots.sistat;
        if (salary === undefined || sistat === undefined || sistat.url !== SISTAT_ENDPOINT) {
          return unavailable(request.sourceId);
        }
        const salaryArtifact = await runStep(requestStep, getRequest(
          request,
          "salary-publication",
          salary.url,
          "pisrs.si",
          "text/html",
        ), request.signal, []);
        const metadataArtifact = await runStep(requestStep, getRequest(
          request,
          "sistat-metadata",
          SISTAT_ENDPOINT,
          "pxweb.stat.si",
          "application/json",
        ), request.signal, [salaryArtifact]);
        const dimensionCodes = decodeMetadata(metadataArtifact);
        if (dimensionCodes.length === 0) {
          const error = new SourceCaptureError(
            "navigation_mismatch",
            "SiStat metadata did not provide a complete dimension listing",
          );
          Object.assign(error, { partialArtifacts: [salaryArtifact, metadataArtifact] });
          throw error;
        }
        const bodyBytes = new TextEncoder().encode(JSON.stringify({
          query: dimensionCodes.map((code) => ({
            code,
            selection: { filter: "all", values: ["*"] },
          })),
          response: { format: "json-stat2" },
        }));
        const seriesArtifact = await runStep(requestStep, {
          runId: request.runId,
          sourceId: request.sourceId,
          role: "sistat-series",
          method: "POST",
          url: SISTAT_ENDPOINT,
          headers: { accept: "application/json", "content-type": "application/json" },
          bodyMediaType: "application/json",
          bodyBytes,
          allowedHosts: ["pxweb.stat.si"],
          allowedMediaTypes: ["application/json"],
        }, request.signal, [salaryArtifact, metadataArtifact]);
        captured = entry(request.sourceId, salary.url, [
          salaryArtifact,
          metadataArtifact,
          seriesArtifact,
        ]);
      } else {
        const ess = this.slots.companionEss;
        const law = this.slots.companionLaw;
        if (ess === undefined || law === undefined) return unavailable(request.sourceId);
        const essArtifact = await runStep(requestStep, getRequest(
          request,
          "ess-companion-page",
          ess.url,
          "www.ess.gov.si",
          "text/html",
        ), request.signal, []);
        const lawArtifact = await runStep(requestStep, getRequest(
          request,
          "zzsdt-consolidated",
          law.url,
          "pisrs.si",
          "text/html",
        ), request.signal, [essArtifact]);
        captured = entry(request.sourceId, ess.url, [essArtifact, lawArtifact]);
      }
      return { ok: true, entry: captured };
    } catch (error) {
      if (!(error instanceof SourceCaptureError)) throw error;
      const partialArtifacts = (
        error as SourceCaptureError & {
          readonly partialArtifacts?: readonly LiveCapturedArtifact<SloveniaSourceId>[];
        }
      ).partialArtifacts ?? [];
      return {
        ok: false,
        sourceId: request.sourceId,
        kind: error.kind,
        attempts: 1,
        partialArtifacts,
      };
    }
  }
}

export function createSloveniaResearch(input: {
  readonly candidates: readonly SourceCandidate[];
}): SloveniaResearch {
  const source = new SloveniaSourceAdapter(input.candidates);
  return Object.freeze({
    plan: createSloveniaPlan(source.sourceNavigation),
    source,
  });
}
