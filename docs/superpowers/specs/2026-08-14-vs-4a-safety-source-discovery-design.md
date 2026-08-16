# VS-4A Safety Source Discovery: bounded official fallback и selectable yellow

| Поле | Значение |
| --- | --- |
| Статус | `approved` — разговорный дизайн и exact written text одобрены пользователем 2026-08-14 |
| Владелец решения | пользователь проекта |
| Дата | 2026-08-14 |
| Область | только municipal safety source discovery, Evidence, unknown semantics и city-marker projection внутри `VS-4A` |
| Зависимости | [VS-4A City Frontier baseline](./2026-08-13-vs-4a-city-frontier-design.md), exact City Catalog Revision, City Evidence pipeline, SURS municipality population |
| Written approval | пользователь явно подтвердил exact редакцию 2026-08-14 |
| Canonical effect | точечно supersedes baseline provider-free dependency для узкого search port, invariant 12, safety-subflow `REQ-CF-04`, unknown projection `REQ-CF-06`, `SCN-CF-04` и non-goal city-yellow marker |
| Не изменяет | catalog membership, four-fact atomic Knowledge, frozen ranking, required-mismatch exclusion, target-three/separate frontier-wide live-city limit, selection branching или country status |
| Split review | документ короче 250 строк и имеет одну ответственность |

Этот approved supplement заменяет только ранее согласованный single-route safety plan. Другие три
критерия не получают внешний поиск автоматически. Implementation plan обязан применять baseline
2026-08-13 вместе с указанным supersession. Runtime LLM остаётся запрещён, но safety получает узкий
внешний web-search port.

Существующие `2026-08-13-vs-4a-city-frontier*.md` implementation plans считаются
stale в частях provider-free safety, fixed-URL/no-discovery, candidate-failure и green-with-amber
projection. Перед исполнением их необходимо amend/regenerate; противоречащие tasks запускать нельзя.

## 1. Решение

Safety использует bounded external web discovery, когда последний успешный или заранее известный
официальный документ недоступен, устарел либо несопоставим. Поисковая система находит только
кандидатов и никогда не является authority или источником числового факта.

Один city safety check имеет фиксированный budget; он не является отдельным лимитом десяти live
городов всего City Frontier run:

- не более трёх versioned поисковых запросов;
- не более десяти unique document candidate URLs после canonical URL deduplication, включая previous,
  configured и discovered routes;
- не более двух переходов от search result внутри подтверждённой official publication chain;
- остановка после первого exact result за newest eligible year; до 1 July допустимый `Y-2`
  сохраняется как fallback, но поиск `Y-1` продолжается в пределах полного budget.

«Доверенных источников больше нет» означает только доказанное исчерпание этого budget в конкретном
check. UI не утверждает, что подходящего документа объективно не существует во всём интернете.

## 2. Trust boundary и принимаемый факт

Installed Slovenia package содержит versioned `OfficialAuthorityDirectory`:

- Police, GOV.SI, OPSI и SURS authority/host bindings;
- официальный host каждого муниципалитета из bound Catalog Revision;
- допустимые official document hosts, только когда связь с ними доказана страницей официального
  publisher;
- canonical redirect, media, size и document-locator policies;
- source-specific reuse/retention mode, разрешающий требуемый Evidence handling.

Название домена, search rank, snippet или TLS сами по себе не доказывают official status. Каждый
candidate проходит authority reconstruction и полную redirect-chain validation.

Safety fact принимается только при одновременном выполнении условий:

1. data authority — Police; publisher — Police либо официальный муниципалитет;
2. документ явно связывает total recorded offences с exact municipality из City Registry;
3. period — полный календарный год;
4. numerator — integer total police-recorded offences, а не convictions, perceptions, selected
   categories, offender residence или aggregate police district;
5. denominator — SURS municipality population на 1 January того же reference year;
6. freshness проходит `municipal-annual-july-boundary@1`;
7. approved retention/reuse policy допускает capture и внутреннюю проверку Evidence.

Freshness policy для assessment в году `Y`:

- с 1 January по 30 June включительно допускается `Y-2` или более новый завершённый год;
- с 1 July по 31 December требуется `Y-1`;
- candidate queue всегда предпочитает `Y-1`; до 1 July найденный `Y-2` используется только после
  исчерпания budget без подходящего `Y-1`;
- более старый exact document остаётся Evidence, но не становится verified value.

