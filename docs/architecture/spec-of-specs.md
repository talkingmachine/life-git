# Spec of Specs: вертикальные срезы Life Branches

| Поле | Значение |
| --- | --- |
| Статус | `approved` |
| Владелец решения | пользователь проекта |
| Последняя проверка | 2026-08-06 |
| Область ответственности | границы, порядок, зависимости и acceptance intent вертикальных срезов MVP |
| Supersedes | нет |
| Approval | пользователь проекта / 2026-08-06 / Stage 2 exact-text baseline / approved |

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
| `VS-3` Подтверждённый мировой shortlist | Global registry, десять starter dossiers, current-run verification, четыре marker states, до пяти confirmed countries и подтверждённые города работают как единый поиск. Stable shortlist объявляется только при отдельном stable stop condition; исчерпанный frontier может дать меньше пяти, а исчерпанный budget — preliminary result. Доступны причины red, unknown/conflict для yellow, next candidate и продолжение city frontier. | Top-5 ограничен показанными coverage, budget и датой; он не является доказанным мировым оптимумом. | Различаются три stop conditions, четыре marker states и country/city verdict semantics. |
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

Владеет цепочкой `captured source content -> applicability/freshness/conflict -> claim status ->
sealed Evidence Snapshot`, а также source manifests, dossiers, research runs, revisions и сохранённым
frontier.
Только Research может опубликовать подтверждённый claim.

### Decision

Владеет подтверждённым Profile Snapshot, hard constraints, preferences, candidate verdict, причинами
исключения, screening priority, scoring, ranking, stop conditions и связью страны с подтверждёнными
городами. Decision получает от Research проверенные claims, unknown или conflict, но не сырой HTML.

### Branch

Владеет выбранными городом, работой, жильём и допущениями, детерминированными расчётами,
projections и причинной lineage. Life Git является глубоким модулем Branch и единолично владеет
commit, rewind, fork, replay и diff.

### Experience

Карта, карточки, бюджет, timeline, Evidence Passport и visual diff являются read models поверх
опубликованных состояний. UI не создаёт факты, не повторяет формулы и не выносит verdict.

## 6. Направление зависимостей и cross-slice flow

Несколько явных application use cases координируют модули; Research, Decision и Branch не вызывают
друг друга напрямую. Experience и infrastructure зависят от use cases и домена, а предметные
модули не знают о framework, сети или способе хранения.

Official source и storage integrations остаются внешними зависимостями. Installed navigation
является только seed, а не evidence; только fresh capture и validators могут создать claim.

Модули обмениваются неизменяемыми versioned values: подтверждённым профилем, планом и frontier
исследования, candidate evidence и assessment, sealed evidence и shortlist snapshots, branch
snapshot/commit/diff и manifest одного run. Точные ports, schemas, serialization и adapter behavior
определяет JIT-спецификация первого среза, которому они нужны.

Поток направлен так:

```text
confirmed profile
  -> research plan and current-run evidence
  -> candidate assessment and sealed snapshot
  -> coherent life branch and commit
  -> Passport, visual output and fork/diff
```

## 7. Cross-slice инварианты

- Run-local assessment не становится durable verdict до sealing Evidence Snapshot; после sealing он
  обязан ссылаться на точные Profile Snapshot, Evidence Snapshot, coverage и дату.
- Gray означает, что проверка ещё идёт и verdict отсутствует.
- Red требует verified нарушения hard constraint. Красный country marker требует country-level veto;
  провал отдельного города исключает только этот город.
- Green требует прохождения всех critical conditions текущего scope и хотя бы одного
  подтверждённого города.
- Yellow означает завершённую без verdict проверку: critical evidence missing, stale или conflicts.
- Screening priority остаётся оптимистичной верхней границей final score; stable shortlist возможен,
  только когда score пятого не ниже upper bound каждого непроверенного кандидата.
- Evidence Snapshot после sealing не изменяется; продолжение frontier создаёт новую revision.
- Исторический snapshot разрешён для replay, но не является current-run verification.
- Branch commit неизменно связывает решение с resulting Life Branch Snapshot и версиями profile,
  evidence, правил и формул.
- Diff различает изменение решения, профиля, evidence и версии правил.
- UI не может обойти evidence, constraint или calculation rules.

Формальные `INV-*` присваиваются в доменной спецификации первого среза, который реализует правило.

## 8. Владение отказами

- Research владеет missing, stale и conflicting evidence, sealing и revisions. Неуспех critical
  verification даёт yellow; cache не превращает старый claim в fresh evidence.
- Decision владеет missing profile input, hard-constraint verdicts и тремя stop conditions. Он не
  создаёт final verdict при недостаточных входах.
- Branch владеет missing calculation input, projection classification и commit invariants. Он
  сохраняет unknown либо явное assumption и не создаёт invalid commit.
- Experience только показывает состояние владельца и не реализует собственный fallback verdict.

Точные retry, recovery и unsupported cases определяются в JIT-спеке затронутого среза. Они обязаны
быть ограничены approved research budget и не создавать параллельный pipeline.

## 9. Порядок спецификации и реализации

```text
feasibility spike
  -> VS-1
  -> VS-2
  -> VS-3
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
