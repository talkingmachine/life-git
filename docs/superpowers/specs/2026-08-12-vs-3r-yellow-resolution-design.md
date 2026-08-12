# VS-3R Yellow Resolution: пользовательское разрешение формальной неопределённости

| Поле | Значение |
| --- | --- |
| Статус | `approved` — разговорный дизайн и точный письменный baseline одобрены пользователем |
| Владелец решения | пользователь проекта |
| Дата | 2026-08-12 |
| Область | разрешение yellow-стран после автоматического Country Frontier и до City Frontier |
| Зависимости | утверждённый и реализованный `VS-3 Place Frontier`, Product Charter, Spec of Specs |
| Approval evidence | пользователь последовательно одобрил подход A и все шесть разделов разговорного дизайна 2026-08-12 |
| Written approval | пользователь явно одобрил точный письменный baseline 2026-08-12 |
| Canonical effect after written approval | automatic shortlist становится предварительным; unresolved yellow блокирует итоговый country shortlist и City Frontier; решение пользователя задаёт отдельный effective status, не меняя formal verdict |

Этот документ описывает самостоятельный промежуточный vertical slice между завершённым `VS-3`
и будущим `VS-4A City Frontier`. Он не реализует City Registry, City Knowledge или ранжирование
городов. Его задача — превратить предварительный автоматический shortlist с formal yellow в
неизменяемый пользовательский список без unresolved yellow.

До отдельного одобрения точного текста этот документ не изменяет действующие Product Charter,
glossary, demo story, Spec of Specs или исторические `VS-3` snapshots.

## 1. Цель и результат

`GOAL-YR-01`: после автоматической проверки стран пользователь принимает или отклоняет каждую
formal yellow-страну, наблюдает необходимые replacement-проверки на той же планете и получает
неизменяемый список до пяти стран, которые в пользовательском представлении являются green.

Формальная доказательная истина не переписывается. Formal yellow означает, что система не смогла
ни подтвердить доступный маршрут, ни доказать невозможность проживания. Пользователь может принять
этот риск либо отказаться от страны. Решение меняет пользовательское поведение и визуальный статус,
но не Evidence, Country Knowledge или `FormalResidenceVerdict`.

Итоговый `Resolved Country Shortlist Snapshot` является единственной допустимой точкой входа в
будущий City Frontier. Исходный автоматический `Shortlist Snapshot` остаётся предварительным и
никогда не используется как финальный выбор страны.

## 2. Утверждённые продуктовые инварианты

1. Автоматический Country Frontier сначала полностью завершается: пятью formal non-red странами
   либо исчерпанием полного frozen ranking.
2. Yellow Resolution начинается отдельной фазой после автоматического frontier, а не после каждой
   отдельной проверки страны.
3. Для каждой formal yellow-страны пользователь обязан выбрать только одно:
   `accepted_at_own_risk` или `rejected`. Skip отсутствует.
4. Accepted yellow визуально и функционально становится обычной green-страной. После сохранения
   решения пользователь не видит специальных badge, warning или отдельного типа карточки.
5. Rejected yellow визуально и функционально становится обычной red-страной: не занимает слот,
   недоступна для City Frontier, остаётся постоянным интерактивным marker и запускает replacement.
6. Внутренний formal verdict rejected/accepted yellow остаётся yellow. Он вместе с решением и
   canonical uncertainty basis сохраняется для integrity, replay и аудита.
7. Replacement берётся только из полного `RankingSnapshot.ordered`; страны из `excludedPlaces`,
   уже исключённые verified required mismatch, не возвращаются. Rerank в текущем run запрещён.
8. Все unresolved yellow должны получить решение до финализации. В итоговом пользовательском
   списке yellow отсутствует.
9. Итог содержит до пяти effective green стран. При exhaustion допустим честный список из 0–4.
10. Пустой resolved snapshot является валидным терминальным результатом, но не разрешает City
    Frontier.
11. Пересмотр уже сохранённого решения не редактирует текущий run. В будущем он создаёт новый
    resolution run от того же исходного automatic snapshot; UI пересмотра не входит в этот slice.

## 3. Термины и модель статусов

