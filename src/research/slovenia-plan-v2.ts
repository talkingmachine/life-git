import { types } from "node:util";

import type { ClaimKind, SloveniaSourceId } from "./cold-start-contracts";
import {
  SLOVENIA_V2_EVIDENCE_RULES_VERSION,
  SLOVENIA_V2_PARTICIPANT_SCOPE_ORDER,
  SLOVENIA_V2_PARSER_VERSIONS,
  SLOVENIA_V2_RESEARCH_SCOPE,
  SLOVENIA_V2_SOURCE_ORDER,
  sloveniaV2ClaimIdentity,
  sloveniaV2ClaimScopeToken,
  type ColdStartEvidenceClaimV2,
} from "./cold-start-contracts-v2";
import type { ParserEntry } from "./contracts";
import { REQUIRED_CLAIM_KINDS } from "./country-registry";
import { validateSloveniaV2Entry } from "./parsers/slovenia-v2";
import type {
  ResearchPlan,
  ResearchSourceLineage,
  TerminalEvidenceEntry,
} from "./research-plan";

export {
  SLOVENIA_V2_EVIDENCE_RULES_VERSION,
  SLOVENIA_V2_PARSER_VERSIONS,
  SLOVENIA_V2_RESEARCH_SCOPE,
  SLOVENIA_V2_SOURCE_ORDER,
} from "./cold-start-contracts-v2";

const KIND_ORDER = new Map<ClaimKind, number>(
  REQUIRED_CLAIM_KINDS.map((kind, index) => [kind, index]),
);
function compareClaims(
  left: ColdStartEvidenceClaimV2,
  right: ColdStartEvidenceClaimV2,
): number {
  if (!("claimKind" in left) || !("claimKind" in right)) return 0;
  const kindDifference = KIND_ORDER.get(left.claimKind)! - KIND_ORDER.get(right.claimKind)!;
  if (kindDifference !== 0) return kindDifference;
  const leftScope = sloveniaV2ClaimScopeToken(left.claimKind, left.value);
  const rightScope = sloveniaV2ClaimScopeToken(right.claimKind, right.value);
  if (leftScope === undefined || rightScope === undefined) return 0;
  return SLOVENIA_V2_PARTICIPANT_SCOPE_ORDER.indexOf(leftScope) -
    SLOVENIA_V2_PARTICIPANT_SCOPE_ORDER.indexOf(rightScope);
}

function unavailable(
  entry: TerminalEvidenceEntry<SloveniaSourceId, ColdStartEvidenceClaimV2>,
  kind: "semantic_mismatch" | "conflict",
): TerminalEvidenceEntry<SloveniaSourceId, ColdStartEvidenceClaimV2> {
  return {
    sourceId: entry.sourceId,
    parserEntry: entry.parserEntry,
    coverage: "unavailable",
    blocker: {
      sourceId: entry.sourceId,
      kind,
      navigationUrl: entry.parserEntry.navigationUrl,
      resolvedUrl: entry.parserEntry.resolvedEvidenceUrl,
      artifactIds: entry.parserEntry.artifacts.map(({ artifactId }) => artifactId),
    },
  };
}

function applySloveniaV2Rules(
  entries: readonly TerminalEvidenceEntry<SloveniaSourceId, ColdStartEvidenceClaimV2>[],
): readonly TerminalEvidenceEntry<SloveniaSourceId, ColdStartEvidenceClaimV2>[] {
  const identities = entries.flatMap((entry) => entry.coverage === "verified"
    ? entry.claims.map((claim) => ({
        identity: "claimKind" in claim
          ? sloveniaV2ClaimIdentity(claim.claimKind, claim.value)
          : claim.claimId,
        sourceId: entry.sourceId,
      }))
    : []);
  const conflictingSources = new Set(identities.flatMap(({ identity }) => {
    const owners = identities.filter((candidate) => candidate.identity === identity);
    return owners.length > 1 ? owners.map(({ sourceId }) => sourceId) : [];
  }));
  return SLOVENIA_V2_SOURCE_ORDER.map((sourceId) => {
    const entry = entries.find((candidate) => candidate.sourceId === sourceId);
    if (entry === undefined) throw new Error("non_terminal_evidence");
    if (entry.coverage === "unavailable") return entry;
    if (entry.claims.length === 0) return unavailable(entry, "semantic_mismatch");
    if (conflictingSources.has(sourceId)) return unavailable(entry, "conflict");
    return {
      sourceId: entry.sourceId,
      parserEntry: entry.parserEntry,
      coverage: "verified",
      claims: [...entry.claims].sort(compareClaims),
    };
  });
}

