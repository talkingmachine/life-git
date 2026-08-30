import type { CitySourceTruthPublicationAuthorityPort } from "../application/city-source-recovery";
import { SqliteCityEvidenceStore } from "./sqlite/city-evidence-store";
import { SqliteCityKnowledgeStore } from "./sqlite/city-knowledge-store";
import { SqliteCityFrontierStore } from "./sqlite/city-frontier-store";

function mismatch(): never { throw new Error("integrity_mismatch"); }

/** Verifies that a replacement is derived solely from the committed city truth chain. */
export function createCitySourceTruthPublicationAuthority(
  evidenceStore: SqliteCityEvidenceStore,
  knowledgeStore: SqliteCityKnowledgeStore,
  frontierStore: SqliteCityFrontierStore,
): CitySourceTruthPublicationAuthorityPort {
  return Object.freeze({ requireVerified(input: Parameters<CitySourceTruthPublicationAuthorityPort["requireVerified"]>[0]) {
    const evidence = evidenceStore.loadVerifiedInTransaction(input.sourceVersion.evidenceSnapshotId);
    const knowledge = knowledgeStore.loadVerified(input.revision.knowledgeRevisionId);
    const frontier = frontierStore.loadRevisionVerified(input.revision.frontierRevisionId);
    const safety = evidence.snapshot.safetyAttemptLedger;
    const accepted = safety.result.kind === "verified" ? safety.candidates[safety.result.acceptedCandidateIndex] : undefined;
    const entry = evidence.genericEvidence.entries.find(({ sourceId }) => sourceId === "si-city-safety");
    if (evidence.snapshot.id !== input.revision.evidenceSnapshotId || knowledge.id !== input.revision.knowledgeRevisionId ||
      knowledge.evidenceSnapshotId !== evidence.snapshot.id || frontier.id !== input.revision.frontierRevisionId ||
      input.revision.sourceVersionId !== input.sourceVersion.id || accepted === undefined || accepted.origin.kind === "previous" ||
      accepted.disposition !== "usable" || accepted.periodDisposition !== "preferred" || entry === undefined ||
      evidence.snapshot.cityId !== input.bindingKey.cityId || knowledge.cityId !== input.bindingKey.cityId ||
      input.sourceVersion.evidenceSnapshotId !== evidence.snapshot.id || input.sourceVersion.publisherId !== accepted.publisherId ||
      input.sourceVersion.navigationUrl !== accepted.publisherNavigationUrl || input.sourceVersion.requestedUrl !== accepted.canonicalUrl ||
      input.sourceVersion.finalUrl !== accepted.resolvedEvidenceUrl ||
      input.sourceVersion.parserVersion !== evidence.genericEvidence.snapshot.parserVersions["si-city-safety"] ||
      input.sourceVersion.capturedAt !== evidence.snapshot.completedAt ||
      input.sourceVersion.captureArtifactIds.length !== entry.artifacts.length ||
      input.sourceVersion.captureArtifactIds.some((id: string, index: number) => id !== entry.artifacts[index]?.artifactId) ||
      input.sourceVersion.captureSha256.some((hash: string, index: number) => hash !== entry.artifacts[index]?.sha256) ||
      frontier.runId !== input.revision.parentRunId || frontier.operation.kind !== "city_completed" ||
      frontier.operation.cityId !== input.bindingKey.cityId || frontier.operation.cityCheckRunId !== evidence.snapshot.cityCheckRunId ||
      !frontier.markers.some((marker) => marker.cityId === input.bindingKey.cityId &&
        marker.knowledgeRevisionId === knowledge.id && marker.evidenceSnapshotId === evidence.snapshot.id)) mismatch();
  } });
}
