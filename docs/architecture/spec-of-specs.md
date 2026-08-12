# Spec of Specs: вертикальные срезы Life Branches

| Поле | Значение |
| --- | --- |
| Статус | `approved` |
| Владелец решения | пользователь проекта |
| Последняя проверка | 2026-08-12 |
| Область ответственности | границы, порядок, зависимости и acceptance intent вертикальных срезов MVP |
| Supersedes | нет |
| Approval | пользователь проекта / 2026-08-06 / Stage 2 exact-text baseline; VS-3 place-frontier semantic amendment / approved 2026-08-12; VS-3R yellow-resolution amendment / approved 2026-08-12 |

## 1. Назначение

Этот документ разделяет MVP на независимо принимаемые вертикальные срезы и задаёт минимальные
архитектурные границы между ними. Он не выбирает стек, базу данных, конкретные официальные источники
или JSON-схемы: эти решения принимаются just-in-time в спецификации первого среза, которому они
необходимы.

Документ назначает cross-slice ownership, invariants и acceptance intent. Он не заменяет
requirements, contracts, recovery design или acceptance/eval checklist конкретного среза и не
разрешает начинать его реализацию.

Главный принцип декомпозиции — `demo spine`: каждый срез расширяет один работающий путь от
пользовательского input до проверяемого visual output. Горизонтальные подсистемы не реализуются
поочерёдно как самостоятельные платформы.

## 2. Принятый подход

- Первый walking skeleton обязан пройти через профиль, evidence, verdict, визуальную ветвь,
  Evidence Passport и минимальный Life Git.
- Life Git, Passport и evals появляются в первом срезе и углубляются вместе с пользовательским
  сценарием; они не откладываются в отдельные поздние фазы.
- Для MVP выбран один модульный монолит с одним deployment unit; контекст, варианты и последствия
  решения вынесены в [`ADR-001`](../decisions/ADR-001-modular-monolith.md).
- Архитектурные границы вводятся только там, где они скрывают доменное знание или изолируют
  изменчивую внешнюю зависимость.
- Каждый следующий срез переиспользует и расширяет существующий pipeline; постоянный обходной
  pipeline требует отдельного ADR и approval.

## 3. Предварительный feasibility spike

До технического дизайна `VS-1` выполняется один ограниченный эксперимент на одном-двух реальных
официальных источниках. Он обязан проверить:

- свежую загрузку и сохранение использованного содержимого;
- applicability, freshness, URL, время проверки и content hash;
- sealing и детерминированный replay evidence snapshot;
- фактические latency и стоимость current-run verification;
- возможность получить yellow при недоступном critical evidence.

Результат spike — измеренные ограничения и выбранный узкий source path для `VS-1`. Код эксперимента
может быть выброшен и не становится универсальным crawler, adapter SDK или скрытой реализацией MVP.

## 4. Вертикальные срезы

