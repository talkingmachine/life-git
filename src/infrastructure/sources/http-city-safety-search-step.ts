export type CitySafetySearchStepResult =
  | { readonly kind: "completed"; readonly payload: unknown }
  | { readonly kind: "unavailable"; readonly reason: "provider_unavailable" };

export type CitySafetySearchStep = (
  input: { readonly query: string; readonly resultLimit: number },
  signal: AbortSignal,
) => Promise<CitySafetySearchStepResult>;

export interface HttpCitySafetySearchConfig {
  readonly endpoint: string;
  readonly providerId: string;
  readonly bearerToken?: string;
  readonly timeoutMs: number;
  readonly maxResponseBytes: 65536;
}

export type CitySafetySearchHttpRequest = (
  input: {
    readonly url: string;
    readonly method: "POST";
    readonly redirectMode: "error";
    readonly headers: Readonly<Record<string, string>>;
    readonly bodyBytes: Uint8Array;
  },
  signal: AbortSignal,
) => Promise<{
  readonly status: number;
  readonly mediaType: string;
  readonly bodyBytes: Uint8Array;
}>;

function validEndpoint(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.username === "" && url.password === "" &&
      url.hash === "" && url.href === value;
  } catch {
    return false;
  }
}

function validateConfig(config: HttpCitySafetySearchConfig): void {
  const expectedKeys = config.bearerToken === undefined
    ? ["endpoint", "maxResponseBytes", "providerId", "timeoutMs"]
    : ["bearerToken", "endpoint", "maxResponseBytes", "providerId", "timeoutMs"];
  if (config === null || typeof config !== "object" || Array.isArray(config) ||
    Object.keys(config).sort().join(",") !== expectedKeys.sort().join(",") ||
    typeof config.endpoint !== "string" || !validEndpoint(config.endpoint) ||
    typeof config.providerId !== "string" ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(config.providerId) ||
    !Number.isSafeInteger(config.timeoutMs) || config.timeoutMs < 1_000 || config.timeoutMs > 15_000 ||
    config.maxResponseBytes !== 65536 ||
    config.bearerToken !== undefined &&
      (typeof config.bearerToken !== "string" || config.bearerToken.length === 0 ||
        /[\u0000-\u001f\u007f]/.test(config.bearerToken))) {
    throw new Error("invalid_city_safety_search_config");
  }
}

function normalizedMediaType(value: string): string {
  return value.split(";", 1)[0]!.trim().toLowerCase();
}

function parseCompletedPayload(bytes: Uint8Array, resultLimit: number): unknown {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new Error("invalid_city_safety_search_protocol");
  }
  if (value === null || typeof value !== "object" || Array.isArray(value) ||
    Object.keys(value).sort().join(",") !== "urls") {
    throw new Error("invalid_city_safety_search_protocol");
  }
  const urls = (value as Record<string, unknown>).urls;
  if (!Array.isArray(urls) || urls.length > resultLimit ||
    !urls.every((url) => typeof url === "string")) {
    throw new Error("invalid_city_safety_search_protocol");
  }
  return { urls: [...urls] };
}

function callerAbort(signal: AbortSignal): never {
  throw signal.reason ?? new DOMException("Aborted", "AbortError");
}

export function createHttpCitySafetySearchStep(
  config: HttpCitySafetySearchConfig,
  request: CitySafetySearchHttpRequest,
): CitySafetySearchStep {
  validateConfig(config);
  if (typeof request !== "function") throw new Error("invalid_city_safety_search_config");
  return async (input, signal) => {
    if (signal.aborted) callerAbort(signal);
    if (input === null || typeof input !== "object" || Array.isArray(input) ||
      Object.keys(input).sort().join(",") !== "query,resultLimit" ||
      typeof input.query !== "string" || input.query.length === 0 ||
      !Number.isSafeInteger(input.resultLimit) || input.resultLimit < 1 || input.resultLimit > 10) {
      throw new Error("invalid_city_safety_search_protocol");
    }
    const timeoutController = new AbortController();
    const timeout = setTimeout(() => timeoutController.abort(new DOMException("Timed out", "TimeoutError")),
      config.timeoutMs);
    const combinedSignal = AbortSignal.any([signal, timeoutController.signal]);
    const headers: Record<string, string> = {
      accept: "application/json",
      "content-type": "application/json",
      ...(config.bearerToken === undefined ? {} : { authorization: `Bearer ${config.bearerToken}` }),
    };
    try {
      const response = await request({
        url: config.endpoint,
        method: "POST",
        redirectMode: "error",
        headers,
        bodyBytes: new TextEncoder().encode(JSON.stringify({
          query: input.query,
          resultLimit: input.resultLimit,
        })),
      }, combinedSignal);
      if (signal.aborted) callerAbort(signal);
      if (timeoutController.signal.aborted) {
        return { kind: "unavailable", reason: "provider_unavailable" };
      }
      if (response === null || typeof response !== "object" || Array.isArray(response) ||
        Object.keys(response).sort().join(",") !== "bodyBytes,mediaType,status" ||
        !Number.isSafeInteger(response.status) || typeof response.mediaType !== "string" ||
        !(response.bodyBytes instanceof Uint8Array)) {
        throw new Error("invalid_city_safety_search_protocol");
      }
      if (response.status < 200 || response.status >= 300) {
        return { kind: "unavailable", reason: "provider_unavailable" };
      }
      if (normalizedMediaType(response.mediaType) !== "application/json" ||
        response.bodyBytes.byteLength > config.maxResponseBytes) {
        throw new Error("invalid_city_safety_search_protocol");
      }
      return {
        kind: "completed",
        payload: parseCompletedPayload(response.bodyBytes, input.resultLimit),
      };
    } catch (error) {
      if (signal.aborted) callerAbort(signal);
      if (error instanceof Error && error.message === "invalid_city_safety_search_protocol") throw error;
      return { kind: "unavailable", reason: "provider_unavailable" };
    } finally {
      clearTimeout(timeout);
    }
  };
}
