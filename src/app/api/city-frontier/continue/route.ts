import { types } from "node:util";

import { z } from "zod";

import type {
  CityFrontierApplication,
  CityFrontierPrepared,
} from "../../../../application/city-frontier";
import type {
  CityFrontierEvent,
  CityFrontierReadModel,
  PublicFactSourceV1,
} from "../../../../application/city-frontier-contracts";

type ContinueCityFrontier = Pick<CityFrontierApplication,
  "prepareCityFrontierContinuation" | "continueCityFrontierWithSourceRecovery">;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({
  runId: z.string().min(1),
  expectedRevisionId: z.string().min(1),
  commandId: z.string().min(1),
}).strict();

function problem(status: number, code: string, title: string): Response {
  return new Response(JSON.stringify({ code, status, title }), {
    status,
    headers: { "content-type": "application/problem+json; charset=utf-8" },
  });
}

function applicationError(error: unknown): Response {
  const code = error instanceof Error ? error.message : undefined;
  if (code === "city_frontier_not_found") {
    return problem(404, code, "Проверка городов не найдена");
  }
  if (code === "stale_city_frontier_head") {
    return problem(409, code, "Состояние проверки городов изменилось");
  }
  return problem(500, "internal_error", "Не удалось продолжить проверку городов");
}

function hasJsonContentType(request: Request): boolean {
  return request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() ===
    "application/json";
}

async function parseRequest(request: Request): Promise<z.infer<typeof requestSchema> | Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return problem(400, "invalid_json", "Некорректный JSON");
  }
  const parsed = requestSchema.safeParse(body);
  return parsed.success ? parsed.data : problem(400, "invalid_input", "Запрос не прошёл проверку");
}

function isHeaderSafeIdentifier(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.trim() === value &&
    !/[\u0000-\u001f\u007f]/.test(value);
}

function responseHeaders(prepared: CityFrontierPrepared): Headers {
  return new Headers({
    "cache-control": "no-store, no-transform",
    "content-type": "application/x-ndjson; charset=utf-8",
    "x-content-type-options": "nosniff",
    "x-life-run-id": prepared.runId,
    "x-life-base-revision-id": prepared.baseRevisionId,
  });
}

function canonicalValue(value: unknown): string {
  const normalize = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(normalize);
    if (item !== null && typeof item === "object") {
      return Object.fromEntries(Object.entries(item)
        .filter(([, child]) => child !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, normalize(child)]));
    }
    return item;
  };
  return JSON.stringify(normalize(value));
}

function abort(controller: AbortController, reason: unknown): void {
  if (controller.signal.aborted) return;
  if (reason === undefined) controller.abort();
  else controller.abort(reason);
}

function abortError(signal: AbortSignal): unknown {
  return signal.aborted
    ? signal.reason
    : new DOMException("The operation was aborted", "AbortError");
}

type PlainRecord = Record<string, unknown>;

const PREPARED_KEYS = [
  "schemaVersion", "runId", "baseRevisionId", "rankingSnapshotId", "nextUncheckedRank", "commandId",
] as const;

const EVENT_BASE_KEYS = ["type", "runId", "baseRevisionId", "sequence", "occurredAt"] as const;
const PROGRESS_WITHOUT_URL = new Set([
  "source_started:si-city-safety",
  "source_started:si-city-long-term-rent",
  "source_started:si-city-urban-transit",
  "source_started:si-city-fixed-broadband",
  "evidence_verified",
  "knowledge_published",
]);
const PROGRESS_WITH_REQUIRED_URL = new Set([
  "source_completed:si-city-long-term-rent",
  "source_completed:si-city-urban-transit",
  "source_completed:si-city-fixed-broadband",
]);

function ownExactRecord(value: unknown, keys: readonly string[]): PlainRecord | undefined {
  if (value === null || typeof value !== "object" || types.isProxy(value) || Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype || Object.getOwnPropertySymbols(value).length !== 0) {
    return undefined;
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const actual = Object.getOwnPropertyNames(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    return undefined;
  }
  const copy: PlainRecord = {};
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) return undefined;
    copy[key] = descriptor.value;
  }
  return copy;
}

