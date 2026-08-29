# Demo 10×5 official-source research summary

Research date: 2026-08-30. Branch: `codex/demo-10x5-source-research`.

This catalog is a staging handoff for the source-verification mechanism. It contains official primary-source candidates, precise locators, access outcomes, limitations, and rejected alternatives. It does not mark any source as production-verified and does not change production code.

## Scope and method

- The country and city order is copied unchanged from `demo-relocation-seed.ts`: 10 countries and 50 cities.
- Five independent streams covered SI/PT, ES/DE, RS/ME, GE/TR, and AE/TH.
- Slovenia began from the committed Stage B material and was supplemented only where the 10×5 contract required it.
- Only government, statistics, police, municipality, regulator, cadastral/geographic, and officially evidenced operator sources were retained as candidates.
- Commercial listings, aggregators, Wikipedia, media, and search snippets were not used as facts.
- `full`, `partial`, and `zero` below count how many of the four requested city facts have an `official_candidate_found` record. They do not mean that an observed value has been extracted or verified.

## Coverage

| Country | Cities | Full | Partial | Zero | Official fact candidates / 20 |
| --- | ---: | ---: | ---: | ---: | ---: |
| SI — Slovenia | 5 | 0 | 5 | 0 | 10 |
| PT — Portugal | 5 | 5 | 0 | 0 | 20 |
| ES — Spain | 5 | 0 | 5 | 0 | 15 |
| DE — Germany | 5 | 0 | 5 | 0 | 15 |
| RS — Serbia | 5 | 0 | 3 | 2 | 3 |
| ME — Montenegro | 5 | 0 | 2 | 3 | 2 |
| GE — Georgia | 5 | 0 | 5 | 0 | 6 |
| TR — Türkiye | 5 | 0 | 5 | 0 | 7 |
| AE — United Arab Emirates | 5 | 0 | 5 | 0 | 10 |
| TH — Thailand | 5 | 0 | 5 | 0 | 5 |
| **Total** | **50** | **5** | **40** | **5** | **93 / 200** |

Coverage by fact:

| Fact | Official candidate | Ambiguous official source | Not found |
| --- | ---: | ---: | ---: |
| Safety | 20 | 30 | 0 |
| Long-term rent | 15 | 5 | 30 |
| Urban transit | 38 | 12 | 0 |
| Fixed broadband | 20 | 30 | 0 |

All 50 cities have an official identity candidate. Population has 41 official candidates and 9 ambiguous official sources. Coordinates or official geometry have 30 official candidates and 20 ambiguous official sources; no coordinate point was extracted during this read-only pass.

## Data ready for the next import stage

There are 75 city records with both `official_candidate_found` and an `observedValue`:

- 40 official identity payloads;
- 20 population values;
- 10 urban-transit service payloads, from Slovenia and Portugal;
- 5 fixed-broadband availability payloads, from Georgia.

These records have publisher, authority root, source/final URL, period, geographic scope, locator, access date, limitations, and rejection notes. They are ready for the main agent's normalization and source-verification pipeline, not for direct production publication. In particular, the country streams use several equivalent `factKey` spellings and both scalar and structured `observedValue` shapes; an importer should normalize those representations before schema validation.

Additional candidates are useful but still need extraction. Examples include official Portuguese crime, rent, transport, and broadband sources; Spanish and German official city safety/rent/transport sources; Turkish BTK provincial broadband tables; and official WFS or boundary datasets for coordinates.

## Official sites unavailable during the pass

- `https://cm-funchal.pt/` was blocked by robots policy. The pass did not retry or bypass it; official Madeira transport-authority and operator sources were used instead.
- `https://www.rgz.gov.rs/digital-services` returned an internal fetch error. The RGZ authority was retained, but the failed endpoint was logged and no geometry was invented.
- `https://www.gov.me/en/mup` timed out in one research stream. Other accessible Montenegro government pages were used where possible; the timeout remains in the journal.

No CAPTCHA, authentication flow, form submission, download, or blocking-policy bypass was attempted.

## Parser work implied by the catalog

The raw format labels reduce to these parser families:

- HTML pages, tables, code lists, reports, and timetable pages;
- PDF reports and tables, including police, census, housing, telecom, and timetable documents;
- XLSX tables;
- WFS and other geospatial datasets, followed by a documented deterministic point-from-geometry method;
- PXWeb HTML/API datasets;
- fixed-length municipal-directory data;
- dynamic statistical tables and their metadata;
- interactive maps/atlases and e-book viewers, which need a stable underlying data endpoint before automated import.

## Yellow gaps

- Safety: 30 cities still have only a broad or non-comparable official source; a common city-level measure and period are not yet pinned.
- Long-term rent: no official series was found for 30 cities, and five Slovenian records remain ambiguous. Commercial listing prices were deliberately rejected.
- Fixed broadband: 30 cities have regulator or operator evidence without a stable comparable city-level aggregate.
- Urban transit: 12 cities have an official authority/operator candidate but no sufficiently pinned service dataset.
- Population: only 20 cities currently have an unambiguous extracted value; the other official candidates need table/API extraction or scope reconciliation.
- Coordinates: official geometry candidates exist for 30 cities, but none yet has an extracted official point or a recorded deterministic centroid calculation.
- Serbia and Montenegro contain the five zero-coverage cities: Niš, Kragujevac, Budva, Bar, and Tivat. Their identity/population/geography records are still useful, but none of the four requested city facts reached `official_candidate_found`.

## Artifacts

- `data/research/staging/demo-10x5/index.json` — ordered 10-country/50-city manifest and coverage roll-up.
- `data/research/staging/demo-10x5/<country-code>.json` — country authority evidence and city records.
- `data/research/staging/demo-10x5/search-log.ndjson` — combined append-only search journal.
- `data/research/staging/demo-10x5/logs/*.ndjson` — stream-level append-only journals retained for provenance.
