# Onboarding live-model gate deferral

**Status:** approved in chat on 2026-08-23; implementation is not authorized until this written
specification is reviewed and an implementation plan is approved.

## Decision

All real Codex CLI/OpenAI onboarding checks and debugging are deferred until the end of the project.
Current implementation work proceeds only through deterministic offline verification. One explicit
final-project live-model gate remains required before the project may be declared complete.

This is a scheduling and launch-authorization change, not a removal of the onboarding model
contract. The project keeps fake/unit/contract tests that exercise model ports without spawning
Codex or sending data to OpenAI. It removes real model execution from the current Task 8/V3
completion path and makes accidental eval launch fail closed.

## Meaning of “project end”

The final-project live-model gate may be considered only after all currently approved implementation
work is complete, including:

1. Task 8 UI, neutral-globe and timing scaffold implementation;
2. all remaining parent-plan implementation and documentation stages;
3. the complete offline test suite, typecheck, lint and production build;
4. independent review with Critical 0 / Important 0;
5. a clean handoff in which only final acceptance and branch finishing remain.

Reaching the end does not itself authorize an external call. Immediately before the gate, the user
must again explicitly authorize transmission to Codex/OpenAI. Without that authorization the project
remains implementation-complete but not project-complete.

## External-call boundary

The following are live-model operations and must not run during the deferral:

- `evals/onboarding-feasibility.ts` through its production entrypoint;
- `evals/onboarding-journey-timing.ts` through its production entrypoint;
- `pnpm eval:codex-runtime-feasibility`;
- `pnpm eval:codex-network-privacy`;
- `pnpm dev` or another deployed-server startup that runs Node Codex instrumentation, even without a
  later request;
- any real `/api/onboarding/message` or `/api/onboarding/continue` request;
- any manual Codex prompt, prompt variant, replay, smoke invocation or raw diagnostic run intended to
  debug onboarding model behavior.

Ordinary production runtime code is not disabled or changed by this amendment. During development,
the team must not exercise that real backend manually. UI and route behavior are verified through
the existing fake ports and in-process transport tests.

The following remain offline and are required:

- Vitest suites, including onboarding feasibility/timing contract suites with injected fakes;
- Codex adapter and process tests with fake `invokeJson` functions or fake process spawners;
- `pnpm run typecheck`, lint, production build and `git diff --check`;
- `pnpm audit:codex-runtime`, which is a static dependency/filesystem audit.

No offline test may execute the real Node Codex process spawner. A side-effect-free type or symbol
import is not itself an external call, but a test that invokes the spawner is a live-model test and is
deferred rather than silently skipped inside the same test process.

## Fail-closed eval launch contract

Both production eval entrypoints gain one exact mandatory flag:

```text
--final-project-live-model-gate
```

The flag is necessary but not sufficient authorization. Its only purpose is to make an accidental
development invocation unable to initialize the Codex runtime. The final user authorization remains
a separate human gate.

The entrypoint contract is:

1. descriptor-safely reconstruct one closed raw-argv shape from the table below;
2. validate canonical artifact paths through the existing lexical/realpath/inode protections;
3. when the exact final-gate flag is absent, remove the requested stale passing artifact through the
   reviewed alias-safe removal seam, return one fixed content-free failure
   `onboarding_live_model_gate_deferred`, and stop;
4. perform zero runtime registration, Codex preflight, subprocess creation, timer callback, model
   callback, browser, research or network work on that stopped path;
5. reject a duplicated, decorated or misspelled flag and all unknown/reordered argument shapes;
6. only the exact final-gate command may continue into the existing preflight and eval behavior.

The raw `process.argv.slice(2)` grammar is exact:

| Entrypoint | Deferred legacy shape | Enabled final shape |
|---|---|---|
| feasibility | `['--artifact', A, '--diagnostic', D]` | `['--final-project-live-model-gate', '--artifact', A, '--diagnostic', D]` |
| timing, direct | `['--artifact', A]` | `['--final-project-live-model-gate', '--artifact', A]` |
| timing, package separator | `['--', '--artifact', A]` | `['--', '--final-project-live-model-gate', '--artifact', A]` |