- `Formal status` — неизменяемый `green | yellow | red`, полученный из sealed official Evidence.
- `Yellow decision` — append-only пользовательское решение для exact formal yellow marker.
- `Effective status` — детерминированное пользовательское состояние, вычисляемое из formal status
  и Yellow decision.
- `Automatic Shortlist Snapshot` — существующий `VS-3` terminal snapshot со всеми marker и пятью
  formal non-red либо честным меньшим результатом.
- `Resolution revision` — append-only полный устойчивый snapshot текущего разрешения yellow.
- `Resolved Country Shortlist Snapshot` — терминальная resolution revision с итоговыми effective
  green странами.
- `Frozen ranking cursor` — позиция следующей ещё не проверенной страны в полном неизменяемом
  `Ranking Snapshot`.

### 3.1 Таблица effective status

| Formal status | User decision | Effective status | Пользовательское поведение |
| --- | --- | --- | --- |
| `green` | отсутствует | `green` | обычный green marker/card; страна занимает слот |
| `red` | отсутствует | `red` | обычный red marker; страна исключена |
| `yellow` | отсутствует | `yellow` | обязательный resolution prompt; финализация запрещена |
| `yellow` | `accepted_at_own_risk` | `green` | полностью обычный green marker/card; страна занимает слот |
| `yellow` | `rejected` | `red` | полностью обычный red marker; страна исключена и заменяется |

`Effective status` не хранится как независимая истина. Decision policy вычисляет его заново при
append, load и presentation. Это исключает расхождение с formal verdict или решением.

### 3.2 Правдивость пользовательского объяснения

Одинаковое визуальное и функциональное поведение не разрешает ложную юридическую формулировку:

- accepted yellow выглядит как green и после решения не показывает отдельное предупреждение;
- rejected yellow выглядит как red и использует тот же interaction pattern, но detail объясняет,
  что исходные formal facts остались неизвестными и пользователь отказался принять риск;
- rejected yellow нельзя описывать как страну с доказанной all-impossible legal eligibility;
- internal replay всегда различает formal red и user-rejected formal yellow.

## 4. Requirements и acceptance

### `REQ-YR-01` — отдельная фаза после автоматического frontier

Resolution запускается только от verified terminal Automatic Shortlist Snapshot и его exact full
Ranking Snapshot.

Acceptance:

- automatic frontier завершается по прежним `VS-3` правилам;
- source ranking/shortlist/profile/preferences/Evidence/Knowledge snapshots не изменяются;
- отсутствие formal yellow немедленно создаёт terminal resolved snapshot без prompt;
- исходный automatic snapshot сам по себе не открывает City Frontier.

### `REQ-YR-02` — явное решение каждой yellow-страны

Пользователь принимает риск либо отклоняет текущую formal yellow-страну.

Acceptance:

- prompt выдаётся по frozen rank;
- решение допустимо только для текущего unresolved yellow;
- клиент не передаёт и не редактирует canonical uncertainty basis;
- после устойчивого append accepted становится effective green, rejected — effective red;
- UI не меняет цвет оптимистично до подтверждения записи.

### `REQ-YR-03` — replacement из того же frozen ranking

Rejected yellow освобождает слот, а система продолжает текущий country frontier со следующей ещё
не проверенной страны полного Ranking Snapshot.

Acceptance:

- cursor движется только вперёд;
- ни одна страна не пропускается, не повторяется и не переставляется;
- formal red replacement сохраняется и автоматически ведёт к следующему кандидату;
- formal green replacement занимает слот;
- formal yellow replacement добавляется в resolution queue;
- current-run Country Knowledge updates не меняют frozen order.

### `REQ-YR-04` — неизменяемый итог без unresolved yellow

Terminal resolved snapshot создаётся только когда очередь unresolved yellow пуста и либо получено
пять effective green стран, либо frozen ranking исчерпан.

Acceptance:

- итоговые страны уникальны и отсортированы по исходному frozen rank;
- final содержит только effective green entries;
- accepted entry сохраняет internal formal-yellow provenance;
- результат 0–4 при exhaustion показан честно;
- empty terminal result не открывает City Frontier;
- finalization происходит ровно один раз.

### `REQ-YR-05` — persistent planet history

Пользователь наблюдает решения и replacement-проверки на той же планете.

Acceptance:

