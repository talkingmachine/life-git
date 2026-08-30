# Local Codex LLM и автоматическое восстановление официальных источников

| Поле | Значение |
| --- | --- |
| Статус | `approved` |
| Владелец решения | пользователь проекта |
| Дата | 2026-08-28 |
| Область | локальная beta: questionnaire extraction, извлечение фактов из captured source и поиск замены сломанному официальному источнику |
| Зависимости | Competition Runtime через Codex CLI, Local Conversational Onboarding, official-source Evidence, Country/City Frontier |
| Supersedes | exact-build pin, global single-flight, zero-retry, запрет model-assisted source discovery и narrow source-payload prohibition в затронутой части документов от 2026-08-20; scheduling deferral real Codex checks от 2026-08-23 для этого local-beta scope |
| Не supersedes | official-only Evidence, deterministic verdicts, integrity-before-side-effect, append-only history, replay и privacy boundaries вне точного public-source excerpt allowlist этого документа |
| Approval | пользователь проекта / 2026-08-28 / architecture, runtime, lifecycle, capabilities, recovery limits и delivery scope / approved |

## 1. Цель

Локальная beta использует установленный Codex CLI, авторизованный личной ChatGPT-подпиской
владельца Mac, как ограниченный LLM runtime для трёх простых задач:

1. извлечь явно написанные ответы из сообщения onboarding;
2. извлечь структурированное наблюдение из локально сохранённого официального документа;
3. при недоступном, устаревшем или нерелевантном источнике найти кандидатов на новый официальный
   источник через live web search.

Runtime должен дать стабильный локальный feedback loop, после чего beta получает субъективный
demo-каталог из десяти популярных у русскоязычной аудитории направлений и пяти городов на страну.
Затем весь flow от анкеты до выбора города проверяется с реальной моделью и передаётся владельцу
проекта для ручного UX-review.

Текущий change package реализует только локальный подписочный runtime. Hosted/multi-user deployment,
внешний API provider и provider switch в него не входят.

## 2. Неподвижная граница доверия

Codex — недоверенный вычислитель. Он не имеет authority создавать или изменять:

- official fact, Evidence, Knowledge, Frontier или provenance;
- active source binding, installed package или manifest;
- финальный `green | red | yellow`;
- eligibility, ranking, calculation или пользовательское решение;
- durable application row, файл проекта или audit event.

Фраза «LLM проверяет факт» означает следующий технический процесс:

```text
trusted SourceBinding
  -> local integrity gate
  -> local SourceCapture
  -> immutable bytes + SHA-256
  -> untrusted Codex extraction proposal
  -> strict local parser and policy
  -> green | red | yellow
```

Модель возвращает только JSON по capability-specific schema. Application повторно проверяет типы,
ссылки, единицы, source locators, допустимые IDs и полноту. Для source extraction модель только
указывает exact quote/locator: versioned local parser обязан независимо получить из этого фрагмента
то же observation. Несовпадение даёт ambiguity/yellow. Only captured official source может стать
Evidence. Search result, snippet, rationale или утверждение модели Evidence не являются.

## 3. Штатный и recovery flow

### 3.1 Штатная проверка

Для exact `entityId + factKey + definitionId` приложение загружает active source, сохраняет снимок,
извлекает наблюдение и применяет локальное правило:

```text
active URL -> capture -> extract -> policy -> green/red
```

`green` и `red` требуют одного или нескольких verified Evidence IDs. Нельзя получить `red` из
timeout, отсутствия данных, невалидного JSON или технической ошибки.

### 3.2 Recovery

Недоступный, stale, пустой, изменивший смысл или не покрывающий факт source сначала даёт внутренний
recovery state, а не окончательный красный результат:

```text
source failure
  -> provisional yellow
  -> Codex live search
  -> untrusted URL candidates
  -> SourceGate
  -> capture + hash
  -> extract + local policy
  -> atomic source replacement
  -> final green/red
```

Если recovery исчерпан, публикуется честный formal `yellow`. После него действует существующая
yellow-resolution policy; recovery не переписывает уже опубликованную formal truth задним числом.

## 4. Компоненты и dependency direction

