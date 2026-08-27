import { randomUUID } from "node:crypto";

import type Database from "better-sqlite3";

import {
  createPlaceFrontierApplication,
} from "../application/place-frontier";
import { rankPlaces, type RankablePlace } from "../decision/place-ranker";
import type { ColdStartCompositionOptions } from "./cold-start-composition";
import { createCountryVerifierAdapter } from "./country-verifier-adapter";
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
  const profiles = new SqliteProfileStore(options.database);
  const knowledge = new SqliteCountryKnowledgeStore(options.database, options.hmacKey);
  const verifier = createCountryVerifierAdapter(options);
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
    store: new SqlitePlaceFrontierStore(options.database, options.hmacKey, profiles),
    knowledge: { loadVerified: async (id) => knowledge.loadVerified(id) },
    verifier,
    integrity: createEvidenceIntegrity(options.hmacKey),
    clock: options.clock ?? (() => new Date()),
    nextRunId: options.nextRunId ?? (() => `frontier-${randomUUID()}`),
  });
}
