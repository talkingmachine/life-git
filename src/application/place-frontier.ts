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
export { projectTerminalSummary } from "../decision/place-frontier-summary";
import {
  rankPlaces,
  type RankedPlace,
  type RankablePlace,
  type RequiredMismatch,
} from "../decision/place-ranker";
import type { EvidenceIntegrity } from "../research/research-plan";
import {
  countryCheckRunId,
  countryVerificationReplayExpectation,
  materializeFrontierMarker,
  type CountryVerificationProgress,
  type CountryVerifierPort,
  type FrontierCountry,
  type FrontierMarker,
} from "./country-verifier";

export { countryCheckRunId } from "./country-verifier";
export type {
  CountryVerificationProgress,
  CountryVerifierPort,
  FrontierCountry,
  FrontierMarker,
} from "./country-verifier";

export interface PlaceFrontierPrepared {
  readonly runId: string;
  readonly profileId: string;
  readonly preferenceProfileId: string;
  readonly assessmentAt: string;
  readonly rankingSnapshotId: string;
  readonly contextHash: string;
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
    loadShortlistVerified(idOrRunId: string): Promise<ShortlistSnapshot>;
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

export interface PlaceFrontierShortlistPresentation {
  presentPlaceFrontierByShortlistId(shortlistSnapshotId: string): Promise<PlaceFrontierReadModel>;
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

function progressDraft(
  countryCode: string,
  progress: CountryVerificationProgress,
): FrontierEventDraft {
  return {
    type: "country_progress",
    payload: { countryCode, ...progress },
  };
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
  if (ports.integrity.canonical(replay) !== ports.integrity.canonical(
    countryVerificationReplayExpectation(marker),
  )) integrityMismatch();
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

export function createPlaceFrontierApplication(
  ports: PlaceFrontierApplicationPorts,
): PlaceFrontierApplication & PlaceFrontierShortlistPresentation {
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
      const marker = materializeFrontierMarker({
        place,
        checked,
        parentRunId: prepared.runId,
        profileId: prepared.profileId,
        integrity: ports.integrity,
      });
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

  async function presentVerifiedShortlist(shortlistSnapshotIdOrRunId: string): Promise<PlaceFrontierReadModel> {
    const shortlist = await ports.store.loadShortlistVerified(shortlistSnapshotIdOrRunId);
    const ranking = await ports.store.loadRankingVerified(shortlist.rankingSnapshotId);
    if (ranking.runId !== shortlist.runId || shortlist.rankingSnapshotId !== ranking.id) integrityMismatch();
    await loadBoundProfiles(ranking, ports);
    await verifyRankingKnowledge(ranking, ports, true);
    for (const marker of shortlist.markers) await verifyMarkerReplay(marker, ranking, ports);
    return immutableCopy({
      runId: shortlist.runId,
      assessmentAt: ranking.assessmentAt,
      rankingSnapshot: ranking,
      shortlistSnapshot: shortlist,
    });
  }

  async function presentPlaceFrontier(runId: string): Promise<PlaceFrontierReadModel> {
    return presentVerifiedShortlist(runId);
  }

  async function presentPlaceFrontierByShortlistId(
    shortlistSnapshotId: string,
  ): Promise<PlaceFrontierReadModel> {
    return presentVerifiedShortlist(shortlistSnapshotId);
  }

  return Object.freeze({
    preparePlaceFrontier,
    runPlaceFrontier,
    presentPlaceFrontier,
    presentPlaceFrontierByShortlistId,
  });
}
