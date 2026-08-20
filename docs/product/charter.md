# Product Charter: Life Branches

| Поле | Значение |
| --- | --- |
| Статус | `approved` |
| Владелец решения | пользователь проекта |
| Последняя проверка | 2026-08-20 |
| Область ответственности | аудитория, обещание, ключевая семантика, границы и цели MVP |
| Supersedes | нет |
| Approval | пользователь проекта / 2026-08-06 / Stage 1; VS-3 place-frontier semantic amendment / approved 2026-08-12; VS-3R yellow-resolution amendment / approved 2026-08-12; VS-4A city-frontier semantic amendment / approved 2026-08-13; local onboarding + VS-4 Full Life amendment / approved 2026-08-20 |

`Life Branches` — рабочее название, а не утверждённый бренд.

## 1. Продукт одним предложением

Life Branches — визуальный evidence-backed симулятор релокации: он превращает цели и ограничения
человека в жизненные ветви с последствиями и источниками, но оставляет решение пользователю.

Короткая конкурсная формулировка: вместо совета о переезде пользователь видит и сравнивает фильмы
об альтернативных версиях собственной жизни.

## 2. Основной пользователь и ситуация

Основной пользователь живёт в России, рассматривает релокацию в горизонте 6–24 месяцев и хочет
понять не только возможность въезда, но и будущую повседневную жизнь.

Пользователь может переезжать один или с сопровождающими. Пара или семья — частный случай, а не
обязательная модель. Текущее место, гражданство, документы, образование, занятость, финансы и
состав переезда являются входами профиля; Москва не зашита в продукт.

Канонический пример использует разработчика из Москвы с супругой, но не ограничивает аудиторию.

## 3. Проблема

Обычное исследование релокации распадается на несвязанные таблицы, статьи, форумы и калькуляторы.
Человеку трудно одновременно оценить легальность пребывания, работу, жильё, бюджет, инфраструктуру
и качество жизни. Источники быстро устаревают, а итоговый совет часто скрывает допущения и не
показывает цену компромиссов.

Продукт должен помочь ответить не на вопрос «какая страна лучшая вообще», а на вопрос:

> Какие подтверждённые варианты подходят мне при моих текущих условиях, как может выглядеть жизнь
> в каждом из них и какое решение изменит результат сильнее всего?

## 4. Ценность и желаемая эмоция

Практическая ценность — получить проверяемую отправную точку для решения: жизнеспособные варианты,
явные блокеры, диапазоны расходов, неизвестные значения и следующий шаг исследования.

Эмоциональная ценность — безопасно «примерить» альтернативную жизнь до необратимого решения.
Пользователь должен ощущать любопытство и контроль, а не давление алгоритма или ложную уверенность.

## 5. Граница продукта

Life Branches является:

- инструментом исследования вариантов;
- конструктором согласованных сценариев;
- средством визуального сравнения решений;
- интерфейсом к проверяемым фактам и расчётам.

Life Branches не является:

- автоматическим решателем судьбы;
- гарантией возможности переезда;
- юридической, налоговой, медицинской или инвестиционной консультацией;
- предсказателем точного будущего;
- доказательством того, что показанные страны объективно лучшие в мире.

До защиты Research, ranking, eligibility, markers, official facts и calculations остаются
deterministic и official-only. Конкурсный runtime разрешает ровно две локальные model capabilities:
guarded conversational onboarding и bounded `VS-4` film projection. Они не создают official fact,
verdict или calculation и не передают input/output внешнему provider. Внешняя LLM-assisted
discovery отложена до периода после защиты и до монетизации (`BACKLOG-EXT-LLM-01`); она не является
runtime-зависимостью MVP. Финальный выбор всегда делает пользователь.

## 6. Продуктовые принципы

- **Visual-first:** карта, карточки, бюджетный поток, день, timeline и diff являются основным
  результатом; текст их поддерживает, но не заменяет.
- **Official-only:** внешний факт требует применимого официального источника; navigation seed,
  поисковый сниппет и пересказ третьей стороны evidence не являются.
- **Honest uncertainty:** пробел или конфликт остаётся unknown; неполный список лучше догадки.
- **Coherent branches:** работа, жильё, расходы, распорядок и эффекты образуют один сценарий.
- **Reversibility:** пользователь создаёт альтернативу без удаления истории и сам принимает выбор.
- **Minimum sufficient complexity:** новая сложность обслуживает canonical flow, acceptance
  criterion или реалистичный риск доверия; иначе случай явно не поддерживается.

## 7. Основной пользовательский цикл

