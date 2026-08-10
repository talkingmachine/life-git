import { canonicalJson, createEvidenceIntegrity } from "../infrastructure/integrity";
import type {
  VerifiedEvidenceBundle,
  VerifiedLoadExpectations,
} from "../infrastructure/sqlite/evidence-store";
import type {
  Claim,
  EvidenceSnapshot,
  LiveCapturedArtifact,
  SourceId,
} from "../research/contracts";
import {
  sealEvidencePlan,
  type ResearchPlan,
  type TerminalEvidenceEntry,
} from "../research/research-plan";
import {
  STANDARD_EVIDENCE_PARSERS,
  VS1_RESEARCH_PLAN,
  createVs1ResearchPlan,
  type EvidenceParsers,
} from "../research/run";

export interface ReplayEvidenceInput {
  readonly snapshotId: string;
  readonly hmacKey: string;
}

export interface ReplayEvidenceStore<
  S extends string = SourceId,
  C extends Claim<unknown, S> = Claim<unknown, S>,
> {
  loadVerifiedBundle(
    id: string,
    key: string,
    expected?: VerifiedLoadExpectations<S>,
  ): Promise<VerifiedEvidenceBundle<S, C>>;
}

export interface ReplayEvidencePorts {
  readonly store: ReplayEvidenceStore;
  readonly parsers?: EvidenceParsers;
}

function originalUnavailable<S extends string, C extends Claim<unknown, S>>(
  bundle: VerifiedEvidenceBundle<S, C>,
  sourceId: S,
): TerminalEvidenceEntry<S, C> {
  const entry = bundle.entries.find((candidate) => candidate.sourceId === sourceId);
  const blocker = bundle.snapshot.blockers.find((candidate) => candidate.sourceId === sourceId);
  if (entry === undefined || blocker === undefined) throw new Error("integrity_mismatch");
  return { sourceId, parserEntry: entry, coverage: "unavailable", blocker };
}

function validationUnavailable<S extends string, C extends Claim<unknown, S>>(
  plan: ResearchPlan<S, C>,
  bundle: VerifiedEvidenceBundle<S, C>,
  sourceId: S,
  kind: "integrity_mismatch" | "semantic_mismatch" | "stale" | "conflict",
): TerminalEvidenceEntry<S, C> {
  const entry = bundle.entries.find((candidate) => candidate.sourceId === sourceId);
  if (entry === undefined) throw new Error("integrity_mismatch");
  const resolvedUrl = entry.resolvedEvidenceUrl ||
    (entry.artifacts.at(-1) as LiveCapturedArtifact<S> | undefined)?.responseUrl;
  return {
    sourceId,
    parserEntry: entry,
    coverage: "unavailable",
    blocker: {
      sourceId,
      kind,
      navigationUrl: entry.navigationUrl || plan.sourceNavigation[sourceId],
      ...(resolvedUrl === undefined ? {} : { resolvedUrl }),
      artifactIds: entry.artifacts.map((artifact) => artifact.artifactId),
    },
  };
}

export async function replayEvidencePlan<S extends string, C extends Claim<unknown, S>>(
  input: ReplayEvidenceInput,
  plan: ResearchPlan<S, C>,
  ports: { readonly store: ReplayEvidenceStore<S, C> },
): Promise<EvidenceSnapshot<S, C>> {
  const bundle = await ports.store.loadVerifiedBundle(input.snapshotId, input.hmacKey, {
    parserVersions: plan.parserVersions,
    rulesVersion: plan.rulesVersion,
  });
  if (
    bundle.snapshot.rulesVersion !== plan.rulesVersion ||
    canonicalJson(bundle.snapshot.parserVersions) !== canonicalJson(plan.parserVersions)
  ) {
    throw new Error("integrity_mismatch");
  }
  const terminalEntries = await Promise.all(plan.sourceIds.map(async (sourceId) => {
    const entry = bundle.entries.find((candidate) => candidate.sourceId === sourceId);
    if (entry === undefined) throw new Error("integrity_mismatch");
    const blocker = bundle.snapshot.blockers.find((candidate) => candidate.sourceId === sourceId);
    const shouldValidate = bundle.snapshot.coverage[sourceId] === "verified" ||
      blocker?.kind === "semantic_mismatch" ||
      blocker?.kind === "integrity_mismatch" ||
      blocker?.kind === "stale" ||
      blocker?.kind === "conflict";
    if (!shouldValidate) return originalUnavailable(bundle, sourceId);

    const validated = await plan.validate(entry, bundle.snapshot.assessmentDate);
    if (!validated.ok) {
      return validationUnavailable(plan, bundle, sourceId, validated.kind);
    }
    return {
      sourceId,
      parserEntry: entry,
      coverage: "verified" as const,
      claims: validated.claims,
    };
  }));
  const replayed = await sealEvidencePlan({
    id: bundle.snapshot.id,
    assessmentDate: bundle.snapshot.assessmentDate,
    entries: plan.applyRules(terminalEntries, bundle.snapshot.assessmentDate),
    sourceIds: plan.sourceIds,
    parserVersions: bundle.snapshot.parserVersions,
    rulesVersion: bundle.snapshot.rulesVersion,
    ...(bundle.snapshot.contextHash === undefined
      ? {}
      : { contextHash: bundle.snapshot.contextHash }),
  }, createEvidenceIntegrity(input.hmacKey));
  if (canonicalJson(replayed.snapshot) !== canonicalJson(bundle.snapshot)) {
    throw new Error("integrity_mismatch");
  }
  return replayed.snapshot;
}

export async function replayEvidence(
  input: ReplayEvidenceInput,
  ports: ReplayEvidencePorts,
): Promise<EvidenceSnapshot> {
  const plan = ports.parsers === undefined
    ? VS1_RESEARCH_PLAN
    : createVs1ResearchPlan(ports.parsers ?? STANDARD_EVIDENCE_PARSERS);
  return replayEvidencePlan(input, plan, { store: ports.store });
}
