import { canonicalJson, createEvidenceIntegrity } from "../infrastructure/integrity";
import type {
  EvidenceSnapshot,
  SourceId,
} from "../research/contracts";
import {
  EVIDENCE_PARSER_VERSIONS,
  EVIDENCE_RULES_VERSION,
  EVIDENCE_SOURCE_IDS,
  STANDARD_EVIDENCE_PARSERS,
  applyEvidenceRules,
  parseEvidenceEntry,
  sealEvidence,
  type EvidenceParsers,
  type TerminalEvidenceEntry,
} from "../research/run";
import type {
  VerifiedEvidenceBundle,
  VerifiedLoadExpectations,
} from "../infrastructure/sqlite/evidence-store";

export interface ReplayEvidenceInput {
  readonly snapshotId: string;
  readonly hmacKey: string;
}

export interface ReplayEvidenceStore {
  loadVerifiedBundle(
    id: string,
    key: string,
    expected?: VerifiedLoadExpectations,
  ): Promise<VerifiedEvidenceBundle>;
}

export interface ReplayEvidencePorts {
  readonly store: ReplayEvidenceStore;
  readonly parsers?: EvidenceParsers;
}

function originalUnavailable(bundle: VerifiedEvidenceBundle, sourceId: SourceId): TerminalEvidenceEntry {
  const entry = bundle.entries.find((candidate) => candidate.sourceId === sourceId);
  const blocker = bundle.snapshot.blockers.find((candidate) => candidate.sourceId === sourceId);
  if (entry === undefined || blocker === undefined) throw new Error("integrity_mismatch");
  return {
    sourceId,
    parserEntry: entry,
    coverage: "unavailable",
    blocker,
  };
}

export async function replayEvidence(
  input: ReplayEvidenceInput,
  ports: ReplayEvidencePorts,
): Promise<EvidenceSnapshot> {
  const bundle = await ports.store.loadVerifiedBundle(input.snapshotId, input.hmacKey, {
    parserVersions: EVIDENCE_PARSER_VERSIONS,
    rulesVersion: EVIDENCE_RULES_VERSION,
  });
  const parsers = ports.parsers ?? STANDARD_EVIDENCE_PARSERS;
  const terminalEntries = await Promise.all(EVIDENCE_SOURCE_IDS.map(async (sourceId) => {
    const entry = bundle.entries.find((candidate) => candidate.sourceId === sourceId);
    if (entry === undefined) throw new Error("integrity_mismatch");
    if (bundle.snapshot.coverage[sourceId] === "verified") {
      return parseEvidenceEntry(entry, parsers);
    }
    const blocker = bundle.snapshot.blockers.find((candidate) => candidate.sourceId === sourceId);
    if (
      blocker?.kind === "semantic_mismatch" ||
      blocker?.kind === "integrity_mismatch" ||
      blocker?.kind === "stale"
    ) {
      return parseEvidenceEntry(entry, parsers);
    }
    return originalUnavailable(bundle, sourceId);
  }));
  const replayed = await sealEvidence({
    id: bundle.snapshot.id,
    assessmentDate: bundle.snapshot.assessmentDate,
    entries: applyEvidenceRules(terminalEntries, bundle.snapshot.assessmentDate),
    parserVersions: bundle.snapshot.parserVersions,
    rulesVersion: bundle.snapshot.rulesVersion,
  }, createEvidenceIntegrity(input.hmacKey));
  if (canonicalJson(replayed.snapshot) !== canonicalJson(bundle.snapshot)) {
    throw new Error("integrity_mismatch");
  }
  return replayed.snapshot;
}
