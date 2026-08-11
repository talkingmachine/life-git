# Slovenia Official Source Shape Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the unreleased synthetic Slovenia evidence grammar with deterministic parsing of the current official GOV.SI, PISRS, SiStat, and ESS response shapes so the VS-2 live gate can honestly verify all nine country claims.

**Architecture:** Keep the existing modular-monolith Evidence path. `SloveniaSourceAdapter` derives a fixed official machine request from each validated discovery slot, while the pure Slovenia parser independently revalidates the sealed registry, details, HTML, PxWeb, and JSON-stat2 artifacts during both current research and offline replay. No provider framework, alternate parser, LLM extraction, cache, or storage schema is added.

**Tech Stack:** Node 24, TypeScript 6.0.3, Zod 4.4.3, Cheerio 1.2.0, Decimal.js 10.6.0, Vitest 4.1.10, existing `RequestStep`/Evidence/SQLite ports.

**Normative design:** [`Slovenia Official Source Shape Repair`](../specs/2026-08-11-slovenia-official-source-shape-design.md).

**Recorded official field map:** [`Slovenia Official Source Field Map`](../specs/2026-08-11-slovenia-official-source-field-map.md). Compact fixtures are reduced from these recorded paths, IDs, native excerpts, response hashes, and request provenance; implementers must not invent substitute source text or semantic control fields.

## Global Constraints

- Slovenia remains the only installed VS-2 country. The model proposes no more than six source candidates and never creates claims.
- Canonical success is exactly eleven captures: route `3`, income `4`, companion `3`, CBR `1`. Plan limits are `{concurrency:3,maxCaptures:11,deadlineMs:60_000}`.
- Human candidate pages remain the primary bundle navigation. Artifact evidence uses the exact official API request and final response URLs that produced the sealed bytes.
- PISRS law registries must have status `{id:156,naziv:"Veljaven predpis"}`. A salary publication must have status `{id:153,naziv:"Objavljen akt brez datuma začetka veljavnosti"}`.
- PISRS currently exposes one non-paginated record with no independent NPB total. Accept its returned listing only after exact endpoint/provenance validation and a unique `Osnovni`, `NPB 1`, ..., `NPB N` sequence with no internal gap or duplicate. Array order never selects the maximum. Do not claim to detect an authority-side tail omission without a published total; partial HTTP content, malformed JSON, or any newly introduced pagination/total contract fails closed.
- Route applicability comes from Article 51.a `navezavaNPB` date `2025-11-21`. Current Articles 32–33 expose no target-level effective date; their source period is the selected identity, for example `ZAKO6655:NPB 8`, never the old invented `2026-01-01`.
- Current official route text explicitly excludes EU and EEA citizens. `citizenship_applicability.explicitNationalityExclusions` becomes exactly `["EU","EEA"]`; unsupported `Switzerland` is removed.
- Income is always derived. Production contains no accepted salary/SOP/NPB ID. PISRS and the latest SiStat `Net earnings` coordinate at or before `assessmentAt` must agree exactly.
- Installed versions become `vs2-slovenia@2`, `vs2-si-evidence@2`, `si-route@2`, `si-income@2`, and `si-companion@2`. CBR remains `cbr-eur@1`; dossier remains `si-dossier@1`; VS-1 remains byte-compatible.
- Slovenia `@1` is rejected rather than replayed. The branch is unreleased, so no dual parser or migration path is permitted.
- Use only representative mutations listed in this plan. Do not add a source matrix, generic extractor, translation layer, retry framework, second eval pipeline, or browser automation.
- Every production behavior change follows RED → observed expected failure → minimal GREEN → focused regression. Preserve the unrelated untracked `.superpowers/brainstorm/12369-1786346924/` directory.

## File Map

```text
src/research/slovenia-plan.ts                         installed plan/version/limits
src/research/parsers/slovenia.ts                     source-specific wire decoders and claims
src/infrastructure/sources/slovenia-source-adapter.ts deterministic official capture recipe
src/research/dossier.ts                              installed validator publication guard
src/infrastructure/sqlite/{evidence,dossier}-store.ts installed sealed-version guards
src/application/{replay-evidence,cold-start}.ts       replay and current-run rules guards
src/decision/cold-start-assessment.ts                 comparator lineage guard
tests/research/cold-start.test.ts                     source/capture/parser behavior
tests/integration/cold-start.test.ts                  publication/replay/comparator regression
tests/sources/fixtures/slovenia/*                     small official-shaped bytes
docs/superpowers/plans/2026-08-11-vs-2-honest-cold-start.md  capture-limit handoff
```

