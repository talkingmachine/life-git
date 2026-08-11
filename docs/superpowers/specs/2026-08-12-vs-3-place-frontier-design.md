# VS-3 Place Frontier: формальная доступность и top-5 мест

| Поле | Значение |
| --- | --- |
| Статус | `draft` — conversational design approved, exact-text review pending |
| Владелец решения | пользователь проекта |
| Дата | 2026-08-12 |
| Область | ranking стран, формальная проверка проживания, пополняемый frontier, planet history и Country Knowledge revisions |
| Зависимости | `VS-2`, provider-free runtime design, Product Charter, Spec of Specs |
| Approval evidence | пользователь утвердил search model, planet behavior, architecture и phased boundary 2026-08-12 |
| Canonical effect | после exact-text approval supersedes прежние green-after-city, confirmed-city shortlist, upper-bound stability и research-budget stop rules; обновляет marker/top-5 glossary и demo wording |

Этот документ фиксирует утверждённый дизайн, но до exact-text approval не изменяет канонические
Product Charter, Spec of Specs или active change packages и не разрешает implementation.

## 1. Цель и наблюдаемый результат

`GOAL-PF-01`: пользователь наблюдает на планете, как система проверяет страны в порядке
персональной релевантности, сохраняет историю исключений и останавливается на пяти разных странах,
куда формально не доказана невозможность долгосрочного проживания.

Релевантность описывает место, а не визовый маршрут. Способы легализации являются внутренним
доказательством формальной доступности страны, не отдельными кандидатами и не множителем score.

Итог не называется доказанным «лучшим местом мира». Это top-5 внутри установленного Country
Knowledge coverage, зафиксированного profile/ranking snapshot и даты проверки.

## 2. Термины и закрытая семантика цвета

- `PlaceCandidate` — страна. В shortlist одна страна может присутствовать не более одного раза.
- `ResidenceRoute` — один официальный способ долгосрочного проживания внутри страны. Количество
  маршрутов не влияет на релевантность места.
- `RouteCatalogCoverage` — доказательство, что country-specific catalog покрывает все классы
  долгосрочного проживания из текущей официальной национальной taxonomy. Это не единая мировая
  ontology: completeness доказывается отдельно для каждой страны и даты.
- `Automated Frontier Coverage` — только страны, для которых установлены rankable Country Knowledge
  package и ResidenceRouteCatalogRevision. Неподдержанная пользовательская страна исследуется
  отдельным cold-start flow, но не заполняет slot автоматического frontier.
- `Country Frontier` — зафиксированный порядок ещё не завершённых PlaceCandidate.
- `Ranking Snapshot` — неизменяемые profile, preferences, Knowledge revision IDs, ranking rules и
  полный упорядоченный список стран текущего run.
- `Shortlist Snapshot` — неизменяемый итог или предварительное состояние frontier со всеми
  показанными маркерами и evidence lineage.

Цвет country marker отвечает только на вопрос о формальной возможности долгосрочно жить:

| Цвет | Значение | Влияние на frontier |
| --- | --- | --- |
| Серый | Проверка идёт; verdict ещё отсутствует | Место не считается завершённым |
| Зелёный | Подтверждён хотя бы один формально доступный ResidenceRoute | Страна занимает одно место в shortlist |
| Жёлтый | Ни один доступный маршрут пока не подтверждён, но официальный пробел, конфликт или неоднозначность не позволяют доказать невозможность | Страна занимает одно место и допускается к дальнейшему city research с предупреждением |
| Красный | Полный применимый catalog проверен, и каждый ResidenceRoute доказанно невозможен для profile | Страна исключается из shortlist, но marker навсегда остаётся в run |

`Green` означает доказанную формальную доступность маршрута, а не гарантию решения консульства,
соответствие предпочтениям или качество места. `Red` не разрешён после провала одного маршрута.
Приоритет закрыт: любой verified viable route даёт green независимо от неизвестности других
маршрутов. Yellow возможен только когда green не найден и остаётся incomplete/unknown route.
Red возможен только когда green и unknown отсутствуют, а полный catalog даёт all-impossible.

Формально доступный маршрут может требовать будущих действий. Unilateral actions — приобрести
insurance, зарегистрировать компанию или подать документы — показываются checklist. Admission и
job offer являются `contingentAction`: route может быть green только когда официально подтверждены
право пользователя претендовать на этот outcome и отсутствие текущего eligibility blocker; карточка
явно говорит, что outcome ещё не получен. Green не утверждает application-ready или approval.
Verified нарушение eligibility, неподъёмный для подтверждённых ресурсов mandatory threshold или
другой невыполнимый prerequisite исключают маршрут. Неизвестный официальный или personal fact
остаётся unknown и не превращается в green.