- accepted marker становится обычным green;
- rejected marker становится обычным red и остаётся в истории;
- все formal red и replacement markers сохраняются;
- replacement progress состоит только из фактических domain events существующего Evidence pipeline;
- reload восстанавливает exact markers, effective colors, unresolved prompt и cursor без сети.

### `REQ-YR-06` — воспроизводимость и fail-closed integrity

Каждая revision и terminal snapshot связываются с точными источниками и проверяются перед
presentation.

Acceptance:

- два presentation-вызова канонически равны и выполняют zero official HTTP;
- подмена source snapshot, predecessor, decision, uncertainty binding, marker, cursor, rules version,
  Evidence или Knowledge reference даёт `integrity_mismatch`;
- stale concurrent command не создаёт successor;
- повтор идентичной команды идемпотентен;
- application/storage/integrity failure не создаёт фиктивный terminal snapshot.

### NFR

- `NFR-YR-01 Official truth`: formal status и replacement verdict используют только существующий
  official Evidence pipeline; пользовательское решение не становится Evidence; resolution storage
  не копирует raw source bytes, credentials или secret-bearing request metadata.
- `NFR-YR-02 Append-only`: automatic snapshots, decisions, revisions, Evidence и Knowledge не
  обновляются и не удаляются.
- `NFR-YR-03 Provider-free`: runtime не содержит external LLM/API/provider SDK, credential или
  отдельный billing surface.
- `NFR-YR-04 Bounded recovery`: replacement использует существующие timeout/retry/cancellation и
  finite NDJSON semantics; бесконечный crawler или background workflow отсутствует.
- `NFR-YR-05 Minimum sufficient complexity`: один узкий resolution snapshot chain, без event store,
  workflow engine, queue, worker, polling или универсального decision framework.
- `NFR-YR-06 Accessibility`: unresolved prompt, checking progress, recoverable failure и terminal
  result доступны с клавиатуры и имеют корректные live-region/alert semantics.

## 5. Основные сценарии

### `SCN-YR-01 All formal green`

Automatic shortlist не содержит yellow. Start проверяет source graph и сразу публикует resolved
snapshot с теми же effective green странами. Пользователь не видит resolution prompt.

### `SCN-YR-02 Accepted yellow`

Текущая yellow-страна показывает exact unknown facts, official/manual links и предупреждение о
риске. Пользователь принимает страну. После commit marker и card становятся полностью обычными
green; следующая unresolved yellow открывается по frozen rank.

### `SCN-YR-03 Rejected yellow with red replacements`

Пользователь отклоняет yellow. Marker становится обычным red. Система проверяет следующие frozen
кандидаты: один или несколько formal red остаются на планете, после чего formal green занимает
слот. Уже сохранённое решение не откатывается.

### `SCN-YR-04 Replacement yellow`

После отказа replacement получает formal yellow. Он занимает provisional slot и добавляется в
resolution queue. После завершения replacement-проверки следующий prompt выбирает unresolved
yellow с наименьшим frozen rank среди всех текущих slot candidates.

### `SCN-YR-05 Exhaustion`

После решений и replacements ranking исчерпан. Когда оставшиеся yellow разрешены, система создаёт
resolved snapshot из 0–4 effective green стран. Пустой результат остаётся доказуемым terminal
outcome, но CTA City Frontier отсутствует.

### `SCN-YR-06 Interrupted transport`

Если transport обрывается после committed decision, reload показывает новый effective color. Если
обрыв произошёл во время replacement-проверки, committed decision сохраняется, terminal не
создаётся, а UI предлагает явно продолжить проверку от актуальной revision.

### `SCN-YR-07 Concurrency and retry`

Два параллельных accept/reject от одного head дают ровно один successor; второй получает
stale-head conflict. Повтор того же command ID и payload возвращает прежнюю revision. Тот же command
ID с другим payload даёт integrity conflict.

## 6. Архитектурные границы

```text
verified RankingSnapshot + Automatic ShortlistSnapshot
  -> Decision CountryResolutionPolicy
  -> Application CountryResolution use cases
  -> append-only ResolutionRevision chain
  -> existing CountryVerifierPort for replacements
  -> existing Evidence + Country Knowledge publication
  -> ResolvedCountryShortlistSnapshot
  -> Experience planet/projection
  -> future City Frontier handoff
```

### 6.1 Decision: `CountryResolutionPolicy`

