import { afterEach, describe, expect, test, vi } from "vitest";

import type {
  CityFrontierApplication,
  CityFrontierPrepared,
} from "../../src/application/city-frontier";
import type {
  CityFrontierEvent,
  CityFrontierReadModel,
} from "../../src/application/city-frontier-contracts";
import type { CitySelectionApplication } from "../../src/application/city-selection";

const NOW = "2026-08-27T12:00:00.000Z";

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

const startBody = {
  resolvedCountryShortlistRevisionId: "country-resolution:terminal-1",
  countryCode: "SI",
  criteria,
  commandId: "city-start:1",
} as const;

const continueBody = {
  runId: "city-frontier:run-1",
  expectedRevisionId: "city-frontier-revision:working-1",
  commandId: "city-continue:1",
} as const;

const selectBody = {
  terminalCityShortlistSnapshotId: "city-frontier-revision:terminal-1",
  cityId: "ljubljana",
  commandId: "city-select:1",
} as const;

const committedMarkers = [
  { cityId: "ljubljana", status: "selectable", visualStatus: "green" },
  { cityId: "maribor", status: "selectable", visualStatus: "yellow" },
  { cityId: "celje", status: "excluded", visualStatus: "red" },
] as const;

const workingReadModel = {
  runId: continueBody.runId,
  assessmentAt: NOW,
  revision: {
    id: continueBody.expectedRevisionId,
    kind: "working",
    markers: committedMarkers,
    nextUncheckedRank: 2,
  },
} as unknown as CityFrontierReadModel;

const prepared: CityFrontierPrepared = {
  schemaVersion: "city-frontier-prepared@1",
  runId: continueBody.runId,
  baseRevisionId: continueBody.expectedRevisionId,
  rankingSnapshotId: "city-ranking:run-1",
  nextUncheckedRank: 1,
  commandId: continueBody.commandId,
};

function request(
  route: "start" | "continue" | "select",
  body: unknown,
  signal?: AbortSignal,
): Request {
  return new Request(`http://localhost/api/city-frontier/${route}`, {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: typeof body === "string" ? body : JSON.stringify(body),
    ...(signal === undefined ? {} : { signal }),
  });
}

async function loadPost(
  route: "start" | "continue" | "select",
  application: Partial<CityFrontierApplication & CitySelectionApplication>,
): Promise<(request: Request) => Promise<Response>> {
  vi.resetModules();
  vi.doMock("../../src/infrastructure/composition-root", () => ({
    getConfirmedLifeApplication: () => application,
  }));
  if (route === "start") {
    return (await import("../../src/app/api/city-frontier/start/route")).POST;
  }
  if (route === "continue") {
    return (await import("../../src/app/api/city-frontier/continue/route")).POST;
  }
  return (await import("../../src/app/api/city-frontier/select/route")).POST;
}

function activated(): CityFrontierEvent {
  return {
    type: "city_activated",
    runId: prepared.runId,
    baseRevisionId: prepared.baseRevisionId,
    sequence: 1,
    occurredAt: NOW,
    cityId: "ljubljana",
    rank: 1,
  };
}

function committed(): CityFrontierEvent {
  return {
    type: "city_revision_committed",
    runId: prepared.runId,
    baseRevisionId: prepared.baseRevisionId,
    sequence: 2,
    occurredAt: NOW,
    marker: committedMarkers[0],
    revision: workingReadModel.revision,
  } as unknown as CityFrontierEvent;
}

function completed(readModel: CityFrontierReadModel = workingReadModel): CityFrontierEvent {
  return {
    type: "city_continuation_completed",
    runId: prepared.runId,
    baseRevisionId: prepared.baseRevisionId,
    sequence: 3,
    occurredAt: NOW,
    readModel,
  };
}

function progress(): CityFrontierEvent {
  return {
    type: "city_progress",
    runId: prepared.runId,
    baseRevisionId: prepared.baseRevisionId,
    sequence: 2,
    occurredAt: NOW,
    cityId: "ljubljana",
    stage: "evidence_verified",
  };
}

async function expectProblem(response: Response, status: number, code: string): Promise<void> {
  expect(response.status).toBe(status);
  const body = await response.json() as Record<string, unknown>;
  expect(Object.keys(body).sort()).toEqual(["code", "status", "title"]);
  expect(body).toMatchObject({ code, status });
  expect(typeof body.title).toBe("string");
}