No production file is created. `src/research/parsers/slovenia.ts` remains the only Slovenia parser module; its two exported wire decoders are the narrow bridge used by the Infrastructure adapter and offline validator.

---

### Task 1: Advance the unreleased Slovenia evidence contract to `@2`

**Files:**
- Modify: `tests/research/cold-start.test.ts:1080-1110`
- Modify: `tests/integration/cold-start.test.ts:57-75,140-155,220-305,630-670,840-875,1985-2040`
- Modify: `src/research/slovenia-plan.ts:58-85`
- Modify: `src/research/parsers/slovenia.ts:200-690` (validator-version literals only)
- Modify: `src/research/dossier.ts:75-90,240-290`
- Modify: `src/infrastructure/sqlite/dossier-store.ts:50-60,310-325`
- Modify: `src/infrastructure/sqlite/evidence-store.ts:100-120`
- Modify: `src/application/replay-evidence.ts:148-190`
- Modify: `src/application/cold-start.ts:224-248`
- Modify: `src/decision/cold-start-assessment.ts:245-260`

**Interfaces:**
- Consumes: existing `createSloveniaPlan`, `replayEvidenceByRules`, `buildCountryDossier`, and `assessColdStart` signatures unchanged.
- Produces: one installed version tuple `{plan:"vs2-slovenia@2",rules:"vs2-si-evidence@2",route:"si-route@2",income:"si-income@2",companion:"si-companion@2",cbr:"cbr-eur@1",dossier:"si-dossier@1"}` and capture ceiling `11`.

- [ ] **Step 1: Write the failing installed-version tests.** Change the focused plan expectation and add a replay rejection for the unreleased rules version:

```ts
test("installs only the Slovenia v2 evidence contract", () => {
  const { plan } = createSloveniaResearch({ candidates: SLOVENIA_CANDIDATES });
  expect(plan).toMatchObject({
    id: "vs2-slovenia@2",
    parserVersions: {
      "si-digital-nomad-route": "si-route@2",
      "si-income-threshold": "si-income@2",
      "si-companion-employment": "si-companion@2",
      "cbr-eur": "cbr-eur@1",
    },
    rulesVersion: "vs2-si-evidence@2",
    limits: { concurrency: 3, maxCaptures: 11, deadlineMs: 60_000 },
  });
});

test("rejects the unreleased Slovenia v1 rules version", async () => {
  const fixture = await replayableFixture({ rulesVersion: "vs2-si-evidence@1" });
  const store = {
    loadVerifiedBundle: async () => ({
      snapshot: fixture.prepared.snapshot,
      entries: fixture.prepared.manifest.entries.map((entry) => ({
        sourceId: entry.sourceId,
        navigationUrl: entry.navigationUrl,
        resolvedEvidenceUrl: entry.resolvedEvidenceUrl,
        artifacts: entry.artifactIds.map((artifactId) =>
          fixture.artifacts.find((artifact) => artifact.artifactId === artifactId)!
        ),
      })),
    }),
  };
  await expect(replayEvidenceByRules(
    { snapshotId: fixture.prepared.snapshot.id, hmacKey: KEY },
    { store },
  )).rejects.toThrow("integrity_mismatch");
});
```

- [ ] **Step 2: Run the two RED tests.**

Run: `pnpm vitest run tests/research/cold-start.test.ts tests/integration/cold-start.test.ts -t "installs only the Slovenia v2|rejects the unreleased Slovenia v1"`

Expected: both tests FAIL because the plan and replay dispatcher still accept `@1` and the plan ceiling is `10`.

- [ ] **Step 3: Change the installed constants without changing behavior.** Use these exact values in every production guard:

```ts
return Object.freeze({
  id: "vs2-slovenia@2",
  scope: "VS-2 Slovenia cold start",
  sourceIds: Object.freeze([...SOURCE_IDS]),
  sourceNavigation: Object.freeze({ ...sourceNavigation }),
  parserVersions: Object.freeze({
    "si-digital-nomad-route": "si-route@2",
    "si-income-threshold": "si-income@2",
    "si-companion-employment": "si-companion@2",
    "cbr-eur": "cbr-eur@1",
  }),
  rulesVersion: "vs2-si-evidence@2",
  limits: Object.freeze({ concurrency: 3, maxCaptures: 11, deadlineMs: 60_000 }),
  validate: async (entry, assessmentAt) => validateSloveniaEntry(entry, assessmentAt),
  applyRules: applySloveniaRules,
});
```

Change only the equivalent installed literals in the three existing Slovenia `verifiedClaim` calls, dossier publication, sealed-evidence structure dispatch, plan-aware replay, current-run verification, and comparator lineage. Do not modify parser source-shape behavior yet, `src/research/run.ts`, `si-dossier@1`, or any VS-1 literal.

