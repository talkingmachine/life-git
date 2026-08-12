import Database from "better-sqlite3";
import { describe, expect, test } from "vitest";

import {
  countryCheckRunId,
  createPlaceFrontierApplication,
  projectTerminalSummary,
  type CountryVerifierPort,
  type FrontierMarker,
  type PlaceFrontierApplicationPorts,
} from "../../src/application/place-frontier";
import type { FormalEvidenceReference, FormalResidenceVerdict } from
  "../../src/decision/formal-residence-verdict";
import type { RankedPlace } from "../../src/decision/place-ranker";
import type { PreferenceProfileDraft } from "../../src/decision/preference-profile";
import type { RelocationProfileDraft } from "../../src/decision/relocation-profile";
import { createEvidenceIntegrity } from "../../src/infrastructure/integrity";
import { openEvidenceDatabase } from "../../src/infrastructure/sqlite/db";
import { SqlitePlaceFrontierStore } from
  "../../src/infrastructure/sqlite/place-frontier-store";

const NOW = "2026-08-12T08:00:00.000Z";
const DAY = "2026-08-12";
const HMAC_KEY = "frontier-test-key";

const relocationProfile: RelocationProfileDraft = {
  currentCountryCode: "RU",
  citizenships: ["RU"],
  monthlyIncome: { amount: "250000", currency: "RUB", basis: "net" },
  remoteWork: { relation: "foreign_employment", legallyAllowed: true },
  education: "higher",
  relevantExperienceYears: 5,
  passportValidUntil: "2030-01-01",
  healthInsurance: "confirmed",
  companions: [],
};

const preferenceProfile: PreferenceProfileDraft = {
  criteria: [{
    id: "personal_safety",
    mode: "weighted",
    importance: 5,
    target: "maximize",
  }],
};

function reference(countryCode: string, evidenceSnapshotId: string): FormalEvidenceReference {
  return {
    evidenceSnapshotId,
    artifactId: `artifact-${countryCode}`,
    sourceId: `source-${countryCode}`,
    navigationUrl: `https://example.test/${countryCode}`,
    resolvedEvidenceUrl: `https://example.test/${countryCode}.pdf`,
    sourcePeriod: "2026-08",
    locator: `section-${countryCode}`,
    excerptSha256: "a".repeat(64),
    validatorVersion: "fixture-validator@1",
  };
}

function viableVerdict(countryCode: string, evidenceSnapshotId: string): FormalResidenceVerdict {
  const proof = reference(countryCode, evidenceSnapshotId);
  const reason = {
    code: `${countryCode}_route_viable`,
    summary: `${countryCode} route is viable`,
    claimIds: [`claim-${countryCode}`],
    evidence: [proof],
    navigation: [],
  };
  return {
    rulesVersion: "formal-residence@1",
    marker: "green",
    verdictAsOf: DAY,
    routeOutcomes: [{
      routeId: `route-${countryCode}`,
      status: "viable",
      ruleEffectiveFrom: "2026-01-01",
      reasons: [reason],
      evidenceSnapshotIds: [evidenceSnapshotId],
      proceduralActions: [],
      contingentActions: [],
    }],
    reasons: [reason],
    catalogCompleteness: {
      status: "unproven",
      reasonCode: "catalog_completeness_unprovable",
    },
  };
}

function unresolvedVerdict(): FormalResidenceVerdict {
  return {
    rulesVersion: "formal-residence@1",
    marker: "yellow",
    verdictAsOf: DAY,
    routeOutcomes: [],
    reasons: [],
    catalogCompleteness: {
      status: "unproven",
      reasonCode: "catalog_completeness_unprovable",
    },
  };
}

function completeAllImpossibleVerdict(
  countryCode: string,
  profileId: string,
  evidenceSnapshotId: string,
): FormalResidenceVerdict {
  const proof = reference(countryCode, evidenceSnapshotId);
  return {
    rulesVersion: "formal-residence@1",
    marker: "red",
    verdictAsOf: DAY,
    routeOutcomes: [],
    reasons: [],
    catalogCompleteness: {
      status: "verified",
      attestation: {
        catalogRevisionId: `catalog-${countryCode}`,
        jurisdiction: countryCode,
        authority: `authority-${countryCode}`,
        scopeKind: "all_long_term_residence_routes_for_profile",
        profileSnapshotId: profileId,
        catalogRoutes: [{
          routeId: `excluded-${countryCode}`,
          applicability: "excluded",
          exclusionCode: "profile_not_eligible",
          claimIds: [`excluded-claim-${countryCode}`],
          evidence: [proof],
        }],
        validatorVersion: "catalog-validator@1",
        effectiveFrom: "2026-01-01",
        evidenceSnapshotId,
        catalogEvidence: [proof],
      },
    },
  };
}