Безопасность, инфраструктура, аренда, климат, broadband и другие предпочтения отображаются
отдельными fit-сигналами `matches | trade_off | does_not_match | unknown`. Они влияют на ranking и
карточку, но не перекрашивают формальный marker. City research также не определяет цвет страны.
Preference criterion имеет mode `required | weighted`: verified mismatch required-критерия
исключает страну до формирования Ranking Snapshot, но не является legal red. Required unknown
остаётся uncertainty и получает conservative ranking bound.

## 3. Requirements и acceptance

- `REQ-PF-01` (`GOAL-PF-01`): система ранжирует разные страны по подтверждённым характеристикам
  места и user-confirmed Preference Profile.
  Acceptance: route count не входит ни в один ranking factor; каждый factor объясним; отсутствующее
  или несопоставимое значение остаётся conservative unknown; stale facts не входят как current;
  Ranking Snapshot неизменяем весь run.
- `REQ-PF-02` (`GOAL-PF-01`): формальный verdict страны строится из полного установленного
  ResidenceRoute catalog и current official Evidence.
  Acceptance: один verified viable route даёт green; complete all-red coverage даёт red; missing,
  stale, conflict, semantic mismatch или incomplete catalog дают yellow.
- `REQ-PF-03` (`GOAL-PF-01`): frontier пополняет красные страны следующими по place relevance.
  Acceptance: shortlist содержит пять разных green/yellow стран либо все страны Ranking Snapshot
  исчерпаны; red marker не удаляется; yellow считается non-red, но делает результат preliminary.
- `REQ-PF-04` (`GOAL-PF-01`): пользователь видит фактический поиск на планете.
  Acceptance: gray/progress driven только domain events; red/yellow marker открывает краткую причину
  и official links; все markers сохраняются после collapse и reload.
- `REQ-PF-05` (`GOAL-PF-01`): проверенные новые country facts публикуются в Knowledge Base.
  Acceptance: только verified claims или evidence-backed status observations создают append-only
  Country Knowledge Revision; partial yellow сохраняет подтверждённый subset/status; source failure
  без нового evidence не меняет knowledgeUpdatedAt.
- `REQ-PF-06` (`GOAL-PF-01`): run и его история воспроизводимы.
  Acceptance: Shortlist Snapshot связывает exact profile, ranking, knowledge, evidence и rules;
  reload/replay не используют сеть и не меняют порядок или marker states.

### NFR

- `NFR-PF-01 Official-only`: внешний fact, route condition и marker verdict требуют official source,
  exact capture, validator и sealed lineage.
- `NFR-PF-02 Provider-free`: до защиты runtime не использует внешний LLM, Codex API, provider SDK,
  API credential или отдельный billing.
- `NFR-PF-03 Truthful ranking`: score не скрывает unknown, не сравнивает несовместимые определения и
  не заявляет глобальный оптимум.
- `NFR-PF-04 Minimum sufficient complexity`: нет universal crawler, route ontology platform, event
  store, queue, graph DB, provider framework или exhaustive country test matrix.

## 4. Основные сценарии

### `SCN-PF-01 Red replacement`

Ranking Snapshot содержит не менее шести стран. Первые пять появляются на планете. Одна страна
получает red только после полного route coverage, остаётся интерактивным marker, а следующая страна
по ranking занимает освободившееся место. Run завершается с пятью разными non-red странами и
показывает exact composition `N formal green / M unresolved yellow`.

### `SCN-PF-02 Honest yellow`

Официальный источник одного применимого route недоступен или неоднозначен, а verified green route
нет. Страна получает yellow, остаётся в shortlist и допускается к city research. Карточка называет
точный unknown и предлагает проверить официальный факт самостоятельно.

### `SCN-PF-03 Exhausted installed frontier`

Automated Frontier Coverage закончился раньше пяти non-red стран. Система показывает меньший
`preliminary result`, полный red/yellow history и coverage. Uninstalled countries не создают yellow
slots, система не создаёт фиктивные страны и не называет результат top-5.

### `SCN-PF-04 Knowledge write-back and replay`

JIT check получает новые verified facts и один unresolved fact. Verified subset создаёт новую
Country Knowledge Revision; unresolved fact остаётся unknown. Текущий ranking не меняется.
Следующий новый run использует новую revision, а reload старого run воспроизводит прежний snapshot
без official HTTP.

## 5. Архитектурные границы

### Preference Profile и Place Ranker — Decision

