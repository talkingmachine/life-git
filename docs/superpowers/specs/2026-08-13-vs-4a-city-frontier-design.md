# VS-4A City Frontier: широкий каталог, fresh fit и выбор городской ветви

| Поле | Значение |
| --- | --- |
| Статус | `approved` — разговорный дизайн и точный письменный baseline одобрены пользователем |
| Владелец решения | пользователь проекта |
| Дата | 2026-08-13 |
| Область | City Registry, установленный City Catalog, City Knowledge, ranking, bounded live frontier, terminal shortlist и выбор первой Life Git ветви |
| Зависимости | verified non-empty `Resolved Country Shortlist Snapshot` из `VS-3R`, confirmed profile, provider-free runtime, Evidence pipeline |
| Approval evidence | пользователь одобрил широкий catalog, четыре критерия, stop-at-three, full four-fact Knowledge revision, UI и branching 2026-08-13; hard cap 100, capital/population priority и separate live-10 budget 2026-08-16; Task 11 inward authority/digest/transition contract и Task 12 content-addressed snapshot/branch authority contract 2026-08-24; Task 13 identity/persistence/transaction/read-model authority amendment 2026-08-25 |
| Written approval | пользователь явно одобрил exact редакцию 2026-08-13, catalog/runtime amendment 2026-08-16, Task 11 architectural amendment и Task 12 architectural amendment 2026-08-24, Task 13 architectural amendment 2026-08-25 |
| Canonical effect after approval | заменяет общее обещание «1–3 города» точной City Frontier semantics; не меняет formal/effective country status |
| Split review | текущий baseline проверен по `CONSTITUTION.md`; сохранён одним документом, потому что catalog, ranking, full-Knowledge и frontier образуют один atomic design contract; tasks/evidence/canonical amendments остаются отдельными |

Этот approved документ является design baseline отдельного slice. Product Charter, Glossary, Demo
Story и Spec of Specs изменяются только отдельным traceable change-package; implementation plan и
canonical amendments создаются следующими шагами.

## 1. Цель, результат и граница

`GOAL-CF-01`: для одной effective-green страны из verified non-empty resolved country shortlist
пользователь наблюдает проверку городов в замороженном порядке и получает до трёх selectable
городов за максимум десять завершённых live city checks либо честный partial terminal, если frozen
queue исчерпана или достигнут отдельный live candidate limit.

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
4. City Catalog содержит максимум 100 городов на страну. Membership определяется строго по
   приоритету: national capital; все explicitly and officially typed first-level regional capitals;
   затем крупнейшие остальные official urban centers по latest comparable population до общего
   лимита 100, с ordinal `cityId` tie-break.
5. Обязательные capitals никогда не обрезаются молча. Если их unique count больше 100, country
   package получает `NEEDS_CONTEXT` до explicit country-specific policy. Если comparable population
   отсутствует, value не угадывается, несовместимые geo definitions не смешиваются, а coverage
   остаётся честно incomplete.
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
11. Live frontier проверяет кандидатов строго в frozen-rank order, завершает все четыре факта для
    каждого активированного города, даже если required mismatch уже найден, и публикует максимум
    десять completed city markers за run. Незавершённый retry тот же city budget повторно не тратит.
12. Проверенный required mismatch создаёт persistent red marker и replacement. Без такого mismatch
    город selectable: green без unknown либо yellow `Доступен с неполными данными` при unknown; yellow
    занимает terminal slot и не запускает replacement.
13. Frontier останавливается после трёх selectable городов, доказанного exhaustion либо десятого
    completed city check. Terminal результат `0..2` допустим; выбор разрешён только из terminal
    result с `1..3` entries. Отдельный per-city safety budget
    `3 queries / 10 document URL candidates / 2 official hops` не является этим frontier-wide city
    limit.
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

- membership содержит не больше 100 unique city IDs;
- national capital и все explicitly evidenced first-level regional capitals включаются первыми
  независимо от population;
- остальные official urban centers выбираются по latest comparable population descending, затем
  ordinal `cityId` ascending, пока общий membership не достигнет 100 либо universe не закончится;
- ровно 100 mandatory capitals допустимы без population fill; 101-й mandatory capital даёт typed
  package outcome `NEEDS_CONTEXT`, а не catalog или silent truncation;
