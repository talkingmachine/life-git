# VS-2 provider-free implementation evidence

## Observation

- Observed at: `2026-08-11 22:18 MSK (UTC+03:00)`.
- HEAD: `fbb4b588b4c30d0b70b825d13138c2fc0e1b52e3`.
- Runtime configuration: only an isolated `DATABASE_PATH` and a synthetic
  `EVIDENCE_HMAC_KEY`; the HMAC value was not recorded.
- Local command: `DATABASE_PATH=/private/tmp/life-git-e2e.GQ9br3/life-git.db EVIDENCE_HMAC_KEY=<synthetic-not-recorded> ./node_modules/.bin/next start -p 62123`.
- No external LLM SDK, LLM API, model credential, Responses API call or separate API billing was
  used by the application or the walkthrough.

## Automated gate

| Check | Result |
| --- | --- |
| `./node_modules/.bin/vitest run` | PASS: 25 files, 502 tests |
| `./node_modules/.bin/tsc --noEmit` | PASS |
| `./node_modules/.bin/eslint .` | PASS |
| `./node_modules/.bin/next build` | PASS; `/` and `/api/cold-start` are dynamic routes |
| Zero-LLM/provider audit over `src`, `tests`, `evals`, package, lock and env example | PASS: no matches; expected `rg` exit 1 |
| Model-call telemetry audit over runtime, tests, evals and committed VS-1 artifacts | PASS: no matches; expected `rg` exit 1 |
| Package and committed eval JSON parse | PASS |

The zero-LLM audit covered `openai`, `OPENAI_API_KEY`, `OPENAI_MODEL`, `openAiApiKey`,
`responses.parse`, `gpt-5.6`, the removed discovery/narrative adapters and model-origin values.
The telemetry audit covered `llmCalls`, `modelCalls` and equivalent provider-call counters.
`evals/vs2-live.ts` and the `eval:vs2` package script are absent.

## Provider-free browser walkthrough

The final terminal route was:

`http://127.0.0.1:62123/?flow=cold-start&run=run-b720727e-998c-4983-b343-cd210a6069b4&profile=16d164efe0328a45d5b61a3dad1d95bb465ba090ca01bf2a13f27611ea5f31c4`

The confirmed synthetic case used Russia as the origin, Slovenia as the requested country,
`210000 RUB` monthly net income and one spouse. The visible running state showed a gray/pending
route, `Снимок: Создаётся`, `Идёт проверка`, and all six installed navigation candidates in exact
`Найден официальный кандидат -> Подтверждён официальный домен` pairs:

1. GOV.SI -> `gov.si`;
2. ZTuj-2 -> `pisrs.si`;
3. salary publication -> `pisrs.si`;
4. SiStat series -> `pxweb.stat.si`;
5. ESS companion employment -> `ess.gov.si`;
6. ZZSDT -> `pisrs.si`.

No artificial waiting rows or timer-driven progress appeared. The capture/claim stage completed
between browser snapshots too quickly to preserve as a separate visual frame; its persisted result
and ordered stream semantics are covered below and by the passing integration suite, but those do
not substitute for the missing final-HEAD black-box observation required by the Task 4 gate.

The terminal UI showed:

- yellow marker and status `Нужно уточнить`;
- collapsed globe with comparator;
- evidence snapshot `run-b720727e-998c-4983-b343-cd210a6069b4:evidence`;
- country coverage `8 / 9`;
- `Досье не опубликовано`;
- one short missing-evidence reason with a link to the official ESS page;
- no browser console errors.

The compact source block exposed four user-checkable official navigation links:

1. [GOV.SI / ZTuj-2](https://www.gov.si/en/news/2025-11-21-temporary-residence-permit-for-digital-nomads/)
2. [PISRS / SiStat income](https://pisrs.si/pregledPredpisa?sop=2026-01-1950)
3. [ESS / ZZSDT companion employment](https://www.ess.gov.si/delodajalci/zaposlovanje-tujcev-iz-tretjih-drzav/zaposlitev-tujcev-z-dovoljenjem-za-prebivanje/)
4. [Bank of Russia EUR/RUB](https://www.cbr.ru/scripts/XML_daily.asp)

## Interaction evidence

- Hit-testing at the center of the 3D marker returned its text span, then the marker button, then
  the canvas; no comparator or workspace overlay intercepted it.
- Mouse click opened exactly one dialog, matched `aria-controls` to the dialog ID and focused the
  `Словения` heading.
- Physical Enter and Space each opened exactly one dialog and focused its heading.
- Escape and the close button both closed the dialog and returned focus to the current visible
  CSS2D marker clone after renderer replacement.
- The route card and the expanded official-source block remained clickable through the collapsed
  globe layout.
- The marker is a native focusable `button` in the accessibility tree. The in-app browser's
  physical Tab command did not expose an in-page focus transition reliably, so Tab traversal is
  not claimed from the black-box trace alone; focus order and cloned-button behavior remain covered
  by the passing integration tests.

## Persisted evidence and reload

The isolated SQLite database contained, before reload:

| Item | Value |
| --- | ---: |
| Profile snapshots | 1 |
| Official artifacts | 11 |
| Sealed artifacts | 11 |
| Evidence snapshots | 1 |
| Dossier versions | 0 |
| Verified claims | 9 |

All 11 captures returned HTTP 200 and had a 64-character SHA-256. The Evidence manifest hash and
HMAC were each 64 characters; rules version was `vs2-si-evidence@2`. The four manifest entries
preserved both navigation seeds for GOV.SI/ZTuj-2, salary/SiStat and ESS/ZZSDT, plus the single CBR
URL.

Coverage was:

- `si-digital-nomad-route`: `verified`;
- `si-income-threshold`: `verified`;
- `cbr-eur`: `verified`;
- `si-companion-employment`: `unavailable`.

The exact blocker was `si-companion-employment / semantic_mismatch`, grounded in three captured
ESS/ZZSDT artifacts. Reloading the exact terminal URL reproduced the same yellow status, `8 / 9`
coverage, snapshot ID, unpublished dossier state, four source links and one 3D marker. Database
counts remained exactly `1 profile / 11 artifacts / 1 evidence snapshot / 0 dossiers`, proving the
reload used persisted presentation and performed no new official capture.

## Readiness conclusion

- Provider-free runtime and honest yellow-path demo: **verified**.
- Complete Task 4 final-HEAD browser gate: **partially unearned**. The final run did not preserve a
  separate visible capture/claim-progress frame, and physical Tab traversal could not be measured
  reliably in the in-app browser.
- Current-source completeness for Slovenia: **blocked by the observed companion-employment
  semantic mismatch**.
- `source-verified: not earned`.

The project is ready to demonstrate that it fails closed, exposes official sources and preserves a
replayable evidence snapshot. It is not ready to claim that the current Slovenia source set fully
supports all nine required facts. No parser fallback, recorded fixture or remembered fact was used
to turn the yellow result into a success. Committing this evidence or updating active readiness
status requires explicit user acceptance of the two browser-observation limitations above.

## Follow-up: ESS source-shape repair

This section supersedes only the source-readiness conclusion above. The original observation remains
the immutable record of the first provider-free run.

- Observed at: `2026-08-11 23:09 MSK (UTC+03:00)`.
- HEAD: `0981f8bffb5afb7270436c12d4b061083b593abf`.
- Repair: the live ESS page repeats its title in a breadcrumb `<li>` and the canonical `<h1>`.
  The validator now evaluates ESS claim content from headings, paragraphs and time nodes while a
  second matching `<h1>` still fails closed.
- TDD: the live-shaped breadcrumb case failed before the repair and passed afterward; a duplicate
  real heading remained `semantic_mismatch`.
- Local gate: 25 files / 503 tests, typecheck, ESLint and production build all passed.
- Runtime configuration again contained only an isolated `DATABASE_PATH` and synthetic unrecorded
  `EVIDENCE_HMAC_KEY`; no LLM/API credential or external model call was used.

The follow-up terminal route was:

`http://127.0.0.1:62124/?flow=cold-start&run=run-4f7b28f7-0335-4374-b37a-a8679baea002&profile=37d9f9f4cc1375ade7f6245c3cbf421481842c13a831123c72ad9cb19f8caf9e`

The same synthetic profile and all six installed navigation pairs produced:

- country coverage `9 / 9`;
- evidence snapshot `run-4f7b28f7-0335-4374-b37a-a8679baea002:evidence`;
- all four coverage groups `verified` and blockers `[]`;
- 11 fresh HTTP 200 artifacts, all sealed;
- 10 Evidence claims: the nine dossier claims plus the CBR EUR/RUB claim;
- immutable `Словения · досье v1` with nine normalized claims;
- `si-companion@2` claim
  `{ access: "conditional", labourMarketCheck: true, informationSheet: true }`;
- `si-income@2` threshold `3361.60 EUR` for period `2026M05`;
- no browser console errors.

The comparator correctly remained yellow rather than fabricating a personal verdict. Its remaining
unknowns are the unconfirmed passport-validity date, unconfirmed health insurance and an FX
effective date outside the applicable assessment window. These are profile/applicability issues,
not incomplete country evidence.

Reloading the exact terminal URL reproduced `9 / 9`, dossier v1, the same snapshot and one marker.
Database counts remained exactly `1 profile / 11 artifacts / 1 evidence snapshot / 1 dossier`, so
reload performed no new official capture.

### Updated readiness conclusion

- Provider-free runtime: **verified**.
- Slovenia current-source dossier publication: **verified**.
- `source-verified: earned` for the declared VS-2 country-evidence scope.
- Personal red/green verdict: **not earned**; the result is honestly yellow for profile and FX
  applicability unknowns.
- Complete Task 4 demo gate: **still partially unearned** because the final run did not preserve a
  separate capture/claim visual frame and physical Tab traversal was not black-box measurable.

The user accepted this exact wording on 2026-08-11. The active readiness status may therefore record
the earned country-evidence scope without upgrading the personal verdict or complete demo gate.
