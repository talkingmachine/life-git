# Local Conversational Onboarding: свободное описание и проверяемая анкета

| Поле | Значение |
| --- | --- |
| Статус | `approved` |
| Владелец решения | пользователь проекта |
| Дата | 2026-08-20 |
| Область | единый вход в полный Life Branches journey до запуска Country Frontier |
| Зависимости | Product Charter, Demo Story, Preference Profile, City Criteria, Competition Runtime через Codex CLI |
| Supersedes | structured-only start UI; прежний запрет model-assisted onboarding в конкурсном runtime |
| Approval | пользователь проекта / 2026-08-20 / exact-text / approved; Codex CLI runtime amendment / approved 2026-08-20; source-evidence guard amendment / approved 2026-08-22 |

## 1. Цель и наблюдаемый результат

Пользователь начинает не с пустой технической формы, а со свободного описания своей ситуации и
цели. Установленный Codex CLI переносит только явно сообщённые сведения в видимую анкету, помогает собрать
недостающие обязательные ответы и проверяет целостность результата. Пользователь всегда видит и
может редактировать структурированное состояние, которое будет использовано продуктом.

Успешное нажатие `Продолжить` фиксирует подтверждённый профиль и предпочтения и сразу запускает
Country Frontier. Отдельного экрана повторного подтверждения нет.

## 2. Утверждённые продуктовые инварианты

1. Анкета, а не чат, является источником истины для поиска и расчётов.
2. Модель заполняет поле только из осознанно сообщённой пользователем информации.
3. Отсутствующая информация, ответ `не знаю` и неясный текст не превращаются в значение поля.
4. Пустое применимое обязательное поле блокирует запуск поиска.
5. Обязательность дополнительных полей определяется утверждёнными правилами анкеты, а не свободным
   решением модели.
6. Модель может изменить вручную заполненное поле только на основании новой явной информации
   пользователя. Такое изменение остаётся заметным и обратимым.
7. Неразрешённое модельное изменение не блокирует переход, но его provenance сохраняется.
8. Перед переходом выполняется полное ревью обязательных полей и межполевых противоречий.
9. Необычное, но корректное и непротиворечивое значение не отклоняется.
10. Модель не создаёт official facts, eligibility, ranking, marker, calculation или verdict.
11. Конкурсная версия является локальным Next.js-приложением и вызывает установленный Codex CLI,
    уже авторизованный личным ChatGPT/Codex login. Questionnaire payloads могут передаваться OpenAI
    через Codex CLI; пользователь явно разрешил это для своей анкеты и тестовых данных.
12. Приложение не вызывает LLM API напрямую, не запрашивает API key, не скачивает model weights и
    не создаёт provider abstraction. Internet/monetization API integration является отдельным
    будущим change package.
13. Competition questionnaire имеет один закрытый versioned field catalog. Установленный country
    package не может незаметно добавлять в onboarding новые обязательные поля.

## 3. Экран onboarding

### Desktop

Экран использует композицию примерно `2/3 + 1/3`.

- Левая часть содержит анкету сверху и полноценный чат под ней.
- В initial state анкета остаётся сверху, но показана компактно: в первом viewport одновременно
  видны её заголовок/пустые секции и composer свободного описания; фокус находится в composer.
- После первого сообщения анкета раскрывается и показывает заполненные и пустые поля.
- Анкета и чат образуют одно прокручиваемое рабочее пространство.
- Правая треть содержит закреплённую медленно вращающуюся планету без меток, маршрутов и verdict.
- Планета не реагирует на значения анкеты и остаётся спокойным визуальным контекстом до поиска.
- При `prefers-reduced-motion` вращение отключается.

### Mobile

- Компактная планета располагается сверху и не занимает основной viewport.
- Ниже идут компактная анкета и затем чат; initial composer виден в первом viewport и получает
  focus, а анкета раскрывается после первого сообщения так же, как на desktop.
- Закреплённая компактная панель показывает последний вопрос модели и переводит пользователя к
  чату, не скрывая форму.
- Основное действие и ошибки остаются доступны без горизонтальной прокрутки.

## 4. Структура анкеты

Анкета содержит две видимые секции.

### `Моя ситуация`

Competition catalog `onboarding-fields@1` закрыт одной таблицей:

| Field ID | Typed value | Applicability |
| --- | --- | --- |
| `current_location` | `{ countryCode: ISO-3166-1 alpha-2, city: non-empty text }` | обязательно всегда |
| `move_horizon` | `within_3_months \| 3_to_6_months \| 6_to_12_months \| more_than_12_months` | обязательно всегда |
| `moving_party` | `alone \| with_companions` | обязательно всегда |
| `participants` | non-empty list `{ participantId, relationship: self \| spouse \| minor_child \| other_family }`; ровно один `self`, без имён | только `self` для `alone`; `self` и минимум один companion для `with_companions` |
| `participant[].citizenships` | non-empty unique list ISO-3166-1 alpha-2 | обязательно для каждого participant |
| `participant[].passport` | `absent \| { validUntil: ISO date }`, без номера | обязательно для каждого participant |
| `participant[].current_work` | `{ status: not_working \| employment \| self_employment \| contract_service \| other, occupation?: non-empty text }` | обязательно, кроме `minor_child` |
| `participant[].remote_continuation` | `yes \| no` | обязательно только при active `current_work` |
| `participant[].monthly_income` | `{ amount: canonical decimal >= 0, currency: ISO-4217, basis: net \| gross }` | обязательно, кроме `minor_child`; явный `0` допустим |
| `savings` | `{ min, max: canonical decimal >= 0; min <= max; currency: ISO-4217 }` | обязательно всегда |
| `participant[].education` | `{ level: none \| secondary \| vocational \| higher, field?: non-empty text }` | обязательно, кроме `minor_child`; `field` скрыто для `none` |
| `participant[].relevant_experience_years` | non-negative integer | обязательно, кроме `minor_child`; явный `0` допустим |
| `country_preferences` | exact five criteria, каждый с mode, importance и definition target | обязательно всегда |
| `city_preferences` | exact four criteria, каждый с mode, importance и definition target | обязательно всегда |

Country package не расширяет этот список. Страховка, route-specific документы, обязательные платежи
и другие сведения, зависящие от выбранного residence route, собираются после выбора маршрута.

`participantId` является внутренним стабильным ключом snapshot, а не именем или внешним
идентификатором. У таблицы нет расширяемого runtime rules engine: условия applicability выше
являются полным набором competition rules. Когда поле становится `not_applicable`, его значение и
session-provenance очищаются; durable snapshot сохраняет только applicability state и не позволяет
скрытому значению влиять на поиск. Пользовательский ответ `не знаю` не является `not_applicable`:
поле остаётся пустым и, если оно применимо и обязательно, блокирует переход.

Имена, номера паспортов и другие идентификаторы, не нужные для поиска, не являются полями анкеты.

### `Что для меня важно`

Содержит закрытые versioned criteria, уже утверждённые продуктом:

- country: `outside_cis`, `europe`, `personal_safety`, `infrastructure`,
  `peace_and_stability`;
- city: `safety`, `long_term_rent`, `urban_transit`, `fixed_broadband`.

У каждого критерия есть:

- режим `Обязательно` или `Желательно`;
- важность `1..5`;
- применимый target, если он требуется definition.

Модель может предзаполнить режим, важность и target только из явного пользовательского описания.
Пользователь может изменить их вручную. Стандартные критерии и ranking semantics остаются
versioned product rules; модель не добавляет собственные критерии.

Country и universal city values фиксируются в одном versioned Preference Profile Snapshot при
успешном onboarding; нажатие `Продолжить` является их пользовательским подтверждением. После выбора
страны установленное exact mapping создаёт City Criteria Snapshot для четырёх criteria без
повторного опроса или второго confirmation screen. Если target нельзя сопоставить с установленным
country package, City Frontier не стартует: продукт явно возвращает пользователя к конкретной
preference, не угадывает и не меняет её молча. Это намеренно заменяет прежнее отдельное
post-country подтверждение City Criteria, а не добавляет новый persistent draft artifact.

Работа, жильё, расходы, распорядок и другие решения жизненной ветви в onboarding не собираются.
Они появляются после выбора города в `VS-4`.

## 5. Chat → questionnaire flow

1. Пользователь отправляет свободное описание.
2. Codex CLI возвращает структурированные предложения только для явно присутствующих
   сведений и краткий следующий вопрос.
