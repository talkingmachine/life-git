# Codex CLI Competition Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provide one fail-closed, tool-free, authenticated Codex CLI JSON runtime that onboarding and Full Life can consume without a local model, API key, provider framework, automatic retry, or project access.

**Architecture:** First build only the closed contracts, bounded process probe, secure temporary-directory boundary, and real capability-isolation evidence. A real prepared-Mac feasibility gate must prove the exhaustive exact 23-feature inventory is known and false, the model-visible message inputs contain no project/workspace path, user/project rule, app-specific instruction or project-local skill payload and expose no callable skill tool, the strict JSONL protocol rejects every tool event, and one synthetic invocation succeeds under the closed exec contract before any production `CodexCliModelAdapter` is implemented. The pinned generic CLI skill catalogue may remain only as inert base developer text. After that gate, Infrastructure installs one startup-preflighted adapter; capability-specific Application ports still own prompts, schemas, limits, and deterministic guards.

**Tech Stack:** Node.js process/fs primitives, TypeScript 6.0.3, Vitest 4.1.10, pnpm 11.19.0, installed `codex-cli 0.148.0-alpha.15`; no new runtime dependency.

**Spec:** `docs/superpowers/specs/2026-08-20-codex-cli-runtime-design.md`

## Global Constraints

- The competition build uses only installed `codex-cli 0.148.0-alpha.15` authenticated by the owner's existing ChatGPT/Codex login. It never asks for, reads, stores, or transmits an API key.
- Do not add Qwen, GGUF, Ollama, LM Studio, `node-llama-cpp`, OpenAI SDK, model downloader, provider registry/switch, session resume, fallback response, retry loop/state/button, background worker, or queue.
- One user action starts at most one `codex exec` process. Version/login preflight runs once at Node startup, not inside an action. Application never starts a second process automatically.
- The child receives no repository/workspace path, user rules, MCP, apps, plugins, project-local skill payload, callable skill tool, browser, shell, multi-agent, image, or workspace-dependency tool. The pinned generic CLI skill catalogue may remain only as inert base developer text.
- Prompts travel only through stdin. JSON Schema is the only temporary file. JSONL/result bytes remain in bounded memory and never enter application, crash, eval, or telemetry logs.
- Runtime output is untrusted. Capability-specific parsers and lineage guards remain the only authorities for questionnaire or film state.
- Tests use an injected fake child process. Only the explicitly approved feasibility and prepared-Mac network/privacy gates contact OpenAI, and they use reviewed synthetic fixtures only.
- The real tool-isolation gate is before production adapter code. It requires every one of the exact 23 tool-feature flags to be known and effective `false`, exact `--strict-config` exec, a fresh empty validated cwd, the closed child environment, no project/workspace/user-rule or project-skill payload, and fail-closed rejection of every tool event. The pinned CLI may include its inert generic skill catalogue in base developer text; both callable skill features remain disabled and the child has no project/file/shell tool. `debug prompt-input` exposes message inputs, not a hidden tool registry; the plan never claims otherwise. If any part is unavailable or drifts, stop and return to the user. A prompt that merely chooses not to call a tool is not sufficient proof.
- Do not use a browser. Preserve the three user-owned `.superpowers/brainstorm/*` directories.

## Pinned CLI contract

The following feature tuple is the one approved by the runtime spec and observed on the pinned CLI build. The same tuple is used both for the feature inventory and `codex exec`; it must not be copied into a second hand-written list.

```ts
export const CODEX_DISABLED_FEATURES = Object.freeze([
  "apps",
  "auth_elicitation",
  "browser_use",
  "browser_use_full_cdp_access",
  "code_mode",
  "code_mode_host",
  "goals",
  "hooks",
  "image_generation",
  "in_app_browser",
  "multi_agent",
  "plugin_sharing",
  "plugins",
  "remote_plugin",
  "shell_snapshot",
  "shell_tool",
  "skill_mcp_dependency_install",
  "skill_search",
  "tool_call_mcp_elicitation",
  "tool_suggest",
  "unified_exec",
  "view_image",
  "workspace_dependencies",
] as const);

export const CODEX_FEATURE_INVENTORY_ARGS = Object.freeze([
  ...CODEX_DISABLED_FEATURES.flatMap((feature) => ["--disable", feature]),
  "features",
  "list",
] as const);

export const CODEX_MESSAGE_INPUT_INSPECTION_ARGS = Object.freeze([
  ...CODEX_DISABLED_FEATURES.flatMap((feature) => ["--disable", feature]),
  "debug",
  "prompt-input",
  "synthetic capability audit",
] as const);

export const CODEX_EXEC_ARGS = Object.freeze([
  "exec",
  "--strict-config",
  "--ephemeral",
  "--ignore-user-config",
  "--ignore-rules",
  ...CODEX_DISABLED_FEATURES.flatMap((feature) => ["--disable", feature]),
  "--sandbox",
  "read-only",
  "--skip-git-repo-check",
] as const);
```

`--strict-config` is mandatory for `exec`, so a misspelled or removed feature cannot be silently ignored. No `approval_policy` override is passed: the apparent `untrusted` override is ineffective on the managed host and would misstate the actual startup behavior. The tuple disables both the `code_mode` capability and its `code_mode_host` support feature; inventory must prove both effective `false`. The resulting two deterministic fail-closed startup notices are accepted only by the exact proof parser below. The pinned CLI's `features list` path uses the same `--disable` pairs without `--strict-config`; its local help does not expose the exec-specific ignore options on that subcommand. Feature inventory must require every tuple member to exist and report effective state `false`.

---

### Task 1: Close invocation, owned-JSON, and event-stream contracts

**Files:**
- Create: `src/infrastructure/codex-cli/contracts.ts`
- Create: `src/infrastructure/codex-cli/owned-json.ts`
- Create: `src/infrastructure/codex-cli/event-stream.ts`
- Create: `tests/infrastructure/codex-cli-contract.test.ts`
- Create: `tests/infrastructure/codex-cli-event-stream.test.ts`

**Interfaces:**
- Consumes: capability-owned prompt/schema/version constants and raw UTF-8 JSONL chunks.
- Produces: one validated invocation, descriptor-safe owned JSON, and one bounded final assistant message for Tasks 2–5.

