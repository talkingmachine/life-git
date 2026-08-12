// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { openPlaceFrontierStreamResponse } from
  "../../src/experience/place-frontier-stream";
import { openCountryResolutionStreamResponse } from
  "../../src/experience/country-resolution-stream";
import { PlaceFrontierStart } from
  "../../src/experience/components/PlaceFrontierStart";
import { replacePlaceFrontierRunUrl } from "../../src/experience/run-url";
import { projectPlaceFrontierView, type PlaceFrontierScreenState } from
  "../../src/experience/place-frontier-view-model";
import { ResearchWorkspace } from "../../src/experience/components/ResearchWorkspace";
import { createProductGlobeRoute } from "../../src/experience/research-map/product-route";
import type {
  FrontierMarker,
  PlaceFrontierEvent,
  PlaceFrontierReadModel,
  RankingSnapshot,
} from "../../src/application/place-frontier";
import type { FormalResidenceVerdict } from
  "../../src/decision/formal-residence-verdict";
import { PlaceFrontierJourney } from
  "../../src/experience/components/PlaceFrontierJourney";

type OpenedStreamResponse = ReturnType<typeof openPlaceFrontierStreamResponse>;
const OPENER_RETURNS_SYNCHRONOUSLY:
  OpenedStreamResponse extends Promise<unknown> ? false : true = true;
void OPENER_RETURNS_SYNCHRONOUSLY;

function pendingStream(): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>();
}

const NOW = "2026-08-12T08:00:00.000Z";
const PROFILE_ID = "c".repeat(64);
const PREFERENCE_ID = "d".repeat(64);

function eventStream(
  events: readonly PlaceFrontierEvent[],
  cancel?: (reason?: unknown) => void,
): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    cancel,
    start(controller) {
      for (const event of events) {
        controller.enqueue(new TextEncoder().encode(`${JSON.stringify(event)}\n`));
      }
      controller.close();
    },
  });
}

function country(code: string, rank: number) {
  return {
    countryCode: code,
    label: `Country ${code}`,
    flag: `flag-${code}`,
    coordinate: { lat: 40 + rank, lng: 10 + rank },
  };
}

function greenVerdict(code: string, evidenceSnapshotId: string): FormalResidenceVerdict {
  const evidence = {
    evidenceSnapshotId,
    artifactId: `artifact-${code}`,
    sourceId: `source-${code}`,
    navigationUrl: `https://evidence.test/${code}`,
    resolvedEvidenceUrl: `https://evidence.test/${code}.pdf`,
    sourcePeriod: "2026-08",
    locator: `section-${code}`,
    excerptSha256: "a".repeat(64),
    validatorVersion: "fixture-validator@1",
  };
  const reason = {
    code: `${code}_viable`,
    summary: `${code} route is viable`,
    claimIds: [`claim-${code}`],
    evidence: [evidence],
    navigation: [{
      sourceId: `source-${code}`,
      url: `https://manual.test/${code}`,
      label: `Проверить ${code}`,
    }],
  };
  return {
    rulesVersion: "formal-residence@1",
    marker: "green",
    verdictAsOf: "2026-08-12",
    routeOutcomes: [{
      routeId: `route-${code}`,
      status: "viable",
      ruleEffectiveFrom: "2026-01-01",
      reasons: [reason],
      evidenceSnapshotIds: [evidenceSnapshotId],
      proceduralActions: [{ kind: "insurance", completed: false }],
      contingentActions: [{ kind: "job_offer", eligibility: "verified", acquired: false }],
    }],
    reasons: [reason],
    catalogCompleteness: {
      status: "unproven",
      reasonCode: "catalog_completeness_unprovable",
    },
  };
}