async function expectGenericStreamError(
  response: Response,
  expectedFrames: readonly CityFrontierEvent[],
  original?: Error,
): Promise<void> {
  const reader = response.body?.getReader();
  expect(reader).toBeDefined();
  const chunks: Uint8Array[] = [];
  let caught: unknown;
  try {
    while (true) {
      const result = await reader!.read();
      if (result.done) break;
      chunks.push(result.value);
    }
  } catch (error) {
    caught = error;
  } finally {
    reader?.releaseLock();
  }
  expect(caught).toBeInstanceOf(Error);
  expect(caught).toMatchObject({ message: "internal_error" });
  const retained = new TextDecoder().decode(
    chunks.reduce((all, chunk) => {
      const joined = new Uint8Array(all.length + chunk.length);
      joined.set(all);
      joined.set(chunk, all.length);
      return joined;
    }, new Uint8Array()),
  );
  expect(retained).toBe(expectedFrames.map((event) => `${JSON.stringify(event)}\n`).join(""));
  expect(retained).not.toContain("internal_error");
  if (original !== undefined) {
    expect(caught).not.toBe(original);
    expect(retained).not.toContain(original.message);
  }
}

afterEach(() => {
  vi.doUnmock("../../src/infrastructure/composition-root");
  vi.restoreAllMocks();
});

