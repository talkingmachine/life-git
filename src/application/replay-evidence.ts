import type {
  Claim,
  EvidenceSnapshot,
  LiveCapturedArtifact,
  SourceId,
} from "../research/contracts";
import type {
  ColdStartEvidenceClaim,
  SloveniaSourceId,
} from "../research/cold-start-contracts";
import {
  SLOVENIA_V2_EVIDENCE_RULES_VERSION,
  SLOVENIA_V2_SOURCE_ORDER,
  type ColdStartEvidenceClaimV2,
} from "../research/cold-start-contracts-v2";
import {
  evidenceCanonicalEqual,
  sealEvidencePlan,
  type EvidenceIntegrity,
  type ResearchPlan,
  type TerminalEvidenceEntry,
  type VerifiedEvidenceBundle,
  type VerifiedLoadExpectations,
} from "../research/research-plan";
import {
  STANDARD_EVIDENCE_PARSERS,
  VS1_RESEARCH_PLAN,
  createVs1ResearchPlan,
  type EvidenceParsers,
} from "../research/run";
import { createSloveniaPlan } from "../research/slovenia-plan";
import { createSloveniaPlanV2 } from "../research/slovenia-plan-v2";

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

export interface EvidenceReplayIntegrityFactoryPort {
  create(hmacKey: string): EvidenceIntegrity;
}

export interface ReplayEvidenceRuntimePorts<
  S extends string = SourceId,
  C extends Claim<unknown, S> = Claim<unknown, S>,
> {
  readonly store: ReplayEvidenceStore<S, C>;
  readonly integrityFactory: EvidenceReplayIntegrityFactoryPort;
}

export interface ReplayEvidencePorts extends ReplayEvidenceRuntimePorts {
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
      navigationUrl: entry.navigationUrl || plan.sourceLineage[sourceId].navigationUrl,
      ...(resolvedUrl === undefined ? {} : { resolvedUrl }),
      artifactIds: entry.artifacts.map((artifact) => artifact.artifactId),
    },
  };
}

export async function replayEvidencePlan<S extends string, C extends Claim<unknown, S>>(
  input: ReplayEvidenceInput,
  plan: ResearchPlan<S, C>,
  ports: ReplayEvidenceRuntimePorts<S, C>,
): Promise<EvidenceSnapshot<S, C>> {
  const integrity = ports.integrityFactory.create(input.hmacKey);
  const comparisonIntegrity: Pick<EvidenceIntegrity, "canonical"> = Object.freeze({
    canonical: integrity.canonical,
  });
  const bundle = await ports.store.loadVerifiedBundle(input.snapshotId, input.hmacKey, {
    parserVersions: plan.parserVersions,
    rulesVersion: plan.rulesVersion,
  });
  if (
    bundle.snapshot.rulesVersion !== plan.rulesVersion ||
    !evidenceCanonicalEqual(bundle.snapshot.parserVersions, plan.parserVersions, comparisonIntegrity)
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
    ...(bundle.snapshot.knowledgeBaselineRevisionId === undefined
      ? {}
      : { knowledgeBaselineRevisionId: bundle.snapshot.knowledgeBaselineRevisionId }),
  }, integrity);
  if (!evidenceCanonicalEqual(replayed.snapshot, bundle.snapshot, comparisonIntegrity)) {
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
  return replayEvidencePlan(input, plan, ports);
}

export async function replayEvidenceByRules<
  S extends string,
  C extends Claim<unknown, S>,
>(
  input: ReplayEvidenceInput,
  ports: ReplayEvidenceRuntimePorts<S, C>,
): Promise<EvidenceSnapshot<S, C>> {
  const verified = await ports.store.loadVerifiedBundle(input.snapshotId, input.hmacKey);
  if (verified.snapshot.rulesVersion === "vs1-evidence@1") {
    return replayEvidencePlan(
      input,
      VS1_RESEARCH_PLAN,
      {
        store: ports.store as unknown as ReplayEvidenceStore,
        integrityFactory: ports.integrityFactory,
      },
    ) as unknown as Promise<EvidenceSnapshot<S, C>>;
  }
  if (verified.snapshot.rulesVersion === SLOVENIA_V2_EVIDENCE_RULES_VERSION) {
    if (
      verified.entries.length !== SLOVENIA_V2_SOURCE_ORDER.length ||
      SLOVENIA_V2_SOURCE_ORDER.some(
        (sourceId, index) => verified.entries[index]?.sourceId !== sourceId,
      )
    ) throw new Error("integrity_mismatch");
    const sourceLineage = Object.fromEntries(SLOVENIA_V2_SOURCE_ORDER.map((sourceId) => {
      const entry = verified.entries.find((candidate) => candidate.sourceId === sourceId)!;
      return [sourceId, {
        navigationUrl: entry.navigationUrl,
        ...(entry.indexedSourceUrl === undefined
          ? {}
          : { indexedSourceUrl: entry.indexedSourceUrl }),
      }];
    })) as Record<SloveniaSourceId, {
      readonly navigationUrl: string;
      readonly indexedSourceUrl?: string;
    }>;
    return replayEvidencePlan(
      input,
      createSloveniaPlanV2(sourceLineage),
      {
        store: ports.store as unknown as ReplayEvidenceStore<
          SloveniaSourceId,
          ColdStartEvidenceClaimV2
        >,
        integrityFactory: ports.integrityFactory,
      },
    ) as unknown as Promise<EvidenceSnapshot<S, C>>;
  }
  if (verified.snapshot.rulesVersion !== "vs2-si-evidence@2") {
    throw new Error("integrity_mismatch");
  }
  const expectedSources = [
    "si-digital-nomad-route",
    "si-income-threshold",
    "si-companion-employment",
    "cbr-eur",
  ] as const satisfies readonly SloveniaSourceId[];
  if (
    verified.entries.length !== expectedSources.length ||
    expectedSources.some((sourceId) =>
      verified.entries.filter((entry) => entry.sourceId === sourceId).length !== 1
    )
  ) throw new Error("integrity_mismatch");
  const sourceLineage = Object.fromEntries(expectedSources.map((sourceId) => {
    const entry = verified.entries.find((candidate) => candidate.sourceId === sourceId)!;
    return [sourceId, {
      navigationUrl: entry.navigationUrl,
      ...(entry.indexedSourceUrl === undefined
        ? {}
        : { indexedSourceUrl: entry.indexedSourceUrl }),
    }];
  })) as Record<SloveniaSourceId, {
    readonly navigationUrl: string;
    readonly indexedSourceUrl?: string;
  }>;
  return replayEvidencePlan(
    input,
    createSloveniaPlan(sourceLineage),
    {
      store: ports.store as unknown as ReplayEvidenceStore<
        SloveniaSourceId,
        ColdStartEvidenceClaim
      >,
      integrityFactory: ports.integrityFactory,
    },
  ) as unknown as Promise<EvidenceSnapshot<S, C>>;
}
