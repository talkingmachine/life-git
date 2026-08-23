# Onboarding Live-Model Gate Deferral Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unblock the remaining onboarding implementation with zero Codex/OpenAI calls, make both real eval entrypoints fail closed during development, and preserve one freshly authorized final-project live-model gate.

**Architecture:** Tracked documentation owns when the external acceptance gate is allowed to run. Each eval entrypoint owns an exact descriptor-safe argv gate and exposes an injected offline seam that proves launch behavior without reaching the production runtime. Domain, prompt, schema, persistence, UI and production onboarding composition remain unchanged.

**Tech Stack:** TypeScript, Node.js, Vitest, pnpm, Markdown, Git.

**Spec:** `docs/superpowers/specs/2026-08-23-onboarding-live-model-gate-deferral-design.md`

## Global Constraints

- Make zero Codex CLI/OpenAI invocations in this plan. Do not run either eval production command, `pnpm dev`, `pnpm eval:codex-runtime-feasibility`, or `pnpm eval:codex-network-privacy`.
- Do not initialize the Node Codex runtime, run Codex preflight, inspect raw prompts/results, create or modify project diagnostic artifacts, open a browser, or perform official-source research. Offline contract tests may write sanitized temporary diagnostics only inside their disposable test directories.
- Preserve every fake/unit/contract model test. Only real external execution is deferred.
- The exact launch flag is `--final-project-live-model-gate`; it is necessary but never substitutes for fresh user authorization at project end.
- Preserve the exact V3 model tuple, prompt/wire/schema versions, fixtures, HMAC bindings, artifact layouts, 30,000/15,000 ms call limits and 35,000 ms total limit.
- Preserve `runOnboardingFeasibilityForTest(...)` and `runOnboardingJourneyTimingForTest(...)` as flag-free injected offline seams.
- Do not modify or stage `package.json`; its Task 8 timing script is an existing concurrent change.
- Do not modify production onboarding composition, model adapters, Decision code, SQLite, prompts, schemas, fixtures or UI files.
- Preserve all pre-existing dirty Task 8 files and the three protected `.superpowers/brainstorm/*` directories. Before every commit, require an exact staged-path audit.
- Use `apply_patch` for edits. Do not push, create a pull request, merge or stage ignored ledgers/reports.
- Any review finding receives its own focused safe RED, minimal fix and GREEN before refreeze. A RED must never spawn the currently unguarded legacy eval command.

---

### Task 1: Relocate the live gate in all normative documentation

**Files:**
- Modify: `docs/superpowers/plans/2026-08-21-local-conversational-onboarding.md:1166-1171,1332-1338,1720-1755`
- Modify: `docs/superpowers/plans/2026-08-23-onboarding-extraction-code-algebra.md:30-45,126-230,1030-1165,1264-1430`
- Modify: `docs/superpowers/specs/2026-08-23-onboarding-extraction-code-algebra-design.md:8-16,162-190,242-272`

**Interfaces:**
- Consumes: confirmed deferral spec at `docs/superpowers/specs/2026-08-23-onboarding-live-model-gate-deferral-design.md`.
- Produces: one consistent authority chain in which V3 implementation and Task 8 offline work can complete without real artifacts, while overall project completion still requires the unchanged final live protocol.

- [ ] **Step 1: Capture the exact stale normative clauses before editing**

Run:

```bash
rg -n \
  "may resume only after both|already authorizes diagnostic|Ready for real feasibility: yes|Execute exactly one authorized|complete only when|Onboarding is complete when" \
  docs/superpowers/plans/2026-08-21-local-conversational-onboarding.md \
  docs/superpowers/plans/2026-08-23-onboarding-extraction-code-algebra.md \
  docs/superpowers/specs/2026-08-23-onboarding-extraction-code-algebra-design.md
```

Expected: matches identify the current Task 8 blocker, earlier diagnostic authorization, immediate V3 Task 6/7 gate and conflated completion criteria. This is a read-only characterization, not a model call.

- [ ] **Step 2: Replace the parent Task 8 execution split and live Step 6**

Use `apply_patch` so the current Task 8 section contains this normative block:

```markdown
**Live-model gate deferral (2026-08-23):** The confirmed design in
`docs/superpowers/specs/2026-08-23-onboarding-live-model-gate-deferral-design.md`
supersedes only the immediate execution timing and prior authorization for the real V3 gates.
After V3 fake/static GREEN and independent Critical 0 / Important 0 review, Task 8 resumes offline
Steps 5, 7 and 8. Step 6 is not executed here: it moves to the final-project live-model gate with
unchanged V3 acceptance semantics and the mandatory `--final-project-live-model-gate` launch flag.
The missing real `@3` artifacts do not block Task 8 implementation completion.
```

