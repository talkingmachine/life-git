// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import type {
  CityFrontierEvent,
  CityFrontierReadModel,
} from "../../src/application/city-frontier-contracts";

const SOURCE_ID = "country-resolution:terminal-si";
const RUN_ID = "city-frontier:si-run";
const BASE_REVISION_ID = "city-frontier-revision:si-base";
const SUCCESSOR_REVISION_ID = "city-frontier-revision:si-successor";
const INSTANT = "2026-08-28T12:00:00.000Z";

const criteria = [
  {
    criterionId: "safety",
    definitionId: "si-municipal-police-offences-per-100000@1",
    mode: "required",
    importance: 5,
    target: "2",
  },
  {
    criterionId: "long_term_rent",
    definitionId: "rent@1",
    mode: "weighted",
    importance: 4,
    target: "900",
  },
  {
    criterionId: "urban_transit",
    definitionId: "transit@1",
    mode: "weighted",
    importance: 3,
    target: "0.7",
  },
  {
    criterionId: "fixed_broadband",
    definitionId: "broadband@1",
    mode: "weighted",
    importance: 2,
    target: "100",
  },
] as const;

function cityMarker() {
  const facts = criteria.map((criterion) => ({
    criterionId: criterion.criterionId,
    definitionId: criterion.definitionId,
    geoScope: "municipality",
    referencePeriod: "2025",
    freshnessBasis: "annual@1",
    unit: criterion.criterionId === "safety" ? "offences_per_100000_residents" : "unit",
    denominator: "municipality",
    outcome: criterion.criterionId === "safety"
      ? {
          kind: "verified" as const,
          basis: {
            kind: "municipal_safety" as const,
            quantity: {
              offenceCount: "1200",
              population: "300000",
              rateBasis: "offences_per_100000_residents" as const,
            },
          },
        }
      : { kind: "verified" as const, basis: { kind: "canonical_scalar" as const, value: "1" } },
    evidenceLinks: criterion.criterionId === "safety" ? [{
      sourceId: "si-city-safety",
      disposition: "accepted" as const,
      navigationUrl: "https://official.example/safety",
      resolvedEvidenceUrl: "https://official.example/safety.pdf",
      referenceYear: 2025,
    }] : [],
    manualCheckLinks: [],
  }));
  return {
    cityId: "ljubljana",
    rank: 1,
    status: "excluded" as const,
    visualStatus: "red" as const,
    knowledgeRevisionId: "city-knowledge:ljubljana@1",
    evidenceSnapshotId: "city-evidence:ljubljana@1",
    lastCheckedAt: INSTANT,
    requiredMismatches: [{
      criterionId: "safety",
      definitionId: criteria[0].definitionId,
      target: "2",
      verifiedBasis: facts[0]!.outcome.kind === "verified" ? facts[0]!.outcome.basis : undefined,
      evaluatorVersion: "si-municipal-safety-linear@1",
    }],
    unknownBasis: [],
    verificationCoverage: "1",
    facts,
  };
}

