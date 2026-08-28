# Task 2 report — fail-closed Codex CLI policy and fixed argv

## Implementation and files

- `src/infrastructure/codex-cli/policy.ts` now owns the unchanged 23-feature disabled tuple, the bounded `0.149.0-alpha.N` parser, the fixed exec argv builder, and a SHA-256 fingerprint of canonical policy JSON.
- `src/infrastructure/codex-cli/preflight.ts` re-exports the policy-owned tuple and parses the observed compatible version before attempting login; the canonical executable, known warning, ChatGPT login, and strict feature-inventory checks remain intact.
- `src/infrastructure/codex-cli/feasibility-probe.ts` routes model execution through `buildCodexExecArgs`; prompt content remains stdin-only and the fresh owned directory remains both cwd and `--cd`.
- `evals/codex-cli-feasibility.ts` validates its offline observer against the shared builder after the duplicated argv constant was removed.
- `tests/infrastructure/codex-cli-policy.test.ts` adds literals for accepted/rejected families (including the six-digit bound), zero-tool/discovery argv, retained disabled features, forbidden bypass flags, prompt exclusion, and policy fingerprint shape.
- `tests/infrastructure/codex-cli-preflight.test.ts` switches accepted fixtures to the reviewed family and proves malformed/older output stops before login. The specified integration contracts remained green without source changes.

## RED — test first

```sh
pnpm exec vitest run tests/infrastructure/codex-cli-policy.test.ts tests/infrastructure/codex-cli-preflight.test.ts
```

Output: `2 failed` files; `10 failed | 23 passed` tests. The failures were the expected missing argv builder/fingerprint exports, unbounded seven-digit alpha suffix acceptance, and stale `0.148.0` preflight fixtures. This demonstrated that each added policy behavior could fail before implementation.

## GREEN

```sh
pnpm exec vitest run tests/infrastructure/codex-cli-policy.test.ts tests/infrastructure/codex-cli-preflight.test.ts tests/integration/codex-cli-feasibility-contract.test.ts tests/integration/codex-cli-network-privacy-contract.test.ts
```

Output: `Test Files 4 passed (4)`, `Tests 160 passed (160)`.

```sh
pnpm typecheck
```

Output: `$ tsc --noEmit` (exit 0).

```sh
git diff --check
```

Output: exit 0 with no whitespace errors.

## TDD evidence

I read `writing-good-tests.md` before test changes. The RED command above ran after adding literal behavior tests and before policy implementation. The GREEN command ran after minimal policy/preflight/probe changes; it includes both focused behavior suites and the prescribed offline feasibility/network contract suites. The version test catches the reported overflow mutation (`1000000`); argv tests catch model/effort/order/tool/bypass/prompt regressions; inventory tests retain duplicate/malformed/missing/true fail-closed coverage.

## Self-review and concerns

- `buildCodexExecArgs` has no prompt/auth input and does not add approval, profile, add-dir, or shell-mode options. `runCodexJsonProbe` supplies the owned directory and keeps `cwd` there, preserving `shell: false` process execution through the existing spawner.
- The policy parser accepts only 1–6 ASCII decimal alpha ordinals with numeric value at least four; future major/minor families and `alpha.1000000` fail before login/model execution.
- No live network, browser, or model call was made. No historical onboarding tuples were edited.
- Concern: alpha ordinals above `999999` intentionally require a reviewed policy revision, per the supplied ruling.