```ts
// src/infrastructure/codex-cli/contracts.ts
export const CODEX_CLI_VERSION = "codex-cli 0.148.0-alpha.15" as const;
export const CODEX_INVOCATION_VERSION = "codex-cli-invocation@1" as const;
export const MAX_CODEX_TIMEOUT_MS = 120_000;
export const MAX_CODEX_STDOUT_BYTES = 1_048_576;
export const MAX_CODEX_STDERR_BYTES = 65_536;
export const MAX_CODEX_EVENTS = 256;
export const MAX_CODEX_PROMPT_BYTES = 262_144;

export type CodexCapabilityId =
  | "onboarding_extract"
  | "onboarding_review"
  | "full_life_film";

export interface CodexInvocationLimits {
  readonly timeoutMs: number;
  readonly maxStdoutBytes: number;
  readonly maxStderrBytes: number;
  readonly maxEvents: number;
}

export interface CodexJsonInvocation {
  readonly capability: CodexCapabilityId;
  readonly templateVersion: string;
  readonly schemaVersion: string;
  readonly prompt: string;
  readonly outputSchema: JsonObject;
  readonly limits: CodexInvocationLimits;
  readonly signal: AbortSignal;
}

export interface CodexInvocationMetadata {
  readonly invocationVersion: typeof CODEX_INVOCATION_VERSION;
  readonly cliVersion: typeof CODEX_CLI_VERSION;
  readonly templateVersion: string;
  readonly schemaVersion: string;
}

export interface CodexJsonResult {
  readonly value: JsonValue;
  readonly metadata: CodexInvocationMetadata;
}

export type CodexRuntimeErrorCode =
  | "codex_missing"
  | "codex_version_mismatch"
  | "codex_not_authenticated"
  | "codex_protocol_invalid"
  | "codex_tool_event"
  | "codex_output_too_large"
  | "codex_event_limit"
  | "codex_timeout"
  | "codex_aborted"
  | "codex_process_failed"
  | "codex_json_invalid"
  | "codex_temp_root_invalid"
  | "codex_tool_isolation_unproven";

export class CodexRuntimeError extends Error {
  constructor(readonly code: CodexRuntimeErrorCode) {
    super(code);
  }
}

export function createCodexJsonInvocation(input: {
  readonly capability: CodexCapabilityId;
  readonly templateVersion: string;
  readonly schemaVersion: string;
  readonly prompt: string;
  readonly outputSchema: unknown;
  readonly limits: CodexInvocationLimits;
  readonly signal: AbortSignal;
}): CodexJsonInvocation;
```

`createCodexJsonInvocation` requires exact plain inputs, a non-aborted real `AbortSignal`, non-empty bounded version strings, a UTF-8 prompt no larger than `MAX_CODEX_PROMPT_BYTES`, and integer limits in `1..MAX_*`. It snapshots `outputSchema` before any `JSON.stringify` or filesystem call, so getters, symbols, custom prototypes, sparse/decorated arrays, cycles, non-finite numbers, `undefined`, and typed arrays never reach the child.

```ts
// src/infrastructure/codex-cli/owned-json.ts
export type JsonPrimitive = null | boolean | number | string;
export type JsonValue = JsonPrimitive | JsonObject | readonly JsonValue[];
export interface JsonObject {
  readonly [key: string]: JsonValue;
}

export function snapshotOwnedJson(value: unknown): JsonValue;

// src/infrastructure/codex-cli/event-stream.ts
export const CODEX_STARTUP_NOTICES = Object.freeze([
  "approval_policy_never_to_unless_trusted",
  "code_mode_host_disabled",
] as const);

export type CodexStartupNotice = (typeof CODEX_STARTUP_NOTICES)[number];
export type CodexStartupNotices = typeof CODEX_STARTUP_NOTICES;

export interface CodexEventStreamProof {
  readonly finalMessage: string;
  readonly startupNotices: CodexStartupNotices;
  readonly eventTypes: readonly string[];
}

export function fingerprintCodexNoticeMessage(message: string): Readonly<{
  readonly utf8ByteLength: number;
  readonly sha256: string;
}>;

export async function parseCodexEventStream(
  chunks: AsyncIterable<Uint8Array>,
  limits: {
    readonly maxStdoutBytes: number;
    readonly maxEvents: number;
  },
): Promise<string>;

export async function parseCodexEventStreamWithProof(
  chunks: AsyncIterable<Uint8Array>,
  limits: {
    readonly maxStdoutBytes: number;
    readonly maxEvents: number;
  },
): Promise<CodexEventStreamProof>;
```

`parseCodexEventStream` increments byte and event counters before retaining or parsing a line. It accepts only the pinned protocol: one `thread.started`, one `turn.started`, optional paired `item.started`/`item.completed` reasoning progress, exactly one completed `agent_message`, and one `turn.completed`. It rejects every error notice, duplicate terminal messages, unpaired items, events after completion, `turn.failed`, unknown top-level/item types, and any command, shell, browser, MCP, app, plugin, skill, image, tool-call, or tool-result item.

The proof-only `parseCodexEventStreamWithProof` requires exactly two consecutive notices after the sole `thread.started` and immediately before `turn.started`. First is an `item.completed`/`error` item with exact unordered event keys `{type,item}`, exact unordered item keys `{type,id,message}`, ID `item_0`, decoded-message UTF-8 length 277, and raw decoded-message SHA-256 `dc04a3e848ff580847de6950e6415fe72d1daab7d83336461b55b6fc8355e177`. Second has the same exact key/type shape, ID `item_1`, and the exact 157-byte Code Mode host-disabled static message. No normalization is performed. Omission, extra notice, reordering, mutation, wrong key/ID/position, later error, `turn.failed`, or tool item fails closed. The parser returns only the fixed enum tuple, final message, and event types from that same parse; it never returns either raw notice. Because the 277-byte policy text is unavailable to unit tests, they pin public UTF-8/SHA mechanics, positively test the host notice, and exhaustively test negative streams; the one real gate is the sole positive integration for the policy hash preimage.

- [ ] **Step 1: Write invocation and owned-JSON RED tests.** Add table cases for every rejected descriptor/value and each out-of-range limit.

