# Task 2 report: deterministic VS-1 narrative

## Scope

- Replaced provider-facing narrative selection with a pure projection of `EvidenceReadItem.class`.
- Removed narrative ports, composition options, API-key forwarding, and the OpenAI narrative adapter.
- Preserved the `RunDetails.narrative` read model as frozen `{ headline, bullets }` data.

## TDD evidence

### RED

After replacing the model adapter tests with the three deterministic-policy cases, the focused command failed as intended:

```text
./node_modules/.bin/vitest run tests/integration/experience.test.tsx
6 failed / 16 passed
TypeError: projectNarrative is not a function
```

The failures were caused by the absent projection export, including each of the three policy cases.

### GREEN

After implementing the projection and removing the provider path:

```text
./node_modules/.bin/vitest run tests/integration/experience.test.tsx tests/integration/confirmed-life.test.ts tests/integration/present-journey.test.ts tests/integration/journey-actions.test.tsx tests/integration/cold-start.test.ts
5 files passed, 161 tests passed
```

## Verification gates

| Gate | Result |
| --- | --- |
| Focused Task 2 tests | 5 files, 161 tests passed |
| `./node_modules/.bin/tsc --noEmit` | exit 0 |
| `./node_modules/.bin/eslint .` | exit 0 |
| `./node_modules/.bin/vitest run` | 25 files, 488 tests passed |
| `./node_modules/.bin/next build` | exit 0 |
| Task 2 provider-surface audit | no matches; `rg` exit 1 |
| `git diff --check` | exit 0 |

## Concern carried to Task 3

The `openai` package, its lockfile entries, and example environment variables remain intentionally. Their removal is Task 3 scope; Task 2 removes the complete VS-1 runtime/composition path that referenced them.
