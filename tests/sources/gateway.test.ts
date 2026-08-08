import { afterEach, describe, expect, test, vi } from "vitest";

import {
  MAX_CAPTURE_BYTES,
  SourceCaptureError,
  captureHttpOnce,
} from "../../src/infrastructure/sources/gateway";
import type { HttpStepRequest } from "../../src/research/contracts";
import type {
  CaptureRequest,
  LiveCapturedArtifact,
  RequestStep,
} from "../../src/research/contracts";
import { OfficialSourceAdapter } from "../../src/infrastructure/sources/official-source-adapter";
import { resolveLatestApplicableQbzAct } from "../../src/infrastructure/sources/qbz-navigation";

const request: HttpStepRequest = {
  sourceId: "cbr-eur",
  role: "daily-rates",
  method: "POST",
  url: "https://www.cbr.ru/scripts/XML_daily.asp",
  headers: { accept: "application/xml", "content-type": "application/json" },
  bodyMediaType: "application/json",
  bodyBytes: new TextEncoder().encode('{"date":"2026-08-06"}'),
  allowedHosts: ["www.cbr.ru"],
  allowedMediaTypes: ["application/xml"],
};

function response(
  body: ConstructorParameters<typeof Response>[0],
  init: ResponseInit & { url?: string } = {},
): Response {
  const value = new Response(body, init);
  Object.defineProperty(value, "url", {
    value: init.url ?? request.url,
    configurable: true,
  });
  return value;
}

afterEach(() => vi.unstubAllGlobals());

function liveArtifact(step: HttpStepRequest, body: string, url = step.url): LiveCapturedArtifact {
  const bytes = new TextEncoder().encode(body);
  return {
    artifactId: `${step.sourceId}:${step.role}`,
    role: step.role,
    url,
    mediaType: step.allowedMediaTypes[0]!,
    sha256: "fixture-sha",
    bytes,
    origin: "live",
    capturedAt: "2026-08-08T10:00:00.000Z",
    responseStatus: 200,
    responseUrl: url,
    request: { method: step.method, url: step.url },
  };
}

function captureRequest(
  sourceId: CaptureRequest["sourceId"],
  signal = new AbortController().signal,
): CaptureRequest {
  return {
    runId: "run-1",
    sourceId,
    assessmentDate: "2026-08-08",
    deadlineAt: "2026-08-08T10:01:00.000Z",
    signal,
  };
}