```ts
test("rejects a schema accessor without executing it", () => {
  const getter = vi.fn(() => ({ type: "object" }));
  const schema = Object.create(null, { type: { enumerable: true, get: getter } });
  expect(() => createCodexJsonInvocation({
    capability: "onboarding_extract",
    templateVersion: "extract@1",
    schemaVersion: "onboarding-extraction@1",
    prompt: "synthetic",
    outputSchema: schema,
    limits: { timeoutMs: 15_000, maxStdoutBytes: 65_536, maxStderrBytes: 16_384, maxEvents: 64 },
    signal: new AbortController().signal,
  })).toThrowError("codex_protocol_invalid");
  expect(getter).not.toHaveBeenCalled();
});

test("rejects an event count above the closed limit", async () => {
  await expect(parseCodexEventStream(streamOf(...tooManyEvents), {
    maxStdoutBytes: 65_536,
    maxEvents: 4,
  })).rejects.toMatchObject({ code: "codex_event_limit" });
});
```

- [ ] **Step 2: Run RED.** Run `pnpm exec vitest run tests/infrastructure/codex-cli-contract.test.ts tests/infrastructure/codex-cli-event-stream.test.ts`; expect missing-module failures.
- [ ] **Step 3: Implement the exact types, recursive snapshot, invocation factory, and streaming decoder.** Do not add an executable, process, temp directory, or adapter in this task.
- [ ] **Step 4: Run GREEN.** Run the two focused suites, `pnpm run typecheck`, scoped ESLint, and `git diff --check`.
- [ ] **Step 5: Commit.**

```bash
git add src/infrastructure/codex-cli/contracts.ts \
  src/infrastructure/codex-cli/owned-json.ts \
  src/infrastructure/codex-cli/event-stream.ts \
  tests/infrastructure/codex-cli-contract.test.ts \
  tests/infrastructure/codex-cli-event-stream.test.ts
git commit -m "feat: define Codex CLI protocol"
```

---

### Task 2: Build only the bounded preflight and isolated feasibility process

**Files:**
- Create: `src/infrastructure/codex-cli/preflight.ts`
- Create: `src/infrastructure/codex-cli/temp-directory.ts`
- Create: `src/infrastructure/codex-cli/process.ts`
- Create: `src/infrastructure/codex-cli/feasibility-probe.ts`
- Create: `tests/infrastructure/codex-cli-preflight.test.ts`
- Create: `tests/infrastructure/codex-cli-temp-directory.test.ts`
- Create: `tests/infrastructure/codex-cli-process.test.ts`

**Interfaces:**
- Consumes: Task 1 contracts, injected process spawner, executable resolver, clock, UID, and configured temp root.
- Produces: bounded version/login/feature/message-input probes and a secure one-shot JSONL process for Task 3. It does not produce `CodexCliModelAdapter` or a production singleton.

```ts
// src/infrastructure/codex-cli/process.ts
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

export async function runBoundedProcess(
  request: BoundedProcessRequest,
  spawner: CodexProcessSpawner,
): Promise<BoundedProcessResult>;
```

`runBoundedProcess` rejects a pre-aborted signal before spawn. It writes and closes stdin through the concrete spawner, reads stdout/stderr concurrently, sends `SIGTERM` on timeout/abort/overflow, waits 250 ms, sends `SIGKILL` only if the exit promise remains pending, observes all late stream/exit rejections, and gives caller abort precedence. It owns bounded stderr chunks only when `captureStderr` is explicitly true; otherwise it returns only the byte count. It never includes stderr or stdout content in errors.

```ts
// src/infrastructure/codex-cli/preflight.ts
export const CODEX_PREFLIGHT_LIMITS = Object.freeze({
  timeoutMs: 5_000,
  maxStdoutBytes: 4_096,
  maxStderrBytes: 16_384,
} as const);

export interface CodexPreflightResult {
  readonly executable: string;
  readonly cliVersion: typeof CODEX_CLI_VERSION;
  readonly authenticatedWith: "ChatGPT";
}

export async function preflightCodexCli(input: {
  readonly configuredExecutable?: string;
  readonly pathValue?: string;
  readonly spawner: CodexProcessSpawner;
  readonly childEnv: Readonly<Record<string, string>>;
  readonly signal: AbortSignal;
}): Promise<CodexPreflightResult>;

export async function readDisabledFeatureInventory(input: {
  readonly preflight: CodexPreflightResult;
  readonly spawner: CodexProcessSpawner;
  readonly childEnv: Readonly<Record<string, string>>;
  readonly signal: AbortSignal;
}): Promise<Readonly<Record<(typeof CODEX_DISABLED_FEATURES)[number], false>>>;
```

Executable resolution is: explicit `CODEX_EXECUTABLE`, then `/Applications/ChatGPT.app/Contents/Resources/codex`, then each `PATH` entry resolved by Node filesystem primitives. The result must be an absolute real regular executable, not a symlink or directory. Preflight runs bounded `--version` and `login status`: version stdout must be exact `codex-cli 0.148.0-alpha.15\n` and version stderr must be empty or exactly one known PATH-alias warning; login stdout must be empty and login stderr must be exactly `Logged in using ChatGPT\n`, optionally preceded by that one warning. Unknown, reordered, or duplicate stderr content is rejected. Bounded stderr is retained only inside this preflight comparison and never enters application errors, artifacts or logs. Preflight never starts login.

Feature inventory runs `CODEX_FEATURE_INVENTORY_ARGS` exactly. It deliberately does not add `--strict-config`; it verifies every shared tuple member is known on the pinned build and effective `false`.

```ts
// src/infrastructure/codex-cli/temp-directory.ts
export interface ValidatedCodexTempRoot {
  readonly path: string;
  readonly uid: number;
}

export interface CodexTempDirectory {
  readonly directoryPath: string;
  readonly schemaPath: string;
}

export async function validateCodexTempRoot(input: {
  readonly path: string;
  readonly currentUid: number;
  readonly userHomePath: string;
  readonly workspacePath: string;
}): Promise<ValidatedCodexTempRoot>;

export async function withCodexTempDirectory<T>(input: {
  readonly root: ValidatedCodexTempRoot;
  readonly outputSchema: JsonObject;
  readonly use: (directory: CodexTempDirectory) => Promise<T>;
}): Promise<T>;

export async function scavengeStaleCodexDirectories(input: {
  readonly root: ValidatedCodexTempRoot;
  readonly now: Date;
  readonly staleAfterMs: 3_600_000;
}): Promise<number>;
```

