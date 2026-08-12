import type {
  FrontierCountry,
  FrontierMarker,
  PlaceFrontierEvent,
  PlaceFrontierReadModel,
} from "../application/place-frontier";
import type { FormalResidenceVerdict } from "../decision/formal-residence-verdict";
import { projectTerminalSummary } from "../decision/place-frontier-summary";
import type { RankedPlace } from "../decision/place-ranker";
import type {
  ResearchCandidate,
  ResearchProgressItem,
  WorkspaceGlobePresentation,
} from "./research-map/contracts";
import { createProductGlobeRoute } from "./research-map/product-route";
import {
  initialPlaceFrontierEventState,
  reducePlaceFrontierEvent,
  type PlaceFrontierEventState,
} from "./place-frontier-stream";

export type PlaceFrontierScreenState =
  | { readonly kind: "running"; readonly runId: string; readonly stream: PlaceFrontierEventState }
  | {
      readonly kind: "completed";
      readonly runId: string;
      readonly stream: PlaceFrontierEventState;
      readonly readModel: PlaceFrontierReadModel;
    }
  | {
      readonly kind: "transportError";
      readonly runId: string;
      readonly stream: PlaceFrontierEventState;
      readonly message: string;
    };

export interface PlaceFrontierCountryCard {
  readonly country: FrontierCountry;
  readonly rank: number;
  readonly relevance: string;
  readonly coverage: string;
  readonly contributions: RankedPlace["contributions"];
  readonly formalVerdict: FormalResidenceVerdict;
  readonly evidenceSnapshotId: string;
  readonly sourceAssessmentRulesVersion: string;
  readonly rankingKnowledgeRevisionId: string | null;
  readonly currentKnowledgeRevisionId?: string;
  readonly currentRunUpdatedRevisionId?: string;
  readonly lastCheckedAt: string;
  readonly knowledgeUpdatedAt?: string;
}

export interface PlaceFrontierView {
  readonly globe: WorkspaceGlobePresentation;
  readonly globeMode: "full" | "collapsed";
  readonly markers: readonly ResearchCandidate[];
  readonly progress: readonly ResearchProgressItem[];
  readonly liveTimeline: readonly PlaceFrontierEvent[];
  readonly cards: readonly PlaceFrontierCountryCard[];
  readonly summary?: ReturnType<typeof projectTerminalSummary>;
  readonly snapshotId?: string;
  readonly announcement?: string;
  readonly transportError?: string;
}

const RUSSIA_ORIGIN = Object.freeze({
  label: "Россия",
  kind: "country" as const,
  country: "Россия",
  flag: "🇷🇺",
  coordinate: Object.freeze({ lat: 55.7558, lng: 37.6173 }),
});

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

function numericRunKey(runId: string): number {
  let hash = 0;
  for (const character of runId) hash = Math.imul(hash, 31) + character.codePointAt(0)! | 0;
  return Math.abs(hash) || 1;
}

function markerCandidate(
  country: FrontierCountry,
  completed?: FrontierMarker,
): ResearchCandidate {
  const status = completed?.formalVerdict.marker ?? "pending";
  const reasons = completed?.formalVerdict.reasons ?? [];
  const uniqueBy = <T,>(values: readonly T[], key: (value: T) => string): readonly T[] => {
    const seen = new Set<string>();
    return values.filter((value) => {
      const identity = key(value);
      if (seen.has(identity)) return false;
      seen.add(identity);
      return true;
    });
  };
  const officialUrls = uniqueBy(
    reasons.flatMap((reason) => reason.evidence.map(({ navigationUrl }) => navigationUrl)),
    (url) => url,
  );
  const manualCheckLinks = uniqueBy(
    reasons.flatMap((reason) => reason.navigation),
    ({ label, url }) => `${label}\u0000${url}`,
  );
  const summaries = uniqueBy(reasons.map(({ summary }) => summary), (summary) => summary);
  return {
    id: country.countryCode,
    label: country.label,
    kind: "country",
    country: country.label,
    flag: country.flag,
    coordinate: country.coordinate,
    description: "Проверяем формальную доступность долгосрочного проживания.",
    status,
    ...(reasons.length === 0 ? {} : {
      reason: {
        summary: summaries.join(" · "),
        ...(officialUrls[0] === undefined ? {} : { officialUrl: officialUrls[0] }),
        ...(officialUrls.length === 0 ? {} : { officialUrls }),
        ...(manualCheckLinks.length === 0 ? {} : { manualCheckLinks }),
      },
    }),
  };
}