function rankedPlace(countryCode: string, rank: number): RankedPlace {
  return {
    countryCode,
    label: countryCode,
    flag: `flag-${countryCode}`,
    coordinate: { lat: 40 + rank, lng: 10 + rank },
    factors: [{
      criterionId: "personal_safety",
      state: "known",
      match: "1",
      observationId: `observation-${countryCode}`,
      evaluatorVersion: "fixture-factor@1",
    }],
    rank,
    relevance: "1",
    coverage: "1",
    contributions: [{
      criterionId: "personal_safety",
      state: "known",
      effectiveMatch: "1",
      weightedContribution: "5",
      observationId: `observation-${countryCode}`,
    }],
  };
}

interface HarnessOptions {
  readonly rankedCountries: readonly string[];
  readonly markerByCountry?: Readonly<Record<string, "green" | "yellow" | "red">>;
  readonly knowledgeRevisionIds?: Readonly<Record<string, string | null>>;
  readonly failCheckFor?: string;
}

function harness(options: HarnessOptions) {
  const database = openEvidenceDatabase(":memory:");
  const integrity = createEvidenceIntegrity(HMAC_KEY);
  const store = new SqlitePlaceFrontierStore(database, HMAC_KEY);
  const profiles = new Map<string, unknown>();
  const preferences = new Map<string, unknown>();
  const checks: string[] = [];
  const verifierResults = new Map<string, Awaited<ReturnType<CountryVerifierPort["check"]>>>();
  let rankCalls = 0;
  let currentInputCalls = 0;

  const ports: PlaceFrontierApplicationPorts = {
    profiles: {
      appendRelocation: async (snapshot) => { profiles.set(snapshot.id, snapshot); },
      loadRelocationVerified: async (id) => {
        const snapshot = profiles.get(id);
        if (snapshot === undefined) throw new Error("profile_not_found");
        return structuredClone(snapshot) as never;
      },
      appendPreference: async (snapshot) => { preferences.set(snapshot.id, snapshot); },
      loadPreferenceVerified: async (id) => {
        const snapshot = preferences.get(id);
        if (snapshot === undefined) throw new Error("profile_not_found");
        return structuredClone(snapshot) as never;
      },
    },
    rankingInputs: {
      freezeCurrent: async () => {
        currentInputCalls += 1;
        return {
          places: options.rankedCountries.map(rankedPlace),
          knowledgeRevisionIds: options.knowledgeRevisionIds ?? Object.fromEntries(
            options.rankedCountries.map((countryCode) => [countryCode, null]),
          ),
        };
      },
    },
    rank: ({ places }) => {
      rankCalls += 1;
      return {
        ordered: places.map((place, index) => rankedPlace(place.countryCode, index + 1)),
        excluded: [],
        rulesVersion: "place-ranker@1",
      };
    },
    store,
    knowledge: {
      loadVerified: async (id) => ({
        id,
        countryCode: id.split(":").at(-1)!,
      }),
    },
    verifier: {
      check: async ({ country, profileId, parentRunId }) => {
        checks.push(country.countryCode);
        if (options.failCheckFor === country.countryCode) throw new Error("verification_failed");
        const evidenceSnapshotId = `evidence-${country.countryCode}`;
        const marker = options.markerByCountry?.[country.countryCode] ?? "green";
        const verdict = marker === "green"
          ? viableVerdict(country.countryCode, evidenceSnapshotId)
          : marker === "red"
            ? completeAllImpossibleVerdict(country.countryCode, profileId, evidenceSnapshotId)
            : unresolvedVerdict();
        const result = {
          countryCheckRunId: countryCheckRunId(parentRunId, country.countryCode),
          sourceAssessmentRulesVersion: "cold-start-assessment@1" as const,
          verdict,
          evidenceSnapshotId,
          lastCheckedAt: DAY,
        };
        verifierResults.set(country.countryCode, result);
        return result;
      },
      present: async ({ parentRunId, countryCode, countryCheckRunId: childRunId }) => {
        if (childRunId !== countryCheckRunId(parentRunId, countryCode)) {
          throw new Error("integrity_mismatch");
        }
        const result = verifierResults.get(countryCode);
        if (result === undefined) throw new Error("integrity_mismatch");
        return {
          sourceAssessmentRulesVersion: result.sourceAssessmentRulesVersion,
          verdict: result.verdict,
          evidenceSnapshotId: result.evidenceSnapshotId,
          lastCheckedAt: result.lastCheckedAt,
        };
      },
    },
    integrity,
    clock: () => new Date(NOW),
    nextRunId: () => "frontier-run-1",
  };
  const application = createPlaceFrontierApplication(ports);

  return {
    application,
    database,
    store,
    checks,
    verifierResults,
    counts: {
      rank: () => rankCalls,
      currentInput: () => currentInputCalls,
    },
    async prepare() {
      return application.preparePlaceFrontier({
        profile: relocationProfile,
        preferences: preferenceProfile,
      });
    },
    async run() {
      const prepared = await this.prepare();
      const events: unknown[] = [];
      const result = await application.runPlaceFrontier(
        prepared,
        (event) => { events.push(event); },
        new AbortController().signal,
      );
      return { prepared, result, events };
    },
  };
}