`validateCodexTempRoot` requires an absolute, real directory owned by the current UID, rejects a symlink final entry with or without a trailing slash, `/`, the canonical user home, the canonical workspace, and a canonical parent of the workspace, and returns the canonical path. The standard macOS `/var -> /private/var` intermediate alias is accepted and canonicalized. `withCodexTempDirectory` creates only a direct `confirmed-life-codex-*` child with `0700`, writes only `schema.json` using exclusive create and `0600`, and removes the child in `finally`. Scavenging inspects only direct exact-prefix entries, preserves wrong-owner/new/symlink entries, never follows nested symlinks, and removes an owned directory only after the one-hour threshold. Since every invocation timeout is at most two minutes, a live invocation cannot become stale.

```ts
// src/infrastructure/codex-cli/feasibility-probe.ts
export async function runCodexJsonProbe(input: {
  readonly invocation: CodexJsonInvocation;
  readonly preflight: CodexPreflightResult;
  readonly spawner: CodexProcessSpawner;
  readonly tempRoot: ValidatedCodexTempRoot;
  readonly childEnv: Readonly<Record<string, string>>;
}): Promise<{
  readonly pid: number;
  readonly finalMessage: string;
  readonly startupNotices: CodexStartupNotices;
  readonly eventTypes: readonly string[];
}>;

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
}>;
```

`runCodexJsonProbe` builds exact args as `CODEX_EXEC_ARGS`, `--cd <fresh-dir>`, `--output-schema <schema-file>`, `--json`, `-`. The feature tuple appears once through the shared constant; `--strict-config` is present only on exec and no ineffective approval-policy override is added. It returns the final message, event types, and fixed two-notice enum proof from one `parseCodexEventStreamWithProof` pass. The child environment is freshly built from defined `CODEX_HOME`, `TMPDIR`, `LANG`, and `LC_ALL`; it never spreads `process.env`.

`inspectModelVisibleInputs` creates a fresh empty direct child under the validated temp root, runs `CODEX_MESSAGE_INPUT_INSPECTION_ARGS` exactly with that child as process cwd and the same closed environment, parses the local no-model `debug prompt-input` message list, and removes the child in `finally`. It requires an observed parseable message-input list and derives only whether a repository/workspace path, user/project rule, app-specific instruction sentinel or project-local skill payload is present. The pinned generic CLI developer/skill catalogue may remain as inert text; `skill_search` and `skill_mcp_dependency_install` must both be known and false. This diagnostic does not expose or prove a separate hidden tool registry. Missing/unknown output, forbidden project-specific input, a non-empty initial cwd, wrong cwd/env, or cleanup failure stops Task 3 before any model call or adapter implementation.

- [ ] **Step 1: Write bounded preflight/process RED tests.** Include this pre-abort test, then exact version/auth, missing executable, bounded stdout/stderr, hung preflight, spawn error, stdin close, timeout, SIGTERM/SIGKILL, late rejection, and exactly-one-spawn cases.

```ts
test("does not spawn when caller is already aborted", async () => {
  const spawner = fakeSpawner();
  await expect(runBoundedProcess({
    ...validBoundedRequest(),
    signal: AbortSignal.abort(new DOMException("cancelled", "AbortError")),
  }, spawner)).rejects.toMatchObject({ name: "AbortError" });
  expect(spawner.spawn).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Write temp-root/directory and message-input diagnostic RED tests.** Cover non-absolute/root/home/workspace/parent/symlink/wrong-owner rejection, `0700`/`0600`, exclusive schema creation, cleanup on all exits, nested-symlink target preservation, exact stale deletion, diagnostic cwd equal to a fresh initially empty child, the exact closed environment, project/rule/skill detection, malformed diagnostic output, and cleanup after diagnostic success/failure/abort.

```ts
test("never follows a nested symlink during scavenging", async () => {
  const outside = await createSentinelDirectory();
  const stale = await createOwnedStaleCodexDirectory();
  await symlink(outside.path, join(stale.path, "outside"));
  await scavengeStaleCodexDirectories({ root, now, staleAfterMs: 3_600_000 });
  await expect(readFile(outside.sentinel, "utf8")).resolves.toBe("keep");
});
```

- [ ] **Step 3: Run RED.** Run `pnpm exec vitest run tests/infrastructure/codex-cli-preflight.test.ts tests/infrastructure/codex-cli-temp-directory.test.ts tests/infrastructure/codex-cli-process.test.ts`; expect missing-module failures.
- [ ] **Step 4: Implement bounded process, executable resolver, safe temp lifecycle, shared CLI args, and probe only.** Use `node:child_process`, `node:fs/promises`, `node:path`, and `node:os`; do not create `model-adapter.ts`, `runtime.ts`, `instrumentation.ts`, or a product composition.
- [ ] **Step 5: Run GREEN.** Run the three focused suites, `pnpm run typecheck`, scoped ESLint, and `git diff --check`.
- [ ] **Step 6: Commit.**

```bash
git add src/infrastructure/codex-cli/preflight.ts \
  src/infrastructure/codex-cli/temp-directory.ts \
  src/infrastructure/codex-cli/process.ts \
  src/infrastructure/codex-cli/feasibility-probe.ts \
  tests/infrastructure/codex-cli-preflight.test.ts \
  tests/infrastructure/codex-cli-temp-directory.test.ts \
  tests/infrastructure/codex-cli-process.test.ts
git commit -m "feat: isolate Codex CLI feasibility probe"
```

---

### Task 3: Prove real capability isolation before production adapter code

**Files:**
- Create: `evals/codex-cli-feasibility.ts`
- Create: `evals/fixtures/codex-cli/runtime-cases.json`
- Create: `tests/integration/codex-cli-feasibility-contract.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: Tasks 1–2, installed pinned CLI, existing ChatGPT login, and reviewed synthetic fixture.
- Produces: one redacted `codex-cli-feasibility@1` artifact and a binary proceed/stop decision. It still does not create a production adapter.

