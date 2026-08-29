import { chmod, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createHash } from "node:crypto";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const probe = vi.hoisted(() => ({ run: vi.fn() }));
const RUNTIME_STATE_KEY = Symbol.for("confirmed-life.codex-cli-runtime@1");

vi.mock("../../src/infrastructure/codex-cli/feasibility-probe", () => ({
  runCodexJsonProbe: probe.run,
}));

import {
  CODEX_CLI_VERSION,
  CODEX_MODEL,
  CodexRuntimeError,
  createCodexJsonInvocation,
} from "../../src/infrastructure/codex-cli/contracts";
import {
  createCodexCliModelAdapterForTest,
} from "../../src/infrastructure/codex-cli/model-adapter";
import { codexPolicyFingerprint } from "../../src/infrastructure/codex-cli/policy";
import { CODEX_DISABLED_FEATURES } from "../../src/infrastructure/codex-cli/preflight";
import type { CodexProcessSpawner, SpawnedCodexProcess } from "../../src/infrastructure/codex-cli/process";

const createdDirectories: string[] = [];

beforeEach(() => {
  clearRuntimeState();
  probe.run.mockReset();
});

afterEach(async () => {
  clearRuntimeState();
  vi.unstubAllEnvs();
  vi.doUnmock("../../src/instrumentation-node");
  vi.doUnmock("../../src/infrastructure/codex-cli/runtime");
  vi.doUnmock("../../src/infrastructure/codex-cli/process");
  await Promise.all(createdDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("CodexCliModelAdapter", () => {
  test("rejects web search on a later alpha before any probe or spawn", async () => {
    const options = adapterOptions("codex-cli 0.149.0-alpha.5");
    const adapter = createCodexCliModelAdapterForTest(options);
    const invocation = createCodexJsonInvocation({
      ...validInvocation(),
      capability: "source.discover",
      reasoningEffort: "medium",
      toolPolicy: "codex-tools-web-search@2",
    });

    await expect(adapter.invokeJson(invocation)).rejects.toMatchObject({ code: "codex_version_mismatch" });

    expect(probe.run).not.toHaveBeenCalled();
    expect(options.spawner.spawn).not.toHaveBeenCalled();
  });

  test("retains later-alpha compatibility for a no-tool invocation", async () => {
    probe.run.mockResolvedValueOnce(successfulProbe('{"ok":true}'));
    const adapter = createCodexCliModelAdapterForTest(adapterOptions("codex-cli 0.149.0-alpha.5"));

    await expect(adapter.invokeJson(validInvocation())).resolves.toMatchObject({
      value: { ok: true },
      metadata: { cliVersion: "codex-cli 0.149.0-alpha.5", toolPolicy: "codex-tools-none@2" },
    });
    expect(probe.run).toHaveBeenCalledTimes(1);
  });

  test("forwards only a frozen bounded pool diagnostics snapshot", () => {
    const adapter = createCodexCliModelAdapterForTest(adapterOptions());
    const diagnostics = adapter.runtimeDiagnostics();
    expect(diagnostics).toEqual({ activeLeaders: 0, queuedFlights: 0, effectiveCeiling: 5 });
    expect(Object.isFrozen(diagnostics)).toBe(true);
    expect(Object.keys(diagnostics)).toEqual(["activeLeaders", "queuedFlights", "effectiveCeiling"]);
    expect(() => { (diagnostics as { activeLeaders: number }).activeLeaders = 99; }).toThrow();
    expect(adapter.runtimeDiagnostics()).toEqual({ activeLeaders: 0, queuedFlights: 0, effectiveCeiling: 5 });
  });

  test("returns an owned recursively frozen JSON value and frozen metadata", async () => {
    probe.run.mockResolvedValueOnce(successfulProbe('{"nested":{"values":[1,true]}}'));
    const adapter = createCodexCliModelAdapterForTest(adapterOptions());

    const result = await adapter.invokeJson(createCodexJsonInvocation({
      ...validInvocation(),
      templateVersion: "onboarding-extract@4",
      schemaVersion: "onboarding-extraction-wire@2",
    }));

    expect(result).toEqual({
      value: { nested: { values: [1, true] } },
      metadata: {
        invocationVersion: "codex-cli-invocation@2",
        protocolVersion: "codex-cli-protocol@2",
        compatibilityPolicy: "codex-cli-0.149.0-alpha.4-plus@2",
        cliVersion: "codex-cli 0.149.0-alpha.4",
        model: "gpt-5.6-terra",
        reasoningEffort: "low",
        toolPolicy: "codex-tools-none@2",
        templateVersion: "onboarding-extract@4",
        schemaVersion: "onboarding-extraction-wire@2",
      },
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.metadata)).toBe(true);
    expect(Object.isFrozen(result.value)).toBe(true);
    const nested = (result.value as { nested: { values: readonly unknown[] } }).nested;
    expect(Object.isFrozen(nested)).toBe(true);
    expect(Object.isFrozen(nested.values)).toBe(true);
  });

  test.each([
    ["malformed JSON", "not-json"],
    ["a non-finite parsed number", '{"value":1e400}'],
  ])("maps %s to codex_json_invalid without retry", async (_name, finalMessage) => {
    probe.run.mockResolvedValueOnce(successfulProbe(finalMessage));
    const adapter = createCodexCliModelAdapterForTest(adapterOptions());

    await expect(adapter.invokeJson(validInvocation()))
      .rejects.toMatchObject({ code: "codex_json_invalid" });
    expect(probe.run).toHaveBeenCalledTimes(1);
  });

  test("preserves a probe failure and never retries", async () => {
    const failure = new CodexRuntimeError("codex_process_failed");
    probe.run.mockRejectedValueOnce(failure);
    const adapter = createCodexCliModelAdapterForTest(adapterOptions());

    await expect(adapter.invokeJson(validInvocation())).rejects.toBe(failure);
    expect(probe.run).toHaveBeenCalledTimes(1);
  });

  test("honors an action abort that occurs before the parsed result is returned", async () => {
    const controller = new AbortController();
    const reason = new DOMException("cancelled", "AbortError");
    probe.run.mockImplementationOnce(async () => {
      controller.abort(reason);
      return successfulProbe('{"ok":true}');
    });
    const adapter = createCodexCliModelAdapterForTest(adapterOptions());

    await expect(adapter.invokeJson(validInvocation(controller.signal))).rejects.toBe(reason);
    expect(probe.run).toHaveBeenCalledTimes(1);
  });

  test("coalesces equivalent invocations without putting raw prompt or signals in the flight key", async () => {
    const first = new AbortController();
    const second = new AbortController();
    const gate = deferred<ReturnType<typeof successfulProbe>>();
    probe.run.mockReturnValueOnce(gate.promise);
    const adapter = createCodexCliModelAdapterForTest(adapterOptions());
    const invocation = validInvocation(first.signal);

    const firstResult = adapter.invokeJson(invocation);
    const secondResult = adapter.invokeJson(createCodexJsonInvocation({ ...invocation, signal: second.signal }));
    await vi.waitFor(() => expect(probe.run).toHaveBeenCalledTimes(1));
    expect(probe.run.mock.calls[0]?.[0].flightKey).toBe(independentFlightKey(invocation));
    gate.resolve(successfulProbe('{"ok":true}'));

    const [left, right] = await Promise.all([firstResult, secondResult]);
    expect(left).toBe(right);
    expect(Object.isFrozen(left.value)).toBe(true);
  });

  test.each([
    ["capability", { capability: "onboarding.review" }],
    ["effort", { reasoningEffort: "medium" }],
    ["prompt", { prompt: "other synthetic" }],
    ["schema", { outputSchema: { type: "object", properties: { value: { type: "string" } } } }],
    ["template", { templateVersion: "extract@2" }],
    ["schema version", { schemaVersion: "onboarding-extraction@2" }],
    ["limits", { limits: { timeoutMs: 15_001, maxStdoutBytes: 65_536, maxStderrBytes: 16_384, maxEvents: 64 } }],
  ])("starts distinct concurrent flights for changed %s", async (_name, change) => {
    const firstGate = deferred<ReturnType<typeof successfulProbe>>();
    const secondGate = deferred<ReturnType<typeof successfulProbe>>();
    probe.run.mockReturnValueOnce(firstGate.promise).mockReturnValueOnce(secondGate.promise);
    const adapter = createCodexCliModelAdapterForTest(adapterOptions());
    const base = validInvocation();
    const variant = createCodexJsonInvocation({ ...base, ...change } as never);
    const baseResult = adapter.invokeJson(base);
    const variantResult = adapter.invokeJson(variant);
    await vi.waitFor(() => expect(probe.run).toHaveBeenCalledTimes(2));
    expect(probe.run.mock.calls.map(([call]) => call.flightKey))
      .toEqual([independentFlightKey(base), independentFlightKey(variant)]);
    firstGate.resolve(successfulProbe('{"ok":true}'));
    secondGate.resolve(successfulProbe('{"ok":true}'));
    await Promise.all([baseResult, variantResult]);
    expect(probe.run).toHaveBeenCalledTimes(2);
  });

  test("starts a distinct concurrent flight for the reviewed discovery tool policy", async () => {
    const firstGate = deferred<ReturnType<typeof successfulProbe>>();
    const secondGate = deferred<ReturnType<typeof successfulProbe>>();
    probe.run.mockReturnValueOnce(firstGate.promise).mockReturnValueOnce(secondGate.promise);
    const adapter = createCodexCliModelAdapterForTest(adapterOptions());
    const base = validInvocation();
    const discovery = createCodexJsonInvocation({
      ...validInvocation(),
      capability: "source.discover",
      reasoningEffort: "medium",
      toolPolicy: "codex-tools-web-search@2",
    });
    const baseResult = adapter.invokeJson(base);
    const discoveryResult = adapter.invokeJson(discovery);
    await vi.waitFor(() => expect(probe.run).toHaveBeenCalledTimes(2));
    expect(probe.run.mock.calls.map(([call]) => call.flightKey)[0])
      .toBe(independentFlightKey(base));
    expect(probe.run.mock.calls.map(([call]) => call.flightKey)[1])
      .not.toBe(independentFlightKey(base));
    firstGate.resolve(successfulProbe('{"ok":true}'));
    secondGate.resolve(successfulProbe('{"ok":true}', 1));
    await Promise.all([baseResult, discoveryResult]);
    expect(probe.run).toHaveBeenCalledTimes(2);
  });

  test("retries one returned zero-search discovery and publishes only the successful attempt", async () => {
    probe.run
      .mockResolvedValueOnce(successfulProbe('{"attempt":"discarded"}', 0))
      .mockResolvedValueOnce(successfulProbe('{"attempt":"accepted"}', 1));
    const adapter = createCodexCliModelAdapterForTest({
      ...adapterOptions(),
      monotonicNowMs: vi.fn()
        .mockReturnValueOnce(100)
        .mockReturnValueOnce(1_100)
        .mockReturnValueOnce(1_200)
        .mockReturnValueOnce(1_300),
    });

    const outcome = await adapter.invokeJsonWithEventProof(discoveryInvocation());

    expect(outcome).toEqual({
      result: {
        value: { attempt: "accepted" },
        metadata: {
          invocationVersion: "codex-cli-invocation@2",
          protocolVersion: "codex-cli-protocol@2",
          compatibilityPolicy: "codex-cli-0.149.0-alpha.4-plus@2",
          cliVersion: "codex-cli 0.149.0-alpha.4",
          model: "gpt-5.4",
          reasoningEffort: "medium",
          toolPolicy: "codex-tools-web-search@1",
          templateVersion: "source-discovery@1",
          schemaVersion: "source-discovery@1",
        },
      },
      eventProof: { webSearchCount: 1 },
    });
    expect(probe.run).toHaveBeenCalledTimes(2);
    expect(Object.keys(outcome)).toEqual(["result", "eventProof"]);
    expect(Object.keys(outcome.result)).toEqual(["value", "metadata"]);
    expect(Object.keys(outcome.result.metadata)).toEqual([
      "invocationVersion", "protocolVersion", "compatibilityPolicy", "cliVersion", "model",
      "reasoningEffort", "toolPolicy", "templateVersion", "schemaVersion",
    ]);
    expect(Object.keys(outcome.eventProof)).toEqual(["webSearchCount"]);
    expect(Object.isFrozen(outcome)).toBe(true);
    expect(Object.isFrozen(outcome.result)).toBe(true);
    expect(Object.isFrozen(outcome.result.metadata)).toBe(true);
    expect(Object.isFrozen(outcome.eventProof)).toBe(true);
  });

  test.each([
    ["before the deadline", [0, 1, 2], "codex_search_not_performed"],
    ["at the deadline", [0, 1, 15_000], "codex_timeout"],
  ])("rejects a second returned zero-search discovery %s", async (_name, readings, code) => {
    probe.run.mockResolvedValue(successfulProbe('{"ok":true}', 0));
    const monotonicNowMs = vi.fn<() => number>();
    for (const reading of readings) monotonicNowMs.mockReturnValueOnce(reading);
    const adapter = createCodexCliModelAdapterForTest({
      ...adapterOptions(),
      monotonicNowMs,
    });

    await expect(adapter.invokeJson(discoveryInvocation()))
      .rejects.toMatchObject({ code });
    expect(probe.run).toHaveBeenCalledTimes(2);
  });

  test("keeps an invalid nonzero discovery proof terminal", async () => {
    probe.run.mockResolvedValueOnce(successfulProbe('{"ok":true}', 1.5));
    const adapter = createCodexCliModelAdapterForTest({
      ...adapterOptions(),
      monotonicNowMs: () => 0,
    });

    await expect(adapter.invokeJson(discoveryInvocation()))
      .rejects.toMatchObject({ code: "codex_tool_event" });
    expect(probe.run).toHaveBeenCalledTimes(1);
  });

  test("does not retry a thrown discovery tool-event failure", async () => {
    const failure = new CodexRuntimeError("codex_tool_event");
    probe.run.mockRejectedValueOnce(failure);
    const adapter = createCodexCliModelAdapterForTest({
      ...adapterOptions(),
      monotonicNowMs: () => 0,
    });

    await expect(adapter.invokeJson(discoveryInvocation())).rejects.toBe(failure);
    expect(probe.run).toHaveBeenCalledTimes(1);
  });

  test.each([
    ["fractional", 1.5],
    ["unsafe", Number.MAX_SAFE_INTEGER + 1],
    ["above maxEvents", 65],
  ])("does not retry a returned %s nonzero discovery proof", async (_name, webSearchCount) => {
    probe.run.mockResolvedValueOnce(successfulProbe('{"ok":true}', webSearchCount));
    const adapter = createCodexCliModelAdapterForTest({
      ...adapterOptions(),
      monotonicNowMs: () => 0,
    });

    await expect(adapter.invokeJson(discoveryInvocation()))
      .rejects.toMatchObject({ code: "codex_tool_event" });
    expect(probe.run).toHaveBeenCalledTimes(1);
  });

  test("checks the shared deadline before interpreting an invalid nonzero discovery proof", async () => {
    probe.run.mockResolvedValueOnce(successfulProbe('{"ok":true}', 1.5));
    const adapter = createCodexCliModelAdapterForTest({
      ...adapterOptions(),
      monotonicNowMs: vi.fn().mockReturnValueOnce(0).mockReturnValueOnce(15_000),
    });

    await expect(adapter.invokeJson(discoveryInvocation()))
      .rejects.toMatchObject({ code: "codex_timeout" });
    expect(probe.run).toHaveBeenCalledTimes(1);
  });

  test("does not retry invalid JSON returned with a valid discovery proof", async () => {
    probe.run.mockResolvedValueOnce(successfulProbe("not-json", 1));
    const adapter = createCodexCliModelAdapterForTest({
      ...adapterOptions(),
      monotonicNowMs: () => 0,
    });

    await expect(adapter.invokeJson(discoveryInvocation()))
      .rejects.toMatchObject({ code: "codex_json_invalid" });
    expect(probe.run).toHaveBeenCalledTimes(1);
  });

  test("never retries or reads the retry clock for a no-tool capability", async () => {
    probe.run.mockResolvedValueOnce(successfulProbe('{"ok":true}', 0));
    const monotonicNowMs = vi.fn(() => 0);
    const adapter = createCodexCliModelAdapterForTest({ ...adapterOptions(), monotonicNowMs });

    await expect(adapter.invokeJson(validInvocation())).resolves.toMatchObject({ value: { ok: true } });
    expect(probe.run).toHaveBeenCalledTimes(1);
    expect(monotonicNowMs).not.toHaveBeenCalled();
  });

  test("does not spawn a second discovery probe after all coalesced waiters abort", async () => {
    const first = new AbortController();
    const second = new AbortController();
    const firstReason = new DOMException("first cancelled", "AbortError");
    const secondReason = new DOMException("second cancelled", "AbortError");
    const firstGate = deferred<ReturnType<typeof successfulProbe>>();
    probe.run.mockReturnValueOnce(firstGate.promise);
    const adapter = createCodexCliModelAdapterForTest({
      ...adapterOptions(),
      monotonicNowMs: vi.fn().mockReturnValueOnce(0).mockReturnValueOnce(1),
    });

    const left = adapter.invokeJson(discoveryInvocation(first.signal));
    const right = adapter.invokeJson(discoveryInvocation(second.signal));
    await vi.waitFor(() => expect(probe.run).toHaveBeenCalledTimes(1));
    first.abort(firstReason);
    second.abort(secondReason);
    firstGate.resolve(successfulProbe('{"discarded":true}', 0));

    await expect(left).rejects.toBe(firstReason);
    await expect(right).rejects.toBe(secondReason);
    await vi.waitFor(() => expect(probe.run).toHaveBeenCalledTimes(1));
  });

  test("continues the shared retry when one waiter aborts and another survives", async () => {
    const first = new AbortController();
    const second = new AbortController();
    const firstReason = new DOMException("first cancelled", "AbortError");
    const firstGate = deferred<ReturnType<typeof successfulProbe>>();
    probe.run
      .mockReturnValueOnce(firstGate.promise)
      .mockResolvedValueOnce(successfulProbe('{"survivor":true}', 1));
    const adapter = createCodexCliModelAdapterForTest({
      ...adapterOptions(),
      monotonicNowMs: vi.fn()
        .mockReturnValueOnce(0)
        .mockReturnValueOnce(1)
        .mockReturnValueOnce(2)
        .mockReturnValueOnce(3),
    });

    const abandoned = adapter.invokeJson(discoveryInvocation(first.signal));
    const survivor = adapter.invokeJson(discoveryInvocation(second.signal));
    await vi.waitFor(() => expect(probe.run).toHaveBeenCalledTimes(1));
    first.abort(firstReason);
    firstGate.resolve(successfulProbe('{"discarded":true}', 0));

    await expect(abandoned).rejects.toBe(firstReason);
    await expect(survivor).resolves.toMatchObject({ value: { survivor: true } });
    expect(probe.run).toHaveBeenCalledTimes(2);
  });

  test("shares both retry attempts and the successful result identity across concurrent callers", async () => {
    const first = new AbortController();
    const second = new AbortController();
    const firstGate = deferred<ReturnType<typeof successfulProbe>>();
    probe.run
      .mockReturnValueOnce(firstGate.promise)
      .mockResolvedValueOnce(successfulProbe('{"shared":true}', 1));
    const adapter = createCodexCliModelAdapterForTest({
      ...adapterOptions(),
      monotonicNowMs: vi.fn()
        .mockReturnValueOnce(0)
        .mockReturnValueOnce(1)
        .mockReturnValueOnce(2)
        .mockReturnValueOnce(3),
    });

    const leftPromise = adapter.invokeJson(discoveryInvocation(first.signal));
    const rightPromise = adapter.invokeJson(discoveryInvocation(second.signal));
    await vi.waitFor(() => expect(probe.run).toHaveBeenCalledTimes(1));
    firstGate.resolve(successfulProbe('{"discarded":true}', 0));

    const [left, right] = await Promise.all([leftPromise, rightPromise]);
    expect(probe.run).toHaveBeenCalledTimes(2);
    expect(left).toBe(right);
    expect(left.value).toEqual({ shared: true });
  });

  test("uses one shared monotonic deadline and an owned remaining-time retry invocation", async () => {
    probe.run
      .mockResolvedValueOnce(successfulProbe('{"discarded":true}', 0))
      .mockResolvedValueOnce(successfulProbe('{"accepted":true}', 1));
    const monotonicNowMs = vi.fn()
      .mockReturnValueOnce(100)
      .mockReturnValueOnce(1_200.9)
      .mockReturnValueOnce(1_300)
      .mockReturnValueOnce(1_400);
    const adapter = createCodexCliModelAdapterForTest({ ...adapterOptions(), monotonicNowMs });
    const invocation = discoveryInvocation();

    await adapter.invokeJson(invocation);

    const first = probe.run.mock.calls[0]?.[0].invocation;
    const second = probe.run.mock.calls[1]?.[0].invocation;
    expect(first.limits.timeoutMs).toBe(15_000);
    expect(second.limits.timeoutMs).toBe(13_899);
    expect(first).not.toBe(invocation);
    expect(second).not.toBe(first);
    expect(second.limits).not.toBe(first.limits);
    expect(first.signal).toBe(second.signal);
    expect(second.prompt).toBe(first.prompt);
    expect(second.outputSchema).toBe(first.outputSchema);
    expect(second.capability).toBe(first.capability);
    expect(second.reasoningEffort).toBe(first.reasoningEffort);
    expect(second.toolPolicy).toBe(first.toolPolicy);
    expect(second.templateVersion).toBe(first.templateVersion);
    expect(second.schemaVersion).toBe(first.schemaVersion);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(second)).toBe(true);
    expect(Object.isFrozen(second.limits)).toBe(true);
    expect(monotonicNowMs).toHaveBeenCalledTimes(4);
  });

  test("fails an exhausted shared discovery deadline before a second probe", async () => {
    probe.run.mockResolvedValueOnce(successfulProbe('{"discarded":true}', 0));
    const adapter = createCodexCliModelAdapterForTest({
      ...adapterOptions(),
      monotonicNowMs: vi.fn().mockReturnValueOnce(0).mockReturnValueOnce(15_000),
    });

    await expect(adapter.invokeJson(discoveryInvocation()))
      .rejects.toMatchObject({ code: "codex_timeout" });
    expect(probe.run).toHaveBeenCalledTimes(1);
  });

  test("rejects a valid second discovery result that returns after the shared deadline", async () => {
    probe.run
      .mockResolvedValueOnce(successfulProbe('{"discarded":true}', 0))
      .mockResolvedValueOnce(successfulProbe('{"late":true}', 1));
    const adapter = createCodexCliModelAdapterForTest({
      ...adapterOptions(),
      monotonicNowMs: vi.fn()
        .mockReturnValueOnce(0)
        .mockReturnValueOnce(1)
        .mockReturnValueOnce(15_000),
    });

    await expect(adapter.invokeJson(discoveryInvocation()))
      .rejects.toMatchObject({ code: "codex_timeout" });
    expect(probe.run).toHaveBeenCalledTimes(2);
  });

  test.each([
    ["backward", 9],
    ["nonfinite", Number.NaN],
  ])("fails closed on a %s final clock observation after a valid discovery proof", async (_name, finalReading) => {
    probe.run.mockResolvedValueOnce(successfulProbe('{"ok":true}', 1));
    const adapter = createCodexCliModelAdapterForTest({
      ...adapterOptions(),
      monotonicNowMs: vi.fn()
        .mockReturnValueOnce(0)
        .mockReturnValueOnce(10)
        .mockReturnValueOnce(finalReading),
    });

    await expect(adapter.invokeJson(discoveryInvocation()))
      .rejects.toMatchObject({ code: "codex_process_failed" });
    expect(probe.run).toHaveBeenCalledTimes(1);
  });

  test.each([
    ["an invalid initial value", vi.fn(() => Number.NaN), 0],
    ["a backward retry value", vi.fn().mockReturnValueOnce(10).mockReturnValueOnce(9), 1],
    ["an invalid retry value", vi.fn().mockReturnValueOnce(0).mockReturnValueOnce(Number.POSITIVE_INFINITY), 1],
    ["a throwing clock", vi.fn(() => { throw new Error("must-not-leak"); }), 0],
  ])("fails closed on %s without leaking clock details", async (_name, monotonicNowMs, probeCount) => {
    probe.run.mockResolvedValue(successfulProbe('{"discarded":true}', 0));
    const adapter = createCodexCliModelAdapterForTest({ ...adapterOptions(), monotonicNowMs });

    const failure = await adapter.invokeJson(discoveryInvocation()).catch((error: unknown) => error);

    expect(failure).toEqual(expect.objectContaining({ code: "codex_process_failed" }));
    expect((failure as Error).message).toBe("codex_process_failed");
    expect(JSON.stringify(failure)).not.toContain("must-not-leak");
    expect(probe.run).toHaveBeenCalledTimes(probeCount);
  });

  test("rejects non-function, proxied, and accessor retry clocks without invoking them", () => {
    const proxiedClock = new Proxy(vi.fn(() => 0), {});
    const cases: unknown[] = [7, proxiedClock];
    for (const monotonicNowMs of cases) {
      expect(() => createCodexCliModelAdapterForTest({
        ...adapterOptions(),
        monotonicNowMs,
      } as never)).toThrowError(expect.objectContaining({ code: "codex_process_failed" }));
    }
    expect(proxiedClock).not.toHaveBeenCalled();

    const getter = vi.fn(() => () => 0);
    const options = adapterOptions() as ReturnType<typeof adapterOptions> & { monotonicNowMs?: () => number };
    Object.defineProperty(options, "monotonicNowMs", { enumerable: true, get: getter });
    expect(() => createCodexCliModelAdapterForTest(options))
      .toThrowError(expect.objectContaining({ code: "codex_process_failed" }));
    expect(getter).not.toHaveBeenCalled();
  });

  test("binds the private zero-search retry revision into the independent flight identity", async () => {
    probe.run.mockResolvedValueOnce(successfulProbe('{"ok":true}', 0));
    const adapter = createCodexCliModelAdapterForTest(adapterOptions());
    const invocation = validInvocation();

    await adapter.invokeJson(invocation);

    const flightKey = probe.run.mock.calls[0]?.[0].flightKey;
    expect(flightKey).toBe(independentFlightKey(invocation));
    expect(flightKey).not.toBe(independentFlightKey(invocation, false));
  });
});

describe("Codex CLI runtime singleton", () => {
  test("shares one startup chain and publishes one stable adapter only after all checks", async () => {
    const fixture = await runtimeFixture();
    const runtime = await freshRuntime();

    await Promise.all([
      runtime.initializeCodexCliRuntime(fixture.input),
      runtime.initializeCodexCliRuntime(fixture.input),
    ]);

    expect(fixture.spawner.spawn).toHaveBeenCalledTimes(3);
    expect(runtime.getCodexCliModelAdapter().invokeJson).toBeTypeOf("function");
    expect(runtime.getCodexCliModelAdapter()).toBe(runtime.getCodexCliModelAdapter());
    for (const call of fixture.spawner.spawn.mock.calls) {
      expect(call[0].env).toEqual({
        CODEX_HOME: "/synthetic/codex-home",
        TMPDIR: fixture.tempRoot,
        LANG: "C",
        LC_ALL: "C",
      });
    }
  });

  test("does not cache a failed partial initialization", async () => {
    const fixture = await runtimeFixture({ failFirstProcess: true });
    const runtime = await freshRuntime();

    expect(() => runtime.getCodexCliModelAdapter())
      .toThrowError(expect.objectContaining({ code: "codex_process_failed" }));
    await expect(runtime.initializeCodexCliRuntime(fixture.input))
      .rejects.toMatchObject({ code: "codex_process_failed" });
    const recovered = await runtimeFixture();
    await runtime.initializeCodexCliRuntime(recovered.input);
    expect(fixture.spawner.spawn).toHaveBeenCalledTimes(1);
    expect(recovered.spawner.spawn).toHaveBeenCalledTimes(3);
  });

  test("does not retain the startup signal or borrowed child environment", async () => {
    const controller = new AbortController();
    const fixture = await runtimeFixture({ signal: controller.signal });
    const runtime = await freshRuntime();
    await runtime.initializeCodexCliRuntime(fixture.input);
    fixture.borrowedEnvironment.CODEX_HOME = "/mutated";
    controller.abort();
    probe.run.mockResolvedValueOnce(successfulProbe('{"ok":true}'));

    await expect(runtime.getCodexCliModelAdapter().invokeJson(validInvocation()))
      .resolves.toMatchObject({ value: { ok: true } });
    expect(probe.run.mock.calls[0]?.[0].childEnv).toEqual({
      CODEX_HOME: "/synthetic/codex-home",
      TMPDIR: fixture.tempRoot,
      LANG: "C",
      LC_ALL: "C",
    });
  });

  test("publishes no adapter while the final feature inventory is still in flight", async () => {
    const fixture = await runtimeFixture({ holdInventory: true });
    const runtime = await freshRuntime();

    const initializing = runtime.initializeCodexCliRuntime(fixture.input);
    await vi.waitFor(() => expect(fixture.spawner.spawn).toHaveBeenCalledTimes(3));
    expect(() => runtime.getCodexCliModelAdapter())
      .toThrowError(expect.objectContaining({ code: "codex_process_failed" }));

    fixture.releaseInventory();
    await initializing;
    expect(runtime.getCodexCliModelAdapter().invokeJson).toBeTypeOf("function");
  });

  test("shares the initialized adapter across separately loaded server bundles", async () => {
    const fixture = await runtimeFixture();
    const instrumentationBundle = await freshRuntime();
    await instrumentationBundle.initializeCodexCliRuntime(fixture.input);
    const installed = instrumentationBundle.getCodexCliModelAdapter();

    vi.resetModules();
    const routeBundle = await import("../../src/infrastructure/codex-cli/runtime");

    expect(routeBundle.getCodexCliModelAdapter()).toBe(installed);
    await routeBundle.initializeCodexCliRuntime(fixture.input);
    expect(fixture.spawner.spawn).toHaveBeenCalledTimes(3);
  });

  test("keeps startup static and exposes the three explicit synthetic capability probes", async () => {
    const fixture = await runtimeFixture();
    const runtime = await freshRuntime();
    await runtime.initializeCodexCliRuntime(fixture.input);
    expect(probe.run).not.toHaveBeenCalled();
    probe.run
      .mockResolvedValueOnce(successfulProbe('{"schemaVersion":"codex-runtime-smoke@2","status":"ok"}', 0))
      .mockResolvedValueOnce(successfulProbe('{"schemaVersion":"codex-runtime-smoke@2","status":"ok"}', 0))
      .mockResolvedValueOnce(successfulProbe('{"schemaVersion":"codex-runtime-smoke@2","status":"ok"}', 1));

    await expect(runtime.verifyCodexCliCapabilities(new AbortController().signal)).resolves.toEqual({
      schemaVersion: "codex-runtime-capabilities@1", low: { webSearchCount: 0 }, medium: { webSearchCount: 0 }, discovery: { availability: "available", selection: "model-selected", webSearchCount: 1 },
    });
    expect(probe.run.mock.calls.map(([call]) => [call.invocation.reasoningEffort, call.invocation.toolPolicy]))
      .toEqual([["low", "codex-tools-none@2"], ["medium", "codex-tools-none@2"], ["medium", "codex-tools-web-search@2"]]);
    expect(probe.run.mock.calls[2]?.[0].invocation.prompt).toContain("official OpenAI developer documentation home");
  });

  test("rejects capability verification when zero-tool or discovery event proof is missing", async () => {
    const fixture = await runtimeFixture();
    const runtime = await freshRuntime();
    await runtime.initializeCodexCliRuntime(fixture.input);
    probe.run
      .mockResolvedValueOnce(successfulProbe('{"schemaVersion":"codex-runtime-smoke@2","status":"ok"}', 1))
      .mockResolvedValueOnce(successfulProbe('{"schemaVersion":"codex-runtime-smoke@2","status":"ok"}', 0))
      .mockResolvedValueOnce(successfulProbe('{"schemaVersion":"codex-runtime-smoke@2","status":"ok"}', 0));

    await expect(runtime.verifyCodexCliCapabilities(new AbortController().signal))
      .rejects.toMatchObject({ code: "codex_tool_event" });
  });
});

describe("Next instrumentation", () => {
  test("awaits one Node registration", async () => {
    const registration = deferred<void>();
    const registerNodeCodexRuntime = vi.fn(() => registration.promise);
    vi.doMock("../../src/instrumentation-node", () => ({ registerNodeCodexRuntime }));
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.resetModules();
    const instrumentation = await import("../../src/instrumentation");

    let settled = false;
    const pending = instrumentation.register().then(() => {
      settled = true;
    });
    await vi.waitFor(() => expect(registerNodeCodexRuntime).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    expect(settled).toBe(false);

    registration.resolve();
    await pending;
    expect(settled).toBe(true);
  });

  test("passes only the closed environment into runtime initialization", async () => {
    const initialize = vi.fn(async (input: unknown) => {
      void input;
    });
    vi.doMock("../../src/infrastructure/codex-cli/runtime", () => ({
      initializeCodexCliRuntime: initialize,
    }));
    vi.doMock("../../src/infrastructure/codex-cli/process", () => ({
      nodeCodexProcessSpawner: Object.freeze({ spawn: vi.fn() }),
    }));
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("CODEX_EXECUTABLE", "/Applications/ChatGPT.app/Contents/Resources/codex");
    vi.stubEnv("PATH", "/usr/bin:/bin");
    vi.stubEnv("TMPDIR", "/tmp");
    vi.stubEnv("CODEX_HOME", "/synthetic/codex-home");
    vi.stubEnv("LANG", "C");
    vi.stubEnv("LC_ALL", "C");
    vi.stubEnv("OPENAI_API_KEY", "must-not-cross");
    vi.resetModules();
    const instrumentation = await import("../../src/instrumentation-node");

    await instrumentation.registerNodeCodexRuntime();

    expect(initialize).toHaveBeenCalledTimes(1);
    expect(initialize).toHaveBeenCalledWith(expect.objectContaining({
      configuredExecutable: "/Applications/ChatGPT.app/Contents/Resources/codex",
      tempRootPath: "/tmp",
      childEnv: {
        CODEX_HOME: "/synthetic/codex-home",
        TMPDIR: "/tmp",
        LANG: "C",
        LC_ALL: "C",
      },
    }));
    expect(JSON.stringify(initialize.mock.calls[0]?.[0])).not.toContain("must-not-cross");
  });

  test.each([
    ["the Edge runtime", "edge", ""],
    ["a production build", "nodejs", "phase-production-build"],
  ])("does not import or initialize the Node runtime for %s", async (name, runtime, phase) => {
    void name;
    const nodeFactory = vi.fn(() => ({ registerNodeCodexRuntime: vi.fn() }));
    vi.doMock("../../src/instrumentation-node", nodeFactory);
    vi.stubEnv("NEXT_RUNTIME", runtime);
    vi.stubEnv("NEXT_PHASE", phase);
    vi.resetModules();
    const instrumentation = await import("../../src/instrumentation");

    await instrumentation.register();

    expect(nodeFactory).not.toHaveBeenCalled();
  });
});

function validInvocation(signal: AbortSignal = new AbortController().signal) {
  return createCodexJsonInvocation({
    capability: "onboarding.extract",
    reasoningEffort: "low",
    toolPolicy: "codex-tools-none@2",
    templateVersion: "extract@1",
    schemaVersion: "onboarding-extraction@1",
    prompt: "synthetic",
    outputSchema: { type: "object", additionalProperties: false },
    limits: {
      timeoutMs: 15_000,
      maxStdoutBytes: 65_536,
      maxStderrBytes: 16_384,
      maxEvents: 64,
    },
    signal,
  });
}

function discoveryInvocation(signal: AbortSignal = new AbortController().signal) {
  return createCodexJsonInvocation({
    ...validInvocation(signal),
    capability: "source.discover",
    reasoningEffort: "medium",
    toolPolicy: "codex-tools-web-search@2",
    templateVersion: "source-discovery@1",
    schemaVersion: "source-discovery@1",
  });
}

function independentFlightKey(
  invocation: ReturnType<typeof validInvocation>,
  includeRetryRevision = true,
): string {
  const canonical = independentCanonicalJson({
    capability: invocation.capability,
    limits: invocation.limits,
    model: CODEX_MODEL,
    outputSchemaHash: createHash("sha256").update(independentCanonicalJson(invocation.outputSchema), "utf8").digest("hex"),
    policyFingerprint: codexPolicyFingerprint,
    promptHash: createHash("sha256").update(invocation.prompt, "utf8").digest("hex"),
    reasoningEffort: invocation.reasoningEffort,
    ...(includeRetryRevision ? { retryPolicyRevision: "missing-native-search-once-shared-deadline@1" } : {}),
    schemaVersion: invocation.schemaVersion,
    templateVersion: invocation.templateVersion,
    toolPolicy: invocation.toolPolicy,
  });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

function independentCanonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(independentCanonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${independentCanonicalJson(record[key])}`).join(",")}}`;
}

function successfulProbe(finalMessage: string, webSearchCount = 0) {
  return {
    pid: 17,
    finalMessage,
    eventTypes: [
      "thread.started",
      "item.completed",
      "item.completed",
      "turn.started",
      "item.completed",
      "turn.completed",
    ],
    webSearchCount,
    toolPolicyProven: true as const,
  };
}

function adapterOptions(cliVersion: string = CODEX_CLI_VERSION) {
  return {
    preflight: Object.freeze({
      executable: "/synthetic/codex",
      cliVersion,
      authenticatedWith: "ChatGPT" as const,
    }),
    spawner: Object.freeze({ spawn: vi.fn() }) as CodexProcessSpawner,
    tempRoot: Object.freeze({ path: "/tmp", uid: 501 }),
    childEnv: Object.freeze({ CODEX_HOME: "/synthetic/codex-home", LANG: "C" }),
  };
}

async function freshRuntime() {
  vi.resetModules();
  return import("../../src/infrastructure/codex-cli/runtime");
}

async function runtimeFixture(options: {
  readonly failFirstProcess?: boolean;
  readonly holdInventory?: boolean;
  readonly signal?: AbortSignal;
} = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "codex-runtime-task4-")));
  createdDirectories.push(root);
  const executable = join(root, "codex");
  const tempRoot = join(root, "tmp");
  await writeFile(executable, "#!/bin/sh\nexit 0\n", "utf8");
  await chmod(executable, 0o700);
  await mkdir(tempRoot, { mode: 0o700 });

  let call = 0;
  const inventoryExit = deferred<{ code: number | null; signal: string | null }>();
  const spawner = {
    spawn: vi.fn((input: Parameters<CodexProcessSpawner["spawn"]>[0]) => {
      void input;
      call += 1;
      if (options.failFirstProcess === true && call === 1) return fakeProcess("", "", 1);
      if (call === 1) return fakeProcess(`${CODEX_CLI_VERSION}\n`, "", 0);
      if (call === 2) return fakeProcess("", "Logged in using ChatGPT\n", 0);
      const inventory = CODEX_DISABLED_FEATURES.map((feature) => `${feature} stable false`).join("\n");
      return fakeProcess(
        `${inventory}\n`,
        "",
        options.holdInventory === true ? inventoryExit.promise : 0,
      );
    }),
  };
  const borrowedEnvironment: Record<string, string> = {
    CODEX_HOME: "/synthetic/codex-home",
    TMPDIR: tempRoot,
    LANG: "C",
    LC_ALL: "C",
    OPENAI_API_KEY: "must-not-cross",
  };
  return {
    spawner,
    tempRoot,
    borrowedEnvironment,
    releaseInventory: () => inventoryExit.resolve({ code: 0, signal: null }),
    input: {
      configuredExecutable: executable,
      pathValue: "/must-not-be-used",
      tempRootPath: tempRoot,
      currentUid: process.getuid?.() ?? 501,
      childEnv: borrowedEnvironment,
      spawner,
      clock: () => new Date("2026-08-21T00:00:00.000Z"),
      signal: options.signal ?? new AbortController().signal,
    },
  };
}

function fakeProcess(
  stdout: string,
  stderr: string,
  exit: number | Promise<{ code: number | null; signal: string | null }>,
): SpawnedCodexProcess {
  return {
    pid: 101,
    stdout: textStream(stdout),
    stderr: textStream(stderr),
    exit: typeof exit === "number" ? Promise.resolve({ code: exit, signal: null }) : exit,
    terminateGroup: vi.fn(),
  };
}

async function* textStream(value: string): AsyncGenerator<Uint8Array> {
  if (value.length > 0) yield new TextEncoder().encode(value);
}

function clearRuntimeState(): void {
  const target = globalThis as typeof globalThis & { [key: symbol]: unknown };
  delete target[RUNTIME_STATE_KEY];
}

function deferred<T>(): { readonly promise: Promise<T>; readonly resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}