`PreferenceProfile` является структурированным, подтверждённым пользователем value: criterion,
mode `required | weighted`, importance от 1 до 5 и direction/target. Required mismatch исключает
страну из ranking universe, но не создаёт legal red. Способ получения этого value — форма сейчас
или future assisted input — не входит в ranker.

`PlaceRanker` — pure deterministic Decision service. Он получает Preference Profile и одну
Country Knowledge revision на страну и возвращает ordered country codes, factor contributions,
coverage и stable tie-break. Route count, raw source content и model output ему недоступны.

Сравнение числовых facts разрешено только при совместимых definition, geography, period, unit и
denominator. Несовместимые facts помечаются `not_comparable`; missing не заменяется средним или
remembered value.

До sealing каждый evaluator применяет criterion-specific freshness policy к `assessmentAt` и
выбирает latest comparable official period `<= assessmentAt`. Stale, future, ambiguous или
incomparable fact становится unknown.

Каждый versioned criterion evaluator возвращает `match` в диапазоне `[-1, 1]` либо conservative
interval `[-1, 1]` для unknown. Ranker вычисляет screening lower bound:

```text
relevance = sum(importance × known_match_or_minus_one) / sum(importance)
coverage  = sum(importance for comparable facts) / sum(importance)
```

Unknown использует `-1` только как явно подписанную worst-case ranking boundary, не как значение
страны. Поэтому отсутствие evidence не награждается нейтральным баллом и остаётся видимым через
coverage.
Порядок: relevance descending, затем coverage descending, затем ISO country code. Formula,
criterion evaluator versions и factor contributions входят в Ranking Snapshot.

### Country Knowledge Base — Research publication/read model

Country Knowledge Base содержит сжатые verified facts для screening/ranking и navigation lineage,
но не raw bytes. Raw official responses остаются только в Evidence storage. Baseline и runtime
updates имеют один append-only revision contract.

Каждый fact observation хранит status `verified | superseded | expired | unresolved`, typed value
только для verified, definition, geography, unit, source identity, validator version, Evidence
reference, `capturedAt`, `publishedAt` при наличии, reference period, `effectiveFrom/effectiveTo`
при наличии и `verifiedAt`. Public country metadata выводит:

- `lastCheckedAt` — время последней завершённой попытки, производное от run/evidence records;
- `knowledgeUpdatedAt` — время последней evidence-backed revision с value, revalidation или
  подтверждённым изменением status;
- coverage/unknowns, чтобы одна свежая часть не выглядела как полное обновление страны.

Current projection на `assessmentAt` выбирает latest applicable observation per fact. Evidence-backed
superseded/expired/unresolved status маскирует старое value, не выдумывая замену. Новый verified
capture того же value создаёт revalidation revision; любое evidence-backed value/status изменение
обновляет knowledgeUpdatedAt. Network failure может изменить lastCheckedAt, но сам по себе не
создаёт observation; source-specific freshness всё равно превращает просроченное старое value в
unknown. Partial yellow публикует verified subset и evidence-backed status observations для
затронутых facts.

### Formal residence verification — существующий Research/Evidence pipeline

Для supported country установлен `ResidenceRouteCatalogRevision` и
`CatalogCompletenessAttestation`. Attestation содержит jurisdiction/authority, exact declared scope
и exclusions, official artifact/anchor, route-ID crosswalk, validator version и effective interval.
Catalog содержит все route classes из этого scope, applicability rules и navigation sources.
Declared scope для red обязан охватывать все official long-stay classes применительно к nationality
и profile; exclusions допустимы только с official доказательством неприменимости, а tourist stay
исключается по определению.
Отсутствующая taxonomy category, неактуальный listing, не доказанная исчерпываемость или исключение
без основания дают yellow `catalog_completeness_unprovable`.

Legal verdict имеет единый `verdictAsOf`. Effective intervals completeness attestation и всех
использованных route rules должны пересекаться на эту дату; missing/incompatible legal date даёт
yellow. Universal ontology не нужна: scope и completeness доказаны country-local official evidence.

Research проверяет маршруты в порядке практичности для profile, но этот порядок нужен только для
эффективности. Радикальные варианты — study, local employment, business и investment — не
исключаются из catalog. Первый verified viable route завершает страну green. Если green не найден,
red допустим только после verified невозможности каждого применимого route. Tourist-only stay не
считается ResidenceRoute.

Pipeline переиспользует official HTTPS capture, exact bytes, semantic/freshness validators, sealed
Evidence Snapshot, immutable dossier/revisions и offline replay из VS-2. Он не получает второй
crawler или alternate evidence path.

### Country Frontier — Application

