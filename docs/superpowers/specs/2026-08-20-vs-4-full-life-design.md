# VS-4 Full Life: согласованная ветвь и фильм о возможной жизни

| Поле | Значение |
| --- | --- |
| Статус | `approved` |
| Владелец решения | пользователь проекта |
| Дата | 2026-08-20 |
| Область | путь после terminal City Selection до первой ветви и одной альтернативы |
| Зависимости | verified City Selection, Profile/Preference snapshots, Evidence Passport, Life Git |
| Supersedes | VS-1 housing-only branch как финальную глубину; deterministic-only film projection |
| Approval | пользователь проекта / 2026-08-20 / exact-text / approved |

## 1. Цель и наблюдаемый результат

После выбора города пользователь собирает одну согласованную версию жизни на едином экране:
выбирает работу и жильё, проверяет расходы и запас накоплений, затем получает визуальный типичный
день и 12-месячную шкалу переезда. Все результаты остаются прослеживаемыми до official facts,
user facts, calculations, assumptions, projections и unknown.

Пользователь может изменить одно из основных решений и увидеть одну альтернативу с причинным diff.
Продукт не перебирает сценарии автоматически и не показывает универсальный граф решений.

## 2. Вход и граница доверия

`VS-4` начинается после проверенной City Selection Snapshot и соответствующего City Branch Commit.
Его первый собственный шаг — явный route selector; продукт не выбирает маршрут автоматически.

Для formal-green страны пользователь выбирает один verified available residence route. Для страны,
которая стала effective green через `accepted_at_own_risk`, selector показывает exact unresolved
route outcome, а при его отсутствии — `route_unresolved`, связанный с принятым formal-yellow
решением. Такой basis никогда не называется verified: route-dependent facts остаются unknown,
пока не получено применимое Evidence. Так accepted yellow не превращается ни в ложный verified
route, ни в тупик после City Frontier.

После выбора route basis ветка связывает exact:

- Profile и Preference snapshots;
- resolved country и selected city;
- City Knowledge/Evidence lineage и принятые city warnings;
- residence route basis, его trust class и Evidence lineage;
- выбранные work/housing decisions;
- calculation и projection versions.

City unknown остаётся selectable: marker и card зелёные, но имеют янтарное кольцо и явный список
warning. Этот статус не называется yellow и не смешивается с formal country-yellow. Выбор города
фиксирует показанные warnings без дополнительного modal.

Route basis задаёт применимые документы, страховку, обязательные платежи и route-specific события
12-месячной timeline. Недостающие route inputs собираются в начале конструктора; другой route нельзя
подмешать в расчёт или projection. До baseline commit route можно изменить в selector. После commit
route зафиксирован; его смена не входит в competition Life Git alternative, которая ограничена
городом, работой или жильём.

## 3. Один экран-конструктор

Экран принадлежит `VS-4`: сначала он показывает route selector, затем четыре последовательных
editable блока и расположенный рядом единый preview:

1. Работа.
2. Жильё.
3. Ежемесячные и разовые расходы.
4. Запас накоплений.

Изменение входа обновляет только текущий draft preview. Сохранение проходит одной ограниченной
последовательностью: проверить draft → локально сгенерировать и проверить film → дать пользователю
возможность внести правки → одним явным действием атомарно сохранить branch, film, lineage,
Passport и commit. До этого существует только draft. Ошибка генерации не создаёт частичный commit.
Продукт не строит пятнадцать ветвей заранее.

На узком экране блоки и preview становятся одной упорядоченной колонкой; известные значения,
unknown и provenance не скрываются ради компактности.

## 4. Работа

Пользователь выбирает один из двух режимов.

### `Сохранить текущую работу`

Используются подтверждённые пользователем доход, валюта, net/gross basis и условия продолжения
работы. Возможность продолжения не выводится моделью и не превращается в official fact.

### `Выбрать новую профессию`

Пользователь выбирает профессию только из поддерживаемого installed списка. Карточка показывает:

- применимость к известному образованию/опыту;
- официальный городской или национальный salary signal;
- scope, reference period, unit и Evidence link;
- unknown, если применимого comparable signal нет.

Salary signal не является вакансией, job offer или гарантированным заработком. Модель не создаёт
профессию, применимость или доход. Свободная профессия без installed definition не входит в
конкурсный `VS-4`.

## 5. Жильё

Продукт показывает небольшой installed набор поддерживаемых типов жилья. Если для выбранного города
есть comparable official long-term-rent reference/range, он остаётся видимым. Если rent fact имеет
status unknown, UI честно показывает unknown и предлагает только необязательное user assumption;
официальный диапазон не подразумевается. Пользователь выбирает один тип.

