import { afterEach, describe, expect, test, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

import type {
  FrontierCountry,
  FrontierMarker,
  PlaceFrontierApplication,
  PlaceFrontierPrepared,
  PlaceFrontierEvent,
  PlaceFrontierReadModel,
  RankingSnapshot,
} from "../../src/application/place-frontier";
import type { FormalResidenceVerdict } from
  "../../src/decision/formal-residence-verdict";
import {
  FINITE_NDJSON_MAX_LINE_BYTES,
  readFiniteNdjson,
} from "../../src/experience/finite-ndjson";
import {
  decodePlaceFrontierStream,
  initialPlaceFrontierEventState,
  reducePlaceFrontierEvent,
} from "../../src/experience/place-frontier-stream";
import {
  createPlaceFrontierRunningState,
  failPlaceFrontierScreen,
  presentPlaceFrontierReadModel,
  projectPlaceFrontierView,
  reducePlaceFrontierScreenEvent,
} from "../../src/experience/place-frontier-view-model";

const NOW = "2026-08-12T08:00:00.000Z";
const DAY = "2026-08-12";
const PROFILE_ID = "c".repeat(64);
const PREFERENCE_PROFILE_ID = "d".repeat(64);
const TEST_DIRECTORY = dirname(fileURLToPath(import.meta.url));

function streamOf(...chunks: readonly Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

function line(value: unknown): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(value)}\n`);
}

async function collectUnknown(
  stream: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): Promise<unknown[]> {
  const values: unknown[] = [];
  for await (const value of readFiniteNdjson(stream, signal)) values.push(value);
  return values;
}

async function collectEvents(
  stream: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): Promise<PlaceFrontierEvent[]> {
  const events: PlaceFrontierEvent[] = [];
  for await (const event of decodePlaceFrontierStream(stream, signal)) events.push(event);
  return events;
}

function country(countryCode: string, rank: number): FrontierCountry {
  return {
    countryCode,
    label: `Country ${countryCode}`,
    flag: `flag-${countryCode}`,
    coordinate: { lat: 40 + rank, lng: 10 + rank },
  };
}

function verdict(countryCode: string, evidenceSnapshotId: string): FormalResidenceVerdict {
  const evidence = {
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
  const reason = {
    code: `${countryCode}_route_viable`,
    summary: `${countryCode} route is viable`,
    claimIds: [`claim-${countryCode}`],
    evidence: [evidence],
    navigation: [{
      sourceId: `source-${countryCode}`,
      url: `https://example.test/${countryCode}`,
      label: `Official ${countryCode}`,
    }],
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
      proceduralActions: [{ kind: "insurance", completed: false }],
      contingentActions: [],
    }],
    reasons: [reason],
    catalogCompleteness: {
      status: "unproven",
      reasonCode: "catalog_completeness_unprovable",
    },
  };
}

function unresolvedVerdict(countryCode: string): FormalResidenceVerdict {
  void countryCode;
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

function impossibleVerdict(
  countryCode: string,
  evidenceSnapshotId: string,
): FormalResidenceVerdict {
  const evidence = verdict(countryCode, evidenceSnapshotId).reasons[0]!.evidence[0]!;
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
        authority: `Authority ${countryCode}`,
        scopeKind: "all_long_term_residence_routes_for_profile",
        profileSnapshotId: PROFILE_ID,
        catalogRoutes: [{
          routeId: `excluded-${countryCode}`,
          applicability: "excluded",
          exclusionCode: "profile_not_eligible",
          claimIds: [`claim-${countryCode}`],
          evidence: [evidence],
        }],
        validatorVersion: "catalog-validator@1",
        effectiveFrom: "2026-01-01",
        evidenceSnapshotId,
        catalogEvidence: [evidence],
      },
    },
  };
}

function marker(countryCode: string, rank: number): FrontierMarker {
  const evidenceSnapshotId = `evidence-${countryCode}`;
  return {
    country: country(countryCode, rank),
    rank,
    countryCheckRunId: `frontier-country:${String(rank).repeat(64).slice(0, 64)}`,
    sourceAssessmentRulesVersion: "cold-start-assessment@1",
    lastCheckedAt: DAY,
    evidenceSnapshotId,
    formalVerdict: verdict(countryCode, evidenceSnapshotId),
  };
}

function markerWithStatus(
  countryCode: string,
  rank: number,
  status: "green" | "yellow" | "red",
): FrontierMarker {
  const base = marker(countryCode, rank);
  return {
    ...base,
    currentKnowledgeRevisionId: `knowledge-current-${countryCode}`,
    ...(countryCode === "SI" ? {
      updatedKnowledgeRevisionId: `knowledge-current-${countryCode}`,
    } : {}),
    knowledgeUpdatedAt: `2026-08-12T0${rank}:00:00.000Z`,
    formalVerdict: status === "green"
      ? base.formalVerdict
      : status === "yellow"
        ? unresolvedVerdict(countryCode)
        : impossibleVerdict(countryCode, base.evidenceSnapshotId),
  };
}

