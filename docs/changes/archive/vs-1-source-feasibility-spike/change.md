# Change: VS-1 source feasibility spike

| Поле | Значение |
| --- | --- |
| Статус | `archived` |
| Владелец решения | пользователь проекта |
| Последняя проверка | 2026-08-06 |
| Область ответственности | измерения и один production-like official-source path перед JIT-спецификацией `VS-1` |
| Supersedes | нет |
| Approval | пользователь проекта / 2026-08-06 / exact text и CBR source path / approved |

## Почему

`VS-1` обязан показать current-run verification на реальном официальном источнике. До технического
дизайна требовалось независимо проверить:

1. live-origin retrieval и сохранение использованного содержимого;
2. applicability, freshness, URL и точное время проверки;
3. raw content hash, границы sealing и offline replay;
4. фактическую latency и наблюдаемую стоимость;
5. terminal unavailable → yellow и границу проверки полного gray → yellow transition.

Spike проверяет механизм на одном узком source path. Он не выбирает лучшую страну и не присваивает
готовность `source-verified` всему `VS-1`.

## Scope и не-цели

В scope вошли официальный daily XML, два последовательных raw retrieval, один сохранённый body,
лог metadata и hash обоих запусков, checksum prototype, два offline replay и один injected
missing-artifact failure. Несколько
официальных HTML/PDF использованы только как bounded probes разных failure modes.

Не входят в scope:

- итоговый immigration verdict, город, жильё, налоги или безопасность;
- универсальный crawler, browser adapter или adapter SDK;
- production-код и выбор полного стека;
- автоматическое восстановление от любого сайта;
- доказательство доступности всех будущих country sources.

## Выбранный source path

