import { createHash } from "node:crypto";

import type {
  CaptureFailureKind,
  HttpStepRequest,
  LiveCapturedArtifact,
} from "../../research/contracts";

export const MAX_CAPTURE_BYTES = 30 * 1024 * 1024;

export interface HttpCaptureLimits {
  readonly maxBytes: number;
  readonly maxRedirects: number;
}

export interface TracedLiveCapture<S extends string> {
  readonly artifact: LiveCapturedArtifact<S>;
  readonly redirectChain: readonly string[];
}

export interface HttpCaptureFailureTrace {
  readonly redirectChain: readonly string[];
  readonly rejectedRedirectUrl?: string;
  readonly responseStatus?: number;
  readonly responseUrl?: string;
  readonly mediaType?: string;
}

export class SourceCaptureError extends Error {
  readonly kind: CaptureFailureKind;
  readonly retryable: boolean;
  readonly trace?: HttpCaptureFailureTrace;

  constructor(
    kind: CaptureFailureKind,
    message: string,
    options?: ErrorOptions,
    trace?: HttpCaptureFailureTrace,
  ) {
    super(message, options);
    this.name = "SourceCaptureError";
    this.kind = kind;
    this.retryable = kind === "timeout" || kind === "rate_limited" || kind === "server_error";
    this.trace = trace === undefined
      ? undefined
      : Object.freeze({ ...trace, redirectChain: Object.freeze([...trace.redirectChain]) });
  }
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function normalizedMediaType(value: string | null): string {
  return value?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

function classifyStatus(status: number): CaptureFailureKind {
  if (status === 429) return "rate_limited";
  if (status >= 500) return "server_error";
  return "http_error";
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 5;

function officialHttpsUrl(value: string, allowedHosts: readonly string[]): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new SourceCaptureError("navigation_mismatch", "Response URL is not valid");
  }
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.port !== "" ||
    !allowedHosts.includes(url.hostname.toLowerCase())
  ) {
    throw new SourceCaptureError(
      "navigation_mismatch",
      "Redirected outside the official HTTPS host allowlist",
    );
  }
  return url;
}