- [ ] **Step 4: Update fixture defaults and claim IDs mechanically.** In both focused test files, set route/income/companion validator expectations, `PARSER_VERSIONS`, `validatorFor`, `preparedFixture.rulesVersion`, replay fixtures, publication expectations, formula lineage, and source claim IDs to `@2`. Keep an explicit test-only `@1` fixture solely for the rejection test from Step 1.

- [ ] **Step 5: Run focused GREEN and VS-1 compatibility.**

Run: `pnpm vitest run tests/research/cold-start.test.ts tests/integration/cold-start.test.ts tests/integration/current-evidence.test.ts`

Expected: PASS; the fixed VS-1 replay fixture remains canonical-equal and the Slovenia `@1` rejection passes.

- [ ] **Step 6: Run static checks.**

Run: `pnpm typecheck && pnpm lint && git diff --check`

Expected: all commands exit `0`.

- [ ] **Step 7: Commit the version boundary.**

```bash
git add src/research/slovenia-plan.ts src/research/parsers/slovenia.ts src/research/dossier.ts src/infrastructure/sqlite/dossier-store.ts src/infrastructure/sqlite/evidence-store.ts src/application/replay-evidence.ts src/application/cold-start.ts src/decision/cold-start-assessment.ts tests/research/cold-start.test.ts tests/integration/cold-start.test.ts
git commit -m "refactor: advance Slovenia evidence contract"
```

---

### Task 2: Capture the real PISRS and SiStat machine responses

**Files:**
- Modify: `tests/research/cold-start.test.ts:990-1220`
- Modify: `src/research/parsers/slovenia.ts:1-180`
- Modify: `src/infrastructure/sources/slovenia-source-adapter.ts:1-330`
- Create: `tests/sources/fixtures/slovenia/ztuj2-registry.json`
- Create: `tests/sources/fixtures/slovenia/ztuj2-details.json`
- Create: `tests/sources/fixtures/slovenia/salary-registry.json`
- Create: `tests/sources/fixtures/slovenia/salary-details.json`
- Create: `tests/sources/fixtures/slovenia/zzsdt-registry.json`
- Create: `tests/sources/fixtures/slovenia/zzsdt-details.json`
- Modify: `tests/sources/fixtures/slovenia/sistat-metadata.json`
- Modify: `tests/sources/fixtures/slovenia/sistat-series.json`

**Interfaces:**
- Consumes: unchanged `OfficialSourcePort<SloveniaSourceId>` and `RequestStep<SloveniaSourceId>`.
- Produces:

```ts
export type PisrsRegistryIdentity =
  | { readonly kind: "record-id"; readonly value: "ZAKO5761" | "ZAKO6655" }
  | { readonly kind: "sop"; readonly value: string };

export interface PisrsSelectedNpb {
  readonly identity: string;
  readonly npbId: number;
  readonly ordinal: number;
  readonly label: "Osnovni" | `NPB ${number}`;
}

export function decodePisrsRegistry(
  artifact: ArtifactBytes,
  expected: PisrsRegistryIdentity,
  expectedRequestUrl: string,
): PisrsSelectedNpb | null;

export interface SiStatMetadata {
  readonly dimensions: readonly {
    readonly code: string;
    readonly values: readonly string[];
    readonly labels: readonly string[];
    readonly isTime: boolean;
  }[];
}

export function decodeSiStatMetadata(
  artifact: ArtifactBytes,
  expectedRequestUrl: string,
): SiStatMetadata | null;
export function encodeSiStatAllDimensionsQuery(metadata: SiStatMetadata): Uint8Array;
```

These are the only new exports. They are source-specific decoders, not provider interfaces. Although `ParserEntry.artifacts` is intentionally typed as `ArtifactBytes[]`, each decoder must first use one private runtime type guard to recover the sealed live provenance fields. The guard accepts only `origin:"live"`, response status `200`, the expected source/role, exact request method and URL, exact final response URL, and the expected absence/presence of a request body. It then narrows to the existing `LiveCapturedArtifact<SloveniaSourceId>`; it does not cast unvalidated objects. The SiStat series validator uses the same private guard and additionally requires the captured `bodySha256` to equal the freshly encoded all-dimensions query hash.

- [ ] **Step 1: Replace the adapter fixture bytes with mechanically reduced official-shaped JSON.** Use only the exact paths, status forms, native target entries, structural IDs, and provenance recorded in the official field map. Each fixture's adjacent test constant cites its role URL and recorded response SHA-256. Registry fixtures retain the complete observed `npbVerzije` identity arrays from the field map; they remain small, and this avoids pairing current article text with an invented historical maximum. The outer route registry shape is:

```json
{
  "data": {
    "evidencniPodatki": {
      "semafor": { "id": 156, "naziv": "Veljaven predpis" },
      "naslov": "Zakon o tujcih (ZTuj-2)",
      "zunanjiID": "ZAKO5761",
      "sop": "2011-01-2360",
      "objavljeno": "2011-06-27"
    },
    "besedilo": {
      "npbVerzije": [
        { "id": 10882829, "naziv": "Osnovni" },
        { "id": 11362997, "naziv": "NPB 1" },
        { "id": 11213128, "naziv": "NPB 2" },
        { "id": 298532110, "naziv": "NPB 20" }
      ]
    }
  },
  "error": null
}
```

The displayed array is a field-path sketch: the actual fixture includes every recorded intervening `NPB 3` through `NPB 19` identity from the field map so the sequence is gapless. Use the same complete recorded shape through `NPB 8` for `ZAKO6655`. The salary registry uses `sop`, `objavljeno`, the exact status `{id:153,naziv:"Objavljen akt brez datuma začetka veljavnosti"}`, and one recorded `Osnovni` version. PISRS details fixtures retain only the recorded target `data.besedilo[]` entries and immediately required boundary entries with `id`, native `vsebina`, `struktura`, and nullable `navezavaNPB`, plus the corresponding recorded `data.kazalo[]` identities. The source field map is authoritative for the exact target IDs and phrases; do not write translated or remembered substitutes.

Replace SiStat custom fields with the actual metadata dimensions `MESEC` and `PLAČE`. Use actual labels `MONTH`, `EARNINGS`, `Gross earnings`, `Net earnings`, `Average gross earnings for the last three months`, and `Average net earnings for the last three months`. JSON-stat2 uses `id:["MESEC","PLAČE"]`, aligned `size`, object category indexes, and row-major `value`.

- [ ] **Step 2: Write the failing eleven-capture test.** The request mock must return fixture bytes by role and record the derived requests:

```ts
expect(requests.map(({ sourceId, role, method }) => ({ sourceId, role, method }))).toEqual([
  { sourceId: "si-digital-nomad-route", role: "gov-route-page", method: "GET" },
  { sourceId: "si-digital-nomad-route", role: "ztuj2-registry", method: "GET" },
  { sourceId: "si-digital-nomad-route", role: "ztuj2-details", method: "GET" },
  { sourceId: "si-income-threshold", role: "salary-registry", method: "GET" },
  { sourceId: "si-income-threshold", role: "salary-details", method: "GET" },
  { sourceId: "si-income-threshold", role: "sistat-metadata", method: "GET" },
  { sourceId: "si-income-threshold", role: "sistat-series", method: "POST" },
  { sourceId: "si-companion-employment", role: "ess-companion-page", method: "GET" },
  { sourceId: "si-companion-employment", role: "zzsdt-registry", method: "GET" },
  { sourceId: "si-companion-employment", role: "zzsdt-details", method: "GET" },
  { sourceId: "cbr-eur", role: "official-document", method: "GET" },
]);
```

Also assert these exact machine URLs:

```ts
expect(requests.find(({ role }) => role === "ztuj2-registry")?.url)
  .toBe("https://pisrs.si/api/rezultat/zbirka/id/ZAKO5761");
expect(requests.find(({ role }) => role === "ztuj2-details")?.url)
  .toBe("https://pisrs.si/api/rezultat/neuradno-precisceno-besedilo/298532110/details");
expect(requests.find(({ role }) => role === "sistat-metadata")?.url)
  .toBe("https://pxweb.stat.si/SiStatData/api/v1/en/Data/H285S.px");
```

The bundle `sourceNavigation` assertions remain the discovered human GOV.SI, PISRS publication, and ESS pages.

- [ ] **Step 3: Write the representative stop-before-downstream and provenance tests.** Mutate the registry to omit internal `NPB 1`; expect `navigation_mismatch`, partial artifacts through the registry, and zero details request. Mutate metadata to duplicate `MESEC`; expect `navigation_mismatch`, partial artifacts through metadata, and zero series request. Separately mutate one registry artifact's request method, request URL, and final response URL; each must be rejected even when the JSON bytes are valid. Do not add a tail-omission test: the official endpoint exposes no independent total, and such a test would assert a capability the source does not provide.

- [ ] **Step 4: Run RED.**

Run: `pnpm vitest run tests/research/cold-start.test.ts -t "Slovenia installed research plan"`

