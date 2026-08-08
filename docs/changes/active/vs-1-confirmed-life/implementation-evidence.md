# VS-1 implementation evidence

| Поле | Значение |
| --- | --- |
| Проверено | 2026-08-08 |
| Runtime | production composition, local SQLite, synthetic solo profile |
| Earned readiness | `source-verified`, `replay-verified`, `fail-closed-verified`, `recovery-verified` |
| Pending | `demo-verified`: visual rubric ещё не выполнен |

Это первый опубликованный source-verified baseline, поэтому все пять parser IDs начинаются с `@1`.
Следующее изменение parser ID запрещено без явного dispatcher для предыдущей опубликованной версии.

## Live current-source gate

Redacted artifact: [`clean`](../../../../artifacts/evals/vs1/run-40b682e2-32c4-44f8-a25b-357a9baf1579.json).

- terminal marker `green`; 5/5 sources and 9/9 expected claims verified;
- 14/14 captured artifacts sealed locally; 14 network requests; 0 LLM calls;
- latency `9,118 ms`, below the 90-second meaningful-output gate;
- periods: Law 79 `cons-2025-07-14`, Decision 858 `cons-2026-04-16`, CBR `2026-08-08`,
  Bank of Albania `2026-08-07`, Tirana GIS check `2026-08-08`;
- two offline replays returned the same digest; one changed byte in a copied database was rejected;
- redacted sealed view records manifest hash, parser/rules versions, typed claims, coverage and each
  artifact's ID, retrieval time, HTTP/MIME, length and raw SHA-256, but never its body;
- raw bytes remain only in ignored local SQLite; the trusted HMAC key exists only in process memory;
  both are absent from the artifact.

## Fail-closed and recovery gate

Redacted artifact: [`outage`](../../../../artifacts/evals/vs1/run-c699ce63-0a8e-4c95-85c5-8eb70623d548.json).

- two injected retryable CBR failures produced exactly two CBR attempts and terminal `yellow` with
  `server_error` lineage in `10,541 ms`;
- healthy retry created a different run and Evidence Snapshot, recaptured all five sources and reached
  `green` in `9,136 ms`;
- recovered raw bundle was sealed and passed the same offline replay and one-byte tamper gates;
- total observed requests across failed and recovered runs: 29; source fees were not metered.

## Reproduction

```bash
pnpm eval:live -- --mode clean
pnpm eval:live -- --mode outage
```

Both commands reset only `data/evals/current-run/vs1.sqlite` and its exact `-wal`/`-shm` siblings.
They never delete a directory or use a glob. Each report is created once under `artifacts/evals/vs1/`;
raw SQLite, HMAC keys, profiles and source bodies are not written to the report.

The manual rubric remains [`needs-keyboard-confirmation`](../../../../evals/visual-truth.md). Until it
passes, this package must not claim `demo-verified` even though source, replay, fail-closed and
recovery gates are earned.
