# Pre-defense LLM-free Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove every external LLM/API dependency from the pre-defense runtime, replace model-backed discovery with a deterministic installed country source index, and preserve fresh official-source verification.

**Architecture:** A synchronous `CountrySourceIndexPort` supplies six reviewed Slovenia navigation seeds from repository data. The existing live HTTPS gateway, Slovenia adapters/validators, evidence sealing, dossier publication, replay and UI stream remain the only fact-producing path. VS-1 presentation becomes a pure projection of typed evidence classes; no provider-facing port remains.

**Tech Stack:** Node 24, TypeScript 6.0.3, Next.js 16.3.0, React 19.2.8, SQLite/better-sqlite3 13.0.3, Vitest 4.1.10, Zod 4.4.3, existing official HTTP adapters and deterministic validators.

## Global Constraints

- Before defense, runtime model/API calls are exactly zero; no OpenAI SDK, Responses API, `OPENAI_API_KEY`, `OPENAI_MODEL`, provider feature flag or separate model billing remains.
- Codex is a development tool only and is never called by application runtime, scripts or browser code.
- Every new supported-country run still performs fresh official HTTPS capture; installed navigation is never evidence or a remembered fact.
- Slovenia keeps exactly six installed navigation seeds, at most eleven official capture steps, concurrency three and the existing sixty-second research deadline.
- Missing/incomplete installed country data or official-source drift fails closed as unsupported/yellow and creates no false dossier version.
- Preserve current raw artifact storage, HMAC integrity, versioned validators, replay, dossier, comparator, NDJSON and globe/event behavior.
- Add no external-provider abstraction, local model, manifest generator, replacement live-eval subsystem, crawler, persistence field or alternate capture pipeline.
- Preserve the unrelated untracked `.superpowers/brainstorm/12369-1786346924/` directory.
- Do not use a browser until Task 4, after fresh explicit user permission immediately before that use.
- The abandoned uncommitted `evals/vs2-live.ts` and its `package.json` script are deletion targets, not user-owned work to preserve.

---

### Task 1: Replace model discovery with the installed country source index

**Files:**
- Create: `src/infrastructure/sources/country-source-index.ts`
- Create: `tests/research/country-source-index.test.ts`
- Modify: `src/research/cold-start-contracts.ts`
- Modify: `src/application/cold-start.ts`
- Modify: `src/infrastructure/cold-start-composition.ts`
- Modify: `src/infrastructure/composition-root.ts`
- Modify: `src/infrastructure/sources/slovenia-source-adapter.ts`
- Modify: `tests/research/cold-start.test.ts`
- Modify: `tests/integration/cold-start.test.ts`
- Modify: `package.json`
- Delete: `src/infrastructure/sources/official-source-discovery.ts`
- Delete: `evals/vs2-live.ts`

**Interfaces:**
- Consumes: `resolveCountry`, `SourceCandidate`, existing `createSloveniaResearch`, `captureHttpOnce`, evidence stores and event contracts.
- Produces:

```ts
export type CountrySourceIndexResult =
  | { readonly ok: true; readonly candidates: readonly SourceCandidate[] }
  | {
      readonly ok: false;
      readonly kind: "country_not_installed";
      readonly candidates: readonly [];
    };

export interface CountrySourceIndexPort {
  lookup(countryCode: string): CountrySourceIndexResult;
}

export function createInstalledCountrySourceIndex(): CountrySourceIndexPort;
```

`lookup` is deliberately synchronous and accepts only an ISO code. This makes the current boundary repository-data-specific; a future external LLM cannot become its drop-in architectural foundation.

- [ ] **Step 1: Write the failing installed-index tests**

Create `tests/research/country-source-index.test.ts`. Require exact order, exact keys/URLs/roots/kinds, deep immutability and one data-only failure:

```ts
import { describe, expect, test } from "vitest";

import { createInstalledCountrySourceIndex } from
  "../../src/infrastructure/sources/country-source-index";

describe("installed country source index", () => {
  test("returns the exact frozen Slovenia navigation set", () => {
    const result = createInstalledCountrySourceIndex().lookup("SI");

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Slovenia must be installed");
    expect(result.candidates.map(({ candidateId, url, authorityRoot, claimKinds }) => ({
      candidateId,
      url,
      authorityRoot,
      claimKinds,
    }))).toEqual([
      {
        candidateId: "gov-route",
        url: "https://www.gov.si/en/news/2025-11-21-temporary-residence-permit-for-digital-nomads/",
        authorityRoot: "https://www.gov.si",
        claimKinds: ["route_basis", "citizenship_applicability", "remote_work_relations", "qualification", "companion_entry", "duration", "general_statutory_prerequisites"],
      },
      {
        candidateId: "ztuj2",
        url: "https://pisrs.si/Pis.web/pregledPredpisa?id=ZAKO5761&print=1",
        authorityRoot: "https://pisrs.si",
        claimKinds: ["route_basis", "citizenship_applicability", "remote_work_relations", "qualification", "companion_entry", "duration", "general_statutory_prerequisites"],
      },
      {
        candidateId: "salary-publication",
        url: "https://pisrs.si/pregledPredpisa?sop=2026-01-1950",
        authorityRoot: "https://pisrs.si",
        claimKinds: ["income"],
      },
      {
        candidateId: "sistat",
        url: "https://pxweb.stat.si/SiStatData/pxweb/en/Data/-/H285S.px/",
        authorityRoot: "https://pxweb.stat.si",
        claimKinds: ["income"],
      },
      {
        candidateId: "ess-companion",
        url: "https://www.ess.gov.si/delodajalci/zaposlovanje-tujcev-iz-tretjih-drzav/zaposlitev-tujcev-z-dovoljenjem-za-prebivanje/",
        authorityRoot: "https://www.ess.gov.si",
        claimKinds: ["companion_local_work_access"],
      },
      {
        candidateId: "zzsdt",
        url: "https://pisrs.si/Pis.web/pregledPredpisa?id=ZAKO6655",
        authorityRoot: "https://pisrs.si",
        claimKinds: ["companion_local_work_access"],
      },
    ]);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.candidates)).toBe(true);
    expect(result.candidates.every((candidate) =>
      Object.isFrozen(candidate) && Object.isFrozen(candidate.claimKinds)
    )).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(
      /salaryAmount|threshold|profile|passport|citizenshipValue|prompt|model/i,
    );
  });

  test.each(["FR", "si", " Словения "])("fails closed for %j", (input) => {
    expect(createInstalledCountrySourceIndex().lookup(input)).toEqual({
      ok: false,
      kind: "country_not_installed",
      candidates: [],
    });
  });
});
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run:

```bash
./node_modules/.bin/vitest run tests/research/country-source-index.test.ts
```

Expected: FAIL because `country-source-index.ts` does not exist.

- [ ] **Step 3: Add the inner port and installed index implementation**

In `src/research/cold-start-contracts.ts`, replace `OfficialSourceDiscoveryInput`, `OfficialSourceDiscoveryResult` and `OfficialSourceDiscoveryPort` with the exact interfaces above. Keep `SourceCandidate` and its current `discoveredFrom: "registry"` discriminator; here “registry” means reviewed repository registry data, not a model response.

Implement `createInstalledCountrySourceIndex` with a module-level deeply frozen success and failure value. The success contains exactly the six records from Step 1 and returns only for exact `"SI"`; it performs no I/O and accepts no profile or free text.

- [ ] **Step 4: Write the failing application-boundary migration**

In `tests/integration/cold-start.test.ts`, rename the harness surface:

```ts
const installedIndexResult = createInstalledCountrySourceIndex().lookup("SI");
if (!installedIndexResult.ok) throw new Error("Slovenia test index must be installed");
const INSTALLED_CANDIDATES = installedIndexResult.candidates;