Replace the old Step 6 checkbox with:

```markdown
- [ ] **Step 6: Deferred final-project live-model gate — do not execute during Task 8.** The exact
  feasibility-first/conditional-timing protocol is owned by the final-project gate. Earlier chat
  authorization is revoked; a fresh explicit authorization is required immediately before that gate.
```

Do not edit the historical Task 10 V2 body beginning near line 1555.

- [ ] **Step 3: Split the parent plan completion gate**

In parent Task 11, replace the immediate-live bullet and any `Ready for real feasibility: yes` handoff with:

```markdown
- [ ] Record the static V3 handoff without an external call:
  - External Codex/OpenAI calls made: 0
  - V3 static/review evidence: PASS
  - Real feasibility artifact: absent — deferred to final project live-model gate
  - Real timing artifact: absent — deferred to final project live-model gate
  - Ready to resume Task 8 offline Steps 5, 7 and 8: yes
  - Task 8 live Step 6: relocated to final project live-model gate
  - Project completion gate: pending
```

Add directly below Task 11's authority note:

```markdown
Task 11 authorizes the single V3 prompt candidate and offline implementation only. It does not
authorize an external call. Earlier diagnostic authorization is revoked; the final-project gate
requires fresh explicit user authorization.
```

Replace the single completion paragraph with these two headings and responsibilities:

```markdown
## Implementation Completion Gate

Onboarding implementation is complete when the approved UI/product behavior, fake/static contracts,
full offline suite, typecheck, lint, production build, diff checks and independent Critical 0 /
Important 0 review pass. Real feasibility/timing artifacts are not required for this state.

## Project Completion Gate

The project is complete only after all implementation work is finished, fresh explicit user
authorization is obtained, and exactly one `onboarding-model-feasibility@3` run passes 7/7 followed
by exactly one conditional `onboarding-journey-timing@3` run with the exact V3 tuple, two model calls,
an accepted strict handoff and `elapsedMs <= 35_000`. Both commands require
`--final-project-live-model-gate`; failure stops without retry or debugging.
```

Retain the existing UI, persistence, privacy, replay and City Criteria product acceptance clauses under the implementation heading.

- [ ] **Step 4: Amend the V3 design authority without rewriting its history**

Add a dated normative successor paragraph near the V3 design status/decision:

```markdown
**Live-gate deferral amendment (2026-08-23):**
`docs/superpowers/specs/2026-08-23-onboarding-live-model-gate-deferral-design.md`
supersedes this document only for external-call timing, authorization and completion semantics.
V3 may become implementation-complete through offline gates. The exact real feasibility and
conditional timing protocol moves to project end. Prior diagnostic-call authorization is revoked
and does not carry forward; fresh explicit user authorization is required immediately before the
final-project gate.
```

Rename the current real-gate section to `Final-project live-model gate` and add this exact future-only command block:

```markdown
This section is non-executable during V3 or Task 8 implementation. It becomes eligible only after
all approved implementation, offline verification and independent review are complete and the user
gives fresh explicit authorization. The flag is necessary but is not authorization by itself.
Run feasibility exactly once; validate 7/7 locally; only then run timing exactly once. Any failure
leaves the passing target absent and stops without retry or debugging.
```

```bash
pnpm exec tsx evals/onboarding-feasibility.ts \
  --final-project-live-model-gate \
  --artifact data/evals/onboarding-model-feasibility.json \
  --diagnostic data/evals/onboarding-model-feasibility-diagnostic.json

pnpm run eval:onboarding-journey-timing -- \
  --final-project-live-model-gate \
  --artifact data/evals/onboarding-journey-timing.json
```

Split acceptance into:

```markdown
- V3 implementation acceptance: unchanged algebra, lineage, HMAC, fake/static/full offline gates,
  build and Critical 0 / Important 0 review, with zero external calls.
- Project acceptance: the existing one-feasibility/one-conditional-timing V3 protocol after fresh
  authorization, with no retry, fallback or debugging.
```

Change the stop condition so a future live failure blocks project completion and further optimization; it does not retroactively invalidate completed V3 implementation.

Use this exact replacement:

```markdown
## Deferred final-gate stop condition

If the future flagged feasibility or timing gate fails, its passing target remains absent and project
completion stops. Completed V3 implementation remains valid. No retry, debugging, prompt variant,
fallback, timeout increase or model pin is authorized; further optimization requires a new
user-approved design.
```