describe("city-frontier Start and Select HTTP adapters", () => {
  // Break caught: accepting the transport field criteria as an application-owned criteriaDraft,
  // or changing committed green/yellow/red marker data before it reaches the client.
  test("returns the exact no-store Start read model and renames only criteria", async () => {
    const startCityFrontier = vi.fn(async () => workingReadModel);
    const POST = await loadPost("start", { startCityFrontier });

    const response = await POST(request("start", startBody));

    expect(response.status).toBe(200);
    expect(Object.fromEntries(response.headers.entries())).toEqual({
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
    });
    expect(await response.json()).toEqual(workingReadModel);
    expect(startCityFrontier).toHaveBeenCalledWith({
      resolvedCountryShortlistRevisionId: "country-resolution:terminal-1",
      countryCode: "SI",
      criteriaDraft: [
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
      ],
      commandId: "city-start:1",
    });
  });

  // Break caught: accepting missing, unknown, client-authoritative, or non-four-criterion command fields.
  test.each([
    ["missing command", { ...startBody, commandId: undefined }],
    ["unknown authority", { ...startBody, runId: "client-owned-run" }],
    ["extra field", { ...startBody, extra: true }],
    ["three criteria", { ...startBody, criteria: criteria.slice(0, 3) }],
    ["fifth criterion", { ...startBody, criteria: [...criteria, criteria[0]] }],
    ["duplicate criterion and missing criterion", {
      ...startBody,
      criteria: [criteria[0], criteria[0], criteria[2], criteria[3]],
    }],
    ["open criterion", {
      ...startBody,
      criteria: [{ ...criteria[0], clientFact: "forged" }, ...criteria.slice(1)],
    }],
  ] as const)("rejects Start %s before calling the application", async (_name, body) => {
    const startCityFrontier = vi.fn();
    const POST = await loadPost("start", { startCityFrontier });

    const response = await POST(request("start", body));

    expect(response.status).toBe(400);
    await expectProblem(response, 400, "invalid_input");
    expect(startCityFrontier).not.toHaveBeenCalled();
  });

  // Break caught: invoking any route capability before rejecting a wrong media type or malformed JSON.
  test.each([
    ["start", startBody, "startCityFrontier"],
    ["continue", continueBody, "prepareCityFrontierContinuation"],
    ["select", selectBody, "selectCity"],
  ] as const)("rejects %s media type and malformed JSON before application work", async (
    route,
    body,
    method,
  ) => {
    const command = vi.fn();
    const POST = await loadPost(route, { [method]: command });

    const unsupported = await POST(new Request(`http://localhost/api/city-frontier/${route}`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "x=1",
    }));
    await expectProblem(unsupported, 415, "unsupported_media_type");

    const malformed = await POST(request(route, "{"));
    await expectProblem(malformed, 400, "invalid_json");
    expect(command).not.toHaveBeenCalled();
    void body;
  });

  // Break caught: accepting an open Select command or silently accepting a yellow-risk version other
  // than the one bound by the application.
  test.each([
    ["missing city", { ...selectBody, cityId: undefined }],
    ["extra", { ...selectBody, selection: { cityId: "forged" } }],
    ["wrong warning", { ...selectBody, warningCopyVersion: "city-unknown-risk@2" }],
  ] as const)("rejects Select %s before calling the application", async (_name, body) => {
    const selectCity = vi.fn();
    const POST = await loadPost("select", { selectCity });

    const response = await POST(request("select", body));

    await expectProblem(response, 400, "invalid_input");
    expect(selectCity).not.toHaveBeenCalled();
  });

  // Break caught: losing the optional yellow acknowledgement, the selection/commit pair, or no-store
  // response policy while adapting Select.
  test("returns the exact no-store Select result", async () => {
    const result = {
      selection: { id: "city-selection:1", cityId: "maribor" },
      commit: { id: "city-branch-commit:1" },
      readModel: workingReadModel,
    } as unknown as Awaited<ReturnType<CitySelectionApplication["selectCity"]>>;
    const selectCity = vi.fn(async () => result);
    const POST = await loadPost("select", { selectCity });

    const response = await POST(request("select", {
      ...selectBody,
      cityId: "maribor",
      warningCopyVersion: "city-unknown-risk@1",
    }));

    expect(response.status).toBe(200);
    expect(Object.fromEntries(response.headers.entries())).toEqual({
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
    });
    expect(await response.json()).toEqual(result);
    expect(selectCity).toHaveBeenCalledWith({
      terminalCityShortlistSnapshotId: "city-frontier-revision:terminal-1",
      cityId: "maribor",
      commandId: "city-select:1",
      warningCopyVersion: "city-unknown-risk@1",
    });
  });

  // Break caught: inventing a warning acknowledgement when the public Select request omits it.
  test("preserves an omitted Select warningCopyVersion", async () => {
    const result = {
      selection: { id: "city-selection:1" },
      commit: { id: "city-branch-commit:1" },
      readModel: workingReadModel,
    } as unknown as Awaited<ReturnType<CitySelectionApplication["selectCity"]>>;
    const selectCity = vi.fn(async () => result);
    const POST = await loadPost("select", { selectCity });

    const response = await POST(request("select", selectBody));

    expect(response.status).toBe(200);
    expect(selectCity).toHaveBeenCalledWith({
      terminalCityShortlistSnapshotId: "city-frontier-revision:terminal-1",
      cityId: "ljubljana",
      commandId: "city-select:1",
    });
  });

  // Break caught: losing the narrow Start error classification or leaking provider/database/integrity
  // text through a public problem response.
  test.each([
    ["resolution_not_found", 404, "resolution_not_found"],
    ["city_package_not_ready", 409, "city_package_not_ready"],
    ["city_package_not_installed", 409, "city_package_not_installed"],
    ["city_catalog_upgrade_required", 409, "city_catalog_upgrade_required"],
    ["provider token=secret sqlite=/private/db", 500, "internal_error"],
    ["integrity_mismatch", 500, "internal_error"],
  ] as const)("maps Start failure %s to a safe problem", async (message, status, code) => {
    const startCityFrontier = vi.fn(async () => { throw new Error(message); });
    const POST = await loadPost("start", { startCityFrontier });

    const response = await POST(request("start", startBody));
    const text = await response.text();

    expect(response.status).toBe(status);
    const problem = JSON.parse(text) as Record<string, unknown>;
    expect(Object.keys(problem).sort()).toEqual(["code", "status", "title"]);
    expect(problem).toMatchObject({ code, status });
    if (status === 500) expect(text).not.toContain(message);
  });

  // Break caught: returning a successful Select result for missing selection authority or exposing
  // internal selection/integrity details.
  test.each([
    ["city_frontier_not_found", 404, "city_frontier_not_found"],
    ["city_selection_not_found", 404, "city_selection_not_found"],
    ["city_catalog_upgrade_required", 409, "city_catalog_upgrade_required"],
    ["integrity_mismatch", 500, "internal_error"],
    ["provider token=secret", 500, "internal_error"],
  ] as const)("maps Select failure %s to a safe problem", async (message, status, code) => {
    const selectCity = vi.fn(async () => { throw new Error(message); });
    const POST = await loadPost("select", { selectCity });

    const response = await POST(request("select", selectBody));
    const text = await response.text();

    expect(response.status).toBe(status);
    const problem = JSON.parse(text) as Record<string, unknown>;
    expect(Object.keys(problem).sort()).toEqual(["code", "status", "title"]);
    expect(problem).toMatchObject({ code, status });
    if (status === 500) expect(text).not.toContain(message);
  });
});

