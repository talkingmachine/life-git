import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import { describe, expect, test, vi } from "vitest";

import {
  countryCheckRunId,
  createPlaceFrontierApplication,
  projectTerminalSummary,
  type CountryVerifierPort,
  type FrontierMarker,
  type PlaceFrontierApplicationPorts,
  type RankingSnapshot,
  type ShortlistSnapshot,
} from "../../src/application/place-frontier";
import type { ColdStartEvent } from "../../src/application/cold-start";
import type { FormalEvidenceReference, FormalResidenceVerdict } from
  "../../src/decision/formal-residence-verdict";
import type { RankedPlace } from "../../src/decision/place-ranker";
import type { PreferenceProfileDraft } from "../../src/decision/preference-profile";
import type { RelocationProfileDraft } from "../../src/decision/relocation-profile";
import { canonicalJson, createEvidenceIntegrity } from "../../src/infrastructure/integrity";
import { createColdStartComposition } from "../../src/infrastructure/cold-start-composition";
import { createPlaceFrontierComposition } from
  "../../src/infrastructure/place-frontier-composition";
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
  readonly excluded?: RankingSnapshot["excluded"];
  readonly progressEvents?: readonly Exclude<ColdStartEvent, { readonly type: "assessment_completed" }>[];
  readonly mutateCheckResult?: (result: Awaited<ReturnType<CountryVerifierPort["check"]>>) => unknown;
  readonly publishKnowledgeDuringCheck?: boolean;
  readonly abortDuringCheck?: AbortController;
  readonly failShortlistAppend?: boolean;
}

