import {
  COLD_START_ASSESSMENT_RULES_VERSION,
  assessColdStart,
  type ColdStartComparator,
} from "../decision/cold-start-assessment";
import {
  COLD_START_ASSESSMENT_V2_RULES_VERSION,
  assessColdStartV2,
  type ColdStartComparatorV2,
} from "../decision/cold-start-assessment-v2";
import { projectCountryAssessmentInputV2 } from "../decision/country-assessment-input-v2";
import {
  confirmRelocationProfile,
  type RelocationProfileDraft,
  type RelocationProfileSnapshot,
  type RelocationProfileV2Snapshot,
} from "../decision/relocation-profile";
import {
  reconstructCountryAssessmentProjectionV2,
  type CountryAssessmentProjectionV2,
} from "./country-assessment-projection-v2";
import type {
  ClaimKind,
  ColdStartEvidenceClaim,
  CountrySourceIndexPort,
  CountryRef,
  SloveniaSourceId,
  SourceCandidate,
} from "../research/cold-start-contracts";
import {
  REQUIRED_CLAIM_KINDS,
  resolveCountry,
} from "../research/country-registry";
import { isCompleteSloveniaSourceSet } from "../research/slovenia-source-set";
import type { InstalledCountryKnowledgeRevision } from "../research/country-knowledge";
import {
  buildCountryDossier,
  type DossierPublishResult,
  type DossierVersion,
} from "../research/dossier";
import type { EvidenceSnapshot, ParserEntry } from "../research/contracts";
import {
  SLOVENIA_V2_EVIDENCE_RULES_VERSION,
  SLOVENIA_V2_FORMAL_ROUTE_ID,
  SLOVENIA_V2_PARSER_VERSIONS,
  type ColdStartEvidenceClaimV2,
} from "../research/cold-start-contracts-v2";
import {
  buildCountryDossierV2,
  type DossierPublishResultV2,
  type DossierVersionV2,
} from "../research/dossier-v2";
import {
  assertSealedEvidenceStructure,
  sealEvidencePlan,
  type EvidenceIntegrity,
  type EvidenceProgress,
  type SealedEvidence,
  type TerminalEvidenceEntry,
} from "../research/research-plan";

const SOURCE_IDS = [
  "si-digital-nomad-route",
  "si-income-threshold",
  "si-companion-employment",
  "cbr-eur",
] as const satisfies readonly SloveniaSourceId[];

const SOURCE_LABELS: Readonly<Record<SloveniaSourceId, string>> = {
  "si-digital-nomad-route": "GOV.SI · цифровые кочевники и ZTuj-2",
  "si-income-threshold": "PISRS / SiStat · порог дохода",
  "si-companion-employment": "ESS / ZZSDT · занятость семьи",
  "cbr-eur": "Банк России · курс EUR/RUB",
};

const UNAVAILABLE_COUNTRY_SOURCE_NAVIGATION: Readonly<Record<SloveniaSourceId, string>> = {
  "si-digital-nomad-route": "https://www.gov.si",
  "si-income-threshold": "https://pisrs.si",
  "si-companion-employment": "https://www.ess.gov.si",
  "cbr-eur": "https://www.cbr.ru/scripts/XML_daily.asp",
};

const SLOVENIA_PARSER_VERSIONS: Readonly<Record<SloveniaSourceId, string>> = {
  "si-digital-nomad-route": "si-route@2",
  "si-income-threshold": "si-income@2",
  "si-companion-employment": "si-companion@2",
  "cbr-eur": "cbr-eur@1",
};

export interface ColdStartReadModelCommon {
  readonly runId: string;
  readonly country: CountryRef;
  readonly checkedAt: string;
  readonly evidenceSnapshotId: string;
  readonly knowledge: {
    readonly rankingRevisionId?: string;
    readonly currentRevisionId?: string;
    readonly updatedRevisionId?: string;
    readonly lastCheckedAt: string;
    readonly knowledgeUpdatedAt?: string;
  };
  readonly dossier?: {
    readonly id: string;
    readonly label: string;
    readonly publishedAt: string;
  };
  readonly coverage: {
    readonly verified: number;
    readonly required: 9;
    readonly claimKinds: readonly ClaimKind[];
  };
  readonly sourceNavigation: readonly {
    readonly label: string;
    readonly url: string;
  }[];
}

export interface ColdStartReadModel extends ColdStartReadModelCommon {
  readonly assessmentRulesVersion: "cold-start-assessment@1";
  readonly comparator: ColdStartComparator;
}

export type ColdStartReadModelV2 = ColdStartReadModelCommon & {
  readonly assessmentRulesVersion: "cold-start-assessment@2";
  readonly comparator: ColdStartComparatorV2;
  readonly assessmentProjection: CountryAssessmentProjectionV2;
};

export type ColdStartReadModelAny = ColdStartReadModel | ColdStartReadModelV2;

export type ColdStartEvent =
  | ColdStartEventBase<"source_discovered", {
      readonly candidateId: string;
      readonly url: string;
      readonly claimKinds: readonly ClaimKind[];
    }>
  | ColdStartEventBase<"authority_verified", {
      readonly candidateId: string;
      readonly authorityRoot: string;
    }>
  | ColdStartEventBase<"artifact_captured", {
      readonly sourceId: SloveniaSourceId;
      readonly role: string;
      readonly resolvedUrl: string;
      readonly sha256: string;
    }>
  | ColdStartEventBase<"claim_verified", {
      readonly claimId: string;
      readonly claimKind: ClaimKind | "fx_rate";
      readonly sourceIds: readonly SloveniaSourceId[];
    }>
  | ColdStartEventBase<"dossier_published", {
      readonly dossierVersionId: string;
      readonly label: string;
      readonly created: boolean;
    }>
  | ColdStartEventBase<"assessment_completed", {
      readonly readModel: ColdStartReadModel;
    }>;

export type ColdStartEventAny =
  | Exclude<ColdStartEvent, { readonly type: "assessment_completed" }>
  | ColdStartEventBase<"assessment_completed", {
      readonly readModel: ColdStartReadModelAny;
    }>;

export interface ColdStartEventBase<T extends string, P> {
  readonly runId: string;
  readonly sequence: number;
  readonly occurredAt: string;
  readonly country: CountryRef;
  readonly type: T;
  readonly payload: P;
}

export interface ColdStartPrepared {
  readonly runId: string;
  readonly profileId: string;
  readonly country: CountryRef;
  readonly assessmentAt: string;
  readonly deadlineAt: string;
}

