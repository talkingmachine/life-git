# Competition Runtime через установленный Codex CLI

| Поле | Значение |
| --- | --- |
| Статус | `approved` |
| Владелец решения | пользователь проекта |
| Дата | 2026-08-20 |
| Область | две model-assisted capabilities конкурсного локального приложения: onboarding и `VS-4` film |
| Зависимости | Local Conversational Onboarding, VS-4 Full Life, установленный Codex CLI и личный ChatGPT/Codex login |
| Supersedes | local Qwen/GGUF runtime; blanket zero-external-model clauses для двух approved capabilities |
| Approval | пользователь проекта / 2026-08-20 / Codex CLI вместо локальной модели / approved; exact-build tool-isolation closure / 2026-08-21 |

## 1. Решение

Конкурсная версия остаётся локальным Next.js-приложением на Mac пользователя: UI, Application,
SQLite, official-source research, guards, calculations и replay выполняются локально. Для двух
строго ограниченных model-assisted операций приложение запускает уже установленный Codex CLI,
авторизованный личным ChatGPT/Codex login:

1. извлечение явных ответов и финальное ревью onboarding;
2. создание закрытой film projection в `VS-4`.

Questionnaire payloads, закрытая branch projection и явно выбранные test fixtures могут
передаваться OpenAI через Codex CLI. Приложение не вызывает LLM API напрямую, не запрашивает и не
хранит API key, не устанавливает model SDK, не поставляет и не скачивает Qwen, GGUF или другие
model weights.

Это competition-only deployment boundary для одного заранее подготовленного Mac. Интернет-версия,
монетизация и прямой OpenAI API являются отдельным будущим change package. Текущая реализация не
создаёт provider registry, provider switch или универсальный model framework.

## 2. Граница доверия

Codex возвращает только недоверенный structured proposal. Детерминированные локальные guards
решают, можно ли использовать его результат.

Codex не имеет права создавать или изменять:

- official fact, Evidence, source или provenance;
- eligibility, residence route, ranking, marker или verdict;
- budget, FX conversion, formula output или другую calculation;
- applicability и обязательность полей анкеты;
- новые field IDs, criteria, film segment types или reason codes.

Onboarding принимает только allowlisted field proposals, которые независимо проходят source-span,
normalizer и schema guards. Full Life принимает только closed film document, каждый segment которого
ссылается на существующие input IDs. Невалидный model output не становится частичным продуктовым
результатом.

Official-source discovery и validation не используют Codex. Historical replay читает сохранённые
snapshots/film и делает zero model calls.

## 3. Архитектура

```text
local Next.js UI
  -> capability-specific Application use case
  -> narrow inward model port
  -> CodexCliModelAdapter (Infrastructure)
  -> installed authenticated Codex CLI
  -> OpenAI
  -> strict JSON Schema
  -> local deterministic parser/guard
  -> questionnaire draft or film draft
```

Infrastructure содержит один concrete `CodexCliModelAdapter`. Onboarding и Full Life получают два
разных узких inward ports с собственными prompt, output schema, limits и guards. Они могут разделять
один process launcher, но не получают generic provider API и не видят Codex auth storage.

Используются только встроенные process/file primitives Node.js. `node-llama-cpp`, OpenAI SDK и
другая model dependency не добавляются.

## 4. Закрытый invocation contract

Перед запуском приложения preflight проверяет заранее заданный или найденный в `PATH` executable,
его версию и `codex login status`. На утверждённом demo Mac проверено:

- `codex-cli 0.148.0-alpha.15`;
- `Logged in using ChatGPT`;
- `codex exec` поддерживает ephemeral execution и JSON Schema output.

Observed bounded streams are exact: version stdout is `codex-cli 0.148.0-alpha.15\n`; version stderr
is empty outside the sandbox or contains exactly one known PATH-alias warning inside it. Login stdout
is empty and login stderr is exactly `Logged in using ChatGPT\n`, optionally preceded by that one
known warning. The preflight rejects every other ordering, repetition, or content and consumes these bytes privately and
never copies stderr into application errors, artifacts or logs.

