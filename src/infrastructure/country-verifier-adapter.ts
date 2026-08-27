import type {
  ColdStartEvent,
} from "../application/cold-start";
import {
  countryCheckRunId,
  type CountryVerificationProgress,
  type CountryVerifierPort,
} from "../application/country-verifier";
import {
  createColdStartComposition,
  type ColdStartCompositionOptions,
} from "./cold-start-composition";
import { createEvidenceIntegrity } from "./integrity";

type VerificationEvent = Exclude<ColdStartEvent, { readonly type: "assessment_completed" }>;

export function normalizeCountryVerificationProgress(
  event: VerificationEvent,
): CountryVerificationProgress {
  switch (event.type) {
    case "source_discovered":
      return {
        stage: event.type,
        label: event.payload.candidateId,
        sourceUrl: event.payload.url,
      };
    case "authority_verified":
      return {
        stage: event.type,
        label: event.payload.candidateId,
        detail: event.payload.authorityRoot,
      };
    case "artifact_captured":
      return {
        stage: event.type,
        label: event.payload.role,
        detail: `sha256:${event.payload.sha256}`,
        sourceUrl: event.payload.resolvedUrl,
      };
    case "claim_verified":
      return {
        stage: event.type,
        label: event.payload.claimId,
        detail: `${event.payload.claimKind} · ${event.payload.sourceIds.join(", ")}`,
      };
    case "dossier_published":
      return {
        stage: event.type,
        label: event.payload.label,
        detail: `${event.payload.dossierVersionId} · ${
          event.payload.created ? "created" : "reused"
        }`,
      };
  }
}

export function createCountryVerifierAdapter(
  options: ColdStartCompositionOptions,
): CountryVerifierPort {
  const coldStart = createColdStartComposition(options);
  const integrity = createEvidenceIntegrity(options.hmacKey);

  const verifier: CountryVerifierPort = {
    async check({ country, profileId, parentRunId, emitProgress, signal }) {
      if (country.countryCode !== "SI") throw new Error("country_not_installed");
      const runId = countryCheckRunId(parentRunId, country.countryCode, integrity);
      const countryCheck = createColdStartComposition({
        ...options,
        nextRunId: () => runId,
      });
      const prepared = await countryCheck.prepare({
        countryInput: country.label,
        profileId,
      });
      if (
        prepared.profileId !== profileId ||
        prepared.runId !== runId ||
        prepared.country.code !== "SI"
      ) throw new Error("integrity_mismatch");
      const readModel = await countryCheck.run(prepared, async (event) => {
        if (event.type !== "assessment_completed") {
          await emitProgress(normalizeCountryVerificationProgress(event));
        }
      }, signal);
      return {
        countryCheckRunId: runId,
        sourceAssessmentRulesVersion: readModel.assessmentRulesVersion,
        verdict: readModel.comparator.formalVerdict,
        evidenceSnapshotId: readModel.evidenceSnapshotId,
        ...(readModel.knowledge.currentRevisionId === undefined ? {} : {
          currentKnowledgeRevisionId: readModel.knowledge.currentRevisionId,
        }),
        ...(readModel.knowledge.updatedRevisionId === undefined ? {} : {
          updatedKnowledgeRevisionId: readModel.knowledge.updatedRevisionId,
        }),
        ...(readModel.knowledge.knowledgeUpdatedAt === undefined ? {} : {
          knowledgeUpdatedAt: readModel.knowledge.knowledgeUpdatedAt,
        }),
        lastCheckedAt: readModel.knowledge.lastCheckedAt,
      };
    },

    async present({ parentRunId, countryCode, countryCheckRunId: childRunId, profileId }) {
      const expectedRunId = countryCheckRunId(parentRunId, countryCode, integrity);
      if (countryCode !== "SI" || childRunId !== expectedRunId) {
        throw new Error("integrity_mismatch");
      }
      const readModel = await coldStart.present({ runId: childRunId, profileId });
      if (readModel.runId !== childRunId || readModel.country.code !== countryCode) {
        throw new Error("integrity_mismatch");
      }
      return {
        sourceAssessmentRulesVersion: readModel.assessmentRulesVersion,
        verdict: readModel.comparator.formalVerdict,
        evidenceSnapshotId: readModel.evidenceSnapshotId,
        ...(readModel.knowledge.currentRevisionId === undefined ? {} : {
          currentKnowledgeRevisionId: readModel.knowledge.currentRevisionId,
        }),
        ...(readModel.knowledge.updatedRevisionId === undefined ? {} : {
          updatedKnowledgeRevisionId: readModel.knowledge.updatedRevisionId,
        }),
        ...(readModel.knowledge.knowledgeUpdatedAt === undefined ? {} : {
          knowledgeUpdatedAt: readModel.knowledge.knowledgeUpdatedAt,
        }),
        lastCheckedAt: readModel.knowledge.lastCheckedAt,
      };
    },
  };
  return Object.freeze(verifier);
}
