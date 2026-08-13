# Slovenia City Official-Source Field Map

| Field | Value |
| --- | --- |
| `packageStatus` | `unavailable` |
| `decision` | `NEEDS_CONTEXT` |
| `captureDate` | `2026-08-13..2026-08-14` |
| `evidencePass` | `4` |
| `fixtureCount` | `22` files including README, manifests and `SHA256SUMS` |
| `scope` | Official-source feasibility and privacy-safe validator evidence only. No installed package, production source adapter, schema, crawler or fixture-backed success. |

The bounded audit found trustworthy official alternatives and materially narrowed every row. It did
not close one installable Slovenia package: the catalog is now reproducible, while current safety,
comparable municipal urban transit, and the AKOS reference-period/reuse boundary remain unresolved.
A missing row must become evidence-backed `unknown`, never zero or a carried-forward value. Task 3
must not start from these fixtures.

## Catalog matrix

| Required field | Evidence pass 4 result |
| --- | --- |
| `authority` / `navigationUrl` | SURS SMN classification: `https://www.stat.si/Klasje/Klasje/Details/1601`; SURS PxWeb population; GURS RPE WFS: `https://ipi.eprostor.gov.si/wfs-si-gurs-rpe/wfs`. National capital: Constitution Article 10, `https://pisrs.si/pregledPredpisa?id=USTA1&tab=47`. Regional-capital status: GOV.SI says the country is still advancing the process of establishing self-governing provinces. |
| `resolvedEvidenceUrl` / request | `POST https://pxweb.stat.si/SiStatData/api/v1/sl/Data/05C5003S.px` with committed deterministic request. SMN 2022 XLSX/PDF SHA-256 `76c961...fbd6` / `145adb...477`. GOV.SI province-status capture `https://www.gov.si/en/news/2026-06-05-monika-kirbis-rojs-assumes-office-as-minister-of-local-self-government-cohesion-and-regional-development/`, SHA-256 `0893c5...5d0a`. GURS `GetCapabilities`, `DescribeFeatureType NASELJA`, hits, and bounded top-ten GeoJSON hashes are `5d9047...e2`, `7d5c87...d453`, `5f20d3...beb2`, `86aaa3...6380`. |
| `officialAreaIdentifier` | Six-digit SURS/SMN settlement code; current GURS `SESTAVLJENA_SIFRA` zero-pads to that code. The first three digits and the same PxWeb dimension provide the municipality code/name used as administrative territory. GURS EID remains a versioned external crosswalk, not stable internal `cityId`. |
| `comparablePopulation` / definition | SURS `05C5003S`, `MERITVE=0`, settlement population on `2026-01-01`, release `2026-06-11`, unit persons, denominator one settlement. Full response: 6,253 rows, 212 municipalities, 6,040 settlement slots, 6,035 non-null current settlements. Raw response SHA-256 `237dc3...bb0c`. |
| `referencePeriod` / cadence / `freshness` | `2026-01-01`; annual series through 2026. A future validator must load metadata and require the latest released common year, never reuse the capture date as the population reference date. |
| `validatorOutline` | Replay the complete 104-row SMN level-2 central-urban universe and PxWeb population projection; validate unique six-digit codes, all 104 comparable values, threshold `>=20000`, Ljubljana national role, no invented regional-capital role, then top-up by population descending/code ascending until ten distinct members. GURS polygons may yield a versioned derived `pointOnSurface`, never an alleged official point. |
| `captureBound` / deterministic vectors | One full PxWeb response, one official SMN export pair, one GOV.SI province-status capture, three GURS schema/count calls and one top-ten polygon call. SMN has 104 central urban centres and all 104 have non-null comparable 2026 population. Seven pass `>=20000`; Slovenia currently has no established self-governing provinces whose capitals could trigger the override; Ptuj, Kamnik and Jesenice fill the catalog to ten. |
| `fixture` / `sha256` | Deterministic request `4c0c21...fea8`; compact full 104-centre projection `33618a...0b3c`; summary `adcfd0...63eb`; raw population request/response `4ff155...970f` / `237dc3...bb0c`. |
| `blockingGap` | None at source-feasibility level. A 212-municipality-seat crosswalk is outside the approved SMN central-urban universe. Installation must seal the full registry projection, derive all 104 marker points from GURS polygons, assign package-owned stable `cityId`, and require an explicit identity migration for later reclassification. |