| Срез | Наблюдаемый результат | Явная граница | Acceptance intent |
| --- | --- | --- | --- |
| `VS-1` Одна подтверждённая жизнь и одна альтернатива | Подтверждённый профиль проходит небольшой заявленный набор свежих official claims для одного заранее выбранного country-city candidate. Пользователь видит локальный verdict, простую визуальную ветвь и бюджет, Evidence Passport, commit, изменение одного решения и fork/diff. | Нет top-5, global registry, десяти dossiers, общего cold start и полного набора визуализаций. Результат не называется глобальной рекомендацией. | Один live happy path; source outage даёт yellow; snapshot replay воспроизводим; один выбор создаёт причинный fork/diff. |
| `VS-2` Честный cold start | Пользователь вводит страну без глубокого dossier. Недостающие официальные источники находятся, claims проходят тот же validation pipeline, а валидированный результат публикует новую версию dossier и показывается отдельным comparator, даже если позднее не войдёт в top-5. | Один cold-start path; без универсального crawler и автоматического восстановления от любого сайта. | Страна без dossier проходит общий pipeline; неподтверждённый источник не публикует новую версию dossier. |
| `VS-3` Place frontier | Неизменяемый place ranking по установленным country packages, current-run formal verification, persistent planet history и до пяти разных green/yellow стран работают как единый поиск. Красные страны остаются на карте и заменяются следующими по ranking; yellow делает результат preliminary. | Первый implementation slice не включает city fit и десять country packages одним изменением. City frontier следует отдельно и не определяет цвет страны. Top-5 ограничен installed coverage, ranking snapshot и датой. | Green означает хотя бы один verified viable route; red требует complete all-impossible catalog; поиск завершается при пяти non-red либо exhaustion; replay сохраняет exact order и markers. |
| `VS-3R` Yellow Resolution | После VS-3 пользователь обязательно разрешает каждую formal yellow-страну; accepted yellow получает ordinary effective green, rejected — ordinary effective red и replacement. Terminal Resolved Country Shortlist Snapshot содержит до пяти effective green стран без unresolved yellow. | Не изменяет formal verdict/Evidence/Knowledge/VS-3 snapshots; не реализует City Registry, City Knowledge или city ranking. Automatic Shortlist Snapshot preliminary и не является City Frontier input. | Только verified terminal resolved snapshot с non-empty entries является future City Frontier input; accepted/rejected сохраняют formal-yellow provenance, ordering frozen, empty/exhausted result честен. |
| `VS-4A` City Frontier | Для одной effective green страны из non-empty Resolved Country Shortlist Snapshot отдельное future research формирует один–три подходящих города. | Не принимает automatic shortlist, working resolution revision или empty terminal; не меняет formal/effective status страны и не реализуется этим change-пакетом. | City Frontier получает только verified resolved-country input; country selection и city fit остаются разными выводами. |
| `VS-4` Полный фильм о жизни | Выбор города, работы и жилья формирует один согласованный сценарий: бюджет, запас накоплений, типичный день, timeline и осторожные projections. Passport разделяет типы информации, а Life Git показывает причинный visual diff. | Нет пятнадцати полных ветвей, точных вероятностей жизненных событий и окончательной юридической или налоговой консультации. | Расчёт воспроизводим; missing input не выдумывается; projection отделён от факта; diff показывает причинную lineage. |
| `VS-5` Конкурсное доказательство | Чистый canonical run показывает Input, Process, Evals и Output за подтверждённый после spike narrative budget. Есть live verification, cold start, один fork/diff, eval artifact, snapshot replay и один injected outage. | Recorded fallback маркируется датой и не подменяет работающий live end-to-end MVP. | Пройден чистый timed run, один injected outage и отдельно маркированный fallback. |

## 5. Архитектурные границы

### Pre-defense external-provider boundary

Для `VS-1..VS-5` runtime model/API calls равны нулю: в продукте нет provider SDK, credential,
feature flag или provider abstraction. Поддерживаемые страны получают только reviewable navigation
seeds из Country Registry/Country Source Index, после чего каждый новый run заново захватывает
official HTTPS bytes и применяет deterministic validators. Возможная внешняя LLM-assisted discovery
отложена в `BACKLOG-EXT-LLM-01` после защиты и до монетизации; её будущие предложения остаются
untrusted и проходят authority/schema gates, не создавая факт, provenance, расчёт или verdict.

### Research

Владеет цепочкой `captured source content -> applicability/freshness/conflict -> typed route/fact
status -> sealed Evidence Snapshot`, Country Knowledge revisions, country-local route catalogs,
completeness attestations и source navigation. Только Research публикует verified claim или
evidence-backed status observation.

### Decision

Владеет подтверждённым Profile Snapshot, `PreferenceProfile`, required/weighted criteria,
детерминированным `PlaceRanker`, factor projections и formal country verdict над typed route
outcomes и catalog completeness. Decision получает от Research проверенные claims, unknown или
conflict, но не сырой HTML; количество маршрутов не является ranking factor. Для `VS-3R` Decision
`CountryResolutionPolicy` детерминированно выводит effective status, unresolved queue, slots,
cursor и terminal condition из immutable formal markers и Yellow decisions.

