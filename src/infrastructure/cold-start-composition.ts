import { randomUUID } from "node:crypto";

import type Database from "better-sqlite3";

import {
  createColdStartApplication,
  type ColdStartApplication,
} from "../application/cold-start";
import { replayEvidenceByRules } from "../application/replay-evidence";
import type {
  ColdStartEvidenceClaim,
  CountrySourceIndexPort,
  SloveniaSourceId,
} from "../research/cold-start-contracts";
import type { RequestStep } from "../research/contracts";
import { buildSloveniaKnowledgeRevision } from "../research/country-knowledge";
import { prepareEvidencePlan } from "../research/research-plan";
import { createEvidenceIntegrity } from "./integrity";
import { createInstalledCountrySourceIndex } from "./sources/country-source-index";
import { captureHttpOnce } from "./sources/gateway";
import { createSloveniaResearch } from "./sources/slovenia-source-adapter";
import { SqliteDossierStore } from "./sqlite/dossier-store";
import { SqliteCountryKnowledgeStore } from "./sqlite/country-knowledge-store";
import { SqliteEvidenceStore } from "./sqlite/evidence-store";
import { SqliteProfileStore } from "./sqlite/profile-store";

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
): ColdStartApplication {
  const evidenceStore = new SqliteEvidenceStore<SloveniaSourceId, ColdStartEvidenceClaim>(
    options.database,
  );
  const dossierStore = new SqliteDossierStore(options.database, options.hmacKey);
  const knowledgeStore = new SqliteCountryKnowledgeStore(options.database, options.hmacKey);
  const profileStore = new SqliteProfileStore(options.database);
  const integrity = createEvidenceIntegrity(options.hmacKey);
  const requestStep = options.requestStep ?? captureHttpOnce;
  const countrySourceIndex = options.countrySourceIndex ?? createInstalledCountrySourceIndex();

  return createColdStartApplication({
    profiles: profileStore,
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
        }, research.plan, {
          source: research.source,
          requestStep,
          artifacts: evidenceStore,
          integrity,
          onProgress: input.onProgress,
        });
      },
    },
    evidence: {
      seal: (sealed) => evidenceStore.seal(sealed),
      loadVerifiedBundle: (id) => evidenceStore.loadVerifiedBundle(id, options.hmacKey),
      replay: (id) => replayEvidenceByRules(
        { snapshotId: id, hmacKey: options.hmacKey },
        { store: evidenceStore },
      ),
    },
    dossiers: dossierStore,
    knowledge: {
      publishCurrent: async ({ evidenceSnapshotId, lastCheckedAt }) => {
        const evidence = await evidenceStore.loadVerifiedCountryEvidence(
          evidenceSnapshotId,
          options.hmacKey,
        );
        if (evidence.snapshot.assessmentDate !== lastCheckedAt) {
          throw new Error("integrity_mismatch");
        }
        const currentRevision = knowledgeStore.latest("SI");
        if (currentRevision?.triggerEvidenceSnapshotId === evidenceSnapshotId) {
          return { currentRevision };
        }
        const createdAt = evidence.artifacts
          .filter(({ sourceId }) => sourceId !== "cbr-eur")
          .map(({ capturedAt }) => capturedAt)
          .sort()
          .at(-1);
        if (createdAt === undefined) return { currentRevision };
        const revision = buildSloveniaKnowledgeRevision({
          evidence,
          ...(currentRevision === undefined ? {} : { predecessor: currentRevision }),
          createdAt,
        });
        if (revision === undefined) return { currentRevision };
        const publishedRevision = knowledgeStore.publish(revision);
        return { publishedRevision, currentRevision: publishedRevision };
      },
      latest: async (countryCode) => knowledgeStore.latest(countryCode),
    },
    integrity,
    clock: options.clock ?? (() => new Date()),
    nextRunId: options.nextRunId ?? (() => `cold-run-${randomUUID()}`),
  });
}