Чистая policy владеет только правилами:

- reconstruction effective status;
- unique effective slots;
- unresolved queue в frozen-rank order;
- next unchecked rank;
- admissibility текущего decision;
- replacement requirement;
- terminal stop condition;
- canonical resolved country order.

Policy не читает SQLite, HTTP, raw Evidence или current Country Knowledge. При append и verified
load она реконструирует ожидаемое состояние и сравнивает его с persisted projection.

### 6.2 Application: `CountryResolution`

Application boundary владеет тремя use cases:

1. start от verified automatic snapshot;
2. append user decision от expected head;
3. continue replacement verification от stable revision.

Application загружает и проверяет cross-aggregate graph, вызывает pure policy, оркестрирует
существующий `CountryVerifierPort`, публикует successor revisions и отдаёт delivery-neutral read
models/events. Он не вычисляет formal verdict, ranking score или Knowledge facts.

### 6.3 Infrastructure

SQLite adapter реализует append/load/verify для resolution chain. Composition root передаёт
существующие profile, ranking, shortlist, Evidence, Knowledge и verifier ports. Новой capture,
Evidence или Knowledge pipeline нет.

### 6.4 Experience

HTTP/NDJSON adapters валидируют закрытые команды и события. Pure Experience projection выводит
effective colors, current prompt, replacement progress и terminal list. React/globe только
рендерят projection и не выводят status, queue или stop condition самостоятельно.

Dependency direction остаётся inward: Experience и SQLite зависят от Application/Decision
contracts; Decision не знает о React, Next.js, Zod, SQLite или crypto adapters.

## 7. Resolution snapshot model

Рекомендуется одна новая append-only таблица `country_resolution_revisions`. Она хранит не события,
а небольшую линейную цепочку полных canonical snapshots. Payload является закрытым union двух видов.

### 7.1 Working `ResolutionRevision`

Семантические поля:

- schema/rules version;
- resolution run ID и revision ID;
- optional predecessor revision ID;
- exact source automatic shortlist/ranking/profile/preference IDs;
- accumulated `YellowDecision[]`;
- completed replacement markers с exact Evidence/Knowledge lineage;
- next unchecked frozen rank;
- canonical unresolved country codes;
- canonical effective slot country codes;
- durable phase `awaiting_decision | replacement_required`;
- createdAt, context hash, payload hash и integrity signature.

`Unresolved country codes`, effective slots и phase являются проверяемой projection. Verified load
обязан реконструировать их pure policy из source graph, decisions, replacement markers и cursor.

### 7.2 `YellowDecision`

Решение содержит:

- exact country code;
- `accepted_at_own_risk | rejected`;
- canonical formal marker digest/reference;
- exact canonical uncertainty basis на момент показа warning;
- warning-copy version;
- `decidedAt` canonical instant;
- command/idempotency ID.

Canonical uncertainty basis сервер выводит из verified formal verdict:

- в порядке route outcomes — каждый `status: unknown` route ID и его exact reason codes/references;
- затем `catalog_completeness_unprovable`, если completeness unproven;
- reasons verified `impossible` routes не выдаются за неопределённость и не входят в risk warning.

Полный formal verdict остаётся доступен internal replay независимо от этой projection. Клиент
передаёт только run, expected revision, country code, selected decision, warning-copy version и
command ID. Сервер требует exact known warning version и сам назначает `decidedAt`; клиентский
timestamp не принимается.

### 7.3 Terminal `ResolvedCountryShortlistSnapshot`

Terminal payload содержит:

- exact source IDs и optional terminal predecessor, отсутствующий у immediate all-green root;
- полный canonical decisions/replacement lineage;
- resolved entries в frozen-rank order;
- stop condition `five_effective_green | ranking_exhausted`;
- rules version, createdAt и integrity envelope.

Каждый resolved entry ссылается на exact marker. Accepted formal yellow не получает другой formal
verdict: его effective green реконструируется из marker + decision.

City Frontier в будущем принимает только verified terminal revision ID с как минимум одной resolved
entry. Он отклоняет automatic shortlist ID, working revision, tampered snapshot и empty terminal.

## 8. Жизненный цикл

### 8.1 Start