countrySourceIndex: {
  lookup(countryCode) {
    sourceIndexInputs.push(countryCode);
    if (options.sourceIndexError !== undefined) throw options.sourceIndexError;
    return options.countryInstalled === false
      ? { ok: false as const, kind: "country_not_installed" as const, candidates: [] as const }
      : { ok: true as const, candidates: INSTALLED_CANDIDATES };
  },
},
```

Assert the normal run calls `lookup` exactly once with `"SI"`, preserves the six `source_discovered -> authority_verified` pairs, and passes the same six candidates to Research. Assert `countryInstalled:false` produces terminal yellow through the existing empty-candidate Research blocker with zero request-step calls and zero dossier rows. Preserve the existing pre-aborted and unexpected-port-error tests under `sourceIndexInputs/sourceIndexError` names.

Run:

```bash
./node_modules/.bin/vitest run tests/integration/cold-start.test.ts
```

Expected: FAIL because `ColdStartApplicationPorts` still requires `discovery` and the use case still calls `discover`.

- [ ] **Step 5: Migrate application and composition with no alternate path**

In `src/application/cold-start.ts`, make the port:

```ts
readonly countrySourceIndex: CountrySourceIndexPort;
```

Replace the async discovery call with:

```ts
const indexed = ports.countrySourceIndex.lookup(prepared.country.code);
const candidates = indexed.ok ? indexed.candidates : [];
```

Keep the existing event loop byte-for-byte in meaning: each installed candidate emits one `source_discovered` and one `authority_verified`; the events never contain profile data.

In `src/infrastructure/cold-start-composition.ts`, replace `openAiApiKey?` and `discovery?` with:

```ts
readonly countrySourceIndex?: CountrySourceIndexPort;
```

Default to `createInstalledCountrySourceIndex()`. Preserve `requestStep ?? captureHttpOnce` and `createSloveniaResearch` unchanged.

In `src/infrastructure/composition-root.ts`, stop forwarding `openAiApiKey` into `createColdStartComposition`; the option remains temporarily only for the narrative removed in Task 2.

- [ ] **Step 6: Seal all six navigation seeds using the existing manifest field**

Change the Slovenia `entry` helper to accept the secondary installed URL:

```ts
function entry(
  sourceId: CountrySourceId,
  navigationUrl: string,
  indexedSourceUrl: string,
  artifacts: readonly LiveCapturedArtifact<SloveniaSourceId>[],
): CapturedEntry<SloveniaSourceId> {
  return {
    sourceId,
    navigationUrl,
    indexedSourceUrl,
    resolvedEvidenceUrl: artifacts.at(-1)?.responseUrl ?? navigationUrl,
    artifacts,
  };
}
```

Use the pairs `gov.url/law.url`, `salary.url/sistat.url`, and `ess.url/law.url`. Do not add a persistence column or `sourceSetVersion`. Extend the existing Slovenia adapter assertions to prove these three primary/secondary pairs appear in the prepared manifest and survive verified load/replay.

- [ ] **Step 7: Remove the obsolete model adapter and dependent eval**

Delete `src/infrastructure/sources/official-source-discovery.ts`. Remove the OpenAI import and model-adapter tests from `tests/research/cold-start.test.ts`; import the installed candidates or index result instead of maintaining a duplicate constant.

Delete the untracked `evals/vs2-live.ts` with `apply_patch` and remove only this script from `package.json`:

```json
"eval:vs2": "node --import tsx evals/vs2-live.ts"
```

Keep the `openai` dependency until Task 3 because Task 2 still removes the VS-1 narrative adapter that imports it.

- [ ] **Step 8: Run Task 1 gates**

Run:

```bash
./node_modules/.bin/vitest run tests/research/country-source-index.test.ts tests/research/cold-start.test.ts tests/integration/cold-start.test.ts
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/eslint .
./node_modules/.bin/vitest run
./node_modules/.bin/next build
rg -n 'OfficialSourceDiscovery|createOfficialSourceDiscovery|model_error|responses\.parse' src/application/cold-start.ts src/research/cold-start-contracts.ts src/infrastructure/cold-start-composition.ts src/infrastructure/sources tests/research/country-source-index.test.ts
git diff --check
```

Expected: focused/full tests, typecheck, lint and build PASS; the final `rg` returns exit 1 with no matches. Do not call official network or browser in this task.

- [ ] **Step 9: Commit Task 1**

Stage only the Task 1 files and commit:

```bash
git commit -m "refactor: install deterministic country source index"
```

---

### Task 2: Make VS-1 narrative a pure deterministic projection

**Files:**
- Modify: `src/application/contracts.ts`
- Modify: `src/application/present-run.ts`
- Modify: `src/application/present-journey.ts`
- Modify: `src/infrastructure/composition-root.ts`
- Modify: `tests/integration/experience.test.tsx`
- Modify: `tests/integration/confirmed-life.test.ts`
- Modify: `tests/integration/present-journey.test.ts`
- Modify: `tests/integration/journey-actions.test.tsx`
- Modify: `tests/integration/cold-start.test.ts`
- Delete: `src/infrastructure/narrative.ts`

**Interfaces:**
- Consumes: `RunDetailsCore.evidenceItems` classes only.
- Produces:

```ts
export interface NarrativeRead {
  readonly headline: string;
  readonly bullets: readonly string[];
}