function ranking(runId: string, countryCodes: readonly string[]): RankingSnapshot {
  return {
    schemaVersion: "place-ranking@1",
    id: `${runId}:ranking`,
    runId,
    profileSnapshotId: PROFILE_ID,
    preferenceProfileSnapshotId: PREFERENCE_PROFILE_ID,
    assessmentAt: NOW,
    contextHash: "b".repeat(64),
    knowledgeRevisionIds: Object.fromEntries(countryCodes.map((code) => [code, null])),
    ordered: countryCodes.map((countryCode, index) => ({
      ...country(countryCode, index + 1),
      factors: [{
        criterionId: "personal_safety" as const,
        state: "known" as const,
        match: "1",
        observationId: `observation-${countryCode}`,
        evaluatorVersion: "fixture-factor@1",
      }],
      rank: index + 1,
      relevance: `0.${9 - index}`,
      coverage: `0.${8 - index}`,
      contributions: [{
        criterionId: "personal_safety" as const,
        state: "known" as const,
        effectiveMatch: "1",
        weightedContribution: String(5 - index),
        observationId: `observation-${countryCode}`,
      }],
    })),
    excludedPlaces: [],
    excluded: [],
    rulesVersion: "place-ranker@1",
    createdAt: NOW,
  };
}

function validFixture(runId = "frontier-run-1") {
  const rankingSnapshot = ranking(runId, ["SI"]);
  const completedMarker = marker("SI", 1);
  const readModel: PlaceFrontierReadModel = {
    runId,
    assessmentAt: NOW,
    rankingSnapshot,
    shortlistSnapshot: {
      schemaVersion: "place-shortlist@1",
      id: `${runId}:shortlist`,
      runId,
      rankingSnapshotId: rankingSnapshot.id,
      markers: [completedMarker],
      rulesVersion: "country-frontier@1",
      createdAt: NOW,
    },
  };
  const events: PlaceFrontierEvent[] = [
    {
      runId,
      sequence: 1,
      occurredAt: NOW,
      type: "ranking_sealed",
      payload: {
        rankingSnapshotId: rankingSnapshot.id,
        orderedCountryCodes: ["SI"],
        excludedCountryCodes: [],
      },
    },
    {
      runId,
      sequence: 2,
      occurredAt: NOW,
      type: "country_activated",
      payload: { country: completedMarker.country, rank: 1 },
    },
    {
      runId,
      sequence: 3,
      occurredAt: NOW,
      type: "country_completed",
      payload: { marker: completedMarker },
    },
    {
      runId,
      sequence: 4,
      occurredAt: NOW,
      type: "frontier_completed",
      payload: { readModel },
    },
  ];
  return { events, readModel };
}

function sixCountryFixture() {
  const runId = "frontier-run-six";
  const codes = ["DE", "ES", "FR", "IT", "PT", "SI"] as const;
  const rankingSnapshot = ranking(runId, codes);
  const knowledgeRevisionIds = rankingSnapshot.knowledgeRevisionIds as
    Record<string, string | null>;
  for (const code of codes) knowledgeRevisionIds[code] = `knowledge-ranking-${code}`;
  const markers = codes.map((code, index) => markerWithStatus(
    code,
    index + 1,
    code === "ES" ? "red" : code === "FR" ? "yellow" : "green",
  ));
  const readModel: PlaceFrontierReadModel = {
    runId,
    assessmentAt: NOW,
    rankingSnapshot,
    shortlistSnapshot: {
      schemaVersion: "place-shortlist@1",
      id: `${runId}:shortlist`,
      runId,
      rankingSnapshotId: rankingSnapshot.id,
      markers,
      rulesVersion: "country-frontier@1",
      createdAt: NOW,
    },
  };
  let sequence = 0;
  const base = (type: PlaceFrontierEvent["type"]) => ({
    runId,
    sequence: ++sequence,
    occurredAt: NOW,
    type,
  });
  const events: PlaceFrontierEvent[] = [{
    ...base("ranking_sealed"),
    type: "ranking_sealed",
    payload: {
      rankingSnapshotId: rankingSnapshot.id,
      orderedCountryCodes: codes,
      excludedCountryCodes: [],
    },
  }];
  for (const [index, code] of codes.slice(0, 5).entries()) {
    events.push({
      ...base("country_activated"),
      type: "country_activated",
      payload: { country: country(code, index + 1), rank: index + 1 },
    });
  }
  events.push({ ...base("country_completed"), type: "country_completed", payload: { marker: markers[0]! } });
  events.push({
    ...base("country_progress"),
    type: "country_progress",
    payload: {
      countryCode: "ES",
      stage: "artifact_captured",
      label: "Spanish residence catalog",
      detail: "captured",
      sourceUrl: "https://example.test/ES",
    },
  });
  events.push({ ...base("country_completed"), type: "country_completed", payload: { marker: markers[1]! } });
  events.push({
    ...base("country_activated"),
    type: "country_activated",
    payload: { country: country("SI", 6), rank: 6 },
  });
  for (const completed of markers.slice(2)) {
    events.push({ ...base("country_completed"), type: "country_completed", payload: { marker: completed } });
  }
  events.push({
    ...base("frontier_completed"),
    type: "frontier_completed",
    payload: { readModel },
  });
  return { events, readModel };
}

