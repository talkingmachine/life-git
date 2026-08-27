import { z } from "zod";

import type {
  ColdStartEvent,
  ColdStartReadModel,
} from "../application/cold-start";

export const COLD_START_MAX_LINE_BYTES = 256 * 1024;

export interface ColdStartStreamResponse {
  readonly profileId: string;
  readonly runId: string;
  readonly stream: ReadableStream<Uint8Array>;
}

export function openColdStartStreamResponse(
  response: Response,
  expectedProfileId?: string,
): ColdStartStreamResponse {
  const contentType = response.headers.get("content-type")?.toLowerCase();
  const runId = response.headers.get("x-life-run-id");
  const profileId = response.headers.get("x-life-profile-id");
  if (
    !response.ok
    || contentType !== "application/x-ndjson; charset=utf-8"
    || runId === null
    || runId.length === 0
    || profileId === null
    || profileId.length === 0
    || response.body === null
    || expectedProfileId !== undefined && profileId !== expectedProfileId
  ) throw new Error("invalid_cold_start_response");
  return { profileId, runId, stream: response.body };
}

const claimKindSchema = z.enum([
  "route_basis",
  "citizenship_applicability",
  "remote_work_relations",
  "income",
  "qualification",
  "companion_entry",
  "companion_local_work_access",
  "duration",
  "general_statutory_prerequisites",
]);

const sourceIdSchema = z.enum([
  "si-digital-nomad-route",
  "si-income-threshold",
  "si-companion-employment",
  "cbr-eur",
]);

const countrySchema = z.object({
  code: z.literal("SI"),
  englishName: z.literal("Slovenia"),
  displayName: z.literal("Словения"),
  flag: z.literal("🇸🇮"),
  coordinate: z.object({
    lat: z.literal(46.1512),
    lng: z.literal(14.9955),
  }).strict(),
}).strict();

const reasonSchema = z.object({
  code: z.string().min(1),
  summary: z.string().min(1),
  claimIds: z.array(z.string().min(1)),
  officialUrls: z.array(z.string().url()),
}).strict();

const formulaSchema = z.object({
  formulaId: z.literal("FORMULA-VS2-INCOME-01"),
  formulaVersion: z.literal("1"),
  expression: z.literal("monthlyIncomeRub / eurRub < thresholdEur"),
  monthlyIncomeRub: z.string().min(1),
  eurRub: z.string().min(1),
  incomeEur: z.string().min(1),
  thresholdEur: z.string().min(1),
  rounding: z.literal("UNROUNDED_THEN_HALF_UP_2DP"),
  sourceClaimIds: z.array(z.string().min(1)),
}).strict();

const comparatorSchema = z.object({
  marker: z.enum(["red", "yellow"]),
  personalFit: z.enum([
    "verified_veto",
    "research_incomplete",
    "personal_evidence_missing",
    "route_compatible_city_unverified",
  ]),
  cityScope: z.literal("not_checked"),
  reasons: z.array(reasonSchema),
  formula: formulaSchema.optional(),
}).strict();

const readModelSchema = z.object({
  runId: z.string().min(1),
  country: countrySchema,
  checkedAt: z.iso.date(),
  evidenceSnapshotId: z.string().min(1),
  assessmentRulesVersion: z.literal("cold-start-assessment@1"),
  dossier: z.object({
    id: z.string().min(1),
    label: z.string().min(1),
    publishedAt: z.iso.datetime(),
  }).strict().optional(),
  coverage: z.object({
    verified: z.number().int().min(0).max(9),
    required: z.literal(9),
    claimKinds: z.array(claimKindSchema),
  }).strict(),
  comparator: comparatorSchema,
  sourceNavigation: z.array(z.object({
    label: z.string().min(1),
    url: z.string().url(),
  }).strict()),
}).strict();

const eventBase = {
  runId: z.string().min(1),
  sequence: z.number().int().positive(),
  occurredAt: z.iso.datetime(),
  country: countrySchema,
};

const coldStartEventWireSchema = z.discriminatedUnion("type", [
  z.object({
    ...eventBase,
    type: z.literal("source_discovered"),
    payload: z.object({
      candidateId: z.string().min(1),
      url: z.string().url(),
      claimKinds: z.array(claimKindSchema),
    }).strict(),
  }).strict(),
  z.object({
    ...eventBase,
    type: z.literal("authority_verified"),
    payload: z.object({
      candidateId: z.string().min(1),
      authorityRoot: z.string().url(),
    }).strict(),
  }).strict(),
  z.object({
    ...eventBase,
    type: z.literal("artifact_captured"),
    payload: z.object({
      sourceId: sourceIdSchema,
      role: z.string().min(1),
      resolvedUrl: z.string().url(),
      sha256: z.string().regex(/^[a-f0-9]{64}$/),
    }).strict(),
  }).strict(),
  z.object({
    ...eventBase,
    type: z.literal("claim_verified"),
    payload: z.object({
      claimId: z.string().min(1),
      claimKind: z.union([claimKindSchema, z.literal("fx_rate")]),
      sourceIds: z.array(sourceIdSchema),
    }).strict(),
  }).strict(),
  z.object({
    ...eventBase,
    type: z.literal("dossier_published"),
    payload: z.object({
      dossierVersionId: z.string().min(1),
      label: z.string().min(1),
      created: z.boolean(),
    }).strict(),
  }).strict(),
  z.object({
    ...eventBase,
    type: z.literal("assessment_completed"),
    payload: z.object({ readModel: readModelSchema }).strict(),
  }).strict(),
]);

