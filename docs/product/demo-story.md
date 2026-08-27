# Canonical 3–5-minute Demo Story

| Поле | Значение |
| --- | --- |
| Статус | `approved` |
| Владелец решения | пользователь проекта |
| Последняя проверка | 2026-08-12 |
| Область ответственности | конкурсная драматургия и наблюдаемый end-to-end результат |
| Supersedes | нет |
| Approval | пользователь проекта / 2026-08-06 / Stage 1; VS-3 place-frontier semantic amendment / approved 2026-08-12; VS-3R yellow-resolution amendment / approved 2026-08-12; VS-4A city-frontier semantic amendment / approved 2026-08-13 |

## 1. Цель демо

За 3–5 минут доказать четыре вещи:

1. продукт понимает индивидуальную ситуацию, а не заполняет типовой профиль;
2. исследование стран опирается на текущие официальные источники;
3. результат является визуальной и согласованной жизненной ветвью;
4. пользователь может изменить прошлое решение и сравнить альтернативу через Life Git.

## 2. Канонический профиль

Демо использует один заранее подготовленный, но честно обрабатываемый профиль:

- текущее место — Москва, Россия;
- гражданство РФ и действующие загранпаспорта у двух участников;
- основной пользователь — программист без высшего образования;
- сопровождающая — супруга, тоже программист, сейчас не работает;
- чистый доход основного пользователя — 210 000 рублей в месяц;
- удалённая официальная работа из-за рубежа возможна, точная форма договора неизвестна;
- накопления — диапазон 200 000–500 000 рублей;
- цель — сохранить уровень комфорта, получить развитую инфраструктуру, максимальную безопасность,
  спокойную обстановку и по возможности жить в Европе вне СНГ.

Этот fixture демонстрирует необязательных сопровождающих и не превращает пару в основной тип
пользователя.

## 3. Сценарий

Интервалы ниже — целевой narrative budget, а не подтверждённый runtime SLO. Feasibility spike обязан
подтвердить или скорректировать их до начала реализации demo slice.

### 0:00–0:35 — «Это я»

На экране появляется карточка человека. Пользователь вводит цель естественным языком. Система
выделяет профиль, сопровождающего, жёсткие ограничения, предпочтения и неизвестные значения.

Пользователь подтверждает карточку. Это `Input` AI workflow.

Что должен понять зритель: продукт начинает с конкретного человека, а не со списка популярных
стран.

### 0:35–1:30 — «Система исследует мир»

Карта разворачивается на весь экран. Первые страны frozen Ranking Snapshot получают flights и
серые markers; timeline показывает только фактические capture/validation events. Самолёты служат
декоративной метафорой движения исследования.

Маркеры переходят между состояниями:

- серый — formal verification выполняется;
- зелёный — подтверждён хотя бы один viable long-term ResidenceRoute;
- жёлтый — green не найден, но официальный пробел или incomplete catalog оставляет вопрос открытым;
- красный — полный применимый catalog проверен, и каждый маршрут доказанно невозможен.

Красный marker не исчезает: система запускает следующую по place relevance страну. Демонстратор
открывает red marker и показывает outcomes всех применимых routes, краткие blockers и official
sources. При наличии yellow открываются exact unknown и manual-check guidance.

Хотя бы одна страна без глубокого starter dossier проходит cold-start. На экране видны coverage,
дата проверки и факт обновления Country Knowledge. Отдельный custom cold start, если он показан в
демо, явно маркируется как comparator вне автоматического shortlist и не занимает его slot. Это
`Process` и часть `Evals` AI workflow.

Что должен понять зритель: цвет отвечает только на формальную возможность долгосрочного проживания.
Preference mismatch и неудача города не создают red; отсутствие evidence не маскируется под verdict.

### 1:30–2:15 — «Разрешаем формальную неопределённость»

При пяти разных formal non-red странах либо exhaustion automatic frontier останавливается, а карта
сохраняет все markers. Его Automatic Shortlist Snapshot preliminary: unresolved formal yellow
обязательна к разрешению до country choice и будущего City Frontier.

Интерфейс по frozen rank показывает exact unknown facts, official/manual links и решение
`accepted_at_own_risk` или `rejected`. После commit accepted yellow становится ordinary effective
green marker/card без special badge. Rejected yellow становится persistent ordinary effective red
marker; detail правдиво объясняет пользовательский отказ, не утверждая formal impossibility, и
запускает replacement из того же frozen ranking. Formal red replacements также остаются на планете;
replacement yellow вновь требует решения.

После всех решений интерфейс публикует Resolved Country Shortlist Snapshot из до пяти effective
green стран без unresolved yellow. При exhaustion допустим честный результат 0–4; empty terminal
не предлагает City Frontier.

Country cards показывают fit относительно текущей жизни отдельно от formal color и различают
Knowledge revision, использованную для ranking, от verified updates текущего run. Evidence зелёных
кандидатов доступно здесь, а не в popover карты.

