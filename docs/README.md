# Документация проекта жизненных сценариев

| Поле | Значение |
| --- | --- |
| Статус | `approved` |
| Владелец решения | пользователь проекта |
| Последняя проверка | 2026-08-07 |
| Область ответственности | карта канонической документации и точка входа |
| Supersedes | нет |
| Approval | пользователь проекта / 2026-08-06 / Stage 1 and Stage 2 baselines / approved |

`Life Branches` используется как рабочее название и не считается утверждённым брендом.
Документация создаётся с чистого листа для конкурсного pet-проекта. Обсуждения, прототипы и
исследования являются входом discovery, но не заменяют подтверждённые требования.

## Источники истины

При противоречии действует следующий приоритет:

1. [`CONSTITUTION.md`](CONSTITUTION.md) — правила создания, проверки и изменения документации.
2. Подтверждённые Product Charter, product requirements, domain specs, UX specs, architecture и contracts.
3. Действующие ADR со статусом решения `accepted`.
4. Подтверждённые change-specs, ещё не перенесённые в канонические документы.
5. Проверенные исследования, эксперименты и eval results.
6. Черновики, прототипы и история обсуждений.

Документ нижнего уровня не может молча переопределить документ верхнего уровня. Изменение получает
явную ссылку `supersedes` и проходит предусмотренный review gate.

## Подтверждённый baseline Stage 0

| Документ | Статус | Ответственность |
| --- | --- | --- |
| [`CONSTITUTION.md`](CONSTITUTION.md) | `approved` | правила hybrid SDD и human gates |
| [`README.md`](README.md) | `approved` | карта документов, статусов и навигации |
| [`ROADMAP.md`](ROADMAP.md) | `approved` | порядок спецификации проекта и exit gates |

Точная review-редакция трёх документов Stage 0 подтверждена пользователем 2026-08-05. Product
Charter и MVP baseline подтверждены 2026-08-06; архитектурная граница MVP утверждена в Stage 2,
стек ещё не выбран.

## Подтверждённый baseline Stage 1

| Документ | Статус | Ответственность |
| --- | --- | --- |
| [`product/charter.md`](product/charter.md) | `approved` | аудитория, обещание, ключевая семантика, MVP и цели |
| [`product/glossary.md`](product/glossary.md) | `approved` | однозначные термины Stage 1 |
| [`product/demo-story.md`](product/demo-story.md) | `approved` | канонический 3–5-минутный конкурсный сценарий |

## Подтверждённый baseline Stage 2

| Документ | Статус | Ответственность |
| --- | --- | --- |
| [`architecture/spec-of-specs.md`](architecture/spec-of-specs.md) | `approved` | срезы, cross-slice ownership, зависимости и acceptance intent |
| [`decisions/ADR-001-modular-monolith.md`](decisions/ADR-001-modular-monolith.md) | `accepted` | deployment boundary и модульная изоляция MVP |

Точная редакция Stage 2 и ADR-001 подтверждена пользователем 2026-08-06.

## Текущие discovery-входы

| Материал | Класс | Роль |
| --- | --- | --- |
| [`../pet-projects-2026-summary.md`](../pet-projects-2026-summary.md) | research | условия конкурса, критерии 100 баллов и AI workflow |
| [`time-travel-cards.html`](../.superpowers/brainstorm/37289-1785835975/content/time-travel-cards.html) | prototype | исследование визуального Life Git UX |
| [`country-search-map-v1.html`](../.superpowers/brainstorm/60878-1785922587/content/country-search-map-v1.html) | prototype | исследование country-search UX и marker states |
| Текущая история обсуждения | discovery | согласованные направления и открытые продуктовые вопросы |

Discovery-вход может содержать сильную идею или согласованное намерение, но его точная семантика и
границы становятся нормативными после переноса в подходящий документ со статусом `approved`.

Служебные файлы `.superpowers/brainstorm/**/state`, `.last-port` и `.last-token` не относятся к
проектной документации и не должны попадать в будущий репозиторий или публикацию.

## Документы на review

| Документ | Статус | Ответственность |
| --- | --- | --- |
| — | — | Нет документов, ожидающих exact-text approval |

## Активные change-пакеты

| Пакет | Следующий gate |
| --- | --- |
| [`vs-1-confirmed-life`](changes/active/vs-1-confirmed-life/change.md) | Baseline `approved`; [implementation plan](superpowers/plans/2026-08-07-vs-1-confirmed-life.md) готов к execution choice |

## Архив change-пакетов

| Пакет | Результат |
| --- | --- |
| [`stage-1-product-charter`](changes/archive/stage-1-product-charter/change.md) | канонизирован 2026-08-06 |
| [`stage-2-spec-of-specs`](changes/archive/stage-2-spec-of-specs/change.md) | канонизирован 2026-08-06 |
| [`vs-1-source-feasibility-spike`](changes/archive/vs-1-source-feasibility-spike/change.md) | утверждён 2026-08-06; выбран CBR daily XML source path |

## Планируемая структура

```text
docs/
  README.md
  CONSTITUTION.md
  ROADMAP.md
  product/
    charter.md
    glossary.md
    demo-story.md
    requirements.md
    scenarios.md
  domain/
    profile.md
    scenario-graph.md
    evidence-model.md
    calculation-model.md
  ux/
    experience.md
    visualizations.md
    evidence-passport.md
  architecture/
    spec-of-specs.md
    context.md
    components.md
    data-flow.md
  contracts/
    README.md
    sources.md
    errors.md
  security/
    privacy-and-data.md
    threat-model.md
  evaluation/
    strategy.md
    datasets.md
    traceability.md
  decisions/
    README.md
    ADR-NNN-short-title.md
  changes/
    active/<change-id>/
    archive/<change-id>/
```

Структура уточняется через approved change-spec. Указанный путь описывает навигационную модель, а
не обещание создать каждый файл или реализовать соответствующий компонент.

## Как читать документацию

- Чтобы понять ценность, аудиторию и границы MVP, начинайте с `product/charter.md`.
- Чтобы увидеть конкурсный рассказ и основной путь, используйте `product/demo-story.md`.
- Чтобы проверить обязательное поведение, используйте requirements и scenarios.
- Чтобы понять Life Git, Evidence Passport и расчёты, используйте domain specs.
- Чтобы проверить визуальную семантику, используйте UX specs, а не скриншоты прототипа.
- Чтобы понять границы модулей и внешние данные, используйте architecture и contracts.
- Чтобы проверить качество AI workflow, используйте evaluation и traceability.
- Чтобы понять причину нетривиального решения, найдите его ADR.

## Текущий этап

Stage 2 из [`ROADMAP.md`](ROADMAP.md) утверждён 2026-08-06; feasibility spike утверждён и архивирован.
Компактная JIT requirements/design/acceptance спецификация `VS-1` утверждена 2026-08-07;
implementation plan создан, продуктовая реализация ещё не начата.

Реализация не начинается из устного контекста. Первый вертикальный срез допускается к реализации
только после собственных approved requirements, design, acceptance/eval criteria и задач.
