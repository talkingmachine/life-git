import type { ColdStartEvent, ColdStartReadModel } from "../application/cold-start";
import type {
  CandidateState,
  ResearchCandidate,
  ResearchProgressItem,
  WorkspaceGlobePresentation,
} from "./research-map/contracts";
import { createProductGlobeRoute } from "./research-map/product-route";
import {
  initialColdStartEventState,
  reduceColdStartEvent,
  type ColdStartEventState,
} from "./cold-start-stream";

export type ColdStartScreenState =
  | {
      readonly kind: "running";
      readonly runId: string;
      readonly stream: ColdStartEventState;
    }
  | {
      readonly kind: "completed";
      readonly runId: string;
      readonly stream: ColdStartEventState;
      readonly readModel: ColdStartReadModel;
    }
  | {
      readonly kind: "transportError";
      readonly runId: string;
      readonly stream: ColdStartEventState;
      readonly message: string;
    };

export interface ColdStartView {
  readonly announcement?: string;
  readonly candidate: ResearchCandidate;
  readonly globe: WorkspaceGlobePresentation;
  readonly globeMode: "full" | "collapsed";
  readonly marker: "pending" | "green" | "yellow" | "red";
  readonly progress: readonly ResearchProgressItem[];
  readonly readModel?: ColdStartReadModel;
  readonly transportError?: string;
}

const RUSSIA_ORIGIN = Object.freeze({
  label: "Россия",
  kind: "country" as const,
  country: "Россия",
  flag: "🇷🇺",
  coordinate: Object.freeze({ lat: 55.7558, lng: 37.6173 }),
});

const SLOVENIA = Object.freeze({
  id: "SI",
  label: "Словения",
  kind: "country" as const,
  country: "Словения",
  flag: "🇸🇮",
  coordinate: Object.freeze({ lat: 46.1512, lng: 14.9955 }),
  description: "Проверяем официальный маршрут релокации на уровне страны.",
});

interface ProgressDraft {
  readonly eventType: ColdStartEvent["type"];
  readonly key: string;
  readonly label: string;
  readonly detail?: string;
  readonly sourceUrl?: string;
  readonly count: number;
}

function progressDraft(event: ColdStartEvent): ProgressDraft {
  switch (event.type) {
    case "source_discovered":
      return {
        eventType: event.type,
        key: `event-${event.sequence}`,
        label: "Найден официальный кандидат",
        detail: event.payload.url,
        sourceUrl: event.payload.url,
        count: 1,
      };
    case "authority_verified":
      return {
        eventType: event.type,
        key: `event-${event.sequence}`,
        label: "Подтверждён официальный домен",
        detail: event.payload.authorityRoot,
        sourceUrl: event.payload.authorityRoot,
        count: 1,
      };
    case "artifact_captured":
      return {
        eventType: event.type,
        key: `event-${event.sequence}`,
        label: "Получен официальный документ",
        detail: event.payload.role,
        sourceUrl: event.payload.resolvedUrl,
        count: 1,
      };
    case "claim_verified":
      return {
        eventType: event.type,
        key: `event-${event.sequence}`,
        label: "Проверено утверждение",
        detail: event.payload.claimKind,
        count: 1,
      };
    case "dossier_published":
      return {
        eventType: event.type,
        key: `event-${event.sequence}`,
        label: event.payload.created
          ? "Опубликовано проверенное досье страны"
          : "Подтверждена действующая версия досье страны",
        detail: event.payload.label,
        count: 1,
      };
    case "assessment_completed":
      return {
        eventType: event.type,
        key: `event-${event.sequence}`,
        label: "Сформирован персональный вывод",
        detail: event.payload.readModel.comparator.personalFit,
        count: 1,
      };
  }
}