### Application

`CountryFrontier` владеет activation, persistent marker history, red replacement, automatic-phase
stop и публикацией Ranking/Automatic Shortlist Snapshots. Он не ранжирует и не интерпретирует
evidence. `CountryResolution` владеет start от verified automatic snapshot, append Yellow decision,
replacement continuation и terminal Resolved Country Shortlist Snapshot; он не меняет formal verdict.
Only explicit replacement continuation may invoke CountryVerifierPort or make network calls. Start, yellow decision, presentation, and reload must make zero network calls.

### Infrastructure

SQLite хранит одну append-only resolution revision chain, проверяемую по immutable source graph;
existing Evidence, Country Knowledge и CountryVerifierPort переиспользуются для replacements.
Нового capture pipeline, event store, queue, worker или mutable head table нет.

### Branch

Владеет выбранными городом, работой, жильём и допущениями, детерминированными расчётами,
projections и причинной lineage. Life Git является глубоким модулем Branch и единолично владеет
commit, rewind, fork, replay и diff.

### Experience

Карта, карточки, бюджет, timeline, Evidence Passport и visual diff являются read models поверх
опубликованных состояний. Experience выводит effective status и resolution prompt только из
verified projection: accepted formal yellow рендерится ordinary green, rejected — ordinary red с
правдивым detail. UI не создаёт факты, не повторяет формулы и не выносит verdict.

## 6. Направление зависимостей и cross-slice flow

Несколько явных application use cases координируют модули; Research, Decision и Branch не вызывают
друг друга напрямую. Experience и infrastructure зависят от use cases и домена, а предметные
модули не знают о framework, сети или способе хранения.

Official source и storage integrations остаются внешними зависимостями. Installed navigation
является только seed, а не evidence; только fresh capture и validators могут создать claim.

Модули обмениваются неизменяемыми versioned values: подтверждённым профилем и preferences,
Country Knowledge/ResidenceRouteCatalog revisions, планом исследования, candidate evidence и
formal assessment, sealed Evidence/Ranking/Shortlist snapshots, branch snapshot/commit/diff и
manifest одного run. Точные ports, schemas, serialization и adapter behavior определяет
JIT-спецификация первого среза, которому они нужны.

Поток направлен так:

```text
confirmed profile + preferences
  -> current Country Knowledge revision set
  -> sealed Ranking Snapshot
  -> CountryFrontier + current-run formal verification
  -> Evidence Snapshot + optional Country Knowledge Revision
  -> persistent marker history + red replacement
  -> immutable Automatic Shortlist Snapshot (preliminary)
  -> CountryResolution / effective status / Resolved Country Shortlist Snapshot
  -> future separate city frontier (resolved non-empty input only)
  -> coherent life branch and commit
  -> Passport, visual output and fork/diff
```

## 7. Cross-slice инварианты

- Run-local assessment не становится durable verdict до sealing Evidence Snapshot; после sealing он
  обязан ссылаться на точные Profile Snapshot, Evidence Snapshot, coverage и дату.
- Gray существует только пока bounded verification реально выполняется.
- Green требует хотя бы одного verified viable long-term `ResidenceRoute`; city verification и fit
  не входят в формальный цвет.
- Yellow означает: green не найден, но unknown, stale, conflict, semantic mismatch или incomplete
  catalog не позволяют доказать невозможность.
- Red требует актуальной completeness attestation и verified невозможности каждого применимого
  `ResidenceRoute`; провал одного маршрута, required preference или города red не создаёт.
- Required preference mismatch исключает страну до sealing Ranking Snapshot, но не становится
  legal marker verdict.
- Ranking Snapshot неизменяем в течение run. VS-3 automatic frontier останавливается при пяти
  разных formal non-red странах либо exhaustion; это automatic-phase stop и его snapshot preliminary.