function encodedEvents(events: readonly PlaceFrontierEvent[]): Uint8Array[] {
  return events.map(line);
}

describe("finite NDJSON framing", () => {
  test("decodes split UTF-8 and JSON and flushes a final complete LF line", async () => {
    const bytes = line({ label: "Словения" });
    const splitAt = bytes.indexOf(new TextEncoder().encode("С")[0]!);

    await expect(collectUnknown(streamOf(
      bytes.slice(0, splitAt + 1),
      bytes.slice(splitAt + 1),
    ))).resolves.toEqual([{ label: "Словения" }]);
  });

  test("rejects fatal UTF-8, partial EOF and an empty line", async () => {
    await expect(collectUnknown(streamOf(new Uint8Array([0xc3, 0x28, 0x0a]))))
      .rejects.toThrow();
    await expect(collectUnknown(streamOf(new TextEncoder().encode("{\"ok\":true}"))))
      .rejects.toThrow("trailing_partial_line");
    await expect(collectUnknown(streamOf(new Uint8Array([0x0a])))).rejects.toThrow();
  });

  test("accepts exactly 256 KiB excluding LF and rejects one byte more", async () => {
    const exact = `"${"x".repeat(FINITE_NDJSON_MAX_LINE_BYTES - 2)}"`;
    await expect(collectUnknown(streamOf(new TextEncoder().encode(`${exact}\n`))))
      .resolves.toEqual(["x".repeat(FINITE_NDJSON_MAX_LINE_BYTES - 2)]);

    const oversized = `"${"x".repeat(FINITE_NDJSON_MAX_LINE_BYTES - 1)}"\n`;
    await expect(collectUnknown(streamOf(new TextEncoder().encode(oversized))))
      .rejects.toThrow("line_too_large");
  });

  test("cancels and releases on early return and explicit abort", async () => {
    const earlyCancel = vi.fn();
    const earlyStream = new ReadableStream<Uint8Array>({
      cancel: earlyCancel,
      start(controller) { controller.enqueue(line({ first: true })); },
    });
    const iterator = readFiniteNdjson(earlyStream);
    await expect(iterator.next()).resolves.toEqual({ done: false, value: { first: true } });
    await iterator.return(undefined);
    expect(earlyCancel).toHaveBeenCalledOnce();
    expect(earlyStream.locked).toBe(false);

    const abortCancel = vi.fn();
    const abortStream = new ReadableStream<Uint8Array>({ cancel: abortCancel });
    const abort = new AbortController();
    const reason = new Error("screen_replaced");
    const next = readFiniteNdjson(abortStream, abort.signal).next();
    abort.abort(reason);
    await expect(next).rejects.toBe(reason);
    expect(abortCancel).toHaveBeenCalledWith(reason);
    expect(abortStream.locked).toBe(false);
  });
});

