import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import { describe, expect, test } from "vitest";

import {
  countryResolutionMarkerProjection,
  countryResolutionContextHash,
  countryResolutionRevisionId,
  countryResolutionRunId,
  countryResolutionStartCommandId,
  type CountryResolutionOperation,
  type CountryResolutionRevision,
  type CountryResolutionSemanticContext,
} from "../../src/application/country-resolution-contracts";
import type { FrontierMarker } from "../../src/application/place-frontier";
import { countryCheckRunId } from "../../src/application/place-frontier";
import { SqliteCountryResolutionStore } from
  "../../src/infrastructure/sqlite/country-resolution-store";
import { canonicalJson, hmacSha256, sha256Text } from "../../src/infrastructure/integrity";
import { openEvidenceDatabase } from "../../src/infrastructure/sqlite/db";

const HMAC_KEY = "country-resolution-test-key";
const integrity = { canonical: canonicalJson, hash: sha256Text };
const source = {
  automaticShortlistSnapshotId: "automatic-shortlist",
  rankingSnapshotId: "frozen-ranking",
  profileSnapshotId: "profile-snapshot",
  preferenceProfileSnapshotId: "preference-snapshot",
} as const;
const orderedCountryCodes = ["AA", "BB", "CC", "DD", "EE", "FF"] as const;
const uncertaintyBasis = { unknownRoutes: [{ routeId: "route", reasons: [] }] } as const;

function context(
  statuses: readonly ("green" | "yellow" | "red")[] = ["yellow", "yellow", "yellow", "yellow", "yellow"],
): CountryResolutionSemanticContext {
  return {
    source,
    orderedCountryCodes,
    markerProjections: orderedCountryCodes.slice(0, statuses.length).map((countryCode, index) => ({
      countryCode,
      rank: index + 1,
      formalStatus: statuses[index]!,
      formalMarkerDigest: `marker-${countryCode}`,
      ...(statuses[index] === "yellow" ? { expectedUncertaintyBasis: uncertaintyBasis } : {}),
    })),
  };
}