function cityReadModel(input: {
  readonly revisionId: string;
  readonly withCommittedMarker?: boolean;
}): CityFrontierReadModel {
  const marker = input.withCommittedMarker ? cityMarker() : undefined;
  return {
    runId: RUN_ID,
    assessmentAt: INSTANT,
    resolvedCountryShortlistRevisionId: SOURCE_ID,
    countryCode: "SI",
    preCityBranchCommitId: `pre-city-branch:${"a".repeat(64)}`,
    registry: {
      schemaVersion: "city-registry@1",
      id: "city-registry:si@1",
      packageId: "slovenia-city",
      packageSchemaVersion: "slovenia-city@1",
      countryCode: "SI",
      evidenceSnapshotId: "city-catalog-evidence:si@1",
      entries: ["ljubljana", "maribor"].map((cityId, index) => ({
        cityId,
        countryCode: "SI",
        officialName: cityId === "ljubljana" ? "Ljubljana" : "Maribor",
        coordinate: { lat: 46 + index / 10, lng: 14 + index / 10 },
        administrativeType: "municipality",
        administrativeTerritory: cityId,
        capitalRoles: [],
        evidenceReferenceIds: [`official-register:${cityId}`],
      })),
      createdAt: INSTANT,
    },
    catalog: {
      schemaVersion: "city-catalog@1",
      id: "city-catalog:si@1",
      packageId: "slovenia-city",
      packageSchemaVersion: "slovenia-city@1",
      countryCode: "SI",
      registryRevisionId: "city-registry:si@1",
      evidenceSnapshotId: "city-catalog-evidence:si@1",
      populationDefinition: {
        definitionId: "population@1",
        geoScope: "municipality",
        unit: "people",
      },
      candidateBasis: ["ljubljana", "maribor"].map((cityId) => ({
        cityId,
        comparablePopulation: { kind: "verified" as const, value: "100000", referencePeriod: "2025" },
      })),
      members: ["ljubljana", "maribor"].map((cityId) => ({
        cityId,
        inclusionReasons: ["population_fill" as const],
      })),
      coverage: { status: "complete" as const },
      rulesVersion: "city-catalog@2",
      createdAt: INSTANT,
    },
    criteria: {
      schemaVersion: "city-criteria@1",
      id: "city-criteria:si@1",
      profileSnapshotId: "profile:si@1",
      preferenceProfileSnapshotId: "preferences:si@1",
      criteria,
      rulesVersion: "city-criteria@1",
      confirmedAt: INSTANT,
    },
    ranking: {
      schemaVersion: "city-ranking@1",
      id: "city-ranking:si@1",
      runId: RUN_ID,
      resolvedCountryShortlistRevisionId: SOURCE_ID,
      countryCode: "SI",
      packageId: "slovenia-city",
      packageSchemaVersion: "slovenia-city@1",
      preCityBranchCommitId: `pre-city-branch:${"a".repeat(64)}`,
      profileSnapshotId: "profile:si@1",
      preferenceProfileSnapshotId: "preferences:si@1",
      registryRevisionId: "city-registry:si@1",
      catalogRevisionId: "city-catalog:si@1",
      installedPackageContext: {
        countryCode: "SI",
        packageId: "slovenia-city",
        packageSchemaVersion: "slovenia-city@1",
        catalogRevisionId: "city-catalog:si@1",
        evidenceRulesVersion: "city-evidence@1",
      },
      criteriaSnapshotId: "city-criteria:si@1",
      assessmentAt: INSTANT,
      knowledgeRevisionIds: { ljubljana: null, maribor: null },
      ordered: ["ljubljana", "maribor"].map((cityId, index) => ({
        cityId,
        rank: index + 1,
        score: "0",
        coverage: "0",
        knowledgeRevisionId: null,
        factors: criteria.map((criterion) => ({
          criterionId: criterion.criterionId,
          definitionId: criterion.definitionId,
          mode: criterion.mode,
          importance: criterion.importance,
          evaluatorVersion: "fixture-evaluator@1",
          freshnessPolicyVersion: "annual@1",
          state: "verified" as const,
          factor: "0",
          weightedContribution: "0",
          targetComparison: "matches" as const,
          requiredMismatch: false,
        })),
      })),
      screenedExclusions: [],
      rulesVersion: "city-ranker@1",
      verificationBudget: {
        liveCityCandidateLimit: 10,
        targetSelectableCities: 3,
        rulesVersion: "city-frontier-budget@1",
      },
      createdAt: INSTANT,
    },
    revision: marker === undefined ? {
      schemaVersion: "city-frontier@1",
      kind: "working",
      id: input.revisionId,
      runId: RUN_ID,
      rankingSnapshotId: "city-ranking:si@1",
      markers: [],
      nextUncheckedRank: 1,
      phase: "verification_required",
      operation: { kind: "start", commandId: "city-start:si", criteriaPayloadHash: "b".repeat(64) },
      createdAt: INSTANT,
    } : {
      schemaVersion: "city-frontier@1",
      kind: "working",
      id: input.revisionId,
      runId: RUN_ID,
      predecessorRevisionId: BASE_REVISION_ID,
      rankingSnapshotId: "city-ranking:si@1",
      markers: [marker],
      nextUncheckedRank: 2,
      phase: "verification_required",
      operation: {
        kind: "city_completed",
        commandId: "city-continue:si",
        expectedHeadRevisionId: BASE_REVISION_ID,
        cityId: "ljubljana",
        cityCheckRunId: "city-check:si",
      },
      createdAt: INSTANT,
    },
    selections: [],
  } as unknown as CityFrontierReadModel;
}

