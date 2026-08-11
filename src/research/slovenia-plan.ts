import type {
  ClaimKind,
  ColdStartEvidenceClaim,
  SloveniaSourceId,
} from "./cold-start-contracts";
import type { ParserEntry } from "./contracts";
import type { ResearchPlan, TerminalEvidenceEntry } from "./research-plan";
import { validateSloveniaEntry } from "./parsers/slovenia";
import { REQUIRED_CLAIM_KINDS } from "./country-registry";

const SOURCE_IDS = Object.freeze([
  "si-digital-nomad-route",
  "si-income-threshold",
  "si-companion-employment",
  "cbr-eur",
] as const satisfies readonly SloveniaSourceId[]);

const COUNTRY_SOURCE_IDS = SOURCE_IDS.filter(
  (sourceId): sourceId is Exclude<SloveniaSourceId, "cbr-eur"> => sourceId !== "cbr-eur",
);

function applySloveniaRules(
  entries: readonly TerminalEvidenceEntry<SloveniaSourceId, ColdStartEvidenceClaim>[],
): readonly TerminalEvidenceEntry<SloveniaSourceId, ColdStartEvidenceClaim>[] {
  const countryEntries = entries.filter((entry) => COUNTRY_SOURCE_IDS.includes(
    entry.sourceId as Exclude<SloveniaSourceId, "cbr-eur">,
  ));
  if (countryEntries.some((entry) => entry.coverage === "unavailable")) return entries;
  const claimKinds = countryEntries.flatMap((entry) => entry.coverage === "verified"
    ? entry.claims.flatMap((claim) => "claimKind" in claim ? [claim.claimKind] : [])
    : []);
  const completeUnique = claimKinds.length === REQUIRED_CLAIM_KINDS.length &&
    REQUIRED_CLAIM_KINDS.every((required) =>
      claimKinds.filter((claimKind) => claimKind === required).length === 1
    );
  if (!completeUnique) {
    return entries.map((entry) => {
      if (!COUNTRY_SOURCE_IDS.includes(
        entry.sourceId as Exclude<SloveniaSourceId, "cbr-eur">,
      )) return entry;
      return {
        sourceId: entry.sourceId,
        parserEntry: entry.parserEntry,
        coverage: "unavailable" as const,
        blocker: {
          sourceId: entry.sourceId,
          kind: "conflict" as const,
          navigationUrl: entry.parserEntry.navigationUrl,
          resolvedUrl: entry.parserEntry.resolvedEvidenceUrl,
          artifactIds: entry.parserEntry.artifacts.map((artifact) => artifact.artifactId),
        },
      };
    });
  }
  const order = new Map<ClaimKind, number>(
    REQUIRED_CLAIM_KINDS.map((claimKind, index) => [claimKind, index]),
  );
  return entries.map((entry) => entry.coverage === "verified"
    ? {
        ...entry,
        claims: [...entry.claims].sort((left, right) => {
          if (!("claimKind" in left) || !("claimKind" in right)) return 0;
          return order.get(left.claimKind)! - order.get(right.claimKind)!;
        }),
      }
    : entry);
}

export function createSloveniaPlan(
  sourceNavigation: Readonly<Record<SloveniaSourceId, string>>,
): ResearchPlan<SloveniaSourceId, ColdStartEvidenceClaim> {
  return Object.freeze({
    id: "vs2-slovenia@1",
    scope: "VS-2 Slovenia cold start",
    sourceIds: Object.freeze([...SOURCE_IDS]),
    sourceNavigation: Object.freeze({ ...sourceNavigation }),
    parserVersions: Object.freeze({
      "si-digital-nomad-route": "si-route@1",
      "si-income-threshold": "si-income@1",
      "si-companion-employment": "si-companion@1",
      "cbr-eur": "cbr-eur@1",
    }),
    rulesVersion: "vs2-evidence@1",
    limits: Object.freeze({ concurrency: 3, maxCaptures: 10, deadlineMs: 60_000 }),
    validate: async (
      entry: ParserEntry<SloveniaSourceId>,
      assessmentAt: string,
    ) => validateSloveniaEntry(entry, assessmentAt),
    applyRules: applySloveniaRules,
  });
}