Пользователь начинает со свободного описания. Guarded local model переносит только явно сообщённые
значения в видимую анкету, которая остаётся source of truth. Одно `Продолжить` подтверждает Profile
Snapshot и Preference Profile Snapshot с country/universal-city preferences, удаляет session
transcript и запускает automatic country frontier.

После Yellow Resolution пользователь выбирает страну, проходит City Frontier и выбирает город.
Затем он сам выбирает route basis, собирает одну ветвь из работы, жилья, расходов и накоплений,
получает guarded local film с Evidence Passport, после чего меняет город, работу или жильё и
сравнивает одну альтернативу. Точная последовательность зафиксирована в
[`demo-story.md`](demo-story.md).

## 8. Поиск стран и городов

### Покрытие

Автоматический поиск использует только `Automated Frontier Coverage`: страны с установленными
rankable Country Knowledge package и `ResidenceRouteCatalogRevision`. Новые country packages
добавляются по одному после отдельного source-feasibility gate. Десять starter dossiers остаются
целевым объёмом MVP, а не условием первого `VS-3` slice.

Страна, введённая пользователем вне установленного coverage, проходит отдельный cold-start flow и
показывается comparator, но не заполняет slot автоматического top-5.

### Семантика top-5

`Top-5` означает до пяти разных effective green стран из установленного `Automated Frontier
Coverage`, упорядоченных по персональной релевантности места в неизменяемом `Ranking Snapshot`.
Это не доказанный мировой оптимум. Количество способов легализации не влияет на place score.

До sealing ranking verified mismatch критерия `required` исключает страну из ranking universe,
но не создаёт legal red. Missing, stale или несопоставимый fit-факт получает явно показанную
conservative unknown boundary.

Automatic Country Frontier проверяет страны в зафиксированном порядке. Красная страна остаётся на
карте и заменяется следующей по ranking. Его stop — пять разных formal non-red стран либо
исчерпание установленного frontier; Automatic Shortlist Snapshot остаётся preliminary.

После automatic frontier начинается обязательная Yellow Resolution. Каждая unresolved formal yellow
требует `accepted_at_own_risk` или `rejected`: accepted получает ordinary effective green, а rejected
получает ordinary effective red без утверждения formal impossibility и запускает replacement из того
же frozen ranking. Только Resolved Country Shortlist Snapshot без unresolved formal yellow содержит
до пяти effective green стран; при exhaustion допустим честный результат 0–4. Обновления Country
Knowledge текущего run влияют только на следующий Ranking Snapshot.

### Города

Country shortlist формируется до city research и не зависит от подтверждения города. City Frontier
принимает только verified non-empty Resolved Country Shortlist Snapshot; automatic shortlist,
working resolution revision, empty/tampered terminal и effective-red country не открывают city
research. Для выбранной effective green страны immutable `City Catalog Revision` содержит максимум
100 городов: national capital; все explicitly and officially typed first-level regional capitals;
затем крупнейшие остальные official urban centers по latest comparable population до общего лимита,
с ordinal `cityId` tie-break. Если обязательных capitals больше 100, package получает
`NEEDS_CONTEXT`; silent truncation запрещён. Missing population не угадывается и оставляет coverage
incomplete.

`City Criteria Snapshot` создаётся exact installed mapping из уже подтверждённых universal city
preferences без второго confirmation screen. Unmappable target возвращает пользователя к
конкретной preference и не запускает City Frontier. Snapshot содержит ровно четыре independently
configurable criteria: безопасность, долгосрочная аренда, городской транспорт и fixed broadband.
Полный установленный catalog получает frozen ranking; карточка всегда различает `rank/score на
момент старта` и fresh facts/`coverage после проверки`. City Frontier проверяет по одному городу в
этом frozen order и закрывает все четыре facts каждого активированного города. Только fresh
comparable verified mismatch критерия `required` делает город red `Исключён`; unknown не блокирует
выбор, а оставляет city green `Доступен для выбора` с amber warning ring и exact warning list.

Frontier останавливается при `three_selectable`, `catalog_exhausted` или после десяти completed city
checks с `live_candidate_limit_reached`; честный terminal result `0..2` разрешён, а выбор доступен
только из terminal shortlist с `1..3` entries. Per-city safety budget
`3 queries / 10 document URLs / 2 hops` является отдельным лимитом. Каждая
завершённая проверка публикует full append-only `City Knowledge Revision` ровно из четырёх facts/
statuses: старое value не переносится в новую revision, а fresh live Knowledge не меняет frozen
ranking текущего run. Выбор города атомарно фиксирует `City Selection Snapshot` и City Branch
Commit. Альтернативный выбор из того же terminal shortlist создаёт sibling branch от общего
`PreCityBranchCommit`; никакой snapshot или прежний выбор не переписывается. Полный сценарий
работы, жилья и жизни строится только после выбора города.