```text
Application use case
  -> OnboardingExtractionPort
  -> SourceObservationPort
  -> OfficialSourceDiscoveryPort
  -> LocalCodexAdapter                  Infrastructure

Application use case
  -> SourceRegistryPort
  -> SourceCapturePort
  -> SourceGatePort
  -> Evidence/Knowledge/Frontier ports
```

Три LLM-порта узкие и не образуют generic agent API. `LocalCodexAdapter` разделяет безопасный
process launcher, JSONL decoder, schema ownership, limits и preflight, но capability выбирает
модель, reasoning, tool policy и prompt отдельно.

Codex child не получает repository/workspace path, application database, source registry,
application credentials, shell, MCP, plugins, skills или browser automation. Subscription auth
доступен только аттестованному local Codex binary через закрытый `CODEX_HOME` environment. Source
mutation выполняется только Application после всех gates.

Для direct-search модели установленный CLI неизбежно объявляет model-visible `apply_patch`, хотя
reviewed config не даёт отдельного supported disable switch. Поэтому контракт не утверждает, что
такого tool declaration нет: `--sandbox read-only` и managed approval boundary обязаны отклонить
file change до mutation, production decoder отклоняет любой `file_change` event, а exact pinned
bundle допускается к search только после live negative canary proof. Единственный разрешённый
успешный внешний effect discovery-вызова — native `web_search`.

## 5. Модель и invocation policy

В local beta используются две code-owned модели не выше `gpt-5.6-terra` и два уровня reasoning:

| Capability | Model | Reasoning | Live search |
| --- | --- | --- | --- |
| `onboarding.extract` | `gpt-5.6-terra` | `low` | запрещён |
| `onboarding.extract` schema/ambiguity retry | `gpt-5.6-terra` | `medium` | запрещён |
| `source.extract` | `gpt-5.6-terra` | `low` | запрещён |
| `source.extract` schema/ambiguity retry | `gpt-5.6-terra` | `medium` | запрещён |
| `source.discover`, round 1 или 2 | `gpt-5.4` | `medium` | разрешён |

Capability-to-model mapping и effort allowlist принадлежат коду. Environment, questionnaire text,
captured page, search result и пользовательский Codex config не могут заменить модель или повысить
effort. Extraction/review используют exact `gpt-5.6-terra`; discovery использует exact `gpt-5.4`.
Любая другая модель либо reasoning выше `medium` fail-closed.

Каждый вызов запускает эквивалент bounded non-interactive invocation:

```text
codex [--search только для source.discover]
  exec
  --ephemeral
  --ignore-user-config
  --ignore-rules
  --strict-config
  --model <exact code-owned capability model>
  --sandbox read-only
  <exact capability tool-disable tuple>
  --cd <fresh app-owned empty directory>
  --output-schema <app-owned schema>
  --json
  -
```

Reasoning задаётся отдельным fixed config override. Exact финальный argv принимается только после
реального feasibility probe текущего CLI; shell interpolation не используется. Prompt передаётся
через stdin. Child получает закрытый environment allowlist с минимальными locale/temp values и
существующим `CODEX_HOME`, необходимым для subscription auth.

Versioned `CodexToolPolicy` — часть invocation contract, а не комментарий. Для extraction он
отключает exact retained tuple `apps`, `auth_elicitation`, `browser_use_full_cdp_access`, `code_mode`,
`code_mode_host`, `goals`, `plugin_sharing`, `remote_plugin`, `shell_snapshot`,
`skill_mcp_dependency_install`, `tool_call_mcp_elicitation`, `tool_suggest`, `shell_tool`,
`unified_exec`, `browser_use`, `in_app_browser`, `plugins`, `hooks`, `skill_search`,
`workspace_dependencies`, `multi_agent`, `image_generation`, `view_image`. Preflight обязан
подтвердить, что каждый retained member известен и effective `false`, а полный model-visible callable
inventory не содержит нового неизвестного tool.

