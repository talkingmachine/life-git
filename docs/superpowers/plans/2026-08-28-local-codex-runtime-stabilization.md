# Local Codex Runtime Stabilization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver Stage A of the approved local-beta design: a stable ChatGPT-subscription Codex CLI runtime that performs guarded onboarding extraction and returns untrusted official-source candidates through live web search, with bounded concurrency, abort ownership, and a reproducible local live gate.

**Architecture:** Keep Codex behind capability-specific ports and treat every model result as untrusted JSON. A versioned runtime policy owns the exact Terra model, low/medium effort, tool isolation and compatible CLI family; a keyed adaptive flight pool owns process concurrency and abort. Onboarding and source discovery validate locally, while the live eval proves the installed subscription path without writing application state.

**Tech Stack:** TypeScript 6, Node.js child processes, Vitest 4, Zod-free closed-object validators already used by the runtime, `codex exec` JSONL/JSON Schema output, Git.

**Spec:** `docs/superpowers/specs/2026-08-28-local-codex-llm-source-recovery-design.md`

## Global Constraints

- This plan implements Delivery Sequence **A. Stable local runtime** only. Source excerpt extraction, durable SourceBinding recovery, the 10×5 demo catalog, full end-to-end flow and owner walkthrough each require a later focused plan.
- Use only Git and GitHub for repository work. Never use Arc, Arcanum, Tracker, or any Yandex infrastructure.
- Do not touch `.superpowers/brainstorm`, the unrelated Task19 worktree, or user-owned untracked files in the repository root.
- Runtime model allowlist is exactly `gpt-5.6-terra`; allowed reasoning is exactly `low | medium`. No environment or caller override may select another model or higher effort.
- `onboarding.extract`, `onboarding.review`, and all extraction attempts allow zero tool events. `source.discover` allows only reviewed native `web_search` events.
- Codex remains an untrusted candidate generator. It cannot create facts, Evidence, Knowledge, Frontier, a verdict, an active binding, a manifest, or any durable application row.
- Child processes use `shell: false`, a fresh app-owned empty `0700` working directory, a `0600` schema file, a closed environment, bounded stdin/stdout/stderr/events/time, and no repository/database path.
- Integrity/security/ownership failures never retry. Onboarding/source schema ambiguity gets at most one `low -> medium` retry; discovery is `medium` and later recovery will own the two-round limit.
- Identical requests are keyed single-flight. Distinct requests run under an adaptive maximum of five children, shrinking `5 -> 3 -> 1` on rate/transient pressure and recovering only after cooldown.
- Aborting one waiter detaches it; all waiters gone abort the leader process group. A finished or aborted flight cannot publish late output.
- Historical onboarding V1/V2/V3 tuples remain byte-for-byte reconstructible. New current calls use V4 and invocation/protocol `@2`; hybrid or unknown tuples fail closed.
- Unit/integration tests use fake process/search boundaries. Real subscription/search checks are explicit local opt-in and are not part of ordinary CI.
- The future `dev-llm` provider switch and external API provider remain backlog-only and must not be implemented in this plan.
- Follow strict TDD for every behavior change: name the break, observe the focused RED failure, implement the minimum GREEN change, and rerun the focused test before a broader gate.

## File and interface map

| File | Responsibility |
| --- | --- |
| `src/infrastructure/codex-cli/contracts.ts` | Closed invocation/result/error contracts and fixed model/protocol vocabulary. |
| `src/infrastructure/codex-cli/policy.ts` | Compatible CLI family, exact tool-policy feature tuple, fixed argv builder and policy fingerprint. |
| `src/infrastructure/codex-cli/preflight.ts` | Canonical executable, ChatGPT login and observed capability checks. |
| `src/infrastructure/codex-cli/event-stream.ts` | Capability-aware JSONL state machine; zero-tool vs web-search proof. |
| `src/infrastructure/codex-cli/process.ts` | Bounded process-group lifecycle. |
| `src/infrastructure/codex-cli/flight-pool.ts` | Keyed single-flight, five-slot adaptive scheduling and waiter ownership. |
| `src/infrastructure/codex-cli/feasibility-probe.ts` | One isolated CLI invocation using the fixed policy and event proof. |
| `src/infrastructure/codex-cli/model-adapter.ts` | JSON parse/freeze, flight-key ownership and complete invocation metadata. |
| `src/infrastructure/codex-cli/runtime.ts` | One-time static preflight plus injected adapter/pool composition. |
| `src/application/onboarding-model-versions.ts` | Immutable historical V1–V3 and current V4 semantic lineage. |
| `src/infrastructure/codex-cli/onboarding-model.ts` | Low-first onboarding calls, one medium schema retry, strict output binding. |
| `src/application/onboarding.ts` | Deterministic manual-questionnaire fallback when the model is unavailable. |
| `src/application/official-source-discovery.ts` | Public-data-only discovery port and frozen request/result DTOs. |
| `src/infrastructure/codex-cli/official-source-discovery.ts` | Medium/search prompt, schema and strict untrusted-candidate decoder. |
| `evals/local-codex-stage-a.ts` | Explicit live subscription/search/concurrency/abort gate and sanitized artifact. |

---

### Task 1: Migrate the current runtime and onboarding lineage to protocol `@2`

**Files:**
- Modify: `src/infrastructure/codex-cli/contracts.ts`
- Modify: `src/infrastructure/codex-cli/policy.ts`
- Modify: `src/infrastructure/codex-cli/preflight.ts`
- Modify: `src/application/onboarding-model-versions.ts`
- Modify: `src/application/onboarding-contracts.ts`
- Modify: `src/infrastructure/codex-cli/model-adapter.ts`
- Modify: `src/infrastructure/codex-cli/onboarding-model.ts`
- Modify: `evals/codex-cli-feasibility.ts`
- Modify: `evals/codex-cli-network-privacy.ts`
- Test: `tests/infrastructure/codex-cli-contract.test.ts`
- Test: `tests/infrastructure/codex-cli-policy.test.ts`
- Test: `tests/infrastructure/codex-cli-temp-directory.test.ts`
- Test: `tests/infrastructure/onboarding-extraction-wire.test.ts`
- Test: `tests/integration/codex-cli-runtime.test.ts`
- Test: `tests/integration/codex-cli-feasibility-contract.test.ts`
- Test: `tests/integration/codex-cli-network-privacy-contract.test.ts`
- Test: `tests/integration/codex-onboarding-model.test.ts`
- Test: `tests/integration/onboarding-store.test.ts`
- Test: `tests/integration/place-frontier.test.ts`

