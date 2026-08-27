# VS-3 provider-free place-frontier implementation evidence

## Observation

- Observed at: `2026-08-12 11:46 MSK (UTC+03:00)`.
- HEAD: `b2b7bbfad1b829d1a01d0c59e2bbfb138816d2fe` (`fix: own place frontier streams`,
  committed `2026-08-12T11:21:38+03:00`).
- Runtime: production Next composition, a fresh temporary SQLite database and a synthetic
  process-only `EVIDENCE_HMAC_KEY`; the key was not printed or recorded.
- Browser runtime: local production server at `http://localhost:3417` and the in-app browser.
- No external LLM SDK, Responses API, model credential, provider call or separate API billing was
  used by the application, verification commands or walkthrough.

## Automated gate

| Check | Result |
| --- | --- |
| `./node_modules/.bin/vitest run` | PASS: 32 files, 715 tests |
| `./node_modules/.bin/tsc --noEmit` | PASS |
| `./node_modules/.bin/eslint .` | PASS |
| `./node_modules/.bin/next build` | PASS; `/`, `/api/cold-start` and `/api/place-frontier` built successfully |
| `git diff --check` | PASS |
| Pre-evidence `git status --short` | only the preserved unrelated `.superpowers/brainstorm/12369-1786346924/` |
| Provider-surface audit | PASS: no matches; expected `rg` exit 1 |
| Focused production replay test | PASS: 1 test, 67 skipped |

The provider audit executed exactly:

```bash
rg -n -i 'openai|responses[.]parse|OPENAI_API_KEY|OPENAI_MODEL|llmCalls|modelCalls|provider sdk' \
  src tests evals package.json pnpm-lock.yaml .env.example
```

It returned no matches. Historical documentation was intentionally outside the runtime audit.

## Zero-network replay proof

The focused production test was run with `requestStep` replaced by a function that throws if
invoked:

```bash
./node_modules/.bin/vitest run tests/integration/place-frontier.test.ts \
  -t 'production frontier is SI-only, consumes no child ID and replays with zero network' \
  --reporter=verbose
```

It passed. A one-time, untracked diagnostic then strengthened the exact Task 7 assertion and was
deleted immediately after execution. It called `presentPlaceFrontier` twice and canonical-compared:

- the complete `RankingSnapshot`;
- marker order, rank, formal state and reasons;
- shortlist markers, `rulesVersion` and derived composition/stop condition;
- ranking, current and current-run Knowledge revision IDs;
- Evidence snapshot IDs.

Result:

```json
{"runId":"task-7-frontier-1","presentCalls":2,"requestStepCalls":0,"canonicalEqual":true,"markerCount":1,"rankingSnapshotId":"task-7-frontier-1:ranking","shortlistSnapshotId":"task-7-frontier-1:shortlist"}
```

The exact executed command was:

```bash
node --import tsx \
  /Users/nameinchat/Documents/herring-8/.superpowers/sdd/2026-08-12-vs-3-place-frontier/task-7-replay-check.ts
```

The temporary script used an isolated fresh in-memory SQLite database, a local synthetic HMAC key,
and the following complete assertion body (imports and fixture literals included):