`A` and `D` remain subject to the existing canonical path-resolution, pairwise-distinct,
lexical/realpath/inode and fixture-alias rules. No other optional argument, separator placement,
artifact-only feasibility form or ordering is accepted. The deferred legacy forms exist only so an
old documented command stops safely and clears its named stale passing artifact; they never
initialize the runtime. Both entrypoints clear `A`. Feasibility validates but does not delete or
rewrite historical diagnostic `D`. An invalid shape that does not yield a trusted path performs no
deletion.

Every absent/invalid-gate stop exits with code `1`, writes nothing to stdout, writes exactly
`onboarding_live_model_gate_deferred\n` to stderr, creates no diagnostic, and exposes no caught error
content. After the exact final flag is accepted, ordinary path/runtime/eval failures retain their
existing fixed content-free failure messages and artifact-cleanup behavior.

The pure injected functions used by contract tests do not require the flag and must remain unable to
reach the real runtime by construction. Production adapters, Decision logic, schemas, prompt
versions, model-version tuples, HMAC bindings and artifact formats remain unchanged.

The future final commands are therefore:

```bash
pnpm exec tsx evals/onboarding-feasibility.ts \
  --final-project-live-model-gate \
  --artifact data/evals/onboarding-model-feasibility.json \
  --diagnostic data/evals/onboarding-model-feasibility-diagnostic.json

pnpm run eval:onboarding-journey-timing -- \
  --final-project-live-model-gate \
  --artifact data/evals/onboarding-journey-timing.json
```

These commands are documentation only until the final gate. They must not be executed while this
deferral is active.

## Current completion semantics

Task 8 and the V3 prompt-algebra slice may be declared **implementation-complete** when their
tracked code, fake/static contracts, full offline suite, typecheck, lint, build, diff checks and
independent review pass. The absence of the two real `@3` artifacts does not block:

- Task 8 offline Steps 5, 7 and 8; the old live Step 6 is not executed and is relocated to the
  final-project live-model gate with unchanged V3 acceptance semantics and the new explicit launch
  flag;
- Task 8 implementation completion;
- later parent-plan implementation, documentation or baseline stages;
- ordinary commits that contain no live-model evidence.

The overall project may be declared **project-complete** only after the deferred final gate succeeds
or a later user-approved design explicitly removes that requirement.

The V3 execution handoff becomes:

```markdown
- External Codex/OpenAI calls made: 0
- V3 static/review evidence: PASS
- Real feasibility artifact: absent — deferred to final project live-model gate
- Real timing artifact: absent — deferred to final project live-model gate
- Ready to resume Task 8 offline Steps 5, 7 and 8: yes
- Task 8 live Step 6: relocated to final project live-model gate
- Project completion gate: pending
```

The retained ignored raw timing diagnostic, any existing sanitized V2/V3 diagnostic, rejected launch
facts and ignored progress-ledger entries remain factual history throughout the deferral. A deferred
entrypoint neither deletes nor rewrites them, and none is reinterpreted as passing evidence.

## Final-project live-model gate

At the end of the project, after fresh explicit user authorization, preserve the existing V3
protocol exactly:

1. remove stale passing evidence through the reviewed alias-safe seams;
2. run exactly one real seven-case `onboarding-model-feasibility@3` command with the final-gate flag;
3. validate the exact artifact and all seven passing case results locally;
4. only on that success, run exactly one real `onboarding-journey-timing@3` command with the flag;
5. require the exact V3 tuple, two model invocations, an accepted strict handoff and
   `elapsedMs <= 35_000`;
6. on any failure, leave the relevant passing target absent and stop the final gate.

There is no automatic or manual retry, prompt variant, debug instrumentation, raw-output inspection,
fallback, alternate fixture, timeout increase, model/service-tier pin, replay, sharding, browser or
research run under this gate. A failed final gate requires a new user-approved design decision.

## Documentation supersession

The implementation plan for this amendment must update the narrow live-gate clauses in:

- `docs/superpowers/plans/2026-08-21-local-conversational-onboarding.md`;
- `docs/superpowers/plans/2026-08-23-onboarding-extraction-code-algebra.md`;
- `docs/superpowers/specs/2026-08-23-onboarding-extraction-code-algebra-design.md`.