function resignShortlist(
  database: Database.Database,
  mutate: (payload: Record<string, unknown>) => void,
): void {
  database.exec("DROP TRIGGER place_frontier_snapshots_no_update");
  const row = database.prepare(`
    SELECT id, payload_json FROM place_frontier_snapshots WHERE kind = 'shortlist'
  `).get() as { readonly id: string; readonly payload_json: string };
  const payload = JSON.parse(row.payload_json) as Record<string, unknown>;
  mutate(payload);
  const integrity = createEvidenceIntegrity(HMAC_KEY);
  const payloadJson = integrity.canonical(payload);
  database.prepare(`
    UPDATE place_frontier_snapshots
    SET payload_json = ?, payload_hash = ?, hmac = ?
    WHERE id = ?
  `).run(payloadJson, integrity.hash(payloadJson), integrity.sign(payloadJson), row.id);
}

describe("frozen CountryFrontier", () => {
  test("activates five, preserves every marker and replaces only red until five are non-red", async () => {
    const fixture = harness({
      rankedCountries: ["DE", "ES", "FR", "IT", "PT", "SI"],
      markerByCountry: {
        DE: "green",
        ES: "red",
        FR: "yellow",
        IT: "green",
        PT: "green",
        SI: "green",
      },
    });

    const { prepared, result, events } = await fixture.run();
    expect(projectTerminalSummary(result)).toEqual({
      countries: ["DE", "FR", "IT", "PT", "SI"],
      composition: { green: 4, yellow: 1 },
      stopCondition: "five_non_red",
      preliminary: true,
    });
    expect(result.shortlistSnapshot.markers.map(({ country, formalVerdict }) => [
      country.countryCode,
      formalVerdict.marker,
    ])).toEqual([
      ["DE", "green"],
      ["ES", "red"],
      ["FR", "yellow"],
      ["IT", "green"],
      ["PT", "green"],
      ["SI", "green"],
    ]);
    expect(fixture.checks).toEqual(["DE", "ES", "FR", "IT", "PT", "SI"]);
    expect(fixture.counts.rank()).toBe(1);
    expect(fixture.counts.currentInput()).toBe(1);
    expect(events.map((event) => (event as { type: string }).type)).toEqual([
      "ranking_sealed",
      "country_activated",
      "country_activated",
      "country_activated",
      "country_activated",
      "country_activated",
      "country_completed",
      "country_completed",
      "country_activated",
      "country_completed",
      "country_completed",
      "country_completed",
      "country_completed",
      "frontier_completed",
    ]);

    const rankingRows = fixture.database.prepare(
      "SELECT COUNT(*) AS count FROM place_frontier_snapshots WHERE kind = 'ranking'",
    ).get();
    expect(rankingRows).toEqual({ count: 1 });
    expect(await fixture.application.presentPlaceFrontier(prepared.runId)).toEqual(result);
    expect(fixture.counts.rank()).toBe(1);
    expect(fixture.counts.currentInput()).toBe(1);
  });

  test("honestly exhausts the installed SI-only coverage with one preliminary country", async () => {
    const fixture = harness({ rankedCountries: ["SI"] });
    const { result } = await fixture.run();

    expect(projectTerminalSummary(result)).toEqual({
      countries: ["SI"],
      composition: { green: 1, yellow: 0 },
      stopCondition: "installed_coverage_exhausted",
      preliminary: true,
    });
    expect(Object.keys(result)).toEqual([
      "runId",
      "assessmentAt",
      "rankingSnapshot",
      "shortlistSnapshot",
    ]);
    expect(JSON.stringify(result.shortlistSnapshot)).not.toMatch(
      /countries|composition|stopCondition|preliminary/,
    );
  });

  test("seals ranking during prepare and never changes it after a country publishes Knowledge", async () => {
    const fixture = harness({
      rankedCountries: ["DE", "SI"],
      knowledgeRevisionIds: { DE: null, SI: "knowledge:SI" },
    });
    const prepared = await fixture.prepare();
    const frozen = await fixture.store.loadRankingVerified(prepared.rankingSnapshotId);

    await expect(fixture.application.runPlaceFrontier(
      prepared,
      () => undefined,
      new AbortController().signal,
    )).resolves.toBeDefined();
    expect(await fixture.store.loadRankingVerified(prepared.rankingSnapshotId)).toEqual(frozen);
    expect(fixture.counts.rank()).toBe(1);
  });

  test("does not publish a shortlist after verifier failure", async () => {
    const fixture = harness({ rankedCountries: ["DE", "ES"], failCheckFor: "ES" });
    const prepared = await fixture.prepare();

    await expect(fixture.application.runPlaceFrontier(
      prepared,
      () => undefined,
      new AbortController().signal,
    )).rejects.toThrow("verification_failed");
    expect(fixture.database.prepare(
      "SELECT kind FROM place_frontier_snapshots ORDER BY kind",
    ).all()).toEqual([{ kind: "ranking" }]);
    await expect(fixture.application.presentPlaceFrontier(prepared.runId))
      .rejects.toThrow("snapshot_not_found");
  });
});

