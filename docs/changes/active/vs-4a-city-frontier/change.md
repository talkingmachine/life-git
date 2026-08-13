# Change: VS-4A City Frontier

| Поле | Значение |
| --- | --- |
| Статус | `approved — implementation pending` |
| Владелец решения | пользователь проекта |
| Последняя проверка | 2026-08-13 |
| Область ответственности | установленный City Catalog, four-criterion city fit, frozen frontier, terminal shortlist и первый выбор городской Life Git ветви |
| Supersedes | только forward обещание «1–3 города»; historical VS-3/VS-3R artifacts не изменяются |
| Зависимости | [`VS-3R Yellow Resolution`](../vs-3r-yellow-resolution/change.md), [approved design](../../../superpowers/specs/2026-08-13-vs-4a-city-frontier-design.md), [plan index](../../../superpowers/plans/2026-08-13-vs-4a-city-frontier.md) |
| Approval | exact written design и implementation plan approved by user 2026-08-13 |

## 1. Goal и canonical flow

`GOAL-CF-01`: для одной effective-green страны из verified non-empty `Resolved Country Shortlist
Snapshot` пользователь наблюдает проверку городов в замороженном порядке и получает до трёх
selectable городов либо честное исчерпание установленного каталога.

```text
Resolved Country Shortlist entry
  -> confirmed four-criterion City Criteria Snapshot
  -> full installed City Catalog ranking
  -> one-city-at-a-time fresh four-fact verification
  -> three selectable cities or catalog exhaustion
  -> atomic City Selection Snapshot + sibling City Branch Commit
```

City fit не меняет formal или effective status страны. City Frontier не принимает automatic
shortlist, working resolution, empty/tampered terminal или effective-red country.

## 2. Approved design и execution plans

- [Approved VS-4A design](../../../superpowers/specs/2026-08-13-vs-4a-city-frontier-design.md)
- [VS-4A plan index](../../../superpowers/plans/2026-08-13-vs-4a-city-frontier.md)
- [VS-4A Foundations](../../../superpowers/plans/2026-08-13-vs-4a-city-frontier-foundations.md)
- [VS-4A Evidence and Knowledge](../../../superpowers/plans/2026-08-13-vs-4a-city-frontier-knowledge.md)
- [VS-4A Frontier Core](../../../superpowers/plans/2026-08-13-vs-4a-city-frontier-core.md)
- [VS-4A Delivery](../../../superpowers/plans/2026-08-13-vs-4a-city-frontier-delivery.md)

## 3. Requirements

- `REQ-CF-01` — immutable `City Catalog Revision` содержит все официальные городские/муниципальные
  центры с latest comparable official population `>= 20 000`, national и explicitly typed regional
  capitals независимо от population, затем крупнейшие comparable centers до top-10 при наличии.
  Top-10 — минимум, не максимум; missing population не угадывается, а incomplete coverage честно
  показывается.
- `REQ-CF-02` — пользователь подтверждает immutable `City Criteria Snapshot` ровно из четырёх
  independently configurable criteria: safety, long-term rent, urban transit и fixed broadband;
  каждое содержит mode `required | weighted`, exact target, importance `1..5` и versioned definition.
- `REQ-CF-03` — полный City Catalog получает frozen deterministic ranking. Unknown даёт factor `0`,
  сохраняет weight в denominator и снижает coverage; только fresh comparable verified required
  mismatch создаёт screened exclusion.
- `REQ-CF-04` — один explicit Continue проверяет ровно один frozen candidate и закрывает все четыре
  факта. Каждый факт становится `verified` с comparable typed value либо evidence-backed `unknown`;
  crash, cancel, protocol, storage и integrity failures domain unknown не создают и cursor не двигают.
- `REQ-CF-05` — каждая завершённая проверка публикует append-only полную `City Knowledge Revision`
  ровно с четырьмя facts/statuses. Старое value в successor не переносится; ranking-time data frozen,
  а fresh live Knowledge влияет только на следующий run.
- `REQ-CF-06` — frontier останавливается только при `three_selectable` либо `catalog_exhausted`.
  Terminal result `0..2` допустим; CTA выбора появляется только для terminal `1..3`. Selectable
  city остаётся green; unknown показывает amber warning ring и explicit warning list, а red означает
  только fresh verified required mismatch.
- `REQ-CF-07` — Select server-derived warning basis принимает terminal ID, city ID, command ID и
  `city-unknown-risk@1` только при показанных warnings. Он атомарно публикует `City Selection
  Snapshot` и `City Branch Commit`; выборы A и B одного terminal являются sibling commits с
  `parentId = forkedFrom = preCityBranchCommitId`.

## 4. Scenarios

- `SCN-CF-01 Catalog` — threshold, capital override, top-ten fill, no truncation и honest incomplete coverage.
- `SCN-CF-02 Ranking unknown` — unknown снижает score/coverage, но сохраняет candidate в queue; required mismatch попадает только в screened exclusions.
- `SCN-CF-03 Fresh replacement` — full four-fact check находит verified required mismatch, оставляет persistent red marker и активирует next frozen candidate.
- `SCN-CF-04 Selectable unknown` — unknown facts дают green card с amber warning ring, selectable slot и фиксируемый warning basis.
- `SCN-CF-05 Revalidation` — equal four-fact projection сохраняет `knowledgeUpdatedAt`; known-to-unknown публикует explicit unknown и обновляет projection time.
- `SCN-CF-06 Failure boundary` — только bounded official attempts seal unknown; crash/cancel/storage/integrity failure не публикует revision и retry начинает с того же city.
- `SCN-CF-07 Frozen order` — fresh facts/coverage обновляются без изменения current-run rank/score.
- `SCN-CF-08 Exhaustion` — terminal с двумя selectable разрешает выбор; terminal с нулём его не открывает.
- `SCN-CF-09 Alternative branch` — A и B одного terminal создают sibling branches от одного `PreCityBranchCommit`.
- `SCN-CF-10 Offline replay` — reload воспроизводит cursor, markers, terminal и selections без official HTTP; accepted-yellow country остаётся formal yellow/effective green.

## 5. Traceability и boundary

`REQ-CF-01..07` и `SCN-CF-01..10` реализуют `GOAL-CF-01` по approved design и пяти linked plans.
Этот forward-only change package канонизирует product contract перед implementation; он не создаёт
production schema, source package, test, runtime flow или City Frontier implementation.