describe("strict finite frontier protocol", () => {
  test("accepts one complete closed stream and freezes copied state", async () => {
    const fixture = validFixture();
    const events = await collectEvents(streamOf(...encodedEvents(fixture.events)));
    let state = initialPlaceFrontierEventState();
    for (const event of events) state = reducePlaceFrontierEvent(state, event);

    expect(events).toEqual(fixture.events);
    expect(state.terminal).toEqual(fixture.readModel);
    expect(Object.isFrozen(state)).toBe(true);
    expect(Object.isFrozen(state.events)).toBe(true);
  });

  test.each([
    ["wrong first type", (events: PlaceFrontierEvent[]) => events.slice(1)],
    ["wrong first sequence", (events: PlaceFrontierEvent[]) => {
      events[0] = { ...events[0]!, sequence: 2 } as PlaceFrontierEvent;
    }],
    ["changed run", (events: PlaceFrontierEvent[]) => {
      events[1] = { ...events[1]!, runId: "frontier-run-2" } as PlaceFrontierEvent;
    }],
    ["duplicate activation", (events: PlaceFrontierEvent[]) => {
      events.splice(2, 0, { ...events[1]!, sequence: 3 } as PlaceFrontierEvent);
      events.slice(3).forEach((event, index) => {
        events[index + 3] = { ...event, sequence: index + 4 } as PlaceFrontierEvent;
      });
    }],
    ["sixth activation before a red opens a slot", () => {
      const fixture = sixCountryFixture();
      return [
        ...fixture.events.slice(0, 6),
        fixture.events[9]!,
        ...fixture.events.slice(6, 9),
        ...fixture.events.slice(10),
      ].map((event, index) => ({ ...event, sequence: index + 1 } as PlaceFrontierEvent));
    }],
    ["progress before activation", (events: PlaceFrontierEvent[]) => {
      events[1] = {
        runId: events[0]!.runId,
        sequence: 2,
        occurredAt: NOW,
        type: "country_progress",
        payload: { countryCode: "SI", stage: "claim_verified", label: "claim" },
      };
    }],
    ["changed completion rank", (events: PlaceFrontierEvent[]) => {
      const completion = events[2] as Extract<PlaceFrontierEvent, { type: "country_completed" }>;
      events[2] = {
        ...completion,
        payload: { marker: { ...completion.payload.marker, rank: 2 } },
      };
    }],
    ["changed completion identity", (events: PlaceFrontierEvent[]) => {
      const completion = events[2] as Extract<PlaceFrontierEvent, { type: "country_completed" }>;
      events[2] = {
        ...completion,
        payload: { marker: {
          ...completion.payload.marker,
          country: { ...completion.payload.marker.country, label: "Changed Slovenia" },
        } },
      };
    }],
    ["duplicate completion", (events: PlaceFrontierEvent[]) => {
      events.splice(3, 0, { ...events[2]!, sequence: 4 } as PlaceFrontierEvent);
      events[4] = { ...events[4]!, sequence: 5 } as PlaceFrontierEvent;
    }],
    ["mismatched updated head", (events: PlaceFrontierEvent[]) => {
      const completion = events[2] as Extract<PlaceFrontierEvent, { type: "country_completed" }>;
      events[2] = { ...completion, payload: { marker: {
        ...completion.payload.marker,
        currentKnowledgeRevisionId: "knowledge-current:SI",
        updatedKnowledgeRevisionId: "knowledge-other:SI",
        knowledgeUpdatedAt: NOW,
      } } };
    }],
    ["premature terminal", (events: PlaceFrontierEvent[]) => events.splice(2, 1)],
    ["terminal marker history", (events: PlaceFrontierEvent[]) => {
      const terminal = events.at(-1) as Extract<PlaceFrontierEvent, { type: "frontier_completed" }>;
      const markers = terminal.payload.readModel.shortlistSnapshot.markers as FrontierMarker[];
      markers[0] = {
        ...markers[0]!,
        lastCheckedAt: "2026-08-11",
      };
    }],
    ["terminal ranking order", (events: PlaceFrontierEvent[]) => {
      const terminal = events.at(-1) as Extract<PlaceFrontierEvent, { type: "frontier_completed" }>;
      const ordered = terminal.payload.readModel.rankingSnapshot.ordered as
        RankingSnapshot["ordered"][number][];
      ordered[0] = {
        ...ordered[0]!,
        countryCode: "DE",
      };
    }],
    ["terminal shortlist reference", (events: PlaceFrontierEvent[]) => {
      const terminal = events.at(-1) as Extract<PlaceFrontierEvent, { type: "frontier_completed" }>;
      (terminal.payload.readModel.shortlistSnapshot as { rankingSnapshotId: string })
        .rankingSnapshotId = "other:ranking";
    }],
    ["unknown wire field", (events: PlaceFrontierEvent[]) => {
      (events[1] as PlaceFrontierEvent & { unexpected?: boolean }).unexpected = true;
    }],
    ["duplicate terminal", (events: PlaceFrontierEvent[]) => {
      events.push({ ...events.at(-1)!, sequence: 5 } as PlaceFrontierEvent);
    }],
  ] as const)("rejects %s", async (_name, mutate) => {
    const events = structuredClone(validFixture().events) as PlaceFrontierEvent[];
    const replacement = mutate(events);
    const invalid = replacement ?? events;
    await expect(collectEvents(streamOf(...encodedEvents(invalid)))).rejects.toThrow();
  });

  test("rejects a missing terminal and progress after completion", async () => {
    const fixture = validFixture();
    await expect(collectEvents(streamOf())).rejects.toThrow("missing_terminal_event");
    await expect(collectEvents(streamOf(...encodedEvents(fixture.events.slice(0, -1)))))
      .rejects.toThrow("missing_terminal_event");

    const progress: PlaceFrontierEvent = {
      runId: fixture.events[0]!.runId,
      sequence: 4,
      occurredAt: NOW,
      type: "country_progress",
      payload: { countryCode: "SI", stage: "claim_verified", label: "late" },
    };
    await expect(collectEvents(streamOf(...encodedEvents([
      ...fixture.events.slice(0, -1),
      progress,
    ])))).rejects.toThrow();
  });

  test("holds terminal through transport error or trailing data", async () => {
    const fixture = validFixture();
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
    const errored = new ReadableStream<Uint8Array>({
      start(value) { controller = value; },
    });
    const received: PlaceFrontierEvent[] = [];
    const consume = async () => {
      for await (const event of decodePlaceFrontierStream(errored)) received.push(event);
    };
    const consuming = consume();
    for (const event of fixture.events) controller?.enqueue(line(event));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const transportError = new Error("transport_failed_after_terminal_line");
    controller?.error(transportError);

    await expect(consuming).rejects.toBe(transportError);
    expect(received.map(({ type }) => type)).not.toContain("frontier_completed");

    await expect(collectEvents(streamOf(
      ...encodedEvents(fixture.events),
      new TextEncoder().encode("trailing"),
    ))).rejects.toThrow("trailing_partial_line");

    let abortStreamController: ReadableStreamDefaultController<Uint8Array> | undefined;
    const cancelled = new ReadableStream<Uint8Array>({
      start(value) { abortStreamController = value; },
    });
    const abort = new AbortController();
    const cancelledEvents: PlaceFrontierEvent[] = [];
    const consumeCancelled = async () => {
      for await (const event of decodePlaceFrontierStream(cancelled, abort.signal)) {
        cancelledEvents.push(event);
      }
    };
    const cancelling = consumeCancelled();
    for (const event of fixture.events) abortStreamController?.enqueue(line(event));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const cancelReason = new Error("screen_replaced_after_terminal_line");
    abort.abort(cancelReason);
    await expect(cancelling).rejects.toBe(cancelReason);
    expect(cancelledEvents.map(({ type }) => type)).not.toContain("frontier_completed");
  });
});

