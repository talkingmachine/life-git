# Slovenia City Official-Source Field Map

| Field | Value |
| --- | --- |
| `packageStatus` | `unavailable` |
| `decision` | `NEEDS_CONTEXT` |
| `captureDate` | `2026-08-13` |
| `captureCompletedAt` | `2026-08-13T12:11:28Z` |
| `scope` | Official-source feasibility only; no installed package, production code, schema, test scaffolding, or fixture-backed production success. |
| `successfulOfficialResponses` | `0` |
| `fixtureCount` | `0` |

The package is fail-closed. `installable` is forbidden until the catalog row and all four metric
rows are official, comparable, deterministic, bounded, and backed by committed validator fixtures.
The bounded browser pass reached no official response: the first three navigations were denied by
the browser security gate before a response, and that browser connection then closed. A blocked
navigation proves neither source suitability nor source absence.

## Catalog matrix

| sourceId | authority | navigationUrl | resolvedEvidenceUrl/request | officialAreaIdentifier | comparablePopulation/metricDefinition | referencePeriod | unit | denominator | updateCadence | freshness | validatorOutline | captureBound | deterministicBoundaryVectors | fixture/sha256 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `si-city-catalog` | Candidate surfaces: Government of Slovenia and Statistical Office of the Republic of Slovenia; authority **not proven from a response** | Attempted `https://www.gov.si/teme/obcine-v-stevilkah/`; attempted `https://www.stat.si/obcine/sl` | **unresolved**; two direct `GET` requests, no request body, no observed HTTP status, redirect, final evidence URL, or media type | **not proven**; no official settlement/municipality identifier observed | **not proven**; no complete official city/municipal-centre universe, comparable population rule, national/regional-capital override, or top-ten fill rule observed | **not proven** | **not proven** | **not proven** | **not proven** | Always reject as `unknown` until a successful current capture proves the period and cadence; no inferred grace window | Reject on `authority_unproved`, `universe_incomplete`, `request_nondeterministic`, `fixture_unavailable`, or `freshness_unproved`; no success grammar is installed | `2` direct navigation attempts; `0` responses; `0` fixtures | threshold below/equal/above, capital override, top-ten fill, missing population, no truncation: **not derivable without the official response grammar** | none; no `sha256` exists |

## Metric matrix

| sourceId | criterion | authority | navigationUrl | resolvedEvidenceUrl/request | officialAreaIdentifier | comparablePopulation/metricDefinition | referencePeriod | unit | denominator | updateCadence | freshness | validatorOutline | captureBound | deterministicBoundaryVectors | fixture/sha256 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `si-city-safety` | `safety` | Candidate surface: Slovenian Police; authority **not proven from a response** | Attempted `https://www.policija.si/o-slovenski-policiji/statistika/kriminaliteta` | **unresolved**; direct `GET`, no body, no observed HTTP status, redirect, final evidence URL, or media type | **not proven** | **not proven**; no nationwide city-comparable offence scope, time basis, or classification observed | **not proven** | **not proven** | **not proven** | **not proven** | Always reject as `unknown`; no period/cadence or fresh/stale boundary was observed | Reject on missing official response, definition, area key, denominator, period, deterministic request, or fixture; no success grammar is installed | `1` direct navigation attempt; `0` responses; `0` fixtures | below/equal/above target, missing city, fresh/stale boundary: **not derivable** | none; no `sha256` exists |
| `si-city-rent` | `long_term_rent` | Candidate surface: Slovenian e-Prostor; authority **not proven from a response** | Attempted `https://www.e-prostor.gov.si/podrocja/trg-nepremicnin/` | **unresolved**; direct `GET`, no body; browser pipe closed before an observable response | **not proven** | **not proven**; no nationwide city-comparable long-term-rent scope, dwelling basis, or statistic observed | **not proven** | **not proven** | **not proven** | **not proven** | Always reject as `unknown`; no period/cadence or fresh/stale boundary was observed | Reject on missing official response, tenure definition, area key, denominator, period, deterministic request, or fixture; no success grammar is installed | `1` direct navigation attempt; `0` responses; `0` fixtures | below/equal/above target, missing city, fresh/stale boundary: **not derivable** | none; no `sha256` exists |
| `si-city-transit` | `urban_transit` | Candidate operator surfaces: LPP and Marprom; official ownership and cross-operator comparability **not proven from responses** | Planned direct navigation to `https://www.lpp.si/en/public-transport` and `https://www.marprom.si/en/urban-bus-service/`; browser became unavailable before response | **unresolved**; planned `GET` requests, no bodies, no observed status, redirect, final evidence URL, or media type | **not proven** | **not proven**; no common nationwide service-frequency, coverage, operating-hours, or passenger metric observed | **not proven** | **not proven** | **not proven** | **not proven** | Always reject as `unknown`; no common publication period/cadence or fresh/stale boundary was observed | Reject on missing operator authority, shared definition, area key, period, deterministic request, or fixture; no success grammar is installed | `2` bounded operator navigation slots; `0` responses; `0` fixtures | below/equal/above target, absent service, cross-operator equality, fresh/stale boundary: **not derivable** | none; no `sha256` exists |
| `si-city-broadband` | `fixed_broadband` | Candidate surface: Agency for Communication Networks and Services of the Republic of Slovenia (AKOS); authority **not proven from a response** | Planned direct navigation to `https://www.akos-rs.si/telekomunikacije/raziscite/porocila-raziskave-in-analize` and `https://gis.akos-rs.si/`; browser became unavailable before response | **unresolved**; planned `GET` requests, no bodies, no observed status, redirect, final evidence URL, or media type | **not proven** | **not proven**; no nationwide city-comparable fixed-access availability/speed definition observed | **not proven** | **not proven** | **not proven** | **not proven** | Always reject as `unknown`; no period/cadence or fresh/stale boundary was observed | Reject on missing official response, technology/speed definition, area key, denominator, period, deterministic request, or fixture; no success grammar is installed | `2` bounded navigation slots; `0` responses; `0` fixtures | below/equal/above target, missing city, technology boundary, fresh/stale boundary: **not derivable** | none; no `sha256` exists |