**Interfaces:**
- Consumes: existing descriptor-safe `createCodexJsonInvocation`, `snapshotOwnedJson`, onboarding V1–V3 reconstruction and SQLite canonical-version storage.
- Produces: `CODEX_CLI_PROTOCOL_VERSION`, `CODEX_INVOCATION_VERSION`, `CODEX_MODEL`, `CodexReasoningEffort`, `CodexToolPolicyId`, `parseSupportedCodexCliVersion`, `OnboardingModelVersionsV4`, and current frozen `ONBOARDING_MODEL_VERSIONS_V4`.

- [ ] **Step 1: Write failing closed-contract and history tests**

Add literal tests that require the new invocation matrix and prove the historical tuples still reconstruct by identity:

```ts
const invocation = createCodexJsonInvocation({
  capability: "source.discover",
  reasoningEffort: "medium",
  toolPolicy: "codex-tools-web-search@1",
  templateVersion: "official-source-discover@1",
  schemaVersion: "official-source-candidates@1",
  prompt: "synthetic public input",
  outputSchema: { type: "object", additionalProperties: false, properties: {} },
  limits: { timeoutMs: 30_000, maxStdoutBytes: 131_072, maxStderrBytes: 16_384, maxEvents: 128 },
  signal: new AbortController().signal,
});
expect(invocation).toMatchObject({
  capability: "source.discover",
  reasoningEffort: "medium",
  toolPolicy: "codex-tools-web-search@1",
});
expect(() => createCodexJsonInvocation({
  ...invocation,
  capability: "onboarding.extract",
} as never)).toThrowError("codex_protocol_invalid");
expect(reconstructOnboardingModelVersions({ ...ONBOARDING_MODEL_VERSIONS_V1 }))
  .toBe(ONBOARDING_MODEL_VERSIONS_V1);
expect(reconstructOnboardingModelVersions({ ...ONBOARDING_MODEL_VERSIONS_V4 }))
  .toBe(ONBOARDING_MODEL_VERSIONS_V4);
expect(() => reconstructOnboardingModelVersions({
  ...ONBOARDING_MODEL_VERSIONS_V4,
  invocation: ONBOARDING_MODEL_VERSIONS_V3.invocation,
})).toThrow(TypeError);
```

The break caught is accepting a search policy for extraction, or losing exact historical replay while introducing V4.

- [ ] **Step 2: Run the focused tests and observe RED**

Run:

```bash
pnpm exec vitest run tests/infrastructure/codex-cli-contract.test.ts tests/infrastructure/codex-cli-policy.test.ts tests/infrastructure/onboarding-extraction-wire.test.ts tests/integration/onboarding-store.test.ts tests/integration/place-frontier.test.ts
```

Expected: FAIL because protocol/model/tool-policy fields and V4 do not exist.

- [ ] **Step 3: Implement the fixed vocabulary and capability matrix**

Use these exact current constants and types:

```ts
export const CODEX_CLI_PROTOCOL_VERSION = "codex-cli-protocol@2" as const;
export const CODEX_INVOCATION_VERSION = "codex-cli-invocation@2" as const;
export const CODEX_CLI_COMPATIBILITY_POLICY = "codex-cli-0.149.0-alpha.4-plus@1" as const;
export const CODEX_MODEL = "gpt-5.6-terra" as const;

export type CodexReasoningEffort = "low" | "medium";
export type CodexToolPolicyId = "codex-tools-none@2" | "codex-tools-web-search@1";
export type CodexCapabilityId =
  | "onboarding.extract"
  | "onboarding.review"
  | "source.extract"
  | "source.discover"
  | "full-life.film";
```

`CodexJsonInvocation` gains `reasoningEffort` and `toolPolicy`. Enforce this exact matrix in construction:

```ts
const valid =
  capability === "source.discover"
    ? reasoningEffort === "medium" && toolPolicy === "codex-tools-web-search@1"
    : (reasoningEffort === "low" || reasoningEffort === "medium") &&
      toolPolicy === "codex-tools-none@2";
```

`CodexInvocationMetadata` has exactly these enumerable fields:

```ts
readonly invocationVersion: "codex-cli-invocation@2";
readonly protocolVersion: "codex-cli-protocol@2";
readonly compatibilityPolicy: "codex-cli-0.149.0-alpha.4-plus@1";
readonly cliVersion: string;
readonly model: "gpt-5.6-terra";
readonly reasoningEffort: CodexReasoningEffort;
readonly toolPolicy: CodexToolPolicyId;
readonly templateVersion: string;
readonly schemaVersion: string;
```

Add runtime error codes `codex_rate_limited` and `codex_provider_transient`; do not classify ordinary schema errors as either. Update every existing invocation producer to the dotted capability ID and an exact valid effort/tool-policy pair. Update existing result fixtures to the nine metadata fields; use the preflight's observed `cliVersion`, never the removed fixed patch value, when the model adapter builds metadata.

Create `policy.ts` with `parseSupportedCodexCliVersion(stdout)`. It accepts only one LF-terminated line matching `codex-cli 0.149.0-alpha.N` with integer `N >= 4`, returns the line without LF, and otherwise throws `CodexRuntimeError("codex_version_mismatch")`. Widen `CodexPreflightResult.cliVersion` to the returned supported string, but leave Task 2 to route the real version subprocess through this parser.

- [ ] **Step 4: Add V4 without changing the six-key persistence shape**

Define the current tuple exactly as:

```ts
export interface OnboardingModelVersionsV4 {
  readonly invocation: "codex-cli-invocation@2";
  readonly cliVersion: "codex-cli-0.149.0-alpha.4-plus@1";
  readonly extractionPrompt: "onboarding-extract@4";
  readonly reviewPrompt: "onboarding-review@2";
  readonly extractionSchema: "onboarding-extraction-wire@2";
  readonly reviewSchema: "onboarding-review-output@1";
}
```

Keep `VERSION_KEYS` unchanged. Add V4 as the fourth exact matcher. Do not rewrite literal V1/V2/V3 values or their canonical JSON/digests. Switch the production onboarding model to V4 and update its metadata binding to the nine-field runtime metadata above: compare `metadata.compatibilityPolicy` to V4's historically named `cliVersion` field, and independently parse `metadata.cliVersion` through the supported-family parser.

- [ ] **Step 5: Update only current-version fixtures and prove persistence**

Add a V4 store round-trip and V1/V2/V3 replay cases. Preserve every existing historical digest fixture. Where an eval or test means “current production model,” use V4; where it proves historical reconstruction, keep its named V1/V2/V3 literal.

- [ ] **Step 6: Run focused GREEN and typecheck**

Run:

```bash
pnpm exec vitest run tests/infrastructure/codex-cli-contract.test.ts tests/infrastructure/codex-cli-policy.test.ts tests/infrastructure/codex-cli-temp-directory.test.ts tests/infrastructure/onboarding-extraction-wire.test.ts tests/integration/codex-cli-runtime.test.ts tests/integration/codex-cli-feasibility-contract.test.ts tests/integration/codex-cli-network-privacy-contract.test.ts tests/integration/codex-onboarding-model.test.ts tests/integration/onboarding-store.test.ts tests/integration/place-frontier.test.ts
pnpm typecheck
```

Expected: PASS; historical V1–V3 remain accepted, V4 is current, hybrid tuples reject.

- [ ] **Step 7: Commit the lineage milestone**

```bash
git add src/infrastructure/codex-cli/contracts.ts src/infrastructure/codex-cli/policy.ts src/infrastructure/codex-cli/preflight.ts src/application/onboarding-model-versions.ts src/application/onboarding-contracts.ts src/infrastructure/codex-cli/model-adapter.ts src/infrastructure/codex-cli/onboarding-model.ts evals/codex-cli-feasibility.ts evals/codex-cli-network-privacy.ts tests/infrastructure/codex-cli-contract.test.ts tests/infrastructure/codex-cli-policy.test.ts tests/infrastructure/codex-cli-temp-directory.test.ts tests/infrastructure/onboarding-extraction-wire.test.ts tests/integration/codex-cli-runtime.test.ts tests/integration/codex-cli-feasibility-contract.test.ts tests/integration/codex-cli-network-privacy-contract.test.ts tests/integration/codex-onboarding-model.test.ts tests/integration/onboarding-store.test.ts tests/integration/place-frontier.test.ts
git commit -m "feat: version local Codex runtime protocol"
```

---

### Task 2: Replace the stale patch pin with a fail-closed policy and fixed argv

**Files:**
- Create: `src/infrastructure/codex-cli/policy.ts`
- Modify: `src/infrastructure/codex-cli/preflight.ts`
- Modify: `src/infrastructure/codex-cli/feasibility-probe.ts`
- Test: `tests/infrastructure/codex-cli-policy.test.ts`
- Test: `tests/infrastructure/codex-cli-preflight.test.ts`
- Test: `tests/integration/codex-cli-feasibility-contract.test.ts`
- Test: `tests/integration/codex-cli-network-privacy-contract.test.ts`

**Interfaces:**
- Consumes: Task 1 `CodexJsonInvocation`, `parseSupportedCodexCliVersion`, fixed model/effort/tool policy, existing executable canonicalization and disabled-feature inventory parsing.
- Produces: `CODEX_DISABLED_FEATURES`, `buildCodexExecArgs`, `codexPolicyFingerprint`, and real preflight use of the observed supported version.

- [ ] **Step 1: Write failing behavior tests for compatibility and argv**

Use literal cases:

```ts
expect(parseSupportedCodexCliVersion("codex-cli 0.149.0-alpha.4\n"))
  .toBe("codex-cli 0.149.0-alpha.4");
expect(parseSupportedCodexCliVersion("codex-cli 0.149.0-alpha.27\n"))
  .toBe("codex-cli 0.149.0-alpha.27");
for (const value of [
  "codex-cli 0.148.0-alpha.99\n",
  "codex-cli 0.149.0-alpha.3\n",
  "codex-cli 0.150.0-alpha.1\n",
  "codex-cli 0.149.0-alpha.4 extra\n",
]) expect(() => parseSupportedCodexCliVersion(value)).toThrowError("codex_version_mismatch");
```

For extraction, assert exact argv contains one `exec`, `--model gpt-5.6-terra`, `-c model_reasoning_effort=\"low\"`, no `--search`, and every retained `--disable <feature>`. For discovery assert `--search` occurs before `exec`, effort is `medium`, and no approval-bypass option appears. Assert no prompt or user data occurs in argv.

- [ ] **Step 2: Run policy/preflight tests and observe RED**

```bash
pnpm exec vitest run tests/infrastructure/codex-cli-policy.test.ts tests/infrastructure/codex-cli-preflight.test.ts
```

Expected: FAIL because preflight still compares one exact old build and the policy module does not yet build fixed argv/feature proofs.

- [ ] **Step 3: Implement the reviewed policy module**

Move the existing exact retained disabled-feature tuple into `policy.ts` without adding or removing members. Parse only `0.149.0-alpha.N` where `N >= 4`; a future minor/major remains blocked until review.

Build argv in this exact order:

```ts
return Object.freeze([
  ...(invocation.toolPolicy === "codex-tools-web-search@1" ? ["--search"] : []),
  "exec",
  "--strict-config",
  "--ephemeral",
  "--ignore-user-config",
  "--ignore-rules",
  "--model", "gpt-5.6-terra",
  "-c", `model_reasoning_effort=${JSON.stringify(invocation.reasoningEffort)}`,
  ...CODEX_DISABLED_FEATURES.flatMap((feature) => ["--disable", feature]),
  "--sandbox", "read-only",
  "--skip-git-repo-check",
  "--cd", directoryPath,
  "--output-schema", schemaPath,
  "--json",
  "-",
]);
```

