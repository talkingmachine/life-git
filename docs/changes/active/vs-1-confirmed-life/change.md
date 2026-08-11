# Change: VS-1 «Одна подтверждённая жизнь и одна альтернатива»

| Поле | Значение |
| --- | --- |
| Статус | `approved` |
| Владелец решения | пользователь проекта |
| Последняя проверка | 2026-08-07 |
| Область ответственности | JIT baseline одного Albania/Tirana route-fit, визуальной ветви, Evidence Passport и Life Git |
| Supersedes | нет |
| Зависимости | [`CONSTITUTION`](../../../CONSTITUTION.md), [`Spec of Specs`](../../../architecture/spec-of-specs.md), [`ADR-001`](../../../decisions/ADR-001-modular-monolith.md), [`SRC-SPIKE-01`](../../archive/vs-1-source-feasibility-spike/change.md) |
| Approval | пользователь проекта / 2026-08-07 / VS-1 exact-text baseline / approved |

## 1. Почему и какой результат

`GOAL-VS1-01`: за 60–90 секунд доказать один real-source путь от подтверждённого профиля до
локального условного `Albania/Tirana route-fit`, визуальной ветви, проверяемого Evidence Passport,
неизменяемого commit и причинного housing fork/diff.

Пакет объединён в один файл, потому что отдельные proposal, requirements, design, tasks и validation
дублировали бы один walking skeleton. Это первый срез, а не сокращение полного MVP.

## 2. Scope и не-цели

В scope:

- generic `ProfileSnapshot`: один пользователь, `0..N` сопровождающих с relationship/route basis,
  страна происхождения и необязательный город; fixture содержит Россию, Москву и spouse;
- один честно обозначенный заранее выбранный технический кандидат `Albania/Tirana`;
- текущая проверка закрытого official source bundle, локальный verdict и один branchable city;
- простая визуальная ветвь: переносимый доход, housing assumption, известный остаток и unknown;
- минимальные Evidence Passport, commit, rewind, housing fork и причинный diff.

Не входят top-5, global registry/search/ranking, cold start, другие кандидаты, профессии, точные
налоги, safety/infrastructure verdict, доказательство московского уровня комфорта, полный день,
12-месячный фильм, вероятности и юридическое заключение. Они остаются в `VS-2..VS-5`.

Tirana не называется лучшим или полностью проверенным городом. В `VS-1` она `branchable-in-scope`,
только если национальный маршрут применим, пользователь задал housing assumption и ни одно
city-level условие не было молча объявлено пройденным. Это узкий `confirmed-city` criterion с
явным coverage, а не подтверждение безопасности, инфраструктуры или качества города.

## 3. Current official source bundle

