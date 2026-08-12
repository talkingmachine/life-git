# Change: VS-3R Yellow Resolution

| Поле | Значение |
| --- | --- |
| Статус | `approved` — implementation pending |
| Владелец решения | пользователь проекта |
| Последняя проверка | 2026-08-12 |
| Область ответственности | обязательное пользовательское разрешение formal yellow после automatic Country Frontier и до будущего City Frontier |
| Supersedes | только forward flow, в котором preliminary automatic yellow мог прямо перейти к city research |
| Зависимости | [`VS-3 Place frontier`](../vs-3-place-frontier/change.md), [`approved design`](../../../superpowers/specs/2026-08-12-vs-3r-yellow-resolution-design.md), [`implementation plan`](../../../superpowers/plans/2026-08-12-vs-3r-yellow-resolution.md) |
| Approval | exact written baseline и implementation plan approved by user 2026-08-12 |

## 1. Goal и canonical result

`GOAL-YR-01`: после завершения автоматического country frontier пользователь принимает или
отклоняет каждую formal yellow-страну, наблюдает replacement-проверки в frozen rank order и
получает append-only `Resolved Country Shortlist Snapshot` из до пяти effective green стран.

Automatic Shortlist Snapshot is preliminary.
Unresolved formal yellow blocks a resolved shortlist and City Frontier.
accepted_at_own_risk produces ordinary effective green without changing formal yellow.
rejected produces ordinary effective red without claiming formal impossibility.
Resolved Country Shortlist Snapshot is the only future City Frontier input.

`VS-3R` не изменяет formal Evidence truth, `FormalResidenceVerdict`, Country Knowledge, Ranking
Snapshot или historical VS-3 snapshots. Он не реализует City Registry, City Knowledge или city
ranking.

## 2. Formal и effective status

| Formal status | Yellow decision | Effective status | Пользовательское поведение |
| --- | --- | --- | --- |
| `green` | отсутствует | `green` | обычные green marker/card; страна занимает слот |
| `red` | отсутствует | `red` | обычный red marker; страна исключена |
| `yellow` | отсутствует | `yellow` | обязательный resolution prompt; finalization запрещена |
| `yellow` | `accepted_at_own_risk` | `green` | обычные green marker/card; страна занимает слот |
| `yellow` | `rejected` | `red` | обычный red marker; страна исключена и заменяется |

`Effective status` является только детерминированной projection formal status и Yellow decision.
Accepted/rejected formal yellow сохраняет свой internal formal yellow и provenance для integrity,
replay и аудита.

## 3. Requirements

- `REQ-YR-01` — отдельная Yellow Resolution запускается только после verified terminal Automatic
  Shortlist Snapshot и exact full Ranking Snapshot; automatic snapshot сам не открывает City Frontier.
- `REQ-YR-02` — текущая unresolved formal yellow требует ровно одно append-only решение:
  `accepted_at_own_risk` или `rejected`; визуальный effective status меняется только после commit.
- `REQ-YR-03` — rejected yellow освобождает слот; replacement последовательно берётся только из
  полного frozen `RankingSnapshot.ordered`, без rerank и возврата `excludedPlaces`.
- `REQ-YR-04` — terminal Resolved Country Shortlist Snapshot создаётся ровно один раз, когда нет
  unresolved yellow и есть пять effective green либо ranking исчерпан; честный результат 0–4 допустим.
- `REQ-YR-05` — та же планета сохраняет all markers и replacement history: accepted становится
  ordinary green, rejected остаётся ordinary red, а reload восстанавливает verified state без сети.
- `REQ-YR-06` — resolution revisions и terminal snapshot append-only, воспроизводимы и fail-closed:
  tamper даёт `integrity_mismatch`, stale command не создаёт successor, identical retry идемпотентен.

### NFR

- `NFR-YR-01 Official truth` — formal status и replacement verdict используют существующий official
  Evidence pipeline; пользовательское решение не становится Evidence и не хранит secret-bearing data.