```ts
export interface CodexCliFeasibilityArtifact {
  readonly schemaVersion: "codex-cli-feasibility@1";
  readonly cliVersion: typeof CODEX_CLI_VERSION;
  readonly authenticatedWith: "ChatGPT";
  readonly disabledFeatures: Readonly<Record<(typeof CODEX_DISABLED_FEATURES)[number], false>>;
  readonly strictExecConfig: true;
  readonly messageInputsObserved: true;
  readonly diagnosticWorkingDirectory: "fresh_validated_empty";
  readonly closedChildEnvironment: true;
  readonly projectContextPaths: readonly [];
  readonly projectRuleInputsObserved: false;
  readonly projectSkillPayloadsObserved: false;
  readonly callableSkillFeaturesDisabled: true;
  readonly codexExecProcessCount: 1;
  readonly eventTypes: readonly string[];
  readonly startupNotices: CodexStartupNotices;
  readonly toolEventTypes: readonly [];
  readonly resultSchemaVersion: "codex-runtime-smoke@1";
  readonly resultDigest: string;
  readonly stdoutBytes: number;
  readonly stderrBytes: number;
  readonly eventCount: number;
  readonly elapsedMs: number;
  readonly residualTempDirectories: readonly [];
  readonly sensitiveSentinelHits: readonly [];
}

export async function runCodexCliFeasibility(input: {
  readonly artifactPath: string;
  readonly configuredExecutable?: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly signal: AbortSignal;
}): Promise<CodexCliFeasibilityArtifact>;
```

The fixture contains only synthetic sentinels and a schema whose exact result is `{schemaVersion:"codex-runtime-smoke@1",status:"tool_free"}`. The gate executes in this order:

1. bounded version/login preflight;
2. `CODEX_FEATURE_INVENTORY_ARGS`, parsing the CLI-owned full registry and requiring every member of the exact 23-feature tuple to be present once and effective `false`; unrelated known registry entries are allowed, while a missing, duplicate or enabled pinned member or malformed/duplicate registry line fails;
3. local no-model message-input inspection in a fresh initially empty validated temp cwd under the closed child environment, requiring a parseable list with zero project/workspace paths other than the exact expected diagnostic cwd, user/project rules, app-specific sentinels or project-local skill payloads; inert generic CLI developer/skill text is allowed only while both callable skill features are false, and the diagnostic makes no hidden-registry claim;
4. only after 1–3 pass, one synthetic `codex exec` with exact `--strict-config`, the same shared 23-feature tuple, fresh empty cwd and closed environment; its adversarial prompt requests repository access, `pwd`, browser, app, plugin, MCP, skill, multi-agent, image, and schema bypass;
5. strict event/schema/result/temp-residue checks;
6. write only the redacted artifact above.

The artifact stores hashes, booleans, counts, event type names, the fixed startup-notice enum tuple, and timings only. It stores no prompt, message-input text, startup-notice message, result text, stdout, stderr, thread ID, session ID, auth path/token, model ID, developer/skill content, or synthetic sentinel. Only the exact two-member tuple is representable; any missing, extra, reordered, or mutated notice remains protocol drift. Any missing/duplicate/enabled pinned feature, malformed/duplicate registry line, unparseable message inputs, forbidden project-specific input, wrong/non-empty cwd, open environment, absent `--strict-config`, tool event, extra Codex exec process, protocol drift, or residual directory throws `codex_tool_isolation_unproven` and writes no passing artifact.

- [ ] **Step 1: Write RED artifact tests with injected probes.** Pin ordered calls, zero model spawn before capability proof, one model spawn after proof, exact artifact keys, and no sentinel/raw output leakage.

```ts
test("stops before model invocation when message inputs contain project context", async () => {
  const modelProbe = vi.fn();
  await expect(runCodexCliFeasibilityForTest({
    ...validDependencies(),
    inspectMessageInputs: async () => ({
      messageInputsObserved: true,
      projectContextPaths: ["/demo/workspace/AGENTS.md"],
      projectRuleInputsObserved: false,
      projectSkillPayloadsObserved: false,
      callableSkillFeaturesDisabled: true,
    }),
    runModelProbe: modelProbe,
  })).rejects.toMatchObject({ code: "codex_tool_isolation_unproven" });
  expect(modelProbe).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run RED.** Run `pnpm exec vitest run tests/integration/codex-cli-feasibility-contract.test.ts`; expect the eval module and package script to be absent.
- [ ] **Step 3: Implement only the feasibility CLI/artifact.** Add `"eval:codex-runtime-feasibility": "node --import tsx evals/codex-cli-feasibility.ts"`; do not add adapter/startup files.
- [ ] **Step 4: Run fake GREEN.** Run Task 1–3 fake suites, `pnpm run typecheck`, scoped ESLint, and `git diff --check`.
- [ ] **Step 5: Obtain explicit authorization for the one synthetic OpenAI call, then run the early real gate on the prepared Mac.**

```bash
pnpm run eval:codex-runtime-feasibility \
  --artifact data/evals/codex-cli-feasibility.json
```

Expected: exact CLI/login streams; all exact 23 tuple members present and false within the CLI-owned full registry; a fresh empty diagnostic/exec cwd; closed env; parseable message inputs with zero project/workspace/rule/app-specific or project-local-skill context after excluding only the diagnostic's exact own cwd; both callable skill features disabled; exact `--strict-config` exec without an approval override; one schema-valid `codex exec`; zero tool events; the exact fixed two-notice startup proof; and zero residual directories. If any proof is unavailable or fails, stop, report `codex_tool_isolation_unproven`, and do not begin Task 4. Do not weaken the feature tuple, reject unrelated known CLI registry entries, remove `--strict-config`, treat `debug prompt-input` as a hidden tool-registry API, infer tool absence from a quiet event stream, or add a tool-enabled fallback.

- [ ] **Step 6: Commit the gate only after it passes.**

```bash
git add evals/codex-cli-feasibility.ts \
  evals/fixtures/codex-cli/runtime-cases.json \
  tests/integration/codex-cli-feasibility-contract.test.ts package.json
git commit -m "test: prove Codex CLI tool isolation"
```

---

### Task 4: Add the production adapter and startup-owned runtime

**Hard prerequisite:** Task 3 has a reviewed passing `codex-cli-feasibility@1` artifact from the prepared Mac. Without it this task is unauthorized.

**Files:**
- Create: `src/infrastructure/codex-cli/model-adapter.ts`
- Create: `src/infrastructure/codex-cli/runtime.ts`
- Create: `src/instrumentation.ts`
- Create: `src/instrumentation-node.ts`
- Create: `tests/integration/codex-cli-runtime.test.ts`

**Interfaces:**
- Consumes: Tasks 1–3 and capability-specific `CodexJsonInvocation` values.
- Produces: one startup-preflighted process-local adapter for future onboarding and Full Life composition.

```ts
// src/infrastructure/codex-cli/model-adapter.ts
export interface CodexCliModelAdapterOptions {
  readonly preflight: CodexPreflightResult;
  readonly spawner: CodexProcessSpawner;
  readonly tempRoot: ValidatedCodexTempRoot;
  readonly childEnv: Readonly<Record<string, string>>;
}