- [ ] **Step 5: Amend the V3 implementation plan and its embedded templates**

Replace the V3 plan's immediate-live global constraint and every embedded Task 1 parent-plan/brief gate template with this exact authority text:

```markdown
Tasks 1–5 complete V3 implementation with zero Codex/OpenAI calls. Real feasibility and timing are
not V3 implementation or Task 8 resumption prerequisites. Their exact feasibility-first,
timing-conditional protocol is relocated to the final-project gate, requires
`--final-project-live-model-gate` on both commands, and requires fresh explicit user authorization.
Earlier diagnostic authorization is revoked.
```

Task 5's current static handoff must be exactly:

```markdown
- External Codex/OpenAI calls made: 0
- V3 static/review evidence: PASS
- Real feasibility artifact: absent — deferred to final project live-model gate
- Real timing artifact: absent — deferred to final project live-model gate
- Ready to resume Task 8 offline Steps 5, 7 and 8: yes
- Task 8 live Step 6: relocated to final project live-model gate
- Project completion gate: pending
```

Rename Task 6 to `Deferred final-project live-model gate — do not execute during V3 implementation`. Preserve its validators and one-run order, but require these future commands:

Insert this exact authority paragraph immediately below the renamed Task 6 heading, before any
stale-evidence preflight:

```markdown
This task is documentation-only until project end. Do not run its preflight, remove stale evidence
or initialize runtime work until all implementation/review work is complete and the user gives fresh
explicit authorization. The earlier diagnostic boundary is revoked and authorizes none of these
actions.
```

Replace Step 2's current announcement sentence with:

```markdown
After fresh explicit user authorization, state immediately before execution that this command invokes
the installed Codex CLI/OpenAI seven times under the final-project live-model gate. Then run exactly:
```

```bash
pnpm exec tsx evals/onboarding-feasibility.ts \
  --final-project-live-model-gate \
  --artifact data/evals/onboarding-model-feasibility.json \
  --diagnostic data/evals/onboarding-model-feasibility-diagnostic.json

pnpm run eval:onboarding-journey-timing -- \
  --final-project-live-model-gate \
  --artifact data/evals/onboarding-journey-timing.json
```

Replace Task 7's success-conditional resumption with:

```markdown
### Task 7: Record the static implementation handoff

- [ ] Append the exact zero-call Task 5 handoff to the ignored ledger.
- [ ] Audit commits, the empty index and untouched Task 8/protected paths.
- [ ] Resume Task 8 offline Steps 5, 7 and 8 without either real artifact.
- [ ] Reserve future pass/failure artifact recording for project completion; it never controls Task 8 resumption.
```

Replace the single Completion Criteria list with:

```markdown
## V3 Implementation Complete

1. Tracked runtime/onboarding authority preserves V2 history and authorizes the one V3 candidate.
2. The closed V1/V2/V3 model-version union and hostile/hybrid rejection are green.
3. The exact catalog-generated algebra, byte/digest pins and unchanged wire/Decision boundary pass.
4. Historical V1/V2 persistence/HMAC replay and V3 persistence/Frontier integration pass.
5. Focused/full fake-static tests, typecheck, lint, build, diff-check and independent Critical 0 /
   Important 0 review pass.
6. External Codex/OpenAI calls are exactly zero; real passing artifacts remain absent.
7. No retry, fallback, alternate prompt, timeout increase, model pin, sharding, replay, prefill,
   browser, research, raw-data commit, Task 8 staging, push, PR or merge occurs.

## Project Complete

V3 implementation is complete, all remaining project implementation is complete, fresh explicit
authorization is obtained, and current real-artifact criterion 8 passes through the flagged final
gate. A failed final gate stops project completion without retry or debugging.
```

- [ ] **Step 6: Verify the documentation no longer carries a current live prerequisite**

Run:

```bash
rg -n \
  "live-model gate deferral|Implementation Completion Gate|Project Completion Gate|Deferred final-project live-model gate|External Codex/OpenAI calls made: 0|--final-project-live-model-gate" \
  docs/superpowers/plans/2026-08-21-local-conversational-onboarding.md \
  docs/superpowers/plans/2026-08-23-onboarding-extraction-code-algebra.md \
  docs/superpowers/specs/2026-08-23-onboarding-extraction-code-algebra-design.md

rg -n \
  "may resume only after both reviewed V3 artifacts|The chat already authorizes diagnostic Codex CLI calls|under the already authorized diagnostic boundary|Ready for real feasibility: yes|Run one real seven-case feasibility gate" \
  docs/superpowers/plans/2026-08-21-local-conversational-onboarding.md \
  docs/superpowers/plans/2026-08-23-onboarding-extraction-code-algebra.md \
  docs/superpowers/specs/2026-08-23-onboarding-extraction-code-algebra-design.md
```

