// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import type { ColdStartEvent, ColdStartReadModel } from "../../src/application/cold-start";
import {
  COLD_START_MAX_LINE_BYTES,
  coldStartEventSchema,
  decodeColdStartStream,
  initialColdStartEventState,
  reduceColdStartEvent,
} from "../../src/experience/cold-start-stream";
import {
  createColdStartRunningState,
  failColdStartScreen,
  presentColdStartReadModel,
  projectColdStartView,
  reduceColdStartScreenEvent,
} from "../../src/experience/cold-start-view-model";
import { ColdStartComparator } from "../../src/experience/components/ColdStartComparator";
import { ColdStartJourney } from "../../src/experience/components/ColdStartJourney";
import { ColdStartStart } from "../../src/experience/components/ColdStartStart";

function formalEvidence(sourceId: string, artifactId: string) {
  return {
    evidenceSnapshotId: "cold-run-1:evidence",
    artifactId,
    sourceId,
    navigationUrl: `https://example.test/${sourceId}`,
    resolvedEvidenceUrl: `https://example.test/${sourceId}.pdf`,
    sourcePeriod: "2026-08",
    locator: `section-${sourceId}`,
    excerptSha256: "a".repeat(64),
    validatorVersion: "test-validator@1",
  };
}

const countryNotInstalledReason = {
  code: "country_not_installed",
  summary: "Страна пока не установлена для проверки официальных данных.",
  claimIds: [],
  evidence: [],
  navigation: [],
};

const terminalEvent = {
  runId: "cold-run-1",
  sequence: 1,
  occurredAt: "2026-08-11T10:30:00.000Z",
  country: {
    code: "SI",
    englishName: "Slovenia",
    displayName: "Словения",
    flag: "🇸🇮",
    coordinate: { lat: 46.1512, lng: 14.9955 },
  },
  type: "assessment_completed",
  payload: {
    readModel: {
      runId: "cold-run-1",
      country: {
        code: "SI",
        englishName: "Slovenia",
        displayName: "Словения",
        flag: "🇸🇮",
        coordinate: { lat: 46.1512, lng: 14.9955 },
      },
      checkedAt: "2026-08-11",
      evidenceSnapshotId: "cold-run-1:evidence",
      assessmentRulesVersion: "cold-start-assessment@1",
      knowledge: { lastCheckedAt: "2026-08-11" },
      coverage: { verified: 0, required: 9, claimKinds: [] },
      comparator: {
        marker: "yellow",
        personalFit: "research_incomplete",
        cityScope: "not_checked",
        formalVerdict: {
          rulesVersion: "formal-residence@1",
          marker: "yellow",
          verdictAsOf: "2026-08-11",
          routeOutcomes: [{
            routeId: "si-temporary-residence-digital-nomad",
            status: "unknown",
            reasons: [countryNotInstalledReason],
            evidenceSnapshotIds: [],
            proceduralActions: [],
            contingentActions: [],
          }],
          reasons: [countryNotInstalledReason],
          catalogCompleteness: {
            status: "unproven",
            reasonCode: "catalog_completeness_unprovable",
          },
        },
      },
      sourceNavigation: [],
    },
  },
} as const;

