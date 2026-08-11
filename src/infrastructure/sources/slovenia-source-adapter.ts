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
  SloveniaResearch,
  SloveniaSourceId,
  SourceCandidate,
} from "../../research/cold-start-contracts";
import {
  decodePisrsRegistry,
  decodeSiStatMetadata,
  encodeSiStatAllDimensionsQuery,
  type PisrsRegistryIdentity,
  type PisrsSelectedNpb,
} from "../../research/parsers/slovenia";
import { createSloveniaPlan } from "../../research/slovenia-plan";
import {
  selectSloveniaCandidateSlots,
  type SloveniaCandidateSlots,
} from "../../research/slovenia-source-set";
import { SOURCE_POLICIES } from "../../research/source-policy";
import { SourceCaptureError } from "./gateway";
import { captureCbrEur } from "./official-source-adapter";

const PISRS_API_ROOT = "https://pisrs.si/api/rezultat";
const SISTAT_ENDPOINT = "https://pxweb.stat.si/SiStatData/api/v1/en/Data/H285S.px";

type CountrySourceId = Exclude<SloveniaSourceId, "cbr-eur">;

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
  indexedSourceUrl: string,
  artifacts: readonly LiveCapturedArtifact<SloveniaSourceId>[],
): CapturedEntry<SloveniaSourceId> {
  return {
    sourceId,
    navigationUrl,
    indexedSourceUrl,
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

function secondaryNavigationUrl(
  slots: SloveniaCandidateSlots,
  sourceId: SloveniaSourceId,
): string | undefined {
  if (sourceId === "si-digital-nomad-route") return slots.routeLaw?.url;
  if (sourceId === "si-income-threshold") return slots.sistat?.url;
  if (sourceId === "si-companion-employment") return slots.companionLaw?.url;
  return undefined;
}

function pisrsIdentityFromCandidate(
  candidate: SourceCandidate,
  expected: PisrsRegistryIdentity,
): PisrsRegistryIdentity | null {
  try {
    const url = new URL(candidate.url);
    const parameter = expected.kind === "record-id" ? "id" : "sop";
    const otherParameter = expected.kind === "record-id" ? "sop" : "id";
    const values = url.searchParams.getAll(parameter);
    if (
      !["/Pis.web/pregledPredpisa", "/pregledPredpisa"].includes(url.pathname) ||
      values.length !== 1 ||
      values[0] !== expected.value ||
      url.searchParams.has(otherParameter) ||
      url.hash !== ""
    ) return null;
    return expected;
  } catch {
    return null;
  }
}

function salaryIdentityFromCandidate(candidate: SourceCandidate): PisrsRegistryIdentity | null {
  try {
    const url = new URL(candidate.url);
    const values = url.searchParams.getAll("sop");
    if (
      !["/Pis.web/pregledPredpisa", "/pregledPredpisa"].includes(url.pathname) ||
      values.length !== 1 ||
      !/^\d{4}-\d{2}-\d{4}$/.test(values[0]!) ||
      url.searchParams.has("id") ||
      url.hash !== ""
    ) return null;
    return { kind: "sop", value: values[0]! };
  } catch {
    return null;
  }
}

function isSiStatDatasetCandidate(candidate: SourceCandidate): boolean {
  try {
    const url = new URL(candidate.url);
    const terminalPath = url.pathname.split("/").filter(Boolean).at(-1);
    return terminalPath === "H285S.px" && url.search === "" && url.hash === "";
  } catch {
    return false;
  }
}

function pisrsRegistryUrl(identity: PisrsRegistryIdentity): string {
  const pathKind = identity.kind === "record-id" ? "id" : "sop";
  return `${PISRS_API_ROOT}/zbirka/${pathKind}/${identity.value}`;
}

function pisrsDetailsUrl(selected: PisrsSelectedNpb): string {
  return `${PISRS_API_ROOT}/neuradno-precisceno-besedilo/${selected.npbId}/details`;
}

function navigationMismatch(
  message: string,
  partialArtifacts: readonly LiveCapturedArtifact<SloveniaSourceId>[],
): SourceCaptureError {
  const error = new SourceCaptureError("navigation_mismatch", message);
  Object.assign(error, { partialArtifacts });
  return error;
}

export class SloveniaSourceAdapter implements OfficialSourcePort<SloveniaSourceId> {
  private readonly slots: SloveniaCandidateSlots;

  readonly sourceNavigation: Readonly<Record<SloveniaSourceId, string>>;

  constructor(candidates: readonly SourceCandidate[]) {
    this.slots = selectSloveniaCandidateSlots(candidates.map(snapshotCandidate));
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
        const identity = law === undefined
          ? null
          : pisrsIdentityFromCandidate(law, { kind: "record-id", value: "ZAKO5761" });
        if (gov === undefined || law === undefined || identity === null) {
          return unavailable(request.sourceId);
        }
        const govArtifact = await runStep(requestStep, getRequest(
          request,
          "gov-route-page",
          gov.url,
          "www.gov.si",
          "text/html",
        ), request.signal, []);
        const registryUrl = pisrsRegistryUrl(identity);
        const registryArtifact = await runStep(requestStep, getRequest(
          request,
          "ztuj2-registry",
          registryUrl,
          "pisrs.si",
          "application/json",
        ), request.signal, [govArtifact]);
        const selected = decodePisrsRegistry(registryArtifact, identity, registryUrl);
        if (selected === null) {
          throw navigationMismatch(
            "ZTuj-2 registry did not provide a valid internally gapless Osnovni..NPB N sequence from the captured single-record response",
            [govArtifact, registryArtifact],
          );
        }
        const detailsArtifact = await runStep(requestStep, getRequest(
          request,
          "ztuj2-details",
          pisrsDetailsUrl(selected),
          "pisrs.si",
          "application/json",
        ), request.signal, [govArtifact, registryArtifact]);
        captured = entry(request.sourceId, gov.url, law.url, [
          govArtifact,
          registryArtifact,
          detailsArtifact,
        ]);
      } else if (request.sourceId === "si-income-threshold") {
        const salary = this.slots.salary;
        const sistat = this.slots.sistat;
        const identity = salary === undefined ? null : salaryIdentityFromCandidate(salary);
        if (
          salary === undefined ||
          identity === null ||
          sistat === undefined ||
          !isSiStatDatasetCandidate(sistat)
        ) {
          return unavailable(request.sourceId);
        }
        const registryUrl = pisrsRegistryUrl(identity);
        const registryArtifact = await runStep(requestStep, getRequest(
          request,
          "salary-registry",
          registryUrl,
          "pisrs.si",
          "application/json",
        ), request.signal, []);
        const selected = decodePisrsRegistry(registryArtifact, identity, registryUrl);
        if (selected === null) {
          throw navigationMismatch(
            "Salary registry did not provide a valid internally gapless Osnovni..NPB N sequence from the captured single-record response",
            [registryArtifact],
          );
        }
        const detailsArtifact = await runStep(requestStep, getRequest(
          request,
          "salary-details",
          pisrsDetailsUrl(selected),
          "pisrs.si",
          "application/json",
        ), request.signal, [registryArtifact]);
        const metadataArtifact = await runStep(requestStep, getRequest(
          request,
          "sistat-metadata",
          SISTAT_ENDPOINT,
          "pxweb.stat.si",
          "application/json",
        ), request.signal, [registryArtifact, detailsArtifact]);
        const metadata = decodeSiStatMetadata(metadataArtifact, SISTAT_ENDPOINT);
        if (metadata === null) {
          throw navigationMismatch(
            "SiStat metadata did not provide one complete dimension listing",
            [registryArtifact, detailsArtifact, metadataArtifact],
          );
        }
        const bodyBytes = encodeSiStatAllDimensionsQuery(metadata);
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
        }, request.signal, [registryArtifact, detailsArtifact, metadataArtifact]);
        captured = entry(request.sourceId, salary.url, sistat.url, [
          registryArtifact,
          detailsArtifact,
          metadataArtifact,
          seriesArtifact,
        ]);
      } else {
        const ess = this.slots.companionEss;
        const law = this.slots.companionLaw;
        const identity = law === undefined
          ? null
          : pisrsIdentityFromCandidate(law, { kind: "record-id", value: "ZAKO6655" });
        if (ess === undefined || law === undefined || identity === null) {
          return unavailable(request.sourceId);
        }
        const essArtifact = await runStep(requestStep, getRequest(
          request,
          "ess-companion-page",
          ess.url,
          "www.ess.gov.si",
          "text/html",
        ), request.signal, []);
        const registryUrl = pisrsRegistryUrl(identity);
        const registryArtifact = await runStep(requestStep, getRequest(
          request,
          "zzsdt-registry",
          registryUrl,
          "pisrs.si",
          "application/json",
        ), request.signal, [essArtifact]);
        const selected = decodePisrsRegistry(registryArtifact, identity, registryUrl);
        if (selected === null) {
          throw navigationMismatch(
            "ZZSDT registry did not provide a valid internally gapless Osnovni..NPB N sequence from the captured single-record response",
            [essArtifact, registryArtifact],
          );
        }
        const detailsArtifact = await runStep(requestStep, getRequest(
          request,
          "zzsdt-details",
          pisrsDetailsUrl(selected),
          "pisrs.si",
          "application/json",
        ), request.signal, [essArtifact, registryArtifact]);
        captured = entry(request.sourceId, ess.url, law.url, [
          essArtifact,
          registryArtifact,
          detailsArtifact,
        ]);
      }
      return { ok: true, entry: captured };
    } catch (error) {
      if (!(error instanceof SourceCaptureError)) throw error;
      const partialArtifacts = (
        error as SourceCaptureError & {
          readonly partialArtifacts?: readonly LiveCapturedArtifact<SloveniaSourceId>[];
        }
      ).partialArtifacts ?? [];
      const indexedSourceUrl = secondaryNavigationUrl(this.slots, request.sourceId);
      return {
        ok: false,
        sourceId: request.sourceId,
        kind: error.kind,
        attempts: 1,
        partialArtifacts,
        ...(indexedSourceUrl === undefined ? {} : { indexedSourceUrl }),
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