Catalog membership is ten centres: Ljubljana, Maribor, Celje, Kranj, Koper/Capodistria, Velenje,
Novo mesto, Ptuj, Kamnik and Jesenice. ReSPR50's second-level centres are not silently relabelled as
regional capitals; if Slovenia establishes provinces and explicitly types their capitals, a new
catalog revision can apply that override.

## Metric matrix

### `safety` — historical algorithm reproducible; current fact unavailable

| Required field | Evidence pass 4 result |
| --- | --- |
| `authority` / `navigationUrl` | Slovenian Police open-data catalog and methodology: `https://www.policija.si/o-slovenski-policiji/statistika/kriminaliteta`; denominator from SURS `05C3002S`. |
| `resolvedEvidenceUrl` / request | The official page lists `https://www.policija.si/baza/kd2024.zip`, but bounded direct attempts timed out before response bytes. A `kd2023.zip` copy came only from Internet Archive at `https://web.archive.org/web/20250430170053id_/https://www.policija.si/baza/kd2023.zip`; it is non-authoritative historical corroboration. SURS denominator uses the committed PxWeb request. |
| `officialAreaIdentifier` | Police exposes the text label `UpravnaEnotaStoritve`; no official label-to-SURS-code crosswalk was found. The historical `KOPER` → `Koper/Capodistria` join is manual name inference. Scope is administrative unit, not settlement/city. |
| `metricDefinition` | Distinct police-recorded offences whose concluding complaint/report document is in year Y, divided by SURS population of the same administrative unit at YH1, times 1,000. Count distinct `ZaporednaStevilkaKD`, not person rows. Sentinel areas `NEZNANA OBČ`, `NEZNANA UE`, `NI PODATKA` are excluded and lower coverage. |
| `referencePeriod` / unit / denominator | Closing-document year `2023`; offences per 1,000 residents; SURS administrative-unit population at `2023H1`. Archived examples: Koper `32.499170494`, Ljubljana `50.667789935`, Maribor `29.967059810`. |
| cadence / `freshness` | Police methodology says one prior-year export on the second weekend of February. As of 2026-08-14 the newest listed period is 2024, while 2025 was expected in February 2026: `expected_update_missing`. |
| `validatorOutline` / bound | Bounded current official request plus at most one retry; validate media/encoding/closed header, deduplicate offence IDs, reject missing period/geo/authoritative crosswalk/denominator, seal SURS response, publish `unknown/source_unavailable_or_stale` if any term fails. Never treat a mirror as official live evidence. |
| deterministic vectors / fixture | Synthetic duplicate-person/known/unknown-area rows; non-authoritative historical-mirror header `174006...5cb`; synthetic projection `db8f3f...57c9`; non-publishable historical aggregate `fa5e2b...b8285`; SURS request/response `8024b9...f828` / `ea8e16...bd3`. Raw mirrored ZIP/member hashes `788ee9...74f` / `4d4a57...021`. |
| `blockingGap` | Three independent failures: newest listed official bytes unavailable; expected 2025 update missing; official Police-label-to-SURS-code crosswalk absent. Current result is `unknown`, not a 2023/2024 value. |

### `long_term_rent` — official definition and current municipality-year aggregate proven

