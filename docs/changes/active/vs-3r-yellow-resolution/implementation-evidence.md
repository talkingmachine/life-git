# VS-3R Yellow Resolution implementation evidence

Verification window: `2026-08-13T05:37:49Z` through `2026-08-13T05:40:50Z`
Verified HEAD: `8c2358e410c931b8dbd496505e1c216628542b6c`
(`fix: compare frontier seal instants`). The branch also contains replay-proof commit `335c70b`
and whole-branch review fix `342bf1c`. The first live walkthrough exposed an honest frontier-seal
timestamp defect; TDD fixes `9ffa858` and `8c2358e` and their scoped re-reviews closed it. The named
tests, 840-test full suite and all static/provider gates were then re-run on the exact verified HEAD.

## Deterministic gates

All gates ran sequentially from
`/Users/nameinchat/Documents/herring-8/.worktrees/vs1-confirmed-life`:

| Command | Result |
| --- | --- |
| `./node_modules/.bin/vitest run tests/integration/country-resolution.test.ts -t "presents the same resolved chain twice without network"` | PASS: 1 passed, 18 skipped |
| `./node_modules/.bin/vitest run tests/integration/country-resolution.test.ts -t "requires a verified non-empty resolved shortlist for City"` | PASS: 1 passed, 18 skipped |
| `./node_modules/.bin/vitest run tests/integration/country-resolution.test.ts` | PASS: 19 passed |
| `./node_modules/.bin/vitest run tests/integration/place-frontier.test.ts -t "accepts a terminal shortlist sealed after its ranking assessment"` | PASS: 1 passed, 69 skipped |
| `./node_modules/.bin/vitest run tests/integration/place-frontier-transport.test.ts -t "rejects a shortlist sealed before an expanded-year assessment"` | PASS: 1 passed, 43 skipped |
| `./node_modules/.bin/vitest run` | PASS: 37 files, 840 tests |
| `./node_modules/.bin/tsc --noEmit` | PASS |
| `./node_modules/.bin/eslint .` | PASS |
| `./node_modules/.bin/next build` | PASS; production routes compiled and 2 static pages generated |
| `git diff --check` | PASS |

The provider audit searched `src`, `tests`, `evals`, `package.json`, `pnpm-lock.yaml` and
`.env.example` for `openai`, `responses.parse`, `OPENAI_API_KEY`, `anthropic`, `gemini`,
`llmCalls` and `modelCalls`. It returned exit 1 with no matches.

## Replay and immutability proof

The named Application integration case creates frozen ranking `AA..FF`. The automatic frontier
contains formal yellow `BB` and `DD` plus green `AA`, `CC` and `EE`. Yellow `BB` is accepted at own
risk; yellow `DD` is rejected; the explicit continuation checks `FF` as formal green and commits it
as the sole replacement marker. `FF` carries Evidence ID
`evidence-country-resolution:a2e5f431154c6497e507b2ccc2add963f6356e4ebb9aa4450225c51a004d7295-FF`
and current/updated Knowledge revision `knowledge-FF`.

The exact identifiers are:

- resolution run: `country-resolution:a2e5f431154c6497e507b2ccc2add963f6356e4ebb9aa4450225c51a004d7295`;
- root: `country-resolution-revision:71b062f5142737c8e781e8617598db6b1714188d50057fa3f8d5dbd6a831999f`;
- accepted-yellow successor: `country-resolution-revision:4f4b4be4db1799446986a322f1ef9c6863d0edcd45e654d6f0f8d0a8a1e4fb96`;
- rejected-yellow successor: `country-resolution-revision:e7244a68971fde012ce4c1f59a0b962b7b14cf5d1253679c34e430c45f3daecd`;
- replacement child: `frontier-country:835e58d40bf7d2eb807a070db0a534348e322235b048a19a8a2f3ea4d72adc0e`;
- resolved head: `country-resolution-revision:acdbf16d6a6dcfea88cce595fb8467218c892837b02a43523f6da69bfbdf2e63`.

