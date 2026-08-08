import { extractPdfText } from "../pdf-text";
import type { Law79Facts, ParseResult, ParserEntry } from "../contracts";
import {
  anchor,
  artifactByRole,
  entryHasValidIntegrity,
  normalizedText,
} from "./parser-support";

function includesAll(text: string, values: readonly string[]): boolean {
  const lower = text.toLowerCase();
  return values.every((value) => lower.includes(value));
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
  const article68 = findArticle("Article 68");
  const article3 = findArticle("Article 3(1)");
  const article41 = findArticle("Article 41");
  if (article68 === null || article3 === null || article41 === null) {
    return { ok: false, kind: "semantic_mismatch" };
  }
  const digitalWorkerPresent = includesAll(article68, [
    "article 68",
    "lawfully staying",
    "not more than one year",
    "foreign employment contract",
    "foreign service contract",
    "accommodation",
    "health insurance valid for at least one year",
    "country of origin",
    "country of residence",
  ]);
  const spousePresent = includesAll(article3, ["article 3(1)", "family member", "spouse"]);
  const familyStagingPresent = includesAll(article41, [
    "article 41",
    "not less than one year",
    "possibility of renewal",
    "normally be outside",
    "housing",
    "sickness insurance",
    "stable and regular resources",
  ]);
  if (!digitalWorkerPresent || !spousePresent || !familyStagingPresent) {
    return { ok: false, kind: "semantic_mismatch" };
  }

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
