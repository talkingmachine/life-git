# Change: VS-3 «Place frontier»

| Поле | Значение |
| --- | --- |
| Статус | `implemented` — verified 2026-08-12 |
| Владелец решения | пользователь проекта |
| Последняя проверка | 2026-08-12 |
| Область ответственности | первый country-frontier slice: formal marker semantics, frozen place ranking, red replacement, Country Knowledge revisions и planet history |
| Supersedes | green-after-city, confirmed-city shortlist, optimistic upper-bound stability и отдельный research-budget shortlist stop |
| Зависимости | [`Product Charter`](../../../product/charter.md), [`Spec of Specs`](../../../architecture/spec-of-specs.md), [`VS-2`](../vs-2-honest-cold-start/change.md), [`approved design`](../../../superpowers/specs/2026-08-12-vs-3-place-frontier-design.md) |
| Approval | product semantics, review-driven integrity/persistence amendments, exact implementation tasks and implementation evidence approved by user 2026-08-12 |
| Implementation evidence | [`verified`](implementation-evidence.md) |

## 1. Goal и наблюдаемый результат

`GOAL-PF-01`: пользователь видит на планете проверку стран в frozen порядке персональной
релевантности. В активной session система не удаляет появившийся marker, terminal snapshot
сохраняет все завершённые markers, красная страна заменяется следующей, а поиск
останавливается на пяти разных green/yellow странах либо на честном exhaustion установленного
coverage.

Первый implementation slice работает только поверх реально установленных country packages. Если
coverage меньше пяти, результат называется preliminary и не маскируется под глобальный top-5.

## 2. Scope и не-цели первого slice

В scope:

- подтверждённый `PreferenceProfile` с criteria `required | weighted`;
- deterministic place ranking по current Country Knowledge projections;
- formal country verdict `green | yellow | red`, не зависящий от city fit;
- persistent gray/green/yellow/red history и red replacement;
- append-only Country Knowledge revisions плюс отдельные marker metadata `lastCheckedAt` и
  `knowledgeUpdatedAt`;
- immutable Ranking/Shortlist snapshots и zero-network reload;
- planet stream и cards для installed coverage;
- корректировка VS-2: один blocked route больше не создаёт false country red, а viable route не
  ждёт подтверждённого города.

Не входят:

- новые country evidence packages в одном изменении;
- city ranking, safety/rent/transit/broadband research;
- работа, жильё, налоги, бюджет или life simulation;
- universal route ontology, crawler, provider framework, queue, worker, event store или graph DB;
- LLM/API/provider SDK, credential, prompt или model-backed ranking;
- stable-world-optimum proof, Pareto engine и exhaustive country/layout matrix.

## 3. Requirements

- `REQ-PF-01` (`SCN-PF-01`, `SCN-PF-03`): rank unit — одна страна; количество ResidenceRoute не
  влияет на score. Ranking Snapshot фиксирует profile/preferences, knowledge revision IDs, factors,
  rules version и полный порядок на весь run.
- `REQ-PF-02` (`SCN-PF-01`, `SCN-PF-02`): green требует хотя бы одного verified viable long-term
  route; red — current completeness attestation и verified impossible для каждого применимого route;
  no-green incomplete/unknown — yellow.
- `REQ-PF-03` (`SCN-PF-01`, `SCN-PF-03`): frontier активирует до пяти разных стран, сохраняет red и
  берёт следующую по ranking до пяти non-red либо exhaustion. Любой yellow делает итог preliminary.
- `REQ-PF-04` (`SCN-PF-01`, `SCN-PF-02`): planet показывает только domain-driven progress; red и
  yellow доступны с клавиатуры и раскрывают reason/source; все terminal markers переживают
  collapse/reload. Incomplete gray history остаётся session-local.
- `REQ-PF-05` (`SCN-PF-02`, `SCN-PF-04`): verified claims и evidence-backed status observations
  создают append-only Country Knowledge Revision. Source failure без нового evidence меняет только
  `lastCheckedAt`, но не `knowledgeUpdatedAt`.
- `REQ-PF-06` (`SCN-PF-04`): reload/replay использует exact Profile, Ranking, Knowledge, Evidence,
  verdict и Shortlist snapshots без сети и не меняет порядок или marker history.

### NFR

- `NFR-PF-01 Official-only`: внешний fact и formal verdict требуют current official capture,
  validator и sealed lineage; installed navigation не является evidence.
- `NFR-PF-02 Provider-free within Place Frontier`: сам VS-3 не вызывает LLM/API и не получает
  provider SDK, credential или billing surface. Утверждённые Entry и VS-4 вызовы Codex CLI находятся
  вне этого среза и регулируются `2026-08-20-codex-cli-runtime-design.md`.