function nonEmptyText(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function safeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value);
}

function capturePrepared(
  value: unknown,
  expected: z.infer<typeof requestSchema>,
): CityFrontierPrepared {
  if (value === null || typeof value !== "object" || types.isProxy(value)) {
    throw new Error("invalid_prepared_city_frontier");
  }
  const borrowed = ownExactRecord(value, PREPARED_KEYS);
  const nextUncheckedRank = borrowed?.nextUncheckedRank;
  if (borrowed === undefined || borrowed.schemaVersion !== "city-frontier-prepared@1" ||
    !isHeaderSafeIdentifier(borrowed.runId) ||
    !isHeaderSafeIdentifier(borrowed.baseRevisionId) ||
    !nonEmptyText(borrowed.rankingSnapshotId) || !safeInteger(nextUncheckedRank) ||
    !nonEmptyText(borrowed.commandId) || borrowed.runId !== expected.runId ||
    borrowed.baseRevisionId !== expected.expectedRevisionId || borrowed.commandId !== expected.commandId) {
    throw new Error("invalid_prepared_city_frontier");
  }
  return Object.freeze({
    schemaVersion: "city-frontier-prepared@1",
    runId: borrowed.runId,
    baseRevisionId: borrowed.baseRevisionId,
    rankingSnapshotId: borrowed.rankingSnapshotId,
    nextUncheckedRank,
    commandId: borrowed.commandId,
  });
}

function eventBase(
  value: PlainRecord,
  prepared: CityFrontierPrepared,
): value is PlainRecord & { readonly runId: string; readonly baseRevisionId: string } {
  return nonEmptyText(value.runId) && nonEmptyText(value.baseRevisionId) &&
    typeof value.sequence === "number" && Number.isSafeInteger(value.sequence) &&
    nonEmptyText(value.occurredAt) && value.runId === prepared.runId &&
    value.baseRevisionId === prepared.baseRevisionId;
}

function ownPublicFactSource(value: unknown): PublicFactSourceV1 | undefined {
  const source = ownExactRecord(value, [
    "schemaVersion", "factKey", "status", "publisherName", "sourceUrl", "checkedAt",
  ]);
  if (source === undefined || source.schemaVersion !== "public-fact-source@1" ||
    source.factKey !== "si-city-safety" ||
    (source.status !== "green" && source.status !== "red" && source.status !== "yellow")) return undefined;
  if (source.status === "yellow") {
    return source.publisherName === null && source.sourceUrl === null && source.checkedAt === null
      ? source as PublicFactSourceV1 : undefined;
  }
  if (!nonEmptyText(source.publisherName) || !nonEmptyText(source.sourceUrl) ||
    !nonEmptyText(source.checkedAt)) return undefined;
  try {
    const url = new URL(source.sourceUrl);
    if (url.protocol !== "https:" || url.toString() !== source.sourceUrl ||
      new Date(source.checkedAt).toISOString() !== source.checkedAt) return undefined;
  } catch { return undefined; }
  return source as PublicFactSourceV1;
}

