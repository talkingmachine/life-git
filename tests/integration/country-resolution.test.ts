import { describe, expect, test, vi } from "vitest";

import { createCountryResolutionApplication } from "../../src/application/country-resolution";
import {
  countryCheckRunId,
  type CountryVerificationResult,
  type CountryVerifierPort,
} from "../../src/application/country-verifier";
import {
  createPlaceFrontierApplication,
  type PlaceFrontierApplicationPorts,
} from "../../src/application/place-frontier";
import type { FormalResidenceVerdict } from
  "../../src/decision/formal-residence-verdict";
import { rankPlaces, type RankedPlace } from "../../src/decision/place-ranker";
import type { PreferenceProfileDraft } from "../../src/decision/preference-profile";
import type { RelocationProfileDraft } from "../../src/decision/relocation-profile";
import { createEvidenceIntegrity } from "../../src/infrastructure/integrity";
import { createCountryResolutionComposition } from
  "../../src/infrastructure/country-resolution-composition";
import { createPlaceFrontierComposition } from
  "../../src/infrastructure/place-frontier-composition";
import { SqliteCountryResolutionStore } from
  "../../src/infrastructure/sqlite/country-resolution-store";
import { openEvidenceDatabase } from "../../src/infrastructure/sqlite/db";
import { SqlitePlaceFrontierStore } from
  "../../src/infrastructure/sqlite/place-frontier-store";
import { SqliteProfileStore } from "../../src/infrastructure/sqlite/profile-store";

const NOW = "2026-08-12T08:00:00.000Z";
const DAY = "2026-08-12";
const HMAC_KEY = "country-resolution-application-test-key";

