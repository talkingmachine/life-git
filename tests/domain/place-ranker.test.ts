import { createHash } from "node:crypto";

import { describe, expect, test } from "vitest";

import {
  confirmPreferenceProfile,
  type PlaceCriterionId,
  type PreferenceCriterion,
  type PreferenceProfileSnapshot,
} from "../../src/decision/preference-profile";
import {
  rankPlaces,
  reconstructPlaceRanking,
  type PlaceFactorProjection,
  type RankablePlace,
} from "../../src/decision/place-ranker";
import { openEvidenceDatabase } from "../../src/infrastructure/sqlite/db";
import { SqliteProfileStore } from "../../src/infrastructure/sqlite/profile-store";

const CONFIRMED_AT = "2026-08-12T08:00:00.000Z";

function weighted(
  id: PlaceCriterionId,
  importance: PreferenceCriterion["importance"] = 1,
): PreferenceCriterion {
  return { id, mode: "weighted", importance, target: "maximize" };
}

function required(
  id: PlaceCriterionId,
  importance: PreferenceCriterion["importance"] = 1,
): PreferenceCriterion {
  return { id, mode: "required", importance, target: "required_true" };
}

function preferences(
  criteria: readonly PreferenceCriterion[],
): PreferenceProfileSnapshot {
  return confirmPreferenceProfile({ criteria }, () => new Date(CONFIRMED_AT));
}

function known(
  criterionId: PlaceCriterionId,
  match: string,
  requirementStatus?: "matches" | "does_not_match",
): PlaceFactorProjection {
  return {
    criterionId,
    state: "known",
    match,
    observationId: `observation-${criterionId}`,
    evaluatorVersion: "place-factor@1",
    ...(requirementStatus === undefined ? {} : { requirementStatus }),
  };
}

function unknown(
  criterionId: PlaceCriterionId,
  state: Exclude<PlaceFactorProjection["state"], "known"> = "missing",
): PlaceFactorProjection {
  return { criterionId, state, evaluatorVersion: "place-factor@1" };
}

function place(
  countryCode: string,
  factors: readonly PlaceFactorProjection[],
): RankablePlace {
  return {
    countryCode,
    label: countryCode,
    flag: `flag-${countryCode}`,
    coordinate: { lat: 46.05, lng: 14.51 },
    factors,
  };
}

