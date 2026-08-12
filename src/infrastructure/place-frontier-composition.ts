import { randomUUID } from "node:crypto";

import type Database from "better-sqlite3";

import {
  createPlaceFrontierApplication,
  countryCheckRunId,
  type CountryVerifierPort,
} from "../application/place-frontier";
import { rankPlaces, type RankablePlace } from "../decision/place-ranker";
import { createColdStartComposition, type ColdStartCompositionOptions } from "./cold-start-composition";
import { createEvidenceIntegrity } from "./integrity";
import { createInstalledPlacePackages } from "./sources/installed-place-packages";
import { SqliteCountryKnowledgeStore } from "./sqlite/country-knowledge-store";
import { SqlitePlaceFrontierStore } from "./sqlite/place-frontier-store";
import { SqliteProfileStore } from "./sqlite/profile-store";

export interface PlaceFrontierCompositionOptions extends ColdStartCompositionOptions {
  readonly database: Database.Database;
  readonly hmacKey: string;
  readonly nextRunId?: () => string;
}

function frontierPlaces(): readonly RankablePlace[] {
  return createInstalledPlacePackages().list().map((item) => ({
    countryCode: item.countryCode,
    label: item.label,
    flag: item.flag,
    coordinate: item.coordinate,
    factors: [],
  }));
}

export function createPlaceFrontierComposition(options: PlaceFrontierCompositionOptions) {
  const coldStart = createColdStartComposition(options);
  const profiles = new SqliteProfileStore(options.database);
  const knowledge = new SqliteCountryKnowledgeStore(options.database, options.hmacKey);
  const verifier: CountryVerifierPort = {
    async check({ country, profileId, parentRunId, emitProgress, signal }) {
      if (country.countryCode !== "SI") throw new Error("country_not_installed");
      const runId = countryCheckRunId(parentRunId, country.countryCode);
      const prepareWithRunId = coldStart.prepareColdStartWithRunId;
      if (prepareWithRunId === undefined) throw new Error("integrity_mismatch");
      const prepared = await prepareWithRunId({
        countryInput: country.label,
        profileId,
        runId,
      });
      if (prepared.profileId !== profileId || prepared.runId !== runId || prepared.country.code !== "SI") {
        throw new Error("integrity_mismatch");
      }
      const readModel = await coldStart.run(prepared, async (event) => {
        if (event.type !== "assessment_completed") await emitProgress(event as never);
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
      const expectedRunId = countryCheckRunId(parentRunId, countryCode);
      if (countryCode !== "SI" || childRunId !== expectedRunId) throw new Error("integrity_mismatch");
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
  return createPlaceFrontierApplication({
    profiles,
    rankingInputs: {
      async freezeCurrent() {
        const places = frontierPlaces();
        return {
          places,
          knowledgeRevisionIds: Object.fromEntries(await Promise.all(places.map(async (place) => [
            place.countryCode,
            (await knowledge.latest(place.countryCode))?.id ?? null,
          ]))),
        };
      },
    },
    rank: ({ assessmentAt, preferences, places }) => rankPlaces({
      assessmentAt,
      preferences,
      places: places.map((place) => ({
        ...place,
        factors: preferences.criteria.map((criterion) => ({
          criterionId: criterion.id,
          state: "missing" as const,
          evaluatorVersion: "installed-package@1",
        })),
      })),
    }),
    store: new SqlitePlaceFrontierStore(options.database, options.hmacKey),
    knowledge: { loadVerified: async (id) => knowledge.loadVerified(id) },
    verifier,
    integrity: createEvidenceIntegrity(options.hmacKey),
    clock: options.clock ?? (() => new Date()),
    nextRunId: options.nextRunId ?? (() => `frontier-${randomUUID()}`),
  });
}
