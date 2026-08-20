# Product Glossary

| Поле | Значение |
| --- | --- |
| Статус | `approved` |
| Владелец решения | пользователь проекта |
| Последняя проверка | 2026-08-20 |
| Область ответственности | однозначные продуктовые термины Stage 1 |
| Supersedes | нет |
| Approval | пользователь проекта / 2026-08-06 / Stage 1; VS-3 place-frontier semantic amendment / approved 2026-08-12; VS-3R yellow-resolution amendment / approved 2026-08-12; VS-4A city-frontier semantic amendment / approved 2026-08-13; local onboarding + VS-4 Full Life amendment / approved 2026-08-20; Codex CLI runtime amendment / approved 2026-08-20 |

Термины относятся к продуктовой семантике. Технические entities и schemas определяются позже и не
обязаны повторять эти названия буквально.

| Термин | Значение |
| --- | --- |
| **Пользователь** | человек, исследующий собственную релокацию и принимающий финальные решения |
| **Сопровождающий** | необязательный участник переезда, чьи параметры влияют на ветвь; это может быть партнёр, ребёнок, родственник или другой человек |
| **Профиль** | изменяемое participant-scoped описание ситуации пользователя и сопровождающих: текущее место, документы, занятость и финансы; preferences хранятся отдельно |
| **Profile snapshot** | подтверждённая версия профиля, использованная конкретным прогоном или ветвью |
| **Onboarding questionnaire** | закрытая versioned форма `onboarding-fields@1`; единственный source of truth для Profile и Preference snapshots |
| **Questionnaire provenance** | durable field IDs, typed values, origin/reason/review state и Codex invocation/schema versions без transcript, source spans, prompts или raw model output |
| **Preference Profile Snapshot** | подтверждённые одним `Продолжить` country criteria и universal city values текущего journey |
| **`model_overwrite_unreviewed`** | видимое обратимое model overwrite ручного значения; используется новое value, поле получает жёлтый `!`, а unresolved state не блокирует `Продолжить` |
| **Жёсткое ограничение** | условие места или формального маршрута; required place mismatch исключает страну из ranking universe, а legal blocker влияет только на конкретный ResidenceRoute |
| **Предпочтение** | критерий режима `required` или `weighted`; verified required mismatch исключает страну из ranking universe, но не создаёт formal red |
| **PlaceCandidate** | одна страна в автоматическом country frontier; одна страна может занять не более одного shortlist slot |
| **Coverage** | установленный набор rankable Country Knowledge packages и route catalogs, их claim scope и даты; operational limits показываются отдельно |
| **Global registry** | перечень стран с минимальными унифицированными screening-признаками |
| **Automated Frontier Coverage** | страны с установленными rankable Country Knowledge package и ResidenceRouteCatalogRevision; custom cold start сюда автоматически не входит |
| **Country dossier** | версионируемое сжатое представление знаний о стране, claim-level данных и навигации по источникам |
| **Starter dossier** | заранее подготовленное глубокое country dossier MVP |
| **Cold start** | исследование страны, для которой до прогона не существовало глубокого досье |
| **Claim** | атомарное внешнее утверждение с областью применимости, временем и provenance |
| **Critical claim** | claim, необходимый для конкретного route outcome или catalog completeness; unknown нельзя использовать как доказательство, но он не отменяет другой verified viable route |
| **Official source** | первичный источник компетентного государственного, муниципального, статистического или иного официального органа, применимый к claim |
| **Source manifest** | навигация по официальным источникам страны и покрываемым ими claims |
| **Evidence** | сохранённое содержимое и метаданные, непосредственно поддерживающие claim |
| **Evidence snapshot** | неизменяемый набор evidence и версий, использованный конкретным прогоном |
| **Evidence Passport** | пользовательское представление фактов, источников, расчётов, projections, допущений и неизвестных значений ветви |
| **Current-run verification** | обязательная проверка актуальности каждого критичного claim в текущем прогоне; её неуспех не превращает старый факт в свежий |
| **Research run** | исследование от подтверждённого profile snapshot до stop condition и заморозки evidence snapshot |
| **Run revision** | новый run, продолжающий country или city frontier из предыдущего snapshot и создающий новый snapshot |
| **Dossier publication** | публикация валидированных run-local обновлений как новой версии dossier без изменения завершённых runs |
| **Country Knowledge Revision** | append-only evidence-backed snapshot current country facts/statuses с exact Evidence lineage; `knowledgeUpdatedAt` равен времени последней такой revision, а `lastCheckedAt` — sealed Evidence assessment date завершённой попытки/marker и не записывается внутрь revision |
| **ResidenceRoute** | официальный способ долгосрочного проживания; количество маршрутов не влияет на relevance страны |
| **ResidenceRouteCatalogRevision** | country-local версия применимых long-stay route classes и их official navigation |
| **CatalogCompletenessAttestation** | привязанный к exact Profile/Evidence snapshots dated proof полного long-stay catalog, typed applicability/exclusions и route crosswalk; необходим для country red |
| **Unknown** | domain/evidence значение, которое продукт не может подтвердить или корректно вывести; пользовательское `не знаю` не создаёт unknown value, а оставляет required onboarding field пустым |
| **Conflict** | два применимых evidence дают несовместимые значения, не разрешаемые установленным правилом |
| **Country frontier** | зафиксированный Ranking Snapshot и очередь ещё не завершённых стран; red заменяется следующей страной из того же порядка |
| **Place relevance** | объяснимый score места по Preference Profile и Country Knowledge; unknown получает явную conservative boundary, route count не участвует |
| **Research budget** | bounded operational limit отдельной capture/retry попытки; не является отдельным stop condition country shortlist |
| **Top-5** | до пяти разных effective green стран из installed coverage и frozen Ranking Snapshot после Yellow Resolution; при exhaustion честный resolved результат может содержать 0–4 страны |
| **Ranking Snapshot** | неизменяемые profile/preferences, Knowledge revision IDs, ranking rules, factors и полный порядок стран текущего run |
| **Automatic Shortlist Snapshot** | historical VS-3 terminal result со всеми formal markers, пятью formal non-red либо честным меньшим результатом и exact evidence lineage; он preliminary и не открывает City Frontier |
| **Formal status** | неизменяемый `green`, `yellow` или `red` из sealed official Evidence; formal yellow не переписывается решением пользователя |
| **Yellow decision** | append-only решение для exact formal yellow marker: `accepted_at_own_risk` или `rejected`; skip отсутствует |
| **Effective status** | детерминированная пользовательская projection formal status и Yellow decision: accepted yellow -> green, rejected yellow -> red, unresolved yellow -> yellow |
| **Resolution revision** | append-only canonical snapshot текущей Yellow Resolution: решения, replacement markers, cursor, queue и effective slots, проверяемые из immutable source graph |
| **Resolved Country Shortlist Snapshot** | terminal Resolution revision с до пятью effective green странами без unresolved formal yellow; единственный future City Frontier input, если результат non-empty |
| **Shortlist Snapshot** | historical VS-3 название Automatic Shortlist Snapshot; в forward product flow это не final country choice и не City Frontier input |
| **City Catalog Revision** | immutable установленный каталог максимум из 100 городов одной страны: national capital, все explicitly and officially typed first-level regional capitals, затем largest remaining official urban centers по latest comparable population до лимита с ordinal `cityId` tie-break; >100 mandatory capitals даёт `NEEDS_CONTEXT`, missing population не угадывается |
| **City Criteria Snapshot** | immutable набор ровно четырёх criteria — safety, long-term rent, urban transit и fixed broadband — созданный exact installed mapping из уже подтверждённых universal city values, с mode `required | weighted`, exact target, importance и versioned definition каждого criterion |
| **City Knowledge Revision** | append-only evidence-backed projection ровно четырёх city facts/statuses одной завершённой проверки; successor не переносит старое value, а fresh revision не меняет frozen ranking текущего run |
| **City frontier** | полный frozen City Catalog ranking и очередь кандидатов, проверяемых по одному в rank order; один run проверяет максимум десять cities, terminal condition — `three_selectable`, `catalog_exhausted` или `live_candidate_limit_reached` |
| **Selectable city** | city без fresh comparable verified required mismatch; unknown не снимает selectability, а показывается green с amber warning ring и explicit warning list |
| **City Selection Snapshot** | immutable snapshot terminal entry, exact Knowledge/Evidence lineage и server-derived displayed unknown-warning basis выбранного города |
| **PreCityBranchCommit** | общий immutable Life Git parent, который City Frontier фиксирует до city choice; terminal shortlist не заменяет этот parent |
| **City Branch Commit** | атомарный commit выбора города; альтернативы из одного terminal являются sibling commits с `parentId = forkedFrom = preCityBranchCommitId` |
| **Route basis** | выбранный пользователем verified residence route либо явно unresolved basis accepted formal-yellow страны; trust class сохраняется и route-dependent unknown не становится verified |
| **`city-unknown-risk@1`** | версия warning-copy, которую client передаёт только при фактически показанном non-empty server-derived warning basis; она фиксирует принятие ровно этих unknown risks, а не меняет facts |
| **Формально доступная страна / green** | подтверждён хотя бы один viable long-term ResidenceRoute; это не гарантия approval или city fit |
| **Неопределённая страна / yellow** | green не найден, но официальный пробел или incomplete catalog не позволяет доказать невозможность |
| **Исключённая страна / red** | complete applicable route catalog проверен, и каждый маршрут доказанно невозможен для profile; marker остаётся в истории |
| **Formal country verdict** | green/yellow/red вывод только о возможности долгосрочного проживания; fit страны и города отображается отдельно |
| **Карточка человека** | визуальное представление profile snapshot, преимуществ, ограничений и неизвестных входов |
| **Карточка места** | сравнение страны и города с текущей жизнью конкретного пользователя |
| **Карточка занятости** | применимые форматы работы, профессии, официальные сигналы дохода и их роль в ветви |
| **Жизненная ветвь** | согласованный пакет человека, места, route basis, работы, жилья, расходов, накоплений, допущений и projections |
| **Life Git** | append-only механизм baseline и одной competition alternative через изменение города, работы или жилья; история не переписывается |
| **Commit** | атомарно зафиксированное versioned решение и его lineage; конкретный тип commit определяет собственный закрытый payload |
| **Full Life commit** | атомарная публикация full-life branch snapshot, original/edited saved film projection, lineage и Evidence Passport после успешного guard |
| **Rewind** | возврат к предыдущему решению без удаления последующей истории |
| **Fork** | новая ветвь, созданная другим решением после rewind или из существующего commit |
| **Diff** | объяснимое сравнение решений и последствий; causal classification относится к deterministic facts/calculations, а новый narrative остаётся отдельной projection |
| **Deterministic calculation** | результат, однозначно воспроизводимый из входов, формулы и версий данных |
| **Film projection** | guarded versioned Codex-generated document с `segmentId/inputRefs`, типичным днём и timeline; не является fact, verdict или calculation и не regenerates при replay |
| **Projection** | модельный диапазон или film segment возможных последствий, не являющийся фактом или обещанием |
| **Verdict** | локальный вывод о соответствии кандидата текущим условиям и evidence, а не оценка страны вообще |
| **Canonical demo** | утверждённая 3–5-минутная история, демонстрирующая продукт и AI workflow end-to-end |
| **Vertical slice** | минимальный сквозной результат, проходящий от пользовательского input до проверяемого visual output |

## Неиспользуемые термины MVP

`safe`, `balanced`, `ambitious` и `custom` не являются режимами или типами сценариев MVP.
Пользователь получает персональный baseline и создаёт различающиеся ветви собственными решениями.

`Screening priority` как optimistic upper bound, `Stable shortlist`, `Confirmed candidate` и
`Confirmed country` являются superseded VS-3 terms и не используются в current product semantics.