function terminalFixture(runId = "frontier-run-1") {
  const rankedCountry = country("SI", 1);
  const rankingSnapshot: RankingSnapshot = {
    schemaVersion: "place-ranking@1",
    id: `${runId}:ranking`,
    runId,
    profileSnapshotId: PROFILE_ID,
    preferenceProfileSnapshotId: PREFERENCE_ID,
    assessmentAt: NOW,
    contextHash: "b".repeat(64),
    knowledgeRevisionIds: { SI: "knowledge-ranking-SI" },
    ordered: [{
      ...rankedCountry,
      factors: [{
        criterionId: "personal_safety",
        state: "known",
        match: "1",
        observationId: "observation-SI",
        evaluatorVersion: "fixture-factor@1",
      }],
      rank: 1,
      relevance: "0.9",
      coverage: "0.8",
      contributions: [{
        criterionId: "personal_safety",
        state: "known",
        effectiveMatch: "1",
        weightedContribution: "5",
        observationId: "observation-SI",
      }],
    }],
    excludedPlaces: [],
    excluded: [],
    rulesVersion: "place-ranker@1",
    createdAt: NOW,
  };
  const evidenceSnapshotId = "evidence-SI";
  const marker: FrontierMarker = {
    country: rankedCountry,
    rank: 1,
    countryCheckRunId: `frontier-country:${"1".repeat(64)}`,
    sourceAssessmentRulesVersion: "cold-start-assessment@1",
    lastCheckedAt: "2026-08-12",
    evidenceSnapshotId,
    currentKnowledgeRevisionId: "knowledge-current-SI",
    updatedKnowledgeRevisionId: "knowledge-current-SI",
    knowledgeUpdatedAt: NOW,
    formalVerdict: greenVerdict("SI", evidenceSnapshotId),
  };
  const readModel: PlaceFrontierReadModel = {
    runId,
    assessmentAt: NOW,
    rankingSnapshot,
    shortlistSnapshot: {
      schemaVersion: "place-shortlist@1",
      id: `${runId}:shortlist`,
      runId,
      rankingSnapshotId: rankingSnapshot.id,
      markers: [marker],
      rulesVersion: "country-frontier@1",
      createdAt: NOW,
    },
  };
  const envelope = (sequence: number) => ({ runId, sequence, occurredAt: NOW });
  const events: PlaceFrontierEvent[] = [
    { ...envelope(1), type: "ranking_sealed", payload: {
      rankingSnapshotId: rankingSnapshot.id,
      orderedCountryCodes: ["SI"],
      excludedCountryCodes: [],
    } },
    { ...envelope(2), type: "country_activated", payload: { country: rankedCountry, rank: 1 } },
    { ...envelope(3), type: "country_completed", payload: { marker } },
    { ...envelope(4), type: "frontier_completed", payload: { readModel } },
  ];
  return { events, readModel };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.doUnmock("../../src/infrastructure/composition-root");
  window.history.replaceState(null, "", "/");
});

describe("place-frontier response boundary", () => {
  test("opens only an exact successful finite-stream response synchronously without reading it", () => {
    const body = pendingStream();
    const getReader = vi.spyOn(body, "getReader");
    const response = new Response(body, {
      headers: {
        "content-type": "application/x-ndjson; charset=utf-8",
        "x-life-run-id": "frontier-run-1",
        "x-life-profile-id": "profile-1",
        "x-life-preference-profile-id": "preference-1",
      },
    });

    expect(openPlaceFrontierStreamResponse(response)).toEqual({
      runId: "frontier-run-1",
      profileId: "profile-1",
      preferenceProfileId: "preference-1",
      stream: body,
    });
    expect(getReader).not.toHaveBeenCalled();
  });

  test.each([
    ["failed response", new Response(null, { status: 400 })],
    ["missing body", new Response(null, {
      headers: {
        "content-type": "application/x-ndjson; charset=utf-8",
        "x-life-run-id": "run-1",
        "x-life-profile-id": "profile-1",
        "x-life-preference-profile-id": "preference-1",
      },
    })],
  ])("rejects %s synchronously", (_label, response) => {
    expect(() => openPlaceFrontierStreamResponse(response)).toThrow();
  });

  test("throws its primary validation error before a never-settling cancellation", () => {
    const body = pendingStream();
    const cancel = vi.spyOn(body, "cancel").mockReturnValue(new Promise(() => undefined));
    const response = new Response(body, {
      headers: {
        "content-type": "application/json",
        "x-life-run-id": "run-1",
        "x-life-profile-id": "profile-1",
        "x-life-preference-profile-id": "preference-1",
      },
    });

    expect(() => openPlaceFrontierStreamResponse(response))
      .toThrow("invalid_place_frontier_content_type");
    expect(cancel).toHaveBeenCalledOnce();
  });

  test("keeps cancellation failures secondary to the synchronous validation error", async () => {
    const failures = [
      () => { throw new Error("cancel_failed_sync"); },
      () => Promise.reject(new Error("cancel_failed_async")),
    ];
    for (const failCancellation of failures) {
      const body = pendingStream();
      const cancel = vi.spyOn(body, "cancel").mockImplementation(failCancellation);
      const response = new Response(body, { headers: { "content-type": "application/json" } });

      expect(() => openPlaceFrontierStreamResponse(response))
        .toThrow("invalid_place_frontier_content_type");
      expect(cancel).toHaveBeenCalledOnce();
      await Promise.resolve();
    }
  });

  test("rejects an identity that is not exact-trimmed", () => {
    const body = pendingStream();
    const values = new Map([
      ["content-type", "application/x-ndjson; charset=utf-8"],
      ["x-life-run-id", " run-1"],
      ["x-life-profile-id", "profile-1"],
      ["x-life-preference-profile-id", "preference-1"],
    ]);
    const response = {
      body,
      headers: { get: (name: string) => values.get(name) ?? null },
      ok: true,
    } as unknown as Response;
    expect(() => openPlaceFrontierStreamResponse(response)).toThrow();
  });

  test("requires exact retry identities", () => {
    const body = pendingStream();
    const cancel = vi.spyOn(body, "cancel");
    const response = new Response(body, {
      headers: {
        "content-type": "application/x-ndjson; charset=utf-8",
        "x-life-run-id": "run-2",
        "x-life-profile-id": "profile-2",
        "x-life-preference-profile-id": "preference-1",
      },
    });

    expect(() => openPlaceFrontierStreamResponse(response, {
      profileId: "profile-1",
      preferenceProfileId: "preference-1",
    })).toThrow("changed_place_frontier_identity");
    expect(cancel).toHaveBeenCalledOnce();
  });

  test("replaces the URL with only encoded flow and run", () => {
    replacePlaceFrontierRunUrl("run / one");
    expect(window.location.search).toBe("?flow=place-frontier&run=run%20%2F%20one");
  });
});

