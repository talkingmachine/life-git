# ADR-001: модульный монолит для MVP

| Поле | Значение |
| --- | --- |
| Статус документа | `approved` |
| Статус решения | `accepted` |
| Владелец решения | пользователь проекта |
| Последняя проверка | 2026-08-06 |
| Область ответственности | deployment boundary и способ изоляции модулей MVP |
| Supersedes | нет |
| Approval | пользователь проекта / 2026-08-06 / ADR-001 exact text / accepted |

## Контекст

Life Branches — конкурсный pet-проект с одним canonical journey и ограниченным сроком. Домен требует
явно отделить evidence integrity, персональные verdicts и Life Git, но production scale,
независимые команды и независимый release lifecycle не входят в MVP.

Решение поддерживает minimum sufficient complexity и не-цели MVP из
[`Product Charter`](../product/charter.md), а также clean end-to-end run и ранний пользовательский
результат из [`Canonical Demo Story`](../product/demo-story.md). Оно не добавляет самостоятельную
ценность и существует только для реализации этих approved требований.

## Варианты

### 1. Модульный монолит — выбран

Один versioned deployment unit содержит Experience, application use cases и модули Research,
Decision и Branch. Границы поддерживаются published values и направлением зависимостей, а не сетью.

### 2. Монолит без предметных границ — rejected

Быстрее начать, но source parsing, verdicts, calculations и UI начнут разделять неявное знание.
Это создаст change amplification и затруднит fail-closed проверки.

### 3. Несколько сервисов — rejected

Позволяют независимый deployment, но добавляют сеть, versioned APIs, retries, observability и
согласованность данных без подтверждённой потребности конкурса или MVP.

## Решение

MVP реализуется как модульный монолит с одним deployment unit. Конкретные язык, framework,
persistence и способ доставки frontend определяет technical design `VS-1`.

Исходные зависимости направлены от Experience и infrastructure к application use cases и domain.
Research, Decision и Branch не общаются через сеть и не вызывают друг друга напрямую; их
координируют явные use cases.

## Последствия

- Walking skeleton проходит все границы без распределённой инфраструктуры.
- Evidence, verdict и Life Git сохраняют единственного владельца.
- Contract и domain tests могут выполняться без сети и UI.
- Модульная дисциплина обеспечивается структурой кода и tests, а не process isolation.
- Выделение сервиса допускается позже только при наблюдаемой независимой нагрузке, release need или
  security boundary и требует нового ADR.

## Не решает

ADR не выбирает стек, базу данных, hosting, LLM provider или конкретные source adapters.
