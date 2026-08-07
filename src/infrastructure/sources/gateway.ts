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

export async function captureHttpOnce(
  request: HttpStepRequest,
  signal: AbortSignal,
): Promise<LiveCapturedArtifact> {
  let response: Response;
  try {
    response = await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.bodyBytes,
      redirect: "follow",
      signal,
    });
  } catch (error) {
    if (signal.aborted || (error instanceof DOMException && error.name === "AbortError")) {
      throw new SourceCaptureError("timeout", "HTTP attempt was aborted", { cause: error });
    }
    throw new SourceCaptureError("http_error", "HTTP attempt failed", { cause: error });
  }

  if (!response.ok) {
    await response.body?.cancel();
    throw new SourceCaptureError(
      classifyStatus(response.status),
      `Official source returned HTTP ${response.status}`,
    );
  }

  let responseHost: string;
  try {
    responseHost = new URL(response.url).hostname.toLowerCase();
  } catch {
    await response.body?.cancel();
    throw new SourceCaptureError("navigation_mismatch", "Response URL is not valid");
  }
  const allowedHosts = request.allowedHosts.map((host) => host.toLowerCase());
  if (!allowedHosts.includes(responseHost)) {
    await response.body?.cancel();
    throw new SourceCaptureError("navigation_mismatch", "Redirected outside the official host allowlist");
  }

  const mediaType = normalizedMediaType(response.headers.get("content-type"));
  const allowedMediaTypes = request.allowedMediaTypes.map((value) => value.toLowerCase());
  if (!allowedMediaTypes.includes(mediaType)) {
    await response.body?.cancel();
    throw new SourceCaptureError("wrong_media_type", `Unexpected response media type: ${mediaType}`);
  }

  const bytes = await boundedBytes(response);
  const bodySha256 = request.bodyBytes === undefined ? undefined : sha256(request.bodyBytes);
  const artifactSha256 = sha256(bytes);

  return {
    artifactId: `${request.sourceId}:${request.role}:${artifactSha256}`,
    role: request.role,
    url: response.url,
    mediaType,
    sha256: artifactSha256,
    bytes,
    origin: "live",
    capturedAt: new Date().toISOString(),
    responseStatus: response.status,
    responseUrl: response.url,
    request: {
      method: request.method,
      url: request.url,
      ...(request.bodyMediaType === undefined ? {} : { bodyMediaType: request.bodyMediaType }),
      ...(bodySha256 === undefined ? {} : { bodySha256 }),
    },
  };
}