Expected: the first command finds each new authority; the second exits with no matches in current normative clauses. If a phrase remains only inside an explicitly labelled historical quotation, label it as historical rather than silently deleting history.

- [ ] **Step 7: Check scope, whitespace and the protected historical body**

Run:

```bash
git diff --check
git diff --stat -- \
  docs/superpowers/plans/2026-08-21-local-conversational-onboarding.md \
  docs/superpowers/plans/2026-08-23-onboarding-extraction-code-algebra.md \
  docs/superpowers/specs/2026-08-23-onboarding-extraction-code-algebra-design.md
git status --short
```

Expected: only the three owned docs are part of this task's diff; all Task 8/protected paths remain present and unstaged.

- [ ] **Step 8: Commit only the normative documentation**

```bash
git add -- \
  docs/superpowers/plans/2026-08-21-local-conversational-onboarding.md \
  docs/superpowers/plans/2026-08-23-onboarding-extraction-code-algebra.md \
  docs/superpowers/specs/2026-08-23-onboarding-extraction-code-algebra-design.md
git diff --cached --name-only
git diff --cached --check
git commit -m "docs: relocate onboarding live model gate"
```

Expected staged paths: exactly the three files above.

- [ ] **Step 9: Request read-only documentation review**

Reviewer must confirm Critical 0 / Important 0 for authority consistency, revoked prior authorization, historical V2 preservation, Task 8 Step 6 relocation and implementation/project completion split before Task 2 begins.

---

### Task 2: Guard both eval entrypoints under safe offline TDD

**Files:**
- Modify: `evals/onboarding-feasibility.ts:1-60,736-784`
- Modify: `evals/onboarding-journey-timing.ts:34-43,145-157,216-240,903-936`
- Test: `tests/integration/onboarding-feasibility-contract.test.ts:1-30,489-510`
- Test: `tests/integration/onboarding-journey-timing-contract.test.ts:20-35,793-878`

**Interfaces:**
- Consumes: exact flag and argv grammar from the confirmed deferral spec; existing alias-safe path validators/removers; unchanged flag-free fake artifact runners.
- Produces:

```ts
export type OnboardingFeasibilityLaunchMode =
  | "deferred"
  | "final-project-live-model-gate";

export interface OnboardingFeasibilityLaunchArguments {
  readonly mode: OnboardingFeasibilityLaunchMode;
  readonly artifactPath: string;
  readonly diagnosticPath: string;
}

export type OnboardingFeasibilityEntrypointResult =
  | Readonly<{ exitCode: 0; stdout: ""; stderr: "" }>
  | Readonly<{
      exitCode: 1;
      stdout: "";
      stderr:
        | "onboarding_live_model_gate_deferred\n"
        | "onboarding_model_feasibility_failed\n";
    }>;

export function parseOnboardingFeasibilityArguments(
  args: unknown,
): OnboardingFeasibilityLaunchArguments;

export async function runOnboardingFeasibilityEntrypointForTest(input: {
  readonly rawArguments: unknown;
  readonly runFinalProjectLiveModelGate: (paths: Readonly<{
    artifactPath: string;
    diagnosticPath: string;
  }>) => Promise<void>;
}): Promise<OnboardingFeasibilityEntrypointResult>;

export type OnboardingJourneyTimingLaunchMode =
  | "deferred"
  | "final-project-live-model-gate";

export interface OnboardingJourneyTimingLaunchArguments {
  readonly mode: OnboardingJourneyTimingLaunchMode;
  readonly artifactPath: string;
}

export type OnboardingJourneyTimingEntrypointResult =
  | Readonly<{ exitCode: 0; stdout: ""; stderr: "" }>
  | Readonly<{
      exitCode: 1;
      stdout: "";
      stderr:
        | "onboarding_live_model_gate_deferred\n"
        | "onboarding_journey_timing_failed\n";
    }>;

export function parseOnboardingJourneyTimingArguments(
  args: unknown,
): OnboardingJourneyTimingLaunchArguments;

export async function runOnboardingJourneyTimingEntrypointForTest(input: {
  readonly rawArguments: unknown;
  readonly runFinalProjectLiveModelGate: (
    canonicalArtifactPath: string,
  ) => Promise<void>;
}): Promise<OnboardingJourneyTimingEntrypointResult>;
```