Это зафиксированное наблюдение demo-окружения, а не обещание совместимости с любой будущей версией
Codex. Несовместимая версия блокирует model-assisted actions до явного обновления и повторного eval.
Приложение не запускает login flow и не читает, не копирует и не показывает auth token.

Каждый model call создаёт новый процесс и отдельный app-owned temporary directory. Adapter передаёт
prompt через stdin, без shell interpolation, и запускает эквивалент следующего contract:

```text
codex exec
  --strict-config
  --ephemeral
  --ignore-user-config
  --ignore-rules
  --disable apps
  --disable auth_elicitation
  --disable browser_use_full_cdp_access
  --disable code_mode
  --disable code_mode_host
  --disable goals
  --disable plugin_sharing
  --disable remote_plugin
  --disable shell_snapshot
  --disable skill_mcp_dependency_install
  --disable tool_call_mcp_elicitation
  --disable tool_suggest
  --disable shell_tool
  --disable unified_exec
  --disable browser_use
  --disable in_app_browser
  --disable plugins
  --disable hooks
  --disable skill_search
  --disable workspace_dependencies
  --disable multi_agent
  --disable image_generation
  --disable view_image
  --sandbox read-only
  --skip-git-repo-check
  --cd <empty app-owned temporary directory>
  --output-schema <app-owned JSON Schema>
  --json
  -
```

Adapter не добавляет workspace/repository directories, images, MCP servers, project-local skills,
callable skill features, user rules или conversation resume. Общий inert CLI skill catalogue может
остаться частью pinned base developer text, но он не получает file/shell/project capability. Child
получает новый environment из закрытого allowlist, а не наследует
`process.env`: только минимальные locale/temp values и существующий `CODEX_HOME`, необходимый CLI
для auth. Application secrets и unrelated environment variables не передаются.

Этот exact tuple содержит 23 model-visible tool-related features pinned build. Единый tuple
используется для local feature inventory и `exec`: inventory обязан найти все 23 имени ровно по
одному разу с effective state `false`. Полный registry принадлежит CLI и содержит другие известные
features, поэтому unrelated registry entries допускаются; missing/duplicate/enabled pinned member
или malformed/duplicate registry line останавливает gate. Реальный inventory больше 4 KiB, поэтому
ему выделен отдельный bounded stdout limit, не расширяющий limits остальных preflight probes.
`--strict-config` обязателен для `exec`, чтобы drift имени/конфигурации не был silently ignored.
Approval-policy override не передаётся: наблюдаемый override не изменяет managed startup behavior
и поэтому создавал бы misleading contract.
Tuple выключает и actual capability `code_mode`, и отдельный host-support feature
`code_mode_host`; inventory обязан подтвердить effective `false` для обоих.
Локальный `debug prompt-input` показывает model-visible message inputs, но не отдельный hidden tool
registry; он используется только для доказательства отсутствия project/workspace path, user/project
rules, app-specific instructions и project-local skill payload при fresh empty validated cwd и
закрытом child environment. Изоляция принимается только совокупно: exact inventory, strict exec
contract, empty cwd, closed env, отсутствие запрещённого project-specific input, выключенные
`skill_search`/`skill_mcp_dependency_install` и fail-closed rejection любого tool event. Если
любой элемент не подтверждён, adapter не
реализуется и вопрос возвращается пользователю; tool-enabled Codex не является допустимым fallback.

Generic JSONL parser по-прежнему reject-ит любой error notice. Только proof-producing feasibility
seam требует ровно два consecutive notice после sole `thread.started` и непосредственно перед
`turn.started`: сначала `item_0` policy notice с unordered exact event/item key sets, UTF-8 length
277 и raw decoded-message SHA-256 `dc04a3e848ff580847de6950e6415fe72d1daab7d83336461b55b6fc8355e177`,
затем `item_1` с теми же exact key/type constraints и exact 157-byte `code_mode_host` disabled
message. Нормализация не выполняется. Seam возвращает только fixed enum tuple
`["approval_policy_never_to_unless_trusted","code_mode_host_disabled"]`, final message и event types
из одного parse. Omission, extra, reorder, mutation, wrong key/ID/position и любой later error остаются
protocol failure. Raw policy text не доступен unit tests: они pin-ят UTF-8/SHA mechanics, host positive
и exhaustive negatives; единственный real gate является sole positive policy-hash integration.

