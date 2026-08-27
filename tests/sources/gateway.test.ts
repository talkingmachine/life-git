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
  runId: "run-1",
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
    runId: step.runId,
    sourceId: step.sourceId,
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

  test("follows an all-official HTTPS redirect chain and preserves exact final bytes", async () => {
    const chainRequest: HttpStepRequest = {
      ...request,
      method: "GET",
      bodyMediaType: undefined,
      bodyBytes: undefined,
      allowedHosts: ["www.cbr.ru", "rates.cbr.ru"],
    };
    const finalBytes = Uint8Array.of(222, 173, 190, 239);
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce(response(null, {
        status: 302,
        url: chainRequest.url,
        headers: { location: "https://rates.cbr.ru/daily" },
      }))
      .mockResolvedValueOnce(response(null, {
        status: 307,
        url: "https://rates.cbr.ru/daily",
        headers: { location: "https://www.cbr.ru/final.xml" },
      }))
      .mockResolvedValueOnce(response(finalBytes, {
        status: 200,
        url: "https://www.cbr.ru/final.xml",
        headers: { "content-type": "application/xml" },
      }));
    vi.stubGlobal("fetch", fetchSpy);

    const captured = await captureHttpOnce(chainRequest, new AbortController().signal);

    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(fetchSpy.mock.calls.map(([url]) => url)).toEqual([
      chainRequest.url,
      "https://rates.cbr.ru/daily",
      "https://www.cbr.ru/final.xml",
    ]);
    expect(fetchSpy.mock.calls.every(([, init]) => init?.redirect === "manual")).toBe(true);
    expect(captured.bytes).toEqual(finalBytes);
    expect(captured.mediaType).toBe("application/xml");
    expect(captured.responseUrl).toBe("https://www.cbr.ru/final.xml");
  });

  test("rejects an unofficial intermediate redirect without requesting it", async () => {
    const fetchSpy = vi.fn(async () => response(null, {
      status: 302,
      url: request.url,
      headers: { location: "https://mirror.example/hidden-hop" },
    }));
    vi.stubGlobal("fetch", fetchSpy);

    await expect(
      captureHttpOnce(request, new AbortController().signal),
    ).rejects.toMatchObject({ kind: "navigation_mismatch", retryable: false });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  test("rejects a non-default port on the initial official-looking URL before fetch", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await expect(captureHttpOnce(
      { ...request, url: "https://www.cbr.ru:444/scripts/XML_daily.asp" },
      new AbortController().signal,
    )).rejects.toMatchObject({ kind: "navigation_mismatch", retryable: false });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("rejects a non-default port on an intermediate redirect without requesting it", async () => {
    const fetchSpy = vi.fn(async () => response(null, {
      status: 302,
      url: request.url,
      headers: { location: "https://www.cbr.ru:444/hidden-hop" },
    }));
    vi.stubGlobal("fetch", fetchSpy);

    await expect(captureHttpOnce(request, new AbortController().signal)).rejects.toMatchObject({
      kind: "navigation_mismatch",
      retryable: false,
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  test("rejects a non-default port reported by the final response URL", async () => {
    const fetchSpy = vi.fn(async () => response("unsafe", {
      status: 200,
      url: "https://www.cbr.ru:444/final.xml",
      headers: { "content-type": "application/xml" },
    }));
    vi.stubGlobal("fetch", fetchSpy);

    await expect(captureHttpOnce(request, new AbortController().signal)).rejects.toMatchObject({
      kind: "navigation_mismatch",
      retryable: false,
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
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
  const nodesUrl =
    "https://qbz.gov.al/alfresco/api/-default-/public/alfresco/versions/1/nodes";
  const searchUrl =
    "https://qbz.gov.al/alfresco/api/-default-/public/search/versions/1/search";
  const actRoot = "/Company Home/Aktet/ligj/kuvendi-i-shqiperise/2021/06/24/79";
  const rootId = "bcd20d38-719e-4764-bc68-6dd8b04bdccb";
  const baseId = "468e0185-69ff-4117-b844-37d1529a25c4";
  const versionId = "9e7cfadd-33d1-4a3c-b1fc-38919599752f";
  const pdfId = "2eb73d6c-4d6c-4665-827e-02307371dac8";

  const listing = (
    entries: readonly Record<string, unknown>[],
    pagination: Partial<{
      readonly count: number;
      readonly hasMoreItems: boolean;
      readonly totalItems: number;
      readonly skipCount: number;
      readonly maxItems: number;
    }> = {},
  ) => JSON.stringify({
    list: {
      pagination: {
        count: entries.length,
        hasMoreItems: false,
        totalItems: entries.length,
        skipCount: 0,
        maxItems: 1000,
        ...pagination,
      },
      entries: entries.map((entry) => ({ entry })),
    },
  });

  const exactLawEntry = (): Record<string, unknown> => ({
    id: "a2ff0be0-d4a8-4089-94c4-3a7ba1846a9b",
    name: "ligj-2021-06-24-79.pdf",
    nodeType: "qbz:act",
    parentId: baseId,
    isFile: true,
    isFolder: false,
    content: { mimeType: "application/pdf", sizeInBytes: 449853 },
    path: {
      name: `${actRoot}/base`,
      isComplete: true,
      elements: [
        { id: rootId, name: "79" },
        { id: baseId, name: "base" },
      ],
    },
    properties: {
      "qbz:actNumber": "79",
      "qbz:actActType": "http://qbz.gov.al/resource/authority/document-type/ligj",
      "qbz:actDate": "2021-06-23T22:00:00.000+0000",
      "qbz:url": "http://qbz.gov.al/eli/ligj/2021/06/24/79",
      "qbz:actType": "Akt bazë",
      "qbz:status": "Approved",
    },
  });

  const baseFolderEntry = (): Record<string, unknown> => ({
    id: baseId,
    name: "base",
    nodeType: "cm:folder",
    parentId: rootId,
    isFile: false,
    isFolder: true,
    path: {
      name: actRoot,
      isComplete: true,
      elements: [{ id: rootId, name: "79" }],
    },
  });

  const versionFolderEntry = (
    name: string,
    id = versionId,
    parentId = rootId,
  ): Record<string, unknown> => ({
    id,
    name,
    nodeType: "cm:folder",
    parentId,
    isFile: false,
    isFolder: true,
    path: {
      name: actRoot,
      isComplete: true,
      elements: [{ id: rootId, name: "79" }],
    },
  });

  const pdfEntry = (
    id = pdfId,
    parentId = versionId,
  ): Record<string, unknown> => ({
    id,
    name: "ligj-2021-06-24-79-perditesuar.pdf",
    nodeType: "qbz:actVersion",
    parentId,
    isFile: true,
    isFolder: false,
    content: { mimeType: "application/pdf", sizeInBytes: 449853 },
    path: {
      name: `${actRoot}/cons-2025-07-14`,
      isComplete: true,
      elements: [
        { id: rootId, name: "79" },
        { id: versionId, name: "cons-2025-07-14" },
      ],
    },
    properties: {
      "qbz:url": "http://qbz.gov.al/eli/ligj/2021/06/24/79/cons/202508-18",
      "qbz:publishDate": "2025-08-18T12:24:28.660+0000",
    },
  });

  test("uses the bounded Alfresco API and chooses the latest applicable cons PDF", async () => {
    const seen: HttpStepRequest[] = [];
    const step: RequestStep = async (httpRequest) => {
      seen.push(httpRequest);
      if (httpRequest.role === "alfresco-search") {
        return liveArtifact(
          httpRequest,
          listing([
            {
              ...exactLawEntry(),
              id: "wrong-act",
              properties: {
                ...(exactLawEntry().properties as Record<string, unknown>),
                "qbz:url": "http://qbz.gov.al/eli/ligj/2001/01/01/79",
              },
            },
            exactLawEntry(),
          ]),
        );
      }
      if (httpRequest.role === "alfresco-base-folder") {
        return liveArtifact(
          httpRequest,
          JSON.stringify({ entry: baseFolderEntry() }),
        );
      }
      if (httpRequest.role === "alfresco-root-children") {
        return liveArtifact(
          httpRequest,
          listing([
            baseFolderEntry(),
            versionFolderEntry("cons-2024-01-01", "old-version"),
            versionFolderEntry("cons-2026-08-09", "future-version"),
            versionFolderEntry("cons-2025-07-14"),
          ]),
        );
      }
      if (httpRequest.role === "alfresco-version-children") {
        expect(httpRequest.url).toContain(versionId);
        return liveArtifact(
          httpRequest,
          listing([
            {
              ...pdfEntry("docx-node"),
              name: "ligj-2021-06-24-79-perditesuar.docx",
              nodeType: "cm:content",
              content: {
                mimeType:
                  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                sizeInBytes: 182556,
              },
            },
            pdfEntry(),
          ]),
        );
      }
      expect(httpRequest.role).toBe("act-pdf");
      return liveArtifact(httpRequest, "%PDF-1.4\nfixture", httpRequest.url);
    };

    const result = await resolveLatestApplicableQbzAct(
      "run-1",
      "al-law-79",
      "2026-08-08",
      step,
      new AbortController().signal,
    );

    expect(result.navigationUrl).toBe("https://qbz.gov.al/eli/ligj/2021/06/24/79");
    expect(result.indexedSourceUrl).toBe("http://qbz.gov.al/eli/ligj/2021/06/24/79");
    expect(result.resolvedEvidenceUrl).toBe(
      `${nodesUrl}/${pdfId}/content`,
    );
    expect(result.versionHint).toBe("cons-2025-07-14");
    expect(result.artifacts.map((artifact) => artifact.role)).toEqual([
      "alfresco-search",
      "alfresco-base-folder",
      "alfresco-root-children",
      "alfresco-version-children",
      "act-pdf",
    ]);
    expect(seen[0]).toMatchObject({
      method: "POST",
      url: searchUrl,
      bodyMediaType: "application/json",
      headers: { "content-type": "application/json" },
    });
    expect(JSON.parse(new TextDecoder().decode(seen[0]!.bodyBytes))).toEqual({
      query: { language: "afts", query: "=qbz\\:actNumber:'79'" },
      paging: { maxItems: 1000, skipCount: 0 },
      include: ["properties", "path"],
    });
    expect(seen.map(({ url }) => url)).toEqual([
      searchUrl,
      `${nodesUrl}/${baseId}?include=path`,
      `${nodesUrl}/${rootId}/children?include=path%2Cproperties&maxItems=1000&skipCount=0`,
      `${nodesUrl}/${versionId}/children?include=path%2Cproperties&maxItems=1000&skipCount=0`,
      `${nodesUrl}/${pdfId}/content`,
    ]);
  });

  test("rejects a paginated Alfresco search result", async () => {
    const step: RequestStep = async (httpRequest) =>
      liveArtifact(
        httpRequest,
        listing([], { hasMoreItems: true, totalItems: 1001 }),
      );

    await expect(
      resolveLatestApplicableQbzAct(
        "run-1",
        "al-decision-858",
        "2026-08-08",
        step,
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ kind: "navigation_mismatch" });
  });

  test("rejects non-unique exact acts after the bounded number search", async () => {
    const step: RequestStep = async (httpRequest) => {
      expect(httpRequest.role).toBe("alfresco-search");
      return liveArtifact(httpRequest, listing([exactLawEntry(), exactLawEntry()]));
    };

    await expect(
      resolveLatestApplicableQbzAct(
        "run-1",
        "al-law-79",
        "2026-08-08",
        step,
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ kind: "navigation_mismatch" });
  });

  test("rejects a consolidated version outside the exact act root", async () => {
    const step: RequestStep = async (httpRequest) => {
      if (httpRequest.role === "alfresco-search") {
        return liveArtifact(httpRequest, listing([exactLawEntry()]));
      }
      if (httpRequest.role === "alfresco-base-folder") {
        return liveArtifact(httpRequest, JSON.stringify({ entry: baseFolderEntry() }));
      }
      expect(httpRequest.role).toBe("alfresco-root-children");
      return liveArtifact(
        httpRequest,
        listing([
          {
            ...versionFolderEntry("cons-2025-07-14", versionId, "another-root"),
            path: { name: "/Company Home/Aktet/another-act", isComplete: true },
          },
        ]),
      );
    };

    await expect(
      resolveLatestApplicableQbzAct(
        "run-1",
        "al-law-79",
        "2026-08-08",
        step,
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ kind: "navigation_mismatch" });
  });

  test("rejects multiple PDF actVersions in the selected folder", async () => {
    const step: RequestStep = async (httpRequest) => {
      if (httpRequest.role === "alfresco-search") {
        return liveArtifact(httpRequest, listing([exactLawEntry()]));
      }
      if (httpRequest.role === "alfresco-base-folder") {
        return liveArtifact(httpRequest, JSON.stringify({ entry: baseFolderEntry() }));
      }
      if (httpRequest.role === "alfresco-root-children") {
        return liveArtifact(
          httpRequest,
          listing([versionFolderEntry("cons-2025-07-14")]),
        );
      }
      expect(httpRequest.role).toBe("alfresco-version-children");
      return liveArtifact(
        httpRequest,
        listing([pdfEntry(), pdfEntry("another-pdf")]),
      );
    };

    await expect(
      resolveLatestApplicableQbzAct(
        "run-1",
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
      if (httpRequest.role === "alfresco-search") {
        return liveArtifact(httpRequest, JSON.stringify({
          list: {
            pagination: {
              count: 1,
              hasMoreItems: false,
              totalItems: 1,
              skipCount: 0,
              maxItems: 1000,
            },
            entries: [{ entry: {
              id: "act-id",
              name: "ligj-2021-06-24-79.pdf",
              nodeType: "qbz:act",
              parentId: "base-id",
              isFile: true,
              isFolder: false,
              content: { mimeType: "application/pdf" },
              path: {
                name: "/Company Home/Aktet/ligj/kuvendi-i-shqiperise/2021/06/24/79/base",
                isComplete: true,
              },
              properties: {
                "qbz:actNumber": "79",
                "qbz:actActType": "http://qbz.gov.al/resource/authority/document-type/ligj",
                "qbz:url": "http://qbz.gov.al/eli/ligj/2021/06/24/79",
                "qbz:actType": "Akt bazë",
                "qbz:status": "Approved",
              },
            } }],
          },
        }));
      }
      if (httpRequest.role === "alfresco-base-folder") {
        return liveArtifact(httpRequest, JSON.stringify({
          entry: {
            id: "base-id",
            name: "base",
            nodeType: "cm:folder",
            parentId: "root-id",
            isFile: false,
            isFolder: true,
            path: {
              name: "/Company Home/Aktet/ligj/kuvendi-i-shqiperise/2021/06/24/79",
              isComplete: true,
            },
          },
        }));
      }
      if (httpRequest.role === "alfresco-root-children") {
        return liveArtifact(httpRequest, JSON.stringify({
          list: {
            pagination: {
              count: 1,
              hasMoreItems: false,
              totalItems: 1,
              skipCount: 0,
              maxItems: 1000,
            },
            entries: [{ entry: {
              id: "version-id",
              name: "cons-2025-07-14",
              nodeType: "cm:folder",
              parentId: "root-id",
              isFile: false,
              isFolder: true,
              path: {
                name: "/Company Home/Aktet/ligj/kuvendi-i-shqiperise/2021/06/24/79",
                isComplete: true,
              },
            } }],
          },
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
      "alfresco-search",
      "alfresco-base-folder",
      "alfresco-root-children",
    ]);
    expect(signals).toEqual([signal, signal, signal, signal]);
  });
});