Those updates must explicitly supersede only the execution timing and authorization clauses that:

- make the real `@3` artifacts a prerequisite for Task 8 resumption or implementation completion;
- describe V3 Task 6 as an immediate gate and Task 7 as conditional on its success;
- make the V3 implementation plan itself incomplete until the live commands pass;
- treat the earlier chat authorization for diagnostic Codex CLI calls as sufficient for a future
  invocation.

The prior authorization is revoked for the deferred period and is not carried forward. Fresh explicit
user authorization is mandatory immediately before the final-project gate. Task 8 live Step 6 and V3
Task 6 move together to that gate; the static V3 handoff and Task 8 offline Steps 5, 7 and 8 proceed
without them. Historical V2 prerequisite text, prompt/wire/artifact contracts and lineage remain
intact. The exact one-feasibility/one-conditional-timing protocol moves rather than being weakened or
deleted.

## Implementation scope

The follow-up implementation plan is limited to:

- the three tracked documentation files listed above;
- `evals/onboarding-feasibility.ts`;
- `evals/onboarding-journey-timing.ts`;
- `tests/integration/onboarding-feasibility-contract.test.ts`;
- `tests/integration/onboarding-journey-timing-contract.test.ts`;
- the ignored progress ledger for factual handoff state only.

`package.json` is deliberately outside this slice because it is already owned by the unfinished
Task 8 work. Production onboarding composition, model adapters, prompts, schemas, Decision code,
SQLite state and UI files are outside scope.

## TDD and verification requirements

Before production eval edits, add focused offline RED contracts proving:

- missing final-gate flag fails before runtime registration or any injected model/timer callback;
- exact flag parsing can be exercised with a fake callback and performs no external call;
- duplicate, missing, misspelled, decorated, extra and invalid-order arguments fail closed;
- stopped paths expose only `onboarding_live_model_gate_deferred` and no caught content;
- stale passing targets are absent after a stopped canonical invocation;
- existing fake feasibility/timing artifact contracts remain byte- and version-exact;
- final-gate success/failure behavior remains testable entirely through injected fakes.

Verification for this amendment is offline only:

```bash
pnpm exec vitest run \
  tests/integration/onboarding-feasibility-contract.test.ts \
  tests/integration/onboarding-journey-timing-contract.test.ts \
  --exclude '**/node_modules/**'
pnpm test
pnpm run typecheck
pnpm run lint
pnpm run build
pnpm audit:codex-runtime
git diff --check
```

The implementation report must state `External Codex/OpenAI calls: 0`. It must not claim that the
deferred live gate passed.

## Non-goals

- No deletion of fake/unit/contract tests.
- No live model, CLI preflight, smoke test or debug run.
- No prompt, schema, model tuple, fixture, timeout or artifact-version change.
- No disabling of production onboarding behavior.
- No browser or official-source research.
- No reinterpretation of an old artifact as current passing evidence.
- No push, pull request or merge.

## Acceptance criteria

1. Current development and Task 8 can proceed with zero Codex/OpenAI calls.
2. Accidental direct eval commands without the exact final-gate flag stop before runtime/model work.
3. All offline fake/static model contracts remain present and green.
4. The two real V3 passing artifacts remain absent while the deferral is active.
5. Documentation distinguishes implementation-complete from project-complete.
6. One unchanged final live-model protocol remains mandatory at project end, after fresh explicit
   authorization.
7. Failure at that final gate stops without retry or debugging and requires a new approved design.

## Rejected alternatives

### Documentation-only deferral

Rejected because the live eval entrypoints would remain easy to invoke accidentally during routine
development.

### Delete all model-related tests and eval code

Rejected because fake/static tests perform no external call and are the only deterministic guard for
the future final protocol. Deleting them would remove safety without satisfying any privacy need.

### Disable the production model runtime

Rejected because it changes product behavior and broadens this scheduling amendment into a runtime
feature flag. The safe development policy is to avoid `pnpm dev`, deployed-server startup and real
onboarding requests while retaining production composition unchanged.