describe("place-frontier browser boundary", () => {
  test("Experience entry modules have no runtime import from outer or Node layers", () => {
    const entryFiles = [
      "../../src/experience/place-frontier-stream.ts",
      "../../src/experience/place-frontier-view-model.ts",
    ];
    const forbiddenRuntimeImports: string[] = [];
    for (const relativePath of entryFiles) {
      const path = resolve(TEST_DIRECTORY, relativePath);
      const source = ts.createSourceFile(
        path,
        readFileSync(path, "utf8"),
        ts.ScriptTarget.Latest,
        true,
      );
      for (const statement of source.statements) {
        if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
          continue;
        }
        const specifier = statement.moduleSpecifier.text;
        const isForbidden = specifier.startsWith("../application") ||
          specifier.startsWith("../infrastructure") || specifier.startsWith("node:");
        const clause = statement.importClause;
        if (!isForbidden || clause?.isTypeOnly) continue;
        const hasRuntimeBinding = clause === undefined || clause.name !== undefined ||
          clause.namedBindings === undefined || ts.isNamespaceImport(clause.namedBindings) ||
          clause.namedBindings.elements.some((element) => !element.isTypeOnly);
        if (hasRuntimeBinding) forbiddenRuntimeImports.push(`${relativePath}: ${specifier}`);
      }
    }

    expect(forbiddenRuntimeImports).toEqual([]);
  });

  test("bundles both Experience entry points for a real web target", () => {
    expect(() => execFileSync(
      process.execPath,
      [resolve(TEST_DIRECTORY, "../fixtures/place-frontier-client/bundle-smoke.cjs")],
      { encoding: "utf8", stdio: "pipe" },
    )).not.toThrow();
  });
});

