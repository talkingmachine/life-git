# Demo 10x5 Official Source Research Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a locally committed staging catalog of official country and city sources for the fixed ten-country, fifty-city demo seed without changing production code.

**Architecture:** Five isolated research streams each own exactly two country JSON files and a stream-local append-only NDJSON search log. The coordinator validates and combines those outputs into one deterministic index, one combined append-only journal, and one human-readable coverage summary after all streams finish.

**Tech Stack:** JSON, NDJSON, Markdown, Git, read-only web search over official primary sources.

**Spec:** `/Users/nameinchat/.codex/attachments/2b116290-e0b3-436f-9b68-700cfaf10ab2/pasted-text.txt`

## Global Constraints

- Use only the countries, cities, order, names, and identifiers in `src/research/demo-relocation-seed.ts`.
- Use only official primary sources; search snippets and secondary sources are discovery hints, never evidence.
- Do not submit forms, authenticate, bypass access controls, or download files.
- Read public PDF, CSV, and JSON artifacts only through read-only web tools.
- Do not change `src/`, production configuration, source registries, or existing tests.
- Do not push, open a pull request, or merge.
- Every source observation uses access date `2026-08-30` and one of the five allowed `candidateStatus` values.
- Missing evidence is recorded honestly without a fabricated `observedValue`.

## Staging contract

Each `data/research/staging/demo-10x5/<country-code>.json` object contains:

```json
{
  "schemaVersion": "demo-10x5-country-staging@1",
  "country": {
    "countryCode": "SI",
    "officialName": "Republic of Slovenia",
    "isoCode": "SI",
    "accessedAt": "2026-08-30",
    "authorities": []
  },
  "cities": []
}
```

`country.authorities` contains official name/ISO, government portal, statistics, police/safety, cadastral/geographic, regulator, and operator records. Every city object contains `cityId`, `seedName`, `officialIdentity`, `population`, `coordinates`, and exactly four keys under `facts`: `safety`, `longTermRent`, `urbanTransit`, and `fixedBroadband`.

Every authority, identity, population, coordinate, and fact record contains all applicable fields from the request: `publisher`, `publisherType`, `authorityRootUrl`, `sourceUrl`, `finalUrl`, `factKey`, `cityId`, `officialStatus`, `period`, `geographicScope`, `format`, `language`, `exactLocator`, `accessedAt`, `candidateStatus`, `limitations`, `rejectedAlternatives`, and `notes`. `observedValue` is omitted unless a value is unambiguous. Unknown scalar fields use JSON `null`; explanatory arrays are never empty when the status is not `official_candidate_found`.

Each stream appends one compact JSON object per query or rejected candidate to `data/research/staging/demo-10x5/logs/<stream>.ndjson`, including `accessedAt`, `stream`, `countryCode`, optional `cityId`, `factKey`, `queryOrUrl`, `outcome`, and `notes`.

---

### Task 1: Research stream A — Slovenia and Portugal

**Files:**
- Create: `data/research/staging/demo-10x5/si.json`
- Create: `data/research/staging/demo-10x5/pt.json`
- Create: `data/research/staging/demo-10x5/logs/si-pt.ndjson`

**Interfaces:**
- Consumes: the fixed SI/PT seed entries and the committed Slovenia Stage B materials.
- Produces: two country objects conforming to the staging contract and one append-only stream log.

- [ ] Read all committed Slovenia Stage B material before searching and reuse it where it already supports a record.
- [ ] Research official country authorities and domain-ownership evidence for SI and PT.
- [ ] Research identity, population, geometry/coordinates, and the four required facts for all ten cities.
- [ ] Record missing or blocked evidence with an allowed non-success status and a concrete limitation.
- [ ] Validate both JSON files and confirm five ordered cities per country.

### Task 2: Research stream B — Spain and Germany

**Files:**
- Create: `data/research/staging/demo-10x5/es.json`
- Create: `data/research/staging/demo-10x5/de.json`
- Create: `data/research/staging/demo-10x5/logs/es-de.ndjson`