Canonical quantity хранит integer `offenceCount`, integer `population` и rational basis
`offenceCount * 100000 / population`. Domain comparison использует exact integers/cross
multiplication; display rounding не влияет на target comparison, score или ordering.

## 3. Source-plan и сохранение найденной ссылки

`CitySafetySourcePlan` привязан к exact `catalogRevisionId` и покрывает каждого catalog member.
Для города он хранит official identity/municipality binding, approved authorities/hosts, known
navigation/document routes, query-template version и freshness/definition versions. Полнота плана
означает наличие deterministic route к `verified | unknown`, а не известное значение для каждого
города.

Dynamic discovery не мутирует installed package. Принятый URL и все попытки принадлежат immutable
City Evidence Snapshot. Следующий live check сначала извлекает последний принятый official URL из
verified Evidence lineage, затем пробует configured routes и лишь потом внешний поиск.

Evidence Snapshot сохраняет:

- exact query strings, template/provider IDs, Evidence-clock `searchedAt` и ordered returned URLs;
- canonical candidate URL, publisher/navigation URL и redirect chain;
- authority/host decision, media metadata, capture hash и document locator;
- применённый retention/reuse policy ID и факт удаления transient raw copy, когда retention запрещён;
- reference period, municipality identifiers, numerator claim и SURS denominator reference;
- rejection reason каждого проверенного candidate;
- accepted official source URL либо terminal unknown basis;
- counters, подтверждающие соблюдение `3 queries / 10 document URL candidates / 2 hops`.

Search snippets не используются как claim. City Knowledge хранит compact typed fact и Evidence
references, но не raw bytes, search result text или дублированный attempt ledger. Stored read model
восстанавливает accepted и reviewed official links через verified Evidence graph.

## 4. Live flow и closed outcomes

Для safety-subcheck Application выполняет последовательность:

1. проверяет previous accepted URL, если он принадлежит exact city/definition lineage;
2. проверяет configured official routes;
3. формирует до трёх deterministic public queries только из official city/municipality names,
   reference year и versioned safety terms; profile или иные user data в запросы не входят;
4. добавляет provider results после previous/configured routes, дедуплицирует общую очередь и
   проверяет не более десяти document URL candidates, применяя trust policy;
5. для official navigation page следует максимум по двум подтверждённым official links;
6. принимает первый exact comparable `Y-1`; до 1 July удерживает exact `Y-2` как fallback и
   продолжает искать `Y-1` до исчерпания budget;
7. после budget принимает допустимый `Y-2` fallback либо закрывает subcheck evidence-backed unknown.

Candidate-level 404, stale period, broad geography, unsupported definition, wrong media, oversize
artifact, untrusted redirect или unapproved retention отклоняют candidate и продолжают поиск, пока
остаётся budget.

Terminal unknown reason определяется проверяемо:

- `source_unavailable` — provider/official transport либо approved retention policy не позволили
  завершить budget;
- `conflict` — один current official publication chain содержит несовместимые exact totals для того
  же municipality/year либо противоречит уже captured current same-year claim этого check;
- `stale` — найдены exact comparable official claims, но только за недопустимые periods;
- `not_comparable` — official material найден, но municipality scope или metric definition не подходит;
- `not_found` — полный budget завершён без official candidate.

Если применимы несколько причин, сохраняется полный rejection ledger, а terminal reason выбирается
по precedence: `conflict`, `source_unavailable`, `stale`, `not_comparable`, `not_found`.

Abort, cancel, internal protocol violation, Evidence/storage/integrity failure или unexpected
application error не превращаются в unknown: four-fact Knowledge Revision и frontier successor не
публикуются, cursor не движется. Bounded external failure является domain outcome только после
успешного Evidence seal.

## 5. Knowledge, ranking и marker semantics

City check по-прежнему обязан закрыть все четыре criteria и атомарно опубликовать полную
four-fact City Knowledge Revision. Старый safety value не переносится: неудачный current check
публикует explicit unknown.

Текущий frozen score/order не пересчитывается. Новая Knowledge Revision участвует только в future
ranking run; текущая карточка отдельно показывает frozen score и fresh verified coverage.

После durable four-fact publication marker вычисляется так:

- gray `Проверяется` — active check ещё не завершён;
- green `Доступен для выбора` — все четыре facts verified/comparable и required mismatch нет;
- yellow `Доступен с неполными данными` — хотя бы один fact unknown и required mismatch не доказан;
- red `Исключён` — только fresh comparable verified required mismatch.

