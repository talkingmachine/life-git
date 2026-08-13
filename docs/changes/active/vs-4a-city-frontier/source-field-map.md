# Slovenia City Official-Source Field Map

| Field | Value |
| --- | --- |
| `packageStatus` | `unavailable` |
| `decision` | `NEEDS_CONTEXT` |
| `captureDate` | `2026-08-13` |
| `evidencePass` | `2` |
| `scope` | Official-source feasibility only; no installed package, production code, schema, test scaffolding, crawler, or fixture-backed production success. |
| `fixtureCount` | `0` |

The package remains fail-closed. Evidence pass 2 proves several official surface semantics, but
`installable` is forbidden until the catalog and all four metric rows are official, comparable,
deterministic, bounded, and backed by committed validator fixtures. A partial row cannot waive a
missing term. In particular, the urban-transit evidence is definitively non-comparable for the
installed catalog, so it alone keeps this package unavailable.

## Catalog matrix

| sourceId | authority | navigationUrl | resolvedEvidenceUrl/request | officialAreaIdentifier | comparablePopulation/metricDefinition | referencePeriod | unit | denominator | updateCadence | freshness | validatorOutline | captureBound | deterministicBoundaryVectors | fixture/sha256 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `si-city-catalog` | Government of Slovenia (municipality status); Statistical Office of the Republic of Slovenia (SURS; population and settlement presentation); official settlement presentation names GURS and SURS as sources | `https://www.gov.si/teme/obcine-v-stevilkah/`; `https://www.stat.si/KrajevnaImena/en/Settlements/ByRegion` | Official SURS municipality table: `GET https://pxweb.stat.si/SiStatData/pxweb/sl/Data/Data/05C4003S.px/`, body absent for navigation; deterministic PxWeb data request/body **not proven**. Ljubljana search: `GET https://www.stat.si/KrajevnaImena/en/Settlements/Search?id=Ljubljana&s=Ljubljana&streets=0`. Ljubljana detail: `GET https://www.stat.si/KrajevnaImena/en/Settlements/Details/2370` | Municipality table exposes stable municipality codes for Slovenia plus all `212` municipalities. Ljubljana settlement detail ID is `2370`, with settlement and municipality both `Ljubljana`. A deterministic full settlement-to-municipality/centre mapping is **not proven** | GOV.SI states `212` municipalities and `12` with city-municipality status. The official settlement universe states `6,035` settlements. `05C4003S` exposes half-year municipality population through `2026H1`. Ljubljana detail records latitude `46.05667951121722`, longitude `14.500193914931764`, area `163.825`, density `1760`, and population `284293` (2022), `287076` (2023), `288382` (2024), `290903` (2025), each as of January 1. This does **not** yet prove the complete REQ-CF-01 city/municipal-centre universe, regional-capital typing, or top-ten fill | Municipality population through `2026H1`; Ljubljana annual population as of `2022-01-01`, `2023-01-01`, `2024-01-01`, `2025-01-01` | persons; square kilometres; persons per square kilometre | One official municipality or settlement row; the installed catalog's common centre-level denominator is **not proven** | Municipality series is half-year; Ljubljana detail is annual as of January 1 | Reject as stale/unknown until a deterministic request proves the latest complete period and an approved grace window; cadence is observed, but the freshness rule is **not proven** | Validate official universe counts, unique stable codes, area linkage, complete comparable population period, threshold inclusion, national/city/regional capital overrides, top-ten fill, missing-population handling, and no truncation. No success validator can be installed without a bounded bulk request and fixture | Five supplied official surfaces/table views; zero downloaded artifacts; zero fixtures | Observed Ljubljana vector: `2022=284293`, `2023=287076`, `2024=288382`, `2025=290903`. Required `<20000`, `=20000`, `>20000`, capital override, regional-capital override, top-ten fill, missing-population, and no-truncation vectors remain **unproven** | none; no fixture `sha256` exists |

## Metric matrix