describe("shared finite response cancellation", () => {
  test("keeps country-resolution validation primary for hanging, sync and rejected cancellation", async () => {
    const cancellations = [
      () => new Promise<never>(() => undefined),
      () => { throw new Error("cancel_failed_sync"); },
      () => Promise.reject(new Error("cancel_failed_async")),
    ];
    for (const cancelResponse of cancellations) {
      const body = pendingStream();
      const cancel = vi.spyOn(body, "cancel").mockImplementation(cancelResponse);
      const response = new Response(body, { headers: { "content-type": "application/json" } });

      expect(() => openCountryResolutionStreamResponse(response))
        .toThrow("invalid_country_resolution_content_type");
      expect(cancel).toHaveBeenCalledOnce();
      await Promise.resolve();
    }
  });
});

describe("place-frontier setup", () => {
  test("updates the confirmation summary when a companion is added and removed", () => {
    render(<PlaceFrontierStart />);
    const review = screen.getByRole("region", { name: "Проверка перед запуском" });
    const confirmation = within(review).getByRole("checkbox", { name: /подтверждаю/i });
    expect(within(review).getByText(/Один человек, Россия/)).toBeTruthy();

    fireEvent.click(confirmation);
    fireEvent.click(screen.getByRole("button", { name: "Добавить сопровождающего" }));
    expect((confirmation as HTMLInputElement).checked).toBe(false);
    expect(within(review).getByText(
      /Людей в профиле: 2; сопровождающие: Супруг или супруга, Россия/,
    )).toBeTruthy();

    fireEvent.click(confirmation);
    fireEvent.click(screen.getByRole("button", { name: "Удалить" }));
    expect((confirmation as HTMLInputElement).checked).toBe(false);
    expect(within(review).getByText(/Один человек, Россия/)).toBeTruthy();
  });

  test("uses five valid defaults, no country input, and invalidates confirmation on every edit", async () => {
    const sourceCancel = vi.fn();
    const responseBody = new ReadableStream<Uint8Array>({ cancel: sourceCancel });
    const originalGetReader = responseBody.getReader.bind(responseBody);
    let searchWhenRead: string | undefined;
    vi.spyOn(responseBody, "getReader").mockImplementation(() => {
      searchWhenRead = window.location.search;
      return originalGetReader();
    });
    const fetch = vi.fn(async () => new Response(responseBody, {
      headers: {
        "content-type": "application/x-ndjson; charset=utf-8",
        "x-life-run-id": "frontier-run-1",
        "x-life-profile-id": "profile-1",
        "x-life-preference-profile-id": "preference-1",
      },
    }));
    vi.stubGlobal("fetch", fetch);
    const start = render(<PlaceFrontierStart />);

    expect(screen.queryByRole("textbox", { name: /страна/i })).toBeNull();
    expect(screen.getByText(/установленн/i)).toBeTruthy();
    expect(screen.getByText(/меньше пяти/i)).toBeTruthy();
    const criteria = screen.getByRole("group", { name: /предпочтения/i });
    expect(within(criteria).getAllByRole("combobox", { name: /режим/i })).toHaveLength(5);
    expect(within(criteria).getAllByRole("spinbutton", { name: /важность/i }))
      .toHaveLength(5);

    const confirmation = screen.getByRole("checkbox", { name: /подтверждаю/i });
    fireEvent.click(confirmation);
    fireEvent.change(screen.getByRole("textbox", { name: /месячный доход/i }), {
      target: { value: "220000" },
    });
    expect((confirmation as HTMLInputElement).checked).toBe(false);
    fireEvent.click(confirmation);
    fireEvent.change(within(criteria).getAllByRole("combobox", { name: /режим/i })[1]!, {
      target: { value: "required" },
    });
    expect((confirmation as HTMLInputElement).checked).toBe(false);

    fireEvent.click(confirmation);
    fireEvent.click(screen.getByRole("button", { name: /запустить/i }));
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(searchWhenRead)
      .toBe("?flow=place-frontier&run=frontier-run-1"));
    expect(fetch).toHaveBeenCalledWith("/api/place-frontier", expect.objectContaining({
      body: JSON.stringify({
        profile: {
          currentCountryCode: "RU",
          citizenships: ["RU"],
          monthlyIncome: { amount: "220000", currency: "RUB", basis: "net" },
          remoteWork: { relation: "foreign_employment", legallyAllowed: true },
          education: "none",
          relevantExperienceYears: "unknown",
          passportValidUntil: "unknown",
          healthInsurance: "unknown",
          companions: [],
        },
        preferences: { criteria: [
          { id: "outside_cis", mode: "required", importance: 5, target: "required_true" },
          { id: "europe", mode: "required", importance: 4, target: "required_true" },
          { id: "personal_safety", mode: "weighted", importance: 5, target: "maximize" },
          { id: "infrastructure", mode: "weighted", importance: 5, target: "maximize" },
          { id: "peace_and_stability", mode: "weighted", importance: 5, target: "maximize" },
        ] },
      }),
      method: "POST",
    }));
    start.unmount();
    await vi.waitFor(() => expect(sourceCancel).toHaveBeenCalledOnce());
  });

  test("shows a specific invalid-profile error and a generic launch error", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: "invalid_input" }), {
        status: 400,
        headers: { "content-type": "application/problem+json; charset=utf-8" },
      }))
      .mockRejectedValueOnce(new Error("offline"));
    vi.stubGlobal("fetch", fetch);
    render(<PlaceFrontierStart />);
    const submit = screen.getByRole("button", { name: /запустить/i });
    const confirmation = screen.getByRole("checkbox", { name: /подтверждаю/i });

    fireEvent.click(confirmation);
    fireEvent.click(submit);
    expect((await screen.findByRole("alert")).textContent).toMatch(/профиль.*предпочтени/i);
    fireEvent.click(submit);
    expect((await screen.findByRole("alert")).textContent).toMatch(/не запущен/i);
  });

  test("cancels a launch body rejected by the strict response boundary", async () => {
    const body = pendingStream();
    const cancel = vi.spyOn(body, "cancel");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body, {
      headers: {
        "content-type": "application/json",
        "x-life-run-id": "frontier-run-1",
        "x-life-profile-id": PROFILE_ID,
        "x-life-preference-profile-id": PREFERENCE_ID,
      },
    })));
    render(<PlaceFrontierStart />);

    fireEvent.click(screen.getByRole("checkbox", { name: /подтверждаю/i }));
    fireEvent.click(screen.getByRole("button", { name: /запустить/i }));

    expect((await screen.findByRole("alert")).textContent).toMatch(/не запущен/i);
    expect(cancel).toHaveBeenCalledOnce();
  });

  test("cancels an accepted launch body when unmounted after URL installation before adoption", async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ cancel });
    const getReader = vi.spyOn(body, "getReader");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body, {
      headers: {
        "content-type": "application/x-ndjson; charset=utf-8",
        "x-life-run-id": "frontier-run-owned-launch",
        "x-life-profile-id": PROFILE_ID,
        "x-life-preference-profile-id": PREFERENCE_ID,
      },
    })));
    const nativeReplaceState = window.history.replaceState.bind(window.history);
    vi.spyOn(window.history, "replaceState").mockImplementation((data, unused, url) => {
      nativeReplaceState(data, unused, url);
      if (String(url).includes("frontier-run-owned-launch")) start.unmount();
    });
    const start = render(<PlaceFrontierStart />);

    fireEvent.click(screen.getByRole("checkbox", { name: /подтверждаю/i }));
    fireEvent.click(screen.getByRole("button", { name: /запустить/i }));

    await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce());
    expect(getReader).not.toHaveBeenCalled();
  });

  test("cancels a launch response accepted after the Start component already unmounted", async () => {
    let resolveFetch: ((response: Response) => void) | undefined;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    })));
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ cancel });
    const getReader = vi.spyOn(body, "getReader");
    const start = render(<PlaceFrontierStart />);

    fireEvent.click(screen.getByRole("checkbox", { name: /подтверждаю/i }));
    fireEvent.click(screen.getByRole("button", { name: /запустить/i }));
    start.unmount();
    resolveFetch?.(new Response(body, { headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "x-life-run-id": "frontier-run-late-launch",
      "x-life-profile-id": PROFILE_ID,
      "x-life-preference-profile-id": PREFERENCE_ID,
    } }));

    await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce());
    expect(getReader).not.toHaveBeenCalled();
  });

  test("cancels an accepted launch body when URL installation fails", async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ cancel });
    const getReader = vi.spyOn(body, "getReader");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body, {
      headers: {
        "content-type": "application/x-ndjson; charset=utf-8",
        "x-life-run-id": "frontier-run-url-failure",
        "x-life-profile-id": PROFILE_ID,
        "x-life-preference-profile-id": PREFERENCE_ID,
      },
    })));
    vi.spyOn(window.history, "replaceState").mockImplementation(() => {
      throw new Error("history_unavailable");
    });
    render(<PlaceFrontierStart />);

    fireEvent.click(screen.getByRole("checkbox", { name: /подтверждаю/i }));
    fireEvent.click(screen.getByRole("button", { name: /запустить/i }));

    expect((await screen.findByRole("alert")).textContent).toMatch(/не запущен/i);
    expect(cancel).toHaveBeenCalledOnce();
    expect(getReader).not.toHaveBeenCalled();
  });
});