async function boundedBytes(response: Response, maxBytes: number): Promise<Uint8Array> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength);
    if (Number.isFinite(parsedLength) && parsedLength > maxBytes) {
      await response.body?.cancel();
      throw new SourceCaptureError("too_large", "Response exceeds the capture limit");
    }
  }

  if (response.body === null) return new Uint8Array();

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) {
        await reader.cancel();
        throw new SourceCaptureError("too_large", "Response exceeds the capture limit");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function captureHttpOnce<S extends string>(
  request: HttpStepRequest<S>,
  signal: AbortSignal,
): Promise<LiveCapturedArtifact<S>> {
  return (await captureHttpWithTrace(request, signal, {
    maxBytes: MAX_CAPTURE_BYTES,
    maxRedirects: MAX_REDIRECTS,
  })).artifact;
}

function appendDistinct(chain: string[], value: string): void {
  if (chain.at(-1) !== value) chain.push(value);
}

function failureTrace(
  redirectChain: readonly string[],
  response?: Response,
  rejectedRedirectUrl?: string,
): HttpCaptureFailureTrace {
  const responseUrl = response?.url;
  const mediaType = response === undefined
    ? undefined
    : normalizedMediaType(response.headers.get("content-type"));
  return {
    redirectChain: [...redirectChain],
    ...(rejectedRedirectUrl === undefined ? {} : { rejectedRedirectUrl }),
    ...(response === undefined ? {} : { responseStatus: response.status }),
    ...(responseUrl === undefined || responseUrl === "" ? {} : { responseUrl }),
    ...(mediaType === undefined || mediaType === "" ? {} : { mediaType }),
  };
}

function tracedError(
  kind: CaptureFailureKind,
  message: string,
  trace: HttpCaptureFailureTrace,
  cause?: unknown,
): SourceCaptureError {
  return new SourceCaptureError(kind, message, cause === undefined ? undefined : { cause }, trace);
}

function assertCaptureLimits(limits: HttpCaptureLimits): void {
  if (!Number.isSafeInteger(limits.maxBytes) || limits.maxBytes <= 0 ||
    !Number.isSafeInteger(limits.maxRedirects) || limits.maxRedirects < 0) {
    throw new SourceCaptureError("navigation_mismatch", "Invalid HTTP capture limits");
  }
}

export async function captureHttpWithTrace<S extends string>(
  request: HttpStepRequest<S>,
  signal: AbortSignal,
  limits: HttpCaptureLimits,
): Promise<TracedLiveCapture<S>> {
  assertCaptureLimits(limits);
  const allowedHosts = request.allowedHosts.map((host) => host.toLowerCase());
  let currentUrl = officialHttpsUrl(request.url, allowedHosts);
  const redirectChain: string[] = [currentUrl.href];
  let currentMethod: "GET" | "POST" = request.method;
  let currentBody = request.bodyBytes === undefined
    ? undefined
    : new Uint8Array(request.bodyBytes);
  let response!: Response;

  for (let redirects = 0; redirects <= limits.maxRedirects; redirects += 1) {
    try {
      response = await fetch(currentUrl.href, {
        method: currentMethod,
        headers: request.headers,
        body: currentBody,
        redirect: "manual",
        signal,
      });
    } catch (error) {
      if (signal.aborted || (error instanceof DOMException && error.name === "AbortError")) {
        throw tracedError("timeout", "HTTP attempt was aborted", failureTrace(redirectChain), error);
      }
      throw tracedError("http_error", "HTTP attempt failed", failureTrace(redirectChain), error);
    }

    let responseUrl: URL;
    try {
      responseUrl = officialHttpsUrl(response.url || currentUrl.href, allowedHosts);
    } catch (error) {
      const rejectedUrl = response.url || currentUrl.href;
      throw tracedError(
        "navigation_mismatch",
        "Redirected outside the official HTTPS host allowlist",
        failureTrace(redirectChain, response, rejectedUrl),
        error,
      );
    }
    if (!REDIRECT_STATUSES.has(response.status)) {
      currentUrl = responseUrl;
      appendDistinct(redirectChain, currentUrl.href);
      break;
    }
    await response.body?.cancel();
    const location = response.headers.get("location");
    if (location === null) {
      throw tracedError(
        "navigation_mismatch",
        "Official redirect is missing a location",
        failureTrace(redirectChain, response),
      );
    }
    let resolvedRedirectUrl: string;
    try {
      resolvedRedirectUrl = new URL(location, responseUrl).href;
    } catch (error) {
      throw tracedError(
        "navigation_mismatch",
        "Redirect URL is not valid",
        failureTrace(redirectChain, response),
        error,
      );
    }
    let redirectUrl: URL;
    try {
      redirectUrl = officialHttpsUrl(resolvedRedirectUrl, allowedHosts);
    } catch (error) {
      throw tracedError(
        "navigation_mismatch",
        "Redirected outside the official HTTPS host allowlist",
        failureTrace(redirectChain, response, resolvedRedirectUrl),
        error,
      );
    }
    if (redirectChain.includes(redirectUrl.href)) {
      throw tracedError(
        "navigation_mismatch",
        "Official redirect loop detected",
        failureTrace(redirectChain, response, redirectUrl.href),
      );
    }
    if (redirects === limits.maxRedirects) {
      throw tracedError(
        "navigation_mismatch",
        "Official redirect limit exceeded",
        failureTrace(redirectChain, response, redirectUrl.href),
      );
    }
    if (response.status === 303 || ((response.status === 301 || response.status === 302) && currentMethod === "POST")) {
      currentMethod = "GET";
      currentBody = undefined;
    }
    currentUrl = redirectUrl;
    appendDistinct(redirectChain, currentUrl.href);
  }

  if (!response.ok) {
    await response.body?.cancel();
    throw tracedError(
      classifyStatus(response.status),
      `Official source returned HTTP ${response.status}`,
      failureTrace(redirectChain, response),
    );
  }

  const mediaType = normalizedMediaType(response.headers.get("content-type"));
  const allowedMediaTypes = request.allowedMediaTypes.map((value) => value.toLowerCase());
  if (!allowedMediaTypes.includes(mediaType)) {
    await response.body?.cancel();
    throw tracedError(
      "wrong_media_type",
      `Unexpected response media type: ${mediaType}`,
      failureTrace(redirectChain, response),
    );
  }

  let bytes: Uint8Array;
  try {
    bytes = await boundedBytes(response, limits.maxBytes);
  } catch (error) {
    if (signal.aborted || (error instanceof DOMException && error.name === "AbortError")) {
      throw tracedError(
        "timeout",
        "HTTP response stream was aborted",
        failureTrace(redirectChain, response),
        error,
      );
    }
    if (error instanceof SourceCaptureError) {
      throw tracedError(error.kind, error.message, failureTrace(redirectChain, response), error.cause);
    }
    throw tracedError("http_error", "HTTP response stream failed", failureTrace(redirectChain, response), error);
  }
  const bodySha256 = request.bodyBytes === undefined ? undefined : sha256(request.bodyBytes);
  const artifactSha256 = sha256(bytes);

  return {
    artifact: {
      artifactId: `${request.sourceId}:${request.role}:${artifactSha256}`,
      runId: request.runId,
      sourceId: request.sourceId,
      role: request.role,
      url: currentUrl.href,
      mediaType,
      sha256: artifactSha256,
      bytes,
      origin: "live",
      capturedAt: new Date().toISOString(),
      responseStatus: response.status,
      responseUrl: currentUrl.href,
      request: {
        method: request.method,
        url: request.url,
        ...(request.bodyMediaType === undefined ? {} : { bodyMediaType: request.bodyMediaType }),
        ...(bodySha256 === undefined ? {} : { bodySha256 }),
      },
    },
    redirectChain,
  };
}
