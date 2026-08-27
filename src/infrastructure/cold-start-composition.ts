import { randomUUID } from "node:crypto";

import type Database from "better-sqlite3";

import {
  createColdStartApplication,
  type ColdStartApplicationAny,
  type ColdStartResearchPrepareInputV2,
} from "../application/cold-start";
import {
  replayEvidenceByRules,
  type EvidenceReplayIntegrityFactoryPort,
} from "../application/replay-evidence";
import type {
  ColdStartEvidenceClaim,
  CountrySourceIndexPort,
  SloveniaSourceId,
} from "../research/cold-start-contracts";
import {
  SLOVENIA_V2_EVIDENCE_RULES_VERSION,
  SLOVENIA_V2_PARSER_VERSIONS,
  type ColdStartEvidenceClaimV2,
} from "../research/cold-start-contracts-v2";
import type { RequestStep } from "../research/contracts";
import {
  prepareEvidencePlan,
  type SealedEvidence,
} from "../research/research-plan";
import { createEvidenceIntegrity } from "./integrity";
import { sharedProfileCompositionPort } from "./composition-dependencies";
import { createInstalledCountrySourceIndex } from "./sources/country-source-index";
import { captureHttpOnce } from "./sources/gateway";
import {
  createSloveniaResearch,
  createSloveniaResearchV2,
} from "./sources/slovenia-source-adapter";
import { SqliteDossierStore } from "./sqlite/dossier-store";
import { SqliteCountryKnowledgeStore } from "./sqlite/country-knowledge-store";
import { SqliteEvidenceStore } from "./sqlite/evidence-store";
import { SqliteProfileStore } from "./sqlite/profile-store";

const SLOVENIA_V1_PARSER_VERSIONS = Object.freeze({
  "si-digital-nomad-route": "si-route@2",
  "si-income-threshold": "si-income@2",
  "si-companion-employment": "si-companion@2",
  "cbr-eur": "cbr-eur@1",
} as const);

export interface ColdStartCompositionOptions {
  readonly database: Database.Database;
  readonly hmacKey: string;
  readonly countrySourceIndex?: CountrySourceIndexPort;
  readonly requestStep?: RequestStep<SloveniaSourceId>;
  readonly clock?: () => Date;
  readonly nextRunId?: () => string;
}