Do not add `--ask-for-approval`, `--approve-for-me`, a profile, `--add-dir`, or any dangerous bypass. Compute `codexPolicyFingerprint` from canonical JSON containing protocol/model/effort/tool-policy/disabled features/argv grammar, never from prompt or auth state.

- [ ] **Step 4: Make preflight return the observed supported version**

Keep canonical executable and exact ChatGPT login checks. Allow only the known path-alias warning around version/login output. Feature inventory must prove every retained member is known and `false`; missing, true, duplicate or malformed inventory fails `codex_tool_isolation_unproven`.

- [ ] **Step 5: Route probe construction through `buildCodexExecArgs`**

Delete the duplicated fixed `CODEX_EXEC_ARGS`. Pass the fresh directory and schema path into the builder. The prompt remains stdin only, and `cwd` remains the fresh directory.

- [ ] **Step 6: Run focused and compatibility suites**

```bash
pnpm exec vitest run tests/infrastructure/codex-cli-policy.test.ts tests/infrastructure/codex-cli-preflight.test.ts tests/integration/codex-cli-feasibility-contract.test.ts tests/integration/codex-cli-network-privacy-contract.test.ts
pnpm typecheck
```

Expected: PASS; old 0.148 and unknown future families fail before a model process is spawned.

- [ ] **Step 7: Commit the compatibility milestone**

```bash
git add src/infrastructure/codex-cli/policy.ts src/infrastructure/codex-cli/preflight.ts src/infrastructure/codex-cli/feasibility-probe.ts tests/infrastructure/codex-cli-policy.test.ts tests/infrastructure/codex-cli-preflight.test.ts tests/integration/codex-cli-feasibility-contract.test.ts tests/integration/codex-cli-network-privacy-contract.test.ts
git commit -m "feat: gate Codex CLI by capability policy"
```

---

### Task 3: Decode zero-tool and web-search JSONL protocols separately

**Files:**
- Modify: `src/infrastructure/codex-cli/event-stream.ts`
- Modify: `src/infrastructure/codex-cli/feasibility-probe.ts`
- Test: `tests/infrastructure/codex-cli-event-stream.test.ts`
- Create: `tests/fixtures/codex-cli/protocol-v2-no-tools.jsonl`
- Create: `tests/fixtures/codex-cli/protocol-v2-web-search.jsonl`

**Interfaces:**
- Consumes: Task 2 tool policies and bounded invocation limits.
- Produces: `parseCodexEventStreamWithProof(chunks, limits, toolPolicy)` returning final message, ordered event types, reviewed web-search count and a policy proof.

- [ ] **Step 1: Add failing no-tool and discovery state-machine tests**

The no-tool fixture contains these exact synthetic contract lines:

```jsonl
{"type":"thread.started","thread_id":"thread-1"}
{"type":"turn.started"}
{"type":"item.started","item":{"type":"reasoning","id":"reasoning-1"}}
{"type":"item.completed","item":{"type":"reasoning","id":"reasoning-1"}}
{"type":"item.completed","item":{"type":"agent_message","text":"{\"schemaVersion\":\"fixture@1\"}"}}
{"type":"turn.completed"}
```

The discovery fixture adds this exact matched pair after reasoning and before the agent message:

```jsonl
{"type":"item.started","item":{"type":"web_search","id":"search-1","query":"official municipal source"}}
{"type":"item.completed","item":{"type":"web_search","id":"search-1","query":"official municipal source"}}
```

These fixture shapes are the production allowlist only after the Task 8 live observation confirms them. If the installed CLI emits a different bounded web-search shape, update this fixture, parser and policy fingerprint together in the same reviewed fix; never widen the decoder to an unknown item. Test these breaks:

```ts
await expect(parse(fixture("protocol-v2-web-search.jsonl"), "codex-tools-none@2"))
  .rejects.toMatchObject({ code: "codex_tool_event" });
await expect(parse(fixture("protocol-v2-web-search.jsonl"), "codex-tools-web-search@1"))
  .resolves.toMatchObject({ webSearchCount: 1, toolPolicyProven: true });
```

Add literal malformed cases: completion without start, duplicate ID, result after agent message, shell/MCP/browser/app/plugin/skill/image/file-change item, unknown item type, unknown event type, trailing partial JSON, oversized stream and event overflow. Every one must reject before returning a final message.

- [ ] **Step 2: Run the parser test and observe RED**

```bash
pnpm exec vitest run tests/infrastructure/codex-cli-event-stream.test.ts
```

Expected: discovery fixture fails with `codex_tool_event`, and the new proof fields are absent.

- [ ] **Step 3: Implement two explicit policy branches**

Keep one structural thread/turn/message state machine. Under `codex-tools-none@2`, any tool item fails. Under `codex-tools-web-search@1`, accept only the exact reviewed `web_search` item keys represented by the fixture, require a bounded non-empty ID and matched lifecycle, and retain no query/snippet text in the returned proof. Any other tool or unknown structure fails closed.

Return exactly:

```ts
type CodexEventStreamProof = Readonly<{
  finalMessage: string;
  eventTypes: readonly string[];
  webSearchCount: number;
  toolPolicyProven: true;
}>;
```

Do not keep old startup-notice SHA pins as a compatibility substitute. If the current CLI emits a reviewed non-tool error notice before the turn, represent it as an exact policy revision fixture and validate it structurally; unknown notices remain protocol failures.

- [ ] **Step 4: Pass invocation policy into the live probe**

`runCodexJsonProbe` passes `input.invocation.toolPolicy` to the decoder and returns only counts/types, not query or snippet content.

- [ ] **Step 5: Run focused GREEN and adjacent runtime tests**

