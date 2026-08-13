# VS-4A City Frontier: широкий каталог, fresh fit и выбор городской ветви

| Поле | Значение |
| --- | --- |
| Статус | `review` — разговорный дизайн одобрен, точный письменный baseline ожидает approval |
| Владелец решения | пользователь проекта |
| Дата | 2026-08-13 |
| Область | City Registry, установленный City Catalog, City Knowledge, ranking, bounded live frontier, terminal shortlist и выбор первой Life Git ветви |
| Зависимости | verified non-empty `Resolved Country Shortlist Snapshot` из `VS-3R`, confirmed profile, provider-free runtime, Evidence pipeline |
| Approval evidence | пользователь одобрил широкий catalog, порог/столицы/top-10, четыре критерия, stop-at-three, full four-fact Knowledge revision, UI и branching в разговорном дизайне 2026-08-13 |
| Written approval | ожидается после проверки этого exact файла |
| Canonical effect after approval | заменяет общее обещание «1–3 города» точной City Frontier semantics; не меняет formal/effective country status |
| Split review | 320-line draft проверен по `CONSTITUTION.md`; сохранён одним документом, потому что catalog, ranking, full-Knowledge и frontier образуют один atomic design contract; tasks/evidence/canonical amendments остаются отдельными |

До approval точной редакции этот документ не изменяет Product Charter, Glossary, Demo Story или
Spec of Specs. После approval он является design baseline отдельного slice; implementation plan и
canonical amendments создаются следующими шагами.

## 1. Цель, результат и граница

`GOAL-CF-01`: для одной effective-green страны из verified non-empty resolved country shortlist
пользователь наблюдает проверку городов в замороженном порядке и получает до трёх selectable
городов либо честное исчерпание установленного каталога.

City Frontier отвечает только на вопрос городского fit. Он не меняет formal residence verdict,
effective country color или решение о риске accepted formal-yellow страны. Город остаётся
selectable, пока свежая сопоставимая официальная проверка не доказала нарушение обязательного
пользовательского критерия.

Результат ограничен установленным официальным City Catalog выбранной страны, exact profile,
City Criteria Snapshot, Knowledge revisions и временем ranking. Он не называется глобальным
списком лучших городов.

## 2. Утверждённые инварианты

1. Entry gate принимает только verified terminal `Resolved Country Shortlist Snapshot` с хотя бы
   одной entry. Выбранная страна обязана входить в entries и иметь reconstructed effective green.
2. Automatic shortlist, working resolution, empty/tampered terminal и effective-red country
   отклоняются. Accepted formal-yellow country разрешена, но её formal status остаётся yellow.
3. Автоматический universe — установленный каталог официальных городских/муниципальных центров,
   не все деревни и не случайная web-выборка.
4. Каталог включает каждый центр с latest comparable official population `>= 20 000`, всегда
   включает национальную и явно типизированные региональные столицы, затем при необходимости
   дополняется крупнейшими сопоставимыми центрами до top-10. Десять — минимум, не максимум.
5. Если официальных сопоставимых центров меньше десяти, включаются все доступные; неполнота
   показывается явно. Missing population не угадывается и не смешивается между urban-center и
   municipal-area definitions.
6. У каждого города есть stable `cityId`; имя, координаты и административные metadata версионируются
   и не являются самим identity.
7. Setup содержит ровно четыре independently configurable критерия: безопасность, долгосрочная
   аренда, городской транспорт и fixed broadband. Для каждого пользователь задаёт mode
   `required | weighted`, exact target и importance `1..5`.
8. Только fresh comparable verified required mismatch исключает город. Required unknown,
   weighted mismatch и любая unknown-причина сами по себе не блокируют выбор.
9. Unknown получает нулевой вклад при сохранённом весе в denominator, снижает coverage и создаёт
   предупреждение. Required-критерий среди non-excluded городов также участвует в score.