| Required field | Evidence pass 4 result |
| --- | --- |
| `authority` / `navigationUrl` | GURS e-Prostor, Evidence of the Real Estate Market (ETN): `https://www.e-prostor.gov.si/podrocja/trg-in-vrednosti-nepremicnin/trg-nepremicnin/`. |
| `resolvedEvidenceUrl` / request | Product discovery `GET https://ipi.eprostor.gov.si/jgp-service-api/display-views/groups/131/composite-products`; bounded result `GET .../composite-products/324/result?filterParam=OBCINE&filterValue=61&filterYear=2025`; file endpoint has the same query. Schema DOCX SHA-256 `17ea50...d4c`; Ljubljana 2025 archive SHA-256 `ca3497...9188`. |
| `officialAreaIdentifier` | `RPE_OBCINE_SIFRA`; municipality scope, explicitly broader than the central settlement. |
| `metricDefinition` | Median across qualifying contracts of `(monthly contractual rent / that contract's total qualifying leased residential area)`. Qualifying: free-market lease `25:1`; base contract `83:1`; indefinite `26:2` or fixed `26:1` with duration `>=6` months; only house/apartment/residential-room parts `30:1/2/16`; costs/VAT excluded; positive complete rent and area. No undocumented outlier or `TRZNOST_POSLA` filter. |
| `referencePeriod` / unit / denominator | Calendar year `2025`; EUR/m²/month; qualifying base lease contracts. Ljubljana: `9,982` contracts, median `9.090909090909092`. |
| cadence / `freshness` | JGP schema says weekly export refresh. Validator must require a supported latest completed calendar year and record both source export date and reference year; the capture timestamp is not the reference period. |
| `validatorOutline` / bound | One product-list request, one municipality/year result and one archive; validate codebook version, exact two-table join, one row per deal, closed filters and numeric finiteness. Missing/zero rent or area is not comparable. |
| deterministic vectors / fixture | Synthetic 5/6/7-month, indefinite, invalid act/type/cost/VAT, missing-area, zero-rent and median vectors. Codebooks `5a4226...022`; aggregate `881470...6c`; vectors `bf9842...dc5`. No real transaction row/address/coordinate/property ID is committed. |
| `blockingGap` | This row is technically usable at municipality scope, but cannot waive failures in the other required package terms. |

### `urban_transit` — DUJPP is trusted but insufficient for the approved definition

| Required field | Evidence pass 4 result |
| --- | --- |
| `authority` / `navigationUrl` | DUJPP/National Access Point Slovenia: `https://www.nap.si/sl/datasets_details?id=8db7cc40-3770-d834-5e15-81a0a7763f58`. |
| `resolvedEvidenceUrl` / request | Public no-auth `GET https://dujpp.si/gtfs/dujpp-ijpp.zip`; `200 application/zip`, 41,195,555 bytes, Last-Modified `2026-08-13T12:52:43Z`, raw SHA-256 `e5458f...1f34`, headers `13bd42...8804`, all 11 ZIP members passed CRC. License recorded by NAP: CC BY-SA 4.0. |
| `officialAreaIdentifier` / definition | GTFS stop/route/operator IDs and coordinates, not a common municipal-centre area identifier. The feed describes integrated public passenger/intercity bus and rail. It does not, by itself, define a comparable complete municipal `urban_transit` metric for every catalog city. |
| `referencePeriod` / cadence | Captured feed version `260813.5003600`, active span `2025-12-29..2028-01-02`; NAP describes daily refresh. These dates prove feed service, not complete urban coverage. |
| unit / denominator / freshness | No approved common city unit or denominator can be calculated until municipal operator coverage and stable city/stop-area attribution are proven. Feed freshness cannot cure universe incompleteness. |
| `validatorOutline` / bound | Validate GTFS closure/CRC, calendar activation, referential integrity and known operator coverage. Any missing municipality/operator must yield `unknown/universe_incomplete`; absence of a route in DUJPP must never mean zero service. No universal operator crawler in this slice. |
| deterministic vectors / fixture | Full feed counts 5 agencies, 2,477 routes, 19,020 trips, 9,793 stops and 364,105 stop times; it has 37 unique LPP line codes and zero Marprom agency matches. Bounded active LPP/Arriva/SŽ trips are in `dujpp-coverage-projection.json`. These are measured feed properties, not evidence that omitted municipal services do not exist. |
| `blockingGap` | DUJPP alone cannot establish the approved complete municipal fact. The strongest trusted alternative is the official NAP NeTEx timetable dataset, but it requires registration/approval and one authorized feasibility capture to prove actual municipal-operator and catalog-city coverage. SURS alternatives lack a comparable city dimension. |