export const coldStartEventSchema = coldStartEventWireSchema.superRefine((event, context) => {
  if (event.type !== "assessment_completed") return;
  if (event.payload.readModel.runId !== event.runId) {
    context.addIssue({
      code: "custom",
      message: "terminal_run_mismatch",
      path: ["payload", "readModel", "runId"],
    });
  }
  if (event.payload.readModel.evidenceSnapshotId !== `${event.runId}:evidence`) {
    context.addIssue({
      code: "custom",
      message: "terminal_evidence_mismatch",
      path: ["payload", "readModel", "evidenceSnapshotId"],
    });
  }
});

export interface ColdStartEventState {
  readonly events: readonly ColdStartEvent[];
  readonly lastSequence: number;
  readonly runId?: string;
  readonly terminal?: ColdStartReadModel;
}

export function initialColdStartEventState(): ColdStartEventState {
  return Object.freeze({ events: Object.freeze([]), lastSequence: 0 });
}

export function reduceColdStartEvent(
  state: ColdStartEventState,
  event: ColdStartEvent,
): ColdStartEventState {
  if (state.terminal !== undefined) throw new Error("event_after_terminal");
  if (event.sequence !== state.lastSequence + 1) throw new Error("invalid_event_sequence");
  if (state.runId !== undefined && event.runId !== state.runId) throw new Error("changed_run_id");
  if (event.type === "assessment_completed") {
    if (event.payload.readModel.runId !== event.runId) throw new Error("terminal_run_mismatch");
    if (event.payload.readModel.evidenceSnapshotId !== `${event.runId}:evidence`) {
      throw new Error("terminal_evidence_mismatch");
    }
  }
  return Object.freeze({
    events: Object.freeze([...state.events, event]),
    lastSequence: event.sequence,
    runId: state.runId ?? event.runId,
    ...(event.type === "assessment_completed"
      ? { terminal: event.payload.readModel }
      : {}),
  });
}

export async function* decodeColdStartStream(
  stream: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<ColdStartEvent> {
  const reader = stream.getReader();
  let decoder = new TextDecoder("utf-8", { fatal: true });
  let line = "";
  let lineBytes = 0;
  let state = initialColdStartEventState();
  let pendingTerminal: ColdStartEvent | undefined;
  let reachedEof = false;
  let abortRequested = false;
  const cancellationReason = () => signal?.reason
    ?? new DOMException("The operation was aborted", "AbortError");
  const cancelForAbort = () => {
    abortRequested = true;
    void reader.cancel(cancellationReason()).catch(() => undefined);
  };
  if (signal?.aborted === true) cancelForAbort();
  else signal?.addEventListener("abort", cancelForAbort, { once: true });

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (abortRequested) throw cancellationReason();
      if (done) {
        reachedEof = true;
        break;
      }
      let segmentStart = 0;
      for (let index = 0; index < value.length; index += 1) {
        if (value[index] !== 0x0a) continue;
        const segment = value.subarray(segmentStart, index);
        lineBytes += segment.byteLength;
        if (lineBytes > COLD_START_MAX_LINE_BYTES) throw new Error("line_too_large");
        line += decoder.decode(segment, { stream: true });
        line += decoder.decode();
        const event = coldStartEventSchema.parse(JSON.parse(line)) as ColdStartEvent;
        state = reduceColdStartEvent(state, event);
        if (event.type === "assessment_completed") pendingTerminal = event;
        else yield event;
        decoder = new TextDecoder("utf-8", { fatal: true });
        line = "";
        lineBytes = 0;
        segmentStart = index + 1;
      }
      const remainder = value.subarray(segmentStart);
      lineBytes += remainder.byteLength;
      if (lineBytes > COLD_START_MAX_LINE_BYTES) throw new Error("line_too_large");
      line += decoder.decode(remainder, { stream: true });
    }

    line += decoder.decode();
    if (lineBytes > 0 || line.length > 0) throw new Error("trailing_partial_line");
    if (state.terminal === undefined || pendingTerminal === undefined) {
      throw new Error("missing_terminal_event");
    }
    yield pendingTerminal;
  } finally {
    signal?.removeEventListener("abort", cancelForAbort);
    if (!reachedEof && !abortRequested) {
      try {
        await reader.cancel("cold_start_decoder_stopped");
      } catch {
        // Preserve the original stream or consumer error.
      }
    }
    try {
      reader.releaseLock();
    } catch {
      // Releasing an already invalidated reader must not mask the original error.
    }
  }
}
