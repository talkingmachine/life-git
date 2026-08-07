import { extractPdfText } from "../pdf-text";
import type { Decision858Facts, ParseResult, ParserEntry } from "../contracts";
import {
  anchor,
  artifactByRole,
  entryHasValidIntegrity,
  normalizedText,
} from "./parser-support";

export function parseDecision858(entry: ParserEntry): ParseResult<Decision858Facts> {
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
  const extracted = extractPdfText(artifact.bytes);
  if (extracted === null) return { ok: false, kind: "semantic_mismatch" };
  const point8 = normalizedText(extracted.pages.get(8) ?? "");
  const amount = normalizedText(extracted.pages.get(23) ?? "");
  if (
    !/point 8\..*unless otherwise provided.*general rule/i.test(point8) ||
    !/self-declaration.*408\s*000\s+ALL.*persons depending/i.test(amount)
  ) {
    return { ok: false, kind: "semantic_mismatch" };
  }

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