10. Ranking охватывает весь установленный catalog, использует только Knowledge revisions на момент
    start и остаётся frozen. Fresh live Knowledge влияет только на следующий run.
11. Live frontier проверяет кандидатов строго в frozen-rank order и завершает все четыре факта для
    каждого активированного города, даже если required mismatch уже найден.
12. Проверенный required mismatch создаёт persistent red marker и replacement. Без такого mismatch
    город selectable: green без unknown либо green с amber warning ring при unknown.
13. Frontier останавливается после трёх selectable городов или доказанного exhaustion. Terminal
    результат `0..2` допустим; выбор разрешён только из terminal result с `1..3` entries.
14. Каждая успешно завершённая live-проверка публикует полную City Knowledge Revision ровно из
    четырёх фактов/statuses. Carry-forward старого value в новую revision запрещён.
15. Выбор города фиксирует показанные unknown warnings как принятый риск без отдельного modal;
    сами facts остаются unknown.
16. Другой город из того же terminal shortlist создаёт sibling Life Git branch от того же pre-city
    parent. Никакой snapshot или прежний выбор не перезаписывается.

## 3. Наблюдаемые requirements

### `REQ-CF-01` — официальный воспроизводимый City Catalog

Installed country package публикует immutable City Catalog Revision, связывающую exact registry
metadata revision, membership, причины включения, population definition/period/value, official
lineage, coverage status и rules version.

Acceptance:

- threshold `20 000` включителен;
- capital override работает независимо от population;
- top-up сортируется по comparable population descending, затем `cityId` ascending;
- наличие более десяти threshold/capital centers не обрезает каталог;
- новая registry/catalog revision влияет только на новый run;
- incomplete coverage никогда не заполняется выдуманным центром.

### `REQ-CF-02` — exact City Criteria Snapshot

Короткий editable setup предзаполняется из profile, но пользователь подтверждает immutable snapshot.
Каждый criterion встречается ровно один раз и ссылается на definition из установленного package.

Definition фиксирует `definitionId`, compatible geo scope, direction `at_least | at_most`, unit,
denominator, freshness policy и evaluator version. Он также содержит exact deterministic normalizer:
domain, zero-score boundary, monotonic distance function и fixture vectors. Evaluator возвращает
factor `[0,1]` и отдельный target comparison; factor монотонно приближается к `1`, достижение target
даёт `1`, улучшение сверх target бонуса не даёт.

Одна универсальная кривая для safety, rent, transit и broadband запрещена: installed package обязан
версионировать normalizer каждой supported definition. Неподдерживаемая
definition/unit/target combination отклоняется до sealing, а не интерпретируется приблизительно.

### `REQ-CF-03` — детерминированный ranking всего catalog

Специализированный City Ranker получает exact Catalog Revision, Criteria Snapshot и current City
Knowledge revision ID либо `null` для каждого member.

```text
score    = sum(importance * factor) / sum(importance)
coverage = sum(importance for fresh comparable verified factors) / sum(importance)
```

Unknown factor равен `0`; его importance остаётся в обеих общих суммах. Comparable weighted miss
остаётся covered. Только separate verified target comparison `does_not_match` required-критерия
создаёт screened exclusion; unknown required остаётся в ordered frontier. Порядок non-excluded:
exact score descending, coverage descending, stable `cityId` ascending. Расчёт использует canonical
decimal arithmetic; display rounding не участвует в order.

Ranking Snapshot хранит factors/contributions, screened exclusions, evaluator versions и полный
frozen order. `ordered + screenedExclusions` обязаны точно покрывать catalog membership. Population
не участвует в score или tie-break ranking. Screened exclusions доступны в audit, но не изображаются
как live red markers, поскольку не были активированы и свежо проверены.

### `REQ-CF-04` — bounded fresh four-fact verification

Start создаёт ranking/frontier без official HTTP. Только явный Continue проверяет следующий frozen
candidate через установленный source plan. Внутренние source subchecks могут выполняться
параллельно, но city completion возможен только после closed outcome всех четырёх критериев.