describe("pure place-frontier projection", () => {
  test("starts empty and derives markers, progress and latest flight only from events", () => {
    const fixture = sixCountryFixture();
    let state = createPlaceFrontierRunningState(fixture.readModel.runId);

    expect(projectPlaceFrontierView(state)).toMatchObject({
      markers: [],
      progress: [],
      liveTimeline: [],
      cards: [],
      globeMode: "full",
    });
    for (const event of fixture.events.slice(0, 6)) {
      state = reducePlaceFrontierScreenEvent(state, event);
    }
    const fiveActivated = projectPlaceFrontierView(state);
    expect(fiveActivated.markers.map(({ id, status }) => [id, status])).toEqual([
      ["DE", "pending"],
      ["ES", "pending"],
      ["FR", "pending"],
      ["IT", "pending"],
      ["PT", "pending"],
    ]);
    expect(fiveActivated.globe.activeFlight?.key).toBe(`${fixture.readModel.runId}:PT`);
    expect(fiveActivated.progress).toEqual([]);
  });

  test("changes only the completed marker, preserves red, and keeps every activated route", () => {
    const fixture = sixCountryFixture();
    let state = createPlaceFrontierRunningState(fixture.readModel.runId);
    for (const event of fixture.events.slice(0, 7)) {
      state = reducePlaceFrontierScreenEvent(state, event);
    }
    const afterFirstCompletion = projectPlaceFrontierView(state);
    expect(afterFirstCompletion.globe.activeFlight?.key).toBe("frontier-run-six:PT");
    expect(afterFirstCompletion.globe.routes.find(({ key }) => key === "frontier-run-six:DE")?.status)
      .toBe("green");
    for (const event of fixture.events.slice(7, 10)) {
      state = reducePlaceFrontierScreenEvent(state, event);
    }
    const view = projectPlaceFrontierView(state);

    expect(view.markers.map(({ id, status }) => [id, status])).toEqual([
      ["DE", "green"],
      ["ES", "red"],
      ["FR", "pending"],
      ["IT", "pending"],
      ["PT", "pending"],
      ["SI", "pending"],
    ]);
    expect(view.globe.routes.map(({ key }) => key)).toEqual([
      "frontier-run-six:DE",
      "frontier-run-six:ES",
      "frontier-run-six:FR",
      "frontier-run-six:IT",
      "frontier-run-six:PT",
      "frontier-run-six:SI",
    ]);
    expect(view.globe.activeFlight?.key).toBe("frontier-run-six:SI");
    expect(view.progress).toEqual([expect.objectContaining({
      label: "Spanish residence catalog",
      sourceUrl: "https://example.test/ES",
    })]);
  });

  test("copies exact non-red terminal cards, lineage and summary without recomputation", () => {
    const fixture = sixCountryFixture();
    let state = createPlaceFrontierRunningState(fixture.readModel.runId);
    for (const event of fixture.events) state = reducePlaceFrontierScreenEvent(state, event);
    const view = projectPlaceFrontierView(state);

    expect(view.globeMode).toBe("collapsed");
    expect(view.markers.map(({ id, status }) => [id, status])).toEqual([
      ["DE", "green"],
      ["ES", "red"],
      ["FR", "yellow"],
      ["IT", "green"],
      ["PT", "green"],
      ["SI", "green"],
    ]);
    expect(view.cards.map(({ country }) => country.countryCode)).toEqual([
      "DE", "FR", "IT", "PT", "SI",
    ]);
    expect(view.summary).toEqual({
      countries: ["DE", "FR", "IT", "PT", "SI"],
      composition: { green: 4, yellow: 1 },
      stopCondition: "five_non_red",
      preliminary: true,
    });
    const slovenia = view.cards.at(-1)!;
    const ranked = fixture.readModel.rankingSnapshot.ordered[5]!;
    const terminalMarker = fixture.readModel.shortlistSnapshot.markers[5]!;
    expect(slovenia).toEqual({
      country: terminalMarker.country,
      rank: terminalMarker.rank,
      relevance: ranked.relevance,
      coverage: ranked.coverage,
      contributions: ranked.contributions,
      formalVerdict: terminalMarker.formalVerdict,
      evidenceSnapshotId: terminalMarker.evidenceSnapshotId,
      sourceAssessmentRulesVersion: terminalMarker.sourceAssessmentRulesVersion,
      rankingKnowledgeRevisionId: "knowledge-ranking-SI",
      currentKnowledgeRevisionId: "knowledge-current-SI",
      currentRunUpdatedRevisionId: "knowledge-current-SI",
      lastCheckedAt: terminalMarker.lastCheckedAt,
      knowledgeUpdatedAt: terminalMarker.knowledgeUpdatedAt,
    });
    expect(slovenia.contributions).toEqual(ranked.contributions);
    expect(slovenia.formalVerdict).toEqual(terminalMarker.formalVerdict);
  });

  test("reload matches live terminal data with empty timeline and no active flight", () => {
    const fixture = validFixture("frontier-run-reload");
    let liveState = createPlaceFrontierRunningState(fixture.readModel.runId);
    for (const event of fixture.events) {
      liveState = reducePlaceFrontierScreenEvent(liveState, event);
    }
    const live = projectPlaceFrontierView(liveState);
    const reloadState = presentPlaceFrontierReadModel(fixture.readModel);
    const reload = projectPlaceFrontierView(reloadState);

    expect(reload.markers).toEqual(live.markers);
    expect(reload.cards).toEqual(live.cards);
    expect(reload.summary).toEqual({
      countries: ["SI"],
      composition: { green: 1, yellow: 0 },
      stopCondition: "installed_coverage_exhausted",
      preliminary: true,
    });
    expect(reload.summary).toEqual(live.summary);
    expect(reload.liveTimeline).toEqual([]);
    expect(reload.progress).toEqual([]);
    expect(reload.globe.activeFlight).toBeUndefined();
  });

  test("transport error retains partial history without terminal cards", () => {
    const fixture = sixCountryFixture();
    let state = createPlaceFrontierRunningState(fixture.readModel.runId);
    for (const event of fixture.events.slice(0, 9)) {
      state = reducePlaceFrontierScreenEvent(state, event);
    }
    const failed = failPlaceFrontierScreen(state, "connection_lost");
    const view = projectPlaceFrontierView(failed);

    expect(view.transportError).toBe("connection_lost");
    expect(view.liveTimeline).toHaveLength(9);
    expect(view.markers).toHaveLength(5);
    expect(view.markers[0]?.status).toBe("green");
    expect(view.cards).toEqual([]);
    expect(view.summary).toBeUndefined();
  });

  test("rejects a screen event whose run differs from the screen", () => {
    const fixture = validFixture();
    expect(() => reducePlaceFrontierScreenEvent(
      createPlaceFrontierRunningState("other-run"),
      fixture.events[0]!,
    )).toThrow("changed_run_id");
  });
});