Пользователь выбирает effective green страну только из non-empty Resolved Country Shortlist
Snapshot. Только после этого отдельный City Frontier показывает полный installed
`City Catalog Revision` из максимум 100 городов: national capital, все explicitly typed first-level regional
capitals, затем largest comparable official urban centers до лимита с ordinal `cityId` tie-break.
Он показывает frozen `rank/score на момент старта`, а explicit Continue проверяет следующий city и
закрывает fresh four facts: безопасность, долгосрочную аренду, городской транспорт и fixed broadband.

Только fresh comparable verified required mismatch даёт red `Исключён` и replacement. Unknown не
закрывает слот: такой город остаётся green `Доступен для выбора` с amber warning ring, explicit
warning list и fresh `coverage после проверки`. После `three_selectable`, честного
`catalog_exhausted` либо десятого completed city check с `live_candidate_limit_reached` интерфейс
seal-ит terminal City Shortlist Snapshot. Последний случай явно показывает, что непроверенные catalog
candidates остались. При `1..3` entries выбор
города атомарно публикует City Selection Snapshot и City Branch Commit; выбор другого города того
же terminal образует sibling branch от одного `PreCityBranchCommit`. При terminal `0` CTA нет.

### 2:15–3:20 — «Собираем жизнь»

Система предлагает небольшой набор применимых решений:

- сохранить текущую удалённую работу или выбрать подходящую профессию;
- увидеть официальный сигнал дохода для профессии и города;
- выбрать жильё;
- учесть обязательные и разовые расходы;
- проверить запас накоплений.

Каждый выбор изменяет один общий сценарий. Интерфейс не рассчитывает пятнадцать полных ветвей
заранее и не выдаёт независимые фильтры за цельную жизнь.

### 3:20–4:15 — «Фильм о возможном будущем»

Ветка раскрывается визуально:

- поток месячного бюджета;
- типичный день;
- двенадцатимесячная шкала переезда и адаптации;
- диапазоны нагрузки, сна, стресса, социального контекста и карьеры;
- факторы риска выгорания без псевдоточной вероятности.

Evidence Passport разделяет пользовательские факты, официальные факты, расчёты, projections,
допущения и unknown. Рядом компактный eval artifact показывает результат последнего golden run:
проверку provenance, hard constraints, fail-closed и воспроизводимости snapshot. Пользователь может
открыть evidence и перейти к первоисточнику.

Это основной `Output` AI workflow.

### 4:15–4:50 — «Вернуться и прожить иначе»

Пользователь возвращается к выбору города, работы или жилья и меняет его. История не стирается:
Life Git создаёт fork и показывает visual diff.

Зритель видит не только новые цифры, но и причинную связь: какое решение изменилось, какие расходы,
распорядок и риски пересчитались, какое evidence осталось общим.

Финальная реплика:

> Life Branches не выбирает за тебя жизнь. Он позволяет безопасно прожить несколько вариантов до
> того, как один из них станет реальностью.

## 4. Явное Input → Process → Evals → Output

| Часть | Что показывается в демо |
| --- | --- |
| Input | профиль, сопровождающие, цель, ограничения, предпочтения и unknown |
| Process | frozen place ranking, current-run official verification, mandatory Yellow Resolution, derived effective status, persistent marker history, replacement, Country Knowledge write-back, frozen City Catalog ranking, fresh four-fact city verification и terminal city selection |
| Evals | отдельный eval artifact с результатами provenance, constraint, fail-closed и reproducibility checks |
| Output | Resolved Country Shortlist Snapshot с effective green composition, terminal City Shortlist Snapshot, atomic city selection/branch, визуальная ветвь, Evidence Passport и Life Git diff |

## 5. Demo readiness gate

- Полный сценарий должен работать из чистого запуска без скрытой ручной подмены результата.
- Итоговая репетиция должна укладываться в 3–5 минут.
- Пользовательски значимый результат должен появиться не позднее 90-й секунды.
- Перед выступлением выполняется preflight доступности нужных официальных источников.
- Записанный fallback допустим только с явной маркировкой записи и времени evidence snapshot.
- Fallback страхует выступление, но не заменяет работающий end-to-end MVP при проверке готовности.

Точные runtime thresholds и содержимое eval artifact подтверждаются feasibility spike и после
этого переносятся в evaluation spec.

## 6. Что не показываем

- длинный tour всех экранов;
- внутреннюю документационную систему;
- полный список стран и источников;
- несколько архитектурных альтернатив;
- exhaustive edge cases;
- пятнадцать детальных жизненных ветвей;
- presets `safe`, `balanced`, `ambitious` или `custom`.

Архитектура и сложные компромиссы объясняются после основного пользовательского результата и
только в объёме, который помогает жюри понять инженерный вклад.