- `city-catalog@1` остаётся replayable как historical policy; новые revisions используют
  `city-catalog@2`, и reconstruction проверяет reason set и membership по bound rules version;
- historical Load/Present может читать @1, но новый append/install/Start принимает только @2;
  legacy-only package даёт typed `city_catalog_upgrade_required` без source call или новых rows;
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

Decision экспортирует отдельный structural replay
`reconstructCityCriteriaSnapshot(value, integrity)`: exact ID равен
`city-criteria:${hash(canonical(payload without id))}`, вход descriptor-owned/closed, результат fresh
recursively frozen. Эта функция не получает evaluator и не утверждает target semantics; существующий
evaluator-aware `reconstructCityCriteria` остаётся отдельной semantic проверкой Application.

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
Run допускает максимум десять committed completed candidates. Crash, cancel или любой failure до
durable marker commit не расходует этот limit; idempotent retry completed city второй раз не считает.

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

Граница между Application и pure Decision является закрытым anti-corruption contract. Application
сначала reconstructs exact Knowledge и replayed Evidence, затем передаёт только plain source
projection: `cityId`, Knowledge/Evidence IDs, `lastCheckedAt` и canonical tuple четырёх raw facts с
accepted/reviewed links. Отдельно Decision получает узкую frozen Ranking projection
`{ assessmentAt, orderedCityIds, screenedExclusionCityIds }`, verified Criteria Snapshot и inward
evaluator registry. Decision не импортирует Research и сам при frozen `assessmentAt` выводит
effective four-fact projection, required mismatches, weighted verification coverage, warnings,
selectability и visual status. Chronology требует `assessmentAt <= lastCheckedAt`; source projection
не может прислать готовые mismatch, coverage, warning или color как authority.
До первого evaluator callback Decision владеет полным input graph и фиксирует все четыре
capabilities. Callback получает только private frozen `{ criterion, fact, assessmentAt }`; exact
eight-key `fact` не содержит Evidence links или rejection metadata. Definitions и обе функции
descriptor-captured до вызова; callback receiver — fresh frozen one-capability marker, а не borrowed
evaluator/registry. До callback fact `criterionId/definitionId/freshnessBasis` exact-связан с canonical
criterion и captured definition. Синхронный evaluator result немедленно descriptor-owned до следующего
callback: verified допускает только exact three-key branch, unknown — exact four-key branch с factor
`0`, comparison `unknown` и сохранением причины raw unknown; malformed/Promise/hostile/throwing return
закрывается как `integrity_mismatch`.

Создание successor не имеет циклической зависимости: Application сначала вызывает pure
`reconstructCityLiveMarker` без persisted marker, затем считает Task 12 digest этого результата и
передаёт marker+digest binding в `reconstructCityFrontier`. При replay первый вызов получает persisted
marker и exact-сравнивает его с заново выведенным значением; frontier повторяет эту проверку для всех
bindings. Frontier projection является закрытым `working | terminal` union, а не сочетанием optional
phase/terminal полей.

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
cursor и selectable slots. Terminal City Shortlist Snapshot публикуется при трёх selectable, frozen
queue exhaustion либо после десятого completed city check и содержит entries в frozen-rank order с
exact Knowledge/Evidence lineage. Stop precedence после commit детерминирована: `three_selectable`;
иначе `catalog_exhausted`, если следующего frozen candidate нет; иначе
`live_candidate_limit_reached`. Working revision с десятью markers и активация одиннадцатого city
недопустимы.

Root reconstruction передаёт `predecessorMarkers: null` и не содержит marker. Каждый successor
передаёт exact predecessor marker list, сохраняет его canonical prefix без изменений и добавляет
ровно один следующий frozen-rank marker; predecessor обязан reconstruct как working. Marker содержит
canonical `lastCheckedAt`. Его raw lowercase SHA-256 digest равен
`hash(canonical(marker))` и включает visual status, time, facts и ordered duplicate link occurrences.
Pure Task 11 только проверяет форму и связывает caller-verified digest; Application/persistence
Tasks 12–14 вычисляют и повторно проверяют digest через injected Decision integrity capability.

До terminal seal CTA выбора отсутствует. UI показывает:

- gray `Проверяется` для active candidate;
- green `Доступен для выбора` без unknown;
- yellow `Доступен с неполными данными` с explicit warning list при unknown; yellow остаётся selectable и занимает terminal slot;
- red `Исключён` только при fresh verified required mismatch.

Цвет всегда дублируется текстом/icon. Card различает frozen `rank/score на момент старта` и fresh
facts/`coverage после проверки`. Второй aggregate score после live check не вычисляется.

### `REQ-CF-07` — выбор и первая альтернативная Life Git ветвь

Select command принимает terminal shortlist ID, `cityId`, command ID и, только для non-empty
warning basis, warning-copy version. Сервер сам реконструирует selectability, canonical displayed
unknown basis и branch parent; клиент не присылает facts, risk basis или parent ID.

Pure selection получает verified terminal frontier и закрытый request только из `cityId` и optional
`city-unknown-risk@1`. Он возвращает fresh terminal entry, transient `reviewedSourceLinks`,
reconstructed из selected marker `manualCheckLinks` в canonical four-fact/link occurrence order без
deduplication, и optional accepted copy token. Reviewed links не дублируются в Selection Snapshot:
durable authority остаётся в terminal marker и его digest.

Committed link является закрытым discriminated union. `accepted` требует resolved Evidence URL и не
может содержать rejection reason. По контексту enclosing fact safety accepted link обязательно
содержит `referenceYear`, равный numeric verified `referencePeriod`; safety reviewed link обязательно
содержит Decision-owned closed reason, а любой non-safety reviewed link этот key запрещает, поскольку
текущий fixed Evidence его не производит. Остальные reviewed resolved URL/year остаются optional.
`evidenceLinks` содержит только accepted branch; `manualCheckLinks` и transient
`reviewedSourceLinks` — только reviewed-rejected branch, с сохранением порядка и duplicate
occurrences. Persisted label отсутствует: Experience локализует exact `sourceId`.

Нажатие `Выбрать город` при non-empty warning basis является явным принятием ровно показанных
unknown warnings; при полном verified coverage risk acceptance отсутствует. Операция атомарно
публикует City Selection Snapshot и City Branch Commit.

Task 12 owns descriptor-safe content-addressed sealing of frontier/selection/branch values; Select
exposes no independently sealable branch intermediate, and one pure wrapper derives the selection plus
sibling commit from verified terminal/ranking/pre-city authority.

Pre-city source является fresh plain projection только из exact profile/Preference Profile IDs,
resolved shortlist ID и полного selected country entry. Branch source-aware replay происходит до
передачи parent в wrapper; сам wrapper повторяет closed content-ID и terminal/ranking/parent equations,
пересчитывает digest complete selected marker и server-side выводит все durable Selection fields.

City Frontier Start идемпотентно создаёт либо загружает verified `PreCityBranchCommit`, который
фиксирует общий profile/resolved-country context до выбора города; Ranking и Terminal snapshots
связываются с его ID. Terminal City Shortlist является отдельным immutable assessment input, а не
подменой branch parent. Выборы A и B из одного terminal получают одинаковые
`parentId/forkedFrom = preCityBranchCommitId` и являются sibling commits. Selection snapshot
связывает profile, resolved-country entry, criteria, selected terminal marker, exact
Knowledge/Evidence, warnings и optional copy version.

## 4. Основные сценарии

- `SCN-CF-01 Catalog`: 99/100/101 total members, 99/100/101 mandatory capitals, national/first-level
  regional priority, equal-population ordinal `cityId` tie-break и input-order invariance; >100
  mandatory capitals дают `NEEDS_CONTEXT`, а missing population делает coverage incomplete.
- `SCN-CF-02 Ranking unknown`: unknown даёт zero contribution и меньшую coverage, но остаётся в
  queue; comparable required mismatch попадает только в screened exclusions.
- `SCN-CF-03 Fresh replacement`: первый live city проходит все четыре checks, получает required
  mismatch и persistent red; следующий frozen candidate заполняет слот.
- `SCN-CF-04 Selectable unknown`: один или все четыре facts unknown; city становится yellow
  `Доступен с неполными данными`, занимает slot, а selection фиксирует warning basis.
- `SCN-CF-05 Revalidation`: одинаковая projection создаёт successor с новым `lastCheckedAt` и прежним
  `knowledgeUpdatedAt`; known-to-unknown не переносит value и обновляет `knowledgeUpdatedAt`.