describe("frontier snapshot integrity", () => {
  test.each([
    ["marker order", (markers: FrontierMarker[]) => markers.reverse()],
    ["rank", (markers: FrontierMarker[]) => { markers[0] = { ...markers[0]!, rank: 99 }; }],
    ["duplicate", (markers: FrontierMarker[]) => { markers[1] = markers[0]!; }],
    ["premature termination", (markers: FrontierMarker[]) => { markers.splice(5); }],
    ["rules version", (_markers: FrontierMarker[], payload: Record<string, unknown>) => {
      payload.rulesVersion = "country-frontier@2";
    }],
  ] as const)("rejects a re-signed shortlist with invalid %s", async (_name, mutate) => {
    const fixture = harness({
      rankedCountries: ["DE", "ES", "FR", "IT", "PT", "SI"],
      markerByCountry: { DE: "green", ES: "red", FR: "yellow", IT: "green", PT: "green", SI: "green" },
    });
    const { prepared } = await fixture.run();
    resignShortlist(fixture.database, (payload) => {
      mutate(payload.markers as FrontierMarker[], payload);
    });

    await expect(fixture.store.loadShortlistVerified(prepared.runId))
      .rejects.toThrow("integrity_mismatch");
  });

  test.each([
    ["formal verdict rulesVersion", (marker: FrontierMarker) => ({
      ...marker,
      formalVerdict: { ...marker.formalVerdict, rulesVersion: "formal-residence@2" },
    })],
    ["source assessment rulesVersion", (marker: FrontierMarker) => ({
      ...marker,
      sourceAssessmentRulesVersion: "cold-start-assessment@2",
    })],
    ["deterministic child run", (marker: FrontierMarker) => ({
      ...marker,
      countryCheckRunId: "frontier-country:swapped",
    })],
  ] as const)("rejects a re-signed marker with invalid %s", async (_name, mutate) => {
    const fixture = harness({ rankedCountries: ["SI"] });
    const { prepared } = await fixture.run();
    resignShortlist(fixture.database, (payload) => {
      const markers = payload.markers as FrontierMarker[];
      markers[0] = mutate(markers[0]!) as FrontierMarker;
    });

    await expect(fixture.application.presentPlaceFrontier(prepared.runId))
      .rejects.toThrow("integrity_mismatch");
  });

  test("requires exact Knowledge key coverage and country ownership", async () => {
    const missingKey = harness({
      rankedCountries: ["DE", "SI"],
      knowledgeRevisionIds: { SI: null },
    });
    await expect(missingKey.prepare()).rejects.toThrow("integrity_mismatch");

    const wrongOwner = harness({
      rankedCountries: ["SI"],
      knowledgeRevisionIds: { SI: "knowledge:DE" },
    });
    const { prepared } = await wrongOwner.run();
    await expect(wrongOwner.application.presentPlaceFrontier(prepared.runId))
      .rejects.toThrow("integrity_mismatch");
  });

  test("immutable triggers reject update and delete without a redundant lookup index", async () => {
    const fixture = harness({ rankedCountries: ["SI"] });
    const { prepared } = await fixture.run();

    expect(() => fixture.database.prepare(
      "UPDATE place_frontier_snapshots SET created_at = created_at WHERE run_id = ?",
    ).run(prepared.runId)).toThrow("place_frontier_snapshot_is_immutable");
    expect(() => fixture.database.prepare(
      "DELETE FROM place_frontier_snapshots WHERE run_id = ?",
    ).run(prepared.runId)).toThrow("place_frontier_snapshot_is_immutable");
    expect(fixture.database.prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'index' AND tbl_name = 'place_frontier_snapshots'
        AND name NOT LIKE 'sqlite_autoindex%'
    `).all()).toEqual([]);
  });
});
