import { createHash } from "node:crypto";

import type {
  CaptureFailureKind,
  HttpStepRequest,
  LiveCapturedArtifact,
} from "../../research/contracts";

export const MAX_CAPTURE_BYTES = 30 * 1024 * 1024;

export class SourceCaptureError extends Error {
  readonly kind: CaptureFailureKind;
  readonly retryable: boolean;

  constructor(kind: CaptureFailureKind, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "SourceCaptureError";
    this.kind = kind;
    this.retryable = kind === "timeout" || kind === "rate_limited" || kind === "server_error";
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
    !allowedHosts.includes(url.host.toLowerCase())
  ) {
    throw new SourceCaptureError(
      "navigation_mismatch",
      "Redirected outside the official HTTPS host allowlist",
    );
  }
  return url;
}

async function boundedBytes(response: Response): Promise<Uint8Array> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength);
    if (Number.isFinite(parsedLength) && parsedLength > MAX_CAPTURE_BYTES) {
      await response.body?.cancel();
      throw new SourceCaptureError("too_large", "Response exceeds the 30 MiB capture limit");
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
      if (length > MAX_CAPTURE_BYTES) {
        await reader.cancel();
        throw new SourceCaptureError("too_large", "Response exceeds the 30 MiB capture limit");
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
  const allowedHosts = request.allowedHosts.map((host) => host.toLowerCase());
  let currentUrl = officialHttpsUrl(request.url, allowedHosts);
  let currentMethod: "GET" | "POST" = request.method;
  let currentBody = request.bodyBytes === undefined
    ? undefined
    : new Uint8Array(request.bodyBytes);
  let response!: Response;

  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
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
        throw new SourceCaptureError("timeout", "HTTP attempt was aborted", { cause: error });
      }
      throw new SourceCaptureError("http_error", "HTTP attempt failed", { cause: error });
    }

    const responseUrl = officialHttpsUrl(response.url || currentUrl.href, allowedHosts);
    if (!REDIRECT_STATUSES.has(response.status)) {
      currentUrl = responseUrl;
      break;
    }
    await response.body?.cancel();
    if (redirects === MAX_REDIRECTS) {
      throw new SourceCaptureError("navigation_mismatch", "Official redirect limit exceeded");
    }
    const location = response.headers.get("location");
    if (location === null) {
      throw new SourceCaptureError("navigation_mismatch", "Official redirect is missing a location");
    }
    let redirectUrl: URL;
    try {
      redirectUrl = officialHttpsUrl(new URL(location, responseUrl).href, allowedHosts);
    } catch (error) {
      if (error instanceof SourceCaptureError) throw error;
      throw new SourceCaptureError("navigation_mismatch", "Redirect URL is not valid");
    }
    if (response.status === 303 || ((response.status === 301 || response.status === 302) && currentMethod === "POST")) {
      currentMethod = "GET";
      currentBody = undefined;
    }
    currentUrl = redirectUrl;
  }

  if (!response.ok) {
    await response.body?.cancel();
    throw new SourceCaptureError(
      classifyStatus(response.status),
      `Official source returned HTTP ${response.status}`,
    );
  }

  const mediaType = normalizedMediaType(response.headers.get("content-type"));
  const allowedMediaTypes = request.allowedMediaTypes.map((value) => value.toLowerCase());
  if (!allowedMediaTypes.includes(mediaType)) {
    await response.body?.cancel();
    throw new SourceCaptureError("wrong_media_type", `Unexpected response media type: ${mediaType}`);
  }

  let bytes: Uint8Array;
  try {
    bytes = await boundedBytes(response);
  } catch (error) {
    if (signal.aborted || (error instanceof DOMException && error.name === "AbortError")) {
      throw new SourceCaptureError("timeout", "HTTP response stream was aborted", { cause: error });
    }
    throw error;
  }
  const bodySha256 = request.bodyBytes === undefined ? undefined : sha256(request.bodyBytes);
  const artifactSha256 = sha256(bytes);

  return {
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
  };
}