export interface ColdStartApplication {
  prepare(input:
    | { readonly countryInput: string; readonly profile: RelocationProfileDraft }
    | { readonly countryInput: string; readonly profileId: string }
  ): Promise<ColdStartPrepared>;
  run(
    prepared: ColdStartPrepared,
    emit: (event: ColdStartEvent) => void | Promise<void>,
    signal: AbortSignal,
  ): Promise<ColdStartReadModel>;
  present(input: { readonly runId: string; readonly profileId: string }): Promise<ColdStartReadModel>;
}

export interface ColdStartApplicationAny extends ColdStartApplication {
  prepareAny(input: {
    readonly countryInput: string;
    readonly profileId: string;
  }): Promise<ColdStartPrepared>;
  runAny(
    prepared: ColdStartPrepared,
    emit: (event: ColdStartEventAny) => void | Promise<void>,
    signal: AbortSignal,
  ): Promise<ColdStartReadModelAny>;
  presentAny(input: {
    readonly runId: string;
    readonly profileId: string;
  }): Promise<ColdStartReadModelAny>;
}

export interface ColdStartResearchPrepareInput {
  readonly runId: string;
  readonly assessmentDate: string;
  readonly deadlineAt: string;
  readonly signal: AbortSignal;
  readonly contextHash: string;
  readonly knowledgeBaselineRevisionId?: string;
  readonly candidates: readonly SourceCandidate[];
  readonly onProgress: (
    progress: EvidenceProgress<SloveniaSourceId, ColdStartEvidenceClaim>,
  ) => void | Promise<void>;
}

export interface ColdStartVerifiedBundle {
  readonly snapshot: EvidenceSnapshot<SloveniaSourceId, ColdStartEvidenceClaim>;
  readonly entries: readonly ParserEntry<SloveniaSourceId>[];
}

export interface ColdStartVerifiedBundleV2 {
  readonly snapshot: EvidenceSnapshot<SloveniaSourceId, ColdStartEvidenceClaimV2>;
  readonly entries: readonly ParserEntry<SloveniaSourceId>[];
}

export interface ColdStartResearchPrepareInputV2 extends Omit<
  ColdStartResearchPrepareInput,
  "onProgress"
> {
  readonly onProgress: (
    progress: EvidenceProgress<SloveniaSourceId, ColdStartEvidenceClaimV2>,
  ) => void | Promise<void>;
}

export interface ColdStartApplicationPorts {
  readonly profiles: {
    appendRelocation(snapshot: RelocationProfileSnapshot): Promise<void>;
    loadRelocationVerified(id: string): Promise<RelocationProfileSnapshot>;
  };
  readonly countrySourceIndex: CountrySourceIndexPort;
  readonly research: {
    prepare(input: ColdStartResearchPrepareInput): Promise<
      SealedEvidence<SloveniaSourceId, ColdStartEvidenceClaim>
    >;
  };
  readonly evidence: {
    seal(sealed: SealedEvidence<SloveniaSourceId, ColdStartEvidenceClaim>): Promise<void>;
    loadVerifiedBundle(id: string): Promise<ColdStartVerifiedBundle>;
    replay(id: string): Promise<EvidenceSnapshot<SloveniaSourceId, ColdStartEvidenceClaim>>;
  };
  readonly dossiers: {
    publishWithEvidence(input: {
      readonly preparedEvidence: SealedEvidence<SloveniaSourceId, ColdStartEvidenceClaim>;
      readonly publishedAt: string;
    }): DossierPublishResult;
    findByPayload(
      countryCode: "SI",
      schemaVersion: "si-dossier@1",
      payloadHash: string,
    ): DossierVersion | undefined;
  };
  readonly knowledge: {
    publishCurrent(input: {
      readonly evidenceSnapshotId: string;
      readonly lastCheckedAt: string;
    }): Promise<{
      readonly publishedRevision?: InstalledCountryKnowledgeRevision;
      readonly currentRevision?: InstalledCountryKnowledgeRevision;
    }>;
    latest(countryCode: string): Promise<InstalledCountryKnowledgeRevision | undefined>;
    resolveForEvidence(evidenceSnapshotId: string): Promise<{
      readonly publishedRevision?: InstalledCountryKnowledgeRevision;
      readonly currentRevision?: InstalledCountryKnowledgeRevision;
    }>;
  };
  readonly integrity: EvidenceIntegrity;
  readonly clock: () => Date;
  readonly nextRunId: () => string;
}

export interface ColdStartApplicationPortsV2 extends Omit<
  ColdStartApplicationPorts,
  "profiles" | "research" | "evidence" | "dossiers"
> {
  readonly profiles: ColdStartApplicationPorts["profiles"] & {
    loadRelocationAnyVerified(
      id: string,
    ): Promise<RelocationProfileSnapshot | RelocationProfileV2Snapshot>;
  };
  readonly research: {
    prepare(input: ColdStartResearchPrepareInput): Promise<
      SealedEvidence<SloveniaSourceId, ColdStartEvidenceClaim>
    >;
    prepareV2(input: ColdStartResearchPrepareInputV2): Promise<
      SealedEvidence<SloveniaSourceId, ColdStartEvidenceClaimV2>
    >;
  };
  readonly evidence: {
    seal(sealed: SealedEvidence<SloveniaSourceId, ColdStartEvidenceClaim>): Promise<void>;
    loadVerifiedBundle(id: string): Promise<ColdStartVerifiedBundle>;
    replay(id: string): Promise<EvidenceSnapshot<SloveniaSourceId, ColdStartEvidenceClaim>>;
    sealV2(sealed: SealedEvidence<SloveniaSourceId, ColdStartEvidenceClaimV2>): Promise<void>;
    loadVerifiedBundleV2(id: string): Promise<ColdStartVerifiedBundleV2>;
    replayV2(id: string): Promise<EvidenceSnapshot<SloveniaSourceId, ColdStartEvidenceClaimV2>>;
  };
  readonly dossiers: {
    publishWithEvidence(input: {
      readonly preparedEvidence: SealedEvidence<SloveniaSourceId, ColdStartEvidenceClaim>;
      readonly publishedAt: string;
    }): DossierPublishResult;
    findByPayload(
      countryCode: "SI",
      schemaVersion: "si-dossier@1",
      payloadHash: string,
    ): DossierVersion | undefined;
    publishWithEvidenceV2(input: {
      readonly preparedEvidence: SealedEvidence<SloveniaSourceId, ColdStartEvidenceClaimV2>;
      readonly publishedAt: string;
    }): DossierPublishResultV2;
    findV2ByPayload(
      countryCode: "SI",
      payloadHash: string,
      evidenceSnapshotId: string,
    ): DossierVersionV2 | undefined;
  };
}