```ts
import assert from "node:assert/strict";
import { projectTerminalSummary } from
  "/Users/nameinchat/Documents/herring-8/.worktrees/vs1-confirmed-life/src/decision/place-frontier-summary.ts";
import { canonicalJson } from
  "/Users/nameinchat/Documents/herring-8/.worktrees/vs1-confirmed-life/src/infrastructure/integrity.ts";
import { createPlaceFrontierComposition } from
  "/Users/nameinchat/Documents/herring-8/.worktrees/vs1-confirmed-life/src/infrastructure/place-frontier-composition.ts";
import { openEvidenceDatabase } from
  "/Users/nameinchat/Documents/herring-8/.worktrees/vs1-confirmed-life/src/infrastructure/sqlite/db.ts";

const database = openEvidenceDatabase(":memory:");
let requestStepCalls = 0;
let generatedIds = 0;
const application = createPlaceFrontierComposition({
  database,
  hmacKey: "task-7-ephemeral-replay-key",
  countrySourceIndex: {
    lookup: () => ({
      ok: false as const,
      kind: "country_not_installed" as const,
      candidates: [] as const,
    }),
  },
  requestStep: async () => {
    requestStepCalls += 1;
    throw new Error("network_forbidden");
  },
  clock: () => new Date("2026-08-12T08:00:00.000Z"),
  nextRunId: () => `task-7-frontier-${++generatedIds}`,
});

const prepared = await application.preparePlaceFrontier({
  profile: {
    currentCountryCode: "RU",
    citizenships: ["RU"],
    monthlyIncome: { amount: "250000", currency: "RUB", basis: "net" },
    remoteWork: { relation: "foreign_employment", legallyAllowed: true },
    education: "higher",
    relevantExperienceYears: 5,
    passportValidUntil: "2030-01-01",
    healthInsurance: "confirmed",
    companions: [],
  },
  preferences: {
    criteria: [{
      id: "personal_safety",
      mode: "weighted",
      importance: 5,
      target: "maximize",
    }],
  },
});

const original = await application.runPlaceFrontier(
  prepared,
  () => undefined,
  new AbortController().signal,
);
assert.equal(requestStepCalls, 0);
const replayOne = await application.presentPlaceFrontier(prepared.runId);
assert.equal(requestStepCalls, 0);
const replayTwo = await application.presentPlaceFrontier(prepared.runId);
assert.equal(requestStepCalls, 0);

function replayProjection(readModel: typeof original) {
  return {
    rankingSnapshot: readModel.rankingSnapshot,
    markerOrderStatesReasons: readModel.shortlistSnapshot.markers.map((marker) => ({
      countryCode: marker.country.countryCode,
      rank: marker.rank,
      state: marker.formalVerdict.marker,
      reasons: marker.formalVerdict.reasons,
    })),
    shortlist: {
      markers: readModel.shortlistSnapshot.markers,
      rulesVersion: readModel.shortlistSnapshot.rulesVersion,
      summary: projectTerminalSummary(readModel),
    },
    rankingKnowledgeRevisionIds: readModel.rankingSnapshot.knowledgeRevisionIds,
    updatedKnowledgeRevisionIds: readModel.shortlistSnapshot.markers.map((marker) => ({
      countryCode: marker.country.countryCode,
      current: marker.currentKnowledgeRevisionId ?? null,
      updated: marker.updatedKnowledgeRevisionId ?? null,
    })),
    evidenceSnapshotIds: readModel.shortlistSnapshot.markers.map((marker) => ({
      countryCode: marker.country.countryCode,
      evidenceSnapshotId: marker.evidenceSnapshotId,
    })),
  };
}

const expected = canonicalJson(replayProjection(original));
assert.equal(canonicalJson(replayProjection(replayOne)), expected);
assert.equal(canonicalJson(replayProjection(replayTwo)), expected);
assert.equal(requestStepCalls, 0);
database.close();
```

The script was deleted after the successful run; no diagnostic file remained in either worktree.

## Installed-country browser walkthrough

The final observed route was:

`http://localhost:3417/?flow=place-frontier&run=run-38040d16-94ed-4251-b1a4-ca3b25a2589a`

The setup screen stated that automated coverage is limited to installed country packages and may
produce fewer than five countries. The confirmed synthetic profile used Russia as the origin,
`210000 RUB` monthly net income, foreign employment and no companions. The default confirmed
preference set was submitted without a country field.

The accepted run was launched through the UI's `Повторить проверку` action solely to preserve the
fast transient states. Earlier attempts reached the same honest yellow result; they were not source
semantic failures and are not used as the persisted evidence target. High-frequency DOM observation
during this final run preserved:

- at `56 ms`, Slovenia was a gray, non-interactive pending marker labelled
  `Страна Slovenia: Формальная проверка`;
- the visible timeline first listed the six installed navigation candidates for GOV.SI, ZTuj-2,
  salary publication, SiStat, ESS and ZZSDT;
- as source work completed, the timeline accumulated actual artifact rows, including
  `gov-route-page`, `salary-registry`, `salary-details`, `ztuj2-registry`, `sistat-metadata`,
  `ess-companion-page`, `zzsdt-registry`, `ztuj2-details`, `official-document`,
  and `sistat-series`;
- nine claim rows were visibly sampled before terminal: seven `si-route@2` claims
  (`route_basis`, `citizenship_applicability`, `remote_work_relations`, `qualification`,
  `companion_entry`, `duration`, `general_statutory_prerequisites`), `cbr-eur-facts-1 / fx_rate`,
  and `si-income-threshold:income:si-income@2`;
- the terminal state arrived at approximately `1,190 ms`; no timer-only or fabricated progress row
  was observed.

The final `zzsdt-details` capture was sealed in SQLite but completed inside the last unsampled gap
before terminal. No separate `dossier_published` row was preserved in the black-box sample, and the
browser run published no dossier row. The evidence therefore claims only the source, ten artifact
and nine claim progress rows actually observed; the final capture is persistence evidence, while
dossier event semantics remain automated protocol coverage rather than a claimed browser observation.

The terminal UI showed:

- one persistent yellow Slovenia marker and one country card after the same globe collapsed;
- `0 формально доступны / 1 требуют проверки`;
- `Предварительный результат` and the explicit warning that installed coverage was exhausted and
  the result may contain fewer than five countries;
- `verdictAsOf = 2026-08-12`, `lastCheckedAt = 2026-08-12` and
  `knowledgeUpdatedAt = 2026-08-12T08:38:32.188Z`;
- `income_below_verified_threshold`: the digital-nomad route is `impossible` because verified net
  income is below the route threshold;
- `passport_validity_unknown`: the passport-validity prerequisite remains unresolved;
- `catalog_completeness_unprovable`: the complete formal-route catalog is not proven.

The final marker is therefore correctly yellow rather than false red: one verified route is
impossible, but the system has no official proof that every formal residence route is impossible.
The card exposed separate Evidence and manual-check sections, current rules IDs and links to the
captured PISRS, SiStat, GOV.SI and CBR sources. A live red country was not fabricated; red/yellow
keyboard and focus semantics remain covered by the passing integration suite.

All 11 official captures returned HTTP 200, were sealed, and had recorded SHA-256 values. Their
capture interval was `2026-08-12T08:38:31.344Z` through `2026-08-12T08:38:32.188Z`.

## Reload and persisted integrity

Reloading the exact terminal URL restored:

- the same shortlist ID;
- the same yellow marker and country card;
- the same `0 / 1` preliminary composition and installed-coverage warning;
- zero live timeline rows and no active progress flight.

The verified presenter proof above recorded zero `requestStep` calls. In addition, the browser-run
database fingerprints were captured immediately before and after reload and were byte-for-byte
identical: two frontier rows, one referenced Knowledge row, one referenced Evidence row and the
same 11 artifact IDs/SHA-256 values. Reload therefore used persisted presentation and produced no
new official capture.

Read-only SQLite inspection for the browser run returned:

| Item | Value |
| --- | --- |
| Ranking rows for run | 1 |
| Shortlist rows for run | 1 |
| Ranking ID | `run-38040d16-94ed-4251-b1a4-ca3b25a2589a:ranking` |
| Ranking hash | `4ded5a02739b640c3d994e3e748c19515f66fc93cfdc745322fbb49492b0ed8c` |
| Shortlist ID | `run-38040d16-94ed-4251-b1a4-ca3b25a2589a:shortlist` |
| Shortlist hash | `b7155f745c47834f9cabdb8586bdc31e33e6ad62cea36cfc920efda124754013` |
| Shortlist ranking reference | exact ranking ID above |
| Marker count / formal state | 1 / `yellow` |
| Evidence snapshot | `frontier-country:47c2411d3952d90cf0667eb0fc3de6fe6dcc68c50adc10406fa767dacab6dc48:evidence` |
| Official artifacts | 11 total / 11 sealed |
| Knowledge revision | `country-knowledge:SI:frontier-country:47c2411d3952d90cf0667eb0fc3de6fe6dcc68c50adc10406fa767dacab6dc48:evidence` |
| Knowledge publication time | `2026-08-12T08:38:32.188Z` |
| Knowledge formal claim refs | 9 |
| Forbidden raw-byte keys in frontier/Knowledge payloads | 0 |

The Knowledge row references the exact sealed Evidence snapshot through
`trigger_evidence_snapshot_id`; its `created_at` exactly equals the marker's `knowledgeUpdatedAt`.
Raw source bytes remain only in the sealed local `artifacts.bytes` column and are not serialized into
frontier or Country Knowledge payloads.

`PRAGMA integrity_check` returned `ok`, `PRAGMA foreign_key_check` returned no rows, and immutable
UPDATE/DELETE triggers were present for frontier snapshots, Country Knowledge revisions and
Evidence snapshots. Together with unchanged pre/post-reload hashes and counts, this proves the
observed path remained append-only; it does not claim a separate historical update log.

## Readiness conclusion and limitation

- Provider-free runtime: **verified**.
- Frozen ranking/shortlist persistence and two-call zero-network replay: **verified**.
- Current-source installed-SI walkthrough with real progress, honest formal yellow, collapse and
  reload: **verified**.
- Production coverage remains SI-only. The terminal result is therefore explicitly preliminary and
  may contain fewer than five countries.
- Red replacement and preservation are proven by integration fixtures until another country package
  passes its own official-source feasibility gate; no live country or Evidence was fabricated.

This document records evidence only. At the approval boundary it was untracked and the active change
was unmodified. After explicit user approval on 2026-08-12, only the active status/evidence link was
updated for documentation publication; no implementation snapshot was retroactively changed. The
browser tab and production server were closed, the temporary database and its directory were deleted,
and the process-only synthetic HMAC value ceased with the server process; it was never persisted or
logged.