describe("place-frontier journey lifecycle", () => {
  test("reaches a terminal result through a one-shot stream under StrictMode replay", async () => {
    const fixture = terminalFixture();

    render(
      <StrictMode>
        <PlaceFrontierJourney mode="live" preferenceProfileId={PREFERENCE_ID}
          profileId={PROFILE_ID} runId={fixture.readModel.runId}
          stream={eventStream(fixture.events)} />
      </StrictMode>,
    );

    expect(await screen.findByText(`${fixture.readModel.runId}:shortlist`)).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  test("reports a one-shot transport failure with retained history under StrictMode replay", async () => {
    const fixture = terminalFixture();

    render(
      <StrictMode>
        <PlaceFrontierJourney mode="live" preferenceProfileId={PREFERENCE_ID}
          profileId={PROFILE_ID} runId={fixture.readModel.runId}
          stream={eventStream(fixture.events.slice(0, 2))} />
      </StrictMode>,
    );

    expect((await screen.findByRole("alert")).textContent).toMatch(/поток проверки прерван/i);
    expect(screen.getByText(/Country SI/)).toBeTruthy();
  });

  test("does not cancel for StrictMode replay but cancels the live stream once on true unmount", async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ cancel });
    const journey = render(
      <StrictMode>
        <PlaceFrontierJourney mode="live" preferenceProfileId={PREFERENCE_ID}
          profileId={PROFILE_ID} runId="frontier-run-strict" stream={stream} />
      </StrictMode>,
    );

    await Promise.resolve();
    expect(cancel).not.toHaveBeenCalled();

    journey.unmount();
    await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce());
  });

  test("renders a stored terminal projection without timeline or flight and shows full projected card truth", async () => {
    const fixture = terminalFixture();
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const journey = render(
      <PlaceFrontierJourney initialReadModel={fixture.readModel} mode="stored"
        runId={fixture.readModel.runId} />,
    );

    expect(fetch).not.toHaveBeenCalled();
    expect(screen.getByText("Предварительный результат")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "1 формально доступны / 0 требуют проверки" }))
      .toBeTruthy();
    expect(screen.getByText(/установленное покрытие исчерпано/i)).toBeTruthy();
    const cards = screen.getByRole("region", { name: "Карточки стран" });
    expect(within(cards).getByRole("heading", { name: "Country SI" })).toBeTruthy();
    expect(within(cards).getByText(/personal_safety.*effective 1.*contribution 5/)).toBeTruthy();
    expect(within(cards).getByText("route-SI")).toBeTruthy();
    expect(within(cards).getByText(/медицинскую страховку.*не выполнено/i)).toBeTruthy();
    expect(within(cards).getByText(/предложение о работе.*ещё не получено/i)).toBeTruthy();
    expect(within(cards).getByText("Вердикт на дату").nextElementSibling?.textContent)
      .toBe("2026-08-12");
    expect(within(cards).getByText("evidence-SI")).toBeTruthy();
    expect(within(cards).getByText("knowledge-ranking-SI")).toBeTruthy();
    expect(within(cards).getAllByText("knowledge-current-SI")).toHaveLength(2);
    expect(journey.container.querySelector(".workspace-globe")?.getAttribute("data-mode"))
      .toBe("collapsed");
    expect(journey.container.querySelector('[aria-label="Ход проверки"]')).toBeNull();
  });

  test("retains received partial history on decoder failure and shows no terminal cards", async () => {
    const fixture = terminalFixture();
    render(
      <PlaceFrontierJourney mode="live" preferenceProfileId={PREFERENCE_ID}
        profileId={PROFILE_ID} runId={fixture.readModel.runId}
        stream={eventStream(fixture.events.slice(0, 2))} />,
    );

    expect((await screen.findByRole("alert")).textContent).toMatch(/поток проверки прерван/i);
    expect(screen.getByText(/Country SI/)).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Карточки стран" })).toBeNull();
    expect(screen.queryByText("Предварительный результат")).toBeNull();
  });

  test("preserves the stored result until strict retry open, then changes URL before reading", async () => {
    const previous = terminalFixture("frontier-run-old");
    const next = terminalFixture("frontier-run-new");
    let resolveFetch: ((response: Response) => void) | undefined;
    const responsePromise = new Promise<Response>((resolve) => { resolveFetch = resolve; });
    const fetch = vi.fn(() => responsePromise);
    vi.stubGlobal("fetch", fetch);
    render(<PlaceFrontierJourney initialReadModel={previous.readModel} mode="stored"
      runId={previous.readModel.runId} />);

    fireEvent.click(screen.getByRole("button", { name: "Повторить проверку" }));
    expect(screen.getByRole("heading", { name: "1 формально доступны / 0 требуют проверки" }))
      .toBeTruthy();
    expect(fetch).toHaveBeenCalledWith("/api/place-frontier", expect.objectContaining({
      body: JSON.stringify({ profileId: PROFILE_ID, preferenceProfileId: PREFERENCE_ID }),
      method: "POST",
    }));

    const body = eventStream(next.events);
    const originalGetReader = body.getReader.bind(body);
    let searchWhenRead: string | undefined;
    vi.spyOn(body, "getReader").mockImplementation(() => {
      searchWhenRead = window.location.search;
      return originalGetReader();
    });
    resolveFetch?.(new Response(body, { headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "x-life-run-id": next.readModel.runId,
      "x-life-profile-id": PROFILE_ID,
      "x-life-preference-profile-id": PREFERENCE_ID,
    } }));

    await vi.waitFor(() => expect(window.location.search)
      .toBe("?flow=place-frontier&run=frontier-run-new"));
    await screen.findByText("frontier-run-new:shortlist");
    expect(searchWhenRead).toBe("?flow=place-frontier&run=frontier-run-new");
  });

  test("cancels an accepted retry body when unmounted after URL installation before adoption", async () => {
    const previous = terminalFixture("frontier-run-old");
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ cancel });
    const getReader = vi.spyOn(body, "getReader");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body, {
      headers: {
        "content-type": "application/x-ndjson; charset=utf-8",
        "x-life-run-id": "frontier-run-owned-retry",
        "x-life-profile-id": PROFILE_ID,
        "x-life-preference-profile-id": PREFERENCE_ID,
      },
    })));
    const nativeReplaceState = window.history.replaceState.bind(window.history);
    vi.spyOn(window.history, "replaceState").mockImplementation((data, unused, url) => {
      nativeReplaceState(data, unused, url);
      if (String(url).includes("frontier-run-owned-retry")) journey.unmount();
    });
    const journey = render(<PlaceFrontierJourney initialReadModel={previous.readModel} mode="stored"
      runId={previous.readModel.runId} />);

    fireEvent.click(screen.getByRole("button", { name: "Повторить проверку" }));

    await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce());
    expect(getReader).not.toHaveBeenCalled();
  });

  test("rejects a reused retry run while preserving terminal UI", async () => {
    const fixture = terminalFixture();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(eventStream(fixture.events), {
      headers: {
        "content-type": "application/x-ndjson; charset=utf-8",
        "x-life-run-id": fixture.readModel.runId,
        "x-life-profile-id": PROFILE_ID,
        "x-life-preference-profile-id": PREFERENCE_ID,
      },
    })));
    render(<PlaceFrontierJourney initialReadModel={fixture.readModel} mode="stored"
      runId={fixture.readModel.runId} />);

    fireEvent.click(screen.getByRole("button", { name: "Повторить проверку" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/предыдущая история сохранена/i);
    expect(screen.getByRole("heading", { name: "1 формально доступны / 0 требуют проверки" }))
      .toBeTruthy();
  });

  test.each([
    ["missing identity", {
      "content-type": "application/x-ndjson; charset=utf-8",
      "x-life-profile-id": PROFILE_ID,
      "x-life-preference-profile-id": PREFERENCE_ID,
    }],
    ["changed identity", {
      "content-type": "application/x-ndjson; charset=utf-8",
      "x-life-run-id": "frontier-run-new",
      "x-life-profile-id": "changed-profile",
      "x-life-preference-profile-id": PREFERENCE_ID,
    }],
  ])("cancels a retry body rejected for %s", async (_case, headers) => {
    const fixture = terminalFixture();
    const body = pendingStream();
    const cancel = vi.spyOn(body, "cancel");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { headers })));
    render(<PlaceFrontierJourney initialReadModel={fixture.readModel} mode="stored"
      runId={fixture.readModel.runId} />);

    fireEvent.click(screen.getByRole("button", { name: "Повторить проверку" }));

    expect((await screen.findByRole("alert")).textContent).toMatch(/предыдущая история сохранена/i);
    expect(cancel).toHaveBeenCalledOnce();
  });

  test("cancels the current live stream when another retry supersedes it", async () => {
    const fixture = terminalFixture("frontier-run-old");
    const firstCancel = vi.fn();
    const firstBody = new ReadableStream<Uint8Array>({ cancel: firstCancel });
    const secondBody = pendingStream();
    const response = (runId: string, body: ReadableStream<Uint8Array>) => new Response(body, {
      headers: {
        "content-type": "application/x-ndjson; charset=utf-8",
        "x-life-run-id": runId,
        "x-life-profile-id": PROFILE_ID,
        "x-life-preference-profile-id": PREFERENCE_ID,
      },
    });
    const fetch = vi.fn()
      .mockResolvedValueOnce(response("frontier-run-first", firstBody))
      .mockResolvedValueOnce(response("frontier-run-second", secondBody));
    vi.stubGlobal("fetch", fetch);
    render(<PlaceFrontierJourney initialReadModel={fixture.readModel} mode="stored"
      runId={fixture.readModel.runId} />);

    fireEvent.click(screen.getByRole("button", { name: "Повторить проверку" }));
    await vi.waitFor(() => expect(window.location.search)
      .toBe("?flow=place-frontier&run=frontier-run-first"));
    fireEvent.click(screen.getByRole("button", { name: "Повторить проверку" }));

    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(firstCancel).toHaveBeenCalledOnce());
    expect(window.location.search).toBe("?flow=place-frontier&run=frontier-run-second");
  });

  test("offers interrupted reload only and aborts an in-flight semantic retry on unmount", async () => {
    const interrupted = render(<PlaceFrontierJourney mode="interrupted" runId="missing-run" />);
    expect(screen.getByRole("button", { name: /перезагрузить страницу/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /повторить проверку/i })).toBeNull();
    interrupted.unmount();

    const fixture = terminalFixture();
    let retrySignal: AbortSignal | undefined;
    vi.stubGlobal("fetch", vi.fn((_url: string, init: RequestInit) => {
      retrySignal = init.signal as AbortSignal;
      return new Promise<Response>(() => undefined);
    }));
    const journey = render(<PlaceFrontierJourney initialReadModel={fixture.readModel}
      mode="stored" runId={fixture.readModel.runId} />);
    fireEvent.click(screen.getByRole("button", { name: "Повторить проверку" }));
    journey.unmount();
    await vi.waitFor(() => expect(retrySignal?.aborted).toBe(true));
  });
});