| ID | Official navigation и current-run claim |
| --- | --- |
| `SRC-VS1-AL-LAW` | [QBZ ELI Law 79/2021](https://qbz.gov.al/eli/ligj/2021/06/24/79): latest applicable `cons-*`, Art. 41 и 68 — lawful stay, up-to-one-year permit, exact foreign contract types, resources, accommodation, insurance, criminal-record and staged family-route conditions. |
| `SRC-VS1-AL-DECISION` | [QBZ ELI Decision 858](https://qbz.gov.al/eli/vendim/2021/12/29/858): latest applicable `cons-*`, p. 13 item `gj` — digital-worker self-declaration of available resources for self/dependants, at least `408,000 ALL`. General p. 8 point 10 starts with “unless otherwise provided”, so its bank-deposit/monthly-income options are not silently used as digital-worker rules. |
| `SRC-SPIKE-01` | [CBR daily XML](https://www.cbr.ru/scripts/XML_daily.asp): dated `RUB per EUR`; capture/parser path уже выбран approved spike. |
| `SRC-VS1-AL-FX` | [Bank of Albania official exchange rate](https://www.bankofalbania.org/Markets/Official_exchange_rate/): dated reference `ALL per EUR`, не банковский курс сделки. |
| `SRC-VS1-TIRANA-TRANSIT` | [Tirana Municipality urban lines](https://tirana.al/pikat-e-interesit/linjat-urbane): live official page publishes a non-empty municipal urban-routes map. Claim не оценивает качество или развитость транспорта. |

Для обоих QBZ актов adapter обязан по exact ELI найти `base` node, взять родительский act root,
получить children через public Alfresco API, выбрать максимальную доказанно применимую к assessment
date редакцию `cons-YYYY-MM-DD`, затем PDF
с `nodeType=qbz:actVersion`. `base.modifiedAt`, pinned node ID и старый direct PDF не доказывают
freshness. Raw API responses и PDF сохраняются до parsing.
Resolved current `cons-*` PDF URL сохраняется в Passport как внешняя official link.

### Измеренный pre-baseline probe, не runtime evidence

| Source period / anchor | Retrieved UTC; HTTP/MIME | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| [Law `cons-2025-07-14`](https://qbz.gov.al/alfresco/webdav/Aktet/ligj/kuvendi-i-shqiperise/2021/06/24/79/cons-2025-07-14/ligj-2021-06-24-79-perditesuar.pdf), Art. 41 p. 26, Art. 68 pp. 38–39 | `12:35:06`; `200 application/pdf` | 469,951 | `020785583d49c7d99bcf05b9c77972662ad6a5b7bb3411eea6faf1f58864257c` |
| [Decision `cons-2026-04-16`](https://qbz.gov.al/alfresco/webdav/Aktet/vendim/keshilli-i-ministrave/2021/12/29/858/cons-2026-04-16/vendim-2021-12-29-858-%20i%20p%C3%ABrdit%C3%ABsuar%2010.pdf), points above | `12:16:40`; `200 application/pdf` | 23,264,873 | `137772488624fa856ca7f8323a19ac69aa244406ef4b87b42db658945e738016` |
| CBR effective `2026-08-06`, `93.1901 RUB/EUR` | `09:57:07/22`; `200 application/xml` | 9,513 | `8648e667d42f8ec5b6fe4fe72e2947b64bc98c72389eb3c6770d8f4028b0440e` |
| Bank of Albania updated `2026-08-05`, `93.13 ALL/EUR` | `10:57:25`; `200 text/html` | 69,397 | dynamic body; raw retained only by runtime |
| Tirana urban-lines page and GIS iframe | `12:04:30`; `200 text/html` | 72,092 | dynamic body; raw retained only by runtime |
Dynamic raw bodies, latency и cost не архивированы в baseline: их adapter-feasibility gate остаётся
открытым до `EVAL-VS1-01`. Probe подтверждает только доступность/anchors 2026-08-06;
`source-verified` появится только после live run production adapters с retained raw.

## 4. Requirements и acceptance

- `REQ-VS1-01` (`GOAL-VS1-01`, `SCN-VS1-01`): пользователь подтверждает immutable profile с
  income/savings, сопровождающими (`relationship`, `family|independent|unknown` route basis) и
  отдельно типизированными fact/unknown/scenario condition.
  Acceptance: fixture не хранит имена/паспортные данные; отсутствие диплома показывается как input,
  но не превращается в claim «диплом не нужен».
- `REQ-VS1-02` (`GOAL-VS1-01`; `SCN-VS1-01`, `SCN-VS1-02`, `SCN-VS1-03`): каждый новый run заново проходит
  `navigate -> capture -> semantic parse -> claim -> seal` для всего critical bundle.
  Acceptance: URL, retrieval time, HTTP/media type, source period, raw hash, applicability,
  semantic anchor, parser/rules versions запечатаны; fixture/replay не считаются fresh evidence.
- `REQ-VS1-03` (`GOAL-VS1-01`; `SCN-VS1-01`, `SCN-VS1-02`): Decision публикует только scoped marker/verdict
  по правилам раздела 6.
  Acceptance: coverage и unknown видны рядом; ambiguous numeric interaction не называется законом.
- `REQ-VS1-04` (`GOAL-VS1-01`; `SCN-VS1-01`, `SCN-VS1-04`): Branch строит visual-first бюджет по `FORMULA-VS1-FX-01` только из
  typed values и versioned formulas.
  Acceptance: экран содержит flow/bars, а не только summary; taxes и unmodelled living costs остаются
  видимым unknown, housing — пользовательским assumption.
- `REQ-VS1-05` (`GOAL-VS1-01`; `SCN-VS1-01`, `SCN-VS1-03`): Evidence Passport раскрывает lineage каждого
  видимого утверждения.
  Acceptance: collapsible block различает user fact, official fact, calculation, assumption,
  projection/illustration и unknown; official fact содержит scope, дату, anchor, integrity status и
  внешнюю ссылку. Заголовок и supporting copy являются детерминированной проекцией typed evidence
  classes и не становятся evidence class.
- `REQ-VS1-06` (`GOAL-VS1-01`; `SCN-VS1-03`, `SCN-VS1-04`): commit связывает branch с exact profile,
  evidence, rules и formulas; rewind не стирает историю, housing change создаёт fork.
  Acceptance: parent неизменен; diff показывает changed decision -> dependent calculations и
  отдельно reused/changed profile, evidence и rules.

## 5. Scenarios

- `SCN-VS1-01 Live guided path`: подтвердить profile и scenario conditions — к подаче есть
  `foreign_employment | foreign_service` contract и реально доступны не менее `408,000 ALL`; `210,000 RUB/month`
  продолжают поступать 12 месяцев; applicant принимает prerequisite lawful stay, spouse — staged Art. 41 route после
  permit sponsor; full-screen map
  честно пишет «проверяем 1 заранее выбранный кандидат», самолёт летит из России в Tirana,
  marker `gray -> green`; карта сворачивается, открываются карточка, budget flow и Passport; commit.
- `SCN-VS1-02 Outage/recovery`: critical retrieval остаётся gray; только timeout/429/5xx получает
  один retry; после общего budget marker становится yellow без verdict. Кнопка retry создаёт новый
  run/snapshot; восстановленный source может дать green, прошлый run не меняется. Отдельный
  deterministic variant `albanian_employer_only` даёт red с Article 68 reason.
- `SCN-VS1-03 Historical replay/integrity`: offline use case отключает network fetchers, проверяет
  HMAC/raw hashes и повторно запускает versioned parsers -> claims -> verdict -> formulas.
  Изменённый byte блокирует replay с integrity warning.
- `SCN-VS1-04 Housing fork`: `C0` хранит housing `70,000 ALL/month`; cursor rewind возвращается к
  его housing decision, не удаляя `C0`; выбор `90,000` создаёт `C1(parentId=C0,forkedFrom=C0)`.
  Diff объясняет `+20,000 housing -> -20,000 known residual`; evidence/profile переиспользуются.

## 6. Marker и route-fit contract

| State | Terminal meaning и действие |
| --- | --- |
| `gray` | Проверка идёт, spinner виден, verdict отсутствует. |
| `green` | «Проверенный миграционный маршрут предварительно совместим в заявленном scope»; marker на карте не раскрывается, evidence обсуждается на карточке после collapse. |
| `yellow` | Проверка завершена без достаточного однозначного evidence: missing/stale/conflict/semantic/integrity failure; popover показывает blocker и retry. |
| `red` | Только verified official rule + confirmed hard constraint доказывают несовместимость; popover показывает краткую формулу причины и official links. |

Green является только scoped assessment, не создаёт полный-MVP `ConfirmedCountry`. Fixture требует:
verified applicant route/contract type; подтверждённые пользователем
contract/income-continuation и отдельно фактически доступные к подаче `>=408,000 ALL` — будущий доход этот
fact не заменяет; applicable family route только для qualifying relationship/staged conditions;
current Tirana transit claim и housing input. Unknown/non-family basis даёт yellow; independent route в VS-1 не исследован.

Formula `FORMULA-VS1-FX-01`:

`income_ALL = income_RUB / CBR_RUB_PER_EUR * BOA_ALL_PER_EUR`

Decimal calculation не округляет промежуточные значения; final display — HALF_UP, EUR/ALL до 2
знаков. Probe даёт `209,864.57 ALL/month`; это scenario amount до неизвестного Albanian tax
treatment, не обещанный disposable income и не proof доступных ресурсов. `408,000 ALL` проверяются
как отдельный user fact/condition; текст item `gj` не задаёт multiplier, и продукт его не изобретает.

Out of verdict: proof of lawful entry/stay, фактические документы, authority interpretation/approval, application timing,
accommodation, insurance, criminal records, Albanian/Russian taxes, transaction FX, safety,
infrastructure и equivalence of comfort.

## 7. Domain invariants и architecture

- `INV-VS1-01`: только Research публикует verified Claim и sealed Evidence Snapshot.
- `INV-VS1-02`: final marker ссылается на exact Profile/Evidence Snapshot, coverage, rules и дату.
- `INV-VS1-03`: missing/stale/conflict/invalid/tamper никогда не дают green или red.
- `INV-VS1-04`: Experience не создаёт external fact, provenance, calculation, marker или verdict.
- `INV-VS1-05`: sealed rows и commits append-only; recovery/fork создают новые revisions.
- `INV-VS1-06`: historical evidence replay не является current-run; Life Git replay остаётся Branch
  responsibility, а полный replay координирует application use case.
- `INV-VS1-07`: одинаковые inputs и versions воспроизводят exact claims, verdict и budget.

Один deployment unit: `Next.js + TypeScript + SQLite`. Research, Decision, Branch и Experience не
вызывают друг друга напрямую; application use cases координируют immutable DTO. SQLite хранит raw
BLOB и append-only manifests/snapshots/commits. Evidence seal связывает raw bytes, canonical source
manifest и parser/rules versions; отдельный run manifest связывает exact Profile/Evidence Snapshot,
rules/formulas и results. Оба используют HMAC; trusted key поступает в composition root извне БД.
HMAC не называется public transparency log или защитой от владельца runtime.

Minimum boundary values (конкретные JSON schemas определит implementation plan):

- `ProfileSnapshot`: id, origin/current city, companions `{relationship,basis}`, income/savings, conditions, confirmedAt.
- `CapturedArtifact`: sourceId, resolved URL, retrievedAt, HTTP/media type, exact bytes/hash; `Claim`: value/unit, scope, source period, anchor, status.
- `EvidenceSnapshot`: artifact/claim IDs, coverage, parser/rules versions, canonical manifest hash/HMAC.
- `Assessment`: profile/evidence IDs, marker, declared scope, reasons, conditions, unknowns, rules version.
- `BranchCommit`: id, parentId/forkedFrom, profile/evidence/assessment IDs, decision, formula/output hashes.
Research публикует EvidenceSnapshot атомарно только после capture/parse/seal; Branch атомарно append-ит commit.

| Port | Contract |
| --- | --- |
| `PORT-VS1-SOURCE` | Enumerated source request -> `CapturedArtifact | Unavailable`; source-specific adapters не получают PII. |
| `PORT-VS1-SNAPSHOT` | Research-only seal; read-only verified load для остальных use cases проверяет trusted root/bindings. |
| `PORT-VS1-ASSESSMENT` | Confirmed profile + verified EvidenceSnapshot -> typed scoped Assessment; Decision владеет правилом. |
| `PORT-VS1-PRESENTATION` | Typed evidence classes -> deterministic headline и supporting copy; проекция не создаёт facts или verdict. |
| `PORT-VS1-BRANCH` | Create/replay/fork/diff; API не содержит overwrite/delete. |

## 8. NFR, recovery и no-bloat

- `NFR-VS1-01`: research budget 45 seconds total; один retry только для timeout/429/5xx; manual
  retry — новый run. Other 4xx, wrong MIME/content, parser/conflict/integrity error сразу дают yellow.
- `NFR-VS1-02`: raw artifact limit 30 MiB; oversized critical artifact даёт yellow, не fallback.
- `NFR-VS1-03`: meaningful visual output появляется не позднее 90 seconds; marker понятен без цвета
  и keyboard accessible.
- `NFR-VS1-04`: только local SQLite, demo reset и synthetic profile; PII/free text не отправляются
  source adapters или operational logs.
- `NFR-VS1-05`: никаких browser/search/external-provider fallback, второго pipeline, generic crawler/SDK,
  knowledge-base platform, rules engine, queue, circuit breaker или multi-provider abstraction.
- `NFR-VS1-06`: QBZ version date `<= assessmentAt`; CBR/BoA periods не старше 3 дней и отличаются
  не более чем на день; live city claim uses retrievedAt.
  Missing/future/ambiguous period даёт yellow.

## 9. Tests, evals и traceability

Не более четырёх логических test groups: `TEST-VS1-DOMAIN`, `TEST-VS1-SOURCES`,
`TEST-VS1-INTEGRATION`, `TEST-VS1-BRANCH`; runner может объединить их. Coverage percentage и
exhaustive matrices не являются целью.

- `EVAL-VS1-01 Live provenance`: clean current run captures latest official bundle, seals it and
  completes `gray -> green` with exact source periods/anchors.
- `EVAL-VS1-02 Fail closed`: one injected transient outage proves bounded retry and `gray -> yellow`;
  semantic HTTP 200/hard mismatch prove yellow/red; deterministic presentation never mutates
  evidence/verdict, а source/event payloads не содержат PII/free text.
- `EVAL-VS1-03 Offline replay`: two replays match exact result; tampered byte is rejected; historical
  label cannot satisfy a new run.
- `EVAL-VS1-04 Causal fork`: housing-only fork preserves parent/evidence and changes only dependent
  amount plus its visual explanation.
- `EVAL-VS1-05 Visual truth`: one manual 60–90-second walkthrough lets a reviewer distinguish all
  Passport classes, marker scope, external official links and unknown without oral correction.

| REQ | SCN | INV/ADR | PORT | TEST/EVAL |
| --- | --- | --- | --- | --- |
| `REQ-VS1-01` | `SCN-VS1-01` | `INV-VS1-02`; `INV-VS1-04`; `ADR-001` | — | `TEST-VS1-DOMAIN`; `EVAL-VS1-05` |
| `REQ-VS1-02` | `SCN-VS1-01`; `SCN-VS1-02`; `SCN-VS1-03` | `INV-VS1-01`; `INV-VS1-02`; `INV-VS1-03`; `INV-VS1-05`; `INV-VS1-06`; `INV-VS1-07`; `ADR-001` | `PORT-VS1-SOURCE`; `PORT-VS1-SNAPSHOT` | `TEST-VS1-SOURCES`; `TEST-VS1-INTEGRATION`; `EVAL-VS1-01`; `EVAL-VS1-02`; `EVAL-VS1-03` |
| `REQ-VS1-03` | `SCN-VS1-01`; `SCN-VS1-02` | `INV-VS1-02`; `INV-VS1-03`; `INV-VS1-04`; `ADR-001` | `PORT-VS1-SNAPSHOT`; `PORT-VS1-ASSESSMENT` | `TEST-VS1-DOMAIN`; `TEST-VS1-INTEGRATION`; `EVAL-VS1-01`; `EVAL-VS1-02`; `EVAL-VS1-05` |
| `REQ-VS1-04` | `SCN-VS1-01`; `SCN-VS1-04` | `INV-VS1-04`; `INV-VS1-07`; `ADR-001` | `PORT-VS1-BRANCH` | `TEST-VS1-DOMAIN`; `TEST-VS1-BRANCH`; `EVAL-VS1-04`; `EVAL-VS1-05` |
| `REQ-VS1-05` | `SCN-VS1-01`; `SCN-VS1-03` | `INV-VS1-01`; `INV-VS1-02`; `INV-VS1-03`; `INV-VS1-04`; `INV-VS1-06`; `ADR-001` | `PORT-VS1-SNAPSHOT`; `PORT-VS1-PRESENTATION` | `TEST-VS1-DOMAIN`; `TEST-VS1-INTEGRATION`; `EVAL-VS1-02`; `EVAL-VS1-03`; `EVAL-VS1-05` |
| `REQ-VS1-06` | `SCN-VS1-03`; `SCN-VS1-04` | `INV-VS1-05`; `INV-VS1-06`; `INV-VS1-07`; `ADR-001` | `PORT-VS1-SNAPSHOT`; `PORT-VS1-BRANCH` | `TEST-VS1-BRANCH`; `EVAL-VS1-03`; `EVAL-VS1-04` |

NFR trace: `NFR-VS1-01`; `NFR-VS1-02`; `NFR-VS1-06` -> `TEST-VS1-INTEGRATION`, `EVAL-VS1-01`,
`EVAL-VS1-02`; `NFR-VS1-03` -> `EVAL-VS1-05`; `NFR-VS1-04` -> `TEST-VS1-SOURCES`, `TEST-VS1-INTEGRATION`, `EVAL-VS1-02`;
`NFR-VS1-05` -> independent structural review.
## 10. Ordered tasks и approval gate

1. `[REQ-VS1-01; REQ-VS1-03]` Implement approved boundary values, formula and domain tests.
2. `[REQ-VS1-02; REQ-VS1-05]` Implement minimum transports/parsers for five enumerated entries;
   reuse one QBZ transport, keep claim parsers source-specific; add capture/seal.
3. `[REQ-VS1-03; REQ-VS1-04]` Implement assessment, deterministic budget and read models.
4. `[REQ-VS1-06]` Implement append-only commit/replay/fork/causal diff.
5. `[REQ-VS1-01; REQ-VS1-04; REQ-VS1-05]` Implement guided map, cards, Passport and deterministic presentation projection.
6. `[REQ-VS1-02; REQ-VS1-03; REQ-VS1-04; REQ-VS1-05; REQ-VS1-06]` Run four suites, one live eval and one timed visual walkthrough; save evidence.

Validation and exact-text approval:

- [x] self-review: no placeholders, contradictions, orphan IDs or scope creep;
- [x] independent review: current-source semantics, marker truthfulness, architecture and no-bloat;
- [x] links, line count under 250 and source measurements checked;
- [x] пользователь подтвердил точную редакцию этого файла 2026-08-07.

Baseline допущен к implementation planning; `source-verified` и `demo-verified` требуют
отдельного runtime evidence и не следуют из этого approval.

Текущий runtime evidence: [`implementation-evidence.md`](implementation-evidence.md).