1. Загрузить verified terminal Automatic Shortlist Snapshot.
2. Загрузить exact full Ranking Snapshot, profile/preferences и referenced Knowledge/Evidence graph.
3. Убедиться, что source markers являются canonical checked prefix frozen ranking.
4. Создать root working revision либо сразу terminal snapshot, если formal yellow отсутствуют.
5. Первым current prompt выбрать unresolved yellow с наименьшим frozen rank.

### 8.2 Accept

1. Проверить expected head и current prompt.
2. Серверно зафиксировать exact uncertainty binding и warning version.
3. Атомарно append successor revision.
4. Только после commit показать обычный effective green.
5. Открыть следующий unresolved prompt либо финализировать.

### 8.3 Reject and replace

1. Атомарно append rejected decision; durable phase становится `replacement_required`.
2. После ответа UI запускает bounded continuation. Если transport не стартовал, решение уже
   сохранено, а reload показывает обычный red и кнопку продолжения.
3. Проверять следующие страны `RankingSnapshot.ordered` последовательно; `excludedPlaces` не
   возвращаются в frontier.
   Для каждого replacement Application передаёт `resolutionRunId` как parent run существующему
   `CountryVerifierPort`; canonical child ID выводится существующим правилом из
   `resolutionRunId + countryCode`. Поэтому child не коллидирует с исходным VS-3 check и при replay
   проверяется тем же verifier contract.
4. После каждого completed country append successor с новым marker и продвинутым cursor.
5. Consecutive formal red не занимают слот, но остаются в history.
6. Formal green или yellow занимает provisional slot; yellow добавляется в queue.
7. После заполнения слота либо exhaustion показать unresolved yellow с наименьшим frozen rank.

### 8.4 Finalize

Policy разрешает terminal append только если:

- unresolved queue пуста;
- replacement не требуется;
- effective slots равны пяти либо cursor доказанно исчерпал ranking;
- entries уникальны и идут в frozen-rank order;
- весь source/replacement Evidence, Knowledge и rules graph verified.

После terminal revision новые решения и continuation для этого run запрещены.

## 9. Команды и delivery contract

### Start command

Принимает только automatic shortlist ID. Start полностью проверяется до любого stream response.

### Decision command

Принимает только:

- resolution run ID;
- expected head revision ID;
- country code;
- selected decision;
- warning-copy version;
- command ID.

Решение является обычным request/response: визуальное изменение возможно только после verified
success response.

### Continue command

Принимает resolution run и expected `replacement_required` head, затем возвращает конечный NDJSON
stream фактических activation/progress/completion/revision/terminal events. Он переиспользует общий
finite NDJSON reader, strict sequencing, EOF-held terminal и cancellation semantics существующего
Place Frontier.

Сеть к официальным источникам разрешена только внутри явного Continue use case. Start, Decision,
reload и presentation не выполняют official HTTP.

## 10. Concurrency, idempotency и integrity

- Append выполняется с expected predecessor внутри immediate transaction.
- Для одной non-terminal revision допустим не более одного successor.
- Одна resolution revision является единственным active head данного run.
- Start текущего slice идемпотентно возвращает уже существующий resolution run для source automatic
  snapshot. Будущая смена решения потребует отдельной явной restart-команды и не входит в этот UI.
- Store сначала ищет `(resolutionRunId, commandId)`. Существующая запись с тем же canonical payload
  возвращает прежний successor, даже если head уже продвинулся.
- Тот же command ID с иным payload даёт `integrity_mismatch`.
- Только для нового command ID проверяется, что expected predecessor всё ещё является current head.
- Одновременные accept/reject дают один winner; проигравший получает stale-head conflict и reload.
- Terminal append атомарен и идемпотентен.
- Каждая строка имеет canonical JSON, payload SHA-256, context hash и HMAC; UPDATE/DELETE запрещены.
- Load проверяет closed schema, canonical bytes, hashes/signature, predecessor chain, source graph и
  Decision reconstruction.
- Каждый replacement marker имеет canonical child check ID, привязанный к resolution run и country;
  его нельзя переставить между runs или странами.
- Client никогда не является владельцем uncertainty basis, cursor, queue, effective status или terminal
  composition.

Новая таблица остаётся узкой частью resolution capability. Отдельные decision/event/head/queue
таблицы, mutable pointer и универсальный workflow store не требуются.

## 11. Experience и планета