Для каждого факта результат ровно один:

- `verified` с comparable typed value;
- `unknown` с причиной `not_found | stale | conflict | not_comparable | source_unavailable`.

Unknown допустим только после sealed Evidence, подтверждающего bounded official attempts и outcome.
Crash, cancel, protocol, storage, integrity или unexpected application failure не превращаются в
domain unknown, не публикуют Knowledge Revision и не двигают frontier cursor.

После verified Evidence и полной Knowledge Revision Application повторно оценивает required
targets: mismatch даёт red, иначе city selectable. Marker/frontier successor публикуется только
после durable Knowledge publication. Законно опубликованные Evidence/Knowledge не откатываются,
если последующий frontier append сорвался; retry обязан переиспользовать exact completed check.

### `REQ-CF-05` — полный append-only City Knowledge

City Knowledge не хранит raw source bytes, user target/weight, score или вывод «подходит».
Revision-level поля:

- city/package/schema/rules IDs, predecessor ID и exact Evidence Snapshot ID;
- `lastCheckedAt` — canonical instant завершения всей четырёхфактной проверки;
- `knowledgeUpdatedAt` — последний момент изменения semantic four-fact projection;
- `createdAt` и integrity envelope.

Каждый из четырёх fact rows хранит только различающиеся поля: criterion/definition ID, geo scope,
reference period, freshness-policy basis, unit, denominator, value либо unknown reason и Evidence
references. Per-fact `lastCheckedAt`, `knowledgeUpdatedAt` и capture timestamp отсутствуют; подробные
source times остаются в Evidence Snapshot.

Первая revision получает `knowledgeUpdatedAt = lastCheckedAt`. Для successor сравниваются
definition, geo scope, reference period, freshness basis, unit, denominator и value/status/reason
всех четырёх facts. Evidence refs, revision/provenance IDs и timestamps не входят в semantic
comparison. При равенстве переносится predecessor `knowledgeUpdatedAt`; при отличии он становится
новым `lastCheckedAt`. Всегда `knowledgeUpdatedAt <= lastCheckedAt <= createdAt`.

Freshness не хранится как вечный ярлык. Ranking evaluator применяет versioned freshness policy к
reference period и `assessmentAt`; старое verified value может стать ranking-time unknown `stale`.
Live check, не подтвердивший current fact, публикует explicit unknown вместо переноса прошлого value.

### `REQ-CF-06` — terminal shortlist и правдивое представление

Frontier revision chain хранит source bindings, completed live markers в activation order, frozen
cursor и selectable slots. Terminal City Shortlist Snapshot публикуется ровно при трёх selectable
либо exhaustion и содержит entries в frozen-rank order с exact Knowledge/Evidence lineage.

До terminal seal CTA выбора отсутствует. UI показывает:

- gray `Проверяется` для active candidate;
- green `Доступен для выбора` без unknown;
- тот же green с amber warning ring и explicit warning list при unknown;
- red `Исключён` только при fresh verified required mismatch.

Цвет всегда дублируется текстом/icon. Card различает frozen `rank/score на момент старта` и fresh
facts/`coverage после проверки`. Второй aggregate score после live check не вычисляется.

### `REQ-CF-07` — выбор и первая альтернативная Life Git ветвь

Select command принимает terminal shortlist ID, `cityId`, command ID и, только для non-empty
warning basis, warning-copy version. Сервер сам реконструирует selectability, canonical displayed
unknown basis и branch parent; клиент не присылает facts, risk basis или parent ID.

Нажатие `Выбрать город` при non-empty warning basis является явным принятием ровно показанных
unknown warnings; при полном verified coverage risk acceptance отсутствует. Операция атомарно
публикует City Selection Snapshot и City Branch Commit.