`onboarding.extract` и `source.extract` принимают zero tool events. `source.discover` использует тот
же полный disable tuple, включая `code_mode` и `code_mode_host`, добавляет только public `--search`
и выбирает `gpt-5.4`; ни один feature не включается обратно. JSONL decoder принимает лишь exact
reviewed web-search start/result/complete events. Shell, file, browser/computer, MCP, plugin, skill,
app, image и любой unknown tool event немедленно дают protocol failure. `file_change` отдельно
считается terminal protocol failure даже когда pinned CLI уже отклонил его до mutation. Если
текущая версия CLI переименовала feature, model tool mode или event, production call не запускается
до новой reviewed revision `CodexToolPolicy` и повторного negative canary gate.

Temporary directory имеет mode `0700`, schema — `0600`; stdout/stderr bounded и остаются в памяти.
Directory удаляется в `finally`, stale app-owned directories scavenged по точному prefix/UID.
Raw prompt, output и auth material не записываются в application logs.

## 6. Capability-based preflight

Exact alpha build больше не является единственным compatibility signal: автообновление desktop CLI
делало patch pin ложной точкой отказа. Preflight всё равно fail-closed, но проверяет наблюдаемое
поведение текущего бинарника:

1. до любого child spawn, network, `CODEX_HOME` forwarding или runtime write проверены canonical
   paths, UID/mode/link-count и SHA-256 exact reviewed ChatGPT bundle; `CODEX_EXECUTABLE` допускается
   только absent либо равным reviewed path, а `PATH` не участвует в production resolution;
2. `codex login status` подтверждает ChatGPT subscription login;
3. synthetic extraction invocations с fixed `--model gpt-5.6-terra`, `low` и `medium`, а также
   discovery invocation с fixed `--model gpt-5.4`, `medium` успешно используют structured output;
   experimental `codex debug models` может дать diagnostics, но не является единственным gate;
4. required CLI flags и disabled-feature inventory распознаны;
5. synthetic no-tool structured probe возвращает exact schema;
6. отдельный synthetic discovery probe показывает только допустимые web-search events;
7. stdout/stderr/event bounds, cleanup и abort proof проходят.

Attestation относится к normal Next/Node registration, а не только к eval. Ошибка verifier или
неcanonical executable override обязана завершиться до первого `--version`, `login status`,
`features list` или model child и не оставляет установленный adapter.

Версия бинарника, protocol fingerprint и результаты probe сохраняются как несекретная runtime
диагностика. Drift required flag, event shape или tool inventory блокирует LLM capabilities до
обновления compatibility contract. Приложение не запускает login flow и не копирует auth storage.

## 7. Process ownership, abort и параллельность

Один city research job последовательно владеет своими вызовами, но разные города независимы.
Под глобальным adaptive pool сохраняется keyed single-flight. Canonical key включает capability,
model/effort, prompt/schema/tool-policy versions и canonical input identity: message hash для
onboarding, capture hash + fact definition для extraction либо failed binding revision + fact
definition + discovery round для recovery. Equivalent work имеет одного leader и не занимает второй
slot. Distinct keys могут выполняться параллельно, максимум пять Codex child processes:

```text
city A -> child 1
city B -> child 2
city C -> child 3
city D -> child 4
city E -> child 5
```

При `429`, transient provider failure или росте timeout pool сжимается `5 -> 3 -> 1`; после
cooldown пропускная способность восстанавливается постепенно. Подписочная квота общая: пять
процессов уменьшают wall-clock только пока backend принимает параллельность и не увеличивают quota.

Каждый child имеет отдельные cwd, schema, buffers, abort controller и terminal ownership token.
Abort завершает всё process group. После потери ownership stdout игнорируется, temporary state
удаляется и никакой late write невозможен. Abort одного города не отменяет остальные.

Waiter abort только отсоединяет этого waiter. Leader продолжает, пока остаётся хотя бы один owner;
если ушли все owners либо истёк общий deadline, process group завершается. Только leader может
передать один immutable terminal result Application и инициировать durable commit; waiters получают
тот же frozen result или typed terminal failure. Завершённый flight удаляется из registry только
после terminal handoff, поэтому duplicate capture, discovery, Evidence/Knowledge/Frontier write и
audit event для exact key невозможны.

SourceBinding update использует compare-and-swap по исходной revision. Если два job нашли замену
одному binding, выигрывает первый valid commit; второй перечитывает current revision и не делает
last-writer-wins overwrite.

