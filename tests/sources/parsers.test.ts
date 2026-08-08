import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

import { extractPdfText } from "../../src/research/pdf-text";
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
  url = `https://official.example/${role}`,
): ArtifactBytes {
  return {
    artifactId: `fixture:${role}`,
    role,
    url,
    mediaType,
    bytes,
    sha256,
  };
}

function artifactWithComputedHash(
  role: string,
  mediaType: string,
  bytes: Uint8Array,
  url?: string,
): ArtifactBytes {
  return artifact(
    role,
    mediaType,
    bytes,
    createHash("sha256").update(bytes).digest("hex"),
    url,
  );
}

function validTextPdf(pages: readonly { logicalPage: number; text: string }[]): Uint8Array {
  const encoder = new TextEncoder();
  const objectCount = 3 + pages.length * 2;
  const pageIds = pages.map((_, index) => 3 + index);
  const fontId = 3 + pages.length;
  const contentIds = pages.map((_, index) => fontId + 1 + index);
  const parts: string[] = [];
  const offsets = new Array<number>(objectCount + 1).fill(0);
  let byteLength = 0;
  const append = (value: string): void => {
    parts.push(value);
    byteLength += encoder.encode(value).byteLength;
  };
  const object = (id: number, body: string, prefix = ""): void => {
    append(prefix);
    offsets[id] = byteLength;
    append(`${id} 0 obj\n${body}\nendobj\n`);
  };
  const escapePdfText = (value: string): string =>
    value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");

  append("%PDF-1.7\n");
  object(1, "<< /Type /Catalog /Pages 2 0 R >>");
  object(2, `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`);
  pages.forEach((page, index) => {
    object(
      pageIds[index]!,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentIds[index]} 0 R >>`,
      `%%Page: ${page.logicalPage} ${index + 1}\n`,
    );
  });
  object(fontId, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  pages.forEach((page, index) => {
    const content = `BT /F1 3 Tf 50 750 Td (${escapePdfText(page.text)}) Tj ET`;
    object(contentIds[index]!, `<< /Length ${encoder.encode(content).byteLength} >>\nstream\n${content}\nendstream`);
  });
  const xrefOffset = byteLength;
  append(`xref\n0 ${objectCount + 1}\n0000000000 65535 f \n`);
  for (let id = 1; id <= objectCount; id += 1) {
    append(`${String(offsets[id]).padStart(10, "0")} 00000 n \n`);
  }
  append(`trailer\n<< /Size ${objectCount + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);
  return encoder.encode(parts.join(""));
}

const DECISION_POINT_8 =
  "Point 8. Unless otherwise provided by this decision, the general rule applies.";
const DECISION_AMOUNT =
  "For the digital mobile worker, proof is a self-declaration of an available amount of 408 000 ALL for himself or herself and the persons depending on him or her.";

test("extracts TJ text from every page of a realistic compressed PDF", async () => {
  const extracted = await extractPdfText(fixture("law-79-realistic.pdf"));

  expect(extracted?.pages.size).toBe(3);
  expect(extracted?.pages.get(1)).toContain("Article 3(1)");
  expect(extracted?.pages.get(2)).toContain("Article 41");
  expect(extracted?.pages.get(3)).toContain("Article 68");
});

describe("legal semantic parsers", () => {
  test("Law 79 keeps Art. 68, Art. 3(1), and Art. 41 facts and anchors separate", async () => {
    const law = artifact(
      "act-pdf",
      "application/pdf",
      fixture("law-79-realistic.pdf"),
      "40ab28611c0da8e058613e4b6e4e5ef2b0a1e3f9f47ce6a773c1800a975913d8",
    );

    const result = await parseLaw79(entry("al-law-79", [law], "cons-2025-07-18"));

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

  test("Decision 858 preserves the 408000 ALL self-and-dependants statement without formulas", async () => {
    const decision = artifactWithComputedHash(
      "act-pdf",
      "application/pdf",
      validTextPdf([
        { logicalPage: 8, text: DECISION_POINT_8 },
        { logicalPage: 23, text: DECISION_AMOUNT },
      ]),
    );

    const result = await parseDecision858(
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

  test("an exact-byte mismatch fails before legal semantics are accepted", async () => {
    const bytes = fixture("law-79-realistic.pdf").slice();
    bytes[20] = bytes[20]! ^ 1;
    const changed = artifact(
      "act-pdf",
      "application/pdf",
      bytes,
      "40ab28611c0da8e058613e4b6e4e5ef2b0a1e3f9f47ce6a773c1800a975913d8",
    );

    expect(await parseLaw79(entry("al-law-79", [changed], "cons-2025-07-18"))).toEqual({
      ok: false,
      kind: "integrity_mismatch",
    });
  });

  test("valid bytes labeled as another official source fail semantically, not as corruption", async () => {
    const law = artifact(
      "act-pdf",
      "application/pdf",
      fixture("law-79-realistic.pdf"),
      "40ab28611c0da8e058613e4b6e4e5ef2b0a1e3f9f47ce6a773c1800a975913d8",
    );

    expect(await parseLaw79(entry("cbr-eur", [law], "cons-2025-07-18"))).toEqual({
      ok: false,
      kind: "semantic_mismatch",
    });
  });

  test("valid Decision 858 bytes labeled as another source fail semantically", async () => {
    const decision = artifactWithComputedHash(
      "act-pdf",
      "application/pdf",
      validTextPdf([
        { logicalPage: 8, text: DECISION_POINT_8 },
        { logicalPage: 23, text: DECISION_AMOUNT },
      ]),
    );

    expect(
      await parseDecision858(entry("al-law-79", [decision], "cons-2024-04-03")),
    ).toEqual({ ok: false, kind: "semantic_mismatch" });
  });

  test("Decision 858 rejects an explicit period formula", async () => {
    const decision = artifactWithComputedHash(
      "act-pdf",
      "application/pdf",
      validTextPdf([
        { logicalPage: 8, text: DECISION_POINT_8 },
        { logicalPage: 23, text: `${DECISION_AMOUNT} The amount is required per month.` },
      ]),
    );

    expect(
      await parseDecision858(entry("al-decision-858", [decision], "cons-2024-04-03")),
    ).toEqual({ ok: false, kind: "semantic_mismatch" });
  });

  test("Decision 858 rejects an explicit dependant headcount formula", async () => {
    const decision = artifactWithComputedHash(
      "act-pdf",
      "application/pdf",
      validTextPdf([
        { logicalPage: 8, text: DECISION_POINT_8 },
        { logicalPage: 23, text: `${DECISION_AMOUNT} Multiply the amount by each dependant.` },
      ]),
    );

    expect(
      await parseDecision858(entry("al-decision-858", [decision], "cons-2024-04-03")),
    ).toEqual({ ok: false, kind: "semantic_mismatch" });
  });

  test("Decision 858 rejects a period formula continuing on the next page of item gj", async () => {
    const decision = artifactWithComputedHash(
      "act-pdf",
      "application/pdf",
      validTextPdf([
        { logicalPage: 8, text: DECISION_POINT_8 },
        { logicalPage: 23, text: `Item gj. ${DECISION_AMOUNT}` },
        { logicalPage: 24, text: "The amount is required per month." },
        { logicalPage: 25, text: "Item h. A separate residence provision begins here." },
      ]),
    );

    expect(
      await parseDecision858(entry("al-decision-858", [decision], "cons-2024-04-03")),
    ).toEqual({ ok: false, kind: "semantic_mismatch" });
  });

  test("Decision 858 ignores period formulas in a later unrelated item", async () => {
    const decision = artifactWithComputedHash(
      "act-pdf",
      "application/pdf",
      validTextPdf([
        { logicalPage: 8, text: DECISION_POINT_8 },
        { logicalPage: 23, text: `Item gj. ${DECISION_AMOUNT}` },
        { logicalPage: 24, text: "Item h. A different residence amount is required per month." },
      ]),
    );

    expect(
      await parseDecision858(entry("al-decision-858", [decision], "cons-2024-04-03")),
    ).toMatchObject({
      ok: true,
      facts: { periodFormula: "not_stated", headcountFormula: "not_stated" },
    });
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

  test("BoA rejects a EUR row from a table not denominated in ALL", () => {
    const bytes = new TextEncoder().encode(
      '<time datetime="2026-08-07">7 August 2026</time><table><tr><th>Currency</th><th>Rate in USD</th></tr><tr><td>EUR</td><td>1.17</td></tr></table>',
    );
    const boa = artifactWithComputedHash("official-document", "text/html", bytes);

    expect(parseBoaEur(entry("boa-eur", [boa]))).toEqual({
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
      "https://gis.tirana.al/transporti",
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
      "https://gis.tirana.al/transporti",
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
      "https://gis.tirana.al/transporti",
    );

    expect(
      parseTiranaUrbanLines(
        entry("boa-eur", [page, gis], "2026-08-08T10:00:00.000Z"),
      ),
    ).toEqual({ ok: false, kind: "semantic_mismatch" });
  });

  test("rejects an extra visible WMS layer beyond the two named layers", () => {
    const page = artifact(
      "municipality-page",
      "text/html",
      fixture("tirana-page.html"),
      "8c6e61d9f232870e60bd17b76ae0ee5e97098e9b7aa996d997c79c954d901f5c",
    );
    const bytes = new TextEncoder().encode(
      new TextDecoder()
        .decode(fixture("tirana-gis.html"))
        .replace("</ul>", '<li data-service="WMS" data-visible="true">Experimental Layer</li></ul>'),
    );
    const gis = artifactWithComputedHash(
      "municipal-gis-app",
      "text/html",
      bytes,
      "https://gis.tirana.al/transporti",
    );

    expect(
      parseTiranaUrbanLines(
        entry("tirana-urban-lines", [page, gis], "2026-08-08T10:00:00.000Z"),
      ),
    ).toEqual({ ok: false, kind: "semantic_mismatch" });
  });

  test("rejects a GIS artifact resolved from a different URL than the municipal iframe", () => {
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
      "https://gis.tirana.al/other-map",
    );

    expect(
      parseTiranaUrbanLines(
        entry("tirana-urban-lines", [page, gis], "2026-08-08T10:00:00.000Z"),
      ),
    ).toEqual({ ok: false, kind: "semantic_mismatch" });
  });
});
