import {
  confirmPreferenceProfile,
  type PreferenceProfileDraft,
  type PreferenceProfileSnapshot,
} from "../decision/preference-profile";
import {
  confirmRelocationProfile,
  type RelocationProfileDraft,
  type RelocationProfileSnapshot,
} from "../decision/relocation-profile";
import {
  reconstructFormalResidenceVerdict,
  type FormalResidenceVerdict,
} from "../decision/formal-residence-verdict";
import {
  rankPlaces,
  type RankedPlace,
  type RankablePlace,
  type RequiredMismatch,
} from "../decision/place-ranker";
import { canonicalJson, sha256Text } from "../infrastructure/integrity";
import type { EvidenceIntegrity } from "../research/research-plan";
import type { ColdStartEvent } from "./cold-start";

export interface PlaceFrontierPrepared {
  readonly runId: string;
  readonly profileId: string;
  readonly preferenceProfileId: string;
  readonly assessmentAt: string;
  readonly rankingSnapshotId: string;
  readonly contextHash: string;
}

export interface FrontierCountry {
  readonly countryCode: string;
  readonly label: string;
  readonly flag: string;
  readonly coordinate: { readonly lat: number; readonly lng: number };
}

export interface FrontierMarker {
  readonly country: FrontierCountry;
  readonly rank: number;
  readonly countryCheckRunId: string;
  readonly sourceAssessmentRulesVersion: string;
  readonly lastCheckedAt: string;
  readonly evidenceSnapshotId: string;
  readonly currentKnowledgeRevisionId?: string;
  readonly updatedKnowledgeRevisionId?: string;
  readonly knowledgeUpdatedAt?: string;
  readonly formalVerdict: FormalResidenceVerdict;
}

export interface RankingSnapshot {
  readonly schemaVersion: "place-ranking@1";
  readonly id: string;
  readonly runId: string;
  readonly profileSnapshotId: string;
  readonly preferenceProfileSnapshotId: string;
  readonly assessmentAt: string;
  readonly contextHash: string;
  readonly knowledgeRevisionIds: Readonly<Record<string, string | null>>;
  readonly ordered: readonly RankedPlace[];
  readonly excludedPlaces: readonly RankablePlace[];
  readonly excluded: readonly RequiredMismatch[];
  readonly rulesVersion: "place-ranker@1";
  readonly createdAt: string;
}

export interface ShortlistSnapshot {
  readonly schemaVersion: "place-shortlist@1";
  readonly id: string;
  readonly runId: string;
  readonly rankingSnapshotId: string;
  readonly markers: readonly FrontierMarker[];
  readonly rulesVersion: "country-frontier@1";
  readonly createdAt: string;
}

export interface PlaceFrontierReadModel {
  readonly runId: string;
  readonly assessmentAt: string;
  readonly rankingSnapshot: RankingSnapshot;
  readonly shortlistSnapshot: ShortlistSnapshot;
}

type CountryProgress = Exclude<ColdStartEvent, { readonly type: "assessment_completed" }>;

export interface CountryVerifierPort {
  check(input: {
    readonly country: RankablePlace;
    readonly profileId: string;
    readonly parentRunId: string;
    readonly emitProgress: (progress: CountryProgress) => void | Promise<void>;
    readonly signal: AbortSignal;
  }): Promise<Omit<FrontierMarker, "country" | "rank" | "formalVerdict"> & {
    readonly verdict: FormalResidenceVerdict;
  }>;
  present(input: {
    readonly parentRunId: string;
    readonly countryCode: string;
    readonly countryCheckRunId: string;
    readonly profileId: string;
  }): Promise<Omit<FrontierMarker, "country" | "rank" | "countryCheckRunId" | "formalVerdict"> & {
    readonly verdict: FormalResidenceVerdict;
  }>;
}

