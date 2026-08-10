import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

import type { ArtifactBytes, ParserEntry } from "../../src/research/contracts";
import { parseTiranaUrbanLines } from "../../src/research/parsers/tirana-urban-lines";
import { SOURCE_POLICIES } from "../../src/research/source-policy";

const CURRENT_PAGE_URL = "https://tirana.al/pikat-e-interesit/linjat-urbane";
const CURRENT_GIS_URL = "https://gis.tirana.al/NexusPublicPortal/PublicPortal/AppCreator/ViewApplication/8c5d9f93-7156-4708-bdef-1aea93b95d4e?mode=iframe&culture=en";

function fixture(name: string): Uint8Array {
  return readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)));
}

function artifact(role: string, bytes: Uint8Array, url: string): ArtifactBytes {
  return {
    artifactId: `current:${role}`,
    role,
    url,
    mediaType: "text/html",
    sha256: createHash("sha256").update(bytes).digest("hex"),
    bytes,
  };
}

function currentEntry(gisBytes = fixture("tirana-current-gis.html")): ParserEntry {
  return {
    sourceId: "tirana-urban-lines",
    navigationUrl: CURRENT_PAGE_URL,
    resolvedEvidenceUrl: CURRENT_GIS_URL,
    versionHint: "2026-08-08T10:00:00.000Z",
    artifacts: [
      artifact("municipality-page", fixture("tirana-current-page.html"), CURRENT_PAGE_URL),
      artifact("municipal-gis-app", gisBytes, CURRENT_GIS_URL),
    ],
  };
}

describe("current Tirana municipal urban-lines publication", () => {
  test("uses the current official municipal navigation URL", () => {
    expect(SOURCE_POLICIES["tirana-urban-lines"].url).toBe(CURRENT_PAGE_URL);
  });

  test("verifies the current official urban WMS group", () => {
    expect(parseTiranaUrbanLines(currentEntry())).toEqual({
      ok: true,
      facts: {
        municipalUrbanRoutesMapPublished: true,
        applicationTitle: "Transporti",
        layers: ["Linjat Qytetase", "Stacionet e Linjave Qytetase"],
        checkedAt: "2026-08-08T10:00:00.000Z",
      },
      sourcePeriod: "2026-08-08",
      anchors: [
        expect.objectContaining({
          artifactId: "current:municipality-page",
          locator: "municipality page iframe",
        }),
        expect.objectContaining({
          artifactId: "current:municipal-gis-app",
          locator: "visible WMS layers",
        }),
      ],
    });
  });

  test("does not verify the claim when a required current GIS layer is hidden", () => {
    const hiddenStation = new TextEncoder().encode(
      new TextDecoder().decode(fixture("tirana-current-gis.html"))
        .replace(
          /(title: 'Stacionet e Linjave Qytetase',\s*visible:) true,/,
          "$1 false,",
        ),
    );

    expect(parseTiranaUrbanLines(currentEntry(hiddenStation))).toEqual({
      ok: false,
      kind: "semantic_mismatch",
    });
  });
});