- `NFR-PF-03 Truthful ranking`: stale/future/incomparable fact становится unknown; unknown получает
  явную worst-case boundary `-1`, а coverage остаётся видимым.
- `NFR-PF-04 Minimum sufficient complexity`: первый slice переиспользует VS-2 capture, Evidence,
  dossier, globe и stream boundaries и не создаёт параллельный pipeline.

## 4. Scenarios

- `SCN-PF-01 Red replacement`: synthetic integration frontier содержит не менее шести стран; одна
  получает complete all-impossible red, остаётся интерактивной, а следующая занимает slot. Итог —
  пять unique non-red и exact composition.
- `SCN-PF-02 Honest yellow`: viable route не найден, а catalog/evidence incomplete. Страна yellow,
  занимает slot, показывает exact unknown/manual-check guidance и не называется confirmed green.
- `SCN-PF-03 Installed exhaustion`: production installed coverage заканчивается раньше пяти.
  Shortlist меньше пяти, имеет label preliminary и не дополняется unsupported countries.
- `SCN-PF-04 Knowledge/replay`: JIT check публикует verified subset/status revision, но не меняет
  текущий ranking. Новый run видит revision; reload старого run воспроизводит прежние markers без HTTP.
- `SCN-PF-05 Run incomplete`: application/storage/integrity failure до commit оставляет partial
  visual history без Shortlist Snapshot. Client protocol/decoder failure не принимает terminal в
  UI, но не откатывает уже committed server snapshot; reload может его восстановить.

## 5. Formal marker contract

| Marker | Terminal meaning |
| --- | --- |
| `green` | хотя бы один verified viable long-term ResidenceRoute |
| `yellow` | green отсутствует, но unresolved route/evidence или incomplete catalog не позволяют доказать impossibility |
| `red` | current complete catalog, typed profile applicability/exclusions и каждый applicable route verified impossible имеют sealed Evidence lineage |

Green имеет precedence над unknown других routes. Один impossible route не даёт red. Required place
mismatch фильтрует ranking universe, но не меняет legal marker. City research не участвует в цвете.
Completeness proof привязан к exact Profile/Evidence snapshots; свободный declared scope или список
route ID не разрешает red. `contingentAction` допускает green только как право претендовать при отсутствии current blocker и
всегда показывает, что admission/job offer ещё не получен.

## 6. Place ranking contract

До sealing каждый evaluator выбирает latest compatible period `<= assessmentAt`; stale, future,
ambiguous или incomparable value становится unknown. Required verified mismatch исключает страну.
Остальные страны получают:

```text
relevance = sum(importance × known_match_or_minus_one) / sum(importance)
coverage  = sum(importance for comparable facts) / sum(importance)
```

Порядок: relevance descending, coverage descending, ISO country code. Ranking Snapshot после sealing
не меняется; JIT Knowledge update применяется только в следующем run.

## 7. Knowledge и snapshots

`CountryKnowledgeRevision` — append-only полный current snapshot: compact official-fact references
и evidence-backed masks, но не повторные formal values/raw bytes из Evidence. Derived place match
принадлежит Decision/RankingSnapshot, а не Knowledge; текущий SI package не имеет place-factor facts
и честно даёт missing factors.
Successor сохраняет unaffected current refs, поэтому latest revision достаточно для projection;
предыдущая цепочка остаётся проверяемой. Core envelope/table принимает ISO country code, а installed
SI builder/decoder остаётся package-specific. Observation status закрыт:
`verified | superseded | expired | unresolved`. Public marker metadata:

- `lastCheckedAt` — ISO date последней завершённой проверки из sealed Evidence assessment date;
- `knowledgeUpdatedAt` — последняя evidence-backed value/revalidation/status revision;
- coverage и unknowns по фактам.

`RankingSnapshot` связывает exact profile/preferences, Knowledge revision IDs, factor projections,
rules version и ordered countries. `ShortlistSnapshot` связывает ranking, все completed markers,
formal verdict/Evidence/Knowledge references и frontier rules version. Countries, composition и
stop condition детерминированно выводятся из markers + frozen ranking и не хранятся второй раз. Оба append-only;
`ShortlistSnapshot` сохраняет полный immutable `FormalResidenceVerdict` каждого marker — route
outcomes, actions, completeness proof и Evidence lineage; цвет/summary не являются отдельным
источником истины. `run_incomplete` не является Shortlist Snapshot.

## 8. Architecture