Expected: FAIL because the adapter still requests human PISRS/SiStat pages, emits eight roles, and has no registry decoder.

- [ ] **Step 5: Implement the strict PISRS registry decoder.** Parse JSON with Zod passthrough objects around these required fields:

```ts
const pisrsRegistrySchema = z.object({
  data: z.object({
    evidencniPodatki: z.object({
      semafor: z.object({ id: z.number().int(), naziv: z.string() }).passthrough(),
      naslov: z.string(),
      zunanjiID: z.string(),
      sop: z.string(),
      objavljeno: z.string(),
    }).passthrough(),
    besedilo: z.object({
      npbVerzije: z.array(z.object({
        id: z.number().int().positive(),
        naziv: z.string(),
      }).passthrough()).min(1),
    }).passthrough(),
  }).passthrough(),
  error: z.unknown().nullable(),
}).passthrough();
```

`decodePisrsRegistry` first verifies live provenance: exact role derived from the expected identity, GET, exact expected API request URL, identical final response URL, status `200`, no request-body hash, and `application/json`. It then verifies `error === null`, exact identity, exact status for the identity kind, unique IDs, one `Osnovni`, and a gapless unique ordinal set. It returns the maximum ordinal without relying on array order. It returns `null` for any ambiguity, partial transport representation, or recognized pagination/total field that this contract does not support. This proves the integrity and internal sequence of the single official response, not an unpublished authority-side total.

- [ ] **Step 6: Implement the SiStat metadata bridge.** First require live provenance for GET, the exact metadata request/final URL, status `200`, no body hash, and JSON media type. Then require unique dimensions, `values.length === valueTexts.length`, unique category values, and exactly one `time:true`. Encode this exact body with `TextEncoder` and no alternate query form:

```ts
return new TextEncoder().encode(JSON.stringify({
  query: metadata.dimensions.map(({ code }) => ({
    code,
    selection: { filter: "all", values: ["*"] },
  })),
  response: { format: "json-stat2" },
}));
```

- [ ] **Step 7: Implement the three capture recipes.** Validate candidate path identity before the first request. Accept only PISRS human paths `/Pis.web/pregledPredpisa` or `/pregledPredpisa` with one exact `id`/`sop`; accept the SiStat candidate only when the exact host and terminal dataset name are `H285S.px`. Request registries as `application/json`, pass the exact derived registry URL into the shared decoder, derive the details URL from its numeric ID, and then request details as `application/json`. Use the fixed SiStat API endpoint and the encoded all-dimension POST. Preserve existing partial-artifact error behavior and CBR delegation. A correct-shaped response returned under a different request/final URL must stop before the downstream request.

- [ ] **Step 8: Run focused GREEN.**

Run: `pnpm vitest run tests/research/cold-start.test.ts -t "Slovenia installed research plan"`

Expected: PASS with eleven canonical requests, correct POST body, and both stop-before-downstream cases.

- [ ] **Step 9: Run source boundary regressions.**

Run: `pnpm vitest run tests/research/cold-start.test.ts tests/sources/gateway.test.ts`

Expected: PASS; redirect host/media/size behavior remains unchanged.

- [ ] **Step 10: Commit the capture topology.**

```bash
git add src/research/parsers/slovenia.ts src/infrastructure/sources/slovenia-source-adapter.ts tests/research/cold-start.test.ts tests/sources/fixtures/slovenia/ztuj2-registry.json tests/sources/fixtures/slovenia/ztuj2-details.json tests/sources/fixtures/slovenia/salary-registry.json tests/sources/fixtures/slovenia/salary-details.json tests/sources/fixtures/slovenia/zzsdt-registry.json tests/sources/fixtures/slovenia/zzsdt-details.json tests/sources/fixtures/slovenia/sistat-metadata.json tests/sources/fixtures/slovenia/sistat-series.json
git commit -m "feat: capture official Slovenia machine sources"
```

---

### Task 3: Validate the official route and companion evidence

**Files:**
- Modify: `tests/sources/fixtures/slovenia/route-gov.html`
- Modify: `tests/sources/fixtures/slovenia/companion-ess.html`
- Delete: `tests/sources/fixtures/slovenia/ztuj2.html`
- Delete: `tests/sources/fixtures/slovenia/zzsdt.html`
- Modify: `tests/research/cold-start.test.ts:1220-1490,1750-1985`
- Modify: `tests/integration/cold-start.test.ts:1810-1945`
- Modify: `src/research/parsers/slovenia.ts:180-430,560-675`