Yellow остаётся selectable, занимает один из трёх terminal slots и не запускает replacement.
Selection фиксирует exact displayed unknown-warning basis как принятый риск без отдельного modal.
Source links не меняют selectability сами по себе.

Verified card показывает accepted source link, reference year, numerator/denominator basis и
`lastCheckedAt`. Yellow card показывает unknown reason, reviewed official links и причины, по которым
они не стали verified fact. UI называет budget exhaustion или transport failure точно и не говорит
об абсолютном отсутствии данных.

## 6. Replay, recovery и privacy

Presentation, reload и selection читают только sealed snapshots и выполняют zero search/official
HTTP. Повторная live-проверка возможна лишь новой явной Continue operation и создаёт новую Evidence
и полную Knowledge revision.

После transport loss durable Evidence/Knowledge/frontier head сохраняется. Если Evidence уже sealed,
retry переиспользует exact completed subcheck; неподтверждённый search progress не восстанавливается
как факт.

Search queries содержат только публичные official names, year и criterion terms. User profile,
targets, selections и personal data поисковому provider не передаются. Search provider и official
HTTP доступны только Infrastructure adapters через узкие inward ports; Decision, Experience и
persisted Knowledge от provider SDK не зависят. Runtime LLM не используется.

Repo fixtures содержат только минимальные aggregate projections, locators, headers и hashes. Raw
municipal PDF/HTML не коммитятся и не распространяются; transient capture хранится либо удаляется
строго по source-specific policy. Маршрут с непроверенным reuse/retention остаётся rejected и не
создаёт verified fact.

## 7. Acceptance и adversarial matrix

Обязательные tests/evidence:

- previous accepted URL за newest eligible `Y-1` проходит — search port не вызывается;
- с January по June previous accepted `Y-2` удерживается как fallback, но поиск `Y-1` продолжается;
- первый route недоступен, external search находит второй exact official document;
- stale/broad/missing-total candidates отклоняются, поиск продолжается;
- с January по June найденный `Y-2` не останавливает поиск `Y-1`, но становится verified fallback
  после полного budget; с 1 July тот же `Y-2` даёт `stale`;
- fake-government domain, untrusted redirect и snippet-only value никогда не принимаются;
- unapproved reuse/retention не создаёт verified fact; repo fixture не содержит municipal raw bytes;
- exact current municipality total + same-year SURS denominator создают verified rational fact;
- explicit zero numerator принимается, missing numerator никогда не становится zero;
- wrong-year, wrong-municipality или zero/missing denominator не создают verified fact;
- provider failure до полного budget даёт `source_unavailable`, а не ложный `not_found`;
- полное `3/10/2` exhaustion без eligible fallback даёт yellow selectable marker и занимает
  terminal slot; допустимый January–June `Y-2` fallback даёт verified fact;
- incompatible totals внутри одного current official chain дают `conflict` и не создают value;
- только verified required mismatch даёт persistent red и replacement;
- known-to-unknown не переносит value и обновляет semantic `knowledgeUpdatedAt`;
- accepted/reviewed URLs, hashes, locators и rejection reasons переживают reload;
- два canonical presentations равны и вызывают zero search/official requests;
- tampered query/result/URL/redirect/authority/locator/hash/budget counters fail closed;
- fixtures не содержат person/case rows, addresses, event descriptions или user data;
- official walkthrough использует isolated database и сохраняет точный Evidence graph.

## 8. Source readiness и граница slice

До hash-bound fresh positive exact-municipality fixture safety имеет статус
`candidate_available_with_partial_official_coverage`. После такого fixture, negative broad-scope
fixture, SURS denominator vector и trust/search-budget tests статус становится
`available_with_partial_official_coverage`.

Это criterion-level status. Общий Slovenia package остаётся `unavailable / NEEDS_CONTEXT`, пока
отдельные transit и broadband gates не закрыты. Unknown для части catalog cities допустим; неполный
manifest или непроверяемая trust policy недопустимы.

Вне scope: universal crawler, произвольные сайты, crowdsourced perceptions, media summaries,
runtime LLM, background search workers, изменение country color, rerank текущего run и перенос
старого safety value.

## 9. Следующий gate

Перечисленные safety/marker правила baseline 2026-08-13 superseded этой approved редакцией.
Следующая допустимая операция — amend/regenerate detailed implementation plan через
`writing-plans`. До approval обновлённого плана production code, schema, test scaffolding и source
installation остаются запрещены.
