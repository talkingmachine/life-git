import { describe, expect, test, vi } from "vitest";

import {
  createCitySafetySearchPort,
  createUnconfiguredCitySafetySearchPort,
} from "../../src/infrastructure/sources/city-safety-search-adapter";
import {
  createHttpCitySafetySearchStep,
  type CitySafetySearchHttpRequest,
  type HttpCitySafetySearchConfig,
} from "../../src/infrastructure/sources/http-city-safety-search-step";

const CONFIG: HttpCitySafetySearchConfig = {
  endpoint: "https://search.example/v1/city-safety",
  providerId: "deployed-provider",
  bearerToken: "top-secret-token",
  timeoutMs: 2_000,
  maxResponseBytes: 65536,
};

describe("city-safety search adapter", () => {
  test("binds composition provider identity and validates exact URL-only payload", async () => {
    // Break caught: provider-controlled identity or snippet-shaped data crosses the inward boundary.
    const port = createCitySafetySearchPort({
      providerId: "provider-a",
      step: async () => ({
        kind: "completed",
        payload: { urls: ["https://policija.si/a", "https://policija.si/a"] },
      }),
    });

    await expect(port.search({
      queryId: "city-safety-query:run-1:1",
      query: "exact query",
      resultLimit: 2,
      signal: new AbortController().signal,
    })).resolves.toEqual({
      kind: "completed",
      providerId: "provider-a",
      urls: ["https://policija.si/a", "https://policija.si/a"],
    });
  });

  test.each([
    { urls: ["https://policija.si/a"], snippets: [] },
    { urls: ["https://policija.si/a", "https://policija.si/b"] },
    { urls: [42] },
  ])("rejects malformed or over-limit completed payload %#", async (payload) => {
    // Break caught: extra provider data, invalid values, or requested-limit violations become ledger data.
    const port = createCitySafetySearchPort({
      providerId: "provider-a",
      step: async () => ({ kind: "completed", payload }),
    });
    await expect(port.search({
      queryId: "city-safety-query:run-1:1",
      query: "query",
      resultLimit: 1,
      signal: new AbortController().signal,
    })).rejects.toThrow("invalid_city_safety_search_protocol");
  });

  test("builds an explicit unconfigured unavailable response without calling HTTP", async () => {
    // Break caught: missing deployment configuration is mistaken for an empty successful search.
    await expect(createUnconfiguredCitySafetySearchPort().search({
      queryId: "city-safety-query:run-1:1",
      query: "query",
      resultLimit: 10,
      signal: new AbortController().signal,
    })).resolves.toEqual({
      kind: "unavailable",
      providerId: "search-provider-unconfigured",
      reason: "search_provider_unconfigured",
    });
  });
});

describe("HTTP city-safety search step", () => {
  test("posts strict JSON with request-only bearer token and accepts exact JSON bytes", async () => {
    // Break caught: method/body/redirect policy drifts or the secret enters the returned value.
    const request = vi.fn<CitySafetySearchHttpRequest>(async (input) => {
      expect(input).toEqual({
        url: CONFIG.endpoint,
        method: "POST",
        redirectMode: "error",
        headers: {
          accept: "application/json",
          authorization: "Bearer top-secret-token",
          "content-type": "application/json",
        },
        bodyBytes: new TextEncoder().encode('{"query":"municipality police","resultLimit":3}'),
      });
      return {
        status: 200,
        mediaType: "application/json; charset=utf-8",
        bodyBytes: new TextEncoder().encode('{"urls":["https://policija.si/report"]}'),
      };
    });

    const result = await createHttpCitySafetySearchStep(CONFIG, request)(
      { query: "municipality police", resultLimit: 3 },
      new AbortController().signal,
    );

    expect(result).toEqual({
      kind: "completed",
      payload: { urls: ["https://policija.si/report"] },
    });
    expect(JSON.stringify(result)).not.toContain("top-secret-token");
    expect(JSON.stringify(result)).not.toContain(CONFIG.endpoint);
  });

  test.each([302, 404, 429, 503])("maps HTTP %i to typed unavailable", async (status) => {
    // Break caught: provider availability becomes a protocol exception or a followed redirect.
    const step = createHttpCitySafetySearchStep(CONFIG, async () => ({
      status,
      mediaType: "application/json",
      bodyBytes: new Uint8Array(),
    }));
    await expect(step({ query: "query", resultLimit: 1 }, new AbortController().signal))
      .resolves.toEqual({ kind: "unavailable", reason: "provider_unavailable" });
  });

  test("maps request network failure to unavailable but preserves caller abort", async () => {
    // Break caught: transport errors abort discovery or caller cancellation is swallowed as availability.
    const networkStep = createHttpCitySafetySearchStep(CONFIG, async () => {
      throw new TypeError("network failed");
    });
    await expect(networkStep({ query: "q", resultLimit: 1 }, new AbortController().signal))
      .resolves.toEqual({ kind: "unavailable", reason: "provider_unavailable" });

    const controller = new AbortController();
    controller.abort(new DOMException("cancelled", "AbortError"));
    await expect(networkStep({ query: "q", resultLimit: 1 }, controller.signal))
      .rejects.toMatchObject({ name: "AbortError" });
  });

  test("keeps a late success unavailable when the request resolves after its timeout signal", async () => {
    // Break caught: a request implementation that resolves on abort turns a timed-out search into success.
    vi.useFakeTimers();
    try {
      const step = createHttpCitySafetySearchStep({ ...CONFIG, timeoutMs: 1_000 },
        async (_request, signal) => {
          await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
          return {
            status: 200,
            mediaType: "application/json",
            bodyBytes: new TextEncoder().encode('{"urls":[]}'),
          };
        });
      const pending = step({ query: "q", resultLimit: 1 }, new AbortController().signal);

      await vi.advanceTimersByTimeAsync(1_000);

      await expect(pending).resolves.toEqual({
        kind: "unavailable",
        reason: "provider_unavailable",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  test.each([
    { mediaType: "text/html", body: "{}" },
    { mediaType: "application/json", body: "not-json" },
    { mediaType: "application/json", body: '{"urls":[],"providerId":"forged"}' },
  ])("rejects a successful malformed response %#", async ({ mediaType, body }) => {
    // Break caught: wrong-media or non-closed 2xx data becomes a completed search.
    const step = createHttpCitySafetySearchStep(CONFIG, async () => ({
      status: 200,
      mediaType,
      bodyBytes: new TextEncoder().encode(body),
    }));
    await expect(step({ query: "q", resultLimit: 1 }, new AbortController().signal))
      .rejects.toThrow("invalid_city_safety_search_protocol");
  });

  test("rejects invalid endpoint, timeout, byte limit and bearer syntax without invoking request", () => {
    // Break caught: unsafe deployment configuration weakens the fixed outer boundary.
    const request = vi.fn<CitySafetySearchHttpRequest>();
    const invalid: readonly HttpCitySafetySearchConfig[] = [
      { ...CONFIG, endpoint: "http://search.example/v1" },
      { ...CONFIG, endpoint: "https://user@search.example/v1" },
      { ...CONFIG, endpoint: "https://search.example/v1#fragment" },
      { ...CONFIG, timeoutMs: 999 },
      { ...CONFIG, timeoutMs: 15_001 },
      { ...CONFIG, maxResponseBytes: 1 as 65536 },
      { ...CONFIG, bearerToken: "bad\nheader" },
    ];
    for (const config of invalid) {
      expect(() => createHttpCitySafetySearchStep(config, request))
        .toThrow("invalid_city_safety_search_config");
    }
    expect(request).not.toHaveBeenCalled();
  });
});