| sourceId | criterion | authority | navigationUrl | resolvedEvidenceUrl/request | officialAreaIdentifier | comparablePopulation/metricDefinition | referencePeriod | unit | denominator | updateCadence | freshness | validatorOutline | captureBound | deterministicBoundaryVectors | fixture/sha256 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `si-city-safety` | `safety` | Slovenian Police official surface; source definition not observed because transport never completed | `https://www.policija.si/o-slovenski-policiji/statistika/kriminaliteta` | Direct navigation plus one reload; both timed out. No resolved response URL, status, media type, request grammar, or bytes | **not proven** | **not proven**; timeout is `transport_failure`, not evidence of source or crime-data absence | **not proven** | **not proven** | **not proven** | **not proven** | Always reject as `unknown`; no period/cadence or fresh/stale boundary was observed | Reject on transport failure or any missing definition, area key, denominator, period, deterministic request, or fixture; no success grammar is installed | `2` bounded attempts (initial load plus one reload); `0` responses; `0` fixtures | below/equal/above target, missing city, and fresh/stale boundary are **not derivable** | none; no fixture `sha256` exists |
| `si-city-rent` | `long_term_rent` | Official e-Prostor real-estate-market surface and Evidence of the Real Estate Market (ETN) semantics | Stale path `https://www.e-prostor.gov.si/podrocja/trg-nepremicnin/`; current path `https://www.e-prostor.gov.si/podrocja/trg-in-vrednosti-nepremicnin/trg-nepremicnin/` | Old path returned `404`. Current official page resolved and states that ETN records prices and rents. It links an annual 2025 PDF, but the large PDF was not downloaded and its artifact URL/bytes were not captured | **not proven** for a deterministic city/settlement aggregate | ETN contains verified and processed price/rent records since `2007`; a lease is long-term when its duration is at least `6 months`. No current city-wide comparable residential-rent aggregate across the installed settlement catalog is proven | Record coverage since `2007`; annual report for `2025` was linked but not captured | Record-level price/rent fields are evidenced; exact comparable aggregate unit is **not proven** | Verified/processed ETN lease records are the source population; city aggregate denominator is missing | Annual 2025 report observed; machine-data cadence is **not proven** | Reject as stale/unknown until a bounded current aggregate period and grace rule are proven | A future validator may enforce lease-duration `>=6 months` and ETN verified/processed status, but must reject without a stable area identifier, common residential scope, period, unit/denominator, deterministic request, and fixture | One stale-path response, one current official page, and one linked large-PDF observation; no download; zero fixtures | Semantic duration vector: `<6 months` excluded, `6 months` included, `>6 months` included. Rent target below/equal/above, missing-city, and fresh/stale vectors remain **unproven** and not fixture-backed | none; no fixture `sha256` exists |
| `si-city-transit` | `urban_transit` | Official LPP and Marprom operator surfaces; official SURS transport tables | `https://www.lpp.si/en/public-transport`; `https://www.marprom.si/en/urban-bus-service/`; `https://pxweb.stat.si/SiStatData/pxweb/en/Data/-/2221406S.px`; `https://pxweb.stat.si/SiStatData/pxweb/en/Data/-/2281296S.px` | LPP page resolved with operational statistics, but they mix geographies and expose no stable common area ID. Marprom path drifted/timed out. SURS table `2221406S` has only measures by year and is national. SURS table `2281296S` covers only Ljubljana and Maribor; deterministic PxWeb data request/body is not proven | **not proven**; neither operator pages nor the two SURS views establish stable identifiers shared with the full settlement catalog | Definitively non-comparable: LPP statistics have mixed geography; `2221406S` is national; `2281296S` has only Ljubljana and Maribor, years `2021` and `2025`, and absolute trips. None provides one common metric and denominator for the wide installed catalog | Operator period not comparable; SURS city table exposes `2021` and `2025` | Absolute trips in `2281296S`; mixed/other measures are not one common unit | Missing; neither per-resident, per-service-area, nor another common city denominator is proved | Two city-table years do not prove a usable update cadence | Always reject as `unknown`; no common period/cadence or deterministic fresh/stale rule exists | Fail with `universe_incomplete`, `definition_noncomparable`, `area_identifier_unproved`, and `denominator_missing`; do not substitute national data or random operator metrics | Four bounded official surfaces/table views; Marprom ended in source drift/timeout; zero fixtures | Candidate outside Ljubljana/Maribor demonstrates universe incompleteness. Below/equal/above target, cross-operator equality, absent-service, and fresh/stale vectors are **not derivable** from absolute trips | none; no fixture `sha256` exists |
| `si-city-broadband` | `fixed_broadband` | Agency for Communication Networks and Services of the Republic of Slovenia (AKOS) | `https://www.akos-rs.si/telekomunikacije/raziscite/porocila-raziskave-in-analize/telekomunikacije`; `https://www.akos-rs.si/radijski-spekter/izpostavljamo/akos-testnet-in-geoportal`; `https://gis.akos-rs.si/` | Reports page resolves only national reports. AKOS information says Test Net measures fixed/mobile speed, latency, and availability and that Geoportal retrieves network-connection-point data at municipality/settlement level. Geoportal loaded with `FIKSNO OMREŽJE`, `OPT`, planned `OPT`/white-spots, `naselja`, and municipality layers. Exact API/WFS request and schema are unresolved; direct `app.js` access was blocked by the client | Municipality/settlement layer types are visible, but stable area code fields and their join to the catalog are **not proven** | Partial semantics only: fixed/mobile performance and connection-point data are official, but no deterministic city-comparable fixed-broadband availability/speed field is proven | **not proven** | Speed, latency, and availability concepts are named; exact field, unit, aggregation, and threshold semantics are **not proven** | Missing; no common premise, address, connection-point, household, population, or area denominator is proven | **not proven** | Always reject as `unknown`; neither data period nor cadence/freshness boundary is proven | Reject national-only reports and any UI-only layer until a bounded API/WFS request proves schema, fixed-network field, stable area ID, unit/denominator, period, fixture, and boundary vectors | Three official pages/app views plus one client-blocked direct `app.js` attempt; zero deterministic data responses; zero fixtures | Technology/layer presence is not a criterion vector. Below/equal/above speed or availability target, missing city, denominator, and fresh/stale vectors remain **unproven** | none; no fixture `sha256` exists |