describe("place-frontier HTTP adapter", () => {
  const prepared: PlaceFrontierPrepared = {
    runId: "frontier-run-1",
    profileId: PROFILE_ID,
    preferenceProfileId: PREFERENCE_PROFILE_ID,
    assessmentAt: NOW,
    rankingSnapshotId: "frontier-run-1:ranking",
    contextHash: "b".repeat(64),
  };

  async function loadPost(application: PlaceFrontierApplication) {
    vi.resetModules();
    vi.doMock("../../src/infrastructure/composition-root", () => ({
      getConfirmedLifeApplication: () => application,
    }));
    return (await import("../../src/app/api/place-frontier/route")).POST;
  }

  function validRequest(signal?: AbortSignal): Request {
    return new Request("http://localhost/api/place-frontier", {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({ profile: { confirmed: true }, preferences: { confirmed: true } }),
      ...(signal === undefined ? {} : { signal }),
    });
  }

  afterEach(() => {
    vi.doUnmock("../../src/infrastructure/composition-root");
    vi.restoreAllMocks();
  });

  test("rejects media, JSON and strict-union errors without preparing or running", async () => {
    const application = {
      preparePlaceFrontier: vi.fn(),
      runPlaceFrontier: vi.fn(),
      presentPlaceFrontier: vi.fn(),
    } as unknown as PlaceFrontierApplication;
    const POST = await loadPost(application);

    const media = await POST(new Request("http://localhost/api/place-frontier", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "profile=x",
    }));
    expect(media.status).toBe(415);
    expect(await media.json()).toEqual({
      code: "unsupported_media_type",
      status: 415,
      title: "Неподдерживаемый формат запроса",
    });

    const invalidJson = await POST(new Request("http://localhost/api/place-frontier", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    }));
    expect(invalidJson.status).toBe(400);
    expect((await invalidJson.json()).code).toBe("invalid_json");

    const invalidInput = await POST(new Request("http://localhost/api/place-frontier", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ profileId: "profile-1", preferenceProfileId: "pref-1", extra: true }),
    }));
    expect(invalidInput.status).toBe(400);
    expect((await invalidInput.json()).code).toBe("invalid_input");
    expect(application.preparePlaceFrontier).not.toHaveBeenCalled();
    expect(application.runPlaceFrontier).not.toHaveBeenCalled();
  });

  test.each([
    ["invalid_monthly_income", 400, "invalid_input"],
    ["profile_not_found", 400, "invalid_input"],
    ["private database detail", 500, "internal_error"],
  ] as const)("maps prepare failure %s before a stream exists", async (
    message,
    status,
    code,
  ) => {
    const application: PlaceFrontierApplication = {
      preparePlaceFrontier: vi.fn(async () => { throw new Error(message); }),
      runPlaceFrontier: vi.fn(),
      presentPlaceFrontier: vi.fn(),
    };
    const POST = await loadPost(application);
    const response = await POST(validRequest());

    expect(response.status).toBe(status);
    expect((await response.json()).code).toBe(code);
    expect(application.runPlaceFrontier).not.toHaveBeenCalled();
  });

  test("rejects empty prepared header identifiers before opening the stream", async () => {
    const application: PlaceFrontierApplication = {
      preparePlaceFrontier: vi.fn(async () => ({
        ...prepared,
        runId: "",
        profileId: "",
        preferenceProfileId: "",
      })),
      runPlaceFrontier: vi.fn(),
      presentPlaceFrontier: vi.fn(),
    };
    const POST = await loadPost(application);
    const response = await POST(validRequest());

    expect(response.status).toBe(500);
    expect((await response.json()).code).toBe("internal_error");
    expect(application.runPlaceFrontier).not.toHaveBeenCalled();
  });

  test.each([
    ["control character", "bad\nvalue"],
    ["whitespace only", "   "],
  ] as const)("rejects a prepared profile ID with %s before starting the stream", async (
    _name,
    invalidProfileId,
  ) => {
    const application: PlaceFrontierApplication = {
      preparePlaceFrontier: vi.fn(async () => ({
        ...prepared,
        profileId: invalidProfileId,
      })),
      runPlaceFrontier: vi.fn(),
      presentPlaceFrontier: vi.fn(),
    };
    const POST = await loadPost(application);
    const response = await POST(validRequest());
    const headers = JSON.stringify(Object.fromEntries(response.headers.entries()));
    const body = await response.text();

    expect(response.status).toBe(500);
    expect(JSON.parse(body)).toEqual({
      code: "internal_error",
      status: 500,
      title: "Не удалось запустить проверку",
    });
    expect(headers).not.toContain(invalidProfileId);
    expect(body).not.toContain(invalidProfileId);
    expect(application.runPlaceFrontier).not.toHaveBeenCalled();
  });

  test("prepares before opening a non-blocking stream with exact headers and framing", async () => {
    const fixture = validFixture();
    let releaseRun: (() => void) | undefined;
    const runGate = new Promise<void>((resolve) => { releaseRun = resolve; });
    let preparedBeforeRun = false;
    const application: PlaceFrontierApplication = {
      preparePlaceFrontier: vi.fn(async () => {
        preparedBeforeRun = true;
        return prepared;
      }),
      runPlaceFrontier: vi.fn(async (_prepared, emit) => {
        expect(preparedBeforeRun).toBe(true);
        await runGate;
        for (const event of fixture.events) await emit(event);
        return fixture.readModel;
      }),
      presentPlaceFrontier: vi.fn(),
    };
    const POST = await loadPost(application);

    const responseOrTimeout = await Promise.race([
      POST(validRequest()),
      new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 100)),
    ]);
    expect(responseOrTimeout).not.toBe("timeout");
    const response = responseOrTimeout as Response;
    expect(application.preparePlaceFrontier).toHaveBeenCalledWith({
      profile: { confirmed: true },
      preferences: { confirmed: true },
    });
    expect(application.runPlaceFrontier).toHaveBeenCalledOnce();
    expect(Object.fromEntries(response.headers.entries())).toEqual({
      "cache-control": "no-store, no-transform",
      "content-type": "application/x-ndjson; charset=utf-8",
      "x-content-type-options": "nosniff",
      "x-life-preference-profile-id": prepared.preferenceProfileId,
      "x-life-profile-id": prepared.profileId,
      "x-life-run-id": prepared.runId,
    });

    releaseRun?.();
    const body = await response.text();
    expect(body.endsWith("\n")).toBe(true);
    expect(body.trimEnd().split("\n").map((eventLine) => JSON.parse(eventLine)))
      .toEqual(fixture.events);
  });

  test.each([
    ["missing terminal", (fixture: ReturnType<typeof validFixture>) => ({
      events: fixture.events.slice(0, -1),
      returned: fixture.readModel,
    })],
    ["return mismatch", (fixture: ReturnType<typeof validFixture>) => ({
      events: fixture.events,
      returned: { ...fixture.readModel, assessmentAt: "2026-08-12T09:00:00.000Z" },
    })],
    ["late event", (fixture: ReturnType<typeof validFixture>) => ({
      events: [...fixture.events, { ...fixture.events[1]!, sequence: 5 }],
      returned: fixture.readModel,
    })],
  ] as const)("errors transport on %s", async (_name, scenario) => {
    const fixture = validFixture();
    const invalid = scenario(fixture);
    const application: PlaceFrontierApplication = {
      preparePlaceFrontier: async () => prepared,
      runPlaceFrontier: async (_prepared, emit) => {
        for (const event of invalid.events) await emit(event as PlaceFrontierEvent);
        return invalid.returned;
      },
      presentPlaceFrontier: vi.fn(),
    };
    const POST = await loadPost(application);
    const response = await POST(validRequest());

    await expect(response.text()).rejects.toThrow();
  });

  test("links request abort and body cancellation to one application signal", async () => {
    const observedSignals: AbortSignal[] = [];
    const application: PlaceFrontierApplication = {
      preparePlaceFrontier: async () => prepared,
      runPlaceFrontier: async (_prepared, _emit, signal) => {
        observedSignals.push(signal);
        return await new Promise<never>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        });
      },
      presentPlaceFrontier: vi.fn(),
    };
    const POST = await loadPost(application);

    const requestController = new AbortController();
    const requestResponse = await POST(validRequest(requestController.signal));
    const requestReason = new Error("request_disconnected");
    requestController.abort(requestReason);
    await vi.waitFor(() => expect(observedSignals[0]?.aborted).toBe(true));
    expect(observedSignals[0]?.reason).toBe(requestReason);
    await expect(requestResponse.text()).rejects.toBe(requestReason);

    const cancelResponse = await POST(validRequest());
    const cancelReason = new Error("reader_cancelled");
    await cancelResponse.body?.cancel(cancelReason);
    await vi.waitFor(() => expect(observedSignals[1]?.aborted).toBe(true));
    expect(observedSignals[1]?.reason).toBe(cancelReason);
  });
});