function isColdStartApplicationPortsV2(
  ports: ColdStartApplicationPorts,
): ports is ColdStartApplicationPortsV2 {
  return "loadRelocationAnyVerified" in ports.profiles &&
    typeof ports.profiles.loadRelocationAnyVerified === "function" &&
    "prepareV2" in ports.research && typeof ports.research.prepareV2 === "function" &&
    "sealV2" in ports.evidence && typeof ports.evidence.sealV2 === "function" &&
    "loadVerifiedBundleV2" in ports.evidence &&
    typeof ports.evidence.loadVerifiedBundleV2 === "function" &&
    "replayV2" in ports.evidence && typeof ports.evidence.replayV2 === "function" &&
    "publishWithEvidenceV2" in ports.dossiers &&
    typeof ports.dossiers.publishWithEvidenceV2 === "function" &&
    "findV2ByPayload" in ports.dossiers && typeof ports.dossiers.findV2ByPayload === "function";
}

type ColdStartEventDraft = ColdStartEvent extends infer E
  ? E extends ColdStartEvent
    ? Pick<E, "type" | "payload">
    : never
  : never;

function integrityMismatch(): never {
  throw new Error("integrity_mismatch");
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function abortReason(signal: AbortSignal): never {
  if (signal.reason instanceof Error) throw signal.reason;
  throw new DOMException("The operation was aborted", "AbortError");
}

function snapshotPayload(
  snapshot: EvidenceSnapshot<SloveniaSourceId, ColdStartEvidenceClaim>,
): Omit<typeof snapshot, "manifestHash" | "hmac"> {
  return {
    id: snapshot.id,
    assessmentDate: snapshot.assessmentDate,
    artifactIds: snapshot.artifactIds,
    claims: snapshot.claims,
    blockers: snapshot.blockers,
    coverage: snapshot.coverage,
    parserVersions: snapshot.parserVersions,
    rulesVersion: snapshot.rulesVersion,
    ...(snapshot.contextHash === undefined ? {} : { contextHash: snapshot.contextHash }),
    ...(snapshot.knowledgeBaselineRevisionId === undefined
      ? {}
      : { knowledgeBaselineRevisionId: snapshot.knowledgeBaselineRevisionId }),
  };
}

function snapshotPayloadV2(
  snapshot: EvidenceSnapshot<SloveniaSourceId, ColdStartEvidenceClaimV2>,
): Omit<typeof snapshot, "manifestHash" | "hmac"> {
  return {
    id: snapshot.id,
    assessmentDate: snapshot.assessmentDate,
    artifactIds: snapshot.artifactIds,
    claims: snapshot.claims,
    blockers: snapshot.blockers,
    coverage: snapshot.coverage,
    parserVersions: snapshot.parserVersions,
    rulesVersion: snapshot.rulesVersion,
    ...(snapshot.contextHash === undefined ? {} : { contextHash: snapshot.contextHash }),
    ...(snapshot.knowledgeBaselineRevisionId === undefined
      ? {}
      : { knowledgeBaselineRevisionId: snapshot.knowledgeBaselineRevisionId }),
  };
}

function verifyPrepared(
  prepared: SealedEvidence<SloveniaSourceId, ColdStartEvidenceClaim>,
  expected: {
    readonly runId: string;
    readonly assessmentAt: string;
    readonly contextHash: string;
    readonly knowledgeBaselineRevisionId: string | undefined;
  },
  integrity: EvidenceIntegrity,
): void {
  assertSealedEvidenceStructure(prepared, SOURCE_IDS);
  const canonicalManifest = integrity.canonical(prepared.manifest);
  if (
    prepared.snapshot.id !== `${expected.runId}:evidence` ||
    prepared.snapshot.assessmentDate !== expected.assessmentAt ||
    prepared.snapshot.contextHash !== expected.contextHash ||
    prepared.snapshot.knowledgeBaselineRevisionId !== expected.knowledgeBaselineRevisionId ||
    prepared.snapshot.rulesVersion !== "vs2-si-evidence@2" ||
    prepared.canonicalManifest !== canonicalManifest ||
    integrity.canonical(prepared.manifest.snapshot) !==
      integrity.canonical(snapshotPayload(prepared.snapshot)) ||
    prepared.snapshot.manifestHash !== integrity.hash(canonicalManifest) ||
    prepared.snapshot.hmac !== integrity.sign(canonicalManifest)
  ) integrityMismatch();
}

function verifyPreparedV2(
  prepared: SealedEvidence<SloveniaSourceId, ColdStartEvidenceClaimV2>,
  expected: {
    readonly runId: string;
    readonly assessmentAt: string;
    readonly contextHash: string;
    readonly knowledgeBaselineRevisionId: string | undefined;
  },
  integrity: EvidenceIntegrity,
): void {
  assertSealedEvidenceStructure(prepared, SOURCE_IDS);
  const canonicalManifest = integrity.canonical(prepared.manifest);
  if (
    prepared.snapshot.id !== `${expected.runId}:evidence` ||
    prepared.snapshot.assessmentDate !== expected.assessmentAt ||
    prepared.snapshot.contextHash !== expected.contextHash ||
    prepared.snapshot.knowledgeBaselineRevisionId !== expected.knowledgeBaselineRevisionId ||
    prepared.snapshot.rulesVersion !== SLOVENIA_V2_EVIDENCE_RULES_VERSION ||
    integrity.canonical(prepared.snapshot.parserVersions) !==
      integrity.canonical(SLOVENIA_V2_PARSER_VERSIONS) ||
    prepared.canonicalManifest !== canonicalManifest ||
    integrity.canonical(prepared.manifest.snapshot) !==
      integrity.canonical(snapshotPayloadV2(prepared.snapshot)) ||
    prepared.snapshot.manifestHash !== integrity.hash(canonicalManifest) ||
    prepared.snapshot.hmac !== integrity.sign(canonicalManifest)
  ) integrityMismatch();
}

function sourceNavigation(
  bundle: ColdStartVerifiedBundle | ColdStartVerifiedBundleV2,
): Readonly<Record<SloveniaSourceId, string>> {
  if (
    bundle.entries.length !== SOURCE_IDS.length ||
    SOURCE_IDS.some((sourceId) =>
      bundle.entries.filter((entry) => entry.sourceId === sourceId).length !== 1
    )
  ) integrityMismatch();
  return Object.fromEntries(SOURCE_IDS.map((sourceId) => [
    sourceId,
    bundle.entries.find((entry) => entry.sourceId === sourceId)!.navigationUrl,
  ])) as Record<SloveniaSourceId, string>;
}

function sourceResolvedEvidence(
  bundle: ColdStartVerifiedBundle | ColdStartVerifiedBundleV2,
): Readonly<Record<SloveniaSourceId, string>> {
  return Object.fromEntries(SOURCE_IDS.map((sourceId) => {
    const entry = bundle.entries.find((candidate) => candidate.sourceId === sourceId);
    if (entry === undefined) integrityMismatch();
    return [sourceId, entry.resolvedEvidenceUrl];
  })) as Record<SloveniaSourceId, string>;
}

function terminalEntries(
  bundle: ColdStartVerifiedBundle,
): readonly TerminalEvidenceEntry<SloveniaSourceId, ColdStartEvidenceClaim>[] {
  return SOURCE_IDS.map((sourceId) => {
    const parserEntry = bundle.entries.find((entry) => entry.sourceId === sourceId);
    if (parserEntry === undefined) integrityMismatch();
    if (bundle.snapshot.coverage[sourceId] === "verified") {
      const claims = bundle.snapshot.claims.filter((claim) => claim.sourceId === sourceId);
      if (claims.length === 0) integrityMismatch();
      return { sourceId, parserEntry, coverage: "verified" as const, claims };
    }
    const blockers = bundle.snapshot.blockers.filter((blocker) => blocker.sourceId === sourceId);
    if (bundle.snapshot.coverage[sourceId] !== "unavailable" || blockers.length !== 1) {
      integrityMismatch();
    }
    return { sourceId, parserEntry, coverage: "unavailable" as const, blocker: blockers[0]! };
  });
}

function terminalEntriesV2(
  bundle: ColdStartVerifiedBundleV2,
): readonly TerminalEvidenceEntry<SloveniaSourceId, ColdStartEvidenceClaimV2>[] {
  return SOURCE_IDS.map((sourceId) => {
    const parserEntry = bundle.entries.find((entry) => entry.sourceId === sourceId);
    if (parserEntry === undefined) integrityMismatch();
    if (bundle.snapshot.coverage[sourceId] === "verified") {
      const claims = bundle.snapshot.claims.filter((claim) => claim.sourceId === sourceId);
      if (claims.length === 0) integrityMismatch();
      return { sourceId, parserEntry, coverage: "verified" as const, claims };
    }
    const blockers = bundle.snapshot.blockers.filter((blocker) => blocker.sourceId === sourceId);
    if (bundle.snapshot.coverage[sourceId] !== "unavailable" || blockers.length !== 1) {
      integrityMismatch();
    }
    return { sourceId, parserEntry, coverage: "unavailable" as const, blocker: blockers[0]! };
  });
}

function publicationAllowed(
  prepared: SealedEvidence<SloveniaSourceId, ColdStartEvidenceClaim>,
): boolean {
  try {
    buildCountryDossier(prepared);
    return true;
  } catch (error) {
    if (error instanceof Error && error.message === "publication_not_allowed") return false;
    throw error;
  }
}

function publicationAllowedV2(
  prepared: SealedEvidence<SloveniaSourceId, ColdStartEvidenceClaimV2>,
): boolean {
  try {
    buildCountryDossierV2(prepared);
    return true;
  } catch (error) {
    if (error instanceof Error && error.message === "publication_not_allowed") return false;
    throw error;
  }
}

function dossierRouteOrderV2(dossier: DossierVersionV2): readonly string[] {
  const routes = dossier.payload.claims.flatMap((claim) => {
    if (claim.claimKind !== "route_basis") return [];
    const value = claim.value as { readonly route?: unknown };
    return value.route === "temporary_residence_digital_nomad"
      ? [SLOVENIA_V2_FORMAL_ROUTE_ID]
      : integrityMismatch();
  });
  if (routes.length !== 1 || new Set(routes).size !== routes.length) integrityMismatch();
  return routes;
}

function contextHash(
  runId: string,
  profileId: string,
  integrity: EvidenceIntegrity,
): string {
  return integrity.hash(integrity.canonical({ runId, profileId }));
}

function countryNotInstalledEvidence(
  prepared: ColdStartPrepared,
  expectedContextHash: string,
  knowledgeBaselineRevisionId: string | undefined,
  integrity: EvidenceIntegrity,
): Promise<SealedEvidence<SloveniaSourceId, ColdStartEvidenceClaim>> {
  const entries: readonly TerminalEvidenceEntry<SloveniaSourceId, ColdStartEvidenceClaim>[] =
    SOURCE_IDS.map((sourceId) => {
      const navigationUrl = UNAVAILABLE_COUNTRY_SOURCE_NAVIGATION[sourceId];
      return {
        sourceId,
        parserEntry: {
          sourceId,
          navigationUrl,
          resolvedEvidenceUrl: navigationUrl,
          artifacts: [],
        },
        coverage: "unavailable" as const,
        blocker: {
          sourceId,
          kind: "country_not_installed" as const,
          navigationUrl,
          artifactIds: [],
        },
      };
    });
  return sealEvidencePlan({
    id: `${prepared.runId}:evidence`,
    assessmentDate: prepared.assessmentAt,
    entries,
    sourceIds: SOURCE_IDS,
    parserVersions: SLOVENIA_PARSER_VERSIONS,
    rulesVersion: "vs2-si-evidence@2",
    contextHash: expectedContextHash,
    ...(knowledgeBaselineRevisionId === undefined ? {} : { knowledgeBaselineRevisionId }),
  }, integrity);
}

function countryNotInstalledEvidenceV2(
  prepared: ColdStartPrepared,
  expectedContextHash: string,
  knowledgeBaselineRevisionId: string | undefined,
  integrity: EvidenceIntegrity,
): Promise<SealedEvidence<SloveniaSourceId, ColdStartEvidenceClaimV2>> {
  const entries: readonly TerminalEvidenceEntry<SloveniaSourceId, ColdStartEvidenceClaimV2>[] =
    SOURCE_IDS.map((sourceId) => {
      const navigationUrl = UNAVAILABLE_COUNTRY_SOURCE_NAVIGATION[sourceId];
      return {
        sourceId,
        parserEntry: {
          sourceId,
          navigationUrl,
          resolvedEvidenceUrl: navigationUrl,
          artifacts: [],
        },
        coverage: "unavailable" as const,
        blocker: {
          sourceId,
          kind: "country_not_installed" as const,
          navigationUrl,
          artifactIds: [],
        },
      };
    });
  return sealEvidencePlan({
    id: `${prepared.runId}:evidence`,
    assessmentDate: prepared.assessmentAt,
    entries,
    sourceIds: SOURCE_IDS,
    parserVersions: SLOVENIA_V2_PARSER_VERSIONS,
    rulesVersion: SLOVENIA_V2_EVIDENCE_RULES_VERSION,
    contextHash: expectedContextHash,
    ...(knowledgeBaselineRevisionId === undefined ? {} : { knowledgeBaselineRevisionId }),
  }, integrity);
}

function eventEmitter(
  prepared: ColdStartPrepared,
  emit: (event: ColdStartEvent) => void | Promise<void>,
  clock: () => Date,
): {
  readonly send: (event: ColdStartEventDraft) => Promise<void>;
  readonly settled: () => Promise<void>;
} {
  let sequence = 0;
  let tail = Promise.resolve();
  const send = (draft: ColdStartEventDraft): Promise<void> => {
    tail = tail.then(async () => {
      const event = deepFreeze({
        runId: prepared.runId,
        sequence: ++sequence,
        occurredAt: clock().toISOString(),
        country: prepared.country,
        type: draft.type,
        payload: draft.payload,
      }) as unknown as ColdStartEvent;
      await emit(event);
    });
    return tail;
  };
  return { send, settled: () => tail };
}

type ColdStartEventAnyDraft = ColdStartEventAny extends infer E
  ? E extends ColdStartEventAny
    ? Pick<E, "type" | "payload">
    : never
  : never;

function eventEmitterAny(
  prepared: ColdStartPrepared,
  emit: (event: ColdStartEventAny) => void | Promise<void>,
  clock: () => Date,
): {
  readonly send: (event: ColdStartEventAnyDraft) => Promise<void>;
  readonly settled: () => Promise<void>;
} {
  let sequence = 0;
  let tail = Promise.resolve();
  const send = (draft: ColdStartEventAnyDraft): Promise<void> => {
    tail = tail.then(async () => {
      const event = deepFreeze({
        runId: prepared.runId,
        sequence: ++sequence,
        occurredAt: clock().toISOString(),
        country: prepared.country,
        type: draft.type,
        payload: draft.payload,
      }) as unknown as ColdStartEventAny;
      await emit(event);
    });
    return tail;
  };
  return { send, settled: () => tail };
}

function progressPayload(
  progress: EvidenceProgress<SloveniaSourceId, ColdStartEvidenceClaim>,
): ColdStartEventDraft {
  if (progress.type === "artifact_captured") {
    return {
      type: "artifact_captured",
      payload: {
        sourceId: progress.sourceId,
        role: progress.artifact.role,
        resolvedUrl: progress.artifact.responseUrl,
        sha256: progress.artifact.sha256,
      },
    };
  }
  if ("claimKind" in progress.claim) {
    return {
      type: "claim_verified",
      payload: {
        claimId: progress.claim.claimId,
        claimKind: progress.claim.claimKind,
        sourceIds: [...new Set(progress.claim.evidence.map(({ sourceId }) => sourceId))],
      },
    };
  }
  return {
    type: "claim_verified",
    payload: {
      claimId: progress.claim.claimId,
      claimKind: "fx_rate",
      sourceIds: ["cbr-eur"],
    },
  };
}

function progressPayloadV2(
  progress: EvidenceProgress<SloveniaSourceId, ColdStartEvidenceClaimV2>,
): ColdStartEventAnyDraft {
  if (progress.type === "artifact_captured") {
    return {
      type: "artifact_captured",
      payload: {
        sourceId: progress.sourceId,
        role: progress.artifact.role,
        resolvedUrl: progress.artifact.responseUrl,
        sha256: progress.artifact.sha256,
      },
    };
  }
  if ("claimKind" in progress.claim) {
    return {
      type: "claim_verified",
      payload: {
        claimId: progress.claim.claimId,
        claimKind: progress.claim.claimKind,
        sourceIds: [...new Set(progress.claim.evidence.map(({ sourceId }) => sourceId))],
      },
    };
  }
  return {
    type: "claim_verified",
    payload: {
      claimId: progress.claim.claimId,
      claimKind: "fx_rate",
      sourceIds: ["cbr-eur"],
    },
  };
}

export function createColdStartApplication(
  ports: ColdStartApplicationPortsV2,
): ColdStartApplicationAny;
export function createColdStartApplication(
  ports: ColdStartApplicationPorts,
): ColdStartApplication;
export function createColdStartApplication(
  ports: ColdStartApplicationPorts,
): ColdStartApplication {
  const portsV2 = isColdStartApplicationPortsV2(ports) ? ports : undefined;
  const requireV2Ports = (): ColdStartApplicationPortsV2 => {
    if (portsV2 === undefined) integrityMismatch();
    return portsV2;
  };
  const loadReadModel = async (
    runId: string,
    profileId: string,
  ): Promise<ColdStartReadModel> => {
    const resolved = resolveCountry("SI");
    if (!resolved.ok) integrityMismatch();
    const profile = await ports.profiles.loadRelocationVerified(profileId);
    if (profile.id !== profileId) integrityMismatch();
    const bundle = await ports.evidence.loadVerifiedBundle(`${runId}:evidence`);
    const expectedContextHash = contextHash(runId, profileId, ports.integrity);
    if (bundle.snapshot.contextHash !== expectedContextHash) integrityMismatch();
    const replayed = await ports.evidence.replay(bundle.snapshot.id);
    if (ports.integrity.canonical(replayed) !== ports.integrity.canonical(bundle.snapshot)) {
      integrityMismatch();
    }
    const rebuilt = await sealEvidencePlan({
      id: replayed.id,
      assessmentDate: replayed.assessmentDate,
      entries: terminalEntries(bundle),
      sourceIds: SOURCE_IDS,
      parserVersions: replayed.parserVersions,
      rulesVersion: replayed.rulesVersion,
      contextHash: expectedContextHash,
      ...(replayed.knowledgeBaselineRevisionId === undefined
        ? {}
        : { knowledgeBaselineRevisionId: replayed.knowledgeBaselineRevisionId }),
    }, ports.integrity);
    if (ports.integrity.canonical(rebuilt.snapshot) !== ports.integrity.canonical(replayed)) {
      integrityMismatch();
    }

    let dossier: DossierVersion | undefined;
    if (publicationAllowed(rebuilt)) {
      const payload = buildCountryDossier(rebuilt);
      dossier = ports.dossiers.findByPayload(
        "SI",
        "si-dossier@1",
        ports.integrity.hash(ports.integrity.canonical(payload)),
      );
      if (dossier === undefined) integrityMismatch();
    }
    const navigation = sourceNavigation(bundle);
    const comparator = assessColdStart({
      assessmentAt: replayed.assessmentDate,
      profile,
      evidence: replayed,
      ...(dossier === undefined ? {} : { dossier }),
      sourceNavigation: navigation,
      sourceResolvedEvidence: sourceResolvedEvidence(bundle),
    });
    const claimKinds = REQUIRED_CLAIM_KINDS.filter((kind) =>
      replayed.claims.some((claim) => "claimKind" in claim && claim.claimKind === kind)
    );
    const knowledgePublication = await ports.knowledge.resolveForEvidence(replayed.id);
    const currentKnowledge = knowledgePublication.currentRevision;
    const updatedKnowledge = knowledgePublication.publishedRevision;
    if (
      updatedKnowledge !== undefined &&
      (updatedKnowledge.triggerEvidenceSnapshotId !== replayed.id ||
        currentKnowledge?.id !== updatedKnowledge.id)
    ) integrityMismatch();
    const knowledge = {
      ...(currentKnowledge === undefined
        ? {}
        : {
            currentRevisionId: currentKnowledge.id,
            ...(updatedKnowledge === undefined ? {} : { updatedRevisionId: updatedKnowledge.id }),
            knowledgeUpdatedAt: currentKnowledge.createdAt,
          }),
      lastCheckedAt: replayed.assessmentDate,
    };
    return deepFreeze({
      runId,
      country: resolved.country,
      checkedAt: replayed.assessmentDate,
      evidenceSnapshotId: replayed.id,
      assessmentRulesVersion: COLD_START_ASSESSMENT_RULES_VERSION,
      knowledge,
      ...(dossier === undefined
        ? {}
        : {
            dossier: {
              id: dossier.id,
              label: `Словения · досье v${dossier.ordinal}`,
              publishedAt: dossier.publishedAt,
            },
          }),
      coverage: {
        verified: claimKinds.length,
        required: 9,
        claimKinds,
      },
      comparator,
      sourceNavigation: SOURCE_IDS.flatMap((sourceId) => {
        const entry = bundle.entries.find((candidate) => candidate.sourceId === sourceId);
        if (entry === undefined) integrityMismatch();
        return entry.artifacts.length === 0
          ? []
          : [{ label: SOURCE_LABELS[sourceId], url: navigation[sourceId] }];
      }),
    });
  };

  const loadReadModelV2 = async (
    runId: string,
    requestedProfileId: string,
    loadedProfile?: RelocationProfileV2Snapshot,
  ): Promise<ColdStartReadModelV2> => {
    const resolved = resolveCountry("SI");
    if (!resolved.ok) integrityMismatch();
    const profile = loadedProfile ?? await requireV2Ports().profiles.loadRelocationAnyVerified(
      requestedProfileId,
    );
    if (profile.id !== requestedProfileId || profile.schemaVersion !== "relocation-profile@2") {
      integrityMismatch();
    }
    const bundle = await requireV2Ports().evidence.loadVerifiedBundleV2(`${runId}:evidence`);
    const expectedContextHash = contextHash(runId, requestedProfileId, ports.integrity);
    if (bundle.snapshot.contextHash !== expectedContextHash) integrityMismatch();
    const replayed = await requireV2Ports().evidence.replayV2(bundle.snapshot.id);
    if (ports.integrity.canonical(replayed) !== ports.integrity.canonical(bundle.snapshot)) {
      integrityMismatch();
    }
    const rebuilt = await sealEvidencePlan({
      id: replayed.id,
      assessmentDate: replayed.assessmentDate,
      entries: terminalEntriesV2(bundle),
      sourceIds: SOURCE_IDS,
      parserVersions: replayed.parserVersions,
      rulesVersion: replayed.rulesVersion,
      contextHash: expectedContextHash,
      ...(replayed.knowledgeBaselineRevisionId === undefined
        ? {}
        : { knowledgeBaselineRevisionId: replayed.knowledgeBaselineRevisionId }),
    }, ports.integrity);
    if (ports.integrity.canonical(rebuilt.snapshot) !== ports.integrity.canonical(replayed)) {
      integrityMismatch();
    }

    let dossier: DossierVersionV2 | undefined;
    if (publicationAllowedV2(rebuilt)) {
      const payload = buildCountryDossierV2(rebuilt);
      dossier = requireV2Ports().dossiers.findV2ByPayload(
        "SI",
        ports.integrity.hash(ports.integrity.canonical(payload)),
        replayed.id,
      );
      if (dossier === undefined) integrityMismatch();
    }
    const navigation = sourceNavigation(bundle);
    const comparator = assessColdStartV2({
      assessmentAt: replayed.assessmentDate,
      profile: projectCountryAssessmentInputV2(profile),
      evidence: replayed,
      ...(dossier === undefined ? {} : { dossier }),
      sourceNavigation: navigation,
      sourceResolvedEvidence: sourceResolvedEvidence(bundle),
    });
    const orderedPairs = dossier === undefined
      ? []
      : dossierRouteOrderV2(dossier).flatMap((routeId) =>
          profile.profile.participants.map(({ participantId }) => ({ routeId, participantId }))
        );
    const assessmentProjection = reconstructCountryAssessmentProjectionV2({
      schemaVersion: "country-assessment-projection@2",
      profileSnapshotId: profile.id,
      evidenceSnapshotId: replayed.id,
      participantAssessments: comparator.participantAssessments,
    }, {
      profileSnapshotId: profile.id,
      evidenceSnapshotId: replayed.id,
      orderedPairs,
    });
    const claimKinds = REQUIRED_CLAIM_KINDS.filter((kind) =>
      replayed.claims.some((claim) => "claimKind" in claim && claim.claimKind === kind)
    );
    const knowledgePublication = await ports.knowledge.resolveForEvidence(replayed.id);
    const currentKnowledge = knowledgePublication.currentRevision;
    const updatedKnowledge = knowledgePublication.publishedRevision;
    if (
      updatedKnowledge !== undefined &&
      (updatedKnowledge.triggerEvidenceSnapshotId !== replayed.id ||
        currentKnowledge?.id !== updatedKnowledge.id)
    ) integrityMismatch();
    const knowledge = {
      ...(currentKnowledge === undefined
        ? {}
        : {
            currentRevisionId: currentKnowledge.id,
            ...(updatedKnowledge === undefined ? {} : { updatedRevisionId: updatedKnowledge.id }),
            knowledgeUpdatedAt: currentKnowledge.createdAt,
          }),
      lastCheckedAt: replayed.assessmentDate,
    };
    return deepFreeze({
      runId,
      country: resolved.country,
      checkedAt: replayed.assessmentDate,
      evidenceSnapshotId: replayed.id,
      assessmentRulesVersion: COLD_START_ASSESSMENT_V2_RULES_VERSION,
      knowledge,
      ...(dossier === undefined
        ? {}
        : {
            dossier: {
              id: dossier.id,
              label: `Словения · досье v${dossier.ordinal}`,
              publishedAt: dossier.publishedAt,
            },
          }),
      coverage: {
        verified: claimKinds.length,
        required: 9 as const,
        claimKinds,
      },
      comparator,
      assessmentProjection,
      sourceNavigation: SOURCE_IDS.flatMap((sourceId) => {
        const entry = bundle.entries.find((candidate) => candidate.sourceId === sourceId);
        if (entry === undefined) integrityMismatch();
        return entry.artifacts.length === 0
          ? []
          : [{ label: SOURCE_LABELS[sourceId], url: navigation[sourceId] }];
      }),
    });
  };

  const prepareCore = async (
    input:
      | { readonly countryInput: string; readonly profile: RelocationProfileDraft }
      | { readonly countryInput: string; readonly profileId: string },
  ): Promise<ColdStartPrepared> => {
      const resolved = resolveCountry(input.countryInput);
      if (!resolved.ok) throw new Error(resolved.kind);
      const now = ports.clock();
      const nowIso = now.toISOString();
      let profile: RelocationProfileSnapshot;
      if ("profile" in input) {
        profile = confirmRelocationProfile(input.profile, () => now);
        await ports.profiles.appendRelocation(profile);
      } else {
        profile = await ports.profiles.loadRelocationVerified(input.profileId);
        if (profile.id !== input.profileId) integrityMismatch();
      }
      return deepFreeze({
        runId: ports.nextRunId(),
        profileId: profile.id,
        country: resolved.country,
        assessmentAt: nowIso.slice(0, 10),
        deadlineAt: new Date(now.valueOf() + 60_000).toISOString(),
      });
  };

  const prepareAnyCore = async (input: {
    readonly countryInput: string;
    readonly profileId: string;
  }): Promise<ColdStartPrepared> => {
    const resolved = resolveCountry(input.countryInput);
    if (!resolved.ok) throw new Error(resolved.kind);
    const profile = await requireV2Ports().profiles.loadRelocationAnyVerified(input.profileId);
    if (profile.id !== input.profileId) integrityMismatch();
    const now = ports.clock();
    return deepFreeze({
      runId: ports.nextRunId(),
      profileId: profile.id,
      country: resolved.country,
      assessmentAt: now.toISOString().slice(0, 10),
      deadlineAt: new Date(now.valueOf() + 60_000).toISOString(),
    });
  };

  const runV2 = async (
    prepared: ColdStartPrepared,
    profile: RelocationProfileV2Snapshot,
    emit: (event: ColdStartEventAny) => void | Promise<void>,
    signal: AbortSignal,
  ): Promise<ColdStartReadModelV2> => {
    if (signal.aborted) abortReason(signal);
    const knowledgeBaseline = await ports.knowledge.latest("SI");
    if (knowledgeBaseline !== undefined && knowledgeBaseline.countryCode !== "SI") {
      integrityMismatch();
    }
    const knowledgeBaselineRevisionId = knowledgeBaseline?.id;
    const events = eventEmitterAny(prepared, emit, ports.clock);
    const indexed = ports.countrySourceIndex.lookup(prepared.country.code);
    if (signal.aborted) abortReason(signal);
    const expectedContextHash = contextHash(
      prepared.runId,
      prepared.profileId,
      ports.integrity,
    );
    if (!indexed.ok || !isCompleteSloveniaSourceSet(indexed.candidates)) {
      const preparedEvidence = await countryNotInstalledEvidenceV2(
        prepared,
        expectedContextHash,
        knowledgeBaselineRevisionId,
        ports.integrity,
      );
      verifyPreparedV2(preparedEvidence, {
        runId: prepared.runId,
        assessmentAt: prepared.assessmentAt,
        contextHash: expectedContextHash,
        knowledgeBaselineRevisionId,
      }, ports.integrity);
      if (signal.aborted) abortReason(signal);
      await requireV2Ports().evidence.sealV2(preparedEvidence);
      await ports.knowledge.publishCurrent({
        evidenceSnapshotId: preparedEvidence.snapshot.id,
        lastCheckedAt: preparedEvidence.snapshot.assessmentDate,
      });
      const readModel = await loadReadModelV2(prepared.runId, prepared.profileId, profile);
      await events.send({ type: "assessment_completed", payload: { readModel } });
      return readModel;
    }
    const candidates = indexed.candidates;
    for (const candidate of candidates) {
      await events.send({
        type: "source_discovered",
        payload: {
          candidateId: candidate.candidateId,
          url: candidate.url,
          claimKinds: [...candidate.claimKinds],
        },
      });
      await events.send({
        type: "authority_verified",
        payload: {
          candidateId: candidate.candidateId,
          authorityRoot: candidate.authorityRoot,
        },
      });
    }

    const preparedEvidence = await requireV2Ports().research.prepareV2({
      runId: prepared.runId,
      assessmentDate: prepared.assessmentAt,
      deadlineAt: prepared.deadlineAt,
      signal,
      contextHash: expectedContextHash,
      ...(knowledgeBaselineRevisionId === undefined ? {} : { knowledgeBaselineRevisionId }),
      candidates,
      onProgress: async (progress) => {
        await events.send(progressPayloadV2(progress));
      },
    });
    await events.settled();
    verifyPreparedV2(preparedEvidence, {
      runId: prepared.runId,
      assessmentAt: prepared.assessmentAt,
      contextHash: expectedContextHash,
      knowledgeBaselineRevisionId,
    }, ports.integrity);

    const canPublish = publicationAllowedV2(preparedEvidence);
    if (signal.aborted) abortReason(signal);
    let publication: DossierPublishResultV2 | undefined;
    if (canPublish) {
      publication = requireV2Ports().dossiers.publishWithEvidenceV2({
        preparedEvidence,
        publishedAt: ports.clock().toISOString(),
      });
    } else {
      await requireV2Ports().evidence.sealV2(preparedEvidence);
    }
    const knowledgePublication = await ports.knowledge.publishCurrent({
      evidenceSnapshotId: preparedEvidence.snapshot.id,
      lastCheckedAt: preparedEvidence.snapshot.assessmentDate,
    });

    const readModel = await loadReadModelV2(prepared.runId, prepared.profileId, profile);
    if (
      readModel.knowledge.currentRevisionId !== knowledgePublication.currentRevision?.id ||
      readModel.knowledge.updatedRevisionId !== knowledgePublication.publishedRevision?.id
    ) integrityMismatch();
    if (publication !== undefined) {
      if (readModel.dossier?.id !== publication.version.id) integrityMismatch();
      await events.send({
        type: "dossier_published",
        payload: {
          dossierVersionId: publication.version.id,
          label: `Словения · досье v${publication.version.ordinal}`,
          created: publication.created,
        },
      });
    }
    await events.send({ type: "assessment_completed", payload: { readModel } });
    return readModel;
  };

  const applicationV1: ColdStartApplication = {
    prepare(input): Promise<ColdStartPrepared> {
      return prepareCore(input);
    },

    async run(prepared, emit, signal): Promise<ColdStartReadModel> {
      if (signal.aborted) abortReason(signal);
      const resolved = resolveCountry(prepared.country.code);
      if (
        !resolved.ok ||
        ports.integrity.canonical(resolved.country) !== ports.integrity.canonical(prepared.country)
      ) integrityMismatch();
      const profile = await ports.profiles.loadRelocationVerified(prepared.profileId);
      if (profile.id !== prepared.profileId) integrityMismatch();
      const knowledgeBaseline = await ports.knowledge.latest("SI");
      if (knowledgeBaseline !== undefined && knowledgeBaseline.countryCode !== "SI") {
        integrityMismatch();
      }
      const knowledgeBaselineRevisionId = knowledgeBaseline?.id;
      const events = eventEmitter(prepared, emit, ports.clock);
      const indexed = ports.countrySourceIndex.lookup(prepared.country.code);
      if (signal.aborted) abortReason(signal);
      const expectedContextHash = contextHash(
        prepared.runId,
        prepared.profileId,
        ports.integrity,
      );
      if (!indexed.ok || !isCompleteSloveniaSourceSet(indexed.candidates)) {
        const preparedEvidence = await countryNotInstalledEvidence(
          prepared,
          expectedContextHash,
          knowledgeBaselineRevisionId,
          ports.integrity,
        );
        verifyPrepared(preparedEvidence, {
          runId: prepared.runId,
          assessmentAt: prepared.assessmentAt,
          contextHash: expectedContextHash,
          knowledgeBaselineRevisionId,
        }, ports.integrity);
        if (signal.aborted) abortReason(signal);
        await ports.evidence.seal(preparedEvidence);
        await ports.knowledge.publishCurrent({
          evidenceSnapshotId: preparedEvidence.snapshot.id,
          lastCheckedAt: preparedEvidence.snapshot.assessmentDate,
        });
        const readModel = await loadReadModel(prepared.runId, prepared.profileId);
        await events.send({ type: "assessment_completed", payload: { readModel } });
        return readModel;
      }
      const candidates = indexed.candidates;
      for (const candidate of candidates) {
        await events.send({
          type: "source_discovered",
          payload: {
            candidateId: candidate.candidateId,
            url: candidate.url,
            claimKinds: [...candidate.claimKinds],
          },
        });
        await events.send({
          type: "authority_verified",
          payload: {
            candidateId: candidate.candidateId,
            authorityRoot: candidate.authorityRoot,
          },
        });
      }

      const preparedEvidence = await ports.research.prepare({
        runId: prepared.runId,
        assessmentDate: prepared.assessmentAt,
        deadlineAt: prepared.deadlineAt,
        signal,
        contextHash: expectedContextHash,
        ...(knowledgeBaselineRevisionId === undefined ? {} : { knowledgeBaselineRevisionId }),
        candidates,
        onProgress: async (progress) => {
          await events.send(progressPayload(progress));
        },
      });
      await events.settled();
      verifyPrepared(preparedEvidence, {
        runId: prepared.runId,
        assessmentAt: prepared.assessmentAt,
        contextHash: expectedContextHash,
        knowledgeBaselineRevisionId,
      }, ports.integrity);

      const canPublish = publicationAllowed(preparedEvidence);
      if (signal.aborted) abortReason(signal);
      let publication: DossierPublishResult | undefined;
      if (canPublish) {
        publication = ports.dossiers.publishWithEvidence({
          preparedEvidence,
          publishedAt: ports.clock().toISOString(),
        });
      } else {
        await ports.evidence.seal(preparedEvidence);
      }
      const knowledgePublication = await ports.knowledge.publishCurrent({
        evidenceSnapshotId: preparedEvidence.snapshot.id,
        lastCheckedAt: preparedEvidence.snapshot.assessmentDate,
      });

      const readModel = await loadReadModel(prepared.runId, prepared.profileId);
      if (
        readModel.knowledge.currentRevisionId !== knowledgePublication.currentRevision?.id ||
        readModel.knowledge.updatedRevisionId !== knowledgePublication.publishedRevision?.id
      ) integrityMismatch();
      if (publication !== undefined) {
        if (readModel.dossier?.id !== publication.version.id) integrityMismatch();
        await events.send({
          type: "dossier_published",
          payload: {
            dossierVersionId: publication.version.id,
            label: `Словения · досье v${publication.version.ordinal}`,
            created: publication.created,
          },
        });
      }
      await events.send({ type: "assessment_completed", payload: { readModel } });
      return readModel;
    },

    present(input): Promise<ColdStartReadModel> {
      return loadReadModel(input.runId, input.profileId);
    },
  };

  if (portsV2 === undefined) return Object.freeze(applicationV1);

  const applicationAny: ColdStartApplicationAny = {
    ...applicationV1,
    prepareAny(input): Promise<ColdStartPrepared> {
      return prepareAnyCore(input);
    },

    async runAny(prepared, emit, signal): Promise<ColdStartReadModelAny> {
      if (signal.aborted) abortReason(signal);
      const resolved = resolveCountry(prepared.country.code);
      if (
        !resolved.ok ||
        ports.integrity.canonical(resolved.country) !== ports.integrity.canonical(prepared.country)
      ) integrityMismatch();
      const profile = await requireV2Ports().profiles.loadRelocationAnyVerified(prepared.profileId);
      if (profile.id !== prepared.profileId) integrityMismatch();
      if (profile.schemaVersion === "relocation-profile@1") {
        return applicationV1.run(prepared, emit, signal);
      }
      if (profile.schemaVersion === "relocation-profile@2") {
        return runV2(prepared, profile, emit, signal);
      }
      return integrityMismatch();
    },

    async presentAny(input): Promise<ColdStartReadModelAny> {
      const profile = await requireV2Ports().profiles.loadRelocationAnyVerified(input.profileId);
      if (profile.id !== input.profileId) integrityMismatch();
      if (profile.schemaVersion === "relocation-profile@1") {
        return applicationV1.present(input);
      }
      if (profile.schemaVersion === "relocation-profile@2") {
        return loadReadModelV2(input.runId, input.profileId, profile);
      }
      return integrityMismatch();
    },
  };
  return Object.freeze(applicationAny);
}
