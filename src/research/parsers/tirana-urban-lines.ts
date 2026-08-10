import { load } from "cheerio";

import type { ParseResult, ParserEntry, TiranaTransitFacts } from "../contracts";
import { anchor, artifactByRole, entryHasValidIntegrity, normalizedText } from "./parser-support";

const LAYERS = ["Linjat Qytetase", "Stacionet e Linjave Qytetase"] as const;
const CURRENT_TITLE = "Transporti - Public GIS Portal";

function occurrenceCount(value: string, pattern: RegExp): number {
  return value.match(pattern)?.length ?? 0;
}

function currentVisibleWmsLayers(script: string): readonly string[] {
  const groupStartPattern = /title\s*:\s*['"]Transporti Publik Urban['"]/g;
  const nextGroupPattern = /title\s*:\s*['"]Transporti Publik Rrethqytetas['"]/g;
  if (
    occurrenceCount(script, groupStartPattern) !== 1 ||
    occurrenceCount(script, nextGroupPattern) !== 1
  ) return [];

  const start = script.search(groupStartPattern);
  const next = script.search(nextGroupPattern);
  if (start < 0 || next <= start) return [];
  const urbanGroup = script.slice(start, next);
  const requiredLayerProperties = [
    /title\s*:\s*['"]Linjat Qytetase['"]/g,
    /title\s*:\s*['"]Stacionet e Linjave Qytetase['"]/g,
    /['"]LAYERS['"]\s*:\s*['"]nexus_gis_tirana:Linjat Qytetase['"]/g,
    /['"]LAYERS['"]\s*:\s*['"]nexus_gis_tirana:Stacionet e linjave Qytetase['"]/g,
  ];
  const hasExactUrbanGroup = requiredLayerProperties.every(
    (pattern) => occurrenceCount(urbanGroup, pattern) === 1,
  ) && occurrenceCount(urbanGroup, /new\s+ol\.layer\.Tile\s*\(/g) === 2 &&
    occurrenceCount(urbanGroup, /new\s+ol\.source\.TileWMS\s*\(/g) === 2 &&
    occurrenceCount(urbanGroup, /visible\s*:\s*true/g) === 3 &&
    occurrenceCount(urbanGroup, /visible\s*:\s*false/g) === 0 &&
    occurrenceCount(urbanGroup, /title\s*:/g) === 3;
  return hasExactUrbanGroup ? LAYERS : [];
}

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
  const sourceTitle = normalizedText(application("title").text());
  if (sourceTitle !== "Transporti" && sourceTitle !== CURRENT_TITLE) {
    return { ok: false, kind: "semantic_mismatch" };
  }
  const legacyVisibleWmsLayers = application('[data-service="WMS"][data-visible="true"]')
    .map((_, layer) => normalizedText(application(layer).text()))
    .get();
  const visibleWmsLayers = legacyVisibleWmsLayers.length > 0
    ? legacyVisibleWmsLayers
    : currentVisibleWmsLayers(application("script").map((_, node) => application(node).text()).get().join("\n"));
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
