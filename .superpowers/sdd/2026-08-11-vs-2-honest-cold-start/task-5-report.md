# Task 5 report — streamed Cold Start research journey

Status: DONE

Base: `933da719ce514b777c635e43ec6c8e5f6c8849f7`

## RED evidence

- Stream contract and route tests first failed because the shared event codec, reducer and `/api/cold-start` POST route did not exist.
- UI tests first failed because the focused start, journey and comparator screens were absent and the page still rendered the VS-1 shell directly.
- Transport regressions reproduced premature terminal delivery, cross-run terminal payloads, fabricated reload events and reader cancellation leaks before their focused fixes.
- The unmount/retry regression reproduced a blocked `reader.read()` that `iterator.return()` could not interrupt; the decoder now accepts an abort signal and cancels the reader in `finally`.
- Final review regressions reproduced an unexpected infrastructure error incorrectly returned as 400, an internal comparator enum exposed to the user, and a rejected cached `next/dynamic` subscription that could not be retried.

## Implemented

- Added one strict shared Zod NDJSON event contract and reducer with UTF-8 line limits, strict sequencing, one-run binding, clean-EOF terminal delivery and explicit reader cancellation.
- Added one finite non-blocking POST route that prepares and streams a Cold Start run, validates the complete output independently, handles request aborts, and separates expected input errors from generic internal failures.
- Added the focused confirmed-profile start, full-screen streamed research journey, collapsed persistent globe and final comparator presentation without introducing another framework, event bus, store or provider layer.
- Kept factual event order while aggregating only consecutive claim/artifact progress, and preserved honest gray/yellow/red/green semantics across stream, reload, retry and interruption states.
- Added accessible country/city marker labels, exact veto/blocker evidence links, and a compact native `details` cut of all verified official source-navigation links.
- Added local WebGL/import retry that creates a fresh dynamic-loader subscription and never reloads the page.
- Kept `replaceRunUrl` unchanged and introduced a separate Cold Start URL helper.

## Review fixes

- Held terminal events until clean EOF and rejected trailing corruption without exposing a verdict.
- Enforced terminal read-model run and Evidence-snapshot identity, while completed reload uses the trusted read model with an empty live stream.
- Protected an already completed presentation from late transport errors; an explicit retry starts a fresh gray running state.
- Added synchronous abort-driven cancellation for unmount and retry while a stream read is pending.
- Restricted prepare-time 400 responses to Zod and the exact expected input errors; unexpected faults return a detail-free 500 problem.
- Replaced personal-fit enum codes with short Russian labels.
- Replaced the cached rejected dynamic import on local retry and covered reject-then-success behavior with a subscription-aware harness.

## Changed scope

- `src/app/api/cold-start/route.ts`
- `src/app/page.tsx`, `src/app/globals.css`
- `src/experience/cold-start-stream.ts`, `src/experience/cold-start-view-model.ts`
- `src/experience/components/ColdStartStart.tsx`, `ColdStartJourney.tsx`, `ColdStartComparator.tsx`
- Minimal integration changes in the existing shell, workspace, globe presentation boundary and URL helper.
- Focused integration tests and only the necessary legacy fixture/signature updates.

## Final gates

- Focused Task 5 and compatibility suite: 6 files, 144 tests passed.
- Full suite: 24 files, 485 tests passed.
- `./node_modules/.bin/tsc --noEmit`: passed.
- `./node_modules/.bin/eslint .`: passed.
- `./node_modules/.bin/next build`: passed; `/api/cold-start` is dynamic and `/` builds successfully.
- `git diff --check`: passed.

## Constraints observed

- No browser, network, push, merge or `main` operation was used.
- The unrelated untracked `.superpowers/brainstorm/12369-1786346924/` was not modified or staged.
- The `pnpm` wrapper could not run non-interactively because it requested dependency-directory removal; the checked-in local binaries were used for the required gates.

## Residual risk

- Task 5 proves the transport and UI behavior with deterministic integration fixtures. Live official-source drift and the explicitly permitted browser scenario remain the next validation stage.