export function projectNarrative(
  evidenceItems: readonly Pick<EvidenceReadItem, "class">[],
): NarrativeRead;

export function renderRunDetails(core: RunDetailsCore): RunDetails;

export function createPresentRun(ports: {
  readonly loadRunDetailsCore: (runId: string) => Promise<RunDetailsCore>;
}): (runId: string) => Promise<RunDetails>;
```

- [ ] **Step 1: Replace model tests with failing deterministic-policy tests**

In `tests/integration/experience.test.tsx`, delete imports/tests for `createOpenAiNarrative`, `NarrativeParse`, model schema, refusal, timeout and untrusted model selections. Add a table for three exact cases:

```ts
it.each([
  {
    name: "no official facts",
    evidenceItems: [{ class: "unknown", label: "Источник", provenance: "source_unavailable" }],
    expected: {
      headline: "Маршрут показан без недоказанных выводов",
      bullets: [
        "Вывод не расширяет официальные факты.",
        "Неизвестные условия остаются отмеченными в паспорте доказательств.",
      ],
    },
  },
  {
    name: "official facts only",
    evidenceItems: [{ class: "official_fact", label: "claim", displayValue: "PRIVATE VALUE" }],
    expected: {
      headline: "Маршрут показан в границах официальных источников",
      bullets: ["Официальные факты отделены от пользовательских данных и допущений."],
    },
  },
  {
    name: "official facts and unknowns",
    evidenceItems: [
      { class: "official_fact", label: "claim", displayValue: "PRIVATE VALUE" },
      { class: "unknown", label: "private label", provenance: "unmodelled" },
    ],
    expected: {
      headline: "Маршрут показан в границах официальных источников",
      bullets: [
        "Официальные факты отделены от пользовательских данных и допущений.",
        "Неизвестные условия остаются отмеченными в паспорте доказательств.",
      ],
    },
  },
] as const)("projects deterministic copy for $name", ({ evidenceItems, expected }) => {
    const first = projectNarrative(evidenceItems);
    const second = projectNarrative(evidenceItems);
  expect(first).toEqual(expected);
  expect(second).toEqual(expected);
  expect(JSON.stringify(first)).not.toMatch(/PRIVATE VALUE|private label/);
  expect(Object.isFrozen(first)).toBe(true);
  expect(Object.isFrozen(first.bullets)).toBe(true);
});
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run:

```bash
./node_modules/.bin/vitest run tests/integration/experience.test.tsx
```

Expected: FAIL because `projectNarrative` is absent and current presentation still accepts a provider.

- [ ] **Step 3: Remove provider-facing types and implement the pure projection**

In `src/application/contracts.ts`, delete `NarrativeTypedValue`, `NarrativeInput`, `NarrativePhraseId`, `NarrativeSelectionSection`, `NarrativeSelection` and `NarrativePort`. Keep `RunDetails.narrative`, but remove `origin` from `NarrativeRead`.

Replace `src/application/present-run.ts` model/fallback machinery with:

```ts
const NO_FACTS_HEADLINE = "Маршрут показан без недоказанных выводов";
const OFFICIAL_HEADLINE = "Маршрут показан в границах официальных источников";
const SAFE_BULLET = "Вывод не расширяет официальные факты.";
const OFFICIAL_BULLET = "Официальные факты отделены от пользовательских данных и допущений.";
const UNKNOWNS_BULLET = "Неизвестные условия остаются отмеченными в паспорте доказательств.";

export function projectNarrative(
  evidenceItems: readonly Pick<EvidenceReadItem, "class">[],
): NarrativeRead {
  const hasOfficialFacts = evidenceItems.some((item) => item.class === "official_fact");
  const hasUnknowns = evidenceItems.some((item) => item.class === "unknown");
  const bullets = [hasOfficialFacts ? OFFICIAL_BULLET : SAFE_BULLET];
  if (hasUnknowns) bullets.push(UNKNOWNS_BULLET);
  return Object.freeze({
    headline: hasOfficialFacts ? OFFICIAL_HEADLINE : NO_FACTS_HEADLINE,
    bullets: Object.freeze(bullets),
  });
}

export function renderRunDetails(core: RunDetailsCore): RunDetails {
  return Object.freeze({ ...core, narrative: projectNarrative(core.evidenceItems) });
}
```

`createPresentRun` validates nonempty `runId`, loads the core and calls `renderRunDetails`; it has no try/catch or provider fallback.

- [ ] **Step 4: Remove narrative ports from journey and composition**

In `src/application/present-journey.ts`, delete `JourneyPresentationPorts.narrative` and call `renderRunDetails(core)` directly for initial, C0 and C1 presentation.

In `src/infrastructure/composition-root.ts`, remove `NarrativePort`, `createOpenAiNarrative`, `ConfirmedLifeCompositionOptions.narrative`, `ConfirmedLifeCompositionOptions.openAiApiKey`, all forwarding, and `process.env.OPENAI_API_KEY`. Construct `createJourneyPresentation` without a narrative member.

Delete `src/infrastructure/narrative.ts` entirely.

- [ ] **Step 5: Update integration fixtures without preserving dormant hooks**

- `tests/integration/confirmed-life.test.ts`: keep the rejected-claim exclusion assertion, delete the outbound narrative-input spy, and assert the safe deterministic narrative plus unchanged evidence items.
- `tests/integration/present-journey.test.ts`: remove all `narrative` mocks; assert present/C0/C1 use equal deterministic copy.
- `tests/integration/cold-start.test.ts`: remove the composition-root `narrative` option.
- `tests/integration/journey-actions.test.tsx` and remaining `experience.test.tsx` fixtures: remove `origin` from `narrative` objects.
- Do not add a replacement provider port, no-op adapter or feature flag.

- [ ] **Step 6: Run Task 2 gates**

Run:

```bash
./node_modules/.bin/vitest run tests/integration/experience.test.tsx tests/integration/confirmed-life.test.ts tests/integration/present-journey.test.ts tests/integration/journey-actions.test.tsx tests/integration/cold-start.test.ts
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/eslint .
./node_modules/.bin/vitest run
./node_modules/.bin/next build
rg -n 'NarrativePort|NarrativeInput|createOpenAiNarrative|origin: "model"|OPENAI_API_KEY|openAiApiKey' src tests evals
git diff --check
```

Expected: all test/static/build commands PASS and `rg` returns exit 1 with no matches.

- [ ] **Step 7: Commit Task 2**

Stage only the Task 2 files and commit:

```bash
git commit -m "refactor: make narrative deterministic"
```

---

### Task 3: Remove SDK/config surface and align active specifications

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `.env.example`
- Modify: `docs/product/charter.md`
- Modify: `docs/architecture/spec-of-specs.md`
- Modify: `docs/changes/active/vs-1-confirmed-life/change.md`
- Modify: `docs/changes/active/vs-2-honest-cold-start/change.md`
- Modify: `docs/superpowers/specs/2026-08-11-slovenia-official-source-shape-design.md`
- Modify: `docs/README.md`

**Interfaces:**
- Consumes: approved `docs/superpowers/specs/2026-08-11-pre-defense-llm-free-runtime-design.md` and completed Tasks 1–2.
- Produces: a package/runtime graph with no external LLM provider and active specs that point external discovery to `BACKLOG-EXT-LLM-01`.

- [ ] **Step 1: Capture the failing zero-LLM audit before cleanup**

Run:

```bash
rg -n -S 'openai|OPENAI_API_KEY|OPENAI_MODEL|openAiApiKey|responses\.parse|gpt-5\.6|OfficialSourceDiscovery|createOpenAi|origin: "model"' src tests evals package.json pnpm-lock.yaml .env.example
```