### `fixed_broadband` — technical field proven; source period and reuse permission unresolved

| Required field | Evidence pass 4 result |
| --- | --- |
| `authority` / `navigationUrl` | AKOS Geoportal: `https://gis.akos-rs.si/Index?force_desktop=true`; official guide `https://gis.akos-rs.si/AKOS_uporabni%C5%A1ka_navodila.pdf`, SHA-256 `1896bc...3fe`. |
| `resolvedEvidenceUrl` / request | Same-run `GET https://gis.akos-rs.si/StanjePodatkov?lang=slo` plus WMS `GetFeatureInfo` on `pregledovalnik:pokritost_na`, style `naselja_vsaj_100mbits_delez`, with `propertyName=eid_naselj,naziv,eid_obcina,gosp_vsaj_100_delez`. Exact request is in `broadband/manifest.json`. |
| `officialAreaIdentifier` | `eid_naselj`, stored as an exact decimal string/versioned external crosswalk, not internal `cityId`. It joins current AKOS/GURS settlement surfaces; immutability through reclassification was not proven. |
| `metricDefinition` | `gosp_vsaj_100_delez`: percentage of settlement households whose permanent-residence address has an OPT with fixed-broadband capacity at least 100 Mbit/s. Unit percent; denominator all households in the settlement. Ljubljana capture: `99.26`. |
| `referencePeriod` / cadence / `freshness` | Underlying source reference period/age is not exposed. Guide states daily coverage-analysis updates and portal said `Fiksna širokopasovna pokritost = Aktualni podatki`; that is a current portal-status check only, not a source date. Response timestamp is capture time and must not be relabelled. |
| `validatorOutline` / bound | Same bounded check must receive exact status label and one property-only GFI; reject missing/duplicate/nonfinite/out-of-range values or crosswalk mismatch. Without a defensible source period/policy, publish `unknown/reference_period_unproved` rather than evergreen verified data. |
| deterministic vectors / fixture | Semantic Ljubljana projection `f39e64...b073`; current-status projection `77fddd...dfad`; synthetic below/equal/above/missing/status vectors `25a648...78`. The 18-digit IDs are strings to avoid JavaScript precision loss. |
| `blockingGap` | Exact source reference period is unproved, and no license authorizing the intended production reuse was established. Technical access alone is not that authorization. |

## Installation gate and failure taxonomy

```text
official catalog source contract proven
+ current safety unavailable/stale/crosswalk-unproved
+ rent definition/aggregate proven
+ municipal urban-transit universe incomplete
+ broadband reference period/license unresolved
= unavailable / NEEDS_CONTEXT
```

Fixtures prove parsers, bounded observations and honest failure modes; they are not a substitute for
an installed official package. `SHA256SUMS` binds every other committed fixture byte and manifests
separately bind raw artifacts and transformations.

- `source_drift`: recorded official path/shape no longer resolves.
- `transport_failure`: timeout/DNS/TLS/cancellation/non-success; retryable, never evidence of zero.
- `universe_incomplete`: source does not cover installed catalog/municipal services.
- `definition_noncomparable`: geo, period, unit, denominator or meaning cannot be compared.
- `area_identifier_unproved`: exact current crosswalk is absent or ambiguous.
- `reference_period_unproved`: response/capture time cannot establish source age.
- `license_unproved`: technical access exists but intended production reuse is not authorized.
- `fixture_unavailable`: no minimal hash-bound validator evidence exists.
- `bounded_attempt_exhausted`: documented official attempt bound ended without closing the fact.

Safest next evidence: an official current Police annual payload plus authoritative area crosswalk;
an approved NAP NeTEx feasibility capture (or another complete comparable municipal source); and
AKOS reference-period/license clarification. Until then every affected fact is `unknown` and Task 3
remains blocked.
