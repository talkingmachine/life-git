import {
  COLD_START_ASSESSMENT_RULES_VERSION,
  assessColdStart,
  type ColdStartComparator,
} from "../decision/cold-start-assessment";
import {
  confirmRelocationProfile,
  type RelocationProfileDraft,
  type RelocationProfileSnapshot,
} from "../decision/relocation-profile";
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
import {
  buildCountryDossier,
  type DossierPublishResult,
  type DossierVersion,
} from "../research/dossier";
import type { EvidenceSnapshot, ParserEntry } from "../research/contracts";
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

export interface ColdStartReadModel {
  readonly runId: string;
  readonly country: CountryRef;
  readonly checkedAt: string;
  readonly evidenceSnapshotId: string;
  readonly assessmentRulesVersion: "cold-start-assessment@1";
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
  readonly comparator: ColdStartComparator;
  readonly sourceNavigation: readonly {
    readonly label: string;
    readonly url: string;
  }[];
}

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

export interface ColdStartResearchPrepareInput {
  readonly runId: string;
  readonly assessmentDate: string;
  readonly deadlineAt: string;
  readonly signal: AbortSignal;
  readonly contextHash: string;
  readonly candidates: readonly SourceCandidate[];
  readonly onProgress: (
    progress: EvidenceProgress<SloveniaSourceId, ColdStartEvidenceClaim>,
  ) => void | Promise<void>;
}

export interface ColdStartVerifiedBundle {
  readonly snapshot: EvidenceSnapshot<SloveniaSourceId, ColdStartEvidenceClaim>;
  readonly entries: readonly ParserEntry<SloveniaSourceId>[];
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
  readonly integrity: EvidenceIntegrity;
  readonly clock: () => Date;
  readonly nextRunId: () => string;
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
  };
}

function verifyPrepared(
  prepared: SealedEvidence<SloveniaSourceId, ColdStartEvidenceClaim>,
  expected: {
    readonly runId: string;
    readonly assessmentAt: string;
    readonly contextHash: string;
  },
  integrity: EvidenceIntegrity,
): void {
  assertSealedEvidenceStructure(prepared, SOURCE_IDS);
  const canonicalManifest = integrity.canonical(prepared.manifest);
  if (
    prepared.snapshot.id !== `${expected.runId}:evidence` ||
    prepared.snapshot.assessmentDate !== expected.assessmentAt ||
    prepared.snapshot.contextHash !== expected.contextHash ||
    prepared.snapshot.rulesVersion !== "vs2-si-evidence@2" ||
    prepared.canonicalManifest !== canonicalManifest ||
    integrity.canonical(prepared.manifest.snapshot) !==
      integrity.canonical(snapshotPayload(prepared.snapshot)) ||
    prepared.snapshot.manifestHash !== integrity.hash(canonicalManifest) ||
    prepared.snapshot.hmac !== integrity.sign(canonicalManifest)
  ) integrityMismatch();
}

function sourceNavigation(
  bundle: ColdStartVerifiedBundle,
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

export function createColdStartApplication(
  ports: ColdStartApplicationPorts,
): ColdStartApplication {
  const loadReadModel = async (
    runId: string,
    profileId: string,
  ): Promise<ColdStartReadModel> => {
    const resolved = resolveCountry("SI");
    if (!resolved.ok) integrityMismatch();
    const profile = await ports.profiles.loadRelocationVerified(profileId);
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
    });
    const claimKinds = REQUIRED_CLAIM_KINDS.filter((kind) =>
      replayed.claims.some((claim) => "claimKind" in claim && claim.claimKind === kind)
    );
    return deepFreeze({
      runId,
      country: resolved.country,
      checkedAt: replayed.assessmentDate,
      evidenceSnapshotId: replayed.id,
      assessmentRulesVersion: COLD_START_ASSESSMENT_RULES_VERSION,
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

  const application: ColdStartApplication = {
    async prepare(input): Promise<ColdStartPrepared> {
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
      }
      return deepFreeze({
        runId: ports.nextRunId(),
        profileId: profile.id,
        country: resolved.country,
        assessmentAt: nowIso.slice(0, 10),
        deadlineAt: new Date(now.valueOf() + 60_000).toISOString(),
      });
    },

    async run(prepared, emit, signal): Promise<ColdStartReadModel> {
      if (signal.aborted) abortReason(signal);
      const resolved = resolveCountry(prepared.country.code);
      if (
        !resolved.ok ||
        ports.integrity.canonical(resolved.country) !== ports.integrity.canonical(prepared.country)
      ) integrityMismatch();
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
          ports.integrity,
        );
        verifyPrepared(preparedEvidence, {
          runId: prepared.runId,
          assessmentAt: prepared.assessmentAt,
          contextHash: expectedContextHash,
        }, ports.integrity);
        if (signal.aborted) abortReason(signal);
        await ports.evidence.seal(preparedEvidence);
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

      const readModel = await loadReadModel(prepared.runId, prepared.profileId);
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
  return Object.freeze(application);
}
