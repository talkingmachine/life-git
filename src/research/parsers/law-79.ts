import { extractPdfText } from "../pdf-text";
import type { Law79Facts, ParseResult, ParserEntry } from "../contracts";
import {
  anchor,
  artifactByRole,
  entryHasValidIntegrity,
  normalizedText,
} from "./parser-support";

function includesAll(text: string, values: readonly string[]): boolean {
  const folded = text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  return values.every((value) => folded.includes(value));
}

function albanianSection(documentText: string, article: number): string | null {
  const normalized = normalizedText(documentText);
  const folded = normalized.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  const starts = [...folded.matchAll(new RegExp(`\\bneni ${article}\\b`, "g"))];
  if (starts.length !== 1 || starts[0]?.index === undefined) return null;
  const start = starts[0].index;
  const next = new RegExp(`\\bneni ${article + 1}\\b`).exec(folded.slice(start));
  if (next?.index === undefined) return null;
  return normalized.slice(start, start + next.index);
}

export async function parseLaw79(entry: ParserEntry): Promise<ParseResult<Law79Facts>> {
  if (!entryHasValidIntegrity(entry)) {
    return { ok: false, kind: "integrity_mismatch" };
  }
  if (entry.sourceId !== "al-law-79") return { ok: false, kind: "semantic_mismatch" };
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

  const findArticle = (article: string): string | null => {
    const matches = [...extracted.pages.values()]
      .map(normalizedText)
      .filter((page) => page.toLowerCase().includes(article.toLowerCase()));
    return matches.length === 1 ? matches[0]! : null;
  };
  const english = {
    article68: findArticle("Article 68"),
    article3: findArticle("Article 3(1)"),
    article41: findArticle("Article 41"),
  };
  const albanian = {
    article68: albanianSection(extracted.text, 68),
    article3: albanianSection(extracted.text, 3),
    article41: albanianSection(extracted.text, 41),
  };
  const englishVerified = english.article68 !== null && english.article3 !== null &&
    english.article41 !== null && includesAll(english.article68, [
      "article 68",
      "lawfully staying",
      "not more than one year",
      "foreign employment contract",
      "foreign service contract",
      "accommodation",
      "health insurance valid for at least one year",
      "country of origin",
      "country of residence",
    ]) && includesAll(english.article3, ["article 3(1)", "family member", "spouse"]) &&
    includesAll(english.article41, [
      "article 41",
      "not less than one year",
      "possibility of renewal",
      "normally be outside",
      "housing",
      "sickness insurance",
      "stable and regular resources",
    ]);
  const albanianVerified = albanian.article68 !== null && albanian.article3 !== null &&
    albanian.article41 !== null && includesAll(albanian.article68, [
      "neni 68",
      "leje unike qendrimi per punonjes levizes digjital",
      "me afat deri ne 1 vit",
      "me qendrim te ligjshem",
      "kontrate te vlefshme punesimi me punedhenesin jashte shtetit",
      "kontrate sherbimi me kontraktuesin ose porositesin jashte shtetit",
      "deshmi te akomodimit dhe adreses",
      "police te sigurimit shendetesor te vlefshme per te pakten 1 vit",
      "deshmi penaliteti nga vendi i tij i origjines",
      "ne vendin ku eshte rezident",
    ]) && includesAll(albanian.article3, [
      "neni 3",
      "anetare te familjes se te huajit",
      "bashkeshorti/bashkeshortja",
    ]) && includesAll(albanian.article41, [
      "neni 41",
      "anetaret e familjes se tij ndodhen jashte territorit",
      "leje qendrimi me afat se paku 1-vjecar",
      "ka mundesi ta riperterije lejen",
      "siguron strehim",
      "sigurim shendetesor",
      "burime te qendrueshme te te ardhurave financiare",
    ]);
  if (!englishVerified && !albanianVerified) {
    return { ok: false, kind: "semantic_mismatch" };
  }
  const article68 = englishVerified ? english.article68! : albanian.article68!;
  const article3 = englishVerified ? english.article3! : albanian.article3!;
  const article41 = englishVerified ? english.article41! : albanian.article41!;

  return {
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
    sourcePeriod: versionHint,
    anchors: [
      anchor(artifact, "Art. 68", article68),
      anchor(artifact, "Art. 3(1)", article3),
      anchor(artifact, "Art. 41", article41),
    ],
  };
}
