import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import { describe, expect, test, vi } from "vitest";

import {
  runBoundedProcess,
  type BoundedProcessRequest,
  type CodexProcessSpawner,
  type SpawnedCodexProcess,
} from "../../src/infrastructure/codex-cli/process";

const encoder = new TextEncoder();

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

async function* stream(...chunks: readonly Uint8Array[]): AsyncGenerator<Uint8Array> {
  yield* chunks;
}

async function* failingStream(error: Error): AsyncGenerator<Uint8Array> {
  yield encoder.encode("before-failure");
  throw error;
}

function processWith(overrides: Partial<SpawnedCodexProcess> = {}): SpawnedCodexProcess {
  return {
    pid: 71,
    stdout: stream(),
    stderr: stream(),
    exit: Promise.resolve({ code: 0, signal: null }),
    terminateGroup: vi.fn(),
    ...overrides,
  };
}

function fakeSpawner(process = processWith()): CodexProcessSpawner & { spawn: ReturnType<typeof vi.fn> } {
  return { spawn: vi.fn(() => process) };
}

function validBoundedRequest(overrides: Partial<BoundedProcessRequest> = {}): BoundedProcessRequest {
  return {
    executable: "/opt/codex",
    args: ["exec", "--json", "-"],
    cwd: "/private/tmp/codex-run",
    env: { CODEX_HOME: "/private/tmp/codex-home", LANG: "C.UTF-8" },
    stdin: encoder.encode("prompt"),
    timeoutMs: 1_000,
    maxStdoutBytes: 128,
    maxStderrBytes: 128,
    signal: new AbortController().signal,
    ...overrides,
  };
}

function controlledNodeChild(input: {
  readonly pid?: number;
  readonly kill?: (signal: "SIGTERM" | "SIGKILL") => boolean;
} = {}): EventEmitter & {
  readonly pid: number | undefined;
  readonly stdin: { readonly end: ReturnType<typeof vi.fn> };
  readonly stdout: PassThrough;
  readonly stderr: PassThrough;
  readonly kill: ReturnType<typeof vi.fn>;
} {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  stdout.end();
  stderr.end();
  return Object.assign(new EventEmitter(), {
    pid: input.pid,
    stdin: { end: vi.fn() },
    stdout,
    stderr,
    kill: vi.fn(input.kill ?? (() => true)),
  });
}

async function loadNodeProcessModule(child: EventEmitter): Promise<{
  readonly processModule: typeof import("../../src/infrastructure/codex-cli/process");
  readonly spawn: ReturnType<typeof vi.fn>;
}> {
  vi.resetModules();
  const spawn = vi.fn(() => child);
  vi.doMock("node:child_process", () => ({ spawn }));
  return { processModule: await import("../../src/infrastructure/codex-cli/process"), spawn };
}

function unloadNodeProcessModule(): void {
  vi.doUnmock("node:child_process");
  vi.resetModules();
}

