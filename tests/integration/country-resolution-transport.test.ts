import { afterEach, describe, expect, test, vi } from "vitest";

import type {
  CountryResolutionApplication,
  CountryResolutionContinuationEvent,
  CountryResolutionContinuationPrepared,
  CountryResolutionReadModel,
} from "../../src/application/country-resolution";
import type { FrontierMarker } from "../../src/application/country-verifier";
import type { FormalResidenceVerdict } from
  "../../src/decision/formal-residence-verdict";
import {
  decodeCountryResolutionStream,
  initialCountryResolutionEventState,
  openCountryResolutionStreamResponse,
  reduceCountryResolutionEvent,
} from "../../src/experience/country-resolution-stream";
import {
  beginCountryResolutionContinuation,
  failCountryResolutionContinuation,
  presentCountryResolutionReadModel,
  projectCountryResolutionView,
  reduceCountryResolutionContinuationEvent,
} from "../../src/experience/country-resolution-view-model";

const NOW = "2026-08-12T08:00:00.000Z";
const DAY = "2026-08-12";
const PROFILE_ID = "c".repeat(64);
const PREFERENCE_ID = "d".repeat(64);

function uncertainty() {
  return {
    unknownRoutes: [],
    catalogCompletenessUnprovable: {
      code: "catalog_completeness_unprovable",
      claimIds: [],
      evidence: [],
      navigation: [],
    },
  } as const;
}

