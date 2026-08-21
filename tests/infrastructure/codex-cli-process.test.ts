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
    kill: vi.fn(),
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

  test("preserves a real abort after a synthetic abort event", async () => {
    const controller = new AbortController();
    const exit = deferred<{ code: number | null; signal: string | null }>();
    const reason = new DOMException("real cancellation", "AbortError");
    const kill = vi.fn((signal: "SIGTERM" | "SIGKILL") => {
      if (signal === "SIGTERM") exit.resolve({ code: null, signal });
    });
    const spawner = fakeSpawner(processWith({ exit: exit.promise, kill }));
    const running = runBoundedProcess(validBoundedRequest({ signal: controller.signal }), spawner);

    controller.signal.dispatchEvent(new Event("abort"));
    await Promise.resolve();
    await Promise.resolve();
    expect(kill).not.toHaveBeenCalled();
    controller.abort(reason);

    await expect(running).rejects.toBe(reason);
    expect(kill).toHaveBeenCalledWith("SIGTERM");
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
    const kill = vi.fn((signal: "SIGTERM" | "SIGKILL") => {
      if (signal === "SIGTERM") exit.resolve({ code: null, signal });
    });
    const spawner = fakeSpawner(processWith({
      stdout: stream(encoder.encode("123"), encoder.encode("456")),
      exit: exit.promise,
      kill,
    }));

    await expect(runBoundedProcess(validBoundedRequest({ maxStdoutBytes: 5 }), spawner))
      .rejects.toMatchObject({ code: "codex_output_too_large" });
    expect(kill).toHaveBeenCalledWith("SIGTERM");
    expect(kill).not.toHaveBeenCalledWith("SIGKILL");
  });

  test("terminates when stderr exceeds its byte bound without retaining stderr", async () => {
    const exit = deferred<{ code: number | null; signal: string | null }>();
    const kill = vi.fn((signal: "SIGTERM" | "SIGKILL") => {
      if (signal === "SIGTERM") exit.resolve({ code: null, signal });
    });
    const spawner = fakeSpawner(processWith({
      stderr: stream(encoder.encode("private")),
      exit: exit.promise,
      kill,
    }));

    let thrown: unknown;
    try {
      await runBoundedProcess(validBoundedRequest({ maxStderrBytes: 3 }), spawner);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toMatchObject({ code: "codex_process_failed", message: "codex_process_failed" });
    expect(String(thrown)).not.toContain("private");
    expect(kill).toHaveBeenCalledWith("SIGTERM");
  });

  test("sends SIGKILL 250 ms after a timed-out process ignores SIGTERM", async () => {
    vi.useFakeTimers();
    const exit = deferred<{ code: number | null; signal: string | null }>();
    const kill = vi.fn((signal: "SIGTERM" | "SIGKILL") => {
      if (signal === "SIGKILL") exit.resolve({ code: null, signal });
    });
    const spawner = fakeSpawner(processWith({ exit: exit.promise, kill }));
    const running = runBoundedProcess(validBoundedRequest({ timeoutMs: 100 }), spawner);
    const rejection = expect(running).rejects.toMatchObject({ code: "codex_timeout" });

    await vi.advanceTimersByTimeAsync(100);
    expect(kill).toHaveBeenCalledWith("SIGTERM");
    expect(kill).not.toHaveBeenCalledWith("SIGKILL");
    await vi.advanceTimersByTimeAsync(250);

    await rejection;
    expect(kill.mock.calls).toEqual([["SIGTERM"], ["SIGKILL"]]);
    vi.useRealTimers();
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