describe("preference profile and place ranking", () => {
  test("reconstructs only exact canonical scoring and genuine required exclusions", () => {
    const profile = preferences([
      required("outside_cis", 5),
      weighted("personal_safety", 3),
    ]);
    const included = place("SI", [
      known("outside_cis", "1", "matches"),
      known("personal_safety", "0.5"),
    ]);
    const excluded = place("BY", [
      known("outside_cis", "-1", "does_not_match"),
      known("personal_safety", "0.5"),
    ]);
    const ranking = rankPlaces({
      assessmentAt: "2026-08-12",
      preferences: profile,
      places: [included, excluded],
    });

    expect(reconstructPlaceRanking({
      assessmentAt: "2026-08-12",
      preferences: profile,
      ...ranking,
      excludedPlaces: [excluded],
    }).excluded).toEqual(ranking.excluded);
    expect(() => reconstructPlaceRanking({
      assessmentAt: "2026-08-12",
      preferences: profile,
      ...ranking,
      excludedPlaces: [excluded],
      ordered: [{ ...ranking.ordered[0]!, relevance: "999" }],
    })).toThrow("invalid_ranking_semantics");
    expect(() => reconstructPlaceRanking({
      assessmentAt: "2026-08-12",
      preferences: profile,
      ...ranking,
      excludedPlaces: [{ ...excluded, countryCode: "ZZ" }],
    })).toThrow("invalid_ranking_semantics");
    expect(() => reconstructPlaceRanking({
      assessmentAt: "2026-08-12",
      preferences: profile,
      ordered: [],
      excluded: [],
      excludedPlaces: [],
      rulesVersion: "place-ranker@1",
    })).toThrow("empty_ranking");
  });

  test("confirms and stores only a non-empty unique strict profile in canonical frozen order", async () => {
    const snapshot = confirmPreferenceProfile({
      criteria: [
        weighted("peace_and_stability", 2),
        required("outside_cis", 5),
        weighted("infrastructure", 3),
      ],
    }, () => new Date(CONFIRMED_AT));

    expect(snapshot).toEqual({
      schemaVersion: "preference-profile@1",
      id: "0e262ae57dba3937dfd93c8820a8bc7a4ce0b14149e0a218355bd021e4b80127",
      confirmedAt: CONFIRMED_AT,
      criteria: [
        required("outside_cis", 5),
        weighted("infrastructure", 3),
        weighted("peace_and_stability", 2),
      ],
    });
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.criteria)).toBe(true);
    expect(snapshot.criteria.every(Object.isFrozen)).toBe(true);

    expect(() => confirmPreferenceProfile({ criteria: [] }, () => new Date())).toThrow();
    expect(() => confirmPreferenceProfile({}, () => new Date())).toThrow();
    expect(() => confirmPreferenceProfile({
      criteria: [weighted("europe"), weighted("europe")],
    }, () => new Date())).toThrow();
    expect(() => confirmPreferenceProfile({
      criteria: [{ ...weighted("europe"), importance: 0 }],
    }, () => new Date())).toThrow();
    expect(() => confirmPreferenceProfile({
      criteria: [{ ...weighted("europe"), explanation: "because" }],
    }, () => new Date())).toThrow();
    expect(() => confirmPreferenceProfile({
      criteria: [weighted("europe")],
      freeText: "somewhere warm",
    }, () => new Date())).toThrow();

    const database = openEvidenceDatabase(":memory:");
    const store = new SqliteProfileStore(database);
    await store.appendPreference(snapshot);
    expect(await store.loadPreferenceVerified(snapshot.id)).toEqual(snapshot);

    database.exec("DROP TRIGGER profile_snapshots_no_update");
    database.prepare(
      "UPDATE profile_snapshots SET snapshot_hash = ? WHERE id = ?",
    ).run("0".repeat(64), snapshot.id);
    await expect(store.loadPreferenceVerified(snapshot.id)).rejects.toThrow("integrity_mismatch");

    const nonCanonicalJson = JSON.stringify({
      schemaVersion: snapshot.schemaVersion,
      id: snapshot.id,
      confirmedAt: snapshot.confirmedAt,
      criteria: snapshot.criteria,
    });
    const matchingHash = createHash("sha256").update(nonCanonicalJson).digest("hex");
    database.prepare(`
      UPDATE profile_snapshots SET snapshot_json = ?, snapshot_hash = ? WHERE id = ?
    `).run(nonCanonicalJson, matchingHash, snapshot.id);
    await expect(store.loadPreferenceVerified(snapshot.id)).rejects.toThrow("integrity_mismatch");
    database.close();
  });

  test("uses exact Decimal matches and assigns every unknown state minus one with zero coverage", () => {
    const twoCriteria = preferences([
      weighted("personal_safety"),
      weighted("infrastructure"),
    ]);

    expect(rankPlaces({
      assessmentAt: "2026-08-12",
      preferences: twoCriteria,
      places: [
        place("PT", [known("personal_safety", "0.5"), unknown("infrastructure")]),
        place("SI", [known("personal_safety", "0.5"), known("infrastructure", "0.2")]),
      ],
    }).ordered.map(({ countryCode, relevance, coverage }) => ({
      countryCode,
      relevance,
      coverage,
    }))).toEqual([
      { countryCode: "SI", relevance: "0.35", coverage: "1" },
      { countryCode: "PT", relevance: "-0.25", coverage: "0.5" },
    ]);

    const unknownResults = (["missing", "stale", "future", "not_comparable"] as const)
      .map((state, index) => rankPlaces({
        assessmentAt: "2026-08-12",
        preferences: preferences([weighted("europe", 5)]),
        places: [place(`X${index}`, [unknown("europe", state)])],
      }).ordered[0]);
    expect(unknownResults.map((result) => ({
      relevance: result?.relevance,
      coverage: result?.coverage,
      effectiveMatch: result?.contributions[0]?.effectiveMatch,
      weightedContribution: result?.contributions[0]?.weightedContribution,
    }))).toEqual([
      { relevance: "-1", coverage: "0", effectiveMatch: "-1", weightedContribution: "-5" },
      { relevance: "-1", coverage: "0", effectiveMatch: "-1", weightedContribution: "-5" },
      { relevance: "-1", coverage: "0", effectiveMatch: "-1", weightedContribution: "-5" },
      { relevance: "-1", coverage: "0", effectiveMatch: "-1", weightedContribution: "-5" },
    ]);

    expect(() => rankPlaces({
      assessmentAt: "2026-08-12",
      preferences: preferences([weighted("europe")]),
      places: [place("SI", [known("europe", "1.0001")])],
    })).toThrow();
    expect(() => rankPlaces({
      assessmentAt: "2026-08-12",
      preferences: preferences([weighted("europe")]),
      places: [place("SI", [known("europe", "-1.0001")])],
    })).toThrow();
    expect(() => rankPlaces({
      assessmentAt: "2026-08-12",
      preferences: preferences([weighted("europe")]),
      places: [place("SI", [{ ...unknown("europe"), match: "1" }])],
    })).toThrow("unknown_factor_fields_forbidden");
  });

  test("excludes only an explicit known required mismatch and keeps unknown requirements", () => {
    const profile = preferences([required("outside_cis", 5)]);
    const result = rankPlaces({
      assessmentAt: "2026-08-12",
      preferences: profile,
      places: [
        place("BY", [known("outside_cis", "1", "does_not_match")]),
        place("PT", [unknown("outside_cis", "not_comparable")]),
        place("SI", [known("outside_cis", "-1", "matches")]),
      ],
    });

    expect(result.excluded).toEqual([{
      countryCode: "BY",
      criterionId: "outside_cis",
      observationId: "observation-outside_cis",
    }]);
    expect(result.ordered.map(({ countryCode, relevance }) => ({ countryCode, relevance })))
      .toEqual([
        { countryCode: "SI", relevance: "-1" },
        { countryCode: "PT", relevance: "-1" },
      ]);
    expect(() => rankPlaces({
      assessmentAt: "2026-08-12",
      preferences: profile,
      places: [place("SI", [known("outside_cis", "1")])],
    })).toThrow();
    expect(() => rankPlaces({
      assessmentAt: "2026-08-12",
      preferences: preferences([weighted("outside_cis")]),
      places: [place("SI", [known("outside_cis", "1", "matches")])],
    })).toThrow();
  });

  test("orders by relevance, coverage, and ISO code without accepting route data", () => {
    const profile = preferences([weighted("personal_safety"), weighted("infrastructure")]);
    const outerFixture = {
      routeIds: ["si-temporary-residence-digital-nomad"],
      places: [
        place("AT", [known("personal_safety", "1"), unknown("infrastructure")]),
        place("DE", [known("personal_safety", "0"), known("infrastructure", "0")]),
        place("SI", [known("personal_safety", "0.5"), known("infrastructure", "0.5")]),
        place("PT", [known("personal_safety", "0.5"), known("infrastructure", "0.5")]),
      ],
    };
    const rank = (places: readonly RankablePlace[]) => rankPlaces({
      assessmentAt: "2026-08-12",
      preferences: profile,
      places,
    });

    const withRoutes = rank(outerFixture.places);
    const withoutRoutes = rank({ ...outerFixture, routeIds: [] }.places);

    expect(withRoutes.ordered.map(({ countryCode, relevance, coverage }) => ({
      countryCode,
      relevance,
      coverage,
    }))).toEqual([
      { countryCode: "PT", relevance: "0.5", coverage: "1" },
      { countryCode: "SI", relevance: "0.5", coverage: "1" },
      { countryCode: "DE", relevance: "0", coverage: "1" },
      { countryCode: "AT", relevance: "0", coverage: "0.5" },
    ]);
    expect(withoutRoutes).toEqual(withRoutes);
    expect(JSON.stringify(withRoutes)).not.toMatch(/route/i);
    expect(Object.isFrozen(withRoutes)).toBe(true);
    expect(Object.isFrozen(withRoutes.ordered)).toBe(true);
    expect(Object.isFrozen(withRoutes.ordered[0]?.coordinate)).toBe(true);
    expect(Object.isFrozen(withRoutes.ordered[0]?.contributions)).toBe(true);
  });
});