describe("captureHttpOnce", () => {
  test("captures one attempt and hashes exact response and request bytes", async () => {
    const exactBytes = Uint8Array.of(0, 255, 10, 13, 65);
    const fetchSpy = vi.fn(async () =>
      response(exactBytes, {
        status: 200,
        headers: { "content-type": "application/xml; charset=windows-1251" },
      }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const artifact = await captureHttpOnce(request, new AbortController().signal);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(artifact.bytes).toEqual(exactBytes);
    expect(artifact.sha256).toBe(
      "7324c9525db64f21dac0fb72486637a83b959ce4bf38804a7021f11a97ebd205",
    );
    expect(artifact.request).toEqual({
      method: "POST",
      url: request.url,
      bodyMediaType: "application/json",
      bodySha256: "2aebd4ef7e70c18f43b1234c74d288dec853e110ab58bc3c04841b3bf8c7a6dd",
    });
    expect(artifact.origin).toBe("live");
  });

  test("rejects a declared response larger than 30 MiB before reading it", async () => {
    const body = new ReadableStream<Uint8Array>({
      pull() {
        throw new Error("body must not be read");
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        response(body, {
          status: 200,
          headers: {
            "content-type": "application/xml",
            "content-length": String(MAX_CAPTURE_BYTES + 1),
          },
        }),
      ),
    );

    await expect(
      captureHttpOnce(request, new AbortController().signal),
    ).rejects.toMatchObject({ kind: "too_large" });
  });

  test("stops a chunked response at 30 MiB plus one byte", async () => {
    const cancel = vi.fn();
    let sent = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (!sent) {
          controller.enqueue(new Uint8Array(MAX_CAPTURE_BYTES + 1));
          sent = true;
        }
      },
      cancel,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        response(body, {
          status: 200,
          headers: { "content-type": "application/xml" },
        }),
      ),
    );

    await expect(
      captureHttpOnce(request, new AbortController().signal),
    ).rejects.toMatchObject({ kind: "too_large" });
    expect(cancel).toHaveBeenCalledOnce();
  });

  test.each([
    [429, "rate_limited", true],
    [503, "server_error", true],
    [404, "http_error", false],
  ] as const)("classifies HTTP %i as %s", async (status, kind, retryable) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        response("failure", {
          status,
          headers: { "content-type": "text/plain" },
        }),
      ),
    );

    await expect(
      captureHttpOnce(request, new AbortController().signal),
    ).rejects.toMatchObject({ kind, retryable });
  });

  test("classifies an aborted attempt as timeout", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new DOMException("aborted", "AbortError");
      }),
    );

    await expect(
      captureHttpOnce(request, AbortSignal.abort()),
    ).rejects.toEqual(
      expect.objectContaining<Partial<SourceCaptureError>>({ kind: "timeout", retryable: true }),
    );
  });

  test("classifies an AbortError raised while streaming the body as timeout", async () => {
    let reads = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        reads += 1;
        if (reads === 1) controller.enqueue(Uint8Array.of(1, 2, 3));
        else controller.error(new DOMException("stream aborted", "AbortError"));
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        response(body, {
          status: 200,
          headers: { "content-type": "application/xml" },
        }),
      ),
    );

    await expect(
      captureHttpOnce(request, new AbortController().signal),
    ).rejects.toMatchObject({ kind: "timeout", retryable: true });
  });

  test.each([
    ["https://mirror.example/XML_daily.asp", "application/xml", "navigation_mismatch"],
    [request.url, "text/html", "wrong_media_type"],
  ] as const)("rejects final URL/MIME policy violations", async (url, mediaType, kind) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        response("not accepted", {
          status: 200,
          url,
          headers: { "content-type": mediaType },
        }),
      ),
    );

    await expect(
      captureHttpOnce(request, new AbortController().signal),
    ).rejects.toMatchObject({ kind, retryable: false });
  });
});

