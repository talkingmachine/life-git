import type {
  CityFrontierEvent,
  CityFrontierReadModel,
  CityFrontierRevision,
  PublicFactSourceV1,
} from "../application/city-frontier-contracts";
import {
  initialCityFrontierEventState,
  normalizeCityFrontierReadModel,
  reduceCityFrontierEvent,
  type CityFrontierEventState,
} from "./city-frontier-stream";

export interface CityFrontierCandidateView {
  readonly city: {
    readonly cityId: string;
    readonly officialName: string;
    readonly countryCode: string;
    readonly coordinate: { readonly lat: number; readonly lng: number };
  };
  readonly rank: number;
  readonly score: string;
  readonly coverage: string;
  readonly status: "pending" | "green" | "yellow" | "red";
  readonly statusLabel:
    | "Проверяется"
    | "Доступен для выбора"
    | "Доступен с неполными данными"
    | "Исключён";
  readonly facts?: CityFrontierRevision["markers"][number]["facts"];
  readonly verificationCoverage?: string;
  readonly lastCheckedAt?: string;
  readonly knowledgeRevisionId?: string;
  readonly evidenceSnapshotId?: string;
  readonly requiredMismatches?: CityFrontierRevision["markers"][number]["requiredMismatches"];
  readonly unknownBasis?: CityFrontierRevision["markers"][number]["unknownBasis"];
}

export interface CityFrontierCardView extends CityFrontierCandidateView {
  readonly markerDigest: string;
}

export interface CityFrontierView {
  readonly candidates: readonly CityFrontierCandidateView[];
  readonly progress: readonly CityFrontierEvent[];
  readonly cards: readonly CityFrontierCardView[];
  readonly stopCondition?: Extract<CityFrontierRevision, { readonly kind: "terminal" }>["stopCondition"];
  readonly selectionHistory?: CityFrontierReadModel["selections"];
  readonly canContinue: boolean;
  readonly requiresVerifiedReload?: boolean;
  readonly transportError?: string;
  readonly source?: PublicFactSourceV1;
  readonly sourceReplaced?: boolean;
  readonly sourceUnavailable?: boolean;
}

export type CityFrontierScreenState =
  | { readonly kind: "stable"; readonly readModel: CityFrontierReadModel;
      readonly source?: PublicFactSourceV1; readonly sourceReplaced?: boolean }
  | {
      readonly kind: "continuing";
      readonly readModel: CityFrontierReadModel;
      readonly stream: CityFrontierEventState;
    }
  | {
      readonly kind: "transportError";
      readonly readModel: CityFrontierReadModel;
      readonly stream: CityFrontierEventState;
      readonly message: string;
    };

function freezeCopy<T>(value: T): T {
  const copy = structuredClone(value);
  const freeze = (item: unknown): void => {
    if (item === null || typeof item !== "object" || Object.isFrozen(item)) return;
    Object.freeze(item);
    for (const child of Object.values(item)) freeze(child);
  };
  freeze(copy);
  return copy;
}

function cityJoin(
  readModel: CityFrontierReadModel,
  cityId: string,
  rank: number,
): {
  readonly city: CityFrontierCandidateView["city"];
  readonly score: string;
  readonly coverage: string;
} {
  const city = readModel.registry.entries.find((entry) => entry.cityId === cityId);
  const ranked = readModel.ranking.ordered[rank - 1];
  if (city === undefined || ranked === undefined || ranked.rank !== rank ||
    ranked.cityId !== cityId || city.countryCode !== readModel.countryCode) {
    throw new Error("invalid_city_view_join");
  }
  return {
    city: {
      cityId: city.cityId,
      officialName: city.officialName,
      countryCode: city.countryCode,
      coordinate: city.coordinate,
    },
    score: ranked.score,
    coverage: ranked.coverage,
  };
}

function committedCandidate(
  readModel: CityFrontierReadModel,
  marker: CityFrontierRevision["markers"][number],
): CityFrontierCandidateView {
  const joined = cityJoin(readModel, marker.cityId, marker.rank);
  return freezeCopy({
    city: joined.city,
    rank: marker.rank,
    score: joined.score,
    coverage: joined.coverage,
    status: marker.visualStatus,
    statusLabel: marker.visualStatus === "green"
      ? "Доступен для выбора"
      : marker.visualStatus === "yellow"
        ? "Доступен с неполными данными"
        : "Исключён",
    knowledgeRevisionId: marker.knowledgeRevisionId,
    evidenceSnapshotId: marker.evidenceSnapshotId,
    requiredMismatches: marker.requiredMismatches,
    unknownBasis: marker.unknownBasis,
    facts: marker.facts,
    verificationCoverage: marker.verificationCoverage,
    lastCheckedAt: marker.lastCheckedAt,
  });
}

function terminalCards(readModel: CityFrontierReadModel): readonly CityFrontierCardView[] {
  if (readModel.revision.kind !== "terminal") return [];
  return readModel.revision.entries.map((entry) => {
    const marker = readModel.revision.markers.find(({ cityId }) => cityId === entry.cityId);
    if (marker === undefined || marker.status !== "selectable" || marker.rank !== entry.rank) {
      throw new Error("invalid_city_terminal_card");
    }
    return freezeCopy({
      ...committedCandidate(readModel, marker),
      markerDigest: entry.markerDigest,
    });
  });
}