- `SCN-CF-06 Failure boundary`: evidence-backed bounded source exhaustion публикует unknown;
  crash/cancel/storage/integrity failure не публикует revision и retry начинает с того же city.
- `SCN-CF-07 Frozen order`: live Knowledge меняет fresh facts/coverage, но не rank/score текущего run.
- `SCN-CF-08 Bounded terminal`: catalog exhaustion либо десятый completed city check с двумя
  selectable разрешает выбор; terminal с нулём не создаёт selection и не открывает `VS-4`; при
  оставшемся frozen queue budget stop называется `live_candidate_limit_reached`, и одиннадцатый city
  не активируется.
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
  commit ordering. Он является anti-corruption layer: после verified Knowledge/Evidence строит plain
  marker source projection, но не передаёт Research revision/ledger внутрь Decision. Он же владеет
  exact run/command identity и всеми semantic reconstruction gates; persistence получает только
  structural values. Только Continue вызывает official source port.
- **Infrastructure** хранит Registry/Catalog, Evidence, Knowledge, Criteria, Ranking, Frontier,
  Terminal, Selection и Branch append-only. SQLite проверяет canonical envelopes, mirrors/FKs,
  stored-source replay и topology, но не evaluator/Knowledge/Evidence/Task 11 semantics. Raw bytes
  доступны только Evidence storage.
- **Experience** принимает strict read models/finite NDJSON events и только проецирует frozen/fresh
  labels, markers, warnings и controls. Существующий globe instance/history/focus/reduced-motion
  patterns переиспользуются без новой карты.
- **Branch** получает отдельный City Branch contract. Housing-specific payload существующего Life
  Git не расширяется невалидным union и не используется как City Knowledge/Selection storage.

`PlaceRanker@1` и Country Knowledge carry-forward contract не переиспользуются: их unknown scoring
и partial-update semantics прямо несовместимы с этим slice.

## 6. Persistence, integrity и recovery

Каждый durable snapshot имеет closed schema, canonical JSON, lowercase-64 payload hash, exact HMAC
preimage, source-ID mirrors/FKs и immutable UPDATE/DELETE guards. Task 13 добавляет ровно пять таблиц:
Criteria, closed `pre_city | selection` Branch, Ranking, Frontier и заранее зарезервированную Task 15
Selection. Никакой шестой Knowledge-map junction нет: map members проверяются exact verified lookups.
Linear Frontier использует один root/successor/terminal, unique `(run_id, command_id)`, global partial
unique Start command и запрет successor после terminal. Verified traversal посещает все строки run
ровно один раз от root к unique head без `rowid`; disconnected/cycle/cross-run/cross-Ranking или
повреждённый невыбранный ancestor/descendant отравляет любой load/find.

Task 12 content IDs равны exact prefix плюс lowercase 64-hex
`hash(canonical(closed payload without id))`: `city-ranking:`, `city-frontier-revision:`,
`city-selection:`, `pre-city-branch:` и `city-branch:`. Complete marker и resolved-country entry
используют тот же raw lowercase hash без prefix. Structural replay не является semantic authority:
Ranking отдельно проверяется по Registry/Catalog/Criteria/Knowledge/evaluators, Frontier/Selection —
по Task 11, а pre-city parent — source-aware replay по verified resolved-country/profile projection.
Task 13 добавляет structural Criteria replay с exact `city-criteria:` content ID; evaluator-aware
Criteria остаётся Application semantics.

Application identity закрыта тремя exact payload. `CityCriteriaCommandPayload` имеет только schema,
оба profile ID, exact four-criteria tuple и rules; его hash raw lowercase-64 и исключает ID/time.
`CityFrontierRunIdentity` имеет только schema, resolved revision, country, Registry, full
`InstalledCityPackageExactKey`, Criteria payload hash, authenticated referenced Catalog rules
(`@1 | @2`), ranker rules и exact frontier budget; run ID равен
`city-frontier:${hash(canonical(identity))}` и исключает clocks/clock-derived snapshot IDs. Новый Start
и все durable writes требуют `@2`, но исторический identity `@1` остаётся replayable.
Timestamp-free Start intent дополнительно содержит derived run ID. После verified inputs берётся один
`startAt`:

```text
criteria.confirmedAt = ranking.assessmentAt = ranking.createdAt = root.createdAt = startAt
preCity.createdAt = verifiedResolvedCountryShortlist.createdAt <= startAt
```

Application создаёт deterministic parent с stable resolved time, делает source-key find/replay до
Ranking seal и reuse exact parent. Одинаковый source в разных run/retry/race поэтому имеет одинаковые
parent bytes/ID.

Внутри `publishStart` `BEGIN IMMEDIATE` global lookup по Start command ID является первым SQLite
действием до run-scoped row read/insert. Затем даже для hit writer authenticates candidate Catalog,
binds Catalog/Registry/country/package/schema и derives rules/run/intent. Hit сначала сравнивает
derived/stored intent: любое drift, включая `@1 ↔ @2`, даёт `integrity_mismatch`; только exact equality
применяет candidate+winner `@2` gate до replay return. Miss применяет candidate `@2` gate до root
lookup/write. Identical five-key intent после этого возвращает fully verified stored
winner даже при более поздних candidate clocks; изменённый intent/derived run даёт
`integrity_mismatch`. Другой Start command для существующего deterministic run/root также
`integrity_mismatch`. Every Frontier row is unique by `(runId, commandId)`, so a successor cannot reuse
the root command; после command-first replay только
authenticated same-run/same-Ranking ancestor, который больше не unique head, даёт
`stale_city_frontier_head`. Forged/missing/misbound predecessor, tamper и Start conflict —
`integrity_mismatch`; busy/native/unrelated constraint не relabel. City Knowledge publication для
одного city сериализована; параллельные writers не создают forked revisions.
Direct append на command hit сначала сравнивает candidate/stored operation (`integrity_mismatch` на
drift), затем exact-hit/miss authenticates referenced Catalog и требует `@2` до replay/stale/write;
exact `@1` command не возвращается как успешный replay.
Exact structural absence errors are `city_criteria_not_found`, `pre_city_branch_not_found`,
`city_ranking_not_found`, `city_frontier_not_found` and, from Task 15,
`city_selection_not_found`. A missing command in an existing fully verified run is `undefined`; a
missing run for command lookup is `city_frontier_not_found`.

SQLite authority ограничена signed canonical bytes/hash/HMAC, content IDs, mirrors/FKs, Task 12 и
Criteria structural replay, stored-source pre-city replay, command equality, five-table constraints и
full topology. Application authority включает evaluator Criteria, semantic Ranking, verified
Knowledge/Evidence, raw marker digest и Task 11 frontier/selection до seal/write и после load. Store не
принимает caller semantic proof/projection/digest. Start writer возвращает только exact
Criteria/parent/Ranking/root; Application собирает rich read model с Registry/Catalog и selection
history. History после structural pair и Application semantics имеет total order
`(selection.createdAt ASC, selection.id ASC)`.
Exact private envelope is `payload_json=C(reconstructed value)`,
`payload_hash=SHA256_TEXT(payload_json)` and non-command
`hmac=HMAC_SHA256_TEXT(payload_json,key)`. Frontier/Selection additionally store
`command_json=C(exact intent/operation)`, raw text hash, and HMAC over
`C({ value: reconstructed value, command: exact command })`; all digests are lowercase-64.
Каждый full-chain/root load следует по Ranking→Criteria и referenced Catalog, structurally verifies все
три значения, связывает Catalog ID/Registry/country/package/schema с Ranking/context, derives фактический
Catalog rules literal, заново вычисляет exact Criteria payload hash, nine-key run identity/run ID и
five-key Start intent и связывает их со stored root command envelope, operation Criteria hash, всеми
revision run/Ranking полями и Ranking source/context/Registry/rules/budget. Application повторяет этот
cross-row identity replay после своих semantic gates; отдельная valid HMAC/rehash строка не может
заменить graph authority.

Authenticated installed-package, Evidence и Knowledge structural read/replay принимает только known
bound `@1 | @2`; unknown rules дают `integrity_mismatch`. Authentic `@1` доступен только zero-network
Present для audit: `readModel.catalog.rulesVersion` позволяет Experience убрать Continue/Select
affordances, а Application не имеет успешного Continue/Select path. Manifest/install, Evidence seal,
Knowledge publication, Frontier/Selection writers и Setup/Start/Continue/Select требуют `@2` до write
или semantic callback; shared read reconstruction не является write authorization.