function ownContinuationEvent(
  value: unknown,
  prepared: CityFrontierPrepared,
): CityFrontierEvent | undefined {
  if (value === null || typeof value !== "object" || types.isProxy(value) || Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype || Object.getOwnPropertySymbols(value).length !== 0) return undefined;
  const typeDescriptor = Object.getOwnPropertyDescriptor(value, "type");
  if (typeDescriptor === undefined || !("value" in typeDescriptor) || !typeDescriptor.enumerable) return undefined;
  const type = typeDescriptor.value;
  if (type === "city_activated") {
    const event = ownExactRecord(value, [...EVENT_BASE_KEYS, "cityId", "rank"]);
    if (event === undefined || !eventBase(event, prepared) || !nonEmptyText(event.cityId) ||
      typeof event.rank !== "number" || !Number.isSafeInteger(event.rank)) return undefined;
    return event as CityFrontierEvent;
  }
  if (type === "city_progress") {
    const baseKeys = [...EVENT_BASE_KEYS, "cityId", "stage"];
    const hasSourceUrl = Object.prototype.hasOwnProperty.call(value, "sourceUrl");
    const event = ownExactRecord(value, hasSourceUrl ? [...baseKeys, "sourceUrl"] : baseKeys);
    if (event === undefined || !eventBase(event, prepared) || !nonEmptyText(event.cityId) ||
      !nonEmptyText(event.stage)) return undefined;
    if (PROGRESS_WITHOUT_URL.has(event.stage)) {
      return hasSourceUrl ? undefined : event as CityFrontierEvent;
    }
    if (PROGRESS_WITH_REQUIRED_URL.has(event.stage)) {
      return nonEmptyText(event.sourceUrl) ? event as CityFrontierEvent : undefined;
    }
    if (event.stage === "source_completed:si-city-safety") {
      return !hasSourceUrl || nonEmptyText(event.sourceUrl) ? event as CityFrontierEvent : undefined;
    }
    return undefined;
  }
  if (type === "source_recovery_started") {
    const event = ownExactRecord(value, [...EVENT_BASE_KEYS, "cityId"]);
    return event !== undefined && eventBase(event, prepared) && nonEmptyText(event.cityId)
      ? event as CityFrontierEvent : undefined;
  }
  if (type === "source_recovery_yellow") {
    const event = ownExactRecord(value, [...EVENT_BASE_KEYS, "cityId", "reason", "source"]);
    const source = event === undefined ? undefined : ownPublicFactSource(event.source);
    if (event === undefined || !eventBase(event, prepared) || !nonEmptyText(event.cityId) ||
      event.reason !== "official_source_unavailable" || source === undefined || source.status !== "yellow") return undefined;
    return { ...event, source } as CityFrontierEvent;
  }
  if (type === "official_source_replaced") {
    const event = ownExactRecord(value, [...EVENT_BASE_KEYS, "cityId", "source"]);
    const source = event === undefined ? undefined : ownPublicFactSource(event.source);
    if (event === undefined || !eventBase(event, prepared) || !nonEmptyText(event.cityId) ||
      source === undefined || source.status === "yellow") return undefined;
    return { ...event, source } as CityFrontierEvent;
  }
  if (type === "city_revision_committed") {
    const event = ownExactRecord(value, [...EVENT_BASE_KEYS, "marker", "revision"]);
    const marker = event === undefined ? undefined : ownPlainRecord(event.marker);
    const revision = event === undefined ? undefined : ownPlainRecord(event.revision);
    if (event === undefined || !eventBase(event, prepared) || marker === undefined || revision === undefined) {
      return undefined;
    }
    return { ...event, marker, revision } as unknown as CityFrontierEvent;
  }
  if (type === "city_continuation_completed") {
    const event = ownExactRecord(value, [...EVENT_BASE_KEYS, "readModel"]);
    const readModel = event === undefined ? undefined : ownPlainRecord(event.readModel);
    if (event === undefined || !eventBase(event, prepared) || readModel === undefined) return undefined;
    return { ...event, readModel } as unknown as CityFrontierEvent;
  }
  return undefined;
}

function ownPlainRecord(value: unknown): PlainRecord | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype || Object.getOwnPropertySymbols(value).length !== 0) {
    return undefined;
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const copy: PlainRecord = {};
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!("value" in descriptor) || !descriptor.enumerable) return undefined;
    copy[key] = descriptor.value;
  }
  return copy;
}

