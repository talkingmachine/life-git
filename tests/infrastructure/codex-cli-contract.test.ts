import { getEventListeners, getMaxListeners, setMaxListeners } from "node:events";

import { describe, expect, test, vi } from "vitest";

import {
  CodexRuntimeError,
  MAX_CODEX_EVENTS,
  MAX_CODEX_PROMPT_BYTES,
  MAX_CODEX_STDERR_BYTES,
  MAX_CODEX_STDOUT_BYTES,
  MAX_CODEX_TIMEOUT_MS,
  createCodexJsonInvocation,
} from "../../src/infrastructure/codex-cli/contracts";
import { snapshotOwnedJson } from "../../src/infrastructure/codex-cli/owned-json";

const NATIVE_ABORTED_GETTER = Object.getOwnPropertyDescriptor(AbortSignal.prototype, "aborted")?.get;

function readNativeAborted(signal: AbortSignal): boolean {
  if (NATIVE_ABORTED_GETTER === undefined) throw new Error("missing native AbortSignal aborted getter");
  return NATIVE_ABORTED_GETTER.call(signal) as boolean;
}

function validInvocation(
  overrides: Record<string, unknown> = {},
): Parameters<typeof createCodexJsonInvocation>[0] {
  return {
    capability: "onboarding.extract",
    reasoningEffort: "low",
    toolPolicy: "codex-tools-none@2",
    templateVersion: "extract@1",
    schemaVersion: "onboarding-extraction@1",
    prompt: "synthetic",
    outputSchema: { type: "object", properties: { name: { type: "string" } } },
    limits: {
      timeoutMs: 15_000,
      maxStdoutBytes: 65_536,
      maxStderrBytes: 16_384,
      maxEvents: 64,
    },
    signal: new AbortController().signal,
    ...overrides,
  } as Parameters<typeof createCodexJsonInvocation>[0];
}

describe("snapshotOwnedJson", () => {
  test("copies nested JSON values without retaining source references", () => {
    const source = { nested: { values: ["first", 2, null] } };

    const snapshot = snapshotOwnedJson(source);
    source.nested.values[0] = "changed";

    expect(snapshot).toEqual({ nested: { values: ["first", 2, null] } });
  });

  test.each([
    ["undefined", undefined],
    ["a bigint", 1n],
    ["a symbol", Symbol("schema")],
    ["a function", () => undefined],
    ["a non-finite number", Number.NaN],
    ["positive infinity", Number.POSITIVE_INFINITY],
    ["a date", new Date()],
    ["a typed array", Uint8Array.of(1)],
  ])("rejects %s", (_name, value) => {
    expect(() => snapshotOwnedJson(value)).toThrowError("codex_protocol_invalid");
  });

  test("rejects an accessor without executing it", () => {
    const getter = vi.fn(() => "never");
    const input = Object.create(Object.prototype, {
      value: { enumerable: true, get: getter },
    });

    expect(() => snapshotOwnedJson(input)).toThrowError("codex_protocol_invalid");
    expect(getter).not.toHaveBeenCalled();
  });

  test.each([
    ["a symbol property", (() => {
      const value = { type: "object" };
      Object.defineProperty(value, Symbol("hidden"), { value: "hidden" });
      return value;
    })()],
    ["a custom object prototype", Object.assign(Object.create({ inherited: true }), { type: "object" })],
    ["an inherited property", Object.create({ type: "object" })],
    ["a sparse array", (() => {
      const value = new Array<unknown>(1);
      return value;
    })()],
    ["a decorated array", Object.assign(["allowed"], { extra: "rejected" })],
    ["a cycle", (() => {
      const value: { self?: unknown } = {};
      value.self = value;
      return value;
    })()],
  ])("rejects %s", (_name, value) => {
    expect(() => snapshotOwnedJson(value)).toThrowError("codex_protocol_invalid");
  });
});