**Interfaces:**
- Consumes: the fixed ES/DE seed entries and the staging contract.
- Produces: two country objects and one append-only stream log.

- [ ] Research official country authorities and domain-ownership evidence for ES and DE.
- [ ] Research identity, population, geometry/coordinates, and the four required facts for all ten cities.
- [ ] Record missing or blocked evidence with an allowed non-success status and a concrete limitation.
- [ ] Validate both JSON files and confirm five ordered cities per country.

### Task 3: Research stream C — Serbia and Montenegro

**Files:**
- Create: `data/research/staging/demo-10x5/rs.json`
- Create: `data/research/staging/demo-10x5/me.json`
- Create: `data/research/staging/demo-10x5/logs/rs-me.ndjson`

**Interfaces:**
- Consumes: the fixed RS/ME seed entries and the staging contract.
- Produces: two country objects and one append-only stream log.

- [ ] Research official country authorities and domain-ownership evidence for RS and ME.
- [ ] Research identity, population, geometry/coordinates, and the four required facts for all ten cities.
- [ ] Record missing or blocked evidence with an allowed non-success status and a concrete limitation.
- [ ] Validate both JSON files and confirm five ordered cities per country.

### Task 4: Research stream D — Georgia and Türkiye

**Files:**
- Create: `data/research/staging/demo-10x5/ge.json`
- Create: `data/research/staging/demo-10x5/tr.json`
- Create: `data/research/staging/demo-10x5/logs/ge-tr.ndjson`

**Interfaces:**
- Consumes: the fixed GE/TR seed entries and the staging contract.
- Produces: two country objects and one append-only stream log.

- [ ] Research official country authorities and domain-ownership evidence for GE and TR.
- [ ] Research identity, population, geometry/coordinates, and the four required facts for all ten cities.
- [ ] Record missing or blocked evidence with an allowed non-success status and a concrete limitation.
- [ ] Validate both JSON files and confirm five ordered cities per country.

### Task 5: Research stream E — United Arab Emirates and Thailand

**Files:**
- Create: `data/research/staging/demo-10x5/ae.json`
- Create: `data/research/staging/demo-10x5/th.json`
- Create: `data/research/staging/demo-10x5/logs/ae-th.ndjson`

**Interfaces:**
- Consumes: the fixed AE/TH seed entries and the staging contract.
- Produces: two country objects and one append-only stream log.

- [ ] Research official country authorities and domain-ownership evidence for AE and TH.
- [ ] Research identity, population, geometry/coordinates, and the four required facts for all ten cities.
- [ ] Record missing or blocked evidence with an allowed non-success status and a concrete limitation.
- [ ] Validate both JSON files and confirm five ordered cities per country.

### Task 6: Coordinator assembly and acceptance

**Files:**
- Create: `data/research/staging/demo-10x5/index.json`
- Create: `data/research/staging/demo-10x5/search-log.ndjson`
- Create: `docs/research/demo-10x5-source-summary.md`

**Interfaces:**
- Consumes: the ten country JSON files and five stream logs.
- Produces: deterministic 10x5 index, combined journal, coverage counts, unavailable-site inventory, parser-format inventory, import-ready inventory, and remaining-yellow inventory.

- [ ] Review every stream output for official-source integrity and schema consistency.
- [ ] Assemble `index.json` in the exact seed order and assert ten countries and fifty cities.
- [ ] Concatenate stream logs in stream order without rewriting their entries.
- [ ] Count full, partial, and zero city coverage using the four city facts: full means four official candidates, partial means one to three, and zero means none.
- [ ] Write the human summary with unavailable sites, required parser formats, import-ready records, and yellow gaps.
- [ ] Parse all JSON and NDJSON, scan for forbidden statuses and placeholders, and confirm no production files changed.
- [ ] Run repository verification, inspect the final diff, and commit the research artifacts locally.
