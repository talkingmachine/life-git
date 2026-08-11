# Final review fix report — LLM-free runtime

Base: `23893d29fe385901c00338f428651eeb908cd6ea`
Commit message: `fix: close llm-free runtime gaps`

## Verified findings and fixes

### 1. Incomplete installed index is zero-network

Verified root cause: `ColdStartApplication` treated every `CountrySourceIndexResult.ok === true` as
complete and emitted discovery events before the Slovenia adapter could detect missing roles.

- RED: representative partial and duplicate-role real-composition cases both emitted
  `source_discovered -> authority_verified` events.
- GREEN: one inner `research/slovenia-source-set.ts` role selector now validates the exact six-role
  composition before events or Research. The same selector replaced the adapter-local matching
  implementation, so source-role knowledge is not duplicated.
- Result: incomplete sets reuse the sealed `country_not_installed` path with zero request-step calls,
  terminal-only progress, zero claims/dossier, `${runId}:evidence`, empty source navigation and
  byte-equal reload.

### 2. Failed capture preserves both installed navigation seeds

Verified root cause: successful `CapturedEntry` carried `indexedSourceUrl`, but the failure variant
carried only partial artifacts. `unavailableEntry` therefore sealed only the primary plan URL.

- RED: failed and partial route captures loaded from SQLite without the ZTuj-2 secondary URL.
  A mutation check that removed the forwarding reproduced both failures after the deterministic
  deadline setup was corrected.
- GREEN: capture failures optionally carry the existing `indexedSourceUrl`; the existing unavailable
  entry path seals it without a new store field or source map.
- Result: failed and partial capture cases for all three GOV.SI/ZTuj-2, salary/SiStat and ESS/ZZSDT
  pairs retain exact primary/secondary lineage, preserve partial artifacts/blockers, survive verified
  SQLite load and replay through `application.present`, and make no replay network call.

### 3. `country_not_installed` is presented honestly

Verified root cause: `researchIncomplete` collapsed every country blocker to
`country_evidence_incomplete` and copied blocker navigation into `officialUrls`.

- RED: application and stream returned three generic reasons with uncaptured authority URLs;
  the empty source component still used the label “Проверенные официальные источники”; the view
  model retained an `officialUrl: undefined` field.
- GREEN: an all-`country_not_installed` country blocker set now projects one explicit Russian reason
  with empty claim IDs and official URLs. Stream/reload keep `sourceNavigation: []`; the view omits
  the link field and the component labels the empty state “Официальные источники не проверены”.
- Ordinary semantic-drift blockers retain `country_evidence_incomplete` and captured official URLs.

### 4. Dormant model-call telemetry is removed

- RED extended audit found exactly three matches: `evals/live.ts` and two committed VS-1 artifacts.
- GREEN removed `observed.llmCalls` from all three without a replacement counter.
- The final audit covers provider/runtime identifiers plus case-insensitive `llm`, `model` or
  `provider` call/request telemetry names across `src`, `tests`, `evals`, `artifacts/evals/vs1`,
  `package.json`, `pnpm-lock.yaml` and `.env.example`; it returns no matches.

## Verification

| Gate | Result |
| --- | --- |
| Focused affected tests | 4 files, 212 tests passed |
| Full Vitest | 25 files, 496 tests passed |
| `./node_modules/.bin/tsc --noEmit` | exit 0 |
| `./node_modules/.bin/eslint .` | exit 0 |
| `./node_modules/.bin/next build` | exit 0 |
| Extended zero-LLM/model-call audit | no matches, gate exit 0 |
| Artifact/package JSON parse | exit 0 |
| `git diff --check` | exit 0 |
| Preserved brainstorm files | present and unstaged |

No browser, live network, package install/update, push, PR or merge was used.

## Architecture and code review

- Clean Architecture: **10/10 for the scoped wave**. Application depends on a research-layer policy;
  infrastructure reuses that inward policy, and persistence remains unchanged.
- Clean Code: **9/10 for the scoped wave**. Names, failure semantics and behavioral tests are explicit.
  The existing generic `unavailableEntry` now has one additional optional lineage argument; converting
  its mature call surface to a parameter object would be cleanup outside this bounded fix.

## Remaining concern

The required provider-free current-source browser walkthrough remains a separate approval-gated task.
This wave preserves official capture/replay behavior and proves it offline; it does not claim fresh
`source-verified` runtime evidence.
