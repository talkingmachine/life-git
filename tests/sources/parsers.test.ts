import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

import { parseBoaEur } from "../../src/research/parsers/boa-eur";
import { fxPeriodsAreCurrent, parseCbrEur } from "../../src/research/parsers/cbr-eur";
import { parseDecision858 } from "../../src/research/parsers/decision-858";
import { parseLaw79 } from "../../src/research/parsers/law-79";
import { parseTiranaUrbanLines } from "../../src/research/parsers/tirana-urban-lines";
import type { ArtifactBytes, ParserEntry, SourceId } from "../../src/research/contracts";

function fixture(name: string): Uint8Array {
  return readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)));
}

function entry(
  sourceId: SourceId,
  artifacts: readonly ArtifactBytes[],
  versionHint?: string,
): ParserEntry {
  return {
    sourceId,
    navigationUrl: "https://official.example/navigation",
    resolvedEvidenceUrl: artifacts.at(-1)?.url ?? "https://official.example/evidence",
    artifacts,
    ...(versionHint === undefined ? {} : { versionHint }),
  };
}

function artifact(
  role: string,
  mediaType: string,
  bytes: Uint8Array,
  sha256: string,
): ArtifactBytes {
  return {
    artifactId: `fixture:${role}`,
    role,
    url: `https://official.example/${role}`,
    mediaType,
    bytes,
    sha256,
  };
}

describe("legal semantic parsers", () => {
  test("Law 79 keeps Art. 68, Art. 3(1), and Art. 41 facts and anchors separate", () => {
    const law = artifact(
      "act-pdf",
      "application/pdf",
      fixture("law-79.pdf"),
      "7a42a6bbc89aa6e604537e220f4070636d746376724c57f68a261435af7cd450",
    );

    const result = parseLaw79(entry("al-law-79", [law], "cons-2025-07-18"));

    expect(result).toEqual({
      ok: true,
      facts: {
        digitalWorker: {
          requiresLawfulStay: true,
          initialPermitMaxMonths: 12,
          contractTypes: ["foreign_employment", "foreign_service"],
          accommodation: true,
          insuranceMinMonths: 12,
          criminalRecords: "origin_and_residence",
        },
        family: {
          spouseIsFamilyMember: true,
          sponsorPermitMinMonths: 12,
          renewable: true,
          familyNormallyOutside: true,
          housingInsuranceStableIncome: true,
        },
      },
      sourcePeriod: "cons-2025-07-18",
      anchors: [
        expect.objectContaining({ artifactId: "fixture:act-pdf", locator: "Art. 68" }),
        expect.objectContaining({ artifactId: "fixture:act-pdf", locator: "Art. 3(1)" }),
        expect.objectContaining({ artifactId: "fixture:act-pdf", locator: "Art. 41" }),
      ],
    });
    expect(result).not.toHaveProperty("status");
  });

  test("Decision 858 preserves the 408000 ALL self-and-dependants statement without formulas", () => {
    const decision = artifact(
      "act-pdf",
      "application/pdf",
      fixture("decision-858.pdf"),
      "7ba60a22dc4753feb88c91df44e4ea25607f4752953f557abc04f36d735adda7",
    );

    const result = parseDecision858(
      entry("al-decision-858", [decision], "cons-2024-04-03"),
    );

    expect(result).toEqual({
      ok: true,
      facts: {
        proof: "self_declaration",
        availableAmount: "408000",
        currency: "ALL",
        scope: "self_and_dependants",
        periodFormula: "not_stated",
        headcountFormula: "not_stated",
        generalRuleExceptionAnchored: true,
      },
      sourcePeriod: "cons-2024-04-03",
      anchors: [
        expect.objectContaining({ artifactId: "fixture:act-pdf", locator: "Decision 858, amount" }),
        expect.objectContaining({ artifactId: "fixture:act-pdf", locator: "Decision 858, p.8" }),
      ],
    });
  });

  test("an exact-byte mismatch fails before legal semantics are accepted", () => {
    const bytes = fixture("law-79.pdf").slice();
    bytes[20] = bytes[20]! ^ 1;
    const changed = artifact(
      "act-pdf",
      "application/pdf",
      bytes,
      "7a42a6bbc89aa6e604537e220f4070636d746376724c57f68a261435af7cd450",
    );

    expect(parseLaw79(entry("al-law-79", [changed], "cons-2025-07-18"))).toEqual({
      ok: false,
      kind: "integrity_mismatch",
    });
  });

  test("valid bytes labeled as another official source fail semantically, not as corruption", () => {
    const law = artifact(
      "act-pdf",
      "application/pdf",
      fixture("law-79.pdf"),
      "7a42a6bbc89aa6e604537e220f4070636d746376724c57f68a261435af7cd450",
    );

    expect(parseLaw79(entry("cbr-eur", [law], "cons-2025-07-18"))).toEqual({
      ok: false,
      kind: "semantic_mismatch",
    });
  });

  test("valid Decision 858 bytes labeled as another source fail semantically", () => {
    const decision = artifact(
      "act-pdf",
      "application/pdf",
      fixture("decision-858.pdf"),
      "7ba60a22dc4753feb88c91df44e4ea25607f4752953f557abc04f36d735adda7",
    );

    expect(
      parseDecision858(entry("al-law-79", [decision], "cons-2024-04-03")),
    ).toEqual({ ok: false, kind: "semantic_mismatch" });
  });
});

