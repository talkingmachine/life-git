import { z } from "zod";

import type {
  CountryResolutionContinuationEvent,
  CountryResolutionReadModel,
} from "../application/country-resolution";
import type { CountryResolutionRevision } from
  "../application/country-resolution-contracts";
import type {
  CountryVerificationProgress,
  FrontierCountry,
  FrontierMarker,
} from "../application/country-verifier";
import {
  deriveYellowUncertaintyBasis,
  reconstructCountryResolution,
  type ResolutionMarkerProjection,
} from "../decision/country-resolution-policy";
import {
  cancelStreamWithoutMasking,
  createFiniteStreamHandoff,
  readFiniteNdjson,
  type FiniteStreamHandoff,
} from "./finite-ndjson";
import {
  canonicalPlaceFrontierValue,
  normalizeFrontierMarker,
  normalizePlaceFrontierReadModel,
} from "./place-frontier-stream";

const nonEmptyString = z.string().min(1);
const countryCode = z.string().regex(/^[A-Z]{2}$/);
const instant = z.string().refine((value) => {
  const parsed = new Date(value);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString() === value;
});
const progressStage = z.enum([
  "source_discovered",
  "authority_verified",
  "artifact_captured",
  "claim_verified",
  "dossier_published",
]);
const coordinate = z.object({
  lat: z.number().finite().min(-90).max(90),
  lng: z.number().finite().min(-180).max(180),
}).strict();
const frontierCountry = z.object({
  countryCode,
  label: nonEmptyString,
  flag: nonEmptyString,
  coordinate,
}).strict();
const evidenceReference = z.object({
  evidenceSnapshotId: nonEmptyString,
  artifactId: nonEmptyString,
  sourceId: nonEmptyString,
  navigationUrl: z.url(),
  resolvedEvidenceUrl: z.url(),
  sourcePeriod: nonEmptyString,
  locator: nonEmptyString,
  excerptSha256: nonEmptyString,
  validatorVersion: nonEmptyString,
}).strict();
const uncertaintyReason = z.object({
  code: nonEmptyString,
  claimIds: z.array(nonEmptyString),
  evidence: z.array(evidenceReference),
  navigation: z.array(z.object({
    sourceId: nonEmptyString,
    url: z.url(),
    label: nonEmptyString,
  }).strict()),
}).strict();
const uncertainty = z.object({
  unknownRoutes: z.array(z.object({
    routeId: nonEmptyString,
    reasons: z.array(uncertaintyReason),
  }).strict()),
  catalogCompletenessUnprovable: uncertaintyReason.optional(),
}).strict();
const decision = z.object({
  countryCode,
  decision: z.enum(["accepted_at_own_risk", "rejected"]),
  formalMarkerDigest: nonEmptyString,
  uncertaintyBasis: uncertainty,
  warningCopyVersion: z.literal("yellow-risk@1"),
  decidedAt: instant,
  commandId: nonEmptyString,
}).strict();
const revisionBase = {
  schemaVersion: z.literal("country-resolution@1"),
  rulesVersion: z.literal("country-resolution@1"),
  id: nonEmptyString,
  resolutionRunId: nonEmptyString,
  predecessorRevisionId: nonEmptyString.optional(),
  automaticShortlistSnapshotId: nonEmptyString,
  rankingSnapshotId: nonEmptyString,
  profileSnapshotId: nonEmptyString,
  preferenceProfileSnapshotId: nonEmptyString,
  decisions: z.array(decision),
  replacementMarkers: z.array(z.unknown()),
  nextUncheckedRank: z.number().int().positive(),
  unresolvedCountryCodes: z.array(countryCode),
  slotCountryCodes: z.array(countryCode),
  contextHash: nonEmptyString,
  createdAt: instant,
};
const revisionSchema = z.discriminatedUnion("kind", [
  z.object({
    ...revisionBase,
    kind: z.literal("working"),
    phase: z.enum(["awaiting_decision", "replacement_required"]),
  }).strict(),
  z.object({
    ...revisionBase,
    kind: z.literal("resolved"),
    resolvedEntries: z.array(z.object({
      countryCode,
      rank: z.number().int().positive(),
      formalMarkerDigest: nonEmptyString,
    }).strict()),
    stopCondition: z.enum(["five_effective_green", "ranking_exhausted"]),
  }).strict(),
]);
const readModelSchema = z.object({
  resolutionRunId: nonEmptyString,
  assessmentAt: instant,
  automaticFrontier: z.unknown(),
  revision: z.unknown(),
}).strict();
const eventBase = {
  resolutionRunId: nonEmptyString,
  sequence: z.number().int().positive(),
  occurredAt: instant,
};
const eventSchema = z.discriminatedUnion("type", [
  z.object({
    ...eventBase,
    type: z.literal("replacement_country_activated"),
    payload: z.object({
      country: frontierCountry,
      rank: z.number().int().positive(),
    }).strict(),
  }).strict(),
  z.object({
    ...eventBase,
    type: z.literal("replacement_country_progress"),
    payload: z.object({
      countryCode,
      stage: progressStage,
      label: nonEmptyString,
      detail: nonEmptyString.optional(),
      sourceUrl: z.url().optional(),
    }).strict(),
  }).strict(),
  z.object({
    ...eventBase,
    type: z.literal("resolution_revision_committed"),
    payload: z.object({ marker: z.unknown(), revision: z.unknown() }).strict(),
  }).strict(),
  z.object({
    ...eventBase,
    type: z.literal("resolution_continuation_completed"),
    payload: z.object({ readModel: z.unknown() }).strict(),
  }).strict(),
]);

