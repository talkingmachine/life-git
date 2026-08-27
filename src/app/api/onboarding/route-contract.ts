export const MAX_ONBOARDING_REQUEST_BODY_BYTES = 131_072;

export type OnboardingRequestErrorCode =
  | "unsupported_media_type"
  | "invalid_json"
  | "request_body_too_large";

const ERROR_STATUS = Object.freeze({
  unsupported_media_type: 415,
  invalid_json: 400,
  request_body_too_large: 413,
} as const satisfies Record<OnboardingRequestErrorCode, number>);

const JSON_HEADERS = Object.freeze({
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store, no-transform",
  "x-content-type-options": "nosniff",
});

const PROBLEM_HEADERS = Object.freeze({
  ...JSON_HEADERS,
  "content-type": "application/problem+json; charset=utf-8",
});

export class OnboardingRequestError extends Error {
  readonly name = "OnboardingRequestError";
  readonly status: number;

  constructor(readonly code: OnboardingRequestErrorCode) {
    super(code);
    this.status = ERROR_STATUS[code];
  }
}

export async function readBoundedOnboardingJson(
  request: Request,
  signal: AbortSignal,
): Promise<unknown> {
  throwIfAborted(signal);
  if (!hasJsonContentType(request)) {
    throw new OnboardingRequestError("unsupported_media_type");
  }
  if (request.body === null) throw new OnboardingRequestError("invalid_json");

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  let aborted = false;
  const cancelForAbort = (): void => {
    aborted = true;
    void reader.cancel(abortReason(signal)).catch(() => undefined);
  };
  if (signal.aborted) cancelForAbort();
  else signal.addEventListener("abort", cancelForAbort, { once: true });

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (aborted || signal.aborted) throw abortReason(signal);
      if (done) break;
      if (!(value instanceof Uint8Array)) {
        throw new OnboardingRequestError("invalid_json");
      }
      totalBytes += value.byteLength;
      if (totalBytes > MAX_ONBOARDING_REQUEST_BODY_BYTES) {
        const error = new OnboardingRequestError("request_body_too_large");
        void reader.cancel(error).catch(() => undefined);
        throw error;
      }
      chunks.push(value.slice());
    }
  } catch (error) {
    if (aborted || signal.aborted) throw abortReason(signal);
    if (error instanceof OnboardingRequestError) throw error;
    throw new OnboardingRequestError("invalid_json");
  } finally {
    signal.removeEventListener("abort", cancelForAbort);
    try {
      reader.releaseLock();
    } catch {
      // Releasing an invalidated reader cannot replace the primary result.
    }
  }

  throwIfAborted(signal);
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return JSON.parse(text) as unknown;
  } catch {
    throw new OnboardingRequestError("invalid_json");
  }
}

export function onboardingJsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), { headers: JSON_HEADERS });
}

export function onboardingProblemResponse(
  status: number,
  code: string,
  title: string,
): Response {
  return new Response(JSON.stringify({ code, status, title }), {
    status,
    headers: PROBLEM_HEADERS,
  });
}

export function onboardingRequestErrorResponse(error: unknown): Response {
  if (!(error instanceof OnboardingRequestError)) {
    return onboardingProblemResponse(500, "internal_error", "Не удалось прочитать запрос");
  }
  switch (error.code) {
    case "unsupported_media_type":
      return onboardingProblemResponse(
        error.status,
        error.code,
        "Неподдерживаемый формат запроса",
      );
    case "invalid_json":
      return onboardingProblemResponse(error.status, error.code, "Некорректный JSON");
    case "request_body_too_large":
      return onboardingProblemResponse(error.status, error.code, "Слишком большой запрос");
  }
}

export function onboardingAbortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("The operation was aborted", "AbortError");
}

function hasJsonContentType(request: Request): boolean {
  return request.headers.get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase() === "application/json";
}

function abortReason(signal: AbortSignal): unknown {
  return onboardingAbortReason(signal);
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortReason(signal);
}