function pendingCandidate(
  readModel: CityFrontierReadModel,
  active: NonNullable<CityFrontierEventState["active"]>,
): CityFrontierCandidateView {
  const joined = cityJoin(readModel, active.cityId, active.rank);
  return freezeCopy({
    city: joined.city,
    rank: active.rank,
    score: joined.score,
    coverage: joined.coverage,
    status: "pending",
    statusLabel: "Проверяется",
  });
}

function unavailableCandidate(
  readModel: CityFrontierReadModel,
  active: NonNullable<CityFrontierEventState["active"]>,
): CityFrontierCandidateView {
  const candidate = pendingCandidate(readModel, active);
  return freezeCopy({ ...candidate, status: "yellow" as const,
    statusLabel: "Доступен с неполными данными" as const });
}

export function presentCityFrontierReadModel(
  readModel: CityFrontierReadModel,
  recovery?: Pick<CityFrontierEventState, "currentSource" | "sourceReplaced">,
): CityFrontierScreenState {
  return freezeCopy({
    kind: "stable" as const,
    readModel: normalizeCityFrontierReadModel(readModel),
    ...(recovery?.currentSource === undefined ? {} : { source: recovery.currentSource }),
    ...(recovery?.sourceReplaced === undefined ? {} : { sourceReplaced: recovery.sourceReplaced }),
  });
}

export function beginCityFrontierContinuation(
  readModel: CityFrontierReadModel,
): CityFrontierScreenState {
  const normalized = normalizeCityFrontierReadModel(readModel);
  if (normalized.revision.kind !== "working" ||
    normalized.catalog.rulesVersion !== "city-catalog@2") {
    throw new Error("city_frontier_not_continuable");
  }
  return freezeCopy({
    kind: "continuing" as const,
    readModel: normalized,
    stream: initialCityFrontierEventState(normalized),
  });
}

export function reduceCityFrontierContinuationEvent(
  state: CityFrontierScreenState,
  event: CityFrontierEvent,
): CityFrontierScreenState {
  if (state.kind !== "continuing") throw new Error("city_frontier_not_continuing");
  const stream = reduceCityFrontierEvent(state.stream, event, state.readModel);
  if (event.type === "city_continuation_completed") {
    return presentCityFrontierReadModel(stream.terminal!, stream);
  }
  const readModel = event.type === "city_revision_committed"
    ? normalizeCityFrontierReadModel({ ...state.readModel, revision: event.revision })
    : state.readModel;
  return freezeCopy({ kind: "continuing" as const, readModel, stream });
}

export function failCityFrontierContinuation(
  state: CityFrontierScreenState,
  message: string,
): CityFrontierScreenState {
  if (state.kind !== "continuing") return state;
  return freezeCopy({
    kind: "transportError" as const,
    readModel: state.readModel,
    stream: state.stream,
    message,
  });
}

export function projectCityFrontierView(
  state: CityFrontierScreenState,
): CityFrontierView {
  const candidates = state.readModel.revision.markers.map((marker) =>
    committedCandidate(state.readModel, marker));
  if (state.kind !== "stable" && state.stream.active !== undefined &&
    !state.readModel.revision.markers.some(({ cityId }) =>
      cityId === state.stream.active?.cityId)) {
    candidates.push(state.stream.yellowSource === undefined
      ? pendingCandidate(state.readModel, state.stream.active)
      : unavailableCandidate(state.readModel, state.stream.active));
  }
  const isStableTerminal = state.kind === "stable" &&
    state.readModel.revision.kind === "terminal";
  return freezeCopy({
    candidates,
    progress: state.kind === "stable" ? [] : state.stream.progress ?? [],
    cards: isStableTerminal ? terminalCards(state.readModel) : [],
    ...(state.kind !== "transportError" && state.readModel.revision.kind === "terminal"
      ? { selectionHistory: isStableTerminal ? state.readModel.selections : [] }
      : {}),
    ...(isStableTerminal ? { stopCondition: state.readModel.revision.stopCondition } : {}),
    canContinue: state.kind === "stable" && state.readModel.revision.kind === "working" &&
      state.readModel.catalog.rulesVersion === "city-catalog@2",
    ...(state.kind === "transportError" ? {
      requiresVerifiedReload: state.stream.sourceReplaced === true ||
        state.stream.committedRevisionId === state.readModel.revision.id,
      transportError: state.message,
    } : {}),
    ...(state.kind === "stable" ? (state.source === undefined ? {} : {
      source: state.source, ...(state.sourceReplaced === undefined ? {} : { sourceReplaced: state.sourceReplaced }),
    }) : state.stream.currentSource === undefined ? {} : {
      source: state.stream.currentSource,
      ...(state.stream.sourceReplaced === undefined ? {} : { sourceReplaced: state.stream.sourceReplaced }),
      ...(state.stream.yellowSource === undefined ? {} : { sourceUnavailable: true }),
    }),
  });
}