describe("resolveLatestApplicableQbzAct", () => {
  test("keeps public and indexed URLs separate and chooses the latest applicable cons version", async () => {
    const seen: HttpStepRequest[] = [];
    const step: RequestStep = async (httpRequest) => {
      seen.push(httpRequest);
      if (httpRequest.role === "eli-search") {
        return liveArtifact(
          httpRequest,
          JSON.stringify({
            hasMoreItems: false,
            items: [
              {
                nodeType: "qbz:act",
                path: "/base",
                actNumber: "79",
                actDate: "2021-06-24",
                actType: "ligj",
                "qbz:url": "http://qbz.gov.al/eli/ligj/2021/06/24/79",
                modifiedAt: "2099-01-01",
                id: "do-not-pin-this-node",
              },
            ],
          }),
        );
      }
      if (httpRequest.role === "eli-root") {
        return liveArtifact(
          httpRequest,
          JSON.stringify({
            hasMoreItems: false,
            items: [
              { nodeType: "qbz:actVersion", name: "cons-2024-01-01", path: "/base/cons-2024-01-01" },
              { nodeType: "qbz:actVersion", name: "cons-2026-08-09", path: "/base/cons-2026-08-09" },
              { nodeType: "qbz:actVersion", name: "cons-2025-07-18", path: "/base/cons-2025-07-18" },
            ],
          }),
        );
      }
      if (httpRequest.role === "eli-version") {
        expect(httpRequest.url).toContain("cons-2025-07-18");
        return liveArtifact(
          httpRequest,
          JSON.stringify({
            hasMoreItems: false,
            items: [
              {
                nodeType: "qbz:actVersion",
                name: "cons-2025-07-18",
                path: "/base/cons-2025-07-18",
                mediaType: "application/pdf",
                url: "https://qbz.gov.al/media/law-79-consolidated.pdf",
              },
            ],
          }),
        );
      }
      return liveArtifact(httpRequest, "%PDF-1.4\nfixture", httpRequest.url);
    };

    const result = await resolveLatestApplicableQbzAct(
      "al-law-79",
      "2026-08-08",
      step,
      new AbortController().signal,
    );

    expect(result.navigationUrl).toBe("https://qbz.gov.al/eli/ligj/2021/06/24/79");
    expect(result.indexedSourceUrl).toBe("http://qbz.gov.al/eli/ligj/2021/06/24/79");
    expect(result.resolvedEvidenceUrl).toBe(
      "https://qbz.gov.al/media/law-79-consolidated.pdf",
    );
    expect(result.versionHint).toBe("cons-2025-07-18");
    expect(result.artifacts.map((artifact) => artifact.role)).toEqual([
      "eli-search",
      "eli-root",
      "eli-version",
      "act-pdf",
    ]);
    expect(seen[0]).toMatchObject({
      method: "POST",
      bodyMediaType: "application/json",
      headers: { "content-type": "application/json" },
    });
    expect(new TextDecoder().decode(seen[0]!.bodyBytes)).toBe(
      '{"nodeType":"qbz:act","path":"/base","actNumber":"79","actDate":"2021-06-24","actType":"ligj","qbz:url":"http://qbz.gov.al/eli/ligj/2021/06/24/79"}',
    );
  });

  test("rejects paginated or non-unique exact search results", async () => {
    const step: RequestStep = async (httpRequest) =>
      liveArtifact(
        httpRequest,
        JSON.stringify({ hasMoreItems: true, items: [] }),
      );

    await expect(
      resolveLatestApplicableQbzAct(
        "al-decision-858",
        "2026-08-08",
        step,
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ kind: "navigation_mismatch" });
  });

  test("rejects duplicate latest applicable consolidated versions", async () => {
    const step: RequestStep = async (httpRequest) => {
      if (httpRequest.role === "eli-search") {
        return liveArtifact(httpRequest, JSON.stringify({
          hasMoreItems: false,
          items: [{
            nodeType: "qbz:act",
            path: "/base",
            actNumber: "79",
            actDate: "2021-06-24",
            actType: "ligj",
            "qbz:url": "http://qbz.gov.al/eli/ligj/2021/06/24/79",
          }],
        }));
      }
      if (httpRequest.role === "eli-root") {
        return liveArtifact(httpRequest, JSON.stringify({
          hasMoreItems: false,
          items: [
            { nodeType: "qbz:actVersion", name: "cons-2025-07-18", path: "/base/cons-2025-07-18" },
            { nodeType: "qbz:actVersion", name: "cons-2025-07-18", path: "/base/cons-2025-07-18" },
          ],
        }));
      }
      if (httpRequest.role === "eli-version") {
        return liveArtifact(httpRequest, JSON.stringify({
          hasMoreItems: false,
          items: [{
            nodeType: "qbz:actVersion",
            name: "cons-2025-07-18",
            path: "/base/cons-2025-07-18",
            mediaType: "application/pdf",
            url: "https://qbz.gov.al/media/law-79.pdf",
          }],
        }));
      }
      return liveArtifact(httpRequest, "%PDF-1.7");
    };

    await expect(
      resolveLatestApplicableQbzAct(
        "al-law-79",
        "2026-08-08",
        step,
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ kind: "navigation_mismatch" });
  });

  test("rejects a consolidated version outside the searched act root", async () => {
    const step: RequestStep = async (httpRequest) => {
      if (httpRequest.role === "eli-search") {
        return liveArtifact(httpRequest, JSON.stringify({
          hasMoreItems: false,
          items: [{
            nodeType: "qbz:act",
            path: "/base",
            actNumber: "79",
            actDate: "2021-06-24",
            actType: "ligj",
            "qbz:url": "http://qbz.gov.al/eli/ligj/2021/06/24/79",
          }],
        }));
      }
      if (httpRequest.role === "eli-root") {
        return liveArtifact(httpRequest, JSON.stringify({
          hasMoreItems: false,
          items: [{
            nodeType: "qbz:actVersion",
            name: "cons-2025-07-18",
            path: "/another-act/cons-2025-07-18",
          }],
        }));
      }
      throw new Error("an unrelated version must not be traversed");
    };

    await expect(
      resolveLatestApplicableQbzAct(
        "al-law-79",
        "2026-08-08",
        step,
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ kind: "navigation_mismatch" });
  });

  test("rejects a PDF item that does not belong to the selected version", async () => {
    const step: RequestStep = async (httpRequest) => {
      if (httpRequest.role === "eli-search") {
        return liveArtifact(httpRequest, JSON.stringify({
          hasMoreItems: false,
          items: [{
            nodeType: "qbz:act",
            path: "/base",
            actNumber: "79",
            actDate: "2021-06-24",
            actType: "ligj",
            "qbz:url": "http://qbz.gov.al/eli/ligj/2021/06/24/79",
          }],
        }));
      }
      if (httpRequest.role === "eli-root") {
        return liveArtifact(httpRequest, JSON.stringify({
          hasMoreItems: false,
          items: [{ nodeType: "qbz:actVersion", name: "cons-2025-07-18", path: "/base/cons-2025-07-18" }],
        }));
      }
      return liveArtifact(httpRequest, JSON.stringify({
        hasMoreItems: false,
        items: [{
          nodeType: "qbz:actVersion",
          name: "cons-2024-01-01",
          path: "/base/cons-2024-01-01",
          mediaType: "application/pdf",
          url: "https://qbz.gov.al/media/wrong-version.pdf",
        }],
      }));
    };

    await expect(
      resolveLatestApplicableQbzAct(
        "al-law-79",
        "2026-08-08",
        step,
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ kind: "navigation_mismatch" });
  });
});

