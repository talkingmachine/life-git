# Pre-defense runtime without external LLM providers

| Поле | Значение |
| --- | --- |
| Статус | `draft-for-exact-text-review` |
| Владелец решения | пользователь проекта |
| Дата решения | 2026-08-11 |
| Область | все конкурсные срезы до защиты, включая `VS-1..VS-5` |
| Выбранный подход | installed country source index + live official-source verification |
| После exact-text approval supersedes | runtime OpenAI/Responses integration, API-key gate и зависимый `VS-2` live eval |

## 1. Решение и граница этапа

До защиты приложение не использует внешние LLM API, OpenAI Responses API, `OPENAI_API_KEY`,
отдельный API-биллинг или программный вызов Codex. Подписка Codex используется только как
инструмент разработки: разработчик с её помощью исследует страну, записывает навигационные
источники, реализует валидаторы и проверяет код. Codex не является runtime dependency продукта.

Запрет не распространяется на HTTPS-запросы к официальным государственным и статистическим
источникам. Они остаются обязательными: каждый новый пользовательский run заново получает
актуальные ответы, сохраняет exact bytes и применяет детерминированные freshness, completeness,
applicability и semantic validators.

Внешняя LLM-интеграция переносится в дальний backlog: после защиты и перед монетизацией. OpenAI
Responses API считается одним из возможных будущих провайдеров, а не архитектурной основой или
предустановленным выбором.

## 2. Выбранная архитектура

```text
country input
  -> Country Registry
  -> installed Country Source Index
  -> live official HTTPS capture
  -> deterministic versioned validators
  -> sealed Evidence Snapshot
  -> optional immutable dossier
  -> deterministic assessment/comparator
  -> visual progress and source details
```

`Country Registry` отвечает за поддерживаемые страны и official authority roots. `Country Source
Index` возвращает установленный, ревьюируемый список навигационных кандидатов для страны.
Research рассматривает эти записи только как navigation seeds: они не являются evidence и не
дают права публиковать claim.

Текущая model-oriented discovery boundary заменяется предметной границей
`CountrySourceIndexPort`. Она нужна текущему knowledge-base flow, а не будущей LLM-интеграции.
Событие `source_discovered` можно сохранить ради стабильности stream/UI; оно означает, что
навигационный источник найден в установленном индексе, а не получен от модели.

## 3. Контракт Country Source Index

Одна запись индекса может содержать только:

- ISO-код страны;
- `candidateId`;
- credential-free HTTPS navigation URL;
- exact official authority root;
- покрываемые `claimKinds`;
- при необходимости source role или установленную validator/schema version.

Индекс не содержит:

- зарплаты, пороги, визовые условия или другие официальные facts;
- HTML/PDF/JSON response bodies, excerpts, hashes или recorded fixture values;
- profile, PII, пользовательский free text или personal verdict;
- model prompts, model responses или provider configuration;
- fallback evidence, которое может заменить fresh capture.

Записи хранятся в репозитории и проходят обычное code review. Отдельный `sourceSetVersion` не
вводится: runtime lineage уже запечатывает exact source ID/navigation URL вместе с rules/parser/
validator versions. Изменённый navigation set поэтому создаёт отличный Evidence manifest без
нового persistence field или versioning subsystem. Для Словении
используются уже подтверждённые шесть navigation seeds; существующие 11 official capture steps,
текущие validators `vs2-si-evidence@2`, CBR lineage, sealing и replay не меняют смысл.

## 4. Runtime и отказоустойчивость

Поддерживаемая страна с полным индексом запускает live capture. Неизвестная страна, отсутствующий
index или неполный набор required source roles завершаются честным unsupported/yellow без сетевой
или модельной попытки «догадаться».

Каждый navigation URL до capture проверяется на HTTPS, exact authority host, допустимый port/path и
redirect chain. Изменившаяся структура, неполный listing, stale/future period, semantic mismatch,
конфликт или недоступность critical source дают blocker/yellow и не создают dossier version.

Historical replay остаётся полностью offline. Оно воспроизводит claims, dossier и comparator из
sealed bytes и versioned validators без сети, Codex или LLM.

## 5. Детерминированный narrative

`VS-1` больше не имеет runtime narrative provider. Заголовок и supporting copy строятся
детерминированно из typed read model и фиксированных phrase IDs. Текст не создаёт facts и не
получает отдельный origin `model`.

