import type {
  Claim,
  EvidenceBlocker,
  EvidenceSnapshot,
  LiveCapturedArtifact,
  OfficialSourcePort,
  ParseResult,
  ParserEntry,
  RequestStep,
  SourceId,
} from "./contracts";
import { parseBoaEur } from "./parsers/boa-eur";
import { parseCbrEur, fxPeriodsAreCurrent } from "./parsers/cbr-eur";
import { parseDecision858 } from "./parsers/decision-858";
import { parseLaw79 } from "./parsers/law-79";
import { parseTiranaUrbanLines } from "./parsers/tirana-urban-lines";
import {
  evidenceArtifactProvenance as genericEvidenceArtifactProvenance,
  runEvidencePlan,
  sealEvidencePlan,
  type EvidenceArtifactProvenance,
  type EvidenceIntegrity,
  type EvidenceWriteStore,
  type ResearchPlan,
  type SealEvidenceInput as PlanSealEvidenceInput,
  type SealedEvidence,
  type TerminalEvidenceEntry,
} from "./research-plan";
import { SOURCE_POLICIES } from "./source-policy";

export type {
  EvidenceArtifactProvenance,
  EvidenceIntegrity,
  EvidenceManifest,
  EvidenceWriteStore,
  ResearchPlan,
  SealedEvidence,
  TerminalEvidenceEntry,
} from "./research-plan";

export type SealEvidenceInput<
  S extends string = SourceId,
  C extends Claim<unknown, S> = Claim<unknown, S>,
> = Omit<PlanSealEvidenceInput<S, C>, "sourceIds">;

export const EVIDENCE_PARSER_VERSIONS = Object.freeze({
  // This is the first source-verified baseline. A future bump requires an explicit legacy dispatcher.
  "al-law-79": "law-79@1",
  "al-decision-858": "decision-858@1",
  "cbr-eur": "cbr-eur@1",
  "boa-eur": "boa-eur@1",
  "tirana-urban-lines": "tirana-urban-lines@1",
} satisfies Record<SourceId, string>);

export const EVIDENCE_RULES_VERSION = "vs1-evidence@1";

export const EVIDENCE_SOURCE_IDS = [
  "al-law-79",
  "al-decision-858",
  "cbr-eur",
  "boa-eur",
  "tirana-urban-lines",
] as const satisfies readonly SourceId[];

type EvidenceParser = (entry: ParserEntry) => ParseResult<unknown> | Promise<ParseResult<unknown>>;

export type EvidenceParsers = Record<SourceId, EvidenceParser>;

export const STANDARD_EVIDENCE_PARSERS: EvidenceParsers = {
  "al-law-79": parseLaw79,
  "al-decision-858": parseDecision858,
  "cbr-eur": parseCbrEur,
  "boa-eur": parseBoaEur,
  "tirana-urban-lines": parseTiranaUrbanLines,
};

export interface RunCurrentEvidenceInput {
  readonly runId: string;
  readonly assessmentDate: string;
  readonly deadlineAt: string;
}

export interface RunCurrentEvidencePorts {
  readonly source: OfficialSourcePort;
  readonly requestStep: RequestStep;
  readonly store: EvidenceWriteStore;
  readonly integrity: EvidenceIntegrity;
  readonly parsers?: EvidenceParsers;
}

function navigationUrl(sourceId: SourceId): string {
  const policy = SOURCE_POLICIES[sourceId];
  return "navigationUrl" in policy ? policy.navigationUrl : policy.url;
}

function unavailableEntry(
  sourceId: SourceId,
  kind: EvidenceBlocker["kind"],
  artifacts: readonly LiveCapturedArtifact[],
  parserEntry?: ParserEntry,
): TerminalEvidenceEntry {
  const navigation = parserEntry?.navigationUrl ?? navigationUrl(sourceId);
  const resolvedUrl = parserEntry?.resolvedEvidenceUrl ?? artifacts.at(-1)?.responseUrl;
  return {
    sourceId,
    parserEntry: parserEntry ?? {
      sourceId,
      navigationUrl: navigation,
      resolvedEvidenceUrl: resolvedUrl ?? navigation,
      artifacts,
    },
    coverage: "unavailable",
    blocker: {
      sourceId,
      kind,
      navigationUrl: navigation,
      ...(resolvedUrl === undefined ? {} : { resolvedUrl }),
      artifactIds: artifacts.map((artifact) => artifact.artifactId),
    },
  };
}