export class CodexCliModelAdapter {
  constructor(options: CodexCliModelAdapterOptions);
  invokeJson(input: CodexJsonInvocation): Promise<CodexJsonResult>;
}

export function createCodexCliModelAdapterForTest(
  options: CodexCliModelAdapterOptions,
): CodexCliModelAdapter;
```

`invokeJson` performs exactly one `runCodexJsonProbe`, parses the final text with `JSON.parse`, immediately passes it through `snapshotOwnedJson`, and returns that recursively frozen owned snapshot plus frozen invocation/template/schema metadata. It exposes no model selector, endpoint, API key, resume/session, provider name, cache, fallback, retry, or domain parser. It never retries a failed process.

```ts
// src/infrastructure/codex-cli/runtime.ts
export interface InitializeCodexCliRuntimeInput {
  readonly configuredExecutable?: string;
  readonly pathValue?: string;
  readonly tempRootPath: string;
  readonly currentUid: number;
  readonly childEnv: Readonly<Record<string, string>>;
  readonly spawner: CodexProcessSpawner;
  readonly clock: () => Date;
  readonly signal: AbortSignal;
}

export async function initializeCodexCliRuntime(
  input: InitializeCodexCliRuntimeInput,
): Promise<void>;

export function getCodexCliModelAdapter(): CodexCliModelAdapter;
```

Initialization validates the temp root, scavenges exact stale owned directories, performs bounded version/login preflight, verifies the pinned feature inventory again, and installs one adapter. A process-global state keyed by `Symbol.for("confirmed-life.codex-cli-runtime@1")` shares the same terminal promise and adapter across separately bundled Next instrumentation and route entries. Concurrent initialization shares one promise. Failure installs nothing; `getCodexCliModelAdapter` throws `codex_process_failed` before/after failed initialization. Production exports no reset/reconfigure function.

`src/instrumentation.ts` dynamically imports the Node-only `src/instrumentation-node.ts` helper only for the Node server runtime and never during `next build`; the Edge bundle therefore never imports Node process/filesystem modules. The helper awaits `initializeCodexCliRuntime` exactly once before a request can reach model-assisted actions. It builds `childEnv` from individually selected defined `CODEX_HOME`, `TMPDIR`, `LANG`, and `LC_ALL` values; it never spreads `process.env`. Future onboarding/Full Life compositions call only `getCodexCliModelAdapter`, so one user action starts one `codex exec`, not version/login children.

- [ ] **Step 1: Write adapter/runtime RED tests.** Include recursive owned output and single initialization/action tests.

```ts
test("returns an owned recursively frozen JSON snapshot", async () => {
  const adapter = createCodexCliModelAdapterForTest(validAdapterOptions({
    spawner: fakeSpawnerReturning('{"nested":{"ok":true}}'),
  }));
  const result = await adapter.invokeJson(validInvocation());
  expect(result.value).toEqual({ nested: { ok: true } });
  expect(Object.isFrozen(result.value)).toBe(true);
  expect(Object.isFrozen((result.value as { nested: object }).nested)).toBe(true);
});