describe("official FX semantic parsers", () => {
  test("CBR selects the dated EUR row from the archived exact XML bytes", () => {
    const bytes = readFileSync(
      fileURLToPath(
        new URL(
          "../../docs/changes/archive/vs-1-source-feasibility-spike/evidence/cbr-eur-2026-08-06.xml",
          import.meta.url,
        ),
      ),
    );
    const cbr = artifact(
      "official-document",
      "application/xml",
      bytes,
      "8648e667d42f8ec5b6fe4fe72e2947b64bc98c72389eb3c6770d8f4028b0440e",
    );

    expect(parseCbrEur(entry("cbr-eur", [cbr]))).toEqual({
      ok: true,
      facts: {
        base: "EUR",
        quote: "RUB",
        nominal: "1",
        rate: "93.1901",
        effectiveDate: "2026-08-06",
      },
      sourcePeriod: "2026-08-06",
      anchors: [expect.objectContaining({ artifactId: "fixture:official-document", locator: "Valute[CharCode=EUR]" })],
    });
  });

  test("BoA selects EUR and its date rather than the first number on the page", () => {
    const boa = artifact(
      "official-document",
      "text/html",
      fixture("boa-eur.html"),
      "d9c1b9946bac88f32984e63e2043db406254d36dea72ea134c877604509b376d",
    );

    expect(parseBoaEur(entry("boa-eur", [boa]))).toEqual({
      ok: true,
      facts: {
        base: "EUR",
        quote: "ALL",
        rate: "96.12",
        effectiveDate: "2026-08-07",
      },
      sourcePeriod: "2026-08-07",
      anchors: [expect.objectContaining({ artifactId: "fixture:official-document", locator: "table row EUR" })],
    });
  });

  test("FX periods must be no more than three days old and at most one day apart", () => {
    expect(fxPeriodsAreCurrent("2026-08-06", "2026-08-07", "2026-08-08")).toBe(true);
    expect(fxPeriodsAreCurrent("2026-08-04", "2026-08-07", "2026-08-08")).toBe(false);
    expect(fxPeriodsAreCurrent("2026-08-04", "2026-08-05", "2026-08-08")).toBe(false);
  });

  test("HTTP 200 bytes without the expected official semantics fail closed", () => {
    const shell = artifact(
      "official-document",
      "text/html",
      fixture("semantic-shell.html"),
      "f6a877ea03c0d161b209a2fc9e52d2d429c1542f30b3112cd96c657d1cb871bb",
    );

    expect(parseBoaEur(entry("boa-eur", [shell]))).toEqual({
      ok: false,
      kind: "semantic_mismatch",
    });
  });

  test("valid CBR bytes labeled as another source fail semantically", () => {
    const bytes = readFileSync(
      fileURLToPath(
        new URL(
          "../../docs/changes/archive/vs-1-source-feasibility-spike/evidence/cbr-eur-2026-08-06.xml",
          import.meta.url,
        ),
      ),
    );
    const cbr = artifact(
      "official-document",
      "application/xml",
      bytes,
      "8648e667d42f8ec5b6fe4fe72e2947b64bc98c72389eb3c6770d8f4028b0440e",
    );

    expect(parseCbrEur(entry("boa-eur", [cbr]))).toEqual({
      ok: false,
      kind: "semantic_mismatch",
    });
  });

  test("valid BoA bytes labeled as another source fail semantically", () => {
    const boa = artifact(
      "official-document",
      "text/html",
      fixture("boa-eur.html"),
      "d9c1b9946bac88f32984e63e2043db406254d36dea72ea134c877604509b376d",
    );

    expect(parseBoaEur(entry("cbr-eur", [boa]))).toEqual({
      ok: false,
      kind: "semantic_mismatch",
    });
  });
});