export interface PlaceFrontierApplicationPorts {
  readonly profiles: {
    appendRelocation(snapshot: RelocationProfileSnapshot): Promise<void>;
    loadRelocationVerified(id: string): Promise<RelocationProfileSnapshot>;
    appendPreference(snapshot: PreferenceProfileSnapshot): Promise<void>;
    loadPreferenceVerified(id: string): Promise<PreferenceProfileSnapshot>;
  };
  readonly rankingInputs: {
    freezeCurrent(): Promise<{
      readonly places: readonly RankablePlace[];
      readonly knowledgeRevisionIds: Readonly<Record<string, string | null>>;
    }>;
  };
  readonly rank: typeof rankPlaces;
  readonly store: {
    appendRanking(snapshot: RankingSnapshot): Promise<void>;
    appendShortlist(snapshot: ShortlistSnapshot): Promise<void>;
    loadRankingVerified(id: string): Promise<RankingSnapshot>;
    loadShortlistVerified(runId: string): Promise<ShortlistSnapshot>;
  };
  readonly knowledge: {
    loadVerified(id: string): Promise<{ readonly id: string; readonly countryCode: string }>;
  };
  readonly verifier: CountryVerifierPort;
  readonly integrity: EvidenceIntegrity;
  readonly clock: () => Date;
  readonly nextRunId: () => string;
}

export interface PlaceFrontierApplication {
  preparePlaceFrontier(input:
    | { readonly profile: RelocationProfileDraft; readonly preferences: PreferenceProfileDraft }
    | { readonly profileId: string; readonly preferenceProfileId: string }
  ): Promise<PlaceFrontierPrepared>;
  runPlaceFrontier(
    prepared: PlaceFrontierPrepared,
    emit: (event: PlaceFrontierEvent) => void | Promise<void>,
    signal: AbortSignal,
  ): Promise<PlaceFrontierReadModel>;
  presentPlaceFrontier(runId: string): Promise<PlaceFrontierReadModel>;
}

export interface FrontierEventBase<T extends string, P> {
  readonly runId: string;
  readonly sequence: number;
  readonly occurredAt: string;
  readonly type: T;
  readonly payload: P;
}

export type PlaceFrontierEvent =
  | FrontierEventBase<"ranking_sealed", {
      readonly rankingSnapshotId: string;
      readonly orderedCountryCodes: readonly string[];
      readonly excludedCountryCodes: readonly string[];
    }>
  | FrontierEventBase<"country_activated", {
      readonly country: FrontierCountry;
      readonly rank: number;
    }>
  | FrontierEventBase<"country_progress", {
      readonly countryCode: string;
      readonly stage:
        | "source_discovered"
        | "authority_verified"
        | "artifact_captured"
        | "claim_verified"
        | "dossier_published";
      readonly label: string;
      readonly detail?: string;
      readonly sourceUrl?: string;
    }>
  | FrontierEventBase<"country_completed", { readonly marker: FrontierMarker }>
  | FrontierEventBase<"frontier_completed", { readonly readModel: PlaceFrontierReadModel }>;

type FrontierEventDraft = PlaceFrontierEvent extends infer Event
  ? Event extends PlaceFrontierEvent
    ? Pick<Event, "type" | "payload">
    : never
  : never;

function integrityMismatch(): never {
  throw new Error("integrity_mismatch");
}