- VS-3R требует решения каждой formal yellow: `accepted_at_own_risk` даёт ordinary effective green,
  `rejected` — ordinary effective red без formal-impossibility claim и replacement из frozen ranking.
  Resolved Country Shortlist Snapshot содержит до пяти effective green без unresolved yellow и
  является единственным future City Frontier input.
- Current-run Knowledge update не меняет порядок и применяется только в новом run.
- Evidence Snapshot после sealing не изменяется; продолжение frontier создаёт новую revision.
- Исторический snapshot разрешён для replay, но не является current-run verification.
- Branch commit неизменно связывает решение с resulting Life Branch Snapshot и версиями profile,
  evidence, правил и формул.
- Diff различает изменение решения, профиля, evidence и версии правил.
- UI не может обойти evidence, constraint или calculation rules.

Формальные `INV-*` присваиваются в доменной спецификации первого среза, который реализует правило.

## 8. Владение отказами

- Research владеет missing, stale и conflicting evidence, sealing и Country Knowledge revisions.
  Unknown по одному маршруту даёт yellow только при отсутствии другого verified viable route;
  cache не превращает старый claim в fresh evidence.
- Decision владеет missing profile input, required filtering, place ranking и formal verdict rules.
- Application `CountryFrontier` владеет red replacement, exhaustion и `run_incomplete`.
- Branch владеет missing calculation input, projection classification и commit invariants. Он
  сохраняет unknown либо явное assumption и не создаёт invalid commit.
- Experience только показывает состояние владельца и не реализует собственный fallback verdict.

Точные retry, recovery и unsupported cases определяются в JIT-спеке затронутого среза. Bounded
source-attempt limits являются recovery boundary: их исчерпание превращает затронутый formal fact в
explicit unknown/yellow, а не создаёт отдельный shortlist budget stop или параллельный pipeline.

## 9. Порядок спецификации и реализации

```text
feasibility spike
  -> VS-1
  -> VS-2
  -> VS-3
  -> VS-3R
  -> VS-4A City Frontier
  -> VS-4
  -> VS-5
```

После approval этого документа полностью специфицируется только `VS-1`. До его реализации должны
быть утверждены наблюдаемый результат, scope и non-goals, основной и один значимый recovery
scenario, затронутые invariants, contracts, acceptance/eval checklist и implementation tasks.

Acceptance/eval checklist каждого среза содержит black-box happy path и по одному
репрезентативному failure class, способному нарушить truthfulness, данные или canonical demo.
Source fixtures не считаются fresh evidence пользовательского run; процент покрытия и
комбинаторный перебор не являются целями.

Каждый следующий срез проходит применимые Stages 3–9 just-in-time и использует результаты
предыдущего. Неприменимый документ не создаётся; несколько обязанностей можно объединить в одном
небольшом change-пакете при сохранении явных разделов.

## 10. Явные архитектурные не-цели

- микросервисы, event bus, CQRS/event sourcing и graph database только из-за Life Git;
- generic workflow/rules engine, adapter SDK и автоматический self-healing crawler;
- runtime provider SDK, multi-agent orchestration и plugin ecosystem;
- отдельные observability, knowledge-base и eval platforms;
- production auth, billing, multi-tenancy и mobile clients;
- universal legal/travel ontology и exhaustive country-specific prompts;
- новая abstraction до подтверждённого повторения ответственности.

## 11. Exit gate Stage 2

Stage 2 может стать approved, когда пользователь подтверждает точную редакцию этого документа и
проверено, что:

- каждый срез имеет самостоятельный visual output и acceptance intent;
- scope и acceptance intent VS-1 требуют реальный-source end-to-end path без фиктивного внешнего
  факта; фактический проход подтверждается только последующим runtime evidence;
- границы не дублируют evidence, verdict, calculations или Life Git;
- ошибки fail closed, а unknown не маскируется детерминированным текстом;
- зависимости позволяют специфицировать и реализовывать только один следующий срез;
- никакая заявленная сложность не существует только ради гипотетического будущего.