const redReadModel: ColdStartReadModel = {
  ...terminalEvent.payload.readModel,
  coverage: {
    verified: 9,
    required: 9,
    claimKinds: [
      "route_basis",
      "citizenship_applicability",
      "remote_work_relations",
      "income",
      "qualification",
      "companion_entry",
      "companion_local_work_access",
      "duration",
      "general_statutory_prerequisites",
    ],
  },
  dossier: {
    id: "si-dossier-v1",
    label: "Словения · досье v1",
    publishedAt: "2026-08-11T10:29:00.000Z",
  },
  comparator: {
    marker: "red",
    personalFit: "all_routes_impossible",
    cityScope: "not_checked",
    formalVerdict: {
      rulesVersion: "formal-residence@1",
      marker: "red",
      verdictAsOf: "2026-08-11",
      routeOutcomes: [{
        routeId: "si-temporary-residence-digital-nomad",
        status: "impossible",
        ruleEffectiveFrom: "2025-11-21",
        reasons: [{
          code: "income_below_verified_threshold",
          summary: "Подтверждённого чистого дохода недостаточно для порога маршрута.",
          claimIds: ["si-income-claim", "cbr-eur-claim"],
          evidence: [
            formalEvidence("si-income", "artifact-income"),
            formalEvidence("cbr-eur", "artifact-cbr"),
          ],
          navigation: [],
        }],
        evidenceSnapshotIds: ["cold-run-1:evidence"],
        proceduralActions: [],
        contingentActions: [],
      }],
      reasons: [{
        code: "income_below_verified_threshold",
        summary: "Подтверждённого чистого дохода недостаточно для порога маршрута.",
        claimIds: ["si-income-claim", "cbr-eur-claim"],
        evidence: [
          formalEvidence("si-income", "artifact-income"),
          formalEvidence("cbr-eur", "artifact-cbr"),
        ],
        navigation: [],
      }],
      catalogCompleteness: {
        status: "verified",
        attestation: {
          catalogRevisionId: "catalog-si-1",
          jurisdiction: "SI",
          authority: "Slovenian Ministry of the Interior",
          scopeKind: "all_long_term_residence_routes_for_profile",
          profileSnapshotId: "profile-1",
          catalogRoutes: [{
            routeId: "si-temporary-residence-digital-nomad",
            applicability: "applicable",
            evidence: [formalEvidence("catalog-route", "artifact-catalog-route")],
          }],
          validatorVersion: "catalog-validator@1",
          effectiveFrom: "2026-01-01",
          evidenceSnapshotId: "cold-run-1:evidence",
          catalogEvidence: [formalEvidence("catalog", "artifact-catalog")],
        },
      },
    },
    formula: {
      formulaId: "FORMULA-VS2-INCOME-01",
      formulaVersion: "1",
      expression: "monthlyIncomeRub / eurRub < thresholdEur",
      monthlyIncomeRub: "210000",
      eurRub: "90",
      incomeEur: "2333.33",
      thresholdEur: "3112.00",
      rounding: "UNROUNDED_THEN_HALF_UP_2DP",
      sourceClaimIds: ["si-income-claim", "cbr-eur-claim"],
    },
  },
  sourceNavigation: [
    { label: "SiStat · порог дохода", url: "https://pxweb.stat.si/SiStatData/pxweb/en/Data/" },
    { label: "Банк России · EUR/RUB", url: "https://www.cbr.ru/scripts/XML_daily.asp" },
  ],
};

const greenReadModel: ColdStartReadModel = {
  ...redReadModel,
  comparator: {
    marker: "green",
    personalFit: "verified_route_available",
    cityScope: "not_checked",
    formalVerdict: {
      rulesVersion: "formal-residence@1",
      marker: "green",
      verdictAsOf: "2026-08-11",
      routeOutcomes: [{
        routeId: "si-temporary-residence-digital-nomad",
        status: "viable",
        ruleEffectiveFrom: "2025-11-21",
        reasons: [{
          code: "route_requirements_verified",
          summary: "Формальные требования маршрута подтверждены.",
          claimIds: ["si-route-claim"],
          evidence: [formalEvidence("si-route", "artifact-route")],
          navigation: [],
        }],
        evidenceSnapshotIds: ["cold-run-1:evidence"],
        proceduralActions: [{ kind: "insurance", completed: false }],
        contingentActions: [],
      }],
      reasons: [{
        code: "route_requirements_verified",
        summary: "Формальные требования маршрута подтверждены.",
        claimIds: ["si-route-claim"],
        evidence: [formalEvidence("si-route", "artifact-route")],
        navigation: [],
      }],
      catalogCompleteness: {
        status: "unproven",
        reasonCode: "catalog_completeness_unprovable",
      },
    },
  },
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.doUnmock("../../src/infrastructure/composition-root");
  window.history.replaceState(null, "", "/");
});

async function collect(stream: ReadableStream<Uint8Array>): Promise<ColdStartEvent[]> {
  const events: ColdStartEvent[] = [];
  for await (const event of decodeColdStartStream(stream)) events.push(event);
  return events;
}