До наполнения каталога одинаковый probe запускается с concurrency `1`, `2` и `5`. Stable maximum
выбирается по throughput, p95 latency, rate-limit/timeout rate и отсутствию cross-job leakage.

## 8. Capability contracts

### 8.1 `onboarding.extract`

Input содержит текущее сообщение, допустимый field catalog и минимальный current draft. Output:

```text
fieldId + typedValue + sourceSpan
```

Модель извлекает только явно написанное, не заполняет unknown/«не знаю», не меняет applicability и
не использует search. Existing local parser/guard остаётся fallback при unavailable model.

Current producer lineage использует `onboarding-extract@9` и
`onboarding-extraction-wire@3`. Модель возвращает proposal ровно как `{f,v,t}`, где `t` —
непустая contiguous substring, дословно скопированная из `currentUserMessage.text`. `t` обязана
встречаться в сообщении ровно один раз; если короткое whole-token evidence повторяется, модель
расширяет его соседним исходным текстом до уникального, иначе proposal опускается. Модель не
возвращает offsets и не получает `utf16Length`.

Infrastructure descriptor-safely snapshot-ит wire и `messageText`, запрещает accessors/proxies,
extra/symbol keys, cycles и exotic prototypes, затем без trim/case-fold/Unicode normalization
вычисляет `start = messageText.indexOf(t)` и `end = start + t.length`. Отсутствующее evidence и
любое второе вхождение, найденное с `start + 1` (включая overlapping duplicate), дают закрытый
schema-invalid retry. `String#indexOf`, `length` и `slice` используют одну UTF-16 coordinate system,
поэтому Application по-прежнему получает тот же frozen `sourceSpan`; wire-only `t` не попадает в
DTO, store, artifact или log. Общий message/evidence bound остаётся 8,192 UTF-8 bytes, proposal
count — не более 100.

V1–V8 tuples сохраняются byte-for-byte и реконструируются как история; только exact V9 tuple
является current. Hybrid и unknown version tuples fail-closed. Derived span всё равно проходит
существующие guard/canonical/evidence acceptance gates: code-owned position устраняет нестабильную
арифметику модели, но не считается самостоятельным доказательством семантической связи `t` с
`typedValue`. До общего owner walkthrough эта field-specific value/evidence проверка остаётся
отдельным hardening gate; Stage A сохраняет независимый exact-fixture oracle.

### 8.2 `source.extract`

Raw immutable capture остаётся локальным. Versioned deterministic projector удаляет scripts,
forms, comments, embedded objects, headers/cookies и metadata, извлекает visible public text либо
нужные JSON/XML scalar fields, выбирает fact-relevant sections и создаёт не более 64 KiB UTF-8
`SourceExcerptProjection`. Authenticated/personalized pages, user uploads, documents с PII,
embedded attachments/images и неизвестный MIME в модель не передаются.

Input модели содержит только этот ephemeral projection, entity, fact definition, expected
unit/period и parser contract. Output:

```text
observation + period + unit + exact quote/locator + ambiguities
```

Модель не получает право выдать цвет. HTML/PDF/JSON/XML считаются untrusted data; инструкции внутри
документа не меняют prompt или tool policy. Для extraction все tools запрещены. Quote обязан быть
exact substring projection, locator — попадать в его bounds, а versioned local parser — независимо
извлечь из quote то же observation. Full source bytes, projection и model output остаются
temp/memory-only и не попадают в логи; durable Evidence хранит локальный capture и verified locator.

### 8.3 `source.discover`

Input содержит только public entity, fact definition, failed URL, canonical failure reason, known
authority roots и locale hints — без questionnaire/profile values. Output содержит не более пяти
кандидатов:

```text
url + claimed publisher + expected coverage + discovery rationale
```

Search snippet и rationale используются только для планирования SourceGate. Модель не передаёт
извлечённый search fact непосредственно в Evidence.

#### 8.3.1 Ограничение local-subscription transport