`SRC-SPIKE-01` — [daily XML Банка России](https://www.cbr.ru/scripts/XML_daily.asp). Он выбран первым
source path `VS-1`, потому что канонический профиль хранит доход в RUB, а европейская ветвь требует
датированного и воспроизводимого reference conversion в EUR.

Источник 2026-08-06 опубликовал `1 EUR = 93,1901 RUB`. Для подтверждённого пользовательского input
`210 000 RUB/month` детерминированный reference result равен `210 000 / 93,1901 = 2 253,46 EUR`.
Это расчёт по официальному reference rate, а не обещание фактического банковского курса и не
immigration verdict.

Сохранённые evidence spike:

| Артефакт | Роль |
| --- | --- |
| [`cbr-eur-2026-08-06.xml`](evidence/cbr-eur-2026-08-06.xml) | точный raw response body выбранного run |
| [`retrieval-log.json`](evidence/retrieval-log.json) | metadata, latency и body hash обоих live retrieval |
| [`manifest.json`](evidence/manifest.json) | URL, response Date header, media type, parser version, claim и derivation lineage |
| [`checksums.sha256`](evidence/checksums.sha256) | локальный checksum index evidence package; не immutable seal |
| [`replay.py`](evidence/replay.py) | одноразовый offline harness; не production implementation |

## Live retrieval и raw capture

Sandbox DNS был закрыт, поэтому backend-like GET повторён в разрешённом network runtime. Это
ограничение среды разработки, а не source verdict.

| Поле | Run 1 | Run 2 |
| --- | ---: | ---: |
| HTTP status | 200 | 200 |
| HTTP `Date` response header | `2026-08-06T09:57:07Z` | `2026-08-06T09:57:22Z` |
| Connect latency | 124 ms | 44 ms |
| Total latency | 269 ms | 151 ms |
| Body bytes | 9 513 | 9 513 |
| Body SHA-256 | `8648e667d42f8ec5b6fe4fe72e2947b64bc98c72389eb3c6770d8f4028b0440e` | тот же |

Оба ответа имели `application/xml; charset=windows-1251` и `cache-control: no-cache`; body hash
совпал. Metadata обоих запусков сохранены в checksum-bound retrieval log; один body сохранён как
канонический, а дубликат с теми же длиной и hash не хранится. Payload содержал effective date
`06.08.2026`, то есть source period совпал с датой run.

Источник доступен без API key, аккаунта и наблюдаемого source fee. Зафиксированы два GET; стоимость
вычислительной среды и egress не измеряется этим spike и остаётся `unmetered`, а не выдуманным нулём.

## Checksum prototype и настоящий replay

Выбранный raw artifact сохранён до parsing. Локальный checksum index связывает точные bytes body,
manifest, retrieval log и использованного replay/parser harness:

```text
raw artifact  8648e667d42f8ec5b6fe4fe72e2947b64bc98c72389eb3c6770d8f4028b0440e
manifest      a7fac34bc6522ea21b7b62385bcd6e1d701ec2b286d7fd45096ec25dd472b307
```

Два offline replay без сети проверили package checksums, включая точные bytes harness, прочитали
сохранённый artifact, повторно извлекли effective date и EUR rate и получили идентичный результат:

```json
{"effectiveDate":"2026-08-06","incomeEur":"2253.46","rateRubPerEur":"93.1901","status":"verified-replay"}
```

Replay не считается current-run verification нового run: он воспроизводит только исторический
snapshot. Новый пользовательский run обязан снова обратиться к live source. Сам checksum index
лежит рядом и остаётся изменяемым: это prototype целостности package, а не immutable/trusted seal.
Выбор trusted root и binding production parser/rules остаются implementation gate `VS-1`.

## Failure semantics

Offline harness не реализует transport, retry budget или gray state. Он проверил только terminal
mapping: injected missing artifact дал exit code `2` и результат:

```json
{"marker":"yellow","reason":"artifact-missing","status":"unavailable"}
```

Transport failure и integrity mismatch не доказывают несоответствие пользователя условию, поэтому
никогда напрямую не создают red. Старый snapshot может дать replay, но не превращает новый run в
green. Полный transition «gray во время bounded retrieval → yellow после исчерпания policy» должен
быть отдельным integration acceptance criterion `VS-1`.

## Дополнительные probes, не выбранные source path

| Probe | Наблюдение | Решение |
| --- | --- | --- |
| [МВД Хорватии](https://mup.gov.hr/aliens-281621/stay-and-work/temporary-stay-of-digital-nomads/286833) + [DZS](https://podaci.dzs.hr/2025/en/97044) | содержимое видно через research retrieval, но backend GET и in-app browser завершились DNS/connect timeout | не использовать как happy-path `VS-1`, пока выбранный runtime не докажет raw capture |
| [AIMA Portugal HTML](https://aima.gov.pt/pt/trabalhar/autorizacao-de-residencia-para-o-exercicio-de-atividade-profissional-prestada-de-forma-remota-com-visto-de-residencia-para-o-exe) | два backend GET по 47 515 bytes, raw hash `7bb2696ece7ede7462ce1d7adfa565c38969e3cadf83d4566f11afc49518499b` | источник технически доступен, но одна страница не закрывает financial eligibility |
| [Diário da República HTML](https://diariodarepublica.pt/dr/legislacao-consolidada/decreto-regulamentar/2007-116373592-201741490) | HTTP 200 вернул только JavaScript shell 2 346 bytes без текста закона | HTTP 200 недостаточно; parser обязан проверять ожидаемый semantic content |
| [Diário da República PDF: remote-work rule](https://files.diariodarepublica.pt/1s/2022/09/19000/0002800097.pdf) | два raw PDF совпали; 6 318 133 bytes; hash `82bc888263b162fbc4c96549a5725eaba5a84bbaaf6398918708ae9123777118` | визуально подтверждены документы и формула `4 × minimum wage`; это candidate legal artifact |
| [Diário da República PDF: minimum wage 2026](https://files.diariodarepublica.pt/1s/2025/12/24900/0001400016.pdf) | два raw PDF совпали; 88 258 bytes; hash `e9e6da9ad45ffb70cb0a19a755fd31e4da9934174a3885edaacf7523c842c64f` | визуально подтверждено `€920`; derived threshold был бы `€3 680` |

Portugal probes показывают перспективный red-marker кейс, но spike не выносит verdict: ещё нужно
запечатать current applicability всей legal chain и подтвердить пользовательский average income за
три месяца. Официальный PDF и математическое совпадение сами по себе не дают green или red.

## Результат обязательного gate

| Обязательство | Результат | Evidence |
| --- | --- | --- |
| Live-origin retrieval и сохранение | `pass for spike` | metadata/hash двух HTTP 200 и один канонический raw body |
| Applicability, freshness, URL, response time | `pass for selected claim` | EUR claim, effective date и HTTP Date headers в manifest/log |
| Raw content hash | `pass for spike` | одинаковый SHA-256 обоих live retrieval в сохранённом log |
| Package integrity и deterministic offline replay | `partial / prototype` | изменяемый checksum index связывает body, log, manifest и harness; два replay идентичны; immutable seal ещё не доказан |
| Latency и cost check | `pass with limit` | 151–269 ms; no observed source fee; runtime cost unmetered |
| Terminal unavailable → yellow | `pass in offline harness` | missing artifact дал typed yellow |
| Gray → yellow после bounded policy | `not exercised` | обязательный JIT/integration gate `VS-1` |
| Узкий source path для `VS-1` | `selected` | CBR daily EUR/RUB XML |

Spike даёт достаточно evidence для перехода к JIT design `VS-1` с двумя явными implementation
gates: immutable/trusted seal с production parser/rules binding и полный gray → yellow transition.
Это не approval реализации, не выбор страны и не доказательство end-to-end happy path.

## Решение для JIT-спецификации VS-1

1. Первым source adapter специфицировать только CBR daily XML и claim `dated RUB per EUR`.
2. Capture предшествует parsing; HTTP success без expected semantic content считается
   `unavailable`, а не evidence.
3. Snapshot связывает raw hash, URL, response time, source period и версии parser/rules; production
   design обязан выбрать immutable/trusted root, а не переименовать локальный checksum в seal.
4. Расчёт RUB → EUR выполняется детерминированно с явным округлением и lineage; LLM его не создаёт.
5. During retrieval используется gray; yellow появляется только после завершения bounded policy;
   этот transition покрывается integration acceptance, а не offline replay.
6. Country/legal source path выбирается в JIT-пакете `VS-1` и обязан пройти те же правила до его
   baseline approval. Croatia и Portugal probes не являются автоматически выбранными кандидатами.
7. Generic crawler, browser workaround, скрытый fallback на search/LLM и второй постоянный pipeline
   запрещены.

## Acceptance evidence этого change

- [x] Выполнены два live raw retrieval выбранного официального source.
- [x] Сохранены metadata и body hash обоих retrieval и exact body одного канонического run.
- [x] Создан checksum prototype, связывающий manifest, retrieval log, body и harness; выполнены два
      offline replay.
- [x] Derived calculation воспроизведён из пользовательского input и official claim.
- [x] Один terminal missing-artifact failure завершился typed yellow; gray/retry policy не заявлен
      проверенным.
- [x] HTTP 200 без ожидаемого content выявлен как отдельный failure mode.
- [x] Независимые evidence/SDD review findings устранены продолжением spike, а не ослаблением gate.
- [x] Пользователь / 2026-08-06 / подтвердил точную редакцию вывода и выбранный CBR source path.

## Следующий шаг

Создать один компактный JIT change-пакет `VS-1`, объединяющий только необходимые requirements,
сценарии, domain/UX/design contracts, acceptance/evals и implementation tasks. Реализацию не
начинать до exact-text approval этого baseline.