`runOnboardingFeasibilityForTest(...)` and `runOnboardingJourneyTimingForTest(...)` retain their existing signatures and do not accept the launch flag.

- [ ] **Step 1: Add the feasibility launch-gate RED contracts**

Import `runOnboardingFeasibilityEntrypointForTest` and replace the obsolete artifact-only parser test with a new `describe("onboarding feasibility live-model launch gate", ...)` that includes this exact core case:

```ts
test("defers legacy feasibility argv before any live callback, removes A, and preserves D", async () => {
  const directory = await temporaryDirectory();
  const artifactPath = join(directory, "artifact.json");
  const diagnosticPath = join(directory, "diagnostic.json");
  await writeFile(artifactPath, "stale passing artifact\n", "utf8");
  await writeFile(diagnosticPath, "historical diagnostic\n", "utf8");
  const runFinalProjectLiveModelGate = vi.fn();

  const result = await runOnboardingFeasibilityEntrypointForTest({
    rawArguments: ["--artifact", artifactPath, "--diagnostic", diagnosticPath],
    runFinalProjectLiveModelGate,
  });

  expect(result).toEqual({
    exitCode: 1,
    stdout: "",
    stderr: "onboarding_live_model_gate_deferred\n",
  });
  expect(runFinalProjectLiveModelGate).not.toHaveBeenCalled();
  await expect(access(artifactPath)).rejects.toMatchObject({ code: "ENOENT" });
  expect(await readFile(diagnosticPath, "utf8")).toBe("historical diagnostic\n");
});
```

Add an enabled fake-callback case using:

```ts
[
  "--final-project-live-model-gate",
  "--artifact",
  artifactPath,
  "--diagnostic",
  diagnosticPath,
]
```

Require one callback with resolved absolute paths, `{exitCode:0,stdout:"",stderr:""}`, and no real runtime object. Add a callback failure containing a private sentinel and require only `onboarding_model_feasibility_failed\n` with no sentinel.

Add a table rejecting empty argv; artifact-only; missing diagnostic value; duplicate/misspelled/decorated flag; `--retry`; separator; flag-after-artifact; reordered diagnostic/artifact. Prewrite A and D and require malformed rows to preserve both and call the callback zero times.

Add hostile argv cases: Proxy with throwing `getPrototypeOf`, `ownKeys` and `getOwnPropertyDescriptor` traps; indexed getter; symbol property; sparse array; decorated array prototype. Require zero trap/getter calls and the deferred result.

Add a recognized-path failure matrix that distinguishes modes:

- exact legacy argv with `A === D`, fixture alias, invalid extension, or an `artifact.json` directory that makes stale removal fail → deferred result, zero callback, no diagnostic rewrite and no destructive mutation;
- exact enabled argv with the same validation/removal failures → `onboarding_model_feasibility_failed\n`, zero callback, no caught sentinel and no destructive mutation.

Add one safe subprocess RED using only a decorated invalid flag such as `--final-project-live-model-gate=true --artifact A --diagnostic D`. It fails in the current parser before runtime registration. Expect exit `1`, stdout `""` and stderr exactly `onboarding_live_model_gate_deferred\n`; current code emits the old fixed feasibility failure. Do not spawn the canonical legacy shape before the guard exists.

- [ ] **Step 2: Add the timing launch-gate RED contracts**

Import `runOnboardingJourneyTimingEntrypointForTest`. Replace the current parser expectations with frozen `{mode, artifactPath}` expectations for both legacy and enabled direct/package shapes, and put the new cases under `describe("onboarding journey timing live-model launch gate", ...)` so the safe RED filter selects both eval suites. Keep the package-script, no-research and import-without-production-filesystem tests unchanged. Include:

```ts
test.each([
  ["direct", ["--artifact", "artifact.json"]],
  ["package", ["--", "--artifact", "artifact.json"]],
])("defers %s legacy timing argv after stale cleanup", async (_name, rawArguments) => {
  const artifactPath = join(await temporaryDirectory(), "artifact.json");
  await writeFile(artifactPath, "stale passing artifact\n", "utf8");
  const runFinalProjectLiveModelGate = vi.fn();
  const args = rawArguments.map((value) => value === "artifact.json" ? artifactPath : value);

  const result = await runOnboardingJourneyTimingEntrypointForTest({
    rawArguments: args,
    runFinalProjectLiveModelGate,
  });

  expect(result).toEqual({
    exitCode: 1,
    stdout: "",
    stderr: "onboarding_live_model_gate_deferred\n",
  });
  expect(runFinalProjectLiveModelGate).not.toHaveBeenCalled();
  await expect(access(artifactPath)).rejects.toMatchObject({ code: "ENOENT" });
});
```