Закреплённый `codex-cli 0.149.0-alpha.4` предоставляет native `web_search` модели, но не имеет
поддерживаемого CLI/config selector, который обязывает модель вызвать этот tool. `--search`
означает только availability. Поэтому local-subscription adapter честно использует два bounded
medium attempt под одним deadline/signal/single-flight и принимает candidate hints только вместе с
положительным reviewed native-search proof. Если обе полностью разобранные попытки имеют нулевой
search proof, adapter возвращает отдельный content-free `codex_search_not_performed`; это штатный
yellow outcome без SourceBinding/Evidence/Knowledge/Frontier write. Malformed, prohibited или
неизвестные tool events остаются `codex_tool_event` и не маскируются под yellow.

Это ограничение относится только к локальному subscription transport. Патчить приватный
`alpha/search`, переиспользовать subscription credentials или считать URL/citation/model field
доказательством поиска запрещено. Детерминированный будущий transport должен предоставить
code-owned bounded search results через отдельный `NativeOfficialSearchPort`, после чего Terra
разбирает их с отключёнными tools; это не меняет frozen public source DTO.

#### 8.3.2 Reviewed direct-search transport

Проверка bundled model catalog и owner-authorized live probe показали, что `gpt-5.6-terra`
маршрутизирует search через `code_mode_only`, а `gpt-5.4 medium` выполняет native `web_search`
напрямую при одновременно отключённых `code_mode` и `code_mode_host`. Поэтому local beta использует
`gpt-5.4 medium` только для `source.discover`; extraction остаётся на Terra low/medium.

Официальный model contract также объявляет для `gpt-5.4` both Web search и Apply patch. У pinned CLI
нет reviewed strict-config key, удаляющего только Apply patch. Перед принятием direct-search
transport отдельный live gate создаёт fresh owned `0700` cwd и `0600` canary, делает native search,
затем просит один context-valid patch и принимает только exact sequence `file_change in_progress ->
failed`, clean process exit и неизменные bytes/mode/UID/link/inode canary. Это доказывает для exact
аттестованного bundle, что managed approval + read-only sandbox блокируют write до mutation. Любой
успешный/неполный/unknown file event, изменение canary, отсутствие native search или drift event
shape блокирует Stage A. Production discovery всё равно fail-closed на первом `file_change` и не
преобразует его в yellow.

Это сознательно более узкая гарантия, чем «модель не видит write tool»: модель его видит, но не
может успешно совершить write. Code Mode, host, shell, unified exec, MCP, browser и остальные
retained features остаются disabled. При обновлении бинарника digest attestation ломается раньше
spawn, и negative gate должен быть reviewed заново.

## 9. Source identity и official gate

Источник привязан к точной проверке:

```text
entityId + factKey + definitionId -> active SourceBinding revision
```

Несколько bindings могут переиспользовать один verified capture, но замена одного binding не меняет
остальные автоматически.

Официальным считается first-party publisher, отвечающий за факт: государственный/муниципальный
орган, официальное статистическое ведомство, полиция либо официальный оператор соответствующей
системы. Wikipedia, Numbeo, СМИ, блоги, агрегаторы и snippets не становятся Evidence.

Новый publisher/domain принимается только при проверяемой authority chain к установленному trust
anchor: официальный registry, ссылка с trusted government root или exact policy-approved ownership
relationship. Название, `.gov`-подобная зона и утверждение модели сами по себе недостаточны.
Неоднозначная ownership оставляет результат жёлтым.

До первого network request independently проверяются installed package и manifest, active binding,
authority directory и exact policy versions. Network gate запрещает URL credentials, private,
loopback и link-local addresses, DNS rebinding, unsafe redirects, TLS bypass, oversized/decompression
payloads и unsupported MIME. HTTPS обязателен кроме exact installed legacy exception.

## 10. Append-only replacement и атомарность

Installed package/manifest никогда не переписываются. Найденная замена публикуется как layered
SourceBinding revision. Namespace source replacement отделён от package/catalog contract versions:

- closed schema version: `source-binding@1`;
- closed policy version: `official-source-recovery@1`;
- append-only `revisionOrdinal`: `1, 2, 3, ...` без искусственного лимита;
- event schema: `official-source-replaced@1`.

История выглядит так:

```text
installed source -> override revision 1 -> revision 2 -> revision 3
```

Одна транзакция:

1. создаёт SourceVersion;
2. сохраняет captured Evidence и его hash;
3. публикует Knowledge и затронутый Frontier projection;
4. переводит active SourceBinding через compare-and-swap;
5. добавляет append-only audit event.