```bash
pnpm exec vitest run tests/infrastructure/codex-cli-event-stream.test.ts tests/integration/codex-cli-runtime.test.ts tests/integration/codex-cli-audit.test.ts
```

Expected: PASS with zero accepted tool events for extraction and only matched web-search lifecycle for discovery.

- [ ] **Step 6: Commit the protocol decoder**

```bash
git add src/infrastructure/codex-cli/event-stream.ts src/infrastructure/codex-cli/feasibility-probe.ts tests/infrastructure/codex-cli-event-stream.test.ts tests/fixtures/codex-cli/protocol-v2-no-tools.jsonl tests/fixtures/codex-cli/protocol-v2-web-search.jsonl
git commit -m "feat: verify Codex web search event protocol"
```

---

### Task 4: Own process groups and add the adaptive keyed flight pool

**Files:**
- Modify: `src/infrastructure/codex-cli/process.ts`
- Create: `src/infrastructure/codex-cli/flight-pool.ts`
- Test: `tests/infrastructure/codex-cli-process.test.ts`
- Create: `tests/infrastructure/codex-cli-flight-pool.test.ts`

**Interfaces:**
- Consumes: bounded process request/error types and native AbortSignal semantics.
- Produces: process-group termination and `CodexFlightPool.run<T>({ key, signal, operation })` with frozen terminal handoff.

- [ ] **Step 1: Write failing process-group ownership tests**

Change the process fake contract from child-only `kill` to group ownership:

```ts
interface SpawnedCodexProcess {
  readonly pid: number;
  readonly stdout: AsyncIterable<Uint8Array>;
  readonly stderr: AsyncIterable<Uint8Array>;
  readonly exit: Promise<{ readonly code: number | null; readonly signal: string | null }>;
  terminateGroup(signal: "SIGTERM" | "SIGKILL"): void;
}
```

Assert timeout/abort/overflow sends one SIGTERM, waits 250 ms, then sends SIGKILL only when the group has not exited. Assert a late successful exit cannot replace the original abort/error.

- [ ] **Step 2: Write failing single-flight and adaptive-pool tests**

Cover observable behavior with deferred real promises:

```ts
const first = pool.run({ key: "same", signal: a.signal, operation });
const second = pool.run({ key: "same", signal: b.signal, operation });
expect(operation).toHaveBeenCalledOnce();
a.abort(new DOMException("detached", "AbortError"));
await expect(first).rejects.toMatchObject({ name: "AbortError" });
const terminal = Object.freeze({ value: "ok" });
leader.resolve(terminal);
await expect(second).resolves.toBe(terminal);
```

Also prove: all waiters gone aborts the leader; six distinct keys never exceed five active operations; one `rate_limited` pressure changes the next ceiling 5→3, another changes 3→1; recovery occurs one step per injected cooldown; keys are removed only after terminal handoff; two capabilities with different canonical keys never share results.

- [ ] **Step 3: Run both focused test files and observe RED**

```bash
pnpm exec vitest run tests/infrastructure/codex-cli-process.test.ts tests/infrastructure/codex-cli-flight-pool.test.ts
```

Expected: missing group method/pool and failing child-only late ownership behavior.

- [ ] **Step 4: Implement Unix process-group ownership**

For this local macOS runtime spawn with `detached: true`, `shell: false`, and the same pipe stdio. After a positive PID is observed, `terminateGroup` uses the native process kill API against `-pid`; never build a shell command. Keep a fake-spawner seam so tests do not signal real processes.

- [ ] **Step 5: Implement the pool with injected time**

Use this exact constructor input:

```ts
type CodexPressure = "none" | "rate_limited" | "provider_transient" | "timeout";

type CodexFlightPoolOptions = Readonly<{
  maximumConcurrency: 5;
  cooldownMs: number;
  now: () => number;
  classifyPressure: (error: unknown) => Exclude<CodexPressure, "none"> | undefined;
}>;
```

Production composition passes `cooldownMs: 60_000`. Tests inject time and do not sleep.

`run<T>` takes `operation: (leaderSignal: AbortSignal) => Promise<T>`. It resolves every active waiter with the same operation result reference, or rejects them with the same terminal error; `classifyPressure` changes the ceiling only for rejected rate/transient/timeout operations. Results produced by the model adapter are already recursively frozen, so the generic pool must not mutate or clone them. Do not cache completed results or expose registry mutation/test-only cleanup methods in production.

- [ ] **Step 6: Run focused GREEN and runtime integration**

```bash
pnpm exec vitest run tests/infrastructure/codex-cli-process.test.ts tests/infrastructure/codex-cli-flight-pool.test.ts tests/integration/codex-cli-runtime.test.ts
pnpm typecheck
```

Expected: PASS; no child-only kill path remains.

- [ ] **Step 7: Commit the ownership milestone**

```bash
git add src/infrastructure/codex-cli/process.ts src/infrastructure/codex-cli/flight-pool.ts tests/infrastructure/codex-cli-process.test.ts tests/infrastructure/codex-cli-flight-pool.test.ts
git commit -m "feat: bound concurrent Codex process groups"
```

---

### Task 5: Route adapter calls through one canonical flight and complete runtime preflight

**Files:**
- Modify: `src/infrastructure/codex-cli/model-adapter.ts`
- Modify: `src/infrastructure/codex-cli/runtime.ts`
- Modify: `src/infrastructure/codex-cli/feasibility-probe.ts`
- Modify: `src/instrumentation-node.ts`
- Test: `tests/integration/codex-cli-runtime.test.ts`
- Test: `tests/integration/codex-cli-feasibility-contract.test.ts`
- Test: `tests/integration/codex-cli-network-privacy-contract.test.ts`

**Interfaces:**
- Consumes: Tasks 1–4 invocation metadata, policy fingerprint, probe and `CodexFlightPool`.
- Produces: adapter flight-key derivation, immutable complete metadata, one-time static runtime initialization and callable synthetic capability verification.

- [ ] **Step 1: Write failing adapter-key and metadata tests**