function progressItems(events: readonly PlaceFrontierEvent[]): readonly ResearchProgressItem[] {
  const progress = events.flatMap((event) => event.type !== "country_progress"
    ? []
    : [{
        key: `event-${event.sequence}`,
        label: event.payload.label,
        ...(event.payload.detail === undefined ? {} : { detail: event.payload.detail }),
        ...(event.payload.sourceUrl === undefined ? {} : { sourceUrl: event.payload.sourceUrl }),
        current: false,
      }]);
  return progress.map((item, index) => ({
    ...item,
    current: index === progress.length - 1,
  }));
}

function countryCard(
  readModel: PlaceFrontierReadModel,
  marker: FrontierMarker,
): PlaceFrontierCountryCard {
  const ranked = readModel.rankingSnapshot.ordered[marker.rank - 1];
  if (
    ranked === undefined ||
    ranked.countryCode !== marker.country.countryCode ||
    ranked.label !== marker.country.label ||
    ranked.flag !== marker.country.flag ||
    ranked.coordinate.lat !== marker.country.coordinate.lat ||
    ranked.coordinate.lng !== marker.country.coordinate.lng
  ) throw new Error("invalid_terminal_ranking_join");
  return freezeCopy({
    country: marker.country,
    rank: marker.rank,
    relevance: ranked.relevance,
    coverage: ranked.coverage,
    contributions: ranked.contributions,
    formalVerdict: marker.formalVerdict,
    evidenceSnapshotId: marker.evidenceSnapshotId,
    sourceAssessmentRulesVersion: marker.sourceAssessmentRulesVersion,
    rankingKnowledgeRevisionId:
      readModel.rankingSnapshot.knowledgeRevisionIds[marker.country.countryCode] ?? null,
    ...(marker.currentKnowledgeRevisionId === undefined ? {} : {
      currentKnowledgeRevisionId: marker.currentKnowledgeRevisionId,
    }),
    ...(marker.updatedKnowledgeRevisionId === undefined ? {} : {
      currentRunUpdatedRevisionId: marker.updatedKnowledgeRevisionId,
    }),
    lastCheckedAt: marker.lastCheckedAt,
    ...(marker.knowledgeUpdatedAt === undefined ? {} : {
      knowledgeUpdatedAt: marker.knowledgeUpdatedAt,
    }),
  });
}

function validateReload(readModel: PlaceFrontierReadModel): PlaceFrontierReadModel {
  let state = initialPlaceFrontierEventState();
  let sequence = 0;
  const envelope = () => ({
    runId: readModel.runId,
    sequence: ++sequence,
    occurredAt: readModel.shortlistSnapshot.createdAt,
  });
  state = reducePlaceFrontierEvent(state, {
    ...envelope(),
    type: "ranking_sealed",
    payload: {
      rankingSnapshotId: readModel.rankingSnapshot.id,
      orderedCountryCodes: readModel.rankingSnapshot.ordered.map(({ countryCode }) => countryCode),
      excludedCountryCodes: [...new Set(
        readModel.rankingSnapshot.excluded.map(({ countryCode }) => countryCode),
      )].sort(),
    },
  });
  for (const marker of readModel.shortlistSnapshot.markers) {
    state = reducePlaceFrontierEvent(state, {
      ...envelope(),
      type: "country_activated",
      payload: { country: marker.country, rank: marker.rank },
    });
    state = reducePlaceFrontierEvent(state, {
      ...envelope(),
      type: "country_completed",
      payload: { marker },
    });
  }
  state = reducePlaceFrontierEvent(state, {
    ...envelope(),
    type: "frontier_completed",
    payload: { readModel },
  });
  return state.terminal!;
}

