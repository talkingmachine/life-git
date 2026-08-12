import { z } from "zod";

import type {
  PlaceFrontierApplication,
  PlaceFrontierPrepared,
} from "../../../application/place-frontier";
import {
  canonicalPlaceFrontierValue,
  initialPlaceFrontierEventState,
  reducePlaceFrontierEvent,
} from "../../../experience/place-frontier-stream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.union([
  z.object({ profile: z.unknown(), preferences: z.unknown() }).strict(),
  z.object({
    profileId: z.string().min(1),
    preferenceProfileId: z.string().min(1),
  }).strict(),
]);

type PrepareInput = Parameters<PlaceFrontierApplication["preparePlaceFrontier"]>[0];
const EXPECTED_PREPARE_ERRORS = new Set([
  "invalid_monthly_income",
  "profile_not_found",
]);

function problem(status: number, code: string, title: string): Response {
  return new Response(JSON.stringify({ code, status, title }), {
    status,
    headers: { "content-type": "application/problem+json; charset=utf-8" },
  });
}

function hasJsonContentType(request: Request): boolean {
  return request.headers.get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase() === "application/json";
}

function isExpectedPrepareError(error: unknown): boolean {
  return error instanceof z.ZodError ||
    error instanceof Error && EXPECTED_PREPARE_ERRORS.has(error.message);
}

function abort(controller: AbortController, reason: unknown): void {
  if (controller.signal.aborted) return;
  if (reason === undefined) controller.abort();
  else controller.abort(reason);
}

function abortError(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("The operation was aborted", "AbortError");
}

function isHeaderSafeIdentifier(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.trim() === value &&
    !/[\u0000-\u001f\u007f]/.test(value);
}

function responseHeaders(prepared: PlaceFrontierPrepared): Headers {
  if (
    !isHeaderSafeIdentifier(prepared.runId) ||
    !isHeaderSafeIdentifier(prepared.profileId) ||
    !isHeaderSafeIdentifier(prepared.preferenceProfileId) ||
    prepared.rankingSnapshotId !== `${prepared.runId}:ranking`
  ) throw new Error("invalid_prepared_frontier");
  return new Headers({
    "cache-control": "no-store, no-transform",
    "content-type": "application/x-ndjson; charset=utf-8",
    "x-content-type-options": "nosniff",
    "x-life-run-id": prepared.runId,
    "x-life-profile-id": prepared.profileId,
    "x-life-preference-profile-id": prepared.preferenceProfileId,
  });
}

async function parseInput(request: Request): Promise<PrepareInput | Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return problem(400, "invalid_json", "Некорректный JSON");
  }
  const parsed = requestSchema.safeParse(body);
  return parsed.success
    ? parsed.data as PrepareInput
    : problem(400, "invalid_input", "Запрос не прошёл проверку");
}

async function application(): Promise<PlaceFrontierApplication> {
  const { getConfirmedLifeApplication } = await import(
    "../../../infrastructure/composition-root"
  );
  return getConfirmedLifeApplication();
}

function placeFrontierStream(
  request: Request,
  frontier: PlaceFrontierApplication,
  prepared: PlaceFrontierPrepared,
): ReadableStream<Uint8Array> {
  const linked = new AbortController();
  const encoder = new TextEncoder();
  let cancelled = false;
  const requestAborted = () => abort(linked, request.signal.reason);
  if (request.signal.aborted) requestAborted();
  else request.signal.addEventListener("abort", requestAborted, { once: true });

  return new ReadableStream<Uint8Array>({
    start(controller): void {
      const pump = async (): Promise<void> => {
        let state = initialPlaceFrontierEventState();
        try {
          const returned = await frontier.runPlaceFrontier(prepared, async (rawEvent) => {
            if (cancelled || linked.signal.aborted) throw abortError(linked.signal);
            state = reducePlaceFrontierEvent(state, rawEvent);
            if (state.runId !== prepared.runId) throw new Error("changed_run_id");
            const event = state.events.at(-1)!;
            if (cancelled || linked.signal.aborted) throw abortError(linked.signal);
            controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
          }, linked.signal);
          if (cancelled) return;
          if (linked.signal.aborted) throw abortError(linked.signal);
          if (state.terminal === undefined) throw new Error("missing_terminal_event");
          if (canonicalPlaceFrontierValue(returned) !==
            canonicalPlaceFrontierValue(state.terminal)) {
            throw new Error("terminal_return_mismatch");
          }
          controller.close();
        } catch (error) {
          if (!cancelled) controller.error(error);
        } finally {
          request.signal.removeEventListener("abort", requestAborted);
        }
      };
      void pump();
    },
    cancel(reason): void {
      cancelled = true;
      abort(linked, reason);
    },
  });
}

export async function POST(request: Request): Promise<Response> {
  if (!hasJsonContentType(request)) {
    return problem(415, "unsupported_media_type", "Неподдерживаемый формат запроса");
  }
  const input = await parseInput(request);
  if (input instanceof Response) return input;

  let frontier: PlaceFrontierApplication;
  let prepared: PlaceFrontierPrepared;
  let headers: Headers;
  try {
    frontier = await application();
    prepared = await frontier.preparePlaceFrontier(input);
    headers = responseHeaders(prepared);
  } catch (error) {
    return isExpectedPrepareError(error)
      ? problem(400, "invalid_input", "Запрос не прошёл проверку")
      : problem(500, "internal_error", "Не удалось запустить проверку");
  }

  return new Response(placeFrontierStream(request, frontier, prepared), {
    headers,
  });
}