## 9. Визуальные состояния поиска

| Состояние | Смысл | Действие пользователя |
| --- | --- | --- |
| Серый | формальная проверка страны ещё выполняется; verdict отсутствует | наблюдать фактический прогресс |
| Зелёный | подтверждён хотя бы один формально доступный маршрут долгосрочного проживания | перейти к country cards после поиска |
| Жёлтый | green не найден, но пробел, конфликт, неоднозначность или неполный catalog не позволяют доказать невозможность | обязательно принять риск или отклонить страну в Yellow Resolution |
| Красный | полный применимый route catalog проверен, и каждый маршрут доказанно невозможен для profile | открыть route outcomes, blockers и official sources |

Formal status marker отвечает только на вопрос формальной возможности долгосрочного проживания, а
не на безопасность, стоимость, предпочтения или качество города. Один провалившийся маршрут не
даёт red; verified preference mismatch и неудача города также не дают red. Red marker не удаляется
из run. Effective status после Yellow Resolution является отдельной пользовательской projection:
accepted formal yellow выглядит и действует как ordinary green, rejected formal yellow — как
ordinary red, но его formal yellow не переписывается. Green не гарантирует решение органа,
application readiness или соответствие места предпочтениям; маршрут с contingent action явно
показывает, что нужный outcome ещё не получен.

## 10. Карточки и жизненная ветвь

Карточки человека, места и занятости показывают соответственно profile snapshot, сравнение с
текущей жизнью и применимые форматы работы с официальными сигналами дохода. Жизненная ветвь
объединяет route basis, работу, жильё, расходы, накопления, допущения и projections.

Пользователь сам выбирает route basis после City Selection. Для formal-green страны это verified
available residence route. Для accepted formal-yellow это явно unresolved basis; route-dependent
значения остаются unknown и не называются verified. Единый constructor показывает work, housing,
monthly/one-time expenses, savings/runway и adjacent preview.

Budget использует одну destination calculation currency, dated official FX и совместимые
net/gross и person/household basis. Несопоставимое значение остаётся unknown либо становится
явной user assumption. Branch, versioned local film, lineage, Passport и commit сохраняются
атомарно только после validation, generation guard и optional edits пользователя.

## 11. Life Git

Life Git — append-only история решений, а не копия интерфейса Git. Решение создаёт commit, rewind
не переписывает историю, новый выбор создаёт fork, а diff связывает изменённое решение с
последствиями. Competition scope содержит baseline и одну альтернативу, меняющую город, работу или
жильё; route после baseline фиксирован. Ветка хранит profile и evidence snapshots. Смена города
создаёт ветвь, но может переиспользовать применимое country evidence. Narrative change называется
causal только после byte-equivalent same-input control; иначе это новая projection.

## 12. Evidence Passport

Evidence Passport различает пользовательский и официальный факт, детерминированный расчёт,
projection, допущение и unknown.

Для внешнего факта видны источник, область применимости и время проверки. Каждый run проверяет
актуальность критичных claims и при завершении фиксирует неизменяемый evidence snapshot. Для formal
marker unresolved route fact даёт yellow только когда verified viable route не найден. Red
невозможен без полного применимого route catalog и доказанной невозможности каждого маршрута;
один verified viable route разрешает green независимо от unknown по другим маршрутам.

Новые claims и источники остаются run-local draft до валидации. После неё verified country facts и
evidence-backed status observations публикуются append-only `Country Knowledge Revision`, не
изменяя завершённый run. Карточка различает revision, использованную для ranking, и обновление,
полученное после ranking; последнее применяется только в новом run. Продолжение country или city
frontier создаёт новую ревизию run и новый snapshot; жизненная ветвь всегда ссылается на конкретную
ревизию.

Компактный блок ведёт к первоисточнику. Ссылка подтверждает факт, а не продуктовый вердикт.

## 13. Семантика симуляции

Бюджетные и календарные результаты вычисляются детерминированно из видимых входов, dated FX и
versioned formulas. Локальная модель получает только закрытую structured branch projection и
создаёт versioned типичный день и 12-месячную timeline. Каждый segment хранит input lineage;
historical replay использует сохранённый output и не regenerates model response. Сон, стресс,
социальная жизнь, карьерная траектория и выгорание показываются как сценарные диапазоны и факторы
риска, а не как точные предсказания.

Числовая вероятность жизненного события запрещена без отдельно валидированной модели, способной
обосновать число. Неизвестный вход остаётся неизвестным либо становится явно редактируемым
допущением пользователя.