function harness(options: HarnessOptions) {
  const database = openEvidenceDatabase(":memory:");
  const integrity = createEvidenceIntegrity(HMAC_KEY);
  const store = new SqlitePlaceFrontierStore(database, HMAC_KEY);
  const profiles = new Map<string, unknown>();
  const preferences = new Map<string, unknown>();
  const checks: string[] = [];
  const verifierResults = new Map<string, Awaited<ReturnType<CountryVerifierPort["check"]>>>();
  const knowledgeOwners = new Map<string, string>();
  for (const id of Object.values(options.knowledgeRevisionIds ?? {})) {
    if (id !== null) knowledgeOwners.set(id, id.split(":").at(-1)!);
  }
  let rankCalls = 0;
  let currentInputCalls = 0;
  let presentCalls = 0;

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
        excluded: options.excluded ?? [],
        rulesVersion: "place-ranker@1",
      };
    },
    store: options.failShortlistAppend
      ? {
          appendRanking: (snapshot) => store.appendRanking(snapshot),
          appendShortlist: async () => { throw new Error("storage_failed"); },
          loadRankingVerified: (id) => store.loadRankingVerified(id),
          loadShortlistVerified: (runId) => store.loadShortlistVerified(runId),
        }
      : store,
    knowledge: {
      loadVerified: async (id) => ({ id, countryCode: knowledgeOwners.get(id) ?? id.split(":").at(-1)! }),
    },
    verifier: {
      check: async ({ country, profileId, parentRunId, emitProgress }) => {
        checks.push(country.countryCode);
        if (options.failCheckFor === country.countryCode) throw new Error("verification_failed");
        for (const progress of options.progressEvents ?? []) await emitProgress(progress);
        const evidenceSnapshotId = `evidence-${country.countryCode}`;
        const marker = options.markerByCountry?.[country.countryCode] ?? "green";
        const verdict = marker === "green"
          ? viableVerdict(country.countryCode, evidenceSnapshotId)
          : marker === "red"
            ? completeAllImpossibleVerdict(country.countryCode, profileId, evidenceSnapshotId)
            : unresolvedVerdict();
        const publishedKnowledgeId = `knowledge-published:${country.countryCode}`;
        if (options.publishKnowledgeDuringCheck) {
          knowledgeOwners.set(publishedKnowledgeId, country.countryCode);
        }
        const result = {
          countryCheckRunId: countryCheckRunId(parentRunId, country.countryCode),
          sourceAssessmentRulesVersion: "cold-start-assessment@1" as const,
          verdict,
          evidenceSnapshotId,
          ...(options.publishKnowledgeDuringCheck
            ? {
                currentKnowledgeRevisionId: publishedKnowledgeId,
                updatedKnowledgeRevisionId: publishedKnowledgeId,
                knowledgeUpdatedAt: NOW,
              }
            : {}),
          lastCheckedAt: DAY,
        };
        options.abortDuringCheck?.abort(new DOMException("aborted", "AbortError"));
        const checked = (options.mutateCheckResult?.(result) ?? result) as
          Awaited<ReturnType<CountryVerifierPort["check"]>>;
        verifierResults.set(country.countryCode, checked);
        return checked;
      },
      present: async ({ parentRunId, countryCode, countryCheckRunId: childRunId }) => {
        presentCalls += 1;
        if (childRunId !== countryCheckRunId(parentRunId, countryCode)) {
          throw new Error("integrity_mismatch");
        }
        const result = verifierResults.get(countryCode);
        if (result === undefined) throw new Error("integrity_mismatch");
        return {
          sourceAssessmentRulesVersion: result.sourceAssessmentRulesVersion,
          verdict: result.verdict,
          evidenceSnapshotId: result.evidenceSnapshotId,
          ...(result.currentKnowledgeRevisionId === undefined ? {} : {
            currentKnowledgeRevisionId: result.currentKnowledgeRevisionId,
          }),
          ...(result.updatedKnowledgeRevisionId === undefined ? {} : {
            updatedKnowledgeRevisionId: result.updatedKnowledgeRevisionId,
          }),
          ...(result.knowledgeUpdatedAt === undefined ? {} : {
            knowledgeUpdatedAt: result.knowledgeUpdatedAt,
          }),
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
    profiles,
    preferences,
    knowledgeOwners,
    counts: {
      rank: () => rankCalls,
      currentInput: () => currentInputCalls,
      present: () => presentCalls,
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

function resignSnapshot(
  database: Database.Database,
  kind: "ranking" | "shortlist",
  mutate: (payload: Record<string, unknown>) => void,
): void {
  database.exec("DROP TRIGGER place_frontier_snapshots_no_update");
  const row = database.prepare(`
    SELECT id, payload_json FROM place_frontier_snapshots WHERE kind = ?
  `).get(kind) as { readonly id: string; readonly payload_json: string };
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

function resignShortlist(
  database: Database.Database,
  mutate: (payload: Record<string, unknown>) => void,
): void {
  resignSnapshot(database, "shortlist", mutate);
}

function nonTerminalProgressEvents(): readonly Exclude<
  ColdStartEvent,
  { readonly type: "assessment_completed" }
>[] {
  const base = {
    runId: "child-run",
    sequence: 1,
    occurredAt: NOW,
    country: {
      code: "SI" as const,
      englishName: "Slovenia" as const,
      displayName: "Словения" as const,
      flag: "🇸🇮" as const,
      coordinate: { lat: 46.1512 as const, lng: 14.9955 as const },
    },
  };
  return [
    { ...base, type: "source_discovered", payload: { candidateId: "candidate-1", url: "https://gov.test/source", claimKinds: ["income"] } },
    { ...base, sequence: 2, type: "authority_verified", payload: { candidateId: "candidate-1", authorityRoot: "https://gov.test" } },
    { ...base, sequence: 3, type: "artifact_captured", payload: { sourceId: "si-income-threshold", role: "official rule", resolvedUrl: "https://gov.test/rule.pdf", sha256: "b".repeat(64) } },
    { ...base, sequence: 4, type: "claim_verified", payload: { claimId: "claim-1", claimKind: "income", sourceIds: ["si-income-threshold"] } },
    { ...base, sequence: 5, type: "dossier_published", payload: { dossierVersionId: "dossier-1", label: "Slovenia dossier", created: true } },
  ];
}

async function concurrentStoreWrites(input: {
  readonly path: string;
  readonly method: "appendRanking" | "appendShortlist";
  readonly snapshots: readonly [
    RankingSnapshot | ShortlistSnapshot,
    RankingSnapshot | ShortlistSnapshot,
  ];
}): Promise<readonly string[]> {
  const barrier = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
  const state = new Int32Array(barrier);
  const storePath = join(process.cwd(), "src/infrastructure/sqlite/place-frontier-store.ts");
  const workerSource = `
    const { parentPort, workerData } = require("node:worker_threads");
    require("tsx/cjs");
    const Database = require("better-sqlite3");
    const { SqlitePlaceFrontierStore } = require(workerData.storePath);
    const database = new Database(workerData.path);
    database.pragma("foreign_keys = ON");
    const state = new Int32Array(workerData.barrier);
    parentPort.postMessage({ type: "ready" });
    Atomics.wait(state, 0, 0);
    Promise.resolve(new SqlitePlaceFrontierStore(database, workerData.key)[workerData.method](
      workerData.snapshot,
    )).then(() => {
      database.close();
      parentPort.postMessage({ type: "done" });
    }, (error) => {
      database.close();
      parentPort.postMessage({ type: "error", message: error.message });
    });
  `;
  const workers = input.snapshots.map((snapshot) => new Worker(workerSource, {
    eval: true,
    workerData: {
      path: input.path,
      method: input.method,
      snapshot,
      storePath,
      key: HMAC_KEY,
      barrier,
    },
  }));
  let ready = 0;
  const outcomes: string[] = [];
  try {
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const timeout = setTimeout(() => {
        settled = true;
        reject(new Error("concurrent_store_write_timeout"));
      }, 10_000);
      const finish = (error?: Error) => {
        if (settled) return;
        if (error !== undefined) {
          settled = true;
          clearTimeout(timeout);
          reject(error);
          return;
        }
        if (outcomes.length === workers.length) {
          settled = true;
          clearTimeout(timeout);
          resolve();
        }
      };
      for (const worker of workers) {
        worker.on("error", (error) => finish(error));
        worker.on("message", (message: { readonly type: string; readonly message?: string }) => {
          if (message.type === "ready") {
            ready += 1;
            if (ready === workers.length) {
              Atomics.store(state, 0, 1);
              Atomics.notify(state, 0, workers.length);
            }
            return;
          }
          if (message.type === "error") {
            outcomes.push(message.message ?? "unknown_worker_error");
          } else {
            outcomes.push("done");
          }
          finish();
        });
      }
    });
  } finally {
    await Promise.all(workers.map((worker) => worker.terminate()));
  }
  return outcomes.sort();
}

describe("frozen CountryFrontier", () => {
  test("keeps caller-controlled run IDs out of the public cold-start application", async () => {
    let generatedIds = 0;
    const application = createColdStartComposition({
      database: openEvidenceDatabase(":memory:"),
      hmacKey: HMAC_KEY,
      nextRunId: () => `cold-run-${++generatedIds}`,
    });

    expect("prepareColdStartWithRunId" in application).toBe(false);
    await expect(application.prepare({
      countryInput: "SI",
      profile: relocationProfile,
    })).resolves.toEqual(expect.objectContaining({ runId: "cold-run-1" }));
    expect(generatedIds).toBe(1);
  });

  test("production frontier is SI-only, consumes no child ID and replays with zero network", async () => {
    const database = openEvidenceDatabase(":memory:");
    const requestStep = vi.fn(async () => {
      throw new Error("network_must_not_run");
    });
    let generatedIds = 0;
    const application = createPlaceFrontierComposition({
      database,
      hmacKey: HMAC_KEY,
      countrySourceIndex: {
        lookup: () => ({
          ok: false as const,
          kind: "country_not_installed" as const,
          candidates: [] as const,
        }),
      },
      requestStep,
      clock: () => new Date(NOW),
      nextRunId: () => `frontier-run-${++generatedIds}`,
    });
    const prepared = await application.preparePlaceFrontier({
      profile: relocationProfile,
      preferences: preferenceProfile,
    });

    const result = await application.runPlaceFrontier(
      prepared,
      () => undefined,
      new AbortController().signal,
    );
    const callsBeforeReplay = requestStep.mock.calls.length;
    const replay = await application.presentPlaceFrontier(prepared.runId);

    expect(result.rankingSnapshot.ordered.map(({ countryCode }) => countryCode)).toEqual(["SI"]);
    expect(result.shortlistSnapshot.markers.map(({ country }) => country.countryCode)).toEqual(["SI"]);
    expect(replay).toEqual(result);
    expect(requestStep).toHaveBeenCalledTimes(callsBeforeReplay);
    expect(generatedIds).toBe(1);
  });

  test("forwards every typed child progress payload with frontier sequencing", async () => {
    const fixture = harness({
      rankedCountries: ["SI"],
      progressEvents: nonTerminalProgressEvents(),
    });

    const { events } = await fixture.run();
    expect(events.filter((event) => (event as { type: string }).type === "country_progress"))
      .toEqual([
        expect.objectContaining({
          sequence: 3,
          payload: {
            countryCode: "SI",
            stage: "source_discovered",
            label: "candidate-1",
            sourceUrl: "https://gov.test/source",
          },
        }),
        expect.objectContaining({
          sequence: 4,
          payload: {
            countryCode: "SI",
            stage: "authority_verified",
            label: "candidate-1",
            detail: "https://gov.test",
          },
        }),
        expect.objectContaining({
          sequence: 5,
          payload: {
            countryCode: "SI",
            stage: "artifact_captured",
            label: "official rule",
            detail: "sha256:" + "b".repeat(64),
            sourceUrl: "https://gov.test/rule.pdf",
          },
        }),
        expect.objectContaining({
          sequence: 6,
          payload: {
            countryCode: "SI",
            stage: "claim_verified",
            label: "claim-1",
            detail: "income · si-income-threshold",
          },
        }),
        expect.objectContaining({
          sequence: 7,
          payload: {
            countryCode: "SI",
            stage: "dossier_published",
            label: "Slovenia dossier",
            detail: "dossier-1 · created",
          },
        }),
      ]);
  });

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

  test("keeps the frozen ranking when a child publishes a genuinely new Knowledge revision", async () => {
    const fixture = harness({
      rankedCountries: ["DE", "SI"],
      knowledgeRevisionIds: { DE: null, SI: "knowledge-before:SI" },
      publishKnowledgeDuringCheck: true,
    });
    const prepared = await fixture.prepare();
    const frozen = await fixture.store.loadRankingVerified(prepared.rankingSnapshotId);

    const result = await fixture.application.runPlaceFrontier(
      prepared,
      () => undefined,
      new AbortController().signal,
    );

    expect(result.rankingSnapshot).toEqual(frozen);
    expect(result.rankingSnapshot.knowledgeRevisionIds.SI).toBe("knowledge-before:SI");
    expect(result.shortlistSnapshot.markers.find(({ country }) => country.countryCode === "SI"))
      .toEqual(expect.objectContaining({
        currentKnowledgeRevisionId: "knowledge-published:SI",
        updatedKnowledgeRevisionId: "knowledge-published:SI",
      }));
  });

  test("binds prepared assessmentAt before invoking any verifier", async () => {
    const fixture = harness({ rankedCountries: ["SI"] });
    const prepared = await fixture.prepare();

    await expect(fixture.application.runPlaceFrontier(
      { ...prepared, assessmentAt: "2026-08-13T08:00:00.000Z" },
      () => undefined,
      new AbortController().signal,
    )).rejects.toThrow("integrity_mismatch");
    expect(fixture.checks).toEqual([]);
  });

  test("counts repeated required mismatch rows as one Knowledge country", async () => {
    const fixture = harness({
      rankedCountries: ["SI"],
      knowledgeRevisionIds: { SI: null, DE: null },
      excluded: [
        { countryCode: "DE", criterionId: "personal_safety", observationId: "observation-de-1" },
        { countryCode: "DE", criterionId: "infrastructure", observationId: "observation-de-2" },
      ],
    });

    await expect(fixture.prepare()).resolves.toBeDefined();
  });

  test.each([
    ["invalid date", (result: Awaited<ReturnType<CountryVerifierPort["check"]>>) => ({
      ...result,
      lastCheckedAt: "2026-02-30",
    })],
    ["partial verdict", (result: Awaited<ReturnType<CountryVerifierPort["check"]>>) => ({
      ...result,
      verdict: { rulesVersion: "formal-residence@1", marker: "green" },
    })],
    ["unknown marker field", (result: Awaited<ReturnType<CountryVerifierPort["check"]>>) => ({
      ...result,
      unexpected: true,
    })],
  ] as const)("rejects malformed verifier output (%s) before shortlist persistence", async (
    _name,
    mutateCheckResult,
  ) => {
    const fixture = harness({ rankedCountries: ["SI"], mutateCheckResult });
    const prepared = await fixture.prepare();

    await expect(fixture.application.runPlaceFrontier(
      prepared,
      () => undefined,
      new AbortController().signal,
    )).rejects.toThrow("integrity_mismatch");
    expect(fixture.database.prepare(
      "SELECT kind FROM place_frontier_snapshots ORDER BY kind",
    ).all()).toEqual([{ kind: "ranking" }]);
  });

  test.each([
    ["post-check abort", { abort: true, storage: false }, "aborted"],
    ["shortlist storage failure", { abort: false, storage: true }, "storage_failed"],
  ] as const)("does not publish a shortlist after %s", async (_name, mode, message) => {
    const abortController = new AbortController();
    const fixture = harness({
      rankedCountries: ["SI"],
      ...(mode.abort ? { abortDuringCheck: abortController } : {}),
      failShortlistAppend: mode.storage,
    });
    const prepared = await fixture.prepare();

    await expect(fixture.application.runPlaceFrontier(
      prepared,
      () => undefined,
      abortController.signal,
    )).rejects.toThrow(message);
    expect(fixture.database.prepare(
      "SELECT kind FROM place_frontier_snapshots ORDER BY kind",
    ).all()).toEqual([{ kind: "ranking" }]);
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
    "relocation profile",
    "preference profile",
    "ranking Knowledge revision",
    "marker Evidence snapshot",
    "current Knowledge revision",
    "updated Knowledge revision",
    "child cold-start run",
    "completeness Evidence reference",
    "formal verdict rules version",
    "source assessment rules version",
  ] as const)("rejects an invalid referenced graph at %s without rechecking a country", async (family) => {
    const fixture = harness({
      rankedCountries: ["SI"],
      ...(family === "completeness Evidence reference"
        ? { markerByCountry: { SI: "red" as const } }
        : {}),
      ...(family === "current Knowledge revision" || family === "updated Knowledge revision"
        ? { publishKnowledgeDuringCheck: true }
        : {}),
    });
    const { prepared } = await fixture.run();
    const checksBeforePresentation = [...fixture.checks];

    if (family === "relocation profile") {
      const profile = fixture.profiles.get(prepared.profileId) as Record<string, unknown>;
      fixture.profiles.set(prepared.profileId, { ...profile, id: "0".repeat(64) });
    } else if (family === "preference profile") {
      const preferences = fixture.preferences.get(prepared.preferenceProfileId) as
        Record<string, unknown>;
      fixture.preferences.set(prepared.preferenceProfileId, {
        ...preferences,
        id: "0".repeat(64),
      });
    } else if (family === "ranking Knowledge revision") {
      resignSnapshot(fixture.database, "ranking", (payload) => {
        payload.knowledgeRevisionIds = { SI: "knowledge:DE" };
      });
    } else {
      resignSnapshot(fixture.database, "shortlist", (payload) => {
        const marker = (payload.markers as Record<string, unknown>[])[0]!;
        if (family === "marker Evidence snapshot") {
          marker.evidenceSnapshotId = "other-evidence";
        } else if (family === "current Knowledge revision") {
          marker.currentKnowledgeRevisionId = "knowledge-other:SI";
        } else if (family === "updated Knowledge revision") {
          marker.updatedKnowledgeRevisionId = "knowledge-other:SI";
        } else if (family === "child cold-start run") {
          marker.countryCheckRunId = `frontier-country:${"0".repeat(64)}`;
        } else if (family === "formal verdict rules version") {
          (marker.formalVerdict as Record<string, unknown>).rulesVersion = "formal-residence@2";
        } else if (family === "source assessment rules version") {
          marker.sourceAssessmentRulesVersion = "cold-start-assessment@2";
        } else {
          const verdict = marker.formalVerdict as {
            catalogCompleteness: {
              attestation: { catalogEvidence: Record<string, unknown>[] };
            };
          };
          verdict.catalogCompleteness.attestation.catalogEvidence[0]!.evidenceSnapshotId =
            "other-evidence";
        }
      });
    }

    await expect(fixture.application.presentPlaceFrontier(prepared.runId))
      .rejects.toThrow("integrity_mismatch");
    expect(fixture.checks).toEqual(checksBeforePresentation);
    expect(fixture.counts.present()).toBe(
      family === "current Knowledge revision" || family === "updated Knowledge revision" ? 1 : 0,
    );
  });

  test.each([
    ["extra ranking field", "ranking", (payload: Record<string, unknown>) => {
      payload.unexpected = true;
    }],
    ["invalid assessment instant", "ranking", (payload: Record<string, unknown>) => {
      payload.assessmentAt = "2026-08-12";
    }],
    ["contextHash not recomputed", "ranking", (payload: Record<string, unknown>) => {
      payload.contextHash = "f".repeat(64);
    }],
    ["extra shortlist field", "shortlist", (payload: Record<string, unknown>) => {
      payload.unexpected = true;
    }],
  ] as const)("rejects re-signed closed-schema violation: %s", async (_name, kind, mutate) => {
    const fixture = harness({ rankedCountries: ["SI"] });
    const { prepared } = await fixture.run();
    resignSnapshot(fixture.database, kind, mutate);

    const load = kind === "ranking"
      ? fixture.store.loadRankingVerified(prepared.rankingSnapshotId)
      : fixture.store.loadShortlistVerified(prepared.runId);
    await expect(load).rejects.toThrow("integrity_mismatch");
  });

  test("converges identical append retries and rejects conflicting retries", async () => {
    const fixture = harness({ rankedCountries: ["SI"] });
    const prepared = await fixture.prepare();
    const ranking = await fixture.store.loadRankingVerified(prepared.rankingSnapshotId);

    await expect(fixture.store.appendRanking(ranking)).resolves.toBeUndefined();
    await expect(fixture.store.appendRanking({
      ...ranking,
      contextHash: "f".repeat(64),
    })).rejects.toThrow("integrity_mismatch");
    expect(fixture.database.prepare(
      "SELECT COUNT(*) AS count FROM place_frontier_snapshots WHERE kind = 'ranking'",
    ).get()).toEqual({ count: 1 });
  });

  test("converges identical shortlist retries and rejects conflicting retries", async () => {
    const fixture = harness({ rankedCountries: ["SI"] });
    const { prepared, result } = await fixture.run();

    await expect(fixture.store.appendShortlist(result.shortlistSnapshot)).resolves.toBeUndefined();
    await expect(fixture.store.appendShortlist({
      ...result.shortlistSnapshot,
      createdAt: "2026-08-12T09:00:00.000Z",
    })).rejects.toThrow("integrity_mismatch");
    expect(fixture.database.prepare(
      "SELECT COUNT(*) AS count FROM place_frontier_snapshots WHERE kind = 'shortlist'",
    ).get()).toEqual({ count: 1 });
    expect(await fixture.store.loadShortlistVerified(prepared.runId))
      .toEqual(result.shortlistSnapshot);
  });

  test("converges identical writes through two real SQLite connections", async () => {
    const directory = mkdtempSync(join(tmpdir(), "place-frontier-race-"));
    const path = join(directory, "frontier.sqlite");
    try {
      const firstDatabase = openEvidenceDatabase(path);
      const fixture = harness({ rankedCountries: ["SI"] });
      const prepared = await fixture.prepare();
      const ranking = await fixture.store.loadRankingVerified(prepared.rankingSnapshotId);

      await expect(concurrentStoreWrites({
        path,
        method: "appendRanking",
        snapshots: [ranking, ranking],
      })).resolves.toEqual(["done", "done"]);
      expect(firstDatabase.prepare(
        "SELECT COUNT(*) AS count FROM place_frontier_snapshots",
      ).get()).toEqual({ count: 1 });
      firstDatabase.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("keeps one verified winner for conflicting concurrent ranking writes", async () => {
    const directory = mkdtempSync(join(tmpdir(), "place-frontier-conflict-race-"));
    const path = join(directory, "frontier.sqlite");
    try {
      const database = openEvidenceDatabase(path);
      const fixture = harness({ rankedCountries: ["SI"] });
      const prepared = await fixture.prepare();
      const ranking = await fixture.store.loadRankingVerified(prepared.rankingSnapshotId);
      const conflicting = {
        ...ranking,
        ordered: ranking.ordered.map((place) => ({ ...place, label: "conflicting-label" })),
      };

      await expect(concurrentStoreWrites({
        path,
        method: "appendRanking",
        snapshots: [ranking, conflicting],
      })).resolves.toEqual(["done", "integrity_mismatch"]);
      const winner = await new SqlitePlaceFrontierStore(database, HMAC_KEY)
        .loadRankingVerified(prepared.runId);
      expect([canonicalJson(ranking), canonicalJson(conflicting)])
        .toContain(canonicalJson(winner));
      expect(database.prepare(
        "SELECT COUNT(*) AS count FROM place_frontier_snapshots",
      ).get()).toEqual({ count: 1 });
      database.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("converges identical shortlist writes through two real SQLite connections", async () => {
    const directory = mkdtempSync(join(tmpdir(), "place-frontier-shortlist-race-"));
    const path = join(directory, "frontier.sqlite");
    try {
      const seedDatabase = openEvidenceDatabase(path);
      const fixture = harness({ rankedCountries: ["SI"] });
      const prepared = await fixture.prepare();
      const ranking = await fixture.store.loadRankingVerified(prepared.rankingSnapshotId);
      const result = await fixture.application.runPlaceFrontier(
        prepared,
        () => undefined,
        new AbortController().signal,
      );
      const seedStore = new SqlitePlaceFrontierStore(seedDatabase, HMAC_KEY);
      await seedStore.appendRanking(ranking);

      await expect(concurrentStoreWrites({
        path,
        method: "appendShortlist",
        snapshots: [result.shortlistSnapshot, result.shortlistSnapshot],
      })).resolves.toEqual(["done", "done"]);
      expect(seedDatabase.prepare(
        "SELECT COUNT(*) AS count FROM place_frontier_snapshots WHERE kind = 'shortlist'",
      ).get()).toEqual({ count: 1 });
      seedDatabase.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test.each([
    ["malformed JSON", "{not-json"],
    ["invalid closed payload", "{}"],
  ] as const)("normalizes %s while loading a snapshot", async (_name, payloadJson) => {
    const fixture = harness({ rankedCountries: ["SI"] });
    const prepared = await fixture.prepare();
    fixture.database.exec("DROP TRIGGER place_frontier_snapshots_no_update");
    fixture.database.prepare(`
      UPDATE place_frontier_snapshots SET payload_json = ? WHERE id = ?
    `).run(payloadJson, prepared.rankingSnapshotId);

    await expect(fixture.store.loadRankingVerified(prepared.rankingSnapshotId))
      .rejects.toThrow("integrity_mismatch");
  });
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