**Interfaces:**
- Consumes: `decodePisrsRegistry`, the existing `ParserEntry<SloveniaSourceId>`, `anchor`, and `verifiedClaim` construction.
- Produces: seven atomic route claims at `si-route@2` and one conditional companion-employment claim at `si-companion@2`; `validateSloveniaEntry` signature remains unchanged.

- [ ] **Step 1: Replace the HTML fixtures with mechanically extracted official text.** Copy the normalized title/date and only the current target paragraphs identified in the official field map. GOV.SI retains the recorded title `Temporary residence permit for digital nomads`, date `21. 11. 2025`, and the five current paragraphs covering non-EU/EEA scope, foreign employment/civil contract/self-employment, no Slovenian labour market, one-year/nonextendable/six-month reapplication, twice-net-salary funds, and immediate family reunion. ESS retains the recorded Slovene title and target paragraphs containing `informativnega lista`, `Na Zavodu preverimo trg dela`, and the no-suitable-candidate written notice plus `informativni list`. Do not synthesize prose between those extracted paragraphs.

- [ ] **Step 2: Write the route RED tests.** Update `routeEntry()` to three roles and assert:

```ts
expect(result.claims.map((claim) => "claimKind" in claim ? claim.claimKind : "fx")).toEqual([
  "route_basis",
  "citizenship_applicability",
  "remote_work_relations",
  "qualification",
  "companion_entry",
  "duration",
  "general_statutory_prerequisites",
]);
expect(result.claims.find((claim) =>
  "claimKind" in claim && claim.claimKind === "citizenship_applicability"
)?.value).toEqual({
  eligibleCategory: "third_country_national",
  explicitNationalityExclusions: ["EU", "EEA"],
});
```

Add one table with only these representative mutations: missing `NPB 1`, duplicate `NPB 2`, details request URL bound to the wrong selected ID, duplicate/missing Article 51.a, changed passport requirement, and explicit qualification text inserted inside Article 51.a. Every mutation returns `{ok:false,kind:"semantic_mismatch"}` and no partial claims.

- [ ] **Step 3: Write the companion RED tests.** Update `companionEntry()` to three roles. Assert one conditional claim whose source period is derived from the recorded fixture maximum (`ZAKO6655:NPB 8`). Add only three mutations: Article 33 precedes Article 32, the information-sheet paragraph is removed, and ESS says no labour-market check. Each rejects the whole bundle.

- [ ] **Step 4: Write the anchor stability RED test.** Insert one unrelated `opomba` item outside the target article in the details array and one unrelated HTML paragraph. Assert every locator and excerpt hash remains equal. Change one matched Article 33 sentence and assert the bundle rejects rather than silently changing the claim.

- [ ] **Step 5: Run RED.**

Run: `pnpm vitest run tests/research/cold-start.test.ts -t "Slovenia route validator|Slovenia companion employment validator"`

Expected: FAIL because the validators still require synthetic HTML control lines and old two-artifact roles.

- [ ] **Step 6: Implement native PISRS details parsing.** Require this real shape and tolerate unrelated additional fields:

```ts
const pisrsDetailsSchema = z.object({
  data: z.object({
    besedilo: z.array(z.object({
      id: z.number().int().positive(),
      vsebina: z.string(),
      struktura: z.string(),
      navezavaNPB: z.object({ vsebina: z.string() }).passthrough().nullable(),
    }).passthrough()).min(1),
    kazalo: z.array(z.object({
      idStrukturniElement: z.number().int().positive(),
      idStrukturniElementPostavljeno: z.number().int().positive(),
      kazaloIme: z.string(),
      struktura: z.string(),
    }).passthrough()),
  }).passthrough(),
  error: z.unknown().nullable(),
}).passthrough();
```

Use the private provenance guard to require the exact role, GET request URL, final response URL, status, and media type for the selected `/neuradno-precisceno-besedilo/{npbId}/details` URL. A unique article starts at one normalized item with `struktura === "clen"` and exact heading; it ends immediately before the next item whose structure is `clen` and whose normalized text matches an article heading. Require the corresponding unique `kazalo` entry to bind the same start/end structural IDs.

- [ ] **Step 7: Implement the route semantics atomically.** Match the exact native GOV.SI and Article 51.a/55 text, not CSS. Parse Article 51.a `Datum začetka uporabe: 21.11.2025`, require it at or before `assessmentAt`, and use `2025-11-21` as the route source period. Map the three proven relations in order to `foreign_employer`, `foreign_clients`, `own_foreign_business`; keep the published claim value order `foreign_employer`, `own_foreign_business`, `foreign_clients`. Build companion-entry evidence from GOV.SI only. Prove qualification absence by checking the complete bounded Article 51.a after all positive prerequisites and rejecting `diploma`, `degree`, `qualification`, or `izobraz` text.

