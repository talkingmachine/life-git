import { afterEach, describe, expect, test, vi } from "vitest";

import type {
  CompleteOnboardingResult,
  ExtractOnboardingMessageCommand,
} from "../../src/application/onboarding-contracts";
import type {
  PlaceFrontierApplication,
  PlaceFrontierPrepared,
} from "../../src/application/place-frontier";
import {
  createOnboardingSession,
  type OnboardingSessionState,
} from "../../src/decision/onboarding-session";

import {
  MAX_ONBOARDING_REQUEST_BODY_BYTES,
  readBoundedOnboardingJson,
} from "../../src/app/api/onboarding/route-contract";

function streamingRequest(
  stream: ReadableStream<Uint8Array>,
  contentType = "application/json; charset=utf-8",
): Request {
  return new Request("http://localhost/api/onboarding/message", {
    method: "POST",
    headers: { "content-type": contentType },
    body: stream,
    duplex: "half",
  } as RequestInit & { readonly duplex: "half" });
}

function byteStream(...chunks: readonly Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

function deferredVoid(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let resolve = (): void => undefined;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function jsonRequest(body: string, contentType = "application/json"): Request {
  return new Request("http://localhost/api/onboarding/message", {
    method: "POST",
    headers: { "content-type": contentType },
    body,
  });
}

const PARTICIPANT_ID = "00000000-0000-4000-8000-000000000001";
const COMMAND_ID = "10000000-0000-4000-8000-000000000001";
const MESSAGE_ID = "20000000-0000-4000-8000-000000000001";

function session(): OnboardingSessionState {
  return createOnboardingSession({
    nextParticipantId: () => PARTICIPANT_ID,
    nextCompletionCommandId: () => COMMAND_ID,
  });
}

function priorMessageId(index: number): string {
  return `30000000-0000-4000-8000-${String(index + 100).padStart(12, "0")}`;
}

function sessionWithMessages(count: number): OnboardingSessionState {
  return {
    ...session(),
    messages: Array.from({ length: count }, (_, index) => ({
      messageId: priorMessageId(index),
      role: index % 2 === 0 ? "user" as const : "assistant" as const,
      text: "Already sent.",
    })),
  };
}

function messageCommand(text = "Я живу в Москве"): ExtractOnboardingMessageCommand {
  return {
    schemaVersion: "onboarding-message-command@1",
    session: session(),
    message: { messageId: MESSAGE_ID, role: "user", text },
  };
}

function messageRequest(
  value: unknown = messageCommand(),
  signal?: AbortSignal,
): Request {
  return new Request("http://localhost/api/onboarding/message", {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify(value),
    ...(signal === undefined ? {} : { signal }),
  });
}

function continueRequest(value: unknown = {
  schemaVersion: "onboarding-continue-command@1",
  session: session(),
}): Request {
  return new Request("http://localhost/api/onboarding/continue", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(value),
  });
}

interface RouteApplication {
  readonly extractOnboardingMessage: (
    command: ExtractOnboardingMessageCommand,
    signal: AbortSignal,
  ) => Promise<OnboardingSessionState>;
  readonly completeOnboarding: (
    command: { readonly schemaVersion: "onboarding-continue-command@1"; readonly session: OnboardingSessionState },
    signal: AbortSignal,
  ) => Promise<CompleteOnboardingResult>;
  readonly runPlaceFrontier: PlaceFrontierApplication["runPlaceFrontier"];
  readonly preparePlaceFrontier?: PlaceFrontierApplication["preparePlaceFrontier"];
}

async function loadMessageRoute(application: RouteApplication) {
  vi.resetModules();
  const getConfirmedLifeApplication = vi.fn(() => application);
  vi.doMock("../../src/infrastructure/composition-root", () => ({
    getConfirmedLifeApplication,
  }));
  const route = await import("../../src/app/api/onboarding/message/route");
  return { POST: route.POST, getConfirmedLifeApplication };
}

async function loadContinueRoute(
  application: RouteApplication,
  createPlaceFrontierStreamResponse = vi.fn(),
) {
  vi.resetModules();
  const getConfirmedLifeApplication = vi.fn(() => application);
  vi.doMock("../../src/infrastructure/composition-root", () => ({
    getConfirmedLifeApplication,
  }));
  vi.doMock("../../src/app/api/place-frontier/stream-response", () => ({
    createPlaceFrontierStreamResponse,
  }));
  const route = await import("../../src/app/api/onboarding/continue/route");
  return { POST: route.POST, createPlaceFrontierStreamResponse, getConfirmedLifeApplication };
}

describe("bounded onboarding JSON transport", () => {
  afterEach(() => {
    vi.doUnmock("../../src/infrastructure/composition-root");
    vi.doUnmock("../../src/app/api/place-frontier/stream-response");
    vi.restoreAllMocks();
  });

  test("accepts exactly 131,072 UTF-8 bytes and parses only the completed body", async () => {
    const encoder = new TextEncoder();
    const prefix = JSON.stringify({ ok: "да" });
    const body = prefix + " ".repeat(
      MAX_ONBOARDING_REQUEST_BODY_BYTES - encoder.encode(prefix).byteLength,
    );
    const bytes = encoder.encode(body);
    expect(bytes).toHaveLength(MAX_ONBOARDING_REQUEST_BODY_BYTES);
    const multibyteStart = bytes.indexOf(0xd0);
    const request = streamingRequest(byteStream(
      bytes.slice(0, multibyteStart + 1),
      bytes.slice(multibyteStart + 1),
    ));
    const parse = vi.spyOn(JSON, "parse");
    parse.mockClear();

    await expect(readBoundedOnboardingJson(
      request,
      new AbortController().signal,
    )).resolves.toEqual({ ok: "да" });

    expect(parse.mock.calls.filter(([input]) => input === body)).toHaveLength(1);
  });

  test("rejects 131,073 bytes before JSON.parse and cancels a chunked overflow", async () => {
    const prefix = new TextEncoder().encode(JSON.stringify({ ok: true }));
    const padding = new Uint8Array(MAX_ONBOARDING_REQUEST_BODY_BYTES - prefix.byteLength);
    padding.fill(0x20);
    const overflow = new Uint8Array([0x20]);
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(prefix);
        controller.enqueue(padding);
        controller.enqueue(overflow);
      },
      cancel,
    });
    const parse = vi.spyOn(JSON, "parse");

    await expect(readBoundedOnboardingJson(
      streamingRequest(stream),
      new AbortController().signal,
    )).rejects.toMatchObject({
      name: "OnboardingRequestError",
      message: "request_body_too_large",
    });

    expect(parse).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledOnce();
  });

  test("reports chunk overflow without waiting for an uncooperative source cancellation", async () => {
    const cancellation = deferredVoid();
    const cancelCalled = deferredVoid();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(MAX_ONBOARDING_REQUEST_BODY_BYTES));
        controller.enqueue(new Uint8Array([0x20]));
      },
      cancel: () => {
        cancelCalled.resolve();
        return cancellation.promise;
      },
    });
    const rejection = readBoundedOnboardingJson(
      streamingRequest(stream),
      new AbortController().signal,
    ).then(() => "resolved", () => "rejected");

    await cancelCalled.promise;
    let outcome: string | undefined;
    void rejection.then((value) => {
      outcome = value;
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    cancellation.resolve();

    expect(outcome).toBe("rejected");
  });

  test("requires exact JSON media and never consumes an unsupported request body", async () => {
    const request = streamingRequest(new ReadableStream<Uint8Array>(), "text/plain");

    await expect(readBoundedOnboardingJson(
      request,
      new AbortController().signal,
    )).rejects.toMatchObject({
      name: "OnboardingRequestError",
      message: "unsupported_media_type",
    });

    expect(request.bodyUsed).toBe(false);
  });

  test("cancels a pending body read and preserves the caller abort", async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      pull: () => new Promise<void>(() => undefined),
      cancel,
    });
    const controller = new AbortController();
    const reason = new DOMException("The operation was aborted", "AbortError");
    const pending = readBoundedOnboardingJson(streamingRequest(stream), controller.signal);

    controller.abort(reason);

    await expect(pending).rejects.toBe(reason);
    expect(cancel).toHaveBeenCalledWith(reason);
  });

  test.each([
    ["invalid JSON", "{\"secret\":\"private transcript\""],
    ["fatal UTF-8", new Uint8Array([0xc3, 0x28])],
  ] as const)("closes %s without retaining raw content in the error", async (_name, body) => {
    const request = typeof body === "string"
      ? jsonRequest(body)
      : streamingRequest(byteStream(body));

    const rejected = readBoundedOnboardingJson(request, new AbortController().signal);
    await expect(rejected).rejects.toMatchObject({
      name: "OnboardingRequestError",
      message: "invalid_json",
    });
    await expect(rejected).rejects.not.toMatchObject({
      message: expect.stringContaining("private transcript"),
    });
  });
});