describe("city-frontier Continue HTTP adapter", () => {
  // Break caught: starting source work before Prepare succeeds, creating a blocking response, or
  // returning headers that do not bind the requested run and base revision.
  test("prepares before constructing a nonblocking LF-framed working continuation", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let preparedFirst = false;
    const events = [activated(), committed(), completed()];
    const application = {
      prepareCityFrontierContinuation: vi.fn(async () => {
        preparedFirst = true;
        return prepared;
      }),
      continueCityFrontier: vi.fn(async (_prepared, emit) => {
        expect(preparedFirst).toBe(true);
        await gate;
        await emit(events[0]!);
        await emit(events[1]!);
        await emit(events[2]!);
        return workingReadModel;
      }),
    };
    const POST = await loadPost("continue", application);

    const responseOrTimeout = await Promise.race([
      POST(request("continue", continueBody)),
      new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 100)),
    ]);

    expect(responseOrTimeout).not.toBe("timeout");
    const response = responseOrTimeout as Response;
    expect(application.prepareCityFrontierContinuation).toHaveBeenCalledWith(continueBody);
    expect(application.continueCityFrontier).toHaveBeenCalledOnce();
    expect(Object.fromEntries(response.headers.entries())).toEqual({
      "cache-control": "no-store, no-transform",
      "content-type": "application/x-ndjson; charset=utf-8",
      "x-content-type-options": "nosniff",
      "x-life-base-revision-id": continueBody.expectedRevisionId,
      "x-life-run-id": continueBody.runId,
    });

    release?.();
    const text = await response.text();
    expect(text).toBe(events.map((event) => `${JSON.stringify(event)}\n`).join(""));
    const frames = text.trimEnd().split("\n").map((line) => JSON.parse(line) as CityFrontierEvent);
    expect(frames.map((frame) => frame.type)).toEqual([
      "city_activated",
      "city_revision_committed",
      "city_continuation_completed",
    ]);
    expect(frames.findIndex(({ type }) => type === "city_revision_committed"))
      .toBeLessThan(frames.findIndex(({ type }) => type === "city_continuation_completed"));
    const completion = frames.at(-1)! as Extract<CityFrontierEvent, {
      readonly type: "city_continuation_completed";
    }>;
    expect(completion.readModel.revision.kind).toBe("working");
  });

  // Break caught: rejecting semantically identical callback/return models merely because their object
  // fields were serialized in a different order.
  test("accepts canonically equal callback and return read models", async () => {
    const canonicalEqualReturn = {
      revision: {
        nextUncheckedRank: 2,
        markers: committedMarkers,
        kind: "working",
        id: continueBody.expectedRevisionId,
      },
      runId: continueBody.runId,
      assessmentAt: NOW,
    } as unknown as CityFrontierReadModel;
    const events = [activated(), committed(), completed()];
    const application = {
      prepareCityFrontierContinuation: async () => prepared,
      continueCityFrontier: async (
        _prepared: CityFrontierPrepared,
        emit: (event: CityFrontierEvent) => Promise<void>,
      ) => {
        for (const event of events) await emit(event);
        return canonicalEqualReturn;
      },
    };
    const POST = await loadPost("continue", application);

    const response = await POST(request("continue", continueBody));

    expect(await response.text()).toBe(events.map((event) => `${JSON.stringify(event)}\n`).join(""));
  });

  // Break caught: accepting a stream that omits, duplicates, reorders, or contradicts its sole
  // completion frame.
  test.each([
    ["missing completion", [activated(), committed()], workingReadModel, [activated(), committed()]],
    ["duplicate completion", [activated(), committed(), completed(), completed()], workingReadModel,
      [activated(), committed(), completed()]],
    ["completion before commit", [activated(), completed(), committed()], workingReadModel,
      [activated()]],
    ["return mismatch", [activated(), committed(), completed()], {
      ...workingReadModel,
      assessmentAt: "2026-08-27T13:00:00.000Z",
    } as CityFrontierReadModel, [activated(), committed(), completed()]],
  ] as const)("fails Continue with a generic stream error on %s", async (
    _name,
    events,
    returned,
    expectedFrames,
  ) => {
    const application = {
      prepareCityFrontierContinuation: async () => prepared,
      continueCityFrontier: async (_prepared: CityFrontierPrepared, emit: (event: CityFrontierEvent) => Promise<void>) => {
        for (const event of events) await emit(event);
        return returned;
      },
    };
    const POST = await loadPost("continue", application);

    const response = await POST(request("continue", continueBody));

    await expectGenericStreamError(response, expectedFrames);
  });

  // Break caught: serializing incomplete/open CityFrontierEvent envelopes instead of rejecting them
  // before transport state changes or NDJSON enqueue.
  test.each([
    ["activated missing rank", [{ ...activated(), rank: undefined }], []],
    ["activated extra field", [{ ...activated(), injected: true }], []],
    ["progress missing stage", [activated(), { ...progress(), stage: undefined }], [activated()]],
    ["progress completed source missing URL", [activated(), {
      ...progress(), stage: "source_completed:si-city-long-term-rent",
    }], [activated()]],
    ["progress non-completed source has URL", [activated(), {
      ...progress(), sourceUrl: "https://official.test/unexpected",
    }], [activated()]],
    ["progress extra field", [activated(), { ...progress(), injected: true }], [activated()]],
    ["committed missing marker", [activated(), { ...committed(), marker: undefined }], [activated()]],
    ["committed non-record revision", [activated(), { ...committed(), revision: [] }], [activated()]],
    ["committed extra field", [activated(), { ...committed(), injected: true }], [activated()]],
    ["completed missing read model", [activated(), committed(), { ...completed(), readModel: undefined }],
      [activated(), committed()]],
    ["completed non-record read model", [activated(), committed(), { ...completed(), readModel: [] }],
      [activated(), committed()]],
    ["completed extra field", [activated(), committed(), { ...completed(), injected: true }],
      [activated(), committed()]],
  ] as const)("rejects malformed %s before serializing it", async (_name, rawEvents, expectedFrames) => {
    const application = {
      prepareCityFrontierContinuation: async () => prepared,
      continueCityFrontier: async (
        _prepared: CityFrontierPrepared,
        emit: (event: CityFrontierEvent) => Promise<void>,
      ) => {
        for (const event of rawEvents) await emit(event as CityFrontierEvent);
        return workingReadModel;
      },
    };
    const POST = await loadPost("continue", application);

    const response = await POST(request("continue", continueBody));

    await expectGenericStreamError(response, expectedFrames);
  });

  // Break caught: passing unexpected application/provider text through the NDJSON body error rather
  // than replacing it with a fresh generic transport failure.
  test("replaces an unexpected continuation failure with a generic stream error", async () => {
    const providerError = new Error("provider token=secret sqlite=/private/db");
    const application = {
      prepareCityFrontierContinuation: async () => prepared,
      continueCityFrontier: async () => { throw providerError; },
    };
    const POST = await loadPost("continue", application);

    const response = await POST(request("continue", continueBody));

    await expectGenericStreamError(response, [], providerError);
  });

  // Break caught: allowing incomplete or open Continue input to reach preparation or source work.
  test.each([
    ["missing command", { ...continueBody, commandId: undefined }],
    ["missing run", { ...continueBody, runId: undefined }],
    ["missing expected revision", { ...continueBody, expectedRevisionId: undefined }],
    ["extra authority", { ...continueBody, rankingSnapshotId: "client-owned" }],
  ] as const)("rejects Continue %s before preparation", async (_name, body) => {
    const prepareCityFrontierContinuation = vi.fn();
    const continueCityFrontier = vi.fn();
    const POST = await loadPost("continue", {
      prepareCityFrontierContinuation,
      continueCityFrontier,
    });

    const response = await POST(request("continue", body));

    await expectProblem(response, 400, "invalid_input");
    expect(prepareCityFrontierContinuation).not.toHaveBeenCalled();
    expect(continueCityFrontier).not.toHaveBeenCalled();
  });

  // Break caught: trusting unsafe or changed prepared identifiers when constructing public headers or
  // beginning a continuation.
  test.each([
    ["unsafe run", { ...prepared, runId: "bad\nrun" }],
    ["mismatched run", { ...prepared, runId: "city-frontier:other-run" }],
    ["unsafe base", { ...prepared, baseRevisionId: "bad\nrevision" }],
    ["mismatched base", { ...prepared, baseRevisionId: "city-frontier-revision:other" }],
  ] as const)("rejects prepared %s before starting the stream", async (_name, invalidPrepared) => {
    const continueCityFrontier = vi.fn();
    const application = {
      prepareCityFrontierContinuation: vi.fn(async () => invalidPrepared),
      continueCityFrontier,
    };
    const POST = await loadPost("continue", application);

    const response = await POST(request("continue", continueBody));
    const text = await response.text();

    expect(response.status).toBe(500);
    const problem = JSON.parse(text) as Record<string, unknown>;
    expect(Object.keys(problem).sort()).toEqual(["code", "status", "title"]);
    expect(problem).toMatchObject({ code: "internal_error", status: 500 });
    expect(text).not.toContain(invalidPrepared.runId);
    expect(text).not.toContain(invalidPrepared.baseRevisionId);
    expect(continueCityFrontier).not.toHaveBeenCalled();
  });

  // Break caught: reading borrowed Prepared accessors while publishing headers or passing the
  // mutable object onward, so preparation identity can change after its first validation.
  test("rejects accessor-backed Prepared values without reading their live identity", async () => {
    let runIdReads = 0;
    const accessorPrepared = { ...prepared } as Record<string, unknown>;
    Object.defineProperty(accessorPrepared, "runId", {
      enumerable: true,
      get: () => {
        runIdReads += 1;
        return prepared.runId;
      },
    });
    const continueCityFrontier = vi.fn();
    const POST = await loadPost("continue", {
      prepareCityFrontierContinuation: async () => accessorPrepared as unknown as CityFrontierPrepared,
      continueCityFrontier,
    });

    const response = await POST(request("continue", continueBody));

    await expectProblem(response, 500, "internal_error");
    expect(runIdReads).toBe(0);
    expect(continueCityFrontier).not.toHaveBeenCalled();
  });

  // Break caught: retaining a borrowed Prepared reference after validating it, allowing a caller
  // to change the continuation identity before event binding or application invocation.
  test("continues from an owned immutable Prepared snapshot", async () => {
    const mutablePrepared = { ...prepared };
    const events = [activated(), committed(), completed()];
    const application = {
      prepareCityFrontierContinuation: async () => mutablePrepared,
      continueCityFrontier: async (
        received: CityFrontierPrepared,
        emit: (event: CityFrontierEvent) => Promise<void>,
      ) => {
        expect(received).not.toBe(mutablePrepared);
        expect(Object.isFrozen(received)).toBe(true);
        expect(received).toEqual(prepared);
        mutablePrepared.runId = "city-frontier:drifted";
        for (const event of events) await emit(event);
        return workingReadModel;
      },
    };
    const POST = await loadPost("continue", application);

    const response = await POST(request("continue", continueBody));

    expect(await response.text()).toBe(events.map((event) => `${JSON.stringify(event)}\n`).join(""));
  });

  // Break caught: updating committed/completion transport state before an event is actually
  // serializable and queued, which permits a caught emitter failure to recover with completion.
  test("latches a failed cyclic committed publication before completion can be emitted", async () => {
    const cyclicRevision: Record<string, unknown> = {};
    cyclicRevision.self = cyclicRevision;
    const cyclicCommitted = {
      ...committed(),
      revision: cyclicRevision,
    } as unknown as CityFrontierEvent;
    const application = {
      prepareCityFrontierContinuation: async () => prepared,
      continueCityFrontier: async (
        _prepared: CityFrontierPrepared,
        emit: (event: CityFrontierEvent) => Promise<void>,
      ) => {
        let emitterFailures = 0;
        try {
          await emit(cyclicCommitted);
        } catch {
          emitterFailures += 1;
        }
        try {
          await emit(completed());
        } catch {
          emitterFailures += 1;
        }
        expect(emitterFailures).toBe(2);
        return workingReadModel;
      },
    };
    const POST = await loadPost("continue", application);

    const response = await POST(request("continue", continueBody));

    await expectGenericStreamError(response, []);
  });

  // Break caught: passing separate or unlinked abort signals to the application, or retaining the
  // request abort listener after the stream ends or its body is cancelled.
  test("links request abort and body cancellation once, then cleans up", async () => {
    const observedSignals: AbortSignal[] = [];
    const emitters: Array<(event: CityFrontierEvent) => Promise<void>> = [];
    const application = {
      prepareCityFrontierContinuation: async () => prepared,
      continueCityFrontier: async (
        _prepared: CityFrontierPrepared,
        emit: (event: CityFrontierEvent) => Promise<void>,
        signal: AbortSignal,
      ) => {
        observedSignals.push(signal);
        emitters.push(emit);
        return await new Promise<never>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        });
      },
    };
    const POST = await loadPost("continue", application);

    const requestController = new AbortController();
    const requestRequest = request("continue", continueBody, requestController.signal);
    const requestAdd = vi.spyOn(requestRequest.signal, "addEventListener");
    const requestRemove = vi.spyOn(requestRequest.signal, "removeEventListener");
    const requestResponse = await POST(requestRequest);
    const requestReason = new Error("request_disconnected");
    requestController.abort(requestReason);
    expect(observedSignals[0]?.reason).toBe(requestReason);
    expect(requestAdd).toHaveBeenCalledOnce();
    await expect(emitters[0]!(activated())).rejects.toBe(requestReason);
    await expect(requestResponse.text()).rejects.toBe(requestReason);
    expect(requestRemove).toHaveBeenCalledOnce();

    const cancelRequest = request("continue", continueBody);
    const cancelAdd = vi.spyOn(cancelRequest.signal, "addEventListener");
    const cancelRemove = vi.spyOn(cancelRequest.signal, "removeEventListener");
    const cancelResponse = await POST(cancelRequest);
    const cancelReason = new Error("reader_cancelled");
    await cancelResponse.body?.cancel(cancelReason);
    expect(observedSignals[1]?.reason).toBe(cancelReason);
    await expect(emitters[1]!(activated())).rejects.toBe(cancelReason);
    expect(cancelAdd).toHaveBeenCalledOnce();
    expect(cancelRemove).toHaveBeenCalledOnce();

    const nullRequestController = new AbortController();
    const nullRequest = request("continue", continueBody, nullRequestController.signal);
    const nullResponse = await POST(nullRequest);
    nullRequestController.abort(null);
    expect(observedSignals[2]?.reason).toBeNull();
    await expect(emitters[2]!(activated())).rejects.toBeNull();
    await expect(nullResponse.text()).rejects.toBeNull();
  });

  // Break caught: leaving the request abort listener installed after a normal finite stream ends.
  test("removes the request abort listener after normal completion", async () => {
    const events = [activated(), committed(), completed()];
    const application = {
      prepareCityFrontierContinuation: async () => prepared,
      continueCityFrontier: async (
        _prepared: CityFrontierPrepared,
        emit: (event: CityFrontierEvent) => Promise<void>,
      ) => {
        for (const event of events) await emit(event);
        return workingReadModel;
      },
    };
    const POST = await loadPost("continue", application);
    const normalRequest = request("continue", continueBody);
    const add = vi.spyOn(normalRequest.signal, "addEventListener");
    const remove = vi.spyOn(normalRequest.signal, "removeEventListener");

    const response = await POST(normalRequest);
    await response.text();

    expect(add).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledOnce();
  });

  // Break caught: exposing pre-stream provider/internal error text, or starting a body after a failed
  // Prepare call instead of returning a safe 404/409/500 problem response.
  test.each([
    ["city_frontier_not_found", 404, "city_frontier_not_found"],
    ["stale_city_frontier_head", 409, "stale_city_frontier_head"],
    ["provider token=secret", 500, "internal_error"],
  ] as const)("maps Continue prepare failure %s before opening a stream", async (message, status, code) => {
    const continueCityFrontier = vi.fn();
    const application = {
      prepareCityFrontierContinuation: vi.fn(async () => { throw new Error(message); }),
      continueCityFrontier,
    };
    const POST = await loadPost("continue", application);

    const response = await POST(request("continue", continueBody));
    const text = await response.text();

    expect(response.status).toBe(status);
    const problem = JSON.parse(text) as Record<string, unknown>;
    expect(Object.keys(problem).sort()).toEqual(["code", "status", "title"]);
    expect(problem).toMatchObject({ code, status });
    expect(response.headers.get("content-type")).toBe("application/problem+json; charset=utf-8");
    expect(continueCityFrontier).not.toHaveBeenCalled();
    if (status === 500) expect(text).not.toContain(message);
  });
});