`--json` stdout имеет строгий byte/event limit. Adapter извлекает final assistant event только из
потока в памяти, парсит его как JSON и после JSON Schema запускает capability-specific parser.
Stdout/stderr не записываются в application logs.

Temporary directory создаётся с mode `0700`, а его schema file — `0600`. Prompt передаётся только
через stdin, result остаётся только в bounded memory; sensitive result file не создаётся. Directory
удаляется в `finally`, а startup scavenger удаляет только принадлежащие текущему UID stale directories
с exact app prefix, оставшиеся после crash/SIGKILL/power loss. `--ephemeral` запрещает сохранение
Codex session. Никакой `resume`, session ID, background process, cache или recorded-response
fallback не используется.

## 5. Данные и privacy

Приложение передаёт только минимальный capability-specific payload:

- onboarding: сообщения текущей session, текущее закрытое questionnaire state и versioned field
  vocabulary без имён, номеров паспортов и других неиспользуемых identifiers;
- Full Life: закрытая branch projection с typed facts/classes/input refs, но без raw official-source
  bytes, credentials или неотносящегося к ветви journey history;
- eval: только явно утверждённые synthetic/test fixtures.

Пользователь осознанно разрешил передачу своей анкеты и тестовых данных OpenAI через личный Codex
login. Приложение не обещает управлять server-side retention OpenAI; эта часть определяется
условиями личного аккаунта. Локально transcript, prompts, source spans и raw model output остаются
session/temp-only, не попадают в journey history, application/crash/telemetry logs и удаляются после
успешного handoff или завершения session.

Эта competition-only схема не является multi-user OS isolation boundary: Codex CLI запускается под
локальной учётной записью владельца Mac и использует её auth storage. Поэтому runtime принимает
только анкету владельца либо заранее просмотренные test fixtures, не обрабатывает untrusted
third-party documents и не обещает безопасный hosted service. Интернет-версия не переиспользует
эту trust assumption и получает отдельную API/server-isolation спецификацию.

Сетевой аудит допускает только два независимых контура: Codex CLI ↔ OpenAI для двух approved
capabilities и existing HTTPS к official sources для Research. Для model-runtime eval exact
allowlist содержит только `chatgpt.com:443`. Непосредственно перед spawn gate строит bounded
non-empty A/AAAA snapshot этого exact hostname; observed traffic никогда не расширяет allowlist.
Observer использует только numeric machine output `lsof -nP`, canonical-сравнивает IPv4/IPv6 с
этим snapshot и не доверяет PTR/reverse DNS. Он отдельно доказывает liveness Codex PID и
Node/application PID и семплирует их на одном spawn-to-exit интервале: у Codex должен быть только
reviewed `chatgpt.com` established TCP/443 traffic, а у Node/application — ни одного socket; любой
UDP и любой иной TCP socket у обоих процессов fail-closed.
Пропущенный/dead PID, malformed sample, пустой Codex observation, unknown/ambiguous IP или сырой IP
в artifact не считается доказательством. Это bounded sampled evidence, а не обещание увидеть socket,
который целиком возник и исчез между samples. Иной observed model/provider traffic и application
telemetry с questionnaire/film content запрещены.

## 6. Failure semantics

Model-assisted action fail-closed при любом из условий:

- Codex CLI отсутствует, имеет несовместимую версию или не авторизован;
- OpenAI/Codex недоступен;
- процесс завершился с ошибкой, превысил timeout/output limit или был abort;
- event stream содержит tool call либо нарушает protocol;
- result не является strict JSON, не проходит schema или capability guard.

Onboarding сохраняет текущий transcript и questionnaire draft; Full Life сохраняет branch draft.
Переход или commit блокируется явной service error. Application не запускает второй Codex process,
не выполняет повторный model invocation, не создаёт retry state/кнопку, не запускает фоновый повтор
и не подставляет recorded/deterministic model response. Внутреннее transport behavior одного
opaque Codex CLI/service invocation приложение не контролирует и не представляет как продуктовый
retry. После восстановления пользователь повторяет обычное действие.