function formalVerdict(countryCode: string, status: "green" | "yellow"): FormalResidenceVerdict {
  if (status === "yellow") {
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
  const evidence = {
    evidenceSnapshotId: `evidence-${countryCode}`,
    artifactId: `artifact-${countryCode}`,
    sourceId: `source-${countryCode}`,
    navigationUrl: `https://official.test/${countryCode}`,
    resolvedEvidenceUrl: `https://official.test/${countryCode}.pdf`,
    sourcePeriod: "2026-08",
    locator: `section-${countryCode}`,
    excerptSha256: "a".repeat(64),
    validatorVersion: "fixture-validator@1",
  };
  const reason = {
    code: `${countryCode}_route_viable`,
    summary: `${countryCode} route viable`,
    claimIds: [`claim-${countryCode}`],
    evidence: [evidence],
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
      evidenceSnapshotIds: [evidence.evidenceSnapshotId],
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

function marker(code: string, rank: number, status: "green" | "yellow"): FrontierMarker {
  return {
    country: {
      countryCode: code,
      label: `Country ${code}`,
      flag: `flag-${code}`,
      coordinate: { lat: 40 + rank, lng: 10 + rank },
    },
    rank,
    countryCheckRunId: `frontier-country:${String(rank).repeat(64).slice(0, 64)}`,
    sourceAssessmentRulesVersion: "cold-start-assessment@1",
    lastCheckedAt: DAY,
    evidenceSnapshotId: `evidence-${code}`,
    formalVerdict: formalVerdict(code, status),
  };
}

function protocolFixture() {
  const codes = ["AA", "BB", "CC", "DD", "EE", "FF"];
  const sourceMarkers = codes.slice(0, 5).map((code, index) =>
    marker(code, index + 1, index === 0 ? "yellow" : "green"));
  const replacement = marker("FF", 6, "green");
  const automaticFrontier = {
    runId: "automatic-run-1",
    assessmentAt: NOW,
    rankingSnapshot: {
      schemaVersion: "place-ranking@1",
      id: "automatic-run-1:ranking",
      runId: "automatic-run-1",
      profileSnapshotId: PROFILE_ID,
      preferenceProfileSnapshotId: PREFERENCE_ID,
      assessmentAt: NOW,
      contextHash: "b".repeat(64),
      knowledgeRevisionIds: Object.fromEntries(codes.map((code) => [code, null])),
      ordered: codes.map((countryCode, index) => ({
        ...marker(countryCode, index + 1, index === 0 ? "yellow" : "green").country,
        factors: [],
        rank: index + 1,
        relevance: "1",
        coverage: "1",
        contributions: [],
      })),
      excludedPlaces: [],
      excluded: [],
      rulesVersion: "place-ranker@1",
      createdAt: NOW,
    },
    shortlistSnapshot: {
      schemaVersion: "place-shortlist@1",
      id: "automatic-run-1:shortlist",
      runId: "automatic-run-1",
      rankingSnapshotId: "automatic-run-1:ranking",
      markers: sourceMarkers,
      rulesVersion: "country-frontier@1",
      createdAt: NOW,
    },
  } as CountryResolutionReadModel["automaticFrontier"];
  const source = {
    automaticShortlistSnapshotId: automaticFrontier.shortlistSnapshot.id,
    rankingSnapshotId: automaticFrontier.rankingSnapshot.id,
    profileSnapshotId: PROFILE_ID,
    preferenceProfileSnapshotId: PREFERENCE_ID,
  };
  const decision = {
    countryCode: "AA",
    decision: "rejected" as const,
    formalMarkerDigest: "1".repeat(64),
    uncertaintyBasis: uncertainty(),
    warningCopyVersion: "yellow-risk@1" as const,
    decidedAt: NOW,
    commandId: "reject-AA",
  };
  const working = {
    schemaVersion: "country-resolution@1" as const,
    rulesVersion: "country-resolution@1" as const,
    id: "revision-1",
    resolutionRunId: "resolution-run-1",
    ...source,
    decisions: [decision],
    replacementMarkers: [],
    nextUncheckedRank: 6,
    unresolvedCountryCodes: [],
    slotCountryCodes: ["BB", "CC", "DD", "EE"],
    contextHash: "2".repeat(64),
    createdAt: NOW,
    kind: "working" as const,
    phase: "replacement_required" as const,
  };
  const { phase: _phase, ...workingBase } = working;
  const resolved = {
    ...workingBase,
    id: "revision-2",
    predecessorRevisionId: working.id,
    replacementMarkers: [replacement],
    nextUncheckedRank: 7,
    slotCountryCodes: ["BB", "CC", "DD", "EE", "FF"],
    contextHash: "3".repeat(64),
    kind: "resolved" as const,
    resolvedEntries: ["BB", "CC", "DD", "EE", "FF"].map((countryCode, index) => ({
      countryCode,
      rank: index + 2,
      formalMarkerDigest: String(index + 4).repeat(64).slice(0, 64),
    })),
    stopCondition: "five_effective_green" as const,
  };
  const initial: CountryResolutionReadModel = {
    resolutionRunId: working.resolutionRunId,
    assessmentAt: NOW,
    automaticFrontier,
    revision: working,
  };
  const terminal: CountryResolutionReadModel = {
    ...initial,
    revision: resolved,
  };
  const events: CountryResolutionContinuationEvent[] = [
    {
      resolutionRunId: working.resolutionRunId,
      sequence: 1,
      occurredAt: NOW,
      type: "replacement_country_activated",
      payload: { country: replacement.country, rank: replacement.rank },
    },
    {
      resolutionRunId: working.resolutionRunId,
      sequence: 2,
      occurredAt: NOW,
      type: "replacement_country_progress",
      payload: {
        countryCode: "FF",
        stage: "artifact_captured",
        label: "Captured FF",
        detail: "sha256:fixture",
        sourceUrl: "https://official.test/FF.pdf",
      },
    },
    {
      resolutionRunId: working.resolutionRunId,
      sequence: 3,
      occurredAt: NOW,
      type: "resolution_revision_committed",
      payload: { marker: replacement, revision: resolved },
    },
    {
      resolutionRunId: working.resolutionRunId,
      sequence: 4,
      occurredAt: NOW,
      type: "resolution_continuation_completed",
      payload: { readModel: terminal },
    },
  ];
  return { events, initial, replacement, terminal };
}

function eventStream(events: readonly unknown[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      events.forEach((event) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`)));
      controller.close();
    },
  });
}

async function collectResolutionEvents(
  stream: ReadableStream<Uint8Array>,
  initial: CountryResolutionReadModel,
  signal?: AbortSignal,
): Promise<CountryResolutionContinuationEvent[]> {
  const events: CountryResolutionContinuationEvent[] = [];
  for await (const event of decodeCountryResolutionStream(stream, initial, signal)) {
    events.push(event);
  }
  return events;
}

function readModel(revisionId = "revision-1"): CountryResolutionReadModel {
  return {
    resolutionRunId: "resolution-run-1",
    assessmentAt: NOW,
    automaticFrontier: { runId: "automatic-run-1" },
    revision: { id: revisionId },
  } as CountryResolutionReadModel;
}

function request(path: string, body: unknown, signal?: AbortSignal): Request {
  return new Request(`http://localhost/api/country-resolution/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: typeof body === "string" ? body : JSON.stringify(body),
    ...(signal === undefined ? {} : { signal }),
  });
}

async function loadRoute(
  route: "start" | "decision" | "continue",
  application: CountryResolutionApplication,
) {
  vi.resetModules();
  vi.doMock("../../src/infrastructure/composition-root", () => ({
    getConfirmedLifeApplication: () => application,
  }));
  if (route === "start") {
    return (await import("../../src/app/api/country-resolution/start/route")).POST;
  }
  if (route === "decision") {
    return (await import("../../src/app/api/country-resolution/decision/route")).POST;
  }
  return (await import("../../src/app/api/country-resolution/continue/route")).POST;
}

afterEach(() => {
  vi.doUnmock("../../src/infrastructure/composition-root");
  vi.restoreAllMocks();
});

describe("strict finite country-resolution protocol", () => {
  test("accepts one closed stream and holds its terminal until clean EOF", async () => {
    const fixture = protocolFixture();
    const received = await collectResolutionEvents(eventStream(fixture.events), fixture.initial);

    expect(received).toEqual(fixture.events);
    let state = initialCountryResolutionEventState(fixture.initial);
    fixture.events.forEach((event) => {
      state = reduceCountryResolutionEvent(state, event, {
        country: fixture.replacement.country,
        rank: fixture.replacement.rank,
      });
    });
    expect(state).toEqual({
      resolutionRunId: fixture.initial.resolutionRunId,
      expectedRevisionId: "revision-2",
      lastSequence: 4,
      committedRevisionIds: ["revision-2"],
      progress: [{
        stage: "artifact_captured",
        label: "Captured FF",
        detail: "sha256:fixture",
        sourceUrl: "https://official.test/FF.pdf",
      }],
      terminal: fixture.terminal,
    });
    expect(Object.isFrozen(state)).toBe(true);
  });

  test.each([
    ["unknown envelope key", (events: CountryResolutionContinuationEvent[]) => {
      (events[0] as CountryResolutionContinuationEvent & { extra?: true }).extra = true;
    }],
    ["unknown nested country key", (events: CountryResolutionContinuationEvent[]) => {
      const activated = events[0] as Extract<CountryResolutionContinuationEvent,
        { type: "replacement_country_activated" }>;
      (activated.payload.country as typeof activated.payload.country & { extra?: true }).extra = true;
    }],
    ["wrong first sequence", (events: CountryResolutionContinuationEvent[]) => {
      events[0] = { ...events[0]!, sequence: 2 } as CountryResolutionContinuationEvent;
    }],
    ["changed run", (events: CountryResolutionContinuationEvent[]) => {
      events[1] = { ...events[1]!, resolutionRunId: "other-run" } as
        CountryResolutionContinuationEvent;
    }],
    ["activation away from persisted cursor", (events: CountryResolutionContinuationEvent[]) => {
      const activated = events[0] as Extract<CountryResolutionContinuationEvent,
        { type: "replacement_country_activated" }>;
      events[0] = { ...activated, payload: { ...activated.payload, rank: 5 } };
    }],
    ["progress for another country", (events: CountryResolutionContinuationEvent[]) => {
      const progress = events[1] as Extract<CountryResolutionContinuationEvent,
        { type: "replacement_country_progress" }>;
      events[1] = { ...progress, payload: { ...progress.payload, countryCode: "EE" } };
    }],
    ["commit without matching active marker", (events: CountryResolutionContinuationEvent[]) => {
      const commit = events[2] as Extract<CountryResolutionContinuationEvent,
        { type: "resolution_revision_committed" }>;
      events[2] = { ...commit, payload: {
        ...commit.payload,
        marker: { ...commit.payload.marker, rank: 5 },
      } };
    }],
    ["commit from another predecessor", (events: CountryResolutionContinuationEvent[]) => {
      const commit = events[2] as Extract<CountryResolutionContinuationEvent,
        { type: "resolution_revision_committed" }>;
      events[2] = { ...commit, payload: {
        ...commit.payload,
        revision: { ...commit.payload.revision, predecessorRevisionId: "wrong" },
      } } as CountryResolutionContinuationEvent;
    }],
    ["nonmonotonic committed revision", (events: CountryResolutionContinuationEvent[]) => {
      const commit = events[2] as Extract<CountryResolutionContinuationEvent,
        { type: "resolution_revision_committed" }>;
      events.splice(3, 0, {
        ...commit,
        sequence: 4,
        payload: { ...commit.payload, revision: {
          ...commit.payload.revision,
          id: "revision-3",
          predecessorRevisionId: "revision-1",
        } },
      } as CountryResolutionContinuationEvent);
      events[4] = { ...events[4]!, sequence: 5 } as CountryResolutionContinuationEvent;
    }],
    ["optimistic terminal revision", (events: CountryResolutionContinuationEvent[]) => {
      const terminal = events[3] as Extract<CountryResolutionContinuationEvent,
        { type: "resolution_continuation_completed" }>;
      events[3] = { ...terminal, payload: { readModel: {
        ...terminal.payload.readModel,
        revision: { ...terminal.payload.readModel.revision, id: "uncommitted" },
      } as CountryResolutionReadModel } };
    }],
    ["event after terminal", (events: CountryResolutionContinuationEvent[]) => {
      events.push({ ...events[1]!, sequence: 5 } as CountryResolutionContinuationEvent);
    }],
  ] as const)("rejects %s", async (_case, mutate) => {
    const fixture = protocolFixture();
    const events = structuredClone(fixture.events) as CountryResolutionContinuationEvent[];
    mutate(events);
    await expect(collectResolutionEvents(eventStream(events), fixture.initial)).rejects.toThrow();
  });

  test("requires one terminal and suppresses a terminal followed by error, bytes or cancel", async () => {
    const fixture = protocolFixture();
    await expect(collectResolutionEvents(eventStream(fixture.events.slice(0, -1)), fixture.initial))
      .rejects.toThrow("missing_terminal_event");

    let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
    const errored = new ReadableStream<Uint8Array>({ start(value) { controller = value; } });
    const received: CountryResolutionContinuationEvent[] = [];
    const consuming = (async () => {
      for await (const event of decodeCountryResolutionStream(errored, fixture.initial)) {
        received.push(event);
      }
    })();
    const encoder = new TextEncoder();
    fixture.events.forEach((event) => controller?.enqueue(
      encoder.encode(`${JSON.stringify(event)}\n`),
    ));
    await Promise.resolve();
    const failure = new Error("failed_after_terminal_line");
    controller?.error(failure);
    await expect(consuming).rejects.toBe(failure);
    expect(received.map(({ type }) => type)).not.toContain("resolution_continuation_completed");

    await expect(collectResolutionEvents(new ReadableStream({
      start(streamController) {
        fixture.events.forEach((event) => streamController.enqueue(
          encoder.encode(`${JSON.stringify(event)}\n`),
        ));
        streamController.enqueue(encoder.encode("trailing"));
        streamController.close();
      },
    }), fixture.initial)).rejects.toThrow("trailing_partial_line");

    let abortController: ReadableStreamDefaultController<Uint8Array> | undefined;
    const abortStream = new ReadableStream<Uint8Array>({
      start(value) { abortController = value; },
    });
    const abort = new AbortController();
    const abortedEvents: CountryResolutionContinuationEvent[] = [];
    const aborted = (async () => {
      for await (const event of decodeCountryResolutionStream(
        abortStream,
        fixture.initial,
        abort.signal,
      )) abortedEvents.push(event);
    })();
    fixture.events.forEach((event) => abortController?.enqueue(
      encoder.encode(`${JSON.stringify(event)}\n`),
    ));
    await Promise.resolve();
    const abortReason = new Error("screen_replaced");
    abort.abort(abortReason);
    await expect(aborted).rejects.toBe(abortReason);
    expect(abortedEvents.map(({ type }) => type))
      .not.toContain("resolution_continuation_completed");
  });

  test("accepts an immediate clean completion without inventing a revision", async () => {
    const fixture = protocolFixture();
    const event: CountryResolutionContinuationEvent = {
      resolutionRunId: fixture.initial.resolutionRunId,
      sequence: 1,
      occurredAt: NOW,
      type: "resolution_continuation_completed",
      payload: { readModel: fixture.initial },
    };

    await expect(collectResolutionEvents(eventStream([event]), fixture.initial))
      .resolves.toEqual([event]);
  });

  test("rejects replacement activation when the persisted ranking cursor is exhausted", async () => {
    const fixture = protocolFixture();
    const ordered = fixture.initial.automaticFrontier.rankingSnapshot.ordered.slice(0, 5);
    const exhausted: CountryResolutionReadModel = {
      ...fixture.initial,
      automaticFrontier: {
        ...fixture.initial.automaticFrontier,
        rankingSnapshot: {
          ...fixture.initial.automaticFrontier.rankingSnapshot,
          ordered,
          knowledgeRevisionIds: Object.fromEntries(
            ordered.map(({ countryCode }) => [countryCode, null]),
          ),
        },
      },
    };
    const forgedActivation: CountryResolutionContinuationEvent = {
      resolutionRunId: exhausted.resolutionRunId,
      sequence: 1,
      occurredAt: NOW,
      type: "replacement_country_activated",
      payload: {
        country: exhausted.automaticFrontier.shortlistSnapshot.markers[4]!.country,
        rank: 5,
      },
    };
    const received: CountryResolutionContinuationEvent[] = [];
    const consume = async () => {
      for await (const event of decodeCountryResolutionStream(
        eventStream([forgedActivation]),
        exhausted,
      )) received.push(event);
    };

    await expect(consume()).rejects.toThrow("invalid_replacement_activation");
    expect(received).toEqual([]);
  });

  test("cancels every rejected response body without masking the primary error", () => {
    const fixture = protocolFixture();
    const cases = [
      new Response(eventStream([]), { status: 500 }),
      new Response(eventStream([]), { headers: {
        "content-type": "text/plain",
        "x-life-resolution-run-id": fixture.initial.resolutionRunId,
        "x-life-expected-revision-id": fixture.initial.revision.id,
      } }),
      new Response(eventStream([]), { headers: {
        "content-type": "application/x-ndjson; charset=utf-8",
        "x-life-resolution-run-id": "other-run",
        "x-life-expected-revision-id": fixture.initial.revision.id,
      } }),
    ];
    for (const response of cases) {
      const cancel = vi.spyOn(response.body!, "cancel").mockRejectedValue(new Error("cancel failed"));
      expect(() => openCountryResolutionStreamResponse(response, {
        resolutionRunId: fixture.initial.resolutionRunId,
        expectedRevisionId: fixture.initial.revision.id,
      })).toThrow();
      expect(cancel).toHaveBeenCalledOnce();
    }
  });
});

describe("pure country-resolution projection", () => {
  test("keeps frozen rank order and projects resolved effective green cards only", () => {
    const fixture = protocolFixture();
    const view = projectCountryResolutionView(
      presentCountryResolutionReadModel(fixture.terminal),
    );

    expect(view.candidates.map(({ country, rank, status }) =>
      [country.countryCode, rank, status])).toEqual([
      ["AA", 1, "red"],
      ["BB", 2, "green"],
      ["CC", 3, "green"],
      ["DD", 4, "green"],
      ["EE", 5, "green"],
      ["FF", 6, "green"],
    ]);
    expect(view.candidates[0]).toMatchObject({
      statusLabel: "Исключено",
      summary: "Пользователь отказался принимать неустранённый риск.",
      officialUrls: [],
      manualCheckLinks: [],
    });
    expect(view.cards.map(({ country }) => country.countryCode))
      .toEqual(["BB", "CC", "DD", "EE", "FF"]);
    expect(view.globeMode).toBe("collapsed");
    expect(view.canContinue).toBe(false);
  });

  test("makes accepted formal yellow an ordinary effective-green candidate and card", () => {
    const fixture = protocolFixture();
    const acceptedRevision = {
      ...fixture.terminal.revision,
      decisions: [{
        ...fixture.terminal.revision.decisions[0]!,
        decision: "accepted_at_own_risk" as const,
      }],
      replacementMarkers: [],
      nextUncheckedRank: 6,
      slotCountryCodes: ["AA", "BB", "CC", "DD", "EE"],
      resolvedEntries: ["AA", "BB", "CC", "DD", "EE"].map((countryCode, index) => ({
        countryCode,
        rank: index + 1,
        formalMarkerDigest: String(index + 1).repeat(64),
      })),
    };
    const accepted = projectCountryResolutionView(presentCountryResolutionReadModel({
      ...fixture.terminal,
      revision: acceptedRevision,
    }));
    const candidate = accepted.candidates[0]!;
    const ordinaryGreen = accepted.candidates[1]!;

    expect(candidate).toEqual({
      country: fixture.initial.automaticFrontier.shortlistSnapshot.markers[0]!.country,
      rank: 1,
      status: "green",
      statusLabel: "Доступно для выбора",
      officialUrls: [],
      manualCheckLinks: [],
    });
    expect(accepted.cards.map(({ country }) => country.countryCode))
      .toEqual(["AA", "BB", "CC", "DD", "EE"]);
    expect({
      status: candidate.status,
      statusLabel: candidate.statusLabel,
      summary: candidate.summary,
      officialUrls: candidate.officialUrls,
      manualCheckLinks: candidate.manualCheckLinks,
    }).toEqual({
      status: ordinaryGreen.status,
      statusLabel: ordinaryGreen.statusLabel,
      summary: ordinaryGreen.summary,
      officialUrls: ordinaryGreen.officialUrls,
      manualCheckLinks: ordinaryGreen.manualCheckLinks,
    });
    expect(JSON.stringify(candidate)).not.toMatch(/risk|yellow|warning|accepted/i);
  });

  test("projects an honest empty resolved result without cards or continuation", () => {
    const fixture = protocolFixture();
    const automaticFrontier = {
      ...fixture.initial.automaticFrontier,
      rankingSnapshot: {
        ...fixture.initial.automaticFrontier.rankingSnapshot,
        knowledgeRevisionIds: { AA: null },
        ordered: fixture.initial.automaticFrontier.rankingSnapshot.ordered.slice(0, 1),
      },
      shortlistSnapshot: {
        ...fixture.initial.automaticFrontier.shortlistSnapshot,
        markers: fixture.initial.automaticFrontier.shortlistSnapshot.markers.slice(0, 1),
      },
    };
    const source = {
      automaticShortlistSnapshotId: automaticFrontier.shortlistSnapshot.id,
      rankingSnapshotId: automaticFrontier.rankingSnapshot.id,
      profileSnapshotId: PROFILE_ID,
      preferenceProfileSnapshotId: PREFERENCE_ID,
    };
    const empty = {
      resolutionRunId: fixture.initial.resolutionRunId,
      assessmentAt: NOW,
      automaticFrontier,
      revision: {
        schemaVersion: "country-resolution@1" as const,
        rulesVersion: "country-resolution@1" as const,
        id: "revision-empty",
        resolutionRunId: fixture.initial.resolutionRunId,
        ...source,
        decisions: [fixture.initial.revision.decisions[0]!],
        replacementMarkers: [],
        nextUncheckedRank: 2,
        unresolvedCountryCodes: [],
        slotCountryCodes: [],
        contextHash: "9".repeat(64),
        createdAt: NOW,
        kind: "resolved" as const,
        resolvedEntries: [],
        stopCondition: "ranking_exhausted" as const,
      },
    };

    const view = projectCountryResolutionView(presentCountryResolutionReadModel(empty));
    expect(view.cards).toEqual([]);
    expect(view.canContinue).toBe(false);
    expect(view.globeMode).toBe("collapsed");
    expect("city" in view).toBe(false);
  });

  test("exposes uncertainty and links only for the current unresolved prompt", () => {
    const fixture = protocolFixture();
    const sourceMarker = fixture.initial.automaticFrontier.shortlistSnapshot.markers[0]!;
    const reason = {
      code: "unknown_route_requirements",
      summary: "Неизвестны требования маршрута",
      claimIds: ["claim-AA"],
      evidence: [{
        evidenceSnapshotId: "evidence-AA",
        artifactId: "artifact-AA",
        sourceId: "source-AA",
        navigationUrl: "https://official.test/AA",
        resolvedEvidenceUrl: "https://official.test/AA.pdf",
        sourcePeriod: "2026-08",
        locator: "section-AA",
        excerptSha256: "a".repeat(64),
        validatorVersion: "fixture-validator@1",
      }],
      navigation: [{
        sourceId: "source-AA",
        url: "https://manual.test/AA",
        label: "Проверить требования",
      }],
    };
    const frontier = structuredClone(fixture.initial.automaticFrontier);
    const unresolvedMarker: FrontierMarker = {
      ...sourceMarker,
      formalVerdict: {
        ...sourceMarker.formalVerdict,
        routeOutcomes: [{
          routeId: "route-AA",
          status: "unknown",
          ruleEffectiveFrom: "2026-01-01",
          reasons: [reason],
          evidenceSnapshotIds: ["evidence-AA"],
          proceduralActions: [],
          contingentActions: [],
        }],
        reasons: [reason, {
          code: "catalog_completeness_unprovable",
          summary: "Полнота каталога формальных маршрутов не подтверждена.",
          claimIds: [],
          evidence: [],
          navigation: [],
        }],
      },
    };
    const unresolvedFrontier = {
      ...frontier,
      shortlistSnapshot: {
      ...frontier.shortlistSnapshot,
      markers: [
        unresolvedMarker,
        ...frontier.shortlistSnapshot.markers.slice(1),
      ],
      },
    };
    const unresolved = {
      ...fixture.initial,
      automaticFrontier: unresolvedFrontier,
      revision: {
        ...fixture.initial.revision,
        decisions: [],
        phase: "awaiting_decision" as const,
        unresolvedCountryCodes: ["AA"],
        slotCountryCodes: ["AA", "BB", "CC", "DD", "EE"],
      },
    };
    const view = projectCountryResolutionView(presentCountryResolutionReadModel(unresolved));

    expect(view.currentPrompt).toEqual({
      countryCode: "AA",
      uncertainty: {
        unknownRoutes: [{ routeId: "route-AA", reasons: [{
          code: reason.code,
          claimIds: reason.claimIds,
          evidence: reason.evidence,
          navigation: reason.navigation,
        }] }],
        catalogCompletenessUnprovable: {
          code: "catalog_completeness_unprovable",
          claimIds: [],
          evidence: [],
          navigation: [],
        },
      },
      warningCopyVersion: "yellow-risk@1",
    });
    expect(view.candidates[0]).toMatchObject({
      status: "yellow",
      statusLabel: "Требует решения",
      officialUrls: ["https://official.test/AA"],
      manualCheckLinks: [{
        label: "Проверить требования",
        url: "https://manual.test/AA",
      }],
    });
    expect(view.candidates.slice(1).every((candidate) =>
      candidate.officialUrls.length === 0 && candidate.manualCheckLinks.length === 0)).toBe(true);
  });

  test("shows Continue for stored replacement_required with no synthetic progress or cards", () => {
    const fixture = protocolFixture();
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const view = projectCountryResolutionView(
      presentCountryResolutionReadModel(fixture.initial),
    );

    expect(view.canContinue).toBe(true);
    expect(view.cards).toEqual([]);
    expect(view.candidates.some(({ status }) => status === "pending")).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  test("uses only received continuation events and retains committed truth on transport error", () => {
    const fixture = protocolFixture();
    let state = beginCountryResolutionContinuation(fixture.initial);
    state = reduceCountryResolutionContinuationEvent(state, fixture.events[0]!);
    let view = projectCountryResolutionView(state);
    expect(view.candidates.at(-1)).toMatchObject({
      country: fixture.replacement.country,
      rank: 6,
      status: "pending",
    });
    expect(view.cards).toEqual([]);

    state = reduceCountryResolutionContinuationEvent(state, fixture.events[1]!);
    state = reduceCountryResolutionContinuationEvent(state, fixture.events[2]!);
    const failed = failCountryResolutionContinuation(state, "connection_lost");
    view = projectCountryResolutionView(failed);
    expect(view.candidates.at(-1)?.status).toBe("green");
    expect(view.transportError).toBe("connection_lost");
    expect(view.cards).toEqual([]);
  });
});

describe("country-resolution JSON commands", () => {
  test.each([
    ["start", { automaticShortlistSnapshotId: "shortlist-1" }, "startCountryResolution"],
    ["decision", {
      resolutionRunId: "resolution-run-1",
      expectedRevisionId: "revision-1",
      countryCode: "SI",
      decision: "accepted_at_own_risk",
      warningCopyVersion: "yellow-risk@1",
      commandId: "command-1",
    }, "decideYellow"],
  ] as const)("returns the exact read model for strict %s JSON", async (route, body, method) => {
    const expected = readModel("revision-2");
    const command = vi.fn(async () => expected);
    const officialCheck = vi.fn();
    const application = {
      [method]: command,
      verifier: { check: officialCheck },
    } as unknown as CountryResolutionApplication;
    const POST = await loadRoute(route, application);

    const response = await POST(request(route, body));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(await response.json()).toEqual(expected);
    expect(command).toHaveBeenCalledWith(body);
    expect(officialCheck).not.toHaveBeenCalled();
  });

  test.each([
    ["start", { automaticShortlistSnapshotId: "shortlist-1", extra: true },
      "startCountryResolution"],
    ["decision", {
      resolutionRunId: "resolution-run-1",
      expectedRevisionId: "revision-1",
      countryCode: "SI",
      decision: "accepted_at_own_risk",
      warningCopyVersion: "yellow-risk@1",
      commandId: "command-1",
      uncertaintyBasis: {},
    }, "decideYellow"],
  ] as const)("rejects unknown %s fields before calling Application", async (
    route,
    body,
    method,
  ) => {
    const command = vi.fn();
    const application = { [method]: command } as unknown as CountryResolutionApplication;
    const POST = await loadRoute(route, application);

    const response = await POST(request(route, body));

    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("invalid_input");
    expect(command).not.toHaveBeenCalled();
  });

  test("rejects media, malformed JSON and mixed decision values", async () => {
    const decideYellow = vi.fn();
    const POST = await loadRoute("decision", {
      decideYellow,
    } as unknown as CountryResolutionApplication);
    const unsupported = await POST(new Request(
      "http://localhost/api/country-resolution/decision",
      { method: "POST", headers: { "content-type": "text/plain" }, body: "x=1" },
    ));
    expect(unsupported.status).toBe(415);
    expect((await unsupported.json()).code).toBe("unsupported_media_type");

    const malformed = await POST(request("decision", "{"));
    expect(malformed.status).toBe(400);
    expect((await malformed.json()).code).toBe("invalid_json");

    const mixed = await POST(request("decision", {
      resolutionRunId: "resolution-run-1",
      expectedRevisionId: "revision-1",
      countryCode: "si",
      decision: "accept",
      warningCopyVersion: "yellow-risk@2",
      commandId: "",
    }));
    expect(mixed.status).toBe(400);
    expect((await mixed.json()).code).toBe("invalid_input");
    expect(decideYellow).not.toHaveBeenCalled();
  });

  test.each([
    ["resolution_not_found", 404, "resolution_not_found"],
    ["snapshot_not_found", 404, "resolution_not_found"],
    ["stale_resolution_head", 409, "stale_resolution_head"],
    ["invalid_resolution_target", 409, "invalid_resolution_target"],
    ["private sqlite path", 500, "internal_error"],
  ] as const)("maps %s without exposing internal messages", async (message, status, code) => {
    const application = {
      startCountryResolution: vi.fn(async () => { throw new Error(message); }),
    } as unknown as CountryResolutionApplication;
    const POST = await loadRoute("start", application);
    const response = await POST(request("start", {
      automaticShortlistSnapshotId: "shortlist-1",
    }));
    const text = await response.text();

    expect(response.status).toBe(status);
    expect(JSON.parse(text).code).toBe(code);
    if (status === 500) expect(text).not.toContain(message);
  });
});

describe("country-resolution continuation route", () => {
  const prepared: CountryResolutionContinuationPrepared = {
    resolutionRunId: "resolution-run-1",
    expectedRevisionId: "revision-1",
    automaticShortlistSnapshotId: "shortlist-1",
    profileId: "profile-1",
    contextHash: "a".repeat(64),
  };

  const completed = (terminal: CountryResolutionReadModel): CountryResolutionContinuationEvent => ({
    resolutionRunId: prepared.resolutionRunId,
    sequence: 1,
    occurredAt: NOW,
    type: "resolution_continuation_completed",
    payload: { readModel: terminal },
  });

  test("prepares before a nonblocking stream and emits exact headers and LF framing", async () => {
    const terminal = readModel();
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let preparedFirst = false;
    const application = {
      prepareCountryResolutionContinuation: vi.fn(async () => {
        preparedFirst = true;
        return prepared;
      }),
      continueCountryResolution: vi.fn(async (_prepared, emit) => {
        expect(preparedFirst).toBe(true);
        await gate;
        await emit(completed(terminal));
        return terminal;
      }),
    } as unknown as CountryResolutionApplication;
    const POST = await loadRoute("continue", application);

    const responseOrTimeout = await Promise.race([
      POST(request("continue", {
        resolutionRunId: prepared.resolutionRunId,
        expectedRevisionId: prepared.expectedRevisionId,
      })),
      new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 100)),
    ]);
    expect(responseOrTimeout).not.toBe("timeout");
    const response = responseOrTimeout as Response;
    expect(Object.fromEntries(response.headers.entries())).toEqual({
      "cache-control": "no-store, no-transform",
      "content-type": "application/x-ndjson; charset=utf-8",
      "x-content-type-options": "nosniff",
      "x-life-expected-revision-id": prepared.expectedRevisionId,
      "x-life-resolution-run-id": prepared.resolutionRunId,
    });
    release?.();
    const text = await response.text();
    expect(text.endsWith("\n")).toBe(true);
    expect(text.trimEnd().split("\n").map((eventLine) => JSON.parse(eventLine)))
      .toEqual([completed(terminal)]);
  });

  test.each([
    ["resolution run", "resolutionRunId", ""],
    ["resolution run control", "resolutionRunId", "bad\nheader"],
    ["expected revision whitespace", "expectedRevisionId", " surrounded "],
  ] as const)(
    "rejects unsafe prepared %s before starting the stream",
    async (_label, field, invalid) => {
      const continueCountryResolution = vi.fn();
      const application = {
        prepareCountryResolutionContinuation: async () => ({
          ...prepared,
          [field]: invalid,
        }),
        continueCountryResolution,
      } as unknown as CountryResolutionApplication;
      const POST = await loadRoute("continue", application);
      const response = await POST(request("continue", {
        resolutionRunId: prepared.resolutionRunId,
        expectedRevisionId: prepared.expectedRevisionId,
      }));

      expect(response.status).toBe(500);
      expect((await response.json()).code).toBe("internal_error");
      expect(continueCountryResolution).not.toHaveBeenCalled();
    },
  );

  test("rejects strict invalid input without preparing", async () => {
    const prepare = vi.fn();
    const POST = await loadRoute("continue", {
      prepareCountryResolutionContinuation: prepare,
    } as unknown as CountryResolutionApplication);
    const response = await POST(request("continue", {
      resolutionRunId: "resolution-run-1",
      expectedRevisionId: "revision-1",
      cursor: 1,
    }));

    expect(response.status).toBe(400);
    expect(prepare).not.toHaveBeenCalled();
  });

  test.each([
    ["resolution_not_found", 404, "resolution_not_found"],
    ["stale_resolution_head", 409, "stale_resolution_head"],
    ["invalid_resolution_target", 409, "invalid_resolution_target"],
    ["secret", 500, "internal_error"],
  ] as const)("maps prepare error %s before a body exists", async (message, status, code) => {
    const application = {
      prepareCountryResolutionContinuation: vi.fn(async () => { throw new Error(message); }),
      continueCountryResolution: vi.fn(),
    } as unknown as CountryResolutionApplication;
    const POST = await loadRoute("continue", application);
    const response = await POST(request("continue", {
      resolutionRunId: prepared.resolutionRunId,
      expectedRevisionId: prepared.expectedRevisionId,
    }));

    expect(response.status).toBe(status);
    expect((await response.json()).code).toBe(code);
    expect(application.continueCountryResolution).not.toHaveBeenCalled();
  });

  test.each([
    ["missing terminal", async (_emit: (event: CountryResolutionContinuationEvent) => unknown) =>
      readModel()],
    ["callback return mismatch", async (emit: (event: CountryResolutionContinuationEvent) => unknown) => {
      await emit(completed(readModel("revision-1")));
      return readModel("revision-2");
    }],
  ] as const)("errors the response on %s", async (_name, run) => {
    const POST = await loadRoute("continue", {
      prepareCountryResolutionContinuation: async () => prepared,
      continueCountryResolution: run,
    } as unknown as CountryResolutionApplication);
    const response = await POST(request("continue", {
      resolutionRunId: prepared.resolutionRunId,
      expectedRevisionId: prepared.expectedRevisionId,
    }));
    await expect(response.text()).rejects.toThrow();
  });

  test("links request abort and response cancellation to the same reason", async () => {
    const signals: AbortSignal[] = [];
    const application = {
      prepareCountryResolutionContinuation: async () => prepared,
      continueCountryResolution: async (_prepared: unknown, _emit: unknown, signal: AbortSignal) => {
        signals.push(signal);
        return await new Promise<never>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        });
      },
    } as unknown as CountryResolutionApplication;
    const POST = await loadRoute("continue", application);

    const requestAbort = new AbortController();
    const response = await POST(request("continue", {
      resolutionRunId: prepared.resolutionRunId,
      expectedRevisionId: prepared.expectedRevisionId,
    }, requestAbort.signal));
    const requestReason = new Error("request_disconnected");
    requestAbort.abort(requestReason);
    await vi.waitFor(() => expect(signals[0]?.reason).toBe(requestReason));
    await expect(response.text()).rejects.toBe(requestReason);

    const cancelResponse = await POST(request("continue", {
      resolutionRunId: prepared.resolutionRunId,
      expectedRevisionId: prepared.expectedRevisionId,
    }));
    const cancelReason = new Error("body_cancelled");
    await cancelResponse.body?.cancel(cancelReason);
    await vi.waitFor(() => expect(signals[1]?.reason).toBe(cancelReason));
  });
});
