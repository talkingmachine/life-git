import { extractPdfText } from "../pdf-text";
import type { Decision858Facts, ParseResult, ParserEntry } from "../contracts";
import {
  anchor,
  artifactByRole,
  entryHasValidIntegrity,
  normalizedText,
} from "./parser-support";

const CURRENT_ALBANIAN_AMOUNT =
  "iii. vetedeklarim mbi disponimin e burimeve financiare te mjaftueshme per te mbajtur veten dhe personat ne ngarkim gjate qendrimit ne republiken e shqiperise, ne vlere jo me pak se 408 000 (katerqind e tete mije) leke, sipas aneksit nr. 10, qe i bashkelidhet ketij vendimi;";
const SUPPORTED_ENGLISH_POINT =
  "point 8. unless otherwise provided by this decision, the general rule applies.";
const SUPPORTED_ENGLISH_AMOUNT =
  "for the digital mobile worker, proof is a self-declaration of an available amount of 408 000 all for himself or herself and the persons depending on him or her.";

function folded(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
}

function uniqueSection(text: string, startPattern: RegExp, endPattern: RegExp): string | null {
  const normalized = normalizedText(text);
  const sourceText = folded(normalized);
  const starts = [...sourceText.matchAll(new RegExp(startPattern.source, "g"))];
  if (starts.length !== 1 || starts[0]?.index === undefined) return null;
  const start = starts[0].index;
  const end = new RegExp(endPattern.source).exec(sourceText.slice(start));
  if (end?.index === undefined || end.index === 0) return null;
  return normalized.slice(start, start + end.index);
}

function digitalWorkerItem(pages: readonly string[], amountPage: string): string {
  const documentText = pages.join("\n");
  const amountOffset = documentText.indexOf(amountPage);
  const itemMarkers = [...documentText.matchAll(/\b(?:item|pika)\s+gj\b/gi)]
    .filter((match) => (match.index ?? -1) <= amountOffset);
  const itemMarker = itemMarkers.at(-1);
  if (itemMarker?.index === undefined) return amountPage;

  const itemText = documentText.slice(itemMarker.index);
  const nextItem = /\b(?:item|pika)\s+(?!gj\b)[a-zçë]+\b/i.exec(
    itemText.slice(itemMarker[0].length),
  );
  const endOffset = nextItem === null
    ? itemText.length
    : itemMarker[0].length + (nextItem.index ?? 0);
  return normalizedText(itemText.slice(0, endOffset));
}

export async function parseDecision858(entry: ParserEntry): Promise<ParseResult<Decision858Facts>> {
  if (!entryHasValidIntegrity(entry)) {
    return { ok: false, kind: "integrity_mismatch" };
  }
  if (entry.sourceId !== "al-decision-858") return { ok: false, kind: "semantic_mismatch" };
  const artifact = artifactByRole(entry, "act-pdf");
  const versionHint = entry.versionHint;
  if (
    artifact === undefined ||
    artifact.mediaType !== "application/pdf" ||
    versionHint === undefined ||
    !/^cons-\d{4}-\d{2}-\d{2}$/.test(versionHint)
  ) {
    return { ok: false, kind: "semantic_mismatch" };
  }
  const extracted = await extractPdfText(artifact.bytes);
  if (extracted === null) return { ok: false, kind: "semantic_mismatch" };
  const pages = [...extracted.pages.values()].map(normalizedText);
  const point8Pages = pages.filter((page) => /point 8\./i.test(page));
  const amountPages = pages.filter((page) => /408\s*000\s+ALL/i.test(page));
  const englishPoint = point8Pages.length === 1 ? point8Pages[0]! : null;
  const englishAmount = amountPages.length === 1
    ? digitalWorkerItem(pages, amountPages[0]!)
    : null;
  const englishVerified = englishPoint !== null && englishAmount !== null &&
    folded(englishPoint) === SUPPORTED_ENGLISH_POINT &&
    folded(englishAmount).replace(/^item gj\.\s*/, "") === SUPPORTED_ENGLISH_AMOUNT;

  const albanianPointPages = pages.filter((page) =>
    folded(page).includes("me perjashtim te rasteve kur parashikohet ndryshe ne kete vendim")
  );
  const albanianAmountPages = pages.filter((page) => /408\s*000/i.test(page));
  const albanianPoint = albanianPointPages.length === 1
    ? uniqueSection(
      albanianPointPages[0]!,
      /\b10\.\s+per kategorite e lejeve\b/,
      /\b11\.\s/,
    )
    : null;
  const albanianWorkerItem = albanianAmountPages.length === 1
    ? uniqueSection(
      albanianAmountPages[0]!,
      /\bgj\)\s+dokumentacioni shtese per leje unike per punonjes levizes digjital\b/,
      /\bh\)\s/,
    )
    : null;
  const albanianAmount = albanianWorkerItem === null
    ? null
    : uniqueSection(
      albanianWorkerItem,
      /\biii\.\s+vetedeklarim mbi disponimin e burimeve financiare\b/,
      /\biv\.\s/,
    );
  const foldedPoint = folded(albanianPoint ?? "");
  const foldedAmount = folded(albanianAmount ?? "");
  const albanianVerified = albanianPoint !== null && albanianAmount !== null &&
    foldedPoint.includes("deshmi te burimeve te mjaftueshme financiare") &&
    foldedPoint.includes("me perjashtim te rasteve kur parashikohet ndryshe ne kete vendim") &&
    foldedAmount === CURRENT_ALBANIAN_AMOUNT;
  if (!englishVerified && !albanianVerified) {
    return { ok: false, kind: "semantic_mismatch" };
  }
  const point8 = englishVerified ? englishPoint! : albanianPoint!;
  const amount = englishVerified ? englishAmount! : albanianAmount!;

  return {
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
    sourcePeriod: versionHint,
    anchors: [
      anchor(artifact, "Decision 858, amount", amount),
      anchor(artifact, "Decision 858, p.8", point8),
    ],
  };
}