- `NFR-YR-02 Append-only` — automatic snapshots, decisions, revisions, Evidence и Knowledge не
  обновляются и не удаляются.
- `NFR-YR-03 Provider-free` — runtime не получает external LLM/API/provider SDK, credential или
  billing surface.
- `NFR-YR-04 Bounded recovery` — replacement переиспользует bounded timeout/retry/cancellation и
  finite NDJSON; crawler, worker, polling и background workflow отсутствуют.
  Only explicit replacement continuation may invoke CountryVerifierPort or official network verification. Start, yellow decision, presentation, and reload must perform zero official HTTP/network calls.
- `NFR-YR-05 Minimum sufficient complexity` — только узкая resolution snapshot chain, без event
  store, generic workflow engine, queue или универсального decision framework.
- `NFR-YR-06 Accessibility` — prompt, progress, recoverable failure и terminal result доступны с
  клавиатуры и имеют корректные live-region/alert semantics.

## 4. Scenarios

- `SCN-YR-01 All formal green`: отсутствие yellow сразу создаёт terminal resolved snapshot без prompt.
- `SCN-YR-02 Accepted yellow`: пользователь принимает риск; после commit marker/card становятся
  ordinary effective green.
- `SCN-YR-03 Rejected yellow with red replacements`: rejected marker остаётся ordinary red; formal
  red replacements остаются в history до следующего formal green.
- `SCN-YR-04 Replacement yellow`: replacement yellow занимает provisional slot и попадает в global
  frozen-rank resolution queue.
- `SCN-YR-05 Exhaustion`: после решений создаётся честный resolved результат из 0–4 effective green,
  включая допустимый empty terminal без City Frontier CTA.
- `SCN-YR-06 Interrupted transport`: committed decision сохраняется; replacement interruption не
  фабрикует terminal и позволяет явно продолжить с current revision.
- `SCN-YR-07 Concurrency and retry`: один expected head имеет одного successor; stale command
  конфликтует, identical command повторяет прежнюю revision, conflicting payload даёт integrity conflict.

## 5. Ordered tasks

1. `TASK-YR-01` `[REQ-YR-01..06; NFR-YR-01..06; SCN-YR-01..07]`: канонизировать этот change-пакет
   и forward product contract без переписывания historical VS-3 snapshots.
2. `TASK-YR-02` `[REQ-YR-02..04; REQ-YR-06; SCN-YR-01..05; SCN-YR-07]`: реализовать pure Decision
   policy для formal/effective status, uncertainty, queue, cursor и terminal condition.
3. `TASK-YR-03` `[REQ-YR-04; REQ-YR-06; NFR-YR-02]`: добавить append-only, integrity-protected
   resolution revision storage.
4. `TASK-YR-04` `[REQ-YR-01..04; REQ-YR-06]`: добавить Application use cases start, decision и
   bounded replacement continuation поверх existing CountryVerifierPort.
5. `TASK-YR-05` `[REQ-YR-02; REQ-YR-03; REQ-YR-05; REQ-YR-06]`: добавить strict HTTP/NDJSON
   delivery contract и verified presentation projection.
6. `TASK-YR-06` `[REQ-YR-02..05; NFR-YR-06]`: показать resolution controls и persistent planet
   history, сохраняя один globe instance.
7. `TASK-YR-07` `[REQ-YR-01..06; NFR-YR-01..06; SCN-YR-01..07]`: выполнить focused/full/static/build,
   replay/integrity/provider audits и разрешённый отдельным gate browser walkthrough.

## 6. Traceability and boundary

Все `REQ-YR-*` реализуют `GOAL-YR-01`; scenarios и NFR проверяются задачами `TASK-YR-01..07` в
соответствии с [approved design](../../../superpowers/specs/2026-08-12-vs-3r-yellow-resolution-design.md)
и [implementation plan](../../../superpowers/plans/2026-08-12-vs-3r-yellow-resolution.md). Этот
forward-only amendment не меняет historical `VS-3` change, design или implementation evidence.