function snapshotLineage(
  sourceLineage: Readonly<Record<SloveniaSourceId, ResearchSourceLineage>>,
): Readonly<Record<SloveniaSourceId, ResearchSourceLineage>> {
  if (
    types.isProxy(sourceLineage) ||
    (Object.getPrototypeOf(sourceLineage) !== Object.prototype &&
      Object.getPrototypeOf(sourceLineage) !== null) ||
    Object.getOwnPropertySymbols(sourceLineage).length !== 0
  ) throw new Error("integrity_mismatch");
  const descriptors = Object.getOwnPropertyDescriptors(sourceLineage);
  const actualKeys = Object.keys(descriptors).sort();
  const expectedKeys = [...SLOVENIA_V2_SOURCE_ORDER].sort();
  if (
    actualKeys.length !== expectedKeys.length ||
    actualKeys.some((key, index) => key !== expectedKeys[index])
  ) throw new Error("integrity_mismatch");
  return Object.freeze(Object.fromEntries(SLOVENIA_V2_SOURCE_ORDER.map((sourceId) => {
    const descriptor = descriptors[sourceId];
    if (
      descriptor === undefined || !("value" in descriptor) ||
      !descriptor.enumerable
    ) throw new Error("integrity_mismatch");
    const lineage = descriptor.value as ResearchSourceLineage;
    if (
      typeof lineage !== "object" || lineage === null || types.isProxy(lineage) ||
      (Object.getPrototypeOf(lineage) !== Object.prototype &&
        Object.getPrototypeOf(lineage) !== null) ||
      Object.getOwnPropertySymbols(lineage).length !== 0
    ) throw new Error("integrity_mismatch");
    const lineageDescriptors = Object.getOwnPropertyDescriptors(lineage);
    const lineageKeys = Object.keys(lineageDescriptors).sort();
    const navigationDescriptor = lineageDescriptors.navigationUrl;
    const indexedDescriptor = lineageDescriptors.indexedSourceUrl;
    const lineageExpected = [
      "navigationUrl",
      ...(indexedDescriptor === undefined ? [] : ["indexedSourceUrl"]),
    ].sort();
    if (
      lineageKeys.length !== lineageExpected.length ||
      lineageKeys.some((key, index) => key !== lineageExpected[index]) ||
      Object.values(lineageDescriptors).some((value) =>
        !("value" in value) || !value.enumerable || typeof value.value !== "string" ||
        value.value.length === 0
      )
    ) throw new Error("integrity_mismatch");
    if (
      navigationDescriptor === undefined || !("value" in navigationDescriptor) ||
      typeof navigationDescriptor.value !== "string"
    ) throw new Error("integrity_mismatch");
    const navigationUrl = navigationDescriptor.value;
    const indexedSourceUrl = indexedDescriptor === undefined
      ? undefined
      : "value" in indexedDescriptor ? indexedDescriptor.value as string : undefined;
    return [sourceId, Object.freeze({
      navigationUrl,
      ...(indexedSourceUrl === undefined
        ? {}
        : { indexedSourceUrl }),
    })];
  })) as Record<SloveniaSourceId, ResearchSourceLineage>);
}

export function createSloveniaPlanV2(
  sourceLineage: Readonly<Record<SloveniaSourceId, ResearchSourceLineage>>,
): ResearchPlan<SloveniaSourceId, ColdStartEvidenceClaimV2> {
  return Object.freeze({
    id: "vs2-slovenia@3",
    scope: SLOVENIA_V2_RESEARCH_SCOPE,
    sourceIds: SLOVENIA_V2_SOURCE_ORDER,
    sourceLineage: snapshotLineage(sourceLineage),
    parserVersions: SLOVENIA_V2_PARSER_VERSIONS,
    rulesVersion: SLOVENIA_V2_EVIDENCE_RULES_VERSION,
    limits: Object.freeze({ concurrency: 3, maxCaptures: 11, deadlineMs: 60_000 }),
    validate: async (
      entry: ParserEntry<SloveniaSourceId>,
      assessmentAt: string,
    ) => validateSloveniaV2Entry(entry, assessmentAt),
    applyRules: applySloveniaV2Rules,
  });
}
