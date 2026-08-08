import { load } from "cheerio";

import type { ParseResult, ParserEntry, TiranaTransitFacts } from "../contracts";
import { anchor, artifactByRole, entryHasValidIntegrity, normalizedText } from "./parser-support";

const LAYERS = ["Linjat Qytetase", "Stacionet e Linjave Qytetase"] as const;

export function parseTiranaUrbanLines(entry: ParserEntry): ParseResult<TiranaTransitFacts> {
  if (!entryHasValidIntegrity(entry)) {
    return { ok: false, kind: "integrity_mismatch" };
  }
  if (entry.sourceId !== "tirana-urban-lines") {
    return { ok: false, kind: "semantic_mismatch" };
  }
  const page = artifactByRole(entry, "municipality-page");
  const gis = artifactByRole(entry, "municipal-gis-app");
  const checkedAt = entry.versionHint;
  if (
    page === undefined ||
    gis === undefined ||
    page.mediaType !== "text/html" ||
    gis.mediaType !== "text/html" ||
    checkedAt === undefined ||
    Number.isNaN(Date.parse(checkedAt))
  ) {
    return { ok: false, kind: "semantic_mismatch" };
  }
  const municipality = load(new TextDecoder().decode(page.bytes));
  const iframeSources = municipality("iframe[src]")
    .map((_, iframe) => municipality(iframe).attr("src"))
    .get();
  if (
    iframeSources.length !== 1 ||
    (() => {
      try {
        const url = new URL(iframeSources[0]!);
        return url.protocol !== "https:" || url.hostname !== "gis.tirana.al";
      } catch {
        return true;
      }
    })()
  ) {
    return { ok: false, kind: "semantic_mismatch" };
  }

  const application = load(new TextDecoder().decode(gis.bytes));
  if (gis.url !== iframeSources[0]) return { ok: false, kind: "semantic_mismatch" };
  if (normalizedText(application("title").text()) !== "Transporti") {
    return { ok: false, kind: "semantic_mismatch" };
  }
  const visibleWmsLayers = application('[data-service="WMS"][data-visible="true"]')
    .map((_, layer) => normalizedText(application(layer).text()))
    .get();
  if (
    visibleWmsLayers.length !== LAYERS.length ||
    !LAYERS.every((layer) => visibleWmsLayers.includes(layer))
  ) {
    return { ok: false, kind: "semantic_mismatch" };
  }
  const checkedDate = new Date(checkedAt).toISOString().slice(0, 10);
  return {
    ok: true,
    facts: {
      municipalUrbanRoutesMapPublished: true,
      applicationTitle: "Transporti",
      layers: LAYERS,
      checkedAt,
    },
    sourcePeriod: checkedDate,
    anchors: [
      anchor(page, "municipality page iframe", iframeSources[0]!),
      anchor(gis, "visible WMS layers", visibleWmsLayers.join(";")),
    ],
  };
}
