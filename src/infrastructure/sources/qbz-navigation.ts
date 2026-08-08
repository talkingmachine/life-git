import { SourceCaptureError } from "./gateway";
import type {
  CapturedEntry,
  HttpStepRequest,
  LiveCapturedArtifact,
  RequestStep,
} from "../../research/contracts";
import { SOURCE_POLICIES, type QbzSourceId } from "../../research/source-policy";

const QBZ_API_HOST = "qbz.gov.al";
const QBZ_SEARCH_URL =
  "https://qbz.gov.al/alfresco/api/-default-/public/search/versions/1/search";
const QBZ_NODES_URL =
  "https://qbz.gov.al/alfresco/api/-default-/public/alfresco/versions/1/nodes";
const MAX_ITEMS = 1000;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

type JsonObject = Record<string, unknown>;

function navigationError(
  message: string,
  partialArtifacts: readonly LiveCapturedArtifact[],
): SourceCaptureError {
  const error = new SourceCaptureError("navigation_mismatch", message);
  Object.assign(error, { partialArtifacts });
  return error;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseListing(
  artifact: LiveCapturedArtifact,
  partialArtifacts: readonly LiveCapturedArtifact[],
): readonly JsonObject[] {
  try {
    const parsed: unknown = JSON.parse(decoder.decode(artifact.bytes));
    if (!isObject(parsed) || !isObject(parsed.list)) throw new Error("missing list");
    const { pagination, entries } = parsed.list;
    if (!isObject(pagination) || !Array.isArray(entries)) throw new Error("missing page");
    if (
      pagination.hasMoreItems !== false ||
      pagination.skipCount !== 0 ||
      pagination.maxItems !== MAX_ITEMS ||
      pagination.count !== entries.length ||
      pagination.totalItems !== entries.length
    ) {
      throw new Error("listing is paginated or malformed");
    }
    return entries.map((item) => {
      if (!isObject(item) || !isObject(item.entry)) throw new Error("malformed entry");
      return item.entry;
    });
  } catch {
    throw navigationError("QBZ returned a malformed or paginated listing", partialArtifacts);
  }
}

function parseEntry(
  artifact: LiveCapturedArtifact,
  partialArtifacts: readonly LiveCapturedArtifact[],
): JsonObject {
  try {
    const parsed: unknown = JSON.parse(decoder.decode(artifact.bytes));
    if (!isObject(parsed) || !isObject(parsed.entry)) throw new Error("missing entry");
    return parsed.entry;
  } catch {
    throw navigationError("QBZ returned a malformed node", partialArtifacts);
  }
}

function nodeUrl(nodeId: string, suffix = ""): string {
  return `${QBZ_NODES_URL}/${encodeURIComponent(nodeId)}${suffix}`;
}

function childrenUrl(nodeId: string): string {
  return nodeUrl(
    nodeId,
    `/children?include=path%2Cproperties&maxItems=${MAX_ITEMS}&skipCount=0`,
  );
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

function objectProperty(item: JsonObject, key: string): JsonObject | undefined {
  const value = item[key];
  return isObject(value) ? value : undefined;
}

function stringProperty(item: JsonObject, key: string): string | undefined {
  const value = item[key];
  return typeof value === "string" ? value : undefined;
}

function exactActRootPattern(sourceId: QbzSourceId): RegExp {
  const policy = SOURCE_POLICIES[sourceId];
  const [year, month, day] = policy.actDate.split("-");
  return new RegExp(
    `^/Company Home/Aktet/${policy.actType}/[^/]+/${year}/${month}/${day}/${policy.actNumber}$`,
  );
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
  if (!/^\d{4}-\d{2}-\d{2}$/.test(assessmentDate)) {
    throw navigationError("Assessment date is invalid", artifacts);
  }

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

  const searchBody = encoder.encode(JSON.stringify({
    query: {
      language: "afts",
      query: `=qbz\\:actNumber:'${policy.actNumber}'`,
    },
    paging: { maxItems: MAX_ITEMS, skipCount: 0 },
    include: ["properties", "path"],
  }));
  const searchArtifact = await captureStep(
    jsonRequest(runId, sourceId, "alfresco-search", "POST", QBZ_SEARCH_URL, searchBody),
  );
  const actRootPattern = exactActRootPattern(sourceId);
  const exactActs = parseListing(searchArtifact, artifacts).filter((item) => {
    const content = objectProperty(item, "content");
    const path = objectProperty(item, "path");
    const properties = objectProperty(item, "properties");
    const pathName = path === undefined ? undefined : stringProperty(path, "name");
    return (
      item.nodeType === "qbz:act" &&
      item.isFile === true &&
      item.isFolder === false &&
      content?.mimeType === "application/pdf" &&
      path?.isComplete === true &&
      pathName !== undefined &&
      pathName.endsWith("/base") &&
      actRootPattern.test(pathName.slice(0, -5)) &&
      properties?.["qbz:actNumber"] === policy.actNumber &&
      properties?.["qbz:actActType"] ===
        `http://qbz.gov.al/resource/authority/document-type/${policy.actType}` &&
      properties?.["qbz:url"] === policy.indexedSourceUrl &&
      properties?.["qbz:actType"] === "Akt bazë" &&
      properties?.["qbz:status"] === "Approved" &&
      typeof item.id === "string" &&
      typeof item.parentId === "string"
    );
  });
  if (exactActs.length !== 1) {
    throw navigationError("QBZ exact act search did not return one base act", artifacts);
  }

  const exactAct = exactActs[0]!;
  const exactActPath = objectProperty(exactAct, "path")!;
  const rootPath = stringProperty(exactActPath, "name")!.slice(0, -5);
  const baseFolderId = stringProperty(exactAct, "parentId")!;
  const baseArtifact = await captureStep(
    jsonRequest(
      runId,
      sourceId,
      "alfresco-base-folder",
      "GET",
      nodeUrl(baseFolderId, "?include=path"),
    ),
  );
  const baseFolder = parseEntry(baseArtifact, artifacts);
  const basePath = objectProperty(baseFolder, "path");
  const rootId = stringProperty(baseFolder, "parentId");
  if (
    baseFolder.id !== baseFolderId ||
    baseFolder.name !== "base" ||
    baseFolder.nodeType !== "cm:folder" ||
    baseFolder.isFolder !== true ||
    baseFolder.isFile !== false ||
    rootId === undefined ||
    basePath?.isComplete !== true ||
    basePath.name !== rootPath
  ) {
    throw navigationError("QBZ base folder did not match the exact act", artifacts);
  }

  const rootArtifact = await captureStep(
    jsonRequest(
      runId,
      sourceId,
      "alfresco-root-children",
      "GET",
      childrenUrl(rootId),
    ),
  );
  const versionNamePattern = /^cons-\d{4}-\d{2}-\d{2}$/;
  const namedVersions = parseListing(rootArtifact, artifacts).filter(
    (item) => typeof item.name === "string" && versionNamePattern.test(item.name),
  );
  const malformedVersion = namedVersions.some((item) => {
    const path = objectProperty(item, "path");
    return !(
      item.nodeType === "cm:folder" &&
      item.isFolder === true &&
      item.isFile === false &&
      item.parentId === rootId &&
      typeof item.id === "string" &&
      path?.isComplete === true &&
      path.name === rootPath
    );
  });
  if (malformedVersion) {
    throw navigationError("QBZ consolidated version is outside the exact act root", artifacts);
  }

  const applicableVersions = namedVersions
    .filter((item) => (item.name as string).slice(5) <= assessmentDate)
    .sort((left, right) => (left.name as string).localeCompare(right.name as string));
  const latestName = applicableVersions.at(-1)?.name as string | undefined;
  if (latestName === undefined) {
    throw navigationError("QBZ has no applicable consolidated version", artifacts);
  }
  const latestVersions = applicableVersions.filter((item) => item.name === latestName);
  if (latestVersions.length !== 1) {
    throw navigationError("QBZ latest applicable consolidated version is not unique", artifacts);
  }
  const selected = latestVersions[0]!;
  const selectedId = stringProperty(selected, "id")!;

  const versionArtifact = await captureStep(
    jsonRequest(
      runId,
      sourceId,
      "alfresco-version-children",
      "GET",
      childrenUrl(selectedId),
    ),
  );
  const versionEntries = parseListing(versionArtifact, artifacts);
  const actVersions = versionEntries.filter((item) => item.nodeType === "qbz:actVersion");
  if (actVersions.length !== 1) {
    throw navigationError("QBZ consolidated version did not contain one PDF actVersion", artifacts);
  }
  const pdf = actVersions[0]!;
  const pdfContent = objectProperty(pdf, "content");
  const pdfPath = objectProperty(pdf, "path");
  const pdfProperties = objectProperty(pdf, "properties");
  const pdfId = stringProperty(pdf, "id");
  const pdfName = stringProperty(pdf, "name");
  if (
    pdfId === undefined ||
    pdfName === undefined ||
    !/\.pdf$/i.test(pdfName) ||
    pdf.isFile !== true ||
    pdf.isFolder !== false ||
    pdf.parentId !== selectedId ||
    pdfContent?.mimeType !== "application/pdf" ||
    pdfPath?.isComplete !== true ||
    pdfPath.name !== `${rootPath}/${latestName}` ||
    typeof pdfProperties?.["qbz:url"] !== "string" ||
    !pdfProperties["qbz:url"].startsWith(`${policy.indexedSourceUrl}/cons/`)
  ) {
    throw navigationError("QBZ PDF actVersion did not match the selected folder", artifacts);
  }

  const pdfUrl = nodeUrl(pdfId, "/content");
  await captureStep({
    runId,
    sourceId,
    role: "act-pdf",
    method: "GET",
    url: pdfUrl,
    headers: { accept: "application/pdf" },
    allowedHosts: [QBZ_API_HOST],
    allowedMediaTypes: ["application/pdf"],
  });

  return {
    sourceId,
    navigationUrl: policy.navigationUrl,
    indexedSourceUrl: policy.indexedSourceUrl,
    resolvedEvidenceUrl: pdfUrl,
    artifacts,
    versionHint: latestName,
  };
}