describe("runBoundedProcess", () => {
  test("does not spawn when caller is already aborted", async () => {
    const spawner = fakeSpawner();

    await expect(runBoundedProcess({
      ...validBoundedRequest(),
      signal: AbortSignal.abort(new DOMException("cancelled", "AbortError")),
    }, spawner)).rejects.toMatchObject({ name: "AbortError" });
    expect(spawner.spawn).not.toHaveBeenCalled();
  });

  test("does not invoke a caller-owned aborted accessor", async () => {
    const controller = new AbortController();
    const getter = vi.fn(() => {
      throw new Error("caller accessor must not run");
    });
    Object.defineProperty(controller.signal, "aborted", { enumerable: true, get: getter });
    const spawner = fakeSpawner();

    await expect(runBoundedProcess(validBoundedRequest({ signal: controller.signal }), spawner))
      .resolves.toMatchObject({ pid: 71 });
    expect(getter).not.toHaveBeenCalled();
  });

  test("does not spawn when the native abort subscription cannot be established", async () => {
    // Break caught: subscription setup after spawn can leak a child when native registration throws.
    const signal = new AbortController().signal;
    const eventStorage = Reflect.ownKeys(signal).find(
      (key) => typeof key === "symbol" && key.description === "kEvents",
    );
    expect(eventStorage).toBeDefined();
    expect(Reflect.deleteProperty(signal, eventStorage as PropertyKey)).toBe(true);
    const spawner = fakeSpawner();
    let thrown: unknown;

    try {
      await runBoundedProcess(validBoundedRequest({ signal }), spawner);
    } catch (error) {
      thrown = error;
    }

    expect(spawner.spawn).not.toHaveBeenCalled();
    expect(thrown).toMatchObject({ code: "codex_process_failed", message: "codex_process_failed" });
  });

  test.each(["throwing", "no-op"] as const)(
    "uses native abort subscription despite %s caller-owned add/remove methods",
    async (shadowBehavior) => {
      // Break caught: caller-owned listener methods can disable abort teardown or throw after spawn.
      vi.useFakeTimers();
      const controller = new AbortController();
      const addEventListener = vi.fn(() => {
        if (shadowBehavior === "throwing") throw new Error("caller add must not run");
      });
      const removeEventListener = vi.fn(() => {
        if (shadowBehavior === "throwing") throw new Error("caller remove must not run");
      });
      Object.defineProperties(controller.signal, {
        addEventListener: { configurable: true, value: addEventListener },
        removeEventListener: { configurable: true, value: removeEventListener },
      });
      const reason = new DOMException("genuine cancellation", "AbortError");
      const exit = deferred<{ code: number | null; signal: string | null }>();
      const terminateGroup = vi.fn();
      const spawner = fakeSpawner(processWith({ exit: exit.promise, terminateGroup }));
      const running = runBoundedProcess(
        validBoundedRequest({ signal: controller.signal, timeoutMs: 10_000 }),
        spawner,
      );
      let settled = false;
      const observed = running.then(
        () => { settled = true; },
        () => { settled = true; },
      );
      let emittedExit = false;

      try {
        controller.abort(reason);
        await Promise.resolve();
        await Promise.resolve();
        expect(terminateGroup.mock.calls).toEqual([["SIGTERM"]]);
        expect(settled).toBe(false);

        await vi.advanceTimersByTimeAsync(250);
        expect(terminateGroup.mock.calls).toEqual([["SIGTERM"], ["SIGKILL"]]);
        expect(settled).toBe(false);

        exit.resolve({ code: null, signal: "SIGKILL" });
        emittedExit = true;
        await expect(running).rejects.toBe(reason);
        await observed;
        expect(addEventListener).not.toHaveBeenCalled();
        expect(removeEventListener).not.toHaveBeenCalled();
      } finally {
        if (!emittedExit) exit.resolve({ code: null, signal: "SIGKILL" });
        await observed;
        vi.useRealTimers();
      }
    },
  );

  test("preserves a real abort after a synthetic abort event", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const exit = deferred<{ code: number | null; signal: string | null }>();
    const reason = new DOMException("real cancellation", "AbortError");
    const terminateGroup = vi.fn((signal: "SIGTERM" | "SIGKILL") => {
      if (signal === "SIGTERM") exit.resolve({ code: null, signal });
    });
    const spawner = fakeSpawner(processWith({ exit: exit.promise, terminateGroup }));
    const running = runBoundedProcess(validBoundedRequest({ signal: controller.signal }), spawner);
    const observed = running.then(() => undefined, () => undefined);

    try {
      controller.signal.dispatchEvent(new Event("abort"));
      await Promise.resolve();
      await Promise.resolve();
      expect(terminateGroup).not.toHaveBeenCalled();
      controller.abort(reason);
      await Promise.resolve();
      await Promise.resolve();

      expect(terminateGroup).toHaveBeenCalledWith("SIGTERM");
      await expect(running).rejects.toBe(reason);
    } finally {
      exit.resolve({ code: null, signal: "SIGTERM" });
      await observed;
      vi.useRealTimers();
    }
  });

  test("spawns exactly once with the supplied closed request and returns owned stdout chunks", async () => {
    const source = encoder.encode("jsonl\n");
    const spawner = fakeSpawner(processWith({ stdout: stream(source), pid: 19 }));
    const request = validBoundedRequest();

    const result = await runBoundedProcess(request, spawner);
    source[0] = 0;

    expect(spawner.spawn).toHaveBeenCalledTimes(1);
    expect(spawner.spawn).toHaveBeenCalledWith({
      executable: "/opt/codex",
      args: ["exec", "--json", "-"],
      cwd: "/private/tmp/codex-run",
      env: { CODEX_HOME: "/private/tmp/codex-home", LANG: "C.UTF-8" },
      stdin: encoder.encode("prompt"),
    });
    expect(result).toEqual({ pid: 19, stdout: [encoder.encode("jsonl\n")], stderrByteCount: 0 });
  });

  test("retains owned bounded stderr only when explicitly requested", async () => {
    const source = encoder.encode("known preflight status\n");
    const spawner = fakeSpawner(processWith({ stderr: stream(source) }));
    const request = {
      ...validBoundedRequest(),
      captureStderr: true,
    } as BoundedProcessRequest & { readonly captureStderr: true };

    const result = await runBoundedProcess(request, spawner) as Awaited<ReturnType<typeof runBoundedProcess>> & {
      readonly stderr: readonly Uint8Array[];
    };
    source[0] = 0;

    expect(result).toEqual({
      pid: 71,
      stdout: [],
      stderr: [encoder.encode("known preflight status\n")],
      stderrByteCount: 23,
    });
  });

  test("normalizes a synchronous spawn failure without retrying or leaking its message", async () => {
    const spawner = fakeSpawner();
    spawner.spawn.mockImplementation(() => {
      throw new Error("secret executable detail");
    });

    let thrown: unknown;
    try {
      await runBoundedProcess(validBoundedRequest(), spawner);
    } catch (error) {
      thrown = error;
    }

    expect(spawner.spawn).toHaveBeenCalledTimes(1);
    expect(thrown).toMatchObject({ code: "codex_process_failed", message: "codex_process_failed" });
    expect(String(thrown)).not.toContain("secret executable detail");
  });

  test("routes a synchronous post-spawn setup failure through the actual-exit barrier", async () => {
    // Break caught: stream setup outside the teardown try can reject while leaving the child alive.
    vi.useFakeTimers();
    const exit = deferred<{ code: number | null; signal: string | null }>();
    const terminateGroup = vi.fn();
    const process = processWith({ exit: exit.promise, terminateGroup });
    Object.defineProperty(process, "stdout", {
      configurable: true,
      get(): AsyncIterable<Uint8Array> {
        throw new Error("private stdout setup detail");
      },
    });
    const running = runBoundedProcess(validBoundedRequest(), fakeSpawner(process));
    let settled = false;
    let thrown: unknown;
    const observed = running.then(
      () => { settled = true; },
      (error) => {
        settled = true;
        thrown = error;
      },
    );
    let emittedExit = false;

    try {
      await Promise.resolve();
      await Promise.resolve();
      expect(terminateGroup.mock.calls).toEqual([["SIGTERM"]]);
      expect(settled).toBe(false);

      await vi.advanceTimersByTimeAsync(250);
      expect(terminateGroup.mock.calls).toEqual([["SIGTERM"], ["SIGKILL"]]);
      expect(settled).toBe(false);

      exit.resolve({ code: null, signal: "SIGKILL" });
      emittedExit = true;
      await observed;
      expect(thrown).toMatchObject({ code: "codex_process_failed", message: "codex_process_failed" });
      expect(String(thrown)).not.toContain("private stdout setup detail");
    } finally {
      if (!emittedExit) exit.resolve({ code: null, signal: "SIGKILL" });
      await observed;
      vi.useRealTimers();
    }
  });

  test("rejects non-zero exit without including stderr content", async () => {
    const spawner = fakeSpawner(processWith({
      stderr: stream(encoder.encode("private warning")),
      exit: Promise.resolve({ code: 7, signal: null }),
    }));

    let thrown: unknown;
    try {
      await runBoundedProcess(validBoundedRequest(), spawner);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toMatchObject({ code: "codex_process_failed", message: "codex_process_failed" });
    expect(String(thrown)).not.toContain("private warning");
  });

  test("terminates when stdout exceeds its byte bound", async () => {
    const exit = deferred<{ code: number | null; signal: string | null }>();
    const terminateGroup = vi.fn((signal: "SIGTERM" | "SIGKILL") => {
      if (signal === "SIGTERM") exit.resolve({ code: null, signal });
    });
    const spawner = fakeSpawner(processWith({
      stdout: stream(encoder.encode("123"), encoder.encode("456")),
      exit: exit.promise,
      terminateGroup,
    }));

    await expect(runBoundedProcess(validBoundedRequest({ maxStdoutBytes: 5 }), spawner))
      .rejects.toMatchObject({ code: "codex_output_too_large" });
    expect(terminateGroup).toHaveBeenCalledWith("SIGTERM");
    expect(terminateGroup).not.toHaveBeenCalledWith("SIGKILL");
  });

  test("terminates when stderr exceeds its byte bound without retaining stderr", async () => {
    const exit = deferred<{ code: number | null; signal: string | null }>();
    const terminateGroup = vi.fn((signal: "SIGTERM" | "SIGKILL") => {
      if (signal === "SIGTERM") exit.resolve({ code: null, signal });
    });
    const spawner = fakeSpawner(processWith({
      stderr: stream(encoder.encode("private")),
      exit: exit.promise,
      terminateGroup,
    }));

    let thrown: unknown;
    try {
      await runBoundedProcess(validBoundedRequest({ maxStderrBytes: 3 }), spawner);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toMatchObject({ code: "codex_process_failed", message: "codex_process_failed" });
    expect(String(thrown)).not.toContain("private");
    expect(terminateGroup).toHaveBeenCalledWith("SIGTERM");
  });

  test("sends SIGKILL 250 ms after a timed-out process ignores SIGTERM", async () => {
    vi.useFakeTimers();
    const exit = deferred<{ code: number | null; signal: string | null }>();
    const terminateGroup = vi.fn((signal: "SIGTERM" | "SIGKILL") => {
      if (signal === "SIGKILL") exit.resolve({ code: null, signal });
    });
    const spawner = fakeSpawner(processWith({ exit: exit.promise, terminateGroup }));
    const running = runBoundedProcess(validBoundedRequest({ timeoutMs: 100 }), spawner);
    const rejection = expect(running).rejects.toMatchObject({ code: "codex_timeout" });

    await vi.advanceTimersByTimeAsync(100);
    expect(terminateGroup).toHaveBeenCalledWith("SIGTERM");
    expect(terminateGroup).not.toHaveBeenCalledWith("SIGKILL");
    await vi.advanceTimersByTimeAsync(250);

    await rejection;
    expect(terminateGroup.mock.calls).toEqual([["SIGTERM"], ["SIGKILL"]]);
    vi.useRealTimers();
  });

  test("keeps the public promise pending after SIGKILL until process exit is observed", async () => {
    // Break caught: resolving teardown before the force-killed child has actually been reaped.
    vi.useFakeTimers();
    try {
      const exit = deferred<{ code: number | null; signal: string | null }>();
      const terminateGroup = vi.fn();
      const spawner = fakeSpawner(processWith({ exit: exit.promise, terminateGroup }));
      const running = runBoundedProcess(validBoundedRequest({ timeoutMs: 100 }), spawner);
      let settled = false;
      const observed = running.then(
        () => { settled = true; },
        () => { settled = true; },
      );

      await vi.advanceTimersByTimeAsync(100);
      await vi.advanceTimersByTimeAsync(250);

      expect(terminateGroup.mock.calls).toEqual([["SIGTERM"], ["SIGKILL"]]);
      expect(settled).toBe(false);
      exit.resolve({ code: null, signal: "SIGKILL" });

      await expect(running).rejects.toMatchObject({ code: "codex_timeout" });
      await observed;
      expect(settled).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  test.each(["returns false", "throws"] as const)(
    "does not treat a post-spawn error as exit when SIGTERM %s",
    async (termFailure) => {
      // Break caught: a failed kill emits `error`, which must not stand in for reaping the owned child.
      vi.useFakeTimers();
      const killProcessGroup = vi.spyOn(process, "kill").mockImplementation((pid, signal) => {
        if (signal === "SIGTERM" && termFailure === "throws") throw new Error("synthetic kill failure");
        void pid;
        return true;
      });
      const child = controlledNodeChild({ pid: 811 });
      const { processModule } = await loadNodeProcessModule(child);
      const running = processModule.runBoundedProcess(
        validBoundedRequest({ timeoutMs: 100 }),
        processModule.nodeCodexProcessSpawner,
      );
      let settled = false;
      const observed = running.then(
        () => { settled = true; },
        () => { settled = true; },
      );
      let emittedExit = false;

      try {
        child.emit("spawn");
        await vi.advanceTimersByTimeAsync(100);
        expect(killProcessGroup.mock.calls).toEqual([[-811, "SIGTERM"]]);

        child.emit("error", new Error("post-spawn kill error"));
        await Promise.resolve();
        await Promise.resolve();
        expect(settled).toBe(false);

        await vi.advanceTimersByTimeAsync(250);
        expect(killProcessGroup.mock.calls).toEqual([[-811, "SIGTERM"], [-811, "SIGKILL"]]);
        expect(settled).toBe(false);

        child.emit("exit", null, "SIGKILL");
        emittedExit = true;
        await expect(running).rejects.toMatchObject({ code: "codex_timeout" });
        await observed;
        expect(settled).toBe(true);
      } finally {
        if (!emittedExit) child.emit("exit", null, "SIGKILL");
        await observed;
        unloadNodeProcessModule();
        killProcessGroup.mockRestore();
        vi.useRealTimers();
      }
    },
  );

  test("spawns a detached process group without a shell", async () => {
    // Break caught: a shell or shared process group leaves descendants outside abort ownership.
    const child = controlledNodeChild({ pid: 812 });
    const { processModule, spawn } = await loadNodeProcessModule(child);

    try {
      const running = processModule.runBoundedProcess(
        validBoundedRequest(),
        processModule.nodeCodexProcessSpawner,
      );
      expect(spawn).toHaveBeenCalledWith("/opt/codex", ["exec", "--json", "-"], expect.objectContaining({
        detached: true,
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
      }));

      child.emit("exit", 0, null);
      await expect(running).resolves.toMatchObject({ pid: 812 });
    } finally {
      unloadNodeProcessModule();
    }
  });

  test("normalizes an error from a child that never spawned without sending signals", async () => {
    // Break caught: ignoring the mutually exclusive pre-spawn `error` would wait until timeout.
    const child = controlledNodeChild();
    const { processModule } = await loadNodeProcessModule(child);
    const running = processModule.runBoundedProcess(
      validBoundedRequest(),
      processModule.nodeCodexProcessSpawner,
    );

    try {
      child.emit("error", new Error("private executable failure"));

      await expect(running).rejects.toMatchObject({
        code: "codex_process_failed",
        message: "codex_process_failed",
      });
      expect(child.kill).not.toHaveBeenCalled();
    } finally {
      unloadNodeProcessModule();
    }
  });

  test("gives caller abort precedence over a concurrent process failure", async () => {
    const controller = new AbortController();
    const exit = deferred<{ code: number | null; signal: string | null }>();
    const reason = new DOMException("caller cancelled", "AbortError");
    const spawner = fakeSpawner(processWith({ exit: exit.promise }));
    const running = runBoundedProcess(validBoundedRequest({ signal: controller.signal }), spawner);

    controller.abort(reason);
    exit.reject(new Error("late exit rejection"));

    await expect(running).rejects.toBe(reason);
  });

  test("gives an abort fired during TERM teardown precedence over the stream failure", async () => {
    const controller = new AbortController();
    const exit = deferred<{ code: number | null; signal: string | null }>();
    const reason = new DOMException("cancelled during teardown", "AbortError");
    const terminateGroup = vi.fn((signal: "SIGTERM" | "SIGKILL") => {
      if (signal === "SIGTERM") {
        controller.abort(reason);
        exit.resolve({ code: null, signal });
      }
    });
    const spawner = fakeSpawner(processWith({
      stdout: failingStream(new Error("stream failed first")),
      stderr: failingStream(new Error("late stderr rejection")),
      exit: exit.promise,
      terminateGroup,
    }));

    await expect(runBoundedProcess(validBoundedRequest({ signal: controller.signal }), spawner))
      .rejects.toBe(reason);
    expect(terminateGroup).toHaveBeenCalledWith("SIGTERM");
  });

  test("observes stream and exit rejections that arrive after termination", async () => {
    const controller = new AbortController();
    const lateExit = deferred<{ code: number | null; signal: string | null }>();
    const spawner = fakeSpawner(processWith({
      stdout: failingStream(new Error("late stdout")),
      stderr: failingStream(new Error("late stderr")),
      exit: lateExit.promise,
    }));
    const running = runBoundedProcess(validBoundedRequest({ signal: controller.signal }), spawner);

    controller.abort(new DOMException("stop", "AbortError"));
    lateExit.reject(new Error("late exit"));

    await expect(running).rejects.toMatchObject({ name: "AbortError" });
  });
});