function abort(signal: AbortSignal): never {
  if (signal.reason instanceof Error) throw signal.reason;
  throw new DOMException("The operation was aborted", "AbortError");
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function immutableCopy<T>(value: T): T {
  return deepFreeze(structuredClone(value));
}

function isCanonicalDay(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function isCanonicalInstant(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString() === value;
}

function isOptionalNonEmptyString(value: unknown): value is string | undefined {
  return value === undefined || (typeof value === "string" && value.length > 0);
}

export function countryCheckRunId(parentRunId: string, countryCode: string): string {
  return `frontier-country:${sha256Text(canonicalJson({ parentRunId, countryCode }))}`;
}

function frontierCountry(place: RankedPlace): FrontierCountry {
  return {
    countryCode: place.countryCode,
    label: place.label,
    flag: place.flag,
    coordinate: { ...place.coordinate },
  };
}

function frontierContextHash(input: {
  readonly runId: string;
  readonly profileId: string;
  readonly preferenceProfileId: string;
  readonly assessmentAt: string;
  readonly rankingSnapshotId: string;
}, integrity: EvidenceIntegrity): string {
  return integrity.hash(integrity.canonical(input));
}

function rankingCountryCodes(ranking: RankingSnapshot): readonly string[] {
  return [...new Set([
    ...ranking.ordered.map(({ countryCode }) => countryCode),
    ...ranking.excluded.map(({ countryCode }) => countryCode),
  ])];
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return sortedLeft.length === sortedRight.length &&
    sortedLeft.every((value, index) => value === sortedRight[index]);
}

async function verifyRankingKnowledge(
  ranking: RankingSnapshot,
  ports: PlaceFrontierApplicationPorts,
  verifyOwnership: boolean,
): Promise<void> {
  if (!sameStringSet(Object.keys(ranking.knowledgeRevisionIds), rankingCountryCodes(ranking))) {
    integrityMismatch();
  }
  if (!verifyOwnership) return;
  for (const [countryCode, revisionId] of Object.entries(ranking.knowledgeRevisionIds)) {
    if (revisionId === null) continue;
    const revision = await ports.knowledge.loadVerified(revisionId);
    if (revision.id !== revisionId || revision.countryCode !== countryCode) integrityMismatch();
  }
}

function verifyPrepared(prepared: PlaceFrontierPrepared, ranking: RankingSnapshot): void {
  if (
    ranking.id !== prepared.rankingSnapshotId ||
    ranking.runId !== prepared.runId ||
    ranking.profileSnapshotId !== prepared.profileId ||
    ranking.preferenceProfileSnapshotId !== prepared.preferenceProfileId ||
    ranking.assessmentAt !== prepared.assessmentAt ||
    ranking.contextHash !== prepared.contextHash
  ) integrityMismatch();
}

function createEventEmitter(
  runId: string,
  emit: (event: PlaceFrontierEvent) => void | Promise<void>,
  clock: () => Date,
): (draft: FrontierEventDraft) => Promise<void> {
  let sequence = 0;
  return async (draft) => {
    await emit(immutableCopy({
      runId,
      sequence: ++sequence,
      occurredAt: clock().toISOString(),
      type: draft.type,
      payload: draft.payload,
    } as PlaceFrontierEvent));
  };
}

function progressDraft(countryCode: string, progress: CountryProgress): FrontierEventDraft {
  switch (progress.type) {
    case "source_discovered":
      return {
        type: "country_progress",
        payload: {
          countryCode,
          stage: progress.type,
          label: progress.payload.candidateId,
          sourceUrl: progress.payload.url,
        },
      };
    case "authority_verified":
      return {
        type: "country_progress",
        payload: {
          countryCode,
          stage: progress.type,
          label: progress.payload.candidateId,
          detail: progress.payload.authorityRoot,
        },
      };
    case "artifact_captured":
      return {
        type: "country_progress",
        payload: {
          countryCode,
          stage: progress.type,
          label: progress.payload.role,
          detail: `sha256:${progress.payload.sha256}`,
          sourceUrl: progress.payload.resolvedUrl,
        },
      };
    case "claim_verified":
      return {
        type: "country_progress",
        payload: {
          countryCode,
          stage: progress.type,
          label: progress.payload.claimId,
          detail: `${progress.payload.claimKind} · ${progress.payload.sourceIds.join(", ")}`,
        },
      };
    case "dossier_published":
      return {
        type: "country_progress",
        payload: {
          countryCode,
          stage: progress.type,
          label: progress.payload.label,
          detail: `${progress.payload.dossierVersionId} · ${progress.payload.created ? "created" : "reused"}`,
        },
      };
  }
}

function checkedMarker(
  place: RankedPlace,
  checked: Awaited<ReturnType<CountryVerifierPort["check"]>>,
  parentRunId: string,
  profileId: string,
): FrontierMarker {
  const optionalKeys = [
    ...(checked.currentKnowledgeRevisionId === undefined ? [] : ["currentKnowledgeRevisionId"]),
    ...(checked.updatedKnowledgeRevisionId === undefined ? [] : ["updatedKnowledgeRevisionId"]),
    ...(checked.knowledgeUpdatedAt === undefined ? [] : ["knowledgeUpdatedAt"]),
  ];
  const expectedKeys = [
    "countryCheckRunId",
    "sourceAssessmentRulesVersion",
    "verdict",
    "evidenceSnapshotId",
    "lastCheckedAt",
    ...optionalKeys,
  ].sort();
  if (
    Object.keys(checked).sort().some((key, index) => key !== expectedKeys[index]) ||
    Object.keys(checked).length !== expectedKeys.length ||
    checked.sourceAssessmentRulesVersion !== "cold-start-assessment@1" ||
    typeof checked.evidenceSnapshotId !== "string" ||
    checked.evidenceSnapshotId.length === 0 ||
    !isCanonicalDay(checked.lastCheckedAt) ||
    !isOptionalNonEmptyString(checked.currentKnowledgeRevisionId) ||
    !isOptionalNonEmptyString(checked.updatedKnowledgeRevisionId) ||
    (checked.knowledgeUpdatedAt !== undefined &&
      !isCanonicalInstant(checked.knowledgeUpdatedAt)) ||
    (checked.currentKnowledgeRevisionId === undefined) !==
      (checked.knowledgeUpdatedAt === undefined) ||
    (checked.updatedKnowledgeRevisionId !== undefined &&
      checked.updatedKnowledgeRevisionId !== checked.currentKnowledgeRevisionId)
  ) integrityMismatch();
  const { verdict, ...metadata } = checked;
  if (metadata.countryCheckRunId !== countryCheckRunId(parentRunId, place.countryCode)) {
    integrityMismatch();
  }
  let formalVerdict: FormalResidenceVerdict;
  try {
    formalVerdict = reconstructFormalResidenceVerdict(verdict, {
      profileSnapshotId: profileId,
      evidenceSnapshotId: checked.evidenceSnapshotId,
    });
  } catch {
    integrityMismatch();
  }
  return immutableCopy({
    ...metadata,
    country: frontierCountry(place),
    rank: place.rank,
    formalVerdict,
  });
}

function nonRedCount(markers: readonly FrontierMarker[]): number {
  return markers.filter(({ formalVerdict }) => formalVerdict.marker !== "red").length;
}

function shortlistSnapshot(
  runId: string,
  rankingSnapshotId: string,
  markers: readonly FrontierMarker[],
  createdAt: string,
): ShortlistSnapshot {
  return {
    schemaVersion: "place-shortlist@1",
    id: `${runId}:shortlist`,
    runId,
    rankingSnapshotId,
    markers,
    rulesVersion: "country-frontier@1",
    createdAt,
  };
}

function replayExpectation(marker: FrontierMarker) {
  return {
    sourceAssessmentRulesVersion: marker.sourceAssessmentRulesVersion,
    verdict: marker.formalVerdict,
    evidenceSnapshotId: marker.evidenceSnapshotId,
    ...(marker.currentKnowledgeRevisionId === undefined ? {} : {
      currentKnowledgeRevisionId: marker.currentKnowledgeRevisionId,
    }),
    ...(marker.updatedKnowledgeRevisionId === undefined ? {} : {
      updatedKnowledgeRevisionId: marker.updatedKnowledgeRevisionId,
    }),
    ...(marker.knowledgeUpdatedAt === undefined ? {} : {
      knowledgeUpdatedAt: marker.knowledgeUpdatedAt,
    }),
    lastCheckedAt: marker.lastCheckedAt,
  };
}

async function verifyMarkerReplay(
  marker: FrontierMarker,
  ranking: RankingSnapshot,
  ports: PlaceFrontierApplicationPorts,
): Promise<void> {
  const replay = await ports.verifier.present({
    parentRunId: ranking.runId,
    countryCode: marker.country.countryCode,
    countryCheckRunId: marker.countryCheckRunId,
    profileId: ranking.profileSnapshotId,
  });
  if (ports.integrity.canonical(replay) !==
    ports.integrity.canonical(replayExpectation(marker))) integrityMismatch();
}

async function loadBoundProfiles(
  ranking: RankingSnapshot,
  ports: PlaceFrontierApplicationPorts,
): Promise<void> {
  const profile = await ports.profiles.loadRelocationVerified(ranking.profileSnapshotId);
  const preferences = await ports.profiles.loadPreferenceVerified(
    ranking.preferenceProfileSnapshotId,
  );
  if (
    profile.id !== ranking.profileSnapshotId ||
    preferences.id !== ranking.preferenceProfileSnapshotId
  ) integrityMismatch();
}

export function projectTerminalSummary(readModel: PlaceFrontierReadModel) {
  const nonRed = readModel.shortlistSnapshot.markers.filter(
    ({ formalVerdict }) => formalVerdict.marker !== "red",
  );
  const green = nonRed.filter(({ formalVerdict }) => formalVerdict.marker === "green").length;
  const yellow = nonRed.length - green;
  return {
    countries: nonRed.map(({ country }) => country.countryCode),
    composition: { green, yellow },
    stopCondition: nonRed.length === 5
      ? "five_non_red" as const
      : "installed_coverage_exhausted" as const,
    preliminary: yellow > 0 || nonRed.length < 5,
  };
}

export function createPlaceFrontierApplication(
  ports: PlaceFrontierApplicationPorts,
): PlaceFrontierApplication {
  async function preparePlaceFrontier(
    input: Parameters<PlaceFrontierApplication["preparePlaceFrontier"]>[0],
  ): Promise<PlaceFrontierPrepared> {
    const now = ports.clock();
    const profile = "profile" in input
      ? confirmRelocationProfile(input.profile, () => now)
      : await ports.profiles.loadRelocationVerified(input.profileId);
    const preferences = "preferences" in input
      ? confirmPreferenceProfile(input.preferences, () => now)
      : await ports.profiles.loadPreferenceVerified(input.preferenceProfileId);
    if ("profile" in input) await ports.profiles.appendRelocation(profile);
    if ("preferences" in input) await ports.profiles.appendPreference(preferences);

    const runId = ports.nextRunId();
    const assessmentAt = now.toISOString();
    const rankingSnapshotId = `${runId}:ranking`;
    const contextHash = frontierContextHash({
      runId,
      profileId: profile.id,
      preferenceProfileId: preferences.id,
      assessmentAt,
      rankingSnapshotId,
    }, ports.integrity);
    const rankingInputs = await ports.rankingInputs.freezeCurrent();
    const result = ports.rank({
      assessmentAt: assessmentAt.slice(0, 10),
      preferences,
      places: rankingInputs.places,
    });
    const excludedCountryCodes = new Set(result.excluded.map(({ countryCode }) => countryCode));
    const excludedPlaces = rankingInputs.places
      .filter(({ countryCode }) => excludedCountryCodes.has(countryCode))
      .map((place) => structuredClone(place))
      .sort((left, right) => left.countryCode.localeCompare(right.countryCode));
    const snapshot: RankingSnapshot = {
      schemaVersion: "place-ranking@1",
      id: rankingSnapshotId,
      runId,
      profileSnapshotId: profile.id,
      preferenceProfileSnapshotId: preferences.id,
      assessmentAt,
      contextHash,
      knowledgeRevisionIds: rankingInputs.knowledgeRevisionIds,
      ordered: result.ordered,
      excludedPlaces,
      excluded: result.excluded,
      rulesVersion: result.rulesVersion,
      createdAt: assessmentAt,
    };
    await verifyRankingKnowledge(snapshot, ports, false);
    await ports.store.appendRanking(snapshot);
    return {
      runId,
      profileId: profile.id,
      preferenceProfileId: preferences.id,
      assessmentAt,
      rankingSnapshotId,
      contextHash,
    };
  }

  async function runPlaceFrontier(
    prepared: PlaceFrontierPrepared,
    emit: (event: PlaceFrontierEvent) => void | Promise<void>,
    signal: AbortSignal,
  ): Promise<PlaceFrontierReadModel> {
    if (signal.aborted) abort(signal);
    const ranking = await ports.store.loadRankingVerified(prepared.rankingSnapshotId);
    verifyPrepared(prepared, ranking);
    await loadBoundProfiles(ranking, ports);
    await verifyRankingKnowledge(ranking, ports, false);

    const send = createEventEmitter(prepared.runId, emit, ports.clock);
    await send({
      type: "ranking_sealed",
      payload: {
        rankingSnapshotId: ranking.id,
        orderedCountryCodes: ranking.ordered.map(({ countryCode }) => countryCode),
        excludedCountryCodes: [...new Set(
          ranking.excluded.map(({ countryCode }) => countryCode),
        )].sort(),
      },
    });
    const activated = [...ranking.ordered.slice(0, 5)];
    for (const place of activated) {
      await send({ type: "country_activated", payload: { country: frontierCountry(place), rank: place.rank } });
    }

    const markers: FrontierMarker[] = [];
    let checkIndex = 0;
    let nextIndex = activated.length;
    while (checkIndex < activated.length) {
      if (signal.aborted) abort(signal);
      const place = activated[checkIndex++]!;
      const checked = await ports.verifier.check({
        country: place,
        profileId: prepared.profileId,
        parentRunId: prepared.runId,
        emitProgress: async (progress) => send(progressDraft(place.countryCode, progress)),
        signal,
      });
      const marker = checkedMarker(place, checked, prepared.runId, prepared.profileId);
      markers.push(marker);
      await send({ type: "country_completed", payload: { marker } });
      if (marker.formalVerdict.marker === "red" && nextIndex < ranking.ordered.length) {
        const replacement = ranking.ordered[nextIndex++]!;
        activated.push(replacement);
        await send({
          type: "country_activated",
          payload: { country: frontierCountry(replacement), rank: replacement.rank },
        });
      }
      if (nonRedCount(markers) === 5) break;
    }
    if (nonRedCount(markers) !== 5 && markers.length !== ranking.ordered.length) {
      integrityMismatch();
    }
    if (signal.aborted) abort(signal);
    const shortlist = shortlistSnapshot(
      prepared.runId,
      ranking.id,
      markers,
      ports.clock().toISOString(),
    );
    await ports.store.appendShortlist(shortlist);
    const readModel = immutableCopy({
      runId: prepared.runId,
      assessmentAt: ranking.assessmentAt,
      rankingSnapshot: ranking,
      shortlistSnapshot: shortlist,
    });
    await send({ type: "frontier_completed", payload: { readModel } });
    return readModel;
  }

  async function presentPlaceFrontier(runId: string): Promise<PlaceFrontierReadModel> {
    const shortlist = await ports.store.loadShortlistVerified(runId);
    const ranking = await ports.store.loadRankingVerified(shortlist.rankingSnapshotId);
    if (ranking.runId !== runId || shortlist.rankingSnapshotId !== ranking.id) integrityMismatch();
    await loadBoundProfiles(ranking, ports);
    await verifyRankingKnowledge(ranking, ports, true);
    for (const marker of shortlist.markers) await verifyMarkerReplay(marker, ranking, ports);
    return immutableCopy({
      runId,
      assessmentAt: ranking.assessmentAt,
      rankingSnapshot: ranking,
      shortlistSnapshot: shortlist,
    });
  }

  return Object.freeze({ preparePlaceFrontier, runPlaceFrontier, presentPlaceFrontier });
}
