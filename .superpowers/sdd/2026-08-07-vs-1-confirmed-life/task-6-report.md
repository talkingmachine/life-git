# Task 6 report: Visual journey, Evidence Passport and bounded narrative

## Scope

- Original Task 6 base: `29227d6b8d8955cece3dc799fad73a4e8ce0b182`; review-fix base: `fad3e8c`.
- Реализован только VS-1 Task 6: русский visual-first маршрут Россия → Тирана для одного
  заранее выбранного кандидата, presentation contract, пять server actions, бюджетная ветка,
  Evidence Passport и bounded OpenAI narrative.
- Не добавлены map SDK, generic design system, ORM, очереди, глобальный поиск/рейтинг,
  клиентские verdict/calculation, Task 7, browser/network tooling, push, PR или merge.

## TDD evidence

1. Confirmation/map RED: отсутствовали `ProfileCard` и `ResearchMap`. GREEN: явное подтверждение
   user/scenario conditions до действия; full-height gray pending; самолёт Россия → Тирана;
   один marker с icon + visible label.
2. State RED: green оставлял полную карту, yellow/red не имели доступной причины/retry.
   GREEN: scoped green copy (`предварительно совместим`, `проверено в заявленном scope`) без
   popover; native buttons раскрывают краткую причину и официальный link; Enter/Space работают;
   yellow retry создаёт новый run/snapshot, старый остаётся byte-equal.
3. Truth-flow RED: branch transition красил карту gray, retry не показывал pending, profile
   называл user inputs официально подтверждёнными. GREEN: research/branch pending разделены;
   profile различает user input, scenario и official proof; no-companion не превращается в пару.
4. Budget/Passport RED: отсутствовали visual budget, six-class passport и causal diff.
   GREEN: серверные Decimal strings показаны без client math; taxes/living остаются unknown;
   native expandable Passport содержит official fact, user fact, calculation, assumption,
   family-only projection и unknown; verified/source-blocker links и calculation lineage видимы.
5. Life Git RED: application не предоставлял verified rewind/fork presentation flow.
   GREEN: реальный `save C0(70000) → rewind → fork C1(90000)` возвращает server-produced
   housing-only diff, C0 не мутируется, profile/evidence/rules переиспользованы явно.
6. Narrative RED: отсутствовали `NarrativePort`, `presentRun` и OpenAI adapter. GREEN:
   `gpt-5.6`, local `openai@7.4.0` `responses.parse`, `zodTextFormat`, `output_parsed`,
   `store:false`, `tools:[]`, `{timeout:8000,maxRetries:0}`; missing key, timeout/error,
   refusal, invalid schema, unknown returned claim ID или digit дают один deterministic fallback.
7. Composition/action RED: отсутствовал RunDetails-only journey и строгие public boundaries.
   GREEN: page и все action outputs используют serializable `RunDetails`; exported action surface
   ровно из start/retry/save/rewind/fork; draft/IDs/decimal fail before composition; C0 save
   принимает только runId и читает HMAC-bound housing на сервере.
8. Independent-review RED: после C1 кнопка «Перемотать к C0» передавала текущий C1 cursor.
   GREEN: presentation contract отдельно несёт исходный cursor, UI сохраняет его через fork и
   regression test доказывает, что rewind получает именно исходный C0 commit ID.

## Architecture and truth boundaries

- `presentRun` копирует `RunDetailsCore` и добавляет narrative; в модель уходят только JSON-parsed
  typed official claim values/IDs. Profile, free text, assessment, budget и calculation не уходят.
- Narrative никогда не меняет evidence, assessment, budget или hashes; malformed/model failure
  меняет только `RunDetails.narrative` на state-agnostic русский fallback.
- Experience получает один JSON-serializable `RunDetails`; не импортирует SQLite, stores, raw
  artifacts, research ports или Decimal. Verdict marker всегда приходит из Assessment.
- Budget presentation использует сохранённый server calculation. Три native meter получают
  exact server value/max strings без client arithmetic. Taxes и living costs представлены и в
  flow, и как unmodelled unknown.
- `saveInitialHousingBranch(runId)` не принимает housing/income/rates. Fork принимает только strict
  verified cursor и strict ALL decimal; server application рассчитывает C1 и causal diff.
- Green не утверждает, что Тирана «подтверждена», безопасна или лучшая; scope всегда видим.
  Yellow/red reasons открываются native controls и ведут на сохранённый официальный URL.
- Local `public/world-map.svg`, CSS airplane/loading indicator и reduced-motion заменяют map SDK.

## Review-fix round

- Happy path теперь начинается на `/`: strict synthetic form + explicit confirmation вызывает
  реальный `startConfirmedLife`; состояние gray существует ровно пока не завершён Promise, после
  чего рендерится terminal `RunDetails`. Успешные start/retry сохраняют safely encoded server runId
  в `?run=`; ошибки сохраняют прежний снимок и показываются как visible alert.
- Read-only ProfileCard показывает exact housing, `monthlyIncomeRub`, income basis, resources и
  companion scenario как user/scenario data. C0 предлагается только при green; lawful-stay row и
  клиентское подтверждение официальных требований удалены.
- Sealed coverage больше не равна semantic acceptance: application projection валидирует точные
  schemas/locators/periods и направляет только accepted claims в Assessment, Passport и narrative.
  Семантически ложный sealed source становится `unknown/source_unavailable/semantic_mismatch`.
- Critical source bundle (law, decision, Tirana, CBR, BoA) проверяется до red business rule;
  outage/stale/conflict/invalid всегда дают yellow. Каждая AssessmentReason несёт exact sourceId и
  blockerKind, поэтому UI не угадывает lineage по claim code.
- Final-review RED показал, что verified resource threshold мог маскировать CBR/BoA outage при
  одновременном local-employer mismatch. GREEN перенёс весь critical-source preflight до business
  rules; focused assessment/composition regression прошёл 47/47.
- Model возвращает только phrase IDs + supporting claim IDs. Application владеет fixed copy,
  отклоняет free prose/лишние ключи/unknown claims и разрешает `unknowns_explicit` только при
  фактическом unknown evidence item.
- Branch presentation orchestration перенесён в application `present-journey`; composition root
  только связывает stores/use cases. C2 нельзя создать напрямую: server и UI требуют исходный C0.
- Evidence Passport группирует claims по official source, показывает human summary и link первым,
  а raw JSON/claim IDs/anchors/blocker codes — только во вложенных technical details.

## Gates and self-review

- Focused final assessment/composition gate: 47 tests, 2 files, 0 failures.
- Full Vitest: 211 tests, 14 files, 0 failures.
- TypeScript `tsc --noEmit`: PASS.
- ESLint: PASS.
- Next 16.3.0 production build: PASS; `/` dynamic and `/_not-found` static.
- `git diff --check`: PASS.
- Review-fix journey/application gates: 28/28 experience/action, 40/40 presentation/composition,
  23/23 Passport/budget, and 47/47 assessment/composition: PASS.
- Next-generated `next-env.d.ts`, tsbuild info and automatic tsconfig rewrites were removed/restored
  after build evidence; intentional tsconfig change is limited to DOM libs needed by React UI.
- No browser/network was used. No push, PR, merge or trunk operation was performed.