test("one action starts one exec process and never retries", async () => {
  const spawner = fakeSpawnerFailingOnce();
  const adapter = createCodexCliModelAdapterForTest(validAdapterOptions({ spawner }));
  await expect(adapter.invokeJson(validInvocation())).rejects.toMatchObject({ code: "codex_process_failed" });
  expect(spawner.spawn).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run RED.** Run `pnpm exec vitest run tests/integration/codex-cli-runtime.test.ts`; expect missing adapter/runtime modules.
- [ ] **Step 3: Implement the minimal adapter, runtime singleton, and Node startup hook.** Do not create onboarding or Full Life prompts/ports here.
- [ ] **Step 4: Run GREEN.** Run all Codex fake suites, `pnpm run typecheck`, scoped ESLint, `pnpm run build`, and `git diff --check`.
- [ ] **Step 5: Commit.**

```bash
git add src/infrastructure/codex-cli/model-adapter.ts \
  src/infrastructure/codex-cli/runtime.ts src/instrumentation.ts \
  src/instrumentation-node.ts \
  tests/integration/codex-cli-runtime.test.ts
git commit -m "feat: install Codex CLI runtime"
```

---

### Task 5: Prove dependency, API-key, network, and privacy boundaries

**Files:**
- Create: `scripts/audit-codex-runtime.ts`
- Create: `evals/codex-cli-network-privacy.ts`
- Create: `evals/fixtures/codex-cli/network-allowlist.json`
- Create: `tests/integration/codex-cli-audit.test.ts`
- Create: `tests/integration/codex-cli-network-privacy-contract.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: production runtime, prepared-Mac synthetic fixture, package graph/files, and OS-observed child TCP connections.
- Produces: a zero-match static audit and one redacted `codex-cli-network-privacy-audit@1` artifact.

```ts
export interface CodexRuntimeStaticAudit {
  readonly schemaVersion: "codex-runtime-static-audit@1";
  readonly forbiddenDependencyMatches: readonly [];
  readonly apiKeyHandlingMatches: readonly [];
  readonly modelDownloadMatches: readonly [];
  readonly forbiddenRuntimeMethodMatches: readonly [];
}

export interface CodexCliNetworkPrivacyAuditArtifact {
  readonly schemaVersion: "codex-cli-network-privacy-audit@1";
  readonly cliVersion: typeof CODEX_CLI_VERSION;
  readonly executableKind: "chatgpt_app_bundled";
  readonly allowlistVersion: "codex-cli-network-allowlist@1";
  readonly allowlistDigest: string;
  readonly dnsSnapshotDigest: string;
  readonly syntheticFixtureDigest: string;
  readonly codexExecProcessCount: 1;
  readonly sameIntervalObserved: true;
  readonly sampledProcesses: readonly [
    { readonly kind: "application"; readonly processId: number; readonly sampleCount: number },
    { readonly kind: "codex"; readonly processId: number; readonly sampleCount: number },
  ];
  readonly approvedEndpoints: readonly ["chatgpt.com:443"];
  readonly observedConnections: readonly {
    readonly processId: number;
    readonly processKind: "codex";
    readonly remoteEndpoint: "chatgpt.com";
    readonly remotePort: 443;
    readonly classification: "openai";
  }[];
  readonly otherModelProviderConnections: readonly [];
  readonly applicationTelemetryConnections: readonly [];
  readonly sensitiveSentinelHits: readonly [];
  readonly rawPromptStored: false;
  readonly rawResultStored: false;
  readonly stdoutStored: false;
  readonly stderrStored: false;
  readonly residualTempDirectories: readonly [];
  readonly artifactDigest: string;
}
```

`scripts/audit-codex-runtime.ts` has two closed scopes and never scans historical specs/plans/tests/evals or itself. Across the complete installed production dependency graph resolved from `package.json` and every real owner manifest, all production `src` files and checked-in environment templates it rejects Qwen, GGUF, Ollama, LM Studio, `node-llama-cpp`, OpenAI SDK dependency/import, downloader/model weights, `OPENAI_API_KEY` and API-key input/storage/billing. Across only the exact Codex runtime import closure rooted at Node instrumentation it additionally rejects `--model`, resume/session, fallback provider and retry/background surface, without false-positive scanning legitimate official-source Research retry code. Dependency traversal resolves each required package from the real owner-manifest location (including pnpm virtual-store symlinks), validates both requested and declared manifest names to close npm aliases, fails closed on missing required manifests and permits only genuinely absent optional/platform packages. Exact approved `Codex CLI`/`OpenAI` boundary copy is not an SDK match.

`network-allowlist.json` is the closed value `{ "schemaVersion": "codex-cli-network-allowlist@1", "exactHosts": ["chatgpt.com"], "remotePorts": [443] }`. The pinned ChatGPT-login binary names `https://chatgpt.com/backend-api/`; generic API-key, auth, metrics, staging, suffix and wildcard hosts are not approved. Immediately before the model child is spawned, the gate resolves both A and AAAA records for that exact hostname into a bounded, non-empty, frozen DNS snapshot: five-second total timeout, at most 16 addresses per family and 32 total, and one missing family permitted. A pure closed public-address classifier allows only global-unicast addresses and rejects the pinned IPv4/IPv6 special-use ranges, including unspecified, loopback, private/unique-local, link-local, CGNAT, protocol/benchmarking/documentation/reserved and multicast space. A wholly empty, malformed, non-public, over-cap or failed snapshot stops before the model call. The child must be spawned within one second of completing the snapshot. The gate never learns or approves a destination from observed traffic.

`evals/codex-cli-network-privacy.ts` wraps the production `CodexProcessSpawner` at spawn time and observes only the one child whose exact argv begins with `exec`; version/login/inventory children remain ordinary preflight and are not counted as model invocations. The same wrapper is installed during runtime initialization, then receives its frozen DNS snapshot immediately before the action. From model spawn until its `exit` settles, the wrapper runs non-overlapping paired samples of the child PID and `process.pid` using `/usr/sbin/lsof -nP -w -a -p <pid> -i -F0pcfnPT`, starting immediately and repeating about every 25 ms. The single `-i` selector is deliberate: on prepared macOS `lsof 4.91` it covers TCP and UDP with a reliable status, while separate `-iTCP -iUDP` selectors can return status 1 despite emitted records. The wrapped `exit` does not settle until observer completion. `-nP` is mandatory: PTR/reverse DNS is not accepted as hostname evidence. A strict bounded parser first separates newline process/file records and then their NUL-terminated fields; it uses `p` process and `f` file boundaries, accepts numeric IPv4, bracketed IPv6 and IPv4-mapped IPv6, and extracts remote address/port only from exactly one `local->remote`. It requires one `TST` field while permitting the prepared-Mac `TQR`/`TQS` fields exactly once; duplicate semantic fields fail. It compares only canonical numeric addresses to the pre-spawn DNS snapshot and never writes raw IPs to the artifact. At least one Codex record must be `TCP`, `TST=ESTABLISHED`, port 443 and map uniquely to exact `chatgpt.com`; every other connected/listening TCP record, every UDP record, unknown/ambiguous address, non-443 port, hostname, scope ID, duplicate/missing field or malformed stream fails closed.

Before emitting `executableKind: "chatgpt_app_bundled"`, the gate canonicalizes the preflight executable and requires the exact prepared-Mac path `/Applications/ChatGPT.app/Contents/Resources/codex`; a configured, PATH-resolved, symlinked or alternate binary that canonicalizes elsewhere stops without an artifact. The lsof result is explicitly sampled evidence, not a claim that polling can observe a socket whose entire lifetime falls between samples. `applicationTelemetryConnections: []` and `otherModelProviderConnections: []` mean none were observed in the required paired samples.

PID liveness is proved independently with the POSIX zero-signal check immediately before and after each paired sample; `lsof` exit `1` plus empty stdout/stderr is a valid connection-free sample only while that PID is proven live on both sides. Each `lsof` call has a bounded timeout and 64 KiB output cap. Both PIDs require at least one paired live sample in the same interval. A final sweep that began while both PIDs were live but overlaps the independently observed normal child exit cannot supply the first live sample or the required approved Codex connection; only its empty/dead result may be discarded. Every complete record parsed from that sweep is still classified, and any forbidden/unknown record fails the gate. Any earlier liveness loss remains a failure. The application may have zero sockets, while Codex requires at least one approved connected record. A missed/dead PID, malformed/non-machine output, unexpected `lsof` status/stderr, empty Codex observation set, any Node/application socket, another provider, or synthetic sensitive sentinel in artifact/error/temp files fails the gate and requires user review. The artifact records only a fixed bundled-executable classification, process kind/PID/sample count and the projected approved endpoint/port/classification; never executable path, DNS addresses, payload bytes, raw process output or warning text. `allowlistDigest`, `dnsSnapshotDigest`, `syntheticFixtureDigest` and the self-excluding `artifactDigest` are full SHA-256 of canonical closed inputs; arrays are deduplicated and sorted before hashing. The script never auto-expands the allowlist.

The JSON artifact is written under ignored `data/evals/`. Before any validation, DNS or process call, the gate removes a prior passing artifact; every failure leaves it absent. A passing artifact is written atomically with mode `0600`, newline termination and only the closed fields above. The test fixture uses unique sentinels and proves none appear in serialized artifacts, process errors, or test-captured logs.

- [ ] **Step 1: Write static-audit RED tests.** Use temporary package/runtime fixtures with one forbidden case each and one clean current-tree case.

```ts
test.each(["node-llama-cpp", "OPENAI_API_KEY", "--model", "resume(", "retryProvider"])(
  "fails closed on forbidden runtime surface %s",
  async (needle) => {
    const fixture = await runtimeFixtureContaining(needle);
    await expect(auditCodexRuntime(fixture)).rejects.toThrow("codex_runtime_audit_failed");
  },
);
```

- [ ] **Step 2: Write network/privacy artifact RED tests.** Cover stale-artifact removal before all callbacks and absence after failure; exact bundled executable realpath; exact allowlist reconstruction; bounded A/AAAA snapshot with one family absent; DNS timeout/failure/empty/over-cap/non-public address; spawn-after-one-second; strict bounded NUL `lsof -nP` parsing for IPv4, compressed/expanded IPv6 and IPv4-mapped IPv6; wrong PID, duplicate/missing fields, hostname/scope drift, listener, UDP and TCP-state cases; independent before/after liveness; live empty exit-1 application sample; dead/missed PID; malformed/status/stderr/timeout/overflow; allowed, unknown, ambiguous, empty Codex, wrong-port, Node/application telemetry, second exec, sentinel, and raw-output observations. Only one exact DNS-mapped Codex child observation plus an explicitly live, paired, connection-free Node/application PID passes. A test wrapper must start observation synchronously from the production spawner's `spawn` return and make the wrapped `exit` await observer completion, proving there is no post-exit PID race. Exact artifact-key/mode/atomic-write and digest-recomputation tests prove no path, raw IP, prompt/result/stdout/stderr or sentinel is retained.
- [ ] **Step 3: Run RED.** Run `pnpm exec vitest run tests/integration/codex-cli-audit.test.ts tests/integration/codex-cli-network-privacy-contract.test.ts`; expect missing modules/scripts.
- [ ] **Step 4: Implement the static audit and prepared-Mac observer/artifact.** Add these scripts without dependencies:

```json
{
  "audit:codex-runtime": "node --import tsx scripts/audit-codex-runtime.ts",
  "eval:codex-network-privacy": "node --import tsx evals/codex-cli-network-privacy.ts"
}
```

- [ ] **Step 5: Run fake GREEN and the static real-tree audit.**

```bash
pnpm exec vitest run \
  tests/integration/codex-cli-audit.test.ts \
  tests/integration/codex-cli-network-privacy-contract.test.ts
pnpm run audit:codex-runtime
pnpm run typecheck
pnpm exec eslint scripts/audit-codex-runtime.ts \
  evals/codex-cli-network-privacy.ts \
  tests/integration/codex-cli-audit.test.ts \
  tests/integration/codex-cli-network-privacy-contract.test.ts
git diff --check
```

- [ ] **Step 6: Obtain explicit authorization for the synthetic prepared-Mac network call, then run the network/privacy gate.**

```bash
pnpm run eval:codex-network-privacy \
  --artifact data/evals/codex-cli-network-privacy.json
```

Expected: one Codex child and one explicitly live/sampled Node application process over the same spawn-to-exit interval; a non-empty DNS snapshot resolved before spawn; at least one numeric Codex TCP/443 remote mapped to the exact reviewed `chatgpt.com` endpoint; no Node/application, other-provider or telemetry connection observed in any paired sample; zero sensitive sentinel hits; no raw IP/output fields; and no temp residue. If either PID was not sampled alive, endpoint attribution is absent/ambiguous/outside the reviewed snapshot, or any Node connection appears, stop for user review; never accept an empty observation as proof and never add a destination from observed traffic.

- [ ] **Step 7: Run full regression gates.**

```bash
pnpm test
pnpm run typecheck
pnpm run lint
pnpm run build
git diff --check
```

- [ ] **Step 8: Commit.**

```bash
git add scripts/audit-codex-runtime.ts \
  evals/codex-cli-network-privacy.ts \
  evals/fixtures/codex-cli/network-allowlist.json \
  tests/integration/codex-cli-audit.test.ts \
  tests/integration/codex-cli-network-privacy-contract.test.ts package.json \
  docs/superpowers/plans/2026-08-21-codex-cli-runtime.md \
  docs/superpowers/specs/2026-08-20-codex-cli-runtime-design.md
git commit -m "test: audit Codex runtime boundaries"
```

## Completion Gate

The shared runtime is complete only when:

1. fake-process tests prove exact exec/inventory argv, allowlisted environment, validated temp root, `0700`/`0600`, bounded cancellable preflight, prompt-only stdin, strict byte/event caps, abort/timeout kill, cleanup, and one process per action;
2. the early real `codex-cli-feasibility@1` artifact proves exact CLI/login, every exact 23-feature tuple member known and false, exact `--strict-config` exec without an approval override, fresh empty validated diagnostic/exec cwd, closed env, zero forbidden project/workspace/rule/app-specific/project-skill inputs, both callable skill features false, one synthetic schema result, zero tool events, the fixed two-notice startup proof, and no residue before adapter implementation;
3. startup initialization validates/scavenges/preflights once and installs one process-local adapter with no reset/reconfigure or action-time preflight;
4. owned JSON/schema snapshot tests prove getters, symbols, custom prototypes, sparse/decorated arrays, cycles, typed arrays, and non-JSON values never cross the boundary;
5. the static audit finds no local model/model SDK/downloader/API-key/model-selector/session/retry/provider surface;
6. the prepared-Mac network/privacy artifact binds numeric `lsof -nP` observations to a bounded pre-spawn A/AAAA snapshot of exact `chatgpt.com`, samples both live Codex and Node/application PIDs over the same spawn-to-exit interval, observes only the Codex child connecting to that TCP/443 endpoint, observes no Node/application or other model/provider connection in those samples, and finds zero sensitive content, raw IP/output or temp residue;
7. full test/typecheck/lint/build and `git diff --check` pass.

This plan creates no user-facing feature. Onboarding is the first consumer and owns its extraction/review prompts, schemas, semantic evals, privacy projection, and inward port. Full Life separately owns its film prompt/schema/lineage guard. Historical replay and presentation receive neither the adapter nor a model port and therefore make zero Codex/OpenAI calls.
