import { describe, expect, test } from "vitest";

import type { OfflineReplayRawRow } from
  "../support/city-frontier-offline-replay-fixture";

function textCell(row: OfflineReplayRawRow, column: string): string {
  const cell = row[column];
  if (cell?.kind !== "text") throw new Error(`expected_text_cell:${column}`);
  return cell.value;
}

describe("City Frontier sibling selection SQL proof", () => {
  test("reopens two choices from one terminal query-only with verified sibling commits", async () => {
    const { createCityFrontierOfflineReplayProof } = await import(
      "../support/city-frontier-offline-replay-fixture"
    );
    const proof = await createCityFrontierOfflineReplayProof("two-yellow-siblings");

    try {
      const [first, second] = proof.presentations;
      expect(first.revision.kind).toBe("terminal");
      if (first.revision.kind !== "terminal") throw new Error("expected_terminal_fixture");

      expect(first.selections).toHaveLength(2);
      expect(second.selections).toEqual(first.selections);
      expect(proof.savedCompletion.selections).toEqual(first.selections);

      const terminalCityIds = first.revision.markers.map(({ cityId }) => cityId).sort();
      const selectionCityIds = first.selections
        .map(({ selection }) => selection.cityId)
        .sort();
      expect(selectionCityIds).toEqual(terminalCityIds);
      expect(new Set(first.selections.map(({ selection }) => selection.id)).size).toBe(2);
      expect(new Set(first.selections.map(({ selection }) => selection.commandId)).size).toBe(2);
      expect(new Set(first.selections.map(({ commit }) => commit.id)).size).toBe(2);

      for (const pair of first.selections) {
        const marker = first.revision.markers.find(({ cityId }) =>
          cityId === pair.selection.cityId);
        const entry = first.revision.entries.find(({ cityId }) =>
          cityId === pair.selection.cityId);
        expect(marker).toBeDefined();
        expect(entry).toBeDefined();
        expect(pair.selection).toMatchObject({
          runId: first.runId,
          terminalRevisionId: first.revision.id,
          preCityBranchCommitId: first.preCityBranchCommitId,
          selectedMarkerDigest: entry!.markerDigest,
          knowledgeRevisionId: marker!.knowledgeRevisionId,
          evidenceSnapshotId: marker!.evidenceSnapshotId,
          unknownBasis: marker!.unknownBasis,
          warningCopyVersion: "city-unknown-risk@1",
        });
        expect(pair.commit).toMatchObject({
          parentId: first.preCityBranchCommitId,
          forkedFrom: first.preCityBranchCommitId,
          citySelectionSnapshotId: pair.selection.id,
          cityId: pair.selection.cityId,
        });
      }

      const selectionRows = proof.rowsAfter.city_selection_snapshots;
      expect(selectionRows).toHaveLength(2);
      expect(selectionRows.map((row) => textCell(row, "id")).sort()).toEqual(
        first.selections.map(({ selection }) => selection.id).sort(),
      );
      for (const row of selectionRows) {
        expect(textCell(row, "run_id")).toBe(first.runId);
        expect(textCell(row, "terminal_revision_id")).toBe(first.revision.id);
        expect(textCell(row, "pre_city_branch_commit_id")).toBe(
          first.preCityBranchCommitId,
        );
        expect(textCell(row, "payload_hash")).toMatch(/^[0-9a-f]{64}$/);
        expect(textCell(row, "hmac")).toMatch(/^[0-9a-f]{64}$/);
      }

      const branchRows = proof.rowsAfter.city_branch_commits.filter((row) =>
        textCell(row, "kind") === "selection");
      expect(branchRows).toHaveLength(2);
      expect(branchRows.map((row) => textCell(row, "id")).sort()).toEqual(
        first.selections.map(({ commit }) => commit.id).sort(),
      );
      expect(branchRows.map((row) => textCell(row, "selection_snapshot_id")).sort())
        .toEqual(first.selections.map(({ selection }) => selection.id).sort());
      for (const row of branchRows) {
        expect(textCell(row, "parent_id")).toBe(first.preCityBranchCommitId);
        expect(textCell(row, "forked_from")).toBe(first.preCityBranchCommitId);
        expect(textCell(row, "payload_hash")).toMatch(/^[0-9a-f]{64}$/);
        expect(textCell(row, "hmac")).toMatch(/^[0-9a-f]{64}$/);
      }

      expect(proof.queryOnly).toBe(1);
      expect(proof.integrityCheck).toEqual(["ok"]);
      expect(proof.foreignKeyViolations).toEqual([]);
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
      expect(proof.rowsAfter).toEqual(proof.rowsBefore);
    } finally {
      proof.cleanup();
    }
  }, 30_000);
});