Если любой шаг не проходит integrity или persistence gate, не публикуется ни один. Existing atomic
Evidence -> Knowledge -> Frontier invariant сохраняется. Historical replay использует exact binding,
package, parser и rules versions исходного run, не читает current URL и не делает network/model call.
Existing package/catalog/policy contracts с поддержанными `@1`/`@2` semantics воспроизводятся
отдельно; неизвестный schema/rules identifier вроде `city-catalog@999` или `source-binding@999`
отвергается. `revisionOrdinal = 999` сам по себе не является неизвестной schema и не запрещает
легитимную долгую историю замен.

Rollback создаёт следующую revision, указывающую на прежний valid SourceVersion, а не удаляет строки.

## 11. Audit и public provenance

Каждая попытка recovery имеет run ID и append-only timeline. Для replacement сохраняются:

- old/new requested и final URLs;
- canonical failure reason старого source;
- search query/template version;
- список кандидатов и причины reject/accept;
- authority chain и SourceGate policy version;
- Codex CLI/model/reasoning, prompt/schema/protocol versions;
- capture/evidence hashes, timestamps и повторный результат;
- actor `local_codex_recovery` и parent run IDs.

Questionnaire values, access tokens, full prompts, source excerpt projections, raw model output и
unrelated journey history в audit не попадают.

Public source projection имеет один closed contract:

```ts
type PublicFactSourceV1 = Readonly<{
  schemaVersion: "public-fact-source@1";
  factKey: string;
  status: "green" | "red" | "yellow";
  publisherName: string | null;
  sourceUrl: string | null;
  checkedAt: string | null;
}>;
```

Для green/red `publisherName`, `sourceUrl` и `checkedAt` берутся только из verified Evidence и exact
SourceVersion; `sourceUrl` равен direct final captured URL. Yellow без verified observation может
иметь `null`, но не search candidate. DTO не раскрывает model/search/audit/internal IDs, query,
rationale или authority internals. Public boundary descriptor-safely реконструирует closed plain
data, отвергает accessors/proxies/extra keys и рекурсивно freeze-ит owned object до возврата клиенту.

Пользователь может открыть источник и сообщить о неофициальном publisher; такая жалоба
рассматривается отдельным support flow и не меняет исторический Evidence молча.

## 12. Bounded failure semantics

- transient SourceCapture может иметь ограниченный transport retry;
- `onboarding.extract` и `source.extract` допускают один schema/ambiguity retry: first attempt
  использует `low`, retry — `medium`;
- `source.discover` имеет максимум два medium discovery rounds по пять кандидатов; второй round
  одновременно является единственным retry и отдельного третьего schema retry нет;
- integrity/security/ownership failure не retry-ится автоматически;
- exhausted recovery даёт formal yellow;
- model timeout/rate limit/invalid output не даёт red;
- abort не создаёт durable result;
- onboarding при model failure использует существующий локальный fallback.

Retry остаётся внутри того же keyed flight, terminal ownership token и общего deadline, не создаёт
новый durable run и не может обходить deadline. Все counters и причины остаются наблюдаемыми;
recursive/unbounded discovery запрещён.

## 13. Delivery sequence

### A. Stable local runtime

1. устранить stale version contract и диагностировать текущие HTTP/state-DB failures;
2. аттестовать exact reviewed installation до первого spawn, получить успешные
   Terra-low/Terra-medium extraction и `gpt-5.4 medium` discovery probes и честно зафиксировать
   native search как `available + model-selected`, сохранив post-hoc proof;
3. доказать questionnaire extraction и хотя бы один official-source candidate discovery; каждый
   bounded zero-search/no-candidate исход обязан завершаться formal yellow без source mutation;
4. прогнать concurrency benchmark `1/2/5` и abort/no-late-write;
5. доказать direct-search negative canary denial без Code Mode и зафиксировать стабильную local
   command и diagnostics.

### B. Demo catalog

После runtime gate исследуется субъективный каталог десяти узнаваемых направлений для переезда у
русскоязычной аудитории. Он называется `demo catalog`, а не объективным top-10. Выбор учитывает
узнаваемость, разнообразие relocation scenarios и наличие official data; использованные обзоры не
становятся Evidence о странах.

