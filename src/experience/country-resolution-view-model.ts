import type {
  CountryResolutionContinuationEvent,
  CountryResolutionReadModel,
} from "../application/country-resolution";
import type { FrontierCountry, FrontierMarker } from "../application/country-verifier";
import {
  deriveYellowUncertaintyBasis,
  effectiveCountryStatus,
  type YellowUncertaintyBasis,
} from "../decision/country-resolution-policy";
import {
  initialCountryResolutionEventState,
  normalizeCountryResolutionReadModel,
  reduceCountryResolutionEvent,
  type CountryResolutionEventState,
} from "./country-resolution-stream";
import {
  projectPlaceFrontierCountryCard,
  type PlaceFrontierCountryCard,
} from "./place-frontier-view-model";

export interface CountryResolutionCandidateView {
  readonly country: FrontierCountry;
  readonly rank: number;
  readonly status: "pending" | "green" | "yellow" | "red";
  readonly statusLabel:
    | "Проверяется"
    | "Доступно для выбора"
    | "Требует решения"
    | "Исключено";
  readonly summary?: string;
  readonly officialUrls: readonly string[];
  readonly manualCheckLinks: readonly { readonly label: string; readonly url: string }[];
}

export interface CountryResolutionView {
  readonly candidates: readonly CountryResolutionCandidateView[];
  readonly currentPrompt?: {
    readonly countryCode: string;
    readonly uncertainty: YellowUncertaintyBasis;
    readonly warningCopyVersion: "yellow-risk@1";
  };
  readonly canContinue: boolean;
  readonly cards: readonly PlaceFrontierCountryCard[];
  readonly globeMode: "full" | "collapsed";
  readonly requiresVerifiedReload: boolean;
  readonly transportError?: string;
}

