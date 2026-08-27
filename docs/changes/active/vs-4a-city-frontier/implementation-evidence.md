# VS-4A City Frontier — beta implementation evidence

| Поле | Значение |
| --- | --- |
| Статус | `implementation in progress — beta core verified` |
| Дата проверки | 2026-08-27 |
| Область | проверенный beta core City Frontier; не полный VS4A delivery |

## Подтверждённый beta scope

- Setup.
- Start и Present.
- Prepare и один успешный Continue.
- Durable проекция Evidence → Knowledge → Frontier.
- Events и composition.
- Abort, recovery и concurrency.
- Lineage и history replay.

## Blocking guarantees

Автоматизированные проверки подтверждают independent package/manifest checks, integrity до write
или другого irreversible side effect, atomic publication проекции Evidence → Knowledge → Frontier,
single-flight, abort и no-late-write. Также проверены policy behaviours `@1`, `@2` и `@999`, а
также confidentiality, ownership и frozen public DTOs.

## Локальная проверка repair checkpoint

На reviewed repair checkpoint выполнены следующие команды и получены результаты:

```bash
pnpm install --offline --frozen-lockfile --frozen-store --store-dir <pnpm-store>
# exit 0; <pnpm-store> — проверенный offline frozen store

pnpm typecheck
# exit 0

pnpm lint
# exit 0

pnpm exec vitest run --reporter=dot
# 98/98 files, 3,299/3,299 tests

pnpm build
# exit 0
```

## Ограничения и следующий scope

Не заработаны public `SelectCity` write use case, City HTTP transport, City UI, browser walkthrough
и live-source/model evidence. Поэтому VS4A не получает полный статус `implemented`.

Existing live-only databases автоматически не мигрируются: до любой мутации они должны fail closed
с `database_schema_reset_required`.

Оставшиеся legacy/history/edge matrices находятся вне earned beta scope. Nonblocking hardening
backlog: `CITY-EVIDENCE-SCHEMA-CLOSURE`, `CODEX-PROCESS-TREE-OWNERSHIP`,
`CODEX-IO-TARGET-OWNERSHIP` и `DECIMAL-ORDER-BOUNDS`.
