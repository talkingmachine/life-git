import { z } from "zod";

import {
  projectTerminalSummary,
  type FrontierCountry,
  type FrontierMarker,
  type PlaceFrontierEvent,
  type PlaceFrontierReadModel,
} from "../application/place-frontier";
import { reconstructFormalResidenceVerdict } from
  "../decision/formal-residence-verdict";
import { readFiniteNdjson } from "./finite-ndjson";

const countryCodeSchema = z.string().regex(/^[A-Z]{2}$/);
const nonEmptyStringSchema = z.string().min(1);
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const decimalSchema = z.string().regex(/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/)
  .refine((value) => Number.isFinite(Number(value)));
const instantSchema = z.string().refine((value) => {
  const parsed = new Date(value);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString() === value;
});
const daySchema = z.string().refine((value) => {
  if (!/^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
});
const criterionSchema = z.enum([
  "outside_cis",
  "europe",
  "personal_safety",
  "infrastructure",
  "peace_and_stability",
]);
const factorStateSchema = z.enum(["known", "missing", "stale", "future", "not_comparable"]);

const coordinateSchema = z.object({
  lat: z.number().finite().min(-90).max(90),
  lng: z.number().finite().min(-180).max(180),
}).strict();

const frontierCountrySchema = z.object({
  countryCode: countryCodeSchema,
  label: nonEmptyStringSchema,
  flag: nonEmptyStringSchema,
  coordinate: coordinateSchema,
}).strict();

const factorSchema = z.object({
  criterionId: criterionSchema,
  state: factorStateSchema,
  match: decimalSchema.optional(),
  requirementStatus: z.enum(["matches", "does_not_match"]).optional(),
  observationId: nonEmptyStringSchema.optional(),
  evaluatorVersion: nonEmptyStringSchema,
}).strict();

const contributionSchema = z.object({
  criterionId: criterionSchema,
  state: factorStateSchema,
  effectiveMatch: decimalSchema,
  weightedContribution: decimalSchema,
  observationId: nonEmptyStringSchema.optional(),
}).strict();

const rankablePlaceSchema = z.object({
  countryCode: countryCodeSchema,
  label: nonEmptyStringSchema,
  flag: nonEmptyStringSchema,
  coordinate: coordinateSchema,
  factors: z.array(factorSchema),
}).strict();

const rankedPlaceSchema = rankablePlaceSchema.extend({
  rank: z.number().int().positive(),
  relevance: decimalSchema,
  coverage: decimalSchema,
  contributions: z.array(contributionSchema),
}).strict();

const requiredMismatchSchema = z.object({
  countryCode: countryCodeSchema,
  criterionId: criterionSchema,
  observationId: nonEmptyStringSchema,
}).strict();

const rankingSchema = z.object({
  schemaVersion: z.literal("place-ranking@1"),
  id: nonEmptyStringSchema,
  runId: nonEmptyStringSchema,
  profileSnapshotId: sha256Schema,
  preferenceProfileSnapshotId: sha256Schema,
  assessmentAt: instantSchema,
  contextHash: sha256Schema,
  knowledgeRevisionIds: z.record(countryCodeSchema, nonEmptyStringSchema.nullable()),
  ordered: z.array(rankedPlaceSchema),
  excludedPlaces: z.array(rankablePlaceSchema),
  excluded: z.array(requiredMismatchSchema),
  rulesVersion: z.literal("place-ranker@1"),
  createdAt: instantSchema,
}).strict();

const markerSchema = z.object({
  country: frontierCountrySchema,
  rank: z.number().int().positive(),
  countryCheckRunId: z.string().regex(/^frontier-country:[a-f0-9]{64}$/),
  sourceAssessmentRulesVersion: z.literal("cold-start-assessment@1"),
  lastCheckedAt: daySchema,
  evidenceSnapshotId: nonEmptyStringSchema,
  currentKnowledgeRevisionId: nonEmptyStringSchema.optional(),
  updatedKnowledgeRevisionId: nonEmptyStringSchema.optional(),
  knowledgeUpdatedAt: instantSchema.optional(),
  formalVerdict: z.unknown(),
}).strict().superRefine((marker, context) => {
  if ((marker.currentKnowledgeRevisionId === undefined) !==
    (marker.knowledgeUpdatedAt === undefined)) {
    context.addIssue({ code: "custom", message: "knowledge_head_metadata_mismatch" });
  }
  if (marker.updatedKnowledgeRevisionId !== undefined &&
    marker.updatedKnowledgeRevisionId !== marker.currentKnowledgeRevisionId) {
    context.addIssue({ code: "custom", message: "knowledge_updated_revision_mismatch" });
  }
});

const shortlistSchema = z.object({
  schemaVersion: z.literal("place-shortlist@1"),
  id: nonEmptyStringSchema,
  runId: nonEmptyStringSchema,
  rankingSnapshotId: nonEmptyStringSchema,
  markers: z.array(markerSchema),
  rulesVersion: z.literal("country-frontier@1"),
  createdAt: instantSchema,
}).strict();

const readModelSchema = z.object({
  runId: nonEmptyStringSchema,
  assessmentAt: instantSchema,
  rankingSnapshot: rankingSchema,
  shortlistSnapshot: shortlistSchema,
}).strict();

const eventBase = {
  runId: nonEmptyStringSchema,
  sequence: z.number().int().positive(),
  occurredAt: instantSchema,
};

const eventSchema = z.discriminatedUnion("type", [
  z.object({
    ...eventBase,
    type: z.literal("ranking_sealed"),
    payload: z.object({
      rankingSnapshotId: nonEmptyStringSchema,
      orderedCountryCodes: z.array(countryCodeSchema),
      excludedCountryCodes: z.array(countryCodeSchema),
    }).strict(),
  }).strict(),
  z.object({
    ...eventBase,
    type: z.literal("country_activated"),
    payload: z.object({
      country: frontierCountrySchema,
      rank: z.number().int().positive(),
    }).strict(),
  }).strict(),
  z.object({
    ...eventBase,
    type: z.literal("country_progress"),
    payload: z.object({
      countryCode: countryCodeSchema,
      stage: z.enum([
        "source_discovered",
        "authority_verified",
        "artifact_captured",
        "claim_verified",
        "dossier_published",
      ]),
      label: nonEmptyStringSchema,
      detail: nonEmptyStringSchema.optional(),
      sourceUrl: z.url().optional(),
    }).strict(),
  }).strict(),
  z.object({
    ...eventBase,
    type: z.literal("country_completed"),
    payload: z.object({ marker: markerSchema }).strict(),
  }).strict(),
  z.object({
    ...eventBase,
    type: z.literal("frontier_completed"),
    payload: z.object({ readModel: readModelSchema }).strict(),
  }).strict(),
]);

export interface PlaceFrontierEventState {
  readonly events: readonly PlaceFrontierEvent[];
  readonly lastSequence: number;
  readonly runId?: string;
  readonly ranking?: {
    readonly rankingSnapshotId: string;
    readonly orderedCountryCodes: readonly string[];
    readonly excludedCountryCodes: readonly string[];
  };
  readonly countries: readonly {
    readonly country: FrontierCountry;
    readonly rank: number;
    readonly completed?: FrontierMarker;
  }[];
  readonly terminal?: PlaceFrontierReadModel;
}

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

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalValue(child)]));
  }
  return value;
}

