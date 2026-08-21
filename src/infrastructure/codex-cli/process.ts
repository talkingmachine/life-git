import { spawn as spawnChildProcess } from "node:child_process";

import { CodexRuntimeError } from "./contracts";

export interface SpawnedCodexProcess {
  readonly pid: number;
  readonly stdout: AsyncIterable<Uint8Array>;
  readonly stderr: AsyncIterable<Uint8Array>;
  readonly exit: Promise<{ readonly code: number | null; readonly signal: string | null }>;
  kill(signal: "SIGTERM" | "SIGKILL"): void;
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

export const nodeCodexProcessSpawner: CodexProcessSpawner = Object.freeze({
  spawn(input: Parameters<CodexProcessSpawner["spawn"]>[0]): SpawnedCodexProcess {
    const child = spawnChildProcess(input.executable, [...input.args], {
      cwd: input.cwd,
      env: { ...input.env } as NodeJS.ProcessEnv,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    child.stdin.end(input.stdin);

    const exit = new Promise<{ code: number | null; signal: string | null }>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => resolve({ code, signal }));
    });

    return {
      pid: child.pid ?? -1,
      stdout: child.stdout,
      stderr: child.stderr,
      exit,
      kill(signal): void {
        child.kill(signal);
      },
    };
  },
});

export async function runBoundedProcess(
  request: BoundedProcessRequest,
  spawner: CodexProcessSpawner,
): Promise<BoundedProcessResult> {
  throwIfAborted(request.signal);

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
    throw processFailed();
  }

  let hasExited = false;
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
  const abort = createAbortPromise(request.signal);
  let timeoutIdentifier: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutIdentifier = setTimeout(() => reject(new CodexRuntimeError("codex_timeout")), request.timeoutMs);
  });

  try {
    const [stdoutChunks, stderrResult, exit] = await Promise.race([completion, abort.promise, timeout]);
    throwIfAborted(request.signal);
    if (exit.code !== 0) throw processFailed();
    const result: BoundedProcessResult = {
      pid: process.pid,
      stdout: stdoutChunks,
      stderrByteCount: stderrResult.byteCount,
      ...(stderrResult.chunks === undefined ? {} : { stderr: stderrResult.chunks }),
    };
    return result;
  } catch (error) {
    await terminateProcess(process, () => hasExited);
    const callerAbort = abortReason(request.signal);
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
  signal.addEventListener("abort", onAbort);
  return { promise, dispose: () => signal.removeEventListener("abort", onAbort) };
}

async function terminateProcess(process: SpawnedCodexProcess, hasExited: () => boolean): Promise<void> {
  if (hasExited()) return;
  safelyKill(process, "SIGTERM");
  await Promise.race([
    process.exit.then(() => undefined, () => undefined),
    new Promise<void>((resolve) => setTimeout(resolve, FORCE_KILL_AFTER_MS)),
  ]);
  if (!hasExited()) safelyKill(process, "SIGKILL");
}

function safelyKill(process: SpawnedCodexProcess, signal: "SIGTERM" | "SIGKILL"): void {
  try {
    process.kill(signal);
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

function processFailed(): CodexRuntimeError {
  return new CodexRuntimeError("codex_process_failed");
}