describe("onboarding HTTP routes", () => {
  afterEach(() => {
    vi.doUnmock("../../src/infrastructure/composition-root");
    vi.doUnmock("../../src/app/api/place-frontier/stream-response");
    vi.restoreAllMocks();
  });

  function application(overrides: Partial<RouteApplication> = {}): RouteApplication {
    return {
      extractOnboardingMessage: vi.fn(async (command) => command.session),
      completeOnboarding: vi.fn(async (command): Promise<CompleteOnboardingResult> => ({
        kind: "blocked",
        session: command.session,
        issues: [{ fieldId: "current_location", reasonCode: "required_empty" }],
        followUpQuestion: "Заполните выделенные поля.",
      })),
      runPlaceFrontier: vi.fn(),
      preparePlaceFrontier: vi.fn(),
      ...overrides,
    };
  }

  test("message accepts only the exact command and returns the guarded session without caching", async () => {
    const composed = application();
    const { POST } = await loadMessageRoute(composed);
    const request = messageRequest();

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("no-store, no-transform");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await response.json()).toEqual(session());
    expect(composed.extractOnboardingMessage).toHaveBeenCalledWith(
      messageCommand(),
      request.signal,
    );
  });

  test("rejects unknown message keys before composition and never leaks invalid input", async () => {
    const composed = application();
    const { POST, getConfirmedLifeApplication } = await loadMessageRoute(composed);
    const secret = "private transcript";

    const response = await POST(messageRequest({ ...messageCommand(secret), extra: secret }));
    const body = await response.text();

    expect(response.status).toBe(400);
    expect(JSON.parse(body)).toMatchObject({ code: "invalid_input", status: 400 });
    expect(body).not.toContain(secret);
    expect(getConfirmedLifeApplication).not.toHaveBeenCalled();
    expect(composed.extractOnboardingMessage).not.toHaveBeenCalled();
  });

  test("maps the outer byte boundary before composition access", async () => {
    const composed = application();
    const { POST, getConfirmedLifeApplication } = await loadMessageRoute(composed);
    const valid = JSON.stringify(messageCommand("Moscow"));
    const exact = valid.padEnd(MAX_ONBOARDING_REQUEST_BODY_BYTES, " ");
    const oversized = `${exact} `;

    const accepted = await POST(jsonRequest(exact));
    const rejected = await POST(jsonRequest(oversized));

    expect(accepted.status).toBe(200);
    expect(rejected.status).toBe(413);
    expect((await rejected.json()).code).toBe("request_body_too_large");
    expect(getConfirmedLifeApplication).toHaveBeenCalledTimes(1);
    expect(composed.extractOnboardingMessage).toHaveBeenCalledTimes(1);
  });

  test("keeps the exact 8,192-byte user-message boundary", async () => {
    const composed = application();
    const { POST } = await loadMessageRoute(composed);

    const accepted = await POST(messageRequest(messageCommand("a".repeat(8_192))));
    const rejected = await POST(messageRequest(messageCommand("a".repeat(8_193))));

    expect(accepted.status).toBe(200);
    expect(rejected.status).toBe(400);
    expect(composed.extractOnboardingMessage).toHaveBeenCalledTimes(1);
  });

  test("accepts a new message with exactly 62 prior messages", async () => {
    const composed = application();
    const { POST, getConfirmedLifeApplication } = await loadMessageRoute(composed);
    const command: ExtractOnboardingMessageCommand = {
      schemaVersion: "onboarding-message-command@1",
      session: sessionWithMessages(62),
      message: { messageId: MESSAGE_ID, role: "user", text: "Last pair" },
    };
    const request = messageRequest(command);

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(getConfirmedLifeApplication).toHaveBeenCalledOnce();
    expect(composed.extractOnboardingMessage).toHaveBeenCalledWith(command, request.signal);
  });

  test("rejects a new message with 63 prior messages before composition access", async () => {
    const composed = application();
    const { POST, getConfirmedLifeApplication } = await loadMessageRoute(composed);
    const command: ExtractOnboardingMessageCommand = {
      schemaVersion: "onboarding-message-command@1",
      session: sessionWithMessages(63),
      message: { messageId: MESSAGE_ID, role: "user", text: "No remaining pair" },
    };

    const response = await POST(messageRequest(command));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "invalid_input", status: 400 });
    expect(getConfirmedLifeApplication).not.toHaveBeenCalled();
    expect(composed.extractOnboardingMessage).not.toHaveBeenCalled();
  });

  test.each([
    ["completion command", () => session(), COMMAND_ID],
    ["participant", () => session(), PARTICIPANT_ID],
    ["prior message", () => sessionWithMessages(1), priorMessageId(0)],
  ] as const)("rejects a messageId colliding with the %s before composition access", async (
    _owner,
    currentSession,
    collidingMessageId,
  ) => {
    const composed = application();
    const { POST, getConfirmedLifeApplication } = await loadMessageRoute(composed);
    const command: ExtractOnboardingMessageCommand = {
      schemaVersion: "onboarding-message-command@1",
      session: currentSession(),
      message: { messageId: collidingMessageId, role: "user", text: "Collision" },
    };

    const response = await POST(messageRequest(command));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "invalid_input", status: 400 });
    expect(getConfirmedLifeApplication).not.toHaveBeenCalled();
    expect(composed.extractOnboardingMessage).not.toHaveBeenCalled();
  });

  test("returns the exact blocked Continue JSON and never opens Frontier", async () => {
    const blocked: Extract<CompleteOnboardingResult, { readonly kind: "blocked" }> = {
      kind: "blocked",
      session: session(),
      issues: [{ fieldId: "current_location", reasonCode: "required_empty" }],
      followUpQuestion: "Заполните выделенные поля.",
    };
    const composed = application({ completeOnboarding: vi.fn(async () => blocked) });
    const streamResponse = vi.fn();
    const { POST } = await loadContinueRoute(composed, streamResponse);
    const request = continueRequest();

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(blocked);
    expect(composed.completeOnboarding).toHaveBeenCalledWith({
      schemaVersion: "onboarding-continue-command@1",
      session: session(),
    }, request.signal);
    expect(streamResponse).not.toHaveBeenCalled();
    expect(composed.runPlaceFrontier).not.toHaveBeenCalled();
  });

  test("rejects unknown Continue keys before composition access", async () => {
    const composed = application();
    const { POST, getConfirmedLifeApplication } = await loadContinueRoute(composed);
    const secret = "private continue payload";

    const response = await POST(continueRequest({
      schemaVersion: "onboarding-continue-command@1",
      session: session(),
      extra: secret,
    }));
    const body = await response.text();

    expect(response.status).toBe(400);
    expect(JSON.parse(body)).toMatchObject({ code: "invalid_input", status: 400 });
    expect(body).not.toContain(secret);
    expect(getConfirmedLifeApplication).not.toHaveBeenCalled();
    expect(composed.completeOnboarding).not.toHaveBeenCalled();
  });

  test("hands a launched Continue to the shared NDJSON response in the same POST", async () => {
    const prepared: PlaceFrontierPrepared = {
      runId: "onboarding-frontier:run",
      profileId: "a".repeat(64),
      preferenceProfileId: "b".repeat(64),
      assessmentAt: "2026-08-22T00:00:00.000Z",
      rankingSnapshotId: "onboarding-frontier:run:ranking",
      contextHash: "c".repeat(64),
    };
    const launched = {
      kind: "launched" as const,
      receipt: {
        schemaVersion: "onboarding-receipt@1" as const,
        receiptId: `onboarding-receipt:${"d".repeat(64)}`,
        completionCommandId: COMMAND_ID,
        confirmationDigest: "e".repeat(64),
        profileId: prepared.profileId,
        preferenceProfileId: prepared.preferenceProfileId,
        frontierRunId: prepared.runId,
        confirmedAt: prepared.assessmentAt,
      },
      prepared,
    };
    const composed = application({ completeOnboarding: vi.fn(async () => launched) });
    const expected = new Response("{\"type\":\"ranking_sealed\"}\n", {
      headers: { "content-type": "application/x-ndjson; charset=utf-8" },
    });
    const streamResponse = vi.fn(() => expected);
    const fetch = vi.spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("unexpected_fetch"));
    const { POST } = await loadContinueRoute(composed, streamResponse);
    const request = continueRequest();

    const response = await POST(request);

    expect(response).toBe(expected);
    expect(streamResponse).toHaveBeenCalledWith({
      signal: request.signal,
      prepared,
      runPlaceFrontier: composed.runPlaceFrontier,
    });
    expect(composed.preparePlaceFrontier).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  test("propagates request abort to the composed message use case", async () => {
    let observedSignal: AbortSignal | undefined;
    const started = deferredVoid();
    const composed = application({
      extractOnboardingMessage: vi.fn(async (_command, signal) => {
        observedSignal = signal;
        started.resolve();
        return await new Promise<never>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        });
      }),
    });
    const { POST } = await loadMessageRoute(composed);
    const controller = new AbortController();
    const request = messageRequest(messageCommand(), controller.signal);
    const pending = POST(request);
    await started.promise;
    const reason = new DOMException("The operation was aborted", "AbortError");

    controller.abort(reason);

    await expect(pending).rejects.toBe(reason);
    expect(observedSignal?.aborted).toBe(true);
  });

  test("closes arbitrary application failures without logging or returning their content", async () => {
    const secret = "secret model transcript";
    const composed = application({
      extractOnboardingMessage: vi.fn(async () => { throw new Error(secret); }),
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { POST } = await loadMessageRoute(composed);

    const response = await POST(messageRequest());
    const body = await response.text();

    expect(response.status).toBe(500);
    expect(body).not.toContain(secret);
    expect(consoleError).not.toHaveBeenCalled();
  });
});
