import { spawn as spawnChildProcess } from "node:child_process";

import { CodexRuntimeError } from "./contracts";

export interface SpawnedCodexProcess {
  readonly pid: number;
  readonly stdout: AsyncIterable<Uint8Array>;
  readonly stderr: AsyncIterable<Uint8Array>;
  readonly exit: Promise<{ readonly code: number | null; readonly signal: string | null }>;
  terminateGroup(signal: "SIGTERM" | "SIGKILL"): void;
}

export interface CodexProcessSpawner {
  spawn(input: {
    readonly executable: string;
    readonly args: readonly string[];
    readonly cwd: string;
    readonly env: Readonly<Record<string, string>>;
    readonly stdin: Uint8Array;
  }): SpawnedCodexProcess;
}

export interface BoundedProcessRequest {
  readonly executable: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
  readonly stdin: Uint8Array;
  readonly timeoutMs: number;
  readonly maxStdoutBytes: number;
  readonly maxStderrBytes: number;
  readonly signal: AbortSignal;
  readonly captureStderr?: boolean;
}

export interface BoundedProcessResult {
  readonly pid: number;
  readonly stdout: readonly Uint8Array[];
  readonly stderrByteCount: number;
  readonly stderr?: readonly Uint8Array[];
}

const FORCE_KILL_AFTER_MS = 250;
const NATIVE_ABORTED_GETTER = Object.getOwnPropertyDescriptor(AbortSignal.prototype, "aborted")?.get;
const NATIVE_REASON_GETTER = Object.getOwnPropertyDescriptor(AbortSignal.prototype, "reason")?.get;
const NATIVE_ADD_EVENT_LISTENER = EventTarget.prototype.addEventListener;
const NATIVE_REMOVE_EVENT_LISTENER = EventTarget.prototype.removeEventListener;

