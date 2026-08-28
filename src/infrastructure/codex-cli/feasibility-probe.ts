import { rm } from "node:fs/promises";

import {
  CodexRuntimeError,
  MAX_CODEX_STDOUT_BYTES,
  type CodexJsonInvocation,
} from "./contracts";
import {
  CODEX_STARTUP_NOTICES,
  parseCodexEventStreamWithProof,
  type CodexStartupNotices,
} from "./event-stream";
import {
  createClosedCodexEnvironment,
  CODEX_DISABLED_FEATURES,
  CODEX_PREFLIGHT_LIMITS,
  type CodexPreflightResult,
} from "./preflight";
import { buildCodexExecArgs } from "./policy";
import { runBoundedProcess, type CodexProcessSpawner } from "./process";
import {
  createEmptyCodexTempDirectory,
  type ValidatedCodexTempRoot,
  withCodexTempDirectory,
} from "./temp-directory";

const DISABLED_FEATURE_ARGS = CODEX_DISABLED_FEATURES.flatMap((feature) => ["--disable", feature] as const);

export const CODEX_MESSAGE_INPUT_INSPECTION_ARGS = Object.freeze([
  ...DISABLED_FEATURE_ARGS,
  "debug",
  "prompt-input",
  "synthetic capability audit",
] as const);

export async function runCodexJsonProbe(input: {
  readonly invocation: CodexJsonInvocation;
  readonly preflight: CodexPreflightResult;
  readonly spawner: CodexProcessSpawner;
  readonly tempRoot: ValidatedCodexTempRoot;
  readonly childEnv: Readonly<Record<string, string>>;
  /** Diagnostic-only hash; never forwarded to the child process. */
  readonly flightKey?: string;
}): Promise<{
  readonly pid: number;
  readonly finalMessage: string;
  readonly startupNotices: CodexStartupNotices;
  readonly eventTypes: readonly string[];
  readonly webSearchCount: number;
  readonly toolPolicyProven: true;
}> {
  return withCodexTempDirectory({
    root: input.tempRoot,
    outputSchema: input.invocation.outputSchema,
    use: async ({ directoryPath, schemaPath }) => {
      const result = await runBoundedProcess({
        executable: input.preflight.executable,
        args: buildCodexExecArgs(input.invocation, directoryPath, schemaPath),
        cwd: directoryPath,
        env: createClosedCodexEnvironment(input.childEnv),
        stdin: new TextEncoder().encode(input.invocation.prompt),
        timeoutMs: input.invocation.limits.timeoutMs,
        maxStdoutBytes: input.invocation.limits.maxStdoutBytes,
        maxStderrBytes: input.invocation.limits.maxStderrBytes,
        signal: input.invocation.signal,
      }, input.spawner);
      const proof = await parseCodexEventStreamWithProof(streamChunks(result.stdout), {
        maxStdoutBytes: input.invocation.limits.maxStdoutBytes,
        maxEvents: input.invocation.limits.maxEvents,
      }, input.invocation.toolPolicy);
      return {
        pid: result.pid,
        startupNotices: CODEX_STARTUP_NOTICES,
        ...proof,
      };
    },
  });
}

export async function inspectModelVisibleInputs(input: {
  readonly preflight: CodexPreflightResult;
  readonly spawner: CodexProcessSpawner;
  readonly tempRoot: ValidatedCodexTempRoot;
  readonly childEnv: Readonly<Record<string, string>>;
  readonly signal: AbortSignal;
}): Promise<{
  readonly messageInputsObserved: boolean;
  readonly projectContextPaths: readonly string[];
  readonly projectRuleInputsObserved: boolean;
  readonly projectSkillPayloadsObserved: boolean;
}> {
  const directoryPath = await createEmptyCodexTempDirectory(input.tempRoot);
  try {
    const result = await runBoundedProcess({
      executable: input.preflight.executable,
      args: CODEX_MESSAGE_INPUT_INSPECTION_ARGS,
      cwd: directoryPath,
      env: createClosedCodexEnvironment(input.childEnv),
      stdin: new Uint8Array(),
      timeoutMs: CODEX_PREFLIGHT_LIMITS.timeoutMs,
      maxStdoutBytes: MAX_CODEX_STDOUT_BYTES,
      maxStderrBytes: CODEX_PREFLIGHT_LIMITS.maxStderrBytes,
      signal: input.signal,
    }, input.spawner);
    return inspectMessageList(decodeChunks(result.stdout), directoryPath);
  } finally {
    await rm(directoryPath, { recursive: true });
  }
}

async function* streamChunks(chunks: readonly Uint8Array[]): AsyncGenerator<Uint8Array> {
  yield* chunks;
}

function inspectMessageList(stdout: string, isolatedCwd: string): {
  readonly messageInputsObserved: boolean;
  readonly projectContextPaths: readonly string[];
  readonly projectRuleInputsObserved: boolean;
  readonly projectSkillPayloadsObserved: boolean;
} {
  try {
    const parsed: unknown = JSON.parse(stdout);
    const messages = Array.isArray(parsed) ? parsed : isObject(parsed) ? parsed.messages : undefined;
    if (!Array.isArray(messages)) throw isolationUnproven();
    const text = messages.map(readMessageText).join("\n");
    const projectContextPaths = extractProjectContextPaths(text).filter((path) => path !== isolatedCwd);
    return {
      messageInputsObserved: true,
      projectContextPaths,
      projectRuleInputsObserved: /# AGENTS\.md instructions for\s+\/[^\n<>]+/.test(text) ||
        text.includes("<app-context>"),
      projectSkillPayloadsObserved: hasProjectSkillPayload(text, projectContextPaths),
    };
  } catch (error) {
    if (error instanceof CodexRuntimeError) throw error;
    throw isolationUnproven();
  }
}

function readMessageText(message: unknown): string {
  if (!isObject(message) || typeof message.role !== "string") throw isolationUnproven();
  if (typeof message.content === "string") return message.content;
  if (!Array.isArray(message.content)) throw isolationUnproven();
  return message.content.map((part) => {
    if (!isObject(part) || typeof part.text !== "string") throw isolationUnproven();
    return part.text;
  }).join("\n");
}

function extractProjectContextPaths(text: string): readonly string[] {
  const paths: string[] = [];
  for (const pattern of [
    /# AGENTS\.md instructions for\s+([^\n<>]+)/g,
    /<(?:cwd|workspace_path)>(\/[^<>]+)<\/(?:cwd|workspace_path)>/g,
  ]) {
    for (const match of text.matchAll(pattern)) {
      const path = match[1]?.trim();
      if (path?.startsWith("/") === true) paths.push(path);
    }
  }
  return [...new Set(paths)];
}

function hasProjectSkillPayload(text: string, projectPaths: readonly string[]): boolean {
  return projectPaths.some((path) =>
    text.includes(`${path}/.agents/skills/`) || text.includes(`${path}/.codex/skills/`));
}

function decodeChunks(chunks: readonly Uint8Array[]): string {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  try {
    let text = "";
    for (const chunk of chunks) text += decoder.decode(chunk, { stream: true });
    return text + decoder.decode();
  } catch {
    throw new CodexRuntimeError("codex_tool_isolation_unproven");
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isolationUnproven(): CodexRuntimeError {
  return new CodexRuntimeError("codex_tool_isolation_unproven");
}