Add direct/package enabled cases with the flag immediately before `--artifact`; require one fake callback with the resolved path and exact success result. Add malformed argv rows for duplicate/missing/misspelled/decorated/reordered flag, extra retry/artifact and repeated/misplaced separator; malformed rows preserve any prewritten untrusted target.

Add direct/package enabled callback-rejection cases. The fake callback must reject with a private
sentinel after observing the resolved path. Require exactly one callback, an absent artifact, no
private sentinel in the serialized result, and exactly:

```ts
{
  exitCode: 1,
  stdout: "",
  stderr: "onboarding_journey_timing_failed\n",
}
```

Add timing-specific hostile argv cases: a Proxy with throwing `getPrototypeOf`, `ownKeys` and
`getOwnPropertyDescriptor` traps; an enumerable indexed getter; an own symbol; a sparse array; and an
array whose prototype is not `Array.prototype`. Require zero trap/getter calls, a deferred result and
zero callback calls for every case.

Add a recognized-path failure matrix for both direct and package forms:

- exact legacy argv with fixture alias, invalid extension, or an `artifact.json` directory that makes stale removal fail → deferred result, zero callback and unchanged untrusted target;
- exact enabled argv with the same failures → `onboarding_journey_timing_failed\n`, zero callback, no caught sentinel and unchanged untrusted target.

For process-output RED, spawn only an invalid decorated flag such as `--final-project-live-model-gate=true --artifact artifact.json`. The current parser rejects it before runtime registration, so this is safe. Expect exit `1`, stdout `""`, stderr `onboarding_live_model_gate_deferred\n`; current code returns the old fixed timing failure. Do not spawn either canonical legacy command before GREEN.

- [ ] **Step 3: Run the safe RED**

```bash
pnpm exec vitest run \
  tests/integration/onboarding-feasibility-contract.test.ts \
  tests/integration/onboarding-journey-timing-contract.test.ts \
  --exclude '**/node_modules/**' \
  -t 'live-model launch gate'
```

Expected: failures are limited to missing entrypoint seams, old parser return shapes, rejection of the new flag and old generic stderr. No test invokes a canonical legacy production command, so the RED makes zero external calls.

- [ ] **Step 4: Implement one descriptor-safe argv copier in each eval file**

Add `import { types } from "node:util"` to feasibility; timing already imports it. Use this exact local pattern in both files, with module-specific `failed()` errors:

```ts
function readOwnedStringArguments(value: unknown, maximumLength: number): readonly string[] {
  if (
    types.isProxy(value) ||
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    Object.getOwnPropertySymbols(value).length !== 0 ||
    value.length > maximumLength
  ) throw failed();

  const descriptors = Object.getOwnPropertyDescriptors(value);
  const allowed = new Set([
    ...Array.from({ length: value.length }, (_, index) => String(index)),
    "length",
  ]);
  if (Object.keys(descriptors).some((key) => !allowed.has(key))) throw failed();

  const copy: string[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (
      descriptor === undefined ||
      !("value" in descriptor) ||
      descriptor.enumerable !== true ||
      typeof descriptor.value !== "string"
    ) throw failed();
    copy.push(descriptor.value);
  }
  return Object.freeze(copy);
}
```

Do not reuse `snapshotOwnedJson` for argv: it does not reject a Proxy before reflective operations. Add `types.isProxy(value)` before any reflective operation in timing's existing generic `denseArray` as adjacent hostile-input hardening; its existing tests must remain green.

- [ ] **Step 5: Implement the exact feasibility parser and result seam**

Implement only these branches:

```ts
const FINAL_PROJECT_LIVE_MODEL_GATE_FLAG = "--final-project-live-model-gate";
const LIVE_MODEL_GATE_DEFERRED = "onboarding_live_model_gate_deferred\n";

export function parseOnboardingFeasibilityArguments(
  input: unknown,
): OnboardingFeasibilityLaunchArguments {
  const args = readOwnedStringArguments(input, 5);
  if (args.length === 4 && args[0] === "--artifact" && args[2] === "--diagnostic") {
    return Object.freeze({
      mode: "deferred",
      artifactPath: args[1]!,
      diagnosticPath: args[3]!,
    });
  }
  if (
    args.length === 5 &&
    args[0] === FINAL_PROJECT_LIVE_MODEL_GATE_FLAG &&
    args[1] === "--artifact" &&
    args[3] === "--diagnostic"
  ) return Object.freeze({
    mode: "final-project-live-model-gate",
    artifactPath: args[2]!,
    diagnosticPath: args[4]!,
  });
  throw failed();
}
```