3. Валидные предложения заполняют соответствующие поля; остальные поля остаются пустыми.
4. Модель спрашивает о недостающих применимых обязательных полях.
5. Ответы пользователя обновляют draft анкеты; пользователь также редактирует draft напрямую.
6. Цикл продолжается, пока пользователь сам не нажмёт `Продолжить`.

Чат не обязан задавать по одному вопросу, если несколько тесно связанных коротких значений удобнее
уточнить вместе, но не должен превращаться в длинную повторную анкету поверх формы.

### Закрытый contract Codex CLI invocation

Модель не изменяет draft напрямую. Extraction возвращает только allowlisted предложения
`fieldId + typedValue + messageId + sourceSpan`; `sourceSpan` существует лишь в текущей session.
Codex отвечает за смысловую интерпретацию обычного русского или английского текста. До изменения
формы deterministic guard требует exact текущий user-message ID, корректные UTF-16 границы,
непустой фрагмент с буквой или цифрой и отклоняет exact placeholder `-`, `не знаю`, `неизвестно`,
`unknown`, `n/a` или `na` после NFKC/case/whitespace normalization. Предложение отдельно проходит
versioned field schema и allowlist. Guard не пытается строить второй естественно-языковой parser,
не сравнивает `typedValue` с JSON/substring-представлением и не принимает неизвестный field ID.
Если Codex не видит явной информации, он не возвращает предложение и задаёт уточняющий вопрос.

Финальное model review возвращает только `fieldIds + closed reasonCode`. Блокером становится не
свободный model verdict, а только issue, подтверждённый соответствующим parser/schema или
детерминированным cross-field rule. Необычное значение, прошедшее эти правила, не блокируется.

Контракт фиксирует версию Codex CLI invocation, prompt/template, output schema и parameters;
observed model/runtime metadata сохраняется в eval artifact, только если CLI сообщает её. Перед приёмкой
он проходит небольшой golden/adversarial набор: явные значения извлекаются, пропуски и `не знаю`
не заполняются, prompt injection не создаёт неизвестных field IDs, необычные валидные значения не
получают blocker. Это ограниченный acceptance set, а не общий model framework.

## 6. Модельное перезаписывание ручного значения

Если новая явная информация пользователя противоречит ручному значению, модель подставляет новое
значение и создаёт состояние `model_overwrite_unreviewed`.

Поле:

- получает жёлтое визуальное состояние;
- показывает информационный значок `!`;
- хранит предыдущее и новое значение;
- показывает краткое объяснение, отрисованное из закрытого reason code.

По нажатию на `!` открывается небольшое окно с действиями:

- `Подтвердить` — принять новое значение и снять предупреждение;
- `Вернуть` — восстановить предыдущее значение и снять предупреждение.

Если пользователь не выбрал действие, новое отображаемое значение используется при продолжении.
В подтверждённом snapshot сохраняется отметка `изменено моделью, не проверено пользователем` вместе
с field ID и reason code. Неразрешённое жёлтое поле не блокирует поиск.

## 7. Финальное ревью по `Продолжить`

Нажатие `Продолжить` не запускает поиск немедленно. Сначала ответ Codex CLI и закрытые правила
формы проверяют весь применимый draft.

Блокирующими являются:

- пустое обязательное поле;
- placeholder вроде `-`, `не знаю` или другой текст без рабочего значения;
- значение, которое нельзя привести к контракту поля;
- взаимное противоречие между ответами, например между датами, валютой и суммой, выбранным составом
  переезда и полями сопровождающих, либо планом работы и её условиями.

Ревью возвращает точные field IDs и закрытый reason code каждой проблемы. UI отрисовывает из него
краткое объяснение. Поля получают inline error,
чат задаёт необходимые уточняющие вопросы, а переход не выполняется. После исправлений пользователь
снова нажимает `Продолжить`.

Если блокеров нет, приложение атомарно фиксирует Profile Snapshot, расширенный Preference Profile
Snapshot с country и universal city values и закрытое questionnaire provenance, очищает session
chat и сразу запускает Country Frontier.

## 8. Privacy и сохранение

- Полный transcript существует только во время onboarding.
- После успешного перехода transcript не сохраняется в journey history.
- Durable whitelist ограничен подтверждёнными structured snapshots, field IDs, typed old/new
  values, origin enum, closed reason codes, review state и версиями Codex invocation/schema.