export interface CountryResolutionEventState {
  readonly resolutionRunId: string;
  readonly expectedRevisionId: string;
  readonly lastSequence: number;
  readonly activeReplacement?: { readonly country: FrontierCountry; readonly rank: number };
  readonly committedRevisionIds: readonly string[];
  readonly progress: readonly CountryVerificationProgress[];
  readonly terminal?: CountryResolutionReadModel;
}

export interface CountryResolutionStreamResponse {
  readonly resolutionRunId: string;
  readonly expectedRevisionId: string;
  readonly stream: ReadableStream<Uint8Array>;
}

export type CountryResolutionStreamHandoff = FiniteStreamHandoff;

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

function unique(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

function sameValue(left: unknown, right: unknown): boolean {
  return canonicalPlaceFrontierValue(left) === canonicalPlaceFrontierValue(right);
}

function normalizeRevision(
  value: unknown,
  expected?: CountryResolutionReadModel["automaticFrontier"],
): CountryResolutionRevision {
  const parsed = revisionSchema.parse(value);
  const markers = parsed.replacementMarkers.map((marker) =>
    normalizeFrontierMarker(marker, parsed.profileSnapshotId));
  const sourceMarkerCount = expected?.shortlistSnapshot.markers.length ??
    ((markers[0]?.rank ?? 1) - 1);
  if (!unique(parsed.unresolvedCountryCodes) || !unique(parsed.slotCountryCodes) ||
    !unique(parsed.decisions.map(({ countryCode: code }) => code)) ||
    !unique(parsed.decisions.map(({ commandId }) => commandId)) ||
    markers.some((marker, index) => marker.rank !== sourceMarkerCount + index + 1) ||
    parsed.nextUncheckedRank !== sourceMarkerCount + markers.length + 1 ||
    parsed.resolutionRunId.length === 0) throw new Error("invalid_resolution_revision");
  if (expected !== undefined && (
    parsed.automaticShortlistSnapshotId !== expected.shortlistSnapshot.id ||
    parsed.rankingSnapshotId !== expected.rankingSnapshot.id ||
    parsed.profileSnapshotId !== expected.rankingSnapshot.profileSnapshotId ||
    parsed.preferenceProfileSnapshotId !== expected.rankingSnapshot.preferenceProfileSnapshotId ||
    markers.some((marker) => {
      const ranked = expected.rankingSnapshot.ordered[marker.rank - 1];
      return ranked?.countryCode !== marker.country.countryCode ||
        ranked.label !== marker.country.label || ranked.flag !== marker.country.flag ||
        ranked.coordinate.lat !== marker.country.coordinate.lat ||
        ranked.coordinate.lng !== marker.country.coordinate.lng;
    })
  )) throw new Error("invalid_resolution_source_binding");
  if (parsed.kind === "resolved" && (
    parsed.resolvedEntries.length > 5 ||
    !unique(parsed.resolvedEntries.map(({ countryCode: code }) => code)) ||
    !parsed.resolvedEntries.every((entry) => parsed.slotCountryCodes.includes(entry.countryCode))
  )) throw new Error("invalid_resolved_entries");
  return freezeCopy({ ...parsed, replacementMarkers: markers }) as CountryResolutionRevision;
}

export function normalizeCountryResolutionReadModel(value: unknown): CountryResolutionReadModel {
  const envelope = readModelSchema.parse(value);
  const automaticFrontier = normalizePlaceFrontierReadModel(envelope.automaticFrontier);
  const revision = normalizeRevision(envelope.revision, automaticFrontier);
  if (envelope.resolutionRunId !== revision.resolutionRunId ||
    envelope.assessmentAt !== automaticFrontier.assessmentAt) {
    throw new Error("invalid_resolution_read_model");
  }
  return freezeCopy({ ...envelope, automaticFrontier, revision });
}

function normalizeEvent(value: unknown): CountryResolutionContinuationEvent {
  const event = eventSchema.parse(value);
  if (event.type === "resolution_revision_committed") {
    return freezeCopy({
      ...event,
      payload: {
        marker: normalizeFrontierMarker(event.payload.marker),
        revision: normalizeRevision(event.payload.revision),
      },
    }) as CountryResolutionContinuationEvent;
  }
  if (event.type === "resolution_continuation_completed") {
    return freezeCopy({
      ...event,
      payload: { readModel: normalizeCountryResolutionReadModel(event.payload.readModel) },
    });
  }
  return freezeCopy(event) as CountryResolutionContinuationEvent;
}

export function initialCountryResolutionEventState(
  readModel: CountryResolutionReadModel,
): CountryResolutionEventState {
  const normalized = normalizeCountryResolutionReadModel(readModel);
  return Object.freeze({
    resolutionRunId: normalized.resolutionRunId,
    expectedRevisionId: normalized.revision.id,
    lastSequence: 0,
    committedRevisionIds: Object.freeze([]),
    progress: Object.freeze([]),
  });
}

interface ExpectedActivation {
  readonly country: FrontierCountry;
  readonly rank: number;
}

function markerProjectionForProtocol(
  marker: FrontierMarker,
  revision: CountryResolutionRevision,
): ResolutionMarkerProjection {
  const decision = revision.decisions.find(({ countryCode }) =>
    countryCode === marker.country.countryCode);
  const resolvedEntry = revision.kind === "resolved"
    ? revision.resolvedEntries.find(({ countryCode }) =>
        countryCode === marker.country.countryCode)
    : undefined;
  return {
    countryCode: marker.country.countryCode,
    rank: marker.rank,
    formalStatus: marker.formalVerdict.marker,
    formalMarkerDigest: decision?.formalMarkerDigest ?? resolvedEntry?.formalMarkerDigest ??
      `transport-unresolved:${marker.country.countryCode}:${marker.rank}`,
    ...(marker.formalVerdict.marker === "yellow"
      ? { expectedUncertaintyBasis: deriveYellowUncertaintyBasis(marker.formalVerdict) }
      : {}),
  };
}

function assertRevisionSemantics(
  revision: CountryResolutionRevision,
  automaticFrontier: CountryResolutionReadModel["automaticFrontier"],
): void {
  const projection = reconstructCountryResolution({
    orderedCountryCodes: automaticFrontier.rankingSnapshot.ordered.map(
      ({ countryCode: code }) => code,
    ),
    markers: [
      ...automaticFrontier.shortlistSnapshot.markers,
      ...revision.replacementMarkers,
    ].map((marker) => markerProjectionForProtocol(marker, revision)),
    decisions: revision.decisions,
  });
  const projectionMatches = revision.nextUncheckedRank === projection.nextUncheckedRank &&
    sameValue(revision.unresolvedCountryCodes, projection.unresolvedCountryCodes) &&
    sameValue(revision.slotCountryCodes, projection.slotCountryCodes);
  if (!projectionMatches) throw new Error("invalid_resolution_revision_semantics");
  if (revision.kind === "working") {
    if (projection.terminal !== undefined || revision.phase !== projection.phase) {
      throw new Error("invalid_resolution_revision_semantics");
    }
    return;
  }
  if (projection.terminal === undefined ||
    revision.stopCondition !== projection.terminal.stopCondition ||
    !sameValue(revision.resolvedEntries, projection.terminal.resolvedEntries)) {
    throw new Error("invalid_resolution_revision_semantics");
  }
}

function assertCommittedRevisionTransition(
  predecessorReadModel: CountryResolutionReadModel,
  marker: FrontierMarker,
  successor: CountryResolutionRevision,
): void {
  const predecessor = predecessorReadModel.revision;
  const automatic = predecessorReadModel.automaticFrontier;
  const exactSource = successor.schemaVersion === predecessor.schemaVersion &&
    successor.rulesVersion === predecessor.rulesVersion &&
    successor.resolutionRunId === predecessor.resolutionRunId &&
    successor.automaticShortlistSnapshotId === predecessor.automaticShortlistSnapshotId &&
    successor.rankingSnapshotId === predecessor.rankingSnapshotId &&
    successor.profileSnapshotId === predecessor.profileSnapshotId &&
    successor.preferenceProfileSnapshotId === predecessor.preferenceProfileSnapshotId;
  const exactHistory = sameValue(successor.decisions, predecessor.decisions) &&
    successor.replacementMarkers.length === predecessor.replacementMarkers.length + 1 &&
    predecessor.replacementMarkers.every((historicalMarker, index) =>
      sameValue(historicalMarker, successor.replacementMarkers[index])) &&
    sameValue(successor.replacementMarkers.at(-1), marker);
  if (!exactSource || !exactHistory || predecessor.kind !== "working" ||
    predecessor.phase !== "replacement_required" ||
    successor.predecessorRevisionId !== predecessor.id ||
    successor.nextUncheckedRank !== predecessor.nextUncheckedRank + 1 ||
    marker.rank !== predecessor.nextUncheckedRank) {
    throw new Error("invalid_resolution_commit");
  }
  assertRevisionSemantics(predecessor, automatic);
  assertRevisionSemantics(successor, automatic);
}

export function reduceCountryResolutionEvent(
  state: CountryResolutionEventState,
  rawEvent: CountryResolutionContinuationEvent,
  expectedActivation: ExpectedActivation | undefined,
  predecessorReadModel: CountryResolutionReadModel,
): CountryResolutionEventState {
  const event = normalizeEvent(rawEvent);
  if (state.terminal !== undefined) throw new Error("event_after_terminal");
  if (event.sequence !== state.lastSequence + 1) throw new Error("invalid_event_sequence");
  if (event.resolutionRunId !== state.resolutionRunId) throw new Error("changed_resolution_run_id");

  let activeReplacement = state.activeReplacement;
  let expectedRevisionId = state.expectedRevisionId;
  let committedRevisionIds = state.committedRevisionIds;
  let progress = state.progress;
  let terminal: CountryResolutionReadModel | undefined;

  if (event.type === "replacement_country_activated") {
    if (activeReplacement !== undefined || expectedActivation === undefined ||
      event.payload.rank !== expectedActivation.rank ||
      !sameValue(event.payload.country, expectedActivation.country)) {
      throw new Error("invalid_replacement_activation");
    }
    activeReplacement = freezeCopy(event.payload);
  } else if (event.type === "replacement_country_progress") {
    if (activeReplacement?.country.countryCode !== event.payload.countryCode) {
      throw new Error("invalid_replacement_progress");
    }
    progress = [...progress, freezeCopy({
      stage: event.payload.stage,
      label: event.payload.label,
      ...(event.payload.detail === undefined ? {} : { detail: event.payload.detail }),
      ...(event.payload.sourceUrl === undefined ? {} : { sourceUrl: event.payload.sourceUrl }),
    })];
  } else if (event.type === "resolution_revision_committed") {
    const revision = normalizeRevision(
      event.payload.revision,
      predecessorReadModel.automaticFrontier,
    );
    const marker = event.payload.marker;
    if (activeReplacement === undefined || marker.rank !== activeReplacement.rank ||
      !sameValue(marker.country, activeReplacement.country) ||
      revision.resolutionRunId !== state.resolutionRunId ||
      revision.predecessorRevisionId !== expectedRevisionId ||
      committedRevisionIds.includes(revision.id) ||
      revision.replacementMarkers.at(-1) === undefined ||
      !sameValue(revision.replacementMarkers.at(-1), marker)) {
      throw new Error("invalid_resolution_commit");
    }
    assertCommittedRevisionTransition(predecessorReadModel, marker, revision);
    activeReplacement = undefined;
    expectedRevisionId = revision.id;
    committedRevisionIds = [...committedRevisionIds, revision.id];
  } else {
    if (activeReplacement !== undefined ||
      event.payload.readModel.resolutionRunId !== state.resolutionRunId ||
      event.payload.readModel.revision.id !== expectedRevisionId) {
      throw new Error("invalid_resolution_terminal");
    }
    terminal = event.payload.readModel;
  }

  return freezeCopy({
    resolutionRunId: state.resolutionRunId,
    expectedRevisionId,
    lastSequence: event.sequence,
    ...(activeReplacement === undefined ? {} : { activeReplacement }),
    committedRevisionIds,
    progress,
    ...(terminal === undefined ? {} : { terminal }),
  });
}

export function createCountryResolutionStreamHandoff(
  stream: ReadableStream<Uint8Array>,
): CountryResolutionStreamHandoff {
  return createFiniteStreamHandoff(stream);
}

function exactHeader(response: Response, name: string): string {
  const value = response.headers.get(name);
  if (value === null || value.length === 0 || value.trim() !== value ||
    /[\u0000-\u001f\u007f]/.test(value)) throw new Error(`invalid_${name}`);
  return value;
}

export function openCountryResolutionStreamResponse(
  response: Response,
  expected?: { readonly resolutionRunId: string; readonly expectedRevisionId: string },
): CountryResolutionStreamResponse {
  try {
    if (!response.ok) throw new Error("country_resolution_request_failed");
    if (response.headers.get("content-type") !== "application/x-ndjson; charset=utf-8") {
      throw new Error("invalid_country_resolution_content_type");
    }
    const resolutionRunId = exactHeader(response, "x-life-resolution-run-id");
    const expectedRevisionId = exactHeader(response, "x-life-expected-revision-id");
    if (expected !== undefined && (resolutionRunId !== expected.resolutionRunId ||
      expectedRevisionId !== expected.expectedRevisionId)) {
      throw new Error("changed_country_resolution_identity");
    }
    if (response.body === null) throw new Error("missing_country_resolution_body");
    return Object.freeze({ resolutionRunId, expectedRevisionId, stream: response.body });
  } catch (validationError) {
    if (response.body !== null) cancelStreamWithoutMasking(response.body, validationError);
    throw validationError;
  }
}

export async function* decodeCountryResolutionStream(
  stream: ReadableStream<Uint8Array>,
  initialReadModel: CountryResolutionReadModel,
  signal?: AbortSignal,
): AsyncGenerator<CountryResolutionContinuationEvent> {
  let currentReadModel = normalizeCountryResolutionReadModel(initialReadModel);
  let state = initialCountryResolutionEventState(currentReadModel);
  let pendingTerminal: CountryResolutionContinuationEvent | undefined;
  for await (const value of readFiniteNdjson(stream, signal)) {
    const event = normalizeEvent(value);
    const ranked = currentReadModel.automaticFrontier.rankingSnapshot.ordered[
      currentReadModel.revision.nextUncheckedRank - 1
    ];
    const expectedActivation = ranked === undefined ? undefined : {
      country: {
        countryCode: ranked.countryCode,
        label: ranked.label,
        flag: ranked.flag,
        coordinate: ranked.coordinate,
      },
      rank: ranked.rank,
    };
    state = reduceCountryResolutionEvent(state, event, expectedActivation, currentReadModel);
    if (event.type === "resolution_revision_committed") {
      currentReadModel = normalizeCountryResolutionReadModel({
        ...currentReadModel,
        revision: event.payload.revision,
      });
      yield event;
    } else if (event.type === "resolution_continuation_completed") {
      if (!sameValue(event.payload.readModel, currentReadModel)) {
        throw new Error("terminal_read_model_mismatch");
      }
      pendingTerminal = event;
    } else {
      yield event;
    }
  }
  if (state.terminal === undefined || pendingTerminal === undefined) {
    throw new Error("missing_terminal_event");
  }
  yield pendingTerminal;
}