Для каждой страны выбираются столица и четыре узнаваемых relocation cities — всего 50 city jobs,
обрабатываемых batches до пяти. Country/city facts используют существующие versioned definitions и
только официальные sources.

### C. Full working flow

```text
questionnaire
  -> confirmed profile
  -> country research and recovery
  -> shortlist
  -> city research and recovery
  -> City Frontier
  -> Select City
  -> history/replay
```

Каждый шаг проверяется отдельно и затем end-to-end с real local LLM. Existing setup/start/present,
prepare/continue, durable Evidence/Knowledge/Frontier, events/composition, abort/recovery/concurrency,
legacy/history и frozen DTO guarantees не сокращаются.

### D. Owner walkthrough

Владелец получает точную local start command, demo scenario, результаты с direct source links,
replacement audit timeline и known limitations. После ручного прохода UI/design changes оформляются
отдельным change package.

## 14. Acceptance

Design считается реализованным только когда:

1. local subscription auth, exact capability mapping (`gpt-5.6-terra` extraction/review,
   `gpt-5.4 medium` discovery) проходят; local native search фиксируется как
   `available + model-selected`, а любой green discovery требует положительный reviewed search
   proof;
2. repository/user config/tools не попадают в child, extraction допускает zero tools, discovery —
   только reviewed web-search events; Code Mode остаётся disabled, а direct-search negative canary
   доказывает denied pre-mutation file change и неизменный файл;
3. questionnaire fixture стабильно превращается в guarded proposals без invented values;
4. capture -> extraction -> deterministic color сохраняет exact provenance;
5. broken/stale URL запускает bounded discovery, а не red;
6. минимум один live scenario проходит `broken URL -> official candidate -> SourceGate -> atomic
   replacement -> repeated fact check`;
7. no official candidate и exhausted `codex_search_not_performed` дают yellow и не создают
   SourceBinding/Evidence/Knowledge/Frontier mutation;
8. три последовательных five-city batch runs завершаются без cross-job leakage и необработанных
   ошибок;
9. concurrency `1/2/5`, adaptive backoff, process-tree abort и no-late-write подтверждены;
10. package/manifest checks независимы и происходят до network/write;
11. Source/Evidence/Knowledge/Frontier publication атомарна, CAS race не теряет winner history;
12. `@1`/`@2` replay сохраняется, `@999` fail-closed;
13. confidentiality, ownership и frozen public DTO tests проходят;
14. historical replay выполняет zero Codex/web/source calls;
15. UI показывает direct current source и reviewable replacement log.

Unit/integration suites используют fake process/fetch ports. Реальные subscription/search evals
являются explicit local opt-in и не входят в обычный CI.

## 15. Deferred backlog: `dev-llm`

Отдельный будущий change package добавит provider switch:

```text
dev-llm = true  -> LocalCodexSubscriptionProvider
dev-llm absent/false -> ExternalApiProvider
```

Оба provider обязаны реализовать те же узкие capability ports, schemas, events, privacy и failure
semantics. External API credentials не переиспользуют `CODEX_HOME`; subscription auth не становится
server credential. Default hosted/normal mode использует external API.

Этот switch, ExternalApiProvider, provider registry, hosted isolation, billing/rate policy и migration
с local beta намеренно не реализуются в текущем этапе.

## 16. Official OpenAI references

- Codex CLI supports stable non-interactive `codex exec`, structured JSONL/schema output, model
  selection and live `--search`: <https://learn.chatgpt.com/docs/developer-commands?surface=cli>.
- Local Codex CLI supports ChatGPT sign-in for subscription access:
  <https://learn.chatgpt.com/docs/auth>.
- `gpt-5.6-terra` supports structured output, web search and bounded reasoning levels:
  <https://developers.openai.com/api/docs/models/gpt-5.6-terra>.
- `gpt-5.4` supports structured output, medium reasoning and both Web search and Apply patch; local
  beta therefore relies on the reviewed CLI denial gate rather than claiming the patch declaration
  is absent: <https://developers.openai.com/api/docs/models/gpt-5.4>.