describe("place-frontier reload boundary", () => {
  test("uses only presentPlaceFrontier and distinguishes missing from unavailable", async () => {
    const presentPlaceFrontier = vi.fn(async () => ({ runId: "frontier-run-1" }));
    vi.resetModules();
    vi.doMock("../../src/infrastructure/composition-root", () => ({
      getConfirmedLifeApplication: () => ({ presentPlaceFrontier }),
    }));
    vi.doMock("../../src/experience/components/PlaceFrontierJourney", () => ({
      PlaceFrontierJourney: (props: { mode: string; runId: string }) => (
        <p>{props.mode}:{props.runId}</p>
      ),
    }));
    const { default: Page } = await import("../../src/app/page");

    render(await Page({ searchParams: Promise.resolve({
      flow: "place-frontier",
      profile: "stray-profile",
      run: "frontier-run-1",
    }) }));
    expect(presentPlaceFrontier).toHaveBeenCalledWith("frontier-run-1");
    expect(screen.getByText("stored:frontier-run-1")).toBeTruthy();

    cleanup();
    presentPlaceFrontier.mockRejectedValueOnce(new Error("snapshot_not_found"));
    render(await Page({ searchParams: Promise.resolve({
      flow: "place-frontier",
      run: "missing-run",
    }) }));
    expect(screen.getByText("interrupted:missing-run")).toBeTruthy();

    cleanup();
    presentPlaceFrontier.mockRejectedValueOnce(new Error("snapshot_integrity_failed"));
    render(await Page({ searchParams: Promise.resolve({
      flow: "place-frontier",
      run: "broken-run",
    }) }));
    expect(screen.getByRole("heading", { name: /снимок не удалось открыть/i })).toBeTruthy();
    expect(screen.queryByText(/snapshot_integrity_failed/i)).toBeNull();
  });
});