Стоимость можно изменить вручную. Тогда:

- официальный ориентир остаётся видимым;
- изменённая стоимость маркируется как user assumption;
- расчёты используют явно выбранное пользовательское значение;
- Passport сохраняет обе величины и их разные классы.

Конкретные объявления, short-term rent, booking и контакт с арендодателем не входят в `VS-4`.

## 6. Расходы

### Ежемесячные категории

- аренда;
- коммунальные услуги;
- питание;
- транспорт;
- связь;
- страховка;
- обязательные платежи.

### Разовые категории

- переезд;
- депозит за жильё;
- оформление документов;
- первоначальное обустройство.

Каждое значение имеет один видимый класс: official reference, user fact, user assumption или
unknown. Категория не становится нулём из-за отсутствия comparable source.

Пользователь может заменить unknown собственным значением. Такое значение является assumption и
не меняет сохранённый unknown official status.

## 7. Бюджет и запас накоплений

Каждая ветвь имеет одну destination calculation currency. Доход, накопления и расходы в другой
валюте переводятся только по official FX reference с сохранёнными source, rate и reference date.
Если comparable FX отсутствует, затронутая сумма и зависимый итог остаются unknown.

Доход и расходы участвуют в одном расчёте только при совместимом basis. Gross salary signal не
становится net budget без verified conversion rule или явной user assumption. Per-person и
household values масштабируются только когда source definition разрешает это и известен размер
домохозяйства; иначе результат остаётся unknown.

Расчёт показывает:

- выбранный месячный доход либо его официальный signal range;
- сумму известных ежемесячных расходов;
- известный месячный остаток;
- отдельный список расходов, не вошедших из-за unknown;
- сумму известных разовых расходов;
- диапазон доступных накоплений после известных разовых расходов;
- диапазон срока запаса накоплений, когда его можно вывести без ложной точности.

Минимальная и максимальная границы накоплений рассчитываются отдельно. Среднее значение не
используется. Для monthly-result interval `[resultMin, resultMax]` действует одна таблица:

| Monthly result | Runway output |
| --- | --- |
| `resultMax < 0` | конечный interval: `savingsMin / abs(resultMin)` … `savingsMax / abs(resultMax)` |
| `resultMin >= 0` | «накопления не расходуются известным дефицитом», без числа месяцев |
| `resultMin < 0 <= resultMax` | только нижняя оценка `savingsMin / abs(resultMin)` и пометка, что верхняя граница не определена |

Если savings после известных one-time расходов ниже нуля, соответствующая граница принимается за
ноль. Unknown в любом зависимом input отменяет точный interval и остаётся рядом с результатом.
Ветка может быть создана с unknown, если пользователь видит неполноту и не подменяет её фактом.

Формулы используют decimal arithmetic и versioned calculation rules. UI не пересчитывает бюджет
собственной альтернативной формулой.

## 8. Фильм о возможной жизни

Локальная модель получает закрытую структурированную projection ветви и создаёт:

- типичный будний день;
- 12-месячную шкалу переезда и адаптации;
- осторожные диапазоны и факторы по нагрузке, сну, стрессу, социальному контексту и карьере;
- краткий список факторов, способных изменить картину.

Model input различает official facts, user facts, calculations, assumptions и unknown. Модель не
имеет права:

- заполнять unknown;
- добавлять официальный факт или ссылку;
- менять calculation output;
- объявлять юридическую или финансовую применимость;
- давать числовую вероятность переезда, успеха, выгорания или жизненного события.

Результат всегда маркируется как projection. Пользователь может редактировать типичный день и
timeline. Изменённые части становятся user assumptions; исходная model projection сохраняется для
сравнения и lineage.

Model output является versioned closed document. Каждый segment содержит стабильный `segmentId`,
тип и exact `inputRefs` на route, facts, calculations, assumptions или unknown, из которых он
получен. Сохраняются версии local model, prompt/template, output schema и parameters. Competition
runtime обязан поддерживать один controlled seed/settings contract: одинаковый structured input
даёт byte-equivalent structured output на закреплённой build/device pair. Output проходит
schema/lineage guard и небольшой golden/adversarial acceptance set до показа.

Replay использует сохранённый output и никогда не запускает модель повторно. Alternative использует
ту же model/template/schema/parameters/seed; controlled check сначала воспроизводит baseline input
без изменения. В causal diff изменение текста считается следствием решения только если baseline
control byte-equivalent, изменился ровно заявленный decision input и `inputRefs` segment включают
его. Иначе UI называет результат новой projection, а не причинным эффектом.

