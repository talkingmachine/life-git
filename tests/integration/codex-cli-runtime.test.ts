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
import { CODEX_STARTUP_NOTICES } from "../../src/infrastructure/codex-cli/event-stream";
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
        compatibilityPolicy: "codex-cli-0.149.0-alpha.4-plus@1",
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
      toolPolicy: "codex-tools-web-search@1",
    });
    const baseResult = adapter.invokeJson(base);
    const discoveryResult = adapter.invokeJson(discovery);
    await vi.waitFor(() => expect(probe.run).toHaveBeenCalledTimes(2));
    expect(probe.run.mock.calls.map(([call]) => call.flightKey))
      .toEqual([independentFlightKey(base), independentFlightKey(discovery)]);
    firstGate.resolve(successfulProbe('{"ok":true}'));
    secondGate.resolve(successfulProbe('{"ok":true}'));
    await Promise.all([baseResult, discoveryResult]);
    expect(probe.run).toHaveBeenCalledTimes(2);
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
      schemaVersion: "codex-runtime-smoke@2", low: { webSearchCount: 0 }, medium: { webSearchCount: 0 }, discovery: { webSearchCount: 1 },
    });
    expect(probe.run.mock.calls.map(([call]) => [call.invocation.reasoningEffort, call.invocation.toolPolicy]))
      .toEqual([["low", "codex-tools-none@2"], ["medium", "codex-tools-none@2"], ["medium", "codex-tools-web-search@1"]]);
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
      pathValue: "/usr/bin:/bin",
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

function independentFlightKey(invocation: ReturnType<typeof validInvocation>): string {
  const canonical = independentCanonicalJson({
    capability: invocation.capability,
    limits: invocation.limits,
    model: CODEX_MODEL,
    outputSchemaHash: createHash("sha256").update(independentCanonicalJson(invocation.outputSchema), "utf8").digest("hex"),
    policyFingerprint: codexPolicyFingerprint,
    promptHash: createHash("sha256").update(invocation.prompt, "utf8").digest("hex"),
    reasoningEffort: invocation.reasoningEffort,
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
    startupNotices: CODEX_STARTUP_NOTICES,
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

function adapterOptions() {
  return {
    preflight: Object.freeze({
      executable: "/synthetic/codex",
      cliVersion: CODEX_CLI_VERSION,
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