describe("frontier projection and workspace", () => {
  const candidates = [
    {
      id: "pending",
      label: "Ожидание",
      kind: "country" as const,
      country: "Ожидание",
      flag: "◻️",
      coordinate: { lat: 1, lng: 1 },
      description: "Проверяем",
      status: "pending" as const,
      reason: { summary: "Не раскрывать" },
    },
    {
      id: "green",
      label: "Доступно",
      kind: "country" as const,
      country: "Доступно",
      flag: "🟢",
      coordinate: { lat: 2, lng: 2 },
      description: "Доступно",
      status: "green" as const,
      reason: { summary: "Не раскрывать" },
    },
    {
      id: "yellow",
      label: "Уточнить",
      kind: "country" as const,
      country: "Уточнить",
      flag: "🟡",
      coordinate: { lat: 3, lng: 3 },
      description: "Уточнить",
      status: "yellow" as const,
      reason: {
        summary: "Нужна ручная проверка",
        officialUrl: "https://evidence.test/one",
        officialUrls: ["https://evidence.test/one", "https://evidence.test/two"],
        manualCheckLinks: [{ label: "Навигация", url: "https://manual.test/one" }],
      },
    },
    {
      id: "red",
      label: "Недоступно",
      kind: "country" as const,
      country: "Недоступно",
      flag: "🔴",
      coordinate: { lat: 4, lng: 4 },
      description: "Недоступно",
      status: "red" as const,
      reason: { summary: "Все маршруты исключены" },
    },
  ] as const;

  test("keeps first-seen mixed markers and makes only red/yellow disclosures interactive", () => {
    render(
      <ResearchWorkspace
        candidates={candidates}
        mode="yellow"
        progress={[{ key: "step", label: "Проверяем источник", current: true }]}
        scope="country-frontier"
      />,
    );

    const list = screen.getByRole("list", { name: /кандидаты/i });
    expect(within(list).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      expect.stringContaining("Ожидание"),
      expect.stringContaining("Доступно"),
      expect.stringContaining("Уточнить"),
      expect.stringContaining("Недоступно"),
    ]);
    expect(within(list).getAllByRole("button")).toHaveLength(2);
    expect(screen.getByText("Проверяем источник")).toBeTruthy();
    expect(screen.getByText(/формально доступно/i)).toBeTruthy();
    expect(screen.getByText(/формально недоступно/i)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Уточнить/i }));
    expect(screen.getByText("Evidence")).toBeTruthy();
    expect(screen.getAllByRole("link", { name: /официальный источник/i })).toHaveLength(2);
    expect(screen.getByText("Проверьте вручную")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Навигация" })).toBeTruthy();
  });

  test("forwards plural link lineage through product routes", () => {
    const route = createProductGlobeRoute({
      label: "Россия",
      kind: "country",
      country: "Россия",
      flag: "🇷🇺",
      coordinate: { lat: 55, lng: 37 },
    }, candidates[2], "run-1");
    expect(route.officialUrl).toBe("https://evidence.test/one");
    expect(route.officialUrls).toEqual([
      "https://evidence.test/one",
      "https://evidence.test/two",
    ]);
    expect(route.manualCheckLinks).toEqual([
      { label: "Навигация", url: "https://manual.test/one" },
    ]);
  });

  test("aggregates every formal Evidence URL separately from manual navigation", () => {
    const reason = (summary: string, evidenceUrl: string, manualUrl: string) => ({
      code: "test_reason",
      summary,
      claimIds: [],
      evidence: [{ navigationUrl: evidenceUrl }],
      navigation: [{ label: `Проверить ${summary}`, url: manualUrl }],
    });
    const marker = {
      country: {
        countryCode: "SI",
        label: "Словения",
        flag: "🇸🇮",
        coordinate: { lat: 46, lng: 15 },
      },
      rank: 1,
      formalVerdict: {
        marker: "yellow",
        reasons: [
          reason("первое", "https://evidence.test/one", "https://manual.test/one"),
          reason("второе", "https://evidence.test/two", "https://manual.test/two"),
          reason("дубль", "https://evidence.test/one", "https://manual.test/one"),
        ],
      },
    };
    const state = {
      kind: "transportError",
      runId: "run-1",
      message: "stopped",
      stream: {
        events: [],
        lastSequence: 1,
        runId: "run-1",
        countries: [{ country: marker.country, rank: 1, completed: marker }],
      },
    } as unknown as PlaceFrontierScreenState;

    const projected = projectPlaceFrontierView(state).markers[0]?.reason;
    expect(projected?.officialUrl).toBe("https://evidence.test/one");
    expect(projected?.officialUrls).toEqual([
      "https://evidence.test/one",
      "https://evidence.test/two",
    ]);
    expect(projected?.manualCheckLinks).toEqual([
      { label: "Проверить первое", url: "https://manual.test/one" },
      { label: "Проверить второе", url: "https://manual.test/two" },
      { label: "Проверить дубль", url: "https://manual.test/one" },
    ]);
  });
});