function insertSourceGraph(database: Database.Database): void {
  const insert = database.prepare(`
    INSERT INTO place_frontier_snapshots (
      id, run_id, kind, schema_version, payload_json, payload_hash, hmac, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const ranking = { id: source.rankingSnapshotId, kind: "ranking" };
  const shortlist = {
    id: source.automaticShortlistSnapshotId,
    kind: "shortlist",
    rankingSnapshotId: source.rankingSnapshotId,
  };
  for (const [id, kind, schemaVersion, payload] of [
    [source.rankingSnapshotId, "ranking", "place-ranking@1", ranking],
    [source.automaticShortlistSnapshotId, "shortlist", "place-shortlist@1", shortlist],
  ] as const) {
    const payloadJson = canonicalJson(payload);
    insert.run(id, "source-run", kind, schemaVersion, payloadJson, sha256Text(payloadJson),
      hmacSha256(payloadJson, HMAC_KEY), "2026-08-12T00:00:00.000Z");
  }
}

function rootOperation(): Extract<CountryResolutionOperation, { readonly kind: "start" }> {
  return {
    commandId: countryResolutionStartCommandId(source.automaticShortlistSnapshotId, integrity),
    kind: "start",
    automaticShortlistSnapshotId: source.automaticShortlistSnapshotId,
  };
}

function rootRevision(operation: CountryResolutionOperation = rootOperation()): CountryResolutionRevision {
  const resolutionRunId = countryResolutionRunId(source.automaticShortlistSnapshotId, integrity);
  return {
    ...source,
    schemaVersion: "country-resolution@1",
    rulesVersion: "country-resolution@1",
    id: countryResolutionRevisionId(resolutionRunId, operation, integrity),
    resolutionRunId,
    kind: "working",
    decisions: [],
    replacementMarkers: [],
    nextUncheckedRank: 6,
    unresolvedCountryCodes: [...orderedCountryCodes.slice(0, 5)],
    slotCountryCodes: [...orderedCountryCodes.slice(0, 5)],
    phase: "awaiting_decision",
    contextHash: countryResolutionContextHash({
      resolutionRunId,
      source,
      operation,
      rulesVersion: "country-resolution@1",
    }, integrity),
    createdAt: "2026-08-12T00:00:00.000Z",
  };
}

function replacementMarker(countryCode = "EE", rank = 5): FrontierMarker {
  const runId = countryResolutionRunId(source.automaticShortlistSnapshotId, integrity);
  return {
    country: {
      countryCode,
      label: countryCode,
      flag: `flag-${countryCode}`,
      coordinate: { lat: 46, lng: 14 },
    },
    rank,
    countryCheckRunId: countryCheckRunId(runId, countryCode, integrity),
    sourceAssessmentRulesVersion: "cold-start-assessment@1",
    lastCheckedAt: "2026-08-12",
    evidenceSnapshotId: `evidence-${countryCode}`,
    formalVerdict: {
      rulesVersion: "formal-residence@1",
      marker: "yellow",
      verdictAsOf: "2026-08-12",
      routeOutcomes: [],
      reasons: [],
      catalogCompleteness: {
        status: "unproven",
        reasonCode: "catalog_completeness_unprovable",
      },
    },
  };
}

function replacementMarkerV2(
  reasonCode: "companion_route_unverified" | "companion_route_impossible" =
    "companion_route_unverified",
): FrontierMarker {
  return {
    ...replacementMarker(),
    sourceAssessmentRulesVersion: "cold-start-assessment@2",
    assessmentProjection: {
      schemaVersion: "country-assessment-projection@2",
      profileSnapshotId: source.profileSnapshotId,
      evidenceSnapshotId: "evidence-EE",
      participantAssessments: ["primary", "secondary"].flatMap((route) => [
        {
          routeId: `route-EE-${route}`,
          participantId: "participant-self",
          relationship: "self",
          status: "verified",
          reasonCodes: ["route_requirements_verified"],
          claimIds: ["claim-self"],
        },
        {
          routeId: `route-EE-${route}`,
          participantId: "participant-spouse",
          relationship: "spouse",
          status: reasonCode === "companion_route_unverified" ? "unknown" : "impossible",
          reasonCodes: [reasonCode],
          claimIds: ["claim-spouse"],
        },
      ]),
    },
  };
}

function replacementSuccessor(input: {
  readonly initial: CountryResolutionRevision;
  readonly marker?: FrontierMarker;
}): {
  readonly operation: CountryResolutionOperation;
  readonly revision: CountryResolutionRevision;
  readonly semanticContext: CountryResolutionSemanticContext;
} {
  const marker = input.marker ?? replacementMarker();
  const operation: CountryResolutionOperation = {
    commandId: marker.countryCheckRunId,
    kind: "replacement_completed",
    expectedHeadRevisionId: input.initial.id,
    countryCode: marker.country.countryCode,
    countryCheckRunId: marker.countryCheckRunId,
  };
  const projection = countryResolutionMarkerProjection(marker, integrity, {
    profileSnapshotId: source.profileSnapshotId,
    evidenceSnapshotId: marker.evidenceSnapshotId,
  });
  const semanticContext = {
    ...context(["green", "green", "green", "green"]),
    markerProjections: [
      ...context(["green", "green", "green", "green"]).markerProjections,
      projection,
    ],
  };
  const revision: CountryResolutionRevision = {
    ...source,
    schemaVersion: "country-resolution@1",
    rulesVersion: "country-resolution@1",
    id: countryResolutionRevisionId(input.initial.resolutionRunId, operation, integrity),
    resolutionRunId: input.initial.resolutionRunId,
    predecessorRevisionId: input.initial.id,
    kind: "working",
    decisions: [],
    replacementMarkers: [marker],
    nextUncheckedRank: 6,
    unresolvedCountryCodes: [marker.country.countryCode],
    slotCountryCodes: ["AA", "BB", "CC", "DD", marker.country.countryCode],
    phase: "awaiting_decision",
    contextHash: countryResolutionContextHash({
      resolutionRunId: input.initial.resolutionRunId,
      source,
      predecessorRevisionId: input.initial.id,
      operation,
      rulesVersion: "country-resolution@1",
    }, integrity),
    createdAt: "2026-08-12T02:00:00.000Z",
  };
  return { operation, revision, semanticContext };
}

function storedV2Replacement(marker: FrontierMarker = replacementMarkerV2()) {
  const database = openEvidenceDatabase(":memory:");
  insertSourceGraph(database);
  const store = new SqliteCountryResolutionStore(database, HMAC_KEY);
  const initial: CountryResolutionRevision = {
    ...(rootRevision() as Extract<CountryResolutionRevision, { readonly kind: "working" }>),
    nextUncheckedRank: 5,
    unresolvedCountryCodes: [],
    slotCountryCodes: ["AA", "BB", "CC", "DD"],
    phase: "replacement_required",
  };
  store.append({
    revision: initial,
    operation: rootOperation(),
    context: context(["green", "green", "green", "green"]),
  });
  const replacement = replacementSuccessor({ initial, marker });
  store.append({
    revision: replacement.revision,
    operation: replacement.operation,
    context: replacement.semanticContext,
  });
  return { database, initial, replacement, store };
}

function resignResolution(
  database: Database.Database,
  revisionId: string,
  mutate: (revision: Record<string, unknown>) => void,
): void {
  database.exec("DROP TRIGGER country_resolution_revisions_no_update");
  const row = database.prepare(`
    SELECT id, payload_json, command_json FROM country_resolution_revisions WHERE id = ?
  `).get(revisionId) as { readonly id: string; readonly payload_json: string; readonly command_json: string };
  const revision = JSON.parse(row.payload_json) as Record<string, unknown>;
  const operation = JSON.parse(row.command_json) as Record<string, unknown>;
  mutate(revision);
  const payloadJson = canonicalJson(revision);
  database.prepare(`
    UPDATE country_resolution_revisions
    SET payload_json = ?, payload_hash = ?, hmac = ?
    WHERE id = ?
  `).run(
    payloadJson,
    sha256Text(payloadJson),
    hmacSha256(canonicalJson({ revision, operation }), HMAC_KEY),
    row.id,
  );
}

async function concurrentAppends(input: {
  readonly path: string;
  readonly first: { readonly revision: CountryResolutionRevision; readonly operation: CountryResolutionOperation };
  readonly second: { readonly revision: CountryResolutionRevision; readonly operation: CountryResolutionOperation };
}): Promise<readonly string[]> {
  const barrier = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
  const state = new Int32Array(barrier);
  const storePath = join(process.cwd(), "src/infrastructure/sqlite/country-resolution-store.ts");
  const workerSource = `
    const { parentPort, workerData } = require("node:worker_threads");
    require("tsx/cjs");
    const Database = require("better-sqlite3");
    const { SqliteCountryResolutionStore } = require(workerData.storePath);
    const state = new Int32Array(workerData.barrier);
    const database = new Database(workerData.path);
    database.pragma("foreign_keys = ON");
    parentPort.postMessage({ type: "ready" });
    Atomics.wait(state, 0, 0);
    try {
      new SqliteCountryResolutionStore(database, workerData.key).append(workerData.input);
      parentPort.postMessage({ type: "done" });
    } catch (error) {
      parentPort.postMessage({ type: "error", message: error.message });
    } finally {
      database.close();
    }
  `;
  const workers = [input.first, input.second].map((entry) => new Worker(workerSource, {
    eval: true,
    workerData: { path: input.path, storePath, key: HMAC_KEY, barrier, input: { ...entry, context: context() } },
  }));
  const outcomes: string[] = [];
  let ready = 0;
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("country_resolution_race_timeout")), 10_000);
      const finish = () => {
        if (outcomes.length === workers.length) {
          clearTimeout(timeout);
          resolve();
        }
      };
      for (const worker of workers) {
        worker.on("error", reject);
        worker.on("message", (message: { readonly type: string; readonly message?: string }) => {
          if (message.type === "ready") {
            ready += 1;
            if (ready === workers.length) {
              Atomics.store(state, 0, 1);
              Atomics.notify(state, 0, workers.length);
            }
            return;
          }
          outcomes.push(message.type === "done" ? "done" : message.message ?? "worker_error");
          finish();
        });
      }
    });
  } finally {
    await Promise.all(workers.map((worker) => worker.terminate()));
  }
  return outcomes.sort();
}

describe("country resolution revision store", () => {
  test("keeps the historical V1 root payload, hashes, and HMAC byte-exact", () => {
    const database = openEvidenceDatabase(":memory:");
    insertSourceGraph(database);
    const store = new SqliteCountryResolutionStore(database, HMAC_KEY);
    const revision = rootRevision();
    store.append({ revision, operation: rootOperation(), context: context() });

    const row = database.prepare(`
      SELECT payload_json, payload_hash, command_json, command_hash, hmac
      FROM country_resolution_revisions WHERE id = ?
    `).get(revision.id);

    expect(row).toEqual({
      payload_json:
        '{"automaticShortlistSnapshotId":"automatic-shortlist",' +
        '"contextHash":"dc14af9c06350ae7c97f6ce4711037c4dc8fd8c716fe54253e43bc2b1f3c3d6f",' +
        '"createdAt":"2026-08-12T00:00:00.000Z","decisions":[],' +
        '"id":"country-resolution-revision:' +
        '27a40ee9b098eeaf4562ef723b7756c09d415b662bc8423611892a6641198911",' +
        '"kind":"working","nextUncheckedRank":6,"phase":"awaiting_decision",' +
        '"preferenceProfileSnapshotId":"preference-snapshot",' +
        '"profileSnapshotId":"profile-snapshot","rankingSnapshotId":"frozen-ranking",' +
        '"replacementMarkers":[],"resolutionRunId":"country-resolution:' +
        '13455c0fa28119be134e5f1419476aeccb4bebb08dd856139d32cca419252d66",' +
        '"rulesVersion":"country-resolution@1","schemaVersion":"country-resolution@1",' +
        '"slotCountryCodes":["AA","BB","CC","DD","EE"],' +
        '"unresolvedCountryCodes":["AA","BB","CC","DD","EE"]}',
      payload_hash: "aef957853eafdb6d2930f029011c6a0612b3bde7e70c7ddc55158e13fc042088",
      command_json:
        '{"automaticShortlistSnapshotId":"automatic-shortlist",' +
        '"commandId":"country-resolution:start:' +
        '8cd81bb660ab1de8cab1ec0e2b23a79d46832b7a24e58720e38e09619bf48144",' +
        '"kind":"start"}',
      command_hash: "4b03255f21266e9abb67aa0d0eae30578f7a51d5edf2c83cce78646fb44633ba",
      hmac: "68d17f43c3fc5676cb88591098e2c3344e1d21a4d3ec0867f5e4adf5b5a621a2",
    });
  });

  test("binds the complete V2 assessment explanation into the formal marker digest", () => {
    const unknown = countryResolutionMarkerProjection(replacementMarkerV2(), integrity, {
      profileSnapshotId: source.profileSnapshotId,
      evidenceSnapshotId: "evidence-EE",
    });
    const impossible = countryResolutionMarkerProjection(
      replacementMarkerV2("companion_route_impossible"),
      integrity,
      {
        profileSnapshotId: source.profileSnapshotId,
        evidenceSnapshotId: "evidence-EE",
      },
    );

    expect(unknown.formalMarkerDigest).not.toBe(impossible.formalMarkerDigest);
  });

  test("persists and HMAC-binds an exact V2 replacement projection", () => {
    const { database, initial, replacement, store } = storedV2Replacement();

    const row = database.prepare(`
      SELECT payload_json, payload_hash, command_json, hmac
      FROM country_resolution_revisions WHERE id = ?
    `).get(replacement.revision.id) as {
      readonly payload_json: string;
      readonly payload_hash: string;
      readonly command_json: string;
      readonly hmac: string;
    };
    const stored = JSON.parse(row.payload_json) as {
      readonly replacementMarkers: readonly FrontierMarker[];
    };
    expect(stored.replacementMarkers[0]?.assessmentProjection).toEqual(
      replacementMarkerV2().assessmentProjection,
    );
    expect(row.payload_hash).toBe(sha256Text(row.payload_json));
    expect(row.hmac).toBe(hmacSha256(canonicalJson({
      revision: replacement.revision,
      operation: replacement.operation,
    }), HMAC_KEY));
    expect(store.loadHeadVerified(initial.resolutionRunId, replacement.semanticContext))
      .toEqual(replacement.revision);
  });

  test.each([
    ["missing projection field", (projection: Record<string, unknown>) => {
      delete projection.schemaVersion;
    }],
    ["foreign profile binding", (projection: Record<string, unknown>) => {
      projection.profileSnapshotId = "other-profile";
    }],
    ["unknown reason code", (projection: Record<string, unknown>) => {
      const assessments = projection.participantAssessments as Array<Record<string, unknown>>;
      assessments[1]!.reasonCodes = ["invented_reason"];
    }],
    ["duplicate participant pair", (projection: Record<string, unknown>) => {
      const assessments = projection.participantAssessments as Array<Record<string, unknown>>;
      assessments.splice(1, 0, structuredClone(assessments[0]!));
    }],
    ["non-dense route block", (projection: Record<string, unknown>) => {
      const assessments = projection.participantAssessments as Array<Record<string, unknown>>;
      assessments.splice(2, 1);
    }],
  ] as const)("rejects a re-signed V2 replacement with %s", (_name, mutate) => {
    const { database, replacement, store } = storedV2Replacement();
    resignResolution(database, replacement.revision.id, (revision) => {
      const markers = revision.replacementMarkers as Array<Record<string, unknown>>;
      mutate(markers[0]!.assessmentProjection as Record<string, unknown>);
    });

    expect(() => store.loadRevisionVerified(
      replacement.revision.id,
      replacement.semanticContext,
    )).toThrow("integrity_mismatch");
  });

  test("accepts a signed structurally valid V2 route-grid order at the store boundary", () => {
    const canonicalMarker = replacementMarkerV2();
    if (canonicalMarker.sourceAssessmentRulesVersion !== "cold-start-assessment@2") {
      throw new Error("fixture_not_v2");
    }
    const assessments = canonicalMarker.assessmentProjection.participantAssessments;
    const marker: FrontierMarker = {
      ...canonicalMarker,
      assessmentProjection: {
        ...canonicalMarker.assessmentProjection,
        participantAssessments: [...assessments.slice(2), ...assessments.slice(0, 2)],
      },
    };
    const { initial, replacement, store } = storedV2Replacement(marker);

    expect(store.loadHeadVerified(initial.resolutionRunId, replacement.semanticContext))
      .toEqual(replacement.revision);
  });

  test("binds the deterministic run ID to the resolution rules version", () => {
    expect(countryResolutionRunId(source.automaticShortlistSnapshotId, integrity)).toBe(
      `country-resolution:${sha256Text(canonicalJson({
        automaticShortlistSnapshotId: source.automaticShortlistSnapshotId,
        rulesVersion: "country-resolution@1",
      }))}`,
    );
  });

  test("persists a verified root and converges an identical start after the head advances", () => {
    const database = openEvidenceDatabase(":memory:");
    insertSourceGraph(database);
    const store = new SqliteCountryResolutionStore(database, HMAC_KEY);
    const initial = rootRevision();

    expect(store.append({ revision: initial, operation: rootOperation(), context: context() })).toEqual(initial);
    expect(store.loadHeadVerified(initial.resolutionRunId, context())).toEqual(initial);
    expect(store.append({ revision: initial, operation: rootOperation(), context: context() })).toEqual(initial);
  });

  test("rejects a new command whose predecessor is no longer the verified head", () => {
    const database = openEvidenceDatabase(":memory:");
    insertSourceGraph(database);
    const store = new SqliteCountryResolutionStore(database, HMAC_KEY);
    const initial = rootRevision();
    store.append({ revision: initial, operation: rootOperation(), context: context() });
    const operation: CountryResolutionOperation = {
      commandId: "decide-AA",
      kind: "yellow_decision",
      expectedHeadRevisionId: initial.id,
      countryCode: "AA",
      decision: "accepted_at_own_risk",
      warningCopyVersion: "yellow-risk@1",
    };
    const successor = {
      ...rootRevision(operation),
      predecessorRevisionId: initial.id,
      decisions: [{
        countryCode: "AA",
        decision: "accepted_at_own_risk" as const,
        formalMarkerDigest: "marker-AA",
        uncertaintyBasis,
        warningCopyVersion: "yellow-risk@1" as const,
        decidedAt: "2026-08-12T01:00:00.000Z",
        commandId: "decide-AA",
      }],
      unresolvedCountryCodes: ["BB", "CC", "DD", "EE"],
      phase: "awaiting_decision" as const,
      contextHash: countryResolutionContextHash({
        resolutionRunId: initial.resolutionRunId,
        source,
        predecessorRevisionId: initial.id,
        operation,
        rulesVersion: "country-resolution@1",
      }, integrity),
    };
    successor.id = countryResolutionRevisionId(initial.resolutionRunId, operation, integrity);

    expect(store.append({ revision: successor, operation, context: context() })).toEqual(successor);
    expect(store.append({ revision: initial, operation: rootOperation(), context: context() }))
      .toEqual(initial);
    const stale = { ...successor, id: "different", contextHash: successor.contextHash };
    expect(() => store.append({
      revision: stale,
      operation: { ...operation, commandId: "decide-stale", decision: "rejected" },
      context: context(),
    })).toThrow("stale_resolution_head");
  });

  test("makes persisted revisions immutable", () => {
    const database = openEvidenceDatabase(":memory:");
    insertSourceGraph(database);
    const store = new SqliteCountryResolutionStore(database, HMAC_KEY);
    const initial = rootRevision();
    store.append({ revision: initial, operation: rootOperation(), context: context() });

    expect(() => database.prepare("UPDATE country_resolution_revisions SET id = id").run())
      .toThrow("country_resolution_revision_is_immutable");
    expect(() => database.prepare("DELETE FROM country_resolution_revisions").run())
      .toThrow("country_resolution_revision_is_immutable");
  });

  test("rejects a re-signed alteration of the persisted yellow decision", () => {
    const database = openEvidenceDatabase(":memory:");
    insertSourceGraph(database);
    const store = new SqliteCountryResolutionStore(database, HMAC_KEY);
    const initial = rootRevision();
    store.append({ revision: initial, operation: rootOperation(), context: context() });
    const operation: CountryResolutionOperation = {
      commandId: "decide-AA",
      kind: "yellow_decision",
      expectedHeadRevisionId: initial.id,
      countryCode: "AA",
      decision: "accepted_at_own_risk",
      warningCopyVersion: "yellow-risk@1",
    };
    const successor = {
      ...rootRevision(operation),
      id: countryResolutionRevisionId(initial.resolutionRunId, operation, integrity),
      predecessorRevisionId: initial.id,
      decisions: [{
        countryCode: "AA",
        decision: "accepted_at_own_risk" as const,
        formalMarkerDigest: "marker-AA",
        uncertaintyBasis,
        warningCopyVersion: "yellow-risk@1" as const,
        decidedAt: "2026-08-12T01:00:00.000Z",
        commandId: operation.commandId,
      }],
      unresolvedCountryCodes: ["BB", "CC", "DD", "EE"],
      contextHash: countryResolutionContextHash({
        resolutionRunId: initial.resolutionRunId,
        source,
        predecessorRevisionId: initial.id,
        operation,
        rulesVersion: "country-resolution@1",
      }, integrity),
    };
    store.append({ revision: successor, operation, context: context() });

    resignResolution(database, successor.id, (revision) => {
      (revision.decisions as Array<{ decision: string }>)[0]!.decision = "rejected";
    });
    expect(() => store.loadHeadVerified(initial.resolutionRunId, context())).toThrow("integrity_mismatch");
  });

  test("rejects command-ID reuse with a different operation", () => {
    const database = openEvidenceDatabase(":memory:");
    insertSourceGraph(database);
    const store = new SqliteCountryResolutionStore(database, HMAC_KEY);
    const initial = rootRevision();
    store.append({ revision: initial, operation: rootOperation(), context: context() });

    expect(() => store.append({
      revision: initial,
      operation: { ...rootOperation(), automaticShortlistSnapshotId: "other-shortlist" },
      context: context(),
    })).toThrow("integrity_mismatch");
  });

  test("round-trips an immediate all-green resolved root", () => {
    const database = openEvidenceDatabase(":memory:");
    insertSourceGraph(database);
    const store = new SqliteCountryResolutionStore(database, HMAC_KEY);
    const operation = rootOperation();
    const runId = countryResolutionRunId(source.automaticShortlistSnapshotId, integrity);
    const revision: CountryResolutionRevision = {
      ...source,
      schemaVersion: "country-resolution@1",
      rulesVersion: "country-resolution@1",
      id: countryResolutionRevisionId(runId, operation, integrity),
      resolutionRunId: runId,
      kind: "resolved",
      decisions: [],
      replacementMarkers: [],
      nextUncheckedRank: 6,
      unresolvedCountryCodes: [],
      slotCountryCodes: [...orderedCountryCodes.slice(0, 5)],
      resolvedEntries: orderedCountryCodes.slice(0, 5).map((countryCode, index) => ({
        countryCode,
        rank: index + 1,
        formalMarkerDigest: `marker-${countryCode}`,
      })),
      stopCondition: "five_effective_green",
      contextHash: countryResolutionContextHash({
        resolutionRunId: runId,
        source,
        operation,
        rulesVersion: "country-resolution@1",
      }, integrity),
      createdAt: "2026-08-12T00:00:00.000Z",
    };

    expect(store.append({ revision, operation, context: context(["green", "green", "green", "green", "green"]) }))
      .toEqual(revision);
    expect(store.loadRevisionVerified(revision.id, context(["green", "green", "green", "green", "green"])))
      .toEqual(revision);
  });

  test("locates only closed signed topology before semantic context is supplied", () => {
    const database = openEvidenceDatabase(":memory:");
    insertSourceGraph(database);
    const store = new SqliteCountryResolutionStore(database, HMAC_KEY);
    const revision = rootRevision();
    store.append({ revision, operation: rootOperation(), context: context() });

    expect(store.locateChainVerified({ revisionId: revision.id })).toEqual({
      resolutionRunId: revision.resolutionRunId,
      source,
      revisions: [revision],
    });
    database.exec("DROP TRIGGER country_resolution_revisions_no_update");
    database.prepare("UPDATE country_resolution_revisions SET hmac = '0' || substr(hmac, 2)").run();
    expect(() => store.locateChainVerified({ resolutionRunId: revision.resolutionRunId }))
      .toThrow("integrity_mismatch");
  });

  test("allows one barrier-synchronized accept/reject successor and rejects the stale command", async () => {
    const directory = mkdtempSync(join(tmpdir(), "country-resolution-race-"));
    const path = join(directory, "resolution.sqlite");
    try {
      const database = openEvidenceDatabase(path);
      insertSourceGraph(database);
      const store = new SqliteCountryResolutionStore(database, HMAC_KEY);
      const initial = rootRevision();
      store.append({ revision: initial, operation: rootOperation(), context: context() });
      const candidate = (commandId: string, decision: "accepted_at_own_risk" | "rejected") => {
        const operation: CountryResolutionOperation = {
          commandId,
          kind: "yellow_decision",
          expectedHeadRevisionId: initial.id,
          countryCode: "AA",
          decision,
          warningCopyVersion: "yellow-risk@1",
        };
        return {
          operation,
          revision: {
            ...rootRevision(operation),
            id: countryResolutionRevisionId(initial.resolutionRunId, operation, integrity),
            predecessorRevisionId: initial.id,
            decisions: [{
              countryCode: "AA", decision, formalMarkerDigest: "marker-AA", uncertaintyBasis,
              warningCopyVersion: "yellow-risk@1" as const, decidedAt: "2026-08-12T01:00:00.000Z", commandId,
            }],
            unresolvedCountryCodes: ["BB", "CC", "DD", "EE"],
            ...(decision === "rejected"
              ? { slotCountryCodes: ["BB", "CC", "DD", "EE"], phase: "replacement_required" as const }
              : {}),
            contextHash: countryResolutionContextHash({
              resolutionRunId: initial.resolutionRunId, source, predecessorRevisionId: initial.id, operation,
              rulesVersion: "country-resolution@1",
            }, integrity),
          },
        };
      };
      const [first, second] = [candidate("accept", "accepted_at_own_risk"), candidate("reject", "rejected")];

      await expect(concurrentAppends({ path, first, second }))
        .resolves.toEqual(["done", "stale_resolution_head"]);
      expect(database.prepare(
        "SELECT COUNT(*) AS count FROM country_resolution_revisions WHERE predecessor_id = ?",
      ).get(initial.id)).toEqual({ count: 1 });
      database.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("converges two barrier-synchronized identical decision workers", async () => {
    const directory = mkdtempSync(join(tmpdir(), "country-resolution-idempotent-race-"));
    const path = join(directory, "resolution.sqlite");
    try {
      const database = openEvidenceDatabase(path);
      insertSourceGraph(database);
      const store = new SqliteCountryResolutionStore(database, HMAC_KEY);
      const initial = rootRevision();
      store.append({ revision: initial, operation: rootOperation(), context: context() });
      const operation: CountryResolutionOperation = {
        commandId: "same-accept",
        kind: "yellow_decision",
        expectedHeadRevisionId: initial.id,
        countryCode: "AA",
        decision: "accepted_at_own_risk",
        warningCopyVersion: "yellow-risk@1",
      };
      const revision = {
        ...rootRevision(operation),
        id: countryResolutionRevisionId(initial.resolutionRunId, operation, integrity),
        predecessorRevisionId: initial.id,
        decisions: [{
          countryCode: "AA", decision: "accepted_at_own_risk" as const, formalMarkerDigest: "marker-AA",
          uncertaintyBasis, warningCopyVersion: "yellow-risk@1" as const,
          decidedAt: "2026-08-12T01:00:00.000Z", commandId: operation.commandId,
        }],
        unresolvedCountryCodes: ["BB", "CC", "DD", "EE"],
        contextHash: countryResolutionContextHash({
          resolutionRunId: initial.resolutionRunId, source, predecessorRevisionId: initial.id, operation,
          rulesVersion: "country-resolution@1",
        }, integrity),
      };

      await expect(concurrentAppends({
        path,
        first: { revision, operation },
        second: { revision, operation },
      })).resolves.toEqual(["done", "done"]);
      expect(database.prepare(
        "SELECT COUNT(*) AS count FROM country_resolution_revisions WHERE predecessor_id = ?",
      ).get(initial.id)).toEqual({ count: 1 });
      database.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test.each([
    ["rank", (marker: Record<string, unknown>) => { marker.rank = 99; }],
    ["unknown nested key", (marker: Record<string, unknown>) => {
      (marker.country as Record<string, unknown>).unexpected = true;
    }],
    ["formal verdict", (marker: Record<string, unknown>) => {
      (marker.formalVerdict as Record<string, unknown>).verdictAsOf = "2026-08-11";
    }],
  ] as const)("rejects a re-signed persisted replacement marker with changed %s", (_name, mutate) => {
    const database = openEvidenceDatabase(":memory:");
    insertSourceGraph(database);
    const store = new SqliteCountryResolutionStore(database, HMAC_KEY);
    const initial: CountryResolutionRevision = {
      ...(rootRevision() as Extract<CountryResolutionRevision, { readonly kind: "working" }>),
      nextUncheckedRank: 5,
      unresolvedCountryCodes: [],
      slotCountryCodes: ["AA", "BB", "CC", "DD"],
      phase: "replacement_required",
    };
    store.append({
      revision: initial,
      operation: rootOperation(),
      context: context(["green", "green", "green", "green"]),
    });
    const replacement = replacementSuccessor({ initial });
    store.append({
      revision: replacement.revision,
      operation: replacement.operation,
      context: replacement.semanticContext,
    });

    resignResolution(database, replacement.revision.id, (revision) => {
      mutate((revision.replacementMarkers as Record<string, unknown>[])[0]!);
    });

    expect(() => store.loadHeadVerified(initial.resolutionRunId, replacement.semanticContext))
      .toThrow("integrity_mismatch");
    expect(() => store.loadChainVerified(initial.resolutionRunId, replacement.semanticContext))
      .toThrow("integrity_mismatch");
  });

  test("rejects malformed nested replacement markers as integrity failures", () => {
    const database = openEvidenceDatabase(":memory:");
    insertSourceGraph(database);
    const store = new SqliteCountryResolutionStore(database, HMAC_KEY);
    const initial: CountryResolutionRevision = {
      ...(rootRevision() as Extract<CountryResolutionRevision, { readonly kind: "working" }>),
      nextUncheckedRank: 5,
      unresolvedCountryCodes: [],
      slotCountryCodes: ["AA", "BB", "CC", "DD"],
      phase: "replacement_required",
    };
    store.append({
      revision: initial,
      operation: rootOperation(),
      context: context(["green", "green", "green", "green"]),
    });
    const replacement = replacementSuccessor({ initial });
    store.append({
      revision: replacement.revision,
      operation: replacement.operation,
      context: replacement.semanticContext,
    });

    resignResolution(database, replacement.revision.id, (revision) => {
      (revision.replacementMarkers as Record<string, unknown>[])[0]!.country = null;
    });

    expect(() => store.loadRevisionVerified(replacement.revision.id, replacement.semanticContext))
      .toThrow("integrity_mismatch");
  });
});