function continuationStream(
  request: Request,
  frontier: ContinueCityFrontier,
  prepared: CityFrontierPrepared,
): ReadableStream<Uint8Array> {
  const linked = new AbortController();
  const encoder = new TextEncoder();
  let cancelled = false;
  let listening = false;
  let cleaned = false;
  const requestAborted = () => abort(linked, request.signal.reason);
  const cleanup = (): void => {
    if (cleaned) return;
    cleaned = true;
    if (listening) request.signal.removeEventListener("abort", requestAborted);
  };

  if (request.signal.aborted) requestAborted();
  else {
    listening = true;
    request.signal.addEventListener("abort", requestAborted, { once: true });
  }

  return new ReadableStream<Uint8Array>({
    start(controller): void {
      const pump = async (): Promise<void> => {
        let committed = false;
        let completion: CityFrontierReadModel | undefined;
        let yellow: PublicFactSourceV1 | undefined;
        let recoveryStarted = false;
        let replaced = false;
        let emitterFailed = false;
        try {
          const emit = async (event: CityFrontierEvent) => {
              if (emitterFailed) throw new Error("invalid_city_frontier_stream");
              if (cancelled || linked.signal.aborted) throw abortError(linked.signal);
              try {
                const owned = ownContinuationEvent(event, prepared);
                if (owned === undefined || completion !== undefined || yellow !== undefined) {
                  throw new Error("invalid_city_frontier_stream");
                }
                if (owned.type === "city_continuation_completed" && !committed) {
                  throw new Error("completion_before_commit");
                }
                if (owned.type === "source_recovery_started") {
                  if (recoveryStarted || replaced || committed) throw new Error("invalid_recovery_order");
                  recoveryStarted = true;
                }
                if (owned.type === "official_source_replaced") {
                  if (!recoveryStarted || replaced || committed) throw new Error("invalid_recovery_order");
                  replaced = true;
                }
                if (owned.type === "source_recovery_yellow" &&
                  (!recoveryStarted || replaced || committed)) throw new Error("invalid_recovery_order");
                const frame = encoder.encode(`${JSON.stringify(owned)}\n`);
                if (cancelled || linked.signal.aborted) throw abortError(linked.signal);
                controller.enqueue(frame);
                if (owned.type === "city_continuation_completed") {
                  completion = owned.readModel;
                }
                if (owned.type === "source_recovery_yellow") yellow = owned.source;
                if (owned.type === "city_revision_committed") committed = true;
              } catch (error) {
                if (cancelled || linked.signal.aborted) throw abortError(linked.signal);
                emitterFailed = true;
                throw error;
              }
          };
          const returned = await frontier.continueCityFrontierWithSourceRecovery(prepared, emit, linked.signal);
          if (cancelled) return;
          if (linked.signal.aborted) throw abortError(linked.signal);
          if (emitterFailed) throw new Error("invalid_city_frontier_stream");
          const advanced = returned.kind === "advanced" && completion !== undefined && yellow === undefined &&
            canonicalValue(returned.readModel) === canonicalValue(completion);
          const yellowReturned = returned.kind === "yellow" && completion === undefined && yellow !== undefined &&
            !committed && !replaced &&
            canonicalValue(returned.source) === canonicalValue(yellow);
          if (!advanced && !yellowReturned) {
            throw new Error("invalid_city_frontier_stream");
          }
          controller.close();
        } catch {
          if (!cancelled) {
            controller.error(linked.signal.aborted ? abortError(linked.signal) : new Error("internal_error"));
          }
        } finally {
          cleanup();
        }
      };
      void pump();
    },
    cancel(reason): void {
      cancelled = true;
      cleanup();
      abort(linked, reason);
    },
  });
}

async function application(): Promise<ContinueCityFrontier> {
  const { getConfirmedLifeApplication } = await import(
    "../../../../infrastructure/composition-root"
  );
  return getConfirmedLifeApplication();
}

export async function POST(request: Request): Promise<Response> {
  if (!hasJsonContentType(request)) {
    return problem(415, "unsupported_media_type", "Неподдерживаемый формат запроса");
  }
  const input = await parseRequest(request);
  if (input instanceof Response) return input;

  let frontier: ContinueCityFrontier;
  let prepared: CityFrontierPrepared;
  let headers: Headers;
  try {
    frontier = await application();
    prepared = capturePrepared(await frontier.prepareCityFrontierContinuation(input), input);
    headers = responseHeaders(prepared);
  } catch (error) {
    return applicationError(error);
  }
  return new Response(continuationStream(request, frontier, prepared), { headers });
}