- Существующий globe instance сохраняется между automatic, resolution и terminal phases.
- На старте resolution все source markers остаются на месте.
- Current unresolved yellow открывает доступное диалоговое решение с exact unknown facts,
  official/manual links и явным принятием риска.
- Accepted marker после commit рендерится полностью как обычный green.
- Rejected marker после commit рендерится и управляется как обычный red; detail остаётся фактически
  точным относительно пользовательского отказа, а не имитирует formal all-impossible proof.
- Replacement получает gray marker и фактическую progress timeline; никакие стадии не фабрикуются.
- До terminal snapshot CTA City Frontier отсутствует.
- Terminal экран показывает до пяти обычных green country cards; accepted происхождение не
  маркируется в пользовательском UI.
- Empty terminal показывает честное отсутствие оставшихся стран и не предлагает город.
- Reload working revision показывает текущий prompt либо `Продолжить проверку`; live timeline не
  синтезируется из persisted snapshots.
- Technical transport error сохраняет уже принятые цвета/history и не показывает terminal cards.

Globe camera, flight, earth material, light, clone/focus algorithms и reduced-motion behavior не
меняются. Меняется только входная projection статусов и resolution controls.

## 12. Ошибки и восстановление

| Сбой | Поведение |
| --- | --- |
| Invalid source graph или tamper | `integrity_mismatch`; revision/terminal не публикуется |
| Stale expected head | conflict; клиент загружает current verified head |
| Invalid decision target | request отклоняется без append |
| Повтор идентичного command | возвращается прежний verified successor |
| Transport обрыв после decision commit | reload показывает committed effective color |
| Abort/transport error во время replacement | terminal отсутствует; head остаётся `replacement_required` либо последней completed revision |
| Official source failure | существующий verifier публикует честный formal yellow, не fake green/red |
| Storage/application failure до append | current head не меняется |
| Client decoder failure после server commit | terminal не принимается текущим UI; verified reload может восстановить committed state |
| Ranking exhaustion | после разрешения очереди публикуется честный terminal result 0–4 |

Evidence/Knowledge revisions, уже законно опубликованные replacement-проверкой, не откатываются.
Resolution связывает их только после verified country completion.

## 13. Verification strategy

### Pure Decision tests

- полная таблица formal + decision -> effective;
- queue/frozen-rank/cursor reconstruction;
- accept/reject/green/red/yellow replacement transitions;
- five-effective-green и exhaustion stop conditions;
- final ordering и uniqueness;
- malformed persisted projections rejected.

### Persistence tests

- root/successor/terminal canonical round-trip;
- closed schema, canonical bytes, SHA/context/HMAC checks;
- immutable UPDATE/DELETE;
- missing/wrong predecessor и forked successor rejected;
- idempotent same command, conflicting command payload;
- real two-connection accept/reject race даёт ровно один successor;
- tamper matrix для source IDs, decisions, uncertainty bindings, markers, cursor, queue, rules, Evidence и
  Knowledge references.

### Application tests

- all-green immediate final;
- multiple initial yellow decisions in rank order;
- reject -> consecutive red -> green replacement;
- reject -> replacement yellow -> global rank-order prompt;
- repeated replacements и exhaustion 0–4;
- abort/storage/integrity failure without false terminal;
- replacement Country Knowledge write-back не меняет frozen ranking;
- two zero-network presentation calls yield canonical equality.

### Protocol and Experience tests

- strict start/decision/continue bodies and generic unexpected errors;
- sequence/run/reference/terminal/EOF validation;
- marker transitions only after committed revision event/response;
- accepted visually/functionally ordinary green;
- rejected visually/functionally ordinary red with truthful detail;
- same globe retained; red history survives replacement/collapse/reload;
- keyboard, focus, live-region, cancel and StrictMode lifecycle regressions;
- interrupted continuation preserves committed decisions and offers explicit continue;
- terminal cards appear only from verified non-empty/empty resolved snapshot as appropriate.

### Regression and operational gate

- existing Place Frontier, cold-start, Evidence, Knowledge, globe and replay suites remain green;
- full tests, typecheck, lint, build and diff checks pass sequentially;
- provider/API-key audit returns no runtime matches;
- browser walkthrough, if executed, requires the repository-mandated explicit permission at that
  time and never substitutes fixtures for official source outcomes.