const profile: RelocationProfileDraft = {
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

const preferences: PreferenceProfileDraft = {
  criteria: [{
    id: "personal_safety",
    mode: "weighted",
    importance: 5,
    target: "maximize",
  }],
};

type FormalStatus = "green" | "yellow" | "red";

function verdict(
  countryCode: string,
  profileId: string,
  evidenceSnapshotId: string,
  marker: FormalStatus,
): FormalResidenceVerdict {
  if (marker === "yellow") {
    return {
      rulesVersion: "formal-residence@1",
      marker,
      verdictAsOf: DAY,
      routeOutcomes: [],
      reasons: [],
      catalogCompleteness: {
        status: "unproven",
        reasonCode: "catalog_completeness_unprovable",
      },
    };
  }
  const reference = {
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
  if (marker === "green") {
    const reason = {
      code: `${countryCode}_route_viable`,
      summary: `${countryCode} route is viable`,
      claimIds: [`claim-${countryCode}`],
      evidence: [reference],
      navigation: [],
    };
    return {
      rulesVersion: "formal-residence@1",
      marker,
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
  return {
    rulesVersion: "formal-residence@1",
    marker,
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
          evidence: [reference],
        }],
        validatorVersion: "catalog-validator@1",
        effectiveFrom: "2026-01-01",
        evidenceSnapshotId,
        catalogEvidence: [reference],
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

async function fixture(input: {
  readonly ordered: readonly string[];
  readonly statuses: Readonly<Record<string, FormalStatus>>;
  readonly failCheckFor?: string;
  readonly failPresentFor?: string;
  readonly publishThenFailFor?: string;
  readonly publishKnowledgeFor?: string;
  readonly failReplacementAppend?: boolean;
  readonly emitProgressDuringCheck?: boolean;
}) {
  const database = openEvidenceDatabase(":memory:");
  const integrity = createEvidenceIntegrity(HMAC_KEY);
  const profileStore = new SqliteProfileStore(database);
  const frontierStore = new SqlitePlaceFrontierStore(database, HMAC_KEY, profileStore);
  const results = new Map<string, CountryVerificationResult>();
  const checks: Array<{ readonly parentRunId: string; readonly countryCode: string }> = [];
  const officialRequests = vi.fn();
  let freezeCalls = 0;
  let rankCalls = 0;
  const verifier: CountryVerifierPort = {
    async check({ country, profileId, parentRunId, emitProgress }) {
      checks.push({ parentRunId, countryCode: country.countryCode });
      officialRequests();
      if (input.failCheckFor === country.countryCode) throw new Error("verification_failed");
      if (input.emitProgressDuringCheck) {
        await emitProgress({
          stage: "artifact_captured",
          label: `artifact-${country.countryCode}`,
          detail: `sha256:${"b".repeat(64)}`,
          sourceUrl: `https://example.test/${country.countryCode}.pdf`,
        });
      }
      const evidenceSnapshotId = `evidence-${parentRunId}-${country.countryCode}`;
      const result = {
        countryCheckRunId: countryCheckRunId(parentRunId, country.countryCode, integrity),
        sourceAssessmentRulesVersion: "cold-start-assessment@1" as const,
        verdict: verdict(
          country.countryCode,
          profileId,
          evidenceSnapshotId,
          input.statuses[country.countryCode] ?? "green",
        ),
        evidenceSnapshotId,
        ...(input.publishKnowledgeFor === country.countryCode ? {
          currentKnowledgeRevisionId: `knowledge-${country.countryCode}`,
          updatedKnowledgeRevisionId: `knowledge-${country.countryCode}`,
          knowledgeUpdatedAt: NOW,
        } : {}),
        lastCheckedAt: DAY,
      };
      results.set(result.countryCheckRunId, result);
      if (input.publishThenFailFor === country.countryCode) {
        throw new Error("transport_failed_after_evidence_commit");
      }
      return result;
    },
    async present({ parentRunId, countryCode, countryCheckRunId: childRunId }) {
      if (childRunId !== countryCheckRunId(parentRunId, countryCode, integrity)) {
        throw new Error("integrity_mismatch");
      }
      if (input.failPresentFor === countryCode) throw new Error("replay_failed");
      const result = results.get(childRunId);
      if (result === undefined) throw new Error("evidence_not_found");
      const { countryCheckRunId: _countryCheckRunId, ...presented } = result;
      return presented;
    },
  };
  const places = input.ordered.map(rankedPlace);
  const frontierPorts: PlaceFrontierApplicationPorts = {
    profiles: profileStore,
    rankingInputs: {
      freezeCurrent: async () => {
        freezeCalls += 1;
        return {
          places,
          knowledgeRevisionIds: Object.fromEntries(input.ordered.map((code) => [code, null])),
        };
      },
    },
    rank: (rankInput) => {
      rankCalls += 1;
      return rankPlaces(rankInput);
    },
    store: frontierStore,
    knowledge: {
      loadVerified: async () => { throw new Error("latest_knowledge_must_not_run"); },
    },
    verifier,
    integrity,
    clock: () => new Date(NOW),
    nextRunId: () => "automatic-frontier-run",
  };
  const frontier = createPlaceFrontierApplication(frontierPorts);
  const prepared = await frontier.preparePlaceFrontier({ profile, preferences });
  const automatic = await frontier.runPlaceFrontier(
    prepared,
    () => undefined,
    new AbortController().signal,
  );
  checks.length = 0;
  officialRequests.mockClear();
  const durableStore = new SqliteCountryResolutionStore(database, HMAC_KEY);
  const store = input.failReplacementAppend
    ? {
        ...durableStore,
        append: (appendInput: Parameters<typeof durableStore.append>[0]) => {
          if (appendInput.operation.kind === "replacement_completed") {
            throw new Error("storage_failed");
          }
          return durableStore.append(appendInput);
        },
        loadRevisionVerified: durableStore.loadRevisionVerified.bind(durableStore),
        loadHeadVerified: durableStore.loadHeadVerified.bind(durableStore),
        loadChainVerified: durableStore.loadChainVerified.bind(durableStore),
        findByCommandVerified: durableStore.findByCommandVerified.bind(durableStore),
        findRootForRunVerified: durableStore.findRootForRunVerified.bind(durableStore),
        locateChainVerified: durableStore.locateChainVerified.bind(durableStore),
      }
    : durableStore;
  const resolution = createCountryResolutionApplication({
    frontier,
    store,
    verifier,
    integrity,
    clock: () => new Date(NOW),
  });
  return {
    automatic,
    checks,
    database,
    officialRequests,
    resolution,
    counts: {
      freeze: () => freezeCalls,
      rank: () => rankCalls,
    },
  };
}

async function rejectFirstYellow(source: Awaited<ReturnType<typeof fixture>>) {
  const started = await source.resolution.startCountryResolution({
    automaticShortlistSnapshotId: source.automatic.shortlistSnapshot.id,
  });
  return source.resolution.decideYellow({
    resolutionRunId: started.resolutionRunId,
    expectedRevisionId: started.revision.id,
    countryCode: started.revision.unresolvedCountryCodes[0]!,
    decision: "rejected",
    warningCopyVersion: "yellow-risk@1",
    commandId: `reject-${started.revision.unresolvedCountryCodes[0]}`,
  });
}

describe("country resolution application", () => {
  test("starts an all-green automatic snapshot as an immediate deterministic resolution", async () => {
    const source = await fixture({
      ordered: ["AA", "BB", "CC", "DD", "EE"],
      statuses: {},
    });

    const first = await source.resolution.startCountryResolution({
      automaticShortlistSnapshotId: source.automatic.shortlistSnapshot.id,
    });
    const second = await source.resolution.startCountryResolution({
      automaticShortlistSnapshotId: source.automatic.shortlistSnapshot.id,
    });

    expect(first).toEqual(second);
    expect(first.revision).toMatchObject({
      kind: "resolved",
      resolvedEntries: [
        { countryCode: "AA", rank: 1 },
        { countryCode: "BB", rank: 2 },
        { countryCode: "CC", rank: 3 },
        { countryCode: "DD", rank: 4 },
        { countryCode: "EE", rank: 5 },
      ],
      stopCondition: "five_effective_green",
    });
    expect(source.checks).toEqual([]);
    expect(source.officialRequests).not.toHaveBeenCalled();
  });

  test("starts initial yellows at the lowest frozen rank without replacement", async () => {
    const source = await fixture({
      ordered: ["AA", "BB", "CC", "DD", "EE", "FF"],
      statuses: { BB: "yellow", DD: "yellow" },
    });

    const started = await source.resolution.startCountryResolution({
      automaticShortlistSnapshotId: source.automatic.shortlistSnapshot.id,
    });

    expect(started.revision).toMatchObject({
      kind: "working",
      phase: "awaiting_decision",
      unresolvedCountryCodes: ["BB", "DD"],
      slotCountryCodes: ["AA", "BB", "CC", "DD", "EE"],
      nextUncheckedRank: 6,
      replacementMarkers: [],
    });
    expect(source.checks).toEqual([]);
  });

  test("derives accepted and rejected yellow successors server-side", async () => {
    const acceptedSource = await fixture({
      ordered: ["AA", "BB", "CC", "DD", "EE", "FF"],
      statuses: { BB: "yellow", DD: "yellow" },
    });
    const acceptedRoot = await acceptedSource.resolution.startCountryResolution({
      automaticShortlistSnapshotId: acceptedSource.automatic.shortlistSnapshot.id,
    });
    const accepted = await acceptedSource.resolution.decideYellow({
      resolutionRunId: acceptedRoot.resolutionRunId,
      expectedRevisionId: acceptedRoot.revision.id,
      countryCode: "BB",
      decision: "accepted_at_own_risk",
      warningCopyVersion: "yellow-risk@1",
      commandId: "accept-BB",
    });
    expect(accepted.revision).toMatchObject({
      kind: "working",
      phase: "awaiting_decision",
      unresolvedCountryCodes: ["DD"],
      slotCountryCodes: ["AA", "BB", "CC", "DD", "EE"],
      decisions: [{
        countryCode: "BB",
        decision: "accepted_at_own_risk",
        decidedAt: NOW,
        warningCopyVersion: "yellow-risk@1",
      }],
    });
    expect(accepted.automaticFrontier.shortlistSnapshot.markers[1]?.formalVerdict.marker)
      .toBe("yellow");

    const rejectedSource = await fixture({
      ordered: ["AA", "BB", "CC", "DD", "EE", "FF"],
      statuses: { BB: "yellow", DD: "yellow" },
    });
    const rejectedRoot = await rejectedSource.resolution.startCountryResolution({
      automaticShortlistSnapshotId: rejectedSource.automatic.shortlistSnapshot.id,
    });
    const rejected = await rejectedSource.resolution.decideYellow({
      resolutionRunId: rejectedRoot.resolutionRunId,
      expectedRevisionId: rejectedRoot.revision.id,
      countryCode: "BB",
      decision: "rejected",
      warningCopyVersion: "yellow-risk@1",
      commandId: "reject-BB",
    });
    expect(rejected.revision).toMatchObject({
      kind: "working",
      phase: "replacement_required",
      unresolvedCountryCodes: ["DD"],
      slotCountryCodes: ["AA", "CC", "DD", "EE"],
      nextUncheckedRank: 6,
    });
    expect(rejected.automaticFrontier.shortlistSnapshot.markers[1]?.formalVerdict.marker)
      .toBe("yellow");
  });

  test("rejects unbound decision input before append and converges exact retries", async () => {
    const source = await fixture({
      ordered: ["AA", "BB", "CC", "DD", "EE", "FF"],
      statuses: { BB: "yellow" },
    });
    const root = await source.resolution.startCountryResolution({
      automaticShortlistSnapshotId: source.automatic.shortlistSnapshot.id,
    });
    const rowsBefore = () => (source.database.prepare(
      "SELECT COUNT(*) AS count FROM country_resolution_revisions",
    ).get() as { readonly count: number }).count;

    await expect(source.resolution.startCountryResolution({
      automaticShortlistSnapshotId: "wrong-source-snapshot",
    })).rejects.toThrow("snapshot_not_found");
    expect(rowsBefore()).toBe(1);

    for (const invalid of [
      { countryCode: "CC" },
      { expectedRevisionId: "wrong-head" },
      { warningCopyVersion: "yellow-risk@2" },
      { uncertaintyBasis: { unknownRoutes: [] } },
    ]) {
      const before = rowsBefore();
      await expect(source.resolution.decideYellow({
        resolutionRunId: root.resolutionRunId,
        expectedRevisionId: root.revision.id,
        countryCode: "BB",
        decision: "accepted_at_own_risk",
        warningCopyVersion: "yellow-risk@1",
        commandId: `invalid-${Object.keys(invalid)[0]}`,
        ...invalid,
      } as never)).rejects.toThrow();
      expect(rowsBefore()).toBe(before);
    }

    const command = {
      resolutionRunId: root.resolutionRunId,
      expectedRevisionId: root.revision.id,
      countryCode: "BB",
      decision: "accepted_at_own_risk" as const,
      warningCopyVersion: "yellow-risk@1" as const,
      commandId: "same-command",
    };
    const first = await source.resolution.decideYellow(command);
    await expect(source.resolution.decideYellow(command)).resolves.toEqual(first);
    await expect(source.resolution.decideYellow({ ...command, decision: "rejected" }))
      .rejects.toThrow("integrity_mismatch");
  });

  test("guards City handoff with only a verified non-empty resolved revision", async () => {
    const source = await fixture({
      ordered: ["AA", "BB", "CC", "DD", "EE"],
      statuses: {},
    });
    const resolved = await source.resolution.startCountryResolution({
      automaticShortlistSnapshotId: source.automatic.shortlistSnapshot.id,
    });

    await expect(source.resolution.requireResolvedCountryShortlistForCity(resolved.revision.id))
      .resolves.toEqual(resolved.revision);
    await expect(source.resolution.requireResolvedCountryShortlistForCity(
      source.automatic.shortlistSnapshot.id,
    )).rejects.toThrow("resolved_country_shortlist_required");

    const workingSource = await fixture({
      ordered: ["AA", "BB", "CC", "DD", "EE"],
      statuses: { BB: "yellow" },
    });
    const working = await workingSource.resolution.startCountryResolution({
      automaticShortlistSnapshotId: workingSource.automatic.shortlistSnapshot.id,
    });
    await expect(workingSource.resolution.requireResolvedCountryShortlistForCity(working.revision.id))
      .rejects.toThrow("resolved_country_shortlist_required");

    const emptySource = await fixture({ ordered: ["AA"], statuses: { AA: "red" } });
    const empty = await emptySource.resolution.startCountryResolution({
      automaticShortlistSnapshotId: emptySource.automatic.shortlistSnapshot.id,
    });
    await expect(emptySource.resolution.requireResolvedCountryShortlistForCity(empty.revision.id))
      .rejects.toThrow("resolved_country_shortlist_required");

    const tamperedSource = await fixture({
      ordered: ["AA", "BB", "CC", "DD", "EE"],
      statuses: {},
    });
    const tampered = await tamperedSource.resolution.startCountryResolution({
      automaticShortlistSnapshotId: tamperedSource.automatic.shortlistSnapshot.id,
    });
    tamperedSource.database.exec("DROP TRIGGER country_resolution_revisions_no_update");
    tamperedSource.database.prepare(`
      UPDATE country_resolution_revisions SET hmac = '0' || substr(hmac, 2) WHERE id = ?
    `).run(tampered.revision.id);
    await expect(tamperedSource.resolution.requireResolvedCountryShortlistForCity(
      tampered.revision.id,
    )).rejects.toThrow("resolved_country_shortlist_required");
  });

  test("presents the same resolved chain twice without network", async () => {
    const source = await fixture({
      ordered: ["AA", "BB", "CC", "DD", "EE"],
      statuses: {},
    });
    const resolved = await source.resolution.startCountryResolution({
      automaticShortlistSnapshotId: source.automatic.shortlistSnapshot.id,
    });

    const first = await source.resolution.presentCountryResolution(resolved.resolutionRunId);
    const second = await source.resolution.presentCountryResolution(resolved.resolutionRunId);

    expect(first).toEqual(second);
    expect(source.checks).toEqual([]);
    expect(source.officialRequests).not.toHaveBeenCalled();
  });

  test("uses production composition for zero-network start and repeated presentation", async () => {
    const database = openEvidenceDatabase(":memory:");
    const requestStep = vi.fn(async () => {
      throw new Error("network_must_not_run");
    });
    let nextRun = 0;
    const options = {
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
      nextRunId: () => `production-frontier-${++nextRun}`,
    };
    const frontier = createCountryResolutionComposition(options);
    const automaticComposition = createPlaceFrontierComposition(options);
    const prepared = await automaticComposition.preparePlaceFrontier({ profile, preferences });
    const automatic = await automaticComposition.runPlaceFrontier(
      prepared,
      () => undefined,
      new AbortController().signal,
    );
    const requestsBeforeResolution = requestStep.mock.calls.length;

    const started = await frontier.startCountryResolution({
      automaticShortlistSnapshotId: automatic.shortlistSnapshot.id,
    });
    const first = await frontier.presentCountryResolution(started.resolutionRunId);
    const second = await frontier.presentCountryResolution(started.resolutionRunId);

    expect(first).toEqual(second);
    expect(requestStep).toHaveBeenCalledTimes(requestsBeforeResolution);
  });

  test("commits consecutive red replacements before green and emits exact ordered events", async () => {
    const source = await fixture({
      ordered: ["AA", "BB", "CC", "DD", "EE", "FF", "GG", "HH"],
      statuses: { BB: "yellow", FF: "red", GG: "red", HH: "green" },
      emitProgressDuringCheck: true,
    });
    const rejected = await rejectFirstYellow(source);
    const prepared = await source.resolution.prepareCountryResolutionContinuation({
      resolutionRunId: rejected.resolutionRunId,
      expectedRevisionId: rejected.revision.id,
    });
    const events: Array<Record<string, unknown>> = [];

    const resolved = await source.resolution.continueCountryResolution(
      prepared,
      (event) => {
        if (event.type === "resolution_revision_committed") {
          expect(source.database.prepare(
            "SELECT COUNT(*) AS count FROM country_resolution_revisions WHERE id = ?",
          ).get(event.payload.revision.id)).toEqual({ count: 1 });
        }
        events.push(event as unknown as Record<string, unknown>);
      },
      new AbortController().signal,
    );

    expect(resolved.revision).toMatchObject({
      kind: "resolved",
      stopCondition: "five_effective_green",
      resolvedEntries: [
        { countryCode: "AA", rank: 1 },
        { countryCode: "CC", rank: 3 },
        { countryCode: "DD", rank: 4 },
        { countryCode: "EE", rank: 5 },
        { countryCode: "HH", rank: 8 },
      ],
      replacementMarkers: [
        { country: { countryCode: "FF" }, rank: 6, formalVerdict: { marker: "red" } },
        { country: { countryCode: "GG" }, rank: 7, formalVerdict: { marker: "red" } },
        { country: { countryCode: "HH" }, rank: 8, formalVerdict: { marker: "green" } },
      ],
    });
    expect(events.map(({ type }) => type)).toEqual([
      "replacement_country_activated",
      "replacement_country_progress",
      "resolution_revision_committed",
      "replacement_country_activated",
      "replacement_country_progress",
      "resolution_revision_committed",
      "replacement_country_activated",
      "replacement_country_progress",
      "resolution_revision_committed",
      "resolution_continuation_completed",
    ]);
    expect(events.map(({ sequence }) => sequence)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(events.every(({ resolutionRunId }) => resolutionRunId === rejected.resolutionRunId))
      .toBe(true);
    expect(events.every(({ occurredAt }) => occurredAt === NOW)).toBe(true);
    expect(source.checks).toEqual([
      { parentRunId: rejected.resolutionRunId, countryCode: "FF" },
      { parentRunId: rejected.resolutionRunId, countryCode: "GG" },
      { parentRunId: rejected.resolutionRunId, countryCode: "HH" },
    ]);
    expect(source.database.prepare(
      "SELECT COUNT(*) AS count FROM country_resolution_revisions",
    ).get()).toEqual({ count: 5 });
  });

  test("stops at a replacement yellow and keeps the globally lowest frozen-rank prompt", async () => {
    const source = await fixture({
      ordered: ["AA", "BB", "CC", "DD", "EE", "FF"],
      statuses: { BB: "yellow", DD: "yellow", FF: "yellow" },
    });
    const rejected = await rejectFirstYellow(source);
    const prepared = await source.resolution.prepareCountryResolutionContinuation({
      resolutionRunId: rejected.resolutionRunId,
      expectedRevisionId: rejected.revision.id,
    });

    const continued = await source.resolution.continueCountryResolution(
      prepared,
      () => undefined,
      new AbortController().signal,
    );

    expect(continued.revision).toMatchObject({
      kind: "working",
      phase: "awaiting_decision",
      unresolvedCountryCodes: ["DD", "FF"],
      slotCountryCodes: ["AA", "CC", "DD", "EE", "FF"],
      nextUncheckedRank: 7,
    });
  });

  test("honestly exhausts the frozen ranking and never reranks after Knowledge publication", async () => {
    const source = await fixture({
      ordered: ["AA", "BB", "CC", "DD", "EE", "FF", "GG"],
      statuses: { BB: "yellow", FF: "red", GG: "red" },
      publishKnowledgeFor: "FF",
    });
    const rejected = await rejectFirstYellow(source);
    const prepared = await source.resolution.prepareCountryResolutionContinuation({
      resolutionRunId: rejected.resolutionRunId,
      expectedRevisionId: rejected.revision.id,
    });
    const freezeBefore = source.counts.freeze();
    const rankBefore = source.counts.rank();

    const exhausted = await source.resolution.continueCountryResolution(
      prepared,
      () => undefined,
      new AbortController().signal,
    );

    expect(exhausted.revision).toMatchObject({
      kind: "resolved",
      stopCondition: "ranking_exhausted",
      resolvedEntries: [
        { countryCode: "AA", rank: 1 },
        { countryCode: "CC", rank: 3 },
        { countryCode: "DD", rank: 4 },
        { countryCode: "EE", rank: 5 },
      ],
      replacementMarkers: [{
        country: { countryCode: "FF" },
        currentKnowledgeRevisionId: "knowledge-FF",
        updatedKnowledgeRevisionId: "knowledge-FF",
      }, { country: { countryCode: "GG" } }],
    });
    expect(source.counts.freeze()).toBe(freezeBefore);
    expect(source.counts.rank()).toBe(rankBefore);
  });

  test.each([0, 1, 2, 3, 4])(
    "honestly resolves %i effective green countries after replacement exhaustion",
    async (greenCount) => {
      const automaticCodes = ["AA", "BB", "CC", "DD", "EE"];
      const statuses = Object.fromEntries(automaticCodes.map((countryCode, index) => [
        countryCode,
        index < greenCount ? "green" : "yellow",
      ])) as Readonly<Record<string, FormalStatus>>;
      const source = await fixture({
        ordered: [...automaticCodes, "FF"],
        statuses: { ...statuses, FF: "red" },
      });
      let current = await rejectFirstYellow(source);
      const prepared = await source.resolution.prepareCountryResolutionContinuation({
        resolutionRunId: current.resolutionRunId,
        expectedRevisionId: current.revision.id,
      });
      current = await source.resolution.continueCountryResolution(
        prepared,
        () => undefined,
        new AbortController().signal,
      );
      while (current.revision.kind === "working") {
        current = await source.resolution.decideYellow({
          resolutionRunId: current.resolutionRunId,
          expectedRevisionId: current.revision.id,
          countryCode: current.revision.unresolvedCountryCodes[0]!,
          decision: "rejected",
          warningCopyVersion: "yellow-risk@1",
          commandId: `reject-${current.revision.unresolvedCountryCodes[0]}`,
        });
      }

      expect(current.revision.stopCondition).toBe("ranking_exhausted");
      expect(current.revision.resolvedEntries).toHaveLength(greenCount);
      expect(current.revision.resolvedEntries.map(({ countryCode }) => countryCode))
        .toEqual(automaticCodes.slice(0, greenCount));
    },
  );

  test("does not append or emit a terminal after abort, verifier failure, or storage failure", async () => {
    const cases = [
      { name: "abort", options: {}, abort: true, error: "aborted" },
      { name: "replay", options: { failPresentFor: "FF" }, abort: false, error: "replay_failed" },
      { name: "verifier", options: { failCheckFor: "FF" }, abort: false, error: "verification_failed" },
      { name: "storage", options: { failReplacementAppend: true }, abort: false, error: "storage_failed" },
    ] as const;

    for (const scenario of cases) {
      const source = await fixture({
        ordered: ["AA", "BB", "CC", "DD", "EE", "FF"],
        statuses: { BB: "yellow", FF: "green" },
        ...scenario.options,
      });
      const rejected = await rejectFirstYellow(source);
      const prepared = await source.resolution.prepareCountryResolutionContinuation({
        resolutionRunId: rejected.resolutionRunId,
        expectedRevisionId: rejected.revision.id,
      });
      const controller = new AbortController();
      if (scenario.abort) controller.abort(new DOMException("aborted", "AbortError"));
      const events: Array<{ readonly type: string }> = [];

      await expect(source.resolution.continueCountryResolution(
        prepared,
        (event) => { events.push(event); },
        controller.signal,
      )).rejects.toThrow(scenario.error);
      const reloaded = await source.resolution.presentCountryResolution(rejected.resolutionRunId);
      expect(reloaded.revision.id).toBe(rejected.revision.id);
      expect(events.some(({ type }) => type === "resolution_continuation_completed")).toBe(false);
      expect(source.database.prepare(
        "SELECT COUNT(*) AS count FROM country_resolution_revisions",
      ).get()).toEqual({ count: 2 });
      if (scenario.name === "replay") expect(source.checks).toEqual([]);
    }
  });

  test("recovers an already committed Evidence child without another check", async () => {
    const source = await fixture({
      ordered: ["AA", "BB", "CC", "DD", "EE", "FF"],
      statuses: { BB: "yellow", FF: "green" },
      publishThenFailFor: "FF",
    });
    const rejected = await rejectFirstYellow(source);
    const prepared = await source.resolution.prepareCountryResolutionContinuation({
      resolutionRunId: rejected.resolutionRunId,
      expectedRevisionId: rejected.revision.id,
    });
    await expect(source.resolution.continueCountryResolution(
      prepared,
      () => undefined,
      new AbortController().signal,
    )).rejects.toThrow("transport_failed_after_evidence_commit");
    expect(source.checks).toHaveLength(1);

    const recovered = await source.resolution.continueCountryResolution(
      prepared,
      () => undefined,
      new AbortController().signal,
    );

    expect(recovered.revision).toMatchObject({ kind: "resolved" });
    expect(source.checks).toHaveLength(1);
  });

  test("keeps a committed replacement when event transport fails and reloads it exactly", async () => {
    const source = await fixture({
      ordered: ["AA", "BB", "CC", "DD", "EE", "FF"],
      statuses: { BB: "yellow", FF: "green" },
    });
    const rejected = await rejectFirstYellow(source);
    const prepared = await source.resolution.prepareCountryResolutionContinuation({
      resolutionRunId: rejected.resolutionRunId,
      expectedRevisionId: rejected.revision.id,
    });

    await expect(source.resolution.continueCountryResolution(
      prepared,
      (event) => {
        if (event.type === "resolution_revision_committed") {
          throw new Error("transport_failed_after_commit");
        }
      },
      new AbortController().signal,
    )).rejects.toThrow("transport_failed_after_commit");
    const first = await source.resolution.presentCountryResolution(rejected.resolutionRunId);
    const second = await source.resolution.presentCountryResolution(rejected.resolutionRunId);
    expect(first).toEqual(second);
    expect(first.revision).toMatchObject({ kind: "resolved" });
  });
});
