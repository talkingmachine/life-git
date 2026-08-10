import { load } from "cheerio";

import type { BoaEurFacts, DecimalString, ParseResult, ParserEntry } from "../contracts";
import { anchor, artifactByRole, entryHasValidIntegrity, normalizedText } from "./parser-support";

function isoDateFromDotted(value: string): string | null {
  const match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(value);
  return match === null ? null : `${match[3]}-${match[2]}-${match[1]}`;
}

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
  const titles = $("title")
    .map((_, element) => normalizedText($(element).text()))
    .get()
    .filter((value) => value.toLowerCase() === "official exchange rate");
  const timeDates = $("time[datetime]")
    .map((_, element) => $(element).attr("datetime"))
    .get()
    .filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value));
  const officialTables = $("table")
    .map((_, table) => {
      const currentHeader = normalizedText($(table).find("thead").first().text());
      if (
        /\bMain Currency\b/i.test(currentHeader) &&
        /\bAlbanian Lek per Foreign Currency Unit\b/i.test(currentHeader)
      ) {
        const updateMatch = /^Last update:\s*(\d{2}\.\d{2}\.\d{4})\b/i.exec(
          normalizedText($(table).prev().text()),
        );
        const effectiveDate = updateMatch === null ? null : isoDateFromDotted(updateMatch[1]!);
        return {
          table,
          kind: "current" as const,
          dateValues: effectiveDate === null ? [] : [effectiveDate],
        };
      }
      const headers = $(table).find("tr").first().find("th,td")
        .map((__, cell) => normalizedText($(cell).text()))
        .get();
      const currencyColumn = headers.findIndex((header) => header.toLowerCase() === "currency");
      const allRateColumn = headers.findIndex((header) => /\bALL\b/i.test(header));
      return currencyColumn >= 0 && allRateColumn >= 0
        ? { table, kind: "legacy" as const, currencyColumn, allRateColumn, dateValues: timeDates }
        : null;
    })
    .get()
    .filter((value) => value !== null);
  if (titles.length !== 1 || officialTables.length !== 1) {
    return { ok: false, kind: "semantic_mismatch" };
  }
  const officialTable = officialTables[0]!;
  const dateValues = [...new Set(officialTable.dateValues)];
  if (dateValues.length !== 1) return { ok: false, kind: "semantic_mismatch" };
  const eurRates = $(officialTable.table).find("tr")
    .map((_, row) => {
      const cells = $(row).find("th,td").map((__, cell) => normalizedText($(cell).text())).get();
      if (officialTable.kind === "legacy") {
        return cells[officialTable.currencyColumn] === "EUR"
          ? cells[officialTable.allRateColumn]
          : null;
      }
      const currencyColumns = cells
        .map((cell, index) => cell === "EUR" ? index : -1)
        .filter((index) => index >= 0);
      return currencyColumns.length === 1 ? cells[currencyColumns[0]! + 1] : null;
    })
    .get()
    .filter((value): value is string => typeof value === "string");
  if (eurRates.length !== 1) return { ok: false, kind: "semantic_mismatch" };
  const rateText = eurRates[0]!.replace(",", ".");
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
