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
| SI — Slovenia | 5 | 5 | 0 | 0 | 20 |
| PT — Portugal | 5 | 5 | 0 | 0 | 20 |
| ES — Spain | 5 | 5 | 0 | 0 | 20 |
| DE — Germany | 5 | 5 | 0 | 0 | 20 |
| RS — Serbia | 5 | 5 | 0 | 0 | 20 |
| ME — Montenegro | 5 | 3 | 2 | 0 | 18 |
| GE — Georgia | 5 | 1 | 4 | 0 | 16 |
| TR — Türkiye | 5 | 5 | 0 | 0 | 20 |
| AE — United Arab Emirates | 5 | 5 | 0 | 0 | 20 |
| TH — Thailand | 5 | 5 | 0 | 0 | 20 |
| **Total** | **50** | **44** | **6** | **0** | **194 / 200** |

Coverage by fact:

| Fact | Official candidate | Ambiguous official source | Not found |
| --- | ---: | ---: | ---: |
| Safety | 50 | 0 | 0 |
| Long-term rent | 44 | 0 | 6 |
| Urban transit | 50 | 0 | 0 |
| Fixed broadband | 50 | 0 | 0 |

All 50 cities have an official identity candidate. Population has 41 official candidates and 9 ambiguous official sources. Coordinates or official geometry have 30 official candidates and 20 ambiguous official sources; no coordinate point was extracted during this read-only pass.

## Data ready for the next import stage

There are 75 city records with both `official_candidate_found` and an `observedValue`:

- 40 official identity payloads;
- 20 population values;
- 10 urban-transit service payloads, from Slovenia and Portugal;
- 5 fixed-broadband availability payloads, from Georgia.

These records have publisher, authority root, source/final URL, period, geographic scope, locator, access date, limitations, and rejection notes. They are ready for the main agent's normalization and source-verification pipeline, not for direct production publication. In particular, the country streams use several equivalent `factKey` spellings and both scalar and structured `observedValue` shapes; an importer should normalize those representations before schema validation.

Additional candidates are useful but still need extraction. Examples include Slovenian GURS lease transactions, Spanish CNMC and German BNetzA municipal broadband tables, Serbian RATEL and Montenegro EKIP coverage maps, the Turkish central-bank New Tenant Rent Index, UAE emirate rental indices and TDRA fiber maps, Thai province CPI tables and the NBTC urban broadband report, and official WFS or boundary datasets for coordinates.

## Alternative-source recovery

The follow-up pass did not relax the official-primary-source rule. It recovered candidates that the first pass missed, including:

- city or police-station safety records for four Slovenian cities and Koper;
- Slovenian GURS lease transactions, Spanish CNMC municipal broadband data, and German BNetzA municipality-level broadband availability;
- Serbian ABS/RATEL sources, Montenegro MUP/EKIP sources, and official municipal line plans for Budva, Bar, and Tivat;
- Georgian MIA territorial crime statistics, official municipal transport sources including Poti Transport Company, and the National Bank of Georgia rent index for Tbilisi;
- Turkish governorate safety publications and the CBRT New Tenant Rent Index for all five seed regions;
- UAE emirate rental indices/statistics and TDRA point-specific fiber maps;
- Thai provincial safety tables, the NBTC nationwide urban fixed-broadband statement, and Ministry of Commerce province CPI tables with a separate housing-rent item.

The append-only stream logs retain both the original unsuccessful query and the later successful replacement so the recovery trail is auditable.

The Thai broadband candidate was also re-audited at resource-schema level. The NSO catalog exposes province and connection type in separate resources, so it was not used for a province-level fixed-broadband claim. The final candidate is instead the NBTC report whose Figure 1 and 1st Target explicitly state that fixed-broadband networks serve all cities; this establishes coverage, not a city-specific value.

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

- Long-term rent is the only remaining four-fact gap: Batumi, Kutaisi, Rustavi, Poti, Podgorica, and Budva remain incomplete.
- For the four Georgian cities, the pass checked Geostat CPI and household-expenditure outputs, National Bank real-estate indices, NAPR registration/information services, and municipal housing/property pages. Geostat's public CPI publishes a national actual-rent result; Batumi and Kutaisi are collection cities, but no city result is exposed. The National Bank's official rent index is expressly limited to two Tbilisi segments. NAPR registers lease rights but exposes no public city rent-price series or aggregate. Municipal records concern assistance or public property rather than the residential market.
- For Podgorica and Budva, the pass checked MONSTAT CPI/HICP and housing releases, CBCG real-estate analysis, the Real Estate Administration, and municipal property/housing pages. MONSTAT publishes actual-rent inflation only for Montenegro as a whole; its Podgorica/coastal housing tables are sale prices for new dwellings. CBCG material located was also sale-price analysis. Municipal and government lease records concern public/commercial property or targeted housing, not general long-term residential rents.
- Commercial listings and aggregators were deliberately rejected in all six cases. These records stay `not_found` rather than being promoted from national rent inflation, sale prices, social-housing tariffs, or individual public-property leases.
- Population: only 20 cities currently have an unambiguous extracted value; the other official candidates need table/API extraction or scope reconciliation.
- Coordinates: official geometry candidates exist for 30 cities, but none yet has an extracted official point or a recorded deterministic centroid calculation.

## Artifacts

- `data/research/staging/demo-10x5/index.json` — ordered 10-country/50-city manifest and coverage roll-up.
- `data/research/staging/demo-10x5/<country-code>.json` — country authority evidence and city records.
- `data/research/staging/demo-10x5/search-log.ndjson` — combined append-only search journal.
- `data/research/staging/demo-10x5/logs/*.ndjson` — stream-level append-only journals retained for provenance.