## 14. Traceability

Все `REQ-YR-*` реализуют `GOAL-YR-01`.

| Scenario | Requirements | NFR | Design decisions | Verification |
| --- | --- | --- | --- | --- |
| `SCN-YR-01` | `REQ-YR-01`; `REQ-YR-04` | `NFR-YR-02`; `NFR-YR-05` | source graph verification; immediate terminal | pure stop + application all-green + replay |
| `SCN-YR-02` | `REQ-YR-02`; `REQ-YR-05` | `NFR-YR-01`; `NFR-YR-06` | append before visual change; effective green projection | decision/store + component/globe tests |
| `SCN-YR-03` | `REQ-YR-03`; `REQ-YR-05` | `NFR-YR-01`; `NFR-YR-04` | replacement-required head; persistent red history | synthetic rank>5 application + stream/UI |
| `SCN-YR-04` | `REQ-YR-02..04` | `NFR-YR-04`; `NFR-YR-05` | global rank-order queue; no rerank | Decision queue + replacement-yellow integration |
| `SCN-YR-05` | `REQ-YR-04` | `NFR-YR-05`; `NFR-YR-06` | explicit ranking exhaustion; empty allowed | exhaustion table + City handoff guard |
| `SCN-YR-06` | `REQ-YR-05`; `REQ-YR-06` | `NFR-YR-02`; `NFR-YR-04`; `NFR-YR-06` | committed head owns recovery; no fabricated terminal | cancellation/decoder/reload tests |
| `SCN-YR-07` | `REQ-YR-06` | `NFR-YR-02`; `NFR-YR-05` | expected predecessor; command idempotency | two-connection race + retry/tamper tests |

`NFR-YR-03` проверяется общим provider/API-key audit всего runtime surface во всех сценариях.

## 15. Явные не-цели

- City Registry, City Knowledge, City Evidence и city ranking.
- Изменение formal residence rules или повторная интерпретация Evidence.
- Перезапись существующих Ranking/Shortlist/Evidence/Knowledge snapshots.
- Редактирование decision внутри завершённого run.
- Новые country packages или фиктивное production coverage.
- Универсальный event store, workflow engine, queue, worker, polling или crawler.
- Новый capture/validation/Knowledge pipeline.
- Изменение globe camera/material/light/flight algorithms.
- Работа, жильё, бюджет, projections и Life Git.
- External LLM/API/provider surface до защиты.

## 16. Canonical amendments после письменного approval

До реализации нужно отдельным traceable change обновить:

- Product Charter: automatic green/yellow shortlist является preliminary; unresolved yellow
  требует решения; City Frontier принимает только resolved snapshot.
- Glossary: formal status, effective status, Yellow decision, Resolution revision и Resolved Country
  Shortlist Snapshot.
- Demo story: между automatic frontier и country choice появляется Yellow Resolution; accepted и
  rejected markers получают обычное green/red поведение.
- Spec of Specs: добавить `VS-3R` как самостоятельный промежуточный slice до city frontier.
- Исторический `VS-3` design/change не переписывать как будто новое поведение существовало раньше;
  amendment supersedes только forward product flow.

Superseded после approval положения:

- automatic yellow напрямую допускается к city research;
- пять formal green/yellow являются окончательным пользовательским country shortlist;
- один marker color одновременно является и formal truth, и окончательным UI state.

## 17. Approval gate

- [x] Пользователь выбрал append-only resolution overlay вместо перезаписи source shortlist или
  решения внутри City session.
- [x] Пользователь одобрил formal/effective split и обычное green/red поведение после решения.
- [x] Пользователь одобрил post-frontier resolution lifecycle, replacement semantics и exhaustion.
- [x] Пользователь одобрил architecture/storage boundary, protocol/recovery и acceptance scope.
- [x] Пользователь проверил и явно одобрил этот точный письменный baseline 2026-08-12.
- [x] Направление canonical Product Charter/Glossary/Demo/Spec amendments утверждено этим baseline;
  точные правки входят в первый task implementation plan.
- [x] Exact implementation tasks составлены и утверждены implementation plan 2026-08-12.

Written design, canonical amendment, and implementation plan approvals are complete. Production implementation remains pending and may proceed only through approved tasks.
