import { load } from "cheerio";

import { SourceCaptureError } from "./gateway";
import { resolveLatestApplicableQbzAct } from "./qbz-navigation";
import type {
  CaptureRequest,
  CaptureResult,
  CapturedEntry,
  HttpStepRequest,
  LiveCapturedArtifact,
  OfficialSourcePort,
  RequestStep,
} from "../../research/contracts";
import { SOURCE_POLICIES } from "../../research/source-policy";

const decoder = new TextDecoder();

async function runStep(
  requestStep: RequestStep,
  request: HttpStepRequest,
  signal: AbortSignal,
): Promise<LiveCapturedArtifact> {
  const artifact = await requestStep(request, signal);
  if (artifact.origin !== "live") {
    throw new SourceCaptureError("navigation_mismatch", "Source step did not return a live artifact");
  }
  return artifact;
}

async function captureDirect(
  request: CaptureRequest,
  requestStep: RequestStep,
  policy: { readonly url: string; readonly host: string; readonly mediaType: string },
): Promise<CapturedEntry> {
  const artifact = await runStep(
    requestStep,
    {
      runId: request.runId,
      sourceId: request.sourceId,
      role: "official-document",
      method: "GET",
      url: policy.url,
      headers: { accept: policy.mediaType },
      allowedHosts: [policy.host],
      allowedMediaTypes: [policy.mediaType],
    },
    request.signal,
  );
  return {
    sourceId: request.sourceId,
    navigationUrl: policy.url,
    resolvedEvidenceUrl: artifact.responseUrl,
    artifacts: [artifact],
  };
}

async function captureTirana(
  request: CaptureRequest,
  requestStep: RequestStep,
): Promise<CapturedEntry> {
  const policy = SOURCE_POLICIES["tirana-urban-lines"];
  const page = await runStep(
    requestStep,
    {
      runId: request.runId,
      sourceId: request.sourceId,
      role: "municipality-page",
      method: "GET",
      url: policy.url,
      headers: { accept: policy.mediaType },
      allowedHosts: [policy.host],
      allowedMediaTypes: [policy.mediaType],
    },
    request.signal,
  );
  const $ = load(decoder.decode(page.bytes));
  const iframeUrls = $("iframe[src]")
    .map((_, iframe) => $(iframe).attr("src"))
    .get()
    .filter((value): value is string => value !== undefined);
  if (iframeUrls.length !== 1) {
    const error = new SourceCaptureError(
      "navigation_mismatch",
      "Municipal page must contain exactly one GIS iframe",
    );
    Object.assign(error, { partialArtifacts: [page] });
    throw error;
  }

  let iframeUrl: URL;
  try {
    iframeUrl = new URL(iframeUrls[0], policy.url);
  } catch {
    const error = new SourceCaptureError("navigation_mismatch", "Municipal GIS iframe URL is invalid");
    Object.assign(error, { partialArtifacts: [page] });
    throw error;
  }
  if (iframeUrl.protocol !== "https:" || iframeUrl.hostname.toLowerCase() !== policy.iframeHost) {
    const error = new SourceCaptureError(
      "navigation_mismatch",
      "Municipal GIS iframe is outside the official allowlist",
    );
    Object.assign(error, { partialArtifacts: [page] });
    throw error;
  }

  let gis: LiveCapturedArtifact;
  try {
    gis = await runStep(
      requestStep,
      {
        runId: request.runId,
        sourceId: request.sourceId,
        role: "municipal-gis-app",
        method: "GET",
        url: iframeUrl.href,
        headers: { accept: "text/html" },
        allowedHosts: [policy.iframeHost],
        allowedMediaTypes: ["text/html"],
      },
      request.signal,
    );
  } catch (error) {
    if (error instanceof SourceCaptureError) Object.assign(error, { partialArtifacts: [page] });
    throw error;
  }
  if (gis.responseUrl !== iframeUrl.href) {
    const error = new SourceCaptureError(
      "navigation_mismatch",
      "Municipal GIS artifact does not resolve to the exact iframe URL",
    );
    Object.assign(error, { partialArtifacts: [page, gis] });
    throw error;
  }
  return {
    sourceId: request.sourceId,
    navigationUrl: policy.url,
    resolvedEvidenceUrl: iframeUrl.href,
    artifacts: [page, gis],
    versionHint: gis.capturedAt,
  };
}

function exhaustiveSource(value: never): never {
  throw new Error(`Unsupported source: ${String(value)}`);
}

export class OfficialSourceAdapter implements OfficialSourcePort {
  async capture(request: CaptureRequest, requestStep: RequestStep): Promise<CaptureResult> {
    try {
      let entry: CapturedEntry;
      switch (request.sourceId) {
        case "al-law-79":
        case "al-decision-858":
          entry = await resolveLatestApplicableQbzAct(
            request.runId,
            request.sourceId,
            request.assessmentDate,
            requestStep,
            request.signal,
          );
          break;
        case "cbr-eur":
          entry = await captureDirect(request, requestStep, SOURCE_POLICIES["cbr-eur"]);
          break;
        case "boa-eur":
          entry = await captureDirect(request, requestStep, SOURCE_POLICIES["boa-eur"]);
          break;
        case "tirana-urban-lines":
          entry = await captureTirana(request, requestStep);
          break;
        default:
          return exhaustiveSource(request.sourceId);
      }
      return { ok: true, entry };
    } catch (error) {
      if (!(error instanceof SourceCaptureError)) throw error;
      const partialArtifacts = (
        error as SourceCaptureError & {
          readonly partialArtifacts?: readonly LiveCapturedArtifact[];
        }
      ).partialArtifacts ?? [];
      return {
        ok: false,
        sourceId: request.sourceId,
        kind: error.kind,
        attempts: 1,
        partialArtifacts,
      };
    }
  }
}

export async function captureCbrEur(
  request: CaptureRequest & { readonly sourceId: "cbr-eur" },
  requestStep: RequestStep,
): Promise<CaptureResult> {
  return new OfficialSourceAdapter().capture(request, requestStep);
}

export async function captureBoaEur(
  request: CaptureRequest & { readonly sourceId: "boa-eur" },
  requestStep: RequestStep,
): Promise<CaptureResult> {
  return new OfficialSourceAdapter().capture(request, requestStep);
}

export async function captureTiranaUrbanLines(
  request: CaptureRequest & { readonly sourceId: "tirana-urban-lines" },
  requestStep: RequestStep,
): Promise<CaptureResult> {
  return new OfficialSourceAdapter().capture(request, requestStep);
}
