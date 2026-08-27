# Change: VS-2 «Честный cold start»

| Поле | Значение |
| --- | --- |
| Статус | `approved` |
| Владелец решения | пользователь проекта |
| Последняя проверка | 2026-08-11 |
| Область ответственности | JIT baseline одного schema-gated cold start, публикации country dossier и отдельного comparator |
| Supersedes | нет |
| Зависимости | [`CONSTITUTION`](../../../CONSTITUTION.md), [`Spec of Specs`](../../../architecture/spec-of-specs.md), [`ADR-001`](../../../decisions/ADR-001-modular-monolith.md), [`VS-1`](../vs-1-confirmed-life/change.md) |
| Approval | пользователь проекта / 2026-08-11 / VS-2 exact-text baseline / approved |
| Implementation evidence | [provider-free current-source walkthrough](./implementation-evidence.md) / пользователь подтвердил 2026-08-11 |
| Provider-free runtime | `verified` |
| Source verification | `earned` — provider-free current-source run подтвердил `9 / 9`, четыре verified coverage-группы, `blockers: []` и immutable Slovenia dossier v1 |
| Demo gate | `partially earned` — final-HEAD capture/claim frame и физический Tab не подтверждены black-box наблюдением |

## 1. Почему и какой результат

`GOAL-VS2-01`: пользователь вводит поддерживаемую страну без глубокого dossier и получает
видимую проверку официальных источников. Полное критическое покрытие публикует неизменяемую версию
dossier и comparator; недостаточное завершается объяснимым yellow без публикации.

Канонический случай — Словения: страна и official authority roots известны Country Registry, но
dossier перед прогоном отсутствует. Это доказывает cold start, а не заранее подготовленную карточку.

## 2. Scope и не-цели

В scope:

- ввод одной registry-supported страны без dossier и один current-run research plan;
- installed navigation candidates из Country Source Index внутри подтверждённых official authority
  roots, capture, schema-gated extraction, versioned validation, sealing и атомарная публикация dossier;
- девять claim kinds: route basis, citizenship applicability, remote-work relations, income,
  qualification, companion entry/local-work access, duration и general statutory prerequisites
  (passport validity, insurance, applicable Art. 55 refusal grounds);
- персональный route assessment, отдельная comparator card и visual progress на полной карте;
- повторное использование gateway, raw store, HMAC Evidence Snapshot, replay и synthetic profile VS-1.

Не входят top-5, ranking, десять starter dossiers, city verification, safety, infrastructure,
housing, salary catalogue и life simulation: это `VS-3..VS-4`. Также не входят universal crawler,
автоматическая поддержка любого сайта, runtime-перезапись файлов репозитория, queue, worker,
WebSocket, event store, rules/knowledge-base platform и multi-provider abstraction. Страна без
подтверждённого authority root или поддержанного claim validator честно заканчивается yellow.

## 3. Каноническая official-source navigation

Feasibility 2026-08-11 выбрал Словению из-за нового с 21 ноября 2025 года маршрута и раздельной
официальной legal/statistical chain:

