import { describe, expect, test } from "vitest";

const RAW_TABLES = [
  "city_catalog_revisions",
  "city_criteria_snapshots",
  "city_evidence_snapshots",
  "city_knowledge_revisions",
  "city_ranking_snapshots",
  "city_frontier_revisions",
  "city_selection_snapshots",
  "city_branch_commits",
  "evidence_snapshots",
  "artifacts",
] as const;

const FACT_CRITERIA = [
  "safety",
  "long_term_rent",
  "urban_transit",
  "fixed_broadband",
] as const;

function recursivelyFrozen(value: unknown, seen = new Set<object>()): void {
  if (value === null || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value)) recursivelyFrozen(child, seen);
}

function objectGraph(value: unknown, reached = new Set<object>()): ReadonlySet<object> {
  if (value === null || typeof value !== "object" || reached.has(value)) return reached;
  reached.add(value);
  for (const child of Object.values(value)) objectGraph(child, reached);
  return reached;
}

function expectDisjoint(left: unknown, right: unknown): void {
  const leftGraph = objectGraph(left);
  const rightGraph = objectGraph(right);
  expect([...leftGraph].some((value) => rightGraph.has(value))).toBe(false);
}

function expectConfidentialPublicDto(
  value: unknown,
  forbiddenStrings: readonly string[],
  seen = new Set<object>(),
): void {
  if (typeof value === "string") {
    for (const forbidden of forbiddenStrings) expect(value).not.toContain(forbidden);
    return;
  }
  if (value === null || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  expect(value).not.toBeInstanceOf(Uint8Array);
  for (const [key, child] of Object.entries(value)) {
    expect(key).not.toMatch(/(?:hmac|canonical|payload|artifact.*bytes|request.*json|token)/i);
    expectConfidentialPublicDto(child, forbiddenStrings, seen);
  }
}

describe("City Frontier offline replay", () => {
  test("reopens a completed yellow selection and presents it twice without live calls or durable writes", async () => {
    const { createCityFrontierOfflineReplayProof } = await import(
      "../support/city-frontier-offline-replay-fixture"
    );
    const proof = await createCityFrontierOfflineReplayProof();

    try {
      const [first, second] = proof.presentations;
      expect(proof.canonical(first)).toBe(proof.canonical(proof.savedCompletion));
      expect(proof.canonical(second)).toBe(proof.canonical(proof.savedCompletion));
      expect(proof.canonical(first)).toBe(proof.canonical(second));

      recursivelyFrozen(proof.savedCompletion);
      recursivelyFrozen(first);
      recursivelyFrozen(second);
      expectDisjoint(proof.savedCompletion, first);
      expectDisjoint(proof.savedCompletion, second);
      expectDisjoint(first, second);

      expect(first.catalog.rulesVersion).toBe("city-catalog@2");
      expect(first.catalog.members.map(({ cityId }) => cityId)).toEqual([
        "ljubljana",
        "maribor",
      ]);
      expect(first.criteria.criteria.map(({ criterionId }) => criterionId)).toEqual(FACT_CRITERIA);
      expect(first.ranking.ordered.map(({ cityId, rank }) => ({ cityId, rank }))).toEqual([
        { cityId: "ljubljana", rank: 1 },
        { cityId: "maribor", rank: 2 },
      ]);
      expect(first.revision.kind).toBe("terminal");
      if (first.revision.kind !== "terminal") throw new Error("expected_terminal_fixture");
      expect(first.revision.stopCondition).toBe("catalog_exhausted");
      expect(first.revision.markers.map(({ cityId, rank, status, visualStatus }) => ({
        cityId,
        rank,
        status,
        visualStatus,
      }))).toEqual([
        { cityId: "ljubljana", rank: 1, status: "selectable", visualStatus: "yellow" },
        { cityId: "maribor", rank: 2, status: "selectable", visualStatus: "yellow" },
      ]);
      expect(first.revision.entries.map(({ cityId, rank }) => ({ cityId, rank }))).toEqual([
        { cityId: "ljubljana", rank: 1 },
        { cityId: "maribor", rank: 2 },
      ]);

      for (const marker of first.revision.markers) {
        expect(marker.facts.map(({ criterionId }) => criterionId)).toEqual(FACT_CRITERIA);
        expect(marker.knowledgeRevisionId).toMatch(/^city-knowledge:/);
        expect(marker.evidenceSnapshotId).toMatch(
          /^city-check:[0-9a-f]{64}:evidence$/,
        );
        expect(marker.facts[0].outcome.kind).toBe("unknown");
        expect(marker.facts[0].manualCheckLinks).toEqual([
          {
            sourceId: "si-city-safety",
            disposition: "reviewed_rejected",
            navigationUrl: `https://${marker.cityId}.si/safety`,
            resolvedEvidenceUrl: `https://${marker.cityId}.si/safety`,
            rejectionReason: "http_not_found",
          },
        ]);
        expect(marker.facts[1].evidenceLinks).toEqual([
          {
            sourceId: "si-city-long-term-rent",
            disposition: "accepted",
            navigationUrl:
              `https://official.example/${marker.cityId}/si-city-long-term-rent/secondary`,
            resolvedEvidenceUrl:
              `https://official.example/${marker.cityId}/si-city-long-term-rent/secondary/resolved`,
          },
        ]);
        expect(marker.facts[2].manualCheckLinks).toEqual([
          {
            sourceId: "si-city-urban-transit",
            disposition: "reviewed_rejected",
            navigationUrl:
              `https://official.example/${marker.cityId}/si-city-urban-transit/secondary`,
            resolvedEvidenceUrl:
              `https://official.example/${marker.cityId}/si-city-urban-transit/secondary/resolved`,
          },
        ]);
        expect(marker.facts[3].evidenceLinks).toEqual([
          {
            sourceId: "si-city-fixed-broadband",
            disposition: "accepted",
            navigationUrl:
              `https://official.example/${marker.cityId}/si-city-fixed-broadband/primary`,
            resolvedEvidenceUrl:
              `https://official.example/${marker.cityId}/si-city-fixed-broadband/primary/resolved`,
          },
        ]);

        const ledger = proof.evidenceAfterReopen.find(({ id }) =>
          id === marker.evidenceSnapshotId);
        expect(ledger).toBeDefined();
        expect(ledger!.fixedAttemptLedgers.map(({ sourceId }) => sourceId)).toEqual([
          "si-city-long-term-rent",
          "si-city-urban-transit",
          "si-city-fixed-broadband",
        ]);
        expect(ledger!.fixedAttemptLedgers[1].attempts).toHaveLength(2);
        expect(ledger!.fixedAttemptLedgers[1].attempts.every(({ disposition }) =>
          disposition === "rejected")).toBe(true);
      }

      expect(first.selections).toHaveLength(1);
      const pair = first.selections[0]!;
      const selectedMarker = first.revision.markers.find(({ cityId }) =>
        cityId === pair.selection.cityId)!;
      const selectedEntry = first.revision.entries.find(({ cityId }) =>
        cityId === pair.selection.cityId)!;
      expect(pair.selection).toMatchObject({
        runId: first.runId,
        terminalRevisionId: first.revision.id,
        countryCode: first.countryCode,
        preCityBranchCommitId: first.preCityBranchCommitId,
        selectedMarkerDigest: selectedEntry.markerDigest,
        knowledgeRevisionId: selectedMarker.knowledgeRevisionId,
        evidenceSnapshotId: selectedMarker.evidenceSnapshotId,
        warningCopyVersion: "city-unknown-risk@1",
      });
      expect(pair.commit).toMatchObject({
        parentId: first.preCityBranchCommitId,
        forkedFrom: first.preCityBranchCommitId,
        citySelectionSnapshotId: pair.selection.id,
        cityId: pair.selection.cityId,
        countryCode: pair.selection.countryCode,
      });

      expect(proof.evidenceAfterReopen.map(({ id }) => id).sort()).toEqual(
        [...new Set(first.revision.markers.map(({ evidenceSnapshotId }) =>
          evidenceSnapshotId))].sort(),
      );
      expect(proof.evidenceAfterReopen).toEqual(proof.evidenceBeforeClose);
      expect(proof.counters).toEqual({
        fixedRoutes: {
          "si-city-long-term-rent": 0,
          "si-city-urban-transit": 0,
          "si-city-fixed-broadband": 0,
        },
        safetyDocuments: 0,
        safetySearch: 0,
        rawSafetySearchRequests: 0,
        clock: 0,
        scheduler: 0,
      });
      expect(proof.totalChangesAfter).toBe(proof.totalChangesBefore);
      expect(Object.keys(proof.rowsBefore)).toEqual(RAW_TABLES);
      expect(proof.rowsAfter).toEqual(proof.rowsBefore);

      for (const publicDto of [proof.savedCompletion, first, second]) {
        expectConfidentialPublicDto(publicDto, [
          proof.databasePath,
          proof.privateSentinel,
          proof.privateSearchToken,
        ]);
      }
    } finally {
      proof.cleanup();
    }
  }, 30_000);
});