Удаляются OpenAI narrative adapter, provider-specific schemas и API failure fallback. Остаётся один
детерминированный presentation path, поэтому отсутствие ключа или провайдера не является
пользовательским состоянием и не требует обходного пути.

## 6. Удаляемая поверхность

Реализация этого решения обязана удалить, а не оставить dormant:

- runtime imports и dependency `openai`, включая lockfile entries;
- `OPENAI_API_KEY`, `OPENAI_MODEL` и `openAiApiKey` composition options;
- Responses API discovery и narrative adapters;
- model-specific result kinds, refusal/timeout paths, payload assertions и call budgets;
- незакоммиченный `evals/vs2-live.ts`, `eval:vs2` и credential-dependent artifact contract;
- tests, которые проверяют `gpt-5.6`, `responses.parse` или model payload вместо продуктового
  поведения.

Удаление не затрагивает official HTTP gateway, source adapters, raw artifact store, deterministic
parsers, Evidence HMAC, dossier publication, replay, comparator или визуальный stream.

## 7. Проверка до защиты

Обязательный автоматический gate:

- все domain/integration/experience tests;
- отдельные tests для exact installed candidates, immutable index и unsupported country;
- zero-LLM audit: в production dependency graph, env example и runtime composition нет SDK, API key,
  provider name или model call;
- typecheck, lint и production build;
- offline replay, tamper, idempotency и version-chain проверки.

Зависимый `VS-2` live eval удаляется без замены новым eval subsystem. Перед статусом
`source-verified` или конкурсной защитой обязателен один provider-free black-box walkthrough
реального cold-start flow через current official HTTPS. Он выполняется через приложение одним
browser E2E после свежего явного разрешения пользователя, без LLM/API credential. Walkthrough
фиксирует terminal result, coverage, official source details и созданную dossier version; при
source drift честный yellow блокирует `source-verified`, а fixtures не подменяют наблюдение.

## 8. Дальний backlog

`BACKLOG-EXT-LLM-01`: после защиты и перед монетизацией создать отдельный approved change package
для исследования внешнего LLM-assisted discovery. До его approval в runtime нет provider SDK,
credential, abstraction или feature flag.

Будущая работа должна отдельно решить:

- нужен ли внешний provider в runtime или только во внутреннем authoring workflow;
- privacy, residency, cost, latency, rate limits и provider failure semantics;
- как untrusted navigation proposals проходят authority и schema gates;
- как сравниваются провайдеры, включая, но не ограничиваясь OpenAI Responses API;
- какие live evals и billing controls требуются перед монетизацией.

Ни один будущий provider не получает право создавать official fact, provenance, calculation,
marker или verdict. Его возможный результат — только untrusted proposal до deterministic gates.

## 9. Acceptance

Решение выполнено, когда:

1. поиск по production source и package graph не находит OpenAI SDK, Responses API,
   `OPENAI_API_KEY`, model ID или runtime LLM adapter;
2. Словения без dossier запускается без ключа, а один обязательный black-box current-source run
   перед защитой проходит прежний official capture pipeline либо честно фиксирует blocking drift;
3. index supplies navigation only, exact navigation входит в sealed manifest, а source drift
   по-прежнему fail-closed;
4. `VS-1` narrative полностью детерминирован;
5. незакоммиченный credential-dependent live eval удалён и не создаёт artifact;
6. active specs явно относят external LLM integration к `BACKLOG-EXT-LLM-01`;
7. полный local gate проходит без сети к LLM provider и без отдельного API-биллинга.

## 10. Не-цели

- локальная модель внутри приложения;
- вызов Codex CLI/desktop из runtime;
- генератор manifests или prompts;
- multi-provider abstraction, provider registry или feature flags «на будущее»;
- универсальный crawler или автоматическое добавление неизвестной страны;
- замена live official evidence recorded fixtures или памятью Codex.

## 11. Приоритет и исторические документы

После exact-text approval этот документ supersedes provider/model/API-key/live-eval clauses в прежних implementation plans
`VS-1`, `VS-2`, Task 2/4/6 briefs и source-shape repair handoff. Их уже выполненные deterministic
части, official capture topology, validators, evidence integrity, replay, UI и исторические отчёты
остаются действительными.

Старые task reports не переписываются: они честно фиксируют ранее реализованный OpenAI path и
отсутствовавший ключ. После approval этого точного текста missing API key перестаёт быть blocker, а
новый узкий implementation plan становится единственным планом удаления и миграции.