## 14. MVP

MVP охватывает один канонический end-to-end journey:

- conversational onboarding с видимой анкетой, participant-scoped profile и preferences;
- глобальный screening, десять starter dossiers и один cold start;
- progressive verification и карту состояний;
- automatic frontier с до пятью formal non-red странами либо честным preliminary result;
- обязательную Yellow Resolution и до пяти effective green стран в Resolved Country Shortlist Snapshot;
- будущий отдельный city frontier с одним–тремя городами только после resolved country input;
- выбор города, явного route basis, работы и жилья;
- одну визуальную жизненную ветвь с budget/runway и guarded local film;
- Evidence Passport;
- один rewind, fork и visual diff;
- воспроизводимый конкурсный demo harness и минимальные evals.

### Явные не-цели MVP

- presets `safe`, `balanced`, `ambitious` и `custom`;
- полное исследование всех стран и городов;
- пятнадцать одновременно рассчитанных подробных сценариев;
- бронирование, найм, подача документов или исполнение решения;
- production auth, billing, multi-tenancy, mobile apps и plugin ecosystem;
- микросервисы, универсальный workflow engine, external runtime LLM-provider, provider registry
  или provider switch;
- автоматическое восстановление после любого изменения внешнего сайта;
- исчерпывающий набор edge-case тестов и prompts для отдельных стран.

## 15. Границы юридических и финансовых выводов

Продукт может цитировать применимые официальные правила и выполнять прозрачные вычисления, но не
объявляет юридическую допустимость окончательно установленной и не гарантирует налоговый результат.
Критичные выводы содержат scope, дату и рекомендацию проверить решение у компетентного специалиста
перед реальным действием.

Официальный источник является необходимым, но не достаточным условием применимости: учитываются
гражданство, место проживания, дата, форма занятости и другие известные параметры. При недостатке
данных результат остаётся неизвестным.

## 16. Критерии успеха Stage 1 и будущего MVP

Цель — закрыть проверяемым evidence шесть критериев конкурса, а не обещать решение жюри.

Stage 1 завершён, когда пользователь утверждает точную аудиторию, обещание, границы MVP, не-цели,
demo story, целевые метрики и список открытых решений. Результаты ниже являются будущими gates MVP,
а не уже полученными доказательствами:

- В пяти usability-сессиях 4/5 пользователей без помощи проходят основной путь и правильно
  различают факт, расчёт, допущение и неизвестность.
- Не менее 3/5 после первой ветви самостоятельно исследуют альтернативу через rewind или fork.
- 100% показанных внешних фактов имеют официальный provenance либо маркировку unknown.
- Неподтверждённый claim не используется как подтверждение или опровержение маршрута; red требует
  complete all-impossible catalog, а green — хотя бы один verified viable route.
- Одинаковые профиль и evidence snapshot воспроизводят расчёты и граф ветвей.
- Competition fixture завершает local conversational onboarding в 35-секундном narrative budget
  на закреплённом demo-устройстве.
- Один и тот же structured film input на закреплённой build/device pair даёт byte-equivalent output.
- Сетевой аудит показывает zero external model/provider/telemetry traffic; official-source HTTPS
  остаётся отдельным разрешённым контуром.
- Канонический сценарий работает end-to-end и укладывается в 3–5 минут.
- Демо явно показывает `Input -> Process -> Evals -> Output`.

Подробный сценарий находится в [`demo-story.md`](demo-story.md). Размеры golden set, runtime budget
и конкретные fixtures утверждаются после первого feasibility spike, чтобы метрики не были
вымышленными.

## 17. Целевой вклад в конкурсную рубрику

| Критерий | Доказательство проекта |
| --- | --- |
| Идея и оригинальность, 20 | связка Life Git, Evidence Passport и визуального мирового поиска |
| Работающий результат, 20 | чистый end-to-end запуск от профиля до сравнения ветвей |
| Инженерное качество, 20 | claim-level provenance, snapshots, fail-closed и deterministic core |
| Польза и эмоция, 20 | наблюдаемые user tests и эффект «фильма о другой жизни» |
| Сложность, 10 | cold start, проверка evidence, ranking, simulation и branch graph |
| Понятность, 10 | отрепетированный 3–5-минутный demo story |

## 18. Явно открытые решения

Архитектура и deployment boundary MVP зафиксированы в
[`ADR-001`](../decisions/ADR-001-modular-monolith.md). Открыты финальное название, состав десяти
starter dossiers, source manifests и freshness policy, runtime и cost budgets, стек и размер golden
datasets. Они не блокируют продуктовую границу, но требуют своих review gates до реализации.