export const nodeCodexProcessSpawner: CodexProcessSpawner = Object.freeze({
  spawn(input: Parameters<CodexProcessSpawner["spawn"]>[0]): SpawnedCodexProcess {
    const child = spawnChildProcess(input.executable, [...input.args], {
      cwd: input.cwd,
      env: { ...input.env } as NodeJS.ProcessEnv,
      shell: false,
      detached: true,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    child.stdin.end(input.stdin);

    const exit = new Promise<{ code: number | null; signal: string | null }>((resolve, reject) => {
      let spawned = child.pid !== undefined;
      child.once("spawn", () => {
        spawned = true;
      });
      child.on("error", (error) => {
        if (!spawned) reject(error);
      });
      child.once("exit", (code, signal) => resolve({ code, signal }));
    });

    return {
      pid: child.pid ?? -1,
      stdout: child.stdout,
      stderr: child.stderr,
      exit,
      terminateGroup(signal): void {
        const pid = child.pid;
        if (pid !== undefined && pid > 0) process.kill(-pid, signal);
      },
    };
  },
});

export async function runBoundedProcess(
  request: BoundedProcessRequest,
  spawner: CodexProcessSpawner,
): Promise<BoundedProcessResult> {
  let abort: ReturnType<typeof createAbortPromise> | undefined;
  try {
    throwIfAborted(request.signal);
    abort = createAbortPromise(request.signal);
    throwIfAborted(request.signal);
  } catch {
    abort?.dispose();
    const callerAbort = safelyReadAbortReason(request.signal);
    if (callerAbort !== undefined) throw callerAbort;
    throw processFailed();
  }

  let process: SpawnedCodexProcess;
  try {
    process = spawner.spawn({
      executable: request.executable,
      args: request.args,
      cwd: request.cwd,
      env: request.env,
      stdin: request.stdin,
    });
  } catch {
    abort.dispose();
    const callerAbort = safelyReadAbortReason(request.signal);
    if (callerAbort !== undefined) throw callerAbort;
    throw processFailed();
  }

  let hasExited = false;
  let timeoutIdentifier: ReturnType<typeof setTimeout> | undefined;

  try {
    const observedExit = process.exit.then(
      (result) => {
        hasExited = true;
        return result;
      },
      () => {
        hasExited = true;
        throw processFailed();
      },
    );
    const stdout = readStdout(process.stdout, request.maxStdoutBytes);
    const stderr = readStderr(process.stderr, request.maxStderrBytes, request.captureStderr === true);
    const completion = Promise.all([stdout, stderr, observedExit]);
    const timeout = new Promise<never>((_resolve, reject) => {
      timeoutIdentifier = setTimeout(() => reject(new CodexRuntimeError("codex_timeout")), request.timeoutMs);
    });
    const [stdoutChunks, stderrResult, exit] = await Promise.race([completion, abort.promise, timeout]);
    throwIfAborted(request.signal);
    if (exit.code !== 0 || exit.signal !== null) throw processFailed();
    const result: BoundedProcessResult = {
      pid: process.pid,
      stdout: stdoutChunks,
      stderrByteCount: stderrResult.byteCount,
      ...(stderrResult.chunks === undefined ? {} : { stderr: stderrResult.chunks }),
    };
    return result;
  } catch (error) {
    await terminateProcess(process, () => hasExited);
    const callerAbort = safelyReadAbortReason(request.signal);
    if (callerAbort !== undefined) throw callerAbort;
    if (error instanceof CodexRuntimeError) throw error;
    throw processFailed();
  } finally {
    if (timeoutIdentifier !== undefined) clearTimeout(timeoutIdentifier);
    abort.dispose();
  }
}

async function readStdout(
  stream: AsyncIterable<Uint8Array>,
  maximumBytes: number,
): Promise<readonly Uint8Array[]> {
  const chunks: Uint8Array[] = [];
  let byteCount = 0;
  try {
    for await (const chunk of stream) {
      const owned = Uint8Array.from(chunk);
      byteCount += owned.byteLength;
      if (byteCount > maximumBytes) throw new CodexRuntimeError("codex_output_too_large");
      chunks.push(owned);
    }
  } catch (error) {
    if (error instanceof CodexRuntimeError) throw error;
    throw processFailed();
  }
  return chunks;
}

async function readStderr(
  stream: AsyncIterable<Uint8Array>,
  maximumBytes: number,
  capture: boolean,
): Promise<{ readonly byteCount: number; readonly chunks?: readonly Uint8Array[] }> {
  let byteCount = 0;
  const chunks: Uint8Array[] = [];
  try {
    for await (const chunk of stream) {
      const owned = capture ? Uint8Array.from(chunk) : undefined;
      byteCount += owned?.byteLength ?? chunk.byteLength;
      if (byteCount > maximumBytes) throw processFailed();
      if (owned !== undefined) chunks.push(owned);
    }
  } catch {
    throw processFailed();
  }
  return capture ? { byteCount, chunks } : { byteCount };
}

function createAbortPromise(signal: AbortSignal): {
  readonly promise: Promise<never>;
  readonly dispose: () => void;
} {
  let rejectAbort!: (reason: unknown) => void;
  const promise = new Promise<never>((_resolve, reject) => {
    rejectAbort = reject;
  });
  const onAbort = (): void => {
    const reason = abortReason(signal);
    if (reason !== undefined) rejectAbort(reason);
  };
  try {
    NATIVE_ADD_EVENT_LISTENER.call(signal, "abort", onAbort);
  } catch (error) {
    try {
      NATIVE_REMOVE_EVENT_LISTENER.call(signal, "abort", onAbort);
    } catch {
      // Registration never completed on a valid signal.
    }
    throw error;
  }
  void promise.catch(() => undefined);
  return {
    promise,
    dispose: () => {
      try {
        NATIVE_REMOVE_EVENT_LISTENER.call(signal, "abort", onAbort);
      } catch {
        // Cleanup failure must not replace the caller-visible process outcome.
      }
    },
  };
}

async function terminateProcess(process: SpawnedCodexProcess, hasExited: () => boolean): Promise<void> {
  if (hasExited()) return;
  safelyTerminateGroup(process, "SIGTERM");
  await Promise.race([
    process.exit.then(() => undefined, () => undefined),
    new Promise<void>((resolve) => setTimeout(resolve, FORCE_KILL_AFTER_MS)),
  ]);
  if (!hasExited()) {
    safelyTerminateGroup(process, "SIGKILL");
    await process.exit.then(() => undefined, () => undefined);
  }
}

function safelyTerminateGroup(process: SpawnedCodexProcess, signal: "SIGTERM" | "SIGKILL"): void {
  try {
    process.terminateGroup(signal);
  } catch {
    // The observed exit promise remains the source of process state.
  }
}

function throwIfAborted(signal: AbortSignal): void {
  const reason = abortReason(signal);
  if (reason !== undefined) throw reason;
}

function abortReason(signal: AbortSignal): unknown | undefined {
  if (NATIVE_ABORTED_GETTER?.call(signal) !== true) return undefined;
  return NATIVE_REASON_GETTER?.call(signal) ?? new DOMException("Aborted", "AbortError");
}

function safelyReadAbortReason(signal: AbortSignal): unknown | undefined {
  try {
    return abortReason(signal);
  } catch {
    return undefined;
  }
}

function processFailed(): CodexRuntimeError {
  return new CodexRuntimeError("codex_process_failed");
}