describe("Tirana municipal urban-lines parser", () => {
  test("requires the municipal publication and both visible named WMS layers", () => {
    const page = artifact(
      "municipality-page",
      "text/html",
      fixture("tirana-page.html"),
      "8c6e61d9f232870e60bd17b76ae0ee5e97098e9b7aa996d997c79c954d901f5c",
    );
    const gis = artifact(
      "municipal-gis-app",
      "text/html",
      fixture("tirana-gis.html"),
      "0fe834aa191ada8f06e22db87870cddbf5772e7054f764b2a12f46573fd34d4b",
    );

    const result = parseTiranaUrbanLines(
      entry("tirana-urban-lines", [page, gis], "2026-08-08T10:00:00.000Z"),
    );

    expect(result).toEqual({
      ok: true,
      facts: {
        municipalUrbanRoutesMapPublished: true,
        applicationTitle: "Transporti",
        layers: ["Linjat Qytetase", "Stacionet e Linjave Qytetase"],
        checkedAt: "2026-08-08T10:00:00.000Z",
      },
      sourcePeriod: "2026-08-08",
      anchors: [
        expect.objectContaining({ artifactId: "fixture:municipality-page", locator: "municipality page iframe" }),
        expect.objectContaining({ artifactId: "fixture:municipal-gis-app", locator: "visible WMS layers" }),
      ],
    });
    expect(result.ok && result.facts).not.toHaveProperty("transportQuality");
  });

  test("one GIS artifact alone cannot prove municipal publication", () => {
    const gis = artifact(
      "municipal-gis-app",
      "text/html",
      fixture("tirana-gis.html"),
      "0fe834aa191ada8f06e22db87870cddbf5772e7054f764b2a12f46573fd34d4b",
    );

    expect(
      parseTiranaUrbanLines(
        entry("tirana-urban-lines", [gis], "2026-08-08T10:00:00.000Z"),
      ),
    ).toEqual({ ok: false, kind: "semantic_mismatch" });
  });

  test("valid Tirana bytes labeled as another source fail semantically", () => {
    const page = artifact(
      "municipality-page",
      "text/html",
      fixture("tirana-page.html"),
      "8c6e61d9f232870e60bd17b76ae0ee5e97098e9b7aa996d997c79c954d901f5c",
    );
    const gis = artifact(
      "municipal-gis-app",
      "text/html",
      fixture("tirana-gis.html"),
      "0fe834aa191ada8f06e22db87870cddbf5772e7054f764b2a12f46573fd34d4b",
    );

    expect(
      parseTiranaUrbanLines(
        entry("boa-eur", [page, gis], "2026-08-08T10:00:00.000Z"),
      ),
    ).toEqual({ ok: false, kind: "semantic_mismatch" });
  });
});