`runOnboardingFeasibilityEntrypointForTest` catches parser failure and returns a frozen deferred result without touching paths. For parsed legacy args, call `requireOutputPaths(A,D)`, remove only canonical `A` through `removeStaleOnboardingFeasibilityArtifact`, preserve `D`, and return deferred even when validation/removal fails. For enabled args, validate both paths, remove `A` and `D`, invoke the injected callback once, return success, and map any validation/callback failure to the frozen existing feasibility-failure result.

Extract the current fixture-read/runtime/model/diagnostic body into private:

```ts
async function runFinalProjectLiveModelGate(paths: Readonly<{
  artifactPath: string;
  diagnosticPath: string;
}>): Promise<void>;
```

It must be the only function in this module that calls `registerNodeCodexRuntime()` or constructs the real model. `main()` passes this callback to the entrypoint seam and writes only its returned stdout/stderr/exit code. Keep a last-resort content-free catch mapped to `onboarding_model_feasibility_failed\n`.

- [ ] **Step 6: Implement the exact timing parser and result seam**

After removing at most one leading package separator, recognize only:

```ts
["--artifact", A]
["--final-project-live-model-gate", "--artifact", A]
```

Return frozen `{mode, artifactPath}`. All malformed shapes map to the frozen deferred result before path handling.

`runOnboardingJourneyTimingEntrypointForTest` validates recognized `A` through `requireArtifactPath` and removes stale `A` through `removeStaleOnboardingJourneyTimingArtifact`. Legacy mode returns deferred with zero callback calls even when validation/removal fails. Enabled mode invokes its callback once only after successful validation/removal and maps validation, removal or callback failure to `onboarding_journey_timing_failed\n`.

Move fixture reading, `registerNodeCodexRuntime()`, `prepareProductionJourney`, timer use and the existing flag-free artifact runner inside the private production callback. `main()` writes only the result fields and retains a last-resort content-free timing failure.

- [ ] **Step 7: Run focused GREEN and unchanged artifact contracts**

```bash
pnpm exec vitest run \
  tests/integration/onboarding-feasibility-contract.test.ts \
  tests/integration/onboarding-journey-timing-contract.test.ts \
  --exclude '**/node_modules/**'
```

Expected: both complete files pass. Existing `@3` artifact, version, digest, alias, privacy, exact canonical journey and no-retry tests remain green.

- [ ] **Step 8: Add and mutation-prove canonical legacy subprocess characterizations**

Now that Step 7 proves the guard, add subprocess tests for feasibility's exact legacy `--artifact A --diagnostic D` shape and timing's exact direct/package legacy shapes. Use only disposable paths. Assert exit `1`, stdout empty, stderr exactly `onboarding_live_model_gate_deferred\n`, stale `A` absent, feasibility `D` byte-exact, and no passing artifact.

Prove these tests can fail without ever disabling the guard: temporarily change only the module-local deferred result's stderr literal to the old module-specific generic failure, run the new subprocess tests and require RED, then immediately restore `onboarding_live_model_gate_deferred\n` with `apply_patch` and require GREEN. Never mutate the mode check, callback dispatch or final flag, and never spawn a final-flag command.

- [ ] **Step 9: Run task-level static gates and audit the live-call boundary**

```bash
pnpm run typecheck
pnpm exec eslint \
  evals/onboarding-feasibility.ts \
  evals/onboarding-journey-timing.ts \
  tests/integration/onboarding-feasibility-contract.test.ts \
  tests/integration/onboarding-journey-timing-contract.test.ts
git diff --check
rg -n "registerNodeCodexRuntime|getCodexCliModelAdapter|--final-project-live-model-gate" \
  evals/onboarding-feasibility.ts evals/onboarding-journey-timing.ts
```

Expected: typecheck/lint/diff pass; each real runtime path is reachable only from its enabled injected callback; both parsers contain the exact flag; pure artifact runners remain flag-free.

- [ ] **Step 10: Commit the atomic two-entrypoint guard**

```bash
git add -- \
  evals/onboarding-feasibility.ts \
  evals/onboarding-journey-timing.ts \
  tests/integration/onboarding-feasibility-contract.test.ts \
  tests/integration/onboarding-journey-timing-contract.test.ts
git diff --cached --name-only
git diff --cached --check
git commit -m "feat: guard deferred onboarding live gates"
```