export function createColdStartComposition(
  options: ColdStartCompositionOptions,
): ColdStartApplicationAny {
  const profiles = sharedProfileCompositionPort(options) ??
    new SqliteProfileStore(options.database);
  const evidenceStore = new SqliteEvidenceStore<SloveniaSourceId, ColdStartEvidenceClaim>(
    options.database,
  );
  const evidenceStoreV2 = new SqliteEvidenceStore<SloveniaSourceId, ColdStartEvidenceClaimV2>(
    options.database,
  );
  const dossierStore = new SqliteDossierStore(options.database, options.hmacKey);
  const knowledgeStore = new SqliteCountryKnowledgeStore(options.database, options.hmacKey);
  const integrity = createEvidenceIntegrity(options.hmacKey);
  const integrityFactory = Object.freeze({
    create: createEvidenceIntegrity,
  }) satisfies EvidenceReplayIntegrityFactoryPort;
  const requestStep = options.requestStep ?? captureHttpOnce;
  const countrySourceIndex = options.countrySourceIndex ?? createInstalledCountrySourceIndex();

  return createColdStartApplication({
    profiles,
    countrySourceIndex,
    research: {
      prepare: (input) => {
        const research = createSloveniaResearch({ candidates: input.candidates });
        return prepareEvidencePlan({
          runId: input.runId,
          assessmentDate: input.assessmentDate,
          deadlineAt: input.deadlineAt,
          signal: input.signal,
          contextHash: input.contextHash,
          ...(input.knowledgeBaselineRevisionId === undefined
            ? {}
            : { knowledgeBaselineRevisionId: input.knowledgeBaselineRevisionId }),
        }, research.plan, {
          source: research.source,
          requestStep,
          artifacts: evidenceStore,
          integrity,
          onProgress: input.onProgress,
        });
      },
      prepareV2: (input: ColdStartResearchPrepareInputV2) => {
        const research = createSloveniaResearchV2({ candidates: input.candidates });
        return prepareEvidencePlan({
          runId: input.runId,
          assessmentDate: input.assessmentDate,
          deadlineAt: input.deadlineAt,
          signal: input.signal,
          contextHash: input.contextHash,
          ...(input.knowledgeBaselineRevisionId === undefined
            ? {}
            : { knowledgeBaselineRevisionId: input.knowledgeBaselineRevisionId }),
        }, research.plan, {
          source: research.source,
          requestStep,
          artifacts: evidenceStoreV2,
          integrity,
          onProgress: input.onProgress,
        });
      },
    },
    evidence: {
      seal: (sealed) => evidenceStore.seal(sealed),
      loadVerifiedBundle: (id) => evidenceStore.loadVerifiedBundle(id, options.hmacKey, {
        parserVersions: SLOVENIA_V1_PARSER_VERSIONS,
        rulesVersion: "vs2-si-evidence@2",
      }),
      replay: async (id) => {
        await evidenceStore.loadVerifiedBundle(id, options.hmacKey, {
          parserVersions: SLOVENIA_V1_PARSER_VERSIONS,
          rulesVersion: "vs2-si-evidence@2",
        });
        return replayEvidenceByRules(
          { snapshotId: id, hmacKey: options.hmacKey },
          { store: evidenceStore, integrityFactory },
        );
      },
      sealV2: (sealed: SealedEvidence<SloveniaSourceId, ColdStartEvidenceClaimV2>) =>
        evidenceStoreV2.seal(sealed),
      loadVerifiedBundleV2: (id: string) => evidenceStoreV2.loadVerifiedBundle(
        id,
        options.hmacKey,
        {
          parserVersions: SLOVENIA_V2_PARSER_VERSIONS,
          rulesVersion: SLOVENIA_V2_EVIDENCE_RULES_VERSION,
        },
      ),
      replayV2: async (id: string) => {
        await evidenceStoreV2.loadVerifiedBundle(id, options.hmacKey, {
          parserVersions: SLOVENIA_V2_PARSER_VERSIONS,
          rulesVersion: SLOVENIA_V2_EVIDENCE_RULES_VERSION,
        });
        return replayEvidenceByRules(
          { snapshotId: id, hmacKey: options.hmacKey },
          { store: evidenceStoreV2, integrityFactory },
        );
      },
    },
    dossiers: dossierStore,
    knowledge: {
      publishCurrent: async ({ evidenceSnapshotId, lastCheckedAt }) => {
        const stored = await evidenceStore.loadVerifiedBundle(evidenceSnapshotId, options.hmacKey);
        const evidence = stored.snapshot.rulesVersion === "vs2-si-evidence@2"
          ? await evidenceStore.loadVerifiedCountryEvidence(evidenceSnapshotId, options.hmacKey)
          : stored.snapshot.rulesVersion === SLOVENIA_V2_EVIDENCE_RULES_VERSION
            ? await evidenceStoreV2.loadVerifiedCountryEvidenceV2(
                evidenceSnapshotId,
                options.hmacKey,
              )
            : (() => { throw new Error("integrity_mismatch"); })();
        if (evidence.snapshot.assessmentDate !== lastCheckedAt) {
          throw new Error("integrity_mismatch");
        }
        return knowledgeStore.publishCurrentFromEvidence(evidenceSnapshotId);
      },
      latest: async (countryCode) => knowledgeStore.latest(countryCode),
      resolveForEvidence: async (evidenceSnapshotId) =>
        knowledgeStore.resolveForEvidence(evidenceSnapshotId),
    },
    integrity,
    clock: options.clock ?? (() => new Date()),
    nextRunId: options.nextRunId ?? (() => `cold-run-${randomUUID()}`),
  });
}