- [ ] **Step 8: Implement the companion semantics narrowly.** Require current registry status, selected details, unique Articles 32 and 33, ESS information-sheet procedure, Article 33 labour-market check, written notice, and conditional card/access language. Emit no automatic or foreign-company-remote claim. When the selected article has no `navezavaNPB`, set source period to `${identity}:${label}`; do not synthesize a date.

- [ ] **Step 9: Replace anchors with native excerpts.** Hash only normalized matched GOV/ESS lines or matched PISRS `vsebina` items. Locators name source/version/article/paragraph, for example `PISRS ZAKO5761 NPB 20 > 51.a člen > passport prerequisite`; they do not contain array indexes or CSS classes.

- [ ] **Step 10: Update the integration replay fixture for the new route/companion roles and values.** Keep the income fixture on its existing parser until Task 4. Change the fixture citizenship exclusions to `["EU","EEA"]` and companion source period to the selected fixture NPB identity. Preserve dossier schema and comparator expectations.

- [ ] **Step 11: Run GREEN and regression.**

Run: `pnpm vitest run tests/research/cold-start.test.ts tests/integration/cold-start.test.ts`

Expected: PASS. No test references `BEGIN`, `END`, `COMPLETE`, `ANCHOR EXCERPT`, `2026-01-01`, or `Switzerland` in Slovenia evidence.

- [ ] **Step 12: Commit the native route/companion validators.**

```bash
git add src/research/parsers/slovenia.ts tests/research/cold-start.test.ts tests/integration/cold-start.test.ts tests/sources/fixtures/slovenia/route-gov.html tests/sources/fixtures/slovenia/companion-ess.html tests/sources/fixtures/slovenia/ztuj2.html tests/sources/fixtures/slovenia/zzsdt.html
git commit -m "feat: validate official Slovenia route evidence"
```

The deleted fixture paths are intentionally included in `git add`; Git records their removal.

---

### Task 4: Validate dynamic income and prove offline replay

**Files:**
- Delete: `tests/sources/fixtures/slovenia/salary-publication.html`
- Modify: `tests/research/cold-start.test.ts:1490-1750,1915-1985`
- Modify: `tests/integration/cold-start.test.ts:1810-2040`
- Modify: `src/research/parsers/slovenia.ts:430-560,675-710`
- Modify: `docs/superpowers/plans/2026-08-11-vs-2-honest-cold-start.md:12-25,426-445,528-555`

**Interfaces:**
- Consumes: `decodePisrsRegistry`, `decodeSiStatMetadata`, `encodeSiStatAllDimensionsQuery`, PISRS details parsing, `Decimal`, and existing plan-aware replay.
- Produces: one dynamic `income` claim at `si-income@2`, full nine-kind verified fixture coverage, and canonical Task 6 handoff with capture ceiling `11`.

- [ ] **Step 1: Write the dynamic income RED test.** Use the official-shaped May fixture: PISRS registry SOP `2026-01-1950`, publication date `2026-07-28`, details line `Povprečna mesečna neto plača na zaposleno osebo v Sloveniji za maj 2026 je znašala 1.680,80 EUR`, and SiStat period `2026M05` / `Net earnings` value `1680.8`. Assert:

```ts
expect(result.claims[0]).toMatchObject({
  claimKind: "income",
  value: {
    metric: "latest_official_average_monthly_net_salary",
    multiplier: "2",
    thresholdEur: "3361.60",
    period: "2026M05",
  },
  sourcePeriod: "2026M05",
  validatorVersion: "si-income@2",
  status: "verified",
});
```

- [ ] **Step 2: Write the proof-of-no-remembered-value RED test.** Change both native PISRS net text and the selected SiStat coordinate from `1680.8` to `1700`; expect threshold `3400.00`. Change only one source and expect `semantic_mismatch`.

- [ ] **Step 3: Write one representative fail-closed table.** Cover exactly: wrong SOP identity, salary publication date after `assessmentAt`, missing/duplicate `Net earnings`, duplicate/misaligned dimension index, series request URL/method/final URL mismatch, series request body hash not equal to the recomputed all-dimensions query, future-only periods, and PISRS/SiStat period mismatch.

- [ ] **Step 4: Run RED.**

Run: `pnpm vitest run tests/research/cold-start.test.ts -t "Slovenia income validator"`

Expected: FAIL because the current parser expects synthetic publication HTML and custom SiStat fields.