Expected before cleanup: matches remain only in `package.json`, `pnpm-lock.yaml` and `.env.example`. If production/test matches remain, Task 2 is incomplete and must be fixed before proceeding.

- [ ] **Step 2: Remove dependency, lock and env configuration exactly**

Remove `openai: "7.4.0"` from `package.json`.

Remove only these OpenAI sections from `pnpm-lock.yaml`:

```yaml
      openai:
        specifier: 7.4.0
        version: 7.4.0(zod@4.4.3)
```

```yaml
  openai@7.4.0:
    resolution: {integrity: sha512-+C9Muit5x8j9R8ej8ZzVgKcrVDtqFqTy9gxFdov0EItLgU68zrJtF9ZeT0cyqJQW9S3PCJkdFgADtRGquRBtew==}
    engines: {node: '>=22.0.0'}
    peerDependencies:
      '@aws-sdk/credential-provider-node': '>=3.972.0 <4'
      '@smithy/hash-node': '>=4.3.0 <5'
      '@smithy/signature-v4': '>=5.4.0 <6'
      ws: ^8.18.0
      zod: ^3.25 || ^4.0
    peerDependenciesMeta:
      '@aws-sdk/credential-provider-node':
        optional: true
      '@smithy/hash-node':
        optional: true
      '@smithy/signature-v4':
        optional: true
      ws:
        optional: true
      zod:
        optional: true
```

```yaml
  openai@7.4.0(zod@4.4.3):
    optionalDependencies:
      zod: 4.4.3
```

Keep the direct `zod` dependency. Remove `OPENAI_API_KEY=` and `OPENAI_MODEL=gpt-5.6` from `.env.example`; retain only database and evidence integrity configuration.

- [ ] **Step 3: Amend current normative documents without rewriting history**

Apply the approved design consistently:

- `docs/product/charter.md`: pre-defense variants come from Country Registry/Source Index and deterministic read models; external LLM-assisted discovery moves after defense/before monetization.
- `docs/architecture/spec-of-specs.md`: add the `VS-1..VS-5` zero-provider phase boundary; replace current LLM integration with installed navigation seeds; retain future proposals as untrusted and gated.
- `docs/changes/active/vs-1-confirmed-life/change.md`: replace `PORT-VS1-NARRATIVE` with deterministic presentation projection; remove model failure/payload requirements.
- `docs/changes/active/vs-2-honest-cold-start/change.md`: replace `PORT-VS2-DISCOVERY` with `PORT-VS2-SOURCE-INDEX`, set runtime model calls to zero, replace Task 6 with the removal/local-gate/browser-evidence task, and link `BACKLOG-EXT-LLM-01`.
- `docs/superpowers/specs/2026-08-11-slovenia-official-source-shape-design.md`: replace the model discovery/live-eval gate with installed navigation, automated deterministic acceptance and the mandatory provider-free browser walkthrough.
- `docs/README.md`: add the approved pre-defense design and active VS-2 package; show its remaining gate as provider-free current-source walkthrough/evidence.

Do not rewrite historical implementation plans, task briefs or reports. The approved design explicitly supersedes their provider/API/live-eval clauses while preserving them as implementation history.

- [ ] **Step 4: Prove the complete zero-LLM production surface**

Run:

```bash
node -e 'JSON.parse(require("node:fs").readFileSync("package.json", "utf8"))'
rg -n -S 'openai|OPENAI_API_KEY|OPENAI_MODEL|openAiApiKey|responses\.parse|gpt-5\.6|OfficialSourceDiscovery|createOpenAi|origin: "model"' src tests evals package.json pnpm-lock.yaml .env.example
```

Expected: JSON parse exits 0; `rg` exits 1 with no matches. Historical docs are deliberately outside this audit because they record the superseded implementation.

- [ ] **Step 5: Run the full offline verification gate**

Run with the already installed local binaries; do not allow package-manager fallback to fetch metadata:

```bash
./node_modules/.bin/vitest run
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/eslint .
./node_modules/.bin/next build
git diff --check
git status --short
```