## Evidence-pass-2 source outcomes

Evidence pass 2 used only the supplied read-only official-source observations; this documentation
update performed no browser or network action and made no download.

| Surface | Proven in the supplied evidence | Still missing for installation |
| --- | --- | --- |
| GOV.SI municipalities | `212` municipalities; `12` have city-municipality status; link to official SURS table | Complete city/municipal-centre construction, national/regional capital typing, top-ten proof, fixture |
| SURS municipality population | Slovenia plus `212` coded municipalities; half-year population through `2026H1` | Deterministic bounded PxWeb request/body, parser, fixture, approved freshness rule |
| SURS/GURS settlement presentation | `6,035` settlements; Ljubljana search/detail identity and exact 2022–2025 detail vector | Deterministic bulk settlement universe, complete catalogue join and fixture |
| Slovenian Police crime | Nothing beyond the official target URL | Response, definition, area ID, period, denominator, request, fixture; two attempts ended in timeout |
| e-Prostor / ETN | Prices/rents, verified/processed records since 2007, long-term lease `>=6 months` | Comparable current residential city aggregate, area ID, unit/denominator, period, request, downloaded fixture |
| LPP/Marprom/SURS transit | LPP mixed-geography stats; national SURS table; two-city absolute-trip table for 2021/2025 | A wide-catalog common metric, stable area IDs, common denominator, deterministic request and fixture; current evidence is definitively non-comparable |
| AKOS | National reports; Test Net/Geoportal semantics; fixed/OPT/planned/white-spot and settlement/municipality layers | Exact API/WFS request, schema and speed/availability field, stable IDs, period, unit/denominator and fixture |

## Installation gate

```text
official registry/universe + population rule
+ safety definition/validator
+ long-term rent definition/validator
+ urban transit definition/validator
+ fixed broadband definition/validator
= one closed four-fact package
```

Observed gate:

```text
PARTIAL + RED + PARTIAL + DEFINITIVE RED + PARTIAL = unavailable / NEEDS_CONTEXT
```

Urban transit alone makes the package un-installable in this bounded pass. Partial catalog, rent,
and broadband evidence cannot waive that failure; safety also remains unresolved after its bounded
transport failure. The fixture directory remains intentionally absent because no complete source
row has a deterministic request, success validator, boundary vectors, and bounded official fixture.
This task must not proceed to the Knowledge plan or any production source package.

## Failure taxonomy

- `source_drift`: an official navigation path or client resource no longer resolves to the recorded shape.
- `transport_failure`: timeout, connection loss, DNS, TLS, cancellation, or non-success transport; retryable and not evidence of source absence.
- `universe_incomplete`: the source does not cover the complete installed catalog universe.
- `definition_noncomparable`: areas, operators, periods, units, or metric meanings cannot be compared as one criterion.
- `area_identifier_unproved`: no stable official key joins the response area to the installed catalog.
- `denominator_missing`: no common population, household, premise, service-area, or other required denominator is defined.
- `freshness_unproved`: cadence or a deterministic fresh/stale rule is absent.
- `request_nondeterministic`: the exact machine request, including any body, cannot be reconstructed deterministically.
- `fixture_unavailable`: no smallest bounded official response was captured for the validator.
- `bounded_attempt_exhausted`: the documented official attempt bound ended without closing the fact.
