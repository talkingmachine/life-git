// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";

import type { CountryResolutionReadModel } from
  "../../src/application/country-resolution";
import type { FrontierMarker, PlaceFrontierReadModel } from
  "../../src/application/place-frontier";
import type { FormalResidenceVerdict } from
  "../../src/decision/formal-residence-verdict";
import { PlaceFrontierJourney } from
  "../../src/experience/components/PlaceFrontierJourney";

const NOW = "2026-08-12T08:00:00.000Z";
const PROFILE_ID = "c".repeat(64);
const PREFERENCE_ID = "d".repeat(64);

function greenVerdict(countryCode: string): FormalResidenceVerdict {
  const evidenceSnapshotId = `evidence-${countryCode}`;
  const evidence = {
    evidenceSnapshotId,
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
    verdictAsOf: "2026-08-12",
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

function yellowVerdict(countryCode: string, catalogOnly = false): FormalResidenceVerdict {
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
    code: "route_requirements_unknown",
    summary: "Требования маршрута не подтверждены.",
    claimIds: [`claim-${countryCode}`],
    evidence: [evidence],
    navigation: [{
      sourceId: `source-${countryCode}`,
      url: `https://manual.test/${countryCode}`,
      label: `Проверить ${countryCode}`,
    }],
  };
  return {
    rulesVersion: "formal-residence@1",
    marker: "yellow",
    verdictAsOf: "2026-08-12",
    routeOutcomes: catalogOnly ? [] : [{
      routeId: `route-${countryCode}`,
      status: "unknown",
      ruleEffectiveFrom: "2026-01-01",
      reasons: [reason],
      evidenceSnapshotIds: [evidence.evidenceSnapshotId],
      proceduralActions: [],
      contingentActions: [],
    }],
    reasons: catalogOnly ? [] : [
      reason,
      {
        code: "catalog_completeness_unprovable",
        summary: "Полнота каталога формальных маршрутов не подтверждена.",
        claimIds: [],
        evidence: [],
        navigation: [],
      },
    ],
    catalogCompleteness: {
      status: "unproven",
      reasonCode: "catalog_completeness_unprovable",
    },
  };
}

function marker(countryCode: string, rank: number): FrontierMarker {
  return {
    country: {
      countryCode,
      label: `Country ${countryCode}`,
      flag: `flag-${countryCode}`,
      coordinate: { lat: 40 + rank, lng: 10 + rank },
    },
    rank,
    countryCheckRunId: `frontier-country:${String(rank).repeat(64).slice(0, 64)}`,
    sourceAssessmentRulesVersion: "cold-start-assessment@1",
    lastCheckedAt: "2026-08-12",
    evidenceSnapshotId: `evidence-${countryCode}`,
    formalVerdict: greenVerdict(countryCode),
  };
}

function yellowMarker(countryCode: string, rank: number, catalogOnly = false): FrontierMarker {
  return {
    ...marker(countryCode, rank),
    formalVerdict: yellowVerdict(countryCode, catalogOnly),
  };
}

function automaticFixture(): PlaceFrontierReadModel {
  const markers = [marker("AA", 1), marker("BB", 2)];
  const runId = "automatic-run-all-green";
  return {
    runId,
    assessmentAt: NOW,
    rankingSnapshot: {
      schemaVersion: "place-ranking@1",
      id: `${runId}:ranking`,
      runId,
      profileSnapshotId: PROFILE_ID,
      preferenceProfileSnapshotId: PREFERENCE_ID,
      assessmentAt: NOW,
      contextHash: "b".repeat(64),
      knowledgeRevisionIds: { AA: null, BB: null },
      ordered: markers.map(({ country, rank }) => ({
        ...country,
        factors: [],
        rank,
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
      id: `${runId}:shortlist`,
      runId,
      rankingSnapshotId: `${runId}:ranking`,
      markers,
      rulesVersion: "country-frontier@1",
      createdAt: NOW,
    },
  };
}

function allGreenResolution(automaticFrontier: PlaceFrontierReadModel): CountryResolutionReadModel {
  const entries = automaticFrontier.shortlistSnapshot.markers.map((candidate) => ({
    countryCode: candidate.country.countryCode,
    rank: candidate.rank,
    formalMarkerDigest: String(candidate.rank).repeat(64),
  }));
  return {
    resolutionRunId: "resolution-run-all-green",
    assessmentAt: NOW,
    automaticFrontier,
    revision: {
      schemaVersion: "country-resolution@1",
      rulesVersion: "country-resolution@1",
      id: "resolution-revision-all-green",
      resolutionRunId: "resolution-run-all-green",
      automaticShortlistSnapshotId: automaticFrontier.shortlistSnapshot.id,
      rankingSnapshotId: automaticFrontier.rankingSnapshot.id,
      profileSnapshotId: PROFILE_ID,
      preferenceProfileSnapshotId: PREFERENCE_ID,
      decisions: [],
      replacementMarkers: [],
      nextUncheckedRank: 3,
      unresolvedCountryCodes: [],
      slotCountryCodes: ["AA", "BB"],
      contextHash: "e".repeat(64),
      createdAt: NOW,
      kind: "resolved",
      resolvedEntries: entries,
      stopCondition: "ranking_exhausted",
    },
  };
}

function unresolvedFixture(catalogOnly = false): CountryResolutionReadModel {
  const base = automaticFixture();
  const unresolved = yellowMarker("AA", 1, catalogOnly);
  const automaticFrontier: PlaceFrontierReadModel = {
    ...base,
    shortlistSnapshot: {
      ...base.shortlistSnapshot,
      markers: [unresolved, base.shortlistSnapshot.markers[1]!],
    },
  };
  return {
    resolutionRunId: "resolution-run-unresolved",
    assessmentAt: NOW,
    automaticFrontier,
    revision: {
      schemaVersion: "country-resolution@1",
      rulesVersion: "country-resolution@1",
      id: "resolution-revision-unresolved",
      resolutionRunId: "resolution-run-unresolved",
      automaticShortlistSnapshotId: automaticFrontier.shortlistSnapshot.id,
      rankingSnapshotId: automaticFrontier.rankingSnapshot.id,
      profileSnapshotId: PROFILE_ID,
      preferenceProfileSnapshotId: PREFERENCE_ID,
      decisions: [],
      replacementMarkers: [],
      nextUncheckedRank: 3,
      unresolvedCountryCodes: ["AA"],
      slotCountryCodes: ["AA", "BB"],
      contextHash: "f".repeat(64),
      createdAt: NOW,
      kind: "working",
      phase: "awaiting_decision",
    },
  };
}

function rejectedContinuationFixture() {
  const unresolved = unresolvedFixture();
  const sourceMarkers = [
    yellowMarker("AA", 1),
    marker("BB", 2),
    marker("CC", 3),
    marker("DD", 4),
    marker("EE", 5),
  ];
  const replacement = marker("FF", 6);
  const automaticFrontier: PlaceFrontierReadModel = {
    ...unresolved.automaticFrontier,
    rankingSnapshot: {
      ...unresolved.automaticFrontier.rankingSnapshot,
      knowledgeRevisionIds: { AA: null, BB: null, CC: null, DD: null, EE: null, FF: null },
      ordered: [...sourceMarkers, replacement].map(({ country, rank }) => ({
        ...country,
        factors: [],
        rank,
        relevance: "1",
        coverage: "1",
        contributions: [],
      })),
    },
    shortlistSnapshot: {
      ...unresolved.automaticFrontier.shortlistSnapshot,
      markers: sourceMarkers,
    },
  };
  const decision = {
    countryCode: "AA",
    decision: "rejected" as const,
    formalMarkerDigest: "1".repeat(64),
    uncertaintyBasis: {
      unknownRoutes: [],
      catalogCompletenessUnprovable: {
        code: "catalog_completeness_unprovable",
        claimIds: [],
        evidence: [],
        navigation: [],
      },
    },
    warningCopyVersion: "yellow-risk@1" as const,
    decidedAt: NOW,
    commandId: "reject-AA",
  };
  const decided: CountryResolutionReadModel = {
    ...unresolved,
    automaticFrontier,
    revision: {
      ...unresolved.revision,
      id: "resolution-revision-rejected",
      automaticShortlistSnapshotId: automaticFrontier.shortlistSnapshot.id,
      rankingSnapshotId: automaticFrontier.rankingSnapshot.id,
      decisions: [decision],
      unresolvedCountryCodes: [],
      slotCountryCodes: ["BB", "CC", "DD", "EE"],
      nextUncheckedRank: 6,
      kind: "working",
      phase: "replacement_required",
    },
  };
  if (decided.revision.kind !== "working") throw new Error("fixture_not_working");
  const { phase, ...revisionWithoutPhase } = decided.revision;
  if (phase !== "replacement_required") throw new Error("fixture_not_continuable");
  const resolvedRevision = {
    ...revisionWithoutPhase,
    id: "resolution-revision-resolved",
    predecessorRevisionId: decided.revision.id,
    replacementMarkers: [replacement],
    nextUncheckedRank: 7,
    slotCountryCodes: ["BB", "CC", "DD", "EE", "FF"],
    contextHash: "9".repeat(64),
    kind: "resolved" as const,
    resolvedEntries: ["BB", "CC", "DD", "EE", "FF"].map((countryCode, index) => ({
      countryCode,
      rank: index + 2,
      formalMarkerDigest: String(index + 2).repeat(64).slice(0, 64),
    })),
    stopCondition: "five_effective_green" as const,
  };
  const terminal: CountryResolutionReadModel = { ...decided, revision: resolvedRevision };
  const events = [
    {
      resolutionRunId: decided.resolutionRunId,
      sequence: 1,
      occurredAt: NOW,
      type: "replacement_country_activated",
      payload: { country: replacement.country, rank: replacement.rank },
    },
    {
      resolutionRunId: decided.resolutionRunId,
      sequence: 2,
      occurredAt: NOW,
      type: "replacement_country_progress",
      payload: {
        countryCode: "FF",
        stage: "artifact_captured",
        label: "Получен официальный документ FF",
        detail: "sha256:fixture",
      },
    },
    {
      resolutionRunId: decided.resolutionRunId,
      sequence: 3,
      occurredAt: NOW,
      type: "resolution_revision_committed",
      payload: { marker: replacement, revision: resolvedRevision },
    },
    {
      resolutionRunId: decided.resolutionRunId,
      sequence: 4,
      occurredAt: NOW,
      type: "resolution_continuation_completed",
      payload: { readModel: terminal },
    },
  ];
  return { decided, events, terminal };
}

function resolutionEventResponse(
  readModel: CountryResolutionReadModel,
  events: readonly unknown[],
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      events.forEach((event) => controller.enqueue(
        encoder.encode(`${JSON.stringify(event)}\n`),
      ));
      controller.close();
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "x-life-resolution-run-id": readModel.resolutionRunId,
      "x-life-expected-revision-id": readModel.revision.id,
    },
  });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.doUnmock("../../src/infrastructure/composition-root");
  vi.doUnmock("../../src/experience/components/PlaceFrontierJourney");
  window.history.replaceState(null, "", "/");
});