City Frontier Start идемпотентно создаёт либо загружает verified `PreCityBranchCommit`, который
фиксирует общий profile/resolved-country context до выбора города; Ranking и Terminal snapshots
связываются с его ID. Terminal City Shortlist является отдельным immutable assessment input, а не
подменой branch parent. Выборы A и B из одного terminal получают одинаковые
`parentId/forkedFrom = preCityBranchCommitId` и являются sibling commits. Selection snapshot
связывает profile, resolved-country entry, criteria, selected terminal marker, exact
Knowledge/Evidence, warnings и optional copy version.

## 4. Основные сценарии

- `SCN-CF-01 Catalog`: все `>=20k`, capital below threshold и largest fillers входят; 14 threshold
  cities не обрезаются; missing population делает coverage incomplete.
- `SCN-CF-02 Ranking unknown`: unknown даёт zero contribution и меньшую coverage, но остаётся в
  queue; comparable required mismatch попадает только в screened exclusions.
- `SCN-CF-03 Fresh replacement`: первый live city проходит все четыре checks, получает required
  mismatch и persistent red; следующий frozen candidate заполняет слот.
- `SCN-CF-04 Selectable unknown`: один или все четыре facts unknown; city остаётся green с amber
  ring, занимает slot, а selection фиксирует warning basis.
- `SCN-CF-05 Revalidation`: одинаковая projection создаёт successor с новым `lastCheckedAt` и прежним
  `knowledgeUpdatedAt`; known-to-unknown не переносит value и обновляет `knowledgeUpdatedAt`.
- `SCN-CF-06 Failure boundary`: evidence-backed bounded source exhaustion публикует unknown;
  crash/cancel/storage/integrity failure не публикует revision и retry начинает с того же city.
- `SCN-CF-07 Frozen order`: live Knowledge меняет fresh facts/coverage, но не rank/score текущего run.
- `SCN-CF-08 Exhaustion`: terminal с двумя selectable разрешает выбор; terminal с нулём не создаёт
  selection и не открывает `VS-4`.
- `SCN-CF-09 Alternative branch`: A, затем B из одного terminal создают две sibling branches от
  одного pre-city parent.
- `SCN-CF-10 Offline replay`: reload восстанавливает committed cursor, markers, terminal и selections
  без official HTTP; accepted-yellow country остаётся formal yellow/effective green.

## 5. Архитектурные границы

```text
verified Resolved Country Shortlist entry
  -> confirmed City Criteria Snapshot
  -> immutable City Catalog + current City Knowledge set
  -> Decision City Ranker -> frozen City Ranking Snapshot
  -> Application City Frontier -> bounded City Research/Evidence
  -> full append-only City Knowledge Revision per checked city
  -> append-only City Frontier revisions -> Terminal City Shortlist
  -> atomic City Selection Snapshot + sibling Life Git branch
```

- **Decision** владеет criteria validation, catalog membership reconstruction, exact factor math,
  screened exclusions, selectability, stop condition и warning-basis reconstruction. Он не читает
  SQLite, HTTP, raw Evidence или React.
- **Research** владеет installed country package, official source plans, typed validators, Evidence
  capture и builder полной four-fact Knowledge projection. Package без reviewable official plan для
  всех четырёх criteria не считается установленным.
- **Application** владеет confirm/start/continue/present/select use cases, cross-aggregate graph и
  commit ordering. Только Continue вызывает official source port.
- **Infrastructure** хранит Registry/Catalog, Evidence, Knowledge, Criteria, Ranking, Frontier,
  Terminal, Selection и Branch append-only. Raw bytes доступны только Evidence storage.
- **Experience** принимает strict read models/finite NDJSON events и только проецирует frozen/fresh
  labels, markers, warnings и controls. Существующий globe instance/history/focus/reduced-motion
  patterns переиспользуются без новой карты.
- **Branch** получает отдельный City Branch contract. Housing-specific payload существующего Life
  Git не расширяется невалидным union и не используется как City Knowledge/Selection storage.

