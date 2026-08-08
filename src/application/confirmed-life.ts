import { confirmHousingDecision } from "../branch/housing";
import { confirmProfile } from "../decision/profile";
import type {
  ProfileSnapshot,
} from "../research/contracts";
import {
  ASSESSMENT_RULES_VERSION,
  type ConfirmedLifePorts,
  type EvidenceReadItem,
  type RunDetailsCore,
  type RunResult,
} from "./contracts";

function validNow(clock: () => Date): Date {
  const now = clock();
  if (!Number.isFinite(now.getTime())) throw new Error("invalid_clock");
  return now;
}

export function createConfirmedLife(ports: ConfirmedLifePorts) {
  const runConfirmedLife = async (
    profileId: string,
    initialHousingInput: unknown,
  ): Promise<RunResult> => {
    const profile = await ports.profileStore.loadVerified(profileId);
    const initialHousing = confirmHousingDecision(initialHousingInput);
    const now = validNow(ports.clock);
    const deadline = ports.deadlineAt(now);
    if (deadline.getTime() - now.getTime() !== 45_000) throw new Error("invalid_deadline");
    const runId = ports.nextId("run");
    const assessmentDate = now.toISOString().slice(0, 10);
    const expectedEvidenceId = `${runId}:evidence`;
    const produced = await ports.research.runCurrentEvidence({
      runId,
      assessmentDate,
      deadlineAt: deadline.toISOString(),
    });
    if (produced.id !== expectedEvidenceId) throw new Error("integrity_mismatch");
    const evidence = await ports.evidence.loadVerified(expectedEvidenceId, { assessmentDate });
    if (evidence.id !== expectedEvidenceId || evidence.assessmentDate !== assessmentDate) {
      throw new Error("integrity_mismatch");
    }
    const assessment = ports.assess(profile, evidence, { housingProvided: true });
    const assessmentId = ports.nextId("assessment");
    const record = await ports.runStore.appendAssessment({
      id: ports.nextId("revision"),
      runId,
      stage: "assessment",
      assessmentDate,
      initialHousing,
      profileId: profile.id,
      evidenceSnapshotId: evidence.id,
      assessmentId,
      assessment,
      rulesVersion: ASSESSMENT_RULES_VERSION,
    });
    return Object.freeze({
      runId,
      runRevisionId: record.revision.id,
      assessmentDate,
      profileId: profile.id,
      evidenceSnapshotId: evidence.id,
      assessmentId,
      assessment,
      mode: "current" as const,
    });
  };

  const startConfirmedLife = async (
    draft: unknown,
    initialHousingInput: unknown,
  ): Promise<RunResult> => {
    const confirmationTime = validNow(ports.clock);
    const profile: ProfileSnapshot = confirmProfile(draft, () => confirmationTime);
    const initialHousing = confirmHousingDecision(initialHousingInput);
    await ports.profileStore.append(profile);
    return runConfirmedLife(profile.id, initialHousing);
  };

  const retryConfirmedLife = async (previousRunId: string): Promise<RunResult> => {
    if (typeof previousRunId !== "string" || previousRunId.length === 0) {
      throw new Error("invalid_run_id");
    }
    const previousRecord = await ports.runStore.loadAssessmentByRunId(previousRunId);
    const previous = previousRecord.revision;
    if (
      previous.runId !== previousRunId ||
      previous.stage !== "assessment" ||
      previous.rulesVersion !== ASSESSMENT_RULES_VERSION
    ) {
      throw new Error("integrity_mismatch");
    }
    const profile = await ports.profileStore.loadVerified(previous.profileId);
    const evidence = await ports.evidence.loadVerified(previous.evidenceSnapshotId, {
      assessmentDate: previous.assessmentDate,
    });
    if (
      profile.id !== previous.profileId ||
      evidence.id !== previous.evidenceSnapshotId ||
      evidence.assessmentDate !== previous.assessmentDate
    ) {
      throw new Error("integrity_mismatch");
    }
    const exactHousing = confirmHousingDecision(previous.initialHousing);
    return runConfirmedLife(profile.id, exactHousing);
  };

  const loadRunDetailsCore = async (runId: string): Promise<RunDetailsCore> => {
    if (typeof runId !== "string" || runId.length === 0) throw new Error("invalid_run_id");
    const record = await ports.runStore.loadAssessmentByRunId(runId);
    const revision = record.revision;
    if (revision.rulesVersion !== ASSESSMENT_RULES_VERSION) throw new Error("integrity_mismatch");
    const profile = await ports.profileStore.loadVerified(revision.profileId);
    const evidenceDetails = await ports.evidence.loadVerifiedDetails(revision.evidenceSnapshotId, {
      assessmentDate: revision.assessmentDate,
    });
    if (
      revision.runId !== runId ||
      profile.id !== revision.profileId ||
      evidenceDetails.snapshot.id !== revision.evidenceSnapshotId ||
      evidenceDetails.snapshot.assessmentDate !== revision.assessmentDate
    ) {
      throw new Error("integrity_mismatch");
    }
    const officialFacts: EvidenceReadItem[] = evidenceDetails.snapshot.claims.map((claim) => {
      const source = evidenceDetails.sources.find((candidate) => candidate.sourceId === claim.sourceId);
      if (source === undefined) throw new Error("integrity_mismatch");
      return {
        class: "official_fact",
        label: claim.claimId,
        displayValue: JSON.stringify(claim.value),
        sourceId: claim.sourceId,
        scope: claim.scope,
        sourcePeriod: claim.sourcePeriod,
        anchor: `${claim.anchor.locator}#${claim.anchor.excerptSha256}`,
        resolvedUrl: source.resolvedEvidenceUrl,
        integrity: "verified",
      };
    });
    const blockers: EvidenceReadItem[] = evidenceDetails.snapshot.blockers.map((blocker) => ({
      class: "unknown",
      label: `${blocker.sourceId} unavailable`,
      provenance: "source_unavailable",
      sourceId: blocker.sourceId,
      blockerKind: blocker.kind,
      navigationUrl: blocker.navigationUrl,
      ...(blocker.resolvedUrl === undefined ? {} : { resolvedUrl: blocker.resolvedUrl }),
    }));
    const userFacts: EvidenceReadItem[] = [
      {
        class: "user_fact",
        label: "Available resources",
        displayValue: `${profile.profile.availableResourcesAll} ${profile.profile.currency}`,
        provenance: "confirmed_profile",
      },
      {
        class: "user_fact",
        label: "Future income",
        displayValue: `${profile.profile.futureIncomeAll} ${profile.profile.currency}`,
        provenance: "confirmed_profile",
      },
      {
        class: "user_fact",
        label: "Income basis",
        displayValue: profile.profile.incomeBasis,
        provenance: "confirmed_profile",
      },
      {
        class: "user_fact",
        label: "Companion route",
        displayValue: `${profile.profile.companionBasis}:${profile.profile.relationship}`,
        provenance: "confirmed_profile",
      },
      {
        class: "assumption",
        label: "Initial housing",
        displayValue: `${revision.initialHousing.initialHousingAll} ${revision.initialHousing.currency}`,
        provenance: "scenario",
      },
    ];
    const run: RunResult = {
      runId: revision.runId,
      runRevisionId: revision.id,
      assessmentDate: revision.assessmentDate,
      profileId: revision.profileId,
      evidenceSnapshotId: revision.evidenceSnapshotId,
      assessmentId: revision.assessmentId,
      assessment: record.assessment,
      mode: "current",
    };
    return Object.freeze({
      run,
      profile,
      evidenceItems: Object.freeze([...userFacts, ...officialFacts, ...blockers]),
    });
  };

  return Object.freeze({
    startConfirmedLife,
    runConfirmedLife,
    retryConfirmedLife,
    loadRunDetailsCore,
  });
}
