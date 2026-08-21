import { describe, expect, test, vi } from "vitest";

import {
  MAX_CODEX_EVENTS,
  MAX_CODEX_PROMPT_BYTES,
  MAX_CODEX_STDERR_BYTES,
  MAX_CODEX_STDOUT_BYTES,
  MAX_CODEX_TIMEOUT_MS,
  createCodexJsonInvocation,
} from "../../src/infrastructure/codex-cli/contracts";
import { snapshotOwnedJson } from "../../src/infrastructure/codex-cli/owned-json";

function validInvocation(
  overrides: Record<string, unknown> = {},
): Parameters<typeof createCodexJsonInvocation>[0] {
  return {
    capability: "onboarding_extract",
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
  test("returns a detached schema and preserves the supplied runtime limits", () => {
    const schema = { type: "object", properties: { answer: { type: "string" } } };
    const invocation = createCodexJsonInvocation(validInvocation({ outputSchema: schema }));
    schema.properties.answer.type = "number";

    expect(invocation).toMatchObject({
      capability: "onboarding_extract",
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

  test("rejects a decorated AbortSignal without executing its accessor", () => {
    const getter = vi.fn(() => false);
    const signal = new AbortController().signal;
    Object.defineProperty(signal, "aborted", { enumerable: true, get: getter });

    expect(() => createCodexJsonInvocation(validInvocation({ signal })))
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