export function createPlaceFrontierRunningState(runId: string): PlaceFrontierScreenState {
  return Object.freeze({ kind: "running", runId, stream: initialPlaceFrontierEventState() });
}

export function reducePlaceFrontierScreenEvent(
  state: PlaceFrontierScreenState,
  event: PlaceFrontierEvent,
): PlaceFrontierScreenState {
  if (state.kind !== "running") throw new Error("screen_not_running");
  if (event.runId !== state.runId) throw new Error("changed_run_id");
  const stream = reducePlaceFrontierEvent(state.stream, event);
  if (event.type === "frontier_completed") {
    return Object.freeze({
      kind: "completed",
      runId: state.runId,
      stream,
      readModel: stream.terminal!,
    });
  }
  return Object.freeze({ kind: "running", runId: state.runId, stream });
}

export function failPlaceFrontierScreen(
  state: PlaceFrontierScreenState,
  message: string,
): PlaceFrontierScreenState {
  if (state.kind !== "running") return state;
  return Object.freeze({
    kind: "transportError",
    runId: state.runId,
    stream: state.stream,
    message,
  });
}

export function presentPlaceFrontierReadModel(
  readModel: PlaceFrontierReadModel,
): PlaceFrontierScreenState {
  const verified = validateReload(readModel);
  return Object.freeze({
    kind: "completed",
    runId: verified.runId,
    stream: initialPlaceFrontierEventState(),
    readModel: verified,
  });
}

export function projectPlaceFrontierView(state: PlaceFrontierScreenState): PlaceFrontierView {
  const terminal = state.kind === "completed" ? state.readModel : undefined;
  const liveTimeline = state.stream.events;
  const countryStates = terminal === undefined
    ? state.stream.countries
    : terminal.shortlistSnapshot.markers.map((completed) => ({
        country: completed.country,
        rank: completed.rank,
        completed,
      }));
  const markers = countryStates.map(({ country, completed }) =>
    markerCandidate(country, completed));
  const routes = markers.map((candidate) =>
    createProductGlobeRoute(RUSSIA_ORIGIN, candidate, state.runId));
  const progress = progressItems(liveTimeline);
  const newestProgress = progress.at(-1);
  const cards = terminal?.shortlistSnapshot.markers
    .filter(({ formalVerdict }) => formalVerdict.marker !== "red")
    .map((marker) => countryCard(terminal, marker)) ?? [];
  return freezeCopy({
    globe: {
      ...(terminal !== undefined || state.stream.countries.length === 0 ? {} : {
        activeFlight: routes.at(-1),
      }),
      ariaLabel: "3D Земля проверки стран",
      origin: RUSSIA_ORIGIN,
      overview: {
        coordinates: [RUSSIA_ORIGIN.coordinate, ...markers.map(({ coordinate }) => coordinate)],
        key: numericRunKey(state.runId),
      },
      routes,
    },
    globeMode: terminal === undefined ? "full" : "collapsed",
    markers,
    progress,
    liveTimeline,
    cards,
    ...(terminal === undefined ? {} : { summary: projectTerminalSummary(terminal) }),
    ...((terminal?.shortlistSnapshot.id ?? state.stream.ranking?.rankingSnapshotId) === undefined
      ? {}
      : { snapshotId: terminal?.shortlistSnapshot.id ?? state.stream.ranking?.rankingSnapshotId }),
    ...(newestProgress === undefined ? {} : {
      announcement: newestProgress.detail === undefined
        ? newestProgress.label
        : `${newestProgress.label}. ${newestProgress.detail}`,
    }),
    ...(state.kind === "transportError" ? { transportError: state.message } : {}),
  });
}