function setupFixture() {
  return {
    resolvedCountryShortlistRevisionId: SOURCE_ID,
    countryCode: "SI",
    profileSnapshotId: "profile:si@1",
    preferenceProfileSnapshotId: "preferences:si@1",
    resolvedCountryEntry: { countryCode: "SI", label: "Slovenia" },
    installedPackageContext: {
      countryCode: "SI",
      packageId: "slovenia-city",
      packageSchemaVersion: "slovenia-city@1",
      catalogRevisionId: "city-catalog:si@1",
      evidenceRulesVersion: "city-evidence@1",
    },
    registryRevisionId: "city-registry:si@1",
    catalogMemberCount: 2,
    catalogCoverage: { status: "complete" as const },
    criterionDefinitions: criteria.map((criterion) => ({
      criterionId: criterion.criterionId,
      definitionId: criterion.definitionId,
      direction: "at_least" as const,
      unit: "unit",
      denominator: "municipality",
      compatibleGeoScopes: ["municipality"],
      freshnessPolicyVersion: "annual@1",
      evaluatorVersion: "fixture-evaluator@1",
    })),
    criteriaDraft: criteria,
  };
}

function continuationResponse(): {
  readonly response: Response;
  readonly controller: ReadableStreamDefaultController<Uint8Array>;
} {
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  const response = new Response(new ReadableStream<Uint8Array>({
    start(streamController) { controller = streamController; },
  }), {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "x-life-run-id": RUN_ID,
      "x-life-base-revision-id": BASE_REVISION_ID,
    },
  });
  if (controller === undefined) throw new Error("missing_stream_controller");
  return { response, controller };
}

async function loadCityFrontierJourney() {
  const specifier = "../../src/experience/components/CityFrontierJourney";
  return import(/* @vite-ignore */ specifier);
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.doUnmock("../../src/infrastructure/composition-root");
  window.history.replaceState(null, "", "/");
});