Expected staged paths: exactly these four files. Do not stage `package.json`, Task 8 UI files, fixtures, artifacts, reports or protected directories.

- [ ] **Step 11: Request independent frozen-diff review**

Reviewer must verify Critical 0 / Important 0 for descriptor safety, exact raw shapes, stale A cleanup, diagnostic D preservation, exact process output, zero callback on deferred/malformed paths, enabled fake dispatch, pure artifact-runner compatibility and absence of any unflagged route to runtime registration.

---

### Task 3: Prove the offline implementation state and hand back to Task 8

**Files:**
- Update (ignored, never stage): `.superpowers/sdd/2026-08-23-onboarding-extraction-code-algebra/progress.md`
- Verify only: all tracked files and current dirty Task 8 paths.

**Interfaces:**
- Consumes: reviewed documentation commit and reviewed paired-entrypoint guard commit.
- Produces: factual zero-call handoff that unblocks Task 8 offline Steps 5, 7 and 8 while leaving project completion pending.

- [ ] **Step 1: Verify both real passing artifacts are absent**

Run separately:

```bash
test ! -e data/evals/onboarding-model-feasibility.json
test ! -e data/evals/onboarding-journey-timing.json
```

Expected: both commands exit `0`. Do not inspect or modify retained diagnostics.

- [ ] **Step 2: Run the complete focused offline gate**

```bash
pnpm exec vitest run \
  tests/integration/onboarding-feasibility-contract.test.ts \
  tests/integration/onboarding-journey-timing-contract.test.ts \
  --exclude '**/node_modules/**'
```

Expected: all tests pass using injected fakes and guarded subprocess cases; zero Codex/OpenAI calls.

- [ ] **Step 3: Run all project-wide offline verification**

Run each command and record its exit code/test count:

```bash
pnpm test
pnpm run typecheck
pnpm run lint
pnpm run build
pnpm audit:codex-runtime
git diff --check
```

Do not substitute `pnpm dev`, an eval command or a manual route request for any check.

- [ ] **Step 4: Obtain final read-only review of the complete amendment**

Review the range `29980c5^..HEAD` through the current guard commit against the confirmed deferral spec. Require:

```markdown
- Critical: 0
- Important: 0
- External Codex/OpenAI calls: 0
- Verdict: APPROVE
```

If review reports a Critical/Important issue, add one safe focused RED that cannot reach real runtime, apply the smallest fix, rerun focused GREEN plus typecheck/scoped lint/diff-check, commit only the authorized fix paths, and request re-review.

- [ ] **Step 5: Append the factual ignored handoff**

Use `apply_patch` to append exactly:

```markdown
## Live-model gate deferral implementation handoff

- External Codex/OpenAI calls made: 0
- V3 static/review evidence: PASS
- Real feasibility artifact: absent — deferred to final project live-model gate
- Real timing artifact: absent — deferred to final project live-model gate
- Ready to resume Task 8 offline Steps 5, 7 and 8: yes
- Task 8 live Step 6: relocated to final project live-model gate
- Project completion gate: pending
- Retry/fallback/debug/browser/research: none
```

Do not force-add or commit the ignored ledger.

- [ ] **Step 6: Audit commits, index and concurrent workspace ownership**

```bash
git log --oneline 29980c5..HEAD
git diff --cached --name-only
git status --short
```

Expected: the documentation and paired-guard commits are present; index is empty; all pre-existing Task 8/protected paths remain unstaged; no passing live artifact, push, PR or merge exists.

- [ ] **Step 7: Resume only the approved offline Task 8 path**

Return control to Task 8 Steps 5, 7 and 8. Do not execute its relocated live Step 6. At true project end, stop and request fresh explicit user authorization before even preflight or stale-evidence mutation for the final live gate.

---

## Final-Project Gate Reference — Not Executable in This Plan

The following protocol is retained for project end and must not be run during Tasks 1–3:

1. Obtain fresh explicit user authorization.
2. Remove stale passing evidence through reviewed alias-safe seams.
3. Run exactly one flagged real feasibility command and validate `onboarding-model-feasibility@3` 7/7.
4. Only on success, run exactly one flagged real timing command and validate two calls, accepted handoff and `elapsedMs <= 35_000`.
5. On any failure, stop without retry, debugging, fallback, prompt variant, timeout increase, model pin, browser or research.

The exact future commands are documented in Task 1 and the confirmed spec. Their presence in this plan is not execution authorization.
