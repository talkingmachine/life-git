# Demo Relocation Seed Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:subagent-driven-development` and strict focused TDD. This plan deliberately creates only a static, non-evidentiary research seed; it does not install a country/city package or run live research.

**Goal:** Add a versioned subjective demo selection of 10 relocation countries and exactly 5 recognizable cities per country, then deterministically project the 50 targets into ten immutable research batches of five.

**Architecture:** Keep the demo selection in a new pure `src/research` seed module, separate from `CityCatalogRevision`, installed place/city packages, manifests, Evidence, Knowledge and Frontier. The seed owns only stable identifiers, Russian/English display labels, source-locale hints and a selection role. A second pure module projects the seed into non-authoritative jobs. No URL, official fact, verdict, color, source binding or persistence authority enters this milestone.

**Tech Stack:** TypeScript 6, frozen closed DTOs, Vitest 4, Git.

**Spec:** `docs/superpowers/specs/2026-08-28-local-codex-llm-source-recovery-design.md`, Delivery sequence B.

## Global constraints

- Use Git/GitHub only. Never use Arc, Arcanum, Tracker or other Yandex infrastructure.
- Do not touch `.superpowers/brainstorm`.
- The selection is a subjective demo for a Russian-speaking audience, not a top-10 claim, recommendation, eligibility result or ranking.
- This milestone is static and offline. Do not use a browser, HTTP, Codex/model execution, native web search or live official sources.
- The seed is not `CityCatalogRevision`, `InstalledPlacePackage`, `VerifiedCityCatalogBundle`, an installed package, a manifest, Evidence, Knowledge, Frontier or a source binding. Do not import those authorities into the seed or planner.
- Do not add URLs, coordinates, source claims, fact values, colors, verdicts, package IDs, manifest IDs, evidence IDs, revision IDs, timestamps or mutable status fields.
- `SI` remains only a demo research target here. Existing verified/installed Slovenia authority is unchanged and cannot be replaced or bypassed by this seed.
- Exactly 10 countries are present. Each has exactly 5 cities, with the national capital first and four subjective relocation cities after it.
- The planner emits exactly 50 globally unique city jobs and exactly 10 batches of 5. Batch size is code-owned and has no caller override.
- All exported DTOs and every nested object/array are module-owned and recursively frozen. Order is literal and never locale-sorted, randomized or derived from object enumeration.
- Add only focused RED tests for this real milestone. Do not expand existing country/city package matrices.

## Approved subjective selection

The order is stable presentation/research order, not rank.

| ISO | Country (`ru / en`) | Capital first | Four relocation cities |
| --- | --- | --- | --- |
| `SI` | Словения / Slovenia | Любляна / Ljubljana | Марибор / Maribor; Копер / Koper; Целе / Celje; Крань / Kranj |
| `PT` | Португалия / Portugal | Лиссабон / Lisbon | Порту / Porto; Брага / Braga; Коимбра / Coimbra; Фуншал / Funchal |
| `ES` | Испания / Spain | Мадрид / Madrid | Барселона / Barcelona; Валенсия / Valencia; Аликанте / Alicante; Малага / Malaga |
| `DE` | Германия / Germany | Берлин / Berlin | Мюнхен / Munich; Гамбург / Hamburg; Франкфурт-на-Майне / Frankfurt am Main; Дюссельдорф / Dusseldorf |
| `RS` | Сербия / Serbia | Белград / Belgrade | Нови-Сад / Novi Sad; Ниш / Nis; Суботица / Subotica; Крагуевац / Kragujevac |
| `ME` | Черногория / Montenegro | Подгорица / Podgorica | Будва / Budva; Бар / Bar; Херцег-Нови / Herceg Novi; Тиват / Tivat |
| `GE` | Грузия / Georgia | Тбилиси / Tbilisi | Батуми / Batumi; Кутаиси / Kutaisi; Рустави / Rustavi; Поти / Poti |
| `TR` | Турция / Türkiye | Анкара / Ankara | Стамбул / Istanbul; Измир / Izmir; Анталья / Antalya; Мерсин / Mersin |
| `AE` | ОАЭ / United Arab Emirates | Абу-Даби / Abu Dhabi | Дубай / Dubai; Шарджа / Sharjah; Аджман / Ajman; Рас-эль-Хайма / Ras Al Khaimah |
| `TH` | Таиланд / Thailand | Бангкок / Bangkok | Чиангмай / Chiang Mai; Пхукет / Phuket City; Паттайя / Pattaya; Хуахин / Hua Hin |