Expected: every remaining test passes; the exact count may decrease because provider-only tests are intentionally deleted. Typecheck/lint/build/diff-check exit 0. Status contains only the intended Task 3 files plus the preserved unrelated brainstorm; `evals/vs2-live.ts` and the abandoned `package.json` script are absent.

- [ ] **Step 6: Commit Task 3**

Stage only the Task 3 files and commit:

```bash
git commit -m "chore: remove external LLM runtime surface"
```

---

### Task 4: Provider-free current-source walkthrough and evidence gate

**Files:**
- Create after successful observation: `docs/changes/active/vs-2-honest-cold-start/implementation-evidence.md`
- Modify after user evidence approval only: `docs/changes/active/vs-2-honest-cold-start/change.md`

**Interfaces:**
- Consumes: production `getConfirmedLifeApplication`, installed Slovenia index, real `captureHttpOnce`, official validators and completed local gate.
- Produces: one honest black-box observation with no LLM credential and an earned or blocked `source-verified` statement.

- [ ] **Step 1: Stop and obtain fresh explicit browser permission**

Tell the user that the next action will open the in-app browser and make live HTTPS requests to GOV.SI, PISRS, SiStat, ESS and CBR through the application. Do not start the server or browser until the user explicitly approves this specific use.

- [ ] **Step 2: Start one isolated production-composition run without LLM configuration**

After permission, create a narrow temporary database directory with `mktemp -d`. Start the app with only `DATABASE_PATH` and a synthetic `EVIDENCE_HMAC_KEY`; do not set any OpenAI/model variable. Use the existing local Next binary. Record the exact command and port for evidence, but never record the HMAC value.

- [ ] **Step 3: Run exactly one browser scenario**

Open `?flow=cold-start`, confirm the approved synthetic profile, submit `Словения`, and observe:

1. gray marker before terminal;
2. six real `source_discovered -> authority_verified` pairs from the installed index;
3. actual capture/claim progress without timers;
4. terminal red with formula/source details when current evidence proves the income veto, or honest yellow when official drift blocks proof;
5. collapsed globe plus comparator;
6. reload of the terminal URL produces the same persisted presentation without another current-source run;
7. Tab, Enter/Space and Escape operate the reason details.

Do not add a browser framework, retry matrix or second country.

- [ ] **Step 4: Record implementation evidence truthfully**

Create `implementation-evidence.md` with: date/timezone; HEAD commit; exact local test/type/lint/build results; zero-LLM audit result; browser route and visible event order; terminal marker; coverage; dossier ID/version if published; official navigation links shown; reload result; keyboard result; and explicit readiness conclusion.

If terminal is yellow because of current official drift, record the exact blocker and state `source-verified: not earned`. Do not patch a parser, use fixtures or create a fallback inside this walkthrough task.

- [ ] **Step 5: Stop for user review of the evidence**

Present the evidence file and ask the user to approve the earned readiness wording. Do not edit active status or commit the evidence before this review.

- [ ] **Step 6: After approval, update status links and commit evidence**

Update only the earned status/evidence links in the active VS-2 change, run:

```bash
git diff --check
git status --short
```

Stage only the evidence and active VS-2 change, then commit:

```bash
git commit -m "test: verify provider-free cold start"
```

Never merge or push main. Push the feature branch only after the complete gate passes and the user has approved the evidence wording.

---

## Self-review

- **Spec coverage:** Tasks 1–3 remove both OpenAI runtime integrations, key/model/package surface and dependent eval; install data-only navigation; preserve live official verification; update active specs/backlog. Task 4 supplies the mandatory provider-free current-source observation before defense.
- **No placeholders:** every production interface, candidate URL, deterministic phrase, failure kind, audit command and browser outcome policy is explicit. Runtime-dependent evidence values are observed rather than invented.
- **Type consistency:** Task 1 produces synchronous `CountrySourceIndexPort.lookup(countryCode)` consumed by application/composition. Task 2 removes every `NarrativePort` consumer and leaves only `NarrativeRead`. Task 3 removes the now-unused SDK. No later task refers to deleted discovery/narrative APIs.
- **Anti-bloat:** one installed adapter, one pure presentation projection, no provider layer, no new persistence schema, no replacement eval and one browser scenario.
