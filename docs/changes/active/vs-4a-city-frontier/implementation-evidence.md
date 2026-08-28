# VS-4A City Frontier — beta implementation evidence

| Поле | Значение |
| --- | --- |
| Статус | `implementation in progress — beta delivery locally verified` |
| Дата проверки | 2026-08-28 |
| Область | проверенный beta core и первый executable delivery vertical; не source-verified VS4A delivery |
| Code checkpoint | `0576d1b775a4a519c97a3f42952716ea7acd5e17` |

## Подтверждённый beta scope

- Setup.
- Start и Present.
- Prepare и один успешный Continue.
- Durable проекция Evidence → Knowledge → Frontier.
- Events и composition.
- Abort, recovery и concurrency.
- Lineage и history replay.
- Atomic public `SelectCity` и sibling City Branch publication.
- Strict Start/Continue/Select HTTP adapters.
- Finite NDJSON decoder и browser-safe frozen projection.
- Setup/live/stored City Journey, terminal green/yellow cards, exact risk-bound Select и verified
  append-only selection/branch history.

## Delivery PR ledger

- [PR #15](https://github.com/talkingmachine/life-git/pull/15) — `SelectCity` и sibling branches.
- [PR #16](https://github.com/talkingmachine/life-git/pull/16) — strict City HTTP transport.
- [PR #17](https://github.com/talkingmachine/life-git/pull/17) — finite decoder и pure projection.
- [PR #18](https://github.com/talkingmachine/life-git/pull/18) — executable City experience,
  terminal cards и selection UX.

## Blocking guarantees

Автоматизированные проверки подтверждают independent package/manifest checks, integrity до write
или другого irreversible side effect, atomic publication проекции Evidence → Knowledge → Frontier,
single-flight, abort и no-late-write. Также проверены policy behaviours `@1`, `@2` и `@999`, а
также confidentiality, ownership и frozen public DTOs. Browser adoption дополнительно требует
strict full-DTO normalization, exact run/revision/command/candidate binding и сохраняет ранее
verified selection/branch history как неизменяемое подмножество следующего read model.

## Локальная проверка beta delivery checkpoint

На beta-delivery code checkpoint после Task 18 выполнены следующие команды и получены результаты:

```bash
./node_modules/.bin/vitest run
# 101/101 files, 3,434/3,434 tests

./node_modules/.bin/tsc --noEmit
# exit 0

./node_modules/.bin/eslint .
# exit 0

env NEXT_TELEMETRY_DISABLED=1 ./node_modules/.bin/next build
# exit 0
```

## Ограничения и следующий scope

Не заработаны deterministic Task 19 replay/SQL/official-source acceptance evidence, browser
walkthrough и live-source/model evidence. Поэтому VS4A не получает полный статус `implemented` или
`source-verified`.

Existing live-only databases автоматически не мигрируются: до любой мутации они должны fail closed
с `database_schema_reset_required`.

Оставшиеся legacy/history/edge и visual/a11y/lifecycle matrices находятся вне earned beta scope.
Nonblocking hardening backlog: `CITY-EVIDENCE-SCHEMA-CLOSURE`, `CODEX-PROCESS-TREE-OWNERSHIP`,
`CODEX-IO-TARGET-OWNERSHIP` и `DECIMAL-ORDER-BOUNDS`.