describe("OfficialSourceAdapter direct captures", () => {
  test.each([
    ["cbr-eur", "https://www.cbr.ru/scripts/XML_daily.asp", "www.cbr.ru", "application/xml"],
    [
      "boa-eur",
      "https://www.bankofalbania.org/Markets/Official_exchange_rate/",
      "www.bankofalbania.org",
      "text/html",
    ],
  ] as const)("captures %s only from its official fixed path", async (sourceId, url, host, mediaType) => {
    const seen: HttpStepRequest[] = [];
    const signals: AbortSignal[] = [];
    const step: RequestStep = async (httpRequest, signal) => {
      seen.push(httpRequest);
      signals.push(signal);
      return liveArtifact(httpRequest, "official bytes");
    };

    const signal = new AbortController().signal;

    const result = await new OfficialSourceAdapter().capture(captureRequest(sourceId, signal), step);

    expect(result.ok).toBe(true);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      method: "GET",
      url,
      allowedHosts: [host],
      allowedMediaTypes: [mediaType],
    });
    expect(signals).toEqual([signal]);
  });

  test("retains the municipal page and its one allowlisted GIS iframe", async () => {
    const seen: HttpStepRequest[] = [];
    const signals: AbortSignal[] = [];
    const step: RequestStep = async (httpRequest, signal) => {
      seen.push(httpRequest);
      signals.push(signal);
      if (httpRequest.role === "municipality-page") {
        return liveArtifact(
          httpRequest,
          '<html><iframe src="https://gis.tirana.al/portal/apps/webappviewer/index.html?id=transporti"></iframe></html>',
        );
      }
      return liveArtifact(httpRequest, "<html><title>Transporti</title></html>");
    };

    const signal = new AbortController().signal;
    const result = await new OfficialSourceAdapter().capture(
      captureRequest("tirana-urban-lines", signal),
      step,
    );

    expect(result.ok && result.entry.artifacts.map((artifact) => artifact.role)).toEqual([
      "municipality-page",
      "municipal-gis-app",
    ]);
    expect(result.ok && result.entry.versionHint).toBe("2026-08-08T10:00:00.000Z");
    expect(seen[1]).toMatchObject({
      url: "https://gis.tirana.al/portal/apps/webappviewer/index.html?id=transporti",
      allowedHosts: ["gis.tirana.al"],
      allowedMediaTypes: ["text/html"],
    });
    expect(signals).toEqual([signal, signal]);
  });

  test("rejects a municipal page with more than one iframe", async () => {
    const step: RequestStep = async (httpRequest) =>
      liveArtifact(
        httpRequest,
        '<iframe src="https://gis.tirana.al/one"></iframe><iframe src="https://gis.tirana.al/two"></iframe>',
      );

    const result = await new OfficialSourceAdapter().capture(
      captureRequest("tirana-urban-lines"),
      step,
    );

    expect(result).toMatchObject({ ok: false, kind: "navigation_mismatch", attempts: 1 });
  });

  test("preserves the municipal page when the GIS request fails", async () => {
    const step: RequestStep = async (httpRequest) => {
      if (httpRequest.role === "municipality-page") {
        return liveArtifact(
          httpRequest,
          '<iframe src="https://gis.tirana.al/transporti"></iframe>',
        );
      }
      throw new SourceCaptureError("timeout", "GIS timed out");
    };

    const result = await new OfficialSourceAdapter().capture(
      captureRequest("tirana-urban-lines"),
      step,
    );

    expect(result.ok).toBe(false);
    expect(!result.ok && result.partialArtifacts.map((artifact) => artifact.role)).toEqual([
      "municipality-page",
    ]);
  });

  test("rejects a GIS artifact whose resolved URL differs from the iframe URL", async () => {
    const step: RequestStep = async (httpRequest) => {
      if (httpRequest.role === "municipality-page") {
        return liveArtifact(
          httpRequest,
          '<iframe src="https://gis.tirana.al/transporti"></iframe>',
        );
      }
      return liveArtifact(httpRequest, "<title>Transporti</title>", "https://gis.tirana.al/other");
    };

    const result = await new OfficialSourceAdapter().capture(
      captureRequest("tirana-urban-lines"),
      step,
    );

    expect(result).toMatchObject({ ok: false, kind: "navigation_mismatch" });
    expect(!result.ok && result.partialArtifacts.map((artifact) => artifact.role)).toEqual([
      "municipality-page",
      "municipal-gis-app",
    ]);
  });

  test("preserves QBZ JSON artifacts when a later network step fails", async () => {
    const signals: AbortSignal[] = [];
    const step: RequestStep = async (httpRequest, signal) => {
      signals.push(signal);
      if (httpRequest.role === "eli-search") {
        return liveArtifact(httpRequest, JSON.stringify({
          hasMoreItems: false,
          items: [{
            nodeType: "qbz:act",
            path: "/base",
            actNumber: "79",
            actDate: "2021-06-24",
            actType: "ligj",
            "qbz:url": "http://qbz.gov.al/eli/ligj/2021/06/24/79",
          }],
        }));
      }
      if (httpRequest.role === "eli-root") {
        return liveArtifact(httpRequest, JSON.stringify({
          hasMoreItems: false,
          items: [{ nodeType: "qbz:actVersion", name: "cons-2025-07-18", path: "/base/cons-2025-07-18" }],
        }));
      }
      throw new SourceCaptureError("server_error", "version request failed");
    };

    const signal = new AbortController().signal;
    const result = await new OfficialSourceAdapter().capture(
      captureRequest("al-law-79", signal),
      step,
    );

    expect(result.ok).toBe(false);
    expect(!result.ok && result.partialArtifacts.map((artifact) => artifact.role)).toEqual([
      "eli-search",
      "eli-root",
    ]);
    expect(signals).toEqual([signal, signal, signal]);
  });
});
