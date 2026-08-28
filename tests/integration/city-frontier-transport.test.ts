import { afterEach, describe, expect, test, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

import type {
  CityFrontierApplication,
  CityFrontierPrepared,
} from "../../src/application/city-frontier";
import type {
  CityFrontierEvent,
  CityFrontierReadModel,
} from "../../src/application/city-frontier-contracts";
import type { CitySelectionApplication } from "../../src/application/city-selection";

const TEST_DIRECTORY = dirname(fileURLToPath(import.meta.url));

async function loadCityFrontierStreamModule() {
  return import("../../src/experience/city-frontier-stream");
}

async function loadCityFrontierViewModelModule() {
  return import("../../src/experience/city-frontier-view-model");
}

describe("city-frontier browser dependency boundary", () => {
  // Break caught: adding a browser runtime edge to inward policy/authority or Node-only modules
  // instead of keeping Application contracts type-only and browser delivery self-contained.
  test("City Experience modules have only browser-safe runtime imports", () => {
    const entryFiles = [
      "../../src/experience/city-frontier-stream.ts",
      "../../src/experience/city-frontier-view-model.ts",
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
        if (!ts.isImportDeclaration(statement) ||
          !ts.isStringLiteral(statement.moduleSpecifier)) continue;
        const specifier = statement.moduleSpecifier.text;
        const isForbidden = specifier.startsWith("../application") ||
          specifier.startsWith("../decision") ||
          specifier.startsWith("../infrastructure") ||
          specifier.startsWith("../branch") ||
          specifier.startsWith("../research") ||
          specifier === "crypto" || specifier.startsWith("node:");
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
});

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

const BROWSER_RUN_ID = `city-frontier:${"1".repeat(64)}`;
const BROWSER_BASE_REVISION_ID = `city-frontier-revision:${"2".repeat(64)}`;
const BROWSER_WORKING_REVISION_ID = `city-frontier-revision:${"3".repeat(64)}`;
const BROWSER_RANKING_ID = `city-ranking:${"4".repeat(64)}`;
const BROWSER_CRITERIA_ID = `city-criteria:${"5".repeat(64)}`;
const BROWSER_REGISTRY_ID = `city-registry:${"6".repeat(64)}`;
const BROWSER_CATALOG_ID = `city-catalog:${"7".repeat(64)}`;

const browserFactors = [
  {
    criterionId: "safety",
    definitionId: "si-municipal-police-offences-per-100000@1",
    mode: "required",
    importance: 5,
    evaluatorVersion: "si-municipal-safety-linear@1",
    freshnessPolicyVersion: "municipal-annual-july-boundary@1",
    state: "unknown",
    factor: "0",
    weightedContribution: "0",
    targetComparison: "unknown",
    requiredMismatch: false,
    unknownReason: "no_knowledge_revision",
  },
  {
    criterionId: "long_term_rent",
    definitionId: "rent@1",
    mode: "weighted",
    importance: 4,
    evaluatorVersion: "rent-evaluator@1",
    freshnessPolicyVersion: "annual@1",
    state: "unknown",
    factor: "0",
    weightedContribution: "0",
    targetComparison: "unknown",
    requiredMismatch: false,
    unknownReason: "no_knowledge_revision",
  },
  {
    criterionId: "urban_transit",
    definitionId: "transit@1",
    mode: "weighted",
    importance: 3,
    evaluatorVersion: "transit-evaluator@1",
    freshnessPolicyVersion: "annual@1",
    state: "unknown",
    factor: "0",
    weightedContribution: "0",
    targetComparison: "unknown",
    requiredMismatch: false,
    unknownReason: "no_knowledge_revision",
  },
  {
    criterionId: "fixed_broadband",
    definitionId: "broadband@1",
    mode: "weighted",
    importance: 2,
    evaluatorVersion: "broadband-evaluator@1",
    freshnessPolicyVersion: "annual@1",
    state: "unknown",
    factor: "0",
    weightedContribution: "0",
    targetComparison: "unknown",
    requiredMismatch: false,
    unknownReason: "no_knowledge_revision",
  },
] as const;

const browserMarker = {
  cityId: "ljubljana",
  rank: 1,
  status: "selectable",
  visualStatus: "green",
  knowledgeRevisionId: "city-knowledge:ljubljana@1",
  evidenceSnapshotId: "city-evidence:ljubljana@1",
  lastCheckedAt: "2026-08-27T00:00:00.000Z",
  requiredMismatches: [],
  unknownBasis: [],
  verificationCoverage: "1",
  facts: [
    {
      criterionId: "safety",
      definitionId: "si-municipal-police-offences-per-100000@1",
      geoScope: "municipality",
      referencePeriod: "2025",
      freshnessBasis: "municipal-annual-july-boundary@1",
      unit: "offences_per_100000_residents",
      denominator: "municipality_population_january_1",
      outcome: {
        kind: "verified",
        basis: {
          kind: "municipal_safety",
          quantity: {
            offenceCount: "1200",
            population: "300000",
            rateBasis: "offences_per_100000_residents",
          },
        },
      },
      evidenceLinks: [{
        sourceId: "si-city-safety",
        disposition: "accepted",
        navigationUrl: "https://www.policija.si/statistika/ljubljana",
        resolvedEvidenceUrl: "https://www.policija.si/statistika/ljubljana-2025.pdf",
        referenceYear: 2025,
      }],
      manualCheckLinks: [],
    },
    {
      criterionId: "long_term_rent",
      definitionId: "rent@1",
      geoScope: "municipality",
      referencePeriod: "2025",
      freshnessBasis: "annual@1",
      unit: "eur_per_month",
      denominator: "dwelling",
      outcome: { kind: "verified", basis: { kind: "canonical_scalar", value: "850" } },
      evidenceLinks: [{
        sourceId: "si-city-long-term-rent",
        disposition: "accepted",
        navigationUrl: "https://www.stat.si/rent/ljubljana",
        resolvedEvidenceUrl: "https://www.stat.si/rent/ljubljana.csv",
      }],
      manualCheckLinks: [],
    },
    {
      criterionId: "urban_transit",
      definitionId: "transit@1",
      geoScope: "municipality",
      referencePeriod: "2025",
      freshnessBasis: "annual@1",
      unit: "coverage_ratio",
      denominator: "urban_area",
      outcome: { kind: "verified", basis: { kind: "canonical_scalar", value: "0.8" } },
      evidenceLinks: [{
        sourceId: "si-city-urban-transit",
        disposition: "accepted",
        navigationUrl: "https://www.ljubljana.si/transit",
        resolvedEvidenceUrl: "https://www.ljubljana.si/transit/report-2025.pdf",
      }],
      manualCheckLinks: [],
    },
    {
      criterionId: "fixed_broadband",
      definitionId: "broadband@1",
      geoScope: "municipality",
      referencePeriod: "2025",
      freshnessBasis: "annual@1",
      unit: "mbps",
      denominator: "household",
      outcome: { kind: "verified", basis: { kind: "canonical_scalar", value: "150" } },
      evidenceLinks: [{
        sourceId: "si-city-fixed-broadband",
        disposition: "accepted",
        navigationUrl: "https://www.akos-rs.si/broadband/ljubljana",
        resolvedEvidenceUrl: "https://www.akos-rs.si/broadband/ljubljana.csv",
      }],
      manualCheckLinks: [],
    },
  ],
} as const satisfies CityFrontierReadModel["revision"]["markers"][number];

const browserReadModelEnvelope = {
  runId: BROWSER_RUN_ID,
  assessmentAt: "2026-08-27T00:00:00.000Z",
  resolvedCountryShortlistRevisionId: "country-resolution:terminal-1",
  countryCode: "SI",
  preCityBranchCommitId: `pre-city-branch:${"8".repeat(64)}`,
  registry: {
    schemaVersion: "city-registry@1",
    id: BROWSER_REGISTRY_ID,
    packageId: "slovenia-city",
    packageSchemaVersion: "slovenia-city@1",
    countryCode: "SI",
    evidenceSnapshotId: "city-catalog-evidence:si@1",
    entries: [
      {
        cityId: "ljubljana",
        countryCode: "SI",
        officialName: "Ljubljana",
        coordinate: { lat: 46.0569, lng: 14.5058 },
        administrativeType: "municipality",
        administrativeTerritory: "Ljubljana",
        capitalRoles: ["national"],
        evidenceReferenceIds: ["official-register:ljubljana"],
      },
      {
        cityId: "maribor",
        countryCode: "SI",
        officialName: "Maribor",
        coordinate: { lat: 46.5547, lng: 15.6459 },
        administrativeType: "municipality",
        administrativeTerritory: "Maribor",
        capitalRoles: [],
        evidenceReferenceIds: ["official-register:maribor"],
      },
    ],
    createdAt: "2026-08-26T00:00:00.000Z",
  },
  catalog: {
    schemaVersion: "city-catalog@1",
    id: BROWSER_CATALOG_ID,
    packageId: "slovenia-city",
    packageSchemaVersion: "slovenia-city@1",
    countryCode: "SI",
    registryRevisionId: BROWSER_REGISTRY_ID,
    evidenceSnapshotId: "city-catalog-evidence:si@1",
    populationDefinition: {
      definitionId: "municipal-population@1",
      geoScope: "municipality",
      unit: "people",
    },
    candidateBasis: [
      {
        cityId: "ljubljana",
        comparablePopulation: { kind: "verified", value: "300000", referencePeriod: "2025" },
      },
      {
        cityId: "maribor",
        comparablePopulation: { kind: "verified", value: "110000", referencePeriod: "2025" },
      },
    ],
    members: [
      { cityId: "ljubljana", inclusionReasons: ["national_capital"] },
      { cityId: "maribor", inclusionReasons: ["population_fill"] },
    ],
    coverage: { status: "complete" },
    rulesVersion: "city-catalog@2",
    createdAt: "2026-08-26T00:00:00.000Z",
  },
  criteria: {
    schemaVersion: "city-criteria@1",
    id: BROWSER_CRITERIA_ID,
    profileSnapshotId: "profile:confirmed-1",
    preferenceProfileSnapshotId: "preferences:confirmed-1",
    criteria,
    rulesVersion: "city-criteria@1",
    confirmedAt: "2026-08-27T00:00:00.000Z",
  },
  ranking: {
    schemaVersion: "city-ranking@1",
    id: BROWSER_RANKING_ID,
    runId: BROWSER_RUN_ID,
    resolvedCountryShortlistRevisionId: "country-resolution:terminal-1",
    countryCode: "SI",
    packageId: "slovenia-city",
    packageSchemaVersion: "slovenia-city@1",
    preCityBranchCommitId: `pre-city-branch:${"8".repeat(64)}`,
    profileSnapshotId: "profile:confirmed-1",
    preferenceProfileSnapshotId: "preferences:confirmed-1",
    registryRevisionId: BROWSER_REGISTRY_ID,
    catalogRevisionId: BROWSER_CATALOG_ID,
    installedPackageContext: {
      countryCode: "SI",
      packageId: "slovenia-city",
      packageSchemaVersion: "slovenia-city@1",
      catalogRevisionId: BROWSER_CATALOG_ID,
      evidenceRulesVersion: "city-evidence@1",
    },
    criteriaSnapshotId: BROWSER_CRITERIA_ID,
    assessmentAt: "2026-08-27T00:00:00.000Z",
    knowledgeRevisionIds: { ljubljana: null, maribor: null },
    ordered: [
      {
        cityId: "ljubljana",
        rank: 1,
        score: "0",
        coverage: "0",
        knowledgeRevisionId: null,
        factors: browserFactors,
      },
      {
        cityId: "maribor",
        rank: 2,
        score: "0",
        coverage: "0",
        knowledgeRevisionId: null,
        factors: browserFactors,
      },
    ],
    screenedExclusions: [],
    rulesVersion: "city-ranker@1",
    verificationBudget: {
      liveCityCandidateLimit: 10,
      targetSelectableCities: 3,
      rulesVersion: "city-frontier-budget@1",
    },
    createdAt: "2026-08-27T00:00:00.000Z",
  },
  selections: [],
} as const;

const browserBaseReadModel = {
  ...browserReadModelEnvelope,
  revision: {
    schemaVersion: "city-frontier@1",
    kind: "working",
    id: BROWSER_BASE_REVISION_ID,
    runId: BROWSER_RUN_ID,
    rankingSnapshotId: BROWSER_RANKING_ID,
    markers: [],
    nextUncheckedRank: 1,
    phase: "verification_required",
    operation: {
      kind: "start",
      commandId: "city-start:browser-1",
      criteriaPayloadHash: "9".repeat(64),
    },
    createdAt: "2026-08-27T00:00:00.000Z",
  },
} as const satisfies CityFrontierReadModel;

const browserWorkingReadModel = {
  ...browserReadModelEnvelope,
  revision: {
    schemaVersion: "city-frontier@1",
    kind: "working",
    id: BROWSER_WORKING_REVISION_ID,
    runId: BROWSER_RUN_ID,
    predecessorRevisionId: BROWSER_BASE_REVISION_ID,
    rankingSnapshotId: BROWSER_RANKING_ID,
    markers: [browserMarker],
    nextUncheckedRank: 2,
    phase: "verification_required",
    operation: {
      kind: "city_completed",
      commandId: "city-continue:browser-1",
      expectedHeadRevisionId: BROWSER_BASE_REVISION_ID,
      cityId: "ljubljana",
      cityCheckRunId: `city-check:${"a".repeat(64)}`,
    },
    createdAt: "2026-08-27T12:00:00.000Z",
  },
} as const satisfies CityFrontierReadModel;

function browserWireLines(): readonly string[] {
  const rawEvents: readonly unknown[] = [
    {
      type: "city_activated",
      runId: BROWSER_RUN_ID,
      baseRevisionId: BROWSER_BASE_REVISION_ID,
      sequence: 1,
      occurredAt: "2026-08-27T12:00:00.000Z",
      cityId: "ljubljana",
      rank: 1,
    },
    {
      type: "city_revision_committed",
      runId: BROWSER_RUN_ID,
      baseRevisionId: BROWSER_BASE_REVISION_ID,
      sequence: 2,
      occurredAt: "2026-08-27T12:00:00.000Z",
      marker: browserMarker,
      revision: browserWorkingReadModel.revision,
    },
    {
      type: "city_continuation_completed",
      runId: BROWSER_RUN_ID,
      baseRevisionId: BROWSER_BASE_REVISION_ID,
      sequence: 3,
      occurredAt: "2026-08-27T12:00:00.000Z",
      readModel: browserWorkingReadModel,
    },
  ];
  return rawEvents.map((event) => JSON.stringify(event));
}

const expectedCommittedMarkerState = {
  cityId: "ljubljana",
  rank: 1,
  status: "selectable",
  visualStatus: "green",
  knowledgeRevisionId: "city-knowledge:ljubljana@1",
  evidenceSnapshotId: "city-evidence:ljubljana@1",
  lastCheckedAt: "2026-08-27T00:00:00.000Z",
  requiredMismatches: [],
  unknownBasis: [],
  verificationCoverage: "1",
  facts: [
    {
      criterionId: "safety",
      definitionId: "si-municipal-police-offences-per-100000@1",
      outcome: {
        kind: "verified",
        basis: {
          kind: "municipal_safety",
          quantity: {
            offenceCount: "1200",
            population: "300000",
            rateBasis: "offences_per_100000_residents",
          },
        },
      },
    },
    {
      criterionId: "long_term_rent",
      definitionId: "rent@1",
      outcome: { kind: "verified", basis: { kind: "canonical_scalar", value: "850" } },
    },
    {
      criterionId: "urban_transit",
      definitionId: "transit@1",
      outcome: { kind: "verified", basis: { kind: "canonical_scalar", value: "0.8" } },
    },
    {
      criterionId: "fixed_broadband",
      definitionId: "broadband@1",
      outcome: { kind: "verified", basis: { kind: "canonical_scalar", value: "150" } },
    },
  ],
} as const;

const expectedWorkingReadModelState = {
  runId: BROWSER_RUN_ID,
  assessmentAt: "2026-08-27T00:00:00.000Z",
  resolvedCountryShortlistRevisionId: "country-resolution:terminal-1",
  countryCode: "SI",
  registry: {
    id: BROWSER_REGISTRY_ID,
    entries: [
      { cityId: "ljubljana", officialName: "Ljubljana" },
      { cityId: "maribor", officialName: "Maribor" },
    ],
  },
  catalog: {
    id: BROWSER_CATALOG_ID,
    members: [
      { cityId: "ljubljana", inclusionReasons: ["national_capital"] },
      { cityId: "maribor", inclusionReasons: ["population_fill"] },
    ],
  },
  ranking: {
    id: BROWSER_RANKING_ID,
    ordered: [
      { cityId: "ljubljana", rank: 1, score: "0", coverage: "0" },
      { cityId: "maribor", rank: 2, score: "0", coverage: "0" },
    ],
  },
  revision: {
    schemaVersion: "city-frontier@1",
    kind: "working",
    id: BROWSER_WORKING_REVISION_ID,
    runId: BROWSER_RUN_ID,
    predecessorRevisionId: BROWSER_BASE_REVISION_ID,
    rankingSnapshotId: BROWSER_RANKING_ID,
    markers: [expectedCommittedMarkerState],
    nextUncheckedRank: 2,
    phase: "verification_required",
    operation: {
      kind: "city_completed",
      commandId: "city-continue:browser-1",
      expectedHeadRevisionId: BROWSER_BASE_REVISION_ID,
      cityId: "ljubljana",
      cityCheckRunId: `city-check:${"a".repeat(64)}`,
    },
    createdAt: "2026-08-27T12:00:00.000Z",
  },
  selections: [],
} as const;

function browserStreamHeaders(): HeadersInit {
  return {
    "content-type": "application/x-ndjson; charset=utf-8",
    "x-life-run-id": BROWSER_RUN_ID,
    "x-life-base-revision-id": BROWSER_BASE_REVISION_ID,
  };
}

function finiteBrowserStream(
  lines: readonly string[],
  trailing = "",
): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(`${lines.join("\n")}\n${trailing}`);
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

describe("city-frontier finite browser decoder", () => {
  // Break caught: opening a non-success, non-NDJSON, unbound, or bodyless Continue response, or
  // allowing cancellation failure to replace the first synchronous envelope error.
  test.each([
    ["request failure", 409, browserStreamHeaders(), "city_frontier_request_failed"],
    ["content type", 200, {
      ...Object.fromEntries(new Headers(browserStreamHeaders()).entries()),
      "content-type": "application/json; charset=utf-8",
    }, "invalid_city_frontier_content_type"],
    ["missing run", 200, {
      "content-type": "application/x-ndjson; charset=utf-8",
      "x-life-base-revision-id": BROWSER_BASE_REVISION_ID,
    }, "invalid_x-life-run-id"],
    ["changed run", 200, {
      ...Object.fromEntries(new Headers(browserStreamHeaders()).entries()),
      "x-life-run-id": "city-frontier:changed",
    }, "changed_city_frontier_identity"],
    ["missing base", 200, {
      "content-type": "application/x-ndjson; charset=utf-8",
      "x-life-run-id": BROWSER_RUN_ID,
    }, "invalid_x-life-base-revision-id"],
    ["changed base", 200, {
      ...Object.fromEntries(new Headers(browserStreamHeaders()).entries()),
      "x-life-base-revision-id": "city-frontier-revision:changed",
    }, "changed_city_frontier_identity"],
  ] as const)("rejects %s synchronously and cancels its body without masking", async (
    _name,
    status,
    headers,
    message,
  ) => {
    const { openCityFrontierStreamResponse } = await loadCityFrontierStreamModule();
    const cancellationReasons: unknown[] = [];
    const body = new ReadableStream<Uint8Array>({
      cancel(reason) {
        cancellationReasons.push(reason);
        throw new Error("secondary_cancel_failure");
      },
    });
    const response = new Response(body, { status, headers });

    expect(() => openCityFrontierStreamResponse(response, {
      runId: BROWSER_RUN_ID,
      baseRevisionId: BROWSER_BASE_REVISION_ID,
    })).toThrow(message);
    expect(cancellationReasons).toHaveLength(1);
    expect(cancellationReasons[0]).toMatchObject({ message });
  });

  test("rejects a bodyless successful response synchronously", async () => {
    const { openCityFrontierStreamResponse } = await loadCityFrontierStreamModule();
    const response = new Response(null, { status: 200, headers: browserStreamHeaders() });

    expect(() => openCityFrontierStreamResponse(response, {
      runId: BROWSER_RUN_ID,
      baseRevisionId: BROWSER_BASE_REVISION_ID,
    })).toThrow("missing_city_frontier_body");
  });

  // Break caught: copying the NDJSON reader or creating a second ownership lifecycle instead of
  // decoding one valid committed city through the shared one-shot finite handoff.
  test("decodes one valid working continuation through the finite stream handoff", async () => {
    const {
      createCityFrontierStreamHandoff,
      decodeCityFrontierStream,
      openCityFrontierStreamResponse,
    } = await loadCityFrontierStreamModule();
    const response = new Response(finiteBrowserStream(browserWireLines()), {
      status: 200,
      headers: browserStreamHeaders(),
    });
    const opened = openCityFrontierStreamResponse(response, {
      runId: BROWSER_RUN_ID,
      baseRevisionId: BROWSER_BASE_REVISION_ID,
    });
    const handoff = createCityFrontierStreamHandoff(opened.stream);
    const adopted = handoff.adopt();

    expect(adopted).toBeDefined();
    expect(handoff.adopt()).toBeUndefined();
    const received: CityFrontierEvent[] = [];
    for await (const event of decodeCityFrontierStream(adopted!, browserBaseReadModel)) {
      received.push(event);
    }

    expect(received.map(({ type }) => type)).toEqual([
      "city_activated",
      "city_revision_committed",
      "city_continuation_completed",
    ]);
    expect(received[1]).toMatchObject({
      type: "city_revision_committed",
      runId: BROWSER_RUN_ID,
      baseRevisionId: BROWSER_BASE_REVISION_ID,
      sequence: 2,
      occurredAt: "2026-08-27T12:00:00.000Z",
      marker: expectedCommittedMarkerState,
      revision: expectedWorkingReadModelState.revision,
    });
    expect(received[2]).toMatchObject({
      type: "city_continuation_completed",
      runId: BROWSER_RUN_ID,
      baseRevisionId: BROWSER_BASE_REVISION_ID,
      sequence: 3,
      occurredAt: "2026-08-27T12:00:00.000Z",
      readModel: expectedWorkingReadModelState,
    });
  });

  // Break caught: publishing the completed read model as soon as its line arrives instead of waiting
  // for clean EOF to prove there are no trailing frames or bytes.
  test("withholds completion until clean EOF", async () => {
    const { decodeCityFrontierStream } = await loadCityFrontierStreamModule();
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
    const stream = new ReadableStream<Uint8Array>({
      start(value) {
        controller = value;
        value.enqueue(new TextEncoder().encode(`${browserWireLines().join("\n")}\n`));
      },
    });
    const decoder = decodeCityFrontierStream(stream, browserBaseReadModel);

    expect((await decoder.next()).value).toMatchObject({ type: "city_activated" });
    expect((await decoder.next()).value).toMatchObject({ type: "city_revision_committed" });
    let completionSettled = false;
    const completion = decoder.next().finally(() => { completionSettled = true; });
    await Promise.resolve();
    expect(completionSettled).toBe(false);

    controller!.close();
    const completedResult = await completion;
    expect(completedResult.done).toBe(false);
    expect(completedResult.value).toMatchObject({
      type: "city_continuation_completed",
      runId: BROWSER_RUN_ID,
      baseRevisionId: BROWSER_BASE_REVISION_ID,
      sequence: 3,
      occurredAt: "2026-08-27T12:00:00.000Z",
      readModel: expectedWorkingReadModelState,
    });
    expect(await decoder.next()).toEqual({ done: true, value: undefined });
  });

  // Break caught: committing the completion frame on corrupt EOF or a failed transport instead of
  // retaining only the marker revision that was durably emitted before the failure.
  test.each(["trailing bytes", "stream error"] as const)(
    "suppresses completion after %s and retains the committed marker",
    async (failureKind) => {
      const { decodeCityFrontierStream } = await loadCityFrontierStreamModule();
      const transportError = new Error("city_transport_failed");
      const lines = browserWireLines();
      let stream: ReadableStream<Uint8Array>;
      if (failureKind === "trailing bytes") {
        stream = finiteBrowserStream(lines, "{\"trailing\":true}");
      } else {
        let index = 0;
        stream = new ReadableStream<Uint8Array>({
          pull(controller) {
            const line = lines[index];
            if (line !== undefined) {
              index += 1;
              controller.enqueue(new TextEncoder().encode(`${line}\n`));
              return;
            }
            controller.error(transportError);
          },
        });
      }

      const received: CityFrontierEvent[] = [];
      let failure: unknown;
      try {
        for await (const event of decodeCityFrontierStream(stream, browserBaseReadModel)) {
          received.push(event);
        }
      } catch (error) {
        failure = error;
      }

      expect(failure).toMatchObject({
        message: failureKind === "trailing bytes" ? "trailing_partial_line" : "city_transport_failed",
      });
      expect(received.map(({ type }) => type)).toEqual([
        "city_activated",
        "city_revision_committed",
      ]);
      expect(received.filter((event) => event.type === "city_revision_committed")
        .map(({ marker }) => marker)).toMatchObject([expectedCommittedMarkerState]);
      expect(received.some(({ type }) => type === "city_continuation_completed")).toBe(false);
    },
  );
});

function syntheticCityId(rank: number): string {
  return `candidate-${rank}`;
}

function syntheticRedMarker(rank: number): CityFrontierReadModel["revision"]["markers"][number] {
  const cityId = syntheticCityId(rank);
  return {
    ...structuredClone(browserMarker),
    cityId,
    rank,
    status: "excluded",
    visualStatus: "red",
    knowledgeRevisionId: `city-knowledge:${cityId}@1`,
    evidenceSnapshotId: `city-evidence:${cityId}@1`,
    requiredMismatches: [{
      criterionId: "safety",
      definitionId: "si-municipal-police-offences-per-100000@1",
      target: "2",
      verifiedBasis: {
        kind: "municipal_safety",
        quantity: {
          offenceCount: "1200",
          population: "300000",
          rateBasis: "offences_per_100000_residents",
        },
      },
      evaluatorVersion: "si-municipal-safety-linear@1",
    }],
  };
}

function syntheticWorkingReadModel(
  cityCount: number,
  markerCount: number,
  revisionId: string,
): CityFrontierReadModel {
  const cityIds = Array.from({ length: cityCount }, (_, index) => syntheticCityId(index + 1));
  const markers = Array.from({ length: markerCount }, (_, index) =>
    syntheticRedMarker(index + 1));
  const predecessorRevisionId = markerCount === 0
    ? undefined
    : `city-frontier-revision:synthetic-${markerCount - 1}`;
  return {
    ...structuredClone(browserReadModelEnvelope),
    registry: {
      ...structuredClone(browserReadModelEnvelope.registry),
      entries: cityIds.map((cityId, index) => ({
        ...structuredClone(browserReadModelEnvelope.registry.entries[0]),
        cityId,
        officialName: `Candidate ${index + 1}`,
        coordinate: { lat: 46 + index / 100, lng: 14 + index / 100 },
        administrativeTerritory: `Territory ${index + 1}`,
        capitalRoles: [],
        evidenceReferenceIds: [`official-register:${cityId}`],
      })),
    },
    catalog: {
      ...structuredClone(browserReadModelEnvelope.catalog),
      candidateBasis: cityIds.map((cityId, index) => ({
        cityId,
        comparablePopulation: {
          kind: "verified" as const,
          value: String(100_000 - index),
          referencePeriod: "2025",
        },
      })),
      members: cityIds.map((cityId) => ({
        cityId,
        inclusionReasons: ["population_fill" as const],
      })),
    },
    ranking: {
      ...structuredClone(browserReadModelEnvelope.ranking),
      knowledgeRevisionIds: Object.fromEntries(cityIds.map((cityId) => [cityId, null])),
      ordered: cityIds.map((cityId, index) => ({
        cityId,
        rank: index + 1,
        score: "0",
        coverage: "0",
        knowledgeRevisionId: null,
        factors: structuredClone(browserFactors),
      })),
    },
    revision: {
      schemaVersion: "city-frontier@1",
      kind: "working",
      id: revisionId,
      runId: BROWSER_RUN_ID,
      ...(predecessorRevisionId === undefined ? {} : { predecessorRevisionId }),
      rankingSnapshotId: BROWSER_RANKING_ID,
      markers,
      nextUncheckedRank: markerCount + 1,
      phase: "verification_required",
      operation: markerCount === 0
        ? {
            kind: "start",
            commandId: "city-start:synthetic",
            criteriaPayloadHash: "b".repeat(64),
          }
        : {
            kind: "city_completed",
            commandId: `city-continue:synthetic-${markerCount}`,
            expectedHeadRevisionId: predecessorRevisionId!,
            cityId: syntheticCityId(markerCount),
            cityCheckRunId: `city-check:synthetic-${markerCount}`,
          },
      createdAt: "2026-08-27T10:00:00.000Z",
    },
  } as CityFrontierReadModel;
}

function syntheticSuccessor(
  predecessor: CityFrontierReadModel,
  input: {
    readonly id: string;
    readonly kind: "working" | "terminal";
    readonly stopCondition?: "live_candidate_limit_reached";
  },
): CityFrontierReadModel["revision"] {
  const rank = predecessor.revision.nextUncheckedRank;
  const markers = [...predecessor.revision.markers, syntheticRedMarker(rank)];
  const common = {
    schemaVersion: "city-frontier@1" as const,
    id: input.id,
    runId: BROWSER_RUN_ID,
    predecessorRevisionId: predecessor.revision.id,
    rankingSnapshotId: BROWSER_RANKING_ID,
    markers,
    nextUncheckedRank: rank + 1,
    operation: {
      kind: "city_completed" as const,
      commandId: `city-continue:synthetic-${rank}`,
      expectedHeadRevisionId: predecessor.revision.id,
      cityId: syntheticCityId(rank),
      cityCheckRunId: `city-check:synthetic-${rank}`,
    },
    createdAt: "2026-08-27T12:00:00.000Z",
  };
  if (input.kind === "working") {
    return { ...common, kind: "working", phase: "verification_required" };
  }
  return {
    ...common,
    kind: "terminal",
    entries: [],
    stopCondition: input.stopCondition ?? "live_candidate_limit_reached",
  };
}

function syntheticContinuationLines(
  predecessor: CityFrontierReadModel,
  successor: CityFrontierReadModel["revision"],
  suffix: readonly unknown[] = [],
): readonly string[] {
  const marker = successor.markers.at(-1)!;
  const rawEvents: readonly unknown[] = [
    {
      type: "city_activated",
      runId: BROWSER_RUN_ID,
      baseRevisionId: predecessor.revision.id,
      sequence: 1,
      occurredAt: "2026-08-27T12:00:00.000Z",
      cityId: marker.cityId,
      rank: marker.rank,
    },
    {
      type: "city_revision_committed",
      runId: BROWSER_RUN_ID,
      baseRevisionId: predecessor.revision.id,
      sequence: 2,
      occurredAt: "2026-08-27T12:00:00.000Z",
      marker,
      revision: successor,
    },
    ...suffix,
  ];
  return rawEvents.map((rawEvent) => JSON.stringify(rawEvent));
}

async function decodeSyntheticFailure(
  lines: readonly string[],
  initialReadModel: CityFrontierReadModel,
): Promise<{ readonly received: readonly CityFrontierEvent[]; readonly failure: unknown }> {
  const { decodeCityFrontierStream } = await loadCityFrontierStreamModule();
  const received: CityFrontierEvent[] = [];
  let failure: unknown;
  try {
    for await (const event of decodeCityFrontierStream(
      finiteBrowserStream(lines),
      initialReadModel,
    )) received.push(event);
  } catch (error) {
    failure = error;
  }
  return { received, failure };
}

describe("city-frontier closed budget transition REDs", () => {
  // Break caught: treating predecessor identity as a legal successor revision identity.
  test("rejects a successor that reuses the predecessor revision id before yielding commit", async () => {
    const base = syntheticWorkingReadModel(2, 0, BROWSER_BASE_REVISION_ID);
    const successor = syntheticSuccessor(base, {
      id: BROWSER_BASE_REVISION_ID,
      kind: "working",
    });
    const completion = {
      type: "city_continuation_completed",
      runId: BROWSER_RUN_ID,
      baseRevisionId: base.revision.id,
      sequence: 3,
      occurredAt: "2026-08-27T12:00:00.000Z",
      readModel: { ...base, revision: successor },
    };

    const result = await decodeSyntheticFailure(
      syntheticContinuationLines(base, successor, [completion]),
      base,
    );

    expect(result.failure).toBeInstanceOf(Error);
    expect(result.received.map(({ type }) => type)).toEqual(["city_activated"]);
  });

  // Break caught: accepting the ten-candidate stop condition before the exact tenth marker exists.
  test("rejects live_candidate_limit_reached below exactly ten committed markers", async () => {
    const base = syntheticWorkingReadModel(2, 0, BROWSER_BASE_REVISION_ID);
    const successor = syntheticSuccessor(base, {
      id: BROWSER_WORKING_REVISION_ID,
      kind: "terminal",
      stopCondition: "live_candidate_limit_reached",
    });
    const completion = {
      type: "city_continuation_completed",
      runId: BROWSER_RUN_ID,
      baseRevisionId: base.revision.id,
      sequence: 3,
      occurredAt: "2026-08-27T12:00:00.000Z",
      readModel: { ...base, revision: successor },
    };

    const result = await decodeSyntheticFailure(
      syntheticContinuationLines(base, successor, [completion]),
      base,
    );

    expect(result.failure).toBeInstanceOf(Error);
    expect(result.received.map(({ type }) => type)).toEqual(["city_activated"]);
  });

  // Break caught: persisting or completing a working revision after consuming the exact live-city
  // budget instead of requiring the tenth commit to be terminal.
  test("rejects a working successor and completion at ten markers", async () => {
    const base = syntheticWorkingReadModel(11, 9, BROWSER_BASE_REVISION_ID);
    const successor = syntheticSuccessor(base, {
      id: BROWSER_WORKING_REVISION_ID,
      kind: "working",
    });
    const completion = {
      type: "city_continuation_completed",
      runId: BROWSER_RUN_ID,
      baseRevisionId: base.revision.id,
      sequence: 3,
      occurredAt: "2026-08-27T12:00:00.000Z",
      readModel: { ...base, revision: successor },
    };

    const result = await decodeSyntheticFailure(
      syntheticContinuationLines(base, successor, [completion]),
      base,
    );

    expect(result.failure).toBeInstanceOf(Error);
    expect(result.received.map(({ type }) => type)).toEqual(["city_activated"]);
  });

  // Break caught: using a valid terminal tenth commit as a new working head, which permits an
  // eleventh activation and its progress/further commit to escape to the consumer.
  test("rejects an eleventh activation and every suffix after a valid terminal successor", async () => {
    const base = syntheticWorkingReadModel(11, 9, BROWSER_BASE_REVISION_ID);
    const terminal = syntheticSuccessor(base, {
      id: BROWSER_WORKING_REVISION_ID,
      kind: "terminal",
      stopCondition: "live_candidate_limit_reached",
    });
    const eleventhMarker = syntheticRedMarker(11);
    const illegalSuccessor = {
      ...syntheticSuccessor({ ...base, revision: terminal }, {
        id: `city-frontier-revision:${"c".repeat(64)}`,
        kind: "working",
      }),
    };
    const suffix = [
      {
        type: "city_activated",
        runId: BROWSER_RUN_ID,
        baseRevisionId: base.revision.id,
        sequence: 3,
        occurredAt: "2026-08-27T12:00:01.000Z",
        cityId: eleventhMarker.cityId,
        rank: 11,
      },
      {
        type: "city_progress",
        runId: BROWSER_RUN_ID,
        baseRevisionId: base.revision.id,
        sequence: 4,
        occurredAt: "2026-08-27T12:00:02.000Z",
        cityId: eleventhMarker.cityId,
        stage: "evidence_verified",
      },
      {
        type: "city_revision_committed",
        runId: BROWSER_RUN_ID,
        baseRevisionId: base.revision.id,
        sequence: 5,
        occurredAt: "2026-08-27T12:00:03.000Z",
        marker: eleventhMarker,
        revision: illegalSuccessor,
      },
    ];

    const result = await decodeSyntheticFailure(
      syntheticContinuationLines(base, terminal, suffix),
      base,
    );

    expect(result.failure).toBeInstanceOf(Error);
    expect(result.received.map(({ type }) => type)).toEqual([
      "city_activated",
      "city_revision_committed",
    ]);
  });
});

describe("city-frontier marker order and public reducer REDs", () => {
  // Break caught: treating marker membership as sufficient while accepting a stored historical
  // prefix whose wire order contradicts frozen ranking order.
  test("rejects a catalog-exhausted terminal whose excluded markers are ordered rank 2 then 1", async () => {
    const { normalizeCityFrontierReadModel } = await loadCityFrontierStreamModule();
    const base = syntheticWorkingReadModel(2, 0, BROWSER_BASE_REVISION_ID);
    const terminal = {
      schemaVersion: "city-frontier@1" as const,
      kind: "terminal" as const,
      id: BROWSER_WORKING_REVISION_ID,
      runId: BROWSER_RUN_ID,
      predecessorRevisionId: BROWSER_BASE_REVISION_ID,
      rankingSnapshotId: BROWSER_RANKING_ID,
      markers: [syntheticRedMarker(2), syntheticRedMarker(1)],
      nextUncheckedRank: 3,
      entries: [],
      stopCondition: "catalog_exhausted" as const,
      operation: {
        kind: "city_completed" as const,
        commandId: "city-continue:synthetic-2",
        expectedHeadRevisionId: BROWSER_BASE_REVISION_ID,
        cityId: syntheticCityId(2),
        cityCheckRunId: "city-check:synthetic-2",
      },
      createdAt: "2026-08-27T12:00:00.000Z",
    };
    let failure: unknown;

    try {
      normalizeCityFrontierReadModel({ ...base, revision: terminal });
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(Error);
  });

  // Break caught: keeping City reducer state private inside the decoder instead of exposing the
  // Country-parallel frozen initial/reduce API required by browser consumers.
  test("reduces one valid activation into the exact frozen public event state", async () => {
    interface PlannedCityFrontierEventState {
      readonly runId: string;
      readonly baseRevisionId: string;
      readonly lastSequence: number;
      readonly active?: { readonly cityId: string; readonly rank: number };
    }
    interface PlannedCityFrontierStreamModule {
      readonly initialCityFrontierEventState: (
        readModel: CityFrontierReadModel,
      ) => PlannedCityFrontierEventState;
      readonly reduceCityFrontierEvent: (
        state: PlannedCityFrontierEventState,
        event: CityFrontierEvent,
        predecessorReadModel: CityFrontierReadModel,
      ) => PlannedCityFrontierEventState;
    }
    const streamModule = await loadCityFrontierStreamModule() as unknown as
      PlannedCityFrontierStreamModule;
    const base = syntheticWorkingReadModel(2, 0, BROWSER_BASE_REVISION_ID);
    const activatedEvent: CityFrontierEvent = {
      type: "city_activated",
      runId: BROWSER_RUN_ID,
      baseRevisionId: BROWSER_BASE_REVISION_ID,
      sequence: 1,
      occurredAt: "2026-08-27T12:00:00.000Z",
      cityId: syntheticCityId(1),
      rank: 1,
    };

    const initial = streamModule.initialCityFrontierEventState(base);
    const state = streamModule.reduceCityFrontierEvent(initial, activatedEvent, base);

    expect(state).toEqual({
      runId: BROWSER_RUN_ID,
      baseRevisionId: BROWSER_BASE_REVISION_ID,
      lastSequence: 1,
      active: { cityId: syntheticCityId(1), rank: 1 },
    });
    expect(Object.isFrozen(state)).toBe(true);
    expect(Object.isFrozen(state.active)).toBe(true);
  });
});

describe("city-frontier reducer flight-state REDs", () => {
  // Break caught: clearing active after commit without latching that this finite continuation already
  // consumed its sole city, allowing a second activation against the same base revision stream.
  test("rejects a second activation after one valid activation and commit", async () => {
    const {
      initialCityFrontierEventState,
      reduceCityFrontierEvent,
    } = await loadCityFrontierStreamModule();
    const base = syntheticWorkingReadModel(3, 0, BROWSER_BASE_REVISION_ID);
    const successor = syntheticSuccessor(base, {
      id: BROWSER_WORKING_REVISION_ID,
      kind: "working",
    });
    const firstActivation: CityFrontierEvent = {
      type: "city_activated",
      runId: BROWSER_RUN_ID,
      baseRevisionId: BROWSER_BASE_REVISION_ID,
      sequence: 1,
      occurredAt: "2026-08-27T12:00:00.000Z",
      cityId: syntheticCityId(1),
      rank: 1,
    };
    const firstCommit: CityFrontierEvent = {
      type: "city_revision_committed",
      runId: BROWSER_RUN_ID,
      baseRevisionId: BROWSER_BASE_REVISION_ID,
      sequence: 2,
      occurredAt: "2026-08-27T12:00:01.000Z",
      marker: successor.markers.at(-1)!,
      revision: successor,
    };
    const secondActivation: CityFrontierEvent = {
      type: "city_activated",
      runId: BROWSER_RUN_ID,
      baseRevisionId: BROWSER_BASE_REVISION_ID,
      sequence: 3,
      occurredAt: "2026-08-27T12:00:02.000Z",
      cityId: syntheticCityId(2),
      rank: 2,
    };
    const activated = reduceCityFrontierEvent(
      initialCityFrontierEventState(base),
      firstActivation,
      base,
    );
    const committed = reduceCityFrontierEvent(activated, firstCommit, base);
    const successorReadModel = { ...base, revision: successor } as CityFrontierReadModel;
    let returned: unknown;
    let failure: unknown;

    try {
      returned = reduceCityFrontierEvent(committed, secondActivation, successorReadModel);
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(Error);
    expect(returned).toBeUndefined();
    expect(committed).toEqual({
      runId: BROWSER_RUN_ID,
      baseRevisionId: BROWSER_BASE_REVISION_ID,
      lastSequence: 2,
      committedRevisionId: successor.id,
    });
    expect("active" in committed).toBe(false);
  });

  // Break caught: validating progress transiently and discarding the exact official navigation URL
  // instead of retaining normalized, immutable browser flight state.
  test("retains one exact source-completed progress event in deeply frozen state", async () => {
    const {
      initialCityFrontierEventState,
      reduceCityFrontierEvent,
    } = await loadCityFrontierStreamModule();
    const base = syntheticWorkingReadModel(2, 0, BROWSER_BASE_REVISION_ID);
    const activation: CityFrontierEvent = {
      type: "city_activated",
      runId: BROWSER_RUN_ID,
      baseRevisionId: BROWSER_BASE_REVISION_ID,
      sequence: 1,
      occurredAt: "2026-08-27T12:00:00.000Z",
      cityId: syntheticCityId(1),
      rank: 1,
    };
    const progress: CityFrontierEvent = {
      type: "city_progress",
      runId: BROWSER_RUN_ID,
      baseRevisionId: BROWSER_BASE_REVISION_ID,
      sequence: 2,
      occurredAt: "2026-08-27T12:00:01.000Z",
      cityId: syntheticCityId(1),
      stage: "source_completed:si-city-long-term-rent",
      sourceUrl: "https://www.stat.si/rent/candidate-1",
    };
    const activated = reduceCityFrontierEvent(
      initialCityFrontierEventState(base),
      activation,
      base,
    );
    const state = reduceCityFrontierEvent(activated, progress, base) as unknown as {
      readonly active: { readonly cityId: string; readonly rank: number };
      readonly progress: readonly CityFrontierEvent[];
    };

    expect(state.progress).toEqual([{
      type: "city_progress",
      runId: BROWSER_RUN_ID,
      baseRevisionId: BROWSER_BASE_REVISION_ID,
      sequence: 2,
      occurredAt: "2026-08-27T12:00:01.000Z",
      cityId: syntheticCityId(1),
      stage: "source_completed:si-city-long-term-rent",
      sourceUrl: "https://www.stat.si/rent/candidate-1",
    }]);
    expect(Object.isFrozen(state)).toBe(true);
    expect(Object.isFrozen(state.active)).toBe(true);
    expect(Object.isFrozen(state.progress)).toBe(true);
    expect(Object.isFrozen(state.progress[0])).toBe(true);
  });

  // Break caught: accepting a repeated closed progress stage lets an unbounded stream retain the
  // same city/source update indefinitely, despite the finite set of distinct City stages.
  test("rejects a duplicate progress stage after retaining the first frozen progress event", async () => {
    const {
      initialCityFrontierEventState,
      reduceCityFrontierEvent,
    } = await loadCityFrontierStreamModule();
    const base = syntheticWorkingReadModel(2, 0, BROWSER_BASE_REVISION_ID);
    const activation: CityFrontierEvent = {
      type: "city_activated",
      runId: BROWSER_RUN_ID,
      baseRevisionId: BROWSER_BASE_REVISION_ID,
      sequence: 1,
      occurredAt: "2026-08-27T12:00:00.000Z",
      cityId: syntheticCityId(1),
      rank: 1,
    };
    const firstProgress: CityFrontierEvent = {
      type: "city_progress",
      runId: BROWSER_RUN_ID,
      baseRevisionId: BROWSER_BASE_REVISION_ID,
      sequence: 2,
      occurredAt: "2026-08-27T12:00:01.000Z",
      cityId: syntheticCityId(1),
      stage: "source_started:si-city-safety",
    };
    const duplicateProgress: CityFrontierEvent = {
      ...firstProgress,
      sequence: 3,
      occurredAt: "2026-08-27T12:00:02.000Z",
    };
    const activated = reduceCityFrontierEvent(
      initialCityFrontierEventState(base),
      activation,
      base,
    );
    const progressed = reduceCityFrontierEvent(activated, firstProgress, base);
    let returned: unknown;
    let failure: unknown;

    try {
      returned = reduceCityFrontierEvent(progressed, duplicateProgress, base);
    } catch (error) {
      failure = error;
    }

    expect(progressed.progress!).toEqual([firstProgress]);
    expect(Object.isFrozen(progressed)).toBe(true);
    expect(Object.isFrozen(progressed.progress!)).toBe(true);
    expect(Object.isFrozen(progressed.progress![0])).toBe(true);
    expect(failure).toBeInstanceOf(Error);
    expect(returned).toBeUndefined();
  });
});

const expectedProjectedFacts = [
  {
    criterionId: "safety",
    definitionId: "si-municipal-police-offences-per-100000@1",
    geoScope: "municipality",
    referencePeriod: "2025",
    freshnessBasis: "municipal-annual-july-boundary@1",
    unit: "offences_per_100000_residents",
    denominator: "municipality_population_january_1",
    outcome: {
      kind: "verified",
      basis: {
        kind: "municipal_safety",
        quantity: {
          offenceCount: "1200",
          population: "300000",
          rateBasis: "offences_per_100000_residents",
        },
      },
    },
    evidenceLinks: [{
      sourceId: "si-city-safety",
      disposition: "accepted",
      navigationUrl: "https://www.policija.si/statistika/ljubljana",
      resolvedEvidenceUrl: "https://www.policija.si/statistika/ljubljana-2025.pdf",
      referenceYear: 2025,
    }],
    manualCheckLinks: [],
  },
  {
    criterionId: "long_term_rent",
    definitionId: "rent@1",
    geoScope: "municipality",
    referencePeriod: "2025",
    freshnessBasis: "annual@1",
    unit: "eur_per_month",
    denominator: "dwelling",
    outcome: { kind: "verified", basis: { kind: "canonical_scalar", value: "850" } },
    evidenceLinks: [{
      sourceId: "si-city-long-term-rent",
      disposition: "accepted",
      navigationUrl: "https://www.stat.si/rent/ljubljana",
      resolvedEvidenceUrl: "https://www.stat.si/rent/ljubljana.csv",
    }],
    manualCheckLinks: [],
  },
  {
    criterionId: "urban_transit",
    definitionId: "transit@1",
    geoScope: "municipality",
    referencePeriod: "2025",
    freshnessBasis: "annual@1",
    unit: "coverage_ratio",
    denominator: "urban_area",
    outcome: { kind: "verified", basis: { kind: "canonical_scalar", value: "0.8" } },
    evidenceLinks: [{
      sourceId: "si-city-urban-transit",
      disposition: "accepted",
      navigationUrl: "https://www.ljubljana.si/transit",
      resolvedEvidenceUrl: "https://www.ljubljana.si/transit/report-2025.pdf",
    }],
    manualCheckLinks: [],
  },
  {
    criterionId: "fixed_broadband",
    definitionId: "broadband@1",
    geoScope: "municipality",
    referencePeriod: "2025",
    freshnessBasis: "annual@1",
    unit: "mbps",
    denominator: "household",
    outcome: { kind: "verified", basis: { kind: "canonical_scalar", value: "150" } },
    evidenceLinks: [{
      sourceId: "si-city-fixed-broadband",
      disposition: "accepted",
      navigationUrl: "https://www.akos-rs.si/broadband/ljubljana",
      resolvedEvidenceUrl: "https://www.akos-rs.si/broadband/ljubljana.csv",
    }],
    manualCheckLinks: [],
  },
] as const;

interface WishedCityCandidateView {
  readonly city: {
    readonly cityId: string;
    readonly officialName: string;
    readonly countryCode: string;
    readonly coordinate: { readonly lat: number; readonly lng: number };
  };
  readonly rank: number;
  readonly score: string;
  readonly coverage: string;
  readonly status: "pending" | "green" | "yellow" | "red";
  readonly statusLabel: "Проверяется" | "Доступен для выбора" |
    "Доступен с неполными данными" | "Исключён";
  readonly facts?: readonly unknown[];
  readonly verificationCoverage?: string;
  readonly lastCheckedAt?: string;
}

interface WishedCityFrontierView {
  readonly candidates: readonly WishedCityCandidateView[];
  readonly progress: readonly CityFrontierEvent[];
  readonly cards: readonly unknown[];
  readonly canContinue: boolean;
  readonly transportError?: string;
  readonly requiresVerifiedReload?: boolean;
}

interface WishedCityFrontierViewModule {
  readonly presentCityFrontierReadModel: (readModel: CityFrontierReadModel) => unknown;
  readonly projectCityFrontierView: (state: unknown) => WishedCityFrontierView;
  readonly beginCityFrontierContinuation: (readModel: CityFrontierReadModel) => unknown;
  readonly reduceCityFrontierContinuationEvent: (
    state: unknown,
    event: CityFrontierEvent,
  ) => unknown;
  readonly failCityFrontierContinuation: (state: unknown, message: string) => unknown;
}

const expectedProjectedRedMismatch = [{
  criterionId: "safety",
  definitionId: "si-municipal-police-offences-per-100000@1",
  target: "2",
  verifiedBasis: {
    kind: "municipal_safety",
    quantity: {
      offenceCount: "1200",
      population: "300000",
      rateBasis: "offences_per_100000_residents",
    },
  },
  evaluatorVersion: "si-municipal-safety-linear@1",
}] as const;

describe("city-frontier pure view projection REDs", () => {
  // Break caught: fabricating a live flight on stored reload, losing committed marker freshness, or
  // reordering Registry/Ranking joins instead of projecting only the stored rank-ordered markers.
  test("projects a stored working frontier from its two committed red markers only", async () => {
    const viewModule = await loadCityFrontierViewModelModule() as unknown as
      WishedCityFrontierViewModule;
    const readModel = syntheticWorkingReadModel(3, 2, BROWSER_WORKING_REVISION_ID);

    const view = viewModule.projectCityFrontierView(
      viewModule.presentCityFrontierReadModel(readModel),
    );

    expect(view).toEqual({
      candidates: [{
        city: {
          cityId: "candidate-1",
          officialName: "Candidate 1",
          countryCode: "SI",
          coordinate: { lat: 46, lng: 14 },
        },
        rank: 1,
        score: "0",
        coverage: "0",
        status: "red",
        statusLabel: "Исключён",
        knowledgeRevisionId: "city-knowledge:candidate-1@1",
        evidenceSnapshotId: "city-evidence:candidate-1@1",
        requiredMismatches: expectedProjectedRedMismatch,
        unknownBasis: [],
        facts: expectedProjectedFacts,
        verificationCoverage: "1",
        lastCheckedAt: "2026-08-27T00:00:00.000Z",
      }, {
        city: {
          cityId: "candidate-2",
          officialName: "Candidate 2",
          countryCode: "SI",
          coordinate: { lat: 46.01, lng: 14.01 },
        },
        rank: 2,
        score: "0",
        coverage: "0",
        status: "red",
        statusLabel: "Исключён",
        knowledgeRevisionId: "city-knowledge:candidate-2@1",
        evidenceSnapshotId: "city-evidence:candidate-2@1",
        requiredMismatches: expectedProjectedRedMismatch,
        unknownBasis: [],
        facts: expectedProjectedFacts,
        verificationCoverage: "1",
        lastCheckedAt: "2026-08-27T00:00:00.000Z",
      }],
      progress: [],
      cards: [],
      canContinue: true,
    });
    expect(Object.isFrozen(view)).toBe(true);
    expect(Object.isFrozen(view.candidates)).toBe(true);
    expect(view.candidates.every((candidate) => Object.isFrozen(candidate))).toBe(true);
    expect(view.candidates.every((candidate) => Object.isFrozen(candidate.facts))).toBe(true);
  });

  // Break caught: showing an uncommitted active city as verified, manufacturing fresh facts, or
  // dropping the exact official progress URL retained by the stream reducer.
  test("projects one pending candidate and exact live progress without cards", async () => {
    const viewModule = await loadCityFrontierViewModelModule() as unknown as
      WishedCityFrontierViewModule;
    const readModel = syntheticWorkingReadModel(2, 0, BROWSER_BASE_REVISION_ID);
    const activation: CityFrontierEvent = {
      type: "city_activated",
      runId: BROWSER_RUN_ID,
      baseRevisionId: BROWSER_BASE_REVISION_ID,
      sequence: 1,
      occurredAt: "2026-08-27T12:00:00.000Z",
      cityId: syntheticCityId(1),
      rank: 1,
    };
    const progress: CityFrontierEvent = {
      type: "city_progress",
      runId: BROWSER_RUN_ID,
      baseRevisionId: BROWSER_BASE_REVISION_ID,
      sequence: 2,
      occurredAt: "2026-08-27T12:00:01.000Z",
      cityId: syntheticCityId(1),
      stage: "source_completed:si-city-long-term-rent",
      sourceUrl: "https://www.stat.si/rent/candidate-1",
    };
    let state = viewModule.beginCityFrontierContinuation(readModel);
    state = viewModule.reduceCityFrontierContinuationEvent(state, activation);
    state = viewModule.reduceCityFrontierContinuationEvent(state, progress);

    const view = viewModule.projectCityFrontierView(state);

    expect(view).toEqual({
      candidates: [{
        city: {
          cityId: "candidate-1",
          officialName: "Candidate 1",
          countryCode: "SI",
          coordinate: { lat: 46, lng: 14 },
        },
        rank: 1,
        score: "0",
        coverage: "0",
        status: "pending",
        statusLabel: "Проверяется",
      }],
      progress: [{
        type: "city_progress",
        runId: BROWSER_RUN_ID,
        baseRevisionId: BROWSER_BASE_REVISION_ID,
        sequence: 2,
        occurredAt: "2026-08-27T12:00:01.000Z",
        cityId: "candidate-1",
        stage: "source_completed:si-city-long-term-rent",
        sourceUrl: "https://www.stat.si/rent/candidate-1",
      }],
      cards: [],
      canContinue: false,
    });
    expect(Object.isFrozen(view)).toBe(true);
    expect(Object.isFrozen(view.candidates[0])).toBe(true);
    expect(Object.isFrozen(view.progress)).toBe(true);
    expect(Object.isFrozen(view.progress[0])).toBe(true);
  });
});

const GREEN_MARKER_DIGEST = "e".repeat(64);

function rawGreenMarker(): CityFrontierReadModel["revision"]["markers"][number] {
  return {
    ...structuredClone(browserMarker),
    cityId: "candidate-1",
    rank: 1,
    knowledgeRevisionId: "city-knowledge:candidate-1@1",
    evidenceSnapshotId: "city-evidence:candidate-1@1",
  };
}

function terminalHistoryFixture(): {
  readonly base: CityFrontierReadModel;
  readonly terminalReadModel: CityFrontierReadModel;
  readonly storedReadModel: CityFrontierReadModel;
  readonly terminal: CityFrontierReadModel["revision"];
  readonly selectionPair: CityFrontierReadModel["selections"][number];
} {
  const seed = syntheticWorkingReadModel(1, 0, BROWSER_BASE_REVISION_ID);
  const ranking = {
    ...seed.ranking,
    ordered: seed.ranking.ordered.map((ranked) => ({
      ...ranked,
      score: "0.3",
      coverage: "0.6",
    })),
  };
  const green = rawGreenMarker();
  const base = {
    ...seed,
    ranking,
  } as CityFrontierReadModel;
  const terminal = {
    schemaVersion: "city-frontier@1" as const,
    kind: "terminal" as const,
    id: BROWSER_WORKING_REVISION_ID,
    runId: BROWSER_RUN_ID,
    predecessorRevisionId: BROWSER_BASE_REVISION_ID,
    rankingSnapshotId: BROWSER_RANKING_ID,
    markers: [green],
    nextUncheckedRank: 2,
    entries: [{
      cityId: "candidate-1",
      rank: 1,
      markerDigest: GREEN_MARKER_DIGEST,
      knowledgeRevisionId: "city-knowledge:candidate-1@1",
      evidenceSnapshotId: "city-evidence:candidate-1@1",
      unknownBasis: [],
    }],
    stopCondition: "catalog_exhausted" as const,
    operation: {
      kind: "city_completed" as const,
      commandId: "city-continue:terminal-history-1",
      expectedHeadRevisionId: BROWSER_BASE_REVISION_ID,
      cityId: "candidate-1",
      cityCheckRunId: "city-check:terminal-history-1",
    },
    createdAt: "2026-08-27T12:00:00.000Z",
  };
  const selection = {
    schemaVersion: "city-selection@1" as const,
    id: `city-selection:${"f".repeat(64)}`,
    commandId: "city-select:terminal-history-green",
    runId: BROWSER_RUN_ID,
    terminalRevisionId: terminal.id,
    cityId: "candidate-1",
    countryCode: "SI",
    profileSnapshotId: ranking.profileSnapshotId,
    preferenceProfileSnapshotId: ranking.preferenceProfileSnapshotId,
    resolvedCountryShortlistRevisionId: ranking.resolvedCountryShortlistRevisionId,
    criteriaSnapshotId: ranking.criteriaSnapshotId,
    rankingSnapshotId: ranking.id,
    preCityBranchCommitId: ranking.preCityBranchCommitId,
    selectedMarkerDigest: GREEN_MARKER_DIGEST,
    knowledgeRevisionId: "city-knowledge:candidate-1@1",
    evidenceSnapshotId: "city-evidence:candidate-1@1",
    unknownBasis: [],
    createdAt: "2026-08-27T13:00:00.000Z",
  };
  const selectionPair = {
    selection,
    commit: {
      schemaVersion: "city-branch@1" as const,
      id: `city-branch:${"1".repeat(64)}`,
      parentId: ranking.preCityBranchCommitId,
      forkedFrom: ranking.preCityBranchCommitId,
      citySelectionSnapshotId: selection.id,
      cityId: "candidate-1",
      countryCode: "SI",
      createdAt: selection.createdAt,
    },
  };
  return {
    base,
    terminal,
    selectionPair,
    terminalReadModel: { ...base, revision: terminal, selections: [] },
    storedReadModel: { ...base, revision: terminal, selections: [selectionPair] },
  };
}

function expectedTerminalCandidates() {
  return [{
    city: {
      cityId: "candidate-1",
      officialName: "Candidate 1",
      countryCode: "SI",
      coordinate: { lat: 46, lng: 14 },
    },
    rank: 1,
    score: "0.3",
    coverage: "0.6",
    status: "green",
    statusLabel: "Доступен для выбора",
    knowledgeRevisionId: "city-knowledge:candidate-1@1",
    evidenceSnapshotId: "city-evidence:candidate-1@1",
    requiredMismatches: [],
    unknownBasis: [],
    facts: expectedProjectedFacts,
    verificationCoverage: "1",
    lastCheckedAt: "2026-08-27T00:00:00.000Z",
  }] as const;
}

function expectedStoredSelectionPair() {
  const selectionId = `city-selection:${"f".repeat(64)}`;
  const preCityBranchCommitId = `pre-city-branch:${"8".repeat(64)}`;
  return {
    selection: {
      schemaVersion: "city-selection@1",
      id: selectionId,
      commandId: "city-select:terminal-history-green",
      runId: BROWSER_RUN_ID,
      terminalRevisionId: BROWSER_WORKING_REVISION_ID,
      cityId: "candidate-1",
      countryCode: "SI",
      profileSnapshotId: "profile:confirmed-1",
      preferenceProfileSnapshotId: "preferences:confirmed-1",
      resolvedCountryShortlistRevisionId: "country-resolution:terminal-1",
      criteriaSnapshotId: BROWSER_CRITERIA_ID,
      rankingSnapshotId: BROWSER_RANKING_ID,
      preCityBranchCommitId,
      selectedMarkerDigest: GREEN_MARKER_DIGEST,
      knowledgeRevisionId: "city-knowledge:candidate-1@1",
      evidenceSnapshotId: "city-evidence:candidate-1@1",
      unknownBasis: [],
      createdAt: "2026-08-27T13:00:00.000Z",
    },
    commit: {
      schemaVersion: "city-branch@1",
      id: `city-branch:${"1".repeat(64)}`,
      parentId: preCityBranchCommitId,
      forkedFrom: preCityBranchCommitId,
      citySelectionSnapshotId: selectionId,
      cityId: "candidate-1",
      countryCode: "SI",
      createdAt: "2026-08-27T13:00:00.000Z",
    },
  } as const;
}

interface WishedTerminalHistoryView extends WishedCityFrontierView {
  readonly candidates: ReturnType<typeof expectedTerminalCandidates>;
  readonly cards: readonly unknown[];
  readonly stopCondition?: "catalog_exhausted";
  readonly selectionHistory: readonly unknown[];
}

describe("city-frontier terminal cards and stored history REDs", () => {
  // Break caught: projecting terminal authority before completion, or losing committed marker detail,
  // terminal cards, stop condition, and verified selection/branch history on a later stored reload.
  test("withholds terminal authority until completion then projects a stored terminal reload", async () => {
    const viewModule = await loadCityFrontierViewModelModule() as unknown as
      WishedCityFrontierViewModule;
    const fixture = terminalHistoryFixture();
    const activation: CityFrontierEvent = {
      type: "city_activated",
      runId: BROWSER_RUN_ID,
      baseRevisionId: BROWSER_BASE_REVISION_ID,
      sequence: 1,
      occurredAt: "2026-08-27T12:00:00.000Z",
      cityId: "candidate-1",
      rank: 1,
    };
    const commit: CityFrontierEvent = {
      type: "city_revision_committed",
      runId: BROWSER_RUN_ID,
      baseRevisionId: BROWSER_BASE_REVISION_ID,
      sequence: 2,
      occurredAt: "2026-08-27T12:00:01.000Z",
      marker: fixture.terminal.markers.at(-1)!,
      revision: fixture.terminal,
    };
    const completion: CityFrontierEvent = {
      type: "city_continuation_completed",
      runId: BROWSER_RUN_ID,
      baseRevisionId: BROWSER_BASE_REVISION_ID,
      sequence: 3,
      occurredAt: "2026-08-27T12:00:02.000Z",
      readModel: fixture.terminalReadModel,
    };
    let state = viewModule.beginCityFrontierContinuation(fixture.base);
    state = viewModule.reduceCityFrontierContinuationEvent(state, activation);
    state = viewModule.reduceCityFrontierContinuationEvent(state, commit);
    const committedView = viewModule.projectCityFrontierView(state) as
      WishedTerminalHistoryView;
    let stableState: unknown;
    let completionFailure: unknown;
    try {
      stableState = viewModule.reduceCityFrontierContinuationEvent(state, completion);
    } catch (error) {
      completionFailure = error;
    }
    const stableView = stableState === undefined
      ? undefined
      : viewModule.projectCityFrontierView(stableState) as WishedTerminalHistoryView;
    const storedView = viewModule.projectCityFrontierView(
      viewModule.presentCityFrontierReadModel(fixture.storedReadModel),
    ) as WishedTerminalHistoryView;

    expect.soft(committedView).toEqual({
      candidates: expectedTerminalCandidates(),
      progress: [],
      cards: [],
      selectionHistory: [],
      canContinue: false,
    });
    expect.soft(completionFailure).toBeUndefined();
    expect.soft(stableView).toEqual({
      candidates: expectedTerminalCandidates(),
      progress: [],
      cards: [{
        ...expectedTerminalCandidates()[0],
        markerDigest: GREEN_MARKER_DIGEST,
      }],
      stopCondition: "catalog_exhausted",
      selectionHistory: [],
      canContinue: false,
    });
    expect.soft(storedView).toEqual({
      candidates: expectedTerminalCandidates(),
      progress: [],
      cards: [{
        ...expectedTerminalCandidates()[0],
        markerDigest: GREEN_MARKER_DIGEST,
      }],
      stopCondition: "catalog_exhausted",
      selectionHistory: [expectedStoredSelectionPair()],
      canContinue: false,
    });
    expect(Object.isFrozen(committedView)).toBe(true);
    if (stableView !== undefined) {
      expect(Object.isFrozen(stableView)).toBe(true);
      expect(Object.isFrozen(stableView.cards)).toBe(true);
      expect(Object.isFrozen(stableView.selectionHistory)).toBe(true);
    }
    expect(Object.isFrozen(storedView)).toBe(true);
    expect(Object.isFrozen(storedView.selectionHistory)).toBe(true);
  });

  // Break caught: trusting a stored branch pair whose parent is detached from the selected
  // pre-city branch authority.
  test("rejects stored selection history with a changed branch parent before projection", async () => {
    const viewModule = await loadCityFrontierViewModelModule() as unknown as
      WishedCityFrontierViewModule;
    const fixture = terminalHistoryFixture();
    const invalid = {
      ...fixture.storedReadModel,
      selections: [{
        selection: fixture.selectionPair.selection,
        commit: {
          ...fixture.selectionPair.commit,
          parentId: `pre-city-branch:${"9".repeat(64)}`,
        },
      }],
    } as CityFrontierReadModel;
    let failure: unknown;

    try {
      viewModule.presentCityFrontierReadModel(invalid);
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(Error);
  });
});

type Mutable<T> = T extends readonly (infer Item)[]
  ? Mutable<Item>[]
  : T extends object
    ? { -readonly [Key in keyof T]: Mutable<T[Key]> }
    : T;

function mutateCityReadModel(
  source: CityFrontierReadModel,
  mutate: (draft: Mutable<CityFrontierReadModel>) => void,
): CityFrontierReadModel {
  const draft = structuredClone(source) as unknown as Mutable<CityFrontierReadModel>;
  mutate(draft);
  return draft as unknown as CityFrontierReadModel;
}

describe("city-frontier cross-snapshot normalization REDs", () => {
  // Break caught: accepting a foreign registry city or a truncated ranking as a complete country
  // model, which either crashes the Registry/Ranking view join or permits false catalog exhaustion.
  test("rejects a foreign registry entry and an incomplete ranking partition", async () => {
    const { normalizeCityFrontierReadModel } = await loadCityFrontierStreamModule();
    const partitionBaseline = syntheticWorkingReadModel(
      2,
      1,
      BROWSER_WORKING_REVISION_ID,
    );
    const falseCatalogExhaustion = (() => {
      const revision = partitionBaseline.revision;
      if (revision.kind !== "working") throw new Error("expected_working_fixture");
      const { phase, ...terminalBase } = revision;
      expect(phase).toBe("verification_required");
      return {
        ...partitionBaseline,
        ranking: {
          ...partitionBaseline.ranking,
          ordered: partitionBaseline.ranking.ordered.slice(0, 1),
        },
        revision: {
          ...terminalBase,
          kind: "terminal" as const,
          entries: [],
          stopCondition: "catalog_exhausted" as const,
        },
      } as CityFrontierReadModel;
    })();
    const cases = [{
      name: "registry entry country differs from its country envelope",
      valid: browserWorkingReadModel,
      invalid: mutateCityReadModel(browserWorkingReadModel, (draft) => {
        draft.registry.entries[0]!.countryCode = "NO";
      }),
    }, {
      name: "catalog member omitted from ordered and screened exclusions permits false exhaustion",
      valid: partitionBaseline,
      invalid: falseCatalogExhaustion,
    }] as const;

    for (const current of cases) {
      expect(() => normalizeCityFrontierReadModel(current.valid),
        `${current.name}: valid baseline`).not.toThrow();
      expect.soft(() => normalizeCityFrontierReadModel(current.invalid), current.name).toThrow();
    }
  });
});

function validYellowWorkingReadModel(): CityFrontierReadModel {
  return mutateCityReadModel(browserWorkingReadModel, (draft) => {
    const marker = draft.revision.markers[0]!;
    const safety = marker.facts[0];
    marker.visualStatus = "yellow";
    marker.unknownBasis = [{
      criterionId: "safety",
      definitionId: "si-municipal-police-offences-per-100000@1",
      reason: "not_found",
    }];
    marker.verificationCoverage = "0.75";
    safety.outcome = { kind: "unknown", reason: "not_found" };
    safety.evidenceLinks = [];
    safety.manualCheckLinks = [{
      sourceId: "si-city-safety",
      disposition: "reviewed_rejected",
      navigationUrl: "https://www.policija.si/statistika/ljubljana",
      resolvedEvidenceUrl: "https://www.policija.si/statistika/ljubljana-2025.pdf",
      referenceYear: 2025,
      rejectionReason: "http_not_found",
    }];
  });
}

function validWorkingWithReviewedRentLink(): CityFrontierReadModel {
  return mutateCityReadModel(browserWorkingReadModel, (draft) => {
    draft.revision.markers[0]!.facts[1].manualCheckLinks = [{
      sourceId: "si-city-long-term-rent",
      disposition: "reviewed_rejected",
      navigationUrl: "https://www.stat.si/rent/ljubljana",
      resolvedEvidenceUrl: "https://www.stat.si/rent/ljubljana.csv",
    }];
  });
}

describe("city-frontier marker/fact semantic hardening REDs", () => {
  // Break caught: treating criterion-specific link fields as universally optional instead of
  // enforcing the closed safety/non-safety accepted and reviewed-link discriminants.
  test("rejects invalid criterion-specific fact-link discriminants", async () => {
    const { normalizeCityFrontierReadModel } = await loadCityFrontierStreamModule();
    const yellow = validYellowWorkingReadModel();
    const reviewedRent = validWorkingWithReviewedRentLink();
    const cases = [{
      name: "safety accepted missing referenceYear",
      valid: browserWorkingReadModel,
      invalid: mutateCityReadModel(browserWorkingReadModel, (draft) => {
        delete draft.revision.markers[0]!.facts[0].evidenceLinks[0]!.referenceYear;
      }),
    }, {
      name: "safety accepted referenceYear mismatches numeric referencePeriod",
      valid: browserWorkingReadModel,
      invalid: mutateCityReadModel(browserWorkingReadModel, (draft) => {
        draft.revision.markers[0]!.facts[0].evidenceLinks[0]!.referenceYear = 2024;
      }),
    }, {
      name: "safety reviewed_rejected missing rejectionReason",
      valid: yellow,
      invalid: mutateCityReadModel(yellow, (draft) => {
        delete draft.revision.markers[0]!.facts[0].manualCheckLinks[0]!.rejectionReason;
      }),
    }, {
      name: "non-safety reviewed_rejected contains rejectionReason",
      valid: reviewedRent,
      invalid: mutateCityReadModel(reviewedRent, (draft) => {
        draft.revision.markers[0]!.facts[1].manualCheckLinks[0]!.rejectionReason =
          "http_not_found";
      }),
    }, {
      name: "non-safety reviewed_rejected contains referenceYear",
      valid: reviewedRent,
      invalid: mutateCityReadModel(reviewedRent, (draft) => {
        draft.revision.markers[0]!.facts[1].manualCheckLinks[0]!.referenceYear = 2025;
      }),
    }, {
      name: "safety accepted link accompanies an unknown outcome",
      valid: yellow,
      invalid: mutateCityReadModel(yellow, (draft) => {
        draft.revision.markers[0]!.facts[0].evidenceLinks =
          [...structuredClone(browserMarker.facts[0].evidenceLinks)];
      }),
    }] as const;

    for (const current of cases) {
      expect(() => normalizeCityFrontierReadModel(current.valid),
        `${current.name}: valid baseline`).not.toThrow();
      let failure: unknown;
      try {
        normalizeCityFrontierReadModel(current.invalid);
      } catch (error) {
        failure = error;
      }
      expect.soft(failure, current.name).toBeInstanceOf(Error);
    }
  });

  // Break caught: trusting marker color/status arrays independently from the evaluator-owned fact
  // outcomes that determine required mismatches and unknown basis.
  test("rejects marker status arrays that contradict committed fact outcomes", async () => {
    const { normalizeCityFrontierReadModel } = await loadCityFrontierStreamModule();
    const yellow = validYellowWorkingReadModel();
    const red = syntheticWorkingReadModel(2, 1, BROWSER_WORKING_REVISION_ID);
    const cases = [{
      name: "yellow selectable carries requiredMismatches",
      valid: yellow,
      invalid: mutateCityReadModel(yellow, (draft) => {
        draft.revision.markers[0]!.requiredMismatches =
          [...structuredClone(syntheticRedMarker(1).requiredMismatches)];
      }),
    }, {
      name: "red excluded has empty requiredMismatches",
      valid: red,
      invalid: mutateCityReadModel(red, (draft) => {
        draft.revision.markers[0]!.requiredMismatches = [];
      }),
    }, {
      name: "yellow unknownBasis corresponds to a verified fact",
      valid: yellow,
      invalid: mutateCityReadModel(yellow, (draft) => {
        draft.revision.markers[0]!.facts[0].outcome =
          structuredClone(browserMarker.facts[0].outcome);
      }),
    }] as const;

    for (const current of cases) {
      expect(() => normalizeCityFrontierReadModel(current.valid),
        `${current.name}: valid baseline`).not.toThrow();
      let failure: unknown;
      try {
        normalizeCityFrontierReadModel(current.invalid);
      } catch (error) {
        failure = error;
      }
      expect.soft(failure, current.name).toBeInstanceOf(Error);
    }
  });
});

describe("city-frontier continuation transport-failure REDs", () => {
  // Break caught: losing the locally received active city/progress, or pretending that a retry
  // requires a reload before any committed successor exists.
  test("projects pre-commit transport failure with pending city and exact progress", async () => {
    const viewModule = await loadCityFrontierViewModelModule() as unknown as
      WishedCityFrontierViewModule;
    const readModel = syntheticWorkingReadModel(2, 0, BROWSER_BASE_REVISION_ID);
    const activation: CityFrontierEvent = {
      type: "city_activated",
      runId: BROWSER_RUN_ID,
      baseRevisionId: BROWSER_BASE_REVISION_ID,
      sequence: 1,
      occurredAt: "2026-08-27T12:00:00.000Z",
      cityId: syntheticCityId(1),
      rank: 1,
    };
    const progress: CityFrontierEvent = {
      type: "city_progress",
      runId: BROWSER_RUN_ID,
      baseRevisionId: BROWSER_BASE_REVISION_ID,
      sequence: 2,
      occurredAt: "2026-08-27T12:00:01.000Z",
      cityId: syntheticCityId(1),
      stage: "source_completed:si-city-long-term-rent",
      sourceUrl: "https://www.stat.si/rent/candidate-1",
    };
    let state = viewModule.beginCityFrontierContinuation(readModel);
    state = viewModule.reduceCityFrontierContinuationEvent(state, activation);
    state = viewModule.reduceCityFrontierContinuationEvent(state, progress);

    const view = viewModule.projectCityFrontierView(
      viewModule.failCityFrontierContinuation(state, "connection_lost"),
    );

    expect(view).toMatchObject({
      transportError: "connection_lost",
      requiresVerifiedReload: false,
      candidates: [{
        city: {
          cityId: syntheticCityId(1),
          officialName: "Candidate 1",
          countryCode: "SI",
          coordinate: { lat: 46, lng: 14 },
        },
        rank: 1,
        score: "0",
        coverage: "0",
        status: "pending",
        statusLabel: "Проверяется",
      }],
      progress: [progress],
      cards: [],
      canContinue: false,
    });
    expect(Object.isFrozen(view)).toBe(true);
    expect(Object.isFrozen(view.progress)).toBe(true);
    expect(Object.isFrozen(view.progress[0])).toBe(true);
  });

  // Break caught: hiding a received durable marker after EOF failure, or publishing terminal
  // authority before the withheld completion frame is verified by clean EOF.
  test("projects committed truth and reload requirement after post-commit transport failure", async () => {
    const viewModule = await loadCityFrontierViewModelModule() as unknown as
      WishedCityFrontierViewModule;
    const base = syntheticWorkingReadModel(3, 0, BROWSER_BASE_REVISION_ID);
    const successor = syntheticSuccessor(base, {
      id: BROWSER_WORKING_REVISION_ID,
      kind: "working",
    });
    const activation: CityFrontierEvent = {
      type: "city_activated",
      runId: BROWSER_RUN_ID,
      baseRevisionId: BROWSER_BASE_REVISION_ID,
      sequence: 1,
      occurredAt: "2026-08-27T12:00:00.000Z",
      cityId: syntheticCityId(1),
      rank: 1,
    };
    const commit: CityFrontierEvent = {
      type: "city_revision_committed",
      runId: BROWSER_RUN_ID,
      baseRevisionId: BROWSER_BASE_REVISION_ID,
      sequence: 2,
      occurredAt: "2026-08-27T12:00:01.000Z",
      marker: successor.markers.at(-1)!,
      revision: successor,
    };
    let state = viewModule.beginCityFrontierContinuation(base);
    state = viewModule.reduceCityFrontierContinuationEvent(state, activation);
    state = viewModule.reduceCityFrontierContinuationEvent(state, commit);

    const view = viewModule.projectCityFrontierView(
      viewModule.failCityFrontierContinuation(state, "connection_lost"),
    );
    const marker = successor.markers.at(-1)!;

    expect(view).toMatchObject({
      transportError: "connection_lost",
      requiresVerifiedReload: true,
      candidates: [{
        city: {
          cityId: marker.cityId,
          officialName: "Candidate 1",
          countryCode: "SI",
          coordinate: { lat: 46, lng: 14 },
        },
        rank: marker.rank,
        score: "0",
        coverage: "0",
        status: "red",
        statusLabel: "Исключён",
        facts: marker.facts,
        verificationCoverage: marker.verificationCoverage,
        lastCheckedAt: marker.lastCheckedAt,
      }],
      progress: [],
      cards: [],
      canContinue: false,
    });
    expect("selectionHistory" in view).toBe(false);
    expect("stopCondition" in view).toBe(false);
    expect(Object.isFrozen(view)).toBe(true);
    expect(Object.isFrozen(view.candidates[0])).toBe(true);
  });
});