export type CountryResolutionScreenState =
  | { readonly kind: "stable"; readonly readModel: CountryResolutionReadModel }
  | {
      readonly kind: "continuing";
      readonly readModel: CountryResolutionReadModel;
      readonly stream: CountryResolutionEventState;
    }
  | {
      readonly kind: "transportError";
      readonly readModel: CountryResolutionReadModel;
      readonly stream: CountryResolutionEventState;
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

function markerSequence(readModel: CountryResolutionReadModel): readonly FrontierMarker[] {
  return [
    ...readModel.automaticFrontier.shortlistSnapshot.markers,
    ...readModel.revision.replacementMarkers,
  ];
}

function uniqueBy<T>(values: readonly T[], key: (value: T) => string): readonly T[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const identity = key(value);
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

function links(uncertainty: YellowUncertaintyBasis): {
  readonly officialUrls: readonly string[];
  readonly manualCheckLinks: readonly { readonly label: string; readonly url: string }[];
} {
  const reasons = [
    ...uncertainty.unknownRoutes.flatMap(({ reasons: items }) => items),
    ...(uncertainty.catalogCompletenessUnprovable === undefined
      ? []
      : [uncertainty.catalogCompletenessUnprovable]),
  ];
  return {
    officialUrls: uniqueBy(reasons.flatMap(({ evidence }) =>
      evidence.map(({ navigationUrl }) => navigationUrl)), (url) => url),
    manualCheckLinks: uniqueBy(reasons.flatMap(({ navigation }) =>
      navigation.map(({ label, url }) => ({ label, url }))),
    ({ label, url }) => `${label}\u0000${url}`),
  };
}

function markerCandidate(
  marker: FrontierMarker,
  readModel: CountryResolutionReadModel,
): CountryResolutionCandidateView {
  const decision = readModel.revision.decisions.find(
    ({ countryCode }) => countryCode === marker.country.countryCode,
  );
  const status = effectiveCountryStatus(marker.formalVerdict.marker, decision?.decision);
  const isCurrentPrompt = readModel.revision.kind === "working" &&
    readModel.revision.phase === "awaiting_decision" &&
    readModel.revision.unresolvedCountryCodes[0] === marker.country.countryCode;
  const promptLinks = isCurrentPrompt
    ? links(deriveYellowUncertaintyBasis(marker.formalVerdict))
    : { officialUrls: [], manualCheckLinks: [] };
  return freezeCopy({
    country: marker.country,
    rank: marker.rank,
    status,
    statusLabel: status === "yellow"
      ? "Требует решения"
      : status === "red"
        ? "Исключено"
        : "Доступно для выбора",
    ...(decision?.decision === "rejected" ? {
      summary: "Формальные данные остались неполными; пользователь отказался принимать риск " +
        "самостоятельной проверки.",
    } : {}),
    ...promptLinks,
  });
}

function pendingCandidate(
  active: NonNullable<CountryResolutionEventState["activeReplacement"]>,
): CountryResolutionCandidateView {
  return freezeCopy({
    country: active.country,
    rank: active.rank,
    status: "pending",
    statusLabel: "Проверяется",
    officialUrls: [],
    manualCheckLinks: [],
  });
}

function currentPrompt(readModel: CountryResolutionReadModel): CountryResolutionView["currentPrompt"] {
  if (readModel.revision.kind !== "working" ||
    readModel.revision.phase !== "awaiting_decision") return undefined;
  const countryCode = readModel.revision.unresolvedCountryCodes[0];
  const marker = markerSequence(readModel).find((candidate) =>
    candidate.country.countryCode === countryCode);
  if (countryCode === undefined || marker?.formalVerdict.marker !== "yellow") {
    throw new Error("invalid_resolution_prompt");
  }
  return freezeCopy({
    countryCode,
    uncertainty: deriveYellowUncertaintyBasis(marker.formalVerdict),
    warningCopyVersion: "yellow-risk@1",
  });
}

export function presentCountryResolutionReadModel(
  readModel: CountryResolutionReadModel,
): CountryResolutionScreenState {
  return Object.freeze({
    kind: "stable",
    readModel: normalizeCountryResolutionReadModel(readModel),
  });
}

export function beginCountryResolutionContinuation(
  readModel: CountryResolutionReadModel,
): CountryResolutionScreenState {
  const normalized = normalizeCountryResolutionReadModel(readModel);
  if (normalized.revision.kind !== "working" ||
    normalized.revision.phase !== "replacement_required") {
    throw new Error("resolution_not_continuable");
  }
  return Object.freeze({
    kind: "continuing",
    readModel: normalized,
    stream: initialCountryResolutionEventState(normalized),
  });
}

export function reduceCountryResolutionContinuationEvent(
  state: CountryResolutionScreenState,
  event: CountryResolutionContinuationEvent,
): CountryResolutionScreenState {
  if (state.kind !== "continuing") throw new Error("resolution_not_continuing");
  const ranked = state.readModel.automaticFrontier.rankingSnapshot.ordered[
    state.readModel.revision.nextUncheckedRank - 1
  ];
  const stream = reduceCountryResolutionEvent(state.stream, event, ranked === undefined
    ? undefined
    : {
        country: {
          countryCode: ranked.countryCode,
          label: ranked.label,
          flag: ranked.flag,
          coordinate: ranked.coordinate,
        },
        rank: ranked.rank,
      }, state.readModel);
  if (event.type === "resolution_continuation_completed") {
    return presentCountryResolutionReadModel(stream.terminal!);
  }
  const readModel = event.type === "resolution_revision_committed"
    ? normalizeCountryResolutionReadModel({
        ...state.readModel,
        revision: event.payload.revision,
      })
    : state.readModel;
  return Object.freeze({ kind: "continuing", readModel, stream });
}

export function failCountryResolutionContinuation(
  state: CountryResolutionScreenState,
  message: string,
): CountryResolutionScreenState {
  if (state.kind !== "continuing") return state;
  return Object.freeze({
    kind: "transportError",
    readModel: state.readModel,
    stream: state.stream,
    message,
  });
}

function resolvedCards(readModel: CountryResolutionReadModel): readonly PlaceFrontierCountryCard[] {
  if (readModel.revision.kind !== "resolved") return [];
  const markerByCode = new Map(markerSequence(readModel).map((marker) =>
    [marker.country.countryCode, marker]));
  return readModel.revision.resolvedEntries.map(({ countryCode }) => {
    const marker = markerByCode.get(countryCode);
    if (marker === undefined) throw new Error("missing_resolved_marker");
    return projectPlaceFrontierCountryCard(readModel.automaticFrontier, marker);
  });
}

export function projectCountryResolutionView(
  state: CountryResolutionScreenState,
): CountryResolutionView {
  const markers = markerSequence(state.readModel);
  const candidates: CountryResolutionCandidateView[] = markers.map((marker) =>
    markerCandidate(marker, state.readModel));
  if (state.kind !== "stable" && state.stream.activeReplacement !== undefined &&
    !markers.some(({ country }) =>
      country.countryCode === state.stream.activeReplacement?.country.countryCode)) {
    candidates.push(pendingCandidate(state.stream.activeReplacement));
  }
  const prompt = currentPrompt(state.readModel);
  const isResolved = state.kind === "stable" && state.readModel.revision.kind === "resolved";
  return freezeCopy({
    candidates,
    ...(prompt === undefined ? {} : { currentPrompt: prompt }),
    canContinue: state.kind !== "continuing" &&
      state.readModel.revision.kind === "working" &&
      state.readModel.revision.phase === "replacement_required",
    cards: isResolved ? resolvedCards(state.readModel) : [],
    globeMode: isResolved ? "collapsed" : "full",
    requiresVerifiedReload: state.kind === "transportError" &&
      state.stream.committedRevisionIds.includes(state.readModel.revision.id),
    ...(state.kind === "transportError" ? { transportError: state.message } : {}),
  });
}