describe("city-frontier first experience vertical REDs", () => {
  test("links a resolved country to verified City setup with its exact source and country", async () => {
    const { CountryResolutionPanel } = await import(
      "../../src/experience/components/CountryResolutionPanel"
    );
    render(
      <CountryResolutionPanel
        decisionPending={false}
        onContinue={vi.fn()}
        onDecision={vi.fn()}
        onReload={vi.fn()}
        readModel={{ revision: { id: SOURCE_ID, kind: "resolved" } } as never}
        view={{
          globeMode: "collapsed",
          candidates: [{
            country: {
              countryCode: "SI",
              label: "Slovenia",
              flag: "🇸🇮",
              coordinate: { lat: 46, lng: 14 },
            },
            statusLabel: "Доступна",
          }],
          cards: [{
            country: {
              countryCode: "SI",
              label: "Slovenia",
              flag: "🇸🇮",
              coordinate: { lat: 46, lng: 14 },
            },
            rank: 1,
            relevance: "1",
            coverage: "1",
            contributions: [],
            lastCheckedAt: "2026-08-28",
            evidenceSnapshotId: "evidence:si",
          }],
        } as never}
      />,
    );
    expect.soft(screen.queryByRole("link", { name: "Исследовать города" })?.getAttribute("href"))
      .toBe(`?flow=city-frontier&source=${encodeURIComponent(SOURCE_ID)}&country=SI`);

    cleanup();
    const presentCityFrontierSetup = vi.fn(async () => setupFixture());
    vi.resetModules();
    vi.doMock("../../src/infrastructure/composition-root", () => ({
      getConfirmedLifeApplication: () => ({ presentCityFrontierSetup }),
    }));
    const { default: Page } = await import("../../src/app/page");
    render(await Page({ searchParams: Promise.resolve({
      flow: "city-frontier",
      source: SOURCE_ID,
      country: "SI",
    }) }));

    expect(presentCityFrontierSetup).toHaveBeenCalledWith({
      resolvedCountryShortlistRevisionId: SOURCE_ID,
      countryCode: "SI",
    });
  });

  test("starts from Journey setup with the exact criteria and installs the run URL before live UI", async () => {
    const started = cityReadModel({ revisionId: BASE_REVISION_ID });
    const { normalizeCityFrontierReadModel } = await import(
      "../../src/experience/city-frontier-stream"
    );
    expect(() => normalizeCityFrontierReadModel(started)).not.toThrow();
    const { CityFrontierJourney } = await loadCityFrontierJourney();
    vi.stubGlobal("crypto", { randomUUID: () => "city-start:command-1" });
    const fetch = vi.fn<(...args: [RequestInfo | URL, RequestInit?]) => Promise<Response>>(
      async () => new Response(JSON.stringify(started), {
        headers: { "content-type": "application/json; charset=utf-8" },
      }),
    );
    vi.stubGlobal("fetch", fetch);
    const nativeReplaceState = History.prototype.replaceState;
    const replaceState = vi.spyOn(window.history, "replaceState");
    replaceState.mockImplementation((state, unused, url) => {
      expect(screen.queryByRole("button", { name: "Продолжить проверку" })).toBeNull();
      return nativeReplaceState.call(window.history, state, unused, url);
    });

    render(<CityFrontierJourney mode={{ kind: "setup", setup: setupFixture() } as never} />);
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Запустить поиск городов" }));

    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toEqual({
      resolvedCountryShortlistRevisionId: SOURCE_ID,
      countryCode: "SI",
      criteria,
      commandId: "city-start:command-1",
    });
    await vi.waitFor(() => expect(window.location.search)
      .toBe(`?flow=city-frontier&run=${encodeURIComponent(RUN_ID)}`));
    expect(screen.getByRole("button", { name: "Продолжить проверку" })).toBeTruthy();
  });

  test("presents a City run by run only with its stored marker and no client fetch", async () => {
    const stored = cityReadModel({
      revisionId: SUCCESSOR_REVISION_ID,
      withCommittedMarker: true,
    });
    const presentCityFrontier = vi.fn(async () => stored);
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    vi.resetModules();
    vi.doMock("../../src/infrastructure/composition-root", () => ({
      getConfirmedLifeApplication: () => ({ presentCityFrontier }),
    }));
    const { default: Page } = await import("../../src/app/page");

    const { normalizeCityFrontierReadModel } = await import(
      "../../src/experience/city-frontier-stream"
    );
    expect(() => normalizeCityFrontierReadModel(stored)).not.toThrow();
    render(await Page({ searchParams: Promise.resolve({ flow: "city-frontier", run: RUN_ID }) }));

    expect(presentCityFrontier).toHaveBeenCalledWith(RUN_ID);
    expect(screen.getByText(/Ljubljana/)).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();
  });

  test("retries an ambiguous pre-open Continue with the identical durable command body", async () => {
    const base = cityReadModel({ revisionId: BASE_REVISION_ID });
    const { CityFrontierJourney } = await loadCityFrontierJourney();
    let commandNumber = 0;
    vi.stubGlobal("crypto", { randomUUID: () => `city-continue:command-${++commandNumber}` });
    const fetch = vi.fn<(...args: [RequestInfo | URL, RequestInit?]) => Promise<Response>>(
      async () => { throw new Error("ambiguous_continue_failure"); },
    );
    vi.stubGlobal("fetch", fetch);
    render(<CityFrontierJourney mode={{ kind: "stored", readModel: base } as never} />);

    fireEvent.click(screen.getByRole("button", { name: "Продолжить проверку" }));
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "Повторить проверку" }));
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));

    const expected = JSON.stringify({
      runId: RUN_ID,
      expectedRevisionId: BASE_REVISION_ID,
      commandId: "city-continue:command-1",
    });
    expect(fetch.mock.calls[0]?.[1]?.body).toBe(expected);
    expect(fetch.mock.calls[1]?.[1]?.body).toBe(expected);
  });

  test("retries a pre-commit EOF without requesting reload or changing the continuation command", async () => {
    const base = cityReadModel({ revisionId: BASE_REVISION_ID });
    const { CityFrontierJourney } = await loadCityFrontierJourney();
    const continuation = continuationResponse();
    let commandNumber = 0;
    let attemptNumber = 0;
    vi.stubGlobal("crypto", { randomUUID: () => `city-continue:command-${++commandNumber}` });
    const fetch = vi.fn<(...args: [RequestInfo | URL, RequestInit?]) => Promise<Response>>(
      async () => ++attemptNumber === 1
        ? continuation.response
        : Promise.reject(new Error("retry_transport_failure")),
    );
    vi.stubGlobal("fetch", fetch);
    render(<CityFrontierJourney mode={{ kind: "stored", readModel: base } as never} />);

    fireEvent.click(screen.getByRole("button", { name: "Продолжить проверку" }));
    await vi.waitFor(() => expect(window.location.search)
      .toBe(`?flow=city-frontier&run=${encodeURIComponent(RUN_ID)}`));
    continuation.controller.enqueue(new TextEncoder().encode(`${JSON.stringify({
      type: "city_activated",
      runId: RUN_ID,
      baseRevisionId: BASE_REVISION_ID,
      sequence: 1,
      occurredAt: INSTANT,
      cityId: "ljubljana",
      rank: 1,
    } satisfies CityFrontierEvent)}\n`));
    continuation.controller.close();

    await vi.waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.getByText(`Revision: ${BASE_REVISION_ID}`)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Перезагрузить" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Повторить проверку" }));
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));

    const expected = JSON.stringify({
      runId: RUN_ID,
      expectedRevisionId: BASE_REVISION_ID,
      commandId: "city-continue:command-1",
    });
    expect(fetch.mock.calls[0]?.[1]?.body).toBe(expected);
    expect(fetch.mock.calls[1]?.[1]?.body).toBe(expected);
  });

  test("retains a committed City marker and requires reload when Continue reaches EOF before completion", async () => {
    const base = cityReadModel({ revisionId: BASE_REVISION_ID });
    const successor = cityReadModel({
      revisionId: SUCCESSOR_REVISION_ID,
      withCommittedMarker: true,
    });
    const { normalizeCityFrontierReadModel } = await import(
      "../../src/experience/city-frontier-stream"
    );
    expect(() => normalizeCityFrontierReadModel(base)).not.toThrow();
    expect(() => normalizeCityFrontierReadModel(successor)).not.toThrow();
    const { CityFrontierJourney } = await loadCityFrontierJourney();
    const continuation = continuationResponse();
    const fetch = vi.fn(async () => continuation.response);
    vi.stubGlobal("fetch", fetch);
    const reload = vi.fn();
    render(<CityFrontierJourney mode={{ kind: "stored", readModel: base } as never} onReload={reload} />);

    fireEvent.click(screen.getByRole("button", { name: "Продолжить проверку" }));
    await vi.waitFor(() => expect(window.location.search)
      .toBe(`?flow=city-frontier&run=${encodeURIComponent(RUN_ID)}`));
    const events: readonly CityFrontierEvent[] = [{
      type: "city_activated",
      runId: RUN_ID,
      baseRevisionId: BASE_REVISION_ID,
      sequence: 1,
      occurredAt: INSTANT,
      cityId: "ljubljana",
      rank: 1,
    }, {
      type: "city_revision_committed",
      runId: RUN_ID,
      baseRevisionId: BASE_REVISION_ID,
      sequence: 2,
      occurredAt: INSTANT,
      marker: successor.revision.markers[0]!,
      revision: successor.revision,
    }];
    const encoder = new TextEncoder();
    events.forEach((event) => continuation.controller.enqueue(
      encoder.encode(`${JSON.stringify(event)}\n`),
    ));
    continuation.controller.close();

    await vi.waitFor(() => expect(screen.getByText(/Ljubljana/)).toBeTruthy());
    expect(screen.getByRole("button", { name: "Перезагрузить" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Повторить проверку" })).toBeNull();
    expect(screen.queryByRole("button", { name: /выбрать город/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Перезагрузить" }));
    expect(reload).toHaveBeenCalledOnce();
  });
});