## Bounded source actions

All actions used the runtime-default Codex in-app browser in one Task 2 session. No cookies,
storage, credentials, signed-in state, personal data, generic search, third-party aggregator, or
existing developer database was inspected.

| Surface | Exact action | Outcome | Recorded response evidence |
| --- | --- | --- | --- |
| Government catalog candidate | Direct `GET https://www.gov.si/teme/obcine-v-stevilkah/`, body absent | Browser security policy denied navigation before access | final browser location `about:blank`; status, redirect, evidence URL, media type and bytes unobserved |
| SURS population candidate | Direct `GET https://www.stat.si/obcine/sl`, body absent | Browser security policy denied navigation before access | final browser location `about:blank`; status, redirect, evidence URL, media type and bytes unobserved |
| Police safety candidate | Direct `GET https://www.policija.si/o-slovenski-policiji/statistika/kriminaliteta`, body absent | Browser security policy denied navigation before access | final browser location `about:blank`; status, redirect, evidence URL, media type and bytes unobserved |
| e-Prostor rent candidate | Direct `GET https://www.e-prostor.gov.si/podrocja/trg-nepremicnin/`, body absent | Browser connection closed before an observable response | no response provenance observed |
| LPP and Marprom transit candidates | Direct `GET` slots for the two matrix URLs, bodies absent | Browser unavailable after the connection closed | no response provenance observed |
| AKOS broadband report and map candidates | Direct `GET` slots for the two matrix URLs, bodies absent | Browser unavailable after the connection closed | no response provenance observed |

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
RED + RED + RED + RED + RED = unavailable / NEEDS_CONTEXT
```

No source row is fixture-backed, so the fixture directory is intentionally absent. The first
unproved term is already sufficient to stop installation; the remaining rows are recorded as
explicit infeasibility results rather than placeholders. This task must not proceed to the
Knowledge plan or any production source package.

## Failure taxonomy

- `authority_unproved`: ownership or official publication authority is not mechanically evident.
- `universe_incomplete`: the source cannot prove the complete catalog universe required by REQ-CF-01.
- `definition_noncomparable`: different areas, operators, periods, units, or denominators cannot be compared.
- `request_nondeterministic`: the resolved request cannot be reconstructed without UI/session state.
- `fixture_unavailable`: no smallest bounded official response was captured for an otherwise proven row.
- `freshness_unproved`: publication cadence or a deterministic fresh/stale rule is absent.
- `source_drift`: status, media type, request shape, schema, or semantic anchors differ from the field map.
- `bounded_attempt_exhausted`: the documented official attempt bound ended without closing the fact.
- `transport_failure`: browser access denial, connection loss, timeout, DNS, TLS, cancellation, or non-success response; retryable and not evidence of absence.
- `protocol_failure`: redirect, status, media type, or response shape violates the proven contract.
- `integrity_failure`: request/body/fixture hash or deterministic boundary validation fails.
