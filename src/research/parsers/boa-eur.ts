import { load } from "cheerio";

import type { BoaEurFacts, DecimalString, ParseResult, ParserEntry } from "../contracts";
import { anchor, artifactByRole, entryHasValidIntegrity, normalizedText } from "./parser-support";

export function parseBoaEur(entry: ParserEntry): ParseResult<BoaEurFacts> {
  if (!entryHasValidIntegrity(entry)) {
    return { ok: false, kind: "integrity_mismatch" };
  }
  if (entry.sourceId !== "boa-eur") return { ok: false, kind: "semantic_mismatch" };
  const artifact = artifactByRole(entry, "official-document");
  if (artifact === undefined || artifact.mediaType !== "text/html") {
    return { ok: false, kind: "semantic_mismatch" };
  }
  const $ = load(new TextDecoder().decode(artifact.bytes));
  const dateValues = $("time[datetime]")
    .map((_, element) => $(element).attr("datetime"))
    .get()
    .filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value));
  const officialTables = $("table")
    .map((_, table) => {
      const headers = $(table).find("tr").first().find("th,td")
        .map((__, cell) => normalizedText($(cell).text()))
        .get();
      const currencyColumn = headers.findIndex((header) => header.toLowerCase() === "currency");
      const allRateColumn = headers.findIndex((header) => /\bALL\b/i.test(header));
      return currencyColumn >= 0 && allRateColumn >= 0
        ? { table, currencyColumn, allRateColumn }
        : null;
    })
    .get()
    .filter((value) => value !== null);
  if (dateValues.length !== 1 || officialTables.length !== 1) {
    return { ok: false, kind: "semantic_mismatch" };
  }
  const officialTable = officialTables[0]!;
  const eurRows = $(officialTable.table).find("tr")
    .filter((_, row) => {
      const cells = $(row).find("th,td").map((__, cell) => normalizedText($(cell).text())).get();
      return cells[officialTable.currencyColumn] === "EUR";
    })
    .toArray();
  if (eurRows.length !== 1) return { ok: false, kind: "semantic_mismatch" };
  const cells = $(eurRows[0]).find("th,td").map((_, cell) => normalizedText($(cell).text())).get();
  const rateText = cells[officialTable.allRateColumn]?.replace(",", ".") ?? "";
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(rateText) || Number(rateText) <= 0) {
    return { ok: false, kind: "semantic_mismatch" };
  }
  const effectiveDate = dateValues[0]!;
  const excerpt = `EUR ${rateText} ALL; ${effectiveDate}`;
  return {
    ok: true,
    facts: {
      base: "EUR",
      quote: "ALL",
      rate: rateText as DecimalString,
      effectiveDate,
    },
    sourcePeriod: effectiveDate,
    anchors: [anchor(artifact, "table row EUR", excerpt)],
  };
}
