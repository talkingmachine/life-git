import { XMLParser } from "fast-xml-parser";

import type { CbrEurFacts, DecimalString, ParseResult, ParserEntry } from "../contracts";
import { anchor, artifactByRole, entryHasValidIntegrity } from "./parser-support";

function isoDateFromDotted(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(value);
  return match === null ? null : `${match[3]}-${match[2]}-${match[1]}`;
}

function decimal(value: unknown): DecimalString | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const normalized = String(value).replace(",", ".");
  return /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(normalized) && Number(normalized) > 0
    ? (normalized as DecimalString)
    : null;
}

export function parseCbrEur(entry: ParserEntry): ParseResult<CbrEurFacts> {
  if (!entryHasValidIntegrity(entry)) {
    return { ok: false, kind: "integrity_mismatch" };
  }
  if (entry.sourceId !== "cbr-eur") return { ok: false, kind: "semantic_mismatch" };
  const artifact = artifactByRole(entry, "official-document");
  if (artifact === undefined || artifact.mediaType !== "application/xml") {
    return { ok: false, kind: "semantic_mismatch" };
  }
  try {
    const parsed = new XMLParser({ ignoreAttributes: false }).parse(artifact.bytes) as {
      ValCurs?: { "@_Date"?: unknown; Valute?: unknown };
    };
    const effectiveDate = isoDateFromDotted(parsed.ValCurs?.["@_Date"]);
    const rows = Array.isArray(parsed.ValCurs?.Valute)
      ? parsed.ValCurs.Valute
      : parsed.ValCurs?.Valute === undefined
        ? []
        : [parsed.ValCurs.Valute];
    const matches = rows.filter(
      (row): row is Record<string, unknown> =>
        typeof row === "object" && row !== null && (row as Record<string, unknown>).CharCode === "EUR",
    );
    const row = matches.length === 1 ? matches[0] : undefined;
    const rate = decimal(row?.VunitRate ?? row?.Value);
    if (effectiveDate === null || row?.Nominal !== 1 || rate === null) {
      return { ok: false, kind: "semantic_mismatch" };
    }
    const excerpt = `Date=${effectiveDate};CharCode=EUR;Nominal=1;Rate=${rate}`;
    return {
      ok: true,
      facts: { base: "EUR", quote: "RUB", nominal: "1", rate, effectiveDate },
      sourcePeriod: effectiveDate,
      anchors: [anchor(artifact, "Valute[CharCode=EUR]", excerpt)],
    };
  } catch {
    return { ok: false, kind: "semantic_mismatch" };
  }
}

function dayNumber(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const milliseconds = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isNaN(milliseconds) ? null : milliseconds / 86_400_000;
}

export function fxPeriodsAreCurrent(
  cbrPeriod: string,
  boaPeriod: string,
  assessmentDate: string,
): boolean {
  const cbr = dayNumber(cbrPeriod);
  const boa = dayNumber(boaPeriod);
  const assessment = dayNumber(assessmentDate);
  if (cbr === null || boa === null || assessment === null) return false;
  return (
    cbr <= assessment &&
    boa <= assessment &&
    assessment - cbr <= 3 &&
    assessment - boa <= 3 &&
    Math.abs(cbr - boa) <= 1
  );
}