Assert two equivalent invocations with different AbortSignal objects spawn once and receive the same frozen result; changing capability, effort, prompt, schema, template, limits or tool policy creates a distinct flight. Assert the returned metadata exactly equals:

```ts
{
  invocationVersion: "codex-cli-invocation@2",
  protocolVersion: "codex-cli-protocol@2",
  compatibilityPolicy: "codex-cli-0.149.0-alpha.4-plus@1",
  cliVersion: "codex-cli 0.149.0-alpha.4",
  model: "gpt-5.6-terra",
  reasoningEffort: "low",
  toolPolicy: "codex-tools-none@2",
  templateVersion: "onboarding-extract@4",
  schemaVersion: "onboarding-extraction-wire@2",
}
```

The expected key must be independently hand-built canonical JSON + SHA-256 in the test, not by calling the production key helper.

- [ ] **Step 2: Write failing runtime initialization tests**

Prove initialization order is: temp-root integrity/scavenge → executable/version/login → disabled inventory. On any failure, no adapter is installed. Repeated concurrent initialization shares one attempt. Static initialization does not inherit repository variables or write a database.

- [ ] **Step 3: Run focused tests and observe RED**

```bash
pnpm exec vitest run tests/integration/codex-cli-runtime.test.ts tests/integration/codex-cli-feasibility-contract.test.ts tests/integration/codex-cli-network-privacy-contract.test.ts
```

Expected: missing pool keying/new metadata and old exact-version assumptions fail.

- [ ] **Step 4: Implement canonical flight ownership in the adapter**

Derive a SHA-256 key over exact canonical JSON containing capability, model, effort, tool policy, template/schema versions, prompt hash, output-schema hash, limits and policy fingerprint. Never include raw prompt, schema path, temp directory, PID, signal or auth values. Supply the pool with a classifier that maps only explicit rate/transient/timeout runtime errors to adaptive pressure; every other rejection leaves the current ceiling unchanged.

- [ ] **Step 5: Keep startup preflight static and expose explicit synthetic verification**

`initializeCodexCliRuntime` performs filesystem/executable/login/feature checks and installs the adapter/pool. Add `verifyCodexCliCapabilities` for the explicit live gate; it runs exact-schema no-tool probes at low and medium plus one medium discovery probe. This avoids making every Next.js instrumentation startup consume subscription calls while still making the live gate mandatory before Stage A acceptance.

Synthetic output is closed and non-sensitive:

```ts
{ schemaVersion: "codex-runtime-smoke@2", status: "ok" }
```

The discovery prompt asks for the current official OpenAI developer documentation home only; its result is used to prove web-search events, not accepted as project Evidence.

- [ ] **Step 6: Run focused GREEN, typecheck and lint**

```bash
pnpm exec vitest run tests/integration/codex-cli-runtime.test.ts tests/integration/codex-cli-feasibility-contract.test.ts tests/integration/codex-cli-network-privacy-contract.test.ts
pnpm typecheck
pnpm lint
```

Expected: PASS; no live network is used by tests.

- [ ] **Step 7: Commit the adapter/runtime milestone**

```bash
git add src/infrastructure/codex-cli/model-adapter.ts src/infrastructure/codex-cli/runtime.ts src/infrastructure/codex-cli/feasibility-probe.ts src/instrumentation-node.ts tests/integration/codex-cli-runtime.test.ts tests/integration/codex-cli-feasibility-contract.test.ts tests/integration/codex-cli-network-privacy-contract.test.ts
git commit -m "feat: stabilize local Codex adapter flights"
```

---

### Task 6: Add one extraction retry and deterministic onboarding fallback

**Files:**
- Modify: `src/infrastructure/codex-cli/onboarding-model.ts`
- Modify: `src/application/onboarding.ts`
- Modify: `evals/onboarding-feasibility.ts`
- Modify: `evals/onboarding-journey-timing.ts`
- Test: `tests/integration/codex-onboarding-model.test.ts`
- Test: `tests/integration/onboarding.test.ts`
- Test: `tests/integration/onboarding-feasibility-contract.test.ts`
- Test: `tests/integration/onboarding-journey-timing-contract.test.ts`

**Interfaces:**
- Consumes: V4 lineage and Task 5 adapter calls.
- Produces: low-first/medium-on-schema-ambiguity onboarding extraction, single-attempt low review, and manual deterministic fallback for unavailable model calls.

- [ ] **Step 1: Write failing retry tests**

Use a fake adapter whose first extraction result is invalid and second is valid. Assert extraction calls are exactly `[low, medium]`, both zero-tool, and a valid low result makes only one call. Assert review is one low/zero-tool call with no medium retry. A runtime auth/rate/timeout error must not trigger the extraction schema retry.

```ts
expect(invokeJson.mock.calls.map(([call]) => [call.reasoningEffort, call.toolPolicy]))
  .toEqual([
    ["low", "codex-tools-none@2"],
    ["medium", "codex-tools-none@2"],
  ]);
```

- [ ] **Step 2: Write failing application fallback tests**

For `extractMessage`, a non-abort `OnboardingModelError` must append the user message plus one fixed assistant question, change no questionnaire value, and allocate IDs exactly once. For `completeOnboarding`, model failure must still return deterministic issues when present, or commit when the deterministic questionnaire is complete. A caller abort must still abort and never fall back/commit.

Use exact fallback question `Заполните выделенные поля.`.

- [ ] **Step 3: Run onboarding tests and observe RED**

```bash
pnpm exec vitest run tests/integration/codex-onboarding-model.test.ts tests/integration/onboarding.test.ts
```

Expected: retry is absent and model failures reject instead of taking the deterministic path.

- [ ] **Step 4: Implement retry inside the capability adapter**

Build the extraction prompt/schema once. Try low; retry exactly once at medium only when JSON/schema/wire decoding is invalid or ambiguous. Runtime missing/auth/rate/provider/timeout/process failures map directly to `OnboardingModelError` and do not retry. Both extraction attempts share the caller deadline/signal and are separate canonical keys because effort differs. Review remains one low/zero-tool call and falls back at the application boundary if unavailable or invalid.