- Краткие объяснения отрисовываются из reason code и не сохраняются отдельным свободным текстом.
- Transcript, message excerpts, source spans, prompts, raw model output, embeddings и session/temp
  caches удаляются при завершении session. Application/crash/telemetry logs не содержат их content.
- Codex CLI получает только данные текущей onboarding session либо явно выбранные
  golden/adversarial fixtures. Они могут передаваться OpenAI через личный Codex login.
- Приложение не отправляет questionnaire content иным providers и не включает его в
  application/crash/telemetry logs.
- Official-source HTTPS research после onboarding остаётся отдельным разрешённым контуром.

## 9. Отказ модели

Установленный и авторизованный Codex CLI является обязательной частью этого flow. Если CLI
отсутствует, не авторизован или OpenAI недоступен при extraction либо финальном review:

- переход блокируется;
- пользователь видит явную ошибку модели;
- текущие сообщения и draft анкеты не теряются;
- deterministic fallback, recorded response, retry loop и отдельное retry-действие не используются.

После восстановления модели пользователь снова нажимает обычное `Продолжить`; отдельного retry
state, фонового повторения или специальной recovery-кнопки нет.

Та же граница применяется к обязательной Codex generation в `VS-4`.

## 10. Acceptance scenarios

1. Свободное описание заполняет только явно названные поля; отсутствующие остаются пустыми.
2. `Не знаю`, `-` и бессмысленный ответ не позволяют завершить required field.
3. Выбор переезда без сопровождающих не создаёт обязательных companion fields; добавление супруга
   создаёт их.
4. Новая явная информация меняет ручное поле, показывает жёлтый `!`, reason и действия
   `Подтвердить / Вернуть`.
5. Неразрешённое модельное изменение не блокирует переход и сохраняет provenance.
6. Межполевое противоречие возвращает пользователя к точным полям; необычное корректное значение
   проходит.
7. Успешный review сразу запускает Country Frontier и не показывает второй confirmation screen.
8. После перехода transcript отсутствует в persisted journey, а structured snapshots остаются.
9. Сетевой аудит допускает только Codex CLI ↔ OpenAI model traffic и подтверждает отсутствие иных
   model/provider/application-telemetry передач; official-source traffic остаётся отдельным контуром.
10. Недоступный или неавторизованный Codex CLI блокирует переход без fallback/retry-механизма и без потери draft.
11. Competition fixture с установленным, авторизованным и прошедшим preflight Codex CLI завершает onboarding в исходном 35-секундном
    narrative budget на закреплённом demo-устройстве; весь canonical demo остаётся в пределах
    3–5 минут.
12. Golden/adversarial model checks подтверждают allowlist, отсутствие invented values и то, что
    необычный schema-valid ответ не блокируется.
13. `Продолжить` один раз подтверждает и country, и universal city preferences; после выбора страны
    exact mapping создаёт City Criteria Snapshot без второго confirmation screen.
14. Canonical couple сохраняет отдельные citizenship/passport/work/education/experience values для
    `self` и `spouse`; сведения супруги не теряются и не приписываются основному пользователю.

## 11. Не-цели

- прямой вызов LLM API из Next.js-приложения;
- provider registry/switch вместо установленного Codex CLI;
- Qwen, GGUF, bundled/downloaded model weights или model downloader;
- запрос, ввод или хранение API key приложением;
- хранение полного chat transcript;
- модельный official-source discovery, fact extraction или verdict;
- сбор работы, жилья и распорядка до выбора города;
- свободное создание новых ranking criteria моделью.

## 12. Утверждённая canonical amendment

Конкурсный runtime остаётся локальным Next.js-приложением, но onboarding и bounded `VS-4`
projection выполняются через установленный и авторизованный Codex CLI/OpenAI. Direct API
integration, provider abstraction, Qwen/GGUF, model downloads и API keys не входят в runtime.
Точный общий process/privacy/failure contract задаёт
[`2026-08-20-codex-cli-runtime-design.md`](2026-08-20-codex-cli-runtime-design.md).
Official-only evidence boundary сохраняется.
Canonical flow также заменяет отдельное post-country подтверждение City Criteria на уже
подтверждённые onboarding values и exact installed mapping.
