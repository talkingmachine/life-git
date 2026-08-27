import { z } from "zod";

import type {
  CountryResolutionApplication,
  CountryResolutionContinuationPrepared,
  CountryResolutionReadModel,
} from "../../../../application/country-resolution";

type ContinueCountryResolution = Pick<CountryResolutionApplication,
  "prepareCountryResolutionContinuation" | "continueCountryResolution">;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({
  resolutionRunId: z.string().min(1),
  expectedRevisionId: z.string().min(1),
}).strict();

function problem(status: number, code: string, title: string): Response {
  return new Response(JSON.stringify({ code, status, title }), {
    status,
    headers: { "content-type": "application/problem+json; charset=utf-8" },
  });
}

function applicationError(error: unknown): Response {
  const code = error instanceof Error ? error.message : undefined;
  if (code === "resolution_not_found" || code === "snapshot_not_found") {
    return problem(404, "resolution_not_found", "Разрешение не найдено");
  }
  if (code === "stale_resolution_head") {
    return problem(409, code, "Состояние разрешения изменилось");
  }
  if (code === "invalid_resolution_target") {
    return problem(409, code, "Продолжение больше недоступно");
  }
  return problem(500, "internal_error", "Не удалось продолжить проверку");
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
  return parsed.success
    ? parsed.data
    : problem(400, "invalid_input", "Запрос не прошёл проверку");
}

function isHeaderSafeIdentifier(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.trim() === value &&
    !/[\u0000-\u001f\u007f]/.test(value);
}

function responseHeaders(
  prepared: CountryResolutionContinuationPrepared,
  expected: z.infer<typeof requestSchema>,
): Headers {
  if (!isHeaderSafeIdentifier(prepared.resolutionRunId) ||
    !isHeaderSafeIdentifier(prepared.expectedRevisionId) ||
    prepared.resolutionRunId !== expected.resolutionRunId ||
    prepared.expectedRevisionId !== expected.expectedRevisionId) {
    throw new Error("invalid_prepared_resolution");
  }
  return new Headers({
    "cache-control": "no-store, no-transform",
    "content-type": "application/x-ndjson; charset=utf-8",
    "x-content-type-options": "nosniff",
    "x-life-resolution-run-id": prepared.resolutionRunId,
    "x-life-expected-revision-id": prepared.expectedRevisionId,
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
  return signal.reason ?? new DOMException("The operation was aborted", "AbortError");
}

function continuationStream(
  request: Request,
  resolution: ContinueCountryResolution,
  prepared: CountryResolutionContinuationPrepared,
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
        let terminal: CountryResolutionReadModel | undefined;
        try {
          const returned = await resolution.continueCountryResolution(
            prepared,
            async (event) => {
              if (cancelled || linked.signal.aborted) throw abortError(linked.signal);
              if (event.resolutionRunId !== prepared.resolutionRunId) {
                throw new Error("changed_resolution_run_id");
              }
              if (terminal !== undefined) throw new Error("event_after_terminal");
              if (event.type === "resolution_continuation_completed") {
                terminal = event.payload.readModel;
              }
              controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
            },
            linked.signal,
          );
          if (cancelled) return;
          if (linked.signal.aborted) throw abortError(linked.signal);
          if (terminal === undefined) throw new Error("missing_terminal_event");
          if (canonicalValue(returned) !== canonicalValue(terminal)) {
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
      request.signal.removeEventListener("abort", requestAborted);
      abort(linked, reason);
    },
  });
}

async function application(): Promise<ContinueCountryResolution> {
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

  let resolution: ContinueCountryResolution;
  let prepared: CountryResolutionContinuationPrepared;
  let headers: Headers;
  try {
    resolution = await application();
    prepared = await resolution.prepareCountryResolutionContinuation(input);
    headers = responseHeaders(prepared, input);
  } catch (error) {
    return applicationError(error);
  }
  return new Response(continuationStream(request, resolution, prepared), { headers });
}