Code-owned source locale hints:

```text
SI sl,en    PT pt,en    ES es,en    DE de,en    RS sr,en
ME cnr,sr,en    GE ka,en    TR tr,en    AE ar,en    TH th,en
```

These are discovery hints only. They do not certify that a page, translation or official source exists.

Exact ASCII city IDs in the same order:

```text
SI ljubljana,maribor,koper,celje,kranj
PT lisbon,porto,braga,coimbra,funchal
ES madrid,barcelona,valencia,alicante,malaga
DE berlin,munich,hamburg,frankfurt-am-main,dusseldorf
RS belgrade,novi-sad,nis,subotica,kragujevac
ME podgorica,budva,bar,herceg-novi,tivat
GE tbilisi,batumi,kutaisi,rustavi,poti
TR ankara,istanbul,izmir,antalya,mersin
AE abu-dhabi,dubai,sharjah,ajman,ras-al-khaimah
TH bangkok,chiang-mai,phuket-city,pattaya,hua-hin
```

## File and interface map

| File | Responsibility |
| --- | --- |
| `src/research/demo-relocation-seed.ts` | Exact 10×5 literal, closed DTO vocabulary, module-owned recursive freezing and read-only seed access. |
| `src/research/demo-city-research-plan.ts` | Pure 50-job projection and exact ten-by-five batch composition. |
| `tests/research/demo-relocation-seed.test.ts` | Exact membership/order/schema/ownership and non-authority boundary. |
| `tests/research/demo-city-research-plan.test.ts` | Job identity, count/order/batching/freeze and repeatability. |
| `docs/product/demo-relocation-catalog.md` | Human-readable disclaimer and exact demo list for the owner walkthrough. |

---

### Task 1: Add the closed, non-evidentiary 10×5 seed

**Files:**

- Create: `src/research/demo-relocation-seed.ts`
- Create: `tests/research/demo-relocation-seed.test.ts`

**Produces:**

```ts
export type DemoLocalizedName = Readonly<{
  ru: string;
  en: string;
}>;

export type DemoCitySeed = Readonly<{
  cityId: string;
  name: DemoLocalizedName;
  selectionRole: "national_capital" | "relocation_city";
}>;

export type DemoCountrySeed = Readonly<{
  countryCode: string;
  name: DemoLocalizedName;
  localeHints: readonly string[];
  cities: readonly [DemoCitySeed, DemoCitySeed, DemoCitySeed, DemoCitySeed, DemoCitySeed];
}>;

export type DemoRelocationSeed = Readonly<{
  schemaVersion: "demo-relocation-seed@1";
  purpose: "subjective_ru_speaking_non_evidentiary_research_seed";
  countries: readonly [
    DemoCountrySeed, DemoCountrySeed, DemoCountrySeed, DemoCountrySeed, DemoCountrySeed,
    DemoCountrySeed, DemoCountrySeed, DemoCountrySeed, DemoCountrySeed, DemoCountrySeed,
  ];
}>;

export function readDemoRelocationSeed(): DemoRelocationSeed;
```

- [ ] **Step 1: Write the focused RED contract**

Pin exact root/country/city key sets and the complete ordered 10×5 membership. Assert:

- schema and purpose literals;
- exact ISO order `SI,PT,ES,DE,RS,ME,GE,TR,AE,TH`;
- exact five city IDs and names for every country;
- first city is the only `national_capital` per country;
- all country codes, city IDs, localized labels and locale hints are nonempty, bounded and unique where required;
- exactly 50 globally unique `(countryCode, cityId)` targets;
- recursive freeze at every level and failed caller mutation cannot affect a later read;
- serialized keys contain none of `url`, `source`, `fact`, `color`, `verdict`, `package`, `manifest`, `evidence`, `knowledge`, `frontier`, `revision` or `status`;
- the module source has no imports from Application, Infrastructure, installed package, city catalog, Evidence, Knowledge or Frontier code.

Run:

```bash
pnpm exec vitest run tests/research/demo-relocation-seed.test.ts
```

Expected RED: module/export not found.

- [ ] **Step 2: Implement the minimum frozen literal**

Use private literal builders only to remove mechanical duplication. Validate invariants once at module initialization, recursively freeze owned objects, and publish no mutable backing collection. No generic external parser or configurable input is needed because the seed is code-owned.