export function canonicalPlaceFrontierValue(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

function sameValue(left: unknown, right: unknown): boolean {
  return canonicalPlaceFrontierValue(left) === canonicalPlaceFrontierValue(right);
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function unique(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

function parseMarker(value: unknown, profileSnapshotId?: string): FrontierMarker {
  const envelope = markerSchema.parse(value);
  const formalVerdict = reconstructFormalResidenceVerdict(envelope.formalVerdict, {
    ...(profileSnapshotId === undefined ? {} : { profileSnapshotId }),
    evidenceSnapshotId: envelope.evidenceSnapshotId,
  });
  return freezeCopy({ ...envelope, formalVerdict }) as FrontierMarker;
}

function parseEvent(value: unknown): PlaceFrontierEvent {
  const event = eventSchema.parse(value);
  if (event.type === "country_completed") {
    return freezeCopy({
      ...event,
      payload: { marker: parseMarker(event.payload.marker) },
    }) as PlaceFrontierEvent;
  }
  return freezeCopy(event) as PlaceFrontierEvent;
}

function assertRankingEnvelope(
  readModel: PlaceFrontierReadModel,
  state: PlaceFrontierEventState,
): void {
  const ranking = readModel.rankingSnapshot;
  const sealed = state.ranking!;
  const orderedCodes = ranking.ordered.map(({ countryCode }) => countryCode);
  const excludedCodes = [...new Set(ranking.excluded.map(({ countryCode }) => countryCode))].sort();
  const excludedPlaceCodes = ranking.excludedPlaces.map(({ countryCode }) => countryCode).sort();
  const allCodes = [...orderedCodes, ...excludedCodes].sort();
  if (
    readModel.runId !== state.runId ||
    readModel.assessmentAt !== ranking.assessmentAt ||
    ranking.runId !== state.runId ||
    ranking.id !== sealed.rankingSnapshotId ||
    ranking.id !== `${state.runId}:ranking` ||
    ranking.createdAt !== ranking.assessmentAt ||
    !sameStrings(orderedCodes, sealed.orderedCountryCodes) ||
    !sameStrings(excludedCodes, sealed.excludedCountryCodes) ||
    !sameStrings(excludedPlaceCodes, excludedCodes) ||
    !unique(orderedCodes) ||
    orderedCodes.some((code) => excludedCodes.includes(code)) ||
    ranking.ordered.some(({ rank }, index) => rank !== index + 1) ||
    !sameStrings(Object.keys(ranking.knowledgeRevisionIds).sort(), allCodes)
  ) throw new Error("terminal_ranking_mismatch");
}

function assertTerminal(
  state: PlaceFrontierEventState,
  rawReadModel: PlaceFrontierReadModel,
): PlaceFrontierReadModel {
  const readModel = readModelSchema.parse(rawReadModel) as PlaceFrontierReadModel;
  assertRankingEnvelope(readModel, state);
  const shortlist = readModel.shortlistSnapshot;
  const completed = state.countries.flatMap(({ completed }) => completed === undefined ? [] : [completed]);
  const terminalMarkers = shortlist.markers.map((marker) =>
    parseMarker(marker, readModel.rankingSnapshot.profileSnapshotId));
  if (
    shortlist.id !== `${state.runId}:shortlist` ||
    shortlist.runId !== state.runId ||
    shortlist.rankingSnapshotId !== state.ranking?.rankingSnapshotId ||
    !sameValue(terminalMarkers, completed) ||
    state.countries.some(({ completed: marker }) => marker === undefined)
  ) throw new Error("terminal_shortlist_mismatch");
  const normalized = freezeCopy({
    ...readModel,
    shortlistSnapshot: { ...shortlist, markers: terminalMarkers },
  });
  const summary = projectTerminalSummary(normalized);
  const isExhausted = completed.length === state.ranking?.orderedCountryCodes.length;
  if (!(
    summary.stopCondition === "five_non_red" && summary.countries.length === 5 ||
    summary.stopCondition === "installed_coverage_exhausted" && isExhausted
  )) throw new Error("premature_terminal_event");
  return normalized;
}

export function initialPlaceFrontierEventState(): PlaceFrontierEventState {
  return Object.freeze({
    events: Object.freeze([]),
    lastSequence: 0,
    countries: Object.freeze([]),
  });
}

export function reducePlaceFrontierEvent(
  state: PlaceFrontierEventState,
  rawEvent: PlaceFrontierEvent,
): PlaceFrontierEventState {
  const event = parseEvent(rawEvent);
  if (state.terminal !== undefined) throw new Error("event_after_terminal");
  if (event.sequence !== state.lastSequence + 1) throw new Error("invalid_event_sequence");
  if (state.runId !== undefined && event.runId !== state.runId) throw new Error("changed_run_id");
  if (state.lastSequence === 0 && (event.type !== "ranking_sealed" || event.sequence !== 1)) {
    throw new Error("ranking_must_be_first");
  }
  if (state.lastSequence > 0 && event.type === "ranking_sealed") {
    throw new Error("duplicate_ranking_event");
  }

  let ranking = state.ranking;
  let countries = state.countries;
  let terminal: PlaceFrontierReadModel | undefined;
  if (event.type === "ranking_sealed") {
    const { orderedCountryCodes, excludedCountryCodes, rankingSnapshotId } = event.payload;
    const sortedExcluded = [...excludedCountryCodes].sort();
    if (
      rankingSnapshotId !== `${event.runId}:ranking` ||
      orderedCountryCodes.length === 0 ||
      !unique(orderedCountryCodes) ||
      !unique(excludedCountryCodes) ||
      !sameStrings(sortedExcluded, excludedCountryCodes) ||
      orderedCountryCodes.some((code) => excludedCountryCodes.includes(code))
    ) throw new Error("invalid_frozen_ranking");
    ranking = freezeCopy(event.payload);
  } else if (ranking === undefined) {
    throw new Error("ranking_must_be_first");
  } else if (event.type === "country_activated") {
    const nextIndex = countries.length;
    const expectedCode = ranking.orderedCountryCodes[nextIndex];
    const occupiedSlots = countries.filter(({ completed }) =>
      completed?.formalVerdict.marker !== "red").length;
    if (
      expectedCode === undefined ||
      occupiedSlots >= 5 ||
      event.payload.country.countryCode !== expectedCode ||
      event.payload.rank !== nextIndex + 1 ||
      countries.some(({ country }) => country.countryCode === expectedCode)
    ) throw new Error("invalid_country_activation");
    countries = [...countries, freezeCopy(event.payload)];
  } else if (event.type === "country_progress") {
    const target = countries.find(({ country }) =>
      country.countryCode === event.payload.countryCode);
    if (target === undefined || target.completed !== undefined) {
      throw new Error("invalid_country_progress");
    }
  } else if (event.type === "country_completed") {
    const targetIndex = countries.findIndex(({ country }) =>
      country.countryCode === event.payload.marker.country.countryCode);
    const target = countries[targetIndex];
    if (
      target === undefined ||
      target.completed !== undefined ||
      target.rank !== event.payload.marker.rank ||
      !sameValue(target.country, event.payload.marker.country)
    ) throw new Error("invalid_country_completion");
    countries = countries.map((countryState, index) => index === targetIndex
      ? freezeCopy({ ...countryState, completed: event.payload.marker })
      : countryState);
  } else {
    terminal = assertTerminal({ ...state, ranking, countries }, event.payload.readModel);
  }

  return freezeCopy({
    events: [...state.events, event],
    lastSequence: event.sequence,
    runId: state.runId ?? event.runId,
    ranking,
    countries,
    ...(terminal === undefined ? {} : { terminal }),
  });
}

export async function* decodePlaceFrontierStream(
  stream: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<PlaceFrontierEvent> {
  let state = initialPlaceFrontierEventState();
  let pendingTerminal: PlaceFrontierEvent | undefined;
  for await (const value of readFiniteNdjson(stream, signal)) {
    const event = parseEvent(value);
    state = reducePlaceFrontierEvent(state, event);
    if (event.type === "frontier_completed") pendingTerminal = event;
    else yield event;
  }
  if (state.terminal === undefined || pendingTerminal === undefined) {
    throw new Error("missing_terminal_event");
  }
  yield pendingTerminal;
}
