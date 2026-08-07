# VS-1 Confirmed Life Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the approved one-candidate Albania/Tirana walking skeleton from confirmed profile through live official evidence, scoped marker, visual budget, Evidence Passport, immutable commit and housing fork/diff.

**Architecture:** One Next.js modular monolith. Application use cases alone coordinate Research, Decision and Branch through immutable values; Experience renders read models, while network, SQLite, HMAC and OpenAI remain server-only infrastructure. One capture/replay path owns evidence; no parallel fallback pipeline.

**Tech Stack:** Node 24, pnpm 11, Next.js 16.3.0, React 19.2.8, TypeScript 6.0.3, SQLite (`better-sqlite3` 13.0.3), Vitest 4.1.10, Zod 4.4.3, Decimal.js 10.6.0, OpenAI SDK 7.4.0.

**Normative spec:** [`VS-1 approved baseline`](../../changes/active/vs-1-confirmed-life/change.md).

## Global Constraints

- Five fixed source entries only; every live run performs `navigate -> capture -> persist raw -> parse -> claim -> seal` within 45 seconds.
- Research `runCurrentEvidence` alone enforces the application-supplied 45-second deadline and one retry token per source entry, only for timeout/429/5xx; infrastructure performs one HTTP attempt. Limit is 30 MiB per artifact; redirected hosts/MIME are allowlisted.
- Gray has no verdict; missing/stale/conflicting/invalid evidence is yellow; red requires a verified rule plus confirmed hard mismatch; green uses the exact declared scope.
- Profile holds no names/passports; source adapters, LLM and logs receive no PII/free text. LLM input is synthetic typed values plus claim IDs only; it cannot create facts, numbers, provenance, calculations or verdicts.
- SQLite is local and append-only for confirmed profiles, sealed artifacts, evidence snapshots, run revisions and commits. HMAC key comes only from `EVIDENCE_HMAC_KEY`, outside the database.
- Exactly four logical test groups: `domain`, `sources`, `integration`, `branch`; no coverage target or exhaustive matrix.
- No VS-2 dossier/search/ranking, generic crawler, rules engine, ORM, queue, websocket, map SDK, design system, multi-provider LLM or client-side business rules.
- OpenAI adapter uses server-side Responses API Structured Outputs (`responses.parse`, `zodTextFormat`), `gpt-5.6`, `store:false`; no tool calls. See [official SDK](https://developers.openai.com/api/docs/libraries#install-an-official-sdk) and [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs).

## File Map

```text
src/{research,decision,branch,application,experience,infrastructure}/
src/app/{layout.tsx,page.tsx,actions.ts,globals.css}
tests/{domain,sources,integration,branch}/
evals/{live.ts,visual-truth.md}  scripts/reset-demo.ts  public/world-map.svg
```

Traceability: `REQ-VS1-01` -> Tasks 1,4; `REQ-VS1-02` -> Tasks 2–4,7; `REQ-VS1-03` -> Tasks 1,4; `REQ-VS1-04` -> Tasks 5–6; `REQ-VS1-05` -> Tasks 3,6–7; `REQ-VS1-06` -> Tasks 3,5,7. NFRs are exercised by Tasks 2,4,6,7.

Published type contract (fields may gain validation helpers, not alternate shapes):

```ts
type DecimalString = string;
type SourceId = "al-qbz-law-79-2021"|"al-qbz-decision-858-2021"|"ru-cbr-eur-rub"|"al-boa-eur-all"|"al-tirana-urban-lines";
type Marker = "gray"|"green"|"yellow"|"red";
type Relationship = "spouse"|"registered_partner"|"minor_child"|"adult_dependent"|"other_family"|"non_family"|"unknown";
interface Companion { relationship:Relationship; basis:"family"|"independent"|"unknown"; stagedAfterSponsorPermit:boolean }
interface ProfileDraft { originCountry:string; currentCity?:string; companions:readonly Companion[]; monthlyIncome:{amount:DecimalString;currency:"RUB"}; savings:{min:DecimalString;max:DecimalString;currency:"RUB"}; education:"none"|"present"|"unknown"; conditions:{contractType:"foreign_employment"|"foreign_service"|"albanian_employer_only"|"unknown"; incomeContinuesMonths:number; availableResourcesAll?:DecimalString; lawfulStayAccepted:boolean} }
interface ProfileSnapshot extends ProfileDraft { id:string; confirmedAt:string }
interface ArtifactBytes { artifactId:string; sourceId:SourceId; role:string; request:{method:"GET"|"POST";url:string;bodySha256?:string}; resolvedUrl:string; retrievedAt:string; httpStatus:number; mediaType:string; bytes:Uint8Array; byteLength:number; sha256:string; origin:"live"|"fixture" }
type LiveCapturedArtifact = ArtifactBytes & { origin:"live"; runId:string };
interface Claim<T> { claimId:string; sourceId:SourceId; value:T; unit?:string; scope:string; sourcePeriod:string; anchor:{artifactId:string;locator:string;excerptSha256:string}; status:"verified" }
type EvidenceBlockerKind = "timeout"|"rate_limited"|"server_error"|"http_error"|"wrong_media_type"|"too_large"|"navigation_mismatch"|"integrity_mismatch"|"semantic_mismatch"|"stale"|"conflict"|"deadline";
interface EvidenceBlocker { sourceId:SourceId;kind:EvidenceBlockerKind;navigationUrl:string;resolvedUrl?:string;artifactIds:readonly string[] }
interface EvidenceSnapshot { id:string; assessmentDate:string; artifactIds:readonly string[]; claims:readonly Claim<unknown>[]; blockers:readonly EvidenceBlocker[]; coverage:Readonly<Record<SourceId,"verified"|"unavailable">>; parserVersions:Readonly<Record<string,string>>; rulesVersion:string; manifestHash:string; hmac:string }
interface HousingDecision { housingAll:DecimalString }
interface RouteConditions { housingProvided:boolean }
interface Assessment { id:string; profileId:string; evidenceSnapshotId:string; assessmentDate:string; routeConditions:Readonly<RouteConditions>; marker:Exclude<Marker,"gray">; declaredScope:string; reasons:readonly {code:string;claimId?:string}[]; conditions:readonly string[]; unknowns:readonly string[]; rulesVersion:string }
interface AssessmentRunRevision { id:string;runId:string;stage:"assessment";assessmentDate:string;initialHousing:Readonly<HousingDecision>;profileId:string;evidenceSnapshotId:string;assessmentId:string;rulesVersion:string;hmac:string }
interface BranchRunRevision { id:string;runId:string;stage:"branch";assessmentDate:string;parentRevisionId:string;profileId:string;evidenceSnapshotId:string;assessmentId:string;rulesVersion:string;branchCommitId:string;formulaHash:string;outputHash:string;hmac:string }
type RunRevision = AssessmentRunRevision | BranchRunRevision;
interface RunResult { runId:string; runRevisionId:string; assessmentDate:string; profileId:string; evidenceSnapshotId:string; assessment:Assessment; branchCommitId?:string; mode:"current"|"historical" }
interface BranchCommit { id:string; parentId?:string; forkedFrom?:string; profileId:string; evidenceSnapshotId:string; assessmentId:string; decision:Readonly<HousingDecision>; formulaHash:string; outputHash:string }
interface BranchCursor { commitId:string }
interface HousingBranchDiff { housing:{before:string;after:string;delta:string};knownResidual:{before:string;after:string;delta:string;cause:"housing"};reused:readonly ("profile"|"evidence"|"rules")[] }
interface CalculationInput { binding:string;value:string;unit:string;provenance:"profile"|"claim";ref:string }
type EvidenceReadItem =
  | {class:"official_fact";label:string;displayValue:string;sourceId:SourceId;scope:string;sourcePeriod:string;anchor:string;resolvedUrl:string;integrity:"verified"}
  | {class:"user_fact";label:string;displayValue:string;provenance:"confirmed_profile"}
  | {class:"calculation";label:string;displayValue:string;formulaId:"FORMULA-VS1-FX-01";formulaVersion:string;inputs:readonly CalculationInput[];rounding:"UNROUNDED_THEN_HALF_UP_2DP";outputHash:string}
  | {class:"assumption"|"projection";label:string;displayValue?:string;provenance:"scenario"}
  | {class:"unknown";label:string;provenance:"source_unavailable";sourceId:SourceId;blockerKind:EvidenceBlockerKind;navigationUrl:string;resolvedUrl?:string}
  | {class:"unknown";label:string;provenance:"unmodelled"};
interface RunDetailsCore { run:RunResult;profile:ProfileSnapshot;evidenceItems:readonly EvidenceReadItem[];budget?:{incomeAll:string;housingAll:string;knownResidualAll:string;unknowns:readonly string[]};branchDiff?:HousingBranchDiff }
interface NarrativeRead { headline:string;bullets:readonly string[];origin:"model"|"fallback" }
interface RunDetails extends RunDetailsCore { narrative:NarrativeRead }
```

---

### Task 1: Project shell, published values and scoped assessment

**Files:** Create `package.json`, `pnpm-lock.yaml`, `tsconfig.json`, `next.config.ts`, `vitest.config.ts`, `eslint.config.mjs`, `.env.example`, `src/research/contracts.ts`, `src/decision/{profile,assessment}.ts`, `src/branch/housing.ts`, `tests/domain/{profile,housing,assessment}.test.ts`.

**Interfaces:** Decision produces `confirmProfile(draft, clock): ProfileSnapshot`, evidence values, and `assessRoute(profile,evidence,routeConditions): Assessment`; Branch owns `confirmHousingDecision(input): HousingDecision`. Application alone converts successful Branch validation into `housingProvided:true`. A snapshot becomes trusted only after server-side append/load with hash verification in Task 4; TypeScript types are not proof. No framework type crosses these files.

- [ ] **Step 1: Pin runtime dependencies.**
```bash
pnpm add next@16.3.0 react@19.2.8 react-dom@19.2.8 better-sqlite3@13.0.3 zod@4.4.3 decimal.js@10.6.0 openai@7.4.0 fast-xml-parser@5.10.1 cheerio@1.2.0 pdfjs-dist@6.2.108 iconv-lite@0.7.3
pnpm add -D typescript@6.0.3 vitest@4.1.10 tsx@4.23.11 eslint@10.8.0 eslint-config-next@16.3.0 typescript-eslint@8.66.0 jsdom@30.0.1 @testing-library/react@16.3.2 @types/node@24.13.3 @types/react@19.2.18 @types/react-dom@19.2.4 @types/better-sqlite3@9.6.0
```
- [ ] **Step 2: Configure the shell.** Define scripts, server-only packages and a `typescript-eslint` flat config whose `no-restricted-imports` blocks core imports from `app`/`experience`/`infrastructure`. Create `.env.example` with `DATABASE_PATH=data/life-branches.db`, blank keys, and `OPENAI_MODEL=gpt-5.6`.
- [ ] **Step 3: Write failing confirmation tests.** Strictly reject extra PII/name/passport fields, free-text/PII-like relationships, non-RUB VS-1 currency, invalid decimal ranges and missing/non-positive initial housing; injected clock fixes `confirmedAt`; canonical normalized profile plus timestamp produces stable SHA-256 `id` and immutable snapshot.
- [ ] **Step 4: Run `pnpm vitest run tests/domain/profile.test.ts tests/domain/housing.test.ts`; expect FAIL because both confirmation functions are absent.**
- [ ] **Step 5: Implement Decision `confirmProfile` and Branch `confirmHousingDecision` with strict Zod validation/canonical serialization; freeze nested output.**
- [ ] **Step 6: Write failing assessment tests.** Branch validates the synthetic `70000 ALL` initial housing; Application passes only `housingProvided:true` to Decision. Cover green for no companion or source-verified spouse plus foreign contract + separately available `408000 ALL` + lawful-stay/staged-family conditions + Tirana claim; false housing presence, missing claim, `independent|unknown` basis or relationship not verified in VS-1 are yellow; `albanian_employer_only` is red. Prove a client cannot turn `non_family` into green by assertion.
```ts
expect(assessRoute(completeProfile, verifiedEvidence, {housingProvided:true}).marker).toBe("green");
expect(assessRoute(unknownBasisProfile, verifiedEvidence, {housingProvided:true}).marker).toBe("yellow");
expect(assessRoute(albanianEmployerProfile, verifiedEvidence, {housingProvided:true}).reasons[0].claimId).toBe("al-law-79-art-68-contract");
```
- [ ] **Step 7: Run the assessment test; expect FAIL, then implement one exhaustive `assessRoute`.** Green also requires trusted `housingProvided`; Decision never sees the amount. A green companion route requires `basis === "family"`, `relationship === "spouse"` and the verified Law 79 spouse claim—never a user legal boolean. Any other family relationship is yellow `relationship_not_verified_in_vs1`, not “unsupported by law”; `independent|unknown` basis is yellow because that route is not researched. Future income never satisfies `availableResourcesAll >= 408000`; missing critical evidence cannot yield green/red; reasons reference claim IDs.
- [ ] **Step 8: Run `pnpm test`, `pnpm typecheck`, `pnpm lint`; expect PASS, then commit `feat: add confirmed profile and assessment`.**

### Task 2: Five official capture and semantic parser paths

**Files:** Create `src/research/source-policy.ts`, five parsers `src/research/parsers/{law-79,decision-858,cbr-eur,boa-eur,tirana-urban-lines}.ts`, `src/infrastructure/sources/{gateway,official-source-adapter,qbz-navigation,pdf-text}.ts`, `tests/sources/{gateway,parsers}.test.ts`, and small fixtures under `tests/sources/fixtures/`. Reuse `docs/changes/archive/vs-1-source-feasibility-spike/evidence/cbr-eur-2026-08-06.xml`; do not commit the 23 MiB Decision PDF.

**Interfaces:** `OfficialSourcePort.capture(request, requestStep): Promise<CaptureResult>` returns only live artifacts. `requestStep` is run-scoped; source adapters never retry. Pure parsers accept fixture/live bytes and cannot mark them verified.
```ts
interface CaptureRequest { runId:string; sourceId:SourceId; assessmentDate:string; deadlineAt:string }
interface HttpStepRequest { sourceId:SourceId;role:string;method:"GET"|"POST";url:string;headers:Readonly<Record<string,string>>;bodyMediaType?:"application/json";bodyBytes?:Uint8Array;allowedHosts:readonly string[];allowedMediaTypes:readonly string[] }
type RequestStep = (request:HttpStepRequest, signal:AbortSignal)=>Promise<LiveCapturedArtifact>;
interface ParserEntry { sourceId:SourceId; navigationUrl:string; indexedSourceUrl?:string; resolvedEvidenceUrl:string; artifacts:readonly ArtifactBytes[]; versionHint?:string }
interface CapturedEntry extends ParserEntry { artifacts:readonly LiveCapturedArtifact[] }
type CaptureResult = {ok:true;entry:CapturedEntry}|{ok:false;sourceId:SourceId;kind:"timeout"|"rate_limited"|"server_error"|"http_error"|"wrong_media_type"|"too_large"|"navigation_mismatch";attempts:1|2;partialArtifacts:readonly LiveCapturedArtifact[]};
type ParseResult<T> = {ok:true;facts:T;sourcePeriod:string;anchors:readonly Claim<unknown>["anchor"][]}|{ok:false;kind:"integrity_mismatch"|"semantic_mismatch"};
interface Law79Facts { digitalWorker:{requiresLawfulStay:true;initialPermitMaxMonths:12;contractTypes:readonly ["foreign_employment","foreign_service"];accommodation:true;insuranceMinMonths:12;criminalRecords:"origin_and_residence"}; family:{spouseIsFamilyMember:true;sponsorPermitMinMonths:12;renewable:true;familyNormallyOutside:true;housingInsuranceStableIncome:true} }
interface Decision858Facts { proof:"self_declaration";availableAmount:"408000";currency:"ALL";scope:"self_and_dependants";periodFormula:"not_stated";headcountFormula:"not_stated";generalRuleExceptionAnchored:true }
interface CbrEurFacts { base:"EUR";quote:"RUB";nominal:"1";rate:DecimalString;effectiveDate:string }
interface BoaEurFacts { base:"EUR";quote:"ALL";rate:DecimalString;effectiveDate:string }
interface TiranaTransitFacts { municipalUrbanRoutesMapPublished:true;applicationTitle:"Transporti";layers:readonly ["Linjat Qytetase","Stacionet e Linjave Qytetase"];checkedAt:string }
declare function parseLaw79(entry:ParserEntry): ParseResult<Law79Facts>;
declare function parseDecision858(entry:ParserEntry): ParseResult<Decision858Facts>;
declare function parseCbrEur(entry:ParserEntry): ParseResult<CbrEurFacts>;
declare function parseBoaEur(entry:ParserEntry): ParseResult<BoaEurFacts>;
declare function parseTiranaUrbanLines(entry:ParserEntry): ParseResult<TiranaTransitFacts>;
```
- [ ] **Step 1: Write failing gateway tests.** Assert one HTTP attempt, exact-byte SHA-256, streaming abort at `30 MiB + 1`, typed retryable/non-retryable classification, redirect/MIME rejection and fixture exclusion.
- [ ] **Step 2: Run `pnpm vitest run tests/sources/gateway.test.ts`; expect FAIL.**
- [ ] **Step 3: Implement bounded `captureHttpOnce(request, signal)`.** It performs exactly one attempt, hashes exact bytes and request-body bytes, persists method/URL/body hash provenance, enforces both size checks, validates redirect/MIME and classifies the result; it owns no deadline/retry policy.
- [ ] **Step 4: Write failing QBZ tests.** Exact ELI search is `POST application/json`; it must yield exactly one `nodeType=qbz:act` `/base` with act number/date/type and exact indexed `qbz:url` value `http://qbz.gov.al/eli/...`, while retaining the separate public navigation URL `https://qbz.gov.al/eli/...`; traverse its root; require `hasMoreItems=false`; choose maximum `cons-YYYY-MM-DD <= assessmentDate`; require one `qbz:actVersion` PDF and retain all JSON/PDF artifacts.
- [ ] **Step 5: Implement `resolveLatestApplicableQbzAct`; never use `base.modifiedAt` or pinned node IDs.**
- [ ] **Step 6: Write failing direct-capture tests.** `captureCbrEur` and `captureBoaEur` use fixed official URL/host/MIME policies. `captureTiranaUrbanLines` retains the municipality page, requires exactly one allowlisted `gis.tirana.al` iframe, then retains that HTML; the exhaustive switch must cover all five `SourceId` values.
- [ ] **Step 7: Implement those three capture functions and `OfficialSourceAdapter.capture`; all network bytes pass through the supplied run-scoped `RequestStep`, ultimately `captureHttpOnce`.**
- [ ] **Step 8: Write failing semantic tests.** Law asserts Art. 68 lawful stay/exact foreign contracts, Art. 3(1) `spouseIsFamilyMember`, and separately Art. 41 sponsor-held renewable >=1-year permit/family-outside staging; it does not emit an exhaustive relationship list. Decision asserts self-declaration, `408000 ALL`, `self_and_dependants`, no period/headcount formula and p.8 “unless otherwise provided” anchor. CBR/BoA return dated decimal strings; FX periods are at most three days old and differ by at most one day. Tirana requires both artifacts and named visible WMS layers but makes no quality claim. One semantic HTTP-200 fixture fails.
- [ ] **Step 9: Implement one PDF extractor and the five pure parser functions.** Persist anchors as `{artifactId, locator, excerptSha256}`; reject “first number” parsing, JS execution, crawling and LLM fallback.
- [ ] **Step 10: Run `pnpm vitest run tests/sources`, then `pnpm test`; expect PASS, then commit `feat: capture VS-1 official sources`.**

### Task 3: SQLite evidence store, HMAC seal and offline evidence replay

**Files:** Create `src/research/run.ts`, `src/infrastructure/integrity.ts`, `src/infrastructure/sqlite/{schema.sql,db.ts,evidence-store.ts}`, `src/application/replay-evidence.ts`, `tests/integration/{evidence-store,current-evidence}.test.ts`.

**Interfaces:** Research produces `runCurrentEvidence({runId,assessmentDate,deadlineAt}, ports): Promise<EvidenceSnapshot>`, Research-only `sealEvidence`, read-only verified load and `replayEvidence`; only live capture can satisfy current-run coverage.

- [ ] **Step 1: Write failing persistence tests.** Require raw/partial bytes stored before parsing and one atomic sealed snapshot only after all five entries become terminal `verified|unavailable`; its canonical HMAC manifest binds `assessmentDate`; every unavailable entry has one typed `EvidenceBlocker` and no invented claim.
```ts
await expect(store.loadVerified(tamperedId, key)).rejects.toThrow("integrity_mismatch");
expect(networkCapture).not.toHaveBeenCalled();
```
- [ ] **Step 2: Run `pnpm vitest run tests/integration/evidence-store.test.ts`; expect FAIL because schema/store do not exist.**
- [ ] **Step 3: Implement only `artifacts` and `evidence_snapshots`.** Add triggers rejecting update/delete on sealed rows; do not pre-create run/branch tables and do not add a generic repository or ORM.
- [ ] **Step 4: Add failing current-evidence/replay cases.** Five explicit entries run concurrently; QBZ/Tirana substeps stay sequential; one shared deadline-derived `AbortSignal` reaches every fetch; `RequestStep` retries only the failed step once for retryable kinds and never starts it after budget expiry. Terminal semantic failure seals blocker plus `coverage:"unavailable"`. Offline replay reuses the sealed assessment cutoff and calls no network. Tamper/date/version/key failures reject.
- [ ] **Step 5: Run both integration files; expect FAIL because `runCurrentEvidence`/integrity are absent.**
- [ ] **Step 6: Implement canonical HMAC, run-scoped retry executor and async `runCurrentEvidence`.** Research creates/clears the shared deadline timer and abort controller, owns entry list, sequencing, immediate raw persistence, pure parsers and terminal seal; it reuses `captureHttpOnce` through the source port.
- [ ] **Step 7: Implement `replayEvidence`; verify HMAC/hashes first, then invoke the same parse/seal primitives without capture.**
- [ ] **Step 8: Run integration tests and full current suite; expect PASS, then commit `feat: seal and replay evidence`.**

### Task 4: Current-run orchestration and bounded recovery

**Files:** Create `src/application/contracts.ts`, `src/application/confirmed-life.ts`, `src/infrastructure/composition-root.ts`, `src/infrastructure/sqlite/{profile-store,run-store}.ts`, `src/app/actions.ts`; modify `schema.sql`; create `tests/integration/confirmed-life.test.ts`.

**Interfaces:** Public server actions produce `startConfirmedLife(draft:ProfileDraft,initialHousing:HousingDecision): Promise<RunResult>` and `retryConfirmedLifeRun(previousRunId): Promise<RunResult>`; internal use cases produce `runConfirmedLife(profileId,initialHousing)`, `retryConfirmedLife(previousRunId)`, and `loadRunDetailsCore(runId): RunDetailsCore`. Application loads a hash-verified stored snapshot and sees one Research port, never source IDs/sequencing/raw.

- [ ] **Step 1: Write failing happy-path test.** Server-side strict confirmation rejects PII, client-supplied snapshot IDs/timestamps and missing/invalid initial housing; complete capture must append a canonical `profile_snapshots` row, persist/parse/seal evidence before assessment, and append an HMAC-sealed `AssessmentRunRevision` binding assessment date/initial housing/profile/evidence/assessment/rules.
- [ ] **Step 2: Run `pnpm vitest run tests/integration/confirmed-life.test.ts`; expect FAIL for missing use case.**
- [ ] **Step 3: Implement direct orchestration.** The action accepts only `ProfileDraft` plus narrow `HousingDecision`, calls Decision profile confirmation and Branch housing confirmation on the server, then append-only profile storage; the internal use case hash-verifies/loads them, computes `deadlineAt`, calls `Research.runCurrentEvidence` once, calls Decision once with `{housingProvided:true}`, then appends the assessment run revision containing the exact Branch-owned housing amount. Application contains no five-entry loop, parser, retry or persistence logic.
- [ ] **Step 4: Add recovery tests.** Yellow consumes the sealed incomplete snapshot; public manual retry reuses the sealed profile/initial housing but creates a new run/evidence snapshot; fixture/history cannot satisfy current run; the old run/revision remains byte-identical.
- [ ] **Step 5: Implement new-run behavior, thin `retryConfirmedLifeRun`, and append-only `profile_snapshots`/`run_revisions`.** Store canonical profile bytes/hash and HMAC each dated revision including initial housing; update/delete is forbidden. Produce redacted profile/evidence metadata/verified facts/calculation lineage/blocker links in `RunDetailsCore`; client owns gray while pending—no queue, worker, polling or websocket.
- [ ] **Step 6: Run integration tests and full current suite; expect PASS, then commit `feat: orchestrate confirmed-life run`.**

### Task 5: Deterministic budget and Life Git

**Files:** Create `src/branch/{budget,life-git}.ts`, `src/infrastructure/sqlite/branch-store.ts`, `src/application/{fork-housing,replay}.ts`; modify `schema.sql`/`run-store.ts`; create `tests/{domain/budget.test.ts,branch/life-git.test.ts}`.

**Interfaces:** Branch produces `calculateBudget`, `createCommit`, `rewindTo(): BranchCursor`, `forkHousing(HousingDecision)`, `diffCommits(): HousingBranchDiff`, `replayCommit`; application `saveInitialHousingBranch` permits only a verified `green` assessment, while `replayRun` coordinates verified dated evidence + assessment + Branch replay. This is a housing-only contract, not a generic decision/diff engine; storage exposes append/read only.

- [ ] **Step 1: Write failing budget tests.** Assert `210000 / 93.1901 * 93.13 = 209864.57` with unrounded Decimal intermediates/HALF_UP; taxes/living costs stay typed unknown.
- [ ] **Step 2: Run `pnpm vitest run tests/domain/budget.test.ts`; expect FAIL.**
- [ ] **Step 3: Implement `calculateBudget`; return decimal strings and formula/input/output hashes, never JS-number currency.**
- [ ] **Step 4: Write failing Life Git tests.** Application creates `C0` from the HMAC-bound assessment-revision `initialHousing=70000` only when the linked assessment is `green`; direct yellow/red calls reject with no append. `C0` cannot change; rewind returns a cursor without deletion; `70000 -> 90000` creates `C1(parentId=C0,forkedFrom=C0)`; diff carries exact before/after/cause for housing/residual and marks profile/evidence/rules reused.
- [ ] **Step 5: Run branch tests; expect FAIL, then create `branch_commits` and implement guarded application `saveInitialHousingBranch` plus Branch `createCommit`, `rewindTo`, `forkHousing`, `diffCommits`, `replayCommit`.** Hash-verify the run/assessment and require `marker === "green"` before append; accept only `HousingDecision`; return the fixed housing/residual causal diff; each commit binds profile/evidence/assessment IDs plus formula/output hashes.
- [ ] **Step 6: Write failing full replay test.** It must verify evidence, rerun assessment/formulas through the same functions, call Branch `replayCommit`, append nothing and label output historical.
- [ ] **Step 7: Run the replay test; expect FAIL, then implement application coordination.** On branch creation append a new HMAC-sealed `RunRevision(stage:"branch", parentRevisionId=assessmentRevision)` binding formula/output; never update the assessment revision.
- [ ] **Step 8: Run domain/branch/full current suite; expect PASS, then commit `feat: add budget and Life Git fork`.**

### Task 6: Visual journey, Evidence Passport and bounded OpenAI narrative

**Files:** Create `public/world-map.svg`, `src/application/present-run.ts`, `src/experience/view-model.ts`, `src/experience/components/{Vs1Journey,ProfileCard,ResearchMap,LifeBranch,EvidencePassport,LifeGitDiff}.tsx`, `src/infrastructure/narrative.ts`, `src/app/{layout,page}.tsx`, `src/app/globals.css`, `tests/integration/experience.test.tsx`; modify `src/application/contracts.ts`, `src/infrastructure/composition-root.ts`, `src/app/actions.ts`.

**Interfaces:** Application owns `NarrativePort.render({claimIds,typedValues})` and `presentRun(runId): Promise<RunDetails>`; it combines `RunDetailsCore` with typed narrative. Experience consumes that serializable `RunDetails` only and never reads ports/SQLite/raw. UI actions are only `retryConfirmedLifeRun(previousRunId)`, `saveInitialHousingBranch(runId)`, `rewindHousingBranch(commitId): BranchCursor`, and `forkHousingBranch(cursor,housingAll)`.

- [ ] **Step 1: Write failing confirmation/map tests.** Profile card exposes and confirms initial housing assumption with contract/resources/lawful-stay/staged companion conditions before calling the action. Pending action shows full-screen gray, airplane Russia→Tirana and exact one-candidate coverage; all markers have icon plus textual state label; green collapses map/no popover. Yellow/red controls are keyboard-focusable and reveal blocker/reason plus official link through Enter/Space; yellow retry creates a new run/snapshot while the old run stays unchanged.
- [ ] **Step 2: Run `pnpm vitest run tests/integration/experience.test.tsx`; expect FAIL.**
- [ ] **Step 3: Implement local SVG/CSS map, view model and native controls.** No map SDK; UI never calculates or decides verdicts.
- [ ] **Step 4: Add failing branch/Passport UI cases.** Render budget flow/bars, six evidence classes, verified official links, calculation inputs/version/rounding/output hash and source-blocker unknowns. Drive real actions `save bound C0(70000) -> rewind -> fork C1(90000)` and assert the returned causal diff without mutating `C0`.
- [ ] **Step 5: Implement `ProfileCard`, `LifeBranch`, `EvidencePassport`, `LifeGitDiff`, yellow retry wiring and the three thin housing actions.** Actions validate IDs/decimal input and delegate to Task 4/5 use cases; `saveInitialHousingBranch` reads the HMAC-bound run-revision value rather than client housing; no client-side branch mutation or calculation.
- [ ] **Step 6: Add failing narrative tests.** Missing key, timeout/refusal, invalid schema, unknown claim ID or any digit in generated prose returns deterministic copy; outbound payload has no PII/free text; evidence/assessment remain byte-equal.
- [ ] **Step 7: Implement application `presentRun`, composition wiring and the server-only `responses.parse` adapter with Zod Structured Output, `store:false` and no tools.** Validate claim-ID subset and digit-free prose before accepting it; otherwise return fixed copy in `RunDetails.narrative`.
- [ ] **Step 8: Run `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build`; expect PASS, then commit `feat: render confirmed-life journey`.**

### Task 7: Live evidence and timed demo gate

**Files:** Create `evals/live.ts`, `evals/visual-truth.md`, `scripts/reset-demo.ts`, `tests/integration/reset-demo.test.ts`; modify `package.json`, `docs/README.md`; generate `artifacts/evals/vs1/<runId>.json` only from the live command.

**Interfaces:** Produces runtime evidence for `source-verified`/`demo-verified`; adds no product behavior.

- [ ] **Step 1: Write and run a failing reset test.** It removes only the exact configured SQLite file plus its `-wal/-shm` siblings inside an injected temporary demo directory and rejects empty, unresolved or directory/root targets.
- [ ] **Step 2: Implement minimal `resetDemo(databasePath, allowedDemoDir)` and rerun the integration test; expect PASS.**
- [ ] **Step 3: Run `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build`; require all four logical groups and zero failures.**
- [ ] **Step 4: Implement and run `pnpm eval:live`.** Use the synthetic approved fixture, capture all five sources, retain raw in SQLite, seal, require exact periods/anchors and save a redacted manifest; dynamic-source failure remains yellow and blocks `source-verified`.
- [ ] **Step 5: Inject one outage spanning two retryable failures of one entry; require exactly two attempts and terminal yellow.** Start a separate healthy recovery run and require a new snapshot. Perform two equal offline replays; corrupt one test-copy byte and require rejection.
- [ ] **Step 6: Run the 60–90-second visual rubric.** Verify map transition, icon/text marker semantics without color, Tab plus Enter/Space for yellow/red reasons, six Passport classes, official outbound links, unknowns and housing causal diff without oral correction.
- [ ] **Step 7: Record observed latency/request cost and only earned readiness levels in the active change package.** Do not archive/canonicalize before implementation evidence is complete.
- [ ] **Step 8: Commit generated redacted evidence and docs as `test: verify VS-1 live journey`; never commit raw DB, HMAC key or API key.**
