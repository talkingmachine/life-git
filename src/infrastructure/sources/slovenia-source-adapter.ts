import { types } from "node:util";

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
import type { ColdStartEvidenceClaimV2 } from "../../research/cold-start-contracts-v2";
import {
  decodePisrsRegistry,
  decodeSiStatMetadata,
  encodeSiStatAllDimensionsQuery,
  type PisrsRegistryIdentity,
  type PisrsSelectedNpb,
} from "../../research/parsers/slovenia";
import { createSloveniaPlan } from "../../research/slovenia-plan";
import { createSloveniaPlanV2 } from "../../research/slovenia-plan-v2";
import type {
  ResearchPlan,
  ResearchSourceLineage,
} from "../../research/research-plan";
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

function integrityMismatch(): never {
  throw new Error("integrity_mismatch");
}

function denseBorrowedArray<T>(borrowed: readonly T[]): readonly T[] {
  if (types.isProxy(borrowed) || Object.getPrototypeOf(borrowed) !== Array.prototype ||
    Object.getOwnPropertySymbols(borrowed).length !== 0) integrityMismatch();
  const descriptors = Object.getOwnPropertyDescriptors(borrowed) as Record<
    string,
    PropertyDescriptor
  >;
  const lengthDescriptor = descriptors.length;
  if (lengthDescriptor === undefined || !("value" in lengthDescriptor)) integrityMismatch();
  const lengthValue = lengthDescriptor.value;
  if (
    typeof lengthValue !== "number" ||
    !Number.isSafeInteger(lengthValue) || lengthValue < 0
  ) integrityMismatch();
  const length = lengthValue;
  const expectedKeys = [
    ...Array.from({ length }, (_, index) => String(index)),
    "length",
  ].sort();
  const actualKeys = Object.keys(descriptors).sort();
  if (
    actualKeys.length !== expectedKeys.length ||
    actualKeys.some((key, index) => key !== expectedKeys[index])
  ) integrityMismatch();
  const copy: T[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (
      descriptor === undefined || !("value" in descriptor) ||
      !descriptor.enumerable
    ) integrityMismatch();
    copy.push(descriptor.value as T);
  }
  return copy;
}

function snapshotV2Candidate(borrowed: SourceCandidate): SourceCandidate {
  if (typeof borrowed !== "object" || borrowed === null || types.isProxy(borrowed) ||
    (Object.getPrototypeOf(borrowed) !== Object.prototype &&
      Object.getPrototypeOf(borrowed) !== null) ||
    Object.getOwnPropertySymbols(borrowed).length !== 0) integrityMismatch();
  const descriptors = Object.getOwnPropertyDescriptors(borrowed);
  const expectedKeys = [
    "candidateId",
    "url",
    "authorityRoot",
    "claimKinds",
    "discoveredFrom",
  ].sort();
  const actualKeys = Object.keys(descriptors).sort();
  if (
    actualKeys.length !== expectedKeys.length ||
    actualKeys.some((key, index) => key !== expectedKeys[index]) ||
    Object.entries(descriptors).some(([key, descriptor]) =>
      key === "__proto__" || !("value" in descriptor) || !descriptor.enumerable
    )
  ) integrityMismatch();
  const value = (key: keyof SourceCandidate): unknown => {
    const descriptor = descriptors[key];
    return descriptor !== undefined && "value" in descriptor
      ? descriptor.value
      : integrityMismatch();
  };
  const claimKinds = value("claimKinds");
  if (!Array.isArray(claimKinds)) integrityMismatch();
  const copiedKinds = denseBorrowedArray(claimKinds);
  if (
    typeof value("candidateId") !== "string" || typeof value("url") !== "string" ||
    typeof value("authorityRoot") !== "string" || value("discoveredFrom") !== "registry" ||
    !copiedKinds.every((kind) => typeof kind === "string")
  ) integrityMismatch();
  return {
    candidateId: value("candidateId") as string,
    url: value("url") as string,
    authorityRoot: value("authorityRoot") as string,
    claimKinds: copiedKinds as SourceCandidate["claimKinds"],
    discoveredFrom: "registry",
  };
}

function snapshotV2Candidates(
  borrowed: readonly SourceCandidate[],
): readonly SourceCandidate[] {
  return denseBorrowedArray(borrowed).map(snapshotV2Candidate);
}

function snapshotV2ResearchInput(borrowed: {
  readonly candidates: readonly SourceCandidate[];
}): readonly SourceCandidate[] {
  if (
    typeof borrowed !== "object" || borrowed === null || types.isProxy(borrowed) ||
    (Object.getPrototypeOf(borrowed) !== Object.prototype &&
      Object.getPrototypeOf(borrowed) !== null) ||
    Object.getOwnPropertySymbols(borrowed).length !== 0
  ) integrityMismatch();
  const descriptors = Object.getOwnPropertyDescriptors(borrowed);
  const keys = Object.keys(descriptors);
  const candidates = descriptors.candidates;
  if (
    keys.length !== 1 || keys[0] !== "candidates" || candidates === undefined ||
    !("value" in candidates) || !candidates.enumerable ||
    !Array.isArray(candidates.value)
  ) integrityMismatch();
  return snapshotV2Candidates(candidates.value as readonly SourceCandidate[]);
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

function sourceLineage(
  slots: SloveniaCandidateSlots,
): Readonly<Record<SloveniaSourceId, ResearchSourceLineage>> {
  return Object.freeze({
    "si-digital-nomad-route": Object.freeze({
      navigationUrl: slots.routeGov?.url ?? "https://www.gov.si",
      ...(slots.routeLaw === undefined ? {} : { indexedSourceUrl: slots.routeLaw.url }),
    }),
    "si-income-threshold": Object.freeze({
      navigationUrl: slots.salary?.url ?? "https://pisrs.si",
      ...(slots.sistat === undefined ? {} : { indexedSourceUrl: slots.sistat.url }),
    }),
    "si-companion-employment": Object.freeze({
      navigationUrl: slots.companionEss?.url ?? "https://www.ess.gov.si",
      ...(slots.companionLaw === undefined ? {} : { indexedSourceUrl: slots.companionLaw.url }),
    }),
    "cbr-eur": Object.freeze({ navigationUrl: SOURCE_POLICIES["cbr-eur"].url }),
  });
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

  readonly sourceLineage: Readonly<Record<SloveniaSourceId, ResearchSourceLineage>>;

  constructor(candidates: readonly SourceCandidate[]) {
    this.slots = selectSloveniaCandidateSlots(candidates.map(snapshotCandidate));
    this.sourceLineage = sourceLineage(this.slots);
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
      const indexedSourceUrl = this.sourceLineage[request.sourceId].indexedSourceUrl;
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
    plan: createSloveniaPlan(source.sourceLineage),
    source,
  });
}

export interface SloveniaResearchV2 {
  readonly plan: ResearchPlan<SloveniaSourceId, ColdStartEvidenceClaimV2>;
  readonly source: OfficialSourcePort<SloveniaSourceId>;
}

export function createSloveniaResearchV2(input: {
  readonly candidates: readonly SourceCandidate[];
}): SloveniaResearchV2 {
  const source = new SloveniaSourceAdapter(snapshotV2ResearchInput(input));
  return Object.freeze({
    plan: createSloveniaPlanV2(source.sourceLineage),
    source,
  });
}
