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
  runId: string,
  sourceId: QbzSourceId,
  role: string,
  method: "GET" | "POST",
  url: string,
  bodyBytes?: Uint8Array,
): HttpStepRequest {
  return {
    runId,
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
  runId: string,
  sourceId: QbzSourceId,
  assessmentDate: string,
  requestStep: RequestStep,
  signal: AbortSignal,
): Promise<CapturedEntry> {
  const policy = SOURCE_POLICIES[sourceId];
  const artifacts: LiveCapturedArtifact[] = [];
  const captureStep = async (request: HttpStepRequest): Promise<LiveCapturedArtifact> => {
    try {
      const artifact = await requestStep(request, signal);
      assertLive(artifact);
      artifacts.push(artifact);
      return artifact;
    } catch (error) {
      if (error instanceof SourceCaptureError) {
        Object.assign(error, { partialArtifacts: [...artifacts] });
      }
      throw error;
    }
  };
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

  const searchArtifact = await captureStep(
    jsonRequest(runId, sourceId, "eli-search", "POST", QBZ_SEARCH_URL, exactSearchBody),
  );
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

  const rootArtifact = await captureStep(
    jsonRequest(runId, sourceId, "eli-root", "GET", nodeUrl("/base")),
  );
  const root = parseListing(rootArtifact, artifacts);
  const versionNodes = root.items.filter(
    (item): item is Record<string, unknown> & { name: string; path: string } =>
      item.nodeType === "qbz:actVersion" &&
      typeof item.name === "string" &&
      /^cons-\d{4}-\d{2}-\d{2}$/.test(item.name) &&
      typeof item.path === "string",
  );
  if (versionNodes.some((item) => item.path !== `/base/${item.name}`)) {
    throw navigationError("QBZ consolidated version is outside the searched act root", artifacts);
  }
  const versions = versionNodes
    .filter(
      (item) => item.name.slice(5) <= assessmentDate,
    )
    .sort((left, right) => left.name.localeCompare(right.name));
  const latestName = versions.at(-1)?.name;
  if (latestName === undefined) {
    throw navigationError("QBZ has no applicable consolidated version", artifacts);
  }
  const latestVersions = versions.filter((item) => item.name === latestName);
  if (latestVersions.length !== 1) {
    throw navigationError("QBZ latest applicable consolidated version is not unique", artifacts);
  }
  const selected = latestVersions[0]!;

  const versionArtifact = await captureStep(
    jsonRequest(runId, sourceId, "eli-version", "GET", nodeUrl(selected.path)),
  );
  const version = parseListing(versionArtifact, artifacts);
  const pdfItems = version.items.filter(
    (item): item is Record<string, unknown> & { url: string } =>
      item.nodeType === "qbz:actVersion" &&
      item.name === selected.name &&
      item.path === selected.path &&
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

  await captureStep(
    {
      runId,
      sourceId,
      role: "act-pdf",
      method: "GET",
      url: pdfUrl,
      headers: { accept: "application/pdf" },
      allowedHosts: [QBZ_API_HOST],
      allowedMediaTypes: ["application/pdf"],
    },
  );

  return {
    sourceId,
    navigationUrl: policy.navigationUrl,
    indexedSourceUrl: policy.indexedSourceUrl,
    resolvedEvidenceUrl: pdfUrl,
    artifacts,
    versionHint: selected.name,
  };
}