- [ ] **Step 5: Implement fallback at the application boundary**

On non-abort model failure, extraction uses:

```ts
const extraction: GuardedExtraction = Object.freeze({
  proposals: Object.freeze([]),
  nextQuestion: "Заполните выделенные поля.",
});
```

Completion treats failed model corroboration as an empty issue list and still relies on `reviewQuestionnaire`/`confirmOnboardingValues`; it never suppresses deterministic issues. Invalid commands, integrity failures and aborts do not enter fallback.

- [ ] **Step 6: Move current onboarding eval contracts to V4**

Update current artifact schemas to include invocation/protocol/model/effort/tool-policy metadata. Keep historical V1–V3 fixture cases intact. The ordinary contract tests remain fake-runtime tests; do not run a real model here.

- [ ] **Step 7: Run focused GREEN and onboarding suites**

```bash
pnpm exec vitest run tests/integration/codex-onboarding-model.test.ts tests/integration/onboarding.test.ts tests/integration/onboarding-feasibility-contract.test.ts tests/integration/onboarding-journey-timing-contract.test.ts tests/integration/onboarding-store.test.ts
pnpm typecheck
```

Expected: PASS; no failure path invents a questionnaire value.

- [ ] **Step 8: Commit the onboarding vertical**

```bash
git add src/infrastructure/codex-cli/onboarding-model.ts src/application/onboarding.ts evals/onboarding-feasibility.ts evals/onboarding-journey-timing.ts tests/integration/codex-onboarding-model.test.ts tests/integration/onboarding.test.ts tests/integration/onboarding-feasibility-contract.test.ts tests/integration/onboarding-journey-timing-contract.test.ts tests/integration/onboarding-store.test.ts
git commit -m "feat: make local onboarding model resilient"
```

---

### Task 7: Add the public-data-only official source discovery capability

**Files:**
- Create: `src/application/official-source-discovery.ts`
- Create: `src/infrastructure/codex-cli/official-source-discovery.ts`
- Create: `tests/application/official-source-discovery.test.ts`
- Create: `tests/integration/codex-official-source-discovery.test.ts`

**Interfaces:**
- Consumes: Task 5 `CodexCliModelAdapter.invokeJson` with `source.discover`, medium effort and web-search policy.
- Produces: `OfficialSourceDiscoveryPort.discover(request)` returning at most five frozen untrusted candidates plus runtime metadata; no fetch, gate, evidence or persistence side effect.

- [ ] **Step 1: Write failing closed request/result tests**

Define and test this exact port shape:

```ts
export interface OfficialSourceDiscoveryPort {
  discover(input: OfficialSourceDiscoveryRequest): Promise<OfficialSourceDiscoveryResult>;
}

export type OfficialSourceDiscoveryRequest = Readonly<{
  schemaVersion: "official-source-discovery-request@1";
  entity: Readonly<{
    entityId: string;
    kind: "country" | "city";
    countryCode: string;
    displayName: string;
  }>;
  fact: Readonly<{
    factKey: string;
    definitionId: string;
    description: string;
  }>;
  failedSource: Readonly<{
    url: string;
    reason: "unavailable" | "stale" | "empty" | "semantic_drift" | "not_covering_fact";
  }>;
  authorityRoots: readonly Readonly<{ publisherName: string; url: string }>[];
  localeHints: readonly string[];
  round: 1 | 2;
  signal: AbortSignal;
}>;
```

Reject proxies/accessors/extra keys without invocation; require canonical HTTPS URLs without credentials/fragments; bound strings and arrays; copy/freeze owned data. The output candidate is exactly `{url,claimedPublisher,expectedCoverage,rationale}` and has no `official`, `verified`, fact value, color or score field.

- [ ] **Step 2: Write failing adapter policy tests**

Assert one call uses:

```ts
{
  capability: "source.discover",
  reasoningEffort: "medium",
  toolPolicy: "codex-tools-web-search@1",
  templateVersion: "official-source-discover@1",
  schemaVersion: "official-source-candidates@1",
}
```

Assert prompt JSON contains only the reconstructed public request minus `signal`, treats all fields as untrusted data, and does not contain questionnaire/profile/database values. Invalid JSON, more than five candidates, duplicate canonical URLs, HTTP/private-credential URLs, extra fields or metadata mismatch fail with a typed discovery error and return no partial list.

- [ ] **Step 3: Run both focused tests and observe RED**

```bash
pnpm exec vitest run tests/application/official-source-discovery.test.ts tests/integration/codex-official-source-discovery.test.ts
```

Expected: modules do not exist.

- [ ] **Step 4: Implement descriptor-safe request reconstruction**

Use the same native-brand/accessor/proxy defenses as onboarding/runtime contracts. Limits: at most 8 authority roots, 8 locale hints, 256 UTF-8 bytes per identifier/name, 1,024 for description/coverage/rationale, and exactly five unique candidate URLs maximum. Return recursively frozen owned data.

- [ ] **Step 5: Implement the medium/search adapter**

Use one strict JSON Schema with `additionalProperties: false` at every object level. Prompt states that candidates are planning hints only, must be first-party authority/operator pages, and must not report a fact or verdict. Decode metadata against invocation/protocol/model/effort/tool policy and canonicalize candidates locally. Do not call HTTP, SourceGate, SQLite or any evidence code.

- [ ] **Step 6: Run focused GREEN and privacy regression tests**

```bash
pnpm exec vitest run tests/application/official-source-discovery.test.ts tests/integration/codex-official-source-discovery.test.ts tests/integration/codex-cli-network-privacy-contract.test.ts
pnpm typecheck
pnpm lint
```

Expected: PASS; discovery remains an untrusted URL-only capability.

- [ ] **Step 7: Commit the discovery vertical**

```bash
git add src/application/official-source-discovery.ts src/infrastructure/codex-cli/official-source-discovery.ts tests/application/official-source-discovery.test.ts tests/integration/codex-official-source-discovery.test.ts
git commit -m "feat: discover official source candidates locally"
```

---

### Task 8: Build and run the explicit Stage A live gate

