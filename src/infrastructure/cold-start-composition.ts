import { randomUUID } from "node:crypto";

import type Database from "better-sqlite3";
import OpenAI from "openai";

import {
  createColdStartApplication,
  type ColdStartApplication,
} from "../application/cold-start";
import { replayEvidenceByRules } from "../application/replay-evidence";
import type {
  ColdStartEvidenceClaim,
  OfficialSourceDiscoveryPort,
  SloveniaSourceId,
} from "../research/cold-start-contracts";
import type { RequestStep } from "../research/contracts";
import { prepareEvidencePlan } from "../research/research-plan";
import { createEvidenceIntegrity } from "./integrity";
import { captureHttpOnce } from "./sources/gateway";
import { createOfficialSourceDiscovery } from "./sources/official-source-discovery";
import { createSloveniaResearch } from "./sources/slovenia-source-adapter";
import { SqliteDossierStore } from "./sqlite/dossier-store";
import { SqliteEvidenceStore } from "./sqlite/evidence-store";
import { SqliteProfileStore } from "./sqlite/profile-store";

export interface ColdStartCompositionOptions {
  readonly database: Database.Database;
  readonly hmacKey: string;
  readonly openAiApiKey?: string;
  readonly discovery?: OfficialSourceDiscoveryPort;
  readonly requestStep?: RequestStep<SloveniaSourceId>;
  readonly clock?: () => Date;
  readonly nextRunId?: () => string;
}

function unavailableDiscovery(): OfficialSourceDiscoveryPort {
  return Object.freeze({
    discover: async () => ({
      ok: false as const,
      kind: "model_error" as const,
      candidates: [] as const,
    }),
  });
}

export function createColdStartComposition(
  options: ColdStartCompositionOptions,
): ColdStartApplication {
  const evidenceStore = new SqliteEvidenceStore<SloveniaSourceId, ColdStartEvidenceClaim>(
    options.database,
  );
  const dossierStore = new SqliteDossierStore(options.database, options.hmacKey);
  const profileStore = new SqliteProfileStore(options.database);
  const integrity = createEvidenceIntegrity(options.hmacKey);
  const requestStep = options.requestStep ?? captureHttpOnce;
  const apiKey = options.openAiApiKey?.trim();
  const discovery = options.discovery ?? (
    apiKey === undefined || apiKey.length === 0
      ? unavailableDiscovery()
      : createOfficialSourceDiscovery(new OpenAI({ apiKey }))
  );

  return createColdStartApplication({
    profiles: profileStore,
    discovery,
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
    integrity,
    clock: options.clock ?? (() => new Date()),
    nextRunId: options.nextRunId ?? (() => `cold-run-${randomUUID()}`),
  });
}