```text
Profile + PreferenceProfile
  -> current Country Knowledge projections
  -> Decision PlaceRanker
  -> immutable RankingSnapshot
  -> Application CountryFrontier
  -> existing country-specific Research/Evidence check
  -> formal verdict + optional CountryKnowledgeRevision
  -> red replacement from the same ranking
  -> immutable ShortlistSnapshot
  -> Experience planet/cards
```

- Decision владеет ranker и formal verdict; он не читает HTML или storage.
- Research владеет official claims, route catalog/completeness и Knowledge publication.
- Application владеет activation/replacement/stop/snapshot sequencing, но не вычисляет score/verdict.
- Infrastructure хранит append-only revisions/snapshots и адаптирует текущий Slovenia cold start.
- Experience только проецирует events/snapshots и не выносит verdict.

## 9. Bounded recovery

- HTTP timeout/429/5xx получает только существующий bounded retry; exhaustion становится formal
  unknown/yellow, не отдельным shortlist budget stop.
- Unsupported/uninstalled country не занимает automated slot и остаётся отдельным custom cold start.
- Abort до terminal snapshot не создаёт Shortlist Snapshot. Уже опубликованные Evidence/Knowledge
  revisions не откатываются.
- Unexpected application/storage/integrity error до commit завершает `run_incomplete`; retry
  создаёт новый run. Client transport/decoder error не создаёт UI verdict, но уже committed server
  snapshot остаётся immutable и доступен reload.

## 10. Ordered tasks

1. `TASK-PF-01` `[REQ-PF-02; REQ-PF-04]`: исправить formal marker projection и VS-2 comparator/UI.
2. `TASK-PF-02` `[REQ-PF-01]`: добавить PreferenceProfile и deterministic PlaceRanker.
3. `TASK-PF-03` `[REQ-PF-05; REQ-PF-06]`: добавить append-only Country Knowledge publication/store.
4. `TASK-PF-04` `[REQ-PF-01; REQ-PF-03; REQ-PF-06]`: добавить immutable ranking/shortlist storage и
   CountryFrontier orchestration.
5. `TASK-PF-05` `[REQ-PF-03; REQ-PF-04; REQ-PF-06]`: добавить общий bounded NDJSON reader, frontier route,
   strict protocol decoder и pure multi-marker projection.
6. `TASK-PF-06` `[REQ-PF-03; REQ-PF-04; REQ-PF-06]`: показать persistent multi-marker planet и
   terminal country cards поверх готовой projection.
7. `TASK-PF-07` `[REQ-PF-01..06; NFR-PF-01..04]`: выполнить focused/full/static/build/replay,
   provider-surface audit и один browser walkthrough на installed coverage.

Exact code steps и review gates определены в
[`VS-3 Place Frontier Implementation Plan`](../../../superpowers/plans/2026-08-12-vs-3-place-frontier.md).

## 11. Traceability

| Scenario | Requirements | Design decision | Task | Verification |
| --- | --- | --- | --- | --- |
| `SCN-PF-01` | `REQ-PF-01..04` | country-first ranking; separate formal color | `TASK-PF-01`; `TASK-PF-02`; `TASK-PF-04..06` | pure verdict/ranker/frontier + stream/UI |
| `SCN-PF-02` | `REQ-PF-02`; `REQ-PF-04`; `REQ-PF-05` | green precedence; incomplete -> yellow | `TASK-PF-01`; `TASK-PF-03`; `TASK-PF-06` | verdict table + yellow detail |
| `SCN-PF-03` | `REQ-PF-01`; `REQ-PF-03` | installed-only coverage | `TASK-PF-04..06` | one-country production fixture + preliminary copy |
| `SCN-PF-04` | `REQ-PF-05`; `REQ-PF-06` | append-only Knowledge; frozen ranking | `TASK-PF-03`; `TASK-PF-04`; `TASK-PF-07` | DB integrity + zero-network replay |
| `SCN-PF-05` | `REQ-PF-03`; `REQ-PF-06` | pre-commit failure has no snapshot; client rejects untrusted terminal | `TASK-PF-04`; `TASK-PF-05`; `TASK-PF-07` | injected storage failure + decoder rejection/reload |

## 12. Approval gate

- [x] Product requirements and formal marker/frontier semantics approved by the user 2026-08-12.
- [x] Review-driven integrity/persistence design amendments approved by the user 2026-08-12.
- [x] Canonical Charter, Spec of Specs, glossary, demo story and VS-2 semantics amended.
- [x] Exact implementation tasks approved by the user 2026-08-12.
- [x] Implementation verified; evidence recorded without retroactively editing snapshots and approved by the user 2026-08-12.

Production changes must not start before the user approves the exact implementation plan.
