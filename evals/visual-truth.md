# VS-1 visual-truth rubric

Статус: `not-run`. Этот checklist фиксирует только ручной 60–90-секундный gate и не заменяет
live provenance artifact.

## Preconditions

- Запущен production-like UI с synthetic profile и только локальной SQLite.
- Открыт новый run; устный комментарий демонстратора не нужен для понимания marker/scope.
- Проверяющий использует клавиатуру для интерактивных marker и Life Git controls.

## Timed walkthrough

| Время | Действие | Наблюдаемый критерий |
| --- | --- | --- |
| 0–15 с | Проверить стартовую карточку и изменить одно поле после общего подтверждения | Форма явно называет единственный технический маршрут Россия → Тирана; изменение снимает подтверждение snapshot. Solo-профиль остаётся полноценным сценарием. |
| 15–30 с | Запустить проверку | Карта занимает основной экран; видны самолёт, серый marker, spinner и текст «Проверка». До terminal result нет green/yellow/red verdict. |
| 30–40 с | Дождаться terminal state | Marker имеет и цвет, и отдельные icon/text semantics. Green сворачивает карту и не открывает popover. Yellow/red открывают краткую причину; официальный link показан только у source-backed reason. |
| 40–55 с | Открыть Evidence Passport | Official fact, user fact, calculation, assumption и unknown различимы визуально. Projection присутствует только у подтверждённого spouse route; для solo отсутствие projection явно корректно. У official source сначала видны human title/period/link, а claim ID, raw typed value и anchor находятся в secondary details. |
| 55–70 с | Зафиксировать C0 и создать C1 с другим жильём | Budget flow использует серверные значения; налоги и стоимость жизни остаются unknown. Diff называет только housing и зависимый residual, а profile/evidence/rules — reused. |
| 70–90 с | Перемотать к C0 | Возвращаются исходные cursor и budget, C1 diff исчезает, C0 не удаляется. Повторный C0/C1 action во время pending недоступен. |

## Pass rule

Gate получает `pass`, только если все строки выполнены без устной коррекции данных или scope.
Любое скрытое допущение, ссылка без фактического source lineage, green до terminal evidence либо
rewind только внутреннего cursor означает `fail` и требует нового run после исправления.