`PlaceRanker@1` и Country Knowledge carry-forward contract не переиспользуются: их unknown scoring
и partial-update semantics прямо несовместимы с этим slice.

## 6. Persistence, integrity и recovery

Каждый durable snapshot имеет closed schema, canonical JSON, content/context hash, integrity HMAC,
exact source IDs и immutable UPDATE/DELETE guards. Linear chains используют expected predecessor,
один successor/head и запрещают successor после terminal.

Команда определяется `(runId, commandId, canonical payload)`: identical retry возвращает прежний
result; тот же ID с другим payload даёт `integrity_mismatch`; новый command от stale head даёт
conflict. City Knowledge publication для одного city сериализована; параллельные writers не создают
forked revisions.

Verified load реконструирует catalog membership, criteria, ranking/exclusions, marker prefix,
cursor, stop condition, four-fact Knowledge semantics, warning basis и branch lineage. Подмена
country, city, catalog, criteria, predecessor, Evidence/Knowledge reference, marker или terminal
composition fail-closed.

Presentation/reload/select не выполняют official HTTP. После transport loss committed marker
остаётся; reload показывает verified head и explicit Continue. Неподтверждённый live progress не
восстанавливается как факт. Retry продолжает frozen cursor и не проверяет committed city повторно.

## 7. Verification и acceptance gate

Минимальный обязательный набор:

- pure tests порога/capitals/top-10, exact formula/unknown/required/tie-break и stop table;
- package fixture vectors для всех четырёх definitions, directions, boundaries и freshness policies;
- full revision tests: 4/4 facts, no carry-forward, same-value revalidation, known-to-unknown и
  source-failure-vs-crash boundary;
- ranking snapshot reconstruction, catalog union, screened exclusions и no-current-run-rerank;
- frontier replacement, persistent red, selectable unknown, three/exhaustion `0..2`, abort/retry;
- append-only/hash/HMAC/predecessor/idempotency/concurrency/tamper matrices;
- strict transport, EOF-held terminal, committed-before-event, zero-network double presentation;
- UI/accessibility tests gray/green/amber/red, warning acceptance, frozen-vs-fresh labels and same globe;
- selection eligibility, exact risk binding, atomic selection+branch and sibling alternatives;
- full typecheck, lint, tests, production build, diff/provider audits and an official-source walkthrough
  on an isolated database before `source-verified` evidence.

Первый production slice устанавливает ровно один country package с reviewable official catalog и
four-criterion source plan. Если package не может доказать catalog rule или выдать deterministic
definition/validator fixtures для всех четырёх criteria, City Frontier для этой страны остаётся
explicitly unavailable; фиктивные data или generic crawler запрещены.

## 8. Явные не-цели

- Все деревни/посёлки и manual/custom small-place flow.
- Universal city crawler, worldwide metric ontology или автоматическое восстановление любого сайта.
- Random/famous-city fallback при incomplete official coverage.
- Изменение country formal/effective status из city fit.
- Выбор до terminal, отдельный risk modal или city-yellow marker.
- Rerank и второй aggregate score после fresh live checks.
- Raw official bytes, user preferences, score или suitability verdict в City Knowledge.
- Работа, жильё, бюджет, projections и полный Life Git diff UI из `VS-4`.
- Background queue, worker fleet, event store, graph DB, provider SDK или runtime LLM.

## 9. Canonical amendments после written approval

Change-package обязан узко обновить Product Charter, Glossary, Demo Story, Spec of Specs и docs
index: exact 3-or-exhaustion stop, selectable-only-on-verified-required-mismatch, wide catalog,
full four-fact City Knowledge, marker semantics и City Selection sibling branches. Исторические
approved `VS-3`/`VS-3R` specs и evidence не переписываются.

## 10. Approval gate

Conversational decisions зафиксированы, но exact written baseline ещё не approved. После user
approval следующая допустимая операция — создать detailed implementation plan через
`writing-plans`. До этого запрещены production code, schema, test scaffolding, source installation и
canonical amendments.