- [ ] **Step 5: Implement localized PISRS salary parsing.** Validate exact SOP binding, exact published status, and `objavljeno <= assessmentAt`. Parse the title/paragraph month with this closed language map, used only to form the SiStat period:

```ts
const SLOVENE_MONTH = Object.freeze({
  januar: "01", februar: "02", marec: "03", april: "04",
  maj: "05", junij: "06", julij: "07", avgust: "08",
  september: "09", oktober: "10", november: "11", december: "12",
} as const);
```

Parse a positive localized amount by removing `.` thousands separators and replacing one decimal `,` with `.` before constructing `Decimal`. Require exactly one monthly net paragraph; reject gross and rolling-average paragraphs as the selected metric.

- [ ] **Step 6: Implement real PxWeb/JSON-stat2 validation.** Use the private provenance guard to require POST, the exact SiStat API request/final URL, status `200`, JSON media type, and a body hash. Require metadata and series dimension IDs in the same order, exact aligned size/category cardinality, every declared value exactly once, total values equal to the size product, exactly one time dimension, and exactly one label `Net earnings`. Select the unique maximum `YYYYMmm <= assessmentAt`. Compute the row-major flat index from declared dimension order. Re-encode the all-dimensions body and require its SHA-256 to equal the captured `sistat-series.request.bodySha256`.

- [ ] **Step 7: Cross-check and anchor the claim.** Require PISRS period/value to equal the selected SiStat period/value with `Decimal.equals`. Hash the exact PISRS net paragraph and deterministic JSON projections of the matched metadata dimension/category and selected JSON-stat2 coordinate. Do not read or emit `datasetId`, `complete`, `pagination`, or `anchorExcerpt`.

- [ ] **Step 8: Update the replayable integration fixture.** Replace `salary-publication` with `salary-registry` and `salary-details`, attach the exact SiStat POST body hash to the series artifact, and include all eleven artifacts. The two existing `replayEvidenceByRules` calls must equal the sealed `@2` snapshot without a network port. Keep explicit rejection of Slovenia `@1` and unknown parser versions.

- [ ] **Step 9: Run the complete focused gate.**

Run: `pnpm vitest run tests/research/cold-start.test.ts tests/integration/cold-start.test.ts tests/integration/current-evidence.test.ts tests/sources/gateway.test.ts tests/integration/evidence-store.test.ts`

Expected: PASS with nine country claims, current CBR behavior, `@2` replay equality, publication/tamper tests, and fixed VS-1 bytes.

- [ ] **Step 10: Remove all synthetic fixture grammar.** Delete `salary-publication.html` and confirm the repository contains no production/test dependence on the removed markers:

Run: `rg -n 'BEGIN 51|BEGIN 32|EFFECTIVE STATE LIST|ANCHOR EXCERPT|ELIGIBILITY SCOPE COMPLETE|CONDITIONAL LOCAL EMPLOYMENT SCOPE|datasetId|hasMore' src/research/parsers/slovenia.ts tests/research/cold-start.test.ts tests/sources/fixtures/slovenia`

Expected: no matches. The command may exit `1` because no match is the success condition.

- [ ] **Step 11: Align the canonical VS-2 handoff.** In the canonical plan, link this repair plan as the amendment that supersedes Task 2's fixture grammar; change both global request ceilings and Task 6 cost assertion from `10` to `11`. State that Task 6 resumes only after this repair passes. Do not create or edit `evals/vs2-live.ts` in this task.

- [ ] **Step 12: Run the complete local gate.**

Run:

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
git diff --check
git status --short --branch
```

Expected: all test/static/build commands exit `0`; status contains only this task's intended files plus the preserved unrelated brainstorm directory.

- [ ] **Step 13: Commit the complete source-shape repair.**

```bash
git add src/research/parsers/slovenia.ts tests/research/cold-start.test.ts tests/integration/cold-start.test.ts tests/sources/fixtures/slovenia/salary-publication.html docs/superpowers/plans/2026-08-11-vs-2-honest-cold-start.md
git commit -m "feat: validate official Slovenia income evidence"
```

After this commit, return to Task 6 of the canonical VS-2 plan. Implement `evals/vs2-live.ts`, run the automated live gate, and stop for fresh explicit browser permission exactly as that plan requires.

## Completion Gate

The repair is complete only when all four task commits exist, the full local gate passes, synthetic source markers are absent, Slovenia `@1` replay is rejected, `@2` offline replay is canonical-equal with zero network, the successful fixture path has exactly eleven artifacts and nine country claims, and the canonical Task 6 plan points to this amendment. A live source drift remains yellow and blocks any `source-verified` claim; it is not repaired with fixtures or fallback logic.