describe("createCodexJsonInvocation", () => {
  test("rejects the superseded web-search policy revision", () => {
    expect(() => createCodexJsonInvocation({
      ...validInvocation(), capability: "source.discover", reasoningEffort: "medium",
      toolPolicy: "codex-tools-web-search@1" as never,
    })).toThrowError("codex_protocol_invalid");
  });
  test("allows web search only for medium source discovery", () => {
    const invocation = createCodexJsonInvocation({
      capability: "source.discover",
      reasoningEffort: "medium",
      toolPolicy: "codex-tools-web-search@2",
      templateVersion: "official-source-discover@2",
      schemaVersion: "official-source-candidates@1",
      prompt: "synthetic public input",
      outputSchema: { type: "object", additionalProperties: false, properties: {} },
      limits: { timeoutMs: 30_000, maxStdoutBytes: 131_072, maxStderrBytes: 16_384, maxEvents: 128 },
      signal: new AbortController().signal,
    });
    expect(invocation).toMatchObject({
      capability: "source.discover", reasoningEffort: "medium", toolPolicy: "codex-tools-web-search@1",
    });
    expect(() => createCodexJsonInvocation({ ...invocation, capability: "onboarding.extract" } as never))
      .toThrowError("codex_protocol_invalid");
  });
  test("returns a detached schema and preserves the supplied runtime limits", () => {
    const schema = { type: "object", properties: { answer: { type: "string" } } };
    const invocation = createCodexJsonInvocation(validInvocation({ outputSchema: schema }));
    schema.properties.answer.type = "number";

    expect(invocation).toMatchObject({
      capability: "onboarding.extract",
      templateVersion: "extract@1",
      schemaVersion: "onboarding-extraction@1",
      prompt: "synthetic",
      outputSchema: { type: "object", properties: { answer: { type: "string" } } },
      limits: { timeoutMs: 15_000, maxStdoutBytes: 65_536, maxStderrBytes: 16_384, maxEvents: 64 },
    });
  });

  test("rejects a schema accessor without executing it", () => {
    const getter = vi.fn(() => ({ type: "object" }));
    const schema = Object.create(null, { type: { enumerable: true, get: getter } });

    expect(() => createCodexJsonInvocation(validInvocation({ outputSchema: schema })))
      .toThrowError("codex_protocol_invalid");
    expect(getter).not.toHaveBeenCalled();
  });

  test("rejects a top-level accessor without executing it", () => {
    const getter = vi.fn(() => "onboarding_extract");
    const input = validInvocation();
    Object.defineProperty(input, "capability", { enumerable: true, get: getter });

    expect(() => createCodexJsonInvocation(input)).toThrowError("codex_protocol_invalid");
    expect(getter).not.toHaveBeenCalled();
  });

  test("rejects a top-level extra key", () => {
    expect(() => createCodexJsonInvocation(validInvocation({ unexpected: true })))
      .toThrowError("codex_protocol_invalid");
  });

  test("rejects a transparent Proxy around an otherwise valid invocation", () => {
    const input = new Proxy(validInvocation(), {});

    expect(() => createCodexJsonInvocation(input)).toThrowError("codex_protocol_invalid");
  });

  test("rejects a limits accessor without executing it", () => {
    const getter = vi.fn(() => 15_000);
    const input = validInvocation();
    Object.defineProperty(input.limits, "timeoutMs", { enumerable: true, get: getter });

    expect(() => createCodexJsonInvocation(input)).toThrowError("codex_protocol_invalid");
    expect(getter).not.toHaveBeenCalled();
  });

  test("rejects a limits extra key", () => {
    expect(() => createCodexJsonInvocation(validInvocation({ limits: {
      ...validInvocation().limits,
      unexpected: true,
    } }))).toThrowError("codex_protocol_invalid");
  });

  test("rejects a transparent Proxy around otherwise valid limits", () => {
    const input = validInvocation({ limits: new Proxy(validInvocation().limits, {}) });

    expect(() => createCodexJsonInvocation(input)).toThrowError("codex_protocol_invalid");
  });

  test("validates a genuine decorated AbortSignal without invoking caller accessors", () => {
    const stringGetter = vi.fn(() => "caller-owned");
    const symbolGetter = vi.fn(() => "caller-owned");
    const decoration = Symbol("decoration");
    const signal = new AbortController().signal;
    Object.defineProperty(signal, "aborted", { enumerable: true, get: stringGetter });
    Object.defineProperty(signal, decoration, { enumerable: true, get: symbolGetter });

    const invocation = createCodexJsonInvocation(validInvocation({ signal }));

    expect(stringGetter).not.toHaveBeenCalled();
    expect(symbolGetter).not.toHaveBeenCalled();
    expect(readNativeAborted(invocation.signal)).toBe(false);
  });

  test("normalizes AbortSignal brand-check failures without invoking caller accessors", () => {
    const getter = vi.fn(() => false);
    const lookalike = Object.create(AbortSignal.prototype) as AbortSignal;
    Object.defineProperty(lookalike, "aborted", { enumerable: true, get: getter });

    let thrown: unknown;
    try {
      createCodexJsonInvocation(validInvocation({ signal: lookalike }));
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(CodexRuntimeError);
    expect(thrown).toMatchObject({ code: "codex_protocol_invalid", message: "codex_protocol_invalid" });
    expect(getter).not.toHaveBeenCalled();
  });

  test.each([
    ["controller", new AbortController().signal],
    ["timeout", AbortSignal.timeout(1_000)],
    ["any", AbortSignal.any([new AbortController().signal])],
  ])("accepts an active native AbortSignal.%s variant", (_name, signal) => {
    expect(() => createCodexJsonInvocation(validInvocation({ signal }))).not.toThrow();
  });

  test("preserves a later source abort on the invocation signal", () => {
    const controller = new AbortController();
    const invocation = createCodexJsonInvocation(validInvocation({ signal: controller.signal }));

    expect(readNativeAborted(invocation.signal)).toBe(false);
    controller.abort();
    expect(readNativeAborted(invocation.signal)).toBe(true);
  });

  test("preserves a real abort after a synthetic abort event", () => {
    const controller = new AbortController();
    const invocation = createCodexJsonInvocation(validInvocation({ signal: controller.signal }));

    controller.signal.dispatchEvent(new Event("abort"));
    expect(readNativeAborted(invocation.signal)).toBe(false);

    controller.abort();
    expect(readNativeAborted(invocation.signal)).toBe(true);
  });

  test("retains no listeners or warnings for repeated use of one active signal", async () => {
    const controller = new AbortController();
    const signal = controller.signal;
    const originalMaxListeners = getMaxListeners(signal);
    const warnings: Error[] = [];
    const recordWarning = (warning: Error): void => {
      if (warning.name === "MaxListenersExceededWarning" && warning.message.includes("AbortSignal")) {
        warnings.push(warning);
      }
    };
    let retainedListenerCount = -1;
    let warningCount = -1;

    setMaxListeners(10, signal);
    process.on("warning", recordWarning);
    try {
      for (let index = 0; index < 11; index += 1) {
        createCodexJsonInvocation(validInvocation({ signal }));
      }
      await new Promise<void>((resolve) => setImmediate(resolve));
      retainedListenerCount = getEventListeners(signal, "abort").length;
      warningCount = warnings.length;
    } finally {
      process.off("warning", recordWarning);
      controller.abort();
      setMaxListeners(originalMaxListeners, signal);
    }

    expect(retainedListenerCount).toBe(0);
    expect(warningCount).toBe(0);
  });

  test("rejects a pre-aborted signal without invoking a caller accessor", () => {
    const getter = vi.fn(() => false);
    const controller = new AbortController();
    controller.abort();
    Object.defineProperty(controller.signal, "aborted", { enumerable: true, get: getter });

    expect(() => createCodexJsonInvocation(validInvocation({ signal: controller.signal })))
      .toThrowError("codex_protocol_invalid");
    expect(getter).not.toHaveBeenCalled();
  });

  test("accepts an empty prompt and version strings at the UTF-8 byte limit", () => {
    const boundaryText = "x".repeat(MAX_CODEX_PROMPT_BYTES);

    expect(() => createCodexJsonInvocation(validInvocation({
      templateVersion: boundaryText,
      schemaVersion: boundaryText,
      prompt: "",
    }))).not.toThrow();
  });

  test.each([
    ["unknown capability", { capability: "other" }],
    ["empty template version", { templateVersion: "" }],
    ["empty schema version", { schemaVersion: "" }],
    ["a template version over the UTF-8 byte limit", {
      templateVersion: "x".repeat(MAX_CODEX_PROMPT_BYTES + 1),
    }],
    ["a schema version over the UTF-8 byte limit", {
      schemaVersion: "x".repeat(MAX_CODEX_PROMPT_BYTES + 1),
    }],
    ["a prompt over the UTF-8 byte limit", { prompt: "x".repeat(MAX_CODEX_PROMPT_BYTES + 1) }],
    ["a non-string prompt", { prompt: 1 }],
    ["an aborted signal", (() => {
      const controller = new AbortController();
      controller.abort();
      return { signal: controller.signal };
    })()],
    ["a fake signal", { signal: { aborted: false } }],
  ])("rejects %s", (_name, overrides) => {
    expect(() => createCodexJsonInvocation(validInvocation(overrides))).toThrowError("codex_protocol_invalid");
  });

  test.each([
    ["timeoutMs", 0, MAX_CODEX_TIMEOUT_MS],
    ["maxStdoutBytes", 0, MAX_CODEX_STDOUT_BYTES],
    ["maxStderrBytes", 0, MAX_CODEX_STDERR_BYTES],
    ["maxEvents", 0, MAX_CODEX_EVENTS],
  ])("rejects %s outside its closed integer range", (key, lower, upper) => {
    for (const value of [lower, upper + 1, 1.5, Number.NaN]) {
      expect(() => createCodexJsonInvocation(validInvocation({ limits: {
        ...validInvocation().limits,
        [key]: value,
      } }))).toThrowError("codex_protocol_invalid");
    }
  });
});
