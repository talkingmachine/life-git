import { SourceCaptureError } from "./gateway";
import type {
  CapturedEntry,
  HttpStepRequest,
  LiveCapturedArtifact,
  RequestStep,
} from "../../research/contracts";
import { SOURCE_POLICIES, type QbzSourceId } from "../../research/source-policy";

const QBZ_API_HOST = "qbz.gov.al";
const QBZ_SEARCH_URL = "https://qbz.gov.al/api/eli/search";
const encoder = new TextEncoder();
const decoder = new TextDecoder();

interface JsonListing {
  readonly hasMoreItems: boolean;
  readonly items: readonly Record<string, unknown>[];
}

function navigationError(
  message: string,
  partialArtifacts: readonly LiveCapturedArtifact[],
): SourceCaptureError {
  const error = new SourceCaptureError("navigation_mismatch", message);
  Object.assign(error, { partialArtifacts });
  return error;
}

function parseListing(
  artifact: LiveCapturedArtifact,
  partialArtifacts: readonly LiveCapturedArtifact[],
): JsonListing {
  try {
    const parsed = JSON.parse(decoder.decode(artifact.bytes)) as Partial<JsonListing>;
    if (
      typeof parsed.hasMoreItems !== "boolean" ||
      !Array.isArray(parsed.items) ||
      parsed.hasMoreItems
    ) {
      throw new Error("listing is paginated or malformed");
    }
    return parsed as JsonListing;
  } catch {
    throw navigationError("QBZ returned a malformed or paginated listing", partialArtifacts);
  }
}

function nodeUrl(path: string): string {
  return `https://qbz.gov.al/api/eli/node?path=${encodeURIComponent(path)}`;
}

function jsonRequest(
  sourceId: QbzSourceId,
  role: string,
  method: "GET" | "POST",
  url: string,
  bodyBytes?: Uint8Array,
): HttpStepRequest {
  return {
    sourceId,
    role,
    method,
    url,
    headers: {
      accept: "application/json",
      ...(method === "POST" ? { "content-type": "application/json" } : {}),
    },
    ...(bodyBytes === undefined
      ? {}
      : { bodyMediaType: "application/json" as const, bodyBytes }),
    allowedHosts: [QBZ_API_HOST],
    allowedMediaTypes: ["application/json"],
  };
}

function assertLive(artifact: LiveCapturedArtifact): void {
  if (artifact.origin !== "live") {
    throw new SourceCaptureError("navigation_mismatch", "Source step did not return a live artifact");
  }
}

export async function resolveLatestApplicableQbzAct(
  sourceId: QbzSourceId,
  assessmentDate: string,
  requestStep: RequestStep,
  signal: AbortSignal,
): Promise<CapturedEntry> {
  const policy = SOURCE_POLICIES[sourceId];
  const artifacts: LiveCapturedArtifact[] = [];
  const exactSearchBody = encoder.encode(
    JSON.stringify({
      nodeType: "qbz:act",
      path: "/base",
      actNumber: policy.actNumber,
      actDate: policy.actDate,
      actType: policy.actType,
      "qbz:url": policy.indexedSourceUrl,
    }),
  );

  const searchArtifact = await requestStep(
    jsonRequest(sourceId, "eli-search", "POST", QBZ_SEARCH_URL, exactSearchBody),
    signal,
  );
  assertLive(searchArtifact);
  artifacts.push(searchArtifact);
  const search = parseListing(searchArtifact, artifacts);
  const matches = search.items.filter(
    (item) =>
      item.nodeType === "qbz:act" &&
      item.path === "/base" &&
      item.actNumber === policy.actNumber &&
      item.actDate === policy.actDate &&
      item.actType === policy.actType &&
      item["qbz:url"] === policy.indexedSourceUrl,
  );
  if (matches.length !== 1) {
    throw navigationError("QBZ exact ELI search did not return one base act", artifacts);
  }

  const rootArtifact = await requestStep(
    jsonRequest(sourceId, "eli-root", "GET", nodeUrl("/base")),
    signal,
  );
  assertLive(rootArtifact);
  artifacts.push(rootArtifact);
  const root = parseListing(rootArtifact, artifacts);
  const versions = root.items
    .filter(
      (item): item is Record<string, unknown> & { name: string; path: string } =>
        item.nodeType === "qbz:actVersion" &&
        typeof item.name === "string" &&
        /^cons-\d{4}-\d{2}-\d{2}$/.test(item.name) &&
        item.name.slice(5) <= assessmentDate &&
        typeof item.path === "string",
    )
    .sort((left, right) => left.name.localeCompare(right.name));
  const selected = versions.at(-1);
  if (selected === undefined) {
    throw navigationError("QBZ has no applicable consolidated version", artifacts);
  }

  const versionArtifact = await requestStep(
    jsonRequest(sourceId, "eli-version", "GET", nodeUrl(selected.path)),
    signal,
  );
  assertLive(versionArtifact);
  artifacts.push(versionArtifact);
  const version = parseListing(versionArtifact, artifacts);
  const pdfItems = version.items.filter(
    (item): item is Record<string, unknown> & { url: string } =>
      item.nodeType === "qbz:actVersion" &&
      item.mediaType === "application/pdf" &&
      typeof item.url === "string",
  );
  if (pdfItems.length !== 1) {
    throw navigationError("QBZ consolidated version did not contain one PDF", artifacts);
  }
  const pdfUrl = pdfItems[0].url;
  let pdfHost: string;
  try {
    pdfHost = new URL(pdfUrl).hostname.toLowerCase();
  } catch {
    throw navigationError("QBZ PDF URL is invalid", artifacts);
  }
  if (pdfHost !== QBZ_API_HOST) {
    throw navigationError("QBZ PDF URL leaves the official host", artifacts);
  }

  const pdfArtifact = await requestStep(
    {
      sourceId,
      role: "act-pdf",
      method: "GET",
      url: pdfUrl,
      headers: { accept: "application/pdf" },
      allowedHosts: [QBZ_API_HOST],
      allowedMediaTypes: ["application/pdf"],
    },
    signal,
  );
  assertLive(pdfArtifact);
  artifacts.push(pdfArtifact);

  return {
    sourceId,
    navigationUrl: policy.navigationUrl,
    indexedSourceUrl: policy.indexedSourceUrl,
    resolvedEvidenceUrl: pdfUrl,
    artifacts,
    versionHint: selected.name,
  };
}
