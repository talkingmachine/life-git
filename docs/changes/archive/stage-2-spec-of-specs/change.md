# Change: Stage 2 Spec of Specs

| Поле | Значение |
| --- | --- |
| Статус | `archived` |
| Владелец решения | пользователь проекта |
| Последняя проверка | 2026-08-06 |
| Область ответственности | точная review-редакция декомпозиции MVP на вертикальные срезы |
| Supersedes | нет |
| Approval | пользователь проекта / 2026-08-06 / Stage 2 and ADR-001 exact text / approved and canonicalized |

## Почему

Stage 1 определил продукт и canonical demo, но предварительный Roadmap перечислял горизонтальные
capabilities. Их последовательная реализация могла создать большую платформу без раннего
пользовательского результата. Этот change-пакет заменяет такой риск на demo-spine из независимо
принимаемых вертикальных срезов.

Пакет объединён в один файл: отдельные proposal, design, tasks и validation дублировали бы
небольшой целевой документ и нарушали minimum sufficient complexity.

## Scope

- добавить [`spec-of-specs.md`](../../../architecture/spec-of-specs.md) со статусом `review`;
- добавить [`ADR-001`](../../../decisions/ADR-001-modular-monolith.md) со статусом решения `proposed`;
- определить walking skeleton, последующие срезы, модульные границы, cross-slice flow и boundary
  values;
- определить fail-closed ownership и acceptance intent;
- зафиксировать зависимости и just-in-time порядок спецификации;
- после exact approval обновить Stage 2 в `ROADMAP.md`, каноническую карту, открытые решения
  Product Charter и статусы review-документов;
- после канонизации перенести пакет в `docs/changes/archive/`.

Стек, JSON-схемы, starter countries, source manifests и реализация не входят в пакет. Миграция
реализации не требуется: код ещё не создан.

## Решение

- использовать demo-spine вместо реализации горизонтальных подсистем;
- включить минимальные Evidence Passport, evals и Life Git уже в `VS-1`;
- использовать один модульный монолит с границами Research, Decision, Branch и Experience;
- провести ограниченный source feasibility spike до технического дизайна `VS-1`;
- расширять один pipeline через `VS-1 -> VS-2 -> VS-3 -> VS-4 -> VS-5`;
- полностью специфицировать только следующий срез.

## Directional review, не являющийся exact-text approval

- [x] Пользователь проекта / 2026-08-06 / направление: demo-spine и минимальный Life Git в VS-1.
- [x] Пользователь проекта / 2026-08-06 / направление: карта срезов и их порядок.
- [x] Пользователь проекта / 2026-08-06 / направление: модульные границы и dependency direction.
- [x] Пользователь проекта / 2026-08-06 / направление: data flow, boundary values и инварианты.
- [x] Пользователь проекта / 2026-08-06 / направление: fail-closed error semantics.
- [x] Пользователь проекта / 2026-08-06 / направление: пропорциональная test/eval strategy.
- [x] Пользователь проекта / 2026-08-06 / направление: just-in-time зависимости и gates.

## Validation перед approval

- [x] Codex / 2026-08-06 / self-review: placeholders, scope, lifecycle, links, противоречия и
  независимые P1/P2 reviews проверены; найденные проблемы устранены.
- [x] Пользователь проекта / 2026-08-06 / exact-text approval `spec-of-specs.md` и `ADR-001`.

## Post-approval transition

- [x] Перевести `spec-of-specs.md` и документ `ADR-001` в `approved`, а решение `ADR-001` в
  `accepted`.
- [x] Канонизировать Stage 2 в `README.md`, `ROADMAP.md` и Product Charter.
- [x] Зафиксировать lifecycle/approval change-пакета и перенести его в `docs/changes/archive/`.

## Следующий этап после approval

Провести feasibility spike, затем создать отдельную requirements/design/acceptance спецификацию
только для `VS-1`. Реализация начинается после её собственного exact-text approval.