После SQLite structural load Application verified presentation/load отдельно реконструирует catalog
membership, evaluator Criteria, semantic ranking/exclusions, marker prefix, cursor, stop condition,
four-fact Knowledge/Evidence semantics, warning basis и branch lineage. Подмена country, city, catalog,
criteria, predecessor, Evidence/Knowledge reference, marker или terminal composition fail-closed;
SQLite не приписывает себе этот semantic результат.

Task 15 Application после structural terminal/Ranking exact-authenticates package/Catalog и сразу
отклоняет `@1` до Criteria/evaluator/Knowledge/Evidence/Task 11 callbacks, затем на `@2` семантически
reconstructs Criteria/Ranking/Knowledge/Evidence/source, вызывает pure selection и единственный pair wrapper. Atomic writer получает
только explicit timestamp-free three-key intent, command ID и constructed pair; он делает command-first
lookup, authenticates referenced Catalog и требует `@2` до replay return/insert, затем structural
pair/stored-source/mirrors/FKs и insert/reload без evaluator, Knowledge/Evidence или Task 11 callback.
Application повторяет semantics после structural reload.

Presentation/reload/select не выполняют official HTTP. После transport loss committed marker
остаётся; reload показывает verified head и explicit Continue. Неподтверждённый live progress не
восстанавливается как факт. Prepare descriptor-owns exact input и выполняет command-first lookup:
committed `city_completed` восстанавливает Prepared из verified original base даже после terminal head,
а absent command требует expected base как unique working head. Continue повторно проверяет exact
six-key Prepared; hit и miss затем проходят общий Ranking + exact package/Catalog `@2` gate до любого
Criteria/evaluator/Knowledge/Evidence/Task 11/source/event/return. Поэтому committed `@1` hit даёт
`city_catalog_upgrade_required` без semantic/source/event/append, а current-rules hit семантически
replay-ит committed working/terminal winner без source или duplicate event. Новый retry продолжает
frozen cursor и не проверяет committed city повторно.

## 7. Verification и acceptance gate

Минимальный обязательный набор:

- pure tests cap-100/capital priority/population fill/ordinal tie/overflow, exact
  formula/unknown/required/tie-break и three-way stop table;
- package fixture vectors для всех четырёх definitions, directions, boundaries и freshness policies;
- full revision tests: 4/4 facts, no carry-forward, same-value revalidation, known-to-unknown и
  source-failure-vs-crash boundary;
- ranking snapshot reconstruction, catalog union, screened exclusions и no-current-run-rerank;
- frontier replacement, persistent red, selectable unknown, three/exhaustion/live-limit `0..2`,
  no-eleventh-city и abort/retry;
- append-only/hash/HMAC/predecessor/idempotency/concurrency/tamper matrices;
- strict transport, EOF-held terminal, committed-before-event, zero-network double presentation;
- UI/accessibility tests gray/green/yellow/red, warning acceptance, frozen-vs-fresh labels and same globe;
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
- Выбор до terminal или отдельный risk modal.
- Rerank и второй aggregate score после fresh live checks.
- Raw official bytes, user preferences, score или suitability verdict в City Knowledge.
- Работа, жильё, бюджет, projections и полный Life Git diff UI из `VS-4`.
- Background queue, worker fleet, event store, graph DB, provider SDK или runtime LLM.

## 9. Canonical amendments после written approval

Change-package обязан узко обновить Product Charter, Glossary, Demo Story, Spec of Specs и docs
index: catalog cap 100 и capital/population priority, exact 3-or-exhaustion-or-live-10 stop,
selectable-only-on-verified-required-mismatch, full four-fact City Knowledge, marker semantics и City
Selection sibling branches. Исторические approved `VS-3`/`VS-3R` specs и evidence не переписываются.

## 10. Approval gate

Conversational design и exact written baseline одобрены пользователем 2026-08-13; hard catalog cap,
membership priority и separate live-10 amendment одобрены 2026-08-16; Task 11 inward-authority и
Task 12 content-addressed snapshot/branch authority amendments одобрены 2026-08-24. Detailed
Task 13 identity/persistence/transaction/read-model authority amendment одобрен 2026-08-25. Detailed
implementation plan обязан применять эту редакцию без повторного продуктового вопроса.