function eventLine(event: unknown): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(event)}\n`);
}

function streamOf(...chunks: readonly Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

function sourceEvent(
  sequence: number,
  runId = "cold-run-1",
): ColdStartEvent {
  return coldStartEventSchema.parse({
    ...terminalEvent,
    runId,
    sequence,
    type: "source_discovered",
    payload: {
      candidateId: "si-gov",
      url: "https://www.gov.si/teme/vstop-in-prebivanje/",
      claimKinds: ["route_basis"],
    },
  }) as ColdStartEvent;
}

function artifactEvent(sequence: number, sourceId = "si-digital-nomad-route"): ColdStartEvent {
  return coldStartEventSchema.parse({
    ...terminalEvent,
    sequence,
    type: "artifact_captured",
    payload: {
      sourceId,
      role: "official-document",
      resolvedUrl: "https://www.gov.si/teme/vstop-in-prebivanje/",
      sha256: "a".repeat(64),
    },
  }) as ColdStartEvent;
}

function claimEvent(sequence: number, claimId: string): ColdStartEvent {
  return coldStartEventSchema.parse({
    ...terminalEvent,
    sequence,
    type: "claim_verified",
    payload: {
      claimId,
      claimKind: "route_basis",
      sourceIds: ["si-digital-nomad-route"],
    },
  }) as ColdStartEvent;
}

function dossierEvent(sequence: number): ColdStartEvent {
  return coldStartEventSchema.parse({
    ...terminalEvent,
    sequence,
    type: "dossier_published",
    payload: {
      dossierVersionId: "si-dossier-v1",
      label: "Словения · досье v1",
      created: true,
    },
  }) as ColdStartEvent;
}

function completedEvent(sequence: number): ColdStartEvent {
  return coldStartEventSchema.parse({
    ...terminalEvent,
    sequence,
  }) as ColdStartEvent;
}

test("decodes a terminal NDJSON event split inside its UTF-8 country label", async () => {
  const bytes = new TextEncoder().encode(`${JSON.stringify(terminalEvent)}\n`);
  const splitAt = bytes.indexOf(new TextEncoder().encode("С")[0]!);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes.slice(0, splitAt + 1));
      controller.enqueue(bytes.slice(splitAt + 1));
      controller.close();
    },
  });

  await expect(collect(stream)).resolves.toEqual([terminalEvent]);
});

describe("finite cold-start decoder and reducer", () => {
  test("accepts the fixed formal verdict rules version and rejects a mutated version", () => {
    const greenEvent = {
      ...terminalEvent,
      payload: { readModel: greenReadModel },
    };
    expect(coldStartEventSchema.safeParse(greenEvent).success).toBe(true);

    const mutated = structuredClone(greenEvent) as Record<string, unknown>;
    const readModel = (mutated.payload as { readModel: Record<string, unknown> }).readModel;
    const comparator = readModel.comparator as Record<string, unknown>;
    (comparator.formalVerdict as Record<string, unknown>).rulesVersion = "formal-residence@2";

    expect(coldStartEventSchema.safeParse(mutated).success).toBe(false);
  });

  test("rejects a terminal payload whose outer marker contradicts the formal verdict", () => {
    const contradictory = structuredClone({
      ...terminalEvent,
      payload: { readModel: greenReadModel },
    }) as Record<string, unknown>;
    const readModel = (contradictory.payload as {
      readModel: Record<string, unknown>;
    }).readModel;
    (readModel.comparator as Record<string, unknown>).marker = "yellow";

    expect(coldStartEventSchema.safeParse(contradictory).success).toBe(false);
  });

  test("rejects normal EOF with a partial line or without one terminal event", async () => {
    const partial = new TextEncoder().encode(JSON.stringify(terminalEvent));
    await expect(collect(streamOf(partial))).rejects.toThrow("trailing_partial_line");

    await expect(collect(streamOf(eventLine(sourceEvent(1))))).rejects.toThrow(
      "missing_terminal_event",
    );
  });

  test("retains fatal UTF-8 and empty-line rejection after framing extraction", async () => {
    await expect(collect(streamOf(new Uint8Array([0xc3, 0x28, 0x0a])))).rejects.toThrow();
    await expect(collect(streamOf(new Uint8Array([0x0a])))).rejects.toThrow();
  });

  test("bounds both pending and complete lines to 256 KiB of UTF-8 bytes excluding LF", async () => {
    const oversizedPending = new Uint8Array(COLD_START_MAX_LINE_BYTES + 1).fill(0x20);
    await expect(collect(streamOf(oversizedPending))).rejects.toThrow("line_too_large");

    const oversizedComplete = new Uint8Array(COLD_START_MAX_LINE_BYTES + 2).fill(0x20);
    oversizedComplete[oversizedComplete.length - 1] = 0x0a;
    await expect(collect(streamOf(oversizedComplete))).rejects.toThrow("line_too_large");
  });

  test("rejects skipped, duplicate or changed-run events and anything after terminal", () => {
    const first = reduceColdStartEvent(initialColdStartEventState(), sourceEvent(1));
    expect(() => reduceColdStartEvent(first, sourceEvent(1))).toThrow("invalid_event_sequence");
    expect(() => reduceColdStartEvent(first, sourceEvent(3))).toThrow("invalid_event_sequence");
    expect(() => reduceColdStartEvent(first, sourceEvent(2, "cold-run-2"))).toThrow(
      "changed_run_id",
    );

    const terminal = reduceColdStartEvent(initialColdStartEventState(), completedEvent(1));
    expect(() => reduceColdStartEvent(terminal, sourceEvent(2))).toThrow("event_after_terminal");

    const mismatchedReadModel = {
      ...completedEvent(1),
      payload: {
        readModel: {
          ...terminalEvent.payload.readModel,
          runId: "cold-run-other",
          evidenceSnapshotId: "cold-run-other:evidence",
        },
      },
    } as ColdStartEvent;
    expect(coldStartEventSchema.safeParse(mismatchedReadModel).success).toBe(false);
    expect(() => reduceColdStartEvent(
      initialColdStartEventState(),
      mismatchedReadModel,
    )).toThrow("terminal_run_mismatch");

    const mismatchedEvidence = {
      ...completedEvent(1),
      payload: {
        readModel: {
          ...terminalEvent.payload.readModel,
          evidenceSnapshotId: "another-run:evidence",
        },
      },
    } as ColdStartEvent;
    expect(coldStartEventSchema.safeParse(mismatchedEvidence).success).toBe(false);
    expect(() => reduceColdStartEvent(
      initialColdStartEventState(),
      mismatchedEvidence,
    )).toThrow("terminal_evidence_mismatch");
  });

  test("rejects malformed nested payloads instead of stripping unknown wire fields", () => {
    const malformed = structuredClone(terminalEvent) as Record<string, unknown>;
    const payload = malformed.payload as Record<string, unknown>;
    payload.rawProfile = { name: "must not cross the wire" };

    expect(coldStartEventSchema.safeParse(malformed).success).toBe(false);
  });

  test("does not expose a terminal verdict until the transport reaches clean EOF", async () => {
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
    const stream = new ReadableStream<Uint8Array>({
      start(value) { controller = value; },
    });
    const received: ColdStartEvent[] = [];
    const consume = async () => {
      for await (const event of decodeColdStartStream(stream)) received.push(event);
    };
    const consuming = consume();
    controller?.enqueue(eventLine(completedEvent(1)));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const transportError = new Error("transport_failed_after_terminal_line");
    controller?.error(transportError);

    await expect(consuming).rejects.toBe(transportError);
    expect(received).toEqual([]);
  });

  test("cancels and releases an unfinished reader when the consumer returns early", async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      cancel,
      start(controller) { controller.enqueue(eventLine(sourceEvent(1))); },
    });
    const iterator = decodeColdStartStream(stream);

    await expect(iterator.next()).resolves.toMatchObject({ done: false, value: sourceEvent(1) });
    await iterator.return(undefined);

    expect(cancel).toHaveBeenCalledOnce();
  });

  test("an abort signal cancels a reader that is blocked waiting for the next chunk", async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ cancel });
    const controller = new AbortController();
    const reason = new Error("screen_replaced");
    const next = decodeColdStartStream(stream, controller.signal).next();

    controller.abort(reason);

    await expect(next).rejects.toBe(reason);
    expect(cancel).toHaveBeenCalledWith(reason);
  });
});

describe("honest cold-start view projection", () => {
  test("starts with a gray full globe and no fabricated timeline item", () => {
    const view = projectColdStartView(createColdStartRunningState("cold-run-1"));

    expect(view.marker).toBe("pending");
    expect(view.globeMode).toBe("full");
    expect(view.progress).toEqual([]);
    expect(view.announcement).toBeUndefined();
    expect(view.globe.routes[0]?.key).toBe("cold-run-1:SI");
    expect(view.globe.routes[0]?.label).toBe("Словения");
    expect(view.globe.routes[0]?.kind).toBe("country");
    expect(view.globe.origin).toMatchObject({ label: "Россия", kind: "country" });
  });

  test("aggregates only consecutive artifact and claim events without changing factual order", () => {
    let state = createColdStartRunningState("cold-run-1");
    for (const event of [
      sourceEvent(1),
      artifactEvent(2),
      artifactEvent(3),
      claimEvent(4, "claim-route"),
      claimEvent(5, "claim-duration"),
      artifactEvent(6),
      dossierEvent(7),
    ]) state = reduceColdStartScreenEvent(state, event);

    const view = projectColdStartView(state);
    expect(view.progress.map(({ label }) => label)).toEqual([
      "Найден официальный кандидат",
      "Получены официальные документы · 2",
      "Проверены утверждения · 2",
      "Получен официальный документ",
      "Опубликовано проверенное досье страны",
    ]);
    expect(view.progress.filter(({ current }) => current)).toHaveLength(1);
    expect(view.progress.at(-1)?.current).toBe(true);
    expect(view.announcement).toContain("Опубликовано проверенное досье страны");
    expect(view.marker).toBe("pending");
    expect(view.globeMode).toBe("full");
  });

  test("uses only the terminal read model for red/yellow and collapses the same route", () => {
    let state = createColdStartRunningState("cold-run-1");
    state = reduceColdStartScreenEvent(state, dossierEvent(1));
    const before = projectColdStartView(state);
    state = reduceColdStartScreenEvent(state, completedEvent(2));
    const after = projectColdStartView(state);

    expect(before.marker).toBe("pending");
    expect(after.marker).toBe("yellow");
    expect(after.globeMode).toBe("collapsed");
    expect(after.globe.routes[0]?.key).toBe(before.globe.routes[0]?.key);
    expect(after.readModel).toEqual(terminalEvent.payload.readModel);
  });

  test("projects a sealed reload as completed without fabricating a received event", () => {
    const state = presentColdStartReadModel(
      terminalEvent.payload.readModel as ColdStartReadModel,
    );
    const view = projectColdStartView(state);

    expect(state.stream.events).toEqual([]);
    expect(state.stream.lastSequence).toBe(0);
    expect(view.progress).toEqual([]);
    expect(view.announcement).toBeUndefined();
    expect(view.marker).toBe("yellow");
    expect(view.globeMode).toBe("collapsed");
    expect(view.candidate.reason).toEqual({
      summary: "Страна пока не установлена для проверки официальных данных.",
    });
    expect("officialUrl" in view.candidate.reason!).toBe(false);
  });

  test("does not replace a sealed reload verdict with a later transport error", () => {
    const completed = presentColdStartReadModel(
      terminalEvent.payload.readModel as ColdStartReadModel,
    );

    expect(failColdStartScreen(completed, "late_transport_error")).toBe(completed);
  });

  test("projects a verified viable route as green while the city stays unchecked", () => {
    const view = projectColdStartView(presentColdStartReadModel(greenReadModel));

    expect(view.marker).toBe("green");
    expect(view.candidate.status).toBe("green");
    expect(view.readModel?.comparator.cityScope).toBe("not_checked");
    expect(view.globe.activeFlight?.status).toBe("green");
    expect(view.globe.routes).toEqual([]);
  });
});

describe("cold-start comparator accessibility", () => {
  test("shows a green formal route with procedural actions and the city disclaimer", () => {
    const { container } = render(<ColdStartComparator readModel={greenReadModel} />);

    expect(screen.getByRole("heading", { name: "Формальный маршрут доступен" })).toBeTruthy();
    expect(container.querySelector('[data-icon="status-green"]')).toBeTruthy();
    expect(screen.getByText(/медицинская страховка/i)).toBeTruthy();
    expect(screen.getByText(/не гарантирует одобрение и не оценивает город/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /почему не подходит/i })).toBeNull();
  });

  test("shows a sourced red veto and returns focus on Escape or close", () => {
    const { container } = render(<ColdStartComparator readModel={redReadModel} />);

    expect(screen.getByText("Не подходит")).toBeTruthy();
    expect(container.querySelector('[data-icon="status-red"]')).toBeTruthy();
    expect(screen.getByText("Уровень проверки").parentElement?.textContent).toContain("Страна");
    expect(screen.getByText("Город не проверен")).toBeTruthy();
    expect(screen.getByText(/9 \/ 9/)).toBeTruthy();
    expect(screen.getByText("Словения · досье v1")).toBeTruthy();
    expect(screen.getByText("Все формальные маршруты исключены")).toBeTruthy();
    expect(container.textContent).not.toContain("all_routes_impossible");
    expect(screen.getByText("исследовано отдельно от top-5")).toBeTruthy();
    expect(screen.getByText("Проверенные официальные источники").closest("details")).toBeTruthy();
    expect(screen.getAllByRole("link", { name: /открыть официальный ресурс:/i }))
      .toHaveLength(2);

    const trigger = screen.getByRole("button", { name: /почему не подходит/i });
    const detailId = trigger.getAttribute("aria-controls");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(detailId).toBeTruthy();
    fireEvent.click(trigger);

    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    const heading = screen.getByRole("heading", { name: /проверенный запрет/i });
    expect(document.activeElement).toBe(heading);
    expect(screen.getByText(/210000/)).toBeTruthy();
    expect(screen.getByText(/90/)).toBeTruthy();
    expect(screen.getByText(/2333\.33/)).toBeTruthy();
    expect(screen.getByText(/3112\.00/)).toBeTruthy();
    expect(screen.getByText(/UNROUNDED_THEN_HALF_UP_2DP/)).toBeTruthy();
    expect(screen.getAllByText(/si-income-claim.*cbr-eur-claim/i)).toHaveLength(2);
    expect(screen.getAllByRole("link", { name: /официальный источник для причины/i }))
      .toHaveLength(2);

    fireEvent.keyDown(heading, { key: "Escape" });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(trigger);

    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("button", { name: /закрыть причины/i }));
    expect(document.activeElement).toBe(trigger);
  });

  test("shows a yellow blocker with an explicit retry control", () => {
    const retry = vi.fn();
    const { container } = render(
      <ColdStartComparator
        onRetry={retry}
        readModel={terminalEvent.payload.readModel as ColdStartReadModel}
      />,
    );

    expect(screen.getByText("Нужно уточнить")).toBeTruthy();
    expect(container.querySelector('[data-icon="status-yellow"]')).toBeTruthy();
    expect(screen.getByText(/страна пока не установлена/i)).toBeTruthy();
    expect(screen.queryByText("Проверенные официальные источники")).toBeNull();
    expect(screen.getByText("Официальные источники не проверены")).toBeTruthy();
    expect(screen.queryAllByRole("link")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: /проверить ещё раз/i }));
    expect(retry).toHaveBeenCalledOnce();
  });
});

describe("cold-start streamed screen", () => {
  test("unmount cancels a stream that is still waiting for research", async () => {
    const cancel = vi.fn();
    const journey = render(
      <ColdStartJourney
        profileId="relocation-profile-1"
        runId="cold-run-1"
        stream={new ReadableStream<Uint8Array>({ cancel })}
      />,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    journey.unmount();

    expect(cancel).toHaveBeenCalledOnce();
  });

  test("keeps one full gray globe through dossier publication, then collapses it on terminal", async () => {
    let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) { streamController = controller; },
    });
    const journey = render(
      <ColdStartJourney
        profileId="relocation-profile-1"
        runId="cold-run-1"
        stream={stream}
      />,
    );

    const globe = journey.container.querySelector(".workspace-globe");
    expect(globe?.getAttribute("data-mode")).toBe("full");
    const research = screen.getByRole("region", { name: /проверка маршрута/i });
    expect(research.getAttribute("data-tone")).toBe("gray");
    expect(within(research).queryAllByRole("listitem")).toHaveLength(1);
    expect(within(research).queryByText(/профиль подтверждён/i)).toBeNull();

    streamController?.enqueue(eventLine(sourceEvent(1)));
    streamController?.enqueue(eventLine(dossierEvent(2)));
    await screen.findByText("Опубликовано проверенное досье страны");
    expect(research.getAttribute("data-tone")).toBe("gray");
    expect(globe?.getAttribute("data-mode")).toBe("full");
    const announcement = journey.container.querySelector('[aria-live="polite"]');
    expect(announcement?.getAttribute("aria-atomic")).toBe("true");
    expect(announcement?.textContent).toContain("Опубликовано проверенное досье страны");

    streamController?.enqueue(eventLine(completedEvent(3)));
    streamController?.close();
    await screen.findByRole("heading", { name: "Нужно уточнить" });
    expect(journey.container.querySelector(".workspace-globe")).toBe(globe);
    expect(globe?.getAttribute("data-mode")).toBe("collapsed");
    expect(research.getAttribute("data-tone")).toBe("yellow");
  });

  test("keeps a transport failure gray, visible and retryable without a domain verdict", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        queueMicrotask(() => controller.error(new Error("connection_lost")));
      },
    });
    const journey = render(
      <ColdStartJourney
        profileId="relocation-profile-1"
        runId="cold-run-1"
        stream={stream}
      />,
    );

    expect((await screen.findByRole("alert")).textContent).toMatch(/поток проверки прерван/i);
    expect(screen.getByRole("region", { name: /проверка маршрута/i }).getAttribute("data-tone"))
      .toBe("gray");
    expect(journey.container.querySelector(".workspace-globe")?.getAttribute("data-mode"))
      .toBe("full");
    expect(screen.queryByText("Не подходит")).toBeNull();
    expect(screen.queryByText("Нужно уточнить")).toBeNull();
    expect(screen.getByRole("button", { name: /повторить проверку/i })).toBeTruthy();
  });

  test("renders a sealed reload without fetch and retries yellow with the existing profile", async () => {
    const oldReadModel = structuredClone(
      terminalEvent.payload.readModel,
    ) as ColdStartReadModel;
    const oldBytes = JSON.stringify(oldReadModel);
    let resolveFetch: ((response: Response) => void) | undefined;
    const fetchResponse = new Promise<Response>((resolve) => { resolveFetch = resolve; });
    const fetch = vi.fn(() => fetchResponse);
    vi.stubGlobal("fetch", fetch);
    const journey = render(
      <ColdStartJourney
        initialReadModel={oldReadModel}
        profileId="relocation-profile-1"
        runId="cold-run-1"
      />,
    );

    expect(screen.getByRole("heading", { name: "Нужно уточнить" })).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /проверить ещё раз/i }));
    expect(screen.queryByRole("heading", { name: "Нужно уточнить" })).toBeNull();
    expect(screen.getByRole("region", { name: /проверка маршрута/i }).getAttribute("data-tone"))
      .toBe("gray");

    const nextReadModel = { ...oldReadModel, runId: "cold-run-2", evidenceSnapshotId: "cold-run-2:evidence" };
    const nextTerminal = {
      ...terminalEvent,
      runId: "cold-run-2",
      payload: { readModel: nextReadModel },
    };
    resolveFetch?.(new Response(streamOf(eventLine(nextTerminal)), {
      headers: {
        "content-type": "application/x-ndjson; charset=utf-8",
        "x-life-profile-id": "relocation-profile-1",
        "x-life-run-id": "cold-run-2",
      },
    }));

    await screen.findByRole("heading", { name: "Нужно уточнить" });
    expect(fetch).toHaveBeenCalledWith("/api/cold-start", expect.objectContaining({
      body: JSON.stringify({ countryInput: "Словения", profileId: "relocation-profile-1" }),
      method: "POST",
    }));
    expect(window.location.search).toBe(
      "?flow=cold-start&run=cold-run-2&profile=relocation-profile-1",
    );
    expect(JSON.stringify(oldReadModel)).toBe(oldBytes);
    expect(journey.container.textContent).toContain("cold-run-2:evidence");
  });
});

describe("cold-start setup and reload", () => {
  test("uses the approved solo defaults, clears confirmation on edits and updates URL before reading", async () => {
    let searchWhenRead: string | undefined;
    const body = streamOf(eventLine(terminalEvent));
    const originalGetReader = body.getReader.bind(body);
    vi.spyOn(body, "getReader").mockImplementation(() => {
      searchWhenRead = window.location.search;
      return originalGetReader();
    });
    const fetch = vi.fn(async () => new Response(body, {
      headers: {
        "content-type": "application/x-ndjson; charset=utf-8",
        "x-life-profile-id": "relocation-profile-1",
        "x-life-run-id": "cold-run-1",
      },
    }));
    vi.stubGlobal("fetch", fetch);
    render(<ColdStartStart />);

    expect((screen.getByRole("textbox", { name: /страна/i }) as HTMLInputElement).value)
      .toBe("Словения");
    expect((screen.getByRole("textbox", { name: /месячный доход/i }) as HTMLInputElement).value)
      .toBe("210000");
    expect(screen.getByText(/без сопровождающих/i)).toBeTruthy();
    const confirmation = screen.getByRole("checkbox", { name: /подтверждаю профиль/i });
    fireEvent.click(confirmation);
    expect((confirmation as HTMLInputElement).checked).toBe(true);
    fireEvent.change(screen.getByRole("textbox", { name: /месячный доход/i }), {
      target: { value: "220000" },
    });
    expect((confirmation as HTMLInputElement).checked).toBe(false);
    fireEvent.click(confirmation);
    fireEvent.click(screen.getByRole("button", { name: /запустить проверку/i }));

    await screen.findByRole("heading", { name: "Нужно уточнить" });
    expect(searchWhenRead).toBe(
      "?flow=cold-start&run=cold-run-1&profile=relocation-profile-1",
    );
    expect(fetch).toHaveBeenCalledWith("/api/cold-start", expect.objectContaining({
      body: expect.stringContaining('"companions":[]'),
      method: "POST",
    }));
  });

  test("shows an unsupported-country problem inline without reading a stream", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({
      code: "invalid_input",
      status: 400,
      title: "Запрос не прошёл проверку",
    }), {
      status: 400,
      headers: { "content-type": "application/problem+json; charset=utf-8" },
    }));
    vi.stubGlobal("fetch", fetch);
    render(<ColdStartStart />);

    fireEvent.change(screen.getByRole("textbox", { name: /страна/i }), {
      target: { value: "Франция" },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: /подтверждаю профиль/i }));
    fireEvent.click(screen.getByRole("button", { name: /запустить проверку/i }));

    expect((await screen.findByRole("alert")).textContent)
      .toMatch(/пока доступна только Словения/i);
    expect(window.location.search).toBe("");
  });

  test("server reload calls only present and exact evidence_not_found stays gray", async () => {
    const present = vi.fn(async () => redReadModel);
    vi.resetModules();
    vi.doMock("../../src/infrastructure/composition-root", () => ({
      getConfirmedLifeApplication: () => ({ present }),
    }));
    const { default: Page } = await import("../../src/app/page");
    const page = await Page({
      searchParams: Promise.resolve({
        flow: "cold-start",
        run: "cold-run-1",
        profile: "relocation-profile-1",
      }),
    });
    render(page);

    expect(present).toHaveBeenCalledWith({
      runId: "cold-run-1",
      profileId: "relocation-profile-1",
    });
    expect(screen.getByRole("heading", { name: "Не подходит" })).toBeTruthy();

    cleanup();
    present.mockRejectedValueOnce(new Error("evidence_not_found"));
    const interrupted = await Page({
      searchParams: Promise.resolve({
        flow: "cold-start",
        run: "cold-run-interrupted",
        profile: "relocation-profile-1",
      }),
    });
    render(interrupted);
    expect(screen.getByRole("alert").textContent).toMatch(/запуск был прерван/i);
    expect(screen.getByRole("region", { name: /проверка маршрута/i }).getAttribute("data-tone"))
      .toBe("gray");
    expect(screen.queryByText("Не подходит")).toBeNull();
    expect(screen.queryByText("Нужно уточнить")).toBeNull();
  });
});