- [ ] **Step 3: Run focused GREEN and commit**

```bash
pnpm exec vitest run tests/research/demo-relocation-seed.test.ts
pnpm typecheck
pnpm lint
git diff --check
git commit -m "feat: add demo relocation seed"
```

---

### Task 2: Project 50 immutable research jobs in ten batches

**Files:**

- Create: `src/research/demo-city-research-plan.ts`
- Create: `tests/research/demo-city-research-plan.test.ts`

**Consumes:** `readDemoRelocationSeed()` only.

**Produces:**

```ts
export type DemoCityResearchJob = Readonly<{
  schemaVersion: "demo-city-research-job@1";
  jobId: string;
  countryCode: string;
  cityId: string;
  countryName: DemoLocalizedName;
  cityName: DemoLocalizedName;
  localeHints: readonly string[];
  selectionRole: "national_capital" | "relocation_city";
  authority: "none_demo_seed_only";
}>;

export type DemoCityResearchBatch = Readonly<{
  schemaVersion: "demo-city-research-batch@1";
  batchId: string;
  jobs: readonly [
    DemoCityResearchJob, DemoCityResearchJob, DemoCityResearchJob,
    DemoCityResearchJob, DemoCityResearchJob,
  ];
}>;

export function planDemoCityResearchJobs(): readonly DemoCityResearchJob[];
export function planDemoCityResearchBatches(): readonly DemoCityResearchBatch[];
```

- [ ] **Step 1: Write the focused RED planner tests**

Assert exact job IDs `demo-city-research:<country-lower>:<city-id>`, exact flatten order, 50 unique jobs, copied/frozen names and locale hints, and `authority:"none_demo_seed_only"`. Assert ten batch IDs `demo-city-research-batch:01` through `:10`, exactly five jobs per batch, and that flattening batches is canonical-equal to the job plan. Repeated calls must be canonical-equal and immune to attempted caller mutation.

The planner takes no caller input, performs no I/O and exposes no dynamic batch size.

Run:

```bash
pnpm exec vitest run tests/research/demo-city-research-plan.test.ts
```

Expected RED: planner module/export not found.

- [ ] **Step 2: Implement the pure projection**

Flatten only the literal country/city order. Preserve each country boundary as one five-job batch. Build and freeze fresh owned DTOs; do not cast the seed into another authority type and do not import installed package or persistence code.

- [ ] **Step 3: Run focused GREEN and commit**

```bash
pnpm exec vitest run tests/research/demo-relocation-seed.test.ts tests/research/demo-city-research-plan.test.ts
pnpm typecheck
pnpm lint
git diff --check
git commit -m "feat: plan demo city research"
```

---

### Task 3: Document and close the static catalog milestone

**Files:**

- Create: `docs/product/demo-relocation-catalog.md`
- Modify only if required by review: the two focused test files above.

- [ ] **Step 1: Add the owner-facing catalog note**

State prominently that the list is subjective, non-evidentiary and not a recommendation/ranking. Render the exact 10×5 selection and explain that URLs, official facts, coordinates, colors and eligibility appear only after the later official research/recovery pipeline.

- [ ] **Step 2: Verify the milestone**

```bash
pnpm exec vitest run tests/research/demo-relocation-seed.test.ts tests/research/demo-city-research-plan.test.ts
pnpm test
pnpm typecheck
pnpm lint
git diff --check
git status --short
```

- [ ] **Step 3: Review and checkpoint**

One implementation reviewer checks exact list/order/count and the absence of fake authority. A second reviewer is used only for the integrity/security boundary: recursive ownership, no installed-package bypass, no source/fact/URL fields and exact 50/ten-by-five batching. Critical blocks. Important that does not affect this static vertical goes to the hardening backlog.

Commit documentation after review:

```bash
git commit -m "docs: describe demo relocation catalog"
```

## Exit criteria

- Exact code-owned subjective 10×5 seed exists and is recursively frozen.
- Exact 50 immutable research jobs and ten five-job batches are reproducible.
- No live call, URL, official fact, Evidence, Knowledge, Frontier, installed package, manifest or persistence mutation was introduced.
- Full offline suite, typecheck, lint and diff check pass.
- Implementation and integrity reviews return no blocking finding.
- The next plan may consume the 50 jobs to research official country/city sources and durable recovery; this seed alone never changes a user-visible verdict.