- [GOV.SI: temporary residence permit for digital nomads](https://www.gov.si/en/news/2025-11-21-temporary-residence-permit-for-digital-nomads/) — официальная навигация по маршруту;
- [PISRS: ZTuj-2, включая Art. 51a](https://pisrs.si/Pis.web/pregledPredpisa?id=ZAKO5761&print=1) — консолидированный нормативный текст;
- [PISRS: пример последней net salary](https://pisrs.si/pregledPredpisa?sop=2026-01-1950) и [SiStat API](https://pxweb.stat.si/SiStatData/pxweb/en/Data/-/H285S.px/) — dated value для `2 × latest official average net salary`;
- [ESS: employment with a non-work residence permit](https://www.ess.gov.si/delodajalci/zaposlovanje-tujcev-iz-tretjih-drzav/zaposlitev-tujcev-z-dovoljenjem-za-prebivanje/) и
  [PISRS: ZZSDT Arts. 32–33](https://pisrs.si/Pis.web/pregledPredpisa?id=ZAKO6655) — conditional local employment через labour-market check и information sheet.

Это feasibility navigation, не runtime evidence. Каждый run captures полный official listing/series
и выбирает максимальный publication/effective period `<= assessmentAt`; incomplete, paginated или
ambiguous listing даёт yellow. Затем проверяются nationality overlays, companion rules и exact
bytes/anchors; изменившийся selector или неполная source chain также дают yellow.

Companion claim ограничен словенским рынком труда: из family permit + Arts. 32–33 следует не
automatic free access, а conditional local employment. Remote-работа спутника на иностранную
компанию из этих норм не выводится и остаётся отдельным будущим employment choice.

## 4. Requirements и acceptance

- `REQ-VS2-01` (`GOAL-VS2-01`; `SCN-VS2-01`, `SCN-VS2-02`): ввод страны без dossier создаёт новый
  run и full-screen gray marker; UI получает typed progress до terminal result.
  Acceptance: input нормализован в ISO country; неизвестный/unsupported ввод не создаёт dossier.
- `REQ-VS2-02` (`GOAL-VS2-01`; `SCN-VS2-01`, `SCN-VS2-02`): Research подтверждает authority,
  captures exact content и публикует dossier только при verified coverage всех девяти claim kinds.
  Acceptance: complete listing/max period и каждый claim связаны с source, exact anchor и validator
  version; installed navigation не является claim; incomplete/conflict/stale/invalid coverage не
  создаёт version.
- `REQ-VS2-03` (`GOAL-VS2-01`; `SCN-VS2-01`, `SCN-VS2-04`): опубликованный dossier оценивается
  только относительно exact Profile/Evidence Snapshot и показывается отдельным comparator.
  Acceptance: verified veto даёт red с формулой и official links; route-compatible без verified city
  виден в comparator, но marker остаётся yellow до `VS-3`; неподтверждённый personal prerequisite
  не превращается в pass.
- `REQ-VS2-04` (`GOAL-VS2-01`; `SCN-VS2-01`, `SCN-VS2-02`): пользователь видит проверяемый журнал
  этапов, blockers и provenance, но не скрытые chain-of-thought модели.
  Acceptance: status понятен без цвета и с клавиатуры; source details доступны по red/yellow и card.
- `REQ-VS2-05` (`GOAL-VS2-01`; `SCN-VS2-03`): dossier versions и sealed snapshots append-only;
  historical replay не использует сеть, а новый current check создаёт новый run.
  Acceptance: replay дважды даёт exact dossier/comparator; старые bytes/version не меняются.

## 5. Scenarios

- `SCN-VS2-01 Slovenia cold start`: dossier отсутствует; пользователь вводит Словению; marker gray,
  UI последовательно показывает installed navigation, authority, capture, claims и publication. Полное coverage
  публикует `SI v1`; текущий synthetic profile получает red, когда live official formula и current
  CBR FX доказывают недостаточный доход. Карта сворачивается, отдельный comparator остаётся видим.
- `SCN-VS2-02 Fail closed/retry`: unofficial redirect, semantic mismatch, stale source, conflict или
  исчерпанный budget завершают run yellow с кратким blocker и ссылкой, если она official. Dossier не
  публикуется; retry создаёт новый run/snapshot и не меняет предыдущий.
- `SCN-VS2-03 Replay/update`: offline replay проверяет HMAC/raw hashes и versioned validators без
  сети. Новый live run с тем же normalized dossier hash переиспользует version; изменившиеся
  verified claims публикуют следующую version с predecessor, старая остаётся читаемой.
- `SCN-VS2-04 Route-compatible`: другой подтверждённый profile проходит country-level rules.
  Comparator показывает `route-compatible`; marker остаётся yellow с причиной «город ещё не
  проверен», а green не публикуется до `VS-3`.

## 6. Dossier и marker semantics

`DossierVersion` разрешено публиковать независимо от персонального результата: red означает
verified несоответствие пользователя, а не провал исследования. Dossier содержит country facts,
но не profile, personal verdict или FX conversion.

| State | Terminal meaning |
| --- | --- |
| `gray` | Проверка идёт; dossier/verdict ещё нет. |
| `red` | Опубликованный evidence плюс confirmed profile доказывают country-level veto; причина, формула и official links раскрываются. |
| `yellow` | Нет персонального verdict: critical evidence missing/stale/conflicting/invalid либо country route-compatible, но city ещё не verified. |
| `green` | В `VS-2` недостижим: cross-slice invariant требует хотя бы один confirmed city. |

- `INV-VS2-01`: только full-coverage sealed Evidence Snapshot разрешает публикацию dossier.
- `INV-VS2-02`: dossier не содержит profile/verdict, неизменяем и idempotent по country/schema/payload hash.
- `INV-VS2-03`: verified personal veto даёт red; missing/conflict дают yellow; green требует confirmed city.
- `INV-VS2-04`: Country Source Index не получает PII и не может опубликовать source, claim или verdict.
- `INV-VS2-05`: UI progress следует только фактически полученным typed events, а не таймеру.

## 7. Architecture и data flow

Один modular-monolith pipeline:

```text
country input
  -> Country Registry
  -> CountrySourceIndexPort
  -> ResearchPlan
  -> existing capture gateway/raw store
  -> ClaimValidationRegistry
  -> sealed Evidence Snapshot
  -> optional DossierPublisher
  -> Decision assessment
  -> comparator/read model
```

- `Country Registry` хранит ISO/name и проверенные authority roots, но не подменяет dossier.
- `CountrySourceIndexPort` синхронно возвращает установленные reviewable navigation candidates по
  точному ISO country code; profile/PII и free text ему недоступны.
- `ResearchPlan` владеет plan/source/parser/schema versions и replaces fixed Albania source array.
- `ClaimValidationRegistry` принимает только typed claim schemas и отдельно проверяет authority
  chain, captured bytes, locator, period, applicability и numeric value. Неподдержанная семантика
  остаётся blocker.
- `DossierPublisher` атомарно публикует только full-coverage sealed snapshot; Decision и Experience
  не могут вызвать запись в обход Research.
- `ColdStartApplication` координирует use case; модули напрямую друг друга не вызывают.

| Port | Contract |
| --- | --- |
| `PORT-VS2-SOURCE-INDEX` | Exact ISO country code -> installed immutable navigation candidates; no profile/PII/free text. |
| `PORT-VS2-VALIDATION` | Captured candidate + installed schema/version -> typed claim or blocker. |
| `PORT-VS2-PUBLISHER` | Full-coverage sealed snapshot -> immutable version or idempotent existing version. |
| `PORT-VS2-COMPARATOR` | Profile + current evidence + dossier version -> typed personal assessment/comparator. |
| `PORT-VS2-STREAM` | One run -> ordered typed progress plus one terminal assessment when the response completes. |

Один streaming HTTP response передаёт union событий `source_discovered -> authority_verified ->
artifact_captured -> claim_verified -> dossier_published? -> assessment_completed`. Последнее
событие всегда terminal; `dossier_published` отсутствует для blocked run. Disconnect до commit
отменяет работу без dossier; после атомарного commit version не откатывается, а terminal assessment
сохраняется для reload. Частичная publication невозможна.

## 8. Boundary values, persistence и ADR-VS2-01

Versioned values: `CountryRef`, `ClaimKind`, typed `ClaimValue`, `SourceCandidate`, `ResearchPlan`,
`DossierVersion`, `ColdStartEvent` и `Comparator`. Dynamic IDs и plans разрешены; неструктурированный
`Record<string, unknown>` для facts запрещён.

SQLite получает одну append-only таблицу `dossier_versions`: `id`, `country_code`, nullable
`predecessor_id`, `evidence_snapshot_id`, `schema_version`, normalized payload hash, manifest
hash/HMAC и `published_at`. Evidence manifest версии служит source navigation; отдельная source DB
не создаётся. Payload включает typed claims, source periods/navigation и validator versions, но не
retrieval timestamp/profile: новый source сохраняется, идентичный rerun не создаёт version, а его
current-run evidence всё равно сохраняется.

`ADR-VS2-01` (`accepted`): выбран schema-gated cold start. Альтернативы — curated-only dossiers
(`rejected`: не доказывает новое место) и универсальный autonomous crawler (`rejected`: невозможно
честно гарантировать семантику и scope конкурса). Последствие: canonical Slovenia path работает
end-to-end; другая страна может закончиться explicit unsupported yellow, пока нет валидатора.

## 9. Failure, security и bounded recovery

- `NFR-VS2-01`: принимается только HTTPS candidate из Registry root или подтверждённой official cross-link chain;
  redirects обязаны остаться в разрешённой цепочке hosts.
- HTTP/MIME/size/parser/schema/freshness/applicability/integrity failures типизированы; конфликт
  официальных применимых sources даёт yellow, выбор «удобного» значения запрещён.
- Отсутствие diploma rule формулируется `not_listed_in_authoritative_requirements`; net/gross не
  конвертируются эвристикой. FX берётся только из dated official adapter.
- `NFR-VS2-02`: source content считается недоверенными данными, не инструкциями. Country Source Index
  не получает profile; operational logs/events не содержат PII или user free text.
- `NFR-VS2-03`: total budget 60 seconds; до 6 installed candidates, 11 captures, concurrency 3, один retry только для
  timeout/429/5xx и 30 MiB на artifact; runtime model calls равны нулю.
- Отсутствие полного installed index, отсутствие official candidates или исчерпание budget дают yellow. Client
  abort до dossier commit отменяет run без version; после commit version не откатывается и terminal
  assessment сохраняется. Retry создаёт новый run. Unsealed raw может остаться внутренним
  unreferenced audit artifact, но не Evidence/dossier.
- `NFR-VS2-04`: запрещены второй pipeline и перечисленные в scope generic/background abstractions;
  unsupported case завершается явно, а не новой обходной подсистемой.

## 10. Visual/read-model contract

Карта занимает экран до `assessment_completed`. Marker и timeline показывают те же typed events:
«источники найдены → официальность подтверждена → документы сохранены → факты проверены → dossier
опубликован → применимость рассчитана». Они не симулируют прогресс таймерами.

Red раскрывает краткий verified veto, formula lineage и official links; yellow — blocker/retry.
Comparator всегда показывает country/city scope, dossier version, checkedAt, coverage и personal
fit, а также пометку «исследовано отдельно от top-5». Цвет дублируется icon/text и live region.

## 11. Tests, evals и traceability

Не более трёх logical groups: `TEST-VS2-RESEARCH`, `TEST-VS2-INTEGRATION`, `TEST-VS2-EXPERIENCE`.
Страны и layout-комбинации не образуют exhaustive matrix.

- `EVAL-VS2-01 Live Slovenia`: no dossier -> complete listing/max applicable period -> sealed full
  coverage -> `v1` -> formula-backed comparator/red, пока live threshold выше current income.
- `EVAL-VS2-02 No false publication`: unofficial/semantic/conflict representative cases дают
  yellow, zero new dossier rows и понятный blocker.
- `EVAL-VS2-03 Replay/immutability`: два zero-network replay совпадают; tamper rejected; same hash
  idempotent, changed verified claims create `v2` without modifying `v1`.
- `EVAL-VS2-04 Privacy/visual truth`: installed index/event payloads не содержат profile/PII; один
  provider-free browser E2E проверяет real event progress, icon/text states, red details и comparator.

| REQ | SCN | INV/ADR | PORT | TEST/EVAL |
| --- | --- | --- | --- | --- |
| `REQ-VS2-01` | `SCN-VS2-01`; `SCN-VS2-02` | `INV-VS2-05`; `ADR-VS2-01` | `PORT-VS2-SOURCE-INDEX`; `PORT-VS2-STREAM` | `TEST-VS2-INTEGRATION`; `EVAL-VS2-01`; `EVAL-VS2-02` |
| `REQ-VS2-02` | `SCN-VS2-01`; `SCN-VS2-02` | `INV-VS2-01`; `INV-VS2-04`; `ADR-VS2-01` | `PORT-VS2-SOURCE-INDEX`; `PORT-VS2-VALIDATION`; `PORT-VS2-PUBLISHER` | `TEST-VS2-RESEARCH`; `EVAL-VS2-01`; `EVAL-VS2-02` |
| `REQ-VS2-03` | `SCN-VS2-01`; `SCN-VS2-04` | `INV-VS2-02`; `INV-VS2-03`; `ADR-VS2-01` | `PORT-VS2-PUBLISHER`; `PORT-VS2-COMPARATOR` | `TEST-VS2-INTEGRATION`; `EVAL-VS2-01`; `EVAL-VS2-04` |
| `REQ-VS2-04` | `SCN-VS2-01`; `SCN-VS2-02` | `INV-VS2-04`; `INV-VS2-05` | `PORT-VS2-STREAM` | `TEST-VS2-EXPERIENCE`; `EVAL-VS2-04` |
| `REQ-VS2-05` | `SCN-VS2-03` | `INV-VS2-01`; `INV-VS2-02` | `PORT-VS2-PUBLISHER` | `TEST-VS2-INTEGRATION`; `EVAL-VS2-03` |

NFR trace: `NFR-VS2-01`; `NFR-VS2-02`; `NFR-VS2-03` -> `TEST-VS2-RESEARCH`,
`TEST-VS2-INTEGRATION`, `EVAL-VS2-02`, `EVAL-VS2-04`; `NFR-VS2-04` -> structural review.

## 12. Ordered tasks и approval gate

1. `TASK-VS2-01` `[REQ-VS2-01; REQ-VS2-02]` Generalize fixed source IDs into typed ResearchPlan and
   claim schemas without breaking VS-1 replay.
2. `TASK-VS2-02` `[REQ-VS2-02]` Add Registry/installed source index and only Slovenia validators/source path.
3. `TASK-VS2-03` `[REQ-VS2-02; REQ-VS2-05]` Add append-only publisher/store, integrity and replay.
4. `TASK-VS2-04` `[REQ-VS2-03]` Add personal decision/comparator and current official FX lineage.
5. `TASK-VS2-05` `[REQ-VS2-01; REQ-VS2-04]` Add streaming use case, map progress and comparator UI.
6. `TASK-VS2-06` `[REQ-VS2-01; REQ-VS2-02; REQ-VS2-03; REQ-VS2-04; REQ-VS2-05]` Remove external
   LLM/config surface, run the provider-free local gate, then obtain fresh permission for one
   current-source browser E2E and save truthful implementation evidence.

`BACKLOG-EXT-LLM-01`: после защиты и до монетизации внешний LLM-assisted discovery требует
отдельного approved change package. До этого в runtime нет provider SDK, credential, abstraction,
feature flag или replacement eval subsystem.

Validation перед implementation planning:

- [x] directional design approved section-by-section 2026-08-11;
- [x] self-review: no placeholders, contradictions, orphan requirements or expanded subsystem;
- [x] пользователь подтвердил точную редакцию этого файла 2026-08-11.

Baseline допущен к implementation planning; `source-verified` и `demo-verified` требуют runtime evidence.