**Files:**
- Create: `evals/local-codex-stage-a.ts`
- Create: `evals/fixtures/local-codex-stage-a/onboarding.json`
- Create: `evals/fixtures/local-codex-stage-a/discovery.json`
- Modify: `package.json`
- Modify: `docs/README.md`
- Test: `tests/integration/local-codex-stage-a-contract.test.ts`

**Interfaces:**
- Consumes: initialized runtime, explicit capability verification, resilient onboarding model, official-source discovery adapter and adaptive pool diagnostics.
- Produces: `pnpm eval:local-codex-stage-a -- --live-local-subscription --artifact data/evals/local-codex-stage-a/result.json` and a sanitized `local-codex-stage-a@1` artifact.

- [ ] **Step 1: Write the failing command/artifact contract test**

Require no-flag invocation to exit 1 with exactly `local_codex_live_opt_in_required\n` and spawn no process. With fake runtime dependencies, require exact artifact keys:

```ts
{
  schemaVersion: "local-codex-stage-a@1",
  cliVersion: "codex-cli 0.149.0-alpha.4",
  protocolVersion: "codex-cli-protocol@2",
  compatibilityPolicy: "codex-cli-0.149.0-alpha.4-plus@1",
  model: "gpt-5.6-terra",
  effortsProven: ["low", "medium"],
  noToolProbe: { passed: true, webSearchCount: 0 },
  discoveryProbe: { passed: true, webSearchCount: 1 },
  onboarding: { guardedProposalCount: 4, inventedValueCount: 0 },
  discovery: { candidateCount: 1, allCandidatesUntrusted: true },
  concurrency: {
    requested: [1, 2, 5],
    completed: [1, 2, 5],
    crossJobLeakage: false,
  },
  abort: { processGroupTerminated: true, lateResultAccepted: false },
}
```

The literal artifact above is the fake fixture: it uses observed version `0.149.0-alpha.4`, one search pair and one candidate. The live artifact uses the actual `parseSupportedCodexCliVersion` result, accepts `webSearchCount` from 1 through the invocation event limit, and accepts `candidateCount` from 1 through 5. Latency/rate counters may be additional bounded numeric fields defined by the test, but raw prompts, questionnaire text, search query/snippets, auth paths/tokens, full model output and source excerpts are forbidden.

- [ ] **Step 2: Run the contract test and observe RED**

```bash
pnpm exec vitest run tests/integration/local-codex-stage-a-contract.test.ts
```

Expected: eval entrypoint and package script do not exist.

- [ ] **Step 3: Implement the deterministic fake-runtime entrypoint**

Export argument parsing and `runLocalCodexStageA` so tests inject runtime/model/discovery/clock/write dependencies. The live main path uses the installed ChatGPT Codex executable through production preflight. Write the artifact atomically through a same-directory temporary file and rename; never write an application DB.

The onboarding fixture contains one explicit Russian sentence whose four expected guarded fields and source spans are literal in the fixture. The discovery fixture asks for one official municipal/public-operator source candidate and contains no personal data. Concurrency probes use five distinct public synthetic job IDs `stage-a:1` through `stage-a:5`; each schema requires the model to echo its own job ID, so the eval can detect cross-job leakage while producing distinct flight keys. The separate fake-runtime test continues to prove identical keys single-flight.

- [ ] **Step 4: Add the explicit package command and docs**

Add exactly:

```json
"eval:local-codex-stage-a": "node --import tsx evals/local-codex-stage-a.ts"
```

Document prerequisites (`codex login status` shows ChatGPT, bundled executable is available), the exact command, artifact path, the Terra/medium ceiling, and that candidates are not Evidence. Do not document or implement `dev-llm` as active behavior.

- [ ] **Step 5: Run contract GREEN and the full offline gate**

```bash
pnpm exec vitest run tests/integration/local-codex-stage-a-contract.test.ts
pnpm typecheck
pnpm lint
pnpm test
```

Expected: all offline checks pass with no real model/network call.

- [ ] **Step 6: Run the real sanitized live gate**

Run:

```bash
pnpm eval:local-codex-stage-a -- --live-local-subscription --artifact data/evals/local-codex-stage-a/result.json
```

Expected: exit 0; low/medium structured probes, guarded onboarding extraction, one official-source discovery search, concurrency 1/2/5 and abort/no-late-result pass. If provider HTTP or the local Codex state DB fails, capture only the typed stage/error code in the ignored SDD report, diagnose the exact owned path read-only, and fix code/config only when the remedy is non-destructive. Do not delete, rewrite, migrate or copy auth/state storage.

- [ ] **Step 7: Repeat the live gate twice for stability**

Run the same command two more times. Require all three runs to exit 0, no cross-job leakage, no residual app-owned temp directories, and no unhandled 429/timeout. Record concurrency throughput/p95 and the effective adaptive ceiling in the sanitized artifact/report; do not claim five is best unless measurements support it.

- [ ] **Step 8: Commit Stage A implementation and docs**

```bash
git add evals/local-codex-stage-a.ts evals/fixtures/local-codex-stage-a/onboarding.json evals/fixtures/local-codex-stage-a/discovery.json package.json docs/README.md tests/integration/local-codex-stage-a-contract.test.ts
git commit -m "feat: prove local Codex Stage A runtime"
```

---

## Final Stage A verification

After all task reviews are clean, run:

```bash
pnpm typecheck
pnpm lint
pnpm test
git status --short --branch
git log --oneline --decorate -10
```

Then dispatch one whole-branch reviewer against the merge-base diff. A second specialist review is required only for the process-group/single-flight/privacy boundary. Critical findings block Stage A; Important findings that affect current correctness enter the fix loop; non-load-bearing hardening items go to the next-plan backlog.

Stage A is complete only when the offline suite is green and three real live runs prove subscription auth, fixed Terra low/medium, zero-tool extraction, reviewed web search, questionnaire guarding, untrusted discovery candidates, 1/2/5 measurements, process-group abort and no late result. Do not start durable SourceBinding recovery or the 10×5 catalog before this gate.