Если локальная модель недоступна, обязательная генерация блокируется с явной ошибкой. Draft ветви
сохраняется, но deterministic/recorded fallback, retry loop и отдельное retry-действие не используются.
После восстановления модели пользователь снова использует обычное действие сохранения ветви;
отдельного retry state, фонового повтора или recovery-кнопки нет.

## 9. Evidence Passport

Passport является частью основного результата, а не техническим приложением. Для каждого
значимого элемента он показывает один класс:

- official fact;
- user fact;
- calculation;
- assumption;
- projection;
- unknown.

По умолчанию виден понятный summary. Source, scope, reference period, formula version и technical
lineage раскрываются по запросу. Редактирование assumption не скрывает исходный official reference.

## 10. Простая Life Git альтернатива

Первая подтверждённая жизнь создаёт baseline commit. Пользователь может вернуться к выбору города,
работы или жилья и создать одну альтернативу. Diff показывает:

- какое решение изменилось;
- какие доходы, расходы и запас накоплений изменились;
- какие части дня и timeline изменились;
- какие profile, evidence и rules остались общими;
- какие assumptions/projections появились заново.

Rewind не переписывает baseline. Альтернатива не удаляет прежнюю ветвь. Пользовательский интерфейс
не показывает общий decision graph, не строит произвольную сеть commits и не генерирует
альтернативы автоматически.

## 11. Failure и unknown semantics

- Missing official value остаётся unknown и не блокирует branch, если расчёт честно показывает
  неполноту.
- Invalid user value возвращается к точному полю до commit.
- Integrity mismatch не публикует branch или film.
- Model outage блокирует обязательную film generation без fallback и без потери draft.
- Model/schema/lineage failure оставляет только draft и не создаёт частичный branch commit.
- Historical replay не изменяет values или projection и не обращается к official sources.
- Изменившийся current source влияет только на новый research run, а не переписывает ветвь.

## 12. Acceptance scenarios

1. Current-work branch использует подтверждённый доход пользователя и не называет его official
   salary signal.
2. Supported profession показывает официальный signal с scope/period; unsupported profession не
   получает модельную оценку.
3. Housing override остаётся assumption рядом с official rent reference.
4. Unknown expense не становится нулём; known residual и incomplete list видимы одновременно.
5. Savings выводится диапазоном без midpoint; unknown ограничивает формулировку.
6. Local model создаёт day/timeline только из structured projection и не добавляет facts или
   probabilities.
7. Ручная правка film сохраняется как assumption и не уничтожает исходную projection.
8. Passport показывает все шесть классов и lineage.
9. Изменение одного решения создаёт одну альтернативу; baseline остаётся неизменным, а diff называет
   причинными только изменения с exact input lineage.
10. Недоступная модель блокирует generation без fallback/retry-механизма и сохраняет draft.
11. Replay воспроизводит branch, Passport и diff без official HTTP и model regeneration.
12. После выбора города пользователь сам выбирает route basis; verified route и
    `accepted_at_own_risk` unresolved basis визуально и семантически различаются.
13. RUB и destination-currency inputs используют закреплённый official FX date; gross/per-person
    incompatibility остаётся unknown без verified rule или user assumption.
14. City с unknown rent показывает unknown и optional assumption, а не фиктивный official range.
15. Сетевой аудит подтверждает отсутствие external model/telemetry traffic; canonical end-to-end
    demo с preloaded local model укладывается в 3–5 минут на закреплённом demo-устройстве.
16. Commit появляется только после валидной generation и optional user edits; любой сбой оставляет
    draft без частично сохранённой ветви.
17. Accepted formal-yellow country не заводит в тупик: VS-4 остаётся доступным, но не называет route
    или route-dependent unknown подтверждёнными.
18. Same-input control воспроизводит byte-equivalent structured film; иначе narrative diff не
    называется причинным.

## 13. Не-цели

- автоматический выбор жизни за пользователя;
- свободная профессия с придуманным доходом;
- вакансии, объявления жилья, booking или transaction flow;
- точная налоговая, юридическая или медицинская консультация;
- точные вероятности жизненных событий;
- десятки бюджетных категорий;
- автоматический перебор сценариев;
- универсальный decision graph или generic workflow engine;
- внешний LLM API, provider switch или monetization infrastructure в конкурсной версии.

## 14. Утверждённая canonical amendment

Approval этой спеки непосредственно заменяет прежние deterministic-only projection и
запрет local runtime model только для bounded `VS-4` film. Этот change package обновляет
Product Charter, Demo Story, Glossary, Spec of Specs и pre-defense runtime design. `VS-4` становится
точной границей полного фильма о жизни; `VS-5` остаётся отдельным конкурсным end-to-end evidence и
presentation gate, а не новой продуктовой функциональностью. Внешняя модель остаётся запрещённой.