describe("country-resolution same-planet handoff", () => {
  test("starts from a verified stored automatic terminal once and retains the same globe", async () => {
    const automatic = automaticFixture();
    const resolved = allGreenResolution(automatic);
    const fetch = vi.fn(async () => new Response(JSON.stringify(resolved), {
      headers: { "content-type": "application/json; charset=utf-8" },
    }));
    vi.stubGlobal("fetch", fetch);

    const journey = render(
      <PlaceFrontierJourney mode={{ kind: "automatic-stored", readModel: automatic }} />,
    );
    const globe = journey.container.querySelector(".workspace-globe");

    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    expect(fetch).toHaveBeenCalledWith("/api/country-resolution/start", {
      body: JSON.stringify({
        automaticShortlistSnapshotId: automatic.shortlistSnapshot.id,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
      signal: expect.any(AbortSignal),
    });
    await vi.waitFor(() => expect(window.location.search)
      .toBe("?flow=country-resolution&run=resolution-run-all-green"));
    expect(journey.container.querySelector(".workspace-globe")).toBe(globe);
    expect(screen.queryByRole("heading", { name: /решение по стране/i })).toBeNull();
    expect(screen.getByRole("region", { name: "Карточки стран" })).toBeTruthy();
  });

  test("focuses the exact prompt and submits only the closed durable command after user choice", async () => {
    const unresolved = unresolvedFixture();
    let resolveDecision: ((response: Response) => void) | undefined;
    const fetch = vi.fn<(...args: [RequestInfo | URL, RequestInit?]) => Promise<Response>>(() =>
      new Promise<Response>((resolve) => {
      resolveDecision = resolve;
      }));
    vi.stubGlobal("fetch", fetch);
    render(<PlaceFrontierJourney mode={{ kind: "resolution-stored", readModel: unresolved }} />);

    const heading = screen.getByRole("heading", { name: "Решение по стране Country AA" });
    expect(document.activeElement).toBe(heading);
    expect(screen.getByText(/route-AA:/).textContent).toContain("route_requirements_unknown");
    expect(screen.getByText(
      "Полнота официального каталога маршрутов не подтверждена.",
    )).toBeTruthy();
    expect(screen.getByText(
      "Официальных данных недостаточно, чтобы подтвердить возможность долгосрочного проживания. " +
      "Принимая страну, вы берёте риск самостоятельной проверки на себя.",
    )).toBeTruthy();
    expect(screen.getByRole("link", { name: "Официальный источник 1" }).getAttribute("href"))
      .toBe("https://official.test/AA");
    expect(screen.getByRole("link", { name: "Проверить AA" }).getAttribute("href"))
      .toBe("https://manual.test/AA");

    const panel = screen.getByRole("region", { name: "Решение по стране Country AA" });
    const actions = within(panel).getAllByRole("button");
    expect(actions.map((button) => button.textContent?.trim())).toEqual([
      "Принять риск и оставить страну",
      "Отклонить страну",
    ]);
    const candidate = screen.getByText(/Россия → Country AA/).closest("li");
    expect(candidate?.className).toContain("--yellow");

    fireEvent.click(actions[0]!);
    expect(actions.every((button) => (button as HTMLButtonElement).disabled)).toBe(true);
    expect(candidate?.className).toContain("--yellow");
    expect(fetch).toHaveBeenCalledOnce();
    const body = JSON.parse((fetch.mock.calls[0]?.[1] as RequestInit).body as string);
    expect(body).toEqual({
      resolutionRunId: "resolution-run-unresolved",
      expectedRevisionId: "resolution-revision-unresolved",
      countryCode: "AA",
      decision: "accepted_at_own_risk",
      warningCopyVersion: "yellow-risk@1",
      commandId: expect.any(String),
    });
    expect(body).not.toHaveProperty("uncertainty");
    expect(body).not.toHaveProperty("reasons");
    expect(body).not.toHaveProperty("decidedAt");

    resolveDecision?.(new Response(null, { status: 500 }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/цвет страны не изменён/i);
  });

  test("renders catalog-only uncertainty without inventing an unknown route", () => {
    const unresolved = unresolvedFixture(true);
    vi.stubGlobal("fetch", vi.fn());
    render(<PlaceFrontierJourney mode={{ kind: "resolution-stored", readModel: unresolved }} />);

    expect(screen.getByText(
      "Полнота официального каталога маршрутов не подтверждена.",
    )).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Неполные формальные факты" })).toBeNull();
  });

  test("retries an ambiguous decision with the same command id and exact payload", async () => {
    const unresolved = unresolvedFixture();
    const fetch = vi.fn()
      .mockRejectedValueOnce(new TypeError("connection reset"))
      .mockRejectedValueOnce(new TypeError("connection reset"));
    vi.stubGlobal("fetch", fetch);
    render(<PlaceFrontierJourney mode={{ kind: "resolution-stored", readModel: unresolved }} />);

    fireEvent.click(screen.getByRole("button", { name: "Принять риск и оставить страну" }));
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "Принять риск и оставить страну" }));
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));

    expect((fetch.mock.calls[0]?.[1] as RequestInit).body)
      .toBe((fetch.mock.calls[1]?.[1] as RequestInit).body);
  });

  test("keeps a rejected country truthful while its replacement progresses to terminal cards", async () => {
    const initial = unresolvedFixture();
    const fixture = rejectedContinuationFixture();
    const encoder = new TextEncoder();
    let continuation: ReadableStreamDefaultController<Uint8Array> | undefined;
    const continuationResponse = new Response(new ReadableStream<Uint8Array>({
      start(controller) { continuation = controller; },
    }), {
      headers: {
        "content-type": "application/x-ndjson; charset=utf-8",
        "x-life-resolution-run-id": fixture.decided.resolutionRunId,
        "x-life-expected-revision-id": fixture.decided.revision.id,
      },
    });
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(fixture.decided), {
        headers: { "content-type": "application/json; charset=utf-8" },
      }))
      .mockResolvedValueOnce(continuationResponse);
    vi.stubGlobal("fetch", fetch);
    const journey = render(
      <PlaceFrontierJourney mode={{ kind: "resolution-stored", readModel: initial }} />,
    );
    const globe = journey.container.querySelector(".workspace-globe");

    fireEvent.click(screen.getByRole("button", { name: "Отклонить страну" }));

    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(fetch.mock.calls[1]?.[0]).toBe("/api/country-resolution/continue");
    expect(JSON.parse((fetch.mock.calls[1]?.[1] as RequestInit).body as string)).toEqual({
      resolutionRunId: fixture.decided.resolutionRunId,
      expectedRevisionId: fixture.decided.revision.id,
    });
    await vi.waitFor(() => expect(window.location.search)
      .toBe(`?flow=country-resolution&run=${fixture.decided.resolutionRunId}`));
    expect(journey.container.querySelector(".workspace-globe")).toBe(globe);
    await vi.waitFor(() => expect(screen.getByText(/Россия → Country AA/).closest("li")?.className)
      .toContain("--red"));
    fireEvent.click(screen.getByRole("button", { name: /Россия → Country AA/ }));
    expect(screen.getByText(
      "Формальные данные остались неполными; пользователь отказался принимать риск " +
      "самостоятельной проверки.",
    ))
      .toBeTruthy();

    continuation?.enqueue(encoder.encode(`${JSON.stringify(fixture.events[0])}\n`));
    continuation?.enqueue(encoder.encode(`${JSON.stringify(fixture.events[1])}\n`));
    const progress = await screen.findByRole("region", { name: "Ход проверки" });
    expect(progress.textContent).toContain("Получен официальный документ FF");
    expect(progress.textContent).toContain("sha256:fixture");
    continuation?.enqueue(encoder.encode(`${JSON.stringify(fixture.events[2])}\n`));
    continuation?.enqueue(encoder.encode(`${JSON.stringify(fixture.events[3])}\n`));
    continuation?.close();
    await vi.waitFor(() => expect(screen.getByRole("heading", {
      name: "5 стран доступны для выбора",
    })).toBeTruthy());
    expect(journey.container.querySelector(".workspace-globe")).toBe(globe);
    expect(screen.getByRole("region", { name: "Карточки стран" })).toBeTruthy();
    expect(screen.getByRole("region", {
      name: "Проверка формальной доступности стран",
    }).getAttribute("data-tone")).toBe("green");
    expect(screen.queryByText(/Решение по стране/)).toBeNull();
  });

  test("never auto-continues a stored replacement and starts only from explicit Continue", async () => {
    const fixture = rejectedContinuationFixture();
    const fetch = vi.fn<(...args: [RequestInfo | URL, RequestInit?]) => Promise<Response>>(async () =>
      resolutionEventResponse(fixture.decided, fixture.events));
    vi.stubGlobal("fetch", fetch);
    render(<PlaceFrontierJourney mode={{ kind: "resolution-stored", readModel: fixture.decided }} />);

    await Promise.resolve();
    expect(fetch).not.toHaveBeenCalled();
    expect(screen.queryByRole("region", { name: "Ход проверки" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Продолжить проверку" }));
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    expect(fetch.mock.calls[0]?.[0]).toBe("/api/country-resolution/continue");
    await vi.waitFor(() => expect(screen.getByRole("heading", {
      name: "5 стран доступны для выбора",
    })).toBeTruthy());
  });

  test("renders an empty resolved reload without progress, cards, or a City escape hatch", () => {
    const fixture = rejectedContinuationFixture();
    if (fixture.terminal.revision.kind !== "resolved") throw new Error("fixture_not_resolved");
    const empty: CountryResolutionReadModel = {
      ...fixture.terminal,
      revision: {
        ...fixture.terminal.revision,
        id: "resolution-revision-empty",
        resolvedEntries: [],
        stopCondition: "ranking_exhausted",
      },
    };
    vi.stubGlobal("fetch", vi.fn());

    render(<PlaceFrontierJourney mode={{ kind: "resolution-stored", readModel: empty }} />);

    expect(screen.getByRole("heading", { name: "0 стран доступны для выбора" })).toBeTruthy();
    expect(screen.getByText(
      "После разрешения неопределённости подходящих стран не осталось.",
    )).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Ход проверки" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Карточки стран" })).toBeNull();
    expect(screen.queryByText(/City|город/i)).toBeNull();
  });
});