Two `presentCountryResolution` calls over the same store returned exact-equal read models. The test
asserts the full four-row predecessor chain, two decisions and their literal uncertainty basis and
warning version, the frozen ranking/shortlist IDs and ordered source markers, cursor 7, no unresolved
countries, five exact resolved entries, `five_effective_green`, one exact replacement marker, and
the final effective projection `AA green, BB green, CC green, DD red, EE green, FF green`.

Before presentation, the test snapshots every stored column in seven selected persistence tables:
artifacts, Evidence snapshots, Country Knowledge revisions, dossiers, profiles, Place Frontier
snapshots and Country Resolution revisions, in deterministic primary-key/creation order. This includes
raw artifact bytes, all canonical JSON payloads, predecessor/source bindings,
manifest/payload/command/context hashes and every HMAC in those tables. The complete seven-table
snapshot is exact-equal afterward; this proves row-set and row-content immutability for those
evidence/frontier/resolution tables rather than counts alone. It makes no broader claim about unrelated
immutable tables. Freeze/rank probes are also unchanged.

The network proof is deliberately two-layered and does not pretend the synthetic fixture is the
production adapter. The named case constructs a second Country Resolution Application over the same
verified frontier/store and delegates only `verifier.present` to the fixture's in-memory result seam;
it is not a persisted child replay. Its forbidden `verifier.check` increments a spy and calls a counted
`requestStep` that throws `network_forbidden`; both counts remain zero across two presentations. The
separate production-composition case uses the real composition wiring with an injected throwing
`requestStep` and independently proves that its call count remains unchanged during resolution start
and repeated presentation.

## City handoff and scope

The exact named City gate accepts only a verified, non-empty resolved revision and rejects an
automatic shortlist ID, working revision, tampered revision and empty resolved revision with
`resolved_country_shortlist_required`. No City Registry, city table or city ranking was added.

## Live SI walkthrough

The walkthrough used the production build on loopback with a new temporary SQLite database and a
random process-only HMAC. It never used the existing database. The first run on `342bf1c` visibly
advanced through official source candidates and artifact/claim publication, persisted one yellow SI
marker, then failed closed before a domain result with `terminal_shortlist_mismatch`. Read-only DB
inspection showed a valid shortlist sealed 2.198 seconds after ranking assessment; the Experience
decoder alone incorrectly required equal timestamps. This was not recorded as source drift or a
successful walkthrough.

TDD commit `9ffa858` allowed an honest later shortlist seal while rejecting a pre-assessment seal.
Scoped review then found the accepted expanded-year ISO boundary made lexical comparison unsafe;
TDD commit `8c2358e` replaced it with numeric instant comparison. Both scoped reviews ended APPROVE
with no Critical or Important residuals.

The final walkthrough started again from a third new temporary database on exact HEAD `8c2358e`:

- automatic frontier run `run-b965542d-eaaa-4ec3-bea4-9789568defca` produced one actual SI yellow;
- resolution run `country-resolution:5aea7bae29a0f140e3b1ae14aa065e157723dd88a867ede3c77b63a19c317027`
  showed the exact risk prompt and no premature green;
- accepting the yellow produced an ordinary noninteractive green marker labelled
  `Доступно для выбора`, one ordinary country card and no yellow badge/button;
- the exact resolution URL survived reload; the same green marker and one card remained, while the
  live progress region count was zero;
- before and after reload the selected persistence counts stayed `artifacts=11`,
  `evidence_snapshots=1`, `country_knowledge_revisions=1`, `place_frontier_snapshots=2`,
  `country_resolution_revisions=2`; frontier and resolution IDs, payload hashes and HMACs were
  byte-for-byte unchanged; `PRAGMA integrity_check` returned `ok` and foreign-key check was empty.

The production package remains SI-only, so rejected/replacement behavior is proven with the isolated
synthetic integration fixture rather than fabricated as live production evidence. All three temporary
database directories were deleted, all local servers stopped, loopback port 3417 closed, browser tabs
finalized, and the synthetic HMAC values died with their processes and were never printed or persisted.

The user approved this evidence on 2026-08-13. Its publication changes only this evidence file, the
VS-3R change status and the documentation index; it does not merge, land or push anything to trunk.