`CountryFrontier` координирует Ranking Snapshot, country checks и Shortlist Snapshot. Он не считает
ranking и не интерпретирует legal facts. Его обязанности закрыты:

1. активировать первые пять разных стран из Automated Frontier Coverage;
2. сохранить marker при первом появлении;
3. принять typed green/yellow/red result;
4. заменить только red следующей страной Ranking Snapshot;
5. остановиться при пяти non-red или exhaustion;
6. опубликовать immutable Shortlist Snapshot и composition `green/yellow`.

### Planet experience — Experience

Experience проецирует domain events и snapshots. UI не меняет verdict, не ранжирует и не считает
маршруты. Existing globe, marker controls, progress timeline, source details и collapsed mode
переиспользуются; отдельная карта или workflow engine не создаются.

## 6. Data flow и фиксация ranking

```text
Profile Snapshot + Preference Profile
  + current Country Knowledge revision set
  + ranking/normalization version
  -> sealed Ranking Snapshot
  -> first five unique PlaceCandidate
  -> country JIT official verification
  -> Evidence Snapshot + optional Country Knowledge Revision
  -> formal marker verdict
  -> red replacement from the same Ranking Snapshot
  -> immutable Shortlist Snapshot
  -> country cards, then separate city frontier
```

Country Knowledge updates текущего run сразу видны в evidence/card details, но не пересчитывают
порядок sealed Ranking Snapshot. Они влияют только на новый run. Это предотвращает прыжки стран на
планете и сохраняет replay. Card отдельно подписывает factor snapshot «использовано для ranking» и
verified update «получено после ranking; применяется в следующем run».

## 7. Planet behavior

Пока frontier активен, globe занимает основной экран. Новая страна получает flight и gray marker.
Progress показывает реальные stages capture/validation; animation completion не создаёт event.

Marker после появления не удаляется:

- gray содержит текущий factual stage;
- red открывает список проверенных route outcomes, краткие blockers и descriptive official links;
- yellow открывает unresolved facts, links и manual-check guidance;
- green во время поиска не обязан открывать detail: verified evidence раскрывается в terminal cards.

Цвет дублируется icon и text. Red/yellow controls доступны с клавиатуры, сохраняют focus и не
зависят от WebGL. После stop condition globe сворачивается, но все markers и их controls остаются.
Рядом появляются cards пяти non-red стран либо честный smaller preliminary result. Любой yellow
делает terminal copy предварительным: UI показывает `N формально доступны / M требуют проверки`, а
не называет все пять подтверждёнными вариантами.

## 8. Failure semantics

- Uninstalled country не входит в Automated Frontier Coverage и не занимает slot. User-requested
  unsupported country проходит отдельный cold-start flow и может получить yellow
  `country_not_installed`, не изменяя automated shortlist.
- Missing/stale/conflicting/ambiguous official evidence, включая exhausted bounded HTTP retry:
  normal terminal yellow с exact blocker.
- Один impossible route при остальных unchecked: gray, пока Research продолжает; yellow, если
  оставшийся route невозможно разрешить; никогда не red.
- Gray существует только пока bounded attempt/retry реально выполняется. Unexpected protocol,
  decoder, storage или integrity failure завершает use case как `run_incomplete`; legal verdict и
  Shortlist Snapshot не публикуются, UI сохраняет видимую partial history и предлагает retry.
- Retry создаёт новую run revision и не меняет sealed history.
- Evidence/Knowledge integrity mismatch: fail closed; knowledge revision и shortlist не публикуются.

## 9. Persistence и privacy

`RankingSnapshot` содержит profile/preference snapshot IDs, country revision IDs, ordered country
codes, factor projections, scoring/normalization version и createdAt. Free text, raw source bytes и
secrets в него не входят.

`ShortlistSnapshot` содержит rankingSnapshotId, ordered non-red countries, exact green/yellow
composition, все observed markers, formal verdict references, evidence/knowledge revision IDs и
stop condition. Он append-only. `run_incomplete` не является Shortlist Snapshot.

Historical replay читает exact snapshots и validators без сети. New current check всегда создаёт
новый run. Marker history принадлежит run и не становится общей пользовательской аналитикой.

## 10. Первый vertical slice и не-цели

Первый implementation slice строит frontier, formal color correction и Country Knowledge revision
поверх реально установленных country packages. Ranking universe заранее ограничен Automated
Frontier Coverage. Если его недостаточно для пяти non-red, UI обязан показать preliminary country
shortlist. Каждая следующая страна добавляется отдельным bounded evidence package с official
feasibility spike, source navigation, completeness attestation и validators.

В первый slice не входят:

- автоматическая поддержка всех стран;
- десять глубоких dossiers одним изменением;
- city safety/rent/transit/broadband implementation;
- job, housing, taxes, budget или life simulation;
- ML/LLM ranker, prompts или provider abstraction;
- stable-world-optimum proof, Pareto engine или exhaustive route ontology;
- layout matrix и combinatorial country tests.

Canonical amendment этого slice обязан удалить старый invariant «green требует confirmed city».
Если personal/formal inputs вроде passport validity, mandatory resource amount или applicable FX
отсутствуют, страна остаётся yellow именно из-за formal unknown, а не из-за непроверенного города.

## 11. Verification strategy

Минимальный набор:

1. Pure ranker test: place order объясним, stale/unknown использует conservative boundary, required
   mismatch исключается, и order не меняется при добавлении route identities.
2. Frontier test: пять unique countries; red marker сохраняется; next ranked country занимает slot.
3. Formal verdict table: green precedence при viable+unknown; complete all-impossible с effective
   completeness attestation -> red; no-green incomplete/unknown -> yellow; one failed route plus
   unchecked route не red; contingentAction не заявляет полученный outcome.
4. Knowledge publication test: verified/revalidation/status append, partial yellow subset, exact
   dates/current projection, stale masking и network failure не меняет knowledgeUpdatedAt.
5. Snapshot/replay test: mid-run knowledge update не меняет order; reload делает zero network и
   exact marker/card projection.
6. Один experience test для gray -> red -> replacement -> preliminary/terminal collapse,
   green/yellow composition и red/yellow details; run_incomplete не публикует shortlist.
7. Один browser E2E на реально installed country packages; smaller preliminary result допустим и
   должен называться честно.

Не создаётся отдельный eval platform. Existing test/runtime boundaries остаются владельцами
соответствующих invariants.

| Scenario | Requirements | Decisions | Verification |
| --- | --- | --- | --- |
| `SCN-PF-01` | `REQ-PF-01`; `REQ-PF-02`; `REQ-PF-03`; `REQ-PF-04` | `DEC-PF-01`; `DEC-PF-02` | 1; 2; 3; 6; 7 |
| `SCN-PF-02` | `REQ-PF-02`; `REQ-PF-03`; `REQ-PF-04`; `REQ-PF-05` | `DEC-PF-02`; `DEC-PF-03` | 3; 4; 6 |
| `SCN-PF-03` | `REQ-PF-03`; `REQ-PF-04` | `DEC-PF-01`; `DEC-PF-04` | 2; 6; 7 |
| `SCN-PF-04` | `REQ-PF-01`; `REQ-PF-05`; `REQ-PF-06` | `DEC-PF-03`; `DEC-PF-05` | 4; 5 |

`NFR-PF-01` проверяется formal verdict, knowledge publication и browser evidence tests;
`NFR-PF-02` — repository/provider-surface audit; `NFR-PF-03` — ranker and snapshot tests;
`NFR-PF-04` — scoped architecture review и отсутствие новых platform abstractions в diff.

## 12. Решения и отклонённые альтернативы

- `DEC-PF-01 Country-first ranking`: rank unit — country/place, не `country + route`. Иначе одна
  страна занимает несколько slots, а route count искажает relevance.
- `DEC-PF-02 Separate formal color from fit`: marker color означает только formal residence
  availability. Иначе безопасный, дорогой или непонравившийся город смешивается с legal veto.
- `DEC-PF-03 Verified append-only Knowledge`: verified facts возвращаются в Knowledge Base новой
  revision. In-place overwrite теряет lineage; запись unknown создаёт ложную память.
- `DEC-PF-04 Persistent rejected markers`: red не исчезает. Удаление скрывает исследовательскую
  работу и лишает пользователя причины исключения.
- `DEC-PF-05 Frozen ranking per run`: current run не re-rank после knowledge write-back. Live
  re-ranking ломает воспроизводимость и заставляет planet/cards прыгать.

Отклонены global route frontier, fixed batches, route-count score, green-after-city, disappearing red
markers, runtime LLM ranking, remembered official facts, unsupported-yellow automated slots и
автоматический universal country crawler.

## 13. Exact-text review gate

Перед implementation planning пользователь должен утвердить этот exact text. После approval
отдельный narrow change package обязан:

1. поправить Product Charter, Spec of Specs, glossary, demo story и VS-2 marker semantics, включая
   прежние confirmed-city, upper-bound stability и research-budget stop rules;
2. зафиксировать requirements/design/tasks первого vertical slice без добавления city scope;
3. провести отдельный source feasibility gate перед каждым новым country package.

До этого active readiness и production behavior не меняются.