describe("country-resolution reload boundary", () => {
  test("presents a resolution by run only before legacy flow routing", async () => {
    const readModel = unresolvedFixture();
    const presentCountryResolution = vi.fn(async () => readModel);
    const presentPlaceFrontier = vi.fn();
    vi.resetModules();
    vi.doMock("../../src/infrastructure/composition-root", () => ({
      getConfirmedLifeApplication: () => ({ presentCountryResolution, presentPlaceFrontier }),
    }));
    vi.doMock("../../src/experience/components/PlaceFrontierJourney", () => ({
      PlaceFrontierJourney: (props: {
        mode: { readonly kind: string; readonly readModel: CountryResolutionReadModel };
      }) => <p>{props.mode.kind}:{props.mode.readModel.resolutionRunId}</p>,
    }));
    const { default: Page } = await import("../../src/app/page");

    render(await Page({ searchParams: Promise.resolve({
      flow: "country-resolution",
      profile: "stray-profile",
      run: readModel.resolutionRunId,
    }) }));

    expect(presentCountryResolution).toHaveBeenCalledWith(readModel.resolutionRunId);
    expect(presentPlaceFrontier).not.toHaveBeenCalled();
    expect(screen.getByText(`resolution-stored:${readModel.resolutionRunId}`)).toBeTruthy();
  });

  test("separates recoverable missing resolution from integrity failure without domain output", async () => {
    const presentCountryResolution = vi.fn()
      .mockRejectedValueOnce(new Error("resolution_not_found"))
      .mockRejectedValueOnce(new Error("integrity_mismatch"));
    vi.resetModules();
    vi.doMock("../../src/infrastructure/composition-root", () => ({
      getConfirmedLifeApplication: () => ({ presentCountryResolution }),
    }));
    const { default: Page } = await import("../../src/app/page");

    render(await Page({ searchParams: Promise.resolve({
      flow: "country-resolution",
      run: "missing-resolution",
    }) }));
    expect(screen.getByRole("heading", { name: "Разрешение не найдено" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Открыть поиск стран" }).getAttribute("href"))
      .toBe("?flow=place-frontier");

    cleanup();
    render(await Page({ searchParams: Promise.resolve({
      flow: "country-resolution",
      run: "tampered-resolution",
    }) }));
    expect(screen.getByRole("heading", { name: "Снимок не удалось открыть" })).toBeTruthy();
    expect(screen.queryByText(/Country AA|Требует решения|integrity_mismatch/)).toBeNull();
  });

  test("reloads the last committed replacement head without reconstructing stream progress", async () => {
    const fixture = rejectedContinuationFixture();
    if (fixture.terminal.revision.kind !== "resolved") throw new Error("fixture_not_resolved");
    const committed = fixture.terminal;
    const presentCountryResolution = vi.fn(async () => committed);
    vi.resetModules();
    vi.doMock("../../src/infrastructure/composition-root", () => ({
      getConfirmedLifeApplication: () => ({ presentCountryResolution }),
    }));
    vi.doMock("../../src/experience/components/PlaceFrontierJourney", () => ({
      PlaceFrontierJourney: (props: {
        mode: { readonly kind: string; readonly readModel: CountryResolutionReadModel };
      }) => (
        <section>
          <p>{props.mode.kind}:{props.mode.readModel.revision.replacementMarkers
            .map(({ country }) => country.countryCode).join(",")}</p>
          <p>progress:0</p>
        </section>
      ),
    }));
    const { default: Page } = await import("../../src/app/page");

    render(await Page({ searchParams: Promise.resolve({
      flow: "country-resolution",
      run: committed.resolutionRunId,
    }) }));

    expect(presentCountryResolution).toHaveBeenCalledWith(committed.resolutionRunId);
    expect(screen.getByText("resolution-stored:FF")).toBeTruthy();
    expect(screen.getByText("progress:0")).toBeTruthy();
  });
});

describe("country-resolution continuation ownership", () => {
  test("survives StrictMode replay and cancels the adopted stream once on true unmount", async () => {
    const fixture = rejectedContinuationFixture();
    const cancel = vi.fn();
    const response = new Response(new ReadableStream<Uint8Array>({ cancel }), {
      headers: {
        "content-type": "application/x-ndjson; charset=utf-8",
        "x-life-resolution-run-id": fixture.decided.resolutionRunId,
        "x-life-expected-revision-id": fixture.decided.revision.id,
      },
    });
    vi.stubGlobal("fetch", vi.fn(async () => response));

    const journey = render(
      <StrictMode>
        <PlaceFrontierJourney mode={{ kind: "resolution-stored", readModel: fixture.decided }} />
      </StrictMode>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Продолжить проверку" }));
    await vi.waitFor(() => expect(window.location.search)
      .toBe(`?flow=country-resolution&run=${fixture.decided.resolutionRunId}`));
    await Promise.resolve();
    expect(cancel).not.toHaveBeenCalled();

    journey.unmount();
    await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce());
  });

  test("cancels after installing the resolution URL when unmounted before stream adoption", async () => {
    const fixture = rejectedContinuationFixture();
    const cancel = vi.fn();
    const response = new Response(new ReadableStream<Uint8Array>({ cancel }), {
      headers: {
        "content-type": "application/x-ndjson; charset=utf-8",
        "x-life-resolution-run-id": fixture.decided.resolutionRunId,
        "x-life-expected-revision-id": fixture.decided.revision.id,
      },
    });
    vi.stubGlobal("fetch", vi.fn(async () => response));
    const replaceState = vi.spyOn(window.history, "replaceState");
    const journey = render(
      <PlaceFrontierJourney mode={{ kind: "resolution-stored", readModel: fixture.decided }} />,
    );
    replaceState.mockImplementationOnce((_state, _unused, url) => {
      expect(String(url)).toBe(`?flow=country-resolution&run=${fixture.decided.resolutionRunId}`);
      journey.unmount();
    });

    fireEvent.click(screen.getByRole("button", { name: "Продолжить проверку" }));

    await vi.waitFor(() => expect(replaceState).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce());
  });

  test("aborts a pending continuation request when a second explicit Continue supersedes it", async () => {
    const fixture = rejectedContinuationFixture();
    let firstSignal: AbortSignal | undefined;
    const fetch = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      if (fetch.mock.calls.length === 1) {
        firstSignal = init?.signal as AbortSignal;
        return new Promise<Response>(() => undefined);
      }
      return Promise.resolve(resolutionEventResponse(fixture.decided, fixture.events));
    });
    vi.stubGlobal("fetch", fetch);
    render(<PlaceFrontierJourney mode={{ kind: "resolution-stored", readModel: fixture.decided }} />);

    const continueButton = screen.getByRole("button", { name: "Продолжить проверку" });
    fireEvent.click(continueButton);
    fireEvent.click(continueButton);

    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(firstSignal?.aborted).toBe(true);
    await vi.waitFor(() => expect(screen.getByRole("heading", {
      name: "5 стран доступны для выбора",
    })).toBeTruthy());
  });

  test("retains a committed replacement when transport ends before the terminal event", async () => {
    const fixture = rejectedContinuationFixture();
    const encoder = new TextEncoder();
    let continuation: ReadableStreamDefaultController<Uint8Array> | undefined;
    const response = new Response(new ReadableStream<Uint8Array>({
      start(controller) { continuation = controller; },
    }), {
      headers: {
        "content-type": "application/x-ndjson; charset=utf-8",
        "x-life-resolution-run-id": fixture.decided.resolutionRunId,
        "x-life-expected-revision-id": fixture.decided.revision.id,
      },
    });
    vi.stubGlobal("fetch", vi.fn(async () => response));
    const journey = render(
      <PlaceFrontierJourney mode={{ kind: "resolution-stored", readModel: fixture.decided }} />,
    );
    const globe = journey.container.querySelector(".workspace-globe");

    fireEvent.click(screen.getByRole("button", { name: "Продолжить проверку" }));
    await vi.waitFor(() => expect(window.location.search)
      .toBe(`?flow=country-resolution&run=${fixture.decided.resolutionRunId}`));
    fixture.events.slice(0, 3).forEach((event) => continuation?.enqueue(
      encoder.encode(`${JSON.stringify(event)}\n`),
    ));
    continuation?.close();

    expect((await screen.findByRole("alert")).textContent)
      .toBe("Проверка замены прервана. Сохранённая история не изменена.");
    await vi.waitFor(() => expect(screen.getByText(/Россия → Country FF/).closest("li")?.className)
      .toContain("--green"));
    expect(screen.getByText(/Россия → Country AA/).closest("li")?.className)
      .toContain("--red");
    expect(journey.container.querySelector(".workspace-globe")).toBe(globe);
    expect(screen.queryByRole("region", { name: "Карточки стран" })).toBeNull();
  });
});