function aggregateProgress(events: readonly ColdStartEvent[]): readonly ResearchProgressItem[] {
  const drafts: ProgressDraft[] = [];
  for (const event of events) {
    const next = progressDraft(event);
    const previous = drafts.at(-1);
    const aggregates = next.eventType === "artifact_captured" || next.eventType === "claim_verified";
    if (aggregates && previous?.eventType === next.eventType) {
      drafts[drafts.length - 1] = { ...previous, count: previous.count + 1 };
    } else {
      drafts.push(next);
    }
  }
  return drafts.map((draft, index) => ({
    key: draft.key,
    label: draft.count === 1
      ? draft.label
      : draft.eventType === "artifact_captured"
        ? `Получены официальные документы · ${draft.count}`
        : `Проверены утверждения · ${draft.count}`,
    ...(draft.detail === undefined ? {} : { detail: draft.detail }),
    ...(draft.sourceUrl === undefined ? {} : { sourceUrl: draft.sourceUrl }),
    current: index === drafts.length - 1,
  }));
}

function numericRunKey(runId: string): number {
  let hash = 0;
  for (const character of runId) hash = Math.imul(hash, 31) + character.codePointAt(0)! | 0;
  return Math.abs(hash) || 1;
}

export function createColdStartRunningState(runId: string): ColdStartScreenState {
  return Object.freeze({ kind: "running", runId, stream: initialColdStartEventState() });
}

export function reduceColdStartScreenEvent(
  state: ColdStartScreenState,
  event: ColdStartEvent,
): ColdStartScreenState {
  if (state.kind !== "running") throw new Error("screen_not_running");
  if (event.runId !== state.runId) throw new Error("changed_run_id");
  const stream = reduceColdStartEvent(state.stream, event);
  if (event.type === "assessment_completed") {
    return Object.freeze({
      kind: "completed",
      runId: state.runId,
      stream,
      readModel: event.payload.readModel,
    });
  }
  return Object.freeze({ kind: "running", runId: state.runId, stream });
}

export function failColdStartScreen(
  state: ColdStartScreenState,
  message: string,
): ColdStartScreenState {
  if (state.kind !== "running") return state;
  return Object.freeze({
    kind: "transportError",
    runId: state.runId,
    stream: state.stream,
    message,
  });
}

export function presentColdStartReadModel(readModel: ColdStartReadModel): ColdStartScreenState {
  return Object.freeze({
    kind: "completed",
    runId: readModel.runId,
    stream: initialColdStartEventState(),
    readModel,
  });
}

export function projectColdStartView(state: ColdStartScreenState): ColdStartView {
  const terminal = state.kind === "completed" ? state.readModel : undefined;
  const status: CandidateState = terminal?.comparator.marker ?? "pending";
  const firstReason = terminal?.comparator.formalVerdict.reasons[0];
  const candidate: ResearchCandidate = {
    ...SLOVENIA,
    status,
    ...(status === "green" || firstReason === undefined
      ? {}
      : {
          reason: {
            summary: firstReason.summary,
            ...(firstReason.evidence[0]?.navigationUrl === undefined
              ? {}
              : { officialUrl: firstReason.evidence[0].navigationUrl }),
          },
        }),
  };
  const route = createProductGlobeRoute(RUSSIA_ORIGIN, candidate, state.runId);
  const progress = aggregateProgress(state.stream.events);
  const newest = progress.at(-1);
  return {
    ...(newest === undefined ? {} : {
      announcement: newest.detail === undefined
        ? newest.label
        : `${newest.label}. ${newest.detail}`,
    }),
    candidate,
    globe: {
      activeFlight: route,
      ariaLabel: "3D Земля маршрута Россия → Словения",
      origin: RUSSIA_ORIGIN,
      overview: {
        coordinates: [RUSSIA_ORIGIN.coordinate, SLOVENIA.coordinate],
        key: numericRunKey(state.runId),
      },
      routes: status === "green" ? [] : [route],
    },
    globeMode: terminal === undefined ? "full" : "collapsed",
    marker: terminal?.comparator.marker ?? "pending",
    progress,
    ...(terminal === undefined ? {} : { readModel: terminal }),
    ...(state.kind === "transportError" ? { transportError: state.message } : {}),
  };
}