Abort немедленно завершает child process; late output игнорируется и удаляется. Один пользовательский
action создаёт не более одного Codex process.

## 7. Версии, replay и diff

Durable lineage хранит версию Codex CLI invocation contract, prompt/template и output schema;
observed model/runtime metadata сохраняется, только если CLI сообщает её в закрытом protocol.
Приложение не pin-ит скрытый model ID, не передаёт `--model` и использует CLI default для
аутентифицированного аккаунта и прошедшей preflight build.

Remote Codex generation не считается byte-deterministic. Replay всегда использует сохранённый
guarded output и не запускает Codex повторно. В Life Git причинными называются deterministic
изменения facts/calculations, выведенные из изменённого решения. Narrative baseline и alternative
показываются как две versioned projections; различие их текста само по себе не называется causal и
не требует same-input regeneration.

## 8. Acceptance

Runtime contract принят, когда:

1. preflight на demo Mac подтверждает `codex-cli 0.148.0-alpha.15` и ChatGPT login без API key;
2. реальный synthetic extraction и review возвращают strict guarded output;
3. реальная synthetic Full Life projection проходит schema и lineage guards;
4. exact 23-feature inventory reports every member known and false; `--strict-config` exec uses that
   same tuple, fresh empty validated cwd and closed env; message inputs contain no
   project/workspace/user-rule/app-specific/project-skill context, both callable skill features are
   false; the diagnostic's exact own fresh cwd is expected plumbing rather than project context;
   prompt injection produces no tool event, and any tool/protocol event fails closed;
5. unknown field/segment, invented value/ref, malformed/oversize output, abort, timeout, missing CLI
   и logged-out state fail-closed без изменения durable state;
6. every call uses a fresh `0700` temporary directory/process, passes prompt only through stdin,
   leaves no Codex session or sensitive result file, deletes schema temp files, and startup safely
   scavenges an injected stale app-owned directory;
7. project files, user config/rules/MCP, inherited secrets and unrelated journey data are not
   supplied to the process;
8. dependency/file audit finds no Qwen, GGUF, `node-llama-cpp`, model downloader, OpenAI SDK or API-key
   handling in the competition runtime;
9. network audit maps numeric connections through a bounded pre-spawn DNS snapshot of exact
   `chatgpt.com`, samples both live Codex and Node/application PIDs over the same spawn-to-exit
   interval, observes only allowlisted Codex CLI ↔ OpenAI TCP/443 traffic, and observes zero
   Node/application questionnaire/film telemetry;
10. one user action starts at most one Codex process and Application never performs a second
    invocation automatically;
11. historical replay makes zero Codex/OpenAI calls;
12. measured canonical onboarding and 3–5-minute demo budgets pass on the prepared Mac.

## 9. Не-цели

- offline inference или работа model-assisted actions без интернета;
- bundled/downloaded local model, Qwen, GGUF, Ollama, LM Studio или `node-llama-cpp`;
- прямой OpenAI/Responses API call из Next.js;
- запрос, ввод, хранение или billing API key приложением;
- provider registry, model chooser, fallback provider или monetization infrastructure;
- Codex session resume, autonomous coding/tool workflow или доступ к project context;
- model-assisted official discovery, evidence, calculation, ranking или verdict;
- byte-identical regeneration remote model output.

## 10. Приоритет

Этот документ supersedes model-runtime clauses в pre-defense provider-free spec, Local
Conversational Onboarding, VS-4 Full Life, Product Charter, Demo Story, Glossary и Spec of Specs.
Official-only Evidence, deterministic rules/calculations, replay, privacy whitelist и пользовательское
владение решением не меняются.

Существующие implementation plans с Qwen/GGUF/`node-llama-cpp`, download/SHA gate, local-model
manifest или zero-external-model audit являются устаревшими и не исполняются. После отдельного
review этого design package они заменяются новым implementation plan; production code до этого не
меняется.