async function validateEvidenceEntry(
  entry: ParserEntry,
  parsers: EvidenceParsers,
): Promise<
  | { readonly ok: true; readonly claims: readonly Claim<unknown>[] }
  | {
      readonly ok: false;
      readonly kind: "integrity_mismatch" | "semantic_mismatch";
    }
> {
  const parsed = await parsers[entry.sourceId](entry);
  if (!parsed.ok) return parsed;
  if (parsed.anchors.length === 0) return { ok: false, kind: "semantic_mismatch" };
  return {
    ok: true,
    claims: parsed.anchors.map((anchor, index) => ({
      claimId: `${entry.sourceId}-facts-${index + 1}`,
      sourceId: entry.sourceId,
      value: parsed.facts,
      scope: "VS-1 confirmed-life",
      sourcePeriod: parsed.sourcePeriod,
      anchor,
      status: "verified",
    })),
  };
}

export async function parseEvidenceEntry(
  entry: ParserEntry,
  parsers: EvidenceParsers,
): Promise<TerminalEvidenceEntry> {
  const validated = await validateEvidenceEntry(entry, parsers);
  if (!validated.ok) {
    return unavailableEntry(
      entry.sourceId,
      validated.kind,
      entry.artifacts as readonly LiveCapturedArtifact[],
      entry,
    );
  }
  return {
    sourceId: entry.sourceId,
    parserEntry: entry,
    coverage: "verified",
    claims: validated.claims,
  };
}

export function applyEvidenceRules(
  entries: readonly TerminalEvidenceEntry[],
  assessmentDate: string,
): readonly TerminalEvidenceEntry[] {
  const cbr = entries.find((entry) => entry.sourceId === "cbr-eur");
  const boa = entries.find((entry) => entry.sourceId === "boa-eur");
  if (
    cbr?.coverage !== "verified" ||
    boa?.coverage !== "verified" ||
    fxPeriodsAreCurrent(
      cbr.claims[0]!.sourcePeriod,
      boa.claims[0]!.sourcePeriod,
      assessmentDate,
    )
  ) {
    return entries;
  }
  return entries.map((entry) =>
    entry.sourceId === "cbr-eur" || entry.sourceId === "boa-eur"
      ? unavailableEntry(
          entry.sourceId,
          "stale",
          entry.parserEntry.artifacts as readonly LiveCapturedArtifact[],
          entry.parserEntry,
        )
      : entry,
  );
}

export function createVs1ResearchPlan(
  parsers: EvidenceParsers,
): ResearchPlan<SourceId, Claim<unknown>> {
  return {
    id: "vs1-confirmed-life@1",
    scope: "VS-1 confirmed-life",
    sourceIds: EVIDENCE_SOURCE_IDS,
    sourceLineage: Object.freeze(Object.fromEntries(
      EVIDENCE_SOURCE_IDS.map((sourceId) => [sourceId, Object.freeze({
        navigationUrl: navigationUrl(sourceId),
      })]),
    ) as Record<SourceId, { readonly navigationUrl: string }>),
    parserVersions: EVIDENCE_PARSER_VERSIONS,
    rulesVersion: EVIDENCE_RULES_VERSION,
    limits: Object.freeze({ concurrency: 5, maxCaptures: 20, deadlineMs: 45_000 }),
    validate: (entry) => validateEvidenceEntry(entry, parsers),
    applyRules: applyEvidenceRules,
  };
}

export const VS1_RESEARCH_PLAN = Object.freeze(
  createVs1ResearchPlan(STANDARD_EVIDENCE_PARSERS),
);

export async function sealEvidence(
  input: SealEvidenceInput,
  integrity: EvidenceIntegrity,
): Promise<SealedEvidence> {
  return sealEvidencePlan({ ...input, sourceIds: EVIDENCE_SOURCE_IDS }, integrity);
}

export function evidenceArtifactProvenance(
  artifact: LiveCapturedArtifact,
): EvidenceArtifactProvenance {
  return genericEvidenceArtifactProvenance(artifact);
}

export async function runCurrentEvidence(
  input: RunCurrentEvidenceInput,
  ports: RunCurrentEvidencePorts,
): Promise<EvidenceSnapshot> {
  const plan = ports.parsers === undefined
    ? VS1_RESEARCH_PLAN
    : createVs1ResearchPlan(ports.parsers);
  return runEvidencePlan(input, plan, {
    source: ports.source,
    requestStep: ports.requestStep,
    store: ports.store,
    integrity: ports.integrity,
  });
}
